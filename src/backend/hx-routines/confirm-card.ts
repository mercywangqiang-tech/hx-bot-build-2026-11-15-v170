/** HXBot (v1.7.5, RTN-02): the chat message of a routine run that waits for the person's yes. */

import { sortConversationMessages } from "@hxbot/contracts/conversation-order";
import {
  HX_ROUTINE_CONFIRM_DONE_ITEM_TYPE,
  HX_ROUTINE_CONFIRM_ITEM_TYPE,
  type HxRoutineConfirmCard,
  hxRoutineConfirmText,
} from "@hxbot/contracts/hx-routine-confirm";
import type { ConversationMessage } from "@hxbot/contracts/ipc";
import type { ConversationRuntime } from "../agent/conversation-runtime";
import type { HxBotDatabase } from "../hxbot-database";

/** A card keeps its id and its first time, so an answer replaces it in place. */
function hxRoutineConfirmMessage(
  id: string,
  card: HxRoutineConfirmCard,
  settled: boolean,
  createdAt: string = new Date().toISOString(),
): ConversationMessage {
  return {
    id,
    author: "system",
    source: "system",
    text: hxRoutineConfirmText(card),
    createdAt,
    status: "completed",
    itemType: settled ? HX_ROUTINE_CONFIRM_DONE_ITEM_TYPE : HX_ROUTINE_CONFIRM_ITEM_TYPE,
  };
}

/**
 * Writes the card into the agent's chat, or again in place under its id. The agent service passes its
 * conversation runtime and database; it never throws.
 */
export function hxWriteRoutineConfirmCard(
  conversation: Pick<ConversationRuntime, "withConversationTransaction">,
  database: Pick<HxBotDatabase, "persistConversationChanges">,
  agentId: string,
  cardId: string,
  card: HxRoutineConfirmCard,
  settled: boolean,
  onError: (error: unknown) => void,
): void {
  try {
    conversation.withConversationTransaction(agentId, ({ threadId, snapshot }) => {
      const at = snapshot.messages.findIndex((message) => message.id === cardId);
      const earlier = at >= 0 ? snapshot.messages[at] : undefined;
      const message = hxRoutineConfirmMessage(cardId, card, settled, earlier?.createdAt);
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
        eventType: "thread.hx-routine-confirm",
      });
      return { result: undefined, snapshot };
    });
  } catch (error) {
    onError(error);
  }
}
