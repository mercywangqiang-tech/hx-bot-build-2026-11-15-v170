import { describe, expect, it } from "vitest";

import { hxPortalUrl } from "./hx-portal";

describe("hxPortalUrl", () => {
  it("opens the Chinese portal for Chinese and the English portal for the other languages", () => {
    expect(hxPortalUrl("zh", "reset")).toBe("https://bot.hxallai.com/?lang=zh&reset=1");
    expect(hxPortalUrl("zh", "register")).toBe("https://bot.hxallai.com/?lang=zh&register=1");
    expect(hxPortalUrl("en", "reset")).toBe("https://bot.hxallai.com/en/?reset=1");
    expect(hxPortalUrl("de", "register")).toBe("https://bot.hxallai.com/en/?register=1");
  });
});
