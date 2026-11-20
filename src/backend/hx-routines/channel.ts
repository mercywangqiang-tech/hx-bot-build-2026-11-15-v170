/**
 * HXBot (v1.7.5, RTN-02, RTN-03, RTN-06, MIG-03, CONC-14): what a channel routine shares with an agent
 * routine. The channel scheduler plans a due trigger with the same rules (due-apply.ts), asks for the
 * same yes (confirm.ts), and reads back what waits. The question of a channel routine is not a message in
 * the channel: a channel's messages reach every member over the team wire. It shows in the routine list
 * of this computer, with a desktop notification.
 */

import type { DatabaseSync } from "node:sqlite";
import type { ChannelRoutine, ChannelRoutineRun, HxRoutineFlags, HxRoutineWaiting } from "@hxbot/contracts/ipc";
import { sourceText } from "@hxbot/i18n/source";
import { Effect } from "effect";
import type { ChannelRoutineScheduler } from "../channel-routine-scheduler";
import type { ChannelRoutineStore } from "../channel-routine-store";
import { hxChannelRoutineConfirm } from "./confirm";
import type { HxMissedBatch } from "./due";
import type { HxDueOwner } from "./due-apply";

/** The owner of channel routines, for due-apply.ts. */
export function hxChannelDueOwner(store: ChannelRoutineStore): HxDueOwner<ChannelRoutine, ChannelRoutineRun> {
  return {
    kind: "channel",
    ownerId: (routine) => routine.channelId,
    confirm: hxChannelRoutineConfirm,
    createRun: (routine, triggerId, scheduledFor) => store.createRun(routine, triggerId, "scheduled", scheduledFor),
    recordNotRun: (routine, triggerId, record, detail) => store.hxRecordNotRun(routine, triggerId, record, detail),
    noteRun: (runId, routineId, change) => store.hxNoteRun(runId, routineId, change),
  };
}

/** The run row of a yes, with the yes and the occurrences it makes up for. */
export function hxChannelStartConfirmed(
  store: ChannelRoutineStore,
  input: {
    routine: ChannelRoutine;
    triggerId: string | null;
    scheduledFor: string;
    confirmationId: string;
    catchUp: HxMissedBatch | null;
  },
): ChannelRoutineRun {
  const current = store.get(input.routine.channelId, input.routine.id);
  if (!current?.active) throw new Error(sourceText("error.backend.routineGone"));
  const run = store.createRun(current, input.triggerId, "scheduled", input.scheduledFor);
  const at = new Date().toISOString();
  const catchUp = input.catchUp;
  store.hxNoteRun(run.id, current.id, (detail) => ({
    ...detail,
    confirmed: { confirmationId: input.confirmationId, at },
    ...(catchUp
      ? { catchUp: { total: catchUp.total, from: catchUp.from.toISOString(), until: catchUp.until.toISOString() } }
      : {}),
  }));
  return run;
}

/**
 * RTN-06: what a channel routine has waiting, read back from the store: runs not issued or not taken
 * by a member yet, and questions that wait for the yes. The run that works now, if any, apart. Never
 * throws: a failed read leaves the routine as it is.
 */
export function hxChannelWithQueue<T extends { id: string; hx?: HxRoutineFlags | undefined }>(
  routine: T,
  activeRuns: readonly ChannelRoutineRun[],
  waitingCards: () => HxRoutineWaiting[],
): T {
  try {
    const waiting = waitingCards();
    let queued = waiting.length;
    let running: ChannelRoutineRun | null = null;
    for (const run of activeRuns) {
      if (run.status === "queued") queued += 1;
      else running ??= run;
    }
    return {
      ...routine,
      hx: {
        ...routine.hx,
        ...(waiting.length > 0 ? { waiting } : {}),
        queue: {
          queued,
          running: running ? { runId: running.id, status: running.status, deliveryId: null } : null,
        },
      },
    };
  } catch {
    return routine;
  }
}

/**
 * Attaches the questions of channel routines. A question shows in the routine list (the list reloads on
 * `changed`) and as a desktop notification when it is new; the answer comes from the list.
 */
export function hxAttachChannelConfirm(
  scheduler: ChannelRoutineScheduler,
  deps: {
    connection: () => DatabaseSync;
    changed: (channelId: string) => void;
    notify: (title: string, body: string) => void;
  },
): void {
  hxChannelRoutineConfirm.attach({
    connection: deps.connection,
    routine: (channelId, routineId) => scheduler.hxRoutine(channelId, routineId),
    writeCard: (channelId, _cardId, card, settled) => {
      if (!settled) deps.notify(card.title, [card.note, card.actions].filter((line) => line.length > 0).join("\n"));
      deps.changed(channelId);
    },
    startRun: (input) => Effect.runPromise(scheduler.hxStartConfirmedRun(input)),
    recordSkipped: (input) => scheduler.hxRecordSkipped(input),
  });
}
