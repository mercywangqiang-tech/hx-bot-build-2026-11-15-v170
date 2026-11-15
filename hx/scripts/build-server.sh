#!/usr/bin/env bash
# 编译服务器端，产物放进 hx/server/（之后把整个 hx/server 目录上传到服务器即可）。
#   - hx/server/account/dist        账号服务（含网页版 /app）
#   - hx/server/account/migrations  数据库迁移
#   - hx/server/signal/signal.js    信令服务（单文件）
#   - hx/server/coturn/*            中继服务配置
# 在 Mac 或 Linux 开发机上运行，需要 Bun 1.4.x、Node 24、Python 3。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

python3 hx/rebrand.py --check >/dev/null || python3 hx/rebrand.py
# 每一项设置都要能从 .env 到达账号服务（少登记一处，这项设置就悄悄不生效）
python3 hx/scripts/check-server-vars.py

if [ ! -d node_modules ]; then
  echo "安装依赖（只装依赖，不运行安装脚本）……"
  bun install --frozen-lockfile --ignore-scripts
fi

echo "编译账号服务……"
rm -rf apps/auth-api/dist
(cd apps/auth-api && NODE_OPTIONS=--max-old-space-size=6144 ../../node_modules/.bin/vite build)
rm -f apps/auth-api/dist/server/.dev.vars
rm -rf hx/server/account/dist hx/server/account/migrations
cp -R apps/auth-api/dist hx/server/account/dist
cp -R apps/auth-api/migrations hx/server/account/migrations
# 上游官网营销页（新闻、指南、对比、提供方介绍）的配图。研究版的 nginx 把这些页面都转回门户，用不到，删掉可让部署包小约 40 MB。
(cd hx/server/account/dist/client && rm -rf compare guides providers news social hxbot-social.png hxbot-cla.pdf)

echo "打包信令服务……"
bun build remote/api/src/index.ts --target bun --outfile hx/server/signal/signal.js

echo "复制中继服务配置……"
cp remote/coturn/turnserver.conf remote/coturn/entrypoint.sh hx/server/coturn/
chmod +x hx/server/coturn/entrypoint.sh hx/server/account/entrypoint.sh hx/server/scripts/*.sh

git rev-parse --short HEAD > hx/server/BUILD_COMMIT 2>/dev/null || true
date -u +"%Y-%m-%dT%H:%M:%SZ" > hx/server/BUILD_TIME
# 同一个标记也放进账号服务的镜像（dist 会整个复制进镜像，这个文件不在对外提供的 client 目录里）：
# 服务器上 check.sh 用它核对“正在运行的容器”是不是用“当前部署包”构建的，防止解压了新包却忘了重新构建。
echo "$(cat hx/server/BUILD_COMMIT 2>/dev/null || echo unknown) $(cat hx/server/BUILD_TIME)" > hx/server/account/dist/BUILD_ID
echo "完成。上传 hx/server 目录到服务器 /opt/hxbot/server（见 hx/docs/部署文档.md）。"
