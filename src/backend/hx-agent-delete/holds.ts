// HXBot (v1.7.5 fix): the agent service's side of a delete that waits for its undo time (pending.ts).
//
// - `hold` (after the agent service checked that the delete would take the agent now: no turn, no
//   compaction, no unfinished delivery, so a refusal shows at once and not after the undo time): the
//   waiting delete is written to disk first; then no new delivery reaches the agent, no routine of it runs, and every agent list
//   (this computer, the web client, the phones) leaves it out.
// - `release` (Undo): the entry goes, deliveries and routines go on, the agent is in the lists again.
// - `deleted`: the delete removed the agent; its entry goes. `failed`: the delete did not remove it; the
//   agent is in the lists again and the window says why.
// - `restore` at start: the agents of the waiting deletes that a quit, a crash or a killed process left
//   stay out of the lists and get no delivery, until `completeAll` removes them.
//
// Never imports the agent service.

import { sourceText } from "@hxbot/i18n/source";
import { HxPendingDeletes } from "./pending";

export interface HxAgentDeleteHoldHooks {
  /** The agent is in the store now. */
  exists(agentId: string): boolean;
  /** No delivery reaches the agent until the returned function runs. */
  blockDeliveries(agentId: string): () => void;
  /** The agent's queue and routines go on (after an undo or a failed delete). */
  resume(agentId: string): void;
  /** Sends `agents-changed` with the list that leaves out the held agents. */
  emitRoster(): void;
  now?: () => number;
  warn?: (message: string, detail?: Record<string, string>) => void;
}

export class HxAgentDeleteHolds {
  readonly #pending: HxPendingDeletes;
  readonly #hooks: HxAgentDeleteHoldHooks;
  readonly #unblock = new Map<string, () => void>();

  constructor(pending: HxPendingDeletes, hooks: HxAgentDeleteHoldHooks) {
    this.#pending = pending;
    this.#hooks = hooks;
  }

  get pending(): HxPendingDeletes {
    return this.#pending;
  }

  /** The agents of this computer whose delete waits. */
  held(): ReadonlySet<string> {
    return this.#pending.localIds();
  }

  isHeld(agentId: string): boolean {
    return this.#pending.has(agentId, null);
  }

  /** The list without the held agents. */
  visible<T extends { readonly id: string }>(agents: T[]): T[] {
    const held = this.held();
    return held.size === 0 ? agents : agents.filter((agent) => !held.has(agent.id));
  }

  /** Throws `error.agent.gone` or a write error. */
  hold(agentId: string): void {
    if (!this.#hooks.exists(agentId)) throw new Error(sourceText("error.agent.gone"));
    if (this.isHeld(agentId)) return;
    this.#pending.add(agentId, null, (this.#hooks.now ?? Date.now)());
    this.#block(agentId);
    this.#hooks.emitRoster();
  }

  /** Undo. Throws `error.agent.gone` when the agent was deleted already, or a write error. */
  release(agentId: string): void {
    if (!this.isHeld(agentId)) {
      if (this.#hooks.exists(agentId)) return;
      throw new Error(sourceText("error.agent.gone"));
    }
    this.#pending.remove(agentId, null);
    this.#unblockNow(agentId);
    this.#hooks.resume(agentId);
    this.#hooks.emitRoster();
  }

  /** The delete removed the agent. A failed write leaves the entry; the next start drops it (no agent). */
  deleted(agentId: string): void {
    this.#unblock.delete(agentId);
    try {
      this.#pending.remove(agentId, null);
    } catch (error) {
      this.#warn("The waiting delete of a removed agent could not be cleared.", error);
    }
  }

  /** The delete did not remove the agent: it shows again, everywhere. */
  failed(agentId: string): void {
    if (!this.isHeld(agentId)) return;
    try {
      this.#pending.remove(agentId, null);
    } catch (error) {
      // The entry stays: the agent stays out of the lists, and the next start tries the delete again.
      this.#warn("A failed delete could not be undone on disk.", error);
      return;
    }
    this.#unblockNow(agentId);
    if (this.#hooks.exists(agentId)) this.#hooks.resume(agentId);
    this.#hooks.emitRoster();
  }

  /** At start, after the store: waiting deletes of agents that are gone are dropped; the rest are held. */
  restore(): void {
    this.#pending.load();
    for (const agentId of this.held()) {
      if (!this.#hooks.exists(agentId)) {
        this.deleted(agentId);
        continue;
      }
      this.#block(agentId);
    }
  }

  #block(agentId: string): void {
    if (this.#unblock.has(agentId)) return;
    this.#unblock.set(agentId, this.#hooks.blockDeliveries(agentId));
  }

  #unblockNow(agentId: string): void {
    const unblock = this.#unblock.get(agentId);
    this.#unblock.delete(agentId);
    unblock?.();
  }

  #warn(message: string, error: unknown): void {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "unknown";
    this.#hooks.warn?.(message, { code });
  }
}

/** The holds of one agent service, with the file beside its database (`databasePath`; none for a database in memory). */
export function hxAgentDeleteHolds(databasePath: () => string, hooks: HxAgentDeleteHoldHooks): HxAgentDeleteHolds {
  return new HxAgentDeleteHolds(new HxPendingDeletes(() => HxPendingDeletes.folderOf(databasePath())), hooks);
}
