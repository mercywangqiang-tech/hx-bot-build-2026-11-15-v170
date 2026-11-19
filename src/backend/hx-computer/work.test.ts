import type { DynamicRecord } from "@hxbot/contracts/runtime-values";
import { describe, expect, it, vi } from "vitest";
import type { HxDriverAnswer, HxDriverPort } from "./driver";
import { HxComputerLanes, hxAppLane } from "./lanes";
import { HxParkedSteps } from "./parked";
import { HxPresence } from "./presence";
import { type HxComputerPlan, type HxStepToolDeps, type HxStepWork, hxComputerStepToolCall } from "./step-tools";
import type { HxLookSnapshot, HxRunResult } from "./steps";
import { type HxWorkDeps, hxParkReply, hxStepWork, hxSystemTurn, hxUserSaid } from "./work";

// HXBot 电脑操控（五）（v1.7.3）：一次调用拿道、过门、停放（work.ts），以及它和 computer_do 的接线，含压力测试。

const ok = (content: DynamicRecord, extra: Partial<HxDriverAnswer> = {}): HxDriverAnswer => ({
  ok: true,
  content,
  text: "",
  error: null,
  ...extra,
});

class Driver implements HxDriverPort {
  readonly tools: string[] = [];
  async call(tool: string): Promise<HxDriverAnswer> {
    this.tools.push(tool);
    if (tool === "list_windows")
      return ok({
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
      });
    if (tool === "get_window_state")
      return ok(
        {
          pid: 5,
          window_id: 50,
          app_name: "TextEdit",
          window_title: "Untitled",
          elements: [
            { element_index: 0, element_token: "a", role: "AXTextArea", label: "Body", depth: 1 },
            { element_index: 1, element_token: "b", role: "AXButton", label: "Save", depth: 1 },
          ],
        },
        { images: [{ data: "png", mimeType: "image/png" }] },
      );
    if (tool === "verify_state") return ok({ status: "satisfied" });
    return ok({ effect: "confirmed", route: "accessibility", delivery: { mode: "background" } });
  }
}

/** A presence the test sets. */
function presence(idleMs: number) {
  const value = new HxPresence();
  value.setSource({ idleSeconds: () => idleMs / 1000, locked: () => false });
  return value;
}

function workDeps(change: Partial<HxWorkDeps> = {}) {
  const notes: string[] = [];
  const deps: HxWorkDeps = {
    lanes: new HxComputerLanes(),
    presence: presence(60_000),
    parked: new HxParkedSteps({ every: () => setInterval(() => {}, 1_000_000) }),
    frontWindow: async () => ({ pid: 5, windowId: 50 }),
    driver: () => null,
    stopped: () => false,
    looks: new Map<string, HxLookSnapshot>(),
    note: (text) => notes.push(text),
    parkedLine: (work, seconds) => `parked ${work.window.app} ${seconds}`,
    wait: () => Promise.resolve(),
    ...change,
  };
  return { deps, notes };
}

function toolDeps(work: HxStepWork | null, driver = new Driver()) {
  const records: string[] = [];
  let plan: HxComputerPlan | null = null;
  const base: HxStepToolDeps = {
    allowed: "yes",
    driver,
    stopped: () => false,
    plan: {
      get: () => plan,
      set: (next) => {
        plan = next;
      },
    },
    newId: () => "card",
    stopKeys: "⌃⌥Esc",
    record: (detail) => records.push(detail),
    work,
  };
  return { base, records, driver };
}

const parse = (result: { contentItems: Array<{ type: string; text?: string }> }) => {
  const item = result.contentItems[0];
  return JSON.parse(item && "text" in item && item.text ? item.text : "{}");
};

const keys = { act: "hotkey" as const, keys: ["cmd", "s"] };

