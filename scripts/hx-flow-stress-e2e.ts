// BUG-CONC-01 (v1.7.1): the stress script of the many-agents freeze. It starts the built app (`bun run
// build` output in `out/`) on a profile of its own, gives it custom ACP agents that do team work with no
// model (`provider-fakes/agents/hx-team-worker.ts`), and runs the load of the requirements V2.1, 5.1:
// 3 teams (16, 4 and 4 members), 3 people's chats and 6 routines, for 30 minutes. At the end it stops
// the teams. Every 5 seconds it records, layer by layer: the delay of the main event loop (p50, p99,
// max), the frames and long tasks of the window, the messages and bytes that main sends to the window,
// the resident memory of the agent processes, the time of SQLite writes, and the turns that run at the
// same time. It counts the refused handoffs (the gate is 0).
//
// `bun scripts/hx-flow-stress-e2e.ts --label=after [--minutes=30] [--run-as=<user>] [--rss-mb=150]`
// --run-as: in a container that runs as root, Electron starts as this user under xvfb-run.
// Writes .hxbot-build/hx-flow-stress-e2e/<label>/report.json (and app.log, worker.jsonl).
import { type ChildProcess, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";
import { chromium, type Page } from "playwright-core";
import { z } from "zod";
import { InspectorClient } from "./dev-automation/inspector-client";
import { readScriptArguments } from "./script-arguments";

/** What the frame probe in the window counts between two samples. */
interface WindowProbe {
  frames: number;
  maxFrameMs: number;
  longTasks: number;
  longestTaskMs: number;
  last: number;
}

declare global {
  interface Window {
    hxbot: HxBotDesktopApi;
    __hxWindowProbe?: WindowProbe;
    /** With --events=1: the status of each turn end that reached the window, by turn. */
    __hxCompleted?: Record<string, string>;
  }
}

const ROOT = resolve(import.meta.dirname, "..");
const parsed = readScriptArguments({
  usage:
    "bun scripts/hx-flow-stress-e2e.ts --label=<name> [--minutes=30] [--run-as=<user>] [--rss-mb=150] [--teams=16,4,4] [--work-ms=20000-60000] [--auth-url=<url> --auth-account=<file>]",
  options: {
    label: { type: "string" },
    minutes: { type: "string" },
    "run-as": { type: "string" },
    "rss-mb": { type: "string" },
    teams: { type: "string" },
    "work-ms": { type: "string" },
    "profile-at": { type: "string" },
    // BUG-CONC-01-A3: the window counts every turn-completed event; the end compares them with the
    // stored turns, and the cost that the agents report (--cost-usd per member turn) with the stored
    // usage records.
    events: { type: "string" },
    // A local account service (`bun run dev:api`): the app signs in with its development code, so the
    // window shows the real sidebar and chats instead of the "Service unavailable" page.
    "auth-url": { type: "string" },
    // HXBot accounts sign in with a password: a JSON file { "email", "password" } of an account of
    // that service.
    "auth-account": { type: "string" },
    "cost-usd": { type: "string" },
    "profile-seconds": { type: "string" },
  },
});
if (!parsed) process.exit(0);
const { values } = parsed;
const LABEL = values.label ?? "run";
const MINUTES = Number(values.minutes ?? 30);
const RUN_AS = values["run-as"] ?? null;
const RSS_MB = Number(values["rss-mb"] ?? 150);
const TEAMS = (values.teams ?? "16,4,4").split(",").map(Number);
const OUT = join(ROOT, ".hxbot-build", "hx-flow-stress-e2e", LABEL);
/** A CPU profile of main from this minute of the run, for this many seconds (main.cpuprofile). */
const PROFILE_AT = values["profile-at"] ? Number(values["profile-at"]) : null;
const PROFILE_SECONDS = Number(values["profile-seconds"] ?? 180);
const EVENTS = values.events === "1";
const COST_USD = values["cost-usd"] ?? "0";
const AUTH_URL = values["auth-url"] ?? null;
const AUTH_ACCOUNT = values["auth-account"]
  ? z
      .object({ email: z.string(), password: z.string() })
      .parse(JSON.parse(readFileSync(values["auth-account"], "utf8")))
  : null;
const DEBUG_PORT = 9_633;
const INSPECT_PORT = 9_649;
const SAMPLE_MS = 5_000;
mkdirSync(OUT, { recursive: true });
chmodSync(OUT, 0o777);

interface Sample {
  at: number;
  loop: { p50: number; p99: number; max: number } | null;
  sqlite: { writes: number; p99: number; max: number } | null;
  ipc: { messages: number; bytes: number } | null;
  window: { frames: number; maxFrameMs: number; longTasks: number; longestTaskMs: number } | null;
  running: number;
  agentRssMb: number;
  mainRssMb: number;
  /**
   * The whole computer (Linux pressure stall information): ms in this sample when some task, or every
   * task ("full"), waited for the processor or the disk. A stall of every process at once (the app,
   * the window and this script) is the computer's, not the app's.
   */
  pressure?: { cpuSomeMs: number; ioSomeMs: number; ioFullMs: number } | null;
}

/** The totals of /proc/pressure/<kind> in µs, or null where the system has none. */
function pressureTotals(kind: "cpu" | "io"): { some: number; full: number } | null {
  try {
    const text = readFileSync(`/proc/pressure/${kind}`, "utf8");
    const total = (line: string) =>
      Number(/total=(\d+)/u.exec(text.split("\n").find((row) => row.startsWith(line)) ?? "")?.[1] ?? 0);
    return { some: total("some"), full: total("full") };
  } catch {
    return null;
  }
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

function workerScript(): string {
  const bun = process.execPath.startsWith("/root/") ? findSharedBun() : process.execPath;
  const path = join(OUT, "worker.sh");
  const env = {
    FAKE_LOG: join(OUT, "worker.jsonl"),
    HX_STRESS_RSS_MB: String(RSS_MB),
    HX_STRESS_WORK_MS: values["work-ms"] ?? "20000-60000",
    HX_STRESS_COST_USD: COST_USD,
    // The lead marks of this run (a session id can come again in another run).
    HX_STRESS_STATE: join(OUT, "leads"),
  };
  writeFileSync(
    path,
    `#!/bin/sh\n${Object.entries(env)
      .map(([name, value]) => `export ${name}=${JSON.stringify(value)}\n`)
      .join("")}exec "${bun}" "${join(ROOT, "scripts/provider-fakes/agents/hx-team-worker.ts")}" "$@"\n`,
  );
  chmodSync(path, 0o755);
  writeFileSync(env.FAKE_LOG, "");
  chmodSync(env.FAKE_LOG, 0o666);
  return path;
}

/** A Bun that the other user can run: the one of root's home is not readable. */
function findSharedBun(): string {
  for (const candidate of [process.env.HX_STRESS_BUN, "/home/claude/bun142/node_modules/bun/bin/bun.exe"])
    if (candidate && existsSync(candidate)) return candidate;
  throw new Error("Set HX_STRESS_BUN to a Bun binary that the --run-as user can run.");
}

function launch(): ChildProcess {
  const electron = String(createRequire(join(ROOT, "package.json"))("electron"));
  const env = {
    HXBOT_APP_VARIANT: "preview",
    HXBOT_DEV_PROFILE: "app",
    HXBOT_DEV_INSTANCE_ID: `stress-${LABEL}-${Date.now()}`,
    HXBOT_DEV_REMOTE_DEBUGGING_PORT: String(DEBUG_PORT),
    ...(AUTH_URL ? { HXBOT_AUTH_API_URL: AUTH_URL } : {}),
  };
  const app = [electron, `--inspect=127.0.0.1:${INSPECT_PORT}`, ROOT];
  const command = RUN_AS
    ? [
        "runuser",
        "-u",
        RUN_AS,
        "--",
        "env",
        `HOME=/home/${RUN_AS}`,
        ...Object.entries(env).map(([name, value]) => `${name}=${value}`),
        "xvfb-run",
        "-a",
        "-s",
        "-screen 0 1440x900x24",
        ...app,
      ]
    : app;
  const [file, ...args] = command;
  if (!file) throw new Error("no command");
  const log = join(OUT, "app.log");
  writeFileSync(log, "");
  const child = spawn("sh", ["-c", `exec "$@" >> ${JSON.stringify(log)} 2>&1`, "sh", file, ...args], {
    detached: true,
    env: { ...process.env, ...env },
  });
  return child;
}

async function connectPage(): Promise<Page> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
      const page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find(
          (candidate) => candidate.url().startsWith("openbot-app://") || candidate.url().startsWith("hxbot-app://"),
        );
      if (page) {
        await page.waitForFunction(() => "hxbot" in window, undefined, { timeout: 60_000 });
        return page;
      }
      await browser.close();
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error("The app window did not open.");
    await wait(1_000);
  }
}

