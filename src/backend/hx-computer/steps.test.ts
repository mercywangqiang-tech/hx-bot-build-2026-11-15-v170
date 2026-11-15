import type { DynamicRecord } from "@hxbot/contracts/runtime-values";
import { describe, expect, it } from "vitest";
import type { HxDriverAnswer, HxDriverPort } from "./driver";
import { HxComputerStops, type HxStep, HxStepRun, hxChooseWindow, hxRiskyLabel } from "./steps";

// HXBot 电脑操控（二）：一步步操作一个窗口（steps.ts），用一个假的驱动。

interface Call {
  tool: string;
  args: DynamicRecord;
}

type Reply = (args: DynamicRecord, calls: readonly Call[]) => HxDriverAnswer;

const ok = (content: DynamicRecord): HxDriverAnswer => ({ ok: true, content, text: "", error: null });
const effect = (value: string, extra: DynamicRecord = {}) => ok({ effect: value, route: "accessibility", ...extra });

const WINDOWS = {
  windows: [
    {
      pid: 1,
      window_id: 10,
      app_name: "HXBot",
      title: "HXBot",
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
      is_on_screen: true,
      z_index: 9,
    },
    {
      pid: 2,
      window_id: 20,
      app_name: "Notes",
      title: "Draft",
      bounds: { x: 0, y: 0, width: 900, height: 700 },
      is_on_screen: true,
      z_index: 5,
    },
    {
      pid: 2,
      window_id: 21,
      app_name: "Notes",
      title: "",
      bounds: { x: 0, y: 0, width: 40, height: 20 },
      is_on_screen: true,
      z_index: 8,
    },
    {
      pid: 3,
      window_id: 30,
      app_name: "Mail",
      title: "Inbox",
      bounds: { x: 0, y: 0, width: 900, height: 700 },
      is_on_screen: true,
      z_index: 3,
    },
  ],
};

const ELEMENTS = {
  pid: 2,
  window_id: 20,
  app_name: "Notes",
  window_title: "Draft",
  elements: [
    {
      element_index: 0,
      element_token: "tok-export",
      role: "AXButton",
      label: "Export",
      depth: 1,
      frame: { x: 100, y: 50, w: 80, h: 20 },
    },
    {
      element_index: 1,
      element_token: "tok-title",
      role: "AXTextField",
      label: "Title",
      depth: 1,
      frame: { x: 10, y: 10, w: 200, h: 20 },
    },
    {
      element_index: 2,
      element_token: "tok-delete",
      role: "AXButton",
      label: "Delete note",
      depth: 1,
      frame: { x: 300, y: 50, w: 80, h: 20 },
    },
    {
      element_index: 3,
      element_token: null,
      role: "AXButton",
      label: "Share",
      depth: 1,
      frame: { x: 400, y: 50, w: 60, h: 20 },
    },
  ],
};

class FakeDriver implements HxDriverPort {
  readonly calls: Call[] = [];
  readonly #replies: Record<string, Reply>;

  constructor(replies: Record<string, Reply> = {}) {
    this.#replies = replies;
  }

  call(tool: string, args: DynamicRecord): Promise<HxDriverAnswer> {
    this.calls.push({ tool, args });
    const reply = this.#replies[tool];
    if (reply) return Promise.resolve(reply(args, this.calls));
    if (tool === "list_windows") return Promise.resolve(ok(WINDOWS));
    if (tool === "get_window_state") return Promise.resolve(ok(ELEMENTS));
    if (tool === "verify_state") return Promise.resolve(ok({ status: "satisfied" }));
    return Promise.resolve(effect("confirmed", { delivery: { mode: "background" } }));
  }

  tools(): string[] {
    return this.calls.map((call) => call.tool);
  }
}

async function runOn(driver: FakeDriver, steps: HxStep[], stopped = () => false) {
  const run = new HxStepRun({ driver, stopped, wait: () => Promise.resolve() });
  expect(await run.open({ app: "notes" })).toBeNull();
  return run.run(steps);
}

