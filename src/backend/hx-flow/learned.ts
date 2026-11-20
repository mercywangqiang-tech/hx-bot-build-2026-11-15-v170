// HXBot (v1.7.5, CONC-13): the reminder of a team with no progress (G1) and the pause before HXBot goes on
// with your computer (CONC-06) learn from what you choose. No model: fixed rules, kept on this computer.
//
// G1, 30 minutes by default:
// - "Continue" on a G1 pause: that team's next reminder comes after twice the time.
// - "Wrap up" or "Stop": the default of that kind of work (hx-auto-model/classify.ts) becomes 0.75 of it.
// - Always from 15 minutes to 2 hours.
// The pause before HXBot goes on with a foreground step, 5 seconds by default:
// - You use the computer again within 3 seconds after HXBot went on: twice in a day, 2 seconds more.
// - A week with no such time: 1 second less.
// - Always from 3 to 15 seconds.
// Each change is said in the chat ("As you chose last time, the next reminder is in 60 minutes").
// The values are in `learned-settings.json` in the HXBot data folder ({ version: 1, ... }); a file that
// cannot be read or written keeps the defaults, and a later version may add fields: they are kept.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { sourceText } from "@hxbot/i18n/source";
import { hxAppDataFolder } from "../hx-access/hub";

const FILE = "learned-settings.json";
const VERSION = 1;

export const HX_PROGRESS_DEFAULT_MS = 30 * 60_000;
export const HX_PROGRESS_MIN_MS = 15 * 60_000;
export const HX_PROGRESS_MAX_MS = 120 * 60_000;
const PROGRESS_CONTINUE = 2;
const PROGRESS_STOP = 0.75;

export const HX_YIELD_DEFAULT_MS = 5_000;
export const HX_YIELD_MIN_MS = 3_000;
export const HX_YIELD_MAX_MS = 15_000;
const YIELD_UP_MS = 2_000;
const YIELD_DOWN_MS = 1_000;
const YIELD_TIMES = 2;
const DAY_MS = 24 * 3_600_000;
/** The most teams with an own time; the oldest go first (a team that ended is forgotten anyway). */
const TEAMS_KEPT = 200;
const WEEK_MS = 7 * DAY_MS;

export type HxGuardChoice = "continue" | "finish" | "stop";

/** What the settings page shows. */
export interface HxLearnedView {
  progressDefaultMs: number;
  /** By kind of work, only those that changed. */
  progressByWork: Record<string, number>;
  yieldMs: number;
  limits: { progress: [number, number]; yield: [number, number] };
}

/** A change, for the line in the chat. */
export type HxLearnedChange =
  | { what: "team-progress"; beforeMs: number; afterMs: number }
  | { what: "work-progress"; work: string; beforeMs: number; afterMs: number }
  | { what: "yield"; beforeMs: number; afterMs: number };

