"""封堵上游入口：rebrand.py 的一步。

研究版的任何界面、链接、下载、更新检查、统计上报都不能通往 OpenBot（openbot.run、
nightly-labs/openbot 的 GitHub、OpenBot 的 Discord / X / 社交账号、OpenBot 的应用商店页面）。
这里集中修改桌面端、网页版（含手机浏览器）、安卓端、账号服务和信令服务里所有这类地址；
最后的 leak_scan() 扫描全部运行代码，还有上游地址就报错，防止上游更新后漏改。

由 rebrand.py 导入后调用 close_upstream(r)，r 是 rebrand 模块本身（提供 replace、regex 等工具）。
"""

from __future__ import annotations

import re
from urllib.parse import quote

import translations  # 同目录：研究版文字在其他 13 种语言里的译文

# .invalid 域名永远解析不到（RFC 2606）：统计或版本检查即使被打开，也发不出去任何请求
INVALID_ANALYTICS = "https://analytics.invalid"

HELP_MENU = """import { BookOpen, CircleQuestionMark, Download, DropdownMenu, Megaphone, MotionTooltip, Server } from "@openbot/ui";
import { createSignal } from "solid-js";
import { useText } from "../../text";

// HXBot: every item of the Help menu opens the HXBot server (the portal on bot.hxallai.com)
// or writes to 弘犀智能: the guide, the server (what a server is and how invite links work), the
// latest installers, and feedback by email. OpenBot's release notes, changelog and Discord community
// are not part of HXBot. The callers keep their names: the changelog item opens the downloads, and
// the item that opened OpenBot's Discord opens the server page.

/** One line of the What's new list: the headline of a release note and the date of its release. */
export interface HelpMenuNews {
  headline: string;
  /** `YYYY-MM-DD`, as the release notes write it. */
  date: string;
}

export interface HelpMenuProps {
  /** HXBot shows no What's new list. The callers still pass it. */
  news: readonly HelpMenuNews[];
  /** The class of the button that opens the menu, so it matches the buttons around it. */
  triggerClass?: string;
  /** Called when the menu opens. */
  onOpen?: () => void;
  onOpenWhatsNew: () => void;
  /** HXBot: the downloads on the HXBot server. */
  onOpenChangelog: () => void;
  /** HXBot: the guide on the HXBot server. */
  onOpenGuides: () => void;
  /** HXBot: the server page (servers and invite links) on the HXBot server. */
  onOpenDiscord: () => void;
  onSendFeedback: () => void;
}

/** The Help menu of HXBot. */
export function HelpMenu(props: HelpMenuProps) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  return (
    <DropdownMenu.Root
      placement="right-end"
      gutter={10}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) props.onOpen?.();
      }}
    >
      <MotionTooltip content={t("app.help.label")} suppressed={open()}>
        <DropdownMenu.Trigger class={props.triggerClass} aria-label={t("app.help.label")}>
          <CircleQuestionMark aria-hidden="true" />
        </DropdownMenu.Trigger>
      </MotionTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="agent-context-menu help-menu" aria-label={t("app.help.label")}>
          <DropdownMenu.Item onSelect={() => props.onOpenGuides()}>
            <BookOpen class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("app.help.guides")}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => props.onOpenDiscord()}>
            <Server class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("app.help.discord")}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => props.onOpenChangelog()}>
            <Download class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("app.help.changelog")}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={() => props.onSendFeedback()}>
            <Megaphone class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("account.menu.sendFeedback")}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
"""

NOT_FOUND_PAGE = """import { TransactionalPage } from "../transactional/TransactionalPage";
import { Button } from "../ui/button";

/**
 * HXBot: the page for an address that does not exist. It shows only HXBot and links to the
 * web app and the download page. OpenBot's site header, footer and page suggestions are not shown.
 */
export function NotFoundPage() {
  return (
    <TransactionalPage titleId="not-found-title">
      <h1 id="not-found-title">页面不存在 · Page not found</h1>
      <p class="join-card-copy">
        这个地址没有内容：链接可能已失效，或服务器暂时连接不上。The page does not exist: the link may be out of
        date, or the server cannot be reached right now.
      </p>
      <div class="join-card-actions">
        <Button href="/app" variant="primary" size="lg" icon="arrow-right">
          打开网页版 · Open the web app
        </Button>
        <Button href="/" variant="secondary" size="lg" icon="open">
          下载页 · Download page
        </Button>
      </div>
    </TransactionalPage>
  );
}
"""


AASA_ROUTE = """import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/solid-router";
import { requireWorkerBindings } from "../../server/types";

/**
 * HXBot: the iOS app of HXBot opens the invitation links of this site (`/join`). Its app ID is
 * the Apple team ID of 弘犀智能 and the bundle ID `__BUNDLE_ID__`; the team ID is `HX_APPLE_TEAM_ID` in the
 * server's .env. Without it no app opens these links and they open in the browser. No app of OpenBot is named.
 */
const BUNDLE_ID = "__BUNDLE_ID__";
const TEAM_ID = /^[A-Z0-9]{10}$/u;

function createAppleAppSiteAssociationResponse(): Response {
  const team = (requireWorkerBindings(env).HX_APPLE_TEAM_ID ?? "").trim();
  const details = TEAM_ID.test(team) ? [{ appID: `${team}.${BUNDLE_ID}`, paths: ["/join"] }] : [];
  return new Response(JSON.stringify({ applinks: { apps: [], details } }), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export const Route = createFileRoute("/.well-known/apple-app-site-association")({
  server: {
    handlers: {
      GET: createAppleAppSiteAssociationResponse,
    },
  },
});
"""


def icon_composer_white(data) -> None:
    """Icon Composer 图标（.icon）：白底（深色模式深灰底），长颈鹿保持原色，不加玻璃效果、不压成单色。"""
    data["fill-specializations"] = [
        {"value": {"solid": "srgb:1.00000,1.00000,1.00000,1.00000"}},
        {"appearance": "dark", "value": {"solid": "srgb:0.12157,0.12157,0.12157,1.00000"}},
    ]
    for group in data.get("groups", []):
        for layer in group.get("layers", []):
            layer["fill-specializations"] = [{"value": "automatic"}]
            layer["glass-specializations"] = [{"value": False}]
        group["translucency"] = {"enabled": False, "value": 0}


# 各个桌面端版本的发布日期（“新功能”窗口按版本写日期）。每发一个版本加一行。
HX_RELEASE_DATES = {
    "0.67.1": "2026-11-13",
    "0.67.2": "2026-11-13",
    "0.67.3": "2026-11-13",
    "0.67.4": "2026-11-14",
    "0.67.5": "2026-11-14",
    "0.67.6": "2026-11-14",
    "0.67.7": "2026-11-14",
    "0.67.8": "2026-11-14",
    "0.67.9": "2026-11-15",
    "0.67.10": "2026-11-18",
    "0.67.11": "2026-11-18",
    "0.67.12": "2026-11-18",
    "0.67.13": "2026-11-19",
}


