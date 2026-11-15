// HXBot 电脑操控：给智能体的三个工具。computer_find 在这台电脑的目录里找；computer_open 打开应用、
// 设置页、文件夹、文档和网址；computer_set 读或改一项设置。三个都不看屏幕、不动鼠标。
// v1.6.8：computer_install 把下载好的应用装进“应用程序”文件夹（复盘 F6，install.ts）。
// v1.6.9：computer_app 管理正在运行的应用（前台、隐藏、退出、窗口、默认应用、菜单命令，app-control.ts），
// computer_run 在主程序里运行 AppleScript、JXA、快捷指令或 PowerShell（run-script.ts）。
// 助手的“Computer Use”开着才能用；结果是一段 JSON，status 说明发生了什么。
import { z } from "zod";
import type { DynamicToolCallParams, DynamicToolResult } from "../protocol";
import type { HxComputerActions, HxFindResult, HxOpenResult, HxSetResult } from "./actions";
import type { HxAppInput, HxAppResult } from "./app-control";
import type { HxInstallResult } from "./install";
import type { HxRunInput, HxRunScriptResult } from "./run-script";
import { HX_COMPUTER_STEP_TOOL_DEFINITIONS, HX_COMPUTER_STEP_TOOL_NAMES } from "./step-tools";

const COMPUTER_FIND_TOOL = "computer_find";
const COMPUTER_OPEN_TOOL = "computer_open";
const COMPUTER_SET_TOOL = "computer_set";
const COMPUTER_INSTALL_TOOL = "computer_install";
const COMPUTER_APP_TOOL = "computer_app";
const COMPUTER_RUN_TOOL = "computer_run";
/** The tools the router hands to hx-computer: these six and the step tools of v1.6.7. */
export const HX_COMPUTER_TOOL_NAMES: ReadonlySet<string> = new Set([
  COMPUTER_FIND_TOOL,
  COMPUTER_OPEN_TOOL,
  COMPUTER_SET_TOOL,
  COMPUTER_INSTALL_TOOL,
  COMPUTER_APP_TOOL,
  COMPUTER_RUN_TOOL,
  ...HX_COMPUTER_STEP_TOOL_NAMES,
]);

// These texts go to the model with every conversation (computer_open and computer_set) or with every
// tool search (computer_find), and `bun run check:agent-context` counts their bytes. Keep them short.
const id = z.string().min(1).max(600).describe("An id from a result.");
const query = z.string().min(1).max(200).describe('A name in any language, such as "蓝牙" or "dark mode".');

const FIND_SHAPE = {
  query,
  kinds: z
    .array(z.enum(["app", "page", "setting"]))
    .min(1)
    .max(3)
    .optional()
    .describe("page is a system settings page."),
  limit: z.number().int().min(1).max(20).optional(),
};
const OPEN_SHAPE = {
  id: id.optional(),
  query: query.optional(),
  path: z.string().min(1).max(1024).optional().describe("Full path of a folder or a document."),
  url: z.string().min(1).max(2000).optional().describe("An http or https address."),
};
const INSTALL_SHAPE = {
  path: z.string().min(1).max(1024).describe("Full path of a .app, .zip, .dmg or .pkg."),
  replace: z.boolean().optional().describe("Only after the user said yes to replacing the installed app."),
};
const APP_SHAPE = {
  action: z.enum(["list", "front", "hide", "quit", "window", "default", "menus", "menu"]),
  app: z.string().min(1).max(200).optional().describe("A name from list, a bundle id or a process name."),
  place: z.enum(["left", "right", "max", "next-screen"]).optional(),
  kind: z.enum(["browser", "mail", "type"]).optional().describe("For default; type needs type."),
  type: z.string().min(1).max(12).optional().describe('A file extension, such as "pdf".'),
  path: z.array(z.string().min(1).max(200)).min(2).max(3).optional().describe('Menu, item: ["File", "Save"].'),
  force: z.boolean().optional(),
  confirmed: z.boolean().optional().describe("Only after the user said yes."),
};
const RUN_SHAPE = {
  language: z.enum(["applescript", "jxa", "shortcut", "powershell"]),
  script: z.string().min(1).max(20000).describe("The script; for shortcut, its name."),
  input: z.string().max(20000).optional().describe("Input text of a shortcut."),
  confirmed: z.boolean().optional().describe("Only after the user said yes."),
};
const SET_SHAPE = {
  id: id.optional(),
  query: query.optional(),
  value: z.string().max(1024).optional().describe("on, off, a whole number or an option. Omit to read."),
};

