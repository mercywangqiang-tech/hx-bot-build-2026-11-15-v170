// HXBot (v1.7.5): checks the app action, app skill and team steps of workflows (RTN-11), the run limits
// (RTN-07) and the nodes with no runner (RTN-08), on the real SQLite and the real workflow service, on a
// temporary profile. The Computer Use calls and the teams are the boundary: a fake host answers them and
// counts each call, so no model, agent, app or network is started.
//
// - RTN-11-A1: a turn of "open the sheet → sum it → make a mail draft" saved as a workflow, then run by its
//   schedule, gives the same answers as the turn, with the same calls.
// - RTN-11-A2: step 3 fails; "continue from this step" does not run steps 1 and 2 again, and the external
//   action count of step 2 does not grow. A call that HXBot stopped in is "not known", and a continue
//   checks the settings again (Computer Use off stops it).
// - RTN-11 (A3, the part in this process): a team step starts its team through the team host and waits for it.
// - RTN-11: an agent step on "auto" has its handoff chosen by the work.
// - RTN-07: a loop stops after 10 passes with "over the limit"; larger limits stay finite.
// - RTN-08: a node with no runner is refused at save, at a direct call and at a run.
//
// Run: bun scripts/hx-workflows-e2e.ts
// Writes .hxbot-build/hx-workflows-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  HX_NODE_DECLARATIONS,
  HX_WORKFLOW_AUTO_MODEL,
  HX_WORKFLOW_DEFAULT_LIMITS,
  HX_WORKFLOW_MAX_LIMITS,
  HX_WORKFLOW_STEP_KINDS,
  type HxSaveTurnLine,
} from "@hxbot/contracts/hx-workflows";
import type { WorkflowGraph, WorkflowNode, WorkflowRunDetail, WorkflowStep } from "@hxbot/contracts/ipc";
import { Effect, Result } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { hxWorkflowAutoSteps } from "../src/backend/hx-workflows/auto-model";
import { hxGraphProblem } from "../src/backend/hx-workflows/checks";
import {
  hxAttachWorkflowLimits,
  hxSetWorkflowLimitsFor,
  hxWorkflowLimitsFor,
} from "../src/backend/hx-workflows/limits";
import {
  type HxAppCall,
  type HxJsonObject,
  type HxStepAgent,
  type HxTeamReading,
  hxWorkflowSteps,
} from "../src/backend/hx-workflows/steps";
import { hxTurnTools } from "../src/backend/hx-workflows/turn-tools";
import { HxBotDatabase } from "../src/backend/hxbot-database";
import type { DynamicToolResult } from "../src/backend/protocol";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { WorkflowTriggers, workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.hxbot-build/hx-workflows-e2e");
const WAIT_MS = 20_000;
const AGENT = "agent-ada";

interface Report {
  checks: string[];
  calls: number;
  passed: boolean;
  failure?: string;
}
const report: Report = { checks: [], calls: 0, passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail).slice(0, 2_000)}`}`);
  report.checks.push(name);
};

// --- The fake host: Computer Use calls and teams ------------------------------------------------------------

interface MadeCall {
  tool: string;
  arguments: HxJsonObject;
}

interface World {
  computerUse: boolean;
  calls: MadeCall[];
  /** The marks (`arguments.mark`) whose next call fails once. */
  failOnce: Set<string>;
  /** The mark whose calls never answer, as when HXBot stops in the middle of one. */
  hang: string | null;
  /** Milliseconds each call with `arguments.slow` takes. */
  slowMs: number;
  teams: Map<string, HxTeamReading & { card: HxJsonObject; agentId: string }>;
  teamStarts: number;
  stopped: string[];
  handoffs: Array<{ runId: string; workflowId: string; text: string; auto: boolean }>;
  outputs: string[];
}

const world: World = {
  computerUse: true,
  calls: [],
  failOnce: new Set(),
  hang: null,
  slowMs: 0,
  teams: new Map(),
  teamStarts: 0,
  stopped: [],
  handoffs: [],
  outputs: [],
};

function markOf(call: HxAppCall): string {
  return typeof call.arguments.mark === "string" ? call.arguments.mark : "";
}

/** The same call gives the same answer, as the app would. */
function answerFor(call: HxAppCall): string {
  if (call.tool === "computer_skill") {
    if (call.arguments.action === "read")
      return JSON.stringify({
        rows: [
          ["Q1", 10],
          ["Q2", 32],
        ],
      });
    if (call.arguments.action === "summary")
      return JSON.stringify({ ok: true, total: 42, output: call.arguments.output });
  }
  return JSON.stringify({ ok: true, tool: call.tool, arguments: call.arguments });
}

