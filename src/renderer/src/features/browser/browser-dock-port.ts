import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

/**
 * What the browser dock overlay reaches in main: the presentation, the actions, the frame, and the code
 * that the agent asks for. The overlay has no provider tree, so this is a module.
 */
export interface BrowserDockPort {
  agent: Pick<HxBotDesktopApi["agent"], "respondToBrowserSecret">;
  browserDock: Pick<
    HxBotDesktopApi["browserDock"],
    "getPresentation" | "onPresentation" | "performAction" | "setFrame"
  >;
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function browserDockPort(): BrowserDockPort {
  return window.hxbot;
}
