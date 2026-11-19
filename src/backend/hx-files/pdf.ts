// HXBot v1.7.4（CU-07 PDF 技能）：自己读写 PDF 的结构，用来拆分、合并和填表；取文字在 pdf-text.ts（pdf.js）。
// 读：交叉引用表和交叉引用流（含 /Prev 链、混合文件、PNG 预测器）、对象流；交叉引用坏了就扫全文件重建。
// 写：拆分、合并只复制选中页能连到的对象（指向别的页的引用切断），表单字段一并带上；填表用追加更新，原文件字节不动，
// 原有签名覆盖的部分不变。加密的 PDF 不改。
import { randomBytes } from "node:crypto";
import { constants, inflateRawSync, inflateSync } from "node:zlib";

export class HxPdfError extends Error {
  readonly code: "not-pdf" | "encrypted" | "damaged" | "unsupported" | "invalid" | "too-large";

  constructor(code: HxPdfError["code"], message: string) {
    super(message);
    this.name = "HxPdfError";
    this.code = code;
  }
}

export const HX_PDF_LIMITS = {
  maxDepth: 200,
  maxObjects: 2_000_000,
  maxStreamBytes: 512 * 1024 * 1024,
  maxPages: 100_000,
} as const;

// ---------------------------------------------------------------------------------------------- values

export class PdfName {
  /** The name without its slash, its bytes as Latin-1 characters. */
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }
}

export class PdfString {
  readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /** A text string from Unicode text: PDFDocEncoding when it is plain ASCII, else UTF-16BE with a BOM. */
  static text(value: string): PdfString {
    if (/^[\x20-\x7e\t\n\r]*$/.test(value)) return new PdfString(Buffer.from(value, "latin1"));
    const bytes = Buffer.alloc(2 + value.length * 2);
    bytes[0] = 0xfe;
    bytes[1] = 0xff;
    for (let index = 0; index < value.length; index += 1) bytes.writeUInt16BE(value.charCodeAt(index), 2 + index * 2);
    return new PdfString(bytes);
  }

  /** The string read as a PDF text string. */
  text(): string {
    const b = this.bytes;
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
      let out = "";
      for (let index = 2; index + 1 < b.length; index += 2)
        out += String.fromCharCode(((b[index] ?? 0) << 8) | (b[index + 1] ?? 0));
      return out;
    }
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
      return Buffer.from(b.subarray(3)).toString("utf8");
    let out = "";
    for (const byte of b) out += PDF_DOC[byte] ?? String.fromCharCode(byte);
    return out;
  }
}

/** PDFDocEncoding where it differs from Latin-1. */
const PDF_DOC: Record<number, string> = {
  24: "˘",
  25: "ˇ",
  26: "ˆ",
  27: "˙",
  28: "˝",
  29: "˛",
  30: "˚",
  31: "˜",
  128: "•",
  129: "†",
  130: "‡",
  131: "…",
  132: "—",
  133: "–",
  134: "ƒ",
  135: "⁄",
  136: "‹",
  137: "›",
  138: "−",
  139: "‰",
  140: "„",
  141: "“",
  142: "”",
  143: "‘",
  144: "’",
  145: "‚",
  146: "™",
  147: "ﬁ",
  148: "ﬂ",
  149: "Ł",
  150: "Œ",
  151: "Š",
  152: "Ÿ",
  153: "Ž",
  154: "ı",
  155: "ł",
  156: "œ",
  157: "š",
  158: "ž",
  160: "€",
};

export class PdfRef {
  readonly num: number;
  readonly gen: number;

  constructor(num: number, gen: number) {
    this.num = num;
    this.gen = gen;
  }
}

export class PdfDict {
  readonly map = new Map<string, PdfValue>();

  get(key: string): PdfValue | undefined {
    return this.map.get(key);
  }

  set(key: string, value: PdfValue): void {
    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }
}

export class PdfStream {
  readonly dict: PdfDict;
  readonly raw: Uint8Array;

  constructor(dict: PdfDict, raw: Uint8Array) {
    this.dict = dict;
    this.raw = raw;
  }
}

export type PdfValue = null | boolean | number | PdfName | PdfString | PdfRef | PdfDict | PdfStream | PdfValue[];

export function pdfName(value: PdfValue | undefined): string | null {
  return value instanceof PdfName ? value.value : null;
}

// ---------------------------------------------------------------------------------------------- lexer

const SPACE = new Uint8Array(256);
for (const code of [0, 9, 10, 12, 13, 32]) SPACE[code] = 1;
const DELIMITER = new Uint8Array(256);
for (const char of "()<>[]{}/%") DELIMITER[char.charCodeAt(0)] = 1;

function regular(code: number | undefined): boolean {
  return code !== undefined && SPACE[code] === 0 && DELIMITER[code] === 0;
}

function hexValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x37;
  if (code >= 0x61 && code <= 0x66) return code - 0x57;
  return -1;
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const INTEGER = /^\d+$/;

class Lexer {
  readonly b: Buffer;
  pos: number;
  /** Resolves a /Length given as a reference while a stream is read. */
  readonly length: (ref: PdfRef) => number | null;

  constructor(b: Buffer, pos: number, length: (ref: PdfRef) => number | null = () => null) {
    this.b = b;
    this.pos = pos;
    this.length = length;
  }

  skip(): void {
    const b = this.b;
    while (this.pos < b.length) {
      const code = b[this.pos] ?? 0;
      if (SPACE[code]) this.pos += 1;
      else if (code === 0x25) {
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos += 1;
      } else break;
    }
  }

  word(): string {
    const start = this.pos;
    while (this.pos < this.b.length && regular(this.b[this.pos])) this.pos += 1;
    return this.b.toString("latin1", start, this.pos);
  }

  value(depth = 0): PdfValue {
    if (depth > HX_PDF_LIMITS.maxDepth) throw new HxPdfError("damaged", "The PDF nests its values too deeply.");
    this.skip();
    const b = this.b;
    const code = b[this.pos];
    if (code === undefined) throw new HxPdfError("damaged", "The PDF ends in the middle of a value.");
    if (code === 0x2f) return this.#name();
    if (code === 0x28) return this.#literal();
    if (code === 0x3c) {
      if (b[this.pos + 1] === 0x3c) return this.#dict(depth);
      return this.#hex();
    }
    if (code === 0x5b) {
      this.pos += 1;
      const items: PdfValue[] = [];
      for (;;) {
        this.skip();
        if (this.pos >= b.length) throw new HxPdfError("damaged", "The PDF ends in the middle of an array.");
        if (b[this.pos] === 0x5d) {
          this.pos += 1;
          return items;
        }
        items.push(this.value(depth + 1));
      }
    }
    const word = this.word();
    if (word === "") {
      this.pos += 1;
      throw new HxPdfError("damaged", `The PDF has an unexpected character at byte ${this.pos - 1}.`);
    }
    if (NUMBER.test(word)) {
      const number = Number(word);
      if (INTEGER.test(word)) {
        const save = this.pos;
        this.skip();
        const gen = this.word();
        if (INTEGER.test(gen)) {
          this.skip();
          if (this.b[this.pos] === 0x52 && !regular(this.b[this.pos + 1])) {
            this.pos += 1;
            return new PdfRef(number, Number(gen));
          }
        }
        this.pos = save;
      }
      return number;
    }
    // Writers that put "--5" or "5-" still mean a number.
    const loose = Number.parseFloat(word.replace(/^[+-]+/, (sign) => (sign.includes("-") ? "-" : "")));
    if (/^[+-]*[\d.]+[+-]*$/.test(word) && Number.isFinite(loose)) return loose;
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    throw new HxPdfError("damaged", `The PDF has an unexpected word "${word.slice(0, 20)}".`);
  }

