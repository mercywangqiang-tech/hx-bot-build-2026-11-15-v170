// HXBot 协作（二）：多智能体无缝协作（v1.6.6）。
//
// The starter (the agent the user talks to) calls `start_team` after the user pressed Start on a
// proposal card. HXBot picks members by skill, makes members for the roles that no agent fits, opens a
// team room (a channel) with the lead, the members and the team rules, and gives the lead the brief.
// The starter is never a member: it stays with the user, who can ask it about the team, add words,
// stop it or swap a member (`team`). In the room, the members hand work over with a handoff form,
// keep the board (`team_board`), and the lead sends the result back (`team_done`). A watcher reads
// each change of the room: it writes short lines in the starter's chat, watches the team's progress
// (v1.7.1: no limits on members, time or handoffs; the guards of guards.ts), and finishes it with the
// lead's last message when the lead did not call `team_done`.
//
// Nothing here imports the agent service: `HxTeamPort` is what the host gives (agent-service.ts).
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HxAutoModelSettings, HxDifficulty, HxModelRef, HxNeed, HxWorkType } from "@hxbot/contracts/hx-auto-model";
import type { HxProgressCard } from "@hxbot/contracts/hx-progress";
import {
  AVATAR_HUES,
  CHANNEL_CHANGE_ITEM_TYPE,
  type ChannelMessage,
  type ChannelTask,
  type ConversationMessage,
} from "@hxbot/contracts/ipc";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { sourceText } from "@hxbot/i18n";
import { z } from "zod";
import { type HxFlowTeamTask, hxFlow } from "../hx-flow/ledger";
import { HX_FLOW_RELAXED_WEIGHT, HX_FLOW_URGENT_WEIGHT, HxFlowDifficultyTimes } from "../hx-flow/order";
import type { HxProgressWriter } from "../hx-progress/progress";
import { hxFormFiles, hxFormLabel, hxFormTemplate, hxMissingParts, hxReadForm, hxSaysNothing } from "./form";
import {
  type HxGuardId,
  type HxSpendReading,
  type HxTeamGuardState,
  hxDepth,
  hxGuardState,
  hxLoopMove,
  hxLoopReceive,
  hxProgress,
  hxSpendDue,
  hxSpread,
  hxUnanswered,
  hxWorkTick,
} from "./guards";
import { type HxMatchAgent, hxMatchRoles } from "./match";
import {
  hxCapacityLine,
  hxOneLine,
  hxResultMessage,
  hxRoomInstructions,
  hxRoomName,
  hxStoppedMessage,
  hxTeamBrief,
  hxTeamLanguage,
  hxTeamWords,
} from "./protocol";
import { hxTeamSkillLines, hxTeamSkills } from "./skills";
import {
  HX_TEAM_FACT_LIMIT,
  HX_TEAM_FILE_LIMIT,
  type HxStepState,
  type HxTeamMember,
  type HxTeamRecord,
  type HxTeamStated,
  HxTeamStore,
} from "./store";
import {
  HX_START_TEAM_TOOL,
  HX_TEAM_BOARD_TOOL,
  HX_TEAM_DONE_TOOL,
  HX_TEAM_OPEN_MINUTES,
  HX_TEAM_OPEN_ROUNDS,
  HX_TEAM_TOOL,
  startTeamSchema,
  teamBoardSchema,
  teamDoneSchema,
  teamSchema,
} from "./tools";

export interface HxTeamAgent extends HxMatchAgent {
  workspacePath: string;
  model: string;
  computerUse: boolean;
}

interface HxTeamRoomState {
  exists: boolean;
  archived: boolean;
  tasks: ChannelTask[];
  /** The latest messages, the oldest first. */
  messages: ChannelMessage[];
}

/** What the host gives the teams. Every write is a promise that rejects with a readable error. */
export interface HxTeamPort {
  agents(): HxTeamAgent[];
  settings(agentId: string): HxAutoModelSettings;
  /** The model for a role of a card, chosen from the starter's models, as the card shows it. */
  roleModel(
    agentId: string,
    role: { kind: "plan" | "do" | "check"; work: HxWorkType; difficulty: HxDifficulty; needs: readonly HxNeed[] },
  ): (HxModelRef & { name: string }) | null;
  /**
   * Makes a member for the team: a new agent with no first message, on `model` (or the starter's
   * model), with the starter's limits of access and Computer Use.
   */
  createAgent(input: {
    name: string;
    title: string;
    description: string;
    model: HxModelRef | null;
    starterAgentId: string;
  }): Promise<{ id: string; name: string }>;
  setHidden(agentId: string, hidden: boolean): Promise<void>;
  createRoom(input: {
    channelId: string;
    operationId: string;
    starterAgentId: string;
    name: string;
    title: string;
    instructions: string;
    memberIds: string[];
    leadAgentId: string;
    hue: number;
  }): Promise<void>;
  changeMembers(input: {
    channelId: string;
    operationId: string;
    actorAgentId: string;
    add: string[];
    remove: string[];
    leadAgentId?: string;
  }): Promise<void>;
  /** Posts a request into the room, as `send_to_channel` does. */
  post(input: {
    channelId: string;
    operationId: string;
    fromAgentId: string;
    text: string;
    toAgentIds: string[];
    paths: string[];
  }): Promise<void>;
  room(channelId: string): HxTeamRoomState;
  /** v1.7.1: the tasks of a room alone, without its messages. */
  tasks?(channelId: string): ChannelTask[];
  /** v1.7.1: whether the room exists and is archived, without its tasks and messages. */
  roomState?(channelId: string): { exists: boolean; archived: boolean };
  command(input: {
    channelId: string;
    operationId: string;
    actorAgentId: string;
    type: "stop" | "cancel" | "reassign";
    taskId: string;
    recipientAgentId: string | null;
  }): Promise<void>;
  /** A message from one agent to another agent's own chat, which starts a turn there. */
  deliver(input: { fromAgentId: string; toAgentId: string; text: string; key: string }): Promise<void>;
  /** A line in the agent's own chat, outside any turn. */
  note(agentId: string, text: string): void;
  /** The team's progress card in the starter's chat, written again in place (v1.6.7). */
  progress: HxProgressWriter;
  error(code: string, error: unknown): void;
  /**
   * v1.7.1 (G5): what the members of a team spent since it started, and how they pay: by use (API),
   * by plan, a local model, or an unknown price. Absent in a host with no usage records.
   */
  spend?(agentIds: readonly string[], since: string): Promise<HxSpendReading>;
}

/** One tool call, as the router gives it. */
export interface HxTeamCall {
  tool: string;
  arguments: unknown;
  agentId: string;
  /** The idempotency key of the call: a retry gets the same answer. */
  key: string;
  /** The room of the channel task that makes the call, if any. */
  roomId: string | null;
  /** Whether a person's message started the turn (not a routine, an agent or a member reply). */
  byPerson: boolean;
}

export interface HxTeamAnswer {
  success: boolean;
  contentItems: Array<{ type: "inputText"; text: string }>;
}

