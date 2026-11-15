import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

/**
 * What the browser domain reaches in main: the tabs, the display and control state, and the
 * picture-in-picture window. The picture-in-picture window has no provider tree, so this is a module.
 */
export interface BrowserPort {
  browser: Pick<
    HxBotDesktopApi["browser"],
    | "activate"
    | "close"
    | "dockPictureInPicture"
    | "getControlState"
    | "getDisplayState"
    | "hidePictureInPicture"
    | "onDisplayState"
    | "onLiveViewEvent"
    | "sendLiveViewInput"
    | "setVisible"
    | "startLiveView"
    | "stopLiveView"
  >;
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function browserPort(): BrowserPort {
  return window.hxbot;
}
