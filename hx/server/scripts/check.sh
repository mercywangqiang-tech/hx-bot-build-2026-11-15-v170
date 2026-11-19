#!/usr/bin/env bash
# 检查 HXBot 服务器是否部署正确。在服务器上运行：
#   bash /opt/hxbot/server/scripts/check.sh            # 通过公网域名检查（DNS、证书都要已生效）
#   bash /opt/hxbot/server/scripts/check.sh --local    # 绕过 DNS，直接连本机 nginx（证书未生效时也能检查路由）
# 每一项显示 “通过” 或 “失败”，最后汇总。
set -uo pipefail

SITE=bot.hxallai.com
API=api.bot.hxallai.com
SIGNAL=signal.bot.hxallai.com
TURN=turn.bot.hxallai.com

CURL=(curl --noproxy '*' -s --max-time 10)
if [ "${1:-}" = "--local" ]; then
  CURL+=(-k --resolve "$SITE:443:127.0.0.1" --resolve "$API:443:127.0.0.1" --resolve "$SIGNAL:443:127.0.0.1" --resolve "$SITE:80:127.0.0.1")
fi

pass=0
fail=0
check() { # 名称 期望 实际
  if [ "$3" = "$2" ]; then
    printf '  通过  %s\n' "$1"
    pass=$((pass + 1))
  else
    printf '  失败  %s（期望 %s，实际 %s）\n' "$1" "$2" "$3"
    fail=$((fail + 1))
  fi
}
code() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@"; }
# 这台服务器能不能连上一个外部接口：有任何 HTTP 回答就算连得上，000 是连不上
reach() { local c; c="$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 8 "https://$1/" 2>/dev/null)"; { [ -n "$c" ] && [ "$c" != 000 ]; } && echo ok || echo 连不上; }
location() { "${CURL[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' "$@"; }

echo "== 本机服务 =="
check "账号服务 127.0.0.1:8787" 200 "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8787/health/live)"
signal_code() { curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8081/v1/signal; }
# 刚启动（docker compose up 之后）的信令服务要几秒才开始监听：连不上时每 5 秒再试，最多 30 秒
signal_now="$(signal_code)"
for _ in 1 2 3 4 5 6; do [ "$signal_now" = 000 ] || break; sleep 5; signal_now="$(signal_code)"; done
check "信令服务 127.0.0.1:8081（未升级的请求应返回 404）" 404 "$signal_now"
if command -v docker >/dev/null 2>&1; then
  coturn_id="$(docker ps -qf name=hxbot-coturn 2>/dev/null)"
  turn_state="$( { [ -n "$coturn_id" ] && docker inspect -f '{{.State.Health.Status}}' "$coturn_id" 2>/dev/null; } || echo 未运行)"
  # 刚启动的 coturn 第一次健康检查在 15 秒后，之前是 starting：每 5 秒再看，最多 60 秒
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    [ "$turn_state" = starting ] || break
    sleep 5
    turn_state="$(docker inspect -f '{{.State.Health.Status}}' "$coturn_id" 2>/dev/null || echo 未运行)"
  done
  check "中继服务 coturn 健康" healthy "$turn_state"
  cron_id="$(docker ps -qf name=hxbot-account-cron 2>/dev/null)"
  cron_last="$( [ -n "$cron_id" ] && docker logs --tail 20 "$cron_id" 2>&1 | grep '定时任务' | tail -1 || true)"
  case "$cron_id:$cron_last" in
    :*) cron_state="未运行" ;;
    *"定时任务 200"*|*"每 300 秒"*|*:) cron_state=正常 ;;
    *) cron_state="$cron_last" ;;
  esac
  check "定时任务容器（启动 5 分钟后第一次运行）" 正常 "$cron_state"
  account_id="$(docker ps -qf name=hxbot-account-1 2>/dev/null)"
  # 解压了新部署包却没有重新构建容器时，网页版还是旧的（例如开屏动画还是旧角色）
  build_file="$(cd "$(dirname "$0")/.." && pwd)/account/dist/BUILD_ID"
  if [ -n "$account_id" ] && [ -f "$build_file" ]; then
    running_build="$(docker exec "$account_id" cat /app/dist/BUILD_ID 2>/dev/null || true)"
    check "运行中的账号服务和网页版就是当前部署包（不一致时在 server 目录运行 docker compose up -d --build）" "$(cat "$build_file")" "${running_build:-更早的版本}"
  fi
  login_mode="$( [ -n "$account_id" ] && docker logs "$account_id" 2>&1 | grep -o '登录方式为[^（]*' | tail -1 || echo 未运行)"
  check "登录方式（每个人用邮箱和自己的密码登录）" "登录方式为邮箱 + 密码" "${login_mode:-未知}"
