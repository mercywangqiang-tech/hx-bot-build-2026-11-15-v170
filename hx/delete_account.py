"""注销账号（客户自助）：rebrand.py 的一步（v1.6.2 起）。

账号服务的接口是 POST /api/browser/hx/account/delete（apps/auth-api/src/server/hx-accounts/http.ts），输入密码确认；
没有设置过密码、只用第三方账号登录的账号输入邮箱确认。删除的范围与管理员的 scripts/delete-account.sh 相同。
设置 → 个人资料最下面是“注销账号”一节（packages/ui/src/features/account/HxDeleteAccountSection.tsx）：
桌面端经主进程（CentralAuthManager.hxDeleteAccount，带登录令牌），网页版直接请求（带登录 Cookie，
src/renderer/src/features/web-client/hx-web-delete-account.ts）。手机端在账号设置里（见 mobile()）。

这里只做上游文件里的接线。由 rebrand.py 调用 delete_account(r)，r 是 rebrand 模块本身。
"""

from __future__ import annotations

import brand_rename  # 同目录：add_import

OUTCOME = '"deleted" | "incorrect_password" | "confirm_with_email" | "failed"'


def contracts(r) -> None:
    r.replace("packages/contracts/package.json",
              '    "./ipc": "./src/ipc.ts",\n',
              '    "./hx-delete-account": "./src/hx-delete-account.ts",\n'
              '    "./ipc": "./src/ipc.ts",\n')
    r.replace("packages/contracts/src/ipc-endpoints.ts",
              '    revokeAccountSession: request<string, void>()("auth:revoke-account-session"),\n',
              '    revokeAccountSession: request<string, void>()("auth:revoke-account-session"),\n'
              "    // HXBot: deletes the signed-in account (注销账号) with the password, or the email without one.\n"
              f'    hxDeleteAccount: request<string, {OUTCOME}>()("auth:hx-delete-account"),\n')


