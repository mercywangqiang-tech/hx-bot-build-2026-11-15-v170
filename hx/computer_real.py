"""HXBot 电脑操控（三）：Mac 的隐私与权限——签名、授权、沙盒、装应用（v1.6.8）。应用命令和四条路线自动换路移到 v1.6.9。

用户 2026-11-14：把助手「电脑整理」写的《HXBot 桌面操作能力失败复盘与修正需求》（F1～F5）放进 v1.6.8；
同日 10:12 补充 F6（装应用到 /Applications 被拒，同意了也不行）。方案见项目文档
「HXBot-v1.6.8-电脑操控真机打通-方案」。

HX 自己的文件：
- src/backend/agent/hx-tool-search.ts：工具检索的补充（F5）：空查询列出全部工具；中英文的常用说法
  （截图、点击、键盘、关闭应用、默认浏览器……）也能找到对应的工具；找不到时给出最接近的工具，并说清
  是“没有这个功能”还是“这个智能体没有这个工具”，应用和网站该用什么

HX 自己的文件（Mac 的固定签名，用户 2026-11-14 同意「HXBot-Mac隐私与权限-最优方案」）：
- hx/scripts/mac-signing-cert.sh：在用户自己的 Mac 上运行一次，生成固定证书，直接写进 GitHub Secrets
- hx/scripts/mac-signing-keychain.sh：GitHub 的 Mac 机器上打包前装好证书
- hx/scripts/mac-dist.ts：dist:mac 的最后一步，有证书就签名（加固运行时、build/hx-entitlements.mac*.plist）
- hx/scripts/mac-signing-check.sh：打好后核对签名身份，身份变了不上传
- build/hx-entitlements.mac.plist、build/hx-entitlements.mac.inherit.plist：签名时用的权限声明
  （去掉要描述文件的 associated-domains，加上 disable-library-validation）

上游文件的改动：在 Mac 上只要辅助功能，驱动就算准备好（accessibility_ready）；“授权”按钮打开那一页后，
HXBot 自己按下自己的开关（grant_press）；授权的说明写明谁来开开关（grant_text）；最大权限下 OpenCode 在 Mac 上
不进沙盒，其他沙盒放开包管理器的文件夹（sandbox_in_max_access）；第一次打开时问要不要移到“应用程序”
（move_to_applications）；装应用的工具 computer_install（src/backend/hx-computer/install.ts）。

HX 自己的文件（一键授权）：
- src/backend/hx-computer/grant-press.ts：经电脑操控驱动在系统设置里找到并按下 HXBot 那一行的开关
- src/main/hx-mac-grants.ts：什么时候按（屏幕录制；辅助功能打开后接着开屏幕录制），授权后重新问一次驱动

这里只做接线。
"""

from __future__ import annotations


def tool_search(r) -> None:
    """tool_search 调用 hx-tool-search 的三个函数；匹配和打分仍在上游的 tool-catalog.ts 里。"""
    path = "src/backend/agent/tool-catalog.ts"
    r.replace(path, 'import { toolGuidance } from "./tool-guidance";\n',
              'import { hxEmptyToolSearch, hxNoToolMatch, hxToolSearchWords } from "./hx-tool-search";\n'
              'import { toolGuidance } from "./tool-guidance";\n')
    # 用户和模型常用的说法（中文没有空格，按短语找）补上对应工具名字里的词
    r.replace(path, "  return { queries, terms: new Set(queries.flatMap(words)), limit: parsed.data.limit };\n",
              "  return {\n"
              "    queries,\n"
              "    terms: new Set([...queries.flatMap(words), ...hxToolSearchWords(queries)]),\n"
              "    limit: parsed.data.limit,\n"
              "  };\n")
    # 空查询（{}、""、只有引号）列出全部工具，按组列；以前直接报“请求无效”
    r.replace(path, '  if (params.tool === "tool_search") {\n    const search = searchTerms(params);\n',
              '  if (params.tool === "tool_search") {\n'
              "    const everything = hxEmptyToolSearch(params.arguments, catalog);\n"
              "    if (everything) return everything;\n"
              "    const search = searchTerms(params);\n")
    # 一个也没匹配上：给出最接近的工具和下一步怎么做
    r.replace(path, "      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.index - b.index);\n",
              "      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.index - b.index);\n"
              "    if (matches.length === 0) return hxNoToolMatch(queries, terms, catalog, BUILTIN_TOOL_CATALOG);\n")


