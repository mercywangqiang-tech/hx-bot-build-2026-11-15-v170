# HXBot 账号服务镜像。
# 构建上下文是 hx/server/account：其中的 dist/ 是已编译好的账号服务（hx/scripts/build-server.sh 生成），
# migrations/ 是数据库迁移。服务器上不需要编译源码，只安装 wrangler（含 workerd 运行时）。
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}

# 国内服务器默认用 npmmirror；海外服务器可在 docker-compose.yml 里把 NPM_REGISTRY 改成 https://registry.npmjs.org
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG WRANGLER_VERSION=4.152.0
RUN npm config set registry "$NPM_REGISTRY" \
  && npm install -g "wrangler@${WRANGLER_VERSION}" --no-fund --no-audit \
  && npm cache clean --force \
  && wrangler --version

# workerd 启动时要读取系统根证书（/etc/ssl/certs），node 的 slim 镜像不带，缺了会报
# “No CA certificates were loaded from the system”而无法启动。
# 先从 Debian 镜像源（默认阿里云）安装 ca-certificates；装不上时改用部署包自带的根证书（Mozilla 根证书列表）。
ARG DEBIAN_MIRROR=mirrors.aliyun.com
COPY ca-certificates.crt /tmp/hxbot-ca.crt
RUN set -e; \
  if [ -n "$DEBIAN_MIRROR" ] && [ -f /etc/apt/sources.list.d/debian.sources ]; then \
    sed -i "s|http://deb.debian.org|http://$DEBIAN_MIRROR|g" /etc/apt/sources.list.d/debian.sources; \
  fi; \
  if apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 update \
    && apt-get install -y --no-install-recommends ca-certificates; then \
    echo "已安装 ca-certificates"; \
  else \
    echo "无法从 Debian 镜像源安装 ca-certificates，改用部署包自带的根证书"; \
    mkdir -p /etc/ssl/certs; \
    cp /tmp/hxbot-ca.crt /etc/ssl/certs/ca-certificates.crt; \
  fi; \
  rm -rf /var/lib/apt/lists/* /tmp/hxbot-ca.crt; \
  test -s /etc/ssl/certs/ca-certificates.crt

WORKDIR /app
COPY dist ./dist
COPY migrations ./migrations
COPY --chmod=0755 entrypoint.sh /usr/local/bin/hxbot-account
RUN chmod 0755 /usr/local/bin/hxbot-account \
  && mkdir -p /state \
  && chown -R node:node /app /state

USER node
EXPOSE 8787
HEALTHCHECK --interval=20s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e 'fetch("http://127.0.0.1:8787/health/live").then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
ENTRYPOINT ["/usr/local/bin/hxbot-account"]
CMD ["serve"]
