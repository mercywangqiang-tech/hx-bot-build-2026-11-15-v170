import { describe, expect, it } from "vitest";
import { hxTaskkillArgs, hxTreeAnswer, hxTreeWithoutApps } from "./hx-process-keep";

describe("Windows keeps the apps that an agent opened (v1.7.0)", () => {
  it("reads the PIDs to stop, leaves first and the root last", () => {
    expect(hxTreeAnswer("noise\r\nHX 30 20 10\r\n", 10)).toEqual([30, 20, 10]);
    expect(hxTaskkillArgs([30, 20, 10])).toEqual(["/PID", "30", "/PID", "20", "/PID", "10", "/F"]);
  });

  it("is no answer without the root at the end, or without the line", () => {
    expect(hxTreeAnswer("HX 30 20", 10)).toBeNull();
    expect(hxTreeAnswer("something else", 10)).toBeNull();
  });

  it("stops the whole tree as before when the list fails or is late", async () => {
    const failed = await hxTreeWithoutApps(10, async () => ({
      code: null,
      stdout: "",
      stderr: "",
      timedOut: true,
      missing: false,
    }));
    expect(failed).toBeNull();
    const thrown = await hxTreeWithoutApps(10, () => Promise.reject(new Error("no PowerShell")));
    expect(thrown).toBeNull();
  });
});
