import { describe, expect, it } from "vitest";
import { hxClientHeaders, hxClientValue, hxVersionOlder } from "./hx-client-header";

describe("HXBot client header", () => {
  it("adds the client and keeps the other headers of every shape", () => {
    expect(hxClientHeaders({ Authorization: "Bearer t" }, "ios/1.5.0")).toEqual({
      Authorization: "Bearer t",
      "X-HXBot-Client": "ios/1.5.0",
    });
    expect(hxClientHeaders([["Content-Type", "application/json"]], "android/1.5.0")).toEqual({
      "Content-Type": "application/json",
      "X-HXBot-Client": "android/1.5.0",
    });
    expect(hxClientHeaders(new Headers({ "x-hxbot-client": "old" }), "ios/1.5.0")).toEqual({
      "X-HXBot-Client": "ios/1.5.0",
    });
    expect(hxClientHeaders(undefined, "ios/1.5.0")).toEqual({ "X-HXBot-Client": "ios/1.5.0" });
  });

  it("names the platform and a version that can be compared", () => {
    expect(hxClientValue("ios", "1.5.0")).toBe("ios/1.5.0");
    expect(hxClientValue("android", "1.5.0")).toBe("android/1.5.0");
    expect(hxClientValue("ios", null)).toBeNull();
    expect(hxClientValue("ios", "dev")).toBeNull();
  });

  it("compares versions by their parts", () => {
    expect(hxVersionOlder("1.4.9", "1.5.0")).toBe(true);
    expect(hxVersionOlder("1.5.0", "1.5.0")).toBe(false);
    expect(hxVersionOlder("1.10.0", "1.9.9")).toBe(false);
    expect(hxVersionOlder("1.5", "1.5.1")).toBe(true);
  });
});
