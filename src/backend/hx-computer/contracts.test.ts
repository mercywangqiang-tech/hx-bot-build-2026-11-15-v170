import { decodeHxComputerStatus, decodeHxSelfTestReport } from "@hxbot/contracts/hx-computer";
import { describe, expect, it } from "vitest";

describe("decodeHxComputerStatus", () => {
  it("passes a status through", () => {
    const status = {
      platform: "mac",
      builtAt: 5,
      apps: 120,
      pages: 42,
      settings: 12,
      directSettings: 8,
      disabled: ["setting:volume"],
      unchecked: 3,
    };
    expect(decodeHxComputerStatus(status)).toEqual(status);
    expect(decodeHxComputerStatus({ ...status, platform: "windows" }).platform).toBe("windows");
  });

  it("reads anything else as an empty catalog", () => {
    const empty = {
      platform: null,
      builtAt: null,
      apps: 0,
      pages: 0,
      settings: 0,
      directSettings: 0,
      disabled: [],
      unchecked: 0,
    };
    for (const value of [null, undefined, "x", 5, [], {}]) expect(decodeHxComputerStatus(value)).toEqual(empty);
    expect(
      decodeHxComputerStatus({
        platform: "linux",
        builtAt: "1",
        apps: -3,
        pages: 2.9,
        settings: Number.NaN,
        disabled: [1, "a", null],
        unchecked: "4",
      }),
    ).toEqual({ ...empty, pages: 2, disabled: ["a"] });
    // A status from an earlier version has no count of unchecked settings: it reads as none.
    expect(decodeHxComputerStatus({ platform: "mac", settings: 12, directSettings: 12 }).unchecked).toBe(0);
    expect(decodeHxComputerStatus({ platform: "mac", unchecked: 5.7 }).unchecked).toBe(5);
  });
});

describe("decodeHxSelfTestReport", () => {
  it("counts the totals again from the items", () => {
    const report = decodeHxSelfTestReport({
      platform: "windows",
      system: "Windows 10.0",
      startedAt: 10,
      finishedAt: 20,
      items: [
        { id: "a", outcome: "passed", detail: "ok", ms: 3 },
        { id: "b", outcome: "skipped", detail: "", ms: 0 },
        { id: "c", outcome: "anything else", detail: 7, ms: -1 },
        "not an item",
      ],
      passed: 99,
      failed: 0,
      skipped: 0,
      file: "C:\\Users\\a\\Downloads\\r.json",
    });
    expect(report).toEqual({
      platform: "windows",
      system: "Windows 10.0",
      startedAt: 10,
      finishedAt: 20,
      items: [
        { id: "a", outcome: "passed", detail: "ok", ms: 3 },
        { id: "b", outcome: "skipped", detail: "", ms: 0 },
        { id: "c", outcome: "failed", detail: "", ms: 0 },
      ],
      passed: 1,
      failed: 1,
      skipped: 1,
      file: "C:\\Users\\a\\Downloads\\r.json",
    });
  });

  it("reads anything else as an empty report", () => {
    for (const value of [null, "x", [], { items: "no" }]) {
      expect(decodeHxSelfTestReport(value)).toEqual({
        platform: null,
        system: "",
        startedAt: 0,
        finishedAt: 0,
        items: [],
        passed: 0,
        failed: 0,
        skipped: 0,
        file: "",
      });
    }
  });

  it("cuts very long text", () => {
    const report = decodeHxSelfTestReport({
      items: [{ id: "i".repeat(500), outcome: "passed", detail: "d".repeat(5000), ms: 1 }],
    });
    expect(report.items[0]?.id).toHaveLength(200);
    expect(report.items[0]?.detail).toHaveLength(2000);
  });
});
