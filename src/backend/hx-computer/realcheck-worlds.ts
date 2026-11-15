// HXBot 电脑操控：给真系统检查的单元测试用的两台“假电脑”。一台 Mac、一台 Windows：
// 它们回答检查程序会发出的每一条系统命令（打开、读写设置、看进程、读设置窗口），并记住被改过的状态，
// 所以整套检查可以在 Linux 上从头跑到尾。`faults` 让它在指定的地方出错，用来测检查程序认不认得出问题。
// 只被测试引用；真系统上跑的是 realcheck.ts 加上真的命令。
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { HxRunner, HxRunResult } from "./runner";
import { HX_COMBINED_SEPARATOR } from "./tables";
import { HX_MAC_PAGES } from "./tables-mac";
import { HX_WIN_PAGES } from "./tables-win";

const ok = (stdout = ""): HxRunResult => ({ code: 0, stdout, stderr: "", timedOut: false, missing: false });
const bad = (stderr: string, code = 1): HxRunResult => ({ code, stdout: "", stderr, timedOut: false, missing: false });

export interface HxWorldFaults {
  /** macOS: scripts may not talk to System Events. */
  noAutomation?: boolean;
  /** macOS: scripts may not read the windows of other apps. */
  noAccessibility?: boolean;
  /** Settings whose write command succeeds and changes nothing. */
  deaf?: readonly string[];
  /** Settings that take one change and then refuse every later one: they cannot be put back. */
  sticky?: readonly string[];
  /** Settings that the other way of reading does not show as changed. */
  hiddenEffect?: readonly string[];
  /** Pages whose address the system ignores: the window stays as it was. */
  deadPages?: readonly string[];
  /** Pages that the system shows under another heading. */
  renamedPages?: Readonly<Record<string, string>>;
  /** Apps that are not on this machine, by the name of the app. */
  withoutApps?: readonly string[];
  /** macOS: panes whose extension is not on this Mac, by the key of the page. */
  withoutPanes?: readonly string[];
  /** No desktop session. */
  noDesktop?: boolean;
  /** Opening an app succeeds and no process appears. */
  appsDoNotStart?: boolean;
}

export interface HxWorld {
  run: HxRunner;
  home: string;
  /** macOS: the folder with the panes of System Settings. */
  extensions: string;
  now(): number;
  wait(ms: number): Promise<void>;
  /** Every command the world was asked to run. */
  commands: string[];
  /** The values of the settings right now, in the system's own words. */
  values(): Record<string, string>;
}

/** The read and the write script of a script that combine.ts built for Windows, or null. */
function combinedParts(script: string): { read: string; write: string } | null {
  const start = "$hxBefore = & { ";
  const middle = " }; & { ";
  const end = " } | Out-Null; $hxAfter = & { ";
  const at = script.indexOf(start);
  const mid = script.indexOf(middle, at);
  const stop = script.indexOf(end, mid);
  if (at < 0 || mid < 0 || stop < 0) return null;
  return { read: script.slice(at + start.length, mid), write: script.slice(mid + middle.length, stop) };
}

/** What a command that reads, writes and reads again prints, as the real one does. */
async function combined(
  read: () => HxRunResult | Promise<HxRunResult>,
  write: () => HxRunResult | Promise<HxRunResult>,
): Promise<HxRunResult> {
  const before = await read();
  if (before.code !== 0) return before;
  const written = await write();
  if (written.code !== 0) return written;
  const after = await read();
  if (after.code !== 0) return after;
  return ok(`${before.stdout.trim()}\n${HX_COMBINED_SEPARATOR}\n${after.stdout.trim()}`);
}

function clock() {
  const state = { time: 1_800_000_000_000 };
  return {
    state,
    now: () => state.time,
    wait: async (ms: number) => {
      state.time += ms;
    },
  };
}

function processes(faults: HxWorldFaults) {
  const table = new Map<string, number[]>();
  const next = { id: 4000 };
  return {
    start(name: string, count = 1) {
      if (faults.appsDoNotStart) return;
      const ids = table.get(name) ?? [];
      for (let index = 0; index < count; index += 1) {
        next.id += 1;
        ids.push(next.id);
      }
      table.set(name, ids);
    },
    ids: (name: string) => table.get(name) ?? [],
    idsAnyCase(name: string) {
      const wanted = name.toLowerCase();
      return [...table].flatMap(([known, ids]) => (known.toLowerCase() === wanted ? ids : []));
    },
    stop(ids: readonly number[]) {
      for (const [name, running] of table)
        table.set(
          name,
          running.filter((id) => !ids.includes(id)),
        );
    },
    clear(name: string) {
      table.delete(name);
    },
  };
}

