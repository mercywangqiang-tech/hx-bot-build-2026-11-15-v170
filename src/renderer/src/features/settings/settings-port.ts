import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

/**
 * What the settings context reaches in main: the app-wide preferences, the switches for updates,
 * notifications and the Dynamic Island, the local agents and their background processes of the
 * Agents tab, and the agents and the user's own notification levels of each server for the
 * Notifications tab.
 */
export interface SettingsPort {
  getAgentDefaults: HxBotDesktopApi["getAgentDefaults"];
  getAgentMemoryLimitPreference: HxBotDesktopApi["getAgentMemoryLimitPreference"];
  getAnalyticsPreference: HxBotDesktopApi["getAnalyticsPreference"];
  getAppBehaviorPreference: HxBotDesktopApi["getAppBehaviorPreference"];
  getApprovalAutomation: HxBotDesktopApi["getApprovalAutomation"];
  getBusyMessageModePreference: HxBotDesktopApi["getBusyMessageModePreference"];
  getExternalLinkPreference: HxBotDesktopApi["getExternalLinkPreference"];
  listExternalLinkBrowsers: HxBotDesktopApi["listExternalLinkBrowsers"];
  chooseExternalLinkApp: HxBotDesktopApi["chooseExternalLinkApp"];
  onExternalLinkFallback: HxBotDesktopApi["onExternalLinkFallback"];
  getRemoteNetworkRoute: HxBotDesktopApi["getRemoteNetworkRoute"];
  getRemoteSessionReusePreference: HxBotDesktopApi["getRemoteSessionReusePreference"];
  onAgentMemoryLimitPreference: HxBotDesktopApi["onAgentMemoryLimitPreference"];
  onAnalyticsPreference: HxBotDesktopApi["onAnalyticsPreference"];
  onApprovalAutomation: HxBotDesktopApi["onApprovalAutomation"];
  onOpenSettings: HxBotDesktopApi["onOpenSettings"];
  onOpenUpdateSettings: HxBotDesktopApi["onOpenUpdateSettings"];
  setAgentDefaults: HxBotDesktopApi["setAgentDefaults"];
  setAnalyticsPreference: HxBotDesktopApi["setAnalyticsPreference"];
  setAppBehaviorPreference: HxBotDesktopApi["setAppBehaviorPreference"];
  setBusyMessageModePreference: HxBotDesktopApi["setBusyMessageModePreference"];
  setExternalLinkPreference: HxBotDesktopApi["setExternalLinkPreference"];
  setRemoteNetworkRoute: HxBotDesktopApi["setRemoteNetworkRoute"];
  setRemoteSessionReusePreference: HxBotDesktopApi["setRemoteSessionReusePreference"];
  agent: Pick<
    HxBotDesktopApi["agent"],
    "listAgents" | "updateAgent" | "listAgentNotificationLevels" | "setAgentNotificationLevel" | "onScopedEvent"
  >;
  backgroundProcesses: HxBotDesktopApi["backgroundProcesses"];
  dynamicIsland: Pick<
    HxBotDesktopApi["dynamicIsland"],
    "getBuiltInDisplayGeometry" | "getPreference" | "setPreference"
  >;
  notifications: Pick<HxBotDesktopApi["notifications"], "getPreference" | "openSettings" | "setPreference" | "test">;
  update: Pick<HxBotDesktopApi["update"], "getPreference" | "onPreference" | "setPreference">;
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function settingsPort(): SettingsPort {
  return window.hxbot;
}
