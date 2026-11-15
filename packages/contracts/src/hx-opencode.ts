// HXBot: every model service that OpenCode can reach, connected from HXBot (hx-opencode).
//
// OpenCode 2 lists its integrations with the ways each one connects: a pasted key, a sign-in in the
// browser, a credential that is already on this computer, or an environment variable. HXBot shows
// that list, runs the connection through OpenCode's own local server, and OpenCode keeps the
// credential where `opencode auth login` keeps it. The models of a connected service then show in
// OpenCode's model list, so agents and auto model can use them.
//
// Main receives the inputs from the screen and checks them here; the screen receives the catalog,
// the sign-in attempt and its status from main and checks them here too.

import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

/** The kinds of connection HXBot runs. OpenCode's command connection is done in a terminal and not listed. */
export const HX_OC_METHOD_KINDS = ["key", "oauth", "external", "env"] as const;
export type HxOcMethodKind = (typeof HX_OC_METHOD_KINDS)[number];

export interface HxOcOption {
  readonly value: string;
  readonly label: string;
}

/** A question shows only while another answer is, or is not, this value. */
export interface HxOcWhen {
  readonly key: string;
  readonly equal: boolean;
  readonly value: string;
}

/** One question of a connection form: a text, a choice, a yes/no, or a page to read. */
export interface HxOcField {
  readonly key: string;
  readonly kind: "text" | "choice" | "boolean" | "link";
  readonly title: string;
  readonly description: string | null;
  readonly required: boolean;
  readonly placeholder: string | null;
  readonly initial: string | boolean | null;
  readonly options: readonly HxOcOption[];
  /** For a link: the page. */
  readonly url: string | null;
  readonly when: readonly HxOcWhen[];
}

export interface HxOcMethod {
  readonly kind: HxOcMethodKind;
  /** OpenCode's id of the method; null for a key or an environment variable. */
  readonly id: string | null;
  readonly label: string | null;
  readonly fields: readonly HxOcField[];
  /** For an environment variable: the names OpenCode reads. */
  readonly envNames: readonly string[];
}

export interface HxOcConnection {
  readonly kind: "credential" | "env";
  /** The credential id, or the name of the variable. */
  readonly id: string;
  readonly label: string;
  readonly method: "key" | "oauth" | "external" | null;
}

export interface HxOcIntegration {
  readonly id: string;
  readonly name: string;
  readonly methods: readonly HxOcMethod[];
  readonly connections: readonly HxOcConnection[];
}

export const HX_OC_STATES = ["ready", "missing", "old", "failed"] as const;
export type HxOcState = (typeof HX_OC_STATES)[number];

export interface HxOcCatalog {
  readonly state: HxOcState;
  /** The version of OpenCode that answered, or that is too old. */
  readonly version: string | null;
  /** Why the list is empty, in OpenCode's words, for "failed". */
  readonly message: string | null;
  readonly integrations: readonly HxOcIntegration[];
  /** How many of OpenCode's free models run with no account. */
  readonly freeModels: number;
  /** The models of each connected service, by integration id. */
  readonly models: Readonly<Record<string, number>>;
}

export type HxOcAnswer = Readonly<Record<string, string | boolean>>;

export interface HxOcKeyInput {
  readonly integrationId: string;
  readonly key: string;
  readonly answer: HxOcAnswer | null;
}

export interface HxOcMethodInput {
  readonly integrationId: string;
  readonly methodId: string;
  readonly answer: HxOcAnswer | null;
}

export interface HxOcAttempt {
  readonly integrationId: string;
  readonly attemptId: string;
  readonly url: string;
  readonly instructions: string;
  /** "auto": the browser comes back to OpenCode by itself; "code": the page shows a code to paste. */
  readonly mode: "auto" | "code";
  readonly expiresAt: number;
}

export interface HxOcAttemptRef {
  readonly integrationId: string;
  readonly attemptId: string;
}

export interface HxOcCompleteInput extends HxOcAttemptRef {
  readonly code: string | null;
}

export const HX_OC_ATTEMPT_STATUSES = ["pending", "complete", "failed", "expired"] as const;
export interface HxOcAttemptStatus {
  readonly status: (typeof HX_OC_ATTEMPT_STATUSES)[number];
  readonly message: string | null;
}

export interface HxOcDisconnectInput {
  readonly integrationId: string;
  readonly credentialId: string;
}

/** OpenCode's ids are short words: `deepseek`, `cred_1d88…`, `con_1d88…`, `chatgpt-browser`. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export const HX_OC_KEY_MAX = 8192;
const ANSWER_MAX = 24;
const ANSWER_TEXT_MAX = 2048;
const CODE_MAX = 4096;

export function isHxOcId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function parseAnswer(value: unknown): HxOcAnswer | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isDynamicRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > ANSWER_MAX) return undefined;
  const answer: Record<string, string | boolean> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/u.test(key)) return undefined;
    if (typeof item === "boolean") answer[key] = item;
    else if (typeof item === "string" && item.length <= ANSWER_TEXT_MAX) answer[key] = item;
    else return undefined;
  }
  return answer;
}

function fail(what: string): never {
  throw new Error(`Invalid OpenCode ${what}.`);
}

/** A key to save: main receives it from the screen and throws on anything else. */
export function decodeHxOcKeyInput(value: unknown): HxOcKeyInput {
  if (!isDynamicRecord(value) || !isHxOcId(value.integrationId)) fail("key request");
  const key = typeof value.key === "string" ? value.key.trim() : "";
  if (key.length === 0 || key.length > HX_OC_KEY_MAX || /[\r\n]/u.test(key)) fail("key");
  const answer = parseAnswer(value.answer);
  if (answer === undefined) fail("form answer");
  return { integrationId: value.integrationId, key, answer };
}