fi
check "访问日志与日志轮转（保存 200 天，不少于 6 个月）" ok "$([ -f /var/log/hxbot/access.log ] && grep -qs 'rotate 200' /etc/logrotate.d/hxbot && echo ok || echo '未配置，请运行 setup-https.sh')"

echo "== 门户 $SITE =="
check "http 跳转到 https" "301 https://$SITE/app" "$(location "http://$SITE/app")"
check "门户首页" 200 "$(code "https://$SITE/")"
check "门户英文版 /en/" 200 "$(code "https://$SITE/en/")"
check "网页版 /app" 200 "$(code "https://$SITE/app")"
check "未登录访问下载目录 → 回到登录" "302 https://$SITE/?login=1" "$(location "https://$SITE/downloads/manifest.json")"
# iOS 无线安装：没发布过的随机串应返回 404（返回 302 说明 nginx 还是旧配置，重新运行 setup-https.sh）
check "iOS 无线安装地址只认服务器生成的随机串" 404 "$(code "https://$SITE/ota/00000000000000000000000000000000/manifest.plist")"
ota_of() { python3 -c 'import json, sys
try:
    items = json.load(open(sys.argv[1], encoding="utf-8")).get("items", [])
    print(next((item.get("ota") or "" for item in items if item.get("platform") == sys.argv[2]), ""))
except Exception:
    print("")' "${HX_DOWNLOADS:-/opt/hxbot/downloads}/manifest.json" "$1" 2>/dev/null; }
ota="$(ota_of ios)"
if [ -n "$ota" ]; then
  check "iOS 无线安装清单（手机系统不带登录状态来取）" 200 "$(code "https://$SITE$ota")"
  check "iOS 安装包（同上）" 200 "$(code -I "https://$SITE${ota%manifest.plist}HXBot.ipa")"
fi
# 应用内更新（v1.6.2 起）：更新文件只给带登录令牌的客户端；安卓新版安装包由系统浏览器下载，用随机串地址
check "未登录取应用内更新信息 → 401（返回 404 说明 nginx 还是旧配置，重新运行 setup-https.sh）" 401 "$(code "https://$SITE/updates/mobile.json")"
check "带无效令牌取桌面端更新信息 → 401" 401 "$(code -H "Authorization: Bearer hx-check-invalid" "https://$SITE/updates/desktop/latest.yml")"
# v1.7.3 紧急修正：下载页有新安装包、应用内更新文件却没传（或还是旧版本）时，已装的客户端在应用里收不到新版本
version_of() { python3 -c 'import json, sys
try:
    items = json.load(open(sys.argv[1], encoding="utf-8")).get("items", [])
    print(next((item.get("version") or "" for item in items if item.get("platform") == sys.argv[2]), ""))
except Exception:
    print("")' "${HX_DOWNLOADS:-/opt/hxbot/downloads}/manifest.json" "$1" 2>/dev/null; }
feed_version() { sed -n 's/^version:[[:space:]]*["'"'"']\{0,1\}\([0-9][0-9A-Za-z.+-]*\).*/\1/p' "${HX_DOWNLOADS:-/opt/hxbot/downloads}/updates/desktop/$1" 2>/dev/null | head -1; }
for pair in "macos latest-mac.yml Mac" "windows latest.yml Windows"; do
  set -- $pair
  want="$(version_of "$1")"
  [ -n "$want" ] || continue
  have="$(feed_version "$2")"
  check "$3 的应用内更新文件 updates/desktop/$2 和下载页同为 $want 版（不一致时用交付文件夹 client 里的“上传应用内更新”补传）" "$want" "${have:-没有上传}"
done
ota="$(ota_of android)"
if [ -n "$ota" ]; then
  check "安卓新版安装包（应用里点“更新”后由系统浏览器下载）" 200 "$(code -I "https://$SITE$ota")"
fi
# 注册：开着的验证要有对应的服务才能注册。settings 接口只说明开关和是否配好，不含任何密钥
settings="$("${CURL[@]}" "https://$SITE/api/browser/hx/settings")"
registration="$(printf '%s' "$settings" | python3 -c 'import json, sys
try:
    s = json.load(sys.stdin)
    problems = []
    if s["emailCode"] and not s["ready"]["email"]:
        problems.append("邮箱验证开着，但发信邮箱没有填好（部署文档 5.3 节）")
    if s["phoneCode"] and not s["ready"]["sms"]:
        problems.append("手机验证开着，但阿里云短信没有填好（部署文档 5.4 节）")
    print("；".join(problems) or "ok")
except Exception:
    print("读不到注册设置（账号服务没有运行，或还是旧版本）")' 2>/dev/null)"
check "注册可用（开着的验证都配好了对应的服务）" ok "${registration:-读不到注册设置}"
# 配好了的服务再实际连一次：发信邮箱用 .env 里的账号登录 SMTP 服务器（不发邮件），短信只看接口连不连得上（不发短信）
server_dir="$(cd "$(dirname "$0")/.." && pwd)"
case "$settings" in *'"email":true'*)
  if [ -f "$server_dir/.env" ]; then
    mail_test="$(bash "$server_dir/scripts/set-env.sh" --test-mail 2>&1 | tail -1)"
    check "发信邮箱能登录（地址和密码正确；失败时见部署文档 5.3 节）" ok "$([[ "$mail_test" == ✔* ]] && echo ok || echo "${mail_test:0:120}")"
  fi ;;
esac
case "$settings" in *'"sms":true'*)
  check "服务器能连上阿里云短信接口 dysmsapi.aliyuncs.com（实际发一条用 bash scripts/set-env.sh --test-sms 手机号）" ok "$(reach dysmsapi.aliyuncs.com)" ;;
