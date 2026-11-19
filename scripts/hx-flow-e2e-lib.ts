// HXBot v1.7.1 (HX-Flow): what the HX-Flow E2E scripts share. It starts the built app (`bun run build`
// output in `out/`) on a profile of its own, with custom ACP agents that do team work with no model
// (`provider-fakes/agents/hx-team-worker.ts`), and reads what the app and the agents wrote: the
// budget lines of the app log, the turns and tool calls of the worker log, and the team records.
//
// In a container that runs as root, Electron starts as another user under xvfb-run (`runAs`).
import { type ChildProcess, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import { z } from "zod";

export const ROOT = resolve(import.meta.dirname, "..");
export const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
export const GIB = 1024 ** 3;

/** One line of the worker log (`FAKE_LOG`). */
export const WorkerLineSchema = z.object({
  event: z.string(),
  sessionId: z.string().optional(),
  name: z.string().optional(),
  ok: z.boolean().optional(),
  text: z.string().optional(),
  kind: z.string().optional(),
  at: z.number().optional(),
  cancelled: z.boolean().optional(),
  message: z.string().optional(),
  /** channel_assign: the queue line of the reply. */
  queue: z.string().optional(),
  /** turn-start of a member: the goal of its handoff form. */
  goal: z.string().optional(),
});
export type WorkerLine = z.infer<typeof WorkerLineSchema>;

/** A change of B in the app log: "HX-Flow changed the turn budget. {detail}". */
export interface BudgetLine {
  at: number;
  budget: number;
  from: number;
  bound: string;
}

const BudgetDetailSchema = z.object({ budget: z.number(), from: z.number(), bound: z.string() });

const TeamRecordSchema = z
  .object({
    id: z.string(),
    roomName: z.string(),
    channelId: z.string(),
    state: z.string(),
    leadAgentId: z.string(),
    members: z.array(z.object({ agentId: z.string(), name: z.string(), role: z.string() }).loose()),
    limits: z.object({ members: z.number(), minutes: z.number(), rounds: z.number() }).loose(),
    stated: z.object({}).loose().nullish(),
    guard: z
      .object({
        paused: z.object({ guard: z.string(), at: z.string(), reason: z.string() }).nullable().optional(),
      })
      .loose()
      .nullish(),
    createdAt: z.string(),
    deadline: z.string(),
    endedAt: z.string().nullish(),
    reason: z.string().nullish(),
  })
  .loose();
export type TeamRecord = z.infer<typeof TeamRecordSchema>;

export interface AppOptions {
  /** The folder of this run, under .hxbot-build/. */
  out: string;
  runAs: string | null;
  /** The environment of the fake agents (HX_STRESS_*). */
  worker?: Record<string, string>;
  /** More environment for the app, such as HXBOT_HX_FLOW_SAMPLE_FILE. */
  env?: Record<string, string>;
  /** v1.7.4: another fake agent, relative to the tree (default: the team worker). */
  workerScript?: string;
  /** The source tree whose build runs (default: this one). */
  root?: string;
  debugPort?: number;
  inspectPort?: number;
}

/** The profile folders of the app for the user that runs it. */
export function profileFolders(runAs: string | null): string[] {
  const home = runAs ? `/home/${runAs}` : (process.env.HOME ?? "");
  return [join(home, ".config", "HXBot"), join(home, ".config", "HXBot Dev"), join(home, "HXBot")];
}

/** Whether something on this computer listens on one of these local ports. */
async function anyPortInUse(ports: readonly number[]): Promise<boolean> {
  const answers = await Promise.all(
    ports.map(
      (port) =>
        new Promise<boolean>((done) => {
          const socket = connect({ host: "127.0.0.1", port });
          socket.once("connect", () => {
            socket.destroy();
            done(true);
          });
          socket.once("error", () => done(false));
        }),
    ),
  );
  return answers.some(Boolean);
}

/** A fresh profile: the app starts with no agents, no channels and no teams. */
export function wipeProfile(runAs: string | null): void {
  for (const folder of profileFolders(runAs)) rmSync(folder, { recursive: true, force: true });
}

/** The team records of the profile. */
export function teamRecords(runAs: string | null): TeamRecord[] {
  const folder = join(profileFolders(runAs)[1] ?? "", "hx-team");
  if (!existsSync(folder)) return [];
  const teams: TeamRecord[] = [];
  for (const name of readdirSync(folder)) {
    if (!name.endsWith(".json")) continue;
    const parsed = TeamRecordSchema.safeParse(JSON.parse(readFileSync(join(folder, name), "utf8")));
    if (parsed.success) teams.push(parsed.data);
  }
  return teams;
}

/** A Bun that the other user can run: the one in root's home is not readable. */
function sharedBun(): string {
  if (!process.execPath.startsWith("/root/")) return process.execPath;
  for (const candidate of [process.env.HX_STRESS_BUN, "/home/claude/bun142/node_modules/bun/bin/bun.exe"])
    if (candidate && existsSync(candidate)) return candidate;
  throw new Error("Set HX_STRESS_BUN to a Bun binary that the --run-as user can run.");
}

export class HxApp {
  readonly options: AppOptions;
  readonly root: string;
  readonly workerLog: string;
  readonly appLog: string;
  #child: ChildProcess | null = null;
  #page: Page | null = null;
  #made = 0;

  constructor(options: AppOptions) {
    this.options = options;
    this.root = options.root ?? ROOT;
    mkdirSync(options.out, { recursive: true });
    chmodSync(options.out, 0o777);
    this.workerLog = join(options.out, "worker.jsonl");
    this.appLog = join(options.out, "app.log");
  }

  /** The command of the custom agent: the worker with its environment. */
  #workerScript(): string {
    const path = join(this.options.out, "worker.sh");
    const env = {
      FAKE_LOG: this.workerLog,
      HX_STRESS_STATE: join(this.options.out, "leads"),
      ...this.options.worker,
    };
    const exports = Object.entries(env)
      .map(([name, value]) => `export ${name}=${JSON.stringify(value)}\n`)
      .join("");
    const worker = join(this.root, this.options.workerScript ?? "scripts/provider-fakes/agents/hx-team-worker.ts");
    writeFileSync(path, `#!/bin/sh\n${exports}exec "${sharedBun()}" "${worker}" "$@"\n`);
    chmodSync(path, 0o755);
    if (!existsSync(this.workerLog)) writeFileSync(this.workerLog, "");
    chmodSync(this.workerLog, 0o666);
    return path;
  }

  /** Starts the app and opens its window. The worker log of an earlier start of the same run stays. */
  async start(label: string): Promise<void> {
    const worker = this.#workerScript();
    const electron = String(createRequire(join(this.root, "package.json"))("electron"));
    const env = {
      HXBOT_APP_VARIANT: "preview",
      HXBOT_DEV_PROFILE: "app",
      HXBOT_DEV_INSTANCE_ID: `hx-flow-${label}-${Date.now()}`,
      HXBOT_DEV_REMOTE_DEBUGGING_PORT: String(this.options.debugPort ?? 9_633),
      ...this.options.env,
    };
    const app = [electron, `--inspect=127.0.0.1:${this.options.inspectPort ?? 9_649}`, this.root];
    const runAs = this.options.runAs;
    const command = runAs
      ? [
          "runuser",
          "-u",
          runAs,
          "--",
          "env",
          `HOME=/home/${runAs}`,
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
    if (!existsSync(this.appLog)) writeFileSync(this.appLog, "");
    this.#child = spawn("sh", ["-c", `exec "$@" >> ${JSON.stringify(this.appLog)} 2>&1`, "sh", file, ...args], {
      detached: true,
      env: { ...process.env, ...env },
    });
    this.#page = await this.#connect();
    this.#made = 0;
    await this.call("customAgents.save", {
      id: "hxstress",
      name: "HX stress worker",
      command: worker,
      args: [],
      env: [],
      usagePrompt: null,
    });
  }

  async #connect(): Promise<Page> {
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.options.debugPort ?? 9_633}`);
        const page = browser
          .contexts()
          .flatMap((context) => context.pages())
          // The window's scheme kept its upstream name (openbot-app://).
          .find(
            (candidate) => candidate.url().startsWith("openbot-app://") || candidate.url().startsWith("hxbot-app://"),
          );
        if (page) {
          await page.waitForFunction("'hxbot' in window", undefined, { timeout: 60_000 });
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

  get page(): Page {
    if (!this.#page) throw new Error("The app is not started.");
    return this.#page;
  }

  /** Calls `window.hxbot.<path>(input)` and returns what it gives back, as JSON. */
  async call(path: string, input?: unknown): Promise<string> {
    const source = `(async () => {
      const parts = ${JSON.stringify(path)}.split(".");
      let owner = null;
      let target = window.hxbot;
      for (const part of parts) { owner = target; target = target[part]; }
      const value = await target.call(owner, ${JSON.stringify(input ?? null)});
      return JSON.stringify(value ?? null);
    })()`;
    // A reload can move the window to a new renderer process (V1.7.0 does a few seconds after the
    // start): the page that was found stays "open" while calls on it fail. Then find it again, once.
    if (!this.#page || this.#page.isClosed()) this.#page = await this.#connect();
    try {
      return z.string().parse(await this.#page.evaluate(source));
    } catch (error) {
      const alive = await this.#page.evaluate("'hxbot' in window").catch(() => false);
      if (alive === true) throw error;
      this.#page = await this.#connect();
      return z.string().parse(await this.#page.evaluate(source));
    }
  }

  /** A new agent that runs the worker. A new custom agent lists its models a moment after it is saved. */
  async make(name: string): Promise<string> {
    this.#made += 1;
    const input = {
      name,
      description: name,
      avatarSeed: `hx-flow-${this.#made}`,
      avatarHue: null,
      initialMessage: "你好，准备开始。",
      provider: "acp",
      model: "hxstress/default",
    };
    for (let attempt = 0; ; attempt += 1) {
      try {
        return z.object({ id: z.string() }).parse(JSON.parse(await this.call("agent.createAgent", input))).id;
      } catch (error) {
        if (attempt > 60 || !String(error).includes("listed no models")) throw error;
        await wait(1_000);
      }
    }
  }

  async send(agentId: string, text: string): Promise<void> {
    await this.call("agent.sendMessage", { agentId, text });
  }

  /** Stops the app (the whole process group) and waits until it is gone. */
  async stop(): Promise<void> {
    await this.#page
      ?.context()
      .browser()
      ?.close()
      .catch(() => undefined);
    this.#page = null;
    const child = this.#child;
    this.#child = null;
    if (!child?.pid) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      return;
    }
    for (let index = 0; index < 60; index += 1) {
      try {
        process.kill(-child.pid, 0);
      } catch {
        break;
      }
      await wait(500);
    }
    // The next start uses the same ports: an Electron that still holds them (its process group can
    // empty before it ends) makes the next window unreachable. Wait for them, then end it.
    const ports = [this.options.debugPort ?? 9_633, this.options.inspectPort ?? 9_649];
    for (let index = 0; index < 40 && (await anyPortInUse(ports)); index += 1) await wait(500);
    if (await anyPortInUse(ports)) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Ended.
      }
      for (let index = 0; index < 20 && (await anyPortInUse(ports)); index += 1) await wait(500);
    }
  }

  lines(): WorkerLine[] {
    if (!existsSync(this.workerLog)) return [];
    return readFileSync(this.workerLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        const parsed = WorkerLineSchema.safeParse(JSON.parse(line));
        return parsed.success ? [parsed.data] : [];
      });
  }

  /** The changes of B, from the app log. */
  budgets(): BudgetLine[] {
    if (!existsSync(this.appLog)) return [];
    const found: BudgetLine[] = [];
    for (const line of readFileSync(this.appLog, "utf8").split("\n")) {
      const match = /^(\S+) INFO \[application-services\] HX-Flow changed the turn budget\. (\{.*\})$/u.exec(line);
      if (!match?.[1] || !match[2]) continue;
      const detail = BudgetDetailSchema.safeParse(JSON.parse(match[2]));
      if (detail.success) found.push({ at: Date.parse(match[1]), ...detail.data });
    }
    return found;
  }

  /** The app log lines that match. */
  logLines(pattern: RegExp): string[] {
    if (!existsSync(this.appLog)) return [];
    return readFileSync(this.appLog, "utf8")
      .split("\n")
      .filter((line) => pattern.test(line));
  }
}

