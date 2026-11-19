// HXBot 电脑操控（五）（v1.7.3，需求 CONC-05）：电脑操作分道。
//
// 原来全机只有一条先进先出的队（computer.ts 的 hxComputerInTurn）：一个助手在记事本里慢慢打字，另一个助手
// 想在文本编辑里读一下窗口也得等。现在分四道：
//   只读（看窗口、找应用、核对）   不排队；
//   app:<应用>                     同一个应用一次一个，全机最多 3 个应用同时在做；
//   focus                          前台的按键和点击，全机一个；
//   system                         改系统设置、装应用、启停应用、运行脚本，全机一个，和 focus 互斥。
// 申请的次序固定（app → focus → system），只在一次工具调用里持有，调用结束全部放掉（HxLeaseSet），从不在
// 等模型的时候拿着。等的人按档位排（数字小的先：0 是你发的消息，3 是定时任务），同档先来先得。一次工具调用
// 里各步等待合计不超过 30 秒（HxWaitBudget），到了就停在当前一步，答复“忙、谁在用、大约多久”。
// 停止键（⌃⌥Esc / Ctrl+Alt+Esc）让所有在等的人立刻收到“停了”，正拿着道的调用在下一步之前看到道没了，也停下。
// 一次调用在每一步之后放掉 focus；它下一步再要 focus 时用第一次申请的次序号，排回本档的最前面。

/** The lanes. `app:<key>` is one app (its plain name). */
export type HxLaneName = `app:${string}` | "focus" | "system";

/** Who holds or waits: an agent and the tier of its turn (0 the user's message … 3 a routine). */
export interface HxLaneHolder {
  agentId: string;
  /** The agent's name, for the busy answer. */
  name?: string;
  tier: number;
}

export interface HxLease {
  readonly lane: HxLaneName;
  readonly holder: HxLaneHolder;
  /** False after the release, or after the stop keys took the lane back. */
  alive(): boolean;
  release(): void;
}

export type HxLaneAnswer =
  | { ok: true; lease: HxLease }
  | { ok: false; why: "busy" | "stopped"; reason: string; etaMs: number | null; waitedMs: number };

/** The most apps that run steps at the same time (CONC-05). */
const HX_LANE_MAX_APPS = 3;
/** The longest one tool call waits for lanes, all its steps together (CONC-05). */
export const HX_LANE_BUDGET_MS = 30_000;

interface Waiter {
  lane: HxLaneName;
  holder: HxLaneHolder;
  since: number;
  seq: number;
  done: (answer: HxLaneAnswer) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Held {
  holder: HxLaneHolder;
  since: number;
  revoke: () => void;
}

const isApp = (lane: HxLaneName): boolean => lane.startsWith("app:");

/** The lanes of this computer. One instance in the process (`hxComputerLanes`); tests make their own. */
export class HxComputerLanes {
  readonly #held = new Map<HxLaneName, Held>();
  readonly #waiting: Waiter[] = [];
  readonly #maxApps: number;
  readonly #now: () => number;
  /** How long each lane was held lately, for the estimate in a busy answer. */
  readonly #durations = new Map<string, number[]>();
  #seq = 0;

  constructor(options: { maxApps?: number; now?: () => number } = {}) {
    this.#maxApps = options.maxApps ?? HX_LANE_MAX_APPS;
    this.#now = options.now ?? Date.now;
  }

