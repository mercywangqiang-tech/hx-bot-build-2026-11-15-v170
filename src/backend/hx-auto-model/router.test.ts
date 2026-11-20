import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HX_AUTO_DEFAULTS, type HxAutoModelSettings, type HxModelRef } from "@hxbot/contracts/hx-auto-model";

import type { AgentModelOption, AgentProviderId, AgentReasoningEffort } from "@hxbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hxProviderGate } from "../hx-flow/provider-gate";
import { hxProviderModelOf } from "../hx-flow/provider-model";
import {
  type HxAutoAgent,
  type HxAutoHost,
  HxAutoRouter,
  type HxQueuedWork,
  hxAutoLine,
  hxNamedModel,
  hxOverloadLine,
} from "./router";
import { HxAutoModelStore } from "./store";

// These tests were written for "free first", the default until v1.6.7; the default is now "quality".
const FREE_FIRST: HxAutoModelSettings = { ...HX_AUTO_DEFAULTS, preference: "free" };

const option = (
  provider: AgentProviderId,
  id: string,
  name: string,
  efforts: AgentReasoningEffort[] = [],
): AgentModelOption => ({
  provider,
  id,
  name,
  description: "",
  defaultReasoningEffort: efforts[0] ?? "medium",
  supportedReasoningEfforts: efforts.length ? efforts : ["medium"],
});

const MODELS = [
  option("opencode", "opencode/glm-5.3-flash-free", "GLM-5.3-Flash Free"),
  option("opencode", "opencode/deepseek-v4.1-flash-free", "DeepSeek V4.1 Flash Free"),
  option("opencode", "opencode/nemotron-3.5-super-vl-free", "Nemotron 3.5 Super VL Free"),
  option("claude", "claude-sonnet-5-5", "Claude Sonnet 5.5", ["low", "medium", "high"]),
  option("claude", "claude-opus-5-5", "Claude Opus 5.5", ["low", "medium", "high"]),
];

interface World {
  agent: HxAutoAgent;
  work: HxQueuedWork | null;
  busy: boolean;
  limited: Set<string>;
  notReady: Set<string>;
  moves: Array<HxModelRef & { reasoningEffort: AgentReasoningEffort }>;
  notes: Array<{ taskId: string | null; text: string }>;
  drains: number;
  judge: ((prompt: string, signal: AbortSignal) => Promise<string>) | null;
  reply: string | null;
  failMove: boolean;
  /** The chat goes on in a provider session (v1.7.0). */
  continuing: boolean;
  /** v1.7.4: the models the host lists (default MODELS). */
  models: AgentModelOption[];
}

function makeWorld(): World {
  return {
    agent: {
      id: "a1",
      name: "Ada",
      provider: "opencode",
      model: "opencode/glm-5.3-flash-free",
      providerAccountId: null,
      reasoningEffort: "medium",
    },
    work: null,
    busy: false,
    limited: new Set(),
    notReady: new Set(),
    moves: [],
    notes: [],
    drains: 0,
    judge: null,
    reply: null,
    failMove: false,
    continuing: false,
    models: MODELS,
  };
}

function hostOf(world: World): HxAutoHost {
  return {
    agent: (agentId) => (agentId === world.agent.id ? world.agent : null),
    models: () => world.models,
    ready: (ref) => !world.notReady.has(ref.model) && !world.limited.has(ref.model),
    limited: (ref) => world.limited.has(ref.model),
    busy: () => world.busy,
    nextWork: () => world.work,
    historyTokens: () => 0,
    continuing: () => world.continuing,
    move: async (_agentId, choice) => {
      if (world.failMove) throw new Error("refused");
      world.moves.push(choice);
      world.agent = {
        ...world.agent,
        provider: choice.provider,
        model: choice.model,
        reasoningEffort: choice.reasoningEffort,
      };
    },
    note: (_agentId, taskId, text) => world.notes.push({ taskId, text }),
    judge: (_agentId, _model, prompt, signal) =>
      world.judge ? world.judge(prompt, signal) : Promise.reject(new Error("none")),
    taskOfThread: () => null,
    lastReply: () => world.reply,
    scheduleDrain: () => {
      world.drains += 1;
    },
  };
}

