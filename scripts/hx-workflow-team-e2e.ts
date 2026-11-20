// HXBot (v1.7.5, RTN-11-A3): a routine that runs a team task. A workflow with a schedule trigger and a team
// step runs on its schedule; its step starts the team through the real team service (HxTeams, with a
// fake host for the rooms and agents), as a person's start_team. The team is then under the same rules as
// a team started in a chat: the HX-Flow ledger knows its room, its work waits for a free place of this
// computer (CONC-01) and does not take the person's last place, and it takes its turn by share with a
// team started in a chat (CONC-03). Real SQLite and the real workflow service; no model, agent or network.
//
// Run: bun scripts/hx-workflow-team-e2e.ts
// Writes .hxbot-build/hx-workflow-team-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HX_AUTO_DEFAULTS } from "@hxbot/contracts/hx-auto-model";
import type { ChannelMessage, ChannelTask, WorkflowGraph, WorkflowRunDetail } from "@hxbot/contracts/ipc";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { hxFlow } from "../src/backend/hx-flow/ledger";
import { type HxTeamAgent, type HxTeamPort, HxTeams } from "../src/backend/hx-team/service";
import { HxTeamStore } from "../src/backend/hx-team/store";
import { hxTeamStepHost } from "../src/backend/hx-workflows/host";
import { hxAttachWorkflowLimits } from "../src/backend/hx-workflows/limits";
import { hxWorkflowSteps } from "../src/backend/hx-workflows/steps";
import { HxBotDatabase } from "../src/backend/hxbot-database";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { WorkflowTriggers, workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.hxbot-build/hx-workflow-team-e2e");
const WAIT_MS = 20_000;

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

const directory = await mkdtemp(join(tmpdir(), "hxbot-hx-workflow-team-"));

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
  async deliver() {}
  note() {}
  progress() {}
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

const database = new HxBotDatabase(directory);
let workflows: WorkflowsHandle | null = null;
const store = new HxTeamStore();
store.open(join(directory, "teams"));
const port = new Port();
const teams = new HxTeams(store);
teams.setPort(port);

try {
  await Effect.runPromise(database.initialize());
  let clock = new Date("2026-11-20T09:00:00Z");
  const workflowStore = new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") });
  const service = await Effect.runPromise(
    createWorkflows({
      store: workflowStore,
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      delivery: () => null,
      turnAnswer: () => null,
      sendHandoff: () => Effect.fail({ cause: new Error("No agent step runs in this test.") }),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.fail({ message: "No model step runs in this test." }),
      notify: () => {},
      connectionOn: () => false,
      post: () => Effect.die(new Error("No post runs in this test.")),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
      now: () => clock,
    }),
  );
  workflows = service;
  const triggers = new WorkflowTriggers({
    store: workflowStore,
    timezone: () => "UTC",
    start: (start) => service.startScheduled(start),
    changed: () => {},
  });
  hxAttachWorkflowLimits(() => database.connection);
  hxWorkflowSteps.attach({
    connection: () => database.connection,
    agent: (agentId) => (agentId === "ada" ? { id: "ada", name: "Ada", computerUse: true } : null),
    computer: async () => ({ success: false, contentItems: [{ type: "inputText", text: "No app step runs here." }] }),
    ...hxTeamStepHost(teams),
  });

  const graph: WorkflowGraph = {
    nodes: [
      {
        id: "trigger",
        kind: "trigger",
        at: { x: 0, y: 0 },
        fields: { trigger: "schedule" },
        schedule: { kind: "once", date: "2026-11-20", time: "09:05" },
      },
      {
        id: "team",
        kind: "agent",
        at: { x: 300, y: 0 },
        fields: { hxStep: "team", agentId: "ada", team: JSON.stringify(CARD) },
      },
      { id: "output", kind: "output", at: { x: 600, y: 0 }, fields: { target: "notify" } },
    ],
    edges: [
      { id: "e1", from: "trigger", to: "team", type: "text" },
      { id: "e2", from: "team", to: "output", type: "text" },
    ],
    strokes: [],
  };
  const created = await runCauseEffect(service.create({ title: "Weekly report team" }));
  const saved = await runCauseEffect(
    service.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph }),
  );
  check("a workflow with a schedule and a team step saves", saved.ok, saved);

  clock = new Date("2026-11-20T09:05:02Z");
  await runCauseEffect(triggers.processDue(clock, () => true));
  const runs = await runCauseEffect(service.runs({ workflowId: created.summary.id, limit: 5 }));
  const run = runs.runs[0]?.run;
  check("the schedule starts one run", runs.runs.length === 1 && run?.source === "schedule", runs.runs);
  if (!run) throw new Error("No run.");

  const deadline = Date.now() + WAIT_MS;
  let teamId: string | null = null;
  while (!teamId) {
    teamId = store.running().find((team) => team.starterAgentId === "ada")?.id ?? null;
    if (!teamId && Date.now() > deadline) throw new Error("No team started.");
    if (!teamId) await new Promise((done) => setTimeout(done, 10));
  }
  const record = store.get(teamId);
  check(
    "RTN-11-A3: the scheduled run's team is a team of the team service, started by the step's agent",
    record?.state === "running" && record.starterAgentId === "ada",
    record,
  );
  const scheduledRoom = record?.channelId ?? "";
  check("RTN-11-A3: its room is made and has members", (port.rooms.get(scheduledRoom)?.members.length ?? 0) >= 2);
  let detail: WorkflowRunDetail = await runCauseEffect(service.run(run.id));
  check(
    "RTN-11-A3: the step waits for the team",
    detail.steps.find((step) => step.nodeId === "team")?.status === "running",
  );
  check("CONC-03: the ledger knows the scheduled team's room", hxFlow.isTeamRoom(scheduledRoom));

  // A team that a person starts in a chat, beside it.
  const chat = await teams.call({
    tool: "start_team",
    arguments: { ...CARD, goal: "Draft the press note" },
    agentId: "ada",
    key: "chat-thread:turn-9:call-1",
    roomId: null,
    byPerson: true,
  });
  const chatTeam = store.running().find((team) => team.id !== teamId)?.id ?? null;
  check("a team started in a chat runs beside it", chat.success && chatTeam !== null);
  const chatRoom = chatTeam ? (store.get(chatTeam)?.channelId ?? "") : "";

  // Each team has one piece of work that waits for a member.
  port.rooms.get(scheduledRoom)?.tasks.push(task("scheduled-part", scheduledRoom, "writer", "queued"));
  port.rooms.get(chatRoom)?.tasks.push(task("chat-part", chatRoom, "planner", "queued"));

  // CONC-01: a computer with 3 places, all taken: the scheduled team's work waits, it is not refused.
  let running: string[] = ["busy-1", "busy-2", "busy-3"];
  hxFlow.attachScheduler({ limit: () => 3, running: () => running });
  check(
    "CONC-01: with no free place, the scheduled team's work waits",
    !hxFlow.hasPlace(scheduledRoom, "scheduled-part"),
  );
  const waiting = hxFlow.waitingTeamWork();
  check(
    "CONC-01: the waiting work is in the queue, not refused",
    waiting.some((candidate) => candidate.teamId === teamId) && hxFlow.capacity().waiting >= 2,
    waiting,
  );
  // Two places taken of 3: the last free one is the person's, so team work still waits.
  running = ["busy-1", "busy-2"];
  check("CONC-01: team work does not take the person's last place", !hxFlow.hasPlace(scheduledRoom, "scheduled-part"));
  // All free: the two teams take their turns.
  running = [];
  const first = ["scheduled-part", "chat-part"].filter((part) =>
    hxFlow.hasPlace(part === "chat-part" ? chatRoom : scheduledRoom, part),
  );
  check("CONC-01: with free places the team work may start", first.length >= 1, first);
  const scheduledCandidate = waiting.find((candidate) => candidate.teamId === teamId);
  const chatCandidate = hxFlow.waitingTeamWork().find((candidate) => candidate.teamId === chatTeam);
  check(
    "CONC-03: the scheduled team's work has the same tier as the chat team's: it is not put behind it or ahead of it",
    scheduledCandidate !== undefined && chatCandidate !== undefined && scheduledCandidate.tier === chatCandidate.tier,
    { scheduledCandidate, chatCandidate },
  );
  // Fair share: the team that used more time goes after the one that used less.
  const nowMs = Date.now();
  hxFlow.shares.add(teamId, 600, nowMs);
  check(
    "CONC-03: the shares count the scheduled team's time like any team's",
    hxFlow.shares.used(teamId, nowMs) > (chatTeam ? hxFlow.shares.used(chatTeam, nowMs) : 0),
  );
  const order = hxFlow
    .waitingTeamWork()
    .filter((candidate) => candidate.teamId === teamId || candidate.teamId === chatTeam);
  check("CONC-03: both teams' work waits in one queue", order.length === 2, order);
  // One place for team work (3 places, 1 taken, the last kept for the person): it goes by share.
  running = ["busy-1"];
  check(
    "CONC-03: with one place, the team that used less time gets it, and the scheduled team waits",
    hxFlow.hasPlace(chatRoom, "chat-part") && !hxFlow.hasPlace(scheduledRoom, "scheduled-part"),
  );
  hxFlow.shares.add(chatTeam ?? "", 1_200, nowMs);
  check(
    "CONC-03: when the chat team has used more, the scheduled team gets the place",
    hxFlow.hasPlace(scheduledRoom, "scheduled-part") && !hxFlow.hasPlace(chatRoom, "chat-part"),
  );
  hxFlow.attachScheduler(null);

  // The team ends: the step ends with its result, and the run is done.
  const team = store.get(teamId);
  if (team) store.save({ ...team, state: "done", result: "The weekly report", endedAt: new Date().toISOString() });
  await runCauseEffect(service.sweep());
  const ended = Date.now() + WAIT_MS;
  for (;;) {
    detail = await runCauseEffect(service.run(run.id));
    if (detail.run.status !== "running") break;
    if (Date.now() > ended) throw new Error("The run did not end.");
    await new Promise((done) => setTimeout(done, 10));
  }
  check(
    "RTN-11-A3: the team's result is the step's answer, and the run is done",
    detail.run.status === "done" && detail.steps.find((step) => step.nodeId === "team")?.output === "The weekly report",
    detail.steps,
  );
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  hxWorkflowSteps.attach(null);
  hxFlow.attachScheduler(null);
  teams.close();
  if (workflows) await Effect.runPromise(workflows.close()).catch(() => {});
  database.close();
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${report.checks.length} checks\n`);
  if (report.failure) process.stdout.write(`${report.failure}\n`);
}
