/**
 * HXBot：六家第三方登录（网页授权）和阿里云短信。
 *
 * 每一家都是标准的“授权码”流程：把浏览器送到这一家的授权页，用户同意后带着 code 回到
 *   https://<站点>/api/browser/hx/oauth/<平台>/callback
 * 服务器用 code 向这一家换取“这个人在这一家的标识”，只用这个标识认人，不保存这一家的访问令牌。
 *
 *   Google     OpenID Connect：accounts.google.com → oauth2.googleapis.com/token → userinfo
 *   Apple      Sign in with Apple（网页）：授权结果用表单 POST 回来；换令牌时用 .p8 密钥签一个 ES256 的 JWT
 *   微信        开放平台“网站应用”扫码登录：open.weixin.qq.com/connect/qrconnect → sns/oauth2/access_token
 *   支付宝      开放平台网页授权：openauth.alipay.com → alipay.system.oauth.token（RSA2 签名）
 *   Facebook   www.facebook.com/dialog/oauth → graph.facebook.com
 *   抖音        开放平台网站应用：open.douyin.com/platform/oauth/connect → oauth/access_token
 */

import { type DynamicRecord, isDynamicRecord } from "@hxbot/contracts/runtime-values";
import type { HxProviderId, HxProviderSecrets, HxSmsConfig } from "./config";
import { HxAccountError, type HxOutsideIdentity } from "./service";

export type HxFetch = (url: string, init?: RequestInit) => Promise<Response>;

const ENCODER = new TextEncoder();
const TIMEOUT_MS = 10_000;

function failed(provider: string, detail: string): never {
  console.error(`第三方登录失败（${provider}）：${detail.slice(0, 300)}`);
  throw new HxAccountError(
    502,
    "provider_failed",
    "第三方登录没有成功，请重试。The sign-in with that account failed. Try again.",
  );
}

function query(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

function record(value: unknown): DynamicRecord {
  return isDynamicRecord(value) ? value : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : typeof value === "number" ? String(value) : null;
}

async function readJson(provider: string, response: Response): Promise<DynamicRecord> {
  const body = await response.text();
  try {
    return record(JSON.parse(body));
  } catch {
    return failed(provider, `HTTP ${response.status}，返回的不是 JSON：${body}`);
  }
}

async function call(provider: string, fetcher: HxFetch, url: string, init?: RequestInit) {
  try {
    return await readJson(provider, await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }));
  } catch (error) {
    if (error instanceof HxAccountError) throw error;
    return failed(provider, `连接不上 ${new URL(url).host}：${error instanceof Error ? error.message : String(error)}`);
  }
}

function form(values: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8", Accept: "application/json" },
    body: query(values),
  };
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Url(bytes: Uint8Array): string {
  return base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The key bytes of a PEM file, of one line with `\n` written out, or of the bare base64 text. */
export function hxKeyBytes(value: string): Uint8Array<ArrayBuffer> {
  return fromBase64(
    value
      .replaceAll("\\n", "")
      .replace(/-----[A-Z ]+-----/gu, "")
      .replace(/\s/gu, ""),
  );
}

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return [0x80 | bytes.length, ...bytes];
}

/**
 * An RSA private key as PKCS#8. The Alipay key tool also writes PKCS#1 ("非 JAVA 适用"), which the
 * runtime does not import: it is wrapped here. In PKCS#8 a sequence follows the version, in PKCS#1 an integer.
 */
export function hxRsaPkcs8(key: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  let offset = 1;
  const first = key[offset] ?? 0;
  offset += first < 0x80 ? 1 : 1 + (first & 0x7f);
  // The version: INTEGER 0, three bytes.
  if (key[0] !== 0x30 || key[offset] !== 0x02 || key[offset + 3] !== 0x02) return key;
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octets = [0x04, ...derLength(key.length)];
  const body = [0x02, 0x01, 0x00, ...algorithm, ...octets];
  return new Uint8Array([0x30, ...derLength(body.length + key.length), ...body, ...key]);
}

