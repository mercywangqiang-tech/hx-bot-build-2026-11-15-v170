// HXBot 电脑操控：真系统检查的“预期”。
// 这台系统上应该有哪些自带应用、一句说法应该找到什么、改了一项设置以后从另一条路应该读到什么、
// 以及为以后新增的设置先试一遍的只读命令。预期写错了，检查会报“失败”或“待看”，按第一轮的结果校准。
import type { HxCatalogEntry, HxCatalogKind, HxComputerPlatform } from "@hxbot/contracts/hx-computer";
import { hxNormalize } from "./search";
import type { HxCommand } from "./tables";
import { hxPowerShell } from "./tables-win";

/** An app that comes with the system. `processes` are the names its process can have. */
export interface HxRealApp {
  /** What the check asks HXBot to open. */
  query: string;
  /** How the catalog entry is recognized: a part of its target or of one of its names, lower case. */
  marks: readonly string[];
  processes: readonly string[];
  /** Every machine of this system has it. An app that is not required and not there is `unavailable`. */
  required: boolean;
  /** The check opens it and closes it again. */
  open: boolean;
}

export const HX_REAL_APPS: Readonly<Record<HxComputerPlatform, readonly HxRealApp[]>> = {
  mac: [
    { query: "TextEdit", marks: ["/textedit.app"], processes: ["TextEdit"], required: true, open: true },
    { query: "Calculator", marks: ["/calculator.app"], processes: ["Calculator"], required: true, open: true },
    { query: "Preview", marks: ["/preview.app"], processes: ["Preview"], required: true, open: true },
    { query: "Finder", marks: ["/finder.app"], processes: ["Finder"], required: true, open: false },
    { query: "About This Mac", marks: ["/about this mac.app"], processes: [], required: false, open: false },
    { query: "Safari", marks: ["/safari.app"], processes: ["Safari"], required: true, open: false },
    {
      query: "System Settings",
      marks: ["/system settings.app"],
      processes: ["System Settings"],
      required: true,
      open: false,
    },
    { query: "Terminal", marks: ["/terminal.app"], processes: ["Terminal"], required: true, open: false },
    { query: "Notes", marks: ["/notes.app"], processes: ["Notes"], required: true, open: false },
  ],
  windows: [
    { query: "Notepad", marks: ["notepad"], processes: ["notepad"], required: true, open: true },
    { query: "Paint", marks: ["paint"], processes: ["mspaint"], required: false, open: true },
    {
      query: "Calculator",
      marks: ["calculator"],
      processes: ["CalculatorApp", "win32calc", "calc"],
      required: false,
      open: true,
    },
    // Not opened: the machine runs command windows of its own, and the check must not close one of those.
    { query: "Command Prompt", marks: ["command prompt"], processes: ["cmd"], required: true, open: false },
    { query: "Settings", marks: ["settings"], processes: ["SystemSettings"], required: true, open: false },
    { query: "File Explorer", marks: ["file explorer"], processes: ["explorer"], required: true, open: false },
  ],
};

/** A name without case and extra spaces. The punctuation stays: Notepad++ is not Notepad. */
function plain(text: string): string {
  return text.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
}

/**
 * The entry of an app among the entries of a catalog. A mark that starts with a slash is the end of
 * the app's path; any other mark is one of its names, compared without case.
 */
export function hxRealAppEntry(entries: readonly HxCatalogEntry[], marks: readonly string[]): HxCatalogEntry | null {
  for (const entry of entries) {
    if (entry.kind !== "app") continue;
    const target = (entry.target ?? "").toLowerCase();
    for (const mark of marks) {
      const found = mark.startsWith("/")
        ? target.endsWith(mark)
        : entry.names.some((name) => plain(name) === plain(mark));
      if (found) return entry;
    }
  }
  return null;
}

/** The names a Mac gives its own apps in Chinese: the check of the Chinese names looks for these. */
export const HX_REAL_MAC_CHINESE: ReadonlyArray<readonly [mark: string, chinese: string]> = [
  ["/finder.app", "访达"],
  ["/terminal.app", "终端"],
  ["/notes.app", "备忘录"],
  ["/system settings.app", "系统设置"],
  ["/calculator.app", "计算器"],
  ["/textedit.app", "文本编辑"],
];

