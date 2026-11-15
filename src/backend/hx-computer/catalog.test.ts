import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HxComputerPlatform } from "@hxbot/contracts/hx-computer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HX_CATALOG_MAX_AGE_MS,
  HX_CATALOG_RETRY_MS,
  HX_DISABLED_RETRY_MS,
  HxCatalog,
  hxSeedFingerprint,
} from "./catalog";
import type { HxRunner } from "./runner";
import { HX_MAC_PAGES, HX_MAC_SETTINGS } from "./tables-mac";
import { HX_WIN_PAGES, HX_WIN_SETTINGS } from "./tables-win";

const folders: string[] = [];

const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 5);
  });

afterEach(async () => {
  // A scan that runs behind the answer can still be saving a file in there: removing the folder
  // under it fails with ENOTEMPTY, so a failed removal is tried again a moment later.
  for (const folder of folders.splice(0)) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await rm(folder, { recursive: true, force: true });
        break;
      } catch {
        await settle();
      }
    }
  }
});

/** Lets a scan that runs behind a call finish what it has started. */
async function temp(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "hx-catalog-"));
  folders.push(folder);
  return folder;
}

function windows(input: {
  data: string | null;
  apps?: () => string;
  clock?: { now: number };
  /** The exit code of the scan; anything but 0 is a scan that failed. */
  code?: () => number;
  /** The scan answers when this settles. */
  gate?: () => Promise<void>;
  /** The settings verified on real computers of this system, or all of them. The tests of the catalog itself say all. */
  verified?: boolean | readonly string[];
}) {
  const scans = { count: 0 };
  const run: HxRunner = async () => {
    scans.count += 1;
    await input.gate?.();
    return {
      code: input.code?.() ?? 0,
      stdout: input.apps?.() ?? '[{"Name":"Paint","AppID":"paint"},{"Name":"Word","AppID":"word"}]',
      stderr: "",
      timedOut: false,
      missing: false,
    };
  };
  const clock = input.clock ?? { now: 1_000_000 };
  const platform: HxComputerPlatform = "windows";
  const catalog = new HxCatalog({
    platform,
    run,
    home: "/nowhere",
    dataFolder: () => input.data,
    chineseFirst: true,
    verified: input.verified ?? true,
    now: () => clock.now,
  });
  return { catalog, scans, clock };
}

