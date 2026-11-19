#!/usr/bin/env bash
# 把六个技能的样例任务（scripts/hx-skill-samples-e2e.ts）打成一个文件夹，Mac 和 Windows 上只要有 Node
# （或 Bun）就能运行，不用装依赖：
#   <输出文件夹>/hx-skill-samples.mjs            程序本身
#   <输出文件夹>/node_modules/pdfjs-dist/        取 PDF 文字用的 pdf.js（只留运行时要的部分）
#   <输出文件夹>/skills_crosscheck.py            用别人的库再读一遍（要 pip install openpyxl python-docx python-pptx pypdf）
#   <输出文件夹>/fixtures/                       应用路线（--apps）的夹具：老格式的表格、文档、演示
#   bash hx/scripts/skill-samples-bundle.sh [输出文件夹，默认 dist-skill-samples]
# 要先装好依赖（bun install）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/dist-skill-samples}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
cd "$ROOT"
bun build scripts/hx-skill-samples-e2e.ts --target=node --format=esm --external=pdfjs-dist \
  --outfile="$OUT/hx-skill-samples.mjs" >/dev/null
# 打好的文件只能依赖 Node 自带的模块和旁边的 pdf.js。
if grep -E '^import .* from "[^"]+";?$' "$OUT/hx-skill-samples.mjs" | grep -v -E 'from "(node:|pdfjs-dist)' | grep -q .; then
  echo "打好的文件里还引用了别的东西：" >&2
  grep -E '^import .* from "[^"]+";?$' "$OUT/hx-skill-samples.mjs" | grep -v -E 'from "(node:|pdfjs-dist)' >&2
  exit 1
fi
PDFJS="$ROOT/node_modules/pdfjs-dist"
DEST="$OUT/node_modules/pdfjs-dist"
rm -rf "$DEST"
mkdir -p "$DEST/legacy/build"
cp "$PDFJS/package.json" "$PDFJS/LICENSE" "$DEST/"
cp "$PDFJS/legacy/build/pdf.mjs" "$PDFJS/legacy/build/pdf.worker.mjs" "$DEST/legacy/build/"
for folder in cmaps standard_fonts wasm iccs; do
  if [ -d "$PDFJS/$folder" ]; then cp -R "$PDFJS/$folder" "$DEST/$folder"; fi
done
cp "$ROOT/hx/computer-check/skills_crosscheck.py" "$OUT/"
rm -rf "$OUT/fixtures"
cp -R "$ROOT/hx/computer-check/fixtures" "$OUT/fixtures"
echo "$OUT（$(du -sh "$OUT" | cut -f1)）"
