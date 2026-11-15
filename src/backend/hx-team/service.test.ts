import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HX_AUTO_DEFAULTS, type HxAutoModelSettings } from "@hxbot/contracts/hx-auto-model";
import type { HxProgressCard } from "@hxbot/contracts/hx-progress";
import type { ChannelMessage, ChannelTask } from "@hxbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HxTeamAgent,
  type HxTeamAnswer,
  type HxTeamCall,
  type HxTeamPort,
  HxTeams,
  hxTeamCard,
  hxTeamCardId,
  hxTeamLine,
  hxTeamParallel,
} from "./service";
import { HxTeamStore } from "./store";

interface Room {
  name: string;
  instructions: string;
  members: string[];
  lead: string;
  archived: boolean;
  tasks: ChannelTask[];
  messages: ChannelMessage[];
}

const FORM = ["目标：写摘要", "已完成：无", "文件：/w/notes.md", "未解决：无", "下一步：交回", "不要碰：原文"].join(
  "\n",
);

let folder = "";
let now = Date.parse("2026-11-14T10:00:00.000Z");

function agent(id: string, name: string, title: string, description: string): HxTeamAgent {
  return {
    id,
    name,
    title,
    description,
    hidden: false,
    busy: false,
    workspacePath: join(folder, id),
    model: `${id}-model`,
    computerUse: true,
  };
}

class FakePort implements HxTeamPort {
  agentList: HxTeamAgent[] = [];
  settingsOf: HxAutoModelSettings = HX_AUTO_DEFAULTS;
  rooms = new Map<string, Room>();
  notes: Array<{ agentId: string; text: string }> = [];
  posts: Array<{ channelId: string; fromAgentId: string; text: string; toAgentIds: string[] }> = [];
  commands: Array<{ type: string; taskId: string; recipientAgentId: string | null }> = [];
  delivered: Array<{ fromAgentId: string; toAgentId: string; text: string; key: string }> = [];
  hidden: Array<{ agentId: string; hidden: boolean }> = [];
  made: Array<{ name: string; model: string | null }> = [];
  errors: unknown[] = [];
  failRoom = false;

  agents() {
    return this.agentList;
  }
  settings() {
    return this.settingsOf;
  }
  roleModel(_agentId: string, role: { kind: string }) {
    return role.kind === "check"
      ? { provider: "claude" as const, model: "claude-opus-5-5", name: "Claude Opus 5.5" }
      : { provider: "opencode" as const, model: "opencode/free", name: "Free model" };
  }
  async createAgent(input: { name: string; model: { model: string } | null }) {
    const id = `made-${this.made.length + 1}`;
    this.made.push({ name: input.name, model: input.model?.model ?? null });
    this.agentList.push(agent(id, input.name, "", ""));
    return { id, name: input.name };
  }
  async setHidden(agentId: string, hidden: boolean) {
    this.hidden.push({ agentId, hidden });
    const item = this.agentList.find((candidate) => candidate.id === agentId);
    if (item) item.hidden = hidden;
  }
  async createRoom(input: {
    channelId: string;
    name: string;
    instructions: string;
    memberIds: string[];
    leadAgentId: string;
  }) {
    if (this.failRoom) throw new Error("The room could not be made.");
    this.rooms.set(input.channelId, {
      name: input.name,
      instructions: input.instructions,
      members: [...input.memberIds],
      lead: input.leadAgentId,
      archived: false,
      tasks: [],
      messages: [],
    });
  }
  async changeMembers(input: { channelId: string; add: string[]; remove: string[]; leadAgentId?: string }) {
    const room = this.rooms.get(input.channelId);
    if (!room) throw new Error("gone");
    room.members = [...room.members.filter((id) => !input.remove.includes(id)), ...input.add];
    if (input.leadAgentId) room.lead = input.leadAgentId;
  }
  async post(input: { channelId: string; fromAgentId: string; text: string; toAgentIds: string[] }) {
    this.posts.push(input);
    const room = this.rooms.get(input.channelId);
    if (room)
      room.tasks.push(task(`root-${this.posts.length}`, null, input.toAgentIds[0] ?? null, "running", input.text));
  }
  room(channelId: string) {
    const room = this.rooms.get(channelId);
    return room
      ? { exists: true, archived: room.archived, tasks: room.tasks, messages: room.messages }
      : { exists: false, archived: false, tasks: [], messages: [] };
  }
  async command(input: {
    channelId: string;
    type: "stop" | "cancel" | "reassign";
    taskId: string;
    recipientAgentId: string | null;
  }) {
    this.commands.push(input);
    const room = this.rooms.get(input.channelId);
    const found = room?.tasks.find((item) => item.id === input.taskId);
    if (!found) return;
    if (input.type === "stop") found.state = "paused";
    if (input.type === "cancel") found.state = "cancelled";
    if (input.type === "reassign") found.ownerAgentId = input.recipientAgentId;
  }
  async deliver(input: { fromAgentId: string; toAgentId: string; text: string; key: string }) {
    this.delivered.push(input);
  }
  note(agentId: string, text: string) {
    this.notes.push({ agentId, text });
  }
  cards: Array<{ agentId: string; id: string; card: HxProgressCard; stopped: boolean }> = [];
  progress(agentId: string, id: string, card: HxProgressCard, stopped: boolean) {
    this.cards.push({ agentId, id, card, stopped });
  }
  error(_code: string, error: unknown) {
    this.errors.push(error);
  }
}

