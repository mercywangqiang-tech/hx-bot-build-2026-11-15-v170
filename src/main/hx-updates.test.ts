// HXBot: the updates inside the app (hx-updates.ts): the update information, the session on each request,
// the macOS adapter, and the script that replaces the application, run here with stand-ins for the macOS tools.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { HxPacer } from "./hx-network";
import {
  HX_MAC_INSTALL_SCRIPT,
  type HxFetch,
  HxMacUpdateAdapter,
  hxAppBundlePath,
  hxAuthorizedUpdater,
  hxBundleCanReplaceItself,
  hxIsNewerVersion,
  hxMacUpdateFile,
  hxPaceUpdater,
  hxUpdateFeedUrl,
  parseHxUpdateFeed,
} from "./hx-updates";
import type { UpdateAdapter } from "./update-service";

const folders: string[] = [];
function folder(): string {
  const path = mkdtempSync(join(tmpdir(), "hx-updates-"));
  folders.push(path);
  return path;
}
afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

const ZIP = Buffer.from("the zip of HXBot 0.67.2");
const ZIP_SHA = createHash("sha512").update(ZIP).digest("base64");
const MAC_FEED = `version: 0.67.2
files:
  - url: HXBot-0.67.2-arm64.zip
    sha512: ${ZIP_SHA}
    size: ${ZIP.length}
    blockMapSize: 1234
  - url: HXBot-0.67.2-arm64.dmg
    sha512: dmgsha==
    size: 99
path: HXBot-0.67.2-arm64.zip
sha512: ${ZIP_SHA}
releaseDate: '2026-11-13T08:00:00.000Z'
`;
// What electron-builder writes for releaseInfo.releaseNotes (js-yaml, one line, '' for a quote).
const NOTES_LINE = `releaseNotes: '{"version":"0.67.2","zh":["全新的界面样式：开关更清爽。","点“立即更新”就能装。"],"en":["It''s a fresh look: Settings › Access & activity."]}'`;

describe("the update information", () => {
  it("reads what electron-builder writes", () => {
    expect(parseHxUpdateFeed(MAC_FEED)).toEqual({
      version: "0.67.2",
      files: [
        { url: "HXBot-0.67.2-arm64.zip", sha512: ZIP_SHA, size: ZIP.length },
        { url: "HXBot-0.67.2-arm64.dmg", sha512: "dmgsha==", size: 99 },
      ],
      releaseDate: "2026-11-13T08:00:00.000Z",
      releaseNotes: null,
    });
    expect(parseHxUpdateFeed(`${MAC_FEED}${NOTES_LINE}\n`)?.releaseNotes).toBe(
      '{"version":"0.67.2","zh":["全新的界面样式：开关更清爽。","点“立即更新”就能装。"],"en":["It\'s a fresh look: Settings › Access & activity."]}',
    );
    expect(parseHxUpdateFeed(`${MAC_FEED}releaseNotes: "A \\"quoted\\" note"\n`)?.releaseNotes).toBe('A "quoted" note');
    expect(parseHxUpdateFeed("version: 0.67.2\n")).toBeNull();
    expect(parseHxUpdateFeed("<html>not found</html>")).toBeNull();
    const feed = parseHxUpdateFeed(MAC_FEED);
    expect(feed && hxMacUpdateFile(feed, "arm64")?.url).toBe("HXBot-0.67.2-arm64.zip");
  });

  it("compares versions by their numbers, digit by digit as the version rule counts", () => {
    expect(hxIsNewerVersion("0.67.2", "0.67.1")).toBe(true);
    expect(hxIsNewerVersion("0.68.0", "0.67.9")).toBe(true);
    expect(hxIsNewerVersion("0.67.10", "0.67.9")).toBe(true);
    expect(hxIsNewerVersion("0.67.1", "0.67.1")).toBe(false);
    expect(hxIsNewerVersion("0.67.0", "0.67.1")).toBe(false);
    expect(hxIsNewerVersion("garbage", "0.67.1")).toBe(false);
  });

  it("takes the feed from app-update.yml", () => {
    expect(
      hxUpdateFeedUrl(
        "provider: generic\nurl: https://bot.hxallai.com/updates/desktop\nupdaterCacheDirName: hxbot-updater\n",
      ),
    ).toBe("https://bot.hxallai.com/updates/desktop/");
    expect(hxUpdateFeedUrl("provider: github\nowner: x\n")).toBeNull();
  });

  it("finds the application bundle and refuses one that macOS runs from a copy", () => {
    expect(hxAppBundlePath("/Applications/HXBot.app/Contents/MacOS/HXBot")).toBe("/Applications/HXBot.app");
    expect(hxAppBundlePath("/usr/bin/node")).toBeNull();
    expect(hxBundleCanReplaceItself("/Applications/HXBot.app")).toBe(true);
    expect(hxBundleCanReplaceItself("/Volumes/HXBot/HXBot.app")).toBe(false);
    expect(hxBundleCanReplaceItself("/private/var/folders/x/AppTranslocation/1/d/HXBot.app")).toBe(false);
  });
});

