import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type HxRealCheckHost, hxRealBaseline, hxRealCheck, hxRealOtherValue, hxRealSpecific } from "./realcheck";
import { hxCheckCounts } from "./realcheck-report";
import { type HxWorldFaults, hxMacWorld, hxWindowsWorld } from "./realcheck-worlds";
import { HX_WINDOWS_COMMAND_TIMEOUT_MS } from "./runner";
import { HX_MAC_PAGES, HX_MAC_SETTINGS } from "./tables-mac";
import { HX_WIN_PAGES, HX_WIN_SETTINGS } from "./tables-win";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function temp(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "hx-realcheck-"));
  folders.push(folder);
  return folder;
}

async function mac(faults: HxWorldFaults = {}, options: Partial<HxRealCheckHost> = {}) {
  const [home, extensions, out] = [await temp(), await temp(), await temp()];
  const world = await hxMacWorld(home, extensions, faults);
  const result = await hxRealCheck({
    platform: "mac",
    machine: "macos-test",
    run: world.run,
    home,
    out,
    screenshots: true,
    now: world.now,
    wait: world.wait,
    macExtensions: extensions,
    ...options,
  });
  const item = (id: string) => result.report.items.find((candidate) => candidate.id === id);
  const ids = (outcome: string) =>
    result.report.items.filter((candidate) => candidate.outcome === outcome).map((candidate) => candidate.id);
  return { world, result, out, item, ids };
}

async function windows(faults: HxWorldFaults = {}, options: Partial<HxRealCheckHost> = {}) {
  const [home, out] = [await temp(), await temp()];
  const world = await hxWindowsWorld(home, faults);
  const result = await hxRealCheck({
    platform: "windows",
    machine: "windows-test",
    run: world.run,
    home,
    out,
    screenshots: true,
    now: world.now,
    wait: world.wait,
    ...options,
  });
  const item = (id: string) => result.report.items.find((candidate) => candidate.id === id);
  const ids = (outcome: string) =>
    result.report.items.filter((candidate) => candidate.outcome === outcome).map((candidate) => candidate.id);
  return { world, result, out, item, ids };
}

