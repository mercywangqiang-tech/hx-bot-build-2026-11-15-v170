// HXBot v1.7.4（CU-07 文件技能）：边读边写的压缩和解压，大文件夹不进内存。
// 压缩：先写到同一文件夹里的临时文件，每个条目压完再回头补上本地头里的 CRC 和大小（不用数据描述符，
// 各种解压工具都认），大条目和 4 GiB 以后的位置用 ZIP64；最后才给它目标名字，目标已存在就失败，不覆盖。
// 符号链接不跟随也不打包；Windows 上放不下的名字（含 : * ? 等、以点或空格结尾、CON 之类）事先拒绝。
// 解压：只读中央目录，逐条从文件里流式读出、解压、算 CRC；路径不安全、加密、不认识的压缩方法、解压后
// 超过声明大小、压缩比异常的大条目、条目数据互相重叠（不递归的炸弹），一律在写任何东西之前拒绝整个包；
// 已有的文件从不覆盖；目标文件夹里挡路的符号链接或文件也在写之前拒绝。
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { type FileHandle, lstat, mkdir, open, readdir, realpath, rmdir, unlink, utimes } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createDeflateRaw, createInflateRaw } from "node:zlib";
import { hxPlaceNew } from "./safe-write";
import { crc32, decodeName, dosTime, HxZipError, hxZipSafePath } from "./zip";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_END64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;
const FLAG_UTF8 = 0x0800;
const MAX32 = 0xffffffff;
/**
 * A file this large gets ZIP64 sizes up front: its packed size can come out a little larger than the
 * file (deflate adds a few bytes per block), and the header cannot grow after the data is written.
 */
const ZIP64_AT = 0xf000_0000;
const EXTRA_ZIP64 = 0x0001;
const EXTRA_TIME = 0x5455;

export const HX_ZIP_STREAM_LIMITS = {
  maxEntries: 100_000,
  /** All entries of an archive unpacked. */
  maxTotalBytes: 64 * 1024 * 1024 * 1024,
  maxCentralBytes: 64 * 1024 * 1024,
  /** An entry above this size may not unpack to more than `maxRatio` times its packed size. */
  ratioFloor: 100 * 1024 * 1024,
  maxRatio: 1000,
};

/** Files that are packed already: stored, not packed again. */
const STORED = new Set(
  (
    "zip 7z rar gz tgz bz2 xz zst lz4 jpg jpeg png gif webp heic heif avif mp3 m4a aac ogg opus flac mp4 m4v mov " +
    "mkv avi webm docx xlsx pptx docm xlsm pptm odt ods odp epub jar apk ipa dmg"
  ).split(" "),
);

function u16(view: DataView, at: number, value: number): void {
  view.setUint16(at, value, true);
}
function u32(view: DataView, at: number, value: number): void {
  view.setUint32(at, value >>> 0, true);
}
function u64(view: DataView, at: number, value: number): void {
  view.setBigUint64(at, BigInt(value), true);
}

async function writeAt(handle: FileHandle, bytes: Uint8Array, position: number): Promise<void> {
  let done = 0;
  while (done < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, done, bytes.length - done, position + done);
    if (bytesWritten <= 0) throw new Error("The archive could not be written.");
    done += bytesWritten;
  }
}

async function readAt(handle: FileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(buffer, done, length - done, position + done);
    if (bytesRead === 0) break;
    done += bytesRead;
  }
  return done === length ? buffer : buffer.subarray(0, done);
}

function bytesOf(chunk: Buffer | string | Uint8Array): Buffer {
  return typeof chunk === "string" ? Buffer.from(chunk) : Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

function tempBeside(path: string): string {
  return join(dirname(path), `.${basename(path).slice(0, 120)}.hx-${randomBytes(6).toString("hex")}.tmp`);
}

/** The extended timestamp field (UTC seconds), when the time fits in it. */
function timeExtra(when: Date): Buffer | null {
  const seconds = Math.floor(when.getTime() / 1000);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 0x7fffffff) return null;
  const extra = Buffer.alloc(9);
  extra.writeUInt16LE(EXTRA_TIME, 0);
  extra.writeUInt16LE(5, 2);
  extra.writeUInt8(1, 4);
  extra.writeUInt32LE(seconds, 5);
  return extra;
}

