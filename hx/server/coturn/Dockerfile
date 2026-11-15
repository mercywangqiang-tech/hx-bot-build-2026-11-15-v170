# HXBot 中继（TURN）镜像，配置与源码里的 remote/coturn 相同。
ARG COTURN_IMAGE=coturn/coturn:4.17.2-r0
FROM ${COTURN_IMAGE}
COPY turnserver.conf /etc/coturn/hxbot.conf
COPY --chmod=0755 entrypoint.sh /usr/local/bin/hxbot-coturn
ENTRYPOINT ["/usr/local/bin/hxbot-coturn"]
