// HXBot 电脑操控（二）：打开应用后一步步操作的三个工具（v1.6.7）。
//
//   computer_plan  the agent shows the steps it planned from the user's words: a progress card in the
//                  chat, with a ring and "done/all", that the next calls update in place.
//   computer_look  a short outline of a window: the elements to act on or read, with their index.
//   computer_do    several steps on one window, each checked; a step that names its plan step marks
//                  it done (or not done) on the card.
//
// They sit in the tool catalog, not in every request: the instructions name them, and the agent
// calls them through tool_call. Like computer_open, they follow the agent's Computer Use setting.
import type { HxProgressCard, HxProgressState } from "@hxbot/contracts/hx-progress";
import { sourceText } from "@hxbot/i18n";
import { z } from "zod";
import type { DynamicToolCallParams, DynamicToolResult } from "../protocol";
import type { HxDriverPort } from "./driver";
import type { HxClipboardKeep, HxFrontWatch } from "./front";
import type { HxTarget } from "./outline";
import { type HxRunResult, type HxStep, HxStepRun, type HxWindowChoice } from "./steps";
import type { HxComputerAllowed } from "./tools";

const COMPUTER_PLAN_TOOL = "computer_plan";
const COMPUTER_LOOK_TOOL = "computer_look";
const COMPUTER_DO_TOOL = "computer_do";
export const HX_COMPUTER_STEP_TOOL_NAMES: ReadonlySet<string> = new Set([
  COMPUTER_PLAN_TOOL,
  COMPUTER_LOOK_TOOL,
  COMPUTER_DO_TOOL,
]);

const line = (max: number) => z.string().trim().min(1).max(max);
const point = z.strictObject({ x: z.number().min(0).max(20000), y: z.number().min(0).max(20000) });
const target = z.strictObject({
  name: z
    .union([line(120), z.array(line(120)).min(1).max(4)])
    .optional()
    .describe('The label as seen, or several forms such as ["导出", "Export"].'),
  role: line(40).optional().describe("button, field, check, radio, menu, tab, link, row, slider, text."),
  index: z.number().int().min(0).optional().describe("An index from computer_look of the same window."),
});
const WINDOW_SHAPE = {
  app: line(80).optional().describe("The app's name. Omit for the front window."),
  title: line(120).optional().describe("Part of the window title."),
  window_id: z.number().int().min(0).optional(),
};

const STEP = z.strictObject({
  act: z.enum(["click", "double_click", "right_click", "type", "key", "hotkey", "scroll", "drag", "menu", "wait"]),
  plan_step: z.number().int().min(1).max(12).optional().describe("The number of the computer_plan step this does."),
  target: target.optional(),
  at: point.optional().describe("Window pixels from a screenshot, only when no element fits."),
  text: z.string().min(1).max(4000).optional(),
  key: line(30).optional().describe("Such as return, escape, tab, a, f5."),
  modifiers: z
    .array(z.enum(["cmd", "ctrl", "alt", "option", "shift", "win", "fn"]))
    .max(4)
    .optional(),
  keys: z.array(line(30)).min(1).max(5).optional().describe('A chord for hotkey, such as ["cmd", "s"].'),
  direction: z.enum(["up", "down", "left", "right"]).optional(),
  amount: z.number().int().min(1).max(50).optional(),
  to: target.optional(),
  to_at: point.optional(),
  path: z
    .array(line(80))
    .min(1)
    .max(8)
    .optional()
    .describe('Menu labels from the menu bar, such as ["文件", "导出为 PDF…"].'),
  seconds: z.number().min(0.1).max(10).optional(),
  expect: z
    .strictObject({ name: line(120), role: line(40).optional(), value: z.string().max(400).optional() })
    .optional()
    .describe("What must be in the window after the step."),
  confirmed: z
    .boolean()
    .optional()
    .describe("Only after the user said yes in the chat to this send, payment, purchase or deletion."),
});

const PLAN_SHAPE = {
  app: line(80).optional(),
  steps: z.array(line(120)).min(1).max(12).describe("The steps in the user's language."),
};
const LOOK_SHAPE = { ...WINDOW_SHAPE, query: line(80).optional().describe("Only elements about this.") };
const DO_SHAPE = { ...WINDOW_SHAPE, steps: z.array(STEP).min(1).max(12) };

export const HX_COMPUTER_STEP_TOOL_DEFINITIONS = [
  {
    name: COMPUTER_PLAN_TOOL,
    description:
      "Before you operate an app for the user, show the steps you planned, one short line each, in the user's language, as a progress card. Then do them with computer_do and plan_step.",
    shape: PLAN_SHAPE,
  },
  {
    name: COMPUTER_LOOK_TOOL,
    description:
      "Read a window of the computer that runs this HXBot as a short outline: one line per element you can act on or read, with its index, kind, label and value. No screenshot.",
    shape: LOOK_SHAPE,
  },
  {
    name: COMPUTER_DO_TOOL,
    description:
      "Do up to 12 steps on one window: click, type, keys, scroll, drag, menu, wait. Name elements by label and kind as in computer_look, not by position. Each step is checked; the run stops at the first step that does not work and says why. A send, payment, purchase or deletion stops with status confirm.",
    shape: DO_SHAPE,
  },
];

