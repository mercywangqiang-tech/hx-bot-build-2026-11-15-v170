import type { DynamicRecord } from "@hxbot/contracts/runtime-values";
import { describe, expect, it } from "vitest";
import type { HxDriverAnswer, HxDriverPort } from "./driver";
import {
  HX_COMPUTER_STEP_TOOL_DEFINITIONS,
  type HxComputerPlan,
  type HxStepToolDeps,
  hxComputerPlanCard,
  hxComputerStepToolCall,
  hxPlanAfterRun,
} from "./step-tools";

// HXBot 电脑操控（二）：computer_plan、computer_look、computer_do 三个工具（step-tools.ts）。

const ok = (content: DynamicRecord): HxDriverAnswer => ({ ok: true, content, text: "", error: null });

class Driver implements HxDriverPort {
  readonly tools: string[] = [];
  constructor(readonly verify: string = "satisfied") {}

  call(tool: string): Promise<HxDriverAnswer> {
    this.tools.push(tool);
    if (tool === "list_windows") {
      return Promise.resolve(
        ok({
          windows: [
            {
              pid: 5,
              window_id: 50,
              app_name: "TextEdit",
              title: "Untitled",
              bounds: { x: 0, y: 0, width: 800, height: 600 },
              is_on_screen: true,
              z_index: 1,
            },
          ],
        }),
      );
    }
    if (tool === "get_window_state") {
      return Promise.resolve(
        ok({
          pid: 5,
          window_id: 50,
          app_name: "TextEdit",
          window_title: "Untitled",
          elements: [
            {
              element_index: 0,
              element_token: "a",
              role: "AXTextArea",
              label: "Body",
              depth: 1,
              frame: { x: 0, y: 0, w: 500, h: 400 },
            },
            {
              element_index: 1,
              element_token: "b",
              role: "AXButton",
              label: "Save",
              depth: 1,
              frame: { x: 0, y: 0, w: 50, h: 20 },
            },
          ],
        }),
      );
    }
    if (tool === "verify_state") return Promise.resolve(ok({ status: this.verify }));
    return Promise.resolve(ok({ effect: "confirmed", route: "accessibility", delivery: { mode: "background" } }));
  }
}

function deps(change: Partial<HxStepToolDeps> = {}) {
  const cards: Array<{ plan: HxComputerPlan; stopped: boolean }> = [];
  const records: string[] = [];
  const driver = new Driver();
  let plan: HxComputerPlan | null = null;
  let ids = 0;
  const base: HxStepToolDeps = {
    allowed: "yes",
    driver,
    stopped: () => false,
    plan: {
      get: () => plan,
      set: (next, stopped) => {
        plan = next;
        cards.push({ plan: next, stopped });
      },
    },
    newId: () => `card-${++ids}`,
    stopKeys: "Ctrl+Alt+Esc",
    record: (detail) => records.push(detail),
    ...change,
  };
  return { base, cards, records, driver };
}

const parse = (result: { contentItems: ReadonlyArray<{ type: string; text?: string }> }) => {
  const item = result.contentItems[0];
  return JSON.parse(item && "text" in item && typeof item.text === "string" ? item.text : "{}");
};

describe("the definitions", () => {
  it("are three, short enough for the catalog", () => {
    expect(HX_COMPUTER_STEP_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "computer_plan",
      "computer_look",
      "computer_do",
    ]);
    for (const tool of HX_COMPUTER_STEP_TOOL_DEFINITIONS) expect(tool.description.length, tool.name).toBeLessThan(420);
  });
});

describe("computer_plan", () => {
  it("shows the plan as a progress card: the header names the app and the stop keys, the first step runs", async () => {
    const { base, cards, driver } = deps();
    const result = await hxComputerStepToolCall(base, {
      tool: "computer_plan",
      arguments: { app: "微信", steps: ["打开微信", "搜索张三", "输入消息"] },
    });
    expect(result.success).toBe(true);
    expect(parse(result)).toEqual({ status: "shown", steps: 3 });
    expect(cards).toHaveLength(1);
    const card = cards[0];
    if (!card) throw new Error("no card");
    expect(card.stopped).toBe(false);
    expect(card.plan.id).toBe("card-1");
    expect(hxComputerPlanCard(card.plan)).toEqual({
      title: "Work on this computer · 微信 · Ctrl+Alt+Esc stops it",
      steps: [
        { text: "打开微信", state: "active" },
        { text: "搜索张三", state: "pending" },
        { text: "输入消息", state: "pending" },
      ],
    });
    // A plan does not touch the computer.
    expect(driver.tools).toEqual([]);
  });

  it("refuses an empty plan", async () => {
    const { base, cards } = deps();
    const result = await hxComputerStepToolCall(base, { tool: "computer_plan", arguments: { steps: [] } });
    expect(result.success).toBe(false);
    expect(cards).toEqual([]);
  });

  it("moves the card after a run: done steps, the one that failed, the next one running", () => {
    const plan: HxComputerPlan = {
      id: "p",
      app: "a",
      keys: "k",
      steps: [
        { text: "1", state: "active" },
        { text: "2", state: "pending" },
        { text: "3", state: "pending" },
      ],
    };
    expect(hxPlanAfterRun(plan, [1], null).steps.map((step) => step.state)).toEqual(["done", "active", "pending"]);
    expect(hxPlanAfterRun(plan, [1, 2, 3], null).steps.map((step) => step.state)).toEqual(["done", "done", "done"]);
    expect(hxPlanAfterRun(plan, [1], 2).steps.map((step) => step.state)).toEqual(["done", "failed", "pending"]);
  });
});

