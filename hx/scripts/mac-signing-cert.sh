#!/bin/bash
# HXBot（v1.6.8）：在你自己的 Mac 上生成一次 Mac 版的固定签名证书，并写进 GitHub。
#
# 用法（在终端里，一次）：
#   bash mac-signing-cert.sh 账号名/仓库名            生成证书并写进这个仓库
#   bash mac-signing-cert.sh 账号名/仓库名 --upload   证书已经有了，只重新写进仓库（换了仓库时用）
#   账号名/仓库名：在 GitHub 上打 HXBot 安装包的私有仓库（hx/scripts/push-github.sh 推到的那个）
#
# 它做三件事：
#   1. 用 Mac 自带的 openssl 生成代码签名证书“HXBot Code Signing”（RSA 3072，10 年）；
#   2. 用 GitHub CLI（gh）把证书和它的密码写进仓库的 Secrets：HXBOT_MAC_CERT_P12_BASE64、
#      HXBOT_MAC_CERT_PASSWORD；把证书的 SHA-1 指纹写进仓库变量 HXBOT_MAC_CERT_SHA1
#      （指纹不是密码，只用来核对每一版用的是不是同一张证书）；
#   3. 在 ~/HXBot-签名证书/ 留一份证书文件，密码存进“钥匙串访问”的登录钥匙串（名称“HXBot Mac signing”）。
#      请把这个文件夹备份到移动硬盘：证书丢了，Mac 就认不出新版本还是 HXBot，要重新授权一次。
#
# 证书和密码不显示在屏幕上，除了 GitHub 不发到任何地方。只生成一次：再生成一张新证书，
# macOS 会把下一版当成新应用。以后有了苹果开发者账号，换成 Developer ID 证书（见《客户端构建》）。
set -euo pipefail
REPO="${1:-}"
MODE="${2:-}"
[[ "$REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || { echo "用法：bash mac-signing-cert.sh 账号名/仓库名 [--upload]" >&2; exit 1; }
[ -z "$MODE" ] || [ "$MODE" = "--upload" ] || { echo "第二个参数只能是 --upload" >&2; exit 1; }
[ "$(uname)" = Darwin ] || { echo "请在 Mac 上运行。" >&2; exit 1; }
command -v gh >/dev/null || { echo "要先装 GitHub CLI：brew install gh，然后运行 gh auth login" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "要先登录 GitHub CLI：gh auth login" >&2; exit 1; }
gh repo view "$REPO" --json name >/dev/null 2>&1 || { echo "找不到仓库 ${REPO}，或者这个 GitHub 账号没有权限。" >&2; exit 1; }

OPENSSL=/usr/bin/openssl        # Mac 自带的 LibreSSL：它生成的 .p12 能被钥匙串和 GitHub 的 Mac 机器导入
NAME="HXBot Code Signing"
DIR="$HOME/HXBot-签名证书"
P12_FILE="$DIR/hxbot-mac-signing.p12"
SERVICE="HXBot Mac signing"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ "$MODE" = "--upload" ]; then
  [ -f "$P12_FILE" ] || { echo "没有找到 ${P12_FILE}。第一次请不带 --upload 运行。" >&2; exit 1; }
  PASS="$(security find-generic-password -a "$USER" -s "$SERVICE" -w 2>/dev/null)" ||
    { echo "钥匙串里没有“${SERVICE}”的密码。" >&2; exit 1; }
  export PASS
else
  if [ -e "$P12_FILE" ]; then
    echo "已经有证书：${P12_FILE}。为了让 Mac 一直认得 HXBot，不要再生成新的。" >&2
    echo "只想把它重新写进 GitHub：bash mac-signing-cert.sh $REPO --upload" >&2
    exit 1
  fi
  cat > "$WORK/cert.cnf" <<'CNF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = HXBot Code Signing
O = HX AI
[ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
CNF
  echo "生成证书……"
  "$OPENSSL" req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes \
    -keyout "$WORK/key.pem" -out "$WORK/cert.pem" -config "$WORK/cert.cnf" 2>/dev/null
  PASS="$("$OPENSSL" rand -hex 24)"
  export PASS
  "$OPENSSL" pkcs12 -export -name "$NAME" -inkey "$WORK/key.pem" -in "$WORK/cert.pem" \
    -out "$WORK/cert.p12" -passout env:PASS
  rm -f "$WORK/key.pem"
  # 在一个临时钥匙串里导入一次，确认 Mac 认这个文件（不碰你的登录钥匙串里的其他东西）
  security create-keychain -p "$PASS" "$WORK/check.keychain" >/dev/null
  security import "$WORK/cert.p12" -k "$WORK/check.keychain" -P "$PASS" -T /usr/bin/codesign >/dev/null
  security delete-keychain "$WORK/check.keychain"
  mkdir -p "$DIR"
  chmod 700 "$DIR"
  cp "$WORK/cert.p12" "$P12_FILE"
  chmod 600 "$P12_FILE"
  security add-generic-password -U -a "$USER" -s "$SERVICE" -l "$SERVICE" -w "$PASS"
fi

SHA1="$("$OPENSSL" pkcs12 -in "$P12_FILE" -passin env:PASS -nokeys 2>/dev/null |
  "$OPENSSL" x509 -noout -fingerprint -sha1 | sed 's/.*=//; s/://g' | tr '[:lower:]' '[:upper:]')"
[[ "$SHA1" =~ ^[0-9A-F]{40}$ ]] || { echo "读不出证书的指纹。" >&2; exit 1; }

echo "写进 GitHub 仓库 $REPO ……"
base64 -i "$P12_FILE" | gh secret set HXBOT_MAC_CERT_P12_BASE64 --repo "$REPO"
printf '%s' "$PASS" | gh secret set HXBOT_MAC_CERT_PASSWORD --repo "$REPO"
gh variable set HXBOT_MAC_CERT_SHA1 --repo "$REPO" --body "$SHA1"
unset PASS

echo
echo "完成。"
echo "  证书：${P12_FILE}（请备份整个文件夹 $DIR 到移动硬盘）"
echo "  密码：在“钥匙串访问”的登录钥匙串里，名称“${SERVICE}”"
echo "  证书指纹 SHA-1：${SHA1}（不是密码，可以告诉开发人员，用来核对）"
echo "下一步：在 GitHub 仓库的 Actions 里运行“HXBot build”，Mac 版就会用这张证书签名。"
