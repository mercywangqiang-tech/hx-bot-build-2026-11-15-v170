import type { RoutineSchedule } from "@hxbot/contracts/ipc";
import {
  hxRoutineUpcoming,
  nextRoutineOccurrence,
  RoutineInputError,
  routineOnceInstant,
} from "@hxbot/team-client/routine-schedule";
import { describe, expect, it } from "vitest";

const LA = "America/Los_Angeles";

function runsBetween(schedule: RoutineSchedule, zone: string, from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = new Date(from);
  for (let i = 0; i < 200; i += 1) {
    const next = nextRoutineOccurrence(schedule, zone, cursor);
    if (next.getTime() >= Date.parse(to)) break;
    out.push(next.toISOString());
    cursor = next;
  }
  return out;
}

describe("RTN-01 clock changes (America/Los_Angeles)", () => {
  it("a daily 02:30 on 2027-03-14 runs at 03:00, then 02:30 again", () => {
    const upcoming = hxRoutineUpcoming({ kind: "daily", time: "02:30" }, LA, new Date("2027-03-13T12:00:00Z"));
    expect(upcoming.map((run) => [run.local, run.offsetMinutes, run.shiftedFrom, run.repeated])).toEqual([
      ["2027-03-14 03:00", -420, "02:30", false],
      ["2027-03-15 02:30", -420, null, false],
      ["2027-03-16 02:30", -420, null, false],
    ]);
    expect(upcoming[0]?.at).toBe("2027-03-14T10:00:00.000Z");
  });

  it("a daily 01:30 on 2027-11-07 runs once, at the first 01:30 (UTC-07:00)", () => {
    const runs = runsBetween({ kind: "daily", time: "01:30" }, LA, "2027-11-06T12:00:00Z", "2027-11-08T12:00:00Z");
    expect(runs).toEqual(["2027-11-07T08:30:00.000Z", "2027-11-08T09:30:00.000Z"]);
    const [first, second] = hxRoutineUpcoming({ kind: "daily", time: "01:30" }, LA, new Date("2027-11-06T12:00:00Z"));
    expect(first).toMatchObject({ local: "2027-11-07 01:30", offsetMinutes: -420, repeated: true, shiftedFrom: null });
    expect(second).toMatchObject({ local: "2027-11-08 01:30", offsetMinutes: -480, repeated: false });
  });

  it("created during the repeated hour, a 01:45 that already ran its first instant waits a day", () => {
    // 01:30 PST, the second copy of the hour. 01:45 PDT was before it.
    const next = nextRoutineOccurrence({ kind: "daily", time: "01:45" }, LA, new Date("2027-11-07T09:30:00Z"));
    expect(next.toISOString()).toBe("2027-11-08T09:45:00.000Z");
  });

  it("an hourly routine follows elapsed time through both changes", () => {
    const hourly: RoutineSchedule = { kind: "hourly", minute: 30 };
    expect(runsBetween(hourly, LA, "2027-11-07T07:00:00Z", "2027-11-07T11:00:00Z")).toEqual([
      "2027-11-07T07:30:00.000Z", // 00:30 PDT
      "2027-11-07T08:30:00.000Z", // 01:30 PDT
      "2027-11-07T09:30:00.000Z", // 01:30 PST
      "2027-11-07T10:30:00.000Z", // 02:30 PST
    ]);
    expect(runsBetween(hourly, LA, "2027-03-14T09:00:00Z", "2027-03-14T11:00:00Z")).toEqual([
      "2027-03-14T09:30:00.000Z", // 01:30 PST
      "2027-03-14T10:30:00.000Z", // 03:30 PDT, 02:30 does not exist
    ]);
  });

  it("weekdays, weekly, monthly and an exact advanced time shift out of the gap too", () => {
    const after = new Date("2027-03-13T12:00:00Z");
    const shifted = (schedule: RoutineSchedule) => hxRoutineUpcoming(schedule, LA, after, 1)[0];
    expect(shifted({ kind: "weekly", weekday: 0, time: "02:10" })).toMatchObject({
      local: "2027-03-14 03:00",
      shiftedFrom: "02:10",
    });
    expect(shifted({ kind: "monthly", day: 14, time: "02:59" })).toMatchObject({ local: "2027-03-14 03:00" });
    expect(
      shifted({
        kind: "advanced",
        days: { kind: "days-of-week", days: [0] },
        months: [3],
        time: { kind: "at-time", time: "02:00" },
      }),
    ).toMatchObject({ local: "2027-03-14 03:00", shiftedFrom: "02:00" });
  });

  it("a cron line with named hours shifts, one with */n hours follows elapsed time", () => {
    const named = hxRoutineUpcoming(
      { kind: "custom", expression: "30 2 * * *" },
      LA,
      new Date("2027-03-13T12:00:00Z"),
      1,
    );
    expect(named[0]).toMatchObject({ local: "2027-03-14 03:00", shiftedFrom: "02:30" });
    const stepped = runsBetween(
      { kind: "custom", expression: "30 */1 * * *" },
      LA,
      "2027-11-07T08:00:00Z",
      "2027-11-07T10:00:00Z",
    );
    expect(stepped).toEqual(["2027-11-07T08:30:00.000Z", "2027-11-07T09:30:00.000Z"]);
  });

  it("a one-time routine in the gap runs at 03:00", () => {
    const once: RoutineSchedule = { kind: "once", date: "2027-03-14", time: "02:30" };
    expect(routineOnceInstant(once, LA).toISOString()).toBe("2027-03-14T10:00:00.000Z");
    expect(hxRoutineUpcoming(once, LA, new Date("2027-03-01T00:00:00Z"))).toEqual([
      {
        at: "2027-03-14T10:00:00.000Z",
        local: "2027-03-14 03:00",
        offsetMinutes: -420,
        shiftedFrom: "02:30",
        repeated: false,
      },
    ]);
  });
});

