// HXBot：强制更新（v1.6.2）。过期的桌面端和手机端被要求更新；升级时所有登录失效一次（迁移 9003）。
import { describe, expect, it } from "vitest";
import {
  HX_CLIENT_HEADER,
  HX_MINIMUM_CLIENT_VERSIONS,
  hxClientGate,
  hxOlderThan,
  hxParseClient,
} from "../src/server/hx-client-version";
import { migratedDatabase, migration } from "./sqlite-d1";

const API = "https://api.bot.hxallai.com";

function post(path: string, client?: string): Request {
  return new Request(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(client ? { [HX_CLIENT_HEADER]: client } : {}) },
    body: "{}",
  });
}

function get(path: string, client?: string): Request {
  return new Request(`${API}${path}`, { headers: client ? { [HX_CLIENT_HEADER]: client } : {} });
}

describe("the client header", () => {
  it("reads the app and its version", () => {
    expect(hxParseClient("desktop/0.67.1")).toEqual({ kind: "desktop", platform: "desktop", version: "0.67.1" });
    expect(hxParseClient(" Android/1.5.0 ")).toEqual({ kind: "mobile", platform: "android", version: "1.5.0" });
    expect(hxParseClient("ios/1.5")).toEqual({ kind: "mobile", platform: "ios", version: "1.5" });
    expect(hxParseClient("desktop/latest")).toBeNull();
    expect(hxParseClient("web/1.0.0")).toBeNull();
    expect(hxParseClient(null)).toBeNull();
  });

  it("compares versions part by part", () => {
    expect(hxOlderThan("0.67.0", "0.67.1")).toBe(true);
    expect(hxOlderThan("0.67.1", "0.67.1")).toBe(false);
    expect(hxOlderThan("0.67.10", "0.67.9")).toBe(false);
    expect(hxOlderThan("0.68", "0.67.1")).toBe(false);
    expect(hxOlderThan("1.4.9", "1.5.0")).toBe(true);
    expect(hxOlderThan("1.5", "1.5.0")).toBe(false);
  });

  it("names the versions this server was built with", () => {
    expect(HX_MINIMUM_CLIENT_VERSIONS.desktop).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(HX_MINIMUM_CLIENT_VERSIONS.mobile).toMatch(/^\d+\.\d+\.\d+$/u);
  });
});

describe("the gate", () => {
  const minimum = { desktop: "0.67.1", mobile: "1.5.0" } as const;

  it("lets the current apps and newer ones through", () => {
    expect(hxClientGate(post("/v1/auth/email/start", "desktop/0.67.1"), minimum)).toBeNull();
    expect(hxClientGate(post("/v1/auth/email/start", "desktop/0.68.0"), minimum)).toBeNull();
    expect(hxClientGate(post("/v1/mobile-auth/email/verify", "android/1.5.0"), minimum)).toBeNull();
    expect(hxClientGate(get("/v1/mobile-auth/devices", "ios/1.6.0"), minimum)).toBeNull();
  });

  it("tells an outdated app to update, on every request", async () => {
    const response = hxClientGate(get("/v1/auth/me", "desktop/0.67.0"), minimum);
    expect(response?.status).toBe(426);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    const body = await response?.json();
    expect(body).toMatchObject({ error: { code: "client_outdated" } });
    expect(JSON.stringify(body)).toContain("bot.hxallai.com");
    expect(hxClientGate(post("/v1/mobile-auth/redeem", "android/1.4.9"), minimum)?.status).toBe(426);
  });

  it("does not let an app without the header sign in", () => {
    for (const path of [
      "/v1/auth/email/start",
      "/v1/auth/email/verify",
      "/v1/auth/company/start",
      "/v1/auth/company/exchange",
      "/v1/mobile-auth/email/verify",
      "/v1/mobile-auth/redeem",
      "/v1/team-auth/redeem",
    ])
      expect(hxClientGate(post(path), minimum)?.status).toBe(426);
    // A browser and the other pages go on: the portal signs in elsewhere.
    expect(hxClientGate(get("/v1/auth/email/start"), minimum)).toBeNull();
    expect(hxClientGate(post("/api/browser/hx/sign-in"), minimum)).toBeNull();
    expect(hxClientGate(get("/"), minimum)).toBeNull();
  });

  it("lets an outdated app sign out, delete its account and fetch the update", () => {
    expect(hxClientGate(post("/v1/auth/logout", "desktop/0.60.0"), minimum)).toBeNull();
    expect(hxClientGate(get("/api/browser/hx/signed-in", "android/1.0.0"), minimum)).toBeNull();
    expect(hxClientGate(post("/api/browser/hx/account/delete", "ios/1.0.0"), minimum)).toBeNull();
    expect(hxClientGate(get("/health", "desktop/0.1.0"), minimum)).toBeNull();
  });
});

describe("the upgrade", () => {
  it("ends every sign-in once, so an old app must sign in again", () => {
    const database = migratedDatabase("9002_hx_unique_phone.sql");
    database
      .prepare("INSERT INTO users (id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("u1", "email:a@example.com", "a@example.com", 1, 1);
    const session = database.prepare(
      "INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    session.run("s1", "u1", "h1", 9_999_999_999_999, 1, 1, null);
    session.run("s2", "u1", "h2", 9_999_999_999_999, 1, 1, 5);
    database.exec(migration("9003_hx_sign_in_again.sql"));
    const rows = database.prepare("SELECT id, revoked_at FROM auth_sessions ORDER BY id").all();
    expect(rows[0]?.revoked_at).toEqual(expect.any(Number));
    expect(Number(rows[0]?.revoked_at)).toBeGreaterThan(1_700_000_000_000);
    // One that had ended keeps its time.
    expect(rows[1]?.revoked_at).toBe(5);
  });
});
