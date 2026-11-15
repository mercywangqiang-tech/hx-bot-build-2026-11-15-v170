// HXBot 真实模型检查（v1.6.7）：每一项的结果和成绩单。
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";

/** pass: as expected. warn: it works, but not the best way (the model wrote it differently). */
type HxRealStatus = "pass" | "fail" | "warn" | "skip";

interface HxRealItem {
  id: string;
  title: string;
  status: HxRealStatus;
  detail: string;
}

export interface HxRealReport {
  machine: string;
  model: string;
  startedAt: string;
  seconds: number;
  items: HxRealItem[];
  /** What each model said to the first short call. */
  models: Array<{ name: string; answer: string }>;
}

/** Collects the items of one run. */
export class HxRealItems {
  readonly items: HxRealItem[] = [];

  /** `added` sees each item when it is added (the check writes it to its output at once). */
  constructor(private readonly added?: (item: HxRealItem) => void) {}

  add(id: string, title: string, status: HxRealStatus, detail = ""): HxRealStatus {
    const item = { id, title, status, detail: detail.slice(0, 1500) };
    this.items.push(item);
    this.added?.(item);
    return status;
  }

  /** pass when `ok`, else fail. */
  check(id: string, title: string, ok: boolean, detail = ""): boolean {
    this.add(id, title, ok ? "pass" : "fail", detail);
    return ok;
  }
}

export function hxRealCounts(items: readonly HxRealItem[]): Record<HxRealStatus, number> {
  const counts: Record<HxRealStatus, number> = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

const MARK: Record<HxRealStatus, string> = { pass: "✅", fail: "❌", warn: "⚠️", skip: "⏭️" };

function cell(text: string): string {
  return text
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .slice(0, 400);
}

/** M (model), S (steps), T (team), each by number. */
function order(a: HxRealItem, b: HxRealItem): number {
  const [, letterA = "", numberA = "0"] = /^([A-Z]+)(\d+)/u.exec(a.id) ?? [];
  const [, letterB = "", numberB = "0"] = /^([A-Z]+)(\d+)/u.exec(b.id) ?? [];
  return letterA.localeCompare(letterB) || Number(numberA) - Number(numberB);
}

export function hxRealSummary(report: HxRealReport): string {
  const counts = hxRealCounts(report.items);
  return [
    `## ${report.machine}`,
    "",
    `模型：${report.model || "没有可用的模型"}　用时 ${Math.round(report.seconds)} 秒　通过 ${counts.pass}，失败 ${counts.fail}，提醒 ${counts.warn}，跳过 ${counts.skip}`,
    "",
    "| | 项 | 结果 |",
    "|---|---|---|",
    ...[...report.items]
      .sort(order)
      .map((item) => `| ${MARK[item.status]} | ${item.id} ${cell(item.title)} | ${cell(item.detail)} |`),
    "",
    ...(report.models.length
      ? ["试过的模型：", ...report.models.map((model) => `- ${model.name}：${cell(model.answer)}`), ""]
      : []),
  ].join("\n");
}

/** Reads a report back from its file. Null when it is not one. */
export function hxReadRealReport(value: unknown): HxRealReport | null {
  if (!isDynamicRecord(value) || typeof value.machine !== "string" || !Array.isArray(value.items)) return null;
  const items: HxRealItem[] = [];
  for (const item of value.items) {
    if (!isDynamicRecord(item)) continue;
    const status = item.status;
    if (status !== "pass" && status !== "fail" && status !== "warn" && status !== "skip") continue;
    items.push({
      id: String(item.id ?? ""),
      title: String(item.title ?? ""),
      status,
      detail: String(item.detail ?? ""),
    });
  }
  const models = Array.isArray(value.models)
    ? value.models.flatMap((model) =>
        isDynamicRecord(model) ? [{ name: String(model.name ?? ""), answer: String(model.answer ?? "") }] : [],
      )
    : [];
  return {
    machine: value.machine,
    model: typeof value.model === "string" ? value.model : "",
    startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
    seconds: typeof value.seconds === "number" ? value.seconds : 0,
    items,
    models,
  };
}

/** The overview of all machines, and whether every expected machine passed. */
export function hxRealOverview(
  reports: readonly HxRealReport[],
  expected: readonly string[],
): { text: string; ok: boolean } {
  const missing = expected.filter((machine) => !reports.some((report) => report.machine === machine));
  const failed = reports.filter((report) => hxRealCounts(report.items).fail > 0);
  const lines = [
    "# HXBot 真实模型与真机检查",
    "",
    "| 机器 | 模型 | 通过 | 失败 | 提醒 | 跳过 |",
    "|---|---|---|---|---|---|",
    ...reports.map((report) => {
      const counts = hxRealCounts(report.items);
      return `| ${report.machine} | ${cell(report.model || "—")} | ${counts.pass} | ${counts.fail} | ${counts.warn} | ${counts.skip} |`;
    }),
    ...missing.map((machine) => `| ${machine} | 没有交回结果 | | | | |`),
    "",
    ...reports.map((report) => hxRealSummary(report)),
  ];
  return { text: lines.join("\n"), ok: missing.length === 0 && failed.length === 0 };
}
