// HXBot 电脑操控（二）：一步步操作一个窗口（computer_look、computer_do 的执行部分）。
//
// The agent plans the steps from the user's words; this runs them on one window, one at a time, and
// checks each one. A step names its element by role and name, the way a person would ("the Export
// button"), and HXBot finds it in what the driver reads; the model never gives coordinates unless
// it chose them from a screenshot. Each click goes the driver's ladder: in the background first,
// then in the foreground (the screen is borrowed for that step, and the answer says so), then at
// the element's position. A step with `expect` is checked with the driver's `verify_state`.
//
// The run stops at the first step that does not work and answers what it expected, what it found
// and the closest candidates, in a few hundred characters, so the model can choose another way. It
// also stops before a step that would send, pay, buy, delete or publish unless the agent marks that
// step confirmed, which the instructions allow only after the user said yes in the chat. The user
// can stop the run at any time (`HxComputerStops`); the next step then does not start.
import type { DynamicRecord } from "@hxbot/contracts/runtime-values";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import type { HxDriverAnswer, HxDriverPort } from "./driver";
import type { HxClipboardKeep, HxFrontWatch } from "./front";
import {
  type HxElement,
  type HxTarget,
  type HxWindowRead,
  hxCandidateLine,
  hxFindElement,
  hxOutline,
  hxPlainName,
  hxReadWindow,
} from "./outline";

/** HXBot (v1.7.0): how long a look that found the target in front holds. */
const HX_FRONT_SEEN_MS = 2_000;
/** HXBot (v1.7.0): the time a paste may take to read the clipboard before the user's copy goes back. */
const HX_CLIPBOARD_BACK_MS = 300;

/** Which window the steps act on. With none of the fields, the front window. */
export interface HxWindowChoice {
  app?: string;
  title?: string;
  windowId?: number;
}

type HxStepAct =
  | "click"
  | "double_click"
  | "right_click"
  | "type"
  | "key"
  | "hotkey"
  | "scroll"
  | "drag"
  | "menu"
  | "wait";

export interface HxPoint {
  x: number;
  y: number;
}

/** What a step expects to see after it. */
export interface HxExpect {
  name: string;
  role?: string;
  value?: string;
}

export interface HxStep {
  act: HxStepAct;
  target?: HxTarget;
  /** Window-local screenshot pixels, when the agent chose a point from a screenshot. */
  at?: HxPoint;
  text?: string;
  key?: string;
  modifiers?: string[];
  keys?: string[];
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  to?: HxTarget;
  toAt?: HxPoint;
  path?: string[];
  seconds?: number;
  expect?: HxExpect;
  /** True only when the user said yes in the chat to this send, payment, purchase or deletion. */
  confirmed?: boolean;
}

/** How a step reached the window. */
export type HxStepRoute = "background" | "foreground" | "point" | "menu" | "keyboard" | "none";

interface HxStepDone {
  n: number;
  act: HxStepAct;
  what: string;
  route: HxStepRoute;
  /** False when the driver could not confirm the step itself and no `expect` checked it. */
  checked: boolean;
}

export type HxRunStatus = "done" | "failed" | "confirm" | "stopped" | "unsure" | "no_window" | "no_driver";

export interface HxRunResult {
  status: HxRunStatus;
  window: { app: string; title: string; windowId: number } | null;
  steps: HxStepDone[];
  /** The step that did not work, and why. */
  stoppedAt?: { n: number; act: HxStepAct; reason: string; candidates?: string[] };
  /** True when a step took the screen from the user for a moment (foreground input). */
  borrowedScreen: boolean;
}

/** The runs the user stopped: one agent's, or every agent's after the stop keys. */
export class HxComputerStops {
  readonly #stopped = new Set<string>();
  #all = false;

  stop(agentId: string | null): void {
    if (agentId === null) this.#all = true;
    else this.#stopped.add(agentId);
  }

