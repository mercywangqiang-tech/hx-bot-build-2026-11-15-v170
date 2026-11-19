// HXBot v1.7.4（ART-05-A1、BAK-03-A1）：改了文件的卡片——差异一行一条、标题和说明按屏幕的语言、读回和版本的说明；
// “恢复到修改前”只认对话里真有的卡片，恢复后文件哈希回到修改前，卡片改成“已恢复”，再点不会再改。
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HX_FILE_CHANGE_ITEM_TYPE,
  HX_FILE_CHANGE_LIMITS,
  HX_FILE_RESTORED_ITEM_TYPE,
  hxFileChangeVersionId,
  hxParseFileChangeText,
} from "@hxbot/contracts/hx-file-change";
import type { ConversationMessage } from "@hxbot/contracts/ipc";
import { localizeSourceText } from "@hxbot/i18n";
import { afterEach, describe, expect, it } from "vitest";
import type { HxFileDiff } from "../hx-files/diff";
import { HxFileVersions } from "../hx-files/versions";
import {
  hxDiffLines,
  hxFileChangeCard,
  hxFileChangeMessage,
  hxRestoreFileChange,
  hxSetFileCardPort,
} from "./change-card";
import type { HxFileChangeEvent } from "./run";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const folders: string[] = [];

afterEach(async () => {
  hxSetFileCardPort(null);
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

function diff(overrides: Partial<HxFileDiff> = {}): HxFileDiff {
  return {
    kind: "sheet",
    before: { size: 10, sha256: "a" },
    after: { size: 12, sha256: "b" },
    identical: false,
    summary: "",
    counts: { added: 0, removed: 0, changed: 0 },
    truncated: false,
    ...overrides,
  };
}

function event(overrides: Partial<HxFileChangeEvent> = {}): HxFileChangeEvent {
  return {
    task: "thread-1",
    agent: "小犀",
    skill: "sheet",
    action: "write",
    path: "/Users/me/工作/季度报告.xlsx",
    output: null,
    versionId: "vabc12345",
    done: "wrote 3 cells",
    verified: true,
    diff: diff({
      counts: { added: 0, removed: 0, changed: 3 },
      cells: [
        { sheet: "Sheet1", cell: "B3", old: "100", new: "120" },
        { sheet: "Sheet1", cell: "B4", old: "", new: "=SUM(B1:B3) → 340" },
        { sheet: "汇总", cell: "C1", old: "旧", new: "" },
      ],
    }),
    at: Date.parse("2026-11-19T10:00:00Z"),
    ...overrides,
  };
}

describe("the card of a file change", () => {
  it("lists one line for each change, in the file's own words", () => {
    expect(hxDiffLines(event().diff)).toEqual([
      "Sheet1!B3: 100 → 120",
      "Sheet1!B4: — → =SUM(B1:B3) → 340",
      "汇总!C1: 旧 → —",
    ]);
    expect(hxDiffLines(diff({ sheets: { added: ["新表"], removed: ["旧表"] } }))).toEqual(["+ [新表]", "− [旧表]"]);
    expect(
      hxDiffLines(
        diff({
          kind: "slides",
          blocks: [
            { kind: "added", oldNumber: null, newNumber: 4, old: "", new: "结论", details: [] },
            { kind: "removed", oldNumber: 2, newNumber: null, old: "目录", new: "", details: [] },
            { kind: "changed", oldNumber: 3, newNumber: 3, old: "季度", new: "年度", details: ["title: 季度 → 年度"] },
            { kind: "moved", oldNumber: 5, newNumber: 1, old: "封面", new: "封面", details: [] },
          ],
        }),
      ),
    ).toEqual(["+ #4: 结论", "− #2: 目录", "~ #3: 季度 → 年度", "  title: 季度 → 年度", "↕ #5 → 1: 封面"]);
    expect(hxDiffLines(diff({ kind: "pdf", fields: [{ name: "姓名", old: "", new: "王强" }] }))).toEqual([
      "姓名: — → 王强",
    ]);
    expect(
      hxDiffLines(
        diff({
          kind: "text",
          hunks: [
            {
              oldStart: 1,
              oldLines: 2,
              newStart: 1,
              newLines: 2,
              lines: [
                { kind: " ", text: "same" },
                { kind: "-", text: "old line" },
                { kind: "+", text: "new line" },
              ],
            },
          ],
        }),
      ),
    ).toEqual(["− old line", "+ new line"]);
  });

  it("says how many more there are past the limit, and that a cut diff still has complete numbers", () => {
    const cells = Array.from({ length: 75 }, (_, index) => ({ sheet: "S", cell: `A${index + 1}`, old: "1", new: "2" }));
    const lines = hxDiffLines(diff({ cells }));
    expect(lines).toHaveLength(HX_FILE_CHANGE_LIMITS.lines);
    expect(lines.at(-1)).toBe("… 16 more changes");
    expect(localizeSourceText(lines.at(-1) ?? "", "zh")).toBe("……还有 16 处改动");
    const cut = hxDiffLines(diff({ cells: cells.slice(0, 3), truncated: true }));
    expect(cut).toHaveLength(4);
    expect(cut.at(-1)).toBe("… the list stops here; the numbers in the title are complete");
  });

  it("titles the change by what happened, says whether it was read back and can be restored", () => {
    const changed = hxFileChangeCard(event());
    expect(changed).toMatchObject({
      title: "Changed 季度报告.xlsx: 3 changed, 0 added, 0 removed",
      note: "HXBot read the file back, and it is as expected.",
      file: "/Users/me/工作/季度报告.xlsx",
    });
    expect(localizeSourceText(changed.title, "zh")).toBe("改了 季度报告.xlsx：改 3 处，加 0 处，删 0 处");
    expect(localizeSourceText(changed.note, "zh")).toBe("HXBot 已读回核对，和预期一致。");
    const noVersion = hxFileChangeCard(event({ versionId: null, verified: false }));
    expect(localizeSourceText(noVersion.note, "zh")).toBe(
      "HXBot 没能读回核对这个文件。这次没留版本，不能恢复到修改前。",
    );
    const made = hxFileChangeCard(
      event({ output: "/Users/me/工作/季度报告.pdf", versionId: null, diff: diff({ before: null }) }),
    );
    expect(made.title).toBe("Made 季度报告.pdf");
    expect(made.file).toBe("/Users/me/工作/季度报告.pdf");
    // A new file has nothing to go back to: the note does not say a version is missing.
    expect(made.note).toBe("HXBot read the file back, and it is as expected.");
    const same = hxFileChangeCard(event({ diff: diff({ identical: true }) }));
    expect(same.title).toBe("Saved 季度报告.xlsx; its content did not change");
    expect(same.lines).toEqual([]);
    const fileOnly = hxFileChangeCard(
      event({ path: "/x/图.psd", diff: diff({ kind: "file", fileOnly: "unsupported" }) }),
    );
    expect(localizeSourceText(fileOnly.title, "zh")).toBe("改了 图.psd（这类文件看不到具体改动）");
  });

  it("is a message whose text every client reads, with the version in its id", () => {
    const message = hxFileChangeMessage(event(), () => "u1");
    expect(message).toMatchObject({
      id: "hx-file-change:vabc12345",
      author: "system",
      source: "system",
      itemType: HX_FILE_CHANGE_ITEM_TYPE,
      status: "completed",
      createdAt: "2026-11-19T10:00:00.000Z",
    });
    expect(message.text.split("\n").slice(0, 4)).toEqual([
      "Changed 季度报告.xlsx: 3 changed, 0 added, 0 removed",
      "HXBot read the file back, and it is as expected.",
      "/Users/me/工作/季度报告.xlsx",
      "",
    ]);
    expect(hxParseFileChangeText(message.text)?.lines).toHaveLength(3);
    expect(hxFileChangeVersionId(message.id)).toBe("vabc12345");
    const none = hxFileChangeMessage(event({ versionId: null }), () => "u1");
    expect(none.id).toBe("hx-file-change:none-u1");
    expect(hxFileChangeVersionId(none.id)).toBeNull();
  });
});

describe("restore to before the change (BAK-03-A1)", () => {
  async function setup() {
    const base = await mkdtemp(join(tmpdir(), "hx-change-card-"));
    folders.push(base);
    const work = join(base, "work");
    await mkdir(work, { recursive: true });
    const versions = new HxFileVersions({ root: () => join(base, "data", "file-versions") });
    const file = join(work, "报告.txt");
    await writeFile(file, "修改前\n");
    const before = sha(await readFile(file));
    const saved = await versions.withFile(file, async () => {
      const kept = await versions.save({
        path: file,
        task: "thread-1",
        agent: "小犀",
        tool: "computer_skill",
        expectSha256: before,
      });
      if (kept.status !== "saved") throw new Error(kept.status);
      await versions.write({
        path: file,
        task: "thread-1",
        content: new TextEncoder().encode("修改后\n"),
        expectSha256: before,
        versionId: kept.record.id,
      });
      return kept.record;
    });
    const chat = new Map<string, ConversationMessage>();
    const card = hxFileChangeMessage(
      event({
        path: file,
        versionId: saved.id,
        diff: diff({ kind: "text", counts: { added: 1, removed: 1, changed: 0 } }),
      }),
      () => "u",
    );
    chat.set(card.id, card);
    hxSetFileCardPort({
      write: (_agentId, threadId, message) => {
        if (threadId === "thread-1") chat.set(message.id, message);
      },
      read: (_agentId, threadId, messageId) => (threadId === "thread-1" ? (chat.get(messageId) ?? null) : null),
    });
    return { versions, file, before, card, chat };
  }

  it("puts the file back, marks the card restored on every screen, and does nothing the second time", async () => {
    const { versions, file, before, card, chat } = await setup();
    const input = { agentId: "a", threadId: "thread-1", messageId: card.id };
    expect(await hxRestoreFileChange(input, versions, "user")).toEqual({ status: "restored" });
    expect(sha(await readFile(file))).toBe(before);
    const restored = chat.get(card.id);
    expect(restored?.itemType).toBe(HX_FILE_RESTORED_ITEM_TYPE);
    expect(localizeSourceText(restored?.text.split("\n")[0] ?? "", "zh")).toBe("已把 报告.txt 恢复到修改前");
    // The file as it was before the restore is a version too: the restore can be undone.
    const kept = (await versions.list("thread-1")).filter((record) => record.reason === "before-restore");
    expect(kept).toHaveLength(1);
    // Again: the card is restored already; nothing changes.
    await writeFile(file, "又改了\n");
    expect(await hxRestoreFileChange(input, versions, "user")).toEqual({ status: "unchanged" });
    expect((await readFile(file)).toString()).toBe("又改了\n");
  });

  it("restores only a card that is in that chat, and says why not otherwise", async () => {
    const { versions, card, chat } = await setup();
    expect(
      await hxRestoreFileChange({ agentId: "a", threadId: "other", messageId: card.id }, versions, "user"),
    ).toMatchObject({
      status: "missing",
      reason: "This card is not in this chat any more.",
    });
    const none = hxFileChangeMessage(event({ versionId: null }), () => "x");
    chat.set(none.id, none);
    expect(
      await hxRestoreFileChange({ agentId: "a", threadId: "thread-1", messageId: none.id }, versions, "user"),
    ).toMatchObject({
      status: "missing",
      reason: "No version was kept before this change, so it cannot be restored.",
    });
    const gone = hxFileChangeMessage(event({ versionId: "vzzzzzz99" }), () => "x");
    chat.set(gone.id, gone);
    const answer = await hxRestoreFileChange(
      { agentId: "a", threadId: "thread-1", messageId: gone.id },
      versions,
      "user",
    );
    expect(answer).toMatchObject({ status: "missing" });
    expect(answer.status === "missing" && localizeSourceText(answer.reason, "zh")).toBe("修改前的版本已经不在了。");
    hxSetFileCardPort(null);
    expect(
      await hxRestoreFileChange({ agentId: "a", threadId: "thread-1", messageId: card.id }, versions, "user"),
    ).toMatchObject({
      status: "failed",
    });
  });
});
