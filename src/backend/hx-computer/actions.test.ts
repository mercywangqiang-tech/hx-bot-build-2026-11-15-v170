import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HxComputerPlatform } from "@hxbot/contracts/hx-computer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HxComputerActions, hxExpected, hxNormalizeValue } from "./actions";
import { HX_DISABLED_RETRY_MS, HxCatalog } from "./catalog";
import { type HxRunner, type HxRunResult, hxRunOk } from "./runner";
import { HX_COMBINED_SEPARATOR } from "./tables";
import { HX_POWERSHELL } from "./tables-win";

type Call = { command: string; args: readonly string[]; env: Readonly<Record<string, string>> | undefined };
const ok = (stdout = ""): HxRunResult => ({ code: 0, stdout, stderr: "", timedOut: false, missing: false });
const bad = (stderr: string, code = 1): HxRunResult => ({ code, stdout: "", stderr, timedOut: false, missing: false });

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

/**
 * A Mac whose answers come from `answer`: it gets the script, or the target of `open`. `verified` says
 * that direct changes were verified on a real Mac; without it, a setting must pass the self-test first.
 */
function mac(
  answer: (text: string, call: Call) => HxRunResult | undefined,
  platform: HxComputerPlatform | null = "mac",
  verified = true,
) {
  const calls: Call[] = [];
  /** A command that reads, writes and reads again runs its three statements in turn, as osascript does. */
  const combinedOf = (args: readonly string[]) =>
    args[3] === "set hxBefore to result as text" ? { read: args[1] ?? "", write: args[5] ?? "" } : null;
  const run: HxRunner = async (command, args, options) => {
    const call = { command, args, env: options?.env };
    calls.push(call);
    const combined = combinedOf(args);
    if (!combined) return answer(args[args.length - 1] ?? "", call) ?? ok();
    const before = answer(combined.read, call) ?? ok();
    if (!hxRunOk(before)) return before;
    const written = answer(combined.write, call) ?? ok();
    if (!hxRunOk(written)) return written;
    const after = answer(combined.read, call) ?? ok();
    if (!hxRunOk(after)) return after;
    return ok(`${before.stdout.trim()}\n${HX_COMBINED_SEPARATOR}\n${after.stdout.trim()}`);
  };
  const clock = { now: 1_000_000 };
  const catalog = new HxCatalog({
    platform,
    run,
    home: "/nowhere",
    dataFolder: () => null,
    chineseFirst: true,
    verified,
    now: () => clock.now,
  });
  /**
   * The scripts that ran, in order. A command that reads, writes and reads again counts as its three
   * statements, so that a test says what happened on the computer, not how many processes did it.
   */
  const scripts = () =>
    calls
      .filter((call) => call.command.endsWith("osascript"))
      .flatMap((call) => {
        const combined = combinedOf(call.args);
        return combined ? [combined.read, combined.write, combined.read] : [call.args[1] ?? ""];
      });
  /** How many processes ran a command of a setting. */
  const osascripts = () => calls.filter((call) => call.command.endsWith("osascript")).length;
  const opened = () => calls.filter((call) => call.command === "/usr/bin/open").map((call) => call.args[0] ?? "");
  /** How long the checks after a change waited; nothing really waits. */
  const waits: number[] = [];
  const actions = new HxComputerActions(catalog, run, async (ms) => {
    waits.push(ms);
  });
  return { actions, catalog, calls, scripts, osascripts, opened, clock, waits };
}

