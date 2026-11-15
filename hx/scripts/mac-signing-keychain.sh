#!/bin/bash
# HXBot（v1.6.8）：GitHub 的 Mac 机器上，打包前装好固定签名证书（.github/workflows/hx-build.yml 调用）。
#
# 读环境变量（来自仓库 Secrets，见 hx/scripts/mac-signing-cert.sh）：
#   P12            HXBOT_MAC_CERT_P12_BASE64：证书（.p12）的 base64
#   P12_PASSWORD   HXBOT_MAC_CERT_PASSWORD：证书的密码
#   DEVELOPER_ID   1 = 这是苹果开发者账号的 Developer ID 证书（以后换上时用）
# 写到 $GITHUB_OUTPUT：identity=证书名（没有配证书时为空）
#
# 证书装进一个临时钥匙串（这台机器用完就销毁）。自己生成的证书不是苹果签发的，要先在这台机器上
# 把它设为“用于代码签名时信任”，electron-builder 才认得它；Developer ID 证书不用。
# 证书和密码不打印。
set -euo pipefail
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
limit() { perl -e 'alarm shift; exec @ARGV' "$@"; }   # macOS 没有 timeout 命令
if [ -z "${P12:-}" ] || [ -z "${P12_PASSWORD:-}" ]; then
  echo "::warning title=Mac 版没有固定签名::仓库里没有 HXBOT_MAC_CERT_P12_BASE64 和 HXBOT_MAC_CERT_PASSWORD。先在你的 Mac 上运行一次 bash hx/scripts/mac-signing-cert.sh 账号名/仓库名。"
  echo "identity=" >> "$OUT"
  exit 0
fi
WORK="${RUNNER_TEMP:-$(mktemp -d)}/hx-signing"
mkdir -p "$WORK"
KEYCHAIN="$WORK/hxbot-signing.keychain-db"
OPENSSL=/usr/bin/openssl   # LibreSSL：读得了 mac-signing-cert.sh 生成的 .p12（OpenSSL 3 要 -legacy）
KEYCHAIN_PASSWORD="$("$OPENSSL" rand -hex 24)"
printf '%s' "$P12" | base64 --decode > "$WORK/cert.p12"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$WORK/cert.p12" -k "$KEYCHAIN" -P "$P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
limit 60 security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
# 加到钥匙串搜索列表的最前面，原来的照样保留
security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"')
NAME="$("$OPENSSL" pkcs12 -in "$WORK/cert.p12" -passin env:P12_PASSWORD -nokeys 2>/dev/null |
  "$OPENSSL" x509 -noout -subject | sed -n 's/.*CN *= *\([^/,]*\).*/\1/p' | sed 's/ *$//')"
[ -n "$NAME" ] || { echo "::error::读不出签名证书的名字。" >&2; exit 1; }
if [ "${DEVELOPER_ID:-0}" != "1" ]; then
  "$OPENSSL" pkcs12 -in "$WORK/cert.p12" -passin env:P12_PASSWORD -nokeys 2>/dev/null |
    "$OPENSSL" x509 -out "$WORK/cert.pem"
  # 不先放开这一项，add-trusted-cert 会弹出要密码的窗口，GitHub 的机器上没人能点，打包就一直等下去
  # GitHub 的 Mac 机器上这一条回 255，信任照样设得上（2026-11-14 在 macOS 15、26 上实测），所以失败不停下
  sudo security authorizationdb write com.apple.trust-settings.admin allow >/dev/null 2>&1 || true
  limit 60 sudo security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain "$WORK/cert.pem"
fi
rm -f "$WORK/cert.p12"
security find-identity -v -p codesigning "$KEYCHAIN" | grep -F "\"$NAME\"" >/dev/null ||
  { echo "::error::钥匙串里没有可用的签名证书“${NAME}”。" >&2; exit 1; }
echo "签名证书：$NAME"
echo "identity=$NAME" >> "$OUT"
