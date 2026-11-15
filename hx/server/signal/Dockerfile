# HXBot 信令服务（remote/api 的 Signal）镜像。
# signal.js 是 remote/api 用 `bun build --target bun` 打成的单文件（hx/scripts/build-server.sh 生成），
# 所以服务器上不需要安装任何 npm 依赖。
ARG BUN_IMAGE=oven/bun:1.4.2-alpine
FROM ${BUN_IMAGE}
WORKDIR /app
COPY signal.js ./signal.js
ENV NODE_ENV=production
USER bun
EXPOSE 8081
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD bun -e 'const r=await fetch("http://127.0.0.1:8080/health/ready");process.exit(r.ok?0:1)'
ENTRYPOINT ["bun", "signal.js"]
