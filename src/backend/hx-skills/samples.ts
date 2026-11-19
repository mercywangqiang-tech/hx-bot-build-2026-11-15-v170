// HXBot v1.7.4（CU-07 发布关口）：六个内置技能各 10 条样例任务，每条都从磁盘把结果读回来核对。
// 每条任务有自己的文件夹和夹具，前一条出错不连累后一条。核对分两层：这里用 HXBot 的读取代码重新打开
// 保存好的文件（不看技能自己的回答），另外写一份 manifest.json，交给 hx/computer-check/skills_crosscheck.py
// 用别人的库（openpyxl、python-docx、python-pptx、pypdf、zipfile）再读一遍。
// 读回和期望一致才算“一致”；技能说做了但读回对不上的，标“待核实”。
// 系统设置的改动只在 settingsChanges 为真时做（GitHub 用完即毁的机器、或本机的假电脑），用户的电脑上只读和打开。
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { deflateSync } from "node:zlib";
import type { HxSettingValues } from "@hxbot/contracts/hx-computer";
import { HxDocument } from "../hx-files/docx";
import { docxFixture, PNG_2X1, pdfFixture, pptxFixture, xlsxFixture } from "../hx-files/office-fixtures";
import { HxPdf, hxPdfFields } from "../hx-files/pdf";
import { hxPdfText } from "../hx-files/pdf-text";
import { HxPresentation } from "../hx-files/pptx";
import { HxFileVersions } from "../hx-files/versions";
import { HxWorkbook } from "../hx-files/xlsx";
import { crc32, HxZip } from "../hx-files/zip";
import { hxMacMetadata } from "../hx-files/zip-stream";
import { type HxAppRouteHost, hxCopyStem, hxMacOwnScript, hxOsascript } from "./app-route";
import type { HxSkillName } from "./declarations";
import type { HxJson, HxSkillArgs } from "./operations";
import { type HxSkillAnswer, HxSkillRequests, HxSkillRunner } from "./run";
import type { HxSettingsHost } from "./settings";

export type HxSampleStatus = "一致" | "待核实" | "出错" | "跳过";

export interface HxSampleResult {
  id: string;
  /** One of the 60 (the release gate), or a task of the app route (counted apart). */
  group: "samples" | "apps";
  skill: HxSkillName;
  title: string;
  status: HxSampleStatus;
  /** The skill's own answer: ok, and its own read-back (null for an action that changes nothing). */
  ok: boolean;
  verified: boolean | null;
  /** HXBot's readers on the saved files, apart from the skill. */
  readback: { pass: boolean; detail: string };
  ms: number;
  answer: string;
}

/** One file for the independent check (skills_crosscheck.py). Paths are relative to the work folder. */
export interface HxSampleManifestItem {
  id: string;
  kind: "xlsx" | "docx" | "pptx" | "pdf" | "zip" | "tree";
  path: string;
  expect: { readonly [key: string]: HxJson };
}

export interface HxSampleReport {
  platform: string;
  machine: string;
  at: string;
  results: HxSampleResult[];
  manifest: HxSampleManifestItem[];
  /** 一致 ÷ (all − 跳过), per skill and in all. */
  rates: Record<string, { consistent: number; counted: number; rate: number }>;
  /** Settings that were not as before at the end and were put back. */
  restored: string[];
}

export interface HxSampleHost {
  platform: "mac" | "windows" | "linux";
  machine: string;
  /** An empty folder: every task gets a folder in it. */
  work: string;
  /** A folder for the versions (BAK-03) and nothing else. */
  data: string;
  /** The system settings of this computer (or of a stand-in); null where there are none. */
  settings: HxSettingsHost | null;
  /** May change settings (and change them back): only on throwaway machines and stand-ins. */
  settingsChanges: boolean;
  /**
   * The apps of this computer for the old formats (apps-* tasks, apart from the 60): LibreOffice, iWork,
   * Office or WPS. Null: those tasks are skipped.
   */
  apps?: HxAppRouteHost | null;
  /** The folder with the files of the apps-* tasks (hx/computer-check/fixtures). */
  fixtures?: string;
  /** Whether an app runs now (by its name on this system), to check that a task leaves it as it was. */
  appRunning?: (app: string) => Promise<boolean | null>;
  /** Whether an app is installed (Keynote, Numbers, Pages on a Mac). */
  appInstalled?: (app: string) => Promise<boolean>;
  /** Only these tasks (by id). */
  only?: readonly string[];
  log?: (line: string) => void;
  now?: () => number;
}

interface Context {
  dir: string;
  /** The task's folder, relative to the work folder (how the model names it). */
  rel: string;
  file(name: string): string;
  relFile(name: string): string;
  /** Values kept between setup, args and check. */
  note: Record<string, HxJson>;
  /** Values kept from one task to the next (settings-03 → settings-04). */
  shared: Record<string, HxJson>;
  settings: HxSettingsHost | null;
  platform: HxSampleHost["platform"];
  apps: HxAppRouteHost | null;
  fixtures: string;
  appRunning: (app: string) => Promise<boolean | null>;
}

interface Check {
  pass: boolean;
  detail: string;
}

