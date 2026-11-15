// HXBot：“设置 → 授权与记录”在主进程和界面之间传的内容：始终允许的规则、操作记录（src/backend/hx-access/rules.ts）。
import { isDynamicRecord } from "./runtime-values";

export interface HxAccessRuleTargetView {
  type: string;
  value: string;
}

export interface HxAccessRuleView {
  id: string;
  targets: HxAccessRuleTargetView[];
  actions: string[];
  agentName: string;
  reason: string;
  createdAt: number;
}

export interface HxAccessLogView {
  at: number;
  agent: string;
  kind: string;
  detail: string;
  outcome: string;
}

function text(value: unknown, limit = 2000): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function time(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The rules as main sends them; anything that is not one is left out. */
export function decodeHxAccessRules(value: unknown): HxAccessRuleView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isDynamicRecord(item) || typeof item.id !== "string") return [];
    const targets = (Array.isArray(item.targets) ? item.targets : []).flatMap((target) =>
      isDynamicRecord(target) ? [{ type: text(target.type, 40), value: text(target.value, 400) }] : [],
    );
    const actions = (Array.isArray(item.actions) ? item.actions : []).filter(
      (action): action is string => typeof action === "string",
    );
    return [
      {
        id: item.id,
        targets,
        actions,
        agentName: text(item.agentName, 200),
        reason: text(item.reason, 400),
        createdAt: time(item.createdAt),
      },
    ];
  });
}

/** The activity record as main sends it, newest first. */
export function decodeHxAccessLog(value: unknown): HxAccessLogView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isDynamicRecord(item)
      ? [
          {
            at: time(item.at),
            agent: text(item.agent, 200),
            kind: text(item.kind, 40),
            detail: text(item.detail, 500),
            outcome: text(item.outcome, 40),
          },
        ]
      : [],
  );
}
