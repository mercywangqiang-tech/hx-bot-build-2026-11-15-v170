import { describe, expect, it } from "vitest";
import { HX_NOW_CONSENT_MS, HX_PARK_REMIND_MS, HxParkedSteps, type HxParkedWork, hxSameWindow } from "./parked";
import { HX_BACKGROUND_IDLE_MS, HX_USER_IDLE_MS, HxPresence, hxIdleNeeded, hxSetForegroundIdle } from "./presence";

// HXBot 电脑操控（五）（v1.7.3，CONC-06）：你在不在用电脑（presence.ts）和停放续做（parked.ts），含压力测试。

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    move: (ms: number) => {
      now += ms;
    },
  };
}

/** A system idle time made of the last input, as Electron reports it: whole seconds. */
function system(time: ReturnType<typeof clock>) {
  let lastInput = time.now() - 600_000;
  let locked = false;
  return {
    source: {
      idleSeconds: () => Math.floor((time.now() - lastInput) / 1000),
      locked: () => locked,
    },
    input: () => {
      lastInput = time.now();
    },
    lock: (value: boolean) => {
      locked = value;
    },
  };
}

describe("the user's presence", () => {
  it("needs 5 seconds for the user's own work and 60 for routines", () => {
    expect(hxIdleNeeded(0)).toBe(HX_USER_IDLE_MS);
    expect(hxIdleNeeded(2)).toBe(5_000);
    expect(hxIdleNeeded(3)).toBe(HX_BACKGROUND_IDLE_MS);
    expect(hxIdleNeeded(3)).toBe(60_000);
  });

  it("cannot tell without a source, and then holds nothing back", () => {
    const presence = new HxPresence();
    expect(presence.known()).toBe(false);
    expect(presence.userIdleMs()).toBe(Number.POSITIVE_INFINITY);
    expect(presence.userActedSince(0)).toBe(false);
    expect(presence.locked()).toBe(false);
  });

  it("reads the user's input, and does not count HXBot's own input as the user's", () => {
    const time = clock();
    const machine = system(time);
    const presence = new HxPresence(time.now);
    presence.setSource(machine.source);
    expect(presence.userIdleMs()).toBeGreaterThanOrEqual(599_000);
    // HXBot types: the system's last input moves, the user's does not.
    const start = time.now();
    machine.input();
    time.move(400);
    presence.noteOwnInput(start, time.now());
    time.move(2_000);
    expect(presence.userIdleMs()).toBeGreaterThanOrEqual(600_000);
    // The user moves the mouse.
    time.move(5_000);
    machine.input();
    const at = time.now();
    time.move(1_200);
    expect(presence.userIdleMs()).toBeLessThan(2_000);
    expect(presence.userActedSince(at - 100)).toBe(true);
    time.move(6_000);
    expect(presence.userIdleMs()).toBeGreaterThanOrEqual(HX_USER_IDLE_MS);
  });

  it("counts HXBot's input as its own from the start, when another agent reads the presence meanwhile", () => {
    const time = clock();
    const machine = system(time);
    const presence = new HxPresence(time.now);
    presence.setSource(machine.source);
    presence.userIdleMs();
    // Agent A presses a key; the driver call takes 1.2 s. Agent B's gate reads the presence in between
    // (real check of v1.7.3, macOS 15: B's read made A's own key the user's, and A parked).
    const done = presence.beginOwnInput();
    time.move(50);
    machine.input();
    time.move(1_000);
    expect(presence.userIdleMs()).toBeGreaterThan(500_000);
    time.move(150);
    done();
    const ended = time.now();
    time.move(300);
    expect(presence.userActedSince(ended - 2_000)).toBe(false);
    // The user's input after the end and its moment counts again; a second end does nothing.
    done();
    time.move(1_500);
    machine.input();
    time.move(100);
    expect(presence.userIdleMs()).toBeLessThan(1_500);
  });

  it("counts input more than a second after HXBot's as the user's", () => {
    const time = clock();
    const machine = system(time);
    const presence = new HxPresence(time.now);
    presence.setSource(machine.source);
    presence.userIdleMs();
    const start = time.now();
    machine.input();
    presence.noteOwnInput(start, time.now());
    time.move(2_500);
    machine.input();
    time.move(100);
    expect(presence.userIdleMs()).toBeLessThan(1_500);
  });

  it("treats a source that fails as the user being there, and the lock as locked", () => {
    const presence = new HxPresence();
    presence.setSource({
      idleSeconds: () => {
        throw new Error("no");
      },
      locked: () => {
        throw new Error("no");
      },
    });
    expect(presence.userIdleMs()).toBe(0);
    expect(presence.locked()).toBe(false);
    const time = clock();
    const machine = system(time);
    presence.setSource(machine.source);
    machine.lock(true);
    expect(presence.locked()).toBe(true);
  });

  it("keeps a bounded list of HXBot's own inputs under stress", () => {
    const time = clock();
    const machine = system(time);
    const presence = new HxPresence(time.now);
    presence.setSource(machine.source);
    presence.userIdleMs();
    for (let i = 0; i < 20_000; i += 1) {
      const start = time.now();
      machine.input();
      time.move(10);
      presence.noteOwnInput(start, time.now());
      time.move(40);
    }
    // 1000 seconds of HXBot's own clicks: the user has still not been seen since the start.
    time.move(1_100);
    expect(presence.userIdleMs()).toBeGreaterThan(1_000_000);
  });
});

