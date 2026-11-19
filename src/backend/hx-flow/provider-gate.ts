// HXBot 并发（二）：提供商在途上限 L（v1.7.4，CONC-02）。
//
// One limit L for each provider + account + model. It counts the turns that wait for that model now:
// the running turns of the key that are not in a tool step (a tool step works on this computer, it
// does not wait for the model), and the starts that the drain gave out and whose turn did not start
// yet. Admission: a person's turn when in flight < L + 1; any other turn when in flight
// < L − (L ≥ 3 ? 1 : 0). A 429 (a short throttle, not a spent plan) halves L and pauses the key until
// Retry-After, or 20 to 40 s when the provider named no time. In a pause nothing else starts; one
// person's turn may start as a probe when the pause is HXBot's own guess (no time named). HXBot does
// not retry for the CLI: the CLI retries by itself.
//
// L adapts to the time from a turn's start to its first output (Gradient2): each sample is divided by
// the baseline of its input size class (3 classes), the short window is the mean of the last 10 such
// ratios, the long window their exponential mean (0.01). g = clamp(1.5 × long / short, 0.5, 1). Slow
// start from 2 (a local model from 1) adds 1 for each sample with g = 1, up to the first sign of
// congestion; after it L ← 0.8 L + 0.2 (L g + q), q = 1 when g = 1, else 0. L stays in 1 to 16, and a
// local model (Ollama, LM Studio) under the parallel setting of its server.
//
// Three refinements that the rule leaves open, from the same congestion control:
// - A ratio counts at most 4 (an outlier is clipped). One request that hung for 30 × its baseline
//   kept g at 0.5 for the whole short window and cut L by two thirds; a slow provider still shows as
//   many ratios above 1.5.
// - L grows only on a sample of a turn that waited while the key used at least half of L. A limit that
//   nothing tested says nothing about the provider; without it a quiet hour lifts L to 16, and the
//   next burst sends 16 turns at once.
// - A burst of 429s (every turn of a burst gets one) halves L once: the next 429 in the pause only
//   moves the end of the pause.
//
// It never imports the agent service, the drain or the turns: they call it, and attach a view.
import { createHxBotLogger } from "@hxbot/logging";

export type HxProviderTier = 0 | 1 | 2 | 3;
export type HxInputClass = 0 | 1 | 2;

/** What a line of the gate's log carries: numbers, flags and the key. */
export type HxProviderLogData = Readonly<Record<string, string | number | boolean>>;

export const HX_PROVIDER_LIMITS = {
  min: 1,
  max: 16,
  startCloud: 2,
  startLocal: 1,
  shortWindow: 10,
  longWeight: 0.01,
  /**
   * The baseline of a size class is a low estimate of its speed with no load: a faster sample moves it
   * down quickly, a slower one up slowly. A baseline that followed every sample at the same rate took
   * a sustained slowdown as the new normal within a few dozen samples, before the limit could react.
   */
  baselineDown: 0.2,
  baselineUp: 0.002,
  tolerance: 1.5,
  /** The largest ratio that a sample counts as. */
  maxRatio: 4,
  minGradient: 0.5,
  pauseMinMs: 20_000,
  pauseSpreadMs: 20_000,
  /** Retry-After longer than this is a usage limit's business, not a throttle's. */
  pauseMaxMs: 10 * 60_000,
  /** A start that the drain gave out and whose turn did not start in this time is dropped. */
  startHoldMs: 90_000,
  /** Input sizes (characters) that split the samples into three classes. */
  sizeClasses: [8_000, 64_000],
} as const;

/** What the agent service tells about the model of an agent. */
export interface HxProviderModel {
  /** provider + account + model. */
  key: string;
  /** A model of this computer (Ollama, LM Studio): L starts at 1 and stays under `localParallel`. */
  local: boolean;
  /** The parallel setting of the local server, when known. */
  localParallel?: number;
  /** For the user and the logs: "Codex · gpt-5". */
  label: string;
}

export interface HxProviderView {
  /** The model that the next turn of the agent uses, or null when it has none (a remote agent). */
  modelOf(agentId: string): HxProviderModel | null;
  /** A key may admit again: the lanes that wait for it try again. */
  wake(): void;
}

export interface HxProviderState {
  key: string;
  label: string;
  limit: number;
  /** The float value of L, for the logs and the tests. */
  rawLimit: number;
  inFlight: number;
  slowStart: boolean;
  pausedUntil: number | null;
  /** The provider named the time of the pause. */
  pauseNamed: boolean;
  throttles: number;
}

