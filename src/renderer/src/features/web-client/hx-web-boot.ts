/**
 * HXBot (v1.7.5, UI-27): the start film of the web client (bot.hxallai.com/app). It replaces the loading
 * crew. A browser plays it when it has not played it in the last 30 days (`hxWebBootDue`); the time is
 * kept in this browser's storage only, under the key that the bot.hxallai.com page uses too, and nothing
 * is sent. Other visits show the logo while the client loads. The web films are smaller than the app's
 * (720p; AV1 where the browser can play it, H.264 elsewhere): bot.hxallai.com serves them over 10 Mbit/s.
 * The page shows the film's first frame (or the logo) while the client's code loads, so the film starts
 * from what is already on the screen. The film comes over the network beside the client's code, so it
 * may take up to 3 s to start (`HX_WEB_BOOT_START_MS`; the apps: 1 s); its first frame shows meanwhile.
 */

import { HX_WEB_BOOT_PLAYED_KEY, hxBootAspect, hxBootFit, hxWebBootDue } from "@hxbot/contracts/hx-boot";

export { HX_WEB_BOOT_START_MS } from "@hxbot/contracts/hx-boot";

import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import type { HxBootAspect, HxBootSources } from "@hxbot/ui/features/account/HxBootScreen";
import film4x3 from "../../assets/hx-boot/web/hxbot-boot-4x3.mp4";
import av14x3 from "../../assets/hx-boot/web/hxbot-boot-4x3-av1.mp4";
import first4x3 from "../../assets/hx-boot/web/hxbot-boot-4x3-first.jpg";
import poster4x3 from "../../assets/hx-boot/web/hxbot-boot-4x3-logo.png";
import film9x16 from "../../assets/hx-boot/web/hxbot-boot-9x16.mp4";
import av19x16 from "../../assets/hx-boot/web/hxbot-boot-9x16-av1.mp4";
import first9x16 from "../../assets/hx-boot/web/hxbot-boot-9x16-first.jpg";
import poster9x16 from "../../assets/hx-boot/web/hxbot-boot-9x16-logo.png";
import film16x9 from "../../assets/hx-boot/web/hxbot-boot-16x9.mp4";
import av116x9 from "../../assets/hx-boot/web/hxbot-boot-16x9-av1.mp4";
import first16x9 from "../../assets/hx-boot/web/hxbot-boot-16x9-first.jpg";
import poster16x9 from "../../assets/hx-boot/web/hxbot-boot-16x9-logo.png";

export const HX_WEB_BOOT_SOURCES: Readonly<Record<HxBootAspect, HxBootSources>> = {
  "16x9": { video: film16x9, av1: av116x9, first: first16x9, poster: poster16x9 },
  "4x3": { video: film4x3, av1: av14x3, first: first4x3, poster: poster4x3 },
  "9x16": { video: film9x16, av1: av19x16, first: first9x16, poster: poster9x16 },
};

type Reading = Pick<Storage, "getItem">;
type Writing = Pick<Storage, "setItem">;

let decided: boolean | null = null;

/**
 * Whether this page plays the film: decided once per page, so the page's first picture and the client's
 * screen agree. Reduced motion, a data saver, a 2G connection, blocked storage or a page opened in a
 * background tab (nobody would see it, and it would count as played): no film.
 */
export function hxWebBootFull(storage?: Reading, now = Date.now()): boolean {
  if (decided !== null && storage === undefined) return decided;
  let full: boolean;
  try {
    const hidden = document.visibilityState === "hidden";
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const connection = "connection" in navigator ? navigator.connection : null;
    const saving =
      isDynamicRecord(connection) &&
      (connection.saveData === true ||
        (typeof connection.effectiveType === "string" && /(^|-)2g$/u.test(connection.effectiveType)));
    full =
      !hidden &&
      !reduced &&
      !saving &&
      hxWebBootDue((storage ?? window.localStorage).getItem(HX_WEB_BOOT_PLAYED_KEY), now);
  } catch {
    full = false;
  }
  if (storage === undefined) decided = full;
  return full;
}

/** The film started: this browser does not play it again for 30 days. */
export function hxWebBootPlayed(storage?: Writing, now = Date.now()): void {
  try {
    (storage ?? window.localStorage).setItem(HX_WEB_BOOT_PLAYED_KEY, String(now));
  } catch {
    // Not kept: the next visit may play it again, which harms nothing.
  }
}

/** What the page shows while the client's code loads: the film's first frame, or the logo. */
export function hxWebBootStill(): { src: string; position: string } {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = hxBootAspect(width, height);
  const sources = HX_WEB_BOOT_SOURCES[aspect];
  return {
    src: hxWebBootFull() ? sources.first : sources.poster,
    position: hxBootFit(aspect, width, height).objectPosition,
  };
}
