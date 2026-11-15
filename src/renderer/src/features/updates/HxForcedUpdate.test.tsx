// HXBot：桌面端“有新版本”窗口（HxForcedUpdate.tsx，规则见 @hxbot/contracts/hx-update-policy）。
// 小版本可以不装：下载好后弹出，列出新功能，“立即更新”或“以后再说”。大版本或账号服务拒绝的版本必须装：
// 窗口挡住，只有“立即更新”；还在下载时点了，下载完自动安装。
import type { UpdateStatus } from "@hxbot/contracts/ipc";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HxForcedUpdate, hxUpdateButton, hxUpdatePending } from "./HxForcedUpdate";

const NOTES = JSON.stringify({
  version: "0.67.3",
  zh: ["设置窗口分成三组。"],
  en: ["Settings come in three groups.", "Get help opens the guide."],
});

function status(phase: UpdateStatus["phase"], change: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    phase,
    currentVersion: "0.67.2",
    availableVersion: "0.67.3",
    progress: null,
    checkedAt: null,
    message: null,
    errorCode: null,
    hxReleaseNotes: NOTES,
    ...change,
  };
}

function show(first: UpdateStatus) {
  const [current, setCurrent] = createSignal(first);
  const runAction = vi.fn(() => Promise.resolve());
  render(() => <HxForcedUpdate updates={{ status: current, runAction }} />);
  flush();
  return { setCurrent, runAction };
}

const updateNow = () => screen.getByRole("button", { name: "Update now" });
// A closed dialog can stay in jsdom while its exit animation waits for an event jsdom never sends.
const shown = (text: string) => {
  const element = screen.queryByText(text);
  return element !== null && element.closest("[data-closed]") === null;
};
const later = () => screen.queryByRole("button", { name: "Later" });

afterEach(() => vi.useRealTimers());

describe("an update that can wait", () => {
  it("opens once it is downloaded, with what is new, Update now and Later", () => {
    const { setCurrent, runAction } = show(status("downloading", { progress: 30 }));
    expect(shown("HXBot 0.67.3 is ready")).toBe(false);
    setCurrent(status("ready"));
    flush();
    expect(screen.getByText("HXBot 0.67.3 is ready")).toBeTruthy();
    expect(screen.getByText("Settings come in three groups.")).toBeTruthy();
    expect(screen.getByText("Get help opens the guide.")).toBeTruthy();
    fireEvent.click(updateNow());
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  it("closes with Later and does not install by itself", () => {
    vi.useFakeTimers();
    const { setCurrent, runAction } = show(status("ready", { availableVersion: "0.67.4" }));
    const button = later();
    expect(button).toBeTruthy();
    if (button) fireEvent.click(button);
    vi.advanceTimersByTime(15 * 60_000);
    flush();
    expect(shown("HXBot 0.67.4 is ready")).toBe(false);
    expect(runAction).not.toHaveBeenCalled();
    // The same version stays quiet until HXBot starts again; a newer one asks again.
    setCurrent(status("ready", { availableVersion: "0.67.4", checkedAt: "later" }));
    vi.advanceTimersByTime(1000);
    flush();
    expect(shown("HXBot 0.67.4 is ready")).toBe(false);
    setCurrent(status("ready", { availableVersion: "0.67.5" }));
    flush();
    expect(shown("HXBot 0.67.5 is ready")).toBe(true);
  });
});

describe("an update that must be installed", () => {
  it("covers the window for a new major version, without Later, and installs after the download", () => {
    const { setCurrent, runAction } = show(status("available", { availableVersion: "0.68.0" }));
    expect(screen.getByText("Update HXBot")).toBeTruthy();
    expect(later()).toBeNull();
    expect(updateNow().hasAttribute("disabled")).toBe(false);
    fireEvent.click(updateNow());
    expect(runAction).toHaveBeenCalledTimes(1);

    setCurrent(status("downloading", { availableVersion: "0.68.0", progress: 40 }));
    flush();
    expect(screen.getByText(/40%.*restarts to install it when the download is done/)).toBeTruthy();

    setCurrent(status("ready", { availableVersion: "0.68.0" }));
    flush();
    // The user already chose Update now: the install starts without a second click.
    expect(runAction).toHaveBeenCalledTimes(2);
  });

  it("covers the window when the account service refused this version", () => {
    show(status("downloading", { availableVersion: "0.67.5", hxRequired: true }));
    expect(screen.getByText("Update HXBot")).toBeTruthy();
    expect(later()).toBeNull();
  });

  it("starts a download that did not start by itself", () => {
    vi.useFakeTimers();
    const { runAction } = show(status("available", { availableVersion: "0.68.0" }));
    vi.advanceTimersByTime(15_000);
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  it("knows when an update is pending and what the button does", () => {
    expect(hxUpdatePending(status("up-to-date"))).toBe(false);
    expect(hxUpdatePending({ ...status("available"), managedByHost: true })).toBe(false);
    expect(hxUpdatePending(status("downloading"))).toBe(true);
    expect(hxUpdatePending({ ...status("error"), availableVersion: null })).toBe(false);
    expect(hxUpdateButton(status("available"))).toBe("download");
    expect(hxUpdateButton(status("ready"))).toBe("install");
    expect(hxUpdateButton(status("error"))).toBe("retry");
    expect(hxUpdateButton(status("installing"))).toBe("wait");
  });
});
