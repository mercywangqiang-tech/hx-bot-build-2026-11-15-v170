// HXBot 真实模型检查（v1.6.7）：给团队用的一台“假电脑”。智能体、协作房间和房间里的任务都在内存里，
// 团队的代码（src/backend/hx-team）是真的，模型也是真的；成员干活的结果由检查程序代写。
import { HX_AUTO_DEFAULTS, type HxAutoModelSettings } from "@hxbot/contracts/hx-auto-model";
import type { HxProgressCard } from "@hxbot/contracts/hx-progress";
import type { ChannelMessage, ChannelTask } from "@hxbot/contracts/ipc";
import type { HxTeamAgent, HxTeamPort } from "../hx-team/service";

interface HxWorldRoom {
  name: string;
  instructions: string;
  members: string[];
  lead: string;
  tasks: ChannelTask[];
  messages: ChannelMessage[];
}

/** An agent of the world, with what the lead reads about it. */
export function hxWorldAgent(id: string, name: string, title: string, description: string): HxTeamAgent {
  return {
    id,
    name,
    title,
    description,
    hidden: false,
    busy: false,
    workspacePath: `/check/${id}`,
    model: "opencode/free",
    computerUse: false,
  };
}

export class HxTeamWorld implements HxTeamPort {
  readonly agentList: HxTeamAgent[];
  settingsOf: HxAutoModelSettings = HX_AUTO_DEFAULTS;
  readonly rooms = new Map<string, HxWorldRoom>();
  readonly posts: Array<{ channelId: string; fromAgentId: string; text: string; toAgentIds: string[] }> = [];
  readonly delivered: Array<{ fromAgentId: string; toAgentId: string; text: string }> = [];
  readonly notes: Array<{ agentId: string; text: string }> = [];
  readonly cards: Array<{ agentId: string; id: string; card: HxProgressCard; stopped: boolean }> = [];
  readonly commands: Array<{ type: string; taskId: string; recipientAgentId: string | null }> = [];
  readonly errors: string[] = [];
  #made = 0;
  #sequence = 0;

  constructor(agents: HxTeamAgent[]) {
    this.agentList = agents;
  }

