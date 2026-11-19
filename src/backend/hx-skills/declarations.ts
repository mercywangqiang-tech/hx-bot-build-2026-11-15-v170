// HXBot v1.7.4（CU-07）：六个内置应用技能的声明。每个技能写明读写哪些文件类型、可以用哪些应用、
// 是否外发（都不外发）、每个动作是否改文件、是否幂等、怎么读回核对，以及动作的参数（严格校验）。
// 调用超出声明的（文件类型不对、动作不存在、参数多了或不对）一律拒绝，并记进“授权与记录”。
import { z } from "zod";

/** The tool's name; the router hands it to hx-computer with the other computer tools. */
export const HX_SKILL_TOOL = "computer_skill";

export const HX_SKILL_NAMES = ["sheet", "document", "slides", "pdf", "files", "settings"] as const;
export type HxSkillName = (typeof HX_SKILL_NAMES)[number];

export interface HxSkillAction {
  /** It changes or makes files (and so keeps a version and returns a diff). */
  changes: boolean;
  /** Doing it twice gives what doing it once gives. */
  idempotent: boolean;
  /** How the result is read back and checked, in a few words for the model. */
  readback: string;
  /** The params, in one line for the model ("range?: A1:C9; sheet?: name"). */
  usage: string;
  params: z.ZodType;
  /** It needs an app (Excel, Word, PowerPoint, WPS, Keynote) through Computer Use, not only HXBot's own reader. */
  app?: boolean;
}

export interface HxSkillDeclaration {
  name: HxSkillName;
  /** File types it reads (by extension, lower case); [] for none. */
  reads: readonly string[];
  /** File types it writes. */
  writes: readonly string[];
  /** Types it handles only through an app, converting them first. */
  appTypes: readonly string[];
  /** Apps of the app route, by platform. */
  apps: { readonly mac: readonly string[]; readonly windows: readonly string[] };
  /** Whether anything leaves this computer: never for the built-in skills. */
  sends: false;
  actions: Readonly<Record<string, HxSkillAction>>;
}

const cell = z.string().regex(/^\$?[A-Za-z]{1,3}\$?[0-9]{1,7}$/, "a cell such as B2");
const range = z
  .string()
  .regex(/^\$?[A-Za-z]{1,3}\$?[0-9]{1,7}(:\$?[A-Za-z]{1,3}\$?[0-9]{1,7})?$/, "a range such as A1:C9");
const sheetName = z.string().min(1).max(31);
const scalar = z.union([z.string().max(32_767), z.number(), z.boolean(), z.null()]);
const cellInput = z.union([
  scalar,
  z.strictObject({ formula: z.string().min(1).max(8192) }),
  z.strictObject({ date: z.string().min(8).max(25) }),
]);
const look = {
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  size: z.number().min(1).max(400).optional(),
  color: z
    .string()
    .regex(/^[0-9A-Fa-f]{6}$/)
    .optional(),
  font: z.string().min(1).max(80).optional(),
};
const track = { track: z.boolean().optional() };
const index = z.number().int().min(0).max(1_000_000);
const slide = z.number().int().min(1).max(100_000);
const text = z.string().max(100_000);
const path = z.string().min(1).max(1024);

export const SHEET_PARAMS = {
  sheets: z.strictObject({}),
  read: z.strictObject({
    sheet: sheetName.optional(),
    range: range.optional(),
    limit: z.number().int().min(1).max(20_000).optional(),
  }),
  write: z.strictObject({ sheet: sheetName.optional(), cells: z.record(cell, cellInput) }),
  filter: z.strictObject({
    sheet: sheetName.optional(),
    range,
    columns: z
      .array(
        z.strictObject({
          column: z.string().min(1).max(200),
          equals: z.array(z.string().max(1000)).max(500).optional(),
          op: z.enum(["gt", "ge", "lt", "le", "ne", "eq", "contains"]).optional(),
          value: z.union([z.string().max(1000), z.number()]).optional(),
        }),
      )
      .min(1)
      .max(50),
  }),
  "clear-filter": z.strictObject({ sheet: sheetName.optional() }),
  summary: z.strictObject({
    sheet: sheetName.optional(),
    range,
    rows: z.array(z.string().min(1).max(200)).min(1).max(10),
    values: z
      .array(
        z.strictObject({
          column: z.string().min(1).max(200),
          fn: z.enum(["sum", "count", "average", "min", "max"]),
          label: z.string().max(200).optional(),
        }),
      )
      .min(1)
      .max(20),
    totalLabel: z.string().max(100).optional(),
  }),
  chart: z.strictObject({
    sheet: sheetName.optional(),
    type: z.enum(["column", "bar", "line", "pie"]),
    title: z.string().max(200).optional(),
    categories: z.string().min(2).max(100),
    series: z
      .array(z.strictObject({ name: z.string().max(200).optional(), values: z.string().min(2).max(100) }))
      .min(1)
      .max(32),
    anchor: range.optional(),
  }),
  "add-sheet": z.strictObject({ name: z.string().min(1).max(100) }),
  combine: z.strictObject({
    sheets: z.array(sheetName).min(1).max(100).optional(),
    header: z.boolean().optional(),
    source: z.boolean().optional(),
    name: z.string().min(1).max(31).optional(),
  }),
  pivot: z.strictObject({
    sheet: sheetName.optional(),
    range,
    rows: z.array(z.string().min(1).max(200)).min(1).max(10),
    values: z
      .array(
        z.strictObject({ column: z.string().min(1).max(200), fn: z.enum(["sum", "count", "average", "min", "max"]) }),
      )
      .min(1)
      .max(20),
  }),
};

