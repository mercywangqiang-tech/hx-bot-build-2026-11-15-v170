import { describe, expect, it } from "vitest";
import { type HxInstallDeps, hxInstallApp } from "./install";
import type { HxRunResult } from "./runner";

const ok = (stdout = "", stderr = ""): HxRunResult => ({ code: 0, stdout, stderr, timedOut: false, missing: false });
const fail = (stderr: string): HxRunResult => ({ code: 1, stdout: "", stderr, timedOut: false, missing: false });

interface App {
  id: string;
  version: string;
}

/** A Mac with /Applications, the user's downloads and the macOS tools that the install calls. */
function mac(
  options: {
    installed?: App;
    running?: boolean;
    lockedApps?: boolean;
    busyAttaches?: number;
    busyDetaches?: number;
  } = {},
) {
  const apps = new Map<string, App>([
    ["/Users/u/Downloads/Claude.app", { id: "com.anthropic.claude", version: "2.0" }],
  ]);
  if (options.installed) apps.set("/Applications/Claude.app", options.installed);
  const files = new Set([
    "/Users/u/Downloads/Claude.zip",
    "/Users/u/Downloads/Claude.dmg",
    "/Users/u/Downloads/Tool.pkg",
  ]);
  const calls: string[] = [];
  const trashed: string[] = [];
  let asked = 0;
  let busy = options.busyAttaches ?? 0;
  let busyDetach = options.busyDetaches ?? 0;
  const waits: number[] = [];
  const deps: HxInstallDeps = {
    platform: "darwin",
    async wait(ms) {
      waits.push(ms);
    },
    async run(command, args) {
      calls.push(`${command.split("/").pop()} ${args.join(" ")}`);
      if (command.endsWith("plutil")) {
        const app = apps.get(String(args[5]).replace(/\/Contents\/Info\.plist$/u, ""));
        if (!app) return fail("no such file");
        return ok(args[1] === "CFBundleIdentifier" ? `${app.id}\n` : `${app.version}\n`);
      }
      if (command.endsWith("codesign"))
        return ok("", "Authority=Developer ID Application: Anthropic PBC (Q6L2SF6YDW)\nTeamIdentifier=Q6L2SF6YDW\n");
      if (command.endsWith("spctl")) return ok("", "accepted\nsource=Notarized Developer ID\n");
      if (command.endsWith("lsappinfo")) return ok(options.running ? '"pid"=812\n' : "");
      if (command.endsWith("ditto") && args[0] === "-x") {
        apps.set(`${args[3]}/Claude.app`, { id: "com.anthropic.claude", version: "2.0" });
        return ok();
      }
      if (command.endsWith("ditto")) {
        const app = apps.get(String(args[0]));
        if (!app) return fail("no source");
        apps.set(String(args[1]), app);
        return ok();
      }
      if (command.endsWith("hdiutil") && args[0] === "detach" && busyDetach > 0) {
        busyDetach -= 1;
        return fail("hdiutil: couldn't unmount - Resource busy");
      }
      if (command.endsWith("hdiutil") && args[0] === "attach") {
        if (busy > 0) {
          busy -= 1;
          return fail("hdiutil: attach failed - Resource temporarily unavailable");
        }
        apps.set(`${args[5]}/Claude.app`, { id: "com.anthropic.claude", version: "2.0" });
        return ok();
      }
      return ok();
    },
    files: {
      async exists(path) {
        return apps.has(path) || files.has(path);
      },
      async makeTemp(prefix) {
        return `/tmp/${prefix}1`;
      },
      async findApps(folder) {
        return [...apps.keys()].filter((path) => path.startsWith(`${folder}/`));
      },
      async rename(from, to) {
        if (options.lockedApps && from === "/Applications/Claude.app")
          throw new Error("EPERM: operation not permitted, rename");
        const app = apps.get(from);
        if (!app) throw new Error(`ENOENT: ${from}`);
        apps.delete(from);
        apps.set(to, app);
      },
      async remove(path) {
        apps.delete(path);
      },
    },
    async trashItem(path) {
      trashed.push(path);
      apps.delete(path);
    },
    async askAppManagement() {
      asked += 1;
    },
  };
  return { deps, apps, calls, trashed, waits, asked: () => asked };
}