function task(
  id: string,
  parentTaskId: string | null,
  ownerAgentId: string | null,
  state: ChannelTask["state"],
  instruction = FORM,
): ChannelTask {
  return {
    id,
    channelId: "",
    parentTaskId,
    rootTaskId: parentTaskId ?? id,
    ownerAgentId,
    requestMessageId: "m",
    instruction,
    attachmentDraftIds: [],
    expectedResult: "",
    sourceMessageIds: [],
    dependencies: [],
    resources: [],
    state,
    revision: 0,
    assignmentCount: 0,
    error: null,
  };
}

function agentMessage(authorId: string, text: string): ChannelMessage {
  return {
    id: `msg-${text}`,
    channelId: "",
    sequence: 1,
    author: { kind: "agent", id: authorId, name: authorId },
    taskId: null,
    superseded: false,
    message: { id: `c-${text}`, author: "assistant", source: "agent", text, createdAt: "", status: "completed" },
  };
}

interface Answer {
  status?: string;
  reason?: string;
  to?: string;
  old?: string;
  new?: string;
  members?: string[];
  team?: {
    id: string;
    lead: string | null;
    state: string;
    members: Array<{ role: string; name: string; temporary: boolean; model: string | null }>;
  };
  board?: {
    files: string[];
    facts: string[];
    steps: Array<{ state: string; note: string }>;
    members: Array<{ computer: boolean }>;
  };
}

function read(result: HxTeamAnswer): Answer {
  return JSON.parse(result.contentItems[0]?.text ?? "{}");
}

let port: FakePort;
let teams: HxTeams;

const CARD = {
  goal: "写一份产品介绍并检查数字",
  roles: [
    { name: "写作者", kind: "do", does: "写公众号文章", work: "writing" },
    { name: "设计师", kind: "do", does: "画海报", work: "vision" },
    { name: "规划", kind: "plan", does: "定方案、最后检查", work: "reasoning" },
  ],
  steps: [
    { title: "定方案", role: "规划" },
    { title: "写文章", role: "写作者" },
    { title: "画海报", role: "设计师", together: true },
  ],
};

function call(tool: string, args: unknown, extra: Partial<HxTeamCall> = {}): Promise<HxTeamAnswer> {
  return teams.call({
    tool,
    arguments: args,
    agentId: "me",
    key: "turn-1:call-1",
    roomId: null,
    byPerson: true,
    ...extra,
  });
}

async function started(
  extra: { limits?: { members?: number; minutes?: number; rounds?: number } } = {},
): Promise<{ id: string; room: Room }> {
  const result = read(await call("start_team", { ...CARD, ...extra }));
  const id = result.team?.id ?? "";
  const room = port.rooms.get(id);
  if (!room) throw new Error("no room");
  return { id, room };
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "hx-team-"));
  now = Date.parse("2026-11-14T10:00:00.000Z");
  port = new FakePort();
  port.agentList = [
    agent("me", "前台", "我自己", ""),
    agent("w", "文案小王", "写作与文案", "负责公众号文章的写作"),
    agent("p", "方案老李", "规划与方案", "定方案"),
  ];
  const store = new HxTeamStore();
  store.open(join(folder, "teams"));
  teams = new HxTeams(store, () => now);
  teams.setPort(port);
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(folder, { recursive: true, force: true });
});

