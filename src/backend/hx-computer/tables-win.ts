// HXBot 电脑操控：Windows 10、11 的系统设置页面和可以直接读写的设置。
// 页面地址是系统自己的 ms-settings 地址；直接读写用系统自带的 Windows PowerShell（5.1），不装任何东西。
// 传给 PowerShell 的值只有两种来源：这张表里写死的文字，和核对过的整数。
import { HX_COMBINED_SEPARATOR, type HxCommand, type HxPageSeed, type HxSettingSeed, hxParseNumber } from "./tables";

function page(
  key: string,
  uri: string,
  zh: string,
  en: string,
  pinyin: string,
  more: readonly string[] = [],
  security = false,
): HxPageSeed {
  return { key, address: `ms-settings:${uri}`, zh, en, pinyin, more, security };
}

export const HX_WIN_PAGES: readonly HxPageSeed[] = [
  page("display", "display", "屏幕", "Display", "ping mu", ["显示", "分辨率", "缩放", "显示器"]),
  page("night-light", "nightlight", "夜间模式", "Night light", "ye jian mo shi", ["护眼"]),
  page("sound", "sound", "声音", "Sound", "sheng yin", ["音量", "扬声器", "麦克风", "输出设备"]),
  page("notifications", "notifications", "通知", "Notifications", "tong zhi", ["勿扰", "免打扰"]),
  page("focus", "quiethours", "专注", "Focus", "zhuan zhu", ["专注助手", "Focus assist"]),
  page("power", "powersleep", "电源", "Power & sleep", "dian yuan", ["睡眠", "电池", "休眠"]),
  // 存储感知 is the name of the setting of this page (storage-sense), which HXBot changes directly.
  page("storage", "storagesense", "存储", "Storage", "cun chu", ["磁盘空间"]),
  page("multitasking", "multitasking", "多任务处理", "Multitasking", "duo ren wu chu li", ["贴靠窗口", "虚拟桌面"]),
  page("clipboard", "clipboard", "剪贴板", "Clipboard", "jian tie ban"),
  page("about", "about", "系统信息", "About", "xi tong xin xi", ["关于", "电脑名称", "系统版本"]),
  page("bluetooth", "bluetooth", "蓝牙和其他设备", "Bluetooth & devices", "lan ya", ["蓝牙"]),
  page("printers", "printers", "打印机和扫描仪", "Printers & scanners", "da yin ji", ["打印机"]),
  page("mouse", "mousetouchpad", "鼠标", "Mouse", "shu biao", ["指针速度", "滚轮"]),
  page("touchpad", "devices-touchpad", "触摸板", "Touchpad", "chu mo ban"),
  page("typing", "typing", "输入", "Typing", "shu ru", ["键盘", "输入法"]),
  page("network", "network-status", "网络和 Internet", "Network & internet", "wang luo", ["网络"]),
  page("wifi", "network-wifi", "WLAN", "Wi-Fi", "", ["WiFi", "无线网络", "无线局域网"]),
  page("ethernet", "network-ethernet", "以太网", "Ethernet", "yi tai wang"),
  page("vpn", "network-vpn", "VPN", "VPN", ""),
  page("proxy", "network-proxy", "代理", "Proxy", "dai li", [], true),
  page("airplane", "network-airplanemode", "飞行模式", "Airplane mode", "fei xing mo shi"),
  page("hotspot", "network-mobilehotspot", "移动热点", "Mobile hotspot", "yi dong re dian"),
  page("personalization", "personalization", "个性化", "Personalization", "ge xing hua"),
  page("background", "personalization-background", "背景", "Background", "bei jing", ["壁纸", "桌面背景", "墙纸"]),
  page("colors", "colors", "颜色", "Colors", "yan se", ["浅色模式", "主题色", "强调色"]),
  page("lock-screen", "lockscreen", "锁屏界面", "Lock screen", "suo ping jie mian", ["锁屏"]),
  page("themes", "themes", "主题", "Themes", "zhu ti"),
  page("fonts", "fonts", "字体", "Fonts", "zi ti"),
  page("taskbar", "taskbar", "任务栏", "Taskbar", "ren wu lan"),
  page("start", "personalization-start", "开始菜单", "Start", "kai shi cai dan", ["开始"]),
  page("apps", "appsfeatures", "安装的应用", "Installed apps", "an zhuang de ying yong", ["应用和功能", "卸载程序"]),
  page("default-apps", "defaultapps", "默认应用", "Default apps", "mo ren ying yong", ["默认浏览器"]),
  page("startup-apps", "startupapps", "启动应用", "Startup apps", "qi dong ying yong", ["开机启动", "启动项"], true),
  page("your-info", "yourinfo", "账户信息", "Your info", "zhang hu xin xi"),
  page("email-accounts", "emailandaccounts", "电子邮件和账户", "Email & accounts", "dian zi you jian he zhang hu"),
  page(
    "sign-in",
    "signinoptions",
    "登录选项",
    "Sign-in options",
    "deng lu xuan xiang",
    ["密码", "PIN", "指纹", "人脸"],
    true,
  ),
  page("other-users", "otherusers", "其他用户", "Other users", "qi ta yong hu", ["家庭和其他用户"], true),
  page("date-time", "dateandtime", "日期和时间", "Date & time", "ri qi he shi jian", ["时区"]),
  page("language", "regionlanguage", "语言和区域", "Language & region", "yu yan he qu yu", ["系统语言"]),
  page("speech", "speech", "语音", "Speech", "yu yin"),
  page("game-bar", "gaming-gamebar", "游戏栏", "Game Bar", "you xi lan"),
  page("accessibility", "easeofaccess", "辅助功能", "Accessibility", "fu zhu gong neng", ["轻松使用"]),
  page("text-size", "easeofaccess-display", "文本大小", "Text size", "wen ben da xiao", ["字体大小"]),
  page("mouse-pointer", "easeofaccess-mousepointer", "鼠标指针和触控", "Mouse pointer and touch", "shu biao zhi zhen"),
  page("narrator", "easeofaccess-narrator", "讲述人", "Narrator", "jiang shu ren"),
  page("magnifier", "easeofaccess-magnifier", "放大镜", "Magnifier", "fang da jing"),
  page("privacy", "privacy", "隐私和安全性", "Privacy & security", "yin si he an quan xing", ["隐私"], true),
  page("location", "privacy-location", "定位", "Location", "ding wei", [], true),
  page("camera", "privacy-webcam", "摄像头", "Camera", "she xiang tou", ["相机权限"], true),
  page("microphone", "privacy-microphone", "麦克风权限", "Microphone access", "mai ke feng quan xian", [], true),
  page(
    "windows-security",
    "windowsdefender",
    "Windows 安全中心",
    "Windows Security",
    "an quan zhong xin",
    ["杀毒", "防火墙", "Defender"],
    true,
  ),
  page("windows-update", "windowsupdate", "Windows 更新", "Windows Update", "geng xin", ["系统更新"]),
  page("backup", "backup", "Windows 备份", "Windows Backup", "bei fen"),
  page("troubleshoot", "troubleshoot", "疑难解答", "Troubleshoot", "yi nan jie da"),
  page("recovery", "recovery", "恢复", "Recovery", "hui fu", ["重置此电脑"], true),
  page("activation", "activation", "激活", "Activation", "ji huo"),
  page("developers", "developers", "开发者选项", "For developers", "kai fa zhe xuan xiang", [], true),
];

