// HXBot 真实模型检查（v1.6.7）：一个只用 fetch 的对话模型接口（OpenAI 兼容的 chat/completions）。
// 检查程序在 GitHub 的机器上用它连真实模型：先试 OpenCode 自带的免费模型（不用账号），再试
// GitHub Models（工作流自带的令牌）。只在检查程序里用，产品本身不用它。
import type { DynamicRecord } from "@hxbot/contracts/runtime-values";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";

export interface HxChatTool {
  name: string;
  description: string;
  parameters: DynamicRecord;
}

interface HxChatCall {
  id: string;
  name: string;
  /** The arguments as the model wrote them: JSON text, not yet read. */
  arguments: string;
}

export type HxChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: HxWireCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface HxWireCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface HxChatTurn {
  text: string;
  calls: HxChatCall[];
}

export interface HxChatModel {
  /** Who answers, for the report, such as "OpenCode big-pickle". */
  name: string;
  turn(messages: readonly HxChatMessage[], tools: readonly HxChatTool[]): Promise<HxChatTurn>;
}

export interface HxChatEndpoint {
  name: string;
  url: string;
  key: string;
  model: string;
  headers?: Readonly<Record<string, string>>;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const TURN_TIMEOUT_MS = 180_000;
const RETRIES = 4;

/** Reads one chat/completions answer. Text and tool calls; anything else is left out. */
function hxReadChatAnswer(body: unknown): HxChatTurn {
  const choices = isDynamicRecord(body) && Array.isArray(body.choices) ? body.choices : [];
  const [first] = choices;
  const message = isDynamicRecord(first) && isDynamicRecord(first.message) ? first.message : {};
  const text = typeof message.content === "string" ? message.content : "";
  const wire = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const calls: HxChatCall[] = [];
  for (const [index, item] of wire.entries()) {
    if (!isDynamicRecord(item) || !isDynamicRecord(item.function)) continue;
    const name = item.function.name;
    if (typeof name !== "string" || !name) continue;
    const args = item.function.arguments;
    calls.push({
      id: typeof item.id === "string" && item.id ? item.id : `call-${index + 1}`,
      name,
      arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
    });
  }
  return { text, calls };
}

/** The assistant message that goes back into the history after a turn. */
export function hxAssistantMessage(turn: HxChatTurn): HxChatMessage {
  return turn.calls.length
    ? {
        role: "assistant",
        content: turn.text || null,
        tool_calls: turn.calls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      }
    : { role: "assistant", content: turn.text };
}

/** A model behind an OpenAI compatible chat/completions address. Busy answers are tried again. */
function hxChatModel(
  endpoint: HxChatEndpoint,
  options: { fetch?: Fetch; wait?: (ms: number) => Promise<void> } = {},
): HxChatModel {
  const send = options.fetch ?? ((url, init) => fetch(url, init));
  const wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    name: endpoint.name,
    async turn(messages, tools) {
      const body = JSON.stringify({
        model: endpoint.model,
        messages,
        ...(tools.length
          ? {
              tools: tools.map((tool) => ({
                type: "function",
                function: { name: tool.name, description: tool.description, parameters: tool.parameters },
              })),
            }
          : {}),
        temperature: 0.2,
      });
      let last = "";
      let url = endpoint.url;
      for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
        let response: Response;
        try {
          response = await send(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
              authorization: `Bearer ${endpoint.key}`,
              ...endpoint.headers,
            },
            body,
            // A redirect is followed by hand: fetch would send a GET to the new address, without the body.
            redirect: "manual",
            signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
          });
        } catch (error) {
          last = error instanceof Error ? error.message : String(error);
          await wait(2_000 * 2 ** attempt);
          continue;
        }
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location) {
          url = new URL(location, url).toString();
          last = `${response.status} to ${url}`;
          continue;
        }
        const text = await response.text();
        if (response.ok) {
          try {
            return hxReadChatAnswer(JSON.parse(text));
          } catch {
            last = `${response.status} ${response.headers.get("content-type") ?? ""}: not JSON: ${text.slice(0, 200)}`;
            break;
          }
        }
        last = `${response.status} ${text.slice(0, 300)}`;
        if (response.status !== 429 && response.status < 500) break;
        const after = Number(response.headers.get("retry-after"));
        await wait(Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : 3_000 * 2 ** attempt);
      }
      throw new Error(`${endpoint.name}: ${last}`);
    },
  };
}