describe("HxCatalog", () => {
  it("lists the pages, the settings and the apps of Windows", async () => {
    const { catalog, scans } = windows({ data: await temp() });
    const entries = await catalog.entries();
    expect(entries.filter((entry) => entry.kind === "page")).toHaveLength(HX_WIN_PAGES.length);
    expect(entries.filter((entry) => entry.kind === "setting")).toHaveLength(HX_WIN_SETTINGS.length);
    expect(entries.filter((entry) => entry.kind === "app").map((entry) => entry.id)).toEqual(["app:paint", "app:word"]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(scans.count).toBe(1);
    const bluetooth = await catalog.entry("page:bluetooth");
    expect(bluetooth).toMatchObject({
      kind: "page",
      title: "蓝牙和其他设备",
      risk: 1,
      target: "ms-settings:bluetooth",
    });
    expect(bluetooth?.names).toEqual(expect.arrayContaining(["Bluetooth & devices", "蓝牙", "lanya", "ly"]));
    expect((await catalog.entry("page:privacy"))?.risk).toBe(3);
    expect(await catalog.entry("setting:dark-mode")).toMatchObject({
      kind: "setting",
      page: "page:colors",
      values: { type: "switch" },
      direct: true,
      risk: 1,
    });
    expect(await catalog.entry("page:none")).toBeNull();
  });

  it("names things in English when the system is not used in Chinese", async () => {
    const catalog = new HxCatalog({
      platform: "mac",
      run: async () => ({ code: 1, stdout: "", stderr: "", timedOut: false, missing: false }),
      home: "/nowhere",
      dataFolder: () => null,
      chineseFirst: false,
      verified: true,
      now: () => 5,
    });
    const entries = await catalog.entries();
    expect(entries.filter((entry) => entry.kind === "page")).toHaveLength(HX_MAC_PAGES.length);
    expect(entries.filter((entry) => entry.kind === "setting")).toHaveLength(HX_MAC_SETTINGS.length);
    expect((await catalog.entry("page:bluetooth"))?.title).toBe("Bluetooth");
    expect((await catalog.entry("setting:dark-mode"))?.title).toBe("Dark mode");
    expect(catalog.settingSeed("setting:dark-mode")?.key).toBe("dark-mode");
    expect(catalog.settingSeed("setting:none")).toBeNull();
  });

  it("has nothing on a system that is not supported, and scans nothing", async () => {
    const scans = { count: 0 };
    const catalog = new HxCatalog({
      platform: null,
      run: async () => {
        scans.count += 1;
        return { code: 0, stdout: "[]", stderr: "", timedOut: false, missing: false };
      },
      home: "/nowhere",
      dataFolder: () => null,
      chineseFirst: true,
      verified: true,
      now: () => 5,
    });
    expect(await catalog.entries()).toEqual([]);
    expect(catalog.pageSeeds()).toEqual([]);
    expect(catalog.settingSeeds()).toEqual([]);
    expect(await catalog.status()).toEqual({
      platform: null,
      builtAt: null,
      apps: 0,
      pages: 0,
      settings: 0,
      directSettings: 0,
      disabled: [],
      unchecked: 0,
    });
    expect(scans.count).toBe(0);
  });

  it("keeps the apps in a file and reads them after a restart without a scan", async () => {
    const data = await temp();
    const first = windows({ data });
    await first.catalog.entries();
    const saved = JSON.parse(await readFile(join(data, "hx-computer", "catalog.json"), "utf8"));
    expect(saved).toMatchObject({ format: 1, platform: "windows", builtAt: 1_000_000 });
    expect(saved.apps).toHaveLength(2);

    const second = windows({ data });
    expect((await second.catalog.status()).apps).toBe(2);
    expect((await second.catalog.entries()).filter((entry) => entry.kind === "app")).toHaveLength(2);
    expect(second.scans.count).toBe(0);
  });

  it("answers from a list that is a day old at once and reads the apps again behind it", async () => {
    const data = await temp();
    const clock = { now: 1_000_000 };
    let apps = '[{"Name":"Paint","AppID":"paint"},{"Name":"Word","AppID":"word"}]';
    let gate = Promise.resolve();
    const { catalog, scans } = windows({ data, clock, apps: () => apps, gate: () => gate });
    await catalog.entries();
    clock.now += HX_CATALOG_MAX_AGE_MS;
    await catalog.entries();
    expect(scans.count).toBe(1);
    clock.now += 1;
    apps = '[{"Name":"Paint","AppID":"paint"},{"Name":"Word","AppID":"word"},{"Name":"New","AppID":"new"}]';
    // The scan takes its time. The call does not wait for it: it gives the two apps of the old list.
    const slow = { finish: () => {} };
    gate = new Promise<void>((resolve) => {
      slow.finish = resolve;
    });
    expect((await catalog.entries()).filter((entry) => entry.kind === "app")).toHaveLength(2);
    expect(scans.count).toBe(2);
    // A second call while the scan runs starts no second scan.
    expect((await catalog.entries()).filter((entry) => entry.kind === "app")).toHaveLength(2);
    expect(scans.count).toBe(2);
    slow.finish();
    await catalog.refresh(60_000);
    expect(scans.count).toBe(2);
    await vi.waitFor(
      async () => expect((await catalog.entries()).filter((entry) => entry.kind === "app")).toHaveLength(3),
      { timeout: 10_000 },
    );
    gate = Promise.resolve();
    // The scan that just answered still saves its list. Once that is done, the next request starts a new scan.
    await vi.waitFor(
      async () =>
        expect(JSON.parse(await readFile(join(data, "hx-computer", "catalog.json"), "utf8")).apps).toHaveLength(3),
      { timeout: 10_000 },
    );
    await settle();
    await catalog.rebuild();
    expect(scans.count).toBe(3);
    expect((await catalog.status()).builtAt).toBe(clock.now);
  });

  it("reads the apps again when asked, but not sooner than the caller allows", async () => {
    const clock = { now: 1_000_000 };
    const { catalog, scans } = windows({ data: null, clock });
    await catalog.refresh(20_000);
    expect(scans.count).toBe(1);
    clock.now += 19_999;
    await catalog.refresh(20_000);
    expect(scans.count).toBe(1);
    clock.now += 1;
    await catalog.refresh(20_000);
    expect(scans.count).toBe(2);
  });

  it("keeps the earlier list when a scan fails, and tries again ten minutes later", async () => {
    const data = await temp();
    const clock = { now: 1_000_000 };
    let code = 0;
    const { catalog, scans } = windows({ data, clock, code: () => code });
    await catalog.entries();
    expect((await catalog.status()).apps).toBe(2);
    code = 1;
    clock.now += HX_CATALOG_MAX_AGE_MS + 1;
    await catalog.entries();
    await vi.waitFor(() => expect(scans.count).toBe(2), { timeout: 10_000 });
    await settle();
    await catalog.rebuild();
    expect(scans.count).toBe(3);
    // The two apps are still there, in memory and in the file, and the time of the good scan stays.
    expect((await catalog.entries()).filter((entry) => entry.kind === "app")).toHaveLength(2);
    expect(await catalog.status()).toMatchObject({ apps: 2, builtAt: 1_000_000 });
    expect(JSON.parse(await readFile(join(data, "hx-computer", "catalog.json"), "utf8")).apps).toHaveLength(2);
    // No new scan for ten minutes, however often the list is used.
    await catalog.entries();
    clock.now += HX_CATALOG_RETRY_MS;
    await catalog.entries();
    expect(scans.count).toBe(3);
    code = 0;
    clock.now += 1;
    await catalog.entries();
    await vi.waitFor(() => expect(scans.count).toBe(4), { timeout: 10_000 });
    await vi.waitFor(async () => expect((await catalog.status()).builtAt).toBe(clock.now), { timeout: 10_000 });
  });

  it("has pages and settings when the very first scan fails, and scans again later", async () => {
    const data = await temp();
    const clock = { now: 1_000_000 };
    let code = 1;
    const { catalog, scans } = windows({ data, clock, code: () => code });
    const entries = await catalog.entries();
    expect(entries.filter((entry) => entry.kind === "app")).toEqual([]);
    expect(entries.filter((entry) => entry.kind === "page")).toHaveLength(HX_WIN_PAGES.length);
    expect(await catalog.status()).toMatchObject({ apps: 0, builtAt: null });
    await catalog.entries();
    expect(scans.count).toBe(1);
    code = 0;
    clock.now += HX_CATALOG_RETRY_MS + 1;
    await catalog.entries();
    // The scan runs behind the answer, and writes a file: on a loaded machine that takes a moment.
    await vi.waitFor(async () => expect((await catalog.status()).apps).toBe(2), { timeout: 10_000 });
    expect(scans.count).toBeGreaterThanOrEqual(2);
  });

  it("does not stop when the scan throws", async () => {
    const catalog = new HxCatalog({
      platform: "windows",
      run: async () => {
        throw new Error("spawn failed");
      },
      home: "/nowhere",
      dataFolder: () => null,
      chineseFirst: true,
      verified: true,
      now: () => 5,
    });
    await expect(catalog.rebuild()).resolves.toBeUndefined();
    expect((await catalog.entries()).filter((entry) => entry.kind === "page")).toHaveLength(HX_WIN_PAGES.length);
  });

  it("runs one scan for calls that arrive together", async () => {
    const { catalog, scans } = windows({ data: null });
    await Promise.all([catalog.rebuild(), catalog.rebuild(), catalog.entries()]);
    expect(scans.count).toBe(1);
  });

  it("ignores a saved list that is damaged, of another system, or of another format", async () => {
    const data = await temp();
    await mkdir(join(data, "hx-computer"), { recursive: true });
    const file = join(data, "hx-computer", "catalog.json");
    for (const text of [
      "{ not json",
      JSON.stringify({ format: 1, platform: "mac", builtAt: 1, apps: [] }),
      JSON.stringify({ format: 9, platform: "windows", builtAt: 1, apps: [] }),
      JSON.stringify({ format: 1, platform: "windows", builtAt: "1", apps: [] }),
      // A list without apps is a scan that failed in an earlier version: not a list.
      JSON.stringify({ format: 1, platform: "windows", builtAt: 1_000_000, apps: [] }),
      JSON.stringify([1, 2]),
    ]) {
      await writeFile(file, text);
      const { catalog, scans } = windows({ data });
      expect((await catalog.status()).builtAt, text).toBeNull();
      await catalog.entries();
      expect(scans.count, text).toBe(1);
    }
  });

  it("drops saved entries that are not apps as this version writes them", async () => {
    const data = await temp();
    await mkdir(join(data, "hx-computer"), { recursive: true });
    await writeFile(
      join(data, "hx-computer", "catalog.json"),
      JSON.stringify({
        format: 1,
        platform: "windows",
        builtAt: 1_000_000,
        apps: [
          { id: "app:ok", kind: "app", title: "Ok", names: ["Ok"], risk: 1, target: "shell:AppsFolder\\ok" },
          { id: "app:page", kind: "page", title: "No", names: ["No"], risk: 1, target: "x" },
          { id: "app:risk", kind: "app", title: "No", names: ["No"], risk: 3, target: "x" },
          { id: "app:names", kind: "app", title: "No", names: [1], risk: 1, target: "x" },
          { id: "app:target", kind: "app", title: "No", names: ["No"], risk: 1 },
          "text",
        ],
      }),
    );
    const { catalog, scans } = windows({ data });
    expect((await catalog.entries()).filter((entry) => entry.kind === "app").map((entry) => entry.id)).toEqual([
      "app:ok",
    ]);
    expect(scans.count).toBe(0);
  });

  it("remembers a setting that failed its check, after a restart too", async () => {
    const data = await temp();
    const first = windows({ data });
    expect(await first.catalog.isDisabled("setting:brightness")).toBe(false);
    await first.catalog.disable("setting:brightness");
    await first.catalog.disable("setting:brightness");
    expect(await first.catalog.isDisabled("setting:brightness")).toBe(true);
    expect((await first.catalog.entry("setting:brightness"))?.direct).toBe(false);
    expect(await first.catalog.status()).toMatchObject({
      settings: HX_WIN_SETTINGS.length,
      directSettings: HX_WIN_SETTINGS.length - 1,
      disabled: ["setting:brightness"],
    });
    expect(JSON.parse(await readFile(join(data, "hx-computer", "state.json"), "utf8"))).toEqual({
      format: 1,
      disabled: [{ id: "setting:brightness", at: 1_000_000 }],
      checked: [],
    });
    const second = windows({ data });
    expect(await second.catalog.isDisabled("setting:brightness")).toBe(true);
    expect((await second.catalog.entry("setting:dark-mode"))?.direct).toBe(true);
  });

  it("tries a setting that failed its check again after a week", async () => {
    const data = await temp();
    const clock = { now: 1_000_000 };
    const { catalog } = windows({ data, clock });
    await catalog.disable("setting:brightness");
    clock.now += HX_DISABLED_RETRY_MS - 1;
    expect(await catalog.isDisabled("setting:brightness")).toBe(true);
    clock.now += 1;
    expect(await catalog.isDisabled("setting:brightness")).toBe(false);
    expect((await catalog.entry("setting:brightness"))?.direct).toBe(true);
    expect(await catalog.status()).toMatchObject({ directSettings: HX_WIN_SETTINGS.length, disabled: [] });
    // It fails again: the week starts again.
    await catalog.disable("setting:brightness");
    expect(await catalog.isDisabled("setting:brightness")).toBe(true);
    expect(JSON.parse(await readFile(join(data, "hx-computer", "state.json"), "utf8")).disabled).toEqual([
      { id: "setting:brightness", at: clock.now },
    ]);
    // A clock that was set back does not keep it off for longer than a week either.
    clock.now -= HX_DISABLED_RETRY_MS + 5;
    expect(await catalog.isDisabled("setting:brightness")).toBe(false);
  });

  it("ignores a saved state that is damaged or written another way", async () => {
    const data = await temp();
    await mkdir(join(data, "hx-computer"), { recursive: true });
    for (const text of [
      "{ not json",
      JSON.stringify({ format: 1, disabled: ["setting:brightness"] }),
      JSON.stringify({ format: 1, disabled: [{ id: 5, at: 1 }, { id: "setting:brightness" }, null] }),
      JSON.stringify({ format: 1, disabled: "setting:brightness" }),
    ]) {
      await writeFile(join(data, "hx-computer", "state.json"), text);
      const { catalog } = windows({ data });
      expect(await catalog.isDisabled("setting:brightness"), text).toBe(false);
      expect((await catalog.status()).disabled, text).toEqual([]);
    }
  });

  describe("with the settings that were verified on real computers of the system", () => {
    it("changes those directly at once, and every other one only after the self-test", async () => {
      const data = await temp();
      const { catalog } = windows({ data, verified: ["dark-mode", "transparency", "no-such-setting"] });
      expect(await catalog.directState("setting:dark-mode")).toBe("direct");
      expect(await catalog.directState("setting:transparency")).toBe("direct");
      expect(await catalog.directState("setting:brightness")).toBe("unchecked");
      expect(await catalog.status()).toMatchObject({
        directSettings: 2,
        unchecked: HX_WIN_SETTINGS.length - 2,
      });
      // A verified setting whose change did not take effect on this computer is not changed directly.
      await catalog.disable("setting:transparency");
      expect(await catalog.directState("setting:transparency")).toBe("disabled");
      expect(await catalog.status()).toMatchObject({ directSettings: 1, disabled: ["setting:transparency"] });
    });
  });

  describe("on a system that was not verified on a real computer yet", () => {
    it("changes no setting directly until the self-test passed for it on this computer", async () => {
      const data = await temp();
      const { catalog } = windows({ data, verified: false });
      expect(await catalog.status()).toMatchObject({
        settings: HX_WIN_SETTINGS.length,
        directSettings: 0,
        unchecked: HX_WIN_SETTINGS.length,
        disabled: [],
      });
      for (const seed of HX_WIN_SETTINGS) {
        expect(await catalog.directState(`setting:${seed.key}`), seed.key).toBe("unchecked");
        expect((await catalog.entry(`setting:${seed.key}`))?.direct, seed.key).toBe(false);
      }

      await catalog.markChecked("setting:dark-mode");
      expect(await catalog.directState("setting:dark-mode")).toBe("direct");
      expect((await catalog.entry("setting:dark-mode"))?.direct).toBe(true);
      expect(await catalog.directState("setting:transparency")).toBe("unchecked");
      expect(await catalog.status()).toMatchObject({ directSettings: 1, unchecked: HX_WIN_SETTINGS.length - 1 });

      // It is remembered after a restart, with the commands it was checked for.
      const dark = HX_WIN_SETTINGS.find((seed) => seed.key === "dark-mode");
      if (!dark) throw new Error("no dark mode");
      expect(JSON.parse(await readFile(join(data, "hx-computer", "state.json"), "utf8"))).toEqual({
        format: 1,
        disabled: [],
        checked: [{ id: "setting:dark-mode", commands: hxSeedFingerprint(dark) }],
      });
      const again = windows({ data, verified: false });
      expect(await again.catalog.directState("setting:dark-mode")).toBe("direct");
      expect(await again.catalog.status()).toMatchObject({ directSettings: 1 });
    });

    it("asks for a new check when a later version reads or writes the setting another way", async () => {
      const data = await temp();
      await mkdir(join(data, "hx-computer"), { recursive: true });
      await writeFile(
        join(data, "hx-computer", "state.json"),
        JSON.stringify({
          format: 1,
          disabled: [],
          checked: [
            { id: "setting:dark-mode", commands: "0123456789abcdef" },
            { id: "setting:none", commands: "x" },
            { id: 5, commands: "x" },
            { id: "setting:transparency" },
          ],
        }),
      );
      const { catalog } = windows({ data, verified: false });
      expect(await catalog.directState("setting:dark-mode")).toBe("unchecked");
      expect(await catalog.directState("setting:transparency")).toBe("unchecked");
      expect((await catalog.status()).directSettings).toBe(0);
    });

    it("counts a setting that failed as failed, not as waiting, and a new pass ends the failure", async () => {
      const { catalog, clock } = windows({ data: await temp(), verified: false });
      await catalog.markChecked("setting:transparency");
      await catalog.disable("setting:transparency");
      await catalog.disable("setting:brightness");
      expect(await catalog.directState("setting:transparency")).toBe("disabled");
      expect(await catalog.directState("setting:brightness")).toBe("disabled");
      expect(await catalog.status()).toMatchObject({
        directSettings: 0,
        unchecked: HX_WIN_SETTINGS.length - 2,
        disabled: ["setting:brightness", "setting:transparency"],
      });
      // The self-test passes for it again: the commands work, so the week of waiting ends.
      await catalog.markChecked("setting:transparency");
      expect(await catalog.directState("setting:transparency")).toBe("direct");
      // A week later the other one is no longer held back by its failure, but it still was never checked.
      clock.now += HX_DISABLED_RETRY_MS + 1;
      expect(await catalog.directState("setting:brightness")).toBe("unchecked");
      expect(await catalog.status()).toMatchObject({ directSettings: 1, disabled: [] });
    });

    it("does not mark something that is no setting of this system", async () => {
      const data = await temp();
      const { catalog } = windows({ data, verified: false });
      await catalog.markChecked("setting:dock-size");
      await catalog.markChecked("page:bluetooth");
      expect((await catalog.status()).directSettings).toBe(0);
    });
  });

  it("changes every setting directly on a verified system, checked here or not", async () => {
    const { catalog } = windows({ data: await temp(), verified: true });
    expect(await catalog.status()).toMatchObject({ directSettings: HX_WIN_SETTINGS.length, unchecked: 0 });
    expect(await catalog.directState("setting:brightness")).toBe("direct");
    await catalog.disable("setting:brightness");
    expect(await catalog.directState("setting:brightness")).toBe("disabled");
  });

  it("gives the commands of a setting one fingerprint, and other commands another", () => {
    const prints = [...HX_WIN_SETTINGS, ...HX_MAC_SETTINGS].map(hxSeedFingerprint);
    expect(new Set(prints).size).toBe(prints.length);
    for (const print of prints) expect(print).toMatch(/^[0-9a-f]{16}$/u);
    const dark = HX_MAC_SETTINGS.find((seed) => seed.key === "dark-mode");
    if (!dark) throw new Error("no dark mode");
    expect(hxSeedFingerprint(dark)).toBe(hxSeedFingerprint({ ...dark }));
    expect(hxSeedFingerprint({ ...dark, read: { command: dark.read.command, args: ["-e", "other"] } })).not.toBe(
      hxSeedFingerprint(dark),
    );
    expect(
      hxSeedFingerprint({ ...dark, write: () => ({ command: "/usr/bin/osascript", args: ["-e", "x"] }) }),
    ).not.toBe(hxSeedFingerprint(dark));
  });

  it("works from memory when there is no data folder, or it cannot be written", async () => {
    const none = windows({ data: null });
    await none.catalog.disable("setting:brightness");
    expect(await none.catalog.isDisabled("setting:brightness")).toBe(true);
    expect((await none.catalog.entries()).length).toBeGreaterThan(2);

    const blocked = await temp();
    await writeFile(join(blocked, "hx-computer"), "a file where the folder should be");
    const { catalog } = windows({ data: blocked });
    await catalog.disable("setting:brightness");
    expect((await catalog.status()).apps).toBe(0);
    expect((await catalog.entries()).filter((entry) => entry.kind === "app")).toHaveLength(2);
  });

  it("reports no apps before the first scan, without starting one", async () => {
    const { catalog, scans } = windows({ data: await temp() });
    expect(await catalog.status()).toMatchObject({
      platform: "windows",
      builtAt: null,
      apps: 0,
      pages: HX_WIN_PAGES.length,
    });
    expect(scans.count).toBe(0);
  });
});