/** The programs a `.txt` file can open in. */
export const HX_REAL_TEXT_EDITORS: Readonly<Record<HxComputerPlatform, readonly string[]>> = {
  mac: ["TextEdit"],
  windows: ["notepad"],
};

/** The programs a web address can open in. */
export const HX_REAL_BROWSERS: Readonly<Record<HxComputerPlatform, readonly string[]>> = {
  mac: ["Safari", "Google Chrome", "firefox", "Microsoft Edge"],
  windows: ["msedge", "chrome", "firefox"],
};

/**
 * What a phrase must lead to: the id of a page or a setting, an app (by a mark of its entry), or
 * `ask` when HXBot must hand back candidates instead of choosing.
 */
export type HxRealWay = { id: string } | { app: string };
type HxRealExpected = HxRealWay | { either: readonly HxRealWay[] } | "ask";

/** The ways a phrase may be answered: one, or each of several that lead to the same place. */
export function hxRealWays(expected: HxRealExpected): readonly HxRealWay[] {
  if (expected === "ask") return [];
  return "either" in expected ? expected.either : [expected];
}

export interface HxRealPhrase {
  phrase: string;
  kinds: readonly HxCatalogKind[];
  expected: HxRealExpected;
}

const ALL: readonly HxCatalogKind[] = ["app", "page", "setting"];
const SETTINGS: readonly HxCatalogKind[] = ["setting", "page"];
const to = (phrase: string, id: string, kinds = ALL): HxRealPhrase => ({ phrase, kinds, expected: { id } });
/** A phrase that more than one entry answers to, each of which takes the user to the same place. */
const either = (phrase: string, ...ways: readonly HxRealWay[]): HxRealPhrase => ({
  phrase,
  kinds: ALL,
  expected: { either: ways },
});
const app = (phrase: string, mark: string): HxRealPhrase => ({ phrase, kinds: ALL, expected: { app: mark } });

export const HX_REAL_PHRASES: Readonly<Record<HxComputerPlatform, readonly HxRealPhrase[]>> = {
  mac: [
    to("蓝牙", "page:bluetooth"),
    to("蓝牙设置", "page:bluetooth"),
    to("打开蓝牙设置", "page:bluetooth"),
    to("bluetooth settings", "page:bluetooth"),
    to("lanya", "page:bluetooth"),
    to("wifi", "page:wifi"),
    to("无线网络", "page:wifi"),
    to("声音设置", "page:sound"),
    to("显示器", "page:displays"),
    to("壁纸", "page:wallpaper"),
    to("键盘", "page:keyboard"),
    to("打印机", "page:printers"),
    to("通知", "page:notifications"),
    // A Mac has an app of that name too, and it opens the same pane.
    either("关于本机", { id: "page:about" }, { app: "/about this mac.app" }),
    to("软件更新", "page:software-update"),
    to("隐私与安全性", "page:privacy"),
    to("程序坞", "page:desktop-dock"),
    to("深色模式", "setting:dark-mode", SETTINGS),
    to("把深色模式打开", "setting:dark-mode", SETTINGS),
    to("dark mode", "setting:dark-mode", SETTINGS),
    to("音量", "setting:volume", SETTINGS),
    to("把音量调到 30", "setting:volume", SETTINGS),
    to("静音", "setting:mute", SETTINGS),
    to("程序坞位置", "setting:dock-position", SETTINGS),
    { phrase: "自动隐藏", kinds: SETTINGS, expected: "ask" },
    app("终端", "/terminal.app"),
    app("terminal", "/terminal.app"),
    app("zhongduan", "/terminal.app"),
    app("访达", "/finder.app"),
    app("计算器", "/calculator.app"),
    app("备忘录", "/notes.app"),
    app("文本编辑", "/textedit.app"),
    app("设置", "/system settings.app"),
    app("打开设置", "/system settings.app"),
    app("系统设置", "/system settings.app"),
    app("safari", "/safari.app"),
  ],
  windows: [
    to("蓝牙", "page:bluetooth"),
    to("蓝牙设置", "page:bluetooth"),
    to("打开蓝牙设置", "page:bluetooth"),
    to("bluetooth settings", "page:bluetooth"),
    to("wifi", "page:wifi"),
    to("声音设置", "page:sound"),
    to("屏幕", "page:display"),
    to("夜间模式", "page:night-light"),
    to("壁纸", "page:background"),
    to("任务栏", "page:taskbar"),
    to("打印机", "page:printers"),
    to("系统更新", "page:windows-update"),
    to("默认应用", "page:default-apps"),
    to("剪贴板", "page:clipboard"),
    to("隐私", "page:privacy"),
    to("深色模式", "setting:dark-mode", SETTINGS),
    to("打开深色模式", "setting:dark-mode", SETTINGS),
    to("dark mode", "setting:dark-mode", SETTINGS),
    to("透明效果", "setting:transparency", SETTINGS),
    to("亮度", "setting:brightness", SETTINGS),
    to("剪贴板历史记录", "setting:clipboard-history", SETTINGS),
    app("记事本", "notepad"),
    app("notepad", "notepad"),
    app("设置", "settings"),
    app("打开设置", "settings"),
    app("系统设置", "settings"),
    app("资源管理器", "file explorer"),
    app("cmd", "command prompt"),
  ],
};