  releaseAll(): void {
    this.#stopped.clear();
    this.#all = false;
  }

  stopped(agentId: string): boolean {
    return this.#all || this.#stopped.has(agentId);
  }
}

// Words on a control or a menu item that send, pay, buy, delete or publish. Chinese words count
// anywhere in the label ("确认发送", "删除文件"); English words count as whole words ("Send now", not
// "Sender"), and a few phrases as they are.
const RISKY_CJK = [
  "发送",
  "发出",
  "发布",
  "提交",
  "付款",
  "支付",
  "购买",
  "下单",
  "删除",
  "移除",
  "清空",
  "卸载",
  "转账",
];
const RISKY_WORDS = new Set([
  "send",
  "post",
  "publish",
  "submit",
  "pay",
  "buy",
  "purchase",
  "checkout",
  "delete",
  "remove",
  "erase",
  "uninstall",
  "transfer",
]);
const RISKY_PHRASES = ["movetotrash", "emptytrash", "movetobin", "emptybin", "placeorder"];

/** Whether a control or menu label would send, pay, buy, delete or publish. */
export function hxRiskyLabel(label: string): boolean {
  const plain = hxPlainName(label);
  if (plain.length === 0) return false;
  if (RISKY_CJK.some((word) => plain.includes(word)) || RISKY_PHRASES.some((phrase) => plain.includes(phrase)))
    return true;
  return label
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => RISKY_WORDS.has(word));
}

interface WindowFact {
  pid: number;
  windowId: number;
  app: string;
  title: string;
  width: number;
  height: number;
}

const MIN_SIDE = 120;

/** The keys and text go to the app in front: the primary display as a whole. */
const FRONT: DynamicRecord = { kind: "desktop", display_id: "primary" };

function readWindows(content: DynamicRecord | null): Array<WindowFact & { z: number }> {
  if (!content || !Array.isArray(content.windows)) return [];
  const windows: Array<WindowFact & { z: number }> = [];
  for (const entry of content.windows) {
    if (!isDynamicRecord(entry) || !isDynamicRecord(entry.bounds)) continue;
    const { pid, window_id: windowId, z_index: z } = entry;
    const { width, height } = entry.bounds;
    if (typeof pid !== "number" || typeof windowId !== "number") continue;
    if (typeof width !== "number" || typeof height !== "number") continue;
    if (entry.is_on_screen === false || entry.minimized === true) continue;
    windows.push({
      pid,
      windowId,
      app: typeof entry.app_name === "string" ? entry.app_name : "",
      title: typeof entry.title === "string" ? entry.title : "",
      width,
      height,
      z: typeof z === "number" ? z : -1,
    });
  }
  return windows;
}

/** HXBot's own windows and the driver's cursor overlay are never the window to act on. */
function ours(window: WindowFact): boolean {
  const app = hxPlainName(window.app);
  return app.startsWith("hxbot") || app.includes("cuadriver");
}

/** The window a choice means, from a `list_windows` answer. Pure, for the tests. */
export function hxChooseWindow(content: DynamicRecord | null, choice: HxWindowChoice): WindowFact | null {
  const windows = readWindows(content).filter((window) => !ours(window));
  if (choice.windowId !== undefined) return windows.find((window) => window.windowId === choice.windowId) ?? null;
  const app = choice.app ? hxPlainName(choice.app) : "";
  const title = choice.title ? hxPlainName(choice.title) : "";
  const fitting = windows.filter((window) => {
    if (window.width < MIN_SIDE || window.height < MIN_SIDE) return false;
    const name = hxPlainName(window.app);
    if (app && !(name === app || name.includes(app) || (name.length >= 2 && app.includes(name)))) return false;
    return !title || hxPlainName(window.title).includes(title);
  });
  fitting.sort((a, b) => b.z - a.z || b.width * b.height - a.width * a.height);
  return fitting[0] ?? null;
}