/**
 * Windows PowerShell 5.1, which every Windows 10 and 11 has, by its full path: a file of the same
 * name in the working folder or earlier on the search path is never run in its place.
 */
export function hxPowerShellPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const root = env.SystemRoot || env.windir || "C:\\Windows";
  return `${root.replace(/[\\/]+$/u, "")}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

export const HX_POWERSHELL = hxPowerShellPath();

/**
 * Before every script: no progress records (they would arrive as XML on the error stream), and
 * UTF-8 for what the script prints, so that names and error texts in Chinese arrive as they are.
 */
const PREAMBLE =
  "$ProgressPreference = 'SilentlyContinue'; try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }; ";

/**
 * One script for Windows PowerShell. The script is one argument of the program, so it must hold no
 * double quote: how a quote inside an argument reaches a Windows program depends on who parses it.
 * A value that the script must not parse goes into `env` and is read as `$env:NAME`.
 */
export function hxPowerShell(scriptText: string, env?: Readonly<Record<string, string>>): HxCommand {
  return {
    command: HX_POWERSHELL,
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `${PREAMBLE}${scriptText}`,
    ],
    ...(env ? { env } : {}),
  };
}

const PERSONALIZE = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
const CLIPBOARD = "HKCU:\\Software\\Microsoft\\Clipboard";
/** Seconds a WMI query of the screen may take. One that does not answer is a screen with no such value. */
const WMI_LIMIT_SECONDS = 10;

/**
 * Tells running programs that a setting changed, as the Settings app does after it writes one.
 * It is best effort: when it cannot run, the value is written all the same and programs read it later.
 */
const BROADCAST = [
  "try {",
  "$hxQuote = [string][char]34;",
  "$hxMember = '[DllImport(' + $hxQuote + 'user32.dll' + $hxQuote + ', CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);';",
  "Add-Type -Namespace Hx -Name Native -MemberDefinition $hxMember -ErrorAction Stop;",
  "$hxDone = [UIntPtr]::Zero;",
  "[void][Hx.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'ImmersiveColorSet', 2, 2000, [ref]$hxDone)",
  "} catch { }",
].join(" ");

/** One number in the registry of this user. `missing` is the answer when the value was never written. */
function registryRead(path: string, name: string, missing: string): HxCommand {
  return hxPowerShell(
    `$v = (Get-ItemProperty -Path '${path}' -Name '${name}' -ErrorAction SilentlyContinue).'${name}'; if ($null -eq $v) { '${missing}' } else { [string]$v }`,
  );
}

function registryWrite(path: string, name: string, value: number, broadcast: boolean): HxCommand {
  return hxPowerShell(
    `if (-not (Test-Path '${path}')) { New-Item -Path '${path}' -Force | Out-Null }; Set-ItemProperty -Path '${path}' -Name '${name}' -Value ${value} -Type DWord -ErrorAction Stop${broadcast ? `; ${BROADCAST}` : ""}`,
  );
}

/** A switch kept as 0 or 1. `onIs` is the number that means on. */
function registrySwitch(input: {
  key: string;
  page: string;
  zh: string;
  en: string;
  pinyin: string;
  more?: readonly string[];
  path: string;
  name: string;
  onIs: number;
  /** The number that means off, when it is not the other one of 0 and 1 (Hidden is 1 or 2). */
  offIs?: number;
  /** What the system does when the value was never written, or null when that cannot be known. */
  missing: "on" | "off" | null;
  broadcast: boolean;
}): HxSettingSeed {
  const offIs = input.offIs ?? (input.onIs === 1 ? 0 : 1);
  return {
    key: input.key,
    page: input.page,
    zh: input.zh,
    en: input.en,
    pinyin: input.pinyin,
    more: input.more ?? [],
    values: { type: "switch" },
    read: registryRead(input.path, input.name, "missing"),
    parse: (stdout) => {
      const text = stdout.trim();
      if (text === String(input.onIs)) return "on";
      if (text === String(offIs)) return "off";
      return text === "missing" ? input.missing : null;
    },
    write: (value) => registryWrite(input.path, input.name, value === "on" ? input.onIs : offIs, input.broadcast),
  };
}

/** Dark mode as two numbers, `apps,system`; 0 is dark. The four readings, and what each one writes. */
const THEME_READINGS: Readonly<Record<string, string>> = {
  "0,0": "on",
  "1,1": "off",
  "0,1": "apps only",
  "1,0": "system only",
};
const THEME_WRITES: Readonly<Record<string, readonly [0 | 1, 0 | 1]>> = {
  on: [0, 0],
  off: [1, 1],
  "apps only": [0, 1],
  "system only": [1, 0],
};

/**
 * Dark mode as the Settings app sets it with "Dark" and "Light": apps, and the taskbar and Start,
 * together. Windows 10 starts with a dark taskbar and light apps, which reads as `system only`;
 * writing on or off from there changes both, and a failed change puts exactly that mix back.
 */
const DARK_MODE: HxSettingSeed = {
  key: "dark-mode",
  page: "colors",
  zh: "深色模式",
  en: "Dark mode",
  pinyin: "shen se mo shi",
  more: ["暗色模式", "黑暗模式", "深色主题", "dark theme"],
  values: { type: "switch" },
  read: hxPowerShell(
    `$p = Get-ItemProperty -Path '${PERSONALIZE}' -ErrorAction SilentlyContinue; $a = $p.AppsUseLightTheme; $s = $p.SystemUsesLightTheme; if ($null -eq $a -or $null -eq $s) { 'missing' } else { [string]$a + ',' + [string]$s }`,
  ),
  parse: (stdout) => THEME_READINGS[stdout.trim()] ?? null,
  write: (value) => {
    const [apps, system] = THEME_WRITES[value] ?? [1, 1];
    return hxPowerShell(
      `if (-not (Test-Path '${PERSONALIZE}')) { New-Item -Path '${PERSONALIZE}' -Force | Out-Null }; Set-ItemProperty -Path '${PERSONALIZE}' -Name 'AppsUseLightTheme' -Value ${apps} -Type DWord -ErrorAction Stop; Set-ItemProperty -Path '${PERSONALIZE}' -Name 'SystemUsesLightTheme' -Value ${system} -Type DWord -ErrorAction Stop; ${BROADCAST}`,
    );
  },
};

/** The settings of the first version of v1.6.4. */
const FIRST_SETTINGS: readonly HxSettingSeed[] = [
  DARK_MODE,
  registrySwitch({
    key: "app-dark-mode",
    page: "colors",
    zh: "应用深色模式",
    en: "Dark mode for apps",
    pinyin: "",
    more: ["应用模式", "app mode"],
    path: PERSONALIZE,
    name: "AppsUseLightTheme",
    onIs: 0,
    missing: null,
    broadcast: true,
  }),
  registrySwitch({
    key: "system-dark-mode",
    page: "colors",
    zh: "任务栏和开始菜单深色模式",
    en: "Dark mode for the taskbar and Start",
    pinyin: "",
    more: ["任务栏深色", "Windows 模式", "Windows mode"],
    path: PERSONALIZE,
    name: "SystemUsesLightTheme",
    onIs: 0,
    missing: null,
    broadcast: true,
  }),
  registrySwitch({
    key: "transparency",
    page: "colors",
    zh: "透明效果",
    en: "Transparency effects",
    pinyin: "tou ming xiao guo",
    path: PERSONALIZE,
    name: "EnableTransparency",
    onIs: 1,
    missing: null,
    broadcast: true,
  }),
  registrySwitch({
    key: "clipboard-history",
    page: "clipboard",
    zh: "剪贴板历史记录",
    en: "Clipboard history",
    pinyin: "jian tie ban li shi ji lu",
    path: CLIPBOARD,
    name: "EnableClipboardHistory",
    onIs: 1,
    // Windows keeps the history off until the user turns it on, and writes the value only then.
    missing: "off",
    broadcast: false,
  }),
  {
    key: "brightness",
    page: "display",
    zh: "屏幕亮度",
    en: "Screen brightness",
    pinyin: "ping mu liang du",
    more: ["亮度"],
    values: { type: "number", min: 0, max: 100 },
    // Only a built-in screen answers. A desktop monitor, or a virtual machine, has no such value: the
    // answer is then `none`, which is no number, and HXBot opens the Display page instead. On a
    // Windows 11 ARM machine of GitHub the query never answered, so it has a limit of its own: after
    // 10 seconds it fails, and the answer is `none` again rather than a command that timed out.
    read: hxPowerShell(
      `try { [string](Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -OperationTimeoutSec ${WMI_LIMIT_SECONDS} -ErrorAction Stop | Select-Object -First 1).CurrentBrightness } catch { 'none' }`,
    ),
    parse: (stdout) => hxParseNumber(stdout, 0, 100),
    write: (value) =>
      hxPowerShell(
        `$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -OperationTimeoutSec ${WMI_LIMIT_SECONDS} -ErrorAction Stop | Select-Object -First 1; Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]${Number(value)} } -OperationTimeoutSec ${WMI_LIMIT_SECONDS} -ErrorAction Stop | Out-Null`,
      ),
  },
];

/**
 * One run of PowerShell that does what the read command does, then the write command, then the read
 * command again, and prints the two readings with a line of `@@` between them. One start of
 * PowerShell took 22 seconds on an ARM computer we measured, so three of them are three times that.
 * The two scripts are run as they are, each in a block of its own; null when either is not ours.
 */
export function hxWinCombined(read: HxCommand, write: HxCommand): HxCommand | null {
  const readScript = hxPowerShellScript(read);
  const writeScript = hxPowerShellScript(write);
  if (readScript === null || writeScript === null) return null;
  return hxPowerShell(
    [
      `$hxBefore = & { ${readScript} };`,
      `& { ${writeScript} } | Out-Null;`,
      `$hxAfter = & { ${readScript} };`,
      `[string]$hxBefore + [char]10 + '${HX_COMBINED_SEPARATOR}' + [char]10 + [string]$hxAfter`,
    ].join(" "),
    write.env,
  );
}

/** The script of one of our PowerShell commands, without what goes before every script, or null. */
export function hxPowerShellScript(command: HxCommand): string | null {
  if (command.command !== HX_POWERSHELL) return null;
  const script = command.args[command.args.length - 1];
  return script?.startsWith(PREAMBLE) ? script.slice(PREAMBLE.length) : null;
}

/** One of several numbers in the registry of this user, as an option of its own name. */
function registryChoice(input: {
  key: string;
  page: string;
  zh: string;
  en: string;
  pinyin: string;
  more?: readonly string[];
  path: string;
  name: string;
  /** Each option with the number the system keeps for it. */
  options: ReadonlyArray<readonly [option: string, number: number]>;
  /** The option the system uses when the value was never written. */
  missing: string;
  broadcast: boolean;
}): HxSettingSeed {
  const options = input.options.map(([option]) => option);
  return {
    key: input.key,
    page: input.page,
    zh: input.zh,
    en: input.en,
    pinyin: input.pinyin,
    more: input.more ?? [],
    values: { type: "choice", options },
    read: registryRead(input.path, input.name, "missing"),
    parse: (stdout) => {
      const text = stdout.trim();
      if (text === "missing") return input.missing;
      return input.options.find(([, number]) => String(number) === text)?.[0] ?? null;
    },
    write: (value) => {
      const number = input.options.find(([option]) => option === value)?.[1] ?? input.options[0]?.[1] ?? 0;
      return registryWrite(input.path, input.name, number, input.broadcast);
    },
  };
}

/**
 * A timeout of the power plan in use, in minutes, while on power (0 is never). powercfg prints
 * words in the language of Windows, so the number is taken by its place: of the numbers in 0x form,
 * the one before the last is for power, the last for the battery.
 */
function powerMinutes(input: {
  key: string;
  zh: string;
  en: string;
  pinyin: string;
  more?: readonly string[];
  group: string;
  setting: string;
  /** What `powercfg /change` calls it. */
  change: string;
}): HxSettingSeed {
  return {
    key: input.key,
    page: "power",
    zh: input.zh,
    en: input.en,
    pinyin: input.pinyin,
    more: input.more ?? [],
    values: { type: "number", min: 0, max: 600 },
    read: hxPowerShell(
      `$q = (powercfg /query SCHEME_CURRENT ${input.group} ${input.setting}) -join ' '; $n = [regex]::Matches($q, '0x[0-9a-fA-F]{8}'); if ($n.Count -lt 2) { 'none' } else { [string][math]::Round([Convert]::ToInt32($n[$n.Count - 2].Value, 16) / 60) }`,
    ),
    parse: (stdout) => hxParseNumber(stdout, 0, 600),
    write: (value) => hxPowerShell(`powercfg /change ${input.change} ${Number(value)}`),
  };
}

const ADVANCED = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";

/**
 * Settings added in v1.6.4 after the probes on GitHub's Windows machines read where each is kept.
 * Not among them: the options of File Explorer (file extensions, hidden files). Windows 11 has them
 * on the page For developers, a security page, and HXBot changes nothing directly on such a page.
 */
const MORE_SETTINGS: readonly HxSettingSeed[] = [
  registryChoice({
    key: "taskbar-alignment",
    page: "taskbar",
    zh: "任务栏对齐方式",
    en: "Taskbar alignment",
    pinyin: "ren wu lan dui qi",
    more: ["任务栏居中", "任务栏靠左", "开始按钮靠左"],
    path: ADVANCED,
    name: "TaskbarAl",
    options: [
      ["left", 0],
      ["center", 1],
    ],
    missing: "center",
    broadcast: true,
  }),
  registrySwitch({
    key: "task-view-button",
    page: "taskbar",
    zh: "任务栏上的任务视图按钮",
    en: "Task view button on the taskbar",
    pinyin: "ren wu shi tu",
    more: ["任务视图", "task view"],
    path: ADVANCED,
    name: "ShowTaskViewButton",
    onIs: 1,
    missing: "on",
    broadcast: true,
  }),
  registrySwitch({
    key: "clock-seconds",
    page: "taskbar",
    zh: "时钟显示秒",
    en: "Show seconds in the clock",
    pinyin: "shi zhong xian shi miao",
    more: ["显示秒", "seconds"],
    path: ADVANCED,
    name: "ShowSecondsInSystemClock",
    onIs: 1,
    missing: "off",
    broadcast: true,
  }),
  registrySwitch({
    key: "accent-title-bars",
    page: "colors",
    zh: "标题栏和窗口边框显示主题色",
    en: "Accent color on title bars and window borders",
    pinyin: "",
    more: ["标题栏颜色", "窗口边框颜色"],
    path: "HKCU:\\Software\\Microsoft\\Windows\\DWM",
    name: "ColorPrevalence",
    onIs: 1,
    missing: "off",
    broadcast: true,
  }),
  registrySwitch({
    key: "accent-start-taskbar",
    page: "colors",
    zh: "开始菜单和任务栏显示主题色",
    en: "Accent color on Start and the taskbar",
    pinyin: "",
    more: ["任务栏颜色"],
    path: PERSONALIZE,
    name: "ColorPrevalence",
    onIs: 1,
    missing: "off",
    broadcast: true,
  }),
  registrySwitch({
    key: "notifications",
    page: "notifications",
    zh: "接收通知",
    en: "Get notifications",
    pinyin: "jie shou tong zhi",
    more: ["通知开关", "notifications on or off"],
    path: "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications",
    name: "ToastEnabled",
    onIs: 1,
    missing: "on",
    broadcast: false,
  }),
  registrySwitch({
    key: "game-mode",
    page: "game-bar",
    zh: "游戏模式",
    en: "Game Mode",
    pinyin: "you xi mo shi",
    path: "HKCU:\\Software\\Microsoft\\GameBar",
    name: "AllowAutoGameMode",
    onIs: 1,
    missing: "on",
    broadcast: false,
  }),
  registrySwitch({
    key: "storage-sense",
    page: "storage",
    zh: "存储感知",
    en: "Storage Sense",
    pinyin: "cun chu gan zhi",
    more: ["自动清理"],
    path: "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\StorageSense\\Parameters\\StoragePolicy",
    name: "01",
    onIs: 1,
    missing: "off",
    broadcast: false,
  }),
  powerMinutes({
    key: "screen-off-minutes",
    zh: "多久后关闭屏幕（接通电源时，分钟）",
    en: "Turn off the screen after (on power, minutes)",
    pinyin: "",
    more: ["关闭屏幕", "屏幕关闭时间", "熄屏时间"],
    group: "SUB_VIDEO",
    setting: "VIDEOIDLE",
    change: "monitor-timeout-ac",
  }),
  powerMinutes({
    key: "sleep-minutes",
    zh: "多久后睡眠（接通电源时，分钟）",
    en: "Sleep after (on power, minutes)",
    pinyin: "",
    more: ["睡眠时间", "自动睡眠"],
    group: "SUB_SLEEP",
    setting: "STANDBYIDLE",
    change: "standby-timeout-ac",
  }),
];

export const HX_WIN_SETTINGS: readonly HxSettingSeed[] = [...FIRST_SETTINGS, ...MORE_SETTINGS];

/** Every app of the Start menu with its id, as one line of JSON in UTF-8. */
export const HX_WIN_LIST_APPS: HxCommand = hxPowerShell(
  "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress",
);

/** The program of the desktop shell, which hands a target to the program that owns it. */
function hxExplorerPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot || env.windir || "C:\\Windows";
  return `${root.replace(/[\\/]+$/u, "")}\\explorer.exe`;
}

/**
 * Opens an app of the Start menu, a settings address, a file or a folder, through the desktop shell.
 * The target is one argument of the program, not a piece of a script, so nothing in it is parsed.
 *
 * Not through PowerShell: one start of PowerShell costs 22 seconds on an ARM computer we measured
 * (GitHub's windows-11-arm), which is longer than opening anything may take. The shell answers at
 * once, so it says nothing about whether the program then started; `hxWinStartAgain` is the slower
 * way, which does, for when the shell is not there.
 */
export function hxWinOpen(target: string): HxCommand {
  return { command: hxExplorerPath(), args: [target] };
}

/**
 * The shell ends with 1 when it had nothing of its own to do, which is the usual answer after it
 * handed the target on. Only a start that did not run at all counts as a failure.
 */
export function hxWinOpened(result: { code: number | null; timedOut: boolean; missing: boolean }): boolean {
  return !result.missing && !result.timedOut && (result.code === 0 || result.code === 1);
}

/** Opens the same target through PowerShell, which says whether the program started. */
export function hxWinStart(target: string): HxCommand {
  return hxPowerShell("$hxStep = 'start'; Start-Process -FilePath $env:HX_TARGET -ErrorAction Stop", {
    HX_TARGET: target,
  });
}
