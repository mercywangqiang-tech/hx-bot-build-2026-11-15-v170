// HXBot：桌面端更新的规则（@hxbot/contracts/hx-update-policy）。
import {
  hxMajorMinor,
  hxReleaseNoteLines,
  hxReleaseNotesText,
  hxUpdateIsRequired,
} from "@hxbot/contracts/hx-update-policy";
import { describe, expect, it } from "vitest";

describe("which updates must be installed", () => {
  it("lets a new patch version wait and requires a new major version", () => {
    expect(hxUpdateIsRequired({ currentVersion: "0.67.2", availableVersion: "0.67.3" })).toBe(false);
    expect(hxUpdateIsRequired({ currentVersion: "0.67.2", availableVersion: "0.67.9" })).toBe(false);
    expect(hxUpdateIsRequired({ currentVersion: "0.67.9", availableVersion: "0.68.0" })).toBe(true);
    expect(hxUpdateIsRequired({ currentVersion: "1.5.0", availableVersion: "2.0.0" })).toBe(true);
    expect(hxUpdateIsRequired({ currentVersion: "0.67.2", availableVersion: null })).toBe(false);
  });

  it("requires any update once the account service refused this version", () => {
    expect(hxUpdateIsRequired({ currentVersion: "0.67.2", availableVersion: "0.67.3", hxRequired: true })).toBe(true);
  });

  it("reads major and minor", () => {
    expect(hxMajorMinor("0.67.10")).toBe("0.67");
    expect(hxMajorMinor("garbage")).toBeNull();
  });
});

describe("what is new", () => {
  const notes = JSON.stringify({ version: "0.67.3", zh: ["设置分成三组。"], en: ["Settings come in three groups."] });

  it("shows Chinese for a Chinese interface and English for the others", () => {
    expect(hxReleaseNoteLines(notes, "zh")).toEqual(["设置分成三组。"]);
    expect(hxReleaseNoteLines(notes, "de")).toEqual(["Settings come in three groups."]);
    expect(hxReleaseNoteLines(JSON.stringify({ en: ["Only English."] }), "zh")).toEqual(["Only English."]);
  });

  it("shows plain text line by line, and nothing without notes", () => {
    expect(hxReleaseNoteLines("- one\n- two\n", "en")).toEqual(["one", "two"]);
    expect(hxReleaseNoteLines(null, "en")).toEqual([]);
  });

  it("takes the notes as electron-updater reports them", () => {
    expect(hxReleaseNotesText(" notes ")).toBe("notes");
    expect(hxReleaseNotesText([{ version: "0.67.3", note: "list notes" }])).toBe("list notes");
    expect(hxReleaseNotesText(null)).toBeNull();
  });
});
