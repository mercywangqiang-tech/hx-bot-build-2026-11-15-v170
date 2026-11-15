import { describe, expect, it } from "vitest";
import { type HxPageSeed, type HxSettingSeed, hxParseChoice, hxParseNumber, hxParseSwitch } from "./tables";
import { HX_MAC_EXTRA_APPS, HX_MAC_PAGES, HX_MAC_SETTINGS, hxMacAppRoots } from "./tables-mac";
import {
  HX_POWERSHELL,
  HX_WIN_LIST_APPS,
  HX_WIN_PAGES,
  HX_WIN_SETTINGS,
  hxPowerShell,
  hxPowerShellPath,
  hxWinStart,
} from "./tables-win";
import { HX_COMPUTER_VERIFIED } from "./verified";

const SYSTEMS: ReadonlyArray<{
  name: string;
  scheme: string;
  pages: readonly HxPageSeed[];
  settings: readonly HxSettingSeed[];
}> = [
  { name: "macOS", scheme: "x-apple.systempreferences:", pages: HX_MAC_PAGES, settings: HX_MAC_SETTINGS },
  { name: "Windows", scheme: "ms-settings:", pages: HX_WIN_PAGES, settings: HX_WIN_SETTINGS },
];

function sample(seed: HxSettingSeed): string[] {
  if (seed.values.type === "switch") return ["on", "off"];
  if (seed.values.type === "number") return [String(seed.values.min), "37", String(seed.values.max)];
  if (seed.values.type === "choice") return [...seed.values.options];
  return ["/tmp/picture.png"];
}

describe("parsing what the system prints", () => {
  it("reads a switch", () => {
    expect(hxParseSwitch("true\n")).toBe("on");
    expect(hxParseSwitch(" False ")).toBe("off");
    expect(hxParseSwitch("missing value")).toBeNull();
    expect(hxParseSwitch("")).toBeNull();
  });

  it("reads a whole number inside its limits", () => {
    expect(hxParseNumber("50\n", 0, 100)).toBe("50");
    expect(hxParseNumber("0", 0, 100)).toBe("0");
    expect(hxParseNumber("101", 0, 100)).toBeNull();
    expect(hxParseNumber("-1", 0, 100)).toBeNull();
    expect(hxParseNumber("missing value", 0, 100)).toBeNull();
    expect(hxParseNumber("5e1", 0, 100)).toBeNull();
  });

  it("reads a part of one with a point or a comma", () => {
    expect(hxParseNumber("0.428571432829", 0, 100, 100)).toBe("43");
    expect(hxParseNumber("0,5", 0, 100, 100)).toBe("50");
    expect(hxParseNumber("1.0", 0, 100, 100)).toBe("100");
  });

  it("reads one of the options", () => {
    expect(hxParseChoice("Bottom\n", ["left", "bottom", "right"])).toBe("bottom");
    expect(hxParseChoice("top", ["left", "bottom", "right"])).toBeNull();
  });
});

describe.each(SYSTEMS)("the tables of $name", ({ scheme, pages, settings }) => {
  it("gives every page a key of its own, an address, and a name in both languages", () => {
    expect(new Set(pages.map((page) => page.key)).size).toBe(pages.length);
    expect(new Set(pages.map((page) => page.address)).size).toBe(pages.length);
    for (const page of pages) {
      expect(page.key, page.key).toMatch(/^[a-z][a-z0-9-]*$/u);
      expect(page.address.startsWith(scheme), page.key).toBe(true);
      expect(page.address.length, page.key).toBeGreaterThan(scheme.length);
      expect(page.address, page.key).not.toMatch(/\s/u);
      expect(page.zh.trim(), page.key).not.toBe("");
      expect(page.en.trim(), page.key).not.toBe("");
      expect(page.pinyin, page.key).toMatch(/^[a-z ]*$/u);
    }
  });

  it("has the pages the self-test and the fallbacks rely on", () => {
    const keys = new Set(pages.map((page) => page.key));
    for (const key of ["about", "bluetooth", "sound", "privacy"]) expect(keys.has(key), key).toBe(true);
  });

  it("marks the security pages", () => {
    const security = new Set(pages.filter((page) => page.security).map((page) => page.key));
    expect(security.has("privacy")).toBe(true);
    expect(security.has("bluetooth")).toBe(false);
    expect(security.has("sound")).toBe(false);
  });

  it("puts every setting on a page that exists, with a key of its own", () => {
    const keys = new Set(pages.map((page) => page.key));
    expect(new Set(settings.map((seed) => seed.key)).size).toBe(settings.length);
    for (const seed of settings) {
      expect(keys.has(seed.page), seed.key).toBe(true);
      expect(seed.zh.trim(), seed.key).not.toBe("");
      expect(seed.en.trim(), seed.key).not.toBe("");
      expect(pages.find((page) => page.key === seed.page)?.security ?? false, seed.key).toBe(false);
    }
  });

  it("writes only values it was given, and reads back what it wrote", () => {
    for (const seed of settings) {
      expect(seed.read.args.length, seed.key).toBeGreaterThan(0);
      for (const value of sample(seed)) {
        const command = seed.write(value);
        expect(command.command, seed.key).toBe(seed.read.command);
        const text = command.args.join(" ");
        expect(text, `${seed.key} ${value}`).not.toContain("undefined");
        expect(text, `${seed.key} ${value}`).not.toContain("NaN");
        expect(text, `${seed.key} ${value}`).not.toBe(seed.read.args.join(" "));
      }
      const [first, second] = sample(seed);
      if (first !== undefined && second !== undefined) {
        expect(seed.write(first).args.join(" "), seed.key).not.toBe(seed.write(second).args.join(" "));
      }
    }
  });
});

