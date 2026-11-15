import { describe, expect, it } from "vitest";
import {
  HX_DRIVER_HELP_AGAIN_MS,
  HxDriverDoctor,
  type HxDriverState,
  hxDriverLine,
  hxStepGrantsMissing,
} from "./driver-help";

function reply(result: { contentItems: Array<{ type: string; text?: string }> } | null): {
  status?: string;
  missing?: string[];
  reason?: string;
} {
  const item = result?.contentItems[0];
  return item && "text" in item && item.text ? JSON.parse(item.text) : {};
}

function doctor(state: HxDriverState, now: { value: number }, address: { value: string | null }) {
  const opened: string[] = [];
  const notes: string[] = [];
  const checks: number[] = [];
  const help = new HxDriverDoctor(() => now.value);
  help.set({
    async check() {
      checks.push(now.value);
      return state;
    },
    async openPermission(id) {
      opened.push(id);
    },
  });
  const ensure = () =>
    help.ensure({ agentId: "a1", address: () => address.value, note: (_agentId, text) => notes.push(text) });
  return { ensure, opened, notes, checks };
}

describe("the driver doctor", () => {
  it("lets the call go on when the driver listens, without a check", async () => {
    const run = doctor({ status: "ready", missing: [], message: null }, { value: 0 }, { value: "/tmp/s" });
    expect(await run.ensure()).toBeNull();
    expect(run.checks).toEqual([]);
  });

  it("goes on when the check starts the driver (a grant given since)", async () => {
    const address: { value: string | null } = { value: null };
    const help = new HxDriverDoctor();
    help.set({
      async check() {
        address.value = "/tmp/s";
        return { status: "ready", missing: [], message: null };
      },
      async openPermission() {},
    });
    expect(await help.ensure({ agentId: "a1", address: () => address.value })).toBeNull();
  });

  it("names the missing grants, opens the first page once and writes one line", async () => {
    const now = { value: 1_000 };
    const run = doctor(
      { status: "permissions-required", missing: ["screen-recording", "accessibility"], message: null },
      now,
      { value: null },
    );
    const first = reply(await run.ensure());
    expect(first.status).toBe("needs_permission");
    expect(first.missing).toEqual(["screen-recording", "accessibility"]);
    expect(first.reason).toContain("Screen Recording and Accessibility");
    expect(first.reason).toContain("HXBot opened System Settings");
    expect(run.opened).toEqual(["screen-recording"]);
    expect(run.notes).toEqual([
      hxDriverLine({ status: "permissions-required", missing: ["screen-recording", "accessibility"], message: null }),
    ]);

    now.value += 5_000;
    const again = reply(await run.ensure());
    expect(again.reason).toContain("under Privacy & Security");
    expect(run.opened).toHaveLength(1);
    expect(run.notes).toHaveLength(1);

    now.value += HX_DRIVER_HELP_AGAIN_MS;
    await run.ensure();
    expect(run.opened).toHaveLength(2);
    expect(run.notes).toHaveLength(2);
  });

  it("says why when the driver does not start, with no page to open", async () => {
    const run = doctor({ status: "error", missing: [], message: "The driver stopped." }, { value: 0 }, { value: null });
    const answer = reply(await run.ensure());
    expect(answer.status).toBe("no_driver");
    expect(answer.reason).toContain("The driver stopped.");
    expect(run.opened).toEqual([]);
    expect(run.notes[0]).toContain("The driver stopped.");
  });

  it("chooses the line by the grants that are missing", () => {
    const line = (missing: HxDriverState["missing"]) =>
      hxDriverLine({ status: "permissions-required", missing, message: null });
    expect(line(["screen-recording"])).toContain("Screen Recording grant");
    expect(line(["accessibility"])).toContain("Accessibility grant");
    expect(hxDriverLine(null)).toContain("not running");
  });
});

describe("hxStepGrantsMissing", () => {
  it("names Accessibility only: the step tools take no screenshot", () => {
    const none = [
      { id: "screen-recording" as const, granted: false },
      { id: "accessibility" as const, granted: false },
    ];
    expect(hxStepGrantsMissing(none)).toEqual(["accessibility"]);
    expect(
      hxStepGrantsMissing([
        { id: "screen-recording", granted: false },
        { id: "accessibility", granted: true },
      ]),
    ).toEqual([]);
    expect(hxStepGrantsMissing([])).toEqual([]);
  });
});
