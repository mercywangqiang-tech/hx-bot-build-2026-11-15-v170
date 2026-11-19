// HXBot（v1.7.3 紧急修正）：边干活边更新（hx-update-resume.ts、requested-update.ts 的接线）。
//
// 用户 2026-11-19：“边干活便更新，更新完，保存，然后重启！”
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpdateStatus } from "@hxbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HX_UPDATE_RESUME_MAX_AGE_MS,
  HxUpdateRestartKeeper,
  hxContinueAfterUpdate,
  hxTakeUpdateResume,
  hxUpdateResumeText,
  hxWriteUpdateResume,
} from "./hx-update-resume";
import { RequestedUpdate } from "./requested-update";
import { takeRoutineHold } from "./routine-hold-file";
import type { RestartReadiness } from "./update-readiness";

const folders: string[] = [];
afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});
function folder(): string {
  const path = mkdtempSync(join(tmpdir(), "hx-update-resume-"));
  folders.push(path);
  return path;
}

/** Waits for a state that the timers of the code under test reach. */
async function until(condition: () => boolean, what: string): Promise<void> {
  await vi.waitFor(
    () => {
      if (!condition()) throw new Error(`Not yet: ${what}`);
    },
    { timeout: 5_000, interval: 1 },
  );
}

describe("the list of agents that the update restart cut off", () => {
  it("is read once, and then gone", () => {
    const path = join(folder(), "resume.json");
    hxWriteUpdateResume(path, { at: new Date(1_000), agentIds: ["a", "b", "a", ""] });
    const logs: string[] = [];
    expect(
      hxTakeUpdateResume(
        path,
        (line) => logs.push(line),
        () => 2_000,
      ),
    ).toEqual({
      at: new Date(1_000),
      agentIds: ["a", "b"],
    });
    expect(existsSync(path)).toBe(false);
    expect(hxTakeUpdateResume(path, (line) => logs.push(line))).toBeNull();
    expect(logs).toEqual([]);
  });

  it("is dropped when it is too old, from the future, damaged or of another version", () => {
    const path = join(folder(), "resume.json");
    hxWriteUpdateResume(path, { at: new Date(0), agentIds: ["a"] });
    expect(
      hxTakeUpdateResume(
        path,
        () => undefined,
        () => HX_UPDATE_RESUME_MAX_AGE_MS + 1,
      ),
    ).toBeNull();
    hxWriteUpdateResume(path, { at: new Date(10_000), agentIds: ["a"] });
    expect(
      hxTakeUpdateResume(
        path,
        () => undefined,
        () => 5_000,
      ),
    ).toBeNull();
    // A crash in the middle of the write leaves a part of the file.
    writeFileSync(path, '{"version":1,"at":"2026-11-19T10:00');
    expect(hxTakeUpdateResume(path, () => undefined)).toBeNull();
    expect(existsSync(path)).toBe(false);
    writeFileSync(path, JSON.stringify({ version: 2, at: new Date().toISOString(), agentIds: ["a"] }));
    expect(hxTakeUpdateResume(path, () => undefined)).toBeNull();
    writeFileSync(path, JSON.stringify({ version: 1, at: "not a date", agentIds: ["a"] }));
    expect(hxTakeUpdateResume(path, () => undefined)).toBeNull();
  });

  it("tells each agent that still exists to continue, and goes on after one that fails", async () => {
    const path = join(folder(), "resume.json");
    hxWriteUpdateResume(path, { at: new Date(), agentIds: ["gone", "fails", "works"] });
    const told: [string, string][] = [];
    const logs: string[] = [];
    const count = await hxContinueAfterUpdate({
      resumePath: path,
      version: "0.67.13",
      agentExists: (id) => id !== "gone",
      continueAgent: async (id, text) => {
        if (id === "fails") throw new Error("mailbox closed");
        told.push([id, text]);
      },
      log: (line) => logs.push(line),
    });
    expect(count).toBe(1);
    expect(told).toEqual([["works", hxUpdateResumeText("0.67.13")]]);
    expect(told[0]?.[1]).toContain("0.67.13");
    expect(logs.some((line) => line.includes("mailbox closed"))).toBe(true);
    expect(existsSync(path)).toBe(false);
    // Nothing to do at the next start.
    expect(
      await hxContinueAfterUpdate({
        resumePath: path,
        version: "0.67.13",
        agentExists: () => true,
        continueAgent: async () => undefined,
        log: () => undefined,
      }),
    ).toBe(0);
  });
});