let folder = "";
let store: HxAutoModelStore;
let world: World;
let router: HxAutoRouter;
const NOW = Date.parse("2026-11-14T03:00:00Z");

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "hx-auto-router-"));
  store = new HxAutoModelStore();
  store.open(folder, NOW);
  world = makeWorld();
  router = new HxAutoRouter(store);
  router.setHost(hostOf(world));
  store.setSettings("a1", { ...FREE_FIRST, enabled: true, judge: "rules" });
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
  hxProviderGate.reset();
});

const work = (text: string, extra: Partial<HxQueuedWork> = {}): HxQueuedWork => ({
  deliveryId: `d-${Math.random()}`,
  taskId: null,
  text,
  attachments: [],
  sender: "user",
  ...extra,
});

describe("when a decision is due", () => {
  it("is due for new work of an idle agent on auto, once per delivery", async () => {
    world.work = work("帮我写一封邮件，告诉客户交货推迟");
    expect(router.due("a1")).toBe(true);
    await router.follow("a1", NOW);
    expect(router.due("a1")).toBe(false);
    expect(world.drains).toBe(1);
  });

  it("is not due when the agent is not on auto, is busy, or has no work", () => {
    world.work = work("写一封邮件");
    world.busy = true;
    expect(router.due("a1")).toBe(false);
    world.busy = false;
    store.setSettings("a1", { ...FREE_FIRST, enabled: false });
    expect(router.due("a1")).toBe(false);
    store.setSettings("a1", { ...FREE_FIRST, enabled: true });
    world.work = null;
    expect(router.due("a1")).toBe(false);
  });
});

