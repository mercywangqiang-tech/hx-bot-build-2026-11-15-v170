// HXBot：桌面端“更新 HXBot”窗口（HxForcedUpdate.tsx，规则见 @hxbot/contracts/hx-update-policy）。
// v1.7.1 起不按版本拦：新版本（大版本也一样）由主进程自动安装，窗口不弹出。只有账号服务拒绝了这个版本时
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

describe("an update that installs by itself", () => {
  it("does not open the window, a new major version included", () => {
    const { setCurrent, runAction } = show(status("downloading", { progress: 30 }));
    setCurrent(status("ready"));
    flush();
    expect(shown("HXBot 0.67.3 is ready")).toBe(false);
    setCurrent(status("ready", { availableVersion: "0.68.0" }));
    flush();
    expect(shown("Update HXBot")).toBe(false);
    expect(shown("HXBot 0.68.0 is ready")).toBe(false);
    expect(runAction).not.toHaveBeenCalled();
  });

  it("starts a download that did not start by itself", () => {
    vi.useFakeTimers();
    const { runAction } = show(status("available", { availableVersion: "0.68.0" }));
    vi.advanceTimersByTime(15_000);
    expect(runAction).toHaveBeenCalledTimes(1);
  });
});

describe("an update that the account service requires", () => {
  it("covers the window, without Later, and installs after the download", () => {
    const { setCurrent, runAction } = show(status("available", { availableVersion: "0.67.11", hxRequired: true }));
    expect(screen.getByText("Update HXBot")).toBeTruthy();
    expect(later()).toBeNull();
    expect(updateNow().hasAttribute("disabled")).toBe(false);
    fireEvent.click(updateNow());
    expect(runAction).toHaveBeenCalledTimes(1);

    setCurrent(status("downloading", { availableVersion: "0.67.11", progress: 40, hxRequired: true }));
    flush();
    expect(screen.getByText(/40%.*restarts to install it when the download is done/)).toBeTruthy();

    setCurrent(status("ready", { availableVersion: "0.67.11", hxRequired: true }));
    flush();
    // The user already chose Update now: the install starts without a second click.
    expect(runAction).toHaveBeenCalledTimes(2);
  });

  it("covers the window when the account service refused this version", () => {
    show(status("downloading", { availableVersion: "0.67.5", hxRequired: true }));
    expect(screen.getByText("Update HXBot")).toBeTruthy();
    expect(later()).toBeNull();
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
