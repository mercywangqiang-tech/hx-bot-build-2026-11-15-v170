// HXBot v1.7.4（CU-07 表格技能）：直接读写 .xlsx，不打开 Excel 或 WPS。
// 读：工作表、单元格（值、公式、日期按格式认出）。写：值、文字、日期、公式（常用公式当场算出缓存值，依赖它的公式一起重算；
// 算不了的不写缓存，让 Excel 打开时重算）、筛选、汇总表（按列分组求和、计数、平均、最大、最小，相当于静态的数据透视）、
// 图表（柱形、条形、折线、饼图，带缓存数据，不重算也能显示）。
// 和 Excel 一样守规矩：共享公式的主格要改时先把同组公式展开；数组公式和合并单元格中间不让写；表格（ListObject）
// 标题行改了同步改列名；改了公式就删掉 calcChain，并让 Excel 打开时全部重算。没碰到的部件一个字节都不变。
import {
  cellName,
  checkFormula,
  colName,
  colNumber,
  dateSerial,
  formulaOpaque,
  formulaRefs,
  type HxCellPos,
  HxEvaluator,
  HxFormulaError,
  type HxRange,
  type HxScalar,
  HxUnknown,
  isError,
  MAX_COL,
  MAX_ROW,
  numberText,
  parseCell,
  parseRange,
  rangeName,
  serialDate,
  serialParts,
  shiftFormula,
  tokenize,
} from "./formula";
import { CONTENT_TYPE, HxOfficeError, HxOoxml, NS, newXmlPart, REL } from "./ooxml";
import { escapeAttr, escapeText, type HxXmlElement, HxXmlText, xmlElement } from "./xml";

export interface HxSheetInfo {
  name: string;
  index: number;
  part: string;
  state: "visible" | "hidden" | "veryHidden";
}

export type HxCellInput = string | number | boolean | null | { formula: string } | { date: string };

export interface HxCellRead {
  ref: string;
  type: "number" | "string" | "bool" | "error" | "date" | "blank";
  value: HxScalar;
  /** The value as a person reads it: dates as YYYY-MM-DD, numbers to 15 digits. */
  text: string;
  /** Without the leading "=". */
  formula: string | null;
}

/** Functions that Excel stores with the _xlfn. prefix; written without it, Excel shows #NAME?. */
const FUTURE_FUNCTIONS = new Set([
  "CONCAT",
  "TEXTJOIN",
  "IFS",
  "IFNA",
  "SWITCH",
  "MAXIFS",
  "MINIFS",
  "XLOOKUP",
  "XMATCH",
  "FILTER",
  "SORT",
  "SORTBY",
  "UNIQUE",
  "SEQUENCE",
  "RANDARRAY",
  "LET",
  "LAMBDA",
  "DAYS",
  "ISOWEEKNUM",
  "STDEV.S",
  "STDEV.P",
  "VAR.S",
  "VAR.P",
  "PERCENTILE.INC",
  "PERCENTILE.EXC",
  "QUARTILE.INC",
  "QUARTILE.EXC",
  "RANK.EQ",
  "RANK.AVG",
  "MODE.SNGL",
  "CEILING.MATH",
  "FLOOR.MATH",
  "TEXTBEFORE",
  "TEXTAFTER",
  "TEXTSPLIT",
  "VSTACK",
  "HSTACK",
  "TOCOL",
  "TOROW",
  "CHOOSECOLS",
  "CHOOSEROWS",
  "TAKE",
  "DROP",
]);

/** The order of the children of a worksheet (ECMA-376, CT_Worksheet). */
const SHEET_ORDER = [
  "sheetPr",
  "dimension",
  "sheetViews",
  "sheetFormatPr",
  "cols",
  "sheetData",
  "sheetCalcPr",
  "sheetProtection",
  "protectedRanges",
  "scenarios",
  "autoFilter",
  "sortState",
  "dataConsolidate",
  "customSheetViews",
  "mergeCells",
  "phoneticPr",
  "conditionalFormatting",
  "dataValidations",
  "hyperlinks",
  "printOptions",
  "pageMargins",
  "pageSetup",
  "headerFooter",
  "rowBreaks",
  "colBreaks",
  "customProperties",
  "cellWatches",
  "ignoredErrors",
  "smartTags",
  "drawing",
  "legacyDrawing",
  "legacyDrawingHF",
  "drawingHF",
  "picture",
  "oleObjects",
  "controls",
  "webPublishItems",
  "tableParts",
  "extLst",
];

const WORKBOOK_ORDER = [
  "fileVersion",
  "fileSharing",
  "workbookPr",
  "workbookProtection",
  "bookViews",
  "sheets",
  "functionGroups",
  "externalReferences",
  "definedNames",
  "calcPr",
  "oleSize",
  "customWorkbookViews",
  "pivotCaches",
  "smartTagPr",
  "smartTagTypes",
  "webPublishing",
  "fileRecoveryPr",
  "webPublishObjects",
  "extLst",
];

/** Puts `element` among the children of `parent` where the schema wants it; replaces one of the same name. */
export function placeChild(parent: HxXmlElement, element: HxXmlElement, order: readonly string[]): void {
  const existing = parent.elements().find((child) => child.local === element.local && child.ns === parent.ns);
  if (existing) {
    parent.replaceChild(existing, element);
    return;
  }
  const rank = order.indexOf(element.local);
  const after = parent.elements().find((child) => {
    const childRank = order.indexOf(child.local);
    return childRank > rank;
  });
  parent.insertBefore(element, after ?? null);
}

const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56,
  57, 58,
]);

/** True when a number format code shows dates or times: d, m, y, h or s outside quotes, brackets and escapes. */
export function isDateFormat(code: string): boolean {
  const plain = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(?!h\]|m\]|s\]|hh\]|mm\]|ss\])[^\]]*\]/gi, "")
    .split(";")[0];
  return /[dmyhs]/i.test(plain ?? "") && !/^General$/i.test(plain ?? "");
}

interface CellSlot {
  row: HxXmlElement;
  cell: HxXmlElement;
}

/** One worksheet: its cells by position, built once when first used. */
class Sheet {
  readonly info: HxSheetInfo;
  readonly #book: HxWorkbook;
  #cells: Map<string, CellSlot> | null = null;
  #rows: Map<number, HxXmlElement> | null = null;
  #extent: HxCellPos = { row: 0, col: 0 };
  #normalized = false;

  constructor(book: HxWorkbook, info: HxSheetInfo) {
    this.#book = book;
    this.info = info;
  }

  get root(): HxXmlElement {
    return this.#book.pkg.xml(this.info.part).root;
  }

  get data(): HxXmlElement {
    const data = this.root.child(NS.sheet, "sheetData");
    if (data) return data;
    const created = xmlElement(this.root.qname(NS.sheet, "sheetData", "x"));
    placeChild(this.root, created, SHEET_ORDER);
    return created;
  }

  #index(): void {
    if (this.#cells && this.#rows) return;
    const cells = new Map<string, CellSlot>();
    const rows = new Map<number, HxXmlElement>();
    let rowNumber = 0;
    let maxRow = 0;
    let maxCol = 0;
    for (const row of this.data.childrenNamed(NS.sheet, "row")) {
      const r = Number(row.attr("r"));
      rowNumber = Number.isInteger(r) && r > 0 ? r : rowNumber + 1;
      rows.set(rowNumber, row);
      let colNumber_ = 0;
      for (const cell of row.childrenNamed(NS.sheet, "c")) {
        const pos = parseCell(cell.attr("r") ?? "");
        colNumber_ = pos ? pos.col : colNumber_ + 1;
        const ref = cellName({ row: rowNumber, col: colNumber_ });
        cells.set(ref, { row, cell });
        if (rowNumber > maxRow) maxRow = rowNumber;
        if (colNumber_ > maxCol) maxCol = colNumber_;
      }
    }
    this.#cells = cells;
    this.#rows = rows;
    this.#extent = { row: maxRow, col: maxCol };
  }

  extent(): HxCellPos {
    this.#index();
    return this.#extent;
  }

