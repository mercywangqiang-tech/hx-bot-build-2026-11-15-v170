// HXBot v1.7.4（ART-05、BAK-03）：对话里“改了文件”的卡片：读回卡片的文字，按界面语言显示，接上“恢复到修改前”。
// 只有运行这个助手的电脑能恢复：别的电脑看得到卡片，按钮换成一句说明。
import {
  HX_FILE_CHANGE_ITEM_TYPE,
  HX_FILE_RESTORED_ITEM_TYPE,
  type HxRestoreFileChangeInput,
  type HxRestoreFileChangeResult,
  hxFileChangeVersionId,
  hxParseFileChangeText,
} from "@hxbot/contracts/hx-file-change";
import type { AgentMessage } from "@hxbot/ui/data";
import { HxFileChangeCard } from "@hxbot/ui/features/conversation/HxFileChangeCard";
import { useText } from "@hxbot/ui/text";
import { createStore, Show } from "solid-js";
import { accountPort } from "../account/account-port";

/** Whether a chat row is the card of a file change, restored or not. */
export function isHxFileChangeRow(message: AgentMessage): boolean {
  return message.itemType === HX_FILE_CHANGE_ITEM_TYPE || message.itemType === HX_FILE_RESTORED_ITEM_TYPE;
}

export interface HxFileChangeRowProps {
  message: AgentMessage;
  agentId: string | undefined;
  /** The chat the card is in; null or undefined: the agent's main chat. */
  threadId: string | null | undefined;
  /** The agent runs on this computer, so its files are here. */
  local: boolean;
  /** The call that restores (default: main, through the account port); a test passes its own. */
  restore?: (input: HxRestoreFileChangeInput) => Promise<HxRestoreFileChangeResult>;
}

const restoreInMain = (input: HxRestoreFileChangeInput) => accountPort().auth.hxRestoreFileChange(input);

export function HxFileChangeRow(props: HxFileChangeRowProps) {
  const { t, sourceText } = useText();
  const card = () => hxParseFileChangeText(props.message.body);
  const restored = () => props.message.itemType === HX_FILE_RESTORED_ITEM_TYPE;
  const restorable = () => hxFileChangeVersionId(props.message.id) !== null && !restored();
  // A restore that runs, and what the last one said: they change together.
  const [state, setState] = createStore<{ restoring: boolean; outcome: { text: string; failed: boolean } | null }>({
    restoring: false,
    outcome: null,
  });
  const said = (result: HxRestoreFileChangeResult) => {
    if (result.status === "restored") return { text: t("conversation.hx.fileChange.restoredNow"), failed: false };
    if (result.status === "unchanged") return { text: t("conversation.hx.fileChange.unchanged"), failed: false };
    return { text: t("conversation.hx.fileChange.failed", { reason: sourceText(result.reason) }), failed: true };
  };
  const restore = async () => {
    const agentId = props.agentId;
    if (!agentId || state.restoring) return;
    setState((draft) => {
      draft.restoring = true;
      draft.outcome = null;
    });
    try {
      const result = await (props.restore ?? restoreInMain)({
        agentId,
        threadId: props.threadId ?? null,
        messageId: props.message.id,
      });
      const outcome = said(result);
      setState((draft) => {
        draft.restoring = false;
        draft.outcome = outcome;
      });
    } catch (error) {
      const reason = error instanceof Error ? sourceText(error.message) : "";
      const outcome = { text: t("conversation.hx.fileChange.failed", { reason }), failed: true };
      setState((draft) => {
        draft.restoring = false;
        draft.outcome = outcome;
      });
    }
  };
  // A remote chat shows the card; only the computer that runs the agent has the file and its versions.
  const message = () =>
    state.outcome?.text ?? (restorable() && !props.local ? t("conversation.hx.fileChange.remote") : null);
  return (
    <Show when={card()} fallback={<p class="hx-file-change-fallback">{props.message.body}</p>}>
      {(current) => (
        <HxFileChangeCard
          title={sourceText(current().title)}
          note={sourceText(current().note)}
          file={current().file}
          // The last line that says what the card leaves out is HXBot's own; the others are the file's words.
          lines={current().lines.map((line) => (line.startsWith("…") ? sourceText(line) : line))}
          restored={restored()}
          restoring={state.restoring}
          message={message()}
          failed={state.outcome?.failed === true}
          onRestore={restorable() && props.local && props.agentId ? () => void restore() : undefined}
        />
      )}
    </Show>
  );
}