def close_upstream(r) -> None:
    SITE, API, D, NAME, ACCESS_EMAIL = r.SITE, r.API, r.D, r.NAME, r.ACCESS_EMAIL
    replace, regex, rewrite, read, write = r.replace, r.regex, r.rewrite, r.read, r.write
    portal = f"{SITE}/"
    feedback = f"mailto:{ACCESS_EMAIL}?subject=" + quote("HXBot 反馈 / Feedback")
    website = f"https://{D['website']}/"
    # 帮助菜单各项打开 HXBot 服务器上的页面：使用指南（/guide/）、服务端（指南第 6 节：发布服务器与邀请成员）、
    # 下载最新版本（门户的下载中心）。指南页按浏览器语言自动切换到英文版 /en/guide/。
    guide, server, downloads = f"{SITE}/guide/", f"{SITE}/guide/#server", f"{SITE}/#downloads"
    faq = f"{SITE}/guide/#faq"  # 助手设置出错时的“排查”链接

    # ------------------------------------------------ 帮助（?）菜单与外链表：桌面端、网页版
    rewrite("packages/ui/src/features/updates/HelpMenu.tsx", 'import { DiscordMark } from "../settings/brand-marks";', HELP_MENU)

    handlers = "src/main/ipc/app-handlers.ts"
    replace(
        handlers,
        'const OPENBOT_SITE = "https://openbot.run";\n\n'
        "/** The first post that the social toast offers, encoded for a query string. */\n"
        "function draftPost(translate: AppTranslate): string {\n"
        '  return encodeURIComponent(translate("app.socialFollow.draftPost", { site: "openbot.run" }));\n'
        "}\n",
        "// HXBot: every destination below opens the HXBot server (the portal on bot.hxallai.com) or writes to\n"
        "// 弘犀智能. The Help menu opens the guide, the server page and the downloads there; the community and\n"
        "// social links of OpenBot open the portal. No destination leads to OpenBot.\n"
        f'const OPENBOT_SITE = "{portal}";\n'
        f'const HX_FEEDBACK_URL = "{feedback}";\n'
        f'const HX_GUIDE_URL = "{guide}";\n'
        f'const HX_SERVER_URL = "{server}";\n'
        f'const HX_DOWNLOADS_URL = "{downloads}";\n'
        f'const HX_FAQ_URL = "{faq}";\n',
    )
    replace(handlers, '  "agent-setup": "https://github.com/nightly-labs/openbot/blob/main/docs/TROUBLESHOOTING.md",', '  "agent-setup": HX_FAQ_URL,')
    destinations = "".join(
        f"  {key}: {value},\n"
        for key, value in (
            ("feedback", "HX_FEEDBACK_URL"),
            ("message", "HX_FEEDBACK_URL"),
            ("changelog", "HX_DOWNLOADS_URL"),
            ("guides", "HX_GUIDE_URL"),
            ("discord", "HX_SERVER_URL"),
            *((key, "OPENBOT_SITE") for key in (
                "github", "x", "threads", "instagram", "tiktok", "facebook",
                "linkedin", "reddit", '"x-post"', '"threads-post"', '"linkedin-post"', '"reddit-post"',
                '"facebook-post"', '"instagram-post"', '"tiktok-post"',
            )),
        )
    )
    if regex(
        handlers,
        r'(?s)  feedback: "https://x\.com/intent/post\?text=Feedback.*?  "tiktok-post": "https://www\.tiktok\.com/upload",\n',
        lambda _m: destinations,
    ) == 0 and not r.applied(handlers, destinations, read(handlers)):
        r.errors.append(f"{handlers}: external destinations block not found")

    web = "src/renderer/src/features/web-client/web-provider-admin.ts"
    replace(
        web,
        '  feedback: "https://x.com/intent/post?text=Feedback%20for%20OpenBot%20%40norbertbodziony%3A%20",\n'
        '  message: "https://x.com/norbertbodziony",\n'
        '  changelog: "https://openbot.run/changelog",\n'
        '  guides: "https://openbot.run/guides",\n'
        '  discord: "https://discord.openbot.run",\n'
        '  x: "https://x.com/OpenBot_",\n',
        "  // HXBot: feedback is an email to 弘犀智能; the Help menu opens the guide, the server page and the\n"
        "  // downloads on the HXBot server; the other links open the HXBot portal. Nothing opens OpenBot.\n"
        f'  feedback: "{feedback}",\n'
        f'  message: "{feedback}",\n'
        f'  changelog: "{downloads}",\n'
        f'  guides: "{guide}",\n'
        f'  discord: "{server}",\n'
        + "".join(f'  {key}: "{portal}",\n' for key in ("x", "github"))
        + f'  "agent-setup": "{faq}",\n',
    )
    replace(
        web,
        '  window.open(url, "_blank", "noopener");\n  return Promise.resolve();\n}',
        '  // An email address opens the mail app in place; a page opens in a new tab.\n'
        '  if (url.startsWith("mailto:")) window.location.assign(url);\n'
        '  else window.open(url, "_blank", "noopener");\n  return Promise.resolve();\n}',
    )

    # ------------------------------------------------ “新功能”与更新日志：不带 OpenBot 的发布说明
    replace("src/renderer/src/features/updates/WhatsNewOverlay.tsx", '.openUrl("https://openbot.run/changelog")', f'.openUrl("{SITE}/whats-new/")')
    # v1.6.7 起（用户 2026-11-14：新功能上线后，在客户端最醒目一览给设置说明、说优势）：升级后第一次打开时，
    # 上游的“新功能”窗口列出 HXBot 自己的新功能（hx/release-notes.json：每条第一句是好处，后面说怎么用、在哪设置）。
    # 英文和中文有原文，其他语言读英文。“查看更新日志”打开门户的《新功能与亮点》（带截图）。
    import json as _json
    release_notes = _json.loads((r.ROOT / "hx" / "release-notes.json").read_text(encoding="utf-8"))
    ordered = sorted((version for version in release_notes if re.fullmatch(r"\d+\.\d+\.\d+", version)),
                     key=lambda version: [int(part) for part in version.split(".")], reverse=True)

    def notes_of(lang: str) -> str:
        releases = [
            {"version": version, "date": HX_RELEASE_DATES[version], "notices": [],
             "groups": [{"type": "added", "items": release_notes[version][lang]}]}
            for version in ordered if lang in release_notes[version]
        ]
        return _json.dumps(releases, ensure_ascii=False, indent=2) + "\n"

    updates = "src/renderer/src/features/updates"
    for path, text in [(f"{updates}/whats-new-releases.json", notes_of("en")), (f"{updates}/whats-new/zh.json", notes_of("zh"))] + [
        (f"{updates}/whats-new/{lang}.json", "[]\n")
        for lang in ("ar", "de", "es", "fr", "he", "it", "ja", "ko", "nl", "pl", "pt", "ru", "tr")
    ]:
        if read(path) != text:
            write(path, text)

    # ------------------------------------------------ 版本检查与下载：不查、不下载 OpenBot 的发布
    hrs = "src/main/host-release-service.ts"
    replace(
        hrs,
        "type ReleaseTarget = { feed: string; asset: (version: string) => string };\n",
        "type ReleaseTarget = { feed: string; asset: (version: string) => string };\n\n"
        "/**\n"
        " * HXBot: OpenBot's GitHub releases are another product, so they are never checked or offered.\n"
        " * HXBot has no public release feed; new installers are on the HXBot portal. A feed of 弘犀智能 can\n"
        " * be named with `HX_RELEASE_FEED_URL` (the folder that holds `latest*.yml`).\n"
        " */\n"
        'const HX_RELEASE_FEED = process.env.HX_RELEASE_FEED_URL?.trim().replace(/\\/+$/u, "") || null;\n',
    )
    replace(
        hrs,
        "      options.packaged && isValidSemver(options.currentVersion) ? releaseTarget(options.platform, options.arch) : null;",
        "      options.packaged && isValidSemver(options.currentVersion) && HX_RELEASE_FEED\n"
        "        ? releaseTarget(options.platform, options.arch)\n"
        "        : null;",
    )
    replace(
        hrs,
        "  const response = await request(`https://github.com/nightly-labs/openbot/releases/latest/download/${target.feed}`, {",
        '  if (!HX_RELEASE_FEED) throw new Error("No HXBot release feed");\n'
        "  const response = await request(`${HX_RELEASE_FEED}/${target.feed}`, {",
    )
    replace("src/main/app-archive-watch.ts", 'export const DOWNLOAD_URL = "https://openbot.run/download";',
            f'export const DOWNLOAD_URL = "{portal}"; // HXBot: the installers are on the HXBot portal')
    replace(
        "src/main/newer-database-recovery.ts",
        'const GUIDE_URL =\n  "https://github.com/nightly-labs/openbot/blob/main/docs/TROUBLESHOOTING.md#openbot-says-a-newer-version-saved-your-data";',
        f'const GUIDE_URL = "{portal}"; // HXBot: help is on the HXBot portal',
    )
    prr = "src/main/provider-runtime-releases.ts"
    replace(
        prr,
        'const BLOCKED_VERSIONS_URL =\n  "https://raw.githubusercontent.com/nightly-labs/openbot/main/provider-runtime-blocklist.json";',
        "// HXBot: the list is not read from OpenBot's repository. This address never resolves, so it blocks nothing.\n"
        'const BLOCKED_VERSIONS_URL = "https://provider-runtime-blocklist.invalid/provider-runtime-blocklist.json";',
    )
    replace(prr, 'const HEADERS = { "User-Agent": "OpenBot-runtime-installer" };', 'const HEADERS = { "User-Agent": "HXBot-runtime-installer" };')

    # ------------------------------------------------ 统计与错误报告：地址改成永远解析不到的 .invalid
    for path, old in (
        ("src/main/analytics.ts", 'const OPENPANEL_API_URL = "https://analytics.openbot.run/api";'),
        ("src/renderer/src/analytics.ts", 'const OPENPANEL_API_URL = "https://analytics.openbot.run/api";'),
        ("packages/telemetry/src/transport.ts", '"https://analytics.openbot.run/api/track"'),
        ("apps/mobile/src/features/analytics/mobile-analytics.ts", '    apiUrl: "https://analytics.openbot.run/api",'),
        ("apps/auth-api/src/lib/analytics.ts", 'const OPENPANEL_API_URL = "https://analytics.openbot.run/api";'),
        ("apps/auth-api/src/server/account-analytics.ts", 'const OPENPANEL_API_URL = "https://analytics.openbot.run/api";'),
        ("apps/auth-api/src/server/sales-analytics-delivery.ts", 'const OPENPANEL_API_URL = "https://analytics.openbot.run/api";'),
        ("remote/api/src/capacity-report.ts", '"https://analytics.openbot.run/api/track"'),
    ):
        replace(path, old, old.replace("https://analytics.openbot.run", INVALID_ANALYTICS))
    # 只在页面域名恰好是 openbot.run 时才开启的统计、错误上报：比较对象换成永远不会出现的 .invalid 域名，
    # 行为不变（始终关闭），下发到浏览器的代码里也不再出现上游域名
    for path, old in (
        ("src/renderer/src/analytics.ts", 'window.location.origin !== "https://openbot.run"'),
        ("src/renderer/src/error-reports.ts", 'window.location.origin !== "https://openbot.run"'),
        ("apps/auth-api/src/lib/analytics.ts", 'hostname === "openbot.run"'),
    ):
        replace(path, old, old.replace("openbot.run", "analytics.invalid"))
    csp = "src/main/content-security-policy.ts"
    replace(csp, "https://analytics.openbot.run ws://127.0.0.1:* wss://*.openbot.run", f"ws://127.0.0.1:* wss://*.{D['site']}")
    replace(csp, "openbot-remote-visual: https://*.openbot.run http://127.0.0.1:*", f"openbot-remote-visual: https://*.{D['site']} http://127.0.0.1:*")

    # ------------------------------------------------ MCP 登录时向第三方报的应用身份
    mcp = "src/backend/mcp-oauth-provider.ts"
    replace(mcp, 'const MCP_CLIENT_METADATA_URL = "https://openbot.run/oauth/mcp-client.json";', f'const MCP_CLIENT_METADATA_URL = "{SITE}/oauth/mcp-client.json";')
    identity_old = '      client_name: "OpenBot",\n      client_uri: "https://openbot.run",\n      logo_uri: "https://openbot.run/icon-512x512.png",'
    identity_new = f'      client_name: "{NAME}",\n      client_uri: "{SITE}",\n      logo_uri: "{SITE}/icon-512x512.png",'
    replace(mcp, identity_old, identity_new)
    route = "apps/auth-api/src/routes/oauth/mcp-client[.]json.ts"
    replace(route, 'const CLIENT_ID = "https://openbot.run/oauth/mcp-client.json";', f'const CLIENT_ID = "{SITE}/oauth/mcp-client.json";')
    replace(route, identity_old, identity_new)
    replace(
        "src/backend/mcp-oauth-proxy.ts",
        '    name: "openbot",\n    title: name ? `${name} (OpenBot)` : "OpenBot",\n    version: client.version,\n    websiteUrl: "https://openbot.run",',
        f'    name: "hxbot",\n    title: name ? `${{name}} ({NAME})` : "{NAME}",\n    version: client.version,\n    websiteUrl: "{SITE}",',
    )
    # MCP 服务器看到的 User-Agent：HXBot 的产品名与版本
    replace("src/backend/mcp-oauth-proxy.ts", "`OpenBot/${this.#options.client.version}`", "`HXBot/${this.#options.client.version}`")

    # ------------------------------------------------ 许可与隐私、分享链接、联系方式
    replace(
        "src/renderer/src/features/onboarding/FirstRunFlow.tsx",
        'const TERMS_URL = "https://openbot.run/terms";\nconst PRIVACY_URL = "https://openbot.run/privacy";',
        f'const TERMS_URL = "{SITE}/terms/"; // HXBot: the terms and privacy policy of the research edition\n'
        f'const PRIVACY_URL = "{SITE}/privacy/";',
    )
    replace(
        "src/renderer/src/features/web-client/WebApp.tsx",
        '                      onOpenTerms={() => window.open("/terms", "_blank", "noopener")}\n'
        '                      onOpenPrivacy={() => window.open("/privacy", "_blank", "noopener")}',
        '                      onOpenTerms={() => window.open("/terms/", "_blank", "noopener")}\n'
        '                      onOpenPrivacy={() => window.open("/privacy/", "_blank", "noopener")}',
    )
    for path, old in (
        ("packages/contracts/src/marketplace-links.ts", 'export const OPENBOT_MARKETPLACE_ORIGIN = "https://openbot.run";'),
        ("packages/contracts/src/plugin-links.ts", 'export const OPENBOT_PLUGIN_ORIGIN = "https://openbot.run";'),
        ("packages/contracts/src/agent-template-links.ts", 'export const OPENBOT_AGENT_TEMPLATE_ORIGIN = "https://openbot.run";'),
    ):
        replace(path, old, old.replace("https://openbot.run", SITE))
    regex("src/renderer/src/features/settings/marketplace-plugin-catalog.ts", r'"https://openbot\.run/plugins/', f'"{SITE}/plugins/')
    replace("src/renderer/src/features/agent-templates/agent-template-card.tsx", 'context.fillText("openbot.run", ', f'context.fillText("{D["site"]}", ')
    replace("src/renderer/src/features/conversation/social-follow-prompt.tsx", '{ site: "openbot.run" }', f'{{ site: "{D["site"]}" }}')
    replace("packages/contracts/src/hosted-servers.ts", "export const HOSTED_SERVER_CONTACT_URL = `mailto:hello@openbot.run?subject=",
            f"export const HOSTED_SERVER_CONTACT_URL = `mailto:{ACCESS_EMAIL}?subject=")
    replace("src/main/routine-feed-ics.ts", "@routines.openbot.run`", f"@routines.{D['site']}`")
    replace("build/entitlements.mac.plist", "<string>applinks:openbot.run</string>", f"<string>applinks:{D['site']}</string>")

    # GitHub 连接：不用 OpenBot 的 GitHub 应用（nightly-labs 的 “OpenBotGit”），否则仓库授权给了上游的应用
    replace(
        "src/main/github-connector-config.ts",
        'const GITHUB_APP_CLIENT_ID = "Iv23lik5pzHz70cb0RUL";',
        "// HXBot: not the upstream project's GitHub App. With no Client ID the GitHub connection is not offered;\n"
        "// OPENBOT_GITHUB_CLIENT_ID and OPENBOT_GITHUB_APP_SLUG can name a GitHub App of 弘犀智能.\n"
        'const GITHUB_APP_CLIENT_ID = "";',
    )
    replace("src/main/github-connector-config.ts", 'const GITHUB_APP_SLUG = "openbotgit";', 'const GITHUB_APP_SLUG = ""; // HXBot: not the upstream app "openbotgit"')

    # 导入助手：不打开 OpenBot 在 Grok 上的导出助手，不从 OpenBot 的 GitHub 安装导出技能（手动添加技能文件仍可用）
    replace("packages/contracts/src/ipc-agent-import.ts", 'export const GROK_BOT_EXPORT_URL = "https://x.ai/bot/gI0XdhhDYPJeyQaqQBC0O";',
            f'export const GROK_BOT_EXPORT_URL = "{portal}"; // HXBot: OpenBot\'s export agent on Grok is not offered')
    replace(
        "apps/auth-api/src/routes/guides/$slug.tsx",
        '        href: "https://github.com/nightly-labs/openbot/blob/main/CONTRIBUTING.md",',
        f'        href: "{portal}",',
    )
    replace(
        "packages/contracts/src/ipc-agent-import.ts",
        'export const HERMES_EXPORT_SKILL_ID = "nightly-labs/openbot/resources/agent-import/hermes-agent";',
        "// HXBot: the export skill is added by hand (the command tab is hidden), so no GitHub path of OpenBot ships.\n"
        'export const HERMES_EXPORT_SKILL_ID = "hxbot-export";',
    )
    replace(
        "src/renderer/src/features/servers/ServerImportPanel.tsx",
        '  if (source === "grok-bot") return ["agent", "skill"];\n  return folder ? ["folder", "command", "skill"] : ["command", "skill"];',
        "  // HXBot: no export agent of OpenBot on Grok, and no skill install from OpenBot's GitHub.\n"
        '  if (source === "grok-bot") return ["skill"];\n  return folder ? ["folder", "skill"] : ["skill"];',
    )
    replace(
        "packages/ui/src/features/import/AgentImportView.tsx",
        "                <Show\n"
        "                  when={hermes()}\n"
        '                  fallback={<SlidingTabs.Trigger value="agent">{t("import.guide.setupAgent")}</SlidingTabs.Trigger>}\n'
        "                >\n"
        '                  <SlidingTabs.Trigger value="command">{t("import.guide.setupCommand")}</SlidingTabs.Trigger>\n'
        "                </Show>\n",
        "                {/* HXBot: no export agent of OpenBot on Grok, and no skill install from OpenBot's GitHub. */}\n",
    )

    # “连接手机”对话框的二维码：不去 App Store / Google Play 上 OpenBot 的应用，而是 HXBot 下载页（安卓 APK）
    replace(
        "packages/ui/src/features/mobile-app/android-play-store.ts",
        'export const ANDROID_PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=run.openbot.mobile";',
        f'export const ANDROID_PLAY_STORE_URL = "{downloads}"; // HXBot: the Android installer is on the HXBot server',
    )
    replace(
        "packages/ui/src/features/mobile-app/ios-app-store.ts",
        'export const IOS_APP_STORE_URL = "https://apps.apple.com/us/app/openbot-run/id6807024266";',
        f'export const IOS_APP_STORE_URL = "{downloads}"; // HXBot: not the upstream App Store app',
    )
    regex(
        "packages/ui/src/features/social-follow/social-networks.ts",
        r'handle: "(?:@OpenBot_|@openbot\.run|r/OpenBot_|OpenBot)"',
        'handle: ""',
    )
    # 苹果的团队号是 OpenBot 开发者账号的；研究版不签名，不写团队号
    replace("build/entitlements.mac.plist", "    <key>com.apple.developer.team-identifier</key>\n    <string>ZTRDTUL87R</string>\n", "")

    # ------------------------------------------------ 安装包元数据：作者（Windows 安装程序的“发布者”、Linux 维护者）、仓库、反馈地址
    def package_meta(data) -> None:
        data["author"] = {"name": f"{r.BRAND['company']} {r.BRAND['companyEn']}", "email": ACCESS_EMAIL, "url": website}
        data["bugs"] = {"email": ACCESS_EMAIL, "url": portal}
        data.pop("repository", None)

    r.json_edit("package.json", package_meta)

    # ------------------------------------------------ iOS：长颈鹿图标、签名团队号、上架脚本
    def ios_icon(data) -> None:
        # 与安卓、桌面端同一张白底长颈鹿图标（PNG 适用于所有 Xcode 版本，外观与品牌一致）
        data["expo"]["ios"]["icon"] = "./assets/icons/app-icon.png"

    r.json_edit("apps/mobile/app.json", ios_icon)
    for bundle in ("apps/mobile/assets/icons/app-icon.icon/icon.json", "build/icon-production.icon/icon.json"):
        r.json_edit(bundle, icon_composer_white)
    replace(
        "apps/mobile/app.config.js",
        "module.exports = ({ config }) =>\n"
        "  existsSync(join(__dirname, GOOGLE_SERVICES_FILE))\n"
        "    ? { ...config, android: { ...config.android, googleServicesFile: GOOGLE_SERVICES_FILE } }\n"
        "    : config;\n",
        "module.exports = ({ config }) => {\n"
        "  // HXBot: the Apple team that signs the iOS app and its extensions, and the number of this\n"
        "  // build. Apple takes each build number of a version once, so every build that is uploaded needs a\n"
        "  // higher one (hx/scripts/build-ios.sh sets both).\n"
        "  const appleTeamId = process.env.HX_APPLE_TEAM_ID?.trim();\n"
        "  const buildNumber = process.env.HX_IOS_BUILD?.trim();\n"
        "  const ios = { ...config.ios, ...(appleTeamId ? { appleTeamId } : {}), ...(buildNumber ? { buildNumber } : {}) };\n"
        "  const signed = appleTeamId || buildNumber ? { ...config, ios } : config;\n"
        "  return existsSync(join(__dirname, GOOGLE_SERVICES_FILE))\n"
        "    ? { ...signed, android: { ...signed.android, googleServicesFile: GOOGLE_SERVICES_FILE } }\n"
        "    : signed;\n"
        "};\n",
    )
    replace("apps/mobile/fastlane/Fastfile", '      app_identifier: "run.openbot.mobile",', f'      app_identifier: "{r.APP_ID}",')
    replace("apps/mobile/fastlane/Fastfile", '      package_name: "run.openbot.mobile",', f'      package_name: "{r.BRAND["androidPackage"]}",')
    for podspec in sorted((r.ROOT / "apps/mobile/modules").glob("*/ios/*.podspec")):
        rel = podspec.relative_to(r.ROOT).as_posix()
        replace(rel, "s.homepage       = 'https://openbot.run'", f"s.homepage       = '{SITE}'")
        replace(rel, "s.author         = 'OpenBot'", "s.author         = '弘犀智能 HX AI'")

    # 安卓通知内容无法解密时显示的标题
    replace(
        "apps/mobile/modules/android-notifications/android/src/main/java/run/openbot/mobile/notifications/OpenBotMessagingService.kt",
        '    private const val APP_NAME = "OpenBot"',
        f'    private const val APP_NAME = "{NAME}"',
    )

    # ------------------------------------------------ 安卓端（iOS 扩展的标识也在 app.json 里）
    def app_ids(data) -> None:
        def walk(node):
            if isinstance(node, dict):
                for key, value in node.items():
                    node[key] = walk(value)
            elif isinstance(node, list):
                for index, value in enumerate(node):
                    node[index] = walk(value)
            elif isinstance(node, str):
                return node.replace("run.openbot.mobile", r.APP_ID)
            return node

        walk(data)

    r.json_edit("apps/mobile/app.json", app_ids)
    for path in (
        "apps/mobile/src/features/push-notifications/push-notifications-native.ios.ts",
        "apps/mobile/src/features/share/model/share-extension.ts",
    ):
        replace(path, 'const APP_GROUP = "group.run.openbot.mobile";', f'const APP_GROUP = "group.{r.APP_ID}";')

    support ="apps/mobile/src/features/settings/screens/support-settings-screen.tsx"
    replace(
        support,
        "/** The OpenBot Discord community, the same address as the desktop app. Its tickets get the fastest answer. */\n"
        'const DISCORD_URL = "https://discord.openbot.run";\n'
        "/** The OpenBot account, the same contact as the website. */\n"
        'const SUPPORT_X_HANDLE = "@OpenBot_";\n'
        'const SUPPORT_X_URL = "https://x.com/OpenBot_";\n'
        'const ISSUES_URL = "https://github.com/nightly-labs/openbot/issues/new";\n',
        "/** HXBot: help is an email to 弘犀智能 and the HXBot portal. Nothing opens OpenBot's Discord, X or GitHub. */\n"
        f'const HX_EMAIL = "{ACCESS_EMAIL}";\n'
        f'const HX_FEEDBACK_URL = "{feedback}";\n'
        f'const HX_SITE = "{portal}";\n',
    )
    replace(
        support,
        '      <SettingsSection title={t("mobile.settings.support.help")} footer={t("mobile.settings.support.helpFooter")}>\n'
        '        <SettingsRow onPress={() => open(DISCORD_URL)} supportingText={t("mobile.settings.support.discordHint")}>\n'
        '          <Typography.Paragraph>{t("mobile.settings.support.discord")}</Typography.Paragraph>\n'
        "        </SettingsRow>\n"
        "        <SettingsRow onPress={() => open(ISSUES_URL)}>\n"
        '          <Typography.Paragraph>{t("mobile.settings.support.issues")}</Typography.Paragraph>\n'
        "        </SettingsRow>\n"
        "        <SettingsRow onPress={() => open(SUPPORT_X_URL)} supportingText={SUPPORT_X_HANDLE}>\n"
        '          <Typography.Paragraph>{t("mobile.settings.support.message")}</Typography.Paragraph>\n'
        "        </SettingsRow>\n",
        '      <SettingsSection title={t("mobile.settings.support.help")}>\n'
        "        <SettingsRow onPress={() => open(HX_FEEDBACK_URL)}>\n"
        "          <Typography.Paragraph>{HX_EMAIL}</Typography.Paragraph>\n"
        "        </SettingsRow>\n"
        f'        <SettingsRow onPress={{() => open(HX_SITE)}} supportingText="{D["site"]}">\n'
        '          <Typography.Paragraph>{t("mobile.settings.about.website")}</Typography.Paragraph>\n'
        "        </SettingsRow>\n",
    )
    replace(support, "`openbot-support-log-${", "`hxbot-support-log-${")
    replace(
        "apps/mobile/src/features/settings/screens/about-settings-screen.tsx",
        'open("https://openbot.run/privacy-policy")',
        f'open("{SITE}/privacy/")',
    )
    replace(
        "apps/mobile/src/features/app-update/model/app-update.ts",
        'const IOS_STORE_URL = "itms-apps://apps.apple.com/app/id6807024266";\n'
        'const IOS_STORE_WEB_URL = "https://apps.apple.com/app/id6807024266";\n'
        'const ANDROID_STORE_URL = "market://details?id=run.openbot.mobile";\n'
        'const ANDROID_STORE_WEB_URL = "https://play.google.com/store/apps/details?id=run.openbot.mobile";\n\n'
        "/** The public changelog, for when the notes cannot load. */\n"
        'export const MOBILE_CHANGELOG_URL = "https://openbot.run/changelog?platform=mobile";',
        "// HXBot: not the upstream store pages. A new version is installed from the HXBot portal.\n"
        f'const IOS_STORE_URL = "{portal}";\n'
        f'const IOS_STORE_WEB_URL = "{portal}";\n'
        f'const ANDROID_STORE_URL = "{portal}";\n'
        f'const ANDROID_STORE_WEB_URL = "{portal}";\n\n'
        "/** The page for when the notes cannot load. */\n"
        f'export const MOBILE_CHANGELOG_URL = "{portal}";',
    )

    # ------------------------------------------------ 账号服务（网页版、邀请页所在的服务器）
    regex(
        "apps/auth-api/src/lib/landing-links.ts",
        r'"https://(?:www\.)?(?:x\.com/OpenBot_|threads\.com/@openbot\.run|linkedin\.com/company/openbot-si/'
        r"|reddit\.com/r/OpenBot_/|instagram\.com/openbot\.run/|tiktok\.com/@openbot\.run"
        r"|facebook\.com/profile\.php\?id=61595425259628|discord\.openbot\.run|status\.openbot\.run"
        r'|github\.com/nightly-labs/openbot[^"]*)"',
        f'"{portal}"',
    )
    meta = "apps/auth-api/src/lib/site-metadata.ts"
    replace(
        meta,
        'export const OPENBOT_SITE_DESCRIPTION =\n  "A free desktop app that runs AI agents as a team on your own computer, with the ChatGPT, Claude, Gemini or Grok plan you already pay for, or your own model.";',
        'export const OPENBOT_SITE_DESCRIPTION =\n  "弘犀智能多智能体工作台研究版，仅限研究使用，不得用于商业用途。HXBot research edition, for research use only.";',
    )
    replace(meta, "export const OPENBOT_SOCIAL_IMAGE_URL = `${OPENBOT_SITE_URL}openbot-social.png`;", "export const OPENBOT_SOCIAL_IMAGE_URL = `${OPENBOT_SITE_URL}icon-512x512.png`;")
    replace(meta, 'export const OPENBOT_X_HANDLE = "@OpenBot_";', 'export const OPENBOT_X_HANDLE = "";')
    replace(
        meta,
        'const OPENBOT_X_URL = "https://x.com/OpenBot_";\n'
        'const OPENBOT_REPOSITORY_URL = "https://github.com/nightly-labs/openbot";\n'
        'const OPENBOT_PRODUCT_HUNT_URL = "https://www.producthunt.com/products/openbot-3";',
        "// HXBot: the pages name only 弘犀智能, not the upstream accounts or repository.\n"
        f'const OPENBOT_X_URL = "{website}";\n'
        f'const OPENBOT_REPOSITORY_URL = "{website}";\n'
        f'const OPENBOT_PRODUCT_HUNT_URL = "{website}";',
    )
    replace(meta, 'export const OPENBOT_SOCIAL_IMAGE_ALT = "Meet OpenBot on a dark grid background";', f'export const OPENBOT_SOCIAL_IMAGE_ALT = "HXBot {NAME}";')
    replace(meta, '  { property: "og:image:width", content: "1600" },\n  { property: "og:image:height", content: "900" },',
            '  { property: "og:image:width", content: "512" },\n  { property: "og:image:height", content: "512" },')
    for path, old in (
        ("apps/auth-api/src/routes/v1/contact.ts", '"Open the contact form on openbot.run."'),
        ("apps/auth-api/src/routes/v1/sites/reports.ts", '"Open the report form on openbot.run."'),
        ("apps/auth-api/src/server/email-templates.ts", "`Sent from the contact form on openbot.run. Reply"),
    ):
        replace(path, old, old.replace("openbot.run", D["site"]))
    replace("apps/auth-api/src/lib/contact.ts", 'export const CONTACT_EMAIL = "hello@openbot.run";', f'export const CONTACT_EMAIL = "{ACCESS_EMAIL}";')
    replace(
        "apps/auth-api/src/server/latest-download.ts",
        'const RELEASES_BASE_URL = "https://github.com/nightly-labs/openbot/releases";',
        "// HXBot: never OpenBot's releases. This address never resolves, so a download falls back to the portal.\n"
        'const RELEASES_BASE_URL = "https://release-feed.invalid";',
    )
    replace("apps/auth-api/src/server/avatar-storage.ts", 'new URL(avatarUrl, "https://api.openbot.run")', f'new URL(avatarUrl, "{API}")')
    rewrite("apps/auth-api/src/routes/[.]well-known/apple-app-site-association.ts", 'appID: "ZTRDTUL87R.app.openbot.desktop"',
            AASA_ROUTE.replace("__BUNDLE_ID__", r.APP_ID))
    rewrite("apps/auth-api/src/components/landing/NotFoundPage.tsx", 'import { LandingFooter } from "./LandingFooter";', NOT_FOUND_PAGE)
    # ------------------------------------------------ 界面文字（15 种语言）里的上游地址与账号名
    messages = r.ROOT / "packages/i18n/src/messages"
    texts = (
        ("github.com/nightly-labs/openbot/releases", D["site"]),
        ("licenses@openbot.run", ACCESS_EMAIL),
    )
    for file in sorted(messages.rglob("*.ts")):
        rel = file.relative_to(r.ROOT).as_posix()
        text = read(rel)
        result = text
        for old, new in texts:
            result = result.replace(old, new)
        # 帮助菜单：中英文改成 HXBot 的四项；其他语言的译文在 hx/translations.py（由最后的步骤写入），没有译文的删掉旧文字，回落到英文
        language = file.relative_to(messages).parts[0]
        for key, zh, en in (
            ("app.help.guides", "使用指南", "Guide"),
            ("app.help.discord", "服务端", "Server"),
            ("app.help.changelog", "下载最新版本", "Download the latest version"),
            ("settings.mobileConnect.qr.appStore", "打开 HXBot 下载页", "Opens the HXBot download page"),
            ("settings.mobileConnect.qr.playStore", "打开 HXBot 下载页", "Opens the HXBot download page"),
            ("settings.mobileConnect.iosApp.qrLabel", "下载页二维码", "Download page QR code"),
            ("settings.mobileConnect.androidApp.qrLabel", "下载页二维码", "Download page QR code"),
        ):
            line = re.compile(r'  "' + re.escape(key) + r'":\s*"(?:[^"\\]|\\.)*",\n')
            if language in ("zh", "en"):
                result = line.sub(lambda _m, k=key, v=(zh if language == "zh" else en): f'  "{k}": "{v}",\n', result)
            elif not translations.has(key, language):
                result = line.sub("", result)
        result = SITE_WORD.sub(NAME, result)
        # 句首（日语、韩语）和希伯来语前缀 ב- 后面的 openbot.site 也是文字，同样换成产品名
        result = I18N_SITE.sub(NAME, result)
        # 网站页脚的版权行：上游公司名换成弘犀智能（源码版权与许可见 LICENSE、NOTICE，不动）
        result = result.replace("Synthetify Labs", r.BRAND["company"] if language == "zh" else r.BRAND["companyEn"])
        # 带连字符的写法：德语、荷兰语复合词 OpenBot-Version → HXBot-Version（v1.6.4 前误写成带连字符的旧写法）；
        # 希伯来语前缀 ב-OpenBot → ב-HXBot
        result = I18N_COMPOUND.sub(NAME, result)
        result = I18N_HEBREW.sub(NAME, result)
        result = I18N_AFTER_ESCAPE.sub(NAME, result)  # 字符串里 “\n\nOpenBot …”
        # 波兰语的词形变化
        for old, new in (("OpenBota", "HXBota"), ("OpenBotowi", "HXBotowi"), ("OpenBotem", "HXBotem"), ("OpenBocie", "HXBocie")):
            result = re.sub(rf"(?<![A-Za-z]){old}(?![A-Za-z])", new, result)
        # 工作流的 GitHub 触发条件写着上游 GitHub 应用的账号 @openbotgit：中英文改成中性说法，其他语言用 hx/translations.py 的译文
        for key, zh, en in (
            ("workflow.github.event.mention", "提及 GitHub 应用", "Mention of the GitHub app"),
            ("workflow.github.event.assigned", "分配给 GitHub 应用", "Assigned to the GitHub app"),
            ("mobile.workflow.github.event.mention", "提及 GitHub 应用", "Mention of the GitHub app"),
            ("mobile.workflow.github.event.assigned", "分配给 GitHub 应用", "Assigned to the GitHub app"),
        ):
            line = re.compile(r'  "' + re.escape(key) + r'":\s*"(?:[^"\\]|\\.)*",\n')
            if language in ("zh", "en"):
                result = line.sub(lambda _m, k=key, v=(zh if language == "zh" else en): f'  "{k}": "{v}",\n', result)
            elif not translations.has(key, language):
                result = line.sub("", result)
        # Slack / Discord 里提及机器人的名字（研究版的机器人由 弘犀智能 自己创建，叫 HXBot）
        result = re.sub(r"@OpenBot(?![A-Za-z0-9_])", f"@{NAME}", result)
        if result != text:
            write(rel, result)

    prose_names(r)

    handler = "apps/auth-api/src/server/worker-handler.ts"
    # 新导入按字母顺序放在 hx-forwarded 之后（Biome 整理 import 时不会再挪动它）
    replace(handler, 'import { hxForwardedRequest } from "./hx-forwarded";\n', 'import { hxForwardedRequest } from "./hx-forwarded";\nimport { hxResearchPageRedirect } from "./hx-pages";\n')
    replace(
        handler,
        "      const hostRedirect = canonicalHostRedirect(request);\n      if (hostRedirect) return hostRedirect;\n",
        "      const hostRedirect = canonicalHostRedirect(request);\n      if (hostRedirect) return hostRedirect;\n"
        "      const researchPage = hxResearchPageRedirect(request);\n      if (researchPage) return researchPage;\n",
    )


