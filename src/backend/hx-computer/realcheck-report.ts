// HXBot 电脑操控：真系统检查（GitHub 的 Mac、Windows 机器上跑）的成绩单。
// 这里只有数据的形状和文字的生成：每一项的结果、每台机器的小结、几台机器合成的总成绩单。
// 检查本身在 realcheck.ts；入口在 scripts/hx-computer-check.ts。
import type { HxComputerPlatform } from "@hxbot/contracts/hx-computer";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";

/**
 * How one check ended.
 * - `passed`: done, and the result was right.
 * - `failed`: done, and the result was wrong, or a command of HXBot failed. It turns the run red.
 * - `review`: done, but the automatic comparison is not sure; a person looks at the detail or the screenshot.
 * - `unavailable`: this machine does not have what the check needs (no sound device, no such registry value).
 * - `skipped`: an earlier check that this one depends on did not pass.
 */
export type HxCheckOutcome = "passed" | "failed" | "review" | "unavailable" | "skipped";

export const HX_CHECK_OUTCOMES: readonly HxCheckOutcome[] = ["passed", "failed", "review", "unavailable", "skipped"];

export interface HxCheckItem {
  /** `page.bluetooth`, `setting.dark-mode.change`. */
  id: string;
  /** The part before the first dot: `page`, `setting`. */
  group: string;
  outcome: HxCheckOutcome;
  /** What was seen, in a line or a few. */
  detail: string;
  ms: number;
  /** The screenshot taken for this check, as a file name inside `screenshots/`. */
  shot?: string;
}

export interface HxCheckReport {
  format: 1;
  /** The label of the machine: `macos-15`, `windows-2025`. */
  machine: string;
  platform: HxComputerPlatform | null;
  /** `macOS 15.1 (Darwin 24.1.0 arm64)`. */
  system: string;
  startedAt: number;
  finishedAt: number;
  items: HxCheckItem[];
  /** Median times in milliseconds: `catalog.scan`, `open.page`, `setting.read`, `setting.change`. */
  times: Record<string, number>;
  /** The settings that passed read, write-same, change and restore on this machine. */
  verified: string[];
  /** The settings this machine could not test. */
  untestable: string[];
}

const LABELS: Readonly<Record<HxCheckOutcome, string>> = {
  passed: "通过",
  failed: "失败",
  review: "待看",
  unavailable: "测不了",
  skipped: "跳过",
};

/** What each group is, for the table of the summary. The order is the order of the checks. */
export const HX_CHECK_GROUPS: ReadonlyArray<readonly [group: string, title: string]> = [
  ["env", "环境"],
  ["catalog", "目录"],
  ["search", "检索"],
  ["open", "打开应用、文件、网址"],
  ["page", "逐页打开系统设置"],
  ["setting", "读写设置"],
  ["gate", "闸门"],
  ["tool", "工具整条路"],
  ["probe", "为新增设置做的探测"],
  ["final", "收尾"],
];

export function hxCheckGroup(id: string): string {
  const dot = id.indexOf(".");
  return dot < 0 ? id : id.slice(0, dot);
}

export function hxCheckCounts(items: readonly HxCheckItem[]): Record<HxCheckOutcome, number> {
  const counts: Record<HxCheckOutcome, number> = { passed: 0, failed: 0, review: 0, unavailable: 0, skipped: 0 };
  for (const item of items) counts[item.outcome] += 1;
  return counts;
}

/** The middle value; the lower of the two middle ones for an even count. Zero for nothing. */
export function hxMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

