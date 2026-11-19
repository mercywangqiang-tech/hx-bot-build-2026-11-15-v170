import { describe, expect, it } from "vitest";
import { HxComputerGate, type HxGateDeps, type HxGatePresence, hxFrontIsTarget } from "./gate";
import { HxComputerLanes, HxLeaseSet, HxWaitBudget, hxAppLane } from "./lanes";

// HXBot 电脑操控（五）（v1.7.3，CONC-05、CONC-06）：每一步前台操作之前的门（gate.ts）。

const WINDOW = { pid: 7, windowId: 70, app: "TextEdit", title: "Notes" };

interface GateState {
  idle: number;
  locked: boolean;
  known: boolean;
  actedSince: boolean;
  front: { pid: number; windowId: number | null } | null;
  consent: boolean;
  stopped: boolean;
  waited: number;
  brought: number;
  inputs: Array<[number, number]>;
  onWait: null | (() => void);
}

function setup(change: { tier?: number; budgetMs?: number } & Partial<HxGateDeps> = {}) {
  let now = 1_000_000;
  const state: GateState = {
    idle: 10_000,
    locked: false,
    known: true,
    actedSince: false,
    front: { pid: 7, windowId: 70 },
    consent: false,
    stopped: false,
    waited: 0,
    brought: 0,
    inputs: [],
    onWait: null,
  };
  const presence: HxGatePresence = {
    known: () => state.known,
    userIdleMs: () => state.idle,
    userActedSince: () => state.actedSince,
    locked: () => state.locked,
    beginOwnInput: () => {
      const start = now;
      return () => {
        state.inputs.push([start, now]);
      };
    },
  };
  const lanes = new HxComputerLanes({ now: () => now });
  const budget = new HxWaitBudget(change.budgetMs ?? 30_000, () => now);
  const leases = new HxLeaseSet(lanes, { agentId: "a", name: "A", tier: change.tier ?? 2 }, budget);
  const app = hxAppLane("TextEdit");
  const deps: HxGateDeps = {
    leases,
    app,
    presence,
    frontWindow: async () => state.front,
    known: new Set([70, 71]),
    consented: () => state.consent,
    bringToFront: async () => {
      state.brought += 1;
      state.front = { pid: 7, windowId: 70 };
      return true;
    },
    parkedAlready: false,
    stopped: () => state.stopped,
    wait: async (ms) => {
      state.waited += ms;
      now += ms;
      state.onWait?.();
    },
    now: () => now,
    ...change,
  };
  return { state, lanes, leases, budget, app, gate: new HxComputerGate(deps), move: (ms: number) => (now += ms) };
}

describe("the window in front", () => {
  it("is the target when it is the same window, or a window of the app that the work opened", () => {
    const known = new Set([70, 71]);
    expect(hxFrontIsTarget({ pid: 7, windowId: 70 }, WINDOW, known)).toBe(true);
    // The user's other window of the same app.
    expect(hxFrontIsTarget({ pid: 7, windowId: 71 }, WINDOW, known)).toBe(false);
    // A dialog that the step opened.
    expect(hxFrontIsTarget({ pid: 7, windowId: 72 }, WINDOW, known)).toBe(true);
    expect(hxFrontIsTarget({ pid: 8, windowId: 80 }, WINDOW, known)).toBe(false);
    // Only the app can be told: the app decides, as in v1.7.0.
    expect(hxFrontIsTarget({ pid: 7, windowId: null }, WINDOW, known)).toBe(true);
    expect(hxFrontIsTarget(null, WINDOW, known)).toBe(true);
  });
});