/** What one answer of an action tool says about the step. */
export function actionEffect(answer: HxDriverAnswer): {
  worked: boolean;
  sure: boolean;
  foreground: boolean;
  next: "foreground" | "pixel" | null;
  reason: string;
} {
  if (!answer.ok)
    return { worked: false, sure: false, foreground: false, next: null, reason: answer.error ?? "failed" };
  const content = answer.content ?? {};
  const effect = typeof content.effect === "string" ? content.effect : "unverifiable";
  const delivery = isDynamicRecord(content.delivery) ? content.delivery.mode : null;
  const escalation = isDynamicRecord(content.escalation) ? content.escalation.target : null;
  const error = isDynamicRecord(content.error)
    ? `${String(content.error.code ?? "")} ${String(content.error.hint ?? "")}`.trim()
    : "";
  const next = escalation === "foreground" ? "foreground" : escalation === "pixel" ? "pixel" : null;
  const worked = effect === "confirmed" || effect === "partial" || effect === "unverifiable";
  return {
    worked,
    sure: effect === "confirmed",
    foreground: delivery === "foreground",
    next,
    reason: worked ? "" : `${effect}${error ? `: ${error}` : ""}`.slice(0, 240),
  };
}

const describe = (element: HxElement): string => (element.label || element.value || element.role).slice(0, 60);

/** One run of steps on one window. */
export class HxStepRun {
  readonly #driver: HxDriverPort;
  readonly #stopped: () => boolean;
  readonly #wait: (ms: number) => Promise<void>;
  #window: WindowFact | null = null;
  #read: HxWindowRead | null = null;
  /**
   * Set when a field was clicked in the foreground: the text and the keys of the rest of the run go
   * to the app in front, where the focus is. Sent to the window, Windows Notepad took the text but
   * not Ctrl+S (found by the real check in v1.6.7).
   */
  #keysToFront = false;
  #borrowed = false;
  /** HXBot (v1.7.0): keys go to the target app only, and the modifiers are let go at the end. */
  readonly #front: HxFrontWatch | null;
  readonly #clipboard: HxClipboardKeep | null;
  #keysSent = false;
  /** When the target was last seen in front: 0 for never. */
  #frontSeenAt = 0;

