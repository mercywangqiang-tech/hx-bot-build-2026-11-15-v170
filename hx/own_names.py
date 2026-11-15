"""HXBot 自己的名称和入口：系统里登记的链接方式、发给其他服务的名称、用到上游账号的第三方接入。

close_upstream.py 封堵的是“通往 OpenBot 的地址”。这里处理的是另一类：地址已经是弘犀自己的，但名字还是
OpenBot 的，或者接入用的是 OpenBot 在第三方那里登记的身份：

1. 链接方式（URL scheme）：应用在操作系统里登记的是 openbot://。同一台电脑或手机上如果还装着 OpenBot，
   邀请页上的“打开应用”可能把人带到 OpenBot 去。改为登记 hxbot://，页面和应用生成的链接都用 hxbot://；
   粘贴进来或扫码得到的旧链接（openbot://，旧版客户端生成的）仍然能读，但系统不再把 openbot:// 交给 HXBot。
2. 发给其他服务的名称：访问 GitHub 等用的 User-Agent、日历订阅里的产品名、导出文件里的应用名、
   本地代理的提示名，都改成 HXBot。
3. Webhook 的请求头：界面示例和智能体说明里是 X-OpenBot-*，改为 X-HXBot-*；信令服务两种都接受，
   旧版时配置好的发送方不用改。
4. Link 钱包：登录用的是 OpenBot 在 Link 登记的客户端，授权页显示的也是它的名字。研究版不提供这一项。
5. 从 Hermes、Grok Bot 导入智能体：要用户照着说的那句话、技能文件夹和导出压缩包的名字，改成 HXBot / hxbot-export。

应用内部才用的名字（代码包名、内部协议 openbot-app:// 等、本地存储的键、环境变量、数据文件夹）不在这里改：
它们不联网、不在系统里登记，改名会让已安装的版本读不到原来的数据。
"""

import re

# 独立的 openbot://（不含应用内部的 openbot-app://、openbot-visual:// 等）
BARE_SCHEME = re.compile(r"(?<![A-Za-z0-9-])openbot://")
# 改完后运行代码里不应再出现的写法
NAME_LEAK = re.compile(
    r"(?<![A-Za-z0-9-])openbot://"
    r'|"User-Agent": "OpenBot'
    r"|X-OpenBot-(?:Timestamp|Delivery-Id|Signature)"
    r'|LINK_CLIENT_HINT = "OpenBot"'
    r"|x-scheme-handler/openbot"
    r'|"scheme": "openbot"'
    r'|setAsDefaultProtocolClient\("openbot"\)'
    r"|PRODID:-//OpenBot"
    r'|realm="OpenBot"'
    r"|openbot-export"
    r'|for OpenBot"|"OpenBot export"'
)
# 说明和注释里写到的 Webhook 请求头名称
WEBHOOK_HEADER_NAME = re.compile(r"X-OpenBot-(Timestamp|Delivery-Id|Signature)")
INSTALLER_MARK = "; HXBot: earlier builds wrote the upstream key."


def runtime_files(r, close_upstream):
    """三个客户端和服务器的运行代码（与 close_upstream.leak_scan 的范围相同）。"""
    files = []
    for item in close_upstream.SCAN_ROOTS + close_upstream.SCAN_AUTH_API:
        path = r.ROOT / item
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            files.extend(p for p in path.rglob("*") if p.is_file() and p.suffix in close_upstream.SUFFIXES)
    result = []
    for path in sorted(set(files)):
        rel = str(path.relative_to(r.ROOT))
        if close_upstream.SKIP_PATH.search("/" + rel) or rel.startswith("packages/i18n/") and "/messages/" not in rel:
            continue
        result.append(rel)
    return result


