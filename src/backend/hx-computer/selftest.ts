// HXBot 电脑操控：自检。在这台电脑上实际跑一遍：读应用目录、检索、打开一个设置页，
// 逐项读取可以直接修改的设置并把同一个值写回去再读一次。不改变任何设置的值。
// macOS 上还把内置的设置页地址和这台 Mac 实际有的设置面板逐个对一遍，对不上的列出来。
// 结果存成一个文件（下载文件夹里），用户可以发回来；这也是每个版本在真机上的验收依据。
// 自检也是这台电脑的“核对”：某一项设置读、原样写回、再读都对，才记为“在这台电脑上核对过”；
// 一个系统在真机上验证过之前（verified.ts），助手只直接修改核对过的设置。
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { arch, release, type } from "node:os";
import { join } from "node:path";
import type { HxSelfTestItem, HxSelfTestOutcome, HxSelfTestReport } from "@hxbot/contracts/hx-computer";
import type { HxComputerActions } from "./actions";
import { hxMacBundleId } from "./apps";
import type { HxCatalog } from "./catalog";
import { HX_WINDOWS_COMMAND_TIMEOUT_MS, type HxRunner, hxRunOk } from "./runner";
import type { HxSettingSeed } from "./tables";
import { hxPowerShell } from "./tables-win";

export interface HxSelfTestHost {
  catalog: HxCatalog;
  actions: HxComputerActions;
  run: HxRunner;
  home: string;
  dataFolder(): string | null;
  now(): number;
  /** Where macOS keeps the panes of System Settings; tests pass a folder of their own. */
  macExtensions?: string;
}

const MAC_EXTENSIONS = "/System/Library/ExtensionKit/Extensions";
const NOT_ALLOWED = /-1743|not authori[sz]ed to send apple events/iu;
/** A pane with this prefix is part of the System Settings app itself, not an extension that can be listed. */
export const HX_MAC_OWN_PANES = "com.apple.systempreferences.";
/** The saved report keeps this much of a detail; Settings shows less. */
const DETAIL_LIMIT = 8000;

function stamp(time: number): string {
  return new Date(time)
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d+Z$/u, "Z");
}

async function systemText(host: HxSelfTestHost): Promise<string> {
  const base = `${type()} ${release()} ${arch()}`;
  if (host.catalog.platform === "mac") {
    const result = await host.run("/usr/bin/sw_vers", ["-productVersion"], { timeoutMs: 5000 });
    return hxRunOk(result) ? `macOS ${result.stdout.trim()} (${base})` : base;
  }
  if (host.catalog.platform === "windows") {
    const command = hxPowerShell("[string][Environment]::OSVersion.Version");
    const result = await host.run(command.command, command.args, { timeoutMs: 10_000 });
    return hxRunOk(result) ? `Windows ${result.stdout.trim()} (${base})` : base;
  }
  return base;
}

/** The identifiers of the settings panes this Mac has. It rejects when the folder cannot be read. */
export async function hxMacPanes(run: HxRunner, folder: string = MAC_EXTENSIONS): Promise<Set<string>> {
  const names = (await readdir(folder)).filter((name) => name.endsWith(".appex")).sort();
  const here = new Set<string>();
  for (const name of names) {
    const id = await hxMacBundleId(run, join(folder, name));
    if (id) here.add(id);
  }
  return here;
}

export async function hxSelfTest(host: HxSelfTestHost): Promise<HxSelfTestReport> {
  const startedAt = host.now();
  const items: HxSelfTestItem[] = [];
  const check = async (id: string, body: () => Promise<{ outcome: HxSelfTestOutcome; detail: string }>) => {
    const began = host.now();
    let result: { outcome: HxSelfTestOutcome; detail: string };
    try {
      result = await body();
    } catch (error) {
      result = { outcome: "failed", detail: error instanceof Error ? error.message : "The check stopped." };
    }
    items.push({
      id,
      outcome: result.outcome,
      detail: result.detail.slice(0, DETAIL_LIMIT),
      ms: Math.max(0, host.now() - began),
    });
  };
  const platform = host.catalog.platform;
  const system = await systemText(host);

  if (platform === null) {
    items.push({ id: "platform", outcome: "skipped", detail: "The catalog works on macOS and Windows.", ms: 0 });
  } else {
    await check("catalog.apps", async () => {
      await host.catalog.rebuild();
      const status = await host.catalog.status();
      return status.apps > 0
        ? { outcome: "passed", detail: `${status.apps} apps, ${status.pages} pages, ${status.settings} settings` }
        : { outcome: "failed", detail: "No app was found on this computer." };
    });
    await check("catalog.known-app", async () => {
      const name = platform === "mac" ? "Finder" : "Notepad";
      const found = await host.actions.find({ query: name, kinds: ["app"], limit: 3 });
      return found.status === "found"
        ? { outcome: "passed", detail: found.results.map((result) => result.title).join(", ") }
        : { outcome: "failed", detail: `${name} was not found among the apps.` };
    });
    await check("search.page", async () => {
      const found = await host.actions.find({ query: "蓝牙", kinds: ["page"], limit: 3 });
      return found.status === "found" && found.results[0]?.id === "page:bluetooth"
        ? { outcome: "passed", detail: found.results[0].title }
        : { outcome: "failed", detail: "Searching 蓝牙 did not give the Bluetooth page first." };
    });
    await check("open.page", async () => {
      const opened = await host.actions.open({ id: "page:about" });
      return opened.status === "opened"
        ? { outcome: "passed", detail: "The About page of the system settings was opened." }
        : { outcome: "failed", detail: "reason" in opened ? opened.reason : opened.status };
    });
    for (const seed of host.catalog.settingSeeds()) await checkSetting(host, seed, check);
    if (platform === "mac") {
      await check("mac.settings-pages", async () => {
        const here = await hxMacPanes(host.run, host.macExtensions ?? MAC_EXTENSIONS);
        const wanted = host.catalog.pageSeeds().map((seed) => seed.address.slice(seed.address.indexOf(":") + 1));
        const own = wanted.filter((id) => id.startsWith(HX_MAC_OWN_PANES));
        const missing = wanted.filter((id) => !id.startsWith(HX_MAC_OWN_PANES) && !here.has(id));
        const found = wanted.length - own.length - missing.length;
        const detail = [
          `${found} of ${wanted.length} page addresses are settings panes of this Mac`,
          `not checked, part of System Settings itself: ${own.join(" ") || "none"}`,
          ...(missing.length > 0 ? [`not among the panes of this Mac: ${missing.join(" ")}`] : []),
          `panes of this Mac: ${[...here].sort().join(" ") || "none could be read"}`,
        ].join("; ");
        // A pane that is not an extension here can still open (Passwords on macOS 15, Screen Saver on
        // 26): this says which pages to look at on this Mac, and is not a failure of its own.
        return { outcome: missing.length === 0 ? "passed" : "skipped", detail };
      });
    }
  }

  const finishedAt = host.now();
  const report: HxSelfTestReport = {
    platform,
    system,
    startedAt,
    finishedAt,
    items,
    passed: items.filter((item) => item.outcome === "passed").length,
    failed: items.filter((item) => item.outcome === "failed").length,
    skipped: items.filter((item) => item.outcome === "skipped").length,
    file: "",
  };
  report.file = await save(host, report);
  return report;
}

