import { randomUUID } from "node:crypto";
import type {
  ChannelRoutine,
  ChannelRoutineRun,
  ChannelRoutineRunStatus,
  ChannelTask,
  CreateChannelRoutineInput,
  DeleteChannelRoutineInput,
  ListChannelRoutineRunsInput,
  TestChannelRoutineInput,
  UpdateChannelRoutineInput,
} from "@hxbot/contracts/ipc";
import { sourceText } from "@hxbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import type { RoutineTriggerAccess } from "./agent/routine-scheduler";
import { ChannelRoutineStore } from "./channel-routine-store";
import type { ChannelService } from "./channel-service";
import { causeHelpers } from "./effect-boundary";
import { hxChannelDueOwner, hxChannelStartConfirmed, hxChannelWithQueue } from "./hx-routines/channel";
import { hxChannelRoutineConfirm } from "./hx-routines/confirm";
import { hxApplyDue, hxDueFor, hxOnceNeedsYes } from "./hx-routines/due-apply";
import { hxStaggerDelays } from "./hx-routines/stagger";
import { hxRoutineZones } from "./hx-routines/zone";
import { recordRestartActivity } from "./restart-activity";
import type { OwnedRoutineRecord, ReceivedWebhookEvent, RoutineHoldWindow, RoutineRecordInput } from "./routine-store";
import type { RoutineDueSource } from "./routine-timer";

export interface ChannelRoutineHooks {
  changed(channelId: string): void;
  emitError(code: string, error: unknown): void;
  excludedChannels(): ReadonlySet<string>;
  /** Whether a spent provider plan holds the queue of the channel's lead, who takes each routine request. */
  usageLimited(channelId: string): boolean;
}

export interface ChannelRoutineSchedulerOptions {
  channels: ChannelService;
  hooks: ChannelRoutineHooks;
}

/**
 * The task that holds this one, if there is one: the first dependency of the branch below it that
 * failed or that a human has to unblock. A dependency of a dependency counts, because the branch
 * moves again only from its own root.
 */
function stoppedBlocker(tasks: ChannelTask[], task: ChannelTask, seen = new Set<string>()): ChannelTask | null {
  for (const id of task.dependencies) {
    if (seen.has(id)) continue;
    seen.add(id);
    const dependency = tasks.find((item) => item.id === id);
    if (!dependency) continue;
    if (dependency.state === "failed" || dependency.state === "paused") return dependency;
    const deeper = stoppedBlocker(tasks, dependency, seen);
    if (deeper) return deeper;
  }
  return null;
}

/**
 * Reads the run's status out of the tasks its request produced. Pure, because that is what makes a
 * restart free: the status is a function of durable rows, so a fresh scheduler over the same
 * database reaches the same answer with no in-memory state.
 *
 * `hasAssignment` separates "nobody has picked this up yet" from "a member is on it": an assignment
 * is a durable row, so the difference survives a restart too.
 */
function channelRunStatusForTasks(
  tasks: ChannelTask[],
  hasAssignment: boolean,
): { status: ChannelRoutineRunStatus; error: string | null } {
  // A later human message can absorb the routine's open task and take its request id with it, and a
  // deleted channel takes every task. Neither is a failure of the routine.
  if (!tasks.length) return { status: "cancelled", error: null };
  if (tasks.some((task) => task.state === "running")) return { status: "running", error: null };
  const open = tasks.filter((task) => task.state === "queued" || task.state === "waiting");
  if (open.length) {
    // A task starts only when every task it delegated is completed, so an open task behind one
    // that stopped is not work in progress: nothing but a human moves it again. Reporting it as
    // queued would hide the reason in the run history while the run cannot advance.
    const blocked = open.map((task) => stoppedBlocker(tasks, task));
    const free = blocked.some((blocker) => !blocker);
    if (free) return { status: hasAssignment ? "running" : "queued", error: null };
    const blocker = blocked.find((task) => task?.state === "failed") ?? blocked[0];
    if (blocker)
      return blocker.state === "failed"
        ? { status: "failed", error: blocker.error }
        : { status: "needs-attention", error: blocker.error };
  }
  const failed = tasks.find((task) => task.state === "failed");
  if (failed) return { status: "failed", error: failed.error };
  // In a channel, `paused` always means a human has to act: a routing question, an unavailable
  // owner, the assignment limit, an unconfirmed turn, or an explicit Stop.
  const paused = tasks.find((task) => task.state === "paused");
  if (paused) return { status: "needs-attention", error: paused.error };
  // A person cancelled the run from its stopped task: it did not succeed.
  if (tasks.some((task) => task.parentTaskId === null && task.state === "cancelled"))
    return { status: "cancelled", error: null };
  // Every task is completed or cancelled. This includes the lead judging that no work was needed.
  return { status: "succeeded", error: null };
}

