import { describe, expect, it } from "vitest";
import { HX_DOCK_CHECKS_MS, type HxChildWindow, type HxDockApp, hxKeepOutOfDock } from "./hx-dock";

function fakeApp(options: { refusePolicyBeforeReady?: boolean } = {}) {
  const calls: string[] = [];
  let ready = false;
  let visible = true;
  let resolveReady: () => void = () => {};
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = () => {
      ready = true;
      resolve();
    };
  });
  const app: HxDockApp = {
    setActivationPolicy(policy) {
      if (options.refusePolicyBeforeReady && !ready) throw new Error("not ready");
      calls.push(`policy:${policy}`);
    },
    whenReady: () => readyPromise,
    dock: {
      hide() {
        calls.push("hide");
        visible = false;
      },
      isVisible: () => visible,
    },
  };
  return {
    app,
    calls,
    ready: async () => {
      resolveReady();
      await readyPromise;
      await Promise.resolve();
    },
    // macOS dropped the hide while it activated the app: the icon is back.
    showAgain: () => {
      visible = true;
    },
  };
}

function manualSchedule() {
  const timers: { ms: number; run: () => void }[] = [];
  return {
    schedule: (run: () => void, ms: number) => {
      timers.push({ ms, run });
      return { unref: () => undefined };
    },
    runAll: () => {
      for (const timer of timers.splice(0)) timer.run();
    },
    timers,
  };
}

describe("hxKeepOutOfDock", () => {
  it("makes the process an accessory app and hides the Dock icon at once", () => {
    const fake = fakeApp();
    hxKeepOutOfDock(fake.app, { schedule: manualSchedule().schedule });
    expect(fake.calls).toEqual(["policy:accessory", "hide"]);
  });

  it("still hides when the policy cannot be set before ready", () => {
    const fake = fakeApp({ refusePolicyBeforeReady: true });
    hxKeepOutOfDock(fake.app, { schedule: manualSchedule().schedule });
    expect(fake.calls).toEqual(["hide"]);
  });

  it("hides again at ready and checks at each interval after it", async () => {
    const fake = fakeApp();
    const timers = manualSchedule();
    hxKeepOutOfDock(fake.app, { schedule: timers.schedule });
    await fake.ready();
    expect(fake.calls.slice(2)).toEqual(["policy:accessory", "hide"]);
    expect(timers.timers.map((timer) => timer.ms)).toEqual([...HX_DOCK_CHECKS_MS]);
  });

  it("hides the icon that came back after the early hide was lost, and says when", async () => {
    const fake = fakeApp();
    const timers = manualSchedule();
    const shown: number[] = [];
    hxKeepOutOfDock(fake.app, { schedule: timers.schedule, onShown: (ms) => shown.push(ms) });
    await fake.ready();
    fake.showAgain();
    const before = fake.calls.length;
    timers.runAll();
    // The first check finds it and hides it; the others find it hidden and do nothing.
    expect(shown).toEqual([HX_DOCK_CHECKS_MS[0]]);
    expect(fake.calls.slice(before)).toEqual(["policy:accessory", "hide"]);
    expect(fake.app.dock?.isVisible()).toBe(false);
  });

  it("does nothing at the checks while the icon stays hidden", async () => {
    const fake = fakeApp();
    const timers = manualSchedule();
    hxKeepOutOfDock(fake.app, { schedule: timers.schedule });
    await fake.ready();
    const before = fake.calls.length;
    timers.runAll();
    expect(fake.calls.length).toBe(before);
  });
});

describe("hxKeepChildWindowsHidden", () => {
  function fakeWindow() {
    const calls: string[] = [];
    let onShow: (() => void) | null = null;
    let destroyed = false;
    return {
      calls,
      destroy: () => {
        destroyed = true;
      },
      show: () => onShow?.(),
      window: {
        setSkipTaskbar: (skip: boolean) => calls.push(`skipTaskbar:${skip}`),
        hide: () => calls.push("hide"),
        isDestroyed: () => destroyed,
        on: (_event: "show", listener: () => void) => {
          onShow = listener;
        },
      },
    };
  }

  it("keeps each window of the child off the taskbar and hides it again when it is shown", async () => {
    const { hxKeepChildWindowsHidden } = await import("./hx-dock");
    const holder: { created?: (event: unknown, window: HxChildWindow) => void } = {};
    hxKeepChildWindowsHidden({
      on: (_event, listener) => {
        holder.created = listener;
      },
    });
    const first = fakeWindow();
    holder.created?.({}, first.window);
    expect(first.calls).toEqual(["skipTaskbar:true"]);
    first.show();
    expect(first.calls).toEqual(["skipTaskbar:true", "hide"]);
    first.destroy();
    first.show();
    expect(first.calls).toEqual(["skipTaskbar:true", "hide"]);
  });
});
