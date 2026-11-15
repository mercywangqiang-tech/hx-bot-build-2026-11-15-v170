#!/usr/bin/env bash
# 为 HXBot 配置 nginx 站点并申请 HTTPS 证书（Let's Encrypt，免费，自动续期）。
# 在服务器上以 root 运行：bash /opt/hxbot/server/scripts/setup-https.sh 你的邮箱
# 证书已经申请过时可以不写邮箱（升级时 update.sh 就这样运行它）。
#
# 前提：四个域名（bot / api.bot / signal.bot / turn.bot .hxallai.com）已解析到本机公网 IP，
#       阿里云安全组已放行 80、443 端口，nginx 正在运行。
# 做的事：
#   1. 找到 nginx 的站点配置目录（/etc/nginx/conf.d，或宝塔面板的 /www/server/panel/vhost/nginx）
#   2. 安装证书部署脚本（续期后复制证书给 TURN 中继、重载 nginx）
#   3. 先放一个只有 80 端口的临时配置，用来通过证书验证
#   4. 用 certbot 申请一张包含四个域名的证书（名为 hxbot）
#   5. 放上完整配置 hxbot.conf，重载 nginx
#   6. 安装每天检查续期的任务
#   另外：创建访问日志目录 /var/log/hxbot，安装日志轮转配置（每天轮转，保留 200 天，满足网络日志至少保存 6 个月的要求）
# 每次修改 nginx 配置都会先用 nginx -t 检查；检查不通过会还原原来的文件，不影响官网。
# 脚本可以重复运行：证书已存在时不会重新申请，只更新配置和续期任务。
set -euo pipefail
EMAIL="${1:-}"
[ "$(id -u)" -eq 0 ] || { echo "请用 root 运行。" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DOMAINS=(bot.hxallai.com api.bot.hxallai.com signal.bot.hxallai.com turn.bot.hxallai.com)
WEBROOT=/var/www/hxbot-acme
CERT_DIR=/etc/letsencrypt/live/hxbot
[ -n "$EMAIL" ] || [ -f "$CERT_DIR/fullchain.pem" ] || { echo "用法：bash $0 用于接收证书到期提醒的邮箱" >&2; exit 1; }
DEPLOY_HOOK=/usr/local/sbin/hxbot-cert-deploy
CERTBOT_IMAGE="$(grep -E '^CERTBOT_IMAGE=' "$HERE/.env" 2>/dev/null | cut -d= -f2- | tr -d "'\"" || true)"
CERTBOT_IMAGE="${CERTBOT_IMAGE:-certbot/certbot:latest}"

NGINX_BIN="$(command -v nginx || true)"
[ -n "$NGINX_BIN" ] || { echo "找不到 nginx 命令。若用宝塔面板，请先执行：export PATH=/www/server/nginx/sbin:\$PATH" >&2; exit 1; }
# 下载中心靠 auth_request 模块校验登录，先确认 nginx 带了这个模块
if ! "$NGINX_BIN" -V 2>&1 | grep -q -- '--with-http_auth_request_module'; then
  echo "当前 nginx 没有编译 http_auth_request_module，下载中心无法校验登录。" >&2
  echo "Ubuntu、Alibaba Cloud Linux 自带的 nginx 都有这个模块；宝塔面板请在“软件商店 → Nginx → 设置”里重新编译并勾选该模块。" >&2
  exit 1
fi

# 1. 站点配置目录
if [ -d /www/server/panel/vhost/nginx ]; then
  CONF_DIR=/www/server/panel/vhost/nginx
elif [ -d /etc/nginx/conf.d ]; then
  CONF_DIR=/etc/nginx/conf.d
else
  echo "找不到 nginx 站点配置目录，请手工把 nginx/hxbot.conf 放到 nginx 会加载的目录。" >&2
  exit 1
fi
nginx_dump="$("$NGINX_BIN" -T 2>/dev/null || true)"
if ! printf '%s\n' "$nginx_dump" | grep -Eq "include[[:space:]]+$CONF_DIR/?\*"; then
  echo "警告：nginx 似乎没有加载 $CONF_DIR 下的文件，请确认 nginx.conf 里有 include $CONF_DIR/*.conf;" >&2
fi
echo "nginx 站点配置目录：$CONF_DIR"
TARGET="$CONF_DIR/hxbot.conf"

reload_nginx() {
  if systemctl is-active --quiet nginx 2>/dev/null; then systemctl reload nginx; else "$NGINX_BIN" -s reload; fi
}
# 把新配置放到 hxbot.conf；nginx -t 不通过就还原原来的文件并退出，nginx 和官网保持原样。
install_conf() {
  local source="$1" backup=""
  if [ -f "$TARGET" ]; then backup="$(mktemp)"; cp -p "$TARGET" "$backup"; fi
  cp "$source" "$TARGET"
  if ! "$NGINX_BIN" -t; then
    if [ -n "$backup" ]; then cp -p "$backup" "$TARGET"; rm -f "$backup"; else rm -f "$TARGET"; fi
    echo "nginx 配置检查未通过，已还原，官网不受影响。请把上面的报错发给开发人员。" >&2
    exit 1
  fi
  if [ -n "$backup" ]; then rm -f "$backup"; fi
  reload_nginx
}

# 2. 证书部署脚本：复制证书给 TURN 中继（组 2000 可读），重载 nginx
install -d -m 0755 /opt/hxbot/certs
cat > "$DEPLOY_HOOK" <<HOOK
#!/bin/sh
# HXBot：证书申请或续期后运行
set -e
install -m 0644 $CERT_DIR/fullchain.pem /opt/hxbot/certs/fullchain.pem
install -m 0640 -g 2000 $CERT_DIR/privkey.pem /opt/hxbot/certs/privkey.pem
if systemctl is-active --quiet nginx 2>/dev/null; then systemctl reload nginx; else $NGINX_BIN -s reload; fi
HOOK
chmod 0755 "$DEPLOY_HOOK"

CERTBOT_BIN="$(command -v certbot || true)"
if [ -n "$CERTBOT_BIN" ]; then
  # 本机 certbot（包括系统自带的定时续期）续期 hxbot 证书后都会运行这个目录下的钩子
  install -d /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/hxbot <<HOOK
#!/bin/sh
case "\${RENEWED_LINEAGE:-}" in */hxbot) $DEPLOY_HOOK ;; esac
HOOK
  chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/hxbot
