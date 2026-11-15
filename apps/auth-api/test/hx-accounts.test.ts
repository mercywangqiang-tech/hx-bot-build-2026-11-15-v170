// HXBot：注册账号模块的测试。数据库是真的 SQLite（按迁移建表），邮件、短信和六家第三方平台用替身。
import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type DynamicRecord, isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { pruneExpiredAuthData } from "../src/server/auth-data-retention";
import { AuthOperationError, AuthService } from "../src/server/auth-service";
import { D1AuthRepository } from "../src/server/d1-auth-repository";
import { type HxAccountsConfig, hxAccountsConfig } from "../src/server/hx-accounts/config";
import { type HxSignedInUser, handleHxAccounts } from "../src/server/hx-accounts/http";
import { HX_MAIL_LOGO, HX_MAIL_SENDER, hxCodeEmail, hxMailbox } from "../src/server/hx-accounts/mail";
import {
  type HxFetch,
  hxAlipayRequest,
  hxAliyunSmsRequest,
  hxAuthorizeUrl,
  hxExchange,
  hxKeyBytes,
  hxRsaPkcs8,
  hxSendSmsCode,
} from "../src/server/hx-accounts/providers";
import { hxPasswordProblem, hxSha256 } from "../src/server/hx-accounts/secrets";
import { HxAccountError, HxAccounts } from "../src/server/hx-accounts/service";
import { HxAccountStore, type HxDatabase, type HxStatement } from "../src/server/hx-accounts/store";
import { type SmtpConnector, sendPrivateEmail } from "../src/server/smtp-email-delivery";
import { migratedDatabase } from "./sqlite-d1";

const IP = "203.0.113.9";
const START = Date.UTC(2026, 10, 11, 8, 0, 0);

/** A SQLite database behind the part of the D1 interface that the account service uses. */
function d1(database: DatabaseSync): HxDatabase {
  const statement = (sql: string, values: (string | number | null)[]): HxStatement => ({
    bind: (...next) => statement(sql, next),
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: the row shape is the caller's, as with D1
    first: async <Row>() => (database.prepare(sql).get(...values) ?? null) as Row | null,
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: the row shape is the caller's, as with D1
    all: async <Row>() => ({ results: database.prepare(sql).all(...values) as Row[] }),
    run: async () => ({ meta: { changes: Number(database.prepare(sql).run(...values).changes) } }),
  });
  return { prepare: (sql) => statement(sql, []) };
}

/** What the account service's timer removes every five minutes (auth-data-retention.ts), on this database. */
async function prune(w: World): Promise<void> {
  const database = {
    prepare: (sql: string) => ({ bind: (...values: (string | number | null)[]) => ({ sql, values }) }),
    batch: async (statements: { sql: string; values: (string | number | null)[] }[]) =>
      statements.map((item) => ({
        meta: { changes: Number(w.database.prepare(item.sql).run(...item.values).changes) },
      })),
  };
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the part of D1 that the retention uses, as with HxDatabase
  await Effect.runPromise(pruneExpiredAuthData(database as unknown as D1Database, w.clock.now));
}

interface World {
  database: DatabaseSync;
  accounts: HxAccounts;
  store: HxAccountStore;
  config: HxAccountsConfig;
  clock: { now: number };
  emails: { email: string; code: string; purpose: string; lang: string }[];
  texts: { phone: string; code: string }[];
}

function world(env: Record<string, string> = {}, options: { email?: boolean; sms?: boolean } = {}): World {
  const database = migratedDatabase();
  const store = new HxAccountStore(d1(database));
  const config = hxAccountsConfig(env);
  const clock = { now: START };
  const emails: World["emails"] = [];
  const texts: World["texts"] = [];
  const accounts = new HxAccounts({
    store,
    config,
    now: () => clock.now,
    sendEmailCode:
      options.email === false
        ? null
        : async (email, code, _expiresAt, purpose, lang) => {
            emails.push({ email, code, purpose, lang });
          },
    sendSmsCode:
      options.sms === false
        ? null
        : async (phone, code) => {
            texts.push({ phone, code });
          },
    emailAllowed: (email) => !email.endsWith("@blocked.example"),
  });
  return { database, accounts, store, config, clock, emails, texts };
}

async function refusal(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof HxAccountError) return error.code;
    throw error;
  }
  return "no refusal";
}

const PROFILE = { username: "王小明", password: "Giraffe2026!", jobTitle: "研究员", company: "弘犀智能" };

async function register(
  w: World,
  email = "ming@example.org",
  phone = "13800138000",
  more: Partial<typeof PROFILE> = {},
) {
  const started = await w.accounts.startRegistration({ email, phone }, IP);
  const ticket = await w.accounts.finishRegistration(
    {
      registrationId: started.registrationId,
      emailCode: w.emails.at(-1)?.code,
      phoneCode: w.texts.at(-1)?.code,
      ...PROFILE,
      ...more,
    },
    IP,
  );
  return { started, ticket };
}

/** The real sign-in service of the account API on the same database, with the accounts hook. */
function signIn(w: World): AuthService {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the repository uses only the calls that the test database has
  const repository = new D1AuthRepository(d1(w.database) as unknown as D1Database);
  const failed = () => new AuthOperationError({ message: "failed" });
  return new AuthService({
    repository,
    delivery: null,
    now: () => w.clock.now,
    accounts: {
      startHash: (email) => Effect.tryPromise({ try: () => w.accounts.startHash(email), catch: failed }),
      verifyHash: (id, typed) => Effect.tryPromise({ try: () => w.accounts.verifyHash(id, typed), catch: failed }),
    },
  });
}

