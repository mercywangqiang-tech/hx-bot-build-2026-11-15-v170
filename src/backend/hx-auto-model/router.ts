// HXBot 自动选择模型：每件新工作开始之前选模型。
//
// The agent service calls `due` on each path that starts a queue; when it is true, `follow` decides
// the model for the next queued work and moves the agent to it before the turn starts, the same way
// a queued change of model applies before the next turn. The rest of the agent service does not
// change: a turn runs on the agent's model, and a move to another provider hands the chat over as
// any change of provider does.
import {
  HX_OPENCODE_FREE_GROUP,
  HX_WORK_TYPES,
  type HxAutoModelEntry,
  type HxAutoModelView,
  type HxCandidate,
  type HxChoice,
  type HxDecisionSource,
  type HxDifficulty,
  type HxModelInfo,
  type HxModelRef,
  type HxNamedModel,
  type HxNeed,
  type HxRoutingDecision,
  type HxSkipReason,
  type HxWorkType,
  hxAutoEffort,
  hxChooseModel,
  hxModelProfile,
  hxRefOf,
  hxSameModel,
  hxStrongerModel,
} from "@hxbot/contracts/hx-auto-model";
import type { AgentModelOption, AgentProviderId, AgentReasoningEffort } from "@hxbot/contracts/ipc";
import { sourceText } from "@hxbot/i18n";
import { createHxBotLogger } from "@hxbot/logging";
import { hxFlow } from "../hx-flow/ledger";
import { HX_OVERLOAD_TARGETS, hxOverload } from "../hx-flow/overload";
import { hxProviderGate } from "../hx-flow/provider-gate";
import { hxProviderModelOf } from "../hx-flow/provider-model";
import { HX_JUDGE_BELOW, type HxAttachmentInfo, hxClassifyWork } from "./classify";
import { HX_JUDGE_TIMEOUT_MS, hxJudgeModel, hxJudgePrompt, hxParseJudge, hxWithin } from "./judge";
import { type HxOverloadWhy, hxOverloadChoice } from "./overload-move";
import { type HxAutoModelStore, hxAutoModelStore } from "./store";

const logger = createHxBotLogger("hx-auto-model");

