// HXBot: OpenCode's integration list in the shape the screen shows (hx-opencode).
//
// OpenCode 2's local server answers `GET /api/integration` with every service it can connect, each
// with its ways in and its present connections. These functions read that answer. They trust
// nothing in it: a field of an unknown shape is left out, and a service with no way in that HXBot
// can run is still listed, so that a connection made in a terminal shows here too.

import type {
  HxOcAnswer,
  HxOcAttempt,
  HxOcAttemptStatus,
  HxOcConnection,
  HxOcField,
  HxOcIntegration,
  HxOcMethod,
  HxOcOption,
  HxOcWhen,
} from "@hxbot/contracts/hx-opencode";
import { type DynamicRecord, isDynamicRecord } from "@hxbot/contracts/runtime-values";

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** OpenCode wraps each answer in `{ location, data }`: the data, when it is a list. */
function listOf(answer: unknown): readonly unknown[] {
  const data = isDynamicRecord(answer) ? answer.data : null;
  return Array.isArray(data) ? data : [];
}

/** The data of an answer, when it is one record. */
function recordOf(answer: unknown): DynamicRecord | null {
  const data = isDynamicRecord(answer) && "data" in answer ? answer.data : answer;
  return isDynamicRecord(data) ? data : null;
}

/**
 * The services HXBot lists first, by OpenCode id: the ones most people come for. The rest follow by
 * name. A connected service comes before all of them.
 */
const FIRST: readonly string[] = [
  "opencode",
  "opencode-go",
  "openai",
  "anthropic",
  "google",
  "github-copilot",
  "deepseek",
  "moonshotai",
  "moonshotai-cn",
  "zhipuai",
  "zai",
  "alibaba",
  "alibaba-cn",
  "minimax",
  "minimax-cn",
  "xai",
  "openrouter",
  "mistral",
  "siliconflow",
  "siliconflow-cn",
  "volcengine",
  "groq",
];

function whenOf(value: unknown): HxOcWhen[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isDynamicRecord(entry) || typeof entry.key !== "string") return [];
    if (entry.op !== "eq" && entry.op !== "neq") return [];
    const target = entry.value;
    if (typeof target !== "string" && typeof target !== "boolean" && typeof target !== "number") return [];
    return [{ key: entry.key, equal: entry.op === "eq", value: String(target) }];
  });
}

function optionsOf(value: unknown): HxOcOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) =>
    isDynamicRecord(option) && typeof option.value === "string"
      ? [{ value: option.value, label: text(option.label) ?? option.value }]
      : [],
  );
}

/** One question of a form. A hidden one is not asked: OpenCode uses its default. */
function fieldOf(value: unknown): HxOcField | null {
  if (!isDynamicRecord(value) || typeof value.key !== "string" || value.hidden === true) return null;
  const base = {
    key: value.key,
    title: text(value.title) ?? value.key,
    description: text(value.description),
    required: value.required === true,
    placeholder: text(value.placeholder),
    when: whenOf(value.when),
  };
  switch (value.type) {
    case "external":
      return text(value.url) ? { ...base, kind: "link", initial: null, options: [], url: text(value.url) } : null;
    case "boolean":
      return {
        ...base,
        kind: "boolean",
        initial: typeof value.default === "boolean" ? value.default : null,
        options: [],
        url: null,
      };
    case "string":
    case "number":
    case "integer": {
      const options = optionsOf(value.options);
      const initial =
        typeof value.default === "string" || typeof value.default === "number" ? String(value.default) : null;
      return { ...base, kind: options.length > 0 ? "choice" : "text", initial, options, url: null };
    }
    default:
      return null;
  }
}

function fieldsOf(value: unknown): HxOcField[] {
  return Array.isArray(value) ? value.flatMap((field) => fieldOf(field) ?? []) : [];
}

function methodOf(value: unknown): HxOcMethod | null {
  if (!isDynamicRecord(value)) return null;
  switch (value.type) {
    case "key":
      return { kind: "key", id: null, label: text(value.label), fields: fieldsOf(value.form), envNames: [] };
    case "env":
      return {
        kind: "env",
        id: null,
        label: null,
        fields: [],
        envNames: Array.isArray(value.names) ? value.names.filter((name) => typeof name === "string") : [],
      };
    case "oauth":
    case "external":
      return typeof value.id === "string"
        ? { kind: value.type, id: value.id, label: text(value.label), fields: fieldsOf(value.form), envNames: [] }
        : null;
    // A command connection runs a program of the service's own; it is done in a terminal.
    default:
      return null;
  }
}

function connectionOf(value: unknown): HxOcConnection | null {
  if (!isDynamicRecord(value)) return null;
  if (value.type === "credential" && typeof value.id === "string") {
    const method =
      value.method === "key" || value.method === "oauth" || value.method === "external" ? value.method : null;
    return { kind: "credential", id: value.id, label: text(value.label) ?? value.id, method };
  }
  if (value.type === "env" && typeof value.name === "string") {
    return { kind: "env", id: value.name, label: value.name, method: null };
  }
  return null;
}

function integrationOf(entry: unknown): HxOcIntegration | null {
  if (!isDynamicRecord(entry) || typeof entry.id !== "string") return null;
  const methods = Array.isArray(entry.methods) ? entry.methods.flatMap((method) => methodOf(method) ?? []) : [];
  const connections = Array.isArray(entry.connections)
    ? entry.connections.flatMap((connection) => connectionOf(connection) ?? [])
    : [];
  return { id: entry.id, name: text(entry.name) ?? entry.id, methods, connections };
}

