import { describe, expect, it } from "vitest";
import { HxFlowLedger } from "./ledger";
import { type HxFlowCandidate, type HxFlowTier, hxFlowEffectiveTier, hxFlowSort } from "./order";

// HXBot v1.7.3 压力测试：一本账（ledger.ts）在几个小时、几千条消息下的排队。模拟时钟，每秒一次：
// 新消息进来（你的、团队成员之间的、定时任务的），做完的轮次让出位置，再按产品的规矩一个个问 mayStart。
// 要求：每条消息只开始一次、一条不丢；同时在跑的不超过 B；B ≥ 3 时给人留的那个位置别的工作不占；
// 你的消息几乎不等；后台的定时任务不会一直等下去（等满 6 分钟提到最前面）。

interface Waiting {
  candidate: HxFlowCandidate;
  arrived: number;
}

/** A fixed series of numbers between 0 and 1, the same on every run. */
function series(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function simulate(input: { seed: number; limit: number; hours: number; agentRate: number; routineRate: number }) {
  const start = Date.parse("2026-11-18T10:00:00Z");
  let now = start;
  const ledger = new HxFlowLedger(() => now);
  const random = series(input.seed);
  const waiting = new Map<string, Waiting>();
  const running = new Map<string, { endsAt: number; tier: HxFlowTier }>();
  const started = new Set<string>();
  const waits: Record<"user" | "agent" | "routine", number[]> = { user: [], agent: [], routine: [] };
  let arrived = 0;
  let mostRunning = 0;
  let mostOthers = 0;
  const kindOf = (tier: HxFlowTier) => (tier === 0 ? "user" : tier === 3 ? "routine" : "agent");
  const arrive = (tier: HxFlowTier, teamId: string | null) => {
    arrived += 1;
    const lane = `lane-${arrived}`;
    waiting.set(lane, {
      arrived: now,
      candidate: { lane, tier, readyAt: now, teamId, order: arrived, batch: null, difficulty: null, dependents: 0 },
    });
  };
  const seconds = input.hours * 3600;
  for (let second = 0; second <= seconds + 3600; second += 1) {
    now = start + second * 1000;
    const open = second < seconds;
    if (open) {
      if (random() < 0.01) arrive(0, null);
      if (random() < input.agentRate) arrive(random() < 0.3 ? 1 : 2, ["A", "B", "C"][Math.floor(random() * 3)] ?? "A");
      if (random() < input.routineRate) arrive(3, null);
    }
    for (const [lane, turn] of running) if (turn.endsAt <= now) running.delete(lane);
    const context = {
      now,
      shares: ledger.shares,
      times: ledger.times,
      lastEnded: () => undefined,
      batchStarts: () => 0,
    };
    const order = hxFlowSort(
      [...waiting.values()].map((entry) => entry.candidate),
      context,
    );
    for (const candidate of order) {
      const others = [...waiting.values()]
        .map((entry) => entry.candidate)
        .filter((other) => other.lane !== candidate.lane);
      if (!ledger.mayStart(candidate, others, [...running.keys()], input.limit)) continue;
      const entry = waiting.get(candidate.lane);
      if (!entry) continue;
      expect(started.has(candidate.lane)).toBe(false);
      started.add(candidate.lane);
      waiting.delete(candidate.lane);
      ledger.started(candidate.lane, candidate, null);
      running.set(candidate.lane, { endsAt: now + (5 + Math.floor(random() * 56)) * 1000, tier: candidate.tier });
      waits[kindOf(candidate.tier)].push(now - entry.arrived);
    }
    mostRunning = Math.max(mostRunning, running.size);
    let others = 0;
    for (const turn of running.values()) if (turn.tier !== 0) others += 1;
    mostOthers = Math.max(mostOthers, others);
    if (!open && waiting.size === 0 && running.size === 0) break;
  }
  return { arrived, started: started.size, waiting: waiting.size, waits, mostRunning, mostOthers };
}

const top = (values: number[]) => Math.max(0, ...values);
const share = (values: number[], atMost: number) => values.filter((value) => value <= atMost).length / values.length;

describe("stress: thousands of turns through one ledger (v1.7.3)", () => {
  it("starts every turn once and loses none, keeps a place for people, and lets no routine wait for ever", () => {
    // B = 6 with work at about 85 % of what five places take, for 6 hours: some 3000 messages.
    const result = simulate({ seed: 7, limit: 6, hours: 6, agentRate: 0.1, routineRate: 0.03 });
    expect(result.arrived).toBeGreaterThan(2500);
    expect(result.started).toBe(result.arrived);
    expect(result.waiting).toBe(0);
    expect(result.mostRunning).toBeLessThanOrEqual(6);
    // A person keeps one place: other work never takes more than B − 1.
    expect(result.mostOthers).toBeLessThanOrEqual(5);
    // People start at once nearly always, and never wait more than one turn.
    expect(share(result.waits.user, 0)).toBeGreaterThan(0.9);
    expect(top(result.waits.user)).toBeLessThanOrEqual(60_000);
    // A routine that waited 6 minutes goes first: none waits much longer than that.
    expect(top(result.waits.routine)).toBeLessThanOrEqual(360_000 + 120_000);
  });

  it("holds the same rules with B = 2 (no place kept) and B = 16, under a load that does not fit", () => {
    for (const limit of [2, 3, 16]) {
      // More work than fits for 2 hours; the queue drains in the hour after.
      const result = simulate({ seed: limit, limit, hours: 2, agentRate: limit * 0.02, routineRate: limit * 0.008 });
      expect(result.started).toBe(result.arrived);
      expect(result.mostRunning).toBeLessThanOrEqual(limit);
      if (limit >= 3) expect(result.mostOthers).toBeLessThanOrEqual(limit - 1);
    }
  });

  it("lifts a routine that waited 6 minutes above the people's own work in the order", () => {
    const now = 1_000_000;
    expect(hxFlowEffectiveTier({ tier: 3, readyAt: now - 361_000 }, now)).toBe(0);
  });

  it("starts one lane of three teams whose near shares go in a circle (A before B, B before C, C before A)", () => {
    const now = Date.parse("2026-11-18T10:00:00Z");
    const ledger = new HxFlowLedger(() => now);
    ledger.shares.add("A", 100, now);
    ledger.shares.add("B", 95, now);
    ledger.shares.add("C", 88, now);
    const lane = (name: string, teamId: string, readyAt: number): HxFlowCandidate => ({
      lane: name,
      tier: 2,
      readyAt,
      teamId,
      order: 0,
      batch: null,
      difficulty: null,
      dependents: 0,
    });
    const a = lane("a", "A", now - 30_000);
    const b = lane("b", "B", now - 20_000);
    const c = lane("c", "C", now - 10_000);
    ledger.started("busy", lane("busy", "A", now - 60_000), null);
    // B = 2 with one turn running: one place. Before v1.7.3 each lane saw one lane before it, and none started.
    const starts = [a, b, c].filter((candidate) =>
      ledger.mayStart(
        candidate,
        [a, b, c].filter((other) => other !== candidate),
        ["busy"],
        2,
      ),
    );
    expect(starts).toHaveLength(1);
  });

  it("lets a person into the kept place when a routine lifted by its age waits before the person", () => {
    const now = Date.parse("2026-11-18T10:00:00Z");
    const ledger = new HxFlowLedger(() => now);
    const plain = (name: string, tier: HxFlowTier, readyAt: number): HxFlowCandidate => ({
      lane: name,
      tier,
      readyAt,
      teamId: null,
      order: 0,
      batch: null,
      difficulty: null,
      dependents: 0,
    });
    ledger.started("x", plain("x", 2, now), null);
    ledger.started("y", plain("y", 2, now), null);
    const routine = plain("routine", 3, now - 400_000);
    const person = plain("person", 0, now - 1_000);
    // B = 3, two other turns run: the last place is the person's. The routine, lifted to tier 0 and
    // older, goes before the person in the order, but it may not take that place.
    expect(ledger.mayStart(routine, [person], ["x", "y"], 3)).toBe(false);
    expect(ledger.mayStart(person, [routine], ["x", "y"], 3)).toBe(true);
  });
});
