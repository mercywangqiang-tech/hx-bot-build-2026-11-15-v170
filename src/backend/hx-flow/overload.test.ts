import { describe, expect, it } from "vitest";
import { hxFlowEffectiveTier } from "./order";
import { HX_OVERLOAD, HxOverload, hxOverload } from "./overload";

/** Samples every 5 s from `from` to `to` (inclusive), with the head of tier 0 ready since `readyAt`. */
function run(
  overload: HxOverload,
  from: number,
  to: number,
  waiting: (now: number) => { tier: 0 | 1 | 2 | 3; readyAt: number }[],
) {
  for (let now = from; now <= to; now += HX_OVERLOAD.sampleMs) overload.sample(now, waiting(now));
}

describe("CONC-08-A3: overload enters and recovers, each after a 30 s window", () => {
  it("is overloaded only when the wait stays above the target for 30 s, and recovers after 30 s under it", () => {
    const overload = new HxOverload();
    // A person's message has waited since 0; the target of tier 0 is 5 s.
    const head = () => [{ tier: 0 as const, readyAt: 0 }];
    run(overload, 0, 5_000, head);
    expect(overload.overloaded(0)).toBe(false);
    // Above 5 s from 10 s on: overloaded 30 s later (at 40 s), not at 35 s.
    run(overload, 10_000, 35_000, head);
    expect(overload.overloaded(0)).toBe(false);
    run(overload, 40_000, 40_000, head);
    expect(overload.overloaded(0)).toBe(true);
    expect(overload.since(0)).toBe(40_000);
    // The queue is empty from 45 s: recovered 30 s later.
    run(overload, 45_000, 70_000, () => []);
    expect(overload.overloaded(0)).toBe(true);
    run(overload, 75_000, 75_000, () => []);
    expect(overload.overloaded(0)).toBe(false);
  });

  it("does not enter when one sample dips under the target inside the window", () => {
    const overload = new HxOverload();
    let dip = false;
    run(overload, 0, 60_000, (now) => (dip && now === 30_000 ? [] : [{ tier: 2, readyAt: -120_000 }]));
    expect(overload.overloaded(2)).toBe(true);
    const second = new HxOverload();
    dip = true;
    run(second, 0, 60_000, (now) => (dip && now === 30_000 ? [] : [{ tier: 2, readyAt: -120_000 }]));
    // 35 s to 60 s above: 25 s, not yet 30.
    expect(second.overloaded(2)).toBe(false);
  });

  it("is not overloaded while work starts after short waits, however much waits (the queue moves)", () => {
    const overload = new HxOverload();
    for (let now = 0; now <= 120_000; now += 5_000) {
      overload.started(1, 2_000, now);
      overload.sample(now, [{ tier: 1, readyAt: now - 600_000 }]);
    }
    expect(overload.overloaded(1)).toBe(false);
    expect(overload.value(1)).toBe(2_000);
  });

  it("uses the target of each tier: 5 s, 60 s, 60 s, 300 s", () => {
    const overload = new HxOverload();
    run(overload, 0, 60_000, () => [
      { tier: 0, readyAt: -10_000 },
      { tier: 1, readyAt: -50_000 },
      { tier: 2, readyAt: -70_000 },
      { tier: 3, readyAt: -250_000 },
    ]);
    // Tier 1 is above 60 s from 15 s on (30 s by 45 s); tier 3 is above 300 s only from 55 s on.
    const tiers: (0 | 1 | 2 | 3)[] = [0, 1, 2, 3];
    expect(tiers.map((tier) => overload.overloaded(tier))).toEqual([true, true, true, false]);
  });
});

describe("CONC-08: background work does not age while work of a person or a team is overloaded", () => {
  it("keeps tier 3 at 3 for at most 10 minutes, then it ages as before", () => {
    hxOverload.reset();
    const routine = { tier: 3 as const, readyAt: 0 };
    expect(hxFlowEffectiveTier(routine, 600_000)).toBe(0);
    run(hxOverload, 0, 30_000, () => [{ tier: 0, readyAt: -60_000 }]);
    expect(hxOverload.overloaded(0)).toBe(true);
    expect(hxFlowEffectiveTier(routine, 300_000)).toBe(3);
    expect(hxFlowEffectiveTier({ tier: 2, readyAt: 0 }, 300_000)).toBe(0);
    // 10 minutes after the overload began, background ages again.
    expect(hxFlowEffectiveTier(routine, 30_000 + HX_OVERLOAD.agingHoldMs + 1)).toBe(0);
    hxOverload.reset();
    expect(hxFlowEffectiveTier(routine, 300_000)).toBe(1);
  });
});