describe("start_team", () => {
  it("picks agents by skill, makes a member for a missing role, opens the room and briefs the lead", async () => {
    const result = read(await call("start_team", CARD));
    expect(result.status).toBe("started");
    const team = result.team;
    if (!team) throw new Error("no team");
    expect(team.members).toEqual([
      { role: "写作者", name: "文案小王", model: "w-model", temporary: false },
      { role: "设计师", name: "设计师", model: "Free model", temporary: true },
      { role: "规划", name: "方案老李", model: "p-model", temporary: false },
    ]);
    expect(team.lead).toBe("方案老李");
    expect(port.made).toEqual([{ name: "设计师", model: "opencode/free" }]);
    const room = port.rooms.get(team.id);
    expect(room?.members).toEqual(["w", "made-1", "p"]);
    expect(room?.lead).toBe("p");
    expect(room?.instructions).toContain("交接单");
    expect(room?.instructions.length).toBeLessThanOrEqual(2000);
    expect(port.posts).toHaveLength(1);
    expect(port.posts[0]?.toAgentIds).toEqual(["p"]);
    expect(port.posts[0]?.text).toContain("写一份产品介绍并检查数字");
    expect(port.posts[0]?.text).toContain("3. 画海报 · 设计师（与上一步同时）");
    expect(port.notes.map((note) => note.text)).toEqual([
      "Team started: 文案小王、设计师、方案老李; 方案老李 leads. Progress comes back here.",
    ]);
  });

  it("gives the same team to a retried call, without a second room or member", async () => {
    const first = read(await call("start_team", CARD));
    const second = read(await call("start_team", CARD));
    expect(second.team?.id).toBe(first.team?.id);
    expect(port.made).toHaveLength(1);
    expect(port.posts).toHaveLength(1);
  });

  it("refuses in a room, without a person, over the member limit, and with a step of no role", async () => {
    expect(read(await call("start_team", CARD, { roomId: "room" })).status).toBe("refused");
    expect(read(await call("start_team", CARD, { byPerson: false })).status).toBe("refused");
    port.settingsOf = { ...HX_AUTO_DEFAULTS, teamMembers: 2 };
    expect(String(read(await call("start_team", CARD)).reason)).toContain("at most 2 members");
    port.settingsOf = HX_AUTO_DEFAULTS;
    const wrong = { ...CARD, steps: [{ title: "x", role: "Nobody" }] };
    expect(String(read(await call("start_team", wrong)).reason)).toContain("Nobody");
    expect(port.rooms.size).toBe(0);
  });

  it("hides the members it made when the room cannot be made", async () => {
    port.failRoom = true;
    const result = read(await call("start_team", CARD));
    expect(result.status).toBe("failed");
    expect(port.hidden).toEqual([{ agentId: "made-1", hidden: true }]);
  });
});

describe("the handoff form and the limits", () => {
  it("refuses a handoff that is not a full form, with the template, and takes a full one", async () => {
    const { id } = await started();
    const refusal = teams.checkHandoff(id, "channel_assign", { task: "目标：写摘要\n下一步：交回" });
    expect(refusal).toContain("已完成、文件、未解决、不要碰");
    expect(refusal).toContain("目标：…");
    expect(teams.checkHandoff(id, "channel_assign", { task: FORM })).toBeNull();
    expect(
      read(
        await teams.call({
          tool: "team_board",
          arguments: { action: "read" },
          agentId: "w",
          key: "k",
          roomId: id,
          byPerson: false,
        }),
      ).board,
    ).toMatchObject({ files: ["/w/notes.md"] });
    expect(teams.checkHandoff(id, "channel_result", { text: "x" })).toBeNull();
    expect(teams.checkHandoff("another-channel", "channel_assign", { task: "x" })).toBeNull();
  });

  it("refuses handoffs past the handoff limit and past the time limit", async () => {
    port.settingsOf = { ...HX_AUTO_DEFAULTS, teamRounds: 10, teamMinutes: 30 };
    const { id, room } = await started();
    for (let index = 0; index < 10; index += 1) room.tasks.push(task(`sub-${index}`, "root-1", "w", "completed"));
    expect(teams.checkHandoff(id, "channel_transfer", { task: FORM })).toContain("10 次交接的上限");
    expect(port.notes.at(-1)?.text).toBe(
      "Team · It reached its limit of 10 handoffs; the lead finishes with what it has.",
    );
    room.tasks.length = 1;
    now += 31 * 60_000;
    expect(teams.checkHandoff(id, "channel_assign", { task: FORM })).toContain("30 分钟的上限");
  });
});