function work(agentId: string, extra: Partial<HxParkedWork> = {}): HxParkedWork {
  return {
    agentId,
    tier: 2,
    window: { pid: 7, windowId: 70, app: "TextEdit", title: "Notes" },
    remaining: 2,
    since: 1_000_000,
    why: "user_active",
    ...extra,
  };
}

function host(time: ReturnType<typeof clock>) {
  const resumed: string[] = [];
  const reminded: string[] = [];
  const state: {
    idle: number;
    locked: boolean;
    front: { pid: number; windowId: number | null } | null;
    auto: boolean;
    fronts: number;
  } = { idle: 10_000, locked: false, front: { pid: 7, windowId: 70 }, auto: true, fronts: 0 };
  return {
    state,
    resumed,
    reminded,
    host: {
      userIdleMs: () => state.idle,
      locked: () => state.locked,
      frontWindow: async () => {
        state.fronts += 1;
        return state.front;
      },
      resume: async (parked: HxParkedWork) => {
        resumed.push(parked.agentId);
      },
      autoResume: () => state.auto,
      remind: (parked: HxParkedWork) => {
        reminded.push(`${parked.agentId}@${time.now()}`);
      },
    },
  };
}

/** A watch that never ticks by itself: the test calls check(). */
const never = () => setInterval(() => {}, 1_000_000);