function jwtPayload(provider: string, token: unknown): DynamicRecord {
  const part = typeof token === "string" ? token.split(".")[1] : undefined;
  if (!part) return failed(provider, "没有返回 id_token");
  try {
    return record(JSON.parse(new TextDecoder().decode(fromBase64(part))));
  } catch {
    return failed(provider, "id_token 无法解析");
  }
}

export interface HxOAuthContext {
  redirectUri: string;
  state: string;
  nonce: string;
}

/** The page of the provider where the person signs in. */
export function hxAuthorizeUrl(provider: HxProviderId, secrets: HxProviderSecrets, context: HxOAuthContext): string {
  const { redirectUri, state, nonce } = context;
  if (provider === "google" && secrets.google) {
    return `https://accounts.google.com/o/oauth2/v2/auth?${query({
      client_id: secrets.google.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      prompt: "select_account",
    })}`;
  }
  if (provider === "apple" && secrets.apple) {
    return `https://appleid.apple.com/auth/authorize?${query({
      client_id: secrets.apple.serviceId,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "form_post",
      scope: "name email",
      state,
      nonce,
    })}`;
  }
  if (provider === "wechat" && secrets.wechat) {
    return `https://open.weixin.qq.com/connect/qrconnect?${query({
      appid: secrets.wechat.appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "snsapi_login",
      state,
    })}#wechat_redirect`;
  }
  if (provider === "alipay" && secrets.alipay) {
    return `https://openauth.alipay.com/oauth2/publicAppAuthorize.htm?${query({
      app_id: secrets.alipay.appId,
      scope: "auth_user",
      redirect_uri: redirectUri,
      state,
    })}`;
  }
  if (provider === "facebook" && secrets.facebook) {
    return `https://www.facebook.com/dialog/oauth?${query({
      client_id: secrets.facebook.appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "public_profile,email",
      state,
    })}`;
  }
  if (provider === "douyin" && secrets.douyin) {
    return `https://open.douyin.com/platform/oauth/connect/?${query({
      client_key: secrets.douyin.clientKey,
      response_type: "code",
      scope: "user_info",
      redirect_uri: redirectUri,
      state,
    })}`;
  }
  throw new HxAccountError(404, "provider_off", "这种登录方式没有开启。This sign-in method is not enabled.");
}

/** The authorization code in what the provider sent back. Alipay names it `auth_code`. */
export function hxReturnedCode(provider: HxProviderId, params: URLSearchParams): string | null {
  return params.get(provider === "alipay" ? "auth_code" : "code");
}

/** Beijing time as `2026-11-11 21:30:05`, which the Alipay gateway asks for. */
function beijingTime(now: number): string {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
}

