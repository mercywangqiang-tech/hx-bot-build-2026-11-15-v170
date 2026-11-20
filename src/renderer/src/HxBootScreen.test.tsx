// HXBot v1.7.5（UI-27）：开机画面（HxBootScreen）和本机记下的“播过没有”、声音设置（hx-boot.ts）。

import { HX_WEB_BOOT_REPLAY_MS, HX_WEB_BOOT_START_MS, hxBootFit, hxWebBootDue } from "@hxbot/contracts/hx-boot";
import {
  HX_BOOT_FADE_MS,
  HX_BOOT_FILM_CAP_MS,
  HX_BOOT_LOGO_MS,
  HX_BOOT_SKIP_ANYWAY_MS,
  HX_BOOT_START_MS,
  HxBootScreen,
  type HxBootSources,
  hxBootAspect,
} from "@hxbot/ui/features/account/HxBootScreen";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hxBootFull, hxBootPlayed, hxBootSound, setHxBootSound } from "./hx-boot";

const SOURCES: Record<"16x9" | "4x3" | "9x16", HxBootSources> = {
  "16x9": { video: "wide.mp4", first: "wide-first.jpg", poster: "wide.png" },
  "4x3": { video: "standard.mp4", first: "standard-first.jpg", poster: "standard.png" },
  "9x16": { video: "tall.mp4", first: "tall-first.jpg", poster: "tall.png" },
};

