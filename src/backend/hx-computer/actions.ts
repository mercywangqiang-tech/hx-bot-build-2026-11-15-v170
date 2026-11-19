// HXBot 电脑操控：找、打开、读写设置这三件事的做法。
// 打开：应用、设置页、文件夹和文档、网址；不替人运行程序和脚本文件。
// 改设置：先读原值，写入，再读回核对。读回对不上就把原值写回去、把这一项记为“在这台电脑上不可靠”，
// 以后改为打开它所在的设置页。安全相关的页面只打开，上面的设置不由 HXBot 改。
import { stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import type { HxCatalogEntry, HxCatalogKind, HxSettingValues } from "@hxbot/contracts/hx-computer";
import type { HxCatalog } from "./catalog";
import { hxCombinedChange, hxCombinedValues } from "./combine";
import { HX_WINDOWS_COMMAND_TIMEOUT_MS, type HxRunner, type HxRunResult, hxRunFailure, hxRunOk } from "./runner";
import { hxSearch, hxSureHit } from "./search";
import { type HxCommand, type HxSettingSeed, hxSeedTolerance } from "./tables";
import { hxWinOpen, hxWinOpened, hxWinStart } from "./tables-win";

/** What the model gets of an entry: enough to choose it and to know what it takes. */
export interface HxBrief {
  id: string;
  kind: HxCatalogKind;
  title: string;
  /** Other names, at most three. */
  alsoCalled: string[];
  /** A setting: what it takes, and whether HXBot changes it without the settings page. */
  values?: HxSettingValues;
  direct?: boolean;
  /** A security page: HXBot opens it; the user makes the changes. */
  security?: true;
}

export type HxFindResult = { status: "found"; results: HxBrief[] } | { status: "not-found" } | HxUnsupported;
interface HxUnsupported {
  status: "unsupported";
  reason: string;
}

export type HxOpenResult =
  | { status: "opened"; what: HxBrief | { kind: "file" | "website"; target: string } }
  | { status: "candidates"; candidates: HxBrief[] }
  | { status: "not-found" | "refused" | "failed" | "invalid"; reason: string }
  | HxUnsupported;

export type HxSetResult =
  | { status: "value"; setting: HxBrief; value: string }
  | { status: "changed"; setting: HxBrief; previous: string; value: string }
  | { status: "unchanged"; setting: HxBrief; value: string }
  | { status: "page"; page: HxBrief; opened: boolean; reason: string }
  | { status: "candidates"; candidates: HxBrief[] }
  | { status: "invalid-value"; setting: HxBrief; expected: string }
  | { status: "needs-permission" | "not-found" | "failed" | "invalid"; reason: string }
  | HxUnsupported;

const UNSUPPORTED: HxUnsupported = {
  status: "unsupported",
  reason: "This works on macOS and Windows. On this system use the other Computer Use tools.",
};
/**
 * Files that run when they are opened, install something, or lead to another file or address.
 * Opening one is running a program, which this tool does not do.
 */
const RUNS_WHEN_OPENED = new Set([
  ".action",
  ".app",
  ".appinstaller",
  ".application",
  ".appref-ms",
  ".appx",
  ".appxbundle",
  ".bat",
  ".chm",
  ".cmd",
  ".com",
  ".command",
  ".cpl",
  ".diagcab",
  ".exe",
  ".fileloc",
  ".gadget",
  ".hta",
  ".inetloc",
  ".jar",
  ".jnlp",
  ".js",
  ".jse",
  ".lnk",
  ".mpkg",
  ".msc",
  ".msi",
  ".msix",
  ".msixbundle",
  ".msp",
  ".pif",
  ".pkg",
  ".prefpane",
  ".ps1",
  ".py",
  ".pyw",
  ".reg",
  ".scf",
  ".scpt",
  ".scptd",
  ".scr",
  ".sct",
  ".settingcontent-ms",
  ".sh",
  ".terminal",
  ".tool",
  ".url",
  ".vb",
  ".vbe",
  ".vbs",
  ".workflow",
  ".ws",
  ".wsc",
  ".wsf",
  ".wsh",
  ".xll",
]);
/** After a change the system can need a moment before it reports the new value. */
const READ_BACK_WAITS_MS = [400, 1200];
/** How long opening something may take. */
const OPEN_TIMEOUT_MS = 20_000;
/** A search that finds no app reads the apps again, but not more often than this. */
const RESCAN_MIN_MS = 20_000;
const MAX_URL = 2000;
const SWITCH_ON = new Set(["on", "true", "1", "yes", "enable", "enabled", "开", "打开", "开启", "启用", "是"]);
const SWITCH_OFF = new Set(["off", "false", "0", "no", "disable", "disabled", "关", "关闭", "停用", "否"]);
const CHOICE_WORDS: Readonly<Record<string, string>> = {
  左: "left",
  左边: "left",
  左侧: "left",
  下: "bottom",
  底部: "bottom",
  下方: "bottom",
  右: "right",
  右边: "right",
  右侧: "right",
  神奇效果: "genie",
  缩放效果: "scale",
  缩放: "scale",
};
/** macOS refuses an instruction to another program until the user allows it once (error -1743). */
const NOT_ALLOWED = /-1743|not authori[sz]ed to send apple events/iu;
const NEEDS_AUTOMATION =
  "macOS has not allowed HXBot to control System Events. The user allows it in System Settings › Privacy & Security › Automation; then try again.";

function hxBrief(entry: HxCatalogEntry): HxBrief {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    alsoCalled: entry.names.filter((name) => name !== entry.title).slice(0, 3),
    ...(entry.values ? { values: entry.values } : {}),
    ...(entry.kind === "setting" ? { direct: entry.direct === true } : {}),
    ...(entry.kind === "page" && entry.risk === 3 ? { security: true } : {}),
  };
}

