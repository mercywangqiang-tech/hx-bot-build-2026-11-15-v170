// @vitest-environment node
import type { RoutineSchedule } from "@hxbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { HX_MISSED_GRACE_MS, HX_MISSED_WALK_LIMIT, type HxDueInput, hxPlanDue } from "./due";

// RTN-02, RTN-03, MIG-03: what one due trigger becomes.
const hourly: RoutineSchedule = { kind: "hourly", minute: 0 };
const at = (iso: string) => new Date(iso);

function input(overrides: Partial<HxDueInput>): HxDueInput {
  return {
    schedule: hourly,
    timezone: "UTC",
    firstDue: at("2026-11-20T10:00:00.000Z"),
    now: at("2026-11-20T10:00:01.000Z"),
    missedPolicy: "skip",
    live: false,
    limited: false,
    confirmEach: false,
    actions: [],
    ...overrides,
  };
}

describe("hxPlanDue", () => {
  it("runs an occurrence on time as before", () => {
    const plan = hxPlanDue(input({}));
    expect(plan.run).toEqual({ scheduledFor: at("2026-11-20T10:00:00.000Z"), catchUp: null, confirm: null });
    expect(plan.missed).toBeNull();
    expect(plan.skipped).toBeNull();
    expect(plan.nextRunAt).toEqual(at("2026-11-20T11:00:00.000Z"));
  });

  it("runs once after a 3-hour sleep with run-once, and counts the 3 missed occurrences (RTN-02-A1)", () => {
    const plan = hxPlanDue(
      input({
        missedPolicy: "run-once",
        now: at("2026-11-20T12:30:00.000Z"),
        firstDue: at("2026-11-20T10:00:00.000Z"),
      }),
    );
    const batch = {
      total: 3,
      truncated: false,
      from: at("2026-11-20T10:00:00.000Z"),
      until: at("2026-11-20T12:00:00.000Z"),
      handled: "run-once",
    };
    expect(plan.run).toEqual({ scheduledFor: at("2026-11-20T12:00:00.000Z"), catchUp: batch, confirm: null });
    expect(plan.missed).toEqual(batch);
    expect(plan.nextRunAt).toEqual(at("2026-11-20T13:00:00.000Z"));
  });

  it("skips all 3 after a sleep with skip, and runs none", () => {
    const plan = hxPlanDue(input({ now: at("2026-11-20T12:30:00.000Z") }));
    expect(plan.run).toBeNull();
    expect(plan.missed).toMatchObject({ total: 3, handled: "skip" });
    expect(plan.skipped).toBeNull();
  });

  it("runs the on-time occurrence after a sleep and records the late ones", () => {
    const now = new Date(at("2026-11-20T12:00:00.000Z").getTime() + HX_MISSED_GRACE_MS - 1000);
    const skip = hxPlanDue(input({ now }));
    expect(skip.run?.scheduledFor).toEqual(at("2026-11-20T12:00:00.000Z"));
    expect(skip.run?.catchUp).toBeNull();
    expect(skip.missed).toMatchObject({
      total: 2,
      from: at("2026-11-20T10:00:00.000Z"),
      until: at("2026-11-20T11:00:00.000Z"),
    });
    const once = hxPlanDue(input({ now, missedPolicy: "run-once" }));
    expect(once.run?.scheduledFor).toEqual(at("2026-11-20T12:00:00.000Z"));
    expect(once.run?.catchUp).toMatchObject({ total: 2 });
    expect(once.missed).toMatchObject({ total: 2, handled: "run-once" });
  });

  it("treats exactly the grace as on time and one second more as late", () => {
    const first = at("2026-11-20T10:00:00.000Z");
    expect(hxPlanDue(input({ now: new Date(first.getTime() + HX_MISSED_GRACE_MS) })).run?.scheduledFor).toEqual(first);
    const late = hxPlanDue(input({ now: new Date(first.getTime() + HX_MISSED_GRACE_MS + 1000) }));
    expect(late.run).toBeNull();
    expect(late.missed).toMatchObject({ total: 1, handled: "skip" });
    // One late occurrence with run-once is a late run, not a batch.
    const once = hxPlanDue(
      input({ now: new Date(first.getTime() + HX_MISSED_GRACE_MS + 1000), missedPolicy: "run-once" }),
    );
    expect(once.run?.scheduledFor).toEqual(first);
    expect(once.run?.catchUp).toMatchObject({ total: 1 });
    expect(once.missed).toBeNull();
  });

  it("leaves a skipped record when the last run is still running (RTN-03) or a spent plan drops it", () => {
    expect(hxPlanDue(input({ live: true }))).toMatchObject({
      run: null,
      skipped: { scheduledFor: at("2026-11-20T10:00:00.000Z"), reason: "previous-running" },
    });
    expect(hxPlanDue(input({ limited: true })).skipped?.reason).toBe("plan-limit");
    // Missed ones stay recorded when the catch-up is skipped too.
    const both = hxPlanDue(input({ live: true, missedPolicy: "run-once", now: at("2026-11-20T12:30:00.000Z") }));
    expect(both.missed).toMatchObject({ total: 3 });
    expect(both.skipped?.reason).toBe("previous-running");
  });

  it("asks before each run of a routine set to ask, and before a catch-up that sends", () => {
    expect(hxPlanDue(input({ confirmEach: true })).run?.confirm).toBe("each");
    expect(
      hxPlanDue(input({ actions: ["send"], missedPolicy: "run-once", now: at("2026-11-20T12:30:00.000Z") })).run
        ?.confirm,
    ).toBe("catch-up");
    // An on-time run that sends does not ask: only a catch-up and a routine set to ask do.
    expect(hxPlanDue(input({ actions: ["send"] })).run?.confirm).toBeNull();
  });

  it("runs the catch-up that HXBot's start kept due, without counting it again", () => {
    const plan = hxPlanDue(
      input({
        missedPolicy: "run-once",
        firstDue: at("2026-11-20T12:00:00.000Z"),
        now: at("2026-11-20T12:40:00.000Z"),
        actions: ["delete"],
        pendingCatchUp: {
          scheduledFor: "2026-11-20T12:00:00.000Z",
          total: 3,
          from: "2026-11-20T10:00:00.000Z",
          until: "2026-11-20T12:00:00.000Z",
        },
      }),
    );
    expect(plan.missed).toBeNull();
    expect(plan.run).toMatchObject({
      scheduledFor: at("2026-11-20T12:00:00.000Z"),
      catchUp: { total: 3 },
      confirm: "catch-up",
    });
  });

  it("stops counting at the walk limit and still runs the newest occurrence", () => {
    const every3: RoutineSchedule = {
      kind: "interval",
      amount: 3,
      unit: "minutes",
      anchorAt: "2026-01-01T00:00:00.000Z",
    };
    const firstDue = at("2026-01-01T00:00:00.000Z");
    const now = at("2026-03-01T00:01:00.000Z");
    const plan = hxPlanDue(input({ schedule: every3, firstDue, now, missedPolicy: "run-once" }));
    expect(plan.missed?.truncated).toBe(true);
    expect(plan.missed?.total).toBe(HX_MISSED_WALK_LIMIT);
    expect(plan.run?.scheduledFor).toEqual(at("2026-03-01T00:00:00.000Z"));
    expect(plan.nextRunAt).toEqual(at("2026-03-01T00:03:00.000Z"));
  });

  it("counts a sleep across a spring gap in the routine's zone", () => {
    const daily: RoutineSchedule = { kind: "daily", time: "02:30" };
    const plan = hxPlanDue(
      input({
        schedule: daily,
        timezone: "America/Los_Angeles",
        firstDue: at("2027-03-13T10:30:00.000Z"),
        now: at("2027-03-15T12:00:00.000Z"),
        missedPolicy: "run-once",
      }),
    );
    // 03-13 02:30 PST, 03-14 03:00 PDT (the gap), 03-15 02:30 PDT.
    expect(plan.missed).toMatchObject({ total: 3, until: at("2027-03-15T09:30:00.000Z") });
    expect(plan.run?.scheduledFor).toEqual(at("2027-03-15T09:30:00.000Z"));
  });
});
