// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import {
  type HxRoutineConfirmCard,
  hxParseRoutineConfirmText,
  hxRoutineConfirmText,
} from "@hxbot/contracts/hx-routine-confirm";
import type { ChannelRoutine, Routine } from "@hxbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateHxBotDatabase } from "../hxbot-database-schema";
import {
  HX_CONFIRM_MAX_WAIT_MS,
  type HxConfirmHost,
  hxChannelRoutineConfirm,
  hxLocalMinute,
  hxRoutineConfirm,
} from "./confirm";

// RTN-02, MIG-03, CONC-14: a routine run that waits for the person's yes.
let db: DatabaseSync;
const cards = new Map<string, { agentId: string; card: HxRoutineConfirmCard; settled: boolean; writes: number }>();
const started: Array<{ routineId: string; scheduledFor: string }> = [];
const skipped: Array<{ routineId: string; scheduledFor: string; reason: string }> = [];
const routines = new Map<string, Routine>();
let failStart = false;

function routine(
  id: string,
  agentId = "chief",
  schedule: Routine["trigger"]["schedule"] = { kind: "hourly", minute: 0 },
): Routine {
  const value: Routine = {
    id,
    agentId,
    name: `Routine ${id}`,
    instruction: `Delete the old files of ${id}.`,
    active: true,
    timezone: "Asia/Shanghai",
    trigger: {
      id: `${id}-trigger`,
      routineId: id,
      schedule,
      nextRunAt: "2026-11-20T02:00:00.000Z",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    },
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
  routines.set(id, value);
  return value;
}

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  migrateHxBotDatabase(db);
  cards.clear();
  started.length = 0;
  skipped.length = 0;
  routines.clear();
  failStart = false;
  const host: HxConfirmHost<Routine> = {
    connection: () => db,
    routine: (agentId, routineId) => {
      const found = routines.get(routineId);
      return found && found.agentId === agentId ? found : null;
    },
    writeCard: (agentId, cardId, card, settled) => {
      const earlier = cards.get(cardId);
      cards.set(cardId, { agentId, card, settled, writes: (earlier?.writes ?? 0) + 1 });
    },
    startRun: async (input) => {
      await Promise.resolve();
      if (failStart) throw new Error("gone");
      started.push({ routineId: input.routine.id, scheduledFor: input.scheduledFor });
    },
    recordSkipped: (input) =>
      skipped.push({ routineId: input.routine.id, scheduledFor: input.scheduledFor, reason: input.reason }),
  };
  hxRoutineConfirm.attach(host);
});

afterEach(() => {
  hxRoutineConfirm.detach();
  db.close();
});

const at = (iso: string) => new Date(iso);

function ask(
  id: string,
  now: string,
  actions: Array<"send" | "publish" | "pay" | "delete"> = ["delete"],
  agentId = "chief",
) {
  const target = routines.get(id) ?? routine(id, agentId);
  return hxRoutineConfirm.request({
    routine: target,
    ownerId: target.agentId,
    triggerId: `${id}-trigger`,
    scheduledFor: at("2026-11-20T02:00:00.000Z"),
    reason: "catch-up",
    actions,
    catchUp: {
      total: 3,
      truncated: false,
      from: at("2026-11-20T00:00:00.000Z"),
      until: at("2026-11-20T02:00:00.000Z"),
      handled: "run-once",
    },
    now: at(now),
  });
}

