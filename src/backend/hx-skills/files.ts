// HXBot v1.7.4（CU-07 文件技能）：查找、移动、改名、压缩、解压。都在本机直接做，不开访达或资源管理器。
// 移动和改名从不覆盖：同名时停下（或按要求改成“名字 (2)”）；同一个卷上用硬链接加删除或改名（文件内容不动），
// 跨卷时先复制、逐个核对哈希、确认原处没被改过，最后才删原处的。中途出错，已经做完的会挪回去。
// 压缩、解压见 hx-files/zip-stream.ts；做之前先看剩余空间。
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import {
  chmod,
  copyFile,
  constants as fsConstants,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  rename,
  rmdir,
  statfs,
  symlink,
  unlink,
  utimes,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { HxWriteError, hxPlaceNew, isCode } from "../hx-files/safe-write";
import { crc32, hxZipSafePath } from "../hx-files/zip";
import {
  hxCheckEntries,
  hxEntriesSize,
  hxMacMetadata,
  hxUnzipTo,
  hxZipEntries,
  hxZipSources,
  hxZipVerify,
  hxZipWrite,
} from "../hx-files/zip-stream";
import { FILES_PARAMS } from "./declarations";
import { type HxReadbackCheck, SkillInputError } from "./office";

/** Kept free on the disk beyond what an archive or a copy needs. */
const FREE_MARGIN = 64 * 1024 * 1024;
const MAX_SCANNED = 200_000;
/** Unpacked bytes read back by their checksum; the rest is checked by size (it was checked as it was written). */
const READBACK_BYTES = 2 * 1024 * 1024 * 1024;
const SKIPPED_FOLDERS = new Set([
  ".git",
  "node_modules",
  "$RECYCLE.BIN",
  "System Volume Information",
  ".Trash",
  ".Trashes",
  ".Spotlight-V100",
  ".fseventsd",
  ".DocumentRevisions-V100",
]);

export interface HxFilesHost {
  /** Free bytes of the disk that holds `path`. */
  free?: (path: string) => Promise<number>;
  signal?: AbortSignal;
}

/** What a files action did: the moves (for 撤销 and the card), the new files, the checks. */
export interface HxFilesOutcome {
  done: string;
  moves: { from: string; to: string; kind: "file" | "folder" | "link" }[];
  created: string[];
  checks: HxReadbackCheck[];
  details: Record<string, string | number | boolean | string[]>;
}

async function freeBytes(host: HxFilesHost, path: string): Promise<number | null> {
  try {
    if (host.free) return await host.free(path);
    const info = await statfs(path);
    return info.bavail * info.bsize;
  } catch {
    return null;
  }
}

async function needSpace(host: HxFilesHost, folder: string, bytes: number): Promise<void> {
  const free = await freeBytes(host, folder);
  if (free !== null && free < bytes + FREE_MARGIN) {
    throw new HxWriteError(
      "disk-full",
      `The disk needs about ${mb(bytes + FREE_MARGIN)} free, and has ${mb(free)}. Free up space, then try again.`,
    );
  }
}

function mb(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

const exists = (path: string) =>
  lstat(path).then(
    (info) => info,
    () => null,
  );

async function sha256Of(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024, signal })) hash.update(chunk);
  return hash.digest("hex");
}

/** The same path in the form a comparison needs: Mac and Windows folders do not tell case apart. */
function key(path: string): string {
  const normal = path.normalize("NFC");
  return process.platform === "darwin" || process.platform === "win32" ? normal.toLowerCase() : normal;
}

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel));
}

// ----------------------------------------------------------------------------------------------- find

/** A pattern with * and ? matches the whole name; other text matches a part of it. Case does not count. */
export function hxNameMatcher(pattern: string): (name: string) => boolean {
  const normal = pattern.normalize("NFC").toLowerCase();
  if (!/[*?]/.test(normal)) return (name) => name.normalize("NFC").toLowerCase().includes(normal);
  const source = normal
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");
  const regex = new RegExp(`^${source}$`, "su");
  return (name) => regex.test(name.normalize("NFC").toLowerCase());
}

