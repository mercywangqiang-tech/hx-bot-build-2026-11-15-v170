// HXBot 并发（一）：团队不设上限的守护（v1.7.1，CONC-10）。
//
// A team has no limit on members, time or handoffs. These guards watch whether it makes progress:
// G1 no progress in 30 minutes of real work; G2 a loop (the same work changes hands 3 times, or one
// member gets nearly the same work 3 times); G3 spread (in the last 20 handoffs, 3 times as many new
// pieces of work as finished ones, or work more than 4 levels deep); G4 the same work fails twice
// (in service.ts); G5 spend reminders; G6 idle member threads (in the ledger); G7 the limits the user
// named; G8 24 hours of real work; G9 10 spend reminders with no answer.
//
// Each one goes in four steps: the code triggers, the code checks again, the referee (v1.7.4) and
// then the user. A pause only starts no new work; the work that runs finishes, and the user is asked:
// continue, wrap up or stop. These are pure rules; service.ts keeps the state and acts.

const HX_GUARD_PROGRESS_MS = 30 * 60_000;
const HX_GUARD_FUSE_MS = 24 * 60 * 60_000;
const HX_GUARD_LOOP_COUNT = 3;
const HX_GUARD_SAME_GOAL = 0.8;
const HX_GUARD_SPREAD_WINDOW = 20;
const HX_GUARD_SPREAD_RATIO = 3;
const HX_GUARD_DEPTH = 4;
const HX_GUARD_UNANSWERED = 10;
/** A tick of real work counts at most this long: a longer gap is sleep. */
const HX_GUARD_TICK_MAX_MS = 30_000;
export const HX_SPEND_GAP_MS = 15 * 60_000;
/** v1.7.5 (CONC-16): the counts and window of G2 and G3, for the checks that come sooner. */
export const HX_GUARD_COUNTS = { loop: HX_GUARD_LOOP_COUNT, spread: HX_GUARD_SPREAD_WINDOW } as const;
/** Pay as you go: a reminder at about each ¥20. */
const HX_SPEND_API_YUAN = 20;
/** A plan: a reminder at 25, 50 and 80 % of the period. */
const HX_SPEND_PLAN_MARKS = [25, 50, 80] as const;
/** An unknown price: a reminder at each 5 million tokens that were not cached. */
const HX_SPEND_TOKENS = 5_000_000;
/** US dollars to yuan for the reminders; the reminder says "about". */
export const HX_USD_TO_YUAN = 7.2;

export type HxGuardId = "G1" | "G2" | "G3" | "G4" | "G5" | "G7" | "G8" | "G9";

export type HxBilling = "api" | "plan" | "local" | "unknown";

/** The state of the guards of one team, kept in its record. Every field may be missing in an older record. */
export interface HxTeamGuardState {
  /** Real work so far (a turn of the team runs), in ms. G8. */
  activeMs: number;
  /** Real work since the last progress, in ms. G1. */
  sinceProgressMs: number;
  lastTickAt: number | null;
  /** The shared folder at the last progress. */
  folderHash: string | null;
  /** G2: each piece of work, how often it changed hands, and the folder and open items at the last change. */
  moves: Record<string, { count: number; folderHash: string | null; open: number }>;
  /** G2: the goals that each member got lately. */
  received: Record<string, string[]>;
  /** G3: the last handoffs: "open" for a new piece of work, "done" for a finished one. */
  handoffs: Array<"open" | "done">;
  /** G3: the lead was told to bring the work together. */
  spreadHinted: boolean;
  /** G5. */
  spend: {
    remindedAt: number | null;
    /** The yuan at the last API reminder. */
    yuan: number;
    /** The plan marks already passed. */
    marks: number[];
    /** The tokens at the last unknown-price reminder. */
    tokens: number;
    /** Reminders since the user last spoke. G9. */
    unanswered: number;
  };
  /** Why the team waits for the user, or null. v1.7.4 (CONC-11): with the judge's view when one answered. */
  paused: {
    guard: HxGuardId;
    at: string;
    reason: string;
    view?: {
      verdict: "continue" | "remind" | "ask";
      reason: string;
      /** v1.7.5 (CONC-16): the model that judged, for the pass list. */
      model?: { provider: string; model: string };
    };
  } | null;
  /**
   * v1.7.4 (CONC-11): when the judge was called (the last hour counts), and the causes the lead was
   * reminded of. v1.7.5 (CONC-16): how often each cause went on without asking, and the last time.
   */
  judge?: {
    times: number[];
    reminded: string[];
    passes?: Partial<Record<"G1" | "G2" | "G3", number>>;
    /** `open`: its line with "Wrap up" and "Stop" is on the card, until the next pause or answer. */
    lastPass?: { cause: "G1" | "G2" | "G3"; reason: string; at: string; open?: boolean };
  };
  /** The user asked to wrap up: no new work, the lead finishes. */
  wrapUp: boolean;
}

