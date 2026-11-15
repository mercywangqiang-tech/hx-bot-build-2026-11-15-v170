// HXBot: the sign-in, settings and app lock that the phone kept before the rename keep working.
// `hx/brand_rename.py` leaves this file as it is, because it writes the earlier names on purpose.
import { beforeEach, describe, expect, it } from "vitest";
import { type HxSecureStoreOptions, hxEarlierSecureStore } from "./hx-earlier-secure-store";

const stored = new Map<string, string>();
const at = (key: string, options?: HxSecureStoreOptions) => `${options?.keychainService ?? "app"}|${key}`;

/** The secure store of a phone, as a map. */
const phone = {
  getItemAsync: async (key: string, options?: HxSecureStoreOptions) => stored.get(at(key, options)) ?? null,
  getItem: (key: string, options?: HxSecureStoreOptions) => stored.get(at(key, options)) ?? null,
  setItemAsync: async (key: string, value: string, options?: HxSecureStoreOptions) => {
    stored.set(at(key, options), value);
  },
  setItem: (key: string, value: string, options?: HxSecureStoreOptions) => {
    stored.set(at(key, options), value);
  },
  deleteItemAsync: async (key: string, options?: HxSecureStoreOptions) => {
    stored.delete(at(key, options));
  },
};
const store = hxEarlierSecureStore(phone);

describe("the secure store of a phone that an earlier build used", () => {
  beforeEach(() => stored.clear());

  it("reads a value saved under the earlier key and moves it to the new key", async () => {
    stored.set(at("openbot.account-session"), "session");
    expect(await store.getItemAsync("hxbot.account-session")).toBe("session");
    expect(stored.get(at("hxbot.account-session"))).toBe("session");
    expect(stored.has(at("openbot.account-session"))).toBe(false);
    expect(await store.getItemAsync("hxbot.account-session")).toBe("session");
  });

  it("reads the app lock saved under the earlier keychain service", async () => {
    stored.set(at("pin", { keychainService: "openbot.app-lock" }), '{"hash":"x"}');
    const options = { keychainService: "hxbot.app-lock" };
    expect(await store.getItemAsync("pin", options)).toBe('{"hash":"x"}');
    expect(stored.get(at("pin", options))).toBe('{"hash":"x"}');
    expect(stored.has(at("pin", { keychainService: "openbot.app-lock" }))).toBe(false);
  });

  it("keeps a value saved under the new key, reads synchronously too, and deletes both names", async () => {
    stored.set(at("openbot.theme"), "earlier");
    await phone.setItemAsync("hxbot.theme", "current");
    expect(await store.getItemAsync("hxbot.theme")).toBe("current");
    stored.set(at("openbot.language"), "zh");
    expect(store.getItem("hxbot.language")).toBe("zh");
    await store.deleteItemAsync("hxbot.theme");
    expect(stored.has(at("hxbot.theme"))).toBe(false);
    expect(stored.has(at("openbot.theme"))).toBe(false);
    expect(await store.getItemAsync("hxbot.missing")).toBeNull();
    expect(await store.getItemAsync("plain-key")).toBeNull();
  });
});
