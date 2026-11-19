import type { DynamicRecord } from "@hxbot/contracts/runtime-values";
import { describe, expect, it } from "vitest";
import { type HxDriverAnswer, type HxDriverPort, hxReadDriverReply } from "./driver";
import type { HxGateStop, HxStepGate } from "./gate";
import { hxReadWindow } from "./outline";
import {
  actionEffect,
  type HxStep,
  type HxStepRecord,
  HxStepRun,
  hxFrontWindowOf,
  hxSnapshotOf,
  hxWindowsOf,
} from "./steps";

// HXBot 电脑操控（五）（v1.7.3，CU-06、CU-02、CU-01、CONC-05、CONC-06）：执行器补强。

interface Call {
  tool: string;
  args: DynamicRecord;
}

const ok = (content: DynamicRecord | null, extra: Partial<HxDriverAnswer> = {}): HxDriverAnswer => ({
  ok: true,
  content,
  text: "",
  error: null,
  ...extra,
});
const confirmed = () => ok({ effect: "confirmed", route: "accessibility", delivery: { mode: "background" } });

const WINDOWS = {
  windows: [
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
      window_id: 22,
      app_name: "Notes",
      title: "Other",
      bounds: { x: 0, y: 0, width: 900, height: 700 },
      is_on_screen: true,
      z_index: 7,
    },
  ],
};

function windowWith(fields: Array<{ index: number; role: string; label: string; value?: string; token?: string }>) {
  return {
    pid: 2,
    window_id: 20,
    app_name: "Notes",
    window_title: "Draft",
    elements: fields.map((field) => ({
      element_index: field.index,
      element_token: field.token ?? `tok-${field.index}`,
      role: field.role,
      label: field.label,
      ...(field.value === undefined ? {} : { value: field.value }),
      depth: 1,
      frame: { x: 10 * field.index, y: 10, w: 100, h: 20 },
    })),
  };
}

class Driver implements HxDriverPort {
  readonly calls: Call[] = [];
  /** The value the search field shows; set_value changes it when `takes` is true. */
  value = "";
  takes = true;
  verify = "satisfied";
  refuseClick: DynamicRecord | null = null;
  /** Every click on an element is refused, as macOS refuses a press on a text area. */
  refuseTokens = false;

  call(tool: string, args: DynamicRecord): Promise<HxDriverAnswer> {
    this.calls.push({ tool, args });
    if (tool === "list_windows") return Promise.resolve(ok(WINDOWS));
    if (tool === "get_window_state")
      return Promise.resolve(
        ok(
          windowWith([
            { index: 0, role: "AXSearchField", label: "Search", value: this.value },
            { index: 1, role: "AXButton", label: "Export" },
            { index: 2, role: "AXTextArea", label: "Body", value: "old text" },
            { index: 3, role: "AXSecureTextField", label: "Password", value: "" },
          ]),
        ),
      );
    if (tool === "set_value") {
      if (this.takes) this.value = String(args.value);
      return Promise.resolve(confirmed());
    }
    if (tool === "verify_state") return Promise.resolve(ok({ status: this.verify }));
    if (tool === "click" && this.refuseTokens && args.element_token !== undefined)
      return Promise.resolve(ok({ code: "ax_failed" }, { refused: true, text: "AX action failed" }));
    if (tool === "click" && this.refuseClick && args.delivery_mode === "background")
      return Promise.resolve(ok(this.refuseClick, { refused: true, text: "background_unavailable" }));
    return Promise.resolve(confirmed());
  }

  tools(): string[] {
    return this.calls.map((call) => call.tool);
  }
}

/** A gate that says yes, and counts. */
class Gate implements HxStepGate {
  fronts = 0;
  afters = 0;
  inputs = 0;
  frontStop: HxGateStop | null = null;
  afterStop: HxGateStop | null = null;
  checkStop: HxGateStop | null = null;
  async front(): Promise<HxGateStop | null> {
    this.fronts += 1;
    return this.frontStop;
  }
  ownInput(): () => void {
    return () => {
      this.inputs += 1;
    };
  }
  after(): HxGateStop | null {
    this.afters += 1;
    return this.afterStop;
  }
  check(): HxGateStop | null {
    return this.checkStop;
  }
}

