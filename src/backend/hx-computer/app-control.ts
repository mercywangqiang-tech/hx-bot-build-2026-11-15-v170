// HXBot 电脑操控（四，v1.6.9）：应用命令，工具 computer_app。
//
// 列出正在运行的应用、切到前台、隐藏、退出、摆放窗口、默认应用（浏览器、邮件、按文件类型）、菜单命令。
// 都在 HXBot 主程序里执行，不走助手的命令行，所以不受进程沙盒影响（复盘 F2、F4）。
//
// 四条路线：同一件事按“直达（系统接口）→ 命令（脚本）→ 控件（菜单、逐步操作）→ 看图”的顺序试，一条走不通
// 就换下一条；结果写明走的是哪一条，前面几条为什么没走通（tried）。
//
// 退出应用（复盘里要产品定的做法）：先正常退出并核对；应用自己弹出“要保存吗”时，那个框留给用户；
// 强制退出会丢掉没保存的内容，要用户在对话里同意后带 confirmed 再调。
//
// Mac 上的脚本用 osascript（JXA 的 ObjC 桥接调系统接口，System Events 点菜单、摆窗口），参数一律放在
// 环境变量或脚本参数里，不拼进脚本文本。Windows 上用 Windows PowerShell 5.1（-EncodedCommand）。

import { z } from "zod";
import { type HxRunner, type HxRunResult, hxRunFailure, hxRunOk } from "./runner";
import { hxRiskyLabel } from "./steps";
import { HX_POWERSHELL } from "./tables-win";

type HxAppAction = "list" | "front" | "hide" | "quit" | "window" | "default" | "menus" | "menu";
type HxAppPlace = "left" | "right" | "max" | "next-screen";
type HxAppDefaultKind = "browser" | "mail" | "type";
type HxAppRoute = "direct" | "command" | "controls" | "image";

export interface HxAppInput {
  action: HxAppAction;
  /** The app: its name as the user or the list says it, a bundle id (Mac) or a process name (Windows). */
  app?: string | undefined;
  place?: HxAppPlace | undefined;
  kind?: HxAppDefaultKind | undefined;
  /** A file name extension for kind type, such as "pdf". */
  type?: string | undefined;
  /** A menu path: the menu, the item, and optionally one item of its submenu, such as ["File", "Save"]. */
  path?: readonly string[] | undefined;
  /** Quit without saving (force), only after the user agreed in the chat. */
  force?: boolean | undefined;
  confirmed?: boolean | undefined;
}

interface HxRunningApp {
  name: string;
  /** The bundle id on a Mac, the process name on Windows. */
  id: string;
  pid: number;
  active?: boolean | undefined;
  hidden?: boolean | undefined;
  title?: string | undefined;
}

interface HxTried {
  route: HxAppRoute;
  why: string;
}

export type HxAppResult =
  | { status: "apps"; apps: HxRunningApp[] }
  | { status: "menus"; app: string; menus: { menu: string; items: string[] }[] }
  | { status: "done"; action: HxAppAction; app: string; route: HxAppRoute; detail?: string; tried: HxTried[] }
  | { status: "default"; kind: HxAppDefaultKind; target: string; app: string; route: HxAppRoute }
  | { status: "waiting"; app: string; reason: string }
  | { status: "confirm"; reason: string }
  | { status: "confirm-dialog"; reason: string }
  | { status: "page"; reason: string }
  | { status: "use-steps"; reason: string; tried: HxTried[] }
  | { status: "needs-permission"; reason: string }
  | { status: "not-found" | "invalid" | "failed"; reason: string; tried?: HxTried[] };

export interface HxAppDeps {
  run: HxRunner;
  platform: NodeJS.Platform;
  /** Waits; the tests do not. */
  sleep: (ms: number) => Promise<void>;
  /** Opens a page of the system settings: the Automation page on a Mac (macOS asks there for each app). */
  openAutomationPage: () => Promise<void>;
}

const OSASCRIPT = "/usr/bin/osascript";
const QUIT_WAIT_MS = 6_000;
const POLL_MS = 300;
// Long enough for the user to answer macOS's question whether HXBot may control an app (Automation).
const MAC_TIMEOUT_MS = 60_000;
const WIN_TIMEOUT_MS = 90_000;

// ---------- Mac ----------