def desktop(r) -> None:
    manager = "src/main/central-auth-manager.ts"
    brand_rename.add_import(r, manager, 'import { HX_DELETE_ACCOUNT_PATH, hxDeleteAccountOutcome } from "@hxbot/contracts/hx-delete-account";')
    r.replace(manager,
              '  readonly logout = Effect.fn("CentralAuth.logout")(\n',
              "  /**\n"
              "   * HXBot: deletes the signed-in account (注销账号) with the password, or the email for an account\n"
              "   * without one, then signs this computer out. A refusal (wrong password) keeps the session: the\n"
              "   * request goes around #authorizedRequestEffect, which would end the session on any 401.\n"
              "   */\n"
              '  readonly hxDeleteAccount = Effect.fn("CentralAuth.hxDeleteAccount")(\n'
              "    function* (\n"
              "      this: CentralAuthManager,\n"
              "      confirm: string,\n"
              f"    ): Effect.fn.Return<{OUTCOME}, CentralAuthOperationError, CentralAuthTransport> {{\n"
              "      const token = this.#sessionToken;\n"
              '      if (!token) return "failed";\n'
              "      const response = yield* CentralAuthTransport.use((transport) =>\n"
              "        transport.fetch(new URL(HX_DELETE_ACCOUNT_PATH, this.#options.apiUrl), {\n"
              '          method: "POST",\n'
              '          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },\n'
              "          body: JSON.stringify({ confirm }),\n"
              "          signal: AbortSignal.timeout(30_000),\n"
              "        }),\n"
              "      );\n"
              "      const read = response.ok ? null : yield* Effect.result(authCall(() => response.json()));\n"
              "      const outcome = hxDeleteAccountOutcome(response.ok, read && Result.isSuccess(read) ? read.success : null);\n"
              '      if (outcome === "deleted") yield* this.logout();\n'
              "      return outcome;\n"
              "    },\n"
              "    (operation) => this.#owned(operation),\n"
              "  ).bind(this);\n\n"
              '  readonly logout = Effect.fn("CentralAuth.logout")(\n')
    r.replace("src/main/ipc/account-handlers.ts",
              '      revokeAccountSession: payloadHandler(stringPayload("sessionId", INPUT_LIMITS.identifier), (sessionId) =>\n'
              "        runCauseEffect(centralAuth.revokeAccountSession(sessionId)),\n"
              "      ),\n",
              '      revokeAccountSession: payloadHandler(stringPayload("sessionId", INPUT_LIMITS.identifier), (sessionId) =>\n'
              "        runCauseEffect(centralAuth.revokeAccountSession(sessionId)),\n"
              "      ),\n"
              '      hxDeleteAccount: payloadHandler(stringPayload("confirm", INPUT_LIMITS.email), (confirm) =>\n'
              "        runCauseEffect(centralAuth.hxDeleteAccount(confirm)),\n"
              "      ),\n")
    r.replace("src/preload/index.ts",
              "    revokeAccountSession: decodeVoid,\n",
              "    revokeAccountSession: decodeVoid,\n"
              "    hxDeleteAccount: (value) =>\n"
              '      value === "deleted" || value === "incorrect_password" || value === "confirm_with_email" ? value : "failed",\n')
    r.replace("src/renderer/src/features/account/account-port.ts",
              '    | "revokeAccountSession"\n',
              '    | "revokeAccountSession"\n    | "hxDeleteAccount"\n')
    r.replace("src/renderer/src/features/account/account-context.tsx",
              "      revokeAccountSession: (sessionId: string) => accountPort().auth.revokeAccountSession(sessionId),\n",
              "      revokeAccountSession: (sessionId: string) => accountPort().auth.revokeAccountSession(sessionId),\n"
              "      hxDeleteAccount: (confirm: string) => accountPort().auth.hxDeleteAccount(confirm),\n")
    r.replace("src/renderer/src/preview/mock-auth.ts",
              "    revokeAccountSession: async (sessionId) => {\n"
              "      accountSessions = accountSessions.filter((session) => session.sessionId !== sessionId);\n"
              "    },\n",
              "    revokeAccountSession: async (sessionId) => {\n"
              "      accountSessions = accountSessions.filter((session) => session.sessionId !== sessionId);\n"
              "    },\n"
              "    hxDeleteAccount: async () => {\n"
              '      authState = { status: "signed_out" };\n'
              "      emitAuthState(authState);\n"
              '      return "deleted" as const;\n'
              "    },\n")
    r.replace("src/renderer/src/WorkspaceOverlays.tsx",
              "        onRevokeAccountSession={auth.revokeAccountSession}\n",
              "        onRevokeAccountSession={auth.revokeAccountSession}\n"
              "        onHxDeleteAccount={auth.hxDeleteAccount}\n")
    modal = "src/renderer/src/features/settings/SettingsModal.tsx"
    brand_rename.add_import(r, modal, 'import type { HxDeleteAccountOutcome } from "@hxbot/contracts/hx-delete-account";')
    r.replace(modal,
              "  onRevokeAccountSession?: (sessionId: string) => Promise<void>;\n",
              "  onRevokeAccountSession?: (sessionId: string) => Promise<void>;\n"
              "  /** HXBot: deletes the signed-in account (注销账号). The section is hidden without it. */\n"
              "  onHxDeleteAccount?: ((confirm: string) => Promise<HxDeleteAccountOutcome>) | undefined;\n")
    r.replace(modal,
              "            canRevokeSession={Boolean(props.onRevokeAccountSession)}\n"
              "            onSignOut={props.onSignOut}\n",
              "            canRevokeSession={Boolean(props.onRevokeAccountSession)}\n"
              "            onSignOut={props.onSignOut}\n"
              "            hxOnDeleteAccount={props.onHxDeleteAccount}\n")


