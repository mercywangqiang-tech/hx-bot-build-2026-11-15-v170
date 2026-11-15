import type { HxCatalogEntry } from "@hxbot/contracts/hx-computer";
import { describe, expect, it } from "vitest";
import {
  HX_REAL_APPS,
  HX_REAL_BROWSERS,
  HX_REAL_MAC_CHINESE,
  HX_REAL_NO_HARDWARE,
  HX_REAL_PAGE_NOTES,
  HX_REAL_PHRASES,
  HX_REAL_PROBES,
  HX_REAL_REFUSED,
  HX_REAL_REFUSED_ADDRESSES,
  HX_REAL_TEXT_EDITORS,
  hxRealAppEntry,
  hxRealEffect,
  hxRealPageShown,
  hxRealWays,
  hxRegValue,
} from "./realcheck-data";
import { HX_MAC_PAGES, HX_MAC_SETTINGS } from "./tables-mac";
import { HX_WIN_PAGES, HX_WIN_SETTINGS } from "./tables-win";

const PLATFORMS = ["mac", "windows"] as const;
const PAGES = { mac: HX_MAC_PAGES, windows: HX_WIN_PAGES };
const SETTINGS = { mac: HX_MAC_SETTINGS, windows: HX_WIN_SETTINGS };

function app(title: string, target: string, names: readonly string[] = []): HxCatalogEntry {
  return { id: `app:${target}`, kind: "app", title, names: [title, ...names], risk: 1, target };
}

describe("hxRealPageShown", () => {
  it("accepts the name of the page, however it is spaced and punctuated", () => {
    expect(hxRealPageShown(["Bluetooth"], "Bluetooth")).toBe(true);
    expect(hxRealPageShown(["General", "Wi‑Fi"], "Wi-Fi")).toBe(true);
    expect(hxRealPageShown(["PRIVACY &  SECURITY"], "Privacy & Security")).toBe(true);
  });

  it("accepts a heading that adds to the name, or is a part of it", () => {
    expect(hxRealPageShown(["Login Items & Extensions"], "Login Items")).toBe(true);
    expect(hxRealPageShown(["Siri"], "Siri & Spotlight")).toBe(true);
    expect(hxRealPageShown(["Displays"], "Display")).toBe(true);
    // Every long word of the name, in another order or with words between.
    expect(hxRealPageShown(["Bluetooth & other devices"], "Bluetooth & devices")).toBe(true);
    expect(hxRealPageShown(["Scanners and printers"], "Printers & scanners")).toBe(true);
  });

  it("does not take a sentence, another page or a short scrap for the page", () => {
    expect(hxRealPageShown(["Turn on Bluetooth to connect a keyboard, a mouse or headphones"], "Bluetooth")).toBe(
      false,
    );
    expect(hxRealPageShown(["Network", "Sound"], "Bluetooth")).toBe(false);
    expect(hxRealPageShown(["On", "Off", "VP"], "VPN")).toBe(false);
    expect(hxRealPageShown(["Bluetooth"], "Bluetooth & devices")).toBe(true);
    expect(hxRealPageShown(["Devices"], "Bluetooth & devices")).toBe(true);
    expect(hxRealPageShown(["Dev"], "Bluetooth & devices")).toBe(false);
    expect(hxRealPageShown([], "Sound")).toBe(false);
    expect(hxRealPageShown(["", "   "], "Sound")).toBe(false);
    expect(hxRealPageShown(["Sound"], " & ")).toBe(false);
  });
});