  #name(): PdfName {
    this.pos += 1;
    const start = this.pos;
    while (this.pos < this.b.length && regular(this.b[this.pos])) this.pos += 1;
    const raw = this.b.toString("latin1", start, this.pos);
    return new PdfName(
      raw.includes("#")
        ? raw.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
        : raw,
    );
  }

  #hex(): PdfString {
    this.pos += 1;
    const out: number[] = [];
    let high = -1;
    while (this.pos < this.b.length) {
      const code = this.b[this.pos] ?? 0;
      this.pos += 1;
      if (code === 0x3e) break;
      const value = hexValue(code);
      if (value < 0) continue;
      if (high < 0) high = value;
      else {
        out.push((high << 4) | value);
        high = -1;
      }
    }
    if (high >= 0) out.push(high << 4);
    return new PdfString(Uint8Array.from(out));
  }

  #literal(): PdfString {
    this.pos += 1;
    const b = this.b;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      let code = b[this.pos] ?? 0;
      this.pos += 1;
      if (code === 0x28) depth += 1;
      else if (code === 0x29) {
        depth -= 1;
        if (depth === 0) break;
      } else if (code === 0x5c) {
        code = b[this.pos] ?? 0;
        this.pos += 1;
        const escapes: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
        if (escapes[code] !== undefined) {
          out.push(escapes[code] ?? 0);
          continue;
        }
        if (code >= 0x30 && code <= 0x37) {
          let value = code - 0x30;
          for (let count = 1; count < 3; count += 1) {
            const next = b[this.pos] ?? 0;
            if (next < 0x30 || next > 0x37) break;
            value = value * 8 + next - 0x30;
            this.pos += 1;
          }
          out.push(value & 0xff);
          continue;
        }
        if (code === 13) {
          if (b[this.pos] === 10) this.pos += 1;
          continue;
        }
        if (code === 10) continue;
        out.push(code);
        continue;
      } else if (code === 13) {
        // An end of line in a string is a line feed.
        if (b[this.pos] === 10) this.pos += 1;
        out.push(10);
        continue;
      }
      out.push(code);
    }
    return new PdfString(Uint8Array.from(out));
  }

  #dict(depth: number): PdfDict | PdfStream {
    this.pos += 2;
    const dict = new PdfDict();
    const b = this.b;
    for (;;) {
      this.skip();
      if (this.pos >= b.length) throw new HxPdfError("damaged", "The PDF ends in the middle of a dictionary.");
      if (b[this.pos] === 0x3e && b[this.pos + 1] === 0x3e) {
        this.pos += 2;
        break;
      }
      const key = this.value(depth + 1);
      if (!(key instanceof PdfName)) continue;
      this.skip();
      if (b[this.pos] === 0x3e && b[this.pos + 1] === 0x3e) {
        dict.set(key.value, null);
        continue;
      }
      dict.set(key.value, this.value(depth + 1));
    }
    const save = this.pos;
    this.skip();
    if (this.b.toString("latin1", this.pos, this.pos + 6) === "stream" && !regular(this.b[this.pos + 6])) {
      this.pos += 6;
      return this.#stream(dict);
    }
    this.pos = save;
    return dict;
  }

  #stream(dict: PdfDict): PdfStream {
    const b = this.b;
    if (b[this.pos] === 13 && b[this.pos + 1] === 10) this.pos += 2;
    else if (b[this.pos] === 10 || b[this.pos] === 13) this.pos += 1;
    const start = this.pos;
    const declared = dict.get("Length");
    const length = typeof declared === "number" ? declared : declared instanceof PdfRef ? this.length(declared) : null;
    if (length !== null && Number.isInteger(length) && length >= 0 && start + length <= b.length) {
      const probe = new Lexer(b, start + length);
      probe.skip();
      if (b.toString("latin1", probe.pos, probe.pos + 9) === "endstream") {
        this.pos = probe.pos + 9;
        return new PdfStream(dict, b.subarray(start, start + length));
      }
    }
    // The length is wrong or missing: the data runs to "endstream".
    const end = b.indexOf("endstream", start, "latin1");
    if (end < 0) throw new HxPdfError("damaged", "A stream in the PDF has no end.");
    let stop = end;
    if (b[stop - 1] === 10) stop -= 1;
    if (b[stop - 1] === 13) stop -= 1;
    this.pos = end + 9;
    return new PdfStream(dict, b.subarray(start, Math.max(start, stop)));
  }
}

// ---------------------------------------------------------------------------------------------- filters

function inflate(data: Uint8Array): Buffer {
  const options = { maxOutputLength: HX_PDF_LIMITS.maxStreamBytes, finishFlush: constants.Z_SYNC_FLUSH };
  try {
    return inflateSync(data, options);
  } catch (error) {
    if (error instanceof RangeError) throw new HxPdfError("too-large", "A stream in the PDF unpacks too large.");
    return inflateRawSync(data, options);
  }
}

function unpredict(data: Buffer, params: PdfDict | null): Buffer {
  const predictor = numberOf(params?.get("Predictor")) ?? 1;
  if (predictor < 2) return data;
  const colors = numberOf(params?.get("Colors")) ?? 1;
  const bits = numberOf(params?.get("BitsPerComponent")) ?? 8;
  const columns = numberOf(params?.get("Columns")) ?? 1;
  const pixel = Math.max(1, Math.ceil((colors * bits) / 8));
  const row = Math.ceil((colors * bits * columns) / 8);
  if (predictor === 2) {
    const out = Buffer.from(data);
    if (bits !== 8) return out;
    for (let start = 0; start < out.length; start += row) {
      for (let at = start + pixel; at < Math.min(start + row, out.length); at += 1)
        out[at] = ((out[at] ?? 0) + (out[at - pixel] ?? 0)) & 0xff;
    }
    return out;
  }
  const rows = Math.floor(data.length / (row + 1));
  const out = Buffer.alloc(rows * row);
  for (let r = 0; r < rows; r += 1) {
    const type = data[r * (row + 1)] ?? 0;
    const src = r * (row + 1) + 1;
    const dst = r * row;
    for (let i = 0; i < row; i += 1) {
      const raw = data[src + i] ?? 0;
      const left = i >= pixel ? (out[dst + i - pixel] ?? 0) : 0;
      const up = r > 0 ? (out[dst - row + i] ?? 0) : 0;
      const upLeft = r > 0 && i >= pixel ? (out[dst - row + i - pixel] ?? 0) : 0;
      let value = raw;
      if (type === 1) value = raw + left;
      else if (type === 2) value = raw + up;
      else if (type === 3) value = raw + Math.floor((left + up) / 2);
      else if (type === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      out[dst + i] = value & 0xff;
    }
  }
  return out;
}

function asciiHex(data: Uint8Array): Buffer {
  const out: number[] = [];
  let high = -1;
  for (const code of data) {
    if (code === 0x3e) break;
    const value = hexValue(code);
    if (value < 0) continue;
    if (high < 0) high = value;
    else {
      out.push((high << 4) | value);
      high = -1;
    }
  }
  if (high >= 0) out.push(high << 4);
  return Buffer.from(out);
}

function ascii85(data: Uint8Array): Buffer {
  const out: number[] = [];
  let group: number[] = [];
  for (let index = 0; index < data.length; index += 1) {
    const code = data[index] ?? 0;
    if (code === 0x7e) break;
    if (SPACE[code]) continue;
    if (code === 0x7a && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (code < 0x21 || code > 0x75) throw new HxPdfError("damaged", "A stream has a bad ASCII85 character.");
    group.push(code - 0x21);
    if (group.length === 5) {
      let value = 0;
      for (const digit of group) value = value * 85 + digit;
      out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
      group = [];
    }
  }
  if (group.length > 1) {
    const count = group.length - 1;
    while (group.length < 5) group.push(84);
    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    out.push(...bytes.slice(0, count));
  }
  return Buffer.from(out);
}

function lzw(data: Uint8Array, early: number): Buffer {
  const out: number[] = [];
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let code = 0; code < 256; code += 1) table.push([code]);
    table.push([], []);
  };
  reset();
  let bits = 9;
  let buffer = 0;
  let count = 0;
  let previous: number[] | null = null;
  for (const byte of data) {
    buffer = (buffer << 8) | byte;
    count += 8;
    while (count >= bits) {
      const code = (buffer >>> (count - bits)) & ((1 << bits) - 1);
      count -= bits;
      if (code === 256) {
        reset();
        bits = 9;
        previous = null;
        continue;
      }
      if (code === 257) return Buffer.from(out);
      let entry = table[code];
      if (!entry) {
        if (!previous || code !== table.length) throw new HxPdfError("damaged", "A stream has bad LZW data.");
        entry = [...previous, previous[0] ?? 0];
      }
      for (const value of entry) out.push(value);
      if (out.length > HX_PDF_LIMITS.maxStreamBytes) throw new HxPdfError("too-large", "A stream unpacks too large.");
      if (previous) table.push([...previous, entry[0] ?? 0]);
      previous = entry;
      if (table.length + early >= 1 << bits && bits < 12) bits += 1;
    }
  }
  return Buffer.from(out);
}

function runLength(data: Uint8Array): Buffer {
  const out: number[] = [];
  let at = 0;
  while (at < data.length) {
    const length = data[at] ?? 128;
    at += 1;
    if (length === 128) break;
    if (length < 128) {
      for (let index = 0; index <= length && at < data.length; index += 1) out.push(data[at++] ?? 0);
    } else {
      const value = data[at++] ?? 0;
      for (let index = 0; index < 257 - length; index += 1) out.push(value);
    }
  }
  return Buffer.from(out);
}

function numberOf(value: PdfValue | undefined): number | null {
  return typeof value === "number" ? value : null;
}

// ---------------------------------------------------------------------------------------------- document

type XrefEntry = { type: 1; offset: number; gen: number } | { type: 2; stream: number; index: number };

