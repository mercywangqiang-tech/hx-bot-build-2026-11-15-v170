// HXBot：最大权限接进 AttentionRegistry 之后的整条路：确认卡片、只有所有者能允许、本机脚本不能代答、
// “允许一次”回答服务商审批一次、任务结束即收回。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationSnapshot } from "@hxbot/contracts/ipc";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { Effect } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AttentionRegistry, type AttentionRegistryOptions } from "../agent/attention-registry";
import type { AgentClient } from "../agent-client";
import { HX_ASK_OWNER_ONLY, type HxAskAnswers } from "../hx-skills/ask";
import { hxSpaceCard, hxSpaceChoice } from "../hx-skills/space-question";
import type { AppServerRequest } from "../protocol";
import { hxAccessGrants } from "./grants";
import { type HxAccessAgent, setHxAccessHost } from "./hub";

let base: string;
let workspace: string;
let outside: string;
const agents = new Map<string, HxAccessAgent>();

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "hx-access-registry-"));
  workspace = join(base, "workspace");
  outside = join(base, "documents");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "q.txt"), "q");
  agents.set("on", { id: "on", name: "小犀", onDemand: true, roots: [workspace], workspacePath: workspace });
  agents.set("full", { id: "full", name: "Full", onDemand: false, roots: [workspace], workspacePath: workspace });
  setHxAccessHost({ agent: (id) => agents.get(id) ?? null, agentForThread: (thread) => thread.split(":")[0] });
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

interface Harness {
  registry: AttentionRegistry;
  replies: { id: unknown; result: unknown }[];
  events: { type: string; requestId?: unknown }[];
  client: AgentClient;
}

function harness(): Harness {
  const replies: Harness["replies"] = [];
  const events: Harness["events"] = [];
  const snapshot: ConversationSnapshot = {
    agentId: "on",
    threadId: null,
    activeTurnId: null,
    revision: 0,
    messages: [],
  };
  const options: AttentionRegistryOptions = {
    conversation: {
      agentForThread: (threadId: string) => threadId.split(":")[0],
      publicThreadId: (_agentId: string, threadId: string) => threadId,
      ensureSnapshot: () => snapshot,
      emitConversation: () => undefined,
    },
    browser: { listTabs: () => [], beginTakeover: () => Effect.void, endTakeover: () => undefined },
    hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
    routines: { markNeedsAttention: () => undefined, markRunningForTurn: () => undefined },
    workspaceSandboxed: (agentId) => agents.get(agentId)?.onDemand === true,
    emit: (event) => events.push(event),
    emitError: () => undefined,
    emitRuntimeSnapshot: () => undefined,
  };
  const fake = {
    provider: "codex",
    running: true,
    respond: (id: unknown, result: unknown) => replies.push({ id, result }),
    respondError: () => undefined,
  };
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the registry calls only these members of a client.
  const client = fake as unknown as AgentClient;
  return { registry: new AttentionRegistry(options), replies, events, client };
}

function toolCall(id: string, tool: string, args: unknown, thread = "on:t", turnId = "turn-1"): AppServerRequest {
  return {
    id,
    method: "item/tool/call",
    params: { threadId: thread, turnId, callId: id, namespace: "hxbot", tool, arguments: args },
  };
}

interface ToolBody {
  status?: string;
  actions?: string[];
}

/** The JSON text of a tool result, read. */
function body(result: unknown): ToolBody {
  const text =
    typeof result === "object" && result !== null && "contentItems" in result && Array.isArray(result.contentItems)
      ? result.contentItems[0]?.text
      : "";
  const parsed = typeof text === "string" && text.startsWith("{") ? JSON.parse(text) : null;
  if (!isDynamicRecord(parsed)) return {};
  return {
    ...(typeof parsed.status === "string" ? { status: parsed.status } : {}),
    ...(Array.isArray(parsed.actions)
      ? { actions: parsed.actions.filter((action) => typeof action === "string") }
      : {}),
  };
}

const request = () => ({
  reason: "更新季度报告",
  purpose: "写入新数据",
  targets: [{ type: "file", value: join(outside, "q.txt") }],
  actions: ["write"],
});

beforeEach(() => {
  hxAccessGrants.releaseAgent("on");
  hxAccessGrants.releaseAgent("full");
});

