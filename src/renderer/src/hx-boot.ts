/**
 * HXBot (v1.7.5, UI-27): what the start screen of this computer needs: the three films that the app
 * ships (no download), whether this version played the film here, and the sound setting
 * (Settings · Appearance). Both are kept in this window's storage only; nothing is sent.
 */

import type { HxBootAspect, HxBootSources } from "@hxbot/ui/features/account/HxBootScreen";
import film4x3 from "./assets/hx-boot/hxbot-boot-4x3.mp4";
import first4x3 from "./assets/hx-boot/hxbot-boot-4x3-first.jpg";
import poster4x3 from "./assets/hx-boot/hxbot-boot-4x3-logo.png";
import film9x16 from "./assets/hx-boot/hxbot-boot-9x16.mp4";
import first9x16 from "./assets/hx-boot/hxbot-boot-9x16-first.jpg";
import poster9x16 from "./assets/hx-boot/hxbot-boot-9x16-logo.png";
import film16x9 from "./assets/hx-boot/hxbot-boot-16x9.mp4";
import first16x9 from "./assets/hx-boot/hxbot-boot-16x9-first.jpg";
import poster16x9 from "./assets/hx-boot/hxbot-boot-16x9-logo.png";

export const HX_BOOT_SOURCES: Readonly<Record<HxBootAspect, HxBootSources>> = {
  "16x9": { video: film16x9, first: first16x9, poster: poster16x9 },
  "4x3": { video: film4x3, first: first4x3, poster: poster4x3 },
  "9x16": { video: film9x16, first: first9x16, poster: poster9x16 },
};

/** The version whose film played on this computer. */
const PLAYED_KEY = "hxbot:hx-boot-played";
const SOUND_KEY = "hxbot:hx-boot-sound";

type Reading = Pick<Storage, "getItem">;
type Writing = Pick<Storage, "setItem">;

/** The film plays when this version has not played it here: the first start, or the first after an upgrade. */
export function hxBootFull(version: string, storage?: Reading): boolean {
  try {
    return (storage ?? window.localStorage).getItem(PLAYED_KEY) !== version;
  } catch {
    // Blocked storage: no record, so no film each time; the logo is the calm choice.
    return false;
  }
}

export function hxBootPlayed(version: string, storage?: Writing): void {
  try {
    (storage ?? window.localStorage).setItem(PLAYED_KEY, version);
  } catch {
    // Not kept: the next start shows the logo anyway (see hxBootFull).
  }
}

export function hxBootSound(storage?: Reading): boolean {
  try {
    return (storage ?? window.localStorage).getItem(SOUND_KEY) === "true";
  } catch {
    return false;
  }
}

export function setHxBootSound(on: boolean, storage?: Writing): void {
  try {
    (storage ?? window.localStorage).setItem(SOUND_KEY, String(on));
  } catch {
    // Kept for nothing: the default (off) holds.
  }
}
