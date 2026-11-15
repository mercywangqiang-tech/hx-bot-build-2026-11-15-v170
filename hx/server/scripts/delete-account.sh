#!/usr/bin/env bash
# 注销一个 HXBot 账号：处理用户按《隐私政策》提出的注销账号、删除个人信息的请求。在服务器上以 root 运行：
#   bash /opt/hxbot/server/scripts/delete-account.sh 用户邮箱
# 做的事：
#   1. 查出该邮箱的账号，显示显示名称、注册时间、发布的服务器数和加入的服务器数，输入 yes 确认后继续
#   2. 先备份一次账号数据（scripts/backup.sh；备份最多保留 30 天，到期删除后，被注销的数据随之彻底消失）
#   3. 暂停账号服务约 10 秒，删除：注册资料（用户名、手机号码、职位、公司名称、密码的哈希）、绑定的第三方账号、
#      账号信息、登录会话、手机登录记录、成员关系、该账号发布的服务器目录记录、该账号创建的邀请和发给该邮箱的邀请、
#      未完成的注册、找回密码和登录记录，以及头像图片
#   4. 重新启动账号服务，再查一次确认已删除
# 用户电脑上的数据（助手、对话、文件）不在服务器上，不受影响，由用户自行处理。
# 核实申请人身份（例如对方是用这个邮箱发来的申请）后再运行。按政策应在收到申请后 15 个工作日内完成。
set -euo pipefail
cd "$(dirname "$0")/.."
EMAIL="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
[[ "$EMAIL" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "用法：bash $0 用户邮箱" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "请用 root 运行。" >&2; exit 1; }

IMAGE=hxbot/account:local
CONFIG=/app/dist/server/wrangler.json
# 在一次性容器里对账号数据库执行 SQL（与账号服务使用同一个数据卷），输出 wrangler 的 JSON 结果
sql() {
  docker run --rm --entrypoint sh -e WRANGLER_SEND_METRICS=false -v hxbot_account-state:/state "$IMAGE" \
    -c "wrangler d1 execute hxbot-account --local --config $CONFIG --persist-to /state --json --command \"\$0\" 2>/dev/null" "$1"
}
r2_delete() {
  docker run --rm --entrypoint sh -e WRANGLER_SEND_METRICS=false -v hxbot_account-state:/state "$IMAGE" \
    -c "wrangler r2 object delete \"\$0\" --local --config $CONFIG --persist-to /state >/dev/null 2>&1" "$1"
}
# 从 wrangler 的 JSON 结果中取第一条记录的各个字段，每个字段一行（没有记录时不输出）
fields() { python3 -c 'import json,sys
rows = json.load(sys.stdin)[0]["results"]
if rows: print("\n".join(" ".join(("" if rows[0][k] is None else str(rows[0][k])).split()) for k in sys.argv[1:]))' "$@"; }

stopped=0
restart() { if [ "$stopped" = 1 ]; then docker compose start account account-cron >/dev/null; stopped=0; fi; }
trap restart EXIT

LOOKUP="SELECT u.id, u.email, COALESCE(u.name, '') AS name, u.avatar_url, datetime(CASE WHEN u.created_at > 100000000000 THEN u.created_at / 1000 ELSE u.created_at END, 'unixepoch') AS created,
  (SELECT count(*) FROM remote_hosts h WHERE h.owner_user_id = u.id) AS hosts,
  (SELECT count(*) FROM remote_memberships m WHERE m.user_id = u.id AND m.role <> 'owner') AS joined
  FROM users u WHERE lower(u.email) = '$EMAIL'"
# 注册了但还没有登录过的账号只有注册资料，没有上面那条记录
REGISTERED="SELECT a.username, a.company FROM hx_accounts a WHERE a.email = '$EMAIL'"
# 注册资料、绑定的第三方账号（随注册资料一起删除）、没走完的注册和找回密码
FORGET="DELETE FROM hx_pending WHERE email = '$EMAIL';
DELETE FROM hx_identities WHERE email = '$EMAIL';
DELETE FROM hx_phone_owners WHERE email = '$EMAIL';
DELETE FROM hx_accounts WHERE email = '$EMAIL';"

docker compose stop account-cron account >/dev/null
stopped=1
found="$(sql "$LOOKUP" | fields id email name avatar_url created hosts joined)"
registered="$(sql "$REGISTERED" | fields username company)"
restart
if [ -z "$found" ] && [ -z "$registered" ]; then
  echo "没有找到邮箱为 $EMAIL 的账号。服务器上没有该邮箱的账号信息，无需删除。"
  exit 0
fi
if [ -z "$found" ]; then
  echo "找到注册资料：$EMAIL（注册后还没有登录过）"
  read -r -p "确认删除这份注册资料？此操作不能撤销，请输入 yes：" answer || answer=""
  [ "$answer" = yes ] || { echo "已取消，没有做任何改动。"; exit 0; }
  bash scripts/backup.sh
  docker compose stop account-cron account >/dev/null
  stopped=1
  sql "$FORGET" >/dev/null
  left="$(sql "SELECT (SELECT count(*) FROM hx_accounts WHERE email = '$EMAIL') + (SELECT count(*) FROM hx_identities WHERE email = '$EMAIL') AS n" | fields n)"
  restart
  trap - EXIT
  [ "$left" = 0 ] || { echo "删除未完成：仍有 $left 条相关记录。请把这条输出发给开发人员。" >&2; exit 1; }
  echo "$(date '+%F %T') 已删除 $EMAIL 的注册资料。"
  echo "请回复申请人：账号已注销；服务器上的备份会在 30 天内到期删除。"
  exit 0
fi
{ read -r user_id; read -r email; read -r name; read -r avatar_url; read -r created; read -r hosts; read -r joined; } <<<"$found"
echo "找到账号：$email"
[ -z "$registered" ] || echo "  注册资料：有（用户名、手机号码、职位、公司名称、密码的哈希、绑定的第三方账号，会一并删除）"
echo "  显示名称：${name:-（未填写）}"
echo "  注册时间（UTC）：$created"
echo "  发布的服务器：$hosts 台（目录记录会删除；这些服务器的成员将无法再连接）"
echo "  加入的其他服务器：$joined 个"
read -r -p "确认注销并删除该账号？此操作不能撤销，请输入 yes：" answer || answer=""
[ "$answer" = yes ] || { echo "已取消，没有做任何改动。"; exit 0; }

bash scripts/backup.sh

docker compose stop account-cron account >/dev/null
stopped=1
sql "$FORGET
DELETE FROM remote_invites WHERE lower(email) = '$EMAIL';
DELETE FROM email_login_challenges WHERE lower(email) = '$EMAIL';
DELETE FROM users WHERE id = '$user_id';" >/dev/null
# 头像图片：users/<账号 ID>/<版本>（版本即头像地址中 v= 后面的部分）
version="${avatar_url##*v=}"
if [ -n "$avatar_url" ] && [ "$version" != "$avatar_url" ]; then r2_delete "hxbot-avatars/users/$user_id/$version"; fi
left="$(sql "SELECT (SELECT count(*) FROM users WHERE id = '$user_id') + (SELECT count(*) FROM auth_sessions WHERE user_id = '$user_id')
  + (SELECT count(*) FROM remote_memberships WHERE user_id = '$user_id') + (SELECT count(*) FROM remote_hosts WHERE owner_user_id = '$user_id')
  + (SELECT count(*) FROM hx_accounts WHERE email = '$EMAIL') + (SELECT count(*) FROM hx_identities WHERE email = '$EMAIL') AS n" | fields n)"
restart
trap - EXIT
if [ "$left" != 0 ]; then
  echo "删除未完成：仍有 $left 条相关记录。请把这条输出发给开发人员。" >&2
  exit 1
fi
echo "$(date '+%F %T') 已注销账号 $email（账号 ID $user_id），相关记录已删除。"
echo "请回复申请人：账号已注销；服务器上的备份会在 30 天内到期删除；其电脑上的数据不受影响。"
