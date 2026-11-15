// HXBot 真实模型检查（v1.6.7）：用真实模型走一遍协作的全流程。
//
//   用户一句话 → 建议卡 → 点“开始” → 组队（人数、时长、交接次数按用户的话）→ 带头的看看板、用交接单分派
//   → 检查程序故意删掉第一张交接单的一行，看它被退回后能不能补全 → 成员交回结果（检查程序代写）
//   → 用户插话：加时间和交接次数、给团队传话、换人 → 带头的交回最终结果 → 另起一个团队，用户叫停。
//
// 团队的代码、工具定义和说明都是产品里的原样，只有房间和成员的活是假的（team-world.ts）。
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DynamicRecord, isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { z } from "zod";
import { advertisedJsonSchema } from "../agent/advertised-json-schema";
import { CHANNEL_TOOL_DEFINITIONS } from "../channel-tools";
import { HX_PROPOSAL_TOOL_DEFINITION, hxProposalInstruction } from "../hx-auto-model/proposal";
import { HxAutoRouter } from "../hx-auto-model/router";
import { HxAutoModelStore } from "../hx-auto-model/store";
import { hxMissingParts } from "../hx-team/form";
import { HxTeams } from "../hx-team/service";
import { HX_TEAM_TOOL_DEFINITIONS } from "../hx-team/tools";
import type { HxBrain, HxBrainTurn } from "./brain";
import type { HxChatTool } from "./chat-model";
import type { HxLoopCall } from "./loop";
import type { HxRealItems } from "./report";
import { HxTeamWorld, hxWorldAgent } from "./team-world";

/** The words of the check: what the user says in the starter's chat. */
const HX_TEAM_WORDS = {
  ask: "帮我做一份《社区咖啡店开业调研》：先查资料（周边人群、竞争对手、价格），再写一份 300 字左右的报告，最后另外找人检查一遍。这次最多 3 个人、40 分钟、10 次交接。",
  limits: "再给 30 分钟，交接次数加到 20 次。",
  message: "跟团队说一声：报告里加一段竞争对手的价格对比。",
  swap: "把负责写报告的成员换一个人。",
  stop: "先停一下这个团队。",
} as const;

const STARTER = "starter";

/** A product text for the model: its tools are called by name here, not through hxbot.tool_call. */
function plain(text: string): string {
  return text
    .replace(/\s*with tool_call/g, "")
    .replace(/\bhxbot\./g, "")
    .trim();
}

function tool(definition: { name: string; description: string; shape: z.ZodRawShape }): HxChatTool {
  return {
    name: definition.name,
    description: plain(definition.description),
    parameters: advertisedJsonSchema(z.strictObject(definition.shape)),
  };
}

function read(text: string): DynamicRecord {
  try {
    const value = JSON.parse(text);
    return isDynamicRecord(value) ? value : {};
  } catch {
    return {};
  }
}

/** A number or a text inside the arguments of a call, for the report. */
function field(value: unknown, key: string): string | number | undefined {
  const found = isDynamicRecord(value) ? value[key] : undefined;
  return typeof found === "string" || typeof found === "number" ? found : undefined;
}

function list(value: unknown, key: string): number {
  const found = isDynamicRecord(value) ? value[key] : undefined;
  return Array.isArray(found) ? found.length : 0;
}

function limitsOf(value: unknown): {
  members?: number | undefined;
  minutes?: number | undefined;
  rounds?: number | undefined;
} {
  const limits = isDynamicRecord(value) ? value.limits : undefined;
  if (!isDynamicRecord(limits)) return {};
  const number = (key: string) => (typeof limits[key] === "number" ? limits[key] : undefined);
  return { members: number("members"), minutes: number("minutes"), rounds: number("rounds") };
}

function briefOf(calls: readonly HxLoopCall[]): string {
  return calls
    .map((call) => `${call.name} ${JSON.stringify(call.args).slice(0, 160)} → ${call.answer.slice(0, 160)}`)
    .join("\n");
}

