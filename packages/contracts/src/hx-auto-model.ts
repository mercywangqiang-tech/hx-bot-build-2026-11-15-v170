// HXBot：按工作内容自动选择模型，和开工前的建议卡（v1.6.5）。
//
// An agent set to "auto" picks its model for each new piece of work: the host classifies the work
// (`src/backend/hx-auto-model/classify.ts`), and `hxChooseModel` here picks one of the models the
// user allows. The same code runs on the host, which routes, and in the settings screen, which
// previews what each kind of work would get. Nothing here reads a file or the network.
//
// What is fixed by the user's choices (2026-11-12): the default preference is "free first"; the pool
// holds every model of a signed-in provider, subscriptions included; moving to another provider is
// on; models outside China are allowed; and a stronger model is only offered, never taken, when a
// turn goes badly. 2026-11-13 added the kind "computer" (operating this computer) and the roles of a
// proposal card: planning and the final check get a stronger model, written on the card.
import { type AgentProviderId, isAgentProvider, isFreeOpencodeModel } from "./agent-providers";
import { type AgentReasoningEffort, isAgentModel } from "./ipc-agent-identity";
import { DEFAULT_PROVIDER_ACCOUNT_ID, isProviderAccountId } from "./ipc-agent-status";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

// ---------------------------------------------------------------- kinds of work

export const HX_WORK_TYPES = [
  "chat",
  "writing",
  "code-small",
  "code-large",
  "data",
  "vision",
  "long-context",
  "reasoning",
  "computer",
] as const;
export type HxWorkType = (typeof HX_WORK_TYPES)[number];

export const HX_DIFFICULTIES = ["low", "mid", "high"] as const;
export type HxDifficulty = (typeof HX_DIFFICULTIES)[number];

/** What a model must be able to do for the work, whatever it is best at. */
export const HX_NEEDS = ["vision", "long-context"] as const;
export type HxNeed = (typeof HX_NEEDS)[number];

export function isHxWorkType(value: unknown): value is HxWorkType {
  return isOneOf(HX_WORK_TYPES, value);
}

// ---------------------------------------------------------------- settings of one agent

export const HX_AUTO_PREFERENCES = ["free", "balanced", "quality"] as const;
export type HxAutoPreference = (typeof HX_AUTO_PREFERENCES)[number];

/** `rules+model`: rules first, and a small model when they are unsure. `rules`: no message leaves for a judge. */
export const HX_AUTO_JUDGES = ["rules+model", "rules"] as const;
export type HxAutoJudge = (typeof HX_AUTO_JUDGES)[number];

/** `auto`: the effort follows the difficulty. Otherwise every auto turn uses this effort where the model has it. */
export const HX_AUTO_EFFORTS = ["auto", "low", "medium", "high"] as const;
export type HxAutoEffort = (typeof HX_AUTO_EFFORTS)[number];

/** A provider, a model and an account, as `AgentModelChoice`; restated here so this file stands alone. */
export interface HxModelRef {
  provider: AgentProviderId;
  model: string;
  providerAccountId?: string | undefined;
}

/** When an agent shows a proposal card: when the work calls for one, before every long task, or never. */
export const HX_PROPOSAL_MODES = ["auto", "always", "off"] as const;
export type HxProposalMode = (typeof HX_PROPOSAL_MODES)[number];

export const HX_AUTO_TABLE_LIMIT = 3;
export const HX_AUTO_EXCLUDED_LIMIT = 200;

// HXBot 协作（二）（v1.6.6）: the limits of a team that this agent starts. A team stops and asks the
// user when it reaches one of them.
/** At most this many members, the user's choice from 2 to 5. */
// 4 stays: v1.6.6 offered it, and a saved 4 must still read.
export const HX_TEAM_MEMBER_LIMITS = [2, 3, 4, 5, 8, 12, 20] as const;
/** The longest time a team works, in minutes. */
export const HX_TEAM_MINUTES = [30, 60, 120, 240] as const;
/** The most handoffs (assignments and transfers) in one team. */
export const HX_TEAM_ROUNDS = [10, 20, 40, 80] as const;
/** `collapse`: a member made for the team is hidden when the team ends. `keep`: it stays in the list. */
export const HX_TEAM_TEMPORARY = ["collapse", "keep"] as const;
export type HxTeamTemporary = (typeof HX_TEAM_TEMPORARY)[number];

