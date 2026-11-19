// HXBot v1.7.4（CU-07 表格）：Excel 公式。
// 一是拆成记号，能把公式里的相对引用整体挪位（Excel 的“共享公式”只在第一格写公式，别的格要按位置挪出来）；
// 二是算出常用公式的结果，写进文件的缓存值：这样“预览”、Quick Look 和手机上不重新计算的程序也能看到结果，
// 读回核对时也能对上数。算不了的（易变函数、外部引用、没实现的函数、循环引用）就不写缓存值，并让 Excel 打开时重算。

const HX_ERRORS = [
  "#NULL!",
  "#DIV/0!",
  "#VALUE!",
  "#REF!",
  "#NAME?",
  "#NUM!",
  "#N/A",
  "#GETTING_DATA",
  "#SPILL!",
  "#CALC!",
] as const;

export interface HxCellPos {
  row: number;
  col: number;
}

export const MAX_ROW = 1_048_576;
export const MAX_COL = 16_384;

export function colName(col: number): string {
  let name = "";
  let rest = col;
  while (rest > 0) {
    const mod = (rest - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    rest = Math.floor((rest - 1) / 26);
  }
  return name;
}

export function colNumber(name: string): number {
  let col = 0;
  for (const char of name.toUpperCase()) col = col * 26 + (char.charCodeAt(0) - 64);
  return col;
}

/** "B12" (or "$B$12") as a position, or null. */
export function parseCell(ref: string): HxCellPos | null {
  const match = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,7})$/.exec(ref.trim());
  if (!match?.[1] || !match[2]) return null;
  const col = colNumber(match[1]);
  const row = Number(match[2]);
  if (col < 1 || col > MAX_COL || row < 1 || row > MAX_ROW) return null;
  return { row, col };
}

export function cellName(pos: HxCellPos): string {
  return `${colName(pos.col)}${pos.row}`;
}

export interface HxRange {
  start: HxCellPos;
  end: HxCellPos;
}

/** "A1:C3", "A1", "A:C" or "2:5" as a range with its corners in order, or null. */
export function parseRange(text: string): HxRange | null {
  const [left, right, extra] = text.trim().split(":");
  if (left === undefined || extra !== undefined) return null;
  if (right === undefined) {
    const cell = parseCell(left);
    return cell ? { start: cell, end: cell } : null;
  }
  const a = parseCell(left);
  const b = parseCell(right);
  if (a && b) return order(a, b);
  const colA = /^\$?([A-Za-z]{1,3})$/.exec(left);
  const colB = /^\$?([A-Za-z]{1,3})$/.exec(right);
  if (colA?.[1] && colB?.[1]) {
    const c1 = colNumber(colA[1]);
    const c2 = colNumber(colB[1]);
    if (c1 > MAX_COL || c2 > MAX_COL) return null;
    return order({ row: 1, col: c1 }, { row: MAX_ROW, col: c2 });
  }
  const rowA = /^\$?([0-9]{1,7})$/.exec(left);
  const rowB = /^\$?([0-9]{1,7})$/.exec(right);
  if (rowA?.[1] && rowB?.[1]) {
    const r1 = Number(rowA[1]);
    const r2 = Number(rowB[1]);
    if (r1 < 1 || r2 < 1 || r1 > MAX_ROW || r2 > MAX_ROW) return null;
    return order({ row: r1, col: 1 }, { row: r2, col: MAX_COL });
  }
  return null;
}

function order(a: HxCellPos, b: HxCellPos): HxRange {
  return {
    start: { row: Math.min(a.row, b.row), col: Math.min(a.col, b.col) },
    end: { row: Math.max(a.row, b.row), col: Math.max(a.col, b.col) },
  };
}

export function rangeName(range: HxRange): string {
  const a = cellName(range.start);
  const b = cellName(range.end);
  return a === b ? a : `${a}:${b}`;
}

// ---------------------------------------------------------------- tokens

export type HxToken =
  | { kind: "number"; text: string; value: number }
  | { kind: "string"; text: string; value: string }
  | { kind: "bool"; text: string; value: boolean }
  | { kind: "error"; text: string }
  | { kind: "ref"; text: string; sheet: string | null; body: string; external: boolean }
  | { kind: "func"; text: string; name: string }
  | { kind: "name"; text: string }
  | { kind: "op"; text: string }
  | { kind: "open" | "close" | "comma" | "space" | "array" | "other"; text: string };

