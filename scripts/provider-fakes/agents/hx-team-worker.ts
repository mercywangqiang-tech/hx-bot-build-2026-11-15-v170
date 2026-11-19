// The custom ACP agent of `hx-flow-stress-e2e.ts` (BUG-CONC-01): it does the work of a team member
// with no model. It reads the prompt and acts as HXBot's own agents do, through the HXBot tools that
// the session's MCP servers give:
// - "HX-STRESS-TEAM <goal>|<lead id>,<member id>,…": the starter calls start_team with one role for
//   each agent, and the lead first;
// - the brief of a team room (【协作任务】): the lead reads the board and the room, and gives one
//   handoff form to each member with channel_assign;
// - a later turn of the lead: team_done when every piece of work is back;
// - a handoff form (目标：): the member streams text for a while, holding `HX_STRESS_RSS_MB` of memory
//   as a model CLI does, then answers with channel_result;
// - "HX-SKILL <base64 JSON>" (v1.7.4, hx-skills-e2e.ts): one computer_skill call with those arguments;
// - anything else (a person's message, a routine): it streams text for `HX_STRESS_CHAT_MS`.
// Each turn start and end goes to `FAKE_LOG`, so the script counts the turns that run at once.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { type AcpParams, type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const McpServer = z.object({
  name: z.string(),
  url: z.string().optional(),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
});
type McpServer = z.infer<typeof McpServer>;

/** A value in the arguments this worker passes to a tool (JSON). */
type ToolValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly ToolValue[]
  | { readonly [key: string]: ToolValue };
/** The arguments this worker passes to a tool. */
type ToolArgs = { readonly [key: string]: ToolValue };
/** v1.7.4: the JSON arguments of a computer_skill call that a message carries. */
const ToolValueSchema: z.ZodType<ToolValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(ToolValueSchema),
    z.record(z.string(), ToolValueSchema),
  ]),
);

const Member = z.object({ agentId: z.string(), lead: z.boolean(), role: z.string() });
// The part of team_board "read" that the worker uses.
const Board = z.object({
  board: z
    .object({
      state: z.string().optional(),
      goal: z.string().optional(),
      folder: z.string().nullable().optional(),
      members: z.array(Member).optional(),
      work: z.array(z.object({ state: z.string() })).optional(),
    })
    .optional(),
});
// The part of channel_history that the worker uses: the id of the last message.
const History = z.object({ messages: z.array(z.object({ id: z.string() })).optional() });
// The queue line that a channel_assign answer of a team room carries.
const Queued = z.object({ queue: z.string() });

const range = (value: string | undefined, fallback: [number, number]): [number, number] => {
  const [low, high] = (value ?? "").split("-").map(Number);
  return low && high ? [low, high] : low ? [low, low] : fallback;
};
const WORK_MS = range(process.env.HX_STRESS_WORK_MS, [20_000, 60_000]);
const CHAT_MS = range(process.env.HX_STRESS_CHAT_MS, [5_000, 15_000]);
const CHUNK_MS = Number(process.env.HX_STRESS_CHUNK_MS ?? 100);
const CHUNK = "数据处理中，汇总结果并写入共享文件夹。".repeat(Number(process.env.HX_STRESS_CHUNK_REPEAT ?? 2));
const RSS_MB = Number(process.env.HX_STRESS_RSS_MB ?? 0);
const FORM = (goal: string, open = "无") =>
  [
    `目标：${goal}`,
    "已完成：无",
    "文件：无",
    `未解决：${open}`,
    "下一步：做完用 channel_result 交回",
    "不要碰：无",
  ].join("\n");
/** The loop scenario: the members pass the work on until this hand. */
const LOOP_HOPS = 6;
/** The spend scenario: the cost of one member turn, in US dollars. */
const COST_USD = Number(process.env.HX_STRESS_COST_USD ?? 0);
const costs = new Map<string, number>();
/** By session: the turns that ended with a usage report (ACP usage is the session's total). */
const reported = new Map<string, number>();
/** The sessions whose turn that runs now reported a cost. */
const charged = new Set<string>();