/** Whether a step tool acts through the driver; computer_plan only shows a card. */
export function hxStepToolNeedsDriver(tool: string): boolean {
  return tool === COMPUTER_LOOK_TOOL || tool === COMPUTER_DO_TOOL;
}

/** What the step tools need from the rest of HXBot. */
export interface HxStepToolDeps {
  allowed: HxComputerAllowed;
  driver: HxDriverPort | null;
  stopped: () => boolean;
  /** HXBot (v1.7.0): which app gets the keys, and letting go of the modifiers. */
  front?: HxFrontWatch | null;
  /** HXBot (v1.7.0): keeps the user's clipboard around typed text. */
  clipboard?: HxClipboardKeep | null;
  /** The agent's plan card: the last one it showed, and a new or updated one. */
  plan: { get: () => HxComputerPlan | null; set: (plan: HxComputerPlan, stopped: boolean) => void };
  /** The new id of a card. */
  newId: () => string;
  /** The keys that stop the work, as this computer names them. */
  stopKeys: string;
  /** One line for the activity record. */
  record: (detail: string) => void;
}

/** The plan card of an agent's work on this computer. */
export interface HxComputerPlan {
  id: string;
  app: string;
  keys: string;
  steps: Array<{ text: string; state: HxProgressState }>;
}

/** The card of a plan: the header in source text, and the steps. */
export function hxComputerPlanCard(plan: HxComputerPlan): HxProgressCard {
  return {
    title: sourceText("status.agent.hxComputer.plan", { app: plan.app, keys: plan.keys }),
    steps: plan.steps.map((step) => ({ text: step.text, state: step.state })),
  };
}

/** The plan after a run: the steps it did are done, the one it stopped at is not, the next one runs. */
export function hxPlanAfterRun(plan: HxComputerPlan, done: readonly number[], failed: number | null): HxComputerPlan {
  const steps = plan.steps.map((step, index) => {
    const n = index + 1;
    if (done.includes(n)) return { ...step, state: "done" as const };
    if (failed === n) return { ...step, state: "failed" as const };
    return step.state === "active" ? { ...step, state: "pending" as const } : step;
  });
  const next = steps.findIndex((step) => step.state === "pending");
  const running = failed === null && next >= 0 ? next : -1;
  return {
    ...plan,
    steps: steps.map((step, index) => (index === running ? { ...step, state: "active" as const } : step)),
  };
}

/** Everything the three tools answer. */
type HxStepAnswer =
  | (HxRunResult & { next?: string; outline?: string })
  | { status: "shown"; steps: number }
  | { status: "window"; outline: string }
  | { status: HxRunResult["status"] | "refused" | "invalid"; reason: string };

