// HXBot 电脑操控：macOS（13 及以上）的系统设置页面和可以直接读写的设置。
// 页面地址是“系统设置”各面板的标识；直接读写用系统自带的 osascript，不装任何东西。
// 音量几项不向别的程序发指令；外观和程序坞几项通过“系统事件”，第一次用时 macOS 会问一次是否允许。
import {
  HX_COMBINED_SEPARATOR,
  type HxCommand,
  type HxPageSeed,
  type HxSettingSeed,
  hxParseChoice,
  hxParseNumber,
  hxParseSwitch,
} from "./tables";

function page(
  key: string,
  pane: string,
  zh: string,
  en: string,
  pinyin: string,
  more: readonly string[] = [],
  security = false,
): HxPageSeed {
  return { key, address: `x-apple.systempreferences:${pane}`, zh, en, pinyin, more, security };
}

export const HX_MAC_PAGES: readonly HxPageSeed[] = [
  page("wifi", "com.apple.wifi-settings-extension", "无线局域网", "Wi-Fi", "wu xian ju yu wang", [
    "WiFi",
    "WLAN",
    "无线网络",
  ]),
  page("bluetooth", "com.apple.BluetoothSettings", "蓝牙", "Bluetooth", "lan ya"),
  // VPN is on this page: its own address does nothing on macOS 15 and 26, the window stays where it was.
  page("network", "com.apple.Network-Settings.extension", "网络", "Network", "wang luo", [
    "以太网",
    "DNS",
    "代理",
    "VPN",
  ]),
  page("notifications", "com.apple.Notifications-Settings.extension", "通知", "Notifications", "tong zhi"),
  page("sound", "com.apple.Sound-Settings.extension", "声音", "Sound", "sheng yin", ["扬声器", "麦克风", "输出设备"]),
  page("focus", "com.apple.Focus-Settings.extension", "专注模式", "Focus", "zhuan zhu mo shi", [
    "勿扰模式",
    "Do Not Disturb",
  ]),
  page(
    "screen-time",
    "com.apple.Screen-Time-Settings.extension",
    "屏幕使用时间",
    "Screen Time",
    "ping mu shi yong shi jian",
  ),
  page("appearance", "com.apple.Appearance-Settings.extension", "外观", "Appearance", "wai guan", [
    "浅色模式",
    "强调色",
  ]),
  page("accessibility", "com.apple.Accessibility-Settings.extension", "辅助功能", "Accessibility", "fu zhu gong neng", [
    "旁白",
    "缩放",
  ]),
  page(
    "control-center",
    "com.apple.ControlCenter-Settings.extension",
    "控制中心",
    "Control Center",
    "kong zhi zhong xin",
    ["菜单栏"],
  ),
  page("siri", "com.apple.Siri-Settings.extension", "Siri 与聚焦", "Siri & Spotlight", "", [
    "Siri",
    "聚焦",
    "Spotlight",
  ]),
  page(
    "privacy",
    "com.apple.settings.PrivacySecurity.extension",
    "隐私与安全性",
    "Privacy & Security",
    "yin si yu an quan xing",
    ["防火墙", "文件保险箱", "定位服务", "屏幕录制", "自动化"],
    true,
  ),
  page(
    "desktop-dock",
    "com.apple.Desktop-Settings.extension",
    "桌面与程序坞",
    "Desktop & Dock",
    "zhuo mian yu cheng xu wu",
    ["Dock", "程序坞", "台前调度", "默认浏览器"],
  ),
  page("displays", "com.apple.Displays-Settings.extension", "显示器", "Displays", "xian shi qi", [
    "分辨率",
    "亮度",
    "夜览",
    "屏幕",
  ]),
  page("wallpaper", "com.apple.Wallpaper-Settings.extension", "墙纸", "Wallpaper", "qiang zhi", ["壁纸", "桌面背景"]),
  page(
    "screen-saver",
    "com.apple.ScreenSaver-Settings.extension",
    "屏幕保护程序",
    "Screen Saver",
    "ping mu bao hu cheng xu",
    ["屏保"],
  ),
  page("battery", "com.apple.Battery-Settings.extension", "电池", "Battery", "dian chi", [
    "节能",
    "低电量模式",
    "Energy Saver",
  ]),
  page("lock-screen", "com.apple.Lock-Screen-Settings.extension", "锁定屏幕", "Lock Screen", "suo ding ping mu", [
    "自动锁定",
    "锁屏",
  ]),
  page(
    "touch-id",
    "com.apple.Touch-ID-Settings.extension",
    "触控 ID 与密码",
    "Touch ID & Password",
    "chu kong id yu mi ma",
    ["登录密码", "指纹"],
    true,
  ),
  page(
    "users",
    "com.apple.Users-Groups-Settings.extension",
    "用户与群组",
    "Users & Groups",
    "yong hu yu qun zu",
    [],
    true,
  ),
  page("passwords", "com.apple.Passwords-Settings.extension", "密码", "Passwords", "mi ma", [], true),
  page(
    "internet-accounts",
    "com.apple.Internet-Accounts-Settings.extension",
    "互联网账户",
    "Internet Accounts",
    "hu lian wang zhang hu",
    ["邮件账户"],
  ),
  page("game-center", "com.apple.Game-Center-Settings.extension", "Game Center", "Game Center", ""),
  page("wallet", "com.apple.WalletSettingsExtension", "钱包与 Apple Pay", "Wallet & Apple Pay", "qian bao", [], true),
  page("keyboard", "com.apple.Keyboard-Settings.extension", "键盘", "Keyboard", "jian pan", [
    "输入法",
    "快捷键",
    "听写",
  ]),
  page("mouse", "com.apple.Mouse-Settings.extension", "鼠标", "Mouse", "shu biao", ["指针速度", "滚动方向"]),
  page("trackpad", "com.apple.Trackpad-Settings.extension", "触控板", "Trackpad", "chu kong ban", [
    "轻点来点按",
    "手势",
  ]),
  page(
    "printers",
    "com.apple.Print-Scan-Settings.extension",
    "打印机与扫描仪",
    "Printers & Scanners",
    "da yin ji yu sao miao yi",
    ["打印机"],
  ),
  // 通用 is the group this pane is the first of: the address of the group itself closes the window.
  page("about", "com.apple.SystemProfiler.AboutExtension", "关于本机", "About", "guan yu ben ji", [
    "电脑名称",
    "系统版本",
    "通用",
    "General",
  ]),
  page(
    "software-update",
    "com.apple.Software-Update-Settings.extension",
    "软件更新",
    "Software Update",
    "ruan jian geng xin",
    ["系统更新"],
  ),
  page("storage", "com.apple.settings.Storage", "储存空间", "Storage", "chu cun kong jian", ["磁盘空间", "存储"]),
  page(
    "airdrop",
    "com.apple.AirDrop-Handoff-Settings.extension",
    "隔空投送与接力",
    "AirDrop & Handoff",
    "ge kong tou song yu jie li",
    ["隔空投送", "AirDrop", "隔空播放"],
  ),
  page(
    "login-items",
    "com.apple.LoginItems-Settings.extension",
    "登录项",
    "Login Items",
    "deng lu xiang",
    ["开机启动", "启动项"],
    true,
  ),
  page("language", "com.apple.Localization-Settings.extension", "语言与地区", "Language & Region", "yu yan yu di qu", [
    "系统语言",
  ]),
  page("date-time", "com.apple.Date-Time-Settings.extension", "日期与时间", "Date & Time", "ri qi yu shi jian", [
    "时区",
  ]),
  page(
    "sharing",
    "com.apple.Sharing-Settings.extension",
    "共享",
    "Sharing",
    "gong xiang",
    ["屏幕共享", "文件共享", "远程登录"],
    true,
  ),
  page("time-machine", "com.apple.Time-Machine-Settings.extension", "时间机器", "Time Machine", "shi jian ji qi", [
    "备份",
  ]),
  page(
    "transfer-reset",
    "com.apple.Transfer-Reset-Settings.extension",
    "传输或还原",
    "Transfer or Reset",
    "chuan shu huo huan yuan",
    ["抹掉所有内容"],
    true,
  ),
  page(
    "startup-disk",
    "com.apple.Startup-Disk-Settings.extension",
    "启动磁盘",
    "Startup Disk",
    "qi dong ci pan",
    [],
    true,
  ),
  page(
    "apple-account",
    "com.apple.systempreferences.AppleIDSettings",
    "Apple 账户",
    "Apple Account",
    "",
    ["Apple ID", "iCloud"],
    true,
  ),
];