esac
providers="$(printf '%s' "$settings" | python3 -c 'import json, sys
names = {"wechat": "微信", "alipay": "支付宝", "douyin": "抖音", "apple": "Apple", "google": "Google", "facebook": "Facebook"}
try:
    print("、".join(names.get(p, p) for p in json.load(sys.stdin)["providers"]) or "无")
except Exception:
    print("未知")' 2>/dev/null)"
printf '  说明  已开启的第三方登录：%s\n' "${providers:-未知}"
# 已开启的每一家：点按钮后应转到这一家自己的授权页（转不过去说明这一家的设置不完整）
# 再看服务器自己能不能连上这一家的接口：用户授权回来后，账号服务要到这个接口换取身份，连不上就卡在最后一步。
# 服务器在中国大陆时连不上 Google 和 Facebook 的接口，这两家请不要开启（清空它的两项设置即可关闭）。
for pair in wechat=open.weixin.qq.com=api.weixin.qq.com alipay=openauth.alipay.com=openapi.alipay.com douyin=open.douyin.com=open.douyin.com \
  apple=appleid.apple.com=appleid.apple.com google=accounts.google.com=oauth2.googleapis.com facebook=www.facebook.com=graph.facebook.com; do
  provider="${pair%%=*}"
  rest="${pair#*=}"
  host="${rest%%=*}"
  backend="${rest#*=}"
  case "$settings" in *"\"$provider\""*) ;; *) continue ;; esac
  went="$(location "https://$SITE/api/browser/hx/oauth/$provider/start")"
  check "第三方登录 $provider：转到 $host 的授权页" ok "$([[ "$went" == "302 https://$host/"* ]] && echo ok || echo "${went:0:80}")"
  check "第三方登录 $provider：服务器能连上 $backend（连不上时登录卡在最后一步）" ok "$(reach "$backend")"
