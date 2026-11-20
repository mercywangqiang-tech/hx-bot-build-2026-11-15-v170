// HXBot v1.7.5: RTN-01, RTN-02, RTN-03, RTN-04, RTN-06, MIG-03 and CONC-14 on the real scheduler, SQLite
// stores, mailbox and the results service that judges a run when its turn ends. Each pass of the scheduler
// gets an explicit clock; no provider, account, network or model is started. The staggered starts of
// CONC-14 wait for real timers, at most one minute.
//
// Run: bun scripts/hx-routines-e2e.ts
// It writes .hxbot-build/hx-routines-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { HxRoutineConfirmCard } from "@hxbot/contracts/hx-routine-confirm";
import type { Routine, RoutineSchedule } from "@hxbot/contracts/ipc";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { isNoUpdateAnswer } from "../src/backend/agent/routine-quiet-runs";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentStore } from "../src/backend/agent-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits } from "../src/backend/agent-waits/agent-waits";
import { ChannelImages } from "../src/backend/channel-images";
import { ChannelRoutineScheduler } from "../src/backend/channel-routine-scheduler";
import { ChannelService } from "../src/backend/channel-service";
import { HX_UPGRADE_V175_KEY } from "../src/backend/database/hx-routine-detail-schema";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { hxAttachChannelConfirm } from "../src/backend/hx-routines/channel";
import { hxChannelRoutineConfirm, hxRoutineConfirm } from "../src/backend/hx-routines/confirm";
import { hxRunDetailsOf, hxWriteRoutineDetail } from "../src/backend/hx-routines/detail";
import { hxRoutineResults } from "../src/backend/hx-routines/results-service";
import { hxUpgradeAfterMigrations } from "../src/backend/hx-routines/upgrade";
import { hxRoutineZones } from "../src/backend/hx-routines/zone";
import { HxBotDatabase } from "../src/backend/hxbot-database";
import { MailboxStore } from "../src/backend/mailbox-store";
import type { DynamicToolCallParams } from "../src/backend/protocol";
import { RoutineTimer } from "../src/backend/routine-timer";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".hxbot-build", "hx-routines-e2e");
const HOUR = 3_600_000;
const MINUTE = 60_000;

interface Fixture {
  database: HxBotDatabase;
  mailbox: MailboxStore;
  scheduler: RoutineScheduler;
  runs: AgentRoutineStore;
  agentId: string;
  errors: string[];
  cards: Map<string, { card: HxRoutineConfirmCard; settled: boolean }>;
  close(): void;
}

async function openFixture(root: string): Promise<Fixture> {
  const database = new HxBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agent =
    store.list()[0] ??
    (await runCauseEffect(
      store.createAgent({ name: "Routine fixture", description: "v1.7.5", avatarSeed: "hx-routines", avatarHue: null }),
    ));
  const errors: string[] = [];
  const conversation = new ConversationRuntime(
    store,
    () => {},
    () => store.list(),
  );
  const timer = new RoutineTimer(
    () => [],
    () => false,
    (code) => errors.push(code),
  );
  const waits = new AgentWaits({
    store: new AgentWaitStore({ database }),
    mailbox,
    hooks: { emit: () => {}, ownsRoutine: () => true, hasRoutine: () => true, requireKnownAgent: () => {} },
  });
  const scheduler = new RoutineScheduler({
    store,
    mailbox,
    conversation,
    timer,
    waits,
    timezone: () => "UTC",
    hooks: {
      emit: () => {},
      emitError: (code) => errors.push(code),
      emitQueue: () => {},
      scheduleDrain: () => {},
      interrupt: () => Effect.void,
      awaitDrain: () => undefined,
      syncMailboxMessages: () => {},
      listAgents: () => store.list(),
      excludedAgents: () => new Set(),
      // A staggered start fires only while the service runs.
      isRunning: () => true,
      usageLimited: () => false,
      routineThread: () => null,
      routineDeleted: () => Effect.void,
    },
  });
  const cards = new Map<string, { card: HxRoutineConfirmCard; settled: boolean }>();
  hxRoutineConfirm.attach({
    connection: () => database.connection,
    routine: (agentId, routineId) => scheduler.listFor(agentId).find((routine) => routine.id === routineId) ?? null,
    writeCard: (_agentId, cardId, card, settled) => cards.set(cardId, { card, settled }),
    startRun: (input) => Effect.runPromise(scheduler.hxStartConfirmedRun(input)),
    recordSkipped: (input) => scheduler.hxRecordSkipped(input),
  });
  return {
    database,
    mailbox,
    scheduler,
    runs: new AgentRoutineStore(database),
    agentId: agent.id,
    errors,
    cards,
    close() {
      hxRoutineConfirm.detach();
      timer.dispose();
      conversation.dispose();
      database.close();
    },
  };
}

