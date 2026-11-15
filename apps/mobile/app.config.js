const { existsSync } = require("node:fs");
const { join } = require("node:path");

// Android notifications come through Firebase Cloud Messaging, which needs the Firebase file of the
// app. The file is optional, so the app builds before the Firebase project exists, and such a build
// gets no notifications on Android. The file has public identifiers only; the account service has the
// key that sends.
const GOOGLE_SERVICES_FILE = "./google-services.json";

/** @param {{ config: import('expo/config').ExpoConfig }} context */
module.exports = ({ config }) => {
  // HXBot: the Apple team that signs the iOS app and its extensions, and the number of this
  // build. Apple takes each build number of a version once, so every build that is uploaded needs a
  // higher one (hx/scripts/build-ios.sh sets both).
  const appleTeamId = process.env.HX_APPLE_TEAM_ID?.trim();
  const buildNumber = process.env.HX_IOS_BUILD?.trim();
  const ios = { ...config.ios, ...(appleTeamId ? { appleTeamId } : {}), ...(buildNumber ? { buildNumber } : {}) };
  const signed = appleTeamId || buildNumber ? { ...config, ios } : config;
  return existsSync(join(__dirname, GOOGLE_SERVICES_FILE))
    ? { ...signed, android: { ...signed.android, googleServicesFile: GOOGLE_SERVICES_FILE } }
    : signed;
};