describe("computer_look and computer_do", () => {
  it("reads the outline of the app's window", async () => {
    const { base } = deps();
    const result = await hxComputerStepToolCall(base, { tool: "computer_look", arguments: { app: "TextEdit" } });
    const answer = parse(result);
    expect(answer.status).toBe("window");
    expect(answer.outline).toContain('[1] button "Save"');
  });

  it("runs the steps, and a step that names its plan step marks it done on the card", async () => {
    const { base, cards, records } = deps();
    await hxComputerStepToolCall(base, {
      tool: "computer_plan",
      arguments: { app: "TextEdit", steps: ["写正文", "保存"] },
    });
    const result = await hxComputerStepToolCall(base, {
      tool: "computer_do",
      arguments: {
        app: "TextEdit",
        steps: [
          { act: "type", plan_step: 1, target: { name: "Body" }, text: "你好" },
          { act: "hotkey", plan_step: 2, keys: ["cmd", "s"], expect: { name: "Save" } },
        ],
      },
    });
    const answer = parse(result);
    expect(answer.status).toBe("done");
    expect(answer.steps).toHaveLength(2);
    expect(cards.at(-1)?.plan.steps.map((step) => step.state)).toEqual(["done", "done"]);
    expect(cards.at(-1)?.plan.id).toBe("card-1");
    // v1.7.3 (CU-02): one line per step in the activity record, with its route and its check.
    expect(records).toEqual([
      "computer_do TextEdit #50 step 1 type via foreground: verified; Body: 2 characters",
      "computer_do TextEdit #50 step 2 hotkey via keyboard: verified; cmd+s; the driver checked it",
    ]);
  });

  it("says what failed, with the outline, and marks the plan step that failed", async () => {
    const { base, cards } = deps({ driver: new Driver("unsatisfied") });
    await hxComputerStepToolCall(base, { tool: "computer_plan", arguments: { steps: ["点保存"] } });
    const result = await hxComputerStepToolCall(base, {
      tool: "computer_do",
      arguments: {
        app: "TextEdit",
        steps: [{ act: "click", plan_step: 1, target: { name: "Save" }, expect: { name: "Saved" } }],
      },
    });
    expect(result.success).toBe(false);
    const answer = parse(result);
    expect(answer.status).toBe("failed");
    expect(answer.next).toContain("try another way");
    expect(answer.outline).toContain("TextEdit");
    expect(cards.at(-1)?.plan.steps[0]?.state).toBe("failed");
  });

  it("refuses when Computer Use is off, in a task, with no driver, and after the stop keys", async () => {
    const off = await hxComputerStepToolCall(deps({ allowed: "off" }).base, { tool: "computer_look", arguments: {} });
    expect(parse(off).reason).toContain("Computer Use is off");
    const task = await hxComputerStepToolCall(deps({ allowed: "task" }).base, { tool: "computer_do", arguments: {} });
    expect(parse(task).reason).toContain("A task runs without Computer Use");
    const none = await hxComputerStepToolCall(deps({ driver: null }).base, { tool: "computer_look", arguments: {} });
    expect(parse(none).status).toBe("no_driver");
    const { base, driver } = deps({ stopped: () => true });
    const stopped = await hxComputerStepToolCall(base, {
      tool: "computer_do",
      arguments: { steps: [{ act: "hotkey", keys: ["cmd", "s"] }] },
    });
    expect(parse(stopped).status).toBe("stopped");
    expect(driver.tools).toEqual([]);
  });

  it("names the field of a step that is not valid", async () => {
    const { base } = deps();
    const result = await hxComputerStepToolCall(base, { tool: "computer_do", arguments: { steps: [{ act: "fly" }] } });
    expect(parse(result).reason).toContain("steps.0.act");
  });
});