const OSASCRIPT = "/usr/bin/osascript";

/**
 * One run of osascript that does what the read command does, then the write command, then the read
 * command again, and prints the two readings with a line of `@@` between them. Every statement is
 * its own `-e` argument, as the two commands already are, and `result` is what the statement before
 * gave: so nothing of the two commands is rewritten here. Null when either is not such a command.
 */
export function hxMacCombined(read: HxCommand, write: HxCommand): HxCommand | null {
  const readScript = read.command === OSASCRIPT && read.args.length === 2 ? read.args[1] : undefined;
  const writeScript = write.command === OSASCRIPT && write.args.length === 2 ? write.args[1] : undefined;
  if (readScript === undefined || writeScript === undefined) return null;
  return {
    command: OSASCRIPT,
    args: [
      "-e",
      readScript,
      "-e",
      "set hxBefore to result as text",
      "-e",
      writeScript,
      "-e",
      readScript,
      "-e",
      `return hxBefore & linefeed & "${HX_COMBINED_SEPARATOR}" & linefeed & (result as text)`,
    ],
  };
}

function script(text: string) {
  return { command: OSASCRIPT, args: ["-e", text] };
}

function events(text: string) {
  return script(`tell application "System Events" to ${text}`);
}

function volumeNumber(key: string, zh: string, en: string, pinyin: string, property: string): HxSettingSeed {
  return {
    key,
    page: "sound",
    zh,
    en,
    pinyin,
    values: { type: "number", min: 0, max: 100 },
    read: script(`${property} of (get volume settings)`),
    parse: (stdout) => hxParseNumber(stdout, 0, 100),
    write: (value) => script(`set volume ${property} ${Number(value)}`),
  };
}