/** A name of the window that is this much longer than the name of the page is a sentence, not a heading. */
const HEADING_SLACK = 14;

/**
 * Whether what the settings window shows is the page that was asked for. The name is the English
 * name of the page: the machines of GitHub run in English. One of the texts must be the name, or a
 * heading that contains it or is contained in it ("Login Items" in "Login Items & Extensions"), or a
 * heading with every word of the name of four letters or more ("Bluetooth & devices" in
 * "Bluetooth & other devices").
 */
export function hxRealPageShown(texts: readonly string[], name: string): boolean {
  const wanted = hxNormalize(name);
  if (!wanted) return false;
  const words = name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4);
  return texts.some((text) => {
    const shown = hxNormalize(text);
    if (!shown) return false;
    if (shown === wanted) return true;
    if (shown.length > wanted.length + HEADING_SLACK) return false;
    if (shown.length >= 4 && (shown.includes(wanted) || wanted.includes(shown))) return true;
    return words.length > 0 && words.every((word) => shown.includes(word));
  });
}

/**
 * What is known about a page beyond its name. `titles`: other headings the system gives the page.
 * `hardware`: the page is only there on a computer with that hardware (a battery, a trackpad, a
 * wireless card); when it does not show on a machine, that is `unavailable`, not a failure.
 * Filled in from what the machines show: the first run tells which names differ.
 */
export interface HxRealPageNote {
  titles?: readonly string[];
  hardware?: true;
  /** Windows Server has no such page; a desktop Windows does. */
  desktopOnly?: true;
}

export const HX_REAL_PAGE_NOTES: Readonly<Record<HxComputerPlatform, Readonly<Record<string, HxRealPageNote>>>> = {
  mac: {
    battery: { titles: ["Energy", "Energy Saver"], hardware: true },
    "touch-id": { titles: ["Login Password", "Touch ID"], hardware: true },
    trackpad: { hardware: true },
    wallet: { hardware: true },
    siri: { titles: ["Siri", "Apple Intelligence & Siri", "Spotlight"] },
    "apple-account": { titles: ["Apple ID", "Sign in"] },
    "control-center": { titles: ["Menu Bar"] },
    airdrop: { titles: ["AirDrop & Continuity"] },
  },
  windows: {
    touchpad: { hardware: true },
    wifi: { hardware: true },
    hotspot: { hardware: true },
    airplane: { hardware: true },
    power: { titles: ["Power", "Power & battery"] },
    "text-size": { titles: ["Display"] },
    accessibility: { titles: ["Ease of Access"] },
    "night-light": { desktopOnly: true },
    clipboard: { desktopOnly: true },
    "game-bar": { desktopOnly: true },
    backup: { desktopOnly: true },
  },
};

/** What the text of a failed read looks like when the machine has no such hardware. */
export const HX_REAL_NO_HARDWARE: Readonly<Record<HxComputerPlatform, Readonly<Record<string, RegExp>>>> = {
  mac: {},
  windows: { brightness: /not supported|invalid class|0x8004100c|0x80041010/iu },
};

