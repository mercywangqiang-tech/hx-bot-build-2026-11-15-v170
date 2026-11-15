"""HXBot：设置 → 授权与记录（v1.6.2）。

最大权限下“始终允许”的规则和操作记录存在应用的数据文件夹里（src/backend/hx-access/rules.ts）。这一步把它们接到
桌面端的设置里：主进程的四个接口（列出规则、删除规则、读操作记录、清空记录）、预加载、界面上的新页面
（src/renderer/src/features/settings/HxAccessSettingsTab.tsx）和中英文文字（其他 13 种语言在 hx/translations.py）。
"""

from __future__ import annotations

import brand_rename
import delete_account

TEXT_EN = {
    "settings.tab.hxAccess.title": "Access & activity",
    "settings.tab.hxAccess.description": "What agents may do without asking, and what they did.",
    "settings.hxAccess.loadFailed": "HXBot could not read the rules and the activity. Try again.",
    "settings.hxAccess.rules.title": "Always allowed",
    "settings.hxAccess.rules.description":
        "The rules saved with Always allow. They hold for every agent. Remove one, and the agents ask again next time.",
    "settings.hxAccess.rules.empty": "No rules yet.",
    "settings.hxAccess.rules.from": "From {agent} · {date}",
    "settings.hxAccess.rules.remove": "Remove",
    "settings.hxAccess.log.title": "Activity",
    "settings.hxAccess.log.description":
        "What agents did that is worth knowing: reading and changing files outside their folders, deleting, commands, "
        "screenshots, web search, sign-ins, payments and your confirmations. Kept on this computer only, the last 2,000.",
    "settings.hxAccess.log.empty": "Nothing yet.",
    "settings.hxAccess.log.refresh": "Refresh",
    "settings.hxAccess.log.clear": "Clear",
    "settings.hxAccess.target.folder": "Folder",
    "settings.hxAccess.target.file": "File",
    "settings.hxAccess.target.website": "Website",
    "settings.hxAccess.target.command": "Command",
    "settings.hxAccess.target.password": "Saved password on",
    "settings.hxAccess.target.payment": "Payment on",
    "settings.hxAccess.target.vault": "Vault item",
    "settings.hxAccess.target.any": "any",
    "settings.hxAccess.action.read": "Read",
    "settings.hxAccess.action.write": "Change",
    "settings.hxAccess.action.delete": "Delete",
    "settings.hxAccess.kind.read": "Read",
    "settings.hxAccess.kind.write": "Change",
    "settings.hxAccess.kind.delete": "Delete",
    "settings.hxAccess.kind.command": "Command",
    "settings.hxAccess.kind.screen": "Screenshot",
    "settings.hxAccess.kind.search": "Web search",
    "settings.hxAccess.kind.password": "Sign-in with a saved password on",
    "settings.hxAccess.kind.payment": "Card payment on",
    "settings.hxAccess.kind.vault": "Delete Vault item",
    "settings.hxAccess.kind.request": "Confirmation for",
    "settings.hxAccess.outcome.auto": "Without asking",
    "settings.hxAccess.outcome.once": "Allowed once",
    "settings.hxAccess.outcome.always": "Always allowed",
    "settings.hxAccess.outcome.held": "Stopped to ask",
    "settings.hxAccess.outcome.allowedOnce": "You allowed once",
    "settings.hxAccess.outcome.allowedAlways": "You always allowed",
    "settings.hxAccess.outcome.refused": "You refused",
}
TEXT_ZH = {
    "settings.tab.hxAccess.title": "授权与记录",
    "settings.tab.hxAccess.description": "助手不用问就能做的事，以及它们做过的事。",
    "settings.hxAccess.loadFailed": "HXBot 没能读取规则和记录，请再试一次。",
    "settings.hxAccess.rules.title": "始终允许",
    "settings.hxAccess.rules.description": "点“始终允许”后存下的规则，对所有助手有效。删除后，下次同样的事会重新问你。",
    "settings.hxAccess.rules.empty": "还没有规则。",
    "settings.hxAccess.rules.from": "来自 {agent} · {date}",
    "settings.hxAccess.rules.remove": "删除",
    "settings.hxAccess.log.title": "操作记录",
    "settings.hxAccess.log.description":
        "助手做过的值得留意的事：读取和修改它文件夹以外的文件、删除、命令、截图、网络搜索、登录、付款，以及你的每次确认。"
        "只保存在这台电脑上，保留最近 2000 条。",
    "settings.hxAccess.log.empty": "还没有记录。",
    "settings.hxAccess.log.refresh": "刷新",
    "settings.hxAccess.log.clear": "清空",
    "settings.hxAccess.target.folder": "文件夹",
    "settings.hxAccess.target.file": "文件",
    "settings.hxAccess.target.website": "网站",
    "settings.hxAccess.target.command": "命令",
    "settings.hxAccess.target.password": "用保存的密码登录",
    "settings.hxAccess.target.payment": "付款",
    "settings.hxAccess.target.vault": "保密箱条目",
    "settings.hxAccess.target.any": "全部",
    "settings.hxAccess.action.read": "读取",
    "settings.hxAccess.action.write": "修改",
    "settings.hxAccess.action.delete": "删除",
    "settings.hxAccess.kind.read": "读取",
    "settings.hxAccess.kind.write": "修改",
    "settings.hxAccess.kind.delete": "删除",
    "settings.hxAccess.kind.command": "命令",
    "settings.hxAccess.kind.screen": "截图",
    "settings.hxAccess.kind.search": "网络搜索",
    "settings.hxAccess.kind.password": "用保存的密码登录",
    "settings.hxAccess.kind.payment": "用银行卡付款",
    "settings.hxAccess.kind.vault": "删除保密箱条目",
    "settings.hxAccess.kind.request": "确认",
    "settings.hxAccess.outcome.auto": "不用问",
    "settings.hxAccess.outcome.once": "已允许一次",
    "settings.hxAccess.outcome.always": "始终允许",
    "settings.hxAccess.outcome.held": "停下来问你",
    "settings.hxAccess.outcome.allowedOnce": "你允许了一次",
    "settings.hxAccess.outcome.allowedAlways": "你选了始终允许",
    "settings.hxAccess.outcome.refused": "你拒绝了",
}