describe("the settings of macOS", () => {
  const seed = (key: string) => {
    const found = HX_MAC_SETTINGS.find((item) => item.key === key);
    if (!found) throw new Error(`no setting ${key}`);
    return found;
  };

  it("uses the system's own osascript, one script for each call", () => {
    for (const item of HX_MAC_SETTINGS) {
      expect(item.read.command).toBe("/usr/bin/osascript");
      expect(item.read.args[0]).toBe("-e");
      expect(item.read.args).toHaveLength(2);
    }
  });

  it("reads and writes dark mode through System Events", () => {
    const dark = seed("dark-mode");
    expect(dark.read.args[1]).toBe('tell application "System Events" to tell appearance preferences to get dark mode');
    expect(dark.write("on").args[1]).toBe(
      'tell application "System Events" to tell appearance preferences to set dark mode to true',
    );
    expect(dark.write("off").args[1]).toContain("to false");
    expect(dark.parse("true\n")).toBe("on");
  });

  it("reads and writes the volume without another program", () => {
    const volume = seed("volume");
    expect(volume.read.args[1]).toBe("output volume of (get volume settings)");
    expect(volume.write("30").args[1]).toBe("set volume output volume 30");
    expect(volume.parse("missing value\n")).toBeNull();
    expect(seed("mute").write("on").args[1]).toBe("set volume output muted true");
    expect(seed("alert-volume").write("5").args[1]).toBe("set volume alert volume 5");
    expect(seed("input-volume").read.args[1]).toBe("input volume of (get volume settings)");
  });

  it("writes the Dock size as a division of whole numbers", () => {
    const size = seed("dock-size");
    expect(size.write("43").args[1]).toBe(
      'tell application "System Events" to set dock size of dock preferences to (43 / 100)',
    );
    expect(size.parse("0.43\n")).toBe("43");
  });

  it("writes a Dock option only when it is one of the options", () => {
    const position = seed("dock-position");
    expect(position.write("left").args[1]).toContain("set screen edge of dock preferences to left");
    expect(position.write('left" & (do shell script "x")').args[1]).toContain("to left");
    expect(position.parse("right\n")).toBe("right");
    expect(seed("dock-autohide").write("on").args[1]).toContain("set autohide of dock preferences to true");
  });

  it("looks for apps in the folders of the system and of the user", () => {
    expect(hxMacAppRoots("/Users/a")).toContain("/Applications");
    expect(hxMacAppRoots("/Users/a")).toContain("/Users/a/Applications");
    expect(HX_MAC_EXTRA_APPS).toContain("/System/Library/CoreServices/Finder.app");
  });
});

