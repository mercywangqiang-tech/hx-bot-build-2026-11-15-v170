#!/usr/bin/env python3
"""把 OpenBot 源码改造成「HXBot」研究版。

用法（在源码根目录执行）：
    python3 hx/rebrand.py            # 应用全部改造
    python3 hx/rebrand.py --check    # 只检查，不写文件；有未应用的改动时退出码为 1

脚本可以重复运行：已经改过的地方会跳过。每一处改动都按原文精确匹配，
上游代码变了导致匹配不到时会报错退出，而不是悄悄漏改。
品牌名、包标识和域名在 hx/brand.json 里。

最后一步（hx/brand_rename.py）把源码、配置、文档和文件名里所有的 OpenBot（不区分大小写）改成 HXBot。
不改的只有 LICENSE、NOTICE（许可证要求原样保留）、记录上游来源的文件、改造工具本身、远程桌面程序的
固定构建输入，以及兼容旧版本必须认得的旧名称；完整清单和理由见 hx/brand_rename.py。
"""

from __future__ import annotations

import base64
import json
import re
import shutil
import sys
from pathlib import Path

import close_upstream  # 同目录：封堵上游入口的一步和上游地址扫描
import own_names
import accounts as hx_accounts
import access_control  # 同目录：按需授权的接线（HX 自有代码在 src/backend/hx-access）
import brand_rename  # 同目录：最后一步，OpenBot 统一改成 HXBot
import upstream_checks  # 同目录：让改造结果通过上游自己的各项检查
import updates as hx_updates  # 同目录：客户端在应用里更新（v1.6.2）
import delete_account as hx_delete_account  # 同目录：注销账号（v1.6.2）
import access_settings as hx_access_settings  # 同目录：设置 → 授权与记录（v1.6.2）
import forced_updates as hx_forced_updates  # 同目录：强制更新（v1.6.2）
import base_style as hx_base_style  # 同目录：界面基础样式向 WorkBuddy 靠拢（v1.6.3）
import settings_nav as hx_settings_nav  # 同目录：设置窗口按 WorkBuddy 分组（v1.6.4）
import computer_control as hx_computer_control  # 同目录：电脑操控（一）目录和三个工具（v1.6.4）
import auto_model as hx_auto_model  # 同目录：协作（一）按工作内容自动选模型、建议卡（v1.6.5）
import opencode_connect as hx_opencode_connect  # 同目录：在“添加服务商”里连接 OpenCode 的全部服务商（v1.6.5）
import team as hx_team  # 同目录：协作（二）多智能体无缝协作（v1.6.6）
import computer_steps as hx_computer_steps  # 同目录：电脑操控（二）打开应用后一步步操作（v1.6.7）
import computer_real as hx_computer_real  # 同目录：电脑操控（三）真机打通（v1.6.8）
import vault_login as hx_vault_login  # 同目录：保密箱密码自动登录不再拦截（v1.6.8）
import window_fixes as hx_window_fixes  # 同目录：窗口的修正（v1.6.8：全屏时关闭窗口不再留下黑屏）
import quiet as hx_quiet  # 同目录：不打扰其他应用（v1.7.0）
import flow as hx_flow  # 同目录：并发（一）多智能体不卡死、团队不设上限、不拒绝只排队（v1.7.1）
import fixes_172 as hx_fixes_172  # 同目录：修 bug（v1.7.2：程序坞多个图标、打开保存文件卡死等）
import computer_v173 as hx_computer_v173  # 同目录：电脑操控（五）分道、礼让用户、停放续做、读回核对（v1.7.3）
import fixes_173 as hx_fixes_173  # 同目录：全面排查修 bug（v1.7.3：同一出口地址的多人登录等）
import hotfix_173 as hx_hotfix_173  # 同目录：v1.7.3 紧急修正（程序坞第二个图标、边干活边更新、检查更新说清原因）
import office_files as hx_office_files  # 同目录：应用技能（一）办公与文件（v1.7.4）
import flow_v174 as hx_flow_v174  # 同目录：并发（二）提供商在途上限、等待看得见、过载换模型、裁判建议（v1.7.4）
import skills_ui_v174 as hx_skills_ui_v174  # 同目录：应用技能（一）的对话部分：空间满时问你、改了文件的卡片（v1.7.4）
import routines_v175 as hx_routines_v175  # 同目录：应用工作流与定时任务升级（v1.7.5）

ROOT = Path(__file__).resolve().parent.parent
BRAND = json.loads((ROOT / "hx" / "brand.json").read_text(encoding="utf-8"))
NAME = BRAND["productName"]  # HXBot（中英文同名）
APP_ID = BRAND["appId"]
ARTIFACT = BRAND["artifactPrefix"]
VERSIONS = BRAND["versions"]  # 客户端版本号：桌面端（含网页版）、手机端
D = BRAND["domains"]
SITE = f"https://{D['site']}"
API = f"https://{D['api']}"
SIGNAL = f"wss://{D['signal']}/v1/signal"
ACCESS_EMAIL = BRAND["accessEmail"]  # 联系邮箱（账号问题、反馈）
GIRAFFE = json.loads((ROOT / "hx" / "assets" / "hxbot-giraffe.json").read_text(encoding="utf-8"))  # HX BOT 长颈鹿标志
# 长颈鹿在 240×240 标志方块里的位置：高 190、水平居中、上下居中
GIRAFFE_SCALE = 190 / GIRAFFE["height"]
GIRAFFE_TRANSFORM = f"translate({(240 - GIRAFFE['width'] * GIRAFFE_SCALE) / 2:.2f} {(240 - 190) / 2:.2f}) scale({GIRAFFE_SCALE:.4f})"

CHECK_ONLY = "--check" in sys.argv
pending: list[str] = []
errors: list[str] = []
changes: list[str] = []  # 这次运行实际改动的文件；有改动才需要最后的整理格式（brand_rename.finish）


def actual(path: str) -> str:
    """改名以后文件可能已经换了名字：原路径不存在、改名后的路径存在时，用改名后的路径。"""
    if (ROOT / path).exists():
        return path
    moved = brand_rename.renamed_path(path)
    return moved if (ROOT / moved).exists() else path


def read(path: str) -> str:
    return (ROOT / actual(path)).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    if CHECK_ONLY:
        pending.append(path)
        return
    changes.append(path)
    (ROOT / actual(path)).write_text(text, encoding="utf-8")


def gone(path: str) -> bool:
    """上游官网宣传页的文件已被最后一步删掉（hx/marketing-files.txt）：改它的步骤直接跳过。"""
    return not (ROOT / actual(path)).exists() and path in brand_rename.marketing_files()


def squash(text: str) -> str:
    """去掉空白和右括号前的逗号：改名以后 Biome 重新折行（brand_rename.format_files），比较时不看折行。"""
    return re.sub(r",(?=[)\]}])", "", re.sub(r"\s+", "", text))


def applied(path: str, new: str, text: str) -> bool:
    """`new` 已经在文件里：原样，或者已经过了最后一步的改名（及改名后的重新折行）。"""
    if new in text:
        return True
    renamed = brand_rename.renamed(new, actual(path))
    # 结尾的逗号不比较：文件里它后面如果紧跟右括号，squash 已经把它去掉了
    return renamed in text or squash(renamed).rstrip(",") in squash(text)


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    """Replace `old` with `new` exactly `count` times. Skips when already applied."""
    if gone(path):
        return
    text = read(path)
    if new and applied(path, new, text):  # 已经改过（有些改动是在原文前后插入，原文仍在，所以先看新文）
        return
    found = text.count(old)
    if found == 0 and not new:  # 删除类改动，已删过
        return
    if found == 0 and upstream_checks.removed_message(path, old, new):  # 这条界面文字已不再使用，被最后的步骤删掉了
        return
    if found != count:
        errors.append(f"{path}: expected {count} match(es), found {found}: {old[:90]!r}")
        return
    write(path, text.replace(old, new))


def rewrite(path: str, upstream_marker: str, new: str) -> None:
    """整文件替换：文件已是新内容时跳过；含上游标记时写入新内容；两者都不是时报错（上游可能已改动）。"""
    if gone(path):
        return
    text = read(path)
    renamed = brand_rename.renamed(new, actual(path))
    if text == new or text == renamed or squash(text) == squash(renamed):
        return
    if upstream_marker not in text:
        errors.append(f"{path}: upstream marker not found: {upstream_marker[:90]!r}")
        return
    write(path, new)


def regex(path: str, pattern: str, new: str) -> int:
    if gone(path):
        return 0
    text = read(path)
    result, n = re.subn(pattern, new, text)
    if n and result != text:
        write(path, result)
    return n


