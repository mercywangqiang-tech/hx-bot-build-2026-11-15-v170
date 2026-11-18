// HXBot v1.7.1 (HX-Flow): the readings of the computer on real systems (GitHub's Windows and macOS
// machines), bundled into one file that needs only Node:
//   bun build scripts/hx-flow-system-check.ts --target=node --format=esm --outfile=dist-check/hx-flow-system-check.mjs
//   node hx-flow-system-check.mjs --out out --machine windows-2025
// Windows: the memory of the agent processes from tasklist (not PowerShell); the PowerShell that stays
// (how long until it is ready, how long each answer takes, against one start of a new one); the list
// of a process tree before a stop, and that the stop leaves an app with a window open.
// macOS (CONC-01-A4): the free memory that vm_stat gives against the kernel's memory pressure level
// and `memory_pressure`, recorded once; the memory of the agent processes from ps.
// Writes out/report.json and out/summary.md. Run it only on a machine for checks: it starts and stops
// processes of its own.
import { execFile, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { hxPowerShell } from "../src/backend/hx-powershell";
import { hxTaskkillArgs, hxTreeWithoutApps } from "../src/backend/hx-process-keep";
import { hxTasklistBytes, linuxDescendantBytes, psDescendantBytes, readMacMemory } from "../src/main/hx-flow-readings";

// Node's own parser: the bundle must not bring the app's logging (scripts/script-arguments.ts) along.
const { values } = parseArgs({ options: { out: { type: "string" }, machine: { type: "string" } } });
const OUT = values.out ?? "out";
const MACHINE = values.machine ?? process.platform;
const MIB = 1024 * 1024;
mkdirSync(OUT, { recursive: true });

interface Item {
  id: string;
  pass: boolean;
  detail: string;
  ms?: number;
}
const items: Item[] = [];
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

function command(
  file: string,
  args: readonly string[],
  timeout = 120_000,
): Promise<{ stdout: string; ms: number; ok: boolean }> {
  const start = performance.now();
  return new Promise((done) => {
    execFile(file, [...args], { timeout, windowsHide: true, maxBuffer: 16 * MIB }, (error, stdout) =>
      done({ stdout: String(stdout), ms: Math.round(performance.now() - start), ok: !error }),
    );
  });
}

/** A Node process that holds `mb` of memory until it is stopped. */
function holder(mb: number) {
  return spawn(
    process.execPath,
    ["-e", `globalThis.held = Buffer.alloc(${mb} * 1024 * 1024, 1); setInterval(() => {}, 1e6);`],
    {
      stdio: "ignore",
      windowsHide: true,
    },
  );
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function windows(): Promise<void> {
  // 1. The memory of two agent processes from tasklist.
  const children = [holder(150), holder(150)];
  await wait(3_000);
  const pids = new Set(children.flatMap((child) => (child.pid === undefined ? [] : [child.pid])));
  const list = await command("tasklist.exe", ["/FO", "CSV", "/NH"], 30_000);
  const reading = hxTasklistBytes(list.stdout, pids);
  items.push({
    id: "win.tasklist",
    pass: list.ok && reading.processes === 2 && reading.bytes >= 2 * 140 * MIB && reading.bytes <= 2 * 400 * MIB,
    detail: `2 个各占 150 MB 的进程：tasklist 读到 ${(reading.bytes / MIB).toFixed(0)} MB、${reading.processes} 个`,
    ms: list.ms,
  });
  for (const child of children) child.kill();

  // 2. One start of a new PowerShell (the way of v1.7.0), twice.
  for (const round of [1, 2]) {
    const once = await command("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "exit 0"]);
    items.push({ id: `win.powershell.start${round}`, pass: once.ok, detail: "启动一次新的 PowerShell", ms: once.ms });
  }

  // 3. The PowerShell that stays: until it is ready, then each answer.
  const warmAt = performance.now();
  hxPowerShell.warm();
  while (!hxPowerShell.ready && performance.now() - warmAt < 120_000) await wait(100);
  items.push({
    id: "win.resident.ready",
    pass: hxPowerShell.ready,
    detail: "常驻 PowerShell 就绪",
    ms: Math.round(performance.now() - warmAt),
  });
  const answers: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const start = performance.now();
    const answer = await hxPowerShell.ask("Write-Output ('HX ' + $env:HX_N)", { HX_N: String(index) }, 10_000);
    answers.push(Math.round(performance.now() - start));
    if (answer?.trim() !== `HX ${index}`) answers.push(-1);
  }
  items.push({
    id: "win.resident.answer",
    pass: !answers.includes(-1),
    detail: `5 次回答（毫秒）：${answers.join("、")}`,
    ms: Math.max(...answers),
  });

  // 4. A tree like an agent's: a window (an app it opened) and a process with no window. The stop
  // keeps the window. The root is a shell, as when an agent runs `start`: a Node root would put its
  // own children in libuv's kill-on-close job, and they would close with it.
  const formScript = Buffer.from(
    'Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form; $f.Text = "HX check"; [System.Windows.Forms.Application]::Run($f)',
    "utf16le",
  ).toString("base64");
  const root = spawn(
    "cmd.exe",
    [
      "/d",
      "/s",
      "/c",
      `"start "" powershell.exe -NoProfile -EncodedCommand ${formScript} & ping -n 300 127.0.0.1 > nul"`,
    ],
    { stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true },
  );
  const childrenDeadline = performance.now() + 30_000;
  let ids: { form: number; worker: number } | null = null;
  while (root.pid !== undefined && ids === null && performance.now() < childrenDeadline) {
    const rows = await command("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${root.pid}' | ForEach-Object { '' + $_.ProcessId + ' ' + $_.Name }`,
    ]);
    const children = rows.stdout
      .split(/\r?\n/u)
      .map((line) => /^(\d+) (.+)$/u.exec(line.trim()))
      .filter((match) => match !== null);
    const shell = children.find((match) => match[2]?.toLowerCase() === "powershell.exe");
    const ping = children.find((match) => match[2]?.toLowerCase() === "ping.exe");
    if (shell && ping) ids = { form: Number(shell[1]), worker: Number(ping[1]) };
    else await wait(500);
  }
  // The window opens a few seconds after PowerShell starts (more on ARM).
  const windowDeadline = performance.now() + 90_000;
  let windowed = false;
  while (ids && !windowed && performance.now() < windowDeadline) {
    const found = await command("powershell.exe", [
      "-NoProfile",
      "-Command",
      `(Get-Process -Id ${ids.form} -ErrorAction SilentlyContinue).MainWindowHandle -ne 0`,
    ]);
    windowed = found.stdout.trim() === "True";
    if (!windowed) await wait(1_000);
  }
  const treeAt = performance.now();
  const tree = root.pid === undefined ? null : await hxTreeWithoutApps(root.pid);
  const treeMs = Math.round(performance.now() - treeAt);
  const listed = tree !== null;
  const stopping = tree ?? [];
  items.push({
    id: "win.tree",
    pass:
      ids !== null &&
      windowed &&
      listed &&
      stopping.includes(ids.worker) &&
      !stopping.includes(ids.form) &&
      stopping.at(-1) === root.pid,
    detail: `进程树（经常驻 PowerShell）：${tree === null ? "没在时限内列出" : `要停的 ${tree.length} 个，含无窗口的进程：${ids ? tree.includes(ids.worker) : "—"}，含有窗口的应用：${ids ? tree.includes(ids.form) : "—"}`}`,
    ms: treeMs,
  });
  if (tree && ids) {
    await command("taskkill.exe", hxTaskkillArgs(tree), 30_000);
    await wait(2_000);
    items.push({
      id: "win.stop.keeps-app",
      pass: alive(ids.form) && !alive(ids.worker) && root.pid !== undefined && !alive(root.pid),
      detail: `停下后：有窗口的应用${alive(ids.form) ? "还开着" : "被关掉了"}，无窗口的进程${alive(ids.worker) ? "还在" : "已停"}`,
    });
    await command("taskkill.exe", ["/PID", String(ids.form), "/T", "/F"], 30_000);
  } else {
    root.kill();
  }
  hxPowerShell.close();
}

async function mac(): Promise<void> {
  // CONC-01-A4: vm_stat against the kernel's pressure level and memory_pressure, once.
  const reading = await readMacMemory();
  const level = await command("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], 10_000);
  const pressure = await command("/usr/bin/memory_pressure", [], 30_000);
  const free = /System-wide memory free percentage:\s*(\d+)%/u.exec(pressure.stdout)?.[1];
  items.push({
    id: "mac.memory",
    pass: reading.availableBytes > 0 && reading.availableBytes <= reading.totalBytes,
    detail: `总内存 ${(reading.totalBytes / MIB).toFixed(0)} MB；vm_stat 估算可用 ${(reading.availableBytes / MIB).toFixed(0)} MB（${((reading.availableBytes / reading.totalBytes) * 100).toFixed(0)}%）；内核压力等级 ${level.stdout.trim() || "—"}（HX 读作 ${reading.pressure ?? "未知"}）；memory_pressure 说空闲 ${free ?? "—"}%`,
  });
  writeFileSync(join(OUT, "memory_pressure.txt"), pressure.stdout);
  const children = [holder(150), holder(150)];
  await wait(3_000);
  const agents = await psDescendantBytes(`${process.execPath}.none`);
  items.push({
    id: "mac.agents",
    pass: agents.processes >= 2 && agents.bytes >= 2 * 140 * MIB,
    detail: `2 个各占 150 MB 的子进程：ps 读到 ${(agents.bytes / MIB).toFixed(0)} MB、${agents.processes} 个`,
  });
  for (const child of children) child.kill();
}

async function linux(): Promise<void> {
  const children = [holder(150), holder(150)];
  await wait(3_000);
  const agents = await linuxDescendantBytes(`${process.execPath}.none`);
  items.push({
    id: "linux.agents",
    pass: agents.processes >= 2 && agents.bytes >= 2 * 140 * MIB,
    detail: `2 个各占 150 MB 的子进程：/proc 读到 ${(agents.bytes / MIB).toFixed(0)} MB、${agents.processes} 个`,
  });
  for (const child of children) child.kill();
}

const started = Date.now();
try {
  if (process.platform === "win32") await windows();
  else if (process.platform === "darwin") await mac();
  else await linux();
} catch (error) {
  items.push({
    id: "error",
    pass: false,
    detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
}
const report = {
  machine: MACHINE,
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  totalMb: Math.round(totalmem() / MIB),
  freeMb: Math.round(freemem() / MIB),
  ms: Date.now() - started,
  passed: items.every((item) => item.pass),
  items,
};
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(
  join(OUT, "summary.md"),
  [
    `## HX-Flow 系统检查 · ${MACHINE}`,
    "",
    "| 项 | 结果 | 用时 | 说明 |",
    "|---|---|---|---|",
    ...items.map(
      (item) =>
        `| ${item.id} | ${item.pass ? "通过" : "失败"} | ${item.ms ?? ""} | ${item.detail.replace(/\|/gu, "/")} |`,
    ),
    "",
  ].join("\n"),
);
process.exitCode = report.passed ? 0 : 1;