  constructor(options: {
    driver: HxDriverPort;
    stopped: () => boolean;
    wait?: (ms: number) => Promise<void>;
    front?: HxFrontWatch | null;
    clipboard?: HxClipboardKeep | null;
  }) {
    this.#driver = options.driver;
    this.#stopped = options.stopped;
    this.#front = options.front ?? null;
    this.#clipboard = options.clipboard ?? null;
    this.#wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Finds the window; false when there is none. */
  async open(choice: HxWindowChoice): Promise<"no_window" | "no_driver" | null> {
    const listed = await this.#driver.call("list_windows", { on_screen_only: true }, 5_000);
    if (!listed.ok) return "no_driver";
    this.#window = hxChooseWindow(listed.content, choice);
    return this.#window ? null : "no_window";
  }

  /** The outline of the window, read now. */
  async look(query?: string, maxChars = 3000): Promise<{ outline: string } | { error: string }> {
    const read = await this.#readWindow(query);
    if (typeof read === "string") return { error: read };
    return { outline: hxOutline(read, maxChars) };
  }

  async run(steps: readonly HxStep[]): Promise<HxRunResult> {
    try {
      return await this.#runAll(steps);
    } finally {
      // A run stopped between a key down and its key up leaves a modifier held: every shortcut of
      // every other app then goes wrong. A key up for a key that is not down does nothing.
      if (this.#keysSent) await this.#front?.releaseModifiers().catch(() => undefined);
    }
  }

  /**
   * Keys that go to the app in front go to the target app only (v1.7.0). When the user moved to
   * another app, nothing is sent, and HXBot does not take the front from the user: the step stops.
   * A look that found the target in front holds for a short time, so a row of keys asks once.
   */
  async #keysGoToTarget(): Promise<string | null> {
    const window = this.#window;
    const front = this.#front;
    if (!this.#keysToFront || !window || !front) return null;
    if (Date.now() - this.#frontSeenAt < HX_FRONT_SEEN_MS) return null;
    const now = await front.front();
    if (now === null || now.pid === window.pid || now.windowId === window.windowId) {
      if (now !== null) this.#frontSeenAt = Date.now();
      return null;
    }
    // v1.7.1 (CONC-12): the member learns that the screen is in use, and does other work first.
    return `The user works in another app now, so HXBot did not send the keys there and did not take the front from the user. The screen is in use: first do the parts of the work that do not need the screen. Ask the user to go back to ${window.app} or to say when, then run the steps again.`;
  }

  async #runAll(steps: readonly HxStep[]): Promise<HxRunResult> {
    const window = this.#window;
    const done: HxStepDone[] = [];
    const finish = (status: HxRunStatus, stoppedAt?: HxRunResult["stoppedAt"]): HxRunResult => ({
      status,
      window: window ? { app: window.app, title: window.title, windowId: window.windowId } : null,
      steps: done,
      ...(stoppedAt ? { stoppedAt } : {}),
      borrowedScreen: this.#borrowed,
    });
    if (!window) return finish("no_window");
    for (const [i, step] of steps.entries()) {
      const n = i + 1;
      if (this.#stopped())
        return finish("stopped", { n, act: step.act, reason: "The user stopped the work on the computer." });
      const outcome = await this.#step(step);
      if ("stop" in outcome) {
        return finish(outcome.stop, {
          n,
          act: step.act,
          reason: outcome.reason,
          ...(outcome.candidates ? { candidates: outcome.candidates } : {}),
        });
      }
      let checked = outcome.sure;
      if (step.expect) {
        const verdict = await this.#verify(step.expect);
        if (verdict !== "satisfied") {
          // The step ran, but the window does not show what it expects: it is the step that stopped the run.
          const seen = await this.#near(step.expect.name);
          return finish(verdict === "unsatisfied" ? "failed" : "unsure", {
            n,
            act: step.act,
            reason:
              verdict === "unsatisfied"
                ? `After the step, ${JSON.stringify(step.expect.name)} is not in the window.`
                : `HXBot could not check whether ${JSON.stringify(step.expect.name)} is in the window. Look before you go on.`,
            candidates: seen,
          });
        }
        checked = true;
      }
      done.push({ n, act: step.act, what: outcome.what, route: outcome.route, checked });
      // The window changed: the next step reads it again.
      this.#read = null;
    }
    return finish("done");
  }

  async #readWindow(query?: string): Promise<HxWindowRead | string> {
    const window = this.#window;
    if (!window) return "No window.";
    if (this.#read && query === undefined) return this.#read;
    const answer = await this.#driver.call(
      "get_window_state",
      {
        pid: window.pid,
        window_id: window.windowId,
        include_screenshot: false,
        max_elements: 1500,
        timeout_ms: 2000,
        ...(query ? { query } : {}),
      },
      10_000,
    );
    if (!answer.ok) return answer.error ?? "The window could not be read.";
    const read = hxReadWindow(answer.content);
    if (!read) return "The driver gave no window.";
    if (query === undefined) this.#read = read;
    return read;
  }

  #target(): DynamicRecord {
    const window = this.#window;
    return window ? { kind: "window", pid: window.pid, window_id: window.windowId } : {};
  }

  #keysTarget(): DynamicRecord {
    return this.#keysToFront ? FRONT : this.#target();
  }

