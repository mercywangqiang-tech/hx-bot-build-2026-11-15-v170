#!/bin/sh
# HXBot 账号服务容器入口。
#   serve（默认）：写入运行变量 → 应用数据库迁移 → 在 workerd 中运行账号服务（端口 8787）
#                 登录方式：每个人用邮箱和自己的密码登录（注册账号）。注册时的验证码和第三方登录由 .env 决定
#   cron        ：每 5 分钟触发一次账号服务的定时任务（清理过期验证码、补发吊销事件等）
set -eu

APP_DIR="${HXBOT_APP_DIR:-/app}"
STATE_DIR="${HXBOT_STATE_DIR:-/state}"
ACCOUNT_URL="${HXBOT_ACCOUNT_URL:-http://account:8787}"
CONFIG="$APP_DIR/dist/server/wrangler.json"
export WRANGLER_SEND_METRICS=false
export CLOUDFLARE_CF_FETCH_ENABLED=false
# 不写调试日志文件、不在 /state 里累积请求追踪、关闭本地数据浏览接口（只留业务数据）
export WRANGLER_WRITE_LOGS=false
export X_LOCAL_OBSERVABILITY=false
export X_LOCAL_EXPLORER=false

if [ "${1:-serve}" = "cron" ]; then
  echo "account-cron: 每 300 秒触发一次定时任务"
  export ACCOUNT_URL
  while true; do
    sleep 300
    # 本地运行时只接受 Host 为 localhost 的 /cdn-cgi 请求，Node 的 fetch 不能改 Host，所以用 http 模块
    node -e '
      const url = new URL(process.env.ACCOUNT_URL);
      require("http").get({
        host: url.hostname, port: url.port || 80, path: "/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*",
        headers: { Host: "localhost" }, timeout: 120000,
      }, (res) => {
        res.resume();
        const ok = res.statusCode === 200;
        (ok ? console.log : console.error)(new Date().toISOString(), ok ? "定时任务 200" : "定时任务失败 " + res.statusCode);
      }).on("timeout", function () { this.destroy(new Error("timeout")); })
        .on("error", (e) => console.error(new Date().toISOString(), "定时任务失败", e.message));
    '
  done
fi

need() {
  eval "value=\${$1:-}"
  if [ -z "$value" ]; then
    echo "缺少环境变量 $1，请检查 hx/server/.env（可运行 scripts/init-secrets.sh 生成）。" >&2
    exit 1
  fi
}
for name in REMOTE_TICKET_KEY_ID REMOTE_TICKET_PRIVATE_JWK REMOTE_TICKET_PUBLIC_JWKS REMOTE_AUTH_WEBHOOK_SECRET \
  SKILLS_ADMIN_TOKEN SITE_REPORT_HASH_SECRET SIGNAL_DOMAIN; do
  need "$name"
done

# 登录方式：每个人用邮箱和自己的密码登录（注册账号）。注册时默认验证邮箱（发信邮箱五项）和手机号（阿里云短信四项），
# 两项各有一个开关：HX_EMAIL_VERIFICATION=off、HX_PHONE_VERIFICATION=off。
# 开着验证却没配好对应的服务时，账号服务照常启动（已注册的人照常登录），只是注册页会提示暂时不能注册，这里给出提醒。
smtp_complete=yes
for name in EMAIL_SMTP_HOST EMAIL_SMTP_PORT EMAIL_SMTP_USERNAME EMAIL_SMTP_PASSWORD EMAIL_FROM; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || smtp_complete=no
done
# 账号服务发信时从第一个字节就加密，只能用 465 端口；填了别的端口等于没有配置
[ "${EMAIL_SMTP_PORT:-}" = 465 ] || smtp_complete=no
if [ "$smtp_complete" = no ]; then
  EMAIL_SMTP_HOST='' EMAIL_SMTP_PORT='' EMAIL_SMTP_USERNAME='' EMAIL_SMTP_PASSWORD='' EMAIL_FROM=''
fi
sms_complete=yes
for name in HX_SMS_ACCESS_KEY_ID HX_SMS_ACCESS_KEY_SECRET HX_SMS_SIGN_NAME HX_SMS_TEMPLATE_CODE; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || sms_complete=no
done
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
email_check=开启
[ "$(lower "${HX_EMAIL_VERIFICATION:-}")" = off ] && email_check=关闭
phone_check=开启
[ "$(lower "${HX_PHONE_VERIFICATION:-}")" = off ] && phone_check=关闭
echo "账号服务：登录方式为邮箱 + 密码（注册账号；邮箱验证$email_check，手机验证$phone_check）"
if [ "$email_check" = 开启 ] && [ "$smtp_complete" = no ]; then
  echo "提醒：邮箱验证开着，但发信邮箱（EMAIL_SMTP_HOST 等五项）没有填全或端口不是 465，现在不能注册、不能找回密码。见部署文档 5.3 节。" >&2