async function checkSetting(
  host: HxSelfTestHost,
  seed: HxSettingSeed,
  check: (id: string, body: () => Promise<{ outcome: HxSelfTestOutcome; detail: string }>) => Promise<void>,
): Promise<void> {
  // As long as the app gives the command when it changes the setting: on Windows a start of PowerShell
  // can take more than 20 seconds by itself.
  const timeoutMs = host.catalog.platform === "windows" ? HX_WINDOWS_COMMAND_TIMEOUT_MS : 20_000;
  const run = (command: { command: string; args: readonly string[]; env?: Readonly<Record<string, string>> }) =>
    host.run(command.command, command.args, { timeoutMs, ...(command.env ? { env: command.env } : {}) });
  // The check runs later, inside `check`; a field keeps what it read.
  const read: { value: string | null } = { value: null };
  await check(`setting.${seed.key}.read`, async () => {
    const result = await run(seed.read);
    if (NOT_ALLOWED.test(result.stderr)) {
      return { outcome: "skipped", detail: "macOS has not allowed HXBot to control System Events yet." };
    }
    if (!hxRunOk(result)) {
      return {
        outcome: "failed",
        detail: `code ${result.code ?? "none"}: ${result.stderr.trim() || result.stdout.trim()}`,
      };
    }
    read.value = seed.parse(result.stdout);
    return read.value === null
      ? { outcome: "skipped", detail: `No value right now: ${result.stdout.trim().slice(0, 200)}` }
      : { outcome: "passed", detail: read.value };
  });
  const before = read.value;
  if (before === null) return;
  await check(`setting.${seed.key}.write-same`, async () => {
    const written = await run(seed.write(before));
    if (NOT_ALLOWED.test(written.stderr)) {
      return { outcome: "skipped", detail: "macOS has not allowed HXBot to control System Events yet." };
    }
    if (!hxRunOk(written)) {
      await host.catalog.disable(`setting:${seed.key}`);
      return {
        outcome: "failed",
        detail: `code ${written.code ?? "none"}: ${written.stderr.trim() || written.stdout.trim()}`,
      };
    }
    const again = await run(seed.read);
    const after = hxRunOk(again) ? seed.parse(again.stdout) : null;
    const same = after !== null && (after === before || Math.abs(Number(after) - Number(before)) <= 1);
    // What this computer showed decides how an agent changes the setting from now on: directly when
    // the commands worked here, through its settings page when they did not.
    if (same) await host.catalog.markChecked(`setting:${seed.key}`);
    else await host.catalog.disable(`setting:${seed.key}`);
    return same
      ? { outcome: "passed", detail: `${before} written, ${after} read back` }
      : { outcome: "failed", detail: `${before} written, ${after ?? "nothing"} read back` };
  });
}

/** Saves the report where the user finds it; when that folder cannot be written, next to the catalog. */
async function save(host: HxSelfTestHost, report: HxSelfTestReport): Promise<string> {
  const name = `HXBot-self-test-${stamp(report.startedAt)}.json`;
  const data = host.dataFolder();
  const folders = [join(host.home, "Downloads"), ...(data ? [join(data, "hx-computer")] : [])];
  for (const folder of folders) {
    const file = join(folder, name);
    try {
      await mkdir(folder, { recursive: true });
      await writeFile(file, `${JSON.stringify({ ...report, file }, null, 1)}\n`, { mode: 0o600 });
      return file;
    } catch {
      // Try the next folder.
    }
  }
  return "";
}
