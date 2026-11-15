#!/usr/bin/env bash
# 把安装包上传到服务器的下载中心，并刷新门户页的下载列表。
# 用法：bash hx/scripts/upload-downloads.sh root@服务器IP 文件1 [文件2 ...] [--ios-url TestFlight邀请链接]
# 例：  bash hx/scripts/upload-downloads.sh root@47.xx.xx.xx dist/HXBot-0.67.1-arm64.dmg dist-hx/HXBot-1.5.0-android.apk
#       bash hx/scripts/upload-downloads.sh root@47.xx.xx.xx dist-hx/HXBot-1.5.0-ios.ipa
#       bash hx/scripts/upload-downloads.sh root@47.xx.xx.xx --ios-url https://testflight.apple.com/join/XXXXXXXX
# 文件名必须是 HXBot-<版本>-arm64.dmg / HXBot-<版本>-x64.exe / HXBot-<版本>-android.apk / HXBot-<版本>-ios.ipa。
#
# 桌面端的应用内更新文件会一并上传（v1.6.2 起）：dmg 旁边的 HXBot-<版本>-arm64.zip(.blockmap) 和 latest-mac.yml，
# exe 旁边的 HXBot-<版本>-x64.exe.blockmap 和 latest.yml（electron-builder 构建时生成在同一个目录里）。
# 它们放到服务器的 /opt/hxbot/downloads/updates/desktop/；latest*.yml 最后传、先叫 .new，服务器核对文件齐了才换上。
#
# iOS 有两种发布方式（可以同时用）：
#   · TestFlight：ipa 用 Transporter 传给苹果，这里只发布邀请链接（--ios-url）；撤下链接用 --no-ios-url。
#   · 直接安装：上传 Ad Hoc 签名的 ipa（HX_IOS_EXPORT=release-testing 构建），下载页在 iPhone 上显示“安装”按钮，
#     只有登记过的设备装得上。默认方式构建的 ipa 是 TestFlight 用的，传上来也不会出现在下载页（服务器会提示）。
set -euo pipefail
usage() { sed -n '2,7p' "$0" >&2; exit 1; }
[ $# -ge 1 ] || usage
TARGET="$1"
shift
case "$TARGET" in -*) usage ;; esac

FILES=()
IOS_ARGS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ios-url)
      [ $# -ge 2 ] || { echo "--ios-url 后面要跟 TestFlight 邀请链接" >&2; exit 1; }
      [ -z "$IOS_ARGS" ] || { echo "--ios-url 和 --no-ios-url 只能用一个、用一次" >&2; exit 1; }
      # 链接会拼进在服务器上运行的命令里，只接受苹果的地址和不会被 shell 解释的字符
      [[ "$2" =~ ^https://(testflight\.apple\.com|apps\.apple\.com)/[A-Za-z0-9/._~%=-]+$ ]] || {
        echo "--ios-url 要填苹果给的完整链接，例如 https://testflight.apple.com/join/XXXXXXXX" >&2; exit 1; }
      IOS_ARGS=" --ios-url $2"
      shift 2 ;;
    --no-ios-url)
      [ -z "$IOS_ARGS" ] || { echo "--ios-url 和 --no-ios-url 只能用一个、用一次" >&2; exit 1; }
      IOS_ARGS=" --no-ios-url"
      shift ;;
    -*) echo "不认识的参数：$1" >&2; usage ;;
    *) FILES+=("$1"); shift ;;
  esac
done
[ ${#FILES[@]} -gt 0 ] || [ -n "$IOS_ARGS" ] || usage

for file in ${FILES[@]+"${FILES[@]}"}; do
  name="$(basename "$file")"
  case "$name" in
    HXBot-*-arm64.dmg|HXBot-*-x64.exe|HXBot-*-android.apk|HXBot-*-ios.ipa) ;;
    *) echo "文件名不符合规则：$name" >&2; exit 1 ;;
  esac
  [ -f "$file" ] || { echo "找不到文件：$file" >&2; exit 1; }
done