const SHEET_CHARS = /^[\p{L}\p{N}_.]+/u;
const CELL_RE = /^\$?[A-Za-z]{1,3}\$?[0-9]{1,7}/;
const COLS_RE = /^\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}(?![A-Za-z0-9_(])/;
const ROWS_RE = /^\$?[0-9]{1,7}:\$?[0-9]{1,7}(?![0-9A-Za-z_.(])/;

/** The reference body at the start of `text` (A1, A1:B2, A:C, 1:3, #REF!), or null. */
function refBody(text: string): string | null {
  if (text.startsWith("#REF!")) return "#REF!";
  const cols = COLS_RE.exec(text);
  if (cols) return cols[0];
  const rows = ROWS_RE.exec(text);
  if (rows) return rows[0];
  const cell = CELL_RE.exec(text);
  if (!cell) return null;
  let body = cell[0];
  const rest = text.slice(body.length);
  if (rest.startsWith(":")) {
    const second = CELL_RE.exec(rest.slice(1));
    if (second) body += `:${second[0]}`;
  }
  // A cell-like name followed by "(" or more letters is a function or a name, such as LOG10( or A1B.
  const after = text[body.length] ?? "";
  if (/[A-Za-z0-9_.(\\?]/.test(after)) return null;
  const pos = parseCell(cell[0]);
  return pos ? body : null;
}

/** Splits a formula (without its leading =) into tokens; the texts joined give the formula back. */
export function tokenize(formula: string): HxToken[] {
  const tokens: HxToken[] = [];
  let at = 0;
  while (at < formula.length) {
    const rest = formula.slice(at);
    const char = formula[at] ?? "";
    if (/\s/.test(char)) {
      const match = /^\s+/.exec(rest)?.[0] ?? char;
      tokens.push({ kind: "space", text: match });
      at += match.length;
      continue;
    }
    if (char === '"') {
      let end = at + 1;
      let value = "";
      for (;;) {
        if (end >= formula.length) throw new HxFormulaError("A text in the formula has no closing quote.");
        if (formula[end] === '"') {
          if (formula[end + 1] === '"') {
            value += '"';
            end += 2;
            continue;
          }
          break;
        }
        value += formula[end];
        end += 1;
      }
      tokens.push({ kind: "string", text: formula.slice(at, end + 1), value });
      at = end + 1;
      continue;
    }
    if (char === "{") {
      let end = at + 1;
      let quoted = false;
      while (end < formula.length && (quoted || formula[end] !== "}")) {
        if (formula[end] === '"') quoted = !quoted;
        end += 1;
      }
      if (end >= formula.length) throw new HxFormulaError("An array in the formula has no closing brace.");
      tokens.push({ kind: "array", text: formula.slice(at, end + 1) });
      at = end + 1;
      continue;
    }
    if (char === "#") {
      const error = HX_ERRORS.find((item) => rest.toUpperCase().startsWith(item));
      if (!error) throw new HxFormulaError("An unknown error value in the formula.");
      tokens.push({ kind: "error", text: rest.slice(0, error.length) });
      at += error.length;
      continue;
    }
    // A sheet-qualified reference: 'My sheet'!A1, Sheet1!A1:B2, [1]Sheet1!A1.
    const qualified = /^(\[[^\]]*\])?('(?:[^']|'')+'|[\p{L}\p{N}_.]+(?::[\p{L}\p{N}_.]+)?)!/u.exec(rest);
    if (qualified && !/^[0-9.]/.test(rest)) {
      const after = rest.slice(qualified[0].length);
      const body = refBody(after);
      if (body) {
        const rawSheet = qualified[2] ?? "";
        const sheet = rawSheet.startsWith("'") ? rawSheet.slice(1, -1).replaceAll("''", "'") : rawSheet;
        tokens.push({
          kind: "ref",
          text: qualified[0] + body,
          sheet,
          body,
          external: Boolean(qualified[1]) || (!rawSheet.startsWith("'") && rawSheet.includes(":")),
        });
        at += qualified[0].length + body.length;
        continue;
      }
    }
    const rows = ROWS_RE.exec(rest);
    if (rows && /^[$0-9]/.test(rest)) {
      tokens.push({ kind: "ref", text: rows[0], sheet: null, body: rows[0], external: false });
      at += rows[0].length;
      continue;
    }
    const number = /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(rest);
    if (number) {
      tokens.push({ kind: "number", text: number[0], value: Number(number[0]) });
      at += number[0].length;
      continue;
    }
    if (/[A-Za-z$_\\]/.test(char) || SHEET_CHARS.test(char)) {
      const body = refBody(rest);
      if (body) {
        tokens.push({ kind: "ref", text: body, sheet: null, body, external: false });
        at += body.length;
        continue;
      }
      const word = /^[\p{L}_\\][\p{L}\p{N}_.?\\]*/u.exec(rest)?.[0];
      if (word) {
        const next = formula[at + word.length];
        if (next === "(") {
          tokens.push({ kind: "func", text: word, name: word.toUpperCase().replace(/^_XLFN\.|^_XLWS\./, "") });
        } else if (next === "[") {
          // A structured reference such as Table1[Amount]: kept as written, not computed.
          let depth = 0;
          let end = at + word.length;
          for (; end < formula.length; end += 1) {
            if (formula[end] === "[") depth += 1;
            if (formula[end] === "]") depth -= 1;
            if (depth === 0) break;
          }
          tokens.push({ kind: "other", text: formula.slice(at, end + 1) });
          at = end + 1;
          continue;
        } else if (/^(TRUE|FALSE)$/i.test(word)) {
          tokens.push({ kind: "bool", text: word, value: word.toUpperCase() === "TRUE" });
        } else {
          tokens.push({ kind: "name", text: word });
        }
        at += word.length;
        continue;
      }
    }
    const op = /^(<=|>=|<>|[-+*/^&=<>%])/.exec(rest)?.[0];
    if (op) {
      tokens.push({ kind: "op", text: op });
      at += op.length;
      continue;
    }
    if (char === "(") tokens.push({ kind: "open", text: char });
    else if (char === ")") tokens.push({ kind: "close", text: char });
    else if (char === "," || char === ";") tokens.push({ kind: "comma", text: char });
    else tokens.push({ kind: "other", text: char });
    at += 1;
  }
  return tokens;
}

export class HxFormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HxFormulaError";
  }
}

