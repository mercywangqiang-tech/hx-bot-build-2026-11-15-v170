// HXBot v1.7.1 (HX-Flow): the unit acceptance items of the requirements V2.1, section 5.1:
// CONC-01 each factor alone and B from 1 to 16; CONC-03 4 tiers × 3 teams, a background turn that
// waited 360 s at tier 0, and the difficulty rule that stops itself; G5 the reminders of the four kinds
// of billing, not twice in 15 minutes. (The repository runs unit tests for HX rules that have no
// process of their own; the end-to-end acceptance is scripts/hx-flow-stress-e2e.ts.)
import { describe, expect, it } from "vitest";
import {
  HX_SPEND_GAP_MS,
  HX_USD_TO_YUAN,
  hxGoalOverlap,
  hxGuardState,
  hxLoopMove,
  hxLoopReceive,
  hxSpendDue,
  hxSpread,
  hxUnanswered,
  hxWorkTick,
} from "../hx-team/guards";
import { hxReadSpend } from "../hx-team/spend";
import { HxFlowBudget, type HxFlowSample, hxFlowTarget } from "./budget";
import { HxFlowLedger } from "./ledger";
import { type HxFlowCandidate, HxFlowDifficultyTimes, HxFlowShares, hxFlowEffectiveTier, hxFlowSort } from "./order";

const GIB = 1024 ** 3;

function sample(change: Partial<HxFlowSample> = {}): HxFlowSample {
  return {
    totalBytes: 32 * GIB,
    availableBytes: 20 * GIB,
    turnBytes: 2 * GIB,
    onBattery: false,
    thermal: "nominal",
    speedLimit: 100,
    loopP99Ms: 20,
    pressure: null,
    running: 0,
    ...change,
  };
}

describe("CONC-01: the budget B", () => {
  it("takes (available − max(2 GiB, 15 %)) / per turn, between 2 and 16", () => {
    // (20 − 4.8) / 2 = 7.6 → 7
    expect(hxFlowTarget(sample())).toBe(7);
    expect(hxFlowTarget(sample({ availableBytes: 3 * GIB }))).toBe(2);
    expect(hxFlowTarget(sample({ totalBytes: 512 * GIB, availableBytes: 400 * GIB }))).toBe(16);
  });

  it("applies each factor alone", () => {
    expect(hxFlowTarget(sample({ onBattery: true }))).toBe(5); // 7.6 × 0.75 = 5.7
    expect(hxFlowTarget(sample({ thermal: "serious" }))).toBe(3); // 7 × 0.5
    expect(hxFlowTarget(sample({ thermal: "critical" }))).toBe(1);
    expect(hxFlowTarget(sample({ speedLimit: 60 }))).toBe(5);
    expect(hxFlowTarget(sample({ speedLimit: 70 }))).toBe(7);
    expect(hxFlowTarget(sample({ loopP99Ms: 250 }))).toBe(6);
    expect(hxFlowTarget(sample({ loopP99Ms: 200 }))).toBe(7);
    expect(hxFlowTarget(sample({ pressure: "critical", running: 5 }))).toBe(4);
  });

  it("never goes below 1 or above 16", () => {
    for (const thermal of ["nominal", "fair", "serious", "critical"] as const)
      for (const onBattery of [false, true])
        for (const availableBytes of [0, 1 * GIB, 8 * GIB, 64 * GIB, 1024 * GIB])
          for (const loopP99Ms of [null, 10, 500]) {
            const budget = hxFlowTarget(
              sample({ thermal, onBattery, availableBytes, loopP99Ms, totalBytes: 1024 * GIB, speedLimit: 50 }),
            );
            expect(budget).toBeGreaterThanOrEqual(1);
            expect(budget).toBeLessThanOrEqual(16);
          }
  });

  it("goes down at once, up after 3 samples in a row, not up at pressure warn, and starts slow after sleep", () => {
    const budget = new HxFlowBudget();
    expect(budget.budget).toBe(2);
    expect(budget.sample(sample(), null)).toBe(7);
    // From 16 GiB to 4 GiB free: down at once (the E2E case: B 2 within 30 s).
    expect(budget.sample(sample({ totalBytes: 16 * GIB, availableBytes: 4 * GIB }), null)).toBe(2);
    expect(budget.sample(sample(), null)).toBe(2);
    expect(budget.sample(sample(), null)).toBe(2);
    expect(budget.sample(sample(), null)).toBe(7);
    budget.sample(sample({ availableBytes: 8 * GIB }), null);
    expect(budget.budget).toBe(1 + 0 + 1); // (8 − 4.8) / 2 = 1.6 → clamp 2
    for (let index = 0; index < 5; index += 1) budget.sample(sample({ pressure: "warn" }), null);
    expect(budget.budget).toBe(2);
    for (let index = 0; index < 3; index += 1) budget.sample(sample(), null);
    expect(budget.budget).toBe(7);
    budget.suspend();
    expect(budget.sample(sample({ availableBytes: 0 }), null)).toBe(7);
    budget.resume();
    expect(budget.budget).toBe(2);
  });

  it("learns the memory of one turn from the provider processes, idle ones not counted as the turn's", () => {
    const budget = new HxFlowBudget();
    // 8 processes of 256 MiB, 1 turn runs: one more turn costs one process, not the memory of all 8.
    for (let index = 0; index < 20; index += 1) budget.sample(sample({ running: 1 }), { bytes: 2 * GIB, processes: 8 });
    // 512 MiB a turn: (20 − 4.8) / 0.5 = 30 → 16.
    expect(budget.state().turnBytes).toBeLessThan(0.6 * GIB);
    expect(budget.budget).toBe(16);
  });
});