/** The line of a form that the check takes out on purpose: the last part, “不要碰”. */
function withoutAvoid(task: string): string {
  return task
    .split("\n")
    .filter((line) => !/^[\s>*\-#]*(?:\*\*)?(?:不要碰|Avoid)(?:\*\*)?\s*[:：]/iu.test(line))
    .join("\n");
}

export async function hxTeamRealCheck(input: {
  brain: HxBrain;
  items: HxRealItems;
  log: (line: string) => void;
}): Promise<void> {
  const { brain, items, log } = input;
  const world = new HxTeamWorld([
    hxWorldAgent(STARTER, "助理", "Assistant", "The user's own assistant."),
    hxWorldAgent("agent-research", "小研", "研究员 Researcher", "查资料、做调研、整理数据。Research and data."),
    hxWorldAgent("agent-writer", "小文", "写手 Writer", "写报告、文案和摘要。Writing."),
    hxWorldAgent("agent-check", "小审", "审稿 Reviewer", "检查事实、错字和逻辑。Checking."),
  ]);
  const teams = new HxTeams();
  teams.open(mkdtempSync(join(tmpdir(), "hx-team-check-")));
  teams.setPort(world);
  let keys = 0;
  const key = () => `check-${++keys}`;

  // ------------------------------------------------------------------ the starter's chat
  const router = new HxAutoRouter(new HxAutoModelStore());
  const starterTools = [
    tool(HX_PROPOSAL_TOOL_DEFINITION),
    ...HX_TEAM_TOOL_DEFINITIONS.filter((item) => item.name === "start_team" || item.name === "team").map(tool),
  ];
  const starterSystem = [
    "You are 助理, an agent in HXBot on the user's computer. The user talks to you in this chat. Call tools by their names.",
    ...hxProposalInstruction(router, STARTER).map(plain),
  ].join("\n");
  const proposals: unknown[] = [];
  const starterHandle = async (name: string, args: unknown): Promise<string> => {
    if (name === HX_PROPOSAL_TOOL_DEFINITION.name) {
      const parsed = z.strictObject(HX_PROPOSAL_TOOL_DEFINITION.shape).safeParse(args);
      if (!parsed.success) return JSON.stringify({ status: "invalid", reason: z.prettifyError(parsed.error) });
      proposals.push(parsed.data);
      // The user presses Start on the card.
      return JSON.stringify({ status: "answered", actionId: "start" });
    }
    const result = await teams.call({
      tool: name,
      arguments: args,
      agentId: STARTER,
      key: key(),
      roomId: null,
      byPerson: true,
    });
    return result.contentItems[0]?.text ?? "{}";
  };
  const say = async (words: string, maxTurns = 6) => {
    const result = await brain.turn({
      session: "starter",
      system: starterSystem,
      user: words,
      tools: starterTools,
      handle: starterHandle,
      maxTurns,
    });
    log(`starter: ${words}\n${briefOf(result.calls)}\n${result.text.slice(0, 300)}`);
    return result;
  };

  const first = await say(HX_TEAM_WORDS.ask);
  if (first.end === "error") {
    items.add("T1", "模型答复", "fail", first.error ?? "");
    return;
  }
  const proposeIndex = first.calls.findIndex((call) => call.name === HX_PROPOSAL_TOOL_DEFINITION.name);
  const startIndex = first.calls.findIndex((call) => call.name === "start_team");
  const roles = list(proposals[0], "roles");
  items.check(
    "T1",
    "先出建议卡（propose_plan），参数合格，两个以上角色",
    proposals.length > 0 && roles >= 2 && (startIndex < 0 || proposeIndex < startIndex),
    proposals.length ? `角色 ${roles} 个` : briefOf(first.calls) || first.text.slice(0, 300),
  );
  const startCall = first.calls.filter((call) => call.name === "start_team").at(-1);
  const started = startCall ? read(startCall.answer) : {};
  items.check(
    "T2",
    "点“开始”后组队（start_team）",
    started.status === "started",
    startCall ? startCall.answer.slice(0, 400) : "没有调用 start_team",
  );
  const named = limitsOf(startCall?.args);
  items.check(
    "T3",
    "上限按用户的话传入（3 个人、40 分钟、10 次交接）",
    named.members === 3 && named.minutes === 40 && named.rounds === 10,
    JSON.stringify(named),
  );
  const [channelId, room] = [...world.rooms.entries()][0] ?? [];
  if (!channelId || !room) {
    for (const [id, title] of [
      ["T4", "协作房间和任务说明"],
      ["T5", "带头的先看看板"],
      ["T6", "交接单第一次就写全"],
      ["T7", "交接单少一项被退回后补全"],
      ["T8", "分派给合适的成员"],
      ["T9", "插话：加时间和交接次数"],
      ["T10", "插话：给团队传话"],
      ["T11", "换人"],
      ["T12", "交回最终结果"],
      ["T13", "进度卡"],
    ] as const)
      items.add(id, title, "skip", "没有组成团队");
  } else {
    const brief = world.posts[0]?.text ?? "";
    items.check(
      "T4",
      "建好协作房间，任务说明交给带头的（含上限）",
      Boolean(brief) && brief.includes("10 次交接") && brief.includes("40 分钟"),
      brief.slice(0, 300),
    );
    await leadRun({ brain, items, log, world, teams, channelId, key, say });
  }

  // ------------------------------------------------------------------ stop: a second team
  const second = await teams.call({
    tool: "start_team",
    arguments: {
      goal: "整理一份本周的会议纪要。",
      roles: [
        { name: "整理", kind: "do", does: "整理会议纪要", work: "writing" },
        { name: "检查", kind: "check", does: "检查纪要", work: "writing" },
      ],
      steps: [
        { title: "整理纪要", role: "整理" },
        { title: "检查纪要", role: "检查" },
      ],
    },
    agentId: STARTER,
    key: key(),
    roomId: null,
    byPerson: true,
  });
  if (read(second.contentItems[0]?.text ?? "{}").status !== "started") {
    items.add("T14", "用户叫停", "skip", second.contentItems[0]?.text ?? "");
    return;
  }
  const stopped = await say(
    `（另一件事）我刚才另外让你组了一个团队整理本周的会议纪要，它正在做。${HX_TEAM_WORDS.stop}`,
    4,
  );
  const stopCall = stopped.calls.find((call) => call.name === "team" && field(call.args, "action") === "stop");
  items.check(
    "T14",
    "用户说“停一下”，调用 team stop，团队停下",
    Boolean(stopCall) && read(stopCall?.answer ?? "{}").status === "stopped",
    briefOf(stopped.calls) || stopped.text.slice(0, 300),
  );
}

async function leadRun(context: {
  brain: HxBrain;
  items: HxRealItems;
  log: (line: string) => void;
  world: HxTeamWorld;
  teams: HxTeams;
  channelId: string;
  key: () => string;
  say: (words: string, maxTurns?: number) => Promise<HxBrainTurn>;
}): Promise<void> {
  const { brain, items, log, world, teams, channelId, key, say } = context;
  const room = world.rooms.get(channelId);
  if (!room) return;
  const lead = world.agentList.find((agent) => agent.id === room.lead);
  const members = () => (world.rooms.get(channelId)?.members ?? []).filter((id) => id !== room.lead);
  const memberLines = () =>
    members()
      .map((id) => world.agentList.find((agent) => agent.id === id))
      .filter((agent) => agent !== undefined)
      .map((agent) => `- ${agent.name}（agentId ${agent.id}）：${agent.title}；${agent.description}`)
      .join("\n");
  const assignDefinition = CHANNEL_TOOL_DEFINITIONS.find((item) => item.name === "channel_assign");
  if (!lead || !assignDefinition) return;
  const leadTools = [
    tool(assignDefinition),
    ...HX_TEAM_TOOL_DEFINITIONS.filter((item) => item.name === "team_board" || item.name === "team_done").map(tool),
  ];
  // The channel shows its current members, so the list is written again before each round.
  const system = (): string =>
    [
      `You are ${lead.name} (agentId ${lead.id}), the lead of this channel in HXBot. Call tools by their names.`,
      room.instructions,
      "Channel members you can give work to with channel_assign:",
      memberLines(),
      `The request message of your task has the id ${world.requestId(channelId)}: use it in sourceMessageIds.`,
      "After channel_assign, end your turn: the result comes back as a new message.",
    ].join("\n");

  const assigned: Array<{ id: string; to: string; task: string }> = [];
  // Written by the tool handler, read after the rounds.
  const seen: {
    firstMissing: string[] | null;
    forced: boolean;
    refusedThenFixed: boolean | null;
    boardFirst: boolean | null;
    strangers: number;
  } = { firstMissing: null, forced: false, refusedThenFixed: null, boardFirst: null, strangers: 0 };
  const handle = async (name: string, args: unknown): Promise<string> => {
    if (name === "team_board" || name === "team_done") {
      if (name === "team_board" && seen.boardFirst === null) seen.boardFirst = assigned.length === 0;
      const result = await teams.call({
        tool: name,
        arguments: args,
        agentId: lead.id,
        key: key(),
        roomId: channelId,
        byPerson: false,
      });
      return result.contentItems[0]?.text ?? "{}";
    }
    const parsed = z.strictObject(assignDefinition.shape).safeParse(args);
    if (!parsed.success) return JSON.stringify({ status: "invalid", reason: z.prettifyError(parsed.error) });
    const handoff = { ...parsed.data };
    const recipient = String(handoff.recipientAgentId ?? "");
    const task = String(handoff.task ?? "");
    if (!members().includes(recipient)) {
      seen.strangers += 1;
      return JSON.stringify({ status: "refused", reason: `${recipient} is not a member of this channel.` });
    }
    if (seen.firstMissing === null) {
      seen.firstMissing = hxMissingParts(task);
      // The check takes one line out of the first form, to see the refusal and the second try.
      seen.forced = true;
      const reason = teams.checkHandoff(channelId, "channel_assign", { ...handoff, task: withoutAvoid(task) });
      if (reason) return JSON.stringify({ status: "refused", reason });
    }
    const reason = teams.checkHandoff(channelId, "channel_assign", handoff);
    if (reason) {
      if (seen.forced && seen.refusedThenFixed === null) seen.refusedThenFixed = false;
      return JSON.stringify({ status: "refused", reason });
    }
    if (seen.forced && seen.refusedThenFixed !== true && assigned.length === 0) seen.refusedThenFixed = true;
    const made = world.assign(channelId, {
      recipientAgentId: recipient,
      task,
      expectedResult: String(handoff.expectedResult ?? ""),
    });
    assigned.push({ id: made.id, to: recipient, task });
    teams.changed(channelId);
    return JSON.stringify({ status: "assigned", taskId: made.id });
  };

  let next = world.posts[0]?.text ?? "";
  let done: HxLoopCall | undefined;
  let interjected = false;
  const results: string[] = [];
  for (let round = 0; round < 6 && !done; round += 1) {
    const turn = await brain.turn({
      session: "lead",
      system: system(),
      user: next,
      tools: leadTools,
      handle,
      maxTurns: 8,
    });
    log(`lead round ${round + 1}:\n${briefOf(turn.calls)}\n${turn.text.slice(0, 300)}`);
    if (turn.end === "error") {
      items.add("T12", "交回最终结果", "fail", turn.error ?? "");
      break;
    }
    if (turn.text) world.say(channelId, lead.id, turn.text);
    done = turn.calls.find((call) => call.name === "team_done" && read(call.answer).status !== "refused");
    if (done) break;
    // The members answer their open subtasks.
    const open = (world.rooms.get(channelId)?.tasks ?? []).filter(
      (task) => task.parentTaskId !== null && task.state === "running",
    );
    const lines: string[] = [];
    for (const task of open) {
      const who = world.agentList.find((agent) => agent.id === task.ownerAgentId)?.name ?? "成员";
      const text = /检查|审|Review|check/iu.test(task.instruction.split("\n")[0] ?? "")
        ? `【检查结果】报告已检查：数字和事实一致，改了两处错字，可以交付。`
        : `【${who}的结果】已完成：周边以上班族和学生为主；附近 3 家咖啡店，美式 15～22 元；报告初稿约 300 字，已写进 /check/shared/report.md。`;
      world.finish(channelId, task.id, text);
      lines.push(`- ${who}（${task.id}）：${text}`);
      results.push(text);
    }
    teams.changed(channelId);
    // The user speaks in the starter's chat once the first work came back.
    let fromUser = "";
    if (!interjected && assigned.length > 0) {
      interjected = true;
      fromUser = await interject({ items, world, say, teams, channelId });
    }
    next = [
      lines.length ? `成员交回了结果：\n${lines.join("\n")}` : "还没有成员交回结果。",
      fromUser,
      "继续：需要的话再分派，全部做完并检查后用 team_done 交回最终结果。",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  items.add(
    "T5",
    "带头的先看看板（team_board）再分派",
    seen.boardFirst === true ? "pass" : "warn",
    seen.boardFirst === null ? "没有看看板" : seen.boardFirst ? "" : "先分派后看看板",
  );
  items.add(
    "T6",
    "交接单第一次就写全六项",
    seen.firstMissing === null ? "fail" : seen.firstMissing.length === 0 ? "pass" : "warn",
    seen.firstMissing === null ? "没有分派工作" : `缺：${seen.firstMissing.join("、") || "无"}`,
  );
  items.check(
    "T7",
    "交接单少一项被退回，补全后通过",
    seen.refusedThenFixed === true,
    seen.refusedThenFixed === null ? "没有第二次分派" : seen.refusedThenFixed ? "" : "退回后仍然缺项",
  );
  items.add(
    "T8",
    "工作分派给房间里的成员（不是带头的自己，也不是房间外的人）",
    assigned.length === 0 ? "fail" : seen.strangers === 0 ? "pass" : "warn",
    `分派 ${assigned.length} 件：${assigned.map((item) => item.to).join("、")}；给错人 ${seen.strangers} 次`,
  );
  const result = done ? read(done.answer) : {};
  const toStarter = world.delivered.some((item) => item.toAgentId === STARTER);
  items.check(
    "T12",
    "带头的用 team_done 交回最终结果，结果送回发起的对话",
    Boolean(done) && result.status !== "refused" && toStarter,
    done ? `${done.answer.slice(0, 200)}；送回：${toStarter ? "是" : "否"}` : "没有调用 team_done",
  );
  const cards = world.cards.filter((card) => card.agentId === STARTER);
  const last = cards.at(-1);
  items.check(
    "T13",
    "进度卡原地更新（交接次数、步骤）",
    cards.length >= 2 && new Set(cards.map((card) => card.id)).size === 1,
    last
      ? `${cards.length} 次；${last.card.title}；${last.card.steps.map((step) => `${step.state}:${step.text}`).join(" / ")}`
      : "没有进度卡",
  );
}

/** The user's three interjections in the starter's chat. Returns the words that reach the lead. */
async function interject(context: {
  items: HxRealItems;
  world: HxTeamWorld;
  teams: HxTeams;
  channelId: string;
  say: (words: string, maxTurns?: number) => Promise<HxBrainTurn>;
}): Promise<string> {
  const { items, world, say } = context;
  const lead = world.rooms.get(context.channelId)?.lead ?? "";
  const team = (calls: readonly HxLoopCall[], action: string) =>
    calls.find((call) => call.name === "team" && field(call.args, "action") === action);

  const limits = await say(HX_TEAM_WORDS.limits, 4);
  const limitsCall = team(limits.calls, "limits");
  const minutes = field(limitsCall?.args, "minutes");
  const rounds = field(limitsCall?.args, "rounds");
  items.add(
    "T9",
    "插话“再给 30 分钟，交接加到 20 次” → team limits（70 分钟、20 次）",
    !limitsCall || read(limitsCall.answer).status !== "changed"
      ? "fail"
      : minutes === 70 && rounds === 20
        ? "pass"
        : "warn",
    limitsCall
      ? `minutes ${String(minutes)}，rounds ${String(rounds)}`
      : briefOf(limits.calls) || limits.text.slice(0, 300),
  );

  const before = world.posts.length;
  const message = await say(HX_TEAM_WORDS.message, 4);
  const messageCall = team(message.calls, "message");
  const passed = world.posts.slice(before).find((post) => post.toAgentIds.includes(lead) || post.toAgentIds.length > 0);
  items.check(
    "T10",
    "插话“跟团队说……” → team message，话传进协作房间",
    Boolean(messageCall) && read(messageCall?.answer ?? "{}").status === "sent" && Boolean(passed),
    messageCall ? messageCall.answer.slice(0, 200) : briefOf(message.calls) || message.text.slice(0, 300),
  );

  const swap = await say(HX_TEAM_WORDS.swap, 4);
  const swapCall = team(swap.calls, "swap");
  const swapped = read(swapCall?.answer ?? "{}");
  items.check(
    "T11",
    "“把写报告的成员换一个人” → team swap",
    Boolean(swapCall) && swapped.status === "swapped",
    swapCall ? swapCall.answer.slice(0, 200) : briefOf(swap.calls) || swap.text.slice(0, 300),
  );
  return passed ? `用户传话：${passed.text}` : "";
}
