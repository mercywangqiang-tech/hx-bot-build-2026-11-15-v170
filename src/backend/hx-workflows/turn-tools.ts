/**
 * HXBot (v1.7.5, RTN-11): "save as a workflow" in a chat. A turn that did its work with Computer Use,
 * app skills or a team keeps the list of those calls; after the turn a line in the chat offers to save
 * it. The workflow repeats each call that worked, in order:
 *
 * - an app skill call is one app skill step, with its files, output and params (its input);
 * - a team is one team step, with its card: each role keeps its work type and difficulty (the model it
 *   needs);
 * - the other Computer Use calls in a row are one app action step;
 * - before a step that deletes, runs a script, installs, changes a setting or starts a team, an approval
 *   asks again: no approval that was given in the chat comes with it (confirmation points).
 *
 * The list is kept in `hx_meta` for 30 days, at most 100 calls a turn, so a restart does not lose it.
 */

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { HX_WORKFLOW_STEP_FIELD, type HxSaveTurnLine, type HxSaveTurnResult } from "@hxbot/contracts/hx-workflows";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "@hxbot/contracts/ipc";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { sourceText } from "@hxbot/i18n/source";
import { HX_COMPUTER_TOOL_NAMES } from "../hx-computer/tools";
import { HX_SKILL_TOOL } from "../hx-skills/declarations";
import { HX_START_TEAM_TOOL } from "../hx-team/tools";
import type { DynamicToolCallParams } from "../protocol";
import { type HxAppCall, type HxJsonObject, hxCallEffect, hxToJsonObject } from "./steps";

const HX_TURN_TOOLS_MAX = 100;
const KEEP_MS = 30 * 24 * 3_600_000;
/** The largest arguments of one call that a turn keeps, in characters of JSON. */
const ARGUMENTS_LIMIT = 16_000;
const STEP_GAP = 320;

interface HxRecordedCall {
  tool: string;
  arguments: HxJsonObject;
  ok: boolean;
  /** When it was made, in milliseconds: a team start joins the turn's calls in its place. */
  at?: number;
}

/** The params of a Computer Use call, as the router passes them on: the same object, call by call. */
type HxComputerCallParams = Pick<DynamicToolCallParams, "tool" | "arguments">;

interface TurnRecord {
  agentId: string;
  turnId: string;
  calls: HxRecordedCall[];
}

/** Whether a tool is one that a saved workflow repeats. */
function hxRepeatableTool(tool: string): boolean {
  return HX_COMPUTER_TOOL_NAMES.has(tool) || tool === HX_START_TEAM_TOOL;
}

function key(agentId: string, turnId: string): string {
  return `turn-tools:${createHash("sha256").update(`${agentId}\u0000${turnId}`).digest("hex").slice(0, 48)}`;
}

function readRecord(value: unknown): TurnRecord | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    if (
      !isDynamicRecord(parsed) ||
      typeof parsed.agentId !== "string" ||
      typeof parsed.turnId !== "string" ||
      !Array.isArray(parsed.calls)
    )
      return null;
    const calls = parsed.calls.flatMap((call): HxRecordedCall[] =>
      isDynamicRecord(call) && typeof call.tool === "string" && isDynamicRecord(call.arguments)
        ? [
            {
              tool: call.tool,
              arguments: hxToJsonObject(call.arguments),
              ok: call.ok === true,
              ...(typeof call.at === "number" ? { at: call.at } : {}),
            },
          ]
        : [],
    );
    return { agentId: parsed.agentId, turnId: parsed.turnId, calls };
  } catch {
    return null;
  }
}

/** The calls of one turn that a workflow repeats: those that worked, in order. */
function hxRepeatedCalls(calls: readonly HxRecordedCall[]): HxRecordedCall[] {
  return calls.filter((call) => call.ok && hxRepeatableTool(call.tool));
}

interface HxStepTexts {
  /** The question of the approval before a step. */
  confirm: (what: string) => string;
}

function confirmAt(call: HxRecordedCall): boolean {
  if (call.tool === HX_START_TEAM_TOOL) return true;
  if (call.tool === "computer_run" || call.tool === "computer_install") return true;
  if (call.tool === "computer_set" && call.arguments.value !== undefined) return true;
  const effect = hxCallEffect({ tool: call.tool, arguments: call.arguments });
  if (effect === "delete") return true;
  return call.tool === HX_SKILL_TOOL && call.arguments.skill === "settings" && call.arguments.action !== "read";
}

function describe(call: HxRecordedCall): string {
  if (call.tool === HX_SKILL_TOOL) return `${String(call.arguments.skill)}.${String(call.arguments.action)}`;
  if (call.tool === HX_START_TEAM_TOOL) {
    const goal = typeof call.arguments.goal === "string" ? call.arguments.goal : "";
    return goal.length > 60 ? `${goal.slice(0, 59)}…` : goal;
  }
  return call.tool;
}

