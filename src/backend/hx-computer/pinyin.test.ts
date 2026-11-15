import { describe, expect, it } from "vitest";
import { hxAppNames } from "./apps";
import { hxPinyinOf, hxPinyinTyped } from "./pinyin";
import { HX_PINYIN_TABLE, HX_PINYIN_WORDS } from "./pinyin-table";
import { hxSearch } from "./search";

describe("hxPinyinOf", () => {
  it("reads every character by the table, and a word of the list as a whole", () => {
    expect(hxPinyinOf("磁盘工具")).toBe("ci pan gong ju");
    expect(hxPinyinOf("钥匙串访问")).toBe("yao shi chuan fang wen");
    // 乐, 行, 重 and 长 are read two ways; in these words the table alone would read them wrong.
    expect(hxPinyinOf("网易云音乐")).toBe("wang yi yun yin yue");
    expect(hxPinyinOf("招商银行")).toBe("zhao shang yin hang");
    expect(hxPinyinOf("重庆")).toBe("chong qing");
    expect(hxPinyinOf("校长")).toBe("xiao zhang");
    expect(hxPinyinOf("快乐")).toBe("kuai le");
  });

  it("keeps Latin letters and digits as parts of their own, and writes ü as v", () => {
    expect(hxPinyinOf("QQ音乐")).toBe("qq yin yue");
    expect(hxPinyinOf("音频MIDI设置")).toBe("yin pin midi she zhi");
    expect(hxPinyinOf("Office 2024 绿色版")).toBe("office 2024 lv se ban");
  });

  it("gives nothing for a name without Chinese, or with a character the table does not know", () => {
    expect(hxPinyinOf("Safari")).toBeNull();
    expect(hxPinyinOf("")).toBeNull();
    expect(hxPinyinOf("𠀀测试")).toBeNull();
  });
});

describe("hxPinyinTyped", () => {
  it("gives the whole pinyin and the first letters, a run of Latin letters whole in both", () => {
    expect(hxPinyinTyped("网易云音乐")).toEqual(["wangyiyunyinyue", "wyyyy"]);
    expect(hxPinyinTyped("QQ音乐")).toEqual(["qqyinyue", "qqyy"]);
    // One character has no first letters of its own.
    expect(hxPinyinTyped("词")).toEqual(["ci"]);
    expect(hxPinyinTyped("Notes")).toEqual([]);
  });
});

describe("the table", () => {
  it("has the 6763 characters of GB2312, each once, every syllable in plain letters", () => {
    const seen = new Set<string>();
    let count = 0;
    for (const group of HX_PINYIN_TABLE.split(" ")) {
      const syllable = /^[a-z]+/u.exec(group)?.[0] ?? "";
      expect(syllable.length, group.slice(0, 8)).toBeGreaterThan(0);
      for (const character of group.slice(syllable.length)) {
        expect(seen.has(character), character).toBe(false);
        seen.add(character);
        count += 1;
      }
    }
    expect(count).toBe(6763);
  });

  it("has words of two characters or more, read in plain syllables", () => {
    for (const [word, said] of Object.entries(HX_PINYIN_WORDS)) {
      expect([...word].length, word).toBeGreaterThanOrEqual(2);
      expect(said.split(" ").length, word).toBe([...word].length);
      expect(said, word).toMatch(/^[a-z]+( [a-z]+)*$/u);
    }
  });
});

describe("every app with a Chinese name can be typed in pinyin", () => {
  const app = (title: string, target: string) => {
    const names = hxAppNames([title]);
    return { id: `app:${target}`, kind: "app" as const, title, names, risk: 1 as const, target };
  };
  const entries = [
    app("网易云音乐", "/Applications/NeteaseMusic.app"),
    app("磁盘工具", "/System/Applications/Utilities/Disk Utility.app"),
    app("字体册", "/System/Applications/Font Book.app"),
    app("钥匙串访问", "/System/Applications/Utilities/Keychain Access.app"),
    app("招商银行", "/Applications/CMB.app"),
    app("计算器", "/System/Applications/Calculator.app"),
  ];

  it("finds each by its whole pinyin first, and by its first letters", () => {
    for (const entry of entries) {
      const [full, initials] = hxPinyinTyped(entry.title);
      expect(hxSearch(entries, full ?? "", { kinds: ["app"] })[0]?.entry.id, entry.title).toBe(entry.id);
      if (initials) {
        const found = hxSearch(entries, initials, { kinds: ["app"] }).map((hit) => hit.entry.id);
        expect(found, entry.title).toContain(entry.id);
      }
    }
  });
});
