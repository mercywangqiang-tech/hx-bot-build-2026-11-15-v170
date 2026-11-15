// HXBot: the settings that a window kept in local storage before the rename keep working.
// `hx/brand_rename.py` leaves this file as it is, because it writes the earlier names on purpose.
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("local storage of a window that an earlier build used", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("gets the new keys before any module reads them, and a value under the new key wins", async () => {
    window.localStorage.setItem("openbot.sidebar.width", "320");
    window.localStorage.setItem("openbot-appearance", "dark");
    window.localStorage.setItem("openbot.draft.chief", "earlier draft");
    window.localStorage.setItem("hxbot.draft.chief", "current draft");
    window.localStorage.setItem("unrelated", "kept");

    await import("./hx-earlier-storage");

    expect(window.localStorage.getItem("hxbot.sidebar.width")).toBe("320");
    expect(window.localStorage.getItem("hxbot-appearance")).toBe("dark");
    expect(window.localStorage.getItem("hxbot.draft.chief")).toBe("current draft");
    expect(window.localStorage.getItem("unrelated")).toBe("kept");
    const earlier = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ).filter((key) => key !== null && /openbot/iu.test(key));
    expect(earlier).toEqual([]);
  });
});