/** The probes in main: the event loop, the messages to the window, and SQLite writes. */
const MAIN_PROBE = `(() => {
  const req = process.mainModule.require;
  const { monitorEventLoopDelay, performance } = req("node:perf_hooks");
  const probe = { loop: monitorEventLoopDelay({ resolution: 10 }), total: monitorEventLoopDelay({ resolution: 10 }), messages: 0, bytes: 0, writes: [] };
  probe.loop.enable();
  // The whole run, never reset: the p99 of the run.
  probe.total.enable();
  const { webContents } = req("electron");
  const patch = (contents) => {
    if (contents.__hxProbe) return;
    contents.__hxProbe = true;
    const send = contents.send.bind(contents);
    contents.send = (channel, ...args) => {
      probe.messages += 1;
      if (probe.messages % 10 === 0) { try { probe.bytes += 10 * JSON.stringify(args).length; } catch {} }
      return send(channel, ...args);
    };
  };
  for (const contents of webContents.getAllWebContents()) patch(contents);
  req("electron").app.on("web-contents-created", (_event, contents) => patch(contents));
  const { StatementSync } = req("node:sqlite");
  for (const name of ["run"]) {
    const original = StatementSync.prototype[name];
    StatementSync.prototype[name] = function (...args) {
      const start = performance.now();
      try { return original.apply(this, args); } finally { probe.writes.push(performance.now() - start); }
    };
  }
  globalThis.__hxProbe = probe;
  return true;
})()`;