def plumbing(r) -> None:
    # 排在注销账号那一行之前：delete_account.py 按“它和下一行 ./ipc 连在一起”判断已经改过
    r.replace("packages/contracts/package.json",
              '    "./hx-delete-account": "./src/hx-delete-account.ts",\n',
              '    "./hx-access-settings": "./src/hx-access-settings.ts",\n'
              '    "./hx-delete-account": "./src/hx-delete-account.ts",\n')
    endpoints = "packages/contracts/src/ipc-endpoints.ts"
    brand_rename.add_import(r, endpoints,
                            'import type { HxAccessLogView, HxAccessRuleView } from "./hx-access-settings";')
    # 接在注销账号那一行之后（delete_account.py 加的，这时还没整理格式）
    r.replace(endpoints,
              f'    hxDeleteAccount: request<string, {delete_account.OUTCOME}>()("auth:hx-delete-account"),\n',
              f'    hxDeleteAccount: request<string, {delete_account.OUTCOME}>()("auth:hx-delete-account"),\n'
              "    // HXBot: Settings → Access & activity (hx-access/rules.ts).\n"
              '    hxAccessRules: request<undefined, HxAccessRuleView[]>()("auth:hx-access-rules"),\n'
              '    hxAccessRemoveRule: request<string, boolean>()("auth:hx-access-remove-rule"),\n'
              '    hxAccessLog: request<undefined, HxAccessLogView[]>()("auth:hx-access-log"),\n'
              '    hxAccessClearLog: request<undefined, void>()("auth:hx-access-clear-log"),\n')
    handlers = "src/main/ipc/account-handlers.ts"
    brand_rename.add_import(r, handlers, 'import { hxAccessStore } from "../../backend/hx-access/rules";')
    r.replace(handlers,
              '      hxDeleteAccount: payloadHandler(stringPayload("confirm", INPUT_LIMITS.email), (confirm) =>\n'
              "        runCauseEffect(centralAuth.hxDeleteAccount(confirm)),\n"
              "      ),\n",
              '      hxDeleteAccount: payloadHandler(stringPayload("confirm", INPUT_LIMITS.email), (confirm) =>\n'
              "        runCauseEffect(centralAuth.hxDeleteAccount(confirm)),\n"
              "      ),\n"
              "      hxAccessRules: handler(() => hxAccessStore.rules()),\n"
              '      hxAccessRemoveRule: payloadHandler(stringPayload("ruleId", INPUT_LIMITS.identifier), (ruleId) =>\n'
              "        hxAccessStore.removeRule(ruleId),\n"
              "      ),\n"
              "      hxAccessLog: handler(() => hxAccessStore.log()),\n"
              "      hxAccessClearLog: handler(() => hxAccessStore.clearLog()),\n")
    preload = "src/preload/index.ts"
    brand_rename.add_import(r, preload,
                            'import { decodeHxAccessLog, decodeHxAccessRules } from "@hxbot/contracts/hx-access-settings";')
    r.replace(preload,
              '      value === "deleted" || value === "incorrect_password" || value === "confirm_with_email" ? value : "failed",\n',
              '      value === "deleted" || value === "incorrect_password" || value === "confirm_with_email" ? value : "failed",\n'
              "    hxAccessRules: decodeHxAccessRules,\n"
              "    hxAccessRemoveRule: (value) => value === true,\n"
              "    hxAccessLog: decodeHxAccessLog,\n"
              "    hxAccessClearLog: decodeVoid,\n")
    r.replace("src/renderer/src/features/account/account-port.ts",
              '    | "hxDeleteAccount"\n',
              '    | "hxDeleteAccount"\n    | "hxAccessRules"\n    | "hxAccessRemoveRule"\n    | "hxAccessLog"\n    | "hxAccessClearLog"\n')
    r.replace("src/renderer/src/preview/mock-auth.ts",
              "    hxDeleteAccount: async () => {\n"
              '      authState = { status: "signed_out" };\n'
              "      emitAuthState(authState);\n"
              '      return "deleted" as const;\n'
              "    },\n",
              "    hxDeleteAccount: async () => {\n"
              '      authState = { status: "signed_out" };\n'
              "      emitAuthState(authState);\n"
              '      return "deleted" as const;\n'
              "    },\n"
              "    hxAccessRules: async () => [],\n"
              "    hxAccessRemoveRule: async () => false,\n"
              "    hxAccessLog: async () => [],\n"
              "    hxAccessClearLog: async () => {},\n")


