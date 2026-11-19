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
//
// HXBot 电脑操控（五）（v1.7.3）：
//  - 每一步前台操作之前过 gate.ts 的门（分道、你在不在用、最前面是不是那个窗口）；拿不到就停放或答复“忙”。
//  - 往输入框里填字，能直接赋值的先直接赋值（不用键盘、不碰剪贴板，在后台），读回一致才算数；读回不一致标“待核实”，
//    不再用键盘重打一遍（可能重复）。
//  - 每一步的核对分三种：已核对（读回看得见）、未核对（没有读回的办法）、待核实（读回不一致或说不清）。待核实的一步
//    之后不再往下做，答复里请助手先问你。
//  - 等一个控件或一段文字出现，最多等 10 秒，没等到就报“没等到”，不当成完成。
//  - 用提纲里的编号指控件时，编号处的控件得和提纲里的一样（类型、名字），窗口变了就不做。
//  - 打字前后核对剪贴板：剪贴板上正是刚打的字（驱动借了剪贴板）才放回你原来的；是别的内容，那是你刚复制的，不动它。
//  - 驱动“拒绝”的答复（isError）不再当成可能做成了。
import type { DynamicRecord } from "@hxbot/contracts/runtime-values";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import type { HxDriverAnswer, HxDriverPort } from "./driver";
import type { HxClipboardKeep, HxFrontWatch } from "./front";
import type { HxGateStop, HxGateWhy, HxStepGate } from "./gate";
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
/** HXBot (v1.7.3, CU-06): the longest a wait step waits for what it expects. */
const HX_WAIT_MAX_MS = 10_000;
/** HXBot (v1.7.3, CU-06): the time a value set directly takes to show in the window. */
const HX_VALUE_READBACK_MS = 200;
/** HXBot (v1.7.3): the pause after text inserted through accessibility, before the next input. */
const HX_INSERT_SETTLE_MS = 250;
/**
 * HXBot (v1.7.3): the long side of the screenshots of computer_look and of the pixel steps. The driver
 * takes window pixels only from a read with a screenshot on the same connection, in that read's scale
 * (macOS, found by the real check of v1.7.3), so both use the same size.
 */
const HX_SHOT_EDGE = 1600;

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
  /**
   * HXBot (v1.7.3): how `type` puts the text in a field. `value` sets the field's whole text at once
   * (what was in it goes); `keys` types at the cursor. Absent: `value` for an empty one-line field
   * whose text HXBot can read back, `keys` otherwise.
   */
  by?: "value" | "keys";
}

/** How a step reached the window. `value`: the text was set on the field directly (v1.7.3). */
export type HxStepRoute = "background" | "foreground" | "point" | "menu" | "keyboard" | "value" | "none";

/**
 * HXBot (v1.7.3, CU-02): what a step's readback showed. `verified`: the window shows the step's
 * effect. `unchecked`: nothing could read it back. `pending` (待核实): the readback did not agree, or
 * could not tell. Only `verified` counts as done.
 */
export type HxStepCheck = "verified" | "unchecked" | "pending";

interface HxStepDone {
  n: number;
  act: HxStepAct;
  what: string;
  route: HxStepRoute;
  check: HxStepCheck;
  /** True only when `check` is verified (kept for the readers of v1.7.2). */
  checked: boolean;
  /** What the readback showed, in short. */
  readback?: string;
}

export type HxRunStatus =
  | "done"
  | "failed"
  | "confirm"
  | "stopped"
  | "unsure"
  | "no_window"
  | "no_driver"
  | "waiting_user"
  | "busy"
  | "timed_out";

export interface HxRunResult {
  status: HxRunStatus;
  window: { app: string; title: string; windowId: number } | null;
  steps: HxStepDone[];
  /** The step that did not work, and why. */
  stoppedAt?: { n: number; act: HxStepAct; reason: string; candidates?: string[] };
  /** True when a step took the screen from the user for a moment (foreground input). */
  borrowedScreen: boolean;
  /** HXBot (v1.7.3, CU-02): how many steps of each check. */
  summary: { verified: number; unchecked: number; pending: number };
  /** HXBot (v1.7.3, CONC-06): why the run was parked, with status `waiting_user`. */
  parked?: HxGateWhy;
  /** HXBot (v1.7.3, CONC-05): the estimate of a busy answer, in ms. */
  etaMs?: number | null;
}

/** HXBot (v1.7.3, CU-02): one step in the activity record. */
export interface HxStepRecord {
  at: number;
  app: string;
  windowId: number;
  n: number;
  act: HxStepAct;
  route: HxStepRoute;
  what: string;
  check: HxStepCheck | "failed";
  readback: string;
}

/** HXBot (v1.7.3, CU-06): the elements of the last outline of a window that the agent read. */
export interface HxLookSnapshot {
  windowId: number;
  at: number;
  elements: ReadonlyMap<number, { role: string; label: string }>;
}

