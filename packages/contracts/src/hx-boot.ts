// HXBot (v1.7.5, UI-27): the start film's geometry, shared by the desktop (Mac, Windows), the phones
// (Android, iOS) and the web client: which of the three films a window shows, and where a film that
// covers the window sits, so the logo and the name "HXBot" are never cut.
//
// - Aspect: width / height from 1.6 the 16:9 film, from 1.2 the 4:3 film, below it the 9:16 film.
// - The film covers the window at its own proportions (no bar, no stretch). Where the window is wider or
//   taller than the film, the part that is cut is chosen so that the safe area of that film (the logo and
//   the name at the end) stays whole, and as near the middle as it can. A window so narrow or so wide that
//   even this cuts the safe area keeps its middle.
// The films have a pure white backdrop (2026-11-20), so the part that a window cuts is white.

export type HxBootAspect = "16x9" | "4x3" | "9x16";

export const HX_BOOT_ASPECTS: readonly HxBootAspect[] = ["16x9", "4x3", "9x16"];

/** Width / height of each film. */
export const HX_BOOT_FILM_RATIO: Readonly<Record<HxBootAspect, number>> = {
  "16x9": 2560 / 1440,
  "4x3": 1920 / 1440,
  "9x16": 1440 / 2560,
};

/**
 * The part of each film that a window must never cut, as fractions of the film: the logo and the name
 * at the end with a margin. Measured on the built films (logo x 0.407–0.594, name down to y 0.931 in 16:9).
 */
export const HX_BOOT_SAFE: Readonly<
  Record<HxBootAspect, { readonly x: readonly [number, number]; readonly y: readonly [number, number] }>
> = {
  "16x9": { x: [0.39, 0.61], y: [0.23, 0.95] },
  "4x3": { x: [0.36, 0.64], y: [0.23, 0.95] },
  "9x16": { x: [0.39, 0.61], y: [0.4, 0.66] },
};

/** The film for a window of this size. */
export function hxBootAspect(width: number, height: number): HxBootAspect {
  const ratio = height > 0 ? width / height : 1;
  if (ratio >= 1.6) return "16x9";
  if (ratio >= 1.2) return "4x3";
  return "9x16";
}

/** Where a covering film sits in a window: CSS `object-position`, and the size and offset in pixels. */
export interface HxBootFit {
  /** `"x% y%"`. */
  readonly objectPosition: string;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
}

/** The start (0–1 of the film) of the part that a window of `visible` (0–1) shows on one axis. */
function placeAxis(visible: number, safe: readonly [number, number]): number {
  if (visible >= 1) return 0;
  const centred = 0.5 - visible / 2;
  const [low, high] = safe;
  // The window shows [start, start + visible]: it holds the safe part when high - visible <= start <= low.
  const lowest = Math.max(0, high - visible);
  const highest = Math.min(1 - visible, low);
  if (lowest > highest) return Math.min(Math.max(centred, 0), 1 - visible);
  return Math.min(Math.max(centred, lowest), highest);
}

/** How the film of `aspect` covers a window of `width` x `height` pixels. */
export function hxBootFit(aspect: HxBootAspect, width: number, height: number): HxBootFit {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const ratio = HX_BOOT_FILM_RATIO[aspect];
  // Cover: the film is at least as wide and as tall as the window.
  const filmWidth = Math.max(w, h * ratio);
  const filmHeight = filmWidth / ratio;
  const visibleX = w / filmWidth;
  const visibleY = h / filmHeight;
  const startX = placeAxis(visibleX, HX_BOOT_SAFE[aspect].x);
  const startY = placeAxis(visibleY, HX_BOOT_SAFE[aspect].y);
  const percent = (start: number, visible: number) => (visible >= 1 ? 50 : (start / (1 - visible)) * 100);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    objectPosition: `${round(percent(startX, visibleX))}% ${round(percent(startY, visibleY))}%`,
    width: filmWidth,
    height: filmHeight,
    left: -startX * filmWidth,
    top: -startY * filmHeight,
  };
}

/**
 * On the web the film comes over the network, beside the web client's own code, while its first frame
 * already shows: it may take this long to start before the logo shows instead. The apps play a file on
 * the device and keep the 1 s of UI-27-A5.
 */
export const HX_WEB_BOOT_START_MS = 3_000;

/** The web keeps when this browser last played the film; within this time the film does not play again. */
export const HX_WEB_BOOT_REPLAY_MS = 30 * 24 * 3_600_000;
/** The key in the browser's storage, shared by bot.hxallai.com and bot.hxallai.com/app. */
export const HX_WEB_BOOT_PLAYED_KEY = "hxbot:web-boot-played-at";

/**
 * Whether the web plays the film now: never played here, or last played 30 days ago or more. A time in
 * the future (the clock was set back) counts as played now, so the film does not play on each visit.
 */
export function hxWebBootDue(playedAt: string | null, now: number): boolean {
  if (playedAt === null) return true;
  const at = Number(playedAt);
  if (!Number.isFinite(at) || at <= 0) return true;
  if (at > now + 60_000) return false;
  return now - at >= HX_WEB_BOOT_REPLAY_MS;
}
