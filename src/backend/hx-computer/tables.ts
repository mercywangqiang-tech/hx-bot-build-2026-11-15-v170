// HXBot 电脑操控：内置的两张表的格式。一张是系统设置的页面（一个地址打开一页），
// 一张是可以不开设置页、直接读写的设置（一条读的命令、一条写的命令，写完读回核对）。
// 表里只放有把握的条目；每一项在一台电脑上第一次用时还会先核对自己（actions.ts）。
import type { HxSettingValues } from "@hxbot/contracts/hx-computer";

export interface HxPageSeed {
  /** Short and stable: `bluetooth`, `display`. */
  key: string;
  /** What the system opens: `x-apple.systempreferences:…` or `ms-settings:…`. */
  address: string;
  zh: string;
  en: string;
  /** The Chinese name in spaced pinyin; empty when the name is not Chinese. */
  pinyin: string;
  /** Other words people use for what is on this page. */
  more?: readonly string[];
  /** A security page: HXBot opens it and leaves every change on it to the user. */
  security?: boolean;
}

export interface HxCommand {
  command: string;
  args: readonly string[];
  env?: Readonly<Record<string, string>>;
}

export interface HxSettingSeed {
  key: string;
  /** The key of the page the setting is on. */
  page: string;
  zh: string;
  en: string;
  pinyin: string;
  more?: readonly string[];
  values: HxSettingValues;
  read: HxCommand;
  /**
   * The value in the command's answer, in HXBot's own words (`on`, `off`, a whole number, an option), or
   * null. A switch that the system keeps in two parts can also read as a mix (`apps only`); `write`
   * takes every value that `parse` gives, so that the earlier state can be put back exactly.
   */
  parse(stdout: string): string | null;
  write(value: string): HxCommand;
  /**
   * How far a number that was read back may be from the number that was written. The default is 1,
   * for a value the system keeps as a fraction. The Dock keeps its size as a whole number of points
   * and settles on one of its own nearby, so that one allows more.
   */
  tolerance?: number;
}

/** How far a number that was read back may be from the number that was written. */
export function hxSeedTolerance(seed: HxSettingSeed): number {
  return seed.tolerance ?? 1;
}

/** The line between the two readings of a command that reads, writes and reads again (combine.ts). */
export const HX_COMBINED_SEPARATOR = "@@";

/** `true` and `false`, as AppleScript and PowerShell print them. */
export function hxParseSwitch(stdout: string): "on" | "off" | null {
  const text = stdout.trim().toLowerCase();
  if (text === "true") return "on";
  if (text === "false") return "off";
  return null;
}

/** A whole number between the limits; a decimal comma is read as a point. */
export function hxParseNumber(stdout: string, min: number, max: number, scale = 1): string | null {
  const text = stdout.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/u.test(text)) return null;
  const value = Math.round(Number(text) * scale);
  return value >= min && value <= max ? String(value) : null;
}

export function hxParseChoice(stdout: string, options: readonly string[]): string | null {
  const text = stdout.trim().toLowerCase();
  return options.includes(text) ? text : null;
}