def json_edit(path: str, edit) -> None:
    if gone(path):
        return
    data = json.loads(read(path))
    before = json.dumps(data, ensure_ascii=False, sort_keys=True)
    edit(data)
    after = json.dumps(data, ensure_ascii=False, sort_keys=True)
    if after != before and brand_rename.renamed(after, actual(path)) != before:
        write(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


# ---------------------------------------------------------------- 桌面端（Electron）
def desktop() -> None:
    eb = "electron-builder.yml"
    replace(eb, "appId: app.openbot.desktop", f"appId: {APP_ID}")
    replace(eb, "productName: OpenBot\n", f"productName: {NAME}\n")
    replace(
        eb,
        "copyright: Copyright © 2026 Synthetify Labs spółka z ograniczoną odpowiedzialnością",
        # 对外不写来源项目；版权与许可原文在安装包内的 LICENSE、NOTICE（许可要求，不能删）。
        "copyright: HXBot 研究版 · 仅限研究使用，不得用于商业用途 · 版权与许可见安装包内 LICENSE、NOTICE",
    )
    replace(eb, "  - name: OpenBot invitations\n", f"  - name: {NAME} invitations\n")
    replace(eb, "artifactName: ${productName}-${version}-${arch}.${ext}", f"artifactName: {ARTIFACT}-${{version}}-${{arch}}.${{ext}}")
    # 不从 nightly-labs/openbot 的 GitHub Releases 自动更新，而是从 HXBot 自己的服务器（v1.6.2 起）：
    # electron-builder 把这个地址写进安装包的 app-update.yml，并在 dist/ 生成 latest*.yml 和 .blockmap，
    # 由 hx/scripts/upload-downloads.sh 传到服务器的 /opt/hxbot/downloads/updates/desktop/（登录后才能取，见 hx/updates.py）。
    replace(eb, "publish:\n  provider: github\n  owner: nightly-labs\n  repo: openbot\n",
            f"publish:\n  provider: generic\n  url: {SITE}/updates/desktop\n")
    replace(eb, "  notarize: true\n", "  notarize: false\n")
    replace(eb, "    CFBundleIconName: Icon\n    ElectronTeamID: ZTRDTUL87R\n", "")
    replace(eb, "    - from: build/macos/Assets.car\n      to: Assets.car\n", "")
    replace(eb, "NSMicrophoneUsageDescription: OpenBot uses", f"NSMicrophoneUsageDescription: {NAME} uses")
    replace(eb, "NSScreenCaptureUsageDescription: OpenBot captures", f"NSScreenCaptureUsageDescription: {NAME} captures")
    replace(eb, "NSAppleEventsUsageDescription: OpenBot sends", f"NSAppleEventsUsageDescription: {NAME} sends")
    replace(eb, "  synopsis: A local-first multi-agent desktop workspace.", f"  synopsis: {NAME} research edition, a multi-agent workspace. For research use only.")
    # Windows 安装器：用户数据目录随 app.setName 变成 %APPDATA%\HXBot，安装器的保护检查要跟着改。
    nsh = "build/installer.nsh"
    replace(nsh, '"$APPDATA\\OpenBot"', f'"$APPDATA\\{NAME}"', count=2)
    replace(nsh, '${FileExists} "$APPDATA\\OpenBot\\${APP_EXECUTABLE_FILENAME}"', f'${{FileExists}} "$APPDATA\\{NAME}\\${{APP_EXECUTABLE_FILENAME}}"')
    replace(nsh, '"URL:OpenBot invitations"', f'"URL:{NAME} invitations"')

    def package(data: dict) -> None:
        data["productName"] = NAME
        data["version"] = VERSIONS["desktop"]
        data["description"] = f"{NAME}：弘犀智能多智能体桌面工作台研究版，仅限研究使用。"
        data["homepage"] = SITE

    json_edit("package.json", package)

    main = "src/main/index.ts"
    replace(main, 'import { uptime } from "node:os";\n', 'import "./hx-defaults";\nimport { uptime } from "node:os";\n')
    replace(main, 'app.setName("OpenBot");', f'app.setName("{NAME}");')
    replace(main, 'app.setAppUserModelId("app.openbot.desktop")', f'app.setAppUserModelId("{APP_ID}")')
    replace(main, 'new Notification({ title: "OpenBot", body:', f'new Notification({{ title: "{NAME}", body:')

    services = "src/main/application-services.ts"
    replace(services, 'app.isPackaged ? "https://api.openbot.run" : "http://127.0.0.1:3100",', f'app.isPackaged ? "{API}" : "http://127.0.0.1:3100",')
    # 研究版不向 OpenBot 的统计服务发送任何数据。
    replace(
        services,
        'const analyticsEnabled = (app.isPackaged && appVariant === "production") || analyticsCaptureUrl !== null;',
        "const analyticsEnabled = analyticsCaptureUrl !== null; // HXBot: no product analytics",
    )
    replace(
        "src/renderer/src/error-reports.ts",
        'if (capture === undefined && (!import.meta.env.PROD || info.variant !== "production")) return;',
        "if (capture === undefined) return; // HXBot: no error reports to OpenBot",
    )
    replace(
        "src/renderer/src/analytics.ts",
        'function shouldEnableDesktopAnalytics(appInfo: AppInfo, productionBuild: boolean): boolean {\n'
        '  return appInfo.analyticsCaptureUrl !== undefined || (productionBuild && appInfo.variant === "production");',
        "function shouldEnableDesktopAnalytics(appInfo: AppInfo, _productionBuild: boolean): boolean {\n"
        "  return appInfo.analyticsCaptureUrl !== undefined; // HXBot: no product analytics",
    )
    # 界面里写死的产品名（服务器名占位、错误页、权限引导卡片）
    for path, old in (
        ("src/renderer/src/platform.tsx", '              name: "OpenBot",'),
        ("src/renderer/src/features/servers/server-settings.tsx", 'const FALLBACK_SERVER_NAME = "OpenBot";'),
        ("src/renderer/src/features/onboarding/SetupReadError.tsx", 'const PRODUCT_NAME = "OpenBot";'),
        ("src/renderer/src/features/computer-use/ComputerUsePermissionHelp.tsx", 'const OPENBOT_APP_NAME = "OpenBot";'),
        ("src/renderer/src/features/web-client/WebWorkspace.tsx", 'const WEB_APP_INFO: AppInfo = { name: "OpenBot",'),
        ("src/renderer/src/features/web-client/WebWorkspace.tsx", 'serverName={workspace.state.host?.name ?? "OpenBot"}'),
        ("src/main/server-mode.ts", 'const DEFAULT_SERVER_NAME = "OpenBot";'),
        ("src/main/mobile-connect-host.ts", 'host.configure({ serverName: "OpenBot" })'),
    ):
        replace(path, old, old.replace('"OpenBot"', f'"{NAME}"'))
    # 不显示 OpenBot 社区（Discord、X）卡片，不提示给 OpenBot 的 GitHub 加星或在社交网络发帖。
    replace(
        "src/renderer/src/features/sidebar/community-card.ts",
        "  const [dismissed, setDismissed] = createSignal(readDismissed());",
        "  // HXBot: the OpenBot community card (Discord, X) never shows.\n"
        "  const [dismissed, setDismissed] = createSignal(HX_HIDE_COMMUNITY_CARD || readDismissed());",
    )
    replace(
        "src/renderer/src/features/sidebar/community-card.ts",
        'const COMMUNITY_CARD_DISMISSED_STORAGE_KEY = "openbot:community-card-dismissed";',
        'const COMMUNITY_CARD_DISMISSED_STORAGE_KEY = "openbot:community-card-dismissed";\nconst HX_HIDE_COMMUNITY_CARD = true;',
    )
    replace(
        "src/renderer/src/features/conversation/github-star-prompt.tsx",
        "  if (sent < SENDS_BEFORE_PROMPT) return;",
        "  if (sent < SENDS_BEFORE_PROMPT || sent > 0) return; // HXBot: never ask for a star on OpenBot's GitHub",
    )
    replace(
        "src/renderer/src/features/conversation/social-follow-prompt.tsx",
        "  return githubStarPromptShownThisSession() || dialogOpen();",
        "  return true || githubStarPromptShownThisSession() || dialogOpen(); // HXBot: no OpenBot social prompts",
    )
    for html in ("src/renderer/index.html", "src/renderer/helper.html"):
        replace(html, "<title>OpenBot</title>", f"<title>{NAME}</title>")
    replace("src/renderer/browser-pip.html", "<title>OpenBot Browser</title>", f"<title>{NAME} Browser</title>")


# ---------------------------------------------------------------- 账号服务里仍对外的页面（邀请页、集成回调、出错页）
def site_pages() -> None:
    """邀请页 /join 等“单一任务”页面原本套着上游官网的页头（含上游名称、导航与源码仓库链接）和页脚。
    研究版只留标志和产品名，链接回下载页；上游官网的其余页面由 nginx 一律转回下载页。"""
    page = "apps/auth-api/src/components/transactional/TransactionalPage.tsx"
    replace(page, 'import type { JSX } from "@solidjs/web";\nimport { LandingFooter } from "../landing/LandingFooter";\nimport { SiteHeader } from "../landing/SiteHeader";\n',
            'import { AppLogo } from "@openbot/brand";\nimport type { JSX } from "@solidjs/web";\n')
    replace(page, '      <SiteHeader page="content" />\n',
            '      {/* HXBot：只留标志和产品名，链接回下载页；不显示上游官网的导航与页脚 */}\n'
            '      <header class="landing-header">\n'
            f'        <a class="landing-brand" href="/" aria-label="{NAME}">\n'
            '          <AppLogo variant="production" class="landing-brand-logo" />\n'
            f'          <span>{NAME}</span>\n'
            "        </a>\n"
            "      </header>\n")
    replace(page, "      </main>\n      <LandingFooter />\n", "      </main>\n      {/* 研究版不显示上游官网的页脚 */}\n")
    # 其余页面里写死的产品名（这些页面已不对外，改掉以防万一）
    for path in ("apps/auth-api/src/components/brand/SiteLogoLink.tsx", "apps/auth-api/src/components/landing/LandingFooter.tsx",
                 "apps/auth-api/src/components/landing/LandingPage.tsx"):
        replace(path, "<span>OpenBot</span>", f"<span>{NAME}</span>")
    # 链接预览（微信、Slack 等）里的网站名与配图说明
    join = "apps/auth-api/src/routes/join.tsx"
    replace(join, 'import { OPENBOT_X_HANDLE, type PageSocialImage, pageSocialImageMeta } from "../lib/site-metadata";',
            'import { type PageSocialImage, pageSocialImageMeta } from "../lib/site-metadata";')
    replace(join, '  alt: "Good ideas. Made together. OpenBot agents around a glass table",', f'  alt: "{NAME}",')
    replace(join, '        { name: "twitter:site", content: OPENBOT_X_HANDLE },\n', "")
    for path in ("apps/auth-api/src/routes/join.tsx", "apps/auth-api/src/lib/site-metadata.ts", "apps/auth-api/src/lib/site-page-head.ts"):
        replace(path, '{ property: "og:site_name", content: "OpenBot" }', f'{{ property: "og:site_name", content: "{NAME}" }}')


# ---------------------------------------------------------------- 应用内标识（桌面、网页共用的 AppLogo；安卓另有一份）
def giraffe_ts() -> str:
    spots = "".join(f'    "{d}",\n' for d in GIRAFFE["spots"])
    e, c = GIRAFFE["eye"], GIRAFFE["colors"]
    return (
        "\n// HXBot：长颈鹿标志（数据来自 hx/assets/hxbot-giraffe.json；坐标以图形外框左上角为原点）。\n"
        "export const HX_GIRAFFE = {\n"
        f"  width: {GIRAFFE['width']},\n"
        f"  height: {GIRAFFE['height']},\n"
        f'  body: "{GIRAFFE["body"]}",\n'
        f"  spots: [\n{spots}  ],\n"
        f"  eye: {{ cx: {e['cx']}, cy: {e['cy']}, rx: {e['rx']}, ry: {e['ry']} }},\n"
        f'  colors: {{ body: "{c["body"]}", spots: "{c["spots"]}", eye: "{c["eye"]}" }},\n'
        "} as const;\n"
    )


MOBILE_APP_LOGO = f"""import {{ HX_GIRAFFE }} from "@openbot/brand/app-logo-shape";
import {{ Pressable, View }} from "react-native";
import Svg, {{ Ellipse, G, Path, Rect }} from "react-native-svg";
import {{ type AppLogoAnimation, useAppLogoMotion }} from "@/features/auth/components/use-app-logo-motion";
import {{ useText }} from "@/shared/lib/text";

export interface AppLogoProps {{
  animation?: AppLogoAnimation;
  interactive?: boolean;
  size?: number;
}}

const VIEWBOX_SIZE = 240;

// HXBot：白底上的长颈鹿标志（代替上游的眼睛标识；数据见 hx/assets/hxbot-giraffe.json）。
export function AppLogo({{ animation = "none", interactive = false, size = VIEWBOX_SIZE }}: AppLogoProps) {{
  const {{ t }} = useText();
  const {{ handlePressIn }} = useAppLogoMotion({{ animation, size }});

  const logo = (
    <View
      style={{{{ height: size, width: size }}}}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={{size}} height={{size}} viewBox={{`0 0 ${{VIEWBOX_SIZE}} ${{VIEWBOX_SIZE}}`}}>
        <Rect width={{VIEWBOX_SIZE}} height={{VIEWBOX_SIZE}} rx={{50}} ry={{50}} fill="#FFFFFF" />
        <G transform="{GIRAFFE_TRANSFORM}">
          <Path d={{HX_GIRAFFE.body}} fill={{HX_GIRAFFE.colors.body}} />
          <Path d={{HX_GIRAFFE.spots.join("")}} fill={{HX_GIRAFFE.colors.spots}} />
          <Ellipse
            cx={{HX_GIRAFFE.eye.cx}}
            cy={{HX_GIRAFFE.eye.cy}}
            rx={{HX_GIRAFFE.eye.rx}}
            ry={{HX_GIRAFFE.eye.ry}}
            fill={{HX_GIRAFFE.colors.eye}}
          />
        </G>
      </Svg>
    </View>
  );

  if (!interactive) return logo;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={{t("mobile.auth.logo.animate")}}
      accessibilityHint={{t("mobile.auth.logo.animateHint")}}
      onPressIn={{handlePressIn}}
      pressRetentionOffset={{12}}
    >
      {{logo}}
    </Pressable>
  );
}}
"""


def logo() -> None:
    app_logo = "packages/brand/src/AppLogo.tsx"
    replace(
        app_logo,
        '      <g class="app-logo-eye-motion">\n'
        '        <polyline class="app-logo-eye app-logo-eye-left" points={APP_LOGO_EYE_POINTS.left} />\n'
        "      </g>\n"
        '      <g class="app-logo-eye-motion">\n'
        '        <polyline class="app-logo-eye app-logo-eye-right" points={APP_LOGO_EYE_POINTS.right} />\n'
        "      </g>\n",
        "      {/* HXBot：白底上的长颈鹿标志（代替上游的眼睛标识；数据见 hx/assets/hxbot-giraffe.json） */}\n"
        '      <rect width={APP_LOGO_SIZE} height={APP_LOGO_SIZE} rx={APP_LOGO_CORNER} ry={APP_LOGO_CORNER} fill="#ffffff" />\n'
        f'      <g transform="{GIRAFFE_TRANSFORM}">\n'
        "        <path d={HX_GIRAFFE.body} fill={HX_GIRAFFE.colors.body} />\n"
        '        <path d={HX_GIRAFFE.spots.join("")} fill={HX_GIRAFFE.colors.spots} />\n'
        "        <ellipse\n"
        "          cx={HX_GIRAFFE.eye.cx}\n"
        "          cy={HX_GIRAFFE.eye.cy}\n"
        "          rx={HX_GIRAFFE.eye.rx}\n"
        "          ry={HX_GIRAFFE.eye.ry}\n"
        "          fill={HX_GIRAFFE.colors.eye}\n"
        "        />\n"
        "      </g>\n",
    )
    replace(app_logo, 'import { APP_LOGO_CORNER, APP_LOGO_EYE_POINTS, APP_LOGO_SIZE } from "./app-logo-shape";', 'import { APP_LOGO_CORNER, APP_LOGO_SIZE, HX_GIRAFFE } from "./app-logo-shape";')
    # 长颈鹿的矢量数据放进 app-logo-shape.ts，桌面、网页与安卓共用
    shape = "packages/brand/src/app-logo-shape.ts"
    replace(shape, "} as const;\n", "} as const;\n" + giraffe_ts())
    # 安卓端的应用内标识（登录页、关于页等）：整文件换成白底长颈鹿，保留原来的属性与点击反馈
    rewrite("apps/mobile/src/features/auth/components/app-logo.tsx", "const LEFT_EYE_POINTS =", MOBILE_APP_LOGO)
    replace(app_logo, 'aria-label={props.interactive ? "Animate OpenBot logo" : undefined}', f'aria-label={{props.interactive ? "{NAME} logo" : undefined}}')
    tokens = "packages/brand/src/tokens.css"
    replace(tokens, "  --openbot-logo-production: #d6adf2;\n  --openbot-logo-eye: #040007;", "  --openbot-logo-production: #1e6fd9;\n  --openbot-logo-eye: #040007;")
    replace(tokens, "  --openbot-logo-production-eye: var(--openbot-logo-eye);", "  --openbot-logo-production-eye: #ffffff;")
    native = "packages/brand/src/tokens-native.css"
    replace(native, "    --openbot-logo-production: #cdadec;", "    --openbot-logo-production: #1e6fd9;")
    replace(native, "    --openbot-logo-production: #d6adf2;", "    --openbot-logo-production: #1e6fd9;")


# ---------------------------------------------------------------- 共享常量（桌面、网页、手机都用）
def shared() -> None:
    links = "packages/contracts/src/invite-links.ts"
    replace(links, 'export const OPENBOT_INVITE_ORIGIN = "https://openbot.run";', f'export const OPENBOT_INVITE_ORIGIN = "{SITE}";')
    replace(links, 'export const OPENBOT_CONTROL_PLANE_ORIGIN = "https://api.openbot.run";', f'export const OPENBOT_CONTROL_PLANE_ORIGIN = "{API}";')
    rd = "packages/team-client/src/remote-directory.ts"
    replace(rd, 'origin === "https://openbot.run" &&\n        inviteOrigin === "https://api.openbot.run";', f'origin === "{SITE}" &&\n        inviteOrigin === "{API}";')


# ---------------------------------------------------------------- 账号服务（apps/auth-api）
def account() -> None:
    target = ROOT / "apps/auth-api/wrangler.jsonc"
    upstream = ROOT / "apps/auth-api/wrangler.upstream.jsonc"
    ours = (ROOT / "hx/server/account/wrangler.hx.jsonc").read_text(encoding="utf-8")
    if target.read_text(encoding="utf-8") != ours:
        if CHECK_ONLY:
            pending.append(str(target))
        else:
            if not upstream.exists():
                shutil.copyfile(target, upstream)
            target.write_text(ours, encoding="utf-8")
            changes.append(str(target))

    # v1.7.1: the D1 database of the account service is "hxbot-account" (hx/server/account/wrangler.hx.jsonc,
    # hx/server/scripts/users.py); the migration scripts named the upstream one, so a local `bun run dev`
    # could not create the account tables ("Couldn't find a D1 DB with the name or binding 'hxbot-auth'").
    pkg = "apps/auth-api/package.json"
    replace(pkg, '"wrangler d1 migrations apply openbot-auth --local"', '"wrangler d1 migrations apply hxbot-account --local"')
    replace(pkg, '"wrangler d1 migrations apply openbot-auth --remote"', '"wrangler d1 migrations apply hxbot-account --remote"')

    meta = "apps/auth-api/src/lib/site-metadata.ts"
    replace(meta, 'export const OPENBOT_SITE_URL = "https://openbot.run/";', f'export const OPENBOT_SITE_URL = "{SITE}/";')
    replace(
        meta,
        'export const OPENBOT_SITE_TITLE = "OpenBot: Run a team of AI agents on your computer";',
        f'export const OPENBOT_SITE_TITLE = "{NAME} 研究版 · 弘犀智能";',
    )
    replace(meta, 'const OPENBOT_PRODUCTION_HOSTS = new Set(["openbot.run", "api.openbot.run"]);', f'const OPENBOT_PRODUCTION_HOSTS = new Set(["{D["site"]}", "{D["api"]}"]);')
    replace("apps/auth-api/src/routes/app.tsx", 'meta: [{ title: "OpenBot web" }', f'meta: [{{ title: "{NAME} 网页版" }}')
    replace("apps/auth-api/src/routes/__root.tsx", 'const NOT_FOUND_TITLE = "Page not found · OpenBot";', f'const NOT_FOUND_TITLE = "Page not found · {NAME}";')

    handler = "apps/auth-api/src/server/worker-handler.ts"
    # 其他步骤加的 import（例如 hx-client-version）按字母顺序会排在这两行之间，所以按这一行在不在文件里判断
    if 'import { hxForwardedRequest } from "./hx-forwarded";' not in read(handler):
        replace(handler, 'import { HostedSiteService } from "./hosted-site-service";\n', 'import { HostedSiteService } from "./hosted-site-service";\nimport { hxForwardedRequest } from "./hx-forwarded";\n')
    replace(
        handler,
        "      context?: WorkerExecutionContext,\n    ) {\n      const bindings = workerBindings.DB",
        "      context?: WorkerExecutionContext,\n    ) {\n      request = hxForwardedRequest(request);\n      const bindings = workerBindings.DB",
    )

    auth = "apps/auth-api/src/server/auth-service.ts"
    replace(
        auth,
        "  usesCompanySignIn?: (email: string) => Effect.Effect<boolean, AuthOperationError>;\n}",
        "  usesCompanySignIn?: (email: string) => Effect.Effect<boolean, AuthOperationError>;\n"
        "  /** HXBot: the research access list (hx-access.ts). Absent: every email may sign in. */\n"
        "  emailAllowed?: (email: string) => boolean;\n}",
    )
    replace(
        auth,
        "    usesCompanySignIn: (email: string) => Effect.Effect<boolean, AuthOperationError>;\n  }\n>",
        "    usesCompanySignIn: (email: string) => Effect.Effect<boolean, AuthOperationError>;\n    emailAllowed: (email: string) => boolean;\n  }\n>",
    )
    replace(
        auth,
        "      usesCompanySignIn: options.usesCompanySignIn ?? (() => Effect.succeed(false)),\n",
        "      usesCompanySignIn: options.usesCompanySignIn ?? (() => Effect.succeed(false)),\n      emailAllowed: options.emailAllowed ?? (() => true),\n",
    )
    replace(
        auth,
        "      const email = yield* authValidate(() => normalizeEmail(emailInput));\n      if (yield* dependencies.usesCompanySignIn(email)) {",
        "      const email = yield* authValidate(() => normalizeEmail(emailInput));\n"
        "      if (!dependencies.emailAllowed(email)) {\n"
        "        return yield* new AuthServiceError(\n"
        "          403,\n"
        '          "email_not_allowed",\n'
        '          "该邮箱不在 HXBot 研究版名单中。This email is not on the HXBot research access list.",\n'
        "        );\n"
        "      }\n"
        "      if (yield* dependencies.usesCompanySignIn(email)) {",
    )
    ra = "apps/auth-api/src/server/request-auth.ts"
    replace(ra, 'import { HostedSiteService } from "./hosted-site-service";\n', 'import { HostedSiteService } from "./hosted-site-service";\nimport { hxEmailAllowed } from "./hx-access";\n')
    replace(
        ra,
        "    attribution: new AccountAttribution({ database: bindings.DB, analytics }),\n    usesCompanySignIn: (email) =>",
        "    attribution: new AccountAttribution({ database: bindings.DB, analytics }),\n"
        "    emailAllowed: hxEmailAllowed({\n"
        "      emails: bindings.HX_ALLOWED_EMAILS,\n"
        "      domains: bindings.HX_ALLOWED_EMAIL_DOMAINS,\n"
        "    }),\n"
        "    usesCompanySignIn: (email) =>",
    )

    mail = "apps/auth-api/src/server/email-templates.ts"
    replace(mail, 'const SITE_URL = "https://openbot.run";', f'const SITE_URL = "{SITE}";')
    replace(mail, '  { label: "openbot.run", href: SITE_URL },', f'  {{ label: "{D["site"]}", href: SITE_URL }},')
    replace(mail, 'const subject = "Your OpenBot sign-in code";', f'const subject = "{NAME} 登录验证码 / Your {NAME} sign-in code";')
    regex(mail, r"(?<![A-Za-z0-9_@/.-])OpenBot(?![A-Za-z0-9_/-])", NAME)
    replace("apps/auth-api/src/server/smtp-email-delivery.ts", 'writeCommand(writer, "EHLO openbot.run")', f'writeCommand(writer, "EHLO {D["site"]}")')
    smtp = "apps/auth-api/src/server/smtp-email-delivery.ts"
    # 发件人一行由 accounts.py 的 mail 一步改写（发件人名称跟邮件走，默认是产品名）
    replace(smtp, "`Message-ID: <${crypto.randomUUID()}@openbot.run>`,", f"`Message-ID: <${{crypto.randomUUID()}}@{D['site']}>`,")
    # 邮件各部分之间的分隔串：收件人查看邮件原文时看得到
    replace(smtp, "const boundary = `openbot-${crypto.randomUUID()}`;", "const boundary = `hxbot-${crypto.randomUUID()}`;")
    replace("apps/auth-api/src/server/email-delivery.ts", 'from: { name: "OpenBot", email: from },', f'from: {{ name: "{NAME}", email: from }},')
    replace(auth_service_path := "apps/auth-api/src/server/auth-service.ts", '"OpenBot could not send the sign-in code."', '"验证码邮件发送失败。HXBot could not send the sign-in code."', count=2)
    # 邮件页脚：去掉 OpenBot 的 X、GitHub 链接，换成弘犀智能官网
    replace(
        mail,
        '  { label: "X", href: OPENBOT_LINKS.x },\n  { label: "GitHub", href: OPENBOT_LINKS.repository },\n',
        f'  {{ label: "{BRAND["company"]}", href: "https://{D["website"]}" }},\n',
    )
    replace(mail, 'import { OPENBOT_DOWNLOAD_PAGE_LINKS, OPENBOT_LINKS } from "../lib/landing-links";', 'import { OPENBOT_DOWNLOAD_PAGE_LINKS } from "../lib/landing-links";')
    # 登录验证码邮件：中英双语
    replace(
        mail,
        '      ["Use this code to sign in to HXBot:", "", input.code, "", `This code expires in ${minutes} and works once.`],',
        '      [\n        "你的 HXBot 登录验证码（10 分钟内有效，只能使用一次）：",\n        "Use this code to sign in to HXBot:",\n        "",\n        input.code,\n        "",\n        `This code expires in ${minutes} and works once.`,\n      ],',
    )
    replace(mail, '        heading("Your sign-in code"),\n        paragraph("Enter this code in HXBot to finish signing in."),',
        '        heading("HXBot 登录验证码 · Your sign-in code"),\n        paragraph("在 HXBot 中输入下面的验证码完成登录。Enter this code in HXBot to finish signing in."),')
    replace(mail, 'const footer = "If you did not request this code, you can ignore this email. Nobody can sign in without it.";',
        'const footer =\n    "如果不是你本人操作，请忽略这封邮件，没有验证码任何人都无法登录。If you did not request this code, you can ignore this email. Nobody can sign in without it.";')

    def manifest(data: dict) -> None:
        data["name"] = NAME
        data["short_name"] = NAME
        data["description"] = "弘犀智能多智能体工作台研究版，仅限研究使用。"

    json_edit("apps/auth-api/public/site.webmanifest", manifest)
    robots = "User-agent: *\nDisallow: /\n"
    if read("apps/auth-api/public/robots.txt") != robots:
        write("apps/auth-api/public/robots.txt", robots)


# ---------------------------------------------------------------- 安卓端与 iOS 端（apps/mobile）
def mobile() -> None:
    def app_json(data: dict) -> None:
        expo = data["expo"]
        expo["name"] = NAME
        expo["version"] = VERSIONS["mobile"]
        expo["slug"] = "hx-bot"
        expo.pop("owner", None)
        expo["updates"] = {"enabled": False}  # 不接收 OpenBot 的 EAS 在线更新（关闭 expo-updates）
        expo.get("extra", {}).pop("eas", None)
        expo["android"]["package"] = BRAND["androidPackage"]
        expo["ios"]["bundleIdentifier"] = BRAND["appId"]
        expo["ios"]["associatedDomains"] = [f"applinks:{D['site']}"]
        expo["ios"]["infoPlist"]["NSLocalNetworkUsageDescription"] = f"Allow {NAME} to connect to your desktop during local development."
        # 单色图标（安卓 13 主题图标）只用长颈鹿剪影；启动画面为白底长颈鹿（图片由 hx/make_icons.py 生成）
        expo["android"]["adaptiveIcon"]["monochromeImage"] = "./assets/icons/android-adaptive-mono.png"
        for plugin in expo["plugins"]:
            if isinstance(plugin, list) and plugin[0] == "expo-splash-screen":
                plugin[1]["backgroundColor"] = "#FFFFFF"
                plugin[1]["image"] = "./assets/splash/hxbot.png"
                plugin[1]["dark"] = {"backgroundColor": "#1F1F1F", "image": "./assets/splash/hxbot.png"}

    json_edit("apps/mobile/app.json", app_json)

    def mobile_package(data: dict) -> None:
        data["version"] = VERSIONS["mobile"]

    json_edit("apps/mobile/package.json", mobile_package)
    # 账号服务按手机端的版本号开关功能：浏览器画面给研究版的各个版本；上游的托管服务器（付费云主机）研究版没有，关掉。
    # “有新版本”提示（点开是下载页）以研究版的手机端版本为准。
    features = "apps/auth-api/src/server/mobile-features-config.ts"
    replace(features,
            '  cloudServers: {\n    ios: { upTo: "1.4.7" },\n    android: { upTo: "1.4.6" },\n  },\n'
            '  browser: {\n    ios: { upTo: "1.4.7" },\n    android: { upTo: "1.4.6" },\n  },\n',
            '  // HXBot: no hosted servers; the browser view in every version of the research edition.\n'
            '  cloudServers: {\n    ios: { upTo: "0" },\n    android: { upTo: "0" },\n  },\n'
            f'  browser: {{\n    ios: {{ upTo: "{VERSIONS['mobile']}" }},\n    android: {{ upTo: "{VERSIONS['mobile']}" }},\n  }},\n')
    replace(features,
            'export const MOBILE_LATEST_VERSIONS: MobileLatestVersions = {\n  ios: "1.4.7",\n  android: "1.4.6",\n};',
            # v1.7.5: iOS can lag Android (no iOS package without a D-U-N-S number): its latest is mobileIos.
            f'export const MOBILE_LATEST_VERSIONS: MobileLatestVersions = {{\n  ios: "{VERSIONS.get("mobileIos", VERSIONS["mobile"])}",\n  android: "{VERSIONS["mobile"]}",\n}};')
    gs = ROOT / "apps/mobile/google-services.json"
    if gs.exists():  # OpenBot 自己的 Firebase 项目，研究版不用（安卓推送通知第一版关闭）
        if CHECK_ONLY:
            pending.append(str(gs))
        else:
            gs.unlink()
            changes.append(str(gs))
    for path, old, new in (
        ("apps/mobile/src/features/settings/screens/about-settings-screen.tsx", 'open("https://openbot.run")', f'open("{SITE}")'),
        ("apps/mobile/src/features/servers/screens/add-server-screen.tsx", 'const INVITE_PLACEHOLDER = "https://openbot.run/join?…";', f'const INVITE_PLACEHOLDER = "{SITE}/join?…";'),
        ("apps/mobile/src/features/links/model/incoming-links.ts", 'new URL(path, "https://openbot.run")', f'new URL(path, "{SITE}")'),
    ):
        replace(path, old, new)


# ---------------------------------------------------------------- 界面文字（15 种语言）
BRAND_WORD = re.compile(r"(?<![A-Za-z0-9_.@/\\-])OpenBot(?![A-Za-z0-9_/-])")


def visible_names() -> None:
    """界面上能看到、但不在翻译文件里的产品名：登录页字标、关于页、通知标题、窗口标题、备份文件名等。"""
    for path, old in (
        ("packages/ui/src/features/account/AccountLogin.tsx", 'const PRODUCT_NAME = "OpenBot";'),
        ("packages/ui/src/features/account/LanguageWheel.tsx", 'const PRODUCT_NAME = "OpenBot";'),
        ("apps/mobile/src/features/settings/screens/about-settings-screen.tsx", 'const PRODUCT_NAME = "OpenBot";'),
        ("apps/mobile/src/features/workspace/context/mobile-workspace-context.tsx", '  id: "unavailable",\n  name: "OpenBot",'),
        ("src/main/ipc/notification-handlers.ts", 'new Notification({ title: "OpenBot", body:'),
        ("packages/ui/src/user-avatar.tsx", '|| "OpenBot";'),
        ("src/main/loopback-callback-server.ts", "<title>OpenBot</title>"),
        ("src/main/browser-picture-in-picture.ts", 'title: "OpenBot Browser",'),
        ("src/main/maintenance-service.ts", '"OpenBot Backup"'),
        ("apps/mobile/src/features/support/model/support-log-capture.ts", '"OpenBot support log"'),
        ("apps/mobile/src/features/share/extension/share-sender.ts", '"The server needs another OpenBot version."'),
        ("src/main/onepassword-connector-service.ts", 'integrationName: "OpenBot"'),
        # 助手模板的分享卡片（一张图片）上的字标
        ("src/renderer/src/features/agent-templates/agent-template-card.tsx", 'context.fillText("OpenBot", x + 58, 124);'),
    ):
        replace(path, old, old.replace("OpenBot", NAME))
    replace("packages/ui/src/features/settings/stores/updates-store.ts", "`OpenBot v${", f"`{NAME} v${{")
    replace("src/main/maintenance-service.ts", "`OpenBot-backup-${", f"`{ARTIFACT}-backup-${{")
    # 密码管理器里要按名字找的保险库/文件夹。界面文字（各语言）都写 “Shared with HXBot”，代码必须找同一个名字。
    for path, old in (
        ("src/main/bitwarden-connector-service.ts", 'folder.name === "Shared with OpenBot"'),
        ("src/main/onepassword-connector-service.ts", 'const ONEPASSWORD_SHARED_VAULT = "Shared with OpenBot";'),
        ("src/main/password-managers/proton-pass-driver.ts", 'const PROTON_PASS_SHARED_VAULT = "Shared with OpenBot";'),
    ):
        replace(path, old, old.replace("OpenBot", NAME))


def interface_text() -> None:
    messages = ROOT / "packages/i18n/src/messages"
    total = 0
    for file in sorted(messages.rglob("*.ts")):
        # 中英文同名（HXBot）：原文在中文和 “OpenBot” 之间留的空格照旧保留
        text = file.read_text(encoding="utf-8")
        result, n = BRAND_WORD.subn(NAME, text)
        if n:
            total += n
            write(str(file.relative_to(ROOT)), result)
    if total:
        print(f"  界面文字：替换品牌名 {total} 处")


def message_line(key: str, value: str) -> str:
    """One line of a message catalog, wrapped the way the formatter wraps a line over 120 columns."""
    line = f"  {json.dumps(key, ensure_ascii=False)}: {json.dumps(value, ensure_ascii=False)},\n"
    if len(line) - 1 <= 120:
        return line
    return f"  {json.dumps(key, ensure_ascii=False)}:\n    {json.dumps(value, ensure_ascii=False)},\n"


# ---------------------------------------------------------------- 登录方式：邮箱 + 登录口令（不发邮件）
def login_password() -> None:
    """服务器设置 HX_LOGIN_PASSWORD 时，第二步输入登录口令代替邮件验证码（见 apps/auth-api/src/server/hx-login.ts）。"""
    auth = "apps/auth-api/src/server/auth-service.ts"
    replace(auth, 'import type { AuthStoreError } from "./d1-auth-repository";\n',
            'import type { AuthStoreError } from "./d1-auth-repository";\nimport { HX_PASSWORD_MESSAGES, type HxAccountSignIn, hxLoginPasswordHash } from "./hx-login";\n')
    replace(
        auth,
        "  /** True when the email's domain signs in at its company provider, which then replaces email codes. */\n",
        "  /**\n"
        "   * HXBot: the shared sign-in password of the versions before accounts (`HX_LOGIN_PASSWORD`). Without\n"
        "   * `accounts`, the second sign-in step takes it in place of an emailed code; with them it signs nobody in.\n"
        "   */\n"
        "  loginPassword?: string | null;\n"
        "  /** HXBot: accounts with a password of their own (hx-accounts). With them, the shared password signs nobody in. */\n"
        "  accounts?: HxAccountSignIn | null;\n"
        "  /** True when the email's domain signs in at its company provider, which then replaces email codes. */\n",
    )
    replace(auth, "  developmentCode?: string;\n}",
            "  developmentCode?: string;\n"
            '  /** HXBot: "password" when the second step takes a password in place of an emailed code. */\n'
            '  credential?: "password";\n}')
    replace(auth, "    attribution: AccountAttribution | null;\n",
            "    attribution: AccountAttribution | null;\n    loginPassword: string | null;\n    accounts: HxAccountSignIn | null;\n")
    replace(
        auth,
        "    this.#configured = options.delivery !== null || (options.exposeDevelopmentCode ?? false);\n",
        "    const accounts = options.accounts ?? null;\n"
        "    // HXBot: with accounts, the second sign-in step takes a password, as it did with the shared one.\n"
        '    const loginPassword = accounts ? "" : (options.loginPassword ?? null);\n'
        "    this.#configured = options.delivery !== null || (options.exposeDevelopmentCode ?? false) || loginPassword !== null;\n",
    )
    replace(auth, "      attribution: options.attribution ?? null,\n",
            "      attribution: options.attribution ?? null,\n      loginPassword,\n      accounts,\n")
    replace(
        auth,
        "      const latestChallenge = yield* dependencies.repository.latestEmailChallengeAt(email);\n",
        "      const passwordMode = dependencies.loginPassword !== null;\n"
        "      // HXBot: a password sign-in sends nothing, so entering the email again need not wait.\n"
        "      const latestChallenge = passwordMode ? null : yield* dependencies.repository.latestEmailChallengeAt(email);\n",
    )
    replace(
        auth,
        "      const codeHash = yield* sha256(normalizeOneTimeCode(code));\n",
        "      const codeHash =\n"
        "        dependencies.accounts !== null\n"
        "          ? yield* dependencies.accounts.startHash(email)\n"
        "          : dependencies.loginPassword !== null\n"
        "            ? yield* hxLoginPasswordHash(dependencies.loginPassword)\n"
        "            : yield* sha256(normalizeOneTimeCode(code));\n",
    )
    replace(auth, "      const delivery = dependencies.delivery;\n",
            "      const delivery = passwordMode ? null : dependencies.delivery;\n")
    replace(
        auth,
        "      return {\n        challengeId,\n        expiresAt,\n        resendAt: now + RESEND_COOLDOWN_MS,",
        '      if (passwordMode) return { challengeId, expiresAt, resendAt: now, credential: "password" };\n'
        "      return {\n        challengeId,\n        expiresAt,\n        resendAt: now + RESEND_COOLDOWN_MS,",
    )
    replace(
        auth,
        "    return {\n      challengeId,\n      expiresAt: challenge.expiresAt,\n",
        "    if (dependencies.loginPassword !== null) {\n"
        '      return { challengeId, expiresAt: challenge.expiresAt, resendAt: challenge.createdAt, credential: "password" };\n'
        "    }\n"
        "    return {\n      challengeId,\n      expiresAt: challenge.expiresAt,\n",
    )
    replace(
        auth,
        "    const normalizedCode = yield* authValidate(() => safeNormalizeCode(input.code));\n"
        "    const codeHash = yield* sha256(normalizedCode);\n",
        "    const passwordMode = dependencies.loginPassword !== null;\n"
        "    const codeHash =\n"
        "      dependencies.accounts !== null\n"
        "        ? yield* dependencies.accounts.verifyHash(idHash, input.code)\n"
        "        : passwordMode\n"
        "          ? yield* hxLoginPasswordHash(input.code)\n"
        "          : yield* sha256(yield* authValidate(() => safeNormalizeCode(input.code)));\n",
    )
    replace(auth, "    const session = yield* authValidate(() => verificationResult(result));\n",
            "    const session = yield* authValidate(() => verificationResult(result, passwordMode));\n")
    replace(
        auth,
        "function verificationResult(result: EmailVerificationResult): {\n"
        "  sessionToken: string;\n  user: AuthUser;\n} {\n"
        '  if (result.status === "verified") return result.session;\n'
        '  if (result.status === "too_many_attempts") {\n'
        '    throw new AuthServiceError(429, "too_many_code_attempts", "Too many incorrect codes. Request a new code.");\n'
        "  }\n"
        '  if (result.status === "expired") {\n'
        '    throw new AuthServiceError(401, "sign_in_code_expired", "The sign-in code expired.");\n'
        "  }\n"
        '  throw new AuthServiceError(401, "invalid_sign_in_code", "The sign-in code is incorrect.");\n'
        "}\n",
        "function verificationResult(\n  result: EmailVerificationResult,\n  password = false,\n): {\n"
        "  sessionToken: string;\n  user: AuthUser;\n} {\n"
        '  if (result.status === "verified") return result.session;\n'
        '  if (result.status === "too_many_attempts") {\n'
        "    throw new AuthServiceError(\n      429,\n      \"too_many_code_attempts\",\n"
        '      password ? HX_PASSWORD_MESSAGES.tooManyAttempts : "Too many incorrect codes. Request a new code.",\n'
        "    );\n"
        "  }\n"
        '  if (result.status === "expired") {\n'
        "    throw new AuthServiceError(\n      401,\n      \"sign_in_code_expired\",\n"
        '      password ? HX_PASSWORD_MESSAGES.expired : "The sign-in code expired.",\n'
        "    );\n"
        "  }\n"
        "  throw new AuthServiceError(\n    401,\n    \"invalid_sign_in_code\",\n"
        '    password ? HX_PASSWORD_MESSAGES.incorrect : "The sign-in code is incorrect.",\n'
        "  );\n"
        "}\n",
    )

    ra = "apps/auth-api/src/server/request-auth.ts"
    replace(ra, 'import { hxEmailAllowed } from "./hx-access";\n',
            'import { hxEmailAllowed } from "./hx-access";\n'
            'import { hxAccountSignIn, requestHxAccounts } from "./hx-accounts";\n'
            'import { hxLoginPassword } from "./hx-login";\n')
    replace(
        ra,
        "  const analytics = accountAnalytics(bindings);\n  return new AuthService({\n"
        "    repository: new D1AuthRepository(bindings.DB),\n"
        "    delivery: exposeDevelopmentCode ? null : createEmailCodeDelivery(bindings, analytics),\n"
        "    exposeDevelopmentCode,\n",
        "  const analytics = accountAnalytics(bindings);\n"
        "  // HXBot: the second sign-in step takes the account's password (hx-accounts), so no sign-in code is emailed.\n"
        "  const loginPassword = hxLoginPassword(bindings.HX_LOGIN_PASSWORD);\n"
        "  return new AuthService({\n"
        "    repository: new D1AuthRepository(bindings.DB),\n"
        "    delivery: exposeDevelopmentCode || loginPassword ? null : createEmailCodeDelivery(bindings, analytics),\n"
        "    exposeDevelopmentCode,\n"
        "    loginPassword,\n"
        "    accounts: hxAccountSignIn(bindings, analytics),\n",
    )
    replace("apps/auth-api/src/server/types.ts", "  AUTH_EXPOSE_DEVELOPMENT_CODE?: string;\n",
            "  AUTH_EXPOSE_DEVELOPMENT_CODE?: string;\n"
            "  /** HXBot: the shared sign-in password of earlier versions. Only an earlier user proves themself with it. */\n"
            "  HX_LOGIN_PASSWORD?: string;\n"
            "  /** HXBot: who may sign in (hx-access.ts). Both empty: anyone. */\n"
            "  HX_ALLOWED_EMAILS?: string;\n"
            "  HX_ALLOWED_EMAIL_DOMAINS?: string;\n"
            "  /** HXBot: the Apple team ID of the iOS app that opens the invitation links of this site. */\n"
            "  HX_APPLE_TEAM_ID?: string;\n")

    # ---- 登录界面（桌面端、网页版共用 AccountLogin）：第二步改为输入登录口令
    zh_text = {
        "hxSignInDescription": f"用 HXBot 账号的邮箱和密码登录。还没有账号？请打开 {D['site']} 创建。",
        "hxContinue": "下一步",
        "hxContinuing": "请稍候…",
        "hxContinueFailed": "出错了，请重试。",
        "hxPasswordTitle": "输入密码",
        "hxPasswordFor": "登录账号：{email}",
        "hxPasswordLabel": "密码",
        "hxPasswordHint": f"忘记密码？打开 {D['site']}，在登录框下面点“忘记了密码？”。",
        "hxPasswordRequired": "请输入密码。",
        "hxPasswordIncorrect": "邮箱或密码不正确。",
        "hxPasswordTooMany": "密码输错次数太多，请点“重新开始”。",
        "hxPasswordExpired": "停留时间过长，请点“重新开始”。",
        "hxPasswordAccepted": "密码正确。",
        "hxForgotPassword": "忘记了密码？",
        "hxCreateAccount": "创建账号",
        "hxSignIn": "登录",
        "hxVerifyFailed": "登录时出错，请重试。",
        "hxStartAgain": "重新开始",
        "hxStartAgainIn": "{time} 后可重新开始",
        "hxStartingAgain": "请稍候…",
    }
    en_text = {
        "hxSignInDescription": f"Sign in with the email and password of your HXBot Account. No account yet? Create one at {D['site']}/en.",
        "hxContinue": "Continue",
        "hxContinuing": "One moment…",
        "hxContinueFailed": "Something went wrong. Try again.",
        "hxPasswordTitle": "Enter your password",
        "hxPasswordFor": "Signing in as {email}.",
        "hxPasswordLabel": "Password",
        "hxPasswordHint": f"Forgot your password? Open {D['site']}/en and choose Forgot password? under the sign-in form.",
        "hxPasswordRequired": "Enter your password.",
        "hxPasswordIncorrect": "The email or the password is incorrect.",
        "hxPasswordTooMany": "Too many incorrect passwords. Choose Start again.",
        "hxPasswordExpired": "This step timed out. Choose Start again.",
        "hxPasswordAccepted": "Password accepted.",
        "hxForgotPassword": "Forgot password?",
        "hxCreateAccount": "Create account",
        "hxSignIn": "Sign in",
        "hxVerifyFailed": "Sign-in failed. Try again.",
        "hxStartAgain": "Start again",
        "hxStartAgainIn": "Start again in {time}",
        "hxStartingAgain": "One moment…",
    }
    for language, table, anchor in (
        ("en", en_text, '  "account.login.loadFailed": "OpenBot could not load the account service.",\n'),
        ("zh", zh_text, '  "account.login.loadFailed": "OpenBot 无法加载账号服务。",\n'),
    ):
        path = f"packages/i18n/src/messages/{language}/account.ts"
        lines = "".join(message_line("account.login." + key, value) for key, value in table.items())
        text = read(path)
        branded = BRAND_WORD.sub(NAME, anchor)
        use = branded if branded in text else anchor
        replace(path, use, use + lines)

    login = "packages/ui/src/features/account/AccountLogin.tsx"
    replace(login, 'import { ArrowLeft, Button, ErrorReference, Globe2, Input, Lock, RefreshCw } from "@openbot/ui";',
            'import { ArrowLeft, Button, ErrorReference, Globe2, Input, Lock } from "@openbot/ui";')
    replace(login, 'import { normalizeEmailAddress, normalizeOneTimeCode } from "@openbot/contracts/validation";',
            'import { normalizeEmailAddress } from "@openbot/contracts/validation";')
    replace(login, 'import { OtpInput, type OtpInputStatus } from "./OtpInput";',
            'import { HxPasswordInput } from "./HxPasswordInput";\nimport type { OtpInputStatus } from "./OtpInput";')
    replace(
        login,
        "    const normalizedCode = normalizeOneTimeCode(value);\n"
        "    if (!normalizedCode) {\n"
        '      setCodeError(t("account.login.codeIncomplete"));\n',
        "    // HXBot: the second step takes the account's password, sent as typed.\n"
        "    const normalizedCode = value.trim();\n"
        "    if (!normalizedCode) {\n"
        '      setCodeError(t("account.login.hxPasswordRequired"));\n',
    )
    replace(login, "      await props.onVerifyEmailCode(props.state.challengeId, formatCode(normalizedCode));",
            "      await props.onVerifyEmailCode(props.state.challengeId, normalizedCode);")
    replace(
        login,
        "function formatCode(value: string): string {\n"
        '  const compact = normalizeOneTimeCode(value) ?? value.replaceAll("-", "");\n'
        "  return compact.length > 4 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;\n"
        "}\n\n",
        "",
    )
    replace(
        login,
        '    if (visibleIssue?.code === "invalid_sign_in_code") return sourceText(visibleIssue.message);\n'
        "    return issue && NEW_CODE_ISSUES.has(issue.code) ? sourceText(issue.message) : null;\n",
        '    if (visibleIssue?.code === "invalid_sign_in_code") return t("account.login.hxPasswordIncorrect");\n'
        '    if (issue?.code === "too_many_code_attempts") return t("account.login.hxPasswordTooMany");\n'
        '    return issue && NEW_CODE_ISSUES.has(issue.code) ? t("account.login.hxPasswordExpired") : null;\n',
    )
    replace(
        login,
        "                <OtpInput\n"
        "                  value={code()}\n"
        "                  status={otpStatus()}\n"
        '                  hint={t("account.login.codeHint")}\n'
        "                  errorMessage={displayedCodeError()}\n"
        '                  successMessage={t("account.login.verified")}\n'
        "                  disabled={codeNeedsReplacement() || resendBusy()}\n"
        "                  autofocus\n"
        "                  onChange={handleCodeInput}\n"
        "                  onComplete={(value) => void submitCode(value)}\n"
        "                />\n",
        "                <HxPasswordInput\n"
        "                  value={code()}\n"
        "                  status={otpStatus()}\n"
        "                  errorMessage={displayedCodeError()}\n"
        "                  disabled={codeNeedsReplacement() || resendBusy()}\n"
        "                  autofocus\n"
        "                  onChange={handleCodeInput}\n"
        "                  onSubmit={(value) => void submitCode(value)}\n"
        "                />\n",
    )
    replace(
        login,
        "                    <Show when={!codeNeedsReplacement()}>\n"
        "                      <Button\n"
        '                        type="button"\n'
        '                        class="account-login-code-action account-login-code-action-resend"\n'
        '                        variant="ghost"\n'
        '                        size="sm"\n'
        "                        disabled={pendingAction() !== null || resendAvailableIn() > 0}\n"
        "                        loading={resendBusy()}\n"
        '                        loadingLabel={t("common.sending")}\n'
        "                        onClick={() => void resendCode()}\n"
        "                      >\n"
        '                        <RefreshCw size={14} aria-hidden="true" />\n'
        "                        {resendAvailableIn() > 0\n"
        '                          ? t("account.login.resendIn", { time: formatTimer(resendAvailableIn()) })\n'
        '                          : t("account.login.resend")}\n'
        "                      </Button>\n"
        "                    </Show>\n",
        "",
    )
    for old, new in (
        ("sendCode", "hxContinue"),
        ("sendingCode", "hxContinuing"),
        ("sendFailed", "hxContinueFailed"),
        ("verifyFailed", "hxVerifyFailed"),
        ("resendFailed", "hxContinueFailed"),
        ("checkInboxTitle", "hxPasswordTitle"),
        ("signInDescription", "hxSignInDescription"),
        ("codeAccepted", "hxPasswordAccepted"),
        ("sendNewCode", "hxStartAgain"),
        ("sendingNewCode", "hxStartingAgain"),
    ):
        replace(login, f't("account.login.{old}")', f't("account.login.{new}")')
    replace(login, 't("account.login.codeSent", { email: EMAIL_MARKER })', 't("account.login.hxPasswordFor", { email: EMAIL_MARKER })')
    replace(login, 't("account.login.sendNewCodeIn", {', 't("account.login.hxStartAgainIn", {')

    # ---- 手机端（Expo）：邮箱登录的第二步改为输入登录口令（扫码登录不变）
    mobile_zh = {
        "hxDescription": f"输入 HXBot 账号的邮箱，下一步输入密码。还没有账号？可以在 {D['site']} 创建。",
        "hxContinue": "下一步",
        "hxContinuing": "请稍候…",
        "hxContinueFailed": "出错了，请重试。",
        "hxPasswordTitle": "输入密码",
        "hxPasswordFor": "登录账号：{email}",
        "hxPasswordLabel": "密码",
        "hxPasswordIncorrect": "邮箱或密码不正确。",
        "hxPasswordTooMany": "密码输错次数太多，请点“重新开始”。",
        "hxPasswordExpired": "停留时间过长，请点“重新开始”。",
        "hxVerifyFailed": "登录时出错，请重试。",
        "hxSignIn": "登录",
        "hxStartAgain": "重新开始",
        "hxStartingAgain": "请稍候…",
        "hxReady": f"请输入密码。忘记密码可以在 {D['site']} 找回。",
        "hxForgotPassword": "忘记了密码？",
        "hxCreateAccount": "创建账号",
    }
    mobile_en = {
        "hxDescription": f"Enter the email of your HXBot Account, then your password. No account yet? Create one at {D['site']}/en.",
        "hxContinue": "Continue",
        "hxContinuing": "One moment…",
        "hxContinueFailed": "Something went wrong. Try again.",
        "hxPasswordTitle": "Enter your password",
        "hxPasswordFor": "Signing in as {email}.",
        "hxPasswordLabel": "Password",
        "hxPasswordIncorrect": "The email or the password is incorrect.",
        "hxPasswordTooMany": "Too many incorrect passwords. Choose Start again.",
        "hxPasswordExpired": "This step timed out. Choose Start again.",
        "hxVerifyFailed": "Sign-in failed. Try again.",
        "hxSignIn": "Sign in",
        "hxStartAgain": "Start again",
        "hxStartingAgain": "One moment…",
        "hxReady": f"Enter your password. Forgot it? Reset it at {D['site']}/en.",
        "hxForgotPassword": "Forgot password?",
        "hxCreateAccount": "Create account",
    }
    for language, table, anchor in (
        ("en", mobile_en, '  "mobile.auth.email.useQrCode": "Scan a QR code instead",\n'),
        ("zh", mobile_zh, '  "mobile.auth.email.useQrCode": "改用扫描二维码",\n'),
    ):
        lines = "".join(message_line("mobile.auth.email." + key, value) for key, value in table.items())
        replace(f"packages/i18n/src/messages/{language}/mobile/auth.ts", anchor, anchor + lines)

    panes = "apps/mobile/src/features/auth/components/sign-in-panes.tsx"
    replace(panes, 'import { ONE_TIME_CODE_LENGTH } from "@openbot/contracts/validation";\n', "")
    replace(panes, 'import { EmailCodeInput, type EmailCodeInputHandle } from "@/features/auth/components/email-code-input";\n',
            'import type { EmailCodeInputHandle } from "@/features/auth/components/email-code-input";\n')
    replace(panes, 'import { EmailField } from "@/features/auth/components/email-field";\n',
            'import { EmailField } from "@/features/auth/components/email-field";\nimport { HxPasswordField } from "@/features/auth/components/hx-password-field";\n'
            'import { HxPortalLink } from "@/features/auth/components/hx-portal-link";\n')
    # 忘记密码、创建账号：在浏览器里打开门户的对应页面（中文界面开中文页，其他语言开英文页 /en/）
    replace(
        panes,
        "        <TextAction\n"
        '          label={t("mobile.auth.email.changeEmail")}\n'
        "          onPress={signIn.back}\n"
        "          disabled={busy}\n"
        "          reduced={reduced}\n"
        "        />\n"
        "      </PaneItem>\n"
        "    </View>\n",
        "        <TextAction\n"
        '          label={t("mobile.auth.email.changeEmail")}\n'
        "          onPress={signIn.back}\n"
        "          disabled={busy}\n"
        "          reduced={reduced}\n"
        "        />\n"
        "      </PaneItem>\n"
        '      <PaneItem index={4} motion={motion} className="flex-row">\n'
        '        <HxPortalLink page="reset" label={t("mobile.auth.email.hxForgotPassword")} />\n'
        "      </PaneItem>\n"
        "    </View>\n",
    )
    replace(
        panes,
        '      <PaneItem index={4} motion={motion} className="mt-1.5 flex-row">\n'
        "        <TextAction\n"
        '          label={t("mobile.auth.email.useQrCode")}\n'
        "          onPress={onScanInstead}\n"
        "          disabled={sending}\n"
        "          reduced={reduced}\n"
        "        />\n"
        "      </PaneItem>\n",
        '      <PaneItem index={4} motion={motion} className="mt-1.5 flex-row justify-between">\n'
        "        <TextAction\n"
        '          label={t("mobile.auth.email.useQrCode")}\n'
        "          onPress={onScanInstead}\n"
        "          disabled={sending}\n"
        "          reduced={reduced}\n"
        "        />\n"
        '        <HxPortalLink page="register" label={t("mobile.auth.email.hxCreateAccount")} />\n'
        "      </PaneItem>\n",
    )
    replace(
        panes,
        "  const canRetry = Boolean(\n"
        "    signIn.codeIssue && !signIn.codeRejected && !needsNewCode && signIn.code.length === ONE_TIME_CODE_LENGTH,\n"
        "  );\n",
        "  const canRetry = Boolean(signIn.codeIssue && !signIn.codeRejected && !needsNewCode && signIn.code.trim().length > 0);\n",
    )
    replace(
        panes,
        "        <EmailCodeInput\n"
        "          ref={codeInput}\n"
        "          value={signIn.code}\n"
        "          onChange={signIn.setCode}\n"
        "          onComplete={signIn.verify}\n"
        "          status={\n"
        '            signIn.verified ? "verified" : signIn.verifying ? "verifying" : signIn.codeRejected ? "invalid" : "idle"\n'
        "          }\n"
        "          rejection={signIn.rejection}\n"
        "          disabled={needsNewCode || signIn.verified}\n"
        '          accessibilityLabel={t("mobile.auth.email.codeLabel")}\n'
        "          motion={slotMotion}\n"
        "          reduced={reduced}\n"
        "        />\n"
        "        <PaneMessage message={message} spinner={signIn.verifying} reduced={reduced} />\n"
        "      </View>\n",
        "        <HxPasswordField\n"
        "          ref={codeInput}\n"
        "          value={signIn.code}\n"
        "          onChangeText={signIn.setCode}\n"
        "          onSubmit={() => signIn.code.trim() && signIn.verify(signIn.code)}\n"
        '          placeholder={t("mobile.auth.email.hxPasswordLabel")}\n'
        '          label={t("mobile.auth.email.hxPasswordLabel")}\n'
        "          invalid={signIn.codeRejected}\n"
        "          rejection={signIn.rejection}\n"
        "          editable={!(needsNewCode || signIn.verified || signIn.verifying)}\n"
        "          reduced={reduced}\n"
        "        />\n"
        "        <PaneMessage message={message} spinner={signIn.verifying} reduced={reduced} />\n"
        "      </View>\n"
        '      <PaneItem index={2} motion={motion} className="mt-2">\n'
        "        <SignInButton\n"
        "          brand\n"
        '          label={t("mobile.auth.email.hxSignIn")}\n'
        '          labelKey="hx-sign-in"\n'
        "          onPress={() => signIn.verify(signIn.code)}\n"
        "          busy={signIn.verifying}\n"
        "          waiting={needsNewCode || signIn.verified || !signIn.code.trim()}\n"
        "          reduced={reduced}\n"
        "        />\n"
        "      </PaneItem>\n",
    )
    # 只有需要重试或重新开始时才显示左侧的文字按钮（口令登录没有“重新发送”）
    replace(
        panes,
        '      <PaneItem index={3} motion={motion} className="mt-1.5 flex-row justify-between">\n'
        "        <TextAction\n"
        "          label={resend.label}\n"
        "          labelKey={resend.key}\n"
        "          onPress={resend.onPress}\n"
        "          disabled={resend.waiting}\n"
        "          reduced={reduced}\n"
        "        />\n",
        '      <PaneItem index={3} motion={motion} className="mt-1.5 flex-row justify-between">\n'
        "        {canRetry || needsNewCode ? (\n"
        "          <TextAction\n"
        "            label={resend.label}\n"
        "            labelKey={resend.key}\n"
        "            onPress={resend.onPress}\n"
        "            disabled={resend.waiting}\n"
        "            reduced={reduced}\n"
        "          />\n"
        "        ) : (\n"
        "          <View />\n"
        "        )}\n",
    )
    # 8 格输入的入场动画不再需要
    replace(
        panes,
        "  // The slots rise in after the text above them.\n"
        "  const slotMotion = (() => {\n"
        "    const base = signInMotion(reduced);\n"
        "    const start = motion.startMs + 2 * PANE_STAGGER_MS;\n"
        "    return { ...base, enter: (delay = 0) => base.enter(reduced ? delay : start + delay) };\n"
        "  })();\n",
        "",
    )
    replace(panes, "import {\n  PANE_STAGGER_MS,\n  type PaneDirection,", "import {\n  type PaneDirection,")
    for old, new in (
        ("description", "hxDescription"),
        ("send", "hxContinue"),
        ("sending", "hxContinuing"),
        ("codeTitle", "hxPasswordTitle"),
        ("sendNewCode", "hxStartAgain"),
        ("resending", "hxStartingAgain"),
    ):
        replace(panes, f't("mobile.auth.email.{old}")', f't("mobile.auth.email.{new}")')
    replace(panes, 't("mobile.auth.email.codeSent", {', 't("mobile.auth.email.hxPasswordFor", {')

    api = "apps/mobile/src/features/auth/api/mobile-auth.ts"
    replace(api, 'import { normalizeEmailAddress, normalizeOneTimeCode, validateProfileName } from "@openbot/contracts/validation";',
            'import { normalizeEmailAddress, validateProfileName } from "@openbot/contracts/validation";')
    replace(api, "    const normalized = normalizeOneTimeCode(code);\n",
            "    // HXBot: the second step takes the account's password, sent as typed.\n"
            "    const normalized = code.trim();\n")
    for old, new, count in (
        ("error.codeIncorrect", "hxPasswordIncorrect", 2),
        ("error.codeExpired", "hxPasswordExpired", 1),
        ("error.tooManyAttempts", "hxPasswordTooMany", 1),
        ("error.sendFailed", "hxContinueFailed", 2),
        ("error.verifyFailed", "hxVerifyFailed", 1),
    ):
        replace(api, f'"mobile.auth.email.{old}"', f'"mobile.auth.email.{new}"', count=count)
    model = "apps/mobile/src/features/auth/model/use-email-sign-in.ts"
    for old, new in (("error.sendFailed", "hxContinueFailed"), ("error.verifyFailed", "hxVerifyFailed"), ("codeResent", "hxReady")):
        replace(model, f'"mobile.auth.email.{old}"', f'"mobile.auth.email.{new}"')

    # ---- 邀请链接的示例地址：改为弘犀下载页（原为上游站点），网页版“连接服务器”第 2 步写明用口令登录
    replace("packages/ui/src/features/servers/JoinServerDialog.tsx",
            'const INVITE_URL_PLACEHOLDER = "https://openbot.run/join?…";',
            f'const INVITE_URL_PLACEHOLDER = "{SITE}/join?…";')
    for path in sorted((ROOT / "packages/i18n/src/messages").glob("*/onboarding.ts")):
        rel = path.relative_to(ROOT).as_posix()
        if "https://openbot.run/join" in read(rel):
            replace(rel, "https://openbot.run/join", f"{SITE}/join")
    replace("packages/i18n/src/messages/zh/webClient.ts", '"webClient.connect.stepSignIn": "用邮箱登录。",',
            '"webClient.connect.stepSignIn": "用邮箱和密码登录。",')
    replace("packages/i18n/src/messages/en/webClient.ts", '"webClient.connect.stepSignIn": "Sign in with your email.",',
            '"webClient.connect.stepSignIn": "Sign in with your email and password.",')
    # ---- “加入服务器”对话框写明邀请链接从哪里来（所有者在桌面端创建）。邮件邀请要发信，研究版没有配置发信，所以只提链接。
    replace("packages/i18n/src/messages/zh/server.ts", '"server.join.description": "粘贴服务器所有者发给你的邀请。",',
            '"server.join.description":\n    "粘贴服务器所有者发给你的邀请链接。所有者在桌面端打开“服务器设置 → 成员”，发布服务器后点“邀请成员”，选“邀请链接”即可创建。",')
    replace("packages/i18n/src/messages/en/server.ts", '"server.join.description": "Paste the invitation you received from a server owner.",',
            '"server.join.description":\n    "Paste the invite link from the server owner. The owner creates it in the desktop app: Server settings → Members, publish the server, then Invite people → Invite link.",')


# ---------------------------------------------------------------- Mac 不再弹“钥匙串”密码框
def keychain() -> None:
    """Mac 上不碰登录钥匙串里的“HXBot Safe Storage”。

    研究版没有苹果开发者签名，macOS 每次启动（或每次更新）都把 HXBot 当成另一个程序，弹框要钥匙串密码。
    两处会读这个钥匙串项：HXBot 自己保存的密钥（safeStorage）和网页 Cookie 的加密（Chromium）。
    改法：密钥一律用 userData 里只有本账户能读的钥匙文件加密（原来只有 Linux 钥匙环失效时才用）；
    Cookie 用 Chromium 的 use-mock-keychain 开关（写在 src/main/hx-defaults.ts，主进程第一个加载）。
    旧版本用钥匙串加密的值不再读取（读取就会弹框），按“已丢失”处理：升级后重新登录一次。
    """
    path = "src/main/secret-storage-cipher.ts"
    replace(path,
            "// that works keeps the secrets. macOS and Windows always use `safeStorage`.\n",
            "// that works keeps the secrets. Windows always uses `safeStorage`.\n"
            "// HXBot: macOS always uses the key file, so the login Keychain never asks for its password. An app\n"
            "// without an Apple Developer ID signature is asked again at each start or update (see hx-defaults.ts).\n")
    replace(path,
            '  const linux = (options.platform ?? process.platform) === "linux";\n',
            '  const linux = (options.platform ?? process.platform) === "linux";\n'
            "  // HXBot: on macOS the key file keeps every secret and `safeStorage` is never called.\n"
            '  const mac = (options.platform ?? process.platform) === "darwin";\n')
    replace(path,
            '  function createKey(reason: "unavailable" | "decrypt"): Buffer {\n',
            '  function createKey(reason: "unavailable" | "decrypt" | "keychain"): Buffer {\n')
    replace(path,
            "    madeKeyFile = true;\n"
            "    // The backend name only: it tells a locked keyring from a missing one in a report.\n",
            "    madeKeyFile = true;\n"
            "    if (mac) {\n"
            '      logger.info("HXBot keeps its secrets in its own key file instead of the macOS Keychain.", { reason });\n'
            "      return created;\n"
            "    }\n"
            "    // The backend name only: it tells a locked keyring from a missing one in a report.\n")
    replace(path,
            "  function keyForWrite(): Buffer | null {\n    if (!linux) return null;\n",
            "  function keyForWrite(): Buffer | null {\n"
            '    if (mac) return readKey() ?? createKey("keychain");\n'
            "    if (!linux) return null;\n")
    replace(path,
            "    if (linux && value.subarray(0, KEY_FILE_FORMAT.length).equals(KEY_FILE_FORMAT)) {\n",
            "    if ((linux || mac) && value.subarray(0, KEY_FILE_FORMAT.length).equals(KEY_FILE_FORMAT)) {\n")
    replace(path,
            "    try {\n      return safeStorage.decryptString(value);\n",
            "    // HXBot: a value from an earlier version is sealed with the Keychain key. Reading it would ask for\n"
            "    // the Keychain password, so it reads as lost and the next save replaces it.\n"
            '    if (mac) throw new Error("A secret sealed with the macOS Keychain is not read.");\n'
            "    try {\n      return safeStorage.decryptString(value);\n")


# ---------------------------------------------------------------- 加载画面：堆满屏幕的长颈鹿（桌面端、网页版）
def giraffe_pile() -> None:
    """登录、打开应用时满屏落下并堆起来的角色：动画代码与原版一样，只把图片换成 HXBot 已设计的角色。

    原版的六个毛绒角色，换成六种颜色的长颈鹿（packages/ui/.../HxCrewPicture.tsx，图形和配色与智能体头像同一套，
    不带圆形底色）。CrewPileStage.tsx 只改一行引入；crew-pile.ts 只改“从图片量出的身体大小”这张表：用来堆叠的
    圆形身体占方框的 0.62、圆心在正中，与原版毛绒身体的平均大小一致，所以堆满屏幕的数量和疏密与原版一样；
    长颈鹿的脚踩在这个圆的底边上，脖子和头伸出圆外一点。
    """
    pile = "packages/ui/src/features/account/crew-pile.ts"
    replace(pile,
            "/** The felt body of each character inside its box, measured from the images. */\n"
            "const CHARACTERS = [\n"
            '  { character: "yoshi", cy: 0.499, w: 0.647, h: 0.401 },\n'
            '  { character: "nexo", cy: 0.501, w: 0.612, h: 0.608 },\n'
            '  { character: "malu", cy: 0.5, w: 0.626, h: 0.622 },\n'
            '  { character: "fred", cy: 0.499, w: 0.625, h: 0.596 },\n'
            '  { character: "vita", cy: 0.502, w: 0.632, h: 0.595 },\n'
            '  { character: "cloe", cy: 0.448, w: 0.603, h: 0.565 },\n'
            "] as const satisfies readonly { character: PlushCharacterId; cy: number; w: number; h: number }[];\n",
            "/**\n"
            " * The body of each character inside its box, measured from the images. HXBot: the images\n"
            " * are the HXBot giraffe in six colours (HxCrewPicture.tsx). Each stands on the bottom of a round\n"
            " * body that fills 0.62 of the box, the mean size of the plush bodies, so the pile is as full as before.\n"
            " */\n"
            "const CHARACTERS = [\n"
            '  { character: "yoshi", cy: 0.5, w: 0.62, h: 0.62 },\n'
            '  { character: "nexo", cy: 0.5, w: 0.62, h: 0.62 },\n'
            '  { character: "malu", cy: 0.5, w: 0.62, h: 0.62 },\n'
            '  { character: "fred", cy: 0.5, w: 0.62, h: 0.62 },\n'
            '  { character: "vita", cy: 0.5, w: 0.62, h: 0.62 },\n'
            '  { character: "cloe", cy: 0.5, w: 0.62, h: 0.62 },\n'
            "] as const satisfies readonly { character: PlushCharacterId; cy: number; w: number; h: number }[];\n")

    stage = "packages/ui/src/features/account/CrewPileStage.tsx"
    # 引入语句按项目的排序规则放在本目录的引入之后（放在原位置时格式检查会要求挪动）
    replace(stage,
            'import { PLUSH_CHARACTER_BY_ID, PlushBot } from "@norbert_bodziony/bloub/plush";\n'
            'import { createEffect, createSignal, For, onSettled, untrack } from "solid-js";\n'
            'import type { CrewFace, CrewFilm, CrewMember, CrewPile } from "./crew-pile";\n',
            'import { createEffect, createSignal, For, onSettled, untrack } from "solid-js";\n'
            'import type { CrewFace, CrewFilm, CrewMember, CrewPile } from "./crew-pile";\n'
            "// HXBot: the crew are pictures of the HXBot giraffe, in place of the plush library.\n"
            'import { PLUSH_CHARACTER_BY_ID, PlushBot } from "./HxCrewPicture";\n')



# ---------------------------------------------------------------- 手机端：启动、登录、加载色块里堆满长颈鹿
def mobile_giraffe_pile() -> None:
    """手机端（安卓、iOS）启动、登录、加载和应用锁的色块上原来是上游标志的一双眼睛，换成落下并堆满的长颈鹿。

    堆的布局与绘制在 HX 自有文件 hx-giraffe-pile-layout.ts、hx-giraffe-pile.tsx。眼睛只在扫码时作为取景框出现。
    色块上的文字加一层浅色底，压在长颈鹿上也看得清。
    """
    stage = "apps/mobile/src/shared/components/bloub-stage/bloub-stage.tsx"
    replace(stage,
            'import type { BloubMood, BloubStageRequest } from "./bloub-stage-store";\n',
            'import type { BloubMood, BloubStageRequest } from "./bloub-stage-store";\n'
            'import { HxGiraffePile } from "./hx-giraffe-pile";\n')
    replace(stage,
            "        style={{ top: height * 0.585, left: insets.left + 24, right: insets.right + 24 }}\n",
            "        style={[{ top: height * 0.585, left: insets.left + 24, right: insets.right + 24 }, styles.hxCaption]}\n")
    replace(stage,
            "      style={{ bottom: insets.bottom + STATUS_GAP, left: insets.left + 24, right: insets.right + 24 }}\n",
            "      style={[\n"
            "        { bottom: insets.bottom + STATUS_GAP, left: insets.left + 24, right: insets.right + 24 },\n"
            "        styles.hxCaption,\n"
            "      ]}\n")
    replace(stage,
            '  const mood: BloubMood = request?.mood ?? "idle";\n',
            '  const mood: BloubMood = request?.mood ?? "idle";\n'
            "  // HXBot: the eyes show only as the frame of the code scanner; the giraffes are the face.\n"
            '  const scanner = mood === "frame" || mood === "found";\n')
    replace(stage,
            "              </Animated.View>\n"
            "            ) : null}\n"
            "          </View>\n"
            "        </Animated.View>\n",
            "              </Animated.View>\n"
            "            ) : null}\n"
            "            {/* HXBot: the block is full of giraffes, which drop in once when the app starts. */}\n"
            "            <HxGiraffePile\n"
            "              width={size.width}\n"
            "              height={span}\n"
            "              edge={dimmed ? colors.dimBody : colors.body}\n"
            "              animate={!reduced}\n"
            "            />\n"
            "          </View>\n"
            "        </Animated.View>\n")
    replace(stage,
            "          <BloubEyes\n"
            "            mood={mood}\n"
            "            active={request !== null}\n"
            "            reduced={reduced}\n"
            "            gazeX={gazeX}\n"
            "            gazeY={gazeY}\n"
            "            eyeColor={eyeColor}\n"
            "          />\n",
            "          <View style={scanner ? styles.hxEyes : styles.hxEyesHidden}>\n"
            "            <BloubEyes\n"
            "              mood={mood}\n"
            "              active={request !== null}\n"
            "              reduced={reduced}\n"
            "              gazeX={gazeX}\n"
            "              gazeY={gazeY}\n"
            "              eyeColor={eyeColor}\n"
            "            />\n"
            "          </View>\n")
    replace(stage,
            '  eyes: { position: "absolute", top: 0, width: EYES_WIDTH, height: EYES_HEIGHT },\n});\n',
            '  eyes: { position: "absolute", top: 0, width: EYES_WIDTH, height: EYES_HEIGHT },\n'
            "  hxEyes: { position: \"absolute\", top: 0, left: 0, right: 0, bottom: 0 },\n"
            "  hxEyesHidden: { position: \"absolute\", top: 0, left: 0, right: 0, bottom: 0, opacity: 0 },\n"
            "  // A light card under the text, which sits over the giraffes.\n"
            '  hxCaption: { backgroundColor: "rgba(255,255,255,0.9)", borderRadius: 18, paddingVertical: 12, paddingHorizontal: 16 },\n'
            "});\n")

    block = "apps/mobile/src/shared/components/bloub-stage/bloub-block.tsx"
    replace(block,
            'import { BLOUB_MOVE, BLOUB_RADIUS, bloubEyesFrame, bloubGradient, useBloubColors } from "./bloub-look";\n',
            'import { BLOUB_MOVE, BLOUB_RADIUS, bloubEyesFrame, bloubGradient, useBloubColors } from "./bloub-look";\n'
            'import { HxGiraffePile } from "./hx-giraffe-pile";\n')
    replace(block,
            "            style={[styles.light, { height, experimental_backgroundImage: bloubGradient(light, body) }, lightStyle]}\n"
            "          />\n"
            "        </View>\n",
            "            style={[styles.light, { height, experimental_backgroundImage: bloubGradient(light, body) }, lightStyle]}\n"
            "          />\n"
            "          {/* HXBot: the app lock shows the pile of giraffes still. */}\n"
            "          <HxGiraffePile width={window.width} height={span} edge={body} animate={false} />\n"
            "        </View>\n")
    replace(block,
            "        <BloubEyes\n"
            '          mood="idle"\n'
            '          active={edge !== "gone"}\n'
            "          reduced={reduced}\n"
            "          gazeX={gazeX}\n"
            "          gazeY={gazeY}\n"
            "          eyeColor={colors.eye}\n"
            "        />\n",
            "        {/* HXBot: the giraffes are the face of the block; the eyes stay hidden. */}\n"
            "        <View style={styles.hxEyesHidden}>\n"
            "          <BloubEyes\n"
            '            mood="idle"\n'
            '            active={edge !== "gone"}\n'
            "            reduced={reduced}\n"
            "            gazeX={gazeX}\n"
            "            gazeY={gazeY}\n"
            "            eyeColor={colors.eye}\n"
            "          />\n"
            "        </View>\n")
    replace(block,
            '  eyes: { position: "absolute", top: 0, width: EYES_WIDTH, height: EYES_HEIGHT },\n});\n',
            '  eyes: { position: "absolute", top: 0, width: EYES_WIDTH, height: EYES_HEIGHT },\n'
            "  hxEyesHidden: { position: \"absolute\", top: 0, left: 0, right: 0, bottom: 0, opacity: 0 },\n"
            "});\n")


OTHER_LOCALES = ["ar", "de", "es", "fr", "he", "it", "ja", "ko", "nl", "pl", "pt", "ru", "tr"]
SECRET_TEXT_EN = {
    "composer.hxSecret.title": "This message looks like it contains a password or a key",
    "composer.hxSecret.body": "Do not send passwords, API keys or tokens in the chat: the AI model would read them. Save it in the Vault, then tell the agent its name. An agent that needs one shows a secure form.",
    "composer.hxSecret.openVault": "Open the Vault",
    "composer.hxSecret.sendAnyway": "Send anyway",
}
SECRET_TEXT_ZH = {
    "composer.hxSecret.title": "这条消息里好像有密码或密钥",
    "composer.hxSecret.body": "请不要在聊天里发送密码、API 密钥或令牌：AI 模型会读到它们。请把它存进保密箱，再告诉助手它的名称。助手需要时也会弹出保密表单让你填写。",
    "composer.hxSecret.openVault": "打开保密箱",
    "composer.hxSecret.sendAnyway": "仍然发送",
}
MOBILE_SECRET_TEXT_EN = {
    "mobile.chat.hxSecret.title": "Password or key in the message",
    "mobile.chat.hxSecret.body": "Do not send passwords, API keys or tokens in the chat: the AI model would read them. Save it in the Vault, then tell the agent its name.",
    "mobile.chat.hxSecret.edit": "Edit message",
    "mobile.chat.hxSecret.openVault": "Open the Vault",
    "mobile.chat.hxSecret.sendAnyway": "Send anyway",
}
MOBILE_SECRET_TEXT_ZH = {
    "mobile.chat.hxSecret.title": "消息里好像有密码或密钥",
    "mobile.chat.hxSecret.body": "请不要在聊天里发送密码、API 密钥或令牌：AI 模型会读到它们。请把它存进保密箱，再告诉助手它的名称。",
    "mobile.chat.hxSecret.edit": "返回修改",
    "mobile.chat.hxSecret.openVault": "打开保密箱",
    "mobile.chat.hxSecret.sendAnyway": "仍然发送",
}
MOBILE_VAULT_TEXT_ZH = {
    "mobile.server.route.vault": "保密箱",
    "mobile.server.settings.vault": "保密箱",
    "mobile.server.vault.description": "{host} 上的助手用这些项目登录、付款和填写表单。密码、卡号和安全码只保存在 {host} 上，这台手机看不到。",
    "mobile.server.vault.unavailable": "以所有者或管理员身份连接这台服务器，才能管理它的保密箱。",
    "mobile.server.vault.unsupported": "请更新这台服务器上的 HXBot，才能在这里管理保密箱。",
    "mobile.server.vault.loading": "正在打开保密箱…",
    "mobile.server.vault.logins": "登录信息",
    "mobile.server.vault.cards": "银行卡",
    "mobile.server.vault.contacts": "联系信息",
    "mobile.server.vault.apiKeys": "API 密钥",
    "mobile.server.vault.empty": "暂无项目",
    "mobile.server.vault.addLogin": "添加登录信息",
    "mobile.server.vault.addApiKey": "添加 API 密钥",
    "mobile.server.vault.newLogin": "新建登录信息",
    "mobile.server.vault.newCard": "新建银行卡",
    "mobile.server.vault.newApiKey": "新建 API 密钥",
    "mobile.server.vault.addConfirm": "添加",
}


def add_messages(path: str, closing: str, entries: dict) -> None:
    """在界面文字文件末尾（closing 之前）加入新的文字；已加入的跳过。"""
    text = read(path)
    removed = upstream_checks.removed_keys()  # 后来不再使用、由 hx/unused-messages.txt 删掉的文字不再加入
    missing = {
        key: value for key, value in entries.items() if key not in removed and not applied(path, f'"{key}":', text)
    }
    if not missing:
        return
    at = text.rfind(closing)
    if at < 0:
        errors.append(f"{path}: closing not found: {closing!r}")
        return
    lines = ""
    for key, value in missing.items():
        name, quoted = json.dumps(key, ensure_ascii=False), json.dumps(value, ensure_ascii=False)
        one = f"  {name}: {quoted},"
        # 与 Biome 的格式一致：显示宽度超过 120（中文算 2）时，值另起一行。
        lines += f"\n{one}" if display_width(one) <= 120 else f"\n  {name}:\n    {quoted},"
    write(path, text[:at] + lines + text[at:])


def display_width(text: str) -> int:
    import unicodedata
    return sum(2 if unicodedata.east_asian_width(char) in ("W", "F") else 1 for char in text)


def untranslated(add: dict, translated_zh: list, removed: tuple = (), translated: dict | None = None) -> None:
    """packages/i18n/untranslated.json：登记暂用英文的新文字；去掉已译成中文的 zh、已有译文的语言（hx/translations.py）
    和已删掉的文字。保持一行一个键、按键排序。"""
    import translations as hx_translations
    path = "packages/i18n/untranslated.json"
    data = json.loads(read(path))
    before = json.dumps(data, ensure_ascii=False, sort_keys=True)
    for key, locales in add.items():
        locales = [locale for locale in locales if not hx_translations.has(key, locale)]
        if locales:
            data[key] = sorted(set(data.get(key, [])) | set(locales))
    for key, locales in (translated or {}).items():
        if key in data:
            data[key] = [locale for locale in data[key] if locale not in locales]
            if not data[key]:
                del data[key]
    for key in removed:
        data.pop(key, None)
    for key in translated_zh:
        if key in data and "zh" in data[key]:
            data[key] = [locale for locale in data[key] if locale != "zh"]
            if not data[key]:
                del data[key]
    if json.dumps(data, ensure_ascii=False, sort_keys=True) == before:
        return
    # 与 Biome 的格式一致：一行不超过 120 个字符，超过的数组一个元素一行。
    items = sorted(data.items())
    out = []
    for index, (key, value) in enumerate(items):
        comma = "," if index < len(items) - 1 else ""
        name = json.dumps(key, ensure_ascii=False)
        one = f"  {name}: {json.dumps(value, ensure_ascii=False)}{comma}"
        if len(one) <= 120:
            out.append(one)
            continue
        out.append(f"  {name}: [")
        out += [f"    {json.dumps(item, ensure_ascii=False)}" + ("," if j < len(value) - 1 else "") for j, item in enumerate(value)]
        out.append("  ]" + comma)
    write(path, "{\n" + "\n".join(out) + "\n}\n")


# ---------------------------------------------------------------- 保密箱：所有密码、密钥只进保密箱，不进聊天
def secret_box() -> None:
    """“保险库”改名“保密箱”；聊天框识别密码和密钥并拦下提醒；智能体需要机密时只用保密表单。

    识别规则在 HX 自有文件 packages/contracts/src/hx-secret-detect.ts（桌面端、网页版、手机端共用）。
    """
    def export(data) -> None:
        data["exports"]["./hx-secret-detect"] = "./src/hx-secret-detect.ts"
    json_edit("packages/contracts/package.json", export)

    # ---- 界面文字：英文原文与中文；其他 13 种语言暂用英文（登记在 untranslated.json）
    add_messages("packages/i18n/src/messages/en/composer.ts", "\n});\n", SECRET_TEXT_EN)
    add_messages("packages/i18n/src/messages/zh/composer.ts", "\n} as const satisfies", SECRET_TEXT_ZH)
    add_messages("packages/i18n/src/messages/en/mobile/chat.ts", "\n});\n", MOBILE_SECRET_TEXT_EN)
    add_messages("packages/i18n/src/messages/zh/mobile/chat.ts", "\n} as const satisfies", MOBILE_SECRET_TEXT_ZH)
    add_messages("packages/i18n/src/messages/zh/mobile/server.ts", "\n} as const satisfies", MOBILE_VAULT_TEXT_ZH)
    untranslated(add={key: OTHER_LOCALES for key in [*SECRET_TEXT_EN, *MOBILE_SECRET_TEXT_EN]},
                 translated_zh=list(MOBILE_VAULT_TEXT_ZH))

    # ---- 中文界面：HXBot 自己的“保险库”改称“保密箱”（1Password、Bitwarden 等密码管理器的保险库照旧）
    for path in sorted((ROOT / "packages/i18n/src/messages/zh").rglob("*.ts")):
        rel = str(path.relative_to(ROOT))
        lines = read(rel).split("\n")
        key = None
        changed = False
        for index, line in enumerate(lines):
            match = re.match(r'\s*"([^"]+)":', line)
            if match:
                key = match.group(1)
            if "保险库" not in line or key is None:
                continue
            if re.search(r"onepassword|bitwarden|protonpass|passwordmanager", key, re.I) or key.startswith(
                    ("connector.", "error.connector.", "mobile.server.connectors.")):
                continue
            lines[index] = line.replace("保险库", "保密箱")
            changed = True
        if changed:
            write(rel, "\n".join(lines))
    vault_zh = "packages/i18n/src/messages/zh/vault.ts"
    replace(vault_zh, '"vault.unavailableDescription": "HXBot 使用系统的密钥存储来加密保密箱。请先设置钥匙串，然后重新打开该页面。",',
            '"vault.unavailableDescription":\n    "HXBot 无法加密保密箱。请重启 HXBot 后再打开该页面；仍然不行时请发邮件到 bot@hxallai.com。",')
    replace(vault_zh, '    "保密箱文件在这台电脑上，但 HXBot 无法解密。系统钥匙串发生变化时可能出现这种情况。重置保密箱后将从空白开始。",',
            '    "保密箱文件在这台电脑上，但 HXBot 无法解密。从旧版本升级后会出现一次：旧版本用 Mac 钥匙串加密，新版本不再使用钥匙串。重置保密箱后从空白开始，请把需要的项目重新存进来。",')

    # ---- 智能体：机密只走保密表单，客户在聊天里发了就替他存进保密箱
    replace("src/backend/agent/developer-instructions.ts",
            "Save a pasted key or password at once: openbot.save_api_key, or openbot_browser.save_vault_item kind=login for a website. ",
            "Save a pasted key or password at once: openbot.save_api_key, or openbot_browser.save_vault_item kind=login for a website; then tell the user it is in the Vault and that secrets go in the Vault, not the chat. For a login to a website or an app that you do not have, call openbot_browser.request_vault_item kind=login, a secure form. ")

    # ---- 桌面端、网页版：发送前拦下（hx-secret-guard.ts、HxSecretNotice.tsx）
    actions = "src/renderer/src/features/conversation/stores/composer-actions.ts"
    replace(actions, 'import { conversationOwnerId } from "./composer-store";\n',
            'import { holdSecretMessage } from "../hx-secret-guard";\nimport { conversationOwnerId } from "./composer-store";\n')
    replace(actions,
            "    if (phase !== \"idle\" || !deps.agentReady()) return;\n    void submitMessage();\n",
            "    if (phase !== \"idle\" || !deps.agentReady()) return;\n"
            "    // HXBot: a password or a key in the message waits for the user (hx-secret-guard.ts).\n"
            "    if (holdSecretMessage(deps.currentDraft().text, submitComposer)) return;\n"
            "    void submitMessage();\n")
    replace(actions,
            "    void submitMessage(undefined, undefined, undefined, undefined, !hostSteers);\n",
            "    if (holdSecretMessage(deps.currentDraft().text, steerComposer)) return;\n"
            "    void submitMessage(undefined, undefined, undefined, undefined, !hostSteers);\n")
    composer = "src/renderer/src/features/conversation/ConversationComposer.tsx"
    replace(composer, 'import { useConversationViewScope } from "./conversation-scope";\n',
            'import { useConversationViewScope } from "./conversation-scope";\nimport { HxSecretNotice } from "./HxSecretNotice";\n')
    replace(composer,
            "          <Show when={providerWaitNotice()}>\n"
            "            {(notice) => <ComposerNotice title={notice().title} body={notice().body} />}\n"
            "          </Show>\n",
            "          <Show when={providerWaitNotice()}>\n"
            "            {(notice) => <ComposerNotice title={notice().title} body={notice().body} />}\n"
            "          </Show>\n"
            "          <HxSecretNotice draftText={currentDraft().text} serverId={props.server?.id ?? \"local\"} />\n")
    workspace = "src/renderer/src/features/conversation/WorkspaceConversation.tsx"
    replace(workspace, 'import { createEffect, createMemo } from "solid-js";\n',
            'import { createEffect, createMemo, onCleanup } from "solid-js";\n')
    replace(workspace, 'import type { ConversationThreads } from "./conversation-types";\n',
            'import type { ConversationThreads } from "./conversation-types";\nimport { registerHxVaultOpener } from "./hx-secret-guard";\n')
    replace(workspace,
            "  const { serverSettingsOpen, openServerSettings, openMcpSignIn, serverSettingsTargetId, serverSettingsMcpSignIns } =\n"
            "    useServerSettings();\n",
            "  const { serverSettingsOpen, openServerSettings, openMcpSignIn, serverSettingsTargetId, serverSettingsMcpSignIns } =\n"
            "    useServerSettings();\n"
            "  // HXBot: the notice about a password in a message opens the Vault of the server.\n"
            "  onCleanup(registerHxVaultOpener((serverId, trigger) => openServerSettings(serverId, trigger, \"vault\")));\n")
    web = "src/renderer/src/features/web-client/WebWorkspace.tsx"
    replace(web, 'import { createAgentMessageDeleteAccess, readerCanDeleteMessage } from "../conversation/message-delete-access";\n',
            'import { registerHxVaultOpener } from "../conversation/hx-secret-guard";\n'
            'import { createAgentMessageDeleteAccess, readerCanDeleteMessage } from "../conversation/message-delete-access";\n')
    replace(web,
            "    setServerSettingsLoaded(true);\n    serverSettings.open(trigger);\n  }\n",
            "    setServerSettingsLoaded(true);\n    serverSettings.open(trigger);\n  }\n"
            "  // HXBot: the notice about a password in a message opens the Vault of the server.\n"
            "  onCleanup(registerHxVaultOpener((serverId, trigger) => void openServerSettings(serverId, trigger, \"vault\")));\n")

    # ---- 手机端：发送前用系统对话框提醒（hx-secret-alert.ts）
    chat = "apps/mobile/src/features/chat/components/chat-composer.tsx"
    replace(chat, 'import { createComposerSendGate } from "../model/composer-send";\n',
            'import { createComposerSendGate } from "../model/composer-send";\nimport { sendUnlessHxSecret } from "../model/hx-secret-alert";\n')
    replace(chat, "  onSend: (text: string) => void;\n",
            "  onSend: (text: string) => void;\n"
            "  /** HXBot: the server whose Vault the password notice opens. */\n"
            "  vaultServerId?: string;\n")
    replace(chat, "  onChangeDraft,\n  onSend,\n  onStop,\n", "  onChangeDraft,\n  onSend,\n  vaultServerId,\n  onStop,\n")
    replace(chat, "  function requestSend(): void {\n",
            "  // HXBot: a password or a key in the message asks first, and the draft stays when it waits.\n"
            "  function sendChecked(text: string): void {\n"
            "    sendUnlessHxSecret(text, onSend, {\n"
            "      labels: {\n"
            "        title: t(\"mobile.chat.hxSecret.title\"),\n"
            "        body: t(\"mobile.chat.hxSecret.body\"),\n"
            "        edit: t(\"mobile.chat.hxSecret.edit\"),\n"
            "        openVault: t(\"mobile.chat.hxSecret.openVault\"),\n"
            "        sendAnyway: t(\"mobile.chat.hxSecret.sendAnyway\"),\n"
            "      },\n"
            "      vaultServerId,\n"
            "      onHeld: () => sendGate.allowRetry(),\n"
            "    });\n"
            "  }\n\n"
            "  function requestSend(): void {\n")
    replace(chat, '    else if (action === "send") onSend(latestTextRef.current);\n',
            '    else if (action === "send") sendChecked(latestTextRef.current);\n')
    replace(chat, "                          onSend(editMentionDraft(latestTextRef.current, nativeEvent.text));\n",
            "                          sendChecked(editMentionDraft(latestTextRef.current, nativeEvent.text));\n")
    replace(chat, "                        if (sendGate.commit() && !disabled) onSend(latestTextRef.current);\n",
            "                        if (sendGate.commit() && !disabled) sendChecked(latestTextRef.current);\n")
    replace("apps/mobile/src/features/chat/components/chat-view.tsx",
            "                  onSend={send}\n",
            "                  onSend={send}\n                  vaultServerId={target.serverId}\n")


# ---------------------------------------------------------------- 智能体头像：30 种小动物（与长颈鹿同一画风）
def animal_avatars() -> None:
    """智能体的圆团头像换成小动物（图形：packages/brand/src/hx-animals.ts）。

    动物由头像的“形状”和“眼睛”决定（编辑器里的两组选项），颜色沿用智能体的颜色设置；上传的照片仍然优先。
    桌面端、网页版（AgentAvatar → HxAnimalAvatar.tsx）、手机端（bloub-avatar.tsx → hx-animal-avatar.tsx）同一套。
    """
    def export(data) -> None:
        data["exports"]["./hx-animals"] = "./src/hx-animals.ts"
    json_edit("packages/brand/package.json", export)

    avatar = "packages/ui/src/features/agents/AgentAvatar.tsx"
    replace(avatar, 'import { documentSoftwareRendering } from "../../document-rendering";\n',
            'import { documentSoftwareRendering } from "../../document-rendering";\nimport { HxAnimalAvatar } from "./HxAnimalAvatar";\n')
    replace(avatar,
            "      fallback={\n"
            "        <GeneratedAvatar\n"
            "          seed={seed()}\n"
            "          hue={hue()}\n"
            "          color={color()}\n"
            "          motion={motion()}\n"
            "          mood={mood()}\n"
            "          animationOffset={props.animationOffset}\n"
            "          shape={props.shape}\n"
            "          expression={props.expression}\n"
            "          transition={props.transition ?? \"pop\"}\n"
            "          followPointer={props.followPointer === true}\n"
            "          workingFaces={props.workingFaces === true}\n"
            "          activity={props.activity ?? null}\n"
            "          eyeScale={props.eyeScale}\n"
            "          class={className()}\n"
            "          style={props.style}\n"
            "        />\n"
            "      }\n",
            "      fallback={\n"
            "        // HXBot: the agent is an animal of the HXBot set (HxAnimalAvatar.tsx).\n"
            "        <HxAnimalAvatar\n"
            "          seed={seed()}\n"
            "          hue={hue()}\n"
            "          color={color()}\n"
            "          shape={props.shape}\n"
            "          expression={props.expression}\n"
            "          mood={mood()}\n"
            "          class={className()}\n"
            "          style={props.style}\n"
            "        />\n"
            "      }\n")
    # 原来的生成头像不再显示；导出它，免得成为未使用的函数。
    replace(avatar, "\nfunction GeneratedAvatar(props: {\n", "\nexport function GeneratedAvatar(props: {\n")

    mobile = "apps/mobile/src/features/agents/components/bloub-avatar.tsx"
    replace(mobile, 'import { AgentPhoto, type AgentPhotoProps } from "./agent-photo";\n',
            'import { AgentPhoto, type AgentPhotoProps } from "./agent-photo";\nimport { HxAnimalAvatar } from "./hx-animal-avatar";\n')
    replace(mobile,
            "      <PlushAvatar\n"
            "        seed={props.seed}\n"
            "        hue={props.hue}\n"
            "        color={props.color ?? null}\n"
            "        size={size}\n"
            "        mood={props.mood}\n"
            "        animateIdle={props.animateIdle}\n"
            "        disconnected={props.disconnected}\n"
            "        transition={props.transition}\n"
            "      />\n",
            "      {/* HXBot: the agent is an animal of the HXBot set (hx-animal-avatar.tsx). */}\n"
            "      <HxAnimalAvatar\n"
            "        seed={props.seed}\n"
            "        hue={props.hue}\n"
            "        color={props.color ?? null}\n"
            "        size={size}\n"
            "        disconnected={props.disconnected}\n"
            "      />\n")
    replace(mobile, "\nconst PlushAvatar = memo(function PlushAvatar({\n", "\nexport const PlushAvatar = memo(function PlushAvatar({\n")

    # 手机端的头像缩略图（聊天记录、频道、市场、选择器里的小头像）原来仍画毛绒图片，也换成动物
    replace(mobile,
            "  const drawn = size * PLUSH_BODY_SCALE;\n"
            "  return (\n"
            "    <View\n"
            "      pointerEvents=\"none\"\n"
            "      style={{ width: size, height: size, opacity: disconnected ? DISCONNECTED_APPEARANCE.opacity : 1 }}\n"
            "    >\n"
            "      <View style={{ position: \"absolute\", left: (size - drawn) / 2, top: (size - drawn) / 2 }}>\n"
            "        <PlushPicture\n"
            "          seed={seed}\n"
            "          hue={hue}\n"
            "          color={color}\n"
            "          mood=\"idle\"\n"
            "          size={drawn}\n"
            "          pixels={plushPixels(drawn, PixelRatio.get())}\n"
            "          saturation={disconnected ? DISCONNECTED_APPEARANCE.saturation : 1}\n"
            "          crossfade={animateColor}\n"
            "        />\n"
            "      </View>\n"
            "    </View>\n"
            "  );\n",
            "  // HXBot: the thumbnail is the agent's animal too (hx-animal-avatar.tsx). A new colour\n"
            "  // shows at once, so `animateColor` has nothing to fade.\n"
            "  return (\n"
            "    <View\n"
            "      pointerEvents=\"none\"\n"
            "      style={{ width: size, height: size, opacity: disconnected ? DISCONNECTED_APPEARANCE.opacity : 1 }}\n"
            "    >\n"
            "      <HxAnimalAvatar key={animateColor ? \"live\" : \"still\"} seed={seed} hue={hue} color={color} size={size} />\n"
            "    </View>\n"
            "  );\n")
    # 原来画毛绒图片的组件不再显示；导出它，免得成为未使用的函数。
    replace(mobile, "\nfunction PlushPicture({\n", "\nexport function PlushPicture({\n")

    # 静态头像（输入框里的 @提及、助手模板卡片）原来画扁平圆团，也换成动物
    static = "packages/ui/src/bloub-avatar.tsx"
    replace(static, 'import { flush } from "solid-js";\n',
            'import { flush } from "solid-js";\nimport { hxStaticAnimalSvg } from "./hx-static-animal";\n')
    replace(static,
            "): SVGSVGElement {\n"
            "  const host = document.createElement(\"span\");\n"
            "  const dispose = mountStaticAvatar(host, seed, hue, color);\n",
            "): SVGSVGElement {\n"
            "  // HXBot: the agent's animal, as AgentAvatar shows it (hx-static-animal.ts).\n"
            "  const animal = hxStaticAnimalSvg(seed, hue, color);\n"
            "  if (animal) return animal;\n"
            "  const host = document.createElement(\"span\");\n"
            "  const dispose = mountStaticAvatar(host, seed, hue, color);\n")
    card = "src/renderer/src/features/agent-templates/agent-template-card.tsx"
    replace(card,
            "  // The Bloub is drawn larger than its box, the way `.agent-avatar > svg` draws it in the app.\n"
            "  const size = AVATAR_SIZE * 1.28;\n"
            "  const svg = createStaticAvatarSvg(preview.avatarSeed, preview.avatarHue);\n"
            "  const image = await loadSvg(svg, size);\n"
            "  context.drawImage(image, cx - size / 2, cy - size / 2 - AVATAR_SIZE * 0.08, size, size);\n",
            "  // HXBot: the avatar is the agent's animal on its round disc, which fills its box.\n"
            "  const size = AVATAR_SIZE;\n"
            "  const svg = createStaticAvatarSvg(preview.avatarSeed, preview.avatarHue);\n"
            "  const image = await loadSvg(svg, size);\n"
            "  context.drawImage(image, cx - size / 2, cy - size / 2, size, size);\n")

    # 头像编辑器里“毛绒 / 扁平”的选择不再显示：两种都是同一只动物
    replace("packages/brand/src/bloub-avatar.ts", "export const AVATAR_STYLES: readonly AvatarStyle[] = ",
            "/** HXBot: every agent is an animal, so the editors do not offer the plush or flat choice. */\n"
            "export const HX_AVATAR_STYLE_CHOICE: boolean = false;\n\n"
            "export const AVATAR_STYLES: readonly AvatarStyle[] = ")
    # 这个开关经 packages/ui 的头像模块转给桌面端和网页版，手机端直接引入
    replace(static,
            "  bloubAvatarProfile,\n"
            "  isAvatarColorChoice,\n"
            "  SUPPORTED_AVATAR_SILHOUETTES,\n"
            "  type SupportedAvatarSilhouetteId,\n"
            "} from \"@openbot/brand/bloub-avatar\";\n"
            "export {\n",
            "  bloubAvatarProfile,\n"
            "  HX_AVATAR_STYLE_CHOICE,\n"
            "  isAvatarColorChoice,\n"
            "  SUPPORTED_AVATAR_SILHOUETTES,\n"
            "  type SupportedAvatarSilhouetteId,\n"
            "} from \"@openbot/brand/bloub-avatar\";\n"
            "export {\n")
    panel = "packages/ui/src/features/conversation/AgentSettingsPanel.tsx"
    replace(panel,
            "  bloubAvatarProfile,\n"
            "  isAvatarColorChoice,\n"
            "  SUPPORTED_AVATAR_SILHOUETTES,\n"
            "  type SupportedAvatarSilhouetteId,\n"
            "} from \"@openbot/ui/bloub-avatar\";\n",
            "  bloubAvatarProfile,\n"
            "  HX_AVATAR_STYLE_CHOICE,\n"
            "  isAvatarColorChoice,\n"
            "  SUPPORTED_AVATAR_SILHOUETTES,\n"
            "  type SupportedAvatarSilhouetteId,\n"
            "} from \"@openbot/ui/bloub-avatar\";\n")
    replace(panel,
            "                        <SlidingTabs.Root\n"
            "                          value={avatarStyle()}\n"
            "                          onChange={(value) => {\n"
            "                            const style = AVATAR_STYLES.find((option) => option === value);\n"
            "                            if (style && style !== avatarStyle()) void selectAvatarFace({ style });\n"
            "                          }}\n"
            "                        >\n"
            "                          <SlidingTabs.List class=\"avatar-style-tabs\" aria-label={t(\"agentSettings.avatar.style\")}>\n"
            "                            <SlidingTabs.Trigger value=\"plush\">\n"
            "                              {t(\"agentSettings.avatar.stylePlush\")}\n"
            "                            </SlidingTabs.Trigger>\n"
            "                            <SlidingTabs.Trigger value=\"flat\">\n"
            "                              {t(\"agentSettings.avatar.styleFlat\")}\n"
            "                            </SlidingTabs.Trigger>\n"
            "                          </SlidingTabs.List>\n"
            "                        </SlidingTabs.Root>\n",
            "                        {/* HXBot: every agent is an animal; the plush or flat choice is not shown. */}\n"
            "                        <Show when={HX_AVATAR_STYLE_CHOICE}>\n"
            "                          <SlidingTabs.Root\n"
            "                            value={avatarStyle()}\n"
            "                            onChange={(value) => {\n"
            "                              const style = AVATAR_STYLES.find((option) => option === value);\n"
            "                              if (style && style !== avatarStyle()) void selectAvatarFace({ style });\n"
            "                            }}\n"
            "                          >\n"
            "                            <SlidingTabs.List class=\"avatar-style-tabs\" aria-label={t(\"agentSettings.avatar.style\")}>\n"
            "                              <SlidingTabs.Trigger value=\"plush\">\n"
            "                                {t(\"agentSettings.avatar.stylePlush\")}\n"
            "                              </SlidingTabs.Trigger>\n"
            "                              <SlidingTabs.Trigger value=\"flat\">\n"
            "                                {t(\"agentSettings.avatar.styleFlat\")}\n"
            "                              </SlidingTabs.Trigger>\n"
            "                            </SlidingTabs.List>\n"
            "                          </SlidingTabs.Root>\n"
            "                        </Show>\n")
    picker = "apps/mobile/src/features/agents/components/agent-appearance-picker.tsx"
    replace(picker,
            "  bloubAvatarProfile,\n"
            "  isAvatarColorChoice,\n"
            "  SUPPORTED_AVATAR_SILHOUETTES,\n"
            "  type SupportedAvatarSilhouetteId,\n"
            "} from \"@openbot/brand/bloub-avatar\";\n",
            "  bloubAvatarProfile,\n"
            "  HX_AVATAR_STYLE_CHOICE,\n"
            "  isAvatarColorChoice,\n"
            "  SUPPORTED_AVATAR_SILHOUETTES,\n"
            "  type SupportedAvatarSilhouetteId,\n"
            "} from \"@openbot/brand/bloub-avatar\";\n")
    replace(picker,
            "          <AvatarStyleOptions style={style} disabled={disabled} onStyleChange={selectStyle} />\n",
            "          {/* HXBot: every agent is an animal; the plush or flat choice is not shown. */}\n"
            "          {HX_AVATAR_STYLE_CHOICE ? (\n"
            "            <AvatarStyleOptions style={style} disabled={disabled} onStyleChange={selectStyle} />\n"
            "          ) : null}\n")

    # 头像编辑器：两组选项现在选的是动物
    zh = "packages/i18n/src/messages/zh/agentSettings.ts"
    for old, new in (('"agentSettings.avatar.shape": "形状",', '"agentSettings.avatar.shape": "动物",'),
                     ('"agentSettings.avatar.shapes": "头像形状",', '"agentSettings.avatar.shapes": "头像动物",'),
                     ('"agentSettings.avatar.shapeOption": "形状 {number}",', '"agentSettings.avatar.shapeOption": "动物 {number}",'),
                     ('"agentSettings.avatar.eyes": "眼睛",', '"agentSettings.avatar.eyes": "更多动物",'),
                     ('"agentSettings.avatar.eyesLabel": "头像眼睛",', '"agentSettings.avatar.eyesLabel": "更多动物",'),
                     ('"agentSettings.avatar.eyesOption": "眼睛 {number}",', '"agentSettings.avatar.eyesOption": "动物 {number}",')):
        replace(zh, old, new)


def on_demand_access() -> None:
    """按需授权：访问本地电脑和网页前，智能体说明原因和用途，客户勾选读、写、删除；任务结束即收回（见 hx/access_control.py）。"""
    access_control.access_control(sys.modules[__name__])


def own_link_and_names() -> None:
    """链接方式改为 hxbot://，对外自称、Webhook 请求头改为 HXBot，不提供用上游身份登记的 Link 钱包（见 hx/own_names.py）。"""
    own_names.own_names(sys.modules[__name__], close_upstream)


def registered_accounts() -> None:
    """注册账号：邮箱 + 自己的密码登录，替换共用口令；第三方账号登录（见 hx/accounts.py）。"""
    hx_accounts.accounts(sys.modules[__name__])


def in_app_updates() -> None:
    """客户端在应用里更新：桌面端从自己的服务器取更新（Mac 自己替换），手机端打开新版本（见 hx/updates.py）。"""
    hx_updates.updates(sys.modules[__name__])


def own_account_deletion() -> None:
    """注销账号：桌面端、网页版、手机端设置里自助注销（见 hx/delete_account.py）。"""
    hx_delete_account.delete_account(sys.modules[__name__])


def access_settings_page() -> None:
    """设置 → 授权与记录：始终允许的规则和操作记录（hx/access_settings.py）。"""
    hx_access_settings.access_settings(sys.modules[__name__])


def required_updates() -> None:
    """强制更新：桌面端自动下载安装并挡住界面，手机端整屏提示，账号服务拒绝旧版本（hx/forced_updates.py）。"""
    hx_forced_updates.forced_updates(sys.modules[__name__])


def workbuddy_look() -> None:
    """界面基础样式向 WorkBuddy 靠拢：开关、下拉框、按钮、输入框、菜单、弹窗、滑块、设置卡片（hx/base_style.py）。"""
    hx_base_style.apply(sys.modules[__name__])


def settings_groups() -> None:
    """设置窗口按 WorkBuddy 分组，“更新”改名“关于”，新增“获取帮助”（hx/settings_nav.py）。"""
    hx_settings_nav.apply(sys.modules[__name__])


def computer_catalog() -> None:
    """电脑操控（一）：这台电脑的目录，computer_find、computer_open、computer_set 三个工具，设置页里的目录和自检（hx/computer_control.py）。"""
    hx_computer_control.apply(sys.modules[__name__])


def auto_model() -> None:
    """协作（一）：按工作内容自动选模型，开工前的建议卡（hx/auto_model.py）。"""
    hx_auto_model.apply(sys.modules[__name__])


def opencode_connect() -> None:
    """“添加服务商”里连接 OpenCode 的全部服务商：网页登录、API 密钥、本机凭据（hx/opencode_connect.py）。"""
    hx_opencode_connect.apply(sys.modules[__name__])


def team_rooms() -> None:
    """协作（二）：自动组队、协作房间、交接单、任务看板、上限，进度和结果回到原来的对话（hx/team.py）。"""
    hx_team.apply(sys.modules[__name__])


def computer_work() -> None:
    """电脑操控（二）：打开应用后按用户的要求列步骤、用鼠标和键盘一步步操作并核对，停止键（hx/computer_steps.py）。"""
    hx_computer_steps.apply(sys.modules[__name__])


def computer_real() -> None:
    """电脑操控（三）：Mac 的隐私与权限——工具检索、固定签名、一键授权、沙盒、装应用、移到“应用程序”（hx/computer_real.py）。"""
    hx_computer_real.apply(sys.modules[__name__])


def vault_login() -> None:
    """保密箱里保存的密码自动登录不再拦截，只有付款每次先问（hx/vault_login.py；用户 2026-11-14）。"""
    hx_vault_login.apply(sys.modules[__name__])


def window_fixes() -> None:
    """窗口的修正：全屏时点关闭，先退出全屏再隐藏，不再留下黑屏（hx/window_fixes.py；用户 2026-11-14）。"""
    hx_window_fixes.apply(sys.modules[__name__])


def quiet() -> None:
    """不打扰其他应用：高亮框少读驱动、Windows 不常驻鼠标钩子（hx/quiet.py；用户 2026-11-14）。"""
    hx_quiet.apply(sys.modules[__name__])


def concurrency() -> None:
    """并发（一）：桌面端容量闸、排队顺序、团队不设上限不拒绝只排队（hx/flow.py；用户 2026-11-17）。"""
    hx_flow.apply(sys.modules[__name__])


def bug_fixes_172() -> None:
    """修 bug（v1.7.2）：程序坞和任务栏里多个 HXBot 图标、HXBot 开着时别的应用打开保存文件卡死等（hx/fixes_172.py；用户 2026-11-18）。"""
    hx_fixes_172.apply(sys.modules[__name__])


def computer_lanes() -> None:
    """电脑操控（五）：分道、礼让用户、停放后自动续做、只留一个入口（hx/computer_v173.py；用户 2026-11-18）。"""
    hx_computer_v173.apply(sys.modules[__name__])


def bug_fixes_173() -> None:
    """全面排查修 bug（v1.7.3）：同一出口地址的多人登录不被限流挡住等（hx/fixes_173.py；用户 2026-11-18）。"""
    hx_fixes_173.apply(sys.modules[__name__])


def hotfix_173() -> None:
    """v1.7.3 紧急修正：程序坞只有一个 HXBot、边干活边更新、检查更新说清原因（hx/hotfix_173.py；用户 2026-11-19）。"""
    hx_hotfix_173.apply(sys.modules[__name__])


def office_files() -> None:
    """应用技能（一）：办公与文件，改前留版本、改后给差异（hx/office_files.py；用户 2026-11-19）。"""
    hx_office_files.apply(sys.modules[__name__])


def concurrency_two() -> None:
    """并发（二）：提供商在途上限、等待看得见、过载换模型、裁判建议（hx/flow_v174.py；用户 2026-11-19）。"""
    hx_flow_v174.apply(sys.modules[__name__])


def skills_ui() -> None:
    """应用技能（一）的对话部分：空间满时问你三选一、改了文件的卡片和“恢复到修改前”（hx/skills_ui_v174.py）。"""
    hx_skills_ui_v174.apply(sys.modules[__name__])


def routines_175() -> None:
    """应用工作流与定时任务升级：时区必填与下三次、错过与跳过的记录、结果判定、工作流新步骤、开机画面（hx/routines_v175.py）。"""
    hx_routines_v175.apply(sys.modules[__name__])


def test_expectations() -> None:
    """上游测试里写死的名称和地址，随改名和封堵一起改，让测试检查 HX 版的实际行为。"""
    csp = "src/main/content-security-policy.test.ts"
    replace(csp, '  it("allows the production analytics endpoint", () => {\n',
            '  it("allows no analytics endpoint, only the HXBot hosts", () => {\n')
    replace(csp, "openbot-remote-attachment: https://analytics.openbot.run ws://127.0.0.1:* wss://*.openbot.run",
            "openbot-remote-attachment: ws://127.0.0.1:* wss://*.bot.hxallai.com")
    replace(csp, "openbot-remote-visual: https://*.openbot.run http://127.0.0.1:*",
            "openbot-remote-visual: https://*.bot.hxallai.com http://127.0.0.1:*")
    migration = "src/backend/migration-guard-migration.test.ts"
    replace(migration, '"OpenBot database migration to version 28 failed."', '"HXBot database migration to version 28 failed."')
    replace(migration, '"OpenBot database migration produced 1 foreign-key',
            '"HXBot database migration produced 1 foreign-key')
    replace(migration, "`OpenBot database migration history is missing version ${missing}.`",
            "`HXBot database migration history is missing version ${missing}.`")


def checks_of_upstream() -> None:
    """让改造结果通过上游自己的检查：界面文字、样式、图片目录、类型、提交前检查（见 hx/upstream_checks.py）。"""
    upstream_checks.upstream_checks(sys.modules[__name__])


def rename_all() -> None:
    """删掉上游官网的宣传页，接好兼容旧版本的代码，再把所有 OpenBot 改成 HXBot（见 hx/brand_rename.py）。"""
    brand_rename.rename_all(sys.modules[__name__])


def upstream() -> None:
    """封堵所有通往 OpenBot 的链接、下载、版本检查和统计上报（见 hx/close_upstream.py）。"""
    close_upstream.close_upstream(sys.modules[__name__])


def main() -> int:
    for step in (desktop, logo, site_pages, shared, account, login_password, mobile, visible_names, interface_text, keychain,
                 giraffe_pile, mobile_giraffe_pile, secret_box, animal_avatars, upstream, on_demand_access, own_link_and_names,
                 registered_accounts, in_app_updates, own_account_deletion, access_settings_page, required_updates, workbuddy_look, settings_groups, computer_catalog, auto_model, opencode_connect, team_rooms, computer_work, computer_real, vault_login, window_fixes, quiet, concurrency, bug_fixes_172, computer_lanes, bug_fixes_173, hotfix_173, office_files, concurrency_two, skills_ui, routines_175, test_expectations, checks_of_upstream, rename_all):
        step()
    brand_rename.finish(sys.modules[__name__])
    if not CHECK_ONLY or not pending:
        # 扫描三个客户端和服务器的全部运行代码：还有指向上游的地址就报错（上游更新后可能新增）
        for line in close_upstream.leak_scan(sys.modules[__name__]):
            errors.append("仍指向上游：" + line)
        for line in close_upstream.prose_leaks(sys.modules[__name__]):
            errors.append("仍显示 OpenBot：" + line)
        for line in own_names.name_leaks(sys.modules[__name__], close_upstream):
            errors.append("仍以 OpenBot 的名称登记或对外自称：" + line)
        for line in brand_rename.leaks():
            errors.append("仍有旧名称：" + line)
        for line in brand_rename.earlier_brand_leaks():
            errors.append("仍写着旧品牌名（现在统一写 HXBot）：" + line)
    if errors:
        print("改造失败，以下位置在上游代码中找不到（上游可能已改动，请人工核对）：", file=sys.stderr)
        for line in errors:
            print("  - " + line, file=sys.stderr)
        return 2
    if CHECK_ONLY:
        if pending:
            files = sorted(set(pending))
            messages = [path for path in files if "/i18n/src/messages/" in path]
            print(f"尚未应用的改造：{len(files)} 个文件（其中界面文字 {len(messages)} 个）")
            for path in [path for path in files if path not in messages]:
                print("  - " + path)
            return 1
        print("全部改造已应用。")
        return 0
    print("改造完成：HXBot（" + ", ".join(f"{k}={v}" for k, v in D.items()) + "）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
