// HXBot：设置 → Computer Use 里的“这台电脑上的应用和设置”（HxComputerPanel.tsx）。
import type { HxComputerStatus, HxSelfTestReport } from "@hxbot/contracts/hx-computer";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { type HxComputerCalls, HxComputerPanel } from "./HxComputerPanel";

const BUILT_AT = 1_700_000_000_000;
const STATUS: HxComputerStatus = {
  platform: "mac",
  builtAt: BUILT_AT,
  apps: 120,
  pages: 42,
  settings: 12,
  directSettings: 11,
  disabled: ["setting:volume"],
  unchecked: 0,
};

const REPORT: HxSelfTestReport = {
  platform: "mac",
  system: "macOS 15.1",
  startedAt: 1,
  finishedAt: 2,
  items: [
    { id: "catalog.apps", outcome: "passed", detail: "120 apps", ms: 900 },
    { id: "setting.volume.read", outcome: "failed", detail: "code 1: no", ms: 20 },
    { id: "setting.dark-mode.read", outcome: "skipped", detail: "not allowed yet", ms: 5 },
  ],
  passed: 1,
  failed: 1,
  skipped: 1,
  file: "/Users/a/Downloads/HXBot-self-test.json",
};

function calls(change: Partial<HxComputerCalls> = {}): HxComputerCalls {
  return {
    status: vi.fn(() => Promise.resolve(STATUS)),
    rebuild: vi.fn(() => Promise.resolve({ ...STATUS, apps: 121, builtAt: BUILT_AT + 5 })),
    selfTest: vi.fn(() => Promise.resolve(REPORT)),
    ...change,
  };
}

async function settle() {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  flush();
}

const summary = () => document.querySelector('[data-hx-computer="summary"]')?.textContent ?? "";
const button = (name: string) => screen.getByRole("button", { name });