const sessions = new Map<string, { servers: McpServer[]; lead: boolean; client: Client | null }>();
let count = 0;
/**
 * The lead gets the brief of a team room in a session of its own, and the results of the room come
 * back in that session. HXBot can stop an idle agent process and load the session again with the same
 * id, so the mark is a file per session.
 */
const LEAD_DIR = process.env.HX_STRESS_STATE ?? "/tmp/hx-stress-leads";
const leadFile = (sessionId: string) => `${LEAD_DIR}/${Buffer.from(sessionId).toString("base64url")}`;
const cancelled = new Set<string>();

function between([low, high]: [number, number]): number {
  return low + Math.floor(Math.random() * Math.max(1, high - low));
}

function promptText(params: AcpParams): string {
  return (params.prompt ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

/**
 * The SDK transport classes declare their handlers and `sessionId` as `T | undefined`, which
 * `exactOptionalPropertyTypes` does not accept as a `Transport`. This one forwards to such a class
 * (the same as scripts/mcp-catalog-smoke.ts).
 */
function asTransport(inner: {
  start(): Promise<void>;
  send: Transport["send"];
  close(): Promise<void>;
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: Transport["onmessage"] | undefined;
  setProtocolVersion?: ((version: string) => void) | undefined;
}): Transport {
  const transport: Transport = {
    start: () => {
      inner.onclose = () => transport.onclose?.();
      inner.onerror = (error) => transport.onerror?.(error);
      inner.onmessage = (message, extra) => transport.onmessage?.(message, extra);
      return inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion?.(version),
  };
  return transport;
}

async function client(sessionId: string): Promise<Client> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("unknown session");
  if (session.client) return session.client;
  const server = session.servers.find((item) => item.url);
  if (!server?.url) throw new Error("no MCP server");
  const headers = Object.fromEntries((server.headers ?? []).map((header) => [header.name, header.value]));
  const mcp = new Client({ name: "hx-team-worker", version: "1.0.0" });
  await mcp.connect(asTransport(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } })));
  const tools = await mcp.listTools();
  logEntry({ event: "tools", sessionId, names: tools.tools.map((tool) => tool.name) });
  session.client = mcp;
  return mcp;
}

/** Calls an HXBot tool by its own name, or through the catalog tool when the session lists only that. */
async function tool(sessionId: string, name: string, args: ToolArgs): Promise<string> {
  const mcp = await client(sessionId);
  const tools = (await mcp.listTools()).tools.map((item) => item.name);
  const direct = tools.find((item) => item === name || item.endsWith(`.${name}`) || item.endsWith(`__${name}`));
  const result = direct
    ? await mcp.callTool({ name: direct, arguments: args })
    : await mcp.callTool({
        name: tools.find((item) => item.endsWith("tool_call")) ?? "tool_call",
        arguments: { name: `hxbot.${name}`, arguments: args },
      });
  const text = (Array.isArray(result.content) ? result.content : [])
    .map((item) => (typeof item === "object" && item && "text" in item ? String(item.text) : ""))
    .join("");
  const queue = answerOf(Queued, text)?.queue;
  logEntry({
    event: "tool",
    sessionId,
    name,
    ok: result.isError !== true,
    text: text.slice(0, 300),
    queue,
    at: Date.now(),
  });
  return text;
}

/** The answer text of a tool read as `schema`, or null when it is not JSON of that shape. */
function answerOf<T>(schema: z.ZodType<T>, text: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Calls a tool and reads its answer as `schema` (null when it is not of that shape). */
async function read<T>(schema: z.ZodType<T>, sessionId: string, name: string, args: ToolArgs): Promise<T | null> {
  return answerOf(schema, await tool(sessionId, name, args));
}

async function stream(peer: AcpPeer, sessionId: string, ms: number): Promise<boolean> {
  const hold = RSS_MB > 0 ? Buffer.alloc(RSS_MB * 1024 * 1024, 1) : null;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cancelled.has(sessionId)) return false;
    peer.say(sessionId, CHUNK);
    await new Promise((resolve) => setTimeout(resolve, CHUNK_MS));
  }
  if (hold) hold[0] = 0;
  return true;
}

