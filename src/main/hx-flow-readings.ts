// HXBot 并发（一）：桌面端读这台电脑的几项读数（v1.7.1，CONC-01）：macOS 的可用内存与内存压力，
// 智能体进程的常驻内存（Linux 读 /proc，macOS 读 ps，Windows 读 tasklist）。
//
// Only Node's own modules, so the HX-Flow system check (scripts/hx-flow-system-check.ts) runs these
// same readings on GitHub's Windows and macOS machines as one small file. hx-flow-memory.ts uses them.
import { execFile } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import { constants, setPriority, totalmem } from "node:os";
import { promisify } from "node:util";
import type { HxFlowAgentMemory, HxFlowPressure } from "../backend/hx-flow/budget";

const run = promisify(execFile);
const WINDOWS_TASKLIST_MS = 5_000;
/** A process smaller than this (a shell, a wrapper) is not a provider process. */
const MIN_PROCESS_BYTES = 32 * 1024 * 1024;

/** macOS: vm_stat (free, inactive, purgeable and speculative pages) and the kernel pressure level. */
export async function readMacMemory(): Promise<{
  totalBytes: number;
  availableBytes: number;
  pressure: HxFlowPressure | null;
}> {
  const { stdout } = await run("/usr/bin/vm_stat", [], { timeout: 3_000 });
  return {
    totalBytes: totalmem(),
    availableBytes: parseVmStat(stdout),
    pressure: await readMacPressure(),
  };
}

function parseVmStat(text: string): number {
  const pageSize = Number(/page size of (\d+) bytes/u.exec(text)?.[1] ?? 16_384);
  const pages = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+)\\.`, "mu").exec(text)?.[1] ?? 0);
  return (
    (pages("Pages free") + pages("Pages inactive") + pages("Pages purgeable") + pages("Pages speculative")) * pageSize
  );
}

async function readMacPressure(): Promise<HxFlowPressure | null> {
  try {
    const { stdout } = await run("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], { timeout: 3_000 });
    const level = Number(stdout.trim());
    if (level >= 4) return "critical";
    if (level === 2) return "warn";
    return "normal";
  } catch {
    return null;
  }
}

export async function linuxDescendantBytes(electronPath: string): Promise<HxFlowAgentMemory> {
  const entries = await readdir("/proc");
  const parents = new Map<number, number>();
  const rss = new Map<number, number>();
  await Promise.all(
    entries
      .filter((entry) => /^\d+$/u.test(entry))
      .map(async (entry) => {
        const pid = Number(entry);
        try {
          const status = await readFile(`/proc/${pid}/status`, "utf8");
          const ppid = Number(/^PPid:\s+(\d+)$/mu.exec(status)?.[1] ?? 0);
          const kib = Number(/^VmRSS:\s+(\d+) kB$/mu.exec(status)?.[1] ?? 0);
          parents.set(pid, ppid);
          rss.set(pid, kib * 1024);
        } catch {
          // The process ended.
        }
      }),
  );
  const own = await descendants(parents);
  let total = 0;
  let processes = 0;
  for (const pid of own) {
    const exe = await readlink(`/proc/${pid}/exe`).catch(() => "");
    if (exe === electronPath) continue;
    const bytes = rss.get(pid) ?? 0;
    total += bytes;
    // A shell or a wrapper of a few MB is not a provider process.
    if (bytes >= MIN_PROCESS_BYTES) processes += 1;
  }
  return { bytes: total, processes };
}

export async function psDescendantBytes(electronPath: string): Promise<HxFlowAgentMemory> {
  const { stdout } = await run("/bin/ps", ["-axo", "pid=,ppid=,rss=,comm="], {
    timeout: 3_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const parents = new Map<number, number>();
  const rss = new Map<number, { bytes: number; command: string }>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    parents.set(pid, Number(match[2]));
    rss.set(pid, { bytes: Number(match[3]) * 1024, command: match[4] ?? "" });
  }
  let total = 0;
  let processes = 0;
  for (const pid of await descendants(parents)) {
    const entry = rss.get(pid);
    if (!entry || entry.command.startsWith(electronPath) || entry.command.includes(" Helper")) continue;
    total += entry.bytes;
    if (entry.bytes >= MIN_PROCESS_BYTES) processes += 1;
  }
  return { bytes: total, processes };
}

/**
 * Windows: the resident memory of the provider processes that HXBot started (`providerProcessIds`),
 * from one run of tasklist at a priority below normal. Not PowerShell: one start of it takes about
 * 22 s on Windows 11 ARM (more than the time limit, so the reading never came back and started again)
 * and about half a second of processor time on x64, at every reading. tasklist gives no parent
 * process, so the processes that a provider process starts are not counted; the provider process
 * holds most of the memory of a turn.
 */
export async function windowsAgentBytes(pids: ReadonlySet<number>): Promise<HxFlowAgentMemory> {
  if (pids.size === 0) return { bytes: 0, processes: 0 };
  const stdout = await new Promise<string>((done, fail) => {
    const child = execFile(
      "tasklist.exe",
      ["/FO", "CSV", "/NH"],
      { timeout: WINDOWS_TASKLIST_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, out) => (error ? fail(error) : done(String(out))),
    );
    if (child.pid === undefined) return;
    try {
      setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // It ended already, or the system refuses: it runs at the priority it has.
    }
  });
  return hxTasklistBytes(stdout, pids);
}

/**
 * The memory of these processes in the output of `tasklist /FO CSV /NH`. A line is
 * "name","pid","session","number","12,345 K"; the separator of the thousands follows the language of
 * Windows (a comma, a period, a space), so only the digits count.
 */
export function hxTasklistBytes(stdout: string, pids: ReadonlySet<number>): HxFlowAgentMemory {
  let bytes = 0;
  let processes = 0;
  for (const line of stdout.split(/\r?\n/u)) {
    const fields = [...line.matchAll(/"([^"]*)"/gu)].map((match) => match[1] ?? "");
    if (fields.length < 5 || !pids.has(Number(fields[1]))) continue;
    const digits = (fields[4] ?? "").replace(/\D/gu, "");
    if (!digits) continue;
    const size = Number(digits) * 1024;
    bytes += size;
    if (size >= MIN_PROCESS_BYTES) processes += 1;
  }
  return { bytes, processes };
}

async function descendants(parents: ReadonlyMap<number, number>): Promise<Set<number>> {
  const children = new Map<number, number[]>();
  for (const [pid, ppid] of parents) {
    const list = children.get(ppid) ?? [];
    list.push(pid);
    children.set(ppid, list);
  }
  const found = new Set<number>();
  const pending = [...(children.get(process.pid) ?? [])];
  for (let pid = pending.pop(); pid !== undefined; pid = pending.pop()) {
    if (found.has(pid)) continue;
    found.add(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  return found;
}