describe("the choice of a model", () => {
  it("moves to a model that reads images for an image, free first", async () => {
    world.work = work("这是什么", { attachments: [{ name: "a.jpg", size: 1000 }] });
    await router.follow("a1", NOW);
    expect(world.moves.at(-1)?.model).toBe("opencode/nemotron-3.5-super-vl-free");
    expect(world.notes.at(-1)?.text).toBe(hxAutoLine("vision", "Nemotron 3.5 Super VL Free", true));
    const [decision] = store.decisions("a1");
    expect(decision).toMatchObject({ work: "vision", needs: ["vision"], kept: false, by: "rules" });
    expect(decision?.previous?.model).toBe("opencode/glm-5.3-flash-free");
  });

  it("keeps a free model for writing and says so in one line", async () => {
    world.work = work("帮我润色这段话，更正式一点");
    await router.follow("a1", NOW);
    expect(world.moves).toEqual([]);
    expect(world.notes.at(-1)?.text).toBe(hxAutoLine("writing", "GLM-5.3-Flash Free", false));
  });

  it("takes the strongest model for hard planning when free models fall short", async () => {
    world.work = work("设计一个三年的海外市场进入策略，全面评估风险和投入");
    await router.follow("a1", NOW);
    expect(world.moves.at(-1)).toMatchObject({ provider: "claude", model: "claude-opus-5-5", reasoningEffort: "high" });
  });

  it("does not leave the provider again within ten minutes unless the work needs it", async () => {
    world.work = work("设计一个三年的海外市场进入策略，全面评估风险和投入");
    await router.follow("a1", NOW);
    expect(world.agent.provider).toBe("claude");
    world.work = work("帮我写一封感谢信");
    await router.follow("a1", NOW + 60_000);
    expect(world.agent.provider).toBe("claude");
    // Eleven minutes later the cheaper provider is allowed again.
    world.work = work("帮我写一封道歉信");
    await router.follow("a1", NOW + 11 * 60_000);
    expect(world.agent.provider).toBe("opencode");
  });

  it("keeps the model when it is not sure what the work is", async () => {
    world.agent = { ...world.agent, provider: "claude", model: "claude-sonnet-5-5" };
    world.work = work("这个怎么弄");
    await router.follow("a1", NOW);
    expect(world.moves).toEqual([]);
    expect(store.decisions("a1")[0]?.signals).toContain("unsure:kept");
  });

  it("asks the judge when unsure, and uses a valid answer", async () => {
    store.setSettings("a1", { ...FREE_FIRST, enabled: true, judge: "rules+model" });
    world.judge = async (prompt) => {
      expect(prompt).toContain("<request>");
      return '{"work":"vision","difficulty":"mid","needs":["vision"],"confidence":0.9}';
    };
    world.work = work("这个怎么弄");
    await router.follow("a1", NOW);
    const [decision] = store.decisions("a1");
    expect(decision).toMatchObject({ by: "judge", work: "vision", needs: ["vision"] });
    expect(world.moves.at(-1)?.model).toBe("opencode/nemotron-3.5-super-vl-free");
  });

  it("goes on with the rules when the judge is silent, and stops it", async () => {
    store.setSettings("a1", { ...FREE_FIRST, enabled: true, judge: "rules+model" });
    let stopped = false;
    world.judge = (_prompt, signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          stopped = true;
          resolve("late");
        });
      });
    world.work = work("这个怎么弄");
    await router.follow("a1", NOW);
    expect(stopped).toBe(true);
    expect(store.decisions("a1")[0]).toMatchObject({ by: "rules" });
    expect(store.decisions("a1")[0]?.signals).toContain("judge:none");
  }, 10_000);

  it("keeps the model and effort in a chat that goes on, and asks no judge (v1.7.0)", async () => {
    store.setSettings("a1", { ...FREE_FIRST, enabled: true, judge: "rules+model" });
    let asked = false;
    world.judge = async () => {
      asked = true;
      return "{}";
    };
    world.continuing = true;
    world.work = work("帮我写一个复杂的数据库迁移脚本，并重构整个模块");
    await router.follow("a1", NOW);
    expect(asked).toBe(false);
    expect(world.moves).toEqual([]);
    expect(store.decisions("a1")[0]).toMatchObject({ by: "follow-up", kept: true });
    expect(store.decisions("a1")[0]?.signals).toContain("continuing");
  });

  it("chooses again in a chat that goes on when the work needs pictures that the model cannot read", async () => {
    world.continuing = true;
    world.work = { ...work("看看这张图"), attachments: [{ name: "shot.png", size: 20_000 }] };
    await router.follow("a1", NOW);
    expect(store.decisions("a1")[0]?.signals).not.toContain("continuing");
  });

  it("never asks the judge with rules only", async () => {
    let asked = false;
    world.judge = async () => {
      asked = true;
      return "{}";
    };
    world.work = work("这个怎么弄");
    await router.follow("a1", NOW);
    expect(asked).toBe(false);
  });

  it("takes the model that the message names", async () => {
    world.work = work("改用 Claude Opus 5.5 重答");
    await router.follow("a1", NOW);
    expect(world.moves.at(-1)?.model).toBe("claude-opus-5-5");
    expect(store.decisions("a1")[0]?.by).toBe("manual");
  });

  it("keeps the model of the work before for a follow-up, with no line", async () => {
    world.work = work("帮我润色这段话，更正式一点");
    await router.follow("a1", NOW);
    const lines = world.notes.length;
    world.work = work("继续");
    await router.follow("a1", NOW + 30_000);
    expect(world.notes.length).toBe(lines);
    expect(store.decisions("a1")[0]).toMatchObject({ by: "follow-up", work: "writing" });
  });

  it("skips models at their limit, and all free OpenCode models when one of them is", async () => {
    world.limited.add("opencode/glm-5.3-flash-free");
    world.agent = { ...world.agent, provider: "claude", model: "claude-sonnet-5-5" };
    world.work = work("这是什么", { attachments: [{ name: "a.jpg", size: 1000 }] });
    await router.follow("a1", NOW);
    expect(world.agent.provider).toBe("claude");
    const view = router.view("a1", NOW);
    expect(view.models.filter((model) => model.ref.provider === "opencode").every((model) => !model.ready)).toBe(true);
  });

  it("stays on its model and records why when the move is refused", async () => {
    world.failMove = true;
    world.work = work("这是什么", { attachments: [{ name: "a.jpg", size: 1000 }] });
    await router.follow("a1", NOW);
    const [decision] = store.decisions("a1");
    expect(decision).toMatchObject({ by: "fallback", kept: true });
    expect(decision?.chosen.model).toBe("opencode/glm-5.3-flash-free");
    expect(decision?.signals).toContain("move-failed");
  });

  it("leaves the agent's model alone when the user changes it", () => {
    router.manualChange("a1");
    expect(store.enabled("a1")).toBe(false);
  });
});