export function hxGuardState(previous?: Partial<HxTeamGuardState>): HxTeamGuardState {
  return {
    activeMs: previous?.activeMs ?? 0,
    sinceProgressMs: previous?.sinceProgressMs ?? 0,
    lastTickAt: previous?.lastTickAt ?? null,
    folderHash: previous?.folderHash ?? null,
    moves: previous?.moves ?? {},
    received: previous?.received ?? {},
    handoffs: previous?.handoffs ?? [],
    spreadHinted: previous?.spreadHinted ?? false,
    spend: {
      remindedAt: previous?.spend?.remindedAt ?? null,
      yuan: previous?.spend?.yuan ?? 0,
      marks: previous?.spend?.marks ?? [],
      tokens: previous?.spend?.tokens ?? 0,
      unanswered: previous?.spend?.unanswered ?? 0,
    },
    paused: previous?.paused ?? null,
    judge: {
      times: previous?.judge?.times ?? [],
      reminded: previous?.judge?.reminded ?? [],
      ...(previous?.judge?.passes ? { passes: previous.judge.passes } : {}),
      ...(previous?.judge?.lastPass ? { lastPass: previous.judge.lastPass } : {}),
    },
    wrapUp: previous?.wrapUp ?? false,
  };
}

/** The three-letter pieces of a text, for "nearly the same goal". */
function trigrams(text: string): Set<string> {
  // Punctuation and spaces do not make two goals different.
  const plain = text.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
  const pieces = new Set<string>();
  const chars = [...plain];
  if (chars.length < 3) {
    if (plain) pieces.add(plain);
    return pieces;
  }
  for (let index = 0; index + 3 <= chars.length; index += 1) pieces.add(chars.slice(index, index + 3).join(""));
  return pieces;
}

