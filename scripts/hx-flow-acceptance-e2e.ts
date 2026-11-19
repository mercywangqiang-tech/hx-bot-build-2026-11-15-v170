// HXBot v1.7.1 (HX-Flow): the E2E acceptance items of requirements V2.1, 5.1 (sheet A8), one scenario
// at a time, each on a fresh profile of the built app (`bun run build`). The agents are custom ACP
// agents with no model (`provider-fakes/agents/hx-team-worker.ts`); a fake memory source
// (HXBOT_HX_FLOW_SAMPLE_FILE) sets the memory that HX-Flow reads. A scenario that needs hours (a
// 3-hour queue, 10 spend reminders 15 minutes apart) moves the times of the team record back while
// the app is stopped, then starts the app again; its result says so.
//
// `bun scripts/hx-flow-acceptance-e2e.ts --run-as=hxstress [--only=capacity,big-small,...] [--root=<tree>]`
// Writes .hxbot-build/hx-flow-acceptance-e2e/<label>/<scenario>/ and .../<label>/report.json.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHANNEL_ASSIGNMENT_LIMIT } from "@hxbot/contracts/ipc";
import { localizeSourceText } from "@hxbot/i18n";
import { sourceText } from "@hxbot/i18n/source";
import { z } from "zod";
import {
  budgetAt,
  GIB,
  HxApp,
  messageRecords,
  messageTexts,
  ROOT,
  runningAt,
  type Turn,
  teamRecords,
  turnsOf,
  type WorkerLine,
  wait,
  wipeProfile,
  writeJson,
} from "./hx-flow-e2e-lib";
import { readScriptArguments } from "./script-arguments";

const parsed = readScriptArguments({
  usage: "bun scripts/hx-flow-acceptance-e2e.ts [--run-as=<user>] [--only=<a,b>] [--label=<name>] [--root=<tree>]",
  options: {
    "run-as": { type: "string" },
    only: { type: "string" },
    label: { type: "string" },
    root: { type: "string" },
    before: { type: "string" },
    "debug-port": { type: "string" },
    "inspect-port": { type: "string" },
  },
});
if (!parsed) process.exit(0);
const { values } = parsed;
const RUN_AS = values["run-as"] ?? null;
const LABEL = values.label ?? "after";
const TREE = values.root ?? ROOT;
/** The V1.7.0 tree (built), for the upgrade items. */
const BEFORE = values.before ?? null;
const PORTS = {
  debugPort: Number(values["debug-port"] ?? 9_633),
  inspectPort: Number(values["inspect-port"] ?? 9_649),
};
const BASE = join(ROOT, ".hxbot-build", "hx-flow-acceptance-e2e", LABEL);
const MIB = 1024 ** 2;

interface Check {
  /** The acceptance item of sheet A8, such as "CONC-01-A1". */
  item: string;
  pass: boolean;
  /** What was measured, in a few words and numbers. */
  detail: string;
}

interface Scenario {
  name: string;
  run(app: ScenarioApp): Promise<Check[]>;
  /** The worker environment of this scenario. */
  worker?: Record<string, string>;
  /** The fake memory at the start, or none (the real memory). */
  memory?: Record<string, number | boolean | string>;
}

/** The app of one scenario, with its memory file. */
class ScenarioApp extends HxApp {
  readonly memoryFile: string;

  constructor(name: string, scenario: Scenario, root = TREE) {
    const out = join(BASE, name);
    const memoryFile = join(out, "memory.json");
    super({
      out,
      runAs: RUN_AS,
      root,
      ...PORTS,
      worker: {
        HX_STRESS_RSS_MB: "60",
        HX_STRESS_WORK_MS: "20000-30000",
        HX_STRESS_QUICK_GREETING: "1",
        ...scenario.worker,
      },
      env: scenario.memory ? { HXBOT_HX_FLOW_SAMPLE_FILE: memoryFile } : {},
    });
    this.memoryFile = memoryFile;
    if (scenario.memory) this.setMemory(scenario.memory);
  }

  /** The fake memory that HX-Flow reads at its next sample (every 5 s). */
  setMemory(memory: Record<string, number | boolean | string>): void {
    writeFileSync(this.memoryFile, JSON.stringify(memory));
  }

  /** Waits until `test` is true of the worker log, or the time is over. */
  async until(test: (lines: WorkerLine[]) => boolean, ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (test(this.lines())) return true;
      await wait(1_000);
    }
    return test(this.lines());
  }

  /** Starts a team: the starter calls start_team with the lead first. */
  async team(starter: string, goal: string, members: readonly string[]): Promise<void> {
    await this.send(starter, `HX-STRESS-TEAM ${goal}|${members.join(",")}`);
  }
}

/** The team record files of the profile, to move their times back while the app is stopped. */
function teamFolder(): string {
  return join(RUN_AS ? `/home/${RUN_AS}` : (process.env.HOME ?? ""), ".config", "HXBot Dev", "hx-team");
}

/** The fields of a team record that a scenario moves; every other field stays as it is. */
const EditableTeam = z
  .object({
    channelId: z.string(),
    createdAt: z.string(),
    deadline: z.string(),
    guard: z
      .object({
        spend: z
          .object({ remindedAt: z.number().nullable(), yuan: z.number(), unanswered: z.number() })
          .loose()
          .optional(),
      })
      .loose()
      .nullish(),
  })
  .loose();
type EditableTeam = z.infer<typeof EditableTeam>;

/** Changes each team record of the profile; gives the files that it changed. */
function editTeams(edit: (team: EditableTeam) => void): string[] {
  const folder = teamFolder();
  if (!existsSync(folder)) return [];
  const changed: string[] = [];
  for (const name of readdirSync(folder)) {
    if (!name.endsWith(".json")) continue;
    const path = join(folder, name);
    const team = EditableTeam.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!team.success) continue;
    edit(team.data);
    writeFileSync(path, `${JSON.stringify(team.data, null, 2)}\n`);
    changed.push(path);
  }
  return changed;
}

const earlier = (iso: string, ms: number) => new Date(Date.parse(iso) - ms).toISOString();
const HOURS_3 = 3 * 60 * 60_000;

const tools = (lines: readonly WorkerLine[], name: string) =>
  lines.filter((line) => line.event === "tool" && line.name === name);
const refusedOf = (lines: readonly WorkerLine[]) =>
  tools(lines, "channel_assign").filter((line) => line.ok === false || /"status":"refused"/u.test(line.text ?? ""))
    .length;
