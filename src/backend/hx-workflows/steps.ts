/**
 * HXBot (v1.7.5, RTN-11): the three steps that HXBot adds to a workflow (see `@hxbot/contracts/hx-workflows`),
 * and the record of what they did outside HXBot.
 *
 * - An app action does a list of Computer Use calls in order, as the step's agent: with that agent's
 *   Computer Use setting, read when the step starts, so a setting turned off since stops it.
 * - An app skill does one call of an app skill (CU-07), which reads its result back itself.
 * - A team starts a team from a proposal card, as the step's agent, and waits for its result.
 *
 * Each call that changes something has a row in `hx_external_actions`, keyed by the run, the node and its
 * place in the step. "Continue from this step" (a retry) does not do a call again that is done: it gives
 * its first answer. A call that started and has no answer (HXBot stopped in between) is not known: the
 * step fails and says so, and a later continue does that one call again, because the person was told. A
 * read is done again each time: it changes nothing, and a later call may need what it reads now.
 *
 * `{{input}}` in a text of the step's settings is the step's input: the answers of the steps before it.
 */

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { hxWorkflowStepOf } from "@hxbot/contracts/hx-workflows";
import type { WorkflowNode } from "@hxbot/contracts/ipc";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { sourceText } from "@hxbot/i18n/source";
import { z } from "zod";
import { HX_COMPUTER_TOOL_NAMES } from "../hx-computer/tools";
import { HX_SKILL_NAMES, HX_SKILL_TOOL, HX_SKILLS } from "../hx-skills/declarations";
import type { HxJson } from "../hx-skills/operations";
import type { DynamicToolResult } from "../protocol";

/** The most calls of one app action step. */
const HX_APP_ACTION_MAX = 50;
/** The longest answer a step keeps of one call, in characters. */
const ANSWER_LIMIT = 8_000;

const jsonRecord = z.record(z.string(), z.unknown());

const APP_ACTION = z.strictObject({
  tool: z
    .string()
    .min(1)
    .max(60)
    .refine((tool) => HX_COMPUTER_TOOL_NAMES.has(tool) && tool !== HX_SKILL_TOOL, "a computer_* tool"),
  arguments: jsonRecord.optional(),
});
const APP_ACTIONS = z.array(APP_ACTION).min(1).max(HX_APP_ACTION_MAX);

const SKILL_ARGS = z.strictObject({
  files: z.array(z.string().min(1).max(4096)).max(100).optional(),
  output: z.string().min(1).max(4096).optional(),
  params: jsonRecord.optional(),
});

const TEAM_CARD = z
  .object({
    goal: z.string().trim().min(1).max(8_000),
    roles: z.array(jsonRecord).min(1).max(100),
    steps: z.array(jsonRecord).min(1).max(100),
  })
  .loose();

/** A JSON object, as the arguments of a call and a team's card are. */
export type HxJsonObject = { readonly [key: string]: HxJson | undefined };

/** A value as JSON, or undefined when it is not (a function, a cycle, a number that is not finite). */
function hxToJson(value: unknown, depth = 0): HxJson | undefined {
  if (depth > 64) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items: HxJson[] = [];
    for (const item of value) {
      const json = hxToJson(item, depth + 1);
      if (json === undefined) return undefined;
      items.push(json);
    }
    return items;
  }
  if (isDynamicRecord(value)) return hxToJsonObject(value, depth);
  return undefined;
}

/** A record as a JSON object; its fields that are not JSON are left out. */
export function hxToJsonObject(value: unknown, depth = 0): HxJsonObject {
  if (!isDynamicRecord(value)) return {};
  const entries: Array<[string, HxJson]> = [];
  for (const [key, item] of Object.entries(value)) {
    const json = hxToJson(item, depth + 1);
    if (json !== undefined) entries.push([key, json]);
  }
  return Object.fromEntries(entries);
}

export interface HxAppCall {
  tool: string;
  arguments: HxJsonObject;
}