interface State {
  progress: Record<string, number>;
  /** The own G1 time of each running team that got "continue", by its id. */
  teams: Record<string, number>;
  yieldMs: number;
  /** When HXBot went on too early, in the last day. */
  yieldEvents: number[];
  /** When the pause last changed (or was checked for a quiet week). */
  yieldSince: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function defaults(now: number): State {
  return { progress: {}, teams: {}, yieldMs: HX_YIELD_DEFAULT_MS, yieldEvents: [], yieldSince: now };
}

function readState(data: unknown, now: number): State {
  const state = defaults(now);
  if (!isDynamicRecord(data)) return state;
  if (isDynamicRecord(data.progress))
    for (const [work, ms] of Object.entries(data.progress))
      if (typeof ms === "number" && Number.isFinite(ms))
        state.progress[work] = clamp(ms, HX_PROGRESS_MIN_MS, HX_PROGRESS_MAX_MS);
  if (isDynamicRecord(data.teams))
    for (const [team, ms] of Object.entries(data.teams).slice(-TEAMS_KEPT))
      if (typeof ms === "number" && Number.isFinite(ms))
        state.teams[team] = clamp(ms, HX_PROGRESS_MIN_MS, HX_PROGRESS_MAX_MS);
  if (typeof data.yieldMs === "number" && Number.isFinite(data.yieldMs))
    state.yieldMs = clamp(data.yieldMs, HX_YIELD_MIN_MS, HX_YIELD_MAX_MS);
  if (Array.isArray(data.yieldEvents))
    state.yieldEvents = data.yieldEvents.filter(
      (at): at is number => typeof at === "number" && Number.isFinite(at) && at <= now && now - at < DAY_MS,
    );
  if (typeof data.yieldSince === "number" && Number.isFinite(data.yieldSince) && data.yieldSince <= now)
    state.yieldSince = data.yieldSince;
  return state;
}

/** The file as JSON; null when there is none or it is damaged, and the defaults hold. */
function readFile(file: string) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export class HxLearnedSettings {
  readonly #folder: () => string | null;
  readonly #now: () => number;
  #state: State | null = null;
  /** The fields of a later version, as JSON, written back as they were. */
  #later = "{}";

  constructor(folder: () => string | null, now: () => number = Date.now) {
    this.#folder = folder;
    this.#now = now;
  }

  #load(): State {
    if (this.#state) return this.#state;
    const now = this.#now();
    const folder = this.#folder();
    const data = folder ? readFile(join(folder, FILE)) : null;
    this.#later = isDynamicRecord(data)
      ? JSON.stringify(
          Object.fromEntries(
            Object.entries(data).filter(
              ([key]) => !["version", "progress", "teams", "yieldMs", "yieldEvents", "yieldSince"].includes(key),
            ),
          ),
        )
      : "{}";
    this.#state = readState(data, now);
    return this.#state;
  }

  #save(state: State): void {
    this.#state = state;
    const folder = this.#folder();
    if (!folder) return;
    try {
      mkdirSync(folder, { recursive: true });
      const file = join(folder, FILE);
      const next = `${file}.${process.pid}.tmp`;
      const later = JSON.parse(this.#later);
      const kept = isDynamicRecord(later) ? later : {};
      writeFileSync(next, `${JSON.stringify({ ...kept, version: VERSION, ...state })}\n`);
      renameSync(next, file);
    } catch {
      // The values hold for this run of HXBot.
    }
  }

  /** The G1 time of a team: its own when it has one, else the default of its kind of work. */
  progressMs(work: string, teamId?: string | undefined): number {
    const state = this.#load();
    const own = teamId === undefined ? undefined : state.teams[teamId];
    return own ?? state.progress[work] ?? HX_PROGRESS_DEFAULT_MS;
  }

  /**
   * Your answer to a G1 pause. "Continue" gives the team its own time, twice what it had; "wrap up"
   * and "stop" make the default of that kind of work 0.75 of it. Returns the change, or null when a
   * limit kept the value.
   */
  choose(input: { work: string; teamId: string; choice: HxGuardChoice }): HxLearnedChange | null {
    const state = this.#load();
    if (input.choice === "continue") {
      const before = this.progressMs(input.work, input.teamId);
      const after = clamp(before * PROGRESS_CONTINUE, HX_PROGRESS_MIN_MS, HX_PROGRESS_MAX_MS);
      const { [input.teamId]: _old, ...others } = state.teams;
      const kept = Object.fromEntries(Object.entries(others).slice(-(TEAMS_KEPT - 1)));
      this.#save({ ...state, teams: { ...kept, [input.teamId]: after } });
      return after === before ? null : { what: "team-progress", beforeMs: before, afterMs: after };
    }
    const was = state.progress[input.work] ?? HX_PROGRESS_DEFAULT_MS;
    const after = clamp(was * PROGRESS_STOP, HX_PROGRESS_MIN_MS, HX_PROGRESS_MAX_MS);
    if (after !== was) this.#save({ ...state, progress: { ...state.progress, [input.work]: after } });
    return after === was ? null : { what: "work-progress", work: input.work, beforeMs: was, afterMs: after };
  }

  /** A team ended: its own time goes. */
  forgetTeam(teamId: string): void {
    const state = this.#load();
    if (!(teamId in state.teams)) return;
    const { [teamId]: _old, ...teams } = state.teams;
    this.#save({ ...state, teams });
  }

  /** The pause before HXBot goes on with a foreground step; a quiet week takes a second off first. */
  yieldMs(): number {
    const state = this.#load();
    const now = this.#now();
    if (now - state.yieldSince < WEEK_MS) return state.yieldMs;
    const weeks = Math.floor((now - state.yieldSince) / WEEK_MS);
    const quiet = state.yieldEvents.every((at) => now - at >= WEEK_MS);
    if (!quiet) return state.yieldMs;
    const after = clamp(state.yieldMs - weeks * YIELD_DOWN_MS, HX_YIELD_MIN_MS, HX_YIELD_MAX_MS);
    this.#save({ ...state, yieldMs: after, yieldSince: state.yieldSince + weeks * WEEK_MS });
    return after;
  }

  /** You used the computer again within 3 seconds after HXBot went on. Returns the change, if any. */
  wentOnTooEarly(): HxLearnedChange | null {
    const now = this.#now();
    const state = this.#load();
    const before = this.yieldMs();
    const events = [...state.yieldEvents.filter((at) => now - at < DAY_MS), now];
    if (events.length < YIELD_TIMES) {
      this.#save({ ...this.#load(), yieldEvents: events });
      return null;
    }
    const after = clamp(before + YIELD_UP_MS, HX_YIELD_MIN_MS, HX_YIELD_MAX_MS);
    this.#save({ ...this.#load(), yieldMs: after, yieldEvents: [], yieldSince: now });
    return after === before ? null : { what: "yield", beforeMs: before, afterMs: after };
  }

  /** Back to the defaults: 30 minutes for every kind of work and every team, 5 seconds. */
  reset(): HxLearnedView {
    this.#save(defaults(this.#now()));
    return this.view();
  }

  view(): HxLearnedView {
    const state = this.#load();
    return {
      progressDefaultMs: HX_PROGRESS_DEFAULT_MS,
      progressByWork: { ...state.progress },
      yieldMs: this.yieldMs(),
      limits: { progress: [HX_PROGRESS_MIN_MS, HX_PROGRESS_MAX_MS], yield: [HX_YIELD_MIN_MS, HX_YIELD_MAX_MS] },
    };
  }

  /** For a test: read the file again. */
  forget(): void {
    this.#state = null;
  }
}

/** The line in the chat that says a change. */
export function hxLearnedLine(change: HxLearnedChange): string {
  if (change.what === "yield")
    return sourceText("status.agent.hxLearned.yield", { seconds: Math.round(change.afterMs / 1000) });
  return sourceText(
    change.what === "team-progress" ? "status.agent.hxLearned.teamProgress" : "status.agent.hxLearned.workProgress",
    { minutes: Math.round(change.afterMs / 60_000) },
  );
}

/** The values of this computer, in the HXBot data folder. */
export const hxLearned = new HxLearnedSettings(hxAppDataFolder);