async function passwordSignIn(w: World, email: string, password: string): Promise<string> {
  const service = signIn(w);
  const challenge = await Effect.runPromise(service.startEmailSignIn(email, IP));
  try {
    const session = await Effect.runPromise(
      service.verifyEmailCode({ challengeId: challenge.challengeId, code: password, sourceIp: IP, surface: "web" }),
    );
    return `signed in as ${session.user.email} (${session.user.name})`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function ticketSignIn(w: World, ticket: { challengeId: string; code: string }): Promise<string> {
  try {
    const session = await Effect.runPromise(
      signIn(w).verifyEmailCode({ challengeId: ticket.challengeId, code: ticket.code, sourceIp: IP, surface: "web" }),
    );
    return `signed in as ${session.user.email} (${session.user.name})`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("registration", () => {
  it("creates the account after both codes and signs in with the ticket, then with the password", async () => {
    const w = world();
    expect(w.accounts.settings()).toEqual({
      emailCode: true,
      phoneCode: true,
      sharedPassword: false,
      providers: [],
      ready: { email: true, sms: true },
    });
    const { started, ticket } = await register(w, " Ming@Example.org ", "138 0013 8000");
    expect(started).toMatchObject({ emailCode: true, phoneCode: true, expiresAt: START + 600_000 });
    expect(w.emails).toEqual([
      { email: "ming@example.org", purpose: "register", lang: "zh", code: expect.stringMatching(/^[0-9]{6}$/u) },
    ]);
    expect(w.texts).toEqual([{ phone: "+8613800138000", code: expect.stringMatching(/^[0-9]{6}$/u) }]);
    expect(w.database.prepare("SELECT * FROM hx_accounts").all()).toMatchObject([
      {
        email: "ming@example.org",
        username: "王小明",
        username_key: "王小明",
        phone: "+8613800138000",
        phone_verified_at: START,
        job_title: "研究员",
        company: "弘犀智能",
        email_verified_at: START,
        password_iterations: 100_000,
        disabled_at: null,
      },
    ]);
    const stored = w.database.prepare("SELECT password_hash, password_salt FROM hx_accounts").get();
    expect(JSON.stringify(stored)).not.toContain("Giraffe2026!");
    expect(String(stored?.password_hash)).toMatch(/^[0-9a-f]{64}$/u);
    expect(w.database.prepare("SELECT COUNT(*) AS n FROM hx_pending").get()).toEqual({ n: 0 });

    expect(await ticketSignIn(w, ticket)).toBe("signed in as ming@example.org (王小明)");
    // A ticket works once.
    expect(await ticketSignIn(w, ticket)).toContain("incorrect");
    expect(await passwordSignIn(w, "ming@example.org", "Giraffe2026!")).toBe("signed in as ming@example.org (王小明)");
    expect(await passwordSignIn(w, "ming@example.org", " Giraffe2026! ")).toBe(
      "signed in as ming@example.org (王小明)",
    );
    expect(await passwordSignIn(w, "ming@example.org", "giraffe2026!")).toContain("不正确");
    expect(await passwordSignIn(w, "nobody@example.org", "Giraffe2026!")).toContain("不正确");
    expect(w.database.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 1 });
    expect(w.database.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get()).toEqual({ n: 3 });
  });

  it("refuses wrong codes and stops after five", async () => {
    const w = world();
    const started = await w.accounts.startRegistration({ email: "a@example.org", phone: "13800138001" }, IP);
    const emailCode = w.emails[0]?.code ?? "";
    const phoneCode = w.texts[0]?.code ?? "";
    const wrong = emailCode === "000000" ? "111111" : "000000";
    const finish = (codes: { emailCode?: string; phoneCode?: string }) =>
      refusal(w.accounts.finishRegistration({ registrationId: started.registrationId, ...PROFILE, ...codes }, IP));
    expect(await finish({ emailCode: wrong, phoneCode })).toBe("incorrect_email_code");
    expect(await finish({ emailCode, phoneCode: phoneCode === "000000" ? "111111" : "000000" })).toBe(
      "incorrect_phone_code",
    );
    expect(await finish({ emailCode, phoneCode: "" })).toBe("incorrect_phone_code");
    expect(await finish({ phoneCode })).toBe("incorrect_email_code");
    expect(await finish({ emailCode: "12345", phoneCode })).toBe("incorrect_email_code");
    expect(await finish({ emailCode, phoneCode })).toBe("too_many_code_attempts");
    expect(w.database.prepare("SELECT COUNT(*) AS n FROM hx_accounts").get()).toEqual({ n: 0 });
  });

  it("refuses an expired registration, a second use and bad input", async () => {
    const w = world();
    const started = await w.accounts.startRegistration({ email: "a@example.org", phone: "13800138001" }, IP);
    const codes = { emailCode: w.emails[0]?.code, phoneCode: w.texts[0]?.code };
    const finish = (more: Partial<typeof PROFILE> & { registrationId?: string }) =>
      refusal(
        w.accounts.finishRegistration({ registrationId: started.registrationId, ...PROFILE, ...codes, ...more }, IP),
      );
    expect(await finish({ username: "x" })).toBe("invalid_username");
    expect(await finish({ username: "has space" })).toBe("invalid_username");
    expect(await finish({ password: "short1" })).toBe("invalid_password");
    expect(await finish({ password: "onlyletters" })).toBe("invalid_password");
    // Letters and digits without a symbol are not enough since v1.6.1.
    expect(await finish({ password: "Giraffe2026" })).toBe("invalid_password");
    expect(await finish({ password: "giraffe!!!" })).toBe("invalid_password");
    expect(hxPasswordProblem("Giraffe2026")).toBe("too_simple");
    expect(hxPasswordProblem("Giraffe2026！")).toBeNull(); // a full-width symbol counts
    expect(hxPasswordProblem("Gir 2026_")).toBeNull();
    expect(hxPasswordProblem("Gi#2026")).toBe("too_short");
    expect(await finish({ password: `A1${"x".repeat(31)}` })).toBe("invalid_password");
    expect(await finish({ jobTitle: " " })).toBe("invalid_job_title");
    expect(await finish({ company: "x".repeat(65) })).toBe("invalid_company");
    expect(await finish({ registrationId: "something else" })).toBe("code_expired");
    w.clock.now += 600_001;
    expect(await finish({})).toBe("code_expired");
    expect(await refusal(w.accounts.startRegistration({ email: "not an email", phone: "13800138001" }, IP))).toBe(
      "invalid_email",
    );
    expect(await refusal(w.accounts.startRegistration({ email: "b@example.org", phone: "12345" }, IP))).toBe(
      "invalid_phone",
    );
    expect(await refusal(w.accounts.startRegistration({ email: "b@example.org", phone: "+8612800138000" }, IP))).toBe(
      "invalid_phone",
    );
    expect(await refusal(w.accounts.startRegistration({ email: "b@example.org", phone: "+14155550100" }, IP))).toBe(
      "phone_not_supported",
    );
    expect(await refusal(w.accounts.startRegistration({ email: "b@blocked.example", phone: "13800138001" }, IP))).toBe(
      "email_not_allowed",
    );
  });

  it("refuses an email and a username that are taken", async () => {
    const w = world();
    await register(w);
    expect(await refusal(w.accounts.startRegistration({ email: "MING@example.org", phone: "13800138002" }, IP))).toBe(
      "email_registered",
    );
    w.clock.now += 61_000;
    const started = await w.accounts.startRegistration({ email: "other@example.org", phone: "13800138002" }, IP);
    const codes = {
      registrationId: started.registrationId,
      emailCode: w.emails.at(-1)?.code,
      phoneCode: w.texts.at(-1)?.code,
    };
    expect(await refusal(w.accounts.finishRegistration({ ...PROFILE, ...codes }, IP))).toBe("username_taken");
    // The codes still stand: the person only picks another name.
    const ticket = await w.accounts.finishRegistration({ ...PROFILE, ...codes, username: "Ming-2" }, IP);
    expect(await ticketSignIn(w, ticket)).toBe("signed in as other@example.org (Ming-2)");
    // Capitals do not make another name.
    expect(await refusal(register(w, "third@example.org", "13800138003", { username: "ming-2" }))).toBe(
      "username_taken",
    );
  });

  it("refuses a mobile number that an account has, at the start and at the end", async () => {
    const w = world();
    await register(w);
    // The same number in another way of writing it is the same number.
    for (const phone of ["13800138000", "+8613800138000", "008613800138000"]) {
      expect(await refusal(w.accounts.startRegistration({ email: "other@example.org", phone }, IP))).toBe(
        "phone_registered",
      );
    }
    // Two registrations with one number: the one that finishes first gets it.
    w.clock.now += 61_000;
    const first = await w.accounts.startRegistration({ email: "first@example.org", phone: "13800138005" }, IP);
    const firstCodes = { emailCode: w.emails.at(-1)?.code, phoneCode: w.texts.at(-1)?.code };
    w.clock.now += 61_000;
    const second = await w.accounts.startRegistration({ email: "second@example.org", phone: "13800138005" }, IP);
    const secondCodes = { emailCode: w.emails.at(-1)?.code, phoneCode: w.texts.at(-1)?.code };
    await w.accounts.finishRegistration(
      { ...PROFILE, ...firstCodes, registrationId: first.registrationId, username: "First" },
      IP,
    );
    expect(
      await refusal(
        w.accounts.finishRegistration(
          { ...PROFILE, ...secondCodes, registrationId: second.registrationId, username: "Second" },
          IP,
        ),
      ),
    ).toBe("phone_registered");
    expect(w.database.prepare("SELECT email FROM hx_accounts WHERE phone = '+8613800138005'").all()).toEqual([
      { email: "first@example.org" },
    ]);
    expect(w.database.prepare("SELECT phone, email FROM hx_phone_owners ORDER BY phone").all()).toEqual([
      { phone: "+8613800138000", email: "ming@example.org" },
      { phone: "+8613800138005", email: "first@example.org" },
    ]);
  });

  it("keeps the store's account and the owner of its number together", async () => {
    const w = world();
    const account = {
      email: "a@example.org",
      username: "A",
      phone: "+8613800138010",
      phoneVerified: false,
      jobTitle: "研究员",
      company: "弘犀智能",
      emailVerified: false,
      password: null,
    };
    expect(await w.store.createAccount(account, START)).toBe("created");
    expect(await w.store.createAccount({ ...account, username: "B" }, START)).toBe("email");
    expect(await w.store.createAccount({ ...account, email: "b@example.org" }, START)).toBe("username");
    // The number is taken: no account is left behind for the email.
    expect(await w.store.createAccount({ ...account, email: "b@example.org", username: "B" }, START)).toBe("phone");
    expect(await w.store.account("b@example.org")).toBeNull();
    // An account made before the rule, with a number another account has, keeps it from new accounts too.
    w.database
      .prepare(
        `INSERT INTO hx_accounts(email, username, username_key, phone, job_title, company, created_at, updated_at)
         VALUES ('old@example.org', 'Old', 'old', '+8613800138011', '研究员', '弘犀智能', 1, 1)`,
      )
      .run();
    expect(await w.store.phoneTaken("+8613800138011")).toBe(true);
    expect(await w.store.phoneTaken("+8613800138012")).toBe(false);
    // Removing an account frees its number.
    w.database.prepare("DELETE FROM hx_accounts WHERE email = 'a@example.org'").run();
    expect(await w.store.phoneTaken("+8613800138010")).toBe(false);
  });

  it("says whether a username is free while a registration is open", async () => {
    const w = world();
    await register(w);
    w.clock.now += 61_000;
    const started = await w.accounts.startRegistration({ email: "other@example.org", phone: "13800138006" }, IP);
    const ask = (username: string, registrationId = started.registrationId) =>
      w.accounts.usernameAvailable({ registrationId, username }, IP);
    expect(await ask("王小明")).toEqual({ available: false });
    expect(await ask("Ming-3")).toEqual({ available: true });
    expect(await refusal(ask("x"))).toBe("invalid_username");
    // Without an open registration it answers nobody.
    expect(await refusal(ask("Ming-3", "not-a-registration"))).toBe("code_expired");
  });

  it("waits a minute between codes and limits the codes of one number", async () => {
    const w = world();
    await w.accounts.startRegistration({ email: "a@example.org", phone: "13800138001" }, IP);
    expect(await refusal(w.accounts.startRegistration({ email: "a@example.org", phone: "13800138009" }, IP))).toBe(
      "code_recently_sent",
    );
    expect(await refusal(w.accounts.startRegistration({ email: "z@example.org", phone: "13800138001" }, IP))).toBe(
      "code_recently_sent",
    );
    expect(w.texts).toHaveLength(1);
    // Twenty minutes apart, with the account service's timer in between: the count of the day survives it.
    for (let index = 0; index < 9; index += 1) {
      w.clock.now += 20 * 60_000;
      await prune(w);
      await w.accounts.startRegistration(
        { email: `n${index}@example.org`, phone: "13800138001" },
        `198.51.100.${index}`,
      );
    }
    w.clock.now += 20 * 60_000;
    await prune(w);
    expect(
      await refusal(w.accounts.startRegistration({ email: "last@example.org", phone: "13800138001" }, "198.51.100.99")),
    ).toBe("rate_limited");
    expect(w.texts).toHaveLength(10);
  });

  it("needs no codes when both checks are off, and takes a number from abroad", async () => {
    const w = world({ HX_EMAIL_VERIFICATION: "off", HX_PHONE_VERIFICATION: "OFF" });
    expect(w.accounts.settings()).toMatchObject({ emailCode: false, phoneCode: false });
    const started = await w.accounts.startRegistration({ email: "a@example.org", phone: "+1 (415) 555-0100" }, IP);
    expect(started).toMatchObject({ emailCode: false, phoneCode: false });
    expect(w.emails).toEqual([]);
    expect(w.texts).toEqual([]);
    const ticket = await w.accounts.finishRegistration({ registrationId: started.registrationId, ...PROFILE }, IP);
    expect(await ticketSignIn(w, ticket)).toBe("signed in as a@example.org (王小明)");
    expect(w.database.prepare("SELECT phone, phone_verified_at, email_verified_at FROM hx_accounts").get()).toEqual({
      phone: "+14155550100",
      phone_verified_at: null,
      email_verified_at: null,
    });
  });

  it("says so when the server cannot send what a check needs", async () => {
    const noMail = world({}, { email: false });
    expect(noMail.accounts.settings().ready).toEqual({ email: false, sms: true });
    expect(await refusal(noMail.accounts.startRegistration({ email: "a@example.org", phone: "13800138001" }, IP))).toBe(
      "email_not_configured",
    );
    const noSms = world({}, { sms: false });
    expect(await refusal(noSms.accounts.startRegistration({ email: "a@example.org", phone: "13800138001" }, IP))).toBe(
      "sms_not_configured",
    );
  });
});

describe("deleting one's own account", () => {
  function userId(w: World, email: string): string {
    const row = w.database.prepare("SELECT id FROM users WHERE email = ?").get(email);
    return isDynamicRecord(row) && typeof row.id === "string" ? row.id : "";
  }
  function count(w: World, table: string, where: string, value: string): number {
    const row = w.database.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where} = ?`).get(value);
    return isDynamicRecord(row) ? Number(row.n) : -1;
  }

  it("needs the password, then removes the account, its sessions and its number", async () => {
    const w = world();
    const { ticket } = await register(w);
    expect(await ticketSignIn(w, ticket)).toBe("signed in as ming@example.org (王小明)");
    const id = userId(w, "ming@example.org");
    expect(count(w, "auth_sessions", "user_id", id)).toBe(1);
    const remove = (confirm: string) =>
      w.accounts.deleteAccount({ userId: id, email: "Ming@Example.org", confirm }, IP);
    expect(await refusal(remove("wrong-Password1!"))).toBe("incorrect_password");
    expect(await refusal(remove(""))).toBe("incorrect_password");
    expect(await refusal(remove("ming@example.org"))).toBe("incorrect_password");
    await remove(PROFILE.password);
    for (const [table, where, value] of [
      ["hx_accounts", "email", "ming@example.org"],
      ["hx_phone_owners", "email", "ming@example.org"],
      ["users", "id", id],
      ["auth_sessions", "user_id", id],
    ] as const) {
      expect(count(w, table, where, value), table).toBe(0);
    }
    expect(await passwordSignIn(w, "ming@example.org", PROFILE.password)).not.toContain("signed in");
    // The email, the number and the username can be registered again.
    w.clock.now += 61_000;
    const again = await register(w);
    expect(await ticketSignIn(w, again.ticket)).toBe("signed in as ming@example.org (王小明)");
  });

  it("asks an account without a password for its email", async () => {
    const w = world();
    w.database
      .prepare(
        "INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 1, 1)",
      )
      .run("00000000-0000-4000-8000-000000000001", "email:old@example.org", "old@example.org", "Old");
    const remove = (confirm: string) =>
      w.accounts.deleteAccount(
        { userId: "00000000-0000-4000-8000-000000000001", email: "old@example.org", confirm },
        IP,
      );
    expect(await refusal(remove("someone@example.org"))).toBe("confirm_with_email");
    await remove(" OLD@example.org ");
    expect(count(w, "users", "email", "old@example.org")).toBe(0);
  });
});

describe("an email that signed in with the shared password before", () => {
  function earlier(w: World, name: string | null) {
    w.database
      .prepare(
        "INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 1, 1)",
      )
      .run("user-1", "email:old@example.org", "old@example.org", name);
  }

  it("sets its own password with an emailed code and keeps its user and its name", async () => {
    const w = world({ HX_LOGIN_PASSWORD: "shared-password" });
    earlier(w, "老王");
    expect(w.accounts.settings().sharedPassword).toBe(false);
    const { ticket } = await register(w, "old@example.org");
    expect(await ticketSignIn(w, ticket)).toBe("signed in as old@example.org (老王)");
    expect(w.database.prepare("SELECT id, name FROM users").all()).toEqual([{ id: "user-1", name: "老王" }]);
    // The shared password signs nobody in.
    expect(await passwordSignIn(w, "old@example.org", "shared-password")).toContain("不正确");
  });

  it("proves itself with the shared password when no code can be emailed", async () => {
    const w = world({
      HX_LOGIN_PASSWORD: "shared-password",
      HX_EMAIL_VERIFICATION: "off",
      HX_PHONE_VERIFICATION: "off",
    });
    earlier(w, null);
    expect(w.accounts.settings().sharedPassword).toBe(true);
    const start = (sharedPassword?: string) =>
      w.accounts.startRegistration({ email: "old@example.org", phone: "13800138000", sharedPassword }, IP);
    expect(await refusal(start())).toBe("shared_password_required");
    expect(await refusal(start("wrong"))).toBe("shared_password_required");
    const started = await start(" shared-password ");
    const ticket = await w.accounts.finishRegistration({ registrationId: started.registrationId, ...PROFILE }, IP);
    expect(await ticketSignIn(w, ticket)).toBe("signed in as old@example.org (王小明)");
    // A new email needs no shared password.
    w.clock.now += 61_000;
    await w.accounts.startRegistration({ email: "new@example.org", phone: "13800138001" }, IP);
  });

  it("goes to the administrator when neither proof exists", async () => {
    const w = world({ HX_EMAIL_VERIFICATION: "off", HX_PHONE_VERIFICATION: "off" });
    earlier(w, null);
    expect(await refusal(w.accounts.startRegistration({ email: "old@example.org", phone: "13800138000" }, IP))).toBe(
      "contact_admin",
    );
  });
});

describe("a forgotten password", () => {
  it("is replaced after an emailed code, which signs the old sessions out", async () => {
    const w = world();
    await register(w);
    expect(await passwordSignIn(w, "ming@example.org", "Giraffe2026!")).toBe("signed in as ming@example.org (王小明)");
    const live = () =>
      w.database.prepare("SELECT COUNT(*) AS count FROM auth_sessions WHERE revoked_at IS NULL").get()?.count;
    expect(live()).toBe(1);
    w.clock.now += 61_000;
    expect(await refusal(w.accounts.startPasswordReset({ email: "nobody@example.org" }, IP))).toBe("account_not_found");
    const { resetId } = await w.accounts.startPasswordReset({ email: "ming@example.org" }, IP);
    const code = w.emails.at(-1)?.code ?? "";
    expect(await refusal(w.accounts.startPasswordReset({ email: "ming@example.org" }, IP))).toBe("code_recently_sent");
    expect(await refusal(w.accounts.finishPasswordReset({ resetId, emailCode: code, password: "weak" }, IP))).toBe(
      "invalid_password",
    );
    expect(
      await refusal(
        w.accounts.finishPasswordReset(
          { resetId, emailCode: code === "000000" ? "111111" : "000000", password: "NewGiraffe7#" },
          IP,
        ),
      ),
    ).toBe("incorrect_email_code");
    const ticket = await w.accounts.finishPasswordReset({ resetId, emailCode: code, password: "NewGiraffe7#" }, IP);
    expect(live()).toBe(0);
    expect(await ticketSignIn(w, ticket)).toBe("signed in as ming@example.org (王小明)");
    expect(live()).toBe(1);
    expect(await passwordSignIn(w, "ming@example.org", "Giraffe2026!")).toContain("不正确");
    expect(await passwordSignIn(w, "ming@example.org", "NewGiraffe7#")).toBe("signed in as ming@example.org (王小明)");
    expect(
      await refusal(w.accounts.finishPasswordReset({ resetId, emailCode: code, password: "Another8x$" }, IP)),
    ).toBe("code_expired");
  });

  it("goes to the administrator when the server sends no codes", async () => {
    const w = world({
      HX_EMAIL_VERIFICATION: "off",
      HX_PHONE_VERIFICATION: "off",
      HX_LOGIN_PASSWORD: "shared-password",
    });
    expect(await refusal(w.accounts.startPasswordReset({ email: "ming@example.org" }, IP))).toBe("reset_unavailable");
  });

  it("does not sign a disabled account in", async () => {
    const w = world();
    await register(w);
    w.database.prepare("UPDATE hx_accounts SET disabled_at = 1").run();
    expect(await passwordSignIn(w, "ming@example.org", "Giraffe2026!")).toContain("不正确");
    w.clock.now += 61_000;
    expect(await refusal(w.accounts.startPasswordReset({ email: "ming@example.org" }, IP))).toBe("account_disabled");
  });
});

const PROVIDERS = {
  HX_GOOGLE_CLIENT_ID: "google-client",
  HX_GOOGLE_CLIENT_SECRET: "google-secret",
  HX_WECHAT_APP_ID: "wx123",
  HX_WECHAT_APP_SECRET: "wechat-secret",
  HX_FACEBOOK_APP_ID: "fb123",
  HX_FACEBOOK_APP_SECRET: "facebook-secret",
  HX_DOUYIN_CLIENT_KEY: "dy123",
  HX_DOUYIN_CLIENT_SECRET: "douyin-secret",
};

describe("an account at another service", () => {
  it("registers once, then signs the same account in", async () => {
    const w = world(PROVIDERS);
    expect(w.accounts.settings().providers).toEqual(["wechat", "douyin", "google", "facebook"]);
    expect(await refusal(w.accounts.beginOutside("alipay", IP))).toBe("provider_off");
    const { state, nonce } = await w.accounts.beginOutside("wechat", IP);
    expect(await refusal(w.accounts.endOutside("google", state))).toBe("identity_expired");
    expect(await w.accounts.endOutside("wechat", state)).toEqual({ nonce });
    expect(await refusal(w.accounts.endOutside("wechat", state))).toBe("identity_expired");

    const who = { provider: "wechat", subject: "union-1", displayName: null, email: null } as const;
    const first = await w.accounts.outsideSignIn(who, IP);
    if (!("identity" in first)) throw new Error("a new outside account must register first");
    const started = await w.accounts.startRegistration(
      { email: "ming@example.org", phone: "13800138000", identity: first.identity },
      IP,
    );
    const ticket = await w.accounts.finishRegistration(
      { registrationId: started.registrationId, emailCode: w.emails[0]?.code, phoneCode: w.texts[0]?.code, ...PROFILE },
      IP,
    );
    expect(await ticketSignIn(w, ticket)).toBe("signed in as ming@example.org (王小明)");
    expect(w.database.prepare("SELECT provider, subject, email FROM hx_identities").all()).toEqual([
      { provider: "wechat", subject: "union-1", email: "ming@example.org" },
    ]);
    const again = await w.accounts.outsideSignIn(who, IP);
    if (!("ticket" in again)) throw new Error("a linked outside account signs in");
    expect(await ticketSignIn(w, again.ticket)).toBe("signed in as ming@example.org (王小明)");
    // The account still signs in with its password, which the desktop and phone apps use.
    expect(await passwordSignIn(w, "ming@example.org", "Giraffe2026!")).toBe("signed in as ming@example.org (王小明)");
    w.database.prepare("UPDATE hx_accounts SET disabled_at = 1").run();
    expect(await refusal(w.accounts.outsideSignIn(who, IP))).toBe("account_disabled");
  });

  it("links to an account whose password the person knows", async () => {
    const w = world(PROVIDERS);
    await register(w);
    const who = { provider: "google", subject: "g-1", displayName: "Ming", email: "ming@gmail.example" } as const;
    const first = await w.accounts.outsideSignIn(who, IP);
    if (!("identity" in first)) throw new Error("a new outside account is not linked yet");
    expect(first).toMatchObject({ displayName: "Ming", email: "ming@gmail.example" });
    const link = (password: string, identity = first.identity) =>
      w.accounts.linkIdentity({ identity, email: "ming@example.org", password }, IP);
    expect(await refusal(link("wrong-password1"))).toBe("incorrect_password");
    expect(await refusal(link("Giraffe2026!", "no such ticket"))).toBe("identity_expired");
    expect(await ticketSignIn(w, await link("Giraffe2026!"))).toBe("signed in as ming@example.org (王小明)");
    expect(await refusal(link("Giraffe2026!"))).toBe("identity_expired");
    const again = await w.accounts.outsideSignIn(who, IP);
    expect("ticket" in again).toBe(true);
  });
});

type Answer = (url: URL, init: RequestInit | undefined) => DynamicRecord;

function answers(routes: Readonly<{ [route: string]: Answer }>): {
  fetcher: HxFetch;
  calls: { url: string; body: string }[];
} {
  const calls: { url: string; body: string }[] = [];
  return {
    calls,
    fetcher: async (url, init) => {
      const parsed = new URL(url);
      calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
      const route = routes[`${parsed.host}${parsed.pathname}`];
      if (!route) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(route(parsed, init)), { headers: { "Content-Type": "application/json" } });
    },
  };
}

function idToken(claims: DynamicRecord): string {
  const part = (value: DynamicRecord) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

describe("the six providers", () => {
  const context = {
    redirectUri: "https://bot.hxallai.com/api/browser/hx/oauth/x/callback",
    state: "state-1",
    nonce: "nonce-1",
  };

  it("sends the browser to each provider's own page", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const secrets = hxAccountsConfig({
      ...PROVIDERS,
      HX_APPLE_SERVICE_ID: "com.hxallai.bot.web",
      HX_APPLE_TEAM_ID: "ABCDE12345",
      HX_APPLE_KEY_ID: "KEY1234567",
      HX_APPLE_PRIVATE_KEY: "unused",
      HX_ALIPAY_APP_ID: "2021000000000001",
      HX_ALIPAY_PRIVATE_KEY: rsa.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    }).providers;
    const url = (provider: Parameters<typeof hxAuthorizeUrl>[0]) => new URL(hxAuthorizeUrl(provider, secrets, context));
    expect(url("google").origin + url("google").pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url("google").searchParams)).toMatchObject({
      client_id: "google-client",
      redirect_uri: context.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: "state-1",
      nonce: "nonce-1",
    });
    expect(url("apple").href).toContain("https://appleid.apple.com/auth/authorize?client_id=com.hxallai.bot.web&");
    expect(Object.fromEntries(url("apple").searchParams)).toMatchObject({
      response_mode: "form_post",
      scope: "name email",
      nonce: "nonce-1",
    });
    expect(hxAuthorizeUrl("wechat", secrets, context)).toBe(
      `https://open.weixin.qq.com/connect/qrconnect?appid=wx123&redirect_uri=${encodeURIComponent(context.redirectUri)}&response_type=code&scope=snsapi_login&state=state-1#wechat_redirect`,
    );
    expect(hxAuthorizeUrl("alipay", secrets, context)).toBe(
      `https://openauth.alipay.com/oauth2/publicAppAuthorize.htm?app_id=2021000000000001&scope=auth_user&redirect_uri=${encodeURIComponent(context.redirectUri)}&state=state-1`,
    );
    expect(url("facebook").origin + url("facebook").pathname).toBe("https://www.facebook.com/dialog/oauth");
    expect(Object.fromEntries(url("facebook").searchParams)).toMatchObject({
      client_id: "fb123",
      scope: "public_profile,email",
      state: "state-1",
    });
    expect(url("douyin").origin + url("douyin").pathname).toBe("https://open.douyin.com/platform/oauth/connect/");
    expect(Object.fromEntries(url("douyin").searchParams)).toMatchObject({
      client_key: "dy123",
      scope: "user_info",
      response_type: "code",
    });
    expect(() => hxAuthorizeUrl("google", {}, context)).toThrow(HxAccountError);
  });

  it("reads who signed in at Google, Facebook, WeChat and Douyin", async () => {
    const secrets = hxAccountsConfig(PROVIDERS).providers;
    const { fetcher, calls } = answers({
      "oauth2.googleapis.com/token": () => ({
        access_token: "g-token",
        id_token: idToken({ sub: "g-1", aud: "google-client", nonce: "nonce-1" }),
      }),
      "openidconnect.googleapis.com/v1/userinfo": (_url, init) =>
        new Headers(init?.headers).get("Authorization") === "Bearer g-token"
          ? { sub: "g-1", name: "Ming", email: "ming@gmail.example", email_verified: true }
          : { error: "bad token" },
      "graph.facebook.com/oauth/access_token": (url) =>
        url.searchParams.get("client_secret") === "facebook-secret" && url.searchParams.get("code") === "the-code"
          ? { access_token: "f-token" }
          : { error: { message: "bad" } },
      "graph.facebook.com/me": (url) =>
        url.searchParams.get("access_token") === "f-token" ? { id: "f-1", name: "Ming F" } : {},
      "api.weixin.qq.com/sns/oauth2/access_token": (url) =>
        url.searchParams.get("code") === "the-code" && url.searchParams.get("secret") === "wechat-secret"
          ? { access_token: "w", openid: "open-1", unionid: "union-1" }
          : { errcode: 40029, errmsg: "invalid code" },
      "open.douyin.com/oauth/access_token/": (_url, init) =>
        String(init?.body).includes("client_secret=douyin-secret") && String(init?.body).includes("code=the-code")
          ? { data: { access_token: "d", open_id: "dy-open-1", error_code: 0 }, message: "success" }
          : { data: { error_code: 10007, description: "bad code" }, message: "error" },
    });
    const exchange = (provider: Parameters<typeof hxExchange>[0], code = "the-code") =>
      hxExchange(provider, secrets, code, context, fetcher, START);
    expect(await exchange("google")).toEqual({
      provider: "google",
      subject: "g-1",
      displayName: "Ming",
      email: "ming@gmail.example",
    });
    expect(calls[0]?.body).toContain("client_secret=google-secret");
    expect(calls[0]?.body).toContain(`redirect_uri=${encodeURIComponent(context.redirectUri)}`);
    expect(await exchange("facebook")).toEqual({
      provider: "facebook",
      subject: "f-1",
      displayName: "Ming F",
      email: null,
    });
    expect(await exchange("wechat")).toEqual({
      provider: "wechat",
      subject: "union-1",
      displayName: null,
      email: null,
    });
    expect(await exchange("douyin")).toEqual({
      provider: "douyin",
      subject: "dy-open-1",
      displayName: null,
      email: null,
    });
    expect(await refusal(exchange("wechat", "bad"))).toBe("provider_failed");
    expect(await refusal(exchange("douyin", "bad"))).toBe("provider_failed");
    expect(await refusal(exchange("facebook", "bad"))).toBe("provider_failed");
    expect(
      await refusal(hxExchange("google", secrets, "the-code", { ...context, nonce: "another" }, fetcher, START)),
    ).toBe("provider_failed");
    expect(await refusal(hxExchange("alipay", secrets, "the-code", context, fetcher, START))).toBe("provider_off");
  });

  it("signs the Apple request with the team's key and reads the identity token", async () => {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const secrets = hxAccountsConfig({
      HX_APPLE_SERVICE_ID: "com.hxallai.bot.web",
      HX_APPLE_TEAM_ID: "ABCDE12345",
      HX_APPLE_KEY_ID: "KEY1234567",
      // One line, as a .env value: the line breaks written as \n.
      HX_APPLE_PRIVATE_KEY: pem.trim().replaceAll("\n", "\\n"),
    }).providers;
    let posted = new URLSearchParams();
    const { fetcher } = answers({
      "appleid.apple.com/auth/token": (_url, init) => {
        posted = new URLSearchParams(String(init?.body));
        return {
          id_token: idToken({
            iss: "https://appleid.apple.com",
            aud: "com.hxallai.bot.web",
            sub: "apple-1",
            nonce: "nonce-1",
            exp: START / 1_000 + 600,
            email: "ming@privaterelay.example",
            email_verified: "true",
          }),
        };
      },
    });
    expect(await hxExchange("apple", secrets, "the-code", context, fetcher, START)).toEqual({
      provider: "apple",
      subject: "apple-1",
      displayName: null,
      email: "ming@privaterelay.example",
    });
    expect(posted.get("client_id")).toBe("com.hxallai.bot.web");
    expect(posted.get("grant_type")).toBe("authorization_code");
    const [header = "", claims = "", signature = ""] = (posted.get("client_secret") ?? "").split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: "ABCDE12345",
      iat: START / 1_000,
      exp: START / 1_000 + 300,
      aud: "https://appleid.apple.com",
      sub: "com.hxallai.bot.web",
    });
    const verifier = createVerify("SHA256").update(`${header}.${claims}`);
    expect(
      verifier.verify({ key: pair.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")),
    ).toBe(true);
    expect(await refusal(hxExchange("apple", secrets, "the-code", context, fetcher, START + 700_000))).toBe(
      "provider_failed",
    );
  });

  it("signs the Alipay request with either form of the app's key", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    for (const type of ["pkcs8", "pkcs1"] as const) {
      const key = pair.privateKey.export({ type, format: "der" }).toString("base64");
      expect(hxRsaPkcs8(hxKeyBytes(key))).toEqual(
        new Uint8Array(pair.privateKey.export({ type: "pkcs8", format: "der" })),
      );
      const request = await hxAlipayRequest({ appId: "2021000000000001", privateKey: key }, "auth-code-1", START);
      const { sign = "", ...values } = request;
      expect(values).toEqual({
        app_id: "2021000000000001",
        method: "alipay.system.oauth.token",
        format: "JSON",
        charset: "utf-8",
        sign_type: "RSA2",
        timestamp: "2026-11-11 16:00:00",
        version: "1.0",
        grant_type: "authorization_code",
        code: "auth-code-1",
      });
      const content = Object.keys(values)
        .sort()
        .map((name) => `${name}=${values[name]}`)
        .join("&");
      expect(createVerify("RSA-SHA256").update(content).verify(pair.publicKey, sign, "base64")).toBe(true);
    }
    const secrets = hxAccountsConfig({
      HX_ALIPAY_APP_ID: "2021000000000001",
      HX_ALIPAY_PRIVATE_KEY: pair.privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    }).providers;
    const { fetcher, calls } = answers({
      "openapi.alipay.com/gateway.do": (_url, init) =>
        String(init?.body).includes("code=good")
          ? { alipay_system_oauth_token_response: { open_id: "ali-open-1", access_token: "a" }, sign: "x" }
          : { error_response: { code: "40002", sub_code: "isv.code-invalid" }, sign: "x" },
    });
    expect(await hxExchange("alipay", secrets, "good", context, fetcher, START)).toEqual({
      provider: "alipay",
      subject: "ali-open-1",
      displayName: null,
      email: null,
    });
    expect(calls[0]?.body).toContain("method=alipay.system.oauth.token");
    expect(await refusal(hxExchange("alipay", secrets, "bad", context, fetcher, START))).toBe("provider_failed");
  });
});

