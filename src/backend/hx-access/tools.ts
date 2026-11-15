// HXBot：request_access 和 release_access 两个工具。智能体先说明为什么、做什么、对什么做，
// 客户在卡片上选“允许一次”（每个对象用一次，本次任务内有效）、“始终允许”（存成规则，对所有智能体有效）或“拒绝”。

import { dirname, isAbsolute, resolve } from "node:path";
import type { AgentPromptQuestion } from "@hxbot/contracts/ipc";
import { z } from "zod";
import type { DynamicToolResult } from "../protocol";
import { getString } from "../protocol";
import {
  type AccessRequest,
  accessChoice,
  accessIsPayment,
  accessNote,
  accessQuestion,
  accessRuleTargets,
  hxAccessLocale,
  parseAccessRequest,
} from "./card";
import { hxAccessGrants } from "./grants";
import { type HxAccessAgent, hxAccessAgent } from "./hub";
import { hxAccessStore } from "./rules";

export const REQUEST_ACCESS_TOOL = "request_access";
export const RELEASE_ACCESS_TOOL = "release_access";
export const HX_ACCESS_TOOL_NAMES: ReadonlySet<string> = new Set([REQUEST_ACCESS_TOOL, RELEASE_ACCESS_TOOL]);

export const HX_ACCESS_TOOL_DEFINITIONS = [
  {
    name: REQUEST_ACCESS_TOOL,
    description: [
      "At maximum access (最大权限), ask before: changing an existing file or deleting outside your workspace folders, key and login stores, sudo or a delete HXBot cannot tell, filling in a card. Nothing else needs a request.",
      "Give reason and purpose (for a payment the merchant and total) and the exact targets: a file or folder with actions read, write or delete; a command or its first words such as `sudo apt`; a website for password or payment; a Vault item id. List all files of a step at once.",
      'Result: {"status":"granted","scope":"once"|"always",…} or {"status":"denied"}. Once covers each target once. Never ask for passwords here: use the Vault tools.',
    ].join(" "),
    shape: {
      reason: z.string().min(1).max(400).describe("Why you need the access, in the user's language."),
      purpose: z.string().min(1).max(400).describe("What you will do with it, in the user's language."),
      targets: z
        .array(
          z.strictObject({
            type: z.enum(["folder", "file", "website", "command", "screen", "search", "password", "payment", "vault"]),
            value: z
              .string()
              .max(300)
              .describe(
                "Absolute path, website address (website, password, payment), command or its first words, Vault item id, or empty for screen and search.",
              ),
          }),
        )
        .min(1)
        .max(10),
      actions: z
        .array(z.enum(["read", "write", "delete"]))
        .max(3)
        .optional()
        .describe("For files and folders: read, write or delete."),
    },
  },
  {
    name: RELEASE_ACCESS_TOOL,
    description:
      "Give back access that the user granted with request_access, as soon as you no longer need it. Pass grantId for one grant, or nothing to give back all of them.",
    shape: { grantId: z.string().max(80).optional() },
  },
] as const;