function candidate(change: Partial<HxFlowCandidate> & { lane: string }): HxFlowCandidate {
  return { tier: 2, readyAt: 0, teamId: null, order: 0, batch: null, difficulty: null, dependents: 0, ...change };
}

describe("CONC-03: the order of the queue", () => {
  const now = 1_000_000;

  it("orders 4 tiers × 3 teams by tier, then the share of each team", () => {
    const shares = new HxFlowShares();
    shares.add("A", 600, now);
    shares.add("B", 60, now);
    shares.add("C", 300, now);
    const times = new HxFlowDifficultyTimes();
    const context = { now, shares, times, lastEnded: () => undefined, batchStarts: () => 0 };
    const list: HxFlowCandidate[] = [];
    for (const tier of [3, 2, 1, 0] as const)
      for (const team of ["A", "B", "C"])
        list.push(candidate({ lane: `${team}${tier}`, tier, teamId: team, readyAt: now }));
    const order = hxFlowSort(list, context).map((item) => item.lane);
    expect(order).toEqual(["B0", "C0", "A0", "B1", "C1", "A1", "B2", "C2", "A2", "B3", "C3", "A3"]);
    // A weight of 3 ("more urgent") divides A's share by 3 (200), and 1/3 ("not urgent") triples C's (900).
    shares.setWeight("A", 3);
    shares.setWeight("C", 1 / 3);
    expect(
      hxFlowSort(list, context)
        .slice(0, 3)
        .map((item) => item.lane),
    ).toEqual(["B0", "A0", "C0"]);
  });

  it("lifts a background turn that waited 360 s to tier 0", () => {
    expect(hxFlowEffectiveTier({ tier: 3, readyAt: now - 360_000 }, now)).toBe(0);
    expect(hxFlowEffectiveTier({ tier: 3, readyAt: now - 239_000 }, now)).toBe(2);
  });

  it("halves the share of a team every 10 minutes", () => {
    const shares = new HxFlowShares();
    shares.add("A", 100, 0);
    expect(shares.used("A", 10 * 60_000)).toBeCloseTo(50);
  });

  it("puts the warm lane first when two shares are within 10 %", () => {
    const shares = new HxFlowShares();
    shares.add("A", 100, now);
    shares.add("B", 95, now);
    const context = {
      now,
      shares,
      times: new HxFlowDifficultyTimes(),
      lastEnded: (lane: string) => (lane === "a" ? now - 5 * 60_000 : lane === "b" ? now - 60_000 : undefined),
      batchStarts: () => 0,
    };
    const list = [candidate({ lane: "a", teamId: "A" }), candidate({ lane: "b", teamId: "B" })];
    expect(hxFlowSort(list, context).map((item) => item.lane)).toEqual(["b", "a"]);
  });

  it("in one team: the critical path, then low difficulty first in a batch with every 4th by order, then the order", () => {
    const times = new HxFlowDifficultyTimes();
    let starts = 0;
    const context = { now, shares: new HxFlowShares(), times, lastEnded: () => undefined, batchStarts: () => starts };
    const list = [
      candidate({ lane: "high", teamId: "T", batch: "b", difficulty: "high", order: 1 }),
      candidate({ lane: "low", teamId: "T", batch: "b", difficulty: "low", order: 2 }),
      candidate({ lane: "key", teamId: "T", batch: "b", difficulty: "high", order: 3, dependents: 2 }),
    ];
    expect(hxFlowSort(list, context).map((item) => item.lane)).toEqual(["key", "low", "high"]);
    starts = 3; // the 4th start of the batch goes by the order of the lead
    expect(hxFlowSort(list, context).map((item) => item.lane)).toEqual(["key", "high", "low"]);
  });

  it("stops the difficulty rule when low work is not faster than high work here", () => {
    const times = new HxFlowDifficultyTimes();
    for (let index = 0; index < 5; index += 1) {
      times.record("low", 9_000);
      times.record("high", 5_000);
    }
    expect(times.ruleOn()).toBe(false);
    const context = { now, shares: new HxFlowShares(), times, lastEnded: () => undefined, batchStarts: () => 0 };
    const list = [
      candidate({ lane: "high", teamId: "T", batch: "b", difficulty: "high", order: 1 }),
      candidate({ lane: "low", teamId: "T", batch: "b", difficulty: "low", order: 2 }),
    ];
    expect(hxFlowSort(list, context).map((item) => item.lane)).toEqual(["high", "low"]);
  });
});

