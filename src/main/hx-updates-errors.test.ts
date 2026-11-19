// HXBot（v1.7.3 紧急修正）：检查更新失败时说清原因，网络和登录失效能自己恢复（hx-updates.ts、update-service.ts）。
//
// 用户 2026-11-19 在 0.67.12 上看到“无法检查更新，请重试”：服务器上没有 updates/desktop/latest-mac.yml（404），
// Mac 版把 404、401、500、断网都显示成这一句。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceText } from "@hxbot/i18n/source";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  HX_UPDATE_SIGNED_OUT,
  type HxFetch,
  HxMacUpdateAdapter,
  HxUpdateRequestError,
  hxAuthorizedUpdater,
  hxUpdateStatusCode,
} from "./hx-updates";
import { type UpdateAdapter, UpdateService } from "./update-service";

const FEED = `version: 0.67.13
files:
  - url: HXBot-0.67.13-arm64.zip
    sha512: c2hh
    size: 3
path: HXBot-0.67.13-arm64.zip
sha512: c2hh
releaseDate: '2026-11-19T10:00:00.000Z'
`;

const folders: string[] = [];
afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

type Seen = { url: string; headers: Record<string, string>; via: "fetch" | "net" };

function adapter(options: {
  answers?: (Response | Error)[];
  netAnswers?: (Response | Error)[];
  token?: () => string | null;
  refresh?: () => Promise<void>;
  noNet?: boolean;
}) {
  const cache = mkdtempSync(join(tmpdir(), "hx-update-errors-"));
  folders.push(cache);
  const seen: Seen[] = [];
  const answer = (list: (Response | Error)[] | undefined, via: Seen["via"]): HxFetch => {
    return async (url, init) => {
      seen.push({ url: url.pathname, headers: { ...init.headers }, via });
      const next = list?.shift() ?? new Response("no answer left", { status: 599 });
      if (next instanceof Error) throw next;
      return next;
    };
  };
  const mac = new HxMacUpdateAdapter({
    feedUrl: "https://bot.hxallai.com/updates/desktop/",
    currentVersion: "0.67.12",
    arch: "arm64",
    sessionToken: options.token ?? (() => "session-1"),
    cacheDirectory: cache,
    executablePath: "/Applications/HXBot.app/Contents/MacOS/HXBot",
    logPath: join(cache, "install.log"),
    pid: 1,
    quit: () => undefined,
    fetch: answer(options.answers, "fetch"),
    ...(options.noNet ? {} : { netFetch: answer(options.netAnswers, "net") }),
    ...(options.refresh ? { refreshSession: options.refresh } : {}),
  });
  return { mac, seen };
}

/** What fetch throws when the request never reached the server, as Node's fetch does. */
function networkFailure(code: string): Error {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error(`getaddrinfo ${code} bot.hxallai.com`), { code }),
  });
}

async function rejection(promise: Promise<unknown>): Promise<HxUpdateRequestError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HxUpdateRequestError) return error;
    throw error;
  }
  throw new Error("The promise did not reject.");
}