export const DOCUMENT_PARAMS = {
  read: z.strictObject({ from: index.optional(), limit: z.number().int().min(1).max(5000).optional() }),
  replace: z.strictObject({
    find: z.string().min(1).max(10_000),
    replace: z.string().max(10_000),
    all: z.boolean().optional(),
    matchCase: z.boolean().optional(),
    ...track,
  }),
  "set-paragraph": z.strictObject({ index, text, ...track }),
  insert: z.strictObject({
    after: z.number().int().min(-1).max(1_000_000),
    text,
    style: z.string().min(1).max(100).optional(),
    ...track,
  }),
  delete: z.strictObject({ index, ...track }),
  style: z.strictObject({ index, style: z.string().min(1).max(100) }),
  format: z.strictObject({ index, ...look }),
  cell: z.strictObject({ table: index, row: index, col: index, text, ...track }),
  "add-row": z.strictObject({ table: index, values: z.array(z.string().max(10_000)).min(1).max(63), ...track }),
  "insert-table": z.strictObject({
    after: z.number().int().min(-1).max(1_000_000),
    rows: z
      .array(z.array(z.string().max(10_000)).min(1).max(63))
      .min(1)
      .max(2000),
  }),
  "accept-changes": z.strictObject({}),
  "reject-changes": z.strictObject({}),
};

export const SLIDES_PARAMS = {
  read: z.strictObject({}),
  add: z.strictObject({
    layout: z.string().min(1).max(100).optional(),
    title: z.string().max(10_000).optional(),
    body: z.string().max(100_000).optional(),
    at: slide.optional(),
  }),
  delete: z.strictObject({ slide }),
  move: z.strictObject({ slide, to: slide }),
  duplicate: z.strictObject({ slide }),
  text: z.strictObject({ slide, target: z.string().min(1).max(200), text }),
  notes: z.strictObject({ slide, text }),
  layout: z.strictObject({ slide, layout: z.string().min(1).max(100) }),
  "add-picture": z.strictObject({
    slide,
    picture: path,
    x: z.number().int().min(0).max(51_206_400).optional(),
    y: z.number().int().min(0).max(51_206_400).optional(),
    cx: z.number().int().min(1).max(51_206_400).optional(),
    cy: z.number().int().min(1).max(51_206_400).optional(),
  }),
  "replace-picture": z.strictObject({ slide, index: z.number().int().min(1).max(1000), picture: path }),
};

export const PDF_PARAMS = {
  read: z.strictObject({
    pages: z.string().max(500).optional(),
    maxChars: z.number().int().min(100).max(5_000_000).optional(),
  }),
  fields: z.strictObject({}),
  fill: z.strictObject({
    values: z.record(z.string().min(1).max(500), z.union([z.string().max(100_000), z.boolean()])),
  }),
  extract: z.strictObject({ pages: z.string().min(1).max(500) }),
  split: z.strictObject({
    every: z.number().int().min(1).max(10_000).optional(),
    ranges: z.array(z.string().min(1).max(500)).min(1).max(500).optional(),
  }),
  merge: z.strictObject({ bookmarks: z.boolean().optional(), title: z.string().max(500).optional() }),
};

export const FILES_PARAMS = {
  find: z.strictObject({
    name: z.string().min(1).max(200).optional(),
    ext: z.array(z.string().min(1).max(12)).max(30).optional(),
    modifiedAfter: z.string().min(8).max(25).optional(),
    depth: z.number().int().min(0).max(12).optional(),
    limit: z.number().int().min(1).max(2000).optional(),
  }),
  move: z.strictObject({ to: path, onExists: z.enum(["refuse", "rename"]).optional() }),
  rename: z.strictObject({ name: z.string().min(1).max(255), onExists: z.enum(["refuse", "rename"]).optional() }),
  zip: z.strictObject({}),
  unzip: z.strictObject({}),
};