/** electron-updater's updater as the wrapper sees it: the adapter and the headers it sends. */
interface HeaderUpdater extends UpdateAdapter {
  requestHeaders?: Record<string, string> | null;
}

describe("electron-updater with the session", () => {
  it("sends the session on each request and checks nothing signed out", async () => {
    const seen: (Record<string, string> | null)[] = [];
    const updater: HeaderUpdater = {
      allowPrerelease: false,
      autoDownload: false,
      autoInstallOnAppQuit: false,
      checkForUpdates: async () => {
        seen.push(updater.requestHeaders ?? null);
        return null;
      },
      downloadUpdate: async () => {
        seen.push(updater.requestHeaders ?? null);
        return [];
      },
      on: () => undefined,
      quitAndInstall: () => undefined,
    };
    let token: string | null = null;
    const wrapped = hxAuthorizedUpdater(updater, () => token);
    expect(await wrapped.checkForUpdates()).toBeNull();
    expect(seen).toEqual([]);
    token = "desktop-session";
    await wrapped.checkForUpdates();
    await wrapped.downloadUpdate();
    expect(seen).toEqual([{ Authorization: "Bearer desktop-session" }, { Authorization: "Bearer desktop-session" }]);
  });
});

function macAdapter(
  options: { token?: string | null; zip?: Buffer; quit?: () => void; spawned?: string[][]; waits?: number[] } = {},
) {
  const cache = folder();
  const requests: { url: string; authorization: string | null }[] = [];
  const fetcher: HxFetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, authorization: init.headers.Authorization ?? null });
    if (url.endsWith("latest-mac.yml")) return new Response(MAC_FEED);
    if (url.endsWith(".zip")) return new Response(new Uint8Array(options.zip ?? ZIP));
    return new Response("not found", { status: 404 });
  };
  const adapter = new HxMacUpdateAdapter({
    feedUrl: "https://bot.hxallai.com/updates/desktop/",
    currentVersion: "0.67.1",
    arch: "arm64",
    sessionToken: () => (options.token === undefined ? "desktop-session" : options.token),
    cacheDirectory: cache,
    executablePath: "/Applications/HXBot.app/Contents/MacOS/HXBot",
    logPath: join(cache, "install.log"),
    pid: 4242,
    quit: options.quit ?? (() => undefined),
    fetch: fetcher,
    spawnInstaller: (script, args) => options.spawned?.push([script, ...args]),
    ...(options.waits ? { bytesPerSecond: 1, wait: async (ms: number) => void options.waits?.push(ms) } : {}),
  });
  return { adapter, cache, requests };
}