describe("values", () => {
  it("reads a switch in the words people use", () => {
    for (const word of ["on", "ON", "true", "1", "开", "打开", "启用"])
      expect(hxNormalizeValue({ type: "switch" }, word), word).toBe("on");
    for (const word of ["off", "False", "0", "关", "关闭"])
      expect(hxNormalizeValue({ type: "switch" }, word), word).toBe("off");
    expect(hxNormalizeValue({ type: "switch" }, "maybe")).toBeNull();
    expect(hxNormalizeValue({ type: "switch" }, "")).toBeNull();
  });

  it("reads a whole number inside the limits, with or without a percent sign", () => {
    const values = { type: "number", min: 0, max: 100 } as const;
    expect(hxNormalizeValue(values, "30")).toBe("30");
    expect(hxNormalizeValue(values, " 30 % ")).toBe("30");
    expect(hxNormalizeValue(values, "0")).toBe("0");
    expect(hxNormalizeValue(values, "100")).toBe("100");
    for (const word of ["101", "-1", "3.5", "thirty", "", "30; rm -rf", "99999"])
      expect(hxNormalizeValue(values, word), word).toBeNull();
  });

  it("reads an option by its name or by the Chinese word for it", () => {
    const values = { type: "choice", options: ["left", "bottom", "right"] } as const;
    expect(hxNormalizeValue(values, "Left")).toBe("left");
    expect(hxNormalizeValue(values, "底部")).toBe("bottom");
    expect(hxNormalizeValue(values, "右边")).toBe("right");
    expect(hxNormalizeValue(values, "top")).toBeNull();
    expect(hxNormalizeValue({ type: "choice", options: ["genie", "scale"] }, "左")).toBeNull();
  });

  it("takes a full path for a file", () => {
    expect(hxNormalizeValue({ type: "file" }, " /tmp/a.png ")).toBe("/tmp/a.png");
    expect(hxNormalizeValue({ type: "file" }, "a.png")).toBeNull();
  });

  it("says what a value must look like", () => {
    expect(hxExpected({ type: "switch" })).toBe("on or off");
    expect(hxExpected({ type: "number", min: 0, max: 100 })).toBe("a whole number from 0 to 100");
    expect(hxExpected({ type: "choice", options: ["genie", "scale"] })).toBe("one of: genie, scale");
    expect(hxExpected({ type: "file" })).toBe("the full path of a file");
  });
});

describe("find", () => {
  it("finds pages and settings, and says what a setting takes", async () => {
    const { actions } = mac(() => undefined);
    const found = await actions.find({ query: "深色模式" });
    expect(found).toMatchObject({ status: "found" });
    if (found.status !== "found") return;
    expect(found.results[0]).toMatchObject({
      id: "setting:dark-mode",
      kind: "setting",
      title: "深色模式",
      direct: true,
    });
    expect(found.results[0]?.values).toEqual({ type: "switch" });
    expect(found.results[0]?.alsoCalled.length).toBeLessThanOrEqual(3);
    const privacy = await actions.find({ query: "隐私与安全性", kinds: ["page"] });
    expect(privacy.status === "found" && privacy.results[0]).toMatchObject({ id: "page:privacy", security: true });
  });

  it("scans the apps again before it says an app is not there, but not twice in a row", async () => {
    const { actions, catalog, clock } = mac(() => undefined);
    await catalog.entries();
    let scans = 0;
    const rebuild = catalog.rebuild.bind(catalog);
    catalog.rebuild = () => {
      scans += 1;
      return rebuild();
    };
    // The list was read a moment ago: a search that finds nothing does not read it again.
    expect(await actions.find({ query: "no such thing anywhere" })).toEqual({ status: "not-found" });
    expect(scans).toBe(0);
    clock.now += 21_000;
    expect(await actions.find({ query: "no such thing anywhere" })).toEqual({ status: "not-found" });
    expect(scans).toBe(1);
    expect(await actions.find({ query: "still nothing" })).toEqual({ status: "not-found" });
    expect(scans).toBe(1);
    clock.now += 21_000;
    // A search among pages and settings never needs the apps.
    expect(await actions.find({ query: "no such thing anywhere", kinds: ["page"] })).toEqual({ status: "not-found" });
    expect(scans).toBe(1);
  });

  it("says so on a system that is not supported", async () => {
    const { actions, calls } = mac(() => undefined, null);
    expect((await actions.find({ query: "蓝牙" })).status).toBe("unsupported");
    expect((await actions.open({ query: "蓝牙" })).status).toBe("unsupported");
    expect((await actions.set({ query: "音量" })).status).toBe("unsupported");
    expect(calls).toEqual([]);
  });
});