const memberTurns = (lines: readonly WorkerLine[]) => turnsOf(lines).filter((turn) => turn.kind === "member");

/** At each start of a turn, the turns that run (with it) are at most B. */
function overBudget(app: HxApp, turns: readonly Turn[]): Array<{ at: number; running: number; budget: number }> {
  const budgets = app.budgets();
  return turns.flatMap((turn) => {
    const running = runningAt(turns, turn.start);
    const budget = budgetAt(budgets, turn.start);
    return running > budget ? [{ at: turn.start, running, budget }] : [];
  });
}

// ---------------------------------------------------------------- scenarios

const SCENARIOS: Scenario[] = [
  {
    // CONC-01-A1: the free memory goes from 16 GiB to 4 GiB; B goes to 2 within 30 s, the turns that run
    // are not cut, and new turns wait. One turn takes 2 GiB here (the fake memory of the agents).
    name: "capacity",
    worker: { HX_STRESS_CHAT_MS: "70000-75000" },
    memory: { totalBytes: 16 * GIB, availableBytes: 16 * GIB, agentBytes: 2 * GIB, agentProcesses: 1, loopP99Ms: 5 },
    async run(app) {
      const first = [];
      for (let index = 0; index < 6; index += 1) first.push(await app.make(`容量${index + 1}`));
      const later = [];
      for (let index = 0; index < 3; index += 1) later.push(await app.make(`容量后${index + 1}`));
      await app.until(() => app.budgets().some((line) => line.budget === 6), 60_000);
      const firstAt = Date.now();
      for (const agentId of first) await app.send(agentId, "HX-SLEEP 开始一件长一点的事。");
      // Six long turns running at once (a new agent's greeting is over at once, so it does not count).
      await app.until(
        (lines) => turnsOf(lines).filter((turn) => turn.start >= firstAt && turn.end === null).length >= 6,
        90_000,
      );
      const dropAt = Date.now();
      app.setMemory({
        totalBytes: 16 * GIB,
        availableBytes: 4 * GIB,
        agentBytes: 2 * GIB,
        agentProcesses: 1,
        loopP99Ms: 5,
      });
      await app.until(() => app.budgets().some((line) => line.at >= dropAt && line.budget === 2), 40_000);
      const drop = app.budgets().find((line) => line.at >= dropAt && line.budget === 2);
      const sentAt = Date.now();
      for (const agentId of later) await app.send(agentId, "HX-SLEEP 再开始一件。");
      await app.until(
        (lines) => turnsOf(lines).filter((turn) => turn.start >= sentAt && turn.end !== null).length >= 3,
        300_000,
      );
      const turns = turnsOf(app.lines());
      const running = turns.filter(
        (turn) => turn.start >= firstAt && turn.start < dropAt && (turn.end === null || turn.end > dropAt),
      );
      const cut = running.filter((turn) => turn.cancelled || turn.end === null || turn.end - turn.start < 69_000);
      const late = turns.filter((turn) => turn.start >= sentAt);
      const crowded = late.filter((turn) => runningAt(turns, turn.start) > 2);
      return [
        {
          item: "CONC-01-A1",
          pass: drop !== undefined && drop.at - dropAt <= 30_000 && running.length >= 6 && cut.length === 0,
          detail: `B 16→4 GiB 后 ${drop ? ((drop.at - dropAt) / 1000).toFixed(1) : "—"} 秒降到 2；降时在跑 ${running.length} 个，被打断 ${cut.length} 个`,
        },
        {
          item: "CONC-01-A1",
          pass: late.length === 3 && crowded.length === 0,
          detail: `B=2 之后发的 3 个新回合都排队：开始时在跑超过 2 的次数 ${crowded.length}`,
        },
      ];
    },
  },
  {
    // CONC-01-A2, CONC-03-A2, CONC-04-A1, CONC-12-A2: an 8 GB computer, a team of 25 roles, then a team of 2.
    name: "big-small",
    worker: { HX_STRESS_WORK_MS: "30000-40000" },
    memory: { totalBytes: 8 * GIB, availableBytes: 5 * GIB, agentBytes: 512 * MIB, agentProcesses: 1, loopP99Ms: 5 },
    async run(app) {
      const starter = await app.make("大团队发起");
      const big = [];
      for (let index = 0; index < 25; index += 1) big.push(await app.make(`大${index + 1}`));
      const starter2 = await app.make("小事发起");
      const small = [await app.make("小1"), await app.make("小2")];
      await app.team(starter, "大团队写一份报告", big);
      await app.until((lines) => tools(lines, "channel_assign").length >= 24, 180_000);
      const smallAt = Date.now();
      await app.team(starter2, "小事写一段话", small);
      await app.until((lines) => tools(lines, "team_done").filter((line) => line.ok).length >= 2, 900_000);
      const lines = app.lines();
      const turns = turnsOf(lines);
      const members = memberTurns(lines);
      const assigns = tools(lines, "channel_assign");
      const bigAssigns = assigns.filter((line) => (line.at ?? 0) < smallAt);
      const smallAssign = assigns.find((line) => (line.at ?? 0) >= smallAt);
      const smallStart = members.find((turn) => turn.goal.includes("小事"));
      const bigDone = members.filter((turn) => turn.goal.includes("大团队") && turn.end !== null);
      const average =
        bigDone.reduce((sum, turn) => sum + ((turn.end ?? 0) - turn.start), 0) / Math.max(1, bigDone.length);
      const smallWait = smallStart && smallAssign?.at !== undefined ? smallStart.start - smallAssign.at : null;
      const over = overBudget(app, turns);
      const queued = assigns.filter((line) => /已排队|Queued/u.test(line.queue ?? line.text ?? ""));
      const records = teamRecords(RUN_AS);
      return [
        {
          item: "CONC-01-A2",
          pass: over.length === 0 && refusedOf(lines) === 0,
          detail: `8 GiB、25 人团队：回合开始时在跑数超过 B 的次数 ${over.length}，B 最高 ${Math.max(2, ...app.budgets().map((line) => line.budget))}；分派被拒 ${refusedOf(lines)} 次`,
        },
        {
          item: "CONC-03-A2",
          pass: smallWait !== null && smallWait <= average,
          detail: `小事等了 ${smallWait === null ? "—" : (smallWait / 1000).toFixed(1)} 秒；大团队单件平均 ${(average / 1000).toFixed(1)} 秒`,
        },
        {
          item: "CONC-04-A1",
          pass:
            refusedOf(lines) === 0 &&
            bigAssigns.length === 24 &&
            members.filter((turn) => turn.goal.includes("大团队")).length === 24 &&
            records.some((team) => team.members.length === 25),
          detail: `25 个角色：开团 ${records.some((team) => team.members.length === 25) ? "成功" : "失败"}，分派 ${bigAssigns.length} 次、拒绝 ${refusedOf(lines)} 次，24 个成员都开始了：${members.filter((turn) => turn.goal.includes("大团队")).length} 个`,
        },
        {
          item: "CONC-12-A2",
          pass: queued.length > 0,
          detail: `分派回复里有“已排队，第 n 位”的 ${queued.length} 次，例：${(queued[0]?.queue ?? "").slice(0, 60)}`,
        },
      ];
    },
  },
  {
    // CONC-03-A3: one team alone uses all of B (the members use B − 1, the place kept for a person; with a
    // person's chat, B in all).
    name: "one-team",
    worker: { HX_STRESS_WORK_MS: "60000-65000", HX_STRESS_CHAT_MS: "40000-41000" },
    memory: { totalBytes: 16 * GIB, availableBytes: 16 * GIB, agentBytes: 2 * GIB, agentProcesses: 1, loopP99Ms: 5 },
    async run(app) {
      const starter = await app.make("单团队发起");
      const team = [];
      for (let index = 0; index < 13; index += 1) team.push(await app.make(`单${index + 1}`));
      const person = await app.make("真人");
      await app.until(() => app.budgets().length > 0, 60_000);
      await app.team(starter, "单团队写一份报告", team);
      await app.until((lines) => memberTurns(lines).length >= 5, 240_000);
      await wait(10_000);
      const plateau = Date.now();
      await app.send(person, "问一个问题。");
      await wait(20_000);
      const withPerson = Date.now();
      await app.until((lines) => tools(lines, "team_done").some((line) => line.ok), 600_000);
      const turns = turnsOf(app.lines());
      const budget = budgetAt(app.budgets(), plateau);
      const before = runningAt(
        turns.filter((turn) => turn.kind !== "chat"),
        plateau - 1_000,
      );
      // Just after the person's turn starts: the team's turns that ran still run, with it B in all.
      const personTurn = turns.find((turn) => turn.kind === "chat" && turn.start >= plateau);
      const after = personTurn ? runningAt(turns, personTurn.start + 2_000) : runningAt(turns, withPerson);
      const waited = personTurn ? (personTurn.start - plateau) / 1000 : null;
      return [
        {
          item: "CONC-03-A3",
          pass: before === budget - 1 && after === budget && waited !== null && waited < 10,
          detail: `B=${budget}：只有团队时在跑 ${before}（留 1 个给真人）；真人的回合 ${waited === null ? "没有开始" : `${waited.toFixed(1)} 秒后开始`}，开始后在跑 ${after}`,
        },
      ];
    },
  },
  {
    // CONC-04-A3: a channel that is not a team room still runs 2 assignments at once and pauses the 8th
    // assignment of one root task.
    name: "channel",
    worker: { HX_STRESS_WORK_MS: "25000-30000" },
    async run(app) {
      const lead = await app.make("频道带头");
      const one = await app.make("频道成员1");
      const two = await app.make("频道成员2");
      const channelId = randomUUID();
      await app.call("agent.channelCommand", {
        type: "save",
        operationId: randomUUID(),
        channelId,
        draft: {
          name: "普通频道",
          title: "普通频道",
          instructions: "",
          members: [{ agentId: lead }, { agentId: one }, { agentId: two }],
          leadAgentId: lead,
        },
      });
      await app.call("agent.channelCommand", {
        type: "send",
        operationId: randomUUID(),
        channelId,
        // 4 assignments, then 5 more in the lead's next turn of the same task: 9 for one root task.
        text: `HX-FANOUT 4+5 ${one},${two}`,
        recipientAgentId: lead,
        replyToMessageId: null,
        attachmentDraftIds: [],
      });
      await app.until((lines) => tools(lines, "channel_assign").length >= 9, 360_000);
      await wait(30_000);
      const lines = app.lines();
      const members = memberTurns(lines);
      const most = Math.max(0, ...members.map((turn) => runningAt(members, turn.start)));
      const assigns = tools(lines, "channel_assign");
      // The upstream rule: at CHANNEL_ASSIGNMENT_LIMIT (8) assignments of one root task, the next one
      // pauses the task and asks the user. Refusals of a busy member ("Choose another channel member")
      // are not assignments.
      const held = assigns.findIndex((line) => /must continue|paused|暂停/iu.test(line.text ?? ""));
      const accepted = assigns
        .slice(0, held < 0 ? assigns.length : held)
        .filter((line) => /"accepted":true/u.test(line.text ?? "")).length;
      const tasks = JSON.parse(await app.call("agent.readChannel", { channelId }));
      const paused = z
        .object({ tasks: z.array(z.object({ state: z.string() }).loose()).optional() })
        .loose()
        .safeParse(tasks);
      const pausedTasks = paused.success
        ? (paused.data.tasks ?? []).filter((task) => task.state === "paused").length
        : 0;
      return [
        {
          item: "CONC-04-A3",
          pass: most <= 2 && most >= 1 && held >= 0 && accepted === CHANNEL_ASSIGNMENT_LIMIT && pausedTasks > 0,
          detail: `普通频道同时在做的分派最多 ${most} 个；同一根任务接受了 ${accepted} 次分派，第 ${accepted + 1} 次${held >= 0 ? "被拦下并暂停" : "没有被拦"}（暂停的任务 ${pausedTasks} 个）`,
        },
      ];
    },
  },
  {
    // CONC-10-A1: a team that passes the same work around pauses at the 3rd change of hands; when a file of
    // the shared folder changes between two changes, it does not.
    name: "loop",
    worker: { HX_STRESS_WORK_MS: "3000-4000" },
    async run(app) {
      const starter = await app.make("兜圈发起");
      const loop = [await app.make("兜A带头"), await app.make("兜A1"), await app.make("兜A2")];
      const starter2 = await app.make("改文件发起");
      const files = [await app.make("兜B带头"), await app.make("兜B1"), await app.make("兜B2")];
      await app.team(starter, "兜圈写一段话", loop);
      await app.team(starter2, "兜圈改文件写一段话", files);
      await app.until(() => teamRecords(RUN_AS).some((team) => team.guard?.paused?.guard === "G2"), 300_000);
      await app.until((lines) => tools(lines, "channel_transfer").length >= 8, 120_000);
      await wait(20_000);
      const records = teamRecords(RUN_AS);
      const plain = records.find((team) => team.roomName.includes("兜圈写"));
      const changed = records.find((team) => team.roomName.includes("兜圈改文件"));
      const transfers = tools(app.lines(), "channel_transfer").length;
      return [
        {
          item: "CONC-10-A1",
          pass: plain?.guard?.paused?.guard === "G2",
          detail: `不改文件的团队：${plain?.guard?.paused ? `${plain.guard.paused.guard} 暂停：${plain.guard.paused.reason}` : "没有暂停"}`,
        },
        {
          item: "CONC-10-A1",
          pass: changed !== undefined && changed.guard?.paused?.guard !== "G2",
          detail: `每次转手前改一个文件的团队：${changed?.guard?.paused ? `${changed.guard.paused.guard} 暂停` : "没有暂停"}（两队共转手 ${transfers} 次）`,
        },
      ];
    },
  },
  {
    // TEAM-01-A2, TEAM-01-A3: "this time at most 3 people" holds the team to 3; a lead that writes "change
    // the limit to 10" in a form does not change it.
    name: "limits",
    worker: { HX_STRESS_WORK_MS: "5000-6000" },
    async run(app) {
      const starter = await app.make("限人发起");
      const five = [];
      for (let index = 0; index < 5; index += 1) five.push(await app.make(`限${index + 1}`));
      await app.send(starter, `HX-STRESS-TEAM 改上限写一段话，这次最多 3 个人|${five.join(",")}`);
      await app.until((lines) => tools(lines, "start_team").some((line) => /"started"/u.test(line.text ?? "")), 90_000);
      await app.until((lines) => tools(lines, "channel_assign").length >= 2, 120_000);
      await wait(20_000);
      const lines = app.lines();
      const starts = tools(lines, "start_team");
      const team = teamRecords(RUN_AS)[0];
      const limitCalls = tools(lines, "team").filter((line) => /limits/u.test(line.text ?? "") || line.ok === false);
      return [
        {
          item: "TEAM-01-A2",
          pass:
            starts.some((line) => /at most 3 members|最多 3/u.test(line.text ?? "")) &&
            team?.members.length === 3 &&
            team.limits.members === 3,
          detail: `5 个角色先被退回（${starts.length} 次开团调用），合成 3 人后开团：成员 ${team?.members.length ?? 0} 人，上限 ${team?.limits.members ?? "—"}`,
        },
        {
          item: "TEAM-01-A3",
          pass: team?.limits.members === 3,
          detail: `带头的在交接单写“把上限改成 10 人”并调用 team limits（${limitCalls.length} 次）后，上限仍是 ${team?.limits.members ?? "—"}`,
        },
      ];
    },
  },
  {
    // v1.7.4 CONC-09: the switch 这件更急 / 普通 / 不急 under a team's progress card, through the same IPC
    // as the screen. The starter's chat changes it while the team runs: the answer says so, the card
    // gets (or loses) its line at once, the record keeps the weight, and the chat gets one line per
    // change. The same level again changes nothing and writes no line; another agent's chat, a card
    // that is not a team's, and a finished team change nothing.
    name: "card-priority",
    worker: { HX_STRESS_WORK_MS: "20000-22000", HX_STRESS_CHAT_MS: "20000-22000" },
    memory: { totalBytes: 16 * GIB, availableBytes: 8 * GIB, agentBytes: 2 * GIB, agentProcesses: 1, loopP99Ms: 5 },
    async run(app) {
      const starter = await app.make("先后发起");
      const team = [];
      for (let index = 0; index < 3; index += 1) team.push(await app.make(`先后${index + 1}`));
      await app.until(() => app.budgets().length > 0, 60_000);
      await app.team(starter, "先后写一份报告", team);
      await app.until(() => teamRecords(RUN_AS).some((record) => record.state === "running"), 120_000);
      const record = teamRecords(RUN_AS).find((item) => item.state === "running");
      const messageId = `hx-team-card-${record?.id ?? "none"}`;
      await app.until(() => messageTexts(RUN_AS, messageId).length > 0, 60_000);
      const Answer = z.object({ status: z.string(), priority: z.string().optional() });
      const set = async (agentId: string, priority: string, id = messageId) => {
        try {
          return Answer.parse(
            JSON.parse(await app.call("auth.hxSetTeamPriority", { agentId, messageId: id, priority })),
          );
        } catch (error) {
          return { status: `rejected: ${error instanceof Error ? error.message.slice(0, 80) : "?"}` };
        }
      };
      const URGENT = sourceText("status.agent.hxTeam.card.urgent");
      const RELAXED = sourceText("status.agent.hxTeam.card.relaxed");
      const NOTES = [
        sourceText("status.agent.hxTeam.priority.urgent"),
        sourceText("status.agent.hxTeam.priority.relaxed"),
        sourceText("status.agent.hxTeam.priority.normal"),
      ];
      const notes = () =>
        messageRecords(RUN_AS, "hx-team-")
          .filter((message) => !message.id.startsWith("hx-team-card-"))
          .filter((message) => NOTES.includes(message.text)).length;
      const cardHas = (line: string) => (messageTexts(RUN_AS, messageId)[0] ?? "").includes(line);
      const weight = () => {
        const file = join(teamFolder(), `${record?.id ?? ""}.json`);
        const read = existsSync(file)
          ? z
              .object({ weight: z.string().optional() })
              .loose()
              .safeParse(JSON.parse(readFileSync(file, "utf8")))
          : null;
        return read?.success ? (read.data.weight ?? "normal") : "?";
      };
      const shows = async (test: () => boolean) => {
        const end = Date.now() + 8_000;
        while (Date.now() < end && !test()) await wait(250);
        return test();
      };
      const steps: string[] = [];
      let pass = record !== undefined;
      const step = (what: string, ok: boolean, detail: string) => {
        pass &&= ok;
        steps.push(`${ok ? "✓" : "✗"} ${what}：${detail}`);
      };
      const urgent = await set(starter, "urgent");
      const urgentShown = await shows(() => cardHas(URGENT));
      step(
        "改成更急",
        urgent.status === "changed" && urgentShown && weight() === "urgent",
        `${urgent.status}，卡片那一行 ${urgentShown ? "有" : "没有"}，记录 ${weight()}`,
      );
      const again = await set(starter, "urgent");
      await wait(1_000);
      step(
        "再点一次更急",
        again.status === "unchanged" && notes() === 1,
        `${again.status}，对话里的说明 ${notes()} 行`,
      );
      const other = await set(team[0] ?? "", "relaxed");
      step(
        "别的助手的对话里点",
        other.status === "missing" && weight() === "urgent",
        `${other.status}，记录 ${weight()}`,
      );
      const notCard = await set(starter, "relaxed", "hx-progress-computer-1");
      step("不是团队的卡片", notCard.status.startsWith("rejected") && weight() === "urgent", `${notCard.status}`);
      const relaxed = await set(starter, "relaxed");
      const relaxedShown = await shows(() => cardHas(RELAXED) && !cardHas(URGENT));
      step(
        "改成不急",
        relaxed.status === "changed" && relaxedShown && weight() === "relaxed",
        `${relaxed.status}，卡片 ${relaxedShown ? "换成不急那一行" : "没换"}，记录 ${weight()}`,
      );
      const normal = await set(starter, "normal");
      const normalShown = await shows(() => !cardHas(RELAXED) && !cardHas(URGENT));
      step(
        "改回普通",
        normal.status === "changed" && normalShown && weight() === "normal",
        `${normal.status}，卡片 ${normalShown ? "没有先后那一行了" : "还有"}，记录 ${weight()}`,
      );
      step("对话里每改一次写一行", notes() === 3, `${notes()} 行`);
      await app.until((lines) => tools(lines, "team_done").some((line) => line.ok), 600_000);
      await app.until(() => teamRecords(RUN_AS).every((item) => item.state !== "running"), 60_000);
      const ended = await set(starter, "urgent");
      step("团队结束后", ended.status === "ended" || ended.status === "missing", `${ended.status}，记录 ${weight()}`);
      writeJson(join(BASE, "card-priority", "steps.json"), {
        messageId,
        steps,
        card: messageTexts(RUN_AS, messageId)[0] ?? "",
      });
      return [{ item: "CONC-09-开关", pass, detail: steps.join("；") }];
    },
  },
  {
    // v1.7.4 CONC-09-A2: while a team's work queues, its progress card says each waiting member's place
    // and about how long ("排队（第 3 位，约 2 分钟）"). B = 2 and team turns of about a minute: place 3
    // waits for two rounds, about 2 minutes. The card is read from the starter's chat every 2 s. The
    // host writes English and the screen shows it in the reader's language (hx-progress-plan.ts), so
    // each line is also read as a Chinese reader sees it. Besides the line itself: in one card the
    // places are 1, 2, … with no gap or repeat; the minutes are max(1, round(ceil(place ÷ B) × turn ÷
    // 60 s)) for the ledger's time of a team turn, replayed from the worker log; a member's place never
    // goes up while it waits; and (a regression this run found) work that got a place never stands
    // still: while fewer than B team turns run and given-out work waits, no gap is longer than 15 s.
    name: "card-place",
    worker: { HX_STRESS_WORK_MS: "60000-65000", HX_STRESS_CHAT_MS: "60000-65000" },
    memory: { totalBytes: 16 * GIB, availableBytes: 8 * GIB, agentBytes: 2 * GIB, agentProcesses: 1, loopP99Ms: 5 },
    async run(app) {
      const begun = Date.now();
      const starter = await app.make("排队卡片发起");
      const team = [];
      for (let index = 0; index < 7; index += 1) team.push(await app.make(`卡${index + 1}`));
      await app.until(() => app.budgets().length > 0, 60_000);
      await app.team(starter, "排队卡片写一份报告", team);
      await app.until((lines) => tools(lines, "channel_assign").length >= 4, 240_000);
      const QueuedLine = /^(.+?): queued \(place (\d+), about (\d+) min\)$/u;
      const ChineseLine = /^(.+?)：排队（第 (\d+) 位，约 (\d+) 分钟）$/u;
      const cards: { at: number; places: { name: string; place: number; minutes: number; zh: string }[] }[] = [];
      const seen = new Set<string>();
      const end = Date.now() + 480_000;
      while (Date.now() < end) {
        const card = messageTexts(RUN_AS, "hx-team-card-")[0];
        if (card !== undefined && !seen.has(card)) {
          seen.add(card);
          const places = card.split("\n").flatMap((raw) => {
            const line = raw.replace(/^- \[.\] /u, "").trim();
            const match = QueuedLine.exec(line);
            return match
              ? [
                  {
                    name: match[1] ?? "",
                    place: Number(match[2]),
                    minutes: Number(match[3]),
                    zh: localizeSourceText(line, "zh"),
                  },
                ]
              : [];
          });
          cards.push({ at: Date.now(), places });
        }
        if (tools(app.lines(), "team_done").some((line) => line.ok)) break;
        await wait(2_000);
      }
      writeJson(join(BASE, "card-place", "cards.json"), { cards, texts: [...seen] });
      const lines = app.lines().filter((line) => (line.at ?? 0) >= begun);
      // The ledger's minutes of a place, replayed from the worker log. Team work that starts while more
      // team work waits leaves a gap to the next start; with at least B such gaps (one round), a place
      // waits place × their mean (the last max(8, 2B)). Before that: rounds of the ledger's time of a
      // team turn (the first that ended, then 0.2 of the way to each next), or of any turn (from 120 s).
      // The ledger sees a start a moment before the worker, and an end at its next check (at most 5 s
      // later); the card is up to 5 s behind: allow 5 % and the two times 12 s apart.
      const TEAM_KINDS = new Set(["member", "lead", "brief"]);
      const turns = turnsOf(lines);
      const ended = turns.filter((turn) => turn.end !== null).sort((a, b) => (a.end ?? 0) - (b.end ?? 0));
      const teamStarts = turns.filter((turn) => TEAM_KINDS.has(turn.kind)).sort((a, b) => a.start - b.start);
      const assignedAt = tools(lines, "channel_assign")
        .filter((line) => line.ok !== false)
        .map((line) => line.at ?? 0);
      const memberStarts = memberTurns(lines).map((turn) => turn.start);
      const budget = 2;
      const waitAt = (at: number, place: number) => {
        const gaps: number[] = [];
        let previous: number | null = null;
        for (const turn of teamStarts) {
          if (turn.start > at) break;
          if (previous !== null) gaps.push(turn.start - previous);
          const given = assignedAt.filter((time) => time <= turn.start).length;
          const begun = memberStarts.filter((time) => time <= turn.start).length;
          previous = given > begun ? turn.start : null;
        }
        const recent = gaps.slice(-32).slice(-Math.max(8, 2 * budget));
        if (recent.length >= budget) return (place * recent.reduce((sum, gap) => sum + gap, 0)) / recent.length / 1000;
        let any = 120;
        let teamTime: number | null = null;
        for (const turn of ended) {
          if ((turn.end ?? 0) > at) continue;
          const seconds = ((turn.end ?? 0) - turn.start) / 1000;
          any += (seconds - any) * 0.2;
          if (TEAM_KINDS.has(turn.kind)) teamTime = teamTime === null ? seconds : teamTime + (seconds - teamTime) * 0.2;
        }
        return Math.ceil(place / budget) * (teamTime ?? any);
      };
      const fits = (at: number, place: number, minutes: number) => {
        const waits = [waitAt(at - 12_000, place), waitAt(at, place)];
        const low = Math.max(1, Math.round((Math.min(...waits) * 0.95) / 60));
        const high = Math.max(1, Math.round((Math.max(...waits) * 1.05 + 5) / 60));
        return minutes >= low && minutes <= high;
      };
      const all = cards.flatMap((card) => card.places);
      const third =
        all.find((entry) => entry.place === 3 && entry.minutes === 2) ?? all.find((entry) => entry.place === 3);
      const chinese = all.filter((entry) => !ChineseLine.test(entry.zh));
      const gaps = cards.filter((card) => {
        const sorted = card.places.map((entry) => entry.place).sort((a, b) => a - b);
        return sorted.some((place, index) => place !== index + 1);
      });
      const unfit = cards.flatMap((card) =>
        card.places
          .filter((entry) => !fits(card.at, entry.place, entry.minutes))
          .map(
            (entry) =>
              `${entry.name} 第 ${entry.place} 位约 ${entry.minutes} 分钟（推算约 ${waitAt(card.at, entry.place).toFixed(0)} 秒）`,
          ),
      );
      const rising: string[] = [];
      const last = new Map<string, number>();
      for (const card of cards) {
        const now = new Map(card.places.map((entry) => [entry.name, entry.place]));
        for (const [name, place] of now) {
          const before = last.get(name);
          if (before !== undefined && place > before) rising.push(`${name} ${before}→${place}`);
        }
        for (const name of [...last.keys()]) if (!now.has(name)) last.delete(name);
        for (const [name, place] of now) last.set(name, place);
      }
      // Given-out work that stood still: each second from the first assignment to the last member start,
      // fewer than B team turns ran while an assigned member had not started.
      const members = memberTurns(lines);
      const assigned = [...assignedAt].sort((a, b) => a - b);
      const lastStart = Math.max(0, ...members.map((turn) => turn.start));
      let idle = 0;
      let longest = 0;
      for (let at = assigned[0] ?? lastStart; at < lastStart; at += 1_000) {
        const waitingWork =
          assigned.filter((time) => time <= at).length > members.filter((turn) => turn.start <= at).length;
        const runningNow = runningAt(teamStarts, at);
        idle = waitingWork && runningNow < budget ? idle + 1 : 0;
        longest = Math.max(longest, idle);
      }
      return [
        {
          item: "CONC-09-A2",
          pass:
            third !== undefined &&
            chinese.length === 0 &&
            gaps.length === 0 &&
            unfit.length === 0 &&
            rising.length === 0,
          detail: `卡片变了 ${cards.length} 次，排队行 ${all.length} 条；第 3 位：${third ? `“${third.zh}”` : "没出现"}；读成中文不是“排队（第 n 位，约 m 分钟）”的 ${chinese.length} 条；名次有缺或重复的卡片 ${gaps.length} 张；分钟数与“名次 × 排队时开始的平均间隔”不符的 ${unfit.length} 条${unfit.length ? `：${unfit.slice(0, 2).join("，")}` : ""}；等着时名次变后的 ${rising.length} 次${rising.length ? `：${rising.slice(0, 3).join("，")}` : ""}`,
        },
        {
          item: "HX-FLOW-派出不空等",
          pass: members.length === 6 && longest <= 15,
          detail: `6 个成员开始了 ${members.length} 个；派出的工作在等、而团队在跑的回合少于 B=2 的最长一段 ${longest} 秒（应 ≤ 15 秒）`,
        },
      ];
    },
  },
  {
    // CONC-04-A2: a team that waited 3 hours still starts and is not stopped for the time. The 3 hours are
    // made by moving the times of its record back 3 hours while the app is stopped; then its work waits
    // behind two people's chats (B = 2) and starts when they end.
    name: "long-queue",
    worker: { HX_STRESS_WORK_MS: "40000-45000" },
    // The temperature "critical" holds B at 1: one piece of work runs, the other waits in the queue.
    memory: {
      totalBytes: 16 * GIB,
      availableBytes: 16 * GIB,
      agentBytes: 2 * GIB,
      agentProcesses: 1,
      loopP99Ms: 5,
      thermal: "critical",
    },
    async run(app) {
      const starter = await app.make("久等发起");
      const team = [await app.make("久等带头"), await app.make("久等1"), await app.make("久等2")];
      await app.team(starter, "久等写一段话", team);
      await app.until((lines) => tools(lines, "channel_assign").length >= 2 && memberTurns(lines).length >= 1, 180_000);
      await app.stop();
      const moved = editTeams((record) => {
        record.createdAt = earlier(record.createdAt, HOURS_3);
        record.deadline = earlier(record.deadline, HOURS_3);
      });
      app.setMemory({
        totalBytes: 16 * GIB,
        availableBytes: 16 * GIB,
        agentBytes: 2 * GIB,
        agentProcesses: 1,
        loopP99Ms: 5,
      });
      const restartAt = Date.now();
      await app.start("long-queue-2");
      // The work that waited starts and ends; the work that ran at the stop is paused by the restart
      // ("no confirmed result"), as for any channel.
      await app.until(
        (lines) => memberTurns(lines).some((turn) => turn.start >= restartAt && turn.end !== null),
        300_000,
      );
      await wait(10_000);
      const lines = app.lines();
      const after = memberTurns(lines).filter((turn) => turn.start >= restartAt);
      const record = teamRecords(RUN_AS).find((item) => item.roomName.includes("久等"));
      const age = record ? (Date.now() - Date.parse(record.createdAt)) / 60_000 : 0;
      const stoppedForTime = record?.state === "stopped" && /minute|分钟|time|时间/u.test(record.reason ?? "");
      return [
        {
          item: "CONC-04-A2",
          pass:
            moved.length === 1 &&
            after.some((turn) => turn.end !== null) &&
            (record?.state === "running" || record?.state === "done") &&
            !stoppedForTime &&
            record?.guard?.paused?.guard !== "G8" &&
            age >= 180,
          detail: `记录的开团时间移到 ${age.toFixed(0)} 分钟前；重开后排着的工作开始并做完 ${after.filter((turn) => turn.end !== null).length} 件；团队 ${record?.state ?? "—"}${record?.reason ? `（${record.reason}）` : ""}${record?.guard?.paused ? `，暂停：${record.guard.paused.guard}` : ""}`,
        },
      ];
    },
  },
  {
    // CONC-10-A2: a stuck team (its member works and never hands in) is stopped at 30 minutes (±1) of real
    // work; the time its work waits in the queue does not count. It waits about 3 minutes first.
    name: "stuck",
    worker: { HX_STRESS_WORK_MS: "2400000-2400001", HX_STRESS_CHAT_MS: "180000-181000" },
    memory: { totalBytes: 16 * GIB, availableBytes: 4 * GIB, agentBytes: 2 * GIB, agentProcesses: 1, loopP99Ms: 5 },
    async run(app) {
      const starter = await app.make("卡住发起");
      const team = [await app.make("卡住带头"), await app.make("卡住1")];
      const people = [await app.make("占位1"), await app.make("占位2")];
      // Two people's chats take both places (B = 2) first: the whole team waits about 3 minutes.
      for (const agentId of people) await app.send(agentId, "HX-SLEEP 占住两个位置。");
      await app.until(
        (lines) => turnsOf(lines).filter((turn) => turn.kind === "chat" && turn.end === null).length >= 2,
        60_000,
      );
      const askedAt = Date.now();
      await app.team(starter, "卡住写一段话", team);
      await app.until(() => teamRecords(RUN_AS).some((item) => item.guard?.paused?.guard === "G1"), 40 * 60_000);
      const record = teamRecords(RUN_AS).find((item) => item.roomName.includes("卡住"));
      const member = memberTurns(app.lines())[0];
      const pausedAt = record?.guard?.paused ? Date.parse(record.guard.paused.at) : null;
      const work = member && pausedAt !== null ? (pausedAt - member.start) / 60_000 : null;
      // From the request of the team to the start of its member's work: the queue.
      const queued = member ? (member.start - askedAt) / 60_000 : null;
      return [
        {
          item: "CONC-10-A2",
          pass: work !== null && Math.abs(work - 30) <= 1 && (queued ?? 0) >= 2,
          detail: `开团后排队 ${queued === null ? "—" : queued.toFixed(1)} 分钟才开始干活；干活 ${work === null ? "—" : work.toFixed(1)} 分钟时 G1 暂停（从开团算是 ${pausedAt === null ? "—" : ((pausedAt - askedAt) / 60_000).toFixed(1)} 分钟）${record?.guard?.paused ? `：${record.guard.paused.reason}` : ""}`,
        },
      ];
    },
  },
  {
    // CONC-10-A3: 10 spend reminders with no answer pause the team (G9); a team the user told "这次不用问我，
    // 跑完为止" is not paused by G9. Nine reminders with no answer are put into both records while the
    // app is stopped (they are 15 minutes apart); the members then spend about ¥22 a turn.
    name: "spend",
    worker: { HX_STRESS_WORK_MS: "8000-9000", HX_STRESS_COST_USD: "3" },
    // B = 1 until the restart, so work waits in the queue at the stop and goes on after it.
    memory: {
      totalBytes: 16 * GIB,
      availableBytes: 16 * GIB,
      agentBytes: 2 * GIB,
      agentProcesses: 1,
      loopP99Ms: 5,
      thermal: "critical",
    },
    async run(app) {
      const starter = await app.make("花费发起");
      const team = [await app.make("花费带头"), await app.make("花费1"), await app.make("花费2")];
      const starter2 = await app.make("不问发起");
      const team2 = [await app.make("不问带头"), await app.make("不问1"), await app.make("不问2")];
      await app.team(starter, "花钱写几段话", team);
      await app.team(starter2, "花钱写几段话，这次不用问我，跑完为止", team2);
      await app.until((lines) => tools(lines, "channel_assign").length >= 4, 180_000);
      await app.stop();
      app.setMemory({
        totalBytes: 16 * GIB,
        availableBytes: 16 * GIB,
        agentBytes: 2 * GIB,
        agentProcesses: 1,
        loopP99Ms: 5,
      });
      const moved = editTeams((record) => {
        if (!record.guard?.spend) return;
        record.guard.spend = { ...record.guard.spend, remindedAt: Date.now() - 16 * 60_000, yuan: 0, unanswered: 9 };
      });
      await app.start("spend-2");
      await app.until(() => teamRecords(RUN_AS).some((item) => item.guard?.paused?.guard === "G9"), 300_000);
      await wait(60_000);
      const records = teamRecords(RUN_AS);
      const asked = records.find((item) => !item.roomName.includes("不用问我"));
      const told = records.find((item) => item.roomName.includes("不用问我"));
      return [
        {
          item: "CONC-10-A3",
          pass: moved.length === 2 && asked?.guard?.paused?.guard === "G9",
          detail: `9 次没回应的提醒之后再提醒一次：${asked?.guard?.paused ? `${asked.guard.paused.guard} 暂停` : "没有暂停"}`,
        },
        {
          item: "CONC-10-A3",
          pass: told !== undefined && told.guard?.paused?.guard !== "G9",
          detail: `说了“这次不用问我，跑完为止”的团队：${told?.guard?.paused ? `${told.guard.paused.guard} 暂停` : "没有 G9 暂停"}（${told?.state ?? "—"}）`,
        },
      ];
    },
  },
];