export interface HxAutoModelSettings {
  /** On: the agent picks its model for each new piece of work. Off: it keeps the model it has. */
  enabled: boolean;
  preference: HxAutoPreference;
  /** Models the user took out of the pool. Every other ready model is in it. */
  excluded: HxModelRef[];
  /** The user's own order for a kind of work, one to three models. A kind that is not here uses the ranking. */
  table: Partial<Record<HxWorkType, HxModelRef[]>>;
  /** Whether the agent may move to another provider (a new session, with a handoff of the chat). */
  crossProvider: boolean;
  /** When a turn goes badly, ask in the chat whether to redo the work with a stronger model. */
  suggestStronger: boolean;
  judge: HxAutoJudge;
  effort: HxAutoEffort;
  proposal: HxProposalMode;
  /** The limits of a team that this agent starts (v1.6.6). */
  teamMembers: (typeof HX_TEAM_MEMBER_LIMITS)[number];
  teamMinutes: (typeof HX_TEAM_MINUTES)[number];
  teamRounds: (typeof HX_TEAM_ROUNDS)[number];
  teamTemporary: HxTeamTemporary;
}

// v1.6.7 (the user, 2026-11-14: new features start at their strongest): auto model is on and picks
// the best model by default, and a team may have 20 members, 240 minutes and 80 handoffs. Only an
// agent with no saved value gets these; a value the user saved stays.
export const HX_AUTO_DEFAULTS: HxAutoModelSettings = {
  enabled: true,
  preference: "quality",
  excluded: [],
  table: {},
  crossProvider: true,
  suggestStronger: true,
  judge: "rules+model",
  effort: "auto",
  proposal: "auto",
  teamMembers: 20,
  teamMinutes: 240,
  teamRounds: 80,
  teamTemporary: "collapse",
};

export function hxSameModel(left: HxModelRef, right: HxModelRef): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    (left.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) === (right.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID)
  );
}

export function isHxModelRef(value: unknown): value is HxModelRef {
  return (
    isDynamicRecord(value) &&
    isAgentProvider(value.provider) &&
    isAgentModel(value.model) &&
    (value.providerAccountId === undefined || isProviderAccountId(value.providerAccountId))
  );
}

function modelRefs(value: unknown, limit: number): HxModelRef[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const refs: HxModelRef[] = [];
  for (const item of value) {
    if (!isHxModelRef(item)) return null;
    if (refs.some((ref) => hxSameModel(ref, item))) continue;
    refs.push({
      provider: item.provider,
      model: item.model,
      ...(item.providerAccountId === undefined ? {} : { providerAccountId: item.providerAccountId }),
    });
  }
  return refs;
}

/**
 * The settings in `value`, with every missing field at its default, or null when a field is there
 * but wrong. A newer client can send more fields; they are dropped.
 */
export function parseHxAutoModelSettings(value: unknown): HxAutoModelSettings | null {
  if (!isDynamicRecord(value)) return null;
  const pick = <T extends string>(values: readonly T[], field: unknown, fallback: T): T | null =>
    field === undefined ? fallback : isOneOf(values, field) ? field : null;
  const flag = (field: unknown, fallback: boolean): boolean | null =>
    field === undefined ? fallback : isBoolean(field) ? field : null;
  const enabled = flag(value.enabled, HX_AUTO_DEFAULTS.enabled);
  const crossProvider = flag(value.crossProvider, HX_AUTO_DEFAULTS.crossProvider);
  const suggestStronger = flag(value.suggestStronger, HX_AUTO_DEFAULTS.suggestStronger);
  const preference = pick(HX_AUTO_PREFERENCES, value.preference, HX_AUTO_DEFAULTS.preference);
  const judge = pick(HX_AUTO_JUDGES, value.judge, HX_AUTO_DEFAULTS.judge);
  const effort = pick(HX_AUTO_EFFORTS, value.effort, HX_AUTO_DEFAULTS.effort);
  const proposal = pick(HX_PROPOSAL_MODES, value.proposal, HX_AUTO_DEFAULTS.proposal);
  const excluded = value.excluded === undefined ? [] : modelRefs(value.excluded, HX_AUTO_EXCLUDED_LIMIT);
  const count = <T extends number>(values: readonly T[], field: unknown, fallback: T): T | null =>
    field === undefined ? fallback : (values.find((item) => item === field) ?? null);
  const teamMembers = count(HX_TEAM_MEMBER_LIMITS, value.teamMembers, HX_AUTO_DEFAULTS.teamMembers);
  const teamMinutes = count(HX_TEAM_MINUTES, value.teamMinutes, HX_AUTO_DEFAULTS.teamMinutes);
  const teamRounds = count(HX_TEAM_ROUNDS, value.teamRounds, HX_AUTO_DEFAULTS.teamRounds);
  const teamTemporary = pick(HX_TEAM_TEMPORARY, value.teamTemporary, HX_AUTO_DEFAULTS.teamTemporary);
  if (
    enabled === null ||
    crossProvider === null ||
    suggestStronger === null ||
    preference === null ||
    judge === null ||
    effort === null ||
    proposal === null ||
    excluded === null ||
    teamMembers === null ||
    teamMinutes === null ||
    teamRounds === null ||
    teamTemporary === null
  )
    return null;
  const table: Partial<Record<HxWorkType, HxModelRef[]>> = {};
  if (value.table !== undefined) {
    if (!isDynamicRecord(value.table)) return null;
    for (const [key, refs] of Object.entries(value.table)) {
      if (!isHxWorkType(key)) continue;
      const order = modelRefs(refs, HX_AUTO_TABLE_LIMIT);
      if (order === null) return null;
      if (order.length > 0) table[key] = order;
    }
  }
  return {
    enabled,
    preference,
    excluded,
    table,
    crossProvider,
    suggestStronger,
    judge,
    effort,
    proposal,
    teamMembers,
    teamMinutes,
    teamRounds,
    teamTemporary,
  };
}

