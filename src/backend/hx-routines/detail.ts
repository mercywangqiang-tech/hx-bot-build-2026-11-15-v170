/**
 * HXBot (v1.7.5): what HXBot records about a routine and a run, in its own tables (migration 59).
 * Every write takes the connection of the caller, so it joins the caller's transaction; every read
 * tolerates a row that a later version wrote with fields this one does not know.
 */

import type { DatabaseSync } from "node:sqlite";
import type { HxRoutineFlags, HxRunFlags } from "@hxbot/contracts/ipc";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";

export type HxOwnerKind = "agent" | "channel";
export type HxActionKind = "send" | "publish" | "pay" | "delete";

export interface HxRoutineDetail {
  zone?: { confirmed: boolean; at?: string };
  confirm?: { mode: "each"; actions: HxActionKind[]; since: "upgrade" | "user" };
  upgrade?: { at: string; changes: Array<"zone-unconfirmed" | "confirm-each">; seenAt?: string };
  /** RTN-02: HXBot's start kept this occurrence due, to run once for the ones missed while it was closed. */
  pendingCatchUp?: { scheduledFor: string; total: number; from: string; until: string };
}

export type HxSkipReason = "previous-running" | "plan-limit" | "declined" | "expired" | "cancelled" | "unasked";
export type HxResultKind = "succeeded" | "no-update" | "unverified" | "failed";

