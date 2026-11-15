import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HxComputerActions } from "./actions";
import { HxCatalog } from "./catalog";
import { hxChineseSystem, hxComputer, hxComputerAllowed, hxComputerPlatform } from "./computer";
import type { HxRunner } from "./runner";
import {
  HX_COMPUTER_TOOL_DEFINITIONS,
  HX_COMPUTER_TOOL_NAMES,
  type HxComputerAllowed,
  hxComputerToolCall,
} from "./tools";

/** What the tests read of an answer; the other fields stay as they are. */
const Body = z.looseObject({ status: z.string(), reason: z.string().optional() });

function setup() {
  const state = { volume: 50 };
  const opened: string[] = [];
  const run: HxRunner = async (command, args) => {
    const text = args[args.length - 1] ?? "";
    if (command === "/usr/bin/open") opened.push(text);
    if (text === "output volume of (get volume settings)") {
      return { code: 0, stdout: `${state.volume}\n`, stderr: "", timedOut: false, missing: false };
    }
    const volume = /^set volume output volume (\d+)$/u.exec(text);
    if (volume?.[1]) state.volume = Number(volume[1]);
    return { code: 0, stdout: "", stderr: "", timedOut: false, missing: false };
  };
  const catalog = new HxCatalog({
    platform: "mac",
    run,
    home: "/nowhere",
    dataFolder: () => null,
    chineseFirst: true,
    verified: true,
    now: () => 1,
  });
  const actions = new HxComputerActions(catalog, run);
  const lines: string[] = [];
  const call = async (tool: string, args: unknown, allowed: HxComputerAllowed = "yes") => {
    const result = await hxComputerToolCall(actions, allowed, { tool, arguments: args }, (line) => lines.push(line));
    const item = result.contentItems[0];
    const body = Body.parse(JSON.parse(item?.type === "inputText" ? item.text : "{}"));
    return { success: result.success, body, items: result.contentItems.length };
  };
  return { call, lines, opened, state, actions };
}

