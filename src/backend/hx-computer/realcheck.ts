// HXBot 电脑操控：真系统检查。在一台真的 Mac 或 Windows 上，用 HXBot 自己的目录、检索、打开、读写设置的代码
// 把每个功能做一遍，再从另一边核对结果：进程起来了没有、设置窗口显示的是不是要的那一页、
// 改过的设置换一条路读是不是也变了。每一项设置都会被真的改成别的值，再改回去。
// 所以它只在 GitHub 的用完即毁的机器上跑（.github/workflows/hx-computer-check.yml），不在用户的电脑上跑；
// 用户电脑上跑的是自检（selftest.ts），那个不改任何值。
// 预期在 realcheck-data.ts，看系统的办法在 realcheck-system.ts，成绩单在 realcheck-report.ts。
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { arch, release, type } from "node:os";
import { join } from "node:path";
import type {
  HxCatalogEntry,
  HxComputerPlatform,
  HxSelfTestReport,
  HxSettingValues,
} from "@hxbot/contracts/hx-computer";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { HxComputerActions, hxNormalizeValue } from "./actions";
import { HxCatalog } from "./catalog";
import { hxCombinedChange, hxCombinedValues } from "./combine";
import { hxPinyinTyped } from "./pinyin";
import {
  HX_REAL_APPS,
  HX_REAL_BROWSERS,
  HX_REAL_MAC_CHINESE,
  HX_REAL_NO_HARDWARE,
  HX_REAL_PAGE_NOTES,
  HX_REAL_PHRASES,
  HX_REAL_PROBES,
  HX_REAL_REFUSED,
  HX_REAL_REFUSED_ADDRESSES,
  HX_REAL_TEXT_EDITORS,
  type HxRealApp,
  type HxRealPageNote,
  hxRealAppEntry,
  hxRealEffect,
  hxRealPageShown,
  hxRealWays,
} from "./realcheck-data";
import { type HxCheckItem, type HxCheckOutcome, type HxCheckReport, hxCheckGroup, hxMedian } from "./realcheck-report";
import { type HxRealSystem, type HxSettingsWindow, hxRealSystem } from "./realcheck-system";
import { HX_WINDOWS_COMMAND_TIMEOUT_MS, type HxRunner, type HxRunResult, hxRunOk } from "./runner";
import { hxSearch, hxSureHit } from "./search";
import { HX_MAC_OWN_PANES, hxMacPanes, hxSelfTest } from "./selftest";
import { type HxCommand, type HxSettingSeed, hxSeedTolerance } from "./tables";
import { type HxComputerAllowed, hxComputerToolCall } from "./tools";

export interface HxRealCheckHost {
  platform: HxComputerPlatform;
  /** The label of the machine, for the report. */
  machine: string;
  run: HxRunner;
  /** The home folder of the user: macOS keeps the user's own apps there. */
  home: string;
  /** A folder for everything the check writes: its own data folders, files to open, screenshots. */
  out: string;
  screenshots: boolean;
  now(): number;
  wait(ms: number): Promise<void>;
  /** After this long no new check is started; the rest is reported as skipped. */
  budgetMs?: number;
  /** How the check looks at the system; tests pass their own. */
  system?: HxRealSystem;
  /** Where macOS keeps the panes of System Settings; tests pass a folder of their own. */
  macExtensions?: string;
  log?(line: string): void;
}

/** What one settings page showed, kept as a file so that the names of the pages can be corrected. */
interface HxRealPageRecord {
  key: string;
  wanted: string;
  opened: boolean;
  /** What the window showed, as the system gave it. */
  seen: string[];
}

export interface HxRealCheckResult {
  report: HxCheckReport;
  pages: HxRealPageRecord[];
  /** The report of HXBot's own self-test, which the check runs as one of its steps. */
  selfTest: HxSelfTestReport | null;
  /** macOS: the Chinese names of the apps of this machine, as the system has them. */
  chineseNames: string[];
}

interface Verdict {
  outcome: HxCheckOutcome;
  detail: string;
  shot?: string;
}

const passed = (detail: string, shot?: string): Verdict => ({ outcome: "passed", detail, ...(shot ? { shot } : {}) });
const failed = (detail: string, shot?: string): Verdict => ({ outcome: "failed", detail, ...(shot ? { shot } : {}) });
const review = (detail: string, shot?: string): Verdict => ({ outcome: "review", detail, ...(shot ? { shot } : {}) });
const unavailable = (detail: string, shot?: string): Verdict => ({
  outcome: "unavailable",
  detail,
  ...(shot ? { shot } : {}),
});

const DEFAULT_BUDGET_MS = 35 * 60 * 1000;
const DETAIL_LIMIT = 6000;
/** How long a program may take to show up after HXBot opened it. */
const APPEAR_MS = 10_000;
/** How long the settings window may take to show the page that was opened. */
const PAGE_WAIT_MS = 8000;
/** The first page starts the settings app, which takes longer on a machine that never ran it. */
const FIRST_PAGE_WAIT_MS = 30_000;
const PAGE_STEP_MS = 600;
/** After the window changed it is read once more, this much later: a page fills in pieces. */
const PAGE_SETTLE_MS = 700;
/** A read of the window that took this long already gave the page the time to fill in. */
const SLOW_READ_MS = 3000;
/** As actions.ts: after a change the system can need a moment before it reports the new value. */
const READ_BACK_WAITS_MS = [0, 400, 1200];
/** The other way to read a setting can be a moment behind. */
const EFFECT_WAIT_MS = 3000;
/** A list of what the window shows is only compared across pages when there are this many pages. */
const BASELINE_MIN_PAGES = 5;
const NOT_ALLOWED = /-1743|not authori[sz]ed to send apple events/iu;
const HAN = /\p{Script=Han}/u;

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function output(result: HxRunResult, limit = 300): string {
  const text = clip(result.stdout, limit) || clip(result.stderr, limit);
  return `退出码 ${result.code ?? "无"}${result.timedOut ? "（超时）" : ""}${text ? `：${text}` : "，没有输出"}`;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\da-z]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function sameValue(seed: HxSettingSeed, left: string | null, right: string): boolean {
  if (left === null) return false;
  if (seed.values.type === "number") return Math.abs(Number(left) - Number(right)) <= hxSeedTolerance(seed);
  return left === right;
}

/** A value the setting takes that is not the one it has; null when there is no such value to choose. */
export function hxRealOtherValue(values: HxSettingValues, current: string): string | null {
  if (values.type === "switch") return current === "on" ? "off" : "on";
  if (values.type === "number") {
    const now = Number(current);
    if (!Number.isFinite(now)) return null;
    const step = Math.max(1, Math.round((values.max - values.min) / 10));
    return String(now + step <= values.max ? now + step : now - step);
  }
  if (values.type === "choice") {
    const at = values.options.indexOf(current);
    return values.options[(at + 1) % values.options.length] ?? null;
  }
  return null;
}

function countNames(texts: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1);
  return counts;
}

function sameTexts(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((text, index) => text === right[index]);
}

/**
 * How often each name is in the window on every page: the navigation and the frame of the Settings
 * app. With fewer than five pages nothing is known about that, and the answer is empty.
 */
