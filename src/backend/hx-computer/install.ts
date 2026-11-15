// HXBot 电脑操控（三）：安装应用（v1.6.8，复盘 F6；用户 2026-11-14：“解决，V1.6.8修正”）。
//
// 助手要把下载好的应用放进“应用程序”文件夹时，以前在模型自己的命令行里复制、改名，被进程沙盒拒绝，
// 在 HXBot 里同意了也不行（沙盒在进程启动时就定了）。现在由 HXBot 主程序来装：
// - .app 直接装；.zip 用 ditto 解开；.dmg 只读挂上、装好后卸下；.pkg 交给系统的安装器（要密码时由用户来）；
// - 读出应用的名字、标识、版本、签名（开发者、团队号）和是否经过公证，写进答复；
// - 已经有同名应用时先回 confirm，用户在对话里同意后带 replace 再调用；旧版正在运行时请用户先退出；
// - 新版先复制到“应用程序”文件夹里的临时名字，旧版改成隐藏的名字，新版改成正式名字，旧版再放进废纸篓；
//   中途失败就把旧版改回来；读回版本核对；
// - 不去掉系统的隔离标记：第一次打开时由 macOS 照常检查；
// - macOS 拒绝改动已有的应用时（要“App 管理”授权），打开那一页并请用户打开 HXBot 的开关。
import { access, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type { HxRunner } from "./runner";
import { hxRunFailure, hxRunOk } from "./runner";

interface HxAppFacts {
  name: string;
  id: string;
  version: string;
  path: string;
}

interface HxSignature {
  /** "Developer ID Application: Name (TEAM)", or "ad-hoc", or "unsigned". */
  authority: string;
  team: string;
  /** macOS accepts it as notarized (spctl). */
  notarized: boolean;
}

export type HxInstallResult =
  | {
      status: "installed";
      app: HxAppFacts;
      signature: HxSignature;
      replaced: { version: string } | null;
    }
  | { status: "confirm"; reason: string; installed: HxAppFacts; incoming: HxAppFacts; signature: HxSignature }
  | { status: "running"; reason: string; installed: HxAppFacts }
  | { status: "needs-permission"; permission: "app-management"; reason: string }
  | { status: "installer"; reason: string }
  | { status: "not-found" | "invalid" | "unsupported" | "failed"; reason: string };

/** The file operations the install needs. Tests pass doubles. */
export interface HxInstallFiles {
  exists(path: string): Promise<boolean>;
  makeTemp(prefix: string): Promise<string>;
  /** The .app folders directly in `folder` and one level below it. */
  findApps(folder: string): Promise<string[]>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/** The file operations of computer_install, on this computer. */
export const HX_INSTALL_FILES: HxInstallFiles = {
  exists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  makeTemp: (prefix) => mkdtemp(join(tmpdir(), prefix)),
  async findApps(folder) {
    const found: string[] = [];
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const path = join(folder, entry.name);
      if (entry.name.endsWith(".app")) found.push(path);
      else
        for (const inner of await readdir(path, { withFileTypes: true }).catch(() => []))
          if (inner.isDirectory() && inner.name.endsWith(".app")) found.push(join(path, inner.name));
    }
    return found;
  },
  rename: (from, to) => rename(from, to),
  remove: (path) => rm(path, { recursive: true, force: true }),
};

export interface HxInstallDeps {
  run: HxRunner;
  files: HxInstallFiles;
  platform: NodeJS.Platform;
  applications?: string;
  /** Puts a file in the Trash (Electron's shell.trashItem). */
  trashItem(path: string): Promise<void>;
  /** Opens Privacy & Security → App Management, where HXBot turns on its own switch if it can. */
  askAppManagement?: () => Promise<void>;
  /** Waits before a new try (tests give one that does not wait). */
  wait?: (ms: number) => Promise<void>;
}

const LONG_MS = 300_000;
/** hdiutil attach tries: macOS answers "Resource temporarily unavailable" while it still checks or ejects an image. */
const ATTACH_TRIES = 4;
const ATTACH_WAIT_MS = 3_000;

function attachBusy(text: string): boolean {
  return /temporarily unavailable|resource busy/iu.test(text);
}

function plistValue(output: string): string {
  return output.trim().split("\n")[0]?.trim() ?? "";
}

async function facts(run: HxRunner, app: string): Promise<HxAppFacts | null> {
  const plist = join(app, "Contents", "Info.plist");
  const read = async (key: string) => {
    const result = await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist]);
    return hxRunOk(result) ? plistValue(result.stdout) : "";
  };
  const id = await read("CFBundleIdentifier");
  if (!id) return null;
  const version = (await read("CFBundleShortVersionString")) || (await read("CFBundleVersion"));
  return { name: basename(app, ".app"), id, version, path: app };
}

