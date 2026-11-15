// HXBot 电脑操控：这台电脑的目录。三部分：内置的系统设置页面、内置的可以直接读写的设置、扫描出来的应用。
// 应用清单存在 HXBot 的数据文件夹里（hx-computer/catalog.json），启动后直接读。清单过了一天，先用旧的、
// 同时在后面重新读一遍；这次没读到（系统命令一时出错），旧清单照用，过十分钟再试。
// 哪些设置在这台电脑上核对没通过，也记在那里（state.json）：七天内改为打开它所在的设置页，七天后再试一次。
// 同一个文件里还记着哪些设置在这台电脑的自检里通过了：一个系统在真机上验证过之前（verified.ts），
// 助手只直接修改这些通过了的设置。
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HxCatalogEntry, HxComputerPlatform, HxComputerStatus } from "@hxbot/contracts/hx-computer";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { hxMacApps, hxWinApps } from "./apps";
import type { HxRunner } from "./runner";
import { hxPinyinNames } from "./search";
import type { HxPageSeed, HxSettingSeed } from "./tables";
import { HX_MAC_PAGES, HX_MAC_SETTINGS } from "./tables-mac";
import { HX_WIN_PAGES, HX_WIN_SETTINGS } from "./tables-win";

const FOLDER = "hx-computer";
const CATALOG_FILE = "catalog.json";
const STATE_FILE = "state.json";
const FORMAT = 1;
/** After this long the list of apps is read again the next time it is needed. */
export const HX_CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A scan that gave nothing is tried again after this long, not at once: a failing command takes seconds. */
export const HX_CATALOG_RETRY_MS = 10 * 60 * 1000;
/** A setting that failed its check is tried again after this long: the cause can be gone (a system update, a new HXBot). */
export const HX_DISABLED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export interface HxCatalogHost {
  platform: HxComputerPlatform | null;
  run: HxRunner;
  home: string;
  /** HXBot's data folder, or null before the app has set it; nothing is saved then. */
  dataFolder(): string | null;
  /** The system is used in Chinese, so Chinese names come first. */
  chineseFirst: boolean;
  /**
   * The settings whose direct change was verified on real computers of this system (verified.ts), by
   * key; `true` is every setting. Another setting is changed directly only after the self-test passed
   * for it on this computer.
   */
  verified: boolean | readonly string[];
  now(): number;
}

/** Why a setting is, or is not, changed without its settings page right now. */
export type HxDirectState = "direct" | "unchecked" | "disabled";

/**
 * The commands of a setting as one short text. A check of this computer counts for these commands;
 * a later version that reads or writes the setting another way has to be checked again.
 */
export function hxSeedFingerprint(seed: HxSettingSeed): string {
  const values =
    seed.values.type === "switch"
      ? ["on", "off"]
      : seed.values.type === "number"
        ? [String(seed.values.min), String(seed.values.max)]
        : seed.values.type === "choice"
          ? [...seed.values.options]
          : ["/file"];
  const commands = [seed.read, ...values.map((value) => seed.write(value))].map((command) => [
    command.command,
    command.args,
  ]);
  return createHash("sha256").update(JSON.stringify(commands)).digest("hex").slice(0, 16);
}

interface Named {
  zh: string;
  en: string;
  pinyin: string;
  more?: readonly string[];
}

/**
 * Pinyin that more than one built-in entry would answer to (主题 and 字体 are both "zt"). Typing it
 * finds each of them by its other names; as a name of its own it would point at two things.
 */
function sharedPinyin(seeds: readonly Named[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const seed of seeds) {
    for (const name of new Set(hxPinyinNames(seed.pinyin))) {
      if (seen.has(name)) shared.add(name);
      seen.add(name);
    }
  }
  return shared;
}

function names(seed: Named, shared: ReadonlySet<string>): string[] {
  const pinyin = hxPinyinNames(seed.pinyin).filter((name) => !shared.has(name));
  return [...new Set([seed.zh, seed.en, ...(seed.more ?? []), ...pinyin])];
}

