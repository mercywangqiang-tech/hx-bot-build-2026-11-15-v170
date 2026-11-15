// HXBot: the requests the OpenCode connection dialog sends to main (hx-opencode).

import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

export type HxOpenCodePort = Pick<
  HxBotDesktopApi,
  | "hxOpenCodeCatalog"
  | "hxOpenCodeConnectKey"
  | "hxOpenCodeConnectExternal"
  | "hxOpenCodeStartSignIn"
  | "hxOpenCodeSignInStatus"
  | "hxOpenCodeCompleteSignIn"
  | "hxOpenCodeCancelSignIn"
  | "hxOpenCodeDisconnect"
  | "openUrl"
>;

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function hxOpenCodePort(): HxOpenCodePort {
  return window.hxbot;
}
