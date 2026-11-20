// HXBot (v1.7.5 fix): an agent that is deleted stays deleted, on this computer, the web client and the
// phones. Before the fix the window waited 8 seconds for Undo and only then asked for the delete: a quit,
// a closed window or a hidden one in those seconds never sent it, so the agent came back on the next start
// and every other device still listed it.
//
// Drives the real agent service on a real SQLite database in a temporary folder (no provider, no model,
// no network) and the real main-process coordinator (src/main/hx-agent-deletes.ts) with a fake window and
// a fake joined server:
// - hold: the waiting delete is on disk at once, the agent leaves every list (the `agents-changed` event
//   that the Team API forwards to the web client and the phones), gets no delivery, runs no routine;
// - Undo: the agent is back everywhere; Undo after the delete says the agent is gone;
// - the delete after the undo time; two deletes of one agent at once run once;
// - a quit or a killed process in the undo time: the next start (a new service on the same folder)
//   never lists the agent and removes it;
// - a closed, reloaded or crashed window: its held deletes end; the limit ends one whose window stays;
// - an automatic delete that fails keeps the agent hidden and tries again; a manual one shows it again;
// - a joined server: the delete is kept and sent again until the server answers, or the server is gone;
// - a damaged or missing file loses nothing; a file that cannot be written fails the hold, visibly;
// - a refused hold (the agent has work) leaves the agent as it was.
//
// Run: bun scripts/hx-agent-delete-e2e.ts
// Writes .hxbot-build/hx-agent-delete-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent } from "@hxbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { HxDeleteRemote, HxDeleteService } from "../src/main/hx-agent-deletes";

