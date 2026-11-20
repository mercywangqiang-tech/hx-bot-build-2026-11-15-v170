// HXBot (v1.7.5): migration 59 and its part of the separate new-database schema. Frozen with the
// migration: a later change of what HXBot records goes in a new migration, never here.
//
// Migration 59 only creates tables, indexes and triggers, so no foreign-key pause and no vacuum, and no
// row of any other table changes. HXBot keeps what V2.4 asks for in tables of its own, beside the
// upstream ones, so a released client never sees it (the frozen Team API routes read the upstream
// tables) and an upstream table keeps its released shape:
// - `hx_routine_detail`: per routine, what HXBot records about it (MIG-03: its zone was never
//   confirmed; it asks before each run; what the upgrade changed).
// - `hx_run_detail`: per run, why a trigger was skipped (RTN-03), what a missed batch was and how it was
//   handled (RTN-02), and what the result was (RTN-04).
// - `hx_routine_confirmations`: a run that waits for the person's yes this time. No run exists until the
//   yes, so a declined or expired one leaves only its skipped record.
// - `hx_external_actions`: the sends, posts, payments and deletions that a workflow or routine run did,
//   so that "continue from this step" does not do one again.
// - `hx_meta`: one-time upgrade steps that ran, such as the MIG-03 pass.
// Triggers remove the rows of a deleted routine or run, also when its agent or channel goes.
//
// MIG-03 is the one-time pass `hxUpgradeRoutinesV175`, which the service runs in one transaction after
// the migrations: every routine that exists then is from before v1.7.5.

import type { DatabaseSync } from "node:sqlite";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";

const OWNERS = [
  { kind: "agent", routines: "projection_agent_routines", runs: "projection_routine_runs" },
  { kind: "channel", routines: "projection_channel_routines", runs: "projection_channel_routine_runs" },
] as const;

const GONE_TRIGGERS_SQL = OWNERS.map(
  ({ kind, routines, runs }) => `
  CREATE TRIGGER IF NOT EXISTS hx_routine_detail_${kind}_gone AFTER DELETE ON ${routines}
    BEGIN
      DELETE FROM hx_routine_detail WHERE owner_kind = '${kind}' AND routine_id = old.routine_id;
      DELETE FROM hx_routine_confirmations WHERE owner_kind = '${kind}' AND routine_id = old.routine_id;
    END;
  CREATE TRIGGER IF NOT EXISTS hx_run_detail_${kind}_gone AFTER DELETE ON ${runs}
    BEGIN
      DELETE FROM hx_run_detail WHERE owner_kind = '${kind}' AND run_id = old.run_id;
    END;`,
).join("");

