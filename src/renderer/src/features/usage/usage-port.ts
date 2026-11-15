import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

/**
 * What the usage panel reaches in main: the analytics of a server, its agents, and the events that
 * make the report stale.
 */
export interface UsagePort {
  agent: Pick<HxBotDesktopApi["agent"], "getHostAnalytics" | "listAgents" | "onScopedEvent">;
  servers: Pick<HxBotDesktopApi["servers"], "onEvent">;
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function usagePort(): UsagePort {
  return window.hxbot;
}