describe("open", () => {
  it("opens a settings page by id and by a plain name", async () => {
    const { actions, opened } = mac(() => undefined);
    expect(await actions.open({ id: "page:bluetooth" })).toMatchObject({
      status: "opened",
      what: { id: "page:bluetooth" },
    });
    expect(await actions.open({ query: "请打开蓝牙设置" })).toMatchObject({
      status: "opened",
      what: { id: "page:bluetooth" },
    });
    expect(opened()).toEqual([
      "x-apple.systempreferences:com.apple.BluetoothSettings",
      "x-apple.systempreferences:com.apple.BluetoothSettings",
    ]);
  });

  it("opens an app by its path, and the page of a setting", async () => {
    const { actions, opened } = mac(() => undefined);
    expect(await actions.open({ query: "访达" })).toMatchObject({ status: "opened", what: { kind: "app" } });
    expect(await actions.open({ id: "setting:dark-mode" })).toMatchObject({
      status: "opened",
      what: { id: "setting:dark-mode" },
    });
    expect(opened()).toEqual([
      "/System/Library/CoreServices/Finder.app",
      "x-apple.systempreferences:com.apple.Appearance-Settings.extension",
    ]);
  });

  it("gives the candidates when a name fits several entries, and opens nothing", async () => {
    const { actions, opened } = mac(() => undefined);
    const result = await actions.open({ query: "自动隐藏" });
    expect(result.status).toBe("candidates");
    expect(result.status === "candidates" && result.candidates.length).toBeGreaterThan(1);
    expect(opened()).toEqual([]);
  });

  it("wants exactly one of id, query, path and url", async () => {
    const { actions, calls } = mac(() => undefined);
    expect((await actions.open({})).status).toBe("invalid");
    expect((await actions.open({ id: "page:about", query: "about" })).status).toBe("invalid");
    expect((await actions.open({ path: "/tmp", url: "https://example.com" })).status).toBe("invalid");
    expect(calls).toEqual([]);
  });

  it("says when nothing has that name, and when an id is unknown", async () => {
    const { actions, opened } = mac(() => undefined);
    expect((await actions.open({ query: "zzz no such thing" })).status).toBe("not-found");
    expect((await actions.open({ id: "page:none" })).status).toBe("not-found");
    expect(opened()).toEqual([]);
  });

  it("reports a failure of the system with its reason", async () => {
    const { actions } = mac((text) => (text.startsWith("x-apple") ? bad("LSOpenURLsWithRole() failed") : undefined));
    const result = await actions.open({ id: "page:about" });
    expect(result).toMatchObject({ status: "failed" });
    expect(result.status === "failed" && result.reason).toContain("LSOpenURLsWithRole");
  });

  it("opens http and https addresses only", async () => {
    const { actions, opened } = mac(() => undefined);
    expect(await actions.open({ url: "https://bot.hxallai.com/guide" })).toEqual({
      status: "opened",
      what: { kind: "website", target: "https://bot.hxallai.com/guide" },
    });
    for (const url of ["file:///etc/passwd", "x-apple.systempreferences:x", "javascript:alert(1)", "ms-msdt:/id"]) {
      expect((await actions.open({ url })).status, url).toBe("refused");
    }
    expect((await actions.open({ url: "not an address" })).status).toBe("invalid");
    expect((await actions.open({ url: `https://example.com/${"a".repeat(2100)}` })).status).toBe("refused");
    expect(opened()).toEqual(["https://bot.hxallai.com/guide"]);
  });

  it("opens folders and documents, and never a file that would run", async () => {
    const folder = await mkdtemp(join(tmpdir(), "hx-open-"));
    folders.push(folder);
    const runs = [
      "tool.exe",
      "run.sh",
      "setup.command",
      "Trick.app",
      "macro.PY",
      "link.url",
      "place.inetloc",
      "pane.prefPane",
      "installer.msix",
      "help.chm",
      "task.tool",
    ];
    for (const name of ["report.pdf", "README", "program", ...runs]) await writeFile(join(folder, name), "x");
    await chmod(join(folder, "README"), 0o644);
    await chmod(join(folder, "program"), 0o755);
    const { actions, opened } = mac(() => undefined);
    expect(await actions.open({ path: folder })).toEqual({ status: "opened", what: { kind: "file", target: folder } });
    expect((await actions.open({ path: join(folder, "report.pdf") })).status).toBe("opened");
    // A text file without an extension opens in an editor; one marked as a program would run in Terminal.
    expect((await actions.open({ path: join(folder, "README") })).status).toBe("opened");
    for (const name of ["program", ...runs]) {
      expect((await actions.open({ path: join(folder, name) })).status, name).toBe("refused");
    }
    expect((await actions.open({ path: join(folder, "missing.pdf") })).status).toBe("not-found");
    expect((await actions.open({ path: "report.pdf" })).status).toBe("invalid");
    expect(opened()).toEqual([folder, join(folder, "report.pdf"), join(folder, "README")]);
  });

  it("opens things on Windows through the desktop shell, which answers at once", async () => {
    const calls: Call[] = [];
    const run: HxRunner = async (command, args, options) => {
      calls.push({ command, args, env: options?.env });
      // The shell ends with 1 after it handed the target on.
      if (command.toLowerCase().endsWith("explorer.exe")) {
        return { code: 1, stdout: "", stderr: "", timedOut: false, missing: false };
      }
      return ok(args.join(" ").includes("Get-StartApps") ? '[{"Name":"记事本","AppID":"Notepad!App"}]' : "");
    };
    const catalog = new HxCatalog({
      platform: "windows",
      run,
      home: "/nowhere",
      dataFolder: () => null,
      chineseFirst: true,
      verified: true,
      now: () => 1,
    });
    const actions = new HxComputerActions(catalog, run);
    expect((await actions.open({ query: "记事本" })).status).toBe("opened");
    expect((await actions.open({ id: "page:display" })).status).toBe("opened");
    const starts = calls.filter((call) => call.command.toLowerCase().endsWith("explorer.exe"));
    expect(starts.map((call) => call.args)).toEqual([["shell:AppsFolder\\Notepad!App"], ["ms-settings:display"]]);
    // The target is an argument of the program, never a piece of a script.
    for (const call of starts) expect(call.args).toHaveLength(1);
    expect(calls.some((call) => call.env?.HX_TARGET !== undefined)).toBe(false);
  });

  it("falls back to PowerShell when the desktop shell is not there", async () => {
    const calls: Call[] = [];
    const run: HxRunner = async (command, args, options) => {
      calls.push({ command, args, env: options?.env });
      if (command.toLowerCase().endsWith("explorer.exe")) {
        return { code: null, stdout: "", stderr: "", timedOut: false, missing: true };
      }
      return ok(args.join(" ").includes("Get-StartApps") ? '[{"Name":"记事本","AppID":"Notepad!App"}]' : "");
    };
    const catalog = new HxCatalog({
      platform: "windows",
      run,
      home: "/nowhere",
      dataFolder: () => null,
      chineseFirst: true,
      verified: true,
      now: () => 1,
    });
    const actions = new HxComputerActions(catalog, run);
    expect((await actions.open({ id: "page:display" })).status).toBe("opened");
    const started = calls.filter((call) => call.env?.HX_TARGET !== undefined);
    expect(started.map((call) => call.env?.HX_TARGET)).toEqual(["ms-settings:display"]);
    expect(started[0]?.command).toBe(HX_POWERSHELL);
    const script = started[0]?.args.at(-1) ?? "";
    expect(script.endsWith("Start-Process -FilePath $env:HX_TARGET -ErrorAction Stop")).toBe(true);
    expect(script).not.toContain("ms-settings");
  });
});

