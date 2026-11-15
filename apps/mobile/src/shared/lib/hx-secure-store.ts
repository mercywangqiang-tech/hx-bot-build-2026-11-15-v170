// HXBot: the secure store of the app, as expo-secure-store gives it, with the values that earlier
// builds saved under the earlier names moved to the new names on first read (hx-earlier-secure-store.ts).
import * as Store from "expo-secure-store";
import { hxEarlierSecureStore } from "./hx-earlier-secure-store";

export * from "expo-secure-store";

const store = hxEarlierSecureStore<Store.SecureStoreOptions>(Store);

export const getItemAsync = store.getItemAsync;
export const getItem = store.getItem;
export const deleteItemAsync = store.deleteItemAsync;