const MAC_APPS: ReadonlyArray<readonly [name: string, chinese: string]> = [
  ["TextEdit", "文本编辑"],
  ["Calculator", "计算器"],
  ["Preview", "预览"],
  ["Safari", "Safari浏览器"],
  ["System Settings", "系统设置"],
  ["Terminal", "终端"],
  ["Notes", "备忘录"],
  ["Audio MIDI Setup", "音频MIDI设置"],
  ["Bluetooth File Exchange", "蓝牙文件交换"],
  ["Disk Utility", "磁盘工具"],
  ["Font Book", "字体册"],
  ["Keychain Access", "钥匙串访问"],
  ["Activity Monitor", "活动监视器"],
  ["Screenshot", "截屏"],
  ["Weather", "天气"],
  ["Maps", "地图"],
  ["Music", "音乐"],
  ["Photos", "照片"],
  ["Mail", "邮件"],
  ["Calendar", "日历"],
  ["Reminders", "提醒事项"],
  ["Xcode", ""],
  ["Google Chrome", ""],
];

async function macFiles(home: string, extensions: string, faults: HxWorldFaults): Promise<void> {
  for (const [name, chinese] of MAC_APPS) {
    if (faults.withoutApps?.includes(name)) continue;
    const contents = join(home, "Applications", `${name}.app`, "Contents");
    await mkdir(contents, { recursive: true });
    await writeFile(
      join(contents, "Info.plist"),
      `<?xml version="1.0"?><plist><dict><key>CFBundleName</key><string>${name}</string></dict></plist>`,
    );
    if (chinese) {
      const strings = join(contents, "Resources", "zh-Hans.lproj");
      await mkdir(strings, { recursive: true });
      await writeFile(join(strings, "InfoPlist.strings"), `"CFBundleDisplayName" = "${chinese}";\n`);
    }
  }
  for (const page of HX_MAC_PAGES) {
    if (faults.withoutPanes?.includes(page.key)) continue;
    const id = page.address.slice(page.address.indexOf(":") + 1);
    const contents = join(extensions, `${page.key}.appex`, "Contents");
    await mkdir(contents, { recursive: true });
    await writeFile(
      join(contents, "Info.plist"),
      `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>${id}</string></dict></plist>`,
    );
  }
}

