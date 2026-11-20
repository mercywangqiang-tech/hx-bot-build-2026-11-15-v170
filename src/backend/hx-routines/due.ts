/**
 * HXBot (v1.7.5): what one due trigger of a routine becomes, decided before anything is written.
 *
 * - RTN-03: a routine keeps one run at a time. An occurrence that comes due while the last run still
 *   works is not dropped in silence: it leaves a "skipped (the last run is still running)" record. So
 *   does one that a spent plan drops for a routine set to skip.
 * - RTN-02: the occurrences that came due while the computer slept are counted, with their time span,
 *   and handled by the routine's policy: skip all of them, or run once. A catch-up run that sends,
 *   posts, pays or deletes waits for the person's yes this time. There is no "run all of them".
 * - MIG-03: a routine that asks before each run waits for the yes every time.
 *
 * An occurrence is late (missed) when it is handled more than `HX_MISSED_GRACE_MS` after its time:
 * the timer fires on time while the computer is awake, so only a sleep or a stopped process delays it
 * that much. One within the grace runs as it always did.
 */

import type { RoutineMissedPolicy, RoutineSchedule } from "@hxbot/contracts/ipc";
import { nextRoutineOccurrence } from "@hxbot/team-client/routine-schedule";
import type { HxActionKind, HxSkipReason } from "./detail";

export const HX_MISSED_GRACE_MS = 5 * 60_000;
/** The most occurrences that one plan walks; a longer sleep counts "more than this". */
export const HX_MISSED_WALK_LIMIT = 10_000;

export interface HxDueInput {
  schedule: RoutineSchedule;
  timezone: string;
  /** The trigger's next run time: the first occurrence that came due. */
  firstDue: Date;
  now: Date;
  missedPolicy: RoutineMissedPolicy;
  /** An earlier run of the routine still holds its delivery. */
  live: boolean;
  /** A spent plan holds the agent and the routine is set to skip then. */
  limited: boolean;
  /** MIG-03: the routine asks before each run. */
  confirmEach: boolean;
  /** The external actions the instruction asks for. */
  actions: readonly HxActionKind[];
  /** A catch-up that HXBot's start kept due (the routine is set to run once). */
  pendingCatchUp?: { scheduledFor: string; total: number; from: string; until: string } | undefined;
}

export interface HxMissedBatch {
  /** Every occurrence that came due late, the one that runs included. */
  total: number;
  /** True when the walk stopped at the limit: there were more than `total`. */
  truncated: boolean;
  from: Date;
  until: Date;
  handled: "skip" | "run-once";
}

export interface HxDuePlan {
  /** Where the trigger moves to. */
  nextRunAt: Date;
  /** The occurrence that runs, or null. */
  run: { scheduledFor: Date; catchUp: HxMissedBatch | null; confirm: "each" | "catch-up" | null } | null;
  /** Late occurrences that do not run, as one record. */
  missed: HxMissedBatch | null;
  /** An occurrence that would run but is skipped, as one record. */
  skipped: { scheduledFor: Date; reason: HxSkipReason } | null;
}

function occurrences(input: HxDueInput): { list: Date[]; next: Date; truncated: boolean } {
  const list = [input.firstDue];
  let next = nextRoutineOccurrence(input.schedule, input.timezone, input.firstDue);
  while (next.getTime() <= input.now.getTime()) {
    if (list.length >= HX_MISSED_WALK_LIMIT) {
      // Past the limit only the newest occurrence matters: it is the one that runs.
      let last = next;
      let after = nextRoutineOccurrence(input.schedule, input.timezone, last);
      while (after.getTime() <= input.now.getTime()) {
        last = after;
        after = nextRoutineOccurrence(input.schedule, input.timezone, last);
      }
      list.push(last);
      return { list, next: after, truncated: true };
    }
    list.push(next);
    next = nextRoutineOccurrence(input.schedule, input.timezone, next);
  }
  return { list, next, truncated: false };
}

export function hxPlanDue(input: HxDueInput): HxDuePlan {
  const { list, next, truncated } = occurrences(input);
  const newest = list[list.length - 1] ?? input.firstDue;
  const late = list.filter((at) => input.now.getTime() - at.getTime() > HX_MISSED_GRACE_MS);
  const onTime = late.length < list.length ? newest : null;

  const pending = input.pendingCatchUp;
  const catchUpKept = pending !== undefined && pending.scheduledFor === input.firstDue.toISOString();

  let run: { scheduledFor: Date; catchUp: HxMissedBatch | null } | null;
  let missed: HxMissedBatch | null = null;
  if (catchUpKept && pending) {
    // The start already recorded the missed ones and kept this one due to run once.
    run = {
      scheduledFor: newest,
      catchUp: {
        total: pending.total,
        truncated: false,
        from: new Date(pending.from),
        until: new Date(pending.until),
        handled: "run-once",
      },
    };
  } else if (late.length === 0) {
    run = { scheduledFor: newest, catchUp: null };
  } else {
    const first = late[0] ?? input.firstDue;
    const last = late[late.length - 1] ?? input.firstDue;
    const batch: HxMissedBatch = {
      total: late.length,
      truncated,
      from: first,
      until: last,
      handled: input.missedPolicy,
    };
    if (input.missedPolicy === "skip") {
      missed = batch;
      run = onTime ? { scheduledFor: onTime, catchUp: null } : null;
    } else {
      // Run once: the newest occurrence runs, and it makes up for the late ones.
      missed = late.length > 1 || onTime ? batch : null;
      run = { scheduledFor: newest, catchUp: batch };
    }
  }

  if (run && (input.live || input.limited)) {
    return {
      nextRunAt: next,
      run: null,
      missed,
      skipped: { scheduledFor: run.scheduledFor, reason: input.live ? "previous-running" : "plan-limit" },
    };
  }
  const confirm =
    run === null ? null : input.confirmEach ? "each" : run.catchUp && input.actions.length > 0 ? "catch-up" : null;
  return { nextRunAt: next, run: run ? { ...run, confirm } : null, missed, skipped: null };
}
