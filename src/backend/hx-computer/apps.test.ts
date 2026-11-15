import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hxAppNames,
  hxDecodeText,
  hxMacApps,
  hxMacBundleId,
  hxParseStartApps,
  hxPlistString,
  hxStringsValue,
  hxWinApps,
} from "./apps";
import type { HxRunner, HxRunResult } from "./runner";

const ok = (stdout: string): HxRunResult => ({ code: 0, stdout, stderr: "", timedOut: false, missing: false });
const fail: HxRunResult = { code: 1, stdout: "", stderr: "no", timedOut: false, missing: false };

function plist(values: Record<string, string>): string {
  const body = Object.entries(values)
    .map(([key, value]) => `\t<key>${key}</key>\n\t<string>${value}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`;
}

describe("reading a property list", () => {
  const xml = plist({
    CFBundleName: "WeChat",
    CFBundleIdentifier: "com.example.chat",
    CFBundleDisplayName: "A &amp; B &lt;1&gt;",
  });

  it("takes the string under a key", () => {
    expect(hxPlistString(xml, "CFBundleName")).toBe("WeChat");
    expect(hxPlistString(xml, "CFBundleIdentifier")).toBe("com.example.chat");
    expect(hxPlistString(xml, "CFBundleDisplayName")).toBe("A & B <1>");
  });

  it("gives nothing for a key that is missing or holds no string", () => {
    expect(hxPlistString(xml, "CFBundleVersion")).toBe("");
    expect(hxPlistString("<key>LSUIElement</key>\n<true/>", "LSUIElement")).toBe("");
    expect(hxPlistString("", "CFBundleName")).toBe("");
  });
});

describe("reading a strings file", () => {
  it("takes a value with or without quotes around the key", () => {
    expect(hxStringsValue('"CFBundleDisplayName" = "微信";\n', "CFBundleDisplayName")).toBe("微信");
    expect(hxStringsValue('/* name */\nCFBundleName = "备忘录";', "CFBundleName")).toBe("备忘录");
    expect(hxStringsValue('"A" = "1"; "CFBundleName" = "Say \\"hi\\"";', "CFBundleName")).toBe('Say "hi"');
  });

  it("gives nothing for another key", () => {
    expect(hxStringsValue('"XCFBundleName" = "x";', "CFBundleName")).toBe("");
    expect(hxStringsValue("", "CFBundleName")).toBe("");
  });

  it("decodes the forms macOS writes text in", () => {
    const text = '"CFBundleName" = "照片";';
    const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    const big = Buffer.from(little);
    big.swap16();
    expect(hxDecodeText(little)).toBe(text);
    expect(hxDecodeText(big)).toBe(text);
    expect(hxDecodeText(Buffer.from(`﻿${text}`, "utf8"))).toBe(text);
    expect(hxDecodeText(Buffer.from(text, "utf8"))).toBe(text);
    expect(hxDecodeText(Buffer.alloc(0))).toBe("");
  });
});

describe("hxAppNames", () => {
  it("adds the names people use for a well-known app, and their pinyin", () => {
    const names = hxAppNames(["WeChat"]);
    expect(names[0]).toBe("WeChat");
    expect(names).toContain("微信");
    expect(names).toContain("weixin");
    expect(names).toContain("wx");
  });

  it("knows the app by any of its names, and adds nothing twice", () => {
    expect(hxAppNames(["备忘录", "Notes"])).toEqual(["备忘录", "Notes", "beiwanglu", "bwl"]);
    expect(hxAppNames(["", "  ", "Photoshop", "photoshop"])).toEqual(["Photoshop"]);
  });
});

describe("the Start menu of Windows", () => {
  it("reads a list of apps", () => {
    const entries = hxParseStartApps(
      JSON.stringify([
        { Name: "记事本", AppID: "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App" },
        { Name: "Word", AppID: "Microsoft.Office.WINWORD.EXE.15" },
      ]),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "app:Microsoft.WindowsNotepad_8wekyb3d8bbwe!App",
      kind: "app",
      title: "记事本",
      risk: 1,
      target: "shell:AppsFolder\\Microsoft.WindowsNotepad_8wekyb3d8bbwe!App",
    });
    expect(entries[0]?.names).toContain("Notepad");
    expect(entries[1]?.names).toContain("Microsoft Word");
  });

  it("reads a single app, which PowerShell prints without a list", () => {
    expect(hxParseStartApps('﻿{"Name":"Paint","AppID":"Microsoft.Paint_8wekyb3d8bbwe!App"}\r\n')).toHaveLength(1);
  });

  it("leaves out what is not an app, and an app that is listed twice", () => {
    const entries = hxParseStartApps(
      JSON.stringify([
        { Name: "A", AppID: "a" },
        { Name: "A again", AppID: "a" },
        { Name: "", AppID: "b" },
        { Name: "C" },
        7,
        null,
      ]),
    );
    expect(entries.map((entry) => entry.id)).toEqual(["app:a"]);
  });

  it("gives no apps for output that is not JSON, or empty", () => {
    expect(hxParseStartApps("Get-StartApps : not recognized")).toEqual([]);
    expect(hxParseStartApps("")).toEqual([]);
  });

  it("asks PowerShell, and gives no apps when it fails", async () => {
    const calls: string[] = [];
    const run: HxRunner = async (command, args) => {
      calls.push(`${command} ${args[args.length - 1]}`);
      return ok('[{"Name":"Paint","AppID":"p"}]');
    };
    expect((await hxWinApps(run)).map((entry) => entry.id)).toEqual(["app:p"]);
    expect(calls[0]).toContain("powershell.exe");
    expect(calls[0]).toContain("Get-StartApps");
    expect(await hxWinApps(async () => fail)).toEqual([]);
  });
});