async function turn(request: AcpRequest, peer: AcpPeer): Promise<void> {
  const sessionId = request.params.sessionId ?? "";
  const session = sessions.get(sessionId);
  const text = promptText(request.params);
  const id = ++count;
  cancelled.delete(sessionId);
  const lead = session?.lead === true || existsSync(leadFile(sessionId));
  const goal = isAssignment(text) ? lastGoal(text) : undefined;
  const kind = session && !session.servers.some((server) => server.url) ? "private" : kindOf(text, lead);
  // The length and the last line of the prompt: enough to tell what the turn was asked, no more.
  const last = text.trim().split("\n").at(-1)?.slice(0, 60) ?? "";
  logEntry({ event: "turn-start", sessionId, turn: id, kind, goal, length: text.length, last, at: Date.now() });
  try {
    const team = /HX-STRESS-TEAM (.+)\|([\w,-]+)/u.exec(text);
    // "HX-FANOUT <n>[+<m>] <members>": n assignments now; with +m, m more in the lead's next turn of the
    // same channel task (when the first results come back), so that one root task gets n + m.
    const fanout = /HX-FANOUT (\d+)(?:\+(\d+))? ([\w,-]+)/u.exec(text);
    const more = existsSync(leadFile(`fanout-more-${sessionId}`));
    // The last one: a new session's prompt can carry the earlier messages of the chat too.
    const skillCall = [...text.matchAll(/HX-SKILL ([A-Za-z0-9+/=]+)/gu)].at(-1);
    // A session with no MCP server is HXBot's private prompt (such as the question of the automatic
    // model choice, what kind of work a message is): an answer in words, no tools.
    if (session && !session.servers.some((server) => server.url)) {
      peer.say(sessionId, "写作");
    } else if (process.env.HX_STRESS_QUICK_GREETING === "1" && text.trim().endsWith("你好，准备开始。")) {
      // The first message of a new agent: HXBot puts its instructions before it (about 18 KB).
      peer.say(sessionId, "好的。");
    } else if (skillCall?.[1]) {
      // v1.7.4 (hx-skills-e2e.ts): "HX-SKILL <base64 JSON>" calls computer_skill with those arguments.
      const args = z
        .record(z.string(), ToolValueSchema)
        .parse(JSON.parse(Buffer.from(skillCall[1], "base64").toString("utf8")));
      const answer = await tool(sessionId, "computer_skill", args);
      logEntry({ event: "skill-answer", sessionId, text: answer.slice(0, 8000), at: Date.now() });
      peer.say(sessionId, "完成。");
    } else if ((fanout?.[1] && fanout[3] && !existsSync(leadFile(`fanout-${sessionId}`))) || more) {
      mkdirSync(LEAD_DIR, { recursive: true });
      // A channel that is not a team room: one assignment after another to the members named.
      let first = 0;
      let count = 0;
      let members: string[] = [];
      if (more) {
        // The second part, once: the lead's later turns in the channel can carry the request again.
        const plan = z
          .object({ from: z.number(), count: z.number(), members: z.array(z.string()) })
          .parse(JSON.parse(readFileSync(leadFile(`fanout-more-${sessionId}`), "utf8")));
        rmSync(leadFile(`fanout-more-${sessionId}`));
        ({ from: first, count, members } = plan);
      } else if (fanout?.[1] && fanout[3]) {
        writeFileSync(leadFile(`fanout-${sessionId}`), "fanout");
        count = Number(fanout[1]);
        members = fanout[3].split(",");
        if (fanout[2])
          writeFileSync(
            leadFile(`fanout-more-${sessionId}`),
            JSON.stringify({ from: count, count: Number(fanout[2]), members }),
          );
      }
      const history = await read(History, sessionId, "channel_history", {});
      const source = history?.messages?.at(-1)?.id;
      for (let index = first; index < first + count; index += 1)
        await tool(sessionId, "channel_assign", {
          recipientAgentId: members[index % members.length],
          task: FORM(`频道分派第${index + 1}件：写一段 300 字的小结`),
          expectedResult: "一段小结",
          sourceMessageIds: source ? [source] : [],
        });
      peer.say(sessionId, "已分派。");
    } else if (text.includes("HX-STATUS")) {
      await tool(sessionId, "team", { action: "status" });
      peer.say(sessionId, "状态已读。");
    } else if (text.includes("HX-STRESS-STOP")) {
      await tool(sessionId, "team", { action: "stop" });
      peer.say(sessionId, "团队已停。");
    } else if (team?.[1] && team[2]) {
      const named = /最多 (\d+) 个人/u.exec(team[1]);
      const noAsk = team[1].includes("不用问我");
      const limits = { ...(named?.[1] ? { members: Number(named[1]) } : {}), ...(noAsk ? { noAsk: true } : {}) };
      let ids = team[2].split(",");
      const startTeam = () =>
        tool(sessionId, "start_team", {
          goal: team[1],
          roles: ids.map((agentId, index) => ({
            name: index === 0 ? "带头" : `成员${index}`,
            kind: index === 0 ? "plan" : "do",
            does: index === 0 ? "分派并汇总" : `做第 ${index} 部分`,
            work: "writing",
            difficulty: (["low", "mid", "high"] as const)[index % 3],
            agentId,
          })),
          steps: [
            { title: "分派与汇总", role: "带头" },
            ...ids.slice(1).map((_, index) => ({ title: `第 ${index + 1} 部分`, role: `成员${index + 1}` })),
          ],
          ...(Object.keys(limits).length ? { limits } : {}),
        });
      const first = await startTeam();
      // As a model does: the reply names the most members the user allows; merge the roles and retry.
      const most = /at most (\d+) members/u.exec(first);
      if (most?.[1]) {
        ids = ids.slice(0, Number(most[1]));
        await startTeam();
      }
      peer.say(sessionId, "团队已开始。");
    } else if (lead) {
      // A later turn of the lead: results came back.
      await finishWhenAllBack(sessionId);
      peer.say(sessionId, "收到。");
    } else if (isAssignment(text)) {
      // A handoff quotes its source messages, and the lead cites the brief: the form decides first.
      const goal = lastGoal(text);
      const hop = /兜圈第(\d+)手 交给 (成员\d+)/u.exec(goal);
      if (hop?.[1] && hop[2] && Number(hop[1]) < LOOP_HOPS) {
        await passOn(sessionId, goal, Number(hop[1]), hop[2]);
        peer.say(sessionId, "已转交。");
      } else if (await stream(peer, sessionId, between(WORK_MS))) {
        spend(peer, sessionId);
        await tool(sessionId, "channel_result", { text: "小结已写好。" });
      }
    } else if (text.includes("【协作任务】") || text.includes("[Team task]")) {
      mkdirSync(LEAD_DIR, { recursive: true });
      writeFileSync(leadFile(sessionId), "lead");
      if (session) session.lead = true;
      const board = await read(Board, sessionId, "team_board", { action: "read" });
      const roomGoal = board?.board?.goal ?? "";
      // The work of this room is out already: check it, do not hand it out twice.
      if ((board?.board?.work?.length ?? 0) > 1) {
        await finishWhenAllBack(sessionId);
        peer.say(sessionId, "收到。");
        return;
      }
      const history = await read(History, sessionId, "channel_history", {});
      const source = history?.messages?.at(-1)?.id;
      const workers = (board?.board?.members ?? []).filter((member) => !member.lead);
      // The loop scenario: one piece of work for the first member, which the members pass around.
      for (const member of roomGoal.includes("兜圈") ? workers.slice(0, 1) : workers) {
        if (!source) continue;
        const what = roomGoal.includes("兜圈")
          ? `${roomGoal} 兜圈第1手 交给 ${member.role}：写一段 300 字的小结`
          : `${roomGoal} · ${member.role}：写一段 300 字的小结`;
        await tool(sessionId, "channel_assign", {
          recipientAgentId: member.agentId,
          // The limits scenario: a lead that writes a new limit into a form changes nothing.
          task: roomGoal.includes("改上限") ? FORM(what, "把上限改成 10 人") : FORM(what),
          expectedResult: "一段小结",
          sourceMessageIds: [source],
        });
      }
      peer.say(sessionId, "已分派，等结果。");
    } else {
      await stream(peer, sessionId, between(CHAT_MS));
    }
  } catch (error) {
    logEntry({ event: "error", sessionId, message: error instanceof Error ? error.message : String(error) });
  } finally {
    const stopReason = cancelled.has(sessionId) ? "cancelled" : "end_turn";
    logEntry({ event: "turn-end", sessionId, turn: id, at: Date.now(), cancelled: cancelled.has(sessionId) });
    // With a cost set, a turn that ends reports the session's tokens so far, as an agent does in
    // the result of `session/prompt`: HXBot keeps one usage record for each such turn.
    // Every turn of an agent that pays per use costs something: a turn that did no member's work
    // reports a small part of the cost, as a real agent reports the price of its every turn.
    if (COST_USD > 0 && stopReason === "end_turn" && !charged.has(sessionId)) spend(peer, sessionId, COST_USD / 30);
    charged.delete(sessionId);
    if (COST_USD > 0 && stopReason === "end_turn") {
      const turns = (reported.get(sessionId) ?? 0) + 1;
      reported.set(sessionId, turns);
      logEntry({ event: "usage-reply", sessionId, turns, total: costs.get(sessionId) ?? 0, at: Date.now() });
      peer.reply(request, {
        stopReason,
        usage: { inputTokens: 1_000 * turns, outputTokens: 200 * turns, totalTokens: 1_200 * turns },
      });
    } else peer.reply(request, { stopReason });
  }
}