/** A second way to read a setting, which HXBot's own read command does not use. */
export interface HxRealEffect {
  command: HxCommand;
  /** Whether the answer says that the setting has `value` now. */
  shows(stdout: string, code: number | null, value: string): boolean;
}

const DEFAULTS = "/usr/bin/defaults";

function defaultsRead(args: readonly string[], shows: HxRealEffect["shows"]): HxRealEffect {
  return { command: { command: DEFAULTS, args: ["read", ...args] }, shows };
}

const asSwitch = (stdout: string, _code: number | null, value: string) =>
  stdout.trim() === (value === "on" ? "1" : "0");

function regPath(): string {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return `${root.replace(/[\\/]+$/u, "")}\\System32\\reg.exe`;
}

/** The number under `name` in what `reg query` printed, or null. */
export function hxRegValue(stdout: string, name: string): number | null {
  for (const line of stdout.split(/\r?\n/u)) {
    const parts = line.trim().split(/\s+/u);
    if (parts[0] === name && parts[1] === "REG_DWORD" && parts[2]) {
      const value = Number.parseInt(parts[2], 16);
      return Number.isNaN(value) ? null : value;
    }
  }
  return null;
}

function regRead(key: string, name: string, onIs: 0 | 1): HxRealEffect {
  return {
    command: { command: regPath(), args: ["query", key, "/v", name] },
    shows: (stdout, _code, value) => hxRegValue(stdout, name) === (value === "on" ? onIs : 1 - onIs),
  };
}

const PERSONALIZE = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
const ADVANCED = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";

const EFFECTS: Readonly<Record<HxComputerPlatform, Readonly<Record<string, HxRealEffect>>>> = {
  mac: {
    // The key is there with the value Dark in dark mode, and not there at all in light mode.
    "dark-mode": defaultsRead(["-g", "AppleInterfaceStyle"], (stdout, code, value) =>
      value === "on" ? stdout.trim() === "Dark" : code !== 0 || stdout.trim() !== "Dark",
    ),
    "dock-autohide": defaultsRead(["com.apple.dock", "autohide"], asSwitch),
    "dock-magnification": defaultsRead(["com.apple.dock", "magnification"], asSwitch),
    "dock-recents": defaultsRead(["com.apple.dock", "show-recents"], asSwitch),
    "menu-bar-autohide": defaultsRead(["-g", "_HIHideMenuBar"], asSwitch),
    "dock-position": defaultsRead(["com.apple.dock", "orientation"], (stdout, _code, value) => stdout.trim() === value),
    "dock-minimize-effect": defaultsRead(
      ["com.apple.dock", "mineffect"],
      (stdout, _code, value) => stdout.trim() === value,
    ),
    // The Dock keeps its size as the size of a tile, 16 to 128 points; HXBot shows it as 0 to 100.
    "dock-size": defaultsRead(["com.apple.dock", "tilesize"], (stdout, _code, value) => {
      const tile = Number(stdout.trim());
      return Number.isFinite(tile) && Math.abs(((tile - 16) / 112) * 100 - Number(value)) <= 3;
    }),
    "dock-indicators": defaultsRead(["com.apple.dock", "show-process-indicators"], asSwitch),
    "dock-minimize-into-app": defaultsRead(["com.apple.dock", "minimize-to-application"], asSwitch),
    "dock-launch-animation": defaultsRead(["com.apple.dock", "launchanim"], asSwitch),
  },
  windows: {
    "app-dark-mode": regRead(PERSONALIZE, "AppsUseLightTheme", 0),
    "system-dark-mode": regRead(PERSONALIZE, "SystemUsesLightTheme", 0),
    transparency: regRead(PERSONALIZE, "EnableTransparency", 1),
    "clipboard-history": regRead("HKCU\\Software\\Microsoft\\Clipboard", "EnableClipboardHistory", 1),
    "taskbar-alignment": {
      command: { command: regPath(), args: ["query", ADVANCED, "/v", "TaskbarAl"] },
      shows: (stdout, _code, value) => hxRegValue(stdout, "TaskbarAl") === (value === "left" ? 0 : 1),
    },
    "task-view-button": regRead(ADVANCED, "ShowTaskViewButton", 1),
    "clock-seconds": regRead(ADVANCED, "ShowSecondsInSystemClock", 1),
    "accent-title-bars": regRead("HKCU\\Software\\Microsoft\\Windows\\DWM", "ColorPrevalence", 1),
    "accent-start-taskbar": regRead(PERSONALIZE, "ColorPrevalence", 1),
    notifications: regRead("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications", "ToastEnabled", 1),
    "game-mode": regRead("HKCU\\Software\\Microsoft\\GameBar", "AllowAutoGameMode", 1),
    "storage-sense": regRead(
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\StorageSense\\Parameters\\StoragePolicy",
      "01",
      1,
    ),
    "dark-mode": {
      command: { command: regPath(), args: ["query", PERSONALIZE] },
      shows: (stdout, _code, value) => {
        const apps = hxRegValue(stdout, "AppsUseLightTheme");
        const system = hxRegValue(stdout, "SystemUsesLightTheme");
        if (value === "on") return apps === 0 && system === 0;
        if (value === "off") return apps === 1 && system === 1;
        if (value === "apps only") return apps === 0 && system === 1;
        return value === "system only" && apps === 1 && system === 0;
      },
    },
  },
};

