// HXBot 进度卡（v1.6.7）：协作和电脑操作的进度卡，画成对话里的任务清单（带进度环和“几/共几”）。
//
// The backend writes the card as a system message whose text is the card (`hxProgressText`). The
// chat reads it back here into the shape of a plan, so the plan block draws it: the header names the
// work and how far it is, in the reader's language, and each step shows done, running or not yet.
import { HX_PROGRESS_ITEM_TYPE, hxParseProgressText } from "@hxbot/contracts/hx-progress";
import type { ConversationMessage } from "@hxbot/contracts/ipc";
import type { AgentMessagePlan } from "@hxbot/ui/data";
import { currentText } from "@hxbot/ui/text";

/** The plan block of a progress card, or null when the message is not one. */
export function hxProgressPlan(message: ConversationMessage): AgentMessagePlan | null {
  if (message.author !== "system" || message.itemType !== HX_PROGRESS_ITEM_TYPE) return null;
  const card = hxParseProgressText(message.text);
  if (!card) return null;
  const { sourceText } = currentText();
  return {
    explanation: sourceText(card.title),
    steps: card.steps.map((step, index) => ({
      id: String(index),
      // HXBot (v1.7.4, CONC-09): a member line is the English of a source key, as the title is: the
      // reader's language. A step's own words (a goal, a name) do not match a key and stay as they are.
      text: step.state === "failed" ? `✗ ${sourceText(step.text)}` : sourceText(step.text),
      status: step.state === "done" ? "completed" : step.state === "active" ? "inProgress" : "pending",
    })),
    stopped: message.status === "interrupted" || message.status === "failed",
  };
}

/** True while the work of a progress card goes on, so its running step shows as running. */
export function hxProgressLive(message: ConversationMessage): boolean {
  if (message.itemType !== HX_PROGRESS_ITEM_TYPE || message.status !== "completed") return false;
  return hxParseProgressText(message.text)?.steps.some((step) => step.state === "active") === true;
}
