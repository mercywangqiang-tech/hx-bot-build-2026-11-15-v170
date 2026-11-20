// HXBot (v1.7.5, CONC-16): the judge's automatic mode, which you turn on yourself on this computer.
//
// In the advisory mode of v1.7.4 the judge's view is one more line and you are always asked. Automatic
// mode for one cause (G1, G2 or G3): a judge that says "continue" lets the team go on without asking
// you; the chat gets one line with "Wrap up" and "Stop". It is offered on the team's card only when both
// hold: the judging model is on the pass list (it scored at least 90% on the labeled set,
// scripts/hx-judge-eval-e2e.ts), and on this computer the judge's view agreed with your choice the last
// 5 times in a row (hx-judge-agreement.jsonl). Then the card shows "From now on, do as the judge says
// in cases like this", and only your click turns it on.
//
// Back to advice by itself: twice the judge said continue and you stopped the team after. A team goes on
// at most twice for the same cause; each time, the next check comes after half the time (or count); the
// third time you are always asked. G8 and G9 never go to the judge.
//
// `hx-judge-auto.json` in the team records folder: { version: 1, causes: { G1: { auto, strikes, at } } }.
// A file that cannot be read keeps everything advisory; fields of a later version are kept.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import type { HxJudgeCause } from "./judge";

const FILE = "hx-judge-auto.json";
const PASS_FILE = "hx-judge-pass.json";
const AGREEMENT_FILE = "hx-judge-agreement.jsonl";
const VERSION = 1;

/** The views in a row that must agree with your choice before the automatic mode is offered. */
export const HX_JUDGE_STREAK = 5;
/** The most times one team goes on for the same cause without asking you. */
export const HX_JUDGE_PASSES = 2;
/** The stops after "continue" that send a cause back to advice. */
const HX_JUDGE_STRIKES = 2;
/** The score on the labeled set that puts a model on the pass list. */
const HX_JUDGE_PASS_SCORE = 0.9;

/**
 * The models that passed the labeled set (provider and model id). Empty until the set has run on real
 * models; `hx-judge-pass.json` beside the team records adds the results of a run on this computer.
 */
const HX_JUDGE_PASSED: ReadonlyArray<{ provider: string; model: string }> = [];

export interface HxJudgeModel {
  provider: string;
  model: string;
}

interface CauseState {
  auto: boolean;
  strikes: number;
  at: string | null;
}

function isCause(value: string): value is HxJudgeCause {
  return value === "G1" || value === "G2" || value === "G3";
}

function readJson(file: string) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export class HxJudgeAuto {
  readonly #folder: () => string | null;
  readonly #now: () => number;

  constructor(folder: () => string | null, now: () => number = Date.now) {
    this.#folder = folder;
    this.#now = now;
  }

  #read(): { causes: Record<HxJudgeCause, CauseState>; later: string } {
    const causes: Record<HxJudgeCause, CauseState> = {
      G1: { auto: false, strikes: 0, at: null },
      G2: { auto: false, strikes: 0, at: null },
      G3: { auto: false, strikes: 0, at: null },
    };
    const folder = this.#folder();
    const data = folder ? readJson(join(folder, FILE)) : null;
    if (isDynamicRecord(data) && isDynamicRecord(data.causes))
      for (const [cause, state] of Object.entries(data.causes)) {
        if (!isCause(cause) || !isDynamicRecord(state)) continue;
        causes[cause] = {
          auto: state.auto === true,
          strikes:
            typeof state.strikes === "number" && Number.isInteger(state.strikes) && state.strikes >= 0
              ? Math.min(state.strikes, HX_JUDGE_STRIKES)
              : 0,
          at: typeof state.at === "string" ? state.at : null,
        };
      }
    const later = isDynamicRecord(data)
      ? JSON.stringify(
          Object.fromEntries(Object.entries(data).filter(([key]) => key !== "version" && key !== "causes")),
        )
      : "{}";
    return { causes, later };
  }

  #write(causes: Record<HxJudgeCause, CauseState>, later: string): void {
    const folder = this.#folder();
    if (!folder) return;
    try {
      const file = join(folder, FILE);
      const next = `${file}.${process.pid}.tmp`;
      const kept = JSON.parse(later);
      writeFileSync(next, `${JSON.stringify({ ...(isDynamicRecord(kept) ? kept : {}), version: VERSION, causes })}\n`);
      renameSync(next, file);
    } catch {
      // The mode stays as it was on disk: advice is the safe side.
    }
  }

  /** Whether the judge decides "continue" for this cause on this computer. */
  auto(cause: HxJudgeCause): boolean {
    return this.#read().causes[cause].auto;
  }

  /** Whether a model is on the pass list: built in, or a run of the labeled set on this computer. */
  passed(model: HxJudgeModel | null): boolean {
    if (!model) return false;
    const same = (entry: HxJudgeModel) => entry.provider === model.provider && entry.model === model.model;
    if (HX_JUDGE_PASSED.some(same)) return true;
    const folder = this.#folder();
    const data = folder ? readJson(join(folder, PASS_FILE)) : null;
    if (!Array.isArray(data)) return false;
    return data.some(
      (entry) =>
        isDynamicRecord(entry) &&
        typeof entry.provider === "string" &&
        typeof entry.model === "string" &&
        typeof entry.score === "number" &&
        entry.score >= HX_JUDGE_PASS_SCORE &&
        same({ provider: entry.provider, model: entry.model }),
    );
  }

  /** How many of the last views agreed with your choice, in a row, on this computer. */
  streak() {
    const folder = this.#folder();
    if (!folder) return 0;
    let text = "";
    try {
      text = readFileSync(join(folder, AGREEMENT_FILE), "utf8");
    } catch {
      return 0;
    }
    const lines = text.trim().split("\n").slice(-50).reverse();
    let count = 0;
    for (const line of lines) {
      const entry = readLine(line);
      if (entry !== true) break;
      count += 1;
    }
    return count;
  }

  /** Whether the card offers the automatic mode for this cause: the model passed, and 5 agreements in a row. */
  offer(cause: HxJudgeCause, model: HxJudgeModel | null): boolean {
    return !this.auto(cause) && this.passed(model) && this.streak() >= HX_JUDGE_STREAK;
  }

  /** Your click on the card (on) or "ask me again" (off). */
  set(cause: HxJudgeCause, on: boolean): void {
    const { causes, later } = this.#read();
    causes[cause] = { auto: on, strikes: 0, at: new Date(this.#now()).toISOString() };
    this.#write(causes, later);
  }

  /** You stopped a team after the judge let it go on. Returns true when the cause went back to advice. */
  strike(cause: HxJudgeCause): boolean {
    const { causes, later } = this.#read();
    const state = causes[cause];
    if (!state.auto) return false;
    const strikes = state.strikes + 1;
    const back = strikes >= HX_JUDGE_STRIKES;
    causes[cause] = { auto: !back, strikes: back ? 0 : strikes, at: new Date(this.#now()).toISOString() };
    this.#write(causes, later);
    return back;
  }
}

/** Whether one line of the agreement record agrees; null for a line that is not one. */
function readLine(line: string): boolean | null {
  try {
    const entry = JSON.parse(line);
    return isDynamicRecord(entry) && typeof entry.agrees === "boolean" ? entry.agrees : null;
  } catch {
    return null;
  }
}

/** The next check after a pass: half the time or count each time it went on, never below `floor`. */
export function hxJudgeSooner(base: number, passes: number, floor: number): number {
  return Math.max(floor, Math.ceil(base * 0.5 ** Math.max(0, passes)));
}