async function run(driver: Driver, steps: HxStep[], options: { gate?: Gate; records?: HxStepRecord[] } = {}) {
  const records = options.records;
  const runner = new HxStepRun({
    driver,
    stopped: () => false,
    wait: () => Promise.resolve(),
    gate: options.gate ?? null,
    ...(records ? { record: (entry: HxStepRecord) => records.push(entry) } : {}),
  });
  expect(await runner.open({ app: "Notes", title: "Draft" })).toBeNull();
  return { result: await runner.run(steps), runner };
}

describe("the driver's answers", () => {
  it("reads a refusal (isError) as a refusal, with its own reason and rung", () => {
    const answer = hxReadDriverReply(
      JSON.stringify({
        ok: true,
        result: {
          content: [{ type: "text", text: "drag needs the foreground" }],
          isError: true,
          structuredContent: { code: "background_unavailable", escalation: { recommended: "foreground" } },
        },
      }),
    );
    expect(answer.ok).toBe(true);
    expect(answer.refused).toBe(true);
    const effect = actionEffect(answer);
    expect(effect.worked).toBe(false);
    expect(effect.next).toBe("foreground");
    expect(effect.reason).toContain("drag needs the foreground");
    // Before v1.7.3 such an answer counted as a step that may have worked.
    expect(actionEffect(ok(null, { refused: true })).worked).toBe(false);
    expect(actionEffect(ok({ effect: "unverifiable" })).worked).toBe(true);
    expect(actionEffect(ok({ effect: "refused", escalation: { target: "pixel" } })).next).toBe("pixel");
  });

  it("keeps the images of a result", () => {
    const answer = hxReadDriverReply(
      JSON.stringify({
        ok: true,
        result: {
          content: [
            { type: "text", text: "a window" },
            { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
            { type: "image", data: "", mimeType: "image/png" },
            { type: "image", data: "x", mimeType: "text/html" },
          ],
          structuredContent: { screenshot_width: 800 },
        },
      }),
    );
    expect(answer.images).toEqual([{ data: "iVBORw0KGgo=", mimeType: "image/png" }]);
    expect(answer.refused).toBeUndefined();
  });

  it("finds the front window of an app and the windows of an app", () => {
    expect(hxFrontWindowOf(WINDOWS, 2)).toBe(22);
    expect(hxFrontWindowOf(WINDOWS, 3)).toBeNull();
    expect(hxFrontWindowOf({ windows: [{ ...WINDOWS.windows[0], z_index: null }] }, 2)).toBeNull();
    expect(hxWindowsOf(WINDOWS, 2)).toEqual([20, 22]);
  });
});

describe("typing with a value set directly (CU-06)", () => {
  it("sets an empty one-line field directly, with no keys and no front, and checks it", async () => {
    const driver = new Driver();
    const gate = new Gate();
    const { result } = await run(driver, [{ act: "type", target: { name: "Search" }, text: "季度报告" }], { gate });
    expect(result.status).toBe("done");
    expect(result.steps[0]).toMatchObject({ route: "value", check: "verified" });
    expect(driver.tools()).not.toContain("type_text");
    expect(driver.tools()).not.toContain("click");
    expect(gate.fronts).toBe(0);
    expect(driver.calls.find((call) => call.tool === "set_value")?.args).toEqual({
      pid: 2,
      element_token: "tok-0",
      value: "季度报告",
    });
  });

  it("types at the cursor in a field that has text, and in a text area", async () => {
    const driver = new Driver();
    driver.value = "q3";
    const { result } = await run(driver, [{ act: "type", target: { name: "Search" }, text: " report" }]);
    expect(driver.tools()).not.toContain("set_value");
    expect(driver.tools()).toContain("type_text");
    expect(result.steps[0]?.route).not.toBe("value");
    const area = new Driver();
    await run(area, [{ act: "type", target: { name: "Body" }, text: "more" }]);
    expect(area.tools()).not.toContain("set_value");
  });

  it("replaces a field's text with by value, and never sets a password field", async () => {
    const driver = new Driver();
    driver.value = "old";
    const { result } = await run(driver, [{ act: "type", target: { name: "Search" }, text: "new", by: "value" }]);
    expect(result.steps[0]).toMatchObject({ route: "value", check: "verified" });
    const secret = new Driver();
    const answer = await run(secret, [{ act: "type", target: { name: "Password" }, text: "x", by: "value" }]);
    expect(secret.tools()).not.toContain("set_value");
    expect(answer.result.status).toBe("failed");
  });

  it("types instead when the field did not take the value, and does not type twice", async () => {
    const driver = new Driver();
    driver.takes = false;
    const { result } = await run(driver, [{ act: "type", target: { name: "Search" }, text: "abc" }]);
    expect(driver.tools().filter((tool) => tool === "set_value")).toHaveLength(1);
    expect(driver.tools().filter((tool) => tool === "type_text")).toHaveLength(1);
    expect(result.steps[0]?.route).not.toBe("value");
  });

  it("marks the step pending (待核实) when the field shows something else, and stops", async () => {
    const driver = new Driver();
    const odd: HxDriverPort = {
      call: async (tool, args) => {
        if (tool === "set_value") {
          driver.value = "ab";
          return confirmed();
        }
        return driver.call(tool, args);
      },
    };
    const runner = new HxStepRun({ driver: odd, stopped: () => false, wait: () => Promise.resolve() });
    await runner.open({ app: "Notes", title: "Draft" });
    const result = await runner.run([
      { act: "type", target: { name: "Search" }, text: "abc" },
      { act: "click", target: { name: "Export" } },
    ]);
    expect(result.status).toBe("unsure");
    expect(result.steps.map((step) => step.check)).toEqual(["pending"]);
    expect(result.stoppedAt?.reason).toContain("ask the user");
    expect(driver.tools()).not.toContain("type_text");
    expect(driver.tools()).not.toContain("click");
  });
});

describe("waiting for something (CU-06)", () => {
  it("waits up to 10 seconds by default and says 没等到 when it did not show", async () => {
    const driver = new Driver();
    driver.verify = "unsatisfied";
    const { result } = await run(driver, [{ act: "wait", expect: { name: "Saved" } }]);
    expect(result.status).toBe("timed_out");
    expect(result.stoppedAt?.reason).toContain("没等到");
    expect(result.steps).toHaveLength(0);
    const verify = driver.calls.find((call) => call.tool === "verify_state");
    expect(verify?.args.timeout_ms).toBe(10_000);
  });

  it("takes a shorter wait from the step, and a met wait is verified", async () => {
    const driver = new Driver();
    const { result } = await run(driver, [{ act: "wait", seconds: 2, expect: { name: "Export" } }]);
    expect(result.status).toBe("done");
    expect(result.steps[0]?.check).toBe("verified");
    expect(driver.calls.find((call) => call.tool === "verify_state")?.args.timeout_ms).toBe(2_000);
  });
});

describe("the readback of expect (CU-02)", () => {
  it("counts a step with no readback as unchecked, not done", async () => {
    const driver = new Driver();
    const unchecked: HxDriverPort = {
      call: (tool, args) =>
        tool === "click"
          ? Promise.resolve(ok({ effect: "unverifiable", route: "accessibility" }))
          : driver.call(tool, args),
    };
    const runner = new HxStepRun({ driver: unchecked, stopped: () => false, wait: () => Promise.resolve() });
    await runner.open({ app: "Notes", title: "Draft" });
    const result = await runner.run([{ act: "click", target: { name: "Export" } }]);
    expect(result.status).toBe("done");
    expect(result.steps[0]).toMatchObject({ check: "unchecked", checked: false });
    expect(result.summary).toEqual({ verified: 0, unchecked: 1, pending: 0 });
  });

  it("is pending when only the name fits and the value does not", async () => {
    const driver = new Driver();
    driver.verify = "unknown";
    driver.value = "other";
    const { result } = await run(driver, [
      { act: "click", target: { name: "Export" }, expect: { name: "Search", value: "abc" } },
    ]);
    expect(result.status).toBe("unsure");
    expect(result.steps[0]?.check).toBe("pending");
    expect(result.steps[0]?.readback).toContain("other");
  });

  it("writes one record per step, with the window, the route and the check", async () => {
    const records: HxStepRecord[] = [];
    const driver = new Driver();
    await run(
      driver,
      [
        { act: "type", target: { name: "Search" }, text: "abc" },
        { act: "click", target: { name: "Nothing like it" } },
      ],
      { records },
    );
    expect(records.map((record) => [record.n, record.windowId, record.route, record.check])).toEqual([
      [1, 20, "value", "verified"],
      [2, 20, "none", "failed"],
    ]);
  });
});

describe("indexes from an outline (CU-06)", () => {
  it("acts on an index only while the element there is the one the outline showed", async () => {
    const driver = new Driver();
    const read = hxReadWindow(
      windowWith([
        { index: 0, role: "AXSearchField", label: "Search", value: "" },
        { index: 1, role: "AXButton", label: "Export" },
      ]),
    );
    if (!read) throw new Error("no read");
    const good = new HxStepRun({
      driver,
      stopped: () => false,
      wait: () => Promise.resolve(),
      snapshot: hxSnapshotOf(read, Date.now() - 60_000),
    });
    await good.open({ app: "Notes", title: "Draft" });
    expect((await good.run([{ act: "click", target: { index: 1 } }])).status).toBe("done");

    const moved = hxReadWindow(windowWith([{ index: 1, role: "AXButton", label: "Delete" }]));
    if (!moved) throw new Error("no read");
    const changed = new HxStepRun({
      driver,
      stopped: () => false,
      wait: () => Promise.resolve(),
      snapshot: hxSnapshotOf(moved, Date.now()),
    });
    await changed.open({ app: "Notes", title: "Draft" });
    const result = await changed.run([{ act: "click", target: { index: 1 } }]);
    expect(result.status).toBe("failed");
    expect(result.stoppedAt?.reason).toContain("The window changed");

    const none = new HxStepRun({ driver, stopped: () => false, wait: () => Promise.resolve() });
    await none.open({ app: "Notes", title: "Draft" });
    expect((await none.run([{ act: "click", target: { index: 1 } }])).stoppedAt?.reason).toContain("no outline");
  });
});

describe("the gate in a run (CONC-05, CONC-06)", () => {
  it("asks the gate before each front input, not before background ones, and lets go after each step", async () => {
    const driver = new Driver();
    const gate = new Gate();
    const { result } = await run(
      driver,
      [
        { act: "click", target: { name: "Export" } },
        { act: "key", key: "return" },
        { act: "menu", path: ["File", "Export"] },
        { act: "hotkey", keys: ["cmd", "s"] },
      ],
      { gate },
    );
    expect(result.status).toBe("done");
    // The background click and the menu need no front; the key and the chord do.
    expect(gate.fronts).toBe(2);
    expect(gate.afters).toBe(4);
    expect(gate.inputs).toBe(4);
  });

  it("goes to the front for a click only when the background is refused", async () => {
    const driver = new Driver();
    driver.refuseClick = { code: "background_unavailable", escalation: { recommended: "foreground" } };
    const gate = new Gate();
    const { result } = await run(driver, [{ act: "click", target: { name: "Export" } }], { gate });
    expect(result.status).toBe("done");
    expect(gate.fronts).toBe(1);
    const clicks = driver.calls.filter((call) => call.tool === "click").map((call) => call.args.delivery_mode);
    expect(clicks).toEqual(["background", "foreground"]);
  });

  it("parks the run where the gate says the user is busy, before any key", async () => {
    const driver = new Driver();
    const gate = new Gate();
    gate.frontStop = { stop: "waiting_user", why: "user_active", reason: "parked" };
    const { result } = await run(
      driver,
      [
        { act: "click", target: { name: "Export" } },
        { act: "key", key: "return" },
        { act: "key", key: "tab" },
      ],
      { gate },
    );
    expect(result.status).toBe("waiting_user");
    expect(result.parked).toBe("user_active");
    expect(result.stoppedAt?.n).toBe(2);
    expect(result.steps).toHaveLength(1);
    expect(driver.tools()).not.toContain("press_key");
  });

  it("answers busy after a step when a more urgent agent waits, and stops at the gate's check", async () => {
    const driver = new Driver();
    const gate = new Gate();
    gate.afterStop = { stop: "busy", reason: "urgent", etaMs: 1200 };
    const { result } = await run(
      driver,
      [
        { act: "click", target: { name: "Export" } },
        { act: "click", target: { name: "Export" } },
      ],
      { gate },
    );
    expect(result.status).toBe("busy");
    expect(result.etaMs).toBe(1200);
    expect(result.steps).toHaveLength(1);
    expect(result.stoppedAt?.n).toBe(2);

    const stopped = new Gate();
    stopped.checkStop = { stop: "stopped", reason: "keys" };
    const after = await run(new Driver(), [{ act: "click", target: { name: "Export" } }], { gate: stopped });
    expect(after.result.status).toBe("stopped");
    expect(after.result.steps).toHaveLength(0);
  });

  it("sends no keys when the gate answers busy for a field typed with keys", async () => {
    const driver = new Driver();
    driver.value = "x";
    const gate = new Gate();
    gate.frontStop = { stop: "busy", reason: "Bob types", etaMs: null };
    const { result } = await run(driver, [{ act: "type", target: { name: "Search" }, text: "y" }], { gate });
    expect(result.status).toBe("busy");
    expect(driver.tools()).not.toContain("type_text");
    expect(driver.tools()).not.toContain("click");
  });
});

describe("HXBot's own input (CONC-06)", () => {
  it("counts the key ups at the end of a run with keys as HXBot's input, not the user's", async () => {
    const order: string[] = [];
    const gate = new Gate();
    const counted = gate.ownInput.bind(gate);
    gate.ownInput = () => {
      order.push("start");
      const done = counted();
      return () => {
        order.push("input");
        done();
      };
    };
    const runner = new HxStepRun({
      driver: new Driver(),
      stopped: () => false,
      wait: () => Promise.resolve(),
      gate,
      front: {
        front: () => Promise.resolve({ pid: 2, windowId: 20 }),
        releaseModifiers: () => {
          order.push("release");
          return Promise.resolve();
        },
      },
    });
    expect(await runner.open({ app: "Notes", title: "Draft" })).toBeNull();
    const result = await runner.run([{ act: "key", key: "return" }]);
    expect(result.status).toBe("done");
    expect(order.slice(-3)).toEqual(["start", "release", "input"]);
  });
});

describe("the user's clipboard (CU-01)", () => {
  it("puts the user's copy back only when the clipboard holds the typed text", async () => {
    const log: string[] = [];
    const make = (holding: string) => ({
      save: async () => ({
        changed: async () => true,
        holds: async (text: string) => text === holding,
        putBack: async () => {
          log.push(`back ${holding}`);
        },
      }),
    });
    for (const holding of ["typed", "the user's new copy"]) {
      const driver = new Driver();
      driver.value = "x";
      const runner = new HxStepRun({
        driver,
        stopped: () => false,
        wait: () => Promise.resolve(),
        clipboard: make(holding),
      });
      await runner.open({ app: "Notes", title: "Draft" });
      await runner.run([{ act: "type", target: { name: "Search" }, text: "typed" }]);
    }
    expect(log).toEqual(["back typed"]);
  });
});

describe("a screenshot of the window (CONC-05)", () => {
  it("gives the image and its size, or says why there is none", async () => {
    const shot: HxDriverPort = {
      call: async (tool) =>
        tool === "list_windows"
          ? ok(WINDOWS)
          : ok({ screenshot_width: 640, screenshot_height: 480 }, { images: [{ data: "abc", mimeType: "image/png" }] }),
    };
    const runner = new HxStepRun({ driver: shot, stopped: () => false });
    await runner.open({ app: "Notes", title: "Draft" });
    expect(await runner.screenshot()).toEqual({
      image: { data: "abc", mimeType: "image/png" },
      width: 640,
      height: 480,
    });
    const blank: HxDriverPort = { call: async (tool) => (tool === "list_windows" ? ok(WINDOWS) : ok({})) };
    const empty = new HxStepRun({ driver: blank, stopped: () => false });
    await empty.open({ app: "Notes", title: "Draft" });
    expect(await empty.screenshot()).toMatchObject({ error: expect.stringContaining("Screen Recording") });
  });
});

describe("pixels, scrolls and drags as the driver takes them (v1.7.3 real check)", () => {
  it("reads the window with a screenshot before a click at a point, and clicks in its scale", async () => {
    const driver = new Driver();
    driver.refuseTokens = true;
    const runner = new HxStepRun({ driver, stopped: () => false, wait: () => Promise.resolve() });
    await runner.open({ app: "Notes", title: "Draft" });
    await runner.run([{ act: "click", target: { name: "Export" } }]);
    const reads = driver.calls.filter((call) => call.tool === "get_window_state");
    expect(reads.some((call) => call.args.include_screenshot === true)).toBe(true);
    const point = driver.calls.find((call) => call.tool === "click" && call.args.x !== undefined);
    expect(point?.args).toMatchObject({ x: 60, y: 20 });
    // The read with the screenshot came right before the click at the point.
    const at = driver.calls.indexOf(point ?? { tool: "", args: {} });
    expect(driver.calls[at - 1]?.args.include_screenshot).toBe(true);
  });

  it("scrolls an element by its token, and drags in the foreground", async () => {
    const driver = new Driver();
    await run(driver, [
      { act: "scroll", target: { name: "Export" }, direction: "down" },
      { act: "drag", at: { x: 1, y: 2 }, toAt: { x: 30, y: 40 } },
    ]);
    expect(driver.calls.find((call) => call.tool === "scroll")?.args).toMatchObject({ element_token: "tok-1" });
    expect(driver.calls.find((call) => call.tool === "scroll")?.args.x).toBeUndefined();
    expect(driver.calls.find((call) => call.tool === "drag")?.args).toMatchObject({
      delivery_mode: "foreground",
      from_x: 1,
      to_y: 40,
    });
  });

  it("inserts text into a field through accessibility on macOS, with no click and no front", async () => {
    const driver = new Driver();
    const gate = new Gate();
    const runner = new HxStepRun({
      driver,
      stopped: () => false,
      wait: () => Promise.resolve(),
      gate,
      platform: "darwin",
    });
    await runner.open({ app: "Notes", title: "Draft" });
    const result = await runner.run([
      { act: "type", target: { name: "Body" }, text: " more" },
      { act: "hotkey", keys: ["cmd", "s"] },
    ]);
    expect(result.status).toBe("done");
    expect(result.steps[0]).toMatchObject({ route: "background", check: "verified" });
    const typed = driver.calls.find((call) => call.tool === "type_text");
    expect(typed?.args).toMatchObject({ element_token: "tok-2", delivery_mode: "background", text: " more" });
    expect(driver.tools()).not.toContain("click");
    // Only the chord needs the front; it goes to the app in front, which the gate checked.
    expect(gate.fronts).toBe(1);
    expect(driver.calls.find((call) => call.tool === "hotkey")?.args.target).toEqual({
      kind: "desktop",
      display_id: "primary",
    });
  });

  it("types with the keys when macOS refuses the insertion, and nothing went in", async () => {
    const driver = new Driver();
    let first = true;
    const port: HxDriverPort = {
      call: (tool, args) => {
        if (tool === "type_text" && first) {
          first = false;
          return Promise.resolve(ok({ code: "web_content" }, { refused: true, text: "refused" }));
        }
        return driver.call(tool, args);
      },
    };
    const runner = new HxStepRun({
      driver: port,
      stopped: () => false,
      wait: () => Promise.resolve(),
      platform: "darwin",
    });
    await runner.open({ app: "Notes", title: "Draft" });
    const result = await runner.run([{ act: "type", target: { name: "Body" }, text: "x" }]);
    expect(result.status).toBe("done");
    expect(driver.tools().filter((tool) => tool === "type_text")).toHaveLength(1);
    expect(driver.tools()).toContain("click");
  });
});
