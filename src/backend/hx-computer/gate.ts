// HXBot 电脑操控（五）（v1.7.3，需求 CONC-05、CONC-06）：每一步前台操作之前的“门”。
//
// 后台的步骤（无障碍接口的点击、直接赋值、菜单）只用这次调用一开始拿到的 app 道，几个助手在不同应用里可以同时做。
// 要往最前面发键、在前台点击、滚动、拖动的步骤，先过这道门：
//   1. 停止键按过、或这次调用的道被收回了：停下。
//   2. 屏幕锁着：停放。
//   3. 你停手不够 5 秒（定时任务这类后台工作要 60 秒）：等，最多用完这次调用剩下的等待时间（合计 30 秒），
//      然后停放。这次调用里做过前台步骤以后你又动了：马上停放。
//   4. 最前面的不是要操作的那个窗口（同一个应用的另一个窗口也不行；这次调用开始以后才出现的同一应用的窗口，
//      比如它自己打开的“存储”对话框，算同一个）：同样等，然后停放。
//   5. 拿 focus 道（全机一个，和 system 道互斥）。等 focus 的时候你回来了，放掉 focus 回到第 3 条。
// 你回复了“现在做”：先把那个窗口切到最前面，不再等你停手，但最前面换了窗口照样停放。
// 每一步做完放掉 focus；有更急的助手（你自己发的消息）在等这个应用时，做完这一步就让出来，答复“忙”。
// HXBot 自己发出的输入记在 presence.ts，不算成你在用。
import type { HxLaneName, HxLeaseSet } from "./lanes";
import { hxIdleNeeded } from "./presence";

/** The window a run acts on. */
export interface HxGateWindow {
  pid: number;
  windowId: number;
  app: string;
  title: string;
}

export type HxGateWhy = "user_active" | "other_window" | "locked";

export type HxGateStop =
  | { stop: "waiting_user"; why: HxGateWhy; reason: string }
  | { stop: "busy"; reason: string; etaMs: number | null }
  | { stop: "stopped"; reason: string };

/** What a run asks before and after the input of a step (steps.ts). Tests pass a double. */
export interface HxStepGate {
  /** Before an input that reaches the front of the screen. Null: go on, the focus is held for this step. */
  front(window: HxGateWindow): Promise<HxGateStop | null>;
  /**
   * HXBot starts an input now (a driver call): what the system reports from now until the returned
   * function is called, and a moment after, is HXBot's, not the user's. Another agent's gate may read
   * the user's presence while this input is under way (real check of v1.7.3, macOS 15).
   */
  ownInput(): () => void;
  /** After each step: the focus goes. A stop when a more urgent agent waits for this app. */
  after(): HxGateStop | null;
  /** Before each step: a stop after the stop keys, or when the call lost its app lane. */
  check(): HxGateStop | null;
}

/** What the gate reads. */
export interface HxGatePresence {
  known(): boolean;
  userIdleMs(): number;
  userActedSince(at: number): boolean;
  locked(): boolean;
  beginOwnInput(): () => void;
}

export interface HxGateDeps {
  leases: HxLeaseSet;
  /** The app lane of this call, held for the whole call. */
  app: HxLaneName;
  presence: HxGatePresence;
  /** The window in front now; null when it cannot be told. */
  frontWindow(): Promise<{ pid: number; windowId: number | null } | null>;
  /** The windows of the target app when the call started. */
  known: ReadonlySet<number>;
  /** Whether the user answered “现在做” to this agent. */
  consented(): boolean;
  /** Brings the window to the front, for “现在做”. */
  bringToFront(window: HxGateWindow): Promise<boolean>;
  /** This agent had parked work when the call started: a step that cannot take the front parks at once. */
  parkedAlready: boolean;
  stopped(): boolean;
  wait(ms: number): Promise<void>;
  now(): number;
}

/** How often the gate looks again while it waits for the user. */
const HX_GATE_LOOK_MS = 1_000;

const STOPPED = "The user stopped the work on the computer.";

/** Whether the front window is the window of the run, or a window of its app that the work opened. */
export function hxFrontIsTarget(
  front: { pid: number; windowId: number | null } | null,
  window: Pick<HxGateWindow, "pid" | "windowId">,
  known: ReadonlySet<number>,
): boolean {
  // As in v1.7.0: when the front cannot be told, the step is not held back.
  if (!front) return true;
  if (front.windowId === null) return front.pid === window.pid;
  if (front.windowId === window.windowId) return true;
  return front.pid === window.pid && !known.has(front.windowId);
}