describe("the macOS adapter tells why a check failed", () => {
  it("names a feed that the server does not have (404): the update files were not uploaded", async () => {
    const { mac, seen } = adapter({ answers: [new Response("<html>404 Not Found</html>", { status: 404 })] });
    const error = await rejection(mac.checkForUpdates());
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe("ERR_UPDATER_CHANNEL_FILE_NOT_FOUND");
    expect(error.message).toContain("404");
    expect(error.message).toContain("/updates/desktop/latest-mac.yml");
    // Only the one request: a 404 is an answer, not a network failure.
    expect(seen.map((entry) => entry.via)).toEqual(["fetch"]);
  });

  it("sends the app and its version with the session", async () => {
    const { mac, seen } = adapter({ answers: [new Response(FEED)] });
    await mac.checkForUpdates();
    expect(seen[0]?.headers).toEqual({
      Authorization: "Bearer session-1",
      "User-Agent": "HXBot/0.67.12 (Macintosh; arm64)",
      "X-HXBot-Client": "desktop/0.67.12",
    });
  });

  it("checks the sign-in once after a 401 and asks again with the session that the check leaves", async () => {
    let token = "old-session";
    let refreshes = 0;
    const { mac, seen } = adapter({
      answers: [new Response("{}", { status: 401 }), new Response(FEED)],
      token: () => token,
      refresh: async () => {
        refreshes += 1;
        token = "new-session";
      },
    });
    const outcome = await mac.checkForUpdates();
    expect(outcome).toMatchObject({ isUpdateAvailable: true, updateInfo: { version: "0.67.13" } });
    expect(refreshes).toBe(1);
    expect(seen.map((entry) => entry.headers.Authorization)).toEqual(["Bearer old-session", "Bearer new-session"]);
  });

  it("says that the sign-in was refused when it is refused again, or when the check signed the user out", async () => {
    const twice = adapter({
      answers: [new Response("{}", { status: 403 }), new Response("{}", { status: 403 })],
      refresh: async () => undefined,
    });
    const refused = await rejection(twice.mac.checkForUpdates());
    expect(refused.code).toBe(HX_UPDATE_SIGNED_OUT);
    expect(refused.statusCode).toBe(403);

    let token: string | null = "session-1";
    const signedOut = adapter({
      answers: [new Response("{}", { status: 401 })],
      token: () => token,
      refresh: async () => {
        token = null;
      },
    });
    const gone = await rejection(signedOut.mac.checkForUpdates());
    expect(gone.code).toBe(HX_UPDATE_SIGNED_OUT);
    expect(signedOut.seen).toHaveLength(1);
  });

  it("does not stop the check when the sign-in check itself fails", async () => {
    const { mac } = adapter({
      answers: [new Response("{}", { status: 401 }), new Response(FEED)],
      refresh: async () => {
        throw new Error("account service down");
      },
    });
    await expect(mac.checkForUpdates()).resolves.toMatchObject({ isUpdateAvailable: true });
  });

  it("goes once more through Electron's network when fetch does not reach the server", async () => {
    const { mac, seen } = adapter({ answers: [networkFailure("ECONNREFUSED")], netAnswers: [new Response(FEED)] });
    await expect(mac.checkForUpdates()).resolves.toMatchObject({ isUpdateAvailable: true });
    expect(seen.map((entry) => entry.via)).toEqual(["fetch", "net"]);
    expect(seen[1]?.headers.Authorization).toBe("Bearer session-1");
  });

  it("names the network failure when neither network reaches the server", async () => {
    const both = adapter({
      answers: [networkFailure("ENOTFOUND")],
      netAnswers: [new Error("net::ERR_NAME_NOT_RESOLVED")],
    });
    const error = await rejection(both.mac.checkForUpdates());
    expect(error.code).toBe("ENOTFOUND");
    expect(error.statusCode).toBeUndefined();
    expect(error.message).toContain("ENOTFOUND");
    expect(error.message).toContain("ERR_NAME_NOT_RESOLVED");

    const fetchOnly = adapter({ answers: [networkFailure("ETIMEDOUT")], noNet: true });
    expect((await rejection(fetchOnly.mac.checkForUpdates())).code).toBe("ETIMEDOUT");
  });

  it("names update information that it cannot read, such as a web page in place of the feed", async () => {
    const { mac } = adapter({ answers: [new Response("<!doctype html><title>HXBot</title>")] });
    const error = await rejection(mac.checkForUpdates());
    expect(error.code).toBe("ERR_UPDATER_INVALID_RELEASE_FEED");
  });

  it("names a ZIP that the server does not have", async () => {
    const { mac } = adapter({ answers: [new Response(FEED), new Response("gone", { status: 404 })] });
    await mac.checkForUpdates();
    const error = await rejection(mac.downloadUpdate());
    expect(error.statusCode).toBe(404);
    expect(error.message).toContain("/updates/desktop/HXBot-0.67.13-arm64.zip");
  });

  it("gives each status its code", () => {
    expect(hxUpdateStatusCode(404)).toBe("ERR_UPDATER_CHANNEL_FILE_NOT_FOUND");
    expect(hxUpdateStatusCode(401)).toBe(HX_UPDATE_SIGNED_OUT);
    expect(hxUpdateStatusCode(403)).toBe(HX_UPDATE_SIGNED_OUT);
    expect(hxUpdateStatusCode(502)).toBe("HTTP_ERROR_502");
  });
});

