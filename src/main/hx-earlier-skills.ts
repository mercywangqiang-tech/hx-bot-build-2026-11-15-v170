import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { hxEarlierName } from "@hxbot/contracts/hx-earlier-names";

/**
 * HXBot: earlier builds wrote each managed skill into the agent workspace under the earlier
 * name, with an ownership marker of the earlier name. The current skill replaces it, so the agent does
 * not read the old copy too. Only a folder whose marker says that the app wrote it is removed; a folder
 * the user made stays. Never fails: a copy that cannot be removed is left.
 */
export async function hxRemoveEarlierManagedSkill(skillsFolder: string, slug: string, marker: string): Promise<void> {
  const earlierSlug = hxEarlierName(slug);
  if (earlierSlug === slug) return;
  const folder = join(skillsFolder, earlierSlug);
  try {
    const text = await readFile(join(folder, hxEarlierName(marker)), "utf8");
    const owned = `${JSON.stringify({ managedBy: hxEarlierName("hxbot"), slug: earlierSlug, version: 1 })}\n`;
    if (text !== owned) return;
    await rm(folder, { recursive: true, force: true });
  } catch {
    // No earlier copy, or one that cannot be read: nothing to remove.
  }
}