/**
 * Files that macOS writes beside the real ones and that are no part of a user's work: “._name” (the
 * extended attributes of “name” on a disk that cannot keep them, such as exFAT or a network drive),
 * “.DS_Store” (Finder's view settings), and what a Mac's “Compress” puts under “__MACOSX/”. Finder hides
 * them and its Archive Utility does not unpack them; HXBot leaves them out of a folder it packs and out of
 * what it unpacks. A file given by name is always packed, whatever its name.
 */
export function hxMacMetadata(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  const name = parts.at(-1) ?? "";
  return parts.includes("__MACOSX") || name.startsWith("._") || name === ".DS_Store";
}

/** What goes into the archive: files and folders under their names in it. */
export interface HxZipSource {
  path: string;
  name: string;
  directory: boolean;
  size: number;
  mtime: Date;
  mode: number;
}

/**
 * The entries for these files and folders: a folder with everything under it, names relative to the
 * folder that holds it, "/" between parts. Links and special files are left out and counted.
 */
export async function hxZipSources(
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<{ sources: HxZipSource[]; skipped: string[]; metadata: number }> {
  const sources: HxZipSource[] = [];
  const skipped: string[] = [];
  let metadata = 0;
  const names = new Set<string>();
  const add = (source: HxZipSource) => {
    const safe = hxZipSafePath(source.name);
    if (safe === null || (safe !== source.name && `${safe}/` !== source.name)) {
      throw new HxZipError(
        "unsupported",
        `${source.name.slice(0, 120)} has a name that cannot be unpacked on every computer (Windows does not allow it). Rename it first.`,
      );
    }
    if (names.has(source.name))
      throw new HxZipError("duplicate-name", `Two items would have the same name in the archive: ${source.name}`);
    names.add(source.name);
    sources.push(source);
    if (sources.length > HX_ZIP_STREAM_LIMITS.maxEntries)
      throw new HxZipError("too-large", "The archive would have too many entries.");
  };
  for (const path of paths) {
    signal?.throwIfAborted();
    const info = await lstat(path);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
      skipped.push(path);
      continue;
    }
    if (info.isFile()) {
      add({
        path,
        name: basename(path).normalize("NFC"),
        directory: false,
        size: info.size,
        mtime: info.mtime,
        mode: info.mode,
      });
      continue;
    }
    const root = dirname(path);
    const nameOf = (full: string) => relative(root, full).split(sep).join("/").normalize("NFC");
    const stack = [path];
    for (let folder = stack.pop(); folder !== undefined; folder = stack.pop()) {
      signal?.throwIfAborted();
      const folderInfo = await lstat(folder);
      add({
        path: folder,
        name: `${nameOf(folder)}/`,
        directory: true,
        size: 0,
        mtime: folderInfo.mtime,
        mode: folderInfo.mode,
      });
      const children = (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
        a.name < b.name ? 1 : a.name > b.name ? -1 : 0,
      );
      const files: HxZipSource[] = [];
      for (const child of children) {
        const full = join(folder, child.name);
        if (hxMacMetadata(child.name)) {
          metadata += 1;
          continue;
        }
        if (child.isDirectory()) stack.push(full);
        else if (child.isFile()) {
          const childInfo = await lstat(full);
          files.push({
            path: full,
            name: nameOf(full),
            directory: false,
            size: childInfo.size,
            mtime: childInfo.mtime,
            mode: childInfo.mode,
          });
        } else skipped.push(full);
      }
      for (const file of files.reverse()) add(file);
    }
  }
  return { sources, skipped, metadata };
}