describe("the three tools", () => {
  it("are declared with a name, a description and a shape each", () => {
    // v1.6.7 added computer_plan, computer_look and computer_do (step-tools.ts); v1.6.8 computer_install;
    // v1.6.9 computer_app and computer_run.
    expect(HX_COMPUTER_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "computer_find",
      "computer_open",
      "computer_set",
      "computer_install",
      "computer_app",
      "computer_run",
      "computer_plan",
      "computer_look",
      "computer_do",
    ]);
    expect([...HX_COMPUTER_TOOL_NAMES].sort()).toEqual([
      "computer_app",
      "computer_do",
      "computer_find",
      "computer_install",
      "computer_look",
      "computer_open",
      "computer_plan",
      "computer_run",
      "computer_set",
    ]);
    for (const tool of HX_COMPUTER_TOOL_DEFINITIONS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(80);
      expect(tool.description.length, tool.name).toBeLessThan(420);
      expect(Object.keys(tool.shape).length, tool.name).toBeGreaterThan(0);
    }
  });

  it("refuse everything when Computer Use is off for the agent", async () => {
    const { call, opened, lines } = setup();
    for (const [tool, args] of [
      ["computer_find", { query: "蓝牙" }],
      ["computer_open", { id: "page:bluetooth" }],
      ["computer_set", { id: "setting:volume", value: "10" }],
    ] as const) {
      const result = await call(tool, args, "off");
      expect(result.success, tool).toBe(false);
      expect(result.body.status, tool).toBe("refused");
      expect(result.body.reason, tool).toContain("Computer Use is off for this agent");
    }
    expect(opened).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("refuse everything in a task of the agent, as the Computer Use tools are not there either", async () => {
    const { call, opened, lines, state } = setup();
    for (const [tool, args] of [
      ["computer_find", { query: "蓝牙" }],
      ["computer_open", { id: "page:bluetooth" }],
      ["computer_open", { url: "https://bot.hxallai.com" }],
      ["computer_set", { id: "setting:volume", value: "10" }],
    ] as const) {
      const result = await call(tool, args, "task");
      expect(result.success, tool).toBe(false);
      expect(result.body.status, tool).toBe("refused");
      expect(result.body.reason, tool).toContain("A task runs without Computer Use");
      expect(result.body.reason, tool).toContain("your own chat");
    }
    expect(opened).toEqual([]);
    expect(lines).toEqual([]);
    expect(state.volume).toBe(50);
  });

  it("find, and answer in one line of JSON", async () => {
    const { call } = setup();
    const found = await call("computer_find", { query: "蓝牙", kinds: ["page"], limit: 2 });
    expect(found).toMatchObject({ success: true, items: 1, body: { status: "found" } });
    const missing = await call("computer_find", { query: "zzz nothing", kinds: ["page"] });
    expect(missing).toMatchObject({ success: true, body: { status: "not-found" } });
  });

  it("open, and write what was opened to the record", async () => {
    const { call, opened, lines } = setup();
    expect(await call("computer_open", { query: "蓝牙设置" })).toMatchObject({
      success: true,
      body: { status: "opened" },
    });
    expect(await call("computer_open", { url: "https://bot.hxallai.com/" })).toMatchObject({ success: true });
    expect(await call("computer_open", { query: "自动隐藏" })).toMatchObject({
      success: true,
      body: { status: "candidates" },
    });
    expect(await call("computer_open", { query: "zzz nothing" })).toMatchObject({
      success: true,
      body: { status: "not-found" },
    });
    expect(await call("computer_open", { url: "file:///etc/passwd" })).toMatchObject({
      success: false,
      body: { status: "refused" },
    });
    expect(opened).toEqual(["x-apple.systempreferences:com.apple.BluetoothSettings", "https://bot.hxallai.com/"]);
    expect(lines).toEqual(["computer_open 蓝牙", "computer_open https://bot.hxallai.com/"]);
  });

  it("set, and write a change with the earlier value to the record", async () => {
    const { call, lines, state } = setup();
    expect(await call("computer_set", { query: "音量" })).toMatchObject({
      success: true,
      body: { status: "value", value: "50" },
    });
    expect(await call("computer_set", { id: "setting:volume", value: "20" })).toMatchObject({
      success: true,
      body: { status: "changed", previous: "50", value: "20" },
    });
    expect(await call("computer_set", { id: "setting:volume", value: "20" })).toMatchObject({
      body: { status: "unchanged" },
    });
    expect(await call("computer_set", { id: "setting:volume", value: "x" })).toMatchObject({
      success: true,
      body: { status: "invalid-value" },
    });
    expect(state.volume).toBe(20);
    expect(lines).toEqual(["computer_set 音量: 50 → 20"]);
  });

  it("refuse arguments that are not the ones declared", async () => {
    const { call, opened } = setup();
    for (const [tool, args] of [
      ["computer_find", {}],
      ["computer_find", { query: "" }],
      ["computer_find", { query: "a", kinds: ["file"] }],
      ["computer_find", { query: "a", limit: 0 }],
      ["computer_open", { id: 5 }],
      ["computer_open", { query: "a", extra: true }],
      ["computer_open", null],
      ["computer_set", { id: "setting:volume", value: 20 }],
      ["computer_set", "volume"],
    ] as const) {
      const result = await call(tool, args);
      expect(result.success, `${tool} ${JSON.stringify(args)}`).toBe(false);
      expect(result.body.status, `${tool} ${JSON.stringify(args)}`).toBe("invalid");
    }
    expect(await call("computer_open", {})).toMatchObject({ success: false, body: { status: "invalid" } });
    expect(await call("computer_other", {})).toMatchObject({ success: false, body: { status: "invalid" } });
    expect(opened).toEqual([]);
  });

  it("open a web address and a folder, and record each", async () => {
    const { call, opened, lines } = setup();
    expect(await call("computer_open", { url: "https://bot.hxallai.com/guide" })).toMatchObject({
      success: true,
      body: { status: "opened" },
    });
    expect(await call("computer_open", { path: "/" })).toMatchObject({ success: true, body: { status: "opened" } });
    expect(await call("computer_open", { url: "file:///etc/passwd" })).toMatchObject({
      success: false,
      body: { status: "refused" },
    });
    expect(opened).toEqual(["https://bot.hxallai.com/guide", "/"]);
    expect(lines).toEqual(["computer_open https://bot.hxallai.com/guide", "computer_open /"]);
  });

  it("work without anyone to record what they did", async () => {
    const { actions, state } = setup();
    const opened = await hxComputerToolCall(actions, "yes", {
      tool: "computer_open",
      arguments: { id: "page:bluetooth" },
    });
    expect(opened.success).toBe(true);
    const changed = await hxComputerToolCall(actions, "yes", {
      tool: "computer_set",
      arguments: { id: "setting:volume", value: "20" },
    });
    expect(changed.success).toBe(true);
    expect(state.volume).toBe(20);
  });

  it("answer instead of failing when something inside throws", async () => {
    const { actions } = setup();
    actions.find = () => Promise.reject(new Error("the disk is gone"));
    const result = await hxComputerToolCall(actions, "yes", { tool: "computer_find", arguments: { query: "a" } });
    expect(result.success).toBe(false);
    expect(result.contentItems[0]).toEqual({
      type: "inputText",
      text: '{"status":"failed","reason":"the disk is gone"}',
    });
    actions.find = () => Promise.reject("not an error");
    const other = await hxComputerToolCall(actions, "yes", { tool: "computer_find", arguments: { query: "a" } });
    expect(other.contentItems[0]).toEqual({
      type: "inputText",
      text: '{"status":"failed","reason":"It did not work."}',
    });
  });
});

describe("the entry of the app", () => {
  it("knows which systems have a catalog", () => {
    expect(hxComputerPlatform("darwin")).toBe("mac");
    expect(hxComputerPlatform("win32")).toBe("windows");
    expect(hxComputerPlatform("linux")).toBeNull();
  });

  it("knows a system that is used in Chinese", () => {
    expect(hxChineseSystem("zh-CN")).toBe(true);
    expect(hxChineseSystem("ZH-Hant-TW")).toBe(true);
    expect(hxChineseSystem("en-US")).toBe(false);
  });

  it("tells Settings about the catalog without starting a scan", async () => {
    // Whatever system runs this test: the shape is the same, and before a scan there are no apps.
    const status = await hxComputer.status();
    expect(status.platform).toBe(hxComputerPlatform(process.platform));
    expect(status.builtAt).toBeNull();
    expect(status.apps).toBe(0);
    expect(status.disabled).toEqual([]);
    expect(status.directSettings).toBe(status.settings);
    if (status.platform === null) expect(status).toMatchObject({ pages: 0, settings: 0 });
    else expect(status.pages).toBeGreaterThan(30);
  });

  it("refuses a tool call that has no agent", async () => {
    const result = await hxComputer.toolCall(null, { tool: "computer_find", arguments: { query: "a" } });
    expect(result.success).toBe(false);
    const off = await hxComputer.toolCall(
      { name: "A", computerUse: false, inTask: false },
      { tool: "computer_open", arguments: { query: "a" } },
    );
    expect(off.success).toBe(false);
    const task = await hxComputer.toolCall(
      { name: "A", computerUse: true, inTask: true },
      { tool: "computer_open", arguments: { query: "a" } },
    );
    expect(task.success).toBe(false);
    expect(task.contentItems[0]).toMatchObject({ type: "inputText" });
  });

  it("allows the tools where the Computer Use tools are: the agent's own chat and its routines", () => {
    expect(hxComputerAllowed(null)).toBe("off");
    expect(hxComputerAllowed({ computerUse: false, inTask: false })).toBe("off");
    // Off for the agent wins: a task of an agent without Computer Use is told to ask for the setting.
    expect(hxComputerAllowed({ computerUse: false, inTask: true })).toBe("off");
    expect(hxComputerAllowed({ computerUse: true, inTask: true })).toBe("task");
    expect(hxComputerAllowed({ computerUse: true, inTask: false })).toBe("yes");
  });
});
