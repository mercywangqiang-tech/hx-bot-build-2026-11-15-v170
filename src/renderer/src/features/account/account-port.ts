import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

/**
 * What the account context reaches in main: the HXBot account session, its devices, and the
 * usage the page rail and the Usage page show.
 */
export interface AccountPort {
  agent: Pick<HxBotDesktopApi["agent"], "getUsage">;
  auth: Pick<
    HxBotDesktopApi["auth"],
    | "cancelMobileConnect"
    | "createMobileConnect"
    | "createMobileConnectLink"
    | "getMobileConnectLink"
    | "getState"
    | "listAccountSessions"
    | "listMobileConnectedDevices"
    | "logout"
    | "onEvent"
    | "openCompanySignIn"
    | "requestEmailCode"
    | "retry"
    | "revokeAccountSession"
    | "hxDeleteAccount"
    | "hxAccessRules"
    | "hxAccessRemoveRule"
    | "hxAccessLog"
    | "hxAccessClearLog"
    | "hxComputerStatus"
    | "hxComputerRebuild"
    | "hxComputerSelfTest"
    | "hxAutoModelView"
    | "hxAutoModelUpdate"
    | "hxComputerSetAutoResume"
    | "hxRestoreFileChange"
    | "hxFileVersionsView"
    | "hxFileVersionsSetCap"
    | "hxSetTeamPriority"
    | "revokeMobileConnectedDevice"
    | "revokeMobileConnectLink"
    | "updateAvatar"
    | "updateChatColor"
    | "updateName"
    | "verifyEmailCode"
  >;
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function accountPort(): AccountPort {
  return window.hxbot;
}