/** A Mac. `home` and `extensions` are folders the test made; the apps and the panes are written into them. */
export async function hxMacWorld(home: string, extensions: string, faults: HxWorldFaults = {}): Promise<HxWorld> {
  await macFiles(home, extensions, faults);
  const time = clock();
  const running = processes(faults);
  const commands: string[] = [];
  const appearance = { dark: false };
  const volume = new Map<string, string>([
    ["output volume", "50"],
    ["output muted", "false"],
    ["alert volume", "75"],
    ["input volume", "40"],
  ]);
  const dock = new Map<string, string>([
    ["autohide", "false"],
    ["magnification", "false"],
    ["show recents", "true"],
    ["autohide menu bar", "false"],
    ["screen edge", "bottom"],
    ["minimize effect", "genie"],
    ["dock size", "0.5"],
    ["show indicators", "true"],
    ["minimize into application", "false"],
    ["animate", "true"],
    ["magnification size", "1"],
  ]);
  /** The key of the setting each property belongs to, for the faults. */
  const keys: Readonly<Record<string, string>> = {
    "dark mode": "dark-mode",
    "output volume": "volume",
    "output muted": "mute",
    "alert volume": "alert-volume",
    "input volume": "input-volume",
    autohide: "dock-autohide",
    magnification: "dock-magnification",
    "show recents": "dock-recents",
    "autohide menu bar": "menu-bar-autohide",
    "screen edge": "dock-position",
    "minimize effect": "dock-minimize-effect",
    "dock size": "dock-size",
    "show indicators": "dock-indicators",
    "minimize into application": "dock-minimize-into-app",
    animate: "dock-launch-animation",
    "magnification size": "dock-magnification-size",
  };
  const changed = new Set<string>();
  /** Whether a write to this property takes effect, by the faults. Writing the value it has always does. */
  const takes = (property: string, now: string | undefined, next: string) => {
    const key = keys[property] ?? "";
    if (now === next) return true;
    if (faults.deaf?.includes(key)) return false;
    if (faults.sticky?.includes(key)) {
      if (changed.has(key)) return false;
      changed.add(key);
    }
    return true;
  };
  const hidden = (property: string) => faults.hiddenEffect?.includes(keys[property] ?? "") === true;
  const settings = { running: false, title: "" };
  const finder = { windows: 0 };
  const titles = new Map(
    HX_MAC_PAGES.map((page) => [page.address, faults.renamedPages?.[page.key] ?? page.en] as const),
  );
  const dead = new Set(HX_MAC_PAGES.filter((page) => faults.deadPages?.includes(page.key)).map((page) => page.address));
  const notAllowed = bad("execution error: Not authorized to send Apple events to System Events. (-1743)");

  const events = (text: string): HxRunResult => {
    if (faults.noAutomation) return notAllowed;
    if (text === "get name of first process") return ok("Finder\n");
    if (text === 'tell process "Finder" to count windows') {
      return faults.noAccessibility
        ? bad("execution error: System Events got an error: osascript is not allowed assistive access. (-25211)")
        : ok(`${finder.windows}\n`);
    }
    if (text === 'tell process "System Settings" to get name of every window') {
      if (faults.noAccessibility) {
        return bad("execution error: System Events got an error: osascript is not allowed assistive access. (-25211)");
      }
      return settings.running
        ? ok(`${settings.title}\n`)
        : bad('execution error: System Events got an error: Can’t get process "System Settings". (-1728)');
    }
    if (text === "tell appearance preferences to get dark mode") return ok(`${appearance.dark}\n`);
    const dark = /^tell appearance preferences to set dark mode to (true|false)$/u.exec(text);
    if (dark) {
      if (takes("dark mode", String(appearance.dark), dark[1] ?? "")) appearance.dark = dark[1] === "true";
      return ok();
    }
    const read = /^get (.+) of dock preferences$/u.exec(text);
    if (read?.[1]) {
      const value = dock.get(read[1]);
      return value === undefined ? bad(`Can’t get ${read[1]}`) : ok(`${value}\n`);
    }
    const size = /^set (dock size|magnification size) of dock preferences to \((\d+) \/ 100\)$/u.exec(text);
    if (size?.[1] && size[2]) {
      const next = String(Number(size[2]) / 100);
      if (takes(size[1], dock.get(size[1]), next)) dock.set(size[1], next);
      return ok();
    }
    const write = /^set (.+) of dock preferences to (.+)$/u.exec(text);
    if (write?.[1] && write[2] !== undefined) {
      if (!dock.has(write[1])) return bad(`Can’t set ${write[1]}`);
      if (takes(write[1], dock.get(write[1]), write[2])) dock.set(write[1], write[2]);
      return ok();
    }
    if (
      text.startsWith("get properties of") ||
      text.startsWith("get picture of") ||
      text.startsWith("get name of every process")
    ) {
      return ok("something\n");
    }
    return bad(`the Mac of the tests does not know this System Events request: ${text}`);
  };

  const osascript = (script: string): HxRunResult => {
    const prefix = 'tell application "System Events" to ';
    if (script.startsWith(prefix)) return events(script.slice(prefix.length));
    if (script === 'tell application "Finder" to count windows') return ok(`${finder.windows}\n`);
    if (script === 'tell application "Finder" to close every window') {
      finder.windows = 0;
      return ok();
    }
    if (script === "get volume settings")
      return ok("output volume:50, input volume:40, alert volume:75, output muted:false\n");
    const read = /^(.+) of \(get volume settings\)$/u.exec(script);
    if (read?.[1]) return ok(`${volume.get(read[1]) ?? "missing value"}\n`);
    const write = /^set volume (output volume|output muted|alert volume|input volume) (.+)$/u.exec(script);
    if (write?.[1] && write[2] !== undefined) {
      if (takes(write[1], volume.get(write[1]), write[2])) volume.set(write[1], write[2]);
      return ok();
    }
    if (script.includes('tell application "System Settings"')) {
      return bad("execution error: Not authorized to send Apple events to System Settings. (-1743)");
    }
    return bad(`the Mac of the tests does not know this script: ${script}`);
  };

  const defaults = (args: readonly string[]): HxRunResult => {
    const key = args.join(" ");
    const missing = bad(`The domain/default pair of (${key}) does not exist`);
    const flag = (property: string, on = "true") => {
      const now = (property === "dark mode" ? String(appearance.dark) : dock.get(property)) === on;
      return hidden(property) ? !now : now;
    };
    if (key === "read -g AppleInterfaceStyle") return flag("dark mode") ? ok("Dark\n") : missing;
    if (key === "read com.apple.dock autohide") return ok(flag("autohide") ? "1\n" : "0\n");
    if (key === "read com.apple.dock magnification") return ok(flag("magnification") ? "1\n" : "0\n");
    if (key === "read com.apple.dock show-recents") return ok(flag("show recents") ? "1\n" : "0\n");
    if (key === "read -g _HIHideMenuBar") return ok(flag("autohide menu bar") ? "1\n" : "0\n");
    if (key === "read com.apple.dock show-process-indicators") return ok(flag("show indicators") ? "1\n" : "0\n");
    if (key === "read com.apple.dock minimize-to-application") {
      return ok(flag("minimize into application") ? "1\n" : "0\n");
    }
    if (key === "read com.apple.dock launchanim") return ok(flag("animate") ? "1\n" : "0\n");
    if (key === "read com.apple.dock orientation")
      return ok(`${hidden("screen edge") ? "top" : dock.get("screen edge")}\n`);
    if (key === "read com.apple.dock mineffect")
      return ok(`${hidden("minimize effect") ? "suck" : dock.get("minimize effect")}\n`);
    if (key === "read com.apple.dock tilesize") {
      return ok(`${hidden("dock size") ? 16 : 16 + Number(dock.get("dock size")) * 112}\n`);
    }
    if (key === "read -g AppleLanguages") return ok('(\n    "en-US"\n)\n');
    return missing;
  };

  const open = (target: string): HxRunResult => {
    if (target.startsWith("x-apple.systempreferences:")) {
      settings.running = true;
      if (!dead.has(target)) settings.title = titles.get(target) ?? "General";
      else if (!settings.title) settings.title = "General";
      return ok();
    }
    if (target.endsWith(".app")) {
      running.start(basename(target, ".app"));
      return ok();
    }
    if (/^https?:/u.test(target)) {
      running.start("Safari");
      return ok();
    }
    if (target.endsWith(".txt")) {
      running.start("TextEdit");
      return ok();
    }
    if (target.endsWith("hxbot-folder")) {
      finder.windows += 1;
      return ok();
    }
    return bad(`The file ${target} does not exist.`);
  };

  const run: HxRunner = async (command, args) => {
    time.state.time += 3;
    commands.push([command, ...args].join(" "));
    const last = args[args.length - 1] ?? "";
    if (command === "/usr/bin/osascript" && args[3] === "set hxBefore to result as text") {
      return combined(
        () => osascript(args[1] ?? ""),
        () => osascript(args[5] ?? ""),
      );
    }
    if (command === "/usr/bin/osascript") return osascript(last);
    if (command === "/usr/bin/defaults") return defaults(args);
    if (command === "/usr/bin/open") return open(last);
    if (command === "/usr/bin/pgrep") {
      const ids = last === "System Settings" ? (settings.running ? [3999] : []) : running.ids(last);
      return ids.length > 0 ? ok(`${ids.join("\n")}\n`) : bad("", 1);
    }
    if (command === "/bin/kill") {
      running.stop(args.map(Number));
      return ok();
    }
    if (command === "/usr/bin/pkill") {
      settings.running = false;
      settings.title = "";
      return ok();
    }
    if (command === "/usr/sbin/screencapture") {
      await writeFile(last, "picture");
      return ok();
    }
    if (command === "/usr/bin/sw_vers") return ok("15.1\n");
    if (command === "/bin/launchctl") return ok(faults.noDesktop ? "Background\n" : "Aqua\n");
    if (command === "/usr/sbin/networksetup") return ok("Hardware Port: Ethernet\nDevice: en0\n");
    if (command === "/usr/bin/pmset") return ok("System-wide power settings:\n sleep 0\n");
    return bad(`the Mac of the tests does not know ${command}`);
  };

  return {
    run,
    home,
    extensions,
    now: time.now,
    wait: time.wait,
    commands,
    values: () => ({
      "dark-mode": String(appearance.dark),
      ...Object.fromEntries([...volume].map(([property, value]) => [keys[property] ?? property, value])),
      ...Object.fromEntries([...dock].map(([property, value]) => [keys[property] ?? property, value])),
    }),
  };
}