describe("the settings of Windows", () => {
  const seed = (key: string) => {
    const found = HX_WIN_SETTINGS.find((item) => item.key === key);
    if (!found) throw new Error(`no setting ${key}`);
    return found;
  };
  const script = (command: { args: readonly string[] }) => command.args[command.args.length - 1] ?? "";

  it("runs Windows PowerShell without a profile and without a prompt", () => {
    const command = hxPowerShell("'x'");
    expect(command.command).toBe(HX_POWERSHELL);
    expect(command.args.slice(0, 6)).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
    ]);
    expect(command.args).toHaveLength(7);
    expect(script(command).endsWith("; 'x'")).toBe(true);
    expect(command.env).toBeUndefined();
  });

  it("starts every script by turning progress records off and its output to UTF-8", () => {
    const text = script(hxPowerShell("'x'"));
    expect(text.startsWith("$ProgressPreference = 'SilentlyContinue'; try { [Console]::OutputEncoding")).toBe(true);
    expect(text).toContain("[System.Text.Encoding]::UTF8 } catch { }; ");
  });

  it("runs PowerShell by its full path in the Windows folder, never by its bare name", () => {
    expect(hxPowerShellPath({ SystemRoot: "D:\\WINDOWS" })).toBe(
      "D:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    expect(hxPowerShellPath({ windir: "C:\\Windows\\" })).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    expect(hxPowerShellPath({ SystemRoot: "" })).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(hxPowerShellPath({})).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(HX_POWERSHELL.endsWith("\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe(true);
    expect(HX_POWERSHELL).toMatch(/^[A-Za-z]:\\/u);
  });

  it("puts no double quote into any script, so that the command line reads the same to every parser", () => {
    const commands = [
      HX_WIN_LIST_APPS,
      hxWinStart("x"),
      ...HX_WIN_SETTINGS.flatMap((item) => {
        const values =
          item.values.type === "switch"
            ? ["on", "off", "apps only", "system only"]
            : item.values.type === "number"
              ? ["0", "40", "100"]
              : item.values.type === "choice"
                ? item.values.options
                : ["C:\\a.png"];
        return [item.read, ...values.map((value) => item.write(value))];
      }),
    ];
    expect(commands.length).toBeGreaterThan(20);
    for (const command of commands) {
      expect(script(command), script(command)).not.toContain('"');
      expect(command.args.slice(0, 6).join(" ")).not.toContain('"');
    }
  });

  it("keeps a target out of the text of the command", () => {
    const command = hxWinStart("shell:AppsFolder\\Evil'; Remove-Item x; '");
    expect(script(command).endsWith("; Start-Process -FilePath $env:HX_TARGET -ErrorAction Stop")).toBe(true);
    expect(script(command)).not.toContain("Evil");
    expect(command.env).toEqual({ HX_TARGET: "shell:AppsFolder\\Evil'; Remove-Item x; '" });
  });

  it("lists the Start menu as UTF-8 JSON", () => {
    expect(script(HX_WIN_LIST_APPS)).toContain("Get-StartApps");
    expect(script(HX_WIN_LIST_APPS)).toContain("UTF8");
    expect(script(HX_WIN_LIST_APPS)).toContain("ConvertTo-Json");
  });

  it("turns dark mode on for apps and for the taskbar together, as the Settings app does", () => {
    const dark = seed("dark-mode");
    expect(dark.zh).toBe("深色模式");
    expect(script(dark.read)).toContain("AppsUseLightTheme");
    expect(script(dark.read)).toContain("SystemUsesLightTheme");
    // 0 is dark: the values say whether the light theme is used.
    expect(script(dark.write("on"))).toContain("-Name 'AppsUseLightTheme' -Value 0 -Type DWord");
    expect(script(dark.write("on"))).toContain("-Name 'SystemUsesLightTheme' -Value 0 -Type DWord");
    expect(script(dark.write("off"))).toContain("-Name 'AppsUseLightTheme' -Value 1 -Type DWord");
    expect(script(dark.write("off"))).toContain("-Name 'SystemUsesLightTheme' -Value 1 -Type DWord");
    expect(dark.parse("0,0\r\n")).toBe("on");
    expect(dark.parse("1,1\r\n")).toBe("off");
    expect(dark.parse("missing")).toBeNull();
    expect(dark.parse("7,1")).toBeNull();
    expect(dark.parse("0")).toBeNull();
  });

  it("reads a mix of dark and light as what it is, and can put exactly that mix back", () => {
    const dark = seed("dark-mode");
    // Windows 10 starts with a dark taskbar and light apps.
    expect(dark.parse("1,0")).toBe("system only");
    expect(dark.parse("0,1")).toBe("apps only");
    const system = script(dark.write("system only"));
    expect(system).toContain("-Name 'AppsUseLightTheme' -Value 1 -Type DWord");
    expect(system).toContain("-Name 'SystemUsesLightTheme' -Value 0 -Type DWord");
    const apps = script(dark.write("apps only"));
    expect(apps).toContain("-Name 'AppsUseLightTheme' -Value 0 -Type DWord");
    expect(apps).toContain("-Name 'SystemUsesLightTheme' -Value 1 -Type DWord");
    // Every reading can be written, and reads back as itself.
    for (const [numbers, reading] of [
      ["0,0", "on"],
      ["1,1", "off"],
      ["0,1", "apps only"],
      ["1,0", "system only"],
    ] as const) {
      const [appsValue, systemValue] = numbers.split(",");
      expect(dark.parse(numbers)).toBe(reading);
      expect(script(dark.write(reading))).toContain(`'AppsUseLightTheme' -Value ${appsValue} `);
      expect(script(dark.write(reading))).toContain(`'SystemUsesLightTheme' -Value ${systemValue} `);
    }
    // A word that is no reading turns nothing dark.
    expect(script(dark.write("nonsense"))).toContain("-Name 'AppsUseLightTheme' -Value 1 -Type DWord");
  });

  it("has dark mode for apps alone and for the taskbar alone too", () => {
    const apps = seed("app-dark-mode");
    expect(script(apps.read)).toContain("AppsUseLightTheme");
    expect(script(apps.write("on"))).toContain("-Name 'AppsUseLightTheme' -Value 0 -Type DWord");
    expect(script(apps.write("off"))).toContain("-Value 1 -Type DWord");
    expect(script(apps.write("on"))).not.toContain("SystemUsesLightTheme");
    expect(apps.parse("0\r\n")).toBe("on");
    expect(apps.parse("1\r\n")).toBe("off");
    expect(apps.parse("missing")).toBeNull();
    expect(apps.parse("7")).toBeNull();
    const system = seed("system-dark-mode");
    expect(script(system.write("on"))).toContain("-Name 'SystemUsesLightTheme' -Value 0 -Type DWord");
    expect(script(system.write("on"))).not.toContain("AppsUseLightTheme");
  });

  it("tells running programs after a theme change, and not after other changes", () => {
    expect(script(seed("dark-mode").write("on"))).toContain("ImmersiveColorSet");
    expect(script(seed("transparency").write("off"))).toContain("ImmersiveColorSet");
    expect(script(seed("clipboard-history").write("on"))).not.toContain("ImmersiveColorSet");
  });

  it("reads a clipboard history that was never set as off, and writes 1 for on", () => {
    const history = seed("clipboard-history");
    expect(history.parse("missing")).toBe("off");
    expect(history.parse("1")).toBe("on");
    expect(script(history.write("on"))).toContain("-Name 'EnableClipboardHistory' -Value 1");
    expect(script(history.write("on"))).toContain("New-Item");
  });

  it("sets the brightness as a whole number through WMI", () => {
    const brightness = seed("brightness");
    expect(script(brightness.read)).toContain("WmiMonitorBrightness");
    expect(script(brightness.write("40"))).toContain("Brightness = [byte]40");
    // A query that never answers (a Windows 11 ARM machine of GitHub) fails after 10 seconds, so the
    // read says `none` long before the command's own time limit.
    expect(script(brightness.read)).toContain("-OperationTimeoutSec 10");
    expect(script(brightness.read)).toContain("catch { 'none' }");
    expect(script(brightness.write("40")).match(/-OperationTimeoutSec 10/gu)).toHaveLength(2);
    expect(brightness.parse("55\r\n")).toBe("55");
  });
});

describe("the settings verified on real computers", () => {
  it("are settings of the tables, each once", () => {
    for (const [platform, list] of Object.entries(HX_COMPUTER_VERIFIED)) {
      const keys = new Set((platform === "mac" ? HX_MAC_SETTINGS : HX_WIN_SETTINGS).map((seed) => seed.key));
      expect(new Set(list).size, platform).toBe(list.length);
      for (const key of list) expect(keys.has(key), `${platform} ${key}`).toBe(true);
    }
  });

  it("leave out only what no machine of GitHub could test", () => {
    // The machines have no screen whose brightness can be set: that one still waits for the self-test.
    const windows = HX_WIN_SETTINGS.map((seed) => seed.key).filter(
      (key) => !HX_COMPUTER_VERIFIED.windows.includes(key),
    );
    expect(windows).toEqual(["brightness"]);
    expect(HX_MAC_SETTINGS.filter((seed) => !HX_COMPUTER_VERIFIED.mac.includes(seed.key))).toEqual([]);
  });
});