const MAIN_TOTAL = `(() => {
  const total = globalThis.__hxProbe.total;
  return { p50: total.percentile(50) / 1e6, p99: total.percentile(99) / 1e6, p999: total.percentile(99.9) / 1e6, max: total.max / 1e6, count: total.count };
})()`;

const MAIN_READ = `(() => {
  const probe = globalThis.__hxProbe;
  const loop = { p50: probe.loop.percentile(50) / 1e6, p99: probe.loop.percentile(99) / 1e6, max: probe.loop.max / 1e6 };
  probe.loop.reset();
  const writes = probe.writes.sort((a, b) => a - b);
  probe.writes = [];
  const sqlite = { writes: writes.length, p99: writes[Math.floor(writes.length * 0.99)] ?? 0, max: writes.at(-1) ?? 0 };
  const ipc = { messages: probe.messages, bytes: probe.bytes };
  probe.messages = 0;
  probe.bytes = 0;
  return { loop, sqlite, ipc, rss: process.memoryUsage().rss };
})()`;

const Stat = z.object({ p50: z.number(), p99: z.number(), max: z.number() });
// What MAIN_READ gives back each sample.
const MainRead = z.object({
  loop: Stat,
  sqlite: z.object({ writes: z.number(), p99: z.number(), max: z.number() }),
  ipc: z.object({ messages: z.number(), bytes: z.number() }),
  rss: z.number(),
});
// What MAIN_TOTAL gives back once, at the end.
const MainTotal = Stat.extend({ p999: z.number(), count: z.number() });
// The part of agent.readChannel that the stop reads.
const ChannelTasks = z.object({
  tasks: z.array(z.object({ id: z.string(), parentTaskId: z.string().nullable(), state: z.string() })).optional(),
});

async function windowProbe(page: Page): Promise<void> {
  await page.evaluate((events) => {
    const probe = { frames: 0, maxFrameMs: 0, longTasks: 0, longestTaskMs: 0, last: performance.now() };
    if (events) {
      const completed: Record<string, string> = {};
      window.__hxCompleted = completed;
      window.hxbot.agent.onEvent((event) => {
        if (event.type === "turn-completed") completed[event.turnId] = event.status;
      });
    }
    const frame = (now: number) => {
      probe.frames += 1;
      probe.maxFrameMs = Math.max(probe.maxFrameMs, now - probe.last);
      probe.last = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        probe.longTasks += 1;
        probe.longestTaskMs = Math.max(probe.longestTaskMs, entry.duration);
      }
    }).observe({ type: "longtask", buffered: false });
    window.__hxWindowProbe = probe;
  }, EVENTS);
}

/** BUG-CONC-01-A3: the stored ends of turns and usage records, against what the window and the agents saw. */
/** BUG-CONC-01-A3 in the report. */
interface EventCheck {
  /** Turns of agent threads: each end that is stored reached the window, with the same status. */
  agentTurns: {
    stored: number;
    window: number;
    lost: number;
    lostTurnIds: string[];
    extra: number;
    wrongStatus: number;
  };
  /**
   * Turns of channel threads (team members): the window gets channel changes for them, not turn
   * events, so each stored end is held against the ends that the agents logged, by session.
   */
  channelTurns: { stored: number };
  /**
   * All turn ends: those that the agents logged (a private question, such as the judge of the
   * automatic model choice, is no turn) against those that are stored.
   */
  turnEnds: { agents: number; privateQuestions: number; stored: number };
  /** The usage of each turn that reported it, against the usage records and their reported cost. */
  usage: { replies: number; records: number; reportedUsd: number; recordedUsd: number };
}

