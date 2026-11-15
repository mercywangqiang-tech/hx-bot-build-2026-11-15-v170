#!/usr/bin/env python3
"""CI check: the electron-builder update files in dist/ match the installers (version, names, size, sha512 base64)."""
import base64, hashlib, json, re, sys
from pathlib import Path

kind = sys.argv[1]
dist = Path("dist")
version = json.loads(Path("package.json").read_text(encoding="utf-8"))["version"]
if kind == "mac":
    yml, names = "latest-mac.yml", [f"HXBot-{version}-arm64.zip", f"HXBot-{version}-arm64.dmg"]
    required = names + [f"HXBot-{version}-arm64.zip.blockmap", yml]
else:
    yml, names = "latest.yml", [f"HXBot-{version}-x64.exe"]
    required = names + [f"HXBot-{version}-x64.exe.blockmap", yml]
missing = [n for n in required if not (dist / n).is_file()]
if missing:
    sys.exit(f"MISSING in dist/: {missing}")
text = (dist / yml).read_text(encoding="utf-8")
print(text.encode("ascii","replace").decode())
m = re.search(r"^version:\s*(\S+)", text, re.M)
if not m or m.group(1).strip("'\"") != version:
    sys.exit(f"{yml}: version {m and m.group(1)} != package.json {version}")
# entries: "- url: X / sha512: Y / size: N" (the files list)
entries = re.findall(r"-\s+url:\s*(\S+)\s+sha512:\s*(\S+)\s+size:\s*(\d+)", text)
top = re.search(r"^path:\s*(\S+)\s*$", text, re.M)
if not entries:
    sys.exit(f"{yml}: no files entries")
bad = False
for url, sha, size in entries:
    f = dist / url
    if not f.is_file():
        print(f"FAIL {url}: not in dist/"); bad = True; continue
    h = base64.b64encode(hashlib.sha512(f.read_bytes()).digest()).decode()
    ok = (h == sha and f.stat().st_size == int(size))
    print(("OK  " if ok else "FAIL"), url, f.stat().st_size, size, h == sha)
    bad |= not ok
wanted = {n for n in names if not n.endswith(".dmg")}
if wanted - {e[0] for e in entries}:
    sys.exit(f"{yml}: files list lacks {wanted - {e[0] for e in entries}}")
if bad:
    sys.exit("update file check FAILED")
print("update files OK")