/** "2026-11-01" (a day here) or a full ISO time. */
export function hxParseDay(text: string): Date {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  const when = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(text);
  if (Number.isNaN(when.getTime()) || (day && when.getDate() !== Number(day[3]))) {
    throw new SkillInputError(`modifiedAfter must be a day such as 2026-11-01, not ${JSON.stringify(text)}.`);
  }
  return when;
}

export interface HxFoundFile {
  path: string;
  type: "file" | "folder";
  size?: number;
  modified: string;
}

export async function hxFilesFind(folders: readonly string[], params: unknown, host: HxFilesHost = {}) {
  const input = FILES_PARAMS.find.parse(params ?? {});
  const match = input.name ? hxNameMatcher(input.name) : null;
  const extensions = input.ext ? new Set(input.ext.map((ext) => ext.replace(/^\./, "").toLowerCase())) : null;
  const after = input.modifiedAfter ? hxParseDay(input.modifiedAfter) : null;
  const depth = input.depth ?? 6;
  const limit = input.limit ?? 200;
  const showHidden = input.name?.startsWith(".") ?? false;
  const results: HxFoundFile[] = [];
  let scanned = 0;
  let unreadable = 0;
  let truncated = false;
  for (const folder of folders) {
    const info = await exists(folder);
    if (!info?.isDirectory()) throw new SkillInputError(`${folder} is not a folder. Give the folder to search in.`);
  }
  // Breadth first: what is near the top comes before what is deep down.
  let level: string[] = [...folders];
  for (let current = 0; current <= depth && level.length > 0 && !truncated; current += 1) {
    const next: string[] = [];
    for (const folder of level) {
      host.signal?.throwIfAborted();
      const children = await readdir(folder, { withFileTypes: true }).catch(() => null);
      if (!children) {
        unreadable += 1;
        continue;
      }
      children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const child of children) {
        scanned += 1;
        if (scanned > MAX_SCANNED) {
          truncated = true;
          break;
        }
        if (!showHidden && child.name.startsWith(".")) continue;
        const full = join(folder, child.name);
        if (child.isDirectory()) {
          if (SKIPPED_FOLDERS.has(child.name)) continue;
          next.push(full);
          if (extensions || !match?.(child.name) || after) continue;
          const stats = await lstat(full).catch(() => null);
          if (stats) results.push({ path: full, type: "folder", modified: stats.mtime.toISOString() });
        } else if (child.isFile()) {
          if (match && !match(child.name)) continue;
          if (extensions && !extensions.has(extname(child.name).slice(1).toLowerCase())) continue;
          const stats = await lstat(full).catch(() => null);
          if (!stats) continue;
          if (after && stats.mtime < after) continue;
          results.push({ path: full, type: "file", size: stats.size, modified: stats.mtime.toISOString() });
        }
        if (results.length >= limit) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
    level = next;
  }
  return {
    results,
    count: results.length,
    truncated,
    scanned: Math.min(scanned, MAX_SCANNED),
    ...(unreadable ? { unreadable } : {}),
  };
}

// ------------------------------------------------------------------------------------- move and rename

/** A name that every computer can hold: no folder, no character Windows refuses, at most 255 bytes. */
export function hxCheckName(name: string): string {
  const normal = name.normalize("NFC");
  if (normal.includes("/") || normal.includes("\\"))
    throw new SkillInputError("The new name must not contain / or \\; give a name, not a path.");
  if (hxZipSafePath(normal) !== normal || normal === "." || normal === "..") {
    throw new SkillInputError(
      `${JSON.stringify(name)} cannot be a file name on every computer: no < > : " | ? *, no control characters, no dot or space at the end, not CON, NUL, COM1 and the like.`,
    );
  }
  if (Buffer.byteLength(normal, "utf8") > 255) throw new SkillInputError("The new name is longer than 255 bytes.");
  return normal;
}

/** "报告.pdf" → "报告 (2).pdf", the first name that is free in `folder` and not taken by this call. */
async function freeName(folder: string, name: string, taken: ReadonlySet<string>): Promise<string> {
  const ext = name.startsWith(".") ? "" : extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let number = 2; number < 10_000; number += 1) {
    const candidate = `${stem} (${number})${ext}`;
    const path = join(folder, candidate);
    if (!taken.has(key(path)) && !(await exists(path))) return candidate;
  }
  throw new SkillInputError(`No free name for ${name} in ${folder}.`);
}