def mac_signing(r) -> None:
    """dist:mac 最后一步改由 hx/scripts/mac-dist.ts 运行 electron-builder：有固定证书就签名，没有就照旧不签名并说明。"""
    r.replace("package.json", "&& electron-builder --mac --config.mac.identity=null --config.mac.notarize=false\"",
              "&& bun hx/scripts/mac-dist.ts\"")


def accessibility_ready(r) -> None:
    """在 Mac 上只要“辅助功能”，电脑操控驱动就算准备好；“屏幕录制”只给截屏和看图兜底用。

    2026-11-14 在 GitHub 的 macOS 15.8.2 和 26.7.2 上实测（hxbot-check 的 a11y/1）：拿掉屏幕录制授权后，
    驱动照样启动并报出 accessibility true、screen_recording false，逐步操作 S3～S7（打开文本编辑、读提纲、
    输入并保存、“删除”先问、停止键）全部通过。两项授权仍都列在“设置 → 电脑操控”里；缺屏幕录制时只有
    截屏类工具报“缺屏幕录制授权”（capture_screen 本来就这样报）。
    """
    path = "src/main/cua-driver-runtime.ts"
    r.replace(path, 'const REQUIRED_PERMISSIONS: Readonly<Partial<Record<NodeJS.Platform, readonly MacPermissionId[]>>> = {\n'
                    '  darwin: ["screen-recording", "accessibility"],\n'
                    '};\n',
              'const REQUIRED_PERMISSIONS: Readonly<Partial<Record<NodeJS.Platform, readonly MacPermissionId[]>>> = {\n'
              '  darwin: ["screen-recording", "accessibility"],\n'
              '};\n'
              '\n'
              '/**\n'
              ' * The grants without which the driver is not ready: Accessibility only. The step tools read the\n'
              ' * controls outline and take no screenshot, so Screen Recording serves screenshots alone, and its\n'
              ' * row stays in the panel. Checked on macOS 15 and 26 with Screen Recording taken away.\n'
              ' */\n'
              'const READY_PERMISSIONS: Readonly<Partial<Record<NodeJS.Platform, readonly MacPermissionId[]>>> = {\n'
              '  darwin: ["accessibility"],\n'
              '};\n')
    r.replace(path, "    const granted = requiredPermissions(this.#options.platform).every((id) =>\n",
              "    const granted = (READY_PERMISSIONS[this.#options.platform] ?? []).every((id) =>\n")


def grant_press(r) -> None:
    """“设置 → 电脑操控”的“授权”按钮：打开那一页之后，HXBot 自己按下自己的开关，用户只输密码或按指纹。

    用户 2026-11-14：“HXBot自己点打开，最后让用户自己输入密码或者指纹！”。按开关的做法在 GitHub 的 macOS 15.8.2
    和 26.7.2 上实测过（hxbot-check 的 grant/3），见 src/main/hx-mac-grants.ts 和 hx-computer/grant-press.ts。
    """
    path = "src/main/ipc/computer-use-handlers.ts"
    r.replace(path, 'import { MAC_PERMISSION_URLS } from "../mac-permission-urls";\n',
              'import { hxMacGrants } from "../hx-mac-grants";\n'
              'import { MAC_PERMISSION_URLS } from "../mac-permission-urls";\n')
    r.replace(path, "        await openExternal(MAC_PERMISSION_URLS[permission]);\n",
              "        // HXBot (v1.6.8): a grant that does not hold loses HXBot's own stale entry first.\n"
              "        await hxMacGrants.prepare(permission);\n"
              "        await openExternal(MAC_PERMISSION_URLS[permission]);\n")
    r.replace(path,
              '          logger.warn("The Computer Use permission steps could not be shown.", { cause: toLogValue(cause) });\n'
              '        });\n'
              '        return state();\n',
              '          logger.warn("The Computer Use permission steps could not be shown.", { cause: toLogValue(cause) });\n'
              '        });\n'
              '        // HXBot (v1.6.8): HXBot turns on its own switch where macOS lets it; the user gives the password.\n'
              '        void hxMacGrants.press(permission);\n'
              '        return state();\n')