describe("choosing the window", () => {
  it("takes the app's biggest front window, never HXBot's own or a small helper", () => {
    expect(hxChooseWindow(WINDOWS, { app: "Notes" })?.windowId).toBe(20);
    expect(hxChooseWindow(WINDOWS, {})?.windowId).toBe(20);
    expect(hxChooseWindow(WINDOWS, { app: "Mail", title: "inbox" })?.windowId).toBe(30);
    expect(hxChooseWindow(WINDOWS, { windowId: 30 })?.app).toBe("Mail");
    expect(hxChooseWindow(WINDOWS, { app: "Calendar" })).toBeNull();
    expect(hxChooseWindow(WINDOWS, { windowId: 10 })).toBeNull();
  });

  it("answers no_window and no_driver before any step", async () => {
    const none = new HxStepRun({ driver: new FakeDriver(), stopped: () => false });
    expect(await none.open({ app: "Calendar" })).toBe("no_window");
    const down = new HxStepRun({
      driver: new FakeDriver({ list_windows: () => ({ ok: false, content: null, text: "", error: "not running" }) }),
      stopped: () => false,
    });
    expect(await down.open({})).toBe("no_driver");
  });
});

describe("clicking", () => {
  it("clicks the element by its token in the background, and the window is the target", async () => {
    const driver = new FakeDriver();
    const result = await runOn(driver, [{ act: "click", target: { name: "Export", role: "button" } }]);
    expect(result.status).toBe("done");
    expect(result.steps).toEqual([{ n: 1, act: "click", what: "Export", route: "background", checked: true }]);
    expect(result.borrowedScreen).toBe(false);
    const click = driver.calls.find((call) => call.tool === "click");
    expect(click?.args).toEqual({
      target: { kind: "window", pid: 2, window_id: 20 },
      element_token: "tok-export",
      delivery_mode: "background",
    });
  });

  it("goes to the foreground when the background does not work, and says the screen was borrowed", async () => {
    const driver = new FakeDriver({
      click: (args) =>
        args.delivery_mode === "background"
          ? effect("refused", {
              error: { code: "route_unavailable" },
              escalation: { target: "foreground", reason: "route_unavailable" },
            })
          : effect("unverifiable", { delivery: { mode: "foreground" } }),
    });
    const result = await runOn(driver, [{ act: "double_click", target: { name: "Export" } }]);
    expect(result.status).toBe("done");
    expect(result.steps[0]).toMatchObject({ route: "foreground", checked: false });
    expect(result.borrowedScreen).toBe(true);
    expect(
      driver.calls.filter((call) => call.tool === "click").map((call) => [call.args.delivery_mode, call.args.count]),
    ).toEqual([
      ["background", 2],
      ["foreground", 2],
    ]);
  });

  it("clicks at the element's middle when it has no token", async () => {
    const driver = new FakeDriver();
    const result = await runOn(driver, [{ act: "right_click", target: { name: "Share" } }]);
    expect(result.steps[0]?.route).toBe("point");
    const click = driver.calls.find((call) => call.tool === "click");
    expect(click?.args).toMatchObject({ x: 430, y: 60, button: "right", delivery_mode: "background" });
  });

  it("stops with the candidates when the name fits nothing, and does not click", async () => {
    const driver = new FakeDriver();
    const result = await runOn(driver, [{ act: "click", target: { name: "Print", role: "button" } }]);
    expect(result.status).toBe("failed");
    expect(result.stoppedAt?.n).toBe(1);
    expect(result.stoppedAt?.reason).toContain("No element fits");
    expect(driver.tools()).not.toContain("click");
  });
});

