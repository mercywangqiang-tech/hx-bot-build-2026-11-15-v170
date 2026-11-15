"""HXBot：保密箱里保存的密码自动登录，不再拦截；只有付款每次先问（v1.6.8）。

用户 2026-11-14 12:28：“Vault 密码自动登录有硬性拦截，改成不拦截！只要支付时候拦截，其他都不拦截！在V1.6.8完成”；
随后选定：只限保密箱（用保存的密码登录、验证码、删除保密箱条目都不问；改动工作区外的文件、管理员命令、密钥文件夹照旧
先问），并去掉“助手在这个网页上运行过脚本就不自动填密码”这道保护。

HX 自己的文件里的改动（不在这里）：
- src/backend/hx-access/hub.ts：submit_secret（带 loginId）和 delete_vault_item 在最大权限下不再要确认；
  fill_card（付款）照旧每次确认，只能“允许一次”
- src/backend/hx-access/tools.ts、hub.ts 给模型的说明，hx/access_control.py 的最大权限说明文字

这里只改上游的一处：自动填密码时不再因为“助手在这个网站上运行过脚本”而改由用户在卡片里填。
字段不是密码栏（或验证码栏）时照旧不自动填：那是填错地方，不是确认。
"""

from __future__ import annotations


def fill_after_scripts(r) -> None:
    path = "src/backend/agent/attention-registry.ts"
    r.replace(path,
              "    // A script the agent ran that still runs in the page can read what is filled, and a field built\n"
              "    // for something else can carry the value into a URL. In both cases the card lets the user decide.\n"
              "    if (pending.secret?.agentScriptedOrigin !== false)\n"
              "      return skip(\n"
              "        \"agent-scripted-origin\",\n"
              "        \"a script that you ran with evaluate can still run in this page or in another open page of this site. "
              "Reload this page, and close or navigate each other tab where you ran evaluate on this site, before submit_secret.\",\n"
              "      );\n"
              "    if (pending.secret.vaultFillable !== true)\n",
              "    // HXBot (v1.6.8, the user's decision on 2026-11-14): a saved login fills in also on a page where the\n"
              "    // agent ran a script. A field built for something else can carry the value into a URL, so the card\n"
              "    // still lets the user decide there.\n"
              "    if (!pending.secret) return false;\n"
              "    if (pending.secret.vaultFillable !== true)\n")


def apply(r) -> None:
    fill_after_scripts(r)
