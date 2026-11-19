#!/usr/bin/env bash
# 一条命令把 HXBot 服务器升级到新版本（v1.6.2 起）。在服务器上以 root 运行：
#   bash /opt/hxbot/server/scripts/update.sh /opt/hxbot-server-v1.6.3.zip           # 全量包
#   bash /opt/hxbot/server/scripts/update.sh /opt/hxbot-server-update-v1.6.3.zip    # 更新包（只含变动的文件）
# 服务器上还没有这个脚本时（v1.6.1 及更早），先从包里取出来再运行：
#   unzip -o -j /opt/hxbot-server-v1.6.2.zip server/scripts/update.sh -d /tmp/hxbot-update
#   bash /tmp/hxbot-update/update.sh /opt/hxbot-server-v1.6.2.zip
#
# 做的事（和部署文档第 12 节手工升级的 8 步相同，外加检查和回滚）：
#   1. 解压到临时目录并核对：是不是 HXBot 的部署包；更新包要求这台服务器正好是它的起点版本
#   2. 先跑一遍 check.sh 和 set-env.sh --show，记下升级前已有的问题（升级后只看新出现的问题）
#   3. 备份：账号数据库（backup.sh）、server/ 与 portal/ 目录（含 .env）、nginx 站点配置、正在用的镜像
#   4. 放上新文件（.env、账号数据库、下载目录不动），更新门户页，更新 nginx 配置（setup-https.sh）
#   5. 核对配置，docker compose up -d --build，等账号服务就绪，再跑 check.sh（刚启动的服务没通过的项，最多再等 2 分钟重查）
#   6. 第 4、5 步任何一步出错，或 check.sh 出现升级前没有的失败项：自动回滚到升级前的文件、配置、镜像和数据库
# 选项：--force  同一版本重新安装、或装回较旧的版本
# 日志：/var/log/hxbot/update.log；最近一次的结果：/var/lib/hxbot/update-status
set -uo pipefail

usage() { sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
FORCE=0
PACKAGE=""
for argument in "$@"; do
  case "$argument" in
    --force) FORCE=1 ;;
    -h|--help) usage ;;
    -*) echo "不认识的参数：$argument" >&2; usage ;;
    *) [ -z "$PACKAGE" ] || usage; PACKAGE="$argument" ;;
  esac
done
[ -n "$PACKAGE" ] || usage

ROOT="${HX_ROOT:-/opt/hxbot}"
SERVER="$ROOT/server"
BACKUPS="$ROOT/backups"
LOG_DIR="${HX_LOG_DIR:-/var/log/hxbot}"
STATE_DIR="${HX_STATE_DIR:-/var/lib/hxbot}"
HEALTH_URL="${HX_HEALTH_URL:-http://127.0.0.1:8787/health/live}"
HEALTH_WAIT="${HX_HEALTH_WAIT:-180}"
# 账号服务就绪后，信令、中继（coturn）等服务还要一会儿才启动好：没通过的检查项每 SETTLE_STEP 秒重查，最多 SETTLE_WAIT 秒
SETTLE_WAIT="${HX_SETTLE_WAIT:-120}"
SETTLE_STEP="${HX_SETTLE_STEP:-5}"

[ "${HX_TEST_ALLOW_USER:-}" = 1 ] || [ "$(id -u)" -eq 0 ] || { echo "请用 root 运行。" >&2; exit 1; }
[ -f "$SERVER/.env" ] && [ -f "$SERVER/docker-compose.yml" ] || {
  echo "$SERVER 里没有已部署的 HXBot（找不到 .env 或 docker-compose.yml）。全新部署请按部署文档第 0～11 节。" >&2; exit 1; }
[ -f "$PACKAGE" ] || { echo "找不到部署包：$PACKAGE" >&2; exit 1; }
PACKAGE="$(cd "$(dirname "$PACKAGE")" && pwd)/$(basename "$PACKAGE")"
for tool in unzip tar docker curl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "缺少命令：$tool" >&2; exit 1; }
done

install -d -m 0750 "$LOG_DIR"
install -d -m 0700 "$STATE_DIR" "$BACKUPS"
LOG="$LOG_DIR/update.log"
STATUS="$STATE_DIR/update-status"

