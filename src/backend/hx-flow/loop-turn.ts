// HXBot (v1.7.3): turns of the event loop inside long synchronous passes at startup. On a profile used
// for a long time, restart recovery reads every stored thread in one pass, and the main process did not
// answer for over a second (the stress test of the requirements V2.1, 5.1, on an aged profile).
import { Effect } from "effect";

/** A pass gives the event loop a turn after this much work. */
export const HX_LOOP_SLICE_MS = 50;

/**
 * One whole turn of the event loop, timers included. One scheduler yield can resume in the same turn,
 * after the I/O callbacks; the second one resumes in the next turn, after the timers.
 */
export const hxEventLoopTurn: Effect.Effect<void> = Effect.yieldNow.pipe(Effect.andThen(Effect.yieldNow));

/**
 * For a loop: each run gives the event loop a turn when `HX_LOOP_SLICE_MS` have passed since the last
 * turn (or since the slicer was made), and is free otherwise.
 */
export function hxLoopSlices(now: () => number = () => performance.now()): Effect.Effect<void> {
  let since = now();
  return Effect.suspend(() =>
    now() - since < HX_LOOP_SLICE_MS
      ? Effect.void
      : hxEventLoopTurn.pipe(
          Effect.andThen(
            Effect.sync(() => {
              since = now();
            }),
          ),
        ),
  );
}