interface Written {
  name: Buffer;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  time: number;
  date: number;
  external: number;
  zip64: boolean;
  stamp: Buffer | null;
}

/** Packs the sources into `output`, which must not exist. Returns the entries and the archive size. */
export async function hxZipWrite(
  sources: readonly HxZipSource[],
  output: string,
  options: { signal?: AbortSignal; level?: number } = {},
): Promise<{ entries: number; bytes: number }> {
  const signal = options.signal;
  const temp = tempBeside(output);
  const handle = await open(temp, "wx", 0o644);
  let position = 0;
  const written: Written[] = [];
  try {
    for (const source of sources) {
      signal?.throwIfAborted();
      const name = Buffer.from(source.name, "utf8");
      const { time, date } = dosTime(source.mtime);
      const extension = source.name.includes(".") ? (source.name.split(".").pop() ?? "").toLowerCase() : "";
      const method = source.directory || source.size === 0 || STORED.has(extension) ? 0 : 8;
      const zip64 = !source.directory && source.size >= ZIP64_AT;
      const stamp = timeExtra(source.mtime);
      const extraLength = (zip64 ? 20 : 0) + (stamp ? stamp.length : 0);
      const header = Buffer.alloc(30 + name.length + extraLength);
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      u32(view, 0, SIG_LOCAL);
      u16(view, 4, zip64 ? 45 : 20);
      u16(view, 6, FLAG_UTF8);
      u16(view, 8, method);
      u16(view, 10, time);
      u16(view, 12, date);
      u16(view, 26, name.length);
      u16(view, 28, extraLength);
      header.set(name, 30);
      if (zip64) {
        u16(view, 30 + name.length, EXTRA_ZIP64);
        u16(view, 32 + name.length, 16);
      }
      if (stamp) header.set(stamp, 30 + name.length + (zip64 ? 20 : 0));
      const offset = position;
      await writeAt(handle, header, position);
      position += header.length;
      let crc = 0;
      let size = 0;
      let compressed = 0;
      if (!source.directory) {
        const tally = async function* (input: AsyncIterable<Buffer | string>) {
          for await (const chunk of input) {
            const bytes = bytesOf(chunk);
            crc = crc32(bytes, crc);
            size += bytes.length;
            yield bytes;
          }
        };
        const sink = async (input: AsyncIterable<Buffer | string>) => {
          for await (const chunk of input) {
            const bytes = bytesOf(chunk);
            await writeAt(handle, bytes, position);
            position += bytes.length;
            compressed += bytes.length;
          }
        };
        const input = createReadStream(source.path, { highWaterMark: 1024 * 1024 });
        try {
          if (method === 8)
            await pipeline(input, tally, createDeflateRaw({ level: options.level ?? 6 }), sink, { signal });
          else await pipeline(input, tally, sink, { signal });
        } catch (error) {
          if (signal?.aborted) throw error;
          throw new HxZipError(
            "missing",
            `${source.name} could not be read: ${error instanceof Error ? error.message.slice(0, 160) : "unknown error"}`,
          );
        }
        if (!zip64 && (size >= MAX32 || compressed >= MAX32)) {
          throw new HxZipError("too-large", `${source.name} grew past 4 GiB while it was packed. Try again.`);
        }
      }
      // Back to the local header: the CRC and the sizes are known now.
      const patch = Buffer.alloc(12);
      const patchView = new DataView(patch.buffer);
      u32(patchView, 0, crc);
      u32(patchView, 4, zip64 ? MAX32 : compressed);
      u32(patchView, 8, zip64 ? MAX32 : size);
      await writeAt(handle, patch, offset + 14);
      if (zip64) {
        const sizes = Buffer.alloc(16);
        const sizesView = new DataView(sizes.buffer);
        u64(sizesView, 0, size);
        u64(sizesView, 8, compressed);
        await writeAt(handle, sizes, offset + 30 + name.length + 4);
      }
      const unixMode = source.directory ? 0o40755 : 0o100000 | (source.mode & 0o777 || 0o644);
      written.push({
        name,
        method,
        crc,
        compressed,
        size,
        offset,
        time,
        date,
        external: ((unixMode << 16) | (source.directory ? 0x10 : 0)) >>> 0,
        zip64,
        stamp,
      });
    }
    // The central directory, with ZIP64 fields where a value does not fit.
    const centralStart = position;
    for (const entry of written) {
      signal?.throwIfAborted();
      const big = {
        size: entry.zip64 || entry.size >= MAX32,
        compressed: entry.zip64 || entry.compressed >= MAX32,
        offset: entry.offset >= MAX32,
      };
      const zip64Length = (big.size ? 8 : 0) + (big.compressed ? 8 : 0) + (big.offset ? 8 : 0);
      const extraLength = (zip64Length ? 4 + zip64Length : 0) + (entry.stamp ? entry.stamp.length : 0);
      const record = Buffer.alloc(46 + entry.name.length + extraLength);
      const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
      const version = zip64Length ? 45 : 20;
      u32(view, 0, SIG_CENTRAL);
      u16(view, 4, (3 << 8) | version);
      u16(view, 6, version);
      u16(view, 8, FLAG_UTF8);
      u16(view, 10, entry.method);
      u16(view, 12, entry.time);
      u16(view, 14, entry.date);
      u32(view, 16, entry.crc);
      u32(view, 20, big.compressed ? MAX32 : entry.compressed);
      u32(view, 24, big.size ? MAX32 : entry.size);
      u16(view, 28, entry.name.length);
      u16(view, 30, extraLength);
      u32(view, 38, entry.external);
      u32(view, 42, big.offset ? MAX32 : entry.offset);
      record.set(entry.name, 46);
      let at = 46 + entry.name.length;
      if (zip64Length) {
        u16(view, at, EXTRA_ZIP64);
        u16(view, at + 2, zip64Length);
        at += 4;
        // The order is fixed: size, packed size, offset — only those that hold 0xFFFFFFFF.
        if (big.size) {
          u64(view, at, entry.size);
          at += 8;
        }
        if (big.compressed) {
          u64(view, at, entry.compressed);
          at += 8;
        }
        if (big.offset) {
          u64(view, at, entry.offset);
          at += 8;
        }
      }
      if (entry.stamp) record.set(entry.stamp, at);
      await writeAt(handle, record, position);
      position += record.length;
    }
    const centralSize = position - centralStart;
    const needs64 = written.length >= 0xffff || centralStart >= MAX32 || centralSize >= MAX32;
    if (needs64) {
      const end64 = Buffer.alloc(56 + 20);
      const view = new DataView(end64.buffer);
      u32(view, 0, SIG_END64);
      u64(view, 4, 44);
      u16(view, 12, (3 << 8) | 45);
      u16(view, 14, 45);
      u64(view, 24, written.length);
      u64(view, 32, written.length);
      u64(view, 40, centralSize);
      u64(view, 48, centralStart);
      u32(view, 56, SIG_LOCATOR64);
      u64(view, 64, position);
      u32(view, 72, 1);
      await writeAt(handle, end64, position);
      position += end64.length;
    }
    const end = Buffer.alloc(22);
    const view = new DataView(end.buffer);
    u32(view, 0, SIG_END);
    u16(view, 8, needs64 ? 0xffff : written.length);
    u16(view, 10, needs64 ? 0xffff : written.length);
    u32(view, 12, needs64 ? MAX32 : centralSize);
    u32(view, 16, needs64 ? MAX32 : centralStart);
    await writeAt(handle, end, position);
    position += end.length;
    await handle.sync();
    await handle.close();
    // The archive takes its name only now, and never the place of an existing file.
    await hxPlaceNew(temp, output);
    return { entries: written.length, bytes: position };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** One entry of an archive, as its central directory gives it. */
interface HxZipStreamEntry {
  name: string;
  path: string | null;
  directory: boolean;
  link: boolean;
  method: number;
  encrypted: boolean;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  modified: Date;
}

export interface HxZipDirectory {
  entries: HxZipStreamEntry[];
  centralStart: number;
}

function dosDate(time: number, date: number): Date {
  const when = new Date(
    ((date >> 9) & 0x7f) + 1980,
    ((date >> 5) & 0x0f) - 1,
    date & 0x1f,
    (time >> 11) & 0x1f,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  );
  return Number.isNaN(when.getTime()) ? new Date(0) : when;
}

/** Reads the central directory of an archive on disk, without its content. */
export async function hxZipEntries(handle: FileHandle): Promise<HxZipDirectory> {
  const { size } = await handle.stat();
  if (size < 22) throw new HxZipError("not-zip", "The file is not a zip archive.");
  const tailLength = Math.min(size, 22 + 65_535);
  const tailStart = size - tailLength;
  const tail = await readAt(handle, tailLength, tailStart);
  let at = -1;
  // The last end record whose comment reaches exactly to the end of the file: a comment may contain the signature.
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) === SIG_END && index + 22 + tail.readUInt16LE(index + 20) === tail.length) {
      at = index;
      break;
    }
  }
  if (at < 0) throw new HxZipError("not-zip", "The file is not a zip archive (or its end is missing).");
  if (tail.readUInt16LE(at + 4) !== 0 && tail.readUInt16LE(at + 4) !== 0xffff) {
    throw new HxZipError("unsupported", "The archive is split into parts; HXBot unpacks single-file archives.");
  }
  let count = tail.readUInt16LE(at + 10);
  let centralSize = tail.readUInt32LE(at + 12);
  let centralStart = tail.readUInt32LE(at + 16);
  if (count === 0xffff || centralSize === MAX32 || centralStart === MAX32) {
    const locatorAt = tailStart + at - 20;
    const locator = locatorAt >= 0 ? await readAt(handle, 20, locatorAt) : Buffer.alloc(0);
    if (locator.length === 20 && locator.readUInt32LE(0) === SIG_LOCATOR64) {
      const end64At = Number(locator.readBigUInt64LE(8));
      const end64 = await readAt(handle, 56, end64At);
      if (end64.length < 56 || end64.readUInt32LE(0) !== SIG_END64)
        throw new HxZipError("corrupt", "The archive's ZIP64 end record is damaged.");
      count = Number(end64.readBigUInt64LE(32));
      centralSize = Number(end64.readBigUInt64LE(40));
      centralStart = Number(end64.readBigUInt64LE(48));
    }
  }
  if (count > HX_ZIP_STREAM_LIMITS.maxEntries)
    throw new HxZipError(
      "too-large",
      `The archive has ${count} entries; HXBot unpacks up to ${HX_ZIP_STREAM_LIMITS.maxEntries}.`,
    );
  if (centralSize > HX_ZIP_STREAM_LIMITS.maxCentralBytes || centralStart + centralSize > size) {
    throw new HxZipError("corrupt", "The archive's directory is damaged.");
  }
  const central = await readAt(handle, centralSize, centralStart);
  const entries: HxZipStreamEntry[] = [];
  let position = 0;
  for (let index = 0; index < count; index += 1) {
    if (position + 46 > central.length || central.readUInt32LE(position) !== SIG_CENTRAL) {
      throw new HxZipError("corrupt", "The archive's directory is damaged.");
    }
    const madeBy = central.readUInt16LE(position + 4) >> 8;
    const flags = central.readUInt16LE(position + 8);
    const method = central.readUInt16LE(position + 10);
    const time = central.readUInt16LE(position + 12);
    const date = central.readUInt16LE(position + 14);
    const crc = central.readUInt32LE(position + 16);
    let compressed = central.readUInt32LE(position + 20);
    let sizeOf = central.readUInt32LE(position + 24);
    const nameLength = central.readUInt16LE(position + 28);
    const extraLength = central.readUInt16LE(position + 30);
    const commentLength = central.readUInt16LE(position + 32);
    const external = central.readUInt32LE(position + 38);
    let offset = central.readUInt32LE(position + 42);
    const end = position + 46 + nameLength + extraLength + commentLength;
    if (end > central.length) throw new HxZipError("corrupt", "The archive's directory is damaged.");
    const rawName = central.subarray(position + 46, position + 46 + nameLength);
    const extra = central.subarray(position + 46 + nameLength, position + 46 + nameLength + extraLength);
    let modified = dosDate(time, date);
    for (let e = 0; e + 4 <= extra.length; ) {
      const tag = extra.readUInt16LE(e);
      const length = extra.readUInt16LE(e + 2);
      const fieldEnd = Math.min(extra.length, e + 4 + length);
      if (tag === EXTRA_ZIP64) {
        // The 64-bit values, in order, of the fields that hold 0xFFFFFFFF.
        let field = e + 4;
        if (sizeOf === MAX32 && field + 8 <= fieldEnd) {
          sizeOf = Number(extra.readBigUInt64LE(field));
          field += 8;
        }
        if (compressed === MAX32 && field + 8 <= fieldEnd) {
          compressed = Number(extra.readBigUInt64LE(field));
          field += 8;
        }
        if (offset === MAX32 && field + 8 <= fieldEnd) offset = Number(extra.readBigUInt64LE(field));
      } else if (tag === EXTRA_TIME && length >= 5 && (extra.readUInt8(e + 4) & 1) !== 0) {
        modified = new Date(extra.readUInt32LE(e + 5) * 1000);
      }
      e += 4 + length;
    }
    const name = decodeName(rawName, flags, extra);
    const unixType = madeBy === 3 ? (external >>> 16) & 0o170000 : 0;
    entries.push({
      name,
      path: hxZipSafePath(name),
      directory:
        name.endsWith("/") || name.endsWith("\\") || unixType === 0o040000 || (madeBy !== 3 && (external & 0x10) !== 0),
      link: unixType === 0o120000,
      method,
      encrypted: (flags & 0x41) !== 0,
      crc,
      compressed,
      size: sizeOf,
      offset,
      modified,
    });
    position = end;
  }
  return { entries, centralStart };
}