function cell(text: string, limit = 400): string {
  const flat = text.replace(/\s+/gu, " ").replace(/\|/gu, "\\|").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function itemTable(title: string, items: readonly HxCheckItem[], limit: number): string[] {
  if (items.length === 0) return [];
  const lines = [`### ${title}（${items.length} 项）`, "", "| 编号 | 看到了什么 |", "|---|---|"];
  for (const item of items.slice(0, limit)) lines.push(`| \`${item.id}\` | ${cell(item.detail)} |`);
  if (items.length > limit) lines.push(`| … | 还有 ${items.length - limit} 项，见 report.json |`);
  lines.push("");
  return lines;
}

/** The summary of one machine, as it is shown on the page of the run. */
export function hxCheckSummary(report: HxCheckReport): string {
  const counts = hxCheckCounts(report.items);
  const seconds = Math.max(0, Math.round((report.finishedAt - report.startedAt) / 1000));
  const lines = [
    `## ${report.machine}：${counts.failed > 0 ? "有失败" : counts.review > 0 ? "没有失败，有待看的" : "全部通过"}`,
    "",
    `系统：${report.system}。用时 ${seconds} 秒。`,
    "",
    `| 组 | ${HX_CHECK_OUTCOMES.map((outcome) => LABELS[outcome]).join(" | ")} |`,
    `|---|${HX_CHECK_OUTCOMES.map(() => "---:").join("|")}|`,
  ];
  for (const [group, title] of HX_CHECK_GROUPS) {
    const items = report.items.filter((item) => item.group === group);
    if (items.length === 0) continue;
    const own = hxCheckCounts(items);
    lines.push(`| ${title} | ${HX_CHECK_OUTCOMES.map((outcome) => own[outcome]).join(" | ")} |`);
  }
  lines.push(`| **合计** | ${HX_CHECK_OUTCOMES.map((outcome) => `**${counts[outcome]}**`).join(" | ")} |`, "");
  lines.push(
    ...itemTable(
      "失败",
      report.items.filter((item) => item.outcome === "failed"),
      80,
    ),
  );
  lines.push(
    ...itemTable(
      "待看",
      report.items.filter((item) => item.outcome === "review"),
      80,
    ),
  );
  // A probe only asks how this system keeps a setting that HXBot does not have yet; what it could not
  // read is in report.json, and is nothing that a real computer has to be found for.
  lines.push(
    ...itemTable(
      "测不了",
      report.items.filter((item) => item.outcome === "unavailable" && item.group !== "probe"),
      60,
    ),
  );
  const times = Object.entries(report.times);
  if (times.length > 0) {
    lines.push("### 用时（中位数，毫秒）", "", "| 做什么 | 毫秒 |", "|---|---:|");
    for (const [name, value] of times) lines.push(`| \`${name}\` | ${Math.round(value)} |`);
    lines.push("");
  }
  lines.push(
    "### 这台机器上读、原样写回、真改、改回都通过的设置",
    "",
    report.verified.length > 0 ? report.verified.map((key) => `\`${key}\``).join("、") : "没有。",
    "",
  );
  if (report.untestable.length > 0) {
    lines.push(
      "### 这台机器测不了的设置（仍要在真机上自检）",
      "",
      report.untestable.map((key) => `\`${key}\``).join("、"),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function outcome(value: unknown): HxCheckOutcome {
  return HX_CHECK_OUTCOMES.find((known) => known === value) ?? "failed";
}

function strings(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).flatMap((entry) => (typeof entry === "string" ? [entry] : []));
}

/** A report as it was saved by a machine. Anything that is not a report reads as null. */
export function hxDecodeCheckReport(value: unknown): HxCheckReport | null {
  if (!isDynamicRecord(value) || value.format !== 1 || typeof value.machine !== "string") return null;
  const items = (Array.isArray(value.items) ? value.items : []).flatMap((item): HxCheckItem[] => {
    if (!isDynamicRecord(item) || typeof item.id !== "string") return [];
    const shot = text(item.shot, 300);
    return [
      {
        id: item.id.slice(0, 200),
        group: hxCheckGroup(item.id),
        outcome: outcome(item.outcome),
        detail: text(item.detail, 8000),
        ms: count(item.ms),
        ...(shot ? { shot } : {}),
      },
    ];
  });
  const times: Record<string, number> = {};
  if (isDynamicRecord(value.times)) {
    for (const [name, ms] of Object.entries(value.times)) if (typeof ms === "number") times[name] = ms;
  }
  return {
    format: 1,
    machine: value.machine.slice(0, 80),
    platform: value.platform === "mac" || value.platform === "windows" ? value.platform : null,
    system: text(value.system, 400),
    startedAt: count(value.startedAt),
    finishedAt: count(value.finishedAt),
    items,
    times,
    verified: strings(value.verified),
    untestable: strings(value.untestable),
  };
}

export interface HxCheckVerdict {
  /** No machine is missing and no check failed. */
  green: boolean;
  /** Green, and nothing is left for a person to look at. */
  clean: boolean;
  failed: number;
  review: number;
  missing: string[];
  /**
   * Per system, the settings that may be marked as verified: they passed on every machine of that
   * system that could test them, and at least one machine could.
   */
  verified: Record<HxComputerPlatform, string[]>;
  /** Per system, the settings that no machine could test. */
  untestable: Record<HxComputerPlatform, string[]>;
}

/**
 * The verdict over all machines. `expected` are the labels the run was started for: a machine whose
 * report is not there counts against the run, because nothing is known about it.
 */
export function hxCheckVerdict(reports: readonly HxCheckReport[], expected: readonly string[]): HxCheckVerdict {
  const missing = expected.filter((machine) => !reports.some((report) => report.machine === machine));
  let failed = 0;
  let review = 0;
  const verified: Record<HxComputerPlatform, string[]> = { mac: [], windows: [] };
  const untestable: Record<HxComputerPlatform, string[]> = { mac: [], windows: [] };
  for (const report of reports) {
    const counts = hxCheckCounts(report.items);
    failed += counts.failed;
    review += counts.review;
  }
  for (const platform of ["mac", "windows"] as const) {
    const machines = reports.filter((report) => report.platform === platform);
    const keys = new Set(machines.flatMap((report) => [...report.verified, ...report.untestable]));
    for (const report of machines) {
      for (const item of report.items) {
        const match = /^setting\.([^.]+)\./u.exec(item.id);
        if (match?.[1]) keys.add(match[1]);
      }
    }
    for (const key of [...keys].sort()) {
      const tested = machines.filter((report) => !report.untestable.includes(key));
      if (tested.length === 0) untestable[platform].push(key);
      else if (tested.every((report) => report.verified.includes(key))) verified[platform].push(key);
    }
  }
  const green = missing.length === 0 && failed === 0 && reports.length > 0;
  return { green, clean: green && review === 0, failed, review, missing, verified, untestable };
}

/** The summary of the whole run: the verdict, one column per machine, then each machine. */
export function hxCheckOverview(reports: readonly HxCheckReport[], expected: readonly string[]): string {
  const verdict = hxCheckVerdict(reports, expected);
  const ordered = [...reports].sort((left, right) => left.machine.localeCompare(right.machine));
  const headline = verdict.clean
    ? "全部通过，没有要人看的项"
    : verdict.green
      ? `没有失败，有 ${verdict.review} 项待看`
      : verdict.missing.length > 0
        ? `有机器没有交回结果：${verdict.missing.join("、")}`
        : `有 ${verdict.failed} 项失败`;
  const lines = [`# HXBot 电脑操控：真系统检查`, "", `**结论：${headline}。**`, ""];
  if (ordered.length > 0) {
    lines.push(
      `| 组 | ${ordered.map((report) => report.machine).join(" | ")} |`,
      `|---|${ordered.map(() => "---").join("|")}|`,
    );
    for (const [group, title] of HX_CHECK_GROUPS) {
      const cells = ordered.map((report) => {
        const own = hxCheckCounts(report.items.filter((item) => item.group === group));
        const total = HX_CHECK_OUTCOMES.reduce((sum, name) => sum + own[name], 0);
        if (total === 0) return "—";
        const parts = [`${own.passed}/${total}`];
        if (own.failed > 0) parts.push(`**失败 ${own.failed}**`);
        if (own.review > 0) parts.push(`待看 ${own.review}`);
        if (own.unavailable > 0) parts.push(`测不了 ${own.unavailable}`);
        return parts.join("，");
      });
      if (cells.some((value) => value !== "—")) lines.push(`| ${title} | ${cells.join(" | ")} |`);
    }
    lines.push("", "每格是“通过的项数 / 这一组的项数”。", "");
  }
  lines.push("## 可以标成“已验证”的设置", "");
  for (const [platform, name] of [
    ["mac", "macOS"],
    ["windows", "Windows"],
  ] as const) {
    const keys = verdict.verified[platform];
    lines.push(`- **${name}：**${keys.length > 0 ? keys.map((key) => `\`${key}\``).join("、") : "没有。"}`);
    if (verdict.untestable[platform].length > 0) {
      lines.push(
        `  - 没有一台机器测得了，仍要在真机上自检：${verdict.untestable[platform].map((key) => `\`${key}\``).join("、")}`,
      );
    }
  }
  lines.push(
    "",
    "规则：在这个系统的每一台测到它的机器上，读、原样写回、真改、改回全部通过，并且至少有一台机器测到了它。",
    "",
  );
  for (const report of ordered) lines.push(hxCheckSummary(report));
  return `${lines.join("\n")}\n`;
}