export interface HxPdfPage {
  ref: PdfRef | null;
  dict: PdfDict;
  /** Values that the page takes from its ancestors in the page tree. */
  inherited: Map<string, PdfValue>;
}

/** A PDF read from its bytes. */
export class HxPdf {
  readonly bytes: Buffer;
  readonly version: string;
  readonly trailer: PdfDict;
  /** The xref was damaged and rebuilt by scanning the file. */
  readonly repaired: boolean;
  /** Where the last cross-reference section starts, and whether it is a stream. */
  readonly lastXref: { offset: number; stream: boolean } | null;
  readonly #xref: Map<number, XrefEntry>;
  readonly #cache = new Map<number, PdfValue>();
  readonly #objectStreams = new Map<number, { data: Buffer; offsets: Map<number, number> }>();
  readonly #loading = new Set<number>();

  private constructor(
    bytes: Buffer,
    version: string,
    trailer: PdfDict,
    xref: Map<number, XrefEntry>,
    repaired: boolean,
    lastXref: { offset: number; stream: boolean } | null,
  ) {
    this.bytes = bytes;
    this.version = version;
    this.trailer = trailer;
    this.#xref = xref;
    this.repaired = repaired;
    this.lastXref = lastXref;
  }

  static read(input: Uint8Array): HxPdf {
    const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    const head = bytes.indexOf("%PDF-", 0, "latin1");
    if (head < 0 || head > 1024) throw new HxPdfError("not-pdf", "The file is not a PDF.");
    const version = /^%PDF-(\d\.\d)/.exec(bytes.toString("latin1", head, head + 8))?.[1] ?? "1.4";
    let pdf: HxPdf | null = null;
    try {
      const { xref, trailer, last } = readXref(bytes);
      pdf = new HxPdf(bytes, version, trailer, xref, false, last);
      // An encrypted PDF's streams cannot be read here; it is only refused later.
      if (pdf.encrypted) return pdf;
      // The cross-reference must lead to a catalog with pages, or it is rebuilt.
      pdf.pages();
    } catch (error) {
      if (error instanceof HxPdfError && (error.code === "too-large" || error.code === "encrypted")) throw error;
      pdf = null;
    }
    if (pdf) return pdf;
    const { xref, trailer, seed } = rebuildXref(bytes);
    const repaired = new HxPdf(bytes, version, trailer, xref, true, null);
    for (const [num, value] of seed) repaired.#cache.set(num, value);
    if (!repaired.encrypted) repaired.pages();
    return repaired;
  }

  /** Whether the PDF is encrypted; such a PDF is read for its text only, never changed here. */
  get encrypted(): boolean {
    return this.trailer.has("Encrypt");
  }