  /** The used range: from A1 to the last cell with content. */
  used(): HxRange | null {
    const extent = this.extent();
    return extent.row === 0 ? null : { start: { row: 1, col: 1 }, end: extent };
  }

  slot(ref: string): CellSlot | null {
    this.#index();
    return this.#cells?.get(ref) ?? null;
  }

  slots(): Map<string, CellSlot> {
    this.#index();
    return this.#cells ?? new Map();
  }

  /** Before the first change: every row and cell gets its r attribute, so that inserting keeps positions. */
  #normalize(): void {
    if (this.#normalized) return;
    this.#normalized = true;
    this.#index();
    for (const [number, row] of this.#rows ?? [])
      if (row.attr("r") !== String(number)) row.setAttr("r", String(number));
    for (const [ref, slot] of this.#cells ?? []) if (slot.cell.attr("r") !== ref) slot.cell.setAttr("r", ref);
  }

  /** The cell element at `pos`, made with its row when missing, in order. */
  ensure(pos: HxCellPos): CellSlot {
    this.#normalize();
    const ref = cellName(pos);
    const found = this.#cells?.get(ref);
    if (found) return found;
    let row = this.#rows?.get(pos.row);
    if (!row) {
      row = xmlElement(this.data.qname(NS.sheet, "row", "x"), { r: String(pos.row) });
      const after = [...(this.#rows ?? new Map<number, HxXmlElement>()).entries()]
        .filter(([number]) => number > pos.row)
        .sort((a, b) => a[0] - b[0])[0]?.[1];
      this.data.insertBefore(row, after ?? null);
      this.#rows?.set(pos.row, row);
      // A new row in a sheet whose rows state their spans: Excel accepts the row without one.
    }
    const cell = xmlElement(row.qname(NS.sheet, "c", "x"), { r: ref });
    const next = row
      .childrenNamed(NS.sheet, "c")
      .find((other) => (parseCell(other.attr("r") ?? "")?.col ?? 0) > pos.col);
    row.insertBefore(cell, next ?? null);
    const slot = { row, cell };
    this.#cells?.set(ref, slot);
    if (pos.row > this.#extent.row) this.#extent = { ...this.#extent, row: pos.row };
    if (pos.col > this.#extent.col) this.#extent = { ...this.#extent, col: pos.col };
    return slot;
  }

  /** Updates <dimension> to the used range. */
  updateDimension(): void {
    const used = this.used();
    const ref = used ? rangeName(used) : "A1";
    const existing = this.root.child(NS.sheet, "dimension");
    if (existing) existing.setAttr("ref", ref);
    else placeChild(this.root, xmlElement(this.root.qname(NS.sheet, "dimension", "x"), { ref }), SHEET_ORDER);
  }

  mergedRanges(): HxRange[] {
    const merged = this.root.child(NS.sheet, "mergeCells");
    if (!merged) return [];
    return merged
      .childrenNamed(NS.sheet, "mergeCell")
      .map((element) => parseRange(element.attr("ref") ?? ""))
      .filter((range): range is HxRange => range !== null);
  }
}

function inRange(pos: HxCellPos, range: HxRange): boolean {
  return (
    pos.row >= range.start.row && pos.row <= range.end.row && pos.col >= range.start.col && pos.col <= range.end.col
  );
}

export interface HxWriteResult {
  /** Cells written, with what they hold now. */
  written: HxCellRead[];
  /** Formula cells elsewhere whose cached value was computed again. */
  recalculated: HxCellRead[];
  /** Formula cells whose result HXBot could not compute: Excel computes them when it opens the file. */
  uncached: string[];
}

export interface HxFilterColumn {
  /** A column letter, or the text of the header cell. */
  column: string;
  /** Rows whose cell is one of these texts stay visible. */
  equals?: string[];
  /** A comparison with a number or a text; "contains" keeps cells that contain the value. */
  op?: "gt" | "ge" | "lt" | "le" | "ne" | "eq" | "contains";
  value?: string | number;
}

export type HxSummaryFunction = "sum" | "count" | "average" | "min" | "max";
/** What Chinese Excel and WPS call the value fields of a PivotTable. */
const SUMMARY_ZH: Readonly<Record<HxSummaryFunction, string>> = {
  sum: "求和项",
  count: "计数项",
  average: "平均值项",
  min: "最小值项",
  max: "最大值项",
};

/** A workbook read from its bytes. */
export class HxWorkbook {
  readonly pkg: HxOoxml;
  readonly #sheets = new Map<string, Sheet>();
  readonly #workbookPart: string;
  #shared: { texts: string[]; index: Map<string, number>; part: string | null } | null = null;
  #formulasChanged = false;

  private constructor(pkg: HxOoxml) {
    this.pkg = pkg;
    this.#workbookPart = pkg.mainPart();
    if (pkg.xml(this.#workbookPart).root.local !== "workbook")
      throw new HxOfficeError("not-office", "The file is not an Excel workbook.");
  }

  static read(bytes: Uint8Array): HxWorkbook {
    return new HxWorkbook(HxOoxml.read(bytes));
  }

  get #workbook(): HxXmlElement {
    return this.pkg.xml(this.#workbookPart).root;
  }

  get date1904(): boolean {
    const pr = this.#workbook.child(NS.sheet, "workbookPr");
    const value = pr?.attr("date1904");
    return value === "1" || value === "true";
  }

  sheets(): HxSheetInfo[] {
    const list = this.#workbook.child(NS.sheet, "sheets")?.childrenNamed(NS.sheet, "sheet") ?? [];
    const found: HxSheetInfo[] = [];
    for (const [index, element] of list.entries()) {
      const id = element.attrNs(NS.r, "id");
      const rel = id ? this.pkg.relById(this.#workbookPart, id) : null;
      if (!rel || rel.type !== REL.worksheet) continue;
      const state = element.attr("state");
      found.push({
        name: element.attr("name") ?? `Sheet${index + 1}`,
        index,
        part: rel.target,
        state: state === "hidden" || state === "veryHidden" ? state : "visible",
      });
    }
    return found;
  }

  #sheet(name: string): Sheet {
    const cached = this.#sheets.get(name);
    if (cached) return cached;
    const info =
      this.sheets().find((item) => item.name === name) ??
      this.sheets().find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!info) throw new HxOfficeError("invalid", `The workbook has no sheet named ${name}.`);
    const sheet = new Sheet(this, info);
    this.#sheets.set(info.name, sheet);
    this.#sheets.set(name, sheet);
    return sheet;
  }

  /** The name of a sheet as the workbook writes it (name matching ignores case), or the first sheet for null. */
  sheetName(name: string | null | undefined): string {
    if (!name) {
      const first = this.sheets()[0];
      if (!first) throw new HxOfficeError("damaged", "The workbook has no sheets.");
      return first.name;
    }
    return this.#sheet(name).info.name;
  }

  // ------------------------------------------------------------ shared strings and styles

  #sharedStrings(): { texts: string[]; index: Map<string, number>; part: string | null } {
    if (this.#shared) return this.#shared;
    const rel = this.pkg.rels(this.#workbookPart).find((item) => item.type === REL.sharedStrings);
    const texts: string[] = [];
    const index = new Map<string, number>();
    if (rel && this.pkg.has(rel.target)) {
      for (const si of this.pkg.xml(rel.target).root.childrenNamed(NS.sheet, "si")) {
        const text = sharedText(si);
        if (!index.has(text) && si.childrenNamed(NS.sheet, "r").length === 0) index.set(text, texts.length);
        texts.push(text);
      }
    }
    this.#shared = { texts, index, part: rel?.target ?? null };
    return this.#shared;
  }

  #stringIndex(text: string): number {
    const shared = this.#sharedStrings();
    const known = shared.index.get(text);
    if (known !== undefined) return known;
    let part = shared.part;
    if (!part) {
      part = "xl/sharedStrings.xml";
      this.pkg.setPart(
        part,
        newXmlPart(`<sst xmlns="${NS.sheet}" count="0" uniqueCount="0"/>`),
        CONTENT_TYPE.sharedStrings,
      );
      this.pkg.addRel(this.#workbookPart, REL.sharedStrings, part);
      shared.part = part;
    }
    const root = this.pkg.xml(part).root;
    const t = xmlElement(root.qname(NS.sheet, "t", "x"), /^\s|\s$|\n/.test(text) ? { "xml:space": "preserve" } : {}, [
      text,
    ]);
    root.append(xmlElement(root.qname(NS.sheet, "si", "x"), {}, [t]));
    const number = shared.texts.length;
    shared.texts.push(text);
    shared.index.set(text, number);
    root.setAttr("uniqueCount", String(shared.texts.length));
    return number;
  }

  /** Counts the string cells again for the count attribute, as Excel keeps it. */
  #refreshStringCount(): void {
    const shared = this.#shared;
    if (!shared?.part) return;
    let count = 0;
    for (const info of this.sheets()) {
      if (!this.#sheets.has(info.name)) continue;
      for (const { cell } of this.#sheet(info.name).slots().values()) if (cell.attr("t") === "s") count += 1;
    }
    const root = this.pkg.xml(shared.part).root;
    const stated = Number(root.attr("count"));
    if (!Number.isFinite(stated) || stated < count) root.setAttr("count", String(count));
  }

  #stylesRoot(): HxXmlElement | null {
    const rel = this.pkg.rels(this.#workbookPart).find((item) => item.type === REL.styles);
    return rel && this.pkg.has(rel.target) ? this.pkg.xml(rel.target).root : null;
  }

  #isDateStyle(style: number): boolean {
    const root = this.#stylesRoot();
    const xf = root?.child(NS.sheet, "cellXfs")?.childrenNamed(NS.sheet, "xf")[style];
    const id = Number(xf?.attr("numFmtId") ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id)) return true;
    const custom = root
      ?.child(NS.sheet, "numFmts")
      ?.childrenNamed(NS.sheet, "numFmt")
      .find((element) => Number(element.attr("numFmtId")) === id);
    return custom ? isDateFormat(custom.attr("formatCode") ?? "") : false;
  }

  readonly #dateStyles = new Map<number, number>();

  /** A cell style like `style` that shows a date (yyyy-mm-dd, format 14), added to the styles when needed. */
  #dateStyle(style: number): number {
    if (this.#isDateStyle(style)) return style;
    const known = this.#dateStyles.get(style);
    if (known !== undefined) return known;
    const root = this.#stylesRoot();
    const xfs = root?.child(NS.sheet, "cellXfs");
    if (!root || !xfs) return style;
    const list = xfs.childrenNamed(NS.sheet, "xf");
    const base = list[style] ?? list[0];
    const attrs: Record<string, string> = {};
    for (const attr of base?.attrs ?? []) attrs[attr.name] = attr.value;
    attrs.numFmtId = "14";
    attrs.applyNumberFormat = "1";
    const xf = xmlElement(base?.name ?? xfs.qname(NS.sheet, "xf", "x"), attrs);
    for (const child of base?.elements() ?? []) xf.append(cloneElement(child));
    xfs.append(xf);
    xfs.setAttr("count", String(list.length + 1));
    this.#dateStyles.set(style, list.length);
    return list.length;
  }

  // ------------------------------------------------------------ reading

  #readSlot(sheet: Sheet, ref: string): HxCellRead {
    const slot = sheet.slot(ref);
    if (!slot) return { ref, type: "blank", value: null, text: "", formula: null };
    return this.#readCell(sheet, ref, slot.cell);
  }

  #readCell(sheet: Sheet, ref: string, cell: HxXmlElement): HxCellRead {
    const type = cell.attr("t") ?? "n";
    const style = Number(cell.attr("s") ?? 0);
    const formula = this.#formulaOf(sheet, ref, cell);
    const v = cell.child(NS.sheet, "v")?.text() ?? null;
    if (type === "s") {
      const text = this.#sharedStrings().texts[Number(v)] ?? "";
      return { ref, type: "string", value: text, text, formula };
    }
    if (type === "inlineStr") {
      const is = cell.child(NS.sheet, "is");
      const text = is ? sharedText(is) : "";
      return { ref, type: "string", value: text, text, formula };
    }
    if (type === "str") {
      const text = v ?? "";
      return { ref, type: "string", value: text, text, formula };
    }
    if (type === "b") {
      if (v === null) return { ref, type: "blank", value: null, text: "", formula };
      const value = v === "1" || v === "true";
      return { ref, type: "bool", value, text: value ? "TRUE" : "FALSE", formula };
    }
    if (type === "e") return { ref, type: "error", value: { error: v ?? "#VALUE!" }, text: v ?? "#VALUE!", formula };
    if (type === "d")
      return { ref, type: "date", value: v ?? "", text: (v ?? "").replace(/T00:00:00(\.000)?Z?$/, ""), formula };
    if (v === null || v === "") return { ref, type: "blank", value: null, text: "", formula };
    const number = Number(v);
    if (!Number.isFinite(number)) return { ref, type: "string", value: v, text: v, formula };
    if (this.#isDateStyle(style))
      return { ref, type: "date", value: number, text: dateText(number, this.date1904), formula };
    return { ref, type: "number", value: number, text: numberText(number), formula };
  }

  /** The formula of a cell; a cell in a shared formula gets the master's formula moved to it. */
  #formulaOf(sheet: Sheet, ref: string, cell: HxXmlElement): string | null {
    const f = cell.child(NS.sheet, "f");
    if (!f) return null;
    const text = f.text();
    if (f.attr("t") === "shared" && text === "") {
      const master = this.#sharedMaster(sheet, f.attr("si") ?? "");
      const pos = parseCell(ref);
      if (!master || !pos) return null;
      try {
        return shiftFormula(master.formula, pos.row - master.pos.row, pos.col - master.pos.col);
      } catch {
        return null;
      }
    }
    return text === "" ? null : text;
  }

  readonly #masters = new Map<string, Map<string, { formula: string; pos: HxCellPos; ref: string }>>();

  #sharedMaster(sheet: Sheet, si: string): { formula: string; pos: HxCellPos; ref: string } | null {
    let masters = this.#masters.get(sheet.info.part);
    if (!masters) {
      masters = new Map();
      for (const [ref, { cell }] of sheet.slots()) {
        const f = cell.child(NS.sheet, "f");
        if (f?.attr("t") !== "shared" || f.text() === "") continue;
        const pos = parseCell(ref);
        if (pos) masters.set(f.attr("si") ?? "", { formula: f.text(), pos, ref });
      }
      this.#masters.set(sheet.info.part, masters);
    }
    return masters.get(si) ?? null;
  }

  /** The cells of a range (the used range by default), row by row, up to `limit` cells. */
  read(
    sheetName: string | null,
    range?: string,
    limit = 5000,
  ): { sheet: string; range: string; rows: HxCellRead[][]; truncated: boolean } {
    const sheet = this.#sheet(this.sheetName(sheetName));
    const target = range ? parseRange(range) : sheet.used();
    if (range && !target) throw new HxOfficeError("invalid", `Not a range: ${range}`);
    if (!target) return { sheet: sheet.info.name, range: "", rows: [], truncated: false };
    const extent = sheet.extent();
    const end = {
      row: Math.min(target.end.row, Math.max(extent.row, target.start.row)),
      col: Math.min(target.end.col, Math.max(extent.col, target.start.col)),
    };
    const rows: HxCellRead[][] = [];
    let count = 0;
    let truncated = false;
    for (let row = target.start.row; row <= end.row && !truncated; row += 1) {
      const line: HxCellRead[] = [];
      for (let col = target.start.col; col <= end.col; col += 1) {
        if (count >= limit) {
          truncated = true;
          break;
        }
        line.push(this.#readSlot(sheet, cellName({ row, col })));
        count += 1;
      }
      rows.push(line);
    }
    return { sheet: sheet.info.name, range: rangeName({ start: target.start, end }), rows, truncated };
  }

  cell(sheetName: string | null, ref: string): HxCellRead {
    const pos = parseCell(ref);
    if (!pos) throw new HxOfficeError("invalid", `Not a cell: ${ref}`);
    return this.#readSlot(this.#sheet(this.sheetName(sheetName)), cellName(pos));
  }

  /** Every non-empty cell of a sheet, for the diff. */
  allCells(sheetName: string): Map<string, HxCellRead> {
    const sheet = this.#sheet(sheetName);
    const out = new Map<string, HxCellRead>();
    for (const [ref, { cell }] of sheet.slots()) {
      const read = this.#readCell(sheet, ref, cell);
      if (read.type !== "blank" || read.formula) out.set(ref, read);
    }
    return out;
  }

  // ------------------------------------------------------------ writing

  /**
   * Writes cells. Each input is a value (text, number, true/false, null to clear), `{ date: "2026-11-19" }`
   * or `{ formula: "=SUM(B2:B4)" }`. Formulas are computed where HXBot can; the cells that depend on the
   * changed ones are computed again too.
   */
  set(sheetName: string | null, updates: readonly { ref: string; input: HxCellInput }[]): HxWriteResult {
    const sheet = this.#sheet(this.sheetName(sheetName));
    const positions = updates.map((update) => {
      const pos = parseCell(update.ref);
      if (!pos) throw new HxOfficeError("invalid", `Not a cell: ${update.ref}`);
      return { pos, ref: cellName(pos), input: update.input };
    });
    this.#checkWritable(
      sheet,
      positions.map((item) => item.pos),
    );
    // Every input is checked before the first cell changes: a bad one leaves the workbook as it was.
    for (const { pos, input } of positions) {
      this.#checkInput(input);
      this.#syncTableHeader(sheet, pos, input, true);
    }
    const changed: { sheet: string; pos: HxCellPos }[] = [];
    for (const { pos, ref, input } of positions) {
      this.#expandSharedAt(sheet, ref);
      const { cell } = sheet.ensure(pos);
      const hadFormula = cell.child(NS.sheet, "f") !== null;
      this.#writeInput(cell, input);
      if (hadFormula || (typeof input === "object" && input !== null && "formula" in input))
        this.#formulasChanged = true;
      changed.push({ sheet: sheet.info.name, pos });
      this.#syncTableHeader(sheet, pos, input, false);
    }
    sheet.updateDimension();
    const result = this.#recalculate(changed);
    this.#refreshStringCount();
    // A formula left without a value (Excel computes it on opening) also needs the full calculation.
    if (this.#formulasChanged || result.uncached.length > 0) this.#forceRecalculation();
    return {
      written: positions.map(({ ref }) => this.#readSlot(sheet, ref)),
      recalculated: result.recalculated,
      uncached: result.uncached,
    };
  }

  #checkWritable(sheet: Sheet, positions: readonly HxCellPos[]): void {
    for (const range of sheet.mergedRanges()) {
      for (const pos of positions) {
        if (inRange(pos, range) && (pos.row !== range.start.row || pos.col !== range.start.col)) {
          throw new HxOfficeError(
            "invalid",
            `${cellName(pos)} is inside the merged cells ${rangeName(range)}; only ${cellName(range.start)} holds their value.`,
          );
        }
      }
    }
    for (const { cell } of sheet.slots().values()) {
      const f = cell.child(NS.sheet, "f");
      if (f?.attr("t") !== "array") continue;
      const range = parseRange(f.attr("ref") ?? "");
      if (!range || (range.start.row === range.end.row && range.start.col === range.end.col)) continue;
      for (const pos of positions) {
        if (inRange(pos, range)) {
          throw new HxOfficeError(
            "invalid",
            `${cellName(pos)} is part of the array formula in ${rangeName(range)}, which Excel changes only as a whole.`,
          );
        }
      }
    }
  }

  /** When the master of a shared formula changes, its other cells get their own formulas first. */
  #expandSharedAt(sheet: Sheet, ref: string): void {
    const f = sheet.slot(ref)?.cell.child(NS.sheet, "f");
    if (f?.attr("t") !== "shared" || f.text() === "") return;
    const si = f.attr("si") ?? "";
    const master = this.#sharedMaster(sheet, si);
    if (!master) return;
    for (const [other, { cell }] of sheet.slots()) {
      const g = cell.child(NS.sheet, "f");
      if (g?.attr("t") !== "shared" || g.attr("si") !== si) continue;
      const pos = parseCell(other);
      if (!pos) continue;
      const formula = shiftFormula(master.formula, pos.row - master.pos.row, pos.col - master.pos.col);
      const plain = xmlElement(g.name, {}, [formula]);
      cell.replaceChild(g, plain);
    }
    this.#masters.delete(sheet.info.part);
  }

  /** Throws the error that writing `input` would throw, without writing anything. */
  #checkInput(input: HxCellInput): void {
    if (input === null || typeof input === "boolean") return;
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new HxOfficeError("invalid", "A cell cannot hold an infinite number.");
      return;
    }
    if (typeof input === "string") {
      if (input.length > 32_767) throw new HxOfficeError("invalid", "A cell holds at most 32,767 characters.");
      return;
    }
    if ("date" in input) {
      if (parseDate(input.date, this.date1904) === null)
        throw new HxOfficeError("invalid", `Not a date: ${input.date}. Use YYYY-MM-DD or YYYY-MM-DDTHH:MM.`);
      return;
    }
    normalizeFormula(input.formula);
  }

  #writeInput(cell: HxXmlElement, input: HxCellInput): void {
    const style = cell.attr("s");
    // Keep the cell element and its style; drop its content and type.
    cell.setChildren([]);
    cell.removeAttr("t");
    cell.removeAttr("cm");
    cell.removeAttr("vm");
    const v = (text: string) => xmlElement(cell.qname(NS.sheet, "v", "x"), {}, [text]);
    if (input === null || input === "") return;
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new HxOfficeError("invalid", "A cell cannot hold an infinite number.");
      cell.append(v(String(input)));
      return;
    }
    if (typeof input === "boolean") {
      cell.setAttr("t", "b");
      cell.append(v(input ? "1" : "0"));
      return;
    }
    if (typeof input === "string") {
      if (input.length > 32_767) throw new HxOfficeError("invalid", "A cell holds at most 32,767 characters.");
      cell.setAttr("t", "s");
      cell.append(v(String(this.#stringIndex(input))));
      return;
    }
    if ("date" in input) {
      const serial = parseDate(input.date, this.date1904);
      if (serial === null)
        throw new HxOfficeError("invalid", `Not a date: ${input.date}. Use YYYY-MM-DD or YYYY-MM-DDTHH:MM.`);
      cell.setAttr("s", String(this.#dateStyle(Number(style ?? 0))));
      cell.append(v(String(serial)));
      return;
    }
    const formula = normalizeFormula(input.formula);
    cell.append(xmlElement(cell.qname(NS.sheet, "f", "x"), {}, [formula]));
  }

  /** A changed header of a table (ListObject) renames its column, as Excel does; Excel repairs the file otherwise. */
  #syncTableHeader(sheet: Sheet, pos: HxCellPos, input: HxCellInput, checkOnly: boolean): void {
    for (const rel of this.pkg.rels(sheet.info.part)) {
      if (rel.type !== REL.table || !this.pkg.has(rel.target)) continue;
      const table = this.pkg.xml(rel.target).root;
      const range = parseRange(table.attr("ref") ?? "");
      if (!range || pos.row !== range.start.row || pos.col < range.start.col || pos.col > range.end.col) continue;
      if ((table.attr("headerRowCount") ?? "1") === "0") continue;
      const columns = table.child(NS.sheet, "tableColumns")?.childrenNamed(NS.sheet, "tableColumn") ?? [];
      const column = columns[pos.col - range.start.col];
      if (!column) continue;
      const name = input === null ? "" : typeof input === "object" ? "" : String(input);
      if (name === "")
        throw new HxOfficeError(
          "invalid",
          `${cellName(pos)} is a header of the table ${table.attr("displayName") ?? ""}; it cannot be empty or a formula.`,
        );
      if (columns.some((other) => other !== column && other.attr("name")?.toLowerCase() === name.toLowerCase())) {
        throw new HxOfficeError(
          "invalid",
          `The table ${table.attr("displayName") ?? ""} already has a column named ${name}.`,
        );
      }
      if (!checkOnly) column.setAttr("name", name);
    }
  }

  /** calcChain lists the formula cells; once they change it is stale, and Excel rebuilds it. Recalculate on open. */
  #forceRecalculation(): void {
    const chain = this.pkg.rels(this.#workbookPart).find((rel) => rel.type === REL.calcChain);
    if (chain) {
      this.pkg.removeRel(this.#workbookPart, chain.id);
      this.pkg.removePart(chain.target);
    }
    const workbook = this.#workbook;
    const calc = workbook.child(NS.sheet, "calcPr");
    if (calc) calc.setAttr("fullCalcOnLoad", "1");
    else
      placeChild(
        workbook,
        xmlElement(workbook.qname(NS.sheet, "calcPr", "x"), { fullCalcOnLoad: "1" }),
        WORKBOOK_ORDER,
      );
  }

  /**
   * Computes the formulas that the change reaches, and writes their cached values. A formula that HXBot
   * cannot compute loses its cached value instead, so that nothing shows a stale result.
   */
  #recalculate(changed: readonly { sheet: string; pos: HxCellPos }[]): {
    recalculated: HxCellRead[];
    uncached: string[];
  } {
    interface Entry {
      sheet: Sheet;
      key: string;
      ref: string;
      pos: HxCellPos;
      formula: string;
      /** The ranges it reads; null for "anything" (a name, a table column, an external link). */
      reads: { sheet: string; range: HxRange }[] | null;
      /** An array formula (entered with Ctrl+Shift+Enter, or a dynamic array): Excel computes it, not HXBot. */
      array: boolean;
    }
    const formulas: Entry[] = [];
    for (const info of this.sheets()) {
      const sheet = this.#sheet(info.name);
      for (const [ref, { cell }] of sheet.slots()) {
        if (!cell.child(NS.sheet, "f")) continue;
        const formula = this.#formulaOf(sheet, ref, cell);
        const pos = parseCell(ref);
        if (!formula || !pos) continue;
        let reads: Entry["reads"] = [];
        if (formulaOpaque(formula)) reads = null;
        else {
          for (const item of formulaRefs(formula)) {
            const range = parseRange(item.body);
            if (range) reads.push({ sheet: (item.sheet ?? info.name).toLowerCase(), range });
          }
        }
        const array = cell.child(NS.sheet, "f")?.attr("t") === "array";
        formulas.push({ sheet, key: `${info.name}!${ref}`, ref, pos, formula, reads, array });
      }
    }
    // The formulas the change reaches: those that read a changed cell, then those that read one of them, and so on.
    const dirty = new Set(changed.map((item) => `${item.sheet}!${cellName(item.pos)}`));
    let frontier = changed.map((item) => ({ sheet: item.sheet.toLowerCase(), pos: item.pos }));
    let reachedCount = frontier.length;
    let everything = false;
    while (frontier.length > 0) {
      const next: { sheet: string; pos: HxCellPos }[] = [];
      for (const entry of formulas) {
        if (dirty.has(entry.key)) continue;
        const reaches =
          entry.reads === null ||
          entry.reads.some((read) =>
            frontier.some((cell) => cell.sheet === read.sheet && inRange(cell.pos, read.range)),
          );
        if (!reaches) continue;
        dirty.add(entry.key);
        next.push({ sheet: entry.sheet.info.name.toLowerCase(), pos: entry.pos });
      }
      reachedCount += next.length;
      frontier = next;
      if (reachedCount > 20_000) {
        everything = true;
        break;
      }
    }
    if (everything) for (const entry of formulas) dirty.add(entry.key);
    const byKey = new Map(formulas.map((entry) => [entry.key, entry]));
    const memo = new Map<string, HxScalar | HxUnknown>();
    const visiting = new Set<string>();
    let budget = 400_000;
    const evaluate = (key: string): HxScalar => {
      const known = memo.get(key);
      if (known instanceof HxUnknown) throw known;
      if (known !== undefined) return known;
      const entry = byKey.get(key);
      if (!entry) throw new HxUnknown("no formula");
      if (visiting.has(key)) throw new HxUnknown("a circular reference");
      if (entry.array) {
        const unknown = new HxUnknown("an array formula");
        memo.set(key, unknown);
        throw unknown;
      }
      budget -= 1;
      if (budget < 0) throw new HxUnknown("too many formulas to compute here");
      visiting.add(key);
      try {
        const value = new HxEvaluator(context(entry.sheet.info.name)).evaluate(entry.formula);
        memo.set(key, value);
        return value;
      } catch (error) {
        const unknown = error instanceof HxUnknown ? error : new HxUnknown("failed");
        memo.set(key, unknown);
        throw unknown;
      } finally {
        visiting.delete(key);
      }
    };
    const context = (sheetName: string) => ({
      sheet: sheetName,
      date1904: this.date1904,
      hasSheet: (name: string) => this.sheets().some((info) => info.name.toLowerCase() === name.toLowerCase()),
      extent: (name: string) => this.#sheet(name).extent(),
      cell: (name: string, pos: HxCellPos): HxScalar => {
        const sheet = this.#sheet(name);
        const key = `${sheet.info.name}!${cellName(pos)}`;
        const slot = sheet.slot(cellName(pos));
        if (!slot) return null;
        const hasFormula = byKey.has(key);
        // A formula that changed, or one without a cached value, is computed; the others give their cached value.
        if (hasFormula && (dirty.has(key) || slot.cell.child(NS.sheet, "v") === null)) return evaluate(key);
        const read = this.#readCell(sheet, cellName(pos), slot.cell);
        return read.value;
      },
    });
    const recalculated: HxCellRead[] = [];
    const uncached: string[] = [];
    const changedKeys = new Set(changed.map((item) => `${item.sheet}!${cellName(item.pos)}`));
    for (const key of dirty) {
      const entry = byKey.get(key);
      const cell = entry?.sheet.slot(entry.ref)?.cell;
      if (!entry || !cell) continue;
      let value: HxScalar = null;
      let known = true;
      try {
        value = evaluate(key);
      } catch {
        known = false;
      }
      writeCached(cell, known ? value : undefined);
      if (!known) uncached.push(key);
      else if (!changedKeys.has(key)) recalculated.push(this.#readCell(entry.sheet, entry.ref, cell));
    }
    return { recalculated, uncached };
  }

  // ------------------------------------------------------------ filters

  /** Sets an AutoFilter on `range` (with its header row) and hides the rows that the criteria leave out. */
  filter(
    sheetName: string | null,
    range: string,
    columns: readonly HxFilterColumn[],
  ): { visible: number; hidden: number } {
    const sheet = this.#sheet(this.sheetName(sheetName));
    const target = parseRange(range);
    if (!target || target.end.row <= target.start.row)
      throw new HxOfficeError("invalid", "The filter range needs a header row and data rows.");
    const root = sheet.root;
    const filter = xmlElement(root.qname(NS.sheet, "autoFilter", "x"), { ref: rangeName(target) });
    const tests: { col: number; test: (read: HxCellRead) => boolean }[] = [];
    for (const column of columns) {
      const col = this.#filterColumn(sheet, target, column.column);
      const filterColumn = xmlElement(root.qname(NS.sheet, "filterColumn", "x"), {
        colId: String(col - target.start.col),
      });
      if (column.equals && column.equals.length > 0) {
        const values = column.equals;
        const filters = xmlElement(root.qname(NS.sheet, "filters", "x"));
        for (const value of values) filters.append(xmlElement(root.qname(NS.sheet, "filter", "x"), { val: value }));
        filterColumn.append(filters);
        const wanted = new Set(values.map((value) => value.toLowerCase()));
        tests.push({ col, test: (read) => wanted.has(read.text.toLowerCase()) });
      } else if (column.op && column.value !== undefined) {
        const operator = {
          gt: "greaterThan",
          ge: "greaterThanOrEqual",
          lt: "lessThan",
          le: "lessThanOrEqual",
          ne: "notEqual",
          eq: "equal",
          contains: "equal",
        }[column.op];
        const val = column.op === "contains" ? `*${String(column.value)}*` : String(column.value);
        const custom = xmlElement(root.qname(NS.sheet, "customFilters", "x"));
        custom.append(
          xmlElement(root.qname(NS.sheet, "customFilter", "x"), operator === "equal" ? { val } : { operator, val }),
        );
        filterColumn.append(custom);
        tests.push({ col, test: filterTest(column.op, column.value) });
      } else {
        throw new HxOfficeError("invalid", "Each filter column needs equals, or op and value.");
      }
      filter.append(filterColumn);
    }
    placeChild(root, filter, SHEET_ORDER);
    let visible = 0;
    let hidden = 0;
    for (let row = target.start.row + 1; row <= target.end.row; row += 1) {
      const keep = tests.every(({ col, test }) => test(this.#readSlot(sheet, cellName({ row, col }))));
      const element = sheet.ensure({ row, col: target.start.col }).row;
      if (keep) {
        element.removeAttr("hidden");
        visible += 1;
      } else {
        element.setAttr("hidden", "1");
        hidden += 1;
      }
    }
    this.#filterName(sheet, target);
    return { visible, hidden };
  }

  /** Takes the filter away and shows the rows it hid. */
  clearFilter(sheetName: string | null): number {
    const sheet = this.#sheet(this.sheetName(sheetName));
    const filter = sheet.root.child(NS.sheet, "autoFilter");
    if (!filter) return 0;
    const target = parseRange(filter.attr("ref") ?? "");
    sheet.root.remove(filter);
    let shown = 0;
    if (target) {
      for (const [, { row }] of sheet.slots()) {
        const number = Number(row.attr("r"));
        if (number > target.start.row && number <= target.end.row && row.attr("hidden")) {
          row.removeAttr("hidden");
          shown += 1;
        }
      }
    }
    return shown;
  }

  #filterColumn(sheet: Sheet, range: HxRange, column: string): number {
    if (/^[A-Za-z]{1,3}$/.test(column)) {
      const col = colNumber(column);
      if (col >= range.start.col && col <= range.end.col) return col;
    }
    for (let col = range.start.col; col <= range.end.col; col += 1) {
      if (
        this.#readSlot(sheet, cellName({ row: range.start.row, col }))
          .text.trim()
          .toLowerCase() === column.trim().toLowerCase()
      )
        return col;
    }
    throw new HxOfficeError("invalid", `The filter range has no column ${column}.`);
  }

  #filterName(sheet: Sheet, range: HxRange): void {
    const workbook = this.#workbook;
    let names = workbook.child(NS.sheet, "definedNames");
    if (!names) {
      names = xmlElement(workbook.qname(NS.sheet, "definedNames", "x"));
      placeChild(workbook, names, WORKBOOK_ORDER);
    }
    const value = `${quoteSheet(sheet.info.name)}!$${colName(range.start.col)}$${range.start.row}:$${colName(range.end.col)}$${range.end.row}`;
    const existing = names
      .childrenNamed(NS.sheet, "definedName")
      .find(
        (element) =>
          element.attr("name") === "_xlnm._FilterDatabase" && element.attr("localSheetId") === String(sheet.info.index),
      );
    if (existing) existing.setText(value);
    else {
      names.append(
        xmlElement(
          names.qname(NS.sheet, "definedName", "x"),
          { name: "_xlnm._FilterDatabase", localSheetId: String(sheet.info.index), hidden: "1" },
          [value],
        ),
      );
    }
  }

  // ------------------------------------------------------------ new sheets, summaries, charts

  /** Adds a sheet at the end; a name in use gets " (2)" and so on. */
  addSheet(name: string): string {
    const clean =
      name
        .replace(/[\\/?*[\]:]/g, " ")
        .trim()
        .slice(0, 31) || "Sheet";
    const names = new Set(this.sheets().map((info) => info.name.toLowerCase()));
    let final = clean;
    for (let number = 2; names.has(final.toLowerCase()); number += 1) final = `${clean.slice(0, 26)} (${number})`;
    const part = this.pkg.freeName("xl/worksheets/sheet", ".xml");
    this.pkg.setPart(
      part,
      newXmlPart(`<worksheet xmlns="${NS.sheet}" xmlns:r="${NS.r}"><dimension ref="A1"/><sheetData/></worksheet>`),
      CONTENT_TYPE.worksheet,
    );
    const id = this.pkg.addRel(this.#workbookPart, REL.worksheet, part);
    const sheets = this.#workbook.child(NS.sheet, "sheets");
    if (!sheets) throw new HxOfficeError("damaged", "The workbook has no list of sheets.");
    const ids = sheets.childrenNamed(NS.sheet, "sheet").map((element) => Number(element.attr("sheetId") ?? 0));
    let rPrefix = sheets.lookupPrefix(NS.r);
    if (rPrefix === null) {
      this.#workbook.setAttr("xmlns:r", NS.r);
      rPrefix = "r";
    }
    sheets.append(
      xmlElement(sheets.qname(NS.sheet, "sheet", "x"), {
        name: final,
        sheetId: String(Math.max(0, ...ids) + 1),
        [`${rPrefix}:id`]: id,
      }),
    );
    return final;
  }

  /**
   * A summary table on a new sheet, like a PivotTable but with plain values: rows grouped by the `rows`
   * columns, one column for each value. Returns the new sheet and its range.
   */
  summarize(
    sheetName: string | null,
    range: string,
    rows: readonly string[],
    values: readonly { column: string; fn: HxSummaryFunction; label?: string }[],
    options: { target?: string; totalLabel?: string } = {},
  ): { sheet: string; range: string; groups: number } {
    const source = this.#sheet(this.sheetName(sheetName));
    const target = parseRange(range);
    if (!target || target.end.row <= target.start.row)
      throw new HxOfficeError("invalid", "The summary range needs a header row and data rows.");
    if (rows.length === 0 || values.length === 0)
      throw new HxOfficeError("invalid", "Give at least one row column and one value column.");
    const rowCols = rows.map((column) => this.#filterColumn(source, target, column));
    const valueCols = values.map((value) => this.#filterColumn(source, target, value.column));
    const groups = new Map<
      string,
      { keys: HxScalar[]; acc: { sum: number; count: number; min: number; max: number; n: number }[] }
    >();
    for (let row = target.start.row + 1; row <= target.end.row; row += 1) {
      const keys = rowCols.map((col) => {
        const read = this.#readSlot(source, cellName({ row, col }));
        return read.type === "date" ? read.text : read.value;
      });
      if (keys.every((key) => key === null || key === "")) continue;
      const id = JSON.stringify(keys.map((key) => (isError(key ?? 0) ? "#" : key)));
      let group = groups.get(id);
      if (!group) {
        group = {
          keys,
          acc: values.map(() => ({
            sum: 0,
            count: 0,
            min: Number.POSITIVE_INFINITY,
            max: Number.NEGATIVE_INFINITY,
            n: 0,
          })),
        };
        groups.set(id, group);
      }
      for (const [index, col] of valueCols.entries()) {
        const read = this.#readSlot(source, cellName({ row, col }));
        const acc = group.acc[index];
        if (!acc) continue;
        if (read.type !== "blank") acc.count += 1;
        if (typeof read.value === "number") {
          acc.sum += read.value;
          acc.n += 1;
          acc.min = Math.min(acc.min, read.value);
          acc.max = Math.max(acc.max, read.value);
        }
      }
    }
    // Summing a column of text gives 0 in Excel, which reads as a real result: say so instead.
    for (const [index, value] of values.entries()) {
      if (value.fn === "count") continue;
      const numbers = [...groups.values()].reduce((total, group) => total + (group.acc[index]?.n ?? 0), 0);
      if (numbers === 0)
        throw new HxOfficeError(
          "invalid",
          `The column ${value.column} has no numbers to ${value.fn}; use count for text.`,
        );
    }
    const result = (
      acc: { sum: number; count: number; min: number; max: number; n: number },
      fn: HxSummaryFunction,
    ): HxCellInput => {
      if (fn === "sum") return acc.sum;
      if (fn === "count") return acc.count;
      if (fn === "average") return acc.n ? acc.sum / acc.n : null;
      if (fn === "min") return acc.n ? acc.min : null;
      return acc.n ? acc.max : null;
    };
    const ordered = [...groups.values()].sort((a, b) => {
      for (let index = 0; index < a.keys.length; index += 1) {
        const x = a.keys[index] ?? null;
        const y = b.keys[index] ?? null;
        const c =
          typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "zh");
        if (c !== 0) return c;
      }
      return 0;
    });
    const rowTitles = rows.map(
      (column, index) =>
        this.#readSlot(source, cellName({ row: target.start.row, col: rowCols[index] ?? 1 })).text || column,
    );
    // The new sheet and its titles follow the language of the data: a Chinese table gets the names that
    // Chinese Excel and WPS give a PivotTable (“求和项:金额”), not English ones.
    const chinese = [source.info.name, ...rowTitles, ...values.map((value) => value.column)].some((text) =>
      /[\u3400-\u9fff]/u.test(text),
    );
    const name = this.addSheet(options.target ?? `${source.info.name} ${chinese ? "汇总" : "summary"}`);
    const header: HxCellInput[] = [
      ...rowTitles,
      ...values.map(
        (value) =>
          value.label ??
          (chinese ? `${SUMMARY_ZH[value.fn]}:${value.column}` : `${value.fn.toUpperCase()}(${value.column})`),
      ),
    ];
    const updates: { ref: string; input: HxCellInput }[] = [];
    header.forEach((input, index) => {
      updates.push({ ref: cellName({ row: 1, col: index + 1 }), input });
    });
    ordered.forEach((group, rowIndex) => {
      group.keys.forEach((key, index) => {
        const input: HxCellInput = key === null || typeof key === "object" ? null : key;
        updates.push({ ref: cellName({ row: rowIndex + 2, col: index + 1 }), input });
      });
      values.forEach((value, index) => {
        const acc = group.acc[index];
        if (acc)
          updates.push({
            ref: cellName({ row: rowIndex + 2, col: rows.length + index + 1 }),
            input: result(acc, value.fn),
          });
      });
    });
    const totalRow = ordered.length + 2;
    updates.push({ ref: cellName({ row: totalRow, col: 1 }), input: options.totalLabel ?? "Total" });
    values.forEach((value, index) => {
      const col = colName(rows.length + index + 1);
      const fn = { sum: "SUM", count: "SUM", average: "AVERAGE", min: "MIN", max: "MAX" }[value.fn];
      // The total of the source rows, not of the group results: an average of averages would be wrong.
      const src = colName(valueCols[index] ?? 1);
      const sourceRange = `${quoteSheet(source.info.name)}!${src}${target.start.row + 1}:${src}${target.end.row}`;
      const formula =
        value.fn === "count"
          ? `COUNTA(${sourceRange})`
          : ordered.length === 0
            ? "0"
            : value.fn === "sum"
              ? `SUM(${col}2:${col}${totalRow - 1})`
              : `${fn}(${sourceRange})`;
      updates.push({ ref: cellName({ row: totalRow, col: rows.length + index + 1 }), input: { formula } });
    });
    this.set(name, updates);
    return { sheet: name, range: `A1:${colName(rows.length + values.length)}${totalRow}`, groups: ordered.length };
  }

  /**
   * A chart on a sheet, with its data cached so that it shows without recalculation. Categories and each
   * series are ranges of one row or one column; `anchor` is the range of cells it covers.
   */
  addChart(
    sheetName: string | null,
    spec: {
      type: "column" | "bar" | "line" | "pie";
      title?: string;
      categories: string;
      series: readonly { name?: string; values: string }[];
      anchor?: string;
    },
  ): { chart: string; anchor: string } {
    const sheet = this.#sheet(this.sheetName(sheetName));
    if (spec.series.length === 0 || spec.series.length > 32)
      throw new HxOfficeError("invalid", "A chart needs 1 to 32 series.");
    if (spec.type === "pie" && spec.series.length > 1)
      throw new HxOfficeError("invalid", "A pie chart has one series.");
    const catRange = this.#lineRange(sheet, spec.categories);
    const categories = this.#lineValues(sheet, catRange).map((read) => read.text);
    const series = spec.series.map((item) => {
      const range = this.#lineRange(sheet, item.values);
      const values = this.#lineValues(sheet, range).map((read) => (typeof read.value === "number" ? read.value : null));
      if (values.length !== categories.length)
        throw new HxOfficeError("invalid", "Each series needs as many cells as the categories.");
      return { name: item.name ?? "", range, values };
    });
    const anchor = parseRange(spec.anchor ?? "") ?? {
      start: { row: 1, col: (sheet.extent().col || 1) + 2 },
      end: { row: 16, col: (sheet.extent().col || 1) + 9 },
    };
    // The drawing of the sheet, made when the sheet has none.
    const sheetRoot = sheet.root;
    let drawingPart: string;
    const drawingElement = sheetRoot.child(NS.sheet, "drawing");
    const existingId = drawingElement?.attrNs(NS.r, "id");
    const existing = existingId ? this.pkg.relById(sheet.info.part, existingId) : null;
    if (existing && this.pkg.has(existing.target)) {
      drawingPart = existing.target;
    } else {
      drawingPart = this.pkg.freeName("xl/drawings/drawing", ".xml");
      this.pkg.setPart(
        drawingPart,
        newXmlPart(`<xdr:wsDr xmlns:xdr="${NS.sheetDrawing}" xmlns:a="${NS.drawing}"/>`),
        CONTENT_TYPE.drawing,
      );
      const id = this.pkg.addRel(sheet.info.part, REL.drawing, drawingPart);
      let prefix = sheetRoot.lookupPrefix(NS.r);
      if (prefix === null) {
        sheetRoot.setAttr("xmlns:r", NS.r);
        prefix = "r";
      }
      placeChild(
        sheetRoot,
        xmlElement(sheetRoot.qname(NS.sheet, "drawing", "x"), { [`${prefix}:id`]: id }),
        SHEET_ORDER,
      );
    }
    const chartPart = this.pkg.freeName("xl/charts/chart", ".xml");
    const ref = (range: HxRange) =>
      `${quoteSheet(sheet.info.name)}!$${colName(range.start.col)}$${range.start.row}:$${colName(range.end.col)}$${range.end.row}`;
    this.pkg.setPart(
      chartPart,
      newXmlPart(
        chartXml(
          spec.type,
          spec.title ?? "",
          ref(catRange),
          categories,
          series.map((item) => ({ name: item.name, ref: ref(item.range), values: item.values })),
        ),
      ),
      CONTENT_TYPE.chart,
    );
    const chartId = this.pkg.addRel(drawingPart, REL.chart, chartPart);
    const drawing = this.pkg.xml(drawingPart).root;
    const ids = drawing.descendants(NS.sheetDrawing, "cNvPr").map((element) => Number(element.attr("id") ?? 0));
    const shapeId = Math.max(1, ...ids) + 1;
    const anchorXml = `<xdr:twoCellAnchor xmlns:xdr="${NS.sheetDrawing}" xmlns:a="${NS.drawing}" xmlns:c="${NS.chart}" xmlns:r="${NS.r}"><xdr:from><xdr:col>${anchor.start.col - 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.start.row - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${anchor.end.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.end.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${shapeId}" name="${escapeAttr(spec.title || `Chart ${shapeId}`)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS.chart}"><c:chart r:id="${chartId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
    const anchorElement = newXmlPart(anchorXml).root;
    drawing.append(anchorElement);
    // Declarations the drawing already makes need not repeat on the anchor.
    anchorElement.tidyNamespaces();
    return { chart: chartPart, anchor: rangeName(anchor) };
  }

  #lineRange(sheet: Sheet, text: string): HxRange {
    const bang = text.lastIndexOf("!");
    const local = bang >= 0 ? text.slice(bang + 1) : text;
    if (bang >= 0) {
      const named = text.slice(0, bang).replace(/^'|'$/g, "").replaceAll("''", "'");
      if (named.toLowerCase() !== sheet.info.name.toLowerCase())
        throw new HxOfficeError("invalid", "Chart data must be on the chart's own sheet.");
    }
    const range = parseRange(local.replaceAll("$", ""));
    if (!range || (range.start.row !== range.end.row && range.start.col !== range.end.col)) {
      throw new HxOfficeError("invalid", `Chart data must be one row or one column: ${text}`);
    }
    if (range.end.row === MAX_ROW || range.end.col === MAX_COL)
      throw new HxOfficeError("invalid", "Give the chart data as cells, not whole columns.");
    return range;
  }

  #lineValues(sheet: Sheet, range: HxRange): HxCellRead[] {
    const out: HxCellRead[] = [];
    for (let row = range.start.row; row <= range.end.row; row += 1) {
      for (let col = range.start.col; col <= range.end.col; col += 1)
        out.push(this.#readSlot(sheet, cellName({ row, col })));
    }
    if (out.length > 4000) throw new HxOfficeError("invalid", "A chart series has at most 4,000 points here.");
    return out;
  }

  toBytes(): Uint8Array {
    return this.pkg.toBytes();
  }
}

function writeCached(cell: HxXmlElement, value: HxScalar | undefined): void {
  const v = cell.child(NS.sheet, "v");
  if (v) cell.remove(v);
  cell.removeAttr("t");
  if (value === undefined || value === null) return;
  const make = (text: string) => xmlElement(cell.qname(NS.sheet, "v", "x"), {}, [text]);
  if (typeof value === "number") {
    cell.append(make(String(value)));
  } else if (typeof value === "boolean") {
    cell.setAttr("t", "b");
    cell.append(make(value ? "1" : "0"));
  } else if (typeof value === "string") {
    // A formula's text result is stored in the cell, as type str, not in the shared strings.
    cell.setAttr("t", "str");
    cell.append(make(value));
  } else {
    cell.setAttr("t", "e");
    cell.append(make(value.error));
  }
}

/** The text of a shared string item or an inline string: its runs together, without phonetic runs. */
function sharedText(si: HxXmlElement): string {
  const parts: string[] = [];
  for (const child of si.elements()) {
    if (child.local === "t") parts.push(child.text());
    else if (child.local === "r") for (const t of child.childrenNamed(NS.sheet, "t")) parts.push(t.text());
  }
  return parts
    .join("")
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_all, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function cloneElement(element: HxXmlElement): HxXmlElement {
  const copy = xmlElement(element.name, Object.fromEntries(element.attrs.map((attr) => [attr.name, attr.value])));
  for (const child of element.children) {
    if (child.kind === "element") copy.append(cloneElement(child));
    else if (child.kind === "text") copy.append(new HxXmlText(child.value));
  }
  return copy;
}

/** Strips the "=" and adds _xlfn. where Excel needs it; throws for a formula that does not parse. */
export function normalizeFormula(input: string): string {
  const formula = input.trim().replace(/^=/, "").trim();
  if (formula === "") throw new HxOfficeError("invalid", "The formula is empty.");
  if (formula.length > 8192) throw new HxOfficeError("invalid", "A formula has at most 8,192 characters.");
  try {
    checkFormula(formula);
  } catch (error) {
    throw new HxOfficeError(
      "invalid",
      `The formula does not parse: ${error instanceof HxFormulaError ? error.message : formula}`,
    );
  }
  // Excel keeps function names, cell references, TRUE/FALSE and error codes in capitals in the file; a
  // lowercase "sum(" may read as an unknown name. Functions newer than Excel 2007 carry the _xlfn. prefix.
  return tokenize(formula)
    .map((token) => {
      if (token.kind === "func") {
        const bare = token.name.toUpperCase().replace(/^_XLFN\./, "");
        return `${FUTURE_FUNCTIONS.has(bare) || /^_xlfn\./i.test(token.name) ? "_xlfn." : ""}${bare}`;
      }
      if (token.kind === "ref" && token.text.endsWith(token.body))
        return token.text.slice(0, token.text.length - token.body.length) + token.body.toUpperCase();
      if (token.kind === "bool" || token.kind === "error") return token.text.toUpperCase();
      return token.text;
    })
    .join("");
}

function quoteSheet(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name) && !/^[A-Za-z]{1,3}[0-9]+$/.test(name)
    ? name
    : `'${name.replaceAll("'", "''")}'`;
}

function dateText(serial: number, date1904: boolean): string {
  const date = serialDate(serial, date1904);
  const parts = serialParts(serial, date1904);
  // Serial 60 is Excel's 29 February 1900 and 0 its 0 January 1900: no real date shows them.
  const day = `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const fraction = serial - Math.floor(serial);
  if (fraction === 0) return day;
  return `${day} ${date.toISOString().slice(11, 19)}`;
}

/** "2026-11-19", "2026/11/19" or "2026-11-19T08:30" as a serial number, or null. */
export function parseDate(text: string, date1904 = false): number | null {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  // 29 February 1900 is a date in Excel (serial 60) though not in the calendar.
  const excelLeapDay = !date1904 && year === 1900 && month === 2 && day === 29;
  if (check.getUTCMonth() !== month - 1 && !excelLeapDay) return null;
  const serial = dateSerial(year, month, day, date1904);
  const hours = Number(match[4] ?? 0);
  const minutes = Number(match[5] ?? 0);
  const seconds = Number(match[6] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return serial + (hours * 3600 + minutes * 60 + seconds) / 86_400;
}

function filterTest(op: NonNullable<HxFilterColumn["op"]>, value: string | number): (read: HxCellRead) => boolean {
  return (read) => {
    if (op === "contains") return read.text.toLowerCase().includes(String(value).toLowerCase());
    const number = typeof value === "number" ? value : Number(value);
    const cellNumber = typeof read.value === "number" ? read.value : null;
    const numeric = Number.isFinite(number) && cellNumber !== null;
    const c =
      cellNumber !== null && numeric
        ? Math.sign(cellNumber - number)
        : read.text.toLowerCase().localeCompare(String(value).toLowerCase());
    if (!numeric && op !== "eq" && op !== "ne" && Number.isFinite(number)) return false;
    return op === "gt"
      ? c > 0
      : op === "ge"
        ? c >= 0
        : op === "lt"
          ? c < 0
          : op === "le"
            ? c <= 0
            : op === "ne"
              ? c !== 0
              : c === 0;
  };
}

function chartXml(
  type: "column" | "bar" | "line" | "pie",
  title: string,
  catRef: string,
  categories: readonly string[],
  series: readonly { name: string; ref: string; values: readonly (number | null)[] }[],
): string {
  const strCache = (items: readonly string[]) =>
    `<c:strCache><c:ptCount val="${items.length}"/>${items.map((item, index) => `<c:pt idx="${index}"><c:v>${escapeText(item)}</c:v></c:pt>`).join("")}</c:strCache>`;
  const numCache = (items: readonly (number | null)[]) =>
    `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${items.length}"/>${items
      .map((item, index) => (item === null ? "" : `<c:pt idx="${index}"><c:v>${item}</c:v></c:pt>`))
      .join("")}</c:numCache>`;
  const ser = series
    .map(
      (item, index) =>
        `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${item.name ? `<c:tx><c:v>${escapeText(item.name)}</c:v></c:tx>` : ""}${
          type === "line" ? '<c:marker><c:symbol val="circle"/></c:marker>' : ""
        }<c:cat><c:strRef><c:f>${escapeText(catRef)}</c:f>${strCache(categories)}</c:strRef></c:cat><c:val><c:numRef><c:f>${escapeText(item.ref)}</c:f>${numCache(item.values)}</c:numRef></c:val>${
          type === "line" ? '<c:smooth val="0"/>' : ""
        }</c:ser>`,
    )
    .join("");
  const titleXml = title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapeText(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>';
  const axes =
    '<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>' +
    '<c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>';
  const ids = '<c:axId val="500000001"/><c:axId val="500000002"/>';
  const plot =
    type === "pie"
      ? `<c:pieChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/></c:pieChart>`
      : type === "line"
        ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/>${ids}</c:lineChart>${axes}`
        : `<c:barChart><c:barDir val="${type === "bar" ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}<c:gapWidth val="150"/>${ids}</c:barChart>${axes}`;
  return `<c:chartSpace xmlns:c="${NS.chart}" xmlns:a="${NS.drawing}" xmlns:r="${NS.r}"><c:roundedCorners val="0"/><c:chart>${titleXml}<c:plotArea><c:layout/>${plot}</c:plotArea><c:legend><c:legendPos val="${type === "pie" ? "r" : "b"}"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}
