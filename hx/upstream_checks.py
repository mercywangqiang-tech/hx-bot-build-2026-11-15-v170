"""HXBot：让改造的结果通过上游自己的检查。

上游的代码能通过它自己的全部检查（格式与规范、界面文字、界面样式、图片目录、文档链接、类型……）。
改造删掉了一些页面和功能、加了自己的文字和设置，这些检查就会报出改造留下的东西：没人用的界面文字和
样式、没登记的图片目录、没翻译也没登记的文字。这一步把它们处理掉，让研究版和上游一样通过每一项检查。
`hx/scripts/check-gates.sh` 运行这些检查，打包前必须全部通过。

由 rebrand.py 在改名之前调用（upstream_checks(r)，r 是 rebrand 模块本身），所以这里写的都是上游的原文。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MESSAGES = "packages/i18n/src/messages"
LOCALES = ["ar", "de", "en", "es", "fr", "he", "it", "ja", "ko", "nl", "pl", "pt", "ru", "tr", "zh"]


# ---------------------------------------------------------------- 没人用的界面文字
# 改造删掉了上游官网的宣传页、邮件验证码登录的界面、帮助菜单里的上游入口，它们的文字就没有代码再用到。
# 上游的检查（bun run i18n:check）不允许留着没人用的文字，安装包里也不该带着上游官网的宣传文案。
# 清单在 hx/unused-messages.txt（上游原来的键名，一行一个）；15 种语言里的这些键全部删掉。
# 检查报出新的 “is not used” 时，确认是改造造成的，把键加进清单；清单里的键如果后来又有代码用到，
# 类型检查会报错，把它从清单里去掉。
_removed: set[str] | None = None


def removed_keys() -> set[str]:
    global _removed
    if _removed is None:
        lines = (ROOT / "hx" / "unused-messages.txt").read_text(encoding="utf-8").splitlines()
        _removed = {line.strip() for line in lines if line.strip() and not line.startswith("#")}
    return _removed


def removed_message(path: str, old: str, new: str) -> bool:
    """`replace(path, old, new)` 改的是一条已被删掉的界面文字：这条改动不用再做。"""
    if not path.startswith(MESSAGES):
        return False
    keys = set(re.findall(r'"([A-Za-z0-9_.]+)":', old)) | set(re.findall(r'"([A-Za-z0-9_.]+)":', new))
    return bool(keys) and keys <= removed_keys()


def _string_end(text: str, start: int) -> int:
    quote = text[start]
    index = start + 1
    while index < len(text):
        if text[index] == "\\":
            index += 2
            continue
        if text[index] == quote:
            return index + 1
        index += 1
    raise ValueError("a string literal does not end")


def catalog(text: str) -> tuple[str, list[str], str]:
    """把文字文件拆成：开头、各条文字（连同它上面的注释和空行）、结尾。和 scripts/i18n-check.ts 的拆法一样。"""
    opening = re.search(r"export const messages = (?:defineMessages\(\"[^\"]+\", )?\{", text)
    if not opening:
        raise ValueError("no `export const messages = {`")
    body = opening.end()
    entries: list[str] = []
    depth = 0
    start = body
    index = body
    while index < len(text):
        char = text[index]
        if text.startswith("//", index):
            end = text.find("\n", index)
            index = len(text) if end < 0 else end
            continue
        if char in "\"'`":
            index = _string_end(text, index)
            continue
        if char in "{[(":
            depth += 1
        elif char in "}])":
            if depth > 0:
                depth -= 1
            else:
                last = text[start:index].rstrip()
                if not last.strip():
                    return text[:body], entries, text[start:]
                entries.append(last)
                return text[:body], entries, text[start + len(last):]
        elif char == "," and depth == 0:
            entries.append(text[start:index])
            start = index + 1
        index += 1
    raise ValueError("the `messages` object does not end")


KEY = re.compile(r'^(?:\s|//[^\n]*)*"([^"\\]+)"\s*:')


def entry_key(entry: str) -> str:
    found = KEY.match(entry)
    if not found:
        raise ValueError(f"an entry does not start with a quoted key: {entry.strip()[:60]}")
    return found.group(1)


def join_catalog(head: str, entries: list[str], tail: str, trailing_comma: bool) -> str:
    if not entries:
        return head + ("\n" if not tail.startswith("\n") else "") + tail.lstrip(",")
    first = re.sub(r"^\n(?:[ \t]*\n)+", "\n", entries[0])  # 第一条上面不留空行
    return head + ",".join([first, *entries[1:]]) + ("," if trailing_comma else "") + tail


def modules(r, locale: str) -> list[str]:
    folder = r.ROOT / MESSAGES / locale
    return sorted(path.relative_to(r.ROOT).as_posix() for path in folder.rglob("*.ts"))


def drop_unused_messages(r) -> None:
    removed = removed_keys()
    brand = {key for key in removed if "OpenBot" in key}
    wanted = removed | {key.replace("OpenBot", "HxBot") for key in brand}  # 改名之后键名里的品牌也改了
    for locale in LOCALES:
        for rel in modules(r, locale):
            text = r.read(rel)
            if not any(f'"{key}"' in text for key in wanted):
                continue
            try:
                head, entries, tail = catalog(text)
            except ValueError as error:
                r.errors.append(f"{rel}: {error}")
                continue
            kept = [entry for entry in entries if entry_key(entry) not in wanted]
            if len(kept) != len(entries):
                trailing = text[: len(text) - len(tail)].rstrip().endswith(",")
                r.write(rel, join_catalog(head, kept, tail, trailing))
    r.untranslated(add={}, translated_zh=[], removed=tuple(sorted(wanted)))


# ---------------------------------------------------------------- 译文文件里键的顺序
def english_order(r) -> None:
    """改造往译文文件里加了新文字；上游要求译文的键和英文文件同一个顺序（检查会提示）。"""
    for rel in [rel for locale in LOCALES if locale != "en" for rel in modules(r, locale)]:
        locale = rel.split("/")[len(MESSAGES.split("/"))]
        english = rel.replace(f"{MESSAGES}/{locale}/", f"{MESSAGES}/en/")
        if not (r.ROOT / english).exists():
            continue
        text = r.read(rel)
        try:
            order = [entry_key(entry) for entry in catalog(r.read(english))[1]]
            head, entries, tail = catalog(text)
            keys = [entry_key(entry) for entry in entries]
        except ValueError:
            continue  # 汇总文件（index、mobile、source、shared）没有自己的文字
        rank = {key: index for index, key in enumerate(order)}
        expected = [key for key in order if key in set(keys)]
        if keys[: len(expected)] == expected:
            continue
        ranked = sorted(enumerate(entries), key=lambda item: (rank.get(entry_key(item[1]), len(order) + item[0])))
        trailing = text[: len(text) - len(tail)].rstrip().endswith(",")
        r.write(rel, join_catalog(head, [entry for _, entry in ranked], tail, trailing))


# ---------------------------------------------------------------- 研究版文字的译文
# 研究版加的文字和改了意思的上游文字，其他 13 种语言的译文在 hx/translations.py；这一步把它们写进各语言的文件。
def translated(r) -> None:
    import translations
    translations.translate(r)


# ---------------------------------------------------------------- 没有页面再用到的样式
def unreachable_styles(r) -> None:
    """页面删掉以后剩下的样式规则（bun run check:ui 报 “not reachable from any markup”）。"""
    marketplace = "packages/ui/src/features/marketplace/marketplace.css"  # 上游官网的插件市场页
    r.replace(marketplace, ".marketplace-head {\n  display: flex;\n  align-items: center;\n  gap: var(--openbot-space-4);\n}\n\n", "")
    r.regex(marketplace, r"\n  \.marketplace-head \{\n    flex-wrap: wrap;\n  \}\n", "")
    # 邮件验证码登录界面的“重新发送”按钮（研究版用登录口令）
    r.replace("packages/ui/src/features/account/auth.css",
              ".account-login-code-action-resend {\n  justify-content: flex-end;\n}\n\n", "")
    # 帮助菜单里的上游新闻
    news = "packages/ui/src/features/updates/whats-new.css"
    r.regex(news, r"\.help-menu \.help-menu-news \{\n[^}]*\}\n\n", "")
    r.regex(news, r"\.help-menu-news-headline \{\n[^}]*\}\n\n", "")
    r.regex(news, r"\.help-menu-news \.ui-menu-trailing \{\n[^}]*\}\n\n?", "")


# ---------------------------------------------------------------- 图片目录、Biome 的范围、提交前检查
def own_folders(r) -> None:
    # 弘犀自己的标志、图标、分享图、文档配图所在的目录（bun run check:assets）
    r.replace("scripts/check-image-assets.ts",
              '  "apps/auth-api/src/content/guides/media/",\n] as const;',
              '  "apps/auth-api/src/content/guides/media/",\n'
              "  // HXBot: its logo, its icons and share pictures, and the pictures of its documents.\n"
              '  "hx/assets/",\n'
              '  "hx/docs/assets/",\n'
              "  // HXBot: the screenshots of the portal's What's new page (v1.6.5).\n"
              '  "hx/server/portal/assets/",\n] as const;')
    # 弘犀的静态网页不归 Biome 管：门户首页是手写的、为了兼容旧浏览器不用新语法；使用指南、条款、隐私政策和
    # 部署文档的网页是脚本生成的。它们有自己的检查（node hx/scripts/site-pages.mjs --check）。
    # dist-hx 是打包的输出（含四份文档的网页），和 dist 一样不检查，否则打过一次包后再检查就不通过。
    r.replace("biome.json", '      "!src/renderer/src/vendor",\n',
              '      "!src/renderer/src/vendor",\n      "!hx/server/portal",\n      "!hx/docs/**/*.html",\n      "!!dist-hx",\n')


def own_commit_check(r) -> None:
    """提交前检查换成弘犀自己的（hx/githooks/pre-commit）：只检查，不改文件。

    上游的检查会用 Biome 自动改写暂存的文件再重新暂存，提交出去的代码就不再等于 rebrand.py 的结果；
    它还要求按上游的发版流程写更新说明。弘犀的检查拦住机密文件、核对改造结果、核对格式，都只报告不修改。
    """
    hooks = "scripts/install-git-hooks.ts"
    r.replace(hooks, 'spawnSync("git", ["config", "core.hooksPath", ".githooks"], {',
              'spawnSync("git", ["config", "core.hooksPath", "hx/githooks"], {')
    r.replace(hooks, 'logger.info("Git hooks enabled from .githooks.");', 'logger.info("Git hooks enabled from hx/githooks.");')


# ---------------------------------------------------------------- 发给 AI 模型的说明和工具清单的字节数
# 上游给每次对话都要发给模型的内容（说明、工具清单）定了字节上限（bun run check:agent-context），只许降不许升。
# 研究版加了授权（申请确认的工具、授权规则的说明）和保密箱的规则，这些内容是有意加的，所以上限按研究版
# 的实际大小重新登记（v1.6.1 品牌名统一为 HXBot 后少了几个字节；v1.6.2 改为最大权限，说明变短，但重新开放的
# Computer Use 的说明和确认对象的新类型多了一些，按新的大小登记；v1.6.4 加了电脑操控的三个工具和一句指引：
# computer_open、computer_set 每次对话都发，computer_find 只留在工具目录里，文字已压到最短，按新的大小登记；
# v1.6.5 加了建议卡 propose_plan 和一句什么时候用它的说明，每次对话都发，按新的大小登记；v1.6.6 加了团队的四个工具，
# 都只放在工具目录里（不是每次对话都发），每次对话只多了一句怎么组队、建议卡说明里多了 start_team，按新的大小登记）；
# 以后研究版自己再加内容，这项检查同样会拦住。
# v1.6.7：computer_plan、computer_look、computer_do 在工具目录里；给智能体的说明多了一步步操作应用的一段和团队上限的一句；
# 建议卡最多 20 个角色、30 步。
# v1.6.8：工具目录里多了 computer_install（安装应用，F6）；最大权限的说明和 request_access 的说明里去掉了
# “用保存的密码登录”“删除保密箱条目”（不再要确认），每次对话发的内容变少了，上限跟着降。
# v1.7.1：团队不设上限（TEAM-01）：start_team 的 limits 多了花费和“不用问”，team 多了 priority、continue、finish
# 三个动作（CONC-03、CONC-10）；建议卡说明里团队上限的一句改成“默认不设上限，用户说了才传”，文字都压到最短。
# v1.7.3：只留一个入口（CONC-05）：Computer Use 那一段整段换成 HXBot 电脑工具的说明，每次对话发的内容变少，上限跟着降；
# computer_do 的 type 多了 by（直接赋值或打字），computer_look 多了 screenshot（截图），只在工具目录里。
# v1.7.4：应用技能（CU-07）computer_skill 只在工具目录里（说明和参数已压到最短）；每次对话只多一句
# “Office 文件、PDF 和移动文件先用 computer_skill”（63 字节），tool_search 列出的工具名多了它。
AGENT_CONTEXT_BYTES = {
    "catalog.descriptions": 45392,  # 上游 40370；v1.6.9 加 computer_app、computer_run；v1.7.1 team 的新动作；v1.7.4 computer_skill
    "catalog.schemas": 82321,  # 上游 70274；v1.7.1 limits 与 team 的新字段；v1.7.3 by、screenshot；v1.7.4 computer_skill（含幂等键 requestId）
    "guidance": 21879,  # 上游 22043
    "instructions.claude": 16655,  # 上游 14897；v1.7.4 computer_skill 一句
    "instructions.codex": 16725,  # 上游 14969；v1.7.4 computer_skill 一句
    "visible-tools": 21153,  # 上游 15681（tool_search 的说明里列出全部工具名）
}


def agent_context(r) -> None:
    if not AGENT_CONTEXT_BYTES:
        return

    def edit(data) -> None:
        data["bytes"].update(AGENT_CONTEXT_BYTES)
    r.json_edit("tools/agent-context/budget.json", edit)


# ---------------------------------------------------------------- 没有代码再用到的导出（bun run knip:check）
# 研究版删掉了上游官网的宣传页，登录不用邮件验证码，头像不用毛绒角色，下面这些上游文件里就有一些导出没人用了。
# 这些文件保持上游的原样（打包时没人用的代码本来就不会进安装包；删掉它们只会让以后同步上游更容易出错），
# 所以按上游自己对“固定不动的文件”的做法，在 knip.config.ts 里登记。弘犀自己的文件不登记，没人用的就删掉。
LEFT_AS_UPSTREAM = {
    "apps/auth-api/src/components/landing/LandingIcon.tsx": ["exports", "types"],
    "apps/auth-api/src/components/landing/SiteText.tsx": ["exports"],
    "apps/auth-api/src/components/transactional/MessagingConnectPage.tsx": ["exports"],
    "apps/auth-api/src/components/transactional/page-text.ts": ["exports", "types"],
    "apps/auth-api/src/components/ui/button.tsx": ["exports"],
    "apps/auth-api/src/lib/analytics.ts": ["types"],
    "apps/auth-api/src/lib/brand-page.ts": ["exports"],
    "apps/auth-api/src/lib/changelog.ts": ["exports", "types"],
    "apps/auth-api/src/lib/cla.ts": ["exports"],
    "apps/auth-api/src/lib/commercial-license.ts": ["exports"],
    "apps/auth-api/src/lib/contact.ts": ["exports"],
    "apps/auth-api/src/lib/content-collection.ts": ["exports", "types"],
    "apps/auth-api/src/lib/content.ts": ["exports"],
    "apps/auth-api/src/lib/download-pages.ts": ["exports", "types"],
    "apps/auth-api/src/lib/dpa.ts": ["exports"],
    "apps/auth-api/src/lib/landing-links.ts": ["exports", "types"],
    "apps/auth-api/src/lib/marketplace-routes.ts": ["exports"],
    "apps/auth-api/src/lib/mobile-apps.ts": ["exports"],
    "apps/auth-api/src/lib/plugins.ts": ["exports", "types"],
    "apps/auth-api/src/lib/pricing-page.ts": ["exports", "types"],
    "apps/auth-api/src/lib/privacy-policy.ts": ["exports"],
    "apps/auth-api/src/lib/site-locale.ts": ["exports"],
    "apps/auth-api/src/lib/site-metadata.ts": ["exports", "types"],
    "apps/auth-api/src/lib/site-paths.ts": ["exports"],
    "apps/auth-api/src/lib/site-text.ts": ["types"],
    "apps/auth-api/src/lib/teams-page.ts": ["exports", "types"],
    "apps/auth-api/src/lib/terms.ts": ["exports"],
    "apps/auth-api/src/lib/text-slots.ts": ["exports"],
    "apps/auth-api/src/server/content-feed.ts": ["exports"],
    "apps/auth-api/src/server/marketplace-catalog.ts": ["exports"],
    "apps/mobile/src/features/agents/components/bloub-avatar.tsx": ["exports"],
    "apps/mobile/src/features/auth/components/email-code-input.tsx": ["exports"],
    "apps/mobile/src/features/auth/components/sign-in-motion.ts": ["exports"],
    "src/backend/process-confinement.ts": ["exports"],
}


def unused_exports(r) -> None:
    knip = "knip.config.ts"
    # 真机检查在 GitHub 的 Windows 机器上用记事本打开文件（scripts/hx-real-check.ts）
    r.replace(knip, '  ignoreBinaries: [\n',
              '  ignoreBinaries: [\n'
              '    // HXBot: the real check opens files in Notepad on Windows runners.\n'
              '    "notepad.exe",\n'
              '    // HXBot (v1.7.0): the quiet check moves the user to File Explorer.\n'
              '    "explorer.exe",\n'
              '    // HXBot (v1.7.1): the memory of the agents on Windows (src/main/hx-flow-readings.ts).\n'
              '    "tasklist.exe",\n'
              '    // HXBot (v1.7.3): the lanes check works in a second app on Windows runners.\n'
              '    "charmap.exe",\n')
    entries = "".join(f'    "{path}": {json.dumps(kinds)},\n' for path, kinds in LEFT_AS_UPSTREAM.items())
    r.replace(knip, '    "apps/auth-api/src/lib/plugin-catalog.generated.ts": ["exports", "types"],\n  },\n',
              '    "apps/auth-api/src/lib/plugin-catalog.generated.ts": ["exports", "types"],\n'
              "    // HXBot: the research edition has no marketing site, no sign-in by emailed code and no plush\n"
              "    // avatars, so what only those used is unused here. The files stay as upstream wrote them.\n"
              + entries + "  },\n")
    # 上游官网首页的动态背景用的包：页面删了，依赖留着，bun.lock 就和上游一致（构建用 --frozen-lockfile）
    r.replace(knip, '      ignoreDependencies: ["cloudflare"],\n',
              "      ignoreDependencies: [\n"
              '        "cloudflare",\n'
              "        // HXBot: the landing page that drew with it is removed; the dependency stays so that\n"
              "        // bun.lock is the lockfile of upstream.\n"
              '        "@paper-design/shaders",\n'
              "      ],\n")


def upstream_checks(r) -> None:
    unreachable_styles(r)
    own_folders(r)
    own_commit_check(r)
    agent_context(r)
    unused_exports(r)
    translated(r)
    drop_unused_messages(r)
    english_order(r)