interface Sample {
  id: string;
  skill: HxSkillName;
  title: string;
  setup?: (c: Context) => Promise<void>;
  args: (c: Context) => Omit<HxSkillArgs, "skill"> | Promise<Omit<HxSkillArgs, "skill">>;
  /** The code the answer must carry when the task is meant to be refused. */
  refused?: string;
  check: (c: Context, answer: HxSkillAnswer) => Promise<Check> | Check;
  manifest?: (c: Context) => HxSampleManifestItem[];
  /** It changes a system setting. */
  changesSetting?: boolean;
  /** It needs the settings of a real (or stand-in) Mac or Windows. */
  needsSettings?: boolean;
  /** It needs an app of this computer: any (old formats), or one named (Keynote, Numbers, Pages on a Mac; Excel or WPS on Windows). */
  needsApp?: { platform?: "mac" | "windows"; app?: string };
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const shaOf = async (path: string) => sha(await readFile(path));
const all = (...checks: Check[]): Check => ({
  pass: checks.every((check) => check.pass),
  detail: checks.map((check) => `${check.pass ? "✓" : "✗"} ${check.detail}`).join("；"),
});
const is = (what: string, actual: unknown, expected: unknown): Check => ({
  pass: JSON.stringify(actual) === JSON.stringify(expected),
  detail: `${what} ${JSON.stringify(actual)}${JSON.stringify(actual) === JSON.stringify(expected) ? "" : `（应为 ${JSON.stringify(expected)}）`}`,
});
const yes = (what: string, value: boolean): Check => ({ pass: value, detail: `${what}：${value ? "是" : "否"}` });
const text = (answer: HxSkillAnswer) => JSON.stringify(answer.answer);
const field = (answer: HxSkillAnswer, key: string): HxJson | undefined => answer.answer[key];
/** BAK-03: an in-place change keeps a version of the file as it was. */
const kept = (answer: HxSkillAnswer) => yes("留了修改前的版本", typeof field(answer, "version") === "string");
/** One part of a zip file (an .xlsx, .docx, .pptx), as text; "" when it is not there. */
async function part(path: string, name: string): Promise<string> {
  const zip = HxZip.read(await readFile(path));
  return zip.has(name) ? zip.readText(name) : "";
}
const partBytes = (zip: HxZip, name: string) => (zip.has(name) ? zip.read(name) : new Uint8Array());

// ---------------------------------------------------------------------------------------- fixtures

/** A PNG of one colour, w × h pixels. */
export function hxSolidPng(width: number, height: number, rgb: readonly [number, number, number]): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length);
    body.set(new TextEncoder().encode(type), 0);
    body.set(data, 4);
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(8 + data.length, crc32(body));
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x += 1) raw.set(rgb, row + 1 + x * 3);
  }
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A .zip with stored entries whose names are written as given (also "../x"), for the archive that must be refused. */
export function hxStoredZip(entries: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const head = new Uint8Array(30 + name.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, entry.data.length, true);
    h.setUint32(22, entry.data.length, true);
    h.setUint16(26, name.length, true);
    head.set(name, 30);
    const dir = new Uint8Array(46 + name.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, entry.data.length, true);
    d.setUint32(24, entry.data.length, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    dir.set(name, 46);
    local.push(head, entry.data);
    central.push(dir);
    offset += head.length + entry.data.length;
  }
  const size = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const parts = [...local, ...central, end];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const SALES_ROWS = [
  ["日期", "部门", "金额", "备注"],
  [{ date: 46_023 }, "销售", 120, ""],
  [{ date: 46_024 }, "市场", 80, ""],
  [{ date: 46_025 }, "销售", 200, "大单"],
  [{ date: 46_026 }, "研发", 50, ""],
  [{ date: 46_027 }, "市场", 30, ""],
] as const;
const salesBook = () => xlsxFixture([{ name: "明细", rows: SALES_ROWS.map((row) => [...row]) }]);
const BLUE = hxSolidPng(3, 2, [0, 0, 255]);

function workbook(bytes: Uint8Array) {
  return HxWorkbook.read(bytes);
}
async function cellText(path: string, sheet: string | null, ref: string): Promise<string> {
  return workbook(await readFile(path)).cell(sheet, ref).text;
}
async function paragraphs(path: string): Promise<string[]> {
  return HxDocument.read(await readFile(path))
    .paragraphs()
    .filter((p) => p.cell === null)
    .map((p) => p.text);
}
async function slideTitles(path: string): Promise<string[]> {
  return HxPresentation.read(await readFile(path))
    .slides()
    .map((slide) => slide.title);
}
async function pdfPages(path: string): Promise<string[]> {
  const read = await hxPdfText(await readFile(path));
  return read.pages.map((page) => page.text.replace(/\s+/gu, " ").trim());
}

// ------------------------------------------------------------------------------------------- sheet

const SHEET: Sample[] = [
  {
    id: "sheet-01",
    skill: "sheet",
    title: "写三个单元格：数字、文字、日期",
    setup: async (c) => writeFile(c.file("销售.xlsx"), salesBook()),
    args: (c) => ({
      action: "write",
      files: [c.relFile("销售.xlsx")],
      params: { sheet: "明细", cells: { C2: 150, D2: "已核对", A7: { date: "2026-11-19" } } },
    }),
    check: async (c, answer) =>
      all(
        is("C2", await cellText(c.file("销售.xlsx"), "明细", "C2"), "150"),
        is("D2", await cellText(c.file("销售.xlsx"), "明细", "D2"), "已核对"),
        is("A7", await cellText(c.file("销售.xlsx"), "明细", "A7"), "2026-11-19"),
        kept(answer),
      ),
    manifest: (c) => [
      {
        id: "sheet-01",
        kind: "xlsx",
        path: c.relFile("销售.xlsx"),
        expect: { sheet: "明细", cells: { C2: 150, D2: "已核对", A7: "2026-11-19" } },
      },
    ],
  },
  {
    id: "sheet-02",
    skill: "sheet",
    title: "写求和公式并算出结果",
    setup: async (c) => writeFile(c.file("销售.xlsx"), salesBook()),
    args: (c) => ({
      action: "write",
      files: [c.relFile("销售.xlsx")],
      params: { cells: { C7: { formula: "=SUM(C2:C6)" } } },
    }),
    check: async (c, answer) => {
      const cell = workbook(await readFile(c.file("销售.xlsx"))).cell("明细", "C7");
      return all(is("公式", cell.formula, "SUM(C2:C6)"), is("算出的值", cell.text, "480"), kept(answer));
    },
    manifest: (c) => [
      {
        id: "sheet-02",
        kind: "xlsx",
        path: c.relFile("销售.xlsx"),
        expect: { sheet: "明细", formulas: { C7: "=SUM(C2:C6)" }, cached: { C7: 480 } },
      },
    ],
  },
  {
    id: "sheet-03",
    skill: "sheet",
    title: "读一个区域（不改文件）",
    setup: async (c) => {
      await writeFile(c.file("销售.xlsx"), salesBook());
      c.note.sha = await shaOf(c.file("销售.xlsx"));
    },
    args: (c) => ({ action: "read", files: [c.relFile("销售.xlsx")], params: { range: "A1:C3" } }),
    check: async (c, answer) =>
      all(
        yes("读到“市场”和 80", text(answer).includes("市场") && text(answer).includes("80")),
        yes("读到日期 2026-01-01", text(answer).includes("2026-01-01")),
        yes("没读到区域外的“大单”", !text(answer).includes("大单")),
        is("文件没变", await shaOf(c.file("销售.xlsx")), c.note.sha),
      ),
  },
  {
    id: "sheet-04",
    skill: "sheet",
    title: "筛选：只看“销售”部门",
    setup: async (c) => writeFile(c.file("销售.xlsx"), salesBook()),
    args: (c) => ({
      action: "filter",
      files: [c.relFile("销售.xlsx")],
      params: { range: "A1:D6", columns: [{ column: "部门", equals: ["销售"] }] },
    }),
    check: async (c, answer) => {
      const xml = await part(c.file("销售.xlsx"), "xl/worksheets/sheet1.xml");
      const hidden = [...xml.matchAll(/<row r="(\d+)"[^>]*hidden="1"/gu)].map((m) => Number(m[1]));
      return all(
        yes("有筛选 A1:D6", /<autoFilter ref="A1:D6"/u.test(xml)),
        is("藏起来的行", hidden, [3, 5, 6]),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "sheet-04",
        kind: "xlsx",
        path: c.relFile("销售.xlsx"),
        expect: { sheet: "明细", autoFilter: "A1:D6", hiddenRows: [3, 5, 6] },
      },
    ],
  },
  {
    id: "sheet-05",
    skill: "sheet",
    title: "清除筛选，所有行重新显示",
    setup: async (c) => {
      const book = workbook(salesBook());
      book.filter("明细", "A1:D6", [{ column: "部门", equals: ["市场"] }]);
      await writeFile(c.file("销售.xlsx"), book.toBytes());
    },
    args: (c) => ({ action: "clear-filter", files: [c.relFile("销售.xlsx")], params: {} }),
    check: async (c, answer) => {
      const xml = await part(c.file("销售.xlsx"), "xl/worksheets/sheet1.xml");
      return all(
        yes("没有藏起来的行", !/hidden="1"/u.test(xml)),
        yes("筛选去掉了", !/<autoFilter/u.test(xml)),
        kept(answer),
      );
    },
    manifest: (c) => [
      { id: "sheet-05", kind: "xlsx", path: c.relFile("销售.xlsx"), expect: { sheet: "明细", hiddenRows: [] } },
    ],
  },
  {
    id: "sheet-06",
    skill: "sheet",
    title: "按部门汇总金额（新表，中文表名和标题）",
    setup: async (c) => writeFile(c.file("销售.xlsx"), salesBook()),
    args: (c) => ({
      action: "summary",
      files: [c.relFile("销售.xlsx")],
      params: { range: "A1:D6", rows: ["部门"], values: [{ column: "金额", fn: "sum" }], totalLabel: "合计" },
    }),
    check: async (c, answer) => {
      const book = workbook(await readFile(c.file("销售.xlsx")));
      const sheet = book.sheets().find((info) => info.name !== "明细");
      if (!sheet) return { pass: false, detail: "没有新的汇总表" };
      const cells = book.allCells(sheet.name);
      const rows = new Map<string, string>();
      for (const [ref, read] of cells) {
        const row = ref.replace(/^[A-Z]+/u, "");
        if (ref.startsWith("A")) rows.set(read.text, cells.get(`B${row}`)?.text ?? "");
      }
      c.note.sheet = sheet.name;
      return all(
        is("新表的名字", sheet.name, "明细 汇总"),
        is("值的标题", cells.get("B1")?.text, "求和项:金额"),
        is("销售", rows.get("销售"), "320"),
        is("市场", rows.get("市场"), "110"),
        is("研发", rows.get("研发"), "50"),
        is("合计", rows.get("合计"), "480"),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "sheet-06",
        kind: "xlsx",
        path: c.relFile("销售.xlsx"),
        expect: {
          sheet: c.note.sheet ?? "",
          sheets: ["明细", "明细 汇总"],
          cells: { B1: "求和项:金额" },
          pairs: { 销售: 320, 市场: 110, 研发: 50, 合计: 480 },
        },
      },
    ],
  },
  {
    id: "sheet-07",
    skill: "sheet",
    title: "插入柱形图",
    setup: async (c) => writeFile(c.file("销售.xlsx"), salesBook()),
    args: (c) => ({
      action: "chart",
      files: [c.relFile("销售.xlsx")],
      params: { type: "column", title: "各笔金额", categories: "B2:B6", series: [{ name: "金额", values: "C2:C6" }] },
    }),
    check: async (c, answer) => {
      const zip = HxZip.read(await readFile(c.file("销售.xlsx")));
      const chart = zip.names().find((name) => /^xl\/charts\/chart\d+\.xml$/u.test(name));
      const xml = chart ? zip.readText(chart) : "";
      return all(
        yes("有图表部件", chart !== undefined),
        yes("是柱形图", xml.includes("<c:barChart>") && xml.includes('<c:barDir val="col"/>')),
        yes("数据引用 C2:C6", xml.includes("$C$2:$C$6")),
        yes("标题“各笔金额”", xml.includes("各笔金额")),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "sheet-07",
        kind: "xlsx",
        path: c.relFile("销售.xlsx"),
        expect: { chartContains: ["barChart", "$C$2:$C$6", "各笔金额"] },
      },
    ],
  },
  {
    id: "sheet-08",
    skill: "sheet",
    title: "加一张叫“二季度”的表",
    setup: async (c) => writeFile(c.file("销售.xlsx"), salesBook()),
    args: (c) => ({ action: "add-sheet", files: [c.relFile("销售.xlsx")], params: { name: "二季度" } }),
    check: async (c, answer) =>
      all(
        is(
          "表",
          workbook(await readFile(c.file("销售.xlsx")))
            .sheets()
            .map((info) => info.name),
          ["明细", "二季度"],
        ),
        kept(answer),
      ),
    manifest: (c) => [
      { id: "sheet-08", kind: "xlsx", path: c.relFile("销售.xlsx"), expect: { sheets: ["明细", "二季度"] } },
    ],
  },
  {
    id: "sheet-09",
    skill: "sheet",
    title: "把一月、二月两张表合并成一张",
    setup: async (c) =>
      writeFile(
        c.file("月报.xlsx"),
        xlsxFixture([
          {
            name: "一月",
            rows: [
              ["姓名", "金额"],
              ["张三", 10],
              ["李四", 20],
            ],
          },
          {
            name: "二月",
            rows: [
              ["姓名", "金额"],
              ["王五", 30],
            ],
          },
        ]),
      ),
    args: (c) => ({
      action: "combine",
      files: [c.relFile("月报.xlsx")],
      params: { sheets: ["一月", "二月"], header: true, source: true, name: "合并" },
    }),
    check: async (c, answer) => {
      const book = workbook(await readFile(c.file("月报.xlsx")));
      const cells = book.allCells("合并");
      const values = [...cells.values()].map((cell) => cell.text);
      return all(
        yes(
          "有“合并”表",
          book.sheets().some((info) => info.name === "合并"),
        ),
        yes(
          "三个人都在",
          ["张三", "李四", "王五"].every((name) => values.includes(name)),
        ),
        yes("标头只出现一次", values.filter((value) => value === "姓名").length === 1),
        yes("写了来自哪张表", values.includes("月报.xlsx / 一月") && values.includes("月报.xlsx / 二月")),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "sheet-09",
        kind: "xlsx",
        path: c.relFile("月报.xlsx"),
        expect: {
          sheet: "合并",
          contains: ["张三", "李四", "王五", "月报.xlsx / 一月", "月报.xlsx / 二月"],
          once: ["姓名"],
        },
      },
    ],
  },
  {
    id: "sheet-10",
    skill: "sheet",
    title: "改完另存为新文件，原文件不动",
    setup: async (c) => {
      await writeFile(c.file("销售.xlsx"), salesBook());
      c.note.sha = await shaOf(c.file("销售.xlsx"));
    },
    args: (c) => ({
      action: "write",
      files: [c.relFile("销售.xlsx")],
      output: c.relFile("销售-改.xlsx"),
      params: { cells: { D3: "补录" } },
    }),
    check: async (c) =>
      all(
        is("原文件没变", await shaOf(c.file("销售.xlsx")), c.note.sha),
        is("新文件 D3", await cellText(c.file("销售-改.xlsx"), "明细", "D3"), "补录"),
      ),
    manifest: (c) => [
      {
        id: "sheet-10",
        kind: "xlsx",
        path: c.relFile("销售-改.xlsx"),
        expect: { sheet: "明细", cells: { D3: "补录" } },
      },
    ],
  },
];

// ---------------------------------------------------------------------------------------- document

const plan = () =>
  docxFixture(
    [
      { runs: ["项目方案"], style: "Heading1" },
      { runs: ["本方案由旧", "公司", "提出。"] },
      { runs: ["第二部分：预算。"] },
      { runs: ["联系旧公司的王经理。"] },
    ],
    [
      ["姓名", "分数"],
      ["张三", "90"],
    ],
  );

const DOCUMENT: Sample[] = [
  {
    id: "document-01",
    skill: "document",
    title: "全文替换“旧公司”为“新公司”（跨文字段）",
    setup: async (c) => writeFile(c.file("方案.docx"), plan()),
    args: (c) => ({
      action: "replace",
      files: [c.relFile("方案.docx")],
      params: { find: "旧公司", replace: "新公司", all: true },
    }),
    check: async (c, answer) => {
      const texts = (await paragraphs(c.file("方案.docx"))).join("\n");
      return all(
        yes("没有“旧公司”了", !texts.includes("旧公司")),
        is("“新公司”出现次数", texts.split("新公司").length - 1, 2),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "document-01",
        kind: "docx",
        path: c.relFile("方案.docx"),
        expect: { absent: ["旧公司"], count: { 新公司: 2 } },
      },
    ],
  },
  {
    id: "document-02",
    skill: "document",
    title: "改写第二段",
    setup: async (c) => writeFile(c.file("方案.docx"), plan()),
    args: (c) => ({
      action: "set-paragraph",
      files: [c.relFile("方案.docx")],
      params: { index: 1, text: "本方案由研究部提出。" },
    }),
    check: async (c, answer) =>
      all(is("第二段", (await paragraphs(c.file("方案.docx")))[1], "本方案由研究部提出。"), kept(answer)),
    manifest: (c) => [
      {
        id: "document-02",
        kind: "docx",
        path: c.relFile("方案.docx"),
        expect: { paragraphs: { "1": "本方案由研究部提出。" } },
      },
    ],
  },
  {
    id: "document-03",
    skill: "document",
    title: "在标题后插入一个“标题 1”样式的段落",
    setup: async (c) => writeFile(c.file("方案.docx"), plan()),
    args: (c) => ({
      action: "insert",
      files: [c.relFile("方案.docx")],
      params: { after: 0, text: "第一章 背景", style: "heading 1" },
    }),
    check: async (c, answer) => {
      const list = HxDocument.read(await readFile(c.file("方案.docx"))).paragraphs();
      return all(is("新段落", list[1]?.text, "第一章 背景"), is("样式", list[1]?.style, "Heading1"), kept(answer));
    },
    manifest: (c) => [
      {
        id: "document-03",
        kind: "docx",
        path: c.relFile("方案.docx"),
        expect: { paragraphs: { "1": "第一章 背景" }, styles: { "1": "Heading1" } },
      },
    ],
  },
  {
    id: "document-04",
    skill: "document",
    title: "删掉第三段",
    setup: async (c) => writeFile(c.file("方案.docx"), plan()),
    args: (c) => ({ action: "delete", files: [c.relFile("方案.docx")], params: { index: 2 } }),
    check: async (c, answer) => {
      const list = await paragraphs(c.file("方案.docx"));
      return all(yes("“第二部分”没了", !list.some((p) => p.includes("第二部分"))), kept(answer));
    },
    manifest: (c) => [
      { id: "document-04", kind: "docx", path: c.relFile("方案.docx"), expect: { absent: ["第二部分：预算。"] } },
    ],
  },
  {
    id: "document-05",
    skill: "document",
    title: "按修订模式替换（留下修订记号）",
    setup: async (c) => writeFile(c.file("方案.docx"), plan()),
    args: (c) => ({
      action: "replace",
      files: [c.relFile("方案.docx")],
      params: { find: "预算", replace: "费用", track: true },
    }),
    check: async (c, answer) => {
      const doc = HxDocument.read(await readFile(c.file("方案.docx")));
      const xml = await part(c.file("方案.docx"), "word/document.xml");
      return all(
        yes("有修订", doc.revisionCount() > 0),
        yes("插入的是“费用”", /<w:ins\b[\s\S]*?费用[\s\S]*?<\/w:ins>/u.test(xml)),
        yes("删除的是“预算”", /<w:del\b[\s\S]*?<w:delText[^>]*>预算<\/w:delText>[\s\S]*?<\/w:del>/u.test(xml)),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "document-05",
        kind: "docx",
        path: c.relFile("方案.docx"),
        expect: { inserted: ["费用"], deleted: ["预算"] },
      },
    ],
  },
  {
    id: "document-06",
    skill: "document",
    title: "第二段加粗、改成红色",
    setup: async (c) => writeFile(c.file("方案.docx"), plan()),
    args: (c) => ({
      action: "format",
      files: [c.relFile("方案.docx")],
      params: { index: 1, bold: true, color: "FF0000" },
    }),
    check: async (c, answer) => {
      const xml = await part(c.file("方案.docx"), "word/document.xml");
      const second = xml.split("<w:p>").find((part) => part.includes("提出。")) ?? "";
      const runs = [...second.matchAll(/<w:r>([\s\S]*?)<\/w:r>/gu)].map((m) => m[1] ?? "");
      return all(
        yes("每段文字都加粗", runs.length > 0 && runs.every((run) => /<w:b\/>/u.test(run))),
        yes("每段文字都是红色", runs.length > 0 && runs.every((run) => /<w:color w:val="FF0000"\/>/u.test(run))),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "document-06",
        kind: "docx",
        path: c.relFile("方案.docx"),
        expect: { runs: { "1": { bold: true, color: "FF0000" } } },
      },
    ],
  },
  {
    id: "document-07",
    skill: "document",
    title: "改表格里张三的分数",
    setup: async (c) => writeFile(c.file("方案.docx"), plan()),
    args: (c) => ({
      action: "cell",
      files: [c.relFile("方案.docx")],
      params: { table: 0, row: 1, col: 1, text: "95" },
    }),
    check: async (c, answer) =>
      all(
        is("表格", HxDocument.read(await readFile(c.file("方案.docx"))).tables()[0]?.rows, [
          ["姓名", "分数"],
          ["张三", "95"],
        ]),
        kept(answer),
      ),
    manifest: (c) => [
      {
        id: "document-07",
        kind: "docx",
        path: c.relFile("方案.docx"),
        expect: {
          table: [
            ["姓名", "分数"],
            ["张三", "95"],
          ],
        },
      },
    ],
  },
  {
    id: "document-08",
    skill: "document",
    title: "表格加一行",
    setup: async (c) => writeFile(c.file("方案.docx"), plan()),
    args: (c) => ({ action: "add-row", files: [c.relFile("方案.docx")], params: { table: 0, values: ["李四", "88"] } }),
    check: async (c, answer) =>
      all(
        is(
          "最后一行",
          HxDocument.read(await readFile(c.file("方案.docx")))
            .tables()[0]
            ?.rows.at(-1),
          ["李四", "88"],
        ),
        kept(answer),
      ),
    manifest: (c) => [
      {
        id: "document-08",
        kind: "docx",
        path: c.relFile("方案.docx"),
        expect: {
          table: [
            ["姓名", "分数"],
            ["张三", "90"],
            ["李四", "88"],
          ],
        },
      },
    ],
  },
  {
    id: "document-09",
    skill: "document",
    title: "在标题后插入一张 2×3 的表格",
    setup: async (c) => writeFile(c.file("方案.docx"), plan()),
    args: (c) => ({
      action: "insert-table",
      files: [c.relFile("方案.docx")],
      params: {
        after: 0,
        rows: [
          ["季度", "收入", "成本"],
          ["一季度", "100", "60"],
        ],
      },
    }),
    check: async (c, answer) => {
      const tables = HxDocument.read(await readFile(c.file("方案.docx"))).tables();
      return all(
        is("表格数", tables.length, 2),
        is("新表格", tables[0]?.rows, [
          ["季度", "收入", "成本"],
          ["一季度", "100", "60"],
        ]),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "document-09",
        kind: "docx",
        path: c.relFile("方案.docx"),
        expect: {
          table: [
            ["季度", "收入", "成本"],
            ["一季度", "100", "60"],
          ],
          tables: 2,
        },
      },
    ],
  },
  {
    id: "document-10",
    skill: "document",
    title: "接受全部修订",
    setup: async (c) => {
      const doc = HxDocument.read(plan());
      doc.setParagraph(2, "第二部分：费用。", { track: true, author: "审阅人" });
      await writeFile(c.file("方案.docx"), doc.toBytes());
    },
    args: (c) => ({ action: "accept-changes", files: [c.relFile("方案.docx")], params: {} }),
    check: async (c, answer) => {
      const doc = HxDocument.read(await readFile(c.file("方案.docx")));
      return all(
        is("修订数", doc.revisionCount(), 0),
        is("第三段", (await paragraphs(c.file("方案.docx")))[2], "第二部分：费用。"),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "document-10",
        kind: "docx",
        path: c.relFile("方案.docx"),
        expect: { paragraphs: { "2": "第二部分：费用。" }, revisions: 0 },
      },
    ],
  },
];

// ------------------------------------------------------------------------------------------ slides

const deck = () =>
  pptxFixture([
    { title: "封面", notes: "开场白" },
    { title: "季度回顾", body: "收入增长", picture: true },
    { title: "下一步", body: "招人" },
  ]);

const SLIDES: Sample[] = [
  {
    id: "slides-01",
    skill: "slides",
    title: "在最后加一页，带标题和正文",
    setup: async (c) => writeFile(c.file("汇报.pptx"), deck()),
    args: (c) => ({ action: "add", files: [c.relFile("汇报.pptx")], params: { title: "谢谢", body: "问答" } }),
    check: async (c, answer) => {
      const slides = HxPresentation.read(await readFile(c.file("汇报.pptx"))).slides();
      const last = slides.at(-1);
      return all(
        is("页数", slides.length, 4),
        is("最后一页标题", last?.title, "谢谢"),
        yes("正文“问答”", last?.shapes.some((shape) => shape.text === "问答") === true),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "slides-01",
        kind: "pptx",
        path: c.relFile("汇报.pptx"),
        expect: { titles: ["封面", "季度回顾", "下一步", "谢谢"], texts: { "4": ["问答"] } },
      },
    ],
  },
  {
    id: "slides-02",
    skill: "slides",
    title: "删掉第 2 页",
    setup: async (c) => writeFile(c.file("汇报.pptx"), deck()),
    args: (c) => ({ action: "delete", files: [c.relFile("汇报.pptx")], params: { slide: 2 } }),
    check: async (c, answer) => all(is("页", await slideTitles(c.file("汇报.pptx")), ["封面", "下一步"]), kept(answer)),
    manifest: (c) => [
      { id: "slides-02", kind: "pptx", path: c.relFile("汇报.pptx"), expect: { titles: ["封面", "下一步"] } },
    ],
  },
  {
    id: "slides-03",
    skill: "slides",
    title: "把第 3 页移到最前",
    setup: async (c) => writeFile(c.file("汇报.pptx"), deck()),
    args: (c) => ({ action: "move", files: [c.relFile("汇报.pptx")], params: { slide: 3, to: 1 } }),
    check: async (c, answer) =>
      all(is("页", await slideTitles(c.file("汇报.pptx")), ["下一步", "封面", "季度回顾"]), kept(answer)),
    manifest: (c) => [
      {
        id: "slides-03",
        kind: "pptx",
        path: c.relFile("汇报.pptx"),
        expect: { titles: ["下一步", "封面", "季度回顾"] },
      },
    ],
  },
  {
    id: "slides-04",
    skill: "slides",
    title: "复制第 2 页（连图片）",
    setup: async (c) => writeFile(c.file("汇报.pptx"), deck()),
    args: (c) => ({ action: "duplicate", files: [c.relFile("汇报.pptx")], params: { slide: 2 } }),
    check: async (c, answer) => {
      const slides = HxPresentation.read(await readFile(c.file("汇报.pptx"))).slides();
      return all(
        is(
          "页",
          slides.map((slide) => slide.title),
          ["封面", "季度回顾", "季度回顾", "下一步"],
        ),
        is("复制页的图片", slides[2]?.pictures, 1),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "slides-04",
        kind: "pptx",
        path: c.relFile("汇报.pptx"),
        expect: { titles: ["封面", "季度回顾", "季度回顾", "下一步"], pictures: { "3": 1 } },
      },
    ],
  },
  {
    id: "slides-05",
    skill: "slides",
    title: "改第 1 页的标题",
    setup: async (c) => writeFile(c.file("汇报.pptx"), deck()),
    args: (c) => ({
      action: "text",
      files: [c.relFile("汇报.pptx")],
      params: { slide: 1, target: "title", text: "2026 年度汇报" },
    }),
    check: async (c, answer) =>
      all(is("第 1 页标题", (await slideTitles(c.file("汇报.pptx")))[0], "2026 年度汇报"), kept(answer)),
    manifest: (c) => [
      {
        id: "slides-05",
        kind: "pptx",
        path: c.relFile("汇报.pptx"),
        expect: { titles: ["2026 年度汇报", "季度回顾", "下一步"] },
      },
    ],
  },
  {
    id: "slides-06",
    skill: "slides",
    title: "改第 3 页的正文",
    setup: async (c) => writeFile(c.file("汇报.pptx"), deck()),
    args: (c) => ({
      action: "text",
      files: [c.relFile("汇报.pptx")],
      params: { slide: 3, target: "body", text: "招两个人\n上线新版" },
    }),
    check: async (c, answer) => {
      const slide = HxPresentation.read(await readFile(c.file("汇报.pptx"))).slides()[2];
      const body = slide?.shapes.find((shape) => shape.placeholder === "body" || shape.placeholder === "")?.text ?? "";
      return all(
        yes("正文是两行新内容", body.replace(/\r/gu, "") === "招两个人\n上线新版"),
        yes("旧的“招人”没了", !body.includes("招人\n") && body !== "招人"),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "slides-06",
        kind: "pptx",
        path: c.relFile("汇报.pptx"),
        expect: { texts: { "3": ["招两个人", "上线新版"] } },
      },
    ],
  },
  {
    id: "slides-07",
    skill: "slides",
    title: "给第 1 页写备注",
    setup: async (c) => writeFile(c.file("汇报.pptx"), deck()),
    args: (c) => ({
      action: "notes",
      files: [c.relFile("汇报.pptx")],
      params: { slide: 1, text: "先讲结论，再讲数字。" },
    }),
    check: async (c, answer) =>
      all(
        is("备注", HxPresentation.read(await readFile(c.file("汇报.pptx"))).slides()[0]?.notes, "先讲结论，再讲数字。"),
        kept(answer),
      ),
    manifest: (c) => [
      {
        id: "slides-07",
        kind: "pptx",
        path: c.relFile("汇报.pptx"),
        expect: { notes: { "1": "先讲结论，再讲数字。" } },
      },
    ],
  },
  {
    id: "slides-08",
    skill: "slides",
    title: "第 1 页换成“标题和内容”版式",
    setup: async (c) => {
      const bytes = deck();
      await writeFile(c.file("汇报.pptx"), bytes);
      const presentation = HxPresentation.read(bytes);
      const current = presentation.slides()[0]?.layout ?? "";
      const other = presentation.layouts().find((layout) => layout.name !== current)?.name ?? "";
      c.note.layout = other;
    },
    args: (c) => ({
      action: "layout",
      files: [c.relFile("汇报.pptx")],
      params: { slide: 1, layout: String(c.note.layout) },
    }),
    check: async (c, answer) => {
      const slide = HxPresentation.read(await readFile(c.file("汇报.pptx"))).slides()[0];
      return all(is("版式", slide?.layout, c.note.layout), is("标题还在", slide?.title, "封面"), kept(answer));
    },
    manifest: (c) => [
      {
        id: "slides-08",
        kind: "pptx",
        path: c.relFile("汇报.pptx"),
        expect: { layouts: { "1": c.note.layout ?? "" }, titles: ["封面", "季度回顾", "下一步"] },
      },
    ],
  },
  {
    id: "slides-09",
    skill: "slides",
    title: "在第 3 页加一张图片",
    setup: async (c) => {
      await writeFile(c.file("汇报.pptx"), deck());
      await writeFile(c.file("蓝.png"), BLUE);
    },
    args: (c) => ({
      action: "add-picture",
      files: [c.relFile("汇报.pptx")],
      params: { slide: 3, picture: c.relFile("蓝.png") },
    }),
    check: async (c, answer) => {
      const bytes = await readFile(c.file("汇报.pptx"));
      const zip = HxZip.read(bytes);
      const media = zip.names().filter((name) => name.startsWith("ppt/media/"));
      return all(
        is("第 3 页图片数", HxPresentation.read(bytes).slides()[2]?.pictures, 1),
        yes(
          "图片字节和原图一样",
          media.some((name) => sha(partBytes(zip, name)) === sha(BLUE)),
        ),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "slides-09",
        kind: "pptx",
        path: c.relFile("汇报.pptx"),
        expect: { pictures: { "3": 1 }, pictureSha: { "3": sha(BLUE) } },
      },
    ],
  },
  {
    id: "slides-10",
    skill: "slides",
    title: "把第 2 页的图片换成另一张",
    setup: async (c) => {
      await writeFile(c.file("汇报.pptx"), deck());
      await writeFile(c.file("蓝.png"), BLUE);
    },
    args: (c) => ({
      action: "replace-picture",
      files: [c.relFile("汇报.pptx")],
      params: { slide: 2, index: 1, picture: c.relFile("蓝.png") },
    }),
    check: async (c, answer) => {
      const bytes = await readFile(c.file("汇报.pptx"));
      const zip = HxZip.read(bytes);
      const media = zip.names().filter((name) => name.startsWith("ppt/media/"));
      const shas = media.map((name) => sha(partBytes(zip, name)));
      return all(
        is("第 2 页图片数", HxPresentation.read(bytes).slides()[1]?.pictures, 1),
        yes("新图片在文件里", shas.includes(sha(BLUE))),
        yes("旧图片不用了", !shas.includes(sha(PNG_2X1))),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "slides-10",
        kind: "pptx",
        path: c.relFile("汇报.pptx"),
        expect: { pictures: { "2": 1 }, pictureSha: { "2": sha(BLUE) } },
      },
    ],
  },
];

// --------------------------------------------------------------------------------------------- pdf

const INVOICE = [["Invoice 2026-11", "Total 120 USD"], ["Page two: items"], ["Page three: terms"]];
const invoice = (form = false) => pdfFixture(INVOICE, { form });

const PDF: Sample[] = [
  {
    id: "pdf-01",
    skill: "pdf",
    title: "取第 1～2 页的文字",
    setup: async (c) => writeFile(c.file("发票.pdf"), invoice()),
    args: (c) => ({ action: "read", files: [c.relFile("发票.pdf")], params: { pages: "1-2" } }),
    check: (_c, answer) =>
      all(
        yes("第 1 页文字", text(answer).includes("Invoice 2026-11") && text(answer).includes("Total 120 USD")),
        yes("第 2 页文字", text(answer).includes("Page two: items")),
        yes("没取第 3 页", !text(answer).includes("Page three")),
      ),
  },
  {
    id: "pdf-02",
    skill: "pdf",
    title: "列出表单字段",
    setup: async (c) => writeFile(c.file("表单.pdf"), invoice(true)),
    args: (c) => ({ action: "fields", files: [c.relFile("表单.pdf")], params: {} }),
    check: (_c, answer) =>
      all(
        ...["name", "agree", "plan", "city", "id"].map((name) =>
          yes(`有字段 ${name}`, text(answer).includes(`"${name}"`)),
        ),
      ),
  },
  {
    id: "pdf-03",
    skill: "pdf",
    title: "填表：姓名、同意、方案",
    setup: async (c) => writeFile(c.file("表单.pdf"), invoice(true)),
    args: (c) => ({
      action: "fill",
      files: [c.relFile("表单.pdf")],
      params: { values: { name: "Wang Qiang", agree: true, plan: "pro" } },
    }),
    check: async (c, answer) => {
      const fields = hxPdfFields(HxPdf.read(await readFile(c.file("表单.pdf"))));
      const value = (name: string) => fields.find((item) => item.name === name)?.value;
      return all(
        is("name", value("name"), "Wang Qiang"),
        yes("agree 已勾选", value("agree") !== undefined && value("agree") !== "Off" && value("agree") !== ""),
        is("plan", value("plan"), "pro"),
        kept(answer),
      );
    },
    manifest: (c) => [
      {
        id: "pdf-03",
        kind: "pdf",
        path: c.relFile("表单.pdf"),
        expect: { fields: { name: "Wang Qiang", plan: "pro" }, checked: ["agree"] },
      },
    ],
  },
  {
    id: "pdf-04",
    skill: "pdf",
    title: "把第 2～3 页提取成新文件",
    setup: async (c) => writeFile(c.file("发票.pdf"), invoice()),
    args: (c) => ({
      action: "extract",
      files: [c.relFile("发票.pdf")],
      output: c.relFile("后两页.pdf"),
      params: { pages: "2-3" },
    }),
    check: async (c) => {
      const pages = await pdfPages(c.file("后两页.pdf"));
      return all(is("页数", pages.length, 2), yes("第 1 页是原第 2 页", pages[0]?.includes("Page two") === true));
    },
    manifest: (c) => [
      {
        id: "pdf-04",
        kind: "pdf",
        path: c.relFile("后两页.pdf"),
        expect: { pages: 2, pageText: { "1": "Page two: items", "2": "Page three: terms" } },
      },
    ],
  },
  {
    id: "pdf-05",
    skill: "pdf",
    title: "每页拆成一个文件",
    setup: async (c) => writeFile(c.file("发票.pdf"), invoice()),
    args: (c) => ({ action: "split", files: [c.relFile("发票.pdf")], output: c.relFile("拆开"), params: { every: 1 } }),
    check: async (c) => {
      const names = (await readdir(c.file("拆开")))
        .filter((name) => name.endsWith(".pdf") && !hxMacMetadata(name))
        .sort();
      const counts = await Promise.all(names.map(async (name) => (await pdfPages(join(c.file("拆开"), name))).length));
      c.note.parts = names;
      return all(is("文件数", names.length, 3), is("每份页数", counts, [1, 1, 1]));
    },
    manifest: (c) =>
      (Array.isArray(c.note.parts) ? c.note.parts : []).map((name, index) => ({
        id: "pdf-05",
        kind: "pdf" as const,
        path: `${c.rel}/拆开/${String(name)}`,
        expect: { pages: 1, pageText: { "1": INVOICE[index]?.[0] ?? "" } },
      })),
  },
  {
    id: "pdf-06",
    skill: "pdf",
    title: "按范围拆成两份（1、2-3）",
    setup: async (c) => writeFile(c.file("发票.pdf"), invoice()),
    args: (c) => ({
      action: "split",
      files: [c.relFile("发票.pdf")],
      output: c.relFile("两份"),
      params: { ranges: ["1", "2-3"] },
    }),
    check: async (c) => {
      const names = (await readdir(c.file("两份")))
        .filter((name) => name.endsWith(".pdf") && !hxMacMetadata(name))
        .sort();
      const counts = await Promise.all(names.map(async (name) => (await pdfPages(join(c.file("两份"), name))).length));
      return all(is("文件数", names.length, 2), is("每份页数（按名字排）", [...counts].sort(), [1, 2]));
    },
  },
  {
    id: "pdf-07",
    skill: "pdf",
    title: "两份 PDF 合并，每份一个书签",
    setup: async (c) => {
      await writeFile(c.file("甲.pdf"), pdfFixture([["Part A one"], ["Part A two"]]));
      await writeFile(c.file("乙.pdf"), pdfFixture([["Part B one"]]));
    },
    args: (c) => ({
      action: "merge",
      files: [c.relFile("甲.pdf"), c.relFile("乙.pdf")],
      output: c.relFile("合并.pdf"),
      params: { bookmarks: true },
    }),
    check: async (c) => {
      const pages = await pdfPages(c.file("合并.pdf"));
      const raw = new TextDecoder("latin1").decode(await readFile(c.file("合并.pdf")));
      return all(
        is("页数", pages.length, 3),
        yes("顺序是甲、乙", pages[0]?.includes("Part A one") === true && pages[2]?.includes("Part B one") === true),
        yes("有书签", raw.includes("/Outlines")),
      );
    },
    manifest: (c) => [
      {
        id: "pdf-07",
        kind: "pdf",
        path: c.relFile("合并.pdf"),
        expect: { pages: 3, pageText: { "1": "Part A one", "3": "Part B one" }, outlines: 2 },
      },
    ],
  },
  {
    id: "pdf-08",
    skill: "pdf",
    title: "同样的值再填一次：不写文件",
    setup: async (c) => {
      const { bytes } = (await import("../hx-files/pdf")).hxPdfFill(HxPdf.read(invoice(true)), { name: "Li Si" });
      await writeFile(c.file("表单.pdf"), bytes);
      c.note.sha = await shaOf(c.file("表单.pdf"));
    },
    args: (c) => ({ action: "fill", files: [c.relFile("表单.pdf")], params: { values: { name: "Li Si" } } }),
    check: async (c, answer) =>
      all(
        is("文件没变", await shaOf(c.file("表单.pdf")), c.note.sha),
        yes("回答说没有要改的", typeof field(answer, "version") !== "string"),
      ),
  },
  {
    id: "pdf-09",
    skill: "pdf",
    title: "读一个截断的 PDF：能救的页照样取文字",
    setup: async (c) => {
      const whole = pdfFixture([["Rescued page one"], ["Rescued page two"]]);
      const text = new TextDecoder("latin1").decode(whole);
      await writeFile(c.file("坏.pdf"), whole.slice(0, text.lastIndexOf("xref")));
    },
    args: (c) => ({ action: "read", files: [c.relFile("坏.pdf")], params: {} }),
    check: (_c, answer) =>
      all(
        yes("取到第 1 页", text(answer).includes("Rescued page one")),
        yes("取到第 2 页", text(answer).includes("Rescued page two")),
      ),
  },
  {
    id: "pdf-10",
    skill: "pdf",
    title: "输出文件已经存在：不覆盖",
    setup: async (c) => {
      await writeFile(c.file("发票.pdf"), invoice());
      await writeFile(c.file("已有.pdf"), pdfFixture([["Keep me"]]));
      c.note.sha = await shaOf(c.file("已有.pdf"));
    },
    args: (c) => ({
      action: "extract",
      files: [c.relFile("发票.pdf")],
      output: c.relFile("已有.pdf"),
      params: { pages: "1" },
    }),
    refused: "*",
    check: async (c) => is("已有的文件没变", await shaOf(c.file("已有.pdf")), c.note.sha),
  },
];

// ------------------------------------------------------------------------------------------- files

async function tree(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(dir, base), { withFileTypes: true })) {
    // A Mac on exFAT writes “._name” beside each file; that is the disk's, not the task's.
    if (hxMacMetadata(entry.name)) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(`${rel}/`, ...(await tree(dir, rel)));
    else out.push(rel);
  }
  return out.sort();
}
const exists = async (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );
async function filesFixture(c: Context) {
  await mkdir(c.file("资料/子目录"), { recursive: true });
  await writeFile(c.file("资料/年度报告.pdf"), pdfFixture([["Annual"]]));
  await writeFile(c.file("资料/报告草稿.docx"), docxFixture([{ runs: ["草稿"] }]));
  await writeFile(c.file("资料/子目录/季度报告.pdf"), pdfFixture([["Quarter"]]));
  await writeFile(c.file("资料/子目录/表.xlsx"), salesBook());
  await writeFile(c.file("资料/说明.txt"), "说明文字\n");
}

