import { describe, expect, it } from "vitest";
import type { DynamicToolCallParams } from "../protocol";
import { hxNoToolMatch } from "./hx-tool-search";
import { discoverTools } from "./tool-catalog";

function search(args: unknown, provider: "codex" | "pi" = "pi") {
  const params: DynamicToolCallParams = {
    threadId: "t1",
    turnId: "u1",
    callId: "c1",
    namespace: "hxbot",
    tool: "tool_search",
    arguments: args,
  };
  return discoverTools(params, provider);
}

function names(result: ReturnType<typeof search>): string[] {
  return result.tools.map((tool) => tool.name);
}

describe("tool_search (HXBot additions)", () => {
  it("lists every tool by group for an empty search", () => {
    for (const args of [{}, { query: "" }, { queries: [" ", '""'] }, { query: "「」" }]) {
      const result = search(args);
      expect(result.tools).toEqual([]);
      const groups = "groups" in result && Array.isArray(result.groups) ? result.groups.join(" ") : "";
      expect(groups).toContain("hxbot.{");
      expect(groups).toContain("capture_screen");
    }
  });

  it("finds the screen capture tool for screenshot words in English and Chinese", () => {
    // "screenshot" is also the exact name of the browser page tool, which stays first.
    for (const query of ["screenshot", '"screenshot"', "screen capture"]) {
      expect(names(search({ query })).slice(0, 2)).toContain("hxbot.capture_screen");
    }
    for (const query of ["截图", "帮我截屏"]) {
      expect(names(search({ query }))[0]).toBe("hxbot.capture_screen");
    }
  });

  it("finds the step tools for mouse, keyboard and quit words", () => {
    expect(names(search({ query: "鼠标点击" }))).toContain("hxbot.computer_do");
    expect(names(search({ query: "键盘输入快捷键" }))).toContain("hxbot.computer_do");
    expect(names(search({ query: "关闭应用" }))).toContain("hxbot.computer_app");
    expect(names(search({ query: "默认浏览器" }))).toContain("hxbot.computer_app");
  });

  it("finds the app commands and the scripts of v1.6.9", () => {
    expect(names(search({ query: "强制退出微信" }))).toContain("hxbot.computer_app");
    expect(names(search({ query: "窗口分屏" }))).toContain("hxbot.computer_app");
    expect(names(search({ query: "菜单命令" }))).toContain("hxbot.computer_app");
    expect(names(search({ query: "run an AppleScript" }))).toContain("hxbot.computer_run");
    expect(names(search({ query: "运行快捷指令" }))).toContain("hxbot.computer_run");
  });

  it("names the nearest tools and the next step when nothing matches", () => {
    const result = search({ query: "screnshoot" });
    expect("note" in result && result.note).toContain("HXBot has no tool by these words");
    expect("note" in result && result.note).toContain("hxbot.computer_find");
    expect(names(result).length).toBeLessThanOrEqual(3);
    const none = search({ query: "完全没有的功能" });
    expect(none.tools).toEqual([]);
    expect("note" in none && none.note).toContain('"完全没有的功能"');
  });

  it("says when a tool is for another provider, not missing", () => {
    const web = { namespace: "hxbot", tool: "web_search", name: "hxbot.web_search", description: "Search the web." };
    const own = { namespace: "hxbot", tool: "list_tables", name: "hxbot.list_tables", description: "Tables." };
    const result = hxNoToolMatch(["web search"], new Set(["web", "search"]), [own], [own, web]);
    expect(result.note).toContain("hxbot.web_search is not for this agent's provider");
  });

  it("keeps the usual results for a usual search", () => {
    expect(names(search({ query: "computer_plan" }))[0]).toBe("hxbot.computer_plan");
    expect(names(search({ queries: ["list tables"] }))).toContain("hxbot.list_tables");
  });
});
