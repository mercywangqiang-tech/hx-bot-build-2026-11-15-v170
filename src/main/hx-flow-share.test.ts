import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HX_FLOW_SHARE_STALE_MS, HxFlowShare, hxSharedTurnLimit } from "./hx-flow-share";

function setup() {
  const folder = mkdtempSync(join(tmpdir(), "hx-flow-share-"));
  let now = 1_000_000;
  const running = new Set([100, 200, 300]);
  const make = (pid: number) => new HxFlowShare({ folder, pid, now: () => now, alive: (other) => running.has(other) });
  return {
    folder,
    make,
    advance: (ms: number) => {
      now += ms;
    },
    end: (pid: number) => running.delete(pid),
  };
}

describe("HxFlowShare", () => {
  it("counts the turns of the other HXBot processes, not its own", () => {
    const { make } = setup();
    const desktop = make(100);
    const server = make(200);
    desktop.write(3);
    server.write(2);
    expect(desktop.others()).toBe(2);
    expect(server.others()).toBe(3);
  });

  it("leaves out a process that stopped writing, and removes the file of a process that is gone", () => {
    const { folder, make, advance, end } = setup();
    const desktop = make(100);
    make(200).write(4);
    make(300).write(5);
    expect(desktop.others()).toBe(9);
    end(300);
    expect(desktop.others()).toBe(4);
    expect(readdirSync(folder).sort()).toEqual(["200.json"]);
    advance(HX_FLOW_SHARE_STALE_MS + 1);
    expect(desktop.others()).toBe(0);
  });

  it("reads a damaged file as nothing, and works without the folder", () => {
    const { folder, make } = setup();
    writeFileSync(join(folder, "200.json"), "{not json");
    writeFileSync(join(folder, "300.json"), JSON.stringify({ running: -1, at: 1_000_000 }));
    writeFileSync(join(folder, "notes.txt"), "x");
    expect(make(100).others()).toBe(0);
    const lost = new HxFlowShare({ folder: join(folder, "missing", "deeper"), pid: 100 });
    expect(lost.others()).toBe(0);
  });

  it("removes its own file at close and remembers what it wrote", () => {
    const { folder, make } = setup();
    const desktop = make(100);
    expect(desktop.written()).toBeNull();
    desktop.write(2);
    expect(desktop.written()).toBe(2);
    desktop.close();
    expect(readdirSync(folder)).toEqual([]);
  });
});

describe("hxSharedTurnLimit", () => {
  it("is B less the turns of the others, never below 1", () => {
    expect(hxSharedTurnLimit(6, 0)).toBe(6);
    expect(hxSharedTurnLimit(6, 4)).toBe(2);
    expect(hxSharedTurnLimit(6, 9)).toBe(1);
  });
});