/** `since`: the start of this run (an ISO time); what an earlier run left in the profile does not count. */
async function eventCheck(page: Page, lines: readonly WorkerLine[], since: string): Promise<EventCheck> {
  const received = z
    .record(z.string(), z.string())
    .parse(JSON.parse(String(await page.evaluate("JSON.stringify(window.__hxCompleted ?? {})"))));
  const home = RUN_AS ? `/home/${RUN_AS}` : (process.env.HOME ?? "");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(home, ".config", "HXBot Dev", "hxbot.db"), { readOnly: true });
  try {
    const turns = z
      .array(
        z.object({
          turn_id: z.string(),
          thread_id: z.string(),
          provider_session_id: z.string().nullable(),
          status: z.string(),
        }),
      )
      .parse(
        db
          .prepare(
            "SELECT turn_id, thread_id, provider_session_id, status FROM projection_turns WHERE status IN ('completed', 'interrupted', 'failed') AND started_at >= ?",
          )
          .all(since),
      );
    const channelThreads = new Set(
      z
        .array(z.object({ thread_id: z.string() }))
        .parse(db.prepare("SELECT thread_id FROM projection_channel_contexts").all())
        .map((row) => row.thread_id),
    );
    const records = z
      .object({ count: z.number(), usd: z.number().nullable() })
      .parse(
        db
          .prepare(
            "SELECT count(*) AS count, sum(estimated_cost_usd) AS usd FROM agent_usage_records WHERE recorded_at >= ?",
          )
          .get(since),
      );
    const agentTurns = turns.filter((turn) => !channelThreads.has(turn.thread_id));
    const stored = new Set(agentTurns.map((turn) => turn.turn_id));
    const lost = agentTurns.filter((turn) => !(turn.turn_id in received)).map((turn) => turn.turn_id);
    // Every window end of a turn that is not stored as an agent turn's end.
    const extra = Object.keys(received).filter((turnId) => !stored.has(turnId));
    const wrongStatus = agentTurns.filter(
      (turn) => turn.turn_id in received && received[turn.turn_id] !== turn.status,
    ).length;
    // The agents' own session ids are not stored (HXBot keeps its own), so the ends are counted.
    const privateTurns = new Set(
      lines.flatMap((line) =>
        line.event === "turn-start" && line.kind === "private" ? [`${line.sessionId}:${line.turn}`] : [],
      ),
    );
    const ends = lines.filter((line) => line.event === "turn-end");
    const privateEnds = ends.filter((line) => privateTurns.has(`${line.sessionId}:${line.turn}`)).length;
    // The cost that each session reported last, summed: what the agents say they spent.
    const lastCost = new Map<string, number>();
    for (const line of lines)
      if (line.event === "usage-reply" && line.sessionId) lastCost.set(line.sessionId, line.total ?? 0);
    return {
      agentTurns: {
        stored: agentTurns.length,
        window: Object.keys(received).length,
        lost: lost.length,
        lostTurnIds: lost.slice(0, 20),
        extra: extra.length,
        wrongStatus,
      },
      channelTurns: { stored: turns.length - agentTurns.length },
      turnEnds: { agents: ends.length - privateEnds, privateQuestions: privateEnds, stored: turns.length },
      usage: {
        replies: lines.filter((line) => line.event === "usage-reply").length,
        records: records.count,
        reportedUsd: [...lastCost.values()].reduce((sum, value) => sum + value, 0),
        recordedUsd: records.usd ?? 0,
      },
    };
  } finally {
    db.close();
  }
}

async function readWindow(page: Page): Promise<Sample["window"]> {
  return page
    .evaluate(() => {
      const probe = window.__hxWindowProbe;
      if (!probe) return null;
      const read = {
        frames: probe.frames,
        maxFrameMs: probe.maxFrameMs,
        longTasks: probe.longTasks,
        longestTaskMs: probe.longestTaskMs,
      };
      Object.assign(probe, { frames: 0, maxFrameMs: 0, longTasks: 0, longestTaskMs: 0 });
      return read;
    })
    .catch(() => null);
}

interface WorkerLine {
  event: string;
  sessionId?: string;
  name?: string;
  ok?: boolean;
  text?: string;
  kind?: string;
  at?: number;
  /** usage-reply: the session's reported cost so far, in USD. */
  total?: number;
  /** turn-start, turn-end: the turn's number in its session. */
  turn?: number;
}

