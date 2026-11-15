import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";
import type { CompanySignInCalls } from "./features/servers/ServerCompanySignInSection";

/**
 * What the app shell and the cross-domain root modules reach in main, plus the shell actions
 * (`openUrl`, `openExternal`) that several domains share.
 */
export interface AppPort {
  getAppInfo: HxBotDesktopApi["getAppInfo"];
  getAppAppearancePreference: HxBotDesktopApi["getAppAppearancePreference"];
  getAppInterfaceSizePreference: HxBotDesktopApi["getAppInterfaceSizePreference"];
  getAppLanguagePreference: HxBotDesktopApi["getAppLanguagePreference"];
  getAppLogoColorPreference: HxBotDesktopApi["getAppLogoColorPreference"];
  onAppAppearancePreference: HxBotDesktopApi["onAppAppearancePreference"];
  onAppInterfaceSizePreference: HxBotDesktopApi["onAppInterfaceSizePreference"];
  onAppLanguagePreference: HxBotDesktopApi["onAppLanguagePreference"];
  onAppLogoColorPreference: HxBotDesktopApi["onAppLogoColorPreference"];
  openExternal: HxBotDesktopApi["openExternal"];
  getSentMessageStats: HxBotDesktopApi["getSentMessageStats"];
  reportRendererTiming: HxBotDesktopApi["reportRendererTiming"];
  openUrl: HxBotDesktopApi["openUrl"];
  openChatWindow: HxBotDesktopApi["openChatWindow"];
  getChatWindows: HxBotDesktopApi["getChatWindows"];
  onChatWindows: HxBotDesktopApi["onChatWindows"];
  onQuitShortcutHint: HxBotDesktopApi["onQuitShortcutHint"];
  setAppAppearancePreference: HxBotDesktopApi["setAppAppearancePreference"];
  setAppInterfaceSizePreference: HxBotDesktopApi["setAppInterfaceSizePreference"];
  setAppLanguagePreference: HxBotDesktopApi["setAppLanguagePreference"];
  setAppLogoColorPreference: HxBotDesktopApi["setAppLogoColorPreference"];
  agent: Pick<
    HxBotDesktopApi["agent"],
    "readConversationPage" | "searchConversationMessages" | "searchConversationFiles" | "listRoutines" | "listAgents"
  >;
  agentTemplates: Pick<HxBotDesktopApi["agentTemplates"], "onOpenLink" | "takePendingLink">;
  acpRegistry: HxBotDesktopApi["acpRegistry"];
  hostedSites: HxBotDesktopApi["hostedSites"];
  billing: HxBotDesktopApi["billing"];
  license: HxBotDesktopApi["license"];
  auth: CompanySignInCalls;
  hostedServers: HxBotDesktopApi["hostedServers"];
  routineFeed: HxBotDesktopApi["routineFeed"];
  events: HxBotDesktopApi["events"];
  plugins: Pick<HxBotDesktopApi["plugins"], "onOpenListing" | "takePendingListing">;
  marketplace: Pick<HxBotDesktopApi["marketplace"], "onOpenListing" | "takePendingListing">;
  servers: Pick<HxBotDesktopApi["servers"], "onInvite" | "takePendingInvite">;
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function appPort(): AppPort {
  return window.hxbot;
}