export interface HxRunDetail {
  /** RTN-03 / RTN-02: why this occurrence did not run. */
  skip?: { reason: HxSkipReason; at: string };
  /** RTN-02: the occurrences that came due while HXBot was closed or the computer slept. */
  missed?: { total: number; from: string; until: string; handled: "skip" | "run-once"; while: "closed" | "asleep" };
  /** RTN-02: this run makes up for missed occurrences. */
  catchUp?: { total: number; from: string; until: string };
  /** RTN-02 / MIG-03: the person said yes to this run. */
  confirmed?: { confirmationId: string; at: string };
  /** RTN-04: the result, which a finished turn alone never sets to succeeded. */
  result?: { kind: HxResultKind; at: string; reasons: string[] };
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return isDynamicRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const isText = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const ACTIONS = ["send", "publish", "pay", "delete"] as const;
const isAction = (value: unknown): value is HxActionKind => ACTIONS.some((action) => action === value);
const UPGRADE_CHANGES = ["zone-unconfirmed", "confirm-each"] as const;
const isChange = (value: unknown): value is "zone-unconfirmed" | "confirm-each" =>
  UPGRADE_CHANGES.some((change) => change === value);
const SKIPS = ["previous-running", "plan-limit", "declined", "expired", "cancelled", "unasked"] as const;
const isSkip = (value: unknown): value is HxSkipReason => SKIPS.some((reason) => reason === value);
const RESULTS = ["succeeded", "no-update", "unverified", "failed"] as const;
const isResult = (value: unknown): value is HxResultKind => RESULTS.some((kind) => kind === value);

const ROUTINE_KEYS = new Set(["zone", "confirm", "upgrade", "pendingCatchUp"]);
const RUN_KEYS = new Set(["skip", "missed", "catchUp", "confirmed", "result"]);

/**
 * The fields a later HXBot wrote that this one does not know. A write keeps them, so opening an
 * older build with the same schema does not erase what the newer one recorded.
 */
function withUnknownFields(
  stored: string | null,
  known: ReadonlySet<string>,
  next: HxRoutineDetail | HxRunDetail,
): string {
  const raw = parseJson(stored);
  const kept = raw ? Object.fromEntries(Object.entries(raw).filter(([key]) => !known.has(key))) : {};
  return JSON.stringify({ ...kept, ...next });
}

function storedJson(db: DatabaseSync, sql: string, kind: HxOwnerKind, id: string): string | null {
  const row = db.prepare(sql).get(kind, id);
  return isDynamicRecord(row) && typeof row.detail_json === "string" ? row.detail_json : null;
}

/** HXBot's own JSON read back field by field: a field that does not fit is left out. */
export function hxDecodeRoutineDetail(value: unknown): HxRoutineDetail | null {
  const raw = parseJson(value);
  if (!raw) return null;
  const detail: HxRoutineDetail = {};
  const { zone, confirm, upgrade, pendingCatchUp } = raw;
  if (isDynamicRecord(zone) && typeof zone.confirmed === "boolean") {
    detail.zone = { confirmed: zone.confirmed, ...(isText(zone.at) ? { at: zone.at } : {}) };
  }
  if (isDynamicRecord(confirm) && confirm.mode === "each" && Array.isArray(confirm.actions)) {
    detail.confirm = {
      mode: "each",
      actions: confirm.actions.filter(isAction),
      since: confirm.since === "user" ? "user" : "upgrade",
    };
  }
  if (isDynamicRecord(upgrade) && isText(upgrade.at) && Array.isArray(upgrade.changes)) {
    detail.upgrade = {
      at: upgrade.at,
      changes: upgrade.changes.filter(isChange),
      ...(isText(upgrade.seenAt) ? { seenAt: upgrade.seenAt } : {}),
    };
  }
  if (
    isDynamicRecord(pendingCatchUp) &&
    isText(pendingCatchUp.scheduledFor) &&
    isCount(pendingCatchUp.total) &&
    isText(pendingCatchUp.from) &&
    isText(pendingCatchUp.until)
  ) {
    detail.pendingCatchUp = {
      scheduledFor: pendingCatchUp.scheduledFor,
      total: pendingCatchUp.total,
      from: pendingCatchUp.from,
      until: pendingCatchUp.until,
    };
  }
  return detail;
}

export function hxDecodeRunDetail(value: unknown): HxRunDetail | null {
  const raw = parseJson(value);
  if (!raw) return null;
  const detail: HxRunDetail = {};
  const { skip, missed, catchUp, confirmed, result } = raw;
  if (isDynamicRecord(skip) && isSkip(skip.reason) && isText(skip.at))
    detail.skip = { reason: skip.reason, at: skip.at };
  if (
    isDynamicRecord(missed) &&
    isCount(missed.total) &&
    isText(missed.from) &&
    isText(missed.until) &&
    (missed.handled === "skip" || missed.handled === "run-once") &&
    (missed.while === "closed" || missed.while === "asleep")
  ) {
    detail.missed = {
      total: missed.total,
      from: missed.from,
      until: missed.until,
      handled: missed.handled,
      while: missed.while,
    };
  }
  if (isDynamicRecord(catchUp) && isCount(catchUp.total) && isText(catchUp.from) && isText(catchUp.until)) {
    detail.catchUp = { total: catchUp.total, from: catchUp.from, until: catchUp.until };
  }
  if (isDynamicRecord(confirmed) && isText(confirmed.confirmationId) && isText(confirmed.at)) {
    detail.confirmed = { confirmationId: confirmed.confirmationId, at: confirmed.at };
  }
  if (isDynamicRecord(result) && isResult(result.kind) && isText(result.at) && Array.isArray(result.reasons)) {
    detail.result = { kind: result.kind, at: result.at, reasons: result.reasons.filter(isText) };
  }
  return detail;
}

const ROUTINE_DETAIL_SQL = "SELECT detail_json FROM hx_routine_detail WHERE owner_kind = ? AND routine_id = ?";
const RUN_DETAIL_SQL = "SELECT detail_json FROM hx_run_detail WHERE owner_kind = ? AND run_id = ?";

export function hxReadRoutineDetail(db: DatabaseSync, kind: HxOwnerKind, routineId: string): HxRoutineDetail | null {
  return hxDecodeRoutineDetail(storedJson(db, ROUTINE_DETAIL_SQL, kind, routineId));
}

export function hxWriteRoutineDetail(
  db: DatabaseSync,
  kind: HxOwnerKind,
  routineId: string,
  change: (current: HxRoutineDetail) => HxRoutineDetail,
  at = new Date().toISOString(),
): HxRoutineDetail {
  const stored = storedJson(db, ROUTINE_DETAIL_SQL, kind, routineId);
  const next = change({ ...(hxDecodeRoutineDetail(stored) ?? {}) });
  db.prepare(
    `INSERT INTO hx_routine_detail (owner_kind, routine_id, detail_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(owner_kind, routine_id) DO UPDATE SET detail_json = excluded.detail_json, updated_at = excluded.updated_at`,
  ).run(kind, routineId, withUnknownFields(stored, ROUTINE_KEYS, next), at);
  return next;
}

export function hxReadRunDetail(db: DatabaseSync, kind: HxOwnerKind, runId: string): HxRunDetail | null {
  return hxDecodeRunDetail(storedJson(db, RUN_DETAIL_SQL, kind, runId));
}

export function hxWriteRunDetail(
  db: DatabaseSync,
  kind: HxOwnerKind,
  runId: string,
  routineId: string,
  change: (current: HxRunDetail) => HxRunDetail,
  at = new Date().toISOString(),
): HxRunDetail {
  const stored = storedJson(db, RUN_DETAIL_SQL, kind, runId);
  const next = change({ ...(hxDecodeRunDetail(stored) ?? {}) });
  db.prepare(
    `INSERT INTO hx_run_detail (owner_kind, run_id, routine_id, detail_json, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(owner_kind, run_id) DO UPDATE SET detail_json = excluded.detail_json, updated_at = excluded.updated_at`,
  ).run(kind, runId, routineId, withUnknownFields(stored, RUN_KEYS, next), at);
  return next;
}

/** The run details of one routine, by run id. */
export function hxRunDetailsOf(db: DatabaseSync, kind: HxOwnerKind, routineId: string): Map<string, HxRunDetail> {
  const rows = db
    .prepare("SELECT run_id, detail_json FROM hx_run_detail WHERE owner_kind = ? AND routine_id = ?")
    .all(kind, routineId);
  const details = new Map<string, HxRunDetail>();
  for (const row of rows) {
    if (!isDynamicRecord(row) || typeof row.run_id !== "string") continue;
    const detail = hxDecodeRunDetail(row.detail_json);
    if (detail) details.set(row.run_id, detail);
  }
  return details;
}

/** What a routine read back shows of its detail: only what the editor and the list read. */
export function hxRoutineFlags(detail: HxRoutineDetail | null): HxRoutineFlags | undefined {
  if (!detail) return undefined;
  const flags: HxRoutineFlags = {};
  if (detail.zone?.confirmed === false) flags.zoneUnconfirmed = true;
  if (detail.confirm?.mode === "each") flags.confirmEach = true;
  if (detail.upgrade && !detail.upgrade.seenAt)
    flags.upgraded = { at: detail.upgrade.at, changes: detail.upgrade.changes };
  return Object.keys(flags).length > 0 ? flags : undefined;
}

/** The flags of a routine for `RoutineFields.hx`, or nothing. Never throws: a missing table reads as no flags. */
export function hxRoutineFlagsOf(db: DatabaseSync, kind: HxOwnerKind, routineId: string): { hx?: HxRoutineFlags } {
  try {
    const flags = hxRoutineFlags(hxReadRoutineDetail(db, kind, routineId));
    return flags ? { hx: flags } : {};
  } catch {
    return {};
  }
}

/** A person chose the zone: it is confirmed. */
export function hxConfirmZone(
  db: DatabaseSync,
  kind: HxOwnerKind,
  routineId: string,
  at = new Date().toISOString(),
): void {
  hxWriteRoutineDetail(db, kind, routineId, (detail) => ({ ...detail, zone: { confirmed: true, at } }), at);
}

/** A copied routine keeps whether its zone is confirmed and whether it asks before each run. */
export function hxCopyRoutineDetail(db: DatabaseSync, kind: HxOwnerKind, fromId: string, toId: string): void {
  const source = hxReadRoutineDetail(db, kind, fromId);
  if (!source) return;
  hxWriteRoutineDetail(db, kind, toId, (detail) => ({
    ...detail,
    ...(source.zone ? { zone: source.zone } : {}),
    ...(source.confirm ? { confirm: source.confirm } : {}),
  }));
}

/** What a run read back shows of its detail (`RoutineRunFields.hx`). */
export function hxRunFlags(detail: HxRunDetail | undefined): HxRunFlags | undefined {
  if (!detail) return undefined;
  const flags: HxRunFlags = {};
  if (detail.skip) flags.skip = detail.skip.reason;
  if (detail.missed) flags.missed = detail.missed;
  if (detail.catchUp) flags.catchUp = { total: detail.catchUp.total };
  if (detail.result) flags.result = detail.result.kind;
  return Object.keys(flags).length > 0 ? flags : undefined;
}

/** Adds `hx` to each run of one routine that has a detail. A missing table reads as no detail. */
export function hxRunsWithFlags(
  db: DatabaseSync,
  kind: HxOwnerKind,
  routineId: string,
): <Run extends { id: string }>(run: Run) => Run & { hx?: HxRunFlags } {
  let details: Map<string, HxRunDetail>;
  try {
    details = hxRunDetailsOf(db, kind, routineId);
  } catch {
    details = new Map();
  }
  return (run) => {
    const flags = hxRunFlags(details.get(run.id));
    return flags ? { ...run, hx: flags } : run;
  };
}
