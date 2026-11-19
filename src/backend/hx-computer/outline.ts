// HXBot 电脑操控（二）：把驱动读到的窗口压成一份短提纲，并按“类型 + 名字”找控件。
//
// `get_window_state` lists every element of a window: often a thousand and more, about 190 KB. The
// model needs the few it can act on or read. The outline keeps the elements that have a name, a
// value or an action, one short line each, and stops at a size limit with a count of what it left
// out. `hxFindElement` scores the elements against what a step names (role and name, in any
// language) and answers one element only when it is clearly the best; otherwise the candidates go
// back to the model, which chooses. It never guesses between two close ones.
import { type DynamicRecord, isDynamicRecord } from "@hxbot/contracts/runtime-values";

/** One element of a window, as far as the steps use it. */
export interface HxElement {
  index: number;
  token: string | null;
  role: string;
  label: string;
  value: string;
  enabled: boolean;
  selected: boolean;
  /** Window-local screenshot pixels, as the driver reports them. */
  frame: { x: number; y: number; w: number; h: number } | null;
  actions: string[];
  depth: number;
  /** HXBot (v1.7.3): the driver reads this element's value, so a value set on it can be read back. */
  hasValue?: boolean;
}

/** A window the driver read. */
export interface HxWindowRead {
  pid: number;
  windowId: number;
  app: string;
  title: string;
  snapshotId: string | null;
  elements: HxElement[];
  /** False when the driver says it did not walk the whole window. */
  complete: boolean;
}

const text = (value: unknown, max = 200): string => (typeof value === "string" ? value.trim().slice(0, max) : "");
const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

function readFrame(value: unknown): HxElement["frame"] {
  if (!isDynamicRecord(value)) return null;
  const { x, y, w, h } = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof w !== "number" || typeof h !== "number") return null;
  return { x, y, w, h };
}

function readElement(value: unknown): HxElement | null {
  if (!isDynamicRecord(value)) return null;
  const index = whole(value.element_index);
  if (index === null || typeof value.role !== "string") return null;
  return {
    index,
    token: typeof value.element_token === "string" && value.element_token.length > 0 ? value.element_token : null,
    role: value.role.slice(0, 60),
    label: text(value.label),
    value: text(value.value) || text(value.value_description),
    enabled: value.enabled !== false,
    selected: value.selected === true,
    frame: readFrame(value.frame),
    actions: Array.isArray(value.actions)
      ? value.actions.filter((action): action is string => typeof action === "string").slice(0, 8)
      : [],
    depth: whole(value.depth) ?? 0,
    ...(typeof value.value === "string" ? { hasValue: true } : {}),
  };
}

/** The window in a `get_window_state` answer, or null when the answer is not one. */
export function hxReadWindow(content: DynamicRecord | null): HxWindowRead | null {
  if (!content) return null;
  const pid = whole(content.pid);
  const windowId = whole(content.window_id);
  if (pid === null || windowId === null) return null;
  const elements = Array.isArray(content.elements)
    ? content.elements.map(readElement).filter((element): element is HxElement => element !== null)
    : [];
  return {
    pid,
    windowId,
    app: text(content.app_name, 120),
    title: text(content.window_title, 200),
    snapshotId: typeof content.snapshot_id === "string" ? content.snapshot_id : null,
    elements,
    complete: content.elements_complete !== false && content.truncated !== true,
  };
}

// Roles differ by platform: AXButton on macOS, Button on Windows, "push button" on Linux. They are
// compared by a short kind; the model may write any of the forms, or a kind itself.
const KINDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["button", ["button", "pushbutton", "togglebutton", "splitbutton", "menubutton", "popupbutton"]],
  [
    "field",
    [
      "textfield",
      "textarea",
      "edit",
      "entry",
      "text field",
      "searchfield",
      "combobox",
      "securetextfield",
      "document",
      "field",
      "input",
      "textbox",
      "searchbox",
    ],
  ],
  ["check", ["checkbox", "check", "switch", "togglebutton"]],
  ["radio", ["radiobutton", "radio"]],
  ["menu", ["menu", "menubar", "menubaritem", "menuitem", "popupmenu"]],
  ["tab", ["tab", "tabitem", "pagetab", "tabgroup"]],
  ["link", ["link", "hyperlink"]],
  ["row", ["row", "listitem", "cell", "outlinerow", "treeitem", "dataitem", "tablerow", "item"]],
  ["slider", ["slider", "spinbutton", "incrementor", "stepper", "scrollbar"]],
  ["text", ["statictext", "text", "label", "heading"]],
  ["image", ["image", "icon", "graphic"]],
];

/** The short kind of a role or of a word for one, or the plain word when no kind fits. */
export function hxRoleKind(role: string): string {
  const plain = role
    .toLowerCase()
    .replace(/^ax/u, "")
    .replace(/[\s_-]+/gu, "");
  for (const [kind, names] of KINDS) {
    if (kind === plain || names.some((name) => name.replace(/\s+/gu, "") === plain)) return kind;
  }
  return plain;
}