export const HX_ROUTINE_DETAIL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS hx_routine_detail (
    owner_kind TEXT NOT NULL CHECK(owner_kind IN ('agent', 'channel')),
    routine_id TEXT NOT NULL,
    detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(owner_kind, routine_id)
  );
  CREATE TABLE IF NOT EXISTS hx_run_detail (
    owner_kind TEXT NOT NULL CHECK(owner_kind IN ('agent', 'channel')),
    run_id TEXT NOT NULL,
    routine_id TEXT NOT NULL,
    detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(owner_kind, run_id)
  );
  CREATE INDEX IF NOT EXISTS hx_run_detail_routine ON hx_run_detail(owner_kind, routine_id);
  CREATE TABLE IF NOT EXISTS hx_routine_confirmations (
    confirmation_id TEXT PRIMARY KEY,
    owner_kind TEXT NOT NULL CHECK(owner_kind IN ('agent', 'channel')),
    owner_id TEXT NOT NULL,
    routine_id TEXT NOT NULL,
    trigger_id TEXT,
    scheduled_for TEXT NOT NULL,
    reason TEXT NOT NULL CHECK(reason IN ('catch-up', 'each')),
    missed_json TEXT CHECK(missed_json IS NULL OR json_valid(missed_json)),
    preview TEXT NOT NULL,
    actions_json TEXT NOT NULL CHECK(json_valid(actions_json)),
    state TEXT NOT NULL CHECK(state IN ('waiting', 'confirmed', 'declined', 'expired')),
    request_id TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    settled_at TEXT,
    UNIQUE(owner_kind, routine_id, scheduled_for)
  );
  CREATE INDEX IF NOT EXISTS hx_routine_confirmations_state ON hx_routine_confirmations(state, expires_at);
  CREATE TABLE IF NOT EXISTS hx_external_actions (
    action_key TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    step_id TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('send', 'publish', 'pay', 'delete', 'other')),
    target TEXT,
    status TEXT NOT NULL CHECK(status IN ('started', 'done', 'failed', 'unknown')),
    result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS hx_external_actions_scope ON hx_external_actions(scope, created_at);
  CREATE TABLE IF NOT EXISTS hx_meta (
    key TEXT PRIMARY KEY CHECK(length(key) BETWEEN 1 AND 128),
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );${GONE_TRIGGERS_SQL}
`;

/** Migration 59: tables, indexes and triggers only. */
export function migrateHxRoutineDetail(db: DatabaseSync): void {
  db.exec(HX_ROUTINE_DETAIL_SCHEMA_SQL);
}

/** The kinds of external action that make a routine ask before each run. */
export type V59ActionKind = "send" | "publish" | "pay" | "delete";

// The words of migration 59, frozen with it. A send to "me" is the routine's own report in the chat,
// not an external action. Chinese has no spaces, so a term matches inside the text; English matches
// whole words, and a word that is also a noun ("my email", "the post") counts only as a verb.
const V59_ZH: Record<V59ActionKind, readonly string[]> = {
  send: [
    "发送",
    "发邮件",
    "发信",
    "发消息",
    "发短信",
    "发微信",
    "群发",
    "转发",
    "推送",
    "回复邮件",
    "回复消息",
    "发给",
    "发到",
  ],
  publish: ["发布", "发帖", "发推", "发朋友圈"],
  pay: ["付款", "支付", "转账", "汇款", "打款", "缴费", "购买", "下单", "买入", "卖出"],
  delete: ["删除", "删掉", "清空", "移除"],
};
const V59_EN: Record<V59ActionKind, readonly string[]> = {
  send: ["send", "sends", "email", "e-mail", "emails", "message", "reply", "forward", "dm"],
  publish: ["publish", "post", "posts", "tweet", "announce"],
  pay: ["pay", "pays", "payment", "transfer", "purchase", "buy", "checkout"],
  delete: ["delete", "deletes", "remove", "erase", "purge", "wipe"],
};
/** English words that name a thing as often as an action. Before one of these words they are a noun. */
const V59_NOUN_WORDS = new Set(["email", "e-mail", "emails", "message", "post", "posts", "transfer", "payment"]);
const V59_DETERMINER =
  /(^|[^a-z])(my|the|your|our|their|his|her|its|an|a|new|unread|latest|recent|each|every|this|that|these|those|of|in|from|blog|any|all)\s+$/;
/** A send that goes to the person themselves, and no one else. */
const V59_TO_SELF_ZH = /^(给)?(我|自己)(?![们和与跟及、])/;
const V59_TO_SELF_EN = /^\s+(((it|this|that|them|these|those|a \w+|the \w+)\s+)?to\s+)?(me|myself)\b(?!\s+(and|&)\b)/;

/** The external actions an instruction asks for, as migration 59 reads them. */
export function v59ExternalActionKinds(instruction: string): V59ActionKind[] {
  const text = instruction.normalize("NFKC");
  const lower = text.toLowerCase();
  const kinds: V59ActionKind[] = [];
  for (const kind of ["send", "publish", "pay", "delete"] as const) {
    const zh = V59_ZH[kind].some((word) => {
      for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) {
        if (!(kind === "send" && V59_TO_SELF_ZH.test(text.slice(at + word.length)))) return true;
      }
      return false;
    });
    const en = V59_EN[kind].some((word) => {
      const pattern = new RegExp(`(^|[^a-z0-9_-])${word.replace("-", "\\-")}(?=$|[^a-z0-9_-])`, "g");
      for (const match of lower.matchAll(pattern)) {
        const start = (match.index ?? 0) + (match[1] ?? "").length;
        const before = lower.slice(0, start);
        const after = lower.slice(start + word.length);
        if (V59_NOUN_WORDS.has(word) && (V59_DETERMINER.test(before) || !/^\s+\S/.test(after))) continue;
        if (kind === "send" && V59_TO_SELF_EN.test(after)) continue;
        return true;
      }
      return false;
    });
    if (zh || en) kinds.push(kind);
  }
  return kinds;
}

export const HX_UPGRADE_V175_KEY = "upgrade:v1.7.5:routines";

/** One routine that the MIG-03 pass changed, for the list the person sees and the log. */
export interface HxUpgradedRoutine {
  ownerKind: "agent" | "channel";
  ownerId: string;
  routineId: string;
  name: string;
  timezone: string;
  changes: Array<"zone-unconfirmed" | "confirm-each">;
  actions: V59ActionKind[];
}

/**
 * MIG-03, once, in one transaction with its marker: every routine keeps every field. A schedule routine
 * from before v1.7.5 has a zone that HXBot chose without asking (the host's or the device's), so it is
 * marked "zone not confirmed" and runs in that zone as before until the person chooses one. A routine
 * whose instruction sends, posts, pays or deletes asks before each run until the person gives a
 * periodic authorization (RTN-05, a later version). Returns the routines it changed; on a later start,
 * none. A routine that already has a detail row (a development build) keeps it.
 */
export function hxUpgradeRoutinesV175(db: DatabaseSync, at: string): HxUpgradedRoutine[] {
  const done = db.prepare("SELECT value FROM hx_meta WHERE key = ?").get(HX_UPGRADE_V175_KEY);
  if (isDynamicRecord(done)) return [];
  const changed: HxUpgradedRoutine[] = [];
  db.exec("SAVEPOINT hx_upgrade_v175");
  try {
    for (const { kind, routines } of OWNERS) {
      const owner = kind === "agent" ? "agent_id" : "channel_id";
      const triggers = kind === "agent" ? "projection_routine_triggers" : "projection_channel_routine_triggers";
      const rows = db
        .prepare(
          `SELECT r.routine_id, r.${owner} AS owner_id, r.name, r.instruction, r.timezone, d.detail_json,
                  EXISTS (SELECT 1 FROM ${triggers} t WHERE t.routine_id = r.routine_id) AS scheduled
           FROM ${routines} r
           LEFT JOIN hx_routine_detail d ON d.owner_kind = ? AND d.routine_id = r.routine_id
           ORDER BY r.routine_id`,
        )
        .all(kind);
      const write = db.prepare(
        `INSERT INTO hx_routine_detail (owner_kind, routine_id, detail_json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_kind, routine_id) DO UPDATE SET detail_json = excluded.detail_json,
           updated_at = excluded.updated_at`,
      );
      for (const row of rows) {
        if (!isDynamicRecord(row) || typeof row.routine_id !== "string") continue;
        if (row.detail_json !== null && row.detail_json !== undefined) continue;
        const detail: {
          zone?: { confirmed: boolean };
          confirm?: { mode: "each"; actions: V59ActionKind[]; since: "upgrade" };
          upgrade?: { at: string; changes: HxUpgradedRoutine["changes"] };
        } = {};
        const changes: HxUpgradedRoutine["changes"] = [];
        if (row.scheduled === 1) {
          detail.zone = { confirmed: false };
          changes.push("zone-unconfirmed");
        }
        const actions = v59ExternalActionKinds(typeof row.instruction === "string" ? row.instruction : "");
        if (actions.length > 0) {
          detail.confirm = { mode: "each", actions, since: "upgrade" };
          changes.push("confirm-each");
        }
        if (changes.length === 0) continue;
        detail.upgrade = { at, changes };
        write.run(kind, row.routine_id, JSON.stringify(detail), at);
        changed.push({
          ownerKind: kind,
          ownerId: String(row.owner_id),
          routineId: row.routine_id,
          name: String(row.name),
          timezone: String(row.timezone),
          changes,
          actions,
        });
      }
    }
    db.prepare("INSERT INTO hx_meta (key, value, updated_at) VALUES (?, ?, ?)").run(
      HX_UPGRADE_V175_KEY,
      JSON.stringify({ at, changed: changed.length }),
      at,
    );
    db.exec("RELEASE hx_upgrade_v175");
  } catch (error) {
    db.exec("ROLLBACK TO hx_upgrade_v175");
    db.exec("RELEASE hx_upgrade_v175");
    throw error;
  }
  return changed;
}