/**
 * The free models of OpenCode that call tools over chat/completions, from the models.dev catalog
 * that OpenCode itself reads. Without an account OpenCode sends the key "public".
 */
export function hxOpenCodeFreeModels(catalog: unknown, key = "public"): HxChatEndpoint[] {
  const provider = isDynamicRecord(catalog) && isDynamicRecord(catalog.opencode) ? catalog.opencode : null;
  if (!provider || !isDynamicRecord(provider.models)) return [];
  const api = typeof provider.api === "string" ? provider.api.replace(/\/+$/, "") : "https://opencode.ai/zen/v1";
  const found: HxChatEndpoint[] = [];
  for (const [id, model] of Object.entries(provider.models)) {
    if (!isDynamicRecord(model) || model.tool_call !== true) continue;
    const cost = isDynamicRecord(model.cost) ? model.cost : {};
    if (cost.input !== 0 || (cost.output !== undefined && cost.output !== 0)) continue;
    // A model that OpenCode reaches through another protocol (responses, messages) is left out.
    const npm = isDynamicRecord(model.provider) ? model.provider.npm : undefined;
    if (npm !== undefined && npm !== "@ai-sdk/openai-compatible") continue;
    if (isDynamicRecord(model.status) || model.status === "deprecated") continue;
    found.push({ name: `OpenCode ${id}`, url: `${api}/chat/completions`, key, model: id });
  }
  return found;
}

/**
 * GitHub Models, with the token that a workflow job with `models: read` gets. With `organization`,
 * the organization's own address, which bills and limits the organization.
 */
export function hxGitHubModel(token: string, model = "openai/gpt-4.1-mini", organization?: string): HxChatEndpoint {
  return {
    name: `GitHub Models ${model}${organization ? ` (${organization})` : ""}`,
    url: organization
      ? `https://models.github.ai/orgs/${encodeURIComponent(organization)}/inference/chat/completions`
      : "https://models.github.ai/inference/chat/completions",
    key: token,
    model,
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  };
}

const PING_TOOL: HxChatTool = {
  name: "ping",
  description: "Answer the check. Call it once.",
  parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"] },
};

/**
 * The first endpoint that answers a short tool call, with what the others said. Each endpoint gets
 * one short try, so a busy free model costs little.
 */
export async function hxFirstWorkingModel(
  endpoints: readonly HxChatEndpoint[],
  options: { fetch?: Fetch; wait?: (ms: number) => Promise<void> } = {},
): Promise<{ model: HxChatModel | null; tried: Array<{ name: string; answer: string }> }> {
  const tried: Array<{ name: string; answer: string }> = [];
  for (const endpoint of endpoints) {
    const model = hxChatModel(endpoint, { ...options, wait: options.wait ?? (async () => undefined) });
    try {
      const turn = await model.turn(
        [{ role: "user", content: 'Call the tool ping with the word "ready".' }],
        [PING_TOOL],
      );
      const call = turn.calls[0];
      if (call?.name === PING_TOOL.name) {
        tried.push({ name: endpoint.name, answer: "ok" });
        return { model: hxChatModel(endpoint, options), tried };
      }
      tried.push({ name: endpoint.name, answer: `no tool call: ${turn.text.slice(0, 120)}` });
    } catch (error) {
      tried.push({
        name: endpoint.name,
        answer: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      });
    }
  }
  return { model: null, tried };
}
