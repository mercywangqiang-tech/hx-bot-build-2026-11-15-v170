// HXBot 并发（一）：容量账本（v1.7.1，CONC-01、CONC-03、CONC-04、CONC-12）。
//
// One ledger for the computer. It knows B (the turns that may run at the same time), the lanes that
// run, and the work that waits: the queued deliveries of every lane, and the work of every team room
// that is ready on its board. The turn slots of the drain ask it whether a lane may start; the
// channel pump asks it whether a team room may give out a piece of work. A team room starts a piece
// of work only when the ledger gives it a place, so work with no place stays on the board and takes
// no browser or workspace. Normal channels keep their own limit of 2 and are not asked.
//
// It never imports the agent service, the channel service or the teams: they attach views.
import type { QueueDelivery } from "@hxbot/contracts/ipc";
import {
  type HxFlowCandidate,
  HxFlowDifficultyTimes,
  type HxFlowOrderContext,
  HxFlowShares,
  type HxFlowTier,
  hxFlowSort,
} from "./order";
import { hxOverload } from "./overload";

/** What the drain gives: B now (null for no limit) and the lane keys that run a turn now. */
export interface HxFlowSchedulerView {
  limit(): number | null;
  running(): readonly string[];
}

/** One piece of work of a team room, as the teams describe it. */
export interface HxFlowTeamTask {
  channelId: string;
  taskId: string;
  teamId: string;
  tier: 1 | 2;
  order: number;
  batch: string | null;
  difficulty: HxFlowCandidate["difficulty"];
  dependents: number;
}

/** What the teams give. */
export interface HxFlowTeamView {
  /** The team of a room, or null for a normal channel. */
  teamOf(channelId: string): string | null;
  /** The work of a team room, or null when the room or the task is not a team's. */
  task(channelId: string, taskId: string): HxFlowTeamTask | null;
  /** Every queued piece of work of every running team whose dependencies are done. */
  ready(): readonly HxFlowTeamTask[];
}

/** What the channels give. */
export interface HxFlowChannelView {
  /** True for a task that a request in the channel made (not a piece that a member gave out). */
  isRequest(channelId: string, taskId: string): boolean;
  /** Pumps the team rooms again: a place became free. */
  wakeRooms(): void;
}

export interface HxFlowCapacity {
  /** B, or null when nothing limits the turns. */
  budget: number | null;
  running: number;
  /** Lanes and team work that wait for a place. */
  waiting: number;
  /** What holds B where it is (CONC-01), when known. */
  bound: string | null;
  /** Models that wait for a usage limit now. */
  limitedModels: readonly string[];
  /** The user uses the keyboard and the screen now. */
  screenBusy: boolean;
}

interface RunningLane {
  teamId: string | null;
  tier: HxFlowTier;
  startedAt: number;
  accruedAt: number;
  taskId: string | null;
}

/** A team room was given a place but its turn did not start yet. */
const DISPATCH_HOLD_MS = 60_000;
/** The time of one turn before any turn ended. */
const DEFAULT_TURN_MS = 120_000;
const TURN_MS_WEIGHT = 0.2;
const IDLE_RELEASE_GAP_MS = 60_000;

export type { HxFlowCandidate } from "./order";

export class HxFlowLedger {
  readonly shares = new HxFlowShares();
  times = new HxFlowDifficultyTimes();
  #scheduler: HxFlowSchedulerView | null = null;
  #teams: HxFlowTeamView | null = null;
  #channels: HxFlowChannelView | null = null;
  #bound: () => string | null = () => null;
  #limitedModels: () => readonly string[] = () => [];
  #screenBusy: () => boolean = () => false;
  #releaseIdle: () => void = () => {};
  #idleReleasedAt = 0;
  readonly #running = new Map<string, RunningLane>();
  readonly #lastEnded = new Map<string, number>();
  readonly #batchStarts = new Map<string, number>();
  /** Team work that a room gave out and whose turn did not start yet: task id → when. */
  readonly #dispatched = new Map<string, number>();
  /** When each piece of team work became ready: task id → ms. */
  readonly #readyAt = new Map<string, number>();
  #roomsWait = false;
  #waitingLanes = 0;
  #turnMs = DEFAULT_TURN_MS;
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  attachScheduler(view: HxFlowSchedulerView | null): void {
    this.#scheduler = view;
  }