/**
 * Owns standing instructions attached to a channel. A fire is not a private path into the channel:
 * it is a `request` command, so it inherits the per-channel serialisation, the retry receipt and
 * the archived guard that every other channel command already has.
 */
export class ChannelRoutineScheduler implements RoutineDueSource {
  readonly #channels: ChannelService;
  readonly #hooks: ChannelRoutineHooks;
  readonly #routines: ChannelRoutineStore;

  constructor(options: ChannelRoutineSchedulerOptions) {
    this.#channels = options.channels;
    this.#hooks = options.hooks;
    this.#routines = new ChannelRoutineStore(options.channels.store.database);
  }

  list(channelId: string): ChannelRoutine[] {
    return this.#routines.list(this.#requireChannel(channelId)).map((routine) => this.#hxWithQueue(routine));
  }

  /** HXBot (v1.7.5, RTN-06, RTN-02): a routine read back with what it has waiting and its open questions. */
  #hxWithQueue<T extends { id: string; hx?: ChannelRoutine["hx"] }>(
    routine: T & { channelId?: string; ownerId?: string },
  ): T {
    const channelId = routine.channelId ?? routine.ownerId;
    if (!channelId) return routine;
    return hxChannelWithQueue(routine, this.#routines.activeRuns(channelId, routine.id), () =>
      hxChannelRoutineConfirm.waitingCards(channelId, routine.id),
    );
  }

  /**
   * Whether any channel routine run is executing right now. Scheduled future runs do not count:
   * they resume from durable rows after a restart. See RoutineScheduler.hasActiveRuns for why the
   * executing case is still worth naming.
   */
  hasActiveRuns(): boolean {
    for (const channelId of this.#channels.store.ids()) {
      for (const routine of this.#routines.listRecords(channelId)) {
        if (this.#routines.activeRuns(channelId, routine.id).length > 0) return true;
      }
    }
    return false;
  }

  listRuns(input: ListChannelRoutineRunsInput, withSkipped = false): ChannelRoutineRun[] {
    return this.#routines.listRuns(
      this.#requireChannel(input.channelId),
      input.routineId,
      input.limit ?? 50,
      withSkipped,
    );
  }

  create(input: CreateChannelRoutineInput): ChannelRoutine {
    // HXBot (v1.7.5, RTN-01): an IANA zone. The editor registers the first one a person chooses.
    const timezone = hxRoutineZones.checkSaved(input.timezone);
    const routine = this.#routines.create({ ...input, timezone, channelId: this.#requireChannel(input.channelId) });
    this.#changed(routine.channelId);
    return routine;
  }

  update(input: UpdateChannelRoutineInput): ChannelRoutine {
    const routine = this.#routines.update({ ...input, channelId: this.#requireChannel(input.channelId) });
    // HXBot (v1.7.5, RTN-06): a paused routine asks nothing more.
    if (!routine.active) hxChannelRoutineConfirm.cancelFor(routine.channelId, routine.id);
    this.#changed(routine.channelId);
    return routine;
  }

  /** Routines of every trigger kind, for the events surface. */
  listRecords(channelId: string): OwnedRoutineRecord[] {
    return this.#routines.listRecords(this.#requireChannel(channelId)).map((routine) => this.#hxWithQueue(routine));
  }

  getRecord(channelId: string, routineId: string): OwnedRoutineRecord | null {
    return this.#routines.getRecord(this.#requireChannel(channelId), routineId);
  }

  saveRecord(channelId: string, routineId: string | undefined, input: RoutineRecordInput): OwnedRoutineRecord {
    // HXBot (v1.7.5, RTN-01): see `create`.
    const checked =
      input.trigger.kind === "schedule" ? { ...input, timezone: hxRoutineZones.checkSaved(input.timezone) } : input;
    const routine = this.#routines.saveRecord(this.#requireChannel(channelId), routineId, checked);
    // HXBot (v1.7.5, RTN-06): see `update`.
    if (!routine.active) hxChannelRoutineConfirm.cancelFor(channelId, routine.id);
    this.#changed(channelId);
    return routine;
  }

  /**
   * Starts a run for one verified webhook request. An archived or held channel is unavailable, so
   * the sender retries later and nothing is written.
   */
  readonly receiveWebhook = Effect.fn("ChannelRoutineScheduler.receiveWebhook")(function* (
    this: ChannelRoutineScheduler,
    channelId: string,
    routineId: string,
    event: ReceivedWebhookEvent,
  ) {
    if (!this.#channels.store.exists(channelId) || this.#excluded().has(channelId)) {
      return { kind: "unavailable" } as const;
    }
    const result = yield* channelRoutineStep(() => this.#routines.receiveWebhook(channelId, routineId, event));
    // An ignored request adds a history row, so an open editor reloads it.
    if (result.kind === "ignored") this.#changed(channelId);
    if (result.kind !== "started") return result;
    const run = result.run;
    const record = yield* channelRoutineStep(() => this.#routines.getRecord(channelId, routineId));
    if (record?.limitPolicy === "skip" && this.#hooks.usageLimited(channelId)) {
      yield* channelRoutineStep(() => this.#settle(run, { status: "cancelled", error: null }));
    } else {
      const request = yield* channelRoutineStep(() => this.#routines.attachRequest(run.id, randomUUID()));
      yield* this.#issueEffect(request);
    }
    this.#changed(channelId);
    return result;
  }, Effect.uninterruptible);

  delete(input: DeleteChannelRoutineInput, access: RoutineTriggerAccess = {}): void {
    const channelId = this.#requireChannel(input.channelId);
    if (!access.webhook && this.#routines.getRecord(channelId, input.routineId)?.trigger.kind === "webhook") {
      throw new Error(sourceText("error.backend.routineGone"));
    }
    // A request the routine posted and no member has started yet leaves with the routine, as an
    // agent routine's queued delivery does. Work that already runs keeps its Stop control. An
    // assignment is created before its delivery is queued, so "assigned" is not "started": only a
    // delivery that left the queue holds the task.
    this.#channels.withdrawRequests(
      channelId,
      new Set(this.#routines.activeRuns(channelId, input.routineId).flatMap((run) => run.requestMessageId ?? [])),
    );
    this.#routines.delete(channelId, input.routineId);
    this.#changed(input.channelId);
  }

  /** A manual fire: no trigger, so it never collides with the scheduled occurrence. */

  readonly test = Effect.fn("ChannelRoutineScheduler.test")(function* (
    this: ChannelRoutineScheduler,
    input: TestChannelRoutineInput,
    access: RoutineTriggerAccess = {},
  ) {
    const routine = yield* channelRoutineStep(() => {
      const channelId = this.#requireChannel(input.channelId);
      const stored = this.#routines.getRecord(channelId, input.routineId);
      if (!stored || (stored.trigger.kind === "webhook" && !access.webhook)) {
        throw new Error(sourceText("error.backend.routineGone"));
      }
      return { ...stored, channelId: stored.ownerId };
    });
    const now = new Date().toISOString();
    // The run would wait for the reset, and a routine set to skip has no use for a late result.
    const run =
      routine.limitPolicy === "skip" && this.#hooks.usageLimited(routine.channelId)
        ? yield* channelRoutineStep(() =>
            this.#routines.updateRunStatus(this.#routines.createRun(routine, null, "test", now).id, "cancelled", null),
          )
        : yield* this.#fireEffect(routine, null, now);
    this.#changed(routine.channelId);
    return run;
  }, Effect.uninterruptible);

  /**
   * Whether a spent plan drops this channel task: it belongs to an open run of a routine set to
   * skip. The run is settled as cancelled here, before the task is.
   */
  skipAtLimit(channelId: string, requestMessageId: string): boolean {
    const run = this.#routines.openRuns(channelId).find((item) => item.requestMessageId === requestMessageId);
    if (!run || this.#routines.getRecord(channelId, run.routineId)?.limitPolicy !== "skip") return false;
    this.#settle(run, { status: "cancelled", error: null });
    return true;
  }

  skipMissed(now: Date, held?: RoutineHoldWindow): void {
    this.#routines.skipMissed(now, held);
  }

  /** The earliest channel routine, for the shared timer to compare against the other owners. */
  nextDueAt(): string | null {
    const due = this.#routines.nextDueAt(this.#excluded());
    // HXBot (v1.7.5, RTN-02): an unanswered question expires on time too.
    const expiry = hxChannelRoutineConfirm.nextExpiry();
    if (!expiry) return due;
    return !due || Date.parse(expiry) < Date.parse(due) ? expiry : due;
  }

  readonly processDue = Effect.fn("ChannelRoutineScheduler.processDue")(function* (
    this: ChannelRoutineScheduler,
    now = new Date(),
    active: () => boolean = () => true,
  ) {
    const changed = new Set<string>();
    yield* Effect.gen({ self: this }, function* () {
      // HXBot (v1.7.5, RTN-02): a question nobody answered before its time is skipped first.
      yield* channelRoutineStep(() => hxChannelRoutineConfirm.expire(now));
      const pending = yield* channelRoutineStep(() => this.#routines.due(now, this.#excluded()));
      // HXBot (v1.7.5, CONC-14): routines due in the same minute start spread over it, in order.
      const hxDelays = hxStaggerDelays(
        pending.map((due) => ({
          routineId: due.routine.id,
          nextRunAt: due.nextRunAt,
          schedule: due.schedule,
          timezone: due.routine.timezone,
        })),
      );
      for (const due of pending) {
        if (!active()) break;
        if (this.#excluded().has(due.routine.channelId)) continue;
        // HXBot (v1.7.5): the plan reads the trigger that came due.
        const routine: ChannelRoutine = {
          ...due.routine,
          trigger: { ...due.routine.trigger, id: due.triggerId, nextRunAt: due.nextRunAt, schedule: due.schedule },
        };
        const owner = hxChannelDueOwner(this.#routines);
        const connection = this.#channels.store.database.connection;
        const run = yield* channelRoutineStep(() => {
          // A one-time trigger completes in the place of an advance, with the same at-most-once order.
          if (due.schedule.kind === "once") {
            // HXBot (v1.7.5, MIG-03): a one-time routine that asks before each run waits for the yes.
            const asks = hxOnceNeedsYes(owner, connection, routine, now);
            this.#routines.completeTrigger(due.routine.id, due.triggerId, now);
            changed.add(due.routine.channelId);
            // A routine set to skip drops the occurrence while a spent plan would only make it wait.
            if (asks || (due.routine.limitPolicy === "skip" && this.#hooks.usageLimited(due.routine.channelId)))
              return null;
            return this.#routines.createRun(routine, due.triggerId, "scheduled", due.nextRunAt);
          }
          // HXBot (v1.7.5, RTN-02, RTN-03, MIG-03): one run at a time, and an occurrence dropped for a live
          // run or a spent plan leaves a skipped record; the ones a sleep made late are counted and handled
          // by the policy; a run that must ask waits for the yes.
          const plan = hxDueFor(connection, "channel", routine, now, {
            live: this.#routines
              .activeRuns(due.routine.channelId, due.routine.id)
              .some((entry) => entry.status === "queued" || entry.status === "running"),
            limited: due.routine.limitPolicy === "skip" && this.#hooks.usageLimited(due.routine.channelId),
          });
          const created = hxApplyDue(owner, connection, routine, plan, now);
          // The trigger advances whether or not the fire succeeds, so a channel builds no backlog.
          this.#routines.advanceTrigger(due.routine.id, due.triggerId, plan.nextRunAt.toISOString());
          changed.add(due.routine.channelId);
          return created;
        });
        if (!run) continue;
        const startAt = Date.parse(due.nextRunAt) + (hxDelays.get(due.routine.id) ?? 0);
        if (startAt > now.getTime()) this.#hxIssueLater(run, startAt - now.getTime());
        else yield* this.#hxIssue(run);
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const channelId of changed) this.#changed(channelId);
        }),
      ),
    );
  });

  /** HXBot (v1.7.5): issues a run row that the plan created. */
  readonly #hxIssue = Effect.fn("ChannelRoutineScheduler.hxIssue")(function* (
    this: ChannelRoutineScheduler,
    run: ChannelRoutineRun,
  ) {
    const request = yield* channelRoutineStep(() =>
      run.requestMessageId ? run : this.#routines.attachRequest(run.id, randomUUID()),
    );
    return yield* this.#issueEffect(request);
  }, Effect.uninterruptible);

  readonly #hxLater = new Set<ReturnType<typeof setTimeout>>();

  /**
   * HXBot (v1.7.5, CONC-14): issues a run after its share of the minute. The row exists without a
   * request, so a quit before the time leaves it pending, and the next start issues it
   * (`resumePendingRuns`).
   */
  #hxIssueLater(run: ChannelRoutineRun, delayMs: number): void {
    const timer = setTimeout(() => {
      this.#hxLater.delete(timer);
      const current = this.#routines.activeRuns(run.channelId, run.routineId).find((entry) => entry.id === run.id);
      if (current?.status !== "queued" || current.requestMessageId) return;
      if (this.#excluded().has(run.channelId) || !this.#channels.store.exists(run.channelId)) return;
      void Effect.runPromise(
        this.#hxIssue(current).pipe(
          Effect.catch((failure) =>
            Effect.sync(() => this.#hooks.emitError("channel_routine_fire_failed", failure.cause)),
          ),
        ),
      ).catch(() => undefined);
    }, delayMs);
    timer.unref?.();
    this.#hxLater.add(timer);
  }

  /** HXBot (v1.7.5, CONC-14): the runs that wait for their share of the minute. */
  hxPendingStarts(): number {
    return this.#hxLater.size;
  }

  /** HXBot (v1.7.5, RTN-02, MIG-03): a channel routine of this computer, for its open questions. */
  hxRoutine(channelId: string, routineId: string): ChannelRoutine | null {
    if (!this.#channels.store.exists(channelId)) return null;
    return this.#routines.get(channelId, routineId);
  }

  /** HXBot (v1.7.5, RTN-02, MIG-03): the run of a yes. It runs as the occurrence it was asked for. */
  readonly hxStartConfirmedRun = Effect.fn("ChannelRoutineScheduler.hxStartConfirmedRun")(function* (
    this: ChannelRoutineScheduler,
    input: Parameters<typeof hxChannelStartConfirmed>[1],
  ) {
    const run = yield* channelRoutineStep(() => {
      if (this.#excluded().has(input.routine.channelId)) throw new Error(sourceText("error.backend.routineGone"));
      return hxChannelStartConfirmed(this.#routines, input);
    });
    yield* this.#hxIssue(run);
    this.#changed(input.routine.channelId);
  });

  /** HXBot (v1.7.5, RTN-02): an occurrence the person declined or did not answer, in the run history. */
  hxRecordSkipped(input: {
    routine: ChannelRoutine;
    triggerId: string | null;
    scheduledFor: string;
    reason: "declined" | "expired" | "cancelled";
  }): void {
    this.#routines.hxRecordNotRun(
      input.routine,
      input.triggerId,
      { scheduledFor: input.scheduledFor, until: null, count: 1 },
      { skip: { reason: input.reason, at: new Date().toISOString() } },
    );
    this.#changed(input.routine.channelId);
  }

  /**
   * Repairs the crash window between minting a run and issuing its command. A run without a request
   * id never reached the channel, so it is fired now; a run that has one re-issues the identical
   * command, which the receipt turns into a no-op that only re-wakes the channel.
   */

  readonly resumePendingRuns = Effect.fn("ChannelRoutineScheduler.resumePendingRuns")(function* (
    this: ChannelRoutineScheduler,
  ) {
    const pending = yield* channelRoutineStep(() => this.#routines.pendingRuns());
    for (const run of pending) {
      if (this.#excluded().has(run.channelId) || !this.#channels.store.exists(run.channelId)) {
        yield* channelRoutineStep(() => this.#settle(run, { status: "cancelled", error: null }));
        continue;
      }
      const request = yield* channelRoutineStep(() =>
        run.requestMessageId ? run : this.#routines.attachRequest(run.id, randomUUID()),
      );
      yield* this.#issueEffect(request);
    }
  });

  /**
   * Runs inside `ChannelHooks.changed`, one frame after a channel commit. It only reads the channel
   * store and writes its own table, and it must never throw: an exception here would surface as a
   * failed `publish` rather than as a wrong run status.
   */
  reconcile(channelId: string): void {
    try {
      const exists = this.#channels.store.exists(channelId);
      const tasks = exists ? this.#channels.store.tasks(channelId) : [];
      const assignments = exists ? this.#channels.store.assignments(channelId) : [];
      // Continue and Reassign restart a failed task under the request it already has, so the run
      // a failure settled has to follow it out of the failed state. Only the runs whose request
      // still has live work are read: a finished failure stays where the history put it.
      const live = [
        ...new Set(
          tasks
            .filter((task) => task.state !== "completed" && task.state !== "cancelled")
            .map((task) => task.requestMessageId),
        ),
      ];
      let changed = false;
      for (const run of [
        ...this.#routines.openRuns(channelId),
        ...this.#routines.failedRunsForRequests(channelId, live),
      ]) {
        // A run with no request id has not reached the channel yet; `resumePendingRuns` owns it.
        if (!run.requestMessageId) continue;
        // Nor has a run whose command is still in flight: the run row is written first, so a
        // publish from other channel work can land between the two. Read as a state, that window
        // looks like a request that every task has dropped, and would cancel work about to start.
        if (exists && !this.#channels.committed(this.#actor(run).id, this.#operationId(run))) continue;
        const requestId = run.requestMessageId;
        const owned = tasks.filter((task) => task.requestMessageId === requestId);
        const hasAssignment = assignments.some(
          (assignment) =>
            owned.some((task) => task.id === assignment.taskId) &&
            (assignment.state === "queued" || assignment.state === "starting" || assignment.state === "running"),
        );
        changed = this.#settle(run, channelRunStatusForTasks(owned, hasAssignment)) || changed;
      }
      if (changed) this.#changed(channelId);
    } catch (error) {
      this.#hooks.emitError("channel_routine_reconcile_failed", error);
    }
  }

  reconcileAll(): void {
    for (const channelId of this.#routines.channelsWithOpenRuns()) this.reconcile(channelId);
  }

  /**
   * The run row is written before the command, and both halves of the command's receipt key are
   * functions of the run id. A crash between the two is therefore repaired by replaying the
   * command, which is what makes `resumePendingRuns` exactly-once with no separate dedupe.
   */
  readonly #fireEffect = Effect.fn("ChannelRoutineScheduler.fire")(function* (
    this: ChannelRoutineScheduler,
    routine: Pick<ChannelRoutine, "id" | "channelId" | "name" | "instruction">,
    triggerId: string | null,
    scheduledFor: string,
  ) {
    const run = yield* channelRoutineStep(() => {
      const created = this.#routines.createRun(routine, triggerId, triggerId ? "scheduled" : "test", scheduledFor);
      return created.requestMessageId ? created : this.#routines.attachRequest(created.id, randomUUID());
    });
    return yield* this.#issueEffect(run);
  }, Effect.uninterruptible);

  readonly #issueEffect = Effect.fn("ChannelRoutineScheduler.issue")(function* (
    this: ChannelRoutineScheduler,
    run: ChannelRoutineRun,
  ) {
    recordRestartActivity();
    const requestMessageId = run.requestMessageId;
    if (!requestMessageId)
      return yield* new ChannelRoutineFailed({ cause: new Error("The routine run has no request message.") });
    const issued = yield* Effect.result(
      this.#channels
        .command(
          {
            type: "request",
            operationId: this.#operationId(run),
            channelId: run.channelId,
            text: run.instruction,
            recipientAgentId: null,
            requestMessageId,
            origin: { kind: "routine", routineId: run.routineId, routineName: run.routineName, runId: run.id },
          },
          this.#actor(run),
          // The request waits behind earlier channel commands; a routine deleted meanwhile posts nothing.
          (queued) => (this.#routines.getRecord(run.channelId, run.routineId) ? queued : null),
        )
        .pipe(toChannelRoutineFailed),
    );
    if (!this.#routines.getRecord(run.channelId, run.routineId)) {
      // Deleted while the request was being applied: withdraw what it created, as deletion does.
      yield* channelRoutineStep(() => {
        this.#channels.withdrawRequests(run.channelId, new Set([requestMessageId]));
        this.#changed(run.channelId);
      });
      return run;
    }
    if (Result.isFailure(issued)) {
      const error = issued.failure.cause;
      return yield* channelRoutineStep(() => {
        this.#settle(run, { status: "failed", error: error instanceof Error ? error.message : String(error) });
        this.#hooks.emitError("channel_routine_fire_failed", error);
        return this.#routines.runForRequest(requestMessageId) ?? run;
      });
    }
    return run;
  }, Effect.uninterruptible);

  #actor(run: ChannelRoutineRun): { id: string; name: string } {
    return { id: `routine:${run.routineId}`, name: run.routineName };
  }

  #operationId(run: ChannelRoutineRun): string {
    return `channel-routine-run:${run.id}`;
  }

  /** Writes only on a change, so a channel that publishes often does not rewrite every run row. */
  #settle(run: ChannelRoutineRun, next: { status: ChannelRoutineRunStatus; error: string | null }): boolean {
    if (run.status === next.status && run.error === next.error) return false;
    this.#routines.updateRunStatus(run.id, next.status, next.error);
    return true;
  }

  #excluded(): ReadonlySet<string> {
    return new Set([...this.#channels.store.archivedIds(), ...this.#hooks.excludedChannels()]);
  }

  #requireChannel(channelId: string): string {
    if (!this.#channels.store.exists(channelId)) throw new Error(sourceText("error.backend.channelNotFound"));
    return channelId;
  }

  #changed(channelId: string): void {
    this.#hooks.changed(channelId);
  }
}

class ChannelRoutineFailed extends Schema.TaggedError<ChannelRoutineFailed>()("ChannelRoutineFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: channelRoutineStep, rewrap: toChannelRoutineFailed } = causeHelpers(ChannelRoutineFailed);
