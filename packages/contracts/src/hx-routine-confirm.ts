// HXBot v1.7.5（RTN-02、MIG-03、CONC-14）：定时任务运行前等你确认的卡片。
//
// A routine run that sends, posts, pays or deletes and makes up for missed runs, or a routine that
// asks before each run, does not start until the person says yes for this time. The question is a
// system message of its own item type in the agent's chat; no turn waits for it, so it holds no place
// in any queue. Its text is the card itself (a title, a note, the actions, one line per routine), so a
// client that does not know the item type (the mobile app, an older desktop) still shows it readably;
// the title and the note are source text, so each screen shows them in its own language. The message
// id names the card; an answered or expired card changes its item type, so every screen sees it.
import { isBoolean, isDynamicRecord, isString } from "./runtime-values";

export const HX_ROUTINE_CONFIRM_ITEM_TYPE = "hx-routine-confirm";
export const HX_ROUTINE_CONFIRM_DONE_ITEM_TYPE = "hx-routine-confirm-done";
export const HX_ROUTINE_CONFIRM_ID_PREFIX = "hx-routine-confirm:";

export interface HxRoutineConfirmCard {
  /** One short line: which routine waits, or how many. */
  title: string;
  /** One line: why it asks (a catch-up and its missed runs, or "asks before each run"). */
  note: string;
  /** One line: what the run will do (send, post, pay, delete). */
  actions: string;
  /** One line per routine of the card: its name and the start of its instruction. */
  lines: string[];
  /** Set once the card is settled: what happened. */
  outcome?: string | undefined;
}

export const HX_ROUTINE_CONFIRM_LIMITS = { lines: 20, text: 300 } as const;

const oneLine = (value: string, limit: number): string => {
  const line = value.replace(/\s+/gu, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
};

/** The text of a card. */
export function hxRoutineConfirmText(card: HxRoutineConfirmCard): string {
  const limit = HX_ROUTINE_CONFIRM_LIMITS.text;
  const lines = card.lines.slice(0, HX_ROUTINE_CONFIRM_LIMITS.lines).map((line) => `- ${oneLine(line, limit) || "…"}`);
  return [
    oneLine(card.title, limit),
    oneLine(card.note, limit),
    oneLine(card.actions, limit),
    "",
    ...lines,
    ...(card.outcome ? ["", oneLine(card.outcome, limit)] : []),
  ].join("\n");
}

/** The card read back from its text, or null when the text is not a card. */
export function hxParseRoutineConfirmText(text: string): HxRoutineConfirmCard | null {
  const [title, note, actions, blank, ...rest] = text.split("\n");
  if (!title || note === undefined || actions === undefined || blank !== "") return null;
  const lines: string[] = [];
  let outcome: string | undefined;
  for (const [index, line] of rest.entries()) {
    if (line.startsWith("- ")) {
      lines.push(line.slice(2));
      continue;
    }
    if (line === "" && index === rest.length - 2 && rest[index + 1]) {
      outcome = rest[index + 1];
      break;
    }
    return null;
  }
  if (lines.length === 0 || lines.length > HX_ROUTINE_CONFIRM_LIMITS.lines) return null;
  return { title, note, actions, lines, ...(outcome ? { outcome } : {}) };
}

export function isHxRoutineConfirmMessage(message: unknown): message is { id: string; itemType: string; text: string } {
  return (
    isDynamicRecord(message) &&
    isString(message.id) &&
    message.id.startsWith(HX_ROUTINE_CONFIRM_ID_PREFIX) &&
    (message.itemType === HX_ROUTINE_CONFIRM_ITEM_TYPE || message.itemType === HX_ROUTINE_CONFIRM_DONE_ITEM_TYPE) &&
    isString(message.text)
  );
}

interface HxAnswerRoutineConfirmFields {
  /** The id of the card (the message id of an agent's card). */
  cardId: string;
  /** Yes: run it this time. No: skip this time. */
  run: boolean;
}

/** The answer names the agent or the channel that owns the routine: exactly one of them. */
export type HxAnswerRoutineConfirmInput =
  | (HxAnswerRoutineConfirmFields & { agentId: string; channelId?: undefined })
  | (HxAnswerRoutineConfirmFields & { channelId: string; agentId?: undefined });

export interface HxAnswerRoutineConfirmResult {
  /** How many runs started, and how many were skipped or had already settled. */
  ran: number;
  skipped: number;
  settled: number;
}

const isOwnerIdValue = (value: unknown): value is string => isString(value) && value.length > 0 && value.length <= 128;

export function decodeHxAnswerRoutineConfirmInput(value: unknown): HxAnswerRoutineConfirmInput {
  if (
    !isDynamicRecord(value) ||
    !isString(value.cardId) ||
    !value.cardId.startsWith(HX_ROUTINE_CONFIRM_ID_PREFIX) ||
    value.cardId.length > 200 ||
    !isBoolean(value.run)
  ) {
    throw new Error("Invalid routine confirmation answer.");
  }
  const agent = value.agentId;
  const channel = value.channelId;
  if (isOwnerIdValue(agent) && channel === undefined) return { agentId: agent, cardId: value.cardId, run: value.run };
  if (isOwnerIdValue(channel) && agent === undefined)
    return { channelId: channel, cardId: value.cardId, run: value.run };
  throw new Error("Invalid routine confirmation answer.");
}

export function decodeHxAnswerRoutineConfirmResult(value: unknown): HxAnswerRoutineConfirmResult {
  const count = (field: unknown): number => {
    if (typeof field !== "number" || !Number.isSafeInteger(field) || field < 0) {
      throw new Error("Invalid routine confirmation result.");
    }
    return field;
  };
  if (!isDynamicRecord(value)) throw new Error("Invalid routine confirmation result.");
  return { ran: count(value.ran), skipped: count(value.skipped), settled: count(value.settled) };
}
