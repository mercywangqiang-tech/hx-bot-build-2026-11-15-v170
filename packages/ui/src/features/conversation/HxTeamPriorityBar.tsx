// HXBot v1.7.4（CONC-09）：团队进度卡下面的“这件更急 / 普通 / 不急”开关。值和动作都从外面传进来；这里只画。
import { RadioGroup } from "@hxbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";

export type HxTeamPriorityLevel = "urgent" | "normal" | "relaxed";

export interface HxTeamPriorityBarProps {
  /** The level the card shows now. */
  value: HxTeamPriorityLevel;
  /** A change runs now, or this screen cannot change it (another computer runs the team). */
  disabled: boolean;
  /** One line under the switch, in the reader's language, or null. */
  message: string | null;
  /** The line is an error. */
  failed: boolean;
  onChange: (level: HxTeamPriorityLevel) => void;
}

const LEVELS: readonly HxTeamPriorityLevel[] = ["urgent", "normal", "relaxed"];
const isLevel = (value: string): value is HxTeamPriorityLevel => LEVELS.some((level) => level === value);

export function HxTeamPriorityBar(props: HxTeamPriorityBarProps) {
  const { t } = useText();
  const label = (level: HxTeamPriorityLevel) =>
    level === "urgent"
      ? t("conversation.hx.teamPriority.urgent")
      : level === "relaxed"
        ? t("conversation.hx.teamPriority.relaxed")
        : t("conversation.hx.teamPriority.normal");
  return (
    <div class="hx-team-priority">
      <span class="hx-team-priority-label">{t("conversation.hx.teamPriority.label")}</span>
      <RadioGroup.Root
        class="hx-team-priority-choice"
        aria-label={t("conversation.hx.teamPriority.label")}
        value={props.value}
        disabled={props.disabled}
        onChange={(value) => {
          if (isLevel(value) && value !== props.value) props.onChange(value);
        }}
      >
        <For each={LEVELS}>
          {(level) => (
            <RadioGroup.Item value={level} class="hx-team-priority-option" data-level={level}>
              <RadioGroup.ItemInput />
              <RadioGroup.ItemLabel class="hx-team-priority-option-label">{label(level)}</RadioGroup.ItemLabel>
            </RadioGroup.Item>
          )}
        </For>
      </RadioGroup.Root>
      <Show when={props.message}>
        {(text) => (
          <span class="hx-team-priority-message" data-failed={props.failed ? "" : undefined} role="status">
            {text()}
          </span>
        )}
      </Show>
    </div>
  );
}