describe("hxRealAppEntry", () => {
  const entries = [
    app("Notepad++", "shell:AppsFolder\\npp", []),
    app("Notepad", "shell:AppsFolder\\Microsoft.WindowsNotepad!App", ["记事本"]),
    app("TextEdit", "/System/Applications/TextEdit.app", ["文本编辑"]),
    app("Old TextEdit", "/Applications/Old/TextEdit.app.bak"),
    { ...app("Sound", "ms-settings:sound"), id: "page:sound", kind: "page" as const },
  ];

  it("finds an app by the end of its path or by one of its names, exactly", () => {
    expect(hxRealAppEntry(entries, ["/textedit.app"])?.title).toBe("TextEdit");
    // Notepad++ is another app, although a search that drops punctuation finds both.
    expect(hxRealAppEntry(entries, ["notepad"])?.title).toBe("Notepad");
    expect(hxRealAppEntry(entries, ["  NotePad "])?.title).toBe("Notepad");
    expect(hxRealAppEntry(entries, ["记事本"])?.title).toBe("Notepad");
    expect(hxRealAppEntry(entries, ["wordpad", "notepad++"])?.title).toBe("Notepad++");
  });

  it("finds nothing for a name that only resembles one, or that belongs to a page", () => {
    expect(hxRealAppEntry(entries, ["note"])).toBeNull();
    expect(hxRealAppEntry(entries, ["note pad"])).toBeNull();
    expect(hxRealAppEntry(entries, ["/edit.app"])).toBeNull();
    expect(hxRealAppEntry(entries, ["sound"])).toBeNull();
    expect(hxRealAppEntry(entries, [])).toBeNull();
    expect(hxRealAppEntry([], ["notepad"])).toBeNull();
  });
});

describe("hxRegValue", () => {
  const printed = [
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
    "    AppsUseLightTheme    REG_DWORD    0x0",
    "    ColorPrevalence    REG_DWORD    0x1",
    "    Wallpaper    REG_SZ    C:\\Windows\\web\\img0.jpg",
    "    Big    REG_DWORD    0xff",
    "    Broken    REG_DWORD    zz",
    "",
  ].join("\r\n");

  it("reads a number as reg.exe prints it", () => {
    expect(hxRegValue(printed, "AppsUseLightTheme")).toBe(0);
    expect(hxRegValue(printed, "ColorPrevalence")).toBe(1);
    expect(hxRegValue(printed, "Big")).toBe(255);
  });

  it("reads nothing for a value that is not there, is no number, or only starts the same", () => {
    expect(hxRegValue(printed, "SystemUsesLightTheme")).toBeNull();
    expect(hxRegValue(printed, "Wallpaper")).toBeNull();
    expect(hxRegValue(printed, "Broken")).toBeNull();
    expect(hxRegValue(printed, "Apps")).toBeNull();
    expect(hxRegValue("", "AppsUseLightTheme")).toBeNull();
  });
});

