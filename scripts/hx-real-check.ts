// HXBot 真实模型与真机检查（v1.6.7）的入口。只在 GitHub 的用完即毁的机器上运行：它会真的打开应用、
// 输入文字并保存，也会把对话发给免费模型或 GitHub Models。
//
//   node hx-real-check.mjs --out out --machine macos-15 --parts steps,install,apps,quiet,team [--driver <cua-driver 的路径>]
//       out/report.json  每一项的结果
//       out/summary.md   这台机器的成绩单
//       out/log.txt      模型每一轮调用了什么、得到了什么回答
//     有失败的项时退出码是 1。
//   node hx-real-check.mjs --merge all --expected ubuntu-latest,macos-15,windows-2025
//       把 all/ 下每个子文件夹的 report.json 合成 all/overview.md 和 all/verdict.json。
//   node hx-real-check.mjs --self-test --out out
//       用按剧本回答的模型把协作部分跑一遍（不连网），检查程序自己有没有问题。
//
// 模型：给了 --opencode <opencode 可执行文件> 时，先经 OpenCode 自己的客户端（opencode acp）试它的免费
// 模型（名单来自 models.dev；这些模型只接受 OpenCode 客户端的请求），再试 GitHub Models（GITHUB_TOKEN，
// 工作流里要有 `models: read`）。--mcp-bridge <地址> <组> 是 OpenCode 为每段对话启动的工具桥。
// 打成一个文件：bash hx/scripts/real-check-public.sh <输出文件夹> <分支>
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hxAcpBrain, hxMcpBridge } from "../src/backend/hx-check/acp-brain";
import { hxAppRealCheck } from "../src/backend/hx-check/app-run";
import { type HxBrain, hxChatBrain } from "../src/backend/hx-check/brain";
import {
  type HxChatEndpoint,
  hxFirstWorkingModel,
  hxGitHubModel,
  hxOpenCodeFreeModels,
} from "../src/backend/hx-check/chat-model";
import { hxInstallRealCheck } from "../src/backend/hx-check/install-run";
import { hxQuietRealCheck } from "../src/backend/hx-check/quiet-run";
import {
  HxRealItems,
  type HxRealReport,
  hxReadRealReport,
  hxRealCounts,
  hxRealOverview,
  hxRealSummary,
} from "../src/backend/hx-check/report";
import { hxScriptedModel } from "../src/backend/hx-check/scripted-model";
import { hxStepsRealCheck } from "../src/backend/hx-check/steps-run";
import { hxTeamRealCheck } from "../src/backend/hx-check/team-run";

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/** OpenCode's free models that call tools, from the models.dev catalog that OpenCode itself reads. */
async function freeModels(): Promise<string[]> {
  try {
    const response = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(30_000) });
    return response.ok ? hxOpenCodeFreeModels(await response.json()).map((endpoint) => endpoint.model) : [];
  } catch {
    return [];
  }
}

/**
 * Chat models reached directly: a model of the user's own (HX_CHECK_MODEL_URL, HX_CHECK_MODEL_KEY
 * and HX_CHECK_MODEL, repository secrets in the workflow), then GitHub Models with the workflow's token.
 */
function endpoints(): HxChatEndpoint[] {
  const found: HxChatEndpoint[] = [];
  const own = {
    url: process.env.HX_CHECK_MODEL_URL,
    key: process.env.HX_CHECK_MODEL_KEY,
    model: process.env.HX_CHECK_MODEL,
  };
  if (own.url && own.key && own.model) {
    const base = own.url.replace(/\/+$/, "");
    found.push({
      name: `${own.model} (key of the check)`,
      url: base.endsWith("/chat/completions") ? base : `${base}/chat/completions`,
      key: own.key,
      model: own.model,
    });
  }
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  if (token) {
    found.push(hxGitHubModel(token, "openai/gpt-4.1-mini"));
    if (owner) found.push(hxGitHubModel(token, "openai/gpt-4.1-mini", owner));
  }
  return found;
}

const PING = {
  name: "ping",
  description: "Answer the check. Call it once with the word ready.",
  parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"] },
};

/**
 * The first brain that calls a tool: OpenCode's own client with each free model, then the chat
 * models reached directly.
 */