fi
if [ "$phone_check" = 开启 ] && [ "$sms_complete" = no ]; then
  echo "提醒：手机验证开着，但阿里云短信（HX_SMS_ 开头的四项）没有填全，现在不能注册。见部署文档 5.4 节。" >&2
fi
providers=''
[ -n "${HX_WECHAT_APP_ID:-}" ] && [ -n "${HX_WECHAT_APP_SECRET:-}" ] && providers="$providers 微信"
[ -n "${HX_ALIPAY_APP_ID:-}" ] && [ -n "${HX_ALIPAY_PRIVATE_KEY:-}" ] && providers="$providers 支付宝"
[ -n "${HX_DOUYIN_CLIENT_KEY:-}" ] && [ -n "${HX_DOUYIN_CLIENT_SECRET:-}" ] && providers="$providers 抖音"
[ -n "${HX_APPLE_SERVICE_ID:-}" ] && [ -n "${HX_APPLE_TEAM_ID:-}" ] && [ -n "${HX_APPLE_KEY_ID:-}" ] && [ -n "${HX_APPLE_PRIVATE_KEY:-}" ] && providers="$providers Apple"
[ -n "${HX_GOOGLE_CLIENT_ID:-}" ] && [ -n "${HX_GOOGLE_CLIENT_SECRET:-}" ] && providers="$providers Google"
[ -n "${HX_FACEBOOK_APP_ID:-}" ] && [ -n "${HX_FACEBOOK_APP_SECRET:-}" ] && providers="$providers Facebook"
echo "账号服务：第三方登录已开启：${providers:- 无}"

# 运行变量写入 .dev.vars（wrangler 本地运行时读取它，覆盖 wrangler.json 里的同名 vars）。
# 值一律用单引号包起来：JWK 是 JSON，里面有双引号，但不会有单引号。
DEV_VARS="$APP_DIR/dist/server/.dev.vars"
umask 077
: > "$DEV_VARS"
put() {
  eval "value=\${$1:-}"
  case "$value" in *"'"*) echo "环境变量 $1 里不能有单引号。" >&2; exit 1 ;; esac
  printf "%s='%s'\n" "$1" "$value" >> "$DEV_VARS"
}
for name in EMAIL_SMTP_HOST EMAIL_SMTP_PORT EMAIL_SMTP_USERNAME EMAIL_SMTP_PASSWORD EMAIL_FROM \
  REMOTE_TICKET_KEY_ID REMOTE_TICKET_PRIVATE_JWK REMOTE_TICKET_PUBLIC_JWKS REMOTE_AUTH_WEBHOOK_SECRET \
  SKILLS_ADMIN_TOKEN SITE_REPORT_HASH_SECRET HX_ALLOWED_EMAILS HX_ALLOWED_EMAIL_DOMAINS HX_LOGIN_PASSWORD HX_APPLE_TEAM_ID \
  HX_EMAIL_VERIFICATION HX_PHONE_VERIFICATION HX_SMS_ACCESS_KEY_ID HX_SMS_ACCESS_KEY_SECRET HX_SMS_SIGN_NAME HX_SMS_TEMPLATE_CODE \
  HX_WECHAT_APP_ID HX_WECHAT_APP_SECRET HX_ALIPAY_APP_ID HX_ALIPAY_PRIVATE_KEY HX_DOUYIN_CLIENT_KEY HX_DOUYIN_CLIENT_SECRET \
  HX_APPLE_SERVICE_ID HX_APPLE_KEY_ID HX_APPLE_PRIVATE_KEY HX_GOOGLE_CLIENT_ID HX_GOOGLE_CLIENT_SECRET \
  HX_FACEBOOK_APP_ID HX_FACEBOOK_APP_SECRET; do
  put "$name"
done
printf "REMOTE_SIGNAL_URL='wss://%s/v1/signal'\n" "$SIGNAL_DOMAIN" >> "$DEV_VARS"
printf "REMOTE_AUTH_WEBHOOK_URL='http://signal:8081/internal/auth-events'\n" >> "$DEV_VARS"
# 仅用于排查邮件验证码登录：设为 true 时验证码直接出现在接口返回里，不发邮件。生产环境必须是 false。
printf "AUTH_EXPOSE_DEVELOPMENT_CODE='%s'\n" "${AUTH_EXPOSE_DEVELOPMENT_CODE:-false}" >> "$DEV_VARS"

mkdir -p "$STATE_DIR"
echo "账号服务：应用数据库迁移……"
wrangler d1 migrations apply hxbot-account --local --config "$CONFIG" --persist-to "$STATE_DIR"

echo "账号服务：启动（0.0.0.0:8787，仅由宿主机 127.0.0.1:8787 对外）"
exec wrangler dev --config "$CONFIG" --local --persist-to "$STATE_DIR" \
  --ip 0.0.0.0 --port 8787 --test-scheduled --show-interactive-dev-session=false --log-level log
