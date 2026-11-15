#!/usr/bin/env python3
"""核对服务器的每一项设置都能从 .env 一路走到账号服务。build-server.sh 在编译前运行它。

一项设置要经过三处：
  1. scripts/set_env.py 认识它（bash scripts/set-env.sh 变量名 值 才写得进 .env）；
  2. account/entrypoint.sh 把它从容器的环境变量写进 .dev.vars；
  3. account/wrangler.hx.jsonc 的 vars 或 secrets.required 里登记了它。本地运行时，.dev.vars 里没有登记过的
     名字会被悄悄丢掉，账号服务读到的是空值（第三方登录的按钮不出现、发不出验证码，却没有任何报错）。
少了哪一处都会让这项设置不生效，所以三处必须一致。
"""
import json
import re
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent / "server"


def declared():
    text = (SERVER / "account" / "wrangler.hx.jsonc").read_text(encoding="utf-8")
    # 去掉整行注释（值里没有 //，除了 wss:// 和 http://，它们前面是引号里的内容，不在行首）
    text = "\n".join(line for line in text.split("\n") if not line.strip().startswith("//"))
    config = json.loads(text)
    return set(config.get("vars", {})) | set(config.get("secrets", {}).get("required", []))


def written_by_entrypoint():
    text = (SERVER / "account" / "entrypoint.sh").read_text(encoding="utf-8")
    block = re.search(r"for name in ((?:[A-Z0-9_ ]|\\\n)+); do\n  put \"\$name\"", text)
    if not block:
        sys.exit("✘ 在 entrypoint.sh 里找不到写入 .dev.vars 的名单（for name in … put \"$name\"）。")
    names = set(re.findall(r"[A-Z][A-Z0-9_]+", block.group(1)))
    names |= set(re.findall(r'printf "([A-Z][A-Z0-9_]+)=', text))
    return names


def settable():
    namespace = {}
    source = (SERVER / "scripts" / "set_env.py").read_text(encoding="utf-8")
    # 只取名单的定义（到 EMAIL 正则之前），不运行脚本的其余部分
    exec(source[: source.index("EMAIL = re.compile")], {"__name__": "names", "os": __import__("os")}, namespace)  # noqa: S102
    account = set(namespace["OPTIONAL"]) | set(namespace["SWITCH"]) | set(namespace["MAIL"]) | set(namespace["SMS"]) | set(namespace["PROVIDER_KEYS"])
    return account | {"HX_APPLE_TEAM_ID"}


def main():
    known, written, wanted = declared(), written_by_entrypoint(), settable()
    problems = []
    for name in sorted(written - known):
        problems.append("{} 由 entrypoint.sh 写进 .dev.vars，但没有在 wrangler.hx.jsonc 的 vars 里登记：账号服务读不到它。".format(name))
    for name in sorted(wanted - written):
        problems.append("{} 可以用 set-env.sh 填写，但 entrypoint.sh 没有把它写进 .dev.vars：填了也不生效。".format(name))
    example = (SERVER / ".env.example").read_text(encoding="utf-8")
    for name in sorted(wanted):
        if not re.search(r"^{}=".format(name), example, re.M):
            problems.append("{} 不在 .env.example 里：新部署的 .env 没有这一项的说明。".format(name))
    if problems:
        print("✘ 服务器设置的三处名单不一致：", file=sys.stderr)
        for problem in problems:
            print("  " + problem, file=sys.stderr)
        return 1
    print("服务器设置核对通过：{} 项都能从 .env 到达账号服务。".format(len(wanted)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