describe("the email with the code", () => {
  const SETTINGS = {
    EMAIL_SMTP_HOST: "smtp.qiye.aliyun.com",
    EMAIL_SMTP_PORT: "465",
    EMAIL_SMTP_USERNAME: "bot@hxallai.com",
    EMAIL_SMTP_PASSWORD: "mailbox password",
    EMAIL_FROM: "bot@hxallai.com",
  };

  it("is sent from the mailbox of the server's settings", () => {
    expect(hxMailbox(SETTINGS)).toEqual({
      host: "smtp.qiye.aliyun.com",
      port: 465,
      username: "bot@hxallai.com",
      password: "mailbox password",
      from: "bot@hxallai.com",
    });
  });

  it("has no mailbox when a setting is missing or the port is not 465", () => {
    expect(hxMailbox({})).toBeNull();
    for (const name of Object.keys(SETTINGS)) expect(hxMailbox({ ...SETTINGS, [name]: "" })).toBeNull();
    // The sender speaks TLS from the first byte. Port 587 starts in plain text, which it cannot do.
    expect(hxMailbox({ ...SETTINGS, EMAIL_SMTP_PORT: "587" })).toBeNull();
  });

  it("says what the code is for, in Chinese first and then English, with the digits on white and the logo", () => {
    // 2026-11-12 05:20 UTC is 13:20 in Beijing.
    const at = Date.UTC(2026, 10, 12, 5, 20);
    const register = hxCodeEmail("048213", "register", 10, "zh", "ming@example.org", at);
    expect(register.subject).toBe("HXBot 账号验证码 / HXBot verification code");
    expect(register.text).toContain("你正在注册 HXBot 账号");
    expect(register.text).toContain("    048213\r\n");
    expect(register.text).toContain("10 分钟内有效 · 只能使用一次");
    expect(register.text).toContain("弘犀智能的工作人员不会以任何方式向你索要验证码");
    expect(register.text).toContain("只在 bot.hxallai.com 的页面上输入验证码");
    expect(register.text).toContain("时间: 2026-11-12 13:20（北京时间）");
    expect(register.text).toContain("有效期至: 2026-11-12 13:30（北京时间）");
    expect(register.text).toContain("账号: ming@example.org");
    expect(register.text).toContain("You’re creating an HXBot Account.");
    // The six digits as one piece of text on the white card, with no panel and no boxes; the giraffe sent inside the message.
    expect(register.html).toMatch(/class="hx-digits" style="[^"]*">048213<\/div>/u);
    expect(register.html).not.toMatch(/linear-gradient|hx-digit"|border-radius:12px;background:#163D7A/u);
    expect(register.html).toContain('src="cid:hxbot-giraffe@bot.hxallai.com"');
    expect(register.html).toContain('<html lang="zh-CN">');
    const reset = hxCodeEmail("771900", "reset", 1, "zh", "ming@example.org", at);
    expect(reset.text).toContain("你正在找回 HXBot 账号的密码");
    expect(reset.text).toContain("你的密码不会改变");
    expect(reset.text).toContain("It expires in 1 minute and works once.");
    // Nothing of the project this product was made from.
    expect(`${register.text}${register.html}${reset.text}${reset.html}`).not.toMatch(/openbot/iu);
  });

  it("writes English only when the code was asked for on the English page", () => {
    const at = Date.UTC(2026, 10, 12, 5, 20);
    const register = hxCodeEmail("048213", "register", 10, "en", "ming@example.org", at);
    const reset = hxCodeEmail("771900", "reset", 1, "en", "ming@example.org", at);
    expect(register.subject).toBe("Your HXBot verification code");
    expect(register.text).toContain("You’re creating an HXBot Account.");
    expect(register.text).toContain("Expires in 10 minutes · Works once");
    expect(register.text).toContain("HX AI will never ask you for this code.");
    expect(register.text).toContain("Time: 12 Nov 2026, 05:20 UTC");
    expect(register.html).toContain('<html lang="en">');
    expect(register.html).toContain("https://bot.hxallai.com/en/privacy/");
    expect(reset.text).toContain("Expires in 1 minute · Works once");
    expect(reset.text).toContain("your password stays the same");
    // Not one Chinese character, in the text or the HTML.
    expect(`${register.subject}${register.text}${register.html}${reset.text}${reset.html}`).not.toMatch(
      /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/u,
    );
    expect(HX_MAIL_SENDER).toBe("HXBot");
  });

  it("sends the giraffe inside the message, from HXBot", async () => {
    const written: string[] = [];
    const replies = [
      "220 ready",
      "250-mail.example.com",
      "250 AUTH PLAIN LOGIN",
      "235 ok",
      "250 ok",
      "250 ok",
      "354 go on",
      "250 queued",
      "221 bye",
    ];
    const connector: SmtpConnector = () => ({
      opened: Promise.resolve(),
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`${replies.join("\r\n")}\r\n`));
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write(chunk) {
          written.push(new TextDecoder().decode(chunk));
        },
      }),
      close: () => undefined,
    });
    const mailbox = {
      host: "smtp.example.com",
      port: 465,
      username: "bot@example.com",
      password: "x",
      from: "bot@example.com",
    };
    await Effect.runPromise(
      sendPrivateEmail(
        mailbox,
        {
          email: "ming@example.org",
          fromName: HX_MAIL_SENDER,
          content: hxCodeEmail("048213", "register", 10, "en", "ming@example.org"),
          inline: [HX_MAIL_LOGO],
        },
        connector,
      ),
    );
    const message = written.join("");
    expect(message).toContain("From: HXBot <bot@example.com>");
    expect(message).toMatch(
      /Content-Type: multipart\/related;\r\n type="multipart\/alternative";\r\n boundary="hxbot-related-/u,
    );
    expect(message).toContain("Content-ID: <hxbot-giraffe@bot.hxallai.com>");
    expect(message).toContain('Content-Disposition: inline; filename="hxbot.png"');
    // Base64 in lines of 76 characters, the PNG signature first.
    expect(message).toContain(`\r\n${HX_MAIL_LOGO.base64.slice(0, 76)}\r\n`);
    expect(HX_MAIL_LOGO.base64.startsWith("iVBORw0KGgo")).toBe(true);
  });

  it("sends the code in the language of the page it was asked for on", async () => {
    const w = world();
    await w.accounts.startRegistration({ email: "a@example.com", phone: "13800138000", lang: "en" }, IP);
    expect(w.emails.at(-1)).toMatchObject({ email: "a@example.com", purpose: "register", lang: "en" });
    await w.accounts.startRegistration({ email: "b@example.com", phone: "13800138001" }, IP);
    expect(w.emails.at(-1)).toMatchObject({ email: "b@example.com", lang: "zh" });
    await w.accounts.startRegistration({ email: "c@example.com", phone: "13800138002", lang: "fr" }, IP);
    expect(w.emails.at(-1)).toMatchObject({ email: "c@example.com", lang: "zh" });
  });

  it("is told apart by the registration and the reset", async () => {
    const w = world();
    await w.accounts.startRegistration({ email: "new@example.com", phone: "13800138000" }, IP);
    expect(w.emails.at(-1)).toMatchObject({ email: "new@example.com", purpose: "register" });
  });
});

