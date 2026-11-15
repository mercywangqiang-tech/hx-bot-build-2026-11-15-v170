/**
 * HXBot：注册、找回密码、第三方登录的接口，挂在浏览器接口的 /api/browser/hx/ 下。
 *
 *   GET  hx/settings                       页面要显示什么：要不要验证码、开了哪几家第三方登录
 *   POST hx/register/start                 邮箱 + 手机号 → 发验证码
 *   POST hx/register/finish                验证码 + 用户名、密码、职位、公司名称 → 一次性登录票据
 *   POST hx/register/username              注册第二步里填的用户名能不能用（要有进行中的注册）
 *   POST hx/password/start | finish        找回密码
 *   POST hx/identity/link                  把第三方账号绑到已有的账号上
 *   POST hx/account/delete                 注销自己的账号（密码确认）。网页版带登录 Cookie，桌面端、手机端带登录令牌
 *   GET  hx/signed-in                      有没有登录（登录令牌或 Cookie）：204 或 401。nginx 用它保护 /updates/
 *   GET  hx/oauth/<平台>/start             去这一家的授权页
 *   GET  hx/oauth/<平台>/callback          从这一家回来（Apple 是表单 POST，先转成 GET）
 *
 * 票据交给页面后，页面用原有的 /api/browser/email/verify 换登录状态。第三方登录回来时，结果放在
 * 门户首页地址的 # 后面：# 后面的内容不会发给服务器，也不会进访问日志。
 */

import { hxEarlierName } from "@hxbot/contracts/hx-earlier-names";
import { type DynamicRecord, isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { HX_PROVIDER_IDS, type HxAccountsConfig, type HxProviderId } from "./config";
import { type HxFetch, hxAuthorizeUrl, hxExchange, hxReturnedCode } from "./providers";
import { HxAccountError, type HxAccounts } from "./service";

export interface HxAccountsHttp {
  accounts: HxAccounts;
  config: HxAccountsConfig;
  fetcher: HxFetch;
  now: () => number;
  sourceIp: (request: Request) => string;
  /** The person signed in with the request: the browser's session cookie or the app's bearer token. */
  signedIn: (request: Request) => Promise<HxSignedInUser | null>;
  /** Removes the person's avatar image, after the account is gone. */
  removeAvatar: (user: HxSignedInUser) => Promise<void>;
}

export interface HxSignedInUser {
  id: string;
  email: string;
  avatarUrl: string | null;
}

/** The browser's session cookie, with the name of the builds before the rename; cleared after a deletion. */
const SESSION_COOKIES = ["__Host-hxbot-web", hxEarlierName("__Host-hxbot-web")];

const STATE_COOKIE = "hx_oauth";
const STATE_COOKIE_ATTRIBUTES = "Path=/api/browser/hx/oauth; HttpOnly; Secure; SameSite=Lax";
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

function json(body: unknown, status = 200, more: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, "Content-Type": "application/json; charset=utf-8", ...more },
  });
}

function failure(error: HxAccountError): Response {
  return json(
    { error: { code: error.code, message: error.message } },
    error.status,
    error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {},
  );
}

function redirect(location: string, cookies: string[] = [], status = 303): Response {
  const headers = new Headers({ ...HEADERS, Location: location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status, headers });
}

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function providerId(value: string | undefined): HxProviderId | null {
  return HX_PROVIDER_IDS.find((id) => id === value) ?? null;
}

async function body(request: Request): Promise<DynamicRecord> {
  const text = await request.text();
  if (text.length > 8_192)
    throw new HxAccountError(413, "request_too_large", "请求内容太长。The request is too large.");
  try {
    const parsed = JSON.parse(text);
    if (isDynamicRecord(parsed)) return parsed;
  } catch {
    // Reported below.
  }
  throw new HxAccountError(400, "invalid_request", "请求格式不正确。The request is not valid.");
}

/** A write from a page of this site only: the same checks as the other browser operations. */
function ownPage(request: Request): boolean {
  return (
    request.headers.get("Origin") === new URL(request.url).origin &&
    request.headers.get("X-HXBot-Browser") === "1" &&
    (request.headers.get("Content-Type")?.toLowerCase() ?? "").startsWith("application/json") &&
    request.headers.get("Sec-Fetch-Site") !== "cross-site"
  );
}