/**
 * Checks an archive before anything is written: safe names, known methods, sane sizes, entries that
 * do not share their data. Throws on the first problem.
 */
export function hxCheckEntries(directory: HxZipDirectory): void {
  let total = 0;
  const seen = new Set<string>();
  const files = new Set<string>();
  const folders = new Set<string>();
  for (const entry of directory.entries) {
    if (entry.link) continue;
    if (entry.path === null)
      throw new HxZipError("unsupported", `The archive has an unsafe path: ${entry.name.slice(0, 120)}`);
    if (entry.encrypted)
      throw new HxZipError("encrypted", "The archive is encrypted; HXBot does not unpack encrypted archives.");
    if (!entry.directory && entry.method !== 0 && entry.method !== 8) {
      throw new HxZipError(
        "unsupported",
        `The archive packs ${entry.name.slice(0, 80)} with method ${entry.method}, which HXBot does not unpack.`,
      );
    }
    if (!entry.directory && entry.method === 0 && entry.compressed !== entry.size) {
      throw new HxZipError("corrupt", `${entry.name.slice(0, 80)} has wrong sizes.`);
    }
    if (entry.size > HX_ZIP_STREAM_LIMITS.ratioFloor && entry.size > entry.compressed * HX_ZIP_STREAM_LIMITS.maxRatio) {
      throw new HxZipError(
        "too-large",
        `${entry.name.slice(0, 80)} would unpack ${Math.round(entry.size / Math.max(1, entry.compressed))} times larger than it is packed: it looks like a zip bomb.`,
      );
    }
    total += entry.directory ? 0 : entry.size;
    if (total > HX_ZIP_STREAM_LIMITS.maxTotalBytes)
      throw new HxZipError("too-large", "The archive unpacks larger than 64 GiB.");
    const parts = entry.path.split("/");
    for (let index = 1; index < parts.length; index += 1) folders.add(parts.slice(0, index).join("/"));
    if (entry.directory) folders.add(entry.path);
    else {
      if (seen.has(entry.path)) throw new HxZipError("duplicate-name", `The archive has ${entry.path} twice.`);
      seen.add(entry.path);
      files.add(entry.path);
    }
  }
  for (const file of files)
    if (folders.has(file)) throw new HxZipError("corrupt", `The archive has ${file} both as a file and as a folder.`);
  // Each entry's data must end before the next one starts: entries sharing data are a bomb.
  const spans = directory.entries
    .filter((entry) => !entry.directory || entry.compressed > 0)
    .sort((a, b) => a.offset - b.offset);
  for (let index = 0; index < spans.length; index += 1) {
    const entry = spans[index];
    if (!entry) continue;
    const next = spans[index + 1]?.offset ?? directory.centralStart;
    if (entry.offset + 30 + entry.compressed > next)
      throw new HxZipError(
        "corrupt",
        "The archive's entries overlap: it is damaged or built to overload the computer.",
      );
  }
}

