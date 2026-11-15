// HXBot 电脑操控：运行一条系统命令。不经过命令行解释器（参数原样传给程序），有时限，有输出上限。
// 目录、打开、读写设置都通过这里，测试时换成替身。
import { execFile } from "node:child_process";
import { constants, setPriority } from "node:os";

export interface HxRunResult {
  /** The exit code; null when the command did not start or was stopped. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** The program is not on this computer. */
  missing: boolean;
}

interface HxRunOptions {
  timeoutMs?: number;
  /** Added to the environment of the command. A value that the command must not parse goes here, never into its text. */
  env?: Readonly<Record<string, string>>;
  /**
   * HXBot (v1.7.0, F7): work that nobody waits for (the catalog read) runs at the lowest priority,
   * so the user's apps keep the processor and the fans stay quiet. The programs it starts inherit it.
   */
  background?: boolean;
}

export type HxRunner = (command: string, args: readonly string[], options?: HxRunOptions) => Promise<HxRunResult>;

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
/**
 * How long the output may stay open after the command ended. A program that the command started (a
 * window such as Notepad, a server) can keep the output open until it ends: on Windows,
 * `cmd /c start notepad` never gave a result (GitHub, 2026-11-14). After this time the end of the
 * command itself counts, with the output read so far.
 */
const EXIT_GRACE_MS = 2_000;

/** True when the command ran and ended with code 0. */
export function hxRunOk(result: HxRunResult): boolean {
  return result.code === 0 && !result.timedOut && !result.missing;
}

/** The first line a person can act on: the error text, or why there is none. */
export function hxRunFailure(command: string, result: HxRunResult): string {
  if (result.missing) return `${command} is not on this computer`;
  if (result.timedOut) return `${command} did not answer in time`;
  const text = (result.stderr.trim() || result.stdout.trim()).split("\n")[0] ?? "";
  return `${command} ended with code ${result.code ?? "none"}${text ? `: ${text.slice(0, 300)}` : ""}`;
}

export const hxRun: HxRunner = (command, args, options = {}) =>
  new Promise((resolve) => {
    let grace: ReturnType<typeof setTimeout> | undefined;
    const child = execFile(
      command,
      [...args],
      {
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        encoding: "utf8",
        env: options.env ? { ...process.env, ...options.env } : process.env,
      },
      (error, stdout, stderr) => {
        clearTimeout(grace);
        if (!error) {
          resolve({ code: 0, stdout, stderr, timedOut: false, missing: false });
          return;
        }
        resolve({
          code: typeof error.code === "number" ? error.code : null,
          stdout,
          stderr,
          timedOut: error.killed === true,
          missing: error.code === "ENOENT",
        });
      },
    );
    if (options.background && child.pid !== undefined) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_LOW);
      } catch {
        // A command that already ended has no priority to set.
      }
    }
    child.once("exit", () => {
      grace = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
      }, EXIT_GRACE_MS);
      grace.unref();
    });
  });

/**
 * How long one command may take on Windows: one start of PowerShell took 22 seconds on an ARM
 * computer of GitHub, and a WMI query may wait 10 more before it gives up.
 */
export const HX_WINDOWS_COMMAND_TIMEOUT_MS = 90_000;

/** The same as hxRun, at the lowest priority (v1.7.0, F7). */
export const hxRunBackground: HxRunner = (command, args, options = {}) =>
  hxRun(command, args, { ...options, background: true });
