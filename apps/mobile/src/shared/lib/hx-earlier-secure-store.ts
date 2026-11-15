// HXBot: earlier builds saved the sign-in, the settings and the trusted host keys under keys
// and keychain services with the earlier name. Reading a key that has no value under the new name looks
// under the earlier name, moves the value to the new name and removes the earlier entry, so nobody
// signs in again or loses a setting. `hx-secure-store.ts` applies this to expo-secure-store.
import { hxEarlierName } from "@hxbot/contracts/hx-earlier-names";

export interface HxSecureStoreOptions {
  keychainService?: string;
}

/** The part of expo-secure-store that the move needs. */
export interface HxSecureStore<Options extends HxSecureStoreOptions> {
  getItemAsync(key: string, options?: Options): Promise<string | null>;
  getItem(key: string, options?: Options): string | null;
  setItemAsync(key: string, value: string, options?: Options): Promise<void>;
  setItem(key: string, value: string, options?: Options): void;
  deleteItemAsync(key: string, options?: Options): Promise<void>;
}

export function hxEarlierSecureStore<Options extends HxSecureStoreOptions>(store: HxSecureStore<Options>) {
  function earlierOptions(options: Options | undefined): Options | undefined {
    if (options?.keychainService === undefined) return options;
    return { ...options, keychainService: hxEarlierName(options.keychainService) };
  }

  function hasEarlier(key: string, options: Options | undefined): boolean {
    return hxEarlierName(key) !== key || earlierOptions(options)?.keychainService !== options?.keychainService;
  }

  return {
    async getItemAsync(key: string, options?: Options): Promise<string | null> {
      const value = await store.getItemAsync(key, options);
      if (value !== null || !hasEarlier(key, options)) return value;
      const earlierKey = hxEarlierName(key);
      const earlier = earlierOptions(options);
      const found = await store.getItemAsync(earlierKey, earlier);
      if (found === null) return null;
      await store.setItemAsync(key, found, options);
      await store.deleteItemAsync(earlierKey, earlier);
      return found;
    },

    getItem(key: string, options?: Options): string | null {
      const value = store.getItem(key, options);
      if (value !== null || !hasEarlier(key, options)) return value;
      const earlierKey = hxEarlierName(key);
      const earlier = earlierOptions(options);
      const found = store.getItem(earlierKey, earlier);
      if (found === null) return null;
      store.setItem(key, found, options);
      void store.deleteItemAsync(earlierKey, earlier).catch(() => undefined);
      return found;
    },

    async deleteItemAsync(key: string, options?: Options): Promise<void> {
      await store.deleteItemAsync(key, options);
      if (hasEarlier(key, options)) await store.deleteItemAsync(hxEarlierName(key), earlierOptions(options));
    },
  };
}