const FILES: Sample[] = [
  {
    id: "files-01",
    skill: "files",
    title: "按名字找“报告”",
    setup: filesFixture,
    args: (c) => ({ action: "find", files: [c.relFile("资料")], params: { name: "报告" } }),
    check: (_c, answer) =>
      all(
        ...["年度报告.pdf", "报告草稿.docx", "季度报告.pdf"].map((name) =>
          yes(`找到 ${name}`, text(answer).includes(name)),
        ),
        yes("没把“说明.txt”算进来", !text(answer).includes("说明.txt")),
      ),
  },
  {
    id: "files-02",
    skill: "files",
    title: "只找 PDF，只看第一层",
    setup: filesFixture,
    args: (c) => ({ action: "find", files: [c.relFile("资料")], params: { ext: ["pdf"], depth: 0 } }),
    check: (_c, answer) =>
      all(
        yes("找到 年度报告.pdf", text(answer).includes("年度报告.pdf")),
        yes("没进子目录", !text(answer).includes("季度报告.pdf")),
        yes("没有别的类型", !text(answer).includes(".docx")),
      ),
  },
  {
    id: "files-03",
    skill: "files",
    title: "改名",
    setup: async (c) => {
      await writeFile(c.file("旧名.txt"), "内容\n");
      c.note.sha = await shaOf(c.file("旧名.txt"));
    },
    args: (c) => ({ action: "rename", files: [c.relFile("旧名.txt")], params: { name: "新名.txt" } }),
    check: async (c) =>
      all(
        yes("旧名不在了", !(await exists(c.file("旧名.txt")))),
        is("新名的内容", await shaOf(c.file("新名.txt")), c.note.sha),
      ),
    manifest: (c) => [
      { id: "files-03", kind: "tree", path: c.rel, expect: { present: ["新名.txt"], absent: ["旧名.txt"] } },
    ],
  },
  {
    id: "files-04",
    skill: "files",
    title: "改名撞名：自动用“(2)”",
    setup: async (c) => {
      await writeFile(c.file("草稿.txt"), "一\n");
      await writeFile(c.file("定稿.txt"), "已经有了\n");
      c.note.sha = await shaOf(c.file("定稿.txt"));
    },
    args: (c) => ({
      action: "rename",
      files: [c.relFile("草稿.txt")],
      params: { name: "定稿.txt", onExists: "rename" },
    }),
    check: async (c) =>
      all(
        is("原来的定稿没变", await shaOf(c.file("定稿.txt")), c.note.sha),
        yes("改成了“定稿 (2).txt”", await exists(c.file("定稿 (2).txt"))),
        yes("草稿不在了", !(await exists(c.file("草稿.txt")))),
      ),
    manifest: (c) => [
      {
        id: "files-04",
        kind: "tree",
        path: c.rel,
        expect: { present: ["定稿.txt", "定稿 (2).txt"], absent: ["草稿.txt"] },
      },
    ],
  },
  {
    id: "files-05",
    skill: "files",
    title: "把两个文件移进“归档”",
    setup: async (c) => {
      await mkdir(c.file("归档"), { recursive: true });
      await writeFile(c.file("一.txt"), "1\n");
      await writeFile(c.file("二.txt"), "2\n");
    },
    args: (c) => ({
      action: "move",
      files: [c.relFile("一.txt"), c.relFile("二.txt")],
      params: { to: c.relFile("归档") },
    }),
    check: async (c) =>
      all(
        is("归档里", await tree(c.file("归档")), ["一.txt", "二.txt"]),
        yes("原处没了", !(await exists(c.file("一.txt"))) && !(await exists(c.file("二.txt")))),
      ),
    manifest: (c) => [
      {
        id: "files-05",
        kind: "tree",
        path: c.rel,
        expect: { present: ["归档/一.txt", "归档/二.txt"], absent: ["一.txt", "二.txt"] },
      },
    ],
  },
  {
    id: "files-06",
    skill: "files",
    title: "目标里已有同名文件：不覆盖、不移动",
    setup: async (c) => {
      await mkdir(c.file("归档"), { recursive: true });
      await writeFile(c.file("一.txt"), "新的\n");
      await writeFile(c.file("归档/一.txt"), "旧的\n");
      c.note.inside = await shaOf(c.file("归档/一.txt"));
      c.note.outside = await shaOf(c.file("一.txt"));
    },
    args: (c) => ({ action: "move", files: [c.relFile("一.txt")], params: { to: c.relFile("归档") } }),
    refused: "*",
    check: async (c) =>
      all(
        is("归档里的没变", await shaOf(c.file("归档/一.txt")), c.note.inside),
        is("原处的还在、没变", await shaOf(c.file("一.txt")), c.note.outside),
      ),
  },
  {
    id: "files-07",
    skill: "files",
    title: "把一个文件夹和一个文件压成 .zip",
    setup: async (c) => {
      await filesFixture(c);
      await writeFile(c.file("封面.txt"), "封面\n");
    },
    args: (c) => ({
      action: "zip",
      files: [c.relFile("资料"), c.relFile("封面.txt")],
      output: c.relFile("打包.zip"),
      params: {},
    }),
    check: async (c) => {
      const names = HxZip.read(await readFile(c.file("打包.zip")))
        .names()
        .filter((name) => !name.endsWith("/"))
        .sort();
      return is("包里的文件", names, [
        "封面.txt",
        "资料/子目录/季度报告.pdf",
        "资料/子目录/表.xlsx",
        "资料/年度报告.pdf",
        "资料/报告草稿.docx",
        "资料/说明.txt",
      ]);
    },
    manifest: (c) => [
      {
        id: "files-07",
        kind: "zip",
        path: c.relFile("打包.zip"),
        expect: {
          names: [
            "封面.txt",
            "资料/子目录/季度报告.pdf",
            "资料/子目录/表.xlsx",
            "资料/年度报告.pdf",
            "资料/报告草稿.docx",
            "资料/说明.txt",
          ],
        },
      },
    ],
  },
  {
    id: "files-08",
    skill: "files",
    title: "解压：每个文件和原来一模一样",
    setup: async (c) => {
      const files = {
        "合同.pdf": invoice(),
        "数据/表.xlsx": salesBook(),
        "数据/说明.txt": new TextEncoder().encode("说明\n"),
      };
      await writeFile(c.file("资料.zip"), hxStoredZip(Object.entries(files).map(([name, data]) => ({ name, data }))));
      c.note.shas = Object.fromEntries(Object.entries(files).map(([name, data]) => [name, sha(data)]));
    },
    args: (c) => ({ action: "unzip", files: [c.relFile("资料.zip")], output: c.relFile("解压"), params: {} }),
    check: async (c) => {
      const expected = c.note.shas;
      const checks: Check[] = [];
      if (expected && typeof expected === "object" && !Array.isArray(expected))
        for (const [name, hash] of Object.entries(expected))
          checks.push(is(name, await shaOf(join(c.file("解压"), name)).catch(() => "缺"), hash));
      return all(...checks);
    },
    manifest: (c) => [{ id: "files-08", kind: "tree", path: `${c.rel}/解压`, expect: { sha256: c.note.shas ?? {} } }],
  },
  {
    id: "files-09",
    skill: "files",
    title: "解压带“../”的危险包：拒绝，外面什么都不写",
    setup: async (c) => {
      await mkdir(c.file("里面"), { recursive: true });
      await writeFile(
        c.file("里面/危险.zip"),
        hxStoredZip([
          { name: "正常.txt", data: new TextEncoder().encode("ok\n") },
          { name: "../../逃出去.txt", data: new TextEncoder().encode("bad\n") },
        ]),
      );
    },
    args: (c) => ({ action: "unzip", files: [c.relFile("里面/危险.zip")], output: c.relFile("里面/解压"), params: {} }),
    refused: "*",
    check: async (c) =>
      all(
        yes(
          "外面没有“逃出去.txt”",
          !(await exists(c.file("逃出去.txt"))) && !(await exists(join(c.dir, "..", "逃出去.txt"))),
        ),
        yes("解压目录没留下半截", !(await exists(c.file("里面/解压/正常.txt")))),
      ),
  },
  {
    id: "files-10",
    skill: "files",
    title: "只找今天改过的文件",
    setup: async (c) => {
      await filesFixture(c);
      const old = new Date("2025-01-01T00:00:00Z");
      for (const name of ["资料/年度报告.pdf", "资料/报告草稿.docx", "资料/子目录/季度报告.pdf"])
        await utimes(c.file(name), old, old);
    },
    args: (c) => ({
      action: "find",
      files: [c.relFile("资料")],
      params: { modifiedAfter: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) },
    }),
    check: (_c, answer) =>
      all(
        yes("找到 说明.txt", text(answer).includes("说明.txt")),
        yes("找到 表.xlsx", text(answer).includes("表.xlsx")),
        yes("没有旧文件", !text(answer).includes("年度报告") && !text(answer).includes("季度报告")),
      ),
  },
];