export function decodeHxOcMethodInput(value: unknown): HxOcMethodInput {
  if (!isDynamicRecord(value) || !isHxOcId(value.integrationId) || !isHxOcId(value.methodId)) fail("sign-in request");
  const answer = parseAnswer(value.answer);
  if (answer === undefined) fail("form answer");
  return { integrationId: value.integrationId, methodId: value.methodId, answer };
}

export function decodeHxOcAttemptRef(value: unknown): HxOcAttemptRef {
  if (!isDynamicRecord(value) || !isHxOcId(value.integrationId) || !isHxOcId(value.attemptId)) fail("sign-in");
  return { integrationId: value.integrationId, attemptId: value.attemptId };
}

export function decodeHxOcCompleteInput(value: unknown): HxOcCompleteInput {
  const ref = decodeHxOcAttemptRef(value);
  const raw = isDynamicRecord(value) ? value.code : null;
  if (raw !== null && raw !== undefined && (typeof raw !== "string" || raw.trim().length > CODE_MAX)) fail("code");
  const code = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
  return { ...ref, code };
}

export function decodeHxOcDisconnectInput(value: unknown): HxOcDisconnectInput {
  if (!isDynamicRecord(value) || !isHxOcId(value.integrationId) || !isHxOcId(value.credentialId))
    fail("disconnect request");
  return { integrationId: value.integrationId, credentialId: value.credentialId };
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isField(value: unknown): value is HxOcField {
  return (
    isDynamicRecord(value) &&
    isText(value.key) &&
    isOneOf(["text", "choice", "boolean", "link"] as const, value.kind) &&
    isText(value.title) &&
    isTextOrNull(value.description) &&
    isBoolean(value.required) &&
    isTextOrNull(value.placeholder) &&
    (value.initial === null || isText(value.initial) || isBoolean(value.initial)) &&
    Array.isArray(value.options) &&
    value.options.every((option) => isDynamicRecord(option) && isText(option.value) && isText(option.label)) &&
    isTextOrNull(value.url) &&
    Array.isArray(value.when) &&
    value.when.every((when) => isDynamicRecord(when) && isText(when.key) && isBoolean(when.equal) && isText(when.value))
  );
}

function isMethod(value: unknown): value is HxOcMethod {
  return (
    isDynamicRecord(value) &&
    isOneOf(HX_OC_METHOD_KINDS, value.kind) &&
    isTextOrNull(value.id) &&
    isTextOrNull(value.label) &&
    Array.isArray(value.fields) &&
    value.fields.every(isField) &&
    Array.isArray(value.envNames) &&
    value.envNames.every(isText)
  );
}

function isConnection(value: unknown): value is HxOcConnection {
  return (
    isDynamicRecord(value) &&
    isOneOf(["credential", "env"] as const, value.kind) &&
    isText(value.id) &&
    isText(value.label) &&
    (value.method === null || isOneOf(["key", "oauth", "external"] as const, value.method))
  );
}

function isIntegration(value: unknown): value is HxOcIntegration {
  return (
    isDynamicRecord(value) &&
    isText(value.id) &&
    isText(value.name) &&
    Array.isArray(value.methods) &&
    value.methods.every(isMethod) &&
    Array.isArray(value.connections) &&
    value.connections.every(isConnection)
  );
}

function isCatalog(value: unknown): value is HxOcCatalog {
  return (
    isDynamicRecord(value) &&
    isOneOf(HX_OC_STATES, value.state) &&
    isTextOrNull(value.version) &&
    isTextOrNull(value.message) &&
    Array.isArray(value.integrations) &&
    value.integrations.every(isIntegration) &&
    typeof value.freeModels === "number" &&
    isDynamicRecord(value.models) &&
    Object.values(value.models).every((count) => typeof count === "number")
  );
}

function isAttempt(value: unknown): value is HxOcAttempt {
  return (
    isDynamicRecord(value) &&
    isText(value.integrationId) &&
    isText(value.attemptId) &&
    isText(value.url) &&
    isText(value.instructions) &&
    isOneOf(["auto", "code"] as const, value.mode) &&
    typeof value.expiresAt === "number"
  );
}

function isAttemptStatus(value: unknown): value is HxOcAttemptStatus {
  return isDynamicRecord(value) && isOneOf(HX_OC_ATTEMPT_STATUSES, value.status) && isTextOrNull(value.message);
}

/** The catalog as the screen receives it from main; it throws on anything else. */
export function decodeHxOcCatalog(value: unknown): HxOcCatalog {
  if (!isCatalog(value)) fail("catalog");
  return value;
}

export function decodeHxOcAttempt(value: unknown): HxOcAttempt {
  if (!isAttempt(value)) fail("sign-in");
  return value;
}

export function decodeHxOcAttemptStatus(value: unknown): HxOcAttemptStatus {
  if (!isAttemptStatus(value)) fail("sign-in status");
  return value;
}
