// computer_app (v1.6.9): the routes, the questions before a force quit or a risky menu command, and the
// answers when macOS refuses. The system commands are stand-ins that answer like macOS and Windows did
// on GitHub's machines (hxbot-check, real check part "apps").
import { describe, expect, it } from "vitest";
import { type HxAppDeps, hxAppControl } from "./app-control";
import type { HxRunResult } from "./runner";

const ok = (stdout: string): HxRunResult => ({ code: 0, stdout, stderr: "", timedOut: false, missing: false });
const bad = (stderr: string): HxRunResult => ({ code: 1, stdout: "", stderr, timedOut: false, missing: false });

interface World {
  apps: { name: string; id: string; pid: number; active?: boolean; hidden?: boolean }[];
  frontmost: number | null;
  /** Apps that take the quit request but stay open (they ask whether to save). */
  asksToSave: Set<number>;
  automation: boolean;
  defaults: Record<string, string>;
}

function mac(world: World) {
  const calls: string[] = [];
  let automationPage = 0;
  const deps: HxAppDeps = {
    platform: "darwin",
    sleep: async () => {},
    openAutomationPage: async () => {
      automationPage += 1;
    },
    async run(command, args, options) {
      const env = options?.env ?? {};
      const script = args.find((arg) => arg.includes("ObjC.import") || arg.includes("on run argv")) ?? "";
      calls.push(`${command} ${script.includes("on run argv") ? "applescript" : "jxa"}`);
      const find = (want: string) =>
        world.apps.find((app) => [app.id, app.name].some((name) => name.toLowerCase() === want.toLowerCase()));
      if (command === "/bin/ps") {
        const pid = Number(args[1]);
        return world.apps.some((app) => app.pid === pid) ? ok(`${pid}\n`) : { ...bad(""), stdout: "" };
      }
      if (command === "/usr/bin/open") {
        const app = find(args[1] ?? "");
        if (app) world.frontmost = app.pid;
        return ok("");
      }
      if (script.includes("JSON.stringify(running().map(info))")) return ok(JSON.stringify(world.apps));
      if (script.includes("frontmostApplication")) {
        const front = world.apps.find((app) => app.pid === world.frontmost);
        return ok(JSON.stringify(front ?? null));
      }
      if (script.includes("a.activateWithOptions")) {
        const app = find(env.HX_APP ?? "");
        if (app) world.frontmost = app.pid;
        return ok(JSON.stringify({ sent: true }));
      }
      if (script.includes("a.hide()")) {
        const app = find(env.HX_APP ?? "");
        if (app) app.hidden = true;
        return ok(JSON.stringify({ sent: true }));
      }
      if (script.includes("a.terminate()")) {
        const app = find(env.HX_APP ?? "");
        if (!app) return ok("null");
        if (env.HX_FORCE === "1" || !world.asksToSave.has(app.pid))
          world.apps = world.apps.filter((each) => each !== app);
        return ok(JSON.stringify({ sent: true }));
      }
      if (script.includes("const a = find(env('HX_APP')); JSON.stringify(a ? info(a) : null);"))
        return ok(JSON.stringify(find(env.HX_APP ?? "") ?? null));
      if (script.includes("URLForApplicationWithBundleIdentifier")) {
        const name = env.HX_APP ?? "";
        return ok(JSON.stringify(name === "Firefox" ? { id: "org.mozilla.firefox", name: "Firefox" } : null));
      }
      if (script.includes("LSCopyDefaultHandlerForURLScheme")) {
        const key = env.HX_SCHEME || env.HX_EXT || "";
        const before = world.defaults[key] ?? "";
        return ok(JSON.stringify({ before, after: before, code: env.HX_BUNDLE ? 0 : null }));
      }
      if (script.includes("System Events") && !world.automation)
        return bad("execution error: Not authorized to send Apple events to System Events. (-1743)");
      if (script.includes("menu bar items")) return ok("File\tNew\nFile\tSave\nEdit\tDelete\n");
      if (script.includes("click menu item")) return ok("clicked");
      if (script.includes("win.position"))
        return ok(JSON.stringify({ want: [0, 25, 720, 875], now: [0, 25, 720, 875] }));
      return bad(`unexpected ${command}`);
    },
  };
  return { deps, calls, automationPage: () => automationPage };
}

const textEdit = { name: "TextEdit", id: "com.apple.TextEdit", pid: 501 };
const world = (patch: Partial<World> = {}): World => ({
  apps: [{ ...textEdit }, { name: "Finder", id: "com.apple.finder", pid: 300 }],
  frontmost: 300,
  asksToSave: new Set(),
  automation: true,
  defaults: { http: "com.apple.safari" },
  ...patch,
});

