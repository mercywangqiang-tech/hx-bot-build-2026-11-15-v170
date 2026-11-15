import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) } }));

const { HX_RIM_READ_GAP_MS, HxRimQuiet, hxIgnoreMouse } = await import("./hx-quiet");

describe("the rim reads the driver only after it acted (v1.7.0)", () => {
  it("hides without a read when the driver did nothing lately", () => {
    const quiet = new HxRimQuiet(() => 1_000);
    expect(quiet.next(false)).toBe("hide");
  });

  it("reads at most twice a second while the driver acts", () => {
    let now = 10_000;
    const quiet = new HxRimQuiet(() => now);
    expect(quiet.next(true)).toBe("read");
    now += 250;
    expect(quiet.next(true)).toBe("keep");
    now += HX_RIM_READ_GAP_MS;
    expect(quiet.next(true)).toBe("read");
  });
});

class FakeWindow {
  readonly calls: { ignore: boolean; forward: boolean | undefined }[] = [];
  visible = true;
  destroyed = false;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }) {
    this.calls.push({ ignore, forward: options?.forward });
  }
  getBounds() {
    return { x: 100, y: 0, width: 200, height: 50 };
  }
  isVisible() {
    return this.visible;
  }
  isDestroyed() {
    return this.destroyed;
  }
}

describe("forwarding the mouse (v1.7.0)", () => {
  it("forwards as before on a Mac", () => {
    const window = new FakeWindow();
    hxIgnoreMouse(window, true, { platform: "darwin" });
    expect(window.calls).toEqual([{ ignore: true, forward: true }]);
  });

  it("on Windows forwards only while the pointer is near, and stops watching when the window takes the mouse", () => {
    const window = new FakeWindow();
    let point = { x: 900, y: 900 };
    let tick: () => void = () => undefined;
    let stopped = 0;
    const options = {
      platform: "win32" as const,
      cursor: () => point,
      every: (body: () => void) => {
        tick = body;
        return () => {
          stopped += 1;
        };
      },
    };
    hxIgnoreMouse(window, true, options);
    expect(window.calls).toEqual([{ ignore: true, forward: false }]);
    point = { x: 150, y: 20 };
    tick();
    expect(window.calls.at(-1)).toEqual({ ignore: true, forward: true });
    tick();
    expect(window.calls).toHaveLength(2);
    point = { x: 900, y: 900 };
    tick();
    expect(window.calls.at(-1)).toEqual({ ignore: true, forward: false });
    hxIgnoreMouse(window, false, options);
    expect(window.calls.at(-1)).toEqual({ ignore: false, forward: undefined });
    expect(stopped).toBe(1);
  });

  it("on Windows does not forward to a hidden window", () => {
    const window = new FakeWindow();
    window.visible = false;
    hxIgnoreMouse(window, true, {
      platform: "win32",
      cursor: () => ({ x: 150, y: 20 }),
      every: () => () => undefined,
    });
    expect(window.calls).toEqual([{ ignore: true, forward: false }]);
  });
});