// ---------------------------------------------------------------- what a model can do

/** S is the strongest. */
export const HX_MODEL_TIERS = ["C", "B", "A", "S"] as const;
export type HxModelTier = (typeof HX_MODEL_TIERS)[number];

/** `free`: no charge. `subscription`: a plan the user already pays for. `paid`: billed per use. */
export const HX_MODEL_COSTS = ["free", "subscription", "paid"] as const;
export type HxModelCost = (typeof HX_MODEL_COSTS)[number];

/** All of OpenCode's free models share one daily limit, so the router treats them as one group. */
export const HX_OPENCODE_FREE_GROUP = "opencode-free";

export interface HxModelProfile {
  tier: HxModelTier;
  vision: boolean;
  /** Whether its tool calls can be trusted; every agent turn uses tools. */
  tools: boolean;
  /** Context window in tokens. */
  window: number;
  cost: HxModelCost;
  freeGroup: string | null;
  /** What it is better (+1) or worse (-1) at than its tier says. */
  strengths: Partial<Record<HxWorkType, number>>;
}

/** A model the router can see: from the host's model list. */
export interface HxModelInfo {
  provider: AgentProviderId;
  id: string;
  name: string;
  providerAccountId?: string | undefined;
  supportedReasoningEfforts?: readonly AgentReasoningEffort[] | undefined;
  defaultReasoningEffort?: AgentReasoningEffort | undefined;
}

/** The providers whose own models all read images. */
const VISION_PROVIDERS: ReadonlySet<AgentProviderId> = new Set(["claude", "codex", "grok", "antigravity"]);

/** Providers that run on the user's own plan; another provider's models are billed per use unless free. */
const SUBSCRIPTION_PROVIDERS: ReadonlySet<AgentProviderId> = new Set([
  "claude",
  "codex",
  "grok",
  "antigravity",
  "cursor",
  "copilot",
  "devin",
  "kimi",
  "muse",
]);

interface FamilyRule {
  pattern: RegExp;
  tier: HxModelTier;
  strengths?: Partial<Record<HxWorkType, number>>;
  /** The pattern names the size already (gpt nano, gemini flash, glm air), so a size word does not count twice. */
  sized?: true;
}

const CODE: Partial<Record<HxWorkType, number>> = { "code-small": 1, "code-large": 1 };
/** Models that have done well at operating a computer with tools and screenshots. */
const COMPUTER: Partial<Record<HxWorkType, number>> = { computer: 1 };
const WRITE: Partial<Record<HxWorkType, number>> = { writing: 1, chat: 1 };