/** A reply that says the agent could not do the work. Only its last 600 characters are read. */
const GAVE_UP =
  /无法完成|做不到|做不了|无能为力|超出了?我的能力|需要更强的模型|没办法完成|我不能完成|\b(?:i can(?:no|')t (?:do|complete|finish|solve)|i(?:'m| am) (?:not able|unable) to (?:do|complete|finish|solve)|beyond my (?:capabilities|ability)|need a (?:stronger|more capable) model|i (?:could not|couldn't) (?:complete|finish|solve))\b/iu;

/** How long a judge call waits for a place under its model's limit before the rules decide. */
const HX_JUDGE_PLACE_MS = 1_000;

/** One move to another provider in this time, for the same chat; more only when the work needs it. */
const CROSS_PROVIDER_MS = 10 * 60_000;

export interface HxAutoAgent {
  id: string;
  name: string;
  provider: AgentProviderId;
  model: string;
  providerAccountId: string | null;
  reasoningEffort: AgentReasoningEffort;
}

/** The next queued work of an agent, as the queue holds it. */
export interface HxQueuedWork {
  deliveryId: string;
  /** Null for the agent's own chat. */
  taskId: string | null;
  text: string;
  attachments: HxAttachmentInfo[];
  /** `routine` work that names its model keeps it; the rest is classified. */
  sender: "user" | "agent" | "routine" | "other";
}

export interface HxAutoHost {
  agent(agentId: string): HxAutoAgent | null;
  /** Every model the agent can be moved to, on the agent's account for its own provider. */
  models(agentId: string): ReadonlyArray<AgentModelOption & { providerAccountId?: string | undefined }>;
  /** Signed in, listed, and no usage limit or provider error holds it. */
  ready(choice: HxModelRef): boolean;
  /** A usage limit holds it. */
  limited(choice: HxModelRef): boolean;
  /** The agent runs a turn, has started work, or waits for a usage limit: its model cannot change now. */
  busy(agentId: string): boolean;
  nextWork(agentId: string): HxQueuedWork | null;
  historyTokens(agentId: string, taskId: string | null): number;
  /**
   * HXBot (v1.7.0): the chat or task of the work goes on in a provider session that holds its
   * history. Another model or effort there starts a new session: the provider's context and cache go.
   */
  continuing?(agentId: string, taskId: string | null): boolean;
  move(agentId: string, choice: HxModelRef & { reasoningEffort: AgentReasoningEffort }): Promise<void>;
  /** A line in the chat of the work, outside any turn. */
  note(agentId: string, taskId: string | null, text: string): void;
  /** One answer of `model` to `prompt`, with no tools; `signal` stops it. */
  judge(
    agentId: string,
    model: AgentModelOption & { providerAccountId?: string | undefined },
    prompt: string,
    signal: AbortSignal,
  ): Promise<string>;
  /** The task of a thread of the agent, or null for its own chat. */
  taskOfThread(agentId: string, threadId: string): string | null;
  /** The text of the last reply of a turn, or null. */
  lastReply(agentId: string, threadId: string, turnId: string): string | null;
  scheduleDrain(agentId: string): void;
}

/** The keys of the line in the chat, by kind of work: the model changed, or it stayed. */
const LINE_KEYS = {
  chat: ["status.agent.hxAuto.switched.chat", "status.agent.hxAuto.kept.chat"],
  writing: ["status.agent.hxAuto.switched.writing", "status.agent.hxAuto.kept.writing"],
  "code-small": ["status.agent.hxAuto.switched.codeSmall", "status.agent.hxAuto.kept.codeSmall"],
  "code-large": ["status.agent.hxAuto.switched.codeLarge", "status.agent.hxAuto.kept.codeLarge"],
  data: ["status.agent.hxAuto.switched.data", "status.agent.hxAuto.kept.data"],
  vision: ["status.agent.hxAuto.switched.vision", "status.agent.hxAuto.kept.vision"],
  "long-context": ["status.agent.hxAuto.switched.longContext", "status.agent.hxAuto.kept.longContext"],
  reasoning: ["status.agent.hxAuto.switched.reasoning", "status.agent.hxAuto.kept.reasoning"],
  computer: ["status.agent.hxAuto.switched.computer", "status.agent.hxAuto.kept.computer"],
} as const satisfies Record<HxWorkType, readonly [string, string]>;

/** The line in the chat: the kind of work and the model, in the English that each screen translates. */
/** HXBot (v1.7.4, CONC-08): the line of a move for the provider's overload: which model, and why. */
export function hxOverloadLine(from: string, to: string, why: HxOverloadWhy): string {
  return why === "paused"
    ? sourceText("status.agent.hxAutoModel.overloadPaused", { from, to })
    : sourceText("status.agent.hxAutoModel.overloadQueue", { from, to });
}

export function hxAutoLine(work: HxWorkType, model: string, changed: boolean): string {
  const [switched, kept] = LINE_KEYS[work];
  return sourceText(changed ? switched : kept, { model });
}

/** "改用 Claude Opus 5.5 重答", "use gpt-5 for this": the model a message names, as the user wrote it. */
const NAMES_A_MODEL =
  /(?:改用|换用|换成|切换到|切到|使用|用)\s*([A-Za-z][\w .:/+-]{1,40}?)\s*(?:模型)?\s*(?:来|重答|重新回答|回答|重做|做|写|看|吧|。|，|,|$)|\b(?:use|switch to|using|with)\s+([A-Za-z][\w .:/+-]{1,40}?)(?:\s+(?:model|to|for|and|instead)\b|[.,!?]|$)/iu;

function normal(text: string): string {
  return text.toLowerCase().replace(/[\s_\-.:/]+/gu, "");
}

/** The ready model whose name or id the message names, or null. Three letters at least, and one model only. */
export function hxNamedModel(text: string, candidates: readonly HxCandidate[]): HxCandidate | null {
  const match = NAMES_A_MODEL.exec(text);
  const said = normal(match?.[1] ?? match?.[2] ?? "");
  if (said.length < 3) return null;
  const hits = candidates.filter((candidate) => {
    const name = normal(candidate.model.name);
    const id = normal(candidate.model.id.split("/").pop() ?? candidate.model.id);
    return name === said || id === said || name.includes(said) || id.includes(said);
  });
  if (hits.length === 0) return null;
  // "opus" names one model; "claude" names many: the exact or the shortest name wins, if it is one.
  const exact = hits.filter(
    (candidate) => normal(candidate.model.name) === said || normal(candidate.model.id) === said,
  );
  if (exact.length === 1) return exact[0] ?? null;
  const usable = hits.filter((candidate) => candidate.unavailable === null);
  return usable.length === 1 ? (usable[0] ?? null) : null;
}

/** A failed turn, or a reply that gives up, of an auto agent: what to offer, kept until the next work. */
interface Suggestion {
  model: HxModelRef & { name: string };
  work: HxWorkType;
  taskId: string | null;
}

export class HxAutoRouter {
  #host: HxAutoHost | null = null;
  readonly #store: HxAutoModelStore;
  readonly #following = new Set<string>();
  readonly #crossMoves = new Map<string, number>();
  readonly #suggestions = new Map<string, Suggestion>();
  readonly #suggested = new Set<string>();

  constructor(store: HxAutoModelStore = hxAutoModelStore) {
    this.#store = store;
  }

  setHost(host: HxAutoHost): void {
    this.#host = host;
  }

  get store(): HxAutoModelStore {
    return this.#store;
  }

  /** Whether the next work of this agent waits for a decision: the agent is on auto, idle, and the work is new. */
  due(agentId: string): boolean {
    const host = this.#host;
    if (!host || this.#following.has(agentId) || !this.#store.enabled(agentId)) return false;
    if (host.busy(agentId)) return false;
    const work = host.nextWork(agentId);
    return work !== null && !this.#store.decided(work.deliveryId);
  }

  /** Decides the model of the next work and moves the agent to it. Then the drain runs again. */
  follow(agentId: string, now = Date.now()): Promise<void> {
    if (this.#following.has(agentId)) return Promise.resolve();
    this.#following.add(agentId);
    return this.#decide(agentId, now)
      .catch((error: unknown) =>
        logger.warn("HXBot could not choose a model; the agent keeps its model.", { error: String(error) }),
      )
      .finally(() => {
        this.#following.delete(agentId);
        this.#host?.scheduleDrain(agentId);
      });
  }

  /**
   * HXBot (v1.7.4, CONC-08): a team member that takes a new piece of work while the provider of its
   * model has been paused more than 2 minutes moves to a model that ranks the same or better. Returns
   * the names for the team's line, or null when it stays.
   */
  async moveForOverload(agentId: string, now = Date.now()): Promise<{ from: string; to: string } | null> {
    const host = this.#host;
    const agent = host?.agent(agentId);
    if (!host || !agent || this.#following.has(agentId) || host.busy(agentId)) return null;
    const candidates = this.#candidates(agentId, now);
    const current = refOfAgent(agent);
    const currentModel = candidates.find((candidate) => hxSameModel(hxRefOf(candidate.model), current))?.model ?? {
      provider: agent.provider,
      id: agent.model,
      name: agent.model,
    };
    const moved = hxOverloadChoice({
      current: currentModel,
      candidates,
      settings: this.#store.settings(agentId),
      targetMs: HX_OVERLOAD_TARGETS[2],
      turnMs: hxFlow.turnMs(),
      member: true,
      canTake: () => true,
      now,
    });
    if (!moved) return null;
    this.#following.add(agentId);
    try {
      await host.move(agentId, { ...hxRefOf(moved.candidate.model), reasoningEffort: agent.reasoningEffort });
      return { from: currentModel.name, to: moved.candidate.model.name };
    } catch (error) {
      logger.warn("HXBot could not move a team member off a paused provider.", { error: String(error) });
      return null;
    } finally {
      this.#following.delete(agentId);
    }
  }

  /** HXBot (v1.7.4, CONC-11): whether this agent's setting lets a model help the rules ("rules + model"). */
  judgeOn(agentId: string): boolean {
    return this.#store.settings(agentId).judge === "rules+model";
  }

  /**
   * HXBot (v1.7.4, CONC-11): the judge of a team: a ready model of the lead's provider that is not of
   * the weakest rank (another provider only when the lead may move across providers), in a new clean
   * context, as tier 1 under the provider limit. Null when no model fits, the model has no place, or
   * no answer came in `timeoutMs`.
   */
  async teamJudge(leadAgentId: string, prompt: string, timeoutMs: number): Promise<string | null> {
    const host = this.#host;
    const agent = host?.agent(leadAgentId);
    if (!host || !agent) return null;
    const settings = this.#store.settings(leadAgentId);
    const candidates = this.#candidates(leadAgentId).filter(
      (candidate) => settings.crossProvider || candidate.model.provider === agent.provider,
    );
    const pick = hxJudgeModel(
      candidates.map((candidate) => ({
        ref: hxRefOf(candidate.model),
        name: candidate.model.name,
        tier: candidate.profile.tier,
        cost: candidate.profile.cost,
        vision: candidate.profile.vision,
        ready: candidate.unavailable === null,
        excluded: settings.excluded.some((ref) => hxSameModel(ref, hxRefOf(candidate.model))),
      })),
    );
    if (!pick) return null;
    const option = host
      .models(leadAgentId)
      .find((model) => hxSameModel(hxRefOf({ ...model, providerAccountId: model.providerAccountId }), pick.ref));
    if (!option) return null;
    const gateModel = hxProviderModelOf({
      provider: option.provider,
      model: option.id,
      providerAccountId: option.providerAccountId,
    });
    const release = gateModel ? await hxProviderGate.acquire(gateModel, 1, HX_JUDGE_PLACE_MS) : () => {};
    if (!release) return null;
    const stop = new AbortController();
    try {
      const answer = await hxWithin(host.judge(leadAgentId, option, prompt, stop.signal), timeoutMs);
      if (answer === null) stop.abort();
      return answer;
    } finally {
      release();
    }
  }

  /** A model change that the user or another agent made: the agent is no longer on auto. */
  manualChange(agentId: string): void {
    const settings = this.#store.settings(agentId);
    if (settings.enabled) this.#store.setSettings(agentId, { ...settings, enabled: false });
  }

  /**
   * The model a usage limit moves an auto agent to, when the agent has no backup models of its own:
   * the best ready model for its last kind of work, other than the one that is held. Null otherwise.
   */
  backup(agentId: string): HxModelRef | null {
    const host = this.#host;
    const agent = host?.agent(agentId);
    if (!host || !agent || !this.#store.enabled(agentId)) return null;
    const settings = this.#store.settings(agentId);
    const last = this.#store.last(agentId, null);
    const current = refOfAgent(agent);
    const candidates = this.#candidates(agentId).filter((candidate) => !hxSameModel(hxRefOf(candidate.model), current));
    const choice = hxChooseModel({
      work: last?.work ?? "chat",
      difficulty: last?.difficulty ?? "mid",
      needs: last?.needs ?? [],
      tokens: 0,
      settings,
      candidates,
      current: null,
      mayChangeProvider: settings.crossProvider,
      newWork: true,
    });
    return choice ? hxRefOf(choice.model) : null;
  }

  /**
   * The end of a turn. A turn of an auto agent that failed, or whose reply says that it could not do
   * the work, gets a line that offers a stronger model, once per piece of work. A turn stopped by a
   * usage limit does not come here.
   */
  turnEnded(agentId: string, threadId: string, turnId: string, status: string): void {
    const host = this.#host;
    if (!host || !this.#store.enabled(agentId)) return;
    if (status === "failed") {
      this.#offerStronger(agentId, host.taskOfThread(agentId, threadId));
      return;
    }
    if (status !== "completed") return;
    const reply = host.lastReply(agentId, threadId, turnId);
    if (reply !== null && GAVE_UP.test(reply.slice(-600)))
      this.#offerStronger(agentId, host.taskOfThread(agentId, threadId));
  }

  #offerStronger(agentId: string, taskId: string | null): void {
    const host = this.#host;
    const agent = host?.agent(agentId);
    if (!host || !agent) return;
    const settings = this.#store.settings(agentId);
    if (!settings.enabled || !settings.suggestStronger) return;
    const last = this.#store.last(agentId, taskId);
    if (!last || this.#suggested.has(last.deliveryId)) return;
    const candidates = this.#candidates(agentId);
    const own = candidates.find((candidate) => hxSameModel(hxRefOf(candidate.model), refOfAgent(agent)));
    const stronger = hxStrongerModel(
      {
        work: last.work,
        needs: last.needs,
        tokens: 0,
        settings,
        candidates: candidates.filter((candidate) => candidate.unavailable === null),
        current: null,
      },
      own?.model ?? { provider: agent.provider, id: agent.model, name: agent.model },
      settings.crossProvider,
    );
    if (!stronger) return;
    this.#suggested.add(last.deliveryId);
    const model = { ...hxRefOf(stronger.model), name: stronger.model.name };
    this.#suggestions.set(agentId, { model, work: last.work, taskId });
    host.note(agentId, taskId, sourceText("status.agent.hxAuto.suggest", { model: model.name }));
  }

  /** What the settings screen shows for one agent. */
  view(agentId: string, now = Date.now()): HxAutoModelView {
    const settings = this.#store.settings(agentId);
    const candidates = this.#candidates(agentId, now);
    const models: HxAutoModelEntry[] = candidates.map((candidate) => ({
      ref: hxRefOf(candidate.model),
      name: candidate.model.name,
      tier: candidate.profile.tier,
      cost: candidate.profile.cost,
      vision: candidate.profile.vision,
      ready: candidate.unavailable === null,
      excluded: settings.excluded.some((ref) => hxSameModel(ref, hxRefOf(candidate.model))),
    }));
    const preview: HxAutoModelView["preview"] = {};
    for (const work of HX_WORK_TYPES) {
      const choice = hxChooseModel({
        work,
        difficulty: "mid",
        needs: work === "vision" ? ["vision"] : [],
        tokens: 0,
        settings,
        candidates,
        current: null,
        mayChangeProvider: true,
        newWork: true,
      });
      if (choice) preview[work] = { ...hxRefOf(choice.model), name: choice.model.name };
    }
    // v1.7.1: the turns this computer runs at the same time now, for the line about teams.
    const parallel = hxFlow.capacity().budget;
    return {
      agentId,
      settings,
      models,
      preview,
      freeQuota: { blockedUntil: this.#store.freeBlockedUntil(now), usedToday: this.#store.freeUsedToday(now) },
      decisions: this.#store.decisions(agentId, 20),
      ...(parallel === null ? {} : { parallel }),
    };
  }

  /**
   * The model for a role of a proposal card. Planning and the final check are hard work of their
   * kind; the user sees the model on the card before anything starts.
   */
  roleModel(
    agentId: string,
    role: { kind: "plan" | "do" | "check"; work: HxWorkType; difficulty: HxDifficulty; needs: readonly HxNeed[] },
  ): (HxNamedModel & { cost: HxAutoModelEntry["cost"] }) | null {
    const own = this.#store.settings(agentId);
    // Planning and the final check ask for quality first: a stronger model, free when one is strong enough.
    const settings = role.kind === "do" ? own : { ...own, preference: "quality" as const };
    const candidates = this.#candidates(agentId);
    const choice = hxChooseModel({
      work: role.kind === "plan" ? "reasoning" : role.work,
      difficulty: role.kind === "do" ? role.difficulty : "high",
      needs: role.needs,
      tokens: 0,
      settings,
      candidates,
      current: null,
      mayChangeProvider: true,
      newWork: true,
    });
    return choice ? { ...hxRefOf(choice.model), name: choice.model.name, cost: choice.profile.cost } : null;
  }

  /** The models of the agent with what holds each back now. */
  #candidates(agentId: string, now = Date.now()): HxCandidate[] {
    const host = this.#host;
    if (!host) return [];
    const freeBlocked = this.#store.freeBlockedUntil(now) !== null;
    const listed = host.models(agentId);
    const candidates = listed.map((option): HxCandidate => {
      const model: HxModelInfo = {
        provider: option.provider,
        id: option.id,
        name: option.name,
        ...(option.providerAccountId === undefined ? {} : { providerAccountId: option.providerAccountId }),
        supportedReasoningEfforts: option.supportedReasoningEfforts,
        defaultReasoningEffort: option.defaultReasoningEffort,
      };
      const profile = hxModelProfile(model);
      const ref = hxRefOf(model);
      const unavailable: HxSkipReason | null =
        profile.freeGroup === HX_OPENCODE_FREE_GROUP && freeBlocked
          ? "free-limit"
          : host.limited(ref)
            ? "limit"
            : host.ready(ref)
              ? null
              : "not-ready";
      return { model, profile, unavailable };
    });
    // One free OpenCode model at its daily limit holds all of them: they share the limit.
    if (
      candidates.some(
        (candidate) => candidate.profile.freeGroup === HX_OPENCODE_FREE_GROUP && candidate.unavailable === "limit",
      )
    )
      for (const candidate of candidates)
        if (candidate.profile.freeGroup === HX_OPENCODE_FREE_GROUP) candidate.unavailable = "free-limit";
    return candidates;
  }

  async #decide(agentId: string, now: number): Promise<void> {
    const host = this.#host;
    const agent = host?.agent(agentId);
    const work = host?.nextWork(agentId);
    if (!host || !agent || !work || this.#store.decided(work.deliveryId) || host.busy(agentId)) return;
    const started = Date.now();
    const settings = this.#store.settings(agentId);
    const candidates = this.#candidates(agentId, now);
    const current = refOfAgent(agent);
    const currentCandidate = candidates.find((candidate) => hxSameModel(hxRefOf(candidate.model), current));
    const currentProfile =
      currentCandidate?.profile ?? hxModelProfile({ provider: agent.provider, id: agent.model, name: agent.model });
    const previous = this.#store.last(agentId, work.taskId);
    const classification = hxClassifyWork({
      text: work.text,
      attachments: work.attachments,
      historyTokens: host.historyTokens(agentId, work.taskId),
      window: currentProfile.window,
      previous: previous ? { work: previous.work, difficulty: previous.difficulty, at: previous.at } : null,
      now,
    });
    let { work: kind, difficulty, needs, confidence } = classification;
    const signals = [...classification.signals];
    let by: HxDecisionSource = "rules";
    let choice: HxChoice | null = null;
    const suggestion = this.#suggestions.get(agentId);
    this.#suggestions.delete(agentId);

    const named = hxNamedModel(work.text, candidates);
    if (named && named.unavailable === null) {
      by = "manual";
      choice = asChoice(named, current);
    } else if (classification.redo) {
      by = "redo";
      const offered =
        suggestion && suggestion.taskId === work.taskId
          ? candidates.find((candidate) => hxSameModel(hxRefOf(candidate.model), suggestion.model))
          : undefined;
      if (offered && offered.unavailable === null) choice = asChoice(offered, current);
      else
        choice = hxStrongerModel(
          { work: kind, needs, tokens: classification.tokens, settings, candidates: usable(candidates), current: null },
          currentCandidate?.model ?? { provider: agent.provider, id: agent.model, name: agent.model },
          settings.crossProvider,
        );
    } else if (classification.followUp && previous) {
      by = "follow-up";
    } else if (
      host.continuing?.(agentId, work.taskId) === true &&
      currentCandidate?.unavailable === null &&
      hxCanTake(currentCandidate, needs, classification.tokens)
    ) {
      // HXBot (v1.7.0): work in a chat that goes on keeps the model and effort it has, so the session,
      // its context and its cache stay. A new chat or task, a named model, a redo, or work that the
      // model cannot take (a picture, long material) chooses again.
      by = "follow-up";
      signals.push("continuing");
    } else {
      if (confidence < HX_JUDGE_BELOW && settings.judge === "rules+model") {
        const judged = await this.#judge(agentId, work, candidates, previous?.work ?? null);
        if (judged) {
          by = "judge";
          kind = judged.work;
          difficulty = judged.difficulty;
          // What the rules know for sure stays: an image or long material.
          needs = [...new Set([...needs, ...judged.needs])];
          confidence = judged.confidence;
          signals.push("judge");
        } else signals.push("judge:none");
      }
    }

    if (!choice && by !== "follow-up") {
      const crossAt = this.#crossMoves.get(agentId) ?? 0;
      const lacksHere = !candidates.some(
        (candidate) =>
          candidate.model.provider === agent.provider &&
          candidate.unavailable === null &&
          (!needs.includes("vision") || candidate.profile.vision) &&
          (!needs.includes("long-context") || candidate.profile.window * 0.7 >= classification.tokens),
      );
      const unsure = confidence < HX_JUDGE_BELOW && needs.length === 0;
      if (unsure && currentCandidate && currentCandidate.unavailable === null) {
        // Not sure what the work is, and the model it has can take any: no change on a guess.
        signals.push("unsure:kept");
        choice = asChoice(currentCandidate, current);
      } else
        choice = hxChooseModel({
          work: kind,
          difficulty,
          needs,
          tokens: classification.tokens,
          settings,
          candidates,
          current,
          mayChangeProvider: settings.crossProvider && (now - crossAt > CROSS_PROVIDER_MS || lacksHere),
          newWork: true,
        });
    }

    // HXBot (v1.7.4, CONC-08): new work whose model's provider is the bottleneck moves to a model that
    // ranks the same or better (overload-move.ts). A model the user named stays.
    let overload: { from: string; why: HxOverloadWhy } | null = null;
    if (by !== "follow-up" && by !== "manual") {
      const planned = choice?.model ??
        currentCandidate?.model ?? { provider: agent.provider, id: agent.model, name: agent.model };
      const tier = work.sender === "user" ? 0 : work.sender === "routine" ? 3 : 2;
      const moved = hxOverloadChoice({
        current: planned,
        candidates,
        settings,
        targetMs: HX_OVERLOAD_TARGETS[tier],
        turnMs: hxFlow.turnMs(),
        member: false,
        canTake: (candidate) => hxCanTake(candidate, needs, classification.tokens),
        now,
      });
      // A pause moves new work at once; a long queue only while the tier is overloaded.
      if (moved && (moved.why === "paused" || hxOverload.overloaded(tier))) {
        overload = { from: planned.name, why: moved.why };
        choice = asChoice(moved.candidate, current);
        signals.push(`overload:${moved.why}`);
      }
    }

    const chosen = choice?.model ??
      currentCandidate?.model ?? { provider: agent.provider, id: agent.model, name: agent.model };
    if (!choice && by !== "follow-up") by = "fallback";
    const effort =
      by === "follow-up" || signals.includes("unsure:kept")
        ? agent.reasoningEffort
        : (hxAutoEffort(chosen, difficulty, settings.effort) ?? agent.reasoningEffort);
    const target: HxModelRef = hxRefOf(chosen);
    const changed = !hxSameModel(target, current);
    let moved = false;
    if (changed || effort !== agent.reasoningEffort) {
      try {
        await host.move(agentId, { ...target, reasoningEffort: effort });
        moved = true;
        if (changed && target.provider !== agent.provider) this.#crossMoves.set(agentId, now);
      } catch (error) {
        by = "fallback";
        signals.push("move-failed");
        logger.warn("HXBot could not move an auto agent to its chosen model.", { error: String(error) });
      }
    }
    const final = moved || !changed ? chosen : (currentCandidate?.model ?? chosen);
    const decision: HxRoutingDecision = {
      agentId,
      deliveryId: work.deliveryId,
      taskId: work.taskId,
      at: now,
      work: kind,
      difficulty,
      needs,
      by,
      confidence,
      chosen: { ...hxRefOf(final), name: final.name },
      previous: moved && changed ? { ...current, name: currentCandidate?.model.name ?? agent.model } : null,
      kept: !(moved && changed),
      signals: signals.slice(0, 12),
      skipped: (choice?.skipped ?? []).map((entry) => ({
        ...hxRefOf(entry.model),
        name: entry.model.name,
        reason: entry.reason,
      })),
      effort,
      ms: Date.now() - started,
    };
    this.#store.record(decision);
    if (final.provider === "opencode" && hxModelProfile(final).freeGroup === HX_OPENCODE_FREE_GROUP)
      this.#store.countFree(now);
    // HXBot (v1.7.4, CONC-08): a move for the provider's overload says which model and why.
    if (overload && moved && changed)
      host.note(agentId, work.taskId, hxOverloadLine(overload.from, final.name, overload.why));
    // A follow-up that keeps its model needs no line: the line of its work is just above.
    else if (by !== "follow-up" || (moved && changed))
      host.note(agentId, work.taskId, hxAutoLine(kind, final.name, moved && changed));
  }

  async #judge(agentId: string, work: HxQueuedWork, candidates: readonly HxCandidate[], previous: HxWorkType | null) {
    const host = this.#host;
    if (!host) return null;
    const settings = this.#store.settings(agentId);
    const entries: HxAutoModelEntry[] = candidates.map((candidate) => ({
      ref: hxRefOf(candidate.model),
      name: candidate.model.name,
      tier: candidate.profile.tier,
      cost: candidate.profile.cost,
      vision: candidate.profile.vision,
      ready: candidate.unavailable === null,
      excluded: settings.excluded.some((ref) => hxSameModel(ref, hxRefOf(candidate.model))),
    }));
    const pick = hxJudgeModel(entries);
    if (!pick) return null;
    const option = host
      .models(agentId)
      .find((model) => hxSameModel(hxRefOf({ ...model, providerAccountId: model.providerAccountId }), pick.ref));
    if (!option) return null;
    const prompt = hxJudgePrompt({ text: work.text, attachments: work.attachments.map((item) => item.name), previous });
    // HXBot (v1.7.4, CONC-02): a judge call is tier 1 under the limit of its model. With no place in a
    // second (the model is paused or full), the rules decide.
    const gateModel = hxProviderModelOf({
      provider: option.provider,
      model: option.id,
      providerAccountId: option.providerAccountId,
    });
    const release = gateModel ? await hxProviderGate.acquire(gateModel, 1, HX_JUDGE_PLACE_MS) : () => {};
    if (!release) return null;
    const stop = new AbortController();
    try {
      const answer = await hxWithin(host.judge(agentId, option, prompt, stop.signal), HX_JUDGE_TIMEOUT_MS);
      // A judge that did not answer in time is stopped, so it does not hold the spare client.
      if (answer === null) stop.abort();
      return answer === null ? null : hxParseJudge(answer);
    } finally {
      release();
    }
  }
}

function refOfAgent(agent: HxAutoAgent): HxModelRef {
  return {
    provider: agent.provider,
    model: agent.model,
    ...(agent.providerAccountId === null ? {} : { providerAccountId: agent.providerAccountId }),
  };
}

/** The model can take the work: pictures when it needs them, and the material in its window. */
function hxCanTake(candidate: HxCandidate, needs: readonly string[], tokens: number): boolean {
  if (needs.includes("vision") && !candidate.profile.vision) return false;
  return !needs.includes("long-context") || candidate.profile.window * 0.7 >= tokens;
}

function usable(candidates: readonly HxCandidate[]): HxCandidate[] {
  return candidates.filter((candidate) => candidate.unavailable === null);
}

function asChoice(candidate: HxCandidate, current: HxModelRef): HxChoice {
  return {
    model: candidate.model,
    profile: candidate.profile,
    kept: hxSameModel(hxRefOf(candidate.model), current),
    by: "table",
    required: 0,
    skipped: [],
  };
}

export const hxAutoRouter = new HxAutoRouter();