describe("HxComputerPanel", () => {
  it("asks for the status only when it is shown, and shows the counts", async () => {
    const hidden = calls();
    const first = render(() => <HxComputerPanel visible={false} calls={hidden} />);
    await settle();
    expect(hidden.status).not.toHaveBeenCalled();
    first.unmount();

    const shown = calls();
    render(() => <HxComputerPanel visible calls={shown} />);
    await settle();
    expect(shown.status).toHaveBeenCalledTimes(1);
    expect(summary()).toBe("120 apps, 42 settings pages, 12 settings (11 can be changed directly)");
    expect(screen.getByText(/1 settings did not pass their check/u)).toBeTruthy();
    expect(screen.getByText("Apps and settings on this computer")).toBeTruthy();
  });

  it("says how many settings wait for the self-test, and stops saying it once they were checked", async () => {
    const waiting = { ...STATUS, directSettings: 0, disabled: [], unchecked: 12 };
    const checked = { ...STATUS, directSettings: 12, disabled: [], unchecked: 0 };
    let current = waiting;
    const used = calls({
      status: () => Promise.resolve(current),
      selfTest: () => {
        current = checked;
        return Promise.resolve(REPORT);
      },
    });
    render(() => <HxComputerPanel visible calls={used} />);
    await settle();
    const line = () => document.querySelector('[data-hx-computer="unchecked"]')?.textContent ?? null;
    expect(line()).toBe(
      "12 settings have not been checked on this computer yet. After one run of the self-test, agents change them directly.",
    );
    expect(summary()).toBe("120 apps, 42 settings pages, 12 settings (0 can be changed directly)");
    fireEvent.click(button("Run the self-test"));
    await settle();
    expect(line()).toBeNull();
    expect(summary()).toBe("120 apps, 42 settings pages, 12 settings (12 can be changed directly)");
  });

  it("says when the catalog has not been built, and when the system is not supported", async () => {
    const first = render(() => (
      <HxComputerPanel
        visible
        calls={calls({ status: () => Promise.resolve({ ...STATUS, builtAt: null, apps: 0, disabled: [] }) })}
      />
    ));
    await settle();
    expect(summary()).toBe("The catalog has not been built yet.");
    expect(button("Rebuild the catalog").hasAttribute("disabled")).toBe(false);
    first.unmount();

    render(() => (
      <HxComputerPanel
        visible
        calls={calls({ status: () => Promise.resolve({ ...STATUS, platform: null, disabled: [] }) })}
      />
    ));
    await settle();
    expect(summary()).toBe("This system is not supported yet. The catalog works on macOS and Windows.");
    expect(button("Rebuild the catalog").hasAttribute("disabled")).toBe(true);
    expect(button("Run the self-test").hasAttribute("disabled")).toBe(true);
  });

  it("rebuilds the catalog once for one click, and shows the new counts", async () => {
    let finish: (status: HxComputerStatus) => void = () => {};
    const rebuild = vi.fn(() => new Promise<HxComputerStatus>((resolve) => (finish = resolve)));
    render(() => <HxComputerPanel visible calls={calls({ rebuild })} />);
    await settle();
    fireEvent.click(button("Rebuild the catalog"));
    await settle();
    expect(button("Working…").hasAttribute("disabled")).toBe(true);
    expect(button("Run the self-test").hasAttribute("disabled")).toBe(true);
    fireEvent.click(button("Working…"));
    expect(rebuild).toHaveBeenCalledTimes(1);
    finish({ ...STATUS, apps: 121, builtAt: BUILT_AT + 5 });
    await settle();
    expect(summary()).toContain("121 apps");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(button("Rebuild the catalog").hasAttribute("disabled")).toBe(false);
  });

  it("says so when a rebuild found nothing, and keeps the list it had", async () => {
    // The scan failed: main answers with the earlier list and the earlier time.
    const rebuild = vi.fn(() => Promise.resolve(STATUS));
    render(() => <HxComputerPanel visible calls={calls({ rebuild })} />);
    await settle();
    fireEvent.click(button("Rebuild the catalog"));
    await settle();
    expect(screen.getByRole("alert").textContent).toBe("This did not work. Try again.");
    expect(summary()).toContain("120 apps");
    expect(button("Rebuild the catalog").hasAttribute("disabled")).toBe(false);

    // The same before any list exists, and no alert on a system without a catalog.
    document.body.innerHTML = "";
    const never = { ...STATUS, builtAt: null, apps: 0, disabled: [] };
    const first = render(() => (
      <HxComputerPanel
        visible
        calls={calls({ status: () => Promise.resolve(never), rebuild: () => Promise.resolve(never) })}
      />
    ));
    await settle();
    fireEvent.click(button("Rebuild the catalog"));
    await settle();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(summary()).toBe("The catalog has not been built yet.");
    first.unmount();
  });

  it("says so when the rebuild itself fails, and lets the user try again", async () => {
    const rebuild = vi.fn(() => Promise.reject(new Error("no main process")));
    render(() => <HxComputerPanel visible calls={calls({ rebuild })} />);
    await settle();
    fireEvent.click(button("Rebuild the catalog"));
    await settle();
    expect(screen.getByRole("alert").textContent).toBe("This did not work. Try again.");
    expect(summary()).toContain("120 apps");
    expect(button("Rebuild the catalog").hasAttribute("disabled")).toBe(false);
    fireEvent.click(button("Rebuild the catalog"));
    await settle();
    expect(rebuild).toHaveBeenCalledTimes(2);
  });

  it("shows the start of a long detail, not all of it", async () => {
    const long = {
      ...REPORT,
      items: [{ id: "mac.settings-pages", outcome: "failed" as const, detail: "x".repeat(900), ms: 1 }],
    };
    render(() => <HxComputerPanel visible calls={calls({ selfTest: () => Promise.resolve(long) })} />);
    await settle();
    fireEvent.click(button("Run the self-test"));
    await settle();
    const problem = document.querySelector('[data-hx-computer="problem"]')?.textContent ?? "";
    expect(problem).toBe(`mac.settings-pages: ${"x".repeat(300)}`);
  });

  it("runs the self-test and shows the totals, the file, and what failed", async () => {
    const used = calls();
    render(() => <HxComputerPanel visible calls={used} />);
    await settle();
    expect(document.querySelector('[data-hx-computer="result"]')).toBeNull();
    fireEvent.click(button("Run the self-test"));
    await settle();
    expect(used.selfTest).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-hx-computer="result"]')?.textContent).toBe("1 passed, 1 failed, 1 skipped");
    expect(screen.getByText("Report saved: /Users/a/Downloads/HXBot-self-test.json")).toBeTruthy();
    const problems = [...document.querySelectorAll('[data-hx-computer="problem"]')].map((node) => node.textContent);
    expect(problems).toEqual(["setting.volume.read: code 1: no"]);
    // The status is read again, because a self-test rebuilds the catalog.
    expect(used.status).toHaveBeenCalledTimes(2);
  });

  it("does not show a file line when the report could not be saved", async () => {
    render(() => (
      <HxComputerPanel visible calls={calls({ selfTest: () => Promise.resolve({ ...REPORT, file: "" }) })} />
    ));
    await settle();
    fireEvent.click(button("Run the self-test"));
    await settle();
    expect(screen.queryByText(/Report saved/u)).toBeNull();
  });

  it("says when a request fails, and lets the user try again", async () => {
    const status = vi.fn(() => Promise.reject(new Error("no main process")));
    const selfTest = vi.fn(() => Promise.reject(new Error("stopped")));
    render(() => <HxComputerPanel visible calls={calls({ status, selfTest })} />);
    await settle();
    expect(screen.getByRole("alert").textContent).toBe("This did not work. Try again.");
    expect(summary()).toBe("");
    fireEvent.click(button("Run the self-test"));
    await settle();
    expect(selfTest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(button("Run the self-test").hasAttribute("disabled")).toBe(false);
  });
});