  /**
   * Whether the typed text shows in the field now: true or false when the field shows a value, null
   * when it shows none (a field that hides its text, or a driver that does not read it).
   */
  async #landed(field: HxElement, text: string): Promise<boolean | null> {
    await this.#wait(300);
    this.#read = null;
    const read = await this.#readWindow();
    if (typeof read === "string") return null;
    const same =
      read.elements.find((element) => element.index === field.index && element.role === field.role) ??
      read.elements.find((element) => element.role === field.role && element.label === field.label);
    if (!same?.value) return null;
    const tail = hxPlainName(text).slice(-24);
    return tail.length === 0 ? null : hxPlainName(same.value).includes(tail);
  }

  async #find(
    target: HxTarget,
  ): Promise<{ element: HxElement } | { stop: HxRunStatus; reason: string; candidates?: string[] }> {
    const read = await this.#readWindow();
    if (typeof read === "string") return { stop: "failed", reason: read };
    const found = hxFindElement(read, target);
    if (found.status === "found") return { element: found.element };
    const named = JSON.stringify(target.name ?? target.role ?? target.index);
    return {
      stop: "failed",
      reason:
        found.status === "several"
          ? `Several elements fit ${named}. Choose one by index from the candidates.`
          : `No element fits ${named}. Look at the window and name one from it.`,
      candidates: found.candidates.map(hxCandidateLine),
    };
  }

  /** A click on an element or a point, up the ladder. */
  async #click(
    element: HxElement | null,
    at: HxPoint | null,
    extra: DynamicRecord,
    /** Typing goes to the app in front, so a field to type in is clicked in the foreground at once. */
    modes: readonly ("background" | "foreground")[] = ["background", "foreground"],
  ): Promise<{ route: HxStepRoute; sure: boolean } | { reason: string }> {
    const target = this.#target();
    if (element?.token) {
      for (const mode of modes) {
        const answer = await this.#driver.call("click", {
          target,
          element_token: element.token,
          delivery_mode: mode,
          ...extra,
        });
        const effect = actionEffect(answer);
        if (effect.worked) {
          if (effect.foreground) this.#borrowed = true;
          return { route: effect.foreground ? "foreground" : mode, sure: effect.sure };
        }
        if (effect.next === "pixel" || !answer.ok) break;
      }
    }
    const point =
      at ??
      (element?.frame
        ? { x: Math.round(element.frame.x + element.frame.w / 2), y: Math.round(element.frame.y + element.frame.h / 2) }
        : null);
    if (!point) return { reason: "The element has no position to click." };
    let reason = "The click did not happen.";
    for (const mode of modes) {
      const answer = await this.#driver.call("click", {
        target,
        x: point.x,
        y: point.y,
        delivery_mode: mode,
        ...extra,
      });
      const effect = actionEffect(answer);
      if (effect.worked) {
        if (effect.foreground) this.#borrowed = true;
        return { route: "point", sure: effect.sure };
      }
      reason = effect.reason || reason;
    }
    return { reason };
  }

  async #pointOf(
    target: HxTarget | undefined,
    at: HxPoint | undefined,
  ): Promise<HxPoint | { stop: HxRunStatus; reason: string; candidates?: string[] }> {
    if (at) return at;
    if (target) {
      const found = await this.#find(target);
      if ("stop" in found) return found;
      const frame = found.element.frame;
      if (!frame) return { stop: "failed", reason: "The element has no position." };
      return { x: Math.round(frame.x + frame.w / 2), y: Math.round(frame.y + frame.h / 2) };
    }
    const window = this.#window;
    return window
      ? { x: Math.round(window.width / 2), y: Math.round(window.height / 2) }
      : { stop: "no_window", reason: "No window." };
  }

  async #step(
    step: HxStep,
  ): Promise<
    { what: string; route: HxStepRoute; sure: boolean } | { stop: HxRunStatus; reason: string; candidates?: string[] }
  > {
    const window = this.#window;
    if (!window) return { stop: "no_window", reason: "No window." };
    switch (step.act) {
      case "click":
      case "double_click":
      case "right_click": {
        let element: HxElement | null = null;
        if (step.target) {
          const found = await this.#find(step.target);
          if ("stop" in found) return found;
          element = found.element;
          if (!step.confirmed && hxRiskyLabel(describe(element))) {
            return {
              stop: "confirm",
              reason: `${JSON.stringify(describe(element))} sends, pays, buys, deletes or publishes. Ask the user in the chat first; after a yes, repeat the step with confirmed true.`,
            };
          }
        } else if (!step.at) return { stop: "failed", reason: "A click needs target or at." };
        const extra: DynamicRecord =
          step.act === "double_click" ? { count: 2 } : step.act === "right_click" ? { button: "right" } : {};
        const clicked = await this.#click(element, step.at ?? null, extra);
        if ("reason" in clicked) return { stop: "failed", reason: clicked.reason };
        return { what: element ? describe(element) : `${step.at?.x},${step.at?.y}`, ...clicked };
      }
      case "type": {
        if (typeof step.text !== "string" || step.text.length === 0)
          return { stop: "failed", reason: "type needs text." };
        let route: HxStepRoute = "keyboard";
        let label = "";
        let field: HxElement | null = null;
        if (step.target) {
          const found = await this.#find(step.target);
          if ("stop" in found) return found;
          field = found.element;
          label = describe(found.element);
          // Typing goes to the app in front, so the field is clicked first, in the foreground.
          const focused = await this.#click(found.element, null, {}, ["foreground"]);
          if ("reason" in focused) return { stop: "failed", reason: focused.reason };
          route = focused.route;
          if (route === "foreground" || route === "point") this.#keysToFront = true;
        }
        const elsewhere = await this.#keysGoToTarget();
        if (elsewhere) return { stop: "failed", reason: elsewhere };
        this.#keysSent = true;
        // HXBot (v1.7.0, F5): the user's copy is still on the clipboard after the text was typed.
        const restore = await this.#clipboard?.save().catch(() => null);
        try {
          const typed = actionEffect(
            await this.#driver.call("type_text", { text: step.text, target: this.#keysTarget() }, 30_000),
          );
          if (!typed.worked) return { stop: "failed", reason: typed.reason || "The text was not typed." };
          this.#borrowed = true;
          // A field that shows its text says whether the text arrived.
          const landed = field ? await this.#landed(field, step.text) : null;
          if (landed === false) return { stop: "failed", reason: "The text did not reach the field." };
          return {
            what: `${label ? `${label}: ` : ""}${step.text.length} characters`,
            route,
            sure: landed === true || typed.sure,
          };
        } finally {
          // A paste reads the clipboard a moment after the keys: wait before the user's copy goes back.
          if (restore && (await restore.changed().catch(() => false))) {
            await this.#wait(HX_CLIPBOARD_BACK_MS);
            await restore.putBack().catch(() => undefined);
          }
        }
      }
      case "key":
      case "hotkey": {
        const keys = step.act === "hotkey" ? (step.keys ?? []) : [];
        if (step.act === "key" && !step.key) return { stop: "failed", reason: "key needs key." };
        if (step.act === "hotkey" && keys.length === 0) return { stop: "failed", reason: "hotkey needs keys." };
        const away = await this.#keysGoToTarget();
        if (away) return { stop: "failed", reason: away };
        this.#keysSent = true;
        const answer =
          step.act === "key"
            ? await this.#driver.call("press_key", {
                key: step.key ?? "",
                modifiers: step.modifiers ?? [],
                target: this.#keysTarget(),
              })
            : await this.#driver.call("hotkey", { keys, target: this.#keysTarget() });
        const effect = actionEffect(answer);
        if (!effect.worked) return { stop: "failed", reason: effect.reason || "The key was not pressed." };
        this.#borrowed = true;
        return {
          what: step.act === "key" ? [...(step.modifiers ?? []), step.key].join("+") : keys.join("+"),
          route: "keyboard",
          sure: effect.sure,
        };
      }
      case "scroll": {
        const point = await this.#pointOf(step.target, step.at);
        if ("stop" in point) return point;
        const answer = await this.#driver.call("scroll", {
          x: point.x,
          y: point.y,
          direction: step.direction ?? "down",
          amount: step.amount ?? 3,
          target: this.#target(),
        });
        const effect = actionEffect(answer);
        if (!effect.worked) return { stop: "failed", reason: effect.reason || "The window did not scroll." };
        return {
          what: `${step.direction ?? "down"} ${step.amount ?? 3}`,
          route: effect.foreground ? "foreground" : "background",
          sure: effect.sure,
        };
      }
      case "drag": {
        const from = await this.#pointOf(step.target, step.at);
        if ("stop" in from) return from;
        if (!step.to && !step.toAt) return { stop: "failed", reason: "drag needs to or toAt." };
        const to = await this.#pointOf(step.to, step.toAt);
        if ("stop" in to) return to;
        const answer = await this.#driver.call("drag", {
          from_x: from.x,
          from_y: from.y,
          to_x: to.x,
          to_y: to.y,
          target: this.#target(),
        });
        const effect = actionEffect(answer);
        if (!effect.worked) return { stop: "failed", reason: effect.reason || "The drag did not happen." };
        this.#borrowed = true;
        return { what: `${from.x},${from.y} → ${to.x},${to.y}`, route: "foreground", sure: effect.sure };
      }
      case "menu": {
        const path = step.path ?? [];
        if (path.length === 0) return { stop: "failed", reason: "menu needs path." };
        const last = path[path.length - 1] ?? "";
        if (!step.confirmed && hxRiskyLabel(last)) {
          return {
            stop: "confirm",
            reason: `${JSON.stringify(last)} sends, pays, buys, deletes or publishes. Ask the user in the chat first; after a yes, repeat the step with confirmed true.`,
          };
        }
        const answer = await this.#driver.call("invoke_menu", { pid: window.pid, window_id: window.windowId, path });
        const effect = actionEffect(answer);
        if (!effect.worked) return { stop: "failed", reason: effect.reason || "The menu item was not found." };
        return { what: path.join(" › "), route: "menu", sure: effect.sure };
      }
      case "wait": {
        const ms = Math.round(Math.min(Math.max(step.seconds ?? 1, 0.1), 10) * 1000);
        if (!step.expect) await this.#wait(ms);
        return { what: `${ms / 1000} s`, route: "none", sure: step.expect === undefined };
      }
    }
  }

  async #verify(expect: HxExpect): Promise<"satisfied" | "unsatisfied" | "unknown"> {
    const window = this.#window;
    if (!window) return "unknown";
    const selector: DynamicRecord = { label_contains: expect.name, ...(expect.role ? { role: expect.role } : {}) };
    const predicate: DynamicRecord = {
      selector,
      exists: true,
      ...(expect.value === undefined ? {} : { value_equals: expect.value }),
    };
    const answer = await this.#driver.call(
      "verify_state",
      { pid: window.pid, window_id: window.windowId, expect: [{ element: predicate }], timeout_ms: 4000 },
      10_000,
    );
    if (answer.ok && answer.content) {
      const status = answer.content.status;
      if (status === "satisfied" || status === "unsatisfied") return status;
    }
    // The driver could not tell: HXBot reads the window and looks for the name itself.
    const read = await this.#readWindow();
    if (typeof read === "string") return "unknown";
    const found = hxFindElement(read, { name: expect.name, ...(expect.role ? { role: expect.role } : {}) });
    return found.status === "found" ? "satisfied" : "unknown";
  }

  async #near(name: string): Promise<string[]> {
    this.#read = null;
    const read = await this.#readWindow();
    if (typeof read === "string") return [];
    const found = hxFindElement(read, { name });
    return found.status === "found" ? [hxCandidateLine(found.element)] : found.candidates.map(hxCandidateLine);
  }
}
