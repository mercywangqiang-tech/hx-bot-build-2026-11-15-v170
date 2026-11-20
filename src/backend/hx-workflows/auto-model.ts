/**
 * HXBot (v1.7.5, RTN-11): an agent step of a workflow whose model is "auto" (`HX_WORKFLOW_AUTO_MODEL`).
 *
 * The step's work goes to its agent as a routine handoff. Before the handoff is sent, the step is noted
 * here by its run, its workflow and its text, the three things the queued delivery carries. When that
 * delivery is next in the agent's queue, the auto router (hx-auto-model) chooses its model by the work,
 * as it does for an agent on auto, even when the agent itself is not on auto; after that turn the agent
 * goes back to its own model (router.ts, `turnEnded`).
 *
 * The note is kept in this process only: a handoff that waits across a restart runs with the agent's own
 * model, which is what the step would have had before v1.7.5.
 */

import { createHash } from "node:crypto";

/** How long a note waits for its delivery: a queue that waits longer has its model chosen again. */
const KEEP_MS = 24 * 3_600_000;
/** The most notes at once; the oldest go first. */
const MOST = 500;

/** What a queued delivery says of where it came from. */
export interface HxQueuedSender {
  kind: string;
  routineId?: string;
  runId?: string;
}

function key(runId: string, workflowId: string, text: string): string {
  return createHash("sha256").update(`${runId}\u0000${workflowId}\u0000${text}`).digest("hex");
}

class HxWorkflowAutoSteps {
  readonly #wanted = new Map<string, number>();

  /** Notes an agent step on "auto" before its handoff is sent. */
  want(input: { runId: string; workflowId: string; text: string }, now = Date.now()): void {
    this.#prune(now);
    const id = key(input.runId, input.workflowId, input.text);
    this.#wanted.delete(id);
    this.#wanted.set(id, now);
    while (this.#wanted.size > MOST) {
      const oldest = this.#wanted.keys().next().value;
      if (oldest === undefined) break;
      this.#wanted.delete(oldest);
    }
  }

  /** Whether a queued delivery is the work of a step on "auto". It stays noted until `done`. */
  wanted(delivery: { sender: HxQueuedSender; text: string }, now = Date.now()): boolean {
    this.#prune(now);
    const { sender } = delivery;
    if (sender.kind !== "routine" || !sender.runId || !sender.routineId) return false;
    return this.#wanted.has(key(sender.runId, sender.routineId, delivery.text));
  }

  /** The router chose the model of this delivery: the note is spent. */
  done(delivery: { sender: HxQueuedSender; text: string }): void {
    const { sender } = delivery;
    if (sender.kind !== "routine" || !sender.runId || !sender.routineId) return;
    this.#wanted.delete(key(sender.runId, sender.routineId, delivery.text));
  }

  get size(): number {
    return this.#wanted.size;
  }

  #prune(now: number): void {
    for (const [id, at] of this.#wanted) {
      if (now - at <= KEEP_MS) break;
      this.#wanted.delete(id);
    }
  }
}

export const hxWorkflowAutoSteps = new HxWorkflowAutoSteps();
