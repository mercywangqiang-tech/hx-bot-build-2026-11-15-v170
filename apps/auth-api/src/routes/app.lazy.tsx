import { AppLoadingShell } from "@hxbot/ui/features/account/AppLoadingShell";
import { createLazyFileRoute } from "@tanstack/solid-router";
import { createSignal, flush, lazy, onSettled, Show } from "solid-js";
import { showSavedAppearance } from "../../../../src/renderer/src/features/web-client/web-appearance-preference";
import "../../../../src/renderer/src/features/web-client/web-client.css";

const loadWebApp = () => import("@hxbot/renderer-web");
// The saved language loads with the code, so the first screen is not English for a moment. If it
// fails, the web client starts in English and tries again when it shows the language.
const WebApp = lazy(() =>
  loadWebApp().then((module) =>
    module
      .loadSavedLanguage()
      .catch(() => undefined)
      .then(() => ({ default: module.WebApp })),
  ),
);

export const Route = createLazyFileRoute("/app")({ component: BrowserAppPage });
function BrowserAppPage() {
  const [mounted, setMounted] = createSignal(false);
  // HXBot (v1.7.5, UI-27): the start film replaces the loading crew. While the web client's code loads,
  // the page shows the film's first frame (or the logo, within 30 days of the last film), so the film
  // starts from the picture that is already there. The Worker sends the plain background; the picture
  // needs the window's size, so it comes after hydration.
  const [still, setStill] = createSignal<{ src: string; position: string } | null>(null);
  // The loading screen takes the saved theme at once. The public pages stay dark after the user leaves.
  onSettled(() => showSavedAppearance());
  onSettled(() => {
    void loadWebApp()
      .catch(() => undefined)
      .finally(() => setMounted(true));
    void import("../../../../src/renderer/src/features/web-client/hx-web-boot")
      .then((module) => {
        setStill(module.hxWebBootStill());
        flush();
      })
      // Without the picture, the web client still starts.
      .catch(() => undefined);
  });
  return (
    <div id="root">
      <Show
        when={mounted()}
        fallback={
          <div class="web-app">
            <AppLoadingShell />
            <Show when={still()}>
              {(picture) => (
                <main class="hx-boot" aria-hidden="true" style={{ "--hx-boot-position": picture().position }}>
                  <img class="hx-boot-poster" src={picture().src} alt="" draggable={false} />
                </main>
              )}
            </Show>
          </div>
        }
      >
        <WebApp />
      </Show>
    </div>
  );
}
