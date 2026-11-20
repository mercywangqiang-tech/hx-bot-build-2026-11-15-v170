/**
 * HXBot (v1.7.5, RTN-02, MIG-03, CONC-14): a routine run that waits for the person's yes this time.
 *
 * A catch-up run that sends, posts, pays or deletes, and every run of a routine that asks before each
 * run, starts only after the yes. Until then no run exists and no turn waits, so the question holds no
 * place in any queue; the card in the agent's chat is the question. A channel routine asks in its
 * routine list and with a desktop notification: a channel's messages reach every member over the team
 * wire, and a released member could not read a new kind of message. The row in
 * `hx_routine_confirmations` keeps it across a restart. "No" skips this time; a question nobody answers
 * before the routine's next occurrence (24 hours at most) expires and skips this time. Either leaves a
 * skipped record in the run history.
 *
 * CONC-14: questions of one agent (or one channel) with the same kinds of action that come within 2
 * seconds share one card, and one answer settles them all. A payment is never merged: it is asked on its
 * own each time.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  HX_ROUTINE_CONFIRM_ID_PREFIX,
  type HxAnswerRoutineConfirmResult,
  type HxRoutineConfirmCard,
} from "@hxbot/contracts/hx-routine-confirm";
import type { ChannelRoutine, HxRoutineWaiting, Routine, RoutineSchedule } from "@hxbot/contracts/ipc";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { sourceText } from "@hxbot/i18n/source";
import { nextRoutineOccurrence } from "@hxbot/team-client/routine-schedule";
import type { HxActionKind, HxOwnerKind } from "./detail";
import type { HxMissedBatch } from "./due";

/** CONC-14: questions this close together share a card. */
const HX_CONFIRM_MERGE_MS = 2_000;
/** The longest a question waits when the routine has no next occurrence before it. */
export const HX_CONFIRM_MAX_WAIT_MS = 24 * 3_600_000;
const INSTRUCTION_PREVIEW = 160;

/** What a question reads of a routine; an agent's and a channel's routine both have it. */
export interface HxConfirmRoutine {
  id: string;
  name: string;
  instruction: string;
  timezone: string;
  trigger: { schedule: RoutineSchedule };
}

export interface HxConfirmRequest<R extends HxConfirmRoutine> {
  routine: R;
  /** The agent or the channel that owns the routine. */
  ownerId: string;
  triggerId: string | null;
  scheduledFor: Date;
  reason: "each" | "catch-up";
  actions: readonly HxActionKind[];
  catchUp: HxMissedBatch | null;
  now: Date;
}

/** What the confirmation needs from the rest of HXBot. The agent service and the channel scheduler attach it. */
export interface HxConfirmHost<R extends HxConfirmRoutine> {
  connection(): DatabaseSync;
  routine(ownerId: string, routineId: string): R | null;
  /** Shows the question, and later its answer. An agent writes a card in its chat. */
  writeCard(ownerId: string, cardId: string, card: HxRoutineConfirmCard, settled: boolean): void;
  /** Starts the run of a yes. It runs as the occurrence it was asked for. */
  startRun(input: {
    routine: R;
    ownerId: string;
    triggerId: string | null;
    scheduledFor: string;
    confirmationId: string;
    catchUp: HxMissedBatch | null;
  }): Promise<void>;
  /** Records the occurrence as skipped, with the reason, in the run history. */
  recordSkipped(input: {
    routine: R;
    ownerId: string;
    triggerId: string | null;
    scheduledFor: string;
    reason: "declined" | "expired" | "cancelled";
  }): void;
}

interface ConfirmationRow {
  id: string;
  ownerId: string;
  routineId: string;
  triggerId: string | null;
  scheduledFor: string;
  reason: "each" | "catch-up";
  missed: HxMissedBatch | null;
  actions: HxActionKind[];
  state: "waiting" | "confirmed" | "declined" | "expired";
  cardId: string;
  createdAt: string;
  expiresAt: string;
}

