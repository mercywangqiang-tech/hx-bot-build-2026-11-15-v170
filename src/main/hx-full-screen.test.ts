// The main window leaves full screen before it hides (v1.6.8): a hidden full screen window leaves a
// black Space over the whole display on macOS.
import { describe, expect, it } from "vitest";
import { type HxFullScreenWindow, hxHideOutOfFullScreen } from "./hx-full-screen";

function window(fullScreen: boolean) {
  const events: string[] = [];
  let leave: (() => void) | null = null;
  const value: HxFullScreenWindow = {
    isFullScreen: () => fullScreen,
    setFullScreen(flag) {
      events.push(`full screen ${flag}`);
    },
    once(_event, listener) {
      leave = listener;
    },
    hide() {
      events.push("hide");
    },
    isDestroyed: () => false,
  };
  return { value, events, leave: () => leave?.() };
}

describe("hiding the main window", () => {
  it("hides at once when the window is not in full screen, or not on a Mac", () => {
    const plain = window(false);
    hxHideOutOfFullScreen(plain.value, "darwin");
    expect(plain.events).toEqual(["hide"]);
    const windows = window(true);
    hxHideOutOfFullScreen(windows.value, "win32");
    expect(windows.events).toEqual(["hide"]);
  });

  it("leaves full screen first on a Mac, and hides once when macOS says it has left", () => {
    const full = window(true);
    const timers: (() => void)[] = [];
    hxHideOutOfFullScreen(full.value, "darwin", (run) => timers.push(run));
    expect(full.events).toEqual(["full screen false"]);
    full.leave();
    expect(full.events).toEqual(["full screen false", "hide"]);
    // The timer that guards a missing event does not hide a second time.
    for (const run of timers) run();
    expect(full.events).toEqual(["full screen false", "hide"]);
  });

  it("hides after the wait when macOS never says that the window left full screen", () => {
    const stuck = window(true);
    const timers: (() => void)[] = [];
    hxHideOutOfFullScreen(stuck.value, "darwin", (run) => timers.push(run));
    for (const run of timers) run();
    expect(stuck.events).toEqual(["full screen false", "hide"]);
  });
});
