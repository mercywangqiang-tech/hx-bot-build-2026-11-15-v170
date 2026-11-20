// HXBot (v1.7.5 fix): who ends an agent delete that waits for its undo time, in the main process.
//
// The window holds the delete when the person deletes (the host keeps it on disk and hides the agent
// everywhere, src/backend/hx-agent-delete), shows the toast with Undo for 8 seconds, then asks for the
// delete. Before this fix only the window counted those seconds: a quit, a closed or reloaded window, or a
// window that stayed hidden never sent the delete. Now the delete also ends:
// - when the window that held it goes away (closed, reloaded, crashed): nobody can undo it any more;
// - at the latest `HX_DELETE_HOLD_LIMIT_MS` after it was held;
// - on the next start, for a delete that a quit or a killed process left (`start`).
// One delete of an agent runs once: a second request waits for the first. An agent of a joined server
// cannot be hidden on that server (its released routes are fixed), so this computer keeps the waiting
// delete and sends it again after a start, until the server says the agent is gone.

import { LOCAL_SERVER_ID } from "@hxbot/contracts/ipc";
import { createHxBotLogger } from "@hxbot/logging";
import type { Effect } from "effect";
import type { AgentService } from "../backend/agent-service";
import { runCauseEffect } from "../backend/effect-boundary";
import type { SidebarLayoutStore } from "../backend/sidebar-layout-store";

const logger = createHxBotLogger("hx-agent-delete");

/** The latest a held delete ends while its window still lives (the undo time pauses while the window is hidden). */
const HX_DELETE_HOLD_LIMIT_MS = 30 * 60_000;
/** The waits between tries of a delete that failed on its own (a joined server offline, a busy file). */
const RETRY_MS = [5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000] as const;
/**
 * A closed window waits this long before its held deletes end: closing the last window on Windows and
 * Linux quits the app, and the quit stops this first, so the next start ends them instead of the teardown.
 */
const WINDOW_GONE_WAIT_MS = 3_000;

/** The window that held a delete: its web contents (an `EventEmitter` in a test). */
export interface HxDeleteWindow {
  readonly id: number;
  once(event: "destroyed", listener: () => void): unknown;
  on(event: "render-process-gone", listener: () => void): unknown;
  on(
    event: "did-start-navigation",
    listener: (details: { readonly isMainFrame: boolean; readonly isSameDocument: boolean }) => void,
  ): unknown;
}

/** The waits, which a test shortens. */
export interface HxAgentDeleteTimes {
  limitMs: number;
  windowGoneMs: number;
  retryMs: readonly number[];
}

type Failing<A> = Effect.Effect<A, { readonly cause: unknown }>;

/** What this needs of the agent service. */
export type HxDeleteService = Pick<
  AgentService,
  "holdAgentDelete" | "releaseAgentDelete" | "deleteAgent" | "hxDeleteHeld" | "hxPendingDeletes"
>;

/** What this needs of the joined servers (the IPC handlers give it from the remote server manager). */
export interface HxDeleteRemote {
  /** The servers that this computer joined. */
  list(): readonly { readonly id: string }[];
  /** `DELETE /v1/agents/:id` on that server. */
  deleteAgent(serverId: string, agentId: string): Failing<void>;
  /** The ids of that server's agents. */
  agentIds(serverId: string): Failing<readonly string[]>;
}

export interface HxAgentDeleteDeps {
  service: HxDeleteService;
  sidebarLayout: Pick<SidebarLayoutStore, "removeAgent">;
  remote: HxDeleteRemote;
}

const keyOf = (serverId: string | null, agentId: string) => `${serverId ?? LOCAL_SERVER_ID}\u0000${agentId}`;
const scopeOf = (serverId: string): string | null => (serverId === LOCAL_SERVER_ID ? null : serverId);

export class HxAgentDeletes {
  #deps: HxAgentDeleteDeps | null = null;
  readonly #running = new Map<string, Promise<void>>();
  readonly #limits = new Map<string, ReturnType<typeof setTimeout>>();
  /** The held deletes of each window, by its web contents id. */
  readonly #byWindow = new Map<number, Set<string>>();
  readonly #watched = new Set<number>();
  readonly #retries = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #times: HxAgentDeleteTimes;
  #stopped = false;

