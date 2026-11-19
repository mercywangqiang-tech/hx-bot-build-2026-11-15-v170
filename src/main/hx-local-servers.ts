// HXBot（v1.7.2）：“这台电脑上的服务器”的子进程。
//
// 用户 2026-11-18：“在windows 和mac的程序坞出现多个HXBot的图表！”（一打开就多个，用着用着变多）
// “HXBot启动后，电脑文件打开存储都出先卡死现象！”
//
// 每个本机服务器都是一个完整的 HXBot 进程（local-servers.ts 用 HXBot 自己的程序启动它，最多 5 个）。三处修正：
// 1. 启动时一个接一个地开，前一个就绪（或失败）后再开下一个；原来 HXBot 一启动就同时开全部，每个都要打开数据库、
//    恢复频道、启动助手，几个一起把处理器和磁盘占满，别的应用打开、保存文件就卡住（hx/fixes_172.py）。
// 2. 子进程以“低于正常”的优先级运行，它启动的助手进程继承这个优先级：用户自己的应用先用处理器。
// 3. 上一次留下的子进程：HXBot 被强行结束、崩溃或更新时，没收到退出信号的子进程会一直留着，每留一个，程序坞里就
//    多一个 HXBot、内存少一块。HXBot 启动时找出它们（这个 HXBot 程序、本用户的 local-servers 数据文件夹、
//    父进程已经不在了）并结束。别的用户、别的 HXBot 副本、正在用的子进程都不碰。

import { execFile } from "node:child_process";
import { constants, setPriority } from "node:os";
import { basename } from "node:path";
import { HX_POWERSHELL } from "../backend/hx-computer/tables-win";

/** One process: its id, its parent's id, and its command line. */
export interface HxProcessRow {
  pid: number;
  ppid: number;
  command: string;
}

export interface HxOrphanQuery {
  /** The executable of this HXBot (`app.getPath("exe")`). */
  executable: string;
  /** The folder that holds the user data of the servers on this computer. */
  localServersRoot: string;
  /** This process. */
  ownPid: number;
  platform: NodeJS.Platform;
  /** Whether a process runs. */
  alive(pid: number): boolean;
}

/** A local server works in the background: below normal priority. Nothing changes when the system refuses. */
export function hxBackgroundPriority(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    setPriority(pid, constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // A process that already ended, or a system that refuses: it runs at the priority it has.
  }
}

/** Whether a process runs: a process of another user that runs answers EPERM. */
function hxProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/**
 * The local server children of this HXBot whose desktop app is gone: the same executable, a user data
 * folder in this user's `local-servers` folder, and a parent that no longer runs (on macOS and Linux the
 * parent of an orphan is process 1).
 */
export function hxOrphanedLocalServers(rows: readonly HxProcessRow[], query: HxOrphanQuery): number[] {
  const windows = query.platform === "win32";
  const fold = (text: string) => (windows ? text.toLowerCase().replaceAll("/", "\\") : text);
  const executable = fold(query.executable);
  const dataFlag = fold(`--user-data-dir=${query.localServersRoot}`);
  const quotedDataFlag = fold(`"--user-data-dir=${query.localServersRoot}`);
  const orphans: number[] = [];
  for (const row of rows) {
    if (row.pid === query.ownPid || row.pid <= 1) continue;
    const command = fold(row.command.trim());
    const ownExecutable = command.startsWith(executable) || command.startsWith(`"${executable}"`);
    if (!ownExecutable) continue;
    if (!command.includes(dataFlag) && !command.includes(quotedDataFlag)) continue;
    const parentGone = row.ppid <= 1 || row.ppid === row.pid || !query.alive(row.ppid);
    if (parentGone) orphans.push(row.pid);
  }
  return orphans;
}

/** `ps` output: `pid ppid command`, one process a line. */
export function hxParsePs(text: string): HxProcessRow[] {
  const rows: HxProcessRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    if (match?.[1] && match[2] && match[3])
      rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  return rows;
}

/** The PowerShell output below: `pid<TAB>ppid<TAB>command line`, one process a line. */
export function hxParseWindowsRows(text: string): HxProcessRow[] {
  const rows: HxProcessRow[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const [pid, ppid, ...command] = line.split("\t");
    if (!pid || !ppid || !/^\d+$/u.test(pid.trim()) || !/^\d+$/u.test(ppid.trim())) continue;
    rows.push({ pid: Number(pid.trim()), ppid: Number(ppid.trim()), command: command.join("\t") });
  }
  return rows;
}

function run(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout) => resolve(error ? "" : stdout),
    );
  });
}

async function readRows(platform: NodeJS.Platform, executable: string): Promise<HxProcessRow[]> {
  if (platform === "win32") {
    const name = basename(executable).replaceAll("'", "''");
    const script = `Get-CimInstance Win32_Process -Filter "Name='${name}'" | ForEach-Object { "$($_.ProcessId)\`t$($_.ParentProcessId)\`t$($_.CommandLine)" }`;
    const stdout = await run(
      HX_POWERSHELL,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      20_000,
    );
    return hxParseWindowsRows(stdout);
  }
  return hxParsePs(await run("/bin/ps", ["-axww", "-o", "pid=,ppid=,command="], 10_000));
}

/**
 * Ends the local server children that an earlier run of this HXBot left behind. Runs once at start, in
 * the background; a process that does not end at once gets SIGKILL five seconds later. Resolves with
 * the processes it asked to end.
 */
export async function hxStopOrphanedLocalServers(options: {
  executable: string;
  localServersRoot: string;
  platform?: NodeJS.Platform;
  log?: (message: string, detail: { processes: number }) => void;
}): Promise<number[]> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "win32" && platform !== "linux") return [];
  const rows = await readRows(platform, options.executable);
  const orphans = hxOrphanedLocalServers(rows, {
    executable: options.executable,
    localServersRoot: options.localServersRoot,
    ownPid: process.pid,
    platform,
    alive: hxProcessAlive,
  });
  for (const pid of orphans) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // It ended already, or it is not ours to end.
    }
  }
  if (orphans.length > 0) {
    options.log?.("Stopped the servers on this computer that an earlier run of HXBot left running.", {
      processes: orphans.length,
    });
    const timer = setTimeout(() => {
      for (const pid of orphans) {
        if (!hxProcessAlive(pid)) continue;
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // It ended between the two checks.
        }
      }
    }, 5_000);
    timer.unref();
  }
  return orphans;
}
