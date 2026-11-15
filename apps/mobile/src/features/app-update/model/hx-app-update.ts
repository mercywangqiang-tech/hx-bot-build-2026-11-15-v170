/**
 * HXBot: where a new version of the phone app comes from. The account server names the newest version
 * (useLatestAppVersion); the HXBot server's /updates/mobile.json, which answers only a signed-in app,
 * says where to get it: the installer (APK) on Android, the install link of the iPhone app (Ad Hoc) or
 * the TestFlight invitation on iPhone. hx/server/scripts/publish-downloads.py writes that file.
 */

import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { hxVersionOlder } from "../../support/model/hx-client-header";

type HxUpdateSession = { apiUrl: string; sessionToken: string };

/** The part of fetch that this file uses; a test passes its own. */
export type HxFetch = (url: string, init: { headers: Record<string, string>; cache: "no-store" }) => Promise<Response>;

let current: HxUpdateSession | null = null;

/** The session that the install button asks with, kept by useAppUpdate on each render. */
export function hxRememberUpdateSession(session: HxUpdateSession | null): void {
  current = session;
}

/** The site of an account server: api.bot.example.com → https://bot.example.com. */
export function hxSiteOrigin(apiUrl: string): string {
  const url = new URL(apiUrl);
  if (url.hostname.startsWith("api.")) url.hostname = url.hostname.slice("api.".length);
  return url.origin;
}

export type HxMobileRelease = { version: string; url: string };

/** Only the server's own https addresses and the iPhone install links open. */
const OPENABLE = /^(https:\/\/[^\s]+|itms-services:\/\/\?action=download-manifest&url=https%3A%2F%2F[^\s]+)$/u;

/** The release for `platform` in mobile.json, or null. */
export function hxMobileRelease(value: unknown, platform: "ios" | "android"): HxMobileRelease | null {
  const entry = isDynamicRecord(value) ? value[platform] : null;
  if (!isDynamicRecord(entry)) return null;
  const { version, url } = entry;
  if (typeof url !== "string" || !OPENABLE.test(url)) return null;
  return { version: typeof version === "string" ? version : "", url };
}

/**
 * The published release for `platform` when it is newer than `version`, or null: signed out, no network,
 * nothing published, a TestFlight link (its version is not known here, TestFlight updates the app), or
 * this app is new enough. HXBot requires it (hx-forced-update.tsx).
 */
export async function hxNewerRelease(
  platform: "ios" | "android",
  version: string | null,
  fetcher: HxFetch = (url, init) => fetch(url, init),
): Promise<HxMobileRelease | null> {
  const session = current;
  if (!session || !version) return null;
  try {
    const response = await fetcher(`${hxSiteOrigin(session.apiUrl)}/updates/mobile.json`, {
      headers: { Authorization: `Bearer ${session.sessionToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const release = hxMobileRelease(await response.json(), platform);
    if (!release?.version || !hxVersionOlder(version, release.version)) return null;
    return release;
  } catch {
    return null;
  }
}

/**
 * Opens the new version for `platform`. False when there is no answer to go by (signed out, no network,
 * nothing published yet): the caller then opens the portal, where the download page is.
 */
export async function hxOpenNewVersion(
  platform: "ios" | "android",
  open: (url: string) => Promise<unknown>,
  fetcher: HxFetch = (url, init) => fetch(url, init),
): Promise<boolean> {
  const session = current;
  if (!session) return false;
  try {
    const response = await fetcher(`${hxSiteOrigin(session.apiUrl)}/updates/mobile.json`, {
      headers: { Authorization: `Bearer ${session.sessionToken}` },
      cache: "no-store",
    });
    if (!response.ok) return false;
    const release = hxMobileRelease(await response.json(), platform);
    if (!release) return false;
    await open(release.url);
    return true;
  } catch {
    return false;
  }
}
