// HXBot 电脑操控（二）：停止键（v1.6.7）。
//
// While an agent operates an app with the mouse and the keyboard, the user may want it to stop at
// once, also when HXBot's window is behind the app. Ctrl+Alt+Esc (⌃⌥Esc on a Mac) works from any
// app: the agent service then stops HXBot's own steps and ends the turns of the agents that may use
// this computer, as the Stop button of each chat does.
//
// HXBot (v1.7.0): the keys are held only while an agent works on this computer (a step, an app
// command, or a driver call in the last minute). Held all the time, they were taken from every other
// app that uses them.
//
// The keys are not a system shortcut on macOS or Windows (Cmd+Option+Esc and Ctrl+Shift+Esc are, and
// are left alone). When another app holds them already, registration fails and nothing else changes:
// the Stop button of the chat still works.
import { createHxBotLogger } from "@hxbot/logging";
import { app, globalShortcut } from "electron";

const logger = createHxBotLogger("hx-computer-stop");

/** The stop keys, as Electron names them. Alt is Option on a Mac. */
export const HX_COMPUTER_STOP_KEYS = "Control+Alt+Escape";
/** How often HXBot looks whether an agent works on this computer: a check of two times, no command. */
const HX_STOP_KEYS_LOOK_MS = 1_000;

const workSources: Array<() => boolean> = [];

/** Adds a way to tell that an agent works on this computer now (v1.7.0). */
export function hxComputerWorkSource(source: () => boolean): void {
  workSources.push(source);
}

function working(): boolean {
  return workSources.some((source) => {
    try {
      return source();
    } catch {
      return false;
    }
  });
}

type HxEvery = (body: () => void, ms: number) => () => void;

const every: HxEvery = (body, ms) => {
  const timer = setInterval(body, ms);
  timer.unref();
  return () => clearInterval(timer);
};

/**
 * Holds the stop keys on macOS and Windows, the systems computer control works on, while an agent
 * works on this computer. True when the keys are watched.
 */
export function hxRegisterComputerStop(
  stop: () => void,
  platform: NodeJS.Platform = process.platform,
  options: { every?: HxEvery; working?: () => boolean } = {},
): boolean {
  if (platform !== "darwin" && platform !== "win32") return false;
  const busy = options.working ?? working;
  let held = false;
  let told = false;
  const take = (): boolean => {
    try {
      const taken = globalShortcut.register(HX_COMPUTER_STOP_KEYS, () => {
        logger.info("The user pressed the stop keys of computer control.");
        stop();
      });
      if (!taken && !told) logger.warn("The stop keys of computer control are held by another app.");
      told ||= !taken;
      return taken;
    } catch (error) {
      if (!told)
        logger.warn("The stop keys of computer control could not be registered.", {
          reason: error instanceof Error ? error.message : String(error),
        });
      told = true;
      return false;
    }
  };
  const cancel = (options.every ?? every)(() => {
    const now = busy();
    if (now && !held) held = take();
    else if (!now && held) {
      globalShortcut.unregister(HX_COMPUTER_STOP_KEYS);
      held = false;
    }
  }, HX_STOP_KEYS_LOOK_MS);
  app.once("will-quit", () => {
    cancel();
    if (held) globalShortcut.unregister(HX_COMPUTER_STOP_KEYS);
    held = false;
  });
  return true;
}
