// HXBot 真实模型检查（v1.6.7）：经 OpenCode 自己的客户端用它的免费模型。
//
// OpenCode 的免费模型只接受 OpenCode 客户端的请求，所以检查程序启动 `opencode acp`（智能体客户端协议，
// HXBot 的 OpenCode 助手也是这样连的），每段对话一个会话。HXBot 的工具经一个 MCP 服务交给 OpenCode：
// OpenCode 为每个会话启动一个小的 MCP 进程（本文件的 hxMcpBridge，就是检查程序自己），它把工具的清单
// 和调用转给检查程序本机的一个 HTTP 地址，由检查程序用产品自己的代码回答，团队等状态都留在检查程序里。
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { type DynamicRecord, isDynamicRecord } from "@hxbot/contracts/runtime-values";
import type { HxBrain, HxBrainTurn } from "./brain";
import type { HxChatTool } from "./chat-model";
import type { HxLoopCall } from "./loop";

const PROMPT_MS = 6 * 60_000;
const START_MS = 60_000;

interface HxToolGroup {
  tools: readonly HxChatTool[];
  handle: (name: string, args: unknown) => Promise<string>;
  calls: HxLoopCall[];
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function reply(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

/** The tools of each conversation, on a local HTTP address that the bridges ask. */
class HxToolHub {
  readonly groups = new Map<string, HxToolGroup>();
  #server: Server | null = null;
  url = "";

  async start(): Promise<void> {
    this.#server = createServer((request, response) => {
      void this.#serve(request, response).catch((error: unknown) =>
        reply(response, 500, { error: error instanceof Error ? error.message : String(error) }),
      );
    });
    await new Promise<void>((resolve) => this.#server?.listen(0, "127.0.0.1", resolve));
    const address = this.#server.address();
    if (address && typeof address === "object") this.url = `http://127.0.0.1:${address.port}`;
  }

  async #serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.url);
    const group = this.groups.get(url.searchParams.get("group") ?? "");
    if (!group) return reply(response, 404, { error: "no such group" });
    if (request.method === "GET" && url.pathname === "/tools")
      return reply(response, 200, {
        tools: group.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters,
        })),
      });
    if (request.method === "POST" && url.pathname === "/call") {
      const body = JSON.parse(await readBody(request));
      const name = isDynamicRecord(body) && typeof body.name === "string" ? body.name : "";
      const args = isDynamicRecord(body) ? (body.arguments ?? {}) : {};
      const known = group.tools.some((tool) => tool.name === name);
      let text: string;
      try {
        text = known
          ? await group.handle(name, args)
          : JSON.stringify({ status: "invalid", reason: `There is no tool ${name}.` });
      } catch (error) {
        text = JSON.stringify({ status: "failed", reason: error instanceof Error ? error.message : String(error) });
      }
      group.calls.push({ name, args, answer: text });
      return reply(response, 200, { text });
    }
    return reply(response, 404, { error: "no such address" });
  }

  close(): void {
    this.#server?.close();
  }
}

/** A JSON-RPC peer on newline-separated JSON, as ACP and stdio MCP use. */
class HxRpc {
  #next = 1;
  readonly #waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  readonly #write: (line: string) => void;
  onNotify: (method: string, params: DynamicRecord) => void = () => undefined;
  onRequest: (method: string, params: DynamicRecord) => Promise<unknown> = async () => {
    throw new Error("not supported");
  };

  constructor(write: (line: string) => void) {
    this.#write = write;
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.#next++;
    this.#write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(id);
        reject(new Error(`${method}: no answer in ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      this.#waiting.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  failAll(reason: string): void {
    for (const waiting of this.#waiting.values()) waiting.reject(new Error(reason));
    this.#waiting.clear();
  }

  read(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isDynamicRecord(message)) return;
    const params = isDynamicRecord(message.params) ? message.params : {};
    if (typeof message.method === "string" && message.id !== undefined) {
      const id = message.id;
      void this.onRequest(message.method, params).then(
        (result) => this.#write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`),
        (error: unknown) =>
          this.#write(
            `${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: error instanceof Error ? error.message : String(error) } })}\n`,
          ),
      );
      return;
    }
    if (typeof message.method === "string") {
      this.onNotify(message.method, params);
      return;
    }
    if (typeof message.id !== "number") return;
    const waiting = this.#waiting.get(message.id);
    if (!waiting) return;
    this.#waiting.delete(message.id);
    if (isDynamicRecord(message.error)) waiting.reject(new Error(String(message.error.message ?? "error")));
    else waiting.resolve(message.result);
  }
}

/** The option of a permission request that allows once, or else the first that allows. */
function allowOption(params: DynamicRecord): string | null {
  const options = Array.isArray(params.options) ? params.options.filter(isDynamicRecord) : [];
  const allow =
    options.find((option) => option.kind === "allow_once") ??
    options.find((option) => String(option.kind).startsWith("allow"));
  return allow && typeof allow.optionId === "string" ? allow.optionId : null;
}

function rejectOption(params: DynamicRecord): string | null {
  const options = Array.isArray(params.options) ? params.options.filter(isDynamicRecord) : [];
  const reject =
    options.find((option) => option.kind === "reject_once") ??
    options.find((option) => String(option.kind).startsWith("reject"));
  return reject && typeof reject.optionId === "string" ? reject.optionId : null;
}

/**
 * A brain on OpenCode: `opencode acp` with `model` (such as "opencode/some-free-model"), started
 * once; each conversation is an ACP session with its own MCP bridge to the tools of that conversation.
 */
