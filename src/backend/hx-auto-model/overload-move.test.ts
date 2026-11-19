import { type HxCandidate, type HxModelInfo, hxModelProfile } from "@hxbot/contracts/hx-auto-model";
import { afterEach, describe, expect, it } from "vitest";
import { hxProviderGate } from "../hx-flow/provider-gate";
import { hxProviderModelOf } from "../hx-flow/provider-model";
import { HX_MEMBER_PAUSE_MS, hxOverloadChoice } from "./overload-move";

const model = (provider: HxModelInfo["provider"], id: string, name = id): HxModelInfo => ({
  provider,
  id,
  name,
  supportedReasoningEfforts: ["medium"],
  defaultReasoningEffort: "medium",
});
const candidate = (info: HxModelInfo, unavailable: HxCandidate["unavailable"] = null): HxCandidate => ({
  model: info,
  profile: hxModelProfile(info),
  unavailable,
});

const opus = model("claude", "claude-opus-4-5", "Claude Opus");
const gpt = model("codex", "gpt-5.2-pro", "GPT Pro");
const sonnet = model("claude", "claude-sonnet-4-5", "Claude Sonnet");
const haiku = model("claude", "claude-haiku-4-5", "Claude Haiku");
const qwen = model("opencode", "ollama/qwen3:32b", "Qwen (local)");
const llama = model("opencode", "ollama/llama3.3:70b", "Llama (local)");

/** Pauses the provider of `info` with a 429, as the drain and the turns would. */
function pause(info: HxModelInfo, ms = 30_000) {
  const key = hxProviderModelOf({ provider: info.provider, model: info.id });
  if (!key) throw new Error("no key");
  hxProviderGate.attach({ modelOf: (agentId) => (agentId === key.key ? key : null), wake: () => undefined });
  hxProviderGate.starting(key.key, false);
  hxProviderGate.turnStarted(`turn-${key.key}`, key.key, null, 10);
  hxProviderGate.throttled(`turn-${key.key}`, null, ms);
  hxProviderGate.attach(null);
}

const input = (
  current: HxModelInfo,
  candidates: HxCandidate[],
  extra: Partial<Parameters<typeof hxOverloadChoice>[0]> = {},
) => ({
  current,
  candidates,
  settings: { excluded: [], crossProvider: true },
  targetMs: 5_000,
  turnMs: 60_000,
  member: false,
  canTake: () => true,
  now: Date.now(),
  ...extra,
});

afterEach(() => {
  hxProviderGate.reset();
});

describe("CONC-08: a new chat moves only to a model of the same rank or better", () => {
  it("keeps the model when its provider is not the bottleneck", () => {
    expect(hxOverloadChoice(input(opus, [candidate(opus), candidate(gpt)]))).toBeNull();
  });

  it("moves a paused provider's new work to a model of the same rank, never down", () => {
    pause(opus);
    const choice = hxOverloadChoice(
      input(opus, [candidate(opus), candidate(haiku), candidate(sonnet), candidate(gpt)]),
    );
    expect(choice?.why).toBe("paused");
    expect(choice?.candidate.model.id).toBe(gpt.id);
    // Only weaker ones: it stays.
    expect(hxOverloadChoice(input(opus, [candidate(opus), candidate(haiku), candidate(sonnet)]))).toBeNull();
  });

  it("CONC-08-A1: never moves to an excluded model or provider, nor across providers when that is off", () => {
    pause(opus);
    const all = [candidate(opus), candidate(gpt)];
    const excluded = { excluded: [{ provider: "codex" as const, model: gpt.id }], crossProvider: true };
    expect(hxOverloadChoice(input(opus, all, { settings: excluded }))).toBeNull();
    expect(hxOverloadChoice(input(opus, all, { settings: { excluded: [], crossProvider: false } }))).toBeNull();
  });

  it("CONC-08-A2: a model of this computer moves only to another model of this computer", () => {
    pause(qwen);
    const choice = hxOverloadChoice(input(qwen, [candidate(qwen), candidate(opus), candidate(gpt), candidate(llama)]));
    expect(choice?.candidate.model.id).toBe(llama.id);
    expect(hxOverloadChoice(input(qwen, [candidate(qwen), candidate(opus), candidate(gpt)]))).toBeNull();
  });

  it("skips a model that is not ready, cannot take the work, or is held by its own provider", () => {
    pause(opus);
    pause(gpt);
    expect(hxOverloadChoice(input(opus, [candidate(opus), candidate(gpt)]))).toBeNull();
    hxProviderGate.reset();
    pause(opus);
    expect(hxOverloadChoice(input(opus, [candidate(opus), candidate(gpt, "not-ready")]))).toBeNull();
    expect(hxOverloadChoice(input(opus, [candidate(opus), candidate(gpt)], { canTake: () => false }))).toBeNull();
  });

  it("moves a team member only after its provider has been paused more than 2 minutes", () => {
    pause(opus, 600_000);
    const all = [candidate(opus), candidate(gpt)];
    expect(hxOverloadChoice(input(opus, all, { member: true }))).toBeNull();
    const later = Date.now() + HX_MEMBER_PAUSE_MS + 1_000;
    expect(hxOverloadChoice(input(opus, all, { member: true, now: later }))?.candidate.model.id).toBe(gpt.id);
  });
});
