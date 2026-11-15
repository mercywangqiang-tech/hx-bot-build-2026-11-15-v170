import type { HxCatalogEntry } from "@hxbot/contracts/hx-computer";
import { describe, expect, it } from "vitest";
import { hxNormalize, hxPinyinNames, hxSearch, hxSureHit } from "./search";

function entry(id: string, title: string, names: string[] = [], kind: HxCatalogEntry["kind"] = "app"): HxCatalogEntry {
  return { id, kind, title, names: [title, ...names], risk: 1 };
}

const ENTRIES = [
  entry("app:wechat", "微信", ["WeChat", "weixin", "wx"]),
  entry("app:wecom", "企业微信", ["WeCom"]),
  entry("page:bluetooth", "蓝牙", ["Bluetooth", "lanya", "ly"], "page"),
  entry("app:bt-exchange", "蓝牙文件交换", ["Bluetooth File Exchange"]),
  entry("setting:dark-mode", "深色模式", ["Dark mode", "暗色模式"], "setting"),
  entry("setting:volume", "音量", ["Volume"], "setting"),
  entry("setting:alert-volume", "提示音音量", ["Alert volume"], "setting"),
  entry("app:vscode", "Visual Studio Code", ["VS Code"]),
  entry("app:x", "X"),
];

describe("hxNormalize", () => {
  it("drops case, width, spaces and punctuation", () => {
    expect(hxNormalize("  Ｗｅ-Chat！ ")).toBe("wechat");
    expect(hxNormalize("Wi-Fi 设置")).toBe("wifi设置");
    expect(hxNormalize("…")).toBe("");
  });
});

describe("hxSearch", () => {
  const ids = (query: string, options = {}) => hxSearch(ENTRIES, query, options).map((hit) => hit.entry.id);

  it("finds nothing for an empty query or one of punctuation only", () => {
    expect(ids("")).toEqual([]);
    expect(ids(" ?! ")).toEqual([]);
  });

  it("puts the exact name first, then names that start with or contain the query", () => {
    expect(ids("微信")).toEqual(["app:wechat", "app:wecom"]);
    expect(ids("蓝牙")).toEqual(["page:bluetooth", "app:bt-exchange"]);
    expect(ids("音量")).toEqual(["setting:volume", "setting:alert-volume"]);
  });

  it("answers to other languages, aliases and pinyin", () => {
    expect(ids("wechat")[0]).toBe("app:wechat");
    expect(ids("WEIXIN")[0]).toBe("app:wechat");
    expect(ids("lanya")[0]).toBe("page:bluetooth");
    expect(ids("dark mode")[0]).toBe("setting:dark-mode");
    expect(ids("vs code")[0]).toBe("app:vscode");
  });

  it("recognizes a name inside a sentence", () => {
    expect(ids("把深色模式打开")).toEqual(["setting:dark-mode"]);
    expect(ids("请帮我打开蓝牙设置")[0]).toBe("page:bluetooth");
  });

  it("does not take a one-letter name inside a sentence for a mention", () => {
    expect(ids("open the x-ray viewer")).toEqual([]);
    expect(ids("x")[0]).toBe("app:x");
  });

  it("matches every word of a query in any order", () => {
    expect(ids("code studio")).toEqual(["app:vscode"]);
    expect(ids("code missing")).toEqual([]);
  });

  it("keeps to the kinds asked for and to the limit", () => {
    expect(ids("蓝牙", { kinds: ["app"] })).toEqual(["app:bt-exchange"]);
    expect(ids("微信", { limit: 1 })).toEqual(["app:wechat"]);
  });

  it("orders equal scores by title, so the order never depends on the scan", () => {
    const twins = [entry("app:b", "Notes B", ["notes"]), entry("app:a", "Notes A", ["notes"])];
    expect(hxSearch(twins, "notes").map((hit) => hit.entry.id)).toEqual(["app:a", "app:b"]);
  });
});

describe("hxSureHit", () => {
  const sure = (query: string) => hxSureHit(hxSearch(ENTRIES, query))?.id ?? null;

  it("takes an exact name over longer names that contain it", () => {
    expect(sure("微信")).toBe("app:wechat");
    expect(sure("蓝牙")).toBe("page:bluetooth");
    expect(sure("音量")).toBe("setting:volume");
  });

  it("takes the one name a sentence mentions", () => {
    expect(sure("把深色模式打开")).toBe("setting:dark-mode");
  });

  it("does not choose between two names that fit equally", () => {
    const twins = [entry("app:b", "Notes B", ["notes"]), entry("app:a", "Notes A", ["notes"])];
    expect(hxSureHit(hxSearch(twins, "notes"))).toBeNull();
    expect(sure("打开微信和蓝牙")).toBeNull();
  });

  it("does not act on words that only appear somewhere in a name", () => {
    expect(sure("code studio")).toBeNull();
    expect(hxSureHit([])).toBeNull();
  });
});

describe("phrases around a name", () => {
  const withSettings = [
    ...ENTRIES,
    entry("app:settings", "设置", ["Settings", "系统设置"]),
    entry("page:startup-disk", "启动磁盘", ["Startup Disk"], "page"),
  ];
  const first = (query: string) => {
    const hits = hxSearch(withSettings, query);
    return { id: hxSureHit(hits)?.id ?? null, score: hits[0]?.score ?? 0 };
  };

  it("does not take 设置 inside a longer phrase for the app called 设置", () => {
    expect(first("蓝牙设置")).toEqual({ id: "page:bluetooth", score: 95 });
    expect(first("bluetooth settings")).toEqual({ id: "page:bluetooth", score: 95 });
    expect(hxSearch(withSettings, "蓝牙设置").map((hit) => hit.entry.id)).not.toContain("app:settings");
  });

  it("finds the app called 设置 when the phrase names nothing else", () => {
    expect(first("设置")).toEqual({ id: "app:settings", score: 100 });
    expect(first("系统设置")).toEqual({ id: "app:settings", score: 100 });
    expect(first("Settings")).toEqual({ id: "app:settings", score: 100 });
    // 打开 is cut out, and what is left is the name.
    expect(first("打开设置")).toEqual({ id: "app:settings", score: 98 });
    expect(first("open settings")).toEqual({ id: "app:settings", score: 98 });
  });

  it("cuts 打开, 请 and the like out of a phrase, at a small cost", () => {
    expect(first("请帮我打开微信")).toEqual({ id: "app:wechat", score: 98 });
    expect(first("open wechat")).toEqual({ id: "app:wechat", score: 98 });
    expect(first("微信")).toEqual({ id: "app:wechat", score: 100 });
  });

  it("keeps a name that holds such a word itself", () => {
    expect(first("启动磁盘")).toEqual({ id: "page:startup-disk", score: 100 });
  });

  it("does not search for what is left when it is one character or nothing", () => {
    // 打开x leaves "x": too short to mean the app X.
    expect(hxSearch(withSettings, "打开x")).toEqual([]);
    expect(hxSearch(withSettings, "请打开")).toEqual([]);
    expect(hxSearch(withSettings, "open the")).toEqual([]);
  });
});

describe("hxPinyinNames", () => {
  it("gives the full spelling and the initials", () => {
    expect(hxPinyinNames("lan ya")).toEqual(["lanya", "ly"]);
    expect(hxPinyinNames("shen se mo shi")).toEqual(["shensemoshi", "ssms"]);
  });

  it("gives one name for a single syllable and none for nothing", () => {
    expect(hxPinyinNames("tong")).toEqual(["tong"]);
    expect(hxPinyinNames("  ")).toEqual([]);
  });
});