describe("the replies to a parked step", () => {
  it("knows “现在做” and “放弃” in every language of the chat line, and nothing longer", () => {
    for (const text of [
      "现在做",
      "現在做！",
      "Now",
      "do it now.",
      "jetzt",
      "maintenant",
      "今すぐ",
      "지금",
      "сейчас",
      "şimdi",
      "الآن",
    ])
      expect(hxParkReply(text), text).toBe("now");
    for (const text of ["放弃", "drop", "Drop it!", "verwerfen", "やめる", "취소", "отмена", "bırak", "porzuć"])
      expect(hxParkReply(text), text).toBe("drop");
    for (const text of ["", "现在做一下这个报告然后发给我", "now please write the report", "ok", "好的"])
      expect(hxParkReply(text), text).toBeNull();
  });

  it("decides only a parked step of that agent", () => {
    const parked = new HxParkedSteps();
    expect(hxUserSaid(parked, "a", "现在做")).toBeNull();
    expect(parked.consented("a")).toBe(false);
    parked.park({
      agentId: "a",
      tier: 0,
      window: { pid: 1, windowId: 2, app: "X", title: "" },
      remaining: 1,
      since: Date.now(),
      why: "user_active",
    });
    expect(hxUserSaid(parked, "a", "现在做")).toBe("now");
    expect(parked.consented("a")).toBe(true);
    expect(hxUserSaid(parked, "a", "放弃")).toBe("drop");
    expect(parked.get("a")).toBeNull();
  });
});

