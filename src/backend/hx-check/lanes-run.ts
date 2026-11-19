// HXBot 真机检查（v1.7.3）：电脑操控（五）“分道与礼让”一组 L1～L11。在 GitHub 真的 Mac、Windows 上，用真的驱动
// （cua-driver）和产品里同一份分道、门、停放代码检查：
//   L1 两个智能体操作两个不同的应用，后台步骤同时进行；
//   L2 同一个应用的两次调用一个接一个；
//   L3 前台按键全机一个：目标窗口不在最前面的那个智能体停放，没有一个键落进别的窗口；
//   L4 一次调用等满 30 秒还轮不到：答复“忙”、谁在用、大约多久；
//   L5 你在用（检查自己模拟鼠标移动）：前台步骤停放（等待用户），文件里没有多一个字；
//   L6 你停手 5 秒、那个窗口在最前面：自动续做（给智能体发“继续”）；
//   L7 驱动自己发的按键不算你在用：连续三个前台按键不停放（并记下驱动的输入算不算进系统空闲时间）；
//   L8 停止键对所有道生效：在等的调用马上停下；
//   L9 直接赋值输入后读回一致（CU-06）；L9b 不能直接赋值的文字区：答复说明原因、改用按键；
//   L10 等一个不会出现的控件，10 秒后报“没等到”（CU-06）；
//   L11 回复“现在做”：把目标窗口切到最前面马上做（Windows 不允许时说明原因）。
// 只在 GitHub 的用完即毁的机器上运行：它会真的移动鼠标、输入文字并保存。
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type HxDriverAnswer, type HxDriverPort, HxDriverSocket } from "../hx-computer/driver";
import { hxFrontWatch } from "../hx-computer/front";
import { hxFrontWindow } from "../hx-computer/front-window";
import { HxComputerLanes, hxAppLane } from "../hx-computer/lanes";
import { HxParkedSteps, type HxParkedWork } from "../hx-computer/parked";
import { HxPresence } from "../hx-computer/presence";
import { hxRun } from "../hx-computer/runner";
import { type HxComputerPlan, hxComputerStepToolCall } from "../hx-computer/step-tools";
import { type HxLookSnapshot, type HxStep, HxStepRun, type HxWindowChoice } from "../hx-computer/steps";
import { HX_POWERSHELL } from "../hx-computer/tables-win";
import { hxStepWork } from "../hx-computer/work";
import type { DynamicToolCallParams } from "../protocol";
import type { HxRealItems } from "./report";
import { hxCheckStartDriver } from "./steps-run";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function ps(text: string): string[] {
  const script = `$ProgressPreference = 'SilentlyContinue'; ${text}`;
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
}

// The system's idle time, read again and again by one process (ms, one line each 250 ms).
const MAC_IDLE_LOOP =
  "ObjC.import('CoreGraphics'); ObjC.import('Foundation'); const out = $.NSFileHandle.fileHandleWithStandardOutput; for (;;) { const s = $.CGEventSourceSecondsSinceLastEventType(0, 4294967295); out.writeData($(String(Math.round(s * 1000)) + '\\n').dataUsingEncoding($.NSUTF8StringEncoding)); delay(0.25); }";
const WIN_IDLE_LOOP = `Add-Type -Namespace HXI -Name L -MemberDefinition '[StructLayout(LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; } [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII p);'; while ($true) { $l = New-Object HXI.L+LII; $l.cbSize = 8; [void][HXI.L]::GetLastInputInfo([ref]$l); $now = [long]([Environment]::TickCount) -band 0xFFFFFFFF; $idle = $now - [long]$l.dwTime; if ($idle -lt 0) { $idle += 4294967296 }; [Console]::Out.WriteLine($idle); [Console]::Out.Flush(); Start-Sleep -Milliseconds 250 }`;
// The user, as the check plays it: the mouse moves a pixel every 600 ms, back and forth.
const MAC_USER_LOOP =
  "ObjC.import('CoreGraphics'); let d = 1; for (;;) { const p = $.CGEventGetLocation($.CGEventCreate(null)); $.CGEventPost(0, $.CGEventCreateMouseEvent(null, 5, { x: p.x + d, y: p.y }, 0)); d = -d; delay(0.6); }";
