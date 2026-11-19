// HXBot v1.7.4 (CU-07, ART-05, BAK-03): the app skills end to end, in the built app (`bun run build`)
// on a profile of its own. A custom ACP agent with no model (`provider-fakes/agents/hx-team-worker.ts`,
// "HX-SKILL <base64 JSON>") calls computer_skill the way a model does; the script reads what the app
// wrote: the files, the cards in the chat (read-only from the profile's database), the question card,
// and the versions; it presses “恢复到修改前” and answers the question through the same IPC as the
// screen. It uses no model and no network.
//
// Items of sheet A8: CU-07-A2 (a version of the .xlsx, the diff lists the cells), ART-05-A1 (one
// paragraph of a .docx, three cells of a .xlsx, one slide of a .pptx), BAK-03-A1 (restore: the hash
// is back), BAK-03-A2 (the space is full: the change stops and asks, deletes no old version; each of
// the three answers does what it says).
//
// `bun scripts/hx-skills-e2e.ts --run-as=hxstress [--label=<name>]`
// Writes .hxbot-build/hx-skills-e2e/<label>/report.json.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  HX_FILE_CHANGE_ITEM_TYPE,
  HX_FILE_RESTORED_ITEM_TYPE,
  hxFileChangeVersionId,
  hxParseFileChangeText,
} from "@hxbot/contracts/hx-file-change";
import { z } from "zod";
import { docxFixture, pptxFixture, xlsxFixture } from "../src/backend/hx-files/office-fixtures";
import { HxApp, messageRecords, profileFolders, ROOT, wait, wipeProfile, writeJson } from "./hx-flow-e2e-lib";
import { readScriptArguments } from "./script-arguments";

const parsed = readScriptArguments({
  usage: "bun scripts/hx-skills-e2e.ts [--run-as=<user>] [--label=<name>]",
  options: { "run-as": { type: "string" }, label: { type: "string" } },
});
if (!parsed) process.exit(0);
const RUN_AS = parsed.values["run-as"] ?? null;
const OUT = join(ROOT, ".hxbot-build", "hx-skills-e2e", parsed.values.label ?? "run");
mkdirSync(OUT, { recursive: true });

interface Check {
  item: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
const check = (item: string, pass: boolean, detail: string) => {
  checks.push({ item, pass, detail });
  process.stdout.write(`${pass ? "通过" : "不通过"} ${item}：${detail}\n`);
};

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const owned = (path: string) => {
  if (RUN_AS) execFileSync("chown", ["-R", `${RUN_AS}:${RUN_AS}`, path]);
};

const AgentList = z.array(
  z.object({ id: z.string(), name: z.string(), workspacePath: z.string(), threadId: z.string().nullable() }).loose(),
);
const WorkerLine = z.object({ event: z.string(), text: z.string().optional(), at: z.number().optional() }).loose();
const SkillAnswer = z
  .object({ ok: z.boolean().optional(), code: z.string().optional(), error: z.string().optional() })
  .loose();
const QuestionMessage = z
  .object({
    id: z.string(),
    questionPrompt: z.object({
      requestId: z.union([z.string(), z.number()]),
      questions: z.array(
        z.object({ id: z.string(), options: z.array(z.object({ label: z.string() })).nullable() }).loose(),
      ),
      resolution: z.unknown().nullable(),
    }),
  })
  .loose();
const RestoreAnswer = z.object({ status: z.string(), reason: z.string().optional() });
const VersionsView = z.object({ capBytes: z.number(), usedBytes: z.number(), versions: z.number() }).loose();

const app = new HxApp({ out: OUT, runAs: RUN_AS, worker: { HX_STRESS_QUICK_GREETING: "1" } });
const dataFolder = profileFolders(RUN_AS)[1] ?? "";
const versionsRoot = join(dataFolder, "file-versions");

function skillAnswers(): string[] {
  if (!existsSync(app.workerLog)) return [];
  return readFileSync(app.workerLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const parsedLine = WorkerLine.safeParse(JSON.parse(line));
      return parsedLine.success && parsedLine.data.event === "skill-answer" ? [parsedLine.data.text ?? ""] : [];
    });
}

async function until<T>(read: () => T | null | undefined | false, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = read();
    if (value) return value;
    await wait(500);
  }
  return read() || null;
}

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };
interface SkillCall {
  skill: string;
  action: string;
  files: string[];
  params: { readonly [key: string]: Json };
  requestId: string;
}