describe("sends, payments and deletions", () => {
  it("knows the words in Chinese and English", () => {
    expect(hxRiskyLabel("发送")).toBe(true);
    expect(hxRiskyLabel("删除文件")).toBe(true);
    expect(hxRiskyLabel("Send now")).toBe(true);
    expect(hxRiskyLabel("Pay")).toBe(true);
    expect(hxRiskyLabel("Move to Trash")).toBe(true);
    expect(hxRiskyLabel("Export")).toBe(false);
    expect(hxRiskyLabel("确认发送")).toBe(true);
    expect(hxRiskyLabel("Sender list")).toBe(false);
    expect(hxRiskyLabel("Order history")).toBe(false);
    expect(hxRiskyLabel("Place order")).toBe(true);
    expect(hxRiskyLabel("")).toBe(false);
  });

  it("stops before such a click until the step is confirmed", async () => {
    const driver = new FakeDriver();
    const asked = await runOn(driver, [{ act: "click", target: { name: "Delete note" } }]);
    expect(asked.status).toBe("confirm");
    expect(asked.stoppedAt?.reason).toContain("Ask the user");
    expect(driver.tools()).not.toContain("click");
    const confirmed = await runOn(new FakeDriver(), [
      { act: "click", target: { name: "Delete note" }, confirmed: true },
    ]);
    expect(confirmed.status).toBe("done");
  });

  it("stops before such a menu item too", async () => {
    const driver = new FakeDriver();
    const result = await runOn(driver, [{ act: "menu", path: ["File", "Delete"] }]);
    expect(result.status).toBe("confirm");
    expect(driver.tools()).not.toContain("invoke_menu");
  });
});

