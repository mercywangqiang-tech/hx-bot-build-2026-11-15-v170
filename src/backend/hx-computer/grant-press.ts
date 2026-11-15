// HXBot 电脑操控（三）：HXBot 自己按下系统设置里自己那一行的开关，用户只输密码或按指纹（v1.6.8；
// 用户 2026-11-14：“HXBot自己点打开，最后让用户自己输入密码或者指纹！”）。
//
// 2026-11-14 在 GitHub 的 macOS 15.8.2 和 26.7.2 上实测（hxbot-check 的 grant/3，屏幕录制和辅助功能两页）：
// - 经电脑操控驱动读到的“隐私与安全性”列表里，每个应用的开关标为“<应用名>_Toggle”，和系统语言无关；
// - 按下后只有那一行的开关变，系统设置随即弹出要密码的确认框（有密码栏和“修改设置”“取消”两个按钮）；
// - 用户按“取消”，开关复原；
// - macOS 26 的屏幕录制页，列表比窗口晚到，要再读一次。
// HXBot 不碰那个确认框：密码和指纹只能由用户来。HXBot 还没有“辅助功能”授权时驱动不运行，这一步就不做，
// 由“设置 → 电脑操控”的步骤窗口照旧带用户自己点。
import { type DynamicRecord, isDynamicRecord } from "@hxbot/contracts/runtime-values";
import type { HxDriverPort } from "./driver";
import { type HxElement, type HxWindowRead, hxPlainName, hxReadWindow, hxRoleKind } from "./outline";
import { actionEffect } from "./steps";

/** What happened when HXBot tried to turn on its own switch. */
export type HxGrantPress =
  /** Pressed: macOS now asks the user for the password or Touch ID (`asked`), or took it as is. */
  | { readonly status: "pressed"; readonly asked: boolean }
  /** The switch is on already. */
  | { readonly status: "on" }
  /** System Settings shows no row for this app on that page (the app has not asked for it yet). */
  | { readonly status: "not_listed" }
  /** No System Settings window to work in. */
  | { readonly status: "no_window" }
  /** The driver did not answer, or the press did not happen. */
  | { readonly status: "failed"; readonly reason: string };

/** The switch of an app: System Settings labels it "<app name>_Toggle". */
export function hxGrantSwitch(elements: readonly HxElement[], names: readonly string[]): HxElement | null {
  const wanted = new Set(names.flatMap((name) => [hxPlainName(`${name}_Toggle`), hxPlainName(name)]));
  wanted.delete("");
  wanted.delete("toggle");
  return (
    elements.find((element) => hxRoleKind(element.role) === "check" && wanted.has(hxPlainName(element.label))) ?? null
  );
}

/** A switch reads "1" when it is on. */
function hxSwitchOn(element: HxElement): boolean {
  const value = hxPlainName(element.value);
  return value === "1" || value === "on" || value === "true" || element.selected;
}

/** The largest window of the process on the screen: the System Settings window. */
export function hxWindowOf(content: DynamicRecord | null, pid: number): number | null {
  const windows = content && Array.isArray(content.windows) ? content.windows : [];
  let best: { id: number; area: number } | null = null;
  for (const entry of windows) {
    if (!isDynamicRecord(entry) || entry.pid !== pid || typeof entry.window_id !== "number") continue;
    if (entry.is_on_screen === false || entry.minimized === true) continue;
    const bounds = isDynamicRecord(entry.bounds) ? entry.bounds : {};
    const area =
      (typeof bounds.width === "number" ? bounds.width : 0) * (typeof bounds.height === "number" ? bounds.height : 0);
    if (!best || area > best.area) best = { id: entry.window_id, area };
  }
  return best?.id ?? null;
}

/** A password or Touch ID request on the window: a secure field, or a field that was not there before. */
function asksForPassword(before: HxWindowRead, after: HxWindowRead): boolean {
  const fields = (read: HxWindowRead) =>
    read.elements.filter((element) => hxRoleKind(element.role) === "field" || /secure/iu.test(element.role)).length;
  return after.elements.some((element) => /secure/iu.test(element.role)) || fields(after) > fields(before);
}

export interface HxGrantPressInput {
  driver: HxDriverPort;
  /** The process of System Settings. */
  pid: number;
  /** The names the app's row may show: the app's name, then its product name. */
  names: readonly string[];
  wait?: (ms: number) => Promise<void>;
  /** How long to wait for the page's list. macOS 26 shows it after the window. */
  listMs?: number;
}

/**
 * Turns on the app's own switch on the System Settings page that is open, through the driver.
 * Never touches the password window that macOS shows next.
 */
export async function hxPressGrant(input: HxGrantPressInput): Promise<HxGrantPress> {
  const wait = input.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const listMs = input.listMs ?? 15_000;
  let windowId: number | null = null;
  for (let waited = 0; windowId === null && waited <= 10_000; waited += 500) {
    const listed = await input.driver.call("list_windows", { on_screen_only: true }, 5000);
    if (!listed.ok) return { status: "failed", reason: listed.error ?? "The driver did not list the windows." };
    windowId = hxWindowOf(listed.content, input.pid);
    if (windowId === null) await wait(500);
  }
  if (windowId === null) return { status: "no_window" };
  const target = { kind: "window", pid: input.pid, window_id: windowId };
  const read = async (): Promise<HxWindowRead | null> => {
    const answer = await input.driver.call(
      "get_window_state",
      { pid: input.pid, window_id: windowId, include_screenshot: false, max_elements: 1500, timeout_ms: 3000 },
      15_000,
    );
    return answer.ok ? hxReadWindow(answer.content) : null;
  };
  let before = await read();
  let found = before ? hxGrantSwitch(before.elements, input.names) : null;
  for (let waited = 0; !found && waited < listMs; waited += 1000) {
    await wait(1000);
    before = await read();
    found = before ? hxGrantSwitch(before.elements, input.names) : null;
  }
  if (!before) return { status: "failed", reason: "The driver did not read the System Settings window." };
  if (!found) return { status: "not_listed" };
  if (hxSwitchOn(found)) return { status: "on" };
  let reason = "The switch was not pressed.";
  for (const mode of ["background", "foreground"]) {
    const effect = actionEffect(
      await input.driver.call("click", { target, element_token: found.token, delivery_mode: mode }),
    );
    if (effect.worked) {
      await wait(1500);
      const after = await read();
      return { status: "pressed", asked: after ? asksForPassword(before, after) : false };
    }
    reason = effect.reason || reason;
  }
  return { status: "failed", reason };
}