export async function hxAcpBrain(input: {
  executable: string;
  model: string;
  /** How OpenCode starts a bridge: this program and its arguments, before the address and the group. */
  bridge: { command: string; args: string[] };
  log: (line: string) => void;
}): Promise<HxBrain> {
  const hub = new HxToolHub();
  await hub.start();
  const cwd = mkdtempSync(join(tmpdir(), "hx-acp-"));
  const child: ChildProcess = spawn(input.executable, ["acp"], {
    cwd,
    env: {
      ...process.env,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: input.model }),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-3000);
  });
  const rpc = new HxRpc((line) => child.stdin?.write(line));
  if (child.stdout) createInterface({ input: child.stdout }).on("line", (line) => rpc.read(line));
  child.once("exit", (code) => rpc.failAll(`opencode acp stopped (${code ?? "signal"}): ${stderr.slice(-500)}`));

  const texts = new Map<string, string>();
  const allowed = new Set<string>();
  rpc.onNotify = (method, params) => {
    if (method !== "session/update" || typeof params.sessionId !== "string" || !isDynamicRecord(params.update)) return;
    const update = params.update;
    if (update.sessionUpdate === "agent_message_chunk" && isDynamicRecord(update.content)) {
      const text = typeof update.content.text === "string" ? update.content.text : "";
      texts.set(params.sessionId, (texts.get(params.sessionId) ?? "") + text);
    }
  };
  rpc.onRequest = async (method, params) => {
    if (method === "session/request_permission") {
      // HXBot's own tools are allowed; anything else (a shell, a file change) is refused.
      const call = isDynamicRecord(params.toolCall) ? params.toolCall : {};
      const title = `${String(call.title ?? "")} ${JSON.stringify(call.rawInput ?? "")}`;
      const ours = /hxbot/iu.test(title) || allowed.has(String(call.toolCallId ?? ""));
      const optionId = ours ? allowOption(params) : rejectOption(params);
      input.log(`permission ${ours ? "allowed" : "refused"}: ${title.slice(0, 200)}`);
      return optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } };
    }
    throw new Error(`${method} is not offered`);
  };

  const started = await rpc
    .request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      },
      START_MS,
    )
    .catch((error: unknown) => error);
  if (started instanceof Error) {
    child.kill();
    hub.close();
    throw new Error(`OpenCode did not start: ${started.message}`);
  }
  input.log(`opencode acp: ${JSON.stringify(started).slice(0, 400)}`);

  const sessions = new Map<string, string>();
  return {
    name: `OpenCode ${input.model}`,
    async turn(turn): Promise<HxBrainTurn> {
      const group: HxToolGroup = hub.groups.get(turn.session) ?? { tools: turn.tools, handle: turn.handle, calls: [] };
      group.tools = turn.tools;
      group.handle = turn.handle;
      hub.groups.set(turn.session, group);
      let sessionId = sessions.get(turn.session);
      let words = turn.user;
      try {
        if (!sessionId) {
          const made = await rpc.request(
            "session/new",
            {
              cwd,
              mcpServers: [
                {
                  name: "hxbot",
                  command: input.bridge.command,
                  args: [...input.bridge.args, hub.url, turn.session],
                  env: [],
                },
              ],
            },
            START_MS,
          );
          sessionId = isDynamicRecord(made) && typeof made.sessionId === "string" ? made.sessionId : "";
          if (!sessionId) throw new Error(`session/new gave no session: ${JSON.stringify(made).slice(0, 300)}`);
          sessions.set(turn.session, sessionId);
          words = `${turn.system}\n\n${turn.user}`;
        } else {
          words = `(Standing instructions, as now:)\n${turn.system}\n\n${turn.user}`;
        }
        const before = group.calls.length;
        texts.set(sessionId, "");
        const done = await rpc.request(
          "session/prompt",
          { sessionId, prompt: [{ type: "text", text: words }] },
          PROMPT_MS,
        );
        const stop = isDynamicRecord(done) ? String(done.stopReason ?? "") : "";
        return {
          calls: group.calls.slice(before),
          text: texts.get(sessionId) ?? "",
          end: stop === "max_turn_requests" ? "limit" : "stopped",
        };
      } catch (error) {
        return {
          calls: group.calls.slice(),
          text: sessionId ? (texts.get(sessionId) ?? "") : "",
          end: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async close() {
      child.kill();
      hub.close();
    },
  };
}

/**
 * The MCP bridge that OpenCode starts for a conversation: an MCP server on standard input and output
 * that lists and calls the tools of `group` through the check's local address `url`.
 */
export async function hxMcpBridge(url: string, group: string): Promise<void> {
  const rpc = new HxRpc((line) => process.stdout.write(line));
  rpc.onNotify = () => undefined;
  rpc.onRequest = async (method, params) => {
    if (method === "initialize")
      return {
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "hxbot", version: "1.6.7" },
      };
    if (method === "ping") return {};
    if (method === "tools/list") {
      const response = await fetch(`${url}/tools?group=${encodeURIComponent(group)}`);
      return response.json();
    }
    if (method === "tools/call") {
      const response = await fetch(`${url}/call?group=${encodeURIComponent(group)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: params.name, arguments: params.arguments ?? {} }),
      });
      const answer = await response.json();
      const text = isDynamicRecord(answer) && typeof answer.text === "string" ? answer.text : JSON.stringify(answer);
      return { content: [{ type: "text", text }], isError: false };
    }
    throw new Error(`${method} is not offered`);
  };
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) rpc.read(line);
}