describe("typing, keys and menus", () => {
  it("clicks the field in the foreground first, then types into the window", async () => {
    const driver = new FakeDriver({ click: () => effect("confirmed", { delivery: { mode: "foreground" } }) });
    const result = await runOn(driver, [{ act: "type", target: { name: "Title" }, text: "季度报告" }]);
    expect(result.status).toBe("done");
    expect(result.steps[0]?.what).toBe("Title: 4 characters");
    const tools = driver.tools();
    expect(tools.indexOf("click")).toBeLessThan(tools.indexOf("type_text"));
    expect(driver.calls.find((call) => call.tool === "click")?.args.delivery_mode).toBe("foreground");
    // The field was clicked in the foreground, so the text goes to the app in front.
    expect(driver.calls.find((call) => call.tool === "type_text")?.args).toEqual({
      text: "季度报告",
      target: { kind: "desktop", display_id: "primary" },
    });
    expect(result.borrowedScreen).toBe(true);
  });

  it("checks that the text shows in the field, and sends the next keys to the app in front", async () => {
    let value = "HXBot check";
    const driver = new FakeDriver({
      get_window_state: () =>
        ok({
          ...ELEMENTS,
          elements: ELEMENTS.elements.map((item) => (item.element_index === 1 ? { ...item, value } : item)),
        }),
      type_text: (args) => {
        value = `${value} ${String(args.text)}`;
        return effect("unverifiable");
      },
    });
    const result = await runOn(driver, [
      { act: "type", target: { name: "Title" }, text: "季度报告" },
      { act: "hotkey", keys: ["ctrl", "s"] },
    ]);
    expect(result.status).toBe("done");
    expect(result.steps[0]?.checked).toBe(true);
    expect(driver.calls.find((call) => call.tool === "hotkey")?.args.target).toEqual({
      kind: "desktop",
      display_id: "primary",
    });
  });

  it("sends no keys and takes no front when the user moved to another app (v1.7.0)", async () => {
    const driver = new FakeDriver();
    const seen: string[] = [];
    const front = {
      front: () => Promise.resolve({ pid: 999, windowId: 9990 }),
      releaseModifiers: () => {
        seen.push("release");
        return Promise.resolve();
      },
    };
    const run = new HxStepRun({ driver, stopped: () => false, wait: () => Promise.resolve(), front });
    expect(await run.open({ app: "notes" })).toBeNull();
    const result = await run.run([
      { act: "click", target: { name: "Title" } },
      { act: "type", target: { name: "Title" }, text: "季度报告" },
    ]);
    expect(result.status).toBe("failed");
    expect(result.stoppedAt?.reason).toContain("did not send the keys");
    expect(result.stoppedAt?.reason).toContain("did not take the front");
    expect(driver.tools()).not.toContain("type_text");
    // No key was sent, so there is nothing to let go of.
    expect(seen).not.toContain("release");
  });

  it("counts the target's window in front as the target, also from another process (v1.7.0)", async () => {
    const driver = new FakeDriver({ type_text: () => effect("unverifiable") });
    // Windows: a framed app's window belongs to the frame host, another process.
    const front = {
      front: () => Promise.resolve({ pid: 77, windowId: 20 }),
      releaseModifiers: () => Promise.resolve(),
    };
    const run = new HxStepRun({ driver, stopped: () => false, wait: () => Promise.resolve(), front });
    expect(await run.open({ app: "notes" })).toBeNull();
    const result = await run.run([{ act: "type", target: { name: "Title" }, text: "x" }]);
    expect(result.status).not.toBe("failed");
    expect(driver.tools()).toContain("type_text");
  });

  it("types while the target is in front, then lets go of the modifiers (v1.7.0)", async () => {
    const driver = new FakeDriver({ type_text: () => effect("unverifiable") });
    const seen: string[] = [];
    const front = {
      front: () => {
        seen.push("look");
        // Notes, the target window's app.
        return Promise.resolve({ pid: 2, windowId: null });
      },
      releaseModifiers: () => {
        seen.push("release");
        return Promise.resolve();
      },
    };
    const run = new HxStepRun({ driver, stopped: () => false, wait: () => Promise.resolve(), front });
    expect(await run.open({ app: "notes" })).toBeNull();
    const result = await run.run([
      { act: "type", target: { name: "Title" }, text: "x" },
      { act: "hotkey", keys: ["ctrl", "s"] },
    ]);
    expect(result.status).not.toBe("failed");
    expect(driver.tools()).toContain("type_text");
    // One look holds for the hotkey right after it.
    expect(seen).toEqual(["look", "release"]);
  });

  it("puts the user's copy back on the clipboard when the typing changed it (v1.7.0)", async () => {
    let board = "the user's copy";
    const driver = new FakeDriver({
      type_text: () => {
        board = "typed through the clipboard";
        return effect("unverifiable");
      },
    });
    const clipboard = {
      save: () => {
        const kept = board;
        return Promise.resolve({
          changed: () => Promise.resolve(board !== kept),
          putBack: () => {
            board = kept;
            return Promise.resolve();
          },
        });
      },
    };
    const run = new HxStepRun({ driver, stopped: () => false, wait: () => Promise.resolve(), clipboard });
    expect(await run.open({ app: "notes" })).toBeNull();
    const result = await run.run([{ act: "type", target: { name: "Title" }, text: "x" }]);
    expect(result.status).not.toBe("failed");
    expect(board).toBe("the user's copy");
  });

  it("fails the step when the text does not show in the field", async () => {
    const driver = new FakeDriver({
      get_window_state: () =>
        ok({
          ...ELEMENTS,
          elements: ELEMENTS.elements.map((item) => (item.element_index === 1 ? { ...item, value: "old" } : item)),
        }),
      type_text: () => effect("unverifiable"),
    });
    const result = await runOn(driver, [{ act: "type", target: { name: "Title" }, text: "季度报告" }]);
    expect(result.status).toBe("failed");
    expect(result.stoppedAt?.reason).toContain("did not reach the field");
  });

  it("presses keys and chords on the window", async () => {
    const driver = new FakeDriver();
    const result = await runOn(driver, [
      { act: "key", key: "return", modifiers: ["cmd"] },
      { act: "hotkey", keys: ["cmd", "s"] },
    ]);
    expect(result.steps.map((step) => step.what)).toEqual(["cmd+return", "cmd+s"]);
    expect(driver.calls.find((call) => call.tool === "press_key")?.args).toMatchObject({
      key: "return",
      modifiers: ["cmd"],
    });
    expect(driver.calls.find((call) => call.tool === "hotkey")?.args).toMatchObject({ keys: ["cmd", "s"] });
  });

  it("runs a menu item by its path", async () => {
    const driver = new FakeDriver();
    const result = await runOn(driver, [{ act: "menu", path: ["文件", "导出为 PDF…"] }]);
    expect(result.steps[0]).toMatchObject({ route: "menu", what: "文件 › 导出为 PDF…" });
    expect(driver.calls.find((call) => call.tool === "invoke_menu")?.args).toEqual({
      pid: 2,
      window_id: 20,
      path: ["文件", "导出为 PDF…"],
    });
  });

  it("scrolls at the window's middle when no element is named", async () => {
    const driver = new FakeDriver();
    await runOn(driver, [{ act: "scroll", direction: "down", amount: 5 }]);
    expect(driver.calls.find((call) => call.tool === "scroll")?.args).toMatchObject({
      x: 450,
      y: 350,
      direction: "down",
      amount: 5,
    });
  });
});

