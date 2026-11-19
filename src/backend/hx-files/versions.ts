// HXBot v1.7.4（BAK-03）：改已有文件前留一份版本。
//
// 放在数据文件夹的 file-versions/ 下，每个任务（一段对话）一个文件夹：
//   <任务>/<SHA-256>.blob   文件内容，同样的内容只存一份
//   <任务>/<版本号>.json    这份版本：路径、哈希、大小、时间、任务、哪个助手、哪个工具
//   <任务>/events.jsonl     依次记下的事：留了版本、开始写、写好了、恢复了，每条有递增的序号
// 先写版本记录（“正在保存”），再存内容、读回核对，最后把记录改成“已保存”。进程在哪一步被杀，下次启动都能
// 认出来：内容不全的那份标成“没存好”，留在用户文件夹里的临时文件删掉。
//
// 上限默认取 2 GiB 和数据所在磁盘的 5% 中小的那个，可以在设置里改。到了上限不删任何旧版本，而是告诉调用的人
// “满了”，由用户选清理旧版本、这次不留版本，或者取消修改。旧版本只在用户自己要求时才删。
import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, open, readdir, readFile, rename, rm, stat, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { HxLocks } from "./lock";
import {
  HxWriteError,
  type HxWriteFaults,
  hxCreateFile,
  hxReplaceFile,
  hxTargetOf,
  isCode,
  sha256,
  sha256File,
  syncFolder,
  toWriteError,
} from "./safe-write";

export const HX_VERSION_CAP_BYTES = 2 * 1024 * 1024 * 1024;
export const HX_VERSION_CAP_SHARE = 0.05;
/** Kept free on the disk beyond a new version, so that saving one never fills the disk. */
export const HX_VERSION_DISK_MARGIN = 256 * 1024 * 1024;

export type HxVersionState = "saving" | "saved" | "failed";
export type HxVersionReason = "before-change" | "before-restore";

export interface HxVersionRecord {
  version: 1;
  id: string;
  task: string;
  path: string;
  sha256: string;
  size: number;
  createdAt: number;
  state: HxVersionState;
  reason: HxVersionReason;
  agent: string;
  tool: string;
  /** Times this version was put back. */
  restoredAt: number[];
}

export type HxVersionEventType =
  | "version-saved"
  | "version-failed"
  | "write-started"
  | "file-written"
  | "write-abandoned"
  | "restored"
  | "no-version"
  | "versions-deleted";

export interface HxVersionEvent {
  seq: number;
  at: number;
  type: HxVersionEventType;
  path?: string;
  versionId?: string;
  sha256?: string;
  previousSha256?: string;
  temp?: string;
  detail?: string;
}

export type HxSaveResult =
  | { status: "saved"; record: HxVersionRecord }
  | {
      status: "space-full";
      /** "cap": the versions reached their limit; "disk": the disk itself is nearly full. */
      why: "cap" | "disk";
      usedBytes: number;
      capBytes: number;
      neededBytes: number;
    }
  | { status: "changed" }
  | { status: "failed"; reason: string };

export type HxRestoreResult =
  | { status: "restored"; record: HxVersionRecord; previousSha256: string | null; keptVersion: HxVersionRecord | null }
  | { status: "unchanged"; record: HxVersionRecord }
  | { status: "space-full"; usedBytes: number; capBytes: number; neededBytes: number }
  | { status: "missing"; reason: string }
  | { status: "damaged"; reason: string }
  | { status: "failed"; reason: string };

export interface HxVersionSettings {
  capBytes: number;
  defaultCapBytes: number;
  custom: boolean;
  usedBytes: number;
  versions: number;
  tasks: number;
}

export interface HxVersionTask {
  task: string;
  versions: number;
  bytes: number;
  newest: number;
  oldest: number;
  agents: string[];
  paths: string[];
}

export interface HxFileVersionsOptions {
  /** The folder file-versions; read at each use, because the data folder is set at the start. */
  root: () => string;
  now?: () => number;
  /** Free and total bytes of the disk that holds `path`. */
  disk?: (path: string) => Promise<{ free: number; total: number }>;
  faults?: HxVersionFaults;
  locks?: HxLocks;
}

/** Points where a test stops a save. Production passes none. */
export interface HxVersionFaults extends HxWriteFaults {
  /** After the record says "saving" and before the content is copied. */
  afterRecord?: () => Promise<void> | void;
  /** After the content is in place and before the record says "saved". */
  beforeSaved?: () => Promise<void> | void;
  /** After the new file took the place of the old one and before that is recorded. */
  afterReplace?: () => Promise<void> | void;
}