async function signature(run: HxRunner, app: string): Promise<HxSignature> {
  const sign = await run("/usr/bin/codesign", ["-dv", "--verbose=2", app], { timeoutMs: 60_000 });
  const text = `${sign.stdout}\n${sign.stderr}`;
  const authority = /^Authority=(.+)$/mu.exec(text)?.[1]?.trim();
  const team = /^TeamIdentifier=(.+)$/mu.exec(text)?.[1]?.trim() ?? "";
  const adhoc = /Signature=adhoc/u.test(text);
  const check = await run("/usr/sbin/spctl", ["-a", "-vv", "-t", "exec", app], { timeoutMs: 60_000 });
  const verdict = `${check.stdout}\n${check.stderr}`;
  return {
    authority: authority ?? (adhoc ? "ad-hoc" : hxRunOk(sign) ? "unknown" : "unsigned"),
    team: team === "not set" ? "" : team,
    notarized: hxRunOk(check) && /Notarized/u.test(verdict),
  };
}

/** The app inside what the user downloaded, with a way to let go of it afterwards. */
async function unpack(
  deps: HxInstallDeps,
  source: string,
): Promise<{ app: string; done: () => Promise<void> } | Exclude<HxInstallResult, { status: "installed" }>> {
  const kind = extname(source).toLowerCase();
  const { run, files } = deps;
  if (kind === ".app") return { app: source.replace(/\/+$/u, ""), done: async () => {} };
  if (kind === ".zip") {
    const folder = await files.makeTemp("hxbot-install-");
    const unzip = await run("/usr/bin/ditto", ["-x", "-k", source, folder], { timeoutMs: LONG_MS });
    if (!hxRunOk(unzip)) return { status: "failed", reason: hxRunFailure("ditto", unzip) };
    const apps = await files.findApps(folder);
    const done = () => files.remove(folder);
    if (apps.length !== 1) {
      await done();
      return { status: "invalid", reason: `The archive holds ${apps.length} apps; give the path of one .app.` };
    }
    return { app: apps[0] ?? "", done };
  }
  if (kind === ".dmg") {
    const mount = await files.makeTemp("hxbot-dmg-");
    const wait = deps.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
    let attach = await run(
      "/usr/bin/hdiutil",
      ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, source],
      { timeoutMs: LONG_MS },
    );
    for (
      let tried = 1;
      tried < ATTACH_TRIES && !hxRunOk(attach) && attachBusy(attach.stderr + attach.stdout);
      tried++
    ) {
      await wait(ATTACH_WAIT_MS * tried);
      attach = await run(
        "/usr/bin/hdiutil",
        ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, source],
        { timeoutMs: LONG_MS },
      );
    }
    if (!hxRunOk(attach)) {
      await files.remove(mount).catch(() => undefined);
      return { status: "failed", reason: hxRunFailure("hdiutil", attach) };
    }
    const done = async () => {
      // Spotlight or the Finder can hold the image for a moment: try again, the last time with -force.
      for (let tried = 1; tried <= ATTACH_TRIES; tried++) {
        const force = tried === ATTACH_TRIES ? ["-force"] : [];
        const detach = await run("/usr/bin/hdiutil", ["detach", mount, "-quiet", ...force], { timeoutMs: 60_000 });
        if (hxRunOk(detach)) break;
        if (tried < ATTACH_TRIES) await wait(ATTACH_WAIT_MS);
      }
      await files.remove(mount).catch(() => undefined);
    };
    const apps = await files.findApps(mount);
    if (apps.length !== 1) {
      await done();
      return {
        status: "invalid",
        reason: `The disk image holds ${apps.length} apps; open it with computer_open instead.`,
      };
    }
    return { app: apps[0] ?? "", done };
  }
  return { status: "invalid", reason: "Give the path of a .app, .zip, .dmg or .pkg file." };
}

/** Whether an app with this bundle id runs now (lsappinfo knows it by id, whatever the language). */
async function running(run: HxRunner, id: string): Promise<boolean> {
  const result = await run("/usr/bin/lsappinfo", ["info", "-only", "pid", "-app", id]);
  return hxRunOk(result) && /"pid"\s*=\s*\d+/u.test(result.stdout);
}

function refusedByMacOS(text: string): boolean {
  return /operation not permitted|permission denied|EPERM|EACCES/iu.test(text);
}