/** The first rule whose pattern matches the model's id and name decides its tier. Order matters. */
const FAMILY_RULES: readonly FamilyRule[] = [
  { pattern: /claude[\s-]*opus|\bopus\b/u, tier: "S", strengths: { ...WRITE, reasoning: 1, ...CODE, ...COMPUTER } },
  {
    pattern: /claude[\s-]*(?:sonnet|fable)|\b(?:sonnet|fable)\b/u,
    tier: "A",
    strengths: { ...WRITE, ...CODE, ...COMPUTER },
  },
  { pattern: /claude[\s-]*haiku|\bhaiku\b/u, tier: "B", strengths: { writing: 1 } },
  { pattern: /gpt[\s-]*\d[\w.]*[\s-]*(?:sol|pro)\b/u, tier: "S", strengths: { reasoning: 1, ...CODE } },
  { pattern: /gpt[\s-]*\d[\w.]*[\s-]*nano\b/u, tier: "C", sized: true },
  { pattern: /gpt[\s-]*\d[\w.]*[\s-]*(?:mini|luna)\b/u, tier: "B", sized: true },
  { pattern: /gpt[\s-]*oss/u, tier: "B" },
  { pattern: /gpt[\s-]*\d|\bterra\b|codex/u, tier: "A", strengths: { ...CODE, ...COMPUTER } },
  { pattern: /gemini[\s\S]*(?:ultra|deep[\s-]*think)/u, tier: "S", strengths: { reasoning: 1 } },
  { pattern: /gemini[\s\S]*flash[\s-]*lite|gemini[\s\S]*\blite\b/u, tier: "C", sized: true },
  { pattern: /gemini[\s\S]*flash/u, tier: "B", sized: true },
  { pattern: /gemini/u, tier: "A", strengths: { "long-context": 1 } },
  { pattern: /grok[\s\S]*heavy/u, tier: "S", strengths: { reasoning: 1 } },
  { pattern: /grok[\s\S]*(?:fast|mini)/u, tier: "B", sized: true },
  { pattern: /grok/u, tier: "A" },
  {
    pattern: /deepseek[\s\S]*(?:v[4-9]|v3\.\d|r[12]|reasoner|pro)/u,
    tier: "A",
    strengths: { ...CODE, reasoning: 1, writing: -1 },
  },
  { pattern: /deepseek/u, tier: "B", strengths: CODE },
  { pattern: /qwen[\s\S]*coder/u, tier: "A", strengths: { ...CODE, writing: -1 } },
  { pattern: /qwen[\s\S]*(?:max|plus|\b3\.[5-9]|\b[4-9]\b)/u, tier: "A" },
  { pattern: /qwen|qwq/u, tier: "B" },
  { pattern: /kimi|moonshot/u, tier: "A", strengths: { ...CODE, writing: 1 } },
  { pattern: /glm[\s\S]*(?:flash|air)/u, tier: "B", strengths: WRITE, sized: true },
  { pattern: /glm/u, tier: "A", strengths: WRITE },
  { pattern: /minimax|\bm[23]\b/u, tier: "A", strengths: CODE },
  { pattern: /codestral|devstral/u, tier: "A", strengths: { ...CODE, writing: -1 } },
  { pattern: /mistral[\s\S]*(?:large|medium)|magistral/u, tier: "A" },
  { pattern: /mistral|ministral/u, tier: "B" },
  { pattern: /mercury/u, tier: "B", strengths: CODE },
  { pattern: /llama|nemotron|mimo|longcat|\bling\b|\bring\b|big[\s-]*pickle|muse|hermes|phi|gemma/u, tier: "B" },
];

/** Words that make a model of its family one step smaller. */
const SMALLER = /\b(?:flash|mini|lite|fast|small|air|nano|tiny|turbo)\b/u;
const REASONING = /\b(?:thinking|reasoner|reasoning|r1|r2|think)\b/u;
const VISION_NAME =
  /\b(?:vl|vision|omni|multimodal|4o)\b|\d(?:\.\d+)?v\b|gemini|claude|gpt[\s-]*[5-9]|grok[\s-]*[4-9]|llama[\s-]*4|kimi[\s\S]*k2\.[5-9]/u;
const NOT_A_CHAT_MODEL = /\b(?:embed|embedding|whisper|tts|dall-?e|sora|imagen|image[\s-]*gen)\b/u;

function lower(model: HxModelInfo): string {
  return `${model.id} ${model.name}`.toLowerCase();
}

function stepDown(tier: HxModelTier): HxModelTier {
  const index = HX_MODEL_TIERS.indexOf(tier);
  return HX_MODEL_TIERS[Math.max(0, index - 1)] ?? "C";
}

function contextWindow(model: HxModelInfo, text: string): number {
  let window = 128_000;
  if (/\b(?:256|262)k\b|longcat|kimi|qwen[\s\S]*(?:max|plus)/u.test(text)) window = 256_000;
  if (model.provider === "claude" || /claude/u.test(text)) window = 200_000;
  if (model.provider === "codex") window = 400_000;
  if (model.provider === "antigravity" || /gemini/u.test(text)) window = 1_000_000;
  if (/\[1m\]|\b1m\b|1,?000k/u.test(text)) window = 1_000_000;
  return window;
}

/**
 * What a model can do, as far as its provider and name tell. The names come from the providers, so
 * this is a judgement by family: a model it does not know is tier B, with no image input unless its
 * provider reads images, and a 128k window.
 */
export function hxModelProfile(model: HxModelInfo): HxModelProfile {
  const text = lower(model);
  const family = FAMILY_RULES.find((rule) => rule.pattern.test(text));
  let tier: HxModelTier = family?.tier ?? "B";
  // A family rule that names the size already counted it (gpt-5 mini, gemini flash, glm air).
  if (!family?.sized && SMALLER.test(text)) tier = stepDown(tier);
  const strengths: Partial<Record<HxWorkType, number>> = { ...(family?.strengths ?? {}) };
  if (REASONING.test(text)) strengths.reasoning = Math.max(strengths.reasoning ?? 0, 1);
  const free = model.provider === "opencode" && isFreeOpencodeModel(model.id, model.name);
  const cost: HxModelCost = free
    ? "free"
    : model.provider === "opencode"
      ? model.id.toLowerCase().startsWith("opencode-go/")
        ? "subscription"
        : "paid"
      : SUBSCRIPTION_PROVIDERS.has(model.provider)
        ? "subscription"
        : "paid";
  return {
    tier,
    vision: VISION_PROVIDERS.has(model.provider) || VISION_NAME.test(text),
    tools: !NOT_A_CHAT_MODEL.test(text),
    window: contextWindow(model, text),
    cost,
    freeGroup: free ? HX_OPENCODE_FREE_GROUP : null,
    strengths,
  };
}

