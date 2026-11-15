import type { HxCatalogEntry, HxCatalogKind, HxComputerPlatform } from "@hxbot/contracts/hx-computer";
import { describe, expect, it } from "vitest";
import { hxAppNames } from "./apps";
import { HxCatalog } from "./catalog";
import { hxSearch, hxSureHit } from "./search";

// What people say, and what HXBot must understand by it, on a computer with the usual apps.
// "sure" phrases are acted on at once; "ask" phrases give candidates and nothing happens yet.

function app(platform: HxComputerPlatform, names: readonly string[]): HxCatalogEntry {
  const all = hxAppNames(names);
  const first = names[0] ?? "";
  return {
    id: `app:${first}`,
    kind: "app",
    title: all[0] ?? first,
    names: all,
    risk: 1,
    target: platform === "mac" ? `/Applications/${first}.app` : `shell:AppsFolder\\${first}`,
  };
}

const MAC_APPS: ReadonlyArray<readonly string[]> = [
  ["访达", "Finder"],
  ["系统设置", "System Settings"],
  ["Safari 浏览器", "Safari"],
  ["微信", "WeChat"],
  ["企业微信", "WeCom"],
  ["钉钉", "DingTalk"],
  ["飞书", "Lark"],
  ["QQ"],
  ["QQ音乐", "QQMusic"],
  ["网易云音乐", "NeteaseMusic"],
  ["备忘录", "Notes"],
  ["日历", "Calendar"],
  ["音乐", "Music"],
  ["预览", "Preview"],
  ["终端", "Terminal"],
  ["计算器", "Calculator"],
  ["蓝牙文件交换", "Bluetooth File Exchange"],
  ["Microsoft Word"],
  ["Microsoft Excel"],
  ["Microsoft PowerPoint"],
  ["Google Chrome"],
  ["Visual Studio Code", "Code"],
  ["WPS Office"],
  ["屏幕使用时间小组件"],
];

const WINDOWS_APPS: ReadonlyArray<readonly string[]> = [
  ["设置"],
  ["记事本"],
  ["画图"],
  ["计算器"],
  ["文件资源管理器"],
  ["任务管理器"],
  ["命令提示符"],
  ["Windows PowerShell"],
  ["截图工具"],
  ["Microsoft Edge"],
  ["微信"],
  ["企业微信"],
  ["钉钉"],
  ["QQ"],
  ["Word"],
  ["Excel"],
  ["PowerPoint"],
  ["WPS Office"],
  ["Google Chrome"],
  ["声音录制"],
];

async function entriesOf(platform: HxComputerPlatform): Promise<HxCatalogEntry[]> {
  const catalog = new HxCatalog({
    platform,
    // No scan in this test: the apps are the lists above.
    run: async () => ({ code: 1, stdout: "", stderr: "", timedOut: false, missing: false }),
    home: "/nowhere",
    dataFolder: () => null,
    chineseFirst: true,
    verified: true,
    now: () => 1,
  });
  const builtIn = (await catalog.entries()).filter((entry) => entry.kind !== "app");
  const apps = (platform === "mac" ? MAC_APPS : WINDOWS_APPS).map((names) => app(platform, names));
  return [...builtIn, ...apps];
}

const ALL: readonly HxCatalogKind[] = ["app", "page", "setting"];
const SETTINGS: readonly HxCatalogKind[] = ["setting", "page"];

type Phrase = readonly [phrase: string, kinds: readonly HxCatalogKind[], expected: string];

/** `expected` is the id that must be chosen without asking, or "ask" when candidates must come back. */
function check(entries: readonly HxCatalogEntry[], phrases: readonly Phrase[]): void {
  for (const [phrase, kinds, expected] of phrases) {
    const hits = hxSearch(entries, phrase, { kinds, limit: 5 });
    const sure = hxSureHit(hits);
    const seen = hits.map((hit) => `${hit.entry.id}=${hit.score.toFixed(1)}`).join(" ");
    if (expected === "ask") {
      expect(sure, `${phrase} → ${seen}`).toBeNull();
      expect(hits.length, `${phrase} → ${seen}`).toBeGreaterThan(1);
    } else {
      expect(sure?.id, `${phrase} → ${seen}`).toBe(expected);
    }
  }
}

