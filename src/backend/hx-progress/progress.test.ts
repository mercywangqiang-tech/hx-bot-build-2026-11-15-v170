import {
  HX_PROGRESS_ITEM_TYPE,
  hxParseProgressText,
  hxProgressText,
  isHxProgressMessage,
} from "@hxbot/contracts/hx-progress";
import { describe, expect, it } from "vitest";
import { hxProgressMessage } from "./progress";

// HXBot 进度卡（v1.6.7）：卡片的文字格式（packages/contracts/src/hx-progress.ts）和卡片的消息（progress.ts）。
// 旧客户端读到的是这段文字，新客户端把它读回卡片。

describe("the text of a progress card", () => {
  const card = {
    title: "Team · handoffs 3/80 · 12/240 min",
    steps: [
      { text: "定方案 · 老李", state: "done" as const },
      { text: "写文章 · 小王", state: "active" as const },
      { text: "画海报 · 小张", state: "pending" as const },
      { text: "检查 · 老周", state: "failed" as const },
    ],
  };

  it("is a header and a checklist that a person can read, and reads back to the same card", () => {
    const text = hxProgressText(card);
    expect(text).toBe(
      "Team · handoffs 3/80 · 12/240 min\n\n- [x] 定方案 · 老李\n- [>] 写文章 · 小王\n- [ ] 画海报 · 小张\n- [!] 检查 · 老周",
    );
    expect(hxParseProgressText(text)).toEqual(card);
  });

  it("puts each step on one line, and reads nothing that is not a card", () => {
    expect(hxProgressText({ title: "a\nb", steps: [{ text: "x\ny", state: "pending" }] })).toBe("a b\n\n- [ ] x y");
    expect(hxParseProgressText("just text")).toBeNull();
    expect(hxParseProgressText("title\n\n- [?] odd")).toBeNull();
    expect(hxParseProgressText("title\n\n")).toBeNull();
    expect(isHxProgressMessage({ itemType: HX_PROGRESS_ITEM_TYPE, text: "x" })).toBe(true);
    expect(isHxProgressMessage({ itemType: "channel-change", text: "x" })).toBe(false);
  });
});

describe("the message of a card", () => {
  it("is a system message of its own kind that keeps its id and first time, and a stopped card is interrupted", () => {
    const first = hxProgressMessage(
      "card-1",
      { title: "t", steps: [{ text: "a", state: "active" }] },
      false,
      "2026-11-14T08:00:00.000Z",
    );
    expect(first).toEqual({
      id: "card-1",
      author: "system",
      source: "system",
      text: "t\n\n- [>] a",
      createdAt: "2026-11-14T08:00:00.000Z",
      status: "completed",
      itemType: HX_PROGRESS_ITEM_TYPE,
    });
    const stopped = hxProgressMessage(
      "card-1",
      { title: "t", steps: [{ text: "a", state: "pending" }] },
      true,
      first.createdAt,
    );
    expect(stopped.status).toBe("interrupted");
    expect(stopped.createdAt).toBe(first.createdAt);
  });
});
