// HXBot v1.7.4（CU-07 表格技能）：.csv 由 HXBot 自己读成 .xlsx，不经过任何应用。
// 在真机上（v1.7.4）Numbers 转 .csv 时在第一行多写一行表名，单元格整体往下错一行；.csv 本来就是文字，
// 自己读最准：编码按 BOM、UTF-8、GB18030（中文 Excel 存的 .csv）依次认，分隔符从逗号、分号、制表符、竖线里
// 按前几行最一致的那个定，引号按 RFC 4180。像数字的才存成数字：前导零、超过 15 位（如身份证号）、
// 千分位、百分号都照文字原样留下，不会被改掉。
import { xlsxFixture } from "./office-fixtures";
import { stripInvalid } from "./xml";

const DELIMITERS = [",", ";", "\t", "|"] as const;
/** At most this many cells; larger files are refused rather than read slowly into memory. */
const MAX_CELLS = 5_000_000;

export class HxCsvError extends Error {}

/** The text of a .csv file: by its byte order mark, else UTF-8, else GB18030. */
export function hxCsvText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}

/** The separator that splits the first lines (outside quotes) into the same number of fields most often. */
function delimiterOf(text: string): string {
  const lines: string[] = [];
  let line = "";
  let quoted = false;
  for (const char of text.slice(0, 64 * 1024)) {
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === "\n" || char === "\r")) {
      if (line.trim()) lines.push(line);
      line = "";
      if (lines.length >= 10) break;
      continue;
    }
    line += char;
  }
  if (line.trim() && lines.length < 10) lines.push(line);
  let best: { delimiter: string; score: number } = { delimiter: ",", score: 0 };
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((one) => {
      let count = 0;
      let inside = false;
      for (const char of one) {
        if (char === '"') inside = !inside;
        else if (!inside && char === delimiter) count += 1;
      }
      return count;
    });
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    // Lines that agree with the first, weighted by how many fields they make.
    const score = counts.filter((count) => count === first).length * (first + 1);
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

/** The rows of a .csv text (RFC 4180: quotes, doubled quotes, line breaks inside quotes). */
export function hxCsvRows(text: string, delimiter = delimiterOf(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let cells = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      cells += row.length;
      if (cells > MAX_CELLS) throw new HxCsvError("The .csv has more than 5 million cells.");
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/u;

/** A field as a cell: a plain number of at most 15 digits becomes a number; everything else stays text. */
function cell(raw: string): string | number | null {
  // Characters that XML cannot hold (and Excel never shows) are left out.
  const text = stripInvalid(raw);
  if (text === "") return null;
  if (NUMBER.test(text) && text.replace(/[-.]|[eE].*$/gu, "").length <= 15) {
    const value = Number(text);
    if (Number.isFinite(value)) return value;
  }
  return text;
}

/** A sheet name Excel accepts, from a file name. */
export function hxSheetNameOf(stem: string): string {
  const name = stem
    .replace(/[[\]:*?/\\]/gu, " ")
    .replace(/^'+|'+$/gu, "")
    .trim()
    .slice(0, 31);
  return name || "Sheet1";
}

/** A .csv file as an .xlsx workbook of one sheet. */
export function hxCsvToXlsx(bytes: Uint8Array, sheetName: string): Uint8Array {
  const rows = hxCsvRows(hxCsvText(bytes)).map((row) => row.map(cell));
  return xlsxFixture([{ name: hxSheetNameOf(sheetName), rows }]);
}
