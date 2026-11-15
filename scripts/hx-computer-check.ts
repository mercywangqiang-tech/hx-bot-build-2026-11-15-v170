// HXBot 电脑操控：真系统检查的入口。在一台真的 Mac 或 Windows 上，用真的系统命令把
// src/backend/hx-computer/realcheck.ts 的全部检查跑一遍，把结果写进一个文件夹。
// 它会真的修改系统设置再改回去，所以只在 GitHub 的用完即毁的机器上运行，不要在自己的电脑上运行。
//
//   node hx-computer-check.mjs --out out --machine macos-15 [--no-screenshots] [--budget-minutes 35]
//       out/report.json    每一项的结果、看到了什么、用时
//       out/summary.md     这台机器的成绩单
//       out/pages.json     每个设置页打开后窗口里读到的文字（校准用）
//       out/selftest.json  HXBot 自带自检的报告
//       out/screenshots/   截图；失败和待看的项的截图另外复制一份到 out/attention/
//     有失败的项时退出码是 1。
//
//   node hx-computer-check.mjs --merge all --expected macos-15,windows-2025
//       把 all/ 下每个子文件夹里的 report.json 合成 all/overview.md 和 all/verdict.json。
//     有失败的项、或有机器没有交回结果时退出码是 1。
//
// 打成一个文件：bash hx/scripts/computer-check-bundle.sh
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { hxRealCheck } from "../src/backend/hx-computer/realcheck";
import {
  type HxCheckReport,
  hxCheckCounts,
  hxCheckOverview,
  hxCheckSummary,
  hxCheckVerdict,
  hxDecodeCheckReport,
} from "../src/backend/hx-computer/realcheck-report";
import { hxRun } from "../src/backend/hx-computer/runner";

/** How many pictures of failed and doubtful checks are copied to `attention/`. */
const ATTENTION_LIMIT = 60;

interface Options {
  out: string;
  machine: string;
  screenshots: boolean;
  /** After this many minutes no new check is started; 0 keeps the default of the check. */
  budgetMinutes: number;
  merge: string;
  expected: string[];
}

function options(argv: readonly string[]): Options {
  const read: Options = {
    out: "hxbot-check",
    machine: `${process.platform}-${process.arch}`,
    screenshots: true,
    budgetMinutes: 0,
    merge: "",
    expected: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1] ?? "";
    if (name === "--no-screenshots") read.screenshots = false;
    else if (name === "--out") read.out = value;
    else if (name === "--machine") read.machine = value;
    else if (name === "--budget-minutes") read.budgetMinutes = Math.max(0, Number(value) || 0);
    else if (name === "--merge") read.merge = value;
    else if (name === "--expected") {
      read.expected = value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    } else continue;
    if (name !== "--no-screenshots") index += 1;
  }
  return read;
}

async function json(file: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    parsed = null;
  }
  return parsed;
}

/** Every report in a folder of the folder, in the order of the names of the folders. */
async function reportsIn(folder: string): Promise<HxCheckReport[]> {
  const reports: HxCheckReport[] = [];
  for (const name of (await readdir(folder)).sort()) {
    const report = hxDecodeCheckReport(await json(join(folder, name, "report.json")));
    if (report) reports.push(report);
  }
  return reports;
}

async function merge(folder: string, expected: readonly string[]) {
  const reports = await reportsIn(folder);
  const machines = expected.length > 0 ? expected : reports.map((report) => report.machine);
  const overview = hxCheckOverview(reports, machines);
  const verdict = hxCheckVerdict(reports, machines);
  await writeFile(join(folder, "overview.md"), overview);
  await writeFile(join(folder, "verdict.json"), `${JSON.stringify(verdict, null, 1)}\n`);
  process.stdout.write(overview);
  return verdict.green ? 0 : 1;
}

async function check(read: Options) {
  const platform = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : null;
  if (platform === null) {
    process.stderr.write("这个检查只在 macOS 和 Windows 上运行；它会修改系统设置，只应在 GitHub 的机器上运行。\n");
    return 2;
  }
  const out = resolve(read.out);
  await mkdir(out, { recursive: true });
  const result = await hxRealCheck({
    platform,
    machine: read.machine,
    run: hxRun,
    home: homedir(),
    out,
    screenshots: read.screenshots,
    ...(read.budgetMinutes > 0 ? { budgetMs: read.budgetMinutes * 60_000 } : {}),
    now: () => Date.now(),
    wait: (ms) =>
      new Promise((done) => {
        setTimeout(done, ms);
      }),
    log: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });
  const summary = hxCheckSummary(result.report);
  await writeFile(join(out, "report.json"), `${JSON.stringify(result.report, null, 1)}\n`);
  await writeFile(join(out, "summary.md"), summary);
  await writeFile(join(out, "pages.json"), `${JSON.stringify(result.pages, null, 1)}\n`);
  await writeFile(join(out, "selftest.json"), `${JSON.stringify(result.selfTest, null, 1)}\n`);
  if (result.chineseNames.length > 0) {
    await writeFile(join(out, "chinese-names.json"), `${JSON.stringify(result.chineseNames, null, 1)}\n`);
  }
  // The pictures a person has to look at, in a folder of their own: they are few, the others are many.
  const doubtful = result.report.items.filter((item) => item.outcome === "failed" || item.outcome === "review");
  const pictures = doubtful.flatMap((item) => (item.shot ? [item.shot] : [])).slice(0, ATTENTION_LIMIT);
  if (pictures.length > 0) {
    await mkdir(join(out, "attention"), { recursive: true });
    for (const picture of pictures) {
      await copyFile(join(out, "screenshots", picture), join(out, "attention", picture)).catch(() => {});
    }
  }
  process.stdout.write(`\n${summary}`);
  return hxCheckCounts(result.report.items).failed > 0 ? 1 : 0;
}

const read = options(process.argv.slice(2));
const code = await (read.merge ? merge(resolve(read.merge), read.expected) : check(read)).catch((error) => {
  process.stderr.write(`检查程序自己出错了：${error instanceof Error ? (error.stack ?? error.message) : "原因不明"}\n`);
  return 3;
});
// What was printed has to be out before the program ends: on Windows the output is written in the background.
await new Promise<void>((done) => {
  process.stdout.write("", () => {
    done();
  });
});
// A command of the system that was stopped for taking too long can leave something behind that keeps
// Node waiting; the results are written, so the program ends here.
process.exit(code);