describe("what people say on a Mac", () => {
  it("opens the right app", async () => {
    check(await entriesOf("mac"), [
      ["微信", ALL, "app:微信"],
      ["打开微信", ALL, "app:微信"],
      ["wx", ALL, "app:微信"],
      ["weixin", ALL, "app:微信"],
      ["WeChat", ALL, "app:微信"],
      ["企业微信", ALL, "app:企业微信"],
      ["钉钉", ALL, "app:钉钉"],
      ["dingding", ALL, "app:钉钉"],
      ["飞书", ALL, "app:飞书"],
      ["访达", ALL, "app:访达"],
      ["Finder", ALL, "app:访达"],
      ["word", ALL, "app:Microsoft Word"],
      ["Excel", ALL, "app:Microsoft Excel"],
      ["ppt", ALL, "app:Microsoft PowerPoint"],
      ["chrome", ALL, "app:Google Chrome"],
      ["谷歌浏览器", ALL, "app:Google Chrome"],
      ["vscode", ALL, "app:Visual Studio Code"],
      ["备忘录", ALL, "app:备忘录"],
      ["终端", ALL, "app:终端"],
      ["terminal", ALL, "app:终端"],
      ["计算器", ALL, "app:计算器"],
      ["系统设置", ALL, "app:系统设置"],
      ["设置", ALL, "app:系统设置"],
      ["网易云音乐", ALL, "app:网易云音乐"],
      ["WPS", ALL, "app:WPS Office"],
    ]);
  });

  it("asks when a name fits several apps", async () => {
    check(await entriesOf("mac"), [
      ["音乐", ALL, "app:音乐"],
      ["microsoft", ALL, "ask"],
      ["qq", ALL, "app:QQ"],
    ]);
  });

  it("opens the right page of System Settings", async () => {
    check(await entriesOf("mac"), [
      ["蓝牙", ALL, "page:bluetooth"],
      ["请打开蓝牙设置", ALL, "page:bluetooth"],
      ["bluetooth", ALL, "page:bluetooth"],
      ["lanya", ALL, "page:bluetooth"],
      ["wifi", ALL, "page:wifi"],
      ["Wi-Fi", ALL, "page:wifi"],
      ["无线网络", ALL, "page:wifi"],
      ["网络", ALL, "page:network"],
      ["声音", ALL, "page:sound"],
      ["显示器", ALL, "page:displays"],
      ["屏幕亮度", ALL, "page:displays"],
      ["分辨率", ALL, "page:displays"],
      ["壁纸", ALL, "page:wallpaper"],
      ["桌面背景", ALL, "page:wallpaper"],
      ["键盘", ALL, "page:keyboard"],
      ["输入法", ALL, "page:keyboard"],
      ["触控板", ALL, "page:trackpad"],
      ["打印机", ALL, "page:printers"],
      ["电池", ALL, "page:battery"],
      ["通知", ALL, "page:notifications"],
      ["勿扰模式", ALL, "page:focus"],
      ["关于本机", ALL, "page:about"],
      ["软件更新", ALL, "page:software-update"],
      ["系统更新", ALL, "page:software-update"],
      ["储存空间", ALL, "page:storage"],
      ["隐私与安全性", ALL, "page:privacy"],
      ["防火墙", ALL, "page:privacy"],
      ["程序坞", ALL, "page:desktop-dock"],
      ["dock", ALL, "page:desktop-dock"],
      ["时间机器", ALL, "page:time-machine"],
      ["隔空投送", ALL, "page:airdrop"],
      ["登录项", ALL, "page:login-items"],
      ["开机启动", ALL, "page:login-items"],
      ["语言与地区", ALL, "page:language"],
      ["privacy", ALL, "page:privacy"],
      ["keyboard", ALL, "page:keyboard"],
      ["notifications", ALL, "page:notifications"],
    ]);
  });

  it("finds the setting to change", async () => {
    check(await entriesOf("mac"), [
      ["深色模式", SETTINGS, "setting:dark-mode"],
      ["把深色模式打开", SETTINGS, "setting:dark-mode"],
      ["暗色模式", SETTINGS, "setting:dark-mode"],
      ["dark mode", SETTINGS, "setting:dark-mode"],
      ["turn on dark mode", SETTINGS, "setting:dark-mode"],
      ["音量", SETTINGS, "setting:volume"],
      ["把音量调到 30", SETTINGS, "setting:volume"],
      ["volume", SETTINGS, "setting:volume"],
      ["静音", SETTINGS, "setting:mute"],
      ["麦克风音量", SETTINGS, "setting:input-volume"],
      ["提示音音量", SETTINGS, "setting:alert-volume"],
      ["程序坞位置", SETTINGS, "setting:dock-position"],
      ["程序坞大小", SETTINGS, "setting:dock-size"],
      ["自动隐藏程序坞", SETTINGS, "setting:dock-autohide"],
      ["自动隐藏菜单栏", SETTINGS, "setting:menu-bar-autohide"],
      ["自动隐藏", SETTINGS, "ask"],
      // A page: HXBot opens it, or offers the settings on it that it changes directly.
      ["蓝牙", SETTINGS, "page:bluetooth"],
      ["程序坞", SETTINGS, "page:desktop-dock"],
      ["亮度", SETTINGS, "page:displays"],
    ]);
  });
});

