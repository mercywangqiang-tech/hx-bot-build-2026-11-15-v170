// HXBot 电脑操控：这台电脑上装了哪些应用。
// macOS：直接读应用文件夹（不依赖聚焦搜索的索引），名称取自应用自己的 Info.plist 和中文语言包。
// Windows：问系统要“开始”菜单里的应用清单。
// 每个应用得到一个条目：打开时 macOS 用它的路径，Windows 用它在开始菜单里的标识。
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { HxCatalogEntry } from "@hxbot/contracts/hx-computer";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { hxPinyinTyped } from "./pinyin";
import { type HxRunner, hxRunOk } from "./runner";
import { hxNormalize, hxPinyinNames } from "./search";
import { HX_MAC_EXTRA_APPS, hxMacAppRoots } from "./tables-mac";
import { HX_WIN_LIST_APPS } from "./tables-win";

/** The folders a Chinese name can be in, the most common first. */
const CHINESE_FOLDERS = ["zh-Hans.lproj", "zh_CN.lproj", "zh-CN.lproj", "zh_Hans.lproj", "zh.lproj"];
const MAX_APPS = 3000;
const PLIST_READ_LIMIT = 2 * 1024 * 1024;
/** How many apps are read at the same time. */
const READ_TOGETHER = 6;

/**
 * Names people use for well-known apps, whatever the language of the system. The first word of a
 * row is how the app is found (by its normalized name); the rest are added to its names. Pinyin is spaced.
 */
const KNOWN_APPS: ReadonlyArray<{ match: readonly string[]; names: readonly string[]; pinyin?: string }> = [
  { match: ["wechat", "微信"], names: ["微信", "WeChat"], pinyin: "wei xin" },
  { match: ["wecom", "企业微信", "wxwork"], names: ["企业微信", "WeCom"], pinyin: "qi ye wei xin" },
  { match: ["dingtalk", "钉钉"], names: ["钉钉", "DingTalk"], pinyin: "ding ding" },
  { match: ["lark", "feishu", "飞书"], names: ["飞书", "Lark", "Feishu"], pinyin: "fei shu" },
  { match: ["qq"], names: ["QQ"] },
  { match: ["wpsoffice", "wps"], names: ["WPS", "WPS Office"] },
  { match: ["neteasemusic", "网易云音乐"], names: ["网易云音乐", "NetEase Music"], pinyin: "wang yi yun yin yue" },
  { match: ["finder", "访达"], names: ["访达", "Finder"], pinyin: "fang da" },
  { match: ["systemsettings", "系统设置"], names: ["系统设置", "System Settings", "设置"], pinyin: "xi tong she zhi" },
  { match: ["settings", "设置"], names: ["设置", "Settings", "系统设置", "Windows 设置"], pinyin: "she zhi" },
  { match: ["notes", "备忘录"], names: ["备忘录", "Notes"], pinyin: "bei wang lu" },
  { match: ["calendar", "日历"], names: ["日历", "Calendar"], pinyin: "ri li" },
  { match: ["reminders", "提醒事项"], names: ["提醒事项", "Reminders"], pinyin: "ti xing shi xiang" },
  { match: ["mail", "邮件"], names: ["邮件", "Mail"], pinyin: "you jian" },
  { match: ["messages", "信息"], names: ["信息", "Messages"], pinyin: "xin xi" },
  { match: ["photos", "照片"], names: ["照片", "Photos"], pinyin: "zhao pian" },
  { match: ["preview", "预览"], names: ["预览", "Preview"], pinyin: "yu lan" },
  { match: ["terminal", "终端"], names: ["终端", "Terminal"], pinyin: "zhong duan" },
  { match: ["calculator", "计算器"], names: ["计算器", "Calculator"], pinyin: "ji suan qi" },
  { match: ["safari", "safari浏览器"], names: ["Safari", "Safari 浏览器"] },
  {
    match: ["activitymonitor", "活动监视器"],
    names: ["活动监视器", "Activity Monitor"],
    pinyin: "huo dong jian shi qi",
  },
  { match: ["music", "音乐"], names: ["音乐", "Music"], pinyin: "yin yue" },
  { match: ["maps", "地图"], names: ["地图", "Maps"], pinyin: "di tu" },
  { match: ["contacts", "通讯录"], names: ["通讯录", "Contacts"], pinyin: "tong xun lu" },
  { match: ["textedit", "文本编辑"], names: ["文本编辑", "TextEdit"], pinyin: "wen ben bian ji" },
  { match: ["shortcuts", "快捷指令"], names: ["快捷指令", "Shortcuts"], pinyin: "kuai jie zhi ling" },
  { match: ["appstore"], names: ["App Store", "应用商店"] },
  { match: ["notepad", "记事本"], names: ["记事本", "Notepad"], pinyin: "ji shi ben" },
  { match: ["paint", "画图"], names: ["画图", "Paint"], pinyin: "hua tu" },
  {
    match: ["fileexplorer", "文件资源管理器"],
    names: ["文件资源管理器", "File Explorer", "资源管理器"],
    pinyin: "zi yuan guan li qi",
  },
  { match: ["taskmanager", "任务管理器"], names: ["任务管理器", "Task Manager"], pinyin: "ren wu guan li qi" },
  { match: ["commandprompt", "命令提示符"], names: ["命令提示符", "Command Prompt", "cmd"] },
  { match: ["microsoftedge"], names: ["Edge", "Microsoft Edge", "Edge 浏览器"] },
  { match: ["googlechrome", "chrome"], names: ["Chrome", "Google Chrome", "谷歌浏览器"] },
  { match: ["microsoftword", "word"], names: ["Word", "Microsoft Word"] },
  { match: ["microsoftexcel", "excel"], names: ["Excel", "Microsoft Excel"] },
  { match: ["microsoftpowerpoint", "powerpoint"], names: ["PowerPoint", "Microsoft PowerPoint", "PPT"] },
  { match: ["microsoftoutlook", "outlook"], names: ["Outlook", "Microsoft Outlook"] },
  { match: ["visualstudiocode", "code"], names: ["VS Code", "Visual Studio Code"] },
];

