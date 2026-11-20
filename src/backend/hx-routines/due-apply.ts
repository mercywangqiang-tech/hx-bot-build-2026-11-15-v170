/**
 * HXBot (v1.7.5): carries out the plan of one due trigger of a routine (see due.ts) inside the
 * scheduler's step: the records of missed and skipped occurrences, the run, or the question that waits
 * for the person's yes. The trigger moves after this, as it always did. An agent's routine and a
 * channel's routine take the same path; each scheduler passes its own owner.
 *
 * A run that needs the yes never starts without it: when nothing can ask (no confirmation service is
 * attached), the occurrence is skipped with the reason "unasked".
 */

import type { DatabaseSync } from "node:sqlite";
import type { Routine, RoutineMissedPolicy, RoutineRun, RoutineSchedule } from "@hxbot/contracts/ipc";
import { v59ExternalActionKinds } from "../database/hx-routine-detail-schema";
import { type HxConfirmRoutine, type HxRoutineConfirm, hxRoutineConfirm } from "./confirm";
import { type HxOwnerKind, type HxRunDetail, hxReadRoutineDetail, hxWriteRoutineDetail } from "./detail";
import { type HxDuePlan, type HxMissedBatch, hxPlanDue } from "./due";

/** What the plan reads of a routine. */
export interface HxDueRoutine extends HxConfirmRoutine {
  trigger: { id: string; nextRunAt: string; schedule: RoutineSchedule };
  missedPolicy?: RoutineMissedPolicy;
}

/** A record of occurrences that did not run, as the run history keeps it. */
interface HxNotRunRecord {
  scheduledFor: string;
  until: string | null;
  count: number;
}

/** One owner kind's stores and confirmation service. */
export interface HxDueOwner<R extends HxDueRoutine, Run extends { id: string }> {
  kind: HxOwnerKind;
  ownerId(routine: R): string;
  confirm: HxRoutineConfirm<R>;
  createRun(routine: R, triggerId: string | null, scheduledFor: string): Run;
  recordNotRun(routine: R, triggerId: string | null, record: HxNotRunRecord, detail: HxRunDetail): void;
  noteRun(runId: string, routineId: string, change: (detail: HxRunDetail) => HxRunDetail): void;
}

/** The agent routine store's part of the owner. */
export interface HxDueStore {
  createRun(
    routine: Pick<Routine, "id" | "agentId" | "name" | "instruction">,
    triggerId: string | null,
    start: "scheduled",
    scheduledFor: string,
  ): RoutineRun;
  hxRecordNotRun(
    routine: Pick<Routine, "id" | "agentId" | "name" | "instruction">,
    triggerId: string | null,
    record: HxNotRunRecord,
    detail: HxRunDetail,
  ): void;
  hxNoteRun(runId: string, routineId: string, change: (detail: HxRunDetail) => HxRunDetail): void;
}

/** The owner of agent routines. */
export function hxAgentDueOwner(store: HxDueStore): HxDueOwner<Routine, RoutineRun> {
  return {
    kind: "agent",
    ownerId: (routine) => routine.agentId,
    confirm: hxRoutineConfirm,
    createRun: (routine, triggerId, scheduledFor) => store.createRun(routine, triggerId, "scheduled", scheduledFor),
    recordNotRun: (routine, triggerId, record, detail) => store.hxRecordNotRun(routine, triggerId, record, detail),
    noteRun: (runId, routineId, change) => store.hxNoteRun(runId, routineId, change),
  };
}

/** The external actions that an instruction asks for. The words of migration 59 for now. */
function hxExternalActions(instruction: string) {
  return v59ExternalActionKinds(instruction);
}

export function hxDueFor(
  connection: DatabaseSync,
  kind: HxOwnerKind,
  routine: HxDueRoutine,
  now: Date,
  flags: { live: boolean; limited: boolean },
): HxDuePlan {
  const detail = hxReadRoutineDetail(connection, kind, routine.id);
  return hxPlanDue({
    schedule: routine.trigger.schedule,
    timezone: routine.timezone,
    firstDue: new Date(routine.trigger.nextRunAt),
    now,
    missedPolicy: routine.missedPolicy ?? "skip",
    live: flags.live,
    limited: flags.limited,
    confirmEach: detail?.confirm?.mode === "each",
    actions: hxExternalActions(routine.instruction),
    pendingCatchUp: detail?.pendingCatchUp,
  });
}

