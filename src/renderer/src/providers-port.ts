import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

/**
 * What provider state reaches in main: connecting, signing in and refreshing providers, and the
 * runtimes HXBot installs for them, on this computer or on a host the account administers.
 */
export interface ProvidersPort {
  cancelProviderCodeLogin: HxBotDesktopApi["cancelProviderCodeLogin"];
  connectProvider: HxBotDesktopApi["connectProvider"];
  connectProviderInMainlandChina: HxBotDesktopApi["connectProviderInMainlandChina"];
  cancelProviderSignIn: HxBotDesktopApi["cancelProviderSignIn"];
  refreshAgentProviders: HxBotDesktopApi["refreshAgentProviders"];
  setProviderOn: HxBotDesktopApi["setProviderOn"];
  restartProvider: HxBotDesktopApi["restartProvider"];
  cancelProviderRestart: HxBotDesktopApi["cancelProviderRestart"];
  startProviderCodeLogin: HxBotDesktopApi["startProviderCodeLogin"];
  providerRuntimes: HxBotDesktopApi["providerRuntimes"];
  connectProviderAccount: HxBotDesktopApi["connectProviderAccount"];
  cancelProviderAccountSignIn: HxBotDesktopApi["cancelProviderAccountSignIn"];
  renameProviderAccount: HxBotDesktopApi["renameProviderAccount"];
  removeProviderAccount: HxBotDesktopApi["removeProviderAccount"];
  signOutProvider: HxBotDesktopApi["signOutProvider"];
  providerUsageResets: HxBotDesktopApi["providerUsageResets"];
  resetProviderUsage: HxBotDesktopApi["resetProviderUsage"];
  /** The same, for the host of a joined server the account administers. */
  providerAdmin: HxBotDesktopApi["providerAdmin"];
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function providersPort(): ProvidersPort {
  return window.hxbot;
}
