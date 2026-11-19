#!/usr/bin/env bash
# HXBot v1.7.2：取上一版的安装包，给 scripts/hx-desktop-check.mjs 作对比（.github/workflows/hx-build.yml 的 desktop-check-*）。
#   bash hx/scripts/desktop-check-baseline.sh <mac|windows> <放到的文件夹>
# 环境变量：BASELINE（本仓库一个 Release 的标签或名字，草稿也行），GH_TOKEN，GITHUB_REPOSITORY。
# 找不到时不报错：检查只在新版上跑。
set -euo pipefail
platform="$1"
folder="$2"
case "$platform" in
  mac) pattern='-arm64\.zip$' ;;
  windows) pattern='-x64\.exe$' ;;
  *) echo "The platform is mac or windows." >&2; exit 2 ;;
esac
release=$(gh api "repos/$GITHUB_REPOSITORY/releases?per_page=100" \
  --jq '([.[] | select(.tag_name == env.BASELINE or .name == env.BASELINE or .name == ("HXBot " + env.BASELINE))][0] // empty) | .id')
if [ -z "$release" ]; then
  echo "No release $BASELINE in this repository: the check runs on the new build only."
  exit 0
fi
asset=$(PATTERN="$pattern" gh api "repos/$GITHUB_REPOSITORY/releases/$release/assets?per_page=100" \
  --jq '([.[] | select(.name | test(env.PATTERN))][0] // empty) | "\(.id) \(.name)"')
if [ -z "$asset" ]; then
  echo "Release $BASELINE has no $platform package: the check runs on the new build only."
  exit 0
fi
id="${asset%% *}"
name="${asset#* }"
mkdir -p "$folder"
gh api -H "Accept: application/octet-stream" "repos/$GITHUB_REPOSITORY/releases/assets/$id" > "$folder/$name"
ls -l "$folder"