describe("the apps of a Mac", () => {
  let home = "";

  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  async function app(path: string, info: string | Buffer | null, strings?: { folder: string; data: string | Buffer }) {
    await mkdir(join(path, "Contents"), { recursive: true });
    if (info !== null) await writeFile(join(path, "Contents", "Info.plist"), info);
    if (strings) {
      const folder = join(path, "Contents", "Resources", strings.folder);
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "InfoPlist.strings"), strings.data);
    }
  }

  it("reads names from the app itself, and its Chinese name from the language folder", async () => {
    home = await mkdtemp(join(tmpdir(), "hx-apps-"));
    const apps = join(home, "Applications");
    await app(join(apps, "Chat.app"), plist({ CFBundleName: "Chat", CFBundleDisplayName: "Chat Pro" }), {
      folder: "zh-Hans.lproj",
      data: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('"CFBundleDisplayName" = "聊天";', "utf16le")]),
    });
    await app(join(apps, "Suite", "Tool.app"), plist({ CFBundleName: "Tool" }));
    await app(join(apps, "Bare.app"), null);
    await app(join(apps, "Suite", "Deeper", "Hidden.app"), plist({ CFBundleName: "Hidden" }));
    await mkdir(join(apps, ".Trash.app"), { recursive: true });
    await writeFile(join(apps, "notes.txt"), "x");

    const plutil: string[] = [];
    const run: HxRunner = async (command, args) => {
      plutil.push(`${command} ${args.join(" ")}`);
      return fail;
    };
    const chinese = await hxMacApps(run, home, true);
    const byTitle = new Map(chinese.map((entry) => [entry.title, entry]));
    // The Chinese name is also typed in pinyin, whole and by its first letters.
    expect(byTitle.get("聊天")?.names).toEqual(["聊天", "Chat Pro", "Chat", "liaotian", "lt"]);
    expect(byTitle.get("聊天")?.target).toBe(join(apps, "Chat.app"));
    expect(byTitle.get("聊天")?.id).toBe(`app:${join(apps, "Chat.app")}`);
    expect(byTitle.has("Tool")).toBe(true);
    expect(byTitle.has("Bare")).toBe(true);
    expect(byTitle.has("Hidden")).toBe(false);
    expect(chinese.some((entry) => entry.target?.includes(".Trash"))).toBe(false);
    // Finder lives outside the application folders and is always listed.
    expect(chinese.find((entry) => entry.target === "/System/Library/CoreServices/Finder.app")?.names).toContain(
      "访达",
    );
    expect(plutil).toEqual([]);

    const english = await hxMacApps(run, home, false);
    expect(english.find((entry) => entry.target === join(apps, "Chat.app"))?.title).toBe("Chat Pro");
  });

  it("asks plutil for a binary property list, and for the language table of a system app", async () => {
    home = await mkdtemp(join(tmpdir(), "hx-apps-"));
    const path = join(home, "Applications", "Notes.app");
    await app(path, Buffer.from("bplist00\u0001\u0002", "latin1"));
    await mkdir(join(path, "Contents", "Resources"), { recursive: true });
    await writeFile(join(path, "Contents", "Resources", "InfoPlist.loctable"), Buffer.from("bplist00", "latin1"));
    const asked: string[] = [];
    const run: HxRunner = async (command, args) => {
      asked.push(args.join(" "));
      expect(command).toBe("/usr/bin/plutil");
      if (args[1] === "CFBundleName") return ok("Notes\n");
      if (args[1] === "zh_CN.CFBundleDisplayName") return ok("备忘录\n");
      return fail;
    };
    const entries = await hxMacApps(run, home, true);
    const notes = entries.find((entry) => entry.target === path);
    expect(notes?.title).toBe("备忘录");
    expect(notes?.names).toContain("Notes");
    expect(asked.some((line) => line.startsWith("-extract CFBundleName raw -o - "))).toBe(true);
    expect(asked.some((line) => line.includes("InfoPlist.loctable"))).toBe(true);
  });

  it("keeps the English name when the language table has no Chinese", async () => {
    home = await mkdtemp(join(tmpdir(), "hx-apps-"));
    const path = join(home, "Applications", "Stocks.app");
    await app(path, plist({ CFBundleName: "Stocks" }));
    await mkdir(join(path, "Contents", "Resources"), { recursive: true });
    await writeFile(join(path, "Contents", "Resources", "InfoPlist.loctable"), Buffer.from("bplist00", "latin1"));
    const asked: string[] = [];
    const run: HxRunner = async (_command, args) => {
      asked.push(args[1] ?? "");
      return fail;
    };
    const entries = await hxMacApps(run, home, true);
    expect(entries.find((entry) => entry.target === path)?.title).toBe("Stocks");
    // Both spellings of the language, and both keys, were asked for.
    expect(asked).toEqual([
      "zh_CN.CFBundleDisplayName",
      "zh_CN.CFBundleName",
      "zh-Hans.CFBundleDisplayName",
      "zh-Hans.CFBundleName",
    ]);
  });

  it("reads the identifier of a bundle, as text or through plutil", async () => {
    home = await mkdtemp(join(tmpdir(), "hx-apps-"));
    const text = join(home, "Text.appex");
    const binary = join(home, "Binary.appex");
    await app(text, plist({ CFBundleIdentifier: "com.apple.BluetoothSettings" }));
    await app(binary, Buffer.from("bplist00\u0001", "latin1"));
    const run: HxRunner = async (command, args) => {
      expect(command).toBe("/usr/bin/plutil");
      expect(args.slice(0, 5)).toEqual(["-extract", "CFBundleIdentifier", "raw", "-o", "-"]);
      return ok("com.apple.wifi-settings-extension\n");
    };
    expect(await hxMacBundleId(run, text)).toBe("com.apple.BluetoothSettings");
    expect(await hxMacBundleId(run, binary)).toBe("com.apple.wifi-settings-extension");
    expect(await hxMacBundleId(run, join(home, "Missing.appex"))).toBe("");
  });
});
