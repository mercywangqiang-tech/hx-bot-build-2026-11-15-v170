// HXBot 电脑操控（二）：HXBot 自己和 Computer Use 驱动说话的连接。
//
// The agents reach the driver through `cua-driver mcp --socket <address>`, a short-lived process
// that speaks the daemon's own line protocol to HXBot's tap in the main process (the tap moves the
// rim and the agent cursor and passes every line on). This connection speaks the same protocol to
// the same address, so HXBot's own steps (computer_look, computer_do) show the same rim and cursor
// as an agent's driver calls, and the main process needs no new channel.
//
// One request is in flight at a time: the replies carry no id. A request that times out closes the
// connection, so a late reply can never be read as the answer to the next request.
import { connect, type Socket } from "node:net";
import type { McpServerConfig } from "@hxbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@hxbot/contracts/runtime-values";

/** What the driver answered to one tool call. */
export interface HxDriverAnswer {
  /** False when the daemon refused the request itself, or the connection failed. */
  ok: boolean;
  /** The tool's `structuredContent`, or null when it gave none. */
  content: DynamicRecord | null;
  /** The text items of the result, joined. */
  text: string;
  /** Why the request failed, when `ok` is false. */
  error: string | null;
}

/** The one thing the steps need from the driver. Tests pass a double. */
export interface HxDriverPort {
  call(tool: string, args: DynamicRecord, timeoutMs?: number): Promise<HxDriverAnswer>;
}

/** The longest a reply may be. A window read with no screenshot is a few hundred kilobytes. */
const MAX_REPLY_CHARS = 16_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;

/** The address in the driver entry the agents are handed, or null while the driver does not run. */
export function hxDriverAddress(config: Pick<McpServerConfig, "args"> | null): string | null {
  if (!config) return null;
  const at = config.args.indexOf("--socket");
  const address = at >= 0 ? config.args[at + 1] : undefined;
  return address && address.length > 0 ? address : null;
}

/** What one reply line says, for a request that was sent. */
export function hxReadDriverReply(line: string): HxDriverAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return failed("The Computer Use driver answered with no JSON.");
  }
  if (!isDynamicRecord(parsed)) return failed("The Computer Use driver answered with no object.");
  if (parsed.ok !== true) {
    return failed(typeof parsed.error === "string" ? parsed.error.slice(0, 300) : "The driver refused the request.");
  }
  const result = isDynamicRecord(parsed.result) ? parsed.result : {};
  const content = isDynamicRecord(result.structuredContent) ? result.structuredContent : null;
  const items = Array.isArray(result.content) ? result.content : [];
  const text = items
    .map((item) => (isDynamicRecord(item) && item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .filter((part) => part.length > 0)
    .join("\n");
  return { ok: true, content, text, error: null };
}

function failed(error: string): HxDriverAnswer {
  return { ok: false, content: null, text: "", error };
}

interface Waiting {
  done: (answer: HxDriverAnswer) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The connection. `address` is read at each connect, because the driver starts and stops while HXBot runs. */
export class HxDriverSocket implements HxDriverPort {
  readonly #address: () => string | null;
  readonly #sessionId: string;
  #socket: Socket | null = null;
  #buffer = "";
  #waiting: Waiting | null = null;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(address: () => string | null, sessionId: string) {
    this.#address = address;
    this.#sessionId = sessionId;
  }

  call(tool: string, args: DynamicRecord, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<HxDriverAnswer> {
    const turn = this.#queue.then(() => this.#send(tool, args, timeoutMs));
    this.#queue = turn.catch(() => undefined);
    return turn;
  }

  /** Ends the lease and the connection. */
  close(): void {
    this.#drop("The connection was closed.");
  }

  async #send(tool: string, args: DynamicRecord, timeoutMs: number): Promise<HxDriverAnswer> {
    const socket = await this.#connection();
    if (typeof socket === "string") return failed(socket);
    return new Promise<HxDriverAnswer>((resolve) => {
      const timer = setTimeout(() => {
        this.#drop(`The Computer Use driver did not answer ${tool} in ${Math.round(timeoutMs / 1000)} s.`);
      }, timeoutMs);
      this.#waiting = { done: resolve, timer };
      const request = { method: "call", name: tool, args, session_id: this.#sessionId, client_kind: "cli" };
      try {
        socket.write(`${JSON.stringify(request)}\n`);
      } catch (error) {
        this.#drop(error instanceof Error ? error.message : String(error));
      }
    });
  }

  #connection(): Promise<Socket | string> {
    const open = this.#socket;
    if (open && !open.destroyed) return Promise.resolve(open);
    const address = this.#address();
    if (!address)
      return Promise.resolve("Computer Use is not running. The user turns it on in Settings → Computer Use.");
    return new Promise((resolve) => {
      const socket = connect(address);
      const fail = (error: Error) => resolve(`The Computer Use driver could not be reached: ${error.message}`);
      socket.once("error", fail);
      socket.once("connect", () => {
        socket.removeListener("error", fail);
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => this.#read(chunk));
        socket.on("error", (error) => this.#drop(error.message));
        socket.on("close", () => this.#drop("The Computer Use driver closed the connection."));
        this.#socket = socket;
        this.#buffer = "";
        resolve(socket);
      });
    });
  }

  #read(chunk: string): void {
    this.#buffer += chunk;
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      const waiting = this.#waiting;
      this.#waiting = null;
      if (waiting) {
        clearTimeout(waiting.timer);
        waiting.done(hxReadDriverReply(line));
      }
      newline = this.#buffer.indexOf("\n");
    }
    if (this.#buffer.length > MAX_REPLY_CHARS) this.#drop("The Computer Use driver answered with too much.");
  }

  #drop(reason: string): void {
    const socket = this.#socket;
    this.#socket = null;
    this.#buffer = "";
    const waiting = this.#waiting;
    this.#waiting = null;
    if (waiting) {
      clearTimeout(waiting.timer);
      waiting.done(failed(reason));
    }
    if (socket) {
      socket.removeAllListeners();
      socket.on("error", () => {});
      socket.destroy();
    }
  }
}
