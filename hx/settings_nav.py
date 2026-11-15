"""HXBot：设置窗口按 WorkBuddy 分组（v1.6.4）。

左侧的分类分成三组，每组上面一个灰色小标题：设置（通用、个人资料、账单）、功能（助手、通知、语音、灵动岛、停靠栏、
Computer Use、手机连接）、数据与安全（授权与记录）；一条细线下面是“关于”和新加的“获取帮助”。
“更新”改名“关于”：上面仍是版本号、检查更新和更新的设置，下面加官网、服务条款和隐私政策（HxAboutCard.tsx）。
“获取帮助”是使用指南和意见反馈（HxHelpTab.tsx），和窗口左下角帮助菜单打开的是同一个地方。
设置顶部的搜索（上游已有）照样找得到新页面里的每一行。分组的列表在 HxSettingsNav.tsx。
后面几项再把 WorkBuddy 有、HXBot 还没有的页面（外观、快捷键、个性化、模型、数据导入、数据管理等）补进各组。
其他 13 种语言的译文在 hx/translations_v164.py。
"""

from __future__ import annotations

import brand_rename

TEXT_EN = {
    "settings.nav.group.settings": "Settings",
    "settings.nav.group.features": "Features",
    "settings.nav.group.data": "Data & security",
    "settings.tab.about.title": "About",
    "settings.tab.about.description": "Your version, updates and the HXBot terms.",
    "settings.tab.help.title": "Get help",
    "settings.tab.help.description": "Read the user guide or send us feedback.",
    "settings.about.section": "About HXBot",
    "settings.about.website.title": "Website",
    "settings.about.website.description": "What HXBot does and how teams use it.",
    "settings.about.website.action": "Visit website",
    "settings.about.privacy": "Privacy Policy",
    "settings.about.terms": "Terms of Service",
    "settings.help.section": "Help and feedback",
    "settings.help.guide.title": "User guide",
    "settings.help.guide.description": "Signing up, installing, everyday use and common questions.",
    "settings.help.guide.action": "Read the guide",
    "settings.help.feedback.title": "Feedback",
    "settings.help.feedback.description":
        "Write to bot@hxallai.com. Say what you did and what you saw, and add a screenshot if you can.",
    "settings.help.feedback.action": "Write an email",
}
TEXT_ZH = {
    "settings.nav.group.settings": "设置",
    "settings.nav.group.features": "功能",
    "settings.nav.group.data": "数据与安全",
    "settings.tab.about.title": "关于",
    "settings.tab.about.description": "版本、更新，以及 HXBot 的条款。",
    "settings.tab.help.title": "获取帮助",
    "settings.tab.help.description": "查看使用指南，或者给我们发反馈。",
    "settings.about.section": "关于 HXBot",
    "settings.about.website.title": "官网",
    "settings.about.website.description": "HXBot 能做什么、团队怎么用它。",
    "settings.about.website.action": "前往官网",
    "settings.about.privacy": "隐私政策",
    "settings.about.terms": "服务条款",
    "settings.help.section": "帮助与反馈",
    "settings.help.guide.title": "使用指南",
    "settings.help.guide.description": "注册、安装、日常使用和常见问题。",
    "settings.help.guide.action": "查看指南",
    "settings.help.feedback.title": "意见反馈",
    "settings.help.feedback.description": "发邮件到 bot@hxallai.com，说说你做了什么、看到了什么，能附上截图更好。",
    "settings.help.feedback.action": "写邮件",
}

# “更新”改名“关于”后，上游这两条文字没有代码再用到（加进 hx/unused-messages.txt，15 种语言里一起删掉）
RETIRED = ("settings.tab.updates.title", "settings.tab.updates.description")

TABS = "src/renderer/src/features/settings/settings-tabs.ts"
MODAL = "src/renderer/src/features/settings/SettingsModal.tsx"