function create(
  fixture: Fixture,
  name: string,
  schedule: RoutineSchedule,
  options: { instruction?: string; missedPolicy?: "skip" | "run-once"; timezone?: string } = {},
): Routine {
  return fixture.scheduler.create(
    {
      agentId: fixture.agentId,
      name,
      instruction: options.instruction ?? `Collect the news for ${name}.`,
      active: true,
      timezone: options.timezone ?? "UTC",
      schedule,
      ...(options.missedPolicy ? { missedPolicy: options.missedPolicy } : {}),
    },
    { recordConversationEvent: false },
  );
}

function deliveries(fixture: Fixture, routine: Routine): number {
  return fixture.mailbox
    .conversationMessages(fixture.agentId)
    .filter((message) => message.routine?.routineId === routine.id).length;
}

function records(fixture: Fixture, routine: Routine) {
  const details = hxRunDetailsOf(fixture.database.connection, "agent", routine.id);
  return fixture.runs
    .listRuns(fixture.agentId, routine.id, 100, true)
    .map((run) => ({ run, detail: details.get(run.id) ?? null }));
}

/** A delivery that the agent started and finished, as a drain would. */
async function finish(fixture: Fixture, deliveryId: string): Promise<void> {
  await Effect.runPromise(fixture.mailbox.markStarting(deliveryId));
  await Effect.runPromise(fixture.mailbox.markRunning(deliveryId, `turn-${deliveryId}`));
  await Effect.runPromise(fixture.mailbox.markTerminal(deliveryId, "completed", null));
  const delivery = fixture.mailbox.getDelivery(deliveryId)?.delivery;
  if (delivery) fixture.scheduler.reconcileDelivery(delivery);
}

async function pass(fixture: Fixture, now: Date): Promise<void> {
  await Effect.runPromise(fixture.scheduler.processDue(now));
}

async function withFixture<T>(work: (fixture: Fixture, root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "hxbot-routines-e2e-"));
  const fixture = await openFixture(root);
  try {
    return await work(fixture, root);
  } finally {
    fixture.close();
    await rm(root, { recursive: true, force: true });
  }
}

const results: Array<{ name: string; passed: boolean; detail: unknown }> = [];