describe("the access card in the registry", () => {
  it("shows the card, lets only the owner allow, and Allow once answers the provider's approval once", async () => {
    const { registry, replies, events, client } = harness();
    const change = (id: string) =>
      registry.surfaceApproval(
        client,
        {
          id,
          method: "item/commandExecution/requestApproval",
          params: { threadId: "on:t", turnId: "turn-1", command: `echo x > ${outside}/q.txt`, cwd: workspace },
        },
        "command",
      );
    change("a0");
    expect(replies.at(-1)).toEqual({ id: "a0", result: { decision: "decline" } });

    registry.surfaceAccessRequest(client, toolCall("r1", "request_access", request()));
    expect(events.at(-1)).toMatchObject({ type: "prompt", requestId: "r1" });
    const before = replies.length;

    // A team member may not allow…
    await expect(
      Effect.runPromise(
        registry.respondToPrompt({ requestId: "r1", answers: { "hx-access": ["允许一次"] } }, { privileged: true }),
      ),
    ).rejects.toBeDefined();
    expect(replies).toHaveLength(before);
    // …and a local script may not answer at all.
    const local = registry.localAttention("on");
    expect(local.prompts[0]?.requiresHxBot).toBe(true);
    await expect(
      Effect.runPromise(
        registry.respondToLocalAttention("on", {
          kind: "prompt",
          requestId: local.prompts[0]?.requestId ?? "",
          answers: { "hx-access": ["允许一次"] },
        }),
      ),
    ).rejects.toThrow();
    expect(replies).toHaveLength(before);

    // The owner allows it once.
    await Effect.runPromise(
      registry.respondToPrompt(
        { requestId: "r1", answers: { "hx-access": ["允许一次"] } },
        { privileged: true, owner: true },
      ),
    );
    expect(body(replies.at(-1)?.result)).toMatchObject({ status: "granted", actions: ["write"] });

    // Codex's change of that file is accepted without a card, once.
    change("a1");
    expect(replies.at(-1)).toEqual({ id: "a1", result: { decision: "accept" } });
    change("a2");
    expect(replies.at(-1)).toEqual({ id: "a2", result: { decision: "decline" } });
    // Reading it needs nothing.
    registry.surfaceApproval(
      client,
      {
        id: "a3",
        method: "item/commandExecution/requestApproval",
        params: { threadId: "on:t", turnId: "turn-1", command: `cat ${outside}/q.txt`, cwd: workspace },
      },
      "command",
    );
    expect(replies.at(-1)).toEqual({ id: "a3", result: { decision: "accept" } });
    expect(events.some((event) => event.type === "approval")).toBe(false);

    // The task ends: what is left ends with it.
    registry.surfaceAccessRequest(client, toolCall("r2", "request_access", request()));
    await Effect.runPromise(
      registry.respondToPrompt(
        { requestId: "r2", answers: { "hx-access": ["允许一次"] } },
        { privileged: true, owner: true },
      ),
    );
    expect(hxAccessGrants.forThread("on", "on:t")).toHaveLength(1);
    registry.clearForTurn("on:t", "turn-1");
    expect(hxAccessGrants.forThread("on", "on:t")).toEqual([]);
    change("a4");
    expect(replies.at(-1)).toEqual({ id: "a4", result: { decision: "decline" } });
  });

  it("lets anyone refuse, and a refusal grants nothing", async () => {
    const { registry, replies, client } = harness();
    registry.surfaceAccessRequest(client, toolCall("r3", "request_access", request()));
    await Effect.runPromise(
      registry.respondToPrompt({ requestId: "r3", answers: { "hx-access": ["拒绝"] } }, { privileged: false }),
    );
    expect(body(replies.at(-1)?.result)).toMatchObject({ status: "denied" });
    expect(hxAccessGrants.forThread("on", "on:t")).toEqual([]);
  });

  it("gives the legacy approval the decision, with the reason of a refusal", () => {
    const { registry, replies, client } = harness();
    registry.surfaceLegacyApproval(client, {
      id: "l1",
      method: "execCommandApproval",
      params: { conversationId: "on:t", command: ["rm", "-rf", "build"], cwd: workspace },
    });
    expect(replies.at(-1)?.result).toEqual({ decision: "approved" });
    registry.surfaceLegacyApproval(client, {
      id: "l2",
      method: "execCommandApproval",
      params: { conversationId: "on:t", command: ["rm", "-rf", outside], cwd: workspace },
    });
    expect(replies.at(-1)?.result).toMatchObject({
      decision: { denied: { rejection: expect.stringContaining("request_access") } },
    });
  });

  it("answers release_access at once, and leaves a full access agent's approvals to the user", () => {
    const { registry, replies, events, client } = harness();
    registry.surfaceAccessRequest(client, toolCall("r4", "release_access", {}));
    expect(body(replies.at(-1)?.result)).toMatchObject({ status: "released" });
    registry.surfaceApproval(
      client,
      {
        id: "f1",
        method: "item/commandExecution/requestApproval",
        params: { threadId: "full:t", turnId: "turn-1", command: "rm -rf /tmp/x", cwd: workspace },
      },
      "command",
    );
    expect(events.at(-1)).toMatchObject({ type: "approval" });
  });

  it("refuses a malformed request", () => {
    const { registry, replies, client } = harness();
    registry.surfaceAccessRequest(client, { id: "m1", method: "item/tool/call", params: { tool: "request_access" } });
    expect(replies.at(-1)?.result).toMatchObject({ success: false });
  });
});