  agents() {
    return this.agentList;
  }
  settings() {
    return this.settingsOf;
  }
  roleModel() {
    return { provider: "opencode" as const, model: "opencode/free", name: "OpenCode free" };
  }
  async createAgent(input: { name: string; title: string; description: string }) {
    this.#made += 1;
    const id = `made-${this.#made}`;
    this.agentList.push(hxWorldAgent(id, input.name, input.title, input.description));
    return { id, name: input.name };
  }
  async setHidden(agentId: string, hidden: boolean) {
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
    this.rooms.set(input.channelId, {
      name: input.name,
      instructions: input.instructions,
      members: [...input.memberIds],
      lead: input.leadAgentId,
      tasks: [],
      messages: [],
    });
  }
  async changeMembers(input: { channelId: string; add: string[]; remove: string[]; leadAgentId?: string }) {
    const room = this.rooms.get(input.channelId);
    if (!room) throw new Error("The room is gone.");
    room.members = [...room.members.filter((id) => !input.remove.includes(id)), ...input.add];
    if (input.leadAgentId) room.lead = input.leadAgentId;
  }
  async post(input: { channelId: string; fromAgentId: string; text: string; toAgentIds: string[] }) {
    this.posts.push(input);
    const room = this.rooms.get(input.channelId);
    if (!room) return;
    const message = this.#message(input.channelId, "member", input.fromAgentId, input.text);
    room.messages.push(message);
    // The first post is the brief: it is the root task of the lead.
    if (!room.tasks.length)
      room.tasks.push(
        this.#task(input.channelId, `root-${room.messages.length}`, null, room.lead, message.id, input.text),
      );
  }
  room(channelId: string) {
    const room = this.rooms.get(channelId);
    return room
      ? { exists: true, archived: false, tasks: room.tasks, messages: room.messages }
      : { exists: false, archived: false, tasks: [], messages: [] };
  }
  async command(input: {
    channelId: string;
    type: "stop" | "cancel" | "reassign";
    taskId: string;
    recipientAgentId: string | null;
  }) {
    this.commands.push(input);
    const task = this.rooms.get(input.channelId)?.tasks.find((item) => item.id === input.taskId);
    if (!task) return;
    if (input.type === "stop") task.state = "paused";
    if (input.type === "cancel") task.state = "cancelled";
    if (input.type === "reassign") task.ownerAgentId = input.recipientAgentId;
  }
  async deliver(input: { fromAgentId: string; toAgentId: string; text: string }) {
    this.delivered.push(input);
  }
  note(agentId: string, text: string) {
    this.notes.push({ agentId, text });
  }
  progress(agentId: string, id: string, card: HxProgressCard, stopped: boolean) {
    this.cards.push({ agentId, id, card, stopped });
  }
  error(code: string, error: unknown) {
    this.errors.push(`${code}: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ------------------------------------------------------------ what the check does in the room

  /** The id of the request message of the room: the brief. */
  requestId(channelId: string): string {
    return this.rooms.get(channelId)?.messages[0]?.id ?? "";
  }

  /** A subtask that the channel accepted, as `channel_assign` makes it. */
  assign(channelId: string, input: { recipientAgentId: string; task: string; expectedResult: string }): ChannelTask {
    const room = this.rooms.get(channelId);
    if (!room) throw new Error("The room is gone.");
    const root = room.tasks[0];
    const id = `task-${room.tasks.length + 1}`;
    const task = this.#task(
      channelId,
      id,
      root?.id ?? null,
      input.recipientAgentId,
      root?.requestMessageId ?? "",
      input.task,
    );
    task.expectedResult = input.expectedResult;
    room.tasks.push(task);
    return task;
  }

  /** A member answers its subtask. */
  finish(channelId: string, taskId: string, text: string): void {
    const room = this.rooms.get(channelId);
    const task = room?.tasks.find((item) => item.id === taskId);
    if (!room || !task) return;
    task.state = "completed";
    room.messages.push(this.#message(channelId, "agent", task.ownerAgentId ?? "", text, task.id));
  }

  /** The lead's own message in the room. */
  say(channelId: string, agentId: string, text: string): void {
    this.rooms.get(channelId)?.messages.push(this.#message(channelId, "agent", agentId, text));
  }

  /** The root task ends, as the channel ends it after the lead's last answer. */
  close(channelId: string): void {
    const root = this.rooms.get(channelId)?.tasks[0];
    if (root) root.state = "completed";
  }

  #task(
    channelId: string,
    id: string,
    parentTaskId: string | null,
    ownerAgentId: string | null,
    requestMessageId: string,
    instruction: string,
  ): ChannelTask {
    return {
      id,
      channelId,
      parentTaskId,
      rootTaskId: parentTaskId ?? id,
      ownerAgentId,
      requestMessageId,
      instruction,
      attachmentDraftIds: [],
      expectedResult: "",
      sourceMessageIds: [],
      dependencies: [],
      resources: [],
      state: "running",
      revision: 0,
      assignmentCount: 0,
      error: null,
    };
  }

  #message(
    channelId: string,
    kind: "member" | "agent",
    authorId: string,
    text: string,
    taskId: string | null = null,
  ): ChannelMessage {
    this.#sequence += 1;
    const name = this.agentList.find((agent) => agent.id === authorId)?.name ?? authorId;
    return {
      id: `msg-${this.#sequence}`,
      channelId,
      sequence: this.#sequence,
      author: { kind, id: authorId, name },
      taskId,
      superseded: false,
      message: {
        id: `c-${this.#sequence}`,
        author: kind === "agent" ? "assistant" : "user",
        source: kind === "agent" ? "agent" : "user",
        text,
        createdAt: new Date().toISOString(),
        status: "completed",
      },
    };
  }
}