  /** Who holds each lane now, for tests and the busy answer. */
  holders(): ReadonlyMap<HxLaneName, HxLaneHolder> {
    return new Map([...this.#held].map(([lane, held]) => [lane, held.holder]));
  }

  /** Whether someone of a more urgent tier (a smaller number) waits for this lane. */
  moreUrgentWaits(lane: HxLaneName, tier: number): boolean {
    return this.#waiting.some((waiter) => waiter.lane === lane && waiter.holder.tier < tier);
  }

  /** HXBot (v1.7.4, CONC-09): the agents that wait for a lane of the screen now, for the team's card. */
  waitingAgents(): ReadonlySet<string> {
    return new Set(this.#waiting.map((waiter) => waiter.holder.agentId));
  }

  /** Whether anybody waits for a lane, or holds `focus` (the presence check runs only then). */
  active(): boolean {
    return this.#waiting.length > 0 || this.#held.has("focus");
  }

  #free(lane: HxLaneName): boolean {
    if (this.#held.has(lane)) return false;
    if (lane === "focus") return !this.#held.has("system");
    if (lane === "system") return !this.#held.has("focus");
    const apps = [...this.#held.keys()].filter(isApp).length;
    return apps < this.#maxApps;
  }

  /** Whether a more urgent or earlier waiter for the same lane (or for a lane that blocks it) is ahead. */
  #ahead(lane: HxLaneName, tier: number, seq: number): boolean {
    return this.#waiting.some(
      (waiter) =>
        (waiter.lane === lane || (isApp(lane) && isApp(waiter.lane) && this.#appsFull())) &&
        (waiter.holder.tier < tier || (waiter.holder.tier === tier && waiter.seq < seq)),
    );
  }

  #appsFull(): boolean {
    return [...this.#held.keys()].filter(isApp).length >= this.#maxApps;
  }

  #grant(lane: HxLaneName, holder: HxLaneHolder): HxLease {
    const since = this.#now();
    let released = false;
    const held: Held = {
      holder,
      since,
      revoke: () => {
        released = true;
      },
    };
    this.#held.set(lane, held);
    return {
      lane,
      holder,
      alive: () => !released,
      release: () => {
        if (released) return;
        released = true;
        if (this.#held.get(lane) === held) {
          this.#held.delete(lane);
          const key = isApp(lane) ? "app" : lane;
          const list = this.#durations.get(key) ?? [];
          list.push(this.#now() - held.since);
          this.#durations.set(key, list.slice(-20));
        }
        this.#pump();
      },
    };
  }

  /** Grants what can be granted now, most urgent first. */
  #pump(): void {
    const order = [...this.#waiting].sort((a, b) => a.holder.tier - b.holder.tier || a.seq - b.seq);
    for (const waiter of order) {
      if (!this.#free(waiter.lane)) continue;
      const index = this.#waiting.indexOf(waiter);
      if (index < 0) continue;
      this.#waiting.splice(index, 1);
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.done({ ok: true, lease: this.#grant(waiter.lane, waiter.holder) });
    }
  }

  #estimate(lane: HxLaneName): number | null {
    const list = this.#durations.get(isApp(lane) ? "app" : lane) ?? [];
    if (list.length === 0) return null;
    const average = list.reduce((sum, value) => sum + value, 0) / list.length;
    const held = this.#held.get(lane);
    // A holder that is past the usual time may need about half of it again: not “0 seconds”.
    const left = held ? Math.max(average / 2, average - (this.#now() - held.since)) : 0;
    const queued = this.#waiting.filter((waiter) => waiter.lane === lane).length;
    return Math.round(left + queued * average);
  }

  #busyReason(lane: HxLaneName): string {
    const held =
      this.#held.get(lane) ??
      (lane === "focus" ? this.#held.get("system") : lane === "system" ? this.#held.get("focus") : undefined);
    const who = held ? held.holder.name || held.holder.agentId : "";
    if (held && lane === "focus")
      return `Another agent (${who}) uses the keyboard and the front of the screen for a step now.`;
    if (held && lane === "system")
      return `Another agent (${who}) changes a setting, installs, starts or stops an app, or runs a script now.`;
    if (held) return `Another agent (${who}) works in this app now.`;
    if (isApp(lane)) return `Agents work in ${this.#maxApps} apps at the same time already, the most HXBot allows.`;
    return "The computer is busy.";
  }

  /**
   * Waits for a lane until `deadlineAt`. Never rejects: the answer is a lease, or busy with the reason
   * and an estimate, or stopped after the stop keys.
   */
  acquire(lane: HxLaneName, holder: HxLaneHolder, deadlineAt: number, order?: number): Promise<HxLaneAnswer> {
    this.#seq += 1;
    // A call that let the lane go after a step comes back with its first number: first in its tier.
    const seq = order ?? this.#seq;
    const since = this.#now();
    if (this.#free(lane) && !this.#ahead(lane, holder.tier, seq)) {
      return Promise.resolve({ ok: true, lease: this.#grant(lane, holder) });
    }
    return new Promise((resolve) => {
      const waiter: Waiter = { lane, holder, since, seq, done: resolve, timer: null };
      const left = deadlineAt - since;
      const timeOut = () => {
        const index = this.#waiting.indexOf(waiter);
        if (index < 0) return;
        this.#waiting.splice(index, 1);
        resolve({
          ok: false,
          why: "busy",
          reason: this.#busyReason(lane),
          etaMs: this.#estimate(lane),
          waitedMs: this.#now() - since,
        });
      };
      this.#waiting.push(waiter);
      if (left <= 0) {
        timeOut();
        return;
      }
      waiter.timer = setTimeout(timeOut, left);
      // A wait must not hold the app open at the end.
      waiter.timer.unref();
    });
  }

  /** The number the next request gets, for a call that keeps its place in the order. */
  nextOrder(): number {
    return this.#seq + 1;
  }

  /**
   * The stop keys: everyone who waits gets stopped at once, and every held lane is taken back, so a
   * call that holds one sees it gone before its next step (`HxLease.alive`).
   */
  stopAll(): void {
    for (const held of this.#held.values()) held.revoke();
    this.#held.clear();
    const all = this.#waiting.splice(0, this.#waiting.length);
    for (const waiter of all) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.done({
        ok: false,
        why: "stopped",
        reason: "The user stopped the work on the computer.",
        etaMs: null,
        waitedMs: this.#now() - waiter.since,
      });
    }
  }
}

/** The leases of one tool call: taken in the fixed order, all let go when the call ends. */
export class HxLeaseSet {
  readonly #lanes: HxComputerLanes;
  readonly #holder: HxLaneHolder;
  readonly #budget: HxWaitBudget;
  readonly #leases = new Map<HxLaneName, HxLease>();
  /** The place of this call in each lane's order, kept when it lets the lane go after a step. */
  readonly #orders = new Map<HxLaneName, number>();

  constructor(lanes: HxComputerLanes, holder: HxLaneHolder, budget: HxWaitBudget) {
    this.#lanes = lanes;
    this.#holder = holder;
    this.#budget = budget;
  }

  get holder(): HxLaneHolder {
    return this.#holder;
  }

  get budget(): HxWaitBudget {
    return this.#budget;
  }

  /** Whether this call holds the lane now (false after the stop keys took it back). */
  holds(lane: HxLaneName): boolean {
    return this.#leases.get(lane)?.alive() === true;
  }

  /** Takes a lane (once), within what is left of the budget. */
  async take(lane: HxLaneName): Promise<HxLaneAnswer> {
    const held = this.#leases.get(lane);
    if (held?.alive()) return { ok: true, lease: held };
    if (held) this.#leases.delete(lane);
    const order = this.#orders.get(lane) ?? this.#lanes.nextOrder();
    this.#orders.set(lane, order);
    const started = this.#budget.now();
    const answer = await this.#lanes.acquire(lane, this.#holder, this.#budget.deadline(), order);
    this.#budget.spend(this.#budget.now() - started);
    if (answer.ok) this.#leases.set(lane, answer.lease);
    return answer;
  }

  /** Lets one lane go (focus after each step). */
  drop(lane: HxLaneName): void {
    const lease = this.#leases.get(lane);
    if (!lease) return;
    this.#leases.delete(lane);
    lease.release();
  }

  /** Whether a more urgent agent waits for a lane this call holds. */
  shouldYield(lane: HxLaneName): boolean {
    return this.holds(lane) && this.#lanes.moreUrgentWaits(lane, this.#holder.tier);
  }

  releaseAll(): void {
    for (const lane of [...this.#leases.keys()]) this.drop(lane);
  }

  /** The lanes held now, for the test that nothing is held after a call. */
  count(): number {
    return this.#leases.size;
  }
}

/** The waiting time of one tool call: all its waits together, at most `HX_LANE_BUDGET_MS`. */
export class HxWaitBudget {
  readonly #start: number;
  readonly #limit: number;
  readonly #now: () => number;
  /** The time this call has waited so far. Work between the waits does not count. */
  #waited = 0;

  constructor(limitMs: number = HX_LANE_BUDGET_MS, now: () => number = Date.now) {
    this.#limit = limitMs;
    this.#now = now;
    this.#start = now();
  }

  now(): number {
    return this.#now();
  }

  /** The time by which the next wait must end. */
  deadline(): number {
    return this.#now() + this.left();
  }

  spend(ms: number): void {
    this.#waited += Math.max(0, ms);
  }

  /** What is left to wait, in ms. */
  left(): number {
    return Math.max(0, this.#limit - this.#waited);
  }

  /** How long this call has waited, in ms. */
  waited(): number {
    return this.#waited;
  }

  /** Since the call started, for the answer. */
  elapsed(): number {
    return this.#now() - this.#start;
  }
}

/** The lane of an app: its plain name, so "TextEdit" and "textedit" are one app. */
export function hxAppLane(app: string): HxLaneName {
  const key =
    app
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s._-]+/gu, "")
      .slice(0, 60) || "unknown";
  return `app:${key}`;
}

/** The lanes of this process. */
export const hxComputerLanes = new HxComputerLanes();