/** How much two goals overlap: the shared three-letter pieces over all of them (0 to 1). */
export function hxGoalOverlap(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const piece of a) if (b.has(piece)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * G2, a change of hands. Returns true when the same work changed hands 3 times with no sign of
 * rework: the shared folder or the open items of its form changed between two changes, which resets
 * the count (the code check).
 */
export function hxLoopMove(
  state: HxTeamGuardState,
  taskId: string,
  folderHash: string | null,
  open: number,
  times: number = HX_GUARD_LOOP_COUNT,
): boolean {
  const previous = state.moves[taskId];
  if (previous && (previous.folderHash !== folderHash || open < previous.open)) {
    state.moves[taskId] = { count: 1, folderHash, open };
    return false;
  }
  const count = (previous?.count ?? 0) + 1;
  state.moves[taskId] = { count, folderHash, open };
  return count >= times;
}

/** G2, a new piece of work for a member. True when it got nearly the same goal 3 times. */
export function hxLoopReceive(
  state: HxTeamGuardState,
  memberId: string,
  goal: string,
  times: number = HX_GUARD_LOOP_COUNT,
): boolean {
  const list = [...(state.received[memberId] ?? []), goal].slice(-5);
  state.received[memberId] = list;
  return list.filter((item) => hxGoalOverlap(item, goal) >= HX_GUARD_SAME_GOAL).length >= times;
}

/** G3: a handoff. True when the last 20 open 3 times as many pieces of work as they finish, or work is too deep. */
export function hxSpread(
  state: HxTeamGuardState,
  event: "open" | "done",
  depth: number,
  window: number = HX_GUARD_SPREAD_WINDOW,
): boolean {
  state.handoffs = [...state.handoffs, event].slice(-HX_GUARD_SPREAD_WINDOW);
  if (depth > HX_GUARD_DEPTH) return true;
  if (state.handoffs.length < window) return false;
  // v1.7.5 (CONC-16): after the judge let the team go on, the next check looks at fewer handoffs.
  const recent = state.handoffs.slice(-window);
  const openedRecent = recent.filter((item) => item === "open").length;
  if (window < HX_GUARD_SPREAD_WINDOW)
    return openedRecent >= HX_GUARD_SPREAD_RATIO * Math.max(1, recent.length - openedRecent);
  const opened = state.handoffs.filter((item) => item === "open").length;
  const done = state.handoffs.length - opened;
  return opened >= HX_GUARD_SPREAD_RATIO * Math.max(1, done);
}

/** The time of real work, G1 and G8. Returns the guard that triggers, if any. */
export function hxWorkTick(
  state: HxTeamGuardState,
  now: number,
  working: boolean,
  progressMs: number = HX_GUARD_PROGRESS_MS,
): "G1" | "G8" | null {
  const last = state.lastTickAt;
  state.lastTickAt = now;
  if (last === null || !working) return null;
  const elapsed = Math.min(Math.max(0, now - last), HX_GUARD_TICK_MAX_MS);
  state.activeMs += elapsed;
  state.sinceProgressMs += elapsed;
  if (state.activeMs >= HX_GUARD_FUSE_MS) return "G8";
  if (state.sinceProgressMs >= progressMs) return "G1";
  return null;
}

/** Progress: a piece of work done, a file changed, or a step of the plan moved. */
export function hxProgress(state: HxTeamGuardState, folderHash: string | null): void {
  state.sinceProgressMs = 0;
  state.folderHash = folderHash;
}

export interface HxSpendReading {
  billing: HxBilling;
  /** Pay as you go: the yuan so far, or null when unknown. */
  yuan: number | null;
  /** A plan: the used part of the period in percent, or null. */
  percent: number | null;
  /** The tokens that were not cached, so far. */
  tokens: number;
}

export type HxSpendReminder =
  | { kind: "api"; yuan: number }
  | { kind: "plan"; percent: number }
  | { kind: "tokens"; millions: number };

/** G5: the reminder due now, or null. At most one in 15 minutes; a local model gets none. */
export function hxSpendDue(state: HxTeamGuardState, reading: HxSpendReading, now: number): HxSpendReminder | null {
  const spend = state.spend;
  if (reading.billing === "local") return null;
  if (spend.remindedAt !== null && now - spend.remindedAt < HX_SPEND_GAP_MS) return null;
  let due: HxSpendReminder | null = null;
  if (reading.billing === "api" && reading.yuan !== null) {
    if (reading.yuan - spend.yuan >= HX_SPEND_API_YUAN) {
      due = { kind: "api", yuan: Math.round(reading.yuan) };
      spend.yuan = Math.floor(reading.yuan / HX_SPEND_API_YUAN) * HX_SPEND_API_YUAN;
    }
  } else if (reading.billing === "plan" && reading.percent !== null) {
    const passed = HX_SPEND_PLAN_MARKS.filter(
      (mark) => reading.percent !== null && reading.percent >= mark && !spend.marks.includes(mark),
    );
    const highest = passed.at(-1);
    if (highest !== undefined) {
      spend.marks = [...spend.marks, ...passed];
      due = { kind: "plan", percent: highest };
    }
  } else if (reading.tokens - spend.tokens >= HX_SPEND_TOKENS) {
    due = { kind: "tokens", millions: Math.round(reading.tokens / 1_000_000) };
    spend.tokens = Math.floor(reading.tokens / HX_SPEND_TOKENS) * HX_SPEND_TOKENS;
  }
  if (!due) return null;
  spend.remindedAt = now;
  spend.unanswered += 1;
  return due;
}

/** G9: true when the reminders since the user last spoke reached 10, unless the user said not to ask. */
export function hxUnanswered(state: HxTeamGuardState, noAsk: boolean): boolean {
  return !noAsk && state.spend.unanswered >= HX_GUARD_UNANSWERED;
}

/** The depth of a piece of work: how many parents it has. */
export function hxDepth(taskId: string, parents: ReadonlyMap<string, string | null>) {
  let depth = 0;
  let current = parents.get(taskId) ?? null;
  const seen = new Set<string>();
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = parents.get(current) ?? null;
  }
  return depth;
}
