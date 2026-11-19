// HXBot v1.7.4（BAK-03）：改用户的文件时怎么写。先在同一个文件夹里写一个临时文件、落盘（fsync），再一次
// 改名换上去：断电或进程被杀时，文件要么还是原来的，要么已经是新的，不会只写了一半。写之前再核一次哈希，
// 别的应用在这期间改过文件就停下。符号链接改的是它指向的文件；有硬链接的文件就地写（改名会断开链接），
// 写之前已经留了版本。写完从磁盘读回，哈希对得上才算写好。
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import { chmod, link, lstat, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type HxWriteErrorCode = "changed" | "not-a-file" | "busy" | "disk-full" | "readback" | "denied" | "failed";

export class HxWriteError extends Error {
  readonly code: HxWriteErrorCode;
  constructor(code: HxWriteErrorCode, message: string) {
    super(message);
    this.name = "HxWriteError";
    this.code = code;
  }
}

/** Points where a test stops or breaks a write. Production passes none. */
export interface HxWriteFaults {
  /** After the temporary file is written and synced, before it replaces the target. */
  beforeReplace?: (temp: string) => Promise<void> | void;
  /** Called with each chunk before it is written; it may throw, as a full disk does, or wait. */
  onChunk?: (bytes: number) => Promise<void> | void;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The SHA-256 of a file, read as a stream. */
export async function sha256File(path: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += bytes.length;
      hash.update(bytes);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return { sha256: hash.digest("hex"), size };
}

/** The file that a path names, through symbolic links. */
export async function hxTargetOf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    throw toWriteError(error);
  }
}

/** The name of the temporary file next to `target`; hidden, and marked as HXBot's. */
function hxTempName(target: string, random: string = randomBytes(6).toString("hex")): string {
  return join(dirname(target), `.${basename(target).slice(0, 80)}.hx-${random}.tmp`);
}

export interface HxReplaceResult {
  sha256: string;
  size: number;
  /** "replace" when a new file took the place of the old one, "in-place" for a file with hard links. */
  how: "replace" | "in-place";
}

/**
 * Replaces the content of the existing file `path` with `content`. With `expectSha256`, it stops with
 * `changed` when the file is no longer what was read. `onTemp` learns the temporary file before it is
 * created, so that a crash can be cleaned up.
 */
export async function hxReplaceFile(
  path: string,
  content: Uint8Array,
  options: {
    expectSha256?: string;
    onTemp?: (temp: string) => Promise<void> | void;
    faults?: HxWriteFaults | undefined;
    random?: () => string;
  } = {},
): Promise<HxReplaceResult> {
  const target = await hxTargetOf(path);
  let info: Stats;
  try {
    info = await stat(target);
  } catch (error) {
    throw toWriteError(error);
  }
  if (!info.isFile()) throw new HxWriteError("not-a-file", "The path is not a file.");
  if (options.expectSha256 !== undefined) {
    const now = await sha256File(target).catch((error: unknown) => {
      throw toWriteError(error);
    });
    if (now.sha256 !== options.expectSha256) {
      throw new HxWriteError("changed", "The file changed after HXBot read it. Read it again before you change it.");
    }
  }
  const expected = sha256(content);
  let how: HxReplaceResult["how"] = "replace";
  if (info.nlink > 1) {
    how = "in-place";
    await writeInPlace(target, content, options.faults);
  } else {
    const temp = hxTempName(target, options.random?.());
    await options.onTemp?.(temp);
    try {
      await writeNew(temp, content, info.mode & 0o7777, options.faults);
      await options.faults?.beforeReplace?.(temp);
      await renameHeld(temp, target);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw toWriteError(error);
    }
    await syncFolder(dirname(target));
  }
  const back = await sha256File(target).catch((error: unknown) => {
    throw toWriteError(error);
  });
  if (back.sha256 !== expected) {
    throw new HxWriteError("readback", "The file on disk is not what HXBot wrote.");
  }
  return { sha256: expected, size: content.length, how };
}