def shared_ui(r) -> None:
    tab = "packages/ui/src/features/settings/SettingsProfileTab.tsx"
    brand_rename.add_import(r, tab, 'import { HxDeleteAccountSection } from "../account/HxDeleteAccountSection";')
    brand_rename.add_import(r, tab, 'import type { HxDeleteAccountOutcome } from "@hxbot/contracts/hx-delete-account";')
    r.replace(tab,
              "  /** The activity of this computer. Nothing shows without it. */\n"
              "  activity?: ProfileActivityState | undefined;\n"
              "}\n",
              "  /** The activity of this computer. Nothing shows without it. */\n"
              "  activity?: ProfileActivityState | undefined;\n"
              "  /** HXBot: deletes the account (注销账号), at the end of the tab. Nothing shows without it. */\n"
              "  hxOnDeleteAccount?: ((confirm: string) => Promise<HxDeleteAccountOutcome>) | undefined;\n"
              "}\n")
    r.replace(tab,
              '            pendingLabel={t("settings.disconnect.pending")}\n'
              "          />\n"
              "        </SettingsSection>\n"
              "      </Show>\n"
              "    </>\n",
              '            pendingLabel={t("settings.disconnect.pending")}\n'
              "          />\n"
              "        </SettingsSection>\n"
              "      </Show>\n"
              "      <Show when={props.hxOnDeleteAccount}>\n"
              "        {(onDelete) => <HxDeleteAccountSection email={props.account.email} onDelete={onDelete()} />}\n"
              "      </Show>\n"
              "    </>\n")


def web(r) -> None:
    settings = "src/renderer/src/features/web-client/WebAccountSettings.tsx"
    brand_rename.add_import(r, settings, 'import { hxDeleteWebAccount } from "./hx-web-delete-account";')
    r.replace(settings,
              "            canListSessions\n"
              "            canRevokeSession\n"
              "            onSignOut={props.onSignOut}\n",
              "            canListSessions\n"
              "            canRevokeSession\n"
              "            onSignOut={props.onSignOut}\n"
              "            hxOnDeleteAccount={(confirm) => hxDeleteWebAccount(confirm)}\n")


def mobile(r) -> None:
    profile = "apps/mobile/src/features/settings/screens/profile-settings-screen.tsx"
    brand_rename.add_import(r, profile, 'import UserX from "lucide-react-native/icons/user-x";')
    r.replace(profile,
              "          <Typography.Paragraph className=\"text-danger-text\">\n"
              "            {t(\"mobile.settings.profile.signOut\")}\n"
              "          </Typography.Paragraph>\n"
              "        </SettingsRow>\n"
              "      </SettingsSection>\n"
              "    </SettingsContent>\n",
              "          <Typography.Paragraph className=\"text-danger-text\">\n"
              "            {t(\"mobile.settings.profile.signOut\")}\n"
              "          </Typography.Paragraph>\n"
              "        </SettingsRow>\n"
              "      </SettingsSection>\n"
              "      {/* HXBot: deleting the account (注销账号), screens/hx-delete-account-screen.tsx */}\n"
              "      <SettingsSection>\n"
              "        <SettingsRow\n"
              "          leading={<RowIcon icon={UserX} tone=\"danger\" />}\n"
              "          disabled={busy}\n"
              "          onPress={() => router.push(\"/settings/delete-account\")}\n"
              "        >\n"
              "          <Typography.Paragraph className=\"text-danger-text\">{t(\"mobile.settings.hxDelete.title\")}</Typography.Paragraph>\n"
              "        </SettingsRow>\n"
              "      </SettingsSection>\n"
              "    </SettingsContent>\n")
    r.replace("apps/mobile/src/app/(app)/settings/_layout.tsx",
              '      <Stack.Screen name="sessions" options={{ title: t("mobile.app.route.accountSessions") }} />\n',
              '      <Stack.Screen name="sessions" options={{ title: t("mobile.app.route.accountSessions") }} />\n'
              '      <Stack.Screen name="delete-account" options={{ title: t("mobile.settings.hxDelete.title") }} />\n')


def delete_account(r) -> None:
    contracts(r)
    desktop(r)
    shared_ui(r)
    web(r)
    mobile(r)
    text(r)