const WIN_APPS: ReadonlyArray<readonly [name: string, id: string, process: string]> = [
  ["Notepad", "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App", "Notepad"],
  ["Paint", "Microsoft.Paint_8wekyb3d8bbwe!App", "mspaint"],
  ["Calculator", "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", "CalculatorApp"],
  ["Command Prompt", "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\cmd.exe", "cmd"],
  ["Settings", "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel", "SystemSettings"],
  ["File Explorer", "Microsoft.Windows.Explorer", "explorer"],
  ["Task Manager", "Microsoft.AutoGenerated.{923DD477-5846-686B-A659-0FCCD73851A8}", "Taskmgr"],
  ["Microsoft Edge", "MSEdge", "msedge"],
  ["Google Chrome", "Chrome", "chrome"],
  ["Firefox", "308046B0AF4A39CB", "firefox"],
  [
    "Windows PowerShell",
    "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe",
    "powershell",
  ],
  ["Developer Command Prompt for VS 2022", "VisualStudio.devcmd", "cmd"],
  ["Visual Studio 2022", "VisualStudio.17", "devenv"],
  ["Git Bash", "git-bash", "bash"],
  ["Snipping Tool", "Microsoft.ScreenSketch_8wekyb3d8bbwe!App", "SnippingTool"],
  ["Control Panel", "Microsoft.Windows.ControlPanel", "control"],
  ["Character Map", "charmap", "charmap"],
  ["Remote Desktop Connection", "Microsoft.Windows.RemoteDesktop", "mstsc"],
  ["Windows Media Player Legacy", "Microsoft.Windows.MediaPlayer32", "wmplayer"],
  ["Docker Desktop", "Docker", "docker"],
  ["Node.js", "nodejs", "node"],
  ["Registry Editor", "regedit", "regedit"],
  ["Services", "services", "mmc"],
  ["Event Viewer", "eventvwr", "mmc"],
];

