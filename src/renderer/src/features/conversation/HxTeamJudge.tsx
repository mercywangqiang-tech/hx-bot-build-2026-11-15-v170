// HXBot v1.7.5（CONC-16）：团队进度卡下面裁判自动模式的按钮。卡片上的那一行说明现在能做什么（行的文字由主进程
// 按界面语言写好，这里按它的来源键认出来）；点了交给主进程，只有运行这个团队的电脑能改，别的电脑只看。
import { HX_PROGRESS_ITEM_TYPE, hxParseProgressText, hxTeamCardTeamId } from "@hxbot/contracts/hx-progress";
import type { HxTeamCardActionInput, HxTeamCardActionResult } from "@hxbot/contracts/hx-team-card";
import { matchingSourceKeys } from "@hxbot/i18n";
import type { AgentMessage } from "@hxbot/ui/data";
import { type HxTeamJudgeAction, HxTeamJudgeBar } from "@hxbot/ui/features/conversation/HxTeamJudgeBar";
import { useText } from "@hxbot/ui/text";
import { createStore, Show } from "solid-js";
import { accountPort } from "../account/account-port";

/** What a team's card offers of the judge: the automatic mode, the buttons of a pass, or nothing. */
export function hxTeamCardJudge(message: AgentMessage): "offer" | "went" | null {
  if (message.itemType !== HX_PROGRESS_ITEM_TYPE || hxTeamCardTeamId(message.id) === null) return null;
  if (message.status === "Stopped") return null;
  const card = hxParseProgressText(message.body);
  if (!card?.steps.some((step) => step.state !== "done")) return null;
  for (const step of card.steps) {
    const keys = matchingSourceKeys(step.text);
    if (keys.includes("status.agent.hxTeam.card.judgeOffer")) return "offer";
    if (keys.includes("status.agent.hxTeam.card.judgeWent")) return "went";
  }
  return null;
}

export interface HxTeamJudgeRowProps {
  message: AgentMessage;
  agentId: string | undefined;
  /** The team runs on this computer. */
  local: boolean;
  /** The call (default: main, through the account port); a test passes its own. */
  act?: (input: HxTeamCardActionInput) => Promise<HxTeamCardActionResult>;
}

const actInMain = (input: HxTeamCardActionInput) => accountPort().auth.hxTeamCardAction(input);

export function HxTeamJudgeRow(props: HxTeamJudgeRowProps) {
  const { t, sourceText } = useText();
  const [state, setState] = createStore<{ pending: boolean; outcome: { text: string; failed: boolean } | null }>({
    pending: false,
    outcome: null,
  });
  const act = async (action: HxTeamJudgeAction) => {
    const agentId = props.agentId;
    if (!agentId || state.pending) return;
    setState((draft) => {
      draft.pending = true;
      draft.outcome = null;
    });
    try {
      const result = await (props.act ?? actInMain)({ agentId, messageId: props.message.id, action });
      const outcome =
        result.status === "done"
          ? null
          : result.status === "refused"
            ? { text: t("conversation.hx.teamJudge.refused"), failed: true }
            : result.status === "ended"
              ? { text: t("conversation.hx.teamPriority.ended"), failed: true }
              : { text: t("conversation.hx.teamJudge.remote"), failed: true };
      setState((draft) => {
        draft.pending = false;
        draft.outcome = outcome;
      });
    } catch (error) {
      const reason = error instanceof Error ? sourceText(error.message) : "";
      setState((draft) => {
        draft.pending = false;
        draft.outcome = { text: t("conversation.hx.teamJudge.failed", { reason }), failed: true };
      });
    }
  };
  return (
    <Show when={hxTeamCardJudge(props.message)}>
      {(kind) => (
        <HxTeamJudgeBar
          kind={kind()}
          disabled={state.pending || !props.local || !props.agentId}
          message={state.outcome?.text ?? (props.local ? null : t("conversation.hx.teamJudge.remote"))}
          failed={state.outcome?.failed ?? false}
          onAction={(action) => void act(action)}
        />
      )}
    </Show>
  );
}
