// HXBot 电脑操控：真系统检查用来“看”系统的办法。
// 这些命令不是 HXBot 的功能，是检查程序自己用来核对的：某个进程起来了没有、系统设置窗口现在显示什么、
// 截一张图。HXBot 的功能（打开、读写设置）由 actions.ts 和两张表执行，这里从另一边看结果。
import type { HxComputerPlatform } from "@hxbot/contracts/hx-computer";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { type HxRunner, hxRunOk } from "./runner";
import { hxPowerShell } from "./tables-win";

export interface HxSettingsWindow {
  /** The settings app is running. */
  open: boolean;
  /**
   * macOS: the titles of its windows; the title is the name of the pane. Windows: the name of every
   * element of the window that has one, in the order of the window, the same name as often as it is there.
   */
  texts: string[];
  /** Windows: each element as `type|automation id|name`, for the file that is kept to calibrate the check. */
  raw: string[];
  /** The system did not let the check read the window (no Accessibility permission). */
  blocked: boolean;
}

export interface HxRealSystem {
  /** The process ids of the running programs with this name. */
  processIds(name: string): Promise<number[]>;
  stop(ids: readonly number[]): Promise<void>;
  /** What the settings window shows now. */
  settingsWindow(): Promise<HxSettingsWindow>;
  closeSettings(): Promise<void>;
  /** How many folder windows are open, or null when that cannot be counted. */
  folderWindows(): Promise<number | null>;
  closeFolders(): Promise<void>;
  /** Saves a picture of the screen as JPEG. False when the system refused. */
  screenshot(file: string): Promise<boolean>;
  /** The version of the system, and whether a desktop is there. */
  describe(): Promise<{ system: string; desktop: boolean; detail: string }>;
  /** macOS: whether scripts may talk to System Events. Always true on Windows. */
  automation(): Promise<{ allowed: boolean; detail: string }>;
  /** macOS: whether scripts may read the windows of other apps. Always true on Windows. */
  accessibility(): Promise<{ allowed: boolean; detail: string }>;
}

const MAC_SETTINGS_PROCESS = "System Settings";
const NO_ASSISTIVE_ACCESS = /-25211|-1719|not allowed assistive access|assistive/iu;
const NOT_AUTHORIZED = /-1743|not authori[sz]ed to send apple events/iu;

