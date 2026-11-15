#!/usr/bin/env bash
# 在 Mac（或 Linux）上构建 HXBot 安卓端：dist-hx/HXBot-<版本>-android.apk
#
# 准备（只需一次）：
#   1. 安装 Android Studio，在 SDK Manager 里装好 Android SDK Platform 36、37 和 Build-Tools
#   2. 设置环境变量（写进 ~/.zshrc）：
#        export ANDROID_HOME="$HOME/Library/Android/sdk"
#        export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
#   3. 安装 Bun 1.4.2 和 Node.js 24（同 build-mac.sh）
#
# 签名：第一次运行会在 hx/keys/ 生成研究版专用签名文件 hxbot-release.jks 和密码文件。
#       这两个文件必须备份并长期保留：换了签名，已安装的用户就无法覆盖升级。不要提交到代码仓库。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

: "${ANDROID_HOME:?请先设置 ANDROID_HOME（见脚本开头）}"
command -v java >/dev/null || [ -n "${JAVA_HOME:-}" ] || { echo "缺少 Java（JDK 17），见脚本开头。" >&2; exit 1; }
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$PATH"

echo "1/5 应用 HXBot 改造……"
python3 hx/rebrand.py

echo "2/5 安装依赖……"
bun install --frozen-lockfile

echo "3/5 准备签名文件……"
mkdir -p hx/keys
KEYSTORE="$ROOT/hx/keys/hxbot-release.jks"
PROPS="$ROOT/hx/keys/keystore.properties"
if [ ! -f "$KEYSTORE" ]; then
  password="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"
  keytool -genkeypair -v -keystore "$KEYSTORE" -alias hxbot -keyalg RSA -keysize 4096 -validity 36500 \
    -storepass "$password" -keypass "$password" \
    -dname "CN=HXBot Research, O=HX AI, L=Shenzhen, C=CN"
  printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=hxbot\nkeyPassword=%s\n' "$KEYSTORE" "$password" "$password" > "$PROPS"
  chmod 600 "$KEYSTORE" "$PROPS"
  echo "已生成签名文件 $KEYSTORE —— 请立即备份 hx/keys 目录。"
fi

echo "4/5 生成安卓工程并构建（约 10～20 分钟）……"
cd apps/mobile
EXPO_PUBLIC_APP_ENV=production bunx expo prebuild --platform android --clean --no-install
python3 - "$PROPS" <<'PY'
import re, sys
props = sys.argv[1]
path = "android/app/build.gradle"
text = open(path, encoding="utf-8").read()
if "hxbotRelease" not in text:
    loader = (
        "def hxbotProps = new Properties()\n"
        f"def hxbotPropsFile = file('{props}')\n"
        "if (hxbotPropsFile.exists()) { hxbotPropsFile.withInputStream { hxbotProps.load(it) } }\n\n"
    )
    text = text.replace("android {", loader + "android {", 1)
    text = re.sub(
        r"signingConfigs \{",
        "signingConfigs {\n        hxbotRelease {\n"
        "            storeFile file(hxbotProps['storeFile'])\n"
        "            storePassword hxbotProps['storePassword']\n"
        "            keyAlias hxbotProps['keyAlias']\n"
        "            keyPassword hxbotProps['keyPassword']\n        }",
        text, count=1,
    )
    release = re.search(r"buildTypes \{.*?release \{(.*?)\n        \}", text, re.S)
    if not release:
        sys.exit("没有找到 release 构建配置，请检查 android/app/build.gradle")
    body = release.group(1)
    new_body = re.sub(r"signingConfig signingConfigs\.\w+", "signingConfig signingConfigs.hxbotRelease", body)
    if new_body == body:
        new_body = "\n            signingConfig signingConfigs.hxbotRelease" + body
    text = text[: release.start(1)] + new_body + text[release.end(1):]
    open(path, "w", encoding="utf-8").write(text)
    print("已为 release 构建配置研究版签名")
PY
(cd android && ./gradlew assembleRelease --no-daemon)
cd "$ROOT"

echo "5/5 产物："
version="$(node -p 'require("./apps/mobile/app.json").expo.version')"
mkdir -p dist-hx
cp apps/mobile/android/app/build/outputs/apk/release/app-release.apk "dist-hx/HXBot-$version-android.apk"
ls -lh "dist-hx/HXBot-$version-android.apk"
shasum -a 256 "dist-hx/HXBot-$version-android.apk"
echo "上传到服务器：bash hx/scripts/upload-downloads.sh root@服务器IP dist-hx/HXBot-$version-android.apk"