describe("set, on a system that was not verified on a real computer yet", () => {
  const VOLUME_GET = "output volume of (get volume settings)";

  function unverified() {
    const state = { volume: 50 };
    const system = mac(
      (text) => {
        if (text === VOLUME_GET) return ok(`${state.volume}\n`);
        const volume = /^set volume output volume (\d+)$/u.exec(text);
        if (volume?.[1]) state.volume = Number(volume[1]);
        return undefined;
      },
      "mac",
      false,
    );
    return { ...system, state };
  }

  it("does not change a setting that was not checked on this computer: it opens the page and says why", async () => {
    const { actions, state, scripts, opened, catalog } = unverified();
    const result = await actions.set({ id: "setting:volume", value: "30" });
    expect(result).toMatchObject({ status: "page", opened: true, page: { id: "page:sound" } });
    expect(result.status === "page" && result.reason).toContain("only after its self-test passed");
    expect(result.status === "page" && result.reason).toContain("Run the self-test");
    expect(state.volume).toBe(50);
    // The value was read, and nothing was written.
    expect(scripts()).toEqual([VOLUME_GET]);
    expect(opened()).toEqual(["x-apple.systempreferences:com.apple.Sound-Settings.extension"]);
    // It is not a failure of the setting: nothing is held against it.
    expect(await catalog.isDisabled("setting:volume")).toBe(false);
  });

  it("still reads a value, says when it is already right, and refuses a wrong one", async () => {
    const { actions, scripts, opened } = unverified();
    expect(await actions.set({ id: "setting:volume" })).toMatchObject({ status: "value", value: "50" });
    expect(await actions.set({ query: "音量", value: "50" })).toMatchObject({ status: "unchanged", value: "50" });
    expect((await actions.set({ id: "setting:volume", value: "loud" })).status).toBe("invalid-value");
    expect(scripts().every((text) => text === VOLUME_GET)).toBe(true);
    expect(opened()).toEqual([]);
  });

  it("tells the model in what it finds that the setting is not changed directly yet", async () => {
    const { actions, catalog } = unverified();
    const before = await actions.find({ query: "音量", kinds: ["setting"] });
    expect(before.status === "found" && before.results[0]).toMatchObject({ id: "setting:volume", direct: false });
    await catalog.markChecked("setting:volume");
    const after = await actions.find({ query: "音量", kinds: ["setting"] });
    expect(after.status === "found" && after.results[0]).toMatchObject({ id: "setting:volume", direct: true });
  });

  it("changes a setting directly once the self-test passed for it on this computer", async () => {
    const { actions, catalog, state, opened } = unverified();
    await catalog.markChecked("setting:volume");
    expect(await actions.set({ id: "setting:volume", value: "30" })).toMatchObject({
      status: "changed",
      previous: "50",
      value: "30",
    });
    expect(state.volume).toBe(30);
    expect(opened()).toEqual([]);
    // Another setting was not checked: it still goes through its page.
    expect((await actions.set({ id: "setting:alert-volume", value: "30" })).status).toBe("page");
  });

  it("opens a page that is named, instead of offering settings it would not change directly", async () => {
    const { actions, catalog, opened } = unverified();
    expect(await actions.set({ query: "桌面与程序坞", value: "left" })).toMatchObject({
      status: "page",
      opened: true,
      page: { id: "page:desktop-dock" },
    });
    expect(opened()).toHaveLength(1);
    // Once one of them was checked, it is offered, and only that one.
    await catalog.markChecked("setting:dock-position");
    const offered = await actions.set({ query: "桌面与程序坞", value: "left" });
    expect(offered.status === "candidates" && offered.candidates.map((candidate) => candidate.id)).toEqual([
      "setting:dock-position",
      "page:desktop-dock",
    ]);
  });

  it("opens apps and pages as on any system: opening changes nothing", async () => {
    const { actions, opened } = unverified();
    expect((await actions.open({ query: "蓝牙设置" })).status).toBe("opened");
    expect((await actions.open({ query: "访达" })).status).toBe("opened");
    expect(opened()).toHaveLength(2);
  });
});

