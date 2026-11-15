import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HxComputerActions } from "./actions";
import { HxCatalog } from "./catalog";
import type { HxRunner, HxRunResult } from "./runner";
import { hxSelfTest } from "./selftest";
import { HX_MAC_PAGES } from "./tables-mac";
import { HX_WIN_SETTINGS } from "./tables-win";

const ok = (stdout = ""): HxRunResult => ({ code: 0, stdout, stderr: "", timedOut: false, missing: false });
const bad = (stderr: string): HxRunResult => ({ code: 1, stdout: "", stderr, timedOut: false, missing: false });

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function temp(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "hx-selftest-"));
  folders.push(folder);
  return folder;
}

/**
 * A Windows computer: the registry is a map, and `change` can make it misbehave. `verified` says that
 * direct changes were verified on a real Windows computer.
 */
async function windows(change: (script: string) => HxRunResult | undefined = () => undefined, verified = true) {
  const home = await temp();
  const data = await temp();
  const registry = new Map<string, string>([
    ["AppsUseLightTheme", "1"],
    ["SystemUsesLightTheme", "1"],
    ["EnableTransparency", "1"],
  ]);
  const writes: string[] = [];
  const started: string[] = [];
  const run: HxRunner = async (command, args, options) => {
    if (command.toLowerCase().endsWith("explorer.exe")) {
      started.push(args[0] ?? "");
      return { code: 1, stdout: "", stderr: "", timedOut: false, missing: false };
    }
    const script = args[args.length - 1] ?? "";
    const changed = change(script);
    if (changed) return changed;
    if (script.includes("Get-StartApps"))
      return ok('[{"Name":"Notepad","AppID":"Notepad!App"},{"Name":"Paint","AppID":"p"}]');
    if (script.includes("OSVersion")) return ok("10.0.26100.0\r\n");
    if (script.includes("Start-Process -FilePath $env:HX_TARGET")) {
      started.push(options?.env?.HX_TARGET ?? "");
      return ok();
    }
    if (script.includes("WmiMonitorBrightness")) return bad("Get-CimInstance : Not supported");
    // The power plan: the scripts print the minutes, and powercfg /change answers nothing.
    if (script.includes("powercfg /query")) return ok("10\r\n");
    if (script.includes("powercfg /change")) return ok();
    // Dark mode as a whole reads its two numbers in one script.
    if (script.includes("$a = $p.AppsUseLightTheme")) {
      const apps = registry.get("AppsUseLightTheme");
      const system = registry.get("SystemUsesLightTheme");
      return ok(apps === undefined || system === undefined ? "missing\r\n" : `${apps},${system}\r\n`);
    }
    const read = /-Name '(\w+)' -ErrorAction SilentlyContinue/u.exec(script);
    if (read?.[1]) return ok(`${registry.get(read[1]) ?? "missing"}\r\n`);
    const written = [...script.matchAll(/-Name '(\w+)' -Value (\d)/gu)];
    if (written.length > 0) {
      for (const [, name, value] of written) {
        if (name === undefined || value === undefined) continue;
        registry.set(name, value);
        writes.push(`${name}=${value}`);
      }
      return ok();
    }
    return bad(`unexpected: ${script}`);
  };
  let now = 1_700_000_000_000;
  const tick = () => {
    now += 7;
    return now;
  };
  const catalog = new HxCatalog({
    platform: "windows",
    run,
    home,
    dataFolder: () => data,
    chineseFirst: true,
    verified,
    now: tick,
  });
  const host = { catalog, actions: new HxComputerActions(catalog, run), run, home, dataFolder: () => data, now: tick };
  return { host, home, data, registry, writes, started };
}

