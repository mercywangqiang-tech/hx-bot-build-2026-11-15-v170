// HXBot v1.7.5（RTN-02、MIG-03、CONC-14）：定时任务运行前等你确认的卡片：哪个定时任务、为什么问、这次会做什么、
// “运行这一次”“这次跳过”。数据和动作都从外面传进来；这里只画。
import { Button, CalendarClock } from "@hxbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";

export interface HxRoutineConfirmCardProps {
  /** In the reader's language. */
  title: string;
  note: string;
  actions: string;
  /** One line per routine: its name, its time and the start of its instruction. */
  lines: readonly string[];
  /** Set when the card is answered or expired, in the reader's language. */
  outcome: string | null;
  /** An answer is being carried out. */
  busy: boolean;
  /** The result or the error of the last answer on this screen. */
  message: string | null;
  failed: boolean;
  /** Absent where this screen cannot answer (another computer runs the agent), or once settled. */
  onAnswer?: ((run: boolean) => void) | undefined;
}

export function HxRoutineConfirmCard(props: HxRoutineConfirmCardProps) {
  const { t } = useText();
  return (
    <section class="hx-routine-confirm" data-settled={props.outcome ? "" : undefined}>
      <div class="hx-routine-confirm-head">
        <span class="hx-routine-confirm-glyph" aria-hidden="true">
          <CalendarClock />
        </span>
        <div class="hx-routine-confirm-text">
          <p class="hx-routine-confirm-title">{props.title}</p>
          <Show when={props.note}>
            <p class="hx-routine-confirm-note">{props.note}</p>
          </Show>
          <Show when={props.actions}>
            <p class="hx-routine-confirm-actions">{props.actions}</p>
          </Show>
        </div>
      </div>
      <ol class="hx-routine-confirm-lines">
        <For each={props.lines}>{(line) => <li class="hx-routine-confirm-line">{line}</li>}</For>
      </ol>
      <Show when={props.outcome}>{(outcome) => <p class="hx-routine-confirm-outcome">{outcome()}</p>}</Show>
      <Show when={props.message}>
        {(message) => (
          <p class="hx-routine-confirm-message" data-failed={props.failed ? "" : undefined} role="status">
            {message()}
          </p>
        )}
      </Show>
      <Show when={props.onAnswer && !props.outcome}>
        <div class="hx-routine-confirm-buttons">
          <Button type="button" size="sm" disabled={props.busy} onClick={() => props.onAnswer?.(true)}>
            {t("conversation.hx.routineConfirm.run")}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={props.busy} onClick={() => props.onAnswer?.(false)}>
            {t("conversation.hx.routineConfirm.skip")}
          </Button>
        </div>
      </Show>
    </section>
  );
}
