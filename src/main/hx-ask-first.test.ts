import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {},
  BrowserWindow: { getFocusedWindow: () => null },
  Notification: { isSupported: () => false },
}));

const { HX_ASK_AGAIN_MS, HX_OPEN_AGAIN_MS, HxAskFirst } = await import("./hx-ask-first");

const TEXT = { title: "t", body: "b" };

function setup(inHxbot: boolean) {
  let now = 100_000;
  const clicks: (() => void)[] = [];
  const opened: string[] = [];
  const ask = new HxAskFirst({
    userInHxbot: () => inHxbot,
    notify: (_text, onClick) => {
      clicks.push(onClick);
      return { close: () => undefined };
    },
    now: () => now,
  });
  const open = (key: string) => ask.open(key, async () => void opened.push(key), TEXT);
  return { open, opened, clicks, advance: (ms: number) => (now += ms) };
}

describe("HXBot does not take the front from another app (v1.7.0, F4)", () => {
  it("opens the page at once while the user works in HXBot, and not again a short time later", async () => {
    const t = setup(true);
    expect(await t.open("automation")).toBe("opened");
    expect(await t.open("automation")).toBe("skipped");
    t.advance(HX_OPEN_AGAIN_MS);
    expect(await t.open("automation")).toBe("opened");
    expect(t.opened).toEqual(["automation", "automation"]);
  });

  it("only asks while the user works in another app, and opens the page on the click", async () => {
    const t = setup(false);
    expect(await t.open("accessibility")).toBe("asked");
    expect(t.opened).toEqual([]);
    expect(await t.open("accessibility")).toBe("skipped");
    t.clicks[0]?.();
    await Promise.resolve();
    expect(t.opened).toEqual(["accessibility"]);
    t.advance(HX_ASK_AGAIN_MS);
    expect(await t.open("accessibility")).toBe("asked");
    expect(t.clicks).toHaveLength(2);
  });
});