# 一键授权的文字：英文和中文在这里，其他 13 种语言在 hx/translations_v168.py。前三条改了意思，后两条新加。
CHANGED_EN = {
    "computerUse.permission.screenRecording.description": "Lets HXBot take screenshots. Clicking and typing work without it.",
    "computerUse.permission.accessibility.description": "Lets HXBot click and type. HXBot then turns on Screen Recording itself.",
    "computerUse.permissions.description":
        "Permissions are managed by macOS. After Grant, HXBot turns on what it can; you only give your password or Touch ID.",
}
CHANGED_ZH = {
    "computerUse.permission.screenRecording.description": "让 HXBot 截屏。点击和输入不需要它。",
    "computerUse.permission.accessibility.description": "让 HXBot 点击和输入。打开后，HXBot 自己去开屏幕录制。",
    "computerUse.permissions.description": "权限由 macOS 管理。点“授予”后，能自己打开的开关由 HXBot 打开，你只需输入密码或按指纹。",
}
NEW_EN = {
    "computerUse.help.hxPressesScreen":
        "When HXBot has Accessibility, it turns this switch on itself. When macOS asks, give your password or Touch ID.",
    "computerUse.help.hxThenScreen":
        "macOS lets only you turn on this switch for HXBot. After that, HXBot turns on Screen Recording itself.",
}
NEW_ZH = {
    "computerUse.help.hxPressesScreen": "HXBot 有辅助功能授权时，会自己打开这个开关。系统要密码时，输入密码或按指纹即可。",
    "computerUse.help.hxThenScreen": "这个开关只能由你打开（macOS 的规定）。打开后，HXBot 接着自己去开屏幕录制。",
}


MOVE_EN = {
    "startup.hxMoveTitle": "Move HXBot to Applications?",
    "startup.hxMoveBody":
        "HXBot runs outside the Applications folder, for example from Downloads or a disk image. macOS then runs it "
        "from a temporary place, and permissions and updates do not work. HXBot moves itself and opens again.",
    "startup.hxMoveNow": "Move",
    "startup.hxMoveLater": "Not now",
    "startup.hxMoveFailed": "HXBot could not move itself. Quit HXBot, then drag it into the Applications folder in Finder.",
}
MOVE_ZH = {
    "startup.hxMoveTitle": "把 HXBot 移到“应用程序”文件夹？",
    "startup.hxMoveBody":
        "HXBot 现在不在“应用程序”文件夹里运行（例如在“下载”或磁盘映像里）。macOS 会把这样运行的应用放到临时位置，"
        "授权和更新都会出问题。点“移过去”，HXBot 自己移过去并重新打开。",
    "startup.hxMoveNow": "移过去",
    "startup.hxMoveLater": "以后再说",
    "startup.hxMoveFailed": "HXBot 没能自己移过去。请退出 HXBot，再在访达里把它拖到“应用程序”文件夹。",
}


def move_to_applications(r) -> None:
    """第一次打开时不在“应用程序”文件夹里，问一次要不要移过去（src/main/hx-move-to-applications.ts）。"""
    import brand_rename
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/startup.ts", "\n});\n", MOVE_EN)
    r.add_messages(f"{messages}/zh/startup.ts", "\n} as const satisfies", MOVE_ZH)
    index = "src/main/index.ts"
    brand_rename.add_import(r, index, 'import { hxOfferMoveToApplications } from "./hx-move-to-applications";')
    anchor = '        teardown.push(0, "app archive watch", watchAppArchive(process.resourcesPath, built.language.translate));\n'
    r.replace(index, anchor,
              anchor +
              "        // HXBot (v1.6.8): outside /Applications, macOS runs HXBot from a temporary place; offer to move.\n"
              "        void hxOfferMoveToApplications(built.language.translate);\n")


