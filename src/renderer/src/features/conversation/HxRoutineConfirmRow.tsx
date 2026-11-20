// HXBot v1.7.5（RTN-02、MIG-03）：对话里“定时任务等你确认”的卡片：读回卡片的文字，按界面语言显示，接上
// “运行这一次”“这次跳过”。只有运行这个助手的电脑能回答：别的电脑看得到卡片，按钮换成一句说明。
import {
  HX_ROUTINE_CONFIRM_DONE_ITEM_TYPE,
  HX_ROUTINE_CONFIRM_ITEM_TYPE,
  type HxAnswerRoutineConfirmInput,
  type HxAnswerRoutineConfirmResult,
  hxParseRoutineConfirmText,
} from "@hxbot/contracts/hx-routine-confirm";
import type { AgentMessage } from "@hxbot/ui/data";
import { HxRoutineConfirmCard } from "@hxbot/ui/features/conversation/HxRoutineConfirmCard";
import { useText } from "@hxbot/ui/text";
import { createStore, Show } from "solid-js";
import { accountPort } from "../account/account-port";

export function isHxRoutineConfirmRow(message: AgentMessage): boolean {
  return message.itemType === HX_ROUTINE_CONFIRM_ITEM_TYPE || message.itemType === HX_ROUTINE_CONFIRM_DONE_ITEM_TYPE;
}

export interface HxRoutineConfirmRowProps {
  message: AgentMessage;
  agentId: string | undefined;
  /** The agent runs on this computer, so its routines are here. */
  local: boolean;
  /** The call that answers (default: main, through the account port); a test passes its own. */
  answer?: (input: HxAnswerRoutineConfirmInput) => Promise<HxAnswerRoutineConfirmResult>;
}

const answerInMain = (input: HxAnswerRoutineConfirmInput) => accountPort().auth.hxAnswerRoutineConfirm(input);

export function HxRoutineConfirmRow(props: HxRoutineConfirmRowProps) {
  const { t, sourceText } = useText();
  const card = () => hxParseRoutineConfirmText(props.message.body);
  const settled = () => props.message.itemType === HX_ROUTINE_CONFIRM_DONE_ITEM_TYPE;
  const [state, setState] = createStore<{ busy: boolean; message: string | null; failed: boolean }>({
    busy: false,
    message: null,
    failed: false,
  });
  const answer = async (run: boolean) => {
    const agentId = props.agentId;
    if (!agentId || state.busy) return;
    setState((draft) => {
      draft.busy = true;
      draft.message = null;
      draft.failed = false;
    });
    try {
      const result = await (props.answer ?? answerInMain)({ agentId, cardId: props.message.id, run });
      const message =
        result.ran > 0
          ? t("conversation.hx.routineConfirm.started", { count: result.ran })
          : result.skipped > 0
            ? t("conversation.hx.routineConfirm.skipped", { count: result.skipped })
            : t("conversation.hx.routineConfirm.already");
      setState((draft) => {
        draft.busy = false;
        draft.message = message;
      });
    } catch (error) {
      const reason = error instanceof Error ? sourceText(error.message) : "";
      setState((draft) => {
        draft.busy = false;
        draft.message = t("conversation.hx.routineConfirm.failed", { reason });
        draft.failed = true;
      });
    }
  };
  const remoteNote = () => (!props.local && !settled() ? t("conversation.hx.routineConfirm.remote") : null);
  return (
    <Show when={card()} fallback={<p class="hx-routine-confirm-fallback">{props.message.body}</p>}>
      {(current) => (
        <HxRoutineConfirmCard
          title={sourceText(current().title)}
          note={sourceText(current().note)}
          actions={sourceText(current().actions)}
          lines={current().lines}
          outcome={current().outcome ? sourceText(current().outcome ?? "") : settled() ? "" : null}
          busy={state.busy}
          message={state.message ?? remoteNote()}
          failed={state.failed}
          onAnswer={props.local && props.agentId && !settled() ? (run) => void answer(run) : undefined}
        />
      )}
    </Show>
  );
}
