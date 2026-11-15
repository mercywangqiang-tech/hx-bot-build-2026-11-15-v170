/**
 * HXBot 研究版的登录名单。
 *
 * `HX_ALLOWED_EMAILS`（逗号分隔的完整邮箱）和 `HX_ALLOWED_EMAIL_DOMAINS`（逗号分隔的域名，如
 * `hxallai.com`）都为空时，任何邮箱都能收到验证码；任一项有值时，只有名单内的邮箱能登录。
 * 名单只挡新的登录，已登录的会话不受影响。
 */
export function hxEmailAllowed(values: {
  emails?: string | undefined;
  domains?: string | undefined;
}): (email: string) => boolean {
  const emails = list(values.emails);
  const domains = list(values.domains).map((domain) => domain.replace(/^@/u, ""));
  if (emails.length === 0 && domains.length === 0) return () => true;
  return (email) => {
    const normalized = email.trim().toLowerCase();
    const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
    return emails.includes(normalized) || domains.includes(domain);
  };
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}
