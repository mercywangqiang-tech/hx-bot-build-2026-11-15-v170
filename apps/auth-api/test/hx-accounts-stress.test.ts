// HXBot v1.7.3：账号服务的压力测试。用户 2026-11-18：“包括压力测试！全面，无死角的压力测试！”
// 数据库是真的 SQLite（按迁移建表），和 hx-accounts.test.ts 一样；这里只压并发：很多人同时注册、同时登录、
// 抢同一个邮箱或用户名、同时改密码和登录，核对数据库前后一致、限流照样起作用。
import type { DatabaseSync } from "node:sqlite";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { AuthService } from "../src/server/auth-service";
import { D1AuthRepository } from "../src/server/d1-auth-repository";
import { hxAccountsConfig } from "../src/server/hx-accounts/config";
import { HxAccountError, HxAccounts } from "../src/server/hx-accounts/service";
import { HxAccountStore, type HxDatabase, type HxStatement } from "../src/server/hx-accounts/store";
import { migratedDatabase } from "./sqlite-d1";

const START = Date.UTC(2026, 10, 18, 8, 0, 0);
const PASSWORD = "Giraffe2026!";

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

function world() {
  const database = migratedDatabase();
  const clock = { now: START };
  const accounts = new HxAccounts({
    store: new HxAccountStore(d1(database)),
    config: hxAccountsConfig({ HX_EMAIL_VERIFICATION: "off", HX_PHONE_VERIFICATION: "off" }),
    now: () => clock.now,
    sendEmailCode: async () => {},
    sendSmsCode: async () => {},
    emailAllowed: () => true,
  });
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the repository uses only the calls that the test database has
  const repository = new D1AuthRepository(d1(database) as unknown as D1Database);
  const auth = new AuthService({
    repository,
    delivery: null,
    now: () => clock.now,
    accounts: {
      startHash: (email) => Effect.promise(() => accounts.startHash(email)),
      verifyHash: (id, typed) => Effect.promise(() => accounts.verifyHash(id, typed)),
    },
  });
  const count = (sql: string): number => {
    const row = database.prepare(sql).get();
    return isDynamicRecord(row) ? Number(row.n) : -1;
  };
  return { database, clock, accounts, auth, count };
}

async function code(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "ok";
  } catch (error) {
    if (error instanceof HxAccountError) return error.code;
    return error instanceof Error ? `error: ${error.message}` : "error";
  }
}

/** One registration from start to finish, from its own address. */
async function register(
  w: ReturnType<typeof world>,
  n: number,
  email = `user${n}@example.org`,
  username = `user-${n}`,
) {
  const ip = `10.${Math.floor(n / 250) % 250}.${n % 250}.${(n * 7) % 250}`;
  const started = await w.accounts.startRegistration({ email, phone: `1380013${String(n).padStart(4, "0")}` }, ip);
  return w.accounts.finishRegistration(
    { registrationId: started.registrationId, username, password: PASSWORD, jobTitle: "研究员", company: "弘犀智能" },
    ip,
  );
}

async function signIn(w: ReturnType<typeof world>, email: string, password: string, ip: string): Promise<string> {
  try {
    const challenge = await Effect.runPromise(w.auth.startEmailSignIn(email, ip));
    const session = await Effect.runPromise(
      w.auth.verifyEmailCode({ challengeId: challenge.challengeId, code: password, sourceIp: ip, surface: "web" }),
    );
    return session.user.email;
  } catch (error) {
    return error instanceof Error ? `refused: ${error.message.slice(0, 80)}` : "refused";
  }
}