function unique(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const text = name.trim();
    const key = hxNormalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

/**
 * The names of an app with the names people use for it added, and the pinyin of every Chinese name
 * among them: typed whole ("wangyiyunyinyue") or by first letters ("wyyyy").
 */
export function hxAppNames(names: readonly string[]): string[] {
  const keys = new Set(names.map(hxNormalize));
  const more: string[] = [];
  for (const known of KNOWN_APPS) {
    if (!known.match.some((key) => keys.has(key))) continue;
    more.push(...known.names, ...(known.pinyin ? hxPinyinNames(known.pinyin) : []));
  }
  const all = unique([...names, ...more]);
  return unique([...all, ...all.flatMap(hxPinyinTyped)]);
}

function xmlText(value: string): string {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

/** The string under a key of a property list in its XML form, or an empty string. */
export function hxPlistString(xml: string, key: string): string {
  const at = xml.indexOf(`<key>${key}</key>`);
  if (at < 0) return "";
  const match = /^\s*<string>([^<]*)<\/string>/u.exec(xml.slice(at + key.length + 11));
  return match?.[1] === undefined ? "" : xmlText(match[1]).trim();
}

/** The value of a key in a `.strings` file in its text form (`"Key" = "Value";`), or an empty string. */
export function hxStringsValue(text: string, key: string): string {
  const escaped = key.replace(/[$()*+.?[\\\]^{|}]/gu, "\\$&");
  const match = new RegExp(`(?:^|[\\s;])"?${escaped}"?\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*;`, "u").exec(text);
  return match?.[1] === undefined ? "" : match[1].replace(/\\(.)/gu, "$1").trim();
}

/** A text file as macOS writes them: UTF-16 with a byte order mark, or UTF-8. */
export function hxDecodeText(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return bytes.toString("utf8").replace(/^﻿/u, "");
}

function isBinaryPlist(bytes: Buffer): boolean {
  return bytes.subarray(0, 6).toString("latin1") === "bplist";
}

async function readSmall(path: string): Promise<Buffer | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > PLIST_READ_LIMIT) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

/** A key of a property list file in any form: read here when it is text, by `plutil` when it is binary. */
async function plistValue(run: HxRunner, path: string, key: string, strings: boolean): Promise<string> {
  const bytes = await readSmall(path);
  if (!bytes) return "";
  if (!isBinaryPlist(bytes)) {
    const text = hxDecodeText(bytes);
    return strings && !text.trimStart().startsWith("<") ? hxStringsValue(text, key) : hxPlistString(text, key);
  }
  const result = await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", path], { timeoutMs: 5000 });
  return hxRunOk(result) ? result.stdout.trim() : "";
}

/** The identifier of an app or an extension (`com.apple.BluetoothSettings`), or an empty string. */
export function hxMacBundleId(run: HxRunner, bundle: string): Promise<string> {
  return plistValue(run, join(bundle, "Contents", "Info.plist"), "CFBundleIdentifier", false);
}

async function chineseName(run: HxRunner, app: string): Promise<string> {
  const resources = join(app, "Contents", "Resources");
  for (const folder of CHINESE_FOLDERS) {
    const file = join(resources, folder, "InfoPlist.strings");
    const name =
      (await plistValue(run, file, "CFBundleDisplayName", true)) || (await plistValue(run, file, "CFBundleName", true));
    if (name) return name;
  }
  // The apps of macOS itself keep every language in one table.
  const table = join(resources, "InfoPlist.loctable");
  if (!(await readSmall(table))) return "";
  for (const language of ["zh_CN", "zh-Hans"]) {
    for (const key of ["CFBundleDisplayName", "CFBundleName"]) {
      const result = await run("/usr/bin/plutil", ["-extract", `${language}.${key}`, "raw", "-o", "-", table], {
        timeoutMs: 5000,
      });
      if (hxRunOk(result) && result.stdout.trim()) return result.stdout.trim();
    }
  }
  return "";
}

async function appFolders(root: string, depth: number): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of names.sort()) {
    if (name.startsWith(".")) continue;
    const path = join(root, name);
    if (name.endsWith(".app")) found.push(path);
    else if (depth > 0) found.push(...(await appFolders(path, depth - 1)));
  }
  return found;
}