/**
 * The graph of a saved turn: a manual trigger, then the steps in the order of the calls, each joined to
 * the next by a text edge, an approval before each step that must ask again, and a notification at the
 * end with the last answer.
 */
function hxTurnWorkflowGraph(
  agentId: string,
  calls: readonly HxRecordedCall[],
  texts: HxStepTexts,
): { graph: WorkflowGraph; steps: number } {
  const repeated = hxRepeatedCalls(calls);
  const groups: Array<{ kind: "app-action" | "app-skill" | "team"; calls: HxRecordedCall[] }> = [];
  for (const call of repeated) {
    const kind = call.tool === HX_SKILL_TOOL ? "app-skill" : call.tool === HX_START_TEAM_TOOL ? "team" : "app-action";
    const last = groups.at(-1);
    // Computer Use calls in a row share one step, until one of them must ask first.
    if (kind === "app-action" && last?.kind === "app-action" && !confirmAt(call)) last.calls.push(call);
    else groups.push({ kind, calls: [call] });
  }
  const nodes: WorkflowNode[] = [{ id: "trigger", kind: "trigger", at: { x: 0, y: 0 }, fields: { trigger: "manual" } }];
  const edges: WorkflowEdge[] = [];
  let previous = "trigger";
  const link = (to: string) => {
    edges.push({ id: `edge-${edges.length + 1}`, from: previous, to, type: "text" });
    previous = to;
  };
  for (const [index, group] of groups.entries()) {
    const first = group.calls[0];
    if (!first) continue;
    if (group.calls.some(confirmAt)) {
      const approval = `confirm-${index + 1}`;
      nodes.push({
        id: approval,
        kind: "approval",
        at: { x: STEP_GAP * nodes.length, y: 0 },
        fields: { question: texts.confirm(group.calls.map(describe).join(", ")) },
      });
      link(approval);
    }
    const id = `step-${index + 1}`;
    const fields: WorkflowNode["fields"] =
      group.kind === "app-skill"
        ? {
            [HX_WORKFLOW_STEP_FIELD]: "app-skill",
            agentId,
            skill: String(first.arguments.skill ?? ""),
            action: String(first.arguments.action ?? ""),
            args: JSON.stringify(
              Object.fromEntries(
                Object.entries(first.arguments).filter(
                  ([name]) => name === "files" || name === "output" || name === "params",
                ),
              ),
            ),
          }
        : group.kind === "team"
          ? { [HX_WORKFLOW_STEP_FIELD]: "team", agentId, team: JSON.stringify(first.arguments) }
          : {
              [HX_WORKFLOW_STEP_FIELD]: "app-action",
              agentId,
              actions: JSON.stringify(
                group.calls.map((call): HxAppCall => ({ tool: call.tool, arguments: call.arguments })),
              ),
            };
    nodes.push({ id, kind: "agent", at: { x: STEP_GAP * nodes.length, y: 0 }, fields });
    link(id);
  }
  nodes.push({ id: "output", kind: "output", at: { x: STEP_GAP * nodes.length, y: 0 }, fields: { target: "notify" } });
  link("output");
  return { graph: { nodes, edges, strokes: [] }, steps: groups.length };
}

interface HxTurnSaveHost {
  connection(): DatabaseSync;
  agentName(agentId: string): string | null;
  /** Makes the workflow; the failure is a message the person can read. */
  create(input: { title: string; graph: WorkflowGraph }): Promise<{ workflowId: string; title: string }>;
  texts(): HxStepTexts & { title: (agent: string, date: string) => string };
}

class HxTurnTools {
  #host: HxTurnSaveHost | null = null;
  #line: ((agentId: string, line: HxSaveTurnLine) => void) | null = null;
  /** The calls of turns not written yet, so a call does not wait for the database. */
  readonly #pending = new Map<string, TurnRecord>();
  /**
   * The team starts of each agent, by the key of their call. A start comes through the team service,
   * which knows the call's key (`<thread>:<turn>:<call>`) and not its turn: the turn's end picks its own.
   */
  readonly #teamStarts = new Map<string, Array<{ key: string; call: HxRecordedCall }>>();

  attach(host: HxTurnSaveHost | null): void {
    this.#host = host;
  }

  /** The agent service writes the chat line after a turn (save-line.ts). */
  attachLine(line: ((agentId: string, line: HxSaveTurnLine) => void) | null): void {
    this.#line = line;
  }

  /** Keeps one call of a turn. Only the calls a workflow repeats, and never more than the limit. */
  record(agentId: string, turnId: string, call: HxRecordedCall): void {
    if (!hxRepeatableTool(call.tool) || !turnId) return;
    let json: string;
    try {
      json = JSON.stringify(call.arguments);
    } catch {
      return;
    }
    if (json.length > ARGUMENTS_LIMIT) return;
    const id = key(agentId, turnId);
    const current = this.#pending.get(id) ?? this.#stored(id) ?? { agentId, turnId, calls: [] };
    if (current.calls.length >= HX_TURN_TOOLS_MAX) return;
    current.calls.push({ tool: call.tool, arguments: call.arguments, ok: call.ok, at: call.at ?? Date.now() });
    this.#pending.set(id, current);
    this.#write(id, current);
  }

