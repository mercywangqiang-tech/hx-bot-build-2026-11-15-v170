// HXBot v1.7.4（CU-07）：办公文件（.xlsx、.docx、.pptx）是 zip 包。这里自己读中央目录，写回时
// 没改的条目连压缩后的字节一起原样抄过去，只有改过的条目重新压缩；条目顺序、时间、注释都不变。
// 防压缩炸弹：条目数、单条和总的解压大小有上限，解压时一过上限就停；条目的数据互相重叠（“不递归的炸弹”）、
// 中央目录和本地头的名字对不上、两个条目同名，都当作坏文件拒绝。加密的、用不认识的压缩方式的条目不读。
import { constants, deflateRawSync, inflateRawSync, crc32 as nativeCrc32 } from "node:zlib";

export type HxZipErrorCode =
  | "not-zip"
  | "encrypted"
  | "unsupported"
  | "corrupt"
  | "too-large"
  | "duplicate-name"
  | "missing";

export class HxZipError extends Error {
  readonly code: HxZipErrorCode;
  constructor(code: HxZipErrorCode, message: string) {
    super(message);
    this.name = "HxZipError";
    this.code = code;
  }
}

export interface HxZipLimits {
  maxEntries: number;
  /** Bytes of one entry once inflated. */
  maxEntrySize: number;
  /** Bytes of all the entries once inflated, as the central directory states them. */
  maxTotalSize: number;
}

/** For a document that HXBot holds in memory. */
export const HX_ZIP_LIMITS: HxZipLimits = {
  maxEntries: 20_000,
  maxEntrySize: 512 * 1024 * 1024,
  maxTotalSize: 1024 * 1024 * 1024,
};

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_DESCRIPTOR = 0x08074b50;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DESCRIPTOR = 0x0008;
const FLAG_STRONG = 0x0040;
const FLAG_UTF8 = 0x0800;
const EXTRA_ZIP64 = 0x0001;
const EXTRA_UNICODE_PATH = 0x7075;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** What the central directory says about one entry, kept so that it is written back the same. */
interface Central {
  readonly versionMadeBy: number;
  readonly versionNeeded: number;
  readonly flags: number;
  readonly method: number;
  readonly time: number;
  readonly date: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly rawName: Uint8Array;
  /** The extra field without its ZIP64 record, which is made again when needed. */
  readonly extra: Uint8Array;
  readonly comment: Uint8Array;
  readonly internalAttrs: number;
  readonly externalAttrs: number;
}

export interface HxZipEntry {
  readonly name: string;
  readonly size: number;
  readonly compressedSize: number;
  readonly crc: number;
  readonly method: number;
  readonly encrypted: boolean;
  readonly directory: boolean;
  /** A symbolic link made on Unix. */
  readonly symlink: boolean;
  /** The time in the entry, local time as zip stores it. */
  readonly modified: Date;
}

interface Stored {
  central: Central;
  /** The local header as it stood (signature to the end of its extra field), or null for a new entry. */
  local: Uint8Array | null;
  /** The compressed bytes. */
  data: Uint8Array;
  /** True when the local header needs to be made again: a data descriptor or a ZIP64 record. */
  rebuildLocal: boolean;
  /** The new content of a changed or new entry, inflated. */
  replaced: Uint8Array | null;
}

/** A zip archive in memory. Read with `HxZip.read`, change entries, write with `toBytes`. */
export class HxZip {
  readonly #entries = new Map<string, Stored>();
  readonly #order: string[] = [];
  readonly #limits: HxZipLimits;
  #comment: Uint8Array;

  private constructor(limits: HxZipLimits, comment: Uint8Array) {
    this.#limits = limits;
    this.#comment = comment;
  }

  static create(limits: HxZipLimits = HX_ZIP_LIMITS): HxZip {
    return new HxZip(limits, new Uint8Array(0));
  }