/** Installs one app into /Applications. Never rejects: every problem is an answer the model can read. */
export async function hxInstallApp(
  deps: HxInstallDeps,
  input: { path: string; replace?: boolean | undefined },
): Promise<HxInstallResult> {
  if (deps.platform !== "darwin")
    return {
      status: "unsupported",
      reason: "On Windows, open the installer with computer_open and its path; Windows asks the user to confirm.",
    };
  const { run, files } = deps;
  const source = input.path.trim();
  if (!source.startsWith("/")) return { status: "invalid", reason: "Give the full path of the file." };
  if (!(await files.exists(source))) return { status: "not-found", reason: `There is no file at ${source}.` };
  if (extname(source).toLowerCase() === ".pkg") {
    const opened = await run("/usr/bin/open", [source]);
    return hxRunOk(opened)
      ? {
          status: "installer",
          reason:
            "The macOS installer is open. The user follows it and gives the password there; HXBot does not type passwords.",
        }
      : { status: "failed", reason: hxRunFailure("open", opened) };
  }
  const unpacked = await unpack(deps, source);
  if (!("app" in unpacked)) return unpacked;
  try {
    const incoming = await facts(run, unpacked.app);
    if (!incoming)
      return { status: "invalid", reason: `${basename(unpacked.app)} has no bundle id: it is not an app.` };
    const signed = await signature(run, unpacked.app);
    const applications = deps.applications ?? "/Applications";
    const target = join(applications, `${incoming.name}.app`);
    const installed = (await files.exists(target)) ? await facts(run, target) : null;
    if (installed && input.replace !== true)
      return {
        status: "confirm",
        reason: `${incoming.name} ${installed.version} is installed. Ask the user in the chat whether to replace it with ${incoming.version}; after a yes, call again with replace: true.`,
        installed,
        incoming,
        signature: signed,
      };
    if (installed && (await running(run, installed.id)))
      return {
        status: "running",
        reason: `${installed.name} is open. Ask the user to quit it (and save their work), then call again.`,
        installed,
      };
    const staging = join(applications, `.${incoming.name}.hxbot-new.app`);
    await files.remove(staging).catch(() => undefined);
    const copy = await run("/usr/bin/ditto", [unpacked.app, staging], { timeoutMs: LONG_MS });
    if (!hxRunOk(copy)) {
      await files.remove(staging).catch(() => undefined);
      return refusedByMacOS(copy.stderr)
        ? await appManagement(deps)
        : { status: "failed", reason: hxRunFailure("ditto", copy) };
    }
    // The earlier version keeps a name that Finder shows ("Claude 1.0.app"), so the user can find it in the
    // Trash; a hidden name serves only when that name is taken.
    const shown = join(applications, `${incoming.name} ${installed?.version.replace(/[/:]/gu, "-") ?? ""}.app`);
    const old =
      installed && !(await files.exists(shown)) ? shown : join(applications, `.${incoming.name}.hxbot-old.app`);
    if (installed) {
      if (old !== shown) await files.remove(old).catch(() => undefined);
      try {
        await files.rename(target, old);
      } catch (error) {
        await files.remove(staging).catch(() => undefined);
        return refusedByMacOS(String(error))
          ? await appManagement(deps)
          : { status: "failed", reason: String(error).slice(0, 300) };
      }
    }
    try {
      await files.rename(staging, target);
    } catch (error) {
      if (installed) await files.rename(old, target).catch(() => undefined);
      await files.remove(staging).catch(() => undefined);
      return refusedByMacOS(String(error))
        ? await appManagement(deps)
        : { status: "failed", reason: String(error).slice(0, 300) };
    }
    // The earlier version goes to the Trash, where the user can still take it back.
    if (installed) await deps.trashItem(old).catch(() => files.remove(old).catch(() => undefined));
    const result = await facts(run, target);
    if (!result || result.version !== incoming.version)
      return {
        status: "failed",
        reason: `The copy in ${applications} reads ${result?.version ?? "nothing"}, not ${incoming.version}.`,
      };
    return {
      status: "installed",
      app: result,
      signature: signed,
      replaced: installed ? { version: installed.version } : null,
    };
  } finally {
    await unpacked.done().catch(() => undefined);
  }
}

async function appManagement(deps: HxInstallDeps): Promise<Extract<HxInstallResult, { status: "needs-permission" }>> {
  await deps.askAppManagement?.().catch(() => undefined);
  return {
    status: "needs-permission",
    permission: "app-management",
    reason:
      "macOS asks for App Management to change an app that is there. HXBot opened Privacy & Security → App Management (or, when the user works in another app, a notification that opens it) and turns on its switch if it can; the user gives the password or Touch ID. Then call again.",
  };
}
