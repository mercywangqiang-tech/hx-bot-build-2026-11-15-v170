import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

/** What the Voice tab reaches in main: the dictation models and the dictation settings. */
export interface VoicePort {
  voice: HxBotDesktopApi["voice"];
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function voicePort(): VoicePort {
  return window.hxbot;
}
