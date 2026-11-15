#!/bin/sh
# 生成 HXBot 服务器所需的全部密钥，写入 hx/server/.env。
# 已经有值的项不会被覆盖，所以可以放心重复运行。需要 openssl 和 python3（服务器一般自带）。
set -eu
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "已从 .env.example 创建 .env"
fi
chmod 600 .env

command -v openssl >/dev/null 2>&1 || { echo "缺少 openssl" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "缺少 python3" >&2; exit 1; }

KEY_PEM="$(mktemp)"
trap 'rm -f "$KEY_PEM"' EXIT
openssl ecparam -name prime256v1 -genkey -noout -out "$KEY_PEM" 2>/dev/null

HXBOT_KEY_TEXT="$(openssl ec -in "$KEY_PEM" -text -noout 2>/dev/null)" \
HXBOT_SECRET_1="$(openssl rand -hex 48)" \
HXBOT_SECRET_2="$(openssl rand -hex 48)" \
HXBOT_SECRET_3="$(openssl rand -hex 48)" \
HXBOT_SECRET_4="$(openssl rand -hex 48)" \
HXBOT_SECRET_5="$(openssl rand -hex 48)" \
HXBOT_SECRET_6="$(openssl rand -hex 48)" \
python3 - <<'PY'
import base64, json, os, re

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def hex_block(text: str, label: str) -> bytes:
    match = re.search(label + r":\s*\n((?:\s+[0-9a-f:]+\n?)+)", text)
    return bytes.fromhex(re.sub(r"[\s:]", "", match.group(1)))

text = os.environ["HXBOT_KEY_TEXT"]
d = hex_block(text, "priv").rjust(32, b"\0")[-32:]
pub = hex_block(text, "pub")
assert pub[0] == 4 and len(pub) == 65, "unexpected public key format"
x, y = pub[1:33], pub[33:65]

env_path = ".env"
lines = open(env_path, encoding="utf-8").read().splitlines()
values = {}
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
kid = values.get("REMOTE_TICKET_KEY_ID") or "hxbot-remote-1"
meta = {"kid": kid, "alg": "ES256", "use": "sig"}
public_jwk = {"kty": "EC", "crv": "P-256", "x": b64url(x), "y": b64url(y), **meta}
private_jwk = {**public_jwk, "d": b64url(d)}

generated = {
    "REMOTE_TICKET_KEY_ID": kid,
    "REMOTE_TICKET_PRIVATE_JWK": json.dumps(private_jwk, separators=(",", ":")),
    "REMOTE_TICKET_PUBLIC_JWKS": json.dumps({"keys": [public_jwk]}, separators=(",", ":")),
    "REMOTE_AUTH_WEBHOOK_SECRET": os.environ["HXBOT_SECRET_1"],
    "REMOTE_SESSION_SECRET": os.environ["HXBOT_SECRET_2"],
    "REMOTE_METRICS_TOKEN": os.environ["HXBOT_SECRET_3"],
    "TURN_SHARED_SECRET": os.environ["HXBOT_SECRET_4"],
    "SKILLS_ADMIN_TOKEN": os.environ["HXBOT_SECRET_5"],
    "SITE_REPORT_HASH_SECRET": os.environ["HXBOT_SECRET_6"],
}
# 私钥和公钥必须成对：只要缺一个，就两个都重新生成。
pair = ("REMOTE_TICKET_PRIVATE_JWK", "REMOTE_TICKET_PUBLIC_JWKS")
regenerate_pair = not (values.get(pair[0]) and values.get(pair[1]))

out, written = [], []
seen = set()
for line in lines:
    key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else None
    if key in generated:
        seen.add(key)
        empty = not values.get(key)
        if (key in pair and regenerate_pair) or (key not in pair and empty):
            out.append(f"{key}='{generated[key]}'")
            written.append(key)
            continue
    out.append(line)
for key, value in generated.items():
    if key not in seen:
        out.append(f"{key}='{value}'")
        written.append(key)
open(env_path, "w", encoding="utf-8").write("\n".join(out) + "\n")
print("已生成：" + ("、".join(written) if written else "无（全部已有值）"))
PY

missing=""
for key in TURN_PUBLIC_IP; do
  if ! grep -Eq "^${key}=['\"]?[^'\"[:space:]]+" .env; then missing="$missing $key"; fi
done
if [ -n "$missing" ]; then
  echo "还需要填写 .env 中的：$missing（用 bash scripts/set-env.sh 变量名 值）"
else
  echo ".env 的必填项已就绪。"
fi
echo "注册和登录的各项设置（发信邮箱、短信、第三方登录）是否填好，运行 bash scripts/set-env.sh --show 查看。"
