// HXBot v1.7.4（ART-05、BAK-03）：对话里“改了文件”的卡片：标题、说明、可以展开的改动、“恢复到修改前”。
import {
  HX_FILE_CHANGE_ITEM_TYPE,
  HX_FILE_RESTORED_ITEM_TYPE,
  type HxRestoreFileChangeInput,
  type HxRestoreFileChangeResult,
  hxFileChangeText,
} from "@hxbot/contracts/hx-file-change";
import type { AgentMessage } from "@hxbot/ui/data";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { HxFileChangeRow, isHxFileChangeRow } from "./HxFileChangeRow";

function card(
  lines: string[],
  itemType: string = HX_FILE_CHANGE_ITEM_TYPE,
  id = "hx-file-change:vabc12345",
): AgentMessage {
  return {
    id,
    author: "agent",
    body: hxFileChangeText({
      title: "Changed 季度报告.xlsx: 3 changed, 0 added, 0 removed",
      note: "HXBot read the file back, and it is as expected.",
      file: "/Users/me/工作/季度报告.xlsx",
      lines,
    }),
    time: "10:00",
    kind: "text",
    itemType,
  };
}

async function settle() {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  flush();
}

const LINES = ["Sheet1!B3: 100 → 120", "Sheet1!B4: — → 340", "汇总!C1: 旧 → —"];

describe("the card of a file change in the chat", () => {
  it("is found by its item type", () => {
    expect(isHxFileChangeRow(card(LINES))).toBe(true);
    expect(isHxFileChangeRow(card(LINES, HX_FILE_RESTORED_ITEM_TYPE))).toBe(true);
    expect(isHxFileChangeRow({ ...card(LINES), itemType: "plan" })).toBe(false);
  });

  it("shows what changed, opens and closes the list, and restores through main once", async () => {
    let finish: (result: HxRestoreFileChangeResult) => void = () => undefined;
    const restore = vi.fn(
      (_input: HxRestoreFileChangeInput) =>
        new Promise<HxRestoreFileChangeResult>((done) => {
          finish = done;
        }),
    );
    render(() => <HxFileChangeRow message={card(LINES)} agentId="a1" threadId="t1" local restore={restore} />);
    expect(screen.getByText("Changed 季度报告.xlsx: 3 changed, 0 added, 0 removed")).toBeTruthy();
    expect(screen.getByText("HXBot read the file back, and it is as expected.")).toBeTruthy();
    expect(screen.getByText("/Users/me/工作/季度报告.xlsx")).toBeTruthy();
    // A short list starts open.
    expect(screen.getByText("Sheet1!B3: 100 → 120")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide the changes" }));
    flush();
    expect(screen.queryByText("Sheet1!B3: 100 → 120")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the changes (3)" }));
    flush();
    expect(screen.getByText("汇总!C1: 旧 → —")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restore to before the change" }));
    flush();
    expect(restore).toHaveBeenCalledWith({ agentId: "a1", threadId: "t1", messageId: "hx-file-change:vabc12345" });
    // While it runs, a second click does nothing.
    const running = screen.getByRole("button", { name: "Restoring…" });
    expect(running.hasAttribute("disabled")).toBe(true);
    fireEvent.click(running);
    expect(restore).toHaveBeenCalledTimes(1);
    finish({ status: "restored" });
    await settle();
    expect(screen.getByRole("status").textContent).toBe("Restored.");
  });

  it("says why a restore failed, in the reader's language when HXBot wrote the reason", async () => {
    const restore = vi.fn(() =>
      Promise.resolve<HxRestoreFileChangeResult>({
        status: "missing",
        reason: "The version from before this change is not kept any more.",
      }),
    );
    render(() => <HxFileChangeRow message={card(LINES)} agentId="a1" threadId={null} local restore={restore} />);
    fireEvent.click(screen.getByRole("button", { name: "Restore to before the change" }));
    await settle();
    expect(restore).toHaveBeenCalledWith({ agentId: "a1", threadId: null, messageId: "hx-file-change:vabc12345" });
    expect(screen.getByRole("status").textContent).toBe(
      "Could not restore: The version from before this change is not kept any more.",
    );
    // The button stays: the person can try again.
    expect(screen.getByRole("button", { name: "Restore to before the change" })).toBeTruthy();
  });

  it("has no button on a restored card, on a card with no version, or on another computer", () => {
    const restore = vi.fn();
    const restored = render(() => (
      <HxFileChangeRow
        message={card(LINES, HX_FILE_RESTORED_ITEM_TYPE)}
        agentId="a1"
        threadId="t1"
        local
        restore={restore}
      />
    ));
    expect(screen.queryByRole("button", { name: "Restore to before the change" })).toBeNull();
    restored.unmount();
    const none = render(() => (
      <HxFileChangeRow
        message={card(LINES, HX_FILE_CHANGE_ITEM_TYPE, "hx-file-change:none-1")}
        agentId="a1"
        threadId="t1"
        local
        restore={restore}
      />
    ));
    expect(screen.queryByRole("button", { name: "Restore to before the change" })).toBeNull();
    none.unmount();
    render(() => <HxFileChangeRow message={card(LINES)} agentId="a1" threadId="t1" local={false} restore={restore} />);
    expect(screen.queryByRole("button", { name: "Restore to before the change" })).toBeNull();
    expect(screen.getByText("You can restore it on the computer that runs this agent.")).toBeTruthy();
    expect(restore).not.toHaveBeenCalled();
  });

  it("starts a long list closed, and shows a card that is not well formed as its text", () => {
    const many = Array.from({ length: 12 }, (_, index) => `S!A${index + 1}: 1 → 2`);
    const long = render(() => <HxFileChangeRow message={card(many)} agentId="a1" threadId="t1" local />);
    expect(screen.queryByText("S!A1: 1 → 2")).toBeNull();
    expect(screen.getByRole("button", { name: "Show the changes (12)" })).toBeTruthy();
    long.unmount();
    render(() => <HxFileChangeRow message={{ ...card(LINES), body: "not a card" }} agentId="a1" threadId="t1" local />);
    expect(screen.getByText("not a card")).toBeTruthy();
  });
});
