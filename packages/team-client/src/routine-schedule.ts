import {
  isRoutineSchedule,
  ROUTINE_MINIMUM_INTERVAL_MINUTES,
  type RoutineIntervalUnit,
  type RoutineSchedule,
} from "@hxbot/contracts/ipc";
import { sourceText } from "@hxbot/i18n/source";

const MINIMUM_INTERVAL_MS = ROUTINE_MINIMUM_INTERVAL_MINUTES * 60_000;
const MAX_SEARCH_DAYS = 366 * 5;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

interface CalendarParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
}

interface CronField {
  values: number[];
  wildcard: boolean;
}

interface CronSpec {
  minute: CronField;
  hour: CronField;
  day: CronField;
  month: CronField;
  weekday: CronField;
  exactTimes?: Set<string>;
  /**
   * HXBot (v1.7.5, RTN-01): the schedule names its hours, as a daily, weekly or monthly time does. A
   * time of day in a spring gap then runs at the first minute after the gap, and a time that the fall
   * repeats runs once, at its first instant. A schedule that runs every hour or every few minutes
   * follows elapsed time instead: it runs in both copies of a repeated hour and skips the gap.
   */
  hxWallClock?: boolean;
}

/** A routine request the caller can correct. Other errors are faults. */
export class RoutineInputError extends Error {}

export function validateStoredRoutineSchedule(schedule: RoutineSchedule, timezone: string): void {
  if (!isRoutineSchedule(schedule)) throw new RoutineInputError(sourceText("error.backend.routineScheduleInvalid"));
  validateTimezone(timezone);
  if (schedule.kind === "interval") {
    if (intervalMilliseconds(schedule.amount, schedule.unit) < MINIMUM_INTERVAL_MS) {
      throw new RoutineInputError(
        sourceText("error.backend.routineIntervalTooShort", { minutes: ROUTINE_MINIMUM_INTERVAL_MINUTES }),
      );
    }
    return;
  }
  if (schedule.kind === "advanced" && schedule.time.kind === "every") {
    if (intervalMilliseconds(schedule.time.amount, schedule.time.unit) < MINIMUM_INTERVAL_MS) {
      throw new RoutineInputError(
        sourceText("error.backend.routineIntervalTooShortFixed", { minutes: ROUTINE_MINIMUM_INTERVAL_MINUTES }),
      );
    }
  }
  if (schedule.kind !== "custom") return;
  if (hasRunsTooClose(parseCron(schedule.expression), timezone)) {
    throw new RoutineInputError(
      sourceText("error.backend.routineCronTooOften", { minutes: ROUTINE_MINIMUM_INTERVAL_MINUTES }),
    );
  }
}

function hasRunsTooClose(spec: CronSpec, timezone: string): boolean {
  const reference = new Date("2026-01-01T00:00:00.000Z");
  let previous = nextCronOccurrence(spec, timezone, reference);
  for (let index = 0; index < 200; index += 1) {
    const next = nextCronOccurrence(spec, timezone, previous);
    if (next.getTime() - previous.getTime() < MINIMUM_INTERVAL_MS) return true;
    previous = next;
  }
  return false;
}

/**
 * The check for a schedule being saved. Steps restart at each hour or day, so "every 59 minutes"
 * also runs at :59 and then :00. A stored schedule is read through `validateStoredRoutineSchedule`:
 * an older version accepted such a schedule, and rejecting it on read would stop every routine from loading.
 */
export function validateRoutineSchedule(schedule: RoutineSchedule, timezone: string): void {
  validateStoredRoutineSchedule(schedule, timezone);
  if (schedule.kind === "custom") validateCronSaveSyntax(schedule.expression);
  if (
    schedule.kind === "advanced" &&
    schedule.time.kind === "every" &&
    hasRunsTooClose(scheduleCronSpec(schedule), timezone)
  ) {
    throw new RoutineInputError(
      sourceText("error.backend.routineIntervalTooShortFixed", { minutes: ROUTINE_MINIMUM_INTERVAL_MINUTES }),
    );
  }
}