function shiftPart(part: string, rows: number, cols: number): string | null {
  const cell = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})$/.exec(part);
  if (cell) {
    const col = cell[1] ? colNumber(cell[2] ?? "") : colNumber(cell[2] ?? "") + cols;
    const row = cell[3] ? Number(cell[4]) : Number(cell[4]) + rows;
    if (col < 1 || col > MAX_COL || row < 1 || row > MAX_ROW) return null;
    return `${cell[1]}${colName(col)}${cell[3]}${row}`;
  }
  const column = /^(\$?)([A-Za-z]{1,3})$/.exec(part);
  if (column) {
    const col = column[1] ? colNumber(column[2] ?? "") : colNumber(column[2] ?? "") + cols;
    if (col < 1 || col > MAX_COL) return null;
    return `${column[1]}${colName(col)}`;
  }
  const row = /^(\$?)([0-9]{1,7})$/.exec(part);
  if (row) {
    const value = row[1] ? Number(row[2]) : Number(row[2]) + rows;
    if (value < 1 || value > MAX_ROW) return null;
    return `${row[1]}${value}`;
  }
  return part;
}

/** The formula moved by `rows` and `cols`, as when Excel copies it: relative references move, $ ones stay. */
export function shiftFormula(formula: string, rows: number, cols: number): string {
  return tokenize(formula)
    .map((token) => {
      if (token.kind !== "ref" || token.external || token.body === "#REF!") return token.text;
      const prefix = token.text.slice(0, token.text.length - token.body.length);
      const parts = token.body.split(":").map((part) => shiftPart(part, rows, cols));
      if (parts.some((part) => part === null)) return `${prefix}#REF!`;
      return prefix + parts.join(":");
    })
    .join("");
}

/** True when a formula reads through something HXBot does not follow: a defined name, a table column, an array. */
export function formulaOpaque(formula: string): boolean {
  try {
    return tokenize(formula).some(
      (token) => token.kind === "name" || token.kind === "other" || (token.kind === "ref" && token.external),
    );
  } catch {
    return true;
  }
}

/** The sheet names and ranges that a formula reads, for the readback and the diff. */
export function formulaRefs(formula: string): { sheet: string | null; body: string; external: boolean }[] {
  return tokenize(formula).flatMap((token) =>
    token.kind === "ref" ? [{ sheet: token.sheet, body: token.body, external: token.external }] : [],
  );
}

// ---------------------------------------------------------------- values

export interface HxError {
  error: string;
}

export type HxScalar = number | string | boolean | HxError | null;

export interface HxMatrix {
  rows: HxScalar[][];
}

export type HxValue = HxScalar | HxMatrix;

export function isError(value: HxValue | readonly number[]): value is HxError {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "error" in value;
}

function isMatrix(value: HxValue): value is HxMatrix {
  return typeof value === "object" && value !== null && "rows" in value;
}

const err = (code: (typeof HX_ERRORS)[number]): HxError => ({ error: code });

/** Something the evaluator cannot compute: the formula keeps no cached value. */
export class HxUnknown extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "HxUnknown";
  }
}

export interface HxFormulaContext {
  /** The sheet that the formula stands on. */
  sheet: string;
  /** The value of a cell; throws HxUnknown when it cannot be known. */
  cell(sheet: string, pos: HxCellPos): HxScalar;
  /** The last used row and column of a sheet, to bound whole-column references. */
  extent(sheet: string): HxCellPos;
  /** Whether a sheet exists. */
  hasSheet(sheet: string): boolean;
  /** True for the 1904 date system. */
  date1904: boolean;
}

// ---------------------------------------------------------------- parser

type Node =
  | { type: "value"; value: HxScalar }
  | { type: "ref"; sheet: string | null; body: string; external: boolean }
  | { type: "unary"; op: string; arg: Node }
  | { type: "percent"; arg: Node }
  | { type: "binary"; op: string; left: Node; right: Node }
  | { type: "call"; name: string; args: (Node | null)[] }
  | { type: "unknown"; reason: string };

class Parser {
  readonly #tokens: HxToken[];
  #at = 0;

  constructor(tokens: HxToken[]) {
    // A space between two references is Excel's intersection operator (A1:B2 B1:C3); other spaces are layout.
    const kept: HxToken[] = [];
    for (const [index, token] of tokens.entries()) {
      if (token.kind !== "space") {
        kept.push(token);
        continue;
      }
      const before = kept.at(-1);
      const after = tokens.slice(index + 1).find((item) => item.kind !== "space");
      const ends = before && (before.kind === "ref" || before.kind === "name" || before.kind === "close");
      const starts =
        after && (after.kind === "ref" || after.kind === "name" || after.kind === "open" || after.kind === "func");
      if (ends && starts && kept.at(-1)?.text !== " ") kept.push({ kind: "op", text: " " });
    }
    this.#tokens = kept;
  }

  parse(): Node {
    const node = this.#comparison();
    if (this.#at < this.#tokens.length) throw new HxFormulaError("The formula has more after its end.");
    return node;
  }

  #peek(): HxToken | undefined {
    return this.#tokens[this.#at];
  }