export function hxRealBaseline(pages: ReadonlyArray<readonly string[]>): Map<string, number> {
  const baseline = new Map<string, number>();
  if (pages.length < BASELINE_MIN_PAGES) return baseline;
  const [first, ...rest] = pages.map(countNames);
  if (!first) return baseline;
  for (const [name, count] of first) {
    let least = count;
    for (const other of rest) least = Math.min(least, other.get(name) ?? 0);
    if (least > 0) baseline.set(name, least);
  }
  return baseline;
}

/** The names that are in the window more often than on every page: what this page itself shows. */
export function hxRealSpecific(texts: readonly string[], baseline: ReadonlyMap<string, number>): string[] {
  const specific: string[] = [];
  for (const [name, count] of countNames(texts)) if (count > (baseline.get(name) ?? 0)) specific.push(name);
  return specific;
}

interface PageSeen {
  key: string;
  wanted: string;
  status: "seen" | "not-opened" | "out-of-time";
  reason: string;
  window: HxSettingsWindow | null;
  previous: readonly string[];
  seenMs: number | null;
  shot: string | undefined;
}

/** Runs every check on this machine. It never rejects: a check that stops is a failed check. */
export async function hxRealCheck(host: HxRealCheckHost): Promise<HxRealCheckResult> {
  const { platform } = host;
  const startedAt = host.now();
  const budgetMs = host.budgetMs ?? DEFAULT_BUDGET_MS;
  const items: HxCheckItem[] = [];
  const times = new Map<string, number[]>();
  const counter = { calls: 0 };
  const run: HxRunner = (command, args, options) => {
    counter.calls += 1;
    return host.run(command, args, options);
  };
  const system = host.system ?? hxRealSystem(platform, run);
  // A command gets as long as the app gives it: on Windows that is 90 seconds, because one start of
  // PowerShell took 22 seconds on an ARM machine and a query of the screen may wait 10 more.
  const commandLimit = platform === "windows" ? HX_WINDOWS_COMMAND_TIMEOUT_MS : 30_000;
  const exec = (command: HxCommand, timeoutMs = commandLimit) =>
    run(command.command, command.args, { timeoutMs, ...(command.env ? { env: command.env } : {}) });
  const outOfTime = () => host.now() - startedAt >= budgetMs;
  const time = (name: string, ms: number) => {
    times.set(name, [...(times.get(name) ?? []), Math.max(0, ms)]);
  };
  const record = (id: string, verdict: Verdict, ms: number) => {
    items.push({
      id,
      group: hxCheckGroup(id),
      outcome: verdict.outcome,
      detail: verdict.detail.slice(0, DETAIL_LIMIT),
      ms: Math.max(0, ms),
      ...(verdict.shot ? { shot: verdict.shot } : {}),
    });
    host.log?.(`${verdict.outcome.padEnd(11)} ${id}`);
  };
  const skip = (id: string, detail: string) => record(id, { outcome: "skipped", detail }, 0);
  const check = async (id: string, body: () => Promise<Verdict>): Promise<HxCheckOutcome> => {
    if (outOfTime()) {
      skip(id, "这次检查的时间用完了，这一项没有做。");
      return "skipped";
    }
    const began = host.now();
    let verdict: Verdict;
    try {
      verdict = await body();
    } catch (error) {
      verdict = failed(`检查程序在这一项上停下了：${error instanceof Error ? error.message : "原因不明"}`);
    }
    record(id, verdict, host.now() - began);
    return verdict.outcome;
  };
  /** Asks again and again until there is an answer or the time is up. */
  const until = async <T>(timeoutMs: number, stepMs: number, probe: () => Promise<T | null>) => {
    const began = host.now();
    for (let round = 0; round < 400; round += 1) {
      const value = await probe();
      const ms = host.now() - began;
      if (value !== null) return { value, ms };
      if (ms >= timeoutMs) break;
      await host.wait(stepMs);
    }
    return { value: null, ms: host.now() - began };
  };

  const tmp = join(host.out, "tmp");
  const shots = join(host.out, "screenshots");
  await mkdir(tmp, { recursive: true });
  if (host.screenshots) await mkdir(shots, { recursive: true });
  /** Saves a picture of the screen under this name; the file name when it worked. */
  const shot = async (name: string): Promise<string | undefined> => {
    if (!host.screenshots) return undefined;
    const file = `${name}.jpg`;
    try {
      return (await system.screenshot(join(shots, file))) ? file : undefined;
    } catch {
      return undefined;
    }
  };

  const catalogHost = {
    platform,
    run,
    home: host.home,
    chineseFirst: false,
    verified: false,
    now: host.now,
  };
  const catalog = new HxCatalog({ ...catalogHost, dataFolder: () => join(host.out, "data") });
  const actions = new HxComputerActions(catalog, run, host.wait);
  const pages: HxRealPageRecord[] = [];
  const chineseNames: string[] = [];
  /** The apps of this Mac with their Chinese names first, for the checks of the pinyin. */
  const chineseApps: HxCatalogEntry[] = [];
  // Filled in by the checks, which run later, inside `check`.
  const selfTest: { report: HxSelfTestReport | null } = { report: null };
  const about = { system: platform === "mac" ? "macOS" : "Windows", desktop: false, detail: "" };

  // ───────────────────────── 第 1 组：环境 ─────────────────────────
  const environment = { automation: true, accessibility: true };
  await check("env.system", async () => {
    const described = await system.describe();
    about.system = `${described.system} (${type()} ${release()} ${arch()})`;
    about.desktop = described.desktop;
    about.detail = described.detail;
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return passed(`${about.system}；Node ${process.version}；语言 ${locale}；${described.detail}`);
  });
  await check("env.desktop", async () => {
    if (about.desktop) return passed(`有桌面会话。${about.detail}`);
    // macOS says plainly which kind of session this is; Windows only hints at it.
    return platform === "mac"
      ? failed(`没有桌面会话，打开应用和窗口的检查都会失败。${about.detail}`)
      : review(`系统没有说这是交互式会话，以后面“打开”各项的结果为准。${about.detail}`);
  });
  if (platform === "mac") {
    await check("env.automation", async () => {
      const answer = await system.automation();
      environment.automation = answer.allowed;
      return answer.allowed
        ? passed(answer.detail)
        : failed(`这台机器不让脚本控制“系统事件”，经过它的设置都测不了。${answer.detail}`);
    });
    await check("env.accessibility", async () => {
      const answer = await system.accessibility();
      environment.accessibility = answer.allowed;
      return answer.allowed
        ? passed(answer.detail)
        : review(`读不到别的应用的窗口标题，设置页只能看截图。${answer.detail}`);
    });
  }

  // ───────────────────────── 第 2 组：目录 ─────────────────────────
  const first: { entries: HxCatalogEntry[]; builtAt: number | null } = { entries: [], builtAt: null };
  const present = new Map<HxRealApp, HxCatalogEntry>();
  await check("catalog.scan", async () => {
    const began = host.now();
    await catalog.rebuild();
    const ms = host.now() - began;
    time("catalog.scan", ms);
    const status = await catalog.status();
    first.entries = await catalog.entries();
    first.builtAt = status.builtAt;
    const detail = `${status.apps} 个应用，${status.pages} 个设置页，${status.settings} 项设置；用时 ${ms} 毫秒`;
    if (status.apps === 0) return failed(`没有读到任何应用。${detail}`);
    return status.apps < 20 ? review(`应用少于 20 个，看一下是不是漏了。${detail}`) : passed(detail);
  });
  await check("catalog.known", async () => {
    const here: string[] = [];
    const missing: string[] = [];
    const optional: string[] = [];
    for (const app of HX_REAL_APPS[platform]) {
      const entry = hxRealAppEntry(first.entries, app.marks);
      if (entry) {
        present.set(app, entry);
        here.push(`${app.query}（${entry.title}）`);
      } else if (app.required) missing.push(app.query);
      else optional.push(app.query);
    }
    const detail = `找到：${here.join("、") || "无"}${optional.length > 0 ? `；这台机器没有（不要求）：${optional.join("、")}` : ""}`;
    return missing.length > 0 ? failed(`系统自带的应用没有找到：${missing.join("、")}。${detail}`) : passed(detail);
  });
  if (platform === "mac") {
    await check("catalog.chinese", async () => {
      const chinese = new HxCatalog({
        ...catalogHost,
        chineseFirst: true,
        dataFolder: () => join(host.out, "data-zh"),
      });
      await chinese.rebuild();
      const list = (await chinese.entries()).filter((entry) => entry.kind === "app");
      chineseApps.push(...list);
      for (const entry of list) if (HAN.test(entry.title)) chineseNames.push(entry.title);
      const right: string[] = [];
      const other: string[] = [];
      const notRead: string[] = [];
      for (const [mark, name] of HX_REAL_MAC_CHINESE) {
        const entry = hxRealAppEntry(list, [mark]);
        if (!entry) continue;
        if (entry.title === name) right.push(name);
        else if (HAN.test(entry.title)) other.push(`${name} 实际是 ${entry.title}`);
        else notRead.push(`${name}（得到的是 ${entry.title}）`);
      }
      const detail = `${list.length} 个应用里有 ${chineseNames.length} 个取到了中文名；核对的几个：对的 ${right.join("、") || "无"}`;
      if (notRead.length > 0) return failed(`没有取到中文名：${notRead.join("、")}。${detail}`);
      return other.length > 0 ? review(`中文名和预期不同：${other.join("、")}。${detail}`) : passed(detail);
    });
  }
  await check("catalog.saved", async () => {
    const again = new HxCatalog({ ...catalogHost, dataFolder: () => join(host.out, "data") });
    const began = host.now();
    const list = await again.entries();
    const ms = host.now() - began;
    time("catalog.load", ms);
    const status = await again.status();
    const before = new Set(first.entries.map((entry) => entry.id));
    const same = list.length === first.entries.length && list.every((entry) => before.has(entry.id));
    if (status.builtAt !== first.builtAt) return failed("存盘的清单没有被用上：又扫描了一次。");
    return same
      ? passed(`从存盘读入 ${list.length} 个条目，用时 ${ms} 毫秒，没有再扫描。`)
      : failed(`从存盘读入的条目和扫描时不同：${list.length} 个对 ${first.entries.length} 个。`);
  });
  await check("catalog.rescan", async () => {
    const began = host.now();
    await catalog.rebuild();
    const ms = host.now() - began;
    time("catalog.rescan", ms);
    const list = await catalog.entries();
    const before = new Set(first.entries.map((entry) => entry.id));
    const after = new Set(list.map((entry) => entry.id));
    const added = [...after].filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !after.has(id));
    return added.length + removed.length === 0
      ? passed(`再扫描一次，${list.length} 个条目和第一次相同；用时 ${ms} 毫秒。`)
      : review(
          `两次扫描不同。多出：${clip(added.join(" "), 600) || "无"}；少了：${clip(removed.join(" "), 600) || "无"}`,
        );
  });
  await check("catalog.ids", async () => {
    const seen = new Set<string>();
    const twice = new Set<string>();
    for (const entry of first.entries) {
      if (seen.has(entry.id)) twice.add(entry.id);
      seen.add(entry.id);
    }
    return twice.size === 0
      ? passed(`${seen.size} 个编号，没有重复。`)
      : failed(`重复的编号：${clip([...twice].join(" "), 1000)}`);
  });

  // ───────────────────────── 第 3 组：检索 ─────────────────────────
  for (const [index, phrase] of HX_REAL_PHRASES[platform].entries()) {
    await check(`search.${String(index + 1).padStart(2, "0")}`, async () => {
      const hits = hxSearch(first.entries, phrase.phrase, { kinds: phrase.kinds, limit: 5 });
      const sure = hxSureHit(hits);
      const top = hits
        .slice(0, 3)
        .map((hit) => `${hit.entry.id}（${hit.entry.title}，${Math.round(hit.score)} 分）`)
        .join("；");
      const got = `认定：${sure ? sure.id : "没有认定"}；前三名：${top || "无"}`;
      if (phrase.expected === "ask") {
        return sure === null && hits.length >= 2
          ? passed(`“${phrase.phrase}”交回了 ${hits.length} 个候选，没有替模型选。`)
          : failed(`“${phrase.phrase}”应该交回候选。${got}`);
      }
      const wanted: string[] = [];
      for (const way of hxRealWays(phrase.expected)) {
        if ("id" in way) wanted.push(way.id);
        else {
          const entry = hxRealAppEntry(first.entries, [way.app]);
          if (entry) wanted.push(entry.id);
        }
      }
      if (wanted.length === 0) return unavailable(`“${phrase.phrase}”要找的应用不在这台机器上。`);
      if (sure) {
        return wanted.includes(sure.id)
          ? passed(`“${phrase.phrase}” → ${sure.id}`)
          : failed(`“${phrase.phrase}”应得 ${wanted.join(" 或 ")}。${got}`);
      }
      // A name that two entries carry, each of which takes the user to the same place ("关于本机" is
      // a page of the settings and an app of its own): handing both to the model is right.
      const best = hits[0]?.score ?? 0;
      const tied = hits.filter((hit) => hit.score === best).map((hit) => hit.entry.id);
      return wanted.length > 1 && tied.length > 1 && tied.every((id) => wanted.includes(id))
        ? passed(`“${phrase.phrase}”交回了同分的 ${tied.join("、")}，都通向同一处。`)
        : failed(`“${phrase.phrase}”应得 ${wanted.join(" 或 ")}。${got}`);
    });
  }

  // Every app with a Chinese name, typed in pinyin: whole, it must come first; by its first letters,
  // which several apps can share, it must be among the first five. The Macs of GitHub have the
  // Chinese names of their own apps; the Windows machines are in English and have none.
  if (platform === "mac") {
    const named = chineseApps.filter((entry) => HAN.test(entry.title));
    const typed = named.map((entry) => ({ entry, ways: hxPinyinTyped(entry.title) }));
    const unknown = typed.filter((one) => one.ways.length === 0).map((one) => one.entry.title);
    const rank = (query: string, limit: number) =>
      hxSearch(chineseApps, query, { kinds: ["app"], limit }).map((hit) => hit.entry.id);
    await check("search.pinyin-full", async () => {
      if (named.length === 0) return unavailable("这台 Mac 上没有读到应用的中文名。");
      const missed = typed.filter(({ entry, ways }) => ways[0] !== undefined && rank(ways[0], 1)[0] !== entry.id);
      const said = `${named.length} 个中文名里 ${named.length - unknown.length - missed.length} 个用全拼排第一`;
      const detail = `${said}；表里没有的字使它没有拼音的 ${unknown.length} 个：${unknown.join("、") || "无"}；没排第一的：${missed.map(({ entry, ways }) => `${entry.title}（${ways[0]}）`).join("、") || "无"}`;
      if (missed.length === 0) return passed(detail);
      return missed.length * 10 <= named.length ? review(detail) : failed(detail);
    });
    await check("search.pinyin-initials", async () => {
      const short = typed.filter(({ ways }) => ways[1] !== undefined);
      if (short.length === 0) return unavailable("这台 Mac 上没有可以用首字母找的中文名。");
      const missed = short.filter(({ entry, ways }) => !rank(ways[1] ?? "", 5).includes(entry.id));
      const detail = `${short.length} 个中文名里 ${short.length - missed.length} 个用首字母能在前五个里找到；找不到的：${missed.map(({ entry, ways }) => `${entry.title}（${ways[1]}）`).join("、") || "无"}`;
      if (missed.length === 0) return passed(detail);
      return missed.length * 5 <= short.length ? review(detail) : failed(detail);
    });
  }

  // ───────────────────────── 第 4 组：打开应用、文件夹、文档、网址 ─────────────────────────
  const running = async (names: readonly string[]) => {
    const ids = new Map<string, Set<number>>();
    for (const name of names) ids.set(name, new Set(await system.processIds(name)));
    return ids;
  };
  /** The first of these programs that has a process which was not there before. */
  const appeared = (names: readonly string[], before: ReadonlyMap<string, ReadonlySet<number>>) =>
    until(APPEAR_MS, 500, async () => {
      for (const name of names) {
        const fresh = (await system.processIds(name)).filter((id) => !before.get(name)?.has(id));
        if (fresh.length > 0) return { name, ids: fresh };
      }
      return null;
    });
  const why = (result: { status: string; reason?: string }) =>
    `回答是 ${result.status}${result.reason ? `：${result.reason}` : ""}`;

  await check("open.cost", async () => {
    const began = host.now();
    const opened = await actions.open({ id: "page:about" });
    const ms = host.now() - began;
    time("open.cost", ms);
    await system.closeSettings();
    const said = `打开一个设置页的命令用了 ${ms} 毫秒（回答 ${opened.status}）`;
    if (opened.status !== "opened") return failed(`${said}。${why(opened)}`);
    return ms > 10_000 ? review(`${said}，这台机器上太慢了，助手的每一次操作都会这么慢。`) : passed(said);
  });
  for (const app of HX_REAL_APPS[platform].filter((candidate) => candidate.open)) {
    await check(`open.app.${slug(app.query)}`, async () => {
      const entry = present.get(app);
      if (!entry) return unavailable("这台机器上没有这个应用。");
      const before = await running(app.processes);
      const began = host.now();
      const opened = await actions.open({ query: app.query });
      if (opened.status !== "opened") return failed(`按名称打开 ${app.query}，${why(opened)}`);
      if (!("id" in opened.what) || opened.what.id !== entry.id) {
        return failed(
          `按名称打开 ${app.query}，打开的却是 ${"title" in opened.what ? opened.what.title : "别的东西"}。`,
        );
      }
      const seen = await appeared(app.processes, before);
      if (!seen.value) {
        return failed(`命令成功了，但 ${APPEAR_MS / 1000} 秒内没有出现它的进程（${app.processes.join("、")}）。`);
      }
      const ms = host.now() - began;
      time("open.app", ms);
      await system.stop(seen.value.ids);
      return passed(`进程 ${seen.value.name} 在 ${ms} 毫秒后出现；已关掉。`);
    });
  }
  await check("open.folder", async () => {
    const folder = join(tmp, "hxbot-folder");
    await mkdir(folder, { recursive: true });
    const before = await system.folderWindows();
    const began = host.now();
    const opened = await actions.open({ path: folder });
    if (opened.status !== "opened") return failed(`打开文件夹，${why(opened)}`);
    if (before === null) return review("命令成功了，但这台机器上数不出文件夹窗口，看截图。", await shot("open-folder"));
    const seen = await until(APPEAR_MS, 500, async () => {
      const now = await system.folderWindows();
      return now !== null && now > before ? now : null;
    });
    const picture = await shot("open-folder");
    await system.closeFolders();
    if (seen.value === null) return failed(`命令成功了，但 ${APPEAR_MS / 1000} 秒内没有多出文件夹窗口。`, picture);
    time("open.folder", host.now() - began);
    return passed(`文件夹窗口从 ${before} 个变成 ${seen.value} 个，用时 ${seen.ms} 毫秒。`, picture);
  });
  await check("open.document", async () => {
    const file = join(tmp, "hxbot-note.txt");
    await writeFile(file, "HXBot computer check\n");
    const editors = HX_REAL_TEXT_EDITORS[platform];
    const before = await running(editors);
    const opened = await actions.open({ path: file });
    if (opened.status !== "opened") return failed(`打开 .txt 文件，${why(opened)}`);
    const seen = await appeared(editors, before);
    const picture = await shot("open-document");
    if (!seen.value) {
      return review(`命令成功了，但没有看到 ${editors.join("、")} 的新进程；这台机器可能用别的程序开 .txt。`, picture);
    }
    await system.stop(seen.value.ids);
    return passed(`${seen.value.name} 在 ${seen.ms} 毫秒后出现；已关掉。`, picture);
  });
  await check("open.url", async () => {
    const browsers = HX_REAL_BROWSERS[platform];
    const before = await running(browsers);
    const opened = await actions.open({ url: "https://example.com/" });
    if (opened.status !== "opened") return failed(`打开网址，${why(opened)}`);
    const seen = await appeared(browsers, before);
    const picture = await shot("open-url");
    if (!seen.value) return review(`命令成功了，但没有看到浏览器的新进程（${browsers.join("、")}）。`, picture);
    for (const name of browsers) {
      await system.stop((await system.processIds(name)).filter((id) => !before.get(name)?.has(id)));
    }
    return passed(`浏览器 ${seen.value.name} 在 ${seen.ms} 毫秒后出现；已关掉。`, picture);
  });
  for (const refused of HX_REAL_REFUSED.filter((candidate) => !candidate.only || candidate.only === platform)) {
    await check(`open.refuse.${slug(refused.name)}`, async () => {
      const file = join(tmp, refused.name);
      await writeFile(file, "echo HXBot must not run this\n");
      if (refused.runnable) await chmod(file, 0o755);
      const before = counter.calls;
      const result = await actions.open({ path: file });
      const started = counter.calls - before;
      if (result.status !== "refused") return failed(`${refused.name} 应该被拒绝，${why(result)}`);
      return started === 0
        ? passed(`${refused.name} 被拒绝，没有启动任何系统命令。`)
        : failed(`${refused.name} 被拒绝了，但期间启动了 ${started} 条系统命令。`);
    });
  }
  await check("open.refuse.scheme", async () => {
    const wrong: string[] = [];
    for (const address of HX_REAL_REFUSED_ADDRESSES) {
      const before = counter.calls;
      const result = await actions.open({ url: address });
      if ((result.status !== "refused" && result.status !== "invalid") || counter.calls !== before) {
        wrong.push(`${address}（${result.status}）`);
      }
    }
    return wrong.length === 0
      ? passed(`${HX_REAL_REFUSED_ADDRESSES.length} 个不是网页的地址都被拒绝，没有启动任何系统命令。`)
      : failed(`没有被拒绝：${wrong.join("、")}`);
  });
  await check("open.missing", async () => {
    const path = await actions.open({ path: join(tmp, "no-such-file.txt") });
    const words = "zzqxj no such app 0417";
    const name = await actions.open({ query: words });
    if (path.status === "not-found" && name.status === "not-found") {
      return passed("不存在的路径和不存在的名称都回答“没有找到”。");
    }
    // What a nonsense phrase was taken for says which name is too easy to hit.
    const hits = hxSearch(first.entries, words, { limit: 3 })
      .map((hit) => `${hit.entry.id}（${hit.entry.title}，${Math.round(hit.score)} 分）`)
      .join("；");
    const took =
      name.status === "opened" && "title" in name.what ? `，打开的是 ${name.what.title}` : `（${why(name)}）`;
    return failed(`不存在的路径回答 ${path.status}，不存在的名称回答 ${name.status}${took}。前三名：${hits || "无"}`);
  });

  // ───────────────────────── 第 6、7、8 组：读设置、原样写回、真改再改回 ─────────────────────────
  // 在设置页之前做：设置页是 57 页，机器慢的时候会把时间用完，而读写设置更重要。
  const original = new Map<string, string>();
  const verified: string[] = [];
  const untestable: string[] = [];
  const readValue = async (seed: HxSettingSeed) => {
    const result = await exec(seed.read);
    return { result, value: hxRunOk(result) ? seed.parse(result.stdout) : null };
  };
  /** Reads until the setting has this value; the system can need a moment. */
  const readBack = async (seed: HxSettingSeed, wanted: string) => {
    let last: string | null = null;
    for (const waitMs of READ_BACK_WAITS_MS) {
      if (waitMs > 0) await host.wait(waitMs);
      last = (await readValue(seed)).value;
      if (sameValue(seed, last, wanted)) return { ok: true, value: last };
    }
    return { ok: false, value: last };
  };
  for (const seed of catalog.settingSeeds()) {
    const id = `setting.${seed.key}`;
    const read: { value: string | null } = { value: null };
    const readOutcome = await check(`${id}.read`, async () => {
      const began = host.now();
      const { result, value } = await readValue(seed);
      const ms = host.now() - began;
      if (NOT_ALLOWED.test(result.stderr)) return unavailable("这台机器不让脚本控制“系统事件”。");
      if (!hxRunOk(result)) {
        const text = `${result.stdout}\n${result.stderr}`;
        return HX_REAL_NO_HARDWARE[platform][seed.key]?.test(text)
          ? unavailable(`这台机器没有相应的硬件。${output(result)}`)
          : failed(`读的命令出错。${output(result)}`);
      }
      if (value === null) return unavailable(`命令成功，但这台机器上没有值。${output(result, 200)}`);
      read.value = value;
      time("setting.read", ms);
      return passed(`${value}（${ms} 毫秒）`);
    });
    const before = read.value;
    if (before === null) {
      if (readOutcome === "unavailable") untestable.push(seed.key);
      continue;
    }
    original.set(seed.key, before);
    const sameOutcome = await check(`${id}.same`, async () => {
      const written = await exec(seed.write(before));
      if (!hxRunOk(written)) return failed(`把 ${before} 原样写回，写的命令出错。${output(written)}`);
      const after = await readBack(seed, before);
      return after.ok
        ? passed(`写回 ${before}，读到 ${after.value}`)
        : failed(`写回 ${before}，读到的却是 ${after.value ?? "没有值"}`);
    });
    const other = hxRealOtherValue(seed.values, before);
    if (sameOutcome !== "passed" || other === null) {
      if (other !== null) {
        skip(`${id}.change`, "原样写回没有通过，没有再真改。");
        skip(`${id}.restore`, "没有改过，不用改回。");
      }
      continue;
    }
    await shot(`setting-${seed.key}-before`);
    let effectOutcome: HxCheckOutcome | null = null;
    const changeOutcome = await check(`${id}.change`, async () => {
      const began = host.now();
      const written = await exec(seed.write(other));
      if (!hxRunOk(written)) return failed(`把 ${before} 改成 ${other}，写的命令出错。${output(written)}`);
      const after = await readBack(seed, other);
      const ms = host.now() - began;
      if (!after.ok) return failed(`写入 ${other}，读回的却是 ${after.value ?? "没有值"}`);
      time("setting.change", ms);
      if (host.screenshots) await host.wait(PAGE_SETTLE_MS);
      return passed(`${before} → ${after.value}（${ms} 毫秒）`, await shot(`setting-${seed.key}-after`));
    });
    const effect = hxRealEffect(platform, seed.key);
    if (effect && changeOutcome === "passed") {
      effectOutcome = await check(`${id}.effect`, async () => {
        const last: { result: HxRunResult | null } = { result: null };
        const seen = await until(EFFECT_WAIT_MS, 500, async () => {
          const result = await exec(effect.command);
          last.result = result;
          return effect.shows(result.stdout, result.code, other) ? result : null;
        });
        return seen.value
          ? passed(`换一条路读，也是 ${other}。${output(seen.value, 200)}`)
          : review(`换一条路读，没有读到 ${other}。${last.result ? output(last.result, 400) : ""}`);
      });
    } else if (effect) {
      skip(`${id}.effect`, "真改没有通过，没有再换一条路核对。");
    }
    const restoreOutcome = await check(`${id}.restore`, async () => {
      const written = await exec(seed.write(before));
      if (!hxRunOk(written)) return failed(`改回 ${before}，写的命令出错。${output(written)}`);
      const after = await readBack(seed, before);
      return after.ok ? passed(`改回了 ${before}`) : failed(`改回 ${before}，读到的却是 ${after.value ?? "没有值"}`);
    });
    // The same change in one process (combine.ts), which HXBot uses: its two readings must say what
    // the three steps said, and it is timed beside them.
    let fastOutcome: HxCheckOutcome = "passed";
    const fast = hxCombinedChange(platform, seed, other);
    if (fast && changeOutcome === "passed" && restoreOutcome === "passed") {
      fastOutcome = await check(`${id}.fast`, async () => {
        const began = host.now();
        const result = await exec(fast);
        const ms = host.now() - began;
        try {
          if (!hxRunOk(result)) return failed(`一次启动做完读、写、读，命令出错。${output(result)}`);
          const values = hxCombinedValues(seed, result.stdout);
          if (!values) return failed(`一次启动做完读、写、读，回答不是两次读数。${output(result, 400)}`);
          if (!sameValue(seed, values.before, before)) {
            return failed(`一次启动的第一次读数是 ${values.before}，三步做法读到的是 ${before}。`);
          }
          // A system that reports a moment late is read again, as HXBot does.
          const settled = sameValue(seed, values.after, other) ? { ok: true } : await readBack(seed, other);
          if (!settled.ok) return failed(`一次启动写入 ${other}，第二次读数是 ${values.after}，再等也没有变。`);
          time("setting.change.fast", ms);
          return passed(`${values.before} → ${values.after}（一次启动 ${ms} 毫秒）`);
        } finally {
          await exec(seed.write(before));
          await readBack(seed, before);
        }
      });
    } else if (fast) {
      skip(`${id}.fast`, "三步做法没有通过，没有再比一次启动的做法。");
    }
    if (
      changeOutcome === "passed" &&
      restoreOutcome === "passed" &&
      fastOutcome === "passed" &&
      (effectOutcome ?? "passed") === "passed"
    ) {
      verified.push(seed.key);
    }
  }

  // ───────────────────────── 第 5 组：逐页打开系统设置 ─────────────────────────
  const paneIds: { here: Set<string> | null } = { here: null };
  if (platform === "mac") {
    await check("page.panes", async () => {
      const here = await hxMacPanes(run, host.macExtensions);
      paneIds.here = here;
      const wanted = catalog.pageSeeds().map((seed) => seed.address.slice(seed.address.indexOf(":") + 1));
      const own = wanted.filter((id) => id.startsWith(HX_MAC_OWN_PANES));
      const missing = wanted.filter((id) => !id.startsWith(HX_MAC_OWN_PANES) && !here.has(id));
      const detail = `${wanted.length} 个地址里 ${wanted.length - own.length - missing.length} 个是这台 Mac 的设置面板；属于系统设置自身、无法这样核对的 ${own.length} 个；这台 Mac 共有 ${here.size} 个面板`;
      // A page whose pane is not an extension here can still open (Passwords on macOS 15, Screen
      // Saver on 26): whether it does is what page.<page> says. This only names them.
      // Whether those pages still open is what each page.<page> says; this only names them.
      return passed(
        missing.length === 0
          ? detail
          : `这些地址不是这台 Mac 的设置面板：${missing.join(" ")}；它们是否还能打开，看各自那一项。${detail}。这台 Mac 的面板：${clip([...here].sort().join(" "), 3500)}`,
      );
    });
  }
  // Windows Server has no Night light, no clipboard history, no Game Bar and no Windows Backup.
  const server = platform === "windows" && /server/iu.test(about.system);
  const seenPages: PageSeen[] = [];
  await system.closeSettings();
  let previousTexts: readonly string[] = [];
  for (const seed of catalog.pageSeeds()) {
    const base = {
      key: seed.key,
      wanted: seed.en,
      window: null,
      previous: previousTexts,
      seenMs: null,
      shot: undefined,
    };
    if (outOfTime()) {
      seenPages.push({ ...base, status: "out-of-time", reason: "" });
      continue;
    }
    try {
      const limit = seenPages.some((page) => page.window?.open) ? PAGE_WAIT_MS : FIRST_PAGE_WAIT_MS;
      let window: HxSettingsWindow | null = null;
      let seenMs: number | null = null;
      let reason = "";
      // The settings app can be closing just then (macOS does restart it), so a page whose window
      // never appeared is opened a second time before it counts as a failure.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const began = host.now();
        const opened = await actions.open({ id: `page:${seed.key}` });
        if (opened.status !== "opened") {
          reason = why(opened);
          break;
        }
        time("open.page.command", host.now() - began);
        let settled = false;
        for (let round = 0; round < 60; round += 1) {
          const asked = host.now();
          window = await system.settingsWindow();
          time("page.read", host.now() - asked);
          const elapsed = host.now() - began;
          if (window.blocked) break;
          const shown = hxRealPageShown(window.texts, seed.en);
          const moved = window.open && window.texts.length > 0 && !sameTexts(window.texts, previousTexts);
          if (shown || moved) {
            seenMs ??= elapsed;
            // macOS shows the name of the pane as the title: when it is the wanted one, nothing more is to come.
            // A read that took seconds itself (22 on an ARM computer we measured) gave the page that long.
            if ((shown && platform === "mac") || settled || host.now() - asked >= SLOW_READ_MS) break;
            settled = true;
            await host.wait(PAGE_SETTLE_MS);
            continue;
          }
          if (elapsed >= limit) break;
          await host.wait(PAGE_STEP_MS);
        }
        if (window?.open && window.texts.length > 0) break;
      }
      if (reason) {
        seenPages.push({ ...base, status: "not-opened", reason });
        continue;
      }
      const picture = await shot(`page-${seed.key}`);
      seenPages.push({ ...base, status: "seen", reason: "", window, seenMs, shot: picture });
      if (window?.open && window.texts.length > 0) previousTexts = window.texts;
    } catch (error) {
      seenPages.push({
        ...base,
        status: "not-opened",
        reason: `检查程序在这一页上停下了：${error instanceof Error ? error.message : "原因不明"}`,
      });
    }
  }
  await system.closeSettings();
  // What every page of the Settings app shows (its navigation) says nothing about one page. macOS
  // gives the name of the pane as the title of the window, so there everything that was read counts.
  const baseline =
    platform === "windows"
      ? hxRealBaseline(
          seenPages.flatMap((page) => (page.window?.open && page.window.texts.length > 0 ? [page.window.texts] : [])),
        )
      : new Map<string, number>();
  for (const page of seenPages) {
    const id = `page.${page.key}`;
    const note: HxRealPageNote = HX_REAL_PAGE_NOTES[platform][page.key] ?? {};
    const window = page.window;
    pages.push({ key: page.key, wanted: page.wanted, opened: page.status === "seen", seen: window?.raw ?? [] });
    if (page.status === "out-of-time") {
      skip(id, "这次检查的时间用完了，这一页没有开。");
      continue;
    }
    if (page.status === "not-opened" || !window) {
      record(id, failed(`打开“${page.wanted}”，${page.reason || "没有结果"}`), 0);
      continue;
    }
    const ms = page.seenMs ?? 0;
    if (window.blocked) {
      record(id, review(`读不到窗口标题，看截图是不是“${page.wanted}”。`, page.shot), ms);
      continue;
    }
    if (!window.open || window.texts.length === 0) {
      record(id, failed(`打开“${page.wanted}”的命令成功了，但设置窗口没有出现。`, page.shot), ms);
      continue;
    }
    const specific = hxRealSpecific(window.texts, baseline);
    const names = [page.wanted, ...(note.titles ?? [])];
    const showing = `窗口显示：${clip(specific.slice(0, 14).join(" / "), 700) || "没有这一页独有的文字"}`;
    if (names.some((name) => hxRealPageShown(specific, name))) {
      if (page.seenMs !== null) time("open.page", page.seenMs);
      record(id, passed(`${showing}（${ms} 毫秒）`, page.shot), ms);
      continue;
    }
    const still = sameTexts(window.texts, page.previous);
    const absent = paneIds.here !== null && !paneIds.here.has(paneOf(catalog, page.key)) && !ownPane(catalog, page.key);
    if (note.hardware) {
      record(id, unavailable(`“${page.wanted}”要有相应的硬件才有，这台机器没有显示它。${showing}`), ms);
    } else if (note.desktopOnly && server) {
      record(id, unavailable(`Windows Server 没有“${page.wanted}”这一页；桌面版的 Windows 有。${showing}`), ms);
    } else if (absent) {
      record(
        id,
        unavailable(`这台 Mac 没有“${page.wanted}”的设置面板，它在这个系统版本里不在这里。${showing}`, page.shot),
        ms,
      );
    } else if (still) {
      record(id, failed(`打开“${page.wanted}”后窗口没有动，地址可能无效。${showing}`, page.shot), ms);
    } else {
      record(id, review(`要的是“${page.wanted}”，自动核对拿不准。${showing}`, page.shot), ms);
    }
  }

  // ───────────────────────── 第 9 组：闸门和工具整条路 ─────────────────────────
  const gateFolder = join(host.out, "data-gate");
  const gateCatalog = new HxCatalog({ ...catalogHost, dataFolder: () => gateFolder });
  const gateActions = new HxComputerActions(gateCatalog, run, host.wait);
  /** One call of a tool, as an agent makes it; the answer is the JSON the model reads. */
  const call = async (
    tool: string,
    args: Readonly<Record<string, string | string[]>>,
    allowed: HxComputerAllowed = "yes",
  ) => {
    const result = await hxComputerToolCall(gateActions, allowed, { tool, arguments: args });
    const item = result.contentItems[0];
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(item?.type === "inputText" ? item.text : "null");
    } catch {
      parsed = null;
    }
    const answer = isDynamicRecord(parsed) ? parsed : {};
    const text = (name: string) => {
      const value = answer[name];
      return typeof value === "string" ? value : "";
    };
    /** A field of an object inside the answer, such as the id of `setting`; a text or a switch, else empty. */
    const inner = (name: string, field: string): string | boolean => {
      const value = answer[name];
      const found = isDynamicRecord(value) ? value[field] : "";
      return typeof found === "string" || typeof found === "boolean" ? found : "";
    };
    return { success: result.success, status: text("status"), text, inner, answer };
  };
  const seeds = catalog.settingSeeds();
  // A plain switch is the clearest; among those, one whose value the tool itself can write back.
  const plain = (seed: HxSettingSeed) => seed.values.type === "switch";
  const ownValue = (seed: HxSettingSeed) => {
    const value = original.get(seed.key);
    return value !== undefined && hxNormalizeValue(seed.values, value) !== null;
  };
  const useable = seeds.filter((seed) => verified.includes(seed.key));
  const gateSeed =
    useable.find((seed) => plain(seed) && ownValue(seed)) ??
    useable.find(plain) ??
    useable.find(ownValue) ??
    useable[0] ??
    null;
  const NO_SETTING = "这台机器上没有一项设置通过了读、写、改回，这一项做不了。";
  const gate: { value: string | null; other: string | null; direct: boolean } = {
    value: null,
    other: null,
    direct: false,
  };
  if (gateSeed) {
    const id = `setting:${gateSeed.key}`;
    await check("gate.before", async () => {
      const current = await call("computer_set", { id });
      if (current.status !== "value") return failed(`读 ${id}，回答是 ${current.status}：${current.text("reason")}`);
      const value = current.text("value");
      const other = hxRealOtherValue(gateSeed.values, value);
      if (other === null) return failed(`${id} 没有别的值可以改。`);
      gate.value = value;
      gate.other = other;
      const attempt = await call("computer_set", { id, value: other });
      const after = (await readValue(gateSeed)).value;
      await system.closeSettings();
      if (attempt.status !== "page") {
        if (after !== value) await exec(gateSeed.write(value));
        return failed(`这台电脑还没有自检过，${id} 却没有走设置页：回答是 ${attempt.status}。`);
      }
      return after === value
        ? passed(`自检之前改 ${id}：没有直接改，打开了设置页，值仍是 ${value}。`)
        : failed(`回答说打开了设置页，但值从 ${value} 变成了 ${after ?? "没有值"}。`);
    });
  } else {
    skip("gate.before", NO_SETTING);
  }
  await check("gate.selftest", async () => {
    const report = await hxSelfTest({
      catalog: gateCatalog,
      actions: gateActions,
      run,
      home: join(host.out, "home"),
      dataFolder: () => gateFolder,
      now: host.now,
      ...(host.macExtensions ? { macExtensions: host.macExtensions } : {}),
    });
    selfTest.report = report;
    await system.closeSettings();
    const counts = `自检 ${report.passed} 项通过、${report.failed} 项失败、${report.skipped} 项跳过`;
    if (report.items.length === 0) return failed("自检没有产生任何结果。");
    if (!gateSeed) return passed(`${counts}。`);
    const state = await gateCatalog.directState(`setting:${gateSeed.key}`);
    gate.direct = state === "direct";
    return gate.direct
      ? passed(`${counts}；${gateSeed.key} 现在记为“核对过”，可以直接改。`)
      : failed(`${counts}；但 ${gateSeed.key} 的状态是 ${state}，不是可以直接改。`);
  });
  await check("gate.selftest-items", async () => {
    const report = selfTest.report;
    if (!report) return failed("自检没有运行。");
    // The addresses of the settings panes are judged by page.panes, with the same list.
    const wrong = report.items.filter((item) => item.outcome === "failed" && item.id !== "mac.settings-pages");
    return wrong.length === 0
      ? passed(`自检的 ${report.items.length} 项里没有失败的（设置面板标识一项见 page.panes）。`)
      : failed(`自检里失败的项：${wrong.map((item) => `${item.id}（${clip(item.detail, 200)}）`).join("；")}`);
  });
  if (gateSeed && gate.value !== null && gate.other !== null && gate.direct) {
    const id = `setting:${gateSeed.key}`;
    const value = gate.value;
    const other = gate.other;
    const putBack = async () => {
      if ((await readValue(gateSeed)).value !== value) await exec(gateSeed.write(value));
    };
    await check("gate.after", async () => {
      try {
        const began = host.now();
        const attempt = await call("computer_set", { id, value: other });
        time("tool.set", host.now() - began);
        if (attempt.status !== "changed")
          return failed(`自检之后改 ${id}，回答是 ${attempt.status}：${attempt.text("reason")}`);
        if (attempt.text("previous") !== value || !sameValue(gateSeed, attempt.text("value"), other)) {
          return failed(
            `回答里的原值是 ${attempt.text("previous")}、新值是 ${attempt.text("value")}，应是 ${value} 和 ${other}。`,
          );
        }
        // Windows keeps the dark mode as two switches, so a computer can start in a mix ("system
        // only") that the tool does not take as a value: then the check puts the mix back itself.
        if (hxNormalizeValue(gateSeed.values, value) === null) {
          await exec(gateSeed.write(value));
          return passed(`自检之后直接改成功：${value} → ${other}，回答里带着原值；原值不是工具收的值，由检查写回。`);
        }
        const back = await call("computer_set", { id, value });
        return back.status === "changed" && (await readValue(gateSeed)).value === value
          ? passed(`自检之后直接改成功：${value} → ${other} → ${value}，回答里带着原值。`)
          : failed(`改回 ${value}，回答是 ${back.status}。`);
      } finally {
        await putBack();
      }
    });
    await check("tool.set.query", async () => {
      try {
        const words = `把${gateSeed.zh}打开`;
        const attempt = await call("computer_set", { query: words, value: other });
        if (attempt.status !== "changed")
          return failed(`用“${words}”改，回答是 ${attempt.status}：${attempt.text("reason")}`);
        return attempt.inner("setting", "id") === id
          ? passed(`用“${words}”找对了 ${id}，并改成了 ${other}；已改回。`)
          : failed(`用“${words}”改到的是 ${String(attempt.inner("setting", "id"))}，不是 ${id}。`);
      } finally {
        await putBack();
      }
    });
    await check("tool.set.invalid", async () => {
      const attempt = await call("computer_set", { id, value: "紫色" });
      const after = (await readValue(gateSeed)).value;
      if (after !== value) await exec(gateSeed.write(value));
      return attempt.status === "invalid-value" && attempt.text("expected") !== "" && after === value
        ? passed(`给了不合法的值：回答“值不对”，并说明要的是 ${attempt.text("expected")}；值没有变。`)
        : failed(`给了不合法的值，回答是 ${attempt.status}，值是 ${after ?? "没有值"}。`);
    });
    await check("tool.find", async () => {
      const found = await call("computer_find", { query: gateSeed.zh, kinds: ["setting"] });
      const results = Array.isArray(found.answer.results) ? found.answer.results : [];
      const settings = results.flatMap((result) => (isDynamicRecord(result) ? [result] : []));
      const top = settings[0];
      if (found.status !== "found" || !top) return failed(`查“${gateSeed.zh}”，回答是 ${found.status}。`);
      if (!settings.every((result) => typeof result.direct === "boolean"))
        return failed("结果里有设置没有标明能不能直接改。");
      return top.id === id && top.direct === true
        ? passed(`查“${gateSeed.zh}”：第一名是 ${id}，标着可以直接改；${settings.length} 个结果都标明了能不能直接改。`)
        : failed(`查“${gateSeed.zh}”：第一名是 ${String(top.id)}，direct 是 ${String(top.direct)}。`);
    });
  } else {
    const reason = gateSeed ? "闸门前两步没有通过，这一项没有做。" : NO_SETTING;
    for (const id of ["gate.after", "tool.set.query", "tool.set.invalid", "tool.find"]) skip(id, reason);
  }
  await check("tool.set.security", async () => {
    const attempt = await call("computer_set", { id: "page:privacy", value: "on" });
    const picture = await shot("tool-security-page");
    await system.closeSettings();
    return attempt.status === "page" && attempt.inner("page", "security") === true
      ? passed("对安全相关的页面调用 computer_set：只打开了页面，回答里标明是安全页面。", picture)
      : failed(`对安全相关的页面调用 computer_set，回答是 ${attempt.status}。`, picture);
  });
  await check("tool.refuse", async () => {
    const before = counter.calls;
    const off = await call("computer_open", { id: "page:about" }, "off");
    const task = await call("computer_open", { id: "page:about" }, "task");
    const both = await call("computer_open", { id: "page:about", url: "https://example.com/" });
    const quiet = counter.calls === before;
    return off.status === "refused" && task.status === "refused" && both.status === "invalid" && !off.success && quiet
      ? passed("助手没开 Computer Use、在任务里、参数给错这三种情况都被挡住，没有启动任何系统命令。")
      : failed(
          `三种情况的回答是 ${off.status}、${task.status}、${both.status}；期间启动了 ${counter.calls - before} 条系统命令。`,
        );
  });

  // ───────────────────────── 第 11 组：为新增设置做的探测（只读） ─────────────────────────
  for (const probe of HX_REAL_PROBES[platform]) {
    await check(`probe.${probe.id}`, async () => {
      const began = host.now();
      const result = await exec(probe.command, probe.timeoutMs ?? 30_000);
      const ms = host.now() - began;
      const detail = `${ms} 毫秒，${output(result, 3000)}`;
      return hxRunOk(result) && result.stdout.trim() !== "" ? passed(detail) : unavailable(detail);
    });
  }

  // ───────────────────────── 收尾 ─────────────────────────
  // Not through `check`: this must run even when the time is used up.
  const putRight: string[] = [];
  const stillWrong: string[] = [];
  for (const seed of catalog.settingSeeds()) {
    const before = original.get(seed.key);
    if (before === undefined) continue;
    try {
      const now = (await readValue(seed)).value;
      if (sameValue(seed, now, before)) continue;
      await exec(seed.write(before));
      const after = await readBack(seed, before);
      const said = `${seed.key}（开始时 ${before}，后来是 ${now ?? "没有值"}`;
      if (after.ok) putRight.push(`${said}，已写回）`);
      else stillWrong.push(`${said}，写不回，现在是 ${after.value ?? "没有值"}）`);
    } catch {
      stillWrong.push(`${seed.key}（没能核对）`);
    }
  }
  // A setting can change because another one was changed (moving the Dock changes its size), which
  // is the system's own doing, not something that went wrong: it is put back and named.
  record(
    "final.restored",
    stillWrong.length > 0
      ? failed(
          `结束时写不回开始时的值：${stillWrong.join("、")}${putRight.length > 0 ? `。另外已写回：${putRight.join("、")}` : ""}`,
        )
      : putRight.length > 0
        ? review(`这些设置中途被别的改动带着变了，已写回开始时的值：${putRight.join("、")}`)
        : passed(`${original.size} 项读到过值的设置，结束时都是开始时的值。`),
    0,
  );
  try {
    await system.closeSettings();
    await system.closeFolders();
    await rm(tmp, { recursive: true, force: true });
    record("final.cleanup", passed("关掉了设置窗口和文件夹窗口，删掉了临时文件。"), 0);
  } catch (error) {
    record("final.cleanup", review(`收尾时出错：${error instanceof Error ? error.message : "原因不明"}`), 0);
  }

  const report: HxCheckReport = {
    format: 1,
    machine: host.machine,
    platform,
    system: about.system,
    startedAt,
    finishedAt: host.now(),
    items,
    times: Object.fromEntries([...times].map(([name, values]) => [name, hxMedian(values)])),
    verified,
    untestable,
  };
  return { report, pages, selfTest: selfTest.report, chineseNames };
}

function paneOf(catalog: HxCatalog, key: string): string {
  const address = catalog.pageSeeds().find((seed) => seed.key === key)?.address ?? "";
  return address.slice(address.indexOf(":") + 1);
}

function ownPane(catalog: HxCatalog, key: string): boolean {
  return paneOf(catalog, key).startsWith(HX_MAC_OWN_PANES);
}