describe("the SMS code", () => {
  const sms = {
    accessKeyId: "LTAI-test",
    accessKeySecret: "secret-1",
    signName: "弘犀智能",
    templateCode: "SMS_123456789",
  };

  it("is a signed SendSms call", async () => {
    const request = await hxAliyunSmsRequest(sms, "+8613800138000", "246810", START, "nonce-1");
    const { Signature = "", ...values } = request;
    expect(values).toEqual({
      AccessKeyId: "LTAI-test",
      Action: "SendSms",
      Format: "JSON",
      PhoneNumbers: "13800138000",
      RegionId: "cn-hangzhou",
      SignName: "弘犀智能",
      SignatureMethod: "HMAC-SHA1",
      SignatureNonce: "nonce-1",
      SignatureVersion: "1.0",
      TemplateCode: "SMS_123456789",
      TemplateParam: '{"code":"246810"}',
      Timestamp: "2026-11-11T08:00:00Z",
      Version: "2017-05-25",
    });
    // The same signature worked out the long way: each name and value percent-encoded, the pairs sorted and joined.
    const encode = (value: string) =>
      encodeURIComponent(value).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    const canonical = Object.keys(values)
      .sort()
      .map((name) => `${encode(name)}=${encode(values[name] ?? "")}`)
      .join("&");
    expect(canonical).toContain("SignName=%E5%BC%98%E7%8A%80%E6%99%BA%E8%83%BD");
    expect(canonical).toContain("TemplateParam=%7B%22code%22%3A%22246810%22%7D");
    expect(canonical).toContain("Timestamp=2026-11-11T08%3A00%3A00Z");
    expect(Signature).toBe(
      createHmac("sha1", "secret-1&")
        .update(`POST&%2F&${encode(canonical)}`)
        .digest("base64"),
    );
  });

  it("reports what the SMS service answers", async () => {
    const send = (answer: DynamicRecord) =>
      refusal(hxSendSmsCode(sms, "+8613800138000", "246810", async () => new Response(JSON.stringify(answer)), START));
    expect(await send({ Code: "OK", Message: "OK" })).toBe("no refusal");
    expect(await send({ Code: "isv.BUSINESS_LIMIT_CONTROL", Message: "触发分钟级流控" })).toBe("sms_limited");
    expect(await send({ Code: "isv.MOBILE_NUMBER_ILLEGAL", Message: "号码格式非法" })).toBe("invalid_phone");
    expect(await send({ Code: "isv.SMS_SIGNATURE_ILLEGAL", Message: "签名不合法" })).toBe("sms_failed");
    expect(
      await refusal(hxSendSmsCode(sms, "+8613800138000", "1", async () => Promise.reject(new Error("offline")), START)),
    ).toBe("sms_failed");
  });
});