// HXBot v1.7.4（BAK-03-A2）：HXBot 自己的问题（版本空间满了）也是一张提问卡：主人能选全部，别人和本机脚本只能取消；
// 答案交给 HXBot，服务商那边什么都收不到；停止、到时间、服务商断开时答案是“没有”。
describe("HXBot's own question in the registry (v1.7.4, hxAsk)", () => {
  const card = hxSpaceCard(
    {
      path: join(workspace ?? "", "报告.xlsx"),
      why: "cap",
      usedBytes: 2 * 1024 ** 3,
      capBytes: 2 * 1024 ** 3,
      neededBytes: 5 * 1024 ** 2,
    },
    "zh",
  );
  const ownerOnly = (answers: HxAskAnswers) => hxSpaceChoice(answers, card.labels) !== "cancel";
  const ask = (h: Harness, signal: AbortSignal = new AbortController().signal, thread = "on:t", turnId = "turn-1") =>
    h.registry.hxAsk(
      h.client,
      toolCall("skill-1", "computer_skill", {}, thread, turnId),
      [card.question],
      ownerOnly,
      signal,
    );
  const pendingId = (h: Harness) => {
    const id = [...h.events].reverse().find((event) => event.type === "prompt")?.requestId;
    if (typeof id !== "string") throw new Error("no prompt");
    return id;
  };

  /** Why an answer was refused: the cause that the registry keeps inside its failure. */
  const refusal = async (effect: Effect.Effect<void, { cause: unknown }>) => {
    const failure = await Effect.runPromise(Effect.flip(effect));
    return failure.cause instanceof Error ? failure.cause.message : String(failure.cause);
  };

  it("shows a question card; the owner's answer goes to HXBot, the provider gets nothing", async () => {
    const h = harness();
    const answer = ask(h);
    const id = pendingId(h);
    expect(id.startsWith("hx-ask-")).toBe(true);
    expect(h.events.at(-1)).toMatchObject({ type: "prompt", questions: [card.question] });
    await Effect.runPromise(
      h.registry.respondToPrompt({ requestId: id, answers: { "hx-version-space": ["删掉最早的旧版本"] } }),
    );
    expect(hxSpaceChoice(await answer, card.labels)).toBe("clean-old");
    expect(h.replies).toEqual([]);
    // Answered once: the card is gone.
    await expect(
      Effect.runPromise(h.registry.respondToPrompt({ requestId: id, answers: { "hx-version-space": ["取消修改"] } })),
    ).rejects.toBeDefined();
  });

  it("lets a member, a chat app user or a local script cancel, never choose for the owner", async () => {
    const h = harness();
    const answer = ask(h);
    const id = pendingId(h);
    for (const label of ["删掉最早的旧版本", "这次不留版本"]) {
      expect(
        await refusal(
          h.registry.respondToPrompt({ requestId: id, answers: { "hx-version-space": [label] } }, { privileged: true }),
        ),
      ).toBe(HX_ASK_OWNER_ONLY);
    }
    const local = h.registry
      .localAttention("on")
      .prompts.find((prompt) => prompt.questions[0]?.id === "hx-version-space");
    expect(
      await refusal(
        h.registry.respondToLocalAttention("on", {
          kind: "prompt",
          requestId: local?.requestId ?? "",
          answers: { "hx-version-space": ["这次不留版本"] },
        }),
      ),
    ).toBe(HX_ASK_OWNER_ONLY);
    // A local script may cancel.
    await Effect.runPromise(
      h.registry.respondToLocalAttention("on", {
        kind: "prompt",
        requestId: local?.requestId ?? "",
        answers: { "hx-version-space": ["取消修改"] },
      }),
    );
    expect(hxSpaceChoice(await answer, card.labels)).toBe("cancel");
    expect(h.replies).toEqual([]);

    const second = harness();
    const owner = ask(second);
    await Effect.runPromise(
      second.registry.respondToPrompt(
        { requestId: pendingId(second), answers: { "hx-version-space": ["这次不留版本"] } },
        { privileged: true, owner: true },
      ),
    );
    expect(hxSpaceChoice(await owner, card.labels)).toBe("no-version");
  });

  it("gives no answer when the call stops, the provider goes, or the turn ends, and tells the provider nothing", async () => {
    const stopped = harness();
    const stop = new AbortController();
    const answer = ask(stopped, stop.signal);
    stop.abort();
    expect(await answer).toBeNull();
    expect(stopped.registry.localAttention("on").prompts).toEqual([]);

    const lost = harness();
    const lostAnswer = ask(lost);
    lost.registry.clearPrompts(lost.client);
    expect(await lostAnswer).toBeNull();

    const ended = harness();
    const endedAnswer = ask(ended);
    ended.registry.clearForTurn("on:t", "turn-1");
    expect(await endedAnswer).toBeNull();
    for (const h of [stopped, lost, ended]) expect(h.replies).toEqual([]);

    // Already stopped, or no thread to ask in: no card at all.
    const early = harness();
    const gone = new AbortController();
    gone.abort();
    expect(await ask(early, gone.signal)).toBeNull();
    expect(
      await early.registry.hxAsk(
        early.client,
        { id: "x", method: "item/tool/call", params: { tool: "computer_skill" } },
        [card.question],
        ownerOnly,
        new AbortController().signal,
      ),
    ).toBeNull();
    expect(early.events.filter((event) => event.type === "prompt")).toEqual([]);
  });
});