function batchDetail(batch: HxMissedBatch): NonNullable<HxRunDetail["catchUp"]> {
  return { total: batch.total, from: batch.from.toISOString(), until: batch.until.toISOString() };
}

/** Asks for the yes, or, when nothing can ask, records the occurrence as skipped. Never runs it. */
function askOrSkip<R extends HxDueRoutine, Run extends { id: string }>(
  owner: HxDueOwner<R, Run>,
  routine: R,
  ask: { scheduledFor: Date; reason: "each" | "catch-up"; catchUp: HxMissedBatch | null },
  now: Date,
): void {
  const asked = owner.confirm.attached
    ? owner.confirm.request({
        routine,
        ownerId: owner.ownerId(routine),
        triggerId: routine.trigger.id,
        scheduledFor: ask.scheduledFor,
        reason: ask.reason,
        actions: hxExternalActions(routine.instruction),
        catchUp: ask.catchUp,
        now,
      })
    : null;
  if (asked !== null) return;
  owner.recordNotRun(
    routine,
    routine.trigger.id,
    { scheduledFor: ask.scheduledFor.toISOString(), until: null, count: 1 },
    { skip: { reason: "unasked", at: now.toISOString() } },
  );
}

/** The run to start, or null: nothing runs now, or a question waits for the yes. */
export function hxApplyDue<R extends HxDueRoutine, Run extends { id: string }>(
  owner: HxDueOwner<R, Run>,
  connection: DatabaseSync,
  routine: R,
  plan: HxDuePlan,
  now: Date,
): Run | null {
  const triggerId = routine.trigger.id;
  if (plan.missed) {
    const { missed } = plan;
    // The wire count names the occurrences that did not run; the one that runs once is not one of them.
    const runsTheNewest = plan.run !== null && plan.run.scheduledFor.getTime() === missed.until.getTime();
    owner.recordNotRun(
      routine,
      triggerId,
      {
        scheduledFor: missed.from.toISOString(),
        until: missed.until.toISOString(),
        count: Math.max(1, runsTheNewest ? missed.total - 1 : missed.total),
      },
      {
        missed: {
          total: missed.total,
          from: missed.from.toISOString(),
          until: missed.until.toISOString(),
          handled: missed.handled,
          while: "asleep",
        },
      },
    );
  }
  const detail = hxReadRoutineDetail(connection, owner.kind, routine.id);
  if (detail?.pendingCatchUp) {
    hxWriteRoutineDetail(connection, owner.kind, routine.id, ({ pendingCatchUp: _done, ...rest }) => rest);
  }
  if (plan.skipped) {
    owner.recordNotRun(
      routine,
      triggerId,
      { scheduledFor: plan.skipped.scheduledFor.toISOString(), until: null, count: 1 },
      { skip: { reason: plan.skipped.reason, at: now.toISOString() } },
    );
    return null;
  }
  const run = plan.run;
  if (!run) return null;
  if (run.confirm) {
    askOrSkip(owner, routine, { scheduledFor: run.scheduledFor, reason: run.confirm, catchUp: run.catchUp }, now);
    return null;
  }
  const created = owner.createRun(routine, triggerId, run.scheduledFor.toISOString());
  if (run.catchUp) {
    const catchUp = batchDetail(run.catchUp);
    owner.noteRun(created.id, routine.id, (current) => ({ ...current, catchUp }));
  }
  return created;
}

/**
 * MIG-03: a one-time routine that asks before each run asks for its one run too. True when it asked
 * (or, with nothing to ask, recorded the skip): the caller then starts nothing.
 */
export function hxOnceNeedsYes<R extends HxDueRoutine, Run extends { id: string }>(
  owner: HxDueOwner<R, Run>,
  connection: DatabaseSync,
  routine: R,
  now: Date,
): boolean {
  if (hxReadRoutineDetail(connection, owner.kind, routine.id)?.confirm?.mode !== "each") return false;
  askOrSkip(owner, routine, { scheduledFor: new Date(routine.trigger.nextRunAt), reason: "each", catchUp: null }, now);
  return true;
}
