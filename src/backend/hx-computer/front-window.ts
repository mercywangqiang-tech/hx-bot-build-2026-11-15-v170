// HXBot 电脑操控（五）（v1.7.3，需求 CONC-06）：现在最前面的是哪一个窗口。
// Windows 的前台检查直接给出窗口；Mac 只给出最前面的应用，再请驱动列出这个应用的窗口，取离前面最近的一个
// （list_windows 的 z_index 越大越靠前；驱动给不出次序时只知道应用）。产品（computer.ts）和真机检查共用这一份。
import type { HxDriverPort } from "./driver";
import type { HxFrontWatch } from "./front";
import { hxFrontWindowOf } from "./steps";

export async function hxFrontWindow(
  watch: HxFrontWatch | null,
  driver: HxDriverPort | null,
): Promise<{ pid: number; windowId: number | null } | null> {
  if (!watch) return null;
  const front = await watch.front().catch(() => null);
  if (!front || front.windowId !== null || !driver) return front;
  const listed = await driver.call("list_windows", { pid: front.pid, on_screen_only: true }, 5_000);
  if (!listed.ok || listed.refused) return front;
  return { pid: front.pid, windowId: hxFrontWindowOf(listed.content, front.pid) };
}
