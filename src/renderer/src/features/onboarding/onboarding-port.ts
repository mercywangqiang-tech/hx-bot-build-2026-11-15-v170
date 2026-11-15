import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

/**
 * What onboarding reaches in main: the saved setup, the preview of an invite before the user
 * joins, the browser for the Terms of Service and the Privacy Policy, and the first value of the
 * analytics box.
 */
export interface OnboardingPort {
  getSetupState: HxBotDesktopApi["getSetupState"];
  saveSetup: HxBotDesktopApi["saveSetup"];
  onSetupState: HxBotDesktopApi["onSetupState"];
  servers: Pick<HxBotDesktopApi["servers"], "previewInvite">;
  openUrl: HxBotDesktopApi["openUrl"];
  getAnalyticsDefault: HxBotDesktopApi["getAnalyticsDefault"];
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function onboardingPort(): OnboardingPort {
  return window.hxbot;
}
