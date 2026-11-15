#!/usr/bin/env bash
# 在 Mac 上构建 HXBot iOS 端：dist-hx/HXBot-<版本>-ios.ipa（iPhone / iPad）
#
# 从注册 Apple 开发者账号、付费、拿团队号，到打包、上传、用户安装、以后更新的完整步骤，
# 见 hx/docs/部署文档.md 第 11 节。这里只列命令。
#
# 用法（在源码根目录）：
#   bash hx/scripts/build-ios.sh --check
#       只检查这台 Mac 还缺什么，不构建。第一次打包前先运行它。
#   HX_APPLE_TEAM_ID=ABCDE12345 bash hx/scripts/build-ios.sh
#       构建交给 TestFlight 的安装包（默认）。
#   HX_IOS_EXPORT=release-testing HX_APPLE_TEAM_ID=ABCDE12345 bash hx/scripts/build-ios.sh
#       构建直接安装（Ad Hoc）的安装包。
#
# 环境变量：
#   HX_APPLE_TEAM_ID  开发者账号的团队号，10 位大写字母和数字（必填）
#   HX_IOS_EXPORT     app-store-connect（默认）：交给 TestFlight，不能直接装到手机
#                     release-testing：Ad Hoc，只能装到构建前已在开发者账号登记的设备
#   HX_IOS_BUILD      构建号，不用填。默认取当前时间（年月日时分，如 2611111530），每次构建自动变大。
#                     Apple 对同一个版本号的每个构建号只收一次，所以每次上传的构建号都必须比上一次大。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

MODE=build
case "${1:-}" in
  "") ;;
  --check) MODE=check ;;
  -h | --help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "不认识的参数：$1（只支持 --check）" >&2; exit 1 ;;
esac

[ "$(uname -s)" = "Darwin" ] || { echo "请在 Mac 上运行：iOS 应用只能用 Xcode 构建。" >&2; exit 1; }

# version_at_least 当前版本 最低版本：按数字逐段比较，如 15.6.1 不低于 15.6
version_at_least() {
  local IFS=. i x y
  local -a have need
  read -r -a have <<<"$1"
  read -r -a need <<<"$2"
  for i in 0 1 2; do
    x="${have[$i]:-0}"; x="${x//[^0-9]/}"; x="${x:-0}"
    y="${need[$i]:-0}"; y="${y//[^0-9]/}"; y="${y:-0}"
    [ "$x" -gt "$y" ] && return 0
    [ "$x" -lt "$y" ] && return 1
  done
  return 0
}

problems=0
pass() { printf '  [通过] %s\n' "$1"; }
miss() { printf '  [缺少] %s\n         处理：%s\n' "$1" "$2"; problems=$((problems + 1)); }
note() { printf '  [提示] %s\n' "$1"; }

TEAM="$(printf '%s' "${HX_APPLE_TEAM_ID:-}" | tr '[:lower:]' '[:upper:]')"
EXPORT="${HX_IOS_EXPORT:-app-store-connect}"
BUILD="${HX_IOS_BUILD:-$(date +%y%m%d%H%M)}"

echo "检查这台 Mac 的打包环境……"
macos="$(sw_vers -productVersion 2>/dev/null || echo 0)"
if version_at_least "$macos" 15.6; then
  pass "macOS $macos"
else
  miss "macOS 15.6 或更新（当前 ${macos}）" "系统设置 → 通用 → 软件更新。Xcode 26 装不到更旧的系统上"
fi

if xcode_line="$(xcodebuild -version 2>/dev/null | head -1)" && [ -n "$xcode_line" ]; then
  xcode_version="$(printf '%s' "$xcode_line" | sed -n 's/^Xcode \([0-9.]*\).*/\1/p')"
  if version_at_least "${xcode_version:-0}" 26; then
    pass "$xcode_line"
  else
    miss "Xcode 26 或更新（当前 ${xcode_line}）" "在 App Store 里更新 Xcode"
  fi
  if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
    note "Xcode 可能还没有同意许可或装完组件。运行一次（做过也没关系）：sudo xcodebuild -license accept && sudo xcodebuild -runFirstLaunch"
  fi
else
  miss "Xcode 26（没有安装，或现在选中的只是命令行工具）" "在 App Store 安装 Xcode 并打开一次，再运行：sudo xcode-select -s /Applications/Xcode.app"
fi

if command -v pod >/dev/null 2>&1; then
  pass "CocoaPods $(pod --version 2>/dev/null | tail -1)"
else
  miss "CocoaPods" "brew install cocoapods"
fi

if command -v bun >/dev/null 2>&1; then
  pass "Bun $(bun --version 2>/dev/null)"
else
  miss "Bun" "curl -fsSL https://bun.com/install | bash -s \"bun-v1.4.2\"，装完关掉终端重新打开"
fi

node_version="$(node -p 'process.versions.node' 2>/dev/null || echo 0)"
if version_at_least "$node_version" 24; then
  pass "Node.js $node_version"
