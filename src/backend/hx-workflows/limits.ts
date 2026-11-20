/**
 * HXBot (v1.7.5, RTN-07): the limits of one workflow run. By default a loop takes at most 10 passes, a
 * run at most 100 steps, and its loops at most 600 seconds. The advanced setting of a workflow raises or
 * lowers them, always to a finite value (`HX_WORKFLOW_MAX_LIMITS`).
 *
 * - A pass is a node that a loop edge starts again: its attempts that the run itself made, after the
 *   first. A retry by a person is not a pass.
 * - The steps are every attempt the run made or a person retried, apart from the answers it reused and
 *   the steps it skipped.
 * - The time is counted from the first pass of a loop, apart from the time an approval waits for a
 *   person. A run without a loop has no time limit, as before: an agent step may work for many minutes.
 *
 * At a limit the run writes "over the limit" and starts no new step. Its open steps stop; a call that
 * started outside HXBot and has no answer is "not known" (steps.ts), and a continue reads it back. The
 * counts belong to the run, so a retry in it meets the same limit again.
 */

import type { DatabaseSync } from "node:sqlite";
import { HX_WORKFLOW_DEFAULT_LIMITS, type HxWorkflowLimits, isHxWorkflowLimits } from "@hxbot/contracts/hx-workflows";
import { type WorkflowGraph, workflowLoopEdges } from "@hxbot/contracts/ipc";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { sourceText } from "@hxbot/i18n/source";

const KEY = (workflowId: string) => `workflow-limits:${workflowId}`.slice(0, 128);

export function hxWorkflowLimitsOf(db: DatabaseSync, workflowId: string): HxWorkflowLimits {
  try {
    const row = db.prepare("SELECT value FROM hx_meta WHERE key = ?").get(KEY(workflowId));
    if (!isDynamicRecord(row) || typeof row.value !== "string") return HX_WORKFLOW_DEFAULT_LIMITS;
    const parsed = JSON.parse(row.value);
    return isHxWorkflowLimits(parsed) ? parsed : HX_WORKFLOW_DEFAULT_LIMITS;
  } catch {
    return HX_WORKFLOW_DEFAULT_LIMITS;
  }
}

