// HXBot 进度卡（v1.6.7）：协作和电脑操作在对话里的一张进度卡，随工作原地更新。
//
// The card is a system message of its own item type. Its text is the card itself, as a header line
// and a checklist, so a client that does not know the item type (the mobile app, an older desktop)
// still shows a readable list; the desktop and the web read the text back and draw a task list with
// a progress ring. The header is source text, so each screen shows it in its own language.
import { isDynamicRecord } from "./runtime-values";

export const HX_PROGRESS_ITEM_TYPE = "hx-progress";

export const HX_PROGRESS_STATES = ["pending", "active", "done", "failed"] as const;
export type HxProgressState = (typeof HX_PROGRESS_STATES)[number];

export interface HxProgressStep {
  text: string;
  state: HxProgressState;
}

export interface HxProgressCard {
  /** One short line: what the work is and how far it is. */
  title: string;
  steps: HxProgressStep[];
}

const MARKS: Readonly<Record<HxProgressState, string>> = { pending: " ", active: ">", done: "x", failed: "!" };
const STATES: Readonly<Record<string, HxProgressState>> = { " ": "pending", ">": "active", x: "done", "!": "failed" };
const STEP_LINE = /^- \[([ >x!])\] (.+)$/u;
const MAX_STEPS = 30;
const MAX_TEXT = 200;

const oneLine = (value: string): string => value.replace(/\s+/gu, " ").trim().slice(0, MAX_TEXT);

/** The text of a card: the header, an empty line and one checklist line per step. */
export function hxProgressText(card: HxProgressCard): string {
  const lines = card.steps.slice(0, MAX_STEPS).map((step) => `- [${MARKS[step.state]}] ${oneLine(step.text) || "…"}`);
  return `${oneLine(card.title)}\n\n${lines.join("\n")}`;
}

/** The card read back from its text, or null when the text is not a card. */
export function hxParseProgressText(text: string): HxProgressCard | null {
  const [title, blank, ...rest] = text.split("\n");
  if (title === undefined || blank !== "" || rest.length === 0 || rest.length > MAX_STEPS) return null;
  const steps: HxProgressStep[] = [];
  for (const line of rest) {
    const match = STEP_LINE.exec(line);
    const state = match?.[1] === undefined ? undefined : STATES[match[1]];
    if (!match?.[2] || !state) return null;
    steps.push({ text: match[2], state });
  }
  return { title, steps };
}

/** Whether a stored message is a progress card. */
export function isHxProgressMessage(
  message: unknown,
): message is { itemType: typeof HX_PROGRESS_ITEM_TYPE; text: string } {
  return isDynamicRecord(message) && message.itemType === HX_PROGRESS_ITEM_TYPE && typeof message.text === "string";
}

// ------------------------------------------------------------------ v1.7.4 (CONC-09): 这件更急 / 不急

/** The progress card of a team is the message `hx-team-card-<team id>` in the starter's chat. */
export const HX_TEAM_CARD_ID_PREFIX = "hx-team-card-";

export const HX_TEAM_PRIORITIES = ["urgent", "normal", "relaxed"] as const;
export type HxTeamPriority = (typeof HX_TEAM_PRIORITIES)[number];

/** The team of a progress card, from the id of its message; null for any other message. */
export function hxTeamCardTeamId(messageId: string): string | null {
  if (!messageId.startsWith(HX_TEAM_CARD_ID_PREFIX)) return null;
  const id = messageId.slice(HX_TEAM_CARD_ID_PREFIX.length);
  return id.length > 0 && id.length <= 200 ? id : null;
}

/** The switch on a team's progress card: the agent whose chat shows the card, and the card. */
export interface HxSetTeamPriorityInput {
  agentId: string;
  messageId: string;
  priority: HxTeamPriority;
}

export type HxSetTeamPriorityResult =
  | { status: "changed" | "unchanged"; priority: HxTeamPriority }
  /** No running team of this agent has this card (another computer's team, or it ended). */
  | { status: "missing" | "ended" };

const isPriority = (value: unknown): value is HxTeamPriority =>
  value === "urgent" || value === "normal" || value === "relaxed";

export function decodeHxSetTeamPriorityInput(value: unknown): HxSetTeamPriorityInput {
  if (
    !isDynamicRecord(value) ||
    typeof value.agentId !== "string" ||
    value.agentId.length === 0 ||
    value.agentId.length > 200 ||
    typeof value.messageId !== "string" ||
    hxTeamCardTeamId(value.messageId) === null ||
    !isPriority(value.priority)
  )
    throw new Error("A team card and a priority are required.");
  return { agentId: value.agentId, messageId: value.messageId, priority: value.priority };
}

export function decodeHxSetTeamPriorityResult(value: unknown): HxSetTeamPriorityResult {
  if (isDynamicRecord(value)) {
    if ((value.status === "changed" || value.status === "unchanged") && isPriority(value.priority))
      return { status: value.status, priority: value.priority };
    if (value.status === "missing" || value.status === "ended") return { status: value.status };
  }
  throw new Error("The answer of the team priority is not valid.");
}