describe("the other way to read a setting", () => {
  const shows = (platform: "mac" | "windows", key: string, stdout: string, code: number | null, value: string) => {
    const effect = hxRealEffect(platform, key);
    if (!effect) throw new Error(`no effect for ${key}`);
    return effect.shows(stdout, code, value);
  };

  it("is there only for settings that exist, and never uses the command HXBot itself reads with", () => {
    for (const platform of PLATFORMS) {
      for (const seed of SETTINGS[platform]) {
        const effect = hxRealEffect(platform, seed.key);
        if (!effect) continue;
        expect(effect.command.command, seed.key).not.toBe(seed.read.command);
      }
    }
    expect(hxRealEffect("mac", "volume")).toBeNull();
    expect(hxRealEffect("windows", "brightness")).toBeNull();
    expect(hxRealEffect("mac", "no-such-setting")).toBeNull();
    expect(hxRealEffect("mac", "dark-mode")?.command).toEqual({
      command: "/usr/bin/defaults",
      args: ["read", "-g", "AppleInterfaceStyle"],
    });
    expect(hxRealEffect("windows", "transparency")?.command.command).toMatch(/\\System32\\reg\.exe$/u);
    expect(hxRealEffect("windows", "transparency")?.command.args.slice(-2)).toEqual(["/v", "EnableTransparency"]);
  });

  it("knows the dark mode of macOS by a key that is only there when it is on", () => {
    expect(shows("mac", "dark-mode", "Dark\n", 0, "on")).toBe(true);
    expect(shows("mac", "dark-mode", "", 1, "on")).toBe(false);
    expect(shows("mac", "dark-mode", "", 1, "off")).toBe(true);
    expect(shows("mac", "dark-mode", "Dark\n", 0, "off")).toBe(false);
  });

  it("reads the switches, the choices and the size of the Dock from its own settings", () => {
    expect(shows("mac", "dock-autohide", "1\n", 0, "on")).toBe(true);
    expect(shows("mac", "dock-autohide", "0\n", 0, "on")).toBe(false);
    expect(shows("mac", "dock-recents", "0\n", 0, "off")).toBe(true);
    expect(shows("mac", "menu-bar-autohide", "1\n", 0, "off")).toBe(false);
    expect(shows("mac", "dock-position", "left\n", 0, "left")).toBe(true);
    expect(shows("mac", "dock-position", "bottom\n", 0, "left")).toBe(false);
    expect(shows("mac", "dock-minimize-effect", "scale\n", 0, "scale")).toBe(true);
    // A tile of 16 points is size 0, one of 128 is size 100.
    expect(shows("mac", "dock-size", "16\n", 0, "0")).toBe(true);
    expect(shows("mac", "dock-size", "128\n", 0, "100")).toBe(true);
    expect(shows("mac", "dock-size", "83.2\n", 0, "60")).toBe(true);
    expect(shows("mac", "dock-size", "84\n", 0, "60")).toBe(true);
    expect(shows("mac", "dock-size", "72\n", 0, "60")).toBe(false);
    expect(shows("mac", "dock-size", "big\n", 0, "60")).toBe(false);
  });

  it("reads the Windows settings from the registry, where 0 is dark and 1 is on", () => {
    const value = (name: string, number: number) =>
      `\r\nHKEY_CURRENT_USER\\x\r\n    ${name}    REG_DWORD    0x${number}\r\n`;
    expect(shows("windows", "app-dark-mode", value("AppsUseLightTheme", 0), 0, "on")).toBe(true);
    expect(shows("windows", "app-dark-mode", value("AppsUseLightTheme", 1), 0, "on")).toBe(false);
    expect(shows("windows", "system-dark-mode", value("SystemUsesLightTheme", 1), 0, "off")).toBe(true);
    expect(shows("windows", "transparency", value("EnableTransparency", 1), 0, "on")).toBe(true);
    expect(shows("windows", "transparency", value("EnableTransparency", 1), 0, "off")).toBe(false);
    expect(shows("windows", "clipboard-history", "", 1, "on")).toBe(false);
    const both = (apps: number, system: number) =>
      `${value("AppsUseLightTheme", apps)}    SystemUsesLightTheme    REG_DWORD    0x${system}\r\n`;
    expect(shows("windows", "dark-mode", both(0, 0), 0, "on")).toBe(true);
    expect(shows("windows", "dark-mode", both(1, 1), 0, "off")).toBe(true);
    expect(shows("windows", "dark-mode", both(0, 1), 0, "apps only")).toBe(true);
    expect(shows("windows", "dark-mode", both(1, 0), 0, "system only")).toBe(true);
    expect(shows("windows", "dark-mode", both(0, 1), 0, "on")).toBe(false);
    expect(shows("windows", "dark-mode", both(0, 0), 0, "system only")).toBe(false);
    expect(shows("windows", "dark-mode", value("AppsUseLightTheme", 0), 0, "on")).toBe(false);
  });
});

