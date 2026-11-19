import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { HX_LOOP_SLICE_MS, hxEventLoopTurn, hxLoopSlices } from "./loop-turn";

function busy(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // Blocks the event loop, as a synchronous recovery pass does.
  }
}

describe("hxEventLoopTurn", () => {
  it("lets a due timer run between two blocks of work", async () => {
    const order: string[] = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          setTimeout(() => order.push("timer"), 0);
          busy(5);
          order.push("first");
        });
        yield* hxEventLoopTurn;
        yield* Effect.sync(() => order.push("second"));
      }),
    );
    expect(order).toEqual(["first", "timer", "second"]);
  });

  it("without it, the timer waits for both blocks", async () => {
    const order: string[] = [];
    let timerRan: () => void = () => undefined;
    const timer = new Promise<void>((resolve) => {
      timerRan = resolve;
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          setTimeout(() => {
            order.push("timer");
            timerRan();
          }, 0);
          busy(5);
          order.push("first");
        });
        yield* Effect.sync(() => order.push("second"));
      }),
    );
    await timer;
    expect(order).toEqual(["first", "second", "timer"]);
  });
});

describe("hxLoopSlices", () => {
  it("gives a turn only after a slice of work", async () => {
    let clock = 0;
    let timers = 0;
    const slice = hxLoopSlices(() => clock);
    const ticks: number[] = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        for (let step = 0; step < 6; step++) {
          yield* Effect.sync(() => {
            setTimeout(() => timers++, 0);
            // The timer is due when the step ends.
            busy(2);
            clock += HX_LOOP_SLICE_MS / 2;
          });
          yield* slice;
          ticks.push(timers);
        }
      }),
    );
    // A turn after every second step: the timers set so far run there, and none in between.
    expect(ticks).toEqual([0, 2, 2, 4, 4, 6]);
  });

  it("is free while the slice is not used up", async () => {
    const slice = hxLoopSlices(() => 0);
    let timers = 0;
    await Effect.runPromise(
      Effect.gen(function* () {
        setTimeout(() => timers++, 0);
        for (let step = 0; step < 100; step++) yield* slice;
      }),
    );
    expect(timers).toBe(0);
  });
});
