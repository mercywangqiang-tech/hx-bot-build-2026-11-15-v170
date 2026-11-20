/**
 * HXBot (v1.7.5, UI-27, SCR-00): the start screen. The film "长颈鹿与气球" (15.7 s at 24 fps as supplied,
 * white backdrop; the giraffe becomes the HXBot logo at about 12 s and the logo and the name hold to the
 * end) plays once on the first start and on the first start after each upgrade; every other start shows
 * the logo for 0.6 s. The host decides which (`full`) and keeps whether it played; nothing is sent.
 *
 * - The version follows the window: width / height ≥ 1.6 the 16:9 film, from 1.2 the 4:3 film, below
 *   it the 9:16 one. It covers the window at its own proportions; where the window cuts the film, the
 *   cut keeps the logo and the name whole (`hxBootFit`, @hxbot/contracts/hx-boot).
 * - The film's own first frame (`first`) shows until the film plays, so the screen opens on the film
 *   and not on white; the logo is the film's last frame (`poster`), so the short screen looks like the
 *   end of the film. Behind them is the white of the film: no white flash, no black frame.
 * - One second into the film a click or any key goes in at once; a key in the first second does
 *   nothing, so a key pressed by chance does not skip it. A film that is slow to come or stuck can be
 *   skipped 2 s after the screen came, and goes in by itself 20 s after it came.
 * - While the screen covers the app, a key or a click is not for the app (it would act on views that
 *   are not seen yet), and neither is the rest of the press that skips (the key's release, the click):
 *   the app takes input from the next press. Browser and system shortcuts (Ctrl, Cmd, Alt) pass.
 * - Reduced motion, a film that fails to load, or a film that has not started 1 s after the screen
 *   came: the logo, and in. Never an error.
 * - The sound is off unless the person turned it on (Settings · Appearance).
 * - The screen does not hold the app: the views mount behind it at once, and the backend runs on.
 */

import { AppLogo } from "@hxbot/brand";
import { type HxBootAspect, hxBootAspect, hxBootFit } from "@hxbot/contracts/hx-boot";
import { createEffect, createSignal, onCleanup, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";

export { type HxBootAspect, hxBootAspect };

export interface HxBootSources {
  /** H.264: every browser and the apps play it. */
  video: string;
  /** AV1, smaller: used where the browser says it can play it (the web films). */
  av1?: string | undefined;
  /** The first frame of the film, shown until the film plays. */
  first: string;
  /** The last frame of the film: the logo. */
  poster: string;
}

/** How long the logo shows on a start that does not play the film. */
export const HX_BOOT_LOGO_MS = 600;
/** The film must have started this soon, or the logo shows instead (the apps; the web passes its own). */
export const HX_BOOT_START_MS = 1_000;
/** A key or click this far into the film goes in; before it, nothing. */
export const HX_BOOT_SKIP_AFTER_S = 1;
/** A key or click this long after the screen came goes in, even if the film has not played 1 s yet. */
export const HX_BOOT_SKIP_ANYWAY_MS = 2_000;
/** The film has had its time this long after the screen came, whether it ended or not (a stuck film). */
export const HX_BOOT_FILM_CAP_MS = 20_000;
/** The fade into the app: well inside the 300 ms that a skip may take. */
export const HX_BOOT_FADE_MS = 120;
/** After a press on the screen, its release and click are kept from the app this long at most. */
export const HX_BOOT_PRESS_END_MS = 600;

/**
 * Keeps the rest of a press (the first of each of `types`) from the page, for at most
 * `HX_BOOT_PRESS_END_MS`. It outlives the screen: a click is released after the screen has gone.
 */
function holdPressEnd(types: readonly string[]) {
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    window.removeEventListener(event.type, stop, true);
  };
  for (const type of types) window.addEventListener(type, stop, true);
  setTimeout(() => {
    for (const type of types) window.removeEventListener(type, stop, true);
  }, HX_BOOT_PRESS_END_MS);
}

export interface HxBootScreenProps {
  /** The three films; null when the build has none (the logo shows). */
  sources: Readonly<Record<HxBootAspect, HxBootSources>> | null;
  /** The film plays (the first start, or the first after an upgrade); otherwise the logo. */
  full: boolean;
  sound: boolean;
  /** The app is ready behind the screen. The screen ends when it is ready and the film or logo is done. */
  ready: boolean;
  label?: string | undefined;
  /** How soon the film must start, or the logo shows (default `HX_BOOT_START_MS`). */
  startWithinMs?: number | undefined;
  /** The film started: the host keeps that it played for this version. */
  onPlayed?: (() => void) | undefined;
  /** The views behind the screen may mount; called at once. */
  onMountViews?: (() => void) | undefined;
  onExited: () => void;
  /** For a test: the window size and the clock. */
  size?: (() => { width: number; height: number }) | undefined;
}

type Stage = "film" | "logo" | "leaving";

/** Main profile, 8 bit, level 3.1: the web films. */
function canPlayAv1(): boolean {
  try {
    return document.createElement("video").canPlayType('video/mp4; codecs="av01.0.05M.08"') === "probably";
  } catch {
    return false;
  }
}

