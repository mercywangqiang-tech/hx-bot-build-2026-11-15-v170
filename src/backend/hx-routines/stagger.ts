/**
 * HXBot (v1.7.5, CONC-14): routines that come due in the same minute start spread over that minute.
 *
 * With two or more due in one minute, each gets a fixed delay from the hash of its id, 0 to 60 seconds and
 * at most 10% of its interval, and the order they came due in stays: the delays are sorted and given out in
 * that order, and a later one never starts before an earlier one. A routine that is due alone starts at once.
 */

import type { RoutineSchedule } from "@hxbot/contracts/ipc";
import { nextRoutineOccurrence } from "@hxbot/team-client/routine-schedule";

export const HX_STAGGER_WINDOW_MS = 60_000;

export interface HxStaggerDue {
  routineId: string;
  nextRunAt: string;
  schedule: RoutineSchedule;
  timezone: string;
}

/** FNV-1a, 32 bits: the same id gives the same delay on every computer and every start. */
export function hxStaggerHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function intervalMs(due: HxStaggerDue): number {
  if (due.schedule.kind === "once") return Number.POSITIVE_INFINITY;
  try {
    const at = new Date(due.nextRunAt);
    return nextRoutineOccurrence(due.schedule, due.timezone, at).getTime() - at.getTime();
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** The delay of each routine of `dues`, in the order given (the order they came due in). */
export function hxStaggerDelays(dues: readonly HxStaggerDue[]): Map<string, number> {
  const delays = new Map<string, number>();
  const byMinute = new Map<number, HxStaggerDue[]>();
  for (const due of dues) {
    const minute = Math.floor(Date.parse(due.nextRunAt) / 60_000);
    byMinute.set(minute, [...(byMinute.get(minute) ?? []), due]);
  }
  for (const group of byMinute.values()) {
    if (group.length < 2) {
      for (const due of group) delays.set(due.routineId, 0);
      continue;
    }
    const raw = group.map((due) => hxStaggerHash(due.routineId) % HX_STAGGER_WINDOW_MS).sort((a, b) => a - b);
    const given = group.map((due, index) => Math.min(raw[index] ?? 0, Math.floor(intervalMs(due) * 0.1)));
    // A cap can only make a delay shorter: walk back so that no later routine starts before an earlier one.
    for (let index = given.length - 2; index >= 0; index -= 1) {
      given[index] = Math.min(given[index] ?? 0, given[index + 1] ?? 0);
    }
    for (const [index, due] of group.entries()) delays.set(due.routineId, given[index] ?? 0);
  }
  return delays;
}