/** Reads a value from the environment of the script: JXA scripts take no other input. */
const JXA_ENV = `ObjC.import('Foundation'); ObjC.import('AppKit');
function env(n) { const v = $.NSProcessInfo.processInfo.environment.objectForKey(n); return v.isNil() ? '' : ObjC.unwrap(v); }
function same(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }
function num(v) { const u = ObjC.unwrap(v); return typeof u === 'number' ? u : Number(u); }
function flag(v) { const u = ObjC.unwrap(v); return u === true || u === 1; }
// A regular app: activation policy 0 (it has a Dock icon). Where the bridge gives no number, an app in a bundle counts.
function regular(a) { const p = num(a.activationPolicy); if (!Number.isNaN(p)) return p === 0; return /.app$/i.test(ObjC.unwrap(a.bundleURL.lastPathComponent) || ''); }
function running() {
  const list = $.NSWorkspace.sharedWorkspace.runningApplications; const out = [];
  for (let i = 0; i < num(list.count); i++) { const a = list.objectAtIndex(i); if (regular(a)) out.push(a); }
  return out;
}
function info(a) { return { name: ObjC.unwrap(a.localizedName) || '', id: ObjC.unwrap(a.bundleIdentifier) || '', pid: num(a.processIdentifier), active: flag(a.active), hidden: flag(a.hidden) }; }
function find(want) {
  const all = running();
  return all.find((a) => same(ObjC.unwrap(a.bundleIdentifier), want)) || all.find((a) => same(ObjC.unwrap(a.localizedName), want))
    || all.find((a) => same((ObjC.unwrap(a.bundleURL.lastPathComponent) || '').replace(/\\.app$/i, ''), want)) || null;
}
`;

const MAC_LIST = `${JXA_ENV}JSON.stringify(running().map(info));`;
const MAC_FIND = `${JXA_ENV}const a = find(env('HX_APP')); JSON.stringify(a ? info(a) : null);`;
const MAC_FRONT = `${JXA_ENV}const a = find(env('HX_APP')); JSON.stringify(a ? { sent: flag(a.activateWithOptions(1)) } : null);`;
const MAC_HIDE = `${JXA_ENV}const a = find(env('HX_APP')); JSON.stringify(a ? { sent: flag(a.hide()) } : null);`;
const MAC_QUIT = `${JXA_ENV}const a = find(env('HX_APP')); JSON.stringify(a ? { sent: flag(env('HX_FORCE') === '1' ? a.forceTerminate() : a.terminate()) } : null);`;
const MAC_FRONTMOST = `${JXA_ENV}const f = $.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify(f.isNil() ? null : info(f));`;

/** The default app of a scheme or a file type: read, or set and read again. */
const MAC_DEFAULT = `${JXA_ENV}ObjC.import('CoreServices');
function cf(ref) { if (!ref) return ''; try { return ObjC.unwrap(ObjC.castRefToObject(ref)) || ''; } catch (e) { return ''; } }
const scheme = env('HX_SCHEME'); const ext = env('HX_EXT'); const want = env('HX_BUNDLE');
let uti = '';
if (ext) uti = cf($.UTTypeCreatePreferredIdentifierForTag($('public.filename-extension'), $(ext), null));
function read() {
  if (scheme) return cf($.LSCopyDefaultHandlerForURLScheme($(scheme)));
  return cf($.LSCopyDefaultRoleHandlerForContentType($(uti), 0xFFFFFFFF));
}
const before = read(); let code = null;
if (want) {
  if (scheme === 'http') { code = $.LSSetDefaultHandlerForURLScheme($('http'), $(want)); $.LSSetDefaultHandlerForURLScheme($('https'), $(want)); }
  else if (scheme) code = $.LSSetDefaultHandlerForURLScheme($(scheme), $(want));
  else code = $.LSSetDefaultRoleHandlerForContentType($(uti), 0xFFFFFFFF, $(want));
  // The change can take a moment to read back (macOS 26 on GitHub, 2026-11-14): wait up to 6 seconds.
  for (let i = 0; i < 12 && read().toLowerCase() !== want.toLowerCase(); i++) delay(0.5);
}
JSON.stringify({ before: before, after: read(), code: code, uti: uti });`;

/** The bundle id of an app that is installed (not only a running one), by name or id. */
const MAC_BUNDLE = `${JXA_ENV}const want = env('HX_APP'); const ws = $.NSWorkspace.sharedWorkspace;
let url = ws.URLForApplicationWithBundleIdentifier($(want));
if (url.isNil()) { const p = ws.fullPathForApplication($(want)); if (!p.isNil()) url = $.NSURL.fileURLWithPath(p); }
let out = null;
if (!url.isNil()) { const b = $.NSBundle.bundleWithURL(url); if (!b.isNil()) out = { id: ObjC.unwrap(b.bundleIdentifier) || '', name: (ObjC.unwrap(url.lastPathComponent) || '').replace(/\\.app$/i, '') }; }
JSON.stringify(out);`;

