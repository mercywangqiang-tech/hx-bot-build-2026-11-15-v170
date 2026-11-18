// HXBot 并发（一）：排队顺序（v1.7.1，CONC-03）。
//
// When more turns wait than B allows, the waiting work goes in this order:
// 1. The tier: a person 0, the critical path or the summary of a team 1, other team and teammate
//    work 2, routines and background work 3. Each 120 s of waiting after the work is ready lifts it
//    one tier: effective tier = max(0, tier − floor(seconds waited / 120)). Time spent on a
//    dependency is not waiting.
// 2. Between two teams: the turn seconds that each team used lately (half-life 10 minutes), divided
//    by its weight (1; "more urgent" 3; "not urgent" 1/3). Only competing teams share: one team alone
//    can use all of B. When two shares are within 10 %, the lane whose last turn ended in the last
//    4 minutes goes first, because its prompt cache is still warm.
// 3. In one team: the work that most other work depends on first, then the order in which the lead
//    gave it out. In one batch (one turn of the lead), the role of lower difficulty first, with each
//    4th start by the order of the lead. The rule stops by itself when work marked "low" does not
//    take less time here than work marked "high".
// 4. The time it became ready, then the lane key.

export type HxFlowTier = 0 | 1 | 2 | 3;
export type HxFlowDifficulty = "low" | "mid" | "high";

const HX_FLOW_AGING_S = 120;
const HX_FLOW_SHARE_HALF_LIFE_MS = 10 * 60_000;
const HX_FLOW_WARM_MS = 4 * 60_000;
const HX_FLOW_SHARE_TIE = 0.1;
const HX_FLOW_BATCH_ORDER_EVERY = 4;
export const HX_FLOW_URGENT_WEIGHT = 3;
export const HX_FLOW_RELAXED_WEIGHT = 1 / 3;
/** The fewest timed pieces of work of each difficulty before the rule can stop itself. */
const DIFFICULTY_MIN_SAMPLES = 5;
const DIFFICULTY_KEEP = 200;

export interface HxFlowCandidate {
  /** The lane key of a queued delivery, or `room:<taskId>` for team work on a board. */
  lane: string;
  tier: HxFlowTier;
  /** When the work became ready (all its dependencies done), in ms. */
  readyAt: number;
  teamId: string | null;
  /** The place of the work in the order of the lead. */
  order: number;
  /** The turn of the lead that gave the work out, or null. */
  batch: string | null;
  difficulty: HxFlowDifficulty | null;
  /** How many open pieces of work of the team wait for this one. */
  dependents: number;
}

export function hxFlowEffectiveTier(candidate: Pick<HxFlowCandidate, "tier" | "readyAt">, now: number): number {
  const waited = Math.max(0, now - candidate.readyAt) / 1000;
  return Math.max(0, candidate.tier - Math.floor(waited / HX_FLOW_AGING_S));
}

/** The turn seconds of each team, with a half-life, and the weight that the user gave it. */
export class HxFlowShares {
  readonly #used = new Map<string, { seconds: number; at: number }>();
  readonly #weights = new Map<string, number>();

  add(teamId: string, seconds: number, now: number): void {
    if (seconds <= 0) return;
    this.#used.set(teamId, { seconds: this.used(teamId, now) + seconds, at: now });
  }

  used(teamId: string, now: number): number {
    const entry = this.#used.get(teamId);
    if (!entry) return 0;
    return entry.seconds * 0.5 ** (Math.max(0, now - entry.at) / HX_FLOW_SHARE_HALF_LIFE_MS);
  }

  weight(teamId: string): number {
    return this.#weights.get(teamId) ?? 1;
  }

  /** 1 takes the weight away; the team's end takes it away too (`forget`). */
  setWeight(teamId: string, weight: number): void {
    if (weight === 1) this.#weights.delete(teamId);
    else this.#weights.set(teamId, weight);
  }

  share(teamId: string, now: number): number {
    return this.used(teamId, now) / this.weight(teamId);
  }

  forget(teamId: string): void {
    this.#used.delete(teamId);
    this.#weights.delete(teamId);
  }
}

/** The time that work of each difficulty took on this computer. */
export class HxFlowDifficultyTimes {
  readonly #times: Record<HxFlowDifficulty, number[]> = { low: [], mid: [], high: [] };

