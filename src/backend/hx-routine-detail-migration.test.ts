// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  HX_UPGRADE_V175_KEY,
  hxUpgradeRoutinesV175,
  v59ExternalActionKinds,
} from "./database/hx-routine-detail-schema";
import { type HxRoutineDetail, hxDecodeRoutineDetail } from "./hx-routines/detail";
import { migrateHxBotDatabase } from "./hxbot-database-schema";

// HXBot v1.7.5: migration 59 (HXBot's own routine tables) and the MIG-03 pass.
// Failure modes: the upgrade changes or loses a row of any table; a partial migration survives a failure;
// a retry fails on tables a development build made; a newer or incomplete history is accepted; an older
// application opens the new schema; a deleted routine, run, agent or channel leaves rows behind; the CHECKs
// accept bad values; the MIG-03 pass marks a routine twice, marks a new one, loses a field, or keeps half its
// work after a failure; an external action is missed or a report to the person is taken for one.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const AT = "2026-11-20T00:00:00.000Z";
const STAMP = "2026-10-01T07:00:00.000Z";
/** Every released schema: the v8 baseline to v58, the schema of v1.7.0 to v1.7.4. */
const SOURCES = Array.from({ length: 51 }, (_, index) => index + 8);
const CHANNEL_ROUTINES_SINCE = 19;
const HX_TABLES = {
  hx_external_actions: [],
  hx_meta: [],
  hx_routine_confirmations: [],
  hx_routine_detail: [],
  hx_run_detail: [],
};