function numbers(text: string): number[] {
  return text
    .split(/[\s,]+/u)
    .map((part) => Number(part))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function macSystem(run: HxRunner): HxRealSystem {
  const osascript = (script: string, timeoutMs = 15_000) => run("/usr/bin/osascript", ["-e", script], { timeoutMs });
  return {
    async processIds(name) {
      const result = await run("/usr/bin/pgrep", ["-x", name], { timeoutMs: 10_000 });
      return result.code === 0 ? numbers(result.stdout) : [];
    },
    async stop(ids) {
      if (ids.length > 0) await run("/bin/kill", ids.map(String), { timeoutMs: 10_000 });
    },
    async settingsWindow() {
      const result = await osascript(
        `tell application "System Events" to tell process "${MAC_SETTINGS_PROCESS}" to get name of every window`,
      );
      if (hxRunOk(result)) {
        const texts = result.stdout
          .trim()
          .split(", ")
          .filter((part) => part.length > 0);
        return { open: texts.length > 0, texts, raw: texts, blocked: false };
      }
      const blocked = NO_ASSISTIVE_ACCESS.test(result.stderr) || NOT_AUTHORIZED.test(result.stderr);
      const running = (await this.processIds(MAC_SETTINGS_PROCESS)).length > 0;
      return { open: running, texts: [], raw: [], blocked };
    },
    async closeSettings() {
      await run("/usr/bin/pkill", ["-x", MAC_SETTINGS_PROCESS], { timeoutMs: 10_000 });
    },
    async folderWindows() {
      const result = await osascript('tell application "Finder" to count windows');
      const value = Number(result.stdout.trim());
      return hxRunOk(result) && Number.isInteger(value) ? value : null;
    },
    async closeFolders() {
      await osascript('tell application "Finder" to close every window');
    },
    async screenshot(file) {
      return hxRunOk(await run("/usr/sbin/screencapture", ["-x", "-t", "jpg", file], { timeoutMs: 20_000 }));
    },
    async describe() {
      const version = await run("/usr/bin/sw_vers", ["-productVersion"], { timeoutMs: 10_000 });
      const session = await run("/bin/launchctl", ["managername"], { timeoutMs: 10_000 });
      const manager = session.stdout.trim();
      return {
        system: `macOS ${version.stdout.trim() || "?"}`,
        desktop: manager === "Aqua",
        detail: `launchctl managername: ${manager || session.stderr.trim() || "no answer"}`,
      };
    },
    async automation() {
      const result = await osascript('tell application "System Events" to get name of first process');
      if (hxRunOk(result)) return { allowed: true, detail: `System Events answered: ${result.stdout.trim()}` };
      return {
        allowed: false,
        detail: NOT_AUTHORIZED.test(result.stderr)
          ? "This machine does not let scripts talk to System Events."
          : `System Events did not answer: ${result.stderr.trim().slice(0, 300)}`,
      };
    },
    async accessibility() {
      const result = await osascript('tell application "System Events" to tell process "Finder" to count windows');
      if (hxRunOk(result)) return { allowed: true, detail: `Finder has ${result.stdout.trim()} windows.` };
      return {
        allowed: false,
        detail: NO_ASSISTIVE_ACCESS.test(result.stderr)
          ? "This machine does not let scripts read the windows of other apps."
          : `The windows of Finder could not be read: ${result.stderr.trim().slice(0, 300)}`,
      };
    },
  };
}

/** Saves the whole screen to the file that `$env:HX_SHOT` names. */
const WIN_SHOT = [
  "$hxStep = 'screenshot'; $hxShot = $false; try {",
  "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing;",
  "$hxArea = [System.Windows.Forms.SystemInformation]::VirtualScreen;",
  "$hxPicture = New-Object System.Drawing.Bitmap $hxArea.Width, $hxArea.Height;",
  "$hxDraw = [System.Drawing.Graphics]::FromImage($hxPicture);",
  "$hxDraw.CopyFromScreen($hxArea.Left, $hxArea.Top, 0, 0, $hxPicture.Size);",
  "$hxPicture.Save($env:HX_SHOT, [System.Drawing.Imaging.ImageFormat]::Jpeg);",
  "$hxDraw.Dispose(); $hxPicture.Dispose(); $hxShot = $true",
  "} catch { $hxShot = $false };",
  "if ($hxShot) { 'saved' } else { 'no' }",
].join(" ");

/** How many elements of the Settings window are read. The window of a long page has more; its top is enough. */
const WIN_MAX_ELEMENTS = 220;

/**
 * Every named element of the Settings app, read through UI Automation. The window frame belongs to
 * another process, so the elements are found by the process they belong to, anywhere on the desktop.
 */
const WIN_SETTINGS_WINDOW = [
  "$hxStep = 'settings-window';",
  "$hxNames = @(); $hxOpen = $false;",
  "$hxProcess = Get-Process -Name SystemSettings -ErrorAction SilentlyContinue | Select-Object -First 1;",
  "if ($hxProcess) { $hxOpen = $true; try {",
  "Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes;",
  "$hxRoot = [System.Windows.Automation.AutomationElement]::RootElement;",
  "$hxOwn = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $hxProcess.Id);",
  "foreach ($hxElement in $hxRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, $hxOwn)) {",
  "$hxName = [string]$hxElement.Current.Name;",
  "if ($hxName) { $hxNames += ($hxElement.Current.ControlType.ProgrammaticName -replace 'ControlType.', '') + '|' + $hxElement.Current.AutomationId + '|' + $hxName };",
  `if ($hxNames.Count -ge ${WIN_MAX_ELEMENTS}) { break } }`,
  "} catch { } };",
  "@{ open = $hxOpen; names = $hxNames } | ConvertTo-Json -Compress",
].join(" ");

/** `type|automation id|name` as the script above prints it; the name can have the separator in it. */
function elementName(raw: string): string {
  const first = raw.indexOf("|");
  const second = first < 0 ? -1 : raw.indexOf("|", first + 1);
  return (second < 0 ? raw : raw.slice(second + 1)).trim();
}

/** The object in a line of JSON, or null when the text is something else. */
function jsonRecord(text: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/u, "").trim());
  } catch {
    parsed = null;
  }
  return isDynamicRecord(parsed) ? parsed : null;
}

