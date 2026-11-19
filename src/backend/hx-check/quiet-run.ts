// HXBot 真机检查（v1.7.0）：不打扰其他应用。在 GitHub 真的 Mac、Windows 上，用产品里同一份代码检查：
//   Q1 读得到现在在最前面的应用；Q2 用户切走以后，能把目标应用叫回前台（按键只发给目标应用的前提）；
//   Q3 一个修饰键卡在“按下”时，松开修饰键以后系统里没有按下的修饰键；
//   Q4 后台读目录的命令以最低优先级运行（风扇、别的应用变卡）；
//   Q5 Windows：停助手的进程树时，它打开的有窗口的应用（记事本）留下，没窗口的后台进程（ping）停下；
//   Q6 剪贴板：用户的剪贴板内容在检查前后不变（检查本身也不能动用户的剪贴板）；
//   Q7 助手的进程和它启动的命令以“低于正常”的优先级运行。
// Electron 里的部分（高亮框读驱动的次数、通知、更新限速、剪贴板放回）由单元测试检查，这里不重复。
import { execFile, spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { hxFrontWatch } from "../hx-computer/front";
import { hxRun, hxRunBackground } from "../hx-computer/runner";
import { HX_POWERSHELL } from "../hx-computer/tables-win";
import { hxLowerAgentPriority } from "../hx-process-keep";
import { stopWindowsProcessTree } from "../windows-process-tree";
import type { HxRealItems } from "./report";

const run = promisify(execFile);
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function ps(text: string): string[] {
  // No progress records: they arrive as XML on the error stream.
  const script = `$ProgressPreference = 'SilentlyContinue'; ${text}`;
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
}

/** What the command printed, without what it wrote to the error stream. */
async function output(command: string, args: readonly string[], env?: Record<string, string>): Promise<string> {
  const result = await hxRun(command, args, { timeoutMs: 30_000, ...(env ? { env } : {}) });
  return result.stdout.trim();
}

async function macPid(name: string): Promise<number | null> {
  const text = await output("/usr/bin/pgrep", ["-x", name]);
  const pid = Number.parseInt(text.split("\n")[0] ?? "", 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

async function winPids(name: string): Promise<number[]> {
  const text = await output(
    HX_POWERSHELL,
    ps(
      `@(Get-Process -Name ${name} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.Id }) -join ' '`,
    ),
  );
  return text
    .split(/\s+/u)
    .map((item) => Number.parseInt(item, 10))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
}

async function winAlive(pid: number): Promise<boolean> {
  const text = await output(
    HX_POWERSHELL,
    ps(`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`),
  );
  return text.startsWith("yes");
}

// Left and right Shift, Control, Option/Alt, Command/Windows held now, as the system sees it.
const MAC_HELD = "ObjC.import('CoreGraphics'); String(($.CGEventSourceFlagsState(1) & 0x00FF0000) >>> 0)";
const MAC_PRESS_SHIFT =
  "ObjC.import('CoreGraphics'); $.CGEventPost(0, $.CGEventCreateKeyboardEvent(null, 56, true)); 'ok'";
const WIN_USER32 =
  'Add-Type -Namespace HXQ -Name K -MemberDefinition \'[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v); [DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, System.UIntPtr e);\';\n';
const WIN_HELD = `${WIN_USER32}$n = 0; foreach ($v in 0x10,0x11,0x12,0xA0,0xA1,0xA2,0xA3,0xA4,0xA5,0x5B,0x5C) { if ([HXQ.K]::GetAsyncKeyState($v) -band 0x8000) { $n++ } }; "$n"`;
const WIN_PRESS_SHIFT = `${WIN_USER32}[HXQ.K]::keybd_event([byte]0x10, 0, 0, [System.UIntPtr]::Zero); 'ok'`;

/** The clipboard text of this computer (used by the steps check too). */
export async function hxCheckClipboardText(mac: boolean): Promise<string> {
  return mac
    ? (await hxRun("/usr/bin/pbpaste", [], { timeoutMs: 10_000 })).stdout
    : await output(HX_POWERSHELL, ps("Get-Clipboard -Raw"));
}

/** Puts text on the clipboard of this computer. */
export async function hxCheckSetClipboard(mac: boolean, text: string): Promise<void> {
  if (mac) {
    await new Promise<void>((done) => {
      const child = spawn("/usr/bin/pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
      child.on("exit", () => done());
      child.on("error", () => done());
      child.stdin.end(text);
    });
  } else await hxRun(HX_POWERSHELL, ps(`Set-Clipboard -Value $env:HX_TEXT`), { env: { HX_TEXT: text } });
}

export async function hxQuietRealCheck(input: {
  items: HxRealItems;
  log: (line: string) => void;
  platform: NodeJS.Platform;
}): Promise<void> {
  const { items, log, platform } = input;
  if (platform !== "darwin" && platform !== "win32") {
    items.add("Q1", "不打扰其他应用", "skip", `这台机器是 ${platform}，只在 Mac、Windows 上检查`);
    return;
  }
  const mac = platform === "darwin";
  const front = hxFrontWatch(hxRun, platform);
  if (!front) {
    items.add("Q1", "读最前面的应用", "fail", "这台电脑没有前台检查");
    return;
  }
  const sentinel = `hxbot-quiet-${Date.now()}`;
  await hxCheckSetClipboard(mac, sentinel);

  // Q1, Q2: the target app, then another app in front, then the target back.
  const work = await mkdtemp(join(tmpdir(), "hxbot-quiet-"));
  const file = join(work, "hxbot-quiet.txt");
  await writeFile(file, "HXBot quiet check\n", "utf8");
  let target: number | null = null;
  if (mac) {
    await run("/usr/bin/open", ["-a", "TextEdit", file]).catch(() => undefined);
    for (let i = 0; i < 20 && target === null; i++) {
      await sleep(500);
      target = await macPid("TextEdit");
    }
  } else {
    const before = new Set(await winPids("notepad"));
    spawn("notepad.exe", [file], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    for (let i = 0; i < 30 && target === null; i++) {
      await sleep(500);
      target = (await winPids("notepad")).find((pid) => !before.has(pid)) ?? null;
    }
  }
  const first = (await front.front())?.pid ?? null;
  items.check("Q1", "读得到最前面的应用", first !== null, `front ${first ?? "none"}; target ${target ?? "none"}`);
  if (target === null) items.add("Q2", "把目标应用叫回前台", "fail", `${mac ? "文本编辑" : "记事本"}没有打开`);
  else {
    // The user moves to another app. HXBot sees it, and does not pull the target back: the step
    // tools then send no key (unit tests) and ask the user.
    if (mac) await run("/usr/bin/open", ["-a", "Finder"]).catch(() => undefined);
    else spawn("explorer.exe", [work], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    await sleep(2_500);
    const away = (await front.front())?.pid ?? null;
    await sleep(1_000);
    const later = (await front.front())?.pid ?? null;
    items.check(
      "Q2",
      "用户切走以后，HXBot 看得出来，也不把目标应用拉回前台",
      away !== null && away !== target && later === away,
      `target ${target}; after the move ${away ?? "none"}; a second later ${later ?? "none"}`,
    );
  }

  // Q3: a modifier held down, then let go.
  const press = mac
    ? await output("/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_PRESS_SHIFT])
    : await output(HX_POWERSHELL, ps(WIN_PRESS_SHIFT));
  const heldBefore = mac
    ? await output("/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_HELD])
    : await output(HX_POWERSHELL, ps(WIN_HELD));
  await front.releaseModifiers();
  await sleep(1_000);
  const heldAfter = mac
    ? await output("/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_HELD])
    : await output(HX_POWERSHELL, ps(WIN_HELD));
  // Without the system's leave to post keys, the key does not go down: then nothing was checked.
  items.add(
    "Q3",
    "修饰键卡在“按下”时，松开以后没有按下的修饰键",
    heldAfter.trim() !== "0" ? "fail" : heldBefore.trim() === "0" ? "warn" : "pass",
    `press ${press}; held before ${heldBefore}; held after ${heldAfter}`,
  );

  // Q4: background commands at the lowest priority.
  const low = mac
    ? await hxRunBackground("/bin/sh", ["-c", "sleep 1; ps -o nice= -p $$"], { timeoutMs: 20_000 })
    : await hxRunBackground(HX_POWERSHELL, ps("Start-Sleep -Seconds 2; [string](Get-Process -Id $PID).PriorityClass"), {
        timeoutMs: 60_000,
      });
  const priority = low.stdout.trim();
  items.check(
    "Q4",
    "后台读目录的命令以最低优先级运行",
    mac ? priority === "19" : priority === "Idle",
    `${priority} ${low.stderr.trim().slice(0, 200)}`,
  );

  // Q5 (Windows): the agent's process tree stops; the app with a window that it opened stays.
  if (mac) items.add("Q5", "停助手的进程时留下它打开的应用", "skip", "Mac 上用 open 打开的应用不在助手的进程组里");
  else {
    const before = new Set(await winPids("notepad"));
    // As an agent's shell starts an app: `start` for the app, and a command that runs on.
    const tree = spawn("cmd.exe", ["/d", "/s", "/c", '"start "" notepad.exe & ping -n 300 127.0.0.1 > nul"'], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    let errors = "";
    tree.stderr?.on("data", (chunk: Buffer) => {
      errors += chunk.toString("utf8");
    });
    let ping = 0;
    let notepad = 0;
    let children = "";
    for (let i = 0; i < 40 && (ping === 0 || notepad === 0); i++) {
      await sleep(500);
      children = await output(
        HX_POWERSHELL,
        ps(
          "@(Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $env:HX_PID) | ForEach-Object { $_.Name + ':' + $_.ProcessId }) -join ' '",
        ),
        { HX_PID: String(tree.pid ?? 0) },
      );
      const pinged = /(?:^|\s)PING\.EXE:(\d+)/iu.exec(children);
      ping = pinged ? Number.parseInt(pinged[1] ?? "0", 10) : 0;
      const child = /(?:^|\s)notepad\.exe:(\d+)/iu.exec(children);
      const windowed = (await winPids("notepad")).find((pid) => !before.has(pid)) ?? 0;
      notepad = child && Number.parseInt(child[1] ?? "0", 10) === windowed ? windowed : 0;
    }
    log(`tree ${tree.pid}: ${children}; notepad window ${notepad}`);
    const started = Date.now();
    await Effect.runPromise(stopWindowsProcessTree(tree)).catch((error: unknown) => log(`stop: ${String(error)}`));
    const seconds = (Date.now() - started) / 1000;
    await sleep(1_000);
    const shellGone = tree.exitCode !== null || tree.signalCode !== null;
    const pingGone = ping > 0 && !(await winAlive(ping));
    const notepadKept = notepad > 0 && (await winAlive(notepad));
    items.check(
      "Q5",
      "停助手的进程树：它打开的记事本留下，后台的 ping 和 PowerShell 停下",
      shellGone && pingGone && notepadKept,
      `shell gone ${shellGone}; ping ${ping} gone ${pingGone}; notepad ${notepad} kept ${notepadKept}; ${seconds.toFixed(1)} s; children ${children.slice(0, 200)}; ${errors.slice(0, 200)}`,
    );
    if (notepad > 0) await run("taskkill", ["/PID", String(notepad), "/F"]).catch(() => undefined);
  }

  // Q7: an agent's process, and what it starts, below normal priority.
  const agent = mac
    ? spawn("/bin/sh", ["-c", "sleep 1; /bin/sh -c 'ps -o nice= -p $$'"], { stdio: ["ignore", "pipe", "ignore"] })
    : spawn(HX_POWERSHELL, ps("Start-Sleep -Seconds 2; [string](Get-Process -Id $PID).PriorityClass"), {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
  if (agent.pid !== undefined) hxLowerAgentPriority(agent.pid);
  let said = "";
  agent.stdout?.on("data", (chunk: Buffer) => {
    said += chunk.toString("utf8");
  });
  await new Promise<void>((done) => {
    agent.once("exit", () => done());
    agent.once("error", () => done());
  });
  items.check(
    "Q7",
    "助手的进程和它启动的命令以“低于正常”的优先级运行",
    mac ? said.trim() === "10" : said.trim() === "BelowNormal",
    said.trim(),
  );

  // Q6: nothing above touched the user's clipboard.
  const after = await hxCheckClipboardText(mac);
  items.check("Q6", "用户的剪贴板在检查前后不变", after.trim() === sentinel, `${JSON.stringify(after.slice(0, 80))}`);

  if (target !== null) {
    if (mac)
      await run("/usr/bin/osascript", ["-e", 'tell application "TextEdit" to quit saving no']).catch(() => undefined);
    else await run("taskkill", ["/PID", String(target), "/F"]).catch(() => undefined);
  }
}
