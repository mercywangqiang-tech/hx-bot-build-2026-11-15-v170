// HXBot v1.7.4（ART-05-A1、BAK-03-A1）：改了文件后对话里的卡片，和卡片上的“恢复到修改前”。
//
// 卡片写在改文件的那个对话里（智能体服务给出写和读的接口）；标题和说明是源文字，各个屏幕按自己的语言显示；
// 差异一行一条（单元格、段落、页、行、表单字段），最多 60 条，多的写“还有 n 条”。
// “恢复到修改前”只认这个对话里真有的这张卡片，按卡片的版本号恢复；恢复前把当时的文件也留一个版本；
// 恢复后卡片改成“已恢复”，所有屏幕都看得到。
import {
  HX_FILE_CHANGE_ID_PREFIX,
  HX_FILE_CHANGE_ITEM_TYPE,
  HX_FILE_CHANGE_LIMITS,
  HX_FILE_RESTORED_ITEM_TYPE,
  type HxFileChangeCard,
  type HxRestoreFileChangeInput,
  type HxRestoreFileChangeResult,
  hxFileChangeText,
  hxFileChangeVersionId,
  hxParseFileChangeText,
  isHxFileChangeMessage,
} from "@hxbot/contracts/hx-file-change";
import type { ConversationMessage } from "@hxbot/contracts/ipc";
import { sourceText } from "@hxbot/i18n";
import type { HxFileDiff } from "../hx-files/diff";
import type { HxFileVersions } from "../hx-files/versions";
import type { HxFileChangeEvent } from "./run";

/** Where the cards live: the agent service writes and reads a chat's messages. */
export interface HxFileCardPort {
  /** Writes a card into a chat (null: the agent's main chat), or replaces the card with its id. Never throws. */
  write(agentId: string, threadId: string | null, message: ConversationMessage): void;
  /** The message with this id in that chat, or null. */
  read(agentId: string, threadId: string | null, messageId: string): ConversationMessage | null;
}

let port: HxFileCardPort | null = null;

export function hxSetFileCardPort(next: HxFileCardPort | null): void {
  port = next;
}

const EMPTY = "—";

/** The last part of a path, for the title. */
function nameOf(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}

/** One line for each change the diff lists, then "… n more" when it holds more than the card shows. */
export function hxDiffLines(diff: HxFileDiff, limit: number = HX_FILE_CHANGE_LIMITS.lines): string[] {
  const lines: string[] = [];
  for (const name of diff.sheets?.added ?? []) lines.push(`+ [${name}]`);
  for (const name of diff.sheets?.removed ?? []) lines.push(`− [${name}]`);
  for (const cell of diff.cells ?? [])
    lines.push(`${cell.sheet}!${cell.cell}: ${cell.old || EMPTY} → ${cell.new || EMPTY}`);
  for (const block of diff.blocks ?? []) {
    const at =
      block.kind === "moved"
        ? `${block.oldNumber ?? "?"} → ${block.newNumber ?? "?"}`
        : `${block.newNumber ?? block.oldNumber ?? "?"}`;
    const sign = block.kind === "added" ? "+" : block.kind === "removed" ? "−" : block.kind === "moved" ? "↕" : "~";
    const what =
      block.kind === "added"
        ? block.new
        : block.kind === "removed"
          ? block.old
          : block.kind === "moved"
            ? block.new || block.old
            : `${block.old || EMPTY} → ${block.new || EMPTY}`;
    lines.push(`${sign} #${at}: ${what || EMPTY}`);
    for (const detail of block.details.slice(0, 3)) lines.push(`  ${detail}`);
  }
  for (const field of diff.fields ?? []) lines.push(`${field.name}: ${field.old || EMPTY} → ${field.new || EMPTY}`);
  for (const hunk of diff.hunks ?? []) {
    for (const line of hunk.lines) {
      if (line.kind === " ") continue;
      lines.push(`${line.kind === "-" ? "−" : "+"} ${line.text || " "}`);
    }
  }
  // The last line says what the card leaves out: how many more lines, or that the diff itself was cut
  // at its limits (the counts in the title are still complete).
  if (lines.length > limit) {
    const shown = lines.slice(0, limit - 1);
    shown.push(sourceText("status.agent.hxSkill.change.more", { count: lines.length - shown.length }));
    return shown;
  }
  if (!diff.truncated) return lines;
  return [...lines.slice(0, limit - 1), sourceText("status.agent.hxSkill.change.cut")];
}