/** What a value must look like, for the model. */
export function hxExpected(values: HxSettingValues): string {
  if (values.type === "switch") return "on or off";
  if (values.type === "number") return `a whole number from ${values.min} to ${values.max}`;
  if (values.type === "choice") return `one of: ${values.options.join(", ")}`;
  return "the full path of a file";
}

/** The value in HXBot's own words, or null when it is not one the setting takes. */
export function hxNormalizeValue(values: HxSettingValues, raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (values.type === "switch") {
    if (SWITCH_ON.has(text)) return "on";
    return SWITCH_OFF.has(text) ? "off" : null;
  }
  if (values.type === "number") {
    const match = /^(\d{1,4})\s*%?$/u.exec(text);
    if (!match?.[1]) return null;
    const value = Number(match[1]);
    return value >= values.min && value <= values.max ? String(value) : null;
  }
  if (values.type === "choice") {
    const option = CHOICE_WORDS[text] ?? text;
    return values.options.includes(option) ? option : null;
  }
  return isAbsolute(raw.trim()) ? raw.trim() : null;
}

function sameValue(seed: HxSettingSeed, left: string, right: string): boolean {
  // A size that the system keeps as a fraction comes back one off after rounding, and the Dock
  // settles on a whole number of points of its own nearby.
  if (seed.values.type === "number") return Math.abs(Number(left) - Number(right)) <= hxSeedTolerance(seed);
  return left === right;
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export class HxComputerActions {
  readonly #catalog: HxCatalog;
  readonly #run: HxRunner;
  readonly #wait: (ms: number) => Promise<void>;

  /** `wait` is how the checks after a change wait; tests pass one that does not. */
  constructor(catalog: HxCatalog, run: HxRunner, wait: (ms: number) => Promise<void> = pause) {
    this.#catalog = catalog;
    this.#run = run;
    this.#wait = wait;
  }

  #command(command: HxCommand, timeoutMs?: number): Promise<HxRunResult> {
    const limit = timeoutMs ?? (this.#catalog.platform === "windows" ? HX_WINDOWS_COMMAND_TIMEOUT_MS : 20_000);
    return this.#run(command.command, command.args, {
      timeoutMs: limit,
      ...(command.env ? { env: command.env } : {}),
    });
  }

  /**
   * Opens a target with the program the system gives it. On Windows the desktop shell does it, and
   * ends with 1 as often as with 0; when the shell is not there, PowerShell does it and says more.
   */
  async #start(target: string): Promise<HxRunResult> {
    if (this.#catalog.platform !== "windows") return this.#run("/usr/bin/open", [target], { timeoutMs: 20_000 });
    const shell = await this.#command(hxWinOpen(target), OPEN_TIMEOUT_MS);
    if (hxWinOpened(shell)) return { ...shell, code: 0 };
    if (!shell.missing) return shell;
    return this.#command(hxWinStart(target), HX_WINDOWS_COMMAND_TIMEOUT_MS);
  }

  async find(input: { query: string; kinds?: readonly HxCatalogKind[]; limit?: number }): Promise<HxFindResult> {
    if (this.#catalog.platform === null) return UNSUPPORTED;
    const options = { ...(input.kinds ? { kinds: input.kinds } : {}), limit: input.limit ?? 8 };
    let hits = hxSearch(await this.#catalog.entries(), input.query, options);
    if (hits.length === 0 && (!input.kinds || input.kinds.includes("app"))) {
      // An app installed a minute ago is not in the list yet.
      await this.#catalog.refresh(RESCAN_MIN_MS);
      hits = hxSearch(await this.#catalog.entries(), input.query, options);
    }
    return hits.length === 0
      ? { status: "not-found" }
      : { status: "found", results: hits.map((hit) => hxBrief(hit.entry)) };
  }

  /** The entry an id or a query means; the candidates when a query fits more than one. */
  async #resolve(
    input: { id?: string | undefined; query?: string | undefined },
    kinds: readonly HxCatalogKind[],
  ): Promise<{ entry: HxCatalogEntry } | { candidates: HxBrief[] } | null> {
    if (input.id) {
      const entry = await this.#catalog.entry(input.id);
      return entry && kinds.includes(entry.kind) ? { entry } : null;
    }
    const found = await this.find({ query: input.query ?? "", kinds, limit: 5 });
    if (found.status !== "found") return null;
    const entries = await this.#catalog.entries();
    const sure = hxSureHit(hxSearch(entries, input.query ?? "", { kinds, limit: 5 }));
    return sure ? { entry: sure } : { candidates: found.results };
  }

  async #openEntry(entry: HxCatalogEntry): Promise<HxOpenResult> {
    const target = entry.kind === "setting" ? (await this.#catalog.entry(entry.page ?? ""))?.target : entry.target;
    if (!target) return { status: "failed", reason: "This entry has nothing to open." };
    const result = await this.#start(target);
    if (hxRunOk(result)) return { status: "opened", what: hxBrief(entry) };
    return { status: "failed", reason: hxRunFailure("Opening it", result) };
  }

  async open(input: { id?: string; query?: string; path?: string; url?: string }): Promise<HxOpenResult> {
    if (this.#catalog.platform === null) return UNSUPPORTED;
    const given = [input.id, input.query, input.path, input.url].filter((value) => value !== undefined && value !== "");
    if (given.length !== 1) return { status: "invalid", reason: "Give exactly one of id, query, path and url." };
    if (input.url) return this.#openUrl(input.url);
    if (input.path) return this.#openPath(input.path);
    const resolved = await this.#resolve(input, ["app", "page", "setting"]);
    if (!resolved) {
      return {
        status: "not-found",
        reason: "Nothing on this computer has that name. Try computer_find with other words.",
      };
    }
    return "entry" in resolved
      ? this.#openEntry(resolved.entry)
      : { status: "candidates", candidates: resolved.candidates };
  }

  /**
   * HXBot (v1.7.4, CU-07 settings skill): opens a settings page, or the page of a setting, and nothing
   * else: no app, file or address, whatever the words match.
   */
  async openSettingsPage(input: { id?: string; query?: string }): Promise<HxOpenResult> {
    if (this.#catalog.platform === null) return UNSUPPORTED;
    if ((input.id ? 1 : 0) + (input.query ? 1 : 0) !== 1)
      return { status: "invalid", reason: "Give exactly one of id and query." };
    const resolved = await this.#resolve(input, ["page", "setting"]);
    if (!resolved) return { status: "not-found", reason: "No settings page has that name. Try other words." };
    return "entry" in resolved
      ? this.#openEntry(resolved.entry)
      : { status: "candidates", candidates: resolved.candidates };
  }

  /** HXBot (v1.7.4, CU-07 settings skill): reads a setting; a page or an app is never opened for it. */
  async readSetting(input: { id?: string; query?: string }): Promise<HxSetResult> {
    if (this.#catalog.platform === null) return UNSUPPORTED;
    if ((input.id ? 1 : 0) + (input.query ? 1 : 0) !== 1)
      return { status: "invalid", reason: "Give exactly one of id and query." };
    const resolved = await this.#resolve(input, ["setting"]);
    if (!resolved) return { status: "not-found", reason: "No setting has that name. Try other words." };
    if ("candidates" in resolved) return { status: "candidates", candidates: resolved.candidates };
    return this.set({ id: resolved.entry.id });
  }

  async #openUrl(url: string): Promise<HxOpenResult> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { status: "invalid", reason: "That is not a web address." };
    }
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || url.length > MAX_URL) {
      return { status: "refused", reason: "Only http and https addresses are opened this way." };
    }
    const result = await this.#start(parsed.href);
    return hxRunOk(result)
      ? { status: "opened", what: { kind: "website", target: parsed.href } }
      : { status: "failed", reason: hxRunFailure("Opening it", result) };
  }

  async #openPath(path: string): Promise<HxOpenResult> {
    if (!isAbsolute(path)) return { status: "invalid", reason: "Give the full path." };
    let folder: boolean;
    let runnable: boolean;
    try {
      const info = await stat(path);
      folder = info.isDirectory();
      // macOS runs a file that has no extension in Terminal when it is marked as a program.
      runnable = this.#catalog.platform === "mac" && !folder && (info.mode & 0o111) !== 0;
    } catch {
      return { status: "not-found", reason: "There is no file or folder at that path." };
    }
    const kind = extname(path).toLowerCase();
    // An app is a folder on macOS; it is opened from the catalog (computer_open with its id), never as a path.
    if (RUNS_WHEN_OPENED.has(kind) || (kind === "" && runnable)) {
      return {
        status: "refused",
        reason: "Opening this file would run it. Open an app by its name or id; run a program with your command tool.",
      };
    }
    const result = await this.#start(path);
    return hxRunOk(result)
      ? { status: "opened", what: { kind: "file", target: path } }
      : { status: "failed", reason: hxRunFailure("Opening it", result) };
  }

  async #openPageOf(entry: HxCatalogEntry, reason: string): Promise<HxSetResult> {
    const page = entry.kind === "page" ? entry : await this.#catalog.entry(entry.page ?? "");
    if (!page?.target) return { status: "failed", reason };
    const opened = hxRunOk(await this.#start(page.target));
    return { status: "page", page: hxBrief(page), opened, reason };
  }

  async #read(
    seed: HxSettingSeed,
  ): Promise<{ value: string } | { problem: "permission" | "unreadable"; reason: string }> {
    const result = await this.#command(seed.read);
    if (NOT_ALLOWED.test(result.stderr)) {
      return { problem: "permission", reason: NEEDS_AUTOMATION };
    }
    if (!hxRunOk(result)) return { problem: "unreadable", reason: hxRunFailure("Reading the setting", result) };
    const value = seed.parse(result.stdout);
    return value === null
      ? { problem: "unreadable", reason: "The system gave no value for this setting right now." }
      : { value };
  }

  /**
   * The change in one process: the two readings say what it was and what it is now. Null when there
   * is no such command for this setting, or when it did not work: then the three steps follow, which
   * also report what went wrong. A command that wrote and then failed to read leaves the value
   * written, and the three steps report the value it has now as the earlier one.
   */
  async #combined(
    seed: HxSettingSeed,
    entry: HxCatalogEntry,
    brief: HxBrief,
    wanted: string,
  ): Promise<HxSetResult | null> {
    const platform = this.#catalog.platform;
    // A setting that takes a file is not written twice: writing the same wallpaper again would show.
    const command = platform === null || seed.values.type === "file" ? null : hxCombinedChange(platform, seed, wanted);
    if (!command) return null;
    const result = await this.#command(command);
    if (NOT_ALLOWED.test(result.stderr)) return { status: "needs-permission", reason: NEEDS_AUTOMATION };
    if (!hxRunOk(result)) return null;
    const values = hxCombinedValues(seed, result.stdout);
    if (!values) return null;
    // The value was already the wanted one. The command wrote it again, which changes nothing.
    if (sameValue(seed, values.before, wanted)) return { status: "unchanged", setting: brief, value: values.before };
    if (sameValue(seed, values.after, wanted)) {
      return { status: "changed", setting: brief, previous: values.before, value: values.after };
    }
    // The second reading came right after the write, so a system that reports a moment late shows
    // the old value here: it is read again, as the three steps do, before the command is mistrusted.
    for (const waitMs of READ_BACK_WAITS_MS) {
      await this.#wait(waitMs);
      const after = await this.#read(seed);
      if ("value" in after && sameValue(seed, after.value, wanted)) {
        return { status: "changed", setting: brief, previous: values.before, value: after.value };
      }
    }
    // The value it had is known, so it goes back, and the command is not trusted on this computer.
    await this.#command(seed.write(values.before));
    await this.#catalog.disable(entry.id);
    return this.#openPageOf(
      entry,
      "The change did not take effect, so the earlier value was put back. The settings page is open.",
    );
  }

  async set(input: { id?: string; query?: string; value?: string }): Promise<HxSetResult> {
    if (this.#catalog.platform === null) return UNSUPPORTED;
    if ((input.id ? 1 : 0) + (input.query ? 1 : 0) !== 1) {
      return { status: "invalid", reason: "Give exactly one of id and query." };
    }
    const resolved = await this.#resolve(input, ["setting", "page"]);
    if (!resolved) {
      return {
        status: "not-found",
        reason: "No setting or settings page has that name. Try computer_find with other words.",
      };
    }
    if ("candidates" in resolved) return { status: "candidates", candidates: resolved.candidates };
    const entry = resolved.entry;
    if (entry.kind === "page" && entry.risk !== 3 && !input.id) {
      // The words named a page, such as "Dock". When HXBot changes some settings of that page
      // directly, the model chooses one of them (or the page) before anything is opened.
      const direct = (await this.#catalog.entries()).filter(
        (candidate) => candidate.kind === "setting" && candidate.page === entry.id && candidate.direct === true,
      );
      if (direct.length > 0) return { status: "candidates", candidates: [...direct, entry].map(hxBrief) };
    }
    if (entry.kind === "page") {
      return this.#openPageOf(
        entry,
        entry.risk === 3
          ? "This is a security page. It is open; the user makes the change there."
          : "HXBot has no direct command for what is on this page. It is open: make the change there with the other Computer Use tools.",
      );
    }
    const seed = this.#catalog.settingSeed(entry.id);
    if (!seed || !entry.values) return { status: "failed", reason: "This setting is not known on this system." };
    const brief = hxBrief(entry);
    const state = await this.#catalog.directState(entry.id);
    if (state === "disabled") {
      return this.#openPageOf(
        entry,
        "On this computer the direct change of this setting did not take effect before. Its page is open.",
      );
    }
    // A value this setting does not take is told apart before anything runs.
    const wanted =
      input.value === undefined || input.value.trim() === "" ? null : hxNormalizeValue(entry.values, input.value);
    if (input.value !== undefined && input.value.trim() !== "" && wanted === null) {
      return { status: "invalid-value", setting: brief, expected: hxExpected(entry.values) };
    }
    // One process reads the value, writes it and reads again: three starts of a system command cost
    // 22 seconds each on an ARM computer we measured. It is only for a change that may go ahead.
    if (wanted !== null && state === "direct") {
      const combined = await this.#combined(seed, entry, brief, wanted);
      if (combined) return combined;
    }
    const before = await this.#read(seed);
    if ("problem" in before) {
      if (before.problem === "permission") return { status: "needs-permission", reason: before.reason };
      return this.#openPageOf(entry, `${before.reason} Its page is open.`);
    }
    // Reading changes nothing, so it needs no check of this computer.
    if (wanted === null) return { status: "value", setting: brief, value: before.value };
    if (before.value === wanted) return { status: "unchanged", setting: brief, value: before.value };
    if (state === "unchecked") {
      return this.#openPageOf(
        entry,
        "HXBot changes a setting directly only after its self-test passed for it on this computer, and it has not yet. The settings page is open: make the change there with the other Computer Use tools. Tell the user once that Settings › Computer Use › Run the self-test checks this computer (it changes no value); after it, such changes are immediate.",
      );
    }
    const written = await this.#command(seed.write(wanted));
    if (NOT_ALLOWED.test(written.stderr)) return { status: "needs-permission", reason: NEEDS_AUTOMATION };
    if (!hxRunOk(written)) return { status: "failed", reason: hxRunFailure("Changing the setting", written) };
    for (const waitMs of [0, ...READ_BACK_WAITS_MS]) {
      if (waitMs > 0) await this.#wait(waitMs);
      const after = await this.#read(seed);
      if ("value" in after && sameValue(seed, after.value, wanted)) {
        return { status: "changed", setting: brief, previous: before.value, value: after.value };
      }
    }
    // The command ran and the system still shows another value: put the old one back and stop trusting the command.
    await this.#command(seed.write(before.value));
    await this.#catalog.disable(entry.id);
    return this.#openPageOf(
      entry,
      "The change did not take effect, so the earlier value was put back. The settings page is open.",
    );
  }
}