describe("hxSelfTest", () => {
  it("runs every check, changes no value, and saves the report in Downloads", async () => {
    const { host, home, registry, writes, started } = await windows();
    const before = new Map(registry);
    const report = await hxSelfTest(host);
    const byId = new Map(report.items.map((item) => [item.id, item]));

    expect(report.platform).toBe("windows");
    expect(report.system).toContain("Windows 10.0.26100.0");
    expect(byId.get("catalog.apps")).toMatchObject({ outcome: "passed" });
    expect(byId.get("catalog.apps")?.detail).toContain("2 apps");
    expect(byId.get("catalog.known-app")).toMatchObject({ outcome: "passed" });
    expect(byId.get("search.page")).toMatchObject({ outcome: "passed" });
    expect(byId.get("open.page")).toMatchObject({ outcome: "passed" });
    expect(started).toEqual(["ms-settings:about"]);

    for (const key of ["dark-mode", "app-dark-mode", "system-dark-mode", "transparency"]) {
      expect(byId.get(`setting.${key}.read`)?.outcome, key).toBe("passed");
      expect(byId.get(`setting.${key}.write-same`)?.outcome, key).toBe("passed");
    }
    // Never written on this computer: read as off, and written back as off.
    expect(byId.get("setting.clipboard-history.read")).toMatchObject({ outcome: "passed", detail: "off" });
    expect(byId.get("setting.clipboard-history.write-same")?.outcome).toBe("passed");
    // No built-in screen: the read fails, and nothing is written.
    expect(byId.get("setting.brightness.read")?.outcome).toBe("failed");
    expect(byId.has("setting.brightness.write-same")).toBe(false);

    expect(byId.get("setting.dark-mode.read")).toMatchObject({ outcome: "passed", detail: "off" });
    expect(writes.slice(0, 6)).toEqual([
      // Dark mode as a whole writes both numbers; then each half by itself.
      "AppsUseLightTheme=1",
      "SystemUsesLightTheme=1",
      "AppsUseLightTheme=1",
      "SystemUsesLightTheme=1",
      "EnableTransparency=1",
      "EnableClipboardHistory=0",
    ]);
    // The settings added later write what they read, too: what Windows does when a value is missing.
    expect(writes).toContain("TaskbarAl=1");
    expect(writes).toContain("ToastEnabled=1");
    expect(writes).toContain("AllowAutoGameMode=1");
    for (const [name, value] of before) expect(registry.get(name), name).toBe(value);

    expect(report.items).toHaveLength(4 + (HX_WIN_SETTINGS.length - 1) * 2 + 1);
    expect(report.passed + report.failed + report.skipped).toBe(report.items.length);
    expect(report.failed).toBe(1);
    expect(report.finishedAt).toBeGreaterThan(report.startedAt);
    for (const item of report.items) expect(item.ms).toBeGreaterThanOrEqual(0);

    expect(report.file.startsWith(join(home, "Downloads"))).toBe(true);
    expect(report.file).toMatch(/HXBot-self-test-\d{8}T\d{6}Z\.json$/u);
    const saved = JSON.parse(await readFile(report.file, "utf8"));
    expect(saved.file).toBe(report.file);
    expect(saved.items).toHaveLength(report.items.length);
    expect(saved.failed).toBe(1);
  });

  it("writes a mix of dark and light back as the same mix", async () => {
    const { host, registry, writes } = await windows();
    // Windows 10 as it is installed: light apps, a dark taskbar.
    registry.set("AppsUseLightTheme", "1");
    registry.set("SystemUsesLightTheme", "0");
    const report = await hxSelfTest(host);
    const byId = new Map(report.items.map((item) => [item.id, item]));
    expect(byId.get("setting.dark-mode.read")).toMatchObject({ outcome: "passed", detail: "system only" });
    expect(byId.get("setting.dark-mode.write-same")).toMatchObject({
      outcome: "passed",
      detail: "system only written, system only read back",
    });
    expect(writes.slice(0, 2)).toEqual(["AppsUseLightTheme=1", "SystemUsesLightTheme=0"]);
    expect(registry.get("AppsUseLightTheme")).toBe("1");
    expect(registry.get("SystemUsesLightTheme")).toBe("0");
  });

  it("is the check of this computer: what passed is changed directly from then on, what did not is not", async () => {
    let transparencyReads = 0;
    const { host } = await windows((script) => {
      if (!script.includes("'EnableTransparency' -ErrorAction SilentlyContinue")) return undefined;
      transparencyReads += 1;
      // Transparency reads back another value than was written: its commands do not work here.
      return ok(transparencyReads === 1 ? "1\r\n" : "0\r\n");
    }, false);
    expect(await host.catalog.status()).toMatchObject({ directSettings: 0, unchecked: HX_WIN_SETTINGS.length });

    await hxSelfTest(host);

    for (const key of ["dark-mode", "app-dark-mode", "system-dark-mode", "clipboard-history"]) {
      expect(await host.catalog.directState(`setting:${key}`), key).toBe("direct");
    }
    expect(await host.catalog.directState("setting:transparency")).toBe("disabled");
    // The brightness could not be read on this computer (no built-in screen): it was not checked.
    expect(await host.catalog.directState("setting:brightness")).toBe("unchecked");
    expect(await host.catalog.status()).toMatchObject({
      directSettings: HX_WIN_SETTINGS.length - 2,
      unchecked: 1,
      disabled: ["setting:transparency"],
    });

    // From now on an agent changes a checked setting directly, and no other.
    expect((await host.actions.set({ id: "setting:dark-mode", value: "on" })).status).toBe("changed");
    expect((await host.actions.set({ id: "setting:transparency", value: "off" })).status).toBe("page");
  });

  it("holds a failed write against the setting, on a verified system too", async () => {
    const { host } = await windows((script) =>
      script.includes("-Name 'EnableTransparency' -Value")
        ? bad("Requested registry access is not allowed.")
        : undefined,
    );
    expect(await host.catalog.directState("setting:transparency")).toBe("direct");
    await hxSelfTest(host);
    expect(await host.catalog.directState("setting:transparency")).toBe("disabled");
    expect(await host.catalog.directState("setting:dark-mode")).toBe("direct");
  });

  it("fails a setting whose value does not come back as written", async () => {
    let reads = 0;
    const { host } = await windows((script) => {
      if (!script.includes("'EnableTransparency' -ErrorAction SilentlyContinue")) return undefined;
      reads += 1;
      return ok(reads === 1 ? "1\r\n" : "0\r\n");
    });
    const report = await hxSelfTest(host);
    const item = report.items.find((entry) => entry.id === "setting.transparency.write-same");
    expect(item).toMatchObject({ outcome: "failed", detail: "on written, off read back" });
  });

  it("fails a write that the system refuses, and a catalog without apps", async () => {
    const { host } = await windows((script) => {
      if (script.includes("Get-StartApps")) return ok("[]");
      if (script.includes("-Name 'AppsUseLightTheme' -Value")) return bad("Requested registry access is not allowed.");
      return undefined;
    });
    const report = await hxSelfTest(host);
    const byId = new Map(report.items.map((item) => [item.id, item]));
    expect(byId.get("catalog.apps")).toMatchObject({ outcome: "failed", detail: "No app was found on this computer." });
    expect(byId.get("catalog.known-app")?.outcome).toBe("failed");
    expect(byId.get("setting.dark-mode.write-same")?.outcome).toBe("failed");
    expect(byId.get("setting.dark-mode.write-same")?.detail).toContain("not allowed");
  });

  it("skips what macOS has not allowed yet, and a setting without a value right now", async () => {
    const home = await temp();
    const run: HxRunner = async (command, args) => {
      const text = args[args.length - 1] ?? "";
      if (command.endsWith("sw_vers")) return ok("15.1\n");
      if (text.includes("System Events")) return bad("Not authorized to send Apple events to System Events. (-1743)");
      if (text === "output volume of (get volume settings)") return ok("missing value\n");
      if (text.endsWith("of (get volume settings)")) return ok(text.startsWith("output muted") ? "false\n" : "40\n");
      return ok();
    };
    const catalog = new HxCatalog({
      platform: "mac",
      run,
      home,
      dataFolder: () => null,
      chineseFirst: true,
      verified: true,
      now: () => 1,
    });
    const report = await hxSelfTest({
      catalog,
      actions: new HxComputerActions(catalog, run),
      run,
      home,
      dataFolder: () => null,
      now: () => 1,
    });
    const byId = new Map(report.items.map((item) => [item.id, item]));
    expect(report.system).toContain("macOS 15.1");
    expect(byId.get("setting.dark-mode.read")?.outcome).toBe("skipped");
    expect(byId.has("setting.dark-mode.write-same")).toBe(false);
    expect(byId.get("setting.volume.read")).toMatchObject({ outcome: "skipped" });
    expect(byId.get("setting.mute.read")).toMatchObject({ outcome: "passed", detail: "off" });
    expect(byId.get("setting.mute.write-same")?.outcome).toBe("passed");
    expect(byId.get("setting.alert-volume.write-same")?.outcome).toBe("passed");
    // Finder is always in the list of a Mac.
    expect(byId.get("catalog.known-app")?.outcome).toBe("passed");
    // This computer is not a Mac, so the folder of the settings panes is missing.
    expect(byId.get("mac.settings-pages")?.outcome).toBe("failed");
    expect(report.file.startsWith(join(home, "Downloads"))).toBe(true);
  });

  /** A Mac whose System Settings has a pane for each of `ids`, as files and as a binary file read by plutil. */
  async function macWithPanes(ids: readonly string[]) {
    const home = await temp();
    const panes = await temp();
    const binary = new Map<string, string>();
    let index = 0;
    for (const id of ids) {
      index += 1;
      const contents = join(panes, `Pane${index}.appex`, "Contents");
      await mkdir(contents, { recursive: true });
      const file = join(contents, "Info.plist");
      if (index % 2 === 0) {
        // Every other pane keeps its Info.plist in the binary form, which only plutil reads.
        await writeFile(file, "bplist00 not text");
        binary.set(file, id);
      } else {
        await writeFile(
          file,
          `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>${id}</string></dict></plist>`,
        );
      }
    }
    await writeFile(join(panes, "notes.txt"), "not a pane");
    const run: HxRunner = async (command, args) => {
      if (command.endsWith("plutil") && args[1] === "CFBundleIdentifier") {
        const id = binary.get(args[args.length - 1] ?? "");
        return id ? ok(`${id}\n`) : bad("no such key");
      }
      if (command.endsWith("sw_vers")) return ok("15.1\n");
      return ok("false\n");
    };
    const catalog = new HxCatalog({
      platform: "mac",
      run,
      home,
      dataFolder: () => null,
      chineseFirst: true,
      verified: true,
      now: () => 1,
    });
    const report = await hxSelfTest({
      catalog,
      actions: new HxComputerActions(catalog, run),
      run,
      home,
      dataFolder: () => null,
      now: () => 1,
      macExtensions: panes,
    });
    return report.items.find((item) => item.id === "mac.settings-pages");
  }

  const paneIds = HX_MAC_PAGES.map((page) => page.address.slice("x-apple.systempreferences:".length));
  const ownPanes = paneIds.filter((id) => id.startsWith("com.apple.systempreferences."));
  const extensionPanes = paneIds.filter((id) => !id.startsWith("com.apple.systempreferences."));

  it("passes the pages of a Mac when every address is a pane of that Mac", async () => {
    const item = await macWithPanes([...extensionPanes, "com.apple.Some-Other-Settings.extension"]);
    expect(item?.outcome).toBe("passed");
    expect(item?.detail).toContain(`${extensionPanes.length} of ${paneIds.length} page addresses`);
    expect(item?.detail).toContain(`not checked, part of System Settings itself: ${ownPanes.join(" ")}`);
    expect(item?.detail).not.toContain("NOT FOUND");
    expect(item?.detail).toContain("com.apple.Some-Other-Settings.extension");
    expect(ownPanes.length).toBeGreaterThan(0);
  });

  it("names the page addresses that a Mac does not have, which is not a failure", async () => {
    // Such a page can still open: macOS 15 and 26 keep Passwords, and 26 Screen Saver, outside the panes.
    const missing = ["com.apple.BluetoothSettings", "com.apple.wifi-settings-extension"];
    const item = await macWithPanes(extensionPanes.filter((id) => !missing.includes(id)));
    expect(item?.outcome).toBe("skipped");
    expect(item?.detail).toContain(`${extensionPanes.length - 2} of ${paneIds.length} page addresses`);
    expect(item?.detail).toContain(
      "not among the panes of this Mac: com.apple.wifi-settings-extension com.apple.BluetoothSettings",
    );
  });

  it("skips everything on a system that is not supported", async () => {
    const run: HxRunner = async () => ok();
    const catalog = new HxCatalog({
      platform: null,
      run,
      home: "/nowhere",
      dataFolder: () => null,
      chineseFirst: true,
      verified: true,
      now: () => 1,
    });
    const home = await temp();
    const report = await hxSelfTest({
      catalog,
      actions: new HxComputerActions(catalog, run),
      run,
      home,
      dataFolder: () => null,
      now: () => 1,
    });
    expect(report.platform).toBeNull();
    expect(report.items).toEqual([
      { id: "platform", outcome: "skipped", detail: "The catalog works on macOS and Windows.", ms: 0 },
    ]);
    expect(report).toMatchObject({ passed: 0, failed: 0, skipped: 1 });
  });

  it("saves next to the catalog when Downloads cannot be written, and says so when nothing can", async () => {
    const { host, home, data } = await windows();
    await writeFile(join(home, "Downloads"), "a file where the folder should be");
    const report = await hxSelfTest(host);
    expect(report.file.startsWith(join(data, "hx-computer"))).toBe(true);

    const nowhere = await windows();
    await writeFile(join(nowhere.home, "Downloads"), "x");
    const lost = await hxSelfTest({ ...nowhere.host, dataFolder: () => null });
    expect(lost.file).toBe("");
    expect(lost.items.length).toBeGreaterThan(4);
  });
});
