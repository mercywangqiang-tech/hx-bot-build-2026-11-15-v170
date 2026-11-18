// HXBot：桌面端更新的规则（@hxbot/contracts/hx-update-policy）。
import {
  HX_OPENING_MS,
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

  it("installs a version that HXBot found as it opened, and keeps that answer for the version", () => {
    let now = 1_000;
    let current = facts("0.67.11");
    const installs = hxInstallsByItself(
      1_000,
      () => current,
      () => now,
    );
    expect(installs()).toBe(true);
    now += HX_OPENING_MS + 60_000;
    expect(installs()).toBe(true);
    current = facts(null);
    expect(installs()).toBe(false);
  });

  it("leaves a version found later for the next opening, and installs a required one at once", () => {
    let now = 1_000 + HX_OPENING_MS + 1;
    let current = facts("0.68.0");
    const installs = hxInstallsByItself(
      1_000,
      () => current,
      () => now,
    );
    expect(installs()).toBe(false);
    current = facts("0.68.0", true);
    expect(installs()).toBe(true);
    now += 1;
    current = facts("0.68.1");
    expect(installs()).toBe(false);
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
