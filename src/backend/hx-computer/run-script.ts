// HXBot 电脑操控（四，v1.6.9）：在 HXBot 主程序里运行一段脚本，工具 computer_run。
//
// Mac：AppleScript、JXA（JavaScript for Automation）、快捷指令（shortcuts run）；Windows：Windows PowerShell 5.1，
// 用来操作 Office 等应用的接口。脚本在主程序里跑，不在助手的进程沙盒里，所以控制别的应用时 macOS 以 HXBot 的
// 名义问一次“自动化”授权（复盘 F2）。
//
// 规则和逐步操作一样：
// - 看得出会删除、发送、付款、发布、卸载、关机的脚本，要用户在对话里同意后带 confirmed 再调；
// - 要管理员权限的（with administrator privileges、sudo、RunAs）不在这里跑，交给 request_access 那条路；
// - 输出最多留 8000 个字符；脚本最多跑 2 分钟。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HxRunner, type HxRunResult, hxRunFailure, hxRunOk } from "./runner";
import { HX_POWERSHELL } from "./tables-win";

type HxScriptLanguage = "applescript" | "jxa" | "shortcut" | "powershell";

export interface HxRunInput {
  language: HxScriptLanguage;
  /** The script; for a shortcut, its name. */
  script: string;
  /** Text given to the shortcut as its input. */
  input?: string | undefined;
  confirmed?: boolean | undefined;
}

export type HxRunScriptResult =
  | { status: "ran"; language: HxScriptLanguage; output: string; truncated: boolean }
  | { status: "confirm"; reason: string }
  | { status: "refused"; reason: string }
  | { status: "needs-permission"; reason: string }
  | { status: "invalid" | "failed"; reason: string; output?: string };

export interface HxRunScriptDeps {
  run: HxRunner;
  platform: NodeJS.Platform;
  openAutomationPage: () => Promise<void>;
}

const OUTPUT_LIMIT = 8_000;
const TIMEOUT_MS = 120_000;
const MAX_SCRIPT = 20_000;

/** Words of a script that change things for good, as in the step rules (send, pay, delete...). */
const RISKY =
  /\b(delete|deleted|remove|erase|trash|empty\s+trash|send|post|publish|submit|pay|buy|purchase|checkout|transfer|uninstall|shut\s*down|restart|log\s*out|format|kill)\b|\b(Remove|Stop|Clear|Send|Format|Uninstall|Restart|Disable)-[A-Z]/iu;
const RISKY_CJK = /删除|发送|付款|支付|购买|转账|发布|卸载|关机|清空|废纸篓/u;
const ADMIN = /with\s+administrator\s+privileges|\bsudo\b|-Verb\s+RunAs|Start-Process[^\n;]*RunAs/iu;

/** Whether a script or a shortcut name reads as one that sends, pays, deletes or publishes. */
export function hxRiskyScript(text: string): boolean {
  return RISKY.test(text) || RISKY_CJK.test(text);
}

function trim(text: string): { text: string; truncated: boolean } {
  const clean = text.replace(/\s+$/u, "");
  return clean.length > OUTPUT_LIMIT
    ? { text: `${clean.slice(0, OUTPUT_LIMIT)}…`, truncated: true }
    : { text: clean, truncated: false };
}

function automationRefused(result: HxRunResult): boolean {
  return /-1743|Not authorized to send Apple events/iu.test(`${result.stderr}\n${result.stdout}`);
}

/** A script that sends Apple events to another app: the first time, macOS asks the user whether HXBot may. */
const CONTROLS_APP = /\btell\s+application\b|\bApplication\s*\(/iu;

/** One call of computer_run. It never rejects: every problem is an answer the model can read. */
export async function hxRunScript(deps: HxRunScriptDeps, input: HxRunInput): Promise<HxRunScriptResult> {
  const script = input.script;
  if (!script.trim() || script.length > MAX_SCRIPT)
    return { status: "invalid", reason: `Give script: 1 to ${MAX_SCRIPT} characters (for a shortcut, its name).` };
  const mac = deps.platform === "darwin";
  if (input.language === "powershell" ? deps.platform !== "win32" : !mac)
    return {
      status: "invalid",
      reason: mac
        ? "This is a Mac: use applescript, jxa or shortcut."
        : deps.platform === "win32"
          ? "This is Windows: use powershell."
          : "Scripts run on macOS and Windows only.",
    };
  if (ADMIN.test(script))
    return {
      status: "refused",
      reason:
        "This script needs administrator rights, which computer_run does not use. Run the command with your own shell, so that HXBot asks the user through request_access, or tell the user what to run.",
    };
  if (hxRiskyScript(`${script}\n${input.input ?? ""}`) && !input.confirmed)
    return {
      status: "confirm",
      reason:
        "This script may send, pay, buy, delete or publish. Ask the user in the chat first and say what it does; after a yes, call again with confirmed true.",
    };
  const folder = await mkdtemp(join(tmpdir(), "hxbot-run-"));
  try {
    let result: HxRunResult;
    if (input.language === "shortcut") {
      const args = ["run", script.trim()];
      if (input.input !== undefined) {
        const file = join(folder, "input.txt");
        await writeFile(file, input.input, "utf8");
        args.push("--input-path", file);
      }
      args.push("--output-path", join(folder, "output.txt"));
      result = await deps.run("/usr/bin/shortcuts", args, { timeoutMs: TIMEOUT_MS });
      if (hxRunOk(result)) {
        const output = await readFile(join(folder, "output.txt"), "utf8").catch(() => "");
        result = { ...result, stdout: output || result.stdout };
      }
    } else if (input.language === "powershell") {
      const text = `$ProgressPreference = 'SilentlyContinue'; try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }; ${script}`;
      result = await deps.run(
        HX_POWERSHELL,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          Buffer.from(text, "utf16le").toString("base64"),
        ],
        { timeoutMs: TIMEOUT_MS },
      );
    } else {
      // A file, not -e: a script of many lines arrives as it is.
      const file = join(folder, input.language === "jxa" ? "script.js" : "script.applescript");
      await writeFile(file, script, "utf8");
      result = await deps.run(
        "/usr/bin/osascript",
        ["-l", input.language === "jxa" ? "JavaScript" : "AppleScript", file],
        { timeoutMs: TIMEOUT_MS },
      );
    }
    if (mac && automationRefused(result)) {
      await deps.openAutomationPage().catch(() => undefined);
      return {
        status: "needs-permission",
        reason:
          "macOS did not let HXBot control that app (Automation). HXBot opened the Automation page of System Settings (or, when the user works in another app, a notification that opens it): tell the user to turn on the app under HXBot there, then run the script again.",
      };
    }
    // GitHub's Macs, 2026-11-14: with nobody to answer macOS's question, the script waited until its time ran out.
    if (mac && result.timedOut && CONTROLS_APP.test(script))
      return {
        status: "needs-permission",
        reason:
          "macOS did not answer in time: it most likely asks the user whether HXBot may control that app. Tell the user to click OK (Allow) in that dialog, then run the script again.",
      };
    if (!hxRunOk(result)) {
      const { text } = trim(result.stdout);
      return {
        status: "failed",
        reason: hxRunFailure(input.language, result),
        ...(text ? { output: text } : {}),
      };
    }
    const { text, truncated } = trim(result.stdout);
    return { status: "ran", language: input.language, output: text, truncated };
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}
