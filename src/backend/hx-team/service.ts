// HXBot 协作（二）：多智能体无缝协作（v1.6.6）。
//
// The starter (the agent the user talks to) calls `start_team` after the user pressed Start on a
// proposal card. HXBot picks members by skill, makes members for the roles that no agent fits, opens a
// team room (a channel) with the lead, the members and the team rules, and gives the lead the brief.
// The starter is never a member: it stays with the user, who can ask it about the team, add words,
// stop it or swap a member (`team`). In the room, the members hand work over with a handoff form,
// keep the board (`team_board`), and the lead sends the result back (`team_done`). A watcher reads
// each change of the room: it writes short lines in the starter's chat, stops the team at its limits,
// and finishes it with the lead's last message when the lead did not call `team_done`.
//
// Nothing here imports the agent service: `HxTeamPort` is what the host gives (agent-service.ts).
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { totalmem } from "node:os";
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
import type { HxProgressWriter } from "../hx-progress/progress";
import { hxFormFiles, hxFormLabel, hxFormTemplate, hxMissingParts, hxReadForm } from "./form";
import { type HxMatchAgent, hxMatchRoles } from "./match";
import {
  hxClock,
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
  HxTeamStore,
} from "./store";
import {
  HX_START_TEAM_TOOL,
  HX_TEAM_BOARD_TOOL,
  HX_TEAM_DONE_TOOL,
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
function workKey(task: ChannelTask): string {
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

export class HxTeams {
  readonly store: HxTeamStore;
  #port: HxTeamPort | null = null;
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #chains = new Map<string, Promise<void>>();
  readonly #now: () => number;

  constructor(store = new HxTeamStore(), now: () => number = Date.now) {
    this.store = store;
    this.#now = now;
  }

  /** The host; null takes it away (a test that sets the shared one). */
  setPort(port: HxTeamPort | null): void {
    this.#port = port;
  }

  /** Opens the records and arms the deadline of each running team. */
  open(folder: string): void {
    this.store.open(folder);
    for (const team of this.store.running()) this.#arm(team);
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
    // v1.6.7: limits the user named for this team in the chat come before the agent's settings, so a
    // person on the web or the phone changes them by saying so, with no settings page.
    const settings = {
      ...saved,
      teamMembers: input.limits?.members ?? saved.teamMembers,
      teamMinutes: input.limits?.minutes ?? saved.teamMinutes,
      teamRounds: input.limits?.rounds ?? saved.teamRounds,
    };
    if (input.roles.length > settings.teamMembers)
      return refuse(
        `The user allows at most ${settings.teamMembers} members in a team. Merge roles so there are at most ${settings.teamMembers}, and retry.`,
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
        });
      }

      const leadIndex = Math.max(
        0,
        input.roles.findIndex((role) => role.kind === "plan"),
      );
      const lead = members[leadIndex] ?? members[0];
      if (!lead) return refuse("A team needs at least one role.");
      const now = this.#now();
      const deadline = now + settings.teamMinutes * 60_000;
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
          members: settings.teamMembers,
          minutes: settings.teamMinutes,
          rounds: settings.teamRounds,
          temporary: settings.teamTemporary,
        },
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
          rounds: settings.teamRounds,
          minutes: settings.teamMinutes,
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
          rounds: settings.teamRounds,
          minutes: settings.teamMinutes,
          deadline: hxClock(deadline),
          skills: hxTeamSkillLines(skills, language),
          parallel: this.parallel(),
        }),
        toAgentIds: [lead.agentId],
        paths: input.paths ?? [],
      });
      this.#arm(team);
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
    if (input.action === "keep") return answer({ status: "kept", members: await this.#keep(port, team) });
    if (input.action === "limits") {
      // v1.6.7: the user changes the time or the handoff limit of a running team by saying so.
      if (input.minutes === undefined && input.rounds === undefined) return refuse("Give minutes or rounds.");
      if (input.minutes !== undefined) {
        team.limits.minutes = input.minutes;
        team.deadline = new Date(Date.parse(team.createdAt) + input.minutes * 60_000).toISOString();
        this.#arm(team);
      }
      if (input.rounds !== undefined) team.limits.rounds = input.rounds;
      this.#save(team);
      return answer({ status: "changed", team: this.#summary(team) });
    }
    if (team.state !== "running") return refuse(`The team has ended (${team.state}). Start a new team for more work.`);
    if (input.action === "stop") {
      await this.#stop(port, team, "user", false);
      return answer({ status: "stopped", team: this.#summary(team) });
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
      step.state = input.state;
      if (input.note !== undefined) step.note = input.note;
    } else if (input.action === "fact") {
      if (!input.text) return refuse("Give text: the fact.");
      if (!team.facts.includes(input.text)) team.facts = [...team.facts, input.text].slice(-HX_TEAM_FACT_LIMIT);
    } else {
      if (!input.path) return refuse("Give path: the file.");
      this.#addFiles(team, [input.path]);
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
   * it: null to go on, or the reason to refuse. A form with a missing line, a team at its handoff
   * limit or past its time is refused.
   */
  checkHandoff(channelId: string, tool: string, args: unknown): string | null {
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
    if (this.#now() > Date.parse(team.deadline))
      return zh
        ? `团队已到 ${team.limits.minutes} 分钟的上限，不再交接。带头的用已有的结果调用 hxbot.team_done，并写明还有什么没做。`
        : `The team reached its limit of ${team.limits.minutes} minutes. No more handoffs: the lead calls hxbot.team_done with what the team has and says what is left.`;
    if (tool === "channel_assign") {
      // v1.6.7: a team of up to 20; each member is a model program of its own, so only as many work
      // at once as this computer's memory holds. The others wait for a free place.
      const busy = (this.#port?.room(team.channelId).tasks ?? []).filter(
        (item) => item.parentTaskId !== null && ACTIVE.has(item.state),
      ).length;
      const parallel = this.parallel();
      if (busy >= parallel)
        return zh
          ? `现在已有 ${busy} 个成员在干活，这台电脑最多同时 ${parallel} 个。等其中一件做完，再分派这一件。`
          : `${busy} members work now, and this computer holds at most ${parallel} at once. Give this out when one of them is done.`;
    }
    if (this.#handoffs(team) >= team.limits.rounds) {
      this.#port?.note(team.starterAgentId, sourceText("status.agent.hxTeam.rounds", { limit: team.limits.rounds }));
      return zh
        ? `团队已到 ${team.limits.rounds} 次交接的上限。带头的用已有的结果调用 hxbot.team_done，并写明还有什么没做。`
        : `The team reached its limit of ${team.limits.rounds} handoffs. The lead calls hxbot.team_done with what the team has and says what is left.`;
    }
    this.#addFiles(team, hxFormFiles(hxReadForm(task)));
    this.#save(team);
    return null;
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

  /** How many members may work at once on this computer (v1.6.7); tests set it. */
  parallel: () => number = () => hxTeamParallel(totalmem());

  /** Runs after each change of a channel. It never throws. */
  changed(channelId: string): void {
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
    const room = port.room(team.channelId);
    if (!room.exists || room.archived) {
      this.#later(team, () => this.#stop(port, team, "room", true));
      return;
    }
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
      // v1.6.7: each handoff shows on the team's progress card, not as a line. A task that moves whole
      // to another member is rare and changes who answers, so it keeps its line.
      if (previousOwner && owner && previousOwner !== owner) {
        team.seen.__transfers = String(Number(team.seen.__transfers ?? "0") + 1);
        port.note(
          team.starterAgentId,
          sourceText("status.agent.hxTeam.transferred", {
            from: names(previousOwner || null),
            to: names(owner),
            count: this.#handoffs(team),
            limit: team.limits.rounds,
          }),
        );
      }
      if (task.state === "running") this.#stepOf(team, owner, "todo", "doing");
      if (task.state === "completed" && previousState !== "completed" && task.parentTaskId !== null) {
        this.#stepOf(team, owner, "doing", "done");
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
        const last = [...room.messages]
          .reverse()
          .find((message) => message.author.kind === "agent" && message.author.id === team.leadAgentId);
        const anyAgent = [...room.messages].reverse().find((message) => message.author.kind === "agent");
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
    this.#disarm(team.id);
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
        ? `到了 ${team.limits.minutes} 分钟的上限。`
        : `it reached its limit of ${team.limits.minutes} minutes.`,
      retry: zh ? "同一件工作失败了两次。" : "the same work failed twice.",
      room: zh ? "协作房间被归档或删除了。" : "its room was archived or deleted.",
      cancelled: zh ? "房间里的工作被取消了。" : "its work was cancelled in the room.",
    }[reason];
    this.#save(team);
    this.#disarm(team.id);
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
        ? sourceText("status.agent.hxTeam.stopped.minutes", { minutes: team.limits.minutes })
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

  #arm(team: HxTeamRecord): void {
    this.#disarm(team.id);
    const delay = Math.max(0, Date.parse(team.deadline) - this.#now());
    const timer = setTimeout(
      () => {
        this.#timers.delete(team.id);
        const port = this.#port;
        const current = this.store.get(team.id);
        if (port && current?.state === "running")
          this.#later(current, () => this.#stop(port, current, "minutes", true));
      },
      Math.min(delay, 2_147_000_000),
    );
    if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
    this.#timers.set(team.id, timer);
  }

  #disarm(teamId: string): void {
    const timer = this.#timers.get(teamId);
    if (timer) clearTimeout(timer);
    this.#timers.delete(teamId);
  }

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
      limits: team.limits,
      deadline: team.deadline,
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
      used: { handoffs: used, of: team.limits.rounds, minutes: elapsed, ofMinutes: team.limits.minutes },
      result: team.result,
      reason: team.reason,
    };
  }
}

/**
 * How many members may work at once: one for each 2 GB of this computer's memory, at least 2 and at
 * most 10. Each member is a model program of its own; the number is an estimate to measure.
 */
export function hxTeamParallel(totalBytes: number): number {
  return Math.min(10, Math.max(2, Math.floor(totalBytes / 2 ** 31)));
}

/** The id of a team's progress card in the starter's chat. */
export function hxTeamCardId(teamId: string): string {
  return `hx-team-card-${teamId}`;
}

/**
 * The progress card of a team: the handoffs and the time against their limits in the header, and
 * each step with the member that does it. A blocked step says that it waits; a finished team has
 * every step done.
 */
export function hxTeamCard(team: HxTeamRecord, handoffs: number, minutes: number): HxProgressCard {
  const who = (role: string) => team.members.find((member) => member.role === role && !member.left)?.name ?? role;
  const stuck = team.language === "zh" ? "（等待中）" : " (waiting)";
  return {
    title: sourceText("status.agent.hxTeam.progress", {
      count: handoffs,
      limit: team.limits.rounds,
      minutes,
      max: team.limits.minutes,
    }),
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
