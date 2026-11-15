#!/usr/bin/env bash
# 在 Apple 芯片（M1 及以上）的 Mac 上构建 HXBot 桌面端安装包：dist/HXBot-<版本>-arm64.dmg
#
# 准备（只需一次）：
#   1. 安装 Xcode 命令行工具：xcode-select --install
#   2. 安装 Bun 1.4.2：curl -fsSL https://bun.com/install | bash -s "bun-v1.4.2"
#   3. 安装 Node.js 24（推荐 nvm：nvm install 24 && nvm use 24）
#   4. 能访问 GitHub（构建会从 GitHub 下载 Electron、语音运行时、远程桌面运行时和 Computer Use 驱动）
#
# 用法：在源码根目录运行 bash hx/scripts/build-mac.sh
# 签名（v1.6.8）：发布用的 Mac 版在 GitHub 上打，用固定证书签名（《客户端构建》第 6 节）。这里打的包没有固定签名
# （设置了 HXBOT_MAC_IDENTITY 时用那个签名身份），只能自己试用：macOS 把它当成另一个应用，授权要另给；
# upload-downloads.sh 也不上传它。没有苹果的签名公证，首次打开要到“系统设置 → 隐私与安全性”点“仍要打开”，
# 或运行 xattr -dr com.apple.quarantine "/Applications/HXBot.app"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

[ "$(uname -s)" = "Darwin" ] || { echo "请在 macOS 上运行。" >&2; exit 1; }
[ "$(uname -m)" = "arm64" ] || echo "提示：这台 Mac 不是 Apple 芯片，产物将是 x64 版本。"
command -v bun >/dev/null || { echo "缺少 Bun，见脚本开头的准备步骤。" >&2; exit 1; }
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$node_major" -ge 24 ] || { echo "需要 Node.js 24 或更新（当前 $(node -v 2>/dev/null || echo 未安装)）。" >&2; exit 1; }

echo "1/4 应用 HXBot 改造……"
python3 hx/rebrand.py

echo "2/4 安装依赖（会下载 Electron）……"
bun install --frozen-lockfile

echo "3/4 构建并打包（约 10～20 分钟）……"
bun run dist:mac

echo "4/4 产物："
version="$(node -p 'require("./package.json").version')"
ls -lh dist/HXBot-"$version"-*.dmg dist/HXBot-"$version"-*.zip dist/latest-mac.yml
shasum -a 256 dist/HXBot-"$version"-*.dmg
echo
echo "本机试用：打开 dmg，把 HXBot 拖进“应用程序”。"
if [ -z "${HXBOT_MAC_IDENTITY:-}" ]; then
  echo "这个包没有固定签名，只能自己试用，不要上传（上传脚本会拒绝）。发布用 GitHub 上打的包（《客户端构建》第 6 节）。"
else
  echo "上传到服务器：bash hx/scripts/upload-downloads.sh root@服务器IP dist/HXBot-$version-arm64.dmg"
  echo "  （同一目录里的 HXBot-$version-arm64.zip 和 latest-mac.yml 会一并上传，已安装的 Mac 版在应用里就能更新到 ${version}）"
fi
