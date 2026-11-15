import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

/**
 * What the dynamic island reaches in main: its presentation, preference, geometry and actions, and
 * the agent events it shows. The island window has no provider tree, so this is a module.
 */
export interface DynamicIslandPort {
  agent: Pick<HxBotDesktopApi["agent"], "acknowledgeFailedTurn" | "onScopedEvent">;
  dynamicIsland: Pick<
    HxBotDesktopApi["dynamicIsland"],
    | "getPreference"
    | "getPresentation"
    | "onAction"
    | "onGeometry"
    | "onPreference"
    | "onPresentation"
    | "performAction"
    | "performHaptic"
    | "publishPresentation"
    | "setInteractive"
  >;
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function dynamicIslandPort(): DynamicIslandPort {
  return window.hxbot;
}