# ---------------------------------------------------------------- 产品名：运行代码里的 “OpenBot” 文字
# 只换作为文字的 OpenBot（报错、提示、发给 AI 模型的说明、日志、权限说明），不换标识：
#   前面是字母数字 . @ / \ ~ $ - 的不换（X-OpenBot-…、~/OpenBot、createOpenBotLogger）
#   后面是字母数字 / \ - 或 “.字母” 的不换（OpenBot-Signature 等协议头、OpenBot/版本、OpenBot.app）
#   整个字符串只有 "OpenBot" 的不换（数据目录名 ~/OpenBot、路径片段），需要换的逐个列在 close_upstream() 里
PROSE = re.compile(
    r"(?<![A-Za-z0-9_.@/\\~$-])(?:(?<=[\"'`])OpenBot(?![\"'`])|(?<![\"'`])OpenBot)"
    r"(?![A-Za-z0-9_/\\-]|\.[A-Za-z]| Shared\b| shared (?:directory|folder))"  # ~/OpenBot/Shared 是磁盘上真实的文件夹名
)
# openbot.site 作为文字出现时（审批对话框、设置说明、技能说明）；代码里校验域名的 “.openbot.site” 不动
SITE_WORD = re.compile(r"(?<=\s)openbot\.site(?![A-Za-z0-9])")  # 也包括德语、荷兰语的 “openbot.site-Adresse”
I18N_SITE = re.compile(r'(?<=: ")openbot\.site(?![A-Za-z0-9])|(?<=[\u0590-\u05FF]-)openbot\.site(?![A-Za-z0-9])')
MENTION = re.compile(r"@OpenBot(?![A-Za-z0-9_])")  # Slack / Discord 里提及机器人
# 界面文字（15 种语言）里带连字符的写法；“X-OpenBot-…” 是协议头，前面是 X- 不换
I18N_COMPOUND = re.compile(r"(?<![A-Za-z0-9_.@/\\~$-])OpenBot(?=-[A-Za-zÀ-ÿ])")
I18N_HEBREW = re.compile(r"(?<=[\u0590-\u05FF]-)OpenBot(?![A-Za-z0-9_/\\-])")
I18N_AFTER_ESCAPE = re.compile(r"(?<=\\n)OpenBot(?![A-Za-z0-9_/\\-])")
# 界面文字的值里不允许再出现的写法（键名里的 OpenBot 是代码标识，不算）
I18N_LEAK = re.compile(r"OpenBot|OpenBo(?:ta|tem|towi|cie)\b|@openbotgit")
PROSE_DIRS = (
    "src/backend", "src/main", "src/renderer/src", "src/preload",
    "packages/ui/src", "packages/contracts/src", "packages/team-client/src", "packages/user-errors/src", "packages/brand/src",
    "apps/mobile/src", "remote/api/src",
    "apps/auth-api/src/server", "apps/auth-api/src/routes/v1", "apps/auth-api/src/routes/v2", "apps/auth-api/src/routes/api",
    "apps/auth-api/src/routes/billing", "apps/auth-api/src/routes/slack", "apps/auth-api/src/routes/discord",
    "apps/auth-api/src/routes/oauth", "apps/auth-api/src/routes/health", "apps/auth-api/src/routes/scim",
    "apps/auth-api/src/routes/[.]well-known",
    "resources/managed-skills", "resources/cli", "resources/plugin-catalog",
)
PROSE_FILES = (
    "apps/mobile/app.json",
    "apps/auth-api/src/lib/site-metadata.ts",
    "apps/auth-api/src/lib/site-page-head.ts",
    "apps/auth-api/src/lib/plugin-catalog.generated.ts",
    # 网页版的统计模块会把这两页的标题打进下发给浏览器的脚本
    "apps/auth-api/src/lib/privacy-policy.ts",
    "apps/auth-api/src/lib/dpa.ts",
    "apps/auth-api/src/lib/analytics.ts",
    "apps/auth-api/src/routes/guides/$slug.tsx",
)
# 导入向导的提示语与随包的导出技能（resources/agent-import）逐字对应，不能单边改
PROSE_SKIP = {"packages/contracts/src/ipc-agent-import.ts"}
PROSE_SUFFIXES = (".ts", ".tsx", ".mjs", ".md", ".json")


