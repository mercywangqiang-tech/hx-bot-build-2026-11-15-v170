import { defineMessages } from "../../message";

export const messages = defineMessages("startup", {
  // The one native error box: the app could not start, so no renderer exists to show it.
  "startup.failedTitle": "HXBot couldn’t start",
  "startup.failedBody":
    "{message}\n\nYour local data was not reset or overwritten. See the troubleshooting guide for recovery steps.",
  // Shown while HXBot runs, when another program changed `app.asar`: the next start would fail with no message.
  "startup.archiveChangedTitle": "HXBot files were changed",
  "startup.archiveChangedBody":
    "Another program changed the HXBot file app.asar. HXBot runs now, but it will not open after you quit it.\n\nTo repair HXBot, install it again. Your local data stays.",
  "startup.archiveChangedDownload": "Download HXBot",
  // An older HXBot started over data that a newer one migrated: it installs the latest release.
  "startup.newerDataUpdatingTitle": "Updating HXBot",
  "startup.newerDataUpdatingBody":
    "A newer version of HXBot saved your data. HXBot installs the latest version and then opens again.\n\nYour local data was not reset or overwritten.",
  "startup.newerDataTitle": "Install the latest HXBot",
  "startup.newerDataBody":
    "A newer version of HXBot saved your data, and this version ({version}) cannot open it. Install the latest version to open your data.\n\nYour local data was not reset or overwritten.",
  "startup.newerDataDownload": "Download HXBot",
  "startup.newerDataGuide": "Open guide",
  "startup.newerDataQuit": "Quit",
  "startup.hxMoveTitle": "Move HXBot to Applications?",
  "startup.hxMoveBody":
    "HXBot runs outside the Applications folder, for example from Downloads or a disk image. macOS then runs it from a temporary place, and permissions and updates do not work. HXBot moves itself and opens again.",
  "startup.hxMoveNow": "Move",
  "startup.hxMoveLater": "Not now",
  "startup.hxMoveFailed":
    "HXBot could not move itself. Quit HXBot, then drag it into the Applications folder in Finder.",
});