describe("a stronger model after a turn that went badly", () => {
  it("offers it once after a failed turn, and a redo takes it", async () => {
    world.work = work("帮我润色这段话，更正式一点");
    await router.follow("a1", NOW);
    router.turnEnded("a1", "t", "turn-1", "failed");
    router.turnEnded("a1", "t", "turn-1", "failed");
    const offers = world.notes.filter((note) => note.text.includes("redo"));
    expect(offers).toHaveLength(1);
    world.work = work("重做");
    await router.follow("a1", NOW + 60_000);
    expect(store.decisions("a1")[0]?.by).toBe("redo");
    expect(world.agent.provider).toBe("claude");
  });

  it("offers it after a reply that gives up, not after an ordinary one", async () => {
    world.work = work("帮我润色这段话");
    await router.follow("a1", NOW);
    world.reply = "好的，已经改好了。";
    router.turnEnded("a1", "t", "turn-1", "completed");
    expect(world.notes.filter((note) => note.text.includes("redo"))).toHaveLength(0);
    world.reply = "抱歉，这个任务我无法完成。";
    router.turnEnded("a1", "t", "turn-1", "completed");
    expect(world.notes.filter((note) => note.text.includes("redo"))).toHaveLength(1);
  });

  it("offers nothing when the user turned the offer off", async () => {
    store.setSettings("a1", { ...FREE_FIRST, enabled: true, judge: "rules", suggestStronger: false });
    world.work = work("帮我润色这段话");
    await router.follow("a1", NOW);
    router.turnEnded("a1", "t", "turn-1", "failed");
    expect(world.notes.filter((note) => note.text.includes("redo"))).toHaveLength(0);
  });
});

describe("the other answers of the router", () => {
  it("gives an auto agent a backup model for a usage limit", () => {
    world.limited.add("opencode/glm-5.3-flash-free");
    const next = router.backup("a1");
    expect(next).not.toBeNull();
    expect(next?.model).not.toBe("opencode/glm-5.3-flash-free");
    store.setSettings("a1", { ...FREE_FIRST, enabled: false });
    expect(router.backup("a1")).toBeNull();
  });

  it("shows the settings, the models and a preview of each kind of work", async () => {
    world.work = work("帮我润色这段话");
    await router.follow("a1", NOW);
    const view = router.view("a1", NOW);
    expect(view.models).toHaveLength(MODELS.length);
    expect(view.preview.vision?.model).toBe("opencode/nemotron-3.5-super-vl-free");
    expect(view.decisions).toHaveLength(1);
    expect(view.freeQuota.usedToday).toBe(1);
  });

  it("gives planning and checking a stronger model than doing", () => {
    const doing = router.roleModel("a1", { kind: "do", work: "writing", difficulty: "mid", needs: [] });
    const checking = router.roleModel("a1", { kind: "check", work: "writing", difficulty: "mid", needs: [] });
    expect(doing?.cost).toBe("free");
    expect(checking?.provider).toBe("claude");
  });
});