def code_lines(text: str, rel: str):
    """逐行给出 (行, 是否注释)。.md、.json 没有注释。"""
    in_comment = False
    comments = rel.endswith((".ts", ".tsx", ".mjs"))
    for line in text.split("\n"):
        stripped = line.strip()
        if not comments:
            yield line, False
            continue
        if in_comment:
            in_comment = "*/" not in stripped
            yield line, True
            continue
        if stripped.startswith("/*"):
            in_comment = "*/" not in stripped
            yield line, True
            continue
        yield line, stripped.startswith(("//", "*"))


COMPANY_EN = "HX AI"  # 上游公司名 Synthetify Labs 在文字里换成它（与 hx/brand.json 的 companyEn 一致）


def prose_line(item, name: str) -> str:
    line, comment = item
    # 注释不改；已经带 “HXBot” 的行是前面各步改过的，不再动（重放时它们才认得出已改过）
    if comment or "HXBot" in line:
        return line
    line = line.replace("Synthetify Labs", COMPANY_EN)
    return SITE_WORD.sub(name, PROSE.sub(name, MENTION.sub(f"@{name}", line)))


JSX_COMMENT = re.compile(r"\{/\*.*?\*/\}")
TRAILING_COMMENT = re.compile(r"\s//\s.*$")


def prose_leaks(r) -> list[str]:
    """运行代码里（注释除外）还作为文字出现的 “OpenBot”。"""
    found = []
    files = []
    for item in PROSE_DIRS:
        files.extend(p for p in (r.ROOT / item).rglob("*") if p.is_file() and p.suffix in PROSE_SUFFIXES)
    # 宣传页已被最后一步删掉、文件已改名的，按改名后的路径找；找不到的跳过
    files.extend(r.ROOT / r.actual(item) for item in PROSE_FILES if (r.ROOT / r.actual(item)).exists())
    for path in sorted((r.ROOT / "packages/i18n/src/messages").rglob("*.ts")):
        rel = path.relative_to(r.ROOT).as_posix()
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if line.strip().startswith("//"):
                continue
            value = re.sub(r'^\s*"[^"]*":', "", line)  # 去掉键名
            if I18N_LEAK.search(value):
                found.append(f"{rel}:{number}: {line.strip()[:140]}")
    for path in sorted(set(files)):
        rel = path.relative_to(r.ROOT).as_posix()
        if rel in PROSE_SKIP or SKIP_PATH.search("/" + rel):
            continue
        for number, (line, comment) in enumerate(code_lines(path.read_text(encoding="utf-8"), rel), 1):
            if comment:
                continue
            # 去掉 JSX 注释 {/* … */} 和行尾注释 “ // …”（网址里的 :// 前面不是空白，不受影响）
            code = TRAILING_COMMENT.sub("", JSX_COMMENT.sub("", line))
            if PROSE.search(code) or MENTION.search(code) or SITE_WORD.search(code):
                found.append(f"{rel}:{number}: {line.strip()[:140]}")
    return found