/** Places the first window of a process with System Events (Accessibility) on its screen or the next one. */
const MAC_WINDOW = `${JXA_ENV}
const pid = Number(env('HX_PID')); const place = env('HX_PLACE');
const se = Application('System Events');
const proc = se.processes.whose({ unixId: pid })[0];
const win = proc.windows[0];
const screens = $.NSScreen.screens; const mainH = screens.objectAtIndex(0).frame.size.height;
function vis(i) { const f = screens.objectAtIndex(i).visibleFrame; return { x: f.origin.x, y: mainH - f.origin.y - f.size.height, w: f.size.width, h: f.size.height }; }
const pos = win.position(); const size = win.size();
const cx = pos[0] + size[0] / 2; const cy = pos[1] + size[1] / 2;
let at = 0;
for (let i = 0; i < screens.count; i++) { const v = vis(i); if (cx >= v.x && cx < v.x + v.w && cy >= v.y && cy < v.y + v.h) at = i; }
let v = vis(at); let r;
if (place === 'next-screen') { v = vis((at + 1) % screens.count); r = [v.x, v.y, Math.min(size[0], v.w), Math.min(size[1], v.h)]; }
else if (place === 'left') r = [v.x, v.y, Math.floor(v.w / 2), v.h];
else if (place === 'right') r = [v.x + Math.floor(v.w / 2), v.y, Math.floor(v.w / 2), v.h];
else r = [v.x, v.y, v.w, v.h];
win.position = [r[0], r[1]]; win.size = [r[2], r[3]];
JSON.stringify({ want: r, now: win.position().concat(win.size()), screens: screens.count });`;

const MAC_MENUS = `on run argv
  set pn to item 1 of argv
  set out to ""
  tell application "System Events" to tell process pn
    repeat with mbi in menu bar items of menu bar 1
      set mname to name of mbi
      if mname is not "Apple" then
        try
          repeat with mi in menu items of menu 1 of mbi
            set iname to name of mi
            if iname is not missing value then set out to out & mname & tab & iname & linefeed
          end repeat
        end try
      end if
    end repeat
  end tell
  return out
end run`;

const MAC_MENU = `on run argv
  set pn to item 1 of argv
  set mn to item 2 of argv
  set itn to item 3 of argv
  tell application "System Events" to tell process pn
    set frontmost to true
    delay 0.3
    if (count of argv) > 3 then
      click menu item (item 4 of argv) of menu 1 of menu item itn of menu 1 of menu bar item mn of menu bar 1
    else
      click menu item itn of menu 1 of menu bar item mn of menu bar 1
    end if
  end tell
  return "clicked"
end run`;

// ---------- Windows ----------

/** One Windows PowerShell script, as -EncodedCommand: quotes in it need no care. Values go in env. */
function powerShell(script: string): { command: string; args: string[] } {
  const text = `$ProgressPreference = 'SilentlyContinue'; try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }; ${script}`;
  return {
    command: HX_POWERSHELL,
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(text, "utf16le").toString("base64"),
    ],
  };
}

