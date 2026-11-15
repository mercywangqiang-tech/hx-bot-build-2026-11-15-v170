#!/usr/bin/env bash
# 查看和管理 HXBot 的注册用户。在服务器上以 root 运行（在 /opt/hxbot/server 目录）：
#   bash scripts/users.sh list                    列出全部注册用户，以及以前用共用口令登录过、还没设置密码的邮箱
#   bash scripts/users.sh show 邮箱                查看一个用户：资料、登录方式、最近使用时间、是否停用
#   bash scripts/users.sh reset-password 邮箱      为用户设置新密码（隐藏输入两次），并让他在各处的登录全部退出
#   bash scripts/users.sh disable 邮箱             停用账号：不能登录，各处的登录全部退出，资料保留
#   bash scripts/users.sh enable 邮箱              恢复被停用的账号
#   bash scripts/users.sh add 邮箱                 代为建账号（依次询问用户名、手机号码、公司名称、职位和密码）
#   bash scripts/users.sh export [文件.csv]        把全部注册用户导出成表格（含个人信息，用完删除）
# 每条命令会暂停账号服务几秒（已建立的远程连接不受影响，期间新登录会失败）。密码不显示、不进命令历史、不写日志。
# 彻底删除一个账号及其个人信息（用户提出注销）用另一个脚本：bash scripts/delete-account.sh 邮箱
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
  list | show | reset-password | disable | enable | add | export) ;;
  *) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
if [ -z "${HXBOT_SQLITE:-}" ]; then
  [ "$(id -u)" -eq 0 ] || { echo "请用 root 运行。" >&2; exit 1; }
  command -v docker >/dev/null || { echo "找不到 docker。请在部署了 HXBot 的服务器上运行。" >&2; exit 1; }
fi
exec python3 scripts/users.py "$@"