function isEntry(value: unknown): value is HxCatalogEntry {
  return (
    isDynamicRecord(value) &&
    typeof value.id === "string" &&
    value.kind === "app" &&
    typeof value.title === "string" &&
    typeof value.target === "string" &&
    Array.isArray(value.names) &&
    value.names.every((name) => typeof name === "string") &&
    value.risk === 1
  );
}

export class HxCatalog {
  readonly #host: HxCatalogHost;
  #apps: HxCatalogEntry[] | null = null;
  #builtAt: number | null = null;
  /** When the last scan started, whatever it gave. */
  #triedAt: number | null = null;
  /** The settings that failed their check, with the time of the failure. */
  #disabled: Map<string, number> | null = null;
  /** The settings that passed the self-test on this computer, with the fingerprint of their commands then. */
  #checked: Map<string, string> | null = null;
  #building: Promise<void> | null = null;
  #shared: Set<string> | null = null;

  constructor(host: HxCatalogHost) {
    this.#host = host;
  }

  get platform(): HxComputerPlatform | null {
    return this.#host.platform;
  }

  pageSeeds(): readonly HxPageSeed[] {
    if (this.#host.platform === "mac") return HX_MAC_PAGES;
    return this.#host.platform === "windows" ? HX_WIN_PAGES : [];
  }

  settingSeeds(): readonly HxSettingSeed[] {
    if (this.#host.platform === "mac") return HX_MAC_SETTINGS;
    return this.#host.platform === "windows" ? HX_WIN_SETTINGS : [];
  }

  settingSeed(id: string): HxSettingSeed | null {
    return this.settingSeeds().find((seed) => `setting:${seed.key}` === id) ?? null;
  }

  #sharedPinyin(): Set<string> {
    this.#shared ??= sharedPinyin([...this.pageSeeds(), ...this.settingSeeds()]);
    return this.#shared;
  }

  #pages(): HxCatalogEntry[] {
    const shared = this.#sharedPinyin();
    return this.pageSeeds().map((seed) => ({
      id: `page:${seed.key}`,
      kind: "page",
      title: this.#host.chineseFirst ? seed.zh : seed.en,
      names: names(seed, shared),
      risk: seed.security ? 3 : 1,
      target: seed.address,
    }));
  }