function parkReason(why: HxGateWhy, window: HxGateWindow, idleSeconds: number): string {
  const name = window.title ? `${window.app} – ${window.title}` : window.app;
  const after = `HXBot parked this step and sends you a message to continue when the user has not used the keyboard or the mouse for ${idleSeconds} seconds and ${name} is the window in front. Until then, do the parts of the work that do not need the screen, or end this turn; do not call this step again before that message. HXBot told the user in the chat that they can reply “现在做” (do it now) or “放弃” (drop it): after “现在做”, run the remaining steps again at once, and HXBot brings ${window.app} to the front; after “放弃”, do not do them.`;
  if (why === "locked") return `The screen of this computer is locked. ${after}`;
  if (why === "other_window")
    return `The user works in another window now (${name} is not in front), and HXBot does not take the front from the user. ${after}`;
  return `The user is using the keyboard or the mouse now, and HXBot does not type or click under the user's hands. ${after}`;
}

/** The gate of one tool call. */
export class HxComputerGate implements HxStepGate {
  readonly #deps: HxGateDeps;
  /** The focus is held for the current step. */
  #frontHeld = false;
  /** When this call last got the front: the user acting after it parks the run. */
  #lastFrontAt: number | null = null;
  #brought = false;

  constructor(deps: HxGateDeps) {
    this.#deps = deps;
  }

  check(): HxGateStop | null {
    if (this.#deps.stopped()) return { stop: "stopped", reason: STOPPED };
    if (!this.#deps.leases.holds(this.#deps.app)) return { stop: "stopped", reason: STOPPED };
    return null;
  }

  ownInput(): () => void {
    return this.#deps.presence.beginOwnInput();
  }

  after(): HxGateStop | null {
    const { leases, app } = this.#deps;
    if (this.#frontHeld) {
      this.#frontHeld = false;
      leases.drop("focus");
    }
    if (leases.shouldYield(app)) {
      return {
        stop: "busy",
        reason:
          "A more urgent turn (a message the user just sent) waits for this app, so HXBot stopped after the steps listed as done. Run the remaining steps again in a while.",
        etaMs: null,
      };
    }
    return null;
  }

  async #takeFocus(): Promise<HxGateStop | null> {
    const answer = await this.#deps.leases.take("focus");
    if (answer.ok) return null;
    if (answer.why === "stopped") return { stop: "stopped", reason: STOPPED };
    return { stop: "busy", reason: answer.reason, etaMs: answer.etaMs };
  }

  #park(why: HxGateWhy, window: HxGateWindow, needed: number): HxGateStop {
    return { stop: "waiting_user", why, reason: parkReason(why, window, Math.round(needed / 1000)) };
  }

  async front(window: HxGateWindow): Promise<HxGateStop | null> {
    const deps = this.#deps;
    const early = this.check();
    if (early) return early;
    if (this.#frontHeld) return null;
    if (!deps.presence.known()) {
      // No reading of the user's presence (an older main process): only the focus lane, as before.
      const stop = await this.#takeFocus();
      if (stop) return stop;
      this.#frontHeld = true;
      return null;
    }
    const needed = hxIdleNeeded(deps.leases.holder.tier);
    const consent = deps.consented();
    if (!consent && this.#lastFrontAt !== null && deps.presence.userActedSince(this.#lastFrontAt))
      return this.#park("user_active", window, needed);
    for (;;) {
      const stop = this.check();
      if (stop) return stop;
      if (deps.presence.locked()) return this.#park("locked", window, needed);
      let why: HxGateWhy | null = null;
      if (!consent && deps.presence.userIdleMs() < needed) why = "user_active";
      else {
        if (consent && !this.#brought) {
          this.#brought = true;
          await deps.bringToFront(window).catch(() => false);
        }
        if (!hxFrontIsTarget(await deps.frontWindow().catch(() => null), window, deps.known)) why = "other_window";
      }
      if (why === null) {
        const busy = await this.#takeFocus();
        if (busy) return busy;
        // The user may have come back while the focus was busy.
        if (!consent && deps.presence.userIdleMs() < needed) {
          deps.leases.drop("focus");
          why = "user_active";
        } else {
          this.#frontHeld = true;
          this.#lastFrontAt = deps.now();
          return null;
        }
      }
      const left = deps.leases.budget.left();
      if (deps.parkedAlready || left <= 0) return this.#park(why, window, needed);
      const started = deps.now();
      await deps.wait(Math.min(HX_GATE_LOOK_MS, left));
      deps.leases.budget.spend(Math.max(1, deps.now() - started));
    }
  }
}
