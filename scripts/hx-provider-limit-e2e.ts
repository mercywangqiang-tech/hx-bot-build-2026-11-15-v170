// HXBot v1.7.4 (CONC-02-A1, CONC-02-A3): the provider limit against a local fake OpenAI-compatible
// service, in the built app (`bun run build`), with no paid quota: the agents are custom ACP agents
// (`provider-fakes/agents/hx-openai-worker.ts`) that send each prompt to the fake service of this
// script. All of them use one provider + account + model, so they share one limit L.
//
// 1. Warm-up: rounds of a person's message to each agent; L grows (slow start).
// 2. A burst of 429 with no Retry-After: L halves once, and the model pauses 20 to 40 s.
// 3. In the pause, four people write: one of them starts at once as a probe; the probe's answer ends
//    the pause, and the others start after it.
// 4. Recovery: more rounds; L comes back step by step.
//
// `bun scripts/hx-provider-limit-e2e.ts --run-as=hxstress [--label=after]`
// Writes .hxbot-build/hx-provider-limit-e2e/<label>/report.json, the app log and the worker log.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { HxApp, ROOT, wait, wipeProfile, writeJson } from "./hx-flow-e2e-lib";
import { readScriptArguments } from "./script-arguments";

const parsed = readScriptArguments({
  usage: "bun scripts/hx-provider-limit-e2e.ts [--run-as=<user>] [--label=<name>] [--agents=<n>]",
  options: { "run-as": { type: "string" }, label: { type: "string" }, agents: { type: "string" } },
});
if (!parsed) process.exit(0);
const RUN_AS = parsed.values["run-as"] ?? null;
const LABEL = parsed.values.label ?? "after";
const AGENTS = Number(parsed.values.agents ?? 8);
const OUT = join(ROOT, ".hxbot-build", "hx-provider-limit-e2e", LABEL);
const DELAY_MS = 1_500;

