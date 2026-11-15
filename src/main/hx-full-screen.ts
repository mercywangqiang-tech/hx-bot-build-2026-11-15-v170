// HXBot (v1.6.8): hide a window that may be in full screen on macOS.
//
// The user, 2026-11-14: closing the HXBot window (X) turned the whole desktop black, and switching to
// another app took the black away. The main window does not close on macOS: it hides, and the Dock
// icon brings it back. A window that hides while it is in full screen leaves its full screen Space
// behind, empty and black over the whole display, until the user moves to another app. So the window
// leaves full screen first and hides when macOS says it has left.

/** The part of a BrowserWindow that this needs. */
export interface HxFullScreenWindow {
  isFullScreen(): boolean;
  setFullScreen(flag: boolean): void;
  once(event: "leave-full-screen", listener: () => void): unknown;
  hide(): void;
  isDestroyed(): boolean;
}

/** How long the window waits for the end of the full screen animation (about 0.7 s) before it hides anyway. */
const HX_LEAVE_FULL_SCREEN_MS = 2_000;

export function hxHideOutOfFullScreen(
  window: HxFullScreenWindow,
  platform: NodeJS.Platform = process.platform,
  later: (run: () => void, ms: number) => unknown = setTimeout,
): void {
  if (platform !== "darwin" || !window.isFullScreen()) {
    window.hide();
    return;
  }
  let hidden = false;
  const hide = () => {
    if (hidden) return;
    hidden = true;
    if (!window.isDestroyed()) window.hide();
  };
  window.once("leave-full-screen", hide);
  later(hide, HX_LEAVE_FULL_SCREEN_MS);
  window.setFullScreen(false);
}