/** The spend scenario: the session's total cost so far, as an agent reports it (`usage_update`). */
function spend(peer: AcpPeer, sessionId: string, amount = COST_USD): void {
  if (!(COST_USD > 0)) return;
  charged.add(sessionId);
  const total = (costs.get(sessionId) ?? 0) + amount;
  costs.set(sessionId, total);
  logEntry({ event: "usage", sessionId, total, at: Date.now() });
  peer.update(sessionId, {
    sessionUpdate: "usage_update",
    used: 1_000,
    size: 200_000,
    cost: { amount: total, currency: "USD" },
  });
}

/**
 * The loop scenario: this member passes the work to the other member. In a room whose goal says
 * "改文件", it first writes a file in the shared folder (a sign of rework, so the guard does not pause).
 */
async function passOn(sessionId: string, goal: string, hand: number, self: string): Promise<void> {
  const board = await read(Board, sessionId, "team_board", { action: "read" });
  const other = (board?.board?.members ?? []).find((member) => !member.lead && member.role !== self);
  if (!other) return;
  const folder = board?.board?.folder;
  if (goal.includes("改文件") && folder) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(`${folder}/第${hand}手.md`, `第 ${hand} 手由 ${self} 改过。\n`);
  }
  const history = await read(History, sessionId, "channel_history", {});
  const source = history?.messages?.at(-1)?.id;
  const next = goal.replace(/兜圈第\d+手 交给 成员\d+/u, `兜圈第${hand + 1}手 交给 ${other.role}`);
  await tool(sessionId, "channel_transfer", {
    recipientAgentId: other.agentId,
    task: FORM(next),
    expectedResult: "一段小结",
    sourceMessageIds: source ? [source] : [],
  });
}

