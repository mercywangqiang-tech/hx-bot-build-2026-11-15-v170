// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateHxBotDatabase } from "../hxbot-database-schema";
import {
  hxDecodeRoutineDetail,
  hxDecodeRunDetail,
  hxReadRoutineDetail,
  hxReadRunDetail,
  hxRoutineFlags,
  hxRunFlags,
  hxWriteRoutineDetail,
  hxWriteRunDetail,
} from "./detail";

// HXBot v1.7.5: HXBot's own routine and run detail.
// Failure modes: a field of the wrong shape reaches the editor; a row that a later build wrote
// loses that build's fields when this one writes; a broken row stops the read; a removed field
// comes back from the stored row.

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  migrateHxBotDatabase(db);
  return db;
}

function stored(db: DatabaseSync, table: "hx_routine_detail" | "hx_run_detail", id: string): string {
  const column = table === "hx_routine_detail" ? "routine_id" : "run_id";
  const row = db.prepare(`SELECT detail_json FROM ${table} WHERE ${column} = ?`).get(id);
  return String(row?.detail_json);
}

describe("routine detail decoding", () => {
  it("keeps every field of the right shape", () => {
    const detail = {
      zone: { confirmed: false, at: "2026-11-20T00:00:00.000Z" },
      confirm: { mode: "each", actions: ["send", "pay"], since: "user" },
      upgrade: { at: "2026-11-20T00:00:00.000Z", changes: ["zone-unconfirmed"], seenAt: "2026-11-20T01:00:00.000Z" },
      pendingCatchUp: {
        scheduledFor: "2026-11-20T02:00:00.000Z",
        total: 3,
        from: "2026-11-19T00:00:00.000Z",
        until: "2026-11-20T00:00:00.000Z",
      },
    };
    expect(hxDecodeRoutineDetail(JSON.stringify(detail))).toEqual(detail);
  });

  it("leaves out each field of the wrong shape, and each unknown action or change", () => {
    expect(
      hxDecodeRoutineDetail(
        JSON.stringify({
          zone: { confirmed: "no" },
          confirm: { mode: "each", actions: ["send", "teleport", 3], since: "elsewhere" },
          upgrade: { at: 5, changes: [] },
          pendingCatchUp: { scheduledFor: "x", total: -1, from: "a", until: "b" },
        }),
      ),
    ).toEqual({ confirm: { mode: "each", actions: ["send"], since: "upgrade" } });
    expect(
      hxDecodeRoutineDetail(JSON.stringify({ upgrade: { at: "t", changes: ["zone-unconfirmed", "later"] } })),
    ).toEqual({ upgrade: { at: "t", changes: ["zone-unconfirmed"] } });
    expect(
      hxDecodeRoutineDetail(
        JSON.stringify({ pendingCatchUp: { scheduledFor: "s", total: 1.5, from: "a", until: "b" } }),
      ),
    ).toEqual({});
  });

  it("reads text that is not an object as no detail", () => {
    for (const value of ["", "not json", "[]", "null", "42", '"text"', null, undefined, 7]) {
      expect(hxDecodeRoutineDetail(value)).toBeNull();
      expect(hxDecodeRunDetail(value)).toBeNull();
    }
  });
});

describe("run detail decoding", () => {
  it("keeps every field of the right shape", () => {
    const detail = {
      skip: { reason: "declined", at: "t" },
      missed: { total: 4, from: "a", until: "b", handled: "run-once", while: "asleep" },
      catchUp: { total: 4, from: "a", until: "b" },
      confirmed: { confirmationId: "c1", at: "t" },
      result: { kind: "unverified", at: "t", reasons: ["missing-file"] },
    };
    expect(hxDecodeRunDetail(JSON.stringify(detail))).toEqual(detail);
  });

  it("leaves out each field of the wrong shape", () => {
    expect(
      hxDecodeRunDetail(
        JSON.stringify({
          skip: { reason: "bored", at: "t" },
          missed: { total: 4, from: "a", until: "b", handled: "run-twice", while: "asleep" },
          catchUp: { total: "4", from: "a", until: "b" },
          confirmed: { confirmationId: 1, at: "t" },
          result: { kind: "done", at: "t", reasons: [] },
        }),
      ),
    ).toEqual({});
    expect(hxDecodeRunDetail(JSON.stringify({ result: { kind: "failed", at: "t", reasons: ["a", 2, null] } }))).toEqual(
      { result: { kind: "failed", at: "t", reasons: ["a"] } },
    );
  });
});