/** Why a lane cannot start now, for the hold detail (CONC-09). */
export interface HxProviderRefusal {
  key: string;
  label: string;
  /** Paused for a throttle, until this time; null when the limit is full. */
  pausedUntil: number | null;
  /** When the gate refused the lane last. */
  at: number;
}

interface Turn {
  key: string;
  startedAt: number;
  inputClass: HxInputClass;
  /** The tool steps that are open: while one is, the turn does not wait for the model. */
  tools: number;
  sampled: boolean;
  /** In flight of the key (this one too) when it started, for the growth rule. */
  usedAtStart: number;
  limitAtStart: number;
  probe: boolean;
}

interface Pending {
  key: string;
  at: number;
  probe: boolean;
}

class KeyState {
  limit: number;
  slowStart = true;
  readonly ratios: number[] = [];
  long = 1;
  readonly baselines: (number | null)[] = [null, null, null];
  pausedUntil = 0;
  /** When the pause that runs now began. */
  pausedAt = 0;
  pauseNamed = false;
  throttles = 0;
  label: string;
  cap: number;
  local: boolean;

  constructor(model: HxProviderModel) {
    this.local = model.local;
    this.cap = model.local
      ? Math.max(HX_PROVIDER_LIMITS.min, Math.min(HX_PROVIDER_LIMITS.max, Math.floor(model.localParallel ?? 1)))
      : HX_PROVIDER_LIMITS.max;
    this.limit = Math.min(this.cap, model.local ? HX_PROVIDER_LIMITS.startLocal : HX_PROVIDER_LIMITS.startCloud);
    this.label = model.label;
  }

  whole(): number {
    return Math.max(HX_PROVIDER_LIMITS.min, Math.floor(this.limit + 1e-9));
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The input size class of a turn: 0 small, 1 medium, 2 large. */
export function hxInputClass(chars: number): HxInputClass {
  const [small, medium] = HX_PROVIDER_LIMITS.sizeClasses;
  return chars < small ? 0 : chars < medium ? 1 : 2;
}

export class HxProviderGate {
  readonly #keys = new Map<string, KeyState>();
  readonly #turns = new Map<string, Turn>();
  /** Starts that the drain gave out, by lane key, until their turn starts. */
  readonly #pending = new Map<string, Pending>();
  /** The lanes that the gate refused, and why: they wait for a wake. */
  readonly #refused = new Map<string, HxProviderRefusal>();
  #view: HxProviderView | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #log: (message: string, data: HxProviderLogData) => void;

  constructor(
    options: {
      now?: () => number;
      random?: () => number;
      log?: (message: string, data: HxProviderLogData) => void;
    } = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? Math.random;
    this.#log = options.log ?? (() => {});
  }

  attach(view: HxProviderView | null): void {
    this.#view = view;
  }

  #state(model: HxProviderModel): KeyState {
    let state = this.#keys.get(model.key);
    if (!state) {
      state = new KeyState(model);
      this.#keys.set(model.key, state);
    } else {
      state.label = model.label;
    }
    return state;
  }

  #inFlight(key: string, now: number): number {
    let count = 0;
    for (const turn of this.#turns.values()) if (turn.key === key && turn.tools === 0) count += 1;
    for (const [lane, pending] of this.#pending) {
      if (now - pending.at > HX_PROVIDER_LIMITS.startHoldMs) this.#pending.delete(lane);
      else if (pending.key === key) count += 1;
    }
    return count;
  }

  #probing(key: string): boolean {
    for (const turn of this.#turns.values()) if (turn.key === key && turn.probe) return true;
    for (const pending of this.#pending.values()) if (pending.key === key && pending.probe) return true;
    return false;
  }

  /**
   * Whether a turn of this lane may start now. `person` is a turn for a person's message (tier 0).
   * A refusal is kept: the lane waits, and the gate wakes the drain when the key can admit again.
   */
  mayStart(lane: string, person: boolean): boolean {
    const model = this.#view?.modelOf(agentOf(lane)) ?? null;
    if (!model) return true;
    const decision = this.#decide(model, person);
    if (decision.ok) {
      this.#refused.delete(lane);
      return true;
    }
    this.#refused.set(lane, decision.refusal);
    this.#arm();
    return false;
  }

  /** Whether a turn of this lane could start now; it records nothing (for the other lanes of a check). */
  check(lane: string, person: boolean): boolean {
    const model = this.#view?.modelOf(agentOf(lane)) ?? null;
    return !model || this.#decide(model, person).ok;
  }

  #decide(
    model: HxProviderModel,
    person: boolean,
  ): { ok: true; probe: boolean } | { ok: false; refusal: HxProviderRefusal } {
    const now = this.#now();
    const state = this.#state(model);
    const inFlight = this.#inFlight(model.key, now);
    const limit = state.whole();
    const paused = state.pausedUntil > now;
    const refusal = (pausedUntil: number | null): { ok: false; refusal: HxProviderRefusal } => ({
      ok: false,
      refusal: { key: model.key, label: state.label, pausedUntil, at: now },
    });
    if (paused) {
      // A pause that HXBot guessed lets one person's turn try the provider; a named one does not.
      if (person && !state.pauseNamed && !this.#probing(model.key) && inFlight < limit + 1)
        return { ok: true, probe: true };
      return refusal(state.pausedUntil);
    }
    const cap = person ? limit + 1 : limit - (limit >= 3 ? 1 : 0);
    if (inFlight < cap) return { ok: true, probe: false };
    return refusal(null);
  }

  /**
   * The drain starts a delivery of this lane: the start counts as in flight until its turn starts.
   * The drain asked `mayStart` just before, in the same pass.
   */
  starting(lane: string, person: boolean): void {
    const model = this.#view?.modelOf(agentOf(lane)) ?? null;
    if (!model) return;
    const decision = this.#decide(model, person);
    this.#pending.set(lane, { key: model.key, at: this.#now(), probe: decision.ok && decision.probe });
    this.#refused.delete(lane);
  }

  /** A provider turn of the agent started. `inputChars` is the size of what started it. */
  turnStarted(turnId: string, agentId: string, taskId: string | null, inputChars: number): void {
    const lane = taskId === null ? agentId : `${agentId}\u0000${taskId}`;
    const pending = this.#pending.get(lane);
    this.#pending.delete(lane);
    const model = this.#view?.modelOf(agentId) ?? null;
    const key = pending?.key ?? model?.key;
    if (!key) return;
    const state = this.#keys.get(key) ?? (model ? this.#state(model) : null);
    if (!state) return;
    const now = this.#now();
    this.#turns.set(turnId, {
      key,
      startedAt: now,
      inputClass: hxInputClass(Math.max(0, inputChars)),
      tools: 0,
      sampled: false,
      usedAtStart: this.#inFlight(key, now) + 1,
      limitAtStart: state.whole(),
      probe: pending?.probe ?? false,
    });
  }

