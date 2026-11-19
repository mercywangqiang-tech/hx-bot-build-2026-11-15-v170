// HXBot（v1.7.2）：一台电脑上的所有 HXBot 进程共用一个容量 B。
//
// 用户 2026-11-18：“HXBot启动后，电脑文件打开存储都出先卡死现象！”
// v1.7.1 的容量闸（hx-flow-memory.ts）按这台电脑的空闲内存算出 B，但每个 HXBot 进程各算各的：“这台电脑上的
// 服务器”每个都是一个 HXBot 进程（最多 5 个），每个都按同样的空闲内存放 B 个回合同时跑，合起来可以是 B 的好几倍，
// 内存被占满、电脑换页，别的应用打开、保存文件都卡住。这里让每个进程把自己在跑的回合数写进一个共用的文件夹
// （每个进程一个小文件），每个进程能开的回合 = B − 别的进程在跑的回合，至少 1。旧的（超过 20 秒没更新）和
// 进程已经不在的文件不算，并顺手删掉。

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";

/** A file older than this is not counted: its process stopped writing (idle, or gone). */
export const HX_FLOW_SHARE_STALE_MS = 20_000;

interface HxFlowShareOptions {
  folder: string;
  pid?: number;
  now?: () => number;
  alive?: (pid: number) => boolean;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/** One file of the share. */
interface HxFlowShareEntry {
  running: number;
  at: number;
}

function readEntry(text: string): HxFlowShareEntry | null {
  try {
    const value = JSON.parse(text);
    if (!isDynamicRecord(value)) return null;
    const { running, at } = value;
    if (typeof running !== "number" || !Number.isInteger(running) || running < 0) return null;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    return { running, at };
  } catch {
    return null;
  }
}

/** The turns that the HXBot processes of this computer run, shared through one folder. */
export class HxFlowShare {
  readonly #folder: string;
  readonly #pid: number;
  readonly #now: () => number;
  readonly #alive: (pid: number) => boolean;
  #written: number | null = null;

  constructor(options: HxFlowShareOptions) {
    this.#folder = options.folder;
    this.#pid = options.pid ?? process.pid;
    this.#now = options.now ?? Date.now;
    this.#alive = options.alive ?? processAlive;
  }

  /** Writes the turns that this process runs now. A failed write leaves the share as it was. */
  write(running: number): void {
    try {
      mkdirSync(this.#folder, { recursive: true });
      writeFileSync(join(this.#folder, `${this.#pid}.json`), JSON.stringify({ running, at: this.#now() }));
      this.#written = running;
    } catch {
      // A folder that cannot be written: this process counts only its own turns, as before.
    }
  }

  /** The last count this process wrote, or null before the first write. */
  written(): number | null {
    return this.#written;
  }

  /** The turns that the other HXBot processes of this computer run now. */
  others(): number {
    let names: string[];
    try {
      names = readdirSync(this.#folder);
    } catch {
      return 0;
    }
    let total = 0;
    for (const name of names) {
      const match = /^(\d+)\.json$/u.exec(name);
      if (!match?.[1]) continue;
      const pid = Number(match[1]);
      if (pid === this.#pid) continue;
      const path = join(this.#folder, name);
      let entry: HxFlowShareEntry | null = null;
      try {
        entry = readEntry(readFileSync(path, "utf8"));
      } catch {
        continue;
      }
      if (!this.#alive(pid)) {
        rmSync(path, { force: true });
        continue;
      }
      if (!entry || this.#now() - entry.at > HX_FLOW_SHARE_STALE_MS) continue;
      total += entry.running;
    }
    return total;
  }

  /** Removes the file of this process, at quit. */
  close(): void {
    try {
      rmSync(join(this.#folder, `${this.#pid}.json`), { force: true });
    } catch {
      // Nothing to remove.
    }
  }
}

/** The limit of this process: B less the turns the others run, never below 1. */
export function hxSharedTurnLimit(budget: number, others: number): number {
  return Math.max(1, budget - others);
}