# 同一时间只做一次升级（手工升级和自动更新撞上时，后来的一个直接退出）
if [ -z "${HX_UPDATE_STAGE:-}" ]; then
  exec 9>"$STATE_DIR/update.lock"
  if command -v flock >/dev/null 2>&1 && ! flock -n 9; then
    echo "另一次升级正在进行（$STATE_DIR/update.lock），请等它结束。" >&2
    exit 1
  fi
fi

if [ -z "${HX_UPDATE_STAGE:-}" ]; then
  # 自动更新的定时任务已经把输出写进这个日志，不再重复写
  [ "${HX_UPDATE_LOGGED:-}" = 1 ] || exec > >(tee -a "$LOG") 2>&1
  echo
  echo "== $(date '+%F %T') 升级 HXBot 服务器：$(basename "$PACKAGE")"
fi
now() { date '+%F %T'; }
status() { printf '%s\t%s\t%s\n' "$(now)" "$1" "$2" > "$STATUS"; chmod 0600 "$STATUS"; }
die() { echo "✘ $*" >&2; status failed "$*"; exit 1; }

# ---------- 1. 解压并核对 ----------
if [ -n "${HX_UPDATE_STAGE:-}" ]; then
  STAGE="$HX_UPDATE_STAGE"
else
  STAGE="$(mktemp -d "$ROOT/.update-XXXXXX")" || die "无法在 $ROOT 下创建临时目录"
  # 压缩包里的路径只能在 server/ 下面
  listing="$(unzip -Z1 "$PACKAGE" 2>/dev/null)" || { rm -rf "$STAGE"; die "$(basename "$PACKAGE") 不是有效的 zip 文件"; }
  if printf '%s\n' "$listing" | grep -Eqv '^server(/|$)' || printf '%s\n' "$listing" | grep -Eq '(^|/)\.\.(/|$)'; then
    rm -rf "$STAGE"; die "$(basename "$PACKAGE") 不是 HXBot 的部署包（里面有 server/ 以外的文件）"
  fi
  unzip -q "$PACKAGE" -d "$STAGE" || { rm -rf "$STAGE"; die "解压 $(basename "$PACKAGE") 失败（磁盘满了？）"; }
  if find "$STAGE" -type l | grep -q .; then rm -rf "$STAGE"; die "$(basename "$PACKAGE") 里有链接文件，不是 HXBot 的部署包"; fi
fi
cleanup_stage() { [ -n "${STAGE:-}" ] && [ -d "$STAGE" ] && rm -rf "$STAGE"; }
NEW="$STAGE/server"
[ -f "$NEW/scripts/update.sh" ] || { cleanup_stage; die "$(basename "$PACKAGE") 不是 HXBot 的部署包（缺少 server/scripts/update.sh）"; }

# 包里的升级脚本比正在运行的新：改用包里的（升级步骤以新版本为准）
if [ -z "${HX_UPDATE_STAGE:-}" ] && ! cmp -s "$0" "$NEW/scripts/update.sh"; then
  echo "使用新版本自带的升级脚本。"
  HX_UPDATE_STAGE="$STAGE" exec bash "$NEW/scripts/update.sh" "$@"
fi

field() { sed -n "s/^$1=//p" "$NEW/.hx-update/package" 2>/dev/null | head -1; }
one_line() { [ -f "$1" ] && head -1 "$1" | tr -cd 'A-Za-z0-9.+-' || true; }
CURRENT_VERSION="$(one_line "$SERVER/VERSION")"
CURRENT_COMMIT="$(one_line "$SERVER/BUILD_COMMIT")"
if [ -f "$NEW/.hx-update/package" ]; then
  KIND=update
  FROM_COMMIT="$(field from_commit)"
  FROM_VERSION="$(field from_version)"
  [ -n "$FROM_COMMIT" ] || { cleanup_stage; die "更新包的说明文件不完整（缺少 from_commit）"; }
else
  KIND=full
  for need in docker-compose.yml scripts/check.sh account/dist; do
    [ -e "$NEW/$need" ] || { cleanup_stage; die "$(basename "$PACKAGE") 不是完整的部署包（缺少 server/$need）。只含变动文件的更新包名字是 hxbot-server-update-v版本.zip"; }
  done