describe("the keeper of the update restart", () => {
  function keeper(agentsInTurn: string[] = []) {
    const root = folder();
    const calls: string[] = [];
    const routineHoldPath = join(root, "routine-hold.json");
    const resumePath = join(root, "resume.json");
    let now = new Date("2026-11-19T10:00:00.000Z");
    const keep = new HxUpdateRestartKeeper({
      holdRoutines: () => calls.push("hold"),
      releaseRoutines: () => calls.push("release"),
      routineHoldPath,
      resumePath,
      agentsInTurn: () => agentsInTurn,
      log: () => undefined,
      now: () => now,
    });
    return {
      keep,
      calls,
      routineHoldPath,
      resumePath,
      later: (ms: number) => {
        now = new Date(now.getTime() + ms);
      },
    };
  }

  it("holds the routines once while the restart waits and lets them go when it no longer waits", () => {
    const { keep, calls } = keeper();
    keep.hold(true);
    keep.hold(true);
    keep.hold(false);
    keep.hold(false);
    expect(calls).toEqual(["hold", "release"]);
  });

  it("saves the held routines and the agents in a turn, so that the next start continues both", () => {
    const { keep, routineHoldPath, resumePath, later } = keeper(["writer", "reviewer"]);
    keep.hold(true);
    later(60_000);
    keep.beforeRestart(["agent-turn", "queued-delivery"]);
    expect(takeRoutineHold(routineHoldPath, () => undefined)).toEqual({
      since: new Date("2026-11-19T10:00:00.000Z"),
      until: new Date("2026-11-19T10:01:00.000Z"),
    });
    expect(JSON.parse(readFileSync(resumePath, "utf8"))).toMatchObject({
      version: 1,
      agentIds: ["writer", "reviewer"],
    });
  });

  it("tells nobody to continue after a restart at idle", () => {
    const { keep, resumePath } = keeper(["writer"]);
    keep.beforeRestart([]);
    expect(existsSync(resumePath)).toBe(false);
  });

  it("removes what it saved when the restart does not happen", () => {
    const { keep, routineHoldPath, resumePath } = keeper(["writer"]);
    keep.hold(true);
    keep.beforeRestart(["agent-turn"]);
    expect(existsSync(routineHoldPath) && existsSync(resumePath)).toBe(true);
    keep.hold(false);
    expect(existsSync(routineHoldPath) || existsSync(resumePath)).toBe(false);
  });

  it("never throws, also when the data folder cannot be written", () => {
    const keep = new HxUpdateRestartKeeper({
      holdRoutines: () => undefined,
      releaseRoutines: () => undefined,
      routineHoldPath: join(folder(), "missing", "routine-hold.json"),
      resumePath: join(folder(), "missing", "resume.json"),
      agentsInTurn: () => ["writer"],
      log: () => undefined,
    });
    keep.hold(true);
    expect(() => keep.beforeRestart(["agent-turn"])).not.toThrow();
  });
});

