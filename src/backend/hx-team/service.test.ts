import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HX_AUTO_DEFAULTS, type HxAutoModelSettings } from "@hxbot/contracts/hx-auto-model";
import type { HxProgressCard } from "@hxbot/contracts/hx-progress";
import type { ChannelMessage, ChannelTask } from "@hxbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type HxFlowCandidate, hxFlow } from "../hx-flow/ledger";
import { hxCapacityLine } from "./protocol";
import {
  type HxTeamAgent,
  type HxTeamAnswer,
  type HxTeamCall,
  type HxTeamPort,
  HxTeams,
  hxTeamCard,
  hxTeamCardId,
  hxTeamLine,
} from "./service";
import { HxTeamStore } from "./store";

/** A candidate of the ledger with no team; a test sets what it needs. */
function candidate(): HxFlowCandidate {
  return { lane: "w", tier: 2, readyAt: 0, teamId: null, order: 0, batch: null, difficulty: null, dependents: 0 };
}

function fail(): never {
  throw new Error("missing");
}

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

/** Real work of the team: a tick each 30 seconds. */
async function work(minutes: number): Promise<void> {
  for (let tick = 0; tick < minutes * 2; tick += 1) {
    now += 30_000;
    await teams.tick();
  }
  await teams.settled();
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
  teams.close();
  hxFlow.attachScheduler(null);
  hxFlow.tick([]);
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

  it("refuses in a room, without a person, over a member limit the user named, and with a step of no role", async () => {
    expect(read(await call("start_team", CARD, { roomId: "room" })).status).toBe("refused");
    expect(read(await call("start_team", CARD, { byPerson: false })).status).toBe("refused");
    // v1.7.1 (TEAM-01): a saved setting is no limit; only the user's words for this team are.
    port.settingsOf = { ...HX_AUTO_DEFAULTS, teamMembers: 2 };
    expect(String(read(await call("start_team", { ...CARD, limits: { members: 2 } })).reason)).toContain(
      "at most 2 members",
    );
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

  it("takes every full form however many handoffs and however long the team runs (v1.7.1, CONC-04)", async () => {
    port.settingsOf = { ...HX_AUTO_DEFAULTS, teamRounds: 10, teamMinutes: 30 };
    const { id, room } = await started();
    for (let index = 0; index < 120; index += 1) room.tasks.push(task(`sub-${index}`, "root-1", "w", "running"));
    teams.changed(id);
    now += 3 * 60 * 60_000;
    expect(teams.checkHandoff(id, "channel_assign", { task: FORM })).toBeNull();
    expect(teams.checkHandoff(id, "channel_transfer", { task: FORM })).toBeNull();
    expect(teams.store.get(id)?.state).toBe("running");
  });

  it("refuses handoffs only past a handoff limit that the user named", async () => {
    const { id, room } = await started({ limits: { rounds: 10 } });
    for (let index = 0; index < 10; index += 1) room.tasks.push(task(`sub-${index}`, "root-1", "w", "completed"));
    expect(teams.checkHandoff(id, "channel_transfer", { task: FORM })).toContain("10 次交接已经用完");
    expect(port.notes.at(-1)?.text).toBe(
      "Team · It reached its limit of 10 handoffs; the lead finishes with what it has.",
    );
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
    // v1.7.1: no limits on the card.
    expect(running?.card.title).toBe("Team · 1 handoffs · 0 min");
    expect(running?.card.steps.map((step) => step.state)).toContain("active");
    // The lead's step and the writer's step both run now; each names its member.
    const stepLines = (steps: readonly { text: string; state: string }[] | undefined) =>
      (steps ?? []).filter((step) => step.text.includes(" · "));
    expect(
      stepLines(running?.card.steps)
        .filter((step) => step.state === "active")
        .map((step) => step.text),
    ).toEqual(["定方案 · 方案老李", "写文章 · 文案小王"]);
    // v1.7.4 (CONC-09): after the steps, one line for each member; the lead's work is the team's goal.
    const members = (running?.card.steps ?? []).filter((step) => !step.text.includes(" · ")).map((step) => step.text);
    expect(members).toContain("文案小王: doing “写摘要”");
    expect(members.some((line) => line.startsWith("方案老李: doing “") && !line.includes("【协作任务】"))).toBe(true);
    expect(members.filter((line) => line.endsWith(": free"))).toHaveLength(members.length - 2);
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

  it("shows each member's place in the queue with about how long (v1.7.4, CONC-09-A2)", async () => {
    const { id, room } = await started();
    // Two pieces of the lead wait before the writer's: the writer is third.
    room.tasks.push(task("sub-a", "root-1", "p", "queued"), task("sub-b", "root-1", "p", "queued"));
    room.tasks.push(task("sub-c", "root-1", "w", "queued"));
    teams.changed(id);
    teams.refreshCards();
    const lines = (port.cards.at(-1)?.card.steps ?? []).map((step) => step.text);
    // place × the recent turn time (2 min before any turn ended) ÷ the places (1 with no machine limit).
    expect(lines).toContain("文案小王: queued (place 3, about 6 min)");
    // Nothing moved: the card is not written again.
    const written = port.cards.length;
    teams.refreshCards();
    expect(port.cards.length).toBe(written);
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

  it("has no deadline of the clock, and stops at the minutes of real work that the user named", async () => {
    const { id: open } = await started();
    now += 3 * 60 * 60_000;
    await teams.tick();
    await teams.settled();
    expect(teams.store.get(open)?.state).toBe("running");
    teams.store.save({ ...(teams.store.get(open) ?? fail()), state: "done" });
    const id =
      read(await call("start_team", { ...CARD, limits: { minutes: 30 } }, { key: "turn-2:call-1" })).team?.id ?? "";
    // Real work: a turn of the team runs. Waiting in the queue does not count.
    await teams.tick();
    now += 20 * 60_000;
    await teams.tick();
    expect(teams.store.get(id)?.state).toBe("running");
    hxFlow.attachScheduler({ limit: () => 4, running: () => ["w"] });
    hxFlow.started("w", { ...candidate(), teamId: id }, null);
    for (let minute = 0; minute < 61; minute += 1) {
      now += 30_000;
      await teams.tick();
    }
    await teams.settled();
    expect(teams.store.get(id)?.state).toBe("stopped");
    expect(port.notes.map((note) => note.text)).toContain("Team stopped: it reached its limit of 30 minutes.");
    expect(port.delivered.at(-1)?.text).toContain("30 分钟实际干活时间");
  });

  it("pauses with G1 after 30 minutes of real work with no progress (v1.7.1, CONC-10-A2)", async () => {
    const { id } = await started();
    hxFlow.attachScheduler({ limit: () => 4, running: () => ["w"] });
    hxFlow.started("w", { ...candidate(), teamId: id }, null);
    await work(29);
    expect(teams.store.get(id)?.guard?.paused).toBeNull();
    await work(1.5);
    expect(teams.store.get(id)?.guard?.paused?.guard).toBe("G1");
  });

  it("goes on after the user answers a G1 pause: continue counts again from 0, finish wraps up", async () => {
    const { id } = await started();
    hxFlow.attachScheduler({ limit: () => 4, running: () => ["w"] });
    hxFlow.started("w", { ...candidate(), teamId: id }, null);
    await work(30.5);
    expect(teams.store.get(id)?.guard?.paused?.guard).toBe("G1");
    expect(read(await call("team", { action: "continue" }, { key: "k2" })).status).toBe("continued");
    expect(teams.store.get(id)?.guard?.paused).toBeNull();
    await work(29);
    expect(teams.store.get(id)?.guard?.paused).toBeNull();
    await work(1.5);
    expect(teams.store.get(id)?.guard?.paused?.guard).toBe("G1");
    expect(read(await call("team", { action: "finish" }, { key: "k3" })).status).toBe("wrapping-up");
    const team = teams.store.get(id);
    expect(team?.guard?.paused).toBeNull();
    expect(team?.guard?.wrapUp).toBe(true);
    expect(team?.state).toBe("running");
    // The lead hears it in the room: no new work, hand back what the team has.
    expect(port.posts.at(-1)?.text).toContain("hxbot.team_done");
    expect(port.posts.at(-1)?.toAgentIds).toEqual([team?.leadAgentId]);
  });

  it("takes a new file in the shared folder for progress at the G1 check", async () => {
    const { id } = await started();
    hxFlow.attachScheduler({ limit: () => 4, running: () => ["w"] });
    hxFlow.started("w", { ...candidate(), teamId: id }, null);
    await work(10);
    writeFileSync(join(teams.store.get(id)?.folder ?? fail(), "draft.md"), "a draft");
    // At 30 minutes the folder changed: the count starts again, and G1 comes 30 minutes later.
    await work(25);
    expect(teams.store.get(id)?.guard?.paused).toBeNull();
    await work(26);
    expect(teams.store.get(id)?.guard?.paused?.guard).toBe("G1");
  });

  // v1.7.3: the walk runs in the main process; a folder of packages must not hold the app up.
  it("reads a team folder with 20,000 package files quickly, and still sees the team's own new file", async () => {
    const { id } = await started();
    const shared = teams.store.get(id)?.folder ?? fail();
    for (let a = 0; a < 20; a += 1) {
      const deep = join(shared, "node_modules", `pkg${a}`, "lib");
      mkdirSync(deep, { recursive: true });
      for (let b = 0; b < 1000; b += 1) writeFileSync(join(deep, `f${b}.js`), "");
    }
    hxFlow.attachScheduler({ limit: () => 4, running: () => ["w"] });
    hxFlow.started("w", { ...candidate(), teamId: id }, null);
    const started_ = performance.now();
    await work(10);
    writeFileSync(join(shared, "report.md"), "the team's own work");
    await work(25);
    expect(performance.now() - started_).toBeLessThan(5_000);
    expect(teams.store.get(id)?.guard?.paused).toBeNull();
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

describe("the capacity of this computer (v1.7.1, CONC-12)", () => {
  it("tells the lead to give all the work out and says the state of the computer, with no limits", async () => {
    hxFlow.attachScheduler({ limit: () => 3, running: () => [] });
    const { id, room } = await started();
    const brief = port.posts[0]?.text ?? "";
    expect(brief).toContain("把能分的都分出去，写清依赖。电脑会按容量安排同时做几件；不要等，也不要重派。");
    expect(brief).toContain("电脑现在：同时能做 3 件");
    expect(brief).not.toContain("上限");
    expect(port.rooms.get(id)?.instructions).toContain("不要等，也不要重派");
    expect(port.rooms.get(id)?.instructions).not.toContain("次交接，");
    // The reply to an assignment says its place in the queue.
    room.tasks.push(task("sub-1", "root-1", "w", "queued"));
    teams.changed(id);
    const reply = teams.withQueueLine(id, "channel_assign", { accepted: true, taskId: "sub-1" });
    expect(JSON.stringify(reply)).toMatch(/已排队，第 \d+ 位：电脑同时在做 0 件，约 \d+ 分钟。/u);
    expect(JSON.stringify(reply)).toContain("电脑现在：同时能做 3 件");
    expect(teams.withQueueLine(id, "channel_result", { accepted: true })).toEqual({ accepted: true });
  });

  it("puts one capacity line, of numbers and model names only, in the brief, the reply and the board (CONC-12-A1)", async () => {
    const line = hxCapacityLine("zh", {
      budget: 3,
      running: 1,
      waiting: 4,
      bound: null,
      limitedModels: ["GLM-5.3-Flash Free"],
      screenBusy: false,
    });
    // B, the running and the waiting work, and the models that wait for a usage limit: nothing else.
    expect(line).toBe("电脑现在：同时能做 3 件，在做 1 件，排队 4 件；在等用量的模型：GLM-5.3-Flash Free。");
    hxFlow.attachScheduler({ limit: () => 3, running: () => [] });
    const { id, room } = await started();
    const now = hxCapacityLine("zh", hxFlow.capacity());
    expect(port.posts[0]?.text).toContain(now);
    room.tasks.push(task("sub-1", "root-1", "w", "queued"));
    teams.changed(id);
    expect(JSON.stringify(teams.withQueueLine(id, "channel_assign", { accepted: true, taskId: "sub-1" }))).toContain(
      hxCapacityLine("zh", hxFlow.capacity()),
    );
    const board = read(
      await teams.call({
        tool: "team_board",
        arguments: { action: "read" },
        agentId: "w",
        key: "k-board",
        roomId: id,
        byPerson: false,
      }),
    );
    expect(JSON.stringify(board)).toContain("电脑现在：同时能做 3 件");
  });

  it("starts a team of 25 roles with no refusal (CONC-04)", async () => {
    const roles = Array.from({ length: 25 }, (_, index) => ({
      name: `角色${index + 1}`,
      kind: index === 0 ? "plan" : "do",
      does: `做第 ${index + 1} 部分`,
      work: "writing",
    }));
    const result = read(
      await call("start_team", { goal: "写一份 25 部分的报告", roles, steps: [{ title: "写", role: "角色1" }] }),
    );
    expect(result.status).toBe("started");
    expect(teams.store.get(result.team?.id ?? "")?.limits).toMatchObject({
      members: 25,
      minutes: 1440,
      rounds: 1_000_000,
    });
  });
});

describe("limits the user names in the chat (v1.7.1, TEAM-01)", () => {
  it("count only for this team, change a running team, and only the user changes them", async () => {
    const { id } = await started({ limits: { minutes: 30, rounds: 6 } });
    expect(teams.store.get(id)?.limits).toMatchObject({ minutes: 30, rounds: 6, members: 3 });
    expect(teams.store.get(id)?.stated).toEqual({ minutes: 30, rounds: 6 });
    const changed = read(await call("team", { action: "limits", minutes: 90, rounds: 12, spend: 20 }));
    expect(changed.status).toBe("changed");
    expect(teams.store.get(id)?.limits).toMatchObject({ minutes: 90, rounds: 12 });
    expect(teams.store.get(id)?.stated).toEqual({ minutes: 90, rounds: 12, spendYuan: 20 });
    expect(Date.parse(teams.store.get(id)?.deadline ?? "") - Date.parse(teams.store.get(id)?.createdAt ?? "")).toBe(
      90 * 60_000,
    );
    // A model in the room cannot change them, nor a turn that no person started.
    expect(read(await call("team", { action: "limits", rounds: 1000 }, { roomId: id })).status).toBe("refused");
    expect(read(await call("team", { action: "limits", rounds: 1000 }, { byPerson: false })).status).toBe("refused");
    expect(teams.store.get(id)?.limits.rounds).toBe(12);
    const empty = read(await call("team", { action: "limits" }));
    expect(empty.status).toBe("refused");
    const cleared = read(await call("team", { action: "limits", clear: true }));
    expect(cleared.status).toBe("changed");
    expect(teams.store.get(id)?.stated).toBeUndefined();
    expect(teams.store.get(id)?.limits).toMatchObject({ minutes: 1440, rounds: 1_000_000 });
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
    expect(waiting.title).toBe("Team · 3 handoffs · 12 min");
    expect(waiting.steps[0]?.text.endsWith("（等待中）")).toBe(true);
    expect(waiting.steps[0]?.state).toBe("pending");
    const done = hxTeamCard({ ...team, state: "done" }, 3, 12);
    expect(done.steps.every((step) => step.state === "done")).toBe(true);
  });
});
