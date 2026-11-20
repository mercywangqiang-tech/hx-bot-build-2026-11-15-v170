import type { RoutineSchedule } from "@hxbot/contracts/ipc";
import { type HxRoutineOccurrence, hxRoutineUpcoming } from "@hxbot/team-client/routine-schedule";
import { For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";

/**
 * HXBot (v1.7.5, RTN-01): the next three runs of a routine, each in the routine's zone and in UTC,
 * with what a daylight-saving change does to it. The routine editor shows it under the schedule, and
 * the chat card of a routine that an agent made shows it too.
 */
export interface HxRoutineUpcomingProps {
  schedule: RoutineSchedule;
  /** Empty until the person chooses a zone. */
  timezone: string;
  active: boolean;
  /** For stories and tests; the default is the time of rendering. */
  now?: Date | undefined;
  density?: "card" | "editor" | undefined;
}

type Upcoming =
  | { kind: "runs"; runs: HxRoutineOccurrence[] }
  | { kind: "paused" }
  | { kind: "none" }
  | { kind: "zone" };

function formatAt(at: string, locale: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(at));
  } catch {
    return at;
  }
}

/** "UTC+08:00", "UTC−07:00", "UTC+05:45". */
export function hxOffsetText(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "−" : "+";
  const total = Math.abs(offsetMinutes);
  return `UTC${sign}${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function hxUpcomingOf(props: HxRoutineUpcomingProps): Upcoming {
  if (!props.timezone) return { kind: "zone" };
  if (!props.active) return { kind: "paused" };
  try {
    const runs = hxRoutineUpcoming(props.schedule, props.timezone, props.now ?? new Date(), 3);
    return runs.length > 0 ? { kind: "runs", runs } : { kind: "none" };
  } catch {
    // A schedule the editor has not finished, or a zone this runtime does not know.
    return { kind: "zone" };
  }
}

export function HxRoutineUpcoming(props: HxRoutineUpcomingProps) {
  const { t, locale } = useText();
  const upcoming = () => hxUpcomingOf(props);
  const runs = () => {
    const value = upcoming();
    return value.kind === "runs" ? value.runs : undefined;
  };
  return (
    <section
      class={`hx-routine-upcoming hx-routine-upcoming-${props.density ?? "editor"}`}
      aria-label={t("routine.hx.upcoming.title")}
    >
      <span class="hx-routine-upcoming-title">{t("routine.hx.upcoming.title")}</span>
      <Switch>
        <Match when={upcoming().kind === "zone"}>
          <span class="hx-routine-upcoming-empty">{t("routine.hx.upcoming.chooseZone")}</span>
        </Match>
        <Match when={upcoming().kind === "paused"}>
          <span class="hx-routine-upcoming-empty">{t("routine.hx.upcoming.paused")}</span>
        </Match>
        <Match when={upcoming().kind === "none"}>
          <span class="hx-routine-upcoming-empty">{t("routine.hx.upcoming.none")}</span>
        </Match>
        <Match when={runs()}>
          {(list) => (
            <ol class="hx-routine-upcoming-list">
              <For each={list()}>
                {(run) => (
                  <li class="hx-routine-upcoming-run">
                    <span class="hx-routine-upcoming-local">
                      {formatAt(run.at, locale(), props.timezone)}
                      <span class="hx-routine-upcoming-offset"> {hxOffsetText(run.offsetMinutes)}</span>
                    </span>
                    <span class="hx-routine-upcoming-utc">
                      {t("routine.hx.upcoming.utc", { time: formatAt(run.at, locale(), "UTC") })}
                    </span>
                    <Show when={run.shiftedFrom}>
                      {(from) => (
                        <span class="hx-routine-upcoming-note">
                          {t("routine.hx.upcoming.gap", { time: from(), actual: run.local.slice(11) })}
                        </span>
                      )}
                    </Show>
                    <Show when={run.repeated}>
                      <span class="hx-routine-upcoming-note">
                        {t("routine.hx.upcoming.repeated", {
                          time: run.local.slice(11),
                          offset: hxOffsetText(run.offsetMinutes),
                        })}
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ol>
          )}
        </Match>
      </Switch>
    </section>
  );
}
