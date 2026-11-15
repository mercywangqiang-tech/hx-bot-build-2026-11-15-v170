#!/usr/bin/env bash
# 把这一版的源码推到你们自己的私有 GitHub 仓库，用来在 GitHub 上打包安装包（客户端构建.md 第 6 节）。
#   bash hx/scripts/push-github.sh GitHub账号名 [仓库名，默认 hx-bot]
# 做的事（不改动当前文件夹）：
#   1. 在临时文件夹里取出当前提交的全部文件，不带历史记录（源码包里的历史是截断的，GitHub 不接收）；
#   2. 去掉上游项目自带的自动任务，只留 HXBot 的打包任务 hx-build.yml、电脑操控的真系统检查
#      hx-computer-check.yml 和改造脚本要用的 release.yml
#      （上游的任务有的每 5 分钟运行一次，会很快用光私有仓库的免费额度；
#      留下的这三个都不会自己运行，要在 Actions 页面上手动点）；
#   3. 作为一次提交（提交人 HXBot build <bot@hxallai.com>）强制推到仓库的 main 分支，替换上一版。
set -euo pipefail
OWNER="${1:-}"
REPO="${2:-hx-bot}"
[[ "$OWNER" =~ ^[A-Za-z0-9][A-Za-z0-9-]*$ ]] || { echo "用法：bash hx/scripts/push-github.sh GitHub账号名 [仓库名]" >&2; exit 1; }
[[ "$REPO" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "仓库名只能用字母、数字、点、横线和下划线：$REPO" >&2; exit 1; }
REMOTE="${HX_GITHUB_REMOTE:-git@github.com:$OWNER/$REPO.git}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

git rev-parse --verify -q HEAD >/dev/null || { echo "$ROOT 不是源码包解压出来的文件夹（没有 git 记录）。" >&2; exit 1; }
if [ -n "$(git status --porcelain)" ]; then
  echo "这个文件夹里有改动过的文件（git status 能看到）。为了推上去的就是交付的源码，请重新解压一份源码包再推。" >&2
  git status --short | head -10 >&2
  exit 1
fi
[ -f .github/workflows/hx-build.yml ] || { echo "源码里没有 .github/workflows/hx-build.yml，不能在 GitHub 上打包。" >&2; exit 1; }

COMMIT="$(git rev-parse --short HEAD)"
DESKTOP="$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' package.json | head -1)"
MOBILE="$(sed -n 's/^    "version": "\([^"]*\)".*/\1/p' apps/mobile/app.json | head -1)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "取出提交 $COMMIT 的文件（桌面端 ${DESKTOP}，手机端 ${MOBILE}）……"
git archive --format=tar HEAD | tar -x -C "$STAGE"
cd "$STAGE"
removed=0
for workflow in .github/workflows/*; do
  case "$(basename "$workflow")" in
    hx-build.yml | hx-computer-check.yml | release.yml) ;;
    *) rm -f "$workflow"; removed=$((removed + 1)) ;;
  esac
done
rm -f .github/dependabot.yml
echo "去掉了上游的 $removed 个自动任务，留下：$(cd .github/workflows && ls | tr '\n' ' ')"
git init -q -b main
git add -A
git -c user.name="HXBot build" -c user.email="bot@hxallai.com" -c core.hooksPath=/dev/null \
  commit -q -m "HXBot 源码（提交 ${COMMIT}，桌面端 ${DESKTOP}，手机端 ${MOBILE}），GitHub 打包用"
echo "推到 ${REMOTE}（约 25 MB）……"
git -c push.negotiate=false push --force "$REMOTE" main:main
echo "完成。打开 https://github.com/$OWNER/$REPO/actions → HXBot build → Run workflow。"