/** One integration, as `GET /api/integration/{id}` answers it. */
export function hxOcIntegration(answer: unknown): HxOcIntegration | null {
  return integrationOf(recordOf(answer));
}

/** The integrations of the answer, without the web search services, in the order HXBot lists them. */
export function hxOcIntegrations(answer: unknown, searchIds: ReadonlySet<string>): HxOcIntegration[] {
  const integrations = listOf(answer).flatMap((entry): HxOcIntegration[] => {
    const integration = integrationOf(entry);
    return integration && !searchIds.has(integration.id) ? [integration] : [];
  });
  const rank = (integration: HxOcIntegration): number => {
    const first = FIRST.indexOf(integration.id);
    return (integration.connections.length > 0 ? 0 : 1000) + (first === -1 ? 500 : first);
  };
  return integrations.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The ids of OpenCode's web search services, which are not model services. */
export function hxOcSearchIds(answer: unknown): Set<string> {
  return new Set(
    listOf(answer).flatMap((entry) => (isDynamicRecord(entry) && typeof entry.id === "string" ? [entry.id] : [])),
  );
}

function free(model: DynamicRecord): boolean {
  const costs = Array.isArray(model.cost) ? model.cost : [];
  return (
    costs.length > 0 && costs.every((cost) => isDynamicRecord(cost) && cost.input === 0 && (cost.output ?? 0) === 0)
  );
}

/** How many models each service lists, and how many of OpenCode's own run free with no account. */
export function hxOcModelCounts(answer: unknown): { models: Record<string, number>; freeModels: number } {
  const models: Record<string, number> = {};
  let freeModels = 0;
  for (const model of listOf(answer)) {
    if (!isDynamicRecord(model) || typeof model.providerID !== "string" || model.enabled === false) continue;
    models[model.providerID] = (models[model.providerID] ?? 0) + 1;
    if (model.providerID === "opencode" && free(model)) freeModels += 1;
  }
  return { models, freeModels };
}

export type HxOcMethodKindRun = "key" | "oauth" | "external";

/** The integration's method of that kind and id, as OpenCode lists it. A key method has no id. */
function methodRecord(answer: unknown, kind: HxOcMethodKindRun, methodId: string | null): DynamicRecord | null {
  const integration = recordOf(answer);
  if (!integration || !Array.isArray(integration.methods)) return null;
  const method = integration.methods.find(
    (entry) => isDynamicRecord(entry) && entry.type === kind && (methodId === null || entry.id === methodId),
  );
  return isDynamicRecord(method) ? method : null;
}

/** The questions of one method, as OpenCode lists them, hidden ones included. */
export function hxOcMethodForm(answer: unknown, kind: HxOcMethodKindRun, methodId: string | null): DynamicRecord[] {
  const form = methodRecord(answer, kind, methodId)?.form;
  return Array.isArray(form) ? form.filter(isDynamicRecord) : [];
}

/** True when the integration offers that method. */
export function hxOcHasMethod(answer: unknown, kind: HxOcMethodKindRun, methodId: string | null): boolean {
  return methodRecord(answer, kind, methodId) !== null;
}

/**
 * The answer OpenCode gets: the defaults of the form, hidden questions included, then what the user
 * gave for a question the form has. A key the form does not have is dropped.
 */
export function hxOcAnswer(form: readonly DynamicRecord[], given: HxOcAnswer | null): HxOcAnswer | null {
  const answer: Record<string, string | boolean> = {};
  for (const field of form) {
    if (typeof field.key !== "string") continue;
    const initial = field.default;
    if (typeof initial === "string" || typeof initial === "boolean") answer[field.key] = initial;
    else if (typeof initial === "number") answer[field.key] = String(initial);
    const value = given?.[field.key];
    if (value === undefined) continue;
    if (field.type === "boolean") answer[field.key] = value === true || value === "true";
    else if (typeof value === "string") answer[field.key] = value.trim();
  }
  return Object.keys(answer).length > 0 ? answer : null;
}

function timeOf(value: unknown): number {
  if (!isDynamicRecord(value)) return 0;
  return typeof value.expires === "number" && Number.isFinite(value.expires) ? value.expires : 0;
}

export function hxOcAttempt(integrationId: string, answer: unknown): HxOcAttempt | null {
  const data = recordOf(answer);
  if (!data || typeof data.attemptID !== "string" || typeof data.url !== "string") return null;
  return {
    integrationId,
    attemptId: data.attemptID,
    url: data.url,
    instructions: text(data.instructions) ?? "",
    mode: data.mode === "code" ? "code" : "auto",
    expiresAt: timeOf(data.time),
  };
}

export function hxOcAttemptStatus(answer: unknown): HxOcAttemptStatus {
  const data = recordOf(answer);
  if (!data) return { status: "failed", message: null };
  const status = data.status;
  if (status === "pending" || status === "complete" || status === "expired") return { status, message: null };
  return { status: "failed", message: text(data.message) };
}

/** The names of the connected services, for the model list. */
export function hxOcConnectedNames(integrations: readonly HxOcIntegration[]): Record<string, string> {
  return Object.fromEntries(
    integrations.filter((integration) => integration.connections.length > 0).map((item) => [item.id, item.name]),
  );
}