/** Creates a new file `path` with `content`; it never replaces an existing file. */
export async function hxCreateFile(
  path: string,
  content: Uint8Array,
  options: {
    faults?: HxWriteFaults | undefined;
    random?: () => string;
    onTemp?: (temp: string) => Promise<void> | void;
  } = {},
): Promise<HxReplaceResult> {
  const temp = hxTempName(path, options.random?.());
  await options.onTemp?.(temp);
  try {
    await writeNew(temp, content, 0o644, options.faults);
    await options.faults?.beforeReplace?.(temp);
    await hxPlaceNew(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw toWriteError(error);
  }
  await syncFolder(dirname(path));
  const expected = sha256(content);
  const back = await sha256File(path).catch((error: unknown) => {
    throw toWriteError(error);
  });
  if (back.sha256 !== expected) throw new HxWriteError("readback", "The file on disk is not what HXBot wrote.");
  return { sha256: expected, size: content.length, how: "replace" };
}

/**
 * Gives the finished file `temp` its name `path`, never in place of a file that exists. A link, not a
 * rename: it fails when `path` exists, so a file that appeared meanwhile is kept. `temp` is gone after.
 */
export async function hxPlaceNew(temp: string, path: string): Promise<void> {
  try {
    await link(temp, path);
    await unlink(temp);
  } catch (error) {
    if (isCode(error, "EEXIST")) throw new HxWriteError("changed", "A file with this name appeared meanwhile.");
    if (!isCode(error, "EPERM") && !isCode(error, "ENOTSUP") && !isCode(error, "EXDEV") && !isCode(error, "ENOSYS")) {
      throw error;
    }
    // A file system without hard links (exFAT, some network drives): check, then rename.
    const exists = await lstat(path).then(
      () => true,
      () => false,
    );
    if (exists) throw new HxWriteError("changed", "A file with this name appeared meanwhile.");
    await renameHeld(temp, path);
  }
}

const CHUNK = 4 * 1024 * 1024;

async function writeNew(path: string, content: Uint8Array, mode: number, faults?: HxWriteFaults): Promise<void> {
  const handle = await open(path, "wx", mode);
  try {
    for (let at = 0; at < content.length; at += CHUNK) {
      const chunk = content.subarray(at, Math.min(content.length, at + CHUNK));
      await faults?.onChunk?.(chunk.length);
      await handle.write(chunk, 0, chunk.length);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  // The umask must not take away what the old file allowed.
  if (process.platform !== "win32") await chmod(path, mode).catch(() => undefined);
}

async function writeInPlace(path: string, content: Uint8Array, faults?: HxWriteFaults): Promise<void> {
  const handle = await open(path, "r+").catch((error: unknown) => {
    throw toWriteError(error);
  });
  try {
    for (let at = 0; at < content.length; at += CHUNK) {
      const chunk = content.subarray(at, Math.min(content.length, at + CHUNK));
      await faults?.onChunk?.(chunk.length);
      await handle.write(chunk, 0, chunk.length, at);
    }
    await handle.truncate(content.length);
    await handle.sync();
  } catch (error) {
    throw toWriteError(error);
  } finally {
    await handle.close();
  }
}

/**
 * Windows answers EPERM, EACCES or EBUSY while antivirus, the indexer or the app that has the file
 * open holds it. A few short waits get past antivirus; an app that keeps the file open is reported.
 */
const HELD_WAITS_MS = [20, 80, 200, 500, 1000];

async function renameHeld(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const held =
        process.platform === "win32" && (isCode(error, "EPERM") || isCode(error, "EACCES") || isCode(error, "EBUSY"));
      const wait = HELD_WAITS_MS[attempt];
      if (!held) throw error;
      if (wait === undefined) {
        throw new HxWriteError("busy", "Another app has the file open. Close it there, then try again.");
      }
      await new Promise((done) => setTimeout(done, wait));
    }
  }
}

/** Makes a rename durable: the folder entry is on disk too. Windows has no such call, and needs none. */
export async function syncFolder(folder: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(folder, "r").catch(() => null);
  if (!handle) return;
  await handle.sync().catch(() => undefined);
  await handle.close().catch(() => undefined);
}

export function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function toWriteError(error: unknown): HxWriteError {
  if (error instanceof HxWriteError) return error;
  if (isCode(error, "ENOSPC") || isCode(error, "EDQUOT")) return new HxWriteError("disk-full", "The disk is full.");
  if (isCode(error, "EACCES") || isCode(error, "EPERM") || isCode(error, "EROFS")) {
    return new HxWriteError("denied", "HXBot may not write this file.");
  }
  if (isCode(error, "EBUSY") || isCode(error, "ETXTBSY")) {
    return new HxWriteError("busy", "Another app has the file open. Close it there, then try again.");
  }
  if (isCode(error, "ENOENT")) return new HxWriteError("not-a-file", "The file is not there.");
  if (isCode(error, "EISDIR")) return new HxWriteError("not-a-file", "The path is a folder.");
  return new HxWriteError("failed", error instanceof Error ? error.message.slice(0, 200) : "The write did not work.");
}
