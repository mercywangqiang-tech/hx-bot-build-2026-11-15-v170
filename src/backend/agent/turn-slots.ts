import type { QueueDelivery } from "@hxbot/contracts/ipc";
import { type HxFlowCandidate, hxFlow } from "../hx-flow/ledger";
import { HxSlotPass } from "../hx-flow/slot-pass";

export interface TurnSlotsOptions {
  /** The most turns that run at the same time, or null for no limit. */
  limit(): number | null;
  /**
   * The key of each queue that runs one turn at a time: an agent's own chat, and each of its tasks.
   * A lane key sorts as its agent id does, so a tie in age goes the same way as before tasks.
   */
  lanes(): readonly string[];
  /** Whether the lane runs a turn, starts one, or compacts its context. Each one uses a slot. */
  isRunning(lane: string): boolean;
  /** Whether the lane has a delivery that could start now, if a slot were free. */
  isWaiting(lane: string): boolean;
  /** The delivery at the head of the lane's queue. */
  head(lane: string): QueueDelivery | null;
  /** HXBot (v1.7.1): the place of a lane's head in the HX-Flow order (src/backend/hx-flow). */
  rank?(lane: string, head: QueueDelivery): HxFlowCandidate;
}

/**
 * Owns the turn slot clause of the queue drain: on a hosted server only a fixed number of turns run
 * at the same time, and each task of an agent uses a slot of its own. When the slots are full, the
 * waiting lanes go by the head of their queue: a message from a person first, then routine runs and
 * teammate messages, and the oldest first in each group. A delivery that waits stays queued. It never imports the service.
 *
 * No slot waits on another slot: a teammate request ends the turn that sends it, and the answer
 * arrives as a new delivery.
 */
export class TurnSlots {
  readonly #options: TurnSlotsOptions;
  /** HXBot (v1.7.3): the reads of one pass over the waiting lanes (src/backend/hx-flow/slot-pass.ts). */
  readonly #pass = new HxSlotPass();

  constructor(options: TurnSlotsOptions) {
    this.#options = this.#pass.wrap(options);
  }

  /** HXBot (v1.7.3): checks several lanes in one pass, and reads each lane once in it. */
  batch<T>(body: () => T): T {
    return this.#pass.run(body);
  }

  /** HXBot (v1.7.3): a read of the scheduler kept for the length of a pass (`batch`). */
  memo<V>(): (key: string, read: () => V) => V {
    return this.#pass.memo<V>();
  }

  mayStart(lane: string): boolean {
    const limit = this.#options.limit();
    if (limit === null) return true;
    const lanes = this.#options.lanes();
    // HXBot (v1.7.1, BUG-CONC-01): each lane is asked once whether it runs. A check of a waiting lane
    // asked every lane two or three times; with 65 agents one pass held the main process 1.3 s.
    const running = lanes.filter((id) => this.#options.isRunning(id));
    const runs = new Set(running);
    const free = limit - running.length;
    if (free <= 0) return false;
    const head = this.#options.head(lane);
    if (!head) return true;
    // HXBot (v1.7.1, CONC-03): the HX-Flow order, and one place kept for a person.
    const rank = this.#options.rank;
    if (rank) {
      const waiting: HxFlowCandidate[] = [];
      for (const other of lanes) {
        if (other === lane || runs.has(other) || !this.#options.isWaiting(other)) continue;
        const otherHead = this.#options.head(other);
        if (otherHead) waiting.push(rank(other, otherHead));
      }
      return hxFlow.mayStart(rank(lane, head), waiting, running, limit);
    }
    let ahead = 0;
    for (const other of lanes) {
      if (other === lane || runs.has(other) || !this.#options.isWaiting(other)) continue;
      const otherHead = this.#options.head(other);
      if (otherHead && startsBefore(otherHead, other, head, lane)) ahead += 1;
    }
    return ahead < free;
  }
}

function startsBefore(left: QueueDelivery, leftLane: string, right: QueueDelivery, rightLane: string): boolean {
  const leftPerson = left.sender.kind === "user";
  const rightPerson = right.sender.kind === "user";
  if (leftPerson !== rightPerson) return leftPerson;
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt;
  return leftLane < rightLane;
}
