FROM coturn/coturn:4.17.2-r0
COPY remote/coturn/turnserver.conf /etc/coturn/hxbot.conf
COPY remote/coturn/entrypoint.sh /usr/local/bin/hxbot-coturn
ENTRYPOINT ["/usr/local/bin/hxbot-coturn"]