interface Planned {
  from: string;
  to: string;
  info: Stats;
}

function kindOf(info: Stats): "file" | "folder" | "link" {
  return info.isSymbolicLink() ? "link" : info.isDirectory() ? "folder" : "file";
}

/** Same file: the same inode on the same disk (a case-only rename on a Mac sees the file twice). */
function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.ino !== 0;
}

interface Moved {
  how: "same-disk" | "copied";
  /** Originals that could not be removed after a complete, checked copy to another disk. */
  leftBehind: string[];
}

async function moveOne(plan: Planned, host: HxFilesHost): Promise<Moved> {
  const { from, to, info } = plan;
  if (info.isFile()) {
    // A hard link fails when `to` exists: a file is never replaced.
    let linked = false;
    try {
      await link(from, to);
      linked = true;
    } catch (error) {
      if (isCode(error, "EEXIST")) throw new HxWriteError("changed", `${to} appeared meanwhile; nothing was replaced.`);
      if (isCode(error, "EXDEV")) return { how: "copied", leftBehind: await copyAcross(from, to, info, host) };
      if (!isCode(error, "EPERM") && !isCode(error, "ENOTSUP") && !isCode(error, "ENOSYS")) throw error;
    }
    if (linked) {
      try {
        await unlink(from);
      } catch (error) {
        // The file is held (Windows) or the folder may not be changed: take the new link away again.
        await unlink(to).catch(() => undefined);
        throw error;
      }
      return { how: "same-disk", leftBehind: [] };
    }
  }
  // A folder, a link, or a disk without hard links (exFAT, some network drives): check, then rename.
  if (await exists(to)) throw new HxWriteError("changed", `${to} appeared meanwhile; nothing was replaced.`);
  try {
    await rename(from, to);
    return { how: "same-disk", leftBehind: [] };
  } catch (error) {
    if (!isCode(error, "EXDEV")) throw error;
  }
  return { how: "copied", leftBehind: await copyAcross(from, to, info, host) };
}

/**
 * A copy to another disk, checked file by file. The original goes only when every copy matches and
 * nothing in the original changed meanwhile; before that, any failure takes the copy away again.
 * Originals that cannot be removed after that are returned, not thrown: the copy is complete then.
 */