function migrateUpTo(db: DatabaseSync, version: number): void {
  db.exec(`CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateHxBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
}

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  migrateUpTo(db, version);
  return db;
}

/**
 * Inserts `values`, and fills each other NOT NULL column with no default, so one seed fits every schema.
 * JSON columns get "{}" and numbers 0.
 */
function insert(db: DatabaseSync, table: string, values: Record<string, string | number | null>): void {
  const row: Record<string, string | number | null> = { ...values };
  for (const column of db.prepare(`PRAGMA table_info(${table})`).all()) {
    const name = String(column.name);
    if (name in row || column.notnull !== 1 || column.dflt_value !== null || column.pk === 1) continue;
    const type = String(column.type).toUpperCase();
    row[name] = type.includes("INT") || type.includes("REAL") ? 0 : name.endsWith("_json") ? "{}" : "x";
  }
  const names = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(
    ...names.map((name) => row[name] ?? null),
  );
}

interface Seeded {
  agent: string[];
  channel: string[];
}

/**
 * Per owner kind: a plain schedule routine, one that sends a message, one that reports to the person only, a
 * paused one that deletes files, and one with no trigger (a webhook routine on a schema that has them).
 */
function seed(db: DatabaseSync, version: number): Seeded {
  const owners = [
    {
      kind: "agent",
      routines: "projection_agent_routines",
      triggers: "projection_routine_triggers",
      runs: "projection_routine_runs",
      owner: "agent_id",
      handle: "delivery_id",
    },
    ...(version >= CHANNEL_ROUTINES_SINCE
      ? [
          {
            kind: "channel",
            routines: "projection_channel_routines",
            triggers: "projection_channel_routine_triggers",
            runs: "projection_channel_routine_runs",
            owner: "channel_id",
            handle: "request_message_id",
          },
        ]
      : []),
  ] as const;
  if (version >= CHANNEL_ROUTINES_SINCE) insert(db, "projection_channels", { channel_id: "ops", channel_json: "{}" });
  const seeded: Seeded = { agent: [], channel: [] };
  const routines = [
    { id: "plain", instruction: 'Collect the news. 界"\\', active: 1, trigger: true },
    { id: "sends", instruction: "每天发消息给团队群，附上日报。", active: 1, trigger: true },
    { id: "to-me", instruction: "Summarize my email and send me a summary.", active: 1, trigger: true },
    { id: "deletes", instruction: "Delete the temporary files in Downloads.", active: 0, trigger: true },
    { id: "no-trigger", instruction: "Post the event to Slack.", active: 1, trigger: false },
  ];
  for (const owner of owners) {
    for (const [index, routine] of routines.entries()) {
      const routineId = `${owner.kind}-${routine.id}`;
      insert(db, owner.routines, {
        routine_id: routineId,
        [owner.owner]: owner.kind === "agent" ? "chief" : "ops",
        name: `Routine ${index}`,
        instruction: routine.instruction,
        active: routine.active,
        timezone: "Europe/Warsaw",
        created_at: STAMP,
        updated_at: STAMP,
        last_event_sequence: index + 1,
      });
      (owner.kind === "agent" ? seeded.agent : seeded.channel).push(routineId);
      if (!routine.trigger) continue;
      insert(db, owner.triggers, {
        trigger_id: `${routineId}-trigger`,
        routine_id: routineId,
        schedule_json: '{"kind":"daily","time":"09:00"}',
        next_run_at: "2026-10-02T07:00:00.000Z",
        created_at: STAMP,
        updated_at: STAMP,
        last_event_sequence: 10 + index,
      });
      insert(db, owner.runs, {
        run_id: `${routineId}-run`,
        routine_id: routineId,
        [owner.owner]: owner.kind === "agent" ? "chief" : "ops",
        trigger_id: `${routineId}-trigger`,
        run_kind: "scheduled",
        scheduled_for: STAMP,
        routine_name: `Routine ${index}`,
        instruction: routine.instruction,
        [owner.handle]: `${routineId}-handle`,
        status: "succeeded",
        error: null,
        created_at: STAMP,
        updated_at: STAMP,
        last_event_sequence: 20 + index,
      });
    }
  }
  return seeded;
}

type Contents = Record<string, Record<string, SQLOutputValue>[]>;

function contents(db: DatabaseSync): Contents {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

function schema(db: DatabaseSync): Array<{ type: string; name: string; sql: string }> {
  return db
    .prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
    .all()
    .map((row) => ({ type: String(row.type), name: String(row.name), sql: String(row.sql) }));
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });
  expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 52 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

function details(db: DatabaseSync): Map<string, HxRoutineDetail | null> {
  return new Map(
    db
      .prepare("SELECT owner_kind, routine_id, detail_json FROM hx_routine_detail ORDER BY owner_kind, routine_id")
      .all()
      .map((row) => [`${String(row.owner_kind)}:${String(row.routine_id)}`, hxDecodeRoutineDetail(row.detail_json)]),
  );
}

function expectedDetails(kinds: readonly ("agent" | "channel")[]): Map<string, HxRoutineDetail> {
  const zone = { confirmed: false };
  const expected = new Map<string, HxRoutineDetail>();
  for (const kind of kinds) {
    expected.set(`${kind}:${kind}-plain`, { zone, upgrade: { at: AT, changes: ["zone-unconfirmed"] } });
    expected.set(`${kind}:${kind}-sends`, {
      zone,
      confirm: { mode: "each", actions: ["send"], since: "upgrade" },
      upgrade: { at: AT, changes: ["zone-unconfirmed", "confirm-each"] },
    });
    expected.set(`${kind}:${kind}-to-me`, { zone, upgrade: { at: AT, changes: ["zone-unconfirmed"] } });
    expected.set(`${kind}:${kind}-deletes`, {
      zone,
      confirm: { mode: "each", actions: ["delete"], since: "upgrade" },
      upgrade: { at: AT, changes: ["zone-unconfirmed", "confirm-each"] },
    });
    expected.set(`${kind}:${kind}-no-trigger`, {
      confirm: { mode: "each", actions: ["publish"], since: "upgrade" },
      upgrade: { at: AT, changes: ["confirm-each"] },
    });
  }
  return expected;
}

describe("migration 59: HXBot's routine tables", () => {
  for (const source of SOURCES) {
    it(`keeps every row from released schema ${source}, adds empty tables, and MIG-03 marks each old routine once`, () => {
      const db = databaseAt(source);
      seed(db, source);
      if (source < 58) migrateUpTo(db, 58);
      const before = contents(db);
      migrateHxBotDatabase(db);
      expect(contents(db)).toEqual({ ...before, ...HX_TABLES });
      expectHealthy(db);

      const changed = hxUpgradeRoutinesV175(db, AT);
      const kinds = source >= CHANNEL_ROUTINES_SINCE ? (["agent", "channel"] as const) : (["agent"] as const);
      expect(changed).toHaveLength(kinds.length * 5);
      expect(details(db)).toEqual(expectedDetails(kinds));
      // Every upstream row is as it was: the pass writes only HXBot's tables.
      const after = contents(db);
      for (const table of Object.keys(before)) expect(after[table], table).toEqual(before[table]);
      expect(db.prepare("SELECT key FROM hx_meta").all()).toEqual([{ key: HX_UPGRADE_V175_KEY }]);
      // Once: a second start changes nothing.
      expect(hxUpgradeRoutinesV175(db, "2026-12-01T00:00:00.000Z")).toEqual([]);
      expect(details(db)).toEqual(expectedDetails(kinds));
      expectHealthy(db);
    });
  }

  it("builds the same HXBot tables in a new database, where the pass finds nothing to mark", () => {
    const created = new DatabaseSync(":memory:");
    databases.push(created);
    migrateHxBotDatabase(created);
    const upgraded = databaseAt(58);
    migrateHxBotDatabase(upgraded);
    const hxSchema = (db: DatabaseSync) =>
      db.prepare("SELECT type, name FROM sqlite_master WHERE name LIKE 'hx\\_%' ESCAPE '\\' ORDER BY type, name").all();
    expect(hxSchema(created)).toEqual(hxSchema(upgraded));
    expect(hxSchema(created)).toHaveLength(12);
    expect(hxUpgradeRoutinesV175(created, AT)).toEqual([]);
    expect(created.prepare("SELECT key FROM hx_meta").all()).toEqual([{ key: HX_UPGRADE_V175_KEY }]);
    expectHealthy(created);
  });

  it("rolls back the tables and the marker after a late failure, then retries", () => {
    const db = databaseAt(58);
    seed(db, 58);
    const before = contents(db);
    const schemaBefore = schema(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=59
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateHxBotDatabase(db)).toThrow("migration to version 59 failed");
    expect(contents(db)).toEqual(before);
    expect(schema(db).filter((entry) => !entry.name.startsWith("fail_"))).toEqual(schemaBefore);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=59").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateHxBotDatabase(db);
    expect(contents(db)).toEqual({ ...before, ...HX_TABLES });
    expectHealthy(db);
  });

  it("keeps the tables and the rows that a development build made before the marker", () => {
    const db = databaseAt(58);
    seed(db, 58);
    db.exec(`CREATE TABLE hx_meta (key TEXT PRIMARY KEY CHECK(length(key) BETWEEN 1 AND 128), value TEXT NOT NULL,
      updated_at TEXT NOT NULL)`);
    db.exec(`INSERT INTO hx_meta VALUES ('dev', '{}', '${AT}')`);
    migrateHxBotDatabase(db);
    expect(db.prepare("SELECT key FROM hx_meta").all()).toEqual([{ key: "dev" }]);
    expectHealthy(db);
  });

  it("rejects newer and incomplete histories before it adds a table, and an older application refuses version 59", () => {
    const db = databaseAt(58);
    seed(db, 58);
    const before = contents(db);
    const schemaBefore = schema(db);
    db.exec("INSERT INTO schema_migrations VALUES(60,'now')");
    expect(() => migrateHxBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=41");
    expect(() => migrateHxBotDatabase(db)).toThrow("missing version 41");
    expect(contents(db)).toEqual(before);
    expect(schema(db)).toEqual(schemaBefore);

    const upgraded = databaseAt(58);
    migrateHxBotDatabase(upgraded);
    const after = contents(upgraded);
    // An application of the next release knows version 60 at most; to this one, 60 is newer than it supports.
    upgraded.exec("INSERT INTO schema_migrations VALUES(60,'now')");
    expect(() => migrateHxBotDatabase(upgraded)).toThrow("newer than this application supports");
    expect(contents(upgraded)).toEqual(after);
  });

  it("removes the rows of a deleted routine and run, also when the agent's routines or the channel go", () => {
    const db = databaseAt(58);
    seed(db, 58);
    migrateHxBotDatabase(db);
    hxUpgradeRoutinesV175(db, AT);
    const confirm = db.prepare(
      `INSERT INTO hx_routine_confirmations (confirmation_id, owner_kind, owner_id, routine_id, trigger_id,
         scheduled_for, reason, preview, actions_json, state, created_at, expires_at)
       VALUES (?, ?, ?, ?, NULL, ?, 'catch-up', 'preview', '["send"]', 'waiting', ?, ?)`,
    );
    const runDetail = db.prepare(
      "INSERT INTO hx_run_detail (owner_kind, run_id, routine_id, detail_json, updated_at) VALUES (?, ?, ?, '{}', ?)",
    );
    for (const kind of ["agent", "channel"]) {
      confirm.run(`${kind}-1`, kind, kind === "agent" ? "chief" : "ops", `${kind}-sends`, STAMP, AT, AT);
      runDetail.run(kind, `${kind}-sends-run`, `${kind}-sends`, AT);
      runDetail.run(kind, `${kind}-plain-run`, `${kind}-plain`, AT);
    }
    // A run deleted on its own takes its detail with it.
    db.exec("DELETE FROM projection_routine_runs WHERE run_id = 'agent-plain-run'");
    expect(db.prepare("SELECT run_id FROM hx_run_detail WHERE owner_kind='agent' ORDER BY run_id").all()).toEqual([
      { run_id: "agent-sends-run" },
    ]);
    // A routine deleted with its runs (ON DELETE CASCADE) takes every row of its own.
    db.exec("DELETE FROM projection_agent_routines WHERE routine_id = 'agent-sends'");
    expect(db.prepare("SELECT * FROM hx_run_detail WHERE owner_kind='agent'").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM hx_routine_confirmations WHERE owner_kind='agent'").all()).toEqual([]);
    expect(db.prepare("SELECT routine_id FROM hx_routine_detail WHERE routine_id='agent-sends'").all()).toEqual([]);
    // Deleting the agent's routines, as removing the agent does.
    db.exec("DELETE FROM projection_agent_routines WHERE agent_id = 'chief'");
    expect(db.prepare("SELECT * FROM hx_routine_detail WHERE owner_kind='agent'").all()).toEqual([]);
    // A deleted channel takes its routines (ON DELETE CASCADE), their runs and every HXBot row of theirs.
    db.exec("DELETE FROM projection_channels WHERE channel_id = 'ops'");
    expect(db.prepare("SELECT COUNT(*) AS count FROM projection_channel_routines").get()).toEqual({ count: 0 });
    expect(contents(db).hx_routine_detail).toEqual([]);
    expect(contents(db).hx_run_detail).toEqual([]);
    expect(contents(db).hx_routine_confirmations).toEqual([]);
    expectHealthy(db);
  });

  it("refuses values that HXBot cannot read", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    migrateHxBotDatabase(db);
    const bad = [
      "INSERT INTO hx_routine_detail VALUES ('agent', 'r', 'not json', 'now')",
      "INSERT INTO hx_routine_detail VALUES ('robot', 'r', '{}', 'now')",
      "INSERT INTO hx_run_detail VALUES ('agent', 'run', 'r', '{', 'now')",
      `INSERT INTO hx_routine_confirmations (confirmation_id, owner_kind, owner_id, routine_id, scheduled_for, reason,
         preview, actions_json, state, created_at, expires_at) VALUES ('c', 'agent', 'a', 'r', 's', 'catch-up', 'p',
         '[]', 'maybe', 'now', 'later')`,
      `INSERT INTO hx_routine_confirmations (confirmation_id, owner_kind, owner_id, routine_id, scheduled_for, reason,
         preview, actions_json, state, created_at, expires_at) VALUES ('c', 'agent', 'a', 'r', 's', 'always', 'p',
         '[]', 'waiting', 'now', 'later')`,
      "INSERT INTO hx_external_actions VALUES ('k', 's', NULL, 'launch', NULL, 'done', NULL, 'now', 'now')",
      "INSERT INTO hx_external_actions VALUES ('k', 's', NULL, 'send', NULL, 'maybe', NULL, 'now', 'now')",
      "INSERT INTO hx_meta VALUES ('', 'v', 'now')",
    ];
    for (const statement of bad) expect(() => db.exec(statement), statement).toThrow(/constraint failed/u);
    db.exec(`INSERT INTO hx_routine_confirmations (confirmation_id, owner_kind, owner_id, routine_id, scheduled_for,
      reason, preview, actions_json, state, created_at, expires_at) VALUES ('c1', 'agent', 'a', 'r', 's', 'each', 'p',
      '[]', 'waiting', 'now', 'later')`);
    // One confirmation for each occurrence of a routine.
    expect(() =>
      db.exec(`INSERT INTO hx_routine_confirmations (confirmation_id, owner_kind, owner_id, routine_id, scheduled_for,
        reason, preview, actions_json, state, created_at, expires_at) VALUES ('c2', 'agent', 'a', 'r', 's', 'each', 'p',
        '[]', 'waiting', 'now', 'later')`),
    ).toThrow(/UNIQUE constraint failed/u);
  });
});

describe("MIG-03 pass", () => {
  it("keeps the work of a development build, and marks only the routines it has not seen", () => {
    const db = databaseAt(58);
    seed(db, 58);
    migrateHxBotDatabase(db);
    db.exec(`INSERT INTO hx_routine_detail VALUES ('agent', 'agent-sends', '{"zone":{"confirmed":true}}', '${STAMP}')`);
    const changed = hxUpgradeRoutinesV175(db, AT);
    expect(changed.map((routine) => routine.routineId)).not.toContain("agent-sends");
    expect(details(db).get("agent:agent-sends")).toEqual({ zone: { confirmed: true } });
  });

  it("writes nothing when it fails, and does all of it on the next start", () => {
    const db = databaseAt(58);
    seed(db, 58);
    migrateHxBotDatabase(db);
    db.exec(`CREATE TEMP TRIGGER fail_meta BEFORE INSERT ON hx_meta BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);
    expect(() => hxUpgradeRoutinesV175(db, AT)).toThrow("disk full");
    expect(contents(db).hx_routine_detail).toEqual([]);
    expect(contents(db).hx_meta).toEqual([]);
    db.exec("DROP TRIGGER fail_meta");
    expect(hxUpgradeRoutinesV175(db, AT)).toHaveLength(10);
    expect(details(db)).toEqual(expectedDetails(["agent", "channel"]));
  });

  it("works inside a transaction that the caller holds, and rolls back only its own part", () => {
    const db = databaseAt(58);
    seed(db, 58);
    migrateHxBotDatabase(db);
    db.exec("BEGIN");
    db.exec(`CREATE TEMP TRIGGER fail_meta BEFORE INSERT ON hx_meta BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);
    expect(() => hxUpgradeRoutinesV175(db, AT)).toThrow("disk full");
    expect(db.isTransaction).toBe(true);
    db.exec("DROP TRIGGER fail_meta");
    hxUpgradeRoutinesV175(db, AT);
    db.exec("COMMIT");
    expect(details(db).size).toBe(10);
  });

  it("marks a thousand routines in one pass", () => {
    const db = databaseAt(58);
    migrateHxBotDatabase(db);
    for (let index = 0; index < 1000; index += 1) {
      insert(db, "projection_agent_routines", {
        routine_id: `bulk-${index}`,
        agent_id: "chief",
        name: `Bulk ${index}`,
        instruction: index % 2 === 0 ? "Send the report to the team." : "Collect the news.",
        active: 1,
        timezone: "UTC",
        created_at: STAMP,
        updated_at: STAMP,
        last_event_sequence: index,
      });
    }
    const changed = hxUpgradeRoutinesV175(db, AT);
    // No trigger: only the ones that send are marked.
    expect(changed).toHaveLength(500);
    expect(changed.every((routine) => routine.changes.join() === "confirm-each")).toBe(true);
  });
});

describe("migration 59 external action words", () => {
  it.each([
    ["每天发消息给团队群", ["send"]],
    ["检查邮箱，回复邮件", ["send"]],
    ["推送到企业微信群", ["send"]],
    ["发到群里", ["send"]],
    ["发给我和张三", ["send"]],
    ["发给我们团队", ["send"]],
    ["发布周报到网站", ["publish"]],
    ["每周五付款给供应商", ["pay"]],
    ["买入 100 股", ["pay"]],
    ["删除临时文件", ["delete"]],
    ["清空回收站并转账", ["pay", "delete"]],
    ["Email the team the report", ["send"]],
    ["Send me and Bob the notes", ["send"]],
    ["Reply to new messages", ["send"]],
    ["Message Alex the status", ["send"]],
    ["Post the release notes to Slack", ["publish"]],
    ["Pay the invoice", ["pay"]],
    ["Remove old logs", ["delete"]],
    ["ＳＥＮＤ the digest to the list", ["send"]],
  ])("finds an external action in %j", (instruction, kinds) => {
    expect(v59ExternalActionKinds(instruction)).toEqual(kinds);
  });

  it.each([
    "每天早上总结新闻发给我",
    "把日报发送给我",
    "推送给我",
    "发到我的邮箱",
    "整理下载文件夹",
    "Summarize my email",
    "Send me a summary",
    "send it to me",
    "Summarize the latest blog post",
    "Read the message and summarize",
    "Check the weather",
    "",
  ])("finds none in %j: a report to the person is not an external action", (instruction) => {
    expect(v59ExternalActionKinds(instruction)).toEqual([]);
  });
});
