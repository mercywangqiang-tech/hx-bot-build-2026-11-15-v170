/**
 * HXBot：强制更新（v1.6.2）。
 *
 * 新版本的桌面端和手机端每个请求都带 `X-HXBot-Client`，如 `desktop/0.67.1`、`android/1.5.0`、`ios/1.5.0`。
 * 账号服务只接受不低于这一版服务器所带客户端版本的请求（版本号由 hx/rebrand.py 从 hx/brand.json 写进来），
 * 更旧的回答 426，客户端据此要求更新。没有这个请求头的桌面端、手机端（0.67.0、1.4.x 及更早）不能再登录；
 * 升级到这一版时所有登录一次失效（迁移 9003），所以旧版本不更新就用不了。
 * 退出登录、注销账号和取更新文件的地址（nginx 用 hx/signed-in 校验登录）不受限制，过期的客户端也能更新。
 */

export const HX_CLIENT_HEADER = "x-hxbot-client";

/** The oldest client versions this server accepts: the versions it was built with. */
export const HX_MINIMUM_CLIENT_VERSIONS = { desktop: "0.67.0", mobile: "1.5.0" } as const;

/** The sign-in requests of the desktop and phone apps; a browser signs in elsewhere (/api/browser). */
const APP_SIGN_IN_PATHS: ReadonlySet<string> = new Set([
  "/v1/auth/email/start",
  "/v1/auth/email/verify",
  "/v1/auth/company/start",
  "/v1/auth/company/exchange",
  "/v1/mobile-auth/email/verify",
  "/v1/mobile-auth/redeem",
  "/v1/team-auth/redeem",
]);

/** What an outdated client may still do: sign out, delete its account, and fetch the update. */
const ALWAYS_OPEN: ReadonlySet<string> = new Set([
  "/v1/auth/logout",
  "/api/browser/hx/signed-in",
  "/api/browser/hx/account/delete",
]);

export interface HxClient {
  kind: "desktop" | "mobile";
  platform: string;
  version: string;
}

/** The client of a request, from its header; null when there is none or it cannot be read. */
export function hxParseClient(value: string | null): HxClient | null {
  const match = /^\s*(desktop|ios|android)\/(\d+(?:\.\d+){1,3})\s*$/iu.exec(value ?? "");
  if (!match) return null;
  const platform = (match[1] ?? "").toLowerCase();
  return { kind: platform === "desktop" ? "desktop" : "mobile", platform, version: match[2] ?? "" };
}

/** True when version `a` is older than `b` (numeric parts, missing parts are 0). */
export function hxOlderThan(a: string, b: string): boolean {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

function outdated(): Response {
  return Response.json(
    {
      error: {
        code: "client_outdated",
        message:
          // HXBot 0.67.1 起的桌面端会弹出“更新 HXBot”对话框；更早的版本没有应用内更新，只能显示这段文字。
          "这个版本的 HXBot 太旧了，更新后才能用：在 HXBot 弹出的窗口里点“立即更新”。" +
          "没有这个窗口的（0.67.0 及更早的版本），打开 https://bot.hxallai.com 登录后下载新版本安装，只需要这一次。" +
          "This HXBot version is too old. Update it to use it: choose Update now in the window HXBot opens. " +
          "If there is no such window (0.67.0 and earlier), sign in at https://bot.hxallai.com and install the new version once.",
      },
    },
    { status: 426, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}

/** The answer to an outdated app, or null to go on. The minimum is any pair of versions, not just this build's. */
export function hxClientGate(
  request: Request,
  minimum: { readonly desktop: string; readonly mobile: string } = HX_MINIMUM_CLIENT_VERSIONS,
): Response | null {
  const path = new URL(request.url).pathname;
  if (ALWAYS_OPEN.has(path) || path.startsWith("/health")) return null;
  const client = hxParseClient(request.headers.get(HX_CLIENT_HEADER));
  if (client) return hxOlderThan(client.version, minimum[client.kind]) ? outdated() : null;
  // An app without the header is older than v1.6.2's clients: it may not sign in.
  if (request.method === "POST" && APP_SIGN_IN_PATHS.has(path)) return outdated();
  return null;
}
