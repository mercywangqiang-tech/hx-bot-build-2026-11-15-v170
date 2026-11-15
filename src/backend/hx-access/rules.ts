// HXBot：“始终允许”的规则和操作记录。规则对这台电脑上的所有智能体有效，直到客户在“设置 → 授权与记录”里删除；
// 操作记录只保存在这台电脑上，留最近的 2000 条。两者都存在应用的数据文件夹里，只有这个系统用户能读。
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { createHxBotLogger } from "@hxbot/logging";
import { ACCESS_ACTIONS, ACCESS_TARGET_TYPES, type AccessAction, type AccessGrant, type AccessTarget } from "./policy";

const logger = createHxBotLogger("hx-access-rules");

export interface HxAccessRule {
  id: string;
  targets: AccessTarget[];
  actions: AccessAction[];
  /** The agent that asked, its reason and purpose: shown in the settings. */
  agentName: string;
  reason: string;
  createdAt: number;
}

const HX_ACCESS_LOG_KINDS = [
  "read",
  "write",
  "delete",
  "command",
  "site",
  "screen",
  "search",
  "password",
  "payment",
  "vault",
  "request",
] as const;
type HxAccessLogKind = (typeof HX_ACCESS_LOG_KINDS)[number];
const HX_ACCESS_LOG_OUTCOMES = ["auto", "once", "always", "held", "allowed-once", "allowed-always", "refused"] as const;

/**
 * One line of the activity record. `outcome`: done without asking (auto), done with a confirmation
 * given once or a rule (once, always), stopped for a confirmation (held), or the user's answer to a
 * card (allowed-once, allowed-always, refused).
 */
export interface HxAccessLogEntry {
  at: number;
  agent: string;
  kind: HxAccessLogKind;
  detail: string;
  outcome: (typeof HX_ACCESS_LOG_OUTCOMES)[number];
}

const RULES_FILE = "hx-access-rules.json";
const LOG_FILE = "hx-access-log.jsonl";
const LOG_KEEP = 2000;
const LOG_TRIM_AT = 3000;
const MAX_RULES = 500;

function parseTarget(value: unknown): AccessTarget | null {
  if (!isDynamicRecord(value)) return null;
  const type = ACCESS_TARGET_TYPES.find((item) => item === value.type);
  return type && typeof value.value === "string" ? { type, value: value.value } : null;
}

function parseRule(value: unknown): HxAccessRule | null {
  if (!isDynamicRecord(value) || typeof value.id !== "string") return null;
  const targets = (Array.isArray(value.targets) ? value.targets : []).map(parseTarget);
  if (targets.length === 0 || targets.some((target) => target === null)) return null;
  const actions = ACCESS_ACTIONS.filter((action) => Array.isArray(value.actions) && value.actions.includes(action));
  return {
    id: value.id,
    targets: targets.filter((target): target is AccessTarget => target !== null),
    actions,
    agentName: typeof value.agentName === "string" ? value.agentName : "",
    reason: typeof value.reason === "string" ? value.reason : "",
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
  };
}

function parseEntry(line: string): HxAccessLogEntry | null {
  try {
    const value = JSON.parse(line);
    if (!isDynamicRecord(value)) return null;
    const { at, agent, kind, detail, outcome } = value;
    if (typeof at !== "number" || typeof agent !== "string" || typeof detail !== "string") return null;
    const knownKind = HX_ACCESS_LOG_KINDS.find((item) => item === kind);
    const knownOutcome = HX_ACCESS_LOG_OUTCOMES.find((item) => item === outcome);
    if (!knownKind || !knownOutcome) return null;
    return { at, agent, detail, kind: knownKind, outcome: knownOutcome };
  } catch {
    return null;
  }
}

export class HxAccessStore {
  #folder: string | null = null;
  #rules: HxAccessRule[] = [];
  #logLines = 0;
  readonly #listeners = new Set<() => void>();