describe("electron-updater (Windows) after a refused session", () => {
  function windowsUpdater(failures: number, status = 401) {
    let calls = 0;
    const updater: UpdateAdapter = {
      allowPrerelease: false,
      autoDownload: false,
      autoInstallOnAppQuit: false,
      checkForUpdates: async () => {
        calls += 1;
        if (calls <= failures) throw Object.assign(new Error(`HttpError: ${status}`), { statusCode: status });
        return { isUpdateAvailable: false, updateInfo: { version: "0.67.12" } };
      },
      downloadUpdate: async () => [],
      on: () => undefined,
      quitAndInstall: () => undefined,
    };
    return { updater, calls: () => calls };
  }

  it("checks the sign-in once and asks again", async () => {
    const { updater, calls } = windowsUpdater(1);
    let refreshes = 0;
    const wrapped = hxAuthorizedUpdater(
      updater,
      () => "session-1",
      async () => {
        refreshes += 1;
      },
    );
    await expect(wrapped.checkForUpdates()).resolves.toMatchObject({ isUpdateAvailable: false });
    expect(refreshes).toBe(1);
    expect(calls()).toBe(2);
  });

  it("reports the second refusal, and does not retry other failures", async () => {
    const refused = windowsUpdater(2);
    const wrapped = hxAuthorizedUpdater(
      refused.updater,
      () => "session-1",
      async () => undefined,
    );
    await expect(wrapped.checkForUpdates()).rejects.toMatchObject({ statusCode: 401 });
    expect(refused.calls()).toBe(2);

    const broken = windowsUpdater(1, 500);
    let refreshes = 0;
    const plain = hxAuthorizedUpdater(
      broken.updater,
      () => "session-1",
      async () => {
        refreshes += 1;
      },
    );
    await expect(plain.checkForUpdates()).rejects.toMatchObject({ statusCode: 500 });
    expect(refreshes).toBe(0);
    expect(broken.calls()).toBe(1);
  });
});

describe("the message in Settings", () => {
  async function messageAfter(answers: (Response | Error)[], netAnswers: (Response | Error)[] = []) {
    const { mac } = adapter({ answers, netAnswers, refresh: async () => undefined });
    const service = new UpdateService(mac, {
      currentVersion: "0.67.12",
      enabled: true,
      autoDownload: false,
      beforeInstall: async () => undefined,
      platform: "darwin",
      initialCheckDelayMs: 60 * 60_000,
      checkIntervalMs: 60 * 60_000,
    });
    try {
      const status = await Effect.runPromise(service.checkForUpdates());
      return status.message;
    } finally {
      await Effect.runPromise(service.stop());
    }
  }

  it("says that no update is published when the server has no update files (404)", async () => {
    expect(await messageAfter([new Response("Not Found", { status: 404 })])).toBe(
      sourceText("error.update.checkNoRelease"),
    );
  });

  it("asks to sign in again when the server keeps refusing the session", async () => {
    expect(await messageAfter([new Response("{}", { status: 401 }), new Response("{}", { status: 401 })])).toBe(
      sourceText("error.update.checkSignedOut"),
    );
  });

  it("asks to check the network when no network reaches the server", async () => {
    expect(await messageAfter([networkFailure("ENOTFOUND")], [networkFailure("ENOTFOUND")])).toBe(
      sourceText("error.update.checkOffline"),
    );
  });

  it("says that the service will be asked again for a server error", async () => {
    expect(await messageAfter([new Response("oops", { status: 502 })])).toBe(
      sourceText("error.update.checkUnavailable"),
    );
  });

  it("says that no update is published for update information that it cannot read", async () => {
    expect(await messageAfter([new Response("<!doctype html>")])).toBe(sourceText("error.update.checkNoRelease"));
  });
});