/** A model's tier for one kind of work: its tier, one step up or down for what it is good or bad at. */
export function hxEffectiveTier(profile: HxModelProfile, work: HxWorkType): number {
  const base = HX_MODEL_TIERS.indexOf(profile.tier);
  const bonus = Math.max(-1, Math.min(1, profile.strengths[work] ?? 0));
  return Math.max(0, Math.min(3, base + bonus));
}

// ---------------------------------------------------------------- choosing

/** The tier that each kind of work needs at middle difficulty: 0 is C, 3 is S. */
const BASE_TIER: Readonly<Record<HxWorkType, number>> = {
  chat: 0,
  writing: 1,
  "code-small": 1,
  "code-large": 2,
  data: 1,
  vision: 1,
  "long-context": 1,
  reasoning: 2,
  computer: 1,
};

const COST_RANK: Readonly<Record<HxModelCost, number>> = { free: 0, subscription: 1, paid: 2 };

/** How much each thing weighs in a model's score: cost, a tier short of what the work needs, a tier more than it needs. */
const WEIGHTS: Readonly<Record<HxAutoPreference, { cost: number; short: number; excess: number; strength: number }>> = {
  // A free model that does the work beats any paid one; a stronger model only when no free model is strong enough.
  free: { cost: 10, short: 15, excess: 1, strength: 0.5 },
  balanced: { cost: 3, short: 10, excess: 2, strength: 0.5 },
  quality: { cost: 1, short: 10, excess: -3, strength: 1 },
};

/** The tier the work needs, after its difficulty and the user's preference. */
export function hxRequiredTier(work: HxWorkType, difficulty: HxDifficulty, preference: HxAutoPreference): number {
  const byDifficulty = difficulty === "low" ? -1 : difficulty === "high" ? 1 : 0;
  // Free first settles for the next tier down, except on hard work; quality first asks one more.
  const byPreference = preference === "free" ? (difficulty === "high" ? 0 : -1) : preference === "quality" ? 1 : 0;
  return Math.max(0, Math.min(3, BASE_TIER[work] + byDifficulty + byPreference));
}

/** Why a model was passed over. */
export const HX_SKIP_REASONS = [
  "not-ready",
  "limit",
  "free-limit",
  "excluded",
  "no-vision",
  "window",
  "no-tools",
  "other-provider",
] as const;
export type HxSkipReason = (typeof HX_SKIP_REASONS)[number];

export interface HxCandidate {
  model: HxModelInfo;
  profile: HxModelProfile;
  /** Null when the model can take the work; otherwise why it cannot. */
  unavailable: HxSkipReason | null;
}

export interface HxChooseInput {
  work: HxWorkType;
  difficulty: HxDifficulty;
  needs: readonly HxNeed[];
  /** Tokens that the work brings: the message and its attachments. */
  tokens: number;
  settings: HxAutoModelSettings;
  /** Every model the host lists, with what holds it back now. */
  candidates: readonly HxCandidate[];
  /** The model the agent runs on now, or null. */
  current: HxModelRef | null;
  /** False when moving to another provider is off, or already happened once in this piece of work. */
  mayChangeProvider: boolean;
  /** True when this message starts new work: it sets the provider free to change for cost too. */
  newWork: boolean;
}

export interface HxChoice {
  model: HxModelInfo;
  profile: HxModelProfile;
  /** True when the agent stays on its current model. */
  kept: boolean;
  /** `table`: the user's order for this kind of work. `ranking`: the score. `fallback`: no model fit; the current one stays. */
  by: "table" | "ranking" | "fallback";
  required: number;
  /** The models passed over, best first, at most five. */
  skipped: Array<{ model: HxModelInfo; reason: HxSkipReason }>;
}

export function hxRefOf(model: HxModelInfo): HxModelRef {
  return {
    provider: model.provider,
    model: model.id,
    ...(model.providerAccountId === undefined ? {} : { providerAccountId: model.providerAccountId }),
  };
}

/** What a model lacks for this work, or null. */
function lacking(candidate: HxCandidate, input: HxChooseInput): HxSkipReason | null {
  if (candidate.unavailable) return candidate.unavailable;
  if (input.settings.excluded.some((ref) => hxSameModel(ref, hxRefOf(candidate.model)))) return "excluded";
  if (!candidate.profile.tools) return "no-tools";
  if (input.needs.includes("vision") && !candidate.profile.vision) return "no-vision";
  if (input.needs.includes("long-context") && candidate.profile.window * 0.7 < input.tokens) return "window";
  return null;
}