/** What the Settings app of the tests shows on every page: its navigation. */
const WIN_NAVIGATION = [
  "Window||Settings",
  "Text||Settings",
  "Edit|SearchBox|Find a setting",
  "ListItem||Home",
  "ListItem||System",
  "ListItem||Bluetooth & devices",
  "ListItem||Network & internet",
  "ListItem||Personalization",
  "ListItem||Apps",
  "ListItem||Accounts",
  "ListItem||Time & language",
  "ListItem||Gaming",
  "ListItem||Accessibility",
  "ListItem||Privacy & security",
  "ListItem||Windows Update",
];

/** A Windows computer. */
export async function hxWindowsWorld(home: string, faults: HxWorldFaults = {}): Promise<HxWorld> {
  const time = clock();
  const running = processes(faults);
  const commands: string[] = [];
  // The registry, by the last folder of the key and the name of the value: two settings keep a value
  // called ColorPrevalence, one in DWM and one in Personalize. The power plan keeps seconds.
  const registry = new Map<string, string>([
    ["Personalize\\AppsUseLightTheme", "1"],
    ["Personalize\\SystemUsesLightTheme", "1"],
    ["Personalize\\EnableTransparency", "1"],
    ["Advanced\\TaskbarAl", "1"],
    ["DWM\\ColorPrevalence", "0"],
    ["power\\VIDEOIDLE", "600"],
    ["power\\STANDBYIDLE", "1800"],
  ]);
  const keys: Readonly<Record<string, readonly string[]>> = {
    "Personalize\\AppsUseLightTheme": ["app-dark-mode", "dark-mode"],
    "Personalize\\SystemUsesLightTheme": ["system-dark-mode", "dark-mode"],
    "Personalize\\EnableTransparency": ["transparency"],
    "Clipboard\\EnableClipboardHistory": ["clipboard-history"],
    "Advanced\\TaskbarAl": ["taskbar-alignment"],
    "Advanced\\ShowTaskViewButton": ["task-view-button"],
    "Advanced\\ShowSecondsInSystemClock": ["clock-seconds"],
    "DWM\\ColorPrevalence": ["accent-title-bars"],
    "Personalize\\ColorPrevalence": ["accent-start-taskbar"],
    "PushNotifications\\ToastEnabled": ["notifications"],
    "GameBar\\AllowAutoGameMode": ["game-mode"],
    "StoragePolicy\\01": ["storage-sense"],
    "power\\VIDEOIDLE": ["screen-off-minutes"],
    "power\\STANDBYIDLE": ["sleep-minutes"],
  };
  /** The key of a value in this registry: the last folder of its path, and its name. */
  const at = (path: string, name: string) => `${path.split("\\").at(-1) ?? path}\\${name}`;
  const changed = new Set<string>();
  const takes = (name: string, next: string) => {
    const owners = keys[name] ?? [];
    if (registry.get(name) === next) return true;
    if (owners.some((key) => faults.deaf?.includes(key))) return false;
    const sticky = owners.find((key) => faults.sticky?.includes(key));
    if (sticky) {
      if (changed.has(`${sticky}:${name}`)) return false;
      changed.add(`${sticky}:${name}`);
    }
    return true;
  };
  const hidden = (name: string) => (keys[name] ?? []).some((key) => faults.hiddenEffect?.includes(key));
  const settings = { running: false, heading: "", number: 0 };
  const folders = { windows: 0 };
  const pages = new Map(HX_WIN_PAGES.map((page) => [page.address, page] as const));
  const apps = WIN_APPS.filter(([name]) => !faults.withoutApps?.includes(name));

  const start = (target: string): HxRunResult => {
    if (target.startsWith("ms-settings:")) {
      const page = pages.get(target);
      settings.running = true;
      if (page && !faults.deadPages?.includes(page.key)) {
        settings.heading = faults.renamedPages?.[page.key] ?? page.en;
        settings.number = HX_WIN_PAGES.indexOf(page) + 1;
      } else if (!settings.heading) {
        settings.heading = "Home";
        settings.number = 0;
      }
      return ok();
    }
    if (target.startsWith("shell:AppsFolder\\")) {
      const app = apps.find(([, id]) => target === `shell:AppsFolder\\${id}`);
      if (!app)
        return bad(
          "Start-Process : This command cannot be run due to the error: The system cannot find the file specified.",
        );
      running.start(app[2]);
      return ok();
    }
    if (/^https?:/u.test(target)) {
      running.start("msedge", 3);
      return ok();
    }
    if (target.endsWith(".txt")) {
      running.start("Notepad");
      return ok();
    }
    if (target.endsWith("hxbot-folder")) {
      folders.windows += 1;
      return ok();
    }
    return bad(`Start-Process : cannot find ${target}`);
  };

  const powershell = async (script: string, env: Readonly<Record<string, string>>): Promise<HxRunResult> => {
    const parts = combinedParts(script);
    if (parts) {
      return combined(
        () => powershell(parts.read, env),
        () => powershell(parts.write, env),
      );
    }
    const step = /\$hxStep = '([\w-]+)'/u.exec(script)?.[1] ?? "";
    if (step === "pids") return ok(`${running.idsAnyCase(env.HX_NAME ?? "").join(",")}\r\n`);
    if (step === "stop") {
      running.stop((env.HX_IDS ?? "").split(",").map(Number));
      return ok();
    }
    if (step === "settings-window") {
      const names = settings.running
        ? [
            ...WIN_NAVIGATION,
            `Text|PageHeader|${settings.heading}`,
            `Button||A switch that only screen ${settings.number} has`,
          ]
        : [];
      return ok(`${JSON.stringify({ open: settings.running, names })}\r\n`);
    }
    if (step === "close-settings") {
      settings.running = false;
      settings.heading = "";
      settings.number = 0;
      return ok();
    }
    if (step === "folder-windows") return ok(`${folders.windows}\r\n`);
    if (step === "close-folders") {
      folders.windows = 0;
      return ok();
    }
    if (step === "screenshot") {
      await writeFile(env.HX_SHOT ?? join(home, "shot.jpg"), "picture");
      return ok("saved\r\n");
    }
    if (step === "describe") {
      return ok(
        `Microsoft Windows Server 2025 Datacenter 10.0.26100 | interactive=${faults.noDesktop ? "False" : "True"} | session=1 | culture=en-US | ui=en-US\r\n`,
      );
    }
    if (step === "probe") return ok("an answer\r\n");
    if (script.includes("Get-StartApps")) {
      return ok(JSON.stringify(apps.map(([Name, AppID]) => ({ Name, AppID }))));
    }
    if (script.includes("OSVersion")) return ok("10.0.26100.0\r\n");
    if (script.includes("Start-Process -FilePath $env:HX_TARGET")) return start(env.HX_TARGET ?? "");
    if (script.includes("WmiMonitorBrightnessMethods")) return bad("Invoke-CimMethod : Not supported");
    if (script.includes("WmiMonitorBrightness")) {
      return script.includes("catch { 'none' }") ? ok("none\r\n") : bad("Get-CimInstance : Not supported");
    }
    if (script.includes("$a = $p.AppsUseLightTheme")) {
      const own = registry.get("Personalize\\AppsUseLightTheme");
      const system = registry.get("Personalize\\SystemUsesLightTheme");
      return ok(own === undefined || system === undefined ? "missing\r\n" : `${own},${system}\r\n`);
    }
    // The script reads the value on power out of what powercfg prints, and prints it in minutes.
    const power = /powercfg \/query SCHEME_CURRENT \w+ (\w+)/u.exec(script);
    if (power?.[1]) return ok(`${Math.round(Number(registry.get(`power\\${power[1]}`) ?? "0") / 60)}\r\n`);
    const change = /powercfg \/change (monitor|standby)-timeout-ac (\d+)/u.exec(script);
    if (change?.[1] && change[2] !== undefined) {
      const name = `power\\${change[1] === "monitor" ? "VIDEOIDLE" : "STANDBYIDLE"}`;
      const seconds = String(Number(change[2]) * 60);
      if (takes(name, seconds)) registry.set(name, seconds);
      return ok();
    }
    const read = /-Path '([^']+)' -Name '(\w+)' -ErrorAction SilentlyContinue/u.exec(script);
    if (read?.[1] && read[2]) return ok(`${registry.get(at(read[1], read[2])) ?? "missing"}\r\n`);
    const written = [...script.matchAll(/-Path '([^']+)' -Name '(\w+)' -Value (\d+)/gu)];
    if (written.length > 0) {
      for (const [, path, name, value] of written) {
        if (path === undefined || name === undefined || value === undefined) continue;
        if (takes(at(path, name), value)) registry.set(at(path, name), value);
      }
      return ok();
    }
    return bad(`the Windows of the tests does not know this script: ${script}`);
  };

  const reg = (args: readonly string[]): HxRunResult => {
    const [, key = "", flag, name] = args;
    const line = (value: string, shown: string) => `    ${value}    REG_DWORD    0x${Number(shown).toString(16)}`;
    const shown = (stored: string | undefined, where: string) => {
      if (stored === undefined) return undefined;
      return hidden(where) ? String(1 - Number(stored)) : stored;
    };
    if (flag === "/v" && name) {
      const value = shown(registry.get(at(key, name)), at(key, name));
      return value === undefined
        ? bad("ERROR: The system was unable to find the specified registry key or value.")
        : ok(`\r\n${key}\r\n${line(name, value)}\r\n\r\n`);
    }
    const folder = key.split("\\").at(-1) ?? key;
    const lines = [...registry.keys()].flatMap((where) => {
      const [own, value] = where.split("\\");
      if (own !== folder || value === undefined) return [];
      const now = shown(registry.get(where), where);
      return now === undefined ? [] : [line(value, now)];
    });
    return ok(`\r\n${key}\r\n${lines.join("\r\n")}\r\n\r\n`);
  };

  const run: HxRunner = async (command, args, options) => {
    time.state.time += 3;
    commands.push([command, ...args].join(" "));
    const program = command.toLowerCase();
    if (program.endsWith("powershell.exe")) return powershell(args[args.length - 1] ?? "", options?.env ?? {});
    if (program.endsWith("reg.exe")) return reg(args);
    if (program.endsWith("explorer.exe")) {
      // The shell hands the target on and ends with 1, having had nothing of its own to do.
      const answer = start(args[0] ?? "");
      return answer.code === 0 ? { ...answer, code: 1 } : answer;
    }
    return bad(`the Windows of the tests does not know ${command}`);
  };

  return {
    run,
    home,
    extensions: "",
    now: time.now,
    wait: time.wait,
    commands,
    values: () => Object.fromEntries(registry),
  };
}