const SETTINGS_FILE = "settings.json";
const EVENTS_FILE = "events.jsonl";
const USAGE_TTL_MS = 30_000;

async function diskOf(path: string): Promise<{ free: number; total: number }> {
  const info = await statfs(path);
  return { free: info.bavail * info.bsize, total: info.blocks * info.bsize };
}

/** The folder name of a task: letters, digits, - and _, with a hash when the id has other characters. */
export function hxTaskFolder(task: string): string {
  const clean = task.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  if (clean === task && clean.length > 0) return clean;
  const hash = createHash("sha256").update(task).digest("hex").slice(0, 12);
  return `${clean || "task"}-${hash}`;
}

/** Owns file-versions/: the versions, their records, the events of each task and the limit. */
export class HxFileVersions {
  readonly #options: HxFileVersionsOptions;
  readonly #locks: HxLocks;
  readonly #seq = new Map<string, number>();
  #usage: { bytes: number; versions: number; tasks: number; at: number } | null = null;

  constructor(options: HxFileVersionsOptions) {
    this.#options = options;
    this.#locks = options.locks ?? new HxLocks({ folder: () => join(options.root(), ".locks") });
  }

  get locks(): HxLocks {
    return this.#locks;
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  async #disk(): Promise<{ free: number; total: number }> {
    const root = this.#options.root();
    await mkdir(root, { recursive: true, mode: 0o700 });
    return (this.#options.disk ?? diskOf)(root);
  }

  async settings(): Promise<HxVersionSettings> {
    const { capBytes, defaultCapBytes, custom } = await this.#cap();
    const usage = await this.#scanUsage(true);
    return { capBytes, defaultCapBytes, custom, usedBytes: usage.bytes, versions: usage.versions, tasks: usage.tasks };
  }

  /** Sets the limit in bytes; null goes back to the default. Lowering it deletes nothing. */
  async setCap(bytes: number | null): Promise<HxVersionSettings> {
    if (bytes !== null && (!Number.isSafeInteger(bytes) || bytes < 0))
      throw new Error("The limit must be a whole number of bytes.");
    const root = this.#options.root();
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeJson(join(root, SETTINGS_FILE), { version: 1, capBytes: bytes });
    return this.settings();
  }

  async #cap(): Promise<{ capBytes: number; defaultCapBytes: number; custom: boolean }> {
    const disk = await this.#disk().catch(() => null);
    const defaultCapBytes = disk
      ? Math.min(HX_VERSION_CAP_BYTES, Math.floor(disk.total * HX_VERSION_CAP_SHARE))
      : HX_VERSION_CAP_BYTES;
    const stored = parseJson(await readText(join(this.#options.root(), SETTINGS_FILE)), SettingsSchema);
    const custom = stored?.capBytes ?? null;
    return { capBytes: custom ?? defaultCapBytes, defaultCapBytes, custom: custom !== null };
  }

  async #scanUsage(fresh = false): Promise<{ bytes: number; versions: number; tasks: number }> {
    const now = this.#now();
    if (!fresh && this.#usage && now - this.#usage.at < USAGE_TTL_MS) return this.#usage;
    const root = this.#options.root();
    let bytes = 0;
    let versions = 0;
    let tasks = 0;
    for (const task of await listDirs(root)) {
      tasks += 1;
      for (const name of await readdir(join(root, task)).catch(noNames)) {
        if (name.endsWith(".json")) versions += 1;
        if (name.endsWith(".blob") || name.endsWith(".json") || name === EVENTS_FILE || name.startsWith(".tmp-")) {
          bytes += await stat(join(root, task, name)).then(
            (info) => info.size,
            () => 0,
          );
        }
      }
    }
    this.#usage = { bytes, versions, tasks, at: now };
    return this.#usage;
  }

  /**
   * Saves the content of the existing file `path` as a version of `task`. With `expectSha256`, it
   * answers `changed` when the file is no longer the one the caller read. The caller holds the file's
   * lock (see `withFile`), so that nothing changes the file between this and the write.
   */
  async save(input: {
    path: string;
    task: string;
    agent: string;
    tool: string;
    reason?: HxVersionReason;
    expectSha256?: string;
  }): Promise<HxSaveResult> {
    const root = this.#options.root();
    const folder = join(root, hxTaskFolder(input.task));
    let target: string;
    let size: number;
    try {
      target = await hxTargetOf(input.path);
      const info = await stat(target);
      if (!info.isFile()) return { status: "failed", reason: "The path is not a file." };
      size = info.size;
    } catch (error) {
      return { status: "failed", reason: toWriteError(error).message };
    }
    const { capBytes } = await this.#cap();
    const usage = await this.#scanUsage();
    const disk = await this.#disk().catch(() => null);
    if (disk && disk.free < size + HX_VERSION_DISK_MARGIN) {
      return { status: "space-full", why: "disk", usedBytes: usage.bytes, capBytes, neededBytes: size };
    }
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const id = `v${this.#now().toString(36)}${randomBytes(5).toString("hex")}`;
    const record: HxVersionRecord = {
      version: 1,
      id,
      task: input.task,
      path: target,
      sha256: "",
      size,
      createdAt: this.#now(),
      state: "saving",
      reason: input.reason ?? "before-change",
      agent: input.agent.slice(0, 200),
      tool: input.tool.slice(0, 200),
      restoredAt: [],
    };
    const recordFile = join(folder, `${id}.json`);
    const temp = join(folder, `.tmp-${id}`);
    try {
      await writeJson(recordFile, record);
      await this.#options.faults?.afterRecord?.();
      // Copy and hash in one read, so that the hash is the hash of what was kept.
      const copied = await copyHashing(target, temp, this.#options.faults);
      if (input.expectSha256 !== undefined && copied.sha256 !== input.expectSha256) {
        await unlink(temp).catch(() => undefined);
        await this.#fail(recordFile, record, "The file changed while it was copied.");
        return { status: "changed" };
      }
      const blob = join(folder, `${copied.sha256}.blob`);
      const exists = await sha256File(blob).then(
        (found) => found.sha256 === copied.sha256,
        () => false,
      );
      if (exists) {
        await unlink(temp).catch(() => undefined);
      } else {
        if (usage.bytes + copied.size > capBytes) {
          await unlink(temp).catch(() => undefined);
          await rm(recordFile, { force: true });
          return { status: "space-full", why: "cap", usedBytes: usage.bytes, capBytes, neededBytes: copied.size };
        }
        await rename(temp, blob);
        await syncFolder(folder);
        // Read back: the version on disk is the content that was hashed.
        const back = await sha256File(blob);
        if (back.sha256 !== copied.sha256) {
          await unlink(blob).catch(() => undefined);
          await this.#fail(recordFile, record, "The kept copy does not read back.");
          return { status: "failed", reason: "The kept copy does not read back." };
        }
      }
      await this.#options.faults?.beforeSaved?.();
      const saved: HxVersionRecord = { ...record, sha256: copied.sha256, size: copied.size, state: "saved" };
      await writeJson(recordFile, saved);
      this.#usage = null;
      await this.event(input.task, { type: "version-saved", path: target, versionId: id, sha256: copied.sha256 });
      return { status: "saved", record: saved };
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      const reason = toWriteError(error);
      await this.#fail(recordFile, record, reason.message).catch(() => undefined);
      if (reason.code === "disk-full") {
        return { status: "space-full", why: "disk", usedBytes: usage.bytes, capBytes, neededBytes: size };
      }
      return { status: "failed", reason: reason.message };
    }
  }

  async #fail(recordFile: string, record: HxVersionRecord, detail: string): Promise<void> {
    await writeJson(recordFile, { ...record, state: "failed" });
    await this.event(record.task, { type: "version-failed", path: record.path, versionId: record.id, detail });
  }

  /** Runs `body` while it holds the lock of the file `path` (by its real path). */
  async withFile<T>(path: string, body: () => Promise<T>): Promise<T> {
    const target = await hxTargetOf(path).catch(() => path);
    return this.#locks.with(
      `file:${process.platform === "win32" || process.platform === "darwin" ? target.toLowerCase() : target}`,
      body,
    );
  }

  /**
   * Writes `content` over the existing file and records it. The caller saved a version first (or the
   * user chose to keep none) and holds the file's lock.
   */
  async write(input: {
    path: string;
    task: string;
    content: Uint8Array;
    expectSha256: string;
    versionId: string | null;
  }): Promise<{ sha256: string; size: number; how: "replace" | "in-place" }> {
    let temp: string | null = null;
    const next = sha256(input.content);
    const result = await hxReplaceFile(input.path, input.content, {
      expectSha256: input.expectSha256,
      faults: this.#options.faults,
      onTemp: async (path) => {
        temp = path;
        await this.event(input.task, {
          type: "write-started",
          path: input.path,
          temp: path,
          sha256: next,
          ...(input.versionId ? { versionId: input.versionId } : {}),
          previousSha256: input.expectSha256,
        });
      },
    }).catch(async (error: unknown) => {
      await this.event(input.task, {
        type: "write-abandoned",
        path: input.path,
        ...(temp ? { temp } : {}),
        detail: error instanceof Error ? error.message.slice(0, 200) : "failed",
      }).catch(() => undefined);
      throw error;
    });
    await this.#options.faults?.afterReplace?.();
    await this.event(input.task, {
      type: "file-written",
      path: input.path,
      sha256: result.sha256,
      previousSha256: input.expectSha256,
      ...(input.versionId ? { versionId: input.versionId } : {}),
    });
    return result;
  }

  /** Records that the user chose to change the file without a version this time. */
  async noVersion(task: string, path: string, detail: string): Promise<void> {
    await this.event(task, { type: "no-version", path, detail });
  }

  async record(task: string, id: string): Promise<HxVersionRecord | null> {
    if (!/^v[0-9a-z]{6,24}$/.test(id)) return null;
    return readRecord(join(this.#options.root(), hxTaskFolder(task), `${id}.json`));
  }

  /**
   * v1.7.4 (#54): a version by its id alone, in whichever task keeps it, for the card of a change.
   * The id is a random name of a file in one task's folder; a record whose own id differs is not it.
   */
  async find(id: string): Promise<HxVersionRecord | null> {
    if (!/^v[0-9a-z]{6,24}$/.test(id)) return null;
    const root = this.#options.root();
    for (const folder of await listDirs(root)) {
      const record = await readRecord(join(root, folder, `${id}.json`));
      if (record?.id === id) return record;
    }
    return null;
  }

  /**
   * Puts the version back. The file as it is now is kept as a version first, so that the restore
   * can itself be undone; with `keepCurrent: false` (the user's choice when the space is full) it is not.
   */
  async restore(input: {
    task: string;
    versionId: string;
    agent: string;
    keepCurrent?: boolean;
  }): Promise<HxRestoreResult> {
    const record = await this.record(input.task, input.versionId);
    if (!record) return { status: "missing", reason: "This version is not kept any more." };
    if (record.state !== "saved") return { status: "damaged", reason: "This version was not saved completely." };
    const blob = join(this.#options.root(), hxTaskFolder(record.task), `${record.sha256}.blob`);
    return this.withFile(record.path, async (): Promise<HxRestoreResult> => {
      const kept = await sha256File(blob).catch(() => null);
      if (!kept) return { status: "missing", reason: "The kept copy is not there any more." };
      if (kept.sha256 !== record.sha256) return { status: "damaged", reason: "The kept copy is damaged." };
      let current: { sha256: string; size: number } | null;
      try {
        current = await sha256File(record.path);
      } catch (error) {
        if (!isCode(error, "ENOENT")) return { status: "failed", reason: toWriteError(error).message };
        current = null;
      }
      if (current && current.sha256 === record.sha256) return { status: "unchanged", record };
      let keptVersion: HxVersionRecord | null = null;
      if (current && input.keepCurrent !== false) {
        const saved = await this.save({
          path: record.path,
          task: record.task,
          agent: input.agent,
          tool: "restore",
          reason: "before-restore",
          expectSha256: current.sha256,
        });
        if (saved.status === "space-full") {
          return {
            status: "space-full",
            usedBytes: saved.usedBytes,
            capBytes: saved.capBytes,
            neededBytes: saved.neededBytes,
          };
        }
        if (saved.status === "changed") return { status: "failed", reason: "The file changed meanwhile. Try again." };
        if (saved.status === "failed") return { status: "failed", reason: saved.reason };
        keptVersion = saved.record;
      }
      const content = await readFile(blob);
      try {
        if (current) {
          await this.write({
            path: record.path,
            task: record.task,
            content,
            expectSha256: current.sha256,
            versionId: keptVersion?.id ?? null,
          });
        } else {
          await hxCreateFile(record.path, content, { faults: this.#options.faults });
        }
      } catch (error) {
        return { status: "failed", reason: toWriteError(error).message };
      }
      const restored: HxVersionRecord = { ...record, restoredAt: [...record.restoredAt, this.#now()].slice(-50) };
      await writeJson(join(this.#options.root(), hxTaskFolder(record.task), `${record.id}.json`), restored);
      await this.event(record.task, {
        type: "restored",
        path: record.path,
        versionId: record.id,
        sha256: record.sha256,
        ...(current ? { previousSha256: current.sha256 } : {}),
      });
      return { status: "restored", record: restored, previousSha256: current?.sha256 ?? null, keptVersion };
    });
  }

  /** The versions of one task, newest first. */
  async list(task: string): Promise<HxVersionRecord[]> {
    const folder = join(this.#options.root(), hxTaskFolder(task));
    const records: HxVersionRecord[] = [];
    for (const name of await readdir(folder).catch(noNames)) {
      if (!name.endsWith(".json")) continue;
      const value = await readRecord(join(folder, name));
      if (value) records.push(value);
    }
    return records.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Every task with versions, newest first, for Settings. */
  async tasks(): Promise<HxVersionTask[]> {
    const root = this.#options.root();
    const found: HxVersionTask[] = [];
    for (const folder of await listDirs(root)) {
      const records: HxVersionRecord[] = [];
      let bytes = 0;
      for (const name of await readdir(join(root, folder)).catch(noNames)) {
        const size = await stat(join(root, folder, name)).then(
          (info) => info.size,
          () => 0,
        );
        bytes += size;
        if (!name.endsWith(".json")) continue;
        const value = await readRecord(join(root, folder, name));
        if (value) records.push(value);
      }
      if (records.length === 0) continue;
      const times = records.map((record) => record.createdAt);
      found.push({
        task: records[0]?.task ?? folder,
        versions: records.length,
        bytes,
        newest: Math.max(...times),
        oldest: Math.min(...times),
        agents: [...new Set(records.map((record) => record.agent))].slice(0, 10),
        paths: [...new Set(records.map((record) => record.path))].slice(0, 20),
      });
    }
    return found.sort((a, b) => b.newest - a.newest);
  }

  /** Deletes the versions of a task. Only on the user's own request (Settings, or the space-full card). */
  async deleteTask(task: string): Promise<void> {
    await rm(join(this.#options.root(), hxTaskFolder(task)), { recursive: true, force: true });
    this.#usage = null;
  }

  /** Deletes the tasks whose newest version is older than `before`. Only on the user's own request. */
  async deleteOlderThan(before: number) {
    let deleted = 0;
    for (const task of await this.tasks()) {
      if (task.newest >= before) continue;
      await this.deleteTask(task.task);
      deleted += 1;
    }
    return deleted;
  }

  /** Appends an event to the task's log, with the next number of the task. */
  async event(task: string, event: Omit<HxVersionEvent, "seq" | "at">): Promise<HxVersionEvent> {
    const folder = join(this.#options.root(), hxTaskFolder(task));
    return this.#locks.with(`events:${folder}`, async () => {
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const file = join(folder, EVENTS_FILE);
      let seq = this.#seq.get(folder);
      if (seq === undefined) seq = (await readEvents(file)).reduce((top, item) => Math.max(top, item.seq), 0);
      const next: HxVersionEvent = { seq: seq + 1, at: this.#now(), ...event };
      await appendFile(file, `${JSON.stringify(next)}\n`, { mode: 0o600 });
      this.#seq.set(folder, next.seq);
      return next;
    });
  }

  async events(task: string): Promise<HxVersionEvent[]> {
    return readEvents(join(this.#options.root(), hxTaskFolder(task), EVENTS_FILE));
  }

  /**
   * After a crash: a record still "saving" becomes "failed" unless its content is complete; HXBot's own
   * temporary files are removed, in file-versions and next to the user's files. No version is deleted.
   */
  async recover(): Promise<{ records: number; temps: number }> {
    const root = this.#options.root();
    let records = 0;
    let temps = 0;
    for (const folder of await listDirs(root)) {
      const dir = join(root, folder);
      for (const name of await readdir(dir).catch(noNames)) {
        if (name.startsWith(".tmp-")) {
          await unlink(join(dir, name)).catch(() => undefined);
          temps += 1;
          continue;
        }
        if (!name.endsWith(".json")) continue;
        const value = await readRecord(join(dir, name));
        if (value?.state !== "saving") continue;
        records += 1;
        await writeJson(join(dir, name), { ...value, state: "failed" });
        await this.event(value.task, {
          type: "version-failed",
          path: value.path,
          versionId: value.id,
          detail: "interrupted",
        });
      }
      // Writes that started and never ended: their temporary file stays next to the user's file.
      const events = await readEvents(join(dir, EVENTS_FILE));
      const open = new Map<string, HxVersionEvent>();
      for (const event of events) {
        if (event.type === "write-started" && event.temp) open.set(event.temp, event);
        if ((event.type === "file-written" || event.type === "write-abandoned") && event.path) {
          for (const [temp, started] of open) if (started.path === event.path) open.delete(temp);
        }
      }
      for (const [temp, started] of open) {
        if (!/\.hx-[0-9a-f]{12}\.tmp$/.test(temp)) continue;
        const removed = await unlink(temp).then(
          () => true,
          () => false,
        );
        if (removed) temps += 1;
        const task = (await this.list(folder)).at(0)?.task ?? folder;
        // The rename is the moment of the change: the file on disk tells whether it happened.
        const now = started.path ? await sha256File(started.path).catch(() => null) : null;
        if (now && started.sha256 && now.sha256 === started.sha256) {
          await this.event(task, {
            type: "file-written",
            ...(started.path ? { path: started.path } : {}),
            sha256: started.sha256,
            ...(started.previousSha256 ? { previousSha256: started.previousSha256 } : {}),
            ...(started.versionId ? { versionId: started.versionId } : {}),
            detail: "recovered",
          });
          continue;
        }
        await this.event(task, {
          type: "write-abandoned",
          ...(started.path ? { path: started.path } : {}),
          temp,
          detail: "interrupted",
        });
      }
    }
    this.#usage = null;
    return { records, temps };
  }
}

async function copyHashing(
  from: string,
  to: string,
  faults?: HxWriteFaults,
): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  const source = await open(from, "r");
  try {
    const target = await open(to, "wx", 0o600);
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      for (;;) {
        const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        const chunk = buffer.subarray(0, bytesRead);
        hash.update(chunk);
        size += bytesRead;
        await faults?.onChunk?.(bytesRead);
        await target.write(chunk, 0, bytesRead);
      }
      await target.sync();
    } finally {
      await target.close();
    }
  } finally {
    await source.close();
  }
  return { sha256: hash.digest("hex"), size };
}

async function listDirs(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name);
}

function noNames(): string[] {
  return [];
}

async function readText(path: string): Promise<string | null> {
  try {
    const text = await readFile(path, "utf8");
    return text.startsWith("\uFEFF") ? text.slice(1) : text;
  } catch {
    return null;
  }
}

function parseJson<T>(text: string | null, schema: z.ZodType<T>): T | null {
  if (text === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const RecordSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  task: z.string(),
  path: z.string(),
  sha256: z.string(),
  size: z.number(),
  createdAt: z.number(),
  state: z.enum(["saving", "saved", "failed"]),
  reason: z.enum(["before-change", "before-restore"]),
  agent: z.string(),
  tool: z.string(),
  restoredAt: z.array(z.number()),
});

const EventSchema = z.object({
  seq: z.number(),
  at: z.number(),
  type: z.enum([
    "version-saved",
    "version-failed",
    "write-started",
    "file-written",
    "write-abandoned",
    "restored",
    "no-version",
    "versions-deleted",
  ]),
  path: z.string().optional(),
  versionId: z.string().optional(),
  sha256: z.string().optional(),
  previousSha256: z.string().optional(),
  temp: z.string().optional(),
  detail: z.string().optional(),
});

const SettingsSchema = z.object({ version: z.literal(1), capBytes: z.number().int().min(0).nullable() });

async function readRecord(path: string): Promise<HxVersionRecord | null> {
  return parseJson(await readText(path), RecordSchema);
}

/** Writes a small JSON file so that a crash leaves the old one or the new one, never half of one. */
async function writeJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomBytes(4).toString("hex")}.part`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

async function readEvents(file: string): Promise<HxVersionEvent[]> {
  const text = await readText(file);
  const events: HxVersionEvent[] = [];
  for (const line of (text ?? "").split("\n")) {
    // A line cut short by a crash does not parse; the lines before it still count.
    const event = line.trim() ? parseJson(line, EventSchema) : null;
    if (event) events.push(event);
  }
  return events;
}

export { HxWriteError };
