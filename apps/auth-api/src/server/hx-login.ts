/**
 * HXBot 研究版的“邮箱 + 密码”登录。
 *
 * 登录的第一步照常输入邮箱（仍受 hx-access.ts 的名单限制），第二步输入密码代替邮件里的验证码。
 * 现在核对的是每个人注册时设置的自己的密码（见下面的 HxAccountSignIn 和 hx-accounts 目录）。密码的核对结果
 * 只以哈希形式存进登录挑战记录，和验证码一样每次挑战最多试 5 次，并受按邮箱、按 IP 的频率限制。
 *
 * 更早的版本是全体共用一个登录口令（`HX_LOGIN_PASSWORD`）。它不再能登录，下面两个函数只为过渡保留：
 * 关闭了邮箱验证的服务器上，以前用它登录过的邮箱第一次设置自己的密码时，用它证明身份。
 */
import type { Effect } from "effect";
import type { AuthOperationError } from "./auth-service";
import { sha256 } from "./crypto";

/**
 * 注册账号（hx-accounts）接管第二步的核对：核对的是这个邮箱自己的密码，或本服务在注册、找回密码、
 * 第三方登录走完后发的一次性票据。设置了它，上面说的共用口令不再用于登录。
 */
export interface HxAccountSignIn {
  /** The stored form that the right password of this email gives. */
  startHash(email: string): Effect.Effect<string, AuthOperationError>;
  /** The same form for what the person typed at this challenge. */
  verifyHash(challengeIdHash: string, typed: string): Effect.Effect<string, AuthOperationError>;
}

/** The shared sign-in password, or null when sign-in sends email codes. */
export function hxLoginPassword(value: string | undefined): string | null {
  const password = value?.trim();
  return password ? password : null;
}

/** The stored form of the password, compared the way the hash of an emailed code is. */
export function hxLoginPasswordHash(value: string) {
  return sha256(`hx-login-password:${value.trim()}`);
}

/** Messages of a failed password step. The clients show them as they are. */
export const HX_PASSWORD_MESSAGES = {
  tooManyAttempts:
    "密码输错次数太多，请返回重新输入邮箱。Too many incorrect passwords. Go back and enter your email again.",
  expired: "停留时间过长，请返回重新输入邮箱。This sign-in step expired. Go back and enter your email again.",
  incorrect: "邮箱或密码不正确。The email or the password is incorrect.",
} as const;
