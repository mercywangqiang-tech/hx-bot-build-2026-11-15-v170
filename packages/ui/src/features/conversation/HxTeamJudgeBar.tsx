// HXBot v1.7.5（CONC-16）：团队进度卡下面裁判自动模式的按钮。卡片上有“连续几次一致”的那一行时显示
// “以后这类情况按裁判的办”；裁判让团队继续了时显示“收尾”“停”和“以后还是每次问我”。动作从外面传进来；这里只画。
import { Button } from "@hxbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";

export type HxTeamJudgeAction = "judge-auto" | "judge-ask" | "finish" | "stop";

export interface HxTeamJudgeBarProps {
  /** What the card offers: the automatic mode, or the buttons of a pass. */
  kind: "offer" | "went";
  /** A click runs now, or this screen cannot act (another computer runs the team). */
  disabled: boolean;
  /** One line under the buttons, in the reader's language, or null. */
  message: string | null;
  failed: boolean;
  onAction: (action: HxTeamJudgeAction) => void;
}

export function HxTeamJudgeBar(props: HxTeamJudgeBarProps) {
  const { t } = useText();
  return (
    <div class="hx-team-judge">
      <Show
        when={props.kind === "offer"}
        fallback={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={props.disabled}
              onClick={() => props.onAction("finish")}
            >
              {t("conversation.hx.teamJudge.finish")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={props.disabled}
              onClick={() => props.onAction("stop")}
            >
              {t("conversation.hx.teamJudge.stop")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={props.disabled}
              onClick={() => props.onAction("judge-ask")}
            >
              {t("conversation.hx.teamJudge.askAgain")}
            </Button>
          </>
        }
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.disabled}
          onClick={() => props.onAction("judge-auto")}
        >
          {t("conversation.hx.teamJudge.auto")}
        </Button>
        <span class="hx-team-judge-hint">{t("conversation.hx.teamJudge.autoHint")}</span>
      </Show>
      <Show when={props.message}>
        {(text) => (
          <span class="hx-team-judge-message" data-failed={props.failed ? "" : undefined} role="status">
            {text()}
          </span>
        )}
      </Show>
    </div>
  );
}
