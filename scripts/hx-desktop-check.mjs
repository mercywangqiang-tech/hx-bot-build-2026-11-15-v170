#!/usr/bin/env node
// HXBot v1.7.2：程序坞、任务栏和打开/保存对话框的真机检查（GitHub 的 Mac、Windows 机器上跑）。
//
// 用户 2026-11-18：“在windows 和mac的程序坞出现多个HXBot的图表！”“HXBot启动后，电脑文件打开存储都出先卡死现象！”
//
//   node scripts/hx-desktop-check.mjs --exe <HXBot 程序> --label <名字> --out <report.json> [--servers 3] [--expect-clean]
//
// 1. 本机服务器：像 local-servers.ts 那样用 HXBot 程序启动几个子进程，40 秒里每秒看一次：
//    Mac 上它们是不是程序坞里的应用（lsappinfo 的 ApplicationType 为 Foreground 就在程序坞里）；
//    Windows 上它们有没有任务栏里的窗口。
// 2. 桌面端：启动 HXBot 本身（临时的数据文件夹，不登录），45 秒里每秒数 HXBot 在程序坞/任务栏里的图标，
//    Windows 上同时数新出现的控制台窗口。
// 3. 对话框：HXBot（含本机服务器）开着和关着时，各在系统自带的编辑器（Mac 文本编辑、Windows 记事本）里按 5 次
//    保存，记下“保存”对话框出现用了多久。
// 结果写进 --out 的 JSON，并在最后一行打印一行总结。不需要网络、不登录、不改这台机器的设置。
// --expect-clean：本机服务器在程序坞/任务栏里出现过、或（Windows）HXBot 开出过控制台窗口时，以 1 退出。

import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};
const exe = option("exe", "") && resolve(option("exe", ""));
const label = option("label", "build");
const out = option("out", join(process.cwd(), "hx-desktop-check.json"));
const serverCount = Number(option("servers", "3"));
const expectClean = args.includes("--expect-clean");
const mac = process.platform === "darwin";
const windows = process.platform === "win32";
if (!exe || (!mac && !windows)) {
  console.error("Usage: node scripts/hx-desktop-check.mjs --exe <HXBot> --label <name> --out <report.json>");
  process.exit(2);
}

