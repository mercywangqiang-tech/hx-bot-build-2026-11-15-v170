/**
 * HXBot：把注册账号模块接到账号服务上（读运行变量、数据库、发信设置）。
 * 其余几个文件不碰运行环境，测试时可以单独使用。
 */

import { env } from "cloudflare:workers";
import { hxEarlierName } from "@hxbot/contracts/hx-earlier-names";
import { Effect } from "effect";
import type { AccountAnalytics } from "../account-analytics";
import { AuthOperationError } from "../auth-service";
import { avatarObjectKey } from "../avatar-storage";
import { hxEmailAllowed } from "../hx-access";
import type { HxAccountSignIn } from "../hx-login";
import { requestSourceIp } from "../source-ip";
import { requireWorkerBindings, type WorkerBindings } from "../types";
import { type HxAccountsConfig, hxAccountsConfig } from "./config";
import { type HxSignedInUser, handleHxAccounts } from "./http";
import { hxMailbox, hxSendCodeEmail } from "./mail";
import { hxSendSmsCode } from "./providers";
import { HxAccountError, HxAccounts } from "./service";
import { HxAccountStore, type HxDatabase, type HxStatement } from "./store";

const PREFIX = "/api/browser/hx/";

function variables(bindings: WorkerBindings): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(bindings)) {
    if (typeof value === "string") result[name] = value;
  }
  return result;
}

function database(d1: D1Database): HxDatabase {
  const wrap = (statement: D1PreparedStatement): HxStatement => ({
    bind: (...values) => wrap(statement.bind(...values)),
    first: <Row>() => statement.first<Row>(),
    all: async <Row>() => ({ results: (await statement.all<Row>()).results }),
    run: async () => ({ meta: { changes: (await statement.run()).meta.changes } }),
  });
  return { prepare: (sql) => wrap(d1.prepare(sql)) };
}

function build(bindings: WorkerBindings): { accounts: HxAccounts; config: HxAccountsConfig } {
  const values = variables(bindings);
  const config = hxAccountsConfig(values);
  const mailbox = hxMailbox(values);
  const sms = config.sms;
  const accounts = new HxAccounts({
    store: new HxAccountStore(database(bindings.DB)),
    config,
    now: Date.now,
    sendEmailCode: mailbox
      ? async (email, code, expiresAt, purpose, lang) => {
          const now = Date.now();
          const minutes = Math.max(1, Math.ceil((expiresAt - now) / 60_000));
          try {
            await hxSendCodeEmail(mailbox, email, code, purpose, minutes, lang, now);
          } catch (error) {
            // The reason goes to the log of the account service (docker compose logs account). Never the code.
            console.error("验证码邮件发送失败：", error instanceof Error ? error.message : String(error));
            throw new HxAccountError(
              502,
              "email_failed",
              "验证码邮件没有发出去，请稍后再试。The email with the code could not be sent. Try again later.",
            );
          }
        }
      : null,
    sendSmsCode: sms ? (phone, code) => hxSendSmsCode(sms, phone, code, fetch, Date.now()) : null,
    emailAllowed: hxEmailAllowed({
      ...(values.HX_ALLOWED_EMAILS === undefined ? {} : { emails: values.HX_ALLOWED_EMAILS }),
      ...(values.HX_ALLOWED_EMAIL_DOMAINS === undefined ? {} : { domains: values.HX_ALLOWED_EMAIL_DOMAINS }),
    }),
  });
  return { accounts, config };
}

/** The second sign-in step of `auth-service.ts` checks the password of the account, or a ticket of this module. */
export function hxAccountSignIn(bindings: WorkerBindings, _analytics: AccountAnalytics): HxAccountSignIn {
  const { accounts } = build(bindings);
  const failed = () => new AuthOperationError({ message: "Account operation failed." });
  return {
    startHash: (email) => Effect.tryPromise({ try: () => accounts.startHash(email), catch: failed }),
    verifyHash: (challengeIdHash, typed) =>
      Effect.tryPromise({ try: () => accounts.verifyHash(challengeIdHash, typed), catch: failed }),
  };
}

/** The browser's session cookie (also under the name of the builds before the rename). */
function sessionCookie(request: Request): string | null {
  for (const name of ["__Host-hxbot-web", hxEarlierName("__Host-hxbot-web")]) {
    for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
      const [key, ...rest] = part.trim().split("=");
      const value = rest.join("=");
      if (key === name && /^[A-Za-z0-9_-]{20,512}$/u.test(value)) return value;
    }
  }
  return null;
}

/** The app's bearer token, as request-auth.ts reads it. */
function bearer(request: Request): string | null {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  return token && token.length <= 512 ? token : null;
}

/** Finds the person of a session token; request-auth.ts passes the account service's own check. */
export type HxAuthenticate = (token: string) => Promise<HxSignedInUser | null>;

/** The avatar image of a deleted account (users/<id>/<version>, the version is the `v` of its address). */
async function removeAvatar(bucket: R2Bucket, user: HxSignedInUser): Promise<void> {
  if (!user.avatarUrl) return;
  const version = new URL(user.avatarUrl, "https://avatar.invalid").searchParams.get("v") ?? "";
  try {
    await bucket.delete(avatarObjectKey(user.id, version));
  } catch {
    // An address that is not one of the stored images names nothing to delete.
  }
}

/** Answers a request under /api/browser/hx/. Null for every other path. */
export async function requestHxAccounts(
  request: Request,
  _analytics: AccountAnalytics,
  authenticate: HxAuthenticate,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(PREFIX)) return null;
  const bindings = requireWorkerBindings(env);
  const { accounts, config } = build(bindings);
  const answer = await handleHxAccounts(request, path.slice(PREFIX.length).replace(/\/$/u, ""), {
    accounts,
    config,
    fetcher: (url, init) => fetch(url, init),
    now: Date.now,
    sourceIp: requestSourceIp,
    signedIn: async (asked) => {
      const token = bearer(asked) ?? sessionCookie(asked);
      const user = token ? await authenticate(token) : null;
      return user ? { id: user.id, email: user.email, avatarUrl: user.avatarUrl } : null;
    },
    removeAvatar: (user) => removeAvatar(bindings.AVATARS, user),
  });
  return (
    answer ??
    new Response(JSON.stringify({ error: { code: "not_found", message: "Not found." } }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    })
  );
}
