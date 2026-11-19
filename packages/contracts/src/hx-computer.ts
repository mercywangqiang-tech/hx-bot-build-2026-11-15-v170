// HXBot 电脑操控（一）：这台电脑的目录（应用、系统设置页、可以直接读写的设置）在后台和界面之间传的内容，
// 以及三个工具（computer_find、computer_open、computer_set）共用的类型。实现在 src/backend/hx-computer。
import { isDynamicRecord } from "./runtime-values";

export type HxComputerPlatform = "mac" | "windows";

/** What an entry is: an installed app, a page of the system settings, or one setting. */
export type HxCatalogKind = "app" | "page" | "setting";

/**
 * What an action can cost. 0 only reads. 1 can be undone (a personal preference). 3 is a security
 * setting: HXBot opens its page and never changes it by itself.
 */
export type HxComputerRisk = 0 | 1 | 3;

export type HxSettingValues =
  | { type: "switch" }
  | { type: "number"; min: number; max: number }
  | { type: "choice"; options: readonly string[] }
  | { type: "file" };

export interface HxCatalogEntry {
  /** Stable on one computer: `app:…`, `page:…`, `setting:…`. */
  id: string;
  kind: HxCatalogKind;
  /** The name shown to the user and the model. */
  title: string;
  /** Every name the entry answers to: other languages, aliases, pinyin. */
  names: readonly string[];
  risk: HxComputerRisk;
  /** An app: where it is, or how the system knows it. */
  target?: string;
  /** A setting: the page it is on. */
  page?: string;
  /** A setting: what it takes. */
  values?: HxSettingValues;
  /** A setting: HXBot can read and change it without the settings page. */
  direct?: boolean;
}

/** What Settings → Computer Use shows of the catalog. */
export interface HxComputerStatus {
  platform: HxComputerPlatform | null;
  builtAt: number | null;
  apps: number;
  pages: number;
  settings: number;
  directSettings: number;
  /** The settings whose check failed on this computer; HXBot opens their page instead. */
  disabled: string[];
  /**
   * How many settings wait for the self-test: until this system is verified, HXBot changes a setting
   * directly only after the self-test passed for it on this computer.
   */
  unchecked: number;
  /**
   * HXBot (v1.7.3, CONC-06): “停放后自动续做”. A step parked because the user used the computer goes on
   * by itself after the user stopped. Absent from an older main process: on.
   */
  autoResume?: boolean;
}

export type HxSelfTestOutcome = "passed" | "failed" | "skipped";

export interface HxSelfTestItem {
  id: string;
  outcome: HxSelfTestOutcome;
  detail: string;
  ms: number;
}

export interface HxSelfTestReport {
  platform: HxComputerPlatform | null;
  system: string;
  startedAt: number;
  finishedAt: number;
  items: HxSelfTestItem[];
  passed: number;
  failed: number;
  skipped: number;
  /** Where the report was saved, or an empty string when it could not be. */
  file: string;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function platform(value: unknown): HxComputerPlatform | null {
  return value === "mac" || value === "windows" ? value : null;
}

/** The status as main sends it. Anything missing reads as an empty catalog. */
export function decodeHxComputerStatus(value: unknown): HxComputerStatus {
  const record = isDynamicRecord(value) ? value : {};
  return {
    platform: platform(record.platform),
    builtAt: typeof record.builtAt === "number" && Number.isFinite(record.builtAt) ? record.builtAt : null,
    apps: count(record.apps),
    pages: count(record.pages),
    settings: count(record.settings),
    directSettings: count(record.directSettings),
    disabled: (Array.isArray(record.disabled) ? record.disabled : []).flatMap((id) =>
      typeof id === "string" ? [id.slice(0, 200)] : [],
    ),
    unchecked: count(record.unchecked),
    autoResume: record.autoResume !== false,
  };
}

function outcome(value: unknown): HxSelfTestOutcome {
  return value === "passed" || value === "skipped" ? value : "failed";
}

/** The self-test report as main sends it. The totals are counted again from the items. */
export function decodeHxSelfTestReport(value: unknown): HxSelfTestReport {
  const record = isDynamicRecord(value) ? value : {};
  const items = (Array.isArray(record.items) ? record.items : []).flatMap((item) =>
    isDynamicRecord(item)
      ? [
          {
            id: text(item.id, 200),
            outcome: outcome(item.outcome),
            detail: text(item.detail, 2000),
            ms: count(item.ms),
          },
        ]
      : [],
  );
  return {
    platform: platform(record.platform),
    system: text(record.system, 400),
    startedAt: count(record.startedAt),
    finishedAt: count(record.finishedAt),
    items,
    passed: items.filter((item) => item.outcome === "passed").length,
    failed: items.filter((item) => item.outcome === "failed").length,
    skipped: items.filter((item) => item.outcome === "skipped").length,
    file: text(record.file, 2000),
  };
}
