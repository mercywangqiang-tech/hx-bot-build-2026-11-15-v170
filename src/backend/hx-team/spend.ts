// HXBot 并发（一）：G5 花费提醒读的花费（v1.7.1，CONC-10）。
//
// What the members of a team spent since it started, from the usage records of the database, and how
// they pay: a plan (the account gives the used part of its period), pay as you go (every record has
// a price), a local model (nothing to pay), or an unknown price (counted in tokens that were not cached).
import type { AccountUsage } from "@hxbot/contracts/ipc";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import type { AgentProvider } from "../agent-client";
import { HX_USD_TO_YUAN, type HxBilling, type HxSpendReading } from "./guards";

export interface HxSpendSource {
  /** The usage records of these agents since `from` (ISO). */
  rows(agentIds: readonly string[], from: string): unknown[];
  agents(agentIds: readonly string[]): ReadonlyArray<{ id: string; provider: AgentProvider; model: string }>;
  /** The account reading of a provider and model, or null. */
  quota(provider: AgentProvider, model: string): Promise<AccountUsage | null>;
  agentIds: readonly string[];
  since: string;
}

/** A model that runs on this computer. */
function isLocal(provider: string, model: string): boolean {
  return /(^|[/:-])(ollama|lmstudio|lm-studio|llama\.cpp|local)([/:-]|$)/iu.test(`${provider}/${model}`);
}

/** The tokens that were not cached in one record: new input, cache writes and output. */
function uncachedTokens(json: unknown): number {
  if (typeof json !== "string") return 0;
  try {
    const value = JSON.parse(json);
    if (!isDynamicRecord(value)) return 0;
    const count = (key: string) => (typeof value[key] === "number" ? value[key] : 0);
    return count("uncachedInput") + count("cacheCreation") + count("output");
  } catch {
    return 0;
  }
}

/** The highest used percent of the windows of an account reading, or null. */
function usedPercent(usage: AccountUsage | null): number | null {
  let highest: number | null = null;
  for (const limit of usage?.limits ?? [])
    for (const window of [limit.primary, limit.secondary]) {
      const percent = window?.usedPercent;
      if (typeof percent === "number" && Number.isFinite(percent)) highest = Math.max(highest ?? 0, percent);
    }
  return highest;
}

export async function hxReadSpend(source: HxSpendSource): Promise<HxSpendReading> {
  if (source.agentIds.length === 0) return { billing: "local", yuan: 0, percent: null, tokens: 0 };
  const agents = source.agents(source.agentIds);
  let usd = 0;
  let priced = 0;
  let unpriced = 0;
  let tokens = 0;
  for (const row of source.rows(source.agentIds, source.since)) {
    if (!isDynamicRecord(row)) continue;
    tokens += uncachedTokens(row.tokens_json);
    if (typeof row.estimated_cost_usd === "number") {
      usd += row.estimated_cost_usd;
      priced += 1;
    } else unpriced += 1;
  }
  let percent: number | null = null;
  for (const agent of agents) {
    if (isLocal(agent.provider, agent.model)) continue;
    const reading = usedPercent(await source.quota(agent.provider, agent.model));
    if (reading !== null) percent = Math.max(percent ?? 0, reading);
  }
  let billing: HxBilling;
  if (agents.length > 0 && agents.every((agent) => isLocal(agent.provider, agent.model))) billing = "local";
  else if (percent !== null) billing = "plan";
  // Most records priced is pay as you go. A side question, a channel summary or the judge of the
  // automatic model choice on an agent with no rates is unpriced, and a few of them must not turn the
  // reminders of a team that pays per use into the reminders of an unknown price.
  else if (priced > 0 && unpriced <= priced) billing = "api";
  else billing = "unknown";
  return { billing, yuan: priced > 0 ? usd * HX_USD_TO_YUAN : null, percent, tokens };
}