function dockSwitch(
  key: string,
  zh: string,
  en: string,
  pinyin: string,
  property: string,
  more: readonly string[] = [],
) {
  const seed: HxSettingSeed = {
    key,
    page: "desktop-dock",
    zh,
    en,
    pinyin,
    more,
    values: { type: "switch" },
    read: events(`get ${property} of dock preferences`),
    parse: hxParseSwitch,
    write: (value) => events(`set ${property} of dock preferences to ${value === "on"}`),
  };
  return seed;
}

function dockChoice(key: string, zh: string, en: string, pinyin: string, property: string, options: readonly string[]) {
  const seed: HxSettingSeed = {
    key,
    page: "desktop-dock",
    zh,
    en,
    pinyin,
    values: { type: "choice", options },
    read: events(`get ${property} of dock preferences`),
    parse: (stdout) => hxParseChoice(stdout, options),
    // The value is one of the options: actions.ts checks it before this runs.
    write: (value) => events(`set ${property} of dock preferences to ${options.includes(value) ? value : options[0]}`),
  };
  return seed;
}

export const HX_MAC_SETTINGS: readonly HxSettingSeed[] = [
  {
    key: "dark-mode",
    page: "appearance",
    zh: "深色模式",
    en: "Dark mode",
    pinyin: "shen se mo shi",
    more: ["暗色模式", "夜间模式", "深色外观", "dark appearance"],
    values: { type: "switch" },
    read: events("tell appearance preferences to get dark mode"),
    parse: hxParseSwitch,
    write: (value) => events(`tell appearance preferences to set dark mode to ${value === "on"}`),
  },
  {
    ...volumeNumber("volume", "音量", "Volume", "yin liang", "output volume"),
    more: ["输出音量", "声音大小", "output volume"],
  },
  {
    key: "mute",
    page: "sound",
    zh: "静音",
    en: "Mute",
    pinyin: "jing yin",
    more: ["关闭声音", "muted"],
    values: { type: "switch" },
    read: script("output muted of (get volume settings)"),
    parse: hxParseSwitch,
    write: (value) => script(`set volume output muted ${value === "on"}`),
  },
  volumeNumber("alert-volume", "提示音音量", "Alert volume", "ti shi yin yin liang", "alert volume"),
  {
    ...volumeNumber("input-volume", "输入音量", "Input volume", "shu ru yin liang", "input volume"),
    more: ["麦克风音量"],
  },
  dockSwitch(
    "dock-autohide",
    "自动隐藏程序坞",
    "Hide the Dock automatically",
    "zi dong yin cang cheng xu wu",
    "autohide",
    ["自动隐藏 Dock", "Dock autohide"],
  ),
  dockSwitch("dock-magnification", "程序坞放大", "Dock magnification", "cheng xu wu fang da", "magnification", [
    "Dock 放大",
  ]),
  dockSwitch("dock-recents", "在程序坞中显示最近使用的应用", "Show recent apps in the Dock", "", "show recents"),
  dockSwitch(
    "menu-bar-autohide",
    "自动隐藏菜单栏",
    "Hide the menu bar automatically",
    "zi dong yin cang cai dan lan",
    "autohide menu bar",
  ),
  dockChoice("dock-position", "程序坞位置", "Dock position", "cheng xu wu wei zhi", "screen edge", [
    "left",
    "bottom",
    "right",
  ]),
  dockChoice("dock-minimize-effect", "最小化窗口的效果", "Minimize effect", "", "minimize effect", ["genie", "scale"]),
  {
    key: "dock-size",
    page: "desktop-dock",
    zh: "程序坞大小",
    en: "Dock size",
    pinyin: "cheng xu wu da xiao",
    more: ["Dock 大小"],
    values: { type: "number", min: 0, max: 100 },
    read: events("get dock size of dock preferences"),
    // The system gives a part of 1; HXBot shows it as 0 to 100.
    parse: (stdout) => hxParseNumber(stdout, 0, 100, 100),
    // Written as a division of whole numbers, which reads the same in every number format.
    write: (value) => events(`set dock size of dock preferences to (${Number(value)} / 100)`),
    // The Dock then settles on a whole number of points of its own: 32 became 30 on a real Mac.
    tolerance: 4,
  },
  // Added in v1.6.4 after GitHub's Macs listed the properties of the Dock (probe.dock-properties):
  // they change through the same System Events object as the settings above, and at once.
  dockSwitch(
    "dock-indicators",
    "显示已打开应用的指示灯",
    "Show indicators for open apps",
    "zhi shi deng",
    "show indicators",
    ["指示灯", "程序坞指示灯"],
  ),
  dockSwitch(
    "dock-minimize-into-app",
    "将窗口最小化至应用程序图标",
    "Minimize windows into the app icon",
    "",
    "minimize into application",
    ["最小化到应用图标"],
  ),
  dockSwitch("dock-launch-animation", "打开应用时显示动画", "Animate opening apps", "", "animate", [
    "启动动画",
    "打开动画",
  ]),
  {
    key: "dock-magnification-size",
    page: "desktop-dock",
    zh: "程序坞放大后的大小",
    en: "Dock magnification size",
    pinyin: "",
    more: ["放大大小"],
    values: { type: "number", min: 0, max: 100 },
    read: events("get magnification size of dock preferences"),
    parse: (stdout) => hxParseNumber(stdout, 0, 100, 100),
    write: (value) => events(`set magnification size of dock preferences to (${Number(value)} / 100)`),
    tolerance: 4,
  },
];

/** Where apps are installed. A folder directly inside one of these is searched too (suites keep their apps in one). */
export function hxMacAppRoots(home: string): string[] {
  return [
    "/Applications",
    "/Applications/Utilities",
    "/System/Applications",
    "/System/Applications/Utilities",
    "/System/Library/CoreServices/Applications",
    `${home}/Applications`,
  ];
}

/** Apps that live outside those folders. */
export const HX_MAC_EXTRA_APPS: readonly string[] = ["/System/Library/CoreServices/Finder.app"];