async function copyAcross(from: string, to: string, info: Stats, host: HxFilesHost): Promise<string[]> {
  const signal = host.signal;
  const files: { from: string; to: string; info: Stats }[] = [];
  const folders: { from: string; to: string; count: number }[] = [];
  const links: { from: string; to: string }[] = [];
  let bytes = 0;
  const walk = async (source: string, target: string, stats: Stats) => {
    signal?.throwIfAborted();
    if (stats.isSymbolicLink()) links.push({ from: source, to: target });
    else if (stats.isFile()) {
      files.push({ from: source, to: target, info: stats });
      bytes += stats.size;
    } else if (stats.isDirectory()) {
      const children = await readdir(source);
      folders.push({ from: source, to: target, count: children.length });
      for (const child of children)
        await walk(join(source, child), join(target, child), await lstat(join(source, child)));
    } else
      throw new SkillInputError(
        `${source} is a special file (a pipe or a device); HXBot does not move it to another disk.`,
      );
  };
  await walk(from, to, info);
  await needSpace(host, dirname(to), bytes);
  const made: string[] = [];
  const placed: string[] = [];
  try {
    for (const folder of folders) {
      await mkdir(folder.to);
      made.push(folder.to);
    }
    for (const file of files) {
      signal?.throwIfAborted();
      const temp = join(
        dirname(file.to),
        `.${basename(file.to).slice(0, 120)}.hx-${randomBytes(6).toString("hex")}.tmp`,
      );
      await copyFile(file.from, temp, fsConstants.COPYFILE_EXCL);
      try {
        const [original, copy] = await Promise.all([sha256Of(file.from, signal), sha256Of(temp, signal)]);
        if (original !== copy)
          throw new HxWriteError("readback", `The copy of ${file.from} does not match it; nothing was moved.`);
        await utimes(temp, file.info.atime, file.info.mtime).catch(() => undefined);
        if (process.platform !== "win32") await chmod(temp, file.info.mode & 0o7777).catch(() => undefined);
        await hxPlaceNew(temp, file.to);
      } catch (error) {
        await unlink(temp).catch(() => undefined);
        throw error;
      }
      placed.push(file.to);
    }
    for (const item of links) {
      await symlink(await readlink(item.from), item.to);
      placed.push(item.to);
    }
    for (const file of files) {
      const now = await lstat(file.from);
      if (now.size !== file.info.size || now.mtimeMs !== file.info.mtimeMs) {
        throw new HxWriteError(
          "changed",
          `${file.from} changed while it was copied; the original is kept and the copy taken away.`,
        );
      }
    }
    for (const folder of folders) {
      if ((await readdir(folder.from)).length !== folder.count) {
        throw new HxWriteError(
          "changed",
          `${folder.from} changed while it was copied; the original is kept and the copy taken away.`,
        );
      }
    }
  } catch (error) {
    for (const path of placed.reverse()) await unlink(path).catch(() => undefined);
    for (const folder of made.reverse()) await rmdir(folder).catch(() => undefined);
    throw error;
  }
  const leftBehind: string[] = [];
  for (const item of [...files, ...links]) await unlink(item.from).catch(() => leftBehind.push(item.from));
  for (const folder of folders.reverse()) await rmdir(folder.from).catch(() => leftBehind.push(folder.from));
  return leftBehind;
}

async function runMoves(plans: Planned[], host: HxFilesHost): Promise<Moved[]> {
  const done: Planned[] = [];
  const moved: Moved[] = [];
  try {
    for (const plan of plans) {
      host.signal?.throwIfAborted();
      moved.push(await moveOne(plan, host));
      done.push(plan);
    }
  } catch (error) {
    // Put back what was moved, newest first, so that a call that fails changes nothing.
    const back: string[] = [];
    for (const plan of done.reverse()) {
      const info = await lstat(plan.to).catch(() => null);
      if (!info) continue;
      await moveOne({ from: plan.to, to: plan.from, info }, {}).catch(() => back.push(plan.to));
    }
    if (back.length > 0 && error instanceof Error) {
      error.message = `${error.message} These could not be moved back: ${back.join(", ")}`;
    }
    throw error;
  }
  return moved;
}

async function moveChecks(plans: Planned[], moved: readonly Moved[]): Promise<HxReadbackCheck[]> {
  const checks: HxReadbackCheck[] = [];
  for (const [index, plan] of plans.entries()) {
    const now = await lstat(plan.to).catch(() => null);
    const gone =
      !(await exists(plan.from)) || (now !== null && sameFile(now, plan.info) && key(plan.from) === key(plan.to));
    const same =
      now !== null &&
      (moved[index]?.how === "copied"
        ? now.size === plan.info.size || plan.info.isDirectory()
        : sameFile(now, plan.info));
    checks.push({
      what: `${basename(plan.to)} at ${dirname(plan.to)}`,
      ok: same,
      expected: "there, unchanged",
      actual: now ? (same ? "there, unchanged" : "there, but different") : "missing",
    });
    checks.push({
      what: `${basename(plan.from)} gone from ${dirname(plan.from)}`,
      ok: gone,
      expected: "gone",
      actual: gone ? "gone" : "still there",
    });
  }
  return checks;
}