async function firstBrain(
  opencode: string | undefined,
  log: (line: string) => void,
): Promise<{ brain: HxBrain | null; tried: Array<{ name: string; answer: string }> }> {
  const tried: Array<{ name: string; answer: string }> = [];
  const own = endpoints().filter((endpoint) => endpoint.name.endsWith("(key of the check)"));
  if (own.length) {
    const found = await hxFirstWorkingModel(own);
    tried.push(...found.tried);
    if (found.model) return { brain: hxChatBrain(found.model), tried };
  }
  if (opencode) {
    const script = process.argv[1] ?? "";
    for (const model of (await freeModels()).slice(0, 4)) {
      const name = `OpenCode opencode/${model}`;
      try {
        const brain = await hxAcpBrain({
          executable: opencode,
          model: `opencode/${model}`,
          bridge: { command: process.execPath, args: [script, "--mcp-bridge"] },
          log,
        });
        const seen = { pinged: false };
        const turn = await brain.turn({
          session: "ping",
          system: "This is a check of the tools.",
          user: 'Call the tool ping (one of the hxbot tools) with the word "ready". Do nothing else.',
          tools: [PING],
          handle: async () => {
            seen.pinged = true;
            return JSON.stringify({ status: "ok" });
          },
          maxTurns: 3,
        });
        if (seen.pinged) {
          tried.push({ name, answer: "ok" });
          return { brain, tried };
        }
        tried.push({ name, answer: `no tool call: ${turn.error ?? turn.text}`.slice(0, 300) });
        await brain.close();
      } catch (error) {
        tried.push({ name, answer: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
      }
    }
  }
  const found = await hxFirstWorkingModel(
    endpoints().filter((endpoint) => !endpoint.name.endsWith("(key of the check)")),
  );
  tried.push(...found.tried);
  return { brain: found.model ? hxChatBrain(found.model) : null, tried };
}

async function merge(folder: string, expected: string[]): Promise<0 | 1> {
  const reports: HxRealReport[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const text = await readFile(join(folder, entry.name, "report.json"), "utf8").catch(() => "");
    const report = text ? hxReadRealReport(JSON.parse(text)) : null;
    if (report) reports.push(report);
  }
  const overview = hxRealOverview(reports, expected);
  await writeFile(join(folder, "overview.md"), overview.text, "utf8");
  await writeFile(join(folder, "verdict.json"), JSON.stringify({ ok: overview.ok, machines: reports.length }), "utf8");
  return overview.ok ? 0 : 1;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const bridge = args.indexOf("--mcp-bridge");
  if (bridge >= 0) {
    await hxMcpBridge(args[bridge + 1] ?? "", args[bridge + 2] ?? "");
    return 0;
  }
  const mergeFolder = option(args, "--merge");
  if (mergeFolder) {
    const expected = (option(args, "--expected") ?? "").split(",").filter(Boolean);
    return merge(resolve(mergeFolder), expected);
  }
  const out = resolve(option(args, "--out") ?? "out");
  const selfTest = args.includes("--self-test");
  const machine = option(args, "--machine") ?? (selfTest ? "self-test" : process.platform);
  const parts = new Set((option(args, "--parts") ?? (selfTest ? "team" : "steps,team")).split(","));
  await mkdir(out, { recursive: true });
  const started = Date.now();
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(`[${new Date().toISOString()}] ${line}`);
  };
  // Each item goes to the output at once: a part that hangs shows where it stopped (GitHub, 2026-11-14).
  const items = new HxRealItems((item) => {
    process.stdout.write(`${item.status}\t${item.id}\t${item.title}\t${item.detail.slice(0, 300)}\n`);
  });
  const part = async (name: string, id: string, minutes: number, work: () => Promise<void>) => {
    process.stdout.write(`== ${name}\n`);
    log(`== ${name}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((done) => {
      timer = setTimeout(() => done("late"), minutes * 60_000);
    });
    const ended = await Promise.race([work().then(() => "done" as const), late]);
    clearTimeout(timer);
    if (ended === "late") items.add(id, `${name}没有在 ${minutes} 分钟内跑完`, "fail", "最后做到哪一步见 log.txt");
  };
  let brain: HxBrain | null = null;
  let tried: Array<{ name: string; answer: string }> = [];
  if (selfTest) brain = hxChatBrain(hxScriptedModel());
  else {
    const found = await firstBrain(option(args, "--opencode"), log);
    brain = found.brain;
    tried = found.tried;
  }
  // No model is a skip, not a failure: free models refuse GitHub's machines. A model the check was
  // given (repository secrets) that does not answer is a failure.
  const given = Boolean(process.env.HX_CHECK_MODEL_KEY) || Boolean(option(args, "--opencode"));
  items.add(
    "M1",
    "有可用的真实模型",
    brain ? "pass" : given ? "fail" : "skip",
    brain?.name ??
      `没有配模型（仓库 Secret HX_CHECK_MODEL_URL、HX_CHECK_MODEL_KEY、HX_CHECK_MODEL）；${tried.map((item) => `${item.name}：${item.answer}`).join("；")}`,
  );

  if (parts.has("steps")) {
    const driver = option(args, "--driver");
    if (driver)
      await part("逐步操作", "S99", 20, () =>
        hxStepsRealCheck({ brain, items, log, driver: resolve(driver), platform: process.platform, folder: out }),
      );
    else items.add("S1", "电脑操控驱动", "skip", "没有给 --driver");
  }
  // v1.6.8: computer_install on a real Mac (F6).
  if (parts.has("install"))
    await part("安装应用", "I99", 8, () => hxInstallRealCheck({ items, log, platform: process.platform }));
  // v1.6.9: app commands and scripts in HXBot itself (computer_app, computer_run).
  if (parts.has("apps"))
    await part("应用命令", "A98", 10, () => hxAppRealCheck({ items, log, platform: process.platform }));
  // v1.7.0: HXBot does not disturb other apps.
  if (parts.has("quiet"))
    await part("不打扰其他应用", "Q99", 8, () => hxQuietRealCheck({ items, log, platform: process.platform }));
  if (parts.has("team")) {
    if (brain) await part("协作全流程", "T99", 20, () => hxTeamRealCheck({ brain, items, log }));
    else items.add("T1", "协作全流程", "skip", "没有可用的模型");
  }

  const report: HxRealReport = {
    machine,
    model: brain?.name ?? "",
    startedAt: new Date(started).toISOString(),
    seconds: (Date.now() - started) / 1000,
    items: items.items,
    models: tried,
  };
  await brain?.close();
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2), "utf8");
  await writeFile(join(out, "summary.md"), hxRealSummary(report), "utf8");
  await writeFile(join(out, "log.txt"), lines.join("\n\n"), "utf8");
  process.stdout.write(`${hxRealSummary(report)}\n`);
  return hxRealCounts(report.items).fail > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exit(2);
  },
);
