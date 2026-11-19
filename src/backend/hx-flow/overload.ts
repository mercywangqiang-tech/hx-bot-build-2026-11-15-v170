// HXBot 并发（二）：过载判断（v1.7.4，CONC-08）。
//
// Overload is judged by how long work waits, not by how much waits (the idea of CoDel): every 5 s,
// for each tier, the smaller of "the shortest wait of the turns that started in the last 30 s" and
// "how long the head of the queue has waited". A tier whose value stays above its target for 30 s
// is overloaded (tier 0, a person: 5 s; tiers 1 and 2, team work: 60 s; tier 3, background: 300 s);
// it recovers when the value stays at or under the target for 30 s. A queue that moves (turns start
// after a short wait) is not overloaded however long it is; a short queue that does not move is.
//
// While tier 0, 1 or 2 is overloaded, background work (tier 3) does not age into a higher tier,
// for at most 10 minutes: it waits, it is not dropped, and a routine is not held for ever.
import { createHxBotLogger } from "@hxbot/logging";
import { type HxFlowTier, hxFlowHoldAging } from "./order";

export const HX_OVERLOAD = {
  sampleMs: 5_000,
  windowMs: 30_000,
  agingHoldMs: 10 * 60_000,
} as const;

/** The waiting target of each tier, in ms. */
export const HX_OVERLOAD_TARGETS: Readonly<Record<HxFlowTier, number>> = {
  0: 5_000,
  1: 60_000,
  2: 60_000,
  3: 300_000,
};

interface TierState {
  /** Since when the value is on the other side of the target (above while not overloaded, and the reverse). */
  crossingSince: number | null;
  overloadedSince: number | null;
  value: number;
}

export interface HxOverloadWaiting {
  tier: HxFlowTier;
  /** When the work became ready. */
  readyAt: number;
}

export class HxOverload {
  readonly #starts: { tier: HxFlowTier; waitMs: number; at: number }[] = [];
  readonly #tiers: Record<HxFlowTier, TierState> = {
    0: { crossingSince: null, overloadedSince: null, value: 0 },
    1: { crossingSince: null, overloadedSince: null, value: 0 },
    2: { crossingSince: null, overloadedSince: null, value: 0 },
    3: { crossingSince: null, overloadedSince: null, value: 0 },
  };
  readonly #log: (message: string, data: Readonly<Record<string, string | number | boolean>>) => void;

  constructor(
    options: { log?: (message: string, data: Readonly<Record<string, string | number | boolean>>) => void } = {},
  ) {
    this.#log = options.log ?? (() => {});
  }

  /** A turn of this tier started after waiting `waitMs` since it was ready. */
  started(tier: HxFlowTier, waitMs: number, at: number): void {
    this.#starts.push({ tier, waitMs: Math.max(0, waitMs), at });
    // A minute of starts is more than the window needs.
    while (this.#starts.length > 0 && at - (this.#starts[0]?.at ?? at) > 2 * HX_OVERLOAD.windowMs) this.#starts.shift();
  }

  /** One sample of every tier: `waiting` is the work that waits for a place now. */
  sample(now: number, waiting: readonly HxOverloadWaiting[]): void {
    for (const tier of [0, 1, 2, 3] as const) {
      const recent = this.#starts.filter((start) => start.tier === tier && now - start.at <= HX_OVERLOAD.windowMs);
      const shortest = recent.length > 0 ? Math.min(...recent.map((start) => start.waitMs)) : Number.POSITIVE_INFINITY;
      const heads = waiting.filter((item) => item.tier === tier).map((item) => now - item.readyAt);
      const head = heads.length > 0 ? Math.max(...heads) : 0;
      const value = Math.min(shortest, head);
      const state = this.#tiers[tier];
      state.value = value;
      const target = HX_OVERLOAD_TARGETS[tier];
      const over = state.overloadedSince !== null;
      // Above the target while not overloaded, or at or under it while overloaded: the other side.
      const crossing = over ? value <= target : value > target;
      if (!crossing) {
        state.crossingSince = null;
        continue;
      }
      state.crossingSince ??= now;
      if (now - state.crossingSince < HX_OVERLOAD.windowMs) continue;
      state.crossingSince = null;
      state.overloadedSince = over ? null : now;
      this.#log(over ? "A tier is no longer overloaded." : "A tier is overloaded.", {
        tier,
        valueMs: Math.round(Math.min(value, 86_400_000)),
        targetMs: target,
      });
    }
  }

  overloaded(tier: HxFlowTier): boolean {
    return this.#tiers[tier].overloadedSince !== null;
  }

  /** Since when the tier is overloaded, or null. */
  since(tier: HxFlowTier): number | null {
    return this.#tiers[tier].overloadedSince;
  }

  /** The value of the last sample, in ms (for the logs and the tests). */
  value(tier: HxFlowTier): number {
    return this.#tiers[tier].value;
  }

  /** Background work does not age into a higher tier now: tier 0, 1 or 2 is overloaded, for at most 10 min. */
  holdsAging(now: number): boolean {
    let earliest: number | null = null;
    for (const tier of [0, 1, 2] as const) {
      const since = this.#tiers[tier].overloadedSince;
      if (since !== null && (earliest === null || since < earliest)) earliest = since;
    }
    return earliest !== null && now - earliest < HX_OVERLOAD.agingHoldMs;
  }

  reset(): void {
    this.#starts.length = 0;
    for (const tier of [0, 1, 2, 3] as const)
      this.#tiers[tier] = { crossingSince: null, overloadedSince: null, value: 0 };
  }
}

const logger = createHxBotLogger("hx-flow");

export const hxOverload = new HxOverload({ log: (message, data) => logger.info(message, data) });
hxFlowHoldAging((now) => hxOverload.holdsAging(now));
