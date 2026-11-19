// HXBot（v1.7.2）：Windows 上 HXBot 启动的子进程默认不开控制台窗口。
//
// 用户 2026-11-18：“在windows 和mac的程序坞出现多个HXBot的图表！”“HXBot启动后，电脑文件打开存储都出先卡死现象！”
// Windows 上，一个图形界面程序（HXBot）用 Node 启动命令行程序（PowerShell、tasklist、cmd、git、各家的命令行工具）时，
// 没写 `windowsHide: true` 就会给它开一个新的控制台窗口：任务栏里多一个图标，窗口还会抢走焦点，用户正在别的应用里
// 输入文件名、点“保存”时，键盘和鼠标被抢走，看起来就是卡死。HXBot 自己的代码大多写了，但只要有一处（包括依赖库）
// 没写，就会出现。这里在主进程最早的时候把 child_process 的七个启动函数包一层：调用方没写 windowsHide 时补上 true；
// 写了的（包括特意要显示窗口的 `windowsHide: false`）原样不动。Mac、Linux 不变。

import type { ChildProcess, SpawnSyncReturns } from "node:child_process";
import { promisify } from "node:util";

/** The seven ways `child_process` starts a process. */
const HX_CHILD_STARTS = ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"] as const;
type StartName = (typeof HX_CHILD_STARTS)[number];

/** The functions that take `(command, options?, callback?)` rather than `(command, args?, options?, callback?)`. */
const NO_ARGS: ReadonlySet<StartName> = new Set(["exec", "execSync"]);

/** An options object of a start function. Only `windowsHide` is read; the other options pass unchanged. */
interface HxStartOptions {
  readonly windowsHide?: boolean | undefined;
}
type HxCallback = (...results: never[]) => void;
/** One argument of a start function of `child_process`. */
export type HxStartArgument = string | URL | readonly string[] | HxStartOptions | HxCallback | null | undefined;
type HxStartResult = ChildProcess | SpawnSyncReturns<string | Buffer> | string | Buffer;

/** The start functions of `child_process`, as the wrapper sees them. */
export interface HxChildProcessStarts {
  spawn(...args: HxStartArgument[]): HxStartResult;
  spawnSync(...args: HxStartArgument[]): HxStartResult;
  execFile(...args: HxStartArgument[]): HxStartResult;
  execFileSync(...args: HxStartArgument[]): HxStartResult;
  exec(...args: HxStartArgument[]): HxStartResult;
  execSync(...args: HxStartArgument[]): HxStartResult;
  fork(...args: HxStartArgument[]): HxStartResult;
}

const wrappedModules = new WeakSet<HxChildProcessStarts>();

function isOptions(value: HxStartArgument): value is HxStartOptions {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof URL);
}

/**
 * The arguments with `windowsHide: true` in the options, unless the caller set `windowsHide`.
 * The options object of the caller is not changed: a copy carries the default.
 */
export function hxWithHiddenWindow(name: StartName, args: readonly HxStartArgument[]): HxStartArgument[] {
  const next = [...args];
  // The options come after the command, and after the argument list when there is one. An argument
  // list given as `undefined` or `null` keeps its place: `spawn(file, undefined, options)`.
  const listGiven = Array.isArray(next[1]) || ((next[1] === undefined || next[1] === null) && next.length > 2);
  const at = NO_ARGS.has(name) ? 1 : listGiven ? 2 : 1;
  const options = next[at];
  if (isOptions(options)) {
    if (options.windowsHide === undefined) next[at] = { ...options, windowsHide: true };
    return next;
  }
  // No options (a callback, or nothing): put them in, before the callback.
  if (options === undefined && next.length <= at) {
    next[at] = { windowsHide: true };
    return next;
  }
  if (typeof options === "function" || options === undefined || options === null) {
    next.splice(at, options === undefined || options === null ? 1 : 0, { windowsHide: true });
  }
  return next;
}

/**
 * Wraps the start functions of `module` (the `child_process` exports) so that a process starts without a
 * console window unless the caller asks for one. Does nothing outside Windows, and nothing the second time.
 * True when it wrapped them: the caller then runs `syncBuiltinESMExports` for the ES module imports.
 */
export function hxHideChildWindows(
  module: HxChildProcessStarts,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32" || wrappedModules.has(module)) return false;
  for (const name of HX_CHILD_STARTS) {
    const original = module[name];
    const wrapped = (...args: HxStartArgument[]): HxStartResult =>
      original.apply(module, hxWithHiddenWindow(name, args));
    // `util.promisify(execFile)` and `util.promisify(exec)` resolve `{ stdout, stderr }` through this.
    const custom = Object.getOwnPropertyDescriptor(original, promisify.custom)?.value;
    if (typeof custom === "function") {
      Object.defineProperty(wrapped, promisify.custom, {
        value: (...args: HxStartArgument[]) => custom.apply(undefined, hxWithHiddenWindow(name, args)),
      });
    }
    module[name] = wrapped;
  }
  wrappedModules.add(module);
  return true;
}