  #settings(notDirect: ReadonlySet<string>): HxCatalogEntry[] {
    const shared = this.#sharedPinyin();
    return this.settingSeeds().map((seed) => ({
      id: `setting:${seed.key}`,
      kind: "setting",
      title: this.#host.chineseFirst ? seed.zh : seed.en,
      names: names(seed, shared),
      risk: 1,
      page: `page:${seed.page}`,
      values: seed.values,
      direct: !notDirect.has(`setting:${seed.key}`),
    }));
  }

  #file(name: string): string | null {
    const folder = this.#host.dataFolder();
    return folder ? join(folder, FOLDER, name) : null;
  }

  async #readJson(name: string): Promise<unknown> {
    const file = this.#file(name);
    if (!file) return null;
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      return null;
    }
  }

  async #writeJson(name: string, value: unknown): Promise<void> {
    const file = this.#file(name);
    const folder = this.#host.dataFolder();
    if (!file || !folder) return;
    try {
      await mkdir(join(folder, FOLDER), { recursive: true, mode: 0o700 });
      const draft = `${file}.${process.pid}.tmp`;
      await writeFile(draft, JSON.stringify(value), { mode: 0o600 });
      await rename(draft, file);
    } catch {
      // The catalog still works from memory; it is read again after the next start.
    }
  }

  /** Reads state.json once: the settings that failed, and the settings that passed the self-test here. */
  async #loadState(): Promise<{ disabled: Map<string, number>; checked: Map<string, string> }> {
    if (this.#disabled && this.#checked) return { disabled: this.#disabled, checked: this.#checked };
    const saved = await this.#readJson(STATE_FILE);
    const record = isDynamicRecord(saved) ? saved : {};
    const disabled = new Map<string, number>();
    for (const item of Array.isArray(record.disabled) ? record.disabled : []) {
      if (isDynamicRecord(item) && typeof item.id === "string" && typeof item.at === "number") {
        disabled.set(item.id, item.at);
      }
    }
    const checked = new Map<string, string>();
    for (const item of Array.isArray(record.checked) ? record.checked : []) {
      if (isDynamicRecord(item) && typeof item.id === "string" && typeof item.commands === "string") {
        checked.set(item.id, item.commands);
      }
    }
    this.#disabled = disabled;
    this.#checked = checked;
    return { disabled, checked };
  }

  async #saveState(): Promise<void> {
    const { disabled, checked } = await this.#loadState();
    const byId = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id);
    await this.#writeJson(STATE_FILE, {
      format: FORMAT,
      disabled: [...disabled].map(([id, at]) => ({ id, at })).sort(byId),
      checked: [...checked].map(([id, commands]) => ({ id, commands })).sort(byId),
    });
  }

  async #disabledTimes(): Promise<Map<string, number>> {
    return (await this.#loadState()).disabled;
  }

  /** The settings HXBot does not change directly right now. */
  async #disabledNow(): Promise<Set<string>> {
    const now = this.#host.now();
    const ids = new Set<string>();
    for (const [id, at] of await this.#disabledTimes()) {
      // A clock that was set back must not keep a setting off for longer than the wait.
      if (Math.abs(now - at) < HX_DISABLED_RETRY_MS) ids.add(id);
    }
    return ids;
  }

  /**
   * A setting whose change did not take effect on this computer: for a week HXBot opens its page
   * instead. Then the direct change is tried once more.
   */
  async disable(id: string): Promise<void> {
    const times = await this.#disabledTimes();
    times.set(id, this.#host.now());
    await this.#saveState();
  }

  async isDisabled(id: string): Promise<boolean> {
    return (await this.#disabledNow()).has(id);
  }

  /** The settings whose commands, as they are now, passed the self-test on this computer. */
  async #checkedNow(): Promise<Set<string>> {
    const { checked } = await this.#loadState();
    const ids = new Set<string>();
    for (const seed of this.settingSeeds()) {
      const id = `setting:${seed.key}`;
      if (checked.get(id) === hxSeedFingerprint(seed)) ids.add(id);
    }
    return ids;
  }

  /**
   * The self-test read this setting, wrote the same value back and read it again, and all of it worked
   * on this computer. It also ends an earlier failure of the setting: the commands work now.
   */
  async markChecked(id: string): Promise<void> {
    const seed = this.settingSeed(id);
    if (!seed) return;
    const { disabled, checked } = await this.#loadState();
    checked.set(id, hxSeedFingerprint(seed));
    disabled.delete(id);
    await this.#saveState();
  }

  /**
   * Whether HXBot changes this setting without its settings page right now. `disabled`: a change did
   * not take effect lately. `unchecked`: this system is not verified yet and the self-test has not
   * passed for the setting on this computer.
   */
  async directState(id: string): Promise<HxDirectState> {
    if (await this.isDisabled(id)) return "disabled";
    if (this.#isVerified(id) || (await this.#checkedNow()).has(id)) return "direct";
    return "unchecked";
  }

  /** Whether the direct change of this setting was verified on real computers of this system. */
  #isVerified(id: string): boolean {
    const verified = this.#host.verified;
    if (typeof verified === "boolean") return verified;
    return verified.some((key) => `setting:${key}` === id);
  }

  /** The settings that are not changed directly right now, for whichever reason. */
  async #notDirect(): Promise<{ disabled: Set<string>; unchecked: Set<string> }> {
    const disabled = await this.#disabledNow();
    const unchecked = new Set<string>();
    const checked = await this.#checkedNow();
    for (const seed of this.settingSeeds()) {
      const id = `setting:${seed.key}`;
      if (!this.#isVerified(id) && !checked.has(id) && !disabled.has(id)) unchecked.add(id);
    }
    return { disabled, unchecked };
  }

  async #load(): Promise<void> {
    if (this.#apps) return;
    const saved = await this.#readJson(CATALOG_FILE);
    if (
      isDynamicRecord(saved) &&
      saved.format === FORMAT &&
      saved.platform === this.#host.platform &&
      typeof saved.builtAt === "number" &&
      Array.isArray(saved.apps)
    ) {
      const apps = saved.apps.filter(isEntry);
      // A list without apps is not a list: the scan runs as if nothing was saved.
      if (apps.length === 0) return;
      this.#apps = apps;
      this.#builtAt = saved.builtAt;
    }
  }

  /** Reads the apps of this computer again. Calls that arrive while one runs wait for it. It never rejects. */
  rebuild(): Promise<void> {
    this.#building ??= this.#build().finally(() => {
      this.#building = null;
    });
    return this.#building;
  }

  /** Reads the apps again unless a scan started less than `minAgeMs` ago. */
  async refresh(minAgeMs: number): Promise<void> {
    if (this.#triedAt !== null && Math.abs(this.#host.now() - this.#triedAt) < minAgeMs) return;
    await this.rebuild();
  }

  async #build(): Promise<void> {
    const host = this.#host;
    this.#triedAt = host.now();
    let apps: HxCatalogEntry[] = [];
    try {
      if (host.platform === "mac") apps = await hxMacApps(host.run, host.home, host.chineseFirst);
      if (host.platform === "windows") apps = await hxWinApps(host.run);
    } catch {
      apps = [];
    }
    if (apps.length === 0) {
      // Every computer has apps, so an empty answer is a scan that failed. The earlier list stays, and
      // the time of the last good scan too, so that the next try comes after HX_CATALOG_RETRY_MS.
      this.#apps ??= [];
      return;
    }
    this.#apps = apps;
    this.#builtAt = host.now();
    await this.#writeJson(CATALOG_FILE, { format: FORMAT, platform: host.platform, builtAt: this.#builtAt, apps });
  }

  /**
   * Every entry. Without a list of apps the first call waits for the scan. With a list that is a day old
   * the call answers from it at once and the scan runs behind it.
   */
  async entries(): Promise<HxCatalogEntry[]> {
    if (this.#host.platform === null) return [];
    await this.#load();
    const now = this.#host.now();
    const stale = this.#builtAt === null || Math.abs(now - this.#builtAt) > HX_CATALOG_MAX_AGE_MS;
    const mayTry = this.#triedAt === null || Math.abs(now - this.#triedAt) > HX_CATALOG_RETRY_MS;
    if (this.#apps === null) await this.rebuild();
    else if (stale && mayTry) void this.rebuild();
    const { disabled, unchecked } = await this.#notDirect();
    return [...this.#pages(), ...this.#settings(new Set([...disabled, ...unchecked])), ...(this.#apps ?? [])];
  }

  async entry(id: string): Promise<HxCatalogEntry | null> {
    return (await this.entries()).find((entry) => entry.id === id) ?? null;
  }

  /** What Settings shows. It never starts a scan: before the first one the counts of apps are zero. */
  async status(): Promise<HxComputerStatus> {
    if (this.#host.platform !== null) await this.#load();
    const { disabled, unchecked } = await this.#notDirect();
    const settings = this.settingSeeds();
    return {
      platform: this.#host.platform,
      builtAt: this.#builtAt,
      apps: this.#apps?.length ?? 0,
      pages: this.pageSeeds().length,
      settings: settings.length,
      directSettings: settings.length - disabled.size - unchecked.size,
      disabled: [...disabled].sort(),
      unchecked: unchecked.size,
    };
  }
}
