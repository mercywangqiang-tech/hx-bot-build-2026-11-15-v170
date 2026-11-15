#!/usr/bin/env bash
# HXBot：上游自己的各项检查，研究版必须和上游一样全部通过（见 改造说明.md 第 12 节）。
# 在开发机上运行，需先 bun install。打包脚本 package-release.sh 会先运行它，任何一项不通过就不打包。
#   bash hx/scripts/check-gates.sh          运行全部检查
#   bash hx/scripts/check-gates.sh lint     只运行名字里带 lint 的检查
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
[ -x node_modules/.bin/biome ] || { echo "请先运行 bun install" >&2; exit 1; }
LOG="$(mktemp -d)"
trap 'rm -rf "$LOG"' EXIT
only="${1:-}"
failed=0

gate() {  # gate <名称> <说明> <命令…>
  local name="$1" what="$2"; shift 2
  if [ -n "$only" ] && [[ "$name" != *"$only"* ]]; then return; fi
  if "$@" > "$LOG/$name.log" 2>&1; then
    printf '  通过    %-22s %s\n' "$name" "$what"
  else
    printf '  不通过  %-22s %s\n' "$name" "$what"
    tail -n 25 "$LOG/$name.log" | sed 's/^/            /'
    failed=1
  fi
}

echo "上游的检查："
gate rebrand-check       "代码就是改造的结果，没有上游的名称和入口"   python3 hx/rebrand.py --check
gate lint                "格式与规范（Biome）"                         bun run lint
gate i18n-check          "界面文字：没有没人用的、没有没翻译也没登记的" bun run i18n:check
gate check-ui            "界面样式：没有用不到的规则"                  bun run check:ui
gate check-assets        "图片都在登记过的目录里"                      bun run check:assets
gate check-doc-links     "文档里的内部链接都有效"                      bun run check:doc-links
gate check-agent-context "发给 AI 模型的说明和工具清单没有变大"        bun run check:agent-context
gate types-ratchet       "严格类型选项下没有新增的错误"                bun run types:ratchet
gate knip                "没有用不到的文件、依赖和导出"                bun run knip:check
gate site-pages          "门户页面与 Markdown 一致"                    node hx/scripts/site-pages.mjs --check
if [ "$failed" = 0 ]; then echo "全部通过。"; else echo "有检查不通过，见上面的输出。" >&2; fi
exit "$failed"