  /** The turn's first text, thinking or tool step: one sample of the model's speed. */
  firstOutput(turnId: string): void {
    const turn = this.#turns.get(turnId);
    if (!turn || turn.sampled) return;
    turn.sampled = true;
    const state = this.#keys.get(turn.key);
    if (!state) return;
    const now = this.#now();
    if (turn.probe) {
      // The probe got an answer: the provider takes turns again.
      turn.probe = false;
      if (state.pausedUntil > now) {
        state.pausedUntil = now;
        this.#log("A provider answered the probe; its pause ends.", { key: turn.key });
      }
    }
    this.#sample(state, turn, Math.max(1, now - turn.startedAt));
    this.#wake();
  }

  #sample(state: KeyState, turn: Turn, ms: number): void {
    const baseline = state.baselines[turn.inputClass] ?? ms;
    const weight = ms < baseline ? HX_PROVIDER_LIMITS.baselineDown : HX_PROVIDER_LIMITS.baselineUp;
    state.baselines[turn.inputClass] = baseline + (ms - baseline) * weight;
    const ratio = Math.min(HX_PROVIDER_LIMITS.maxRatio, ms / baseline);
    state.ratios.push(ratio);
    if (state.ratios.length > HX_PROVIDER_LIMITS.shortWindow) state.ratios.shift();
    state.long = state.long * (1 - HX_PROVIDER_LIMITS.longWeight) + ratio * HX_PROVIDER_LIMITS.longWeight;
    const short = state.ratios.reduce((sum, value) => sum + value, 0) / state.ratios.length;
    const gradient = clamp((HX_PROVIDER_LIMITS.tolerance * state.long) / short, HX_PROVIDER_LIMITS.minGradient, 1);
    // A limit that the turns did not use says nothing about the provider: it does not grow. The first
    // turn of a burst started alone but waited with the others, so the in flight of now counts too.
    const used = Math.max(turn.usedAtStart, this.#inFlight(turn.key, this.#now()));
    const tested = used * 2 >= turn.limitAtStart;
    const before = state.limit;
    if (state.slowStart && gradient === 1) {
      if (tested) state.limit = Math.min(state.cap, state.limit + 1);
    } else {
      state.slowStart = false;
      const next = 0.8 * state.limit + 0.2 * (state.limit * gradient + (gradient === 1 ? 1 : 0));
      state.limit = clamp(tested || next < state.limit ? next : state.limit, HX_PROVIDER_LIMITS.min, state.cap);
    }
    if (Math.floor(before) !== Math.floor(state.limit))
      this.#log("A provider limit changed.", {
        key: turn.key,
        from: Math.floor(before),
        to: Math.floor(state.limit),
        gradient: Number(gradient.toFixed(3)),
      });
  }

  /** A tool step of the turn opened or closed: in a tool step the turn does not wait for the model. */
  toolSteps(turnId: string, open: number): void {
    const turn = this.#turns.get(turnId);
    if (!turn) return;
    const was = turn.tools;
    turn.tools = Math.max(0, open);
    if (was === 0 && turn.tools > 0) this.#wake();
  }

  turnEnded(turnId: string): void {
    if (this.#turns.delete(turnId)) this.#wake();
  }

  /** A delivery that the drain started ended without a turn (it failed before the provider took it). */
  startEnded(lane: string): void {
    if (this.#pending.delete(lane)) this.#wake();
  }

  /**
   * The provider throttled a turn (a 429 that is not a spent plan). `retryAfterMs` is the time that
   * the provider named, or null. Halves L once per pause, and pauses the key.
   */
  throttled(turnId: string | null, agentId: string | null, retryAfterMs: number | null): void {
    const key =
      (turnId ? this.#turns.get(turnId)?.key : undefined) ?? (agentId ? this.#view?.modelOf(agentId)?.key : undefined);
    if (!key) return;
    const state = this.#keys.get(key) ?? this.#stateFor(agentId);
    if (!state) return;
    const now = this.#now();
    const named = retryAfterMs !== null && retryAfterMs > 0;
    const wait = named
      ? Math.min(retryAfterMs, HX_PROVIDER_LIMITS.pauseMaxMs)
      : HX_PROVIDER_LIMITS.pauseMinMs + this.#random() * HX_PROVIDER_LIMITS.pauseSpreadMs;
    const inPause = state.pausedUntil > now;
    if (!inPause) {
      const before = state.whole();
      state.limit = Math.max(HX_PROVIDER_LIMITS.min, Math.floor(state.limit / 2));
      state.slowStart = false;
      state.throttles += 1;
      state.pauseNamed = named;
      state.pausedUntil = now + wait;
      state.pausedAt = now;
      this.#log("A provider throttled; its limit halves and it pauses.", {
        key,
        from: before,
        to: state.whole(),
        pauseMs: Math.round(wait),
        named,
      });
    } else {
      // The same burst: the pause ends at the latest time that the provider named.
      state.pausedUntil = Math.max(state.pausedUntil, now + wait);
      state.pauseNamed ||= named;
    }
    const turn = turnId ? this.#turns.get(turnId) : undefined;
    if (turn) turn.probe = false;
    this.#arm();
  }

  #stateFor(agentId: string | null): KeyState | null {
    const model = agentId ? (this.#view?.modelOf(agentId) ?? null) : null;
    return model ? this.#state(model) : null;
  }

  /** Why this lane waits on the provider, or null when the gate does not hold it. */
  refusal(lane: string): HxProviderRefusal | null {
    return this.#refused.get(lane) ?? null;
  }

  /** The lanes that wait for this key now, in the order they were refused. */
  waitingFor(key: string): string[] {
    return [...this.#refused].filter(([, refusal]) => refusal.key === key).map(([lane]) => lane);
  }

  /** Whether the bottleneck of this agent's model is the provider (CONC-08): paused, or lanes wait. */
  bottleneck(agentId: string): { paused: boolean; pausedForMs: number; waiting: number } | null {
    const model = this.#view?.modelOf(agentId) ?? null;
    if (!model) return null;
    const state = this.#keys.get(model.key);
    if (!state) return null;
    const now = this.#now();
    const paused = state.pausedUntil > now;
    return {
      paused,
      pausedForMs: paused ? state.pausedUntil - now : 0,
      waiting: this.waitingFor(model.key).length,
    };
  }

  /** When the pause of this key that runs now began, or null when it is not paused (CONC-08). */
  pausedSince(key: string): number | null {
    const state = this.#keys.get(key);
    return state && state.pausedUntil > this.#now() ? state.pausedAt : null;
  }

  state(key: string): HxProviderState | null {
    const state = this.#keys.get(key);
    if (!state) return null;
    const now = this.#now();
    return {
      key,
      label: state.label,
      limit: state.whole(),
      rawLimit: state.limit,
      inFlight: this.#inFlight(key, now),
      slowStart: state.slowStart,
      pausedUntil: state.pausedUntil > now ? state.pausedUntil : null,
      pauseNamed: state.pausedUntil > now && state.pauseNamed,
      throttles: state.throttles,
    };
  }

  states(): HxProviderState[] {
    return [...this.#keys.keys()].flatMap((key) => this.state(key) ?? []);
  }

  /**
   * HXBot's own model call (a judge, a summary) under the limit of this model: waits for a place of
   * `tier` (3 background, 1 a judge) and returns its release. Null when the place did not come in
   * `waitMs`: the caller goes on without the model.
   */
  async acquire(
    model: HxProviderModel,
    tier: HxProviderTier,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<(() => void) | null> {
    const deadline = this.#now() + waitMs;
    const lane = `hx-side\u0000${model.key}\u0000${Math.random().toString(36).slice(2)}`;
    for (;;) {
      if (signal?.aborted) return null;
      const decision = this.#decide(model, tier === 0);
      if (decision.ok) {
        const turnId = lane;
        const now = this.#now();
        this.#turns.set(turnId, {
          key: model.key,
          startedAt: now,
          inputClass: 0,
          tools: 0,
          sampled: true,
          usedAtStart: this.#inFlight(model.key, now) + 1,
          limitAtStart: this.#state(model).whole(),
          probe: false,
        });
        return () => this.turnEnded(turnId);
      }
      if (this.#now() >= deadline) return null;
      await new Promise((done) => setTimeout(done, 250));
    }
  }

  /** A wake at the end of the earliest pause, so that the lanes that wait for it try again. */
  #arm(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const now = this.#now();
    let next = Number.POSITIVE_INFINITY;
    for (const state of this.#keys.values()) if (state.pausedUntil > now) next = Math.min(next, state.pausedUntil);
    if (!Number.isFinite(next)) return;
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        this.#wake();
        this.#arm();
      },
      Math.max(10, next - now + 5),
    );
    this.#timer.unref?.();
  }

  #wake(): void {
    // A lane that was not refused again in this time no longer waits for the gate (its message went).
    const now = this.#now();
    for (const [lane, refusal] of this.#refused) if (now - refusal.at > STALE_REFUSAL_MS) this.#refused.delete(lane);
    if (this.#refused.size === 0) return;
    this.#view?.wake();
  }

  /** For the tests and for a reset of the app: forget every key. */
  reset(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#keys.clear();
    this.#turns.clear();
    this.#pending.clear();
    this.#refused.clear();
  }
}

const STALE_REFUSAL_MS = 30 * 60_000;

function agentOf(lane: string): string {
  const separator = lane.indexOf("\u0000");
  return separator < 0 ? lane : lane.slice(0, separator);
}

/**
 * The time that a provider's throttle names, in ms, or null: "Retry-After: 30", "retry after 12
 * seconds", "Please try again in 6.5s" (OpenAI), "try again in 1m30s", "Please retry in 41.3s" and
 * `"retryDelay": "41s"` (Gemini), "retrying in 5 seconds" (a CLI that waits by itself).
 */
export function hxRetryAfterMs(message: string): number | null {
  const millis = /\bretry-after-ms["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/iu.exec(message);
  if (millis?.[1]) return Math.round(Number(millis[1]));
  const header = /\bretry[-_ ]after["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)\b(?!\s*(?:ms|milliseconds?))/iu.exec(message);
  if (header?.[1]) return Math.round(Number(header[1]) * 1000);
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/u.exec(message);
  if (delay?.[1]) return Math.round(Number(delay[1]) * 1000);
  const phrase =
    /\b(?:retry(?:ing)?|try again)\s+(?:after|in)\s+((?:\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hours?)(?![a-z])\s*(?:and\s+)?)+)/iu.exec(
      message,
    );
  if (!phrase?.[1]) return null;
  let total = 0;
  for (const part of phrase[1].matchAll(
    /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hours?)(?![a-z])/giu,
  )) {
    const amount = Number(part[1]);
    const unit = (part[2] ?? "").toLowerCase();
    total +=
      unit === "ms" || unit.startsWith("milli")
        ? amount
        : unit.startsWith("h")
          ? amount * 3_600_000
          : unit === "m" || unit.startsWith("min")
            ? amount * 60_000
            : amount * 1000;
  }
  return total > 0 ? Math.round(total) : null;
}

const logger = createHxBotLogger("hx-flow");

export const hxProviderGate = new HxProviderGate({ log: (message, data) => logger.info(message, data) });