describe("computer_app on a Mac", () => {
  it("lists the running apps and finds one by name or bundle id", async () => {
    const run = mac(world());
    expect(await hxAppControl(run.deps, { action: "list" })).toMatchObject({
      status: "apps",
      apps: [{ name: "TextEdit" }, { name: "Finder" }],
    });
    expect(await hxAppControl(run.deps, { action: "front", app: "com.apple.TextEdit" })).toMatchObject({
      status: "done",
      route: "direct",
    });
    expect(await hxAppControl(run.deps, { action: "quit", app: "Pages" })).toMatchObject({ status: "not-found" });
  });

  it("quits normally and checks that the app is gone", async () => {
    const run = mac(world());
    expect(await hxAppControl(run.deps, { action: "quit", app: "TextEdit" })).toMatchObject({
      status: "done",
      action: "quit",
      route: "direct",
      detail: "quit normally",
    });
  });

  it("leaves the save dialog to the user, and force quits only after a yes", async () => {
    const asks = world({ asksToSave: new Set([501]) });
    const run = mac(asks);
    expect(await hxAppControl(run.deps, { action: "quit", app: "TextEdit" })).toMatchObject({ status: "waiting" });
    expect(await hxAppControl(run.deps, { action: "quit", app: "TextEdit", force: true })).toMatchObject({
      status: "confirm",
    });
    expect(asks.apps.some((app) => app.pid === 501)).toBe(true);
    expect(
      await hxAppControl(run.deps, { action: "quit", app: "TextEdit", force: true, confirmed: true }),
    ).toMatchObject({ status: "done", detail: "forced" });
  });

  it("asks before a menu command that deletes, and opens the Automation page when macOS refuses", async () => {
    const run = mac(world());
    expect(await hxAppControl(run.deps, { action: "menus", app: "TextEdit" })).toEqual({
      status: "menus",
      app: "TextEdit",
      menus: [
        { menu: "File", items: ["New", "Save"] },
        { menu: "Edit", items: ["Delete"] },
      ],
    });
    expect(await hxAppControl(run.deps, { action: "menu", app: "TextEdit", path: ["Edit", "Delete"] })).toMatchObject({
      status: "confirm",
    });
    expect(await hxAppControl(run.deps, { action: "menu", app: "TextEdit", path: ["File", "Save"] })).toMatchObject({
      status: "done",
      route: "controls",
    });
    const refused = mac(world({ automation: false }));
    expect(await hxAppControl(refused.deps, { action: "menus", app: "TextEdit" })).toMatchObject({
      status: "needs-permission",
    });
    expect(refused.automationPage()).toBe(1);
  });

  it("places a window, reads the default browser, and says when macOS asks the user to confirm a change", async () => {
    const run = mac(world());
    expect(await hxAppControl(run.deps, { action: "window", app: "TextEdit", place: "left" })).toMatchObject({
      status: "done",
      route: "command",
    });
    expect(await hxAppControl(run.deps, { action: "default", kind: "browser" })).toEqual({
      status: "default",
      kind: "browser",
      target: "web pages (http, https)",
      app: "com.apple.safari",
      route: "direct",
    });
    expect(await hxAppControl(run.deps, { action: "default", kind: "browser", app: "Firefox" })).toMatchObject({
      status: "confirm-dialog",
    });
    expect(await hxAppControl(run.deps, { action: "default", kind: "type", type: "../x" })).toMatchObject({
      status: "invalid",
    });
  });

  it("goes on to the next route when the system interface does not bring the app to the front", async () => {
    const stays = world();
    const run = mac(stays);
    const front = run.deps.run;
    run.deps.run = async (command, args, options) => {
      const result = await front(command, args, options);
      // macOS 14 and later may ignore a background activation: the frontmost app does not change.
      if (args.some((arg) => arg.includes("a.activateWithOptions"))) stays.frontmost = 300;
      return result;
    };
    expect(await hxAppControl(run.deps, { action: "front", app: "TextEdit" })).toMatchObject({
      status: "done",
      route: "command",
      tried: [{ route: "direct" }],
    });
  });
});

describe("computer_app on Windows and elsewhere", () => {
  it("sends menus to the controls and refuses other systems", async () => {
    const deps: HxAppDeps = {
      platform: "win32",
      sleep: async () => {},
      openAutomationPage: async () => {},
      run: async () => ok("null"),
    };
    expect(await hxAppControl(deps, { action: "menus", app: "notepad" })).toMatchObject({ status: "use-steps" });
    expect(await hxAppControl(deps, { action: "quit", app: "notepad" })).toMatchObject({ status: "not-found" });
    expect(await hxAppControl({ ...deps, platform: "linux" }, { action: "list" })).toMatchObject({ status: "failed" });
  });
});
