// HXBot (v1.7.0, F4): HXBot does not take the front from the app the user works in.
// A page that an agent's tool wants open (System Settings), or a question for the user, comes to the
// front only while the user works in HXBot. Otherwise the user gets a notification, and it opens
// on a click. One page opens or asks at most once in a short time, so a tool that tries again and
// again does not pull System Settings to the front again and again.
import { app, BrowserWindow, Notification } from "electron";
import { closeRetainedNotification, showRetainedNotification } from "./desktop-notifications";

/** While the user works in HXBot: one page opens at most once in this time. */
export const HX_OPEN_AGAIN_MS = 60_000;
/** While the user works in another app: one notification for a page at most once in this time. */
export const HX_ASK_AGAIN_MS = 10 * 60_000;

export interface HxAskText {
  title: string;
  body: string;
}

/** What the user sees: a notification that runs `onClick` when clicked. Null when none can show. */
type HxNotify = (text: HxAskText, onClick: () => void) => { close(): void } | null;

export interface HxAskFirstDeps {
  /** True while a window of HXBot has the keyboard: the user works in HXBot. */
  userInHxbot(): boolean;
  notify: HxNotify;
  now(): number;
}

export type HxAskOutcome = "opened" | "asked" | "skipped";

export class HxAskFirst {
  readonly #deps: HxAskFirstDeps;
  readonly #opened = new Map<string, number>();
  readonly #asked = new Map<string, number>();

  constructor(deps: HxAskFirstDeps) {
    this.#deps = deps;
  }

  /**
   * Opens the page now when the user works in HXBot, or shows a notification that opens it on a
   * click. "skipped" when the same page opened or asked a short time ago. Never rejects.
   */
  async open(key: string, open: () => Promise<void>, text: HxAskText): Promise<HxAskOutcome> {
    const now = this.#deps.now();
    if (this.#deps.userInHxbot()) {
      if (now - (this.#opened.get(key) ?? Number.NEGATIVE_INFINITY) < HX_OPEN_AGAIN_MS) return "skipped";
      this.#opened.set(key, now);
      await open().catch(() => undefined);
      return "opened";
    }
    if (now - (this.#asked.get(key) ?? Number.NEGATIVE_INFINITY) < HX_ASK_AGAIN_MS) return "skipped";
    this.#asked.set(key, now);
    const shown = this.#deps.notify(text, () => {
      this.#opened.set(key, this.#deps.now());
      void open().catch(() => undefined);
    });
    return shown ? "asked" : "skipped";
  }
}

/** True while a window of HXBot has the keyboard. */
export function hxUserInHxbot(): boolean {
  const focused = BrowserWindow.getFocusedWindow();
  return focused !== null && !focused.isDestroyed();
}

/** A notification of the operating system, kept until it is clicked or closed. */
const hxNotify: HxNotify = (text, onClick) => {
  if (!Notification.isSupported()) return null;
  const notification = new Notification({ title: text.title, body: text.body });
  notification.on("click", onClick);
  showRetainedNotification(notification);
  return { close: () => closeRetainedNotification(notification) };
};

/** The one instance for the pages that agents' tools open. */
export const hxAskFirst = new HxAskFirst({ userInHxbot: hxUserInHxbot, notify: hxNotify, now: Date.now });

/**
 * A question for the user while the user works in another app: a notification, and the Dock icon
 * bounces (macOS) or the taskbar button flashes (Windows). True when the user clicks the
 * notification, false when `signal` aborts first. True at once when no notification can show,
 * because the question must still reach the user.
 */
export function hxWaitForClick(signal: AbortSignal, text: HxAskText, window: BrowserWindow | null): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let bounce: number | undefined;
    const done = (answer: boolean) => {
      signal.removeEventListener("abort", aborted);
      if (bounce !== undefined) app.dock?.cancelBounce(bounce);
      if (window && !window.isDestroyed()) window.flashFrame(false);
      shown?.close();
      resolve(answer);
    };
    const aborted = () => done(false);
    const shown = hxNotify(text, () => done(true));
    if (!shown) {
      resolve(true);
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    bounce = app.dock?.bounce("critical");
    if (process.platform === "win32" && window && !window.isDestroyed()) window.flashFrame(true);
  });
}