  constructor(initial?: Partial<Record<HxFlowDifficulty, number[]>>) {
    for (const key of ["low", "mid", "high"] as const)
      this.#times[key] = [...(initial?.[key] ?? [])].slice(-DIFFICULTY_KEEP);
  }

  record(difficulty: HxFlowDifficulty, ms: number): void {
    if (!(ms > 0)) return;
    const list = this.#times[difficulty];
    list.push(ms);
    if (list.length > DIFFICULTY_KEEP) list.splice(0, list.length - DIFFICULTY_KEEP);
  }

  median(difficulty: HxFlowDifficulty): number | null {
    const list = [...this.#times[difficulty]].sort((left, right) => left - right);
    if (list.length === 0) return null;
    const middle = Math.floor(list.length / 2);
    return list.length % 2 ? (list[middle] ?? null) : ((list[middle - 1] ?? 0) + (list[middle] ?? 0)) / 2;
  }

  /** False when "low" work does not take less time than "high" work here. */
  ruleOn(): boolean {
    if (this.#times.low.length < DIFFICULTY_MIN_SAMPLES || this.#times.high.length < DIFFICULTY_MIN_SAMPLES)
      return true;
    const low = this.median("low");
    const high = this.median("high");
    return low === null || high === null || low < high;
  }

  toJSON(): Record<HxFlowDifficulty, number[]> {
    return { low: [...this.#times.low], mid: [...this.#times.mid], high: [...this.#times.high] };
  }
}

const DIFFICULTY_RANK: Record<HxFlowDifficulty, number> = { low: 0, mid: 1, high: 2 };

export interface HxFlowOrderContext {
  now: number;
  shares: HxFlowShares;
  times: HxFlowDifficultyTimes;
  /** When the last turn of the lane ended, or undefined. */
  lastEnded(lane: string): number | undefined;
  /** How many pieces of work of the batch started so far. */
  batchStarts(batch: string): number;
}

/** Negative when `left` goes first. */
export function hxFlowCompare(left: HxFlowCandidate, right: HxFlowCandidate, context: HxFlowOrderContext): number {
  const tiers = hxFlowEffectiveTier(left, context.now) - hxFlowEffectiveTier(right, context.now);
  if (tiers !== 0) return tiers;
  if (left.teamId !== null && right.teamId !== null && left.teamId !== right.teamId) {
    const leftShare = context.shares.share(left.teamId, context.now);
    const rightShare = context.shares.share(right.teamId, context.now);
    const larger = Math.max(leftShare, rightShare);
    if (larger > 0 && Math.abs(leftShare - rightShare) > larger * HX_FLOW_SHARE_TIE) return leftShare - rightShare;
    const warm = Number(isWarm(right.lane, context)) - Number(isWarm(left.lane, context));
    if (warm !== 0) return warm;
  } else if (left.teamId !== null && left.teamId === right.teamId) {
    if (left.dependents !== right.dependents) return right.dependents - left.dependents;
    if (
      left.batch !== null &&
      left.batch === right.batch &&
      left.difficulty !== null &&
      right.difficulty !== null &&
      context.times.ruleOn() &&
      (context.batchStarts(left.batch) + 1) % HX_FLOW_BATCH_ORDER_EVERY !== 0
    ) {
      const difficulty = DIFFICULTY_RANK[left.difficulty] - DIFFICULTY_RANK[right.difficulty];
      if (difficulty !== 0) return difficulty;
    }
    if (left.order !== right.order) return left.order - right.order;
  }
  if (left.readyAt !== right.readyAt) return left.readyAt - right.readyAt;
  return left.lane < right.lane ? -1 : left.lane > right.lane ? 1 : 0;
}

function isWarm(lane: string, context: HxFlowOrderContext): boolean {
  const ended = context.lastEnded(lane);
  return ended !== undefined && context.now - ended <= HX_FLOW_WARM_MS;
}

/** The candidates in the order in which they start. */
export function hxFlowSort(candidates: readonly HxFlowCandidate[], context: HxFlowOrderContext): HxFlowCandidate[] {
  return [...candidates].sort((left, right) => hxFlowCompare(left, right, context));
}
