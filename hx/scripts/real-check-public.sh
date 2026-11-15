#!/usr/bin/env bash
# 准备“在公开仓库里跑真实模型与真机检查”（v1.6.7）要用的文件，放进一个文件夹：
#   hx-real-check.mjs                     打好的检查程序（界面文字表换成键名，见 hx/scripts/real-check-build.ts）
#   .github/workflows/hx-real-check.yml   工作流（驱动的版本和校验值取自 native-runtime.lock.json）
#   bash hx/scripts/real-check-public.sh 输出文件夹 [分支名，默认 main]
# 然后把这两个文件提交到那个公开仓库的那个分支，GitHub 就自动开始跑。要先装好依赖（bun install）。
set -euo pipefail
OUT="${1:-}"
BRANCH="${2:-main}"
[ -n "$OUT" ] || { echo "用法：bash hx/scripts/real-check-public.sh 输出文件夹 [分支名]" >&2; exit 1; }
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "分支名只能用字母、数字、点、横线、下划线和斜线：$BRANCH" >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$OUT/.github/workflows"
OUT="$(cd "$OUT" && pwd)"
bun "$ROOT/hx/scripts/real-check-build.ts" "$OUT/hx-real-check.mjs"
if grep -E '^import .* from "[^"]+";?$' "$OUT/hx-real-check.mjs" | grep -v 'from "node:' | grep -q .; then
  echo "打好的文件里还引用了 Node 自带模块以外的东西。" >&2
  exit 1
fi
python3 -I - "$ROOT/native-runtime.lock.json" "$ROOT/hx/computer-check/real-workflow.yml" "$OUT/.github/workflows/hx-real-check.yml" "$BRANCH" <<'PY'
import json, sys
lock, template, out, branch = sys.argv[1:5]
driver = json.load(open(lock, encoding="utf-8"))["cuaDriver"]
mac, win = driver["artifacts"]["darwin-arm64"], driver["artifacts"]["win32-x64"]
values = {
    "__BRANCH__": branch,
    "__TAG__": driver["tag"],
    "__MAC_ASSET__": mac["asset"],
    "__MAC_SHA__": mac["assetSha256"],
    "__MAC_BINARY_SHA__": mac["files"]["cua-driver"],
    "__WIN_ASSET__": win["asset"],
    "__WIN_SHA__": win["assetSha256"],
    "__WIN_BINARY_SHA__": win["files"]["cua-driver.exe"],
}
text = open(template, encoding="utf-8").read()
for key, value in values.items():
    text = text.replace(key, value)
import re
left = re.findall(r"__[A-Z_]+__", text)
assert not left, f"placeholders are left: {left}"
open(out, "w", encoding="utf-8").write(text)
PY
# 公开出去的文件里不能带服务器地址、域名、邮箱和密钥（日志脱敏规则里的“PRIVATE KEY”字样不是密钥）。
PRIVATE='47\.119\.|hxallai|@gmail\.|@qq\.|-----BEGIN [A-Z ]*PRIVATE KEY-----[A-Za-z0-9+/=[:space:]]{40}'
if grep -rIlE "$PRIVATE" "$OUT" --include='*.mjs' --include='*.yml' | grep -q .; then
  echo "准备公开的文件里出现了不该公开的内容：" >&2
  grep -rIoE ".{0,40}($PRIVATE).{0,40}" "$OUT" --include='*.mjs' --include='*.yml' | cut -c1-200 >&2
  exit 1
fi
echo "已准备好：${OUT}（分支 ${BRANCH}，$(wc -c < "$OUT/hx-real-check.mjs" | tr -d ' ') 字节）"