async function outside(request: Request, provider: HxProviderId, step: string, http: HxAccountsHttp) {
  const url = new URL(request.url);
  // The redirects back to this site give the path only. The account service runs behind nginx, and the local
  // proxy of wrangler rewrites a `Location` that names this host to `http://`: the browser would then make one
  // request in plain HTTP, which for Apple's form would carry the code.
  const home = (fragment: string) => `/#${fragment}`;
  const clear = `${STATE_COOKIE}=; ${STATE_COOKIE_ATTRIBUTES}; Max-Age=0`;
  const redirectUri = `${url.origin}/api/browser/hx/oauth/${provider}/callback`;

  if (step === "start" && request.method === "GET") {
    const { state, nonce } = await http.accounts.beginOutside(provider, http.sourceIp(request));
    return redirect(
      hxAuthorizeUrl(provider, http.config.providers, { redirectUri, state, nonce }),
      [`${STATE_COOKIE}=${state}; ${STATE_COOKIE_ATTRIBUTES}; Max-Age=600`],
      302,
    );
  }
  if (step !== "callback") return null;

  // Apple posts a form from its own site, and the browser leaves the cookie out of that request. The
  // same values go round once more as a GET, which carries the cookie.
  if (request.method === "POST") {
    const posted = new URLSearchParams(await request.text());
    const again = new URLSearchParams();
    for (const name of ["code", "state", "error"]) {
      const value = posted.get(name);
      if (value) again.set(name, value.slice(0, 2_048));
    }
    return redirect(`${new URL(redirectUri).pathname}?${again.toString()}`);
  }
  if (request.method !== "GET") return null;

  try {
    const state = url.searchParams.get("state") ?? "";
    const code = hxReturnedCode(provider, url.searchParams);
    // The browser that comes back must be the one that left: its cookie holds the same state.
    if (!state || cookie(request, STATE_COOKIE) !== state) {
      throw new HxAccountError(
        410,
        "identity_expired",
        "这次第三方登录已失效，请重新开始。This sign-in expired. Start again.",
      );
    }
    const { nonce } = await http.accounts.endOutside(provider, state);
    if (!code) return redirect(home("hx-error=cancelled"), [clear]);
    const identity = await hxExchange(
      provider,
      http.config.providers,
      code,
      { redirectUri, state, nonce },
      http.fetcher,
      http.now(),
    );
    const result = await http.accounts.outsideSignIn(identity, http.sourceIp(request));
    if ("ticket" in result) {
      return redirect(home(`hx-signin=${result.ticket.challengeId}.${result.ticket.code}`), [clear]);
    }
    const fragment = new URLSearchParams({ "hx-identity": result.identity, provider });
    if (result.displayName) fragment.set("name", result.displayName.slice(0, 64));
    if (result.email) fragment.set("email", result.email);
    return redirect(home(fragment.toString()), [clear]);
  } catch (error) {
    if (!(error instanceof HxAccountError)) throw error;
    return redirect(home(`hx-error=${error.code}`), [clear]);
  }
}

/**
 * Deletes the account of the person signed in with the request. A browser request must come from the
 * portal's own pages (it carries the session cookie); an app sends its token, which no other site can.
 */
async function deleteAccount(request: Request, http: HxAccountsHttp): Promise<Response> {
  const bearer = (request.headers.get("Authorization") ?? "").startsWith("Bearer ");
  if (!bearer && !ownPage(request)) {
    return json({ error: { code: "browser_request_refused", message: "The browser request was refused." } }, 403);
  }
  const user = await http.signedIn(request);
  if (!user) {
    return json({ error: { code: "unauthorized", message: "请先登录。Sign in first." } }, 401);
  }
  const input = await body(request);
  await http.accounts.deleteAccount(
    { userId: user.id, email: user.email, confirm: input.confirm },
    http.sourceIp(request),
  );
  await http.removeAvatar(user).catch(() => undefined);
  const headers = new Headers({ ...HEADERS, "Content-Type": "application/json; charset=utf-8" });
  for (const name of SESSION_COOKIES)
    headers.append("Set-Cookie", `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
  return new Response(JSON.stringify({ deleted: true }), { status: 200, headers });
}

/** Null when the path is not one of this module's. */
export async function handleHxAccounts(request: Request, path: string, http: HxAccountsHttp): Promise<Response | null> {
  try {
    const [first, second, third] = path.split("/");
    if (first === "oauth") {
      const provider = providerId(second);
      return provider ? await outside(request, provider, third ?? "", http) : null;
    }
    if (path === "settings" && request.method === "GET") return json(http.accounts.settings());
    if (path === "signed-in" && request.method === "GET") {
      const user = await http.signedIn(request);
      return user
        ? new Response(null, { status: 204, headers: HEADERS })
        : json({ error: { code: "unauthorized", message: "请先登录。Sign in first." } }, 401);
    }
    if (request.method !== "POST") return null;
    if (path === "account/delete") return await deleteAccount(request, http);
    if (!ownPage(request)) {
      return json({ error: { code: "browser_request_refused", message: "The browser request was refused." } }, 403);
    }
    const ip = http.sourceIp(request);
    if (path === "register/start") {
      const input = await body(request);
      return json(
        await http.accounts.startRegistration(
          {
            email: input.email,
            phone: input.phone,
            sharedPassword: input.sharedPassword,
            identity: input.identity,
            lang: input.lang,
          },
          ip,
        ),
      );
    }
    if (path === "register/username") {
      const input = await body(request);
      return json(
        await http.accounts.usernameAvailable({ registrationId: input.registrationId, username: input.username }, ip),
      );
    }
    if (path === "register/finish") {
      const input = await body(request);
      return json(
        await http.accounts.finishRegistration(
          {
            registrationId: input.registrationId,
            emailCode: input.emailCode,
            phoneCode: input.phoneCode,
            username: input.username,
            password: input.password,
            jobTitle: input.jobTitle,
            company: input.company,
          },
          ip,
        ),
      );
    }
    if (path === "password/start") {
      const input = await body(request);
      return json(await http.accounts.startPasswordReset({ email: input.email, lang: input.lang }, ip));
    }
    if (path === "password/finish") {
      const input = await body(request);
      return json(
        await http.accounts.finishPasswordReset(
          { resetId: input.resetId, emailCode: input.emailCode, password: input.password },
          ip,
        ),
      );
    }
    if (path === "identity/link") {
      const input = await body(request);
      return json(
        await http.accounts.linkIdentity(
          { identity: input.identity, email: input.email, password: input.password },
          ip,
        ),
      );
    }
    return null;
  } catch (error) {
    if (error instanceof HxAccountError) return failure(error);
    console.error("注册登录接口出错：", error instanceof Error ? error.message : String(error));
    return json(
      { error: { code: "account_operation_failed", message: "出错了，请稍后再试。Something went wrong." } },
      500,
    );
  }
}