export const SETTINGS_PARAMS = {
  read: z.strictObject({ query: z.string().min(1).max(200).optional(), id: z.string().min(1).max(600).optional() }),
  change: z.strictObject({
    query: z.string().min(1).max(200).optional(),
    id: z.string().min(1).max(600).optional(),
    value: z.string().min(1).max(1024),
  }),
  open: z.strictObject({ query: z.string().min(1).max(200).optional(), id: z.string().min(1).max(600).optional() }),
};

const SHEET: HxSkillDeclaration = {
  name: "sheet",
  reads: ["xlsx", "xlsm", "xltx", "xltm"],
  writes: ["xlsx", "xlsm", "xltx", "xltm"],
  appTypes: ["xls", "et", "csv", "numbers"],
  apps: {
    mac: ["Microsoft Excel", "wpsoffice", "Numbers"],
    windows: ["Excel.Application", "Ket.Application", "KET.Application"],
  },
  sends: false,
  actions: {
    sheets: { changes: false, idempotent: true, readback: "none", usage: "", params: SHEET_PARAMS.sheets },
    read: {
      changes: false,
      idempotent: true,
      readback: "none",
      usage: "sheet?; range? (A1:C9); limit? cells",
      params: SHEET_PARAMS.read,
    },
    write: {
      changes: true,
      idempotent: true,
      readback: "each cell read back from the saved file; formulas computed again where HXBot can",
      usage: 'sheet?; cells: {"B2": 5, "C2": {"formula": "=B2*2"}, "D2": {"date": "2026-11-19"}, "E2": null}',
      params: SHEET_PARAMS.write,
    },
    filter: {
      changes: true,
      idempotent: true,
      readback: "the filter range and the rows shown and hidden",
      usage:
        'sheet?; range; columns: [{"column": "Region" or "B", "equals"?: [..], "op"?: gt|ge|lt|le|ne|eq|contains, "value"?}]',
      params: SHEET_PARAMS.filter,
    },
    "clear-filter": {
      changes: true,
      idempotent: true,
      readback: "no filter and no hidden row left",
      usage: "sheet?",
      params: SHEET_PARAMS["clear-filter"],
    },
    summary: {
      changes: true,
      idempotent: false,
      readback: "the new sheet read back, its total row checked against the source",
      usage:
        'sheet?; range; rows: ["Region"]; values: [{"column": "Sales", "fn": sum|count|average|min|max, "label"?}]',
      params: SHEET_PARAMS.summary,
    },
    chart: {
      changes: true,
      idempotent: false,
      readback: "the chart part and its ranges",
      usage:
        'sheet?; type: column|bar|line|pie; title?; categories: "A2:A9"; series: [{"name"?, "values": "B2:B9"}]; anchor? (E2:L18)',
      params: SHEET_PARAMS.chart,
    },
    "add-sheet": {
      changes: true,
      idempotent: false,
      readback: "the sheet list",
      usage: "name",
      params: SHEET_PARAMS["add-sheet"],
    },
    combine: {
      changes: true,
      idempotent: false,
      readback: "the new sheet read back: row count, header, first and last rows",
      usage:
        "files: [the workbook that gets the new sheet, then other workbooks]; sheets? (names; default every visible sheet); header? (first row is the header, default true); source? (first column names the file and sheet, default true); name? (default 合并)",
      params: SHEET_PARAMS.combine,
    },
    pivot: {
      changes: true,
      idempotent: false,
      app: true,
      readback: "the pivot table read back in the app",
      usage:
        "sheet?; range; rows: [..]; values: [{column, fn}] — a live PivotTable in Excel or WPS (Windows); otherwise use summary",
      params: SHEET_PARAMS.pivot,
    },
  },
};