def link_scheme(r, close_upstream) -> None:
    replace = r.replace
    both = '(url.protocol === "hxbot:" || url.protocol === "openbot:")'
    neither = 'url.protocol !== "hxbot:" && url.protocol !== "openbot:"'

    # ---- 读链接：新旧两种写法都认 ----
    router = "src/main/deep-link-router.ts"
    replace(router, '  if (url.protocol !== "openbot:") return null;', f"  if ({neither}) return null;")
    replace(router, '  if (url.protocol !== "openbot:" || url.hostname !== MCP_OAUTH_HOST) return null;',
            f"  if (({neither}) || url.hostname !== MCP_OAUTH_HOST) return null;")
    replace("packages/contracts/src/invite-links.ts",
            '    url.protocol === "openbot:" && url.hostname === "join" && (url.pathname === "" || url.pathname === "/");\n',
            f'    {both} &&\n    url.hostname === "join" &&\n    (url.pathname === "" || url.pathname === "/");\n')
    for path in ("agent-template-links.ts", "marketplace-links.ts", "plugin-links.ts"):
        replace(f"packages/contracts/src/{path}", '  const customScheme = url.protocol === "openbot:" && ',
                f"  const customScheme =\n    {both} && ")
    connect = "packages/contracts/src/mobile-connect.ts"
    replace(connect, 'const MOBILE_CONNECT_PROTOCOL = "openbot:";\n',
            'const MOBILE_CONNECT_PROTOCOL = "hxbot:";\n'
            "// HXBot: a code that an earlier build made still names the old scheme, so reading takes both.\n"
            'const MOBILE_CONNECT_EARLIER_PROTOCOL = "openbot:";\n')
    replace(connect, "      url.protocol !== MOBILE_CONNECT_PROTOCOL ||\n",
            "      (url.protocol !== MOBILE_CONNECT_PROTOCOL && url.protocol !== MOBILE_CONNECT_EARLIER_PROTOCOL) ||\n")
    # 改成 hxbot:// 后这一句短了两个字符，格式化工具会把两行并成一行，这里直接写成并好的样子
    replace("apps/mobile/src/features/auth/api/mobile-auth.ts",
            '    parseMobileConnectUrl(`openbot://mobile-connect?api=${encodeURIComponent(value)}&ticket=${"x".repeat(32)}`)\n'
            "      ?.apiUrl ?? null\n",
            '    parseMobileConnectUrl(`hxbot://mobile-connect?api=${encodeURIComponent(value)}&ticket=${"x".repeat(32)}`)?.apiUrl ??\n'
            "    null\n")
    incoming = "apps/mobile/src/features/links/model/incoming-links.ts"
    replace(incoming, '    if (url.protocol !== "openbot:") return false;', f"    if ({neither}) return false;")
    replace(incoming, '  if (path === "openbot://" || path === "openbot:///" || path === "openbot:") return initial ? "/" : null;',
            '  if (/^(?:hxbot|openbot):(?:\\/\\/\\/?)?$/u.test(path)) return initial ? "/" : null;')

    # ---- 在系统里登记 hxbot，不再登记 openbot ----
    replace("src/main/index.ts", '    if (!app.setAsDefaultProtocolClient("openbot")) {\n',
            "    // HXBot: earlier builds took the upstream scheme. Hand it back, so those links never open HXBot.\n"
            '    app.removeAsDefaultProtocolClient("openbot");\n'
            '    if (!app.setAsDefaultProtocolClient("hxbot")) {\n')
    replace("src/main/linux-desktop-entry.ts", '"MimeType=x-scheme-handler/openbot;",', '"MimeType=x-scheme-handler/hxbot;",')
    replace("electron-builder.yml", "    schemes:\n      - openbot\n", "    schemes:\n      - hxbot\n")
    replace("apps/mobile/app.json", '"scheme": "openbot",', '"scheme": "hxbot",')
    installer = "build/installer.nsh"
    text = r.read(installer)
    if INSTALLER_MARK not in text:
        key = r"Software\Classes\openbot"
        first = f'  WriteRegStr SHCTX "{key}" "" "URL:'
        if text.count(key) != 6 or text.count(first) != 1:
            r.errors.append(f"{installer}: expected 6 uses of the scheme key and one install line, found {text.count(key)} and {text.count(first)}")
        else:
            text = text.replace(key, r"Software\Classes\hxbot")
            first = first.replace("openbot", "hxbot")
            cleanup = (
                f"  {INSTALLER_MARK.strip()} Remove it when it still opens this copy; another program may own it.\n"
                "  Push $0\n"
                f'  ReadRegStr $0 SHCTX "{key}\\shell\\open\\command" ""\n'
                "  ${if} $0 == '\"$appExe\" \"%1\"'\n"
                f'    DeleteRegKey SHCTX "{key}"\n'
                "  ${endIf}\n"
                "  Pop $0\n"
            )
            r.write(installer, text.replace(first, cleanup + first))

    # ---- 生成的链接、页面上的按钮、说明文字：一律 hxbot://；写到 Webhook 请求头的地方一律 X-HXBot-* ----
    for rel in runtime_files(r, close_upstream):
        path = r.ROOT / rel
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        changed = WEBHOOK_HEADER_NAME.sub(r"X-HXBot-\1", BARE_SCHEME.sub("hxbot://", text))
        if changed != text:
            r.write(rel, changed)


def names_for_other_services(r) -> None:
    replace = r.replace
    replace("src/main/github-rest.ts", '"User-Agent": "OpenBot",', '"User-Agent": "HXBot",')
    replace("src/main/github-connector-service.ts", '"User-Agent": "OpenBot",', '"User-Agent": "HXBot",')
    replace("src/main/provider-runtime-manager.ts", '"User-Agent": "OpenBot-runtime-installer"', '"User-Agent": "HXBot-runtime-installer"', count=2)
    replace("src/main/routine-feed-ics.ts", '"PRODID:-//OpenBot//Routines//EN",', '"PRODID:-//HXBot//Routines//EN",')
    replace("src/main/maintenance-service.ts", 'application: { name: "OpenBot", version: app.getVersion() },',
            'application: { name: "HXBot", version: app.getVersion() },')
    replace("src/backend/browser-profiles/browser-proxy-relay.ts", 'Proxy-Authenticate: Basic realm="OpenBot"', 'Proxy-Authenticate: Basic realm="HXBot"')


