import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type HxTeamRecord, HxTeamStore } from "./store";

let folder = "";

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "hx-team-store-"));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function team(id: string, extra: Partial<HxTeamRecord> = {}): HxTeamRecord {
  return {
    id,
    channelId: `room-${id}`,
    roomName: "协作 · x",
    starterAgentId: "s",
    language: "zh",
    goal: "x",
    folder: null,
    leadAgentId: "l",
    members: [],
    steps: [],
    facts: [],
    files: [],
    requests: [],
    createdAt: `2026-11-14T0${id}:00:00.000Z`,
    deadline: "2026-11-14T12:00:00.000Z",
    limits: { members: 5, minutes: 120, rounds: 20, temporary: "collapse" },
    state: "running",
    endedAt: null,
    result: null,
    reason: null,
    seen: {},
    failures: {},
    delivered: false,
    skills: [],
    ...extra,
  };
}

describe("HxTeamStore", () => {
  it("keeps each team in its own file and reads them back", () => {
    const store = new HxTeamStore();
    store.open(folder);
    store.save(team("1"));
    store.save(team("2", { state: "done" }));
    store.save(team("3", { starterAgentId: "other" }));
    expect(JSON.parse(readFileSync(join(folder, "1.json"), "utf8")).id).toBe("1");

    const again = new HxTeamStore();
    again.open(folder);
    expect(again.list().map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(again.running().map((item) => item.id)).toEqual(["1", "3"]);
    expect(again.startedBy("s").map((item) => item.id)).toEqual(["2", "1"]);
    expect(again.byChannel("room-3")?.id).toBe("3");
    expect(again.byChannel("nothing")).toBeNull();
  });

  it("skips a damaged file and a file that is not a team, and keeps going", () => {
    writeFileSync(join(folder, "bad.json"), "{ not json");
    writeFileSync(join(folder, "other.json"), JSON.stringify({ hello: 1 }));
    writeFileSync(join(folder, "note.txt"), "x");
    const store = new HxTeamStore();
    store.open(folder);
    store.save(team("1"));
    const again = new HxTeamStore();
    again.open(folder);
    expect(again.list().map((item) => item.id)).toEqual(["1"]);
  });

  it("fills the fields that an older record does not have", () => {
    const { seen: _seen, failures: _failures, delivered: _delivered, ...older } = team("1");
    writeFileSync(join(folder, "1.json"), JSON.stringify(older));
    const store = new HxTeamStore();
    store.open(folder);
    expect(store.get("1")).toMatchObject({ seen: {}, failures: {}, delivered: false });
  });

  it("works in memory before a folder is open", () => {
    const store = new HxTeamStore();
    store.save(team("1"));
    expect(store.get("1")?.id).toBe("1");
  });
});