function readMissed(value: unknown): HxMissedBatch | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    if (!isDynamicRecord(parsed) || typeof parsed.total !== "number") return null;
    return {
      total: parsed.total,
      truncated: parsed.truncated === true,
      from: new Date(String(parsed.from)),
      until: new Date(String(parsed.until)),
      handled: parsed.handled === "skip" ? "skip" : "run-once",
    };
  } catch {
    return null;
  }
}

function readActions(value: unknown): HxActionKind[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter((kind): kind is HxActionKind => ["send", "publish", "pay", "delete"].includes(String(kind)))
      : [];
  } catch {
    return [];
  }
}

function toRow(value: unknown): ConfirmationRow | null {
  if (!isDynamicRecord(value) || typeof value.confirmation_id !== "string") return null;
  const state = String(value.state);
  if (state !== "waiting" && state !== "confirmed" && state !== "declined" && state !== "expired") return null;
  return {
    id: value.confirmation_id,
    ownerId: String(value.owner_id),
    routineId: String(value.routine_id),
    triggerId: typeof value.trigger_id === "string" ? value.trigger_id : null,
    scheduledFor: String(value.scheduled_for),
    reason: value.reason === "each" ? "each" : "catch-up",
    missed: readMissed(value.missed_json),
    actions: readActions(value.actions_json),
    state,
    cardId: String(value.request_id),
    createdAt: String(value.created_at),
    expiresAt: String(value.expires_at),
  };
}

/** `YYYY-MM-DD HH:mm` in the routine's zone, the same on every screen. */
export function hxLocalMinute(at: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
  } catch {
    return at.toISOString().slice(0, 16).replace("T", " ");
  }
}

function actionsLine(actions: readonly HxActionKind[]): string {
  const kinds = [...new Set(actions)];
  if (kinds.length === 0) return sourceText("status.agent.hxRoutineConfirm.actions.each");
  if (kinds.length > 1) return sourceText("status.agent.hxRoutineConfirm.actions.several");
  switch (kinds[0]) {
    case "send":
      return sourceText("status.agent.hxRoutineConfirm.actions.send");
    case "publish":
      return sourceText("status.agent.hxRoutineConfirm.actions.publish");
    case "pay":
      return sourceText("status.agent.hxRoutineConfirm.actions.pay");
    default:
      return sourceText("status.agent.hxRoutineConfirm.actions.delete");
  }
}

function noteLine(row: ConfirmationRow, timezone: string): string {
  if (row.reason === "each") return sourceText("status.agent.hxRoutineConfirm.noteEach");
  const missed = row.missed;
  if (!missed) return sourceText("status.agent.hxRoutineConfirm.noteLate");
  return sourceText("status.agent.hxRoutineConfirm.noteCatchUp", {
    count: missed.truncated ? `${missed.total}+` : String(missed.total),
    from: hxLocalMinute(missed.from, timezone),
    until: hxLocalMinute(missed.until, timezone),
  });
}

export class HxRoutineConfirm<R extends HxConfirmRoutine> {
  readonly #kind: HxOwnerKind;
  #host: HxConfirmHost<R> | null = null;
  /** Cards whose answer is being carried out, so a second click does not start a run twice. */
  readonly #answering = new Set<string>();

  constructor(kind: HxOwnerKind) {
    this.#kind = kind;
  }

  attach(host: HxConfirmHost<R>): void {
    this.#host = host;
  }

  detach(): void {
    this.#host = null;
    this.#answering.clear();
  }

  get attached(): boolean {
    return this.#host !== null;
  }