const WIN_USER32 = `Add-Type -Namespace HX -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr h, int c);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool MoveWindow(System.IntPtr h, int x, int y, int w, int hh, bool r);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
'@;
`;
const WIN_APPS = `$hxApps = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
  $d = ''; try { $d = $_.MainModule.FileVersionInfo.FileDescription } catch { }
  [pscustomobject]@{ name = $(if ($d) { $d } else { $_.ProcessName }); id = $_.ProcessName; pid = $_.Id; title = $_.MainWindowTitle } });
function HxFind($want) { $w = $want.ToLower(); $hxApps | Where-Object { $_.id.ToLower() -eq $w -or $_.name.ToLower() -eq $w -or $_.title.ToLower() -eq $w -or $_.id.ToLower() -eq ($w -replace '\\.exe$','') } | Select-Object -First 1 }
`;
const WIN_LIST = `${WIN_APPS}ConvertTo-Json -Compress -InputObject @($hxApps)`;
const WIN_FIND = `${WIN_APPS}$a = HxFind $env:HX_APP; if ($a) { ConvertTo-Json -Compress -InputObject $a } else { 'null' }`;
const WIN_FRONT = `${WIN_USER32}$p = Get-Process -Id ([int]$env:HX_PID); $h = $p.MainWindowHandle;
if ([HX.W]::IsIconic($h)) { [void][HX.W]::ShowWindowAsync($h, 9) }; $ok = [HX.W]::SetForegroundWindow($h);
if (-not $ok) { $ok = (New-Object -ComObject WScript.Shell).AppActivate($p.Id) }; ConvertTo-Json -Compress -InputObject @{ sent = [bool]$ok }`;
const WIN_HIDE = `${WIN_USER32}$p = Get-Process -Id ([int]$env:HX_PID); ConvertTo-Json -Compress -InputObject @{ sent = [HX.W]::ShowWindowAsync($p.MainWindowHandle, 6) }`;
const WIN_QUIT = `$p = Get-Process -Id ([int]$env:HX_PID);
if ($env:HX_FORCE -eq '1') { Stop-Process -Id $p.Id -Force; ConvertTo-Json -Compress -InputObject @{ sent = $true } }
else { ConvertTo-Json -Compress -InputObject @{ sent = $p.CloseMainWindow() } }`;
const WIN_WINDOW = `${WIN_USER32}Add-Type -AssemblyName System.Windows.Forms;
$p = Get-Process -Id ([int]$env:HX_PID); $h = $p.MainWindowHandle; if ([HX.W]::IsIconic($h)) { [void][HX.W]::ShowWindowAsync($h, 9); Start-Sleep -Milliseconds 300 };
$all = [System.Windows.Forms.Screen]::AllScreens; $here = [System.Windows.Forms.Screen]::FromHandle($h);
$i = [array]::IndexOf($all, $here); if ($env:HX_PLACE -eq 'next-screen') { $here = $all[($i + 1) % $all.Length] };
$a = $here.WorkingArea; $half = [int]($a.Width / 2);
switch ($env:HX_PLACE) { 'left' { $r = @($a.X, $a.Y, $half, $a.Height) } 'right' { $r = @(($a.X + $half), $a.Y, $half, $a.Height) } default { $r = @($a.X, $a.Y, $a.Width, $a.Height) } };
ConvertTo-Json -Compress -InputObject @{ sent = [HX.W]::MoveWindow($h, $r[0], $r[1], $r[2], $r[3], $true); want = $r; screens = $all.Length }`;
const WIN_DEFAULT = `$k = $env:HX_KEY; $v = '';
try { $v = (Get-ItemProperty -Path $k -ErrorAction Stop).ProgId } catch { };
if ($env:HX_OPEN -eq '1') { Start-Process 'ms-settings:defaultapps' };
ConvertTo-Json -Compress -InputObject @{ progId = $v }`;
const WIN_ALIVE = `$p = Get-Process -Id ([int]$env:HX_PID) -ErrorAction SilentlyContinue; if ($p) { $p.MainWindowTitle + '|' + $p.Responding } else { 'gone' }`;

// ---------- shared ----------

const RUNNING_APP = z.object({
  name: z.string(),
  id: z.string(),
  pid: z.number(),
  active: z.boolean().optional(),
  hidden: z.boolean().optional(),
  title: z.string().optional(),
});
const RUNNING_APPS = z.union([z.array(RUNNING_APP), RUNNING_APP.transform((one) => [one])]);
const SENT = z.object({ sent: z.boolean() });
const PLACED = z.object({
  want: z.array(z.number()),
  now: z.array(z.number()).optional(),
  sent: z.boolean().optional(),
});
const BUNDLE = z.object({ id: z.string(), name: z.string() });
const MAC_DEFAULT_ANSWER = z.object({ before: z.string(), after: z.string(), code: z.number().nullable().optional() });
const WIN_DEFAULT_ANSWER = z.object({
  progId: z
    .string()
    .nullable()
    .transform((value) => value ?? ""),
});