  constructor(times: Partial<HxAgentDeleteTimes> = {}) {
    this.#times = {
      limitMs: times.limitMs ?? HX_DELETE_HOLD_LIMIT_MS,
      windowGoneMs: times.windowGoneMs ?? WINDOW_GONE_WAIT_MS,
      retryMs: times.retryMs ?? RETRY_MS,
    };
  }

  attach(deps: HxAgentDeleteDeps): void {
    this.#deps = deps;
  }

  #need(): HxAgentDeleteDeps {
    if (!this.#deps) throw new Error("HXBot agent deletes are used before the services exist.");
    return this.#deps;
  }

  /** The person deleted the agent: hold the delete (see the top of this file). */
  async hold(serverId: string, agentId: string, window?: HxDeleteWindow): Promise<void> {
    const { service } = this.#need();
    const scope = scopeOf(serverId);
    if (scope === null) await runCauseEffect(service.holdAgentDelete(agentId));
    else service.hxPendingDeletes.add(agentId, scope, Date.now());
    const key = keyOf(scope, agentId);
    this.#clearLimit(key);
    this.#limits.set(
      key,
      setTimeout(() => void this.#endHeld(scope, agentId, "limit"), this.#times.limitMs),
    );
    if (window) this.#watch(window, key);
  }

  /** Undo. Throws `error.agent.gone` when the delete already ended. */
  async release(serverId: string, agentId: string): Promise<void> {
    const { service } = this.#need();
    const scope = scopeOf(serverId);
    const key = keyOf(scope, agentId);
    if (this.#running.has(key)) {
      await this.#running.get(key);
    }
    this.#forget(key);
    if (scope === null) {
      await runCauseEffect(service.releaseAgentDelete(agentId));
      return;
    }
    service.hxPendingDeletes.remove(agentId, scope);
  }

  /**
   * The delete itself, once per agent at a time; the window's own request after the undo time comes here.
   * A failure of this one shows the agent again: the window says why, and the person can try again.
   */
  commit(serverId: string, agentId: string): Promise<void> {
    return this.#commit(scopeOf(serverId), agentId, false);
  }

  #commit(scope: string | null, agentId: string, auto: boolean): Promise<void> {
    const key = keyOf(scope, agentId);
    const running = this.#running.get(key);
    if (running) return running;
    this.#forget(key);
    const work = (scope === null ? this.#deleteLocal(agentId, auto) : this.#deleteRemote(scope, agentId)).finally(
      () => {
        this.#running.delete(key);
      },
    );
    this.#running.set(key, work);
    return work;
  }

  async #deleteLocal(agentId: string, auto: boolean): Promise<void> {
    const { service, sidebarLayout } = this.#need();
    await runCauseEffect(auto ? service.hxDeleteHeld(agentId) : service.deleteAgent(agentId));
    await runCauseEffect(sidebarLayout.removeAgent(agentId));
  }

  async #deleteRemote(serverId: string, agentId: string): Promise<void> {
    const { service, remote } = this.#need();
    try {
      await runCauseEffect(remote.deleteAgent(serverId, agentId));
    } catch (error) {
      // A delete whose answer was lost, or one that another device made: the agent is gone all the same.
      const ids = await runCauseEffect(remote.agentIds(serverId)).catch(() => null);
      if (ids === null || ids.includes(agentId)) throw error;
    }
    service.hxPendingDeletes.remove(agentId, serverId);
  }

  /** A delete that nobody can undo any more ends now. A failure keeps the hold and tries again later. */
  async #endHeld(scope: string | null, agentId: string, why: "window" | "limit" | "start" | "retry", attempt = 0) {
    if (this.#stopped) return;
    const { service } = this.#need();
    // Undone, or deleted by another request in the meantime.
    if (!service.hxPendingDeletes.has(agentId, scope)) return;
    try {
      await this.#commit(scope, agentId, true);
      logger.info("A held agent delete ended.", { why, remote: scope === null ? "no" : "yes" });
    } catch (error) {
      logger.warn("A held agent delete failed; it is tried again.", {
        why,
        remote: scope === null ? "no" : "yes",
        code: error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "unknown",
      });
      this.#retry(scope, agentId, attempt);
    }
  }

  #watch(window: HxDeleteWindow, key: string): void {
    const id = window.id;
    const keys = this.#byWindow.get(id) ?? new Set<string>();
    keys.add(key);
    this.#byWindow.set(id, keys);
    if (this.#watched.has(id)) return;
    this.#watched.add(id);
    const gone = () => this.#windowGone(id);
    window.once("destroyed", gone);
    window.on("render-process-gone", gone);
    window.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) gone();
    });
  }

  #windowGone(id: number): void {
    const keys = this.#byWindow.get(id);
    this.#byWindow.delete(id);
    if (!keys || this.#stopped) return;
    const ended = [...keys];
    setTimeout(() => {
      for (const key of ended) {
        const [server, agentId] = key.split("\u0000");
        if (agentId === undefined || server === undefined) continue;
        void this.#endHeld(scopeOf(server), agentId, "window");
      }
    }, this.#times.windowGoneMs);
  }

  /** After the agent service started: the deletes that a quit or a killed process left end now. */
  start(): void {
    if (this.#stopped) return;
    const { service } = this.#need();
    for (const entry of service.hxPendingDeletes.entries()) {
      // A joined server connects after the start: its delete waits for the first retry.
      if (entry.serverId === null) void this.#endHeld(null, entry.agentId, "start");
      else this.#retry(entry.serverId, entry.agentId, 0);
    }
  }

  #retry(scope: string | null, agentId: string, attempt: number): void {
    if (this.#stopped) return;
    const key = keyOf(scope, agentId);
    if (this.#retries.has(key)) return;
    const retries = this.#times.retryMs;
    const wait = retries[Math.min(attempt, retries.length - 1)] ?? 15 * 60_000;
    this.#retries.set(
      key,
      setTimeout(() => {
        this.#retries.delete(key);
        const { service, remote } = this.#need();
        if (!service.hxPendingDeletes.has(agentId, scope)) return;
        // A server that this computer left has nothing to delete here any more.
        if (scope !== null && !remote.list().some((server) => server.id === scope)) {
          service.hxPendingDeletes.remove(agentId, scope);
          return;
        }
        void this.#endHeld(scope, agentId, "retry", attempt + 1);
      }, wait),
    );
  }

  #clearLimit(key: string): void {
    const timer = this.#limits.get(key);
    if (timer) clearTimeout(timer);
    this.#limits.delete(key);
  }

  #forget(key: string): void {
    this.#clearLimit(key);
    for (const keys of this.#byWindow.values()) keys.delete(key);
  }

  /** The quit: nothing new starts. A held delete stays on disk and ends on the next start. */
  stop(): void {
    this.#stopped = true;
    for (const timer of [...this.#limits.values(), ...this.#retries.values()]) clearTimeout(timer);
    this.#limits.clear();
    this.#retries.clear();
  }

  /** For a test: no held delete, no timer, no services. */
  reset(): void {
    this.stop();
    this.#stopped = false;
    this.#running.clear();
    this.#byWindow.clear();
    this.#watched.clear();
    this.#deps = null;
  }
}

export const hxAgentDeletes = new HxAgentDeletes();
