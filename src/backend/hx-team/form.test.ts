import { describe, expect, it } from "vitest";
import { hxFormFiles, hxFormTemplate, hxMissingParts, hxReadForm, hxSaysNothing } from "./form";

const ZH = [
  "目标：把三份报价单合并成一张表",
  "已完成：收齐了三份文件",
  "文件：/work/a.xlsx、/work/b.xlsx",
  "/work/c.xlsx",
  "未解决：无",
  "下一步：合并后检查金额",
  "不要碰：原始文件",
].join("\n");

describe("hxReadForm", () => {
  it("reads the six parts of a Chinese form, with lines that continue a part", () => {
    const form = hxReadForm(ZH);
    expect(form.goal).toBe("把三份报价单合并成一张表");
    expect(form.files).toBe("/work/a.xlsx、/work/b.xlsx\n/work/c.xlsx");
    expect(form.open).toBe("无");
    expect(form.avoid).toBe("原始文件");
    expect(hxMissingParts(ZH)).toEqual([]);
  });

  it("reads English labels with markdown bold, list marks and any case", () => {
    const text = [
      "- **Goal:** write the summary",
      "* done: notes are in the folder",
      "**Files**: none",
      "OPEN: which currency",
      "Next: draft it",
      "Avoid: the budget sheet",
    ].join("\n");
    const form = hxReadForm(text);
    expect(form.goal).toBe("write the summary");
    expect(form.done).toBe("notes are in the folder");
    expect(form.open).toBe("which currency");
    expect(hxMissingParts(text)).toEqual([]);
  });

  it("names the parts that are missing or empty, in the order of the form", () => {
    expect(hxMissingParts("目标：写摘要\n文件：\n下一步：交回")).toEqual(["done", "files", "open", "avoid"]);
    expect(hxMissingParts("Please write the summary.")).toEqual(["goal", "done", "files", "open", "next", "avoid"]);
  });

  it("does not take a longer word that starts with a label for the label", () => {
    expect(hxReadForm("文件夹：/work\n目标：x").files).toBeUndefined();
    expect(hxReadForm("子目标：x").goal).toBeUndefined();
  });
});

describe("hxFormFiles", () => {
  it("splits the files by line, comma and 、 and drops list marks, quotes and repeats", () => {
    expect(hxFormFiles(hxReadForm(ZH))).toEqual(["/work/a.xlsx", "/work/b.xlsx", "/work/c.xlsx"]);
    expect(hxFormFiles({ files: '- `/a.md`\n- "/b.md", /a.md' })).toEqual(["/a.md", "/b.md"]);
  });

  it("reads none, 无 and an absent part as no file", () => {
    expect(hxFormFiles({ files: "无" })).toEqual([]);
    expect(hxFormFiles({ files: "None." })).toEqual([]);
    expect(hxFormFiles({})).toEqual([]);
    expect(hxSaysNothing("暂无")).toBe(true);
    expect(hxSaysNothing("/a.md")).toBe(false);
  });
});

describe("hxFormTemplate", () => {
  it("gives a template that is itself a complete form once filled", () => {
    for (const language of ["zh", "en"] as const) {
      const filled = hxFormTemplate(language).replaceAll("…", "x");
      expect(hxMissingParts(filled)).toEqual([]);
    }
  });
});
