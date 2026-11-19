// HXBot 电脑操控（五）（v1.7.3，需求 CONC-06）：停放与自动续做。
//
// 一步前台操作拿不到前台（你在用电脑、最前面不是要操作的那个窗口、屏幕锁着），这一步和后面的步骤就停放：
// 工具马上答复“等待用户”，助手先做不用前台的部分或结束这一轮；租约全部放掉。HXBot 记下这个助手停在哪个窗口、
// 还剩几步。之后每秒看一次：你停手够久、最前面就是那个窗口、屏幕没锁，就给这个助手发一条“继续”（走信箱队列）。
// 停放只记在内存里：HXBot 重启后不会自己续做。同一个助手再用电脑工具、你回复“放弃”、或按了停止键，这条记录就
// 去掉；停放满 30 分钟提醒你一次。“停放后自动续做”关着时只记不发，等你回复“现在做”。你回复“现在做”后两分钟内，
// 这个助手的前台步骤可以把那个窗口切到最前面马上做（gate.ts）。发送、付款、删除这类步骤续做时照样先问你
// （steps.ts 的 confirm 不因续做而跳过）。

import { hxIdleNeeded } from "./presence";

export interface HxParkedWindow {
  pid: number;
  windowId: number;
  app: string;
  title: string;
}

export interface HxParkedWork {
  agentId: string;
  tier: number;
  window: HxParkedWindow;
  /** How many steps of the call were not done. */
  remaining: number;
  since: number;
  why: "user_active" | "other_window" | "locked";
  /** Set when the 30-minute reminder was given. */
  reminded?: boolean;
}

/** What the watcher reads and does. */
export interface HxParkHost {
  userIdleMs(): number;
  locked(): boolean;
  /** The window in front now, or null when it cannot be told. */
  frontWindow(): Promise<{ pid: number; windowId: number | null } | null>;
  /** Sends the agent its "continue" message. */
  resume(work: HxParkedWork): Promise<void>;
  /** Whether this agent resumes by itself (the setting “停放后自动续做”; default on). */
  autoResume(agentId: string): boolean;
  /** A line in the agent's chat after 30 minutes. */
  remind?(work: HxParkedWork): void;
}

/** After this long, a parked step is told once in the chat (the record stays). */
export const HX_PARK_REMIND_MS = 30 * 60_000;
/** How long the user's “现在做” lets this agent take the front. */
export const HX_NOW_CONSENT_MS = 120_000;
const HX_PARK_CHECK_MS = 1_000;
/**
 * HXBot (v1.7.3, review): reading the front window starts a small process on the Mac and Windows.
 * Work parked longer than a minute reads it every 5 seconds, not every second, while the user rests
 * in another window.
 */
const HX_PARK_SLOW_AFTER_MS = 60_000;
const HX_PARK_SLOW_CHECK_MS = 5_000;

/**
 * Whether the front is the parked window: the same window, not only the same app (CONC-06). Where
 * the front window cannot be told (no number), the same app counts, as before v1.7.3.
 */
export function hxSameWindow(
  front: { pid: number; windowId: number | null } | null,
  window: Pick<HxParkedWindow, "pid" | "windowId">,
): boolean {
  if (!front) return false;
  if (front.windowId !== null) return front.windowId === window.windowId;
  return front.pid === window.pid;
}

export class HxParkedSteps {
  readonly #work = new Map<string, HxParkedWork>();
  /** When the user answered “现在做”, per agent. */
  readonly #consent = new Map<string, number>();
  /** The agents with a computer call running now: the watch does not send them “continue”. */
  readonly #held = new Map<string, number>();
  #host: HxParkHost | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #checking = false;
  /** When the watch last read the front window. */
  #frontReadAt = Number.NEGATIVE_INFINITY;
  readonly #now: () => number;
  readonly #every: (body: () => void, ms: number) => ReturnType<typeof setInterval>;