describe("RTN-01 other zones", () => {
  it("Shanghai, Monday 09:00 (TC-X-RTN-01-03 baseline)", () => {
    const upcoming = hxRoutineUpcoming(
      { kind: "weekly", weekday: 1, time: "09:00" },
      "Asia/Shanghai",
      new Date("2026-11-10T00:00:00Z"),
    );
    expect(upcoming.map((run) => run.at)).toEqual([
      "2026-11-16T01:00:00.000Z",
      "2026-11-23T01:00:00.000Z",
      "2026-11-30T01:00:00.000Z",
    ]);
    expect(upcoming.every((run) => run.offsetMinutes === 480 && !run.repeated && run.shiftedFrom === null)).toBe(true);
  });

  it("Lord Howe moves 30 minutes: 02:15 runs at 02:30", () => {
    const [run] = hxRoutineUpcoming(
      { kind: "daily", time: "02:15" },
      "Australia/Lord_Howe",
      new Date("2027-10-02T00:00:00Z"),
      1,
    );
    expect(run).toMatchObject({ local: "2027-10-03 02:30", shiftedFrom: "02:15" });
  });

  it("London's gap is 01:00-02:00; Kathmandu is +05:45 all year", () => {
    const [london] = hxRoutineUpcoming(
      { kind: "daily", time: "01:30" },
      "Europe/London",
      new Date("2027-03-27T12:00:00Z"),
      1,
    );
    expect(london).toMatchObject({ local: "2027-03-28 02:00", offsetMinutes: 60, shiftedFrom: "01:30" });
    const [kathmandu] = hxRoutineUpcoming(
      { kind: "daily", time: "09:00" },
      "Asia/Kathmandu",
      new Date("2026-11-20T00:00:00Z"),
      1,
    );
    expect(kathmandu).toMatchObject({ offsetMinutes: 345, at: "2026-11-20T03:15:00.000Z" });
  });

  it("an interval follows the anchor; count is kept between 0 and 10", () => {
    const interval: RoutineSchedule = {
      kind: "interval",
      amount: 2,
      unit: "hours",
      anchorAt: "2027-11-07T07:00:00.000Z",
    };
    expect(hxRoutineUpcoming(interval, LA, new Date("2027-11-07T07:00:00Z")).map((run) => run.at)).toEqual([
      "2027-11-07T09:00:00.000Z",
      "2027-11-07T11:00:00.000Z",
      "2027-11-07T13:00:00.000Z",
    ]);
    expect(hxRoutineUpcoming({ kind: "daily", time: "09:00" }, LA, new Date(), 0)).toEqual([]);
    expect(hxRoutineUpcoming({ kind: "daily", time: "09:00" }, LA, new Date(), 50)).toHaveLength(10);
  });

  it("refuses a zone the runtime does not know and a passed one-time date", () => {
    expect(() => hxRoutineUpcoming({ kind: "daily", time: "09:00" }, "Mars/Olympus", new Date())).toThrow(
      RoutineInputError,
    );
    expect(hxRoutineUpcoming({ kind: "once", date: "2020-01-01", time: "09:00" }, LA, new Date())).toEqual([]);
  });

  it("every zone the runtime lists gives three ordered runs a day apart or less (no gaps or doubles)", () => {
    const zones = Intl.supportedValuesOf("timeZone");
    const after = new Date("2027-03-01T00:00:00Z");
    for (const zone of zones) {
      let cursor = after;
      for (let day = 0; day < 400; day += 1) {
        const next = nextRoutineOccurrence({ kind: "daily", time: "02:30" }, zone, cursor);
        const gap = next.getTime() - cursor.getTime();
        if (day > 0 && (gap < 20 * 3_600_000 || gap > 28 * 3_600_000)) {
          throw new Error(`${zone}: ${cursor.toISOString()} -> ${next.toISOString()}`);
        }
        cursor = next;
      }
    }
  }, 120_000);
});
