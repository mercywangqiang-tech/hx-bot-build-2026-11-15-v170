/**
 * HXBot (v1.7.5, UI-27): whether the start film plays on this phone. It plays on the first start and on
 * the first start after each update of the app; the version that played it and the sound setting stay
 * on this phone (SecureStore), and nothing is sent.
 */
import * as Application from "expo-application";
import { create } from "zustand";
import * as SecureStore from "@/shared/lib/hx-secure-store";

const PLAYED_KEY = "hxbot.mobile.hxBootPlayed.v1";
const SOUND_KEY = "hxbot.mobile.hxBootSound.v1";

/** The film for a screen of this size: 16:9 from 1.6, 4:3 from 1.2, else 9:16 (as on the desktop and the web). */
export { type HxBootAspect, hxBootAspect } from "@hxbot/contracts/hx-boot";

export const useHxBoot = create<{ ready: boolean; full: boolean; sound: boolean; saving: boolean }>(() => ({
  ready: false,
  full: false,
  sound: false,
  saving: false,
}));

/** Reads once at start. A failed read shows no film: the calm choice. */
export async function loadHxBoot(): Promise<void> {
  if (useHxBoot.getState().ready) return;
  try {
    const version = Application.nativeApplicationVersion;
    const [played, sound] = await Promise.all([
      SecureStore.getItemAsync(PLAYED_KEY),
      SecureStore.getItemAsync(SOUND_KEY),
    ]);
    useHxBoot.setState({ full: version !== null && played !== version, sound: sound === "true" });
  } catch {
    useHxBoot.setState({ full: false });
  } finally {
    useHxBoot.setState({ ready: true });
  }
}

/** The film started: this version played it here. */
export async function markHxBootPlayed(): Promise<void> {
  const version = Application.nativeApplicationVersion;
  if (version === null) return;
  await SecureStore.setItemAsync(PLAYED_KEY, version).catch(() => undefined);
}

export async function saveHxBootSound(on: boolean): Promise<void> {
  if (useHxBoot.getState().saving) return;
  useHxBoot.setState({ sound: on, saving: true });
  try {
    await SecureStore.setItemAsync(SOUND_KEY, String(on));
  } finally {
    useHxBoot.setState({ saving: false });
  }
}