describe("the work of one computer_do call", () => {
  it("takes the app lane, runs, and lets every lane go", async () => {
    const { deps } = workDeps();
    const work = hxStepWork({ agentId: "a", name: "A", tier: 0 }, deps);
    const { base } = toolDeps(work);
    const answer = parse(
      await hxComputerStepToolCall(base, {
        tool: "computer_do",
        arguments: { app: "TextEdit", steps: [{ act: "click", target: { name: "Save" } }, keys] },
      }),
    );
    expect(answer.status).toBe("done");
    expect(deps.lanes.holders().size).toBe(0);
    // The run's read is kept for the agent's next indexes.
    expect(deps.looks.get("a")?.windowId).toBe(50);
  });

  it("answers busy, with the reason, when another agent holds the app", async () => {
    const { deps } = workDeps();
    const other = await deps.lanes.acquire(
      hxAppLane("TextEdit"),
      { agentId: "b", name: "Bob", tier: 0 },
      Date.now() + 60_000,
    );
    const work = hxStepWork({ agentId: "a", name: "A", tier: 2 }, deps);
    // A short budget: the test does not wait 30 seconds.
    const { base, driver } = toolDeps(work);
    const start = Date.now();
    const call = hxComputerStepToolCall(base, { tool: "computer_do", arguments: { app: "TextEdit", steps: [keys] } });
    setTimeout(() => deps.lanes.stopAll(), 50);
    const answer = parse(await call);
    expect(Date.now() - start).toBeLessThan(5_000);
    expect(answer.status).toBe("stopped");
    expect(driver.tools).not.toContain("hotkey");
    if (other.ok) other.lease.release();
  });

  it("parks with one chat line when the user is busy, and parks again without another", async () => {
    const { deps, notes } = workDeps({ presence: presence(0) });
    const holder = { agentId: "a", name: "A", tier: 0 };
    const first = toolDeps(hxStepWork(holder, deps));
    const answer = parse(
      await hxComputerStepToolCall(first.base, {
        tool: "computer_do",
        arguments: { app: "TextEdit", steps: [keys, keys] },
      }),
    );
    expect(answer.status).toBe("waiting_user");
    expect(answer.parked).toBe("user_active");
    expect(first.driver.tools).not.toContain("hotkey");
    expect(deps.parked.get("a")?.remaining).toBe(2);
    expect(notes).toEqual(["parked TextEdit 5"]);
    // Parked already: a second call parks at once, with no second line.
    const second = toolDeps(hxStepWork(holder, deps));
    const again = parse(
      await hxComputerStepToolCall(second.base, { tool: "computer_do", arguments: { app: "TextEdit", steps: [keys] } }),
    );
    expect(again.status).toBe("waiting_user");
    expect(notes).toHaveLength(1);
    expect(deps.lanes.holders().size).toBe(0);
  });

  it("drops the parked step when the steps go on, or a new plan starts", async () => {
    const { deps } = workDeps();
    deps.parked.park({
      agentId: "a",
      tier: 0,
      window: { pid: 5, windowId: 50, app: "TextEdit", title: "" },
      remaining: 1,
      since: Date.now(),
      why: "user_active",
    });
    const { base } = toolDeps(hxStepWork({ agentId: "a", tier: 0 }, deps));
    expect(
      parse(await hxComputerStepToolCall(base, { tool: "computer_do", arguments: { app: "TextEdit", steps: [keys] } }))
        .status,
    ).toBe("done");
    expect(deps.parked.get("a")).toBeNull();
    deps.parked.park({
      agentId: "a",
      tier: 0,
      window: { pid: 5, windowId: 50, app: "TextEdit", title: "" },
      remaining: 1,
      since: Date.now(),
      why: "user_active",
    });
    const plan = toolDeps(hxStepWork({ agentId: "a", tier: 0 }, deps));
    await hxComputerStepToolCall(plan.base, { tool: "computer_plan", arguments: { steps: ["保存"] } });
    expect(deps.parked.get("a")).toBeNull();
  });

  it("after “现在做”, brings the window to the front and runs, though the user is not resting", async () => {
    const driver = new Driver();
    const { deps } = workDeps({ presence: presence(0), driver: () => driver });
    deps.parked.park({
      agentId: "a",
      tier: 0,
      window: { pid: 5, windowId: 50, app: "TextEdit", title: "" },
      remaining: 1,
      since: Date.now(),
      why: "user_active",
    });
    hxUserSaid(deps.parked, "a", "现在做");
    const own: Array<{ tools: number }> = [];
    const begun = deps.presence.beginOwnInput.bind(deps.presence);
    deps.presence.beginOwnInput = (start) => {
      own.push({ tools: driver.tools.length });
      return begun(start);
    };
    const { base } = toolDeps(hxStepWork({ agentId: "a", tier: 0 }, deps), driver);
    const answer = parse(
      await hxComputerStepToolCall(base, { tool: "computer_do", arguments: { app: "TextEdit", steps: [keys] } }),
    );
    expect(answer.status).toBe("done");
    expect(driver.tools).toContain("bring_to_front");
    // Bringing the window to the front is HXBot's input from its start, as the key after it is.
    const brought = driver.tools.indexOf("bring_to_front");
    expect(own.some((entry) => entry.tools === brought)).toBe(true);
    // The consent is used up with the call.
    expect(deps.parked.consented("a")).toBe(false);
  });

  it("gives a screenshot with computer_look, as an image item, and takes no lane for it", async () => {
    const { deps } = workDeps();
    const busy = await deps.lanes.acquire(hxAppLane("TextEdit"), { agentId: "b", tier: 0 }, Date.now() + 60_000);
    const { base } = toolDeps(hxStepWork({ agentId: "a", tier: 2 }, deps));
    const result = await hxComputerStepToolCall(base, {
      tool: "computer_look",
      arguments: { app: "TextEdit", screenshot: true },
    });
    expect(parse(result).status).toBe("window");
    expect(result.contentItems[1]).toEqual({ type: "inputImage", imageUrl: "data:image/png;base64,png" });
    if (busy.ok) busy.lease.release();
  });
});