  readonly #expected = new WeakMap<HxComputerCallParams, { agentId: string; turnId: string }>();

  /** The router names the agent and the turn of a Computer Use call before it is made. */
  expect(params: HxComputerCallParams, agentId: string, turnId: string): void {
    this.#expected.set(params, { agentId, turnId });
  }

  /** A Computer Use call ended (`hxObserveComputerCalls`): it is kept when the router named its turn. */
  computerCalled(params: HxComputerCallParams, result: { success: boolean }): void {
    const owner = this.#expected.get(params);
    if (!owner) return;
    this.#expected.delete(params);
    this.record(owner.agentId, owner.turnId, {
      tool: params.tool,
      arguments: hxToJsonObject(params.arguments),
      ok: result.success,
    });
  }

  /** Keeps one start_team call, until the end of its turn takes it. */
  recordTeamStart(agentId: string, key: string, call: HxRecordedCall): void {
    const list = this.#teamStarts.get(agentId) ?? [];
    list.push({ key, call: { ...call, at: call.at ?? Date.now() } });
    // A turn ends within hours; an agent never has this many team starts waiting.
    this.#teamStarts.set(agentId, list.slice(-50));
  }

  /** The calls of a turn, as they were made. */
  calls(agentId: string, turnId: string): HxRecordedCall[] {
    const id = key(agentId, turnId);
    return [...(this.#pending.get(id) ?? this.#stored(id) ?? { calls: [] }).calls];
  }

  /**
   * At the end of a turn: when a saved workflow would have a step, the chat gets the line that offers
   * it. Returns the number of steps; 0 offers nothing.
   */
  turnEnded(agentId: string, turnId: string): number {
    const id = key(agentId, turnId);
    const starts = this.#teamStarts.get(agentId) ?? [];
    const mine = starts.filter((start) => start.key.includes(`:${turnId}:`));
    if (mine.length > 0) {
      this.#teamStarts.set(
        agentId,
        starts.filter((start) => !mine.includes(start)),
      );
      const current = this.#pending.get(id) ?? this.#stored(id) ?? { agentId, turnId, calls: [] };
      const merged = [...current.calls, ...mine.map((start) => start.call)]
        .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
        .slice(0, HX_TURN_TOOLS_MAX);
      const record = { agentId, turnId, calls: merged };
      this.#pending.set(id, record);
      this.#write(id, record);
    }
    const calls = this.calls(agentId, turnId);
    this.#pending.delete(id);
    const steps = hxTurnWorkflowGraph(agentId, calls, { confirm: () => "" }).steps;
    if (steps > 0) this.#line?.(agentId, { turnId, steps });
    return steps;
  }

  /** Saves the turn as a workflow. */
  async save(agentId: string, turnId: string, now = new Date()): Promise<HxSaveTurnResult> {
    const host = this.#host;
    if (!host) throw new Error(sourceText("error.workflow.hxStepUnavailable"));
    const calls = this.calls(agentId, turnId);
    const texts = host.texts();
    const built = hxTurnWorkflowGraph(agentId, calls, texts);
    if (built.steps === 0) throw new Error(sourceText("error.workflow.hxTurnNothing"));
    const title = texts.title(host.agentName(agentId) ?? "", now.toISOString().slice(0, 16).replace("T", " "));
    const created = await host.create({ title, graph: built.graph });
    this.#line?.(agentId, { turnId, steps: built.steps, workflowId: created.workflowId, saved: true });
    return { workflowId: created.workflowId, title: created.title, steps: built.steps };
  }

  #stored(id: string): TurnRecord | null {
    const host = this.#host;
    if (!host) return null;
    try {
      const row = host.connection().prepare("SELECT value FROM hx_meta WHERE key = ?").get(id);
      return isDynamicRecord(row) ? readRecord(row.value) : null;
    } catch {
      return null;
    }
  }

  #write(id: string, record: TurnRecord): void {
    const host = this.#host;
    if (!host) return;
    try {
      const db = host.connection();
      const at = new Date();
      db.prepare(
        `INSERT INTO hx_meta (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(id, JSON.stringify(record), at.toISOString());
      db.prepare("DELETE FROM hx_meta WHERE key LIKE 'turn-tools:%' AND updated_at < ?").run(
        new Date(at.getTime() - KEEP_MS).toISOString(),
      );
    } catch {
      // The pending list still has the calls while HXBot runs.
    }
  }
}

export const hxTurnTools = new HxTurnTools();
