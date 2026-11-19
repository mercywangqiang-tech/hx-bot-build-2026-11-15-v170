/**
 * HXBot：注册、密码和第三方账号登录。
 *
 * 登录仍是原来的两步接口（先邮箱，再“验证码”一栏），所以网页版、桌面端、手机端的登录不用改接口：
 * 第二步核对的是这个邮箱自己的密码（`startHash` / `verifyHash`），不再是大家共用的口令。
 * 注册、找回密码、第三方登录走完后，本服务发一张“一次性票据”，页面或应用拿它走同一个第二步换登录状态，
 * 登录状态仍由上游代码创建。
 *
 * 注册两步：
 *   1. startRegistration  邮箱 + 手机号 → 发邮箱验证码、短信验证码（各自可在 .env 里关闭）
 *   2. finishRegistration 验证码 + 用户名、密码、职位、公司名称 → 建账号，返回票据
 * 以前用共用口令登录过的邮箱（老账号）也走注册：它第一次设置自己的密码。能发邮箱验证码时凭验证码，
 * 不能时凭原来的共用口令证明身份。
 */

import { type DynamicRecord, isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { normalizeEmailAddress } from "@hxbot/contracts/validation";
import type { HxAccountsConfig, HxCodePurpose, HxMailLanguage, HxProviderId } from "./config";
import { hxEnabledProviders, hxMailLanguage } from "./config";
import {
  hxDerivePassword,
  hxNewPassword,
  hxPasswordProblem,
  hxRandomCode,
  hxRandomHex,
  hxRandomToken,
  hxSameText,
  hxSha256,
} from "./secrets";
import type { HxAccountStore } from "./store";

export class HxAccountError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "HxAccountError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** What a provider told about the person who signed in there. */
export interface HxOutsideIdentity {
  provider: HxProviderId;
  subject: string;
  displayName: string | null;
  email: string | null;
}

export interface HxTicket {
  challengeId: string;
  code: string;
}

export interface HxAccountsDependencies {
  store: HxAccountStore;
  config: HxAccountsConfig;
  now: () => number;
  /** Null when the server has no mail settings. */
  sendEmailCode:
    | ((email: string, code: string, expiresAt: number, purpose: HxCodePurpose, lang: HxMailLanguage) => Promise<void>)
    | null;
  /** Null when the server has no SMS settings. */
  sendSmsCode: ((phone: string, code: string) => Promise<void>) | null;
  /** The research access list of `hx-access.ts`. */
  emailAllowed: (email: string) => boolean;
}

const PENDING_TTL_MS = 10 * 60_000;
const IDENTITY_TTL_MS = 30 * 60_000;
const TICKET_TTL_MS = 5 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const RATE_WINDOW_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
const MAX_CODE_ATTEMPTS = 5;

const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{1,31}$/u;
const MAINLAND_MOBILE_PATTERN = /^\+861[3-9][0-9]{9}$/u;
const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the check is for control characters
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

function refuse(status: number, code: string, message: string, retryAfterSeconds?: number): never {
  throw new HxAccountError(status, code, message, retryAfterSeconds);
}

function hxNormalizeEmail(value: unknown): string {
  const email = typeof value === "string" ? normalizeEmailAddress(value) : null;
  return email ?? refuse(400, "invalid_email", "请输入有效的邮箱地址。Enter a valid email address.");
}

/** `13800138000`, `138 0013 8000` and `+86 138-0013-8000` are one number: `+8613800138000`. */
function hxNormalizePhone(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/[\s()-]/gu, "") : "";
  const phone = /^1[3-9][0-9]{9}$/u.test(text) ? `+86${text}` : text.replace(/^00/u, "+");
  if (!PHONE_PATTERN.test(phone) || (phone.startsWith("+86") && !MAINLAND_MOBILE_PATTERN.test(phone))) {
    return refuse(400, "invalid_phone", "请输入有效的手机号码。Enter a valid mobile number.");
  }
  return phone;
}

function profileText(value: unknown, code: string, message: string): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  if (text.length < 1 || text.length > 64 || CONTROL_PATTERN.test(text)) return refuse(400, code, message);
  return text;
}

