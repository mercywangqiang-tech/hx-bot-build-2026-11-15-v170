// HXBot 电脑操控（五）（v1.7.3，需求 CONC-06）：你在用电脑时让开。
//
// 前台的按键和点击只在你停手至少 5 秒（定时任务这类后台工作要 60 秒）、屏幕没锁时才做。系统的“空闲时间”
// 把驱动替助手发的按键和点击也算成有人在用：HXBot 记下自己每次发输入的时间段，读到的最后一次输入落在这些
// 时间段里（前 0.25 秒到后 1 秒）时不算你的（主进程给 HXBot 的读数来自 Electron 的 powerMonitor，按整秒）。
// 读到的输入既不是你的、HXBot 又从没见过你的输入时，按“你刚刚在用”处理：宁可多等，不往你手下发键。
// 一次输入从开始就记下（v1.7.3 真机检查：别的助手的门在这次输入还没结束时读到它，当成了你的），到结束后 1 秒为止。
// 盲区：你和 HXBot 在同一瞬间输入时，系统只记最后一次，HXBot 看不出你的那一次；这时靠“最前面的窗口变没变”兜底。

/** What the main process reads for HXBot: the system's idle time, and whether the screen is locked. */
export interface HxPresenceSource {
  /** Seconds since the last keyboard or mouse input, whoever made it. */
  idleSeconds(): number;
  locked(): boolean;
}

/** How long the user must have stopped before a foreground step, for the user's own work. */
export const HX_USER_IDLE_MS = 5_000;
/** The same for background work: routines and other tier-3 turns (CONC-06). */
export const HX_BACKGROUND_IDLE_MS = 60_000;
/** Inputs HXBot made: an input the system reports this long after one of them is still HXBot's. */
const OWN_INPUT_TAIL_MS = 1_000;
const OWN_INPUT_HEAD_MS = 250;
const OWN_INPUT_KEEP_MS = 120_000;

/** The idle time the user must have for a foreground step of a turn of this tier. */
export function hxIdleNeeded(tier: number) {
  return tier >= 3 ? HX_BACKGROUND_IDLE_MS : HX_USER_IDLE_MS;
}

export class HxPresence {
  #source: HxPresenceSource | null = null;
  readonly #now: () => number;
  /** HXBot's own inputs: [start, end] in ms. */
  #own: Array<[number, number]> = [];
  /** HXBot's inputs under way: id → start, in ms. */
  readonly #open = new Map<number, number>();
  #opened = 0;
  /** The last input that was the user's, in ms; null until one was seen. */
  #lastUserAt: number | null = null;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  setSource(source: HxPresenceSource | null): void {
    this.#source = source;
  }

  /** Whether HXBot can tell at all (the main process gave a source). */
  known(): boolean {
    return this.#source !== null;
  }

  /**
   * HXBot sent input between these times (the driver's click, key or text). The gate reads the
   * user's idle time before each such input, so the user's last input is known before HXBot's hides it.
   */
  noteOwnInput(start: number, end: number = this.#now()): void {
    const now = this.#now();
    this.#own = this.#own.filter(([, until]) => now - until < OWN_INPUT_KEEP_MS);
    this.#own.push([start, Math.max(start, end)]);
  }

  /**
   * HXBot starts an input now. Until the returned function is called, every input the system reports
   * after the start is HXBot's; then the input is kept as [start, end] like `noteOwnInput`. An input
   * that never ends counts for at most two minutes.
   */
  beginOwnInput(start: number = this.#now()): () => void {
    this.#opened += 1;
    const id = this.#opened;
    this.#open.set(id, start);
    return () => {
      if (!this.#open.delete(id)) return;
      this.noteOwnInput(start, this.#now());
    };
  }

  #ours(at: number): boolean {
    const now = this.#now();
    for (const start of this.#open.values())
      if (now - start < OWN_INPUT_KEEP_MS && at >= start - OWN_INPUT_HEAD_MS) return true;
    return this.#own.some(([start, end]) => at >= start - OWN_INPUT_HEAD_MS && at <= end + OWN_INPUT_TAIL_MS);
  }

  /**
   * How long the user has not used the keyboard and the mouse, in ms. Infinity when HXBot cannot tell
   * (no source: the steps behave as before v1.7.3); 0 when the last input is HXBot's and no input of
   * the user was ever seen.
   */
  userIdleMs(): number {
    const source = this.#source;
    if (!source) return Number.POSITIVE_INFINITY;
    const now = this.#now();
    let idle: number;
    try {
      idle = Math.max(0, source.idleSeconds()) * 1000;
    } catch {
      return 0;
    }
    const lastInput = now - idle;
    if (!this.#ours(lastInput)) this.#lastUserAt = Math.max(this.#lastUserAt ?? lastInput, lastInput);
    if (this.#lastUserAt === null) return 0;
    return Math.max(0, now - this.#lastUserAt);
  }

  /** Whether the user made an input after `at` (ms). */
  userActedSince(at: number): boolean {
    const idle = this.userIdleMs();
    if (!Number.isFinite(idle)) return false;
    return this.#now() - idle > at;
  }

  locked(): boolean {
    try {
      return this.#source?.locked() === true;
    } catch {
      return false;
    }
  }
}

/** The presence of this process. */
export const hxPresence = new HxPresence();