const run = (command, list, timeout = 30_000) =>
  new Promise((resolve) => {
    execFile(
      command,
      list,
      { encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => resolve({ ok: !error, stdout: stdout ?? "", stderr: stderr ?? "" }),
    );
  });
const powershell = (script, timeout = 120_000) =>
  run(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    timeout,
  );

const root = mkdtempSync(join(tmpdir(), "hx-desktop-check-"));
const report = {
  label,
  platform: process.platform,
  exe,
  startedAt: new Date().toISOString(),
  servers: null,
  desktop: null,
  dialogs: null,
};
const children = [];

function startServer(index) {
  const userData = join(root, `server-${index}`);
  const agents = join(root, `agents-${index}`);
  mkdirSync(userData, { recursive: true });
  mkdirSync(agents, { recursive: true });
  const child = spawn(exe, [`--user-data-dir=${userData}`], {
    env: {
      ...process.env,
      HXBOT_LOCAL_SERVER_CHILD: "1",
      HXBOT_LOCAL_SERVER_ROOT: agents,
      HXBOT_LOCAL_SERVER_NAME: `check-${index}`,
      HXBOT_LOCAL_SERVER_SECRET: randomBytes(24).toString("base64url"),
    },
    // As local-servers.ts: the control pipe is stdin on macOS and fd 3 on Windows.
    stdio: windows ? ["ignore", "pipe", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const started = Date.now();
  const entry = { index, pid: child.pid, readyMs: null, exited: null, child };
  child.stdout?.on("data", (chunk) => {
    if (entry.readyMs === null && String(chunk).includes("HXBOT_LOCAL_SERVER_READY "))
      entry.readyMs = Date.now() - started;
  });
  child.stderr?.resume();
  child.on("exit", (code, signal) => {
    entry.exited = { code, signal, afterMs: Date.now() - started };
  });
  children.push(entry);
  return entry;
}

function stopAll() {
  for (const entry of children) {
    try {
      entry.child.kill();
    } catch {}
  }
}

async function macForeground(pids) {
  const result = {};
  for (const pid of pids) {
    const info = await run("/usr/bin/lsappinfo", ["info", "-only", "ApplicationType", "-app", `pid=${pid}`], 5_000);
    const match = /"ApplicationType"="([^"]+)"/u.exec(info.stdout);
    result[pid] = match ? match[1] : "none";
  }
  return result;
}

// Windows: the visible top-level windows that the taskbar shows (no owner, not a tool window, or an app
// window), of the given processes, and the visible console windows of any process.
const WIN_SAMPLER = (pids, seconds, includeNamed) => `
Add-Type @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class HxW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static List<string> Rows() {
    var rows = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint p; GetWindowThreadProcessId(h, out p);
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      int ex = GetWindowLong(h, -20);
      bool owned = GetWindow(h, 4) != IntPtr.Zero;
      bool tool = (ex & 0x80) != 0; bool app = (ex & 0x40000) != 0;
      bool taskbar = app || (!owned && !tool);
      rows.Add(p + "|" + c.ToString() + "|" + (taskbar ? 1 : 0));
      return true;
    }, IntPtr.Zero);
    return rows;
  }
}
'@
$watch = @(${pids.join(",") || "0"})
for ($i = 0; $i -lt ${seconds}; $i++) {
  $named = @()
  ${includeNamed ? "$named = @(Get-Process -Name HXBot -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })" : ""}
  $ids = $watch + $named
  $taskbar = 0; $consoles = 0
  foreach ($r in [HxW]::Rows()) {
    $f = $r.Split('|'); $p = [int]$f[0]; $cls = $f[1]; $tb = $f[2] -eq '1'
    if ($tb -and ($ids -contains $p)) { $taskbar++ }
    if ($cls -eq 'ConsoleWindowClass' -or $cls -eq 'CASCADIA_HOSTING_WINDOW_CLASS') { $consoles++ }
  }
  "$i $taskbar $consoles"
  Start-Sleep -Seconds 1
}`;

async function windowsSample(pids, seconds, includeNamed) {
  const result = await powershell(WIN_SAMPLER(pids, seconds, includeNamed), (seconds + 60) * 1000);
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim().split(" ").map(Number))
    .filter((row) => row.length === 3 && row.every(Number.isFinite))
    .map(([second, taskbar, consoles]) => ({ second, taskbar, consoles }));
}

async function checkServers() {
  for (let i = 0; i < serverCount; i++) startServer(i);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && children.some((entry) => entry.readyMs === null && entry.exited === null))
    await sleep(1_000);
  const pids = children.map((entry) => entry.pid);
  const samples = [];
  if (mac) {
    for (let second = 0; second < 40; second++) {
      const types = await macForeground(pids);
      samples.push({ second, inDock: Object.values(types).filter((type) => type === "Foreground").length, types });
      await sleep(1_000);
    }
  } else {
    for (const row of await windowsSample(pids, 40, false))
      samples.push({ second: row.second, inTaskbar: row.taskbar, consoles: row.consoles });
  }
  const key = mac ? "inDock" : "inTaskbar";
  return {
    servers: children.map(({ index, pid, readyMs, exited }) => ({ index, pid, readyMs, exited })),
    samples,
    max: Math.max(0, ...samples.map((sample) => sample[key])),
    key,
  };
}

async function macDesktopIcons(pid) {
  const types = await macForeground([pid]);
  return types[pid] === "Foreground" ? 1 : 0;
}

async function checkDesktop() {
  const userData = join(root, "desktop");
  mkdirSync(userData, { recursive: true });
  const before = windows ? ((await windowsSample([], 1, false))[0]?.consoles ?? 0) : 0;
  const desktop = spawn(exe, [`--user-data-dir=${userData}`], { stdio: "ignore", windowsHide: false, detached: false });
  children.push({ index: "desktop", pid: desktop.pid, readyMs: null, exited: null, child: desktop });
  await sleep(15_000);
  const samples = [];
  if (mac) {
    for (let second = 0; second < 45; second++) {
      const pids = [desktop.pid, ...children.filter((entry) => entry.index !== "desktop").map((entry) => entry.pid)];
      const types = await macForeground(pids);
      samples.push({ second, inDock: Object.values(types).filter((type) => type === "Foreground").length });
      await sleep(1_000);
    }
  } else {
    for (const row of await windowsSample([desktop.pid], 45, true))
      samples.push({
        second: row.second,
        inTaskbar: row.taskbar,
        consoles: row.consoles,
        newConsoles: Math.max(0, row.consoles - before),
      });
  }
  const key = mac ? "inDock" : "inTaskbar";
  return {
    pid: desktop.pid,
    samples,
    max: Math.max(0, ...samples.map((sample) => sample[key])),
    maxNewConsoles: windows ? Math.max(0, ...samples.map((sample) => sample.newConsoles)) : 0,
    key,
    desktopAlone: mac ? await macDesktopIcons(desktop.pid) : null,
  };
}