describe("a model named in a message", () => {
  const candidates = MODELS.map((model) => ({
    model: { provider: model.provider, id: model.id, name: model.name },
    profile: {
      tier: "A" as const,
      vision: true,
      tools: true,
      window: 128_000,
      cost: "free" as const,
      freeGroup: null,
      strengths: {},
    },
    unavailable: null,
  }));

  it("finds one model by its name or a part of it", () => {
    expect(hxNamedModel("改用 Claude Opus 5.5 重答", candidates)?.model.id).toBe("claude-opus-5-5");
    expect(hxNamedModel("use opus for this", candidates)?.model.id).toBe("claude-opus-5-5");
    expect(hxNamedModel("换用 DeepSeek 来做", candidates)?.model.id).toBe("opencode/deepseek-v4.1-flash-free");
  });

  it("finds nothing for a name of several models or a word that is not a model", () => {
    expect(hxNamedModel("use Claude", candidates)).toBeNull();
    expect(hxNamedModel("用中文回答", candidates)).toBeNull();
    expect(hxNamedModel("use it", candidates)).toBeNull();
  });
});

// v1.7.4 (CONC-08-A1, CONC-08-A2): the whole decision of the router, with the provider of the agent's
// model paused by a 429 in the real provider gate, as the turns do. The rules of the move are tested
// in overload-move.test.ts; here, that the router takes them for new work, says why in one line, and
// keeps to the user's exclusions and to this computer.
describe("CONC-08: new work when the provider of its model is paused", () => {
  const CLOUD = [
    option("claude", "claude-opus-4-5", "Claude Opus", ["low", "medium", "high"]),
    option("codex", "gpt-5.2-pro", "GPT Pro", ["low", "medium", "high"]),
    option("claude", "claude-haiku-4-5", "Claude Haiku", ["low", "medium", "high"]),
  ];
  const LOCAL = [
    option("opencode", "ollama/qwen3:32b", "Qwen (local)"),
    option("opencode", "ollama/llama3.3:70b", "Llama (local)"),
  ];

  function pause(provider: AgentProviderId, model: string) {
    const key = hxProviderModelOf({ provider, model });
    if (!key) throw new Error("no key");
    hxProviderGate.attach({ modelOf: (agentId) => (agentId === key.key ? key : null), wake: () => undefined });
    hxProviderGate.starting(key.key, false);
    hxProviderGate.turnStarted(`turn-${key.key}`, key.key, null, 10);
    hxProviderGate.throttled(`turn-${key.key}`, null, 60_000);
    hxProviderGate.attach(null);
  }

  function on(
    provider: AgentProviderId,
    model: string,
    models: AgentModelOption[],
    settings: Partial<HxAutoModelSettings> = {},
  ) {
    world.models = models;
    world.agent = { ...world.agent, provider, model };
    store.setSettings("a1", { ...HX_AUTO_DEFAULTS, enabled: true, judge: "rules", crossProvider: true, ...settings });
  }

  it("moves new work to a model of the same rank on another provider, and says why", async () => {
    on("claude", "claude-opus-4-5", CLOUD);
    pause("claude", "claude-opus-4-5");
    world.work = work("帮我设计一套系统的整体架构，要考虑并发和容灾");
    await router.follow("a1", Date.now());
    expect(world.moves.at(-1)?.model).toBe("gpt-5.2-pro");
    expect(world.notes.map((note) => note.text)).toContain(hxOverloadLine("Claude Opus", "GPT Pro", "paused"));
    expect(store.decisions("a1")[0]?.signals ?? []).toContain("overload:paused");
  });

  it("CONC-08-A1: never moves to a provider the user excluded, nor across providers when that is off", async () => {
    on("claude", "claude-opus-4-5", CLOUD, { excluded: [{ provider: "codex", model: "gpt-5.2-pro" }] });
    pause("claude", "claude-opus-4-5");
    world.work = work("帮我设计一套系统的整体架构，要考虑并发和容灾");
    await router.follow("a1", Date.now());
    expect(world.moves.some((move) => move.model === "gpt-5.2-pro")).toBe(false);
    expect(world.notes.some((note) => note.text.includes("GPT Pro"))).toBe(false);
    on("claude", "claude-opus-4-5", CLOUD, { crossProvider: false });
    world.work = work("再设计一套备用的架构方案");
    await router.follow("a1", Date.now());
    expect(world.moves.some((move) => move.provider === "codex")).toBe(false);
  });

  it("CONC-08-A2: a chat on a model of this computer stays on this computer", async () => {
    // Cloud models of the same provider too, so only the rule keeps the move on this computer.
    const sameProviderCloud = [
      option("opencode", "opencode/claude-opus-4-5", "Claude Opus (OpenCode)"),
      option("opencode", "opencode/gpt-5.2-pro", "GPT Pro (OpenCode)"),
    ];
    const overloadMoves = () =>
      store.decisions("a1").filter((decision) => decision.signals.some((signal) => signal.startsWith("overload:")));
    // Free first: the rules keep a model of this computer for writing, so a move is the pause's.
    on("opencode", "ollama/qwen3:32b", [...LOCAL, ...sameProviderCloud, ...CLOUD], { preference: "free" });
    pause("opencode", "ollama/qwen3:32b");
    world.work = work("帮我写一段产品介绍");
    await router.follow("a1", Date.now());
    expect(overloadMoves().length).toBeGreaterThan(0);
    expect(overloadMoves().every((decision) => decision.chosen.model.startsWith("ollama/"))).toBe(true);
    expect(overloadMoves()[0]?.chosen.model).toBe("ollama/llama3.3:70b");
    // With no other model of this computer, the pause moves nothing.
    rmSync(folder, { recursive: true, force: true });
    folder = mkdtempSync(join(tmpdir(), "hx-auto-router-"));
    store = new HxAutoModelStore();
    store.open(folder, NOW);
    router = new HxAutoRouter(store);
    router.setHost(hostOf(world));
    on("opencode", "ollama/qwen3:32b", [LOCAL[0] ?? option("opencode", "x", "x"), ...sameProviderCloud, ...CLOUD], {
      preference: "free",
    });
    world.work = work("再写一段产品介绍");
    await router.follow("a1", Date.now());
    expect(overloadMoves()).toEqual([]);
  });
});

