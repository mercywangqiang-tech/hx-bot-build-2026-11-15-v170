// The app's structured data, with the two facts that `site-metadata.ts` can not
// import: the version, from the repository's `package.json`, and a picture of the app.
// A named import, so the bundle holds the version and not the whole file. The
// release script changes it and `CHANGELOG.md` in one step.

import { version } from "../../../../package.json";
import { HXBOT_SITE_URL, hxBotSoftwareApplication } from "./site-metadata";

export const HXBOT_SOFTWARE_APPLICATION = hxBotSoftwareApplication({
  version,
  screenshot: new URL("/social/home.jpg", HXBOT_SITE_URL).toString(),
});
