import { defineMessages } from "../../message";

export const messages = defineMessages("update", {
  // The app update button in Settings, one label for each updater phase.
  "update.action.check": "Check for updates",
  "update.action.checking": "Checking for updates…",
  "update.action.download": "Download update",
  "update.action.downloading": "Downloading update…",
  "update.action.restart": "Restart to update",
  "update.action.restarting": "Restarting…",
  "update.action.retryDownload": "Retry download",
  "update.managedByHost": "Managed by host",
  "update.upToDate": "Up to date",

  // The provider CLI update notification.
  "update.provider.update": "Update",
  "update.provider.upToDate": "{name} is up to date",
  "update.provider.checking": "Checking for {name} updates",
  "update.provider.available": "{name} update available",
  "update.provider.updating": "Updating {name}",
  "update.provider.waiting": "Waiting to update {name}",
  "update.provider.failed": "{name} update failed",
  "update.provider.settingUp": "Setting up",
  "update.provider.failedRetry": "The update failed. Try again.",
  "update.provider.unknownVersion": "unknown version",
  "update.provider.remoteHost": "Provider CLI updates run on the computer that hosts them.",
  "update.provider.unavailable": "Provider updates are unavailable.",
  "update.provider.downloadsUnavailable": "Provider downloads are unavailable.",
  "update.provider.startFailed": "The update could not start. Try again.",
  "update.provider.showDetails": "Show details",
  "update.provider.hideDetails": "Hide details",

  // An update that an admin of this server asked for. {name} is the admin.
  "update.scheduled.title": "{name} scheduled an HXBot update",
  // The same notice when "Install updates automatically" scheduled the restart.
  "update.scheduled.automaticTitle": "HXBot installs an update",
  "update.scheduled.whenIdle": "HXBot restarts when the agents are idle.",
  "update.scheduled.now": "HXBot restarts when the update is downloaded.",
  "update.scheduled.cancel": "Cancel update",
  "update.scheduled.cancelFailed": "The update could not be cancelled.",

  // A restart that the user of this computer asked for. It waits until no work runs.
  "update.idleRestart.relaunchTitle": "HXBot restarts when the agents are idle",
  "update.idleRestart.updateTitle": "HXBot installs the update when the agents are idle",
  "update.idleRestart.description": "New routine runs wait until the restart.",
  "update.idleRestart.waitingFor": "Waiting for {reasons}.",
  "update.idleRestart.cancel": "Cancel restart",
  "update.idleRestart.cancelFailed": "The restart could not be cancelled.",
  "update.idleRestart.requestFailed": "The restart could not be scheduled.",
  "update.idleRestart.failedTitle": "HXBot did not restart",

  // The "What's new" dialog after an app update.
  "update.whatsNew.title": "What’s new in HXBot",
  "update.whatsNew.description": "The new features and changes in this version of HXBot.",
  "update.whatsNew.version": "Version {version}",
  "update.whatsNew.updatedFrom": "Updated from {from} to {to}",
  "update.whatsNew.group.added": "New",
  "update.whatsNew.group.changed": "Improved",
  "update.whatsNew.group.fixed": "Fixed",
  "update.whatsNew.notices": "Do this after the update",
  "update.whatsNew.showFixes": { one: "Show {count} fix", other: "Show {count} fixes" },
  "update.whatsNew.hideFixes": "Hide fixes",
  "update.whatsNew.loading": "Loading the release notes…",
  "update.whatsNew.failed.title": "The release notes did not load",
  "update.whatsNew.failed.body":
    "Make sure that you are online and try again. The full changelog also shows all changes.",
  "update.whatsNew.empty.title": "No new features in this version",
  "update.whatsNew.empty.body": "This version has no notes to show here. The full changelog shows all changes.",
  "update.whatsNew.changelog": "Full changelog",
  "update.whatsNew.changelogFailed": "HXBot could not open the changelog.",
  "update.whatsNew.done": "Got it",
  "update.hxForced.title": "Update HXBot",
  "update.hxForced.body": "HXBot {version} is out. Install it to keep using HXBot.",
  "update.hxForced.starting": "Choose Update now to download and install it.",
  "update.hxForced.downloading": "Downloading the new version…",
  "update.hxForced.downloadingProgress": "Downloading the new version… {progress}%",
  "update.hxForced.ready":
    "The new version is downloaded. Choose Update now to restart HXBot and install it. If no one does within 10 minutes, HXBot restarts to install it when it is idle.",
  "update.hxForced.installing": "Installing. HXBot restarts by itself.",
  "update.hxForced.failed":
    "The update did not go through. Try again, or download the new version from the download page and install it.",
  "update.hxForced.installNow": "Update now",
  "update.hxForced.afterDownload": "HXBot restarts to install it when the download is done.",
  "update.hxForced.retry": "Try again",
  "update.hxForced.manual": "Open the download page",
  "update.hxOptional.title": "HXBot {version} is ready",
  "update.hxOptional.body":
    "Here is what is new. Updating takes a moment; your agents and conversations stay as they are.",
  "update.hxOptional.ready": "Downloaded. Choose Update now to restart HXBot and install it, or Later to keep working.",
  "update.hxOptional.later": "Later",
  "update.hxOptional.whatsNew": "What is new",
});
