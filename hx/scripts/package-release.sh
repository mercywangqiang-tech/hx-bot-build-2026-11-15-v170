#!/usr/bin/env bash
# 打交付包（在开发机上运行，需先运行 build-server.sh）：
#   bash hx/scripts/package-release.sh 版本 [上一版本]
#   dist-hx/hxbot-server-v<版本>.zip          服务器全量包（解压到 /opt/hxbot 得到 server/；全新部署和任何旧版本升级都用它）
#   dist-hx/hxbot-server-update-v<版本>.zip   服务器更新包：只含上一版本以来变动的文件，只能从上一版本升级
#                                             （上一版本的全量包要在 dist-hx/ 里；不写上一版本时取 dist-hx/ 里最新的旧版本）
#   dist-hx/latest.json                       服务器自动更新读的版本信息（和两个包放在同一个目录，auto-update.sh --enable 这个目录）
#   dist-hx/SHA256SUMS                        各个文件的 SHA-256
#   dist-hx/hxbot-source-v<版本>.zip          完整源码（含 git 历史，可直接构建客户端）
#   dist-hx/hxbot-v<版本>.patch               相对上游提交的全部改动
#   dist-hx/<文档>-v<版本>.md / .html          部署文档、上线操作手册、客户端构建、服务器构建（.html 可离线打开、打印）
#   dist-hx/新功能说明-v<版本>.md / .html      新功能与亮点（hx/docs/site/whats-new.zh.md：这一版在最前，含之前各版；
#                                            标题用客户端版本号；截图在 新功能截图-v<版本>/，.html 内嵌截图）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
TAG="${1:-1}"
PREVIOUS="${2:-}"
[[ "$TAG" =~ ^[0-9]+(\.[0-9]+){1,3}$ ]] || { echo "版本号要写成 1.6.2 这样的数字" >&2; exit 1; }
OUT="$ROOT/dist-hx"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$OUT"

[ -f hx/server/account/dist/server/wrangler.json ] || { echo "请先运行 bash hx/scripts/build-server.sh" >&2; exit 1; }
[ -f hx/server/signal/signal.js ] || { echo "请先运行 bash hx/scripts/build-server.sh" >&2; exit 1; }

# 上游自己的各项检查必须全部通过（含门户页面与 hx/docs/site 里的 Markdown 一致），见 改造说明.md 第 12 节
bash hx/scripts/check-gates.sh

# 不写上一版本时，取 dist-hx/ 里版本最新的旧全量包
if [ -z "$PREVIOUS" ]; then
  PREVIOUS="$(ls "$OUT"/hxbot-server-v*.zip 2>/dev/null | sed -n 's/.*hxbot-server-v\([0-9][0-9.]*[0-9]\)\.zip$/\1/p' |
    python3 -c 'import sys
def key(v): return tuple(int(p) for p in v.split("."))
tag = key(sys.argv[1])
older = sorted((v for v in sys.stdin.read().split() if key(v) < tag), key=key)
print(older[-1] if older else "")' "$TAG")"
fi
# 每个版本交付四份文档（见 改造说明.md 第 18 节），文档里写的包名必须就是这次打的包：照着文档敲 scp、unzip 时
# 文件名对不上就走不下去。服务器构建文档里要写上一版的全量包（打更新包时要用），所以上一版本的包名也允许。
DOCS=(部署文档 上线操作手册 客户端构建 服务器构建)
DOC_FILES=()
for doc in "${DOCS[@]}"; do
  [ -f "hx/docs/$doc.md" ] || { echo "缺少文档 hx/docs/$doc.md" >&2; exit 1; }
  DOC_FILES+=("hx/docs/$doc.md")
done
allowed="${TAG//./\\.}${PREVIOUS:+|${PREVIOUS//./\\.}}"
stale="$(grep -ohE 'hxbot-(server-update|server|source)-v[0-9][0-9.]*[0-9]' "${DOC_FILES[@]}" | grep -vxE "hxbot-(server-update|server|source)-v($allowed)" | sort -u || true)"
[ -z "$stale" ] || { echo "文档里的包名与本次版本 v$TAG 不一致，请先改文档：$stale" >&2; exit 1; }
# 部署文档的 HTML 版必须是由当前的 Markdown 生成的（生成日期不比较）
node hx/scripts/doc-html.mjs hx/docs/部署文档.md "$STAGE/部署文档.html" >/dev/null
same_document() { sed -E 's/[0-9]{4} 年 [0-9]{1,2} 月 [0-9]{1,2} 日//g' "$1" | cmp -s - <(sed -E 's/[0-9]{4} 年 [0-9]{1,2} 月 [0-9]{1,2} 日//g' "$2"); }
same_document "$STAGE/部署文档.html" hx/docs/部署文档.html || { echo "hx/docs/部署文档.html 不是最新的，请先运行 node hx/scripts/doc-html.mjs 并提交" >&2; exit 1; }
rm -f "$STAGE/部署文档.html"

