import { describe, expect, it } from "vitest";
import { hxCombinedChange, hxCombinedValues } from "./combine";
import { HX_COMBINED_SEPARATOR, type HxSettingSeed } from "./tables";
import { HX_MAC_SETTINGS, hxMacCombined } from "./tables-mac";
import { HX_POWERSHELL, HX_WIN_SETTINGS, hxPowerShell, hxPowerShellScript, hxWinCombined } from "./tables-win";

function seed(list: readonly HxSettingSeed[], key: string): HxSettingSeed {
  const found = list.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no setting ${key}`);
  return found;
}

describe("one process for a change on macOS", () => {
  it("runs the read, the write and the read again as statements of one script, unchanged", () => {
    const dark = seed(HX_MAC_SETTINGS, "dark-mode");
    const command = hxCombinedChange("mac", dark, "on");
    expect(command?.command).toBe("/usr/bin/osascript");
    const read = dark.read.args[1];
    const write = dark.write("on").args[1];
    expect(command?.args).toEqual([
      "-e",
      read,
      "-e",
      "set hxBefore to result as text",
      "-e",
      write,
      "-e",
      read,
      "-e",
      'return hxBefore & linefeed & "@@" & linefeed & (result as text)',
    ]);
  });

  it("is there for every setting of the table", () => {
    for (const setting of HX_MAC_SETTINGS) {
      const values = setting.values;
      const value = values.type === "number" ? String(values.min) : values.type === "choice" ? values.options[0] : "on";
      expect(hxCombinedChange("mac", setting, value ?? "on"), setting.key).not.toBeNull();
    }
  });

  it("is not made of commands that are not one script for osascript", () => {
    const script = { command: "/usr/bin/osascript", args: ["-e", "get volume settings"] };
    expect(hxMacCombined({ command: "/usr/bin/defaults", args: ["read", "x"] }, script)).toBeNull();
    expect(hxMacCombined(script, { command: "/usr/bin/osascript", args: ["-e", "a", "-e", "b"] })).toBeNull();
  });
});

describe("one process for a change on Windows", () => {
  it("runs the two scripts as they are, each in a block of its own, in one PowerShell", () => {
    const transparency = seed(HX_WIN_SETTINGS, "transparency");
    const command = hxCombinedChange("windows", transparency, "off");
    expect(command?.command).toBe(HX_POWERSHELL);
    const script = command ? (hxPowerShellScript(command) ?? "") : "";
    const read = hxPowerShellScript(transparency.read) ?? "";
    const write = hxPowerShellScript(transparency.write("off")) ?? "";
    expect(read).not.toBe("");
    expect(write).not.toBe("");
    expect(script).toBe(
      `$hxBefore = & { ${read} }; & { ${write} } | Out-Null; $hxAfter = & { ${read} }; [string]$hxBefore + [char]10 + '@@' + [char]10 + [string]$hxAfter`,
    );
  });

  it("is there for every setting of the table, with no double quote in it", () => {
    for (const setting of HX_WIN_SETTINGS) {
      const values = setting.values;
      const value = values.type === "number" ? String(values.min) : "on";
      const command = hxCombinedChange("windows", setting, value);
      expect(command, setting.key).not.toBeNull();
      expect(command?.args.join(" "), setting.key).not.toContain('"');
    }
  });

  it("keeps what a write passes outside the script", () => {
    const write = hxPowerShell("Set-Thing $env:HX_VALUE", { HX_VALUE: "x" });
    const read = hxPowerShell("Get-Thing");
    expect(hxWinCombined(read, write)?.env).toEqual({ HX_VALUE: "x" });
  });

  it("is not made of commands that are not ours", () => {
    const ours = hxPowerShell("Get-Thing");
    expect(hxWinCombined({ command: "C:\\Windows\\System32\\reg.exe", args: ["query", "x"] }, ours)).toBeNull();
    expect(hxWinCombined(ours, { command: HX_POWERSHELL, args: ["-Command", "Get-Thing"] })).toBeNull();
  });
});

describe("hxCombinedValues", () => {
  const dark = seed(HX_MAC_SETTINGS, "dark-mode");
  const size = seed(HX_MAC_SETTINGS, "dock-size");

  it("reads the two readings, each in HXBot's own words", () => {
    expect(hxCombinedValues(dark, `false\n${HX_COMBINED_SEPARATOR}\ntrue\n`)).toEqual({ before: "off", after: "on" });
    expect(hxCombinedValues(size, "0.3035714\r\n@@\r\n0.4\r\n")).toEqual({ before: "30", after: "40" });
  });

  it("reads nothing when the answer is not two readings it understands", () => {
    expect(hxCombinedValues(dark, "true\n")).toBeNull();
    expect(hxCombinedValues(dark, "true\n@@\nmaybe\n")).toBeNull();
    expect(hxCombinedValues(dark, "true\n@@\ntrue\n@@\ntrue\n")).toBeNull();
    // The separator is a line of its own, not a part of a value.
    expect(hxCombinedValues(dark, "true@@true\n")).toBeNull();
  });
});
