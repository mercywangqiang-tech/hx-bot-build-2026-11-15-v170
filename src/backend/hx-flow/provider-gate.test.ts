import { describe, expect, it, vi } from "vitest";
import {
  HX_PROVIDER_LIMITS,
  HxProviderGate,
  type HxProviderModel,
  hxInputClass,
  hxRetryAfterMs,
} from "./provider-gate";

const cloud: HxProviderModel = { key: "codex\u0000default\u0000gpt-5", local: false, label: "Codex · gpt-5" };
const local: HxProviderModel = {
  key: "opencode\u0000default\u0000ollama/qwen3",
  local: true,
  label: "Ollama",
  localParallel: 2,
};

function rig(model: HxProviderModel = cloud) {
  let now = 1_000_000;
  let wakes = 0;
  const gate = new HxProviderGate({
    now: () => now,
    random: () => 0.5,
  });
  gate.attach({
    modelOf: (agentId) => (agentId.startsWith("none") ? null : model),
    wake: () => {
      wakes += 1;
    },
  });
  let next = 0;
  /** Starts a turn of a new lane as the drain does, and returns its turn id. */
  const start = (person = false, chars = 100) => {
    const lane = `agent-${next}`;
    const turnId = `turn-${next}`;
    next += 1;
    if (!gate.mayStart(lane, person)) return null;
    gate.starting(lane, person);
    gate.turnStarted(turnId, lane, null, chars);
    return turnId;
  };
  /** `hold` turns at once (1 by default) whose first output comes after `ms`; they end at once. */
  const sample = (ms: number, chars = 100, hold = 0) => {
    const turns = Array.from({ length: Math.max(1, hold) }, () => start(true, chars));
    now += ms;
    for (const turn of turns) if (turn) gate.firstOutput(turn);
    for (const turn of turns) if (turn) gate.turnEnded(turn);
  };
  return {
    gate,
    start,
    sample,
    advance: (ms: number) => {
      now += ms;
    },
    wakes: () => wakes,
    limit: () => gate.state(model.key)?.limit ?? null,
    state: () => gate.state(model.key),
  };
}