  attachTeams(view: HxFlowTeamView | null): void {
    this.#teams = view;
  }

  attachChannels(view: HxFlowChannelView | null): void {
    this.#channels = view;
  }

  attachMachine(view: {
    bound?: () => string | null;
    limitedModels?: () => readonly string[];
    screenBusy?: () => boolean;
    /** G6: closes the longest idle member thread (idle-thread pools with the policy of idle.ts). */
    releaseIdle?: () => void;
  }): void {
    if (view.releaseIdle) this.#releaseIdle = view.releaseIdle;
    if (view.bound) this.#bound = view.bound;
    if (view.limitedModels) this.#limitedModels = view.limitedModels;
    if (view.screenBusy) this.#screenBusy = view.screenBusy;
  }

  /** HXBot (v1.7.4, CONC-09): the order of the waiting lanes, for the place that a wait shows. */
  orderContext(now: number = this.#now()): HxFlowOrderContext {
    return this.#context(now);
  }

  /** HXBot (v1.7.4, CONC-09): the recent time of one turn, for the time that a wait shows. */
  turnMs(): number {
    return this.#turnMs;
  }

  #context(now: number): HxFlowOrderContext {
    return {
      now,
      shares: this.shares,
      times: this.times,
      lastEnded: (lane) => this.#lastEnded.get(lane),
      batchStarts: (batch) => this.#batchStarts.get(batch) ?? 0,
    };
  }

  /** The place of a queued delivery in the order. `assignment` is its channel assignment, if any. */
  rank(lane: string, head: QueueDelivery, assignment: { channelId: string; taskId: string } | null): HxFlowCandidate {
    const readyAt = Date.parse(head.createdAt) || this.#now();
    const plain = (tier: HxFlowTier): HxFlowCandidate => ({
      lane,
      tier,
      readyAt,
      teamId: null,
      order: 0,
      batch: null,
      difficulty: null,
      dependents: 0,
    });
    if (assignment) {
      const team = this.#teams?.task(assignment.channelId, assignment.taskId);
      if (team) {
        return {
          lane,
          tier: team.tier,
          readyAt: this.#readyAt.get(team.taskId) ?? readyAt,
          teamId: team.teamId,
          order: team.order,
          batch: team.batch,
          difficulty: team.difficulty,
          dependents: team.dependents,
        };
      }
      return plain(this.#channels?.isRequest(assignment.channelId, assignment.taskId) ? 0 : 2);
    }
    if (head.sender.kind === "user") return plain(0);
    if (head.sender.kind === "routine") return plain(3);
    return plain(2);
  }

  /**
   * Whether a waiting lane may start now. `waiting` holds the other lanes that could start if a place
   * were free. A person keeps one place: when B is at least 3, other work uses at most B − 1.
   */
  mayStart(
    candidate: HxFlowCandidate,
    waiting: readonly HxFlowCandidate[],
    running: readonly string[],
    limit: number,
  ): boolean {
    const now = this.#now();
    this.tick(running);
    this.#waitingLanes = waiting.length + 1;
    const free = limit - running.length - this.#heldForRooms(now);
    if (free <= 0) return false;
    // A person keeps one place: when it is the last place, only a person's turn may take it.
    const personOnly = limit >= 3 && this.#otherRunning(running) + this.#heldForRooms(now) >= limit - 1;
    if (personOnly && candidate.tier !== 0) return false;
    // HXBot (v1.7.3, stress test): the place of the lane in one order of all the lanes that may start
    // now. Counting the lanes that go before it, pair by pair, let a cycle of three teams with near
    // shares (A before B, B before C, C before A) refuse every lane while places stayed free; and a
    // routine lifted by its age, which cannot take the person's place, kept the person out of it.
    const lanes = waiting.filter((other) => other.lane !== candidate.lane && (!personOnly || other.tier === 0));
    const place = hxFlowSort([...lanes, candidate], this.#context(now)).findIndex(
      (other) => other.lane === candidate.lane,
    );
    return place >= 0 && place < free;
  }

  /** A lane started a delivery. */
  started(lane: string, candidate: HxFlowCandidate, taskId: string | null): void {
    const now = this.#now();
    // HXBot (v1.7.4, CONC-08): how long the work waited, for the overload of its tier.
    hxOverload.started(candidate.tier, now - candidate.readyAt, now);
    this.#running.set(lane, {
      teamId: candidate.teamId,
      tier: candidate.tier,
      startedAt: now,
      accruedAt: now,
      taskId,
    });
    if (taskId) this.#dispatched.delete(taskId);
    if (candidate.batch) this.#batchStarts.set(candidate.batch, (this.#batchStarts.get(candidate.batch) ?? 0) + 1);
  }

  /**
   * Counts the turn seconds of each team, notes the lanes whose turn ended, and pumps the team rooms
   * again when a place may be free. Called at each start check, and with `periodic` at each memory
   * sample.
   */
  tick(running: readonly string[] = this.#scheduler?.running() ?? [], periodic = false): void {
    const now = this.#now();
    const live = new Set(running);
    let ended = false;
    for (const [lane, entry] of this.#running) {
      if (entry.teamId) this.shares.add(entry.teamId, (now - entry.accruedAt) / 1000, now);
      entry.accruedAt = now;
      if (live.has(lane)) continue;
      this.#running.delete(lane);
      this.#lastEnded.set(lane, now);
      this.#turnMs += (now - entry.startedAt - this.#turnMs) * TURN_MS_WEIGHT;
      ended = true;
    }
    for (const [taskId, at] of this.#dispatched) if (now - at > DISPATCH_HOLD_MS) this.#dispatched.delete(taskId);
    // Only when a turn ended or at a memory sample: a start check runs often, and a pump that finds
    // no place would ask again at once.
    if (this.#roomsWait && (ended || periodic)) {
      this.#roomsWait = false;
      this.#channels?.wakeRooms();
    }
    if (periodic) this.#idleGuard(now, running);
  }

  /**
   * G6 (CONC-10): when memory holds B and work waits, close the member thread that was idle longest
   * (not one idle for less than 4 minutes). At most once a minute.
   */
  #idleGuard(now: number, running: readonly string[]): void {
    const limit = this.#scheduler?.limit() ?? null;
    if (limit === null || now - this.#idleReleasedAt < IDLE_RELEASE_GAP_MS) return;
    const bound = this.#bound();
    const memoryBound = bound === "memory" || bound === "floor" || bound === "pressure";
    const waiting = this.#waitingLanes > 0 || (this.#teams?.ready().length ?? 0) > this.#dispatched.size;
    if (!memoryBound || !waiting || running.length < limit) return;
    this.#idleReleasedAt = now;
    this.#releaseIdle();
  }

  /**
   * HXBot (v1.7.3, CONC-05): the tier of an agent's running turn in its own chat, or null when none
   * runs there. Computer control orders its lanes by it and asks routines for a longer pause of the user.
   */
  tierOf(agentId: string): number | null {
    return this.#running.get(agentId)?.tier ?? null;
  }

  /** Whether a turn of the team runs now (its real work, for the guards). */
  teamRunning(teamId: string): boolean {
    for (const entry of this.#running.values()) if (entry.teamId === teamId) return true;
    return false;
  }

  /** True for the room of a team. */
  isTeamRoom(channelId: string): boolean {
    return (this.#teams?.teamOf(channelId) ?? null) !== null;
  }

  /**
   * Whether a team room may give out this piece of work now (CONC-04): the ledger has a free place,
   * and no ready team work that goes first takes it. It changes nothing; `dispatched` takes the place.
   */
  hasPlace(channelId: string, taskId: string): boolean {
    const scheduler = this.#scheduler;
    if (!scheduler || !this.isTeamRoom(channelId)) return true;
    const limit = scheduler.limit();
    if (limit === null) return true;
    const now = this.#now();
    const running = scheduler.running();
    this.tick(running);
    const held = this.#heldForRooms(now);
    // A person keeps one place: when B is at least 3, team work uses at most B − 1.
    const cap = limit >= 3 ? limit - 1 : limit;
    const free = Math.min(limit - running.length - held, cap - this.#otherRunning(running) - held);
    const place = this.#readyCandidates(now).findIndex((candidate) => candidate.lane === roomLane(taskId));
    if (free > 0 && place >= 0 && place < free) return true;
    this.#roomsWait = true;
    return false;
  }

  /** A team room gave out this piece of work: its place stays taken until its turn starts. */
  dispatched(taskId: string): void {
    this.#dispatched.set(taskId, this.#now());
  }

  /** The place of team work in the queue (1 is next) and the minutes until it starts, for the reply. */
  queuePlace(taskId: string): { place: number; minutes: number } | null {
    const now = this.#now();
    const ready = this.#readyCandidates(now);
    const index = ready.findIndex((candidate) => candidate.lane === roomLane(taskId));
    if (index < 0) return null;
    const budget = Math.max(1, this.#scheduler?.limit() ?? 1);
    const minutes = Math.max(1, Math.round((Math.ceil((index + 1) / budget) * this.#turnMs) / 60_000));
    return { place: index + 1, minutes };
  }

  capacity(): HxFlowCapacity {
    const running = this.#scheduler?.running() ?? [];
    const ready = this.#teams?.ready() ?? [];
    return {
      budget: this.#scheduler?.limit() ?? null,
      running: running.length,
      waiting: Math.max(0, this.#waitingLanes) + ready.filter((task) => !this.#dispatched.has(task.taskId)).length,
      bound: this.#bound(),
      limitedModels: this.#limitedModels(),
      screenBusy: this.#screenBusy(),
    };
  }

  /** The team ended: its share and weight go. */
  forgetTeam(teamId: string): void {
    this.shares.forget(teamId);
  }

  /** HXBot (v1.7.4, CONC-08): the team work that waits for a place now, for the overload. */
  waitingTeamWork(now: number = this.#now()): HxFlowCandidate[] {
    return this.#readyCandidates(now);
  }

  #readyCandidates(now: number): HxFlowCandidate[] {
    const ready = this.#teams?.ready() ?? [];
    const live = new Set(ready.map((task) => task.taskId));
    for (const id of this.#readyAt.keys()) if (!live.has(id)) this.#readyAt.delete(id);
    const candidates = ready
      .filter((task) => !this.#dispatched.has(task.taskId))
      .map((task): HxFlowCandidate => {
        if (!this.#readyAt.has(task.taskId)) this.#readyAt.set(task.taskId, now);
        return {
          lane: roomLane(task.taskId),
          tier: task.tier,
          readyAt: this.#readyAt.get(task.taskId) ?? now,
          teamId: task.teamId,
          order: task.order,
          batch: task.batch,
          difficulty: task.difficulty,
          dependents: task.dependents,
        };
      });
    return hxFlowSort(candidates, this.#context(now));
  }

  /** Places that team rooms took and whose turns did not start yet. */
  #heldForRooms(now: number): number {
    let held = 0;
    for (const at of this.#dispatched.values()) if (now - at <= DISPATCH_HOLD_MS) held += 1;
    return held;
  }

  #otherRunning(running: readonly string[]): number {
    return running.filter((lane) => (this.#running.get(lane)?.tier ?? 2) !== 0).length;
  }
}

function roomLane(taskId: string): string {
  return `room:${taskId}`;
}

export const hxFlow = new HxFlowLedger();

/**
 * Keeps the value of `read` until the next microtask (BUG-CONC-01). The turn slots and the team rooms
 * ask for the lanes of every agent many times in one pass, and each ask read the open tasks of every
 * agent from SQLite: with a turn budget on the desktop, that kept the main process busy for seconds.
 * Nothing that one pass reads changes before its next microtask; a drain that starts a turn checks again.
 */
export function hxTickMemo<T>(read: () => T): () => T {
  let held: { value: T } | null = null;
  return () => {
    if (held) return held.value;
    const value = read();
    held = { value };
    queueMicrotask(() => {
      held = null;
    });
    return value;
  };
}