function answer(value: HxStepAnswer, success = true): DynamicToolResult {
  return { success, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

const REFUSALS: Readonly<Record<Exclude<HxComputerAllowed, "yes">, string>> = {
  off: "Computer Use is off for this agent. The user turns it on in the agent's settings.",
  task: "A task runs without Computer Use: only your own chat uses the screen of this computer. Say so, so that the user can continue this step in your own chat.",
};

function choice(input: {
  app?: string | undefined;
  title?: string | undefined;
  window_id?: number | undefined;
}): HxWindowChoice {
  return {
    ...(input.app === undefined ? {} : { app: input.app }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.window_id === undefined ? {} : { windowId: input.window_id }),
  };
}

function cleanTarget(value: z.infer<typeof target> | undefined): HxTarget | undefined {
  if (!value) return undefined;
  return {
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.role === undefined ? {} : { role: value.role }),
    ...(value.index === undefined ? {} : { index: value.index }),
  };
}

function step(input: z.infer<typeof STEP>): HxStep {
  const out: HxStep = { act: input.act };
  const aimed = cleanTarget(input.target);
  if (aimed) out.target = aimed;
  const to = cleanTarget(input.to);
  if (to) out.to = to;
  if (input.at) out.at = input.at;
  if (input.to_at) out.toAt = input.to_at;
  if (input.text !== undefined) out.text = input.text;
  if (input.key !== undefined) out.key = input.key;
  if (input.modifiers) out.modifiers = input.modifiers;
  if (input.keys) out.keys = input.keys;
  if (input.direction) out.direction = input.direction;
  if (input.amount !== undefined) out.amount = input.amount;
  if (input.path) out.path = input.path;
  if (input.seconds !== undefined) out.seconds = input.seconds;
  if (input.expect) {
    out.expect = {
      name: input.expect.name,
      ...(input.expect.role === undefined ? {} : { role: input.expect.role }),
      ...(input.expect.value === undefined ? {} : { value: input.expect.value }),
    };
  }
  if (input.confirmed !== undefined) out.confirmed = input.confirmed;
  return out;
}

const WHY: Readonly<Record<Exclude<HxRunResult["status"], "done">, string>> = {
  failed: "A step did not work. Read stoppedAt, look at the window if needed, and try another way.",
  unsure: "HXBot could not check a step. Look at the window before you go on.",
  confirm: "Ask the user in the chat. After a yes, run the remaining steps again with confirmed true on that step.",
  stopped: "The user stopped the work on the computer. Do not go on; say what was done and wait.",
  no_window: "No such window is open. Open the app with computer_open, or name the window by app or title.",
  no_driver: "Computer Use is not running. The user turns it on in Settings → Computer Use.",
};

/** Runs one of the three tools. It never rejects. */
export async function hxComputerStepToolCall(
  deps: HxStepToolDeps,
  params: Pick<DynamicToolCallParams, "tool" | "arguments">,
): Promise<DynamicToolResult> {
  if (deps.allowed !== "yes") return answer({ status: "refused", reason: REFUSALS[deps.allowed] }, false);
  try {
    if (params.tool === COMPUTER_PLAN_TOOL) {
      const input = z.strictObject(PLAN_SHAPE).safeParse(params.arguments);
      if (!input.success) return answer({ status: "invalid", reason: "Give steps: 1 to 12 short lines." }, false);
      const { app, steps } = input.data;
      const plan: HxComputerPlan = {
        id: deps.newId(),
        app: app ?? "—",
        keys: deps.stopKeys,
        steps: steps.map((text, index) => ({ text, state: index === 0 ? "active" : "pending" })),
      };
      deps.plan.set(plan, false);
      return answer({ status: "shown", steps: steps.length });
    }
    if (!deps.driver) {
      return answer({ status: "no_driver", reason: WHY.no_driver }, false);
    }
    if (params.tool === COMPUTER_LOOK_TOOL) {
      const input = z.strictObject(LOOK_SHAPE).safeParse(params.arguments);
      if (!input.success)
        return answer({ status: "invalid", reason: "Give app, title or window_id, and optionally query." }, false);
      const run = new HxStepRun({
        driver: deps.driver,
        stopped: deps.stopped,
        front: deps.front ?? null,
        clipboard: deps.clipboard ?? null,
      });
      const opened = await run.open(choice(input.data));
      if (opened) return answer({ status: opened, reason: WHY[opened] }, false);
      const seen = await run.look(input.data.query);
      if ("error" in seen) return answer({ status: "failed", reason: seen.error }, false);
      return answer({ status: "window", outline: seen.outline });
    }
    if (params.tool === COMPUTER_DO_TOOL) {
      const input = z.strictObject(DO_SHAPE).safeParse(params.arguments);
      if (!input.success) {
        const issue = input.error.issues[0];
        return answer(
          {
            status: "invalid",
            reason: `Check the steps${issue ? ` (${issue.path.join(".")}: ${issue.message})` : ""}.`,
          },
          false,
        );
      }
      if (deps.stopped()) return answer({ status: "stopped", reason: WHY.stopped }, false);
      const run = new HxStepRun({
        driver: deps.driver,
        stopped: deps.stopped,
        front: deps.front ?? null,
        clipboard: deps.clipboard ?? null,
      });
      const opened = await run.open(choice(input.data));
      if (opened) return answer({ status: opened, reason: WHY[opened] }, false);
      const planSteps = input.data.steps.map((entry) => entry.plan_step);
      const result = await run.run(input.data.steps.map(step));
      const plan = deps.plan.get();
      if (plan) {
        const done = result.steps.flatMap((entry) => {
          const n = planSteps[entry.n - 1];
          return n === undefined ? [] : [n];
        });
        const failedAt =
          result.stoppedAt && result.status !== "confirm" ? planSteps[result.stoppedAt.n - 1] : undefined;
        const next = hxPlanAfterRun(plan, done, failedAt ?? null);
        if (JSON.stringify(next) !== JSON.stringify(plan) || result.status === "stopped") {
          deps.plan.set(next, result.status === "stopped");
        }
      }
      if (result.window) {
        deps.record(
          `computer_do ${result.window.app}: ${result.steps.length}/${input.data.steps.length}`.slice(0, 300),
        );
      }
      if (result.status === "done") return answer(result);
      const outline = result.status === "failed" || result.status === "unsure" ? await run.look(undefined, 1500) : null;
      return answer(
        {
          ...result,
          next: WHY[result.status],
          ...(outline && "outline" in outline ? { outline: outline.outline } : {}),
        },
        result.status === "confirm",
      );
    }
    return answer({ status: "invalid", reason: "This is not a computer step tool." }, false);
  } catch (error) {
    return answer(
      { status: "failed", reason: error instanceof Error ? error.message.slice(0, 300) : "It did not work." },
      false,
    );
  }
}