  /** The questions of this owner kind that match: `where` never names the owner kind itself. */
  #rows(where: string, ...values: Array<string | null>): ConfirmationRow[] {
    const host = this.#host;
    if (!host) return [];
    return host
      .connection()
      .prepare(
        `SELECT * FROM hx_routine_confirmations WHERE owner_kind = ? AND (${where}) ORDER BY created_at, confirmation_id`,
      )
      .all(this.#kind, ...values)
      .flatMap((row) => {
        const parsed = toRow(row);
        return parsed ? [parsed] : [];
      });
  }

  /** The open questions of a routine. */
  waitingFor(ownerId: string, routineId: string): ConfirmationRow[] {
    return this.#rows("owner_id = ? AND routine_id = ? AND state = 'waiting'", ownerId, routineId);
  }

  /** The open questions of a routine, as the routine list shows them with their answer buttons. */
  waitingCards(ownerId: string, routineId: string): HxRoutineWaiting[] {
    return this.waitingFor(ownerId, routineId).map((row) => ({
      cardId: row.cardId,
      scheduledFor: row.scheduledFor,
      reason: row.reason,
      actions: row.actions,
      ...(row.missed
        ? {
            missed: {
              total: row.missed.total,
              truncated: row.missed.truncated,
              from: row.missed.from.toISOString(),
              until: row.missed.until.toISOString(),
            },
          }
        : {}),
      expiresAt: row.expiresAt,
    }));
  }