/** The spend scenario: pieces of work with nothing in common, so they are no loop. */
const TOPICS = [
  "北方冬季供暖改造的成本与居民满意度调查",
  "沿海港口集装箱吞吐量的季节波动",
  "高校图书馆电子资源的借阅习惯变化",
  "城市共享单车调度算法与早高峰潮汐",
  "山区茶园采摘机械化的可行路线",
  "社区医院慢病随访的线上化试点",
  "老旧小区加装电梯的分摊办法",
  "跨境电商退货物流的时效瓶颈",
  "中学数学分层作业的效果评估",
  "农村电商直播带货的品控难点",
  "新能源公交夜间充电的电网负荷",
  "博物馆文创产品的定价与销量",
];

/** The lead sends the result when every piece of work of the room is back. */
async function finishWhenAllBack(sessionId: string): Promise<void> {
  const board = await read(Board, sessionId, "team_board", { action: "read" });
  const work = board?.board?.work ?? [];
  // The spend scenario: while the work is not all done, each result brings one more piece of other work.
  const goal = board?.board?.goal ?? "";
  const workers = (board?.board?.members ?? []).filter((member) => !member.lead);
  if (goal.includes("花钱") && work.length - 1 < TOPICS.length && workers.length) {
    const index = work.length - 1;
    const member = workers[index % workers.length];
    const history = await read(History, sessionId, "channel_history", {});
    const source = history?.messages?.at(-1)?.id;
    if (member && source)
      await tool(sessionId, "channel_assign", {
        recipientAgentId: member.agentId,
        task: FORM(`${TOPICS[index]}：写一段 300 字的小结`),
        expectedResult: "一段小结",
        sourceMessageIds: [source],
      });
    return;
  }
  const back = work.length > 1 && work.every((item, index) => index === 0 || item.state === "completed");
  if (back && board?.board?.state !== "done") await tool(sessionId, "team_done", { result: "全部小结已汇总。" });
}