/** The card of a change: what changed, read back or not, restorable or not. */
export function hxFileChangeCard(event: HxFileChangeEvent): HxFileChangeCard {
  const where = event.output ?? event.path;
  const file = nameOf(where);
  const { diff } = event;
  const counts = { changed: diff.counts.changed, added: diff.counts.added, removed: diff.counts.removed };
  const title =
    diff.before === null
      ? sourceText("status.agent.hxSkill.change.made", { file })
      : diff.identical
        ? sourceText("status.agent.hxSkill.change.same", { file })
        : diff.fileOnly
          ? sourceText("status.agent.hxSkill.change.fileOnly", { file })
          : sourceText("status.agent.hxSkill.change.counts", { file, ...counts });
  // A new file has nothing to go back to; a change with no version cannot be taken back.
  const restorable = event.versionId !== null;
  const changedExisting = diff.before !== null && !diff.identical;
  const note = event.verified
    ? changedExisting && !restorable
      ? sourceText("status.agent.hxSkill.change.checkedNoVersion")
      : sourceText("status.agent.hxSkill.change.checked")
    : changedExisting && !restorable
      ? sourceText("status.agent.hxSkill.change.uncheckedNoVersion")
      : sourceText("status.agent.hxSkill.change.unchecked");
  return { title, note, file: where, lines: diff.identical ? [] : hxDiffLines(diff) };
}

/** The message of a card. Its id holds the version (or "none-…"), so a card is written once per change. */
export function hxFileChangeMessage(event: HxFileChangeEvent, unique: () => string): ConversationMessage {
  return {
    id: `${HX_FILE_CHANGE_ID_PREFIX}${event.versionId ?? `none-${unique()}`}`.slice(0, 128),
    author: "system",
    source: "system",
    text: hxFileChangeText(hxFileChangeCard(event)),
    createdAt: new Date(event.at).toISOString(),
    status: "completed",
    itemType: HX_FILE_CHANGE_ITEM_TYPE,
  };
}

/** The card after “恢复到修改前”: restored, with its lines; every screen sees it. */
function restoredMessage(message: ConversationMessage, card: HxFileChangeCard): ConversationMessage {
  return {
    ...message,
    itemType: HX_FILE_RESTORED_ITEM_TYPE,
    text: hxFileChangeText({
      ...card,
      title: sourceText("status.agent.hxSkill.change.restored", { file: nameOf(card.file) }),
      note: sourceText("status.agent.hxSkill.change.restoredNote"),
    }),
  };
}

/**
 * “恢复到修改前” on a card. Only a card that is in that chat restores, only its own version, and only
 * once (a restored card has another item type). The file as it is now is kept as a version first.
 */
export async function hxRestoreFileChange(
  input: HxRestoreFileChangeInput,
  versions: HxFileVersions | null,
  agentName: string,
): Promise<HxRestoreFileChangeResult> {
  const cards = port;
  if (!cards || !versions) return { status: "failed", reason: sourceText("status.agent.hxSkill.restore.starting") };
  const message = cards.read(input.agentId, input.threadId, input.messageId);
  if (!message || !isHxFileChangeMessage(message))
    return { status: "missing", reason: sourceText("status.agent.hxSkill.restore.notInChat") };
  if (message.itemType === HX_FILE_RESTORED_ITEM_TYPE) return { status: "unchanged" };
  const versionId = hxFileChangeVersionId(message.id);
  if (!versionId) return { status: "missing", reason: sourceText("status.agent.hxSkill.restore.noVersion") };
  const record = await versions.find(versionId);
  if (!record) return { status: "missing", reason: sourceText("status.agent.hxSkill.restore.notKept") };
  const result = await versions.restore({ task: record.task, versionId, agent: agentName });
  if (result.status === "restored" || result.status === "unchanged") {
    const card = hxParseFileChangeText(message.text);
    if (card) cards.write(input.agentId, input.threadId, restoredMessage(message, card));
    return { status: result.status };
  }
  if (result.status === "space-full")
    return { status: "space-full", reason: sourceText("status.agent.hxSkill.restore.spaceFull") };
  return { status: result.status, reason: result.reason };
}