describe("the automatic restart into a new version", () => {
  function setup(options: { reasons?: () => string[]; idleWaitMs?: number } = {}) {
    let status: UpdateStatus = {
      phase: "ready",
      currentVersion: "0.67.12",
      availableVersion: "0.67.13",
      progress: 100,
      checkedAt: null,
      message: null,
      errorCode: null,
    };
    const listeners = new Set<(next: UpdateStatus) => void>();
    const events: string[] = [];
    let now = 0;
    let installs = 0;
    let checks = 0;
    const updater = {
      getStatus: () => status,
      checkForUpdates: () => Effect.succeed(status),
      downloadUpdate: () => Effect.succeed(status),
      installUpdate: () =>
        Effect.sync(() => {
          installs += 1;
          events.push("install");
          status = { ...status, phase: "installing" };
        }),
      setScheduledRestart: () => undefined,
      getAutoDownload: () => true,
      setAutoDownload: () => Effect.void,
      on: (_event: "status", listener: (next: UpdateStatus) => void) => listeners.add(listener),
      off: (_event: "status", listener: (next: UpdateStatus) => void) => listeners.delete(listener),
    };
    const readiness = (): RestartReadiness => {
      checks += 1;
      const reasons = options.reasons?.() ?? [];
      return { safeToRestart: reasons.length === 0, reasons };
    };
    const restart = new RequestedUpdate({
      updater,
      describeReadiness: readiness,
      preference: { autoDownload: true, allowRemoteUpdates: true, autoInstall: true },
      savePreference: () => Effect.succeed({ autoDownload: true, allowRemoteUpdates: true, autoInstall: true }),
      log: () => undefined,
      pollMs: 1,
      graceMs: 1,
      automaticGraceMs: () => 1,
      hxIdleWaitMs: options.idleWaitMs ?? 10 * 60_000,
      hxHoldRoutines: (held) => events.push(held ? "hold" : "release"),
      hxBeforeRestart: (waitingFor) => events.push(`before:${waitingFor.join("+")}`),
      hxNow: () => now,
    });
    return {
      restart,
      events,
      installs: () => installs,
      checks: () => checks,
      later: (ms: number) => {
        now += ms;
      },
    };
  }

  it("restarts at once when the agents are idle, after the routines were held", async () => {
    const { restart, events, installs } = setup();
    await until(() => installs() === 1, "the install");
    expect(events).toEqual(["hold", "before:", "install"]);
    await Effect.runPromise(restart.dispose());
  });

  it("waits for working agents, and after the longest wait saves who it cuts off and restarts", async () => {
    let reasons = ["agent-turn", "queued-delivery"];
    const { restart, events, installs, checks, later } = setup({ reasons: () => reasons });
    await until(() => restart.snapshot().restart?.waitingFor.length === 2, "the wait");
    expect(installs()).toBe(0);
    later(10 * 60_000 - 1);
    const before = checks();
    await until(() => checks() >= before + 3, "three more checks of the agents");
    expect(installs()).toBe(0);
    later(1);
    await until(() => installs() === 1, "the install after the longest wait");
    expect(events).toEqual(["hold", "before:agent-turn+queued-delivery", "install"]);
    reasons = [];
    await Effect.runPromise(restart.dispose());
  });

  it("never cuts off the start of HXBot or the updater itself", async () => {
    const { restart, installs, checks, later } = setup({ reasons: () => ["initialization"] });
    await until(() => restart.snapshot().restart?.waitingFor[0] === "initialization", "the wait");
    later(60 * 60_000);
    const before = checks();
    await until(() => checks() >= before + 3, "three more checks");
    expect(installs()).toBe(0);
    await Effect.runPromise(restart.dispose());

    const updating = setup({ reasons: () => ["update-operation"] });
    await until(() => updating.restart.snapshot().restart?.waitingFor[0] === "update-operation", "the wait");
    updating.later(60 * 60_000);
    const start = updating.checks();
    await until(() => updating.checks() >= start + 3, "three more checks");
    expect(updating.installs()).toBe(0);
    await Effect.runPromise(updating.restart.dispose());
  });

  it("lets the routines go when the user cancels the restart", async () => {
    const { restart, events, installs } = setup({ reasons: () => ["agent-turn"] });
    await until(() => restart.snapshot().restart !== null, "the schedule");
    restart.cancel();
    expect(events).toEqual(["hold", "release"]);
    expect(installs()).toBe(0);
    await Effect.runPromise(restart.dispose());
  });

  it("lets the routines go when a member's restart replaces the automatic one", async () => {
    const { restart, events } = setup({ reasons: () => ["agent-turn"] });
    await until(() => restart.snapshot().restart !== null, "the schedule");
    await Effect.runPromise(restart.start({ id: "m1", name: "Member" }, "when-idle"));
    expect(events).toEqual(["hold", "release"]);
    await Effect.runPromise(restart.dispose());
  });
});