function answer(value: unknown, success = true): HxTeamAnswer {
  return { success, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

function refuse(reason: string): HxTeamAnswer {
  return answer({ status: "refused", reason }, false);
}

const WORK_WORDS: Record<HxWorkType, string> = {
  chat: "chat 问答",
  writing: "writing writer 写作 文案",
  "code-small": "code coding developer 代码 编程",
  "code-large": "code coding developer engineer 代码 编程 开发",
  data: "data analysis analyst 数据 分析 表格",
  vision: "image design 图片 设计 看图",
  "long-context": "research reading 资料 研究 阅读",
  reasoning: "planning plan 方案 规划",
  computer: "computer operator 电脑 操作",
};

/** The id of the room and of the team: a UUID from the call key, so a retried call finds the first one. */
function idOf(key: string): string {
  const hex = createHash("sha256").update(`hx-team:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Makes the shared folder of a team; false when it cannot (the team then names its files on the board). */
function makeFolder(path: string): boolean {
  try {
    mkdirSync(path, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** The key that tells two pieces of work apart: the first line of the instruction. */
function workKey(task: Pick<ChannelTask, "instruction">): string {
  const form = hxReadForm(task.instruction);
  return hxOneLine(form.goal ?? task.instruction, 160).toLowerCase();
}

const TERMINAL = new Set(["completed", "cancelled"]);
const STOPPED_KEYS = {
  user: "status.agent.hxTeam.stopped.user",
  retry: "status.agent.hxTeam.stopped.retry",
  room: "status.agent.hxTeam.stopped.room",
  cancelled: "status.agent.hxTeam.stopped.cancelled",
} as const;
const ACTIVE = new Set(["queued", "running", "waiting"]);
/** A dependency in one of these states lets the work that waits for it start. */
const SETTLED = new Set(["completed", "failed", "cancelled"]);
/** v1.7.1: how often the guards look at the running teams. */
const HX_TEAM_TICK_MS = 15_000;
/** The most files the progress check of a team folder reads (v1.7.3). */
const HX_TEAM_HASH_ENTRIES = 4_000;
/** Folders of packages and of version control: their files are no progress of the team's own. */
const HX_TEAM_HASH_SKIP: ReadonlySet<string> = new Set(["node_modules", ".git", ".venv", "venv", "__pycache__"]);

/** v1.7.1 (TEAM-01): the limits the user named in `start_team`, or undefined when there are none. */
function hxStated(
  limits:
    | {
        members?: number | undefined;
        minutes?: number | undefined;
        rounds?: number | undefined;
        spend?: number | undefined;
        noAsk?: boolean | undefined;
      }
    | undefined,
): HxTeamStated | undefined {
  if (!limits) return undefined;
  const stated: HxTeamStated = {};
  if (limits.members !== undefined) stated.members = limits.members;
  if (limits.minutes !== undefined) stated.minutes = limits.minutes;
  if (limits.rounds !== undefined) stated.rounds = limits.rounds;
  if (limits.spend !== undefined) stated.spendYuan = limits.spend;
  if (limits.noAsk !== undefined) stated.noAsk = limits.noAsk;
  return Object.keys(stated).length ? stated : undefined;
}

/** The open items of a form: its lines or parts, with none for "none". */
function countOpen(open: string | undefined): number {
  if (!open || hxSaysNothing(open)) return 0;
  return open.split(/[\n;；、]+/u).filter((item) => item.trim() && !hxSaysNothing(item)).length;
}

/** How many open pieces of work wait for this one, directly or through others (the critical path). */
function countDependents(taskId: string, tasks: readonly ChannelTask[]): number {
  const waiting = new Set<string>();
  const pending = [taskId];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    for (const task of tasks)
      if (!TERMINAL.has(task.state) && task.dependencies.includes(current) && !waiting.has(task.id)) {
        waiting.add(task.id);
        pending.push(task.id);
      }
  }
  return waiting.size;
}

export class HxTeams {
  readonly store: HxTeamStore;
  #port: HxTeamPort | null = null;
  /** v1.7.1: the guards look at each running team at this interval (G1, G5, G7, G8, G9). */
  #ticker: ReturnType<typeof setInterval> | null = null;
  /** v1.7.1: the tasks of each room, read again after each change of the room. */
  readonly #taskCache = new Map<string, ChannelTask[]>();
  #timesFile: string | null = null;
  #spendReading = false;
  readonly #chains = new Map<string, Promise<void>>();
  readonly #now: () => number;

  constructor(store = new HxTeamStore(), now: () => number = Date.now) {
    this.store = store;
    this.#now = now;
  }

  /** The host; null takes it away (a test that sets the shared one). */
  setPort(port: HxTeamPort | null): void {
    this.#port = port;
    // v1.7.1: the ledger reads the team rooms and their work (src/backend/hx-flow).
    hxFlow.attachTeams(port ? this.#flowView() : null);
  }

  /**
   * Opens the records, the times of each difficulty, and starts the guards. v1.7.1: a team has no
   * deadline of the clock; the guards count real work.
   */
  open(folder: string): void {
    this.store.open(folder);
    this.#timesFile = join(folder, "hx-flow-times.json");
    try {
      hxFlow.times = new HxFlowDifficultyTimes(JSON.parse(readFileSync(this.#timesFile, "utf8")));
    } catch {
      hxFlow.times = new HxFlowDifficultyTimes();
    }
    for (const team of this.store.running()) {
      if (team.weight)
        hxFlow.shares.setWeight(team.id, team.weight === "urgent" ? HX_FLOW_URGENT_WEIGHT : HX_FLOW_RELAXED_WEIGHT);
      // A record from before v1.7.1 had the limits of the settings; they were not named by the user.
      if (!team.guard) {
        team.limits = {
          ...team.limits,
          members: team.members.length,
          minutes: HX_TEAM_OPEN_MINUTES,
          rounds: HX_TEAM_OPEN_ROUNDS,
        };
        team.guard = hxGuardState();
        this.store.save(team);
      }
    }
    this.#startTicker();
  }

  /** Stops the guards; for tests and shutdown. */
  close(): void {
    if (this.#ticker) clearInterval(this.#ticker);
    this.#ticker = null;
  }

  isRoom(channelId: string): boolean {
    return this.store.byChannel(channelId) !== null;
  }

  /**
   * For the proposal card: the name of the agent that would take each role, or null for a member made
   * for the team. Before the host is ready, it knows no agent and names none.
   */
  preview(
    starterAgentId: string,
    roles: ReadonlyArray<{ name: string; does: string; work: HxWorkType }>,
  ): Array<string | null> {
    if (!this.#port) return [];
    const agents = this.#port.agents();
    return hxMatchRoles(
      roles.map((role) => ({ name: role.name, does: role.does, workWords: WORK_WORDS[role.work].split(" ") })),
      agents,
      starterAgentId,
    ).map((match) =>
      match.kind === "new" ? null : (agents.find((agent) => agent.id === match.agentId)?.name ?? null),
    );
  }

  // ------------------------------------------------------------------ tools

  async call(call: HxTeamCall): Promise<HxTeamAnswer> {
    const port = this.#port;
    if (!port) return refuse("Teams are not ready yet. Try again in a moment.");
    try {
      if (call.tool === HX_START_TEAM_TOOL) return await this.#start(port, call);
      if (call.tool === HX_TEAM_TOOL) return await this.#team(port, call);
      if (call.tool === HX_TEAM_BOARD_TOOL) return this.#board(call);
      if (call.tool === HX_TEAM_DONE_TOOL) return await this.#done(port, call);
      return refuse("This is not a team tool.");
    } catch (error) {
      return answer(
        { status: "failed", reason: error instanceof Error ? error.message.slice(0, 500) : "It did not work." },
        false,
      );
    }
  }

  async #start(port: HxTeamPort, call: HxTeamCall): Promise<HxTeamAnswer> {
    if (call.roomId) return refuse("In a team room, give work with channel_assign. start_team works in your own chat.");
    if (!call.byPerson) return refuse("Only a person's message can start a team. Ask the user in your own chat.");
    const parsed = startTeamSchema.safeParse(call.arguments);
    if (!parsed.success) return refuse(`${z.prettifyError(parsed.error)}\nCorrect the arguments and retry.`);
    const input = parsed.data;
    const id = idOf(call.key);
    const existing = this.store.get(id);
    if (existing) return answer({ status: "started", team: this.#summary(existing) });

    const saved = port.settings(call.agentId);
    // v1.7.1 (TEAM-01): a team has no limit on members, time or handoffs. Only the limits that the user
    // named for this team in the chat count, for this team only; the saved settings stay readable but
    // give no limit.
    const stated = hxStated(input.limits);
    if (stated?.members !== undefined && input.roles.length > stated.members)
      return refuse(
        `The user allows at most ${stated.members} members in this team. Merge roles so there are at most ${stated.members}, and retry.`,
      );
    const names = new Set(input.roles.map((role) => role.name));
    if (names.size !== input.roles.length) return refuse("Each role needs a different name.");
    const unknownStep = input.steps.find((step) => !names.has(step.role));
    if (unknownStep)
      return refuse(`The step "${unknownStep.title}" names the role "${unknownStep.role}", which is not in roles.`);

    const agents = port.agents();
    const starter = agents.find((agent) => agent.id === call.agentId);
    if (!starter) return refuse("The calling agent no longer exists.");
    const language = hxTeamLanguage(input.goal);
    const words = hxTeamWords(language);
    const roomName = hxRoomName(input.goal, language);
    const matches = hxMatchRoles(
      input.roles.map((role) => ({
        name: role.name,
        does: role.does,
        workWords: WORK_WORDS[role.work].split(" "),
        agentId: role.agentId,
      })),
      agents,
      starter.id,
    );

    // The members: a matched agent keeps its own model; a new one gets the model of its role.
    const members: HxTeamMember[] = [];
    const made: string[] = [];
    const taken = new Set(agents.map((agent) => agent.name));
    try {
      for (const [index, role] of input.roles.entries()) {
        const match = matches[index] ?? { kind: "new" as const };
        if (match.kind !== "new") {
          const agent = agents.find((candidate) => candidate.id === match.agentId);
          if (!agent) throw new Error("A chosen agent no longer exists.");
          members.push({
            agentId: agent.id,
            name: agent.name,
            role: role.name,
            kind: role.kind,
            temporary: false,
            model: agent.model,
            difficulty: role.difficulty ?? "mid",
          });
          continue;
        }
        const model = port.roleModel(starter.id, {
          kind: role.kind,
          work: role.work,
          difficulty: role.difficulty ?? "mid",
          needs: role.needs ?? [],
        });
        let name = role.name;
        for (let count = 2; taken.has(name); count += 1) name = `${role.name} ${count}`;
        taken.add(name);
        const created = await port.createAgent({
          name,
          title: words.temporaryTitle(roomName).slice(0, 120),
          description: role.does,
          model,
          starterAgentId: starter.id,
        });
        made.push(created.id);
        members.push({
          agentId: created.id,
          name: created.name,
          role: role.name,
          kind: role.kind,
          temporary: true,
          model: model?.name ?? starter.model,
          difficulty: role.difficulty ?? "mid",
        });
      }

      const leadIndex = Math.max(
        0,
        input.roles.findIndex((role) => role.kind === "plan"),
      );
      const lead = members[leadIndex] ?? members[0];
      if (!lead) return refuse("A team needs at least one role.");
      const now = this.#now();
      // Written as before, for an older version that reads the record (TEAM-01).
      const minutes = stated?.minutes ?? HX_TEAM_OPEN_MINUTES;
      const deadline = now + minutes * 60_000;
      const folderPath = join(
        starter.workspacePath,
        words.folder,
        `${roomName.replace(/[\\/:*?"<>|]/gu, "-").slice(0, 40)}-${id.slice(0, 4)}`,
      );
      const folder = makeFolder(folderPath) ? folderPath : null;
      // v1.6.7: the skills of every workspace in the team, for every member (skills.ts).
      const known = port.agents();
      const skills = await hxTeamSkills([
        { name: starter.name, workspacePath: starter.workspacePath },
        ...members.map((member) => ({
          name: member.name,
          workspacePath: known.find((agent) => agent.id === member.agentId)?.workspacePath ?? "",
        })),
      ]);
      const team: HxTeamRecord = {
        id,
        channelId: id,
        roomName,
        starterAgentId: starter.id,
        language,
        goal: input.goal,
        folder,
        leadAgentId: lead.agentId,
        members,
        steps: input.steps.map((step, index) => ({
          n: index + 1,
          title: step.title,
          role: step.role,
          together: step.together === true,
          state: "todo",
          note: "",
        })),
        facts: [],
        files: [],
        requests: [],
        createdAt: new Date(now).toISOString(),
        deadline: new Date(deadline).toISOString(),
        limits: {
          members: stated?.members ?? input.roles.length,
          minutes,
          rounds: stated?.rounds ?? HX_TEAM_OPEN_ROUNDS,
          temporary: saved.teamTemporary,
        },
        ...(stated ? { stated } : {}),
        guard: hxGuardState(),
        state: "running",
        endedAt: null,
        result: null,
        reason: null,
        seen: {},
        failures: {},
        delivered: false,
        skills,
      };
      await port.createRoom({
        channelId: id,
        operationId: `${call.key}:room`,
        starterAgentId: starter.id,
        name: roomName,
        title: hxOneLine(input.goal, 120),
        instructions: hxRoomInstructions({
          language,
          leadName: lead.name,
          starterName: starter.name,
          folder,
          ...(stated ? { stated } : {}),
        }),
        memberIds: members.map((member) => member.agentId),
        leadAgentId: lead.agentId,
        hue: AVATAR_HUES[Number.parseInt(id.slice(0, 2), 16) % AVATAR_HUES.length] ?? 215,
      });
      // Saved before the brief: the watcher of the first change of the room knows the team.
      this.#save(team);
      await port.post({
        channelId: id,
        operationId: `${call.key}:brief`,
        fromAgentId: starter.id,
        text: hxTeamBrief({
          language,
          goal: input.goal,
          starterName: starter.name,
          leadName: lead.name,
          roles: input.roles.map((role, index) => ({
            role: role.name,
            memberName: members[index]?.name ?? role.name,
            model: members[index]?.model ?? null,
            temporary: members[index]?.temporary === true,
            does: role.does,
          })),
          steps: input.steps.map((step) => ({ title: step.title, role: step.role, together: step.together === true })),
          apps: input.apps ?? [],
          confirm: input.confirm ?? [],
          folder,
          ...(stated ? { stated } : {}),
          skills: hxTeamSkillLines(skills, language),
          capacity: hxCapacityLine(language, hxFlow.capacity()),
        }),
        toAgentIds: [lead.agentId],
        paths: input.paths ?? [],
      });
      port.note(
        starter.id,
        sourceText("status.agent.hxTeam.started", {
          members: members.map((member) => member.name).join(language === "zh" ? "、" : ", "),
          lead: lead.name,
        }),
      );
      return answer({
        status: "started",
        team: this.#summary(team),
        next: "Tell the user in one or two lines that the team started, who is in it, and that progress and the result come back to this chat. Do not do the work here; end your turn.",
      });
    } catch (error) {
      // Members made for a team that did not start are hidden, so the list does not fill with them.
      for (const agentId of made) await port.setHidden(agentId, true).catch(() => undefined);
      throw error;
    }
  }

  /** The team a `team` call means: the one it names, or the newest the agent started. */
  #ownTeam(agentId: string, teamId: string | undefined): HxTeamRecord | null {
    if (teamId) {
      const team = this.store.get(teamId);
      return team && team.starterAgentId === agentId ? team : null;
    }
    return this.store.startedBy(agentId)[0] ?? null;
  }

  async #team(port: HxTeamPort, call: HxTeamCall): Promise<HxTeamAnswer> {
    if (call.roomId) return refuse("In a team room, use team_board and the channel tools.");
    const parsed = teamSchema.safeParse(call.arguments);
    if (!parsed.success) return refuse(`${z.prettifyError(parsed.error)}\nCorrect the arguments and retry.`);
    const input = parsed.data;
    const team = this.#ownTeam(call.agentId, input.teamId);
    if (!team) return refuse("You have not started a team with that id. start_team makes one.");
    if (input.action === "status") return answer({ status: "ok", team: this.#board_(team) });
    if (!call.byPerson) return refuse("Only a person's message can change a team. Ask the user in your own chat.");
    // v1.7.1 (G9): the user spoke about the team, so the spend reminders have an answer.
    const guard = this.#guard(team);
    guard.spend.unanswered = 0;
    if (input.action === "keep") return answer({ status: "kept", members: await this.#keep(port, team) });
    if (input.action === "limits") {
      // v1.7.1 (TEAM-01, G7): only the user changes the limits of a team, by saying so; a model cannot.
      const named =
        input.minutes !== undefined ||
        input.rounds !== undefined ||
        input.spend !== undefined ||
        input.noAsk !== undefined;
      if (!named && !input.clear) return refuse("Give minutes, rounds, spend or noAsk, or clear.");
      const stated: HxTeamStated = input.clear ? {} : { ...team.stated };
      if (input.minutes !== undefined) stated.minutes = input.minutes;
      if (input.rounds !== undefined) stated.rounds = input.rounds;
      if (input.spend !== undefined) stated.spendYuan = input.spend;
      if (input.noAsk !== undefined) stated.noAsk = input.noAsk;
      this.#setStated(team, stated);
      this.#save(team);
      return answer({ status: "changed", team: this.#summary(team) });
    }
    if (team.state !== "running") return refuse(`The team has ended (${team.state}). Start a new team for more work.`);
    if (input.action === "stop") {
      await this.#stop(port, team, "user", false);
      return answer({ status: "stopped", team: this.#summary(team) });
    }
    if (input.action === "priority") {
      // v1.7.1 (CONC-03): the weight of the team in the queue, until it ends.
      const level = input.level ?? "normal";
      if (level === "normal") delete team.weight;
      else team.weight = level;
      hxFlow.shares.setWeight(
        team.id,
        level === "urgent" ? HX_FLOW_URGENT_WEIGHT : level === "relaxed" ? HX_FLOW_RELAXED_WEIGHT : 1,
      );
      this.#save(team);
      port.note(
        team.starterAgentId,
        sourceText(
          level === "urgent"
            ? "status.agent.hxTeam.priority.urgent"
            : level === "relaxed"
              ? "status.agent.hxTeam.priority.relaxed"
              : "status.agent.hxTeam.priority.normal",
        ),
      );
      return answer({ status: "changed", priority: level });
    }
    if (input.action === "continue" || input.action === "finish") {
      // v1.7.1 (CONC-10): the user answered a pause. A pause only started no new work.
      const paused = guard.paused;
      guard.paused = null;
      guard.sinceProgressMs = 0;
      if (paused?.guard === "G9") guard.spend.unanswered = 0;
      if (paused?.guard === "G2") guard.moves = {};
      if (paused?.guard === "G3") guard.handoffs = [];
      if (input.action === "finish") {
        guard.wrapUp = true;
        const lead = this.#lead(team);
        if (lead)
          await port.post({
            channelId: team.channelId,
            operationId: `${call.key}:finish`,
            fromAgentId: team.starterAgentId,
            text:
              team.language === "zh"
                ? "用户要求收尾：不再分派新的工作。等在做的做完，用已有的结果调用 hxbot.team_done，并写明还有什么没做。"
                : "The user asks to wrap up: give out no new work. When the work that runs is done, call hxbot.team_done with what the team has, and say what is left.",
            toAgentIds: [lead.agentId],
            paths: [],
          });
      }
      this.#save(team);
      hxFlow.tick(undefined, true);
      port.note(
        team.starterAgentId,
        sourceText(input.action === "finish" ? "status.agent.hxTeam.wrapUp" : "status.agent.hxTeam.continued"),
      );
      return answer({ status: input.action === "finish" ? "wrapping-up" : "continued", team: this.#summary(team) });
    }
    if (input.action === "message") {
      if (!input.text) return refuse("Give text: the user's words for the team.");
      const to = input.member ? this.#member(team, input.member) : this.#lead(team);
      if (!to) return refuse(`No member of the team is "${input.member}". Use a role, a name or an agent id.`);
      await port.post({
        channelId: team.channelId,
        operationId: `${call.key}:message`,
        fromAgentId: team.starterAgentId,
        text: input.text,
        toAgentIds: [to.agentId],
        paths: [],
      });
      port.note(team.starterAgentId, sourceText("status.agent.hxTeam.message", { name: to.name }));
      return answer({ status: "sent", to: to.name });
    }
    // swap
    if (!input.member) return refuse("Give member: the role, name or agent id of the member to replace.");
    const old = this.#member(team, input.member);
    if (!old) return refuse(`No member of the team is "${input.member}".`);
    const replaced = await this.#swap(port, team, old, input.agentId, call.key);
    return answer({ status: "swapped", old: old.name, new: replaced.name, team: this.#summary(team) });
  }

  #board(call: HxTeamCall): HxTeamAnswer {
    const team = call.roomId ? this.store.byChannel(call.roomId) : null;
    if (!team) return refuse("team_board works in a task of a team room.");
    const parsed = teamBoardSchema.safeParse(call.arguments);
    if (!parsed.success) return refuse(`${z.prettifyError(parsed.error)}\nCorrect the arguments and retry.`);
    const input = parsed.data;
    if (input.action === "read") return answer({ status: "ok", board: this.#board_(team) });
    if (team.state !== "running") return refuse(`The team has ended (${team.state}).`);
    if (input.action === "step") {
      const step = team.steps.find((item) => item.n === input.step);
      if (!step || !input.state) return refuse(`Give step (1 to ${team.steps.length}) and state.`);
      // v1.7.1 (G1): a step of the plan that moves is progress.
      if (step.state !== input.state && input.state !== "blocked")
        hxProgress(this.#guard(team), this.#folderHash(team));
      step.state = input.state;
      if (input.note !== undefined) step.note = input.note;
    } else if (input.action === "fact") {
      if (!input.text) return refuse("Give text: the fact.");
      if (!team.facts.includes(input.text)) team.facts = [...team.facts, input.text].slice(-HX_TEAM_FACT_LIMIT);
    } else {
      if (!input.path) return refuse("Give path: the file.");
      this.#addFiles(team, [input.path]);
      hxProgress(this.#guard(team), this.#folderHash(team));
    }
    this.#save(team);
    return answer({ status: "saved", board: this.#board_(team) });
  }

  async #done(port: HxTeamPort, call: HxTeamCall): Promise<HxTeamAnswer> {
    const team = call.roomId ? this.store.byChannel(call.roomId) : null;
    if (!team) return refuse("team_done works in a task of a team room.");
    if (call.agentId !== team.leadAgentId)
      return refuse("Only the lead sends the result. Send yours to the lead with channel_result.");
    const parsed = teamDoneSchema.safeParse(call.arguments);
    if (!parsed.success) return refuse(`${z.prettifyError(parsed.error)}\nCorrect the arguments and retry.`);
    if (team.state === "done") return answer({ status: "done", next: "End your turn without repeating the result." });
    if (team.state !== "running") return refuse(`The team has ended (${team.state}).`);
    this.#addFiles(team, parsed.data.files ?? []);
    for (const step of team.steps) if (step.state !== "done") step.state = "done";
    await this.#finish(port, team, parsed.data.result);
    return answer({
      status: "done",
      next: "The result went to the user's chat. End your turn with one short line in the room; do not repeat the result.",
    });
  }

  // ------------------------------------------------------------------ checks in the room

  /**
   * The answer for a `channel_assign` or `channel_transfer` in a team room before the channel takes
   * it: null to go on, or the reason to refuse. v1.7.1 (CONC-04): only a form with a missing line is
   * refused. A busy computer, the time and the number of handoffs never refuse work: the work waits on
   * the board until the ledger gives it a place. Only a limit that the user named, or the user's
   * request to wrap up, stops new work. `turnId` is the lead's turn, the batch of the work (CONC-03).
   */
  checkHandoff(channelId: string, tool: string, args: unknown, turnId?: string): string | null {
    if (tool !== "channel_assign" && tool !== "channel_transfer") return null;
    const team = this.store.byChannel(channelId);
    if (team?.state !== "running") return null;
    const zh = team.language === "zh";
    const task = isDynamicRecord(args) ? args.task : null;
    if (typeof task !== "string") return null;
    const missing = hxMissingParts(task);
    if (missing.length)
      return zh
        ? `task 必须是交接单。缺少：${missing.map((key) => hxFormLabel(key, "zh")).join("、")}。按下面的格式重写，没有的写“无”：\n${hxFormTemplate("zh")}`
        : `The task must be a handoff form. Missing: ${missing.map((key) => hxFormLabel(key, "en")).join(", ")}. Write it again in this form, with none where there is nothing:\n${hxFormTemplate("en")}`;
    if (tool === "channel_assign" && this.#guard(team).wrapUp)
      return zh
        ? "用户要求收尾，不再分派新的工作。等在做的做完，用已有的结果调用 hxbot.team_done。"
        : "The user asked to wrap up: no new work. When the work that runs is done, call hxbot.team_done with what the team has.";
    const rounds = team.stated?.rounds;
    if (rounds !== undefined && this.#handoffs(team) >= rounds) {
      this.#port?.note(team.starterAgentId, sourceText("status.agent.hxTeam.rounds", { limit: rounds }));
      return zh
        ? `用户为这次定的 ${rounds} 次交接已经用完。带头的用已有的结果调用 hxbot.team_done，并写明还有什么没做。`
        : `The ${rounds} handoffs that the user named for this team are used. The lead calls hxbot.team_done with what the team has and says what is left.`;
    }
    if (tool === "channel_assign" && turnId) {
      const batches = { ...team.batches };
      batches[workKey({ instruction: task })] = turnId;
      // Only the latest: a batch matters for the work that waits now.
      team.batches = Object.fromEntries(Object.entries(batches).slice(-200));
    }
    this.#addFiles(team, hxFormFiles(hxReadForm(task)));
    this.#save(team);
    return null;
  }

  /**
   * v1.7.1 (CONC-04, CONC-12): the reply to an assignment in a team room says its place in the queue
   * and the state of this computer. Any other reply stays as it is.
   */
  withQueueLine(channelId: string, tool: string, result: unknown): unknown {
    const team = this.store.byChannel(channelId);
    if (team?.state !== "running" || tool !== "channel_assign" || !isDynamicRecord(result)) return result;
    if (result.accepted !== true || typeof result.taskId !== "string") return result;
    const zh = team.language === "zh";
    const capacity = hxFlow.capacity();
    const place = hxFlow.queuePlace(result.taskId);
    const task = this.#port?.room(channelId).tasks.find((item) => item.id === result.taskId);
    const running = capacity.running;
    let queue: string;
    if (place)
      queue = zh
        ? `已排队，第 ${place.place} 位：电脑同时在做 ${running} 件，约 ${place.minutes} 分钟。`
        : `Queued, place ${place.place}: this computer runs ${running} at the same time, about ${place.minutes} min.`;
    else if (task && task.state === "queued" && task.dependencies.length)
      queue = zh
        ? `已排队：等它依赖的工作做完再开始。电脑同时在做 ${running} 件。`
        : `Queued: it starts when the work it depends on is done. This computer runs ${running} at the same time.`;
    else
      queue = zh ? `已开始：电脑同时在做 ${running} 件。` : `Started: this computer runs ${running} at the same time.`;
    return { ...result, queue, capacity: hxCapacityLine(team.language, capacity) };
  }

  /** Saves the team and writes its progress card again (v1.6.7). It never throws. */
  #save(team: HxTeamRecord): void {
    this.store.save(team);
    const port = this.#port;
    if (!port) return;
    try {
      const minutes = Math.max(
        0,
        Math.round(((team.endedAt ? Date.parse(team.endedAt) : this.#now()) - Date.parse(team.createdAt)) / 60_000),
      );
      port.progress(
        team.starterAgentId,
        hxTeamCardId(team.id),
        hxTeamCard(team, this.#handoffs(team), minutes),
        team.state === "stopped" || team.state === "failed",
      );
    } catch (error) {
      port.error("hx_team_card_failed", error);
    }
  }

  /** The handoffs so far: each task below a request, and each change of owner. */
  #handoffs(team: HxTeamRecord): number {
    const port = this.#port;
    if (!port) return 0;
    const room = port.room(team.channelId);
    const subtasks = room.tasks.filter((task) => task.parentTaskId !== null).length;
    const transfers = Number(team.seen.__transfers ?? "0");
    return subtasks + transfers;
  }

  // ------------------------------------------------------------------ the watcher

  /** Runs after each change of a channel. It never throws. */
  changed(channelId: string): void {
    this.#taskCache.delete(channelId);
    const team = this.store.byChannel(channelId);
    const port = this.#port;
    if (team?.state !== "running" || !port) return;
    try {
      this.#observe(port, team);
    } catch (error) {
      port.error("hx_team_watch_failed", error);
    }
  }

  #observe(port: HxTeamPort, team: HxTeamRecord): void {
    // v1.7.1: the state and the tasks only; the messages are read when the team ends. The watcher runs
    // at each change of the room, so a heavy read here slows the main process (BUG-CONC-01).
    const state = port.roomState ? port.roomState(team.channelId) : port.room(team.channelId);
    if (!state.exists || state.archived) {
      this.#later(team, () => this.#stop(port, team, "room", true));
      return;
    }
    const room = { tasks: this.#tasks(port, team.channelId) };
    const guard = this.#guard(team);
    const at = this.#now();
    const parents = new Map(room.tasks.map((task) => [task.id, task.parentTaskId]));
    const names = (agentId: string | null) =>
      (agentId && team.members.find((member) => member.agentId === agentId)?.name) ||
      port.agents().find((agent) => agent.id === agentId)?.name ||
      "?";
    let changed = false;
    for (const task of room.tasks) {
      const previous = team.seen[task.id];
      const owner = task.ownerAgentId ?? "";
      const now = `${task.state}|${owner}`;
      if (previous === now) continue;
      changed = true;
      team.seen[task.id] = now;
      const [previousState, previousOwner] = previous ? previous.split("|") : [undefined, undefined];
      // v1.7.1 (CONC-10): the guards see each new piece of work and each piece that is done.
      if (previous === undefined && task.parentTaskId !== null) {
        const goal = hxReadForm(task.instruction).goal ?? task.instruction;
        if (hxSpread(guard, "open", hxDepth(task.id, parents))) this.#later(team, () => this.#spread(port, team));
        if (owner && hxLoopReceive(guard, owner, goal))
          this.#later(team, () => this.#pause(port, team, "G2", this.#reason(team, "G2same", names(owner))));
      }
      if (task.state === "running" && !team.timing?.[task.id]) team.timing = { ...team.timing, [task.id]: at };
      // v1.6.7: each handoff shows on the team's progress card, not as a line. A task that moves whole
      // to another member is rare and changes who answers, so it keeps its line.
      if (previousOwner && owner && previousOwner !== owner) {
        team.seen.__transfers = String(Number(team.seen.__transfers ?? "0") + 1);
        port.note(
          team.starterAgentId,
          sourceText("status.agent.hxTeam.handedOver", {
            from: names(previousOwner || null),
            to: names(owner),
            count: this.#handoffs(team),
          }),
        );
        // G2: the same work changes hands again with no file change and no open item closed.
        const folder = this.#folderHash(team);
        const openItems = countOpen(hxReadForm(task.instruction).open);
        if (hxLoopMove(guard, task.id, folder, openItems))
          this.#later(team, () => this.#pause(port, team, "G2", this.#reason(team, "G2moves", "")));
      }
      if (task.state === "running") this.#stepOf(team, owner, "todo", "doing");
      if (task.state === "completed" && previousState !== "completed" && task.parentTaskId !== null) {
        this.#stepOf(team, owner, "doing", "done");
        // Progress (G1), a finished piece (G3), and the time of its difficulty (CONC-03).
        hxProgress(guard, this.#folderHash(team));
        hxSpread(guard, "done", 0);
        const started = team.timing?.[task.id];
        const difficulty = team.members.find((member) => member.agentId === owner)?.difficulty;
        if (started && difficulty) {
          hxFlow.times.record(difficulty, at - started);
          this.#saveTimes();
        }
      }
      if (task.state === "failed" && previousState !== "failed") {
        const key = workKey(task);
        team.failures[key] = (team.failures[key] ?? 0) + 1;
        if (team.failures[key] >= 2) {
          this.#save(team);
          this.#later(team, () => this.#stop(port, team, "retry", true));
          return;
        }
        this.#stepOf(team, owner, "doing", "blocked");
        port.note(team.starterAgentId, sourceText("status.agent.hxTeam.failedOnce", { name: names(owner) }));
      }
    }
    const tasks = room.tasks;
    const open = tasks.filter((task) => !TERMINAL.has(task.state));
    const active = tasks.filter((task) => ACTIVE.has(task.state));
    // Stuck: no work goes on, and a task waits on a person (stopped or failed). Said once until it moves.
    const stuck = open.length > 0 && active.length === 0;
    if (stuck && team.seen.__stuck !== "1") {
      team.seen.__stuck = "1";
      changed = true;
      port.note(team.starterAgentId, sourceText("status.agent.hxTeam.stuck"));
    } else if (!stuck && team.seen.__stuck === "1") {
      team.seen.__stuck = "0";
      changed = true;
    }
    if (changed) this.#save(team);
    // Every task ended and no team_done came: the lead's last answer is the result.
    if (tasks.length > 0 && open.length === 0) {
      const roots = tasks.filter((task) => task.parentTaskId === null);
      if (roots.some((task) => task.state === "completed")) {
        const messages = port.room(team.channelId).messages;
        const last = [...messages]
          .reverse()
          .find((message) => message.author.kind === "agent" && message.author.id === team.leadAgentId);
        const anyAgent = [...messages].reverse().find((message) => message.author.kind === "agent");
        const result = (last ?? anyAgent)?.message.text?.trim() || "";
        this.#later(team, () => this.#finish(port, team, result));
      } else this.#later(team, () => this.#stop(port, team, "cancelled", true));
    }
  }

  /** Moves the first step of the member's role from one state to the next. */
  #stepOf(team: HxTeamRecord, agentId: string, from: HxStepState, to: HxStepState): void {
    const member = team.members.find((item) => item.agentId === agentId && !item.left);
    if (!member) return;
    const step = team.steps.find((item) => item.role === member.role && item.state === from);
    if (step) step.state = to;
  }

  // ------------------------------------------------------------------ endings

  async #finish(port: HxTeamPort, team: HxTeamRecord, result: string): Promise<void> {
    if (team.state !== "running") return;
    team.state = "done";
    team.result =
      result ||
      (team.language === "zh"
        ? "（带头的没有写结果，请打开协作房间查看。）"
        : "(The lead wrote no result. Open the team room.)");
    team.endedAt = new Date(this.#now()).toISOString();
    this.#save(team);
    hxFlow.forgetTeam(team.id);
    const minutes = Math.max(1, Math.round((this.#now() - Date.parse(team.createdAt)) / 60_000));
    port.note(team.starterAgentId, sourceText("status.agent.hxTeam.done", { minutes }));
    const lead = this.#lead(team);
    await this.#deliver(port, team, hxResultMessage(team, lead?.name ?? ""), "result");
    await this.#collapse(port, team);
  }

  /**
   * Stops every open task of the room and ends the team. `tell` sends the starter a message, so it
   * asks the user what to do next; a stop the user asked for needs none.
   */
  async #stop(
    port: HxTeamPort,
    team: HxTeamRecord,
    reason: "user" | "minutes" | "retry" | "room" | "cancelled",
    tell: boolean,
  ): Promise<void> {
    if (team.state !== "running") return;
    team.state = reason === "retry" ? "failed" : "stopped";
    team.endedAt = new Date(this.#now()).toISOString();
    const zh = team.language === "zh";
    team.reason = {
      user: zh ? "用户叫停了。" : "the user stopped it.",
      minutes: zh
        ? `到了你定的 ${team.stated?.minutes ?? team.limits.minutes} 分钟实际干活时间。`
        : `it reached the ${team.stated?.minutes ?? team.limits.minutes} minutes of real work that you named.`,
      retry: zh ? "同一件工作失败了两次。" : "the same work failed twice.",
      room: zh ? "协作房间被归档或删除了。" : "its room was archived or deleted.",
      cancelled: zh ? "房间里的工作被取消了。" : "its work was cancelled in the room.",
    }[reason];
    this.#save(team);
    hxFlow.forgetTeam(team.id);
    const room = port.room(team.channelId);
    if (room.exists && !room.archived) {
      const roots = room.tasks.filter((task) => task.parentTaskId === null && !TERMINAL.has(task.state));
      for (const task of roots) {
        try {
          if (task.state !== "paused" && task.state !== "failed")
            await port.command({
              channelId: team.channelId,
              operationId: `hx-team-stop:${team.id}:${task.id}`,
              actorAgentId: team.starterAgentId,
              type: "stop",
              taskId: task.id,
              recipientAgentId: null,
            });
          await port.command({
            channelId: team.channelId,
            operationId: `hx-team-cancel:${team.id}:${task.id}`,
            actorAgentId: team.starterAgentId,
            type: "cancel",
            taskId: task.id,
            recipientAgentId: null,
          });
        } catch (error) {
          port.error("hx_team_stop_failed", error);
        }
      }
    }
    port.note(
      team.starterAgentId,
      reason === "minutes"
        ? sourceText("status.agent.hxTeam.stopped.minutes", { minutes: team.stated?.minutes ?? team.limits.minutes })
        : sourceText(STOPPED_KEYS[reason]),
    );
    if (tell) await this.#deliver(port, team, hxStoppedMessage(team, team.reason), "stopped");
    await this.#collapse(port, team);
  }

  async #deliver(port: HxTeamPort, team: HxTeamRecord, text: string, kind: string): Promise<void> {
    const from = this.#lead(team)?.agentId ?? team.leadAgentId;
    try {
      await port.deliver({
        fromAgentId: from,
        toAgentId: team.starterAgentId,
        text,
        key: `hx-team:${team.id}:${kind}`,
      });
      team.delivered = true;
      this.#save(team);
    } catch (error) {
      port.error("hx_team_deliver_failed", error);
    }
  }

  /** Hides the members made for the team, unless the user keeps them. */
  async #collapse(port: HxTeamPort, team: HxTeamRecord): Promise<void> {
    if (team.limits.temporary === "keep") return;
    const temporary = team.members.filter((member) => member.temporary);
    if (!temporary.length) return;
    const hidden: string[] = [];
    for (const member of temporary) {
      try {
        await port.setHidden(member.agentId, true);
        hidden.push(member.name);
      } catch (error) {
        port.error("hx_team_hide_failed", error);
      }
    }
    if (hidden.length)
      port.note(
        team.starterAgentId,
        sourceText("status.agent.hxTeam.collapsed", { names: hidden.join(team.language === "zh" ? "、" : ", ") }),
      );
  }

  async #keep(port: HxTeamPort, team: HxTeamRecord): Promise<string[]> {
    team.limits.temporary = "keep";
    const kept: string[] = [];
    for (const member of team.members) {
      if (!member.temporary) continue;
      member.temporary = false;
      await port.setHidden(member.agentId, false).catch((error: unknown) => port.error("hx_team_keep_failed", error));
      kept.push(member.name);
    }
    this.#save(team);
    if (kept.length)
      port.note(
        team.starterAgentId,
        sourceText("status.agent.hxTeam.kept", { names: kept.join(team.language === "zh" ? "、" : ", ") }),
      );
    return kept;
  }

  async #swap(
    port: HxTeamPort,
    team: HxTeamRecord,
    old: HxTeamMember,
    agentId: string | undefined,
    key: string,
  ): Promise<HxTeamMember> {
    const agents = port.agents();
    let next: HxTeamMember;
    if (agentId) {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent || agent.hidden) throw new Error("No visible agent has that id. Get the ids from hxbot.list_agents.");
      if (agent.id === team.starterAgentId) throw new Error("You stay with the user; you cannot join your own team.");
      if (team.members.some((member) => member.agentId === agent.id && !member.left))
        throw new Error(`${agent.name} is in the team already.`);
      next = {
        agentId: agent.id,
        name: agent.name,
        role: old.role,
        kind: old.kind,
        temporary: false,
        model: agent.model,
      };
    } else {
      const words = hxTeamWords(team.language);
      const taken = new Set(agents.map((agent) => agent.name));
      let name = old.role;
      for (let count = 2; taken.has(name); count += 1) name = `${old.role} ${count}`;
      const starter = agents.find((agent) => agent.id === team.starterAgentId);
      const created = await port.createAgent({
        name,
        title: words.temporaryTitle(team.roomName).slice(0, 120),
        description: old.role,
        model: null,
        starterAgentId: team.starterAgentId,
      });
      next = {
        agentId: created.id,
        name: created.name,
        role: old.role,
        kind: old.kind,
        temporary: true,
        model: starter?.model ?? null,
      };
    }
    const wasLead = old.agentId === team.leadAgentId;
    await port.changeMembers({
      channelId: team.channelId,
      operationId: `${key}:add`,
      actorAgentId: team.starterAgentId,
      add: [next.agentId],
      remove: [],
      ...(wasLead ? { leadAgentId: next.agentId } : {}),
    });
    // The open work of the old member goes to the new one, in place; then the old one leaves.
    const room = port.room(team.channelId);
    for (const task of room.tasks)
      if (task.ownerAgentId === old.agentId && !TERMINAL.has(task.state))
        await port.command({
          channelId: team.channelId,
          operationId: `${key}:reassign:${task.id}`,
          actorAgentId: team.starterAgentId,
          type: "reassign",
          taskId: task.id,
          recipientAgentId: next.agentId,
        });
    await port.changeMembers({
      channelId: team.channelId,
      operationId: `${key}:remove`,
      actorAgentId: team.starterAgentId,
      add: [],
      remove: [old.agentId],
    });
    old.left = true;
    team.members.push(next);
    if (wasLead) team.leadAgentId = next.agentId;
    this.#save(team);
    if (old.temporary && team.limits.temporary !== "keep")
      await port.setHidden(old.agentId, true).catch((error: unknown) => port.error("hx_team_hide_failed", error));
    port.note(team.starterAgentId, sourceText("status.agent.hxTeam.swapped", { old: old.name, new: next.name }));
    return next;
  }

  // ------------------------------------------------------------------ deadlines

  /** Runs `work` after the team's earlier work, outside the channel hook that called it. */
  #later(team: HxTeamRecord, work: () => Promise<void>): void {
    const before = this.#chains.get(team.id) ?? Promise.resolve();
    const next = before.then(work).catch((error: unknown) => this.#port?.error("hx_team_action_failed", error));
    this.#chains.set(team.id, next);
  }

  /** Waits for the work `#later` started; for tests. */
  settled(): Promise<void> {
    return Promise.all([...this.#chains.values()]).then(() => undefined);
  }

  // ------------------------------------------------------------------ v1.7.1: guards and the ledger

  /** The guards of a team; a record from before v1.7.1 gets them here. */
  #guard(team: HxTeamRecord): HxTeamGuardState {
    if (!team.guard) team.guard = hxGuardState();
    return team.guard;
  }

  /** The limits the user named (TEAM-01, G7), and the fields that an older version reads. */
  #setStated(team: HxTeamRecord, stated: HxTeamStated): void {
    const named: HxTeamStated = {};
    if (stated.members !== undefined) named.members = stated.members;
    if (stated.minutes !== undefined) named.minutes = stated.minutes;
    if (stated.rounds !== undefined) named.rounds = stated.rounds;
    if (stated.spendYuan !== undefined) named.spendYuan = stated.spendYuan;
    if (stated.noAsk !== undefined) named.noAsk = stated.noAsk;
    if (Object.keys(named).length) team.stated = named;
    else delete team.stated;
    const minutes = named.minutes ?? HX_TEAM_OPEN_MINUTES;
    team.limits = {
      ...team.limits,
      members: named.members ?? team.members.filter((member) => !member.left).length,
      minutes,
      rounds: named.rounds ?? HX_TEAM_OPEN_ROUNDS,
    };
    team.deadline = new Date(Date.parse(team.createdAt) + minutes * 60_000).toISOString();
  }

  /** The tasks of a room, read once after each change of the room. */
  #tasks(port: HxTeamPort, channelId: string): ChannelTask[] {
    const cached = this.#taskCache.get(channelId);
    if (cached) return cached;
    const tasks = port.tasks ? port.tasks(channelId) : port.room(channelId).tasks;
    this.#taskCache.set(channelId, tasks);
    return tasks;
  }

  /** The names, sizes and times of the files in the shared folder; null when there is none. */
  #folderHash(team: HxTeamRecord): string | null {
    if (!team.folder) return null;
    try {
      const hash = createHash("sha256");
      // v1.7.3: the walk runs in the main process. A team that installs packages or clones a repository
      // in its folder has tens of thousands of files there: the walk skips their folders and stops after
      // HX_TEAM_HASH_ENTRIES files, so it never holds the app up.
      let left = HX_TEAM_HASH_ENTRIES;
      const walk = (folder: string, depth: number) => {
        for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (left <= 0) return;
          const path = join(folder, entry.name);
          if (entry.isDirectory()) {
            if (depth < 3 && !HX_TEAM_HASH_SKIP.has(entry.name)) walk(path, depth + 1);
            continue;
          }
          left -= 1;
          const info = statSync(path);
          hash.update(`${path}\0${info.size}\0${info.mtimeMs}\n`);
        }
      };
      walk(team.folder, 0);
      return hash.digest("hex");
    } catch {
      return null;
    }
  }

  #saveTimes(): void {
    if (!this.#timesFile) return;
    try {
      writeFileSync(this.#timesFile, JSON.stringify(hxFlow.times.toJSON()));
    } catch (error) {
      this.#port?.error("hx_flow_times_failed", error);
    }
  }

  /** Why a guard paused the team, in the language of the team. */
  #reason(team: HxTeamRecord, why: string, name: string): string {
    const zh = team.language === "zh";
    const text: Record<string, [string, string]> = {
      G1: [
        "实际干活累计 30 分钟没有进展（没有做完的工作、文件没有变化、计划步骤没有推进）。",
        "30 minutes of real work with no progress (no work done, no file changed, no step of the plan moved).",
      ],
      G2moves: [
        "同一件工作在成员之间转手了 3 次，两次之间文件没有变化，未解决的问题也没有减少。",
        "The same work changed hands 3 times, with no file change and no open item closed in between.",
      ],
      G2same: [`${name} 收到了 3 次几乎相同的工作。`, `${name} got nearly the same work 3 times.`],
      G3: [
        "工作越分越散：最近 20 次交接里新开的工作是做完的 3 倍以上，或者工作分了 4 层以上。",
        "The work spreads: in the last 20 handoffs, 3 times as much new work as finished work, or work more than 4 levels deep.",
      ],
      G7: [`花费到了你定的 ${name} 元。`, `The spend reached the ¥${name} that you named.`],
      G8: ["这个团队实际干活累计 24 小时。", "This team did 24 hours of real work."],
      G9: ["花费提醒连续 10 次没有回应。", "10 spend reminders got no answer."],
    };
    const entry = text[why] ?? [why, why];
    return zh ? entry[0] : entry[1];
  }

  /**
   * A guard pauses the team: no new work starts, the work that runs finishes, and the starter asks the
   * user: continue, wrap up or stop. The referee of v1.7.4 comes before the user; until then the user.
   */
  async #pause(port: HxTeamPort, team: HxTeamRecord, guardId: HxGuardId, reason: string): Promise<void> {
    const guard = this.#guard(team);
    if (team.state !== "running" || guard.paused) return;
    const at = new Date(this.#now()).toISOString();
    guard.paused = { guard: guardId, at, reason };
    this.#save(team);
    port.note(team.starterAgentId, sourceText("status.agent.hxTeam.paused", { reason }));
    const zh = team.language === "zh";
    const text = zh
      ? [
          `【协作暂停】团队“${team.roomName}”暂停了：${reason}`,
          "暂停只是不开新的工作，在做的会做完。",
          "",
          "请把情况告诉用户，问用户怎么办：继续（调用 team，action 为 continue）、收尾（action 为 finish，带头的用已有的结果交回）、停（action 为 stop）。",
        ]
      : [
          `[Team paused] The team "${team.roomName}" paused: ${reason}`,
          "A pause only starts no new work; the work that runs finishes.",
          "",
          "Tell the user what happened, and ask what to do: continue (call team with action continue), wrap up (action finish: the lead sends what the team has), or stop (action stop).",
        ];
    try {
      await port.deliver({
        fromAgentId: this.#lead(team)?.agentId ?? team.leadAgentId,
        toAgentId: team.starterAgentId,
        text: text.join("\n"),
        key: `hx-team:${team.id}:pause:${guardId}:${at}`,
      });
    } catch (error) {
      port.error("hx_team_pause_failed", error);
    }
  }

  /** G3: the first time, one line to the lead; the next time, the user. */
  async #spread(port: HxTeamPort, team: HxTeamRecord): Promise<void> {
    const guard = this.#guard(team);
    if (team.state !== "running" || guard.paused) return;
    if (guard.spreadHinted) return this.#pause(port, team, "G3", this.#reason(team, "G3", ""));
    guard.spreadHinted = true;
    guard.handoffs = [];
    this.#save(team);
    const lead = this.#lead(team);
    if (!lead) return;
    try {
      await port.post({
        channelId: team.channelId,
        operationId: `hx-team-spread:${team.id}`,
        fromAgentId: team.starterAgentId,
        text:
          team.language === "zh"
            ? "先收拢：新开的工作比做完的多得多。先把已分出去的做完、合起来，再决定还要不要分。"
            : "Bring it together first: much more new work opens than gets done. Finish and join the work that is out, then decide whether to split more.",
        toAgentIds: [lead.agentId],
        paths: [],
      });
    } catch (error) {
      port.error("hx_team_spread_failed", error);
    }
  }

  #startTicker(): void {
    if (this.#ticker) return;
    this.#ticker = setInterval(() => void this.tick(), HX_TEAM_TICK_MS);
    if (typeof this.#ticker === "object" && "unref" in this.#ticker) this.#ticker.unref();
  }

  /**
   * One look at each running team: real work (G1, G8, the user's minutes), and the spend (G5, G7,
   * G9). Tests call it.
   */
  async tick(): Promise<void> {
    const port = this.#port;
    if (!port) return;
    const now = this.#now();
    for (const team of this.store.running()) {
      const guard = this.#guard(team);
      // The first reading of the shared folder is where G1 compares from, not progress. With no
      // reading, the first G1 check took any folder for a changed one, and G1 came 30 minutes late.
      if (guard.folderHash === null) guard.folderHash = this.#folderHash(team);
      const working = !guard.paused && hxFlow.teamRunning(team.id);
      const due = hxWorkTick(guard, now, working);
      const minutes = team.stated?.minutes;
      if (minutes !== undefined && guard.activeMs >= minutes * 60_000) {
        this.#later(team, () => this.#stop(port, team, "minutes", true));
        continue;
      }
      if (due === "G8") this.#later(team, () => this.#pause(port, team, "G8", this.#reason(team, "G8", "")));
      if (due === "G1") {
        // The code check: a file that changed is progress too.
        const folder = this.#folderHash(team);
        if (folder !== null && folder !== guard.folderHash) hxProgress(guard, folder);
        else this.#later(team, () => this.#pause(port, team, "G1", this.#reason(team, "G1", "")));
      }
      this.store.save(team);
    }
    await this.#spendTick(port, now);
  }

  async #spendTick(port: HxTeamPort, now: number): Promise<void> {
    if (!port.spend || this.#spendReading) return;
    this.#spendReading = true;
    try {
      for (const team of this.store.running()) {
        const guard = this.#guard(team);
        const reading = await port.spend(
          team.members.filter((member) => !member.left).map((member) => member.agentId),
          team.createdAt,
        );
        const cap = team.stated?.spendYuan;
        if (cap !== undefined && reading.yuan !== null && reading.yuan >= cap) {
          this.#later(team, () => this.#pause(port, team, "G7", this.#reason(team, "G7", String(cap))));
          continue;
        }
        const reminder = hxSpendDue(guard, reading, now);
        if (reminder) {
          port.note(
            team.starterAgentId,
            reminder.kind === "api"
              ? sourceText("status.agent.hxTeam.spend.api", { yuan: reminder.yuan })
              : reminder.kind === "plan"
                ? sourceText("status.agent.hxTeam.spend.plan", { percent: reminder.percent })
                : sourceText("status.agent.hxTeam.spend.tokens", { millions: reminder.millions }),
          );
          if (hxUnanswered(guard, team.stated?.noAsk === true))
            this.#later(team, () => this.#pause(port, team, "G9", this.#reason(team, "G9", "")));
        }
        this.store.save(team);
      }
    } catch (error) {
      port.error("hx_team_spend_failed", error);
    } finally {
      this.#spendReading = false;
    }
  }

  /** What the HX-Flow ledger reads of the teams (CONC-03, CONC-04). */
  #flowView() {
    const running = (channelId: string) => {
      const team = this.store.byChannel(channelId);
      return team?.state === "running" ? team : null;
    };
    const describe = (team: HxTeamRecord, tasks: readonly ChannelTask[], index: number): HxFlowTeamTask | null => {
      const task = tasks[index];
      if (!task) return null;
      const dependents = countDependents(task.id, tasks);
      const owner = task.ownerAgentId;
      return {
        channelId: team.channelId,
        taskId: task.id,
        teamId: team.id,
        tier: task.parentTaskId === null || owner === team.leadAgentId || dependents > 0 ? 1 : 2,
        order: index,
        batch: team.batches?.[workKey(task)] ?? null,
        difficulty: team.members.find((member) => member.agentId === owner)?.difficulty ?? null,
        dependents,
      };
    };
    return {
      teamOf: (channelId: string) => running(channelId)?.id ?? null,
      task: (channelId: string, taskId: string) => {
        const team = running(channelId);
        const port = this.#port;
        if (!team || !port) return null;
        const tasks = this.#tasks(port, channelId);
        return describe(
          team,
          tasks,
          tasks.findIndex((task) => task.id === taskId),
        );
      },
      ready: () => {
        const port = this.#port;
        if (!port) return [];
        const ready: HxFlowTeamTask[] = [];
        for (const team of this.store.running()) {
          const guard = this.#guard(team);
          if (guard.paused) continue;
          const tasks = this.#tasks(port, team.channelId);
          const states = new Map(tasks.map((task) => [task.id, task.state]));
          tasks.forEach((task, index) => {
            if (task.state !== "queued" || !task.ownerAgentId) return;
            if (guard.wrapUp && task.parentTaskId !== null && task.ownerAgentId !== team.leadAgentId) return;
            if (!task.dependencies.every((id) => SETTLED.has(states.get(id) ?? ""))) return;
            const described = describe(team, tasks, index);
            if (described) ready.push(described);
          });
        }
        return ready;
      },
    };
  }

  // ------------------------------------------------------------------ reading

  #lead(team: HxTeamRecord): HxTeamMember | undefined {
    return team.members.find((member) => member.agentId === team.leadAgentId && !member.left);
  }

  /** A member by role, name or agent id. */
  #member(team: HxTeamRecord, which: string): HxTeamMember | undefined {
    const wanted = which.trim().toLowerCase();
    return team.members.find(
      (member) =>
        !member.left &&
        (member.agentId === which.trim() ||
          member.role.toLowerCase() === wanted ||
          member.name.toLowerCase() === wanted),
    );
  }

  #addFiles(team: HxTeamRecord, files: readonly string[]): void {
    for (const file of files) if (!team.files.includes(file)) team.files.push(file);
    team.files = team.files.slice(-HX_TEAM_FILE_LIMIT);
  }

  #summary(team: HxTeamRecord) {
    return {
      id: team.id,
      room: team.roomName,
      state: team.state,
      lead: this.#lead(team)?.name ?? null,
      members: team.members
        .filter((member) => !member.left)
        .map((member) => ({ role: member.role, name: member.name, model: member.model, temporary: member.temporary })),
      folder: team.folder,
      // v1.7.1: only the limits the user named; none by default.
      limits: team.stated ?? null,
      paused: team.guard?.paused ?? null,
    };
  }

  /** The board as the members and the starter read it. */
  #board_(team: HxTeamRecord) {
    const port = this.#port;
    const agents = port?.agents() ?? [];
    const room = port?.room(team.channelId);
    const used = this.#handoffs(team);
    const elapsed = Math.round((this.#now() - Date.parse(team.createdAt)) / 60_000);
    return {
      ...this.#summary(team),
      goal: hxOneLine(team.goal, 600),
      members: team.members
        .filter((member) => !member.left)
        .map((member) => {
          const agent = agents.find((candidate) => candidate.id === member.agentId);
          return {
            role: member.role,
            name: member.name,
            agentId: member.agentId,
            lead: member.agentId === team.leadAgentId,
            model: agent?.model ?? member.model,
            computer: agent?.computerUse ?? false,
            temporary: member.temporary,
          };
        }),
      steps: team.steps,
      work: (room?.tasks ?? []).slice(-20).map((task) => ({
        owner: agents.find((agent) => agent.id === task.ownerAgentId)?.name ?? null,
        state: task.state,
        what: hxOneLine(hxReadForm(task.instruction).goal ?? task.instruction, 120),
      })),
      facts: team.facts,
      files: team.files,
      skills: team.skills.map((skill) => ({
        name: skill.name,
        owner: skill.owner,
        does: skill.description,
        file: skill.file,
      })),
      connectors: "Every agent on this computer has the same connectors.",
      used: { handoffs: used, minutes: elapsed, workMinutes: Math.round((team.guard?.activeMs ?? 0) / 60_000) },
      limits: team.stated ?? "none: the computer decides how many work at once",
      paused: team.guard?.paused?.reason ?? null,
      computer: hxCapacityLine(team.language, hxFlow.capacity()),
      result: team.result,
      reason: team.reason,
    };
  }
}

/** The id of a team's progress card in the starter's chat. */
export function hxTeamCardId(teamId: string): string {
  return `hx-team-card-${teamId}`;
}

/**
 * The progress card of a team: the handoffs and the time in the header (v1.7.1: no limits), and each
 * step with the member that does it. A blocked step says that it waits; a finished team has every
 * step done; a paused team says that it waits for the user.
 */
export function hxTeamCard(team: HxTeamRecord, handoffs: number, minutes: number): HxProgressCard {
  const who = (role: string) => team.members.find((member) => member.role === role && !member.left)?.name ?? role;
  const stuck = team.language === "zh" ? "（等待中）" : " (waiting)";
  return {
    title: team.guard?.paused
      ? sourceText("status.agent.hxTeam.progressPaused", { count: handoffs, minutes })
      : sourceText("status.agent.hxTeam.progressOpen", { count: handoffs, minutes }),
    steps: team.steps.map((step) => ({
      text: `${step.title} · ${who(step.role)}${step.state === "blocked" ? stuck : ""}`,
      state: team.state === "done" || step.state === "done" ? "done" : step.state === "doing" ? "active" : "pending",
    })),
  };
}

export const hxTeams = new HxTeams();

/**
 * A line of a team in the starter's chat. It is a channel-change line: the chat shows it as a small
 * line, and the agent's prompt does not get it.
 */
export function hxTeamLine(text: string, at = new Date()): ConversationMessage {
  return {
    id: `hx-team-${randomUUID()}`,
    author: "system",
    source: "system",
    text,
    createdAt: at.toISOString(),
    status: "completed",
    itemType: CHANNEL_CHANGE_ITEM_TYPE,
  };
}