  /**
   * Asks for the yes of one run. A question that already waits for the same occurrence is kept as it
   * is. Returns the card id, or null when nothing can ask (no host attached).
   */
  request(input: HxConfirmRequest<R>): string | null {
    const host = this.#host;
    if (!host) return null;
    const db = host.connection();
    const scheduledFor = input.scheduledFor.toISOString();
    const known = this.#rows("routine_id = ? AND scheduled_for = ?", input.routine.id, scheduledFor)[0];
    if (known) return known.cardId;
    const actions = [...new Set(input.actions)].sort();
    const cardId =
      this.#mergeTarget(input.ownerId, actions, input.now) ?? `${HX_ROUTINE_CONFIRM_ID_PREFIX}${randomUUID()}`;
    const expiresAt = this.#expiry(
      input.routine.trigger.schedule,
      input.routine.timezone,
      input.scheduledFor,
      input.now,
    );
    db.prepare(
      `INSERT INTO hx_routine_confirmations (confirmation_id, owner_kind, owner_id, routine_id, trigger_id,
         scheduled_for, reason, missed_json, preview, actions_json, state, request_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`,
    ).run(
      randomUUID(),
      this.#kind,
      input.ownerId,
      input.routine.id,
      input.triggerId,
      scheduledFor,
      input.reason,
      input.catchUp
        ? JSON.stringify({
            total: input.catchUp.total,
            truncated: input.catchUp.truncated,
            from: input.catchUp.from.toISOString(),
            until: input.catchUp.until.toISOString(),
            handled: input.catchUp.handled,
          })
        : null,
      input.routine.instruction.slice(0, 2_000),
      JSON.stringify(actions),
      cardId,
      input.now.toISOString(),
      expiresAt.toISOString(),
    );
    this.#writeCard(input.ownerId, cardId);
    return cardId;
  }

  /** CONC-14: an open card of the same owner and the same kinds of action from the last 2 seconds. */
  #mergeTarget(ownerId: string, actions: readonly HxActionKind[], now: Date): string | null {
    if (actions.includes("pay")) return null;
    const since = new Date(now.getTime() - HX_CONFIRM_MERGE_MS).toISOString();
    const candidates = this.#rows("owner_id = ? AND state = 'waiting' AND created_at >= ?", ownerId, since);
    const key = JSON.stringify(actions);
    for (const row of candidates.reverse()) {
      const group = this.#rows("request_id = ?", row.cardId);
      if (group.every((entry) => entry.state === "waiting" && JSON.stringify([...entry.actions].sort()) === key)) {
        return row.cardId;
      }
    }
    return null;
  }

  /** Until the routine's next occurrence after this one, and 24 hours at most. */
  #expiry(schedule: RoutineSchedule, timezone: string, scheduledFor: Date, now: Date): Date {
    const latest = new Date(Math.max(now.getTime(), scheduledFor.getTime()) + HX_CONFIRM_MAX_WAIT_MS);
    if (schedule.kind === "once") return latest;
    try {
      const next = nextRoutineOccurrence(schedule, timezone, new Date(Math.max(now.getTime(), scheduledFor.getTime())));
      return next.getTime() < latest.getTime() ? next : latest;
    } catch {
      return latest;
    }
  }

  #writeCard(ownerId: string, cardId: string, outcome?: string): void {
    const host = this.#host;
    if (!host) return;
    const group = this.#rows("request_id = ?", cardId);
    if (group.length === 0) return;
    const routines = group.map((row) => ({ row, routine: host.routine(ownerId, row.routineId) }));
    const first = routines[0];
    const timezone = first?.routine?.timezone ?? "UTC";
    const title =
      group.length === 1
        ? sourceText("status.agent.hxRoutineConfirm.title", { name: first?.routine?.name ?? "" })
        : sourceText("status.agent.hxRoutineConfirm.titleMany", { count: group.length });
    const card: HxRoutineConfirmCard = {
      title,
      note: first ? noteLine(first.row, timezone) : "",
      actions: actionsLine(group.flatMap((row) => row.actions)),
      lines: routines.map(({ row, routine }) => {
        const instruction = (routine?.instruction ?? "").replace(/\s+/gu, " ").trim();
        const preview =
          instruction.length > INSTRUCTION_PREVIEW ? `${instruction.slice(0, INSTRUCTION_PREVIEW - 1)}…` : instruction;
        return `${routine?.name ?? row.routineId} · ${hxLocalMinute(new Date(row.scheduledFor), routine?.timezone ?? timezone)}: ${preview}`;
      }),
      ...(outcome ? { outcome } : {}),
    };
    try {
      host.writeCard(ownerId, cardId, card, outcome !== undefined);
    } catch {
      // The question stays in its table; the card is written again with the answer.
    }
  }

  #settle(rows: readonly ConfirmationRow[], state: "confirmed" | "declined" | "expired", at: Date): ConfirmationRow[] {
    const host = this.#host;
    if (!host) return [];
    const db = host.connection();
    const update = db.prepare(
      `UPDATE hx_routine_confirmations SET state = ?, settled_at = ?
       WHERE confirmation_id = ? AND owner_kind = ? AND state = 'waiting'`,
    );
    return rows.filter((row) => Number(update.run(state, at.toISOString(), row.id, this.#kind).changes) === 1);
  }

  /**
   * The person's answer to a card of one owner. Only the waiting questions of the card are settled; a
   * card of another owner, or of the other owner kind, reads as gone.
   */
  async answer(
    input: { ownerId: string; cardId: string; run: boolean },
    now = new Date(),
  ): Promise<HxAnswerRoutineConfirmResult> {
    const host = this.#host;
    if (!host) throw new Error(sourceText("error.backend.hxRoutineConfirmGone"));
    const group = this.#rows("request_id = ? AND owner_id = ?", input.cardId, input.ownerId);
    if (group.length === 0) throw new Error(sourceText("error.backend.hxRoutineConfirmGone"));
    if (this.#answering.has(input.cardId)) return { ran: 0, skipped: 0, settled: group.length };
    this.#answering.add(input.cardId);
    try {
      const waiting = group.filter((row) => row.state === "waiting");
      const settled = this.#settle(waiting, input.run ? "confirmed" : "declined", now);
      let ran = 0;
      let skipped = 0;
      for (const row of settled) {
        const routine = host.routine(input.ownerId, row.routineId);
        if (!routine) continue;
        if (input.run) {
          try {
            await host.startRun({
              routine,
              ownerId: input.ownerId,
              triggerId: row.triggerId,
              scheduledFor: row.scheduledFor,
              confirmationId: row.id,
              catchUp: row.missed,
            });
            ran += 1;
          } catch {
            host.recordSkipped({
              routine,
              ownerId: input.ownerId,
              triggerId: row.triggerId,
              scheduledFor: row.scheduledFor,
              reason: "declined",
            });
            skipped += 1;
          }
        } else {
          host.recordSkipped({
            routine,
            ownerId: input.ownerId,
            triggerId: row.triggerId,
            scheduledFor: row.scheduledFor,
            reason: "declined",
          });
          skipped += 1;
        }
      }
      if (settled.length > 0) {
        this.#writeCard(
          input.ownerId,
          input.cardId,
          input.run
            ? sourceText("status.agent.hxRoutineConfirm.outcome.yes")
            : sourceText("status.agent.hxRoutineConfirm.outcome.no"),
        );
      }
      return { ran, skipped, settled: group.length - settled.length };
    } finally {
      this.#answering.delete(input.cardId);
    }
  }

  /**
   * Expires the questions whose time has passed: the routine's next occurrence came, or 24 hours. Each
   * leaves a skipped record. A routine that is gone takes its questions with it (a trigger in the table).
   */
  expire(now = new Date()): number {
    const host = this.#host;
    if (!host) return 0;
    const due = this.#rows("state = 'waiting' AND expires_at <= ?", now.toISOString());
    const settled = this.#settle(due, "expired", now);
    const cards = new Map<string, string>();
    for (const row of settled) {
      const routine = host.routine(row.ownerId, row.routineId);
      if (routine) {
        host.recordSkipped({
          routine,
          ownerId: row.ownerId,
          triggerId: row.triggerId,
          scheduledFor: row.scheduledFor,
          reason: "expired",
        });
      }
      cards.set(row.cardId, row.ownerId);
    }
    for (const [cardId, ownerId] of cards) {
      const open = this.#rows("request_id = ? AND state = 'waiting'", cardId);
      if (open.length === 0)
        this.#writeCard(ownerId, cardId, sourceText("status.agent.hxRoutineConfirm.outcome.expired"));
    }
    return settled.length;
  }

  /**
   * RTN-06: a paused routine asks nothing more. Its open questions close as skipped ("the routine is
   * paused"), so nothing waits to run when it is read back.
   */
  cancelFor(ownerId: string, routineId: string, now = new Date()): number {
    const host = this.#host;
    if (!host) return 0;
    const waiting = this.waitingFor(ownerId, routineId);
    const settled = this.#settle(waiting, "declined", now);
    const routine = host.routine(ownerId, routineId);
    for (const row of settled) {
      if (routine)
        host.recordSkipped({
          routine,
          ownerId,
          triggerId: row.triggerId,
          scheduledFor: row.scheduledFor,
          reason: "cancelled",
        });
    }
    for (const cardId of new Set(settled.map((row) => row.cardId))) {
      if (this.#rows("request_id = ? AND state = 'waiting'", cardId).length === 0) {
        this.#writeCard(ownerId, cardId, sourceText("status.agent.hxRoutineConfirm.outcome.paused"));
      }
    }
    return settled.length;
  }

  /** The time the next question expires, for the shared routine timer. */
  nextExpiry(): string | null {
    const host = this.#host;
    if (!host) return null;
    const row = host
      .connection()
      .prepare("SELECT MIN(expires_at) AS at FROM hx_routine_confirmations WHERE owner_kind = ? AND state = 'waiting'")
      .get(this.#kind);
    return isDynamicRecord(row) && typeof row.at === "string" ? row.at : null;
  }
}

export const hxRoutineConfirm = new HxRoutineConfirm<Routine>("agent");
/** A channel routine's questions: the channel routine scheduler attaches it. */
export const hxChannelRoutineConfirm = new HxRoutineConfirm<ChannelRoutine>("channel");