else
  miss "Node.js 24 或更新（当前 $([ "$node_version" = 0 ] && echo 未安装 || echo "$node_version")）" "打开 https://nodejs.org/dist/latest-v24.x/ ，下载 .pkg 结尾的文件，双击安装"
fi

if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
  pass "Python $(python3 -c 'import platform; print(platform.python_version())')"
else
  miss "Python 3.9 或更新" "装好 Xcode 并运行 sudo xcode-select -s /Applications/Xcode.app 后自带"
fi

if [[ "$TEAM" =~ ^[A-Z0-9]{10}$ ]]; then
  pass "团队号 $TEAM"
elif [ "$MODE" = check ] && [ -z "$TEAM" ]; then
  note "还没有给团队号。构建时在命令前加 HX_APPLE_TEAM_ID=你的团队号（部署文档 11.3 节第 6 步说明在哪里看）"
else
  miss "团队号 HX_APPLE_TEAM_ID（10 位大写字母和数字，现在是“${TEAM:-空}”）" "在 https://developer.apple.com/account 的“会员资格详细信息”里看“团队 ID”，命令写成：HX_APPLE_TEAM_ID=ABCDE12345 bash hx/scripts/build-ios.sh"
fi

case "$EXPORT" in
  app-store-connect | release-testing) ;;
  *) miss "HX_IOS_EXPORT 只能是 app-store-connect 或 release-testing（现在是“${EXPORT}”）" "不写就是 app-store-connect（TestFlight）；直接安装写 release-testing" ;;
esac

if ! [[ "$BUILD" =~ ^[0-9]{1,18}$ ]]; then
  miss "HX_IOS_BUILD 只能是数字，最多 18 位（现在是“${BUILD}”）" "去掉 HX_IOS_BUILD，让脚本自动取当前时间"
fi

free_gb="$(df -g "$ROOT" 2>/dev/null | awk 'NR==2 {print $4}')"
if [[ "${free_gb:-}" =~ ^[0-9]+$ ]] && [ "$free_gb" -lt 25 ]; then
  note "磁盘只剩 ${free_gb} GB。第一次打包会下载依赖并生成约 15 GB 的中间文件，空间不够时归档会失败"
fi

if [ "$problems" -gt 0 ]; then
  echo
  echo "还有 $problems 项没有准备好，按上面“处理”做完后重新运行。" >&2
  exit 1
fi
if [ "$MODE" = check ]; then
  echo
  echo "环境检查通过。另外有两件事脚本查不出来，请自己确认（部署文档 11.4 节）："
  echo "  1. Xcode → Settings（设置）→ Accounts（账户）里已经登录开发者账号；"
  echo "  2. 开发者账号里已经登记了至少一台 iPhone 或 iPad（一台都没有时归档会失败）。"
  echo "确认后开始构建：HX_APPLE_TEAM_ID=你的团队号 bash hx/scripts/build-ios.sh"
  exit 0
fi
export HX_APPLE_TEAM_ID="$TEAM"
export HX_IOS_BUILD="$BUILD"

# explain_failure 日志文件：把 xcodebuild 最常见的几种失败翻译成要做的事
explain_failure() {
  local log="$1" found=0
  echo >&2
  echo "构建失败。完整输出在 $log" >&2
  hint() { if grep -qiE "$1" "$log" 2>/dev/null; then echo "  原因：$2" >&2; echo "  处理：$3" >&2; found=1; fi; }
  hint "No Accounts|No Account for Team" \
    "Xcode 里没有登录这个团队的开发者账号，或团队号写错了。" \
    "打开 Xcode → Settings（设置）→ Accounts（账户），点左下角 + 登录开发者账号；核对团队号 ${TEAM}。"
  hint "has no devices from which to generate a provisioning profile" \
    "开发者账号里一台设备都没有登记，Xcode 生成不了签名用的描述文件。" \
    "按部署文档 11.4 节第 6 步登记一台 iPhone 或 iPad，再重新构建。"
  hint "not agreed to the Xcode license|xcodebuild -license" \
    "还没有同意 Xcode 的许可。" \
    "运行：sudo xcodebuild -license accept && sudo xcodebuild -runFirstLaunch"
  hint "is not installed\. To use with Xcode, first download and install the platform|iOS [0-9.]+ Platform Not Installed" \
    "Xcode 里没有装 iOS 平台组件。" \
    "运行：xcodebuild -downloadPlatform iOS（约 8 GB），装完重新构建。"
  hint "Program License Agreement|agreement.*(updated|must be accepted|has not been)|PLA Update available" \
    "Apple 更新了开发者协议，账号持有人还没有同意。" \
    "账号持有人登录 https://developer.apple.com/account 同意最新协议后重新构建。"
  hint "membership.*expired|Your membership has expired|no longer a member" \
    "开发者计划的会员资格过期了。" \
    "按部署文档 11.10 节续费，续费生效后重新构建。"
  hint "does(n't| not) (support|include) the .*(capability|entitlement)|Personal development teams.*do not support|requires a development team" \
    "这个账号用不了应用需要的能力（应用组、推送通知、关联域名）。免费的个人团队不行。" \
    "用已经付费加入 Apple Developer Program 的账号，团队号用这个账号的。"
  hint "bundle identifier.*(is not available|cannot be registered)|Failed to register bundle identifier" \
    "包标识 com.hxallai.bot 已经被别的开发者账号注册。" \
    "确认登录的是公司的开发者账号；这个标识只能属于一个团队。"
  hint "No signing certificate|maximum number of .*certificates|Revoke certificate|certificate.*(revoked|expired)" \
    "签名证书有问题（过期、被撤销或数量到上限）。" \
    "在 https://developer.apple.com/account/resources/certificates/list 删掉过期和不用的证书，再重新构建，Xcode 会自动新建。"
  hint "Could not resolve host|CDN: trunk|Couldn't determine repo type|SSL_ERROR|Operation timed out|ECONNRESET|ETIMEDOUT" \
    "下载依赖时网络不通。" \
    "换到能稳定访问 GitHub、npm 和 CocoaPods 的网络后重新运行，已经下载的部分不会重下。"
  hint "No space left on device" "磁盘满了。" "清出至少 25 GB 空间后重新构建。"
  if [ "$found" = 0 ]; then
    echo "  没有认出原因。把日志里第一处 “error:” 开头的那几行对照部署文档 11.11 节的表格；" >&2
    echo "  查看命令：grep -n 'error:' \"$log\" | head -20" >&2
  fi
}