describe("hxRealCheck on a Mac that does everything right", () => {
  it("passes every check it can make, and leaves every setting as it was", async () => {
    const before = (await hxMacWorld(await temp(), await temp())).values();
    const { world, result, out, item, ids } = await mac();
    const { report } = result;

    // The app folders of a real Mac are not on the machine of the tests, so Finder has no files to
    // read a Chinese name from. Everything else must pass.
    expect(ids("failed")).toEqual(["catalog.chinese"]);
    expect(item("catalog.chinese")?.detail).toContain("访达");
    expect(item("catalog.chinese")?.detail).not.toContain("终端（");
    expect(ids("review")).toEqual([]);
    expect(ids("skipped")).toEqual([]);

    expect(report.machine).toBe("macos-test");
    expect(report.platform).toBe("mac");
    expect(report.system).toContain("macOS 15.1");
    expect(report.finishedAt).toBeGreaterThan(report.startedAt);
    expect(item("env.automation")?.outcome).toBe("passed");
    expect(item("env.accessibility")?.outcome).toBe("passed");
    expect(item("catalog.scan")?.detail).toContain("40 个设置页，16 项设置");
    expect(item("catalog.saved")?.detail).toContain("没有再扫描");

    // Every page was opened, read and found to be the right one.
    for (const page of HX_MAC_PAGES) expect(item(`page.${page.key}`)?.outcome, page.key).toBe("passed");
    expect(result.pages).toHaveLength(HX_MAC_PAGES.length);
    expect(result.pages.find((page) => page.key === "bluetooth")).toEqual({
      key: "bluetooth",
      wanted: "Bluetooth",
      opened: true,
      seen: ["Bluetooth"],
    });

    // Every setting was read, written back, changed, checked another way where there is one, and put back.
    const keys = HX_MAC_SETTINGS.map((seed) => seed.key);
    for (const key of keys) {
      for (const step of ["read", "same", "change", "restore", "fast"]) {
        expect(item(`setting.${key}.${step}`)?.outcome, `${key}.${step}`).toBe("passed");
      }
    }
    expect(item("setting.dark-mode.change")?.detail).toContain("off → on");
    expect(item("setting.dark-mode.effect")?.detail).toContain("Dark");
    expect(item("setting.dock-size.change")?.detail).toContain("50 → 60");
    expect(item("setting.dock-size.effect")?.outcome).toBe("passed");
    expect(item("setting.volume.effect")).toBeUndefined();
    expect(report.verified).toEqual(keys);
    expect(report.untestable).toEqual([]);
    expect(world.values()).toEqual(before);
    expect(item("final.restored")?.detail).toContain("16 项");

    // The gate: no direct change before the self-test, a direct change after it.
    expect(item("gate.before")?.detail).toContain("没有直接改");
    expect(item("gate.selftest")?.detail).toContain("可以直接改");
    expect(item("gate.after")?.detail).toContain("off → on → off");
    expect(item("tool.set.query")?.detail).toContain("把深色模式打开");
    expect(item("tool.set.security")?.outcome).toBe("passed");
    expect(item("tool.refuse")?.outcome).toBe("passed");
    expect(result.selfTest?.failed).toBe(0);
    expect(result.selfTest?.items.length).toBeGreaterThan(20);

    // What was started by the check was stopped by the check.
    expect(item("open.app.textedit")?.detail).toContain("已关掉");
    expect(item("open.refuse.tool")?.outcome).toBe("passed");
    expect(item("open.refuse.scheme")?.detail).toContain("4 个");
    expect(world.commands.some((command) => command.includes("no-such"))).toBe(false);

    expect(Object.keys(report.times).sort()).toEqual(
      [
        "catalog.load",
        "catalog.rescan",
        "catalog.scan",
        "open.app",
        "open.cost",
        "open.folder",
        "open.page",
        "open.page.command",
        "page.read",
        "setting.change",
        "setting.change.fast",
        "setting.read",
        "tool.set",
      ].sort(),
    );
    expect(result.chineseNames).toContain("磁盘工具");
    expect(result.chineseNames).not.toContain("Xcode");
    // Every Chinese name of the apps of the Mac can be typed in pinyin.
    expect(item("search.pinyin-full")?.detail).toContain("21 个中文名里 21 个用全拼排第一");
    expect(item("search.pinyin-initials")?.outcome).toBe("passed");

    const pictures = await readdir(join(out, "screenshots"));
    expect(pictures).toContain("page-bluetooth.jpg");
    expect(pictures).toContain("setting-dark-mode-before.jpg");
    expect(pictures).toContain("setting-dark-mode-after.jpg");
    expect(item("page.bluetooth")?.shot).toBe("page-bluetooth.jpg");
    await expect(readdir(join(out, "tmp"))).rejects.toThrow();
  });

  it("takes no pictures when it is told not to", async () => {
    const { out, result, item } = await mac({}, { screenshots: false });
    await expect(readdir(join(out, "screenshots"))).rejects.toThrow();
    expect(item("page.bluetooth")?.shot).toBeUndefined();
    expect(result.report.verified).toHaveLength(HX_MAC_SETTINGS.length);
  });
});

