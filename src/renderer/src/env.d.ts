/// <reference types="vite/client" />

import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

declare global {
  interface HighlightRegistry {
    set(name: string, highlight: Highlight): this;
    delete(name: string): boolean;
  }

  interface Window {
    hxbot: HxBotDesktopApi;
  }
}
