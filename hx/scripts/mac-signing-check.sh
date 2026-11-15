#!/bin/bash
# HXBot（v1.6.8）：Mac 版打好后、上传之前的把关（.github/workflows/hx-build.yml 调用）。
#
# 用法：bash mac-signing-check.sh <HXBot.app 的路径>
# 读环境变量：
#   HXBOT_MAC_CERT_SHA1   仓库变量：固定签名证书的 SHA-1 指纹（hx/scripts/mac-signing-cert.sh 写的）
#   HXBOT_MAC_TEAM_ID     仓库变量：换成苹果开发者账号的 Developer ID 后，填团队号（以后用）
#   ALLOW_UNSIGNED        yes = 允许没有固定签名的测试包（不能用来发布）
#
# macOS 按“签名身份”记屏幕录制、辅助功能、自动化、App 管理这些授权。身份一变，用户的授权就作废。
# 所以每一版都核对：
#   1. 签名完整（codesign --verify --deep --strict）；
#   2. 签名身份（designated requirement）就是登记的那一个：应用标识 com.hxallai.bot，加上
#      登记的证书指纹（或 Developer ID 的团队号）；
#   3. 加固运行时打开；权限声明里有自动化（apple-events），没有要描述文件的 associated-domains；
#   4. Info.plist 里有麦克风、屏幕录制、自动化三条用途说明，应用标识没变。
# 任何一项不对就失败，这一版不上传、不能发布。
set -euo pipefail
APP="${1:?用法：bash mac-signing-check.sh <HXBot.app>}"
[ -d "$APP" ] || { echo "::error::没有找到 $APP" >&2; exit 1; }
BUNDLE_ID="com.hxallai.bot"
fail() { echo "::error title=Mac 版签名不对::$1" >&2; exit 1; }

info() { /usr/libexec/PlistBuddy -c "Print :$1" "$APP/Contents/Info.plist" 2>/dev/null || true; }
[ "$(info CFBundleIdentifier)" = "$BUNDLE_ID" ] || fail "应用标识不是 ${BUNDLE_ID}：$(info CFBundleIdentifier)"
for key in NSMicrophoneUsageDescription NSScreenCaptureUsageDescription NSAppleEventsUsageDescription; do
  [ -n "$(info "$key")" ] || fail "Info.plist 里缺 $key"
done

DR="$(codesign -d -r- "$APP" 2>&1 | sed -n 's/^designated => //p')"
SHA1="$(printf '%s' "${HXBOT_MAC_CERT_SHA1:-}" | tr '[:lower:]' '[:upper:]')"
TEAM="${HXBOT_MAC_TEAM_ID:-}"
if [ -z "$SHA1" ] && [ -z "$TEAM" ]; then
  if [ "${ALLOW_UNSIGNED:-no}" = "yes" ]; then
    echo "::warning title=测试包::没有固定签名（ALLOW_UNSIGNED=yes），这一版不能发布：升级后用户的授权会作废。"
    echo "签名身份：${DR:-（无）}"
    exit 0
  fi
  fail "仓库里没有登记签名证书（变量 HXBOT_MAC_CERT_SHA1）。先在你的 Mac 上运行一次 bash hx/scripts/mac-signing-cert.sh 账号名/仓库名。"
fi
codesign --verify --deep --strict "$APP" || fail "签名不完整（codesign --verify --deep --strict 没通过）"
echo "签名身份：$DR"
printf '%s' "$DR" | grep -F "identifier \"$BUNDLE_ID\"" >/dev/null || fail "签名身份里的应用标识不对：$DR"
if [ -n "$TEAM" ]; then
  printf '%s' "$DR" | grep -F "$TEAM" >/dev/null || fail "签名身份不是团队 $TEAM 的 Developer ID：$DR"
else
  printf '%s' "$DR" | tr '[:lower:]' '[:upper:]' | grep -F "H\"$SHA1\"" >/dev/null ||
    fail "签名身份不是登记的证书 ${SHA1}：${DR}。换了证书，用户的 Mac 授权会全部作废；如果真要换，先在仓库变量里改登记的指纹。"
fi
codesign -d --verbose=2 "$APP" 2>&1 | grep -E "flags=.*runtime" >/dev/null || fail "没有打开加固运行时（hardened runtime）"
ENT="$(codesign -d --entitlements - --xml "$APP" 2>/dev/null || true)"
printf '%s' "$ENT" | grep -F "com.apple.security.automation.apple-events" >/dev/null || fail "权限声明里没有自动化（com.apple.security.automation.apple-events）"
if printf '%s' "$ENT" | grep -F "com.apple.developer.associated-domains" >/dev/null && [ -z "$TEAM" ]; then
  fail "权限声明里有 associated-domains：没有苹果描述文件时 macOS 不让应用启动"
fi
echo "Mac 版签名核对通过：身份不变，用户的授权在升级后仍然有效。"