// ---------------------------------------------------------------------------------------- settings

/** Per system: the settings and pages the samples use (all of them verified: verified.ts). */
const SETTING_KEYS = {
  mac: { first: "dark-mode", second: "dock-autohide", ambiguous: "程序坞", privacy: "隐私", plain: "声音" },
  windows: { first: "dark-mode", second: "clock-seconds", ambiguous: "任务栏", privacy: "隐私", plain: "声音" },
} as const;

function keys(c: Context) {
  return c.platform === "windows" ? SETTING_KEYS.windows : SETTING_KEYS.mac;
}
function other(values: HxSettingValues | undefined, current: string): string | null {
  if (!values) return null;
  if (values.type === "switch") return current === "on" ? "off" : "on";
  if (values.type === "choice") return values.options.find((option) => option !== current) ?? null;
  if (values.type === "number") return String(current === String(values.min) ? values.max : values.min);
  return null;
}
async function settingValue(c: Context, id: string): Promise<string | null> {
  const read = await c.settings?.readSetting({ id });
  return read?.status === "value" ? read.value : null;
}

const SETTINGS: Sample[] = [
  {
    id: "settings-01",
    skill: "settings",
    title: "读“深色模式”",
    needsSettings: true,
    args: () => ({ action: "read", params: { query: "深色模式" } }),
    check: async (c, answer) => {
      const value = await settingValue(c, `setting:${keys(c).first}`);
      return all(yes("读到了值", value !== null), is("和另读一次的一样", field(answer, "value"), value));
    },
  },
  {
    id: "settings-02",
    skill: "settings",
    title: "按编号读一项设置",
    needsSettings: true,
    args: (c) => ({ action: "read", params: { id: `setting:${keys(c).second}` } }),
    check: async (c, answer) => is("值", field(answer, "value"), await settingValue(c, `setting:${keys(c).second}`)),
  },
  {
    id: "settings-03",
    skill: "settings",
    title: "把深色模式改成相反的值",
    needsSettings: true,
    changesSetting: true,
    setup: async (c) => {
      const read = await c.settings?.readSetting({ id: `setting:${keys(c).first}` });
      if (read?.status !== "value") throw new Error("读不到深色模式。");
      c.shared.darkBefore = read.value;
      c.note.after = other(read.setting.values, read.value);
    },
    args: (c) => ({ action: "change", params: { id: `setting:${keys(c).first}`, value: String(c.note.after) } }),
    check: async (c, answer) =>
      all(
        is("另读一次", await settingValue(c, `setting:${keys(c).first}`), c.note.after),
        yes("技能说读回对上了", field(answer, "verified") === true),
      ),
  },
  {
    id: "settings-04",
    skill: "settings",
    title: "再改回原来的值",
    needsSettings: true,
    changesSetting: true,
    setup: async (c) => {
      const id = `setting:${keys(c).first}`;
      const read = await c.settings?.readSetting({ id });
      if (read?.status !== "value") throw new Error("读不到深色模式。");
      if (typeof c.shared.darkBefore === "string" && c.shared.darkBefore !== read.value) {
        c.note.back = c.shared.darkBefore;
        return;
      }
      // Run alone (or settings-03 did not change it): change it first, so there is something to change back.
      const away = other(read.setting.values, read.value);
      if (away === null) throw new Error("深色模式没有别的值可改。");
      await c.settings?.set({ id, value: away });
      c.note.back = read.value;
    },
    args: (c) => ({ action: "change", params: { id: `setting:${keys(c).first}`, value: String(c.note.back) } }),
    check: async (c, answer) =>
      all(
        is("另读一次", await settingValue(c, `setting:${keys(c).first}`), c.note.back),
        yes("回答里有改之前的值（可以撤销）", typeof field(answer, "previous") === "string"),
      ),
  },
  {
    id: "settings-05",
    skill: "settings",
    title: "改成它现在的值：说不用改",
    needsSettings: true,
    setup: async (c) => {
      c.note.value = await settingValue(c, `setting:${keys(c).second}`);
    },
    args: (c) => ({ action: "change", params: { id: `setting:${keys(c).second}`, value: String(c.note.value) } }),
    check: async (c, answer) =>
      all(
        yes("回答“不用改”", String(field(answer, "done") ?? "").startsWith("Nothing to change")),
        is("值没变", await settingValue(c, `setting:${keys(c).second}`), c.note.value),
      ),
  },
  {
    id: "settings-06",
    skill: "settings",
    title: "不合法的值：拒绝，值不变",
    needsSettings: true,
    setup: async (c) => {
      c.note.value = await settingValue(c, `setting:${keys(c).first}`);
    },
    args: (c) => ({ action: "change", params: { id: `setting:${keys(c).first}`, value: "maybe" } }),
    refused: "invalid",
    check: async (c) => is("值没变", await settingValue(c, `setting:${keys(c).first}`), c.note.value),
  },
  {
    id: "settings-07",
    skill: "settings",
    title: "说得太笼统：列出几项让它选",
    needsSettings: true,
    args: (c) => ({ action: "read", params: { query: keys(c).ambiguous } }),
    refused: "choose",
    check: (_c, answer) => {
      const list = field(answer, "candidates");
      return yes("至少两项可选", Array.isArray(list) && list.length >= 2);
    },
  },
  {
    id: "settings-08",
    skill: "settings",
    title: "要关防火墙：只打开页面，不改",
    needsSettings: true,
    setup: async (c) => {
      c.note.value = await settingValue(c, `setting:${keys(c).first}`);
    },
    args: () => ({ action: "change", params: { query: "防火墙", value: "off" } }),
    refused: "not-changed",
    check: async (c, answer) =>
      all(
        yes("是安全页", JSON.stringify(field(answer, "page") ?? null).includes('"security":true')),
        is("别的设置也没动", await settingValue(c, `setting:${keys(c).first}`), c.note.value),
      ),
  },
  {
    id: "settings-09",
    skill: "settings",
    title: "打开“隐私与安全性”：只打开，不改任何值",
    needsSettings: true,
    setup: async (c) => {
      c.note.first = await settingValue(c, `setting:${keys(c).first}`);
      c.note.second = await settingValue(c, `setting:${keys(c).second}`);
    },
    args: (c) => ({ action: "open", params: { query: keys(c).privacy } }),
    check: async (c, answer) =>
      all(
        yes("打开了", String(field(answer, "done") ?? "").endsWith("is open.")),
        is("深色模式没变", await settingValue(c, `setting:${keys(c).first}`), c.note.first),
        is(`${keys(c).second} 没变`, await settingValue(c, `setting:${keys(c).second}`), c.note.second),
      ),
  },
  {
    id: "settings-10",
    skill: "settings",
    title: "打开“声音”设置页",
    needsSettings: true,
    args: (c) => ({ action: "open", params: { query: keys(c).plain } }),
    check: (_c, answer) => yes("打开了", String(field(answer, "done") ?? "").endsWith("is open.")),
  },
];