describe("the ledger", () => {
  const head = (createdAt: string, kind: "user" | "routine" | "agent") => ({
    id: "d",
    messageId: "m",
    recipientAgentId: "x",
    sender:
      kind === "user"
        ? { kind: "user" as const }
        : kind === "routine"
          ? { kind: "routine" as const, routineId: "r", runId: "u", routineName: "n", scheduledFor: createdAt }
          : { kind: "agent" as const, agentId: "y" },
    text: "",
    attachments: [],
    replyToMessageId: null,
    status: "queued" as const,
    position: null,
    turnId: null,
    error: null,
    createdAt,
  });

  it("keeps one place for a person when B is at least 3", () => {
    const ledger = new HxFlowLedger(() => Date.parse("2026-11-17T10:00:00Z"));
    const at = "2026-11-17T09:59:00.000Z";
    const person = ledger.rank("p", head(at, "user"), null);
    const teammate = ledger.rank("t", head(at, "agent"), null);
    const routine = ledger.rank("r", head(at, "routine"), null);
    expect([person.tier, teammate.tier, routine.tier]).toEqual([0, 2, 3]);
    // Two other turns run with B = 3: a teammate waits, a person starts.
    ledger.started("a", teammate, null);
    ledger.started("b", teammate, null);
    expect(ledger.mayStart(teammate, [], ["a", "b"], 3)).toBe(false);
    expect(ledger.mayStart(person, [], ["a", "b"], 3)).toBe(true);
    // B = 2 keeps no place.
    expect(ledger.mayStart(teammate, [], ["a"], 2)).toBe(true);
  });

  it("gives a team room a place only when the ledger has one, in the order of the work", () => {
    let now = Date.parse("2026-11-17T10:00:00Z");
    const ledger = new HxFlowLedger(() => now);
    const running: string[] = [];
    ledger.attachScheduler({ limit: () => 4, running: () => running });
    const task = (taskId: string, order: number, dependents = 0) => ({
      channelId: "room",
      taskId,
      teamId: "T",
      tier: dependents > 0 ? (1 as const) : (2 as const),
      order,
      batch: null,
      difficulty: null,
      dependents,
    });
    const ready = [task("t1", 1), task("t2", 2), task("t3", 3, 2), task("t4", 4), task("t5", 5)];
    ledger.attachTeams({ teamOf: () => "T", task: () => null, ready: () => ready });
    // B = 4 keeps one place for a person: 3 places for the team, the critical path first.
    expect(ledger.hasPlace("room", "t3")).toBe(true);
    expect(ledger.hasPlace("room", "t1")).toBe(true);
    expect(ledger.hasPlace("room", "t2")).toBe(true);
    expect(ledger.hasPlace("room", "t4")).toBe(false);
    ledger.dispatched("t3");
    ledger.dispatched("t1");
    ledger.dispatched("t2");
    expect(ledger.hasPlace("room", "t4")).toBe(false);
    expect(ledger.queuePlace("t4")).toMatchObject({ place: 1 });
    // v1.7.4: the turn of each piece given out waits in its lane: the place the room took is its own,
    // so it starts now, not when the place is let go 60 s later. Work that got no place still waits.
    const assignment = (taskId: string) => ({ channelId: "room", taskId });
    const at = (ms: number) => new Date(ms).toISOString();
    const byTask = new Map(ready.map((item) => [item.taskId, item]));
    ledger.attachTeams({ teamOf: () => "T", task: (_channel, id) => byTask.get(id) ?? null, ready: () => ready });
    const lanes = (["t3", "t1", "t2"] as const).map((id) =>
      ledger.rank(`lane-${id}`, head(at(now), "agent"), assignment(id)),
    );
    expect(lanes.map((lane) => lane.taskId)).toEqual(["t3", "t1", "t2"]);
    for (const lane of lanes)
      expect(
        ledger.mayStart(
          lane,
          lanes.filter((other) => other !== lane),
          [],
          4,
        ),
      ).toBe(true);
    // Only one lane is here yet: the two other places stay kept, and its own is free.
    const [first] = lanes;
    if (!first) throw new Error("no lane");
    expect(ledger.mayStart(first, [], [], 4)).toBe(true);
    // A turn of other work while the three places are kept: it waits (B = 4, one for a person).
    const other = ledger.rank("lane-other", head(at(now), "agent"), null);
    expect(ledger.mayStart(other, [], [], 4)).toBe(false);
    // B = 2, both pieces given out and both waiting here: both start (before: neither, for 60 s).
    const small = new HxFlowLedger(() => now);
    small.attachScheduler({ limit: () => 2, running: () => [] });
    const pair = [task("p1", 1), task("p2", 2)];
    const pairByTask = new Map(pair.map((item) => [item.taskId, item]));
    small.attachTeams({ teamOf: () => "T", task: (_channel, id) => pairByTask.get(id) ?? null, ready: () => pair });
    expect(small.hasPlace("room", "p1")).toBe(true);
    small.dispatched("p1");
    expect(small.hasPlace("room", "p2")).toBe(true);
    small.dispatched("p2");
    const p1 = small.rank("lane-p1", head(at(now), "agent"), assignment("p1"));
    const p2 = small.rank("lane-p2", head(at(now), "agent"), assignment("p2"));
    expect(small.mayStart(p1, [p2], [], 2)).toBe(true);
    expect(small.mayStart(p2, [p1], [], 2)).toBe(true);
    // The dispatched work starts: its places are running turns now. One ends: t4 gets its place.
    running.push("a", "b", "c");
    for (const [lane, id] of [
      ["a", "t3"],
      ["b", "t1"],
      ["c", "t2"],
    ] as const)
      ledger.started(lane, { ...candidateOf(id), teamId: "T" }, id);
    ready.splice(0, 3);
    expect(ledger.hasPlace("room", "t4")).toBe(false);
    running.pop();
    now += 1_000;
    expect(ledger.hasPlace("room", "t4")).toBe(true);
    expect(ledger.teamRunning("T")).toBe(true);
  });

  it("tells a team's minutes from the time of team turns, not of quick greetings (v1.7.4, CONC-09-A2)", () => {
    let now = Date.parse("2026-11-17T10:00:00Z");
    const ledger = new HxFlowLedger(() => now);
    const running: string[] = [];
    ledger.attachScheduler({ limit: () => 2, running: () => running });
    const work = (taskId: string, order: number) => ({
      channelId: "room",
      taskId,
      teamId: "T",
      tier: 2 as const,
      order,
      batch: null,
      difficulty: null,
      dependents: 0,
    });
    const ready = [work("q1", 1), work("q2", 2), work("q3", 3)];
    ledger.attachTeams({ teamOf: () => "T", task: () => null, ready: () => ready });
    // Before any turn ended: the first guess, 2 min a turn: place 3 with B = 2 is two rounds, 4 min.
    expect(ledger.queuePlace("q3")).toEqual({ place: 3, minutes: 4 });
    // Nine greetings of a second each: the time of a turn drops, the team's stays unknown.
    for (let index = 0; index < 9; index += 1) {
      running.push(`g${index}`);
      ledger.started(`g${index}`, candidateOf(`g${index}`), null);
      now += 1_000;
      running.pop();
      ledger.tick(running);
    }
    expect(ledger.turnMs()).toBeLessThan(20_000);
    expect(ledger.queuePlace("q3")).toEqual({ place: 3, minutes: 1 });
    // One team turn of 62 s: place 3 is two rounds of it, about 2 min; place 1 one round, 1 min.
    running.push("m");
    ledger.started("m", { ...candidateOf("m"), teamId: "T" }, null);
    now += 62_000;
    running.pop();
    ledger.tick(running);
    expect(ledger.queuePlace("q3")).toEqual({ place: 3, minutes: 2 });
    expect(ledger.queuePlace("q1")).toEqual({ place: 1, minutes: 1 });
    // Two turns already wait for a slot of this computer: they go first.
    expect(ledger.queuePlace("q1", 2)).toEqual({ place: 3, minutes: 2 });
    // Then the rate of team starts while work waits (Little's law): a round of B = 2 starts at once,
    // the next round a minute later. One gap is not a round yet: still the turn time.
    const start = (lane: string) => {
      running.push(lane);
      ledger.started(lane, { ...candidateOf(lane), teamId: "T" }, `${lane}-task`);
    };
    now += 1_000;
    start("s1");
    now += 100;
    start("s2");
    expect(ledger.queuePlace("q3")).toEqual({ place: 3, minutes: 2 });
    now += 60_000;
    start("s3");
    // Gaps 63 s (m left work waiting, s1 came 63 s later), 0.1 s, 60 s: about 41 s a start; place 3 about 2 min.
    expect(ledger.queuePlace("q3")).toEqual({ place: 3, minutes: 2 });
    expect(ledger.queuePlace("q1")).toEqual({ place: 1, minutes: 1 });
    // A start with nothing else waiting ends the run of gaps: the next start does not count the idle time.
    ready.splice(0, ready.length);
    now += 1_000;
    start("s4");
    ready.push(work("q4", 4), work("q5", 5), work("q6", 6), work("q7", 7));
    now += 10 * 60_000;
    start("s5");
    now += 30_000;
    start("s6");
    // The 10 idle minutes are not a gap: gaps 63, 0.1, 60, 1, 30 s → about 31 s a start.
    expect(ledger.queuePlace("q7")).toEqual({ place: 4, minutes: 2 });
  });
});