async function appleClientSecret(apple: NonNullable<HxProviderSecrets["apple"]>, now: number): Promise<string> {
  const header = base64Url(ENCODER.encode(JSON.stringify({ alg: "ES256", kid: apple.keyId })));
  const seconds = Math.floor(now / 1_000);
  const claims = base64Url(
    ENCODER.encode(
      JSON.stringify({
        iss: apple.teamId,
        iat: seconds,
        exp: seconds + 300,
        aud: "https://appleid.apple.com",
        sub: apple.serviceId,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    hxKeyBytes(apple.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    ENCODER.encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
}

/** The request to the Alipay gateway, signed: the values sorted by name, joined, and signed with SHA256withRSA. */
export async function hxAlipayRequest(
  alipay: NonNullable<HxProviderSecrets["alipay"]>,
  code: string,
  now: number,
): Promise<Record<string, string>> {
  const values: Record<string, string> = {
    app_id: alipay.appId,
    method: "alipay.system.oauth.token",
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: beijingTime(now),
    version: "1.0",
    grant_type: "authorization_code",
    code,
  };
  const content = Object.keys(values)
    .sort()
    .map((name) => `${name}=${values[name] ?? ""}`)
    .join("&");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    hxRsaPkcs8(hxKeyBytes(alipay.privateKey)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, ENCODER.encode(content));
  return { ...values, sign: base64(new Uint8Array(signature)) };
}

/** Exchanges the code for who signed in. Throws `provider_failed` when the provider refuses. */
export async function hxExchange(
  provider: HxProviderId,
  secrets: HxProviderSecrets,
  code: string,
  context: HxOAuthContext,
  fetcher: HxFetch,
  now: number,
): Promise<HxOutsideIdentity> {
  if (provider === "google" && secrets.google) {
    const token = await call(
      provider,
      fetcher,
      "https://oauth2.googleapis.com/token",
      form({
        code,
        client_id: secrets.google.clientId,
        client_secret: secrets.google.clientSecret,
        redirect_uri: context.redirectUri,
        grant_type: "authorization_code",
      }),
    );
    const accessToken = text(token.access_token) ?? failed(provider, JSON.stringify(token));
    const claims = jwtPayload(provider, token.id_token);
    if (claims.nonce !== context.nonce || claims.aud !== secrets.google.clientId) {
      failed(provider, "id_token 的 nonce 或 aud 不符");
    }
    const user = await call(provider, fetcher, "https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const subject = text(user.sub) ?? failed(provider, JSON.stringify(user));
    if (subject !== claims.sub) failed(provider, "userinfo 与 id_token 不是同一个人");
    return {
      provider,
      subject,
      displayName: text(user.name),
      email: user.email_verified === true ? text(user.email) : null,
    };
  }
  if (provider === "apple" && secrets.apple) {
    const token = await call(
      provider,
      fetcher,
      "https://appleid.apple.com/auth/token",
      form({
        client_id: secrets.apple.serviceId,
        client_secret: await appleClientSecret(secrets.apple, now),
        code,
        grant_type: "authorization_code",
        redirect_uri: context.redirectUri,
      }),
    );
    if (!token.id_token) failed(provider, JSON.stringify(token));
    const claims = jwtPayload(provider, token.id_token);
    const expires = typeof claims.exp === "number" ? claims.exp * 1_000 : 0;
    if (
      claims.iss !== "https://appleid.apple.com" ||
      claims.aud !== secrets.apple.serviceId ||
      claims.nonce !== context.nonce ||
      expires <= now
    ) {
      failed(provider, "id_token 的 iss、aud、nonce 或有效期不符");
    }
    const subject = text(claims.sub) ?? failed(provider, "id_token 里没有 sub");
    const verified = claims.email_verified === true || claims.email_verified === "true";
    return { provider, subject, displayName: null, email: verified ? text(claims.email) : null };
  }
  if (provider === "wechat" && secrets.wechat) {
    const token = await call(
      provider,
      fetcher,
      `https://api.weixin.qq.com/sns/oauth2/access_token?${query({
        appid: secrets.wechat.appId,
        secret: secrets.wechat.appSecret,
        code,
        grant_type: "authorization_code",
      })}`,
    );
    // The union id is the same person across the apps of one WeChat Open Platform account.
    const subject = text(token.unionid) ?? text(token.openid) ?? failed(provider, JSON.stringify(token));
    return { provider, subject, displayName: null, email: null };
  }
  if (provider === "alipay" && secrets.alipay) {
    const answer = await call(
      provider,
      fetcher,
      "https://openapi.alipay.com/gateway.do",
      form(await hxAlipayRequest(secrets.alipay, code, now)),
    );
    const token = record(answer.alipay_system_oauth_token_response);
    // A newer app gets `open_id`, an earlier one `user_id`. Either names the person for this app.
    const subject = text(token.open_id) ?? text(token.user_id) ?? failed(provider, JSON.stringify(answer));
    return { provider, subject, displayName: null, email: null };
  }
  if (provider === "facebook" && secrets.facebook) {
    const token = await call(
      provider,
      fetcher,
      `https://graph.facebook.com/oauth/access_token?${query({
        client_id: secrets.facebook.appId,
        client_secret: secrets.facebook.appSecret,
        redirect_uri: context.redirectUri,
        code,
      })}`,
    );
    const accessToken = text(token.access_token) ?? failed(provider, JSON.stringify(token));
    const user = await call(
      provider,
      fetcher,
      `https://graph.facebook.com/me?${query({ fields: "id,name,email", access_token: accessToken })}`,
    );
    const subject = text(user.id) ?? failed(provider, JSON.stringify(user));
    return { provider, subject, displayName: text(user.name), email: null };
  }
  if (provider === "douyin" && secrets.douyin) {
    const answer = await call(
      provider,
      fetcher,
      "https://open.douyin.com/oauth/access_token/",
      form({
        client_key: secrets.douyin.clientKey,
        client_secret: secrets.douyin.clientSecret,
        code,
        grant_type: "authorization_code",
      }),
    );
    const data = record(answer.data);
    const subject = text(data.open_id) ?? failed(provider, JSON.stringify(answer));
    return { provider, subject, displayName: null, email: null };
  }
  throw new HxAccountError(404, "provider_off", "这种登录方式没有开启。This sign-in method is not enabled.");
}

// ---------------------------------------------------------------- 阿里云短信

/** RFC 3986 percent-encoding, as the Alibaba Cloud signature asks for. */
function aliyunEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The signed form of a SendSms call (API version 2017-05-25, signature version 1.0). */
export async function hxAliyunSmsRequest(
  sms: HxSmsConfig,
  phone: string,
  code: string,
  now: number,
  nonce: string,
): Promise<Record<string, string>> {
  const values: Record<string, string> = {
    AccessKeyId: sms.accessKeyId,
    Action: "SendSms",
    Format: "JSON",
    // A mainland number goes without the country code.
    PhoneNumbers: phone.replace(/^\+86/u, ""),
    RegionId: "cn-hangzhou",
    SignName: sms.signName,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: nonce,
    SignatureVersion: "1.0",
    TemplateCode: sms.templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: `${new Date(now).toISOString().slice(0, 19)}Z`,
    Version: "2017-05-25",
  };
  const canonical = Object.keys(values)
    .sort()
    .map((name) => `${aliyunEncode(name)}=${aliyunEncode(values[name] ?? "")}`)
    .join("&");
  const key = await crypto.subtle.importKey(
    "raw",
    ENCODER.encode(`${sms.accessKeySecret}&`),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, ENCODER.encode(`POST&%2F&${aliyunEncode(canonical)}`));
  return { ...values, Signature: base64(new Uint8Array(signature)) };
}

export async function hxSendSmsCode(
  sms: HxSmsConfig,
  phone: string,
  code: string,
  fetcher: HxFetch,
  now: number,
): Promise<void> {
  const request = await hxAliyunSmsRequest(sms, phone, code, now, crypto.randomUUID());
  let answer: DynamicRecord;
  try {
    const response = await fetcher("https://dysmsapi.aliyuncs.com/", {
      ...form(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    answer = record(JSON.parse(await response.text()));
  } catch (error) {
    console.error("短信发送失败：", error instanceof Error ? error.message : String(error));
    throw new HxAccountError(
      502,
      "sms_failed",
      "短信没有发出去，请稍后再试。The SMS could not be sent. Try again later.",
    );
  }
  if (answer.Code === "OK") return;
  console.error(`短信发送失败：${text(answer.Code) ?? ""} ${text(answer.Message) ?? ""}`);
  if (answer.Code === "isv.BUSINESS_LIMIT_CONTROL") {
    throw new HxAccountError(
      429,
      "sms_limited",
      "这个号码获取验证码太频繁，请稍后再试。Too many codes for this number. Try again later.",
    );
  }
  if (answer.Code === "isv.MOBILE_NUMBER_ILLEGAL") {
    throw new HxAccountError(400, "invalid_phone", "请输入有效的手机号码。Enter a valid mobile number.");
  }
  throw new HxAccountError(
    502,
    "sms_failed",
    "短信没有发出去，请稍后再试。The SMS could not be sent. Try again later.",
  );
}