/** The total size of the entries, for a check of the free space. */
export function hxEntriesSize(directory: HxZipDirectory): number {
  return directory.entries.reduce((sum, entry) => sum + (entry.directory || entry.link ? 0 : entry.size), 0);
}

/** Streams an entry's data through `sink`, checking its size and CRC. */
async function streamEntry(
  handle: FileHandle,
  entry: HxZipStreamEntry,
  sink: (bytes: Buffer) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const local = await readAt(handle, 30, entry.offset);
  if (local.length < 30 || local.readUInt32LE(0) !== SIG_LOCAL)
    throw new HxZipError("corrupt", `${entry.name.slice(0, 80)} is damaged.`);
  const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  let crc = 0;
  let size = 0;
  const consume = async (input: AsyncIterable<Buffer | string>) => {
    for await (const chunk of input) {
      const bytes = bytesOf(chunk);
      size += bytes.length;
      if (size > entry.size)
        throw new HxZipError("too-large", `${entry.name.slice(0, 80)} unpacks larger than the archive says.`);
      crc = crc32(bytes, crc);
      await sink(bytes);
    }
  };
  if (entry.compressed > 0) {
    const input = handle.createReadStream({
      start,
      end: start + entry.compressed - 1,
      autoClose: false,
      highWaterMark: 1024 * 1024,
    });
    try {
      if (entry.method === 8) await pipeline(input, createInflateRaw(), consume, { signal });
      else await pipeline(input, consume, { signal });
    } catch (error) {
      if (error instanceof HxZipError || signal?.aborted) throw error;
      throw new HxZipError(
        "corrupt",
        `${entry.name.slice(0, 80)} is damaged: ${error instanceof Error ? error.message.slice(0, 120) : "unknown error"}`,
      );
    }
  }
  if (size !== entry.size || crc !== entry.crc)
    throw new HxZipError("corrupt", `${entry.name.slice(0, 80)} does not match its checksum; the archive is damaged.`);
}

