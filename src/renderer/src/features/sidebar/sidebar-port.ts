import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

/**
 * What the sidebar reaches in main: the saved sidebar layout and its changes, the pins that the host
 * keeps for all devices of the user, the free space on the disk of a server for the storage card, and
 * its machine use and alert levels for the machine card.
 */
export interface SidebarPort {
  agent: Pick<
    HxBotDesktopApi["agent"],
    "getSidebarLayout" | "mutateSidebarLayout" | "getSidebarPins" | "setSidebarPins" | "seedSidebarPins"
  >;
  storage: Pick<HxBotDesktopApi["storage"], "getDisk" | "getMachineMetrics">;
  hostAdmin: Pick<HxBotDesktopApi["hostAdmin"], "getMachineAlerts">;
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function sidebarPort(): SidebarPort {
  return window.hxbot;
}