def tab_list(r) -> None:
    # 图标：“关于”用 Info，“获取帮助”用 CircleQuestionMark；“更新”原来的 CircleArrowDown 不再用
    r.replace(TABS, "  CircleArrowDown,\n  CreditCard,\n", "  CircleQuestionMark,\n  CreditCard,\n  Info,\n")
    r.replace(TABS, '  | "updates"\n  | "hosted-servers";\n', '  | "updates"\n  | "help"\n  | "hosted-servers";\n')
    r.replace(TABS,
              '    value: "updates",\n'
              '    titleKey: "settings.tab.updates.title",\n'
              '    descriptionKey: "settings.tab.updates.description",\n'
              "    icon: CircleArrowDown,\n",
              "    // HXBot: Updates is About now: the version and the updates, then the website and the terms.\n"
              '    value: "updates",\n'
              '    titleKey: "settings.tab.about.title",\n'
              '    descriptionKey: "settings.tab.about.description",\n'
              "    icon: Info,\n")
    r.replace(TABS,
              '      { titleKey: "settings.updates.managed.title", descriptionKey: "settings.updates.managed.description" },\n'
              "    ],\n"
              "  },\n",
              '      { titleKey: "settings.updates.managed.title", descriptionKey: "settings.updates.managed.description" },\n'
              '      { titleKey: "settings.about.website.title", descriptionKey: "settings.about.website.description" },\n'
              "    ],\n"
              "  },\n"
              "  // HXBot: the user guide and feedback by email (HxHelpTab).\n"
              "  {\n"
              '    value: "help",\n'
              '    titleKey: "settings.tab.help.title",\n'
              '    descriptionKey: "settings.tab.help.description",\n'
              "    icon: CircleQuestionMark,\n"
              "    rows: [\n"
              '      { titleKey: "settings.help.guide.title", descriptionKey: "settings.help.guide.description" },\n'
              '      { titleKey: "settings.help.feedback.title", descriptionKey: "settings.help.feedback.description" },\n'
              "    ],\n"
              "  },\n")


def settings_modal(r) -> None:
    brand_rename.add_import(r, MODAL, 'import { HxAboutCard } from "./HxAboutCard";')
    brand_rename.add_import(r, MODAL, 'import { HxHelpTab } from "./HxHelpTab";')
    brand_rename.add_import(r, MODAL, 'import { HxSettingsNav } from "./HxSettingsNav";')
    # 左侧列表：分组显示（HxSettingsNav.tsx）
    r.replace(MODAL,
              "            {visibleNavItems().map((item) => {\n"
              "              const NavIcon = item.icon;\n"
              "              return (\n"
              "                <Tabs.Trigger\n"
              '                  class="settings-modal-nav-item"\n'
              "                  value={item.value}\n"
              '                  aria-current={activeTab() === item.value ? "page" : undefined}\n'
              "                >\n"
              '                  <NavIcon aria-hidden="true" />\n'
              "                  <span>{i18n.t(item.titleKey)}</span>\n"
              "                </Tabs.Trigger>\n"
              "              );\n"
              "            })}\n",
              "            {/* HXBot: the tabs in groups (HxSettingsNav). */}\n"
              "            <HxSettingsNav items={visibleNavItems()} active={activeTab()} />\n")
    # 点左侧的“获取帮助”才会切到这一页（标签页只接受名单里的值）
    r.replace(MODAL,
              '        value === "mobile-connect" ||\n        value === "updates"\n',
              '        value === "mobile-connect" ||\n        value === "updates" ||\n        value === "help"\n')
    # “关于”：上游的版本和更新，下面接官网和条款
    r.replace(MODAL,
              "            selectMount={modalElement}\n"
              "          />\n"
              "        </Tabs.Content>\n"
              "      </SettingsDialogShell>\n",
              "            selectMount={modalElement}\n"
              "          />\n"
              "          <HxAboutCard />\n"
              "        </Tabs.Content>\n"
              "\n"
              '        <Tabs.Content value="help" class="settings-modal-tab-panel" data-tab="help">\n'
              "          <HxHelpTab />\n"
              "        </Tabs.Content>\n"
              "      </SettingsDialogShell>\n")


def search_page(r) -> None:
    # 多了“获取帮助”一页，标签 × 文字键拼出的模板字面量类型超过 TypeScript 的上限（TS2590），
    # 先存成 string 再查找。
    r.replace("src/renderer/src/features/window/SettingsPage.tsx",
              "    const anchor = content.querySelector(\n"
              '      `.settings-modal-tab-panel[data-tab="${row.tab}"] [data-settings-row="${row.anchor}"]`,\n'
              "    );\n",
              "    // HXBot has one more tab: typed as tab × row, this selector would be too large a union for TypeScript.\n"
              '    const selector: string = `.settings-modal-tab-panel[data-tab="${row.tab}"] [data-settings-row="${row.anchor}"]`;\n'
              "    const anchor = content.querySelector(selector);\n")


def text(r) -> None:
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/settings.ts", "\n});\n", TEXT_EN)
    r.add_messages(f"{messages}/zh/settings.ts", "\n} as const satisfies", TEXT_ZH)


def apply(r) -> None:
    tab_list(r)
    settings_modal(r)
    search_page(r)
    text(r)
