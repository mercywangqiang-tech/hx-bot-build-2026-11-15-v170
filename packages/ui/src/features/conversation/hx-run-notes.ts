// HXBot v1.7.5（RTN-02、RTN-03、RTN-04）：运行历史里 HXBot 自己的说明：为什么跳过、错过几次和怎么处理、
// 结果（成功、无更新、结果未核实、失败），以及按这些筛选。主机发来的 hx 字段只有这台电脑的主机有；没有时照旧显示。
import { ROUTINE_MISSED_COUNT_LIMIT, type RoutineRunFields } from "@hxbot/contracts/ipc";
import type { AppTextKey } from "@hxbot/i18n";
import type { TextValue } from "../../text";

const SKIP_LABEL = {
  "previous-running": "routine.hx.history.skip.previousRunning",
  "plan-limit": "routine.hx.history.skip.planLimit",
  declined: "routine.hx.history.skip.declined",
  expired: "routine.hx.history.skip.expired",
  cancelled: "routine.hx.history.skip.cancelled",
  unasked: "routine.hx.history.skip.unasked",
} as const satisfies Record<NonNullable<NonNullable<RoutineRunFields["hx"]>["skip"]>, AppTextKey>;

/** The note of a skipped or missed record, or null when the host sent no HXBot detail. */
export function hxSkippedNote(run: RoutineRunFields | undefined, text: Pick<TextValue, "t">): string | null {
  const hx = run?.hx;
  if (hx?.skip) return text.t(SKIP_LABEL[hx.skip]);
  const missed = hx?.missed;
  if (!missed) return null;
  const count = missed.total > ROUTINE_MISSED_COUNT_LIMIT ? `${ROUTINE_MISSED_COUNT_LIMIT}+` : String(missed.total);
  if (missed.while === "asleep") {
    return missed.handled === "skip"
      ? text.t("routine.hx.history.missed.asleepSkip", { count })
      : text.t("routine.hx.history.missed.asleepRunOnce", { count });
  }
  return missed.handled === "skip"
    ? text.t("routine.hx.history.missed.offlineSkip", { count })
    : text.t("routine.hx.history.missed.offlineRunOnce", { count });
}

/** The result note of a run, or null: a success shows only its icon. */
export function hxRunNote(run: RoutineRunFields, text: Pick<TextValue, "t">): string | null {
  const hx = run.hx;
  if (!hx) return null;
  const notes: string[] = [];
  if (hx.result === "unverified") notes.push(text.t("routine.hx.history.result.unverified"));
  if (hx.result === "no-update") notes.push(text.t("routine.hx.history.result.noUpdate"));
  if (hx.catchUp && hx.catchUp.total > 1) notes.push(text.t("routine.hx.history.catchUp", { count: hx.catchUp.total }));
  return notes.length > 0 ? notes.join(" · ") : null;
}

export const HX_RUN_FILTERS = ["all", "succeeded", "no-update", "unverified", "failed", "skipped"] as const;
export type HxRunFilter = (typeof HX_RUN_FILTERS)[number];

export const HX_RUN_FILTER_LABEL = {
  all: "routine.hx.history.filter.all",
  succeeded: "routine.hx.history.filter.succeeded",
  "no-update": "routine.hx.history.filter.noUpdate",
  unverified: "routine.hx.history.filter.unverified",
  failed: "routine.hx.history.filter.failed",
  skipped: "routine.hx.history.filter.skipped",
} as const satisfies Record<HxRunFilter, AppTextKey>;

/** Whether a run or a record shows under a filter. A run HXBot has not judged reads by its status. */
export function hxRunMatches(run: RoutineRunFields, filter: HxRunFilter): boolean {
  if (filter === "all") return true;
  if (filter === "skipped") return run.missed !== undefined;
  if (run.missed !== undefined) return false;
  const result =
    run.hx?.result ?? (run.status === "succeeded" ? "succeeded" : run.status === "failed" ? "failed" : null);
  return result === filter;
}