const DOCUMENT: HxSkillDeclaration = {
  name: "document",
  reads: ["docx", "docm", "dotx", "dotm"],
  writes: ["docx", "docm", "dotx", "dotm"],
  appTypes: ["doc", "wps", "rtf", "odt", "pages"],
  apps: {
    mac: ["Microsoft Word", "wpsoffice", "Pages"],
    windows: ["Word.Application", "Kwps.Application", "KWPS.Application"],
  },
  sends: false,
  actions: {
    read: {
      changes: false,
      idempotent: true,
      readback: "none",
      usage: "from? paragraph; limit? paragraphs",
      params: DOCUMENT_PARAMS.read,
    },
    replace: {
      changes: true,
      idempotent: false,
      readback: "the paragraphs that changed read back from the saved file",
      usage: "find; replace; all?; matchCase?; track? (tracked change)",
      params: DOCUMENT_PARAMS.replace,
    },
    "set-paragraph": {
      changes: true,
      idempotent: true,
      readback: "the paragraph text",
      usage: "index (from 0); text; track?",
      params: DOCUMENT_PARAMS["set-paragraph"],
    },
    insert: {
      changes: true,
      idempotent: false,
      readback: "the new paragraph and its style",
      usage: "after (paragraph index, -1 for the start); text; style? (Heading 1, 标题 1, Quote...); track?",
      params: DOCUMENT_PARAMS.insert,
    },
    delete: {
      changes: true,
      idempotent: false,
      readback: "the paragraph count and the neighbours",
      usage: "index; track?",
      params: DOCUMENT_PARAMS.delete,
    },
    style: {
      changes: true,
      idempotent: true,
      readback: "the paragraph's style",
      usage: "index; style",
      params: DOCUMENT_PARAMS.style,
    },
    format: {
      changes: true,
      idempotent: true,
      readback: "the run properties of the paragraph",
      usage: "index; bold?; italic?; underline?; size? (pt); color? (RRGGBB); font?",
      params: DOCUMENT_PARAMS.format,
    },
    cell: {
      changes: true,
      idempotent: true,
      readback: "the cell text",
      usage: "table, row, col (from 0); text; track?",
      params: DOCUMENT_PARAMS.cell,
    },
    "add-row": {
      changes: true,
      idempotent: false,
      readback: "the last row of the table",
      usage: "table; values: [..]; track?",
      params: DOCUMENT_PARAMS["add-row"],
    },
    "insert-table": {
      changes: true,
      idempotent: false,
      readback: "the new table's cells",
      usage: "after (paragraph index); rows: [[..], [..]] (first row is the header)",
      params: DOCUMENT_PARAMS["insert-table"],
    },
    "accept-changes": {
      changes: true,
      idempotent: true,
      readback: "no tracked change left",
      usage: "",
      params: DOCUMENT_PARAMS["accept-changes"],
    },
    "reject-changes": {
      changes: true,
      idempotent: true,
      readback: "no tracked change left",
      usage: "",
      params: DOCUMENT_PARAMS["reject-changes"],
    },
  },
};

const SLIDES: HxSkillDeclaration = {
  name: "slides",
  reads: ["pptx", "pptm", "potx", "ppsx"],
  writes: ["pptx", "pptm", "potx", "ppsx"],
  appTypes: ["ppt", "dps", "key", "odp"],
  apps: {
    mac: ["Microsoft PowerPoint", "wpsoffice", "Keynote"],
    windows: ["PowerPoint.Application", "Kwpp.Application", "KWPP.Application"],
  },
  sends: false,
  actions: {
    read: { changes: false, idempotent: true, readback: "none", usage: "", params: SLIDES_PARAMS.read },
    add: {
      changes: true,
      idempotent: false,
      readback: "the slide count, the new slide's layout, title and body",
      usage: "layout? (name or type); title?; body? (lines); at? (slide number, default the end)",
      params: SLIDES_PARAMS.add,
    },
    delete: {
      changes: true,
      idempotent: false,
      readback: "the slide ids left",
      usage: "slide (from 1)",
      params: SLIDES_PARAMS.delete,
    },
    move: {
      changes: true,
      idempotent: false,
      readback: "the order of the slide ids",
      usage: "slide; to",
      params: SLIDES_PARAMS.move,
    },
    duplicate: {
      changes: true,
      idempotent: false,
      readback: "the copy's texts",
      usage: "slide",
      params: SLIDES_PARAMS.duplicate,
    },
    text: {
      changes: true,
      idempotent: true,
      readback: "the shape's text",
      usage: "slide; target: title|subtitle|body|shape name; text",
      params: SLIDES_PARAMS.text,
    },
    notes: {
      changes: true,
      idempotent: true,
      readback: "the notes text",
      usage: "slide; text",
      params: SLIDES_PARAMS.notes,
    },
    layout: {
      changes: true,
      idempotent: true,
      readback: "the slide's layout",
      usage: "slide; layout",
      params: SLIDES_PARAMS.layout,
    },
    "add-picture": {
      changes: true,
      idempotent: false,
      readback: "the picture count and its box",
      usage: "slide; picture (path of a PNG, JPEG or GIF); x?, y?, cx?, cy? (EMU, 914400 per inch)",
      params: SLIDES_PARAMS["add-picture"],
    },
    "replace-picture": {
      changes: true,
      idempotent: true,
      readback: "the picture's box",
      usage: "slide; index (picture, from 1); picture (path)",
      params: SLIDES_PARAMS["replace-picture"],
    },
  },
};