export function HxBootScreen(props: HxBootScreenProps) {
  const { t } = useText();
  const size = props.size ?? (() => ({ width: window.innerWidth, height: window.innerHeight }));
  const window0 = size();
  const aspect = hxBootAspect(window0.width, window0.height);
  const sources = props.sources?.[aspect] ?? null;
  const filmWanted = props.full && sources !== null && !prefersReducedMotion();
  const filmSource = sources?.av1 && canPlayAv1() ? sources.av1 : sources?.video;
  const [stage, setStage] = createSignal<Stage>(filmWanted ? "film" : "logo");
  // The film is chosen once; a window that changes size keeps it, and the cut follows the new size.
  const [placement, setPlacement] = createSignal(hxBootFit(aspect, window0.width, window0.height));
  const [posterFailed, setPosterFailed] = createSignal(false);
  /** The film or the logo has had its time; the screen leaves once the app is ready too. */
  const [done, setDone] = createSignal(false);
  let video: HTMLVideoElement | undefined;
  let started = false;
  const cameAt = Date.now();
  let exited = false;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const later = (body: () => void, ms: number) => timers.push(setTimeout(body, ms));

  const leave = () => {
    if (exited || stage() === "leaving") return;
    setStage("leaving");
    video?.pause();
    later(() => {
      if (exited) return;
      exited = true;
      props.onExited();
    }, HX_BOOT_FADE_MS);
  };
  const finish = () => {
    setDone(true);
    if (props.ready) leave();
  };
  /** The film has had its time: in when the app is ready, the logo until then. */
  const filmDone = () => {
    if (stage() !== "film") return;
    finish();
    if (!props.ready) {
      video?.pause();
      setStage("logo");
    }
  };
  /** The logo, for its 0.6 s or until the app is ready. */
  const toLogo = () => {
    if (stage() !== "film") return;
    video?.pause();
    setStage("logo");
    later(finish, HX_BOOT_LOGO_MS);
  };

  onSettled(() => {
    props.onMountViews?.();
    if (stage() === "logo") later(finish, HX_BOOT_LOGO_MS);
    else {
      later(() => {
        if (!started) toLogo();
      }, props.startWithinMs ?? HX_BOOT_START_MS);
      later(filmDone, HX_BOOT_FILM_CAP_MS);
    }
  });

  // The app gets ready after the film or the logo is done: leave then.
  createEffect(
    () => props.ready && done(),
    (go) => {
      if (go) leave();
    },
  );

  const skip = (event: KeyboardEvent | PointerEvent) => {
    if (exited || stage() === "leaving") return;
    if (event.type === "keydown" && (event.ctrlKey || event.metaKey || event.altKey)) return;
    event.preventDefault();
    event.stopPropagation();
    holdPressEnd(event.type === "keydown" ? ["keyup"] : ["pointerup", "click"]);
    if (stage() !== "film" || !video) return;
    if (video.currentTime < HX_BOOT_SKIP_AFTER_S && Date.now() - cameAt < HX_BOOT_SKIP_ANYWAY_MS) return;
    // Skipped before the app is ready: the logo holds until it is.
    filmDone();
  };
  const resized = () => {
    const now = size();
    setPlacement(hxBootFit(aspect, now.width, now.height));
  };
  onSettled(() => {
    window.addEventListener("keydown", skip, true);
    window.addEventListener("pointerdown", skip, true);
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("keydown", skip, true);
      window.removeEventListener("pointerdown", skip, true);
      window.removeEventListener("resize", resized);
    };
  });
  onCleanup(() => {
    for (const timer of timers) clearTimeout(timer);
  });

  const play = (element: HTMLVideoElement) => {
    video = element;
    element.muted = !props.sound;
    const attempt = element.play();
    // A film with sound that the browser does not let play goes on without it.
    attempt?.catch(() => {
      if (!element.muted) {
        element.muted = true;
        element.play()?.catch(toLogo);
      } else toLogo();
    });
  };

  return (
    <main
      class="hx-boot"
      data-stage={stage()}
      data-aspect={aspect}
      data-ready={props.ready ? "" : undefined}
      style={{ "--hx-boot-fade": `${HX_BOOT_FADE_MS}ms`, "--hx-boot-position": placement().objectPosition }}
      role="status"
      aria-live="polite"
      aria-busy={props.ready ? "false" : "true"}
    >
      <span class="sr-only">{props.label ?? t("webClient.loading")}</span>
      <Show
        when={sources && !posterFailed()}
        fallback={
          <span class="hx-boot-logo" data-hx-boot="logo" aria-hidden="true">
            <AppLogo variant="production" />
          </span>
        }
      >
        <img
          class="hx-boot-poster"
          data-hx-boot="poster"
          src={sources?.poster}
          alt=""
          aria-hidden="true"
          draggable={false}
          onError={() => setPosterFailed(true)}
        />
      </Show>
      <Show when={filmWanted && stage() === "film"}>
        <img
          class="hx-boot-first"
          data-hx-boot="first"
          src={sources?.first}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <video
          ref={play}
          class="hx-boot-film"
          data-hx-boot="film"
          src={filmSource}
          playsinline
          preload="auto"
          disablepictureinpicture
          muted={!props.sound}
          tabindex={-1}
          onPlaying={() => {
            if (started) return;
            started = true;
            props.onPlayed?.();
          }}
          onEnded={finish}
          onError={toLogo}
        />
      </Show>
    </main>
  );
}