describe("the browser operations", () => {
  const ORIGIN = "https://bot.hxallai.com";

  function http(
    w: World,
    fetcher: HxFetch = async () => new Response("{}"),
    signedIn: HxSignedInUser | null = null,
    removed: string[] = [],
  ) {
    return {
      accounts: w.accounts,
      config: w.config,
      fetcher,
      now: () => w.clock.now,
      sourceIp: () => IP,
      signedIn: async () => signedIn,
      removeAvatar: async (user: HxSignedInUser) => {
        removed.push(user.id);
      },
    };
  }

  function post(path: string, body: DynamicRecord, headers: Readonly<{ [name: string]: string }> = {}) {
    return new Request(`${ORIGIN}/api/browser/hx/${path}`, {
      method: "POST",
      headers: { Origin: ORIGIN, "X-HXBot-Browser": "1", "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("deletes the account of the person signed in, from the portal or from an app", async () => {
    const w = world();
    await register(w);
    const user = { id: "00000000-0000-4000-8000-000000000002", email: "ming@example.org", avatarUrl: null };
    const removed: string[] = [];
    const ask = (request: Request, signedIn: HxSignedInUser | null) =>
      handleHxAccounts(request, "account/delete", http(w, undefined, signedIn, removed));
    // Signed out, or a page of another site with the cookie: refused.
    expect((await ask(post("account/delete", { confirm: PROFILE.password }), null))?.status).toBe(401);
    const elsewhere = post("account/delete", { confirm: PROFILE.password }, { Origin: "https://other.example" });
    expect((await ask(elsewhere, user))?.status).toBe(403);
    const wrong = await ask(post("account/delete", { confirm: "nope" }), user);
    expect(wrong?.status).toBe(401);
    expect(await wrong?.json()).toMatchObject({ error: { code: "incorrect_password" } });
    // An app sends its token and no Origin.
    const app = new Request("https://api.bot.hxallai.com/api/browser/hx/account/delete", {
      method: "POST",
      headers: { Authorization: "Bearer app-session-token", "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: PROFILE.password }),
    });
    const done = await ask(app, user);
    expect(done?.status).toBe(200);
    expect(await done?.json()).toEqual({ deleted: true });
    expect(done?.headers.get("Set-Cookie")).toContain("__Host-hxbot-web=; Path=/");
    expect(removed).toEqual([user.id]);
    expect(await w.store.account("ming@example.org")).toBeNull();
  });

  it("tells nginx whether a request is signed in, for the update files", async () => {
    const w = world();
    const user = { id: "00000000-0000-4000-8000-000000000003", email: "ming@example.org", avatarUrl: null };
    const get = new Request("https://bot.hxallai.com/api/browser/hx/signed-in", {
      headers: { Authorization: "Bearer t" },
    });
    expect((await handleHxAccounts(get, "signed-in", http(w, undefined, user)))?.status).toBe(204);
    expect((await handleHxAccounts(get, "signed-in", http(w, undefined, null)))?.status).toBe(401);
  });

  it("answers the pages and refuses a write from another site", async () => {
    const w = world(PROVIDERS);
    const settings = await handleHxAccounts(new Request(`${ORIGIN}/api/browser/hx/settings`), "settings", http(w));
    expect(await settings?.json()).toMatchObject({
      emailCode: true,
      phoneCode: true,
      providers: ["wechat", "douyin", "google", "facebook"],
    });
    expect(settings?.headers.get("Cache-Control")).toBe("no-store");
    const started = await handleHxAccounts(
      post("register/start", { email: "a@example.org", phone: "13800138001" }),
      "register/start",
      http(w),
    );
    expect(started?.status).toBe(200);
    expect(await started?.json()).toMatchObject({ emailCode: true, phoneCode: true });
    const fromElsewhere: Readonly<{ [name: string]: string }>[] = [
      { Origin: "https://evil.example" },
      { "X-HXBot-Browser": "0" },
      { "Content-Type": "text/plain" },
      { "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of fromElsewhere) {
      const refused = await handleHxAccounts(
        post("register/start", { email: "b@example.org", phone: "13800138002" }, headers),
        "register/start",
        http(w),
      );
      expect(refused?.status).toBe(403);
    }
    const again = await handleHxAccounts(
      post("register/start", { email: "a@example.org", phone: "13800138001" }),
      "register/start",
      http(w),
    );
    expect(again?.status).toBe(429);
    expect(Number(again?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await again?.json()).toMatchObject({ error: { code: "code_recently_sent" } });
    const broken = new Request(`${ORIGIN}/api/browser/hx/register/start`, {
      method: "POST",
      headers: { Origin: ORIGIN, "X-HXBot-Browser": "1", "Content-Type": "application/json" },
      body: "[1",
    });
    expect((await handleHxAccounts(broken, "register/start", http(w)))?.status).toBe(400);
    expect(await handleHxAccounts(new Request(`${ORIGIN}/api/browser/hx/nothing`), "nothing", http(w))).toBeNull();
  });

  it("takes the browser to a provider and back, for a new and for a linked account", async () => {
    const w = world(PROVIDERS);
    const { fetcher } = answers({
      "api.weixin.qq.com/sns/oauth2/access_token": () => ({ access_token: "w", openid: "open-1", unionid: "union-1" }),
    });
    const leave = async () => {
      const response = await handleHxAccounts(
        new Request(`${ORIGIN}/api/browser/hx/oauth/wechat/start`),
        "oauth/wechat/start",
        http(w, fetcher),
      );
      const location = new URL(response?.headers.get("Location") ?? "");
      const cookie = (response?.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
      expect(response?.status).toBe(302);
      expect(location.host).toBe("open.weixin.qq.com");
      expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/browser/hx/oauth/wechat/callback`);
      expect(response?.headers.get("Set-Cookie")).toContain("HttpOnly; Secure; SameSite=Lax; Max-Age=600");
      return { state: location.searchParams.get("state") ?? "", cookie };
    };
    const back = async (query: string, cookie: string) => {
      const response = await handleHxAccounts(
        new Request(`${ORIGIN}/api/browser/hx/oauth/wechat/callback?${query}`, { headers: { Cookie: cookie } }),
        "oauth/wechat/callback",
        http(w, fetcher),
      );
      expect(response?.status).toBe(303);
      expect(response?.headers.get("Set-Cookie")).toContain("hx_oauth=;");
      // The way back names the path only: a full address of this host would be rewritten to plain HTTP by the
      // local proxy in front of the account service (see `outside` in http.ts).
      const location = response?.headers.get("Location") ?? "";
      expect(location.startsWith("/#")).toBe(true);
      return new URL(location, ORIGIN);
    };

    const first = await leave();
    // Another browser, without the cookie, cannot finish it.
    expect((await back(`code=c1&state=${first.state}`, "hx_oauth=someone-else")).hash).toBe(
      "#hx-error=identity_expired",
    );
    const home = await back(`code=c1&state=${first.state}`, first.cookie);
    expect(home.origin + home.pathname).toBe(`${ORIGIN}/`);
    const fragment = new URLSearchParams(home.hash.slice(1));
    expect(fragment.get("provider")).toBe("wechat");
    const identity = fragment.get("hx-identity") ?? "";
    expect(identity).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    // The state is spent.
    expect((await back(`code=c1&state=${first.state}`, first.cookie)).hash).toBe("#hx-error=identity_expired");

    const started = await w.accounts.startRegistration(
      { email: "ming@example.org", phone: "13800138000", identity },
      IP,
    );
    await w.accounts.finishRegistration(
      { registrationId: started.registrationId, emailCode: w.emails[0]?.code, phoneCode: w.texts[0]?.code, ...PROFILE },
      IP,
    );
    const second = await leave();
    const signedIn = await back(`code=c2&state=${second.state}`, second.cookie);
    const [challengeId = "", code = ""] = signedIn.hash.replace("#hx-signin=", "").split(".");
    expect(await ticketSignIn(w, { challengeId, code })).toBe("signed in as ming@example.org (王小明)");
    expect(await hxSha256(challengeId)).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const third = await leave();
    expect((await back(`state=${third.state}`, third.cookie)).hash).toBe("#hx-error=cancelled");
    const off = await handleHxAccounts(
      new Request(`${ORIGIN}/api/browser/hx/oauth/alipay/start`),
      "oauth/alipay/start",
      http(w),
    );
    expect(off?.status).toBe(404);
    expect(
      await handleHxAccounts(new Request(`${ORIGIN}/api/browser/hx/oauth/qq/start`), "oauth/qq/start", http(w)),
    ).toBeNull();
  });

  it("turns Apple's posted form into a request that carries the cookie", async () => {
    const w = world({
      HX_APPLE_SERVICE_ID: "s",
      HX_APPLE_TEAM_ID: "t",
      HX_APPLE_KEY_ID: "k",
      HX_APPLE_PRIVATE_KEY: "p",
    });
    const posted = new Request(`${ORIGIN}/api/browser/hx/oauth/apple/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://appleid.apple.com" },
      body: "code=apple-code&state=state-9&user=%7B%22name%22%3A%7B%7D%7D",
    });
    const response = await handleHxAccounts(posted, "oauth/apple/callback", http(w));
    expect(response?.status).toBe(303);
    // The path only, so the code never travels in plain HTTP (see `outside` in http.ts).
    expect(response?.headers.get("Location")).toBe(
      "/api/browser/hx/oauth/apple/callback?code=apple-code&state=state-9",
    );
  });
});
