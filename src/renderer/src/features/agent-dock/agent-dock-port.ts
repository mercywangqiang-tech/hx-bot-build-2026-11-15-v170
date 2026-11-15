import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

/** What the agent dock window and the main renderer reach in main for the dock. */
export interface AgentDockPort {
  agentDock: HxBotDesktopApi["agentDock"];
}

/** Read on each call: stories replace `window.hxbot` per case. */
export function agentDockPort(): AgentDockPort {
  return window.hxbot;
}