export function nextRoutineOccurrence(schedule: RoutineSchedule, timezone: string, after: Date): Date {
  validateStoredRoutineSchedule(schedule, timezone);
  return nextValidRoutineOccurrence(schedule, timezone, after);
}

/** For a schedule that `validateStoredRoutineSchedule` accepted: a custom one costs 200 searches to validate. */
export function nextValidRoutineOccurrence(schedule: RoutineSchedule, timezone: string, after: Date): Date {
  if (schedule.kind === "once") {
    const due = routineOnceInstant(schedule, timezone);
    if (after.getTime() < due.getTime()) return due;
    throw new RoutineInputError(sourceText("error.backend.routineOncePassed"));
  }
  if (schedule.kind === "interval") {
    const duration = intervalMilliseconds(schedule.amount, schedule.unit);
    const anchor = Date.parse(schedule.anchorAt);
    if (!Number.isFinite(anchor)) throw new RoutineInputError(sourceText("error.backend.routineAnchorInvalid"));
    if (after.getTime() < anchor) return new Date(anchor);
    const elapsed = after.getTime() - anchor;
    return new Date(anchor + (Math.floor(elapsed / duration) + 1) * duration);
  }
  return nextCronOccurrence(scheduleCronSpec(schedule), timezone, after);
}

/**
 * The instant of a one-time schedule. A local time that repeats runs at its first instant. A local
 * time in a gap runs at the first minute after the gap, so a date that a clock change skips still runs.
 */
export function routineOnceInstant(schedule: Extract<RoutineSchedule, { kind: "once" }>, timezone: string): Date {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = schedule.date.split("-").map(Number);
  const [hour, minute] = parseTime(schedule.time);
  const start = Date.UTC(year, month - 1, day, hour, minute);
  for (let step = 0; step <= MAX_GAP_MINUTES; step += 1) {
    const local = new Date(start + step * 60_000);
    const [candidate] = zonedDateTimeCandidates(
      {
        year: local.getUTCFullYear(),
        month: local.getUTCMonth() + 1,
        day: local.getUTCDate(),
        weekday: local.getUTCDay(),
        hour: local.getUTCHours(),
        minute: local.getUTCMinutes(),
      },
      timezone,
    );
    if (candidate) return candidate;
  }
  throw new RoutineInputError(sourceText("error.backend.routineNoOccurrence"));
}

/** The longest clock change of a time zone is shorter than this. */
const MAX_GAP_MINUTES = 3 * 60;

export function normalizeRoutineSchedule(schedule: RoutineSchedule, now = new Date()): RoutineSchedule {
  if (schedule.kind !== "interval") return structuredClone(schedule);
  const anchor = Number.isNaN(Date.parse(schedule.anchorAt)) ? now.toISOString() : schedule.anchorAt;
  return { ...schedule, anchorAt: anchor };
}

