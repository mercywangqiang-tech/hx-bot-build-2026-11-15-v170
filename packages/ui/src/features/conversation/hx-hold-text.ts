// HXBot v1.7.4（CONC-09）：等待的原因、排第几、大约多久，写成一句给人看的话。
import type { HxHoldDetail, HxHoldKind } from "@hxbot/contracts/ipc";
import type { AppTextKey } from "@hxbot/i18n";
import type { TextValue } from "../../text";

const REASONS = {
  machine: "conversation.hx.hold.machine",
  provider: "conversation.hx.hold.provider",
  screen: "conversation.hx.hold.screen",
  "user-active": "conversation.hx.hold.userActive",
  "team-queue": "conversation.hx.hold.teamQueue",
} as const satisfies Record<HxHoldKind, AppTextKey>;

/** "Queued (place 3, about 2 min). The model's provider …": the time is an estimate, so it says "about". */
export function hxHoldDetailText(detail: HxHoldDetail, t: TextValue["t"]): string {
  const reason = t(REASONS[detail.kind]);
  if (detail.position === null) return reason;
  if (detail.etaSeconds === null) return t("conversation.hx.hold.placeOnly", { position: detail.position, reason });
  const time =
    detail.etaSeconds < 60
      ? t("conversation.hx.hold.underMinute")
      : t("conversation.hx.hold.minutes", { count: Math.round(detail.etaSeconds / 60) });
  return t("conversation.hx.hold.place", { position: detail.position, time, reason });
}