export async function hxFilesMove(
  sources: readonly string[],
  to: string,
  params: unknown,
  host: HxFilesHost = {},
): Promise<HxFilesOutcome> {
  const input = FILES_PARAMS.move.parse(params ?? {});
  if (sources.length === 0) throw new SkillInputError("Give the files or folders to move.");
  const target = await exists(to);
  if (target && !target.isDirectory())
    throw new SkillInputError(`${to} is a file, not a folder. Give the folder to move into.`);
  const realTo = target ? await realpath(to) : null;
  const plans: Planned[] = [];
  const taken = new Set<string>();
  const renamed: string[] = [];
  for (const source of sources) {
    const info = await exists(source);
    if (!info) throw new SkillInputError(`${source} is not there.`);
    if (key(dirname(source)) === key(to) || (realTo && key(dirname(await realpath(source))) === key(realTo))) {
      throw new SkillInputError(`${basename(source)} is in ${to} already.`);
    }
    if (info.isDirectory() && (inside(source, to) || (realTo && inside(await realpath(source), realTo)))) {
      throw new SkillInputError(`${source} cannot move into itself.`);
    }
    let name = basename(source);
    const wanted = join(to, name);
    if (taken.has(key(wanted)) || (await exists(wanted))) {
      if (input.onExists !== "rename")
        throw new SkillInputError(
          `${wanted} exists already. HXBot never replaces it; give onExists: "rename" to use a free name such as "${name.replace(/(\.[^.]*)?$/, " (2)$1")}".`,
        );
      name = await freeName(to, name, taken);
      renamed.push(name);
    }
    const destination = join(to, name);
    taken.add(key(destination));
    plans.push({ from: source, to: destination, info });
  }
  let madeFolder = false;
  if (!target) {
    await mkdir(to, { recursive: true });
    madeFolder = true;
  }
  let moved: Moved[];
  try {
    moved = await runMoves(plans, host);
  } catch (error) {
    if (madeFolder) await rmdir(to).catch(() => undefined);
    throw error;
  }
  const leftBehind = moved.flatMap((item) => item.leftBehind);
  return {
    done: `Moved ${plans.length} item${plans.length === 1 ? "" : "s"} to ${to}.${leftBehind.length ? ` The copies are complete, but ${leftBehind.length} originals could not be removed.` : ""}`,
    moves: plans.map((plan) => ({ from: plan.from, to: plan.to, kind: kindOf(plan.info) })),
    created: madeFolder ? [to] : [],
    checks: await moveChecks(plans, moved),
    details: {
      ...(madeFolder ? { madeFolder: to } : {}),
      ...(renamed.length ? { renamed } : {}),
      ...(moved.some((item) => item.how === "copied") ? { copiedAcrossDisks: true } : {}),
      ...(leftBehind.length ? { leftBehind: leftBehind.slice(0, 20) } : {}),
    },
  };
}