describe("hxRealCheck on a Windows computer that does everything right", () => {
  it("passes every check, and reports the brightness as something this machine cannot test", async () => {
    const { world, result, item, ids } = await windows();
    const { report } = result;

    expect(ids("failed")).toEqual([]);
    expect(ids("review")).toEqual([]);
    expect(ids("skipped")).toEqual([]);
    expect(report.system).toContain("Microsoft Windows Server 2025");
    expect(item("env.automation")).toBeUndefined();
    expect(item("catalog.chinese")).toBeUndefined();
    expect(item("page.panes")).toBeUndefined();
    expect(item("catalog.known")?.detail).toContain("Notepad");

    for (const page of HX_WIN_PAGES) expect(item(`page.${page.key}`)?.outcome, page.key).toBe("passed");
    // A page whose name is also in the navigation is only recognized by its heading.
    expect(item("page.accessibility")?.detail).toContain("Accessibility");
    expect(item("page.accessibility")?.detail).not.toContain("Gaming");

    const testable = HX_WIN_SETTINGS.map((seed) => seed.key).filter((key) => key !== "brightness");
    expect(report.verified).toEqual(testable);
    expect(report.untestable).toEqual(["brightness"]);
    expect(item("setting.brightness.read")?.outcome).toBe("unavailable");
    expect(item("setting.brightness.same")).toBeUndefined();
    expect(item("setting.dark-mode.effect")?.outcome).toBe("passed");
    expect(item("setting.clipboard-history.effect")?.outcome).toBe("passed");
    expect(ids("unavailable")).toEqual(["setting.brightness.read"]);

    // Every value is as it was. A value that was never written before (the clipboard history, the
    // accent color of Start, the notifications...) reads as what Windows does without it, and is
    // written as that now.
    expect(world.values()).toEqual({
      "Personalize\\AppsUseLightTheme": "1",
      "Personalize\\SystemUsesLightTheme": "1",
      "Personalize\\EnableTransparency": "1",
      "Personalize\\ColorPrevalence": "0",
      "Clipboard\\EnableClipboardHistory": "0",
      "Advanced\\TaskbarAl": "1",
      "Advanced\\ShowTaskViewButton": "1",
      "Advanced\\ShowSecondsInSystemClock": "0",
      "DWM\\ColorPrevalence": "0",
      "PushNotifications\\ToastEnabled": "1",
      "GameBar\\AllowAutoGameMode": "1",
      "StoragePolicy\\01": "0",
      "power\\VIDEOIDLE": "600",
      "power\\STANDBYIDLE": "1800",
    });
    expect(item("gate.after")?.outcome).toBe("passed");
    expect(item("open.app.notepad")?.outcome).toBe("passed");
    expect(item("open.url")?.detail).toContain("msedge");
    expect(item("open.refuse.tool")).toBeUndefined();
    expect(item("probe.explorer-advanced")?.outcome).toBe("passed");
    expect(hxCheckCounts(report.items).passed).toBeGreaterThan(130);
  });
});

describe("hxRealCheck gives each command its time", () => {
  it("as long as the app gives a Windows command, so a slow start of PowerShell is not a failure", async () => {
    const [home, out] = [await temp(), await temp()];
    const world = await hxWindowsWorld(home, {});
    const limits: number[] = [];
    await hxRealCheck({
      platform: "windows",
      machine: "windows-test",
      run: (command, args, options) => {
        // The read of the screen brightness: on a Windows 11 ARM machine of GitHub it took 22 seconds to
        // start PowerShell and 10 more for the query to give up, more than the 30 seconds it had.
        if (args.some((arg) => arg.includes("WmiMonitorBrightness") && arg.includes("catch { 'none' }")))
          limits.push(options?.timeoutMs ?? 0);
        return world.run(command, args, options);
      },
      home,
      out,
      screenshots: false,
      now: world.now,
      wait: world.wait,
    });
    expect(limits.length).toBeGreaterThan(0);
    expect(new Set(limits)).toEqual(new Set([HX_WINDOWS_COMMAND_TIMEOUT_MS]));
  });
});