type HxParsedStep =
  | { kind: "app-action"; agentId: string; calls: HxAppCall[] }
  | { kind: "app-skill"; agentId: string; call: HxAppCall }
  | { kind: "team"; agentId: string; card: HxJsonObject };

function text(node: WorkflowNode, name: string): string {
  const value = node.fields[name];
  return typeof value === "string" ? value : "";
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

function issue(error: z.ZodError): string {
  const first = error.issues[0];
  return first ? `${first.path.join(".") || "value"}: ${first.message}`.slice(0, 200) : "invalid";
}

/** The step of a node with its settings checked, or why the settings do not fit. Null for other nodes. */
function hxParseStep(node: WorkflowNode): { step: HxParsedStep } | { problem: string } | null {
  const kind = hxWorkflowStepOf(node);
  if (!kind) return null;
  const agentId = text(node, "agentId");
  if (!agentId) return { problem: sourceText("error.workflow.hxStepNoAgent") };
  if (kind === "app-action") {
    const parsed = parseJson(text(node, "actions"));
    if (!parsed.ok) return { problem: sourceText("error.workflow.hxStepInvalid", { reason: "actions: JSON" }) };
    const calls = APP_ACTIONS.safeParse(parsed.value);
    if (!calls.success) return { problem: sourceText("error.workflow.hxStepInvalid", { reason: issue(calls.error) }) };
    return {
      step: {
        kind,
        agentId,
        calls: calls.data.map((call) => ({ tool: call.tool, arguments: hxToJsonObject(call.arguments ?? {}) })),
      },
    };
  }
  if (kind === "app-skill") {
    const skill = text(node, "skill");
    const action = text(node, "action");
    const known = HX_SKILL_NAMES.find((name) => name === skill);
    if (!known || !HX_SKILLS[known].actions[action])
      return { problem: sourceText("error.workflow.hxStepInvalid", { reason: `${skill || "?"}.${action || "?"}` }) };
    const raw = text(node, "args").trim();
    const parsed = raw ? parseJson(raw) : { ok: true as const, value: {} };
    if (!parsed.ok) return { problem: sourceText("error.workflow.hxStepInvalid", { reason: "args: JSON" }) };
    const args = SKILL_ARGS.safeParse(parsed.value);
    if (!args.success) return { problem: sourceText("error.workflow.hxStepInvalid", { reason: issue(args.error) }) };
    return {
      step: {
        kind,
        agentId,
        call: { tool: HX_SKILL_TOOL, arguments: hxToJsonObject({ skill: known, action, ...args.data }) },
      },
    };
  }
  const parsed = parseJson(text(node, "team"));
  if (!parsed.ok) return { problem: sourceText("error.workflow.hxStepInvalid", { reason: "team: JSON" }) };
  const card = TEAM_CARD.safeParse(parsed.value);
  if (!card.success) return { problem: sourceText("error.workflow.hxStepInvalid", { reason: issue(card.error) }) };
  return { step: { kind: "team", agentId, card: hxToJsonObject(card.data) } };
}

/** `Array.isArray` does not narrow a readonly list. */
function isJsonList(value: HxJson): value is readonly HxJson[] {
  return Array.isArray(value);
}

/** `{{input}}` in each text of a value, replaced by the step's input. */
function hxWithInput(value: HxJson, input: string): HxJson {
  if (typeof value === "string") return value.replaceAll("{{input}}", input);
  if (isJsonList(value)) return value.map((item) => hxWithInput(item, input));
  if (value !== null && typeof value === "object") return hxObjectWithInput(value, input);
  return value;
}

/** `{{input}}` in each text of an object, replaced by the step's input. */
function hxObjectWithInput(value: HxJsonObject, input: string): HxJsonObject {
  const entries: Array<[string, HxJson]> = [];
  for (const [key, item] of Object.entries(value))
    if (item !== undefined) entries.push([key, hxWithInput(item, input)]);
  return Object.fromEntries(entries);
}

/** What a call does outside: nothing (a read), or a kind of the ledger. */
export function hxCallEffect(call: HxAppCall): "read" | "delete" | "other" {
  if (call.tool === HX_SKILL_TOOL) {
    const skill = HX_SKILL_NAMES.find((name) => name === call.arguments.skill);
    const action = typeof call.arguments.action === "string" ? call.arguments.action : "";
    const spec = skill ? HX_SKILLS[skill].actions[action] : undefined;
    if (!spec?.changes) return skill === "settings" && action !== "read" ? "other" : "read";
    return action === "delete" || action === "trash" ? "delete" : "other";
  }
  if (call.tool === "computer_find" || call.tool === "computer_look" || call.tool === "computer_plan") return "read";
  if (call.tool === "computer_app" && call.arguments.action === "list") return "read";
  if (call.tool === "computer_set" && call.arguments.value === undefined) return "read";
  return "other";
}

// --- The record of what the steps did outside HXBot -------------------------------------------------------

interface LedgerRow {
  status: "started" | "done" | "failed" | "unknown";
  result: string | null;
}

function ledgerRow(db: DatabaseSync, key: string): LedgerRow | null {
  const row = db.prepare("SELECT status, result_json FROM hx_external_actions WHERE action_key = ?").get(key);
  if (!isDynamicRecord(row)) return null;
  const status = row.status;
  if (status !== "started" && status !== "done" && status !== "failed" && status !== "unknown") return null;
  return { status, result: typeof row.result_json === "string" ? row.result_json : null };
}

function ledgerWrite(
  db: DatabaseSync,
  entry: {
    key: string;
    scope: string;
    stepId: string;
    kind: "delete" | "other";
    target: string;
    status: LedgerRow["status"];
    result: string | null;
    at: string;
  },
): void {
  db.prepare(
    `INSERT INTO hx_external_actions (action_key, scope, step_id, kind, target, status, result_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(action_key) DO UPDATE SET step_id = excluded.step_id, status = excluded.status,
       result_json = excluded.result_json, updated_at = excluded.updated_at`,
  ).run(
    entry.key,
    entry.scope,
    entry.stepId,
    entry.kind,
    entry.target.slice(0, 300),
    entry.status,
    entry.result,
    entry.at,
    entry.at,
  );
}

/**
 * RTN-07: the calls of a scope that started and have no answer, now not known. The run that stops at a
 * limit leaves them so, and the step says so when it is continued.
 */
export function hxMarkUnknown(db: DatabaseSync, scope: string, at = new Date().toISOString()): number {
  return Number(
    db
      .prepare(
        "UPDATE hx_external_actions SET status = 'unknown', updated_at = ? WHERE scope = ? AND status = 'started'",
      )
      .run(at, scope).changes,
  );
}

// --- Running the steps -----------------------------------------------------------------------------------

export interface HxStepAgent {
  id: string;
  name: string;
  computerUse: boolean;
}

export interface HxTeamReading {
  state: "running" | "done" | "stopped" | "failed";
  result: string | null;
  reason: string | null;
}

/** What the steps need from the rest of HXBot. The application services attach it. */
export interface HxWorkflowStepHost {
  connection(): DatabaseSync;
  agent(agentId: string): HxStepAgent | null;
  /** One Computer Use call, as the agent (`hxComputer.toolCall`). */
  computer(agent: HxStepAgent, call: HxAppCall): Promise<DynamicToolResult>;
  /** Starts a team as the agent; the same key finds the same team. */
  startTeam(input: {
    agentId: string;
    key: string;
    card: HxJsonObject;
  }): Promise<{ teamId: string } | { error: string }>;
  team(teamId: string): HxTeamReading | null;
  stopTeam(teamId: string, agentId: string): Promise<void>;
}

type HxStepOutcome =
  | { status: "done"; output: string }
  | { status: "failed"; error: string }
  | { status: "waiting"; teamId: string };

interface HxStepRun {
  /** `workflow-run:<id>`, or `workflow-step:<id>` for a step that runs alone. */
  scope: string;
  stepId: string;
  nodeId: string;
  attempt: number;
  /**
   * The pass of the node in its run (`hxPassOf`): a loop's next pass does its calls again, and a
   * retry ("continue from this step") keeps the pass it retries, so its done calls give their answers.
   */
  pass: number;
  input: string;
  signal?: AbortSignal;
}

function answerText(result: DynamicToolResult): string {
  const parts = result.contentItems.flatMap((item) => (item.type === "inputText" ? [item.text] : []));
  const joined = parts.join("\n");
  return joined.length > ANSWER_LIMIT ? `${joined.slice(0, ANSWER_LIMIT)}…` : joined;
}

/** The reason of a failed call, from its JSON answer when it has one. */
function failureText(answer: string): string {
  const parsed = parseJson(answer);
  if (parsed.ok && isDynamicRecord(parsed.value)) {
    const reason = parsed.value.reason ?? parsed.value.error ?? parsed.value.status;
    if (typeof reason === "string" && reason.length > 0) return reason.slice(0, 500);
  }
  return answer.slice(0, 500) || "It did not work.";
}

function keyId(key: string): string {
  return `wf-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

class HxWorkflowSteps {
  #host: HxWorkflowStepHost | null = null;

  attach(host: HxWorkflowStepHost | null): void {
    this.#host = host;
  }

  get attached(): boolean {
    return this.#host !== null;
  }

  /**
   * RTN-11: what a step needs before it starts or continues, read now: its settings, its agent, that
   * agent's Computer Use for an app step, and the host that runs it. Null when it can start.
   */
  recheck(node: WorkflowNode): string | null {
    const parsed = hxParseStep(node);
    if (!parsed) return null;
    if ("problem" in parsed) return parsed.problem;
    const host = this.#host;
    if (!host) return sourceText("error.workflow.hxStepUnavailable");
    const agent = host.agent(parsed.step.agentId);
    if (!agent) return sourceText("error.workflow.hxStepNoAgent");
    if (parsed.step.kind !== "team" && !agent.computerUse)
      return sourceText("error.workflow.hxStepComputerUseOff", { agent: agent.name });
    return null;
  }

  /** Runs a step from its start, or continues it: a call that is done gives its first answer. */
  async run(node: WorkflowNode, run: HxStepRun): Promise<HxStepOutcome> {
    const blocked = this.recheck(node);
    if (blocked) return { status: "failed", error: blocked };
    const host = this.#host;
    const parsed = hxParseStep(node);
    if (!host || !parsed || "problem" in parsed) return { status: "failed", error: blocked ?? "" };
    const agent = host.agent(parsed.step.agentId);
    if (!agent) return { status: "failed", error: sourceText("error.workflow.hxStepNoAgent") };
    const step = parsed.step;
    if (step.kind === "team") return this.#startTeam(host, step, run);
    const calls = step.kind === "app-skill" ? [step.call] : step.calls;
    const answers: Array<{ tool: string; ok: boolean; answer: string; again?: true }> = [];
    for (const [index, raw] of calls.entries()) {
      if (run.signal?.aborted) return { status: "failed", error: sourceText("error.workflow.interrupted") };
      const call = { tool: raw.tool, arguments: hxObjectWithInput(raw.arguments, run.input) };
      const effect = hxCallEffect(call);
      const key = `${run.scope}:${run.nodeId}:${run.pass}:${index}`;
      const db = host.connection();
      if (effect !== "read") {
        const known = ledgerRow(db, key);
        if (known?.status === "done") {
          answers.push({ tool: call.tool, ok: true, answer: known.result ?? "", again: true });
          continue;
        }
        if (known?.status === "started") {
          // HXBot stopped while it was being done: tell the person, and do it again only on their continue.
          ledgerWrite(db, {
            key,
            scope: run.scope,
            stepId: run.stepId,
            kind: effect,
            target: call.tool,
            status: "unknown",
            result: null,
            at: new Date().toISOString(),
          });
          return { status: "failed", error: sourceText("error.workflow.hxActionUnknown", { action: call.tool }) };
        }
        ledgerWrite(db, {
          key,
          scope: run.scope,
          stepId: run.stepId,
          kind: effect,
          target: call.tool,
          status: "started",
          result: null,
          at: new Date().toISOString(),
        });
      }
      const withKey =
        call.tool === HX_SKILL_TOOL && effect !== "read"
          ? { ...call, arguments: { ...call.arguments, requestId: keyId(key) } }
          : call;
      let result: DynamicToolResult;
      try {
        result = await host.computer(agent, withKey);
      } catch (error) {
        result = {
          success: false,
          contentItems: [{ type: "inputText", text: error instanceof Error ? error.message : String(error) }],
        };
      }
      const answer = answerText(result);
      if (effect !== "read") {
        ledgerWrite(host.connection(), {
          key,
          scope: run.scope,
          stepId: run.stepId,
          kind: effect,
          target: call.tool,
          status: result.success ? "done" : "failed",
          result: result.success ? JSON.stringify(answer) : null,
          at: new Date().toISOString(),
        });
      }
      answers.push({ tool: call.tool, ok: result.success, answer });
      if (!result.success)
        return {
          status: "failed",
          error: sourceText("error.workflow.hxActionFailed", { action: call.tool, reason: failureText(answer) }),
        };
    }
    if (step.kind === "app-skill") {
      const only = answers[0];
      const stored = only?.again ? parseJson(only.answer) : null;
      return {
        status: "done",
        output: stored?.ok && typeof stored.value === "string" ? stored.value : (only?.answer ?? ""),
      };
    }
    return {
      status: "done",
      output: JSON.stringify(
        answers.map((entry) => {
          const stored = entry.again ? parseJson(entry.answer) : null;
          return {
            tool: entry.tool,
            ok: entry.ok,
            answer: stored?.ok && typeof stored.value === "string" ? stored.value : entry.answer,
          };
        }),
      ),
    };
  }

  async #startTeam(
    host: HxWorkflowStepHost,
    step: Extract<HxParsedStep, { kind: "team" }>,
    run: HxStepRun,
  ): Promise<HxStepOutcome> {
    const key = `${run.scope}:${run.nodeId}:team:${run.attempt}`;
    const db = host.connection();
    const known = ledgerRow(db, key);
    const stored = known?.result ? parseJson(known.result) : null;
    if (stored?.ok && isDynamicRecord(stored.value) && typeof stored.value.teamId === "string") {
      return this.#teamOutcome(host, stored.value.teamId);
    }
    const goal = typeof step.card.goal === "string" ? step.card.goal : "";
    const card = { ...step.card, goal: run.input ? `${goal}\n\n--- input ---\n${run.input}`.slice(0, 8_000) : goal };
    ledgerWrite(db, {
      key,
      scope: run.scope,
      stepId: run.stepId,
      kind: "other",
      target: "start_team",
      status: "started",
      result: null,
      at: new Date().toISOString(),
    });
    const started = await host.startTeam({ agentId: step.agentId, key, card });
    if ("error" in started) {
      ledgerWrite(host.connection(), {
        key,
        scope: run.scope,
        stepId: run.stepId,
        kind: "other",
        target: "start_team",
        status: "failed",
        result: null,
        at: new Date().toISOString(),
      });
      return { status: "failed", error: sourceText("error.workflow.hxTeamFailed", { reason: started.error }) };
    }
    ledgerWrite(host.connection(), {
      key,
      scope: run.scope,
      stepId: run.stepId,
      kind: "other",
      target: "start_team",
      status: "done",
      result: JSON.stringify({ teamId: started.teamId }),
      at: new Date().toISOString(),
    });
    return this.#teamOutcome(host, started.teamId);
  }

  #teamOutcome(host: HxWorkflowStepHost, teamId: string): HxStepOutcome {
    const reading = host.team(teamId);
    if (!reading) return { status: "failed", error: sourceText("error.workflow.hxTeamFailed", { reason: teamId }) };
    if (reading.state === "running") return { status: "waiting", teamId };
    if (reading.state === "done") return { status: "done", output: reading.result ?? "" };
    return {
      status: "failed",
      error: sourceText("error.workflow.hxTeamFailed", { reason: reading.reason ?? reading.state }),
    };
  }

  /**
   * After a restart or a team's change: the outcome of a step that has no fiber. A team step reads its
   * team. An app step that has none lost its work to a stop: its started calls are not known.
   */
  resume(node: WorkflowNode, run: Omit<HxStepRun, "input" | "signal">): HxStepOutcome {
    const host = this.#host;
    if (!host) return { status: "failed", error: sourceText("error.workflow.interrupted") };
    if (hxWorkflowStepOf(node) === "team") {
      const known = ledgerRow(host.connection(), `${run.scope}:${run.nodeId}:team:${run.attempt}`);
      const stored = known?.result ? parseJson(known.result) : null;
      if (stored?.ok && isDynamicRecord(stored.value) && typeof stored.value.teamId === "string")
        return this.#teamOutcome(host, stored.value.teamId);
      return { status: "failed", error: sourceText("error.workflow.interrupted") };
    }
    const marked = hxMarkUnknownOf(host.connection(), run.scope, run.nodeId);
    return {
      status: "failed",
      error:
        marked > 0
          ? sourceText("error.workflow.hxActionUnknown", { action: node.id })
          : sourceText("error.workflow.interrupted"),
    };
  }

  /** Stops the team of a team step that a person or a limit stops. Other steps stop with their fiber. */
  async stop(node: WorkflowNode, run: Omit<HxStepRun, "input" | "signal">): Promise<void> {
    const host = this.#host;
    const parsed = hxParseStep(node);
    if (!host || !parsed || "problem" in parsed || parsed.step.kind !== "team") return;
    const known = ledgerRow(host.connection(), `${run.scope}:${run.nodeId}:team:${run.attempt}`);
    const stored = known?.result ? parseJson(known.result) : null;
    if (stored?.ok && isDynamicRecord(stored.value) && typeof stored.value.teamId === "string")
      await host.stopTeam(stored.value.teamId, parsed.step.agentId).catch(() => undefined);
  }
}

/** The started calls of one node of a scope, now not known. */
function hxMarkUnknownOf(db: DatabaseSync, scope: string, nodeId: string): number {
  const prefix = `${scope}:${nodeId}:`.replaceAll(/[%_\\]/gu, "\\$&");
  return Number(
    db
      .prepare(
        `UPDATE hx_external_actions SET status = 'unknown', updated_at = ?
         WHERE scope = ? AND status = 'started' AND action_key LIKE ? ESCAPE '\\'`,
      )
      .run(new Date().toISOString(), scope, `${prefix}%`).changes,
  );
}

export const hxWorkflowSteps = new HxWorkflowSteps();

/**
 * The pass of a step's node in its run: the steps of that node that the run made itself
 * (`<run>:<node>:<n>`) up to this one. A retry has the request id of the person's click, so it keeps the
 * pass before it; a step that runs alone is pass 1.
 */
export function hxPassOf(db: DatabaseSync, step: { runId: string | null; nodeId: string; sequence: number }): number {
  if (!step.runId) return 1;
  const prefix = `${step.runId}:${step.nodeId}:`;
  let pass = 0;
  for (const row of db
    .prepare("SELECT request_id FROM workflow_steps WHERE run_id = ? AND node_id = ? AND rowid <= ?")
    .all(step.runId, step.nodeId, step.sequence)) {
    const id = isDynamicRecord(row) ? row.request_id : null;
    if (typeof id === "string" && id.startsWith(prefix) && /^\d+$/u.test(id.slice(prefix.length))) pass += 1;
  }
  return Math.max(1, pass);
}

/** The ledger scope of a step: its run, or the step itself when it runs alone. */
export function hxStepScope(step: { id: string; runId: string | null }): string {
  return step.runId ? `workflow-run:${step.runId}` : `workflow-step:${step.id}`;
}