fi
NEW_VERSION="$(one_line "$NEW/VERSION")"
NEW_COMMIT="$(one_line "$NEW/BUILD_COMMIT")"
[ -n "$NEW_VERSION" ] || { cleanup_stage; die "包里没有版本号（server/VERSION），请用 v1.6.2 及以后的部署包"; }
echo "当前：${CURRENT_VERSION:-v1.6.1 或更早} ${CURRENT_COMMIT:+（提交 $CURRENT_COMMIT）}"
echo "新版：$NEW_VERSION（提交 ${NEW_COMMIT:-未知}，$([ "$KIND" = update ] && echo "更新包，起点 v$FROM_VERSION" || echo 全量包)）"

version_key() { printf '%s\n' "$1" | awk -F. '{ printf "%05d%05d%05d%05d", $1, $2, $3, $4 }'; }
if [ "$KIND" = update ] && [ "$CURRENT_COMMIT" != "$FROM_COMMIT" ]; then
  cleanup_stage
  die "这个更新包只能从 v$FROM_VERSION（提交 $FROM_COMMIT）升级，这台服务器是 ${CURRENT_VERSION:-更早的版本}（提交 ${CURRENT_COMMIT:-未知}）。请改用全量包 hxbot-server-v$NEW_VERSION.zip"
fi
if [ "$FORCE" = 0 ] && [ -n "$NEW_COMMIT" ] && [ "$NEW_COMMIT" = "$CURRENT_COMMIT" ]; then
  cleanup_stage
  echo "已经是这个版本，不需要升级（要重新安装，加 --force）。"
  status unchanged "$NEW_VERSION"
  exit 0
fi
if [ "$FORCE" = 0 ] && [ -n "$CURRENT_VERSION" ] && [ "$(version_key "$NEW_VERSION")" \< "$(version_key "$CURRENT_VERSION")" ]; then
  cleanup_stage
  die "包里的版本 $NEW_VERSION 比这台服务器的 $CURRENT_VERSION 旧。确实要装回旧版本，加 --force"
fi
if [ "$KIND" = update ]; then
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    case "$path" in /*|..*|*/..*|.env|*/.env) cleanup_stage; die "更新包里要删除的文件不合规：$path" ;; esac
  done < <(cat "$NEW/.hx-update/deleted.txt" 2>/dev/null)
fi
free="$(df -Pk "$ROOT" | awk 'NR == 2 { print $4 }')"
[ -z "$free" ] || [ "$free" -gt 1048576 ] || { cleanup_stage; die "$ROOT 所在磁盘剩余不到 1 GB，先清理再升级"; }

# ---------- 2. 升级前的状况 ----------
# 应用内更新文件和下载页的版本对不上，是上传的文件的问题，不是服务器程序的问题：只提醒，不因此回滚。
# （v1.7.4：2026-11-19 下载目录里留着 v1.7.1 的 0.68.0 安装包，升级 v1.7.3.1 时新加的这两项不通过，整个升级被回滚。）
UPLOAD_ITEM='的应用内更新文件 updates/desktop/'
failures() { # check.sh 的失败项（只要名称），一行一项
  sed -n 's/^  失败  //p' | grep -v -F "$UPLOAD_ITEM" | sed 's/（期望 .*$//' | LC_ALL=C sort -u
}
upload_problems() { # 上传的文件对不上的项（整行，含期望和实际）
  sed -n 's/^  失败  //p' | grep -F "$UPLOAD_ITEM" | LC_ALL=C sort -u
}
reminders() { grep '^提醒：' | LC_ALL=C sort -u; }
echo "升级前检查……"
BEFORE_FAILED="$(cd "$SERVER" && bash scripts/check.sh --local 2>&1 | failures)"
BEFORE_NOTES="$(cd "$SERVER" && bash scripts/set-env.sh --show 2>&1 | reminders)"
[ -z "$BEFORE_FAILED" ] || printf '升级前已经失败的检查项（升级后不再算作新问题）：\n%s\n' "$BEFORE_FAILED" | sed 's/^/  /'

# ---------- 3. 备份 ----------
STAMP="$(date +%Y%m%d-%H%M%S)"
echo "备份账号数据库……"
(cd "$SERVER" && bash scripts/backup.sh) || { cleanup_stage; die "备份账号数据库失败，没有做任何改动"; }
DB_BACKUP="$(ls -1t "$BACKUPS"/account-*.tgz 2>/dev/null | head -1)"
[ -n "$DB_BACKUP" ] || { cleanup_stage; die "找不到刚做的数据库备份，没有做任何改动"; }
FILES_BACKUP="$BACKUPS/server-$STAMP.tgz"
echo "备份 server/ 和 portal/（含 .env）……"
(umask 077 && tar czf "$FILES_BACKUP" -C "$ROOT" server $([ -d "$ROOT/portal" ] && echo portal)) || {
  rm -f "$FILES_BACKUP"; cleanup_stage; die "备份 server/ 失败（磁盘满了？），没有做任何改动"; }
