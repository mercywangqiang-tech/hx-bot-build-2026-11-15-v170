// @vitest-environment node
import type { RoutineSchedule } from "@hxbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { HX_STAGGER_WINDOW_MS, hxStaggerDelays, hxStaggerHash } from "./stagger";

// CONC-14: routines due in the same minute start spread over it, in order; one alone starts at once.
const daily: RoutineSchedule = { kind: "daily", time: "09:00" };
const due = (routineId: string, nextRunAt = "2026-11-20T01:00:00.000Z", schedule: RoutineSchedule = daily) => ({
  routineId,
  nextRunAt,
  schedule,
  timezone: "UTC",
});

describe("hxStaggerDelays", () => {
  it("does not delay a routine that is due alone", () => {
    expect(hxStaggerDelays([due("solo")])).toEqual(new Map([["solo", 0]]));
    expect(hxStaggerDelays([due("a"), due("b", "2026-11-20T01:01:00.000Z")])).toEqual(
      new Map([
        ["a", 0],
        ["b", 0],
      ]),
    );
  });

  it("spreads 6 routines of one minute within 60 seconds, keeps their order, and gives the same delays again", () => {
    const dues = ["r1", "r2", "r3", "r4", "r5", "r6"].map((id) => due(id));
    const delays = hxStaggerDelays(dues);
    const list = dues.map((entry) => delays.get(entry.routineId) ?? -1);
    expect(list.every((delay) => delay >= 0 && delay < HX_STAGGER_WINDOW_MS)).toBe(true);
    expect([...list].sort((a, b) => a - b)).toEqual(list);
    expect(new Set(list).size).toBeGreaterThan(1);
    expect(hxStaggerDelays(dues)).toEqual(delays);
  });

  it("caps a delay at 10% of the interval and still keeps the order", () => {
    const every3: RoutineSchedule = {
      kind: "interval",
      amount: 3,
      unit: "minutes",
      anchorAt: "2026-11-20T00:00:00.000Z",
    };
    const dues = Array.from({ length: 8 }, (_, index) => due(`fast-${index}`, "2026-11-20T01:00:00.000Z", every3));
    const list = dues.map((entry) => hxStaggerDelays(dues).get(entry.routineId) ?? -1);
    expect(Math.max(...list)).toBeLessThanOrEqual(18_000);
    expect([...list].sort((a, b) => a - b)).toEqual(list);
    const mixed = [due("slow-a"), due("fast", "2026-11-20T01:00:00.000Z", every3), due("slow-b")];
    const mixedDelays = mixed.map((entry) => hxStaggerDelays(mixed).get(entry.routineId) ?? -1);
    expect([...mixedDelays].sort((a, b) => a - b)).toEqual(mixedDelays);
    expect(mixedDelays[1]).toBeLessThanOrEqual(18_000);
  });

  it("hashes the same id the same way", () => {
    expect(hxStaggerHash("routine-1")).toBe(hxStaggerHash("routine-1"));
    expect(hxStaggerHash("routine-1")).not.toBe(hxStaggerHash("routine-2"));
  });
});