  #takeOp(...ops: string[]): string | null {
    const token = this.#peek();
    if (token?.kind === "op" && ops.includes(token.text)) {
      this.#at += 1;
      return token.text;
    }
    return null;
  }

  #comparison(): Node {
    let left = this.#concat();
    for (;;) {
      const op = this.#takeOp("=", "<>", "<", ">", "<=", ">=");
      if (!op) return left;
      left = { type: "binary", op, left, right: this.#concat() };
    }
  }

  #concat(): Node {
    let left = this.#additive();
    for (;;) {
      const op = this.#takeOp("&");
      if (!op) return left;
      left = { type: "binary", op, left, right: this.#additive() };
    }
  }

  #additive(): Node {
    let left = this.#multiplicative();
    for (;;) {
      const op = this.#takeOp("+", "-");
      if (!op) return left;
      left = { type: "binary", op, left, right: this.#multiplicative() };
    }
  }

  #multiplicative(): Node {
    let left = this.#power();
    for (;;) {
      const op = this.#takeOp("*", "/");
      if (!op) return left;
      left = { type: "binary", op, left, right: this.#power() };
    }
  }

  #power(): Node {
    let left = this.#unary();
    for (;;) {
      const op = this.#takeOp("^");
      if (!op) return left;
      left = { type: "binary", op, left, right: this.#unary() };
    }
  }

  #unary(): Node {
    const op = this.#takeOp("-", "+");
    if (op) return { type: "unary", op, arg: this.#unary() };
    let node = this.#intersection();
    while (this.#takeOp("%")) node = { type: "percent", arg: node };
    return node;
  }

  /** References meet before anything else is computed: A1:C3 B2:D4 is the cells in both. */
  #intersection(): Node {
    let left = this.#primary();
    while (this.#takeOp(" ")) left = { type: "binary", op: " ", left, right: this.#primary() };
    return left;
  }

  #primary(): Node {
    const token = this.#peek();
    if (!token) throw new HxFormulaError("The formula ends too early.");
    this.#at += 1;
    switch (token.kind) {
      case "number":
        return { type: "value", value: token.value };
      case "string":
        return { type: "value", value: token.value };
      case "bool":
        return { type: "value", value: token.value };
      case "error":
        return { type: "value", value: { error: token.text.toUpperCase() } };
      case "ref":
        return { type: "ref", sheet: token.sheet, body: token.body, external: token.external };
      case "open": {
        const inner = this.#comparison();
        if (this.#peek()?.kind !== "close") throw new HxFormulaError("A bracket in the formula does not close.");
        this.#at += 1;
        return inner;
      }
      case "func": {
        if (this.#peek()?.kind !== "open") throw new HxFormulaError("A function has no bracket.");
        this.#at += 1;
        const args: (Node | null)[] = [];
        if (this.#peek()?.kind === "close") {
          this.#at += 1;
          return { type: "call", name: token.name, args };
        }
        for (;;) {
          const next = this.#peek();
          if (next?.kind === "comma" || next?.kind === "close") args.push(null);
          else args.push(this.#comparison());
          const sep = this.#peek();
          this.#at += 1;
          if (sep?.kind === "close") return { type: "call", name: token.name, args };
          if (sep?.kind !== "comma") throw new HxFormulaError("A function's arguments do not end.");
        }
      }
      case "name":
        return { type: "unknown", reason: `the name ${token.text}` };
      case "array":
      case "other":
        return { type: "unknown", reason: token.text.slice(0, 40) };
      default:
        throw new HxFormulaError(`The formula has an unexpected ${token.text}.`);
    }
  }
}

/** Parses a formula to check it; throws HxFormulaError with the reason when it is not well-formed. */
export function checkFormula(formula: string): void {
  new Parser(tokenize(formula)).parse();
}

// ---------------------------------------------------------------- evaluation

const VOLATILE = new Set(["NOW", "TODAY", "RAND", "RANDBETWEEN", "RANDARRAY", "OFFSET", "INDIRECT", "CELL", "INFO"]);

/** Excel's General text of a number: up to 15 significant digits. */
export function numberText(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const text = Number(value.toPrecision(15)).toString();
  return text.includes("e") ? text.replace("e+", "E+").replace("e-", "E-") : text;
}

function toNumber(value: HxScalar): number | HxError {
  if (value === null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const clean = value.trim().replace(/,/g, "");
    if (clean !== "" && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?%?$/i.test(clean)) {
      const percent = clean.endsWith("%");
      const number = Number(percent ? clean.slice(0, -1) : clean);
      return percent ? number / 100 : number;
    }
    return err("#VALUE!");
  }
  return value;
}

function toText(value: HxScalar): string | HxError {
  if (value === null) return "";
  if (typeof value === "number") return numberText(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  return value;
}

function toBool(value: HxScalar): boolean | HxError {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (value.toUpperCase() === "TRUE") return true;
    if (value.toUpperCase() === "FALSE") return false;
    return err("#VALUE!");
  }
  return value;
}

function finite(value: number): number | HxError {
  return Number.isFinite(value) ? value : err("#NUM!");
}

/** Excel's ordering: numbers, then text (without case), then logical values; blank as 0 or "". */
function compare(a: HxScalar, b: HxScalar): number {
  const rank = (value: HxScalar) => (typeof value === "number" ? 0 : typeof value === "string" ? 1 : 2);
  const left = a === null ? (typeof b === "string" ? "" : typeof b === "boolean" ? false : 0) : a;
  const right = b === null ? (typeof a === "string" ? "" : typeof a === "boolean" ? false : 0) : b;
  if (rank(left) !== rank(right)) return rank(left) - rank(right);
  if (typeof left === "string" && typeof right === "string") {
    const x = left.toLowerCase();
    const y = right.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  // Excel compares numbers to 15 significant digits: 0.1+0.2=0.3 is TRUE.
  const x = Number(Number(left).toPrecision(15));
  const y = Number(Number(right).toPrecision(15));
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Excel rounds half away from zero, on the decimal value that the number shows. */
function roundTo(value: number, digits: number, mode: "half" | "up" | "down"): number {
  const factor = 10 ** digits;
  const scaled = Number((Math.abs(value) * factor).toPrecision(15));
  const rounded = mode === "half" ? Math.round(scaled) : mode === "up" ? Math.ceil(scaled) : Math.floor(scaled);
  return (Math.sign(value) * rounded) / factor;
}

/** A criteria of SUMIF and COUNTIF as a test. */
function criteria(spec: HxScalar): (value: HxScalar) => boolean {
  if (typeof spec === "boolean") return (value) => value !== null && compare(value, spec) === 0;
  const text = typeof spec === "string" ? spec : typeof spec === "number" ? `=${spec}` : "";
  const match = /^(<=|>=|<>|=|<|>)?(.*)$/s.exec(text);
  const op = match?.[1] ?? "=";
  const operand = match?.[2] ?? "";
  const asNumber = typeof spec === "number" ? spec : toNumber(operand);
  const numeric = operand.trim() !== "" && typeof asNumber === "number";
  if (numeric) {
    const target = asNumber;
    return (value) => {
      // Equality also matches numbers kept as text: COUNTIF(A:A, 5) counts a cell holding the text "5".
      const asValue =
        typeof value === "number"
          ? value
          : typeof value === "string" && (op === "=" || op === "<>") && value.trim() !== ""
            ? toNumber(value)
            : null;
      if (typeof asValue !== "number") return op === "<>";
      const c = compare(asValue, target);
      return op === "="
        ? c === 0
        : op === "<>"
          ? c !== 0
          : op === "<"
            ? c < 0
            : op === ">"
              ? c > 0
              : op === "<="
                ? c <= 0
                : c >= 0;
    };
  }
  if (op === "=" || op === "<>") {
    const pattern = new RegExp(
      `^${operand.replace(
        /~([*?~])|([*?])|([.+^${}()|[\]\\])/g,
        (_all, escaped: string, wild: string, special: string) =>
          escaped ? `\\${escaped}` : wild === "*" ? ".*" : wild === "?" ? "." : `\\${special}`,
      )}$`,
      "is",
    );
    const blank = operand === "";
    return (value) => {
      const hit = blank ? value === null || value === "" : typeof value === "string" ? pattern.test(value) : false;
      return op === "=" ? hit : !hit;
    };
  }
  return (value) => {
    if (typeof value !== "string") return false;
    const c = compare(value, operand);
    return op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
  };
}

const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);

const DAY_MS = 86_400_000;
const MARCH_1900 = Date.UTC(1900, 2, 1);

/**
 * The serial number of a date, as Excel counts days. The month is brought into range first (month 13 is
 * January of the next year), then the days are counted on from the first of that month, so that the day
 * may be 0, negative or past the month's end. In the 1900 system Excel counts a 29 February 1900 that
 * never was: DATE(1900,2,29) is 60 and 1 March 1900 is 61.
 */
export function dateSerial(year: number, month: number, day: number, date1904 = false): number {
  const first = Date.UTC(year, month - 1, 1);
  if (date1904) return Math.round((first - EPOCH_1904) / DAY_MS) + day - 1;
  const real = Math.round((first - EPOCH_1900) / DAY_MS) - 1;
  return real + (first >= MARCH_1900 ? 1 : 0) + day - 1;
}

export function serialDate(serial: number, date1904 = false): Date {
  if (date1904) return new Date(EPOCH_1904 + serial * DAY_MS);
  const days = serial < 61 ? serial + 1 : serial;
  return new Date(EPOCH_1900 + Math.round(days * DAY_MS));
}

/** Year, month and day of a serial number, with Excel's 0 January 1900 and 29 February 1900. */
export function serialParts(serial: number, date1904 = false): { year: number; month: number; day: number } {
  const whole = Math.floor(serial);
  if (!date1904 && whole === 60) return { year: 1900, month: 2, day: 29 };
  if (!date1904 && whole === 0) return { year: 1900, month: 1, day: 0 };
  const date = serialDate(whole, date1904);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** The last day Excel knows: 31 December 9999. */
const MAX_SERIAL = 2_958_465;

export class HxEvaluator {
  readonly #context: HxFormulaContext;
  #cells = 0;

  constructor(context: HxFormulaContext) {
    this.#context = context;
  }

  /** The value of a formula, or throws HxUnknown. */
  evaluate(formula: string): HxScalar {
    let node: Node;
    try {
      node = new Parser(tokenize(formula)).parse();
    } catch (error) {
      throw new HxUnknown(error instanceof Error ? error.message : "parse");
    }
    const value = this.#eval(node);
    if (isMatrix(value)) {
      // A range as the whole result: one cell gives its value; more spill, which HXBot does not write.
      const only = value.rows.length === 1 && value.rows[0]?.length === 1 ? value.rows[0]?.[0] : undefined;
      if (only === undefined) throw new HxUnknown("an array result");
      return only;
    }
    return value;
  }

  #range(sheet: string | null, body: string): HxMatrix {
    const name = sheet ?? this.#context.sheet;
    if (!this.#context.hasSheet(name)) throw new HxUnknown(`the sheet ${name}`);
    const range = parseRange(body);
    if (!range) throw new HxUnknown(`the reference ${body}`);
    const extent = this.#context.extent(name);
    const lastRow = Math.min(range.end.row, Math.max(extent.row, range.start.row));
    const lastCol = Math.min(range.end.col, Math.max(extent.col, range.start.col));
    const cells = (lastRow - range.start.row + 1) * (lastCol - range.start.col + 1);
    this.#cells += cells;
    if (this.#cells > 2_000_000) throw new HxUnknown("too many cells");
    const rows: HxScalar[][] = [];
    for (let row = range.start.row; row <= lastRow; row += 1) {
      const line: HxScalar[] = [];
      for (let col = range.start.col; col <= lastCol; col += 1) line.push(this.#context.cell(name, { row, col }));
      rows.push(line);
    }
    return { rows };
  }

  #scalar(node: Node): HxScalar {
    const value = this.#eval(node);
    if (!isMatrix(value)) return value;
    // A range used as one value: Excel takes its single cell (implicit intersection is not modelled).
    if (value.rows.length === 1 && value.rows[0]?.length === 1) return value.rows[0]?.[0] ?? null;
    return err("#VALUE!");
  }

  #eval(node: Node): HxValue {
    switch (node.type) {
      case "value":
        return node.value;
      case "unknown":
        throw new HxUnknown(node.reason);
      case "ref": {
        if (node.external) throw new HxUnknown("an external reference");
        if (node.body === "#REF!") return err("#REF!");
        const range = this.#range(node.sheet, node.body);
        return range.rows.length === 1 && range.rows[0]?.length === 1 ? (range.rows[0]?.[0] ?? null) : range;
      }
      case "unary": {
        const value = toNumber(this.#scalar(node.arg));
        if (isError(value)) return value;
        return node.op === "-" ? -value : value;
      }
      case "percent": {
        const value = toNumber(this.#scalar(node.arg));
        return isError(value) ? value : value / 100;
      }
      case "binary":
        // The intersection of two ranges is left to Excel.
        if (node.op === " ") throw new HxUnknown("an intersection of ranges");
        return this.#binary(node.op, this.#scalar(node.left), this.#scalar(node.right));
      case "call":
        return this.#call(node.name, node.args);
    }
  }

  #binary(op: string, left: HxScalar, right: HxScalar): HxScalar {
    if (isError(left)) return left;
    if (isError(right)) return right;
    if (op === "&") {
      const a = toText(left);
      const b = toText(right);
      if (isError(a)) return a;
      if (isError(b)) return b;
      return a + b;
    }
    if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
      const c = compare(left, right);
      return op === "="
        ? c === 0
        : op === "<>"
          ? c !== 0
          : op === "<"
            ? c < 0
            : op === ">"
              ? c > 0
              : op === "<="
                ? c <= 0
                : c >= 0;
    }
    const a = toNumber(left);
    const b = toNumber(right);
    if (isError(a)) return a;
    if (isError(b)) return b;
    switch (op) {
      case "+":
        return finite(a + b);
      case "-":
        return finite(a - b);
      case "*":
        return finite(a * b);
      case "/":
        return b === 0 ? err("#DIV/0!") : finite(a / b);
      case "^":
        if (a === 0 && b === 0) return err("#NUM!");
        return finite(a ** b);
      default:
        throw new HxUnknown(`the operator ${op}`);
    }
  }

  /** The numbers of SUM and the like: ranges give their numbers, direct arguments are converted. */
  #numbers(args: (Node | null)[], options: { countText?: boolean } = {}): number[] | HxError {
    const out: number[] = [];
    for (const arg of args) {
      if (arg === null) {
        out.push(0);
        continue;
      }
      const value = this.#eval(arg);
      if (isMatrix(value) || arg.type === "ref") {
        const cells = isMatrix(value) ? value.rows.flat() : [value];
        for (const cell of cells) {
          if (isError(cell)) return cell;
          if (typeof cell === "number") out.push(cell);
          else if (options.countText && cell !== null) out.push(0);
        }
        continue;
      }
      if (isError(value)) return value;
      const number = toNumber(value);
      if (isError(number)) return number;
      out.push(number);
    }
    return out;
  }

  #cellsOf(node: Node | null): HxScalar[][] {
    if (node === null) return [[null]];
    const value = this.#eval(node);
    return isMatrix(value) ? value.rows : [[value]];
  }

  #call(name: string, args: (Node | null)[]): HxValue {
    if (VOLATILE.has(name)) throw new HxUnknown(`the volatile function ${name}`);
    const arg = (index: number): HxScalar => {
      const node = args[index];
      return node === undefined || node === null ? null : this.#scalar(node);
    };
    const num = (index: number): number | HxError => toNumber(arg(index));
    const need = (min: number, max = min) => {
      if (args.length < min || args.length > max) throw new HxUnknown(`${name} with ${args.length} arguments`);
    };
    switch (name) {
      case "SUM": {
        const values = this.#numbers(args);
        return isError(values) ? values : finite(values.reduce((sum, value) => sum + value, 0));
      }
      case "PRODUCT": {
        const values = this.#numbers(args);
        return isError(values) ? values : finite(values.reduce((product, value) => product * value, 1));
      }
      case "AVERAGE": {
        const values = this.#numbers(args);
        if (isError(values)) return values;
        return values.length === 0
          ? err("#DIV/0!")
          : finite(values.reduce((sum, value) => sum + value, 0) / values.length);
      }
      case "MIN":
      case "MAX": {
        const values = this.#numbers(args);
        if (isError(values)) return values;
        if (values.length === 0) return 0;
        return name === "MIN" ? Math.min(...values) : Math.max(...values);
      }
      case "MEDIAN": {
        const values = this.#numbers(args);
        if (isError(values)) return values;
        if (values.length === 0) return err("#NUM!");
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
      }
      case "COUNT": {
        let count = 0;
        for (const node of args) {
          if (node === null) continue;
          const value = this.#eval(node);
          const cells = isMatrix(value) ? value.rows.flat() : [value];
          const direct = !isMatrix(value) && node.type !== "ref";
          for (const cell of cells) {
            if (typeof cell === "number") count += 1;
            else if (direct && (typeof cell === "boolean" || (typeof cell === "string" && !isError(toNumber(cell)))))
              count += 1;
          }
        }
        return count;
      }
      case "COUNTA": {
        let count = 0;
        for (const node of args) {
          if (node === null) continue;
          const value = this.#eval(node);
          const cells = isMatrix(value) ? value.rows.flat() : [value];
          for (const cell of cells) if (cell !== null) count += 1;
        }
        return count;
      }
      case "COUNTBLANK": {
        need(1);
        return this.#cellsOf(args[0] ?? null)
          .flat()
          .filter((cell) => cell === null || cell === "").length;
      }
      case "ROUND":
      case "ROUNDUP":
      case "ROUNDDOWN": {
        need(1, 2);
        const value = num(0);
        const digits = args.length > 1 ? num(1) : 0;
        if (isError(value)) return value;
        if (isError(digits)) return digits;
        return roundTo(value, Math.trunc(digits), name === "ROUND" ? "half" : name === "ROUNDUP" ? "up" : "down");
      }
      case "INT": {
        need(1);
        const value = num(0);
        return isError(value) ? value : Math.floor(value);
      }
      case "ABS": {
        need(1);
        const value = num(0);
        return isError(value) ? value : Math.abs(value);
      }
      case "SQRT": {
        need(1);
        const value = num(0);
        if (isError(value)) return value;
        return value < 0 ? err("#NUM!") : Math.sqrt(value);
      }
      case "POWER": {
        need(2);
        return this.#binary("^", arg(0), arg(1));
      }
      case "MOD": {
        need(2);
        const a = num(0);
        const b = num(1);
        if (isError(a)) return a;
        if (isError(b)) return b;
        if (b === 0) return err("#DIV/0!");
        return finite(a - b * Math.floor(a / b));
      }
      case "IF": {
        need(1, 3);
        const test = toBool(arg(0));
        if (isError(test)) return test;
        if (test) return args.length > 1 ? arg(1) : true;
        return args.length > 2 ? arg(2) : false;
      }
      case "IFERROR": {
        need(2);
        const value = arg(0);
        return isError(value) ? arg(1) : value;
      }
      case "AND":
      case "OR": {
        if (args.length === 0) throw new HxUnknown(`${name} without arguments`);
        let result = name === "AND";
        let seen = false;
        for (const node of args) {
          if (node === null) continue;
          const value = this.#eval(node);
          const cells = isMatrix(value) ? value.rows.flat() : [value];
          for (const cell of cells) {
            if (isError(cell)) return cell;
            if (cell === null || (typeof cell === "string" && (isMatrix(value) || node.type === "ref"))) continue;
            const bool = toBool(cell);
            if (isError(bool)) return bool;
            seen = true;
            result = name === "AND" ? result && bool : result || bool;
          }
        }
        return seen ? result : err("#VALUE!");
      }
      case "TRUE":
      case "FALSE":
        need(0);
        return name === "TRUE";
      case "NA":
        need(0);
        return err("#N/A");
      case "ISNUMBER":
      case "ISTEXT":
      case "ISBLANK":
      case "ISLOGICAL":
      case "ISERROR":
      case "ISERR":
      case "ISNA": {
        need(1);
        const value = arg(0);
        if (name === "ISNUMBER") return typeof value === "number";
        if (name === "ISTEXT") return typeof value === "string";
        if (name === "ISBLANK") return value === null;
        if (name === "ISLOGICAL") return typeof value === "boolean";
        if (!isError(value)) return false;
        return name === "ISERROR" ? true : name === "ISNA" ? value.error === "#N/A" : value.error !== "#N/A";
      }
      case "NOT": {
        need(1);
        const value = toBool(arg(0));
        return isError(value) ? value : !value;
      }
      case "CONCATENATE":
      case "CONCAT": {
        let text = "";
        for (const node of args) {
          if (node === null) continue;
          const value = this.#eval(node);
          if (isMatrix(value) && name === "CONCATENATE") return err("#VALUE!");
          for (const cell of isMatrix(value) ? value.rows.flat() : [value]) {
            const part = toText(cell);
            if (isError(part)) return part;
            text += part;
          }
        }
        return text;
      }
      case "LEN": {
        need(1);
        const text = toText(arg(0));
        return isError(text) ? text : [...text].length;
      }
      case "UPPER":
      case "LOWER":
      case "TRIM": {
        need(1);
        const text = toText(arg(0));
        if (isError(text)) return text;
        return name === "UPPER"
          ? text.toUpperCase()
          : name === "LOWER"
            ? text.toLowerCase()
            : text.replace(/ +/g, " ").trim();
      }
      case "LEFT":
      case "RIGHT": {
        need(1, 2);
        const text = toText(arg(0));
        const count = args.length > 1 ? num(1) : 1;
        if (isError(text)) return text;
        if (isError(count)) return count;
        if (count < 0) return err("#VALUE!");
        const chars = [...text];
        return name === "LEFT"
          ? chars.slice(0, count).join("")
          : chars.slice(Math.max(0, chars.length - count)).join("");
      }
      case "MID": {
        need(3);
        const text = toText(arg(0));
        const start = num(1);
        const count = num(2);
        if (isError(text)) return text;
        if (isError(start)) return start;
        if (isError(count)) return count;
        if (start < 1 || count < 0) return err("#VALUE!");
        return [...text].slice(start - 1, start - 1 + count).join("");
      }
      case "SUMIF":
      case "AVERAGEIF":
      case "COUNTIF": {
        need(2, name === "COUNTIF" ? 2 : 3);
        const range = this.#cellsOf(args[0] ?? null);
        const test = criteria(arg(1));
        const sums = args.length > 2 ? this.#cellsOf(args[2] ?? null) : range;
        let total = 0;
        let count = 0;
        for (let row = 0; row < range.length; row += 1) {
          const line = range[row] ?? [];
          for (let col = 0; col < line.length; col += 1) {
            const cell = line[col] ?? null;
            if (!test(cell)) continue;
            count += 1;
            const value = sums[row]?.[col] ?? null;
            if (isError(value)) return value;
            if (typeof value === "number") total += value;
            else if (name !== "COUNTIF") count -= name === "AVERAGEIF" ? 1 : 0;
          }
        }
        if (name === "COUNTIF") return count;
        if (name === "SUMIF") return finite(total);
        return count === 0 ? err("#DIV/0!") : finite(total / count);
      }
      case "SUMPRODUCT": {
        if (args.length === 0) throw new HxUnknown("SUMPRODUCT without arguments");
        const arrays = args.map((node) => this.#cellsOf(node));
        const rows = arrays[0]?.length ?? 0;
        const cols = arrays[0]?.[0]?.length ?? 0;
        if (arrays.some((array) => array.length !== rows || (array[0]?.length ?? 0) !== cols)) return err("#VALUE!");
        let total = 0;
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            let product = 1;
            for (const array of arrays) {
              const cell = array[row]?.[col] ?? null;
              if (isError(cell)) return cell;
              product *= typeof cell === "number" ? cell : 0;
            }
            total += product;
          }
        }
        return finite(total);
      }
      case "VLOOKUP": {
        need(3, 4);
        const key = arg(0);
        if (isError(key)) return key;
        const table = this.#cellsOf(args[1] ?? null);
        const column = num(2);
        if (isError(column)) return column;
        const exact = args.length > 3 ? toBool(arg(3)) : true;
        if (isError(exact)) return exact;
        if (column < 1) return err("#VALUE!");
        if (column > (table[0]?.length ?? 0)) return err("#REF!");
        const keys = table.map((line) => line[0] ?? null);
        const index = exact
          ? approximate(keys, key)
          : keys.findIndex((cell) => cell !== null && compare(cell, key) === 0);
        if (index < 0) return err("#N/A");
        return table[index]?.[Math.trunc(column) - 1] ?? null;
      }
      case "MATCH": {
        need(2, 3);
        const key = arg(0);
        if (isError(key)) return key;
        const cells = this.#cellsOf(args[1] ?? null);
        const line = cells.length === 1 ? (cells[0] ?? []) : cells.map((row) => row[0] ?? null);
        const type = args.length > 2 ? num(2) : 1;
        if (isError(type)) return type;
        if (type === 0) {
          const test =
            typeof key === "string"
              ? criteria(`=${key}`)
              : (cell: HxScalar) => cell !== null && compare(cell, key) === 0;
          const index = line.findIndex((cell) => test(cell));
          return index < 0 ? err("#N/A") : index + 1;
        }
        if (type < 0) throw new HxUnknown("MATCH in descending order");
        const index = approximate(line, key);
        return index < 0 ? err("#N/A") : index + 1;
      }
      case "INDEX": {
        need(2, 3);
        const cells = this.#cellsOf(args[0] ?? null);
        const row = num(1);
        const col = args.length > 2 ? num(2) : 1;
        if (isError(row)) return row;
        if (isError(col)) return col;
        if (row === 0 || col === 0) throw new HxUnknown("INDEX of a whole row or column");
        const r = cells.length === 1 && args.length === 2 ? 1 : row;
        const c = cells.length === 1 && args.length === 2 ? row : col;
        const value = cells[r - 1]?.[c - 1];
        return value === undefined ? err("#REF!") : value;
      }
      case "DATE": {
        need(3);
        const y = num(0);
        const m = num(1);
        const d = num(2);
        if (isError(y)) return y;
        if (isError(m)) return m;
        if (isError(d)) return d;
        // Excel reads a year below 1900 as that many years after 1900 (DATE(124,1,1) is 2024), and refuses
        // a negative year or one from 10000 on.
        const whole = Math.trunc(y);
        if (whole < 0 || whole > 9999) return err("#NUM!");
        const year = whole < 1900 ? whole + 1900 : whole;
        const serial = dateSerial(year, Math.trunc(m), Math.trunc(d), this.#context.date1904);
        return serial < 0 || serial > MAX_SERIAL ? err("#NUM!") : serial;
      }
      case "YEAR":
      case "MONTH":
      case "DAY": {
        need(1);
        const serial = num(0);
        if (isError(serial)) return serial;
        if (serial < 0 || serial >= MAX_SERIAL + 1) return err("#NUM!");
        const parts = serialParts(serial, this.#context.date1904);
        return name === "YEAR" ? parts.year : name === "MONTH" ? parts.month : parts.day;
      }
      default:
        throw new HxUnknown(`the function ${name}`);
    }
  }
}

/** The position of the largest value not above `key` in an ascending list, or -1; Excel's approximate match. */
function approximate(list: readonly HxScalar[], key: HxScalar): number {
  let found = -1;
  for (let index = 0; index < list.length; index += 1) {
    const cell = list[index] ?? null;
    if (cell === null) continue;
    const typeMatches = typeof cell === typeof key;
    if (!typeMatches) continue;
    if (compare(cell, key) <= 0) found = index;
    else break;
  }
  return found;
}