  objectNumbers(): number[] {
    return [...this.#xref.keys()].sort((a, b) => a - b);
  }

  /** The generation of an object (0 for one in an object stream or not found). */
  generation(num: number): number {
    const entry = this.#xref.get(num);
    return entry?.type === 1 ? entry.gen : 0;
  }

  /** Every cross-reference entry, for an update that must stand alone (a repaired file). */
  xrefEntries(): [number, { type: 1; offset: number; gen: number } | { type: 2; stream: number; index: number }][] {
    return [...this.#xref.entries()];
  }

  /** The highest object number in use plus one. */
  get size(): number {
    let max = numberOf(this.trailer.get("Size")) ?? 0;
    for (const num of this.#xref.keys()) if (num + 1 > max) max = num + 1;
    return max;
  }

  /** An object by number; null for one that does not exist (as the PDF format says). */
  object(num: number): PdfValue {
    if (this.#cache.has(num)) return this.#cache.get(num) ?? null;
    const entry = this.#xref.get(num);
    if (!entry || this.#loading.has(num)) return null;
    this.#loading.add(num);
    try {
      let value: PdfValue = null;
      if (entry.type === 1) value = this.#parseAt(entry.offset, num);
      else value = this.#fromObjectStream(entry.stream, num);
      this.#cache.set(num, value);
      return value;
    } finally {
      this.#loading.delete(num);
    }
  }

  #parseAt(offset: number, num: number): PdfValue {
    const lexer = new Lexer(this.bytes, offset, (ref) => {
      const length = this.resolve(ref);
      return typeof length === "number" ? length : null;
    });
    lexer.skip();
    const found = lexer.word();
    lexer.skip();
    lexer.word();
    lexer.skip();
    const keyword = lexer.word();
    if (Number(found) !== num || keyword !== "obj")
      throw new HxPdfError("damaged", `Object ${num} is not where the PDF says.`);
    return lexer.value();
  }

  #fromObjectStream(streamNum: number, num: number): PdfValue {
    let parsed = this.#objectStreams.get(streamNum);
    if (!parsed) {
      const stream = this.object(streamNum);
      if (!(stream instanceof PdfStream)) return null;
      const data = this.decode(stream);
      const count = numberOf(stream.dict.get("N")) ?? 0;
      const first = numberOf(stream.dict.get("First")) ?? 0;
      const header = new Lexer(data, 0);
      const offsets = new Map<number, number>();
      for (let item = 0; item < count; item += 1) {
        header.skip();
        const objectNum = Number(header.word());
        header.skip();
        const objectOffset = Number(header.word());
        if (!Number.isInteger(objectNum) || !Number.isInteger(objectOffset)) break;
        // A later entry of the same number does not replace the first.
        if (!offsets.has(objectNum)) offsets.set(objectNum, first + objectOffset);
      }
      parsed = { data, offsets };
      this.#objectStreams.set(streamNum, parsed);
    }
    const at = parsed.offsets.get(num);
    return at === undefined ? null : new Lexer(parsed.data, at).value();
  }

  /** Follows references (a few steps at most) to the value they name. */
  resolve(value: PdfValue | undefined): PdfValue {
    let current: PdfValue | undefined = value;
    for (let step = 0; step < 32 && current instanceof PdfRef; step += 1) current = this.object(current.num);
    return current instanceof PdfRef ? null : (current ?? null);
  }

  dict(value: PdfValue | undefined): PdfDict | null {
    const resolved = this.resolve(value);
    if (resolved instanceof PdfDict) return resolved;
    if (resolved instanceof PdfStream) return resolved.dict;
    return null;
  }

  array(value: PdfValue | undefined): PdfValue[] {
    const resolved = this.resolve(value);
    return Array.isArray(resolved) ? resolved : [];
  }

  catalog(): PdfDict {
    const root = this.dict(this.trailer.get("Root"));
    if (!root) throw new HxPdfError("damaged", "The PDF has no catalog.");
    return root;
  }

  /** The decoded data of a stream. */
  decode(stream: PdfStream): Buffer {
    let data = Buffer.from(stream.raw.buffer, stream.raw.byteOffset, stream.raw.byteLength);
    const filter = this.resolve(stream.dict.get("Filter"));
    const filters = Array.isArray(filter) ? filter.map((item) => this.resolve(item)) : filter ? [filter] : [];
    const params = this.resolve(stream.dict.get("DecodeParms") ?? stream.dict.get("DP"));
    const paramList = Array.isArray(params) ? params.map((item) => this.dict(item)) : [this.dict(params)];
    for (const [index, item] of filters.entries()) {
      const name = pdfName(item);
      const parms = paramList[index] ?? null;
      if (name === "FlateDecode" || name === "Fl") data = unpredict(inflate(data), parms);
      else if (name === "ASCIIHexDecode" || name === "AHx") data = asciiHex(data);
      else if (name === "ASCII85Decode" || name === "A85") data = ascii85(data);
      else if (name === "LZWDecode" || name === "LZW")
        data = unpredict(lzw(data, numberOf(parms?.get("EarlyChange")) ?? 1), parms);
      else if (name === "RunLengthDecode" || name === "RL") data = runLength(data);
      else throw new HxPdfError("unsupported", `The PDF uses the ${name ?? "unknown"} filter here.`);
    }
    return data;
  }

  /** The pages in order, with the values each takes from the page tree. */
  pages(): HxPdfPage[] {
    const root = this.catalog().get("Pages");
    const found: HxPdfPage[] = [];
    const seen = new Set<number>();
    const stack: { node: PdfValue; inherited: Map<string, PdfValue> }[] = [
      { node: root ?? null, inherited: new Map() },
    ];
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
      const ref = item.node instanceof PdfRef ? item.node : null;
      if (ref) {
        if (seen.has(ref.num)) continue;
        seen.add(ref.num);
      }
      const dict = this.dict(item.node);
      if (!dict) continue;
      const kids = this.resolve(dict.get("Kids"));
      const type = pdfName(dict.get("Type"));
      if (type === "Pages" || (type !== "Page" && Array.isArray(kids))) {
        const inherited = new Map(item.inherited);
        for (const key of ["Resources", "MediaBox", "CropBox", "Rotate"]) {
          const value = dict.get(key);
          if (value !== undefined) inherited.set(key, value);
        }
        const list = Array.isArray(kids) ? kids : [];
        for (let index = list.length - 1; index >= 0; index -= 1) stack.push({ node: list[index] ?? null, inherited });
        continue;
      }
      found.push({ ref, dict, inherited: item.inherited });
      if (found.length > HX_PDF_LIMITS.maxPages) throw new HxPdfError("too-large", "The PDF has too many pages.");
    }
    if (found.length === 0) throw new HxPdfError("damaged", "The PDF has no pages.");
    return found;
  }

  /** The document information: title and producer, for the result summary. */
  info(): {
    title: string;
    author: string;
    pages: number;
    version: string;
    encrypted: boolean;
    form: boolean;
    signed: boolean;
  } {
    const info = this.dict(this.trailer.get("Info"));
    const text = (key: string) => {
      const value = this.resolve(info?.get(key));
      return value instanceof PdfString ? value.text() : "";
    };
    const form = this.dict(this.catalog().get("AcroForm"));
    const sigFlags = numberOf(this.resolve(form?.get("SigFlags"))) ?? 0;
    return {
      title: text("Title"),
      author: text("Author"),
      pages: this.pages().length,
      version: this.version,
      encrypted: this.encrypted,
      form: this.array(form?.get("Fields")).length > 0,
      signed: (sigFlags & 1) === 1,
    };
  }
}

function readXref(bytes: Buffer): {
  xref: Map<number, XrefEntry>;
  trailer: PdfDict;
  last: { offset: number; stream: boolean };
} {
  const tailStart = Math.max(0, bytes.length - 65_536);
  const at = bytes.lastIndexOf("startxref", bytes.length, "latin1");
  if (at < tailStart || at < 0) throw new HxPdfError("damaged", "The PDF has no startxref.");
  const lexer = new Lexer(bytes, at + 9);
  lexer.skip();
  const first = Number(lexer.word());
  if (!Number.isInteger(first) || first < 0 || first >= bytes.length) throw new HxPdfError("damaged", "Bad startxref.");
  const xref = new Map<number, XrefEntry>();
  let trailer: PdfDict | null = null;
  let last: { offset: number; stream: boolean } | null = null;
  const queue = [first];
  const visited = new Set<number>();
  for (let offset = queue.shift(); offset !== undefined; offset = queue.shift()) {
    if (visited.has(offset) || visited.size > 10_000) continue;
    visited.add(offset);
    const section = readSection(bytes, offset, xref);
    last ??= { offset, stream: section.stream };
    trailer ??= section.trailer;
    if (section.trailer.has("Encrypt") && trailer === section.trailer) {
      // Read the rest so that the text can still be read; changes refuse later.
    }
    const xrefStm = numberOf(section.trailer.get("XRefStm"));
    if (xrefStm !== null && !section.stream) queue.unshift(xrefStm);
    const previous = numberOf(section.trailer.get("Prev"));
    if (previous !== null) queue.push(previous);
  }
  if (!trailer || !last || !trailer.has("Root")) throw new HxPdfError("damaged", "The PDF trailer has no catalog.");
  return { xref, trailer, last };
}

/** Reads one cross-reference section; entries already known (from newer sections) stay. */
function readSection(
  bytes: Buffer,
  offset: number,
  xref: Map<number, XrefEntry>,
): { trailer: PdfDict; stream: boolean } {
  const lexer = new Lexer(bytes, offset);
  lexer.skip();
  const save = lexer.pos;
  if (lexer.word() === "xref") {
    for (;;) {
      lexer.skip();
      const save2 = lexer.pos;
      const word = lexer.word();
      if (word === "trailer") break;
      if (!INTEGER.test(word)) {
        lexer.pos = save2;
        throw new HxPdfError("damaged", "Bad xref table.");
      }
      lexer.skip();
      const count = Number(lexer.word());
      if (!Number.isInteger(count) || count < 0 || count > HX_PDF_LIMITS.maxObjects)
        throw new HxPdfError("damaged", "Bad xref subsection.");
      let num = Number(word);
      for (let index = 0; index < count; index += 1, num += 1) {
        lexer.skip();
        const where = Number(lexer.word());
        lexer.skip();
        const gen = Number(lexer.word());
        lexer.skip();
        const kind = lexer.word();
        if (kind !== "n" && kind !== "f") throw new HxPdfError("damaged", "Bad xref entry.");
        // Some writers number the first subsection from 1 although it holds object 0.
        if (index === 0 && num === 1 && kind === "f" && where === 0 && gen === 65_535) num = 0;
        if (kind === "n" && where > 0 && !xref.has(num)) xref.set(num, { type: 1, offset: where, gen });
      }
    }
    const trailer = lexer.value();
    if (!(trailer instanceof PdfDict)) throw new HxPdfError("damaged", "Bad trailer.");
    return { trailer, stream: false };
  }
  lexer.pos = save;
  lexer.word();
  lexer.skip();
  lexer.word();
  lexer.skip();
  if (lexer.word() !== "obj") throw new HxPdfError("damaged", "startxref does not point at a cross-reference.");
  const stream = lexer.value();
  if (!(stream instanceof PdfStream) || pdfName(stream.dict.get("Type")) !== "XRef")
    throw new HxPdfError("damaged", "startxref does not point at a cross-reference stream.");
  const dict = stream.dict;
  const wValue = dict.get("W");
  const widths = Array.isArray(wValue) ? wValue.map((item) => numberOf(item) ?? 0) : [];
  if (widths.length < 3) throw new HxPdfError("damaged", "Bad cross-reference stream widths.");
  const [w0 = 0, w1 = 0, w2 = 0] = widths;
  const entrySize = w0 + w1 + w2;
  if (entrySize <= 0 || entrySize > 32) throw new HxPdfError("damaged", "Bad cross-reference stream widths.");
  const size = numberOf(dict.get("Size")) ?? 0;
  const indexValue = dict.get("Index");
  const index = Array.isArray(indexValue) ? indexValue.map((item) => numberOf(item) ?? 0) : [0, size];
  const data = decodePlain(stream);
  const field = (at: number, width: number, fallback: number) => {
    if (width === 0) return fallback;
    let value = 0;
    for (let i = 0; i < width; i += 1) value = value * 256 + (data[at + i] ?? 0);
    return value;
  };
  let at = 0;
  for (let pair = 0; pair + 1 < index.length; pair += 2) {
    const start = index[pair] ?? 0;
    const count = index[pair + 1] ?? 0;
    if (count < 0 || count > HX_PDF_LIMITS.maxObjects) throw new HxPdfError("damaged", "Bad cross-reference index.");
    for (let item = 0; item < count; item += 1, at += entrySize) {
      if (at + entrySize > data.length) break;
      const type = field(at, w0, 1);
      const second = field(at + w0, w1, 0);
      const third = field(at + w0 + w1, w2, 0);
      const num = start + item;
      if (xref.has(num)) continue;
      if (type === 1 && second > 0) xref.set(num, { type: 1, offset: second, gen: third });
      else if (type === 2) xref.set(num, { type: 2, stream: second, index: third });
    }
  }
  return { trailer: dict, stream: true };
}

/** Decodes a cross-reference stream: its filters cannot use references (there is no xref yet). */
function decodePlain(stream: PdfStream): Buffer {
  const filter = stream.dict.get("Filter");
  const filters = Array.isArray(filter) ? filter : filter ? [filter] : [];
  const params = stream.dict.get("DecodeParms");
  const paramList = Array.isArray(params) ? params : [params ?? null];
  let data = Buffer.from(stream.raw.buffer, stream.raw.byteOffset, stream.raw.byteLength);
  for (const [index, item] of filters.entries()) {
    const name = pdfName(item);
    const parms = paramList[index];
    const dict = parms instanceof PdfDict ? parms : null;
    if (name === "FlateDecode" || name === "Fl") data = unpredict(inflate(data), dict);
    else if (name === "ASCIIHexDecode" || name === "AHx") data = asciiHex(data);
    else if (name === "ASCII85Decode" || name === "A85") data = ascii85(data);
    else throw new HxPdfError("unsupported", "The cross-reference stream uses an unknown filter.");
  }
  return data;
}

/** Rebuilds the cross-reference by finding every "n g obj" in the file. The last one of a number wins. */
function rebuildXref(bytes: Buffer): { xref: Map<number, XrefEntry>; trailer: PdfDict; seed: Map<number, PdfValue> } {
  const text = bytes.toString("latin1");
  const xref = new Map<number, XrefEntry>();
  const pattern = /(?:^|[\r\n\s])(\d{1,10})\s+(\d{1,5})\s+obj\b/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const num = Number(match[1]);
    const start = match.index + match[0].indexOf(match[1] ?? "");
    xref.set(num, { type: 1, offset: start, gen: Number(match[2]) });
    if (xref.size > HX_PDF_LIMITS.maxObjects) throw new HxPdfError("too-large", "The PDF has too many objects.");
  }
  // Objects inside object streams, where no direct object of that number exists.
  const probe = new XrefProbe(bytes, xref);
  for (const [num] of [...xref]) {
    const value = probe.at(num);
    if (!(value instanceof PdfStream) || pdfName(value.dict.get("Type")) !== "ObjStm") continue;
    const count = numberOf(value.dict.get("N")) ?? 0;
    let data: Buffer;
    try {
      data = decodePlain(value);
    } catch {
      continue;
    }
    const header = new Lexer(data, 0);
    for (let index = 0; index < count; index += 1) {
      header.skip();
      const objectNum = Number(header.word());
      header.skip();
      header.word();
      if (!Number.isInteger(objectNum)) break;
      if (!xref.has(objectNum)) xref.set(objectNum, { type: 2, stream: num, index });
    }
  }
  let trailer: PdfDict | null = null;
  for (let at = text.lastIndexOf("trailer"); at >= 0 && !trailer; at = text.lastIndexOf("trailer", at - 1)) {
    try {
      const value = new Lexer(bytes, at + 7).value();
      if (value instanceof PdfDict && value.has("Root")) trailer = value;
    } catch {
      // Try an earlier one.
    }
  }
  if (!trailer) {
    // A file with cross-reference streams only: a stream dictionary carries the trailer keys.
    for (const [num] of xref) {
      const value = probe.at(num);
      if (value instanceof PdfStream && pdfName(value.dict.get("Type")) === "XRef" && value.dict.has("Root")) {
        trailer = value.dict;
      }
    }
  }
  if (!trailer) {
    for (const [num] of xref) {
      const value = probe.at(num);
      if (value instanceof PdfDict && pdfName(value.get("Type")) === "Catalog") {
        trailer = new PdfDict();
        trailer.set("Root", new PdfRef(num, 0));
      }
    }
  }
  const seed = new Map<number, PdfValue>();
  if (!trailer) {
    // The catalog is lost (a cut-off file): a page tree root still gives the pages that survive.
    for (const [num] of xref) {
      const value = probe.at(num);
      if (value instanceof PdfDict && pdfName(value.get("Type")) === "Pages" && !value.has("Parent")) {
        const catalogNum = Math.max(...xref.keys()) + 1;
        const catalog = new PdfDict();
        catalog.set("Type", new PdfName("Catalog"));
        catalog.set("Pages", new PdfRef(num, 0));
        seed.set(catalogNum, catalog);
        trailer = new PdfDict();
        trailer.set("Root", new PdfRef(catalogNum, 0));
        break;
      }
    }
  }
  if (!trailer) {
    // The page tree is lost too: the page objects that survive, in object order.
    const kids: PdfRef[] = [];
    for (const [num] of [...xref].sort((a, b) => a[0] - b[0])) {
      const value = probe.at(num);
      if (value instanceof PdfDict && pdfName(value.get("Type")) === "Page") kids.push(new PdfRef(num, 0));
    }
    if (kids.length > 0) {
      const base = Math.max(...xref.keys()) + 1;
      const pages = new PdfDict();
      pages.set("Type", new PdfName("Pages"));
      pages.set("Kids", kids);
      pages.set("Count", kids.length);
      const catalog = new PdfDict();
      catalog.set("Type", new PdfName("Catalog"));
      catalog.set("Pages", new PdfRef(base, 0));
      seed.set(base, pages);
      seed.set(base + 1, catalog);
      trailer = new PdfDict();
      trailer.set("Root", new PdfRef(base + 1, 0));
    }
  }
  if (!trailer) throw new HxPdfError("damaged", "The PDF is too damaged to read: it has no pages.");
  return { xref, trailer, seed };
}

/** Reads direct objects while the cross-reference is rebuilt. */
class XrefProbe {
  readonly #bytes: Buffer;
  readonly #xref: Map<number, XrefEntry>;

