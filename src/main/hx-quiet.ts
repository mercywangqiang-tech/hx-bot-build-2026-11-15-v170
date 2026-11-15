// HXBot 不打扰其他应用（v1.7.0）：主进程里的两处。
//
// 用户 2026-11-14：“HXBot经常影响其他应用的运行！在V1.7.0必须完全解决！Windows也会存在这样的问题！”
//
// 一、电脑操控的高亮框（computer-use-highlight-window.ts）原来每 33 毫秒（每秒 30 次）向驱动要一次全部
// 窗口：有助手在干活时一直这样，每个应用都要不停回答系统的查询，风扇响、别的应用变卡。改为每 250 毫秒看一次，
// 只在驱动最近 15 秒里有过动作时才去读，而且每秒最多读两次；没有动作时不读、不画框。
//
// 二、Windows 上的“鼠标穿透 + 转发”（setIgnoreMouseEvents 的 forward）由 Electron 装一个全局低级鼠标钩子
// 实现：HXBot 一忙，整台电脑的鼠标都跟着卡。灵动岛和停靠栏要靠转发知道鼠标进来了，所以在 Windows 上只在
// 鼠标靠近它们时才转发，平时不装钩子；高亮框什么都不接，根本不转发。Mac 上照旧。

import { type Point, type Rectangle, screen } from "electron";

/** How often the rim looks: four times a second (it was 30). */
export const HX_RIM_POLL_MS = 250;
/** The rim shows only this long after the driver last acted. */
export const HX_RIM_ACTIVE_MS = 15_000;
/** The driver is read at most twice a second. */
export const HX_RIM_READ_GAP_MS = 500;

/** Whether one tick of the rim reads the driver. */
export class HxRimQuiet {
  #lastRead = Number.NEGATIVE_INFINITY;
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /**
   * "hide" when the driver did nothing lately (no read, no rim), "keep" when it read a moment ago
   * (the rim stays where it is), "read" otherwise.
   */
  next(actedLately: boolean): "hide" | "keep" | "read" {
    if (!actedLately) return "hide";
    const now = this.#now();
    if (now - this.#lastRead < HX_RIM_READ_GAP_MS) return "keep";
    this.#lastRead = now;
    return "read";
  }
}

export interface HxMouseWindow {
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
  getBounds(): Rectangle;
  isVisible(): boolean;
  isDestroyed(): boolean;
}

interface HxMouseOptions {
  platform?: NodeJS.Platform;
  cursor?: () => Point;
  /** Calls `body` every `ms` and gives the function that stops it. */
  every?: (body: () => void, ms: number) => () => void;
}

const NEAR_PX = 32;
const WATCH_MS = 100;
const watches = new WeakMap<HxMouseWindow, { cancel: () => void; forward: boolean | null }>();

function near(point: Point, bounds: Rectangle): boolean {
  return (
    point.x >= bounds.x - NEAR_PX &&
    point.x <= bounds.x + bounds.width + NEAR_PX &&
    point.y >= bounds.y - NEAR_PX &&
    point.y <= bounds.y + bounds.height + NEAR_PX
  );
}

/**
 * `setIgnoreMouseEvents(ignore, { forward: true })` for a window that has to see the pointer come in.
 * On Windows the forwarding is on only while the pointer is near the window.
 */
export function hxIgnoreMouse(window: HxMouseWindow, ignore: boolean, options: HxMouseOptions = {}): void {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    window.setIgnoreMouseEvents(ignore, { forward: true });
    return;
  }
  const watch = watches.get(window);
  if (!ignore) {
    if (watch) {
      watch.cancel();
      watches.delete(window);
    }
    window.setIgnoreMouseEvents(false);
    return;
  }
  const cursor = options.cursor ?? (() => screen.getCursorScreenPoint());
  const state = watch ?? { cancel: () => undefined, forward: null };
  const update = () => {
    if (window.isDestroyed()) {
      state.cancel();
      watches.delete(window);
      return;
    }
    const forward = window.isVisible() && near(cursor(), window.getBounds());
    if (forward === state.forward) return;
    state.forward = forward;
    window.setIgnoreMouseEvents(true, { forward });
  };
  state.forward = null;
  update();
  if (!watch && !window.isDestroyed()) {
    const every =
      options.every ??
      ((body: () => void, ms: number) => {
        const timer = setInterval(body, ms);
        // A watch must not hold the app open at quit.
        timer.unref();
        return () => clearInterval(timer);
      });
    state.cancel = every(update, WATCH_MS);
    watches.set(window, state);
  }
}