const OUT = resolve(import.meta.dirname, "../.hxbot-build/hx-agent-delete-e2e");
const root = await mkdtemp(join(tmpdir(), "hxbot-agent-delete-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.HXBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

/** A Codex app-server whose turns with "HOLD" in the input run until they are interrupted. */
const FAKE_CODEX = `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const config = { config: { mcp_servers: {} }, layers: [] };
let buffer = "";
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => { if (error.code === "EPIPE") process.exit(0); throw error; });
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (threadId, turnId) => {
  write({ method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", id: "m-" + turnId, text: "Done.", phase: "final_answer" } } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      if (text.includes("HOLD")) return;
      return setTimeout(() => finish(params.threadId, turnId), 20);
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;
writeFileSync(fakeCodex, FAKE_CODEX, { mode: 0o755 });

const { AgentService, AgentLifecycleFailed } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { HxBotDatabase } = await import("../src/backend/hxbot-database");
const { SidebarLayoutStore } = await import("../src/backend/sidebar-layout-store");
const { HxPendingDeletes, HX_PENDING_DELETES_FILE } = await import("../src/backend/hx-agent-delete/pending");
const { HxAgentDeletes } = await import("../src/main/hx-agent-deletes");
const { HxAgentDeleteHolds } = await import("../src/backend/hx-agent-delete/holds");

const report: { checks: string[]; passed: boolean; failure?: string } = { checks: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail).slice(0, 1_500)}`}`);
  report.checks.push(name);
};

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

const ledger = join(userData, HX_PENDING_DELETES_FILE);
const ledgerIds = (): string[] => {
  if (!existsSync(ledger)) return [];
  const parsed = JSON.parse(readFileSync(ledger, "utf8"));
  return parsed.entries.map((entry: { agentId: string; serverId: string | null }) =>
    entry.serverId === null ? entry.agentId : `${entry.serverId}/${entry.agentId}`,
  );
};

interface Host {
  service: InstanceType<typeof AgentService>;
  store: InstanceType<typeof AgentStore>;
  sidebar: InstanceType<typeof SidebarLayoutStore>;
  events: AgentEvent[];
  lastRoster: () => string[] | null;
}

/** A start of HXBot on the same folders: a new database connection, store, service. */
async function startHost(): Promise<Host> {
  const database = new HxBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const service = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
    timezone: () => "UTC",
  });
  const events: AgentEvent[] = [];
  service.on("event", (event) => events.push(event));
  await runCauseEffect(service.initialize());
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  const lastRoster = () => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type === "agents-changed") return event.agents.map((agent) => agent.id);
    }
    return null;
  };
  return { service, store, sidebar, events, lastRoster };
}

async function makeAgent(host: Host, id: string): Promise<string> {
  await runCauseEffect(host.store.getOrCreate(id, `Agent ${id}`));
  return id;
}

const listed = (host: Host, id: string) => host.service.listAgents().some((agent) => agent.id === id);
const stored = (host: Host, id: string) => host.store.list().some((agent) => agent.id === id);
const errorText = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

class FakeWindow extends EventEmitter {
  constructor(readonly id: number) {
    super();
  }
}

function fakeServers(state: { online: boolean; agents: string[]; servers: string[] }) {
  const deletes: string[] = [];
  const offline = () => Effect.fail({ cause: new Error("offline") });
  const remote: HxDeleteRemote = {
    list: () => state.servers.map((id) => ({ id })),
    deleteAgent: (_serverId, agentId) =>
      Effect.suspend(() => {
        if (!state.online) return offline();
        deletes.push(agentId);
        state.agents = state.agents.filter((id) => id !== agentId);
        return Effect.void;
      }),
    agentIds: () => Effect.suspend(() => (state.online ? Effect.succeed([...state.agents]) : offline())),
  };
  return { deletes, remote };
}

let host = await startHost();
try {
  // ---- hold, Undo, the delete ---------------------------------------------------------------------
  const a = await makeAgent(host, "agent-a");
  const b = await makeAgent(host, "agent-b");
  check("two agents are listed", listed(host, a) && listed(host, b));
  const deletes = new HxAgentDeletes({ limitMs: 60_000, windowGoneMs: 50, retryMs: [50, 100, 200] });
  // The coordinator takes the remote manager's surface that it uses; the fake has exactly that.
  const remote = fakeServers({ online: true, agents: [], servers: [] });
  deletes.attach({ service: host.service, sidebarLayout: host.sidebar, remote: remote.remote });
  await deletes.hold("local", a);
  check("hold: the waiting delete is on disk at once", ledgerIds().includes(a), ledgerIds());
  check("hold: the agent is out of the list", !listed(host, a) && listed(host, b));
  check(
    "hold: agents-changed (what the web client and the phones read) leaves it out",
    !host.lastRoster()?.includes(a),
  );
  check("hold: the data is still there for an undo", stored(host, a));
  const blocked = await errorText(() =>
    runCauseEffect(host.service.sendMessage({ agentId: a, text: "Hello", attachmentDraftIds: [] })),
  );
  check("hold: no delivery reaches the agent", blocked.length > 0, blocked);
  await deletes.release("local", a);
  check("Undo: the agent is back in the list and the event", listed(host, a) && !!host.lastRoster()?.includes(a));
  check("Undo: the file has no entry", !ledgerIds().includes(a));
  await deletes.hold("local", a);
  await Promise.all([deletes.commit("local", a), deletes.commit("local", a)]);
  check("two deletes of one agent at once: done once, the agent is gone", !stored(host, a) && !listed(host, a));
  check("the delete clears its entry", !ledgerIds().includes(a), ledgerIds());
  const lateUndo = await errorText(() => deletes.release("local", a));
  check("Undo after the delete: the agent no longer exists", lateUndo.includes("no longer exists"), lateUndo);
  await deletes.commit("local", a);
  check("a delete of an agent that is gone succeeds (a second window, a late request)", !stored(host, a));

  // ---- a refused hold: the agent works, or its delete runs ---------------------------------------
  const busy = await runCauseEffect(
    host.service.createAgent({
      name: "Busy",
      description: "Works on a long task.",
      avatarSeed: "busy",
      avatarHue: null,
      initialMessage: "HOLD this turn",
    }),
  );
  await waitFor("the busy agent's turn to run", () =>
    host.service.listQueue(busy.id).deliveries.some((delivery) => delivery.status === "running"),
  );
  const refused = await errorText(() => deletes.hold("local", busy.id));
  check("an agent that works: the hold is refused at once (not after the undo time)", refused.length > 0, refused);
  check("a refused hold leaves the agent listed and no entry", listed(host, busy.id) && !ledgerIds().includes(busy.id));
  const doomed = await makeAgent(host, "agent-doomed");
  const deleting = runCauseEffect(host.service.deleteAgent(doomed));
  const whileDeleting = await errorText(() => runCauseEffect(host.service.holdAgentDelete(doomed)));
  await deleting;
  check("a hold while the delete runs is refused", whileDeleting.length > 0, whileDeleting);
  check("…and the delete still ends", !stored(host, doomed) && !ledgerIds().includes(doomed));

  // ---- the quit in the undo time, and a killed process -----------------------------------------
  const c = await makeAgent(host, "agent-c");
  const d = await makeAgent(host, "agent-d");
  await deletes.hold("local", c);
  await deletes.hold("local", d);
  deletes.stop();
  await runCauseEffect(host.service.stop());
  host = await startHost();
  check("next start: the held agents are not listed before anything else runs", !listed(host, c) && !listed(host, d));
  check("next start: their data waits for the coordinator", stored(host, c) && stored(host, d));
  const next = new HxAgentDeletes({ limitMs: 60_000, windowGoneMs: 50, retryMs: [50, 100, 200] });
  next.attach({ service: host.service, sidebarLayout: host.sidebar, remote: remote.remote });
  next.start();
  await waitFor("the left deletes to end", () => !stored(host, c) && !stored(host, d));
  await waitFor("their entries to go", () => ledgerIds().length === 0);
  check("next start: the agents that a quit left are removed, and the file is empty", ledgerIds().length === 0);

  // A killed process: an entry written by hand as the last thing before the kill, for an agent that exists.
  const e = await makeAgent(host, "agent-e");
  new HxPendingDeletes(() => userData).add(e, null, Date.now());
  next.stop();
  await runCauseEffect(host.service.stop());
  host = await startHost();
  check("killed process: the agent of the entry is not listed", !listed(host, e));
  const third = new HxAgentDeletes({ limitMs: 60_000, windowGoneMs: 50, retryMs: [50, 100, 200] });
  third.attach({ service: host.service, sidebarLayout: host.sidebar, remote: remote.remote });
  third.start();
  await waitFor("the killed process's delete to end", () => !stored(host, e));
  check("killed process: the agent is removed on the start", !stored(host, e));

  // An entry for an agent that is gone (the delete ended, the process died before the entry went).
  new HxPendingDeletes(() => userData).add("agent-gone", null, Date.now());
  third.stop();
  await runCauseEffect(host.service.stop());
  host = await startHost();
  check("an entry of an agent that is gone is dropped at the start", !ledgerIds().includes("agent-gone"));

  // ---- the window goes away, the limit ------------------------------------------------------------
  const w = new HxAgentDeletes({ limitMs: 400, windowGoneMs: 50, retryMs: [50, 100, 200] });
  w.attach({ service: host.service, sidebarLayout: host.sidebar, remote: remote.remote });
  const f = await makeAgent(host, "agent-f");
  const g = await makeAgent(host, "agent-g");
  const h = await makeAgent(host, "agent-h");
  const closed = new FakeWindow(1);
  const reloaded = new FakeWindow(2);
  const crashed = new FakeWindow(3);
  await w.hold("local", f, closed);
  await w.hold("local", g, reloaded);
  await w.hold("local", h, crashed);
  closed.emit("destroyed");
  reloaded.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
  crashed.emit("render-process-gone");
  await waitFor("the closed window's delete", () => !stored(host, f));
  check("a closed window: its held delete ends", !stored(host, f));
  await waitFor("the crashed window's delete", () => !stored(host, h));
  check("a crashed window: its held delete ends", !stored(host, h));
  check("a link inside the page (same document) ends nothing", stored(host, g));
  reloaded.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  await waitFor("the reloaded window's delete", () => !stored(host, g));
  check("a reloaded window: its held delete ends", !stored(host, g));
  const i = await makeAgent(host, "agent-i");
  await w.hold("local", i, new FakeWindow(4));
  await waitFor("the limit", () => !stored(host, i), 5_000);
  check("a window that stays (undo time paused): the limit ends the delete", !stored(host, i));
  const j = await makeAgent(host, "agent-j");
  const kept = new FakeWindow(5);
  await w.hold("local", j, kept);
  await w.release("local", j);
  kept.emit("destroyed");
  await new Promise((done) => setTimeout(done, 300));
  check("Undo, then the window closes: the agent stays", stored(host, j) && listed(host, j));
  w.stop();

  // ---- an automatic delete that fails, a manual one that fails --------------------------------
  const k = await makeAgent(host, "agent-k");
  let failures = 1;
  const real = host.service;
  const flaky: HxDeleteService = {
    holdAgentDelete: (agentId) => real.holdAgentDelete(agentId),
    releaseAgentDelete: (agentId) => real.releaseAgentDelete(agentId),
    deleteAgent: (agentId) => real.deleteAgent(agentId),
    hxDeleteHeld: (agentId) =>
      failures-- > 0
        ? Effect.fail(new AgentLifecycleFailed({ operation: "deleteAgent", cause: new Error("EBUSY: in use") }))
        : real.hxDeleteHeld(agentId),
    get hxPendingDeletes() {
      return real.hxPendingDeletes;
    },
  };
  const auto = new HxAgentDeletes({ limitMs: 100, windowGoneMs: 50, retryMs: [150, 300] });
  auto.attach({ service: flaky, sidebarLayout: host.sidebar, remote: remote.remote });
  await auto.hold("local", k);
  await new Promise((done) => setTimeout(done, 180));
  check("an automatic delete that failed keeps the agent hidden", !listed(host, k) && ledgerIds().includes(k));
  await waitFor("the retry", () => !stored(host, k), 5_000);
  check("…and the retry removes it", !stored(host, k) && !ledgerIds().includes(k));
  auto.stop();

  // ---- the hold logic of a delete that fails in the service (no file: in memory) -------------------
  const roster = new Set(["x1", "x2"]);
  const resumed: string[] = [];
  let rosterEvents = 0;
  let blocks = 0;
  const holds = new HxAgentDeleteHolds(new HxPendingDeletes(() => null), {
    exists: (agentId) => roster.has(agentId),
    blockDeliveries: () => {
      blocks += 1;
      return () => {
        blocks -= 1;
      };
    },
    resume: (agentId) => resumed.push(agentId),
    emitRoster: () => {
      rosterEvents += 1;
    },
  });
  holds.hold("x1");
  holds.hold("x1");
  check("a second hold of one agent changes nothing", blocks === 1 && rosterEvents === 1);
  holds.failed("x1");
  check(
    "a manual delete that failed: the agent shows again and gets deliveries",
    !holds.isHeld("x1") && blocks === 0 && resumed.includes("x1") && rosterEvents === 2,
  );
  holds.hold("x2");
  roster.delete("x2");
  holds.deleted("x2");
  check("a delete that removed the agent clears the hold", !holds.isHeld("x2"));
  const goneHold = await errorText(async () => holds.hold("x3"));
  check(
    "a hold of an agent that does not exist says it no longer exists",
    goneHold.includes("no longer exists"),
    goneHold,
  );
  check("a list without held agents keeps the others", holds.visible([{ id: "x1" }, { id: "x9" }]).length === 2);

  // ---- a joined server -------------------------------------------------------------------------
  const state = { online: false, agents: ["remote-1", "remote-2"], servers: ["server-x"] };
  const joined = fakeServers(state);
  const r = new HxAgentDeletes({ limitMs: 60_000, windowGoneMs: 50, retryMs: [50, 100] });
  r.attach({ service: host.service, sidebarLayout: host.sidebar, remote: joined.remote });
  await r.hold("server-x", "remote-1");
  check("a joined server's delete is kept on this computer", ledgerIds().includes("server-x/remote-1"));
  await r.release("server-x", "remote-1");
  check("Undo of a joined server's delete clears it", !ledgerIds().includes("server-x/remote-1"));
  await r.hold("server-x", "remote-1");
  r.stop();
  const r2 = new HxAgentDeletes({ limitMs: 60_000, windowGoneMs: 50, retryMs: [50, 100] });
  r2.attach({ service: host.service, sidebarLayout: host.sidebar, remote: joined.remote });
  r2.start();
  await new Promise((done) => setTimeout(done, 300));
  check("server offline after the start: the delete waits", ledgerIds().includes("server-x/remote-1"));
  state.online = true;
  await waitFor("the joined server's delete", () => !ledgerIds().includes("server-x/remote-1"), 5_000);
  check("server online: the delete is sent and cleared", joined.deletes.length === 1, joined.deletes);
  await r2.hold("server-x", "remote-2");
  state.servers = [];
  state.online = false;
  r2.stop();
  const r3 = new HxAgentDeletes({ limitMs: 60_000, windowGoneMs: 50, retryMs: [50, 100] });
  r3.attach({ service: host.service, sidebarLayout: host.sidebar, remote: joined.remote });
  r3.start();
  await waitFor("the left server's entry to go", () => !ledgerIds().includes("server-x/remote-2"), 5_000);
  check("a server that this computer left: its waiting delete is dropped", !ledgerIds().includes("server-x/remote-2"));
  r3.stop();

  // ---- the file itself -----------------------------------------------------------------------------
  const l = await makeAgent(host, "agent-l");
  writeFileSync(ledger, "{ this is not json");
  await runCauseEffect(host.service.stop());
  host = await startHost();
  check("a damaged file: nothing is hidden or lost", listed(host, l) && stored(host, l));
  rmSync(ledger, { force: true });
  mkdirSync(ledger);
  const fileFail = new HxAgentDeletes({ limitMs: 60_000, windowGoneMs: 50, retryMs: [50] });
  fileFail.attach({ service: host.service, sidebarLayout: host.sidebar, remote: remote.remote });
  const writeError = await errorText(() => fileFail.hold("local", l));
  check("a file that cannot be written: the hold fails, visibly", writeError.length > 0, writeError);
  check("…and the agent stays listed", listed(host, l));
  rmSync(ledger, { recursive: true, force: true });
  const memory = new HxPendingDeletes(() => null);
  memory.add("x", null, 1);
  check("a database in memory keeps the list in memory only", memory.has("x") && !existsSync(ledger));
  const invalid = await errorText(async () => new HxPendingDeletes(() => userData).add("../../etc", null, 1));
  check("an id with a path in it is refused", invalid.length > 0, invalid);
  fileFail.stop();

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(host.service.stop()).catch(() => undefined);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${report.checks.length} checks\n`);
  if (report.failure) process.stdout.write(`${report.failure}\n`);
  for (const name of report.checks) process.stdout.write(`  ✓ ${name}\n`);
}