export const HX_COMPUTER_TOOL_DEFINITIONS = [
  {
    name: COMPUTER_FIND_TOOL,
    description:
      "Find apps, system settings pages and settings of the computer that runs this HXBot (macOS, Windows) by name, in a local catalog. Each result has an id for computer_open or computer_set; a setting also has its values and whether HXBot changes it directly.",
    shape: FIND_SHAPE,
  },
  {
    name: COMPUTER_OPEN_TOOL,
    description:
      "Open an app, a system settings page, a folder, a document or a web address on the computer that runs this HXBot, with no screenshot and no click. Give exactly one of id, query, path and url. Result status: opened; candidates (call again with the id of one); not-found; refused (it does not run programs or scripts); failed.",
    shape: OPEN_SHAPE,
  },
  {
    name: COMPUTER_SET_TOOL,
    description:
      "Read or change one system setting on the computer that runs this HXBot, such as dark mode or the volume. Give id or query; add value to change it. Result status: value, changed (with the previous value) or unchanged; page (no direct command, or a security page: the settings page is now open); candidates (call again with the id of one); invalid-value; needs-permission; not-found; failed.",
    shape: SET_SHAPE,
  },
  {
    name: COMPUTER_INSTALL_TOOL,
    description:
      "Install a downloaded app into Applications on this Mac; HXBot does it, not your shell. Status: installed (version, signature, notarized); confirm (ask before replacing); running (ask to quit it); needs-permission; installer; not-found; invalid; failed.",
    shape: INSTALL_SHAPE,
  },
  {
    name: COMPUTER_APP_TOOL,
    description:
      "Control running apps from HXBot itself, not your shell: list, front, hide, quit (force only after a yes), window (left, right, max, next-screen), default (browser, mail or file type app), menus and menu (Mac menu command by path). Routes: system, script, controls. Status: apps, menus, done, default, waiting (app asks to save), confirm, confirm-dialog, page, use-steps, needs-permission, not-found, invalid, failed.",
    shape: APP_SHAPE,
  },
  {
    name: COMPUTER_RUN_TOOL,
    description:
      "Run an AppleScript, JXA or Shortcuts shortcut (Mac), or PowerShell (Windows, such as Office), in HXBot itself outside your sandbox. Scripts that send, pay, delete or publish need a yes first. Status: ran (output), confirm, refused (needs administrator), needs-permission (Automation), invalid, failed.",
    shape: RUN_SHAPE,
  },
  // v1.6.7: computer_plan, computer_look and computer_do, in the tool catalog only.
  ...HX_COMPUTER_STEP_TOOL_DEFINITIONS,
];

/** Everything a tool can answer: what the actions return, and the three answers of this file. */
type HxToolAnswer =
  | HxFindResult
  | HxOpenResult
  | HxSetResult
  | HxInstallResult
  | HxAppResult
  | HxRunScriptResult
  | { status: "refused" | "invalid" | "failed"; reason: string };

