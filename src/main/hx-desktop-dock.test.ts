import { describe, expect, it } from "vitest";

describe("hxDesktopInDock", () => {
  function desktopApp(options: { refuseFirst?: boolean } = {}) {
    const calls: string[] = [];
    let listener: (() => void) | null = null;
    let refuse = options.refuseFirst === true;
    return {
      calls,
      finishLaunching: () => listener?.(),
      app: {
        setActivationPolicy(policy: "regular" | "accessory" | "prohibited") {
          if (refuse) {
            refuse = false;
            throw new Error("too early");
          }
          calls.push(`policy:${policy}`);
        },
        once(event: "will-finish-launching", next: () => void) {
          calls.push(`once:${event}`);
          listener = next;
        },
      },
    };
  }

  it("makes the desktop app a regular app at once and again before it finishes launching", async () => {
    const { hxDesktopInDock } = await import("./hx-desktop-dock");
    const desktop = desktopApp();
    hxDesktopInDock(desktop.app);
    expect(desktop.calls).toEqual(["policy:regular", "once:will-finish-launching"]);
    desktop.finishLaunching();
    expect(desktop.calls).toEqual(["policy:regular", "once:will-finish-launching", "policy:regular"]);
  });

  it("still sets the policy at will-finish-launching when the first call is refused", async () => {
    const { hxDesktopInDock } = await import("./hx-desktop-dock");
    const desktop = desktopApp({ refuseFirst: true });
    expect(() => hxDesktopInDock(desktop.app)).not.toThrow();
    expect(desktop.calls).toEqual(["once:will-finish-launching"]);
    desktop.finishLaunching();
    expect(desktop.calls).toEqual(["once:will-finish-launching", "policy:regular"]);
  });
});
