"""把源码、配置、文档和文件名里的 OpenBot（不区分大小写）统一改成 HXBot。

由 rebrand.py 在最后一步调用（rename_all(r)，r 是 rebrand 模块本身）。改名规则：
  - 作为文字出现的 OpenBot（前后不是字母、数字、下划线）改成 HXBot；
  - 夹在路径、请求头这类技术名称里（前面是 - . / \\）改成 HXBot，例如 X-OpenBot-Remote → X-HXBot-Remote；
  - 作为标识符的一部分（OpenBotDatabase、createOpenBotLogger）改成 HxBot；
  - 其余写法按大小写对应：openbot → hxbot，OPENBOT → HXBOT，openBot → hxBot。
文件和文件夹的名字按同样的规则改。

不改的只有三类，都在下面列明：
  1. 法律文件和来源记录：LICENSE、NOTICE（许可证要求原样保留 Required Notice），以及记录上游来源的
     hx/brand.json、hx/docs/改造说明.md、hx/docs/许可与合规.md；
  2. 改造工具本身（rebrand.py 等要按上游原文查找，里面必须写着 OpenBot），以及上游已经编译好的
     远程桌面程序的构建输入（补丁和锁文件按哈希固定，改一个字就下载不到、对不上）；
  3. 兼容旧版本必须认得的旧名称（PROTECT 列表）：旧版本留在电脑和手机上的数据、还没更新的
     客户端和服务器发来的内容、远程桌面程序里编译进去的接口名。新写入的数据一律用新名称。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

WORD = re.compile(r"[Oo][Pp][Ee][Nn][Bb][Oo][Tt]")

# ---------------------------------------------------------------- 上游的域名和邮箱
# openbot.run（官网、接口、信令、托管服务器）和 openbot.site（智能体发布的静态站点）换成弘犀自己的域名，
# 不能照字面改成 hxbot.run、hxbot.site：那是别人可以注册的域名，邀请链接和站点地址的校验会认它们。
# 邮箱一律换成 brand.json 的联系邮箱。.test、.localhost、.example 是保留域名，按普通规则改。
_BRAND = json.loads((ROOT / "hx" / "brand.json").read_text(encoding="utf-8"))
_SITE_LABELS = _BRAND["domains"]["site"].split(".")
MAILBOX = re.compile(r"\b(?:licenses|hello|admin|catalog)@openbot\.run\b")
DOMAIN = re.compile(r"openbot((?:\\{1,2})?\.)(run|site)\b")


def _domain(m: re.Match[str]) -> str:
    labels = _SITE_LABELS if m.group(2) == "run" else ["sites", *_SITE_LABELS]
    return m.group(1).join(labels)


def _rename_domains(text: str) -> str:
    return DOMAIN.sub(_domain, MAILBOX.sub(_BRAND["accessEmail"], text))

# ---------------------------------------------------------------- 不改内容的文件
EXCLUDE_CONTENT = {
    "LICENSE",
    "NOTICE",
    "hx/rebrand.py",
    "hx/close_upstream.py",
    "hx/own_names.py",
    "hx/accounts.py",
    "hx/access_control.py",
    "hx/computer_control.py",  # 按上游原来的文件名和包名定位（openbot-tools.ts、@openbot/contracts）
    "hx/auto_model.py",  # 同上（v1.6.5）
    "hx/opencode_connect.py",  # 同上（v1.6.5）
    "hx/team.py",  # 同上（v1.6.6）
    "hx/computer_steps.py",  # 同上（v1.6.7）
    "hx/base_style.py",  # 定位用的是上游原来的变量名（--openbot-*、@openbot/ui）
    "hx/tests/test_base_style.py",  # 按上游的变量名读 base_style.py
    "hx/brand_rename.py",
    "hx/marketing-files.txt",  # 上游原来的文件名：改名之前按它删
    "hx/upstream_checks.py",
    "hx/v175_pairs.py",  # v1.7.5 的重放对照：按上游原来的包名和名字定位（@openbot/…）
    "hx/unused-messages.txt",  # 上游原来的键名
    "hx/brand.json",
    "hx/docs/改造说明.md",
    "hx/docs/版本记录.md",  # 记录各版本改了什么，写改名那一版时要写出旧名称
    "hx/docs/许可与合规.md",
    "native-runtime.lock.json",
    "packages/contracts/src/hx-earlier-names.ts",
    # 兼容旧版本的测试：故意写着旧名称
    "src/main/hx-earlier-names.test.ts",
    "src/renderer/src/hx-earlier-storage.dom.test.ts",
    "apps/mobile/src/shared/lib/hx-earlier-secure-store.test.ts",
}
EXCLUDE_CONTENT_PREFIXES = ("vendor/remote-desktop/patches/",)
# 不改名字的文件（锁文件按路径引用补丁）
EXCLUDE_NAME_PREFIXES = ("vendor/remote-desktop/patches/", "apps/mobile/assets/sounds/openbot-")

# ---------------------------------------------------------------- 兼容旧版本必须保留的旧名称
# (文件路径的正则，None 表示所有文件；要原样保留的文字的正则)。
PROTECT: list[tuple[str | None, str]] = [
    # 远程桌面：Sunshine 和 Moonlight Web 是按补丁编译好、按哈希固定下载的程序，这些接口名编译在程序里
    (None, r"/api/openbot/"),
    (None, r"openbot-moonlight"),
    (None, r"OPENBOT_REMOTE_SETUP"),
    (r"^scripts/build-remote-desktop-runtime\.ts$", r"openbot-setup-test|OPENBOT_SECURITY_TESTS"),
    (r"^scripts/[a-z-]*remote-desktop-runtime[a-z-]*\.ts$", r"-openbot\.patch"),
    # 客户端与主机之间的连接协议名：还没更新的桌面端、手机端、网页版只认这些名字
    (None, r"openbot-team-v\d"),
    # 客户端、主机、账号服务之间的请求头：新旧版本的桌面端、手机端和服务器互相发送，两边都只认这些名字
    (None, r"OpenBot-(?:Protocol-Version|App-Version|Capabilities|Host-Id|Host-Token|Hosting-Developer-Key|Logo-Version)\b"),
    (None, r"openbot-token\."),
    (None, r"openbot-events(?:-v2)?"),
    (None, r"openbot\.remote-desktop\.signal\.v1"),
    (None, r"openbot\.browser-egress\.v1"),
    # 桌面端注册的内部协议（openbot-app:// 等）：窗口的本地存储按协议名分开保存，主机之间也交换这些地址
    (None, r"openbot-app(?![\w-])"),
    (None, r"openbot-(?:remote-)?(?:attachment|visual|avatar|server-logo)(?![\w-])"),
    # 服务器、信令服务和主机之间签发与核对的凭据：签名用的标签和受众，已签发的凭据要继续能核对
    (None, r"openbot live activity|openbot push notification"),
    (None, r"openbot-host-key-handover-v1|openbot-discord-guild-grant-v1|openbot-slack-workspace-grant-v2"),
    (None, r"openbot-ingress-queue-v1|openbot/company-sign-in/client-secret/v1|openbot-hosted-claim"),
    (None, r"openbot-remote-resume|openbot-telegram-(?:file|upload)-token"),
    (None, r'"openbot-remote"'),
    (None, r"openbot-(?:discord|github|slack|telegram|webhook)-route"),
    # 旧版本发出的 Webhook 请求头：信令服务除了 x-hxbot-* 也接受这三个（WEBHOOK_EARLIER_HEADERS）
    (r"^packages/contracts/src/signal-protocol/webhook-route\.ts$", r"x-openbot-(?:timestamp|delivery-id|signature)"),
    # 已经发到 Slack、Discord 里的消息按钮，用户以后还会点
    (None, r"openbot_(?:accept|decline|stop)\b"),
    (r"^packages/contracts/src/signal-protocol/discord-api\.ts$", r'"openbot:"'),
    # 桌面端数据库里已有的对话编号、智能体数据库的表名、旧数据库升级时认的旧路径
    (None, r"openbot-thread-"),
    (None, r"openbot_metadata"),
    (r"^src/backend/(?:openbot|hxbot)-database-schema\.ts$", r'"OpenBot", "Bots"|openbot-avatar-seed-'),
    # 第 13 版数据库升级：只对上游早期版本留下的数据库运行，库里存的是旧文件夹名
    (r"^src/backend/(?:(?:openbot|hxbot)-database-schema|agent-workspace-root-migration\.test)\.ts$",
     r"OpenBot(?=(?:/|\\)+(?:Bots|Agents))"),
    (r"^(?:src/backend/workspace-paths\.ts|src/backend/agent/attachment-gateway\.ts"
     r"|packages/ui/src/features/conversation/MarkdownMessageText\.tsx"
     r"|apps/mobile/src/features/chat/model/message-file-target\.ts)$", r"OpenBot/(?:Agents|Bots|Shared)/"),
    # 智能体工作区里的 .openbot 文件夹（停用的技能等），以及导出、导入、迁移文件的格式名
    (r"^(?!scripts/development-secrets\.ts$|\.gitignore$|\.worktreeinclude$|apps/auth-api/README\.md$)",
     r"(?<=[/\"'`(\s])\.openbot(?=[/\"'`])(?!/dev-state)"),
    (None, r"\.?openbot-transfer\.json|openbot-instance-transfer|openbot-import\.json|openbot-agent-import\b"),
    # 第三方服务按名字识别的调用方
    (None, r'GROK_OAUTH2_REFERRER: "openbot"|CLAUDE_CODE_ENTRYPOINT: "openbot"|CLAUDE_AGENT_SDK_CLIENT_APP: "openbot/0\.1\.0"'),
    # 手机通知提示音的文件名：服务器在苹果推送里写文件名，还没更新的 iOS 应用只带着这几个文件；
    # 安卓通知渠道的编号：用户对每个渠道单独设置过的声音、免打扰，换了编号就没了
    (r"^(?:apps/mobile/|packages/contracts/src/notification-relay\.ts$)",
     r"openbot[-_](?:task|warm|mech|bubble|press)(?=\.wav|\")|openbot\.sound\."),
    # 手机通知提示音的编号：手机端和桌面端之间传递，旧版本只认这个编号
    (r"(?:notification-relay|push-notifications-v1)\.ts$", r'"openbot"(?=, "warm")'),
    (r"^apps/mobile/src/features/settings/model/push-notifications\.ts$", r'(?<=sound: )"openbot"|(?<=\?\? )"openbot"'),
    (r"^apps/mobile/src/features/settings/screens/notifications-settings-screen\.tsx$", r'(?<=value: )"openbot"'),
    (r"(?:notification-relay|android-notification-channels)\.ts$", r"(?m)(?<=^  )openbot(?=: )"),
    # 说明这两个旧值的注释（提示音编号、Claude 的调用方标签），跟着代码里保留的值写
    (r"^packages/contracts/src/notification-relay\.ts$|^src/backend/claude-client\.ts$", r"`openbot`"),
    (r"MessagingService\.kt$", r'"openbot"(?= ->)'),
    # 旧链接 openbot://（已经分享出去的邀请、模板、插件链接）：改名前就已经两种都接受
    (r"(?:invite|agent-template|marketplace|plugin)-links\.ts$|mobile-connect\.ts$|incoming-links\.ts$|deep-link-router\.ts$",
     r'"openbot:"'),
    (None, r'removeAsDefaultProtocolClient\("openbot"\)'),
    # 新旧两种名称都接受的写法：(?:hxbot|openbot) 等
    (None, r"(?<=hxbot\|)openbot\b"),
    # 服务器检查：确认 iOS 关联文件里已经没有旧应用
    (r"^hx/server/scripts/check\.sh$", r"\*openbot\*"),
    # 弘犀自己的测试：确认旧链接照样能打开、邮件里没有上游名称
    (r"^src/main/hx-link-scheme\.test\.ts$", r'"openbot:?"'),
    (r"^apps/auth-api/test/hx-accounts\.test\.ts$", r"/openbot/iu"),
    # Windows 安装程序：旧版本的数据文件夹，安装和更新时都不能动它
    (r"^build/installer\.nsh$", r"\$PROFILE\\OpenBot"),
    # Windows 安装程序：删掉旧版本登记的 openbot:// 链接协议（不能变成删新的 hxbot://）
    (r"^build/installer\.nsh$", r"Software\\Classes\\openbot"),
    # 门户和使用指南不得出现上游名称的检查；源码包里记录的上游仓库地址（许可要求说明来源）
    (r"^hx/scripts/site-pages\.mjs$", r"/openbot\|synthetify"),
    (r"^hx/scripts/package-release\.sh$", r"github\.com/nightly-labs/openbot"),
]


def protected_patterns(path: str) -> list[str]:
    return [text for pattern, text in PROTECT if pattern is None or re.search(pattern, path)]


def _word(text: str, start: int, end: int) -> str:
    word = text[start:end]
    before = text[start - 1] if start > 0 else ""
    after = text[end] if end < len(text) else ""
    if word == "OpenBot":
        if (before and (before.isalnum() or before in "_$")) or (after and (after.isalnum() or after in "_$")):
            return "HxBot"
        # 品牌统一为 HXBot（2026-11-12）：文字、应用名（HXBot.app、HXBot.exe）、路径、文件名、请求头、
        # 安装包名、User-Agent 都写 HXBot，不带空格。
        return "HXBot"
    first = "H" if word[0].isupper() else "h"
    second = "X" if word[1].isupper() else "x"
    return f"{first}{second}{word[4:]}"


def _rename_plain(text: str) -> str:
    out: list[str] = []
    last = 0
    for m in WORD.finditer(text):
        out.append(text[last : m.start()])
        out.append(_word(text, m.start(), m.end()))
        last = m.end()
    out.append(text[last:])
    return "".join(out)


# 文档里指向标题的链接（[…](文件.md#标题)）：标题里的 OpenBot 改成 “HXBot” 以后，它的锚点是 hx-bot，
# 链接里的锚点要跟着改成同一个写法，否则链接就断了（bun run check:doc-links）。
HEADING_LINK = re.compile(r"(?<=\]\()([^)\s#]*#)([^)\s]*openbot[^)\s]*)(?=\))")


def _heading_link(m: re.Match[str]) -> str:
    return m.group(1) + m.group(2).replace("openbot", "hxbot")


def renamed(text: str, path: str = "") -> str:
    """改名后的文字。path 决定哪些旧名称要原样保留。"""
    if not WORD.search(text):
        return text
    patterns = protected_patterns(path)
    keep: list[str] = []
    if patterns:
        def mask(m: re.Match[str]) -> str:
            keep.append(m.group(0))
            return f"\x00{len(keep) - 1}\x00"
        for pattern in patterns:
            text = re.sub(pattern, mask, text)
    if path.endswith((".md", ".mdx")):
        text = HEADING_LINK.sub(_heading_link, text)
    text = _rename_plain(_rename_domains(text))
    if keep:
        text = re.sub("\x00(\\d+)\x00", lambda m: keep[int(m.group(1))], text)
    return text


def renamed_path(path: str) -> str:
    if path.startswith(EXCLUDE_NAME_PREFIXES) or path in EXCLUDE_CONTENT:
        return path
    return "/".join(_rename_plain(part) for part in path.split("/"))


def content_excluded(path: str) -> bool:
    return path in EXCLUDE_CONTENT or path.startswith(EXCLUDE_CONTENT_PREFIXES)


def is_binary(data: bytes) -> bool:
    return b"\x00" in data[:8192]


def tracked_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT, capture_output=True, check=True,
    ).stdout.decode("utf-8").split("\0")
    return [p for p in out if p and (ROOT / p).is_file()]


def rename_tree(r) -> None:
    """改所有文件的内容和名字。"""
    files = tracked_files()
    for path in files:
        if content_excluded(path):
            continue
        data = (ROOT / path).read_bytes()
        if is_binary(data):
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            continue
        new = renamed(text, path)
        if new != text:
            r.write(path, new)
    moves = [(p, renamed_path(p)) for p in files if renamed_path(p) != p]
    for old, new in moves:
        if r.CHECK_ONLY:
            r.pending.append(old)
            continue
        target = ROOT / new
        if target.exists():
            r.errors.append(f"改名的目标已存在：{old} → {new}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(ROOT / old), str(target))
        r.changes.append(new)
    if not r.CHECK_ONLY:
        for old, _ in moves:
            folder = (ROOT / old).parent
            while folder != ROOT and folder.is_dir() and not any(folder.iterdir()):
                folder.rmdir()
                folder = folder.parent


def leaks() -> list[str]:
    """改名后还剩下的旧名称（不算上面列明不改的）。"""
    found = []
    for path in tracked_files():
        if renamed_path(path) != path:
            found.append(f"{path}（文件名）")
        if content_excluded(path):
            continue
        data = (ROOT / path).read_bytes()
        if is_binary(data):
            continue
        text = data.decode("utf-8", "replace")
        if renamed(text, path) != text:
            found.append(path)
    return found


# ---------------------------------------------------------------- 统一品牌名：HXBot（2026-11-12）
# 品牌统一为 HXBot 以后，界面、文档、邮件、安装包里不再写 “HX Bot” 和 “弘犀助手”。只有下面几处必须写旧名字：
# 版本记录和改造说明记录的是当时的名称；装过旧名字版本的电脑上的用户数据文件夹叫 “HX Bot”。
# “HX-Bot”（德语、荷兰语复合词）和波兰语变格“HX Bocie”也是旧写法（v1.6.4 起一并检查）
EARLIER_BRAND = re.compile(r"HX[ -]Bo(?:t|cie)|弘犀助手")
EARLIER_BRAND_ALLOWED: dict[str, re.Pattern[str] | None] = {
    "hx/docs/版本记录.md": None,
    "hx/docs/改造说明.md": None,
    "hx/brand_rename.py": None,
    "src/main/hx-earlier-data.ts": re.compile(r'HX_EARLIER_USER_DATA_FOLDER = "HX Bot"|named "HX Bot"'),
    "src/main/hx-earlier-names.test.ts": re.compile(r"named HX Bot|\.toBe\(\"HX Bot\"\)|\"HX Bot\"\)\)"),
    "build/installer.nsh": re.compile(r"\$APPDATA\\HX Bot"),
    # 升级说明：告诉用户删掉 Mac 上旧名字的应用
    "hx/docs/部署文档.md": re.compile(r"旧的“HX Bot”应用"),
    "hx/docs/部署文档.html": re.compile(r"旧的“HX Bot”应用"),
}


def earlier_brand_leaks() -> list[str]:
    """还写着旧品牌名 “HX Bot” 或 “弘犀助手” 的地方（不算上面列明的）。"""
    found = []
    for path in tracked_files():
        if not path or path.startswith(EXCLUDE_NAME_PREFIXES):
            continue
        allowed = EARLIER_BRAND_ALLOWED.get(path, False)
        if allowed is None:
            continue
        try:
            data = (ROOT / path).read_bytes()
        except (FileNotFoundError, IsADirectoryError):
            continue
        if is_binary(data) or not EARLIER_BRAND.search(data.decode("utf-8", "replace")):
            continue
        for number, line in enumerate(data.decode("utf-8", "replace").splitlines(), 1):
            if EARLIER_BRAND.search(line) and not (allowed and allowed.search(line)):
                found.append(f"{path}:{number}")
    return found


# ---------------------------------------------------------------- 改名前先接好的兼容代码
EARLIER = '@openbot/contracts/hx-earlier-names'


def add_import(r, path: str, line: str) -> None:
    """在文件开头加一行 import（已经加过就跳过）。"""
    text = r.read(path)
    if line in text or renamed(line, path) in text:
        return
    r.write(path, f"{line}\n{text}")


def prepare(r) -> None:
    """改名前的兼容接线：旧数据搬到新名字下、旧版本发来的内容照常认得。"""
    rp = r.replace
    rp("packages/contracts/package.json", '  "exports": {\n',
       '  "exports": {\n    "./hx-earlier-names": "./src/hx-earlier-names.ts",\n')

    # 数据文件夹：已有旧文件夹的电脑继续用它，新电脑用 HXBot（src/backend/hx-data-folder.ts）
    add_import(r, "src/backend/agent-store.ts", 'import { hxDataFolder } from "./hx-data-folder";')
    rp("src/backend/agent-store.ts", '    openbotRoot = join(homePath, "OpenBot"),', "    openbotRoot = hxDataFolder(homePath),")
    add_import(r, "src/main/application-services.ts", 'import { hxDataFolder } from "../backend/hx-data-folder";')
    rp("src/main/application-services.ts", 'agentRoot: join(homedir(), "OpenBot", "Servers"),',
       'agentRoot: join(hxDataFolder(homedir()), "Servers"),')
    add_import(r, "src/main/provider-runtime-manager.ts", 'import { hxDataFolder } from "../backend/hx-data-folder";')
    rp("src/main/provider-runtime-manager.ts", 'return join(input.appData, "OpenBot", "provider-runtimes");',
       'return join(hxDataFolder(input.appData), "provider-runtimes");')
    rp("src/backend/workspace-paths.ts", 'for (const prefix of ["~/OpenBot/Shared/", "OpenBot/Shared/", "Shared/"]) {',
       'for (const prefix of ["~/HXBot/Shared/", "HXBot/Shared/", "~/OpenBot/Shared/", "OpenBot/Shared/", "Shared/"]) {')
    rp("src/backend/workspace-paths.ts", "  for (const prefix of [\n    `~/OpenBot/Agents/${agentId}/`,\n",
       "  for (const prefix of [\n    `~/HXBot/Agents/${agentId}/`,\n    `HXBot/Agents/${agentId}/`,\n    `~/OpenBot/Agents/${agentId}/`,\n")
    rp("build/installer.nsh", '    !insertmacro openBotHolds ${PATH} "$PROFILE\\OpenBot" ${OUT}\n',
       '    !insertmacro openBotHolds ${PATH} "$PROFILE\\HXBot" ${OUT}\n    !insertmacro openBotHolds ${PATH} "$PROFILE\\OpenBot" ${OUT}\n')

    # userData 里旧名字的设置文件、数据库和浏览器分区（src/main/hx-earlier-data.ts），在任何模块打开它们之前
    # 排在 import "./hx-defaults" 之后；改名后 Biome 会把它挪到排好的位置，所以按这一行在不在文件里判断
    earlier_import = 'import { hxEarlierUserDataFolder, hxRenameEarlierUserData } from "./hx-earlier-data";'
    if earlier_import not in r.read("src/main/index.ts"):
        rp("src/main/index.ts", 'import "./hx-defaults";\nimport { uptime } from "node:os";\n',
           f'import "./hx-defaults";\nimport {{ uptime }} from "node:os";\n{earlier_import}\n')
    rp("src/main/index.ts", "if (hasSingleInstanceLock) {\n  startMainLog(",
       'if (hasSingleInstanceLock) {\n  if (!localServerChild) hxRenameEarlierUserData(app.getPath("userData"));\n  startMainLog(')
    # 应用名从 “HX Bot” 改成 HXBot（2026-11-12）：Electron 的用户数据文件夹跟着应用名走。装过旧名字版本的电脑
    # 继续用旧文件夹（设置、登录、保密箱的钥匙、浏览器登录都在里面），新电脑用新名字（hx-earlier-data.ts）。
    rp("src/main/index.ts", f'app.setName("{r.NAME}");',
       "// HXBot: a computer that ran a build of the earlier name keeps that user data folder (hx-earlier-data.ts).\n"
       "const hxEarlierUserData =\n"
       '  commandLineUserDataDirectory || !app.isPackaged ? null : hxEarlierUserDataFolder(app.getPath("appData"));\n'
       'if (hxEarlierUserData) app.setPath("userData", hxEarlierUserData);\n'
       f'app.setName("{r.NAME}");')
    # Windows 安装器：旧名字的用户数据文件夹 %APPDATA%\HX Bot 也不能当安装文件夹，装在里面的旧版本照样清掉
    nsh = "build/installer.nsh"
    rp(nsh, f'    !insertmacro openBotHolds ${{PATH}} "$APPDATA\\{r.NAME}" ${{OUT}}\n',
       f'    !insertmacro openBotHolds ${{PATH}} "$APPDATA\\{r.NAME}" ${{OUT}}\n'
       '    !insertmacro openBotHolds ${PATH} "$APPDATA\\HX Bot" ${OUT}\n')
    rp(nsh, f'      StrCpy $openBotDataFolderInstall "$APPDATA\\{r.NAME}"\n',
       f'      StrCpy $openBotDataFolderInstall "$APPDATA\\{r.NAME}"\n'
       '    ${elseIf} ${FileExists} "$APPDATA\\HX Bot\\${APP_EXECUTABLE_FILENAME}"\n'
       '      StrCpy $openBotDataFolderInstall "$APPDATA\\HX Bot"\n')

    # 窗口和网页版的本地存储（src/renderer/src/hx-earlier-storage.ts）：每个入口的第一个 import
    add_import(r, "src/renderer/src/index.tsx", 'import "./hx-earlier-storage";')
    add_import(r, "src/renderer/src/helper.tsx", 'import "./hx-earlier-storage";')
    add_import(r, "src/renderer/src/features/web-client/WebApp.tsx", 'import "../../hx-earlier-storage";')
    boot = "src/renderer/src/features/web-client/web-appearance-boot.ts"
    add_import(r, boot, f'import {{ hxEarlierName }} from "{EARLIER}";')
    rp(boot, "try{var a=localStorage.getItem(${JSON.stringify(WEB_APPEARANCE_STORAGE_KEY)});",
       "try{var a=localStorage.getItem(${JSON.stringify(WEB_APPEARANCE_STORAGE_KEY)})||localStorage.getItem(${JSON.stringify(hxEarlierName(WEB_APPEARANCE_STORAGE_KEY))});")

    # 手机端加密存储：读不到新键时读旧键并搬过去（apps/mobile/src/shared/lib/hx-secure-store.ts）
    for path in mobile_secure_store_files(r):
        rp(path, 'import * as SecureStore from "expo-secure-store";',
           'import * as SecureStore from "@/shared/lib/hx-secure-store";')

    # 智能体工作区里旧名字的托管技能：新技能写好后删掉旧的那份（src/main/hx-earlier-skills.ts）
    skills = "src/main/managed-skill-service.ts"
    add_import(r, skills, 'import { hxRemoveEarlierManagedSkill } from "./hx-earlier-skills";')
    rp(skills, "  const workspaceRoot = yield* managedIO(() => realpath(resolve(workspacePath)));\n"
               "  const targets = MANAGED_SKILL_FOLDERS.map(",
       "  const workspaceRoot = yield* managedIO(() => realpath(resolve(workspacePath)));\n"
       "  yield* managedIO(() =>\n"
       "    Promise.all(MANAGED_SKILL_FOLDERS.map((folder) => hxRemoveEarlierManagedSkill(join(workspaceRoot, folder), slug, OWNERSHIP_MARKER))),\n"
       "  );\n"
       "  const targets = MANAGED_SKILL_FOLDERS.map(")

    # 设置里保存的“链接打开方式”：旧版本存的是旧名字
    links = "packages/contracts/src/ipc-external-links.ts"
    add_import(r, links, 'import { hxRenamedName } from "./hx-earlier-names";')
    rp(links, '  if (value.kind === "default" || value.kind === "openbot") return { kind: value.kind };\n',
       '  if (value.kind === "default" || value.kind === "openbot") return { kind: value.kind };\n'
       '  if (typeof value.kind === "string" && hxRenamedName(value.kind) === "openbot") return { kind: "openbot" };\n')

    # 旧对话里的工具名（模型调用 HXBot 自己的工具时写的是旧名字）
    proto = "src/backend/protocol.ts"
    add_import(r, proto, f'import {{ hxRenamedName }} from "{EARLIER}";')
    rp(proto, '  const tool = getString(item, "tool") ?? getString(item, "name");\n'
              '  if (tool !== "tool_call" && tool !== "mcp__openbot__tool_call") return null;\n'
              '  const args = getRecord(item, "arguments");\n'
              '  return getString(args, "name") ?? getString(args, "tool");\n',
       '  // HXBot: a conversation of an earlier build names the tools with the earlier name.\n'
       '  const named = getString(item, "tool") ?? getString(item, "name");\n'
       '  const tool = named == null ? named : hxRenamedName(named);\n'
       '  if (tool !== "tool_call" && tool !== "mcp__openbot__tool_call") return null;\n'
       '  const args = getRecord(item, "arguments");\n'
       '  const called = getString(args, "name") ?? getString(args, "tool");\n'
       '  return called == null ? called : hxRenamedName(called);\n')
    items = "src/backend/agent/thread-items.ts"
    add_import(r, items, f'import {{ hxRenamedName }} from "{EARLIER}";')
    rp(items, 'if (item.type === "toolCall") return /^mcp__openbot__(.+)$/u.exec(getString(item, "name") ?? "")?.[1] ?? null;',
       'if (item.type === "toolCall") return /^mcp__openbot__(.+)$/u.exec(hxRenamedName(getString(item, "name") ?? ""))?.[1] ?? null;')
    rp(items, 'if (item.type === "mcpToolCall" && getString(item, "server") !== "openbot") return null;',
       'if (item.type === "mcpToolCall" && hxRenamedName(getString(item, "server") ?? "") !== "openbot") return null;')
    rp(items, 'return /^mcp__openbot_browser__(.+)$/u.exec(getString(item, "name") ?? "")?.[1] ?? null;',
       'return /^mcp__openbot_browser__(.+)$/u.exec(hxRenamedName(getString(item, "name") ?? ""))?.[1] ?? null;')
    quiet = "src/backend/agent/routine-quiet-runs.ts"
    add_import(r, quiet, f'import {{ hxRenamedName }} from "{EARLIER}";')
    rp(quiet, 'if (item.type === "toolCall") return getString(item, "name") === `mcp__openbot__${ROUTINE_NO_UPDATE_TOOL}`;',
       'if (item.type === "toolCall") return hxRenamedName(getString(item, "name") ?? "") === `mcp__openbot__${ROUTINE_NO_UPDATE_TOOL}`;')
    rp("src/backend/agent/skill-loads.ts", "const OPENBOT_SKILL_PLUGINS = /^(?:openbot|agents):/u;",
       "const OPENBOT_SKILL_PLUGINS = /^(?:hxbot|openbot|agents):/u;")
    catalog = "src/backend/agent/tool-catalog.ts"
    add_import(r, catalog, f'import {{ hxRenamedName }} from "{EARLIER}";')
    rp(catalog, '  if (name !== "mcp__openbot__tool_call") return name;',
       '  if (hxRenamedName(name) !== "mcp__openbot__tool_call") return name;')

    # Codex 用户配置里旧版本存的占位项（保存着工具的授权），新名字的占位项继承它的授权
    shapes = "src/backend/mcp-provider-shapes.ts"
    add_import(r, shapes, f'import {{ hxEarlierName }} from "{EARLIER}";')
    rp(shapes, 'if (typeof entry.command === "string" && entry.command !== CODEX_PLACEHOLDER_COMMAND) return [[name, "stdio"]];',
       'if (typeof entry.command === "string" && entry.command !== CODEX_PLACEHOLDER_COMMAND && entry.command !== hxEarlierName(CODEX_PLACEHOLDER_COMMAND))\n        return [[name, "stdio"]];')
    codex = "src/backend/agent/codex-mcp-config.ts"
    add_import(r, codex, f'import {{ hxEarlierName }} from "{EARLIER}";')
    rp(codex, "    const existing = getRecord(saved, name);\n",
       "    const existing = getRecord(saved, name) ?? earlierPlaceholder(saved, name);\n")
    rp(codex, "}, registrationLock.withPermit);\n",
       "}, registrationLock.withPermit);\n\n"
       "/** HXBot: the placeholder that an earlier build saved under the earlier name; its tool approvals carry over. */\n"
       "function earlierPlaceholder(saved: ReturnType<typeof getRecord>, name: string): ReturnType<typeof getRecord> {\n"
       "  const earlier = hxEarlierName(name);\n"
       "  if (earlier === name) return null;\n"
       "  const entry = getRecord(saved, earlier);\n"
       "  const placeholder =\n"
       "    entry?.enabled === false &&\n"
       "    (entry.command === hxEarlierName(CODEX_PLACEHOLDER_COMMAND) || entry.url === CODEX_PLACEHOLDER_URL);\n"
       "  return placeholder ? entry : null;\n"
       "}\n")
    rp("src/main/cua-driver-runtime.ts", r"const WINDOWS_PIPE_NAME = /^\\\\\.\\pipe\\openbot-cua-[0-9a-f-]{36}$/;",
       r"const WINDOWS_PIPE_NAME = /^\\\\\.\\pipe\\(?:hxbot|openbot)-cua-[0-9a-f-]{36}$/;")

    # 账号服务：浏览器里还留着旧名字的登录 Cookie；还没刷新的网页发来旧名字的请求头
    api = "apps/auth-api/src/server/browser-api.ts"
    add_import(r, api, f'import {{ hxEarlierName }} from "{EARLIER}";')
    rp(api, "  const token = cookieValue(request, COOKIE);\n",
       "  const token = cookieValue(request, COOKIE) ?? cookieValue(request, hxEarlierName(COOKIE));\n")
    rp(api, '  const [clientState, verifier] = cookieValue(request, COMPANY_COOKIE)?.split(".") ?? [];',
       '  const [clientState, verifier] =\n    (cookieValue(request, COMPANY_COOKIE) ?? cookieValue(request, hxEarlierName(COMPANY_COOKIE)))?.split(".") ?? [];')
    rp(api, '    response.headers.set("Set-Cookie", `${COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`);\n',
       '    response.headers.set("Set-Cookie", `${COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`);\n'
       '    response.headers.append("Set-Cookie", `${hxEarlierName(COOKIE)}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`);\n')
    rp(api, '      request.headers.get("X-OpenBot-Browser") !== "1" ||',
       '      (request.headers.get("X-OpenBot-Browser") ?? request.headers.get(hxEarlierName("X-OpenBot-Browser"))) !== "1" ||')

    # 界面里认得共享文件夹的路径：新的 HXBot/Shared 和旧电脑上的 OpenBot/Shared
    ref = "packages/ui/src/features/conversation/FileReference.ts"
    add_import(r, ref, f'import {{ HX_DATA_FOLDER, HX_EARLIER_DATA_FOLDER }} from "{EARLIER}";')
    rp(ref, '  return segments.some((segment, index) => segment === "OpenBot" && segments[index + 1] === "Shared");',
       "  return segments.some(\n"
       "    (segment, index) =>\n"
       '      (segment === HX_DATA_FOLDER || segment === HX_EARLIER_DATA_FOLDER) && segments[index + 1] === "Shared",\n'
       "  );")
    # 消息里写的共享文件夹路径：升级的电脑上数据文件夹还是旧名字，旧消息里也是旧名字，两种都认
    rp("apps/mobile/src/features/chat/model/message-file-target.ts",
       '    normalized.startsWith("~/OpenBot/Shared/") ||\n',
       '    normalized.startsWith("~/HXBot/Shared/") ||\n'
       '    normalized.startsWith("HXBot/Shared/") ||\n'
       '    normalized.includes("/HXBot/Shared/") ||\n'
       '    normalized.startsWith("~/OpenBot/Shared/") ||\n')
    rp("packages/ui/src/features/conversation/MarkdownMessageText.tsx",
       '  return normalized.startsWith("~/OpenBot/Shared/") ||\n',
       '  return normalized.startsWith("~/HXBot/Shared/") ||\n'
       '    normalized.startsWith("HXBot/Shared/") ||\n'
       '    normalized.includes("/HXBot/Shared/") ||\n'
       '    normalized.startsWith("~/OpenBot/Shared/") ||\n')
    rp("src/backend/agent/attachment-gateway.ts",
       '    const sharedReference = ["~/OpenBot/Shared/", "OpenBot/Shared/", "Shared/"].some((prefix) =>\n'
       "      normalized.startsWith(prefix),\n"
       "    );\n",
       '    const sharedReference = ["~/HXBot/Shared/", "HXBot/Shared/", "~/OpenBot/Shared/", "OpenBot/Shared/", "Shared/"].some(\n'
       "      (prefix) => normalized.startsWith(prefix),\n"
       "    );\n")
    # 工作区里的 .openbot 文件夹名不改，这句注释原来举的是它的大小写变体，改名后就不成立了
    rp("src/main/instance-transfer-service.ts",
       "  // A disk that ignores case writes `.OpenBot/` into `.openbot/`, so the check ignores case too.\n",
       "  // A disk that ignores case puts every capitalization of these names in one folder, so the check ignores case too.\n")
    # 新的应用名 HXBot 带空格：命令行里的路径要加引号（上游自己的打包、托管脚本）
    rp("nix/package.nix", "      cp -R OpenBot.app $out/Applications/\n", '      cp -R "OpenBot.app" $out/Applications/\n')
    rp("nix/package.nix", "      makeWrapper $out/Applications/OpenBot.app/Contents/MacOS/OpenBot $out/bin/openbot\n",
       '      makeWrapper "$out/Applications/OpenBot.app/Contents/MacOS/OpenBot" $out/bin/openbot\n')
    rp("scripts/install-host-update-agent.sh", 'ls -ld /Applications/OpenBot.app "$ROOT"', 'ls -ld "/Applications/OpenBot.app" "$ROOT"')
    rp(".github/workflows/release.yml", "-LiteralPath dist/win-unpacked/OpenBot.exe)", '-LiteralPath "dist/win-unpacked/OpenBot.exe")')
    rp("docker/Dockerfile", "LABEL org.opencontainers.image.title=OpenBot \\\n", 'LABEL org.opencontainers.image.title="OpenBot" \\\n')


def mobile_secure_store_files(r) -> list[str]:
    root = r.ROOT / "apps/mobile/src"
    found = []
    for file in sorted(root.rglob("*.ts*")):
        rel = file.relative_to(r.ROOT).as_posix()
        if ".test." in rel or rel.endswith("hx-secure-store.ts"):
            continue
        if 'import * as SecureStore from "expo-secure-store";' in file.read_text(encoding="utf-8"):
            found.append(rel)
    return found


# ---------------------------------------------------------------- 删掉上游官网的宣传页
_MARKETING: set[str] | None = None


def marketing_files() -> set[str]:
    global _MARKETING
    if _MARKETING is None:
        lines = (ROOT / "hx" / "marketing-files.txt").read_text(encoding="utf-8").splitlines()
        _MARKETING = {line.strip() for line in lines if line.strip()}
    return _MARKETING


def drop_marketing(r) -> int:
    """上游官网的宣传页（首页、指南、新闻、对比、定价、下载页、插件市场页、法律页等）、它们的配图和 CLA 文件。

    研究版的 nginx 和账号服务早已把这些页面转回门户，打不开；这里把代码和图片一并从程序里删掉。
    清单在 hx/marketing-files.txt（按“删掉这些路由后，账号服务的入口还用不用得到”算出）。
    """
    removed = 0
    for line in (r.ROOT / "hx" / "marketing-files.txt").read_text(encoding="utf-8").splitlines():
        path = line.strip()
        target = r.ROOT / path
        if not path or not target.is_file():
            continue
        removed += 1
        if r.CHECK_ONLY:
            r.pending.append(path)
            continue
        target.unlink()
        r.changes.append(path)
        folder = target.parent
        while folder != r.ROOT and folder.is_dir() and not any(folder.iterdir()):
            folder.rmdir()
            folder = folder.parent
    vite = "apps/auth-api/vite.config.ts"
    r.replace(vite, 'import { contentImages } from "./content-images";\n', "")
    r.replace(vite, "      contentImages(),\n", "")
    r.replace("apps/auth-api/tsconfig.json", '    "render-content-images.ts",\n', "")
    r.replace("apps/auth-api/package.json", '    "images": "bun render-content-images.ts",\n', "")
    r.replace("package.json", '    "api:images": "bun run --cwd apps/auth-api images",\n', "")
    app = "apps/auth-api/src/lib/software-application.ts"
    r.replace(app, 'import channelScreenshot from "../content/guides/media/openbot-101/a-channel.webp";\n', "")
    r.replace(app, "  screenshot: new URL(channelScreenshot, OPENBOT_SITE_URL).toString(),",
              '  screenshot: new URL("/social/home.jpg", OPENBOT_SITE_URL).toString(),')
    # 加入服务器的邀请链接分享出去时显示的图片：换成 HXBot 的图
    for name in ("home.jpg", "join.jpg"):
        source = r.ROOT / "hx" / "assets" / "social" / name
        target = r.ROOT / "apps" / "auth-api" / "public" / "social" / name
        if target.read_bytes() != source.read_bytes():
            if r.CHECK_ONLY:
                r.pending.append(target.relative_to(r.ROOT).as_posix())
            else:
                shutil.copyfile(source, target)
                r.changes.append(target.relative_to(r.ROOT).as_posix())
    return removed


def route_tree(r) -> None:
    """按剩下的页面重新生成账号服务的路由表（hx/scripts/gen-route-tree.mjs）。"""
    path = r.ROOT / "apps" / "auth-api" / "src" / "routeTree.gen.ts"
    before = path.read_bytes()
    result = subprocess.run(["node", str(r.ROOT / "hx" / "scripts" / "gen-route-tree.mjs")], cwd=r.ROOT,
                            capture_output=True)
    if result.returncode != 0:
        sys.stderr.buffer.write(result.stdout + result.stderr)
        result.check_returncode()
    if r.CHECK_ONLY and path.read_bytes() != before:
        path.write_bytes(before)
        r.pending.append("apps/auth-api/src/routeTree.gen.ts")


# ---------------------------------------------------------------- 最后的整理：路由表、import 顺序、格式
# 上游的代码全部是用 Biome 整理好的（bun run lint 没有一处格式或 import 顺序的问题）。改造把名字换短、把域名
# 换长、加了新的 import 以后，有的行该合并或该折开，import 的字母顺序也变了。所以改造的最后用仓库自带的 Biome
# 把整棵树整理一遍：只整理格式和 import 顺序，不做别的修改。上游没动过的文件本来就是整理好的，不会变；
# 变的只有改造改过的文件和弘犀自己的文件。弘犀的静态网页不归 Biome 管（见 upstream_checks.py 的 biome_scope）。
def node_tools() -> bool:
    """已经 bun install 过：有 Biome 和账号服务的路由表生成器。"""
    return (ROOT / "node_modules" / ".bin" / "biome").exists() and (ROOT / "node_modules" / "@tanstack").is_dir()


def _biome(command: list[str]) -> str:
    biome = ROOT / "node_modules" / ".bin" / "biome"
    if not biome.exists():
        raise SystemExit("找不到 node_modules/.bin/biome：先运行 bun install，再运行 rebrand.py")
    result = subprocess.run([str(biome), *command, "--max-diagnostics=none", "."], cwd=ROOT, capture_output=True, text=True)
    return result.stdout + result.stderr


def untidy_files() -> list[str]:
    """格式或 import 顺序没有整理好的文件。"""
    found = set()
    for line in _biome(["check", "--linter-enabled=false"]).splitlines():
        if m := re.match(r"^(\S+?)(?::\d+:\d+)? (?:format|assist/source/organizeImports)\b", line):
            found.add(m.group(1))
    return sorted(found)


def rename_all(r) -> None:
    """删掉宣传页，接好兼容代码，再把所有 OpenBot 改成 HXBot。"""
    drop_marketing(r)
    prepare(r)
    rename_tree(r)


def finish(r) -> None:
    """全部步骤之后：重新生成路由表，整理格式和 import 顺序。

    已经改造好的源码（交付的源码包、各构建脚本的第一步）这次运行什么都没改，就不需要 Node 工具；
    从上游重新改造时要先 bun install（生成路由表、整理格式要用 node_modules 里的工具）。
    """
    if r.CHECK_ONLY:
        if r.pending:
            return
        if not node_tools():
            print("提示：还没有 bun install，路由表、格式和 import 顺序这三项没有核对。", file=sys.stderr)
            return
        route_tree(r)
        for path in untidy_files():
            r.errors.append(f"格式或 import 顺序没有整理好（运行 python3 hx/rebrand.py 会整理）：{path}")
        return
    if not r.changes and not (node_tools() and untidy_files()):
        return
    if not node_tools():
        print("提示：还没有 bun install，跳过路由表和格式整理。", file=sys.stderr)
        return
    route_tree(r)
    _biome(["check", "--write", "--linter-enabled=false"])
    left = untidy_files()
    if left:
        r.errors.append("整理格式后仍有问题：" + "、".join(left[:10]))