const WIN_USER_LOOP = `Add-Type -Namespace HXU -Name M -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, System.UIntPtr e);'; $d = 1; while ($true) { [HXU.M]::mouse_event(1, $d, 0, 0, [System.UIntPtr]::Zero); $d = -$d; Start-Sleep -Milliseconds 600 }`;

/** The system's idle time in ms, from a process that reads it four times a second. */
function idleReader(platform: NodeJS.Platform): { idleMs: () => number; stop: () => void; fresh: () => boolean } {
  let idle = 0;
  let at = 0;
  const child =
    platform === "darwin"
      ? spawn("/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_IDLE_LOOP], { stdio: ["ignore", "pipe", "ignore"] })
      : spawn(HX_POWERSHELL, ps(WIN_IDLE_LOOP), { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  let rest = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    rest += chunk.toString();
    const lines = rest.split(/\r?\n/u);
    rest = lines.pop() ?? "";
    for (const line of lines) {
      const value = Number.parseInt(line.trim(), 10);
      if (Number.isFinite(value) && value >= 0) {
        idle = value;
        at = Date.now();
      }
    }
  });
  return {
    idleMs: () => idle + (at > 0 ? Date.now() - at : 0),
    stop: () => {
      child.kill();
    },
    fresh: () => at > 0 && Date.now() - at < 3_000,
  };
}

/** The user moving the mouse, until `stop`. */
function playUser(platform: NodeJS.Platform): ChildProcess {
  return platform === "darwin"
    ? spawn("/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_USER_LOOP], { stdio: "ignore" })
    : spawn(HX_POWERSHELL, ps(WIN_USER_LOOP), { stdio: "ignore", windowsHide: true });
}

interface HxLaneApp {
  /** The window choice of computer_do. */
  choice: HxWindowChoice;
  open: () => void;
}

function apps(
  platform: NodeJS.Platform,
  folder: string,
): { a: HxLaneApp; b: HxLaneApp; fileA: string; save: string[] } {
  const fileA = join(folder, "hxbot-lane-a.txt");
  if (platform === "darwin")
    return {
      fileA,
      save: ["cmd", "s"],
      a: {
        choice: { title: "hxbot-lane-a" },
        open: () => spawn("open", ["-a", "TextEdit", fileA], { stdio: "ignore" }),
      },
      b: { choice: { app: "Calculator" }, open: () => spawn("open", ["-a", "Calculator"], { stdio: "ignore" }) },
    };
  return {
    fileA,
    save: ["ctrl", "s"],
    a: {
      choice: { title: "hxbot-lane-a" },
      open: () => spawn("notepad.exe", [fileA], { stdio: "ignore", detached: true, windowsHide: false }).unref(),
    },
    b: {
      choice: { title: "Character Map" },
      open: () => spawn("charmap.exe", [], { stdio: "ignore", detached: true, windowsHide: false }).unref(),
    },
  };
}

export async function hxLanesRealCheck(input: {
  items: HxRealItems;
  log: (line: string) => void;
  driver: string;
  platform: NodeJS.Platform;
  folder: string;
}): Promise<void> {
  const { items, log, platform } = input;
  if (platform !== "darwin" && platform !== "win32") {
    items.add("L1", "分道与礼让", "skip", `这台机器是 ${platform}，只在 Mac、Windows 上检查`);
    return;
  }
  const driver = await hxCheckStartDriver(input.driver, platform);
  const reader = idleReader(platform);
  const sockets: HxDriverSocket[] = [driver.socket];
  try {
    if (!items.check("L0", "电脑操控驱动启动并答复", driver.ready, driver.output().slice(-600))) return;
    const { a, b, fileA, save } = apps(platform, input.folder);
    await writeFile(fileA, "HXBot lanes\n", "utf8");
    b.open();
    await wait(3_000);
    a.open();
    for (let i = 0; i < 20 && !reader.fresh(); i += 1) await wait(500);
    log(`idle reader ${reader.fresh() ? "reads" : "does not read"}; idle ${reader.idleMs()} ms`);

    const lanes = new HxComputerLanes();
    // While `tracing`, what the gate read of the user's presence and HXBot's own input, for a failed L3.
    const trace: string[] = [];
    let tracing = false;
    const zero = Date.now();
    class HxTracedPresence extends HxPresence {
      override beginOwnInput(start?: number): () => void {
        const from = start ?? Date.now();
        if (tracing) trace.push(`own from ${from - zero}`);
        const done = super.beginOwnInput(from);
        return () => {
          if (tracing) trace.push(`own ${from - zero}..${Date.now() - zero}`);
          done();
        };
      }
      override userIdleMs(): number {
        const idle = super.userIdleMs();
        if (tracing) trace.push(`idle@${Date.now() - zero} system ${reader.idleMs()} user ${idle}`);
        return idle;
      }
    }
    const presence = new HxTracedPresence();
    presence.setSource({ idleSeconds: () => reader.idleMs() / 1000, locked: () => false });
    const looks = new Map<string, HxLookSnapshot>();
    const resumed: Array<{ agentId: string; at: number }> = [];
    const notes: string[] = [];
    const parked = new HxParkedSteps();
    const watchSocket = new HxDriverSocket(() => driver.address, "hxbot-check-watch");
    sockets.push(watchSocket);
    const watch = hxFrontWatch(hxRun, platform);
    parked.setHost({
      userIdleMs: () => presence.userIdleMs(),
      locked: () => presence.locked(),
      frontWindow: () => hxFrontWindow(watch, watchSocket),
      resume: async (work: HxParkedWork) => {
        resumed.push({ agentId: work.agentId, at: Date.now() });
      },
      autoResume: () => true,
    });
    let stopped = false;
    const socketOf = new Map<string, HxDriverSocket>();
    const socket = (agentId: string): HxDriverSocket => {
      let found = socketOf.get(agentId);
      if (!found) {
        found = new HxDriverSocket(() => driver.address, `hxbot-check-${agentId}`);
        socketOf.set(agentId, found);
        sockets.push(found);
      }
      return found;
    };
    const tool = async (
      agentId: string,
      name: string,
      args: DynamicToolCallParams["arguments"],
      tap: string[] | null = null,
    ) => {
      const raw = socket(agentId);
      // With `tap`, the names of the driver's tools that this call used.
      const own: HxDriverPort = {
        call: (tool, args, timeoutMs): Promise<HxDriverAnswer> => {
          tap?.push(tool);
          return raw.call(tool, args, timeoutMs);
        },
      };
      const plans: HxComputerPlan[] = [];
      const started = Date.now();
      const result = await hxComputerStepToolCall(
        {
          allowed: "yes",
          driver: own,
          stopped: () => stopped,
          front: watch,
          plan: { get: () => plans.at(-1) ?? null, set: (plan) => plans.push(plan) },
          newId: () => randomUUID(),
          stopKeys: platform === "darwin" ? "⌃⌥Esc" : "Ctrl+Alt+Esc",
          record: () => undefined,
          work: hxStepWork(
            { agentId, name: agentId, tier: 0 },
            {
              lanes,
              presence,
              parked,
              frontWindow: () => hxFrontWindow(watch, own),
              driver: () => own,
              stopped: () => stopped,
              looks,
              note: (text) => notes.push(`${agentId}: ${text}`),
              parkedLine: (work, seconds) => `${work.window.app} parked ${work.why} ${seconds}s`,
            },
          ),
        },
        { tool: name, arguments: args },
      );
      const item = result.contentItems[0];
      const answer = JSON.parse(item && item.type === "inputText" ? item.text : "{}");
      const ended = Date.now();
      log(`${agentId} ${name} ${JSON.stringify(args).slice(0, 240)} → ${JSON.stringify(answer).slice(0, 500)}`);
      return { answer, started, ended };
    };
    const call = (agentId: string, choice: HxWindowChoice, steps: HxStep[], tap: string[] | null = null) =>
      tool(agentId, "computer_do", { ...choice, steps }, tap);
    /** The window of a choice, as the steps find it: its process, number and app name. */
    const windowOf = async (choice: HxWindowChoice) => {
      const run = new HxStepRun({ driver: socket("front"), stopped: () => false });
      return (await run.open(choice)) === null ? run.window() : null;
    };
    const front = async (choice: HxWindowChoice) => {
      const window = await windowOf(choice);
      if (!window) return false;
      await socket("front").call("bring_to_front", { pid: window.pid, window_id: window.windowId }, 10_000);
      await wait(1_500);
      return true;
    };
    const fileText = () => readFile(fileA, "utf8").catch(() => "");
    const quiet = async (ms: number) => {
      // Waits until the user has rested this long (nobody uses the runner but the check).
      for (let i = 0; i < 40 && reader.idleMs() < ms; i += 1) await wait(500);
    };

    // Both windows must be up first: an app can take long to start on a fresh machine.
    for (let i = 0; i < 40; i += 1) {
      if ((await windowOf(a.choice)) && (await windowOf(b.choice))) break;
      await wait(1_000);
    }
    log(`windows: a ${JSON.stringify(await windowOf(a.choice))}; b ${JSON.stringify(await windowOf(b.choice))}`);

    // L1: two apps at once. Each call holds its app lane for 3 seconds of background work.
    await quiet(6_000);
    const pause: HxStep[] = [{ act: "wait", seconds: 3 }];
    const [one, two] = await Promise.all([call("a", a.choice, pause), call("b", b.choice, pause)]);
    const overlap = Math.min(one.ended, two.ended) - Math.max(one.started, two.started);
    items.check(
      "L1",
      "两个智能体操作两个不同的应用，后台步骤同时进行",
      one.answer.status === "done" && two.answer.status === "done" && overlap >= 2_000,
      `a ${one.answer.status} ${one.ended - one.started} ms; b ${two.answer.status} ${two.ended - two.started} ms; overlap ${overlap} ms`,
    );

    // L2: one app, one at a time.
    const [first, second] = await Promise.all([call("a", a.choice, pause), call("c", a.choice, pause)]);
    const together = Math.min(first.ended, second.ended) - Math.max(first.started, second.started);
    const later = Math.max(first.ended, second.ended) - Math.min(first.started, second.started);
    items.check(
      "L2",
      "同一个应用的两次调用一个接一个",
      first.answer.status === "done" && second.answer.status === "done" && later >= 5_500,
      `a ${first.answer.status}; c ${second.answer.status}; together ${together} ms; from the first start to the last end ${later} ms`,
    );

    // L3: the front is one: the agent whose window is not in front parks, and sends no key.
    await front(a.choice);
    await quiet(6_000);
    const before = await fileText();
    tracing = true;
    const [inFront, behind] = await Promise.all([
      call("a", a.choice, [
        { act: "key", key: "end" },
        { act: "key", key: "end" },
      ]),
      call("b", b.choice, [{ act: "key", key: "escape" }]),
    ]);
    items.check(
      "L3",
      "前台按键全机一个：目标窗口不在最前面的那个智能体停放，不往别的窗口发键",
      inFront.answer.status === "done" &&
        behind.answer.status === "waiting_user" &&
        behind.answer.parked === "other_window",
      `in front: ${inFront.answer.status} ${inFront.answer.parked ?? ""} ${String(inFront.answer.stoppedAt?.reason ?? "").slice(0, 160)}; behind: ${behind.answer.status} ${behind.answer.parked ?? ""}; file unchanged ${(await fileText()) === before}; front ${JSON.stringify(await hxFrontWindow(watch, watchSocket))}, a ${JSON.stringify(await windowOf(a.choice))}; step ${inFront.answer.stoppedAt?.n ?? "-"}`,
    );
    tracing = false;
    if (inFront.answer.status !== "done") {
      log(`L3 trace: ${trace.slice(0, 80).join(" | ")}`);
      // The job's output shows only the start of an item, and log.txt is in the run's files: the trace
      // goes to the output too, a few entries a line.
      for (let i = 0; i < Math.min(trace.length, 80); i += 4)
        process.stdout.write(`L3 trace ${i}: ${trace.slice(i, i + 4).join(" | ")}\n`);
    }
    parked.dropAll();

    // L4: the app is busy for longer than one call waits.
    const target = await windowOf(a.choice);
    const holder = await lanes.acquire(
      hxAppLane(target?.app || `pid${target?.pid ?? 0}`),
      { agentId: "z", name: "Zed", tier: 0 },
      Date.now() + 120_000,
    );
    const busy = await call("a", a.choice, [{ act: "key", key: "end" }]);
    if (holder.ok) holder.lease.release();
    items.check(
      "L4",
      "等满 30 秒还轮不到：答复“忙”、谁在用、大约多久",
      busy.answer.status === "busy" &&
        String(busy.answer.reason ?? "").includes("Zed") &&
        busy.ended - busy.started >= 29_000,
      `${busy.answer.status}; ${String(busy.answer.reason ?? "").slice(0, 160)}; eta ${busy.answer.etaMs ?? "none"}; waited ${busy.ended - busy.started} ms`,
    );

    // L5: the user moves the mouse: the front step parks, and no key reaches the file.
    await front(a.choice);
    const user = playUser(platform);
    await wait(1_500);
    const text5 = await fileText();
    const token = `HXBot-${randomUUID().slice(0, 6)}`;
    const blocked = await call("a", a.choice, [
      { act: "key", key: "end" },
      { act: "type", text: ` ${token}`, by: "keys" },
      { act: "hotkey", keys: save },
    ]);
    user.kill();
    const stoppedUserAt = Date.now();
    await wait(1_000);
    items.check(
      "L5",
      "你在用电脑时：前台步骤停放（等待用户），一个键也不发",
      blocked.answer.status === "waiting_user" &&
        blocked.answer.parked === "user_active" &&
        (await fileText()) === text5,
      `${blocked.answer.status} ${blocked.answer.parked ?? ""}; idle when it parked ${reader.idleMs()} ms; file unchanged ${(await fileText()) === text5}`,
    );

    // L6: the user stops, the window is in front: the parked step goes on by itself.
    const resumedAfter = () => resumed.find((entry) => entry.agentId === "a" && entry.at >= stoppedUserAt);
    for (let i = 0; i < 30 && !resumedAfter(); i += 1) await wait(500);
    const resume = resumedAfter();
    items.check(
      "L6",
      "你停手 5 秒、那个窗口在最前面：自动续做",
      resume !== undefined && resume.at - stoppedUserAt >= 4_000 && resume.at - stoppedUserAt <= 15_000,
      resume
        ? `resumed ${resume.at - stoppedUserAt} ms after the user stopped; lines: ${notes.join(" | ").slice(0, 300)}`
        : `not resumed; parked ${parked.size()}`,
    );
    parked.dropAll();

    // L7: HXBot's own keys are not the user's.
    await quiet(6_000);
    const idleBefore = reader.idleMs();
    const own = await call("a", a.choice, [
      { act: "key", key: "end" },
      { act: "key", key: "end" },
      { act: "key", key: "end" },
    ]);
    await wait(600);
    const idleAfter = reader.idleMs();
    items.check(
      "L7",
      "驱动自己发的按键不算你在用：连续三个前台按键不停放",
      own.answer.status === "done",
      `${own.answer.status}; system idle before ${idleBefore} ms, after ${idleAfter} ms (the driver's input ${idleAfter < idleBefore ? "counts" : "does not count"} in it)`,
    );

    // L8: the stop keys, for every lane.
    const holdFront = await lanes.acquire("focus", { agentId: "z", name: "Zed", tier: 0 }, Date.now() + 120_000);
    const waiting = call("a", a.choice, [{ act: "key", key: "end" }]);
    await wait(1_500);
    stopped = true;
    lanes.stopAll();
    parked.dropAll();
    const halted = await waiting;
    stopped = false;
    if (holdFront.ok) holdFront.lease.release();
    items.check(
      "L8",
      "停止键对所有道生效：在等的调用马上停下",
      halted.answer.status === "stopped" && halted.ended - halted.started < 10_000,
      `${halted.answer.status} after ${halted.ended - halted.started} ms`,
    );

    // L9: a value set directly and read back. On the Mac in TextEdit's text area, saved to the file.
    // Windows Notepad's text area has no value to set (no ValuePattern in UI Automation): there the
    // value goes into Character Map's "Characters to copy" field, and L9b checks Notepad's answer.
    const fieldsOf = async (agentId: string, choice: HxWindowChoice) => {
      // As an agent does: look first, then name the field by its index (a window can have more than
      // one text field, such as a search field).
      const looked = await tool(agentId, "computer_look", { ...choice });
      return String(looked.answer.outline ?? "")
        .split("\n")
        .map((line) => /^\s*\[(\d+)\]\s+field\b(.*)$/u.exec(line))
        .filter((match): match is RegExpExecArray => match !== null);
    };
    const indexOf = (fields: RegExpExecArray[], word: RegExp) => {
      const pick = fields.find((match) => word.test(match[2] ?? "")) ?? fields[0];
      return pick ? { index: Number(pick[1]) } : { role: "field" };
    };
    const onMac = platform === "darwin";
    const choice9 = onMac ? a.choice : b.choice;
    await front(choice9);
    await quiet(6_000);
    const value = `HXBot value ${randomUUID().slice(0, 6)}`;
    const fields = await fieldsOf("a", choice9);
    const field9 = indexOf(fields, onMac ? /HXBot lanes/u : /copy/iu);
    log(`L9 fields ${JSON.stringify(fields.map((match) => match[0].trim().slice(0, 80)))}`);
    const set = await call("a", choice9, [
      { act: "type", target: field9, text: value, by: "value" },
      ...(onMac ? [{ act: "hotkey" as const, keys: save }] : []),
    ]);
    await wait(2_000);
    const saved = await fileText();
    const first9 = Array.isArray(set.answer.steps) ? set.answer.steps[0] : null;
    items.check(
      "L9",
      onMac ? "直接赋值输入后读回一致，保存后文件里就是这段文字" : "直接赋值输入后读回一致（字符映射表的“复制字符”框）",
      set.answer.status === "done" &&
        first9?.route === "value" &&
        first9?.check === "verified" &&
        (!onMac || saved.includes(value)),
      `${set.answer.status}; step 1 ${first9 ? `${first9.route}/${first9.check} ${String(first9.readback ?? "").slice(0, 80)}` : "none"}; ${String(set.answer.stoppedAt?.reason ?? set.answer.reason ?? "").slice(0, 200)}; fields ${fields.length}, chose ${JSON.stringify(field9)}; candidates ${JSON.stringify(set.answer.stoppedAt?.candidates ?? []).slice(0, 300)}${onMac ? `; file ${JSON.stringify(saved.slice(0, 80))}` : ""}`,
    );
    if (onMac)
      items.add("L9b", "不能直接赋值的文字区：答复改用按键，不动文字", "skip", "TextEdit 的文字区可以直接赋值");
    else {
      await front(a.choice);
      await quiet(6_000);
      const notepad = indexOf(await fieldsOf("a", a.choice), /HXBot lanes/u);
      const before9 = await fileText();
      const refused = await call("a", a.choice, [{ act: "type", target: notepad, text: value, by: "value" }]);
      await wait(1_000);
      const reason9 = String(refused.answer.stoppedAt?.reason ?? refused.answer.reason ?? "");
      items.check(
        "L9b",
        "不能直接赋值的文字区（记事本）：答复说明原因、改用按键，不动文字",
        refused.answer.status === "failed" && reason9.includes("by keys") && (await fileText()) === before9,
        `${refused.answer.status}; ${reason9.slice(0, 240)}`,
      );
    }

    // L10: a wait for what never shows.
    const never = await call("a", a.choice, [
      { act: "wait", expect: { name: `hxbot-never-${randomUUID().slice(0, 6)}` } },
    ]);
    const tookMs = never.ended - never.started;
    items.check(
      "L10",
      "等一个不会出现的控件：10 秒后报“没等到”，不当成完成",
      never.answer.status === "timed_out" &&
        String(never.answer.stoppedAt?.reason ?? "").includes("没等到") &&
        tookMs >= 9_000,
      `${never.answer.status}; ${tookMs} ms; ${String(never.answer.stoppedAt?.reason ?? "").slice(0, 120)}`,
    );

    // L11: “现在做”: the window comes to the front, and the step runs while the user is busy.
    await front(b.choice);
    parked.park({
      agentId: "a",
      tier: 0,
      window: { pid: 0, windowId: 0, app: "lane-a", title: "" },
      remaining: 1,
      since: Date.now(),
      why: "other_window",
    });
    parked.consent("a");
    const again = playUser(platform);
    const tools: string[] = [];
    const now = await call("a", a.choice, [{ act: "key", key: "end" }], tools);
    again.kill();
    items.add(
      "L11",
      "回复“现在做”：把目标窗口切到最前面马上做",
      now.answer.status === "done"
        ? "pass"
        : platform === "win32" && now.answer.status === "waiting_user"
          ? "warn"
          : "fail",
      `${now.answer.status} ${now.answer.parked ?? ""}; bring_to_front ${tools.includes("bring_to_front") ? "called" : "not called"}${now.answer.status === "waiting_user" ? "; the system did not let the window come to the front" : ""}`,
    );
    parked.dropAll();
  } finally {
    reader.stop();
    for (const own of sockets) own.close();
    driver.child.kill();
  }
}