function score(candidate: HxCandidate, input: HxChooseInput, required: number): number {
  const weights = WEIGHTS[input.settings.preference];
  const tier = hxEffectiveTier(candidate.profile, input.work);
  const short = Math.max(0, required - tier);
  const excess = Math.max(0, tier - required);
  const current = input.current && hxSameModel(input.current, hxRefOf(candidate.model));
  const sameProvider = input.current?.provider === candidate.model.provider;
  return (
    -COST_RANK[candidate.profile.cost] * weights.cost -
    short * weights.short -
    excess * weights.excess +
    (candidate.profile.strengths[input.work] ?? 0) * weights.strength +
    // Staying where the agent is costs nothing: no new session, no handoff.
    (current ? 0.6 : 0) +
    (sameProvider ? 0.3 : 0)
  );
}

/**
 * The model for one piece of work, or null when no model can take it. The rules, in order:
 * 1. the user's own order for this kind of work, when one of its models can take it (on hard work,
 *    the strongest of them);
 * 2. otherwise the best score (cost, tier, strengths, by the preference);
 * 3. the current model stays when it scores within 2 points of the best: no change for a small gain;
 * 4. another provider only when allowed, and then only when the current provider has no model that
 *    can take the work, has none strong enough, or this is new work.
 */
export function hxChooseModel(input: HxChooseInput): HxChoice | null {
  const required = hxRequiredTier(input.work, input.difficulty, input.settings.preference);
  const skipped: HxChoice["skipped"] = [];
  const skip = (candidate: HxCandidate, reason: HxSkipReason) => {
    if (skipped.length < 5 && !skipped.some((entry) => sameInfo(entry.model, candidate.model)))
      skipped.push({ model: candidate.model, reason });
  };
  const usable = input.candidates.filter((candidate) => {
    const reason = lacking(candidate, input);
    return reason === null;
  });
  const currentProvider = input.current?.provider ?? null;
  const sameProvider = usable.filter((candidate) => candidate.model.provider === currentProvider);
  const ranked = (list: readonly HxCandidate[]) =>
    [...list].sort((left, right) => score(right, input, required) - score(left, input, required));
  const strongEnough = (candidate: HxCandidate) => hxEffectiveTier(candidate.profile, input.work) >= required;
  // Which providers may take the work.
  let pool: HxCandidate[] = usable;
  if (currentProvider !== null && sameProvider.length > 0) {
    const bestHere = ranked(sameProvider)[0];
    const bestAnywhere = ranked(usable)[0];
    const leaveForStrength =
      bestHere !== undefined && bestAnywhere !== undefined && !strongEnough(bestHere) && strongEnough(bestAnywhere);
    const leaveForCost =
      input.newWork &&
      bestHere !== undefined &&
      bestAnywhere !== undefined &&
      COST_RANK[bestAnywhere.profile.cost] < COST_RANK[bestHere.profile.cost] &&
      strongEnough(bestAnywhere);
    if (!input.mayChangeProvider || !(leaveForStrength || leaveForCost)) pool = sameProvider;
  } else if (currentProvider !== null && !input.mayChangeProvider) {
    pool = [];
  }
  for (const candidate of input.candidates) {
    const reason = lacking(candidate, input);
    if (reason) skip(candidate, reason);
    else if (!pool.includes(candidate)) skip(candidate, "other-provider");
  }
  if (pool.length === 0) return null;
  const finish = (candidate: HxCandidate, by: HxChoice["by"]): HxChoice => ({
    model: candidate.model,
    profile: candidate.profile,
    kept: input.current !== null && hxSameModel(input.current, hxRefOf(candidate.model)),
    by,
    required,
    skipped: skipped.filter((entry) => !sameInfo(entry.model, candidate.model)),
  });
  // 1. The user's order.
  const order = input.settings.table[input.work] ?? [];
  const listed = order.flatMap((ref) => {
    const found = pool.find((candidate) => hxSameModel(ref, hxRefOf(candidate.model)));
    return found ? [found] : [];
  });
  for (const ref of order) {
    const known = input.candidates.find((candidate) => hxSameModel(ref, hxRefOf(candidate.model)));
    if (known && !listed.includes(known)) skip(known, lacking(known, input) ?? "other-provider");
  }
  if (listed.length > 0) {
    const pick =
      input.difficulty === "high"
        ? [...listed].sort(
            (left, right) => hxEffectiveTier(right.profile, input.work) - hxEffectiveTier(left.profile, input.work),
          )[0]
        : listed[0];
    if (pick) return finish(pick, "table");
  }
  // 2. The ranking, and 3. the current model when it is close.
  const order2 = ranked(pool);
  const best = order2[0];
  if (!best) return null;
  const current = input.current
    ? pool.find((candidate) => input.current !== null && hxSameModel(input.current, hxRefOf(candidate.model)))
    : undefined;
  if (current && current !== best && score(current, input, required) >= score(best, input, required) - 2)
    return finish(current, "ranking");
  return finish(best, "ranking");
}