  static read(bytes: Uint8Array, limits: HxZipLimits = HX_ZIP_LIMITS): HxZip {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = findEndRecord(bytes, view);
    let count = view.getUint16(end + 10, true);
    let cdSize = view.getUint32(end + 12, true);
    let cdOffset = view.getUint32(end + 16, true);
    const commentLength = view.getUint16(end + 20, true);
    const comment = bytes.slice(end + 22, end + 22 + commentLength);
    let cdEnd = end;
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locator = end - 20;
      if (locator >= 0 && view.getUint32(locator, true) === SIG_EOCD64_LOCATOR) {
        const at = safeNumber(view.getBigUint64(locator + 8, true));
        if (at + 56 > locator || view.getUint32(at, true) !== SIG_EOCD64) throw corrupt("ZIP64 end record");
        count = safeNumber(view.getBigUint64(at + 32, true));
        cdSize = safeNumber(view.getBigUint64(at + 40, true));
        cdOffset = safeNumber(view.getBigUint64(at + 48, true));
        cdEnd = at;
      }
    }
    if (count > limits.maxEntries)
      throw new HxZipError("too-large", `The archive has more than ${limits.maxEntries} entries.`);
    if (cdSize > cdEnd) throw corrupt("central directory size");
    // Data in front of the archive (a self-extracting stub) moves every offset by the same amount.
    const cdStart = cdEnd - cdSize;
    const shift = cdStart - cdOffset;
    if (shift < 0) throw corrupt("central directory offset");
    const zip = new HxZip(limits, comment);
    let at = cdStart;
    let total = 0;
    const spans: { start: number; end: number }[] = [];
    for (let index = 0; index < count; index += 1) {
      if (at + 46 > cdEnd || view.getUint32(at, true) !== SIG_CENTRAL) throw corrupt("central directory entry");
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLen = view.getUint16(at + 32, true);
      const next = at + 46 + nameLength + extraLength + commentLen;
      if (next > cdEnd) throw corrupt("central directory entry");
      const rawName = bytes.slice(at + 46, at + 46 + nameLength);
      const rawExtra = bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
      let size = view.getUint32(at + 24, true);
      let compressedSize = view.getUint32(at + 20, true);
      let localOffset = view.getUint32(at + 42, true);
      const zip64 = readExtra(rawExtra, EXTRA_ZIP64);
      if (zip64) {
        const z = new DataView(zip64.buffer, zip64.byteOffset, zip64.byteLength);
        let field = 0;
        const take = () => {
          if (field + 8 > zip64.length) throw corrupt("ZIP64 field");
          const value = safeNumber(z.getBigUint64(field, true));
          field += 8;
          return value;
        };
        if (size === 0xffffffff) size = take();
        if (compressedSize === 0xffffffff) compressedSize = take();
        if (localOffset === 0xffffffff) localOffset = take();
      }
      const flags = view.getUint16(at + 8, true);
      const central: Central = {
        versionMadeBy: view.getUint16(at + 4, true),
        versionNeeded: view.getUint16(at + 6, true),
        flags,
        method: view.getUint16(at + 10, true),
        time: view.getUint16(at + 12, true),
        date: view.getUint16(at + 14, true),
        crc: view.getUint32(at + 16, true),
        compressedSize,
        size,
        rawName,
        extra: withoutExtra(rawExtra, EXTRA_ZIP64),
        comment: bytes.slice(at + 46 + nameLength + extraLength, next),
        internalAttrs: view.getUint16(at + 36, true),
        externalAttrs: view.getUint32(at + 38, true),
      };
      const name = decodeName(rawName, flags, rawExtra);
      if (zip.#entries.has(name))
        throw new HxZipError("duplicate-name", `Two entries have the same name: ${name.slice(0, 80)}`);
      total += size;
      if (size > limits.maxEntrySize || total > limits.maxTotalSize) {
        throw new HxZipError("too-large", "The archive holds more than HXBot reads at once.");
      }
      // The local header must agree with the central directory about the name.
      const local = localOffset + shift;
      if (local + 30 > cdStart || view.getUint32(local, true) !== SIG_LOCAL) throw corrupt("local header");
      const localNameLength = view.getUint16(local + 26, true);
      const localExtraLength = view.getUint16(local + 28, true);
      const dataStart = local + 30 + localNameLength + localExtraLength;
      if (!sameBytes(bytes.subarray(local + 30, local + 30 + localNameLength), rawName)) {
        throw corrupt("local header name");
      }
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > cdStart) throw corrupt("entry data");
      const localExtra = bytes.subarray(local + 30 + localNameLength, dataStart);
      let spanEnd = dataEnd;
      if (flags & FLAG_DESCRIPTOR)
        spanEnd += descriptorLength(view, dataEnd, readExtra(localExtra, EXTRA_ZIP64) !== null);
      spans.push({ start: local, end: Math.min(spanEnd, cdStart) });
      zip.#entries.set(name, {
        central,
        local: bytes.slice(local, dataStart),
        data: bytes.subarray(dataStart, dataEnd),
        rebuildLocal: (flags & FLAG_DESCRIPTOR) !== 0 || readExtra(localExtra, EXTRA_ZIP64) !== null,
        replaced: null,
      });
      zip.#order.push(name);
      at = next;
    }
    // Entries whose data overlaps another entry: a reader that follows them inflates the same bytes many times.
    spans.sort((a, b) => a.start - b.start);
    for (let index = 1; index < spans.length; index += 1) {
      const previous = spans[index - 1];
      const current = spans[index];
      if (previous && current && current.start < previous.end) throw corrupt("overlapping entries");
    }
    return zip;
  }

  get comment(): Uint8Array {
    return this.#comment;
  }

  set comment(value: Uint8Array) {
    if (value.length > 0xffff) throw new HxZipError("too-large", "The archive comment is too long.");
    this.#comment = value;
  }

  entries(): HxZipEntry[] {
    return this.#order.map((name) => this.#describe(name));
  }

  names(): string[] {
    return [...this.#order];
  }

  has(name: string): boolean {
    return this.#entries.has(name);
  }

  entry(name: string): HxZipEntry | null {
    return this.#entries.has(name) ? this.#describe(name) : null;
  }

  /** The inflated content of an entry, checked against its size and CRC. */
  read(name: string): Uint8Array {
    const stored = this.#entries.get(name);
    if (!stored) throw new HxZipError("missing", `The archive has no entry ${name.slice(0, 80)}.`);
    if (stored.replaced) return stored.replaced;
    const { central } = stored;
    if (central.flags & (FLAG_ENCRYPTED | FLAG_STRONG) || central.method === 99) {
      throw new HxZipError("encrypted", "The entry is encrypted.");
    }
    let content: Uint8Array;
    if (central.method === METHOD_STORED) {
      content = stored.data;
    } else if (central.method === METHOD_DEFLATE) {
      try {
        // One byte more than the entry says: an entry that inflates to more than it states is refused.
        content = inflateRawSync(stored.data, { maxOutputLength: Math.max(1, central.size + 1) });
      } catch (error) {
        if (
          error instanceof RangeError ||
          (error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE")
        ) {
          throw new HxZipError("corrupt", "An entry inflates to more than it states.");
        }
        throw corrupt("deflate data");
      }
    } else {
      throw new HxZipError("unsupported", `The entry uses compression method ${central.method}.`);
    }
    if (content.length !== central.size)
      throw new HxZipError("corrupt", "An entry inflates to a different size than it states.");
    if (crc32(content) !== central.crc) throw new HxZipError("corrupt", "An entry fails its CRC check.");
    return content;
  }

  readText(name: string): string {
    return new TextDecoder("utf-8", { fatal: false }).decode(this.read(name));
  }

  /** Sets the content of an entry; a new name goes to the end. */
  set(name: string, content: Uint8Array, options: { compress?: boolean; modified?: Date } = {}): void {
    checkName(name);
    if (content.length > this.#limits.maxEntrySize) throw new HxZipError("too-large", "The entry is too large.");
    const existing = this.#entries.get(name);
    const when = dosTime(options.modified ?? new Date());
    const method = options.compress === false ? METHOD_STORED : METHOD_DEFLATE;
    if (existing) {
      existing.central = {
        ...existing.central,
        method,
        time: when.time,
        date: when.date,
        flags: existing.central.flags & ~FLAG_DESCRIPTOR,
      };
      existing.replaced = content;
      return;
    }
    if (this.#order.length >= this.#limits.maxEntries)
      throw new HxZipError("too-large", "The archive has too many entries.");
    const rawName = new TextEncoder().encode(name);
    this.#entries.set(name, {
      central: {
        versionMadeBy: 20,
        versionNeeded: 20,
        flags: /^[\x20-\x7e]*$/.test(name) ? 0 : FLAG_UTF8,
        method,
        time: when.time,
        date: when.date,
        crc: 0,
        compressedSize: 0,
        size: 0,
        rawName,
        extra: new Uint8Array(0),
        comment: new Uint8Array(0),
        internalAttrs: 0,
        externalAttrs: name.endsWith("/") ? 0x10 : 0,
      },
      local: null,
      data: new Uint8Array(0),
      rebuildLocal: true,
      replaced: content,
    });
    this.#order.push(name);
  }

  setText(name: string, text: string): void {
    this.set(name, new TextEncoder().encode(text));
  }

  delete(name: string): void {
    if (!this.#entries.delete(name)) return;
    this.#order.splice(this.#order.indexOf(name), 1);
  }

  /** Entries that were changed or added since the archive was read. */
  changedNames(): string[] {
    return this.#order.filter((name) => this.#entries.get(name)?.replaced !== null);
  }

  toBytes(): Uint8Array {
    const parts: Uint8Array[] = [];
    const centrals: Uint8Array[] = [];
    let offset = 0;
    for (const name of this.#order) {
      const stored = this.#entries.get(name);
      if (!stored) continue;
      let { central } = stored;
      let data = stored.data;
      let local = stored.local;
      if (stored.replaced) {
        const content = stored.replaced;
        data =
          central.method === METHOD_STORED
            ? content
            : deflateRawSync(content, { level: constants.Z_DEFAULT_COMPRESSION });
        central = { ...central, crc: crc32(content), size: content.length, compressedSize: data.length };
        local = null;
      }
      if (local === null || stored.rebuildLocal) local = localHeader(central);
      if (offset > 0xfffffffe) throw new HxZipError("too-large", "The archive would be larger than 4 GB.");
      parts.push(local, data);
      centrals.push(centralHeader(central, offset));
      offset += local.length + data.length;
    }
    if (this.#order.length > 0xfffe) throw new HxZipError("too-large", "The archive would have too many entries.");
    let cdSize = 0;
    for (const record of centrals) cdSize += record.length;
    if (offset + cdSize > 0xfffffffe) throw new HxZipError("too-large", "The archive would be larger than 4 GB.");
    const end = new Uint8Array(22 + this.#comment.length);
    const view = new DataView(end.buffer);
    view.setUint32(0, SIG_EOCD, true);
    view.setUint16(8, this.#order.length, true);
    view.setUint16(10, this.#order.length, true);
    view.setUint32(12, cdSize, true);
    view.setUint32(16, offset, true);
    view.setUint16(20, this.#comment.length, true);
    end.set(this.#comment, 22);
    return concat([...parts, ...centrals, end]);
  }

  #describe(name: string): HxZipEntry {
    const stored = this.#entries.get(name);
    if (!stored) throw new HxZipError("missing", `The archive has no entry ${name.slice(0, 80)}.`);
    const { central } = stored;
    const unixMode = central.versionMadeBy >> 8 === 3 ? central.externalAttrs >>> 16 : 0;
    return {
      name,
      size: stored.replaced ? stored.replaced.length : central.size,
      compressedSize: central.compressedSize,
      crc: central.crc,
      method: central.method,
      encrypted: (central.flags & (FLAG_ENCRYPTED | FLAG_STRONG)) !== 0 || central.method === 99,
      directory: name.endsWith("/") || (central.externalAttrs & 0x10) !== 0,
      symlink: (unixMode & 0o170000) === 0o120000,
      modified: fromDosTime(central.time, central.date),
    };
  }
}

function corrupt(what: string): HxZipError {
  return new HxZipError("corrupt", `The archive is damaged (${what}).`);
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw corrupt("ZIP64 size");
  return Number(value);
}

function findEndRecord(bytes: Uint8Array, view: DataView): number {
  if (bytes.length < 22) throw new HxZipError("not-zip", "The file is not a zip archive.");
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let at = bytes.length - 22; at >= lowest; at -= 1) {
    if (bytes[at] !== 0x50 || view.getUint32(at, true) !== SIG_EOCD) continue;
    // The comment length must reach exactly to the end of the file.
    if (at + 22 + view.getUint16(at + 20, true) === bytes.length) return at;
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    // An OLE file: an encrypted Office document, or one of the old .xls, .doc and .ppt formats.
    throw new HxZipError("encrypted", "The file is an encrypted Office document or an old binary format.");
  }
  throw new HxZipError("not-zip", "The file is not a zip archive.");
}

function descriptorLength(view: DataView, at: number, zip64: boolean): number {
  const sizes = zip64 ? 16 : 8;
  const signed = at + 4 <= view.byteLength && view.getUint32(at, true) === SIG_DESCRIPTOR;
  return (signed ? 4 : 0) + 4 + sizes;
}

function readExtra(extra: Uint8Array, id: number): Uint8Array | null {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let at = 0;
  while (at + 4 <= extra.length) {
    const kind = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    if (at + 4 + length > extra.length) return null;
    if (kind === id) return extra.subarray(at + 4, at + 4 + length);
    at += 4 + length;
  }
  return null;
}

function withoutExtra(extra: Uint8Array, id: number): Uint8Array {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  const kept: Uint8Array[] = [];
  let at = 0;
  while (at + 4 <= extra.length) {
    const kind = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    if (at + 4 + length > extra.length) break;
    if (kind !== id) kept.push(extra.subarray(at, at + 4 + length));
    at += 4 + length;
  }
  return concat(kept);
}

/**
 * The name of an entry. With the UTF-8 flag, or with an Info-ZIP Unicode path whose CRC matches the
 * name, it is UTF-8. Otherwise names that are valid UTF-8 read as UTF-8 (macOS writes them so without the
 * flag), then GB18030 (Windows in Chinese), then code page 437.
 */
export function decodeName(raw: Uint8Array, flags: number, extra: Uint8Array): string {
  if (flags & FLAG_UTF8) return new TextDecoder("utf-8").decode(raw);
  const unicode = readExtra(extra, EXTRA_UNICODE_PATH);
  if (unicode && unicode.length > 5 && unicode[0] === 1) {
    const view = new DataView(unicode.buffer, unicode.byteOffset, unicode.byteLength);
    if (view.getUint32(1, true) === crc32(raw)) return new TextDecoder("utf-8").decode(unicode.subarray(5));
  }
  if (raw.every((byte) => byte < 0x80)) return new TextDecoder("latin1").decode(raw);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    // Not UTF-8.
  }
  try {
    return new TextDecoder("gb18030", { fatal: true }).decode(raw);
  } catch {
    return decodeCp437(raw);
  }
}

const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function decodeCp437(raw: Uint8Array): string {
  let out = "";
  for (const byte of raw) out += byte < 0x80 ? String.fromCharCode(byte) : (CP437_HIGH[byte - 0x80] ?? "?");
  return out;
}

function checkName(name: string): void {
  if (name.length === 0 || name.length > 4096 || name.startsWith("/") || name.includes("\\") || name.includes("\0")) {
    throw new HxZipError("corrupt", `Not an entry name: ${name.slice(0, 80)}`);
  }
}

function localHeader(central: Central): Uint8Array {
  const out = new Uint8Array(30 + central.rawName.length + central.extra.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, SIG_LOCAL, true);
  view.setUint16(4, central.versionNeeded, true);
  view.setUint16(6, central.flags & ~FLAG_DESCRIPTOR, true);
  view.setUint16(8, central.method, true);
  view.setUint16(10, central.time, true);
  view.setUint16(12, central.date, true);
  view.setUint32(14, central.crc, true);
  view.setUint32(18, central.compressedSize, true);
  view.setUint32(22, central.size, true);
  view.setUint16(26, central.rawName.length, true);
  view.setUint16(28, central.extra.length, true);
  out.set(central.rawName, 30);
  out.set(central.extra, 30 + central.rawName.length);
  return out;
}

function centralHeader(central: Central, offset: number): Uint8Array {
  if (central.size > 0xfffffffe || central.compressedSize > 0xfffffffe) {
    throw new HxZipError("too-large", "An entry would be larger than 4 GB.");
  }
  const out = new Uint8Array(46 + central.rawName.length + central.extra.length + central.comment.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, SIG_CENTRAL, true);
  view.setUint16(4, central.versionMadeBy, true);
  view.setUint16(6, central.versionNeeded, true);
  view.setUint16(8, central.flags & ~FLAG_DESCRIPTOR, true);
  view.setUint16(10, central.method, true);
  view.setUint16(12, central.time, true);
  view.setUint16(14, central.date, true);
  view.setUint32(16, central.crc, true);
  view.setUint32(20, central.compressedSize, true);
  view.setUint32(24, central.size, true);
  view.setUint16(28, central.rawName.length, true);
  view.setUint16(30, central.extra.length, true);
  view.setUint16(32, central.comment.length, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, central.internalAttrs, true);
  view.setUint32(38, central.externalAttrs, true);
  view.setUint32(42, offset, true);
  out.set(central.rawName, 46);
  out.set(central.extra, 46 + central.rawName.length);
  out.set(central.comment, 46 + central.rawName.length + central.extra.length);
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Zip keeps local time to two seconds, from 1980. */
export function dosTime(when: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, when.getFullYear()));
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

function fromDosTime(time: number, date: number): Date {
  return new Date(
    ((date >> 9) & 0x7f) + 1980,
    ((date >> 5) & 0x0f) - 1,
    date & 0x1f,
    (time >> 11) & 0x1f,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  );
}

let table: Uint32Array | null = null;

/** CRC-32 of zip; Node's own when it has one. */
export function crc32(bytes: Uint8Array, previous = 0): number {
  if (typeof nativeCrc32 === "function") return nativeCrc32(bytes, previous) >>> 0;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (const byte of bytes) crc = ((table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * The path that an entry would take on disk, or null when it must not be written: an absolute path,
 * a drive, `..`, a name that Windows reserves or cannot hold, a control character.
 */
export function hxZipSafePath(name: string): string | null {
  const unified = name.replaceAll("\\", "/");
  if (unified.startsWith("/") || /^[a-zA-Z]:/.test(unified) || unified.length > 1024) return null;
  const segments: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return null;
    for (const char of segment) {
      const code = char.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f || '<>:"|?*'.includes(char)) return null;
    }
    if (/[. ]$/.test(segment)) return null;
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(segment)) return null;
    segments.push(segment);
  }
  if (segments.length === 0 || segments.length > 64) return null;
  return segments.join("/");
}