describe("the watcher", () => {
  it("moves the steps on the progress card, and writes no line for each handoff (v1.6.7)", async () => {
    const { id, room } = await started();
    teams.changed(id);
    const lines = port.notes.length;
    room.tasks.push(task("sub-1", "root-1", "w", "running"));
    teams.changed(id);
    const running = port.cards.at(-1);
    expect(running?.agentId).toBe("me");
    expect(running?.id).toBe(hxTeamCardId(id));
    // The defaults of v1.6.7: 80 handoffs and 240 minutes.
    expect(running?.card.title).toBe("Team · handoffs 1/80 · 0/240 min");
    expect(running?.card.steps.map((step) => step.state)).toContain("active");
    // The lead's step and the writer's step both run now; each names its member.
    expect(running?.card.steps.filter((step) => step.state === "active").map((step) => step.text)).toEqual([
      "定方案 · 方案老李",
      "写文章 · 文案小王",
    ]);
    room.tasks[1] = { ...task("sub-1", "root-1", "w", "completed") };
    teams.changed(id);
    expect(port.cards.at(-1)?.card.steps.filter((step) => step.state === "done")).toHaveLength(1);
    expect(port.cards.at(-1)?.stopped).toBe(false);
    // The handoff and the result are on the card: no line in the chat.
    expect(port.notes).toHaveLength(lines);
    const board = read(
      await teams.call({
        tool: "team_board",
        arguments: { action: "read" },
        agentId: "p",
        key: "k",
        roomId: id,
        byPerson: false,
      }),
    ).board;
    expect(board?.steps.map((step) => step.state)).toEqual(["doing", "done", "todo"]);
  });

  it("finishes with the lead's last answer when every task ended without team_done, and hides the members it made", async () => {
    const { id, room } = await started();
    room.tasks[0] = task("root-1", null, "p", "completed");
    room.messages.push(agentMessage("w", "draft"), agentMessage("p", "最终结果：文章和海报都好了"));
    teams.changed(id);
    await teams.settled();
    expect(teams.store.get(id)?.state).toBe("done");
    expect(port.delivered).toHaveLength(1);
    expect(port.delivered[0]).toMatchObject({ fromAgentId: "p", toAgentId: "me" });
    expect(port.delivered[0]?.text).toContain("最终结果：文章和海报都好了");
    expect(port.hidden).toEqual([{ agentId: "made-1", hidden: true }]);
    expect(port.notes.map((note) => note.text)).toContain("Team done in 1 min. The result follows.");
    teams.changed(id);
    await teams.settled();
    expect(port.delivered).toHaveLength(1);
  });

  it("stops the team when the same work fails twice, and tells the starter", async () => {
    const { id, room } = await started();
    room.tasks.push(task("sub-1", "root-1", "w", "failed"));
    teams.changed(id);
    expect(port.notes.at(-1)?.text).toContain("could not finish a piece of work");
    room.tasks.push(task("sub-2", "root-1", "w", "failed"));
    teams.changed(id);
    await teams.settled();
    expect(teams.store.get(id)?.state).toBe("failed");
    expect(port.commands.map((item) => `${item.type}:${item.taskId}`)).toEqual(["stop:root-1", "cancel:root-1"]);
    expect(port.delivered[0]?.text).toContain("同一件工作失败了两次");
    expect(port.notes.map((note) => note.text)).toContain("Team stopped: the same work failed twice.");
  });

  it("says once that the work waits when nothing runs and a task stopped", async () => {
    const { id, room } = await started();
    room.tasks[0] = task("root-1", null, "p", "paused");
    teams.changed(id);
    teams.changed(id);
    expect(port.notes.filter((note) => note.text.startsWith("Team · The work waits"))).toHaveLength(1);
  });

  it("stops when the room is archived", async () => {
    const { id, room } = await started();
    room.archived = true;
    teams.changed(id);
    await teams.settled();
    expect(teams.store.get(id)?.state).toBe("stopped");
    expect(port.notes.at(-2)?.text).toBe("Team stopped: its room was archived or deleted.");
  });

  it("stops the team at its deadline", async () => {
    vi.useFakeTimers();
    port.settingsOf = { ...HX_AUTO_DEFAULTS, teamMinutes: 30 };
    const { id } = await started();
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 10);
    await teams.settled();
    expect(teams.store.get(id)?.state).toBe("stopped");
    expect(port.notes.map((note) => note.text)).toContain("Team stopped: it reached its limit of 30 minutes.");
    expect(port.delivered[0]?.text).toContain("30 分钟的上限");
  });
});

