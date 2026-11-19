// HXBot v1.7.4（CU-07 发布关口）：六个内置技能各 10 条样例任务，读回核对，写成绩单。
// 任务与核对在 src/backend/hx-skills/samples.ts。文件类的五个技能在这台电脑上真的读写文件；
// 系统设置技能用这台电脑的系统设置（macOS、Windows），或者用替身电脑（--world=mac|windows，Linux 上也能跑）。
//
//   bun scripts/hx-skill-samples-e2e.ts [--label=<名字>] [--world=mac|windows] [--settings-changes] [--only=sheet-01,pdf-03]
//       --settings-changes  允许改系统设置再改回去：只在 GitHub 用完即毁的机器上、或替身上用。
//       没有它时，会改设置的两条（settings-03、settings-04）记“跳过”。
//   打成一个文件（Mac、Windows 上只用 Node 或 Bun 运行）：bash hx/scripts/skill-samples-bundle.sh
//
// 写到 .hxbot-build/hx-skill-samples/<label>/（或 --out 给的文件夹）：
//   report.json    每条任务：结果、技能自己的读回、从磁盘读回的核对、用时
//   summary.md     样例任务与读回结果（中文表）
//   manifest.json  交给 hx/computer-check/skills_crosscheck.py 用别人的库再读一遍
//   work/          每条任务的文件（夹具和结果），留着给 skills_crosscheck.py 读
// 一致的比例低于 90% 时退出码是 1。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { HxComputerPlatform } from "@hxbot/contracts/hx-computer";
import { HxComputerActions } from "../src/backend/hx-computer/actions";
import { HxCatalog } from "../src/backend/hx-computer/catalog";
import { hxMacWorld, hxWindowsWorld } from "../src/backend/hx-computer/realcheck-worlds";
import { type HxRunner, hxRun } from "../src/backend/hx-computer/runner";
import { HX_COMPUTER_VERIFIED } from "../src/backend/hx-computer/verified";
import { hxRunSkillSamples, hxSamplesMarkdown } from "../src/backend/hx-skills/samples";

const { values } = parseArgs({
  options: {
    label: { type: "string" },
    out: { type: "string" },
    machine: { type: "string" },
    world: { type: "string" },
    "settings-changes": { type: "boolean" },
    only: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  process.stdout.write(
    "bun scripts/hx-skill-samples-e2e.ts [--label=<name>] [--out=<folder>] [--world=mac|windows] [--settings-changes] [--only=<ids>]\n",
  );
  process.exit(0);
}
const OUT = values.out
  ? resolve(values.out)
  : join(process.cwd(), ".hxbot-build", "hx-skill-samples", values.label ?? "run");
const world = values.world === "mac" || values.world === "windows" ? values.world : null;
const real: HxComputerPlatform | null =
  process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : null;
const platform = world ?? real ?? "linux";
const machine = values.machine ?? (world ? `替身-${world}` : `${process.platform}-${process.arch}`);

await rm(join(OUT, "work"), { recursive: true, force: true });
await mkdir(join(OUT, "work"), { recursive: true });
// Not "hx-skill-…": the tests of the app route look for folders of that name left behind.
const data = await mkdtemp(join(tmpdir(), "hxbot-samples-data-"));
const temporary: string[] = [data];

async function settingsHost() {
  const settingsPlatform = world ?? real;
  if (!settingsPlatform) return null;
  let run: HxRunner = hxRun;
  let wait: ((ms: number) => Promise<void>) | undefined;
  let home = homedir();
  let now = () => Date.now();
  if (world) {
    const base = await mkdtemp(join(tmpdir(), "hxbot-samples-world-"));
    temporary.push(base);
    const fake =
      world === "mac"
        ? await hxMacWorld(join(base, "home"), join(base, "extensions"))
        : await hxWindowsWorld(join(base, "home"));
    run = fake.run;
    wait = fake.wait;
    home = fake.home;
    now = fake.now;
  }
  const catalog = new HxCatalog({
    platform: settingsPlatform,
    verified: HX_COMPUTER_VERIFIED[settingsPlatform],
    run,
    home,
    dataFolder: () => join(data, "catalog"),
    chineseFirst: true,
    now,
  });
  return new HxComputerActions(catalog, run, wait);
}

const report = await hxRunSkillSamples({
  platform,
  machine,
  work: join(OUT, "work"),
  data,
  settings: await settingsHost(),
  settingsChanges: world !== null || values["settings-changes"] === true,
  ...(values.only ? { only: values.only.split(",").map((id) => id.trim()) } : {}),
  log: (line) => process.stdout.write(`${line}\n`),
});
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(OUT, "manifest.json"), `${JSON.stringify(report.manifest, null, 2)}\n`);
await writeFile(join(OUT, "summary.md"), hxSamplesMarkdown(report));
for (const folder of temporary) await rm(folder, { recursive: true, force: true });
const rate = report.rates.all?.rate ?? 0;
process.stdout.write(
  `\n一致 ${report.rates.all?.consistent ?? 0} / ${report.rates.all?.counted ?? 0}（${(rate * 100).toFixed(1)}%）。成绩单：${join(OUT, "summary.md")}\n`,
);
process.exit(rate >= 0.9 ? 0 : 1);