def grant_text(r) -> None:
    """设置页两行授权和步骤窗口说清：屏幕录制由 HXBot 自己点开，辅助功能由用户点一下，之后 HXBot 接着开屏幕录制。"""
    import access_control
    messages = "packages/i18n/src/messages"
    for key, value in CHANGED_EN.items():
        access_control.set_message(r, f"{messages}/en/computerUse.ts", key, value)
    for key, value in CHANGED_ZH.items():
        access_control.set_message(r, f"{messages}/zh/computerUse.ts", key, value)
    r.add_messages(f"{messages}/en/computerUse.ts", "\n});\n", NEW_EN)
    r.add_messages(f"{messages}/zh/computerUse.ts", "\n} as const satisfies", NEW_ZH)
    path = "src/renderer/src/features/computer-use/ComputerUsePermissionHelp.tsx"
    # The window is as tall as its contents: one more line now, and 424 fits it in every language
    # (measured in all 15, Russian is the tallest at 422).
    r.replace("src/main/main-window.ts", "  const height = 322;\n",
              "  // HXBot (v1.6.8): one more line says who turns the switch on; 424 fits it in all 15 languages.\n"
              "  const height = 424;\n")
    r.replace(path, '      <ol class="computer-use-help-steps">\n',
              "      {/* HXBot (v1.6.8): who turns this switch on. Not for the remote screen's helper app. */}\n"
              "      <Show when={!props.sunshine}>\n"
              '        <p class="computer-use-help-status">\n'
              "          {t(\n"
              '            permission === "screen-recording" ? "computerUse.help.hxPressesScreen" : "computerUse.help.hxThenScreen",\n'
              "          )}\n"
              "        </p>\n"
              "      </Show>\n"
              "\n"
              '      <ol class="computer-use-help-steps">\n')


def sandbox_in_max_access(r) -> None:
    """最大权限下的 macOS 进程沙盒（复盘 F3、F6）：OpenCode 每个工具都先问 HXBot，不再进沙盒；其他模型的沙盒放开包管理器的
    文件夹，说明里写清沙盒拒绝什么、该用哪个工具（规则在 src/backend/hx-access/sandbox.ts）。"""
    drivers = "src/backend/provider-drivers.ts"
    r.replace(drivers, 'import { hxOpenCodeOnDemand } from "./hx-access/hub";\n',
              'import { hxOpenCodeOnDemand } from "./hx-access/hub";\n'
              'import { hxProcessSandboxed } from "./hx-access/sandbox";\n')
    r.replace(drivers,
              "        ...(confinement ? { confine: (target) => confineSpawnTarget(target, confinement, openCodeStatePaths()) } : {}),\n",
              "        // HXBot (v1.6.8): OpenCode asks HXBot before every tool at 最大权限, so it needs no sandbox there.\n"
              "        ...(confinement && hxProcessSandboxed(\"opencode\")\n"
              "          ? { confine: (target) => confineSpawnTarget(target, confinement, openCodeStatePaths()) }\n"
              "          : {}),\n")
    confinement = "src/backend/process-confinement.ts"
    r.replace(confinement, 'import { workspaceTemporaryPaths } from "./agent/workspace-sandbox";\n',
              'import { workspaceTemporaryPaths } from "./agent/workspace-sandbox";\n'
              'import { hxPackageFolders } from "./hx-access/sandbox";\n')
    r.replace(confinement,
              "  const writable = [...confinement.writableRoots, ...state.writable, ...workspaceTemporaryPaths(platform)];\n",
              "  // HXBot (v1.6.8): package managers install and cache outside the workspace (hx-access/sandbox.ts).\n"
              "  const writable = [\n"
              "    ...confinement.writableRoots,\n"
              "    ...state.writable,\n"
              "    ...workspaceTemporaryPaths(platform),\n"
              "    ...hxPackageFolders(platform),\n"
              "  ];\n")
    instructions = "src/backend/agent/developer-instructions.ts"
    r.replace(instructions, 'import { hxOnDemandInstruction } from "../hx-access/hub";\n',
              'import { hxOnDemandInstruction } from "../hx-access/hub";\n'
              'import { hxSandboxInstruction } from "../hx-access/sandbox";\n')
    r.replace(instructions,
              '      : "You have full local computer, filesystem, command, and network access as requested by the user.",\n',
              '      : "You have full local computer, filesystem, command, and network access as requested by the user.",\n'
              "    // HXBot (v1.6.8): what macOS's sandbox refuses, for the providers that still run in it.\n"
              "    ...(workspaceAccessEnforced(agent) ? hxSandboxInstruction(agent.provider) : []),\n")


def apply(r) -> None:
    tool_search(r)
    mac_signing(r)
    accessibility_ready(r)
    grant_press(r)
    grant_text(r)
    sandbox_in_max_access(r)
    move_to_applications(r)
