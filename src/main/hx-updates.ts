import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmodSync, createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import { HX_UPDATE_BYTES_PER_SECOND, HxPacedStream, HxPacer } from "./hx-network";
import type { UpdateAdapter, UpdateCancellationToken, UpdateCheckOutcome } from "./update-service";

/**
 * HXBot: updates inside the app. The update files are on the HXBot server, under /updates/desktop/, and
 * the server hands them out only to a signed-in client: each request carries the HXBot session as a
 * bearer token, which nginx checks with the account service. Windows and Linux use electron-updater,
 * which downloads only the changed blocks of the installer when the blockmap of the installed version is
 * on the server. macOS uses the adapter below: the research edition has no Apple Developer ID signature,
 * and Squirrel.Mac, which electron-updater uses on macOS, installs only a bundle signed like the running
 * one. The adapter downloads the ZIP of the new version and replaces the application after HXBot quits.
 */

/** A file of a release, as electron-builder lists it in latest-mac.yml and latest.yml. */
export type HxUpdateFile = { url: string; sha512: string; size: number };

/** The part of electron-builder's update metadata that HXBot reads. */
export type HxUpdateFeed = {
  version: string;
  files: HxUpdateFile[];
  releaseDate: string | null;
  /** What is new, as electron-builder writes `releaseInfo.releaseNotes` (hx/release-notes.json). */
  releaseNotes: string | null;
};

/** A YAML scalar on one line: plain, single-quoted ('' is a quote) or double-quoted (JSON escapes). */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'"))
    return trimmed.slice(1, -1).replaceAll("''", "'");
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Not JSON: the text between the quotes.
    }
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Reads the YAML that electron-builder writes for a release (`version`, a `files` list of url, sha512 and
 * size, `releaseDate`). Only that shape, without a YAML library. Null when the text is not such a file.
 */