echo
echo "开始构建：团队 ${TEAM}，构建号 ${BUILD}，导出方式 $EXPORT"
echo "1/5 应用 HXBot 改造……"
python3 hx/rebrand.py

echo "2/5 安装依赖……"
bun install --frozen-lockfile

OUT="$ROOT/dist-hx/ios"
rm -rf "$OUT"
mkdir -p "$OUT"

echo "3/5 生成 iOS 工程并安装 CocoaPods 依赖（约 5～10 分钟）……"
cd apps/mobile
if ! EXPO_PUBLIC_APP_ENV=production bunx expo prebuild --platform ios --clean 2>&1 | tee "$OUT/prebuild.log"; then
  explain_failure "$OUT/prebuild.log"
  exit 1
fi
workspace="$(ls -d ios/*.xcworkspace 2>/dev/null | head -1 || true)"
[ -n "$workspace" ] || { echo "没有生成 Xcode 工作区（ios/*.xcworkspace），请查看上面的输出。" >&2; exit 1; }
scheme="$(basename "$workspace" .xcworkspace)"
version="$(node -p 'require("./app.json").expo.version')"

echo "4/5 归档（Release，自动签名，约 10～20 分钟）……"
if ! xcodebuild -workspace "$workspace" -scheme "$scheme" -configuration Release \
  -destination "generic/platform=iOS" -archivePath "$OUT/HXBot.xcarchive" \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
  archive 2>&1 | tee "$OUT/archive.log"; then
  explain_failure "$OUT/archive.log"
  exit 1
fi

echo "5/5 导出 ipa（${EXPORT}）……"
cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>$EXPORT</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>destination</key><string>export</string>
  <key>stripSwiftSymbols</key><true/>
  <key>uploadSymbols</key><false/>
</dict>
</plist>
PLIST
if ! xcodebuild -exportArchive -archivePath "$OUT/HXBot.xcarchive" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -allowProvisioningUpdates 2>&1 | tee "$OUT/export.log"; then
  explain_failure "$OUT/export.log"
  exit 1
fi
ipa="$(ls "$OUT"/export/*.ipa 2>/dev/null | head -1 || true)"
[ -n "$ipa" ] || { explain_failure "$OUT/export.log"; exit 1; }
cd "$ROOT"
target="dist-hx/HXBot-$version-ios.ipa"
cp "$ipa" "$target"

echo
echo "构建完成："
ls -lh "$target"
shasum -a 256 "$target"
python3 hx/server/scripts/publish-downloads.py --inspect "$target" || true
echo
if [ "$EXPORT" = app-store-connect ]; then
  echo "这个包是交给 TestFlight 的，不能直接装到手机，也不用传到服务器。下一步："
  echo "  1. 打开 Transporter，把 $ROOT/$target 拖进去，点“交付”。"
  echo "  2. 等 App Store Connect → TestFlight 里出现“${version}（${BUILD}）”（约 10～30 分钟）。"
  echo "  3. 第一次发布：按部署文档 11.6 节建测试群组、拿到公开链接，再运行"
  echo "       bash hx/scripts/upload-downloads.sh root@服务器公网IP --ios-url https://testflight.apple.com/join/你的邀请码"
  echo "     以后更新：只把新构建加进外部测试群组（部署文档 11.9 节），链接和下载页都不用改。"
else
  echo "这个包可以直接安装，但只能装到上面列出的已登记设备。下一步："
  echo "  bash hx/scripts/upload-downloads.sh root@服务器公网IP $target"
  echo "下载页会在 iPhone / iPad 的 Safari 里显示“安装”按钮（用户步骤见部署文档 11.8 节）。"
fi
