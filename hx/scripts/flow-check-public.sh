#!/usr/bin/env bash
# 准备好“在公开仓库里跑 HX-Flow 真系统检查”要用的文件，放进一个文件夹：
#   hx-flow-system-check.mjs               打好的检查程序（只含读数和进程树这几块代码）
#   .github/workflows/hx-flow-check.yml    工作流
#   bash hx/scripts/flow-check-public.sh 输出文件夹 [分支名，默认 flow-check]
# 然后把输出文件夹的内容作为一次提交推到那个公开仓库的那个分支。要先装好依赖（bun install）。
set -euo pipefail
OUT="${1:-}"
BRANCH="${2:-flow-check}"
[ -n "$OUT" ] || { echo "用法：bash hx/scripts/flow-check-public.sh 输出文件夹 [分支名]" >&2; exit 1; }
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "分支名只能用字母、数字、点、横线、下划线和斜线：$BRANCH" >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$OUT/.github/workflows"
OUT="$(cd "$OUT" && pwd)"
cd "$ROOT"
bun build scripts/hx-flow-system-check.ts --target=node --format=esm --outfile="$OUT/hx-flow-system-check.mjs" >/dev/null
if grep -E '^import .* from "[^"]+";?$' "$OUT/hx-flow-system-check.mjs" | grep -v 'from "node:' | grep -q .; then
  echo "打好的文件里还引用了 Node 自带模块以外的东西。" >&2
  exit 1
fi
sed "s|__BRANCH__|$BRANCH|g" "$ROOT/hx/flow-check/public-workflow.yml" > "$OUT/.github/workflows/hx-flow-check.yml"
PRIVATE='47\.119\.|hxallai|@gmail\.|@qq\.|PRIVATE KEY'
if grep -rIlE "$PRIVATE" "$OUT" --include='*.mjs' --include='*.yml' | grep -q .; then
  echo "准备公开的文件里出现了不该公开的内容：" >&2
  grep -rInE "$PRIVATE" "$OUT" --include='*.mjs' --include='*.yml' | cut -c1-200 >&2
  exit 1
fi
echo "已准备好：${OUT}（分支 ${BRANCH}）"
