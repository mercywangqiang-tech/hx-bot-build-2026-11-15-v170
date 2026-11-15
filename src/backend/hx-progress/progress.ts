// HXBot 进度卡（v1.6.7）：协作和电脑操作在发起人对话里的进度卡，作为一条系统消息原地更新。
// 卡片的文字格式见 packages/contracts/src/hx-progress.ts；桌面端和网页版画成任务清单。
import { HX_PROGRESS_ITEM_TYPE, type HxProgressCard, hxProgressText } from "@hxbot/contracts/hx-progress";
import type { ConversationMessage } from "@hxbot/contracts/ipc";

/**
 * The message of a card. A card keeps its id and its first time, so each update replaces it in
 * place; a stopped card is `interrupted`, which the chat shows as stopped.
 */
export function hxProgressMessage(
  id: string,
  card: HxProgressCard,
  stopped: boolean,
  createdAt: string = new Date().toISOString(),
): ConversationMessage {
  return {
    id,
    author: "system",
    source: "system",
    text: hxProgressText(card),
    createdAt,
    status: stopped ? "interrupted" : "completed",
    itemType: HX_PROGRESS_ITEM_TYPE,
  };
}

/** What writes a card into an agent's chat. The agent service gives it; it never throws. */
export type HxProgressWriter = (agentId: string, id: string, card: HxProgressCard, stopped: boolean) => void;