def prose_names(r) -> None:
    NAME, read, write, replace = r.NAME, r.read, r.write, r.replace
    files = []
    for item in PROSE_DIRS:
        files.extend(p for p in (r.ROOT / item).rglob("*") if p.is_file() and p.suffix in PROSE_SUFFIXES)
    # 宣传页已被最后一步删掉、文件已改名的，按改名后的路径找；找不到的跳过
    files.extend(r.ROOT / r.actual(item) for item in PROSE_FILES if (r.ROOT / r.actual(item)).exists())
    for path in sorted(set(files)):
        rel = path.relative_to(r.ROOT).as_posix()
        if rel in PROSE_SKIP or SKIP_PATH.search("/" + rel):
            continue
        text = read(rel)
        # split("\n") 保留末尾的空串，join 回去时结尾换行与原文完全相同
        result = "\n".join(prose_line(line, NAME) for line in code_lines(text, rel))
        if result != text:
            write(rel, result)
    # 整个字符串就是 “OpenBot”、但用户或别的软件看得到的名字
    for path, old, new in (
        ("src/backend/acp-client.ts", 'title: "OpenBot"', f'title: "{NAME}"'),
        ("src/backend/acp-sign-in.ts", 'title: "OpenBot"', f'title: "{NAME}"'),
        ("src/backend/acp-flavor-antigravity.ts", 'title: "OpenBot"', f'title: "{NAME}"'),
        ("src/backend/agent/codex-login.ts", 'title: "OpenBot"', f'title: "{NAME}"'),
        ("src/backend/agent/provider-runtime.ts", 'title: "OpenBot"', f'title: "{NAME}"'),
        ("src/backend/claude-client.ts", 'const CLAUDE_SESSION_TITLE = "OpenBot";', f'const CLAUDE_SESSION_TITLE = "{NAME}";'),
        ("src/backend/messaging/whatsapp/whatsapp-session.ts", '#browserName = "OpenBot";', f'#browserName = "{NAME}";'),
        ("src/backend/messaging/whatsapp/whatsapp-session.ts", '? "Chrome" : "OpenBot";', f'? "Chrome" : "{NAME}";'),
        ("src/backend/messaging/slack/slack-driver.ts", 'if (message.user === this.#botUserId) return "OpenBot";', f'if (message.user === this.#botUserId) return "{NAME}";'),
        ("src/backend/messaging/messaging-service.ts", ': "OpenBot" })', f': "{NAME}" }})'),
        ("apps/auth-api/src/server/live-activity-relay.ts", 'const NOTIFICATION_TITLE = "OpenBot";', f'const NOTIFICATION_TITLE = "{NAME}";'),
        ("apps/auth-api/src/server/github-installation-tokens.ts", '"User-Agent": "OpenBot",', '"User-Agent": "HXBot",'),
        ("apps/auth-api/src/lib/site-metadata.ts", '{ name: "application-name", content: "OpenBot" },', f'{{ name: "application-name", content: "{NAME}" }},'),
    ):
        replace(path, old, new)
    r.regex("apps/auth-api/src/lib/site-metadata.ts", r'(?m)^(\s+)name: "OpenBot",$', f'\\1name: "{NAME}",')
    # 本地脚本命令行：应用数据目录随 app.setName 是 “HXBot”，命令行要到同一个目录找应用
    replace("resources/cli/openbot-cli.mjs", '"OpenBot", "automation"', f'"{NAME}", "automation"', count=3)


