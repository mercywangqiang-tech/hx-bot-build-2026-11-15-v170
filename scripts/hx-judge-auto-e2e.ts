// HXBot (v1.7.5, CONC-16): the judge's automatic mode, on the real team service (HxTeams) with a fake host
// for the rooms and agents, on a temporary folder. The judge is the boundary: its answer is set here (no
// model is called), and the time of real work moves by the team's own 30-second look.
//
// - CONC-16-A1: without the conditions (a passed model and 5 agreements in a row on this computer) the
//   team's card has no automatic-mode choice, and a click on it is refused; with them, the card offers it
//   and only the click turns it on.
// - CONC-16-A2: in automatic mode a "continue" lets the team go on twice for the same cause, each check
//   sooner; the third time of the same cause you are asked.
// - Two stops after the judge let teams go on bring the cause back to advice. G8 and G9 never go to it.
//
// Run: bun scripts/hx-judge-auto-e2e.ts
// Writes .hxbot-build/hx-judge-auto-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HX_AUTO_DEFAULTS } from "@hxbot/contracts/hx-auto-model";
import type { HxProgressCard } from "@hxbot/contracts/hx-progress";
import type { ChannelMessage, ChannelTask } from "@hxbot/contracts/ipc";
import { hxAutoRouter } from "../src/backend/hx-auto-model/router";
import { hxLearned } from "../src/backend/hx-flow/learned";
import { hxFlow } from "../src/backend/hx-flow/ledger";
import {
  type HxTeamAgent,
  type HxTeamAnswer,
  type HxTeamPort,
  HxTeams,
  hxTeamCardId,
} from "../src/backend/hx-team/service";
import { HxTeamStore } from "../src/backend/hx-team/store";

const OUT = resolve(import.meta.dirname, "../.hxbot-build/hx-judge-auto-e2e");
const MODEL = { provider: "claude", model: "claude-haiku-5-5", name: "Claude Haiku 5.5" };

interface Report {
  checks: string[];
  passed: boolean;
  failure?: string;
}
const report: Report = { checks: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail).slice(0, 2_000)}`}`);
  report.checks.push(name);
};

const directory = await mkdtemp(join(tmpdir(), "hxbot-hx-judge-auto-"));
const teamsFolder = join(directory, "teams");

interface Room {
  members: string[];
  lead: string;
  archived: boolean;
  tasks: ChannelTask[];
  messages: ChannelMessage[];
}

