// HXBot 不打扰其他应用（v1.7.0，F9）：Windows 上停一个助手的进程时，不关掉它打开的应用。
//
// 用户 2026-11-14 选了“别的应用卡死或退出”。助手的进程（codex、claude 等）停下时（重启、空闲重启、退出 HXBot），
// 上游用 `taskkill /T /F` 结束整棵进程树：助手打开、还连在树上的记事本、Word、浏览器等也一起被强行关掉，
// 没保存的内容就丢了。这里先列出整棵树：有可见窗口的应用和它下面的进程留下，其余的按 PID 结束。
// 列不出来（PowerShell 没在时限内回答）时照旧用 `/T`：助手的进程必须停下。
//
// 另外（“别的应用变卡、风扇响”）：助手的进程和它跑的命令（编译、测试）以“低于正常”的优先级运行，
// 用户自己的应用先用处理器。它们启动的进程继承这个优先级（Mac、Linux 的 nice；Windows 的优先级类）。

import { constants, setPriority } from "node:os";
import { type HxRunner, hxRun } from "./hx-computer/runner";
import { HX_POWERSHELL } from "./hx-computer/tables-win";

/** How long the list may take; after it, the whole tree stops as before. */
const HX_TREE_LIST_MS = 4_000;

// Every process under HX_PID, from the leaves up. A process with a visible window (an app the
// agent opened) stays, with everything under it. One line: the PIDs to stop, separated by spaces.
const LIST_TREE = `$root = [int]$env:HX_PID
$all = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId)
$kids = @{}
foreach ($p in $all) { $k = [int]$p.ParentProcessId; if (-not $kids.ContainsKey($k)) { $kids[$k] = New-Object System.Collections.ArrayList }; [void]$kids[$k].Add([int]$p.ProcessId) }
$windowed = @{}
foreach ($g in Get-Process) { if ($g.MainWindowHandle -ne 0) { $windowed[$g.Id] = $true } }
$stop = New-Object System.Collections.ArrayList
$seen = @{}
function Walk([int]$id) {
  if ($seen.ContainsKey($id)) { return }
  $seen[$id] = $true
  if ($id -ne $root -and $windowed.ContainsKey($id)) { return }
  if ($kids.ContainsKey($id)) { foreach ($c in $kids[$id]) { if ($c -ne $id) { Walk $c } } }
  [void]$stop.Add($id)
}
Walk $root
'HX ' + ($stop -join ' ')`;

function powershell(text: string): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(text, "utf16le").toString("base64"),
  ];
}

/** The PIDs to stop from the answer, leaves first and `root` last; null when the answer is not one. */
export function hxTreeAnswer(stdout: string, root: number): number[] | null {
  const line = stdout
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .find((item) => item.startsWith("HX "));
  if (line === undefined) return null;
  const pids = line
    .slice(3)
    .split(/\s+/u)
    .filter((item) => /^\d+$/u.test(item))
    .map((item) => Number.parseInt(item, 10))
    .filter((pid) => pid > 0);
  // The root comes last in a full answer. An answer without it is no answer.
  return pids.at(-1) === root ? pids : null;
}

/**
 * The processes of the tree under `root` that are no app with a window, leaves first and `root`
 * last. Null when the list could not be read in time: then the caller stops the whole tree.
 */
export async function hxTreeWithoutApps(root: number, run: HxRunner = hxRun): Promise<number[] | null> {
  const result = await run(HX_POWERSHELL, powershell(LIST_TREE), {
    timeoutMs: HX_TREE_LIST_MS,
    env: { HX_PID: String(root) },
  }).catch(() => null);
  if (result?.code !== 0) return null;
  return hxTreeAnswer(result.stdout, root);
}

/** The taskkill arguments that stop these processes one by one: no `/T`, so nothing under an app goes. */
export function hxTaskkillArgs(pids: readonly number[]): string[] {
  return [...pids.flatMap((pid) => ["/PID", String(pid)]), "/F"];
}

/**
 * An agent's provider process and what it runs go below normal priority (v1.7.0): the user's own apps
 * get the processor first. Nothing changes when the system refuses.
 */
export function hxLowerAgentPriority(pid: number): void {
  try {
    setPriority(pid, constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // A process that already ended, or a system that refuses: it runs at the priority it has.
  }
}