describe("checking each step", () => {
  it("checks expect with the driver and counts the step as checked", async () => {
    const driver = new FakeDriver();
    const result = await runOn(driver, [
      { act: "click", target: { name: "Export" }, expect: { name: "Save as", role: "button" } },
    ]);
    expect(result.status).toBe("done");
    expect(result.steps[0]?.checked).toBe(true);
    expect(driver.calls.find((call) => call.tool === "verify_state")?.args).toMatchObject({
      pid: 2,
      window_id: 20,
      expect: [{ element: { selector: { label_contains: "Save as", role: "button" }, exists: true } }],
    });
  });

  it("stops when the window does not show what the step expects, and does not run the next step", async () => {
    const driver = new FakeDriver({ verify_state: () => ok({ status: "unsatisfied" }) });
    const result = await runOn(driver, [
      { act: "click", target: { name: "Export" }, expect: { name: "Save as" } },
      { act: "hotkey", keys: ["cmd", "s"] },
    ]);
    expect(result.status).toBe("failed");
    expect(result.stoppedAt).toMatchObject({ n: 1, act: "click" });
    expect(driver.tools()).not.toContain("hotkey");
  });

  it("reads the window itself when the driver cannot tell, and is unsure when the name is not there", async () => {
    const unknown = () => ok({ status: "unknown" });
    const found = await runOn(new FakeDriver({ verify_state: unknown }), [
      { act: "click", target: { name: "Share" }, expect: { name: "Export" } },
    ]);
    expect(found.status).toBe("done");
    const missing = await runOn(new FakeDriver({ verify_state: unknown }), [
      { act: "click", target: { name: "Share" }, expect: { name: "Saved" } },
    ]);
    expect(missing.status).toBe("unsure");
  });

  it("does not start a step after the user stopped the work", async () => {
    const stops = new HxComputerStops();
    const driver = new FakeDriver({
      click: () => {
        stops.stop(null);
        return effect("confirmed");
      },
    });
    const result = await runOn(
      driver,
      [
        { act: "click", target: { name: "Export" } },
        { act: "hotkey", keys: ["cmd", "s"] },
      ],
      () => stops.stopped("agent-1"),
    );
    expect(result.status).toBe("stopped");
    expect(result.steps).toHaveLength(1);
    expect(driver.tools()).not.toContain("hotkey");
    stops.releaseAll();
    expect(stops.stopped("agent-1")).toBe(false);
  });
});

describe("the stops", () => {
  it("stop one agent, or every agent", () => {
    const stops = new HxComputerStops();
    stops.stop("a");
    expect(stops.stopped("a")).toBe(true);
    expect(stops.stopped("b")).toBe(false);
    stops.stop(null);
    expect(stops.stopped("b")).toBe(true);
    stops.releaseAll();
    expect(stops.stopped("a")).toBe(false);
  });
});