function scheduleCronSpec(schedule: Exclude<RoutineSchedule, { kind: "interval" | "once" }>): CronSpec {
  switch (schedule.kind) {
    case "hourly":
      return cronSpec(
        field([schedule.minute]),
        wildcardField(0, 23),
        wildcardField(1, 31),
        wildcardField(1, 12),
        wildcardField(0, 6),
      );
    case "daily": {
      const [hour, minute] = parseTime(schedule.time);
      return hxWall(
        cronSpec(field([minute]), field([hour]), wildcardField(1, 31), wildcardField(1, 12), wildcardField(0, 6)),
      );
    }
    case "weekdays": {
      const [hour, minute] = parseTime(schedule.time);
      return hxWall(
        cronSpec(field([minute]), field([hour]), wildcardField(1, 31), wildcardField(1, 12), field([1, 2, 3, 4, 5])),
      );
    }
    case "weekly": {
      const [hour, minute] = parseTime(schedule.time);
      return hxWall(
        cronSpec(field([minute]), field([hour]), wildcardField(1, 31), wildcardField(1, 12), field([schedule.weekday])),
      );
    }
    case "monthly": {
      const [hour, minute] = parseTime(schedule.time);
      return hxWall(
        cronSpec(field([minute]), field([hour]), field([schedule.day]), wildcardField(1, 12), wildcardField(0, 6)),
      );
    }
    case "advanced": {
      const day = schedule.days.kind === "days-of-month" ? field(schedule.days.days) : wildcardField(1, 31);
      const weekday = schedule.days.kind === "days-of-week" ? field(schedule.days.days) : wildcardField(0, 6);
      if (schedule.time.kind === "every") {
        const minutes = schedule.time.unit === "minutes" ? steppedValues(0, 59, schedule.time.amount) : [0];
        const hours =
          schedule.time.unit === "hours" ? steppedValues(0, 23, schedule.time.amount) : steppedValues(0, 23, 1);
        return cronSpec(field(minutes), field(hours), day, field(schedule.months), weekday);
      }
      const parsed = [parseTime(schedule.time.time)];
      return hxWall(
        cronSpec(
          field([...new Set(parsed.map(([, minute]) => minute))]),
          field([...new Set(parsed.map(([hour]) => hour))]),
          day,
          field(schedule.months),
          weekday,
          new Set(parsed.map(([hour, minute]) => `${hour}:${minute}`)),
        ),
      );
    }
    case "custom":
      return hxCustomWallClock(parseCron(schedule.expression), schedule.expression);
  }
}

/** HXBot (v1.7.5, RTN-01): a cron line names its hours unless its hour field starts with `*`. */
function hxCustomWallClock(spec: CronSpec, expression: string): CronSpec {
  const hour = expression.trim().split(/\s+/)[1] ?? "*";
  return hour.startsWith("*") ? spec : { ...spec, hxWallClock: true };
}

function cronSpec(
  minute: CronField,
  hour: CronField,
  day: CronField,
  month: CronField,
  weekday: CronField,
  exactTimes?: Set<string>,
): CronSpec {
  const result: CronSpec = { minute, hour, day, month, weekday };
  if (exactTimes) result.exactTimes = exactTimes;
  return result;
}

/** HXBot (v1.7.5, RTN-01): see `CronSpec.hxWallClock`. */
function hxWall(spec: CronSpec): CronSpec {
  return { ...spec, hxWallClock: true };
}

/**
 * HXBot (v1.7.5, RTN-01): the instant a named time of day runs at. A time in a spring gap runs at the
 * first minute after the gap (02:30 on a day that jumps from 02:00 to 03:00 runs at 03:00); a time the
 * fall repeats runs at its first instant only. `undefined` only past the longest gap there is.
 */
function hxWallClockInstant(parts: CalendarParts, timezone: string): Date | undefined {
  const [first] = zonedDateTimeCandidates(parts, timezone);
  if (first) return first;
  const start = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  for (let step = 1; step <= MAX_GAP_MINUTES; step += 1) {
    const local = new Date(start + step * 60_000);
    const [candidate] = zonedDateTimeCandidates(
      {
        year: local.getUTCFullYear(),
        month: local.getUTCMonth() + 1,
        day: local.getUTCDate(),
        weekday: local.getUTCDay(),
        hour: local.getUTCHours(),
        minute: local.getUTCMinutes(),
      },
      timezone,
    );
    if (candidate) return candidate;
  }
  return undefined;
}

