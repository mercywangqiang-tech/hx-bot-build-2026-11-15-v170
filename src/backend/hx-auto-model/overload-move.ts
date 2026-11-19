// HXBot 并发（二）：过载时给新开的对话换模型（v1.7.4，CONC-08）。
//
// Only when all of these hold:
// - the work is new: a new chat or task, or a team member's new piece of work (a chat that goes on
//   keeps its model, its session and its cache);
// - the bottleneck is the model's provider: it is paused after a throttle, or the work would wait for
//   it longer than the target of its tier (place × the recent turn time ÷ L). A computer that runs
//   out of memory is not helped by another model: every CLI needs memory;
// - the new model ranks the same or better (S > A > B > C), can take the work, is ready, is not
//   excluded, is not itself held by its provider;
// - a model of this computer (Ollama, LM Studio) moves only to another model of this computer;
// - another provider only when the user allowed moving across providers;
// - a team member only when its provider has been paused more than 2 minutes.
// The caller writes one line in the chat: which model, and why.
import {
  HX_MODEL_TIERS,
  type HxAutoModelSettings,
  type HxCandidate,
  type HxModelInfo,
  hxRefOf,
  hxSameModel,
} from "@hxbot/contracts/hx-auto-model";
import { hxProviderGate } from "../hx-flow/provider-gate";
import { hxProviderModelOf } from "../hx-flow/provider-model";

/** A team member moves only after its provider has been paused this long. */
export const HX_MEMBER_PAUSE_MS = 2 * 60_000;

export type HxOverloadWhy = "paused" | "queue";

export interface HxOverloadInput {
  current: HxModelInfo;
  candidates: readonly HxCandidate[];
  settings: Pick<HxAutoModelSettings, "excluded" | "crossProvider">;
  /** The target of the work's tier, in ms (HX_OVERLOAD_TARGETS). */
  targetMs: number;
  /** The recent time of one turn, in ms. */
  turnMs: number;
  /** A team member: only a pause of more than 2 minutes moves it. */
  member: boolean;
  /** Whether a candidate can take the work (pictures, long material). */
  canTake: (candidate: HxCandidate) => boolean;
  now: number;
}

function rank(candidate: Pick<HxCandidate, "profile">): number {
  // HX_MODEL_TIERS lists the weakest first: C, B, A, S.
  return HX_MODEL_TIERS.indexOf(candidate.profile.tier);
}

/** Why the provider of this model holds new work now, or null when it does not. */
export function hxProviderBottleneck(
  model: HxModelInfo,
  targetMs: number,
  turnMs: number,
  member: boolean,
  now: number,
): HxOverloadWhy | null {
  const key = hxProviderModelOf({
    provider: model.provider,
    model: model.id,
    providerAccountId: model.providerAccountId,
  });
  if (!key) return null;
  const state = hxProviderGate.state(key.key);
  if (!state) return null;
  if (state.pausedUntil !== null) {
    if (!member) return "paused";
    const pausedSince = hxProviderGate.pausedSince(key.key);
    return pausedSince !== null && now - pausedSince > HX_MEMBER_PAUSE_MS ? "paused" : null;
  }
  if (member) return null;
  // The new work would wait behind the ones that wait for this model now, and the ones in flight.
  const waiting = hxProviderGate.waitingFor(key.key).length;
  const full = state.inFlight >= state.limit;
  if (!full) return null;
  const waitMs = ((waiting + 1) * turnMs) / Math.max(1, state.limit);
  return waitMs > targetMs ? "queue" : null;
}

/** The model to move new work to, or null to keep the current one. */
export function hxOverloadChoice(input: HxOverloadInput): { candidate: HxCandidate; why: HxOverloadWhy } | null {
  const why = hxProviderBottleneck(input.current, input.targetMs, input.turnMs, input.member, input.now);
  if (!why) return null;
  const currentRef = hxRefOf(input.current);
  const currentCandidate = input.candidates.find((candidate) => hxSameModel(hxRefOf(candidate.model), currentRef));
  const floor = currentCandidate ? rank(currentCandidate) : 0;
  const local = hxProviderModelOf({ provider: input.current.provider, model: input.current.id })?.local ?? false;
  const options = input.candidates.filter((candidate) => {
    const ref = hxRefOf(candidate.model);
    if (hxSameModel(ref, currentRef) || candidate.unavailable !== null) return false;
    if (input.settings.excluded.some((excluded) => hxSameModel(excluded, ref))) return false;
    if (!input.settings.crossProvider && candidate.model.provider !== input.current.provider) return false;
    const key = hxProviderModelOf({
      provider: ref.provider,
      model: ref.model,
      providerAccountId: ref.providerAccountId,
    });
    if (!key) return false;
    // A model of this computer stays on this computer.
    if (local && !key.local) return false;
    if (rank(candidate) < floor || !input.canTake(candidate)) return false;
    // A model that is itself held helps nothing.
    return hxProviderBottleneck(candidate.model, input.targetMs, input.turnMs, false, input.now) === null;
  });
  // The same rank first (cheapest change), then the nearest better one; the provider of the work first.
  options.sort(
    (left, right) =>
      rank(left) - rank(right) ||
      Number(left.model.provider !== input.current.provider) - Number(right.model.provider !== input.current.provider),
  );
  const best = options[0];
  return best ? { candidate: best, why } : null;
}