async function macApp(run: HxRunner, path: string, chineseFirst: boolean): Promise<HxCatalogEntry> {
  const fileName = basename(path, ".app");
  const info = join(path, "Contents", "Info.plist");
  const [display, bundleName, chinese] = await Promise.all([
    plistValue(run, info, "CFBundleDisplayName", false),
    plistValue(run, info, "CFBundleName", false),
    chineseName(run, path),
  ]);
  const own = chineseFirst ? [chinese, display, bundleName, fileName] : [display, bundleName, fileName, chinese];
  const names = hxAppNames(own);
  return { id: `app:${path}`, kind: "app", title: names[0] ?? fileName, names, risk: 1, target: path };
}

/**
 * The apps of a Mac, from its application folders. An app that cannot be read keeps the name of its
 * file. `chineseFirst` puts the Chinese name first, for a system that is used in Chinese.
 */
export async function hxMacApps(run: HxRunner, home: string, chineseFirst: boolean): Promise<HxCatalogEntry[]> {
  const paths = new Set<string>(HX_MAC_EXTRA_APPS);
  for (const root of hxMacAppRoots(home)) for (const path of await appFolders(root, 1)) paths.add(path);
  const list = [...paths].slice(0, MAX_APPS);
  const entries: HxCatalogEntry[] = [];
  for (let start = 0; start < list.length; start += READ_TOGETHER) {
    const group = list.slice(start, start + READ_TOGETHER);
    entries.push(...(await Promise.all(group.map((path) => macApp(run, path, chineseFirst)))));
  }
  return entries;
}

/** An entry that Windows made for an app that is already in the Start menu under the same name. */
function isGenerated(appId: string): boolean {
  return appId.startsWith("Microsoft.AutoGenerated.");
}

/** The Start menu of Windows as `Get-StartApps` prints it: one object, or a list of them. */
export function hxParseStartApps(stdout: string): HxCatalogEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.replace(/^﻿/u, "").trim() || "[]");
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const apps: Array<{ name: string; appId: string }> = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, MAX_APPS)) {
    if (!isDynamicRecord(item) || typeof item.Name !== "string" || typeof item.AppID !== "string") continue;
    const name = item.Name.trim();
    const appId = item.AppID.trim();
    if (!name || !appId || seen.has(appId)) continue;
    seen.add(appId);
    apps.push({ name, appId });
  }
  const named = new Set(apps.filter((app) => !isGenerated(app.appId)).map((app) => hxNormalize(app.name)));
  const entries: HxCatalogEntry[] = [];
  for (const { name, appId } of apps) {
    // Windows generates an entry of its own for some apps; it opens the same app under the same name,
    // and two entries of one name make every phrase for it ambiguous.
    if (isGenerated(appId) && named.has(hxNormalize(name))) continue;
    const names = hxAppNames([name]);
    entries.push({
      id: `app:${appId}`,
      kind: "app",
      title: names[0] ?? name,
      names,
      risk: 1,
      target: `shell:AppsFolder\\${appId}`,
    });
  }
  return entries;
}

export async function hxWinApps(run: HxRunner): Promise<HxCatalogEntry[]> {
  const result = await run(HX_WIN_LIST_APPS.command, HX_WIN_LIST_APPS.args, { timeoutMs: 30_000 });
  return hxRunOk(result) ? hxParseStartApps(result.stdout) : [];
}
