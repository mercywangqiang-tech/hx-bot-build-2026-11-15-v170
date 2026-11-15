import { describe, expect, it } from "vitest";
import { hxRun, hxRunFailure, hxRunOk } from "./runner";

// These run a real program: the one that runs the tests. Nothing here depends on the system.
const NODE = process.execPath;

describe("hxRun", () => {
  it("gives the output and code 0 of a command that worked", async () => {
    const result = await hxRun(NODE, ["-e", "process.stdout.write('蓝牙 ok'); process.stderr.write('note')"]);
    expect(result).toEqual({ code: 0, stdout: "蓝牙 ok", stderr: "note", timedOut: false, missing: false });
    expect(hxRunOk(result)).toBe(true);
  });

  it("gives the code and the error text of a command that failed", async () => {
    const result = await hxRun(NODE, ["-e", "process.stderr.write('no access\\nmore'); process.exit(3)"]);
    expect(result).toMatchObject({ code: 3, stderr: "no access\nmore", timedOut: false, missing: false });
    expect(hxRunOk(result)).toBe(false);
    expect(hxRunFailure("Reading the setting", result)).toBe("Reading the setting ended with code 3: no access");
  });

  it("says when the program is not on this computer", async () => {
    const result = await hxRun("/nowhere/hx-no-such-program", ["x"]);
    expect(result).toMatchObject({ code: null, missing: true, timedOut: false });
    expect(hxRunOk(result)).toBe(false);
    expect(hxRunFailure("Opening it", result)).toBe("Opening it is not on this computer");
  });

  it("stops a command that takes longer than its time", async () => {
    const started = Date.now();
    const result = await hxRun(NODE, ["-e", "setTimeout(() => {}, 20000)"], { timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(result.missing).toBe(false);
    expect(hxRunOk(result)).toBe(false);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(hxRunFailure("Changing the setting", result)).toBe("Changing the setting did not answer in time");
  });

  it("gives a result when a program that the command started keeps the output open", async () => {
    // The command starts a second program that holds the output for 20 seconds, then ends.
    const script =
      "const c = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: ['ignore', 'inherit', 'inherit'] }); process.stdout.write(String(c.pid)); c.unref();";
    const started = Date.now();
    const result = await hxRun(NODE, ["-e", script], { timeoutMs: 15_000 });
    const pid = Number(result.stdout);
    if (pid > 0) process.kill(pid);
    expect(result).toMatchObject({ code: 0, timedOut: false, missing: false });
    expect(pid).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("passes an argument as it is, with no shell in between", async () => {
    const tricky = "a b; echo $HOME `id` \"q\" 'q' && x | y > z \\ %PATH% 中文";
    const result = await hxRun(NODE, ["-e", "process.stdout.write(process.argv[1])", tricky]);
    expect(result.stdout).toBe(tricky);
  });

  it("adds values to the environment of the command and keeps the rest", async () => {
    const script = "process.stdout.write(JSON.stringify([process.env.HX_TARGET, typeof process.env.PATH]))";
    const withValue = await hxRun(NODE, ["-e", script], { env: { HX_TARGET: "shell:AppsFolder\\A'; x" } });
    expect(JSON.parse(withValue.stdout)).toEqual(["shell:AppsFolder\\A'; x", "string"]);
    const without = await hxRun(NODE, ["-e", script]);
    expect(JSON.parse(without.stdout)).toEqual([null, "string"]);
  });
});

describe("hxRunFailure", () => {
  it("uses the output when there is no error text, and says so when there is neither", () => {
    const base = { timedOut: false, missing: false };
    expect(hxRunFailure("It", { ...base, code: 1, stdout: "from stdout\nsecond", stderr: " " })).toBe(
      "It ended with code 1: from stdout",
    );
    expect(hxRunFailure("It", { ...base, code: 2, stdout: "", stderr: "" })).toBe("It ended with code 2");
    expect(hxRunFailure("It", { ...base, code: null, stdout: "", stderr: "" })).toBe("It ended with code none");
  });

  it("keeps a long error text short", () => {
    const text = hxRunFailure("It", { code: 1, stdout: "", stderr: "e".repeat(900), timedOut: false, missing: false });
    expect(text.length).toBe("It ended with code 1: ".length + 300);
  });
});