function nextCronOccurrence(spec: CronSpec, timezone: string, after: Date): Date {
  const start = zonedParts(after, timezone);
  const calendar = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const exactTimes = spec.exactTimes;
  const repeatedStart = !spec.hxWallClock && zonedDateTimeCandidates(start, timezone).length > 1;
  for (let offset = 0; offset <= MAX_SEARCH_DAYS; offset += 1) {
    const current = new Date(calendar.getTime() + offset * 86_400_000);
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth() + 1;
    const day = current.getUTCDate();
    const weekday = current.getUTCDay();
    if (!spec.month.values.includes(month)) continue;
    const dayMatches = spec.day.values.includes(day);
    const weekdayMatches = spec.weekday.values.includes(weekday);
    const calendarMatches =
      spec.day.wildcard && spec.weekday.wildcard
        ? true
        : spec.day.wildcard
          ? weekdayMatches
          : spec.weekday.wildcard
            ? dayMatches
            : dayMatches || weekdayMatches;
    if (!calendarMatches) continue;

    let repeatedCandidate: Date | undefined;
    for (const hour of spec.hour.values) {
      for (const minute of spec.minute.values) {
        if (exactTimes && !exactTimes.has(`${hour}:${minute}`)) continue;
        if (offset === 0 && (hour < start.hour || (hour === start.hour && minute < start.minute)) && !repeatedStart) {
          continue;
        }
        if (spec.hxWallClock) {
          // HXBot (v1.7.5, RTN-01): one instant for each named time, in wall-clock order.
          const instant = hxWallClockInstant({ year, month, day, weekday, hour, minute }, timezone);
          if (instant && instant.getTime() > after.getTime()) return instant;
          continue;
        }
        const candidates = zonedDateTimeCandidates({ year, month, day, weekday, hour, minute }, timezone);
        for (const [index, candidate] of candidates.entries()) {
          if (candidate.getTime() <= after.getTime()) continue;
          // First occurrences follow wall-clock order. A second occurrence can precede a later
          // wall time's first occurrence, even across hours when the clock moves back several hours.
          if (index === 0) {
            return repeatedCandidate && repeatedCandidate.getTime() < candidate.getTime()
              ? repeatedCandidate
              : candidate;
          }
          if (!repeatedCandidate || candidate.getTime() < repeatedCandidate.getTime()) {
            repeatedCandidate = candidate;
          }
        }
      }
    }
    if (repeatedCandidate) return repeatedCandidate;
  }
  throw new RoutineInputError(sourceText("error.backend.routineNoOccurrence"));
}

function zonedDateTimeCandidates(parts: CalendarParts, timezone: string): Date[] {
  const approximate = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  // A local time falls at its UTC time less an offset that the zone uses near it. A time in a gap
  // has no candidate, and a time that repeats has two.
  const offsets = new Set(
    [-18, 0, 18].map((hours) => {
      const instant = approximate + hours * 3_600_000;
      const local = zonedParts(new Date(instant), timezone);
      return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - instant;
    }),
  );
  const result: Date[] = [];
  for (const offset of offsets) {
    const candidate = new Date(approximate - offset);
    const value = zonedParts(candidate, timezone);
    if (
      value.year === parts.year &&
      value.month === parts.month &&
      value.day === parts.day &&
      value.hour === parts.hour &&
      value.minute === parts.minute
    ) {
      result.push(candidate);
    }
  }
  return result.sort((left, right) => left.getTime() - right.getTime());
}

function zonedParts(date: Date, timezone: string): CalendarParts {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timezone, formatter);
  }
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: WEEKDAY_INDEX[values.weekday ?? "Sun"] ?? 0,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new RoutineInputError(sourceText("error.backend.routineTimezoneInvalid"));
  }
}

function parseCron(expression: string): CronSpec {
  const values = expression.trim().split(/\s+/);
  if (!hasFiveFields(values)) throw new RoutineInputError(sourceText("error.backend.routineCronFields"));
  return cronSpec(
    parseCronField(values[0], 0, 59, "minute"),
    parseCronField(values[1], 0, 23, "hour"),
    parseCronField(values[2], 1, 31, "day"),
    parseCronField(values[3], 1, 12, "month"),
    parseCronField(values[4], 0, 6, "weekday", true),
  );
}