# 运行代码中不允许出现的上游地址（注释行除外）
LEAK = re.compile(
    r"openbot\.run|nightly-labs/openbot|discord\.openbot|x\.com/(?:OpenBot_|norbertbodziony|intent/post\?text=Feedback)"
    r"|@OpenBot_|norbertbodziony|Bodziony|Nightly Labs|run\.openbot\.mobile|ZTRDTUL87R|8A47NKRZSJ|Iv23lik5pzHz70cb0RUL|Synthetify"
    r"|(?<=\s)openbot\.site(?![A-Za-z0-9])"
)
# 扫描范围：三个客户端与服务器的运行代码。账号服务里上游官网的页面（营销、下载、价格、指南、法律文本）
# 由 hx-pages.ts 和 nginx 整体挡住，不在扫描范围内。
SCAN_ROOTS = (
    "src", "packages", "remote/api/src", "build", "electron-builder.yml", "package.json",
    # 安卓、iOS：界面代码、Expo 配置、原生模块（Swift、Kotlin）、iOS 扩展、上架脚本
    "apps/mobile/src", "apps/mobile/app.json", "apps/mobile/app.config.js", "apps/mobile/eas.json",
    "apps/mobile/modules", "apps/mobile/plugins", "apps/mobile/fastlane",
    "resources",
)
SCAN_AUTH_API = (
    # 账号服务对外开放的全部地址（与 hx-pages.ts、nginx 的放行列表一致）及其服务端代码
    "apps/auth-api/src/server",
    "apps/auth-api/src/routes/__root.tsx",
    "apps/auth-api/src/routes/app.tsx",
    "apps/auth-api/src/routes/app.lazy.tsx",
    "apps/auth-api/src/routes/join.tsx",
    "apps/auth-api/src/routes/api",
    "apps/auth-api/src/routes/v1",
    "apps/auth-api/src/routes/v2",
    "apps/auth-api/src/routes/oauth",
    "apps/auth-api/src/routes/health",
    "apps/auth-api/src/routes/scim",
    "apps/auth-api/src/routes/slack",
    "apps/auth-api/src/routes/discord",
    "apps/auth-api/src/routes/billing",
    "apps/auth-api/src/routes/plugins/icon",
    "apps/auth-api/src/routes/[.]well-known",
    "apps/auth-api/src/components/email",
    "apps/auth-api/src/components/ui",
    # 被网页版脚本一起下发的模块（见 hx/docs 的核查记录）
    "apps/auth-api/src/lib/analytics.ts",
    "apps/auth-api/src/lib/privacy-policy.ts",
    "apps/auth-api/src/lib/dpa.ts",
    "apps/auth-api/src/routes/guides/$slug.tsx",
    "apps/auth-api/src/lib/landing-links.ts",
    "apps/auth-api/src/lib/site-metadata.ts",
    "apps/auth-api/src/lib/site-page-head.ts",
    "apps/auth-api/src/lib/contact.ts",
    "apps/auth-api/src/components/landing/NotFoundPage.tsx",
    "apps/auth-api/src/components/landing/PageError.tsx",
    "apps/auth-api/src/components/transactional",
)
SKIP_PATH = re.compile(r"\.test\.|\.spec\.|e2e|__tests__|/tests?/|fixtures|\.stories\.|/stories/|/preview/|/mock|storybook|/node_modules/|/dist/")
# 留下的上游字样：只是判断条件或不可达，不会通往上游
ALLOWED: tuple[tuple[str, str], ...] = ()  # 运行代码里不放行任何上游地址
SUFFIXES = (".ts", ".tsx", ".js", ".mjs", ".json", ".html", ".plist", ".yml", ".md", ".swift", ".kt", ".java",
            ".xml", ".gradle", ".podspec", ".entitlements", ".rb", ".nsh", ".sh", ".apparmor", ".desktop", "")
