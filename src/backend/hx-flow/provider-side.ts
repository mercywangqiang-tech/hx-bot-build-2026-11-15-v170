// HXBot 并发（二）：HXBot 自己用模型做的事也受提供商在途上限约束（v1.7.4，CONC-02）。
//
// Every model call of HXBot's own (a channel summary or routing turn, a memory review, a side
// question, a web search, a profile or a title) goes through generateTextWithoutTools, which asks
// here for a place under the limit of its provider, account and model. The kind of the call comes
// from the usage observer that the caller passes (usage-collection.ts tags it):
// - a side question and a web search are a person's: they never wait, and count when there is room;
// - a channel turn is team or channel work (tier 2): it waits up to 15 s for a place;
// - a memory review and a call with no observer (a profile, a title) are background (tier 3): up to
//   30 s. A call that got no place in that time goes on and the log says so: a summary that waits
//   for a ten-minute Retry-After would hold the spare client, and a person's side question behind it.
// - the judge of the automatic model choice takes its place (tier 1) before it starts (router.ts),
//   and is not counted twice here.
import { DEFAULT_PROVIDER_ACCOUNT_ID } from "@hxbot/contracts/ipc";
import { createHxBotLogger } from "@hxbot/logging";
import { type HxProviderTier, hxProviderGate } from "./provider-gate";
import { hxProviderModelOf } from "./provider-model";

const logger = createHxBotLogger("hx-flow");

export type HxSideKind = "memory-review" | "web-search" | "auto-model" | "channel" | "side-question";

/** The kind of each usage observer that a side session made. */
const kinds = new WeakMap<object, HxSideKind>();

export function hxTagSideObserver<T extends object>(observer: T, kind: HxSideKind): T {
  kinds.set(observer, kind);
  return observer;
}

const PLACES: Record<HxSideKind | "background", { tier: HxProviderTier; waitMs: number } | null> = {
  "side-question": { tier: 0, waitMs: 0 },
  "web-search": { tier: 0, waitMs: 0 },
  channel: { tier: 2, waitMs: 15_000 },
  "memory-review": { tier: 3, waitMs: 30_000 },
  background: { tier: 3, waitMs: 30_000 },
  "auto-model": null,
};

const NO_PLACE = () => {};

/**
 * Takes a place for a side call of this model and returns its release. Never fails: a call that got
 * no place in its time goes on without one.
 */
export async function hxSidePlace(
  model: { provider: string; id: string; providerAccountId?: string | undefined },
  observer: object | undefined,
  cancelled: () => boolean,
): Promise<() => void> {
  const kind = (observer && kinds.get(observer)) ?? "background";
  const place = PLACES[kind];
  if (!place) return NO_PLACE;
  const key = hxProviderModelOf({
    provider: model.provider,
    model: model.id,
    providerAccountId: model.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID,
  });
  if (!key) return NO_PLACE;
  const stop = new AbortController();
  const watch = setInterval(() => {
    if (cancelled()) stop.abort();
  }, 250);
  watch.unref?.();
  try {
    const release = await hxProviderGate.acquire(key, place.tier, place.waitMs, stop.signal);
    if (release) return release;
    if (place.waitMs > 0 && !stop.signal.aborted)
      logger.info("A model call of HXBot went on without a place under the provider limit.", {
        kind,
        waitedMs: place.waitMs,
      });
    return NO_PLACE;
  } finally {
    clearInterval(watch);
  }
}