/** Only ASCII digits. `Number` also reads forms such as `0x5`, `1e1`, `+5` and `5.0`. */
const CRON_DECIMAL = /^[0-9]+$/;

/** Reject tokens the released parser ignores or reads loosely, but keep stored schedules readable. */
function validateCronSaveSyntax(expression: string): void {
  const values = expression.trim().split(/\s+/);
  if (!hasFiveFields(values)) throw new RoutineInputError(sourceText("error.backend.routineCronFields"));
  const fields = [
    [values[0], "minute"],
    [values[1], "hour"],
    [values[2], "day"],
    [values[3], "month"],
    [values[4], "weekday"],
  ] as const;
  for (const [source, label] of fields) {
    for (const segment of source.split(",")) {
      const [rangeSource = "", stepSource, ...extra] = segment.split("/");
      const bounds = rangeSource === "*" ? [] : rangeSource.split("-");
      const step = stepSource === undefined ? [] : [stepSource];
      if (extra.length > 0 || ![...bounds, ...step].every((value) => CRON_DECIMAL.test(value))) {
        throw new RoutineInputError(sourceText("error.backend.routineCronValueInvalid", { field: label }));
      }
    }
  }
}

function hasFiveFields(values: string[]): values is [string, string, string, string, string] {
  return values.length === 5;
}

function parseCronField(
  source: string,
  minimum: number,
  maximum: number,
  label: string,
  sundayAlias = false,
): CronField {
  const wildcard = source === "*";
  const result = new Set<number>();
  for (const segment of source.split(",")) {
    const [rangeSource, stepSource] = segment.split("/");
    if (rangeSource === undefined)
      throw new RoutineInputError(sourceText("error.backend.routineCronValueInvalid", { field: label }));
    const step = stepSource === undefined ? 1 : Number(stepSource);
    if (!Number.isInteger(step) || step < 1) throw new RoutineInputError(`The cron ${label} step is invalid.`);
    let start: number;
    let end: number;
    if (rangeSource === "*") {
      start = minimum;
      end = maximum;
    } else if (rangeSource.includes("-")) {
      const [rangeStart, rangeEnd, ...extra] = rangeSource.split("-").map(Number);
      if (rangeStart === undefined || rangeEnd === undefined || extra.length > 0)
        throw new RoutineInputError(`The cron ${label} range is invalid.`);
      start = rangeStart;
      end = rangeEnd;
    } else {
      start = Number(rangeSource);
      end = start;
    }
    const allowedMaximum = sundayAlias ? 7 : maximum;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < minimum || end > allowedMaximum || end < start) {
      throw new RoutineInputError(sourceText("error.backend.routineCronValueInvalid", { field: label }));
    }
    for (let value = start; value <= end; value += step) result.add(sundayAlias && value === 7 ? 0 : value);
  }
  if (result.size === 0)
    throw new RoutineInputError(sourceText("error.backend.routineCronFieldEmpty", { field: label }));
  return { values: [...result].sort((left, right) => left - right), wildcard };
}

function parseTime(value: string): [number, number] {
  const [hour = Number.NaN, minute = Number.NaN] = value.split(":").map(Number);
  return [hour, minute];
}

function field(values: number[]): CronField {
  return { values: [...new Set(values)].sort((left, right) => left - right), wildcard: false };
}

function wildcardField(minimum: number, maximum: number): CronField {
  return { values: steppedValues(minimum, maximum, 1), wildcard: true };
}

function steppedValues(minimum: number, maximum: number, step: number): number[] {
  const result: number[] = [];
  for (let value = minimum; value <= maximum; value += step) result.push(value);
  return result;
}