describe("phrases around a name on a Mac", () => {
  it("looks past 打开 and 设置 to the thing that is named", async () => {
    check(await entriesOf("mac"), [
      // 设置 is also how the System Settings app is called: here it names nothing.
      ["蓝牙设置", ALL, "page:bluetooth"],
      ["声音设置", ALL, "page:sound"],
      ["网络设置", ALL, "page:network"],
      ["系统设置里的蓝牙", ALL, "page:bluetooth"],
      ["bluetooth settings", ALL, "page:bluetooth"],
      ["Bluetooth Settings", ALL, "page:bluetooth"],
      ["关闭蓝牙", SETTINGS, "page:bluetooth"],
      ["请帮我打开微信", ALL, "app:微信"],
      ["启动微信", ALL, "app:微信"],
      ["open wechat", ALL, "app:微信"],
      ["please open the terminal", ALL, "app:终端"],
      ["turn on dark mode", SETTINGS, "setting:dark-mode"],
      ["设置深色模式", SETTINGS, "setting:dark-mode"],
    ]);
  });

  it("still opens the settings app when that is all that is named", async () => {
    check(await entriesOf("mac"), [
      ["打开设置", ALL, "app:系统设置"],
      ["打开系统设置", ALL, "app:系统设置"],
      ["system settings", ALL, "app:系统设置"],
      ["open settings", ALL, "app:系统设置"],
    ]);
  });

  it("keeps a name whole when it holds one of those words itself", async () => {
    check(await entriesOf("mac"), [
      ["启动磁盘", ALL, "page:startup-disk"],
      ["开机启动", ALL, "page:login-items"],
      ["关于本机", ALL, "page:about"],
    ]);
  });
});