done
check "本地调试接口已屏蔽" 404 "$(code "https://$SITE/cdn-cgi/handler/scheduled")"
check "上游官网页面已转回下载页（/pricing）" "302 https://$SITE/" "$(location "https://$SITE/pricing")"
check "网站图标" 200 "$(code "https://$SITE/favicon-32x32.png")"
check "上游官网页面已转回下载页（/pt）" "302 https://$SITE/" "$(location "https://$SITE/pt")"
check "邀请页 /join" 200 "$(code "https://$SITE/join")"
for page in guide whats-new terms privacy; do
  check "页面 /$page/（中文）" 200 "$(code "https://$SITE/$page/")"
  check "页面 /en/$page/（英文）" 200 "$(code "https://$SITE/en/$page/")"
done
check "使用指南含“服务端”一节（帮助菜单打开 /guide/#server）" ok "$("${CURL[@]}" "https://$SITE/guide/" | grep -q 'id="server"' && echo ok || echo 缺少)"
check "/terms 补上结尾的 /" "301 https://$SITE/terms/" "$(location "https://$SITE/terms")"
check "找不到的页面显示 HXBot 自己的 404 页" "Page not found · HXBot" "$("${CURL[@]}" "https://$SITE/app/no-such-page" | grep -ao 'Page not found · HXBot' | head -1)"
check "账号服务自身也拦截上游页面（绕过 nginx 直连）" "302 https://$SITE/" "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 5 -H 'Accept: text/html' http://127.0.0.1:8787/pricing)"
check "账号服务把旧的隐私政策地址转到新页面（绕过 nginx 直连）" "302 https://$SITE/privacy/" "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 5 -H 'Accept: text/html' http://127.0.0.1:8787/privacy-policy)"
check "MCP 登录身份为 HXBot（bot.hxallai.com）" '"client_id":"https://bot.hxallai.com/oauth/mcp-client.json"' "$("${CURL[@]}" "https://$SITE/oauth/mcp-client.json" | grep -o '"client_id":"[^"]*"')"
aasa="$("${CURL[@]}" "https://$SITE/.well-known/apple-app-site-association")"
check "iOS 关联文件（不含上游应用）" ok "$([[ "$aasa" == *'"applinks"'* && "$aasa" != *openbot* ]] && echo ok || echo "${aasa:0:80}")"

echo "== 账号服务 $API =="
check "健康检查" 200 "$(code "https://$API/health/live")"
kid="$("${CURL[@]}" "https://$API/.well-known/jwks.json" | grep -o '"kid":"[^"]*"' | head -1)"
check "票据公钥 JWKS" '"kid":"hxbot-remote-1"' "$kid"
check "本地调试接口已屏蔽" 404 "$(code "https://$API/cdn-cgi/handler/scheduled")"
check "接口域名的首页转回下载页" "302 https://$SITE/" "$(location "https://$API/")"
check "接口域名的 /privacy/ 转到门户" "302 https://$SITE/privacy/" "$(location "https://$API/privacy/")"

echo "== 信令 $SIGNAL =="
ws="$("${CURL[@]}" -o /dev/null -w '%{http_code}' --http1.1 --max-time 3 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "https://$SIGNAL/v1/signal")"
# 没带票据时信令会拒绝，但 nginx 必须把升级请求转过去：101 或 4xx 都说明链路通了，502/000 才是没通。
case "$ws" in 101|400|401|403|404|426) ws=ok ;; esac
check "WebSocket 能到达信令服务" ok "$ws"
check "内部接口已屏蔽" 404 "$(code -X POST "https://$SIGNAL/internal/auth-events")"

if [ "${1:-}" != "--local" ]; then
  echo "== 证书与 DNS =="
  for host in "$SITE" "$API" "$SIGNAL" "$TURN"; do
    ip="$(getent hosts "$host" | awk '{print $1}' | head -1)"
    check "DNS $host 已解析" yes "$([ -n "$ip" ] && echo yes || echo no)"
  done
  expiry="$(echo | openssl s_client -servername "$SITE" -connect "$SITE:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  check "证书有效（到期：${expiry:-未知}）" yes "$([ -n "$expiry" ] && echo yes || echo no)"
fi

echo
echo "通过 $pass 项，失败 $fail 项。"
[ "$fail" -eq 0 ]
