import { describe, expect, it } from "vitest";
import { hxRealSystem } from "./realcheck-system";
import type { HxRunner, HxRunResult } from "./runner";

const ok = (stdout = ""): HxRunResult => ({ code: 0, stdout, stderr: "", timedOut: false, missing: false });
const bad = (stderr: string, code = 1): HxRunResult => ({ code, stdout: "", stderr, timedOut: false, missing: false });

interface Call {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>> | undefined;
}

/** A system whose commands answer what `answer` says; every command is kept. */
function scripted(platform: "mac" | "windows", answer: (text: string, call: Call) => HxRunResult | undefined) {
  const calls: Call[] = [];
  const run: HxRunner = async (command, args, options) => {
    const call = { command, args, env: options?.env };
    calls.push(call);
    return answer(args[args.length - 1] ?? "", call) ?? ok();
  };
  return { system: hxRealSystem(platform, run), calls };
}

describe("looking at a Mac", () => {
  it("finds the processes of a program by its exact name, and stops them", async () => {
    const { system, calls } = scripted("mac", (_text, call) =>
      call.command === "/usr/bin/pgrep" ? (call.args[1] === "TextEdit" ? ok("812\n4401\n") : bad("", 1)) : undefined,
    );
    expect(await system.processIds("TextEdit")).toEqual([812, 4401]);
    expect(await system.processIds("Preview")).toEqual([]);
    expect(calls[0]).toMatchObject({ command: "/usr/bin/pgrep", args: ["-x", "TextEdit"] });
    await system.stop([812, 4401]);
    expect(calls.at(-1)).toMatchObject({ command: "/bin/kill", args: ["812", "4401"] });
    const before = calls.length;
    await system.stop([]);
    expect(calls).toHaveLength(before);
  });

  it("reads the title of the settings window, which is the name of the pane", async () => {
    const { system, calls } = scripted("mac", (text) =>
      text.includes('process "System Settings"') ? ok("Bluetooth\n") : undefined,
    );
    expect(await system.settingsWindow()).toEqual({
      open: true,
      texts: ["Bluetooth"],
      raw: ["Bluetooth"],
      blocked: false,
    });
    expect(calls[0]?.args).toEqual([
      "-e",
      'tell application "System Events" to tell process "System Settings" to get name of every window',
    ]);
    const two = scripted("mac", () => ok("Wi‑Fi, Details\n"));
    expect((await two.system.settingsWindow()).texts).toEqual(["Wi‑Fi", "Details"]);
    const none = scripted("mac", () => ok("\n"));
    expect(await none.system.settingsWindow()).toEqual({ open: false, texts: [], raw: [], blocked: false });
  });

  it("tells a window it may not read from a window that is not there", async () => {
    const noAccess = scripted("mac", (text, call) => {
      if (call.command === "/usr/bin/pgrep") return ok("77\n");
      return text.includes("System Events")
        ? bad("execution error: System Events got an error: osascript is not allowed assistive access. (-25211)")
        : undefined;
    });
    expect(await noAccess.system.settingsWindow()).toEqual({ open: true, texts: [], raw: [], blocked: true });
    const noEvents = scripted("mac", (_text, call) =>
      call.command === "/usr/bin/pgrep"
        ? bad("", 1)
        : bad("Not authorized to send Apple events to System Events. (-1743)"),
    );
    expect(await noEvents.system.settingsWindow()).toEqual({ open: false, texts: [], raw: [], blocked: true });
    const closed = scripted("mac", (_text, call) =>
      call.command === "/usr/bin/pgrep" ? bad("", 1) : bad("System Events got an error: Can’t get process. (-1728)"),
    );
    expect(await closed.system.settingsWindow()).toEqual({ open: false, texts: [], raw: [], blocked: false });
  });

  it("closes the settings, counts and closes the folder windows, and takes a picture", async () => {
    const { system, calls } = scripted("mac", (text, call) => {
      if (text === 'tell application "Finder" to count windows') return ok("3\n");
      if (call.command === "/usr/sbin/screencapture")
        return call.args.includes("/tmp/no.jpg") ? bad("could not create image") : ok();
      return undefined;
    });
    await system.closeSettings();
    expect(calls[0]).toMatchObject({ command: "/usr/bin/pkill", args: ["-x", "System Settings"] });
    expect(await system.folderWindows()).toBe(3);
    await system.closeFolders();
    expect(calls.at(-1)?.args.at(-1)).toBe('tell application "Finder" to close every window');
    expect(await system.screenshot("/tmp/a.jpg")).toBe(true);
    expect(calls.at(-1)).toMatchObject({ command: "/usr/sbin/screencapture", args: ["-x", "-t", "jpg", "/tmp/a.jpg"] });
    expect(await system.screenshot("/tmp/no.jpg")).toBe(false);
    const unknown = scripted("mac", () => bad("Finder got an error"));
    expect(await unknown.system.folderWindows()).toBeNull();
    const odd = scripted("mac", () => ok("many\n"));
    expect(await odd.system.folderWindows()).toBeNull();
  });

  it("says which macOS this is and whether there is a desktop", async () => {
    const desktop = scripted("mac", (_text, call) =>
      call.command === "/usr/bin/sw_vers" ? ok("26.0.1\n") : ok("Aqua\n"),
    );
    expect(await desktop.system.describe()).toEqual({
      system: "macOS 26.0.1",
      desktop: true,
      detail: "launchctl managername: Aqua",
    });
    const background = scripted("mac", (_text, call) =>
      call.command === "/usr/bin/sw_vers" ? bad("no") : ok("Background\n"),
    );
    expect(await background.system.describe()).toEqual({
      system: "macOS ?",
      desktop: false,
      detail: "launchctl managername: Background",
    });
  });

  it("says whether scripts may talk to System Events and read windows", async () => {
    const allowed = scripted("mac", (text) => (text.includes("count windows") ? ok("2\n") : ok("Finder\n")));
    expect(await allowed.system.automation()).toEqual({ allowed: true, detail: "System Events answered: Finder" });
    expect(await allowed.system.accessibility()).toEqual({ allowed: true, detail: "Finder has 2 windows." });
    const refused = scripted("mac", (text) =>
      text.includes("count windows")
        ? bad("osascript is not allowed assistive access. (-25211)")
        : bad("Not authorized to send Apple events to System Events. (-1743)"),
    );
    expect((await refused.system.automation()).allowed).toBe(false);
    expect((await refused.system.automation()).detail).toContain("does not let scripts talk to System Events");
    expect((await refused.system.accessibility()).detail).toContain("does not let scripts read the windows");
    const broken = scripted("mac", () => bad("syntax error"));
    expect((await broken.system.automation()).detail).toContain("syntax error");
    expect((await broken.system.accessibility()).detail).toContain("syntax error");
  });
});