echo "服务器部署包……"
mkdir -p "$STAGE/srv/server"
cp -a hx/server/. "$STAGE/srv/server/"
# Python 的缓存文件（运行脚本或测试时生成）不进部署包
find "$STAGE/srv/server" -name __pycache__ -type d -prune -exec rm -rf {} +
rm -f "$STAGE/srv/server/.env" "$STAGE/srv/server/account/dist/server/.dev.vars"
cp hx/docs/部署文档.md "$STAGE/srv/server/部署文档.md"
cp hx/docs/部署文档.html "$STAGE/srv/server/部署文档.html"
cp LICENSE NOTICE "$STAGE/srv/server/"
echo "$TAG" > "$STAGE/srv/server/VERSION"
(cd "$STAGE/srv" && rm -f "$OUT/hxbot-server-v$TAG.zip" && zip -qr -X "$OUT/hxbot-server-v$TAG.zip" server)

echo "服务器更新包……"
rm -f "$OUT/hxbot-server-update-v$TAG.zip"
if [ -n "$PREVIOUS" ] && [ -f "$OUT/hxbot-server-v$PREVIOUS.zip" ]; then
  mkdir -p "$STAGE/update/server/.hx-update"
  # 和上一版本的全量包逐个文件比较：变了的和新增的放进更新包，没有了的记进 deleted.txt。
  # 升级脚本、版本号、构建信息每次都带上（更新时总是先用包里的升级脚本）。
  python3 - "$OUT/hxbot-server-v$PREVIOUS.zip" "$STAGE/srv/server" "$STAGE/update/server" <<'PY'
import hashlib, os, shutil, sys, zipfile
previous, current, update = sys.argv[1], sys.argv[2], sys.argv[3]
old = {}
def real_name(info):
    # zip 没有标 UTF-8 时 Python 按 cp437 解码文件名；Linux 的 zip 写的其实是 UTF-8，按 UTF-8 还原，
    # 否则中文文件名（部署文档.md）会被当成“已删除”写进 deleted.txt。
    if info.flag_bits & 0x800:
        return info.filename
    try:
        return info.filename.encode("cp437").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return info.filename
with zipfile.ZipFile(previous) as archive:
    for info in archive.infolist():
        name = real_name(info)
        if info.is_dir() or not name.startswith("server/"):
            continue
        old[name[len("server/"):]] = (hashlib.sha256(archive.read(info)).hexdigest(), (info.external_attr >> 16) & 0o777)
    from_commit = archive.read("server/BUILD_COMMIT").decode().strip() if "server/BUILD_COMMIT" in archive.namelist() else ""
new = {}
for folder, _, files in os.walk(current):
    for name in files:
        path = os.path.join(folder, name)
        relative = os.path.relpath(path, current)
        with open(path, "rb") as handle:
            new[relative] = (hashlib.sha256(handle.read()).hexdigest(), os.stat(path).st_mode & 0o777)