describe("the parked steps", () => {
  it("knows the same window, and the same app only where the window cannot be told", () => {
    const window = { pid: 7, windowId: 70 };
    expect(hxSameWindow({ pid: 7, windowId: 70 }, window)).toBe(true);
    expect(hxSameWindow({ pid: 7, windowId: 71 }, window)).toBe(false);
    expect(hxSameWindow({ pid: 7, windowId: null }, window)).toBe(true);
    expect(hxSameWindow({ pid: 8, windowId: null }, window)).toBe(false);
    expect(hxSameWindow(null, window)).toBe(false);
  });

  it("sends “continue” once, when the user rests and the window is in front", async () => {
    const time = clock();
    const parked = new HxParkedSteps({ now: time.now, every: never });
    const watch = host(time);
    parked.setHost(watch.host);
    parked.park(work("a"));
    watch.state.idle = 1_000;
    await parked.check();
    expect(watch.resumed).toEqual([]);
    watch.state.idle = 6_000;
    watch.state.front = { pid: 7, windowId: 71 };
    await parked.check();
    expect(watch.resumed).toEqual([]);
    watch.state.front = { pid: 7, windowId: 70 };
    await parked.check();
    await parked.check();
    expect(watch.resumed).toEqual(["a"]);
    expect(parked.size()).toBe(0);
  });

  it("waits 60 seconds for a routine, and never resumes while the screen is locked", async () => {
    const time = clock();
    const parked = new HxParkedSteps({ now: time.now, every: never });
    const watch = host(time);
    parked.setHost(watch.host);
    parked.park(work("routine", { tier: 3 }));
    watch.state.idle = 30_000;
    await parked.check();
    expect(watch.resumed).toEqual([]);
    watch.state.idle = 61_000;
    watch.state.locked = true;
    await parked.check();
    expect(watch.resumed).toEqual([]);
    expect(watch.state.fronts).toBe(0);
    watch.state.locked = false;
    await parked.check();
    expect(watch.resumed).toEqual(["routine"]);
  });

  it("keeps the step for “现在做” when “停放后自动续做” is off", async () => {
    const time = clock();
    const parked = new HxParkedSteps({ now: time.now, every: never });
    const watch = host(time);
    watch.state.auto = false;
    parked.setHost(watch.host);
    parked.park(work("a"));
    await parked.check();
    expect(watch.resumed).toEqual([]);
    expect(parked.get("a")).not.toBeNull();
    // Nothing to resume by itself: the watch does not read the front window for it.
    expect(watch.state.fronts).toBe(0);
  });

  it("reads the front window every 5 seconds, not every second, for work parked over a minute", async () => {
    const time = clock();
    const parked = new HxParkedSteps({ now: time.now, every: never });
    const watch = host(time);
    watch.state.front = { pid: 9, windowId: 90 };
    parked.setHost(watch.host);
    parked.park(work("a", { since: time.now() }));
    await parked.check();
    time.move(1_000);
    await parked.check();
    expect(watch.state.fronts).toBe(2);
    time.move(60_000);
    await parked.check();
    time.move(1_000);
    await parked.check();
    time.move(3_000);
    await parked.check();
    expect(watch.state.fronts).toBe(3);
    time.move(1_000);
    watch.state.front = { pid: 7, windowId: 70 };
    await parked.check();
    expect(watch.state.fronts).toBe(4);
    expect(watch.resumed).toEqual(["a"]);
  });

  it("does not resume an agent whose computer call runs now", async () => {
    const time = clock();
    const parked = new HxParkedSteps({ now: time.now, every: never });
    const watch = host(time);
    parked.setHost(watch.host);
    parked.park(work("a"));
    parked.hold("a");
    parked.hold("a");
    await parked.check();
    parked.release("a");
    await parked.check();
    expect(watch.resumed).toEqual([]);
    parked.release("a");
    await parked.check();
    expect(watch.resumed).toEqual(["a"]);
  });

  it("reminds once after 30 minutes and keeps the step", async () => {
    const time = clock();
    const parked = new HxParkedSteps({ now: time.now, every: never });
    const watch = host(time);
    watch.state.idle = 0;
    parked.setHost(watch.host);
    parked.park(work("a", { since: time.now() }));
    time.move(HX_PARK_REMIND_MS - 1);
    await parked.check();
    expect(watch.reminded).toEqual([]);
    time.move(2);
    await parked.check();
    await parked.check();
    expect(watch.reminded).toHaveLength(1);
    expect(parked.get("a")).not.toBeNull();
  });

  it("holds the user's “现在做” for two minutes, and drops everything with the stop keys", () => {
    const time = clock();
    const parked = new HxParkedSteps({ now: time.now, every: never });
    parked.park(work("a"));
    parked.consent("a");
    expect(parked.consented("a")).toBe(true);
    time.move(HX_NOW_CONSENT_MS + 1);
    expect(parked.consented("a")).toBe(false);
    parked.consent("a");
    parked.useConsent("a");
    expect(parked.consented("a")).toBe(false);
    parked.consent("a");
    parked.dropAll();
    expect(parked.consented("a")).toBe(false);
    expect(parked.size()).toBe(0);
  });

  it("watches only while there is parked work and a host", () => {
    let started = 0;
    let timers: ReturnType<typeof setInterval>[] = [];
    const parked = new HxParkedSteps({
      every: (body, ms) => {
        started += 1;
        const timer = setInterval(body, ms * 1_000_000);
        timers.push(timer);
        return timer;
      },
    });
    parked.park(work("a"));
    expect(started).toBe(0);
    const time = clock();
    parked.setHost(host(time).host);
    expect(started).toBe(1);
    parked.park(work("b"));
    expect(started).toBe(1);
    parked.drop("a");
    parked.drop("b");
    parked.park(work("c"));
    expect(started).toBe(2);
    parked.setHost(null);
    for (const timer of timers) clearInterval(timer);
    timers = [];
  });

  it("survives a host that throws, and checks one at a time", async () => {
    const time = clock();
    const parked = new HxParkedSteps({ now: time.now, every: never });
    const watch = host(time);
    parked.setHost({
      ...watch.host,
      resume: async () => {
        throw new Error("mailbox down");
      },
      remind: () => {
        throw new Error("chat down");
      },
    });
    parked.park(work("a", { since: time.now() - HX_PARK_REMIND_MS - 1 }));
    await Promise.all([parked.check(), parked.check(), parked.check()]);
    expect(parked.size()).toBe(0);
  });

  it("resumes 200 parked agents once each while idle and the front flip under stress", async () => {
    const time = clock();
    const parked = new HxParkedSteps({ now: time.now, every: never });
    const watch = host(time);
    parked.setHost(watch.host);
    for (let i = 0; i < 200; i += 1)
      parked.park(work(`a${i}`, { window: { pid: i, windowId: 1000 + i, app: `App${i}`, title: "" } }));
    for (let round = 0; round < 400; round += 1) {
      const i = round % 200;
      watch.state.idle = round % 3 === 0 ? 1_000 : 9_000;
      watch.state.front = { pid: i, windowId: 1000 + i };
      if (round % 17 === 0)
        parked.park(work(`a${i}`, { window: { pid: i, windowId: 1000 + i, app: `App${i}`, title: "" } }));
      await parked.check();
    }
    const counts = new Map<string, number>();
    for (const id of watch.resumed) counts.set(id, (counts.get(id) ?? 0) + 1);
    // Each one is resumed at most once per time it was parked.
    expect([...counts.values()].every((count) => count <= 2)).toBe(true);
    expect(watch.resumed.length).toBeGreaterThan(150);
  });
});