function intervalMilliseconds(amount: number, unit: RoutineIntervalUnit): number {
  const unitMs = unit === "minutes" ? 60_000 : unit === "hours" ? 3_600_000 : 86_400_000;
  return amount * unitMs;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Walks a trigger forward over every occurrence the process slept through and returns the last one
 * plus the first still in the future. Missed occurrences are collapsed, never replayed: an app that
 * was closed for a week must not wake into a week of firings.
 */
export function collapseMissedOccurrences(
  schedule: RoutineSchedule,
  timezone: string,
  from: Date,
  now: Date,
): { scheduledFor: Date; nextRunAt: Date } {
  let scheduledFor = from;
  let nextRunAt = nextRoutineOccurrence(schedule, timezone, scheduledFor);
  while (nextRunAt.getTime() <= now.getTime()) {
    scheduledFor = nextRunAt;
    nextRunAt = nextRoutineOccurrence(schedule, timezone, scheduledFor);
  }
  return { scheduledFor, nextRunAt };
}

/** HXBot (v1.7.5, RTN-01): one coming run of a routine, as a preview shows it. */
export interface HxRoutineOccurrence {
  /** The instant, in UTC. */
  at: string;
  /** The local date and time in the routine zone, `YYYY-MM-DD HH:mm`. */
  local: string;
  /** The zone's offset from UTC at that instant, in minutes (Shanghai: 480). */
  offsetMinutes: number;
  /** The named time of day (`HH:mm`) that a spring gap moved to this instant, or null. */
  shiftedFrom: string | null;
  /** The local time occurs twice that day (the clock goes back); the routine runs at the first one only. */
  repeated: boolean;
}

/**
 * HXBot (v1.7.5, RTN-01): the next `count` runs after `after`, with the local time, the UTC time and
 * what a clock change did to each. Fewer when a one-time schedule has passed or has no more.
 */
export function hxRoutineUpcoming(
  schedule: RoutineSchedule,
  timezone: string,
  after: Date,
  count = 3,
): HxRoutineOccurrence[] {
  validateStoredRoutineSchedule(schedule, timezone);
  const result: HxRoutineOccurrence[] = [];
  let cursor = after;
  for (let index = 0; index < Math.min(Math.max(count, 0), 10); index += 1) {
    let next: Date;
    try {
      next = nextValidRoutineOccurrence(schedule, timezone, cursor);
    } catch (error) {
      if (error instanceof RoutineInputError) break;
      throw error;
    }
    const parts = zonedParts(next, timezone);
    const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    result.push({
      at: next.toISOString(),
      local: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`,
      offsetMinutes: Math.round((wall - Math.floor(next.getTime() / 60_000) * 60_000) / 60_000),
      shiftedFrom: hxShiftedFrom(schedule, timezone, parts),
      repeated: zonedDateTimeCandidates(parts, timezone).length > 1,
    });
    if (schedule.kind === "once") break;
    cursor = next;
  }
  return result;
}

/** The named time of day before `parts` on the same day that has no instant: the one a gap moved. */
function hxShiftedFrom(schedule: RoutineSchedule, timezone: string, parts: CalendarParts): string | null {
  if (schedule.kind === "interval") return null;
  const named: Array<[number, number]> = [];
  if (schedule.kind === "once") {
    named.push(parseTime(schedule.time));
  } else {
    const spec = scheduleCronSpec(schedule);
    if (!spec.hxWallClock) return null;
    for (const hour of spec.hour.values) {
      for (const minute of spec.minute.values) {
        if (!spec.exactTimes || spec.exactTimes.has(`${hour}:${minute}`)) named.push([hour, minute]);
      }
    }
  }
  if (named.some(([hour, minute]) => hour === parts.hour && minute === parts.minute)) return null;
  const now = parts.hour * 60 + parts.minute;
  let moved: [number, number] | null = null;
  for (const [hour, minute] of named) {
    const at = hour * 60 + minute;
    if (at >= now || now - at > MAX_GAP_MINUTES) continue;
    if (zonedDateTimeCandidates({ ...parts, hour, minute }, timezone).length > 0) continue;
    if (!moved || at > moved[0] * 60 + moved[1]) moved = [hour, minute];
  }
  return moved ? `${pad2(moved[0])}:${pad2(moved[1])}` : null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