describe("the macOS adapter", () => {
  it("finds the newer version, downloads and checks the ZIP, then hands it to the install script", async () => {
    const spawned: string[][] = [];
    let quits = 0;
    const { adapter, cache, requests } = macAdapter({ spawned, quit: () => quits++ });
    const events: string[] = [];
    for (const name of ["checking-for-update", "update-available", "download-progress", "update-downloaded"])
      adapter.on(name, () => events.push(name));
    const check = await adapter.checkForUpdates();
    expect(check).toMatchObject({ isUpdateAvailable: true, updateInfo: { version: "0.67.2" } });
    const [zip] = await adapter.downloadUpdate(check?.cancellationToken);
    expect(readFileSync(zip ?? "")).toEqual(ZIP);
    expect(events).toEqual(["checking-for-update", "update-available", "download-progress", "update-downloaded"]);
    expect(requests).toEqual([
      { url: "https://bot.hxallai.com/updates/desktop/latest-mac.yml", authorization: "Bearer desktop-session" },
      {
        url: "https://bot.hxallai.com/updates/desktop/HXBot-0.67.2-arm64.zip",
        authorization: "Bearer desktop-session",
      },
    ]);
    adapter.quitAndInstall();
    expect(spawned).toEqual([
      [join(cache, "install-update.sh"), "4242", zip ?? "", "/Applications/HXBot.app", join(cache, "install.log"), "1"],
    ]);
    expect(readFileSync(join(cache, "install-update.sh"), "utf8")).toBe(HX_MAC_INSTALL_SCRIPT);
    expect(quits).toBe(1);
  });

  it("keeps the download under its rate, so the user's own traffic keeps room (v1.7.0)", async () => {
    const waits: number[] = [];
    const { adapter } = macAdapter({ waits });
    await adapter.checkForUpdates();
    await adapter.downloadUpdate();
    // At one byte a second, the ZIP's bytes take at least that many seconds.
    expect(waits.length).toBeGreaterThan(0);
    expect(Math.max(...waits)).toBeGreaterThan(ZIP.length * 1000 - 5_000);
  });

  it("refuses a download that does not match, and asks nothing signed out", async () => {
    const { adapter } = macAdapter({ zip: Buffer.from("something else entirely") });
    await adapter.checkForUpdates();
    await expect(adapter.downloadUpdate()).rejects.toThrow("does not match");
    expect(() => adapter.quitAndInstall()).toThrow("not ready");
    const signedOut = macAdapter({ token: null });
    expect(await signedOut.adapter.checkForUpdates()).toBeNull();
    expect(signedOut.requests).toEqual([]);
  });
});

/** Stand-ins for the macOS tools the script uses: ditto (unzip), PlistBuddy, xattr, open. */
function macTools(root: string): { env: NodeJS.ProcessEnv; opened: string } {
  const bin = join(root, "bin");
  mkdirSync(bin);
  const opened = join(root, "opened.txt");
  const tool = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  tool("ditto", 'python3 -c "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$3" "$4"');
  tool("xattr", "exit 0");
  tool("open", `echo "$*" >> "${opened}"`);
  // PlistBuddy -c "Print :Key" file → the value of Key in a key=value file
  tool("PlistBuddy", 'key="$(echo "$2" | sed "s/^Print ://")"; sed -n "s/^$key=//p" "$3"');
  return {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HX_PLISTBUDDY: join(bin, "PlistBuddy") },
    opened,
  };
}

function bundle(path: string, id: string, version: string) {
  mkdirSync(join(path, "Contents", "MacOS"), { recursive: true });
  writeFileSync(
    join(path, "Contents", "Info.plist"),
    `CFBundleIdentifier=${id}\nCFBundleShortVersionString=${version}\n`,
  );
  writeFileSync(join(path, "Contents", "MacOS", "HXBot"), version);
}

function zipOf(source: string, zip: string) {
  execFileSync("python3", [
    "-c",
    "import os,sys,zipfile\nz=zipfile.ZipFile(sys.argv[2],'w')\nbase=os.path.dirname(sys.argv[1])\nfor d,_,fs in os.walk(sys.argv[1]):\n for f in fs:\n  p=os.path.join(d,f); z.write(p, os.path.relpath(p, base))\nz.close()",
    source,
    zip,
  ]);
}