/** Text as it is compared: one form of each character, lower case, with no spaces or punctuation. */
export function hxPlainName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

const ACTIONABLE = new Set(["button", "field", "check", "radio", "menu", "tab", "link", "row", "slider"]);

function shown(element: HxElement): boolean {
  if (element.frame && (element.frame.w <= 0 || element.frame.h <= 0)) return false;
  return element.label.length > 0 || element.value.length > 0 || ACTIONABLE.has(hxRoleKind(element.role));
}

function line(element: HxElement): string {
  const parts = [`[${element.index}] ${hxRoleKind(element.role)}`];
  if (element.label) parts.push(JSON.stringify(element.label.slice(0, 80)));
  if (element.value && element.value !== element.label) parts.push(`= ${JSON.stringify(element.value.slice(0, 80))}`);
  if (!element.enabled) parts.push("(off)");
  if (element.selected) parts.push("(selected)");
  return parts.join(" ");
}

/** The outline of a window in at most `maxChars` characters, with what it left out counted. */
export function hxOutline(window: HxWindowRead, maxChars = 3000): string {
  const head = `${window.app || "?"} — ${window.title || "(no title)"} (pid ${window.pid}, window ${window.windowId})`;
  const lines: string[] = [head];
  let used = head.length;
  let left = 0;
  for (const element of window.elements) {
    if (!shown(element)) continue;
    const next = `${" ".repeat(Math.min(element.depth, 6))}${line(element)}`;
    if (used + next.length + 1 > maxChars) {
      left += 1;
      continue;
    }
    lines.push(next);
    used += next.length + 1;
  }
  if (left > 0) lines.push(`… ${left} more elements; give query to see fewer.`);
  if (!window.complete) lines.push("The driver did not read the whole window.");
  return lines.join("\n");
}

/** What a step names: the element's name (one or several forms), and its role or kind. */
export interface HxTarget {
  name?: string | readonly string[];
  role?: string;
  /** An element index from the last outline of the same window. */
  index?: number;
}

/** How well one element fits a target. Zero means not at all. */
export function hxElementScore(element: HxElement, target: HxTarget): number {
  const names = target.name === undefined ? [] : typeof target.name === "string" ? [target.name] : target.name;
  const wanted = names.map(hxPlainName).filter((name) => name.length > 0);
  const label = hxPlainName(element.label);
  const value = hxPlainName(element.value);
  let score = 0;
  for (const name of wanted) {
    if (label === name) score = Math.max(score, 10);
    else if (label.length > 0 && label.includes(name)) score = Math.max(score, 6);
    else if (label.length >= 2 && name.includes(label)) score = Math.max(score, 3);
    if (value === name) score = Math.max(score, 5);
  }
  if (wanted.length > 0 && score === 0) return 0;
  if (target.role) {
    if (hxRoleKind(element.role) === hxRoleKind(target.role)) score += 3;
    else if (wanted.length === 0) return 0;
    else score -= 2;
  }
  if (!element.enabled) score -= 4;
  return Math.max(score, 0);
}

export type HxFound =
  | { status: "found"; element: HxElement }
  | { status: "none"; candidates: HxElement[] }
  | { status: "several"; candidates: HxElement[] };

/** A score that is enough on its own: an exact name, or a name inside the label with the right kind. */
const SURE = 6;

/** The element a target means, or the candidates when it is not clear. */
export function hxFindElement(window: HxWindowRead, target: HxTarget): HxFound {
  if (target.index !== undefined) {
    const element = window.elements.find((candidate) => candidate.index === target.index);
    return element ? { status: "found", element } : { status: "none", candidates: [] };
  }
  // A kind with no name, such as the one text area of an editor: found when it is the only one
  // (found on a real Mac in v1.6.7: the text area of TextEdit has no label, only its text).
  const names = target.name === undefined ? [] : typeof target.name === "string" ? [target.name] : target.name;
  if (target.role && !names.some((name) => hxPlainName(name).length > 0)) {
    const kind = hxRoleKind(target.role);
    const fitting = window.elements.filter((element) => element.enabled && hxRoleKind(element.role) === kind);
    const [only] = fitting;
    if (only && fitting.length === 1) return { status: "found", element: only };
    return fitting.length ? { status: "several", candidates: fitting.slice(0, 5) } : { status: "none", candidates: [] };
  }
  const scored = window.elements
    .map((element) => ({ element, score: hxElementScore(element, target) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const candidates = scored.slice(0, 5).map((entry) => entry.element);
  if (!best || best.score < SURE) return { status: "none", candidates };
  const second = scored[1];
  if (second && second.score > best.score - 2) {
    // Two with the same name: the one that can act wins when only it can.
    const acting = scored.filter(
      (entry) => entry.score === best.score && ACTIONABLE.has(hxRoleKind(entry.element.role)),
    );
    if (acting.length === 1 && acting[0]) return { status: "found", element: acting[0].element };
    return { status: "several", candidates };
  }
  return { status: "found", element: best.element };
}

/** One candidate as the model reads it. */
export function hxCandidateLine(element: HxElement): string {
  return line(element);
}