/** The turns of the worker log: start, end and the session, in the order they started. */
export interface Turn {
  sessionId: string;
  kind: string;
  goal: string;
  start: number;
  end: number | null;
  cancelled: boolean;
}

export function turnsOf(lines: readonly WorkerLine[]): Turn[] {
  const turns: Turn[] = [];
  const open = new Map<string, Turn[]>();
  for (const line of lines) {
    if (!line.sessionId || line.at === undefined) continue;
    if (line.event === "turn-start") {
      const turn: Turn = {
        sessionId: line.sessionId,
        kind: line.kind ?? "",
        goal: line.goal ?? "",
        start: line.at,
        end: null,
        cancelled: false,
      };
      turns.push(turn);
      open.set(line.sessionId, [...(open.get(line.sessionId) ?? []), turn]);
    } else if (line.event === "turn-end") {
      const waiting = open.get(line.sessionId) ?? [];
      const turn = waiting.shift();
      if (turn) {
        turn.end = line.at;
        turn.cancelled = line.cancelled === true;
      }
    }
  }
  return turns;
}

/** How many turns run at time `at`. */
export function runningAt(turns: readonly Turn[], at: number): number {
  return turns.filter((turn) => turn.start <= at && (turn.end === null || turn.end > at)).length;
}

/** B at time `at`: the last change before it, or the slow start (2) before the first. */
export function budgetAt(budgets: readonly BudgetLine[], at: number): number {
  let budget = 2;
  for (const line of budgets) if (line.at <= at) budget = line.budget;
  return budget;
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
