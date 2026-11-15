import { afterEach, describe, expect, it } from "vitest";

import {
  type HxFetch,
  hxMobileRelease,
  hxOpenNewVersion,
  hxRememberUpdateSession,
  hxSiteOrigin,
} from "./hx-app-update";

const SESSION = { apiUrl: "https://api.bot.hxallai.com", sessionToken: "phone-session" };
const RELEASES = {
  android: { version: "1.5.0", url: "https://bot.hxallai.com/ota/0123456789abcdef0123456789abcdef/HXBot.apk" },
  ios: {
    version: "1.5.0",
    url: "itms-services://?action=download-manifest&url=https%3A%2F%2Fbot.hxallai.com%2Fota%2F0123456789abcdef0123456789abcdef%2Fmanifest.plist",
  },
};

afterEach(() => hxRememberUpdateSession(null));

describe("the new version of the phone app", () => {
  it("is asked of the site of the account server", () => {
    expect(hxSiteOrigin("https://api.bot.hxallai.com")).toBe("https://bot.hxallai.com");
    expect(hxSiteOrigin("http://localhost:8787/")).toBe("http://localhost:8787");
  });

  it("opens only the server's own addresses and the iPhone install link", () => {
    expect(hxMobileRelease(RELEASES, "android")).toEqual(RELEASES.android);
    expect(hxMobileRelease(RELEASES, "ios")).toEqual(RELEASES.ios);
    expect(hxMobileRelease({ ios: { url: "https://testflight.apple.com/join/AbCd1234" } }, "ios")).toEqual({
      version: "",
      url: "https://testflight.apple.com/join/AbCd1234",
    });
    expect(hxMobileRelease({ android: { url: "javascript:alert(1)" } }, "android")).toBeNull();
    expect(hxMobileRelease({ android: { url: "http://bot.hxallai.com/x.apk" } }, "android")).toBeNull();
    expect(hxMobileRelease({}, "ios")).toBeNull();
    expect(hxMobileRelease(null, "ios")).toBeNull();
  });

  it("opens the installer with the phone's session, and leaves the portal to the caller otherwise", async () => {
    const opened: string[] = [];
    const open = async (url: string) => {
      opened.push(url);
    };
    const asked: { url: string; authorization: string | null }[] = [];
    const fetcher: HxFetch = async (url, init) => {
      asked.push({ url, authorization: init.headers.Authorization ?? null });
      return new Response(JSON.stringify(RELEASES), { status: 200 });
    };
    // Signed out: no question asked.
    expect(await hxOpenNewVersion("android", open, fetcher)).toBe(false);
    hxRememberUpdateSession(SESSION);
    expect(await hxOpenNewVersion("android", open, fetcher)).toBe(true);
    expect(asked).toEqual([
      { url: "https://bot.hxallai.com/updates/mobile.json", authorization: "Bearer phone-session" },
    ]);
    expect(opened).toEqual([RELEASES.android.url]);
    const refused: HxFetch = async () => new Response("{}", { status: 401 });
    expect(await hxOpenNewVersion("ios", open, refused)).toBe(false);
    const offline: HxFetch = async () => {
      throw new TypeError("offline");
    };
    expect(await hxOpenNewVersion("ios", open, offline)).toBe(false);
  });
});
