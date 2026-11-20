/** HXBot (v1.7.5, CONC-16): the buttons of a team's card beside its priority (hx-progress.ts). */

import { hxTeamCardTeamId } from "./hx-progress";
import { isDynamicRecord } from "./runtime-values";

/**
 * HXBot (v1.7.5, CONC-16): a button on a team's card: the judge's automatic mode for the cause of the
 * pause ("judge-auto", only when the card offers it), ask each time again ("judge-ask"), wrap up, stop.
 */
export const HX_TEAM_CARD_ACTIONS = ["judge-auto", "judge-ask", "finish", "stop"] as const;
export type HxTeamCardAction = (typeof HX_TEAM_CARD_ACTIONS)[number];

export interface HxTeamCardActionInput {
  agentId: string;
  messageId: string;
  action: HxTeamCardAction;
}

export interface HxTeamCardActionResult {
  /** `refused`: the card does not offer it now (the conditions changed, or the team answered already). */
  status: "done" | "missing" | "ended" | "refused";
}

const isCardAction = (value: unknown): value is HxTeamCardAction =>
  typeof value === "string" && HX_TEAM_CARD_ACTIONS.some((action) => action === value);

export function decodeHxTeamCardActionInput(value: unknown): HxTeamCardActionInput {
  if (
    !isDynamicRecord(value) ||
    typeof value.agentId !== "string" ||
    value.agentId.length === 0 ||
    value.agentId.length > 200 ||
    typeof value.messageId !== "string" ||
    hxTeamCardTeamId(value.messageId) === null ||
    !isCardAction(value.action)
  )
    throw new Error("A team card and an action are required.");
  return { agentId: value.agentId, messageId: value.messageId, action: value.action };
}

export function decodeHxTeamCardActionResult(value: unknown): HxTeamCardActionResult {
  if (
    isDynamicRecord(value) &&
    (value.status === "done" || value.status === "missing" || value.status === "ended" || value.status === "refused")
  )
    return { status: value.status };
  throw new Error("The answer of the team card is not valid.");
}