export async function hxFilesRename(source: string, params: unknown, host: HxFilesHost = {}): Promise<HxFilesOutcome> {
  const input = FILES_PARAMS.rename.parse(params ?? {});
  const info = await exists(source);
  if (!info) throw new SkillInputError(`${source} is not there.`);
  let name = hxCheckName(input.name);
  const folder = dirname(source);
  if (name === basename(source).normalize("NFC")) throw new SkillInputError(`${source} has this name already.`);
  let destination = join(folder, name);
  const there = await exists(destination);
  // On a Mac or Windows "Report.pdf" and "report.pdf" are one file: change the case through a free name.
  const caseOnly = there !== null && sameFile(there, info);
  if (there && !caseOnly) {
    if (input.onExists !== "rename")
      throw new SkillInputError(
        `${destination} exists already. HXBot never replaces it; give onExists: "rename" to use a free name.`,
      );
    name = await freeName(folder, name, new Set());
    destination = join(folder, name);
  }
  const plan: Planned = { from: source, to: destination, info };
  if (caseOnly) {
    const step = join(folder, `.${name}.hx-rename-${process.pid}`);
    await rename(source, step);
    await rename(step, destination).catch(async (error: unknown) => {
      await rename(step, source).catch(() => undefined);
      throw error;
    });
  } else await runMoves([plan], host);
  const listed = (await readdir(folder)).some((entry) => entry.normalize("NFC") === name);
  const now = await lstat(destination).catch(() => null);
  const checks: HxReadbackCheck[] = [
    {
      what: `the name ${name}`,
      ok: listed && now !== null && sameFile(now, info),
      expected: name,
      actual: listed ? name : "(not found)",
    },
  ];
  if (!caseOnly) {
    const gone = !(await exists(source));
    checks.push({
      what: `${basename(source)} gone`,
      ok: gone,
      expected: "gone",
      actual: gone ? "gone" : "still there",
    });
  }
  const oldExt = extname(source).toLowerCase();
  const newExt = extname(destination).toLowerCase();
  return {
    done: `Renamed ${basename(source)} to ${name}.`,
    moves: [{ from: source, to: destination, kind: kindOf(info) }],
    created: [],
    checks,
    details: {
      ...(info.isFile() && oldExt !== newExt
        ? {
            note: `The extension changed from ${oldExt || "(none)"} to ${newExt || "(none)"}; the content was not converted.`,
          }
        : {}),
      ...(name !== input.name.normalize("NFC") ? { freeName: name } : {}),
    },
  };
}

// ------------------------------------------------------------------------------------- zip and unzip

export async function hxFilesZip(
  sources: readonly string[],
  output: string,
  params: unknown,
  host: HxFilesHost = {},
): Promise<HxFilesOutcome> {
  FILES_PARAMS.zip.parse(params ?? {});
  if (sources.length === 0) throw new SkillInputError("Give the files or folders to pack.");
  if (extname(output).toLowerCase() !== ".zip") throw new SkillInputError("The archive's name must end in .zip.");
  if (await exists(output))
    throw new SkillInputError(`${output} exists already; HXBot never replaces it. Give another output name.`);
  if (!(await exists(dirname(output)))?.isDirectory())
    throw new SkillInputError(`The folder ${dirname(output)} is not there.`);
  for (const source of sources) if (!(await exists(source))) throw new SkillInputError(`${source} is not there.`);
  const { sources: entries, skipped, metadata } = await hxZipSources(sources, host.signal);
  if (entries.length === 0)
    throw new SkillInputError("There is nothing to pack: links and special files are left out.");
  const bytes = entries.reduce((sum, entry) => sum + entry.size + 200, 0);
  await needSpace(host, dirname(output), bytes);
  const written = await hxZipWrite(entries, output, { ...(host.signal ? { signal: host.signal } : {}) });
  const verify = await hxZipVerify(output, host.signal);
  const expected = entries.map((entry) => entry.name);
  const namesMatch =
    verify.names.length === expected.length && verify.names.every((name, index) => name === expected[index]);
  return {
    done: `Packed ${entries.filter((entry) => !entry.directory).length} files into ${basename(output)} (${mb(written.bytes)}).`,
    moves: [],
    created: [output],
    checks: [
      {
        what: "every entry's checksum",
        ok: verify.bad.length === 0,
        expected: "all match",
        actual: verify.bad.length ? `${verify.bad.length} differ: ${verify.bad.slice(0, 5).join(", ")}` : "all match",
      },
      { what: "the entries", ok: namesMatch, expected: `${expected.length}`, actual: `${verify.names.length}` },
    ],
    details: {
      entries: written.entries,
      bytes: written.bytes,
      ...(skipped.length ? { leftOut: skipped.slice(0, 20) } : {}),
      ...(metadata ? { macMetadataLeftOut: metadata } : {}),
    },
  };
}

