import { describe, expect, it } from "vitest";
import { HX_CLIENT_HEADER, hxAtMostEvery, hxClientFetch } from "./hx-client-header";

describe("hxClientFetch", () => {
  it("adds the client version to every request and keeps the other headers", async () => {
    const seen: Headers[] = [];
    const fetcher = hxClientFetch(async (_input, init) => {
      seen.push(new Headers(init?.headers));
      return new Response(null, { status: 204 });
    }, "0.67.1");
    await fetcher("https://api.example.com/v1/me", { headers: { Authorization: "Bearer token" } });
    await fetcher(
      new Request("https://api.example.com/v1/auth/email/start", { headers: { "Content-Type": "application/json" } }),
    );
    expect(seen[0]?.get(HX_CLIENT_HEADER)).toBe("desktop/0.67.1");
    expect(seen[0]?.get("Authorization")).toBe("Bearer token");
    expect(seen[1]?.get(HX_CLIENT_HEADER)).toBe("desktop/0.67.1");
    expect(seen[1]?.get("Content-Type")).toBe("application/json");
  });
});

describe("an outdated app", () => {
  it("looks for the new version when the account service refuses it", async () => {
    let checks = 0;
    let check: (() => void) | null = null;
    const answers = [204, 426, 426];
    const fetcher = hxClientFetch(
      async () => new Response(null, { status: answers.shift() ?? 204 }),
      "0.67.1",
      () => check,
    );
    // The updater is not there yet: nothing to call.
    await fetcher("https://api.example.com/v1/me");
    check = () => {
      checks += 1;
    };
    const refused = await fetcher("https://api.example.com/v1/me");
    expect(refused.status).toBe(426);
    await fetcher("https://api.example.com/v1/me");
    expect(checks).toBe(2);
  });

  it("checks at most once a minute", () => {
    let time = 0;
    let runs = 0;
    const run = hxAtMostEvery(
      60_000,
      () => {
        runs += 1;
      },
      () => time,
    );
    run();
    time = 30_000;
    run();
    time = 61_000;
    run();
    expect(runs).toBe(2);
  });
});