function workerLog(): WorkerLine[] {
  return readFileSync(join(OUT, "worker.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** The resident memory of the processes below the app that are not Electron, in MB. */
function agentRssMb(appPid: number, electron: string): number {
  const parents = new Map<number, number>();
  const rss = new Map<number, number>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    try {
      const status = readFileSync(`/proc/${entry}/status`, "utf8");
      parents.set(Number(entry), Number(/^PPid:\s+(\d+)/mu.exec(status)?.[1] ?? 0));
      rss.set(Number(entry), Number(/^VmRSS:\s+(\d+)/mu.exec(status)?.[1] ?? 0));
    } catch {
      // Gone.
    }
  }
  const below = new Set<number>();
  const pending = [appPid];
  for (let pid = pending.pop(); pid !== undefined; pid = pending.pop())
    for (const [child, parent] of parents)
      if (parent === pid && !below.has(child)) {
        below.add(child);
        pending.push(child);
      }
  let kib = 0;
  for (const pid of below) {
    let exe = "";
    try {
      exe = readlinkSync(`/proc/${pid}/exe`);
    } catch {
      // Not ours to read.
    }
    if (exe !== electron) kib += rss.get(pid) ?? 0;
  }
  return Math.round(kib / 1024);
}

/** The team rooms of the teams that run now (the team records of the profile). */
// The part of a saved team record that the stop reads.
const TeamFile = z.object({ state: z.string(), channelId: z.string() });

function teamRooms(): string[] {
  const home = RUN_AS ? `/home/${RUN_AS}` : (process.env.HOME ?? "");
  const folder = join(home, ".config", "HXBot Dev", "hx-team");
  if (!existsSync(folder)) return [];
  return readdirSync(folder).flatMap((name) => {
    if (!name.endsWith(".json")) return [];
    try {
      const team = TeamFile.safeParse(JSON.parse(readFileSync(join(folder, name), "utf8")));
      return team.success && team.data.state === "running" ? [team.data.channelId] : [];
    } catch {
      return [];
    }
  });
}

/**
 * The rounds that each team finished. The lead reads the board first, and the board names the room
 * ("压力团队<n>…"); team_done comes from the same session.
 */
function teamsDone(lines: readonly WorkerLine[], count: number): number[] {
  const teamOf = new Map<string, number>();
  for (const line of lines) {
    const found = line.event === "tool" && line.name === "team_board" ? /压力团队(\d+)/u.exec(line.text ?? "") : null;
    if (found?.[1] && line.sessionId) teamOf.set(line.sessionId, Number(found[1]) - 1);
  }
  const done = Array.from({ length: count }, () => 0);
  for (const line of lines) {
    if (line.event !== "tool" || line.name !== "team_done" || !line.ok || !line.sessionId) continue;
    const index = teamOf.get(line.sessionId);
    if (index !== undefined) done[index] = (done[index] ?? 0) + 1;
  }
  return done;
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

/** The run as a whole (report.json "result"). */
interface StressResult {
  samples: number;
  mainLoop: { p50: number; p99: number; max: number };
  window: { frames: number; maxFrameMs: number; unresponsiveOver2s: number; longestTaskMs: number };
  ipc: { messagesPerSecondMax: number; bytesPerSecondMax: number };
  sqlite: { writes: number; p99: number; max: number };
  runningMax: number;
  computerStalls: Array<{ at: number; loopMaxMs: number; pressure: Sample["pressure"] }>;
  ioFullMsTotal: number;
  agentRssMbMax: number;
  mainRssMbMax: number;
  turns: number;
  memberTurns: number;
  assigns: number;
  refused: number;
  teamsDone: number;
  rounds: number[];
  errors: number;
  stop: { lateMemberStarts: number; rooms: number; issueMs: number };
  mainLoopRun: z.infer<typeof MainTotal> | null;
  chatSends: number;
}

/** report.json. */
interface Report {
  label: string;
  minutes: number;
  teams: number[];
  rssMb: number;
  startedAt: string;
  windowsFound?: number;
  signedIn?: string;
  routineError?: string;
  agents?: { starters: number; members: number; chats: number; routines: number };
  sendErrors?: string[];
  events?: EventCheck | { error: string };
  result?: StressResult;
  gates?: Record<string, boolean>;
  error?: string;
  endedAt?: string;
}

async function main(): Promise<void> {
  const worker = workerScript();
  const child = launch();
  const report: Report = {
    label: LABEL,
    minutes: MINUTES,
    teams: TEAMS,
    rssMb: RSS_MB,
    startedAt: new Date().toISOString(),
  };
  const samples: Sample[] = [];
  const electron = String(createRequire(join(ROOT, "package.json"))("electron"));
  try {
    let page = await connectPage();
    const inspector = await InspectorClient.connect(INSPECT_PORT);
    await inspector.evaluate(MAIN_PROBE);
    // The main process's CPU profile, for PROFILE_SECONDS from the time it starts.
    const startProfile = async () => {
      await inspector.send("Profiler.enable");
      await inspector.send("Profiler.setSamplingInterval", { interval: 1000 });
      await inspector.send("Profiler.start");
      setTimeout(() => {
        void inspector
          .send("Profiler.stop")
          .then((result) => writeFileSync(join(OUT, "main.cpuprofile"), JSON.stringify(result)))
          .catch(() => undefined);
      }, PROFILE_SECONDS * 1000);
    };
    // --profile-at=0: from before the agents are made, so the start of the run is in the profile.
    const profilingSetup = PROFILE_AT === 0;
    if (profilingSetup) await startProfile();
    await windowProbe(page);
    // The app can replace its window (V1.7.0 does a few seconds after the start): then the page that
    // was found is closed, and every call and window sample would fail without a word. Find the window
    // again, and put the frame probe in it again.
    let windowsFound = 1;
    const livePage = async () => {
      // A reload can move the page to a new renderer process: the page that was found then stays "open"
      // while every call on it fails. A call that fails, or takes 5 s, means: find the window again.
      const answer = page.isClosed()
        ? null
        : await Promise.race([
            page.evaluate("'__hxWindowProbe' in window").catch(() => null),
            wait(5_000).then(() => null),
          ]);
      if (answer === true) return page;
      if (answer === null) {
        page = await connectPage();
        windowsFound += 1;
        report.windowsFound = windowsFound;
      }
      await windowProbe(page).catch(() => undefined);
      return page;
    };
    // Calls `window.hxbot.<path>(input)` and gives back its answer, as JSON read back.
    const read = async <T>(schema: z.ZodType<T>, path: string, input?: unknown): Promise<T> => {
      const source = `(async () => {
        const parts = ${JSON.stringify(path)}.split(".");
        let owner = null;
        let target = window.hxbot;
        for (const part of parts) { owner = target; target = target[part]; }
        const value = await target.call(owner, ${JSON.stringify(input ?? null)});
        return JSON.stringify(value ?? null);
      })()`;
      return schema.parse(JSON.parse(z.string().parse(await (await livePage()).evaluate(source))));
    };
    const hxbot = async (path: string, input?: unknown): Promise<void> => {
      await read(z.unknown(), path, input);
    };
    const custom = { id: "hxstress", name: "HX stress worker", command: worker, args: [], env: [], usagePrompt: null };
    if (AUTH_URL) {
      // The development service puts the code in its answer (developmentCode).
      const State = z
        .object({ status: z.string(), challengeId: z.string().optional(), developmentCode: z.string().optional() })
        .loose();
      const sent = await read(State, "auth.requestEmailCode", AUTH_ACCOUNT?.email ?? "stress@example.com");
      // The second step takes the account's password, or the code that a development service gives.
      const code = AUTH_ACCOUNT?.password ?? sent.developmentCode;
      if (sent.status !== "code_sent" || !sent.challengeId || !code)
        throw new Error(`The local account service sent no development code: ${sent.status}`);
      const signed = await read(State, "auth.verifyEmailCode", { challengeId: sent.challengeId, code });
      report.signedIn = signed.status;
      if (signed.status !== "signed_in") throw new Error(`Sign-in ended as ${signed.status}`);
      // The main window replaces the sign-in page.
      await wait(5_000);
      await livePage();
    }
    await hxbot("customAgents.save", custom);
    const model = "hxstress/default";
    let made = 0;
    const make = async (name: string) => {
      made += 1;
      const input = {
        name,
        description: name,
        avatarSeed: `stress-${made}`,
        avatarHue: null,
        initialMessage: "你好，准备开始。",
        provider: "acp",
        model,
      };
      // A new custom agent lists its models a moment after it is saved.
      for (let attempt = 0; ; attempt += 1) {
        try {
          return (await read(z.object({ id: z.string() }), "agent.createAgent", input)).id;
        } catch (error) {
          if (attempt > 60 || !String(error).includes("listed no models")) throw error;
          await wait(1_000);
        }
      }
    };
    const starters: string[] = [];
    const teams: string[][] = [];
    for (const [index, size] of TEAMS.entries()) {
      starters.push(await make(`发起${index + 1}`));
      const members: string[] = [];
      for (let member = 0; member < size; member += 1) members.push(await make(`T${index + 1}成员${member + 1}`));
      teams.push(members);
    }
    const chats = [await make("真人对话1"), await make("真人对话2"), await make("真人对话3")];
    const routineAgents = [await make("定时1"), await make("定时2")];
    let routines = 0;
    for (const [index, agentId] of [...routineAgents, ...routineAgents, ...routineAgents].entries()) {
      await hxbot("agent.createRoutine", {
        agentId,
        name: `定时任务${index + 1}`,
        instruction: "汇总今天的进展。",
        active: true,
        timezone: "UTC",
        schedule: { kind: "interval", amount: 3, unit: "minutes", anchorAt: new Date().toISOString() },
      })
        .then(() => {
          routines += 1;
        })
        .catch((error) => {
          report.routineError = String(error).slice(0, 300);
        });
    }
    report.agents = { starters: starters.length, members: teams.flat().length, chats: chats.length, routines };
    const startAt = Date.now();
    // The load stays for the whole run: when a team is done, its starter starts the next round.
    const rounds = starters.map(() => 0);
    // A round counts once its message is sent; a send that fails is tried again at the next sample.
    const sendErrors: string[] = [];
    report.sendErrors = sendErrors;
    const startRound = async (index: number) => {
      const starter = starters[index];
      if (!starter) return;
      const round = (rounds[index] ?? 0) + 1;
      try {
        await hxbot("agent.sendMessage", {
          agentId: starter,
          text: `HX-STRESS-TEAM 压力团队${index + 1}第${round}轮写一份报告|${teams[index]?.join(",")}`,
        });
        rounds[index] = round;
      } catch (error) {
        if (sendErrors.length < 50) sendErrors.push(String(error).slice(0, 300));
      }
    };
    for (const index of starters.keys()) await startRound(index);
    const end = startAt + MINUTES * 60_000;
    let nextChat = startAt;
    let profiling = profilingSetup;
    let lastPressure: { cpu: { some: number; full: number }; io: { some: number; full: number } } | null = null;
    let chatSends = 0;
    while (Date.now() < end) {
      if (Date.now() >= nextChat) {
        for (const agentId of chats)
          await hxbot("agent.sendMessage", { agentId, text: `进展怎么样？（第 ${chatSends + 1} 次）` }).catch(
            () => undefined,
          );
        chatSends += 1;
        nextChat += 60_000;
      }
      await wait(SAMPLE_MS);
      if (PROFILE_AT !== null && !profiling && Date.now() >= startAt + PROFILE_AT * 60_000) {
        profiling = true;
        await startProfile();
      }
      const main = await inspector
        .evaluate(MAIN_READ)
        .then((value) => MainRead.parse(value))
        .catch(() => null);
      const cpu = pressureTotals("cpu");
      const io = pressureTotals("io");
      const pressure =
        cpu && io && lastPressure
          ? {
              cpuSomeMs: Math.round((cpu.some - lastPressure.cpu.some) / 1000),
              ioSomeMs: Math.round((io.some - lastPressure.io.some) / 1000),
              ioFullMs: Math.round((io.full - lastPressure.io.full) / 1000),
            }
          : null;
      if (cpu && io) lastPressure = { cpu, io };
      const lines = workerLog();
      const done = teamsDone(lines, starters.length);
      for (const index of starters.keys())
        if ((done[index] ?? 0) >= (rounds[index] ?? 0) && Date.now() < end - 60_000) await startRound(index);
      const open = new Map<string, number>();
      for (const line of lines) {
        if (line.event === "turn-start" && line.sessionId)
          open.set(line.sessionId, (open.get(line.sessionId) ?? 0) + 1);
        if (line.event === "turn-end" && line.sessionId) open.set(line.sessionId, (open.get(line.sessionId) ?? 0) - 1);
      }
      samples.push({
        at: Date.now() - startAt,
        loop: main?.loop ?? null,
        sqlite: main?.sqlite ?? null,
        ipc: main?.ipc ?? null,
        window: await readWindow(await livePage()),
        running: [...open.values()].filter((value) => value > 0).length,
        agentRssMb: child.pid ? agentRssMb(child.pid, electron) : 0,
        mainRssMb: main ? Math.round(main.rss / 1024 / 1024) : 0,
        pressure,
      });
      writeFileSync(join(OUT, "samples.json"), JSON.stringify(samples));
    }
    // The stop, as the stop control of a room does it: each open root task of each team room stops
    // (channelCommand "stop"); then no new turn of a member may start after 2 s. Then each starter
    // stops its team.
    const mainTotal = await inspector
      .evaluate(MAIN_TOTAL)
      .then((value) => MainTotal.parse(value))
      .catch(() => null);
    const stopAt = Date.now();
    const rooms = teamRooms();
    for (const channelId of rooms) {
      const page = await read(ChannelTasks, "agent.readChannel", { channelId }).catch(() => null);
      for (const task of page?.tasks ?? []) {
        if (task.parentTaskId !== null || ["completed", "cancelled", "failed", "stopped"].includes(task.state))
          continue;
        await hxbot("agent.channelCommand", {
          type: "stop",
          operationId: crypto.randomUUID(),
          channelId,
          taskId: task.id,
          recipientAgentId: null,
        }).catch(() => undefined);
      }
    }
    const stopIssuedMs = Date.now() - stopAt;
    await wait(15_000);
    for (const starter of starters)
      await hxbot("agent.sendMessage", { agentId: starter, text: "HX-STRESS-STOP" }).catch(() => undefined);
    await wait(5_000);
    const lines = workerLog();
    if (EVENTS) {
      // The last ends of turns reach the window and the database a moment after the stop.
      await wait(10_000);
      report.events = await eventCheck(await livePage(), workerLog(), report.startedAt).catch((error) => ({
        error: String(error),
      }));
    }
    const lateStarts = lines.filter(
      (line) =>
        line.event === "turn-start" &&
        line.kind === "member" &&
        (line.at ?? 0) > stopAt + 2_000 &&
        (line.at ?? 0) < stopAt + 15_000,
    ).length;
    const assigns = lines.filter((line) => line.event === "tool" && line.name === "channel_assign");
    const refused = assigns.filter((line) => line.ok === false || /"status":"refused"/u.test(line.text ?? "")).length;
    const loops = samples.flatMap((sample) => (sample.loop ? [sample.loop] : []));
    const windows = samples.flatMap((sample) => (sample.window ? [sample.window] : []));
    const result: StressResult = {
      samples: samples.length,
      mainLoop: {
        p50: percentile(
          loops.map((loop) => loop.p50),
          0.5,
        ),
        p99: percentile(
          loops.map((loop) => loop.p99),
          0.99,
        ),
        max: Math.max(0, ...loops.map((loop) => loop.max)),
      },
      window: {
        frames: windows.reduce((sum, item) => sum + item.frames, 0),
        maxFrameMs: Math.max(0, ...windows.map((item) => item.maxFrameMs)),
        unresponsiveOver2s: windows.filter((item) => item.maxFrameMs > 2_000).length,
        longestTaskMs: Math.max(0, ...windows.map((item) => item.longestTaskMs)),
      },
      ipc: {
        messagesPerSecondMax: Math.max(0, ...samples.map((sample) => (sample.ipc?.messages ?? 0) / (SAMPLE_MS / 1000))),
        bytesPerSecondMax: Math.max(0, ...samples.map((sample) => (sample.ipc?.bytes ?? 0) / (SAMPLE_MS / 1000))),
      },
      sqlite: {
        writes: samples.reduce((sum, sample) => sum + (sample.sqlite?.writes ?? 0), 0),
        p99: percentile(
          samples.map((sample) => sample.sqlite?.p99 ?? 0),
          0.99,
        ),
        max: Math.max(0, ...samples.map((sample) => sample.sqlite?.max ?? 0)),
      },
      runningMax: Math.max(0, ...samples.map((sample) => sample.running)),
      // The samples whose main-process stall (> 1 s) came with the whole computer waiting for the disk.
      computerStalls: samples
        .filter((sample) => (sample.loop?.max ?? 0) > 1_000)
        .map((sample) => ({ at: sample.at, loopMaxMs: sample.loop?.max ?? 0, pressure: sample.pressure ?? null })),
      ioFullMsTotal: samples.reduce((sum, sample) => sum + (sample.pressure?.ioFullMs ?? 0), 0),
      agentRssMbMax: Math.max(0, ...samples.map((sample) => sample.agentRssMb)),
      mainRssMbMax: Math.max(0, ...samples.map((sample) => sample.mainRssMb)),
      turns: lines.filter((line) => line.event === "turn-start").length,
      memberTurns: lines.filter((line) => line.event === "turn-start" && line.kind === "member").length,
      assigns: assigns.length,
      refused,
      teamsDone: lines.filter((line) => line.event === "tool" && line.name === "team_done" && line.ok).length,
      rounds,
      errors: lines.filter((line) => line.event === "error").length,
      stop: { lateMemberStarts: lateStarts, rooms: rooms.length, issueMs: stopIssuedMs },
      mainLoopRun: mainTotal,
      chatSends,
    };
    report.result = result;
    report.gates = {
      // The p99 of the whole run (a histogram that is never reset); the p99 of each 5 s sample is in mainLoop.
      loopP99Under200: mainTotal !== null && mainTotal.p99 <= 200,
      loopMaxUnder1000: result.mainLoop.max <= 1_000,
      windowNoFreeze2s: result.window.unresponsiveOver2s === 0,
      refusedZero: refused === 0,
      stopWithin2s: lateStarts === 0,
      // BUG-CONC-01-A3 (with --events=1): no end of a turn and no usage record is lost.
      ...(report.events
        ? {
            eventsMatch:
              "agentTurns" in report.events &&
              report.events.agentTurns.lost === 0 &&
              report.events.agentTurns.extra === 0 &&
              report.events.agentTurns.wrongStatus === 0 &&
              report.events.turnEnds.agents === report.events.turnEnds.stored &&
              report.events.usage.records === report.events.usage.replies &&
              Math.abs(report.events.usage.reportedUsd - report.events.usage.recordedUsd) < 1e-6,
          }
        : {}),
    };
    inspector.close();
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    report.endedAt = new Date().toISOString();
    writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Ended.
      }
    }
  }
  if (report.error) process.exitCode = 1;
}

await main();
