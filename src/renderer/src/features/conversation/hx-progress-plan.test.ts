import { HX_PROGRESS_ITEM_TYPE, hxProgressText } from "@hxbot/contracts/hx-progress";
import type { ConversationMessage } from "@hxbot/contracts/ipc";
import { localizeSourceText } from "@hxbot/i18n";
import { describe, expect, it } from "vitest";
import { planItems, toAgentMessage } from "../../app-message-projection";
import { hxProgressLive, hxProgressPlan } from "./hx-progress-plan";

// HXBot 进度卡（v1.6.7）：对话把进度卡画成任务清单（hx-progress-plan.ts 和 app-message-projection.ts 的接线）。

function card(
  status: ConversationMessage["status"],
  states: Array<"pending" | "active" | "done" | "failed">,
): ConversationMessage {
  return {
    id: "hx-team-card-1",
    author: "system",
    source: "system",
    text: hxProgressText({
      title: "Team · handoffs 2/80 · 5/240 min",
      steps: states.map((state, index) => ({ text: `step ${index + 1}`, state })),
    }),
    createdAt: "2026-11-14T08:00:00.000Z",
    status,
    itemType: HX_PROGRESS_ITEM_TYPE,
  };
}

describe("a progress card in the chat", () => {
  it("is a plan block with the card's header and steps", () => {
    const plan = hxProgressPlan(card("completed", ["done", "active", "pending", "failed"]));
    expect(plan).toEqual({
      explanation: "Team · handoffs 2/80 · 5/240 min",
      steps: [
        { id: "0", text: "step 1", status: "completed" },
        { id: "1", text: "step 2", status: "inProgress" },
        { id: "2", text: "step 3", status: "pending" },
        { id: "3", text: "✗ step 4", status: "pending" },
      ],
      stopped: false,
    });
  });

  it("reads a member line in the reader's language, and leaves a step's own words (v1.7.4, CONC-09)", () => {
    const message: ConversationMessage = {
      ...card("completed", []),
      text: hxProgressText({
        title: "Team · 2 handoffs · 1 min",
        steps: [
          { text: "第 1 部分 · 卡2", state: "active" },
          { text: "卡3: queued (place 3, about 2 min)", state: "pending" },
        ],
      }),
    };
    // The host writes English; the screen maps it back to its key (here in English, the test's language).
    expect(hxProgressPlan(message)?.steps.map((step) => step.text)).toEqual([
      "第 1 部分 · 卡2",
      "卡3: queued (place 3, about 2 min)",
    ]);
    // What a Chinese reader sees: the same key in Chinese, the names as they are.
    expect(localizeSourceText("卡3: queued (place 3, about 2 min)", "zh")).toBe("卡3：排队（第 3 位，约 2 分钟）");
    expect(localizeSourceText("卡6: starting now", "zh")).toBe("卡6：马上开始");
    expect(localizeSourceText("卡6: waits for its model's provider (place 2, about 1 min)", "zh")).toBe(
      "卡6：等模型服务商（第 2 位，约 1 分钟）",
    );
    expect(localizeSourceText("卡6: on hold while the team is paused or wrapping up", "zh")).toBe(
      "卡6：团队暂停或收尾中，先不开始",
    );
    expect(localizeSourceText("第 1 部分 · 卡2", "zh")).toBe("第 1 部分 · 卡2");
  });

  it("shows its running step as running while the work goes on, and not after", () => {
    const live = card("completed", ["done", "active"]);
    expect(hxProgressLive(live)).toBe(true);
    const message = toAgentMessage(live);
    expect(message.kind).toBe("plan");
    expect(message.streaming).toBe(true);
    const plan = message.plan;
    if (!plan) throw new Error("no plan");
    expect(planItems(plan, message.streaming === true).map((item) => item.state)).toEqual(["done", "active"]);
    expect(hxProgressLive(card("completed", ["done", "done"]))).toBe(false);
    expect(hxProgressLive(card("interrupted", ["done", "active"]))).toBe(false);
    expect(toAgentMessage(card("interrupted", ["done", "pending"])).plan?.stopped).toBe(true);
  });

  it("leaves every other message as it was", () => {
    const line: ConversationMessage = {
      id: "x",
      author: "system",
      source: "system",
      text: "Team started: a, b; a leads. Progress comes back here.",
      createdAt: "2026-11-14T08:00:00.000Z",
      status: "completed",
      itemType: "channel-change",
    };
    expect(hxProgressPlan(line)).toBeNull();
    expect(hxProgressLive(line)).toBe(false);
    expect(toAgentMessage(line).kind).not.toBe("plan");
  });
});
