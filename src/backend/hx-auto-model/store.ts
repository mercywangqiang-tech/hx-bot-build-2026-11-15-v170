// HXBot 自动选择模型：每个智能体的设置、最近的选择记录、OpenCode 免费额度的状态。
//
// Kept in `hx-auto-model/` inside HXBot's data folder, on this computer only: `settings.json` (the
// settings of each agent), `decisions.jsonl` (one decision per line, the last 2000 and at most 30
// days) and `free-quota.json`. A file that cannot be read starts empty; a write that fails is logged
// and the settings stay as they are in memory.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  HX_AUTO_DEFAULTS,
  type HxAutoModelSettings,
  type HxRoutingDecision,
  parseHxAutoModelSettings,
  parseHxRoutingDecision,
} from "@hxbot/contracts/hx-auto-model";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { createHxBotLogger } from "@hxbot/logging";

const logger = createHxBotLogger("hx-auto-model");

const SETTINGS_FILE = "settings.json";
const DECISIONS_FILE = "decisions.jsonl";
const QUOTA_FILE = "free-quota.json";
/** The record keeps this many decisions, and none older than `KEEP_MS`. */
const KEEP_DECISIONS = 2_000;
const TRIM_AT = 2_400;
const KEEP_MS = 30 * 24 * 60 * 60_000;