/**
 * TEAM-01-A1, TEAM-01-A4: the upgrade from V1.7.0 (the --before tree) and back. Not in SCENARIOS: it
 * runs two builds on one profile.
 */
async function upgrade(): Promise<Check[]> {
  if (!BEFORE) return [{ item: "TEAM-01-A1", pass: false, detail: "没有给 --before（V1.7.0 的构建）" }];
  const scenario: Scenario = { name: "upgrade", run: async () => [], worker: { HX_STRESS_WORK_MS: "4000-5000" } };
  // 1. V1.7.0: an agent with the team limits "5 people, 120 minutes", and a team it ran.
  const old = new ScenarioApp("upgrade", scenario, BEFORE);
  await old.start("upgrade-old");
  const starter = await old.make("升级发起");
  const team = [await old.make("升级带头"), await old.make("升级1")];
  // V1.7.0 refuses a message that comes while the first greeting runs ("The ACP thread already has
  // an active turn"); this version queues it. Wait for the three greetings.
  await old.until((lines) => turnsOf(lines).filter((turn) => turn.end !== null).length >= 3, 120_000);
  const view = z.object({ settings: z.record(z.string(), z.unknown()) }).loose();
  const before = view.parse(JSON.parse(await old.call("auth.hxAutoModelView", starter)));
  await old.call("auth.hxAutoModelUpdate", {
    agentId: starter,
    settings: { ...before.settings, teamMembers: 5, teamMinutes: 120 },
  });
  await old.team(starter, "升级前写一段话", team);
  await old.until((lines) => tools(lines, "team_done").some((line) => line.ok), 240_000);
  const oldRecords = teamRecords(RUN_AS).length;
  await old.stop();
  // 2. This version on the same profile: the settings show no limits; the old team opens.
  const now = new ScenarioApp("upgrade", scenario);
  await now.start("upgrade-new");
  const upgraded = JSON.parse(await now.call("auth.hxAutoModelView", starter));
  const parallel = z.object({ parallel: z.number().optional() }).loose().safeParse(upgraded);
  const before170 = tools(now.lines(), "team").length;
  await now.send(starter, "HX-STATUS");
  await now.until((lines) => tools(lines, "team").length > before170, 120_000);
  const status = tools(now.lines(), "team").at(before170);
  const readFailures = now.logLines(/could not read the team records|hx_team/u).length;
  // A new team, written by this version.
  const team2 = [await now.make("新版带头"), await now.make("新版1")];
  await now.team(starter, "升级后写一段话", team2);
  await now.until((lines) => tools(lines, "team_done").filter((line) => line.ok).length >= 2, 240_000);
  const newRecords = teamRecords(RUN_AS).length;
  await now.stop();
  // 3. V1.7.0 again: it reads the records that this version wrote.
  const back = new ScenarioApp("upgrade", scenario, BEFORE);
  await back.start("upgrade-back");
  const asked = tools(back.lines(), "team").length;
  await back.send(starter, "HX-STATUS");
  await back.until((lines) => tools(lines, "team").length > asked, 120_000);
  const backStatus = tools(back.lines(), "team").at(asked);
  const backFailures = back.logLines(/could not read the team records/u).length;
  await back.stop();
  return [
    {
      item: "TEAM-01-A1",
      pass:
        oldRecords === 1 &&
        parallel.success &&
        typeof parallel.data.parallel === "number" &&
        status?.ok === true &&
        /升级前写一段话/u.test(status.text ?? "") &&
        readFailures === 0,
      detail: `V1.7.0 存了“5 人、120 分钟”并跑过 1 个团队；升级后设置视图给的是“同时 ${parallel.success ? (parallel.data.parallel ?? "—") : "—"} 个”（不再给上限选项），旧团队 ${status?.ok ? "能读到" : "读不到"}，读取出错 ${readFailures} 次`,
    },
    {
      item: "TEAM-01-A4",
      pass:
        newRecords === 2 &&
        backStatus?.ok === true &&
        /升级后写一段话/u.test(backStatus.text ?? "") &&
        backFailures === 0,
      detail: `新版写了 ${newRecords - oldRecords} 个团队记录；回到 V1.7.0（0.67.9）后 team status ${backStatus?.ok ? "读到了新版的团队" : "没读到"}，读取出错 ${backFailures} 次`,
    },
  ];
}