# 安卓原生模块的 Kotlin 包名、Gradle 命名空间、清单里的类名、快捷方式动作名：只是内部代码命名，不联网、用户看不到
ALLOWED_LINE = re.compile(
    r"^\s*(?:package|import) run\.openbot\.|namespace \"run\.openbot\.|group = 'run\.openbot\.|android:name=\"run\.openbot\."
    r"|\"run\.openbot\.mobile\.QUICK_ACTION"
)


def leak_scan(r) -> list[str]:
    root = r.ROOT
    files: list = []
    for item in SCAN_ROOTS + SCAN_AUTH_API:
        path = root / item
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            files.extend(p for p in path.rglob("*") if p.is_file() and p.suffix in SUFFIXES)
    found: list[str] = []
    for path in sorted(set(files)):
        rel = path.relative_to(root).as_posix()
        if SKIP_PATH.search("/" + rel) or rel.startswith("packages/i18n/") and "/messages/" not in rel:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        in_comment = False  # 在 /* … */ 块注释里
        for number, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if in_comment:
                if "*/" in stripped:
                    in_comment = False
                continue
            if stripped.startswith("/*"):
                in_comment = "*/" not in stripped
                continue
            if not LEAK.search(line):
                continue
            if stripped.startswith(("//", "*", "#", "<!--")):
                continue
            if any(rel == file and needle in line for file, needle in ALLOWED) or ALLOWED_LINE.search(line):
                continue
            found.append(f"{rel}:{number}: {stripped[:140]}")
    return found