  constructor(bytes: Buffer, xref: Map<number, XrefEntry>) {
    this.#bytes = bytes;
    this.#xref = xref;
  }

  at(num: number): PdfValue {
    const entry = this.#xref.get(num);
    if (entry?.type !== 1) return null;
    try {
      const lexer = new Lexer(this.#bytes, entry.offset);
      lexer.skip();
      lexer.word();
      lexer.skip();
      lexer.word();
      lexer.skip();
      lexer.word();
      return lexer.value();
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------------------------- writer

function nameText(value: string): string {
  let out = "/";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index) & 0xff;
    if (code < 0x21 || code > 0x7e || DELIMITER[code] || code === 0x23) out += `#${code.toString(16).padStart(2, "0")}`;
    else out += value[index];
  }
  return out;
}

function stringText(value: PdfString): string {
  const b = value.bytes;
  let plain = true;
  for (const code of b) {
    if (code < 0x20 || code > 0x7e) {
      plain = false;
      break;
    }
  }
  if (!plain) return `<${Buffer.from(b).toString("hex")}>`;
  return `(${Buffer.from(b)
    .toString("latin1")
    .replace(/[()\\]/g, (char) => `\\${char}`)})`;
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return Object.is(value, -0) ? "0" : String(value);
  const fixed = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return fixed === "-0" ? "0" : fixed;
}

/** The PDF text of a value; a stream's dictionary only (its data is written by the caller). */
export function pdfText(value: PdfValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return numberText(value);
  if (value instanceof PdfName) return nameText(value.value);
  if (value instanceof PdfString) return stringText(value);
  if (value instanceof PdfRef) return `${value.num} ${value.gen} R`;
  if (Array.isArray(value)) return `[${value.map(pdfText).join(" ")}]`;
  const dict = value instanceof PdfStream ? value.dict : value;
  const parts: string[] = [];
  for (const [key, item] of dict.map) {
    if (value instanceof PdfStream && key === "Length") continue;
    parts.push(`${nameText(key)} ${pdfText(item)}`);
  }
  if (value instanceof PdfStream) parts.push(`/Length ${value.raw.length}`);
  return `<<${parts.join(" ")}>>`;
}

function objectBytes(num: number, gen: number, value: PdfValue): Buffer[] {
  if (value instanceof PdfStream) {
    return [
      Buffer.from(`${num} ${gen} obj\n${pdfText(value)}\nstream\n`, "latin1"),
      Buffer.from(value.raw.buffer, value.raw.byteOffset, value.raw.byteLength),
      Buffer.from("\nendstream\nendobj\n", "latin1"),
    ];
  }
  return [Buffer.from(`${num} ${gen} obj\n${pdfText(value)}\nendobj\n`, "latin1")];
}

/** A new PDF built object by object. */
export class HxPdfWriter {
  readonly #objects: (PdfValue | undefined)[] = [undefined];

  alloc(): number {
    this.#objects.push(undefined);
    if (this.#objects.length > HX_PDF_LIMITS.maxObjects)
      throw new HxPdfError("too-large", "The new PDF would have too many objects.");
    return this.#objects.length - 1;
  }

  set(num: number, value: PdfValue): void {
    this.#objects[num] = value;
  }

  get(num: number): PdfValue | undefined {
    return this.#objects[num];
  }

  add(value: PdfValue): PdfRef {
    const num = this.alloc();
    this.set(num, value);
    return new PdfRef(num, 0);
  }

  toBytes(root: PdfRef, info: PdfRef | null): Buffer {
    const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    let length = chunks[0]?.length ?? 0;
    const offsets: number[] = [0];
    for (let num = 1; num < this.#objects.length; num += 1) {
      offsets.push(length);
      for (const chunk of objectBytes(num, 0, this.#objects[num] ?? null)) {
        chunks.push(chunk);
        length += chunk.length;
      }
    }
    const xref = [`xref\n0 ${this.#objects.length}\n0000000000 65535 f\r\n`];
    for (let num = 1; num < this.#objects.length; num += 1)
      xref.push(`${String(offsets[num] ?? 0).padStart(10, "0")} 00000 n\r\n`);
    const id = randomBytes(16).toString("hex");
    const trailer = new PdfDict();
    trailer.set("Size", this.#objects.length);
    trailer.set("Root", root);
    if (info) trailer.set("Info", info);
    trailer.set("ID", [new PdfString(Buffer.from(id, "hex")), new PdfString(Buffer.from(id, "hex"))]);
    chunks.push(Buffer.from(`${xref.join("")}trailer\n${pdfText(trailer)}\nstartxref\n${length}\n%%EOF\n`, "latin1"));
    return Buffer.concat(chunks);
  }
}

// ---------------------------------------------------------------------------------------------- pages

/** Reads "1-3,5,8-" (from 1) into page indexes (from 0) in that order. */
export function parsePageRanges(spec: string, count: number): number[] {
  const pages: number[] = [];
  const text = spec
    .replace(/\s+/g, "")
    .replace(/[，、]/g, ",")
    .replace(/[–—~～到至]/g, "-");
  if (text === "" || text === "all" || text === "全部") return Array.from({ length: count }, (_, index) => index);
  for (const part of text.split(",")) {
    if (part === "") continue;
    const match = /^(\d+|last)?(?:-(\d+|last)?)?$/.exec(part);
    if (!match) throw new HxPdfError("invalid", `"${part}" is not a page or page range.`);
    const number = (value: string | undefined, fallback: number) =>
      value === undefined ? fallback : value === "last" ? count : Number(value);
    const from = number(match[1], 1);
    const to = part.includes("-") ? number(match[2], count) : from;
    if (from < 1 || to < 1 || from > count || to > count)
      throw new HxPdfError("invalid", `The PDF has ${count} pages; "${part}" is outside them.`);
    if (from <= to) for (let page = from; page <= to; page += 1) pages.push(page - 1);
    else for (let page = from; page >= to; page -= 1) pages.push(page - 1);
  }
  if (pages.length === 0) throw new HxPdfError("invalid", "No pages were chosen.");
  return pages;
}

/** Copies objects of one source PDF into a writer, cutting references to pages that are not copied. */
class PdfCopier {
  readonly #pdf: HxPdf;
  readonly #out: HxPdfWriter;
  readonly #pageNums: Set<number>;
  readonly #pageMap: Map<number, number>;
  readonly #map = new Map<number, number>();
  readonly #queue: [number, number][] = [];

  constructor(pdf: HxPdf, out: HxPdfWriter, pageNums: Set<number>, pageMap: Map<number, number>) {
    this.#pdf = pdf;
    this.#out = out;
    this.#pageNums = pageNums;
    this.#pageMap = pageMap;
  }

  ref(ref: PdfRef): PdfValue {
    if (this.#pageNums.has(ref.num)) {
      const mapped = this.#pageMap.get(ref.num);
      return mapped === undefined ? null : new PdfRef(mapped, 0);
    }
    let num = this.#map.get(ref.num);
    if (num === undefined) {
      num = this.#out.alloc();
      this.#map.set(ref.num, num);
      this.#queue.push([ref.num, num]);
    }
    return new PdfRef(num, 0);
  }

  value(value: PdfValue): PdfValue {
    if (value instanceof PdfRef) return this.ref(value);
    if (Array.isArray(value)) return value.map((item) => this.value(item));
    if (value instanceof PdfDict) return this.dict(value);
    if (value instanceof PdfStream) return new PdfStream(this.dict(value.dict), value.raw);
    return value;
  }

  dict(dict: PdfDict, skip: readonly string[] = []): PdfDict {
    const copy = new PdfDict();
    for (const [key, item] of dict.map) if (!skip.includes(key)) copy.set(key, this.value(item));
    return copy;
  }

  /** Copies everything queued so far, and what that reaches. */
  run(): void {
    for (let item = this.#queue.shift(); item !== undefined; item = this.#queue.shift()) {
      const [from, to] = item;
      this.#out.set(to, this.value(this.#pdf.object(from)));
    }
  }
}

export interface HxPdfSource {
  pdf: HxPdf;
  /** Page indexes (from 0) in the order wanted. */
  pages: number[];
  /** A bookmark title for the first page of this source in a merged PDF. */
  title?: string;
}

/**
 * Builds a new PDF from pages of one or more PDFs: an extract or split when there is one source, a merge
 * when there are several. Form fields on the copied pages come with them (a second field of the same name
 * is renamed name_2). Bookmarks: one per source when `bookmarks` is set. Signatures do not stay valid.
 */
export function hxPdfCopyPages(sources: HxPdfSource[], options: { bookmarks?: boolean; title?: string } = {}): Buffer {
  if (sources.length === 0) throw new HxPdfError("invalid", "No PDF was given.");
  const out = new HxPdfWriter();
  const pagesNum = out.alloc();
  const kids: PdfRef[] = [];
  const fields: PdfRef[] = [];
  const fieldNames = new Set<string>();
  let acroDr: PdfDict | null = null;
  let acroDa: PdfValue | undefined;
  let needAppearances = false;
  const firstPages: { title: string; page: PdfRef }[] = [];
  const renames: { ref: PdfRef; name: string }[] = [];
  for (const [sourceIndex, source] of sources.entries()) {
    const pdf = source.pdf;
    if (pdf.encrypted)
      throw new HxPdfError("encrypted", "An encrypted PDF is not changed here. Remove its password first.");
    const pages = pdf.pages();
    const pageNums = new Set<number>();
    for (const page of pages) if (page.ref) pageNums.add(page.ref.num);
    const pageMap = new Map<number, number>();
    const chosen: { page: HxPdfPage; num: number }[] = [];
    const used = new Set<number>();
    for (const index of source.pages) {
      const page = pages[index];
      if (!page) throw new HxPdfError("invalid", `The PDF has ${pages.length} pages; there is no page ${index + 1}.`);
      const num = out.alloc();
      // The same page chosen twice is copied twice; links point at its first copy.
      if (page.ref && !used.has(page.ref.num)) {
        pageMap.set(page.ref.num, num);
        used.add(page.ref.num);
      }
      chosen.push({ page, num });
    }
    const copier = new PdfCopier(pdf, out, pageNums, pageMap);
    let copiedDr: PdfDict | null = null;
    for (const { page, num } of chosen) {
      const dict = copier.dict(page.dict, ["Parent", "B", "StructParents"]);
      for (const [key, value] of page.inherited) if (!dict.has(key)) dict.set(key, copier.value(value));
      dict.set("Type", new PdfName("Page"));
      dict.set("Parent", new PdfRef(pagesNum, 0));
      if (!dict.has("MediaBox")) dict.set("MediaBox", [0, 0, 612, 792]);
      if (!dict.has("Resources")) dict.set("Resources", new PdfDict());
      out.set(num, dict);
      kids.push(new PdfRef(num, 0));
    }
    const first = chosen[0];
    if (first) firstPages.push({ title: source.title ?? `PDF ${sourceIndex + 1}`, page: new PdfRef(first.num, 0) });
    // Form fields with a widget on a copied page.
    const form = pdf.dict(pdf.catalog().get("AcroForm"));
    if (form) {
      const annots = new Set<number>();
      for (const { page } of chosen)
        for (const annot of pdf.array(page.dict.get("Annots"))) if (annot instanceof PdfRef) annots.add(annot.num);
      for (const field of pdf.array(form.get("Fields"))) {
        if (!(field instanceof PdfRef) || !fieldReaches(pdf, field, annots)) continue;
        const copied = copier.ref(field);
        if (!(copied instanceof PdfRef)) continue;
        fields.push(copied);
        const name = pdf.dict(field)?.get("T");
        const text = name instanceof PdfString ? name.text() : "";
        if (text !== "") {
          let unique = text;
          for (let n = 2; fieldNames.has(unique); n += 1) unique = `${text}_${n}`;
          fieldNames.add(unique);
          if (unique !== text) renames.push({ ref: copied, name: unique });
        }
      }
      const dr = pdf.dict(form.get("DR"));
      if (dr) copiedDr = copier.dict(dr);
      acroDa ??= form.get("DA") === undefined ? undefined : copier.value(pdf.resolve(form.get("DA")));
      if (pdf.resolve(form.get("NeedAppearances")) === true) needAppearances = true;
    }
    copier.run();
    // The resources are merged once the objects they name are copied.
    if (copiedDr) {
      if (!acroDr) acroDr = copiedDr;
      else mergeResources(out, acroDr, copiedDr);
    }
    for (const { ref, name } of renames.splice(0)) {
      const field = out.get(ref.num);
      if (field instanceof PdfDict) field.set("T", PdfString.text(name));
    }
  }
  const pagesDict = new PdfDict();
  pagesDict.set("Type", new PdfName("Pages"));
  pagesDict.set("Kids", kids);
  pagesDict.set("Count", kids.length);
  out.set(pagesNum, pagesDict);
  const catalog = new PdfDict();
  catalog.set("Type", new PdfName("Catalog"));
  catalog.set("Pages", new PdfRef(pagesNum, 0));
  if (fields.length > 0) {
    const form = new PdfDict();
    form.set("Fields", fields);
    if (acroDr) form.set("DR", acroDr);
    if (acroDa !== undefined) form.set("DA", acroDa);
    if (needAppearances) form.set("NeedAppearances", true);
    catalog.set("AcroForm", form);
  }
  if (options.bookmarks && firstPages.length > 0) catalog.set("Outlines", outline(out, firstPages));
  if (options.bookmarks) catalog.set("PageMode", new PdfName("UseOutlines"));
  const info = new PdfDict();
  info.set("Producer", PdfString.text("HXBot"));
  if (options.title) info.set("Title", PdfString.text(options.title));
  return out.toBytes(out.add(catalog), out.add(info));
}

function fieldReaches(pdf: HxPdf, field: PdfRef, annots: Set<number>): boolean {
  const stack: PdfValue[] = [field];
  const seen = new Set<number>();
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    if (item instanceof PdfRef) {
      if (annots.has(item.num)) return true;
      if (seen.has(item.num)) continue;
      seen.add(item.num);
    }
    for (const kid of pdf.array(pdf.dict(item)?.get("Kids"))) stack.push(kid);
  }
  return false;
}

function mergeResources(out: HxPdfWriter, into: PdfDict, from: PdfDict): void {
  for (const [key, value] of from.map) {
    const target = into.get(key);
    const targetDict = target instanceof PdfRef ? out.get(target.num) : target;
    const sourceDict = value instanceof PdfRef ? out.get(value.num) : value;
    if (!(targetDict instanceof PdfDict) || !(sourceDict instanceof PdfDict)) {
      if (!into.has(key)) into.set(key, value);
      continue;
    }
    for (const [name, item] of sourceDict.map) if (!targetDict.has(name)) targetDict.set(name, item);
  }
}

function outline(out: HxPdfWriter, items: { title: string; page: PdfRef }[]): PdfRef {
  const rootNum = out.alloc();
  const nums = items.map(() => out.alloc());
  for (const [index, item] of items.entries()) {
    const dict = new PdfDict();
    dict.set("Title", PdfString.text(item.title));
    dict.set("Parent", new PdfRef(rootNum, 0));
    dict.set("Dest", [item.page, new PdfName("Fit")]);
    const previous = nums[index - 1];
    const next = nums[index + 1];
    if (previous !== undefined) dict.set("Prev", new PdfRef(previous, 0));
    if (next !== undefined) dict.set("Next", new PdfRef(next, 0));
    out.set(nums[index] ?? 0, dict);
  }
  const root = new PdfDict();
  root.set("Type", new PdfName("Outlines"));
  root.set("First", new PdfRef(nums[0] ?? 0, 0));
  root.set("Last", new PdfRef(nums.at(-1) ?? 0, 0));
  root.set("Count", items.length);
  out.set(rootNum, root);
  return new PdfRef(rootNum, 0);
}

// ---------------------------------------------------------------------------------------------- forms

export interface HxPdfField {
  name: string;
  type: "text" | "checkbox" | "radio" | "choice" | "signature" | "button";
  value: string;
  /** The values a checkbox, radio group or list can take. */
  options: string[];
  /** What a list shows for each option, when it differs from the value stored (else the same as options). */
  labels: string[];
  readOnly: boolean;
  required: boolean;
  multiline: boolean;
  maxLength: number | null;
  /** Pages (from 1) that show the field. */
  pages: number[];
}

interface FieldNode {
  ref: PdfRef;
  dict: PdfDict;
  name: string;
  type: string | null;
  flags: number;
  widgets: { ref: PdfRef | null; dict: PdfDict; owner: number }[];
  /** Object numbers that hold this field's dictionary. */
  owner: number;
}

function fieldNodes(pdf: HxPdf): FieldNode[] {
  const form = pdf.dict(pdf.catalog().get("AcroForm"));
  if (!form) return [];
  const nodes: FieldNode[] = [];
  const seen = new Set<number>();
  const stack: { ref: PdfValue; prefix: string; type: string | null; flags: number }[] = pdf
    .array(form.get("Fields"))
    .map((ref) => ({ ref, prefix: "", type: null, flags: 0 }))
    .reverse();
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    if (!(item.ref instanceof PdfRef) || seen.has(item.ref.num)) continue;
    seen.add(item.ref.num);
    const dict = pdf.dict(item.ref);
    if (!dict) continue;
    const t = pdf.resolve(dict.get("T"));
    const part = t instanceof PdfString ? t.text() : "";
    const name = part === "" ? item.prefix : item.prefix === "" ? part : `${item.prefix}.${part}`;
    const type = pdfName(pdf.resolve(dict.get("FT"))) ?? item.type;
    const flags = numberOf(pdf.resolve(dict.get("Ff"))) ?? item.flags;
    const kids = pdf.array(dict.get("Kids"));
    const fieldKids = kids.filter((kid) => pdf.dict(kid)?.has("T"));
    if (fieldKids.length > 0) {
      for (let index = kids.length - 1; index >= 0; index -= 1)
        stack.push({ ref: kids[index] ?? null, prefix: name, type, flags });
      continue;
    }
    const widgets: FieldNode["widgets"] = [];
    if (kids.length === 0) widgets.push({ ref: item.ref, dict, owner: item.ref.num });
    for (const kid of kids) {
      const kidDict = pdf.dict(kid);
      if (kidDict)
        widgets.push({
          ref: kid instanceof PdfRef ? kid : null,
          dict: kidDict,
          owner: kid instanceof PdfRef ? kid.num : item.ref.num,
        });
    }
    nodes.push({ ref: item.ref, dict, name, type, flags, widgets, owner: item.ref.num });
  }
  return nodes;
}

function onStates(pdf: HxPdf, widget: PdfDict): string[] {
  const normal = pdf.dict(pdf.dict(widget.get("AP"))?.get("N"));
  return normal ? [...normal.map.keys()].filter((key) => key !== "Off") : [];
}

function fieldKind(node: FieldNode): HxPdfField["type"] {
  if (node.type === "Tx") return "text";
  if (node.type === "Ch") return "choice";
  if (node.type === "Sig") return "signature";
  if (node.type === "Btn") {
    if (node.flags & (1 << 16)) return "button";
    if (node.flags & (1 << 15)) return "radio";
    return "checkbox";
  }
  return "text";
}

function valueText(pdf: HxPdf, value: PdfValue | undefined): string {
  const resolved = pdf.resolve(value);
  if (resolved instanceof PdfString) return resolved.text();
  if (resolved instanceof PdfName) return resolved.value;
  if (Array.isArray(resolved)) return resolved.map((item) => valueText(pdf, item)).join(", ");
  if (typeof resolved === "number") return String(resolved);
  return "";
}

function inheritedValue(pdf: HxPdf, dict: PdfDict, key: string): PdfValue | undefined {
  let current: PdfDict | null = dict;
  for (let step = 0; current && step < 64; step += 1) {
    if (current.has(key)) return current.get(key);
    current = pdf.dict(current.get("Parent"));
  }
  return undefined;
}

/** The options of a list: the value stored for each, and the text it shows ([export, display] pairs). */
function choiceOptions(pdf: HxPdf, node: FieldNode): { value: string; label: string }[] {
  return pdf.array(inheritedValue(pdf, node.dict, "Opt")).map((item) => {
    const resolved = pdf.resolve(item);
    if (!Array.isArray(resolved)) {
      const text = valueText(pdf, resolved);
      return { value: text, label: text };
    }
    return { value: valueText(pdf, resolved[0]), label: valueText(pdf, resolved[1] ?? resolved[0]) };
  });
}

/** The fields of the PDF's form, by full name. */
export function hxPdfFields(pdf: HxPdf): HxPdfField[] {
  const pageOf = new Map<number, number>();
  for (const [index, page] of pdf.pages().entries())
    for (const annot of pdf.array(page.dict.get("Annots")))
      if (annot instanceof PdfRef) pageOf.set(annot.num, index + 1);
  return fieldNodes(pdf).map((node) => {
    const kind = fieldKind(node);
    let options: string[] = [];
    let labels: string[] = [];
    if (kind === "checkbox" || kind === "radio") {
      options = [...new Set(node.widgets.flatMap((widget) => onStates(pdf, widget.dict)))];
      labels = options;
    } else if (kind === "choice") {
      const choices = choiceOptions(pdf, node);
      options = choices.map((choice) => choice.value);
      labels = choices.map((choice) => choice.label);
    }
    const maxLength = numberOf(pdf.resolve(inheritedValue(pdf, node.dict, "MaxLen")));
    return {
      name: node.name,
      type: kind,
      value: valueText(pdf, inheritedValue(pdf, node.dict, "V")),
      options,
      labels,
      readOnly: (node.flags & 1) === 1,
      required: (node.flags & 2) === 2,
      multiline: kind === "text" && (node.flags & (1 << 12)) !== 0,
      maxLength,
      pages: [
        ...new Set(
          node.widgets.map((widget) => (widget.ref ? (pageOf.get(widget.ref.num) ?? 0) : 0)).filter((page) => page > 0),
        ),
      ],
    };
  });
}

/**
 * Fills form fields and returns the PDF with the changes appended (an incremental update): the original
 * bytes stay first and unchanged, so earlier signatures still cover what they covered. Values: text for
 * text fields and lists, an on-state (or true/false) for checkboxes, an option for radio groups.
 */
export function hxPdfFill(pdf: HxPdf, values: Record<string, string | boolean>): { bytes: Buffer; filled: string[] } {
  if (pdf.encrypted)
    throw new HxPdfError("encrypted", "An encrypted PDF is not changed here. Remove its password first.");
  const catalog = pdf.catalog();
  const form = pdf.dict(catalog.get("AcroForm"));
  if (!form) throw new HxPdfError("invalid", "The PDF has no form.");
  const perms = pdf.dict(catalog.get("Perms"));
  if (perms?.has("DocMDP")) {
    const sig = pdf.dict(perms.get("DocMDP"));
    const reference = pdf.array(sig?.get("Reference")).map((item) => pdf.dict(item));
    const p = reference
      .map((item) => numberOf(pdf.resolve(pdf.dict(item?.get("TransformParams"))?.get("P"))))
      .find((item) => item !== null);
    if (p === 1)
      throw new HxPdfError(
        "unsupported",
        "The PDF is certified so that no change is allowed, not even filling in its form.",
      );
  }
  const nodes = new Map(fieldNodes(pdf).map((node) => [node.name, node]));
  const dirty = new Set<number>();
  const filled: string[] = [];
  for (const [name, wanted] of Object.entries(values)) {
    const node = nodes.get(name);
    if (!node)
      throw new HxPdfError(
        "invalid",
        `The form has no field named ${name}. Fields: ${[...nodes.keys()].slice(0, 50).join(", ")}`,
      );
    const kind = fieldKind(node);
    if (node.flags & 1) throw new HxPdfError("invalid", `The field ${name} is read-only.`);
    if (kind === "signature" || kind === "button")
      throw new HxPdfError("unsupported", `The field ${name} is a ${kind} and is not filled here.`);
    if (kind === "checkbox" || kind === "radio") {
      const states = [...new Set(node.widgets.flatMap((widget) => onStates(pdf, widget.dict)))];
      const on =
        wanted === true || wanted === "true" || wanted === "是" || wanted === "yes"
          ? (states[0] ?? "Yes")
          : wanted === false || wanted === "false" || wanted === "否" || wanted === "no" || wanted === "Off"
            ? "Off"
            : String(wanted);
      if (on !== "Off" && !states.includes(on))
        throw new HxPdfError("invalid", `The field ${name} takes one of: ${states.join(", ")}, or Off.`);
      node.dict.set("V", new PdfName(on));
      dirty.add(node.owner);
      for (const widget of node.widgets) {
        widget.dict.set("AS", new PdfName(onStates(pdf, widget.dict).includes(on) ? on : "Off"));
        dirty.add(widget.owner);
      }
    } else {
      let text = String(wanted);
      const maxLength = numberOf(pdf.resolve(inheritedValue(pdf, node.dict, "MaxLen")));
      if (maxLength !== null && text.length > maxLength)
        throw new HxPdfError("invalid", `The field ${name} takes at most ${maxLength} characters.`);
      let index = -1;
      if (kind === "choice") {
        // An option by the value it stores or by the text it shows; the value is what goes into the field.
        const options = choiceOptions(pdf, node);
        index = options.findIndex((option) => option.value === text);
        if (index < 0) index = options.findIndex((option) => option.label === text);
        const editable = (node.flags & (1 << 18)) !== 0;
        if (options.length > 0 && index < 0 && !editable)
          throw new HxPdfError(
            "invalid",
            `The field ${name} takes one of: ${options.map((option) => (option.label === option.value ? option.value : `${option.label} (${option.value})`)).join(", ")}.`,
          );
        if (index >= 0) text = options[index]?.value ?? text;
      }
      node.dict.set("V", PdfString.text(text));
      if (kind === "choice") {
        // Viewers show the selected index (/I) before the value: keep it in step.
        if (index >= 0) node.dict.set("I", [index]);
        else node.dict.delete("I");
      }
      dirty.add(node.owner);
      // The old look shows the old value: drop it, and let the viewer draw the new one.
      for (const widget of node.widgets) {
        if (widget.dict.has("AP")) {
          widget.dict.delete("AP");
          dirty.add(widget.owner);
        }
      }
    }
    filled.push(name);
  }
  form.set("NeedAppearances", true);
  // A dynamic XFA form would show its own data instead of these fields.
  form.delete("XFA");
  const formRef = catalog.get("AcroForm");
  const rootRef = pdf.trailer.get("Root");
  if (formRef instanceof PdfRef) dirty.add(formRef.num);
  else if (rootRef instanceof PdfRef) dirty.add(rootRef.num);
  return { bytes: incrementalUpdate(pdf, dirty), filled };
}

/**
 * Appends new versions of the given objects, a cross-reference for them, and a trailer. A file whose
 * cross-reference was rebuilt gets a cross-reference stream that lists every object, so it stands alone.
 */
function incrementalUpdate(pdf: HxPdf, nums: Set<number>): Buffer {
  const chunks: Buffer[] = [pdf.bytes];
  let length = pdf.bytes.length;
  const tail = pdf.bytes[pdf.bytes.length - 1];
  if (tail !== 10 && tail !== 13) {
    chunks.push(Buffer.from("\n"));
    length += 1;
  }
  const written = new Map<number, { offset: number; gen: number }>();
  for (const num of [...nums].sort((a, b) => a - b)) {
    const gen = pdf.generation(num);
    written.set(num, { offset: length, gen });
    for (const chunk of objectBytes(num, gen, pdf.object(num))) {
      chunks.push(chunk);
      length += chunk.length;
    }
  }
  const trailer = new PdfDict();
  for (const key of ["Root", "Info"]) {
    const value = pdf.trailer.get(key);
    if (value !== undefined) trailer.set(key, value);
  }
  const id = pdf.resolve(pdf.trailer.get("ID"));
  const first = Array.isArray(id) && id[0] instanceof PdfString ? id[0] : new PdfString(randomBytes(16));
  trailer.set("ID", [first, new PdfString(randomBytes(16))]);
  const previous = pdf.repaired ? null : pdf.lastXref;
  if (previous) trailer.set("Prev", previous.offset);
  if (!previous || previous.stream) {
    const xrefNum = pdf.size;
    written.set(xrefNum, { offset: length, gen: 0 });
    const rows = new Map<number, [number, number, number]>();
    if (!previous) {
      rows.set(0, [0, 0, 65_535]);
      for (const [num, entry] of pdf.xrefEntries())
        rows.set(num, entry.type === 1 ? [1, entry.offset, entry.gen] : [2, entry.stream, entry.index]);
    }
    for (const [num, entry] of written) rows.set(num, [1, entry.offset, entry.gen]);
    const sorted = [...rows.entries()].sort((a, b) => a[0] - b[0]);
    const index: number[] = [];
    const data = Buffer.alloc(sorted.length * 8);
    for (const [position, [num, [type, second, third]]] of sorted.entries()) {
      const last = index.length >= 2 ? (index[index.length - 2] ?? 0) + (index[index.length - 1] ?? 0) : -1;
      if (last === num) index[index.length - 1] = (index[index.length - 1] ?? 0) + 1;
      else index.push(num, 1);
      data[position * 8] = type;
      data.writeUInt32BE(second >>> 0, position * 8 + 1);
      data.writeUIntBE(Math.min(third, 0xffffff), position * 8 + 5, 3);
    }
    trailer.set("Type", new PdfName("XRef"));
    trailer.set("Size", xrefNum + 1);
    trailer.set("W", [1, 4, 3]);
    trailer.set("Index", index);
    chunks.push(...objectBytes(xrefNum, 0, new PdfStream(trailer, data)));
    chunks.push(Buffer.from(`startxref\n${length}\n%%EOF\n`, "latin1"));
    return Buffer.concat(chunks);
  }
  const lines = ["xref\n0 1\n0000000000 65535 f\r\n"];
  const sorted = [...written.entries()].sort((a, b) => a[0] - b[0]);
  for (let at = 0; at < sorted.length; ) {
    let end = at;
    while (end + 1 < sorted.length && (sorted[end + 1]?.[0] ?? 0) === (sorted[end]?.[0] ?? 0) + 1) end += 1;
    lines.push(`${sorted[at]?.[0] ?? 0} ${end - at + 1}\n`);
    for (let item = at; item <= end; item += 1) {
      const entry = sorted[item]?.[1];
      lines.push(`${String(entry?.offset ?? 0).padStart(10, "0")} ${String(entry?.gen ?? 0).padStart(5, "0")} n\r\n`);
    }
    at = end + 1;
  }
  trailer.set("Size", pdf.size);
  chunks.push(Buffer.from(`${lines.join("")}trailer\n${pdfText(trailer)}\nstartxref\n${length}\n%%EOF\n`, "latin1"));
  return Buffer.concat(chunks);
}
