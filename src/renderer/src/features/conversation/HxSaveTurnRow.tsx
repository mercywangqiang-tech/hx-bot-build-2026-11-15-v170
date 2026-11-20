// HXBot v1.7.5（RTN-11）：一轮用电脑操控、应用技能或团队做成的事，结束后在对话里多一行“存成工作流”。
// 存下的工作流照原样重做每一步，删除、运行脚本、安装、改设置、组团队之前各加一个确认点；对话里给过的批准不带过去。
// 只有运行这个助手的电脑能存：别的电脑看得到这一行，按钮换成一句说明。
import { HX_SAVE_TURN_ITEM_TYPE, type HxSaveTurnResult, hxParseSaveTurnText } from "@hxbot/contracts/hx-workflows";
import { Button } from "@hxbot/ui";
import type { AgentMessage } from "@hxbot/ui/data";
import { useText } from "@hxbot/ui/text";
import { createStore, Show } from "solid-js";
import { accountPort } from "../account/account-port";
import { useWindowPage } from "../window/window-page-context";

export function isHxSaveTurnRow(message: AgentMessage): boolean {
  return message.itemType === HX_SAVE_TURN_ITEM_TYPE;
}

export interface HxSaveTurnRowProps {
  message: AgentMessage;
  agentId: string | undefined;
  /** The agent runs on this computer, so the workflow is made here. */
  local: boolean;
  /** The call that saves (default: main, through the account port); a test passes its own. */
  save?: (input: { agentId: string; turnId: string }) => Promise<HxSaveTurnResult>;
}

const saveInMain = (input: { agentId: string; turnId: string }) => accountPort().auth.hxSaveTurnAsWorkflow(input);

export function HxSaveTurnRow(props: HxSaveTurnRowProps) {
  const { t, sourceText } = useText();
  const windowPage = useWindowPage();
  const line = () => hxParseSaveTurnText(props.message.body);
  const [state, setState] = createStore<{ busy: boolean; saved: string | null; error: string | null }>({
    busy: false,
    saved: null,
    error: null,
  });
  const save = async () => {
    const agentId = props.agentId;
    const current = line();
    if (!agentId || !current || state.busy) return;
    setState((draft) => {
      draft.busy = true;
      draft.error = null;
    });
    try {
      const result = await (props.save ?? saveInMain)({ agentId, turnId: current.turnId });
      setState((draft) => {
        draft.busy = false;
        draft.saved = result.title;
      });
    } catch (error) {
      const reason = error instanceof Error ? sourceText(error.message) : String(error);
      setState((draft) => {
        draft.busy = false;
        draft.error = reason;
      });
    }
  };
  return (
    <Show when={line()}>
      {(current) => (
        <div class="hx-save-turn" role="status">
          <span>{t("conversation.hx.saveTurn.text", { count: current().steps })}</span>
          <Show
            when={state.saved !== null || current().saved === true}
            fallback={
              <Show when={props.local && props.agentId}>
                <Button type="button" size="sm" disabled={state.busy} onClick={() => void save()}>
                  {t("conversation.hx.saveTurn.save")}
                </Button>
              </Show>
            }
          >
            <span class="hx-save-turn-done">
              {state.saved !== null
                ? t("conversation.hx.saveTurn.saved", { title: state.saved })
                : t("conversation.hx.saveTurn.savedBefore")}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={(event) => windowPage.openWorkflows(event.currentTarget)}
            >
              {t("conversation.hx.saveTurn.open")}
            </Button>
          </Show>
          <Show when={state.error}>
            {(reason) => (
              <span class="hx-save-turn-error" role="alert">
                {t("conversation.hx.saveTurn.failed", { reason: reason() })}
              </span>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}
