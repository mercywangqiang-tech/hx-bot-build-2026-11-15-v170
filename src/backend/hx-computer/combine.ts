// HXBot 电脑操控：把“读原值、写入、再读一次”合成一次启动。
// 为什么：改一项设置本来要启动三次系统命令。我们实测的一台 ARM 电脑上启动一次 PowerShell 要 22 秒，
// 改一项设置 45 秒；合成一次之后只启动一次。Mac 上一次 osascript 约 100 毫秒，也省两次。
// 怎么合成：用这一项自己的读命令和写命令，不另写命令——所以这一项的命令指纹（catalog.ts）照样有效。
// 两次读到的值用一行 @@ 隔开；拼不出合成命令，或者合成命令出错，就退回原来的三步做法（actions.ts）。
import type { HxComputerPlatform } from "@hxbot/contracts/hx-computer";
import { HX_COMBINED_SEPARATOR, type HxCommand, type HxSettingSeed } from "./tables";
import { hxMacCombined } from "./tables-mac";
import { hxWinCombined } from "./tables-win";

/** One process that reads the value of a setting, writes `value` and reads again, or null. */
export function hxCombinedChange(platform: HxComputerPlatform, seed: HxSettingSeed, value: string): HxCommand | null {
  const write = seed.write(value);
  return platform === "mac" ? hxMacCombined(seed.read, write) : hxWinCombined(seed.read, write);
}

/** The two readings of such a command, each in HXBot's own words, or null when the answer is not a pair. */
export function hxCombinedValues(seed: HxSettingSeed, stdout: string): { before: string; after: string } | null {
  const parts = stdout.split(new RegExp(`^${HX_COMBINED_SEPARATOR}$`, "mu"));
  if (parts.length !== 2) return null;
  const before = seed.parse(parts[0] ?? "");
  const after = seed.parse(parts[1] ?? "");
  return before === null || after === null ? null : { before, after };
}
