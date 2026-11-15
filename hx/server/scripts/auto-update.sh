#!/usr/bin/env bash
# HXBot 服务器自动更新（v1.6.2 起，默认关闭）。在服务器上以 root 运行：
#   bash /opt/hxbot/server/scripts/auto-update.sh --enable https://你的地址/hxbot/server/   打开：每天 05:07 检查一次
#   bash /opt/hxbot/server/scripts/auto-update.sh --disable                                 关闭
#   bash /opt/hxbot/server/scripts/auto-update.sh --status                                  当前设置和最近一次的结果
#   bash /opt/hxbot/server/scripts/auto-update.sh --now                                     立刻检查一次（打开后才能用）
#
# 地址是你放部署包的目录（只能是 https），里面要有 package-release.sh 生成的 latest.json 和对应的部署包。
# 检查时先取 latest.json：版本比这台服务器新，就下载能直接用的那个包（这台服务器正好是更新包的起点时下载更新包，
# 否则下载全量包），核对 SHA-256 后交给 update.sh 升级；升级失败 update.sh 会自动回滚。
# 只有能改这个地址里的文件的人才能让服务器升级：地址要放在只有你能上传的地方。
set -uo pipefail

ROOT="${HX_ROOT:-/opt/hxbot}"
SERVER="$ROOT/server"
CONF_DIR="${HX_CONF_DIR:-/etc/hxbot}"
CONF="$CONF_DIR/auto-update.conf"
CRON="${HX_CRON_FILE:-/etc/cron.d/hxbot-auto-update}"
LOG_DIR="${HX_LOG_DIR:-/var/log/hxbot}"
STATE_DIR="${HX_STATE_DIR:-/var/lib/hxbot}"
DOWNLOADS="$ROOT/.auto-update"
usage() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
[ "${HX_TEST_ALLOW_USER:-}" = 1 ] || [ "$(id -u)" -eq 0 ] || { echo "请用 root 运行。" >&2; exit 1; }
[ $# -ge 1 ] || usage

configured_url() { [ -f "$CONF" ] && sed -n 's/^URL=//p' "$CONF" | head -1; }
one_line() { [ -f "$1" ] && head -1 "$1" | tr -cd 'A-Za-z0-9.+-' || true; }
CURL=(curl --proto '=https' --tlsv1.2 -fsS --retry 2 --max-time 1800)

case "$1" in
  --enable)
    [ $# -eq 2 ] || usage
    url="${2%/}/"
    [[ "$url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~%/-]*)?$ ]] || {
      echo "地址要是 https:// 开头的目录地址，例如 https://www.hxallai.com/hxbot/server/" >&2; exit 1; }
    echo "检查 ${url}latest.json ……"
    latest="$("${CURL[@]}" --max-time 30 "${url}latest.json")" || { echo "取不到 ${url}latest.json，没有打开自动更新。" >&2; exit 1; }
    printf '%s' "$latest" | python3 -c 'import json, sys; d = json.load(sys.stdin); assert d["version"] and d["full"]["file"] and d["full"]["sha256"]' 2>/dev/null ||
      { echo "${url}latest.json 不是 package-release.sh 生成的文件，没有打开自动更新。" >&2; exit 1; }
    install -d -m 0755 "$CONF_DIR"
    printf 'URL=%s\n' "$url" > "$CONF"
    chmod 0644 "$CONF"
    install -d -m 0755 "$(dirname "$CRON")"
    cat > "$CRON" <<CRONTAB
# HXBot 服务器自动更新（auto-update.sh --enable 生成；关闭：auto-update.sh --disable）
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
7 5 * * * root bash $SERVER/scripts/auto-update.sh --now --scheduled >> $LOG_DIR/update.log 2>&1
CRONTAB
    chmod 0644 "$CRON"
    echo "已打开自动更新：每天 05:07 检查 ${url}latest.json（最新版本 $(printf '%s' "$latest" | python3 -c 'import json, sys; print(json.load(sys.stdin)["version"])')）。"
    echo "这台服务器现在是 $(one_line "$SERVER/VERSION")。立刻检查一次：bash $0 --now"
    ;;
  --disable)
    [ $# -eq 1 ] || usage
    rm -f "$CRON"
    echo "已关闭自动更新。手工升级：bash $SERVER/scripts/update.sh 部署包.zip"
    ;;
  --status)
    [ $# -eq 1 ] || usage
    echo "这台服务器：$(one_line "$SERVER/VERSION")（提交 $(one_line "$SERVER/BUILD_COMMIT")）"
    if [ -f "$CRON" ]; then echo "自动更新：已打开，每天 05:07 检查 $(configured_url)latest.json"; else echo "自动更新：已关闭"; fi
    if [ -f "$STATE_DIR/update-status" ]; then
      IFS=$'\t' read -r when result detail < "$STATE_DIR/update-status"
      case "$result" in
        updated) result="已升级到 $detail" ;;
        unchanged) result="已经是最新（$detail）" ;;
        rolled-back) result="升级失败，已回滚：$detail" ;;
        failed) result="没有升级：$detail" ;;
      esac
      echo "最近一次：$when $result"
    fi
    echo "日志：$LOG_DIR/update.log"
    ;;
  --now)
    [ $# -le 2 ] || usage
    scheduled=0
    [ "${2:-}" = "--scheduled" ] && scheduled=1
    [ $# -eq 1 ] || [ "$scheduled" = 1 ] || usage
    url="$(configured_url)"
    [ -n "$url" ] || { echo "还没有打开自动更新：bash $0 --enable 地址" >&2; exit 1; }
    # 定时任务在关掉之后不再升级（关闭和定时任务撞上的情况）
    [ "$scheduled" = 0 ] || [ -f "$CRON" ] || exit 0
    echo
    echo "== $(date '+%F %T') 自动更新：检查 ${url}latest.json"
    status() { install -d -m 0700 "$STATE_DIR"; printf '%s\t%s\t%s\n' "$(date '+%F %T')" "$1" "$2" > "$STATE_DIR/update-status"; }
    latest="$("${CURL[@]}" --max-time 30 "${url}latest.json")" || { status failed "取不到 ${url}latest.json"; echo "取不到 ${url}latest.json" >&2; exit 1; }
    choice="$(printf '%s' "$latest" | python3 -c '
import json, re, sys
current_version, current_commit = sys.argv[1], sys.argv[2]
data = json.load(sys.stdin)
def key(version):
    return tuple(int(part) for part in re.findall(r"\d+", version)[:4])
def safe(entry):
    name, digest = str(entry.get("file", "")), str(entry.get("sha256", ""))
    if not re.fullmatch(r"hxbot-server-(update-)?v[0-9][0-9.]*\.zip", name) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise SystemExit("bad")
    return name, digest
version = str(data["version"])
if not re.fullmatch(r"[0-9]+(\.[0-9]+){1,3}", version):
    raise SystemExit("bad")
if current_version and key(version) <= key(current_version):
    print("latest", version)
    raise SystemExit(0)
for entry in data.get("updates", []):
    if current_commit and entry.get("fromCommit") == current_commit:
        print("update", version, *safe(entry))
        raise SystemExit(0)
print("full", version, *safe(data["full"]))
' "$(one_line "$SERVER/VERSION")" "$(one_line "$SERVER/BUILD_COMMIT")" 2>/dev/null)" || {
      status failed "${url}latest.json 的内容不对"; echo "${url}latest.json 的内容不对，没有升级。" >&2; exit 1; }
    read -r kind version file digest <<< "$choice"
    if [ "$kind" = latest ]; then
      echo "已经是最新版本（$version）。"
      status unchanged "$version"
      exit 0
    fi
    echo "有新版本 $version，下载 $file ……"
    install -d -m 0700 "$DOWNLOADS"
    find "$DOWNLOADS" -maxdepth 1 -name 'hxbot-server-*.zip*' -mtime +7 -delete
    target="$DOWNLOADS/$file"
    if ! { [ -f "$target" ] && [ "$(sha256sum "$target" | cut -d' ' -f1)" = "$digest" ]; }; then
      rm -f "$target.part"
      "${CURL[@]}" -o "$target.part" "$url$file" || { rm -f "$target.part"; status failed "下载 $file 失败"; echo "下载 $file 失败。" >&2; exit 1; }
      [ "$(sha256sum "$target.part" | cut -d' ' -f1)" = "$digest" ] || {
        rm -f "$target.part"; status failed "$file 的 SHA-256 和 latest.json 不一致"; echo "$file 的 SHA-256 和 latest.json 不一致，没有升级。" >&2; exit 1; }
      mv -f "$target.part" "$target"
    fi
    HX_UPDATE_LOGGED="$scheduled" bash "$SERVER/scripts/update.sh" "$target"
    result=$?
    [ "$result" -ne 0 ] || rm -f "$target"
    exit "$result"
    ;;
  *) usage ;;
esac
