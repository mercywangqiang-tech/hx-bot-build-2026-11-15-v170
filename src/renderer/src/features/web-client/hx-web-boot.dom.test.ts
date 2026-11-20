// HXBot v1.7.5（UI-27）：网页版（bot.hxallai.com/app）的开机片：这台浏览器 30 天内播过就不播；
// 减少动态、省流量、2G、存储被挡都不播；一个页面只决定一次，开头那张图和客户端的画面一致。

import { HX_WEB_BOOT_PLAYED_KEY, HX_WEB_BOOT_REPLAY_MS, hxBootFit } from "@hxbot/contracts/hx-boot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = 1_800_000_000_000;

function memory(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
}

function blocked(): Storage {
  const fail = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

let storage: Storage;
let reduced = false;

function useStorage(next: Storage) {
  storage = next;
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => storage });
}

function useConnection(connection: { saveData?: boolean; effectiveType?: string } | null) {
  // `null`: a browser without the Network Information API (Safari, Firefox).
  Object.defineProperty(navigator, "connection", { configurable: true, value: connection ?? undefined });
}

function useWindow(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

/** A fresh page: the module decides again, as a new visit would. */
async function page() {
  vi.resetModules();
  return import("./hx-web-boot");
}

beforeEach(() => {
  reduced = false;
  useStorage(memory());
  useConnection(null);
  useWindow(1440, 900);
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") && reduced,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the web client plays the film once in 30 days in this browser", () => {
  it("plays on the first visit, not on the next visit, and again after 30 days", async () => {
    const first = await page();
    expect(first.hxWebBootFull()).toBe(true);
    first.hxWebBootPlayed();
    expect(storage.getItem(HX_WEB_BOOT_PLAYED_KEY)).toBe(String(NOW));

    const next = await page();
    expect(next.hxWebBootFull()).toBe(false);

    vi.spyOn(Date, "now").mockReturnValue(NOW + HX_WEB_BOOT_REPLAY_MS - 1);
    expect((await page()).hxWebBootFull()).toBe(false);
    vi.spyOn(Date, "now").mockReturnValue(NOW + HX_WEB_BOOT_REPLAY_MS);
    expect((await page()).hxWebBootFull()).toBe(true);
  });

  it("shares the record with the bot.hxallai.com page: a play there means no play here", async () => {
    storage.setItem(HX_WEB_BOOT_PLAYED_KEY, String(NOW - 60_000));
    expect((await page()).hxWebBootFull()).toBe(false);
  });

  it("decides once per page, so the film still plays after it records that it started", async () => {
    const boot = await page();
    expect(boot.hxWebBootFull()).toBe(true);
    boot.hxWebBootPlayed();
    expect(boot.hxWebBootFull()).toBe(true);
    expect(boot.hxWebBootStill().src).toContain("first");
  });

  it("a damaged record or a time in the future (clock set back) is handled", async () => {
    storage.setItem(HX_WEB_BOOT_PLAYED_KEY, "garbage");
    expect((await page()).hxWebBootFull()).toBe(true);
    storage.setItem(HX_WEB_BOOT_PLAYED_KEY, String(NOW + 3_600_000));
    expect((await page()).hxWebBootFull()).toBe(false);
  });

  it("an explicit storage is read each time and does not fix the page's decision", async () => {
    const boot = await page();
    const other = memory();
    other.setItem(HX_WEB_BOOT_PLAYED_KEY, String(NOW));
    expect(boot.hxWebBootFull(other, NOW)).toBe(false);
    expect(boot.hxWebBootFull()).toBe(true);
  });
});

describe("no film where it would harm", () => {
  it("reduced motion: the logo", async () => {
    reduced = true;
    const boot = await page();
    expect(boot.hxWebBootFull()).toBe(false);
    expect(boot.hxWebBootStill().src).toContain("logo");
  });

  it("a data saver or a 2G connection: the logo; 3G and 4G play", async () => {
    for (const [connection, plays] of [
      [{ saveData: true, effectiveType: "4g" }, false],
      [{ effectiveType: "2g" }, false],
      [{ effectiveType: "slow-2g" }, false],
      [{ effectiveType: "3g" }, true],
      [{ effectiveType: "4g", saveData: false }, true],
      [{}, true],
    ] as const) {
      useConnection(connection);
      expect((await page()).hxWebBootFull(), JSON.stringify(connection)).toBe(plays);
    }
  });

  it("storage blocked (private mode, a policy): no film, and nothing throws", async () => {
    useStorage(blocked());
    const boot = await page();
    expect(boot.hxWebBootFull()).toBe(false);
    expect(() => boot.hxWebBootPlayed()).not.toThrow();
    expect(boot.hxWebBootStill().src).toContain("logo");
  });

  it("a page opened in a background tab: no film, so a play nobody saw is not recorded", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      const boot = await page();
      expect(boot.hxWebBootFull()).toBe(false);
      expect(boot.hxWebBootStill().src).toContain("logo");
    } finally {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    }
    expect((await page()).hxWebBootFull()).toBe(true);
  });

  it("a browser without matchMedia still decides", async () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
    expect((await page()).hxWebBootFull()).toBe(true);
  });
});

describe("the still the page shows while the client loads", () => {
  it("uses the film for the window's shape and sits where the film will sit", async () => {
    for (const [width, height, aspect] of [
      [1440, 900, "16x9"],
      [1024, 768, "4x3"],
      [900, 1600, "9x16"],
      [393, 852, "9x16"],
    ] as const) {
      useWindow(width, height);
      const boot = await page();
      const still = boot.hxWebBootStill();
      expect(still.src).toBe(boot.HX_WEB_BOOT_SOURCES[aspect].first);
      expect(still.position).toBe(hxBootFit(aspect, width, height).objectPosition);
    }
  });

  it("every shape has a film, an AV1 film, a first frame and a logo", async () => {
    const boot = await page();
    for (const aspect of ["16x9", "4x3", "9x16"] as const) {
      const sources = boot.HX_WEB_BOOT_SOURCES[aspect];
      expect(sources.video).toMatch(/hxbot-boot-.+\.mp4/u);
      expect(sources.av1).toMatch(/av1/u);
      expect(sources.first).toMatch(/first/u);
      expect(sources.poster).toMatch(/logo/u);
    }
  });
});