describe("team_done and team_board", () => {
  it("lets only the lead send the result, which goes to the starter's chat", async () => {
    const { id } = await started();
    const done = (agentId: string) =>
      teams.call({
        tool: "team_done",
        arguments: { result: "全部完成", files: ["/w/a.md"] },
        agentId,
        key: "k",
        roomId: id,
        byPerson: false,
      });
    expect(read(await done("w")).status).toBe("refused");
    expect(read(await done("p")).status).toBe("done");
    expect(port.delivered[0]?.text).toContain("全部完成");
    expect(port.delivered[0]?.text).toContain("/w/a.md");
    expect(teams.store.get(id)?.steps.every((step) => step.state === "done")).toBe(true);
    expect(read(await done("p")).status).toBe("done");
    expect(port.delivered).toHaveLength(1);
  });

  it("keeps steps, facts and files on the board, and refuses outside a room", async () => {
    const { id } = await started();
    const board = (args: unknown) =>
      teams.call({ tool: "team_board", arguments: args, agentId: "w", key: "k", roomId: id, byPerson: false });
    await board({ action: "step", step: 2, state: "blocked", note: "等数据" });
    await board({ action: "fact", text: "价格用人民币" });
    await board({ action: "fact", text: "价格用人民币" });
    await board({ action: "file", path: "/w/a.md" });
    const read_ = read(await board({ action: "read" })).board;
    expect(read_?.steps[1]).toMatchObject({ state: "blocked", note: "等数据" });
    expect(read_?.facts).toEqual(["价格用人民币"]);
    expect(read_?.files).toEqual(["/w/a.md"]);
    expect(read_?.members.every((member) => member.computer)).toBe(true);
    expect(read(await board({ action: "step", step: 9, state: "done" })).status).toBe("refused");
    expect(read(await call("team_board", { action: "read" })).status).toBe("refused");
  });
});

describe("team (the starter's controls)", () => {
  it("passes the user's words to the lead or a member", async () => {
    const { id } = await started();
    expect(read(await call("team", { action: "message", text: "海报用蓝色" }, { key: "k2" })).to).toBe("方案老李");
    expect(read(await call("team", { action: "message", text: "加一段", member: "写作者" }, { key: "k3" })).to).toBe(
      "文案小王",
    );
    expect(port.posts.slice(1).map((item) => [item.channelId, item.toAgentIds[0], item.fromAgentId])).toEqual([
      [id, "p", "me"],
      [id, "w", "me"],
    ]);
    expect(read(await call("team", { action: "message", text: "x", member: "nobody" })).status).toBe("refused");
  });

  it("stops the team at the user's request and hides the members it made", async () => {
    const { id } = await started();
    expect(read(await call("team", { action: "stop" }, { key: "k2" })).status).toBe("stopped");
    expect(teams.store.get(id)?.state).toBe("stopped");
    expect(port.delivered).toHaveLength(0);
    expect(port.notes.map((note) => note.text)).toContain("Team stopped at your request.");
    expect(port.hidden).toEqual([{ agentId: "made-1", hidden: true }]);
    expect(read(await call("team", { action: "message", text: "x" })).status).toBe("refused");
  });

  it("swaps a member: the new one joins, takes its open work, and the old one leaves", async () => {
    const { id, room } = await started();
    room.tasks.push(task("sub-1", "root-1", "w", "running"));
    port.agentList.push(agent("n", "新人", "", ""));
    const result = read(await call("team", { action: "swap", member: "写作者", agentId: "n" }, { key: "k2" }));
    expect(result).toMatchObject({ status: "swapped", old: "文案小王", new: "新人" });
    expect(room.members).toEqual(["made-1", "p", "n"]);
    expect(room.tasks[1]?.ownerAgentId).toBe("n");
    expect(port.notes.at(-1)?.text).toBe("Team · 新人 took over from 文案小王.");
    const lead = read(await call("team", { action: "swap", member: "规划" }, { key: "k3" }));
    expect(lead.status).toBe("swapped");
    expect(room.lead).toBe("made-2");
    expect(teams.store.get(id)?.leadAgentId).toBe("made-2");
  });

  it("keeps the members it made, and gives the status of the newest team", async () => {
    const { id } = await started();
    expect(read(await call("team", { action: "keep" }, { key: "k2" })).members).toEqual(["设计师"]);
    await call("team", { action: "stop" }, { key: "k3" });
    expect(port.hidden).toEqual([{ agentId: "made-1", hidden: false }]);
    const status = read(await call("team", { action: "status" }, { byPerson: false })).team;
    expect(status).toMatchObject({ id, state: "stopped" });
    expect(read(await call("team", { action: "stop" }, { byPerson: false })).status).toBe("refused");
    expect(read(await call("team", { action: "status" }, { agentId: "w" })).status).toBe("refused");
  });
});

