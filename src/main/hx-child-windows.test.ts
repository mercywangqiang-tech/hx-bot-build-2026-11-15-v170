import type { SpawnOptions } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  type HxChildProcessStarts,
  type HxStartArgument,
  hxHideChildWindows,
  hxWithHiddenWindow,
} from "./hx-child-windows";

const HIDE = { windowsHide: true };
const inC: SpawnOptions = { cwd: "C:\\" };
const callback = () => undefined;

describe("hxWithHiddenWindow", () => {
  it("adds windowsHide where the caller gave no options", () => {
    expect(hxWithHiddenWindow("spawn", ["cmd"])).toEqual(["cmd", HIDE]);
    expect(hxWithHiddenWindow("spawn", ["cmd", ["/c", "dir"]])).toEqual(["cmd", ["/c", "dir"], HIDE]);
    expect(hxWithHiddenWindow("execFile", ["git", ["status"], callback])).toEqual(["git", ["status"], HIDE, callback]);
    expect(hxWithHiddenWindow("execFile", ["git", callback])).toEqual(["git", HIDE, callback]);
    expect(hxWithHiddenWindow("exec", ["dir"])).toEqual(["dir", HIDE]);
    expect(hxWithHiddenWindow("exec", ["dir", callback])).toEqual(["dir", HIDE, callback]);
    expect(hxWithHiddenWindow("execSync", ["dir"])).toEqual(["dir", HIDE]);
  });

  it("puts the options in place of an undefined or null slot", () => {
    expect(hxWithHiddenWindow("execFile", ["git", ["status"], undefined, callback])).toEqual([
      "git",
      ["status"],
      HIDE,
      callback,
    ]);
    expect(hxWithHiddenWindow("execFile", ["git", ["status"], null, callback])).toEqual([
      "git",
      ["status"],
      HIDE,
      callback,
    ]);
    expect(hxWithHiddenWindow("spawn", ["cmd", undefined, inC])).toEqual([
      "cmd",
      undefined,
      { cwd: "C:\\", windowsHide: true },
    ]);
  });

  it("adds windowsHide to the options of the caller without changing the caller's object", () => {
    const options: SpawnOptions = { cwd: "C:\\", env: { A: "1" } };
    const next = hxWithHiddenWindow("spawn", ["cmd", ["/c"], options]);
    expect(next[2]).toEqual({ cwd: "C:\\", env: { A: "1" }, windowsHide: true });
    expect(options).toEqual({ cwd: "C:\\", env: { A: "1" } });
    expect(hxWithHiddenWindow("exec", ["dir", inC, callback])).toEqual([
      "dir",
      { cwd: "C:\\", windowsHide: true },
      callback,
    ]);
  });

  it("keeps windowsHide as the caller set it, also false for an app that must show its window", () => {
    expect(hxWithHiddenWindow("spawn", ["notepad.exe", ["a.txt"], { windowsHide: false }])).toEqual([
      "notepad.exe",
      ["a.txt"],
      { windowsHide: false },
    ]);
    expect(hxWithHiddenWindow("execFile", ["x", [], { windowsHide: true }, callback])).toEqual([
      "x",
      [],
      { windowsHide: true },
      callback,
    ]);
  });
});

describe("hxHideChildWindows", () => {
  function fakeModule() {
    const seen: HxStartArgument[][] = [];
    const record =
      (name: string) =>
      (...args: HxStartArgument[]): string => {
        seen.push([name, ...args]);
        return name;
      };
    const execFile = record("execFile");
    Object.defineProperty(execFile, promisify.custom, {
      value: (...args: HxStartArgument[]) => {
        seen.push(["execFile:promisified", ...args]);
        return Promise.resolve({ stdout: "out", stderr: "" });
      },
    });
    const module: HxChildProcessStarts = {
      spawn: record("spawn"),
      spawnSync: record("spawnSync"),
      execFile,
      execFileSync: record("execFileSync"),
      exec: record("exec"),
      execSync: record("execSync"),
      fork: record("fork"),
    };
    return { module, seen };
  }

  it("changes nothing outside Windows", () => {
    const { module } = fakeModule();
    const spawn = module.spawn;
    expect(hxHideChildWindows(module, "darwin")).toBe(false);
    expect(hxHideChildWindows(module, "linux")).toBe(false);
    expect(module.spawn).toBe(spawn);
  });

  it("starts each process hidden on Windows, once, and keeps promisify returning stdout and stderr", async () => {
    const { module, seen } = fakeModule();
    expect(hxHideChildWindows(module, "win32")).toBe(true);
    expect(hxHideChildWindows(module, "win32")).toBe(false);
    expect(module.spawn("tasklist.exe", ["/FO", "CSV"])).toBe("spawn");
    module.exec("dir");
    module.fork("worker.js", []);
    expect(seen).toEqual([
      ["spawn", "tasklist.exe", ["/FO", "CSV"], HIDE],
      ["exec", "dir", HIDE],
      ["fork", "worker.js", [], HIDE],
    ]);
    // `util.promisify(execFile)` uses its custom function: that one must start the process hidden too.
    const custom = Object.getOwnPropertyDescriptor(module.execFile, promisify.custom)?.value;
    expect(typeof custom).toBe("function");
    expect(await custom("git", ["status"])).toEqual({ stdout: "out", stderr: "" });
    expect(seen.at(-1)).toEqual(["execFile:promisified", "git", ["status"], HIDE]);
  });
});