always = {"scripts/update.sh", "VERSION", "BUILD_COMMIT", "BUILD_TIME"}
changed = sorted(path for path in new if path in always or old.get(path, (None,))[0] != new[path][0] or old[path][1] != new[path][1])
deleted = sorted(path for path in old if path not in new)
for path in changed:
    target = os.path.join(update, path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    shutil.copy2(os.path.join(current, path), target)
with open(os.path.join(update, ".hx-update", "deleted.txt"), "w", encoding="utf-8") as handle:
    handle.write("".join(path + "\n" for path in deleted))
with open(os.path.join(current, "VERSION"), encoding="utf-8") as handle:
    to_version = handle.read().strip()
from_version = os.path.basename(previous)[len("hxbot-server-v"):-len(".zip")]
with open(os.path.join(current, "BUILD_COMMIT"), encoding="utf-8") as handle:
    to_commit = handle.read().strip()
with open(os.path.join(update, ".hx-update", "package"), "w", encoding="utf-8") as handle:
    handle.write("kind=update\nfrom_version={}\nfrom_commit={}\nto_version={}\nto_commit={}\n".format(from_version, from_commit, to_version, to_commit))
if not from_commit:
    raise SystemExit("上一版本的全量包里没有 BUILD_COMMIT，打不了更新包")
print("  比 v{} 变动 {} 个文件，删除 {} 个".format(from_version, len(changed), len(deleted)))
PY
  (cd "$STAGE/update" && zip -qr -X "$OUT/hxbot-server-update-v$TAG.zip" server)
else
  echo "  dist-hx/ 里没有上一版本的全量包${PREVIOUS:+（hxbot-server-v$PREVIOUS.zip）}，这次只有全量包。"
fi
python3 - "$OUT" "$TAG" "$PREVIOUS" <<'PY'
import hashlib, json, os, sys, zipfile
from datetime import datetime, timezone
out, tag, previous = sys.argv[1], sys.argv[2], sys.argv[3]
def entry(name):
    path = os.path.join(out, name)
    with open(path, "rb") as handle:
        return {"file": name, "sha256": hashlib.sha256(handle.read()).hexdigest(), "size": os.path.getsize(path)}
full = entry("hxbot-server-v{}.zip".format(tag))
with zipfile.ZipFile(os.path.join(out, full["file"])) as archive:
    commit = archive.read("server/BUILD_COMMIT").decode().strip()
latest = {"version": tag, "commit": commit, "date": datetime.now(timezone.utc).isoformat(timespec="seconds"), "full": full, "updates": []}
update = "hxbot-server-update-v{}.zip".format(tag)
if os.path.exists(os.path.join(out, update)):
    with zipfile.ZipFile(os.path.join(out, update)) as archive:
        package = dict(line.split("=", 1) for line in archive.read("server/.hx-update/package").decode().split("\n") if "=" in line)
    latest["updates"].append(dict(entry(update), fromVersion=package["from_version"], fromCommit=package["from_commit"]))
with open(os.path.join(out, "latest.json"), "w", encoding="utf-8") as handle:
    json.dump(latest, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY

echo "源码包……"
git clone -q --no-local --branch "$(git rev-parse --abbrev-ref HEAD)" "$ROOT" "$STAGE/hx-bot"
git -C "$STAGE/hx-bot" remote set-url origin https://github.com/nightly-labs/openbot.git
git -C "$STAGE/hx-bot" remote rename origin upstream
(cd "$STAGE" && rm -f "$OUT/hxbot-source-v$TAG.zip" && zip -qry -X "$OUT/hxbot-source-v$TAG.zip" hx-bot)

echo "补丁……"
UPSTREAM="$(python3 -c 'import json;print(json.load(open("hx/brand.json"))["upstream"]["commit"])')"
git diff --binary "$UPSTREAM" HEAD > "$OUT/hxbot-v$TAG.patch"

echo "文档……"
for doc in "${DOCS[@]}"; do
  cp "hx/docs/$doc.md" "$OUT/$doc-v$TAG.md"
  node hx/scripts/doc-html.mjs "hx/docs/$doc.md" "$OUT/$doc-v$TAG.html" >/dev/null
done
# 新功能与亮点：门户页面的原文。用户看到的版本号是客户端的版本号（hx/brand.json），内部版本号只用在文件名上。
# 截图另放在“新功能截图-v版本”文件夹，.md 引用它；.html 把截图内嵌进去，单文件就能看。
python3 - "$TAG" "$OUT" <<'PY'
import json, re, shutil, sys
from pathlib import Path
tag, out = sys.argv[1], Path(sys.argv[2])
versions = json.load(open("hx/brand.json", encoding="utf-8"))["versions"]
clients = f"桌面端 {versions['desktop']} · 手机端 {versions['mobile']}"
text = open("hx/docs/site/whats-new.zh.md", encoding="utf-8").read()
if f"\nversion: {clients}\n" not in text:
    sys.exit(f"hx/docs/site/whats-new.zh.md 的 version 不是“{clients}”，请先写这一版的新功能")
body = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)
body = re.sub(r" \{#[a-z0-9-]+\}$", "", body, flags=re.M)
# 文档版式不认引用块里的列表：“亮点”改成普通的小标题和编号列表
body = re.sub(r"^> \*\*(.+?)\*\*$", r"**\1**\n", body, flags=re.M)
body = re.sub(r"^> ", "", body, flags=re.M)
shots = out / f"新功能截图-v{tag}"
shots.mkdir(exist_ok=True)
def image(m):
    src = m.group(2)
    if not src.startswith("/hx-portal/"):
        sys.exit(f"新功能页的图片应在 /hx-portal/ 下：{src}")
    file = Path("hx/server/portal/assets") / src[len("/hx-portal/"):]
    shutil.copyfile(file, shots / file.name)
    return f"![{m.group(1)}]({shots.name}/{file.name})"
body = re.sub(r"^!\[([^\]]*)\]\((\S+?)\)$", image, body, flags=re.M)
head = f"# 新功能与亮点（{clients}）\n\n更新页面：https://bot.hxallai.com/whats-new/\n"
# 网页版由 doc-html.mjs 画出 HOT、NEW 角标和“能在哪些端用”；Markdown 里写成文字
(out / f"新功能说明-v{tag}.src.md").write_text(head + body, encoding="utf-8")
plain = re.sub(r"\{(HOT|NEW)\}\s*", r"**[\1]** ", body)
plain = re.sub(r"\s*\{on:([^{}]+)\}", r"（\1）", plain)
(out / f"新功能说明-v{tag}.md").write_text(head + plain, encoding="utf-8")
PY
node hx/scripts/doc-html.mjs "$OUT/新功能说明-v$TAG.src.md" "$OUT/新功能说明-v$TAG.html" >/dev/null
rm -f "$OUT/新功能说明-v$TAG.src.md"

(cd "$OUT" && sha256sum "hxbot-server-v$TAG.zip" $([ -f "hxbot-server-update-v$TAG.zip" ] && echo "hxbot-server-update-v$TAG.zip") \
  "hxbot-source-v$TAG.zip" "hxbot-v$TAG.patch" latest.json > SHA256SUMS)

ls -lh "$OUT"/hxbot-* "$OUT"/*-v"$TAG".md "$OUT"/*-v"$TAG".html