describe("hxRealCheck tells what is wrong", () => {
  it("a setting whose change does not take effect fails its change, and is not verified", async () => {
    const { result, item, world } = await mac({ deaf: ["dock-autohide"] });
    expect(item("setting.dock-autohide.same")?.outcome).toBe("passed");
    expect(item("setting.dock-autohide.change")?.outcome).toBe("failed");
    expect(item("setting.dock-autohide.change")?.detail).toContain("写入 on，读回的却是 off");
    expect(item("setting.dock-autohide.effect")?.outcome).toBe("skipped");
    expect(item("setting.dock-autohide.restore")?.outcome).toBe("passed");
    expect(result.report.verified).not.toContain("dock-autohide");
    expect(result.report.verified).toContain("dock-magnification");
    expect(result.report.untestable).toEqual([]);
    expect(world.values()["dock-autohide"]).toBe("false");
  });

  it("a setting that cannot be put back fails its restore, and the end of the run says so again", async () => {
    const { result, item, world } = await windows({ sticky: ["transparency"] });
    expect(item("setting.transparency.change")?.outcome).toBe("passed");
    expect(item("setting.transparency.restore")?.outcome).toBe("failed");
    expect(item("final.restored")?.outcome).toBe("failed");
    expect(item("final.restored")?.detail).toContain("transparency（开始时 on，后来是 off，写不回，现在是 off）");
    expect(result.report.verified).not.toContain("transparency");
    expect(world.values()["Personalize\\EnableTransparency"]).toBe("0");
  });

  it("a change that the other way of reading does not show is left for a person to look at", async () => {
    const { result, item } = await mac({ hiddenEffect: ["dark-mode", "dock-position"] });
    expect(item("setting.dark-mode.change")?.outcome).toBe("passed");
    expect(item("setting.dark-mode.effect")?.outcome).toBe("review");
    expect(item("setting.dock-position.effect")?.detail).toContain("没有读到 right");
    expect(item("setting.dark-mode.restore")?.outcome).toBe("passed");
    expect(result.report.verified).not.toContain("dark-mode");
    expect(result.report.verified).not.toContain("dock-position");
    // The gate then takes the first switch that is verified.
    expect(item("gate.after")?.detail).toContain("off → on → off");
    expect(item("tool.set.query")?.detail).toContain("把静音打开");
    expect(item("tool.find")?.detail).toContain("setting:mute");
  });

  it("tells a page that did not open from a page under another name and from a page this machine lacks", async () => {
    const { item, ids } = await mac({
      deadPages: ["passwords", "battery"],
      renamedPages: {
        sharing: "Network Places",
        "control-center": "Menu Bar",
        "login-items": "Login Items & Extensions",
      },
    });
    expect(item("page.passwords")?.outcome).toBe("failed");
    expect(item("page.passwords")?.detail).toContain("窗口没有动");
    expect(item("page.battery")?.outcome).toBe("unavailable");
    expect(item("page.sharing")?.outcome).toBe("review");
    expect(item("page.sharing")?.detail).toContain("Network Places");
    // Known other names, and a heading that only adds to the name, pass.
    expect(item("page.control-center")?.outcome).toBe("passed");
    expect(item("page.login-items")?.outcome).toBe("passed");
    expect(ids("review")).toEqual(["page.sharing"]);
  });

  it("does the same on Windows, where the heading has to be told from the navigation", async () => {
    const { item } = await windows({
      deadPages: ["speech", "touchpad"],
      renamedPages: { fonts: "Typefaces", accessibility: "Ease of Access", printers: "Printer list" },
    });
    expect(item("page.speech")?.outcome).toBe("failed");
    expect(item("page.touchpad")?.outcome).toBe("unavailable");
    expect(item("page.fonts")?.outcome).toBe("review");
    expect(item("page.fonts")?.detail).toContain("Typefaces");
    // "Accessibility" is in the navigation of every page; that is not the heading of this one, but
    // "Ease of Access" is the name Windows 10 gives the page, which the notes know.
    expect(item("page.accessibility")?.outcome).toBe("passed");
    expect(item("page.printers")?.outcome).toBe("review");
    expect(item("page.display")?.outcome).toBe("passed");
  });

  it("names the panes this Mac does not have, and does not call such a page a failure", async () => {
    const { item } = await mac({ withoutPanes: ["wallet", "sound"], deadPages: ["sound"] });
    // Such a page may still open, so the list itself only names them: each page is judged on its own.
    expect(item("page.panes")?.outcome).toBe("passed");
    expect(item("page.panes")?.detail).toContain("com.apple.Sound-Settings.extension");
    expect(item("page.panes")?.detail).toContain("com.apple.BluetoothSettings");
    // Sound is not on this Mac and its address does nothing: this system version keeps it elsewhere.
    expect(item("page.sound")?.outcome).toBe("unavailable");
    expect(item("page.sound")?.detail).toContain("这台 Mac 没有“Sound”的设置面板");
    // Wallet is not a pane here either, but its page still opened.
    expect(item("page.wallet")?.outcome).toBe("passed");
    // The self-test says the same about the panes, and does not call it a failure either.
    expect(item("gate.selftest-items")?.outcome).toBe("passed");
  });

  it("without the permission for System Events, the settings that need it cannot be tested, and nothing is called verified", async () => {
    const { result, item } = await mac({ noAutomation: true });
    expect(item("env.automation")?.outcome).toBe("failed");
    expect(item("setting.dark-mode.read")?.outcome).toBe("unavailable");
    expect(item("setting.dock-size.read")?.outcome).toBe("unavailable");
    // The volume does not go through System Events.
    expect(item("setting.volume.restore")?.outcome).toBe("passed");
    expect(result.report.verified).toEqual(["volume", "mute", "alert-volume", "input-volume"]);
    expect(result.report.untestable).toContain("dark-mode");
    // Every setting of the Dock and the menu bar goes through System Events too.
    expect(result.report.untestable).toHaveLength(12);
    expect(item("page.bluetooth")?.outcome).toBe("review");
    expect(item("gate.after")?.outcome).toBe("passed");
  });

  it("without the permission to read windows, the pages are left for a person to look at", async () => {
    const { item, ids } = await mac({ noAccessibility: true });
    expect(item("env.accessibility")?.outcome).toBe("review");
    expect(item("page.bluetooth")?.outcome).toBe("review");
    expect(item("page.bluetooth")?.detail).toContain("看截图");
    expect(item("page.bluetooth")?.shot).toBe("page-bluetooth.jpg");
    expect(ids("review")).toHaveLength(1 + HX_MAC_PAGES.length);
    expect(item("setting.dark-mode.restore")?.outcome).toBe("passed");
  });

  it("an app that is missing is named, and not opened", async () => {
    const { item } = await mac({ withoutApps: ["Preview", "Terminal"] });
    expect(item("catalog.known")?.outcome).toBe("failed");
    expect(item("catalog.known")?.detail).toContain("Preview、Terminal");
    expect(item("open.app.preview")?.outcome).toBe("unavailable");
    expect(item("open.app.textedit")?.outcome).toBe("passed");
    const { item: other } = await windows({ withoutApps: ["Paint"] });
    expect(other("catalog.known")?.outcome).toBe("passed");
    expect(other("catalog.known")?.detail).toContain("这台机器没有（不要求）：Paint");
    expect(other("open.app.paint")?.outcome).toBe("unavailable");
  });

  it("an app that was opened and never shows up fails", async () => {
    const { item } = await windows({ appsDoNotStart: true });
    expect(item("open.app.notepad")?.outcome).toBe("failed");
    expect(item("open.app.notepad")?.detail).toContain("10 秒内没有出现");
    // Which program opens a document or an address depends on the machine: a person looks.
    expect(item("open.document")?.outcome).toBe("review");
    expect(item("open.url")?.outcome).toBe("review");
    expect(item("open.folder")?.outcome).toBe("passed");
  });

  it("a machine without a desktop fails on a Mac and is left open on Windows", async () => {
    expect((await mac({ noDesktop: true })).item("env.desktop")?.outcome).toBe("failed");
    expect((await windows({ noDesktop: true })).item("env.desktop")?.outcome).toBe("review");
  });

  it("stops starting checks when its time is used up, and still puts the settings back", async () => {
    const { result, item, world, ids } = await mac({}, { budgetMs: 0 });
    expect(item("env.system")?.outcome).toBe("skipped");
    expect(item("page.bluetooth")?.outcome).toBe("skipped");
    expect(ids("passed")).toEqual(["final.restored", "final.cleanup"]);
    expect(result.report.verified).toEqual([]);
    expect(world.values()["dark-mode"]).toBe("false");
  });

  it("a check that stops is a failed check, and the others go on", async () => {
    const world = await hxMacWorld(await temp(), await temp());
    const { item, result } = await mac(
      {},
      {
        system: {
          processIds: async () => [],
          stop: async () => {},
          settingsWindow: async () => {
            throw new Error("the window server went away");
          },
          closeSettings: async () => {},
          folderWindows: async () => null,
          closeFolders: async () => {},
          screenshot: async () => {
            throw new Error("no screen");
          },
          describe: async () => {
            throw new Error("sw_vers is gone");
          },
          automation: async () => ({ allowed: true, detail: "yes" }),
          accessibility: async () => ({ allowed: true, detail: "yes" }),
        },
        now: world.now,
        wait: world.wait,
      },
    );
    expect(item("env.system")?.outcome).toBe("failed");
    expect(item("env.system")?.detail).toContain("sw_vers is gone");
    expect(item("page.bluetooth")?.outcome).toBe("failed");
    expect(item("page.bluetooth")?.detail).toContain("the window server went away");
    expect(item("open.folder")?.outcome).toBe("review");
    expect(item("setting.dark-mode.restore")?.outcome).toBe("passed");
    expect(result.report.system).toBe("macOS");
  });
});