async function check(name: string, work: () => Promise<unknown>): Promise<void> {
  try {
    const detail = await work();
    results.push({ name, passed: true, detail });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    results.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
    process.stdout.write(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

const hourly: RoutineSchedule = { kind: "hourly", minute: 0 };

function toolCall(args: DynamicToolCallParams["arguments"]): DynamicToolCallParams {
  return {
    threadId: "thread",
    turnId: "turn",
    callId: "call-1",
    namespace: null,
    tool: "create_routine",
    arguments: args,
  };
}

await check("RTN-01-A2 the routine an agent creates in one sentence shows its next three runs, local and UTC", () =>
  withFixture(async (fixture) => {
    hxRoutineZones.attach({ registered: () => null, register: async () => {} });
    try {
      const refused = await Effect.runPromise(
        fixture.scheduler.handleTool(
          toolCall({ name: "Morning", instruction: "Brief me.", schedule: { kind: "daily", time: "09:00" } }),
          fixture.agentId,
        ),
      );
      assert.match(JSON.stringify(refused), /No timezone is registered/u, "With no zone registered, the agent asks.");
      const created = await Effect.runPromise(
        fixture.scheduler.handleTool(
          toolCall({
            name: "Morning",
            instruction: "Brief me.",
            schedule: { kind: "daily", time: "02:30" },
            timezone: "America/Los_Angeles",
          }),
          fixture.agentId,
        ),
      );
      const item = created?.contentItems[0]?.text ?? "{}";
      const upcoming: Array<{ local: string; utc: string; note?: string }> = JSON.parse(item).upcoming ?? [];
      assert.equal(upcoming.length, 3, "The result has three upcoming runs.");
      for (const run of upcoming) {
        assert.match(run.local, /^\d{4}-\d\d-\d\d 02:30$|^\d{4}-\d\d-\d\d 03:00$/u, "Each is in the routine's zone.");
        assert.match(run.utc, /Z$/u, "Each has its UTC time.");
      }
      return { upcoming };
    } finally {
      hxRoutineZones.detach();
    }
  }),
);

await check("RTN-02-A1 a 3-hour sleep misses 3 hourly runs; run-once runs once and shows 3 missed", () =>
  withFixture(async (fixture) => {
    const routine = create(fixture, "Hourly", hourly, { missedPolicy: "run-once" });
    const first = new Date(routine.trigger.nextRunAt);
    await pass(fixture, new Date(first.getTime() + 2 * HOUR + 30 * MINUTE));
    assert.equal(deliveries(fixture, routine), 1, "One run starts.");
    const rows = records(fixture, routine);
    const missed = rows.find((row) => row.run.missed);
    assert.equal(missed?.detail?.missed?.total, 3, "The record names 3 missed runs.");
    assert.equal(missed?.detail?.missed?.handled, "run-once");
    assert.equal(missed?.detail?.missed?.while, "asleep");
    assert.equal(missed?.run.missed?.count, 2, "Released clients read 2 skipped: the third one ran.");
    const ran = rows.find((row) => !row.run.missed);
    assert.equal(ran?.detail?.catchUp?.total, 3, "The run makes up for the 3 missed ones.");
    return { rows: rows.map((row) => ({ status: row.run.status, missed: row.run.missed, detail: row.detail })) };
  }),
);

await check("RTN-02-A2 a catch-up that sends mail sends nothing before the yes, and runs once after it", () =>
  withFixture(async (fixture) => {
    const routine = create(fixture, "Mail", hourly, {
      missedPolicy: "run-once",
      instruction: "每小时把新订单汇总后发邮件给客户。",
    });
    const first = new Date(routine.trigger.nextRunAt);
    const now = new Date(first.getTime() + 2 * HOUR + 30 * MINUTE);
    await pass(fixture, now);
    assert.equal(deliveries(fixture, routine), 0, "Nothing is sent before the yes.");
    const [cardId, card] = [...fixture.cards.entries()][0] ?? [];
    assert.ok(cardId && card && !card.settled, "A card asks.");
    assert.match(card.card.actions, /sends messages or mail/u);
    assert.match(card.card.note, /Missed 3 times/u);
    const answer = await hxRoutineConfirm.answer({ ownerId: fixture.agentId, cardId, run: true }, now);
    assert.equal(answer.ran, 1);
    assert.equal(deliveries(fixture, routine), 1, "The yes starts exactly one run.");
    assert.equal(fixture.cards.get(cardId)?.settled, true);
    const started = fixture.runs.activeRuns(fixture.agentId, routine.id).find((run) => run.deliveryId);
    if (started?.deliveryId) await finish(fixture, started.deliveryId);
    // The next catch-up, declined: nothing starts and the history keeps it as declined.
    const later = new Date(first.getTime() + 6 * HOUR + 30 * MINUTE);
    await pass(fixture, later);
    const second = [...fixture.cards.entries()].find(([id, entry]) => id !== cardId && !entry.settled);
    assert.ok(second, "The next catch-up asks again.");
    await hxRoutineConfirm.answer({ ownerId: fixture.agentId, cardId: second[0], run: false }, later);
    assert.equal(deliveries(fixture, routine), 1, "No still sends nothing.");
    assert.ok(
      records(fixture, routine).some((row) => row.detail?.skip?.reason === "declined"),
      "The declined time is a skipped record.",
    );
    return { cards: fixture.cards.size };
  }),
);

await check(
  "RTN-03-A1 one run at a time: runs that last over 3 intervals give 3 runs and 7 skipped in 10 intervals",
  () =>
    withFixture(async (fixture) => {
      // The shortest interval is 3 minutes, so the case of "every minute, 3 minutes a run" runs 3 times as slow.
      const every3: RoutineSchedule = {
        kind: "interval",
        amount: 3,
        unit: "minutes",
        anchorAt: new Date().toISOString(),
      };
      const routine = create(fixture, "Every 3 minutes", every3);
      const first = new Date(routine.trigger.nextRunAt);
      let runningSince: { deliveryId: string; at: number } | null = null;
      for (let index = 0; index < 10; index += 1) {
        const now = first.getTime() + index * 3 * MINUTE;
        // A run takes 3 intervals and 5 seconds, so it ends just after the third next occurrence.
        if (runningSince && now - runningSince.at >= 3 * 3 * MINUTE + 5_000) {
          await finish(fixture, runningSince.deliveryId);
          runningSince = null;
        }
        await pass(fixture, new Date(now + 1_000));
        const live = fixture.runs.activeRuns(fixture.agentId, routine.id).find((run) => run.deliveryId);
        if (live?.deliveryId && !runningSince) runningSince = { deliveryId: live.deliveryId, at: now };
      }
      const rows = records(fixture, routine);
      const skipped = rows.filter((row) => row.detail?.skip?.reason === "previous-running");
      const ran = rows.filter((row) => !row.run.missed);
      assert.equal(ran.length, 3, "Three runs.");
      assert.equal(skipped.length, 7, "Seven skipped records.");
      for (const row of skipped) {
        assert.equal(row.run.status, "cancelled");
        assert.equal(row.run.missed?.count, 1, "A released client reads each as one skipped run.");
      }
      return { ran: ran.length, skipped: skipped.length };
    }),
);

await check("MIG-03-A1 after the upgrade, a routine that sends a message asks at its first time", () =>
  withFixture(async (fixture) => {
    const routine = create(fixture, "Team note", hourly, { instruction: "每小时发消息给团队群，说说进度。" });
    // As a routine from before v1.7.5: no HXBot record, and the upgrade pass has not run.
    fixture.database.connection.prepare("DELETE FROM hx_routine_detail WHERE routine_id = ?").run(routine.id);
    fixture.database.connection.prepare("DELETE FROM hx_meta WHERE key = ?").run(HX_UPGRADE_V175_KEY);
    const changed = hxUpgradeAfterMigrations(fixture.database.connection);
    assert.deepEqual(
      changed.find((entry) => entry.routineId === routine.id)?.changes,
      ["zone-unconfirmed", "confirm-each"],
      "The upgrade marks it.",
    );
    const listed = fixture.scheduler.list(fixture.agentId).find((entry) => entry.id === routine.id);
    assert.equal(listed?.hx?.confirmEach, true);
    assert.equal(listed?.hx?.zoneUnconfirmed, true);
    await pass(fixture, new Date(Date.parse(routine.trigger.nextRunAt) + 1_000));
    assert.equal(deliveries(fixture, routine), 0, "It does not run before the yes.");
    assert.equal(fixture.cards.size, 1, "It asks.");
    return { changed };
  }),
);

await check("RTN-06-A1 a paused routine reads back no queued trigger and does not fire after a restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "hxbot-routines-e2e-"));
  try {
    let fixture = await openFixture(root);
    const routine = create(fixture, "Paused", hourly);
    const due = Date.parse(routine.trigger.nextRunAt);
    // A run that did not start yet: queued with its delivery.
    await pass(fixture, new Date(due + 1_000));
    assert.equal(fixture.scheduler.hxQueueReadback(fixture.agentId, routine.id).queued, 1);
    fixture.scheduler.update(
      { agentId: fixture.agentId, routineId: routine.id, active: false },
      { recordConversationEvent: false },
    );
    const readback = fixture.scheduler.hxQueueReadback(fixture.agentId, routine.id);
    assert.deepEqual(readback, { queued: 0, running: null }, "Nothing is queued after the pause.");
    assert.equal(
      fixture.scheduler.list(fixture.agentId).find((entry) => entry.id === routine.id)?.hx?.queue?.queued,
      0,
    );
    fixture.close();
    fixture = await openFixture(root);
    fixture.scheduler.skipMissed(new Date(due + HOUR + 1_000));
    await pass(fixture, new Date(due + HOUR + 1_000));
    assert.equal(
      fixture.mailbox
        .conversationMessages(fixture.agentId)
        .filter((message) => message.routine?.routineId === routine.id && message.delivery?.status === "queued").length,
      0,
      "No run waits after the restart.",
    );
    assert.equal(fixture.scheduler.list(fixture.agentId).find((entry) => entry.id === routine.id)?.active, false);
    fixture.close();
    return readback;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await check("CONC-14-A2 five deletions in one folder share one card; payments are asked one by one", () =>
  withFixture(async (fixture) => {
    const due = new Date(Math.ceil(Date.now() / HOUR) * HOUR + HOUR);
    const schedule: RoutineSchedule = { kind: "daily", time: `${String(due.getUTCHours()).padStart(2, "0")}:00` };
    const deletes = Array.from({ length: 5 }, (_, index) =>
      create(fixture, `Clean ${index}`, schedule, { instruction: "删除下载文件夹里的临时文件。" }),
    );
    const pays = Array.from({ length: 2 }, (_, index) =>
      create(fixture, `Pay ${index}`, schedule, { instruction: "每天付款给供应商。" }),
    );
    for (const routine of [...deletes, ...pays]) {
      fixture.database.connection
        .prepare(
          `INSERT INTO hx_routine_detail (owner_kind, routine_id, detail_json, updated_at) VALUES ('agent', ?, ?, ?)
           ON CONFLICT(owner_kind, routine_id) DO UPDATE SET detail_json = excluded.detail_json`,
        )
        .run(
          routine.id,
          JSON.stringify({ zone: { confirmed: true }, confirm: { mode: "each", actions: [], since: "user" } }),
          "now",
        );
    }
    await pass(fixture, new Date(Date.parse(deletes[0]?.trigger.nextRunAt ?? "") + 1_000));
    const cards = [...fixture.cards.values()];
    const deleteCards = cards.filter((entry) => entry.card.actions.includes("deletes"));
    const payCards = cards.filter((entry) => entry.card.actions.includes("pays"));
    assert.equal(deleteCards.length, 1, "One card for the five deletions.");
    assert.equal(deleteCards[0]?.card.lines.length, 5);
    assert.equal(payCards.length, 2, "Each payment has its own card.");
    return { cards: cards.length };
  }),
);

await check("CONC-14-A1 six routines of one minute start spread over 60 seconds, in order", () =>
  withFixture(async (fixture) => {
    const due = new Date(Math.ceil(Date.now() / MINUTE) * MINUTE + 2 * MINUTE);
    const expression = `${due.getUTCMinutes()} ${due.getUTCHours()} * * *`;
    // The order they come due in: their time, then their trigger, as the store lists them.
    const routines = Array.from({ length: 6 }, (_, index) =>
      create(fixture, `Same minute ${index}`, { kind: "custom", expression }),
    ).sort((a, b) => (a.trigger.id < b.trigger.id ? -1 : a.trigger.id > b.trigger.id ? 1 : 0));
    const firedAt = Date.now();
    // The pass runs as if at the minute; the delays count from the minute, so they run in real time now.
    await pass(fixture, new Date(Date.parse(routines[0]?.trigger.nextRunAt ?? "") + 200));
    const deadline = Date.now() + 65_000;
    while (routines.some((routine) => deliveries(fixture, routine) === 0) && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 250));
    }
    const starts = routines.map((routine) => {
      const message = fixture.mailbox
        .conversationMessages(fixture.agentId)
        .find((entry) => entry.routine?.routineId === routine.id);
      return message ? Date.parse(message.createdAt) - firedAt : null;
    });
    assert.ok(
      starts.every((start) => start !== null),
      "All six start.",
    );
    const values = starts.map((start) => start ?? 0);
    assert.ok(Math.max(...values) < 61_000, "All start within 60 seconds.");
    assert.ok(new Set(values.map((value) => Math.round(value / 1000))).size > 1, "They do not all start at once.");
    assert.deepEqual(
      [...values].sort((a, b) => a - b),
      values,
      "They start in the order they came due.",
    );
    return { startsMs: values };
  }),
);

interface ResultWatch {
  lines: string[];
  notes: Array<{ title: string; body: string }>;
}

/** The results service with the host that the agent service gives it, but lines and notes kept here. */
function watchResults(fixture: Fixture, workspace: string): ResultWatch {
  const watch: ResultWatch = { lines: [], notes: [] };
  hxRoutineResults.attach({
    connection: () => fixture.database.connection,
    runForDelivery: (deliveryId) => fixture.scheduler.runForDelivery(deliveryId),
    workspaceOf: () => workspace,
    appendLine: (_agentId, text) => watch.lines.push(text),
    notify: (_agentId, title, body) => watch.notes.push({ title, body }),
  });
  return watch;
}

/** One due run of the routine that ends with this answer, judged as the end of its turn judges it. */
async function runAndAnswer(fixture: Fixture, routine: Routine, now: Date, answer: string) {
  await pass(fixture, now);
  const run = fixture.runs.activeRuns(fixture.agentId, routine.id).find((item) => item.deliveryId);
  assert.ok(run?.deliveryId, "The due time starts a run.");
  const delivery = fixture.mailbox.getDelivery(run.deliveryId)?.delivery;
  assert.ok(delivery, "The run has its delivery.");
  const judged = hxRoutineResults.judgeTurn({
    agentId: fixture.agentId,
    turnId: `turn-${run.deliveryId}`,
    outcome: "completed",
    reportedFailure: undefined,
    // As the end of the turn: the no-update marker as the whole answer means nothing to report.
    noUpdate: isNoUpdateAnswer(answer),
    answer,
    messages: [],
    deliveries: [delivery],
  });
  await finish(fixture, run.deliveryId);
  const row = records(fixture, routine).find((item) => item.run.id === run.id);
  return { run: row?.run, kind: judged.get(run.id)?.kind, stored: row?.detail?.result?.kind };
}

await check("RTN-04-A1 the answer says done but the file it saved is not there: result not verified", () =>
  withFixture(async (fixture, root) => {
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const watch = watchResults(fixture, workspace);
    try {
      const routine = create(
        fixture,
        "Sales report",
        { kind: "daily", time: "09:00" },
        {
          instruction: "每天把销售数据汇总，保存到 report.txt。",
        },
      );
      const first = new Date(Date.parse(routine.trigger.nextRunAt) + 1_000);
      const missing = await runAndAnswer(fixture, routine, first, "已完成，汇总已保存到 report.txt。");
      // The released status is what released clients and the frozen Team API read; HXBot keeps its result apart.
      assert.equal(missing.run?.status, "succeeded", "The released status of the run is unchanged.");
      assert.equal(missing.kind, "unverified", "The run is not a success: the file is not there.");
      assert.equal(missing.stored, "unverified", "The result is kept for the list and the history.");
      assert.equal(watch.lines.length, 1, "One line in the chat.");
      assert.match(watch.lines[0] ?? "", /report\.txt/u, "The line names the file.");
      assert.equal(watch.notes.length, 1, "One notification.");
      // The next day the same answer is true: the file is there, so the run succeeds and says nothing.
      await writeFile(join(workspace, "report.txt"), "sales\n");
      const second = new Date(first.getTime() + 24 * HOUR);
      const present = await runAndAnswer(fixture, routine, second, "已完成，汇总已保存到 report.txt。");
      assert.equal(present.kind, "succeeded", "With the file there, the run succeeds.");
      assert.equal(present.stored, "succeeded");
      assert.equal(watch.lines.length, 1, "No new line.");
      assert.equal(watch.notes.length, 1, "No new notification.");
      return { missing, present, lines: watch.lines, notes: watch.notes };
    } finally {
      hxRoutineResults.detach();
    }
  }),
);

await check("RTN-04-A2 a daily report with no change records no update and sends no notification", () =>
  withFixture(async (fixture, root) => {
    const watch = watchResults(fixture, join(root, "workspace"));
    try {
      const routine = create(
        fixture,
        "News digest",
        { kind: "daily", time: "08:00" },
        {
          instruction: "每天看一遍行业新闻，有新内容就写摘要。",
        },
      );
      const quiet = await runAndAnswer(
        fixture,
        routine,
        new Date(Date.parse(routine.trigger.nextRunAt) + 1_000),
        "[[no-update]]",
      );
      assert.equal(quiet.kind, "no-update", "Nothing changed: no update.");
      assert.equal(quiet.stored, "no-update", "The history keeps it as no update.");
      assert.equal(watch.lines.length, 0, "No line in the chat.");
      assert.equal(watch.notes.length, 0, "No notification.");
      return { quiet };
    } finally {
      hxRoutineResults.detach();
    }
  }),
);

// Channel routines take the same rules: one run at a time, missed runs by the policy, and the yes first.
interface ChannelFixture {
  database: HxBotDatabase;
  channels: ChannelService;
  scheduler: ChannelRoutineScheduler;
  channelId: string;
  notices: string[];
  errors: string[];
}

async function withChannelFixture<T>(work: (fixture: ChannelFixture) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "hxbot-routines-e2e-"));
  const database = new HxBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
  try {
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    const lead = await runCauseEffect(
      store.createAgent({ name: "Channel lead", description: "v1.7.5", avatarSeed: "hx-lead", avatarHue: null }),
    );
    const errors: string[] = [];
    const notices: string[] = [];
    const channels = new ChannelService(database, mailbox, new ChannelImages(join(root, "channel-images")), {
      agents: () => store.list(),
      generate: () => Effect.die(new Error("No model runs in this test.")),
      schedule: () => {},
      interrupt: () => Effect.void,
      busy: () => false,
      changed: () => {},
      error: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    });
    const scheduler = new ChannelRoutineScheduler({
      channels,
      hooks: {
        changed: () => {},
        emitError: (code) => errors.push(code),
        excludedChannels: () => new Set(),
        usageLimited: () => false,
      },
    });
    hxAttachChannelConfirm(scheduler, {
      connection: () => database.connection,
      changed: () => {},
      notify: (title) => notices.push(title),
    });
    const channelId = "hx-channel-routines";
    await runCauseEffect(
      channels.command(
        {
          type: "save",
          operationId: `save-${channelId}`,
          channelId,
          draft: {
            name: "Routines",
            title: "",
            instructions: "",
            members: [{ agentId: lead.id }],
            leadAgentId: lead.id,
          },
        },
        { id: "member-e2e", name: "Owner" },
      ),
    );
    return await work({ database, channels, scheduler, channelId, notices, errors });
  } finally {
    hxChannelRoutineConfirm.detach();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

function createChannelRoutine(
  fixture: ChannelFixture,
  name: string,
  options: { instruction?: string; missedPolicy?: "skip" | "run-once" } = {},
) {
  return fixture.scheduler.create({
    channelId: fixture.channelId,
    name,
    instruction: options.instruction ?? `Collect the news for ${name}.`,
    active: true,
    timezone: "UTC",
    schedule: hourly,
    ...(options.missedPolicy ? { missedPolicy: options.missedPolicy } : {}),
  });
}

function channelRuns(fixture: ChannelFixture, routineId: string) {
  const details = hxRunDetailsOf(fixture.database.connection, "channel", routineId);
  return fixture.scheduler
    .listRuns({ channelId: fixture.channelId, routineId, limit: 100 }, true)
    .map((run) => ({ run, detail: details.get(run.id) ?? null }));
}

await check("MIG-03-A1 (channel) a channel routine that sends asks first, in its list, and runs after the yes", () =>
  withChannelFixture(async (fixture) => {
    const routine = createChannelRoutine(fixture, "Mail the team", {
      instruction: "Send the team the weekly summary by email.",
    });
    hxWriteRoutineDetail(fixture.database.connection, "channel", routine.id, (detail) => ({
      ...detail,
      confirm: { mode: "each", actions: ["send"], since: "upgrade" },
    }));
    const due = Date.parse(routine.trigger.nextRunAt);
    await Effect.runPromise(fixture.scheduler.processDue(new Date(due + 1_000)));
    assert.equal(channelRuns(fixture, routine.id).length, 0, "Nothing runs before the yes.");
    assert.equal(fixture.channels.store.tasks(fixture.channelId).length, 0, "Nothing is posted in the channel.");
    const listed = fixture.scheduler.list(fixture.channelId).find((entry) => entry.id === routine.id);
    const waiting = listed?.hx?.waiting ?? [];
    assert.equal(waiting.length, 1, "The list shows the run that waits.");
    assert.equal(listed?.hx?.queue?.queued, 1, "The read-back counts the question.");
    assert.equal(fixture.notices.length, 1, "A desktop notification asks.");
    // A second pass in the same occurrence does not ask again.
    await Effect.runPromise(fixture.scheduler.processDue(new Date(due + 2_000)));
    assert.equal(fixture.scheduler.list(fixture.channelId)[0]?.hx?.waiting?.length, 1);
    const answer = await hxChannelRoutineConfirm.answer({
      ownerId: fixture.channelId,
      cardId: waiting[0]?.cardId ?? "",
      run: true,
    });
    assert.deepEqual(answer, { ran: 1, skipped: 0, settled: 0 });
    const runs = channelRuns(fixture, routine.id);
    assert.equal(runs.length, 1, "One run after the yes.");
    assert.ok(runs[0]?.run.requestMessageId, "The run posted its request.");
    assert.equal(runs[0]?.detail?.confirmed?.confirmationId !== undefined, true, "The run records the yes.");
    assert.ok(
      fixture.channels.store
        .tasks(fixture.channelId)
        .some((task) => task.requestMessageId === runs[0]?.run.requestMessageId),
      "The channel has the routine's task.",
    );
    assert.equal(fixture.scheduler.list(fixture.channelId)[0]?.hx?.waiting, undefined, "Nothing waits any more.");
    return { waiting, runs: runs.length };
  }),
);

await check("RTN-03-A1 (channel) an occurrence that comes while the last run works leaves a skipped record", () =>
  withChannelFixture(async (fixture) => {
    const routine = createChannelRoutine(fixture, "Busy");
    const due = Date.parse(routine.trigger.nextRunAt);
    await Effect.runPromise(fixture.scheduler.processDue(new Date(due + 1_000)));
    await Effect.runPromise(fixture.scheduler.processDue(new Date(due + HOUR + 1_000)));
    const runs = channelRuns(fixture, routine.id);
    const skipped = runs.filter((entry) => entry.detail?.skip?.reason === "previous-running");
    assert.equal(runs.filter((entry) => entry.run.missed === undefined).length, 1, "One run.");
    assert.equal(skipped.length, 1, "One skipped record with its reason.");
    return { runs: runs.length };
  }),
);

await check("RTN-02-A1 (channel) a 3-hour sleep: run once, and the record shows 3 missed", () =>
  withChannelFixture(async (fixture) => {
    const routine = createChannelRoutine(fixture, "Sleep", { missedPolicy: "run-once" });
    const due = Date.parse(routine.trigger.nextRunAt);
    await Effect.runPromise(fixture.scheduler.processDue(new Date(due + 2 * HOUR + 30 * MINUTE)));
    const runs = channelRuns(fixture, routine.id);
    const missed = runs.find((entry) => entry.detail?.missed);
    assert.equal(runs.filter((entry) => entry.run.missed === undefined).length, 1, "It runs once.");
    assert.equal(missed?.detail?.missed?.total, 3, "It shows 3 missed.");
    assert.equal(missed?.detail?.missed?.handled, "run-once");
    return { missed: missed?.detail?.missed };
  }),
);

await check("RTN-06-A1 (channel) a paused channel routine closes its question and reads back nothing queued", () =>
  withChannelFixture(async (fixture) => {
    const routine = createChannelRoutine(fixture, "Pause me", { instruction: "Delete the old files in the share." });
    hxWriteRoutineDetail(fixture.database.connection, "channel", routine.id, (detail) => ({
      ...detail,
      confirm: { mode: "each", actions: ["delete"], since: "upgrade" },
    }));
    await Effect.runPromise(fixture.scheduler.processDue(new Date(Date.parse(routine.trigger.nextRunAt) + 1_000)));
    assert.equal(fixture.scheduler.list(fixture.channelId)[0]?.hx?.waiting?.length, 1);
    fixture.scheduler.update({ channelId: fixture.channelId, routineId: routine.id, active: false });
    const listed = fixture.scheduler.list(fixture.channelId)[0];
    assert.equal(listed?.hx?.waiting, undefined, "The question is closed.");
    assert.equal(listed?.hx?.queue?.queued, 0, "Nothing is queued.");
    const skipped = channelRuns(fixture, routine.id).filter((entry) => entry.detail?.skip?.reason === "cancelled");
    assert.equal(skipped.length, 1, "The closed question is a skipped record.");
    return { queued: listed?.hx?.queue?.queued };
  }),
);

await check("MIG-03 (fail closed) a run that needs the yes is skipped, not run, when nothing can ask", () =>
  withChannelFixture(async (fixture) => {
    const routine = createChannelRoutine(fixture, "Nobody asks", { instruction: "Pay the open invoices." });
    hxWriteRoutineDetail(fixture.database.connection, "channel", routine.id, (detail) => ({
      ...detail,
      confirm: { mode: "each", actions: ["pay"], since: "upgrade" },
    }));
    hxChannelRoutineConfirm.detach();
    await Effect.runPromise(fixture.scheduler.processDue(new Date(Date.parse(routine.trigger.nextRunAt) + 1_000)));
    const runs = channelRuns(fixture, routine.id);
    assert.equal(fixture.channels.store.tasks(fixture.channelId).length, 0, "Nothing is posted.");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.detail?.skip?.reason, "unasked", "A skipped record says why.");
    return { reason: runs[0]?.detail?.skip?.reason };
  }),
);

await mkdir(OUT, { recursive: true });
const passed = results.every((result) => result.passed);
await writeFile(
  join(OUT, "report.json"),
  `${JSON.stringify({ passed, at: new Date().toISOString(), results }, null, 2)}\n`,
);
process.stdout.write(`${passed ? "PASS" : "FAIL"}: report in ${join(OUT, "report.json")}\n`);
process.exit(passed ? 0 : 1);
