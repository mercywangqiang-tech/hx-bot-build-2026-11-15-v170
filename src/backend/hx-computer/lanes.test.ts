import { describe, expect, it } from "vitest";
import {
  HX_LANE_BUDGET_MS,
  HxComputerLanes,
  type HxLaneAnswer,
  type HxLaneName,
  HxLeaseSet,
  HxWaitBudget,
  hxAppLane,
} from "./lanes";

// HXBot 电脑操控（五）（v1.7.3，CONC-05）：电脑操作分道（lanes.ts），含压力测试。

const FAR = () => Date.now() + 60_000;
const holder = (agentId: string, tier = 2) => ({ agentId, name: agentId, tier });

async function held(answer: Promise<HxLaneAnswer>) {
  const value = await answer;
  if (!value.ok) throw new Error(`not granted: ${value.reason}`);
  return value.lease;
}

/** Lets every pending promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the lanes", () => {
  it("names an app by its plain name", () => {
    expect(hxAppLane("TextEdit")).toBe(hxAppLane("text edit"));
    expect(hxAppLane("Microsoft-Word.exe")).toBe("app:microsoftwordexe");
    expect(hxAppLane("   ")).toBe("app:unknown");
    expect(hxAppLane("ｔｅｘｔ")).toBe("app:text");
    expect(hxAppLane("a".repeat(200)).length).toBe(4 + 60);
  });

  it("gives one app to one agent at a time, and two apps to two agents at once", async () => {
    const lanes = new HxComputerLanes();
    const a = await held(lanes.acquire(hxAppLane("Notes"), holder("a"), FAR()));
    const b = await held(lanes.acquire(hxAppLane("Mail"), holder("b"), FAR()));
    let got = false;
    const c = lanes.acquire(hxAppLane("notes"), holder("c"), FAR()).then((answer) => {
      got = answer.ok;
      return answer;
    });
    await settle();
    expect(got).toBe(false);
    a.release();
    expect((await c).ok).toBe(true);
    b.release();
  });

  it("lets at most three apps run at once", async () => {
    const lanes = new HxComputerLanes();
    const leases = await Promise.all(
      ["a", "b", "c"].map((app) => held(lanes.acquire(hxAppLane(app), holder(app), FAR()))),
    );
    let fourth = false;
    const d = lanes.acquire(hxAppLane("d"), holder("d"), FAR()).then((answer) => {
      fourth = answer.ok;
      return answer;
    });
    await settle();
    expect(fourth).toBe(false);
    leases[1]?.release();
    expect((await d).ok).toBe(true);
  });

  it("keeps focus and system apart, and each to one holder", async () => {
    const lanes = new HxComputerLanes();
    const focus = await held(lanes.acquire("focus", holder("a"), FAR()));
    const quick = await lanes.acquire("system", holder("b"), Date.now() + 30);
    expect(quick.ok).toBe(false);
    if (!quick.ok) {
      expect(quick.why).toBe("busy");
      expect(quick.reason).toContain("(a)");
    }
    const second = await lanes.acquire("focus", holder("c"), Date.now() + 30);
    expect(second.ok).toBe(false);
    focus.release();
    const system = await held(lanes.acquire("system", holder("b"), FAR()));
    expect((await lanes.acquire("focus", holder("a"), Date.now() + 20)).ok).toBe(false);
    system.release();
  });

  it("serves the more urgent tier first, and within a tier the earlier one", async () => {
    const lanes = new HxComputerLanes();
    const first = await held(lanes.acquire("focus", holder("x", 2), FAR()));
    const order: string[] = [];
    const wait = (name: string, tier: number) =>
      lanes.acquire("focus", holder(name, tier), FAR()).then((answer) => {
        order.push(name);
        if (answer.ok) setTimeout(() => answer.lease.release(), 0);
      });
    const all = [wait("routine", 3), wait("team-a", 2), wait("user", 0), wait("team-b", 2)];
    await settle();
    first.release();
    await Promise.all(all);
    expect(order).toEqual(["user", "team-a", "team-b", "routine"]);
  });

  it("keeps a call's place in its tier when it takes the lane again (the first number)", async () => {
    const lanes = new HxComputerLanes();
    const early = lanes.nextOrder();
    const first = await held(lanes.acquire("focus", holder("a"), FAR(), early));
    first.release();
    const other = await held(lanes.acquire("focus", holder("b"), FAR()));
    const order: string[] = [];
    const late = lanes.acquire("focus", holder("c"), FAR()).then(() => order.push("c"));
    const again = lanes.acquire("focus", holder("a"), FAR(), early).then((answer) => {
      order.push("a");
      if (answer.ok) answer.lease.release();
    });
    await settle();
    other.release();
    await again;
    await late;
    expect(order[0]).toBe("a");
  });

  it("answers busy at the deadline with the reason and an estimate, and never rejects", async () => {
    const lanes = new HxComputerLanes();
    const app = hxAppLane("Excel");
    const a = await held(lanes.acquire(app, holder("a"), FAR()));
    a.release();
    const b = await held(lanes.acquire(app, holder("Alice"), FAR()));
    const answer = await lanes.acquire(app, holder("c"), Date.now() + 25);
    expect(answer.ok).toBe(false);
    if (!answer.ok) {
      expect(answer.why).toBe("busy");
      expect(answer.reason).toContain("Alice");
      expect(answer.etaMs).not.toBeNull();
      expect(answer.waitedMs).toBeGreaterThanOrEqual(20);
    }
    // A deadline in the past answers at once.
    const now = await lanes.acquire(app, holder("d"), Date.now() - 1);
    expect(now.ok).toBe(false);
    b.release();
    expect(lanes.active()).toBe(false);
  });

  it("stops every waiter and takes back every held lane with the stop keys", async () => {
    const lanes = new HxComputerLanes();
    const focus = await held(lanes.acquire("focus", holder("a"), FAR()));
    const app = await held(lanes.acquire(hxAppLane("Notes"), holder("a"), FAR()));
    const waiting = lanes.acquire("focus", holder("b"), FAR());
    lanes.stopAll();
    const answer = await waiting;
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.why).toBe("stopped");
    expect(focus.alive()).toBe(false);
    expect(app.alive()).toBe(false);
    expect(lanes.holders().size).toBe(0);
    // A late release of a taken-back lane does not free a lane someone else holds now.
    const next = await held(lanes.acquire("focus", holder("c"), FAR()));
    focus.release();
    expect(lanes.holders().get("focus")?.agentId).toBe("c");
    next.release();
  });

  it("releases a lease once: a second release does nothing", async () => {
    const lanes = new HxComputerLanes();
    const a = await held(lanes.acquire("system", holder("a"), FAR()));
    a.release();
    const b = await held(lanes.acquire("system", holder("b"), FAR()));
    a.release();
    expect(lanes.holders().get("system")?.agentId).toBe("b");
    b.release();
  });

  it("tells whether a more urgent agent waits", async () => {
    const lanes = new HxComputerLanes();
    const app = hxAppLane("Notes");
    const a = await held(lanes.acquire(app, holder("a", 3), FAR()));
    expect(lanes.moreUrgentWaits(app, 3)).toBe(false);
    const user = lanes.acquire(app, holder("u", 0), FAR());
    expect(lanes.moreUrgentWaits(app, 3)).toBe(true);
    expect(lanes.moreUrgentWaits(app, 0)).toBe(false);
    a.release();
    const answer = await user;
    if (answer.ok) answer.lease.release();
  });
});

describe("the leases of one call", () => {
  it("takes each lane once, spends the waited time on the budget, and lets everything go", async () => {
    const lanes = new HxComputerLanes();
    const budget = new HxWaitBudget(200);
    const set = new HxLeaseSet(lanes, holder("a"), budget);
    expect((await set.take(hxAppLane("Notes"))).ok).toBe(true);
    expect((await set.take(hxAppLane("Notes"))).ok).toBe(true);
    expect(set.count()).toBe(1);
    const other = await held(lanes.acquire("focus", holder("b"), FAR()));
    const busy = await set.take("focus");
    expect(busy.ok).toBe(false);
    expect(budget.left()).toBeLessThan(50);
    expect(budget.waited()).toBeGreaterThan(150);
    other.release();
    set.releaseAll();
    expect(set.count()).toBe(0);
    expect(lanes.holders().size).toBe(0);
  });

  it("does not count the work between waits, only the waits", () => {
    let now = 1_000;
    const budget = new HxWaitBudget(HX_LANE_BUDGET_MS, () => now);
    now += 50_000;
    expect(budget.left()).toBe(HX_LANE_BUDGET_MS);
    budget.spend(10_000);
    budget.spend(-5);
    expect(budget.left()).toBe(20_000);
    expect(budget.deadline()).toBe(now + 20_000);
    expect(budget.elapsed()).toBe(50_000);
  });

  it("sees a lane the stop keys took back as not held", async () => {
    const lanes = new HxComputerLanes();
    const set = new HxLeaseSet(lanes, holder("a"), new HxWaitBudget());
    await set.take(hxAppLane("Notes"));
    expect(set.holds(hxAppLane("Notes"))).toBe(true);
    lanes.stopAll();
    expect(set.holds(hxAppLane("Notes"))).toBe(false);
    expect(set.shouldYield(hxAppLane("Notes"))).toBe(false);
    set.releaseAll();
  });
});

describe("the lanes under stress", () => {
  it("serves 60 agents on random lanes with no lost waiter, no two holders and never focus with system", async () => {
    const lanes = new HxComputerLanes();
    const apps = ["a", "b", "c", "d", "e"].map(hxAppLane);
    const choices: HxLaneName[] = [...apps, "focus", "system"];
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const violations: string[] = [];
    const check = () => {
      const holders = lanes.holders();
      if (holders.has("focus") && holders.has("system")) violations.push("focus and system");
      const running = [...holders.keys()].filter((lane) => lane.startsWith("app:")).length;
      if (running > 3) violations.push(`${running} apps`);
    };
    let granted = 0;
    let busy = 0;
    const agent = async (id: number) => {
      for (let round = 0; round < 8; round += 1) {
        const set = new HxLeaseSet(lanes, holder(`agent-${id}`, random(4)), new HxWaitBudget(2_000));
        const app = apps[random(apps.length)] ?? "app:a";
        const first = await set.take(random(5) === 0 ? "system" : app);
        if (first.ok) {
          granted += 1;
          check();
          if (first.lease.lane !== "system") {
            const front = await set.take(choices[5] ?? "focus");
            if (front.ok) {
              granted += 1;
              check();
              await new Promise((resolve) => setTimeout(resolve, random(3)));
              set.drop("focus");
            } else busy += 1;
          }
        } else busy += 1;
        set.releaseAll();
      }
    };
    await Promise.all(Array.from({ length: 60 }, (_, id) => agent(id)));
    expect(violations).toEqual([]);
    expect(granted).toBeGreaterThan(400);
    expect(busy).toBeGreaterThanOrEqual(0);
    expect(lanes.holders().size).toBe(0);
    expect(lanes.active()).toBe(false);
  });

  it("stops 200 waiters at once and is usable right after", async () => {
    const lanes = new HxComputerLanes();
    const focus = await held(lanes.acquire("focus", holder("x"), FAR()));
    const waits = Array.from({ length: 200 }, (_, i) => lanes.acquire("focus", holder(`w${i}`, i % 4), FAR()));
    lanes.stopAll();
    const answers = await Promise.all(waits);
    expect(answers.every((answer) => !answer.ok && answer.why === "stopped")).toBe(true);
    expect(focus.alive()).toBe(false);
    const again = await held(lanes.acquire("focus", holder("y"), FAR()));
    again.release();
    expect(lanes.active()).toBe(false);
  });

  it("times out 100 waiters with short deadlines and leaves no timer or waiter behind", async () => {
    const lanes = new HxComputerLanes();
    const system = await held(lanes.acquire("system", holder("x"), FAR()));
    const answers = await Promise.all(
      Array.from({ length: 100 }, (_, i) => lanes.acquire("focus", holder(`w${i}`), Date.now() + (i % 10))),
    );
    expect(answers.every((answer) => !answer.ok && answer.why === "busy")).toBe(true);
    system.release();
    expect(lanes.active()).toBe(false);
  });
});
