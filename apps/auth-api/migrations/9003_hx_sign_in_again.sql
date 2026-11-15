-- HXBot v1.6.2：强制更新。所有登录一次失效，每个人用新版本的客户端（或网页）重新登录；
-- 旧版本的桌面端和手机端不带版本请求头，不能再登录（src/server/hx-client-version.ts）。
UPDATE auth_sessions SET revoked_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE revoked_at IS NULL;
