// HXBot 并发（二）：每个等待都看得见——原因、排第几、大约多久（v1.7.4，CONC-09）。
//
// Every 5 s (and only while lanes wait for a place) this works out, for each lane that waits:
// - `provider` when the gate of its model holds it: the place among the lanes that wait for that
//   model, in the HX-Flow order; the time is the rest of the pause, then place × the recent turn
//   time ÷ L;
// - `machine` when the turn slots of this computer hold it: the place among the lanes that wait for
//   a slot, in the HX-Flow order; the time is place × the recent turn time ÷ B.
// A detail that changed reaches the chat (its queue) and the task list of the agent. The hold reasons
// of the contracts stay as they are (`server-busy`); the detail is the optional `holdDetail` field,
// which a released decoder ignores and the frozen Team API routes do not carry.
import type { HxHoldDetail } from "@hxbot/contracts/ipc";
import { type HxFlowCandidate, hxFlow } from "./ledger";
import { hxFlowSort } from "./order";
import { hxOverload } from "./overload";
import { type HxProviderGate, hxProviderGate } from "./provider-gate";

export interface HxHoldView {
  /** The lanes that wait for a turn slot or for their provider, with the place of their head. */
  waiting(): readonly { lane: string; candidate: HxFlowCandidate }[];
  /** B now, or null when nothing limits the turns. */
  limit(): number | null;
}

const REFRESH_MS = 5_000;
/** A refusal older than this is not why the lane waits now. */
const FRESH_REFUSAL_MS = 60_000;

function agentOf(lane: string): string {
  const separator = lane.indexOf("\u0000");
  return separator < 0 ? lane : lane.slice(0, separator);
}

function same(left: HxHoldDetail | undefined, right: HxHoldDetail | undefined): boolean {
  return left?.kind === right?.kind && left?.position === right?.position && left?.etaSeconds === right?.etaSeconds;
}

export class HxHoldDetails {
  #view: HxHoldView | null = null;
  /** Where a changed detail goes: the chat's queue and the task list, each set by its owner. */
  readonly #listeners = new Map<"queue" | "tasks", (agentId: string) => void>();
  #details = new Map<string, HxHoldDetail>();
  #timer: ReturnType<typeof setInterval> | null = null;
  readonly #gate: HxProviderGate;
  readonly #now: () => number;
  readonly #turnMs: () => number;

  constructor(options: { gate?: HxProviderGate; now?: () => number; turnMs?: () => number } = {}) {
    this.#gate = options.gate ?? hxProviderGate;
    this.#now = options.now ?? Date.now;
    this.#turnMs = options.turnMs ?? (() => hxFlow.turnMs());
  }

  /** The drain's view of the waiting lanes. */
  attachDrain(view: HxHoldView | null): void {
    this.#view = view;
    this.#arm();
  }

  /** The owner of the chat queue or of the task list tells where a changed detail goes (null: none). */
  attach(owner: "queue" | "tasks", changed: ((agentId: string) => void) | null): void {
    if (changed) this.#listeners.set(owner, changed);
    else this.#listeners.delete(owner);
    this.#arm();
  }

  /** The detail of a lane (an agent id, or agent id + NUL + task id), or null when it does not wait. */
  of(lane: string): HxHoldDetail | null {
    return this.#details.get(lane) ?? null;
  }

  /** Works the details out again; returns the agents whose detail changed, and tells them. */
  refresh(): string[] {
    // HXBot (v1.7.4, CONC-08): the same tick samples the overload of each tier.
    const view = this.#view;
    if (view) {
      const now = this.#now();
      const waiting = [...view.waiting().map((item) => item.candidate), ...hxFlow.waitingTeamWork(now)];
      hxOverload.sample(
        now,
        waiting.map((candidate) => ({ tier: candidate.tier, readyAt: candidate.readyAt })),
      );
    }
    const next = this.compute();
    const changed = new Set<string>();
    for (const lane of new Set([...this.#details.keys(), ...next.keys()]))
      if (!same(this.#details.get(lane), next.get(lane))) changed.add(agentOf(lane));
    this.#details = next;
    for (const agentId of changed) for (const listener of this.#listeners.values()) listener(agentId);
    return [...changed];
  }

  compute(): Map<string, HxHoldDetail> {
    const details = new Map<string, HxHoldDetail>();
    const view = this.#view;
    if (!view) return details;
    const waiting = view.waiting();
    if (waiting.length === 0) return details;
    const now = this.#now();
    const turnMs = Math.max(1_000, this.#turnMs());
    const context = hxFlow.orderContext(now);
    const byProvider = new Map<string, HxFlowCandidate[]>();
    const machine: HxFlowCandidate[] = [];
    const lanes = new Map(waiting.map((item) => [item.candidate.lane, item.lane]));
    for (const { lane, candidate } of waiting) {
      const refusal = this.#gate.refusal(lane);
      if (refusal && now - refusal.at <= FRESH_REFUSAL_MS) {
        const list = byProvider.get(refusal.key) ?? [];
        list.push(candidate);
        byProvider.set(refusal.key, list);
      } else machine.push(candidate);
    }
    for (const [key, candidates] of byProvider) {
      const state = this.#gate.state(key);
      const places = Math.max(1, state?.limit ?? 1);
      const pauseMs = state?.pausedUntil ? Math.max(0, state.pausedUntil - now) : 0;
      for (const [index, candidate] of hxFlowSort(candidates, context).entries()) {
        const lane = lanes.get(candidate.lane) ?? candidate.lane;
        const position = index + 1;
        details.set(lane, {
          kind: "provider",
          position,
          etaSeconds: Math.round((pauseMs + (position * turnMs) / places) / 1000),
        });
      }
    }
    const limit = view.limit();
    const places = Math.max(1, limit ?? 1);
    for (const [index, candidate] of hxFlowSort(machine, context).entries()) {
      const lane = lanes.get(candidate.lane) ?? candidate.lane;
      const position = index + 1;
      details.set(lane, {
        kind: "machine",
        position,
        etaSeconds: limit === null ? null : Math.round((position * turnMs) / places / 1000),
      });
    }
    return details;
  }

  #arm(): void {
    if (this.#view && this.#listeners.size > 0) {
      this.#timer ??= setInterval(() => this.refresh(), REFRESH_MS);
      this.#timer.unref?.();
    } else if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** For the tests. */
  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#details.clear();
  }
}

export const hxHoldDetails = new HxHoldDetails();

/** The detail field of a task that waits for the computer or the provider (`server-busy`), or none. */
export function hxTaskHoldDetail(hold: string | null, agentId: string, taskId: string): { holdDetail?: HxHoldDetail } {
  if (hold !== "server-busy") return {};
  const detail = hxHoldDetails.of(`${agentId}\u0000${taskId}`);
  return detail ? { holdDetail: detail } : {};
}