// -------------------------------------------------------------------------------------- app route

/** Copies a fixture of hx/computer-check/fixtures into the task's folder. */
async function fixture(c: Context, name: string, as = name): Promise<void> {
  await copyFile(join(c.fixtures, name), c.file(as));
}

/** The app that the route of this file type tries first on this system, to see that it stays as it was. */
function routeApp(c: Context, type: "xlsx" | "docx" | "pptx"): string | null {
  if (c.platform === "mac")
    return { xlsx: "Microsoft Excel", docx: "Microsoft Word", pptx: "Microsoft PowerPoint" }[type];
  if (c.platform === "windows") return { xlsx: "EXCEL", docx: "WINWORD", pptx: "POWERPNT" }[type];
  return null;
}

async function rememberApp(c: Context, app: string | null): Promise<void> {
  if (app) c.note.appBefore = await c.appRunning(app);
}
async function appAsBefore(c: Context, app: string | null): Promise<Check> {
  if (!app || typeof c.note.appBefore !== "boolean") return { pass: true, detail: "（这台电脑不看应用是否在运行）" };
  const now = await c.appRunning(app);
  return is(`${app} 运行着`, now, c.note.appBefore);
}

/**
 * Saves a modern file as Keynote, Numbers or Pages does (a Mac with the app): the fixture of an iWork
 * task. AppleScript reads the environment in the system's old encoding, so the paths it gets are ASCII:
 * the copy is made in a temporary folder and moved into the task's folder afterwards.
 */
