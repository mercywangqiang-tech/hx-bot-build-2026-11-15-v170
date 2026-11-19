// HXBot v1.7.4（CONC-09）：团队进度卡下面的“这件更急 / 普通 / 不急”开关。现在是哪一档，从卡片上那一行读出来
// （卡片每次改档都会马上重画）；点了交给主进程，只有运行这个团队的电脑能改，别的电脑只看。
import {
  HX_PROGRESS_ITEM_TYPE,
  type HxSetTeamPriorityInput,
  type HxSetTeamPriorityResult,
  hxParseProgressText,
  hxTeamCardTeamId,
} from "@hxbot/contracts/hx-progress";
import { matchingSourceKeys } from "@hxbot/i18n";
import type { AgentMessage } from "@hxbot/ui/data";
import { HxTeamPriorityBar, type HxTeamPriorityLevel } from "@hxbot/ui/features/conversation/HxTeamPriorityBar";
import { useText } from "@hxbot/ui/text";
import { createStore, Show } from "solid-js";
import { accountPort } from "../account/account-port";

/** The level that a team's card shows, from its lines; null when the message is not a team's card. */
export function hxTeamCardPriority(message: AgentMessage): HxTeamPriorityLevel | null {
  if (message.itemType !== HX_PROGRESS_ITEM_TYPE || hxTeamCardTeamId(message.id) === null) return null;
  const card = hxParseProgressText(message.body);
  if (!card) return null;
  for (const step of card.steps) {
    const keys = matchingSourceKeys(step.text);
    if (keys.includes("status.agent.hxTeam.card.urgent")) return "urgent";
    if (keys.includes("status.agent.hxTeam.card.relaxed")) return "relaxed";
  }
  return "normal";
}

export interface HxTeamPriorityRowProps {
  message: AgentMessage;
  agentId: string | undefined;
  /** The team runs on this computer. */
  local: boolean;
  /** The call that changes it (default: main, through the account port); a test passes its own. */
  change?: (input: HxSetTeamPriorityInput) => Promise<HxSetTeamPriorityResult>;
}

const changeInMain = (input: HxSetTeamPriorityInput) => accountPort().auth.hxSetTeamPriority(input);

export function HxTeamPriorityRow(props: HxTeamPriorityRowProps) {
  const { t, sourceText } = useText();
  const shown = () => hxTeamCardPriority(props.message);
  // While a change runs, the switch shows the chosen level; the card's own line takes over after it.
  const [state, setState] = createStore<{
    pending: HxTeamPriorityLevel | null;
    outcome: { text: string; failed: boolean } | null;
  }>({ pending: null, outcome: null });
  const said = (result: HxSetTeamPriorityResult) => {
    if (result.status === "changed" || result.status === "unchanged") return null;
    if (result.status === "ended") return { text: t("conversation.hx.teamPriority.ended"), failed: true };
    return { text: t("conversation.hx.teamPriority.remote"), failed: true };
  };
  const change = async (priority: HxTeamPriorityLevel) => {
    const agentId = props.agentId;
    if (!agentId || state.pending !== null) return;
    setState((draft) => {
      draft.pending = priority;
      draft.outcome = null;
    });
    try {
      const result = await (props.change ?? changeInMain)({ agentId, messageId: props.message.id, priority });
      const outcome = said(result);
      setState((draft) => {
        draft.pending = null;
        draft.outcome = outcome;
      });
    } catch (error) {
      const reason = error instanceof Error ? sourceText(error.message) : "";
      const outcome = { text: t("conversation.hx.teamPriority.failed", { reason }), failed: true };
      setState((draft) => {
        draft.pending = null;
        draft.outcome = outcome;
      });
    }
  };
  // A running team's card has a line that is not done (its members' lines are never done); a finished
  // card has every line done, and a stopped one is marked stopped. Neither has a switch.
  const running = () =>
    props.message.status !== "Stopped" &&
    hxParseProgressText(props.message.body)?.steps.some((step) => step.state !== "done") === true;
  return (
    <Show when={running() ? shown() : null}>
      {(level) => (
        <HxTeamPriorityBar
          value={state.pending ?? level()}
          disabled={state.pending !== null || !props.local || !props.agentId}
          message={state.outcome?.text ?? (props.local ? null : t("conversation.hx.teamPriority.remote"))}
          failed={state.outcome?.failed ?? false}
          onChange={(next) => void change(next)}
        />
      )}
    </Show>
  );
}
