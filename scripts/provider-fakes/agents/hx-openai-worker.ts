// The custom ACP agent of `hx-provider-limit-e2e.ts` (CONC-02): each turn sends its prompt to a local
// OpenAI-compatible service (`FAKE_OPENAI_URL`) and answers with what the service returns. A 429 from
// the service fails the turn with the service's words, as a CLI reports a throttle; this fake does not
// retry. Each turn start, throttle and end goes to `FAKE_LOG`.
import { type AcpParams, type AcpPeer, type AcpRequest, logEntry, serveFakeAcpAgent } from "../acp-agent";

const URL_BASE = process.env.FAKE_OPENAI_URL ?? "http://127.0.0.1:1/v1";
let sessions = 0;
let turns = 0;

function promptText(params: AcpParams): string {
  return (params.prompt ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

async function turn(request: AcpRequest, peer: AcpPeer): Promise<void> {
  const sessionId = request.params.sessionId;
  const text = promptText(request.params);
  turns += 1;
  const id = `${process.pid}-${turns}`;
  logEntry({ event: "turn-start", sessionId, turn: id, at: Date.now(), length: text.length });
  try {
    const response = await fetch(`${URL_BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer local-fake" },
      body: JSON.stringify({ model: "fake-model", messages: [{ role: "user", content: text.slice(-4_000) }] }),
    });
    if (response.status === 429) {
      const after = response.headers.get("retry-after");
      logEntry({ event: "turn-throttled", sessionId, turn: id, at: Date.now(), retryAfter: after });
      peer.fail(request, {
        code: -32603,
        message: `429 Too Many Requests: Rate limit reached for requests.${after ? ` Retry-After: ${after}` : ""}`,
      });
      return;
    }
    const body: { choices?: { message?: { content?: string } }[] } = await response.json();
    peer.say(sessionId, body.choices?.[0]?.message?.content ?? "好的。");
    logEntry({ event: "turn-end", sessionId, turn: id, at: Date.now() });
    peer.reply(request, { stopReason: "end_turn" });
  } catch (error) {
    logEntry({ event: "turn-failed", sessionId, turn: id, at: Date.now(), error: String(error) });
    peer.fail(request, { code: -32603, message: `The local service did not answer: ${String(error)}` });
  }
}

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "hx-openai-worker", title: "HX OpenAI worker", version: "1.0.0" },
      agentCapabilities: { loadSession: true },
    }),
  "session/new": (request, peer) => {
    sessions += 1;
    peer.reply(request, { sessionId: `s-${process.pid}-${sessions}` });
  },
  "session/load": (request, peer) => peer.reply(request, {}),
  "session/prompt": (request, peer) => void turn(request, peer),
});
