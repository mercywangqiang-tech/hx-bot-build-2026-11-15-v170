// HXBot v1.7.5：定时任务列表和编辑器里 HXBot 自己的几处说明：
// - 列表每行：结果未核实（醒目）、每次运行前先问你、时区未确认（RTN-04、MIG-03）；
// - 列表上方：升级到 v1.7.5 时改了哪些定时任务，逐条前后，“全部确认时区”“知道了”（MIG-03）；
// - 编辑器：暂停后读回“没有排队的触发”，正在跑的那次单独显示，可在对话里停止（RTN-06）；
// - 列表每行下面：等你确认的这次运行（补跑或每次确认），“运行这次”“跳过这次”（RTN-02、MIG-03；
//   频道的定时任务只在这里问，智能体的还在对话里有卡片）。
import type { HxAnswerRoutineConfirmResult } from "@hxbot/contracts/hx-routine-confirm";
import type { HxRoutineWaiting } from "@hxbot/contracts/ipc";
import { Button, Text } from "@hxbot/ui";
import { useText } from "@hxbot/ui/text";
import { createSignal, For, Show } from "solid-js";
import type { RoutineEditorRecord } from "./routines-port";

export function HxRoutineListBadges(props: { routine: RoutineEditorRecord }) {
  const { t } = useText();
  const hx = () => props.routine.hx;
  return (
    <Show when={hx()}>
      {(flags) => (
        <span class="hx-routine-badges">
          <Show when={flags().lastResult === "unverified"}>
            <span class="hx-routine-badge hx-routine-badge-warning">{t("routine.hx.history.result.unverified")}</span>
          </Show>
          <Show when={flags().confirmEach}>
            <span class="hx-routine-badge">{t("routine.hx.badge.confirmEach")}</span>
          </Show>
          <Show when={flags().zoneUnconfirmed}>
            <span class="hx-routine-badge hx-routine-badge-warning">{t("routine.hx.badge.zoneUnconfirmed")}</span>
          </Show>
        </span>
      )}
    </Show>
  );
}

const SEEN_KEY = (ownerId: string) => `hxbot:routine-upgrade-v175-seen:${ownerId}`;

function seen(ownerId: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY(ownerId)) === "1";
  } catch {
    return false;
  }
}

export function HxRoutineUpgradeNotice(props: {
  ownerId: string;
  routines: readonly RoutineEditorRecord[];
  /** Saves one routine with its own zone, which confirms it. */
  confirmZone: (routine: RoutineEditorRecord) => Promise<void>;
}) {
  const { t } = useText();
  const [hidden, setHidden] = createSignal(seen(props.ownerId));
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(0);
  const upgraded = () => props.routines.filter((routine) => routine.hx?.upgraded);
  const unconfirmed = () => upgraded().filter((routine) => routine.hx?.zoneUnconfirmed);
  const dismiss = () => {
    try {
      window.localStorage.setItem(SEEN_KEY(props.ownerId), "1");
    } catch {
      // The notice comes back on the next open; nothing else changes.
    }
    setHidden(true);
  };
  const confirmAll = async () => {
    setBusy(true);
    let failures = 0;
    for (const routine of unconfirmed()) {
      try {
        await props.confirmZone(routine);
      } catch {
        failures += 1;
      }
    }
    setFailed(failures);
    setBusy(false);
  };
  return (
    <Show when={!hidden() && upgraded().length > 0}>
      <section class="hx-routine-upgrade" aria-labelledby="hx-routine-upgrade-title">
        <p id="hx-routine-upgrade-title" class="hx-routine-upgrade-title">
          {t("routine.hx.upgrade.title", { count: upgraded().length })}
        </p>
        <ul class="hx-routine-upgrade-list">
          <For each={upgraded()}>
            {(routine) => (
              <li>
                <strong>{routine.name}</strong>
                <For each={routine.hx?.upgraded?.changes ?? []}>
                  {(change) => (
                    <span class="hx-routine-upgrade-change">
                      {change === "zone-unconfirmed"
                        ? routine.hx?.zoneUnconfirmed
                          ? t("routine.hx.upgrade.zone", { zone: routine.timezone })
                          : t("routine.hx.upgrade.zoneDone", { zone: routine.timezone })
                        : t("routine.hx.upgrade.confirmEach")}
                    </span>
                  )}
                </For>
              </li>
            )}
          </For>
        </ul>
        <Show when={failed() > 0}>
          <Text variant="caption" tone="danger" role="alert">
            {t("routine.hx.upgrade.failed", { count: failed() })}
          </Text>
        </Show>
        <div class="hx-routine-upgrade-buttons">
          <Show when={unconfirmed().length > 0}>
            <Button type="button" size="sm" loading={busy()} onClick={() => void confirmAll()}>
              {t("routine.hx.upgrade.confirmAll")}
            </Button>
          </Show>
          <Button type="button" size="sm" variant="ghost" onClick={dismiss}>
            {t("routine.hx.upgrade.dismiss")}
          </Button>
        </div>
      </section>
    </Show>
  );
}