async function computer(_agent: HxStepAgent, call: HxAppCall): Promise<DynamicToolResult> {
  world.calls.push({ tool: call.tool, arguments: call.arguments });
  const mark = markOf(call);
  if (world.hang !== null && mark === world.hang) return new Promise(() => {});
  if (call.arguments.slow === true && world.slowMs > 0) await new Promise((done) => setTimeout(done, world.slowMs));
  if (world.failOnce.delete(mark))
    return { success: false, contentItems: [{ type: "inputText", text: JSON.stringify({ reason: "window gone" }) }] };
  return { success: true, contentItems: [{ type: "inputText", text: answerFor(call) }] };
}

const callsOf = (mark: string) =>
  world.calls.filter((call) => markOf({ tool: call.tool, arguments: call.arguments }) === mark);

// --- The service ---------------------------------------------------------------------------------------------

const directory = await mkdtemp(join(tmpdir(), "hxbot-hx-workflows-"));
let database = new HxBotDatabase(directory);
let service: WorkflowsHandle | null = null;
const app: { triggers: WorkflowTriggers | null } = { triggers: null };
let clock: Date | null = null;
const now = () => clock ?? new Date();

async function open(): Promise<WorkflowsHandle> {
  await Effect.runPromise(database.initialize());
  const store = new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") });
  const workflows = await Effect.runPromise(
    createWorkflows({
      store,
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      delivery: () => null,
      turnAnswer: () => null,
      sendHandoff: (input) =>
        Effect.sync(() => {
          world.handoffs.push({
            runId: input.run.id,
            workflowId: input.run.routineId,
            text: input.text,
            auto: hxWorkflowAutoSteps.wanted({
              sender: { kind: "routine", routineId: input.run.routineId, runId: input.run.id },
              text: input.text,
            }),
          });
          return `delivery-${world.handoffs.length}`;
        }),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.fail({ message: "No model step runs in this test." }),
      notify: (notice) => {
        if (notice.kind === "output") world.outputs.push(notice.text);
      },
      connectionOn: () => false,
      post: () => Effect.die(new Error("No post runs in this test.")),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
      now,
    }),
  );
  service = workflows;
  app.triggers = new WorkflowTriggers({
    store,
    timezone: () => "UTC",
    start: (start) => workflows.startScheduled(start),
    changed: () => {},
  });
  hxAttachWorkflowLimits(() => database.connection);
  hxWorkflowSteps.attach({
    connection: () => database.connection,
    agent: (agentId) => (agentId === AGENT ? { id: AGENT, name: "Ada", computerUse: world.computerUse } : null),
    computer,
    startTeam: async ({ agentId, key, card }) => {
      const known = world.teams.get(key);
      if (known) return { teamId: key };
      world.teamStarts += 1;
      world.teams.set(key, { state: "running", result: null, reason: null, card, agentId });
      return { teamId: key };
    },
    team: (teamId) => world.teams.get(teamId) ?? null,
    stopTeam: async (teamId) => {
      world.stopped.push(teamId);
      const team = world.teams.get(teamId);
      if (team) world.teams.set(teamId, { ...team, state: "stopped", reason: "stopped by the run" });
    },
  });
  hxTurnTools.attach({
    connection: () => database.connection,
    agentName: (agentId) => (agentId === AGENT ? "Ada" : null),
    create: async (input) => {
      const made = await runCauseEffect(workflows.create(input));
      return { workflowId: made.summary.id, title: made.summary.title };
    },
    texts: () => ({ confirm: (what) => `Do ${what} again?`, title: (agent, date) => `${agent} ${date}` }),
  });
  return workflows;
}

async function close(): Promise<void> {
  hxWorkflowSteps.attach(null);
  if (service) await Effect.runPromise(service.close()).catch(() => {});
  service = null;
  database.close();
}