/** Sends one computer_skill call to an agent and waits for its answer. */
async function skill(agentId: string, args: SkillCall, before = skillAnswers().length) {
  await app.send(agentId, `HX-SKILL ${Buffer.from(JSON.stringify(args)).toString("base64")}`);
  const text = await until(() => skillAnswers()[before], 120_000);
  return text === null ? null : SkillAnswer.parse(JSON.parse(text));
}

/** The cards of file changes, newest first, with their text read back. */
function cards() {
  return messageRecords(RUN_AS, "hx-file-change:").flatMap((message) => {
    const card = hxParseFileChangeText(message.text);
    return card ? [{ id: message.id, itemType: message.itemType, card }] : [];
  });
}

/** Version records per task folder. */
function versionFiles(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  if (!existsSync(versionsRoot)) return found;
  for (const folder of readdirSync(versionsRoot, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    found.set(
      folder.name,
      readdirSync(join(versionsRoot, folder.name)).filter((name) => /^v[0-9a-z]+\.json$/u.test(name)),
    );
  }
  return found;
}
const versionCount = () => [...versionFiles().values()].reduce((sum, names) => sum + names.length, 0);

/** The open question card of the version space, if one waits. */
function openQuestion() {
  for (const message of messageRecords(RUN_AS, "question-prompt:")) {
    const question = QuestionMessage.safeParse(message);
    if (!question.success) continue;
    const prompt = question.data.questionPrompt;
    if (prompt.resolution === null && prompt.questions[0]?.id === "hx-version-space") return prompt;
  }
  return null;
}

async function main(): Promise<void> {
  wipeProfile(RUN_AS);
  await app.start("skills");
  const a = await app.make("表格助手");
  const b = await app.make("另一个助手");
  await until(
    () => skillAnswers().length === 0 && app.lines().filter((line) => line.event === "turn-end").length >= 2,
    60_000,
  );
  const agents = AgentList.parse(JSON.parse(await app.call("agent.listAgents")));
  const agentA = agents.find((agent) => agent.id === a);
  const agentB = agents.find((agent) => agent.id === b);
  if (!agentA || !agentB) throw new Error("The agents were not listed.");

  // Fixtures in the agents' workspaces, owned by the user that runs the app.
  const folderA = join(agentA.workspacePath, "e2e");
  const folderB = join(agentB.workspacePath, "e2e");
  mkdirSync(folderA, { recursive: true });
  mkdirSync(folderB, { recursive: true });
  const xlsx = join(folderA, "季度报告.xlsx");
  const docx = join(folderA, "方案.docx");
  const pptx = join(folderA, "汇报.pptx");
  const other = join(folderB, "别的表.xlsx");
  writeFileSync(
    xlsx,
    xlsxFixture([
      {
        name: "Sheet1",
        rows: [
          ["项目", "一季度", "备注"],
          ["收入", 100, "旧备注"],
          ["成本", 60, ""],
        ],
      },
    ]),
  );
  writeFileSync(
    docx,
    docxFixture([{ runs: ["第一段：背景。"] }, { runs: ["第二段：旧的方案。"] }, { runs: ["第三段：结论。"] }]),
  );
  writeFileSync(pptx, pptxFixture([{ title: "封面" }, { title: "季度回顾", body: "收入增长" }, { title: "下一步" }]));
  // Larger than a version of the other files: removing it makes room for one of them.
  writeFileSync(
    other,
    xlsxFixture([{ name: "S", rows: Array.from({ length: 3000 }, (_, row) => [`行 ${row + 1}`, row, `备注 ${row}`]) }]),
  );
  owned(folderA);
  owned(folderB);
  const before = { xlsx: sha(xlsx), docx: sha(docx), pptx: sha(pptx) };

  // CU-07-A2 / ART-05-A1: three cells of the .xlsx.
  const wrote = await skill(a, {
    skill: "sheet",
    action: "write",
    files: ["e2e/季度报告.xlsx"],
    params: { cells: { B2: 120, C2: "新备注", B3: 65 } },
    requestId: "e2e-xlsx-1",
  });
  const sheetCard = cards()[0];
  const cellLines = sheetCard?.card.lines ?? [];
  const sheetVersion = sheetCard ? hxFileChangeVersionId(sheetCard.id) : null;
  check(
    "CU-07-A2",
    wrote?.ok === true &&
      sheetVersion !== null &&
      versionCount() === 1 &&
      cellLines.includes("Sheet1!B2: 100 → 120") &&
      cellLines.includes("Sheet1!C2: 旧备注 → 新备注") &&
      cellLines.includes("Sheet1!B3: 60 → 65"),
    `改了 3 个单元格：${wrote?.ok === true ? "成功" : `失败 ${wrote?.code ?? ""} ${wrote?.error ?? ""}`}；留存版本 ${sheetVersion ?? "没有"}（共 ${versionCount()} 个）；卡片差异：${cellLines.join("；")}`,
  );

  // ART-05-A1: one paragraph of the .docx, one slide of the .pptx.
  const paragraph = await skill(a, {
    skill: "document",
    action: "set-paragraph",
    files: ["e2e/方案.docx"],
    params: { index: 1, text: "第二段：新的方案。" },
    requestId: "e2e-docx-1",
  });
  const docCard = cards()[0];
  const slide = await skill(a, {
    skill: "slides",
    action: "text",
    files: ["e2e/汇报.pptx"],
    params: { slide: 2, target: "title", text: "年度回顾" },
    requestId: "e2e-pptx-1",
  });
  const slideCard = cards()[0];
  const docLines = docCard?.card.lines ?? [];
  const slideLines = slideCard?.card.lines ?? [];
  check(
    "ART-05-A1",
    paragraph?.ok === true &&
      slide?.ok === true &&
      cellLines.length === 3 &&
      docLines.length >= 1 &&
      docLines[0] === "~ #2: 第二段：旧的方案。 → 第二段：新的方案。" &&
      slideLines.some((line) => line.startsWith("~ #2:")) &&
      slideLines.some((line) => line.includes("年度回顾")),
    `.xlsx ${cellLines.length} 个单元格；.docx：${docLines.join("；") || "没有卡片"}；.pptx：${slideLines.join("；") || "没有卡片"}`,
  );

  // BAK-03-A1: “恢复到修改前” on the card of the .xlsx: the hash is back; a second press changes nothing.
  const restoreInput = { agentId: a, threadId: null, messageId: sheetCard?.id ?? "" };
  const restored = RestoreAnswer.parse(JSON.parse(await app.call("auth.hxRestoreFileChange", restoreInput)));
  const hashBack = sha(xlsx) === before.xlsx;
  const markedRestored = cards().find((item) => item.id === sheetCard?.id)?.itemType === HX_FILE_RESTORED_ITEM_TYPE;
  const again = RestoreAnswer.parse(JSON.parse(await app.call("auth.hxRestoreFileChange", restoreInput)));
  const elsewhere = RestoreAnswer.parse(
    JSON.parse(await app.call("auth.hxRestoreFileChange", { ...restoreInput, agentId: b })),
  );
  check(
    "BAK-03-A1",
    restored.status === "restored" &&
      hashBack &&
      markedRestored &&
      again.status === "unchanged" &&
      elsewhere.status === "missing",
    `恢复：${restored.status}；哈希回到修改前：${hashBack ? "是" : "否"}；卡片标为已恢复：${markedRestored ? "是" : "否"}；再点一次：${again.status}；别的助手的对话里点：${elsewhere.status}`,
  );

  // BAK-03-A2: the space is full. Another task keeps a version first, so "remove the oldest" has one
  // to remove; then the space is set to what the versions take now.
  const otherChange = await skill(b, {
    skill: "sheet",
    action: "write",
    files: ["e2e/别的表.xlsx"],
    params: { cells: { B1: 2 } },
    requestId: "e2e-other-1",
  });
  // A change of the restored file: its content now is new, so a version of it needs space (a version
  // whose bytes are kept already needs none).
  const fresh = await skill(a, {
    skill: "sheet",
    action: "write",
    files: ["e2e/季度报告.xlsx"],
    params: { cells: { D2: "新内容" } },
    requestId: "e2e-fresh-1",
  });
  const tasksBefore = versionFiles();
  const used = VersionsView.parse(JSON.parse(await app.call("auth.hxFileVersionsView"))).usedBytes;
  writeFileSync(join(versionsRoot, "settings.json"), JSON.stringify({ version: 1, capBytes: used }));
  owned(join(versionsRoot, "settings.json"));
  const rounds: string[] = [];
  let allPass = otherChange?.ok === true && fresh?.ok === true && existsSync(join(versionsRoot, "settings.json"));
  const ask = async (cell: number, answerIndex: number) => {
    const count = skillAnswers().length;
    const versionsBefore = versionCount();
    const hashBefore = sha(xlsx);
    await app.send(
      a,
      `HX-SKILL ${Buffer.from(
        JSON.stringify({
          skill: "sheet",
          action: "write",
          files: ["e2e/季度报告.xlsx"],
          params: { cells: { D2: cell } },
          requestId: `e2e-full-${cell}`,
        }),
      ).toString("base64")}`,
    );
    const question = await until(openQuestion, 60_000);
    // While the card waits: nothing changed, no version was deleted.
    const waitingSame = sha(xlsx) === hashBefore && versionCount() === versionsBefore;
    const label = question?.questions[0]?.options?.[answerIndex]?.label ?? "";
    if (question)
      await app.call("agent.respondToPrompt", {
        requestId: question.requestId,
        answers: { "hx-version-space": [label] },
      });
    const text = await until(() => skillAnswers()[count], 60_000);
    const answer = text ? SkillAnswer.parse(JSON.parse(text)) : null;
    return { question: question !== null, waitingSame, label, answer, hashBefore, versionsBefore };
  };
  // 1. Cancel: the file stays, every version stays.
  const cancel = await ask(1, 2);
  const cancelPass =
    cancel.question && cancel.waitingSame && cancel.answer?.code === "cancelled" && sha(xlsx) === cancel.hashBefore;
  allPass &&= cancelPass;
  rounds.push(
    `取消：${cancel.question ? "问了" : "没问"}，等回答时文件和版本都没动：${cancel.waitingSame ? "是" : "否"}，回答“${cancel.label}”→ ${cancel.answer?.code ?? (cancel.answer?.ok ? "改了" : "没有回答")}，文件没变：${sha(xlsx) === cancel.hashBefore ? "是" : "否"}`,
  );
  // 2. No version: the file changes, no version is kept, the card says it cannot be restored.
  const none = await ask(2, 1);
  const noneCard = cards()[0];
  const nonePass =
    none.question &&
    none.waitingSame &&
    none.answer?.ok === true &&
    sha(xlsx) !== none.hashBefore &&
    versionCount() === none.versionsBefore &&
    noneCard !== undefined &&
    hxFileChangeVersionId(noneCard.id) === null &&
    noneCard.itemType === HX_FILE_CHANGE_ITEM_TYPE;
  allPass &&= nonePass;
  rounds.push(
    `不留版本：回答“${none.label}”→ ${none.answer?.ok ? "改了" : (none.answer?.code ?? "没有回答")}，版本数 ${none.versionsBefore}→${versionCount()}，卡片 ${noneCard?.id ?? "没有"}`,
  );
  // 3. Remove the oldest: the other task's versions go, never this task's; then the change keeps one.
  const clean = await ask(3, 0);
  const tasksAfter = versionFiles();
  const ownTask = [...tasksBefore.entries()].find(([, names]) => names.includes(`${sheetVersion ?? ""}.json`))?.[0];
  const otherTasks = [...tasksBefore.keys()].filter(
    (task) => !task.startsWith(".") && (tasksAfter.get(task)?.length ?? 0) === 0,
  );
  const ownKept =
    ownTask !== undefined && (tasksAfter.get(ownTask)?.length ?? 0) >= (tasksBefore.get(ownTask)?.length ?? 0);
  const cleanCard = cards()[0];
  const cleanPass =
    clean.question &&
    clean.waitingSame &&
    clean.answer?.ok === true &&
    otherTasks.length === 1 &&
    ownKept &&
    cleanCard !== undefined &&
    hxFileChangeVersionId(cleanCard.id) !== null;
  allPass &&= cleanPass;
  rounds.push(
    `删掉最早的旧版本：回答“${clean.label}”→ ${clean.answer?.ok ? "改了" : (clean.answer?.code ?? "没有回答")}，删掉别的任务的版本 ${otherTasks.length} 个任务，这次的任务的版本都还在：${ownKept ? "是" : "否"}，这次留了版本：${cleanCard && hxFileChangeVersionId(cleanCard.id) ? "是" : "否"}`,
  );
  check("BAK-03-A2", allPass, rounds.join("；"));

  writeJson(join(OUT, "report.json"), {
    at: new Date().toISOString(),
    checks,
    cards: cards().slice(0, 10),
    versions: Object.fromEntries(versionFiles()),
  });
}

try {
  await main();
} finally {
  await app.stop();
  writeFileSync(join(OUT, "checks.json"), `${JSON.stringify(checks, null, 2)}\n`);
}
process.exit(checks.length > 0 && checks.every((item) => item.pass) ? 0 : 1);