function sameInfo(left: HxModelInfo, right: HxModelInfo): boolean {
  return hxSameModel(hxRefOf(left), hxRefOf(right));
}

/** The model the user would be offered when a turn went badly: a stronger one for the same work, or null. */
export function hxStrongerModel(
  input: Omit<HxChooseInput, "difficulty" | "newWork" | "mayChangeProvider">,
  than: HxModelInfo,
  mayChangeProvider: boolean,
): HxChoice | null {
  const own = input.candidates.find((candidate) => sameInfo(candidate.model, than));
  const ownTier = own ? hxEffectiveTier(own.profile, input.work) : HX_MODEL_TIERS.indexOf("B");
  const stronger = input.candidates.filter(
    (candidate) =>
      hxEffectiveTier(candidate.profile, input.work) > ownTier &&
      (mayChangeProvider || candidate.model.provider === than.provider),
  );
  if (stronger.length === 0) return null;
  return hxChooseModel({
    ...input,
    difficulty: "high",
    newWork: true,
    mayChangeProvider,
    candidates: stronger,
    current: null,
  });
}

/** The reasoning effort of an auto turn on `model`, from the difficulty or the user's fixed choice. */
export function hxAutoEffort(
  model: HxModelInfo,
  difficulty: HxDifficulty,
  setting: HxAutoEffort,
): AgentReasoningEffort | null {
  const supported = model.supportedReasoningEfforts ?? [];
  if (supported.length === 0) return model.defaultReasoningEffort ?? null;
  const wanted: AgentReasoningEffort =
    setting !== "auto" ? setting : difficulty === "low" ? "low" : difficulty === "high" ? "high" : "medium";
  if (supported.includes(wanted)) return wanted;
  // The nearest effort the model has, in the direction of the wish.
  const ladder: AgentReasoningEffort[] = ["low", "medium", "high", "xhigh"];
  const at = ladder.indexOf(wanted);
  for (let step = 1; step < ladder.length; step++) {
    for (const index of wanted === "low" ? [at + step, at - step] : [at - step, at + step]) {
      const effort = ladder[index];
      if (effort && supported.includes(effort)) return effort;
    }
  }
  return model.defaultReasoningEffort ?? supported[0] ?? null;
}

// ---------------------------------------------------------------- what the chat and the settings show

/**
 * How a decision was made. `follow-up`: the message goes on with the last work. `manual`: the message
 * named a model. `redo`: the user answered a suggestion with "redo". `busy`: another turn of the agent
 * ran, so the model could not change. `fallback`: no model fit, so the current one stays.
 */
export const HX_DECISION_SOURCES = ["rules", "judge", "follow-up", "manual", "redo", "busy", "fallback"] as const;
export type HxDecisionSource = (typeof HX_DECISION_SOURCES)[number];

export type HxNamedModel = HxModelRef & { name: string };

/** One decision, as the host keeps it for the settings screen: the latest ones, at most 30 days. */
export interface HxRoutingDecision {
  agentId: string;
  /** The delivery that the work starts with. */
  deliveryId: string;
  taskId: string | null;
  /** Epoch milliseconds. */
  at: number;
  work: HxWorkType;
  difficulty: HxDifficulty;
  needs: HxNeed[];
  by: HxDecisionSource;
  /** 0 to 1: how sure the rules or the judge were. */
  confidence: number;
  chosen: HxNamedModel;
  /** The model before, when it changed. */
  previous: HxNamedModel | null;
  kept: boolean;
  /** What the rules saw, such as `image` or `words:翻译`. Shown as they are. */
  signals: string[];
  /** The models passed over, best first, at most five. */
  skipped: Array<HxNamedModel & { reason: HxSkipReason }>;
  effort: AgentReasoningEffort | null;
  /** Milliseconds the decision took. */
  ms: number;
}

export interface HxAutoModelEntry {
  ref: HxModelRef;
  name: string;
  tier: HxModelTier;
  cost: HxModelCost;
  vision: boolean;
  /** Signed in, listed, and not held by a usage limit. */
  ready: boolean;
  excluded: boolean;
}