fi

# 访问日志：nginx 把四个域名的访问日志写到 /var/log/hxbot/access.log（只记路径，不记查询参数）。
# 《网络安全法》要求网络日志至少保存 6 个月：每天轮转一次，保留 200 天，过期自动删除。
install -d -m 0750 /var/log/hxbot
if [ -d /etc/logrotate.d ]; then
  cat > /etc/logrotate.d/hxbot <<'ROTATE'
# HXBot：nginx 访问日志，每天轮转，保留 200 天（不少于 6 个月）。由 setup-https.sh 生成。
/var/log/hxbot/*.log {
  daily
  rotate 200
  maxage 200
  dateext
  compress
  delaycompress
  missingok
  notifempty
  copytruncate
}
ROTATE
  chmod 0644 /etc/logrotate.d/hxbot
  echo "访问日志：/var/log/hxbot/access.log（日志轮转配置：/etc/logrotate.d/hxbot）"
else
  echo "注意：本机没有 /etc/logrotate.d，请自行安排 /var/log/hxbot 的日志轮转，并至少保存 6 个月。" >&2
fi

# 3、4. 首次申请证书
mkdir -p "$WEBROOT/.well-known/acme-challenge"
if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  temp_conf="$(mktemp)"
  sed -n '/^map /,/^}/p; /^log_format /p; /^# ---------- 80 端口/,/^}/p' "$HERE/nginx/hxbot.conf" > "$temp_conf"
  install_conf "$temp_conf"
  rm -f "$temp_conf"
  echo "测试证书验证路径……"
  token="hxbot-$(date +%s)"
  echo "$token" > "$WEBROOT/.well-known/acme-challenge/$token"
  for domain in "${DOMAINS[@]}"; do
    got="$(curl --noproxy '*' -s --max-time 10 "http://$domain/.well-known/acme-challenge/$token" || true)"
    if [ "$got" != "$token" ]; then
      echo "无法通过 http://$domain 访问到本机。请检查：DNS 是否已解析到本机、安全组是否放行 80 端口。" >&2
      rm -f "$WEBROOT/.well-known/acme-challenge/$token"
      exit 1
    fi
    echo "  $domain 可访问"
  done
  rm -f "$WEBROOT/.well-known/acme-challenge/$token"

  domain_args=()
  for domain in "${DOMAINS[@]}"; do domain_args+=(-d "$domain"); done
  if [ -n "$CERTBOT_BIN" ]; then
    "$CERTBOT_BIN" certonly --webroot -w "$WEBROOT" --cert-name hxbot --email "$EMAIL" --agree-tos -n "${domain_args[@]}"
  else
    docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v "$WEBROOT:$WEBROOT" "$CERTBOT_IMAGE" \
      certonly --webroot -w "$WEBROOT" --cert-name hxbot --email "$EMAIL" --agree-tos -n "${domain_args[@]}"
  fi
fi
[ -f "$CERT_DIR/fullchain.pem" ] || { echo "证书申请失败。" >&2; exit 1; }

# 5. 完整配置
install_conf "$HERE/nginx/hxbot.conf"
"$DEPLOY_HOOK"
echo "nginx 已加载 HXBot 配置，证书已交给中继服务。"

# 6. 续期任务（每天 03:17 检查，到期前 30 天自动续期）
nginx_dir="$(dirname "$NGINX_BIN")"
{
  echo "# HXBot HTTPS 证书续期（setup-https.sh 生成）"
  echo "PATH=$nginx_dir:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"
  if [ -n "$CERTBOT_BIN" ]; then
    echo "17 3 * * * root $CERTBOT_BIN renew -q >> /var/log/hxbot-cert.log 2>&1"
  else
    echo "17 3 * * * root sh -c 'docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v $WEBROOT:$WEBROOT $CERTBOT_IMAGE renew -q --no-directory-hooks; $DEPLOY_HOOK' >> /var/log/hxbot-cert.log 2>&1"
  fi
} > /etc/cron.d/hxbot-cert
chmod 0644 /etc/cron.d/hxbot-cert
echo "证书自动续期任务已安装：/etc/cron.d/hxbot-cert"
echo "完成。证书到期时间：$(openssl x509 -noout -enddate -in "$CERT_DIR/fullchain.pem" | cut -d= -f2)"
