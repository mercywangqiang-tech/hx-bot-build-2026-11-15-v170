import type { QueueDelivery } from "@hxbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { TurnSlots } from "../agent/turn-slots";
import type { HxFlowCandidate } from "./ledger";
import { HxSlotPass, type HxSlotReads } from "./slot-pass";

// HXBot v1.7.3：排队检查一遍只读每条线路一次（slot-pass.ts）。用了很久的资料夹启动时主进程卡住 15 秒，
// 因为每问一条等着的线路，都把全部线路重新读一遍。

function delivery(id: string, kind: "user" | "agent"): QueueDelivery {
  return {
    id,
    messageId: `m-${id}`,
    recipientAgentId: id,
    sender: kind === "user" ? { kind: "user" } : { kind: "agent", agentId: "lead" },
    text: "",
    attachments: [],
    replyToMessageId: null,
    status: "queued",
    position: null,
    turnId: null,
    error: null,
    createdAt: `2026-11-18T10:00:${id.padStart(2, "0")}.000Z`,
  };
}

/** Lanes `0`…`n-1`: the first `busy` run a turn, the others wait; reads are counted. */
function machine(n: number, busy: number) {
  const reads = { lanes: 0, running: 0, waiting: 0, heads: 0, ranks: 0 };
  const lanes = Array.from({ length: n }, (_, i) => String(i));
  const running = new Set(lanes.slice(0, busy));
  const options = {
    limit: () => 4,
    lanes: () => {
      reads.lanes += 1;
      return lanes;
    },
    isRunning: (lane: string) => {
      reads.running += 1;
      return running.has(lane);
    },
    isWaiting: (lane: string) => {
      reads.waiting += 1;
      return !running.has(lane);
    },
    head: (lane: string) => {
      reads.heads += 1;
      return running.has(lane) ? null : delivery(lane, lane === "9" ? "user" : "agent");
    },
    rank: (lane: string, head: QueueDelivery): HxFlowCandidate => {
      reads.ranks += 1;
      return {
        lane,
        tier: head.sender.kind === "user" ? 0 : 2,
        readyAt: Date.parse(head.createdAt),
        teamId: null,
        order: 0,
        batch: null,
        difficulty: null,
        dependents: 0,
      };
    },
  };
  return { reads, lanes, running, options };
}

describe("one pass of the turn slots (v1.7.3)", () => {
  it("reads each lane once in a pass, and gives the same answers as without it", () => {
    const plain = machine(40, 2);
    const slots = new TurnSlots(plain.options);
    const waiting = plain.lanes.slice(2);
    const before = waiting.map((lane) => slots.mayStart(lane));
    const outside = { ...plain.reads };
    Object.assign(plain.reads, { lanes: 0, running: 0, waiting: 0, heads: 0, ranks: 0 });
    const inside = slots.batch(() => waiting.map((lane) => slots.mayStart(lane)));
    expect(inside).toEqual(before);
    // Without a pass, each of the 38 checks reads all 40 lanes.
    expect(outside.running).toBe(38 * 40);
    // In one pass, each lane is read once.
    expect(plain.reads.running).toBe(40);
    expect(plain.reads.waiting).toBeLessThanOrEqual(40);
    expect(plain.reads.heads).toBeLessThanOrEqual(40);
    expect(plain.reads.ranks).toBeLessThanOrEqual(40);
    expect(plain.reads.lanes).toBe(1);
  });

  it("reads again after the pass, and outside of one", () => {
    const plain = machine(6, 1);
    const slots = new TurnSlots(plain.options);
    slots.batch(() => slots.mayStart("3"));
    const after = plain.reads.running;
    // A turn started after the pass: the next check sees it.
    plain.running.add("3");
    plain.running.add("4");
    plain.running.add("5");
    plain.running.add("2");
    expect(slots.mayStart("1")).toBe(false);
    expect(plain.reads.running).toBeGreaterThan(after);
  });

  it("lets passes nest, and forgets the reads only when the outer one ends", () => {
    const pass = new HxSlotPass();
    let reads = 0;
    const reads0: HxSlotReads = {
      lanes: () => [],
      isRunning: () => {
        reads += 1;
        return false;
      },
      isWaiting: () => false,
      head: () => null,
    };
    const options = pass.wrap(reads0);
    pass.run(() => {
      options.isRunning("a");
      pass.run(() => options.isRunning("a"));
      options.isRunning("a");
    });
    expect(reads).toBe(1);
    options.isRunning("a");
    expect(reads).toBe(2);
    expect(() =>
      pass.run(() => {
        throw new Error("x");
      }),
    ).toThrow("x");
    options.isRunning("a");
    expect(reads).toBe(3);
  });

  it("keeps a read of the scheduler under its key for the pass only", () => {
    const pass = new HxSlotPass();
    const lanesOf = pass.memo<string[]>();
    let reads = 0;
    const read = (agent: string) =>
      lanesOf(agent, () => {
        reads += 1;
        return [agent, `${agent}:task`];
      });
    read("a");
    read("a");
    expect(reads).toBe(2);
    pass.run(() => {
      expect(read("a")).toEqual(["a", "a:task"]);
      read("a");
      read("b");
    });
    expect(reads).toBe(4);
    read("a");
    expect(reads).toBe(5);
  });
});