/** The folder an archive unpacks into when none is given: its name, beside it, never an existing one. */
export async function hxUnzipFolder(archive: string): Promise<string> {
  const folder = dirname(archive);
  const name = basename(archive, extname(archive)) || "archive";
  if (!(await exists(join(folder, name)))) return join(folder, name);
  return join(folder, await freeName(folder, name, new Set()));
}

export async function hxFilesUnzip(
  archive: string,
  output: string,
  params: unknown,
  host: HxFilesHost = {},
): Promise<HxFilesOutcome> {
  FILES_PARAMS.unzip.parse(params ?? {});
  const info = await exists(archive);
  if (!info?.isFile()) throw new SkillInputError(`${archive} is not a file.`);
  const handle = await open(archive, "r");
  let size: number;
  let expectedFiles: number;
  try {
    const directory = await hxZipEntries(handle);
    hxCheckEntries(directory);
    size = hxEntriesSize(directory);
    expectedFiles = directory.entries.filter(
      (entry) => !entry.directory && !entry.link && !(entry.path && hxMacMetadata(entry.path)),
    ).length;
  } finally {
    await handle.close();
  }
  const target = await exists(output);
  if (target && !target.isDirectory()) throw new SkillInputError(`${output} is a file, not a folder.`);
  if (!(await exists(dirname(output)))?.isDirectory() && !target)
    throw new SkillInputError(`The folder ${dirname(output)} is not there.`);
  await needSpace(host, target ? output : dirname(output), size);
  if (!target) await mkdir(output);
  let result: Awaited<ReturnType<typeof hxUnzipTo>>;
  try {
    result = await hxUnzipTo(archive, output, { ...(host.signal ? { signal: host.signal } : {}) });
  } catch (error) {
    if (!target) await rmdir(output).catch(() => undefined);
    throw error;
  }
  // Read back from the disk: each file by its checksum, within a budget; the rest by its size.
  let budget = READBACK_BYTES;
  const differ: string[] = [];
  let byChecksum = 0;
  for (const file of result.files) {
    host.signal?.throwIfAborted();
    const now = await lstat(file.path).catch(() => null);
    if (!now || now.size !== file.size) {
      differ.push(file.path);
      continue;
    }
    if (budget < file.size) continue;
    budget -= file.size;
    byChecksum += 1;
    let crc = 0;
    for await (const chunk of createReadStream(file.path, { highWaterMark: 1024 * 1024 })) crc = crc32(chunk, crc);
    if (crc !== file.crc) differ.push(file.path);
  }
  return {
    done: `Unpacked ${result.files.length} files into ${output}.`,
    moves: [],
    created: [...(target ? [] : [output]), ...result.files.map((file) => file.path)],
    checks: [
      {
        what: "the files read back",
        ok: differ.length === 0,
        expected: "all match",
        actual: differ.length
          ? `${differ.length} differ: ${differ.slice(0, 5).join(", ")}`
          : `all match (${byChecksum} by checksum, ${result.files.length - byChecksum} by size)`,
      },
      {
        what: "the files",
        ok: result.files.length === expectedFiles,
        expected: `${expectedFiles}`,
        actual: `${result.files.length}`,
      },
    ],
    details: {
      files: result.files.length,
      folders: result.folders,
      ...(result.skippedLinks ? { linksLeftOut: result.skippedLinks } : {}),
      ...(result.metadata ? { macMetadataLeftOut: result.metadata } : {}),
      ...(target ? {} : { madeFolder: output }),
    },
  };
}