describe("looking at a Windows computer", () => {
  const step = (text: string) => /\$hxStep = '([\w-]+)'/u.exec(text)?.[1] ?? "";

  it("runs every question through PowerShell by its full path, with what it asks about in the environment", async () => {
    const { system, calls } = scripted("windows", (text) => (step(text) === "pids" ? ok("5120,7716\r\n") : undefined));
    expect(await system.processIds("notepad")).toEqual([5120, 7716]);
    expect(calls[0]?.command).toMatch(/\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/u);
    expect(calls[0]?.env).toEqual({ HX_NAME: "notepad" });
    // The name never becomes a part of the script.
    expect(calls[0]?.args.join(" ")).not.toContain("notepad");
    await system.stop([5120, 7716]);
    expect(calls.at(-1)?.env).toEqual({ HX_IDS: "5120,7716" });
    const before = calls.length;
    await system.stop([]);
    expect(calls).toHaveLength(before);
    const none = scripted("windows", () => ok("\r\n"));
    expect(await none.system.processIds("notepad")).toEqual([]);
    const failing = scripted("windows", () => bad("Get-Process : failed"));
    expect(await failing.system.processIds("notepad")).toEqual([]);
  });

  it("has no double quote in any script, so that the text arrives as it was written", async () => {
    const { system, calls } = scripted("windows", () => ok("{}"));
    await system.processIds("a");
    await system.stop([1]);
    await system.settingsWindow();
    await system.closeSettings();
    await system.folderWindows();
    await system.closeFolders();
    await system.screenshot("C:\\out\\a.jpg");
    await system.describe();
    expect(calls).toHaveLength(8);
    for (const call of calls) {
      const script = call.args.at(-1) ?? "";
      expect(script, script.slice(0, 60)).not.toContain('"');
      expect(step(script), script.slice(0, 60)).not.toBe("");
    }
    expect(calls.map((call) => step(call.args.at(-1) ?? ""))).toEqual([
      "pids",
      "stop",
      "settings-window",
      "close-settings",
      "folder-windows",
      "close-folders",
      "screenshot",
      "describe",
    ]);
  });

  it("reads the names of the elements of the settings window, the same name as often as it is there", async () => {
    const names = ["Window||Settings", "ListItem||System", "Text|PageHeader|System", "Text||A|B", "Button||  ", "odd"];
    const { system } = scripted("windows", () => ok(`\uFEFF${JSON.stringify({ open: true, names })}\r\n`));
    expect(await system.settingsWindow()).toEqual({
      open: true,
      texts: ["Settings", "System", "System", "A|B", "odd"],
      raw: ["Window||Settings", "ListItem||System", "Text|PageHeader|System", "Text||A|B", "Button||", "odd"],
      blocked: false,
    });
    // PowerShell prints a list of one as the one thing.
    const one = scripted("windows", () => ok('{"open":true,"names":"Text||Display"}'));
    expect((await one.system.settingsWindow()).texts).toEqual(["Display"]);
    const closed = scripted("windows", () => ok('{"open":false,"names":[]}'));
    expect(await closed.system.settingsWindow()).toEqual({ open: false, texts: [], raw: [], blocked: false });
    for (const answer of [ok("not json"), ok("[1,2]"), bad("UIAutomation failed")]) {
      const broken = scripted("windows", () => answer);
      expect(await broken.system.settingsWindow()).toEqual({ open: false, texts: [], raw: [], blocked: false });
    }
  });

  it("counts the folder windows and takes a picture to the file it is given", async () => {
    const { system, calls } = scripted("windows", (text) => {
      if (step(text) === "folder-windows") return ok("2\r\n");
      if (step(text) === "screenshot") return ok("saved\r\n");
      return undefined;
    });
    expect(await system.folderWindows()).toBe(2);
    expect(await system.screenshot("C:\\out\\page.jpg")).toBe(true);
    expect(calls.at(-1)?.env).toEqual({ HX_SHOT: "C:\\out\\page.jpg" });
    const refused = scripted("windows", () => ok("no\r\n"));
    expect(await refused.system.screenshot("C:\\out\\page.jpg")).toBe(false);
    expect(await refused.system.folderWindows()).toBeNull();
  });

  it("says which Windows this is and whether the session has a desktop", async () => {
    const line = "Microsoft Windows 11 Enterprise 10.0.26100 | interactive=True | session=1 | culture=en-US | ui=en-US";
    const desktop = scripted("windows", () => ok(`${line}\r\n`));
    expect(await desktop.system.describe()).toEqual({
      system: "Microsoft Windows 11 Enterprise 10.0.26100",
      desktop: true,
      detail: line,
    });
    const service = scripted("windows", () => ok("Microsoft Windows Server 2022 | interactive=False | session=0\r\n"));
    expect((await service.system.describe()).desktop).toBe(false);
    const broken = scripted("windows", () => bad("Get-CimInstance : Access denied"));
    expect(await broken.system.describe()).toEqual({
      system: "Windows ?",
      desktop: false,
      detail: "Get-CimInstance : Access denied",
    });
    expect(await desktop.system.automation()).toEqual({
      allowed: true,
      detail: "Windows needs no permission for this.",
    });
    expect((await desktop.system.accessibility()).allowed).toBe(true);
  });
});