describe("the gate", () => {
  it("gives the front while the user rests and the window is in front, and lets it go after the step", async () => {
    const { gate, leases, app, lanes } = setup();
    await leases.take(app);
    expect(await gate.front(WINDOW)).toBeNull();
    expect(lanes.holders().get("focus")?.agentId).toBe("a");
    // A second input of the same step does not ask again.
    expect(await gate.front(WINDOW)).toBeNull();
    expect(gate.after()).toBeNull();
    expect(lanes.holders().has("focus")).toBe(false);
    leases.releaseAll();
  });

  it("waits while the user types, then parks after the budget", async () => {
    const { gate, leases, app, state, lanes } = setup({ budgetMs: 5_000 });
    await leases.take(app);
    state.idle = 500;
    const stop = await gate.front(WINDOW);
    expect(stop?.stop).toBe("waiting_user");
    if (stop?.stop === "waiting_user") {
      expect(stop.why).toBe("user_active");
      expect(stop.reason).toContain("5 seconds");
      expect(stop.reason).toContain("现在做");
    }
    expect(state.waited).toBeGreaterThanOrEqual(5_000);
    expect(lanes.holders().has("focus")).toBe(false);
    leases.releaseAll();
  });

  it("goes on when the user stops while it waits", async () => {
    const { gate, leases, app, state } = setup();
    await leases.take(app);
    state.idle = 0;
    let looks = 0;
    // The user stops typing after three looks.
    state.onWait = () => {
      looks += 1;
      if (looks >= 3) state.idle = 9_000;
    };
    expect(await gate.front(WINDOW)).toBeNull();
    expect(state.waited).toBe(3_000);
    leases.releaseAll();
  });

  it("parks at once when the screen is locked, or when the work was parked already", async () => {
    const locked = setup();
    await locked.leases.take(locked.app);
    locked.state.locked = true;
    const stop = await locked.gate.front(WINDOW);
    expect(stop?.stop === "waiting_user" && stop.why).toBe("locked");
    expect(locked.state.waited).toBe(0);
    locked.leases.releaseAll();

    const again = setup({ parkedAlready: true });
    await again.leases.take(again.app);
    again.state.front = { pid: 7, windowId: 71 };
    const parked = await again.gate.front(WINDOW);
    expect(parked?.stop === "waiting_user" && parked.why).toBe("other_window");
    expect(again.state.waited).toBe(0);
    again.leases.releaseAll();
  });

  it("parks when the user's other window of the same app is in front", async () => {
    const { gate, leases, app, state } = setup({ budgetMs: 2_000 });
    await leases.take(app);
    state.front = { pid: 7, windowId: 71 };
    const stop = await gate.front(WINDOW);
    expect(stop?.stop === "waiting_user" && stop.why).toBe("other_window");
    leases.releaseAll();
  });

  it("needs 60 seconds of rest for a routine", async () => {
    const { gate, leases, app, state } = setup({ tier: 3, budgetMs: 1_000 });
    await leases.take(app);
    state.idle = 30_000;
    const stop = await gate.front(WINDOW);
    expect(stop?.stop === "waiting_user" && stop.reason).toContain("60 seconds");
    leases.releaseAll();
  });

  it("parks the rest of the run when the user acted after a front step of it", async () => {
    const { gate, leases, app, state } = setup();
    await leases.take(app);
    expect(await gate.front(WINDOW)).toBeNull();
    gate.after();
    state.actedSince = true;
    const stop = await gate.front(WINDOW);
    expect(stop?.stop === "waiting_user" && stop.why).toBe("user_active");
    expect(state.waited).toBe(0);
    leases.releaseAll();
  });

  it("with the user's “现在做”, brings the window to the front and does not wait for the rest", async () => {
    const { gate, leases, app, state } = setup();
    await leases.take(app);
    state.consent = true;
    state.idle = 0;
    state.actedSince = true;
    state.front = { pid: 9, windowId: 90 };
    expect(await gate.front(WINDOW)).toBeNull();
    expect(state.brought).toBe(1);
    gate.after();
    expect(await gate.front(WINDOW)).toBeNull();
    expect(state.brought).toBe(1);
    leases.releaseAll();
  });

  it("answers busy when another agent holds the front past the budget", async () => {
    const { gate, leases, app, lanes } = setup({ budgetMs: 30 });
    await leases.take(app);
    const other = await lanes.acquire("focus", { agentId: "b", name: "Bob", tier: 2 }, Date.now() + 10_000);
    const stop = await gate.front(WINDOW);
    expect(stop?.stop).toBe("busy");
    expect(stop?.reason).toContain("Bob");
    if (other.ok) other.lease.release();
    leases.releaseAll();
  });

  it("stops after the stop keys, and when the app lane was taken back", async () => {
    const stopped = setup();
    await stopped.leases.take(stopped.app);
    stopped.state.stopped = true;
    expect((await stopped.gate.front(WINDOW))?.stop).toBe("stopped");
    expect(stopped.gate.check()?.stop).toBe("stopped");
    stopped.leases.releaseAll();

    const taken = setup();
    await taken.leases.take(taken.app);
    expect(taken.gate.check()).toBeNull();
    taken.lanes.stopAll();
    expect(taken.gate.check()?.stop).toBe("stopped");
    taken.leases.releaseAll();
  });

  it("lets a more urgent agent go first after a step", async () => {
    const { gate, leases, app, lanes } = setup({ tier: 3 });
    await leases.take(app);
    expect(gate.after()).toBeNull();
    const user = lanes.acquire(app, { agentId: "u", tier: 0 }, Date.now() + 10_000);
    const stop = gate.after();
    expect(stop?.stop).toBe("busy");
    leases.releaseAll();
    const answer = await user;
    expect(answer.ok).toBe(true);
    if (answer.ok) answer.lease.release();
  });

  it("takes only the focus lane when the user's presence cannot be read", async () => {
    const { gate, leases, app, state, move } = setup();
    await leases.take(app);
    state.known = false;
    state.idle = 0;
    state.front = { pid: 9, windowId: 90 };
    expect(await gate.front(WINDOW)).toBeNull();
    const done = gate.ownInput();
    const end = move(5);
    done();
    expect(state.inputs).toEqual([[end - 5, end]]);
    leases.releaseAll();
  });
});