describe("what people say on Windows", () => {
  it("looks past 打开 and 设置 to the thing that is named", async () => {
    check(await entriesOf("windows"), [
      ["蓝牙设置", ALL, "page:bluetooth"],
      ["显示设置", ALL, "page:display"],
      ["声音设置", ALL, "page:sound"],
      ["网络设置", ALL, "page:network"],
      ["bluetooth settings", ALL, "page:bluetooth"],
      ["打开记事本", ALL, "app:记事本"],
      ["open notepad", ALL, "app:记事本"],
      ["打开设置", ALL, "app:设置"],
      ["系统设置", ALL, "app:设置"],
      ["open settings", ALL, "app:设置"],
      ["启动项", ALL, "page:startup-apps"],
      ["开始菜单", ALL, "page:start"],
      ["start", ALL, "page:start"],
    ]);
  });

  it("opens the right app", async () => {
    check(await entriesOf("windows"), [
      ["记事本", ALL, "app:记事本"],
      ["notepad", ALL, "app:记事本"],
      ["画图", ALL, "app:画图"],
      ["计算器", ALL, "app:计算器"],
      ["微信", ALL, "app:微信"],
      ["wx", ALL, "app:微信"],
      ["企业微信", ALL, "app:企业微信"],
      ["钉钉", ALL, "app:钉钉"],
      ["设置", ALL, "app:设置"],
      ["settings", ALL, "app:设置"],
      ["资源管理器", ALL, "app:文件资源管理器"],
      ["任务管理器", ALL, "app:任务管理器"],
      ["cmd", ALL, "app:命令提示符"],
      ["edge", ALL, "app:Microsoft Edge"],
      ["word", ALL, "app:Word"],
      ["excel", ALL, "app:Excel"],
      ["ppt", ALL, "app:PowerPoint"],
      ["chrome", ALL, "app:Google Chrome"],
    ]);
  });

  it("opens the right page of Settings", async () => {
    check(await entriesOf("windows"), [
      ["蓝牙", ALL, "page:bluetooth"],
      ["打开蓝牙设置", ALL, "page:bluetooth"],
      ["bluetooth", ALL, "page:bluetooth"],
      ["wifi", ALL, "page:wifi"],
      ["WLAN", ALL, "page:wifi"],
      ["无线网络", ALL, "page:wifi"],
      ["声音", ALL, "page:sound"],
      ["音量", ALL, "page:sound"],
      ["屏幕", ALL, "page:display"],
      ["分辨率", ALL, "page:display"],
      ["夜间模式", ALL, "page:night-light"],
      ["壁纸", ALL, "page:background"],
      ["任务栏", ALL, "page:taskbar"],
      ["打印机", ALL, "page:printers"],
      ["输入法", ALL, "page:typing"],
      ["系统更新", ALL, "page:windows-update"],
      ["Windows 更新", ALL, "page:windows-update"],
      ["默认应用", ALL, "page:default-apps"],
      ["默认浏览器", ALL, "page:default-apps"],
      ["卸载程序", ALL, "page:apps"],
      ["剪贴板", ALL, "page:clipboard"],
      ["隐私", ALL, "page:privacy"],
      ["电池", ALL, "page:power"],
      ["存储", ALL, "page:storage"],
      ["日期和时间", ALL, "page:date-time"],
      ["飞行模式", ALL, "page:airplane"],
    ]);
  });

  it("finds the setting to change", async () => {
    check(await entriesOf("windows"), [
      // The whole of dark mode, as the Settings app sets it; not only the half for apps.
      ["深色模式", SETTINGS, "setting:dark-mode"],
      ["打开深色模式", SETTINGS, "setting:dark-mode"],
      ["系统深色模式", SETTINGS, "setting:dark-mode"],
      ["暗色模式", SETTINGS, "setting:dark-mode"],
      ["dark mode", SETTINGS, "setting:dark-mode"],
      ["turn on dark mode", SETTINGS, "setting:dark-mode"],
      ["应用深色模式", SETTINGS, "setting:app-dark-mode"],
      ["任务栏和开始菜单深色模式", SETTINGS, "setting:system-dark-mode"],
      ["透明效果", SETTINGS, "setting:transparency"],
      ["剪贴板历史记录", SETTINGS, "setting:clipboard-history"],
      ["亮度", SETTINGS, "setting:brightness"],
      ["屏幕亮度", SETTINGS, "setting:brightness"],
      ["把亮度调到 40", SETTINGS, "setting:brightness"],
      // Night light is what Windows calls 夜间模式; it is a page, not dark mode.
      ["夜间模式", SETTINGS, "page:night-light"],
      ["蓝牙", SETTINGS, "page:bluetooth"],
      ["剪贴板", SETTINGS, "page:clipboard"],
    ]);
  });
});

describe("on both systems", () => {
  it.each(["mac", "windows"] as const)("no two entries of %s answer to one exact name", async (platform) => {
    const entries = (await entriesOf(platform)).filter((entry) => entry.kind !== "app");
    const owners = new Map<string, string[]>();
    for (const entry of entries) {
      for (const name of new Set(
        [entry.title, ...entry.names].map((text) => text.toLowerCase().replace(/\s+/gu, "")),
      )) {
        owners.set(name, [...(owners.get(name) ?? []), entry.id]);
      }
    }
    const shared = [...owners].filter(([, ids]) => ids.length > 1).map(([name, ids]) => `${name}: ${ids.join(", ")}`);
    expect(shared).toEqual([]);
  });

  it.each(["mac", "windows"] as const)(
    "every page and setting of %s is found by each of its names",
    async (platform) => {
      const entries = (await entriesOf(platform)).filter((entry) => entry.kind !== "app");
      for (const entry of entries) {
        for (const name of [entry.title, ...entry.names]) {
          const first = hxSearch(entries, name, { limit: 1 })[0];
          expect(first?.entry.id, `${name} of ${entry.id}`).toBe(entry.id);
          expect(first?.score, `${name} of ${entry.id}`).toBe(100);
        }
      }
    },
  );
});
