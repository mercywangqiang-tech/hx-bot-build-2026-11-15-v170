// HXBot v1.7.4（BAK-03）：同一个文件同一时间只让一处改。同一个进程里排队；不同的 HXBot 进程（本机的几个
// 服务器）共用数据文件夹，就在 file-versions/.locks/ 下用“只在不存在时才建”的锁文件。锁文件里写着进程号和时间：
// 进程已经不在了，或者锁放了太久（进程卡死），就当它已经放开。用户自己的文件夹里不放锁文件。
import { createHash } from "node:crypto";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { isCode } from "./safe-write";

export interface HxLockOptions {
  /** The folder of the lock files. */
  folder: () => string;
  /** A lock older than this is taken over even when its process still runs. */
  staleMs?: number;
  /** How long to wait for another process before giving up. */
  waitMs?: number;
  now?: () => number;
  pid?: number;
  alive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export class HxLockTimeout extends Error {
  constructor() {
    super("Another HXBot task is changing this file. Try again in a moment.");
    this.name = "HxLockTimeout";
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, as another user.
    return isCode(error, "EPERM");
  }
}

/** Locks by key: the real path of a file, or the name of a task. */
export class HxLocks {
  readonly #options: HxLockOptions;
  readonly #held = new Map<string, Promise<void>>();

  constructor(options: HxLockOptions) {
    this.#options = options;
  }

  /** Runs `body` while it holds the lock of `key`; the lock is released however `body` ends. */
  async with<T>(key: string, body: () => Promise<T>): Promise<T> {
    // In this process: wait for the one before.
    const before = this.#held.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = before.then(() => mine);
    this.#held.set(key, chained);
    await before;
    try {
      const file = await this.#acquire(key);
      try {
        return await body();
      } finally {
        await unlink(file).catch(() => undefined);
      }
    } finally {
      release();
      if (this.#held.get(key) === chained) this.#held.delete(key);
    }
  }

  async #acquire(key: string): Promise<string> {
    const options = this.#options;
    const now = options.now ?? Date.now;
    const pid = options.pid ?? process.pid;
    const alive = options.alive ?? processAlive;
    const staleMs = options.staleMs ?? 10 * 60_000;
    const waitMs = options.waitMs ?? 60_000;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
    const folder = options.folder();
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const file = join(folder, `${createHash("sha256").update(key).digest("hex").slice(0, 40)}.lock`);
    const started = now();
    for (let attempt = 0; ; attempt += 1) {
      try {
        const handle = await open(file, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify({ pid, at: now() }));
        } finally {
          await handle.close();
        }
        return file;
      } catch (error) {
        if (!isCode(error, "EEXIST")) throw error;
      }
      const holder = await readHolder(file);
      if (!holder) {
        // An unreadable lock is one being written at this moment, or one that a crash left empty.
        const written = await stat(file).then(
          (info) => info.mtimeMs,
          () => null,
        );
        if (written !== null && now() - written > 5_000) await unlink(file).catch(() => undefined);
        else if (written === null) continue;
      }
      if (holder && (!alive(holder.pid) || now() - holder.at > staleMs || holder.at > now() + 60_000)) {
        // Taken over: removed only if it is still the same lock.
        const again = await readHolder(file);
        if (again && again.pid === holder.pid && again.at === holder.at) await unlink(file).catch(() => undefined);
        continue;
      }
      if (now() - started > waitMs) throw new HxLockTimeout();
      await sleep(Math.min(250, 10 * 2 ** Math.min(attempt, 5)));
    }
  }
}

const HolderSchema = z.object({ pid: z.number().int(), at: z.number() });

async function readHolder(file: string): Promise<{ pid: number; at: number } | null> {
  try {
    const parsed = HolderSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
