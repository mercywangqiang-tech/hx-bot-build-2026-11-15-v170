#!/usr/bin/env bash
# 准备好“在公开仓库里跑电脑操控真系统检查”要用的全部文件，放进一个文件夹：
#   hx-computer-check.mjs                     打好的检查程序（只含电脑操控这一块的代码）
#   .github/workflows/hx-computer-check.yml   工作流
#   README.md
# 公开仓库用 GitHub 的标准机器不计费；这样测，产品源码一直在私有仓库里，不用公开。
#   bash hx/scripts/computer-check-public.sh 输出文件夹 [分支名，默认 main]
# 然后把输出文件夹的内容作为一次提交推到那个公开仓库的那个分支，GitHub 就自动开始跑。
# 要先装好依赖（bun install）。
set -euo pipefail
OUT="${1:-}"
BRANCH="${2:-main}"
[ -n "$OUT" ] || { echo "用法：bash hx/scripts/computer-check-public.sh 输出文件夹 [分支名]" >&2; exit 1; }
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "分支名只能用字母、数字、点、横线、下划线和斜线：$BRANCH" >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$OUT/.github/workflows"
OUT="$(cd "$OUT" && pwd)"
bash "$ROOT/hx/scripts/computer-check-bundle.sh" "$OUT" >/dev/null
sed "s|__BRANCH__|$BRANCH|g" "$ROOT/hx/computer-check/public-workflow.yml" > "$OUT/.github/workflows/hx-computer-check.yml"
sed "s|__BRANCH__|$BRANCH|g" "$ROOT/hx/computer-check/public-readme.md" > "$OUT/README.md"
# 公开出去的文件里不能带服务器地址、域名、邮箱和密钥。
PRIVATE='47\.119\.|hxallai|@gmail\.|@qq\.|PRIVATE KEY'
if grep -rIlE "$PRIVATE" "$OUT" --include='*.mjs' --include='*.yml' --include='*.md' | grep -q .; then
  echo "准备公开的文件里出现了不该公开的内容：" >&2
  grep -rInE "$PRIVATE" "$OUT" --include='*.mjs' --include='*.yml' --include='*.md' | cut -c1-200 >&2
  exit 1
fi
echo "已准备好：${OUT}（分支 ${BRANCH}）"
ls -la "$OUT" "$OUT/.github/workflows" | sed -n '1,20p'
