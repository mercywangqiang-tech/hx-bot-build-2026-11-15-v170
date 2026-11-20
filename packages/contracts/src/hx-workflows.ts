/**
 * HXBot (v1.7.5, RTN-11, RTN-07, RTN-08): the steps that HXBot adds to a workflow, the limits of a run,
 * and what each node kind declares.
 *
 * The three new steps are `agent` nodes with an `hxStep` field. The kind lists of the shipped workflow
 * tables (`workflow_nodes.kind`, `workflow_steps.kind`) have CHECK constraints, and the frozen
 * `workflows-v1` codec carries a node's fields as an open record, so a client of an earlier version sees
 * the step as an agent step it can read and keeps the field when it saves. Only this computer's host
 * runs them.
 *
 * - `app-action`: a list of Computer Use calls (`computer_*`), done in order with the step's agent's
 *   Computer Use setting. Fields: `agentId`, `actions` (JSON: `[{ "tool": ..., "arguments": {...} }]`).
 * - `app-skill`: one call of an app skill (CU-07). Fields: `agentId`, `skill`, `action`, `args` (JSON of
 *   `files`, `output` and `params`).
 * - `team`: a team that does one piece of work from a proposal card (TEAM-01). Fields: `agentId` (the
 *   agent that starts the team), `team` (JSON of the card: `goal`, `roles`, `steps` and the rest of
 *   `start_team`). The step's input is added to the goal.
 *
 * An agent step may also have `model: "auto"`: HXBot picks the model of that step's turn.
 */