function answer(value: HxToolAnswer, success = true): DynamicToolResult {
  return { success, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

function refusal(reason: string): DynamicToolResult {
  return answer({ status: "refused", reason }, false);
}

const FAILED_STATUSES = new Set(["failed", "invalid", "refused", "unsupported"]);

/**
 * Whether the calling conversation may use the tools, as for the Computer Use tools themselves:
 * `off` when the user turned Computer Use off for the agent (or no agent is known), `task` in a task
 * of the agent, which runs without Computer Use because the agent's own chat has the screen.
 */
export type HxComputerAllowed = "yes" | "off" | "task";

/** The tools that the main process does for the agent: they run outside the agent's sandbox. */
export interface HxComputerExtras {
  install?: (input: { path: string; replace?: boolean | undefined }) => Promise<HxInstallResult>;
  app?: (input: HxAppInput) => Promise<HxAppResult>;
  run?: (input: HxRunInput) => Promise<HxRunScriptResult>;
}

const REFUSALS: Readonly<Record<Exclude<HxComputerAllowed, "yes">, string>> = {
  off: "Computer Use is off for this agent. The user turns it on in the agent's settings.",
  task: "A task runs without Computer Use: only your own chat uses the screen of this computer. Say so, so that the user can continue this step in your own chat.",
};

/**
 * Runs one of the three tools. It never rejects: every problem is an answer the model can read.
 */
export async function hxComputerToolCall(
  actions: HxComputerActions,
  allowed: HxComputerAllowed,
  params: Pick<DynamicToolCallParams, "tool" | "arguments">,
  /** Called with one line for each thing that was opened or changed, for the activity record. */
  record: (detail: string) => void = () => {},
  /** computer_install (v1.6.8), computer_app and computer_run (v1.6.9); without one, its tool says that it cannot work here. */
  extras: HxComputerExtras = {},
): Promise<DynamicToolResult> {
  const { install, app, run } = extras;
  if (allowed !== "yes") return refusal(REFUSALS[allowed]);
  try {
    if (params.tool === COMPUTER_FIND_TOOL) {
      const input = z.strictObject(FIND_SHAPE).safeParse(params.arguments);
      if (!input.success)
        return answer({ status: "invalid", reason: "Give query, and optionally kinds and limit." }, false);
      const { kinds, limit } = input.data;
      const result = await actions.find({
        query: input.data.query,
        ...(kinds ? { kinds } : {}),
        ...(limit === undefined ? {} : { limit }),
      });
      return answer(result, !FAILED_STATUSES.has(result.status));
    }
    if (params.tool === COMPUTER_OPEN_TOOL) {
      const input = z.strictObject(OPEN_SHAPE).safeParse(params.arguments);
      if (!input.success)
        return answer({ status: "invalid", reason: "Give exactly one of id, query, path and url." }, false);
      const { id: entryId, query: words, path, url } = input.data;
      const result = await actions.open({
        ...(entryId === undefined ? {} : { id: entryId }),
        ...(words === undefined ? {} : { query: words }),
        ...(path === undefined ? {} : { path }),
        ...(url === undefined ? {} : { url }),
      });
      if (result.status === "opened") {
        record(`computer_open ${"title" in result.what ? result.what.title : result.what.target}`.slice(0, 300));
      }
      return answer(result, !FAILED_STATUSES.has(result.status));
    }
    if (params.tool === COMPUTER_SET_TOOL) {
      const input = z.strictObject(SET_SHAPE).safeParse(params.arguments);
      if (!input.success)
        return answer({ status: "invalid", reason: "Give id or query, and optionally value." }, false);
      const { id: entryId, query: words, value } = input.data;
      const result = await actions.set({
        ...(entryId === undefined ? {} : { id: entryId }),
        ...(words === undefined ? {} : { query: words }),
        ...(value === undefined ? {} : { value }),
      });
      if (result.status === "changed") {
        record(`computer_set ${result.setting.title}: ${result.previous} → ${result.value}`.slice(0, 300));
      }
      return answer(result, !FAILED_STATUSES.has(result.status));
    }
    if (params.tool === COMPUTER_INSTALL_TOOL) {
      const input = z.strictObject(INSTALL_SHAPE).safeParse(params.arguments);
      if (!input.success)
        return answer({ status: "invalid", reason: "Give path, and replace only after a yes." }, false);
      if (!install) return answer({ status: "failed", reason: "Installing is not available here." }, false);
      const result = await install(input.data);
      if (result.status === "installed") {
        record(
          `computer_install ${result.app.name} ${result.app.version}${result.replaced ? ` (was ${result.replaced.version})` : ""}`,
        );
      }
      return answer(result, !FAILED_STATUSES.has(result.status));
    }
    if (params.tool === COMPUTER_APP_TOOL) {
      const input = z.strictObject(APP_SHAPE).safeParse(params.arguments);
      if (!input.success) return answer({ status: "invalid", reason: "Give action, and app for most actions." }, false);
      if (!app) return answer({ status: "failed", reason: "Apps are not controlled here." }, false);
      const result = await app(input.data);
      if (result.status === "done" && input.data.action !== "front") {
        record(`computer_app ${result.action} ${result.app}${result.detail ? `: ${result.detail}` : ""}`.slice(0, 300));
      }
      if (result.status === "default" && input.data.app) record(`computer_app default ${result.target}: ${result.app}`);
      return answer(result, !FAILED_STATUSES.has(result.status));
    }
    if (params.tool === COMPUTER_RUN_TOOL) {
      const input = z.strictObject(RUN_SHAPE).safeParse(params.arguments);
      if (!input.success) return answer({ status: "invalid", reason: "Give language and script." }, false);
      if (!run) return answer({ status: "failed", reason: "Scripts do not run here." }, false);
      const result = await run(input.data);
      if (result.status === "ran") {
        const what =
          input.data.language === "shortcut"
            ? `shortcut ${input.data.script.slice(0, 80)}`
            : `${input.data.language} (${input.data.script.length} characters)`;
        record(`computer_run ${what}`);
      }
      return answer(result, !FAILED_STATUSES.has(result.status));
    }
    return answer({ status: "invalid", reason: "This is not a computer tool." }, false);
  } catch (error) {
    return answer(
      { status: "failed", reason: error instanceof Error ? error.message.slice(0, 300) : "It did not work." },
      false,
    );
  }
}
