import type { DynamicRecord } from "@hxbot/contracts/runtime-values";
import { describe, expect, it } from "vitest";
import { hxElementScore, hxFindElement, hxOutline, hxPlainName, hxReadWindow, hxRoleKind } from "./outline";

// HXBot 电脑操控（二）：窗口提纲和按“类型 + 名字”找控件（outline.ts）。

const element = (index: number, role: string, label: string, extra: DynamicRecord = {}) => ({
  element_index: index,
  element_token: `t${index}`,
  role,
  label,
  depth: 1,
  frame: { x: index * 10, y: 20, w: 80, h: 24 },
  ...extra,
});

function window(elements: unknown[], extra: DynamicRecord = {}) {
  const read = hxReadWindow({ pid: 42, window_id: 7, app_name: "Notes", window_title: "Draft", elements, ...extra });
  if (!read) throw new Error("no window");
  return read;
}

describe("reading a window", () => {
  it("keeps what the steps use and drops what is not an element", () => {
    const read = window([
      element(0, "AXButton", "Export", { enabled: false, actions: ["AXPress"] }),
      { role: "AXGroup" },
      "not an element",
      element(3, "AXTextField", "", { value: "hello" }),
    ]);
    expect(read.pid).toBe(42);
    expect(read.windowId).toBe(7);
    expect(read.elements.map((item) => item.index)).toEqual([0, 3]);
    expect(read.elements[0]).toMatchObject({ token: "t0", enabled: false, actions: ["AXPress"] });
    expect(read.elements[1]?.value).toBe("hello");
    expect(read.complete).toBe(true);
    expect(hxReadWindow({ window_id: 1 })).toBeNull();
    expect(hxReadWindow(null)).toBeNull();
  });

  it("says when the driver did not read the whole window", () => {
    expect(window([], { truncated: true }).complete).toBe(false);
    expect(window([], { elements_complete: false }).complete).toBe(false);
  });
});

describe("kinds and names", () => {
  it("gives one kind to the roles of each platform", () => {
    expect(hxRoleKind("AXButton")).toBe("button");
    expect(hxRoleKind("Button")).toBe("button");
    expect(hxRoleKind("push button")).toBe("button");
    expect(hxRoleKind("AXTextField")).toBe("field");
    expect(hxRoleKind("Edit")).toBe("field");
    expect(hxRoleKind("AXMenuItem")).toBe("menu");
    expect(hxRoleKind("ListItem")).toBe("row");
    expect(hxRoleKind("field")).toBe("field");
    expect(hxRoleKind("AXUnknownThing")).toBe("unknownthing");
  });

  it("compares names with no case, spaces or punctuation, in any script", () => {
    expect(hxPlainName(" Save As… ")).toBe("saveas");
    expect(hxPlainName("导出为 PDF")).toBe("导出为pdf");
    expect(hxPlainName("ＳＥＮＤ")).toBe("send");
  });
});

describe("finding an element", () => {
  const read = window([
    element(0, "AXButton", "Export"),
    element(1, "AXButton", "Export as PDF"),
    element(2, "AXStaticText", "Export"),
    element(3, "AXTextField", "Search"),
    element(4, "AXButton", "发送"),
    element(5, "AXButton", "Cancel", { enabled: false }),
  ]);

  it("finds the one an exact name and kind mean", () => {
    const found = hxFindElement(read, { name: "Export", role: "button" });
    expect(found.status === "found" && found.element.index).toBe(0);
  });

  it("prefers the element that can act when a text has the same name", () => {
    const found = hxFindElement(read, { name: "export" });
    expect(found.status === "found" && found.element.index).toBe(0);
  });

  it("takes any of several forms of the name", () => {
    const found = hxFindElement(read, { name: ["Senden", "发送"] });
    expect(found.status === "found" && found.element.index).toBe(4);
  });

  it("answers the candidates when two fit as well, and does not guess", () => {
    const close = window([element(0, "AXButton", "Save"), element(1, "AXButton", "Save")]);
    const found = hxFindElement(close, { name: "Save" });
    expect(found.status).toBe("several");
    expect(found.status !== "found" && found.candidates.map((item) => item.index)).toEqual([0, 1]);
  });

  it("answers none when nothing fits well, with what came closest", () => {
    const found = hxFindElement(read, { name: "Print" });
    expect(found.status).toBe("none");
    // A name inside one label only is enough: "PDF" is in "Export as PDF" and nowhere else.
    const part = hxFindElement(read, { name: "PDF" });
    expect(part.status === "found" && part.element.index).toBe(1);
  });

  it("finds the only element of a kind when no name is given, as the text area of an editor", () => {
    const found = hxFindElement(read, { role: "field" });
    expect(found.status === "found" && found.element.index).toBe(3);
    const two = hxFindElement(read, { role: "button" });
    expect(two.status).toBe("several");
    expect(hxFindElement(read, { role: "slider" }).status).toBe("none");
  });

  it("finds an element by the index of the last outline", () => {
    const found = hxFindElement(read, { index: 3 });
    expect(found.status === "found" && found.element.label).toBe("Search");
    expect(hxFindElement(read, { index: 99 }).status).toBe("none");
  });

  it("scores a turned-off element lower", () => {
    const off = read.elements.find((item) => item.index === 5);
    if (!off) throw new Error("no element");
    expect(hxElementScore(off, { name: "Cancel" })).toBeLessThan(10);
  });
});

describe("the outline", () => {
  it("has one short line per element to act on or read, and the window first", () => {
    const outline = hxOutline(
      window([
        element(0, "AXButton", "Export"),
        element(1, "AXGroup", ""),
        element(2, "AXTextField", "Name", { value: "Report" }),
        element(3, "AXButton", "Hidden", { frame: { x: 0, y: 0, w: 0, h: 0 } }),
      ]),
    );
    const lines = outline.split("\n");
    expect(lines[0]).toBe("Notes — Draft (pid 42, window 7)");
    expect(outline).toContain('[0] button "Export"');
    expect(outline).toContain('[2] field "Name" = "Report"');
    expect(outline).not.toContain("[1]");
    expect(outline).not.toContain("Hidden");
  });

  it("stops at its size and counts what it left out", () => {
    const many = Array.from({ length: 400 }, (_, i) => element(i, "AXButton", `Button number ${i}`));
    const outline = hxOutline(window(many), 1000);
    expect(outline.length).toBeLessThan(1100);
    expect(outline).toMatch(/… \d+ more elements; give query to see fewer\./u);
  });
});