nginx_conf() {
  if [ -n "${HX_NGINX_CONF:-}" ]; then echo "$HX_NGINX_CONF"
  elif [ -d /www/server/panel/vhost/nginx ]; then echo /www/server/panel/vhost/nginx/hxbot.conf
  else echo /etc/nginx/conf.d/hxbot.conf; fi
}
NGINX_CONF="$(nginx_conf)"
NGINX_BACKUP=""
if [ -f "$NGINX_CONF" ]; then NGINX_BACKUP="$BACKUPS/nginx-$STAMP.conf"; cp -p "$NGINX_CONF" "$NGINX_BACKUP"; fi
# 正在用的镜像另起一个名字（:rollback），回滚时不用重新构建
IMAGES="$(cd "$SERVER" && docker compose config --images 2>/dev/null | grep -E '^hxbot/[a-z0-9-]+:local$' | sort -u)"
for image in $IMAGES; do
  docker image inspect "$image" >/dev/null 2>&1 && docker image tag "$image" "${image%:local}:rollback"
done
# 只留最近 5 次升级的文件备份
ls -1t "$BACKUPS"/server-*.tgz 2>/dev/null | tail -n +6 | xargs -r rm -f
ls -1t "$BACKUPS"/nginx-*.conf 2>/dev/null | tail -n +6 | xargs -r rm -f