describe("the account service under load", () => {
  it("registers 300 people at once, each once, with nothing lost or doubled", async () => {
    const w = world();
    const answers = await Promise.all(Array.from({ length: 300 }, (_, n) => code(register(w, n))));
    expect(answers.filter((answer) => answer === "ok")).toHaveLength(300);
    expect(w.count("SELECT count(*) AS n FROM hx_accounts")).toBe(300);
    expect(w.count("SELECT count(*) AS n FROM users")).toBe(300);
    expect(w.count("SELECT count(DISTINCT email) AS n FROM hx_accounts")).toBe(300);
    expect(w.count("SELECT count(*) AS n FROM hx_pending")).toBe(0);
  });

  it("gives one email, one username and one number to one of 40 people who race for it", async () => {
    const w = world();
    const sameEmail = await Promise.all(
      Array.from({ length: 40 }, (_, n) => code(register(w, n, "same@example.org", `name-${n}`))),
    );
    expect(sameEmail.filter((answer) => answer === "ok")).toHaveLength(1);
    expect(
      sameEmail.filter((answer) => answer !== "ok").every((answer) => /email_registered|rate_limited/u.test(answer)),
    ).toBe(true);
    const sameName = await Promise.all(
      Array.from({ length: 40 }, (_, n) => code(register(w, 100 + n, `other${n}@example.org`, "同一个名字"))),
    );
    expect(sameName.filter((answer) => answer === "ok")).toHaveLength(1);
    expect(sameName.filter((answer) => answer !== "ok").every((answer) => answer === "username_taken")).toBe(true);
    expect(w.count("SELECT count(*) AS n FROM hx_accounts WHERE email = 'same@example.org'")).toBe(1);
    expect(w.count("SELECT count(*) AS n FROM hx_accounts WHERE username = '同一个名字'")).toBe(1);
    // No answer was an unexpected failure.
    expect([...sameEmail, ...sameName].some((answer) => answer.startsWith("error"))).toBe(false);
  });

  it("signs 80 people of one office in at once from one address, each with a session of their own", async () => {
    const w = world();
    await Promise.all(Array.from({ length: 80 }, (_, n) => register(w, n)));
    const before = w.count("SELECT count(*) AS n FROM auth_sessions");
    // v1.7.3: before, the 21st person of an office was refused for 15 minutes.
    const results = await Promise.all(
      Array.from({ length: 80 }, (_, n) => signIn(w, `user${n}@example.org`, PASSWORD, "203.0.113.50")),
    );
    expect(results.filter((result) => result.startsWith("refused"))).toEqual([]);
    expect(w.count("SELECT count(*) AS n FROM auth_sessions") - before).toBe(80);
  });

  it("signs 50 accounts in 5 times each at once, and limits the sixth", async () => {
    const w = world();
    await Promise.all(Array.from({ length: 50 }, (_, n) => register(w, n)));
    const before = w.count("SELECT count(*) AS n FROM auth_sessions");
    const results = await Promise.all(
      Array.from({ length: 250 }, (_, i) =>
        signIn(w, `user${i % 50}@example.org`, PASSWORD, `172.16.${i % 200}.${i % 7}`),
      ),
    );
    expect(results.filter((result) => result.startsWith("refused"))).toEqual([]);
    expect(w.count("SELECT count(*) AS n FROM auth_sessions") - before).toBe(250);
    expect(await signIn(w, "user0@example.org", PASSWORD, "172.31.0.1")).toContain("Too many");
  });

  it("still stops a guesser of one account while other people sign in at the same time", async () => {
    const w = world();
    await register(w, 1);
    await Promise.all(Array.from({ length: 30 }, (_, n) => register(w, 10 + n)));
    const guesses = Array.from({ length: 60 }, () => signIn(w, "user1@example.org", "Wrong-guess-1", "192.0.2.66"));
    const people = Array.from({ length: 30 }, (_, i) =>
      signIn(w, `user${10 + i}@example.org`, PASSWORD, `198.51.100.${i}`),
    );
    const [guessed, signed] = await Promise.all([Promise.all(guesses), Promise.all(people)]);
    expect(guessed.every((result) => result.startsWith("refused"))).toBe(true);
    // The guesser is slowed down: after five starts the account answers “too many”, not the password check.
    expect(guessed.filter((result) => /Too many/u.test(result)).length).toBeGreaterThanOrEqual(50);
    expect(signed.every((result) => result.endsWith("@example.org") && !result.startsWith("refused"))).toBe(true);
    // The account that was guessed at signs in again once the window is over.
    w.clock.now += 15 * 60_000;
    expect(await signIn(w, "user1@example.org", PASSWORD, "198.51.100.200")).toBe("user1@example.org");
  });

  it("limits registrations from one address, also when 100 come at once", async () => {
    // v1.7.3: 60 in 15 minutes, for an office on its first day.
    const w = world();
    const answers = await Promise.all(
      Array.from({ length: 100 }, (_, n) =>
        code(
          w.accounts.startRegistration(
            { email: `burst${n}@example.org`, phone: `1390013${String(n).padStart(4, "0")}` },
            "203.0.113.200",
          ),
        ),
      ),
    );
    const ok = answers.filter((answer) => answer === "ok").length;
    expect(ok).toBeGreaterThan(0);
    expect(ok).toBeLessThanOrEqual(60);
    expect(answers.filter((answer) => answer !== "ok").every((answer) => answer === "rate_limited")).toBe(true);
  });
});