/** The goal of the last handoff form in a prompt: a transfer can carry the earlier forms too. */
function lastGoal(text: string): string {
  return [...text.matchAll(/目标：([^\n]*)/gu)].at(-1)?.[1] ?? "";
}

/** A handoff from the lead: the form of this harness, "目标：…：写一段 300 字的小结". */
function isAssignment(text: string): boolean {
  return /目标：[^\n]*写一段 300 字的小结/u.test(text);
}

function kindOf(text: string, lead: boolean): "starter" | "lead" | "member" | "brief" | "chat" {
  if (text.includes("HX-STRESS-TEAM") || text.includes("HX-STRESS-STOP")) return "starter";
  if (lead) return "lead";
  if (isAssignment(text)) return "member";
  if (text.includes("【协作任务】") || text.includes("[Team task]")) return "brief";
  return "chat";
}

const newSession = (request: AcpRequest, peer: AcpPeer) => {
  const sessionId = request.params.sessionId ?? `s-${process.pid}-${sessions.size + 1}`;
  const listed = z.array(McpServer).safeParse(request.params.mcpServers ?? []);
  const servers = listed.success ? listed.data : [];
  // Which MCP servers the session got, by kind (a URL or a command), not their addresses or tokens.
  logEntry({
    event: "session",
    sessionId,
    method: request.method,
    servers: servers.map((server) => (server.url ? "http" : "other")),
  });
  sessions.set(sessionId, {
    servers,
    lead: false,
    client: null,
  });
  peer.reply(request, request.method === "session/new" ? { sessionId } : {});
};

serveFakeAcpAgent(
  {
    initialize: (request, peer) =>
      peer.reply(request, {
        protocolVersion: 1,
        agentInfo: { name: "hx-team-worker", title: "HX team worker", version: "1.0.0" },
        agentCapabilities: { loadSession: true },
      }),
    "session/new": newSession,
    "session/load": newSession,
    "session/prompt": (request, peer) => void turn(request, peer),
  },
  {
    onNotification: (method, params) => {
      if (method === "session/cancel" && params.sessionId) cancelled.add(params.sessionId);
    },
  },
);