describe("hxRoutineConfirm", () => {
  it("asks once for an occurrence and starts nothing until the yes (RTN-02-A2)", async () => {
    const card = ask("a", "2026-11-20T02:00:00.000Z", ["send"]);
    expect(card).toMatch(/^hx-routine-confirm:/u);
    expect(ask("a", "2026-11-20T02:00:05.000Z", ["send"])).toBe(card);
    expect(started).toEqual([]);
    const shown = cards.get(card ?? "");
    expect(shown?.settled).toBe(false);
    expect(shown?.card.lines).toHaveLength(1);
    expect(shown?.card.note).toContain("Missed 3 times (2026-11-20 08:00 – 2026-11-20 10:00)");
    expect(shown?.card.actions).toBe("This run sends messages or mail. Nothing is sent before you say yes.");
    const result = await hxRoutineConfirm.answer({ ownerId: "chief", cardId: card ?? "", run: true });
    expect(result).toEqual({ ran: 1, skipped: 0, settled: 0 });
    expect(started).toEqual([{ routineId: "a", scheduledFor: "2026-11-20T02:00:00.000Z" }]);
    expect(cards.get(card ?? "")?.settled).toBe(true);
    // A second answer changes nothing.
    expect(await hxRoutineConfirm.answer({ ownerId: "chief", cardId: card ?? "", run: false })).toEqual({
      ran: 0,
      skipped: 0,
      settled: 1,
    });
    expect(skipped).toEqual([]);
  });

  it("merges five deletions of one agent within 2 seconds into one card, and one answer settles all (CONC-14-A2)", async () => {
    const ids = ["d1", "d2", "d3", "d4", "d5"];
    const cardIds = ids.map((id, index) => ask(id, `2026-11-20T02:00:00.${String(index * 300).padStart(3, "0")}Z`));
    expect(new Set(cardIds).size).toBe(1);
    const card = cards.get(cardIds[0] ?? "");
    expect(card?.card.lines).toHaveLength(5);
    expect(card?.card.title).toBe("5 routines wait for your yes before they run");
    const result = await hxRoutineConfirm.answer({ ownerId: "chief", cardId: cardIds[0] ?? "", run: false });
    expect(result.skipped).toBe(5);
    expect(skipped.map((entry) => entry.reason)).toEqual(Array(5).fill("declined"));
  });

  it("never merges a payment, another agent, other actions, or a question more than 2 seconds later", () => {
    const base = ask("p0", "2026-11-20T02:00:00.000Z", ["pay"]);
    expect(ask("p1", "2026-11-20T02:00:00.500Z", ["pay"])).not.toBe(base);
    const deletion = ask("x0", "2026-11-20T02:00:00.000Z");
    expect(ask("x1", "2026-11-20T02:00:01.000Z", ["delete"], "scout")).not.toBe(deletion);
    expect(ask("x2", "2026-11-20T02:00:01.000Z", ["send"])).not.toBe(deletion);
    expect(ask("x4", "2026-11-20T02:00:01.900Z")).toBe(deletion);
    expect(ask("x3", "2026-11-20T02:00:04.500Z")).not.toBe(deletion);
  });

  it("starts each run once, also when the person answers twice at the same time", async () => {
    const card = ask("twice", "2026-11-20T02:00:00.000Z") ?? "";
    const [first, second] = await Promise.all([
      hxRoutineConfirm.answer({ ownerId: "chief", cardId: card, run: true }),
      hxRoutineConfirm.answer({ ownerId: "chief", cardId: card, run: true }),
    ]);
    expect(first.ran + second.ran).toBe(1);
    expect(started).toHaveLength(1);
  });

  it("refuses an answer for another agent's card and for a card that does not exist", async () => {
    const card = ask("mine", "2026-11-20T02:00:00.000Z") ?? "";
    await expect(hxRoutineConfirm.answer({ ownerId: "scout", cardId: card, run: true })).rejects.toThrow(
      "This question is no longer open.",
    );
    await expect(
      hxRoutineConfirm.answer({ ownerId: "chief", cardId: "hx-routine-confirm:none", run: true }),
    ).rejects.toThrow("This question is no longer open.");
    expect(started).toEqual([]);
  });

  it("expires at the routine's next occurrence, skips it, and settles the card", () => {
    const card = ask("late", "2026-11-20T02:00:10.000Z") ?? "";
    expect(hxRoutineConfirm.nextExpiry()).toBe("2026-11-20T03:00:00.000Z");
    expect(hxRoutineConfirm.expire(at("2026-11-20T02:59:59.000Z"))).toBe(0);
    expect(hxRoutineConfirm.expire(at("2026-11-20T03:00:00.000Z"))).toBe(1);
    expect(skipped).toEqual([{ routineId: "late", scheduledFor: "2026-11-20T02:00:00.000Z", reason: "expired" }]);
    expect(cards.get(card)?.settled).toBe(true);
    expect(cards.get(card)?.card.outcome).toBe("No answer before its next time: skipped this time.");
    expect(hxRoutineConfirm.nextExpiry()).toBeNull();
  });

  it("waits 24 hours at most for a routine whose next run is later", () => {
    routine("weekly", "chief", { kind: "weekly", weekday: 5, time: "10:00" });
    ask("weekly", "2026-11-20T02:00:00.000Z");
    expect(hxRoutineConfirm.nextExpiry()).toBe(
      new Date(at("2026-11-20T02:00:00.000Z").getTime() + HX_CONFIRM_MAX_WAIT_MS).toISOString(),
    );
  });

  it("records the occurrence as skipped when its run cannot start", async () => {
    failStart = true;
    const card = ask("broken", "2026-11-20T02:00:00.000Z") ?? "";
    expect(await hxRoutineConfirm.answer({ ownerId: "chief", cardId: card, run: true })).toEqual({
      ran: 0,
      skipped: 1,
      settled: 0,
    });
    expect(skipped[0]?.reason).toBe("declined");
  });

  it("loses the question of a deleted routine with the routine", () => {
    db.exec(`INSERT INTO projection_agent_routines (routine_id, agent_id, name, instruction, active, timezone, created_at,
      updated_at, last_event_sequence) VALUES ('gone', 'chief', 'Gone', 'Delete it', 1, 'UTC', 'now', 'now', 1)`);
    routine("gone");
    ask("gone", "2026-11-20T02:00:00.000Z");
    expect(hxRoutineConfirm.waitingFor("chief", "gone")).toHaveLength(1);
    db.exec("DELETE FROM projection_agent_routines WHERE routine_id = 'gone'");
    expect(hxRoutineConfirm.waitingFor("chief", "gone")).toHaveLength(0);
  });

  it("asks nothing and starts nothing when no host is attached", () => {
    hxRoutineConfirm.detach();
    expect(ask("none", "2026-11-20T02:00:00.000Z")).toBeNull();
    expect(hxRoutineConfirm.expire(at("2030-01-01T00:00:00.000Z"))).toBe(0);
  });
});