# 界面文字：桌面端、网页版（account.ts）与手机端（mobile/settings.ts）。其他 13 种语言的译文在 hx/translations.py。
DESKTOP_EN = {
    "account.hxDelete.title": "Delete account",
    "account.hxDelete.description": (
        "Deletes your HXBot Account for good: the registration details, linked accounts, sign-ins on every device, "
        "your memberships and the servers you published. The agents, chats and files on your computers stay."
    ),
    "account.hxDelete.action": "Delete account…",
    "account.hxDelete.confirmTitle": "Delete your HXBot Account?",
    "account.hxDelete.confirmDescription": (
        "{email} is deleted at once and cannot be restored, and every device is signed out. Enter your password to confirm."
    ),
    "account.hxDelete.passwordLabel": "Password",
    "account.hxDelete.emailLabel": "Email of this account",
    "account.hxDelete.noPassword": "Never set a password? Confirm with the email",
    "account.hxDelete.confirm": "Delete account",
    "account.hxDelete.pending": "Deleting…",
    "account.hxDelete.passwordRequired": "Enter your password.",
    "account.hxDelete.emailRequired": "Enter the email of this account.",
    "account.hxDelete.incorrectPassword": "The password is incorrect.",
    "account.hxDelete.failed": "The account could not be deleted. Try again later.",
}
DESKTOP_ZH = {
    "account.hxDelete.title": "注销账号",
    "account.hxDelete.description": (
        "永久删除你的 HXBot 账号：注册资料、绑定的第三方账号、所有设备上的登录、加入的服务器和你发布的服务器都会删除，不能恢复。"
        "你电脑上的助手、对话和文件不受影响。"
    ),
    "account.hxDelete.action": "注销账号…",
    "account.hxDelete.confirmTitle": "注销 HXBot 账号？",
    "account.hxDelete.confirmDescription": "{email} 将立即删除、不能恢复，所有设备都会退出登录。请输入密码确认。",
    "account.hxDelete.passwordLabel": "密码",
    "account.hxDelete.emailLabel": "这个账号的邮箱",
    "account.hxDelete.noPassword": "没有设置过密码？改用邮箱确认",
    "account.hxDelete.confirm": "永久注销",
    "account.hxDelete.pending": "正在注销…",
    "account.hxDelete.passwordRequired": "请输入密码。",
    "account.hxDelete.emailRequired": "请输入这个账号的邮箱。",
    "account.hxDelete.incorrectPassword": "密码不正确。",
    "account.hxDelete.failed": "没能注销账号，请稍后再试。",
}
# 手机端：标题、说明、输入框、按钮和提示与桌面端同义；确认用系统对话框，所以多一条正文。
MOBILE_KEYS = {
    "mobile.settings.hxDelete.title": "account.hxDelete.title",
    "mobile.settings.hxDelete.description": "account.hxDelete.description",
    "mobile.settings.hxDelete.action": "account.hxDelete.title",
    "mobile.settings.hxDelete.confirmTitle": "account.hxDelete.confirmTitle",
    "mobile.settings.hxDelete.confirmBody": None,
    "mobile.settings.hxDelete.passwordLabel": "account.hxDelete.passwordLabel",
    "mobile.settings.hxDelete.emailLabel": "account.hxDelete.emailLabel",
    "mobile.settings.hxDelete.noPassword": "account.hxDelete.noPassword",
    "mobile.settings.hxDelete.confirm": "account.hxDelete.confirm",
    "mobile.settings.hxDelete.pending": "account.hxDelete.pending",
    "mobile.settings.hxDelete.passwordRequired": "account.hxDelete.passwordRequired",
    "mobile.settings.hxDelete.emailRequired": "account.hxDelete.emailRequired",
    "mobile.settings.hxDelete.incorrectPassword": "account.hxDelete.incorrectPassword",
    "mobile.settings.hxDelete.failed": "account.hxDelete.failed",
}
MOBILE_CONFIRM_EN = "{email} is deleted at once and cannot be restored, and every device is signed out."
MOBILE_CONFIRM_ZH = "{email} 将立即删除、不能恢复，所有设备都会退出登录。"


def text(r) -> None:
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/account.ts", "\n});\n", DESKTOP_EN)
    r.add_messages(f"{messages}/zh/account.ts", "\n} as const satisfies", DESKTOP_ZH)
    for language, table, confirm in (("en", DESKTOP_EN, MOBILE_CONFIRM_EN), ("zh", DESKTOP_ZH, MOBILE_CONFIRM_ZH)):
        entries = {key: (table[same] if same else confirm) for key, same in MOBILE_KEYS.items()}
        closing = "\n});\n" if language == "en" else "\n} as const satisfies"
        r.add_messages(f"{messages}/{language}/mobile/settings.ts", closing, entries)