  /** Opens the data folder. Before this the rules are empty and nothing is recorded. */
  open(folder: string): void {
    this.#folder = folder;
    try {
      mkdirSync(folder, { recursive: true });
      const file = join(folder, RULES_FILE);
      const parsed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
      const rules = isDynamicRecord(parsed) && Array.isArray(parsed.rules) ? parsed.rules : [];
      this.#rules = rules.map(parseRule).filter((rule): rule is HxAccessRule => rule !== null);
    } catch (error) {
      logger.warn("HXBot could not read the access rules; it starts with none.", { error: String(error) });
      this.#rules = [];
    }
    try {
      const log = join(folder, LOG_FILE);
      this.#logLines = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0;
    } catch {
      this.#logLines = 0;
    }
  }

  rules(): HxAccessRule[] {
    return [...this.#rules];
  }

  /** The rules as grants for every agent, for the decision. */
  ruleGrants(): AccessGrant[] {
    return this.#rules.map((rule) => ({
      id: rule.id,
      agentId: "*",
      threadId: "*",
      turnId: "*",
      targets: rule.targets,
      actions: rule.actions,
      reason: rule.reason,
      purpose: "",
      grantedAt: rule.createdAt,
      once: false,
    }));
  }

  addRule(input: Omit<HxAccessRule, "id" | "createdAt">): HxAccessRule {
    const rule: HxAccessRule = { ...input, id: `rule-${randomUUID()}`, createdAt: Date.now() };
    this.#rules = [...this.#rules, rule].slice(-MAX_RULES);
    this.#saveRules();
    return rule;
  }

  removeRule(id: string): boolean {
    const before = this.#rules.length;
    this.#rules = this.#rules.filter((rule) => rule.id !== id);
    if (this.#rules.length === before) return false;
    this.#saveRules();
    return true;
  }

  record(entry: Omit<HxAccessLogEntry, "at">): void {
    if (!this.#folder) return;
    const line = `${JSON.stringify({ at: Date.now(), ...entry, detail: entry.detail.slice(0, 500) })}\n`;
    try {
      appendFileSync(join(this.#folder, LOG_FILE), line, { mode: 0o600 });
      this.#logLines += 1;
      if (this.#logLines > LOG_TRIM_AT) this.#trimLog();
    } catch (error) {
      logger.warn("HXBot could not write the activity record.", { error: String(error) });
    }
    this.#changed();
  }

  /** The newest entries first. */
  log(limit = 500): HxAccessLogEntry[] {
    if (!this.#folder) return [];
    try {
      const file = join(this.#folder, LOG_FILE);
      if (!existsSync(file)) return [];
      const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
      return lines
        .slice(-limit)
        .map(parseEntry)
        .filter((entry): entry is HxAccessLogEntry => entry !== null)
        .reverse();
    } catch {
      return [];
    }
  }

  clearLog(): void {
    if (!this.#folder) return;
    try {
      writeFileSync(join(this.#folder, LOG_FILE), "", { mode: 0o600 });
      this.#logLines = 0;
    } catch (error) {
      logger.warn("HXBot could not clear the activity record.", { error: String(error) });
    }
    this.#changed();
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #trimLog(): void {
    if (!this.#folder) return;
    const file = join(this.#folder, LOG_FILE);
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-LOG_KEEP);
    writeFileSync(`${file}.tmp`, `${lines.join("\n")}\n`, { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    this.#logLines = lines.length;
  }

  #saveRules(): void {
    if (this.#folder) {
      const file = join(this.#folder, RULES_FILE);
      try {
        writeFileSync(`${file}.tmp`, `${JSON.stringify({ version: 1, rules: this.#rules }, null, 2)}\n`, {
          mode: 0o600,
        });
        renameSync(`${file}.tmp`, file);
      } catch (error) {
        logger.warn("HXBot could not save the access rules.", { error: String(error) });
      }
    }
    this.#changed();
  }

  #changed(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // A listener that fails must not stop the others.
      }
    }
  }
}

/** The rules and the activity record of this HXBot process. */
export const hxAccessStore = new HxAccessStore();