export function parseHxUpdateFeed(text: string): HxUpdateFeed | null {
  let version: string | null = null;
  let releaseDate: string | null = null;
  let releaseNotes: string | null = null;
  const files: HxUpdateFile[] = [];
  let current: Partial<HxUpdateFile> | null = null;
  let inFiles = false;
  const finish = () => {
    if (current?.url && current.sha512 && typeof current.size === "number")
      files.push({ url: current.url, sha512: current.sha512, size: current.size });
    current = null;
  };
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const top = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u.exec(line);
    if (top) {
      finish();
      inFiles = top[1] === "files";
      if (top[1] === "version") version = unquote(top[2] ?? "");
      if (top[1] === "releaseDate") releaseDate = unquote(top[2] ?? "");
      if (top[1] === "releaseNotes") releaseNotes = unquote(top[2] ?? "") || null;
      continue;
    }
    if (!inFiles) continue;
    const item =
      /^\s*-\s+([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u.exec(line) ?? /^\s+([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u.exec(line);
    if (!item) continue;
    if (/^\s*-\s/u.test(line)) {
      finish();
      current = {};
    }
    if (!current) continue;
    const key = item[1];
    const value = unquote(item[2] ?? "");
    if (key === "url") current.url = value;
    else if (key === "sha512") current.sha512 = value;
    else if (key === "size" && /^\d+$/u.test(value)) current.size = Number(value);
  }
  finish();
  if (!version || !/^\d+\.\d+\.\d+/u.test(version) || files.length === 0) return null;
  return { version, files, releaseDate, releaseNotes };
}

/** True when `candidate` is a later release than `current`. Both are x.y.z, an optional suffix is ignored. */
export function hxIsNewerVersion(candidate: string, current: string): boolean {
  const parts = (value: string) => (/^(\d+)\.(\d+)\.(\d+)/u.exec(value) ?? []).slice(1, 4).map(Number);
  const a = parts(candidate);
  const b = parts(current);
  if (a.length !== 3 || b.length !== 3) return false;
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

/** The update feed that electron-builder wrote into app-update.yml, or null when the file has none. */
export function hxUpdateFeedUrl(appUpdateYml: string): string | null {
  const line = appUpdateYml.split(/\r?\n/u).find((entry) => /^url:\s*/u.test(entry));
  if (!line) return null;
  const url = unquote(line.replace(/^url:\s*/u, ""));
  return /^https?:\/\//u.test(url) ? (url.endsWith("/") ? url : `${url}/`) : null;
}

/** The feed in `resources/app-update.yml`, read once at start. */
export function hxReadUpdateFeedUrl(resourcesPath: string): string | null {
  const file = join(resourcesPath, "app-update.yml");
  if (!existsSync(file)) return null;
  try {
    return hxUpdateFeedUrl(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** HXBot (v1.7.3 hotfix): true for an error of electron-updater that the server refused for the sign-in. */
function hxRefusedSession(error: unknown): boolean {
  const status = isDynamicRecord(error) && "statusCode" in error ? Number(error.statusCode) : Number.NaN;
  return status === 401 || status === 403;
}

/**
 * electron-updater (Windows, Linux) with the HXBot session on each request. Signed out there is no
 * session to send, and the server would refuse: the check then reports no update and changes nothing.
 * HXBot (v1.7.3 hotfix): a check that the server refuses (401, 403) checks the sign-in once and asks again.
 */
export function hxAuthorizedUpdater(
  updater: UpdateAdapter,
  sessionToken: () => string | null,
  refreshSession?: () => Promise<void>,
): UpdateAdapter {
  const check = updater.checkForUpdates.bind(updater);
  const download = updater.downloadUpdate.bind(updater);
  const authorize = (): boolean => {
    const token = sessionToken();
    // electron-updater's `requestHeaders` go with every request of the check and the download.
    Reflect.set(updater, "requestHeaders", token ? { Authorization: `Bearer ${token}` } : null);
    return token !== null;
  };
  updater.checkForUpdates = async () => {
    if (!authorize()) return null;
    try {
      return await check();
    } catch (error) {
      if (!refreshSession || !hxRefusedSession(error)) throw error;
      try {
        await refreshSession();
      } catch {
        // The check failed: the request below tells the same as the first one.
      }
      if (!authorize()) throw error;
      return check();
    }
  };
  updater.downloadUpdate = async (cancellationToken?: UpdateCancellationToken) => {
    authorize();
    return download(cancellationToken);
  };
  hxPaceUpdater(updater);
  return updater;
}

/** What electron-updater reads of an answer: Electron's IncomingMessage. */
type HxUpdaterResponse = Readable & {
  statusCode?: number | undefined;
  statusMessage?: string | undefined;
  headers?: Record<string, string | string[]> | undefined;
};

/** The request options, which go on as electron-updater made them. */
interface HxRequestOptions {
  headers?: Record<string, string>;
}

interface HxRequestMaker {
  createRequest(options: HxRequestOptions, callback: (response: HxUpdaterResponse) => void): HxRequestOptions;
}

/** What owns the requests: electron-updater's updater, whose `httpExecutor` the types do not name. */
interface HxExecutorOwner {
  httpExecutor: HxRequestMaker;
}

function isRequestMaker(value: unknown): value is HxRequestMaker {
  return isDynamicRecord(value) && typeof value.createRequest === "function";
}

/**
 * HXBot (v1.7.0, F8): electron-updater (Windows, Linux) receives every download through its
 * executor's `createRequest`, the full installer and each range of a differential update. Each answer
 * goes on at HX_UPDATE_BYTES_PER_SECOND (hx-network.ts), with one budget for all of them.
 */
export function hxPaceUpdater(updater: UpdateAdapter | HxExecutorOwner, pacer: HxPacer = new HxPacer()): boolean {
  const executor = "httpExecutor" in updater ? updater.httpExecutor : null;
  if (!isRequestMaker(executor)) return false;
  const create = executor.createRequest.bind(executor);
  executor.createRequest = (options, callback) =>
    create(options, (response) => {
      const paced = Object.assign(new HxPacedStream(pacer), {
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        headers: response.headers ?? {},
      });
      response.on("error", (error: Error) => paced.destroy(error));
      // A reader that gives up (a cancelled download) stops the answer too.
      paced.on("close", () => {
        if (!response.readableEnded) response.destroy();
      });
      response.pipe(paced);
      callback(paced);
    });
  return true;
}

/** The .app bundle that `executable` (…/HXBot.app/Contents/MacOS/HXBot) belongs to, or null. */
export function hxAppBundlePath(executable: string): string | null {
  const match = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/u.exec(executable);
  return match?.[1] ?? null;
}

/**
 * True when the bundle can replace itself: not on a mounted disk image and not in the read-only copy
 * that macOS runs a downloaded app from until it is moved (App Translocation).
 */
export function hxBundleCanReplaceItself(bundle: string): boolean {
  return !bundle.startsWith("/Volumes/") && !bundle.includes("/AppTranslocation/");
}

/**
 * The script that installs the downloaded ZIP once HXBot has quit: it unpacks the ZIP, checks that the
 * new bundle is HXBot (same bundle identifier), swaps the bundles, and opens HXBot again. When the
 * swap fails (no write access to the folder, or macOS asks for the App Management permission) the old
 * bundle stays, HXBot opens again, and Finder shows the ZIP so the update can be installed by hand.
 */
export const HX_MAC_INSTALL_SCRIPT = `#!/bin/sh
# HXBot: installs a downloaded update after HXBot quits. Arguments: pid, zip, bundle, log, front.
# front is 0 when the user worked in another app: HXBot then opens again behind it (v1.7.0).
pid="$1"; zip="$2"; app="$3"; log="$4"; front="\${5:-1}"
mkdir -p "$(dirname "$log")" 2>/dev/null
( : >>"$log" ) 2>/dev/null || log=/dev/null
exec >>"$log" 2>&1
echo "$(date '+%Y-%m-%d %H:%M:%S') install $zip into $app"
reopen() { if [ "$front" = 0 ]; then open -g "$app"; else open "$app"; fi; }
manual() { echo "$1"; open -R "$zip"; reopen; exit 1; }
waited=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 0.5
  waited=$((waited + 1))
  [ "$waited" -gt 240 ] && { echo "HXBot did not quit"; exit 1; }
done
work="$(mktemp -d "\${TMPDIR:-/tmp}/hxbot-update.XXXXXX")" || manual "no temporary folder"
ditto -x -k "$zip" "$work" || manual "the update could not be unpacked"
new="$(find "$work" -maxdepth 1 -name '*.app' -type d | head -n 1)"
[ -n "$new" ] && [ -d "$new" ] || manual "the update has no application"
plist() { "\${HX_PLISTBUDDY:-/usr/libexec/PlistBuddy}" -c "Print :$1" "$2/Contents/Info.plist" 2>/dev/null; }
[ "$(plist CFBundleIdentifier "$new")" = "$(plist CFBundleIdentifier "$app")" ] || manual "the update is a different application"
xattr -dr com.apple.quarantine "$new" 2>/dev/null
old="$app.hxbot-old-$$"
if mv "$app" "$old"; then
  if mv "$new" "$app"; then
    rm -rf "$old" "$work"
    echo "installed $(plist CFBundleShortVersionString "$app")"
    reopen
    exit 0
  fi
  mv "$old" "$app"
fi
rm -rf "$work"
manual "HXBot could not replace itself; the update is in Finder"
`;

type HxMacUpdaterOptions = {
  feedUrl: string;
  currentVersion: string;
  arch: string;
  sessionToken: () => string | null;
  cacheDirectory: string;
  executablePath: string;
  logPath: string;
  pid: number;
  quit: () => void;
  fetch?: HxFetch;
  /**
   * HXBot (v1.7.3 hotfix): Electron's own network (Chromium: the system proxy, the system's DNS and certificates).
   * A request that fails at the network with fetch goes once more through it.
   */
  netFetch?: HxFetch;
  /** HXBot (v1.7.3 hotfix): checks the sign-in again (the account service's /v1/me) after the server refused it. */
  refreshSession?: () => Promise<void>;
  spawnInstaller?: (script: string, args: string[]) => void;
  /** HXBot (v1.7.0): the user works in HXBot now; otherwise the updated HXBot opens behind their app. */
  userInFront?: () => boolean;
  /** HXBot (v1.7.0, F8): the most the download takes of the network. */
  bytesPerSecond?: number;
  wait?: (ms: number) => Promise<void>;
};

/** The part of fetch that the adapter uses; a test passes its own. */
export type HxFetch = (url: URL, init: { headers: Record<string, string>; cache: "no-store" }) => Promise<Response>;

/** HXBot (v1.7.3 hotfix): the code of a request that the server refused for the sign-in, after one new check of it. */
export const HX_UPDATE_SIGNED_OUT = "HX_UPDATE_SIGNED_OUT";

/**
 * HXBot (v1.7.3 hotfix): a failed update request, with the HTTP status and a code, as electron-updater gives them.
 * Before, every failure was a plain Error, and UpdateService showed "Could not check for updates" for each one: a feed
 * that the server does not have (404, the update files were not uploaded) looked the same as a dropped network.
 */
export class HxUpdateRequestError extends Error {
  readonly code: string;
  readonly statusCode: number | undefined;

  constructor(message: string, code: string, statusCode?: number) {
    super(message);
    this.name = "HxUpdateRequestError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** The code of an answer that is not ok: the codes of electron-updater where it has one (update-service.ts sorts by them). */
export function hxUpdateStatusCode(status: number): string {
  if (status === 404) return "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND";
  if (status === 401 || status === 403) return HX_UPDATE_SIGNED_OUT;
  return `HTTP_ERROR_${status}`;
}

/** A request that did not reach the server: the code of its cause (ENOTFOUND, ECONNREFUSED, a certificate error). */
function hxNetworkError(first: unknown, second?: unknown): HxUpdateRequestError {
  const describe = (error: unknown): { code: string; text: string } => {
    const cause = isDynamicRecord(error) && "cause" in error ? error.cause : null;
    const code =
      (isDynamicRecord(cause) && typeof cause.code === "string" && cause.code) ||
      (isDynamicRecord(error) && typeof error.code === "string" && error.code) ||
      "ERR_NETWORK";
    const message = error instanceof Error ? error.message : String(error);
    const detail = cause instanceof Error ? cause.message : "";
    return { code, text: detail ? `${message}: ${detail}` : message };
  };
  const one = describe(first);
  const two = second === undefined ? null : describe(second);
  return new HxUpdateRequestError(
    two ? `${one.code} ${one.text}; Electron network: ${two.code} ${two.text}` : `${one.code} ${one.text}`,
    one.code,
  );
}

/** Ends an answer that is not read, so that its connection goes back to the pool. */
async function hxDiscard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // An answer that is already closed.
  }
}

/** One listener type for every event, as hosted-update-adapter.ts has: the intersection takes each overload. */
type UpdateListener = (value: ProgressInfo & UpdateInfo & Error) => void;

class DownloadCancellation implements UpdateCancellationToken {
  cancelled = false;
  cancel(): void {
    this.cancelled = true;
  }
}

/** The release file for this Mac: the ZIP of the architecture, then any ZIP. */
export function hxMacUpdateFile(feed: HxUpdateFeed, arch: string): HxUpdateFile | null {
  const zips = feed.files.filter((file) => file.url.endsWith(".zip"));
  return zips.find((file) => file.url.includes(`-${arch}`)) ?? zips[0] ?? null;
}

/** electron-updater's adapter shape, for macOS without Squirrel.Mac. */
export class HxMacUpdateAdapter implements UpdateAdapter {
  allowPrerelease = false;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  readonly #events = new EventEmitter();
  readonly #options: HxMacUpdaterOptions;
  #release: { feed: HxUpdateFeed; file: HxUpdateFile } | null = null;
  #downloaded: string | null = null;

  constructor(options: HxMacUpdaterOptions) {
    this.#options = options;
  }

  on(event: string, listener: UpdateListener): this {
    this.#events.on(event, listener);
    return this;
  }

  #info(feed: HxUpdateFeed, file: HxUpdateFile): UpdateInfo {
    return {
      version: feed.version,
      files: [{ url: file.url, sha512: file.sha512, size: file.size }],
      path: file.url,
      sha512: file.sha512,
      releaseDate: feed.releaseDate ?? new Date().toISOString(),
      releaseNotes: feed.releaseNotes,
    };
  }

  #headers(): Record<string, string> | null {
    const token = this.#options.sessionToken();
    // HXBot (v1.7.3 hotfix): the app and its version, as the other requests of HXBot send them (hx-client-version.ts).
    return token
      ? {
          Authorization: `Bearer ${token}`,
          "User-Agent": `HXBot/${this.#options.currentVersion} (Macintosh; ${this.#options.arch})`,
          "X-HXBot-Client": `desktop/${this.#options.currentVersion}`,
        }
      : null;
  }

  /**
   * HXBot (v1.7.3 hotfix): one request of the update, with what a request needs to get through:
   * - a request that fails at the network goes once more through Electron's own network (the system proxy);
   * - an answer 401 or 403 checks the sign-in once and asks again with the session that the check leaves;
   * - an answer that is not ok throws an HxUpdateRequestError with its status, so that the user reads the cause.
   */
  async #request(url: URL): Promise<Response> {
    const fetcher: HxFetch = this.#options.fetch ?? ((target, init) => fetch(target, init));
    const send = async (): Promise<Response> => {
      const headers = this.#headers();
      if (!headers) throw new HxUpdateRequestError("Sign in to HXBot to check for updates.", HX_UPDATE_SIGNED_OUT, 401);
      try {
        return await fetcher(url, { headers, cache: "no-store" });
      } catch (error) {
        const netFetch = this.#options.netFetch;
        if (!netFetch) throw hxNetworkError(error);
        try {
          return await netFetch(url, { headers, cache: "no-store" });
        } catch (second) {
          throw hxNetworkError(error, second);
        }
      }
    };
    let response = await send();
    if ((response.status === 401 || response.status === 403) && this.#options.refreshSession) {
      await hxDiscard(response);
      try {
        await this.#options.refreshSession();
      } catch {
        // The check failed: the request below tells the same as the first one.
      }
      response = await send();
    }
    if (!response.ok) {
      await hxDiscard(response);
      throw new HxUpdateRequestError(
        `The HXBot update server answered ${response.status} for ${url.pathname}.`,
        hxUpdateStatusCode(response.status),
        response.status,
      );
    }
    return response;
  }

  async checkForUpdates(): Promise<UpdateCheckOutcome | null> {
    this.#events.emit("checking-for-update");
    if (!this.#headers()) return null;
    const response = await this.#request(new URL("latest-mac.yml", this.#options.feedUrl));
    const feed = parseHxUpdateFeed(await response.text());
    const file = feed ? hxMacUpdateFile(feed, this.#options.arch) : null;
    if (!feed || !file)
      throw new HxUpdateRequestError(
        "The HXBot update server sent update information that HXBot cannot read.",
        "ERR_UPDATER_INVALID_RELEASE_FEED",
      );
    const info = this.#info(feed, file);
    if (!hxIsNewerVersion(feed.version, this.#options.currentVersion)) {
      this.#release = null;
      this.#events.emit("update-not-available", info);
      return { isUpdateAvailable: false, updateInfo: { version: feed.version } };
    }
    if (this.#release?.feed.version !== feed.version) this.#downloaded = null;
    this.#release = { feed, file };
    this.#events.emit("update-available", info);
    return {
      isUpdateAvailable: true,
      updateInfo: { version: feed.version, releaseNotes: feed.releaseNotes },
      cancellationToken: new DownloadCancellation(),
    };
  }

  async downloadUpdate(cancellationToken?: UpdateCancellationToken): Promise<string[]> {
    const release = this.#release;
    if (!release) throw new Error("There is no HXBot update to download.");
    if (!this.#headers()) throw new Error("Sign in to HXBot to download the update.");
    const pending = join(this.#options.cacheDirectory, "pending");
    await mkdir(pending, { recursive: true });
    const target = join(pending, release.file.url.replace(/[^A-Za-z0-9._-]/gu, "_"));
    if (this.#downloaded === target && existsSync(target)) {
      this.#events.emit("update-downloaded", this.#info(release.feed, release.file));
      return [target];
    }
    const partial = `${target}.part`;
    const response = await this.#request(new URL(release.file.url, this.#options.feedUrl));
    if (!response.body) throw new Error(`The HXBot update server answered ${response.status} with no body.`);
    const hash = createHash("sha512");
    const out = createWriteStream(partial);
    const total = release.file.size;
    const rate = this.#options.bytesPerSecond ?? HX_UPDATE_BYTES_PER_SECOND;
    const wait = this.#options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const started = Date.now();
    let transferred = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        if (cancellationToken?.cancelled) throw new Error("The HXBot update download was cancelled.");
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        transferred += value.byteLength;
        if (!out.write(value)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
        const seconds = Math.max((Date.now() - started) / 1000, 0.001);
        const progress: ProgressInfo = {
          total,
          delta: value.byteLength,
          transferred,
          percent: total > 0 ? Math.min((transferred / total) * 100, 100) : 0,
          bytesPerSecond: Math.round(transferred / seconds),
        };
        this.#events.emit("download-progress", progress);
        // HXBot (v1.7.0, F8): a download at full speed took the whole line, and the user's own calls and
        // pages dropped. It takes at most HX_UPDATE_BYTES_PER_SECOND (hx-network.ts).
        const ahead = (transferred / rate) * 1000 - (Date.now() - started);
        if (ahead > 0) await wait(ahead);
      }
      await new Promise<void>((resolve, reject) =>
        out.end((error?: Error | null) => (error ? reject(error) : resolve())),
      );
    } catch (error) {
      out.destroy();
      await rm(partial, { force: true });
      throw error;
    }
    if (transferred !== total || hash.digest("base64") !== release.file.sha512) {
      await rm(partial, { force: true });
      throw new Error("The downloaded HXBot update does not match the update information.");
    }
    await rename(partial, target);
    this.#downloaded = target;
    this.#events.emit("update-downloaded", this.#info(release.feed, release.file));
    return [target];
  }

  /**
   * Starts the install script and quits. A failure throws, so that UpdateService reports the install as
   * failed: it runs after the shutdown preparation, as with electron-updater.
   */
  quitAndInstall(): void {
    const zip = this.#downloaded;
    const bundle = hxAppBundlePath(this.#options.executablePath);
    if (!zip || !bundle) throw new Error("The HXBot update is not ready to install.");
    if (!hxBundleCanReplaceItself(bundle))
      throw new Error("Move HXBot to the Applications folder, open it from there, and install the update again.");
    const script = join(this.#options.cacheDirectory, "install-update.sh");
    // Synchronous: the shutdown that ran before this call ends the process soon after.
    writeFileSync(script, HX_MAC_INSTALL_SCRIPT, "utf8");
    chmodSync(script, 0o700);
    const front = this.#options.userInFront?.() ?? true;
    const args = [String(this.#options.pid), zip, bundle, this.#options.logPath, front ? "1" : "0"];
    const start =
      this.#options.spawnInstaller ??
      ((path: string, scriptArgs: string[]) =>
        spawn("/bin/sh", [path, ...scriptArgs], { detached: true, stdio: "ignore" }).unref());
    start(script, args);
    this.#options.quit();
  }
}