describe("set", () => {
  const DARK_GET = 'tell application "System Events" to tell appearance preferences to get dark mode';
  const DARK_ON = 'tell application "System Events" to tell appearance preferences to set dark mode to true';
  const DARK_OFF = 'tell application "System Events" to tell appearance preferences to set dark mode to false';

  /** A Mac that keeps dark mode and the volume as a real one would. */
  function world(start: { dark?: boolean; volume?: number } = {}) {
    const state = { dark: start.dark ?? false, volume: start.volume ?? 50 };
    const system = mac((text) => {
      if (text === DARK_GET) return ok(`${state.dark}\n`);
      if (text === DARK_ON || text === DARK_OFF) {
        state.dark = text === DARK_ON;
        return ok();
      }
      if (text === "output volume of (get volume settings)") return ok(`${state.volume}\n`);
      const volume = /^set volume output volume (\d+)$/u.exec(text);
      if (volume?.[1]) {
        state.volume = Number(volume[1]);
        return ok();
      }
      return undefined;
    });
    return { ...system, state };
  }

  it("reads a setting when no value is given", async () => {
    const { actions, scripts } = world({ volume: 35 });
    expect(await actions.set({ id: "setting:volume" })).toMatchObject({
      status: "value",
      value: "35",
      setting: { id: "setting:volume" },
    });
    expect(await actions.set({ query: "音量", value: "  " })).toMatchObject({ status: "value", value: "35" });
    expect(scripts().every((text) => text.startsWith("output volume"))).toBe(true);
  });

  it("changes a setting, reads it back, and reports the earlier value", async () => {
    const { actions, state, scripts } = world();
    expect(await actions.set({ query: "深色模式", value: "打开" })).toMatchObject({
      status: "changed",
      previous: "off",
      value: "on",
      setting: { id: "setting:dark-mode" },
    });
    expect(state.dark).toBe(true);
    expect(scripts()).toEqual([DARK_GET, DARK_ON, DARK_GET]);
    expect(await actions.set({ query: "把音量调到 20%", value: "20%" })).toMatchObject({
      status: "changed",
      previous: "50",
      value: "20",
    });
    expect(state.volume).toBe(20);
  });

  it("says that a setting already has the value, and writes that same value in one process", async () => {
    const { actions, scripts, osascripts, state } = world({ dark: true });
    expect(await actions.set({ id: "setting:dark-mode", value: "on" })).toMatchObject({
      status: "unchanged",
      value: "on",
    });
    // One process reads, writes and reads again: writing the value it already has changes nothing,
    // and one process on an ARM computer we measured is 44 seconds less than three.
    expect(scripts()).toEqual([DARK_GET, DARK_ON, DARK_GET]);
    expect(osascripts()).toBe(1);
    expect(state.dark).toBe(true);
  });

  it("refuses a value the setting does not take, and writes nothing", async () => {
    const { actions, scripts, state } = world();
    const result = await actions.set({ id: "setting:volume", value: "loud" });
    expect(result).toMatchObject({ status: "invalid-value", expected: "a whole number from 0 to 100" });
    expect((await actions.set({ id: "setting:volume", value: "150" })).status).toBe("invalid-value");
    expect((await actions.set({ id: "setting:dark-mode", value: "50" })).status).toBe("invalid-value");
    expect(state.volume).toBe(50);
    expect(scripts().some((text) => text.startsWith("set "))).toBe(false);
  });

  it("wants exactly one of id and query", async () => {
    const { actions, calls } = world();
    expect((await actions.set({ value: "on" })).status).toBe("invalid");
    expect((await actions.set({ id: "setting:volume", query: "音量" })).status).toBe("invalid");
    expect(calls).toEqual([]);
  });

  it("says when no setting has that name, and lists candidates when several fit", async () => {
    const { actions } = world();
    expect((await actions.set({ query: "zzz no such setting", value: "on" })).status).toBe("not-found");
    expect((await actions.set({ id: "app:whatever", value: "on" })).status).toBe("not-found");
    const several = await actions.set({ query: "自动隐藏", value: "on" });
    expect(several.status).toBe("candidates");
  });

  it("opens the page when there is no direct command for what is on it", async () => {
    const { actions, opened, scripts } = world();
    const result = await actions.set({ query: "蓝牙", value: "off" });
    expect(result).toMatchObject({ status: "page", opened: true, page: { id: "page:bluetooth" } });
    expect(result.status === "page" && result.reason).toContain("no direct command");
    expect(opened()).toEqual(["x-apple.systempreferences:com.apple.BluetoothSettings"]);
    expect(scripts()).toEqual([]);
  });

  it("offers the direct settings of a page when the words name the page, and opens nothing yet", async () => {
    const { actions, opened, scripts } = world();
    const result = await actions.set({ query: "桌面与程序坞", value: "left" });
    expect(result.status).toBe("candidates");
    if (result.status !== "candidates") return;
    const ids = result.candidates.map((candidate) => candidate.id);
    expect(ids).toContain("setting:dock-position");
    expect(ids).toContain("setting:dock-autohide");
    expect(ids[ids.length - 1]).toBe("page:desktop-dock");
    expect(result.candidates.every((candidate) => candidate.kind === "page" || candidate.direct === true)).toBe(true);
    expect(opened()).toEqual([]);
    expect(scripts()).toEqual([]);
    // With the id of the page the model has chosen: the page opens.
    expect(await actions.set({ id: "page:desktop-dock" })).toMatchObject({ status: "page", opened: true });
    expect(opened()).toEqual(["x-apple.systempreferences:com.apple.Desktop-Settings.extension"]);
  });

  it("leaves out a setting that failed its check when it offers the settings of a page", async () => {
    const { actions, catalog } = world();
    await catalog.disable("setting:dock-position");
    const result = await actions.set({ query: "桌面与程序坞" });
    expect(result.status === "candidates" && result.candidates.map((candidate) => candidate.id)).not.toContain(
      "setting:dock-position",
    );
  });

  it("opens a security page and leaves the change to the user", async () => {
    const { actions, opened, scripts } = world();
    const result = await actions.set({ id: "page:privacy", value: "off" });
    expect(result).toMatchObject({ status: "page", opened: true, page: { id: "page:privacy", security: true } });
    expect(result.status === "page" && result.reason).toContain("the user makes the change");
    expect(opened()).toHaveLength(1);
    expect(scripts()).toEqual([]);
  });

  it("asks for the permission of macOS when System Events is not allowed, and does not give up on the setting", async () => {
    const denied = bad("execution error: Not authorized to send Apple events to System Events. (-1743)");
    const { actions, catalog, opened } = mac((text) => (text.includes("System Events") ? denied : undefined));
    const result = await actions.set({ id: "setting:dark-mode", value: "on" });
    expect(result.status).toBe("needs-permission");
    expect(result.status === "needs-permission" && result.reason).toContain("Automation");
    expect(await catalog.isDisabled("setting:dark-mode")).toBe(false);
    expect(opened()).toEqual([]);
  });

  it("asks for the permission when the write is refused after a read that worked", async () => {
    const { actions, catalog } = mac((text) => {
      if (text.includes("get dark mode")) return ok("false\n");
      if (text.includes("set dark mode")) return bad("System Events got an error: -1743");
      return undefined;
    });
    expect((await actions.set({ id: "setting:dark-mode", value: "on" })).status).toBe("needs-permission");
    expect(await catalog.isDisabled("setting:dark-mode")).toBe(false);
  });

  it("opens the page when the system gives no value, without giving up on the setting", async () => {
    const { actions, catalog, opened } = mac((text) =>
      text.startsWith("output volume") ? ok("missing value\n") : undefined,
    );
    const result = await actions.set({ id: "setting:volume", value: "30" });
    expect(result).toMatchObject({ status: "page", opened: true, page: { id: "page:sound" } });
    expect(await catalog.isDisabled("setting:volume")).toBe(false);
    expect(opened()).toEqual(["x-apple.systempreferences:com.apple.Sound-Settings.extension"]);

    const broken = mac((text) => (text.startsWith("output volume") ? bad("syntax error") : undefined));
    expect((await broken.actions.set({ id: "setting:volume" })).status).toBe("page");
  });

  it("reports a write that fails, and keeps the setting", async () => {
    const { actions, catalog } = mac((text) => {
      if (text.startsWith("output volume")) return ok("50\n");
      if (text.startsWith("set volume")) return bad("execution error", 1);
      return undefined;
    });
    const result = await actions.set({ id: "setting:volume", value: "30" });
    expect(result.status).toBe("failed");
    expect(await catalog.isDisabled("setting:volume")).toBe(false);
  });

  it("puts the old value back and stops trusting a command whose change does not take effect", async () => {
    const written: string[] = [];
    const system = mac((text) => {
      if (text.startsWith("output volume")) return ok("50\n");
      if (text.startsWith("set volume")) {
        written.push(text);
        return ok();
      }
      return undefined;
    });
    const { actions, catalog, opened, waits, clock } = system;
    const result = await actions.set({ id: "setting:volume", value: "30" });
    expect(result).toMatchObject({ status: "page", opened: true, page: { id: "page:sound" } });
    expect(written).toEqual(["set volume output volume 30", "set volume output volume 50"]);
    // The value was read three times, with a wait before the second and the third, before giving up.
    expect(waits).toEqual([400, 1200]);
    expect(await catalog.isDisabled("setting:volume")).toBe(true);
    expect(opened()).toHaveLength(1);

    // From now on the command is not tried at all.
    written.length = 0;
    expect((await actions.set({ id: "setting:volume", value: "30" })).status).toBe("page");
    expect(written).toEqual([]);
    const found = await actions.find({ query: "音量", kinds: ["setting"] });
    expect(found.status === "found" && found.results[0]?.direct).toBe(false);

    // A week later the direct change gets one more try (the cause can be gone).
    clock.now += HX_DISABLED_RETRY_MS + 1;
    expect(await catalog.isDisabled("setting:volume")).toBe(false);
    expect((await actions.set({ id: "setting:volume", value: "30" })).status).toBe("page");
    expect(written).toEqual(["set volume output volume 30", "set volume output volume 50"]);
    expect(await catalog.isDisabled("setting:volume")).toBe(true);
  });

  it("waits for a system that reports the new value a moment late, and keeps trusting the command", async () => {
    let volume = 50;
    let pending: number | null = null;
    let readsAfterWrite = 0;
    const { actions, catalog, waits, opened } = mac((text) => {
      if (text.startsWith("output volume")) {
        if (pending !== null) {
          readsAfterWrite += 1;
          // The second read after the change sees it.
          if (readsAfterWrite === 2) {
            volume = pending;
            pending = null;
          }
        }
        return ok(`${volume}\n`);
      }
      const set = /^set volume output volume (\d+)$/u.exec(text);
      if (set?.[1]) pending = Number(set[1]);
      return undefined;
    });
    expect(await actions.set({ id: "setting:volume", value: "30" })).toMatchObject({
      status: "changed",
      previous: "50",
      value: "30",
    });
    expect(waits).toEqual([400]);
    expect(await catalog.isDisabled("setting:volume")).toBe(false);
    expect(opened()).toEqual([]);
  });

  it("really waits between its checks when nobody gives it another way to wait", async () => {
    const reads: number[] = [];
    const run: HxRunner = async (_command, args) => {
      const text = args[args.length - 1] ?? "";
      if (text.startsWith("output volume")) {
        reads.push(Date.now());
        return ok("50\n");
      }
      return ok();
    };
    const catalog = new HxCatalog({
      platform: "mac",
      run,
      home: "/nowhere",
      dataFolder: () => null,
      chineseFirst: true,
      verified: true,
      now: () => Date.now(),
    });
    // The apps are read from the disk before the clock is taken over: from here on nothing waits for a file.
    await catalog.entries();
    vi.useFakeTimers();
    try {
      const pending = new HxComputerActions(catalog, run).set({ id: "setting:volume", value: "30" });
      await vi.advanceTimersByTimeAsync(399);
      // The read before the change and the first one after it; the next waits 400 ms.
      expect(reads).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(reads).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(1200);
      expect(reads).toHaveLength(4);
      expect((await pending).status).toBe("page");
      expect((reads[2] ?? 0) - (reads[1] ?? 0)).toBe(400);
      expect((reads[3] ?? 0) - (reads[2] ?? 0)).toBe(1200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a number that comes back one off after the system rounds it", async () => {
    let size = 0.2;
    const { actions } = mac((text) => {
      if (text.includes("get dock size")) return ok(`${size}\n`);
      if (text.includes("set dock size")) {
        size = 0.4299;
        return ok();
      }
      return undefined;
    });
    expect(await actions.set({ id: "setting:dock-size", value: "44" })).toMatchObject({
      status: "changed",
      previous: "20",
      value: "43",
    });
  });

  it("writes an option by its own name whatever word was used", async () => {
    let edge = "bottom";
    const { actions, scripts } = mac((text) => {
      if (text.includes("get screen edge")) return ok(`${edge}\n`);
      const set = /set screen edge of dock preferences to (\w+)$/u.exec(text);
      if (set?.[1]) {
        edge = set[1];
        return ok();
      }
      return undefined;
    });
    expect(await actions.set({ id: "setting:dock-position", value: "左边" })).toMatchObject({
      status: "changed",
      value: "left",
    });
    expect(scripts()[1]).toBe('tell application "System Events" to set screen edge of dock preferences to left');
  });
});