describe("what the check expects fits what HXBot has", () => {
  it("every phrase leads to a page or a setting of the built-in tables, or to an app of the list", () => {
    for (const platform of PLATFORMS) {
      const ids = new Set([
        ...PAGES[platform].map((seed) => `page:${seed.key}`),
        ...SETTINGS[platform].map((seed) => `setting:${seed.key}`),
      ]);
      const marks = new Set(HX_REAL_APPS[platform].flatMap((known) => known.marks));
      const phrases = HX_REAL_PHRASES[platform];
      expect(phrases.length, platform).toBeGreaterThanOrEqual(28);
      expect(new Set(phrases.map((phrase) => phrase.phrase)).size, platform).toBe(phrases.length);
      for (const phrase of phrases) {
        const ways = hxRealWays(phrase.expected);
        expect(ways.length === 0, `${platform} ${phrase.phrase}`).toBe(phrase.expected === "ask");
        for (const way of ways) {
          if ("id" in way) {
            expect(ids.has(way.id), `${platform} ${phrase.phrase}`).toBe(true);
            const kind = way.id.startsWith("page:") ? "page" : "setting";
            expect(phrase.kinds, `${platform} ${phrase.phrase}`).toContain(kind);
          } else {
            expect(marks.has(way.app), `${platform} ${phrase.phrase}`).toBe(true);
            expect(phrase.kinds, `${platform} ${phrase.phrase}`).toContain("app");
          }
        }
      }
      expect(phrases.some((phrase) => "ask" === phrase.expected) || platform === "windows").toBe(true);
    }
  });

  it("the notes about pages and about missing hardware name pages and settings that exist", () => {
    for (const platform of PLATFORMS) {
      const pages = new Set(PAGES[platform].map((seed) => seed.key));
      for (const [key, note] of Object.entries(HX_REAL_PAGE_NOTES[platform])) {
        expect(pages.has(key), `${platform} ${key}`).toBe(true);
        const says = note.hardware === true || note.desktopOnly === true || (note.titles?.length ?? 0) > 0;
        expect(says, `${platform} ${key}`).toBe(true);
      }
      // Only Windows Server lacks pages that a desktop Windows has.
      expect(Object.values(HX_REAL_PAGE_NOTES.mac).every((note) => note.desktopOnly === undefined)).toBe(true);
      const settings = new Set(SETTINGS[platform].map((seed) => seed.key));
      for (const key of Object.keys(HX_REAL_NO_HARDWARE[platform])) expect(settings.has(key), key).toBe(true);
    }
    expect(HX_REAL_NO_HARDWARE.windows.brightness?.test("Get-CimInstance : Not supported")).toBe(true);
    expect(HX_REAL_NO_HARDWARE.windows.brightness?.test("Access denied")).toBe(false);
  });

  it("the apps that are opened are closed by a name the system knows, and three of them are opened", () => {
    for (const platform of PLATFORMS) {
      const apps = HX_REAL_APPS[platform];
      expect(apps.filter((known) => known.open)).toHaveLength(3);
      for (const known of apps) {
        expect(known.marks.length, known.query).toBeGreaterThan(0);
        // An app that is only looked for in the catalog needs no process; one that is opened does.
        expect(known.processes.length > 0 || !known.open, known.query).toBe(true);
        for (const mark of known.marks) expect(mark, known.query).toBe(mark.toLowerCase());
      }
      expect(HX_REAL_TEXT_EDITORS[platform].length).toBeGreaterThan(0);
      expect(HX_REAL_BROWSERS[platform].length).toBeGreaterThan(1);
    }
    // The command window of Windows is looked for and never opened: the machine has command windows of its own.
    expect(HX_REAL_APPS.windows.find((known) => known.query === "Command Prompt")?.open).toBe(false);
    for (const [mark, chinese] of HX_REAL_MAC_CHINESE) {
      expect(
        HX_REAL_APPS.mac.some((known) => known.marks.includes(mark)),
        chinese,
      ).toBe(true);
      expect(chinese).toMatch(/^\p{Script=Han}+$/u);
    }
  });

  it("the probes only read: their names are different, and a Windows script has no double quote", () => {
    for (const platform of PLATFORMS) {
      const probes = HX_REAL_PROBES[platform];
      expect(new Set(probes.map((probe) => probe.id)).size, platform).toBe(probes.length);
      expect(probes.length, platform).toBeGreaterThanOrEqual(20);
      for (const probe of probes) {
        const text = probe.command.args.join(" ");
        expect(text, probe.id).not.toMatch(/\b(set|write|delete|Set-ItemProperty|New-Item|Remove-Item|reg add)\b/u);
        expect(probe.command.command.startsWith("/") || /^[A-Z]:\\/u.test(probe.command.command), probe.id).toBe(true);
        if (platform === "windows") expect(text, probe.id).not.toContain('"');
      }
    }
    // The question that can make macOS ask the user comes last.
    expect(HX_REAL_PROBES.mac.at(-1)?.id).toBe("settings-current-pane");
    expect(HX_REAL_PROBES.mac.at(-1)?.timeoutMs).toBeLessThan(15_000);
  });

  it("the files that must be refused have different names, and one of them is a program without an extension", () => {
    expect(new Set(HX_REAL_REFUSED.map((refused) => refused.name)).size).toBe(HX_REAL_REFUSED.length);
    expect(HX_REAL_REFUSED.filter((refused) => refused.runnable)).toEqual([
      { name: "tool", runnable: true, only: "mac" },
    ]);
    expect(HX_REAL_REFUSED.length).toBeGreaterThanOrEqual(8);
    for (const address of HX_REAL_REFUSED_ADDRESSES) expect(address).not.toMatch(/^https?:/u);
  });
});
