import { beforeEach, describe, expect, it, vi } from "vitest";

// HXBot 电脑操控（二）：停止键（hx-computer-stop.ts）。Electron 用替身。v1.7.0：只在助手操作电脑时占用。

interface ElectronDouble {
  registered: Map<string, () => void>;
  answer: boolean | "throw";
  quitListeners: Array<() => void>;
  unregistered: string[];
}

const electron = vi.hoisted(
  (): ElectronDouble => ({ registered: new Map(), answer: true, quitListeners: [], unregistered: [] }),
);

vi.mock("electron", () => ({
  globalShortcut: {
    register: (keys: string, listener: () => void) => {
      if (electron.answer === "throw") throw new Error("not ready");
      if (electron.answer) electron.registered.set(keys, listener);
      return electron.answer;
    },
    unregister: (keys: string) => {
      electron.unregistered.push(keys);
      electron.registered.delete(keys);
    },
  },
  app: { once: (_event: string, listener: () => void) => electron.quitListeners.push(listener) },
}));

const { HX_COMPUTER_STOP_KEYS, hxRegisterComputerStop } = await import("./hx-computer-stop");

beforeEach(() => {
  electron.registered.clear();
  electron.answer = true;
  electron.quitListeners.length = 0;
  electron.unregistered.length = 0;
});

/** A clock that ticks only when the test says so. */
function ticks() {
  const bodies: Array<() => void> = [];
  return {
    every: (body: () => void) => {
      bodies.push(body);
      return () => void bodies.splice(bodies.indexOf(body), 1);
    },
    tick: () => {
      for (const body of bodies) body();
    },
  };
}

describe("the stop keys", () => {
  it("are Ctrl+Alt+Esc, which is not a system shortcut on macOS or Windows", () => {
    expect(HX_COMPUTER_STOP_KEYS).toBe("Control+Alt+Escape");
  });

  it("are held only while an agent works on this computer, and call the stop then (v1.7.0)", () => {
    for (const platform of ["darwin", "win32"] as const) {
      electron.registered.clear();
      let busy = false;
      let stops = 0;
      const clock = ticks();
      expect(hxRegisterComputerStop(() => (stops += 1), platform, { every: clock.every, working: () => busy })).toBe(
        true,
      );
      clock.tick();
      // Nobody works: other apps keep the keys.
      expect(electron.registered.size, platform).toBe(0);
      busy = true;
      clock.tick();
      electron.registered.get(HX_COMPUTER_STOP_KEYS)?.();
      expect(stops, platform).toBe(1);
      busy = false;
      clock.tick();
      expect(electron.registered.size, platform).toBe(0);
    }
    expect(electron.unregistered).toEqual([HX_COMPUTER_STOP_KEYS, HX_COMPUTER_STOP_KEYS]);
  });

  it("are let go when the app quits", () => {
    const clock = ticks();
    hxRegisterComputerStop(() => {}, "darwin", { every: clock.every, working: () => true });
    clock.tick();
    for (const listener of electron.quitListeners) listener();
    expect(electron.unregistered).toEqual([HX_COMPUTER_STOP_KEYS]);
  });

  it("are not registered on Linux, where computer control does not work", () => {
    expect(hxRegisterComputerStop(() => {}, "linux")).toBe(false);
    expect(electron.registered.size).toBe(0);
  });

  it("change nothing when another app holds them, or Electron refuses", () => {
    const clock = ticks();
    electron.answer = false;
    hxRegisterComputerStop(() => {}, "darwin", { every: clock.every, working: () => true });
    clock.tick();
    electron.answer = "throw";
    clock.tick();
    expect(electron.registered.size).toBe(0);
  });
});