async function until<T>(what: string, read: () => Promise<T | null | undefined>): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = await read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}`);
    await new Promise((done) => setTimeout(done, 10));
  }
}

const detailOf = (workflows: WorkflowsHandle, runId: string) => runCauseEffect(workflows.run(runId));
/** The run once it ended, or waits at an approval. */
async function ended(workflows: WorkflowsHandle, runId: string): Promise<WorkflowRunDetail> {
  return until(`run ${runId} ends`, async () => {
    const detail = await detailOf(workflows, runId);
    return detail.run.status === "running" || detail.run.status === "stopping" ? null : detail;
  });
}
const stepsOf = (detail: WorkflowRunDetail, nodeId: string): WorkflowStep[] =>
  detail.steps.filter((step) => step.nodeId === nodeId);
const lastOf = (detail: WorkflowRunDetail, nodeId: string) => stepsOf(detail, nodeId).at(-1);

const node = (
  id: string,
  x: number,
  fields: WorkflowNode["fields"],
  kind: WorkflowNode["kind"] = "agent",
): WorkflowNode => ({
  id,
  kind,
  at: { x, y: 0 },
  fields,
});
const appAction = (id: string, x: number, calls: HxAppCall[]) =>
  node(id, x, { hxStep: "app-action", agentId: AGENT, actions: JSON.stringify(calls) });
const chain = (nodes: WorkflowNode[]): WorkflowGraph => ({
  nodes,
  edges: nodes.slice(1).map((to, index) => ({
    id: `edge-${index + 1}`,
    from: nodes[index]?.id ?? "",
    to: to.id,
    type: "text" as const,
  })),
  strokes: [],
});
const manual = node("trigger", 0, { trigger: "manual" }, "trigger");
const notify = (x: number) => node("output", x, { target: "notify" }, "output");

async function make(workflows: WorkflowsHandle, title: string, graph: WorkflowGraph): Promise<string> {
  const created = await runCauseEffect(workflows.create({ title }));
  const saved = await runCauseEffect(
    workflows.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph }),
  );
  assert.ok(saved.ok, `${title} saves`);
  return created.summary.id;
}

const ledger = (scopeLike: string) =>
  database.connection
    .prepare("SELECT action_key, status FROM hx_external_actions WHERE scope LIKE ? ORDER BY action_key")
    .all(`%${scopeLike}%`)
    .flatMap((row) =>
      row && typeof row.action_key === "string" ? [{ key: row.action_key, status: String(row.status) }] : [],
    );

try {
  let workflows = await open();

  // --- RTN-08: what a node declares, and a node with no runner -------------------------------------------
  for (const kind of [
    "trigger",
    "prompt",
    "llm",
    "agent",
    "condition",
    "approval",
    "output",
    ...HX_WORKFLOW_STEP_KINDS,
  ] as const) {
    const declared = HX_NODE_DECLARATIONS[kind];
    check(
      `RTN-08: ${kind} declares its inputs, outputs, permission, idempotence, read-back and failure`,
      declared !== undefined &&
        // A trigger has no input and an output has no output; every node has one of the two.
        declared.inputs.length + declared.outputs.length > 0 &&
        declared.permission.length > 0 &&
        declared.idempotent.length > 0 &&
        declared.readback.length > 0 &&
        declared.failure.length > 0,
      declared,
    );
  }
  for (const unsupported of [
    node("image", 300, {}, "image"),
    node("asset", 300, {}, "asset"),
    node("odd", 300, { hxStep: "file-output", agentId: AGENT }),
  ]) {
    const graph = chain([manual, unsupported]);
    check(`RTN-08: the graph with ${unsupported.id} has a problem`, hxGraphProblem(graph) !== null);
    const created = await runCauseEffect(workflows.create({ title: `Has ${unsupported.id}` }));
    const save = await Effect.runPromise(
      Effect.result(workflows.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph })),
    );
    const refused = Result.isFailure(save) || !save.success.ok;
    check(`RTN-08: a save of ${unsupported.id} is refused`, refused);
    const kept = await runCauseEffect(workflows.get(created.summary.id));
    check(
      `RTN-08: the refused save of ${unsupported.id} changed nothing`,
      !kept.graph.nodes.some((each) => each.id === unsupported.id),
    );
    const made = await Effect.runPromise(Effect.result(workflows.create({ title: `Made ${unsupported.id}`, graph })));
    check(`RTN-08: a new workflow with ${unsupported.id} is refused`, Result.isFailure(made));
  }
  {
    // A graph that came another way (an older version, a file): a direct call and a run refuse the node.
    const created = await runCauseEffect(workflows.create({ title: "Came another way" }));
    const store = new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") });
    const odd = node("odd", 300, { hxStep: "file-output", agentId: AGENT });
    store.saveGraph(created.summary.id, created.revision, chain([manual, odd]));
    const before = world.calls.length;
    const direct = await Effect.runPromise(
      Effect.result(workflows.runStep({ workflowId: created.summary.id, nodeId: "odd", requestId: "odd-1" })),
    );
    const directRefused =
      Result.isFailure(direct) || (direct.success.status === "failed" && (direct.success.error ?? "").length > 0);
    check(
      "RTN-08: a direct call of the node is refused",
      directRefused,
      Result.isFailure(direct) ? "failure" : direct.success,
    );
    const started = await Effect.runPromise(
      Effect.result(workflows.startRun({ workflowId: created.summary.id, requestId: "odd-run" })),
    );
    if (Result.isFailure(started)) {
      check(
        "RTN-08: a run of the graph is refused, with the reason, and does nothing",
        String(started.failure.cause).includes("cannot run") && world.calls.length === before,
        String(started.failure.cause),
      );
    } else {
      const detail = await ended(workflows, started.success.run.id);
      check(
        "RTN-08: a run fails at the node and does nothing",
        lastOf(detail, "odd")?.status === "failed" && world.calls.length === before,
        detail.steps,
      );
    }
    const runs = await runCauseEffect(workflows.runs({ workflowId: created.summary.id, limit: 10 }));
    check("RTN-08: the refused run left no run behind", runs.runs.length === 0 || Result.isSuccess(started), runs.runs);
  }

  // --- RTN-11-A1: a turn saved as a workflow, then run by its schedule -------------------------------------
  {
    const lines: HxSaveTurnLine[] = [];
    hxTurnTools.attachLine((_agentId, line) => lines.push(line));
    const turnCalls: HxAppCall[] = [
      { tool: "computer_skill", arguments: { skill: "sheet", action: "read", files: ["/w/sales.xlsx"] } },
      {
        tool: "computer_skill",
        arguments: { skill: "sheet", action: "summary", files: ["/w/sales.xlsx"], output: "/w/sum.xlsx" },
      },
      {
        tool: "computer_open",
        arguments: { target: "mailto:boss@example.com?subject=Sales&body=Total%2042", mark: "draft" },
      },
    ];
    // The turn: each call as the agent made it, and one that failed, which a workflow does not repeat.
    const turnAnswers: string[] = [];
    for (const call of turnCalls) {
      const result = await computer({ id: AGENT, name: "Ada", computerUse: true }, call);
      turnAnswers.push(result.contentItems.map((item) => (item.type === "inputText" ? item.text : "")).join(""));
      hxTurnTools.record(AGENT, "turn-1", { tool: call.tool, arguments: call.arguments, ok: result.success });
    }
    hxTurnTools.record(AGENT, "turn-1", { tool: "computer_find", arguments: { query: "x" }, ok: false });
    hxTurnTools.record(AGENT, "turn-1", { tool: "web_search", arguments: { query: "x" }, ok: true });
    const turnCallCount = world.calls.length;
    const offered = hxTurnTools.turnEnded(AGENT, "turn-1");
    check(
      "RTN-11-A1: the end of the turn offers to save it, with its 3 steps",
      offered === 3 && lines.at(-1)?.steps === 3,
      lines,
    );
    check("RTN-11: a turn with no app step offers nothing", hxTurnTools.turnEnded(AGENT, "turn-none") === 0);
    const saved = await hxTurnTools.save(AGENT, "turn-1", new Date("2026-11-20T08:00:00Z"));
    const detail = await runCauseEffect(workflows.get(saved.workflowId));
    const steps = detail.graph.nodes.filter((each) => typeof each.fields.hxStep === "string");
    check(
      "RTN-11-A1: the workflow keeps each step in order: two app skills, then an app action",
      steps.map((each) => each.fields.hxStep).join() === "app-skill,app-skill,app-action",
      detail.graph.nodes,
    );
    check(
      "RTN-11-A1: each step keeps its input",
      steps[0]?.fields.skill === "sheet" &&
        steps[1]?.fields.action === "summary" &&
        String(steps[1]?.fields.args).includes("/w/sum.xlsx") &&
        String(steps[2]?.fields.actions).includes("mailto:boss@example.com"),
      steps,
    );
    check(
      "RTN-11-A1: the failed call and the tool that is not an app step are not in it",
      !JSON.stringify(detail.graph).includes("computer_find") && !JSON.stringify(detail.graph).includes("web_search"),
    );
    check(
      "RTN-11-A1: the saved workflow has no approval that was used: none is decided",
      detail.graph.nodes.every((each) => each.kind !== "approval" || each.fields.decided === undefined),
    );
    // A second save of the same turn makes a second workflow: the person asked twice.
    // The schedule: once, a minute from now.
    clock = new Date("2026-11-20T09:00:00Z");
    const scheduled: WorkflowGraph = {
      ...detail.graph,
      nodes: detail.graph.nodes.map((each) =>
        each.kind === "trigger"
          ? { ...each, fields: { trigger: "schedule" }, schedule: { kind: "once", date: "2026-11-20", time: "09:01" } }
          : each,
      ),
    };
    const resaved = await runCauseEffect(
      workflows.saveGraph({ workflowId: saved.workflowId, baseRevision: detail.revision, graph: scheduled }),
    );
    check("RTN-11-A1: the saved workflow takes a schedule", resaved.ok, resaved);
    clock = new Date("2026-11-20T09:01:05Z");
    if (!app.triggers) throw new Error("No triggers.");
    await runCauseEffect(app.triggers.processDue(clock, () => true));
    const runs = await runCauseEffect(workflows.runs({ workflowId: saved.workflowId, limit: 10 }));
    const scheduledRun = runs.runs[0]?.run;
    check(
      "RTN-11-A1: the schedule starts one run",
      runs.runs.length === 1 && scheduledRun?.source === "schedule",
      runs.runs,
    );
    if (!scheduledRun) throw new Error("No run.");
    const done = await ended(workflows, scheduledRun.id);
    clock = null;
    check("RTN-11-A1: the scheduled run is done", done.run.status === "done", done.steps);
    const runCalls = world.calls.slice(turnCallCount);
    check(
      "RTN-11-A1: the run made the same calls as the turn, in the same order",
      JSON.stringify(runCalls.map((call) => ({ tool: call.tool, arguments: call.arguments }))) ===
        JSON.stringify(
          turnCalls.map((call) => ({
            tool: call.tool,
            // An app skill that changes a file gets the key of its step, so a retry does it once.
            arguments:
              call.tool === "computer_skill" && call.arguments.action === "summary"
                ? { ...call.arguments, requestId: runCalls[1]?.arguments.requestId }
                : call.arguments,
          })),
        ),
      { runCalls, turnCalls },
    );
    const outputs = ["step-1", "step-2", "step-3"].map((id) => lastOf(done, id)?.output ?? "");
    check(
      "RTN-11-A1: each step's answer is the answer the turn had",
      outputs[0] === turnAnswers[0] &&
        outputs[1] === turnAnswers[1] &&
        (outputs[2] ?? "").includes("mailto:boss@example.com"),
      { outputs, turnAnswers },
    );
    check(
      "RTN-11-A1: the notice at the end has the mail draft",
      (world.outputs.at(-1) ?? "").includes("mailto:boss@example.com"),
      world.outputs.at(-1),
    );
  }

  // --- RTN-11-A2: step 3 fails; continue from it -----------------------------------------------------------
  {
    const graph = chain([
      manual,
      appAction("s1", 300, [{ tool: "computer_find", arguments: { query: "Inbox", mark: "a2-read" } }]),
      appAction("s2", 600, [{ tool: "computer_open", arguments: { target: "app:mail", mark: "a2-send" } }]),
      appAction("s3", 900, [{ tool: "computer_open", arguments: { target: "{{input}}", mark: "a2-third" } }]),
      notify(1200),
    ]);
    const workflowId = await make(workflows, "Fails at 3", graph);
    world.failOnce.add("a2-third");
    const run = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "a2-run" }))).run;
    let detail = await ended(workflows, run.id);
    check(
      "RTN-11-A2: step 3 fails and the run fails",
      lastOf(detail, "s3")?.status === "failed" && detail.run.status === "failed",
      detail.steps,
    );
    const external = () => ledger(run.id).filter((row) => row.key.includes(":s2:"));
    check(
      "RTN-11-A2: step 2 did its external action once",
      callsOf("a2-send").length === 1 && external().length === 1,
      external(),
    );
    const failed = lastOf(detail, "s3");
    if (!failed) throw new Error("No step 3.");
    await runCauseEffect(workflows.retryStep({ stepId: failed.id, requestId: "a2-continue" }));
    detail = await ended(workflows, run.id);
    check("RTN-11-A2: continue from step 3 finishes the run", detail.run.status === "done", detail.steps);
    check(
      "RTN-11-A2: steps 1 and 2 did not run again",
      stepsOf(detail, "s1").length === 1 && stepsOf(detail, "s2").length === 1 && callsOf("a2-read").length === 1,
      detail.steps,
    );
    check(
      "RTN-11-A2: the external action count of step 2 did not grow",
      callsOf("a2-send").length === 1 && external().length === 1 && external()[0]?.status === "done",
      external(),
    );
    check("RTN-11-A2: step 3 ran twice, once each attempt", callsOf("a2-third").length === 2);
    // The same continue again is the same request: nothing more happens.
    const again = await Effect.runPromise(
      Effect.result(workflows.retryStep({ stepId: failed.id, requestId: "a2-continue" })),
    );
    check(
      "RTN-11-A2: the same continue twice runs once",
      callsOf("a2-third").length === 2 && (Result.isFailure(again) || again.success.id !== failed.id),
    );
  }
  {
    // A step of two calls whose second fails: the continue gives the first call's answer, not a second call.
    const graph = chain([
      manual,
      appAction("pair", 300, [
        { tool: "computer_open", arguments: { target: "app:mail", mark: "pair-1" } },
        { tool: "computer_open", arguments: { target: "app:send", mark: "pair-2" } },
      ]),
      notify(600),
    ]);
    const workflowId = await make(workflows, "Two calls", graph);
    world.failOnce.add("pair-2");
    const run = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "pair-run" }))).run;
    let detail = await ended(workflows, run.id);
    const failed = lastOf(detail, "pair");
    if (!failed) throw new Error("No pair step.");
    await runCauseEffect(workflows.retryStep({ stepId: failed.id, requestId: "pair-continue" }));
    detail = await ended(workflows, run.id);
    check(
      "RTN-11-A2: inside a step, a done call is not done again",
      detail.run.status === "done" && callsOf("pair-1").length === 1 && callsOf("pair-2").length === 2,
      { steps: detail.steps, first: callsOf("pair-1").length, second: callsOf("pair-2").length },
    );
  }
  {
    // A continue checks the settings again: Computer Use off stops the step before any call.
    const graph = chain([
      manual,
      appAction("only", 300, [{ tool: "computer_open", arguments: { target: "app:x", mark: "recheck" } }]),
    ]);
    const workflowId = await make(workflows, "Recheck", graph);
    world.failOnce.add("recheck");
    const run = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "recheck-run" }))).run;
    let detail = await ended(workflows, run.id);
    const failed = lastOf(detail, "only");
    if (!failed) throw new Error("No step.");
    world.computerUse = false;
    const retried = await Effect.runPromise(
      Effect.result(workflows.retryStep({ stepId: failed.id, requestId: "recheck-continue" })),
    );
    detail = await ended(workflows, run.id);
    const latest = lastOf(detail, "only");
    check(
      "RTN-11: a continue with Computer Use off is refused or fails, with no call",
      callsOf("recheck").length === 1 &&
        (Result.isFailure(retried) || (latest?.status === "failed" && (latest.error ?? "").includes("Computer Use"))),
      { retried: Result.isFailure(retried) ? "refused" : retried.success, latest },
    );
    world.computerUse = true;
  }
  {
    // HXBot stops while a call is out: after the restart its result is not known, and the step says so.
    const graph = chain([
      manual,
      appAction("hang", 300, [{ tool: "computer_open", arguments: { target: "app:pay", mark: "hang" } }]),
    ]);
    const workflowId = await make(workflows, "Stops in a call", graph);
    world.hang = "hang";
    const run = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "hang-run" }))).run;
    await until("the call is out", async () => (callsOf("hang").length > 0 ? true : null));
    check(
      "RTN-11: the call that is out is started in the record",
      ledger(run.id).some((row) => row.status === "started"),
    );
    await close();
    world.hang = null;
    database = new HxBotDatabase(directory);
    workflows = await open();
    await runCauseEffect(workflows.sweep());
    let detail = await ended(workflows, run.id);
    const failed = lastOf(detail, "hang");
    check(
      "RTN-11: after the restart the step fails and says its result is not known",
      failed?.status === "failed" && (failed.error ?? "").includes("not known"),
      failed,
    );
    check(
      "RTN-11: the record says not known",
      ledger(run.id).every((row) => row.status === "unknown"),
      ledger(run.id),
    );
    check("RTN-11: the restart did not do the call again", callsOf("hang").length === 1);
    if (!failed) throw new Error("No step.");
    await runCauseEffect(workflows.retryStep({ stepId: failed.id, requestId: "hang-continue" }));
    detail = await ended(workflows, run.id);
    check(
      "RTN-11: the person's continue does the call once more",
      detail.run.status === "done" && callsOf("hang").length === 2,
      detail.steps,
    );
  }

  // --- RTN-11: a team step --------------------------------------------------------------------------------
  {
    const card = { goal: "Write the report from {{input}}", roles: [{ name: "Writer" }], steps: [{ title: "Draft" }] };
    const graph = chain([
      manual,
      node("team", 300, { hxStep: "team", agentId: AGENT, team: JSON.stringify(card) }),
      notify(600),
    ]);
    const workflowId = await make(workflows, "Team", graph);
    const run = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "team-run" }))).run;
    const teamId = await until(
      "the team starts",
      async () => [...world.teams.keys()].find((key) => key.includes(run.id)) ?? null,
    );
    const started = world.teams.get(teamId);
    check(
      "RTN-11: a team step starts its team as the step's agent",
      started?.agentId === AGENT && world.teamStarts >= 1,
    );
    let detail = await detailOf(workflows, run.id);
    check("RTN-11: the step waits while the team runs", lastOf(detail, "team")?.status === "running", detail.steps);
    await runCauseEffect(workflows.sweep());
    check("RTN-11: a sweep while the team runs starts no second team", world.teams.size === 1);
    world.teams.set(teamId, {
      ...(started ?? { card: {}, agentId: AGENT }),
      state: "done",
      result: "The report",
      reason: null,
    });
    await runCauseEffect(workflows.sweep());
    detail = await ended(workflows, run.id);
    check(
      "RTN-11: the team's result is the step's answer",
      detail.run.status === "done" && lastOf(detail, "team")?.output === "The report",
      detail.steps,
    );
    // A run stopped while its team runs stops the team.
    const second = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "team-stop" }))).run;
    const secondTeam = await until(
      "the second team",
      async () => [...world.teams.keys()].find((key) => key.includes(second.id)) ?? null,
    );
    await runCauseEffect(workflows.stopRun(second.id));
    detail = await ended(workflows, second.id);
    check(
      "RTN-11: a stopped run stops its team",
      world.stopped.includes(secondTeam) && detail.run.status === "stopped",
      {
        stopped: world.stopped,
        status: detail.run.status,
      },
    );
  }

  // --- RTN-11: an agent step on "auto" --------------------------------------------------------------------
  {
    const graph = chain([
      manual,
      node("auto", 300, { agentId: AGENT, task: "Sum the sheet", model: HX_WORKFLOW_AUTO_MODEL }),
      node("own", 600, { agentId: AGENT, task: "Write the mail", model: "claude-sonnet-5-5" }),
    ]);
    const workflowId = await make(workflows, "Auto model", graph);
    const run = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "auto-run" }))).run;
    const handoff = await until(
      "the handoff",
      async () => world.handoffs.find((each) => each.runId === run.id) ?? null,
    );
    check("RTN-11: the handoff of a step on auto asks the router for its model", handoff.auto, handoff);
    hxWorkflowAutoSteps.done({ sender: { kind: "routine", routineId: workflowId, runId: run.id }, text: handoff.text });
    check(
      "RTN-11: once chosen, the note is spent",
      !hxWorkflowAutoSteps.wanted({
        sender: { kind: "routine", routineId: workflowId, runId: run.id },
        text: handoff.text,
      }),
    );
    check(
      "RTN-11: a handoff from somewhere else is not on auto",
      !hxWorkflowAutoSteps.wanted({ sender: { kind: "user" }, text: handoff.text }),
    );
    await runCauseEffect(workflows.stopRun(run.id));
  }

  // --- RTN-07: the run limits -------------------------------------------------------------------------------
  const loopGraph = (mark: string, slow = false): WorkflowGraph => ({
    nodes: [
      manual,
      appAction("loop", 300, [
        { tool: "computer_find", arguments: { query: "again", mark, ...(slow ? { slow: true } : {}) } },
      ]),
      appAction("relay", 600, [{ tool: "computer_find", arguments: { query: "relay", mark: `${mark}-relay` } }]),
    ],
    edges: [
      { id: "in", from: "trigger", to: "loop", type: "text" },
      { id: "on", from: "loop", to: "relay", type: "text" },
      { id: "back", from: "relay", to: "loop", type: "text" },
    ],
    strokes: [],
  });
  {
    const workflowId = await make(workflows, "Endless", loopGraph("endless"));
    check(
      "RTN-07: the defaults are 10 passes, 100 steps, 600 seconds",
      JSON.stringify(hxWorkflowLimitsFor(workflowId)) === JSON.stringify(HX_WORKFLOW_DEFAULT_LIMITS) &&
        HX_WORKFLOW_DEFAULT_LIMITS.loops === 10 &&
        HX_WORKFLOW_DEFAULT_LIMITS.steps === 100 &&
        HX_WORKFLOW_DEFAULT_LIMITS.seconds === 600,
    );
    const run = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "endless-run" }))).run;
    const detail = await ended(workflows, run.id);
    check(
      "RTN-07-A1: an endless loop stops after its 10th pass, marked over the limit",
      detail.run.status === "failed" &&
        callsOf("endless").length === 10 &&
        (detail.run.error ?? "").includes("Over the limit"),
      { status: detail.run.status, error: detail.run.error, calls: callsOf("endless").length },
    );
    const failedStep = detail.steps.find((step) => step.status === "running");
    check("RTN-07: no step is left running", failedStep === undefined, detail.steps);
    const retry = detail.steps.at(-1);
    if (retry) {
      const again = await Effect.runPromise(
        Effect.result(workflows.retryStep({ stepId: retry.id, requestId: "endless-continue" })),
      );
      check(
        "RTN-07: a continue at the limit does not get round it",
        callsOf("endless").length === 10 && (Result.isFailure(again) || again.success.status !== "done"),
      );
    }
    const second = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "endless-run-2" }))).run;
    await ended(workflows, second.id);
    check("RTN-07: a new run starts with its own count, and stops at 10 too", callsOf("endless").length === 20);
  }
  {
    const workflowId = await make(workflows, "Three passes", loopGraph("three"));
    for (const bad of [
      { loops: 0, steps: 100, seconds: 600 },
      { loops: HX_WORKFLOW_MAX_LIMITS.loops + 1, steps: 100, seconds: 600 },
      { loops: 2.5, steps: 100, seconds: 600 },
      { loops: Number.POSITIVE_INFINITY, steps: 100, seconds: 600 },
    ]) {
      let refused = false;
      try {
        hxSetWorkflowLimitsFor(workflowId, bad);
      } catch {
        refused = true;
      }
      check(
        `RTN-07: limits ${JSON.stringify(bad)} are refused`,
        refused && hxWorkflowLimitsFor(workflowId).loops === 10,
      );
    }
    let unknown = false;
    try {
      hxSetWorkflowLimitsFor("no-such-workflow", { loops: 3, steps: 100, seconds: 600 });
    } catch {
      unknown = true;
    }
    check("RTN-07: limits of a workflow that does not exist are refused", unknown);
    hxSetWorkflowLimitsFor(workflowId, { loops: 3, steps: 100, seconds: 600 });
    const run = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "three-run" }))).run;
    const detail = await ended(workflows, run.id);
    check(
      "RTN-07: a limit set to 3 passes stops at 3",
      callsOf("three").length === 3 && detail.run.status === "failed",
    );
    hxSetWorkflowLimitsFor(workflowId, { loops: 1000, steps: 5, seconds: 600 });
    const steps = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "steps-run" }))).run;
    const stepsDetail = await ended(workflows, steps.id);
    check(
      "RTN-07: the step limit stops a run at its 5th step",
      stepsDetail.steps.filter((step) => step.status !== "skipped").length <= 5 &&
        (stepsDetail.run.error ?? "").includes("steps"),
      { steps: stepsDetail.steps.length, error: stepsDetail.run.error },
    );
    check("RTN-07: null puts the defaults back", hxSetWorkflowLimitsFor(workflowId, null).loops === 10);
  }
  {
    const workflowId = await make(workflows, "Slow loop", loopGraph("slow", true));
    hxSetWorkflowLimitsFor(workflowId, { loops: 1000, steps: 10_000, seconds: 1 });
    world.slowMs = 300;
    const run = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "slow-run" }))).run;
    const detail = await ended(workflows, run.id);
    world.slowMs = 0;
    check(
      "RTN-07: the time limit stops the loops after their seconds",
      detail.run.status === "failed" && (detail.run.error ?? "").includes("seconds") && callsOf("slow").length <= 8,
      { error: detail.run.error, calls: callsOf("slow").length },
    );
  }

  report.calls = world.calls.length;
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${report.checks.length} checks\n`);
  if (report.failure) process.stdout.write(`${report.failure}\n`);
}