import { INPUT_LIMITS } from "./input-limits";
import type { WorkflowNode, WorkflowNodeKind, WorkflowPortType } from "./ipc-workflows";
import { isBoolean, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const HX_WORKFLOW_STEP_KINDS = ["app-action", "app-skill", "team"] as const;
export type HxWorkflowStepKind = (typeof HX_WORKFLOW_STEP_KINDS)[number];

/** The field that makes an agent node one of HXBot's steps. */
export const HX_WORKFLOW_STEP_FIELD = "hxStep";
/** The model of an agent step that HXBot picks for each turn. */
export const HX_WORKFLOW_AUTO_MODEL = "auto";

/** The HXBot step of a node, or null for every other node. */
export function hxWorkflowStepOf(node: Pick<WorkflowNode, "kind" | "fields">): HxWorkflowStepKind | null {
  const value = node.fields[HX_WORKFLOW_STEP_FIELD];
  return node.kind === "agent" && isOneOf(HX_WORKFLOW_STEP_KINDS, value) ? value : null;
}

/** RTN-07: the limits of one run. A loop is the next pass that a loop edge starts. */
export interface HxWorkflowLimits {
  /** Passes of one loop. */
  loops: number;
  /** Steps of one run, the attempts of every node together. */
  steps: number;
  /** Seconds a run spends in its loops, apart from the time an approval waits for a person. */
  seconds: number;
}

export const HX_WORKFLOW_DEFAULT_LIMITS: HxWorkflowLimits = { loops: 10, steps: 100, seconds: 600 };
/** The most that the advanced setting allows: finite, within what one computer can run. */
export const HX_WORKFLOW_MAX_LIMITS: HxWorkflowLimits = { loops: 1_000, steps: 10_000, seconds: 86_400 };

export function isHxWorkflowLimits(value: unknown): value is HxWorkflowLimits {
  if (!isDynamicRecord(value)) return false;
  const within = (field: unknown, most: number) =>
    typeof field === "number" && Number.isSafeInteger(field) && field >= 1 && field <= most;
  return (
    within(value.loops, HX_WORKFLOW_MAX_LIMITS.loops) &&
    within(value.steps, HX_WORKFLOW_MAX_LIMITS.steps) &&
    within(value.seconds, HX_WORKFLOW_MAX_LIMITS.seconds)
  );
}

export interface HxWorkflowLimitsInput {
  workflowId: string;
  /** Null goes back to the defaults. */
  limits: HxWorkflowLimits | null;
}

export function decodeHxWorkflowLimitsInput(value: unknown): HxWorkflowLimitsInput {
  if (
    !isDynamicRecord(value) ||
    !isString(value.workflowId) ||
    value.workflowId.length === 0 ||
    value.workflowId.length > INPUT_LIMITS.identifier ||
    (value.limits !== null && !isHxWorkflowLimits(value.limits))
  ) {
    throw new Error("Invalid workflow limits.");
  }
  return { workflowId: value.workflowId, limits: value.limits };
}

export function decodeHxWorkflowLimits(value: unknown): HxWorkflowLimits {
  if (!isHxWorkflowLimits(value)) throw new Error("Invalid workflow limits.");
  return { loops: value.loops, steps: value.steps, seconds: value.seconds };
}

/**
 * RTN-08: what a node kind declares. A kind that the host runs declares all of it; one without a runner
 * is `unsupported`, and the canvas, a save, a call and a run all refuse it.
 */
export interface HxNodeDeclaration {
  inputs: readonly WorkflowPortType[];
  outputs: readonly WorkflowPortType[];
  /** What the step needs to run: nothing, a person's answer, an agent, Computer Use, a messaging connection. */
  permission: "none" | "person" | "agent" | "computer-use" | "connection";
  /** `yes`: doing it again gives the same; `key`: done again with the same key it does nothing more; `no`. */
  idempotent: "yes" | "key" | "no";
  /** How the host knows it worked. */
  readback: "value" | "answer" | "file" | "delivery" | "post" | "team" | "person";
  /** What a failure leaves: the step failed with the reason, and an action whose result is not known says so. */
  failure: "failed" | "failed-or-unknown";
}

export type HxNodeKey = WorkflowNodeKind | HxWorkflowStepKind;

const TEXT: readonly WorkflowPortType[] = ["text"];
const ANY: readonly WorkflowPortType[] = ["text", "image", "file"];

export const HX_NODE_DECLARATIONS: Readonly<Partial<Record<HxNodeKey, HxNodeDeclaration>>> = {
  trigger: { inputs: [], outputs: TEXT, permission: "none", idempotent: "yes", readback: "value", failure: "failed" },
  prompt: { inputs: [], outputs: TEXT, permission: "none", idempotent: "yes", readback: "value", failure: "failed" },
  llm: { inputs: ANY, outputs: TEXT, permission: "none", idempotent: "no", readback: "answer", failure: "failed" },
  agent: {
    inputs: ANY,
    outputs: TEXT,
    permission: "agent",
    idempotent: "key",
    readback: "delivery",
    failure: "failed",
  },
  condition: {
    inputs: TEXT,
    outputs: TEXT,
    permission: "none",
    idempotent: "no",
    readback: "answer",
    failure: "failed",
  },
  approval: {
    inputs: TEXT,
    outputs: TEXT,
    permission: "person",
    idempotent: "yes",
    readback: "person",
    failure: "failed",
  },
  output: {
    inputs: ANY,
    outputs: [],
    permission: "connection",
    idempotent: "key",
    readback: "post",
    failure: "failed-or-unknown",
  },
  "app-action": {
    inputs: ANY,
    outputs: TEXT,
    permission: "computer-use",
    idempotent: "key",
    readback: "answer",
    failure: "failed-or-unknown",
  },
  "app-skill": {
    inputs: ANY,
    outputs: TEXT,
    permission: "computer-use",
    idempotent: "key",
    readback: "file",
    failure: "failed-or-unknown",
  },
  team: { inputs: ANY, outputs: TEXT, permission: "agent", idempotent: "key", readback: "team", failure: "failed" },
};

/** The declaration of a node: of its HXBot step when it has one, else of its kind; null when it has none. */
export function hxNodeDeclaration(node: Pick<WorkflowNode, "kind" | "fields">): HxNodeDeclaration | null {
  return HX_NODE_DECLARATIONS[hxWorkflowStepOf(node) ?? node.kind] ?? null;
}

/** RTN-11: the save of one finished turn as a workflow. */
export interface HxSaveTurnInput {
  agentId: string;
  turnId: string;
}

export interface HxSaveTurnResult {
  workflowId: string;
  title: string;
  steps: number;
}

export function decodeHxSaveTurnInput(value: unknown): HxSaveTurnInput {
  if (
    !isDynamicRecord(value) ||
    !isString(value.agentId) ||
    value.agentId.length === 0 ||
    value.agentId.length > INPUT_LIMITS.identifier ||
    !isString(value.turnId) ||
    value.turnId.length === 0 ||
    value.turnId.length > 200
  ) {
    throw new Error("Invalid turn.");
  }
  return { agentId: value.agentId, turnId: value.turnId };
}

export function decodeHxSaveTurnResult(value: unknown): HxSaveTurnResult {
  if (
    !isDynamicRecord(value) ||
    !isString(value.workflowId) ||
    !isString(value.title) ||
    typeof value.steps !== "number" ||
    !Number.isSafeInteger(value.steps) ||
    value.steps < 0
  ) {
    throw new Error("Invalid saved workflow.");
  }
  return { workflowId: value.workflowId, title: value.title, steps: value.steps };
}

/** The chat line after a turn that can be saved as a workflow: a turn-less system message. */
export const HX_SAVE_TURN_ITEM_TYPE = "hx-save-turn";
export const HX_SAVE_TURN_ID_PREFIX = "hx-save-turn:";

export interface HxSaveTurnLine {
  turnId: string;
  /** The calls that the workflow would repeat. */
  steps: number;
  /** Set once the turn was saved. */
  workflowId?: string;
  saved?: boolean;
}

export function hxSaveTurnText(line: HxSaveTurnLine): string {
  return JSON.stringify(line);
}

export function hxParseSaveTurnText(text: string): HxSaveTurnLine | null {
  try {
    const value = JSON.parse(text);
    if (!isDynamicRecord(value) || !isString(value.turnId) || typeof value.steps !== "number") return null;
    return {
      turnId: value.turnId,
      steps: value.steps,
      ...(isString(value.workflowId) ? { workflowId: value.workflowId } : {}),
      ...(isBoolean(value.saved) ? { saved: value.saved } : {}),
    };
  } catch {
    return null;
  }
}