/** Makes the folders of `path` under `root`, refusing a link or a file in the way; `made` gets the new ones. */
async function folderUnder(root: string, path: string, made: string[]): Promise<void> {
  let current = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current).catch(() => null);
    if (!info) {
      await mkdir(current, { mode: 0o755 });
      made.push(current);
      continue;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new HxZipError(
        "duplicate-name",
        `${relative(root, current)} is in the way (a link or a file); HXBot does not unpack through it.`,
      );
    }
  }
}

/**
 * Unpacks every entry under `root` (an existing folder). Everything is checked before the first byte
 * is written: an existing file or a link in the way refuses the whole archive. Each file is checked
 * against its CRC and size, and gets its name only once it is complete. When an entry fails (damaged
 * data, a full disk, a cancel), the files and folders made so far are taken away again: only those
 * that this call made, so the folder is as it was.
 */
export async function hxUnzipTo(
  archive: string,
  root: string,
  options: { signal?: AbortSignal } = {},
): Promise<{
  files: { path: string; size: number; crc: number }[];
  folders: number;
  skippedLinks: number;
  metadata: number;
}> {
  const signal = options.signal;
  const handle = await open(archive, "r");
  try {
    const all = await hxZipEntries(handle);
    hxCheckEntries(all);
    // A Mac's metadata files are not unpacked (hxMacMetadata); the rest of the archive is.
    const directory = { ...all, entries: all.entries.filter((entry) => !entry.path || !hxMacMetadata(entry.path)) };
    const metadata = all.entries.length - directory.entries.length;
    const realRoot = await realpath(root);
    const targetOf = (path: string) => join(realRoot, ...path.split("/"));
    const needed = new Set<string>();
    for (const entry of directory.entries) {
      if (entry.link || entry.path === null) continue;
      const parts = entry.path.split("/");
      for (let index = 1; index < parts.length; index += 1) needed.add(parts.slice(0, index).join("/"));
      if (entry.directory) needed.add(entry.path);
      else if (await lstat(targetOf(entry.path)).catch(() => null)) {
        throw new HxZipError("duplicate-name", `${entry.path} already exists; HXBot does not overwrite it.`);
      }
    }
    for (const folder of needed) {
      const info = await lstat(targetOf(folder)).catch(() => null);
      if (info && (info.isSymbolicLink() || !info.isDirectory())) {
        throw new HxZipError(
          "duplicate-name",
          `${folder} is in the way (a link or a file); HXBot does not unpack through it.`,
        );
      }
    }
    const files: { path: string; size: number; crc: number }[] = [];
    const made: string[] = [];
    let folders = 0;
    let skippedLinks = 0;
    try {
      for (const entry of directory.entries) {
        signal?.throwIfAborted();
        if (entry.link) {
          skippedLinks += 1;
          continue;
        }
        if (entry.path === null) continue;
        const target = targetOf(entry.path);
        if (entry.directory) {
          await folderUnder(realRoot, target, made);
          folders += 1;
          continue;
        }
        await folderUnder(realRoot, dirname(target), made);
        const temp = tempBeside(target);
        const out = await open(temp, "wx", 0o644);
        try {
          let at = 0;
          await streamEntry(
            handle,
            entry,
            async (bytes) => {
              await writeAt(out, bytes, at);
              at += bytes.length;
            },
            signal,
          );
          await out.sync();
          await out.close();
          await hxPlaceNew(temp, target);
          files.push({ path: target, size: entry.size, crc: entry.crc });
          await utimes(target, entry.modified, entry.modified).catch(() => undefined);
        } catch (error) {
          await out.close().catch(() => undefined);
          await unlink(temp).catch(() => undefined);
          throw error;
        }
      }
    } catch (error) {
      for (const file of files.reverse()) await unlink(file.path).catch(() => undefined);
      for (const folder of made.reverse()) await rmdir(folder).catch(() => undefined);
      throw error;
    }
    return { files, folders, skippedLinks, metadata };
  } finally {
    await handle.close();
  }
}

/** Reads every entry of an archive on disk and checks it against its CRC (the read-back of a new archive). */
export async function hxZipVerify(
  archive: string,
  signal?: AbortSignal,
): Promise<{ entries: number; bad: string[]; names: string[] }> {
  const handle = await open(archive, "r");
  try {
    const directory = await hxZipEntries(handle);
    const bad: string[] = [];
    for (const entry of directory.entries) {
      if (entry.directory) continue;
      await streamEntry(handle, entry, async () => undefined, signal).catch((error: unknown) => {
        if (signal?.aborted) throw error;
        bad.push(entry.name);
      });
    }
    return { entries: directory.entries.length, bad, names: directory.entries.map((entry) => entry.name) };
  } finally {
    await handle.close();
  }
}