describe("writing detail", () => {
  it("keeps the fields a later build wrote, and never brings back a field this write removed", () => {
    const db = database();
    db.prepare(
      "INSERT INTO hx_routine_detail (owner_kind, routine_id, detail_json, updated_at) VALUES ('agent', 'r1', ?, 't0')",
    ).run(
      JSON.stringify({
        zone: { confirmed: false },
        pendingCatchUp: { scheduledFor: "s", total: 2, from: "a", until: "b" },
        later: { steps: [1, 2] },
      }),
    );
    const next = hxWriteRoutineDetail(
      db,
      "agent",
      "r1",
      ({ pendingCatchUp: _removed, ...detail }) => ({ ...detail, zone: { confirmed: true, at: "t1" } }),
      "t1",
    );
    expect(next).toEqual({ zone: { confirmed: true, at: "t1" } });
    expect(JSON.parse(stored(db, "hx_routine_detail", "r1"))).toEqual({
      later: { steps: [1, 2] },
      zone: { confirmed: true, at: "t1" },
    });
    expect(hxReadRoutineDetail(db, "agent", "r1")).toEqual({ zone: { confirmed: true, at: "t1" } });
  });

  it("refuses a row that is not JSON, and replaces a row that is JSON but not an object", () => {
    const db = database();
    const insert = db.prepare(
      "INSERT INTO hx_run_detail (owner_kind, run_id, routine_id, detail_json, updated_at) VALUES ('channel', 'run', 'r', ?, 't0')",
    );
    expect(() => insert.run("{broken")).toThrow("CHECK constraint failed");
    insert.run("[1, 2]");
    expect(hxReadRunDetail(db, "channel", "run")).toBeNull();
    hxWriteRunDetail(
      db,
      "channel",
      "run",
      "r",
      (detail) => ({ ...detail, skip: { reason: "expired", at: "t1" } }),
      "t1",
    );
    expect(JSON.parse(stored(db, "hx_run_detail", "run"))).toEqual({ skip: { reason: "expired", at: "t1" } });
  });

  it("keeps a run's later fields too", () => {
    const db = database();
    db.prepare(
      "INSERT INTO hx_run_detail (owner_kind, run_id, routine_id, detail_json, updated_at) VALUES ('agent', 'run', 'r', ?, 't0')",
    ).run(JSON.stringify({ steps: { done: 2 }, result: { kind: "failed", at: "t0", reasons: [] } }));
    hxWriteRunDetail(db, "agent", "run", "r", (detail) => ({
      ...detail,
      confirmed: { confirmationId: "c", at: "t1" },
    }));
    expect(JSON.parse(stored(db, "hx_run_detail", "run"))).toEqual({
      steps: { done: 2 },
      result: { kind: "failed", at: "t0", reasons: [] },
      confirmed: { confirmationId: "c", at: "t1" },
    });
  });
});

describe("what the editor reads", () => {
  it("shows an unconfirmed zone, asking before each run, and an upgrade not yet dismissed", () => {
    expect(
      hxRoutineFlags({
        zone: { confirmed: false },
        confirm: { mode: "each", actions: ["delete"], since: "upgrade" },
        upgrade: { at: "t", changes: ["zone-unconfirmed", "confirm-each"] },
      }),
    ).toEqual({
      zoneUnconfirmed: true,
      confirmEach: true,
      upgraded: { at: "t", changes: ["zone-unconfirmed", "confirm-each"] },
    });
    expect(
      hxRoutineFlags({ zone: { confirmed: true }, upgrade: { at: "t", changes: [], seenAt: "u" } }),
    ).toBeUndefined();
    expect(hxRoutineFlags(null)).toBeUndefined();
  });

  it("shows a run's skip, missed count, make-up count and result", () => {
    expect(
      hxRunFlags({
        skip: { reason: "previous-running", at: "t" },
        missed: { total: 2, from: "a", until: "b", handled: "skip", while: "closed" },
        catchUp: { total: 2, from: "a", until: "b" },
        result: { kind: "no-update", at: "t", reasons: [] },
      }),
    ).toEqual({
      skip: "previous-running",
      missed: { total: 2, from: "a", until: "b", handled: "skip", while: "closed" },
      catchUp: { total: 2 },
      result: "no-update",
    });
    expect(hxRunFlags({})).toBeUndefined();
    expect(hxRunFlags(undefined)).toBeUndefined();
  });
});
