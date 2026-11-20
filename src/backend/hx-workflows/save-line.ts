/** HXBot (v1.7.5, RTN-11): the chat line after a turn that can be saved as a workflow. */

import { sortConversationMessages } from "@hxbot/contracts/conversation-order";
import {
  HX_SAVE_TURN_ID_PREFIX,
  HX_SAVE_TURN_ITEM_TYPE,
  type HxSaveTurnLine,
  hxSaveTurnText,
} from "@hxbot/contracts/hx-workflows";
import type { ConversationMessage } from "@hxbot/contracts/ipc";
import type { ConversationRuntime } from "../agent/conversation-runtime";
import type { HxBotDatabase } from "../hxbot-database";

function hxSaveTurnLineId(turnId: string): string {
  return `${HX_SAVE_TURN_ID_PREFIX}${turnId}`;
}

/**
 * Writes the line into the agent's chat, or again in place under its id (when the turn was saved). It
 * keeps its first time. It never throws.
 */
export function hxWriteSaveTurnLine(
  conversation: Pick<ConversationRuntime, "withConversationTransaction">,
  database: Pick<HxBotDatabase, "persistConversationChanges">,
  agentId: string,
  line: HxSaveTurnLine,
  onError: (error: unknown) => void,
): void {
  const id = hxSaveTurnLineId(line.turnId);
  try {
    conversation.withConversationTransaction(agentId, ({ threadId, snapshot }) => {
      const at = snapshot.messages.findIndex((message) => message.id === id);
      const earlier = at >= 0 ? snapshot.messages[at] : undefined;
      const message: ConversationMessage = {
        id,
        author: "system",
        source: "system",
        text: hxSaveTurnText(line),
        createdAt: earlier?.createdAt ?? new Date().toISOString(),
        status: "completed",
        itemType: HX_SAVE_TURN_ITEM_TYPE,
      };
      if (earlier) snapshot.messages[at] = message;
      else {
        snapshot.messages.push(message);
        sortConversationMessages(snapshot.messages);
      }
      snapshot.revision = database.persistConversationChanges({
        agentId,
        threadId,
        activeTurnId: snapshot.activeTurnId,
        changedMessages: [message],
        eventType: "thread.hx-save-turn",
      });
      return { result: undefined, snapshot };
    });
  } catch (error) {
    onError(error);
  }
}
