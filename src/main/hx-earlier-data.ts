import { existsSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { hxHasEarlierName, hxRenamedName } from "@hxbot/contracts/hx-earlier-names";

/** The name of the user data folder of the builds before the brand became HXBot (2026-11-12). */
export const HX_EARLIER_USER_DATA_FOLDER = "HX Bot";

/**
 * HXBot: Electron names the user data folder after the app. The builds before the brand became HXBot
 * were named "HX Bot", so their settings, sign-in, the key of the secret storage, the vault and the
 * browser sign-ins are in a folder with that name. A computer that has that folder keeps using it, so
 * an upgrade keeps everything. A new computer gets the folder with the new name. Null: no such folder.
 */
export function hxEarlierUserDataFolder(appData: string): string | null {
  const folder = join(appData, HX_EARLIER_USER_DATA_FOLDER);
  return existsSync(folder) ? folder : null;
}

/**
 * HXBot: earlier builds kept their settings, the database and the browser sign-ins in
 * userData under the earlier name (settings files, the database with its journal, the browser
 * partitions). Before anything opens them, each one gets the name that this build reads. A name that
 * already exists is left alone, so a second start changes nothing. Returns the names it moved.
 */
export function hxRenameEarlierUserData(userData: string): string[] {
  const moved: string[] = [];
  for (const folder of [userData, join(userData, "Partitions")]) {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!hxHasEarlierName(name)) continue;
      const target = join(folder, hxRenamedName(name));
      if (existsSync(target)) continue;
      try {
        renameSync(join(folder, name), target);
        moved.push(name);
      } catch {
        // A file that cannot move stays where it is; the app then starts with that setting unset.
      }
    }
  }
  return moved;
}
