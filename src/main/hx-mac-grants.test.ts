import type { MacPermissionId } from "@hxbot/contracts/ipc";
import type { DynamicRecord } from "@hxbot/contracts/runtime-values";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { HxDriverAnswer } from "../backend/hx-computer/driver";
import { HxMacGrants, type HxMacGrantsHost, hxLsappinfoPid } from "./hx-mac-grants";

const PID = 640;

function answer(content: DynamicRecord | null): HxDriverAnswer {
  return { ok: true, content, text: "", error: null };
}

/** System Settings with HXBot's row, its switch off, then on once it was pressed. */
function settings() {
  let pressed = false;
  const clicks: string[] = [];
  const port = {
    async call(tool: string, args: DynamicRecord) {
      if (tool === "list_windows")
        return answer({ windows: [{ pid: PID, window_id: 7, bounds: { width: 700, height: 600 } }] });
      if (tool === "get_window_state")
        return answer({
          pid: PID,
          window_id: 7,
          elements: [
            { element_index: 0, role: "AXWindow", label: "Screen Recording", depth: 0 },
            {
              element_index: 1,
              role: "AXCheckBox",
              label: "bash_Toggle",
              value: "1",
              element_token: "t-bash",
              depth: 3,
            },
            {
              element_index: 2,
              role: "AXCheckBox",
              label: "HXBot_Toggle",
              value: pressed ? "1" : "0",
              element_token: "t-hxbot",
              depth: 3,
            },
          ],
        });
      if (tool === "click") {
        pressed = true;
        clicks.push(String(args.element_token));
        return answer({ effect: "confirmed" });
      }
      return answer(null);
    },
    close() {},
  };
  return { port, clicks };
}

function host(over: Partial<HxMacGrantsHost> & { grants: { accessibility: boolean; screen: boolean } }) {
  const pages: MacPermissionId[] = [];
  const resets: string[] = [];
  let states = 0;
  const system = settings();
  const value: HxMacGrantsHost = {
    driver: {
      state: () =>
        Effect.sync(() => {
          states += 1;
          return { status: "ready" };
        }),
      start: () => Effect.void,
      running: () => true,
      mcpServerConfig: () => ({ args: ["serve", "--socket", "/tmp/driver.sock"] }),
    },
    accessibility: () => over.grants.accessibility,
    screenRecording: () => over.grants.screen,
    askScreenRecording: async () => undefined,
    resetOwn: async (service) => {
      resets.push(service);
    },
    openPage: async (id) => {
      pages.push(id);
    },
    settingsPid: async () => PID,
    names: ["HXBot"],
    wait: async () => undefined,
    connect: () => system.port,
    ...over,
  };
  return { value, pages, resets, clicks: system.clicks, states: () => states };
}

describe("HxMacGrants", () => {
  it("turns on its own Screen Recording switch once it has Accessibility", async () => {
    const grants = { accessibility: true, screen: false };
    const run = host({ grants });
    const mac = new HxMacGrants();
    mac.set(run.value);
    expect(await mac.press("screen-recording")).toEqual({ status: "pressed", asked: false });
    expect(run.clicks).toEqual(["t-hxbot"]);
  });

  it("presses nothing without Accessibility: the user follows the steps window", async () => {
    const run = host({ grants: { accessibility: false, screen: false } });
    const mac = new HxMacGrants();
    mac.set(run.value);
    expect(await mac.press("screen-recording")).toBeNull();
    expect(run.clicks).toEqual([]);
  });

  it("after the user turns on Accessibility, goes on to Screen Recording by itself", async () => {
    const grants = { accessibility: false, screen: false };
    let checks = 0;
    const run = host({
      grants,
      // The user turns the switch on while HXBot waits.
      accessibility: () => {
        checks += 1;
        if (checks >= 3) grants.accessibility = true;
        return grants.accessibility;
      },
    });
    const mac = new HxMacGrants();
    mac.set(run.value);
    expect(await mac.press("accessibility")).toBeNull();
    await expect.poll(() => run.clicks).toEqual(["t-hxbot"]);
    expect(run.pages).toEqual(["screen-recording"]);
  });

  it("removes its own stale entry only for a grant that does not hold", async () => {
    const run = host({ grants: { accessibility: true, screen: false } });
    const mac = new HxMacGrants();
    mac.set(run.value);
    await mac.prepare("accessibility");
    await mac.prepare("screen-recording");
    expect(run.resets).toEqual(["ScreenCapture"]);
  });

  it("reads the pid out of lsappinfo", () => {
    expect(hxLsappinfoPid('"pid"=1259\n')).toBe(1259);
    expect(hxLsappinfoPid("")).toBeNull();
  });
});
