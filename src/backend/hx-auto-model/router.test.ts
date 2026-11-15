import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HX_AUTO_DEFAULTS, type HxAutoModelSettings, type HxModelRef } from "@hxbot/contracts/hx-auto-model";

import type { AgentModelOption, AgentProviderId, AgentReasoningEffort } from "@hxbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type HxAutoAgent, type HxAutoHost, HxAutoRouter, type HxQueuedWork, hxAutoLine, hxNamedModel } from "./router";
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
  };
}

function hostOf(world: World): HxAutoHost {
  return {
    agent: (agentId) => (agentId === world.agent.id ? world.agent : null),
    models: () => MODELS,
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