/** What the settings screen reads for one agent. */
export interface HxAutoModelView {
  agentId: string;
  settings: HxAutoModelSettings;
  models: HxAutoModelEntry[];
  /** What each kind of work would get now, at middle difficulty. */
  preview: Partial<Record<HxWorkType, HxNamedModel>>;
  /** OpenCode's free models: blocked until (epoch ms) after their daily limit, or null; and today's count on this computer. */
  freeQuota: { blockedUntil: number | null; usedToday: number };
  /** The latest decisions, newest first, at most 20. */
  decisions: HxRoutingDecision[];
  /**
   * v1.7.1 (TEAM-01, CONC-01): how many turns this computer runs at the same time now (B), for the
   * one read-only line about teams. Absent from a main process before v1.7.1.
   */
  parallel?: number;
}

export interface HxAutoModelUpdate {
  agentId: string;
  settings: HxAutoModelSettings;
}

export function parseHxAutoModelUpdate(value: unknown): HxAutoModelUpdate | null {
  if (!isDynamicRecord(value) || typeof value.agentId !== "string" || value.agentId.length === 0) return null;
  if (value.agentId.length > 200) return null;
  const settings = parseHxAutoModelSettings(value.settings);
  return settings ? { agentId: value.agentId, settings } : null;
}

/** The update as main receives it from the screen; it throws on anything else. */
export function decodeHxAutoModelUpdate(value: unknown): HxAutoModelUpdate {
  const update = parseHxAutoModelUpdate(value);
  if (!update) throw new Error("Invalid auto model settings.");
  return update;
}

function isNamedModel(value: unknown): value is HxNamedModel {
  return isHxModelRef(value) && isDynamicRecord(value) && typeof value.name === "string";
}

function isDecision(value: unknown): value is HxRoutingDecision {
  return (
    isDynamicRecord(value) &&
    typeof value.agentId === "string" &&
    typeof value.deliveryId === "string" &&
    (value.taskId === null || typeof value.taskId === "string") &&
    typeof value.at === "number" &&
    isHxWorkType(value.work) &&
    isOneOf(HX_DIFFICULTIES, value.difficulty) &&
    Array.isArray(value.needs) &&
    value.needs.every((need) => isOneOf(HX_NEEDS, need)) &&
    isOneOf(HX_DECISION_SOURCES, value.by) &&
    typeof value.confidence === "number" &&
    isNamedModel(value.chosen) &&
    (value.previous === null || isNamedModel(value.previous)) &&
    isBoolean(value.kept) &&
    Array.isArray(value.signals) &&
    value.signals.every((signal) => typeof signal === "string") &&
    Array.isArray(value.skipped) &&
    value.skipped.every(
      (entry) => isNamedModel(entry) && isDynamicRecord(entry) && isOneOf(HX_SKIP_REASONS, entry.reason),
    ) &&
    (value.effort === null || typeof value.effort === "string") &&
    typeof value.ms === "number"
  );
}

export function parseHxRoutingDecision(value: unknown): HxRoutingDecision | null {
  return isDecision(value) ? value : null;
}

function isEntry(value: unknown): value is HxAutoModelEntry {
  return (
    isDynamicRecord(value) &&
    isHxModelRef(value.ref) &&
    typeof value.name === "string" &&
    isOneOf(HX_MODEL_TIERS, value.tier) &&
    isOneOf(HX_MODEL_COSTS, value.cost) &&
    isBoolean(value.vision) &&
    isBoolean(value.ready) &&
    isBoolean(value.excluded)
  );
}

/** The view as the main process sends it; it throws on anything else. */
export function decodeHxAutoModelView(value: unknown): HxAutoModelView {
  if (!isDynamicRecord(value) || typeof value.agentId !== "string") throw new Error("Invalid auto model view.");
  const settings = parseHxAutoModelSettings(value.settings);
  const quota = value.freeQuota;
  if (
    !settings ||
    !Array.isArray(value.models) ||
    !value.models.every(isEntry) ||
    !isDynamicRecord(value.preview) ||
    !Object.entries(value.preview).every(([key, model]) => isHxWorkType(key) && isNamedModel(model)) ||
    !isDynamicRecord(quota) ||
    !(quota.blockedUntil === null || typeof quota.blockedUntil === "number") ||
    typeof quota.usedToday !== "number" ||
    !Array.isArray(value.decisions) ||
    !value.decisions.every(isDecision) ||
    !(
      value.parallel === undefined ||
      (typeof value.parallel === "number" &&
        Number.isSafeInteger(value.parallel) &&
        value.parallel >= 1 &&
        value.parallel <= 64)
    )
  )
    throw new Error("Invalid auto model view.");
  return {
    agentId: value.agentId,
    settings,
    models: value.models,
    preview: value.preview,
    freeQuota: { blockedUntil: quota.blockedUntil, usedToday: quota.usedToday },
    decisions: value.decisions,
    ...(typeof value.parallel === "number" ? { parallel: value.parallel } : {}),
  };
}
