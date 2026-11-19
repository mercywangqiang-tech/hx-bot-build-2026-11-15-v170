import { isAgentTask, isQueueSnapshot } from "@hxbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { isAgentTask as releasedIsAgentTask } from "./fixtures/released-0.67.9-ipc-agent-tasks";
import { isQueueSnapshot as releasedIsQueueSnapshot } from "./fixtures/released-0.67.9-ipc-queue";
import { HxHoldDetails } from "./hold-detail";
import type { HxFlowCandidate } from "./ledger";
import { HxProviderGate } from "./provider-gate";

const at = "2026-11-19T08:00:00.000Z";
const delivery = {
  id: "d1",
  messageId: "m1",
  recipientAgentId: "a1",
  sender: { kind: "user" as const },
  text: "整理一下这三个表",
  attachments: [],
  replyToMessageId: null,
  status: "queued" as const,
  position: 2,
  turnId: null,
  error: null,
  createdAt: at,
};
const task = {
  id: "t1",
  agentId: "a1",
  threadId: "th1",
  origin: "user" as const,
  title: "整理表格",
  state: "queued" as const,
  outcome: null,
  hold: "server-busy" as const,
  activeTurnId: null,
  progress: null,
  error: null,
  queuedMessages: [{ deliveryId: "d1", text: "整理一下这三个表", createdAt: at }],
  queue: [delivery],
  createdAt: at,
  updatedAt: at,
  closedAt: null,
};
const detail = { kind: "provider" as const, position: 3, etaSeconds: 120 };

describe("CONC-09-A1: the released 0.67.9 decoders read a message with holdDetail", () => {
  it("decodes a task and a chat queue of 0.67.14, with and without the new field", () => {
    for (const value of [task, { ...task, holdDetail: detail }]) {
      expect(releasedIsAgentTask(value)).toBe(true);
      expect(isAgentTask(value)).toBe(true);
    }
    const queue = { agentId: "a1", deliveries: [delivery] };
    for (const value of [queue, { ...queue, holdDetail: detail }, { ...queue, hold: null, holdDetail: detail }]) {
      expect(releasedIsQueueSnapshot(value)).toBe(true);
      expect(isQueueSnapshot(value)).toBe(true);
    }
  });

  it("refuses a holdDetail that is not one (the new decoder), never a valid one", () => {
    for (const bad of [
      { kind: "network", position: 1, etaSeconds: 1 },
      { kind: "machine", position: 0, etaSeconds: 1 },
      { kind: "machine", position: 1.5, etaSeconds: 1 },
      { kind: "machine", position: 1, etaSeconds: -1 },
      { kind: "machine", position: 1, etaSeconds: 2_000_000 },
      "machine",
      null,
    ]) {
      expect(isAgentTask({ ...task, holdDetail: bad })).toBe(false);
      expect(isQueueSnapshot({ agentId: "a1", deliveries: [], holdDetail: bad })).toBe(false);
    }
    for (const good of [
      { kind: "machine", position: 1, etaSeconds: 0 },
      { kind: "team-queue", position: null, etaSeconds: null },
      { kind: "screen", position: 2, etaSeconds: 30 },
      { kind: "user-active", position: null, etaSeconds: 5 },
    ])
      expect(isAgentTask({ ...task, holdDetail: good })).toBe(true);
  });
});

describe("CONC-09-A3: the frozen Team API routes do not carry holdDetail", () => {
  it("drops the field when a task goes to a joined client or the phone, and the event still decodes", async () => {
    const wire = await import("@hxbot/contracts/team-protocol/agent-tasks-v1");
    const codec = wire.AGENT_TASKS_CODECS.get(wire.AGENT_TASKS_ROUTES.list);
    const snapshot = { agentId: "a1", tasks: [{ ...task, holdDetail: detail }], limit: 2 };
    const sent = codec?.response(200, snapshot);
    expect(sent).toBeDefined();
    expect(JSON.stringify(sent)).not.toContain("holdDetail");
    const event = wire.agentTasksEvent({ type: "agent-tasks-changed", snapshot });
    expect(event?.type).toBe("agent-tasks-changed");
    expect(JSON.stringify(event)).not.toContain("holdDetail");
  });
});

function candidate(lane: string, tier: 0 | 1 | 2 | 3, readyAt: number): HxFlowCandidate {
  return { lane, tier, readyAt, teamId: null, order: 0, batch: null, difficulty: null, dependents: 0 };
}

describe("CONC-09: the place and the time of each wait", () => {
  it("orders the machine waits by HX-Flow and gives place × turn time ÷ B; the provider waits by model", () => {
    const now = 10_000_000;
    const gate = new HxProviderGate({ now: () => now });
    const model = { key: "codex\u0000default\u0000gpt-5", local: false, label: "codex · gpt-5" };
    gate.attach({ modelOf: (agentId) => (agentId.startsWith("p") ? model : null), wake: () => undefined });
    // Two turns fill L = 2 of the model; the third lane waits for the provider.
    for (const lane of ["p1", "p2"]) {
      gate.starting(lane, false);
      gate.turnStarted(`turn-${lane}`, lane, null, 10);
    }
    expect(gate.mayStart("p3", false)).toBe(false);
    const details = new HxHoldDetails({ gate, now: () => now, turnMs: () => 120_000 });
    const changes: string[] = [];
    details.attach("queue", (agentId) => changes.push(agentId));
    details.attachDrain({
      waiting: () => [
        { lane: "a1", candidate: candidate("a1", 2, now - 1_000) },
        { lane: "a2\u0000t9", candidate: candidate("a2\u0000t9", 0, now) },
        { lane: "a3", candidate: candidate("a3", 3, now - 5_000) },
        { lane: "p3", candidate: candidate("p3", 2, now) },
      ],
      limit: () => 4,
    });
    expect(details.refresh().sort()).toEqual(["a1", "a2", "a3", "p3"]);
    // A person first, then tier 2, then the routine.
    expect(details.of("a2\u0000t9")).toEqual({ kind: "machine", position: 1, etaSeconds: 30 });
    expect(details.of("a1")).toEqual({ kind: "machine", position: 2, etaSeconds: 60 });
    expect(details.of("a3")).toEqual({ kind: "machine", position: 3, etaSeconds: 90 });
    // 1 × 120 s ÷ L (2).
    expect(details.of("p3")).toEqual({ kind: "provider", position: 1, etaSeconds: 60 });
    // Nothing moved: nobody is told again.
    changes.length = 0;
    expect(details.refresh()).toEqual([]);
    expect(changes).toEqual([]);
    // A pause adds its rest to the provider's time.
    gate.throttled("turn-p1", null, 30_000);
    details.refresh();
    expect(details.of("p3")?.etaSeconds).toBe(30 + 120);
    details.stop();
    gate.reset();
  });

  it("says nothing of the time when nothing limits the turns, and forgets a lane that no longer waits", () => {
    const details = new HxHoldDetails({ gate: new HxProviderGate(), turnMs: () => 60_000 });
    let waiting = [{ lane: "a1", candidate: candidate("a1", 2, 0) }];
    details.attach("queue", () => undefined);
    details.attachDrain({ waiting: () => waiting, limit: () => null });
    details.refresh();
    expect(details.of("a1")).toEqual({ kind: "machine", position: 1, etaSeconds: null });
    waiting = [];
    expect(details.refresh()).toEqual(["a1"]);
    expect(details.of("a1")).toBeNull();
    details.stop();
  });
});
