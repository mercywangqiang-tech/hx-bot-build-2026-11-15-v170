import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HX_PROGRESS_DEFAULT_MS,
  HX_PROGRESS_MAX_MS,
  HX_PROGRESS_MIN_MS,
  HX_YIELD_DEFAULT_MS,
  HX_YIELD_MAX_MS,
  HX_YIELD_MIN_MS,
  HxLearnedSettings,
} from "./learned";

const MINUTE = 60_000;
const DAY = 24 * 3_600_000;
let folder = "";
let now = Date.parse("2026-11-20T08:00:00Z");
let learned: HxLearnedSettings;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "hx-learned-"));
  now = Date.parse("2026-11-20T08:00:00Z");
  learned = new HxLearnedSettings(
    () => folder,
    () => now,
  );
});

afterEach(() => rmSync(folder, { recursive: true, force: true }));

describe("G1 reminder time (CONC-13)", () => {
  it("CONC-13-A1: three times continue reach the 2-hour limit; the defaults bring 30 minutes back", () => {
    const seen: number[] = [];
    for (let time = 0; time < 3; time += 1) {
      learned.choose({ work: "writing", teamId: "team-1", choice: "continue" });
      seen.push(learned.progressMs("writing", "team-1"));
    }
    expect(seen).toEqual([60 * MINUTE, 120 * MINUTE, 120 * MINUTE]);
    expect(learned.progressMs("writing", "team-1")).toBe(HX_PROGRESS_MAX_MS);
    learned.reset();
    expect(learned.progressMs("writing", "team-1")).toBe(30 * MINUTE);
    expect(learned.progressMs("writing")).toBe(30 * MINUTE);
  });

  it("says the change, and says nothing when the limit keeps the value", () => {
    const first = learned.choose({ work: "data", teamId: "t", choice: "continue" });
    expect(first).toEqual({ what: "team-progress", beforeMs: 30 * MINUTE, afterMs: 60 * MINUTE });
    learned.choose({ work: "data", teamId: "t", choice: "continue" });
    expect(learned.choose({ work: "data", teamId: "t", choice: "continue" })).toBeNull();
  });

  it("continue changes only that team; other teams of the same work keep the default", () => {
    learned.choose({ work: "writing", teamId: "a", choice: "continue" });
    expect(learned.progressMs("writing", "b")).toBe(HX_PROGRESS_DEFAULT_MS);
    expect(learned.progressMs("writing")).toBe(HX_PROGRESS_DEFAULT_MS);
  });

  it("a team that ended loses its own time", () => {
    learned.choose({ work: "writing", teamId: "a", choice: "continue" });
    learned.forgetTeam("a");
    expect(learned.progressMs("writing", "a")).toBe(HX_PROGRESS_DEFAULT_MS);
  });

  it("wrap up and stop make the default of that kind of work 0.75 of it, down to 15 minutes", () => {
    const steps: number[] = [];
    for (const choice of ["finish", "stop", "stop", "finish", "stop"] as const) {
      learned.choose({ work: "code-large", teamId: "x", choice });
      steps.push(learned.progressMs("code-large"));
    }
    expect(steps).toEqual([22.5 * MINUTE, 16.875 * MINUTE, 15 * MINUTE, 15 * MINUTE, 15 * MINUTE].map(Math.round));
    expect(learned.progressMs("writing")).toBe(HX_PROGRESS_DEFAULT_MS);
    // A team with its own time keeps it on a wrap-up.
    learned.choose({ work: "code-large", teamId: "own", choice: "continue" });
    learned.choose({ work: "code-large", teamId: "own", choice: "finish" });
    expect(learned.progressMs("code-large", "own")).toBe(30 * MINUTE);
  });

  it("keeps the values on this computer, across a restart", () => {
    learned.choose({ work: "chat", teamId: "x", choice: "stop" });
    const again = new HxLearnedSettings(
      () => folder,
      () => now,
    );
    expect(again.progressMs("chat")).toBe(22.5 * MINUTE);
  });

  it("a damaged or strange file keeps the defaults and the limits", () => {
    writeFileSync(join(folder, "learned-settings.json"), "{ not json");
    expect(learned.progressMs("chat")).toBe(HX_PROGRESS_DEFAULT_MS);
    writeFileSync(
      join(folder, "learned-settings.json"),
      JSON.stringify({ version: 1, progress: { chat: 1, data: 10 ** 12, code: "x" }, yieldMs: -4 }),
    );
    learned.forget();
    expect(learned.progressMs("chat")).toBe(HX_PROGRESS_MIN_MS);
    expect(learned.progressMs("data")).toBe(HX_PROGRESS_MAX_MS);
    expect(learned.progressMs("code")).toBe(HX_PROGRESS_DEFAULT_MS);
    expect(learned.yieldMs()).toBe(HX_YIELD_MIN_MS);
  });

  it("keeps the fields of a later version", () => {
    writeFileSync(join(folder, "learned-settings.json"), JSON.stringify({ version: 2, later: { a: 1 } }));
    learned.forget();
    learned.choose({ work: "chat", teamId: "x", choice: "stop" });
    const saved = JSON.parse(readFileSync(join(folder, "learned-settings.json"), "utf8"));
    expect(saved.later).toEqual({ a: 1 });
  });

  it("with no data folder it works for this run and writes nothing", () => {
    const loose = new HxLearnedSettings(
      () => null,
      () => now,
    );
    loose.choose({ work: "chat", teamId: "x", choice: "stop" });
    expect(loose.progressMs("chat")).toBe(22.5 * MINUTE);
  });
});

describe("pause before HXBot goes on (CONC-13)", () => {
  it("is 5 seconds; twice in a day too early gives 2 seconds more, up to 15", () => {
    expect(learned.yieldMs()).toBe(HX_YIELD_DEFAULT_MS);
    expect(learned.wentOnTooEarly()).toBeNull();
    now += 3_600_000;
    expect(learned.wentOnTooEarly()).toEqual({ what: "yield", beforeMs: 5_000, afterMs: 7_000 });
    for (let pair = 0; pair < 10; pair += 1) {
      now += 60_000;
      learned.wentOnTooEarly();
      now += 60_000;
      learned.wentOnTooEarly();
    }
    expect(learned.yieldMs()).toBe(HX_YIELD_MAX_MS);
  });

  it("two times more than a day apart do not count together", () => {
    learned.wentOnTooEarly();
    now += DAY + 1;
    expect(learned.wentOnTooEarly()).toBeNull();
    expect(learned.yieldMs()).toBe(HX_YIELD_DEFAULT_MS);
  });

  it("a week with no such time takes 1 second off, down to 3", () => {
    learned.wentOnTooEarly();
    learned.wentOnTooEarly();
    expect(learned.yieldMs()).toBe(7_000);
    now += 6 * DAY;
    expect(learned.yieldMs()).toBe(7_000);
    now += DAY;
    expect(learned.yieldMs()).toBe(6_000);
    now += 30 * DAY;
    expect(learned.yieldMs()).toBe(HX_YIELD_MIN_MS);
  });

  it("the defaults bring 5 seconds back", () => {
    learned.wentOnTooEarly();
    learned.wentOnTooEarly();
    expect(learned.reset().yieldMs).toBe(HX_YIELD_DEFAULT_MS);
  });
});