describe("the install script", () => {
  function run(id: string, front?: string) {
    const root = folder();
    const { env, opened } = macTools(root);
    const app = join(root, "Applications", "HXBot.app");
    bundle(app, "com.hxallai.bot", "0.67.1");
    bundle(join(root, "new", "HXBot.app"), id, "0.67.2");
    const zip = join(root, "HXBot-0.67.2-arm64.zip");
    zipOf(join(root, "new", "HXBot.app"), zip);
    const script = join(root, "install-update.sh");
    writeFileSync(script, HX_MAC_INSTALL_SCRIPT);
    // A process that has already quit stands for HXBot.
    const gone = spawnSync("true").pid ?? 999_999;
    const args = [script, String(gone), zip, app, join(root, "logs", "install.log"), ...(front ? [front] : [])];
    const result = spawnSync("/bin/sh", args, { env });
    return {
      status: result.status,
      version: readFileSync(join(app, "Contents", "MacOS", "HXBot"), "utf8"),
      opened: existsSync(opened) ? readFileSync(opened, "utf8").trim().split("\n") : [],
      log: readFileSync(join(root, "logs", "install.log"), "utf8"),
      leftovers: existsSync(join(root, "Applications"))
        ? execFileSync("ls", [join(root, "Applications")], { encoding: "utf8" }).trim()
        : "",
      app,
      zip,
    };
  }

  it("replaces the application and opens it again", () => {
    const done = run("com.hxallai.bot");
    expect(done.status).toBe(0);
    expect(done.version).toBe("0.67.2");
    expect(done.leftovers).toBe("HXBot.app");
    expect(done.opened).toEqual([done.app]);
    expect(done.log).toContain("installed 0.67.2");
  });

  it("opens behind the user's app when the user worked in another app (v1.7.0)", () => {
    const done = run("com.hxallai.bot", "0");
    expect(done.status).toBe(0);
    expect(done.opened).toEqual([`-g ${done.app}`]);
  });

  it("keeps the application when the update is another application, and shows the ZIP", () => {
    const refused = run("com.example.other");
    expect(refused.status).toBe(1);
    expect(refused.version).toBe("0.67.1");
    expect(refused.opened).toEqual([`-R ${refused.zip}`, refused.app]);
    expect(refused.log).toContain("the update is a different application");
  });
});

describe("electron-updater downloads keep to the rate (v1.7.0)", () => {
  it("shares one budget, so parallel answers together keep to it", () => {
    let now = 0;
    const pacer = new HxPacer(1000, () => now);
    // The first quarter second goes at once, then each byte waits its share.
    expect(pacer.delay(250)).toBe(0);
    expect(pacer.delay(500)).toBe(500);
    now = 2000;
    expect(pacer.delay(100)).toBe(0);
  });

  it("hands every answer on paced, with its status and headers, and the whole body", async () => {
    const answers: string[] = [];
    const executor = {
      createRequest(
        _options: { headers?: Record<string, string> },
        callback: (response: Readable & { statusCode?: number }) => void,
      ) {
        callback(
          Object.assign(Readable.from([Buffer.from("abc"), Buffer.from("def")]), {
            statusCode: 206,
            headers: { a: "1" },
          }),
        );
        return {};
      },
    };
    expect(hxPaceUpdater({ httpExecutor: executor }, new HxPacer(1_000_000))).toBe(true);
    await new Promise<void>((done) => {
      executor.createRequest({}, (response) => {
        answers.push(`${response.statusCode}`);
        response.on("data", (chunk: Buffer) => answers.push(chunk.toString()));
        response.on("end", () => done());
      });
    });
    expect(answers).toEqual(["206", "abc", "def"]);
  });
});