describe("the system lane", () => {
  const action = async () => ({ success: true, contentItems: [{ type: "inputText" as const, text: "{}" }] });

  it("runs one at a time and never while another agent has the front", async () => {
    const lanes = new HxComputerLanes();
    const focus = await lanes.acquire("focus", { agentId: "b", tier: 0 }, Date.now() + 60_000);
    let ran = false;
    const call = hxSystemTurn(
      { agentId: "a", tier: 0 },
      { lanes, presence: presence(60_000), stopped: () => false },
      async () => {
        ran = true;
        return action();
      },
    );
    // The call waits in the system lane while the other agent holds the front.
    await vi.waitFor(() => expect(lanes.moreUrgentWaits("system", 9)).toBe(true));
    expect(ran).toBe(false);
    if (focus.ok) focus.lease.release();
    expect((await call).success).toBe(true);
    expect(ran).toBe(true);
    expect(lanes.holders().size).toBe(0);
  });

  it("waits for 60 seconds of rest for a routine, and does nothing when the user keeps working", async () => {
    let now = 0;
    const lanes = new HxComputerLanes();
    let ran = false;
    const result = await hxSystemTurn(
      { agentId: "a", tier: 3 },
      {
        lanes,
        presence: presence(10_000),
        stopped: () => false,
        now: () => now,
        wait: async (ms) => {
          now += ms;
        },
      },
      async () => {
        ran = true;
        return action();
      },
    );
    expect(ran).toBe(false);
    expect(JSON.parse(result.contentItems[0]?.type === "inputText" ? result.contentItems[0].text : "{}").status).toBe(
      "waiting_user",
    );
    // The user's own message opens at once.
    expect(
      (await hxSystemTurn({ agentId: "a", tier: 0 }, { lanes, presence: presence(0), stopped: () => false }, action))
        .success,
    ).toBe(true);
  });

  it("refuses after the stop keys and lets the lane go when the action throws", async () => {
    const lanes = new HxComputerLanes();
    const stopped = await hxSystemTurn(
      { agentId: "a", tier: 0 },
      { lanes, presence: presence(0), stopped: () => true },
      action,
    );
    expect(stopped.success).toBe(false);
    await expect(
      hxSystemTurn({ agentId: "a", tier: 0 }, { lanes, presence: presence(0), stopped: () => false }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(lanes.holders().size).toBe(0);
  });
});

describe("a team on one computer, under stress", () => {
  it("runs 24 members' calls in 6 apps with the system tools between, and leaves nothing held", async () => {
    const { deps } = workDeps();
    const apps = ["TextEdit", "Notes", "Mail", "Safari", "Excel", "Word"];
    const results: Array<HxRunResult["status"] | string> = [];
    const member = async (id: number) => {
      for (let round = 0; round < 5; round += 1) {
        if ((id + round) % 4 === 0) {
          const result = await hxSystemTurn(
            { agentId: `m${id}`, tier: id % 4 },
            { lanes: deps.lanes, presence: deps.presence, stopped: () => false },
            async () => ({ success: true, contentItems: [{ type: "inputText" as const, text: "{}" }] }),
          );
          results.push(result.success ? "system" : "system-busy");
          continue;
        }
        const app = apps[(id + round) % apps.length] ?? "TextEdit";
        const driver = new Driver();
        const listed: HxDriverPort = {
          call: async (tool, args) => {
            const answer = await driver.call(tool);
            if (tool === "list_windows" || tool === "get_window_state") {
              const content = JSON.parse(JSON.stringify(answer.content ?? {}).replaceAll("TextEdit", app));
              return { ...answer, content };
            }
            void args;
            return answer;
          },
        };
        const { base } = toolDeps(hxStepWork({ agentId: `m${id}`, tier: id % 4 }, deps), driver);
        base.driver = listed;
        const answer = parse(
          await hxComputerStepToolCall(base, { tool: "computer_do", arguments: { app, steps: [keys, keys] } }),
        );
        results.push(answer.status);
      }
    };
    await Promise.all(Array.from({ length: 24 }, (_, id) => member(id)));
    expect(results).toHaveLength(120);
    expect(results.filter((status) => status === "done" || status === "system").length).toBeGreaterThan(100);
    expect(deps.lanes.holders().size).toBe(0);
    expect(deps.lanes.active()).toBe(false);
  });
});