  constructor(
    options: { now?: () => number; every?: (body: () => void, ms: number) => ReturnType<typeof setInterval> } = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#every = options.every ?? ((body, ms) => setInterval(body, ms));
  }

  setHost(host: HxParkHost | null): void {
    this.#host = host;
    this.#arm();
  }

  park(work: HxParkedWork): void {
    this.#work.set(work.agentId, work);
    this.#arm();
  }

  /** The agent used the computer tools again, or gave up: its parked step goes. */
  drop(agentId: string): void {
    this.#work.delete(agentId);
    this.#arm();
  }

  dropAll(): void {
    this.#work.clear();
    this.#consent.clear();
    this.#arm();
  }

  /** A computer call of this agent runs: its parked step is not resumed meanwhile. */
  hold(agentId: string): void {
    this.#held.set(agentId, (this.#held.get(agentId) ?? 0) + 1);
  }

  release(agentId: string): void {
    const count = (this.#held.get(agentId) ?? 0) - 1;
    if (count > 0) this.#held.set(agentId, count);
    else this.#held.delete(agentId);
  }

  /** The user answered “现在做” to this agent. */
  consent(agentId: string): void {
    this.#consent.set(agentId, this.#now());
  }

  /** Whether the user's “现在做” for this agent is fresh. It holds for the rest of that call. */
  consented(agentId: string): boolean {
    const at = this.#consent.get(agentId);
    if (at === undefined) return false;
    if (this.#now() - at > HX_NOW_CONSENT_MS) {
      this.#consent.delete(agentId);
      return false;
    }
    return true;
  }

  /** The consent is used up when the call that used it ends. */
  useConsent(agentId: string): void {
    this.#consent.delete(agentId);
  }

  get(agentId: string): HxParkedWork | null {
    return this.#work.get(agentId) ?? null;
  }

  size(): number {
    return this.#work.size;
  }

  #arm(): void {
    const need = this.#work.size > 0 && this.#host !== null;
    if (need && !this.#timer) {
      this.#timer = this.#every(() => void this.check(), HX_PARK_CHECK_MS);
      this.#timer.unref();
    } else if (!need && this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** One look: resumes the parked work whose window is in front while the user rests. */
  async check(): Promise<void> {
    const host = this.#host;
    if (!host || this.#checking || this.#work.size === 0) return;
    this.#checking = true;
    try {
      const now = this.#now();
      for (const work of this.#work.values()) {
        if (work.reminded || now - work.since < HX_PARK_REMIND_MS) continue;
        work.reminded = true;
        try {
          host.remind?.(work);
        } catch {
          // A line in the chat is not worth stopping the watch for.
        }
      }
      if (host.locked()) return;
      const idle = host.userIdleMs();
      // With the setting off, the record waits for the user's “现在做”: no front window to read for it.
      const ready = [...this.#work.values()].filter(
        (work) => idle >= hxIdleNeeded(work.tier) && !this.#held.has(work.agentId) && host.autoResume(work.agentId),
      );
      if (ready.length === 0) return;
      const fresh = ready.some((work) => now - work.since < HX_PARK_SLOW_AFTER_MS);
      if (!fresh && now - this.#frontReadAt < HX_PARK_SLOW_CHECK_MS) return;
      this.#frontReadAt = now;
      const front = await host.frontWindow();
      for (const work of ready) {
        if (!hxSameWindow(front, work.window)) continue;
        // It may have been dropped, or its agent may have called again, while the front was read.
        if (this.#work.get(work.agentId) !== work || this.#held.has(work.agentId)) continue;
        if (!host.autoResume(work.agentId)) continue;
        this.#work.delete(work.agentId);
        await host.resume(work).catch(() => undefined);
      }
    } finally {
      this.#checking = false;
      this.#arm();
    }
  }
}

/** The parked steps of this process. */
export const hxParkedSteps = new HxParkedSteps();