function windowsSystem(run: HxRunner): HxRealSystem {
  const powershell = (script: string, env?: Readonly<Record<string, string>>, timeoutMs = 30_000) => {
    const command = hxPowerShell(script, env);
    return run(command.command, command.args, { timeoutMs, ...(command.env ? { env: command.env } : {}) });
  };
  return {
    async processIds(name) {
      const result = await powershell(
        "$hxStep = 'pids'; @(Get-Process -Name $env:HX_NAME -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ','",
        { HX_NAME: name },
      );
      return hxRunOk(result) ? numbers(result.stdout) : [];
    },
    async stop(ids) {
      if (ids.length === 0) return;
      await powershell(
        "$hxStep = 'stop'; $env:HX_IDS.Split(',') | ForEach-Object { Stop-Process -Id ([int]$_) -Force -ErrorAction SilentlyContinue }",
        { HX_IDS: ids.join(",") },
      );
    },
    async settingsWindow() {
      const closed = { open: false, texts: [], raw: [], blocked: false };
      const result = await powershell(WIN_SETTINGS_WINDOW, undefined, 60_000);
      if (!hxRunOk(result)) return closed;
      const parsed = jsonRecord(result.stdout);
      if (!parsed) return closed;
      const list = Array.isArray(parsed.names) ? parsed.names : [parsed.names];
      const raw = list.flatMap((entry) => (typeof entry === "string" && entry.trim() ? [entry.trim()] : []));
      const texts = raw.map(elementName).filter((name) => name.length > 0);
      return { open: parsed.open === true, texts, raw, blocked: false };
    },
    async closeSettings() {
      await powershell(
        "$hxStep = 'close-settings'; Stop-Process -Name SystemSettings -Force -ErrorAction SilentlyContinue",
      );
    },
    async folderWindows() {
      const result = await powershell(
        "$hxStep = 'folder-windows'; @((New-Object -ComObject Shell.Application).Windows()).Count",
      );
      const value = Number(result.stdout.trim());
      return hxRunOk(result) && Number.isInteger(value) ? value : null;
    },
    async closeFolders() {
      await powershell(
        "$hxStep = 'close-folders'; @((New-Object -ComObject Shell.Application).Windows()) | ForEach-Object { $_.Quit() }",
      );
    },
    async screenshot(file) {
      const result = await powershell(WIN_SHOT, { HX_SHOT: file });
      return hxRunOk(result) && result.stdout.trim() === "saved";
    },
    async describe() {
      const result = await powershell(
        "$hxStep = 'describe'; $hxOs = Get-CimInstance Win32_OperatingSystem; $hxOs.Caption + ' ' + $hxOs.Version + ' | interactive=' + [Environment]::UserInteractive + ' | session=' + (Get-Process -Id $PID).SessionId + ' | culture=' + (Get-Culture).Name + ' | ui=' + (Get-UICulture).Name",
        undefined,
        60_000,
      );
      const text = result.stdout.trim();
      const [system = "Windows ?"] = text.split(" | ");
      return {
        system: system.trim() || "Windows ?",
        desktop: /interactive=True/u.test(text),
        detail: text || result.stderr.trim().slice(0, 300) || "no answer",
      };
    },
    async automation() {
      return { allowed: true, detail: "Windows needs no permission for this." };
    },
    async accessibility() {
      return { allowed: true, detail: "Windows needs no permission for this." };
    },
  };
}

export function hxRealSystem(platform: HxComputerPlatform, run: HxRunner): HxRealSystem {
  return platform === "mac" ? macSystem(run) : windowsSystem(run);
}
