import type { DynamicRecord } from "@hxbot/contracts/runtime-values";
import { describe, expect, it } from "vitest";
import type { HxDriverAnswer, HxDriverPort } from "./driver";
import { hxGrantSwitch, hxPressGrant, hxWindowOf } from "./grant-press";
import { hxReadWindow } from "./outline";

const PID = 501;

function answer(content: DynamicRecord | null, ok = true): HxDriverAnswer {
  return { ok, content, text: "", error: ok ? null : "refused" };
}

/** System Settings as the driver read it on macOS 15 and 26: one "<app>_Toggle" switch per row. */
function pane(rows: ReadonlyArray<readonly [string, "0" | "1"]>, extra: DynamicRecord[] = []): DynamicRecord {
  const elements: DynamicRecord[] = [
    { element_index: 0, role: "AXWindow", label: "Screen & System Audio Recording", depth: 0 },
  ];
  for (const [name, value] of rows) {
    elements.push({ element_index: elements.length, role: "AXRow", label: "", depth: 3 });
    elements.push({
      element_index: elements.length,
      role: "AXCheckBox",
      label: `${name}_Toggle`,
      value,
      element_token: `token-${name}`,
      depth: 4,
    });
  }
  for (const element of extra) elements.push({ ...element, element_index: elements.length });
  return { pid: PID, window_id: 29, app_name: "System Settings", window_title: "Screen Recording", elements };
}

const WINDOWS: DynamicRecord = {
  windows: [
    { pid: 77, window_id: 3, bounds: { width: 900, height: 700 } },
    { pid: PID, window_id: 28, bounds: { width: 40, height: 20 } },
    { pid: PID, window_id: 29, bounds: { width: 715, height: 650 } },
  ],
};

function driver(reads: DynamicRecord[]): { port: HxDriverPort; clicks: string[] } {
  const clicks: string[] = [];
  let read = 0;
  const port: HxDriverPort = {
    async call(tool, args) {
      if (tool === "list_windows") return answer(WINDOWS);
      if (tool === "get_window_state") {
        const content = reads[Math.min(read, reads.length - 1)] ?? null;
        read += 1;
        return answer(content);
      }
      if (tool === "click") {
        clicks.push(String(args.element_token));
        return answer({ effect: "confirmed" });
      }
      return answer(null, false);
    },
  };
  return { port, clicks };
}

const fast = async () => undefined;

describe("hxPressGrant", () => {
  it("presses only the app's own switch, and sees macOS ask for the password", async () => {
    const before = pane([
      ["bash", "1"],
      ["HXBot", "0"],
      ["provisioner", "1"],
    ]);
    const asked = pane(
      [
        ["bash", "1"],
        ["HXBot", "1"],
        ["provisioner", "1"],
      ],
      [
        { role: "AXSecureTextField", label: "Password", depth: 2 },
        { role: "AXButton", label: "Modify Settings", depth: 2 },
      ],
    );
    const run = driver([before, asked]);
    const result = await hxPressGrant({ driver: run.port, pid: PID, names: ["HXBot"], wait: fast });
    expect(result).toEqual({ status: "pressed", asked: true });
    expect(run.clicks).toEqual(["token-HXBot"]);
  });

  it("reads the page again until its list is there (macOS 26)", async () => {
    const run = driver([pane([]), pane([]), pane([["HXBot", "0"]])]);
    const result = await hxPressGrant({ driver: run.port, pid: PID, names: ["HXBot"], wait: fast });
    expect(result.status).toBe("pressed");
    expect(run.clicks).toEqual(["token-HXBot"]);
  });

  it("does not press a switch that is on, or a row that is not there", async () => {
    const on = driver([pane([["HXBot", "1"]])]);
    expect(await hxPressGrant({ driver: on.port, pid: PID, names: ["HXBot"], wait: fast })).toEqual({ status: "on" });
    const missing = driver([pane([["bash", "0"]])]);
    expect(await hxPressGrant({ driver: missing.port, pid: PID, names: ["HXBot"], wait: fast, listMs: 3000 })).toEqual({
      status: "not_listed",
    });
    expect([...on.clicks, ...missing.clicks]).toEqual([]);
  });
});

describe("hxGrantSwitch and hxWindowOf", () => {
  it("matches the switch label in any case and spacing, never a bare Toggle", () => {
    const read = hxReadWindow(pane([["Xcode Helper", "0"]]));
    expect(read && hxGrantSwitch(read.elements, ["xcodehelper"])?.label).toBe("Xcode Helper_Toggle");
    expect(read && hxGrantSwitch(read.elements, [""])).toBeNull();
  });

  it("takes the largest window of System Settings", () => {
    expect(hxWindowOf(WINDOWS, PID)).toBe(29);
    expect(hxWindowOf(WINDOWS, 9)).toBeNull();
  });
});