/** Saves the advanced limits of a workflow; null goes back to the defaults. */
function hxSetWorkflowLimits(
  db: DatabaseSync,
  workflowId: string,
  limits: HxWorkflowLimits | null,
  at = new Date().toISOString(),
): HxWorkflowLimits {
  if (limits === null) {
    db.prepare("DELETE FROM hx_meta WHERE key = ?").run(KEY(workflowId));
    return HX_WORKFLOW_DEFAULT_LIMITS;
  }
  if (!isHxWorkflowLimits(limits)) throw new Error("Invalid workflow limits.");
  db.prepare(
    `INSERT INTO hx_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(KEY(workflowId), JSON.stringify(limits), at);
  return limits;
}

export type HxLimitHit = { what: "loops" | "steps" | "seconds"; limit: number };

interface StepRow {
  nodeId: string;
  requestId: string;
  status: string;
  kind: string;
  createdAt: number;
  endedAt: number | null;
}

function stepRows(db: DatabaseSync, runId: string): StepRow[] {
  return db
    .prepare(
      `SELECT node_id, request_id, status, kind, created_at, ended_at FROM workflow_steps
       WHERE run_id = ? ORDER BY created_at, step_id`,
    )
    .all(runId)
    .flatMap((row) =>
      isDynamicRecord(row) && typeof row.node_id === "string" && typeof row.request_id === "string"
        ? [
            {
              nodeId: row.node_id,
              requestId: row.request_id,
              status: String(row.status),
              kind: String(row.kind),
              createdAt: Date.parse(String(row.created_at)),
              endedAt: typeof row.ended_at === "string" ? Date.parse(row.ended_at) : null,
            },
          ]
        : [],
    );
}

/** The attempt number of a step that the run made itself (`<run>:<node>:<n>`), or null. */
function ownAttempt(row: StepRow, runId: string): number | null {
  const prefix = `${runId}:${row.nodeId}:`;
  if (!row.requestId.startsWith(prefix)) return null;
  const rest = row.requestId.slice(prefix.length);
  return /^\d+$/u.test(rest) ? Number(rest) : null;
}

/** What the run has used of its limits. */
function hxWorkflowUsage(
  db: DatabaseSync,
  run: { id: string; graph: WorkflowGraph },
  now: number,
): {
  loops: number;
  steps: number;
  seconds: number;
  passes: ReadonlyMap<string, number>;
  targets: ReadonlySet<string>;
} {
  const rows = stepRows(db, run.id);
  const loops = workflowLoopEdges(run.graph.nodes, run.graph.edges);
  const targets = new Set(run.graph.edges.filter((edge) => loops.has(edge.id)).map((edge) => edge.to));
  const steps = rows.filter((row) => row.status !== "skipped" && !row.requestId.endsWith(":reused")).length;
  const passes = new Map<string, number>();
  let firstPass: number | null = null;
  for (const row of rows) {
    if (!targets.has(row.nodeId)) continue;
    const attempt = ownAttempt(row, run.id);
    if (attempt === null) continue;
    // Each pass of the loop counts, the first one too: a loop of at most 10 runs its body 10 times.
    passes.set(row.nodeId, (passes.get(row.nodeId) ?? 0) + 1);
    // The time of the loops counts from the first time the loop goes back.
    if (attempt >= 2 && (firstPass === null || row.createdAt < firstPass)) firstPass = row.createdAt;
  }
  let seconds = 0;
  if (firstPass !== null) {
    let waited = 0;
    for (const row of rows) {
      if (row.kind !== "approval") continue;
      const from = Math.max(row.createdAt, firstPass);
      const until = row.endedAt ?? now;
      if (until > from) waited += until - from;
    }
    seconds = Math.max(0, (now - firstPass - waited) / 1000);
  }
  return { loops: Math.max(0, ...passes.values()), steps, seconds, passes, targets };
}

/**
 * The limit the run reaches with the steps a pass is about to start, or null: a run stops before the
 * step that would go over, not after it. `starts` are the nodes of those steps with the attempt each
 * gets.
 */
export function hxLimitReached(
  db: DatabaseSync,
  run: { id: string; graph: WorkflowGraph },
  limits: HxWorkflowLimits,
  now: number,
  starts: ReadonlyArray<{ nodeId: string; attempt: number; skip: boolean }>,
): HxLimitHit | null {
  const usage = hxWorkflowUsage(db, run, now);
  const adding = starts.filter((start) => !start.skip).length;
  if (usage.steps + adding > limits.steps) return { what: "steps", limit: limits.steps };
  for (const start of starts) {
    if (start.skip || start.attempt < 2 || !usage.targets.has(start.nodeId)) continue;
    if ((usage.passes.get(start.nodeId) ?? 0) + 1 > limits.loops) return { what: "loops", limit: limits.loops };
  }
  if (usage.seconds > limits.seconds) return { what: "seconds", limit: limits.seconds };
  return null;
}

let limitsConnection: (() => DatabaseSync) | null = null;

/** The application attaches the database for the limits that the settings read and save. */
export function hxAttachWorkflowLimits(connection: (() => DatabaseSync) | null): void {
  limitsConnection = connection;
}

function attachedDb(workflowId: string): DatabaseSync {
  const db = limitsConnection?.();
  if (!db) throw new Error(sourceText("error.workflow.hxStepUnavailable"));
  const row = db.prepare("SELECT 1 AS found FROM workflows WHERE workflow_id = ?").get(workflowId);
  if (!isDynamicRecord(row)) throw new Error(sourceText("error.workflow.missing"));
  return db;
}

export function hxWorkflowLimitsFor(workflowId: string): HxWorkflowLimits {
  return hxWorkflowLimitsOf(attachedDb(workflowId), workflowId);
}

export function hxSetWorkflowLimitsFor(workflowId: string, limits: HxWorkflowLimits | null): HxWorkflowLimits {
  return hxSetWorkflowLimits(attachedDb(workflowId), workflowId, limits);
}