// ---------------------------------------------------------------- the fake service
interface Request {
  at: number;
  status: number;
  inFlight: number;
}
const requests: Request[] = [];
let inFlight = 0;
let throttleUntil = 0;
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions"))
      return new Response("not found", { status: 404 });
    await request.text();
    const at = Date.now();
    if (at < throttleUntil) {
      requests.push({ at, status: 429, inFlight });
      return new Response(JSON.stringify({ error: { type: "rate_limit_error", message: "Rate limit reached" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    inFlight += 1;
    requests.push({ at, status: 200, inFlight });
    await wait(DELAY_MS);
    inFlight -= 1;
    return Response.json({ choices: [{ message: { role: "assistant", content: "好的，做完了。" } }] });
  },
});
const SERVICE = `http://127.0.0.1:${server.port}/v1`;

// ---------------------------------------------------------------- the app log
const Detail = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
interface GateLine {
  at: number;
  message: string;
  detail: z.infer<typeof Detail>;
}
function gateLines(app: HxApp): GateLine[] {
  return app.logLines(/\[hx-flow\] A provider /u).flatMap((line) => {
    const match = /^(\S+) INFO \[hx-flow\] (A provider [^{]+?) (\{.*\})$/u.exec(line);
    if (!match?.[1] || !match[2] || !match[3]) return [];
    const detail = Detail.safeParse(JSON.parse(match[3]));
    return detail.success ? [{ at: Date.parse(match[1]), message: match[2], detail: detail.data }] : [];
  });
}

const WorkerEvent = z.object({ event: z.string(), at: z.number().optional(), turn: z.string().optional() }).loose();
function events(app: HxApp, name: string): z.infer<typeof WorkerEvent>[] {
  return app.lines().flatMap((line) => {
    const parsed = WorkerEvent.safeParse(line);
    return parsed.success && parsed.data.event === name ? [parsed.data] : [];
  });
}

async function until(what: string, check: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await wait(250);
  }
}

// ---------------------------------------------------------------- the run
interface Check {
  item: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
wipeProfile(RUN_AS);
// A large computer (fake memory, as the HX-Flow acceptance runs use): the turn budget B rises to 16, so
// the provider limit, not B, decides how many turns wait for the model at once.
const memoryFile = join(OUT, "memory.json");
mkdirSync(OUT, { recursive: true });
writeFileSync(
  memoryFile,
  JSON.stringify({ totalBytes: 64 * 1024 ** 3, availableBytes: 60 * 1024 ** 3, agentBytes: 200 * 1024 ** 2 }),
);
const app = new HxApp({
  out: OUT,
  runAs: RUN_AS,
  workerScript: "scripts/provider-fakes/agents/hx-openai-worker.ts",
  worker: { FAKE_OPENAI_URL: SERVICE },
  env: { HXBOT_HX_FLOW_SAMPLE_FILE: memoryFile },
});
try {
  chmodSync(memoryFile, 0o644);
  await app.start(LABEL);
  const agents: string[] = [];
  for (let index = 0; index < AGENTS; index += 1) agents.push(await app.make(`限速测试 ${index + 1}`));
  // The first message of each agent ("你好，准备开始。") runs first.
  await until("the first turns", () => events(app, "turn-end").length >= AGENTS, 180_000);

  const ends = () => events(app, "turn-end").length + events(app, "turn-throttled").length;
  const round = async (label: string, to: readonly string[]) => {
    const before = ends();
    for (const agentId of to) await app.send(agentId, `${label}：请回复一句。`);
    await until(`round ${label}`, () => ends() >= before + to.length, 180_000);
  };
  for (let index = 1; index <= 3; index += 1) await round(`热身 ${index}`, agents);
  const warmed = gateLines(app).filter((line) => line.message.startsWith("A provider limit changed"));
  const before = Number(warmed.at(-1)?.detail.to ?? 2);

  // A burst of 429 with no Retry-After.
  throttleUntil = Date.now() + 4_000;
  const burstAt = Date.now();
  for (const agentId of agents) await app.send(agentId, "限速：请回复一句。");
  await until(
    "the throttle line",
    () => gateLines(app).some((line) => line.message.startsWith("A provider throttled")),
    60_000,
  );
  const throttle = gateLines(app).find((line) => line.message.startsWith("A provider throttled"));
  const halvedFrom = Number(throttle?.detail.from ?? 0);
  const halvedTo = Number(throttle?.detail.to ?? 0);
  const pauseMs = Number(throttle?.detail.pauseMs ?? 0);
  const throttled = gateLines(app).filter((line) => line.message.startsWith("A provider throttled")).length;
  await wait(Math.max(0, throttleUntil - Date.now()) + 1_000);
  checks.push({
    item: "CONC-02-A1 (halves and pauses)",
    pass:
      halvedTo === Math.max(1, Math.floor(halvedFrom / 2)) && pauseMs >= 20_000 && pauseMs <= 40_000 && throttled === 1,
    detail: `L ${halvedFrom} → ${halvedTo}, pause ${pauseMs} ms, ${throttled} halving for a burst of ${requests.filter((item) => item.status === 429).length} 429s (L before the burst ${before})`,
  });

  // In the pause, four people write: one probe at once, the others after its answer.
  const pauseStarted = throttle?.at ?? burstAt;
  const waitingAt = Date.now();
  const startsBefore = events(app, "turn-start").length;
  for (const agentId of agents.slice(0, 4)) await app.send(agentId, "暂停期间：请回复一句。");
  await until(
    "the probe's answer",
    () => gateLines(app).some((line) => line.message.startsWith("A provider answered the probe")),
    30_000,
  );
  const probeEnd = gateLines(app).find((line) => line.message.startsWith("A provider answered the probe"))?.at ?? 0;
  const startedInPause = events(app, "turn-start").filter(
    (item) => (item.at ?? 0) >= waitingAt && (item.at ?? 0) < probeEnd,
  ).length;
  await until("the others after the probe", () => events(app, "turn-start").length >= startsBefore + 4, 60_000);
  checks.push({
    item: "CONC-02-A1 (a person starts in the pause)",
    pass: startedInPause === 1 && probeEnd > pauseStarted && probeEnd < pauseStarted + pauseMs,
    detail: `${startedInPause} turn started in the pause (the probe); its answer ended the pause ${Math.round((probeEnd - pauseStarted) / 1000)} s after it began`,
  });
  await until("the four answers", () => ends() >= startsBefore + 4 + AGENTS, 120_000).catch(() => undefined);

  // Recovery: L comes back step by step.
  for (let index = 1; index <= 4; index += 1) await round(`恢复 ${index}`, agents);
  const after = gateLines(app)
    .filter((line) => line.message.startsWith("A provider limit changed") && line.at > (throttle?.at ?? 0))
    .map((line) => Number(line.detail.to));
  const steps = after.map((value, index) => value - (after[index - 1] ?? halvedTo));
  checks.push({
    item: "CONC-02-A1 (L comes back step by step)",
    pass: after.length > 0 && (after.at(-1) ?? 0) > halvedTo && steps.every((step) => step <= 1),
    detail: `L after the pause: ${[halvedTo, ...after].join(" → ")}`,
  });

  // The service of this script saw every model request; no key of a paid service was given.
  const maxInFlight = Math.max(...requests.map((item) => item.inFlight));
  const budget = Math.max(2, ...app.budgets().map((line) => line.budget));
  const maxL = Math.max(2, ...gateLines(app).map((line) => Number(line.detail.to ?? 0)));
  checks.push({
    item: "CONC-02 (the limit holds the model: at most L + 1 at once)",
    pass: maxInFlight <= maxL + 1,
    detail: `the most at once at the service: ${maxInFlight}; the largest L: ${maxL}; the computer's budget B: ${budget}`,
  });
  checks.push({
    item: "CONC-02-A3 (no paid quota)",
    pass: requests.length >= events(app, "turn-start").length - AGENTS && !process.env.HX_JUDGE_API_KEY,
    detail: `${requests.length} requests to ${SERVICE} (the most at once: ${maxInFlight}); the agents are custom ACP agents with no model`,
  });
} catch (error) {
  checks.push({ item: "run", pass: false, detail: String(error) });
} finally {
  await app.stop().catch(() => undefined);
  server.stop(true);
}
const report = {
  label: LABEL,
  at: new Date().toISOString(),
  agents: AGENTS,
  service: SERVICE,
  pass: checks.length > 0 && checks.every((check) => check.pass),
  checks,
  gate: gateLines(app),
  requests: requests.length,
};
writeJson(join(OUT, "report.json"), report);
process.stdout.write(`${JSON.stringify({ pass: report.pass, checks }, null, 2)}\n`);
if (!report.pass) process.exitCode = 1;