const PDF: HxSkillDeclaration = {
  name: "pdf",
  reads: ["pdf"],
  writes: ["pdf"],
  appTypes: [],
  apps: { mac: [], windows: [] },
  sends: false,
  actions: {
    read: {
      changes: false,
      idempotent: true,
      readback: "none",
      usage: "pages? (1-3,5); maxChars?",
      params: PDF_PARAMS.read,
    },
    fields: { changes: false, idempotent: true, readback: "none", usage: "", params: PDF_PARAMS.fields },
    fill: {
      changes: true,
      idempotent: true,
      readback: "every field's value read back from the saved file",
      usage: 'values: {"name": "text", "agree": true, "plan": "pro"}',
      params: PDF_PARAMS.fill,
    },
    extract: {
      changes: true,
      idempotent: true,
      readback: "the page count and each page's text",
      usage: "pages (1-3,5,8-); output is required",
      params: PDF_PARAMS.extract,
    },
    split: {
      changes: true,
      idempotent: true,
      readback: "each part's page count",
      usage: 'every? (pages per part) or ranges? (["1-3","4-"]); output is the folder for the parts',
      params: PDF_PARAMS.split,
    },
    merge: {
      changes: true,
      idempotent: true,
      readback: "the page count and the first page of each file",
      usage: "files in order; output is required; bookmarks? (one per file, default true)",
      params: PDF_PARAMS.merge,
    },
  },
};

const FILES: HxSkillDeclaration = {
  name: "files",
  reads: [],
  writes: ["zip"],
  appTypes: [],
  apps: { mac: ["Finder"], windows: ["explorer.exe"] },
  sends: false,
  actions: {
    find: {
      changes: false,
      idempotent: true,
      readback: "none",
      usage:
        "files: [folder]; name? (part of the name, or a pattern with * and ?); ext? ([pdf, xlsx]); modifiedAfter? (YYYY-MM-DD); depth? (default 6); limit? (default 200)",
      params: FILES_PARAMS.find,
    },
    move: {
      changes: true,
      idempotent: false,
      readback: "each file at its new place with the same hash, and gone from the old one",
      usage: "files; to (folder); onExists? refuse (default) | rename (adds (2))",
      params: FILES_PARAMS.move,
    },
    rename: {
      changes: true,
      idempotent: false,
      readback: "the file under its new name with the same hash",
      usage: "files: [one file]; name (new name, no folder)",
      params: FILES_PARAMS.rename,
    },
    zip: {
      changes: true,
      idempotent: true,
      readback: "the archive read back: every entry's size and CRC",
      usage: "files (files and folders); output (.zip, must not exist)",
      params: FILES_PARAMS.zip,
    },
    unzip: {
      changes: true,
      idempotent: true,
      readback: "every file written checked against its CRC",
      usage: "files: [one .zip]; output (folder; existing files are never overwritten)",
      params: FILES_PARAMS.unzip,
    },
  },
};

const SETTINGS: HxSkillDeclaration = {
  name: "settings",
  reads: [],
  writes: [],
  appTypes: [],
  apps: { mac: ["System Settings"], windows: ["Settings"] },
  sends: false,
  actions: {
    read: {
      changes: false,
      idempotent: true,
      readback: "none",
      usage: "query (a setting by name, such as 深色模式) or id",
      params: SETTINGS_PARAMS.read,
    },
    change: {
      changes: true,
      idempotent: true,
      app: true,
      readback: "the setting read again after the change",
      usage: "query or id; value — only verified settings change; a security page only opens",
      params: SETTINGS_PARAMS.change,
    },
    open: {
      changes: false,
      idempotent: true,
      app: true,
      readback: "none",
      usage: "query or id of a settings page, such as 隐私与安全性",
      params: SETTINGS_PARAMS.open,
    },
  },
};

export const HX_SKILLS: Readonly<Record<HxSkillName, HxSkillDeclaration>> = {
  sheet: SHEET,
  document: DOCUMENT,
  slides: SLIDES,
  pdf: PDF,
  files: FILES,
  settings: SETTINGS,
};

/** The lower-case extension of a path ("" when it has none). */
export function hxExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The actions of a skill with their params, for the answer to "help" or an unknown action. */
export function hxSkillHelp(skill: HxSkillName): { action: string; changes: boolean; params: string }[] {
  return Object.entries(HX_SKILLS[skill].actions).map(([action, spec]) => ({
    action,
    changes: spec.changes,
    params: spec.usage,
  }));
}
