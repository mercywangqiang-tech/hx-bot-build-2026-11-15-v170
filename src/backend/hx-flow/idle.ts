// HXBot 并发（一）：G6，内存不够且有人在等时，关掉闲得最久的成员线程（v1.7.1，CONC-10）。
//
// The idle pools of the providers close every idle thread when memory is low. During a G6 release the
// ledger sets this policy: a pool closes only threads idle for at least 4 minutes, the longest idle
// first, and at most one in all. A closed thread opens again from its session at its next turn.

export const HX_IDLE_MIN_MS = 4 * 60_000;
/** The policy holds this long: the pools pick their threads at once when the release runs. */
const POLICY_MS = 2_000;

let policy: { minIdleMs: number; left: number; until: number } | null = null;

/** Runs `release` with the G6 policy. */
export function hxWithIdlePolicy(minIdleMs: number, most: number, release: () => void): void {
  policy = { minIdleMs, left: most, until: Date.now() + POLICY_MS };
  release();
}

/**
 * The threads that a pool may close, from the ones it would close (the longest idle first). With no
 * policy it closes them all, as before.
 */
export function hxIdleTake<T>(threads: readonly T[], idleSince: (thread: T) => number, now = Date.now()): T[] {
  if (!policy || now > policy.until) {
    policy = null;
    return [...threads];
  }
  const taken: T[] = [];
  for (const thread of threads) {
    if (policy.left <= 0) break;
    const since = idleSince(thread);
    if (since <= 0 || now - since < policy.minIdleMs) continue;
    taken.push(thread);
    policy.left -= 1;
  }
  return taken;
}
