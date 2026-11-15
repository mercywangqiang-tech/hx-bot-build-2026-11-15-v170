import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

/**
 * What team presence reaches in main: who is online, and whether this member is typing.
 */
export interface TeamPort {
  servers: Pick<HxBotDesktopApi["servers"], "onPresence" | "setTyping">;
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function teamPort(): TeamPort {
  return window.hxbot;
}
