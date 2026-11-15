#!/usr/bin/env bash
# 备份 HXBot 账号数据库（用户、登录会话、主机目录）。在服务器上以 root 运行：
#   bash /opt/hxbot/server/scripts/backup.sh
# 为保证数据库文件一致，备份时会暂停账号服务约 10 秒（已建立的远程连接不受影响，期间新登录会失败）。
# 备份文件在 /opt/hxbot/backups/，保留最近 14 份，且最多保留 30 天（与《隐私政策》一致）。建议每天凌晨自动运行：
#   echo '30 4 * * * root bash /opt/hxbot/server/scripts/backup.sh >> /var/log/hxbot-backup.log 2>&1' > /etc/cron.d/hxbot-backup
# 恢复方法见部署文档“备份与恢复”。
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP_DIR=/opt/hxbot/backups
install -d -m 0700 "$BACKUP_DIR"
name="account-$(date +%Y%m%d-%H%M%S).tgz"

docker compose stop account-cron account >/dev/null
restart() { docker compose start account account-cron >/dev/null; }
trap restart EXIT
docker run --rm --user 0 --entrypoint sh \
  -v hxbot_account-state:/state:ro -v "$BACKUP_DIR:/backup" hxbot/account:local \
  -c "umask 077 && tar czf /backup/$name -C /state ."
restart
trap - EXIT

ls -1t "$BACKUP_DIR"/account-*.tgz | tail -n +15 | xargs -r rm -f
find "$BACKUP_DIR" -maxdepth 1 -name 'account-*.tgz' -mtime +30 -delete
echo "$(date '+%F %T') 已备份：$BACKUP_DIR/$name（$(du -h "$BACKUP_DIR/$name" | cut -f1)）"