/** The JSON that a script printed, read by its schema; null when it failed or printed something else. */
function json<S extends z.ZodType>(schema: S, result: HxRunResult): z.output<S> | null {
  if (!hxRunOk(result)) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(result.stdout.trim() || "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * macOS refused: Automation for this app (-1743) or Accessibility for System Events (-25211, -1719).
 * A script that does not answer in time waits, most likely, on macOS's question to the user.
 */
function macRefusal(result: HxRunResult): "automation" | "accessibility" | "asking" | null {
  if (result.timedOut) return "asking";
  const text = `${result.stderr}\n${result.stdout}`;
  if (/-1743|Not authorized to send Apple events/iu.test(text)) return "automation";
  if (/-25211|-1719|assistive access/iu.test(text)) return "accessibility";
  return null;
}

async function needsAutomation(
  deps: HxAppDeps,
  kind: "automation" | "accessibility" | "asking",
): Promise<Extract<HxAppResult, { status: "needs-permission" }>> {
  if (kind === "asking")
    return {
      status: "needs-permission",
      reason:
        "macOS did not answer in time: it most likely asks the user whether HXBot may control this app. Tell the user to click OK (Allow) in that dialog, then call again.",
    };
  if (kind === "automation") {
    await deps.openAutomationPage().catch(() => undefined);
    return {
      status: "needs-permission",
      reason:
        "macOS did not let HXBot control this app (Automation). HXBot opened the Automation page of System Settings (or, when the user works in another app, a notification that opens it): tell the user to turn on the app under HXBot there, then call again.",
    };
  }
  return {
    status: "needs-permission",
    reason:
      "HXBot has no Accessibility grant, which menus and windows need. Tell the user to grant it in Settings › Computer Use, then call again.",
  };
}

const NO_APP = (app: string): HxAppResult => ({
  status: "not-found",
  reason: `No running app is called ${JSON.stringify(app)}. Call with action list to see the running apps, or open the app first with computer_open.`,
});

const IMAGE_HINT =
  "Use computer_look on the app's window and computer_do (a menu or a click step); a screenshot with capture_screen is the last way.";

/** The menu path of a risky command: Delete, Send, Empty Trash and the like need a yes. */
function riskyPath(path: readonly string[]): boolean {
  return path.some((part) => hxRiskyLabel(part));
}

function macEnv(extra: Record<string, string>): { timeoutMs: number; env: Record<string, string> } {
  return { timeoutMs: MAC_TIMEOUT_MS, env: extra };
}

async function waitGone(deps: HxAppDeps, pid: number): Promise<boolean> {
  for (let waited = 0; waited < QUIT_WAIT_MS; waited += POLL_MS) {
    await deps.sleep(POLL_MS);
    if (deps.platform === "win32") {
      const alive = await deps.run(powerShell(WIN_ALIVE).command, powerShell(WIN_ALIVE).args, {
        timeoutMs: WIN_TIMEOUT_MS,
        env: { HX_PID: String(pid) },
      });
      if (hxRunOk(alive) && alive.stdout.trim() === "gone") return true;
    } else {
      const alive = await deps.run("/bin/ps", ["-p", String(pid), "-o", "pid="]);
      if (alive.code !== 0 || alive.stdout.trim() === "") return true;
    }
  }
  return false;
}

// ---------- the tool ----------

/** One call of computer_app. It never rejects: every problem is an answer the model can read. */
export async function hxAppControl(deps: HxAppDeps, input: HxAppInput): Promise<HxAppResult> {
  if (deps.platform !== "darwin" && deps.platform !== "win32")
    return { status: "failed", reason: "Apps are controlled on macOS and Windows only." };
  try {
    return deps.platform === "darwin" ? await mac(deps, input) : await windows(deps, input);
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message.slice(0, 300) : "It did not work." };
  }
}

async function mac(deps: HxAppDeps, input: HxAppInput): Promise<HxAppResult> {
  const jxa = (script: string, env: Record<string, string> = {}) =>
    deps.run(OSASCRIPT, ["-l", "JavaScript", "-e", script], macEnv(env));
  if (input.action === "list") {
    const apps = json(z.array(RUNNING_APP), await jxa(MAC_LIST));
    return apps ? { status: "apps", apps } : { status: "failed", reason: "The running apps could not be read." };
  }
  if (input.action === "default") return macDefault(input, jxa);
  const want = input.app?.trim();
  if (!want) return { status: "invalid", reason: "Give app: a name from action list." };
  const app = json(RUNNING_APP, await jxa(MAC_FIND, { HX_APP: want }));
  if (!app) return NO_APP(want);
  const label = app.name || want;
  const tried: HxTried[] = [];

  if (input.action === "front") {
    const sent = json(SENT, await jxa(MAC_FRONT, { HX_APP: app.id || app.name }));
    await deps.sleep(POLL_MS);
    if (sent?.sent && (await macFrontmost(jxa)) === app.pid)
      return { status: "done", action: "front", app: label, route: "direct", tried };
    tried.push({ route: "direct", why: "macOS did not bring it to the front from the background" });
    const opened = await deps.run("/usr/bin/open", app.id ? ["-b", app.id] : ["-a", app.name]);
    await deps.sleep(POLL_MS * 2);
    if (hxRunOk(opened) && (await macFrontmost(jxa)) === app.pid)
      return { status: "done", action: "front", app: label, route: "command", tried };
    tried.push({ route: "command", why: hxRunOk(opened) ? "it is still not in front" : hxRunFailure("open", opened) });
    return { status: "use-steps", reason: `${label} did not come to the front. ${IMAGE_HINT}`, tried };
  }

  if (input.action === "hide") {
    const sent = json(SENT, await jxa(MAC_HIDE, { HX_APP: app.id || app.name }));
    await deps.sleep(POLL_MS);
    const now = json(RUNNING_APP, await jxa(MAC_FIND, { HX_APP: app.id || app.name }));
    if (sent?.sent && now?.hidden) return { status: "done", action: "hide", app: label, route: "direct", tried };
    tried.push({ route: "direct", why: "the app is still shown" });
    const script = `on run argv
  tell application "System Events" to set visible of (first process whose unix id is (item 1 of argv as integer)) to false
end run`;
    const hidden = await deps.run(OSASCRIPT, ["-e", script, String(app.pid)], { timeoutMs: MAC_TIMEOUT_MS });
    const refusal = macRefusal(hidden);
    if (refusal) return needsAutomation(deps, refusal);
    if (hxRunOk(hidden)) return { status: "done", action: "hide", app: label, route: "command", tried };
    tried.push({ route: "command", why: hxRunFailure("osascript", hidden) });
    return { status: "use-steps", reason: `${label} could not be hidden. ${IMAGE_HINT}`, tried };
  }

  if (input.action === "quit") {
    if (input.force && !input.confirmed)
      return {
        status: "confirm",
        reason: `Force quit loses what ${label} has not saved. Ask the user in the chat first; after a yes, call again with force and confirmed true.`,
      };
    const sent = json(SENT, await jxa(MAC_QUIT, { HX_APP: app.id || app.name, HX_FORCE: input.force ? "1" : "" }));
    if (sent?.sent && (await waitGone(deps, app.pid)))
      return {
        status: "done",
        action: "quit",
        app: label,
        route: "direct",
        tried,
        detail: input.force ? "forced" : "quit normally",
      };
    if (sent?.sent)
      return {
        status: "waiting",
        app: label,
        reason: `${label} did not quit in ${QUIT_WAIT_MS / 1000} seconds: it most likely asks whether to save. Its own dialog is for the user; tell the user. Force quit only after the user agrees (force and confirmed true).`,
      };
    tried.push({ route: "direct", why: "the app did not take the quit request" });
    const script = `on run argv
  tell application id (item 1 of argv) to quit
end run`;
    const quit = await deps.run(OSASCRIPT, ["-e", script, app.id], { timeoutMs: MAC_TIMEOUT_MS });
    const refusal = macRefusal(quit);
    if (refusal) return needsAutomation(deps, refusal);
    if (hxRunOk(quit) && (await waitGone(deps, app.pid)))
      return { status: "done", action: "quit", app: label, route: "command", tried, detail: "quit normally" };
    tried.push({ route: "command", why: hxRunOk(quit) ? "the app is still open" : hxRunFailure("osascript", quit) });
    return {
      status: "use-steps",
      reason: `${label} did not quit. ${IMAGE_HINT} Its Quit command is in the app's own menu.`,
      tried,
    };
  }

  if (input.action === "window") {
    const place = input.place ?? "max";
    tried.push({ route: "direct", why: "macOS has no system interface that places another app's window" });
    const placed = await jxa(MAC_WINDOW, { HX_PID: String(app.pid), HX_PLACE: place });
    const refusal = macRefusal(placed);
    if (refusal) return needsAutomation(deps, refusal);
    const done = json(PLACED, placed);
    if (done)
      return {
        status: "done",
        action: "window",
        app: label,
        route: "command",
        tried,
        detail: `${place}: ${(done.now ?? done.want).join(", ")}`,
      };
    tried.push({ route: "command", why: hxRunFailure("osascript", placed) });
    return { status: "use-steps", reason: `The window of ${label} could not be placed. ${IMAGE_HINT}`, tried };
  }

  if (input.action === "menus") {
    const listed = await deps.run(OSASCRIPT, ["-e", MAC_MENUS, app.name], { timeoutMs: MAC_TIMEOUT_MS });
    const refusal = macRefusal(listed);
    if (refusal) return needsAutomation(deps, refusal);
    if (!hxRunOk(listed)) return { status: "failed", reason: hxRunFailure("osascript", listed) };
    const menus = new Map<string, string[]>();
    for (const line of listed.stdout.split(/\r?\n/u)) {
      const [menu, item] = line.split("\t");
      if (!menu || !item) continue;
      menus.set(menu, [...(menus.get(menu) ?? []), item]);
    }
    return {
      status: "menus",
      app: label,
      menus: [...menus].map(([menu, items]) => ({ menu, items: items.slice(0, 60) })),
    };
  }

  if (input.action === "menu") {
    const path = input.path ?? [];
    if (path.length < 2 || path.length > 3)
      return {
        status: "invalid",
        reason: 'Give path: the menu and the item, such as ["File", "Save"] (a third part for a submenu item).',
      };
    if (riskyPath(path) && !input.confirmed)
      return {
        status: "confirm",
        reason: `${path.join(" › ")} sends, pays, buys, deletes or publishes. Ask the user in the chat first; after a yes, call again with confirmed true.`,
      };
    const clicked = await deps.run(OSASCRIPT, ["-e", MAC_MENU, app.name, ...path], { timeoutMs: MAC_TIMEOUT_MS });
    const refusal = macRefusal(clicked);
    if (refusal) return needsAutomation(deps, refusal);
    if (hxRunOk(clicked))
      return { status: "done", action: "menu", app: label, route: "controls", tried, detail: path.join(" › ") };
    tried.push({ route: "controls", why: hxRunFailure("osascript", clicked) });
    return {
      status: "use-steps",
      reason: `${path.join(" › ")} was not found in ${label}. Call with action menus for the exact names, or ${IMAGE_HINT}`,
      tried,
    };
  }
  return { status: "invalid", reason: "Unknown action." };
}

async function macFrontmost(jxa: (script: string) => Promise<HxRunResult>): Promise<number | null> {
  return json(RUNNING_APP, await jxa(MAC_FRONTMOST))?.pid ?? null;
}

const SCHEMES: Readonly<Record<Exclude<HxAppDefaultKind, "type">, string>> = { browser: "http", mail: "mailto" };

async function macDefault(
  input: HxAppInput,
  jxa: (script: string, env?: Record<string, string>) => Promise<HxRunResult>,
): Promise<HxAppResult> {
  const kind = input.kind ?? "browser";
  const ext = (input.type ?? "").replace(/^\./u, "").trim();
  if (kind === "type" && !/^[A-Za-z0-9]{1,12}$/u.test(ext))
    return { status: "invalid", reason: 'Give type: a file name extension such as "pdf".' };
  const target = kind === "type" ? `.${ext} files` : kind === "browser" ? "web pages (http, https)" : "email (mailto)";
  const env: Record<string, string> = kind === "type" ? { HX_EXT: ext } : { HX_SCHEME: SCHEMES[kind] };
  let wantName = "";
  if (input.app?.trim()) {
    const bundle = json(BUNDLE, await jxa(MAC_BUNDLE, { HX_APP: input.app.trim() }));
    if (!bundle?.id) return { status: "not-found", reason: `No app called ${JSON.stringify(input.app)} is installed.` };
    env.HX_BUNDLE = bundle.id;
    wantName = bundle.name;
  }
  const answer = json(MAC_DEFAULT_ANSWER, await jxa(MAC_DEFAULT, env));
  if (!answer) return { status: "failed", reason: `The default app of ${target} could not be read.` };
  if (!env.HX_BUNDLE) return { status: "default", kind, target, app: answer.after || "none", route: "direct" };
  if (answer.after.toLowerCase() === env.HX_BUNDLE.toLowerCase())
    return { status: "default", kind, target, app: answer.after, route: "direct" };
  return {
    status: "confirm-dialog",
    reason: `macOS asks the user to confirm in a dialog before ${wantName} opens ${target} (it is still ${answer.before || "the system default"}; macOS answered ${answer.code ?? "nothing"}). Tell the user to click "Use ${wantName}" in that dialog, or click it with computer_look and computer_do, then call again without app to read it.`,
  };
}

async function windows(deps: HxAppDeps, input: HxAppInput): Promise<HxAppResult> {
  const ps = (script: string, env: Record<string, string> = {}) => {
    const { command, args } = powerShell(script);
    return deps.run(command, args, { timeoutMs: WIN_TIMEOUT_MS, env });
  };
  if (input.action === "list") {
    const raw = json(RUNNING_APPS, await ps(WIN_LIST));
    if (!raw) return { status: "failed", reason: "The running apps could not be read." };
    return { status: "apps", apps: raw };
  }
  if (input.action === "default") return winDefault(input, ps);
  if (input.action === "menus" || input.action === "menu")
    return {
      status: "use-steps",
      reason: `Menus of Windows apps go through the controls: ${IMAGE_HINT}`,
      tried: [{ route: "command", why: "Windows has no script interface for another app's menus" }],
    };
  const want = input.app?.trim();
  if (!want) return { status: "invalid", reason: "Give app: a name from action list." };
  const app = json(RUNNING_APP, await ps(WIN_FIND, { HX_APP: want }));
  if (!app) return NO_APP(want);
  const label = app.name || want;
  const env = { HX_PID: String(app.pid) };
  const tried: HxTried[] = [];
  if (input.action === "front" || input.action === "hide") {
    const sent = json(SENT, await ps(input.action === "front" ? WIN_FRONT : WIN_HIDE, env));
    if (sent?.sent) return { status: "done", action: input.action, app: label, route: "direct", tried };
    tried.push({ route: "direct", why: "Windows did not take the request" });
    return { status: "use-steps", reason: `${label}: ${IMAGE_HINT}`, tried };
  }
  if (input.action === "quit") {
    if (input.force && !input.confirmed)
      return {
        status: "confirm",
        reason: `Force quit loses what ${label} has not saved. Ask the user in the chat first; after a yes, call again with force and confirmed true.`,
      };
    const sent = json(SENT, await ps(WIN_QUIT, { ...env, HX_FORCE: input.force ? "1" : "" }));
    if (sent?.sent && (await waitGone(deps, app.pid)))
      return {
        status: "done",
        action: "quit",
        app: label,
        route: "direct",
        tried,
        detail: input.force ? "forced" : "quit normally",
      };
    if (sent?.sent)
      return {
        status: "waiting",
        app: label,
        reason: `${label} did not quit in ${QUIT_WAIT_MS / 1000} seconds: it most likely asks whether to save. Its own dialog is for the user; tell the user. Force quit only after the user agrees (force and confirmed true).`,
      };
    tried.push({ route: "direct", why: "the app has no main window to close" });
    return { status: "use-steps", reason: `${label} did not quit. ${IMAGE_HINT}`, tried };
  }
  if (input.action === "window") {
    const place = input.place ?? "max";
    const done = json(PLACED, await ps(WIN_WINDOW, { ...env, HX_PLACE: place }));
    if (done?.sent)
      return {
        status: "done",
        action: "window",
        app: label,
        route: "direct",
        tried,
        detail: `${place}: ${done.want.join(", ")}`,
      };
    tried.push({ route: "direct", why: "Windows did not move the window" });
    return { status: "use-steps", reason: `The window of ${label} could not be placed. ${IMAGE_HINT}`, tried };
  }
  return { status: "invalid", reason: "Unknown action." };
}

const WIN_KEYS: Readonly<Record<Exclude<HxAppDefaultKind, "type">, string>> = {
  browser: "HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
  mail: "HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\mailto\\UserChoice",
};

async function winDefault(
  input: HxAppInput,
  ps: (script: string, env?: Record<string, string>) => Promise<HxRunResult>,
): Promise<HxAppResult> {
  const kind = input.kind ?? "browser";
  const ext = (input.type ?? "").replace(/^\./u, "").trim();
  if (kind === "type" && !/^[A-Za-z0-9]{1,12}$/u.test(ext))
    return { status: "invalid", reason: 'Give type: a file name extension such as "pdf".' };
  const key =
    kind === "type"
      ? `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${ext}\\UserChoice`
      : WIN_KEYS[kind];
  const target = kind === "type" ? `.${ext} files` : kind === "browser" ? "web pages" : "email";
  const change = Boolean(input.app?.trim());
  const answer = json(WIN_DEFAULT_ANSWER, await ps(WIN_DEFAULT, { HX_KEY: key, HX_OPEN: change ? "1" : "" }));
  if (!answer) return { status: "failed", reason: `The default app of ${target} could not be read.` };
  if (!change) return { status: "default", kind, target, app: answer.progId || "none", route: "direct" };
  return {
    status: "page",
    reason: `Windows lets only the user change default apps, so HXBot opened Settings › Apps › Default apps (now: ${answer.progId || "none"}). Find ${input.app} there with computer_look and set it for ${target} with computer_do, or tell the user what to click.`,
  };
}