# 桌面端的应用内更新文件：安装包旁边、版本一致的才上传
UPDATES=()
FEEDS=()
feed_version() { sed -n 's/^version:[[:space:]]*["'"'"']\{0,1\}\([0-9][0-9A-Za-z.+-]*\).*/\1/p' "$1" | head -1; }
add_updates() {
  local installer="$1" platform="$2" feed="$3"; shift 3
  local folder version name file
  folder="$(dirname "$installer")"
  name="$(basename "$installer")"
  version="${name#HXBot-}"
  version="${version%-*}"
  if [ ! -f "$folder/$feed" ]; then
    echo "提示：$folder 里没有 ${feed}，这次不更新 $platform 的应用内更新（用户仍可在下载页手动下载新版）。" >&2
    return
  fi
  if [ "$(feed_version "$folder/$feed")" != "$version" ]; then
    echo "提示：$folder/$feed 是 $(feed_version "$folder/$feed") 版的，和 $name 不一致，这次不更新 $platform 的应用内更新。" >&2
    echo "      请用同一次构建生成的文件。" >&2
    return
  fi
  for file in "$@"; do
    file="$folder/${file//@V@/$version}"
    if [ -f "$file" ]; then
      UPDATES+=("$file")
    elif [[ "$file" != *.blockmap ]]; then
      echo "提示：没找到 ${file}，这次不更新 $platform 的应用内更新。" >&2
      return
    fi
  done
  FEEDS+=("$folder/$feed")
}
# Mac 版的签名（v1.6.8）：macOS 按签名身份记授权，没有固定签名的 Mac 版一上传，所有 Mac 用户的授权就作废。
# 在 Mac 上上传时，从 dmg 旁边的 zip 里取出 HXBot.app 核对：签名身份要有应用标识 com.hxallai.bot，并且是证书签名
# （固定证书或 Developer ID），不是临时签名。设置了 HXBOT_MAC_CERT_SHA1（mac-signing-cert.sh 显示的指纹）时还核对指纹。
# 测试包要上传时设 HXBOT_ALLOW_UNSIGNED_MAC=1。
check_mac_signature() {
  local installer="$1" zip work dr sha1
  zip="${installer%.dmg}.zip"
  [ -f "$zip" ] || return 0
  if ! command -v codesign >/dev/null || ! command -v ditto >/dev/null; then
    echo "提示：这台电脑不是 Mac，没有核对 Mac 版的签名（$(basename "$zip")）。" >&2
    return 0
  fi
  work="$(mktemp -d)"
  ditto -x -k "$zip" "$work" || { rm -rf "$work"; echo "解不开 $zip" >&2; exit 1; }
  dr="$(codesign -d -r- "$work/HXBot.app" 2>&1 | sed -n 's/^designated => //p')"
  rm -rf "$work"
  sha1="$(printf '%s' "${HXBOT_MAC_CERT_SHA1:-}" | tr '[:lower:]' '[:upper:]')"
  if [[ "$dr" == *'identifier "com.hxallai.bot"'* ]] &&
     { [[ "$dr" == *'certificate leaf = H"'* ]] || [[ "$dr" == *"anchor apple generic"* ]]; } &&
     { [ -z "$sha1" ] || [[ "$(printf '%s' "$dr" | tr '[:lower:]' '[:upper:]')" == *"H\"$sha1\""* ]]; }; then
    echo "Mac 版的签名身份：$dr"
    return 0
  fi
  if [ "${HXBOT_ALLOW_UNSIGNED_MAC:-}" = 1 ]; then
    echo "提示：$(basename "$installer") 没有固定签名（HXBOT_ALLOW_UNSIGNED_MAC=1），升级后 Mac 用户的授权会作废。" >&2
    return 0
  fi
  echo "$(basename "$installer") 的签名身份不对，没有上传：${dr:-（没有签名）}" >&2
  echo "  Mac 版要用固定证书签名（《客户端构建》第 6.3 节第二部分），用 GitHub 上打的包。" >&2
  echo "  只是测试包、确实要传：在命令前面加 HXBOT_ALLOW_UNSIGNED_MAC=1。" >&2
  exit 1
}
for file in ${FILES[@]+"${FILES[@]}"}; do
  case "$(basename "$file")" in
    *-arm64.dmg) check_mac_signature "$file" ;;
  esac
done

for file in ${FILES[@]+"${FILES[@]}"}; do
  case "$(basename "$file")" in
    *-arm64.dmg) add_updates "$file" Mac latest-mac.yml "HXBot-@V@-arm64.zip" "HXBot-@V@-arm64.zip.blockmap" ;;
    *-x64.exe) add_updates "$file" Windows latest.yml "HXBot-@V@-x64.exe.blockmap" ;;
  esac
done

if [ ${#FILES[@]} -gt 0 ]; then
  echo "上传到 $TARGET:/opt/hxbot/downloads/ ……"
  scp "${FILES[@]}" "$TARGET:/opt/hxbot/downloads/"
  if [ ${#FEEDS[@]} -gt 0 ]; then
    echo "上传应用内更新文件到 $TARGET:/opt/hxbot/downloads/updates/desktop/ ……"
    ssh "$TARGET" "mkdir -p /opt/hxbot/downloads/updates/desktop"
    [ ${#UPDATES[@]} -eq 0 ] || scp "${UPDATES[@]}" "$TARGET:/opt/hxbot/downloads/updates/desktop/"
    for feed in "${FEEDS[@]}"; do
      scp "$feed" "$TARGET:/opt/hxbot/downloads/updates/desktop/$(basename "$feed").new"
    done
  fi
  ssh "$TARGET" "chmod 644 /opt/hxbot/downloads/HXBot-* && python3 /opt/hxbot/server/scripts/publish-downloads.py /opt/hxbot/downloads$IOS_ARGS"
else
  ssh "$TARGET" "python3 /opt/hxbot/server/scripts/publish-downloads.py /opt/hxbot/downloads$IOS_ARGS"
fi
echo "完成。打开 https://bot.hxallai.com 登录后即可看到新版本。"
