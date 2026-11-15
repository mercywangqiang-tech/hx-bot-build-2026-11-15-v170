// HXBot 不打扰其他应用（v1.7.0）：按键只发给目标应用，用完松开修饰键。
//
// 用户 2026-11-14：“HXBot经常影响其他应用的运行！在V1.7.0必须完全解决！Windows也会存在这样的问题！”
// 一步步操作时，点过一次前台以后，文字和按键发给“当前在最前面的应用”（steps.ts 的 keysToFront）。用户中途
// 切到自己的应用，助手打的字和 ⌘S、⌘W、⌘Q 就落进用户的应用。每次发键之前先看最前面的是不是目标应用：
// 不是就停下，不往别的应用里发键，也不把目标应用叫回前台（那也是抢焦点；GitHub 的 Windows 上系统也不让：
// 2026-11-15 真机检查 Q2）。助手请用户回到那个应用后再做。
// 一次操作发过按键，结束时（包括被停下）把 ⌘ ⇧ ⌥ ⌃（Windows：Ctrl Shift Alt Win）都松开：操作在按下和
// 松开之间被打断时，修饰键会停在“按下”，别的应用里的快捷键就全乱了。松开一个没按下的键不会有任何效果。

import type { HxRunner } from "./runner";
import { hxRunOk } from "./runner";
import { HX_POWERSHELL } from "./tables-win";

/** The app that gets the keys now: its process, and on Windows its window. */
interface HxFront {
  pid: number;
  /** The front window (Windows: its handle, the driver's window_id); null where it is not read. */
  windowId: number | null;
}

export interface HxFrontWatch {
  /** The app that gets the keys now, or null when it cannot be told. */
  front(): Promise<HxFront | null>;
  /** Lets go of every modifier key. */
  releaseModifiers(): Promise<void>;
}

/**
 * The user's clipboard around typed text (v1.7.0, F5). A driver may type through the clipboard;
 * the user's copy must still be there afterwards. `save` keeps what is on it now.
 */
export interface HxClipboardKeep {
  save(): Promise<HxClipboardSaved>;
}

interface HxClipboardSaved {
  /** True when something else is on the clipboard now. */
  changed(): Promise<boolean>;
  /** Puts the saved copy back. */
  putBack(): Promise<void>;
}

const MAC_FRONT_PID =
  "ObjC.import('AppKit'); String($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier)";
// Left and right Command, Shift, Option, Control, and Fn: a key up for each, then a change of the
// modifier flags to none. The system's state follows a moment later: look again, up to five times
// (macOS 26 on GitHub kept Shift held after the key ups alone once, 2026-11-15).
const MAC_RELEASE =
  "ObjC.import('CoreGraphics'); ObjC.import('Foundation'); let left = 'held'; for (let i = 0; i < 5; i++) { for (const k of [55, 54, 56, 60, 58, 61, 59, 62, 63]) { $.CGEventPost(0, $.CGEventCreateKeyboardEvent(null, k, false)); } const f = $.CGEventCreate(null); $.CGEventSetType(f, 12); $.CGEventSetFlags(f, 0); $.CGEventPost(0, f); $.NSThread.sleepForTimeInterval(0.1); if ((($.CGEventSourceFlagsState(1) & 0x00FF0000) >>> 0) === 0) { left = 'ok'; break; } } left";

const WIN_USER32 = `Add-Type -Namespace HXF -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);
[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, System.UIntPtr e);
'@;
`;
// The process and the window: a framed app (Settings, Calculator) has its window in another process.
const WIN_FRONT_PID = `${WIN_USER32}$h = [HXF.W]::GetForegroundWindow(); $p = 0; [void][HXF.W]::GetWindowThreadProcessId($h, [ref]$p); "$p $($h.ToInt64())"`;
// Shift, Control, Alt (left and right) and the two Windows keys: KEYEVENTF_KEYUP (2).
const WIN_RELEASE = `${WIN_USER32}foreach ($v in 0x10,0x11,0x12,0xA0,0xA1,0xA2,0xA3,0xA4,0xA5,0x5B,0x5C) { [HXF.W]::keybd_event([byte]$v, 0, 2, [System.UIntPtr]::Zero) }; 'ok'`;

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

function frontOf(text: string): HxFront | null {
  const [pidText, windowText] = text.trim().split(/\s+/u);
  const pid = Number.parseInt(pidText ?? "", 10);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  const windowId = Number.parseInt(windowText ?? "", 10);
  return { pid, windowId: Number.isFinite(windowId) && windowId > 0 ? windowId : null };
}

/** The watch for this computer, or null where HXBot does not drive apps. */
export function hxFrontWatch(run: HxRunner, platform: NodeJS.Platform = process.platform): HxFrontWatch | null {
  if (platform === "darwin") {
    const jxa = (script: string, env?: Record<string, string>) =>
      run("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { timeoutMs: 10_000, ...(env ? { env } : {}) });
    return {
      async front() {
        const result = await jxa(MAC_FRONT_PID);
        return hxRunOk(result) ? frontOf(result.stdout) : null;
      },
      async releaseModifiers() {
        await jxa(MAC_RELEASE);
      },
    };
  }
  if (platform === "win32") {
    const ps = (script: string, env?: Record<string, string>) =>
      run(HX_POWERSHELL, powershell(script), { timeoutMs: 20_000, ...(env ? { env } : {}) });
    return {
      async front() {
        const result = await ps(WIN_FRONT_PID);
        return hxRunOk(result) ? frontOf(result.stdout) : null;
      },
      async releaseModifiers() {
        await ps(WIN_RELEASE);
      },
    };
  }
  return null;
}
