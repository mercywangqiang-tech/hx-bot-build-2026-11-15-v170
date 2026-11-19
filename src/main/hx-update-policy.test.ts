// HXBot：桌面端更新的规则（@hxbot/contracts/hx-update-policy）。
import {
  HX_UPDATE_IDLE_WAIT_MS,
  hxAutomaticGraceMs,
  hxInstallsByItself,
  hxReleaseNoteLines,
  hxReleaseNotesText,
  hxUpdateIsRequired,
} from "@hxbot/contracts/hx-update-policy";
import { describe, expect, it } from "vitest";

describe("which updates must be installed", () => {
  it("never requires an update because of its version, a new major version included (v1.7.1)", () => {
    expect(hxUpdateIsRequired({ currentVersion: "0.67.2", availableVersion: "0.67.3" })).toBe(false);
    expect(hxUpdateIsRequired({ currentVersion: "0.67.9", availableVersion: "0.68.0" })).toBe(false);
    expect(hxUpdateIsRequired({ currentVersion: "0.67.10", availableVersion: "1.0.0" })).toBe(false);
    expect(hxUpdateIsRequired({ currentVersion: "0.67.2", availableVersion: null })).toBe(false);
  });

  it("requires an update only once the account service refused this version", () => {
    expect(hxUpdateIsRequired({ currentVersion: "0.67.2", availableVersion: "0.67.3", hxRequired: true })).toBe(true);
  });
});

describe("which updates install by themselves", () => {
  const facts = (availableVersion: string | null, hxRequired = false) => ({
    currentVersion: "0.67.10",
    availableVersion,
    hxRequired,
  });

  it("installs every new version by itself, also one found while the agents work (v1.7.3 hotfix)", () => {
    let current = facts("0.67.13");
    const installs = hxInstallsByItself(() => current);
    expect(installs()).toBe(true);
    current = facts("0.67.14");
    expect(installs()).toBe(true);
    current = facts(null);
    expect(installs()).toBe(false);
    current = facts(null, true);
    expect(installs()).toBe(true);
  });

  it("waits at most 10 minutes for idle agents before the automatic restart", () => {
    expect(HX_UPDATE_IDLE_WAIT_MS).toBe(10 * 60_000);
  });

  it("waits a few seconds before the restart, and 10 minutes for a required update", () => {
    expect(hxAutomaticGraceMs(facts("0.67.11"))).toBe(5_000);
    expect(hxAutomaticGraceMs(facts("0.67.11", true))).toBe(10 * 60_000);
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