function candidateOf(lane: string): HxFlowCandidate {
  return { lane, tier: 2, readyAt: 0, teamId: null, order: 0, batch: null, difficulty: null, dependents: 0 };
}

describe("CONC-10: the guards", () => {
  it("G1 counts real work only, and G8 after 24 hours of it", () => {
    const state = hxGuardState();
    let now = 0;
    expect(hxWorkTick(state, now, true)).toBeNull();
    for (let minute = 0; minute < 120; minute += 1) {
      now += 15_000;
      expect(hxWorkTick(state, now, false)).toBeNull();
    }
    expect(state.activeMs).toBe(0);
    let fired: string | null = null;
    for (let tick = 0; tick < 200 && !fired; tick += 1) {
      now += 15_000;
      fired = hxWorkTick(state, now, true);
    }
    expect(fired).toBe("G1");
    expect(state.sinceProgressMs).toBe(30 * 60_000);
    // A gap longer than 30 s is sleep: it counts 30 s.
    const sleep = hxGuardState({ lastTickAt: 0 });
    hxWorkTick(sleep, 8 * 60 * 60_000, true);
    expect(sleep.activeMs).toBe(30_000);
    expect(hxWorkTick(hxGuardState({ activeMs: 24 * 60 * 60_000 - 1, lastTickAt: 0 }), 15_000, true)).toBe("G8");
  });

  it("G2 pauses at the 3rd change of hands, and not when the files changed in between", () => {
    const state = hxGuardState();
    expect(hxLoopMove(state, "t", "h1", 2)).toBe(false);
    expect(hxLoopMove(state, "t", "h1", 2)).toBe(false);
    expect(hxLoopMove(state, "t", "h1", 2)).toBe(true);
    const rework = hxGuardState();
    hxLoopMove(rework, "t", "h1", 2);
    hxLoopMove(rework, "t", "h2", 2);
    expect(hxLoopMove(rework, "t", "h2", 2)).toBe(false);
    expect(hxGoalOverlap("写第三章的摘要", "写第三章的摘要。")).toBeGreaterThanOrEqual(0.8);
    expect(hxGoalOverlap("写第三章的摘要", "画三张海报")).toBeLessThan(0.8);
    const same = hxGuardState();
    expect(hxLoopReceive(same, "w", "写第三章的摘要")).toBe(false);
    expect(hxLoopReceive(same, "w", "写第三章的摘要。")).toBe(false);
    expect(hxLoopReceive(same, "w", "写第三章的摘要！")).toBe(true);
  });

  it("G3 sees work that spreads, and work too deep", () => {
    const state = hxGuardState();
    let spread = false;
    for (let index = 0; index < 20; index += 1) spread = hxSpread(state, index % 5 === 0 ? "done" : "open", 1);
    expect(spread).toBe(true);
    expect(hxSpread(hxGuardState(), "open", 5)).toBe(true);
    const even = hxGuardState();
    for (let index = 0; index < 20; index += 1) spread = hxSpread(even, index % 2 ? "done" : "open", 1);
    expect(spread).toBe(false);
  });

  it("G5 reads pay as you go when most records are priced, and an unknown price when most are not", async () => {
    const read = (costs: Array<number | null>) =>
      hxReadSpend({
        rows: () =>
          costs.map((cost) => ({ tokens_json: JSON.stringify({ uncachedInput: 1_000 }), estimated_cost_usd: cost })),
        agents: () => [{ id: "a", provider: "acp", model: "custom/default" }],
        quota: async () => null,
        agentIds: ["a"],
        since: "2026-11-17T00:00:00.000Z",
      });
    // A side question with no rates among the priced turns of the team.
    expect((await read([3, 3, 3, null])).billing).toBe("api");
    expect((await read([3, null, null])).billing).toBe("unknown");
    expect((await read([null, null])).billing).toBe("unknown");
    expect((await read([3, 3])).yuan).toBeCloseTo(6 * HX_USD_TO_YUAN);
  });

  it("G5 reminds by the kind of billing, at most once in 15 minutes, and G9 after 10 with no answer", () => {
    let now = 0;
    const api = hxGuardState();
    expect(hxSpendDue(api, { billing: "api", yuan: 19, percent: null, tokens: 0 }, now)).toBeNull();
    expect(hxSpendDue(api, { billing: "api", yuan: 21, percent: null, tokens: 0 }, now)).toEqual({
      kind: "api",
      yuan: 21,
    });
    expect(hxSpendDue(api, { billing: "api", yuan: 45, percent: null, tokens: 0 }, now + 60_000)).toBeNull();
    expect(hxSpendDue(api, { billing: "api", yuan: 45, percent: null, tokens: 0 }, now + HX_SPEND_GAP_MS)).toEqual({
      kind: "api",
      yuan: 45,
    });
    const plan = hxGuardState();
    expect(hxSpendDue(plan, { billing: "plan", yuan: null, percent: 20, tokens: 0 }, now)).toBeNull();
    expect(hxSpendDue(plan, { billing: "plan", yuan: null, percent: 26, tokens: 0 }, now)).toEqual({
      kind: "plan",
      percent: 25,
    });
    now += HX_SPEND_GAP_MS;
    expect(hxSpendDue(plan, { billing: "plan", yuan: null, percent: 82, tokens: 0 }, now)).toEqual({
      kind: "plan",
      percent: 80,
    });
    now += HX_SPEND_GAP_MS;
    expect(hxSpendDue(plan, { billing: "plan", yuan: null, percent: 90, tokens: 0 }, now)).toBeNull();
    expect(hxSpendDue(hxGuardState(), { billing: "local", yuan: 0, percent: null, tokens: 9e9 }, now)).toBeNull();
    const unknown = hxGuardState();
    expect(hxSpendDue(unknown, { billing: "unknown", yuan: null, percent: null, tokens: 4_000_000 }, now)).toBeNull();
    expect(hxSpendDue(unknown, { billing: "unknown", yuan: null, percent: null, tokens: 5_100_000 }, now)).toEqual({
      kind: "tokens",
      millions: 5,
    });
    const quiet = hxGuardState();
    for (let index = 1; index <= 10; index += 1)
      hxSpendDue(quiet, { billing: "api", yuan: index * 20, percent: null, tokens: 0 }, index * HX_SPEND_GAP_MS);
    expect(hxUnanswered(quiet, false)).toBe(true);
    expect(hxUnanswered(quiet, true)).toBe(false);
  });
});