describe("going on too early (v1.7.5, CONC-13)", () => {
  function earlyHost(time: ReturnType<typeof clock>) {
    const watch = host(time);
    const early: string[] = [];
    return {
      ...watch,
      early,
      host: { ...watch.host, wentOnTooEarly: (parked: HxParkedWork) => early.push(parked.agentId) },
    };
  }

  it("tells when the user uses the computer again within 3 seconds after the work went on", async () => {
    const time = clock();
    const parked = new HxParkedSteps({ now: time.now, every: never });
    const watch = earlyHost(time);
    parked.setHost(watch.host);
    parked.park(work("a"));
    watch.state.idle = 6_000;
    await parked.check();
    expect(watch.resumed).toEqual(["a"]);
    // One second later the user moves the mouse: the last input is after HXBot went on.
    time.move(1_000);
    watch.state.idle = 200;
    await parked.check();
    expect(watch.early).toEqual(["a"]);
    // Told once.
    time.move(1_000);
    await parked.check();
    expect(watch.early).toEqual(["a"]);
  });

  it("does not tell when the user rests for 3 seconds, or comes back later", async () => {
    const time = clock();
    const parked = new HxParkedSteps({ now: time.now, every: never });
    const watch = earlyHost(time);
    parked.setHost(watch.host);
    parked.park(work("a"));
    watch.state.idle = 6_000;
    await parked.check();
    for (let second = 0; second < 4; second += 1) {
      time.move(1_000);
      watch.state.idle += 1_000;
      await parked.check();
    }
    time.move(1_000);
    watch.state.idle = 100;
    await parked.check();
    expect(watch.early).toEqual([]);
  });

  it("a host without the hook is as before", async () => {
    const time = clock();
    const parked = new HxParkedSteps({ now: time.now, every: never });
    const watch = host(time);
    parked.setHost(watch.host);
    parked.park(work("a"));
    watch.state.idle = 6_000;
    await parked.check();
    time.move(1_000);
    watch.state.idle = 100;
    await parked.check();
    expect(watch.resumed).toEqual(["a"]);
  });

  it("the foreground pause follows the learned value, inside its limits", () => {
    hxSetForegroundIdle(() => 9_000);
    expect(hxIdleNeeded(0)).toBe(9_000);
    expect(hxIdleNeeded(3)).toBe(HX_BACKGROUND_IDLE_MS);
    hxSetForegroundIdle(() => Number.NaN);
    expect(hxIdleNeeded(1)).toBe(HX_USER_IDLE_MS);
    hxSetForegroundIdle(() => {
      throw new Error("broken");
    });
    expect(hxIdleNeeded(1)).toBe(HX_USER_IDLE_MS);
    hxSetForegroundIdle(null);
    expect(hxIdleNeeded(0)).toBe(HX_USER_IDLE_MS);
  });
});