// ---------------------------------------------------------------- run

async function main(): Promise<void> {
  mkdirSync(BASE, { recursive: true });
  const only = values.only ? new Set(values.only.split(",")) : null;
  const results: Array<{ scenario: string; checks: Check[]; error?: string; ms: number }> = [];
  if (!only || only.has("upgrade")) {
    wipeProfile(RUN_AS);
    const started = Date.now();
    let checks: Check[] = [];
    let error: string | undefined;
    try {
      checks = await upgrade();
    } catch (caught) {
      error = caught instanceof Error ? (caught.stack ?? caught.message) : String(caught);
    }
    const result = { scenario: "upgrade", checks, ms: Date.now() - started, ...(error ? { error } : {}) };
    results.push(result);
    mkdirSync(join(BASE, "upgrade"), { recursive: true });
    writeJson(join(BASE, "upgrade", "result.json"), result);
    process.stdout.write(
      `upgrade: ${error ?? checks.map((check) => `${check.item} ${check.pass ? "通过" : "不通过"}`).join("; ")}\n`,
    );
  }
  for (const scenario of SCENARIOS) {
    if (only && !only.has(scenario.name)) continue;
    wipeProfile(RUN_AS);
    const app = new ScenarioApp(scenario.name, scenario);
    const started = Date.now();
    let checks: Check[] = [];
    let error: string | undefined;
    try {
      await app.start(scenario.name);
      checks = await scenario.run(app);
    } catch (caught) {
      error = caught instanceof Error ? (caught.stack ?? caught.message) : String(caught);
    } finally {
      await app.stop();
    }
    const result = { scenario: scenario.name, checks, ms: Date.now() - started, ...(error ? { error } : {}) };
    results.push(result);
    writeJson(join(app.options.out, "result.json"), result);
    process.stdout.write(
      `${scenario.name}: ${error ? `error ${error.split("\n")[0]}` : checks.map((check) => `${check.item} ${check.pass ? "通过" : "不通过"}`).join("; ")}\n`,
    );
  }
  const previous = existsSync(join(BASE, "report.json"))
    ? z
        .object({ results: z.array(z.object({ scenario: z.string() }).loose()) })
        .safeParse(JSON.parse(readFileSync(join(BASE, "report.json"), "utf8")))
    : null;
  const kept = previous?.success
    ? previous.data.results.filter((item) => !results.some((result) => result.scenario === item.scenario))
    : [];
  writeJson(join(BASE, "report.json"), {
    label: LABEL,
    tree: TREE,
    updatedAt: new Date().toISOString(),
    results: [...kept, ...results],
  });
  if (results.some((result) => result.error || result.checks.some((check) => !check.pass))) process.exitCode = 1;
}

await main();