function task(id: string, channelId: string, ownerAgentId: string | null, state: ChannelTask["state"]): ChannelTask {
  return {
    id,
    channelId,
    parentTaskId: null,
    rootTaskId: id,
    ownerAgentId,
    requestMessageId: "m",
    instruction: "Do the part",
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

function agent(id: string, name: string, title: string, description: string): HxTeamAgent {
  return {
    id,
    name,
    title,
    description,
    hidden: false,
    busy: false,
    workspacePath: join(directory, id),
    model: "m",
    computerUse: true,
  };
}

/** The rooms and agents of the host, in memory. */
class Port implements HxTeamPort {
  notes: string[] = [];
  asked: string[] = [];
  cards = new Map<string, HxProgressCard>();
  agentList: HxTeamAgent[] = [
    agent("ada", "Ada", "Front desk", "Talks to the person"),
    agent("writer", "Wang", "Writing", "Writes articles and reports"),
    agent("planner", "Li", "Planning", "Plans the work and checks it"),
  ];
  rooms = new Map<string, Room>();
  posts = 0;
  agents() {
    return this.agentList;
  }
  settings() {
    return HX_AUTO_DEFAULTS;
  }
  roleModel() {
    return null;
  }
  async createAgent(input: { name: string }) {
    const id = `made-${this.agentList.length + 1}`;
    this.agentList.push(agent(id, input.name, "", ""));
    return { id, name: input.name };
  }
  async setHidden() {}
  async createRoom(input: { channelId: string; memberIds: string[]; leadAgentId: string }) {
    this.rooms.set(input.channelId, {
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
  async post(input: { channelId: string; toAgentIds: string[] }) {
    this.posts += 1;
    const room = this.rooms.get(input.channelId);
    if (room) room.tasks.push(task(`root-${this.posts}`, input.channelId, input.toAgentIds[0] ?? null, "running"));
  }
  room(channelId: string) {
    const room = this.rooms.get(channelId);
    return room
      ? { exists: true, archived: room.archived, tasks: room.tasks, messages: room.messages }
      : { exists: false, archived: false, tasks: [], messages: [] };
  }
  async command(input: { channelId: string; type: "stop" | "cancel" | "reassign"; taskId: string }) {
    const found = this.rooms.get(input.channelId)?.tasks.find((item) => item.id === input.taskId);
    if (found && input.type === "stop") found.state = "paused";
    if (found && input.type === "cancel") found.state = "cancelled";
  }
  async deliver(input: { text: string }) {
    this.asked.push(input.text);
  }
  note(_agentId: string, text: string) {
    this.notes.push(text);
  }
  progress(_agentId: string, id: string, card: HxProgressCard) {
    this.cards.set(id, card);
  }
  error() {}
}

const CARD = {
  goal: "Write the weekly report from the sales sheet",
  roles: [
    { name: "Writer", kind: "do", does: "Write the report", work: "writing" },
    { name: "Planner", kind: "plan", does: "Plan and check", work: "reasoning" },
  ],
  steps: [
    { title: "Plan", role: "Planner" },
    { title: "Write", role: "Writer" },
  ],
};

let now = Date.parse("2026-11-20T10:00:00.000Z");
const store = new HxTeamStore();
store.open(teamsFolder);
const port = new Port();
const teams = new HxTeams(store, () => now);
teams.setPort(port);
teams.open(teamsFolder);

// The judge: its answer and its model are set here.
let verdict: "continue" | "ask" = "continue";
hxAutoRouter.judgeOn = () => true;
hxAutoRouter.teamJudge = async () =>
  `VERDICT: ${verdict}\nREASON: The writer is on the second draft; the file just changed.`;
hxAutoRouter.teamJudgeModel = () => MODEL;
hxFlow.attachScheduler({ limit: () => 4, running: () => ["writer"] });
hxLearned.reset();

const read = (answer: HxTeamAnswer) => JSON.parse(answer.contentItems[0]?.text ?? "{}");
async function start(key: string): Promise<string> {
  const answer = read(
    await teams.call({ tool: "start_team", arguments: CARD, agentId: "ada", key, roomId: null, byPerson: true }),
  );
  const id: string = answer.team?.id ?? "";
  assert.ok(id, "A team starts.");
  hxFlow.started(
    "writer",
    { lane: "writer", tier: 2, readyAt: 0, teamId: id, order: 0, batch: null, difficulty: null, dependents: 0 },
    null,
  );
  return id;
}
/** Minutes of real work: the team's own look each 30 seconds. */
async function work(minutes: number): Promise<void> {
  for (let tick = 0; tick < minutes * 2; tick += 1) {
    now += 30_000;
    await teams.tick();
  }
  await teams.settled();
}
const card = (id: string) => {
  teams.refreshCards();
  return (port.cards.get(hxTeamCardId(id))?.steps ?? []).map((step) => step.text).join("\n");
};
function agreements(count: number): void {
  writeFileSync(
    join(teamsFolder, "hx-judge-agreement.jsonl"),
    Array.from({ length: count }, () => `${JSON.stringify({ agrees: true })}\n`).join(""),
  );
}
const mode = () =>
  existsSync(join(teamsFolder, "hx-judge-auto.json"))
    ? JSON.parse(readFileSync(join(teamsFolder, "hx-judge-auto.json"), "utf8")).causes.G1.auto === true
    : false;

try {
  // --- CONC-16-A1 -----------------------------------------------------------------------------------
  const first = await start("chat:turn-1:call-1");
  await work(30.5);
  check("a G1 pause has the judge's view", store.get(first)?.guard?.paused?.view?.verdict === "continue");
  check(
    "CONC-16-A1: no pass list, no agreements: no automatic-mode choice on the card",
    !card(first).includes("in a row"),
  );
  const refused = await teams.cardAction({ agentId: "ada", messageId: hxTeamCardId(first), action: "judge-auto" });
  check("CONC-16-A1: a click on it anyway is refused", refused.status === "refused" && !mode(), refused);
  agreements(5);
  check(
    "CONC-16-A1: 5 agreements but the model is not on the pass list: still none",
    !card(first).includes("in a row"),
  );
  writeFileSync(join(teamsFolder, "hx-judge-pass.json"), JSON.stringify([{ ...MODEL, score: 0.94 }]));
  agreements(4);
  check("CONC-16-A1: a passed model with 4 agreements: still none", !card(first).includes("in a row"));
  agreements(5);
  check("CONC-16-A1: with both conditions the card offers it", card(first).includes("5 times in a row"));
  check("CONC-16-A1: and it is not on before your click", !mode());
  const on = await teams.cardAction({ agentId: "ada", messageId: hxTeamCardId(first), action: "judge-auto" });
  check("CONC-16-A1: your click turns it on, on this computer", on.status === "done" && mode(), on);
  await teams.call({
    tool: "team",
    arguments: { action: "continue", teamId: first },
    agentId: "ada",
    key: "chat:turn-2:call-1",
    roomId: null,
    byPerson: true,
  });

  // --- CONC-16-A2 -----------------------------------------------------------------------------------
  const second = await start("chat:turn-3:call-1");
  const askedBefore = port.asked.length;
  await work(30.5);
  check(
    "CONC-16-A2: the first G1 goes on without asking you",
    store.get(second)?.guard?.paused === null && port.asked.length === askedBefore,
  );
  check(
    "CONC-16-A2: the chat says why, and the card has its buttons",
    port.notes.at(-1)?.includes("second draft") === true && card(second).includes("The judge let it go on"),
  );
  await work(15.5);
  check(
    "CONC-16-A2: the second, after half the time, goes on too",
    store.get(second)?.guard?.judge?.passes?.G1 === 2 && port.asked.length === askedBefore,
  );
  await work(8);
  check(
    "CONC-16-A2: the third time of the same cause asks you",
    store.get(second)?.guard?.paused?.guard === "G1" && port.asked.length === askedBefore + 1,
  );
  check(
    "CONC-16-A2: and says it went on twice already",
    port.notes.some((note) => note.includes("twice already")),
  );

  // A judge that says "ask" asks in automatic mode too.
  verdict = "ask";
  const third = await start("chat:turn-4:call-1");
  await work(30.5);
  check("a judge that says ask asks you in automatic mode", store.get(third)?.guard?.paused?.guard === "G1");
  verdict = "continue";

  // Two stops after a pass bring G1 back to advice.
  for (const key of ["chat:turn-5:call-1", "chat:turn-6:call-1"]) {
    const id = await start(key);
    await work(30.5);
    assert.equal(store.get(id)?.guard?.paused, null);
    const stopped = await teams.cardAction({ agentId: "ada", messageId: hxTeamCardId(id), action: "stop" });
    assert.equal(stopped.status, "done");
  }
  check(
    "two stops after the judge let teams go on bring the cause back to advice",
    !mode() && port.notes.some((note) => note.includes("Twice you stopped")),
  );
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  teams.close();
  hxFlow.attachScheduler(null);
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${report.checks.length} checks\n`);
  if (report.failure) process.stdout.write(`${report.failure}\n`);
}