describe("the helpers of the check", () => {
  it("choose another value for every kind of setting", () => {
    expect(hxRealOtherValue({ type: "switch" }, "on")).toBe("off");
    expect(hxRealOtherValue({ type: "switch" }, "off")).toBe("on");
    // A mix of the two halves of a switch is changed to a plain "on".
    expect(hxRealOtherValue({ type: "switch" }, "apps only")).toBe("on");
    expect(hxRealOtherValue({ type: "number", min: 0, max: 100 }, "50")).toBe("60");
    expect(hxRealOtherValue({ type: "number", min: 0, max: 100 }, "95")).toBe("85");
    expect(hxRealOtherValue({ type: "number", min: 0, max: 100 }, "100")).toBe("90");
    expect(hxRealOtherValue({ type: "number", min: 1, max: 5 }, "5")).toBe("4");
    expect(hxRealOtherValue({ type: "number", min: 0, max: 100 }, "many")).toBeNull();
    expect(hxRealOtherValue({ type: "choice", options: ["left", "bottom", "right"] }, "right")).toBe("left");
    expect(hxRealOtherValue({ type: "choice", options: ["left", "bottom", "right"] }, "bottom")).toBe("right");
    expect(hxRealOtherValue({ type: "file" }, "/a.png")).toBeNull();
  });

  it("tell what one page shows from what every page shows", () => {
    const navigation = ["Settings", "System", "Accessibility"];
    const pages = [
      [...navigation, "Display", "Brightness"],
      [...navigation, "Sound", "Volume"],
      [...navigation, "Accessibility", "Text size"],
      [...navigation, "About"],
      [...navigation, "Storage"],
    ];
    const baseline = hxRealBaseline(pages);
    expect([...baseline]).toEqual([
      ["Settings", 1],
      ["System", 1],
      ["Accessibility", 1],
    ]);
    expect(hxRealSpecific(pages[0] ?? [], baseline)).toEqual(["Display", "Brightness"]);
    expect(hxRealSpecific(pages[2] ?? [], baseline)).toEqual(["Accessibility", "Text size"]);
    // With too few pages nothing is known about the navigation, and everything counts.
    expect(hxRealBaseline(pages.slice(0, 4)).size).toBe(0);
    expect(hxRealSpecific(["A", "A", "B"], new Map())).toEqual(["A", "B"]);
    expect(hxRealBaseline([]).size).toBe(0);
  });
});