// v1.7.4 (CONC-11-A1): the team's judge gives no view when it is late, refused or its provider is paused;
// the team then asks the user by its rules (hx-team/service.test.ts).
describe("CONC-11: the team's judge", () => {
  it("answers through the lead's provider within the time", async () => {
    world.judge = async () => "VERDICT: continue\nREASON: ok";
    expect(await router.teamJudge("a1", "data", 1_000)).toBe("VERDICT: continue\nREASON: ok");
  });

  it("gives no view when the model is late, and stops the call", async () => {
    let aborted = false;
    world.judge = (_prompt, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });
    expect(await router.teamJudge("a1", "data", 50)).toBeNull();
    expect(aborted).toBe(true);
  });

  it("gives no view when the provider refuses (429) or the model is paused", async () => {
    world.judge = async () => {
      throw new Error("HTTP 429 rate limit");
    };
    expect(await router.teamJudge("a1", "data", 1_000)).toBeNull();
    // Every model the judge could use is held by its provider: no place within 1 s, no call.
    let called = 0;
    world.judge = async () => {
      called += 1;
      return "VERDICT: continue\nREASON: ok";
    };
    for (const model of MODELS) {
      const key = hxProviderModelOf({ provider: model.provider, model: model.id });
      if (!key) continue;
      hxProviderGate.attach({ modelOf: (agentId) => (agentId === key.key ? key : null), wake: () => undefined });
      hxProviderGate.starting(key.key, false);
      hxProviderGate.turnStarted(`turn-${key.key}`, key.key, null, 10);
      hxProviderGate.throttled(`turn-${key.key}`, null, 60_000);
    }
    hxProviderGate.attach(null);
    const started = Date.now();
    expect(await router.teamJudge("a1", "data", 20_000)).toBeNull();
    expect(called).toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("v1.7.5 RTN-11: a workflow step whose model is auto", () => {
  const stepWork = (deliveryId: string, text: string): HxQueuedWork => ({
    deliveryId,
    taskId: null,
    text,
    attachments: [],
    sender: "routine",
  });

  beforeEach(() => {
    // The agent itself is not on auto: only the step asks for it.
    store.setSettings("a1", { ...FREE_FIRST, enabled: false, judge: "rules" });
  });

  it("is not due without a wanting step, and is due for one", () => {
    world.work = stepWork("d1", "Write a Python function that parses CSV files and add unit tests for it.");
    expect(router.due("a1")).toBe(false);
    const wanted = new Set(["d1"]);
    router.setAutoWork({ wanted: (_agent, id) => wanted.has(id), done: (id) => wanted.delete(id) });
    expect(router.due("a1")).toBe(true);
    world.work = stepWork("d2", "Another step");
    expect(router.due("a1")).toBe(false);
  });

  it("chooses the model of the step's work, then gives the agent its own model back after the turn", async () => {
    const wanted = new Set(["d1"]);
    router.setAutoWork({ wanted: (_agent, id) => wanted.has(id), done: (id) => wanted.delete(id) });
    world.work = stepWork(
      "d1",
      "Refactor the whole repository: split the payment module, migrate the database layer and update every test.",
    );
    expect(router.due("a1")).toBe(true);
    await router.follow("a1", NOW);
    // The note is spent and the decision is kept, so the same delivery is not decided twice.
    expect(wanted.has("d1")).toBe(false);
    expect(router.due("a1")).toBe(false);
    const movedTo = world.agent.model;
    expect(world.moves.length).toBeGreaterThan(0);
    expect(movedTo).not.toBe("opencode/glm-5.3-flash-free");
    router.turnEnded("a1", "thread-1", "turn-1", "completed");
    await Promise.resolve();
    expect(world.agent.model).toBe("opencode/glm-5.3-flash-free");
    expect(world.agent.reasoningEffort).toBe("medium");
    // The next turn ends with nothing to give back.
    const moves = world.moves.length;
    router.turnEnded("a1", "thread-1", "turn-2", "completed");
    await Promise.resolve();
    expect(world.moves.length).toBe(moves);
  });

  it("does not give the model back when the person chose another model or turned auto on since", async () => {
    const wanted = new Set(["d1", "d2"]);
    router.setAutoWork({ wanted: (_agent, id) => wanted.has(id), done: (id) => wanted.delete(id) });
    world.work = stepWork("d1", "Look at this screenshot and describe the chart in it.");
    world.work = { ...world.work, attachments: [{ name: "chart.png", size: 40_000 }] };
    await router.follow("a1", NOW);
    expect(world.moves.length).toBeGreaterThan(0);
    // The person picks a model by hand.
    world.agent = { ...world.agent, provider: "claude", model: "claude-sonnet-5-5" };
    const moves = world.moves.length;
    router.turnEnded("a1", "thread-1", "turn-1", "completed");
    await Promise.resolve();
    expect(world.moves.length).toBe(moves);
    expect(world.agent.model).toBe("claude-sonnet-5-5");
  });

  it("a failed move leaves nothing to give back", async () => {
    const wanted = new Set(["d1"]);
    router.setAutoWork({ wanted: (_agent, id) => wanted.has(id), done: (id) => wanted.delete(id) });
    world.failMove = true;
    world.work = stepWork("d1", "Look at this screenshot and describe the chart in it.");
    world.work = { ...world.work, attachments: [{ name: "chart.png", size: 40_000 }] };
    await router.follow("a1", NOW);
    world.failMove = false;
    router.turnEnded("a1", "thread-1", "turn-1", "completed");
    await Promise.resolve();
    expect(world.moves).toEqual([]);
    expect(world.agent.model).toBe("opencode/glm-5.3-flash-free");
  });
});
