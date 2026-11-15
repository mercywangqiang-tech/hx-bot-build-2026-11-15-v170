// HXBot: what a computer that ran a build before the rename has on disk keeps working.
// `hx/brand_rename.py` leaves this file as it is, because it writes the earlier names on purpose.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HX_DATA_FOLDER,
  HX_EARLIER_DATA_FOLDER,
  hxEarlierName,
  hxHasEarlierName,
  hxRenamedName,
} from "@hxbot/contracts/hx-earlier-names";
import { afterEach, describe, expect, it } from "vitest";
import { hxDataFolder } from "../backend/hx-data-folder";
import { HX_EARLIER_USER_DATA_FOLDER, hxEarlierUserDataFolder, hxRenameEarlierUserData } from "./hx-earlier-data";
import { hxRemoveEarlierManagedSkill } from "./hx-earlier-skills";

const folders: string[] = [];

function folder(): string {
  const path = mkdtempSync(join(tmpdir(), "hx-earlier-"));
  folders.push(path);
  return path;
}

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("the earlier names", () => {
  it("map to the new names and back, in each case", () => {
    const pairs = [
      ["openbot-settings.json", "hxbot-settings.json"],
      ["persist:openbot-browser", "persist:hxbot-browser"],
      ["__Host-openbot-web", "__Host-hxbot-web"],
      ["mcp__openbot__send_message", "mcp__hxbot__send_message"],
      ["OPENBOT_AUTH_API_URL", "HXBOT_AUTH_API_URL"],
      ["openBotTheme", "hxBotTheme"],
    ] as const;
    for (const [earlier, renamed] of pairs) {
      expect(hxHasEarlierName(earlier)).toBe(true);
      expect(hxRenamedName(earlier)).toBe(renamed);
      expect(hxEarlierName(renamed)).toBe(earlier);
      expect(hxHasEarlierName(renamed)).toBe(false);
    }
    expect(hxEarlierName("X-HXBot-Browser")).toBe("X-OpenBot-Browser");
    expect(hxRenamedName("settings.json")).toBe("settings.json");
  });

  it("keep the data folder that an earlier build made, and make the new one otherwise", () => {
    const earlierHome = folder();
    mkdirSync(join(earlierHome, HX_EARLIER_DATA_FOLDER));
    expect(hxDataFolder(earlierHome)).toBe(join(earlierHome, HX_EARLIER_DATA_FOLDER));
    const newHome = folder();
    expect(hxDataFolder(newHome)).toBe(join(newHome, HX_DATA_FOLDER));
    expect(HX_DATA_FOLDER).not.toContain(" ");
  });

  it("give the settings, the database and the browser partitions of userData their new names once", () => {
    const userData = folder();
    writeFileSync(join(userData, "openbot-settings.json"), '{"theme":"dark"}');
    writeFileSync(join(userData, "openbot.db"), "database");
    writeFileSync(join(userData, "openbot.db-wal"), "journal");
    writeFileSync(join(userData, "unrelated.json"), "{}");
    mkdirSync(join(userData, "Partitions", "openbot-browser"), { recursive: true });
    writeFileSync(join(userData, "Partitions", "openbot-browser", "Cookies"), "cookies");
    // A new name that exists already wins: an earlier copy next to it stays where it is.
    writeFileSync(join(userData, "openbot-window.json"), "earlier");
    writeFileSync(join(userData, "hxbot-window.json"), "current");

    const moved = hxRenameEarlierUserData(userData);

    expect(moved.sort()).toEqual(["openbot-browser", "openbot-settings.json", "openbot.db", "openbot.db-wal"].sort());
    expect(readFileSync(join(userData, "hxbot-settings.json"), "utf8")).toBe('{"theme":"dark"}');
    expect(readFileSync(join(userData, "hxbot.db-wal"), "utf8")).toBe("journal");
    expect(readFileSync(join(userData, "Partitions", "hxbot-browser", "Cookies"), "utf8")).toBe("cookies");
    expect(readFileSync(join(userData, "hxbot-window.json"), "utf8")).toBe("current");
    expect(existsSync(join(userData, "unrelated.json"))).toBe(true);
    expect(hxRenameEarlierUserData(userData)).toEqual([]);
  });

  it("does nothing when userData does not exist yet", () => {
    expect(hxRenameEarlierUserData(join(folder(), "missing"))).toEqual([]);
  });

  it("keeps the user data folder of a build named HX Bot, and gives a new computer none", () => {
    const appData = folder();
    expect(hxEarlierUserDataFolder(appData)).toBeNull();
    mkdirSync(join(appData, "HXBot"));
    expect(hxEarlierUserDataFolder(appData)).toBeNull();
    mkdirSync(join(appData, HX_EARLIER_USER_DATA_FOLDER));
    writeFileSync(join(appData, HX_EARLIER_USER_DATA_FOLDER, "secret-storage.key"), "key");
    expect(HX_EARLIER_USER_DATA_FOLDER).toBe("HX Bot");
    expect(hxEarlierUserDataFolder(appData)).toBe(join(appData, "HX Bot"));
  });

  it("removes the copy of a managed skill that an earlier build wrote, and keeps a folder the user made", async () => {
    const skills = folder();
    const marker = ".hxbot-managed.json";
    mkdirSync(join(skills, "openbot-browser"));
    writeFileSync(
      join(skills, "openbot-browser", ".openbot-managed.json"),
      `${JSON.stringify({ managedBy: "openbot", slug: "openbot-browser", version: 1 })}\n`,
    );
    mkdirSync(join(skills, "openbot-notes"));
    writeFileSync(join(skills, "openbot-notes", "SKILL.md"), "the user's own skill");

    await hxRemoveEarlierManagedSkill(skills, "hxbot-browser", marker);
    await hxRemoveEarlierManagedSkill(skills, "hxbot-notes", marker);
    await hxRemoveEarlierManagedSkill(skills, "hxbot-missing", marker);

    expect(existsSync(join(skills, "openbot-browser"))).toBe(false);
    expect(readFileSync(join(skills, "openbot-notes", "SKILL.md"), "utf8")).toBe("the user's own skill");
  });
});