def webhook_headers(r) -> None:
    replace = r.replace
    route = "packages/contracts/src/signal-protocol/webhook-route.ts"
    replace(route,
            'export const WEBHOOK_TIMESTAMP_HEADER = "x-openbot-timestamp";\n'
            'export const WEBHOOK_DELIVERY_ID_HEADER = "x-openbot-delivery-id";\n'
            'export const WEBHOOK_SIGNATURE_HEADER = "x-openbot-signature";\n',
            'export const WEBHOOK_TIMESTAMP_HEADER = "x-hxbot-timestamp";\n'
            'export const WEBHOOK_DELIVERY_ID_HEADER = "x-hxbot-delivery-id";\n'
            'export const WEBHOOK_SIGNATURE_HEADER = "x-hxbot-signature";\n'
            "// HXBot: a sender that was set up with an earlier build still sends these names. Signal reads both sets.\n"
            "export const WEBHOOK_EARLIER_HEADERS = {\n"
            '  timestamp: "x-openbot-timestamp",\n'
            '  deliveryId: "x-openbot-delivery-id",\n'
            '  signature: "x-openbot-signature",\n'
            "} as const;\n")
    app = "remote/api/src/app.ts"
    replace(app, "  WEBHOOK_DELIVERY_ID_PATTERN,\n", "  WEBHOOK_DELIVERY_ID_PATTERN,\n  WEBHOOK_EARLIER_HEADERS,\n")
    replace(app,
            "    signature: WEBHOOK_SIGNATURE_HEADER,\n    pattern: WEBHOOK_SIGNATURE_PATTERN,\n  },\n",
            "    signature: WEBHOOK_SIGNATURE_HEADER,\n    pattern: WEBHOOK_SIGNATURE_PATTERN,\n  },\n"
            "  { ...WEBHOOK_EARLIER_HEADERS, pattern: WEBHOOK_SIGNATURE_PATTERN },\n")
    trigger = "packages/ui/src/features/conversation/RoutineWebhookTrigger.tsx"
    for name in ("Timestamp", "Delivery-Id", "Signature"):
        replace(trigger, f'-H "X-OpenBot-{name}: ', f'-H "X-HXBot-{name}: ')


def link_wallet(r) -> None:
    replace = r.replace
    replace("src/main/link-auth.ts", 'const LINK_CLIENT_HINT = "OpenBot";', 'const LINK_CLIENT_HINT = "HXBot";')
    store = "src/renderer/src/features/vault/stores/link-account-store.ts"
    replace(store, "\n/**\n * The Link account of this computer, for the Vault page.",
            "\n/**\n * HXBot: Link sign-in runs on the registration that the upstream project holds at Link, and Link's\n"
            " * approval page names that project. HXBot has no registration of its own, so the Vault page does not\n"
            " * offer the Link wallet.\n */\n"
            "export const HX_LINK_WALLET_OFFERED: boolean = false;\n"
            "\n/**\n * The Link account of this computer, for the Vault page.")
    overlays = "src/renderer/src/WorkspaceOverlays.tsx"
    replace(overlays, 'import { createLinkAccountStore } from "./features/vault/stores/link-account-store";',
            'import { createLinkAccountStore, HX_LINK_WALLET_OFFERED } from "./features/vault/stores/link-account-store";')
    replace(overlays, "      link: local ? createLinkAccountStore() : undefined,",
            "      link: local && HX_LINK_WALLET_OFFERED ? createLinkAccountStore() : undefined,")


def agent_import_names(r, close_upstream) -> None:
    """从 Hermes、Grok Bot 导入智能体：用户要照着说的那句话、要保存的技能文件夹、导出的压缩包，名字都改成 HXBot。"""
    r.replace("packages/contracts/src/ipc-agent-import.ts", 'export const AGENT_IMPORT_PROMPT = "Export my agents for OpenBot";',
              'export const AGENT_IMPORT_PROMPT = "Export my agents for HXBot";')
    r.replace("packages/contracts/src/ipc-agent-import.ts", 'export const AGENT_IMPORT_EXPORT_AGENT_NAME = "OpenBot export";',
              'export const AGENT_IMPORT_EXPORT_AGENT_NAME = "HXBot export";')
    word = re.compile(r"(?<![A-Za-z0-9/@._-])OpenBot(?![A-Za-z0-9_-])")
    for rel in runtime_files(r, close_upstream):
        try:
            text = (r.ROOT / rel).read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        changed = text.replace("openbot-export", "hxbot-export")
        if rel.startswith("resources/agent-import/") and rel.endswith("SKILL.md"):
            changed = word.sub("HXBot", changed)
        if changed != text:
            r.write(rel, changed)


def own_names(r, close_upstream) -> None:
    link_scheme(r, close_upstream)
    agent_import_names(r, close_upstream)
    names_for_other_services(r)
    webhook_headers(r)
    link_wallet(r)


def name_leaks(r, close_upstream) -> list:
    """运行代码里还在用 OpenBot 名称登记、对外自称或展示的位置。"""
    found = []
    for rel in runtime_files(r, close_upstream):
        try:
            text = (r.ROOT / rel).read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for number, line in enumerate(text.splitlines(), 1):
            if NAME_LEAK.search(line):
                found.append(f"{rel}:{number}: {line.strip()[:140]}")
    return found
