/**
 * HXBot (v1.7.5, CONC-13): the times that HXBot learned from the person's choices, kept on this computer
 * (src/backend/hx-flow/learned.ts). The settings page shows them and puts the defaults back.
 */

import { isDynamicRecord } from "./runtime-values";

export interface HxLearnedView {
  /** The G1 reminder of a team with no progress, by default. */
  progressDefaultMs: number;
  /** By kind of work (auto model's kinds), only those that changed. */
  progressByWork: Record<string, number>;
  /** The pause after the person stops before HXBot goes on with a foreground step. */
  yieldMs: number;
  limits: { progress: [number, number]; yield: [number, number] };
}

function isMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86_400_000;
}

function isRange(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && isMs(value[0]) && isMs(value[1]) && value[0] <= value[1];
}

export function decodeHxLearnedView(value: unknown): HxLearnedView {
  if (
    !isDynamicRecord(value) ||
    !isMs(value.progressDefaultMs) ||
    !isMs(value.yieldMs) ||
    !isDynamicRecord(value.progressByWork) ||
    !isDynamicRecord(value.limits) ||
    !isRange(value.limits.progress) ||
    !isRange(value.limits.yield)
  )
    throw new Error("Invalid learned times.");
  const byWork: Record<string, number> = {};
  for (const [work, ms] of Object.entries(value.progressByWork)) {
    if (work.length > 40 || !isMs(ms)) throw new Error("Invalid learned times.");
    byWork[work] = ms;
  }
  return {
    progressDefaultMs: value.progressDefaultMs,
    progressByWork: byWork,
    yieldMs: value.yieldMs,
    limits: { progress: value.limits.progress, yield: value.limits.yield },
  };
}