describe("a channel routine's questions", () => {
  const channelCards: string[] = [];
  const channelStarted: string[] = [];
  const channelSkipped: string[] = [];

  function channelRoutine(id: string, channelId = "news"): ChannelRoutine {
    const base = routine(id);
    const { agentId: _agent, ...fields } = base;
    return { ...fields, channelId };
  }

  beforeEach(() => {
    channelCards.length = 0;
    channelStarted.length = 0;
    channelSkipped.length = 0;
    const host: HxConfirmHost<ChannelRoutine> = {
      connection: () => db,
      routine: (channelId, routineId) => (routineId.startsWith("c") ? channelRoutine(routineId, channelId) : null),
      writeCard: (_channelId, cardId, _card, settled) => channelCards.push(`${cardId}:${settled}`),
      startRun: async (input) => {
        channelStarted.push(`${input.ownerId}/${input.routine.id}`);
      },
      recordSkipped: (input) => channelSkipped.push(`${input.ownerId}/${input.routine.id}:${input.reason}`),
    };
    hxChannelRoutineConfirm.attach(host);
  });

  afterEach(() => hxChannelRoutineConfirm.detach());

  function askChannel(id: string, now: string, channelId = "news") {
    return hxChannelRoutineConfirm.request({
      routine: channelRoutine(id, channelId),
      ownerId: channelId,
      triggerId: `${id}-trigger`,
      scheduledFor: at("2026-11-20T02:00:00.000Z"),
      reason: "each",
      actions: ["send"],
      catchUp: null,
      now: at(now),
    });
  }

  it("keeps the agent's and the channel's questions apart, also for the same routine id and time", async () => {
    const agentCard = ask("c1", "2026-11-20T02:00:00.000Z", ["send"]) ?? "";
    const channelCard = askChannel("c1", "2026-11-20T02:00:00.000Z") ?? "";
    expect(channelCard).not.toBe(agentCard);
    expect(hxRoutineConfirm.waitingFor("chief", "c1")).toHaveLength(1);
    expect(hxChannelRoutineConfirm.waitingFor("news", "c1")).toHaveLength(1);
    // An agent's card is not a channel's, and a card of another channel is not this one's.
    await expect(hxChannelRoutineConfirm.answer({ ownerId: "chief", cardId: agentCard, run: true })).rejects.toThrow(
      "This question is no longer open.",
    );
    await expect(hxChannelRoutineConfirm.answer({ ownerId: "other", cardId: channelCard, run: true })).rejects.toThrow(
      "This question is no longer open.",
    );
    expect(await hxChannelRoutineConfirm.answer({ ownerId: "news", cardId: channelCard, run: true })).toEqual({
      ran: 1,
      skipped: 0,
      settled: 0,
    });
    expect(channelStarted).toEqual(["news/c1"]);
    expect(started).toEqual([]);
    expect(hxRoutineConfirm.waitingFor("chief", "c1")).toHaveLength(1);
  });

  it("lists what the routine list shows, merges within 2 seconds, and expires only its own kind", () => {
    const first = askChannel("c2", "2026-11-20T02:00:00.000Z");
    expect(askChannel("c3", "2026-11-20T02:00:01.000Z")).toBe(first);
    expect(askChannel("c4", "2026-11-20T02:00:01.000Z", "sales")).not.toBe(first);
    expect(hxChannelRoutineConfirm.waitingCards("news", "c2")).toEqual([
      {
        cardId: first,
        scheduledFor: "2026-11-20T02:00:00.000Z",
        reason: "each",
        actions: ["send"],
        expiresAt: "2026-11-20T03:00:00.000Z",
      },
    ]);
    ask("a-agent", "2026-11-20T02:00:00.000Z");
    expect(hxChannelRoutineConfirm.expire(at("2026-11-20T03:00:00.000Z"))).toBe(3);
    expect(channelSkipped.sort()).toEqual(["news/c2:expired", "news/c3:expired", "sales/c4:expired"]);
    expect(hxRoutineConfirm.waitingFor("chief", "a-agent")).toHaveLength(1);
    expect(hxChannelRoutineConfirm.nextExpiry()).toBeNull();
    expect(hxRoutineConfirm.nextExpiry()).toBe("2026-11-20T03:00:00.000Z");
  });

  it("closes a paused channel routine's question as skipped", () => {
    askChannel("c5", "2026-11-20T02:00:00.000Z");
    expect(hxChannelRoutineConfirm.cancelFor("news", "c5")).toBe(1);
    expect(channelSkipped).toEqual(["news/c5:cancelled"]);
    expect(hxChannelRoutineConfirm.waitingCards("news", "c5")).toEqual([]);
  });
});

describe("routine confirmation card text", () => {
  it("reads back what it wrote, with and without an outcome", () => {
    const card: HxRoutineConfirmCard = {
      title: 'Routine "Daily" waits for your yes before it runs',
      note: "This run makes up for a missed time.",
      actions: "This run deletes. Nothing is deleted before you say yes.",
      lines: ["Daily · 2026-11-20 10:00: Delete the old files."],
    };
    expect(hxParseRoutineConfirmText(hxRoutineConfirmText(card))).toEqual(card);
    const settled = { ...card, outcome: "You said no: skipped this time." };
    expect(hxParseRoutineConfirmText(hxRoutineConfirmText(settled))).toEqual(settled);
    expect(hxParseRoutineConfirmText("not a card")).toBeNull();
  });

  it("writes a time in the routine's zone the same way on every screen", () => {
    expect(hxLocalMinute(at("2026-11-20T02:00:00.000Z"), "Asia/Shanghai")).toBe("2026-11-20 10:00");
    expect(hxLocalMinute(at("2026-11-20T02:00:00.000Z"), "Mars/Olympus")).toBe("2026-11-20 02:00");
  });
});