export function HxRoutineQueueNote(props: {
  routine: RoutineEditorRecord | null;
  onOpenRun?: ((messageId: string) => void) | undefined;
}) {
  const { t } = useText();
  const queue = () => (props.routine && !props.routine.active ? props.routine.hx?.queue : undefined);
  return (
    <Show when={queue()}>
      {(state) => (
        <div class="hx-routine-queue" role="status">
          <span>
            {state().queued === 0 ? t("routine.hx.queue.none") : t("routine.hx.queue.some", { count: state().queued })}
          </span>
          <Show when={state().running}>
            {(running) => (
              <span class="hx-routine-queue-running">
                {t("routine.hx.queue.running", {
                  status:
                    running().status === "needs-attention"
                      ? t("routine.runStatus.needsAttention")
                      : running().status === "queued"
                        ? t("routine.runStatus.queued")
                        : t("routine.runStatus.running"),
                })}
                <Show when={props.onOpenRun && running().deliveryId}>
                  {(deliveryId) => (
                    <Button type="button" size="sm" variant="ghost" onClick={() => props.onOpenRun?.(deliveryId())}>
                      {t("routine.hx.queue.open")}
                    </Button>
                  )}
                </Show>
              </span>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}

/** `YYYY-MM-DD HH:mm` in the routine's zone, as the confirmation card writes it. */
function localMinute(at: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(at));
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
  } catch {
    return at.slice(0, 16).replace("T", " ");
  }
}

export function HxRoutineWaitingRows(props: {
  routine: RoutineEditorRecord;
  answer: ((cardId: string, run: boolean) => Promise<HxAnswerRoutineConfirmResult>) | undefined;
  /** Reloads the list after an answer. */
  answered: () => void;
}) {
  const text = useText();
  const { t } = text;
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const waiting = () => (props.answer ? (props.routine.hx?.waiting ?? []) : []);
  const reasonText = (entry: HxRoutineWaiting) => {
    if (entry.reason === "each") return t("routine.hx.waiting.each");
    const missed = entry.missed;
    if (!missed) return t("routine.hx.waiting.late");
    return t("routine.hx.waiting.catchUp", {
      count: missed.truncated ? `${missed.total}+` : String(missed.total),
      from: localMinute(missed.from, props.routine.timezone),
      until: localMinute(missed.until, props.routine.timezone),
    });
  };
  const respond = async (entry: HxRoutineWaiting, run: boolean) => {
    const answer = props.answer;
    if (!answer || busy()) return;
    setBusy(entry.cardId);
    setError(null);
    try {
      await answer(entry.cardId, run);
    } catch (caught) {
      setError(caught instanceof Error ? text.sourceText(caught.message) : String(caught));
    } finally {
      setBusy(null);
      props.answered();
    }
  };
  return (
    <Show when={waiting().length > 0}>
      <div class="hx-routine-waiting" role="status">
        <For each={waiting()}>
          {(entry) => (
            <div class="hx-routine-waiting-row">
              <span>
                {t("routine.hx.waiting.title", { time: localMinute(entry.scheduledFor, props.routine.timezone) })}
                {" · "}
                {reasonText(entry)}
              </span>
              <span class="hx-routine-waiting-actions">
                <Button type="button" size="sm" disabled={busy() !== null} onClick={() => void respond(entry, true)}>
                  {t("conversation.hx.routineConfirm.run")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy() !== null}
                  onClick={() => void respond(entry, false)}
                >
                  {t("conversation.hx.routineConfirm.skip")}
                </Button>
              </span>
            </div>
          )}
        </For>
        <Show when={error()}>
          {(reason) => (
            <Text variant="caption" tone="danger" role="alert">
              {t("conversation.hx.routineConfirm.failed", { reason: reason() })}
            </Text>
          )}
        </Show>
      </div>
    </Show>
  );
}