def settings_page(r) -> None:
    tabs = "src/renderer/src/features/settings/settings-tabs.ts"
    r.replace(tabs, "  Settings,\n  Smartphone,\n", "  Settings,\n  ShieldCheck,\n  Smartphone,\n")
    r.replace(tabs, '  | "profile"\n  | "billing"\n', '  | "profile"\n  | "hx-access"\n  | "billing"\n')
    r.replace(tabs,
              "  {\n"
              '    value: "notifications",\n',
              "  {\n"
              '    value: "hx-access",\n'
              '    titleKey: "settings.tab.hxAccess.title",\n'
              '    descriptionKey: "settings.tab.hxAccess.description",\n'
              "    icon: ShieldCheck,\n"
              "    rows: [{ titleKey: \"settings.hxAccess.rules.title\" }, { titleKey: \"settings.hxAccess.log.title\" }],\n"
              "  },\n"
              "  {\n"
              '    value: "notifications",\n')
    modal = "src/renderer/src/features/settings/SettingsModal.tsx"
    brand_rename.add_import(r, modal, 'import { HxAccessSettingsTab } from "./HxAccessSettingsTab";')
    # 点左侧的“授权与记录”才会切到这一页：标签页只接受这张名单里的值（v1.6.2 漏了这一行，只能从搜索打开，v1.6.3 补上）
    r.replace(modal,
              '        value === "profile" ||\n        value === "billing" ||\n',
              '        value === "profile" ||\n        value === "hx-access" ||\n        value === "billing" ||\n')
    r.replace(modal,
              '        <Tabs.Content value="billing" class="settings-modal-tab-panel" data-tab="billing">\n',
              "        {/* HXBot: what agents may do without asking, and what they did (hx-access). */}\n"
              '        <Tabs.Content value="hx-access" class="settings-modal-tab-panel" data-tab="hx-access">\n'
              '          <HxAccessSettingsTab visible={props.open && activeTab() === "hx-access"} />\n'
              "        </Tabs.Content>\n"
              "\n"
              '        <Tabs.Content value="billing" class="settings-modal-tab-panel" data-tab="billing">\n')


def text(r) -> None:
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/settings.ts", "\n});\n", TEXT_EN)
    r.add_messages(f"{messages}/zh/settings.ts", "\n} as const satisfies", TEXT_ZH)


def access_settings(r) -> None:
    plumbing(r)
    settings_page(r)
    text(r)