function day(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export class HxAutoModelStore {
  #folder: string | null = null;
  #settings = new Map<string, HxAutoModelSettings>();
  #decisions: HxRoutingDecision[] = [];
  #blockedUntil: number | null = null;
  #counts = new Map<string, number>();
  readonly #listeners = new Set<(agentId: string) => void>();

  /** Opens the folder. Before this every agent has the defaults and nothing is kept. */
  open(folder: string, now = Date.now()): void {
    this.#folder = folder;
    try {
      mkdirSync(folder, { recursive: true });
    } catch (error) {
      logger.warn("HXBot could not make the folder of the auto model settings.", { error: String(error) });
    }
    this.#settings = new Map();
    const settings = this.#readJson(SETTINGS_FILE);
    if (isDynamicRecord(settings) && isDynamicRecord(settings.agents))
      for (const [agentId, value] of Object.entries(settings.agents)) {
        const parsed = parseHxAutoModelSettings(value);
        if (parsed) this.#settings.set(agentId, parsed);
      }
    this.#decisions = [];
    try {
      const file = join(folder, DECISIONS_FILE);
      if (existsSync(file))
        for (const line of readFileSync(file, "utf8").split("\n")) {
          if (!line) continue;
          try {
            const decision = parseHxRoutingDecision(JSON.parse(line));
            if (decision && now - decision.at <= KEEP_MS) this.#decisions.push(decision);
          } catch {
            // A damaged line is skipped; the next trim drops it.
          }
        }
      this.#decisions = this.#decisions.slice(-KEEP_DECISIONS);
    } catch (error) {
      logger.warn("HXBot could not read the auto model record; it starts empty.", { error: String(error) });
    }
    const quota = this.#readJson(QUOTA_FILE);
    this.#blockedUntil =
      isDynamicRecord(quota) && typeof quota.blockedUntil === "number" && quota.blockedUntil > now
        ? quota.blockedUntil
        : null;
    this.#counts = new Map();
    if (isDynamicRecord(quota) && isDynamicRecord(quota.counts))
      for (const [date, count] of Object.entries(quota.counts))
        if (typeof count === "number" && date === day(now)) this.#counts.set(date, count);
  }

  settings(agentId: string): HxAutoModelSettings {
    return this.#settings.get(agentId) ?? HX_AUTO_DEFAULTS;
  }

  enabled(agentId: string): boolean {
    return this.settings(agentId).enabled;
  }

  setSettings(agentId: string, settings: HxAutoModelSettings): void {
    this.#settings.set(agentId, settings);
    this.#saveSettings();
    this.#changed(agentId);
  }

  /** Forgets an agent that was deleted. */
  forget(agentId: string): void {
    if (!this.#settings.delete(agentId)) return;
    this.#saveSettings();
  }

  record(decision: HxRoutingDecision): void {
    this.#decisions.push(decision);
    if (this.#folder) {
      try {
        appendFileSync(join(this.#folder, DECISIONS_FILE), `${JSON.stringify(decision)}\n`, { mode: 0o600 });
      } catch (error) {
        logger.warn("HXBot could not write the auto model record.", { error: String(error) });
      }
    }
    if (this.#decisions.length > TRIM_AT) this.#trim(decision.at);
    this.#changed(decision.agentId);
  }

  /** The latest decisions of an agent, newest first. */
  decisions(agentId: string, limit = 20): HxRoutingDecision[] {
    const own: HxRoutingDecision[] = [];
    for (let index = this.#decisions.length - 1; index >= 0 && own.length < limit; index--) {
      const decision = this.#decisions[index];
      if (decision?.agentId === agentId) own.push(decision);
    }
    return own;
  }

  /** The last decision of one chat of an agent: its own chat (`taskId` null) or a task. */
  last(agentId: string, taskId: string | null): HxRoutingDecision | null {
    for (let index = this.#decisions.length - 1; index >= 0; index--) {
      const decision = this.#decisions[index];
      if (decision?.agentId === agentId && decision.taskId === taskId) return decision;
    }
    return null;
  }

  /** Whether the work that starts with this delivery has its decision already. */
  decided(deliveryId: string): boolean {
    for (let index = this.#decisions.length - 1; index >= Math.max(0, this.#decisions.length - 200); index--)
      if (this.#decisions[index]?.deliveryId === deliveryId) return true;
    return false;
  }

  /** OpenCode's free models are blocked until this time (epoch ms), or null. */
  freeBlockedUntil(now = Date.now()): number | null {
    return this.#blockedUntil !== null && this.#blockedUntil > now ? this.#blockedUntil : null;
  }

  blockFree(until: number): void {
    this.#blockedUntil = until;
    this.#saveQuota();
  }

  /** Counts one request to a free OpenCode model today. This computer's own count, not OpenCode's. */
  countFree(now = Date.now()): void {
    const today = day(now);
    for (const date of this.#counts.keys()) if (date !== today) this.#counts.delete(date);
    this.#counts.set(today, (this.#counts.get(today) ?? 0) + 1);
    this.#saveQuota();
  }

  freeUsedToday(now = Date.now()): number {
    return this.#counts.get(day(now)) ?? 0;
  }

  onChange(listener: (agentId: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #readJson(name: string): unknown {
    if (!this.#folder) return null;
    try {
      const file = join(this.#folder, name);
      return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    } catch (error) {
      logger.warn("HXBot could not read an auto model file; it starts empty.", { file: name, error: String(error) });
      return null;
    }
  }

  #writeJson(name: string, value: unknown): void {
    if (!this.#folder) return;
    const file = join(this.#folder, name);
    try {
      writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    } catch (error) {
      logger.warn("HXBot could not save an auto model file.", { file: name, error: String(error) });
    }
  }

  #saveSettings(): void {
    this.#writeJson(SETTINGS_FILE, { version: 1, agents: Object.fromEntries(this.#settings) });
  }

  #saveQuota(): void {
    this.#writeJson(QUOTA_FILE, {
      version: 1,
      blockedUntil: this.#blockedUntil,
      counts: Object.fromEntries(this.#counts),
    });
  }

  #trim(now: number): void {
    this.#decisions = this.#decisions.filter((decision) => now - decision.at <= KEEP_MS).slice(-KEEP_DECISIONS);
    if (!this.#folder) return;
    const file = join(this.#folder, DECISIONS_FILE);
    try {
      writeFileSync(`${file}.tmp`, this.#decisions.map((decision) => `${JSON.stringify(decision)}\n`).join(""), {
        mode: 0o600,
      });
      renameSync(`${file}.tmp`, file);
    } catch (error) {
      logger.warn("HXBot could not trim the auto model record.", { error: String(error) });
    }
  }

  #changed(agentId: string): void {
    for (const listener of this.#listeners) {
      try {
        listener(agentId);
      } catch {
        // A listener that fails must not stop the others.
      }
    }
  }
}

export const hxAutoModelStore = new HxAutoModelStore();