function passwordText(value: unknown): string {
  const password = typeof value === "string" ? value.trim() : "";
  const problem = hxPasswordProblem(password);
  if (problem) {
    return refuse(
      400,
      "invalid_password",
      "密码要 8～32 个字符，同时包含字母、数字和符号。Use 8 to 32 characters with at least one letter, one digit and one symbol.",
    );
  }
  return password;
}

interface RegisterData {
  identity: string | null;
}

interface IdentityData {
  provider: HxProviderId;
  subject: string;
  displayName: string | null;
}

function parseData(text: string): DynamicRecord {
  try {
    const parsed = JSON.parse(text);
    return isDynamicRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export class HxAccounts {
  readonly #deps: HxAccountsDependencies;

  constructor(dependencies: HxAccountsDependencies) {
    this.#deps = dependencies;
  }

  /** What the sign-in pages show. Nothing here is secret. */
  settings(): {
    emailCode: boolean;
    phoneCode: boolean;
    sharedPassword: boolean;
    providers: HxProviderId[];
    ready: { email: boolean; sms: boolean };
  } {
    const { config, sendEmailCode, sendSmsCode } = this.#deps;
    return {
      emailCode: config.emailVerification,
      phoneCode: config.phoneVerification,
      sharedPassword: config.sharedPassword !== null && !config.emailVerification,
      providers: hxEnabledProviders(config),
      ready: {
        email: !config.emailVerification || sendEmailCode !== null,
        sms: !config.phoneVerification || sendSmsCode !== null,
      },
    };
  }

  // ---------------------------------------------------------------- 登录（原有两步接口里的核对）

  /** The stored form that the right password of this email gives; a value nothing matches when there is none. */
  async startHash(email: string): Promise<string> {
    const account = await this.#deps.store.account(email);
    if (!account || account.disabled_at !== null || !account.password_hash) {
      return hxSha256(`hx-no-password:${hxRandomHex(16)}`);
    }
    return hxSha256(`hx-account-password:${account.password_hash}`);
  }

  /** The same form for what the person typed at this challenge: a password, or a ticket of this service. */
  async verifyHash(challengeIdHash: string, typed: string): Promise<string> {
    const { store } = this.#deps;
    if (await store.isTicketChallenge(challengeIdHash)) return hxSha256(`hx-ticket:${typed}`);
    const email = await store.challengeEmail(challengeIdHash);
    const account = email ? await store.account(email) : null;
    if (!account || account.disabled_at !== null || !account.password_hash || !account.password_salt) {
      return hxSha256(`hx-no-password:${hxRandomHex(16)}`);
    }
    const derived = await hxDerivePassword(typed.trim(), account.password_salt, account.password_iterations ?? 1);
    return hxSha256(`hx-account-password:${derived}`);
  }

  // ---------------------------------------------------------------- 注册

  async startRegistration(
    input: { email: unknown; phone: unknown; sharedPassword?: unknown; identity?: unknown; lang?: unknown },
    sourceIp: string,
  ): Promise<{ registrationId: string; emailCode: boolean; phoneCode: boolean; expiresAt: number }> {
    const { store, config, sendEmailCode, sendSmsCode } = this.#deps;
    const now = this.#deps.now();
    const email = hxNormalizeEmail(input.email);
    const phone = hxNormalizePhone(input.phone);
    if (!this.#deps.emailAllowed(email)) {
      refuse(403, "email_not_allowed", "该邮箱不在研究版名单中。This email is not on the research access list.");
    }
    // v1.7.3: an office registers from one address on its first day; each email and number keeps its limit.
    await this.#limit(`hx:register:ip:${sourceIp}`, 60, now);
    await this.#limit(`hx:register:email:${email}`, 6, now);
    if (await store.account(email)) {
      refuse(
        409,
        "email_registered",
        "这个邮箱已经注册，请直接登录。This email is already registered. Sign in instead.",
      );
    }
    // One account per mobile number, as per email and per username.
    if (await store.phoneTaken(phone)) {
      refuse(
        409,
        "phone_registered",
        "这个手机号已经注册了账号，请用那个账号登录。This mobile number is already registered. Sign in with that account.",
      );
    }
    if (config.emailVerification && !sendEmailCode) {
      refuse(
        503,
        "email_not_configured",
        "服务器还没有配置发信邮箱，暂时不能注册。Email is not set up on the server yet.",
      );
    }
    if (config.phoneVerification && !sendSmsCode) {
      refuse(503, "sms_not_configured", "服务器还没有配置短信服务，暂时不能注册。SMS is not set up on the server yet.");
    }
    if (config.phoneVerification && !MAINLAND_MOBILE_PATTERN.test(phone)) {
      refuse(
        400,
        "phone_not_supported",
        "目前只能验证中国大陆的手机号码。Only mainland China mobile numbers can be verified.",
      );
    }
    // An earlier user sets their own password here. Without an emailed code, the shared password proves who they are.
    if (!config.emailVerification && (await store.earlierUser(email))) {
      if (config.sharedPassword === null) {
        refuse(
          403,
          "contact_admin",
          "请联系管理员为这个邮箱设置密码。Ask the administrator to set a password for this email.",
        );
      }
      const typed = typeof input.sharedPassword === "string" ? input.sharedPassword.trim() : "";
      if (!typed || !hxSameText(typed, config.sharedPassword)) {
        refuse(
          401,
          "shared_password_required",
          "这个邮箱以前登录过，请填写原来的登录口令。This email signed in before. Enter the earlier sign-in password.",
        );
      }
    }
    const identity = typeof input.identity === "string" && input.identity ? input.identity : null;
    if (identity) await this.#identity(identity);

    await this.#cooldown(await store.latestPendingAt("register", email), now);
    if (config.phoneVerification) {
      await this.#cooldown(await store.latestPhonePendingAt(phone), now);
      await this.#limit(`hx:sms:phone:${phone}:${Math.floor(now / DAY_MS)}`, 10, now, DAY_MS);
    }

    const registrationId = hxRandomToken(32);
    const emailCode = config.emailVerification ? hxRandomCode() : null;
    const phoneCode = config.phoneVerification ? hxRandomCode() : null;
    const expiresAt = now + PENDING_TTL_MS;
    const data: RegisterData = { identity };
    await store.createPending(
      await hxSha256(registrationId),
      {
        kind: "register",
        email,
        phone,
        emailCodeHash: emailCode ? await hxSha256(`hx-code:${registrationId}:email:${emailCode}`) : null,
        phoneCodeHash: phoneCode ? await hxSha256(`hx-code:${registrationId}:phone:${phoneCode}`) : null,
        data: JSON.stringify(data),
      },
      now,
      expiresAt,
    );
    if (emailCode && sendEmailCode)
      await sendEmailCode(email, emailCode, expiresAt, "register", hxMailLanguage(input.lang));
    if (phoneCode && sendSmsCode) await sendSmsCode(phone, phoneCode);
    await store.removeExpired(now);
    return { registrationId, emailCode: emailCode !== null, phoneCode: phoneCode !== null, expiresAt };
  }

  async finishRegistration(
    input: {
      registrationId: unknown;
      emailCode?: unknown;
      phoneCode?: unknown;
      username: unknown;
      password: unknown;
      jobTitle: unknown;
      company: unknown;
    },
    sourceIp: string,
  ): Promise<HxTicket> {
    const { store } = this.#deps;
    const now = this.#deps.now();
    await this.#limit(`hx:finish:ip:${sourceIp}`, 60, now);
    const registrationId = typeof input.registrationId === "string" ? input.registrationId : "";
    const idHash = await hxSha256(registrationId);
    const pending = await this.#pending(idHash, "register", now);
    const email = pending.email ?? "";
    const phone = pending.phone ?? "";

    const username = typeof input.username === "string" ? input.username.trim() : "";
    if (!USERNAME_PATTERN.test(username)) {
      refuse(
        400,
        "invalid_username",
        "用户名要 2～32 个字符，可以用中文、字母、数字和 _ . -。Use 2 to 32 letters, digits, or _ . - for the username.",
      );
    }
    const password = passwordText(input.password);
    const jobTitle = profileText(
      input.jobTitle,
      "invalid_job_title",
      "请填写职位（不超过 64 个字符）。Enter your job title.",
    );
    const company = profileText(
      input.company,
      "invalid_company",
      "请填写公司名称（不超过 64 个字符）。Enter your company name.",
    );

    await this.#checkCode(idHash, registrationId, "email", pending.email_code_hash, input.emailCode);
    await this.#checkCode(idHash, registrationId, "phone", pending.phone_code_hash, input.phoneCode);

    if (await store.usernameTaken(username)) {
      refuse(409, "username_taken", "这个用户名已经有人用了，请换一个。This username is taken.");
    }
    if (await store.phoneTaken(phone)) {
      refuse(
        409,
        "phone_registered",
        "这个手机号已经注册了账号，请用那个账号登录。This mobile number is already registered. Sign in with that account.",
      );
    }
    const identityTicket = parseData(pending.data).identity;
    const identity = typeof identityTicket === "string" ? await this.#identity(identityTicket) : null;

    if (!(await store.takePending(idHash))) {
      refuse(410, "registration_expired", "注册已失效，请重新开始。This registration expired. Start again.");
    }
    const created = await store.createAccount(
      {
        email,
        username,
        phone,
        phoneVerified: pending.phone_code_hash !== null,
        jobTitle,
        company,
        emailVerified: pending.email_code_hash !== null,
        password: await hxNewPassword(password),
      },
      now,
    );
    if (created === "email") {
      refuse(
        409,
        "email_registered",
        "这个邮箱已经注册，请直接登录。This email is already registered. Sign in instead.",
      );
    }
    if (created === "username") {
      refuse(409, "username_taken", "这个用户名已经有人用了，请换一个。This username is taken.");
    }
    if (created === "phone") {
      refuse(
        409,
        "phone_registered",
        "这个手机号已经注册了账号，请用那个账号登录。This mobile number is already registered. Sign in with that account.",
      );
    }
    await store.ensureUser(email, username, now);
    if (identity && typeof identityTicket === "string") {
      await store.takePending(await hxSha256(identityTicket));
      await store.linkIdentity(identity.provider, identity.subject, email, identity.displayName, now);
    }
    return this.#ticket(email, sourceIp, now);
  }

  /**
   * Whether a username is free, asked while the second step of the registration form is open. It needs that
   * registration, so it answers only someone who has started one, and only so often.
   */
  async usernameAvailable(
    input: { registrationId: unknown; username: unknown },
    sourceIp: string,
  ): Promise<{ available: boolean }> {
    const now = this.#deps.now();
    await this.#limit(`hx:username:ip:${sourceIp}`, 120, now);
    const registrationId = typeof input.registrationId === "string" ? input.registrationId : "";
    await this.#pending(await hxSha256(registrationId), "register", now);
    const username = typeof input.username === "string" ? input.username.trim() : "";
    if (!USERNAME_PATTERN.test(username)) {
      refuse(
        400,
        "invalid_username",
        "用户名要 2～32 个字符，可以用中文、字母、数字和 _ . -。Use 2 to 32 letters, digits, or _ . - for the username.",
      );
    }
    return { available: !(await this.#deps.store.usernameTaken(username)) };
  }

  // ---------------------------------------------------------------- 注销账号

  /**
   * Deletes the account of the person who is signed in (the HTTP layer found them by their session). They
   * confirm with their password; an account without one, which signs in with another service, confirms
   * with its email. Everything goes at once, as with scripts/delete-account.sh; the backups that the
   * administrator keeps expire within 30 days (privacy policy).
   */
  async deleteAccount(input: { userId: string; email: string; confirm: unknown }, sourceIp: string): Promise<void> {
    const { store } = this.#deps;
    const now = this.#deps.now();
    const email = input.email.trim().toLowerCase();
    await this.#limit(`hx:delete:ip:${sourceIp}`, 20, now);
    await this.#limit(`hx:delete:email:${email}`, 6, now);
    const typed = typeof input.confirm === "string" ? input.confirm.trim() : "";
    const account = await store.account(email);
    if (account?.password_hash && account.password_salt) {
      const right =
        typed.length > 0 &&
        typed.length <= 32 &&
        hxSameText(
          await hxDerivePassword(typed, account.password_salt, account.password_iterations ?? 1),
          account.password_hash,
        );
      if (!right) refuse(401, "incorrect_password", "密码不正确。The password is incorrect.");
    } else if (typed.toLowerCase() !== email) {
      refuse(401, "confirm_with_email", "请输入这个账号的邮箱确认。Enter the email of this account to confirm.");
    }
    if (!(await store.deletePerson(email, input.userId))) {
      refuse(500, "delete_failed", "没能注销账号，请稍后再试。The account could not be deleted. Try again later.");
    }
  }

  // ---------------------------------------------------------------- 找回密码

  async startPasswordReset(
    input: { email: unknown; lang?: unknown },
    sourceIp: string,
  ): Promise<{ resetId: string; expiresAt: number }> {
    const { store, config, sendEmailCode } = this.#deps;
    const now = this.#deps.now();
    const email = hxNormalizeEmail(input.email);
    await this.#limit(`hx:reset:ip:${sourceIp}`, 20, now);
    await this.#limit(`hx:reset:email:${email}`, 6, now);
    if (!config.emailVerification || !sendEmailCode) {
      refuse(
        403,
        "reset_unavailable",
        "服务器没有开启邮箱验证，请联系管理员重置密码。Ask the administrator to reset the password.",
      );
    }
    const account = await store.account(email);
    if (!account) {
      refuse(404, "account_not_found", "这个邮箱还没有注册。This email is not registered.");
    }
    if (account.disabled_at !== null) {
      refuse(403, "account_disabled", "这个账号已停用，请联系管理员。This account is disabled.");
    }
    await this.#cooldown(await store.latestPendingAt("reset", email), now);
    const resetId = hxRandomToken(32);
    const code = hxRandomCode();
    const expiresAt = now + PENDING_TTL_MS;
    await store.createPending(
      await hxSha256(resetId),
      {
        kind: "reset",
        email,
        phone: null,
        emailCodeHash: await hxSha256(`hx-code:${resetId}:email:${code}`),
        phoneCodeHash: null,
        data: "{}",
      },
      now,
      expiresAt,
    );
    await sendEmailCode(email, code, expiresAt, "reset", hxMailLanguage(input.lang));
    await store.removeExpired(now);
    return { resetId, expiresAt };
  }

  async finishPasswordReset(
    input: { resetId: unknown; emailCode: unknown; password: unknown },
    sourceIp: string,
  ): Promise<HxTicket> {
    const { store } = this.#deps;
    const now = this.#deps.now();
    await this.#limit(`hx:finish:ip:${sourceIp}`, 60, now);
    const resetId = typeof input.resetId === "string" ? input.resetId : "";
    const idHash = await hxSha256(resetId);
    const pending = await this.#pending(idHash, "reset", now);
    const password = passwordText(input.password);
    await this.#checkCode(idHash, resetId, "email", pending.email_code_hash, input.emailCode);
    const email = pending.email ?? "";
    if (!(await store.takePending(idHash)) || !(await store.setPassword(email, await hxNewPassword(password), now))) {
      refuse(410, "reset_expired", "这次找回密码已失效，请重新开始。This reset expired. Start again.");
    }
    // Whoever knew the old password is signed out wherever they signed in with it.
    await store.signOutEverywhere(email, now);
    await store.markEmailVerified(email, now);
    return this.#ticket(email, sourceIp, now);
  }

  // ---------------------------------------------------------------- 第三方账号

  /** Before the browser leaves for the provider: the `state` that must come back, and the `nonce`. */
  async beginOutside(provider: HxProviderId, sourceIp: string): Promise<{ state: string; nonce: string }> {
    const now = this.#deps.now();
    if (!hxEnabledProviders(this.#deps.config).includes(provider)) {
      refuse(404, "provider_off", "这种登录方式没有开启。This sign-in method is not enabled.");
    }
    await this.#limit(`hx:outside:ip:${sourceIp}`, 30, now);
    const state = hxRandomToken(32);
    const nonce = hxRandomToken(16);
    await this.#deps.store.createPending(
      await hxSha256(state),
      {
        kind: "outside",
        email: null,
        phone: null,
        emailCodeHash: null,
        phoneCodeHash: null,
        data: JSON.stringify({ provider, nonce }),
      },
      now,
      now + PENDING_TTL_MS,
    );
    return { state, nonce };
  }

  /** When the browser is back: the `nonce` of that `state`. A `state` works once, for the provider it left for. */
  async endOutside(provider: HxProviderId, state: string): Promise<{ nonce: string }> {
    const idHash = await hxSha256(state);
    const pending = await this.#deps.store.pending(idHash);
    const data = pending && pending.kind === "outside" ? parseData(pending.data) : null;
    if (
      !pending ||
      !data ||
      pending.expires_at <= this.#deps.now() ||
      data.provider !== provider ||
      typeof data.nonce !== "string" ||
      !(await this.#deps.store.takePending(idHash))
    ) {
      return refuse(410, "identity_expired", "这次第三方登录已失效，请重新开始。This sign-in expired. Start again.");
    }
    return { nonce: data.nonce };
  }

  /**
   * After the provider said who signed in. An outside account that an HXBot account already uses
   * signs that account in. A new one is kept for thirty minutes, for the registration or the link.
   */
  async outsideSignIn(
    identity: HxOutsideIdentity,
    sourceIp: string,
  ): Promise<{ ticket: HxTicket } | { identity: string; displayName: string | null; email: string | null }> {
    const { store } = this.#deps;
    const now = this.#deps.now();
    const linked = await store.identityEmail(identity.provider, identity.subject);
    if (linked) {
      const account = await store.account(linked);
      if (!account || account.disabled_at !== null) {
        refuse(403, "account_disabled", "这个账号已停用，请联系管理员。This account is disabled.");
      }
      return { ticket: await this.#ticket(linked, sourceIp, now) };
    }
    const ticket = hxRandomToken(32);
    const data: IdentityData = {
      provider: identity.provider,
      subject: identity.subject,
      displayName: identity.displayName,
    };
    await store.createPending(
      await hxSha256(ticket),
      {
        kind: "identity",
        email: null,
        phone: null,
        emailCodeHash: null,
        phoneCodeHash: null,
        data: JSON.stringify(data),
      },
      now,
      now + IDENTITY_TTL_MS,
    );
    return { identity: ticket, displayName: identity.displayName, email: identity.email };
  }

  /** Links the outside account to an HXBot account whose password the person knows, and signs in. */
  async linkIdentity(
    input: { identity: unknown; email: unknown; password: unknown },
    sourceIp: string,
  ): Promise<HxTicket> {
    const { store } = this.#deps;
    const now = this.#deps.now();
    const email = hxNormalizeEmail(input.email);
    await this.#limit(`hx:link:ip:${sourceIp}`, 20, now);
    await this.#limit(`hx:link:email:${email}`, 6, now);
    const ticket = typeof input.identity === "string" ? input.identity : "";
    const identity = await this.#identity(ticket);
    const account = await store.account(email);
    const typed = typeof input.password === "string" ? input.password.trim() : "";
    const right =
      account?.password_hash && account.password_salt && account.disabled_at === null && typed.length <= 32
        ? hxSameText(
            await hxDerivePassword(typed, account.password_salt, account.password_iterations ?? 1),
            account.password_hash,
          )
        : false;
    if (!right) {
      refuse(401, "incorrect_password", "邮箱或密码不正确。The email or the password is incorrect.");
    }
    if (!(await store.takePending(await hxSha256(ticket)))) {
      refuse(410, "identity_expired", "这次第三方登录已失效，请重新开始。This sign-in expired. Start again.");
    }
    if (!(await store.linkIdentity(identity.provider, identity.subject, email, identity.displayName, now))) {
      refuse(
        409,
        "identity_in_use",
        "这个第三方账号已经绑定了别的账号。This account is linked to another HXBot account.",
      );
    }
    return this.#ticket(email, sourceIp, now);
  }

  // ---------------------------------------------------------------- 内部

  async #identity(ticket: string): Promise<IdentityData> {
    const pending = await this.#deps.store.pending(await hxSha256(ticket));
    const data = pending && pending.kind === "identity" ? parseData(pending.data) : null;
    const { provider, subject, displayName } = data ?? {};
    if (!pending || pending.expires_at <= this.#deps.now() || typeof subject !== "string" || !isProviderId(provider)) {
      return refuse(410, "identity_expired", "这次第三方登录已失效，请重新开始。This sign-in expired. Start again.");
    }
    return { provider, subject, displayName: typeof displayName === "string" ? displayName : null };
  }

  async #pending(idHash: string, kind: string, now: number) {
    const pending = await this.#deps.store.pending(idHash);
    if (!pending || pending.kind !== kind || pending.expires_at <= now) {
      return refuse(410, "code_expired", "验证码已失效，请重新获取。The code expired. Request a new one.");
    }
    if (pending.failed_attempts >= MAX_CODE_ATTEMPTS) {
      return refuse(
        429,
        "too_many_code_attempts",
        "验证码输错次数太多，请重新获取。Too many incorrect codes. Request a new one.",
      );
    }
    return pending;
  }

  async #checkCode(
    idHash: string,
    id: string,
    channel: "email" | "phone",
    expected: string | null,
    typed: unknown,
  ): Promise<void> {
    if (expected === null) return;
    const code = typeof typed === "string" ? typed.replace(/\s/gu, "") : "";
    if (/^[0-9]{6}$/u.test(code) && hxSameText(await hxSha256(`hx-code:${id}:${channel}:${code}`), expected)) return;
    await this.#deps.store.countPendingFailure(idHash);
    if (channel === "email") {
      refuse(401, "incorrect_email_code", "邮箱验证码不正确。The email code is incorrect.");
    }
    refuse(401, "incorrect_phone_code", "短信验证码不正确。The SMS code is incorrect.");
  }

  async #ticket(email: string, sourceIp: string, now: number): Promise<HxTicket> {
    const challengeId = hxRandomToken(32);
    const code = hxRandomToken(24);
    await this.#deps.store.createTicketChallenge({
      idHash: await hxSha256(challengeId),
      email,
      codeHash: await hxSha256(`hx-ticket:${code}`),
      sourceIpHash: await hxSha256(sourceIp),
      now,
      expiresAt: now + TICKET_TTL_MS,
    });
    return { challengeId, code };
  }

  async #cooldown(latest: number | null, now: number): Promise<void> {
    if (latest !== null && latest > now - RESEND_COOLDOWN_MS) {
      const wait = Math.max(1, Math.ceil((latest + RESEND_COOLDOWN_MS - now) / 1_000));
      refuse(
        429,
        "code_recently_sent",
        `请 ${wait} 秒后再获取验证码。Wait ${wait} seconds before requesting another code.`,
        wait,
      );
    }
  }

  async #limit(key: string, limit: number, now: number, windowMs = RATE_WINDOW_MS): Promise<void> {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    // The account service's timer removes counts whose window began more than 15 minutes ago
    // (auth-data-retention.ts). A longer window, such as the day of a number's text messages, is stored
    // under its end, so that its count lasts until the window is over.
    const stored = windowMs > RATE_WINDOW_MS ? windowStart + windowMs : windowStart;
    const attempts = await this.#deps.store.countAttempt(await hxSha256(key), stored);
    if (attempts > limit) {
      const wait = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1_000));
      refuse(429, "rate_limited", "操作太频繁，请稍后再试。Too many attempts. Try again later.", wait);
    }
  }
}

function isProviderId(value: unknown): value is HxProviderId {
  return (
    value === "google" ||
    value === "apple" ||
    value === "wechat" ||
    value === "alipay" ||
    value === "facebook" ||
    value === "douyin"
  );
}
