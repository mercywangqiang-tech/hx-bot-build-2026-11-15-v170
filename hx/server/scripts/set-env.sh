#!/usr/bin/env bash
# 一条命令填写 .env 中的一项，免去手工编辑文件。会检查格式，写好后显示结果。可以重复运行（覆盖原值）。
#
#   bash scripts/set-env.sh 变量名 值            填写一项，例如：bash scripts/set-env.sh TURN_PUBLIC_IP 47.119.145.170
#   bash scripts/set-env.sh --secret 变量名      隐藏输入（用于密码和密钥，输入两次，不会留在命令历史里）
#   bash scripts/set-env.sh --file 变量名 文件    读入密钥文件（Apple 的 .p8、支付宝的应用私钥），存成一行
#   bash scripts/set-env.sh --show               列出各项的填写情况（密码和密钥只显示是否已填）
#   bash scripts/set-env.sh --test-mail          用 .env 里的发信邮箱登录 SMTP 服务器，检查地址和密码
#   bash scripts/set-env.sh --test-sms 手机号    用 .env 里的阿里云短信设置发一条真实的验证码短信（按条计费）
#
# 需要 python3（服务器一般自带）。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "已从 .env.example 创建 .env"
fi
chmod 600 .env
command -v python3 >/dev/null 2>&1 || { echo "✘ 缺少 python3：apt-get install -y python3（Alibaba Cloud Linux：dnf install -y python3）" >&2; exit 1; }

usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

mode=set
case "${1:-}" in
  --secret) mode=secret; shift; [ $# -eq 1 ] || usage ;;
  --file) mode=file; shift; [ $# -eq 2 ] || usage ;;
  --show) mode=show; shift ;;
  --test-mail) mode=test; shift ;;
  --test-sms) mode=sms; shift; [ $# -eq 1 ] || usage ;;
  -h|--help|'') usage ;;
  *) [ $# -eq 2 ] || { echo "✘ 需要两个参数：变量名 值（值为空时写 ''，值里有空格时用英文单引号括起来）" >&2; exit 2; } ;;
esac

if [ "$mode" = secret ]; then
  key="$1"
  while :; do
    IFS= read -rsp "请输入 $key（输入时不显示，输完按回车）：" v1; echo
    IFS= read -rsp "请再输入一次：" v2; echo
    if [ "$v1" != "$v2" ]; then echo "✘ 两次输入不一致，请重新输入"; continue; fi
    if [ -z "$v1" ]; then echo "✘ 不能为空，请重新输入"; continue; fi
    break
  done
  HXBOT_KEY="$key" HXBOT_VALUE="$v1" HXBOT_MODE=set exec python3 scripts/set_env.py
fi

if [ "$mode" = file ]; then
  HXBOT_KEY="$1" HXBOT_FILE="$2" HXBOT_MODE=file exec python3 scripts/set_env.py
fi

if [ "$mode" = set ]; then
  HXBOT_KEY="$1" HXBOT_VALUE="$2" HXBOT_MODE=set exec python3 scripts/set_env.py
fi
if [ "$mode" = sms ]; then
  HXBOT_VALUE="$1" HXBOT_MODE=sms exec python3 scripts/set_env.py
fi
HXBOT_MODE="$mode" exec python3 scripts/set_env.py