function result(value: unknown, success = true): DynamicToolResult {
  return { success, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

function failure(message: string): DynamicToolResult {
  return result({ error: message }, false);
}

/** What waits for the user's answer to an access card. */
export interface HxAccessPending {
  request: AccessRequest;
  agentId: string;
  /** The provider thread and turn: the grant ends with that turn. */
  threadId: string;
  turnId: string;
}

export type HxAccessCall = { result: DynamicToolResult } | { question: AgentPromptQuestion; access: HxAccessPending };

/** The card for a request_access call, or the result of a release_access call or a refused request. */
export function hxAccessToolCall(
  tool: string,
  args: unknown,
  agentId: string,
  threadId: string,
  turnId: string,
): HxAccessCall {
  const agent = hxAccessAgent(agentId);
  if (tool === RELEASE_ACCESS_TOOL) {
    const grantId = getString(args, "grantId");
    if (grantId) {
      const own = hxAccessGrants.forThread(agentId, threadId).some((grant) => grant.id === grantId);
      if (!own) return { result: failure("No such grant in this task.") };
      hxAccessGrants.release(grantId);
      return { result: result({ status: "released", released: 1 }) };
    }
    return { result: result({ status: "released", released: hxAccessGrants.releaseThread(agentId, threadId) }) };
  }
  if (!agent) return { result: failure("HXBot does not know this agent.") };
  if (!agent.onDemand)
    return {
      result: result({
        status: "not_needed",
        note: "This agent has full access: it needs no confirmation from HXBot. Provider approvals still ask.",
      }),
    };
  const parsed = parseAccessRequest(args, (path) => absolutePath(path, agent));
  if (typeof parsed === "string") return { result: failure(parsed) };
  return {
    question: accessQuestion(parsed, agent.name, hxAccessLocale()),
    access: { request: parsed, agentId, threadId, turnId },
  };
}

function absolutePath(path: string, agent: HxAccessAgent): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  const expanded = home ? path.replace(/^~(?=$|[\\/])/u, home) : path;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(agent.workspacePath, expanded);
}

/**
 * Whoever answers may refuse; only the owner may grant. Absent is the person at this computer, and a
 * local script never gets here (`localAttention` marks the card as needing HXBot).
 */
export function hxAccessMayAnswer(
  _access: HxAccessPending,
  answers: Readonly<Record<string, readonly string[]>>,
  responder: { owner?: boolean } | undefined,
): boolean {
  if (accessChoice(answers) === "refuse") return true;
  return responder === undefined || responder.owner === true;
}

/**
 * The tool result for the user's answer. Allow once makes a grant for this task whose targets cover
 * one use each; Always allow makes a rule for every agent (never for a payment).
 */
export function hxAccessAnswer(
  access: HxAccessPending,
  answers: Readonly<Record<string, readonly string[]>>,
): DynamicToolResult {
  let choice = accessChoice(answers);
  if (choice === "always" && accessIsPayment(access.request)) choice = "once";
  // A text the user wrote in the card is their condition: the agent gets it word for word.
  const userNote = accessNote(answers);
  const withNote = userNote ? { userNote } : {};
  const agentName = hxAccessAgent(access.agentId)?.name ?? "";
  const summary = access.request.targets.map((target) => `${target.type} ${target.value}`.trim()).join("; ");
  if (choice === "refuse") {
    hxAccessStore.record({ agent: agentName, kind: "request", detail: summary, outcome: "refused" });
    return result({
      status: "denied",
      ...withNote,
      note: "The user did not allow it. Do not try another way to reach it; continue without it or ask the user what to do.",
    });
  }
  if (choice === "always") {
    hxAccessStore.addRule({
      targets: accessRuleTargets(access.request.targets, dirname),
      actions: access.request.actions,
      agentName,
      reason: access.request.reason,
    });
    hxAccessStore.record({ agent: agentName, kind: "request", detail: summary, outcome: "allowed-always" });
    return result({
      status: "granted",
      scope: "always",
      actions: access.request.actions,
      targets: accessRuleTargets(access.request.targets, dirname),
      ...withNote,
      note: "The user allowed it from now on, for every agent. Go ahead with the step, for the purpose you gave.",
    });
  }
  const grant = hxAccessGrants.add({
    agentId: access.agentId,
    threadId: access.threadId,
    turnId: access.turnId,
    targets: access.request.targets,
    actions: access.request.actions,
    reason: access.request.reason,
    purpose: access.request.purpose,
    once: true,
  });
  hxAccessStore.record({ agent: agentName, kind: "request", detail: summary, outcome: "allowed-once" });
  return result({
    status: "granted",
    scope: "once",
    grantId: grant.id,
    actions: access.request.actions,
    targets: access.request.targets,
    until: "one use of each target, in this task",
    ...withNote,
    note: userNote
      ? "Do the step now, only for the purpose you gave, and keep to the user's note. Each target is allowed once."
      : "Do the step now, only for the purpose you gave. Each target is allowed once.",
  });
}

/** The text a team member gets when they try to grant access. */
export const HX_ACCESS_OWNER_ONLY = "Only the owner of this HXBot can grant access to this computer.";