/** The second way to read this setting, or null when there is none (the volume, the brightness). */
export function hxRealEffect(platform: HxComputerPlatform, key: string): HxRealEffect | null {
  return EFFECTS[platform][key] ?? null;
}

/** A command that only reads. Its answer tells how a setting that HXBot does not have yet is kept here. */
export interface HxRealProbe {
  id: string;
  command: HxCommand;
  timeoutMs?: number;
}

const osa = (script: string): HxCommand => ({ command: "/usr/bin/osascript", args: ["-e", script] });
const defaults = (id: string, ...args: string[]): HxRealProbe => ({
  id,
  command: { command: DEFAULTS, args: ["read", ...args] },
});
const reg = (id: string, key: string): HxRealProbe => ({ id, command: { command: regPath(), args: ["query", key] } });
const shell = (id: string, script: string, timeoutMs?: number): HxRealProbe => ({
  id,
  command: hxPowerShell(`$hxStep = 'probe'; ${script}`),
  ...(timeoutMs ? { timeoutMs } : {}),
});
const EXPLORER = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer";

export const HX_REAL_PROBES: Readonly<Record<HxComputerPlatform, readonly HxRealProbe[]>> = {
  mac: [
    defaults("languages", "-g", "AppleLanguages"),
    { id: "volume-settings", command: osa("get volume settings") },
    {
      id: "dock-properties",
      command: osa('tell application "System Events" to get properties of dock preferences'),
    },
    {
      id: "appearance-properties",
      command: osa('tell application "System Events" to get properties of appearance preferences'),
    },
    defaults("dock-minimize-to-application", "com.apple.dock", "minimize-to-application"),
    defaults("dock-process-indicators", "com.apple.dock", "show-process-indicators"),
    defaults("dock-launch-animation", "com.apple.dock", "launchanim"),
    defaults("dock-large-size", "com.apple.dock", "largesize"),
    defaults("dock-tile-size", "com.apple.dock", "tilesize"),
    defaults("dock-orientation", "com.apple.dock", "orientation"),
    defaults("spaces-rearrange", "com.apple.dock", "mru-spaces"),
    defaults("finder-hidden-files", "com.apple.finder", "AppleShowAllFiles"),
    defaults("finder-extensions", "-g", "AppleShowAllExtensions"),
    defaults("finder-path-bar", "com.apple.finder", "ShowPathbar"),
    defaults("finder-status-bar", "com.apple.finder", "ShowStatusBar"),
    defaults("stage-manager", "com.apple.WindowManager", "GloballyEnabled"),
    defaults("clock", "com.apple.menuextra.clock"),
    defaults("clock-24-hours", "-g", "AppleICUForce24HourTime"),
    {
      id: "battery-percentage",
      command: {
        command: DEFAULTS,
        args: ["-currentHost", "read", "com.apple.controlcenter", "BatteryShowPercentage"],
      },
    },
    defaults("sound-feedback", "-g", "com.apple.sound.beep.feedback"),
    defaults("sound-interface", "-g", "com.apple.sound.uiaudio.enabled"),
    defaults("screenshot", "com.apple.screencapture"),
    { id: "wallpaper", command: osa('tell application "System Events" to get picture of every desktop') },
    { id: "network-ports", command: { command: "/usr/sbin/networksetup", args: ["-listallhardwareports"] } },
    { id: "power", command: { command: "/usr/bin/pmset", args: ["-g"] } },
    {
      id: "visible-processes",
      command: osa('tell application "System Events" to get name of every process whose background only is false'),
    },
    // The last one: when macOS asks whether a script may talk to System Settings, the question stays
    // on the screen, and nothing after it must depend on the screen.
    {
      id: "settings-current-pane",
      command: osa(
        'with timeout of 6 seconds\ntell application "System Settings" to get id of current pane\nend timeout',
      ),
      timeoutMs: 9000,
    },
  ],
  windows: [
    reg("explorer-advanced", `${EXPLORER}\\Advanced`),
    reg("explorer", EXPLORER),
    reg("search", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Search"),
    reg("personalize", PERSONALIZE),
    reg("dwm", "HKCU\\Software\\Microsoft\\Windows\\DWM"),
    reg("mouse", "HKCU\\Control Panel\\Mouse"),
    reg("desktop", "HKCU\\Control Panel\\Desktop"),
    reg("accessibility", "HKCU\\Control Panel\\Accessibility"),
    reg("notifications", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications"),
    reg("game-bar", "HKCU\\Software\\Microsoft\\GameBar"),
    reg("storage-sense", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\StorageSense\\Parameters\\StoragePolicy"),
    reg("clipboard", "HKCU\\Software\\Microsoft\\Clipboard"),
    shell("power-scheme", "powercfg /getactivescheme"),
    shell("power-display", "powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLE"),
    shell("power-sleep", "powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE"),
    shell("sound-devices", "Get-CimInstance Win32_SoundDevice | Select-Object Name, Status | ConvertTo-Json -Compress"),
    shell(
      "network-adapters",
      "Get-NetAdapter | Select-Object Name, InterfaceDescription, Status | ConvertTo-Json -Compress",
    ),
    shell("start-apps", "(Get-StartApps | Select-Object -First 150 | ForEach-Object { $_.Name }) -join ' ; '"),
    shell(
      "brightness",
      "Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -OperationTimeoutSec 10 -ErrorAction Stop | Select-Object CurrentBrightness, Levels | ConvertTo-Json -Compress",
    ),
    shell("culture", "(Get-Culture).Name + ' ; ' + (Get-UICulture).Name + ' ; ' + (Get-WinSystemLocale).Name"),
    // What one start of PowerShell costs on this machine, measured from inside one: on an ARM
    // computer we measured it was 22 seconds, which is most of what reading a setting takes.
    shell(
      "powershell-start",
      "$hxOwn = [Diagnostics.Process]::GetCurrentProcess(); $hxUp = [int]((Get-Date) - $hxOwn.StartTime).TotalMilliseconds; $hxEach = @(); foreach ($hxRound in 1..3) { $hxAt = Get-Date; & $hxOwn.Path -NoLogo -NoProfile -NonInteractive -Command exit | Out-Null; $hxEach += [int]((Get-Date) - $hxAt).TotalMilliseconds }; 'this one was already up for ' + $hxUp + ' ms; another one takes ' + ($hxEach -join ', ') + ' ms'",
      180_000,
    ),
  ],
};

/** Files that HXBot must refuse to open, by the name the check gives them. `runnable` marks them as programs. */
export const HX_REAL_REFUSED: ReadonlyArray<{ name: string; runnable?: true; only?: HxComputerPlatform }> = [
  { name: "script.sh" },
  { name: "double-click.command" },
  { name: "program.exe" },
  { name: "batch.bat" },
  { name: "shortcut.lnk" },
  { name: "address.url" },
  { name: "macro.py" },
  { name: "installer.msi" },
  { name: "tool", runnable: true, only: "mac" },
];

/** Addresses that are not web addresses: HXBot must refuse each. */
export const HX_REAL_REFUSED_ADDRESSES: readonly string[] = [
  "file:///etc/hosts",
  "javascript:alert(1)",
  "ms-msdt:/id",
  "x-apple.systempreferences:com.apple.BluetoothSettings",
];