function memory(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no media: play resolves, pause does nothing.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

afterEach(() => {
  // A press on the screen keeps its end from the page for a moment: let that end before the next test.
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const film = () => document.querySelector<HTMLVideoElement>('video[data-hx-boot="film"]');
const poster = () => document.querySelector('[data-hx-boot="poster"]');
const stage = () => document.querySelector("[data-stage]")?.getAttribute("data-stage");
const advance = (ms: number) => {
  vi.advanceTimersByTime(ms);
  flush();
};

function mount(
  options: { full?: boolean; ready?: boolean; size?: { width: number; height: number }; startWithinMs?: number } = {},
) {
  const [ready, setReady] = createSignal(options.ready ?? true);
  const exited = vi.fn();
  const played = vi.fn();
  const mounted = vi.fn();
  const view = render(() => (
    <HxBootScreen
      sources={SOURCES}
      full={options.full ?? true}
      sound={false}
      ready={ready()}
      onPlayed={played}
      onMountViews={mounted}
      onExited={exited}
      size={() => options.size ?? { width: 1440, height: 900 }}
      startWithinMs={options.startWithinMs}
    />
  ));
  flush();
  return { view, exited, played, mounted, setReady };
}

function playFor(seconds: number) {
  const element = film();
  if (!element) throw new Error("no film");
  fireEvent(element, new Event("playing"));
  Object.defineProperty(element, "currentTime", { configurable: true, value: seconds });
}

describe("the start film (UI-27)", () => {
  it("UI-27-A3: chooses the film by the window: 16:9 from 1.6, 4:3 from 1.2, else 9:16", () => {
    expect(hxBootAspect(1440, 900)).toBe("16x9");
    expect(hxBootAspect(1024, 768)).toBe("4x3");
    expect(hxBootAspect(900, 1600)).toBe("9x16");
    expect(hxBootAspect(1600, 1000)).toBe("16x9");
    expect(hxBootAspect(1199, 1000)).toBe("9x16");
    expect(hxBootAspect(1200, 1000)).toBe("4x3");
    expect(hxBootAspect(100, 0)).toBe("9x16");
    for (const [size, src] of [
      [{ width: 1440, height: 900 }, "wide.mp4"],
      [{ width: 1024, height: 768 }, "standard.mp4"],
      [{ width: 900, height: 1600 }, "tall.mp4"],
    ] as const) {
      const { view } = mount({ size });
      expect(film()?.getAttribute("src")).toBe(src);
      view.unmount();
    }
  });

  it("plays to its end, says it played, mounts the views at once, and goes in when the app is ready", () => {
    const { exited, played, mounted, setReady } = mount({ ready: false });
    expect(mounted).toHaveBeenCalledTimes(1);
    playFor(0.1);
    expect(played).toHaveBeenCalledTimes(1);
    fireEvent(film() ?? document.body, new Event("ended"));
    flush();
    advance(HX_BOOT_FADE_MS + 10);
    // The film ended before the app was ready: its last frame (the logo) holds.
    expect(exited).not.toHaveBeenCalled();
    setReady(true);
    flush();
    advance(HX_BOOT_FADE_MS + 10);
    expect(exited).toHaveBeenCalledTimes(1);
  });

  it("UI-27-A4: a key in the first second does nothing; after it, a key goes in within 300 ms", () => {
    const { exited } = mount();
    playFor(0.5);
    fireEvent.keyDown(window, { key: "a" });
    advance(300);
    expect(exited).not.toHaveBeenCalled();
    expect(stage()).toBe("film");
    playFor(1.5);
    fireEvent.keyDown(window, { key: "a" });
    advance(300);
    expect(exited).toHaveBeenCalledTimes(1);
  });

  it("while the screen covers the app, no press reaches the app; shortcuts pass; the app takes the next press", () => {
    const { exited } = mount();
    const reached: string[] = [];
    const listen = (event: Event) => reached.push(event.type);
    const types = ["keydown", "keyup", "pointerdown", "pointerup", "click"];
    for (const type of types) document.addEventListener(type, listen);
    try {
      playFor(0.5);
      const early = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
      document.body.dispatchEvent(early);
      expect(early.defaultPrevented).toBe(true);
      fireEvent.keyUp(document.body, { key: "a" });
      fireEvent.pointerDown(document.body);
      fireEvent.pointerUp(document.body);
      fireEvent.click(document.body);
      expect(reached).toEqual([]);
      expect(stage()).toBe("film");

      const shortcut = new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true });
      document.body.dispatchEvent(shortcut);
      expect(shortcut.defaultPrevented).toBe(false);
      expect(reached).toEqual(["keydown"]);
      expect(stage()).toBe("film");
      reached.length = 0;

      playFor(1.5);
      fireEvent.pointerDown(document.body);
      advance(HX_BOOT_FADE_MS + 10);
      expect(exited).toHaveBeenCalledTimes(1);
      // The press that skipped ends after the screen has gone: its release and its click stay off the app.
      fireEvent.pointerUp(document.body);
      fireEvent.click(document.body);
      expect(reached).toEqual([]);
      // The next press is the app's.
      fireEvent.pointerDown(document.body);
      fireEvent.pointerUp(document.body);
      fireEvent.click(document.body);
      fireEvent.keyDown(document.body, { key: "b" });
      fireEvent.keyUp(document.body, { key: "b" });
      expect(reached).toEqual(["pointerdown", "pointerup", "click", "keydown", "keyup"]);
    } finally {
      for (const type of types) document.removeEventListener(type, listen);
    }
  });

  it("a key that skips: its release does not reach the app, and the next key does", () => {
    const { exited } = mount();
    const reached: string[] = [];
    const listen = (event: KeyboardEvent) => reached.push(`${event.type}:${event.key}`);
    document.addEventListener("keydown", listen);
    document.addEventListener("keyup", listen);
    try {
      playFor(1.2);
      fireEvent.keyDown(document.body, { key: " " });
      advance(HX_BOOT_FADE_MS + 10);
      expect(exited).toHaveBeenCalledTimes(1);
      fireEvent.keyUp(document.body, { key: " " });
      fireEvent.keyDown(document.body, { key: "x" });
      fireEvent.keyUp(document.body, { key: "x" });
      expect(reached).toEqual(["keydown:x", "keyup:x"]);
    } finally {
      document.removeEventListener("keydown", listen);
      document.removeEventListener("keyup", listen);
    }
  });

  it("a click after the first second goes in too", () => {
    const { exited } = mount();
    playFor(1.2);
    fireEvent.pointerDown(window);
    advance(HX_BOOT_FADE_MS + 10);
    expect(exited).toHaveBeenCalledTimes(1);
  });

  it("UI-27-A5: a film that fails, or does not start within 1 s, shows the logo and goes in", () => {
    const failing = mount();
    fireEvent(film() ?? document.body, new Event("error"));
    flush();
    expect(stage()).toBe("logo");
    expect(poster()?.getAttribute("src")).toBe("wide.png");
    advance(HX_BOOT_LOGO_MS + HX_BOOT_FADE_MS + 10);
    expect(failing.exited).toHaveBeenCalledTimes(1);
    expect(failing.played).not.toHaveBeenCalled();
    failing.view.unmount();

    const slow = mount();
    advance(HX_BOOT_START_MS + 1);
    expect(stage()).toBe("logo");
    advance(HX_BOOT_LOGO_MS + HX_BOOT_FADE_MS + 10);
    expect(slow.exited).toHaveBeenCalledTimes(1);
  });

  it("the web gives its film 3 s to start, its first frame showing meanwhile; then the logo", () => {
    const { exited } = mount({ startWithinMs: HX_WEB_BOOT_START_MS });
    advance(HX_BOOT_START_MS + 500);
    expect(stage()).toBe("film");
    expect(document.querySelector('[data-hx-boot="first"]')).not.toBeNull();
    advance(HX_WEB_BOOT_START_MS - HX_BOOT_START_MS - 500 + 1);
    expect(stage()).toBe("logo");
    advance(HX_BOOT_LOGO_MS + HX_BOOT_FADE_MS + 10);
    expect(exited).toHaveBeenCalledTimes(1);
  });

  it("a film that started on the web within 3 s plays on", () => {
    const { played } = mount({ startWithinMs: HX_WEB_BOOT_START_MS });
    advance(2_500);
    playFor(0);
    advance(1_000);
    expect(stage()).toBe("film");
    expect(played).toHaveBeenCalledTimes(1);
  });

  it("a film that is slow or stuck can be skipped 2 s after the screen came", () => {
    const { exited } = mount({ startWithinMs: HX_WEB_BOOT_START_MS });
    playFor(0.2);
    advance(HX_BOOT_SKIP_ANYWAY_MS - 100);
    fireEvent.keyDown(window, { key: "a" });
    advance(HX_BOOT_FADE_MS + 10);
    expect(exited).not.toHaveBeenCalled();
    advance(200);
    fireEvent.keyDown(window, { key: "a" });
    advance(HX_BOOT_FADE_MS + 10);
    expect(exited).toHaveBeenCalledTimes(1);
  });

  it("a stuck film goes in by itself 20 s after the screen came; the logo holds if the app is not ready", () => {
    const stuck = mount();
    playFor(0.4);
    advance(HX_BOOT_FILM_CAP_MS - 10);
    expect(stage()).toBe("film");
    advance(HX_BOOT_FADE_MS + 20);
    expect(stuck.exited).toHaveBeenCalledTimes(1);
    stuck.view.unmount();

    const waiting = mount({ ready: false });
    playFor(0.4);
    advance(HX_BOOT_FILM_CAP_MS + 10);
    expect(stage()).toBe("logo");
    expect(waiting.exited).not.toHaveBeenCalled();
    waiting.setReady(true);
    flush();
    advance(HX_BOOT_FADE_MS + 10);
    expect(waiting.exited).toHaveBeenCalledTimes(1);
  });

  it("a film that ends before 20 s is not cut short or ended twice", () => {
    const { exited } = mount();
    playFor(0.1);
    fireEvent(film() ?? document.body, new Event("ended"));
    flush();
    advance(HX_BOOT_FILM_CAP_MS + HX_BOOT_FADE_MS + 10);
    expect(exited).toHaveBeenCalledTimes(1);
  });

  it("UI-27-A5: with reduced motion there is no film, only the logo", () => {
    const reduce = (query: string): MediaQueryList => ({
      matches: query.includes("reduce"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
    Object.defineProperty(window, "matchMedia", { configurable: true, value: reduce });
    const { exited } = mount();
    expect(film()).toBeNull();
    expect(stage()).toBe("logo");
    advance(HX_BOOT_LOGO_MS + HX_BOOT_FADE_MS + 10);
    expect(exited).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("UI-27-A2: a start that is not the first shows the logo for 0.6 s; a poster that fails shows the logo mark", () => {
    const { exited } = mount({ full: false });
    expect(film()).toBeNull();
    advance(HX_BOOT_LOGO_MS - 50);
    expect(exited).not.toHaveBeenCalled();
    advance(50 + HX_BOOT_FADE_MS + 10);
    expect(exited).toHaveBeenCalledTimes(1);
    fireEvent(poster() ?? document.body, new Event("error"));
    flush();
    expect(document.querySelector('[data-hx-boot="logo"]')).not.toBeNull();
  });

  it("UI-27-A2: the film plays once per version on this computer, again after an upgrade", () => {
    const storage = memory();
    expect(hxBootFull("0.67.15", storage)).toBe(true);
    hxBootPlayed("0.67.15", storage);
    expect(hxBootFull("0.67.15", storage)).toBe(false);
    expect(hxBootFull("0.67.16", storage)).toBe(true);
  });

  it("the sound is off until turned on", () => {
    const storage = memory();
    expect(hxBootSound(storage)).toBe(false);
    setHxBootSound(true, storage);
    expect(hxBootSound(storage)).toBe(true);
    setHxBootSound(false, storage);
    expect(hxBootSound(storage)).toBe(false);
  });

  it("the film's first frame shows under the film until it plays; the logo after it", () => {
    const { view } = mount();
    expect(document.querySelector('[data-hx-boot="first"]')?.getAttribute("src")).toBe("wide-first.jpg");
    fireEvent(film() ?? document.body, new Event("error"));
    flush();
    expect(document.querySelector('[data-hx-boot="first"]')).toBeNull();
    expect(poster()?.getAttribute("src")).toBe("wide.png");
    view.unmount();
  });

  it("a browser that plays AV1 gets the AV1 film; others get H.264", () => {
    const sources = { ...SOURCES, "16x9": { ...SOURCES["16x9"], av1: "wide-av1.mp4" } };
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    const first = render(() => (
      <HxBootScreen
        sources={sources}
        full
        sound={false}
        ready
        onExited={() => {}}
        size={() => ({ width: 1440, height: 900 })}
      />
    ));
    flush();
    expect(film()?.getAttribute("src")).toBe("wide-av1.mp4");
    first.unmount();
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("");
    render(() => (
      <HxBootScreen
        sources={sources}
        full
        sound={false}
        ready
        onExited={() => {}}
        size={() => ({ width: 1440, height: 900 })}
      />
    ));
    flush();
    expect(film()?.getAttribute("src")).toBe("wide.mp4");
  });
});

describe("where a covering film sits (hxBootFit), so the logo and the name are never cut", () => {
  const visible = (fit: ReturnType<typeof hxBootFit>, width: number, height: number) => ({
    x: [-fit.left / fit.width, (-fit.left + width) / fit.width],
    y: [-fit.top / fit.height, (-fit.top + height) / fit.height],
  });
  it("keeps the safe part whole in every window of the spec and the extremes", () => {
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
      [900, 1600],
      [3440, 1440],
      [2560, 1080],
      [1920, 1200],
      [1200, 1000],
      [1199, 1000],
      [393, 852],
      [430, 932],
      [768, 1024],
      [1600, 1000],
    ] as const) {
      const ratio = width / height;
      const aspect = ratio >= 1.6 ? "16x9" : ratio >= 1.2 ? "4x3" : "9x16";
      const fit = hxBootFit(aspect, width, height);
      expect(fit.width).toBeGreaterThanOrEqual(width - 0.001);
      expect(fit.height).toBeGreaterThanOrEqual(height - 0.001);
      const shown = visible(fit, width, height);
      const safe = {
        "16x9": { left: 0.39, right: 0.61, top: 0.23, bottom: 0.95 },
        "4x3": { left: 0.36, right: 0.64, top: 0.23, bottom: 0.95 },
        "9x16": { left: 0.39, right: 0.61, top: 0.4, bottom: 0.66 },
      }[aspect];
      expect(shown.x[0]).toBeLessThanOrEqual(safe.left + 1e-9);
      expect(shown.x[1]).toBeGreaterThanOrEqual(safe.right - 1e-9);
      expect(shown.y[0]).toBeLessThanOrEqual(safe.top + 1e-9);
      expect(shown.y[1]).toBeGreaterThanOrEqual(safe.bottom - 1e-9);
    }
  });
});

describe("the web plays the film at most once in 30 days in a browser", () => {
  const now = 1_800_000_000_000;
  it("plays when never played, when the record is damaged, and 30 days after", () => {
    expect(hxWebBootDue(null, now)).toBe(true);
    expect(hxWebBootDue("not a time", now)).toBe(true);
    expect(hxWebBootDue(String(now - HX_WEB_BOOT_REPLAY_MS), now)).toBe(true);
  });
  it("does not play within 30 days, or when the clock was set back", () => {
    expect(hxWebBootDue(String(now - 1), now)).toBe(false);
    expect(hxWebBootDue(String(now - HX_WEB_BOOT_REPLAY_MS + 1), now)).toBe(false);
    expect(hxWebBootDue(String(now + 10 * 60_000), now)).toBe(false);
  });
});