# ---------- 回滚 ----------
STARTED=0
rollback() {
  local reason="$1"
  echo
  echo "✘ $reason"
  echo "回滚到升级前的状态……"
  trap - INT TERM
  if [ "$STARTED" = 1 ]; then (cd "$SERVER" && docker compose down) || true; fi
  if [ -d "$SERVER" ] && [ "$SERVER" = "$ROOT/server" ]; then rm -rf "$SERVER"; fi
  tar xzpf "$FILES_BACKUP" -C "$ROOT" || echo "！！还原 server/ 失败，请手工运行：tar xzpf $FILES_BACKUP -C $ROOT" >&2
  if [ -n "$NGINX_BACKUP" ]; then
    cp -p "$NGINX_BACKUP" "$NGINX_CONF"
    if nginx -t >/dev/null 2>&1; then
      if systemctl is-active --quiet nginx 2>/dev/null; then systemctl reload nginx; else nginx -s reload; fi
    else
      echo "！！还原后的 nginx 配置检查不通过，请运行 nginx -t 查看" >&2
    fi
  fi
  for image in $IMAGES; do
    docker image inspect "${image%:local}:rollback" >/dev/null 2>&1 && docker image tag "${image%:local}:rollback" "$image"
  done
  if [ "$STARTED" = 1 ]; then
    # 新版本启动时可能已经改了数据库：换回升级前一刻的备份
    echo "还原账号数据库 $(basename "$DB_BACKUP")……"
    docker run --rm --user 0 --entrypoint sh -v hxbot_account-state:/state -v "$BACKUPS:/backup" hxbot/account:local \
      -c "rm -rf /state/* && tar xzf /backup/$(basename "$DB_BACKUP") -C /state && chown -R 1000:1000 /state" ||
      echo "！！还原数据库失败，请按部署文档“数据库的备份与恢复”手工恢复 $DB_BACKUP" >&2
  fi
  (cd "$SERVER" && docker compose up -d) || echo "！！启动旧版本失败，请运行 cd $SERVER && docker compose up -d 查看" >&2
  wait_healthy || true
  cleanup_stage
  echo "已回滚到 ${CURRENT_VERSION:-升级前的版本}。升级没有完成：$reason"
  echo "日志：$LOG"
  status rolled-back "$reason"
  exit 1
}
trap 'rollback "升级被中断"' INT TERM
wait_healthy() {
  local waited=0
  while [ "$waited" -lt "$HEALTH_WAIT" ]; do
    [ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null)" = 200 ] && return 0
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

# ---------- 4. 放上新文件 ----------
echo "放上新版本的文件……"
if [ "$KIND" = full ]; then
  # 和手工升级的第 3 步一样：旧的程序文件整个换掉，不留下新版本已经不用的文件
  rm -rf "$SERVER/account/dist" "$SERVER/account/migrations"
else
  while IFS= read -r path; do
    [ -n "$path" ] && rm -rf "${SERVER:?}/$path"
  done < <(cat "$NEW/.hx-update/deleted.txt" 2>/dev/null)
fi
rm -rf "$NEW/.hx-update"
rm -f "$NEW/.env"
cp -a "$NEW/." "$SERVER/" || rollback "复制新文件失败（磁盘满了？）"
chmod 600 "$SERVER/.env"
if [ -d "$SERVER/portal" ]; then
  mkdir -p "$ROOT/portal"
  cp -r "$SERVER/portal/." "$ROOT/portal/" || rollback "更新门户页失败"
fi
echo "更新 nginx 配置……"
(cd "$SERVER" && bash scripts/setup-https.sh) || rollback "更新 nginx 配置失败（setup-https.sh 的报错见上面）"

# ---------- 5. 核对配置、启动、检查 ----------
show="$(cd "$SERVER" && bash scripts/set-env.sh --show 2>&1)"
show_status=$?
new_notes="$(LC_ALL=C comm -13 <(printf '%s\n' "$BEFORE_NOTES" | sed '/^$/d') <(printf '%s\n' "$show" | reminders))"
if [ "$show_status" -ne 0 ] || [ -n "$new_notes" ]; then
  printf '%s\n' "$show" | sed 's/^/  /'
  rollback "新版本的配置还没有填好（见上面的“还没有填写”或“提醒：”）。按部署文档补好配置后再升级"
fi
echo "构建并启动新版本（几分钟）……"
STARTED=1
(cd "$SERVER" && docker compose up -d --build) || rollback "docker compose up -d --build 失败（报错见上面）"
echo "等账号服务就绪……"
wait_healthy || rollback "账号服务 $HEALTH_WAIT 秒内没有就绪（docker compose logs account 查看原因）"
echo "升级后检查……"
settled=0
while :; do
  after="$(cd "$SERVER" && bash scripts/check.sh --local 2>&1)"
  new_failures="$(LC_ALL=C comm -13 <(printf '%s\n' "$BEFORE_FAILED" | sed '/^$/d') <(printf '%s\n' "$after" | failures))"
  { [ -n "$new_failures" ] && [ "$settled" -lt "$SETTLE_WAIT" ]; } || break
  # 刚重启的信令服务要几秒才开始监听，coturn 的第一次健康检查在启动 15 秒后：等一会儿再查
  echo "  还没通过（服务可能还在启动，${SETTLE_STEP} 秒后重查，已等 ${settled} 秒，最多 ${SETTLE_WAIT} 秒）：${new_failures//$'\n'/；}"
  sleep "$SETTLE_STEP"
  settled=$((settled + SETTLE_STEP))
done
printf '%s\n' "$after"
# 多项之间用全角分号连起来（tr 按字节替换，会把多字节的“；”切坏）
[ -z "$new_failures" ] || rollback "升级后新出现的失败项：${new_failures//$'\n'/；}"

trap - INT TERM
for image in $IMAGES; do docker image rm "${image%:local}:rollback" >/dev/null 2>&1 || true; done
cleanup_stage
docker image prune -f >/dev/null 2>&1 || true
echo
echo "✔ 已升级到 $NEW_VERSION。升级前的文件备份：$FILES_BACKUP；数据库备份：$DB_BACKUP"
upload_issues="$(printf '%s\n' "$after" | upload_problems)"
if [ -n "$upload_issues" ]; then
  echo
  echo "！！提醒（不影响这次升级）：下载页和应用内更新文件的版本对不上，已装的客户端可能收不到新版本："
  printf '%s\n' "$upload_issues" | sed 's/^/  /'
  echo "  运行 python3 /opt/hxbot/server/scripts/publish-downloads.py /opt/hxbot/downloads，按最后的大字提示处理"
  echo "  （下载目录里留着更高版本的旧安装包时，把它挪走；应用内更新文件没传时，补传）。"
fi
echo "  浏览器里已经打开的 HXBot 页面要关掉重开（或 Ctrl+F5）。客户端在应用里检查更新即可拿到新版（要先把新安装包上传到下载中心）。"
status updated "$NEW_VERSION"