describe("hxInstallApp", () => {
  it("installs a new app, reads back its version, signature and notarization, and keeps the quarantine", async () => {
    const run = mac();
    const result = await hxInstallApp(run.deps, { path: "/Users/u/Downloads/Claude.app" });
    expect(result).toMatchObject({
      status: "installed",
      app: { name: "Claude", id: "com.anthropic.claude", version: "2.0", path: "/Applications/Claude.app" },
      signature: {
        authority: "Developer ID Application: Anthropic PBC (Q6L2SF6YDW)",
        team: "Q6L2SF6YDW",
        notarized: true,
      },
      replaced: null,
    });
    expect(run.calls.some((call) => call.startsWith("xattr"))).toBe(false);
    expect([...run.apps.keys()].filter((path) => path.includes("hxbot"))).toEqual([]);
  });

  it("asks before it replaces an installed app, and asks the user to quit one that runs", async () => {
    const installed = { id: "com.anthropic.claude", version: "1.9" };
    const asked = await hxInstallApp(mac({ installed }).deps, { path: "/Users/u/Downloads/Claude.app" });
    expect(asked).toMatchObject({ status: "confirm", installed: { version: "1.9" }, incoming: { version: "2.0" } });
    const open = await hxInstallApp(mac({ installed, running: true }).deps, {
      path: "/Users/u/Downloads/Claude.app",
      replace: true,
    });
    expect(open.status).toBe("running");
  });

  it("after a yes, puts the new version in place and the earlier one in the Trash", async () => {
    const run = mac({ installed: { id: "com.anthropic.claude", version: "1.9" } });
    const result = await hxInstallApp(run.deps, { path: "/Users/u/Downloads/Claude.app", replace: true });
    expect(result).toMatchObject({ status: "installed", app: { version: "2.0" }, replaced: { version: "1.9" } });
    expect(run.trashed).toEqual(["/Applications/Claude 1.9.app"]);
    expect(run.apps.get("/Applications/Claude.app")?.version).toBe("2.0");
  });

  it("opens App Management when macOS refuses to change the installed app, and leaves it as it was", async () => {
    const run = mac({ installed: { id: "com.anthropic.claude", version: "1.9" }, lockedApps: true });
    const result = await hxInstallApp(run.deps, { path: "/Users/u/Downloads/Claude.app", replace: true });
    expect(result).toMatchObject({ status: "needs-permission", permission: "app-management" });
    expect(run.asked()).toBe(1);
    expect(run.apps.get("/Applications/Claude.app")?.version).toBe("1.9");
    expect([...run.apps.keys()].filter((path) => path.includes("hxbot"))).toEqual([]);
  });

  it("takes the app out of a zip or a disk image, and gives a .pkg to the macOS installer", async () => {
    const zip = await hxInstallApp(mac().deps, { path: "/Users/u/Downloads/Claude.zip" });
    expect(zip.status).toBe("installed");
    const image = mac();
    expect((await hxInstallApp(image.deps, { path: "/Users/u/Downloads/Claude.dmg" })).status).toBe("installed");
    expect(image.calls.some((call) => call.startsWith("hdiutil detach"))).toBe(true);
    const pkg = mac();
    expect((await hxInstallApp(pkg.deps, { path: "/Users/u/Downloads/Tool.pkg" })).status).toBe("installer");
    expect(pkg.calls).toContain("open /Users/u/Downloads/Tool.pkg");
  });

  it("answers plainly for a wrong path and on Windows", async () => {
    expect((await hxInstallApp(mac().deps, { path: "Claude.app" })).status).toBe("invalid");
    expect((await hxInstallApp(mac().deps, { path: "/nope/Claude.app" })).status).toBe("not-found");
    expect((await hxInstallApp({ ...mac().deps, platform: "win32" }, { path: "C:\\x.exe" })).status).toBe(
      "unsupported",
    );
  });

  it("tries the disk image again while macOS says it is busy, and stops after four tries", async () => {
    const busyOnce = mac({ busyAttaches: 2 });
    expect((await hxInstallApp(busyOnce.deps, { path: "/Users/u/Downloads/Claude.dmg" })).status).toBe("installed");
    expect(busyOnce.calls.filter((call) => call.startsWith("hdiutil attach"))).toHaveLength(3);
    expect(busyOnce.waits).toEqual([3_000, 6_000]);

    const busyAlways = mac({ busyAttaches: 9 });
    const result = await hxInstallApp(busyAlways.deps, { path: "/Users/u/Downloads/Claude.dmg" });
    expect(result).toMatchObject({ status: "failed" });
    expect(busyAlways.calls.filter((call) => call.startsWith("hdiutil attach"))).toHaveLength(4);
  });

  it("ejects the disk image again while it is busy, the last time with -force", async () => {
    const image = mac({ busyDetaches: 3 });
    expect((await hxInstallApp(image.deps, { path: "/Users/u/Downloads/Claude.dmg" })).status).toBe("installed");
    const detaches = image.calls.filter((call) => call.startsWith("hdiutil detach"));
    expect(detaches).toHaveLength(4);
    expect(detaches[3]).toContain("-force");
    expect(detaches[0]).not.toContain("-force");
  });
});
