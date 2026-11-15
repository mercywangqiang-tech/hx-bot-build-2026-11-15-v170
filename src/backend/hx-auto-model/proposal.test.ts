import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HX_AUTO_DEFAULTS } from "@hxbot/contracts/hx-auto-model";
import type { AgentModelOption, AgentProviderId } from "@hxbot/contracts/ipc";
import type { UiConfirmBlock } from "@hxbot/contracts/ui-blocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type HxTeamPort, hxTeams } from "../hx-team/service";
import { HX_PROPOSAL_ACTIONS, HX_PROPOSAL_TOOL_DEFINITION, hxProposalCard, hxProposalInstruction } from "./proposal";
import { HxAutoRouter } from "./router";
import { HxAutoModelStore } from "./store";

const option = (provider: AgentProviderId, id: string, name: string): AgentModelOption => ({
  provider,
  id,
  name,
  description: "",
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["low", "medium", "high"],
});

let folder = "";
let router: HxAutoRouter;
let ready = true;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "hx-proposal-"));
  const store = new HxAutoModelStore();
  store.open(folder);
  router = new HxAutoRouter(store);
  // The cards below were written for "free first", the default until v1.6.7.
  store.setSettings("a1", { ...HX_AUTO_DEFAULTS, preference: "free" });
  ready = true;
  router.setHost({
    agent: () => ({
      id: "a1",
      name: "Ada",
      provider: "opencode",
      model: "x",
      providerAccountId: null,
      reasoningEffort: "medium",
    }),
    models: () => [
      option("opencode", "opencode/glm-5.3-flash-free", "GLM-5.3-Flash Free"),
      option("claude", "claude-opus-5-5", "Claude Opus 5.5"),
    ],
    ready: () => ready,
    limited: () => false,
    busy: () => false,
    nextWork: () => null,
    historyTokens: () => 0,
    move: async () => {},
    note: () => {},
    judge: () => Promise.reject(new Error("none")),
    taskOfThread: () => null,
    lastReply: () => null,
    scheduleDrain: () => {},
  });
});

afterEach(() => rmSync(folder, { recursive: true, force: true }));

const zh = {
  summary: "建议 2 个智能体，约 20 分钟。",
  minutes: 20,
  roles: [
    { name: "写手", kind: "do", does: "写出初稿", work: "writing" },
    { name: "审稿", kind: "check", does: "检查事实和语气", work: "writing" },
  ],
  steps: [
    { title: "写初稿", role: "写手" },
    { title: "查资料", role: "写手", together: true },
    { title: "审稿并修改", role: "审稿" },
  ],
  apps: ["Word"],
  confirm: ["发邮件给客户"],
};

function card(args: unknown): UiConfirmBlock {
  const result = hxProposalCard(router, "a1", args);
  if ("error" in result) throw new Error(result.error);
  if (result.spec.type !== "confirm") throw new Error("not a confirm block");
  return result.spec;
}

