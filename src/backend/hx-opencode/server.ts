// HXBot: a private OpenCode server on this computer, for connecting services (hx-opencode).
//
// `opencode serve` listens on 127.0.0.1 at a free port and asks for a password on every request.
// HXBot makes a new random password for each start and gives it only to the process, in its
// environment. The server reads and writes OpenCode's own data folder, the one `opencode acp`
// reads, so a credential that it saves reaches the agents at their next start.
//
// The server stops when it has had no request for a few minutes and no browser sign-in waits on it,
// and when HXBot exits. It starts in an empty folder of its own, so no project's OpenCode config,
// plugins or commands load in it.

import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliPathEnvironment, cliSpawnTarget } from "../cli";

export interface HxOcCli {
  readonly executable: string;
  readonly version: string;
  readonly launchPath?: string;
}

/** OpenCode's own words for a refused request, such as a key the service refused. */
class HxOcRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HxOcRequestError";
  }
}

const START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** No request for this long and no sign-in waiting: the server stops. */
const IDLE_MS = 5 * 60_000;
const LISTENING = /listening on (http:\/\/127\.0\.0\.1:\d+)/u;
const STDERR_TAIL = 2000;

export type HxOcSpawn = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string; windowsVerbatimArguments: boolean },
) => ChildProcess;

const defaultSpawn: HxOcSpawn = (command, args, options) =>
  spawn(command, [...args], { ...options, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

/** The environment of the server: the user's own, and nothing that would change OpenCode's config. */
function hxOcServerEnvironment(cli: HxOcCli, password: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...cliPathEnvironment(cli) };
  for (const name of Object.keys(env)) {
    const upper = name.toUpperCase();
    if (upper === "OPENCODE_CONFIG_CONTENT" || upper === "OPENCODE_CONFIG" || upper === "OPENCODE_PASSWORD") {
      delete env[name];
    }
  }
  env.OPENCODE_DISABLE_AUTOUPDATE = "1";
  env.OPENCODE_SERVER_PASSWORD = password;
  return env;
}

interface Running {
  readonly child: ChildProcess;
  readonly url: string;
  readonly authorization: string;
}

export class HxOcServer {
  readonly #resolve: () => Promise<HxOcCli>;
  readonly #spawn: HxOcSpawn;
  #running: Running | null = null;
  #starting: Promise<Running> | null = null;
  #idle: ReturnType<typeof setTimeout> | null = null;
  /** A browser sign-in waits on the server until this time. */
  #holdUntil = 0;

  constructor(resolve: () => Promise<HxOcCli>, spawnProcess: HxOcSpawn = defaultSpawn) {
    this.#resolve = resolve;
    this.#spawn = spawnProcess;
  }

  /** Keeps the server for a sign-in in the browser, which OpenCode completes on its own port. */
  hold(until: number): void {
    this.#holdUntil = Math.max(this.#holdUntil, until);
    this.#touch();
  }

  /** One request to the server. Starts it first if it is not running. */
  async request(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<unknown> {
    const running = await this.#start();
    this.#touch();
    const response = await fetch(`${running.url}${path}`, {
      method,
      headers: {
        authorization: running.authorization,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    this.#touch();
    const raw = await response.text();
    let value: unknown = null;
    if (raw.length > 0) {
      try {
        value = JSON.parse(raw);
      } catch {
        value = null;
      }
    }
    if (!response.ok) {
      const message =
        typeof value === "object" && value !== null && "message" in value && typeof value.message === "string"
          ? value.message
          : `HTTP ${response.status}`;
      throw new HxOcRequestError(message, response.status);
    }
    return value;
  }

  stop(): void {
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = null;
    this.#holdUntil = 0;
    const running = this.#running;
    this.#running = null;
    if (running && running.child.exitCode === null) running.child.kill();
  }

  #touch(): void {
    if (this.#idle) clearTimeout(this.#idle);
    const wait = Math.max(IDLE_MS, this.#holdUntil - Date.now() + 60_000);
    this.#idle = setTimeout(() => this.stop(), wait);
    this.#idle.unref?.();
  }

  async #start(): Promise<Running> {
    if (this.#running && this.#running.child.exitCode === null) return this.#running;
    this.#starting ??= this.#launch().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #launch(): Promise<Running> {
    const cli = await this.#resolve();
    const password = randomBytes(24).toString("base64url");
    const folder = join(tmpdir(), "hxbot-opencode-connect");
    mkdirSync(folder, { recursive: true });
    const target = cliSpawnTarget(cli.executable, ["serve", "--hostname", "127.0.0.1", "--port", "0"]);
    const child = this.#spawn(target.command, target.args, {
      env: hxOcServerEnvironment(cli, password, process.env),
      cwd: folder,
      windowsVerbatimArguments: target.windowsVerbatimArguments,
    });
    const kill = () => {
      if (child.exitCode === null) child.kill();
    };
    process.once("exit", kill);
    child.once("exit", () => {
      process.removeListener("exit", kill);
      if (this.#running?.child === child) this.#running = null;
    });
    const url = await new Promise<string>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        kill();
        reject(new Error(`OpenCode did not start its server in time. ${stderr.slice(-300)}`.trim()));
      }, START_TIMEOUT_MS);
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      // OpenCode prints the address on standard output; a later version may move it to standard error.
      const listen = (text: string) => {
        const match = LISTENING.exec(text);
        if (match?.[1]) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      };
      child.stdout?.on("data", (chunk: string) => {
        stdout = (stdout + chunk).slice(-STDERR_TAIL);
        listen(stdout);
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-STDERR_TAIL);
        listen(stderr);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`OpenCode's server stopped (code ${code ?? "none"}). ${stderr.slice(-300)}`.trim()));
      });
    });
    const running: Running = {
      child,
      url,
      authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    };
    this.#running = running;
    this.#touch();
    return running;
  }
}
