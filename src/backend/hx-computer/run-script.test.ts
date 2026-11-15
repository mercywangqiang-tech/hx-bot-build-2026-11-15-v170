// computer_run (v1.6.9): which scripts run at once, which ask first, which never run here, and what a
// refused Apple event answers. The runner is a stand-in.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { type HxRunScriptDeps, hxRiskyScript, hxRunScript } from "./run-script";
import type { HxRunResult } from "./runner";

const ok = (stdout: string): HxRunResult => ({ code: 0, stdout, stderr: "", timedOut: false, missing: false });

function deps(
  platform: NodeJS.Platform,
  answer: (command: string, args: readonly string[], script: string) => HxRunResult,
) {
  const seen: { command: string; args: readonly string[]; script: string }[] = [];
  let automation = 0;
  const value: HxRunScriptDeps = {
    platform,
    openAutomationPage: async () => {
      automation += 1;
    },
    async run(command, args) {
      const file = args.find((arg) => arg.endsWith(".applescript") || arg.endsWith(".js"));
      const script = file ? await readFile(file, "utf8") : "";
      seen.push({ command, args, script });
      return answer(command, args, script);
    },
  };
  return { value, seen, automation: () => automation };
}

describe("computer_run", () => {
  it("runs an AppleScript and a JXA script from a file, in HXBot itself", async () => {
    const run = deps("darwin", (_command, _args, script) =>
      ok(script.includes("Finder") ? "Macintosh HD\n" : "15.5\n"),
    );
    expect(
      await hxRunScript(run.value, {
        language: "applescript",
        script: 'tell application "Finder"\n  get name of startup disk\nend tell',
      }),
    ).toEqual({ status: "ran", language: "applescript", output: "Macintosh HD", truncated: false });
    expect(
      await hxRunScript(run.value, {
        language: "jxa",
        script: "Application.currentApplication().systemInfo().systemVersion",
      }),
    ).toMatchObject({
      status: "ran",
      output: "15.5",
    });
    expect(run.seen[0]?.command).toBe("/usr/bin/osascript");
    expect(run.seen[0]?.args.slice(0, 2)).toEqual(["-l", "AppleScript"]);
    expect(run.seen[1]?.args.slice(0, 2)).toEqual(["-l", "JavaScript"]);
  });

  it("asks before a script that deletes or sends, and never runs one that needs administrator rights", async () => {
    const run = deps("darwin", () => ok(""));
    expect(
      await hxRunScript(run.value, {
        language: "applescript",
        script: 'tell application "Finder" to delete file "a.txt"',
      }),
    ).toMatchObject({
      status: "confirm",
    });
    expect(
      await hxRunScript(run.value, {
        language: "applescript",
        script: 'tell application "Finder" to delete file "a.txt"',
        confirmed: true,
      }),
    ).toMatchObject({ status: "ran" });
    expect(
      await hxRunScript(run.value, {
        language: "applescript",
        script: 'do shell script "ls" with administrator privileges',
        confirmed: true,
      }),
    ).toMatchObject({ status: "refused" });
    expect(hxRiskyScript('tell application "Mail" to send newMessage')).toBe(true);
    expect(hxRiskyScript("Remove-Item C:\\temp\\a.txt")).toBe(true);
    expect(hxRiskyScript("$excel.Workbooks.Open($path)")).toBe(false);
    expect(hxRiskyScript("删除这个文件")).toBe(true);
  });

  it("opens the Automation page when macOS refuses the Apple event", async () => {
    const run = deps("darwin", () => ({
      code: 1,
      stdout: "",
      stderr: "execution error: Not authorized to send Apple events to Microsoft Excel. (-1743)",
      timedOut: false,
      missing: false,
    }));
    expect(
      await hxRunScript(run.value, {
        language: "applescript",
        script: 'tell application "Microsoft Excel" to activate',
      }),
    ).toMatchObject({
      status: "needs-permission",
    });
    expect(run.automation()).toBe(1);
  });

  it("says that macOS most likely asks the user when a script that controls an app runs out of time", async () => {
    const late: HxRunResult = { code: null, stdout: "", stderr: "", timedOut: true, missing: false };
    const run = deps("darwin", () => late);
    const asking = await hxRunScript(run.value, {
      language: "applescript",
      script: 'tell application "TextEdit"\n  set text of document 1 to "x"\nend tell',
    });
    expect(asking).toMatchObject({ status: "needs-permission" });
    expect(asking.status === "needs-permission" && asking.reason).toContain("click OK");
    // A script that controls no app and runs out of time is a failure, not a question of macOS.
    expect(await hxRunScript(run.value, { language: "jxa", script: "delay(500)" })).toMatchObject({
      status: "failed",
    });
  });

  it("runs a shortcut with its input, and PowerShell only on Windows", async () => {
    const run = deps("darwin", () => ok(""));
    expect(
      await hxRunScript(run.value, { language: "shortcut", script: "Resize images", input: "a.png" }),
    ).toMatchObject({ status: "ran" });
    expect(run.seen[0]?.command).toBe("/usr/bin/shortcuts");
    expect(run.seen[0]?.args.slice(0, 3)).toEqual(["run", "Resize images", "--input-path"]);
    expect(await hxRunScript(run.value, { language: "powershell", script: "Get-Date" })).toMatchObject({
      status: "invalid",
    });
    const win = deps("win32", () => ok("Sunday\r\n"));
    expect(await hxRunScript(win.value, { language: "powershell", script: "(Get-Date).DayOfWeek" })).toMatchObject({
      status: "ran",
      output: "Sunday",
    });
    expect(win.seen[0]?.args).toContain("-EncodedCommand");
    expect(await hxRunScript(win.value, { language: "applescript", script: "beep" })).toMatchObject({
      status: "invalid",
    });
  });
});