async function iworkCopy(c: Context, app: string, from: string, to: string): Promise<void> {
  const run = c.apps?.run;
  if (!run) throw new Error("没有可以用的应用。");
  const script = hxMacOwnScript({
    app,
    collection: "documents",
    open: ["open (POSIX file inPath as alias)"],
    work: ["save theDoc in (POSIX file outPath)"],
  });
  const temp = await mkdtemp(join(tmpdir(), "hxbot-iwork-"));
  try {
    const stem = hxCopyStem();
    const input = join(temp, `${stem}${extname(from)}`);
    const output = join(temp, `out${extname(to)}`);
    await copyFile(join(c.fixtures, from), input);
    const result = await hxOsascript({ run, platform: "darwin" }, script, {
      HX_IN: input,
      HX_OUT: output,
      HX_STEM: stem,
    });
    if (result.code !== 0 || !(await exists(output)))
      throw new Error(`${app} 没能存出 ${to}：${result.stderr.slice(0, 200)}`);
    // An iWork file may be a folder (a package) or a single file.
    await cp(output, c.file(to), { recursive: true });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

const APPS: Sample[] = [
  {
    id: "apps-01",
    skill: "sheet",
    title: "读 .csv（HXBot 自己读，不经过应用）",
    needsApp: {},
    setup: async (c) => {
      await fixture(c, "名单.csv");
      await rememberApp(c, routeApp(c, "xlsx"));
    },
    args: (c) => ({ action: "read", files: [c.relFile("名单.csv")], params: {} }),
    check: async (c, answer) =>
      all(
        yes("读到“张三”和 90", text(answer).includes("张三") && text(answer).includes("90")),
        yes("写明哪个应用转的", typeof field(answer, "convertedBy") === "string"),
        await appAsBefore(c, routeApp(c, "xlsx")),
      ),
  },
  {
    id: "apps-02",
    skill: "sheet",
    title: "改 .xls 的一格：改到新的 .xlsx，原文件不动",
    needsApp: {},
    setup: async (c) => {
      await fixture(c, "名单.xls");
      c.note.sha = await shaOf(c.file("名单.xls"));
      await rememberApp(c, routeApp(c, "xlsx"));
    },
    args: (c) => ({ action: "write", files: [c.relFile("名单.xls")], params: { cells: { B3: 88 } } }),
    check: async (c) =>
      all(
        is("原 .xls 没变", await shaOf(c.file("名单.xls")), c.note.sha),
        is("新 .xlsx 的 B3", await cellText(c.file("名单.xlsx"), null, "B3"), "88"),
        is("新 .xlsx 的 A2", await cellText(c.file("名单.xlsx"), null, "A2"), "张三"),
        await appAsBefore(c, routeApp(c, "xlsx")),
      ),
    manifest: (c) => [
      {
        id: "apps-02",
        kind: "xlsx",
        path: c.relFile("名单.xlsx"),
        expect: { cells: { B3: 88, A2: "张三" }, firstSheet: true },
      },
    ],
  },
  {
    id: "apps-03",
    skill: "document",
    title: "改 .doc 的一段：改到新的 .docx，原文件不动",
    needsApp: {},
    setup: async (c) => {
      await fixture(c, "通知.doc");
      c.note.sha = await shaOf(c.file("通知.doc"));
      await rememberApp(c, routeApp(c, "docx"));
    },
    args: (c) => ({
      action: "replace",
      files: [c.relFile("通知.doc")],
      params: { find: "周五下午三点", replace: "周四上午十点" },
    }),
    check: async (c) => {
      const list = await paragraphs(c.file("通知.docx"));
      return all(
        is("原 .doc 没变", await shaOf(c.file("通知.doc")), c.note.sha),
        yes("新 .docx 里是“周四上午十点开会。”", list.includes("周四上午十点开会。")),
        yes("别的段落还在", list.includes("会议通知") && list.includes("请准时参加。")),
        await appAsBefore(c, routeApp(c, "docx")),
      );
    },
    manifest: (c) => [
      {
        id: "apps-03",
        kind: "docx",
        path: c.relFile("通知.docx"),
        expect: { absent: ["周五下午三点"], count: { 周四上午十点: 1 } },
      },
    ],
  },
  {
    id: "apps-04",
    skill: "slides",
    title: "改 .ppt 的标题：改到新的 .pptx，原文件不动",
    needsApp: {},
    setup: async (c) => {
      await fixture(c, "汇报.ppt");
      c.note.sha = await shaOf(c.file("汇报.ppt"));
      await rememberApp(c, routeApp(c, "pptx"));
    },
    args: (c) => ({
      action: "text",
      files: [c.relFile("汇报.ppt")],
      params: { slide: 2, target: "title", text: "年度回顾" },
    }),
    check: async (c) =>
      all(
        is("原 .ppt 没变", await shaOf(c.file("汇报.ppt")), c.note.sha),
        is("新 .pptx 第 2 页标题", (await slideTitles(c.file("汇报.pptx")))[1], "年度回顾"),
        await appAsBefore(c, routeApp(c, "pptx")),
      ),
    manifest: (c) => [
      { id: "apps-04", kind: "pptx", path: c.relFile("汇报.pptx"), expect: { titleOf: { "2": "年度回顾" } } },
    ],
  },
  {
    id: "apps-05",
    skill: "document",
    title: "读 .rtf",
    needsApp: {},
    setup: async (c) => {
      await fixture(c, "通知.rtf");
      await rememberApp(c, routeApp(c, "docx"));
    },
    args: (c) => ({ action: "read", files: [c.relFile("通知.rtf")], params: {} }),
    check: async (c, answer) =>
      all(
        yes("读到“周五下午三点开会。”", text(answer).includes("周五下午三点开会。")),
        await appAsBefore(c, routeApp(c, "docx")),
      ),
  },
  {
    id: "apps-06",
    skill: "slides",
    title: "Keynote：改 .key 第 2 页的标题（Keynote 在文件本身上改）",
    needsApp: { platform: "mac", app: "Keynote" },
    setup: async (c) => {
      c.note.appBefore = await c.appRunning("Keynote");
      await iworkCopy(c, "Keynote", "汇报.pptx", "汇报.key");
    },
    args: (c) => ({
      action: "text",
      files: [c.relFile("汇报.key")],
      params: { slide: 2, target: "title", text: "年度回顾" },
    }),
    check: async (c, answer) =>
      all(
        yes(
          "Keynote 自己改的（没有另存 .pptx）",
          !(await exists(c.file("汇报 (2).pptx"))) && !(await exists(c.file("汇报.pptx.pptx"))),
        ),
        yes("技能读回对上了", field(answer, "verified") === true),
        kept(answer),
        await appAsBefore(c, "Keynote"),
      ),
  },
  {
    id: "apps-07",
    skill: "sheet",
    title: "Numbers：读 .numbers",
    needsApp: { platform: "mac", app: "Numbers" },
    setup: async (c) => {
      c.note.appBefore = await c.appRunning("Numbers");
      await iworkCopy(c, "Numbers", "名单.xlsx", "名单.numbers");
    },
    args: (c) => ({ action: "read", files: [c.relFile("名单.numbers")], params: {} }),
    check: async (c, answer) =>
      all(
        yes("读到“李四”和 85", text(answer).includes("李四") && text(answer).includes("85")),
        await appAsBefore(c, "Numbers"),
      ),
  },
  {
    id: "apps-08",
    skill: "document",
    title: "Pages：读 .pages",
    needsApp: { platform: "mac", app: "Pages" },
    setup: async (c) => {
      c.note.appBefore = await c.appRunning("Pages");
      await iworkCopy(c, "Pages", "通知.docx", "通知.pages");
    },
    args: (c) => ({ action: "read", files: [c.relFile("通知.pages")], params: {} }),
    check: async (c, answer) =>
      all(yes("读到“请准时参加。”", text(answer).includes("请准时参加。")), await appAsBefore(c, "Pages")),
  },
  {
    id: "apps-09",
    skill: "sheet",
    title: "实时数据透视表（Windows 上的 Excel 或 WPS 表格）",
    needsApp: { platform: "windows" },
    setup: async (c) => {
      await writeFile(c.file("销售.xlsx"), salesBook());
      await rememberApp(c, routeApp(c, "xlsx"));
    },
    args: (c) => ({
      action: "pivot",
      files: [c.relFile("销售.xlsx")],
      params: { range: "A1:D6", rows: ["部门"], values: [{ column: "金额", fn: "sum" }] },
    }),
    check: async (c, answer) => {
      const zip = HxZip.read(await readFile(c.file("销售.xlsx")));
      return all(
        yes(
          "文件里有透视表",
          zip.names().some((name) => /^xl\/pivotTables\/pivotTable\d+\.xml$/u.test(name)),
        ),
        kept(answer),
        await appAsBefore(c, routeApp(c, "xlsx")),
      );
    },
  },
];

export const HX_SKILL_SAMPLES: readonly Sample[] = [...SHEET, ...DOCUMENT, ...SLIDES, ...PDF, ...FILES, ...SETTINGS];

/** The tasks of the app route, apart from the 60: they need the apps of the computer. */
export const HX_APP_SAMPLES: readonly Sample[] = APPS;

// ------------------------------------------------------------------------------------------ runner

function rates(results: readonly HxSampleResult[]): HxSampleReport["rates"] {
  const out: HxSampleReport["rates"] = {};
  const add = (key: string, result: HxSampleResult) => {
    const entry = out[key] ?? { consistent: 0, counted: 0, rate: 0 };
    if (result.status !== "跳过") {
      entry.counted += 1;
      if (result.status === "一致") entry.consistent += 1;
    }
    entry.rate = entry.counted ? entry.consistent / entry.counted : 0;
    out[key] = entry;
  };
  for (const result of results) {
    if (result.group === "apps") {
      add("apps", result);
      continue;
    }
    add(result.skill, result);
    add("all", result);
  }
  return out;
}

/** Why a task does not run on this computer, or null. */
async function skipReason(sample: Sample, host: HxSampleHost): Promise<string | null> {
  if (sample.needsSettings && (host.settings === null || host.platform === "linux"))
    return "这台电脑没有可用的系统设置（只在 macOS、Windows 上）";
  if (sample.changesSetting && !host.settingsChanges) return "会改这台电脑的系统设置：只在 GitHub 的检查机和替身上跑";
  const needs = sample.needsApp;
  if (!needs) return null;
  if (!host.apps || !host.fixtures) return "这次没有用这台电脑的应用（加 --apps）";
  // The apps are the real computer's, also when the settings come from a stand-in.
  const real = host.apps.platform === "darwin" ? "mac" : host.apps.platform === "win32" ? "windows" : "linux";
  if (needs.platform && needs.platform !== real) return needs.platform === "mac" ? "只在 Mac 上" : "只在 Windows 上";
  if (needs.app && host.appInstalled && !(await host.appInstalled(needs.app))) return `这台电脑没有装 ${needs.app}`;
  return null;
}

/** Runs the samples one by one, each in a folder of its own, and reads every result back. */
export async function hxRunSkillSamples(host: HxSampleHost): Promise<HxSampleReport> {
  const now = host.now ?? Date.now;
  const versions = new HxFileVersions({ root: () => join(host.data, "file-versions") });
  const runner = new HxSkillRunner({
    versions,
    record: () => {},
    askSpaceFull: null,
    app: host.apps ?? null,
    settings: host.settings,
    protectedRoots: [host.data],
    requests: new HxSkillRequests(),
  });
  const results: HxSampleResult[] = [];
  const manifest: HxSampleManifestItem[] = [];
  const shared: Record<string, HxJson> = {};
  // The settings the samples may change, as they are before: put back at the end whatever happens.
  const before = new Map<string, string>();
  if (host.settings && host.settingsChanges && host.platform !== "linux") {
    const platformKeys = host.platform === "windows" ? SETTING_KEYS.windows : SETTING_KEYS.mac;
    for (const key of [platformKeys.first, platformKeys.second]) {
      const read = await host.settings.readSetting({ id: `setting:${key}` });
      if (read.status === "value") before.set(`setting:${key}`, read.value);
    }
  }
  const samples = [
    ...HX_SKILL_SAMPLES.map((sample) => ({ sample, group: "samples" as const })),
    ...APPS.map((sample) => ({ sample, group: "apps" as const })),
  ];
  for (const { sample, group } of samples) {
    if (host.only && !host.only.includes(sample.id)) continue;
    const dir = join(host.work, sample.id);
    await mkdir(dir, { recursive: true });
    const context: Context = {
      dir,
      rel: sample.id,
      file: (name) => join(dir, name),
      relFile: (name) => `${sample.id}/${name}`,
      note: {},
      shared,
      settings: host.settings,
      platform: host.platform,
      apps: host.apps ?? null,
      fixtures: host.fixtures ?? "",
      appRunning: host.appRunning ?? (async () => null),
    };
    const base = { id: sample.id, group, skill: sample.skill, title: sample.title };
    const skip = await skipReason(sample, host);
    if (skip) {
      results.push({
        ...base,
        status: "跳过",
        ok: false,
        verified: null,
        readback: { pass: false, detail: skip },
        ms: 0,
        answer: "",
      });
      host.log?.(`跳过 ${sample.id} ${sample.title}：${skip}`);
      continue;
    }
    const began = now();
    let answer: HxSkillAnswer | null = null;
    let result: HxSampleResult;
    try {
      await sample.setup?.(context);
      const args = { skill: sample.skill, ...(await sample.args(context)) };
      answer = await runner.run(
        { agentName: "样例", task: `samples-${sample.id}`, cwd: host.work, allowed: "yes" },
        args,
      );
      const code = field(answer, "code");
      const verified = typeof field(answer, "verified") === "boolean" ? field(answer, "verified") === true : null;
      const expectedOutcome = sample.refused
        ? !answer.ok && (sample.refused === "*" || code === sample.refused)
        : answer.ok;
      const readback = await sample.check(context, answer);
      const consistent = expectedOutcome && readback.pass && verified !== false;
      const detail = expectedOutcome
        ? readback.detail
        : `${sample.refused ? `应拒绝（${sample.refused}），实际 ${answer.ok ? "做了" : String(code)}` : `技能没做成：${String(code)} ${String(field(answer, "error") ?? "")}`}；${readback.detail}`;
      result = {
        ...base,
        status: consistent ? "一致" : "待核实",
        ok: answer.ok,
        verified,
        readback: { pass: readback.pass && expectedOutcome, detail },
        ms: now() - began,
        answer: text(answer).slice(0, 800),
      };
      if (sample.manifest && answer.ok) manifest.push(...sample.manifest(context));
    } catch (error) {
      // A failure of the setup or of the read-back: the answer (if any) stays in the report.
      result = {
        ...base,
        status: answer?.ok ? "待核实" : "出错",
        ok: answer?.ok ?? false,
        verified: null,
        readback: {
          pass: false,
          detail: `${answer ? "读回时" : "做之前"}出错：${error instanceof Error ? error.message.slice(0, 300) : "出错了"}`,
        },
        ms: now() - began,
        answer: answer ? text(answer).slice(0, 800) : "",
      };
    }
    results.push(result);
    host.log?.(`${result.status} ${sample.id} ${sample.title}：${result.readback.detail}`);
  }
  const restored: string[] = [];
  for (const [id, value] of before) {
    const read = await host.settings?.readSetting({ id });
    if (read?.status === "value" && read.value !== value) {
      await host.settings?.set({ id, value });
      restored.push(`${id} → ${value}`);
      host.log?.(`改回 ${id} = ${value}`);
    }
  }
  return {
    platform: host.platform,
    machine: host.machine,
    at: new Date(now()).toISOString(),
    results,
    manifest,
    rates: rates(results),
    restored,
  };
}

/** The report as a table in Markdown (样例任务与读回结果). */
export function hxSamplesMarkdown(report: HxSampleReport): string {
  const all = report.rates.all;
  const lines = [
    `# 六个技能的样例任务与读回结果（${report.machine}，${report.platform}）`,
    "",
    `时间：${report.at}。一致 ${all?.consistent ?? 0} / ${all?.counted ?? 0}（${((all?.rate ?? 0) * 100).toFixed(1)}%），门槛 ≥ 90%。`,
    "",
    "| 技能 | 一致 / 计数 | 比例 |",
    "| --- | --- | --- |",
    ...Object.entries(report.rates)
      .filter(([key]) => key !== "all" && key !== "apps")
      .map(([key, rate]) => `| ${key} | ${rate.consistent} / ${rate.counted} | ${(rate.rate * 100).toFixed(0)}% |`),
    "",
    ...(report.rates.apps
      ? [`应用路线（不算在 60 条里）：一致 ${report.rates.apps.consistent} / ${report.rates.apps.counted}。`, ""]
      : []),
    "| 编号 | 任务 | 结果 | 技能自己的读回 | 从磁盘读回 | 用时 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.results.map(
      (result) =>
        `| ${result.id} | ${result.title} | ${result.status} | ${result.verified === null ? "—" : result.verified ? "对上" : "没对上"} | ${result.readback.detail.replace(/\|/gu, "\\|")} | ${result.ms} ms |`,
    ),
    "",
  ];
  return lines.join("\n");
}
