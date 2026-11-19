// HXBot v1.7.4（ART-05、BAK-03）：智能体用应用技能改了文件后，对话里的一张卡片：改了什么（差异可展开）、
// “恢复到修改前”。
//
// The card is a system message of its own item type. Its text is the card itself: a title line, a
// note line, a line with the file's path, an empty line and one line per change ("- " first), so a
// client that does not know the item type (the mobile app, an older desktop, the web of another
// host) still shows it readably. The title and the note are source text, so each screen shows them
// in its own language; the change lines are the file's own words and stay as they are. The message id holds the version to
// restore; a restored card changes its item type, so every screen sees that it was restored.
import { isDynamicRecord } from "./runtime-values";

export const HX_FILE_CHANGE_ITEM_TYPE = "hx-file-change";
export const HX_FILE_RESTORED_ITEM_TYPE = "hx-file-change-restored";
/** The id of a card: this prefix and the id of the version kept before the change ("none-…" for none). */
export const HX_FILE_CHANGE_ID_PREFIX = "hx-file-change:";

export interface HxFileChangeCard {
  /** One short line: what changed in which file, and whether it was read back. */
  title: string;
  /** One line about the check and the version: read back or not, restorable or not. */
  note: string;
  /** Where the file is (or where the result went). */
  file: string;
  /** One line for each change, at most `HX_FILE_CHANGE_LIMITS.lines`. */
  lines: string[];
}

export const HX_FILE_CHANGE_LIMITS = { lines: 60, text: 300, path: 1024 } as const;

const oneLine = (value: string, limit: number): string => {
  const line = value.replace(/\s+/gu, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
};

/** The text of a card. */
export function hxFileChangeText(card: HxFileChangeCard): string {
  const lines = card.lines
    .slice(0, HX_FILE_CHANGE_LIMITS.lines)
    .map((line) => `- ${oneLine(line, HX_FILE_CHANGE_LIMITS.text) || "…"}`);
  return [
    oneLine(card.title, HX_FILE_CHANGE_LIMITS.text),
    oneLine(card.note, HX_FILE_CHANGE_LIMITS.text),
    oneLine(card.file, HX_FILE_CHANGE_LIMITS.path),
    "",
    ...lines,
  ].join("\n");
}

/** The card read back from its text, or null when the text is not a card. */
export function hxParseFileChangeText(text: string): HxFileChangeCard | null {
  const [title, note, file, blank, ...rest] = text.split("\n");
  if (!title || note === undefined || !file || blank !== "" || rest.length > HX_FILE_CHANGE_LIMITS.lines) return null;
  const lines: string[] = [];
  for (const line of rest) {
    if (!line.startsWith("- ")) return null;
    lines.push(line.slice(2));
  }
  return { title, note, file, lines };
}

/** Whether a stored message is a card of a change, restored or not. */
export function isHxFileChangeMessage(message: unknown): message is { id: string; itemType: string; text: string } {
  return (
    isDynamicRecord(message) &&
    typeof message.id === "string" &&
    message.id.startsWith(HX_FILE_CHANGE_ID_PREFIX) &&
    (message.itemType === HX_FILE_CHANGE_ITEM_TYPE || message.itemType === HX_FILE_RESTORED_ITEM_TYPE) &&
    typeof message.text === "string"
  );
}

/** The version a card restores, or null when it kept none. */
export function hxFileChangeVersionId(messageId: string): string | null {
  if (!messageId.startsWith(HX_FILE_CHANGE_ID_PREFIX)) return null;
  const id = messageId.slice(HX_FILE_CHANGE_ID_PREFIX.length);
  return id === "" || id.startsWith("none-") ? null : id;
}

/** “恢复到修改前” on a card: the chat it is in (null: the agent's main chat) and its message id. */
export interface HxRestoreFileChangeInput {
  agentId: string;
  threadId: string | null;
  messageId: string;
}

export type HxRestoreFileChangeResult =
  | { status: "restored" }
  | { status: "unchanged" }
  | { status: "missing" | "damaged" | "failed" | "space-full"; reason: string };

const ID_LIMIT = 256;
const REASON_LIMIT = 1000;

const shortString = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= limit;

export function decodeHxRestoreFileChangeInput(value: unknown): HxRestoreFileChangeInput {
  if (
    !isDynamicRecord(value) ||
    !shortString(value.agentId, ID_LIMIT) ||
    !(value.threadId === null || shortString(value.threadId, ID_LIMIT)) ||
    !shortString(value.messageId, ID_LIMIT) ||
    !value.messageId.startsWith(HX_FILE_CHANGE_ID_PREFIX)
  )
    throw new Error("A card of a file change is required.");
  return { agentId: value.agentId, threadId: value.threadId, messageId: value.messageId };
}

export function decodeHxRestoreFileChangeResult(value: unknown): HxRestoreFileChangeResult {
  if (isDynamicRecord(value)) {
    if (value.status === "restored" || value.status === "unchanged") return { status: value.status };
    if (
      (value.status === "missing" ||
        value.status === "damaged" ||
        value.status === "failed" ||
        value.status === "space-full") &&
      typeof value.reason === "string"
    )
      return { status: value.status, reason: value.reason.slice(0, REASON_LIMIT) };
  }
  throw new Error("The answer of a restore is not valid.");
}

/** Settings → Computer Use: how much the versions kept before changes may take, and what they take. */
export interface HxFileVersionsView {
  capBytes: number;
  defaultCapBytes: number;
  /** The user chose the cap (false: the default). */
  custom: boolean;
  usedBytes: number;
  versions: number;
}

/** The caps the setting offers, in bytes: 1, 2, 5, 10, 20 and 50 GB. */
export const HX_FILE_VERSION_CAPS = [1, 2, 5, 10, 20, 50].map((gigabytes) => gigabytes * 1024 ** 3);

const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function decodeHxFileVersionsView(value: unknown): HxFileVersionsView {
  if (
    isDynamicRecord(value) &&
    count(value.capBytes) &&
    count(value.defaultCapBytes) &&
    typeof value.custom === "boolean" &&
    count(value.usedBytes) &&
    count(value.versions)
  )
    return {
      capBytes: value.capBytes,
      defaultCapBytes: value.defaultCapBytes,
      custom: value.custom,
      usedBytes: value.usedBytes,
      versions: value.versions,
    };
  throw new Error("The versions setting is not valid.");
}

/** The cap a request sets: one of `HX_FILE_VERSION_CAPS`, or null for the default. */
export function decodeHxFileVersionCap(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === "number" && HX_FILE_VERSION_CAPS.includes(value)) return value;
  throw new Error("Choose one of the offered sizes.");
}

/** A size as a person reads it: KB under 1 MB, MB under 1 GB, else GB; one decimal below 10. */
export function hxByteSize(bytes: number): string {
  const units = [
    { unit: "GB", size: 1024 ** 3 },
    { unit: "MB", size: 1024 ** 2 },
    { unit: "KB", size: 1024 },
  ];
  const value = Math.max(0, bytes);
  for (const { unit, size } of units) {
    if (value < size && unit !== "KB") continue;
    const amount = value / size;
    return `${amount >= 10 ? Math.round(amount) : Math.round(amount * 10) / 10} ${unit}`;
  }
  return "0 KB";
}