describe("preview and lines", () => {
  it("names the agent that would take each role, or null for a new member", () => {
    expect(
      teams.preview("me", [
        { name: "写作者", does: "写文章", work: "writing" },
        { name: "设计师", does: "画海报", work: "vision" },
      ]),
    ).toEqual(["文案小王", null]);
  });

  it("makes a completed system line of the channel-change kind", () => {
    expect(hxTeamLine("x", new Date("2026-11-14T00:00:00Z"))).toMatchObject({
      author: "system",
      source: "system",
      status: "completed",
      itemType: "channel-change",
      text: "x",
    });
  });

  it("answers before the host is ready", async () => {
    const lone = new HxTeams(new HxTeamStore());
    expect(
      read(await lone.call({ tool: "team", arguments: {}, agentId: "a", key: "k", roomId: null, byPerson: true }))
        .status,
    ).toBe("refused");
    expect(lone.preview("a", [{ name: "x", does: "y", work: "chat" }])).toEqual([]);
  });
});

describe("members at once (v1.6.7)", () => {
  it("counts one member for each 2 GB of memory, from 2 to 10", () => {
    expect(hxTeamParallel(1)).toBe(2);
    expect(hxTeamParallel(4 * 2 ** 30)).toBe(2);
    expect(hxTeamParallel(16 * 2 ** 30)).toBe(8);
    expect(hxTeamParallel(256 * 2 ** 30)).toBe(10);
  });

  it("gives out no more work at once than this computer holds, and says so in the brief", async () => {
    teams.parallel = () => 1;
    const { id, room } = await started();
    expect(port.posts[0]?.text).toContain("同时干活：最多 1 个成员");
    expect(port.posts[0]?.text).toContain("连接器：这台电脑上的所有助手共用同一份连接器");
    room.tasks.push(task("sub-1", "root-1", "w", "running"));
    expect(teams.checkHandoff(id, "channel_assign", { task: FORM })).toContain("这台电脑最多同时 1 个");
    // A transfer gives no more work: it moves work that runs already.
    expect(teams.checkHandoff(id, "channel_transfer", { task: FORM })).toBeNull();
    room.tasks[1] = task("sub-1", "root-1", "w", "completed");
    expect(teams.checkHandoff(id, "channel_assign", { task: FORM })).toBeNull();
  });
});

describe("limits the user names in the chat (v1.6.7)", () => {
  it("come before the agent's settings at the start, and change a running team", async () => {
    const { id } = await started({ limits: { minutes: 30, rounds: 6 } });
    expect(teams.store.get(id)?.limits).toMatchObject({ minutes: 30, rounds: 6, members: 20 });
    const changed = read(await call("team", { action: "limits", minutes: 90, rounds: 12 }));
    expect(changed.status).toBe("changed");
    expect(teams.store.get(id)?.limits).toMatchObject({ minutes: 90, rounds: 12 });
    expect(Date.parse(teams.store.get(id)?.deadline ?? "") - Date.parse(teams.store.get(id)?.createdAt ?? "")).toBe(
      90 * 60_000,
    );
    // The card shows the new limits.
    expect(port.cards.at(-1)?.card.title).toBe("Team · handoffs 0/12 · 0/90 min");
    const empty = read(await call("team", { action: "limits" }));
    expect(empty.status).toBe("refused");
  });
});

describe("the progress card of a team (v1.6.7)", () => {
  it("names the member of each step, marks a waiting step, and is all done when the team is done", async () => {
    const { id } = await started();
    const team = teams.store.get(id);
    if (!team) throw new Error("no team");
    const steps = team.steps.map((step, index) => ({
      ...step,
      state: index === 0 ? ("blocked" as const) : step.state,
    }));
    const waiting = hxTeamCard({ ...team, steps }, 3, 12);
    expect(waiting.title).toBe("Team · handoffs 3/80 · 12/240 min");
    expect(waiting.steps[0]?.text.endsWith("（等待中）")).toBe(true);
    expect(waiting.steps[0]?.state).toBe("pending");
    const done = hxTeamCard({ ...team, state: "done" }, 3, 12);
    expect(done.steps.every((step) => step.state === "done")).toBe(true);
  });
});