/** The snapshot of a window read, for the next call of the same agent. */
export function hxSnapshotOf(read: HxWindowRead, at: number): HxLookSnapshot {
  return {
    windowId: read.windowId,
    at,
    elements: new Map(read.elements.map((element) => [element.index, { role: element.role, label: element.label }])),
  };
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
  // HXBot (v1.7.3): a tool that refused (isError) did not act. Its own reason may name the next rung:
  // the published result says `escalation.target`, a refusal of the tool itself `escalation.recommended`.
  const escalated = isDynamicRecord(content.escalation)
    ? (content.escalation.target ?? content.escalation.recommended)
    : null;
  if (answer.refused) {
    const code = typeof content.code === "string" ? content.code : "";
    return {
      worked: false,
      sure: false,
      foreground: false,
      next: escalated === "foreground" ? "foreground" : escalated === "pixel" || escalated === "px" ? "pixel" : null,
      reason: (answer.text || code || "The driver refused the step.").slice(0, 240),
    };
  }
  const effect = typeof content.effect === "string" ? content.effect : "unverifiable";
  const delivery = isDynamicRecord(content.delivery) ? content.delivery.mode : null;
  const escalation = escalated;
  const error = isDynamicRecord(content.error)
    ? `${String(content.error.code ?? "")} ${String(content.error.hint ?? "")}`.trim()
    : "";
  const next =
    escalation === "foreground" ? "foreground" : escalation === "pixel" || escalation === "px" ? "pixel" : null;
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

/** Raw roles of one-line text fields: a value set on one replaces what typing into it would give. */
const ONE_LINE_FIELDS = new Set([
  "textfield",
  "searchfield",
  "combobox",
  "edit",
  "entry",
  "input",
  "textbox",
  "searchbox",
]);

function rawRole(role: string): string {
  return role
    .toLowerCase()
    .replace(/^ax/u, "")
    .replace(/[\s_-]+/gu, "");
}

const short = (value: string, max = 80): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

type StepOutcome =
  | { what: string; route: HxStepRoute; check: HxStepCheck; readback?: string; pending?: string }
  | { stop: HxRunStatus; reason: string; candidates?: string[] };

type StepStop = Extract<StepOutcome, { stop: HxRunStatus }>;

/** One run of steps on one window. */
export class HxStepRun {
  readonly #driver: HxDriverPort;
  readonly #stopped: () => boolean;
  readonly #wait: (ms: number) => Promise<void>;
  readonly #now: () => number;
  #window: WindowFact | null = null;
  /** HXBot (v1.7.3): the windows of the target app when the run found its window. */
  #known = new Set<number>();
  #read: HxWindowRead | null = null;
  /** The last window read of this run and when, for the agent's next call (CU-06). */
  #lastRead: { read: HxWindowRead; at: number } | null = null;
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
  /** HXBot (v1.7.3): the lanes and the user's presence; null runs as before (tests, the self-test). */
  #gate: HxStepGate | null;
  /** The stop of the gate that ended the run, for the answer. */
  #gateStop: HxGateStop | null = null;
  readonly #snapshot: HxLookSnapshot | null;
  readonly #record: ((entry: HxStepRecord) => void) | null;
  readonly #platform: NodeJS.Platform;
  /** HXBot (v1.7.3): why the last value set did not take, for the answer. */
  #valueWhy = "";
  /** HXBot (v1.7.3): the last read of the window had a screenshot, so window pixels work now. */
  #pixels: { width: number; height: number } | null = null;

  constructor(options: {
    driver: HxDriverPort;
    stopped: () => boolean;
    wait?: (ms: number) => Promise<void>;
    now?: () => number;
    front?: HxFrontWatch | null;
    clipboard?: HxClipboardKeep | null;
    gate?: HxStepGate | null;
    snapshot?: HxLookSnapshot | null;
    record?: ((entry: HxStepRecord) => void) | null;
    platform?: NodeJS.Platform;
  }) {
    this.#driver = options.driver;
    this.#stopped = options.stopped;
    this.#front = options.front ?? null;
    this.#clipboard = options.clipboard ?? null;
    this.#wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#now = options.now ?? Date.now;
    this.#gate = options.gate ?? null;
    this.#snapshot = options.snapshot ?? null;
    this.#record = options.record ?? null;
    this.#platform = options.platform ?? process.platform;
  }

  /** Finds the window; false when there is none. */
  async open(choice: HxWindowChoice): Promise<"no_window" | "no_driver" | null> {
    const listed = await this.#driver.call("list_windows", { on_screen_only: true }, 5_000);
    if (!listed.ok || listed.refused) return "no_driver";
    this.#window = hxChooseWindow(listed.content, choice);
    const window = this.#window;
    if (window) this.#known = new Set(hxWindowsOf(listed.content, window.pid));
    return window ? null : "no_window";
  }

  /** HXBot (v1.7.3): the gate of the call, once its app lane is held. */
  useGate(gate: HxStepGate | null): void {
    this.#gate = gate;
  }

  /** The window the run acts on, once `open` found it. */
  window(): { pid: number; windowId: number; app: string; title: string } | null {
    const window = this.#window;
    return window ? { pid: window.pid, windowId: window.windowId, app: window.app, title: window.title } : null;
  }

  /** The windows of the target app when the run started. */
  knownWindows(): ReadonlySet<number> {
    return this.#known;
  }

  /** The last window read of this run, for the agent's next call. */
  lastRead(): { read: HxWindowRead; at: number } | null {
    return this.#lastRead;
  }

  /** The outline of the window, read now. */
  async look(query?: string, maxChars = 3000): Promise<{ outline: string } | { error: string }> {
    const read = await this.#readWindow(query);
    if (typeof read === "string") return { error: read };
    return { outline: hxOutline(read, maxChars) };
  }

  /** HXBot (v1.7.3, CONC-05): a screenshot of the window, for an app whose window has no elements to read. */
  async screenshot(): Promise<
    { image: { data: string; mimeType: string }; width: number; height: number } | { error: string }
  > {
    const window = this.#window;
    if (!window) return { error: "No window." };
    const answer = await this.#driver.call(
      "get_window_state",
      {
        pid: window.pid,
        window_id: window.windowId,
        include_screenshot: true,
        include_accessibility_tree: false,
        max_image_dimension: HX_SHOT_EDGE,
      },
      15_000,
    );
    if (!answer.ok) return { error: answer.error ?? "The window could not be read." };
    if (answer.refused) return { error: short(answer.text || "The driver refused the screenshot.", 300) };
    const image = answer.images?.[0];
    if (!image) return { error: "The driver gave no screenshot. Screen Recording may be off for HXBot." };
    const content = answer.content ?? {};
    const width = typeof content.screenshot_width === "number" ? content.screenshot_width : window.width;
    const height = typeof content.screenshot_height === "number" ? content.screenshot_height : window.height;
    this.#pixels = { width, height };
    return { image, width, height };
  }

  async run(steps: readonly HxStep[]): Promise<HxRunResult> {
    try {
      return await this.#runAll(steps);
    } finally {
      // A run stopped between a key down and its key up leaves a modifier held: every shortcut of
      // every other app then goes wrong. A key up for a key that is not down does nothing.
      // HXBot (v1.7.3): the key ups are HXBot's input, not the user's (the system counts them in its
      // idle time; counted as the user's, the next front step of any agent waited 5 seconds for nothing).
      const front = this.#front;
      if (this.#keysSent && front) {
        const done = this.#gate?.ownInput();
        try {
          await front.releaseModifiers().catch(() => undefined);
        } finally {
          done?.();
        }
      }
    }
  }

  /**
   * Keys that go to the app in front go to the target app only (v1.7.0). When the user moved to
   * another app, nothing is sent, and HXBot does not take the front from the user: the step stops.
   * A look that found the target in front holds for a short time, so a row of keys asks once.
   * HXBot (v1.7.3): with the gate, the gate looks at the front window before each step instead.
   */
  async #keysGoToTarget(): Promise<string | null> {
    const window = this.#window;
    const front = this.#front;
    if (this.#gate || !this.#keysToFront || !window || !front) return null;
    if (this.#now() - this.#frontSeenAt < HX_FRONT_SEEN_MS) return null;
    const now = await front.front();
    if (now === null || now.pid === window.pid || now.windowId === window.windowId) {
      if (now !== null) this.#frontSeenAt = this.#now();
      return null;
    }
    // v1.7.1 (CONC-12): the member learns that the screen is in use, and does other work first.
    return `The user works in another app now, so HXBot did not send the keys there and did not take the front from the user. The screen is in use: first do the parts of the work that do not need the screen. Ask the user to go back to ${window.app} or to say when, then run the steps again.`;
  }

  /** HXBot (v1.7.3): the gate before an input that reaches the front of the screen. */
  async #needFront(): Promise<StepStop | null> {
    const gate = this.#gate;
    const window = this.#window;
    if (!gate || !window) return null;
    const stop = await gate.front({ pid: window.pid, windowId: window.windowId, app: window.app, title: window.title });
    if (!stop) return null;
    this.#gateStop = stop;
    return { stop: stop.stop, reason: stop.reason };
  }

  /** A driver call that sends input: its time is HXBot's own input, not the user's. */
  async #act(tool: string, args: DynamicRecord, timeoutMs?: number): Promise<HxDriverAnswer> {
    const done = this.#gate?.ownInput();
    try {
      return await this.#driver.call(tool, args, timeoutMs);
    } finally {
      done?.();
    }
  }

  #fromGate(stop: HxGateStop): HxRunStatus {
    this.#gateStop = stop;
    return stop.stop;
  }

  async #runAll(steps: readonly HxStep[]): Promise<HxRunResult> {
    const window = this.#window;
    const done: HxStepDone[] = [];
    const finish = (status: HxRunStatus, stoppedAt?: HxRunResult["stoppedAt"]): HxRunResult => {
      const gate = this.#gateStop;
      return {
        status,
        window: window ? { app: window.app, title: window.title, windowId: window.windowId } : null,
        steps: done,
        ...(stoppedAt ? { stoppedAt } : {}),
        borrowedScreen: this.#borrowed,
        summary: {
          verified: done.filter((step) => step.check === "verified").length,
          unchecked: done.filter((step) => step.check === "unchecked").length,
          pending: done.filter((step) => step.check === "pending").length,
        },
        ...(status === "waiting_user" && gate?.stop === "waiting_user" ? { parked: gate.why } : {}),
        ...(status === "busy" && gate?.stop === "busy" ? { etaMs: gate.etaMs } : {}),
      };
    };
    if (!window) return finish("no_window");
    for (const [i, step] of steps.entries()) {
      const n = i + 1;
      if (this.#stopped())
        return finish("stopped", { n, act: step.act, reason: "The user stopped the work on the computer." });
      const held = this.#gate?.check() ?? null;
      if (held) return finish(this.#fromGate(held), { n, act: step.act, reason: held.reason });
      const outcome = await this.#step(step);
      // The focus goes after each step, whatever came of it (CONC-05).
      const yielded = this.#gate?.after() ?? null;
      if ("stop" in outcome) {
        this.#note(n, step, "none", "", "failed", outcome.reason);
        return finish(outcome.stop, {
          n,
          act: step.act,
          reason: outcome.reason,
          ...(outcome.candidates ? { candidates: outcome.candidates } : {}),
        });
      }
      let { check } = outcome;
      let readback = outcome.readback ?? "";
      let pending = outcome.pending ?? null;
      let candidates: string[] | undefined;
      if (pending === null && step.expect && step.act !== "wait") {
        const verdict = await this.#verify(step.expect, 4000);
        if (verdict.status === "unsatisfied") {
          // The step ran, but the window does not show what it expects: it is the step that stopped the run.
          this.#note(n, step, outcome.route, outcome.what, "failed", verdict.detail);
          return finish("failed", {
            n,
            act: step.act,
            reason: `After the step, ${JSON.stringify(step.expect.name)} is not in the window.`,
            candidates: await this.#near(step.expect.name),
          });
        }
        readback = verdict.detail;
        if (verdict.status === "satisfied") check = "verified";
        else {
          pending = `HXBot could not tell whether ${JSON.stringify(step.expect.name)}${step.expect.value === undefined ? "" : ` shows ${JSON.stringify(step.expect.value)}`} is in the window (${verdict.detail}).`;
          candidates = await this.#near(step.expect.name);
        }
      }
      if (pending !== null) check = "pending";
      done.push({
        n,
        act: step.act,
        what: outcome.what,
        route: outcome.route,
        check,
        checked: check === "verified",
        ...(readback ? { readback: short(readback, 160) } : {}),
      });
      this.#note(n, step, outcome.route, outcome.what, check, readback);
      // The window changed: the next step reads it again.
      this.#read = null;
      if (pending !== null) {
        // CU-02: the steps after one that is 待核实 wait for the user.
        return finish("unsure", {
          n,
          act: step.act,
          reason: `${pending} Look at the window; when it is still not clear that the step worked, ask the user in the chat before the next step. Do not repeat a step that may have sent, saved or typed something.`,
          ...(candidates?.length ? { candidates } : {}),
        });
      }
      const next = steps[i + 1];
      if (yielded && next) return finish(this.#fromGate(yielded), { n: n + 1, act: next.act, reason: yielded.reason });
    }
    return finish("done");
  }

  #note(
    n: number,
    step: HxStep,
    route: HxStepRoute,
    what: string,
    check: HxStepRecord["check"],
    readback: string,
  ): void {
    const window = this.#window;
    if (!window || !this.#record) return;
    try {
      this.#record({
        at: this.#now(),
        app: window.app,
        windowId: window.windowId,
        n,
        act: step.act,
        route,
        what: short(what, 80),
        check,
        readback: short(readback, 120),
      });
    } catch {
      // The record is not worth stopping the run for.
    }
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
    // CU-06: a window that closed or changed hands is not acted on.
    if (answer.refused) return short(`The window could not be read: ${answer.text || "the driver refused"}`, 300);
    const read = hxReadWindow(answer.content);
    if (!read) return "The driver gave no window.";
    // A read with no screenshot replaces the one with it: pixels need a new one.
    this.#pixels = null;
    if (query === undefined) this.#read = read;
    this.#lastRead = { read, at: this.#now() };
    return read;
  }

  /**
   * HXBot (v1.7.3): a read of the window with a screenshot, on this connection, so that the next
   * action may use window pixels. Its elements give the points in the screenshot's scale.
   */
  async #pixelRead(): Promise<HxWindowRead | string> {
    const window = this.#window;
    if (!window) return "No window.";
    const answer = await this.#driver.call(
      "get_window_state",
      {
        pid: window.pid,
        window_id: window.windowId,
        include_screenshot: true,
        max_image_dimension: HX_SHOT_EDGE,
        max_elements: 1500,
        timeout_ms: 2000,
      },
      15_000,
    );
    if (!answer.ok) return answer.error ?? "The window could not be read.";
    if (answer.refused)
      return short(
        `The window could not be read with a screenshot: ${answer.text || "the driver refused"}. A click at a point needs one; Screen Recording may be off for HXBot.`,
        300,
      );
    const read = hxReadWindow(answer.content);
    if (!read) return "The driver gave no window.";
    const content = answer.content ?? {};
    this.#pixels = {
      width: typeof content.screenshot_width === "number" ? content.screenshot_width : window.width,
      height: typeof content.screenshot_height === "number" ? content.screenshot_height : window.height,
    };
    this.#read = read;
    this.#lastRead = { read, at: this.#now() };
    return read;
  }

  /** The middle of an element in window pixels, from a read with a screenshot. */
  async #pixelOf(element: HxElement | null): Promise<HxPoint | string> {
    const read = await this.#pixelRead();
    if (typeof read === "string") return read;
    if (!element) {
      const size = this.#pixels;
      return size ? { x: Math.round(size.width / 2), y: Math.round(size.height / 2) } : "No window.";
    }
    const same =
      read.elements.find((item) => item.index === element.index && item.role === element.role) ??
      read.elements.find((item) => item.role === element.role && item.label === element.label);
    const frame = same?.frame;
    if (!frame) return "The element has no position to click.";
    return { x: Math.round(frame.x + frame.w / 2), y: Math.round(frame.y + frame.h / 2) };
  }

  #target(): DynamicRecord {
    const window = this.#window;
    return window ? { kind: "window", pid: window.pid, window_id: window.windowId } : {};
  }

  #keysTarget(): DynamicRecord {
    return this.#keysToFront ? FRONT : this.#target();
  }

  /** The same field in a new read of the window. */
  async #again(field: HxElement): Promise<HxElement | null | string> {
    this.#read = null;
    const read = await this.#readWindow();
    if (typeof read === "string") return read;
    return (
      read.elements.find((element) => element.index === field.index && element.role === field.role) ??
      read.elements.find((element) => element.role === field.role && element.label === field.label) ??
      null
    );
  }

  /**
   * Whether the typed text shows in the field now: true or false when the field shows a value, null
   * when it shows none (a field that hides its text, or a driver that does not read it).
   */
  async #landed(field: HxElement, text: string): Promise<boolean | null> {
    await this.#wait(300);
    const same = await this.#again(field);
    if (typeof same === "string" || !same?.value) return null;
    const tail = hxPlainName(text).slice(-24);
    return tail.length === 0 ? null : hxPlainName(same.value).includes(tail);
  }

  async #find(target: HxTarget): Promise<{ element: HxElement } | StepStop> {
    const read = await this.#readWindow();
    if (typeof read === "string") return { stop: "failed", reason: read };
    const found = hxFindElement(read, target);
    if (found.status === "found") {
      const changed = this.#indexChanged(target, found.element);
      if (changed) return { stop: "failed", reason: changed };
      return { element: found.element };
    }
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

  /**
   * HXBot (v1.7.3, CU-06): an element named by its index acts only while the element at that index
   * is the one the outline showed. A window that changed since, or an outline of another window, is
   * not acted on.
   */
  #indexChanged(target: HxTarget, element: HxElement): string | null {
    if (target.index === undefined) return null;
    const window = this.#window;
    const snapshot = this.#snapshot;
    // An index from this run's own reads (the candidates of a failed step) is current.
    if (!snapshot || !window || snapshot.windowId !== window.windowId)
      return "This index is from no outline of this window that HXBot knows. Look at the window with computer_look, or name the element by label and kind.";
    const seen = snapshot.elements.get(target.index);
    if (!seen || seen.role !== element.role || seen.label !== element.label)
      return `The window changed since the outline: index ${target.index} is now ${JSON.stringify(describe(element))}. Look at the window again, or name the element by label and kind.`;
    return null;
  }

  /** A click on an element or a point, up the ladder. */
  async #click(
    element: HxElement | null,
    at: HxPoint | null,
    extra: DynamicRecord,
    /** Typing goes to the app in front, so a field to type in is clicked in the foreground at once. */
    modes: readonly ("background" | "foreground")[] = ["background", "foreground"],
  ): Promise<{ route: HxStepRoute; sure: boolean } | { reason: string } | StepStop> {
    const target = this.#target();
    if (element?.token) {
      for (const mode of modes) {
        if (mode === "foreground") {
          const blocked = await this.#needFront();
          if (blocked) return blocked;
        }
        const answer = await this.#act("click", {
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
    if (!at && !element?.frame) return { reason: "The element has no position to click." };
    // Window pixels need a read with a screenshot first (v1.7.3); a point the agent chose comes from
    // the screenshot of computer_look, in the same scale.
    let point: HxPoint;
    if (at) {
      const read = this.#pixels ? null : await this.#pixelRead();
      if (typeof read === "string") return { reason: read };
      point = at;
    } else {
      const found = await this.#pixelOf(element);
      if (typeof found === "string") return { reason: found };
      point = found;
    }
    let reason = "The click did not happen.";
    for (const mode of modes) {
      if (mode === "foreground") {
        const blocked = await this.#needFront();
        if (blocked) return blocked;
      }
      const answer = await this.#act("click", {
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

  /** A point in window pixels, with a read with a screenshot behind it (v1.7.3). */
  async #pointOf(target: HxTarget | undefined, at: HxPoint | undefined): Promise<HxPoint | StepStop> {
    if (at) {
      const read = this.#pixels ? null : await this.#pixelRead();
      return typeof read === "string" ? { stop: "failed", reason: read } : at;
    }
    let element: HxElement | null = null;
    if (target) {
      const found = await this.#find(target);
      if ("stop" in found) return found;
      element = found.element;
    }
    const point = await this.#pixelOf(element);
    return typeof point === "string" ? { stop: "failed", reason: point } : point;
  }

  /**
   * HXBot (v1.7.3, CU-06): the text set on the field directly, in the background, and read back.
   * Null when the field does not take it that way and the text should be typed: nothing changed then.
   */
  async #setValue(field: HxElement, text: string, by: HxStep["by"]): Promise<StepOutcome | null> {
    const window = this.#window;
    if (!window || !field.token || by === "keys") return null;
    const kind = rawRole(field.role);
    if (kind.includes("secure") || kind.includes("password")) return null;
    // Typing goes in at the cursor; a value replaces the field. Only an empty one-line field whose
    // text HXBot reads gives the same either way.
    if (by !== "value" && !(ONE_LINE_FIELDS.has(kind) && field.value === "" && field.hasValue === true)) return null;
    const answer = await this.#act("set_value", { pid: window.pid, element_token: field.token, value: text });
    const effect = actionEffect(answer);
    if (!effect.worked) {
      this.#valueWhy = `the driver refused it: ${effect.reason || "no reason"}`;
      return null;
    }
    await this.#wait(HX_VALUE_READBACK_MS);
    const same = await this.#again(field);
    const label = describe(field);
    const what = `${label ? `${label}: ` : ""}${text.length} characters`;
    if (typeof same === "string" || same === null)
      return {
        what,
        route: "value",
        check: "pending",
        readback: typeof same === "string" ? same : "the field is not in the window any more",
        pending: "HXBot set the text on the field, but could not find the field again to read it back.",
      };
    if (hxPlainName(same.value) === hxPlainName(text) && same.value.trim() === text.trim())
      return {
        what,
        route: "value",
        check: "verified",
        readback: `the field shows ${JSON.stringify(short(same.value))}`,
      };
    // Nothing changed: the field did not take a value this way, so the text is typed.
    if (same.value === field.value) {
      this.#valueWhy = `the field still shows ${JSON.stringify(short(same.value))} after it`;
      return null;
    }
    return {
      what,
      route: "value",
      check: "pending",
      readback: `the field shows ${JSON.stringify(short(same.value))}`,
      pending: `HXBot set the text on the field, but it shows ${JSON.stringify(short(same.value))}.`,
    };
  }

  /**
   * HXBot (v1.7.3): macOS inserts the text into the element through accessibility (`type_text` with the
   * element), in the background. Null when the driver refused it: nothing went in, and the text is typed.
   */
  async #insert(field: HxElement, text: string, label: string): Promise<StepOutcome | null> {
    if (!field.token) return null;
    const answer = await this.#act(
      "type_text",
      { target: this.#target(), element_token: field.token, text, delivery_mode: "background" },
      30_000,
    );
    const effect = actionEffect(answer);
    if (!effect.worked) return null;
    // The app takes the inserted text into its document in its own time: a save key at once left
    // TextEdit on macOS 26 unsaved once (real check of v1.7.3), so the next key waits a moment.
    await this.#wait(HX_INSERT_SETTLE_MS);
    // The keys of the next steps go to the front, where the gate (or the front watch) checks the window.
    this.#keysToFront = true;
    const what = `${label ? `${label}: ` : ""}${text.length} characters`;
    if (effect.sure)
      return { what, route: "background", check: "verified", readback: "the driver read the field back" };
    const landed = await this.#landed(field, text);
    if (landed === true) return { what, route: "background", check: "verified", readback: "the field shows the text" };
    if (landed === null) return { what, route: "background", check: "unchecked" };
    return {
      what,
      route: "background",
      check: "pending",
      readback: "the field does not show the end of the text",
      pending: "The text was sent to the field, but the field does not show it.",
    };
  }

  async #step(step: HxStep): Promise<StepOutcome> {
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
        if ("stop" in clicked) return clicked;
        if ("reason" in clicked) return { stop: "failed", reason: clicked.reason };
        return {
          what: element ? describe(element) : `${step.at?.x},${step.at?.y}`,
          route: clicked.route,
          check: clicked.sure ? "verified" : "unchecked",
        };
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
          // CU-06: a value set on the field first, with no keys and no clipboard.
          const direct = await this.#setValue(found.element, step.text, step.by);
          if (direct) return direct;
          if (step.by === "value")
            return {
              stop: "failed",
              reason: `This field does not take its text as a value (${this.#valueWhy || "it is not a text field"}). Type it with by keys.`,
            };
          // macOS (v1.7.3): the text goes into this field at its cursor through accessibility, with no key
          // and no front. A click on a text area there is refused (it has no press), and a click at its
          // point needs a screenshot, which needs Screen Recording.
          if (this.#platform === "darwin") {
            const inserted = await this.#insert(found.element, step.text, label);
            if (inserted) return inserted;
          }
          // Typing goes to the app in front, so the field is clicked first, in the foreground.
          const focused = await this.#click(found.element, null, {}, ["foreground"]);
          if ("stop" in focused) return focused;
          if ("reason" in focused) return { stop: "failed", reason: focused.reason };
          route = focused.route;
          if (route === "foreground" || route === "point") this.#keysToFront = true;
        } else {
          const blocked = await this.#needFront();
          if (blocked) return blocked;
        }
        const elsewhere = await this.#keysGoToTarget();
        if (elsewhere) return { stop: "failed", reason: elsewhere };
        this.#keysSent = true;
        // HXBot (v1.7.0, F5): the user's copy is still on the clipboard after the text was typed.
        const restore = await this.#clipboard?.save().catch(() => null);
        try {
          const typed = actionEffect(
            await this.#act("type_text", { text: step.text, target: this.#keysTarget() }, 30_000),
          );
          if (!typed.worked) return { stop: "failed", reason: typed.reason || "The text was not typed." };
          this.#borrowed = true;
          // A field that shows its text says whether the text arrived.
          const landed = field ? await this.#landed(field, step.text) : null;
          const what = `${label ? `${label}: ` : ""}${step.text.length} characters`;
          if (landed === false)
            return {
              what,
              route,
              check: "pending",
              readback: "the field does not show the end of the text",
              pending: "The text was typed, but the field does not show it.",
            };
          return {
            what,
            route,
            check: landed === true || typed.sure ? "verified" : "unchecked",
            ...(landed === true ? { readback: "the field shows the text" } : {}),
          };
        } finally {
          await this.#putBack(restore ?? null, step.text);
        }
      }
      case "key":
      case "hotkey": {
        const keys = step.act === "hotkey" ? (step.keys ?? []) : [];
        if (step.act === "key" && !step.key) return { stop: "failed", reason: "key needs key." };
        if (step.act === "hotkey" && keys.length === 0) return { stop: "failed", reason: "hotkey needs keys." };
        const blocked = await this.#needFront();
        if (blocked) return blocked;
        const away = await this.#keysGoToTarget();
        if (away) return { stop: "failed", reason: away };
        this.#keysSent = true;
        const answer =
          step.act === "key"
            ? await this.#act("press_key", {
                key: step.key ?? "",
                modifiers: step.modifiers ?? [],
                target: this.#keysTarget(),
              })
            : await this.#act("hotkey", { keys, target: this.#keysTarget() });
        const effect = actionEffect(answer);
        if (!effect.worked) return { stop: "failed", reason: effect.reason || "The key was not pressed." };
        this.#borrowed = true;
        return {
          what: step.act === "key" ? [...(step.modifiers ?? []), step.key].join("+") : keys.join("+"),
          route: "keyboard",
          check: effect.sure ? "verified" : "unchecked",
        };
      }
      case "scroll": {
        // v1.7.3: an element scrolls by its token, with no pixels; a point needs a screenshot read.
        let where: DynamicRecord;
        if (step.target && !step.at) {
          const found = await this.#find(step.target);
          if ("stop" in found) return found;
          if (found.element.token) where = { element_token: found.element.token };
          else {
            const point = await this.#pixelOf(found.element);
            if (typeof point === "string") return { stop: "failed", reason: point };
            where = { x: point.x, y: point.y };
          }
        } else {
          const point = await this.#pointOf(undefined, step.at);
          if ("stop" in point) return point;
          where = { x: point.x, y: point.y };
        }
        const blocked = await this.#needFront();
        if (blocked) return blocked;
        const answer = await this.#act("scroll", {
          ...where,
          direction: step.direction ?? "down",
          amount: step.amount ?? 3,
          target: this.#target(),
        });
        const effect = actionEffect(answer);
        if (!effect.worked) return { stop: "failed", reason: effect.reason || "The window did not scroll." };
        return {
          what: `${step.direction ?? "down"} ${step.amount ?? 3}`,
          route: effect.foreground ? "foreground" : "background",
          check: effect.sure ? "verified" : "unchecked",
        };
      }
      case "drag": {
        const from = await this.#pointOf(step.target, step.at);
        if ("stop" in from) return from;
        if (!step.to && !step.toAt) return { stop: "failed", reason: "drag needs to or toAt." };
        const to = await this.#pointOf(step.to, step.toAt);
        if ("stop" in to) return to;
        const blocked = await this.#needFront();
        if (blocked) return blocked;
        // macOS has no drag in the background: it is refused unless it asks for the front (v1.7.3).
        const answer = await this.#act("drag", {
          from_x: from.x,
          from_y: from.y,
          to_x: to.x,
          to_y: to.y,
          delivery_mode: "foreground",
          target: this.#target(),
        });
        const effect = actionEffect(answer);
        if (!effect.worked) return { stop: "failed", reason: effect.reason || "The drag did not happen." };
        this.#borrowed = true;
        return {
          what: `${from.x},${from.y} → ${to.x},${to.y}`,
          route: "foreground",
          check: effect.sure ? "verified" : "unchecked",
        };
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
        const answer = await this.#act("invoke_menu", { pid: window.pid, window_id: window.windowId, path });
        const effect = actionEffect(answer);
        if (!effect.worked) return { stop: "failed", reason: effect.reason || "The menu item was not found." };
        return { what: path.join(" › "), route: "menu", check: effect.sure ? "verified" : "unchecked" };
      }
      case "wait": {
        if (!step.expect) {
          const ms = Math.round(Math.min(Math.max(step.seconds ?? 1, 0.1), 10) * 1000);
          await this.#wait(ms);
          return { what: `${ms / 1000} s`, route: "none", check: "verified" };
        }
        // CU-06: a wait for something has a deadline, 10 seconds unless the step says less.
        const ms = Math.round(
          Math.min(Math.max(step.seconds ?? HX_WAIT_MAX_MS / 1000, 0.1), HX_WAIT_MAX_MS / 1000) * 1000,
        );
        const verdict = await this.#verify(step.expect, ms);
        const what = `${JSON.stringify(step.expect.name)} within ${ms / 1000} s`;
        if (verdict.status === "satisfied") return { what, route: "none", check: "verified", readback: verdict.detail };
        return {
          stop: "timed_out",
          reason: `没等到: HXBot waited ${ms / 1000} s and ${JSON.stringify(step.expect.name)}${step.expect.value === undefined ? "" : ` with ${JSON.stringify(step.expect.value)}`} did not show (${verdict.detail}). It is not done.`,
          candidates: await this.#near(step.expect.name),
        };
      }
    }
  }

  /**
   * HXBot (v1.7.0, F5; v1.7.3, CU-01): the user's copy goes back only when the clipboard holds the
   * text HXBot just typed, the sign that the driver borrowed it. Something else on it is a copy the
   * user made meanwhile: it stays.
   */
  async #putBack(restore: Awaited<ReturnType<HxClipboardKeep["save"]>> | null, text: string): Promise<void> {
    if (!restore) return;
    try {
      const borrowed = restore.holds ? await restore.holds(text) : await restore.changed();
      if (!borrowed) return;
      // A paste reads the clipboard a moment after the keys: wait before the user's copy goes back.
      await this.#wait(HX_CLIPBOARD_BACK_MS);
      await restore.putBack();
    } catch {
      // The clipboard is not worth stopping the run for.
    }
  }

  async #verify(
    expect: HxExpect,
    timeoutMs: number,
  ): Promise<{ status: "satisfied" | "unsatisfied" | "unknown"; detail: string }> {
    const window = this.#window;
    if (!window) return { status: "unknown", detail: "no window" };
    const selector: DynamicRecord = { label_contains: expect.name, ...(expect.role ? { role: expect.role } : {}) };
    const predicate: DynamicRecord = {
      selector,
      exists: true,
      ...(expect.value === undefined ? {} : { value_equals: expect.value }),
    };
    const answer = await this.#driver.call(
      "verify_state",
      { pid: window.pid, window_id: window.windowId, expect: [{ element: predicate }], timeout_ms: timeoutMs },
      timeoutMs + 6_000,
    );
    if (answer.ok && !answer.refused && answer.content) {
      const status = answer.content.status;
      if (status === "satisfied") return { status, detail: "the driver checked it" };
      if (status === "unsatisfied") return { status, detail: "the driver checked it is not there" };
    }
    // The driver could not tell: HXBot reads the window and looks for the name itself.
    this.#read = null;
    const read = await this.#readWindow();
    if (typeof read === "string") return { status: "unknown", detail: read };
    const found = hxFindElement(read, { name: expect.name, ...(expect.role ? { role: expect.role } : {}) });
    if (found.status !== "found")
      return { status: "unknown", detail: "the driver could not tell, and the name is not in the window" };
    if (expect.value === undefined)
      return { status: "satisfied", detail: `HXBot found ${JSON.stringify(describe(found.element))}` };
    // Only the name fits: the value must fit too (CU-06).
    if (hxPlainName(found.element.value) === hxPlainName(expect.value))
      return { status: "satisfied", detail: `${JSON.stringify(describe(found.element))} shows the value` };
    return {
      status: "unknown",
      detail: `${JSON.stringify(describe(found.element))} shows ${JSON.stringify(short(found.element.value))}`,
    };
  }

  async #near(name: string): Promise<string[]> {
    this.#read = null;
    const read = await this.#readWindow();
    if (typeof read === "string") return [];
    const found = hxFindElement(read, { name });
    return found.status === "found" ? [hxCandidateLine(found.element)] : found.candidates.map(hxCandidateLine);
  }
}

/** The windows of one app in a `list_windows` answer. */
export function hxWindowsOf(content: DynamicRecord | null, pid: number): number[] {
  return readWindows(content)
    .filter((window) => window.pid === pid)
    .map((window) => window.windowId);
}

/**
 * HXBot (v1.7.3, CONC-06): the front window of the app in front, from a `list_windows` answer: the
 * one closest to the front. Null when the driver gives no order.
 */
export function hxFrontWindowOf(content: DynamicRecord | null, pid: number): number | null {
  let best: { windowId: number; z: number } | null = null;
  for (const window of readWindows(content)) {
    if (window.pid !== pid || window.z < 0) continue;
    if (!best || window.z > best.z) best = { windowId: window.windowId, z: window.z };
  }
  return best?.windowId ?? null;
}