describe("the proposal card", () => {
  it("shows each role with its model and cost, the steps, and four buttons, in Chinese", () => {
    const spec = card(zh);
    expect(spec.title).toBe(zh.summary);
    expect(spec.fields?.[0]).toEqual({ label: "写手", value: "写出初稿 · GLM-5.3-Flash Free（免费）" });
    expect(spec.fields?.[1]).toEqual({ label: "审稿", value: "检查事实和语气 · Claude Opus 5.5（订阅）" });
    expect(spec.fields?.[2]).toEqual({ label: "时间", value: "约 20 分钟" });
    expect(spec.preview).toContain("2. 查资料 · 写手（与上一步同时）");
    expect(spec.preview).toContain("**要你确认**：发邮件给客户");
    expect(spec.preview).toContain("免费模型 1 个角色，订阅或付费模型 1 个角色");
    expect(spec.actions.map((action) => action.id)).toEqual([
      HX_PROPOSAL_ACTIONS.start,
      HX_PROPOSAL_ACTIONS.adjust,
      HX_PROPOSAL_ACTIONS.one,
      HX_PROPOSAL_ACTIONS.cancel,
    ]);
    expect(spec.actions.map((action) => action.label)).toEqual(["开始", "改一改", "就用一个智能体", "取消"]);
  });

  it("writes its own words in English for an English summary, and has no 'one agent' button for one role", () => {
    const spec = card({
      summary: "One agent, about 5 minutes.",
      roles: [{ name: "Writer", kind: "do", does: "Writes the post", work: "writing" }],
      steps: [{ title: "Write", role: "Writer" }],
    });
    expect(spec.fields?.[0]).toEqual({ label: "Writer", value: "Writes the post · GLM-5.3-Flash Free (free)" });
    expect(spec.actions.map((action) => action.label)).toEqual(["Start", "Change it", "Cancel"]);
  });

  it("says when no model is ready", () => {
    ready = false;
    const spec = card(zh);
    expect(spec.fields?.[0]).toEqual({ label: "写手", value: "写出初稿 · 没有可用的模型" });
  });

  it("names who takes each role of a team (v1.6.6): an agent that fits it, or a new member", () => {
    const agent = (id: string, name: string, title: string) => ({
      id,
      name,
      title,
      description: "",
      hidden: false,
      busy: false,
      workspacePath: "/w",
      model: "m",
      computerUse: true,
    });
    const port: HxTeamPort = {
      agents: () => [agent("a1", "我", ""), agent("w", "小王", "写手")],
      settings: () => HX_AUTO_DEFAULTS,
      roleModel: () => null,
      createAgent: async () => ({ id: "x", name: "x" }),
      setHidden: async () => {},
      createRoom: async () => {},
      changeMembers: async () => {},
      post: async () => {},
      room: () => ({ exists: false, archived: false, tasks: [], messages: [] }),
      progress: () => {},
      command: async () => {},
      deliver: async () => {},
      note: () => {},
      error: () => {},
    };
    hxTeams.setPort(port);
    try {
      const spec = card(zh);
      expect(spec.fields?.[0]).toEqual({
        label: "写手",
        value: "写出初稿 · GLM-5.3-Flash Free（免费） · 由 小王 来做",
      });
      expect(spec.fields?.[1]).toEqual({
        label: "审稿",
        value: "检查事实和语气 · Claude Opus 5.5（订阅） · 新建一个成员",
      });
    } finally {
      hxTeams.setPort(null);
    }
    expect(HX_PROPOSAL_TOOL_DEFINITION.description).toContain("hxbot.start_team");
    expect(hxProposalInstruction(router, "a1").join(" ")).toContain("hxbot.team gives its status");
  });

  it("takes the markdown out of the agent's words", () => {
    const spec = card({ ...zh, steps: [{ title: "**粗体** [链接](x) `代码`", role: "写手" }] });
    expect(spec.preview).toContain("1. 粗体 链接(x) 代码 · 写手");
  });

  it("refuses a step of an unknown role, two roles of one name, and wrong arguments", () => {
    expect(hxProposalCard(router, "a1", { ...zh, steps: [{ title: "x", role: "别人" }] })).toHaveProperty("error");
    expect(hxProposalCard(router, "a1", { ...zh, roles: [zh.roles[0], zh.roles[0]] })).toHaveProperty("error");
    expect(hxProposalCard(router, "a1", { summary: "x" })).toHaveProperty("error");
  });

  it("is refused when the user turned it off, and its instruction follows the setting", () => {
    expect(hxProposalInstruction(router, "a1")[0]).toContain("When work has parts");
    router.store.setSettings("a1", { ...HX_AUTO_DEFAULTS, proposal: "always" });
    expect(hxProposalInstruction(router, "a1")[0]).toContain("Before each long task");
    router.store.setSettings("a1", { ...HX_AUTO_DEFAULTS, proposal: "off" });
    expect(hxProposalInstruction(router, "a1")).toEqual([]);
    expect(hxProposalCard(router, "a1", zh)).toEqual({
      error: "The user turned the proposal card off for you. Start the work without it.",
    });
  });

  it("is a tool with a short description", () => {
    expect(HX_PROPOSAL_TOOL_DEFINITION.name).toBe("propose_plan");
    expect(HX_PROPOSAL_TOOL_DEFINITION.description.length).toBeLessThan(1_000);
  });
});
