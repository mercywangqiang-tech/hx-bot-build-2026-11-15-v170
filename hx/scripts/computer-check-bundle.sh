#!/usr/bin/env bash
# 把电脑操控的真系统检查打成一个文件 hx-computer-check.mjs，Mac 和 Windows 上只要有 Node 就能运行，
# 不用安装依赖。GitHub 的检查任务（.github/workflows/hx-computer-check.yml）先在 Linux 上运行这个脚本，
# 再把得到的文件发给每台机器。
#   bash hx/scripts/computer-check-bundle.sh [输出文件夹，默认 dist-check]
# 要先装好依赖（bun install）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/dist-check}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
cd "$ROOT"
bun build scripts/hx-computer-check.ts --target=node --format=esm --outfile="$OUT/hx-computer-check.mjs" >/dev/null
# 打好的文件必须只依赖 Node 自带的模块：在一台什么都没装的机器上，别的都找不到。
if grep -E '^import .* from "[^"]+";?$' "$OUT/hx-computer-check.mjs" | grep -v 'from "node:' | grep -q .; then
  echo "打好的文件里还引用了 Node 自带模块以外的东西：" >&2
  grep -E '^import .* from "[^"]+";?$' "$OUT/hx-computer-check.mjs" | grep -v 'from "node:' >&2
  exit 1
fi
echo "$OUT/hx-computer-check.mjs（$(wc -c < "$OUT/hx-computer-check.mjs" | tr -d ' ') 字节）"