const MAC_SAVE = `
tell application "TextEdit" to activate
tell application "TextEdit" to make new document
delay 1
set t0 to (current date)
tell application "System Events" to tell process "TextEdit" to keystroke "s" using command down
set started to do shell script "perl -MTime::HiRes=time -e 'printf(\\"%.3f\\", time)'"
repeat 200 times
  tell application "System Events" to tell process "TextEdit"
    if exists sheet 1 of window 1 then exit repeat
  end tell
  delay 0.05
end repeat
set ended to do shell script "perl -MTime::HiRes=time -e 'printf(\\"%.3f\\", time)'"
tell application "System Events" to key code 53
delay 0.5
tell application "TextEdit" to close every document saving no
return (ended as real) - (started as real)`;

const WIN_SAVE = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class HxD {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@
$p = Start-Process notepad -PassThru
Start-Sleep -Seconds 2
$w = (Get-Process -Id $p.Id -ErrorAction SilentlyContinue).MainWindowHandle
if (-not $w) { $w = (Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).MainWindowHandle }
[void][HxD]::SetForegroundWindow($w)
Start-Sleep -Milliseconds 500
$sw = [Diagnostics.Stopwatch]::StartNew()
[System.Windows.Forms.SendKeys]::SendWait('^s')
$found = $false
while ($sw.ElapsedMilliseconds -lt 15000) {
  $h = [HxD]::FindWindow('#32770', $null)
  if ($h -ne [IntPtr]::Zero) { $found = $true; break }
  Start-Sleep -Milliseconds 25
}
$ms = $sw.ElapsedMilliseconds
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
Start-Sleep -Milliseconds 300
Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if ($found) { "MS $ms" } else { "NONE $ms" }`;

async function saveDialogMs() {
  if (mac) {
    const result = await run("/usr/bin/osascript", ["-e", MAC_SAVE], 40_000);
    const seconds = Number.parseFloat(result.stdout.trim());
    return result.ok && Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
  }
  const result = await powershell(WIN_SAVE, 40_000);
  const match = /^MS (\d+)/mu.exec(result.stdout);
  return match ? Number(match[1]) : null;
}

async function checkDialogs(phase) {
  const times = [];
  for (let i = 0; i < 5; i++) {
    times.push(await saveDialogMs());
    await sleep(1_000);
  }
  const measured = times.filter((value) => value !== null).sort((a, b) => a - b);
  return { phase, times, medianMs: measured.length ? measured[Math.floor(measured.length / 2)] : null };
}

try {
  const without = await checkDialogs("without HXBot");
  report.servers = await checkServers();
  report.desktop = await checkDesktop();
  const withApp = await checkDialogs("with HXBot and its servers");
  report.dialogs = { without, with: withApp };
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
} finally {
  stopAll();
}
report.endedAt = new Date().toISOString();
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
const servers = report.servers
  ? `${report.servers.key} max ${report.servers.max} of ${serverCount} servers`
  : "servers: no result";
const desktop = report.desktop
  ? `desktop ${report.desktop.key} max ${report.desktop.max}${windows ? `, new consoles max ${report.desktop.maxNewConsoles}` : ""}`
  : "desktop: no result";
const dialogs = report.dialogs
  ? `save dialog median ${report.dialogs.without.medianMs} ms without, ${report.dialogs.with.medianMs} ms with`
  : "dialogs: no result";
console.log(`[${label}] ${servers}; ${desktop}; ${dialogs}`);
const dirty =
  !report.servers ||
  report.servers.max > 0 ||
  report.servers.servers.some((server) => server.exited !== null) ||
  (windows && (!report.desktop || report.desktop.maxNewConsoles > 0));
if (expectClean && dirty) {
  console.log(
    `[${label}] NOT CLEAN: a local server was in the ${mac ? "Dock" : "taskbar"}, ended early, or a console window opened.`,
  );
  process.exit(1);
}
process.exit(0);