describe("CONC-02: the limit L of one provider, account and model", () => {
  it("starts at 2 for a cloud model and adds 1 for each sample with g = 1 (slow start), up to 16", () => {
    const r = rig();
    // One round of L turns at once: L samples, each with the limit in use.
    r.sample(1000, 100, 2);
    expect(r.limit()).toBe(4);
    r.sample(1000, 100, 4);
    expect(r.limit()).toBe(8);
    for (let i = 0; i < 4; i++) r.sample(1000, 100, r.limit() ?? 2);
    expect(r.limit()).toBe(HX_PROVIDER_LIMITS.max);
    expect(r.state()?.slowStart).toBe(true);
  });

  it("does not grow past twice what is in flight, however many turns started at a lower L", () => {
    const r = rig();
    // Never more than 2 at once (the computer's budget holds the rest): the last sample that counts is
    // at L = 4 (2 is half of it), so L stops at 5.
    for (let i = 0; i < 30; i++) r.sample(1000, 100, 2);
    expect(r.limit()).toBe(5);
  });

  it("does not grow a limit that the turns did not use", () => {
    const r = rig();
    r.sample(1000, 100, 2);
    r.sample(1000, 100, 4);
    expect(r.limit()).toBe(8);
    // One turn at a time now: far below half of L.
    for (let i = 0; i < 20; i++) r.sample(1000);
    expect(r.limit()).toBe(8);
  });

  it("keeps slow start over one clipped outlier, leaves it when the provider stays slow, 10 % at most a sample", () => {
    const r = rig();
    r.sample(1000, 100, 2);
    r.sample(1000, 100, 4);
    const before = r.state()?.rawLimit ?? 0;
    expect(before).toBe(8);
    // The round's other turns were fast; this one is 4 × the baseline or more.
    for (let i = 0; i < 9; i++) r.sample(1000);
    r.sample(20_000);
    const state = r.state();
    // short = (9 × 1 + 4) / 10 = 1.3, long ≈ 1.03: g = 1.5 × 1.03 / 1.3 ≈ 1.19 → 1. Clipped, one outlier
    // neither lowers L nor ends slow start.
    expect(state?.slowStart).toBe(true);
    expect(state?.rawLimit).toBe(before);
    // A slow provider: every sample 3 × its baseline.
    for (let i = 0; i < 10; i++) r.sample(3_000, 100, 1);
    const slowed = r.state()?.rawLimit ?? 0;
    expect(r.state()?.slowStart).toBe(false);
    expect(slowed).toBeLessThan(before);
    expect(slowed).toBeGreaterThanOrEqual(before * 0.9 ** 10 - 1e-9);
  });

  it("after slow start each tested fast sample adds 0.2 (q = 1), and L never goes under 1", () => {
    const r = rig();
    r.gate.throttled(r.start(), null, 1);
    r.advance(10);
    r.gate.turnEnded("turn-0");
    expect(r.state()?.slowStart).toBe(false);
    expect(r.state()?.rawLimit).toBe(1);
    for (let i = 0; i < 5; i++) r.sample(1000, 100, 1);
    expect(r.state()?.rawLimit ?? 0).toBeCloseTo(2, 9);
    for (let i = 0; i < 60; i++) r.sample(30_000, 100, 1);
    expect(r.limit()).toBe(1);
    expect(r.state()?.rawLimit ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("compares each sample with the baseline of its size class, not with other sizes", () => {
    expect([hxInputClass(10), hxInputClass(8_000), hxInputClass(64_000)]).toEqual([0, 1, 2]);
    const r = rig();
    // Small inputs answer in 1 s, large ones in 12 s: both normal for their class.
    for (let i = 0; i < 3; i++) {
      r.sample(1000, 100, r.limit() ?? 2);
      r.sample(12_000, 100_000, r.limit() ?? 2);
    }
    expect(r.state()?.slowStart).toBe(true);
    expect(r.limit()).toBe(HX_PROVIDER_LIMITS.max);
  });
});

describe("CONC-02: admission, a person first", () => {
  it("lets other turns use L − 1 when L ≥ 3, and a person L + 1", () => {
    const r = rig();
    r.sample(1000, 100, 2);
    expect(r.limit()).toBe(4);
    const others = [r.start(), r.start(), r.start(), r.start()];
    expect(others.filter(Boolean)).toHaveLength(3);
    expect(r.start(true)).not.toBeNull();
    expect(r.start(true)).not.toBeNull();
    expect(r.start(true)).toBeNull();
  });

  it("with L = 2 other turns use both places, and a person a third", () => {
    const r = rig();
    expect(r.start()).not.toBeNull();
    expect(r.start()).not.toBeNull();
    expect(r.start()).toBeNull();
    expect(r.start(true)).not.toBeNull();
    expect(r.start(true)).toBeNull();
  });

  it("does not count a turn that is in a tool step, and wakes the waiting lanes when one opens", () => {
    const r = rig();
    const a = r.start();
    const b = r.start();
    expect(r.start()).toBeNull();
    const wakes = r.wakes();
    r.gate.toolSteps(a ?? "", 1);
    expect(r.wakes()).toBe(wakes + 1);
    const c = r.start();
    expect(c).not.toBeNull();
    r.gate.toolSteps(a ?? "", 0);
    // a, b and c wait for the model: 3 in flight for L = 2.
    expect(r.start()).toBeNull();
    r.gate.turnEnded(b ?? "");
    expect(r.start()).toBeNull();
    r.gate.turnEnded(c ?? "");
    expect(r.start()).not.toBeNull();
  });

  it("counts a start that the drain gave out until its turn starts, and drops it after 90 s", () => {
    const r = rig();
    expect(r.gate.mayStart("x", false)).toBe(true);
    r.gate.starting("x", false);
    expect(r.gate.mayStart("y", false)).toBe(true);
    r.gate.starting("y", false);
    expect(r.gate.mayStart("z", false)).toBe(false);
    expect(r.gate.refusal("z")?.pausedUntil).toBeNull();
    r.advance(HX_PROVIDER_LIMITS.startHoldMs + 1);
    expect(r.gate.mayStart("z", false)).toBe(true);
    expect(r.gate.refusal("z")).toBeNull();
    // A start that failed before its turn frees its place at once.
    r.gate.starting("z", false);
    r.gate.starting("w", false);
    expect(r.gate.mayStart("v", false)).toBe(false);
    r.gate.startEnded("z");
    expect(r.gate.mayStart("v", false)).toBe(true);
  });

  it("lets an agent with no model of its own (a remote agent) start", () => {
    const r = rig();
    r.start();
    r.start();
    expect(r.gate.mayStart("none-1", false)).toBe(true);
  });
});

describe("CONC-02: a 429 halves L and pauses; a person may probe", () => {
  it("halves L, pauses 20 to 40 s with no Retry-After, and lets one person's turn probe", () => {
    const r = rig();
    r.sample(1000, 100, 2);
    r.sample(1000, 100, 4);
    expect(r.limit()).toBe(8);
    const turn = r.start();
    r.gate.throttled(turn, null, null);
    expect(r.limit()).toBe(4);
    // random() = 0.5: 20 s + 0.5 × 20 s.
    expect((r.state()?.pausedUntil ?? 0) - 1_000_000 - 2_000).toBe(30_000);
    expect(r.state()?.pauseNamed).toBe(false);
    expect(r.start()).toBeNull();
    const [waiting] = r.gate.waitingFor(cloud.key);
    expect(r.gate.refusal(waiting ?? "")?.pausedUntil).toBe(r.state()?.pausedUntil);
    const probe = r.start(true);
    expect(probe).not.toBeNull();
    // One probe at a time.
    expect(r.start(true)).toBeNull();
    // The probe answered: the pause ends.
    r.advance(500);
    r.gate.firstOutput(probe ?? "");
    expect(r.state()?.pausedUntil).toBeNull();
    expect(r.start()).not.toBeNull();
  });

  it("waits the named Retry-After with no probe, and wakes the waiting lanes when it ends", async () => {
    let wakes = 0;
    const gate = new HxProviderGate();
    gate.attach({
      modelOf: () => cloud,
      wake: () => {
        wakes += 1;
      },
    });
    gate.starting("a", false);
    gate.turnStarted("t", "a", null, 10);
    gate.throttled("t", null, 60);
    expect(gate.state(cloud.key)?.pauseNamed).toBe(true);
    expect(gate.mayStart("b", true)).toBe(false);
    // The gate's own timer wakes the waiting lanes at the end of the pause.
    await vi.waitFor(() => expect(wakes).toBeGreaterThanOrEqual(1), { timeout: 2_000 });
    expect(gate.mayStart("b", true)).toBe(true);
    gate.reset();
  });

  it("halves once for a burst: the other 429s of the pause only move its end", () => {
    const r = rig();
    r.sample(1000, 100, 2);
    r.sample(1000, 100, 4);
    expect(r.limit()).toBe(8);
    const turns = [r.start(), r.start(), r.start()];
    for (const turn of turns) r.gate.throttled(turn, null, 1_000);
    expect(r.limit()).toBe(4);
    expect(r.state()?.throttles).toBe(1);
    r.gate.throttled(null, "agent-99", 60_000);
    expect((r.state()?.pausedUntil ?? 0) - 1_000_000 - 2_000).toBe(60_000);
  });

  it("caps a long Retry-After at 10 minutes, and L comes back step by step after the pause", () => {
    const r = rig();
    const turn = r.start();
    r.gate.throttled(turn, null, 3_600_000);
    expect((r.state()?.pausedUntil ?? 0) - 1_000_000).toBe(HX_PROVIDER_LIMITS.pauseMaxMs);
    r.gate.turnEnded(turn ?? "");
    r.advance(HX_PROVIDER_LIMITS.pauseMaxMs + 1);
    expect(r.limit()).toBe(1);
    const steps: number[] = [];
    for (let i = 0; i < 15; i++) {
      r.sample(1000, 100, r.limit() ?? 1);
      steps.push(r.state()?.rawLimit ?? 0);
    }
    expect(steps.at(-1)).toBeGreaterThan(2);
    // Additive after slow start: at most 0.2 up for each of the round's L samples.
    for (let i = 1; i < steps.length; i++) {
      const before = steps[i - 1] ?? 0;
      expect((steps[i] ?? 0) - before).toBeLessThanOrEqual(0.2 * Math.floor(before + 1e-9) + 1e-9);
    }
  });

  it("ignores a throttle of an agent with no model, and of a turn it does not know", () => {
    const r = rig();
    r.gate.throttled("nope", "none-1", 1000);
    expect(r.gate.states()).toEqual([]);
  });
});

describe("CONC-02: a model of this computer", () => {
  it("starts at 1 and stays under the parallel setting of its server", () => {
    const r = rig(local);
    const first = r.start();
    expect(first).not.toBeNull();
    expect(r.limit()).toBe(1);
    expect(r.start()).toBeNull();
    r.gate.turnEnded(first ?? "");
    for (let i = 0; i < 20; i++) r.sample(1000, 100, r.limit() ?? 1);
    expect(r.limit()).toBe(2);
  });
});

describe("CONC-02: HXBot's own model calls wait for a place under L", () => {
  it("gives a background call a place when one is free, and none in a pause", async () => {
    const r = rig();
    const release = await r.gate.acquire(cloud, 3, 0);
    expect(release).not.toBeNull();
    expect(r.state()?.inFlight).toBe(1);
    release?.();
    expect(r.state()?.inFlight).toBe(0);
    r.gate.throttled(r.start(), null, 60_000);
    expect(await r.gate.acquire(cloud, 1, 0)).toBeNull();
  });
});

describe("CONC-02: the time that a throttle names", () => {
  it.each([
    ["429 Too Many Requests. Retry-After: 30", 30_000],
    ['{"retry-after-ms": "1500"}', 1500],
    ["Rate limit reached for gpt-4o in organization org-x on tokens per min. Please try again in 6.5s.", 6500],
    ["Please try again in 1m30s.", 90_000],
    ["Please try again in 120ms", 120],
    ['"retryDelay": "41s"', 41_000],
    ["Please retry in 41.3s", 41_300],
    ["API Error (429 rate_limit_error) · Retrying in 5 seconds… (attempt 1/10)", 5000],
    ["retry after 2 minutes", 120_000],
    ["rate limit exceeded", null],
    ["Retry-After: soon", null],
  ])("%s → %s", (message, ms) => {
    expect(hxRetryAfterMs(message)).toBe(ms);
  });
});

describe("CONC-02: the place of each kind of HXBot's own model call", () => {
  it("lets a side question go on at once, holds background work in a pause, and skips the judge", async () => {
    const { hxProviderGate } = await import("./provider-gate");
    const { hxSidePlace, hxTagSideObserver } = await import("./provider-side");
    const model = { provider: "codex", id: "gpt-5" };
    const key = "codex\u0000default\u0000gpt-5";
    hxProviderGate.reset();
    hxProviderGate.attach({ modelOf: () => ({ key, local: false, label: "codex · gpt-5" }), wake: () => undefined });
    const question = hxTagSideObserver(() => undefined, "side-question");
    const judge = hxTagSideObserver(() => undefined, "auto-model");
    const releaseQuestion = await hxSidePlace(model, question, () => false);
    expect(hxProviderGate.state(key)?.inFlight).toBe(1);
    releaseQuestion();
    expect(hxProviderGate.state(key)?.inFlight).toBe(0);
    // The judge took its own place before; it is not counted again.
    const releaseJudge = await hxSidePlace(model, judge, () => false);
    expect(hxProviderGate.state(key)?.inFlight).toBe(0);
    releaseJudge();
    // Paused: background work waits; a stop ends the wait, and the call goes on without a place.
    hxProviderGate.starting("a", false);
    hxProviderGate.turnStarted("t", "a", null, 10);
    hxProviderGate.throttled("t", null, 60_000);
    let stopped = false;
    const background = hxSidePlace(model, undefined, () => stopped);
    stopped = true;
    const release = await background;
    expect(hxProviderGate.state(key)?.inFlight).toBe(1);
    release();
    // A person's side question goes on even in a pause, without waiting.
    const during = await hxSidePlace(model, question, () => false);
    during();
    hxProviderGate.reset();
    hxProviderGate.attach(null);
  });
});
