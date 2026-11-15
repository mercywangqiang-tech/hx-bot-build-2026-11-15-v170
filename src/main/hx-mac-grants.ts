// HXBot 电脑操控（三）：一键授权（v1.6.8；用户 2026-11-14：“HXBot自己点打开，最后让用户自己输入密码或者指纹！”）。
//
// “设置 → 电脑操控”的“授权”按钮和逐步操作缺授权时，照旧先打开系统设置里那一页和 HXBot 的步骤窗口；接着：
// - 屏幕录制：HXBot 已有“辅助功能”授权时，先申请一次截屏（HXBot 由此出现在列表里），再经电脑操控驱动按下
//   HXBot 自己那一行的开关（hx-computer/grant-press.ts）。macOS 随即要密码或指纹，由用户来，HXBot 不碰；
// - 辅助功能：只能由用户自己点（HXBot 这时还没有能力点系统设置，苹果也不许应用替自己打开）。用户打开后，
//   HXBot 接着自己去开屏幕录制。
// 授权后几秒内重新问一次驱动，设置页和逐步操作随即可用。
import type { MacPermissionId, McpServerConfig } from "@hxbot/contracts/ipc";
import { createHxBotLogger, toLogValue } from "@hxbot/logging";
import type { Effect } from "effect";
import { runCauseEffect } from "../backend/effect-boundary";
import { type HxDriverPort, HxDriverSocket, hxDriverAddress } from "../backend/hx-computer/driver";
import { type HxGrantPress, hxPressGrant } from "../backend/hx-computer/grant-press";

const logger = createHxBotLogger("hx-mac-grants");

/** How long HXBot waits for the user to turn on Accessibility, or to give the password. */
const WATCH_MS = 180_000;

/** What this module needs of the Computer Use driver runtime (cua-driver-runtime.ts). */
interface HxMacGrantsDriver {
  state(): Effect.Effect<{ readonly status: string }, { readonly cause: unknown }>;
  start(): Effect.Effect<void, { readonly cause: unknown }>;
  running(): boolean;
  mcpServerConfig(): Pick<McpServerConfig, "args"> | null;
}

export interface HxMacGrantsHost {
  driver: HxMacGrantsDriver;
  /** `systemPreferences.isTrustedAccessibilityClient(false)`. */
  accessibility(): boolean;
  /** `systemPreferences.getMediaAccessStatus("screen") === "granted"`. */
  screenRecording(): boolean;
  /** One capture that is thrown away: macOS then lists HXBot under Screen Recording. */
  askScreenRecording(): Promise<void>;
  /** `tccutil reset <service> <HXBot's bundle id>`: removes HXBot's own entry, nobody else's. */
  resetOwn(service: "Accessibility" | "ScreenCapture"): Promise<void>;
  /** Opens the System Settings page of a grant, with HXBot's steps window. */
  openPage(id: MacPermissionId): Promise<void>;
  /** The process of System Settings, or null while it does not run. */
  settingsPid(): Promise<number | null>;
  /** The names HXBot's row may show. */
  names: readonly string[];
  wait?: (ms: number) => Promise<void>;
  /** A connection to the driver. Tests pass a double. */
  connect?: (address: string) => HxDriverPort & { close(): void };
}

/** Reads the pid out of `lsappinfo info -only pid -app com.apple.systempreferences`. */
export function hxLsappinfoPid(output: string): number | null {
  const match = /"pid"\s*=\s*(\d+)/u.exec(output);
  const pid = match ? Number(match[1]) : Number.NaN;
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export class HxMacGrants {
  #host: HxMacGrantsHost | null = null;
  #pressing: Promise<HxGrantPress | null> | null = null;
  #watching = new Set<string>();

  set(host: HxMacGrantsHost | null): void {
    this.#host = host;
  }

  /**
   * Before the page of a grant opens: a grant that does not hold is often an entry of an earlier
   * signature, which shows "on" and counts for nothing. HXBot removes its own entry for that grant
   * (checked on macOS 15 and 26 without administrator rights: only that app's entries go), so the
   * list shows the truth. A grant that holds is never touched. Never rejects.
   */
  async prepare(id: MacPermissionId): Promise<void> {
    const host = this.#host;
    if (!host) return;
    const stale = id === "accessibility" ? !host.accessibility() : !host.screenRecording();
    if (!stale) return;
    await host.resetOwn(id === "accessibility" ? "Accessibility" : "ScreenCapture").catch((cause: unknown) => {
      logger.warn("HXBot could not reset its own entry.", { grant: id, cause: toLogValue(cause) });
    });
  }

  /**
   * After the page of a grant opened: HXBot turns on its own switch where macOS lets it. Never
   * rejects; null when there is nothing HXBot may press (then the user follows the steps window).
   */
  press(id: MacPermissionId): Promise<HxGrantPress | null> {
    const host = this.#host;
    if (!host) return Promise.resolve(null);
    if (id === "accessibility") {
      void this.#watch(
        "accessibility",
        host,
        () => host.accessibility(),
        () => this.#afterAccessibility(host),
      );
      return Promise.resolve(null);
    }
    this.#pressing ??= this.#pressScreen(host)
      .catch((cause: unknown) => {
        logger.warn("HXBot could not turn on its Screen Recording switch.", { cause: toLogValue(cause) });
        return null;
      })
      .finally(() => {
        this.#pressing = null;
      });
    return this.#pressing;
  }

  /**
   * After computer_install was refused (v1.6.8, F6): the App Management page is open, and HXBot
   * turns on its own switch there if it can. Never rejects.
   */
  pressAppManagement(): Promise<HxGrantPress | null> {
    const host = this.#host;
    if (!host) return Promise.resolve(null);
    return this.#pressOnPage(host, "App Management").catch((cause: unknown) => {
      logger.warn("HXBot could not turn on its App Management switch.", { cause: toLogValue(cause) });
      return null;
    });
  }

  async #pressScreen(host: HxMacGrantsHost): Promise<HxGrantPress | null> {
    if (host.screenRecording()) return { status: "on" };
    if (!host.accessibility()) return null;
    await host.askScreenRecording().catch(() => undefined);
    const result = await this.#pressOnPage(host, "Screen Recording");
    if (result?.status === "pressed")
      void this.#watch(
        "screen-recording",
        host,
        () => host.screenRecording(),
        () => this.#refresh(host),
      );
    return result;
  }

  /** Presses HXBot's switch on the System Settings page that is open. Null without Accessibility. */
  async #pressOnPage(host: HxMacGrantsHost, page: string): Promise<HxGrantPress | null> {
    if (!host.accessibility()) return null;
    const address = await this.#driverAddress(host);
    if (!address) return null;
    const wait = host.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let pid: number | null = null;
    for (let waited = 0; pid === null && waited <= 10_000; waited += 500) {
      pid = await host.settingsPid();
      if (pid === null) await wait(500);
    }
    if (pid === null) return { status: "no_window" };
    const socket = host.connect?.(address) ?? new HxDriverSocket(() => address, "hxbot-grant");
    let result: HxGrantPress;
    try {
      result = await hxPressGrant({ driver: socket, pid, names: host.names, wait });
    } finally {
      socket.close();
    }
    logger.info("HXBot pressed its switch in System Settings.", { page, result: result.status });
    return result;
  }

  /** The driver's address, once it runs: it needs only Accessibility. */
  async #driverAddress(host: HxMacGrantsHost): Promise<string | null> {
    const state = await runCauseEffect(host.driver.state());
    if (state.status !== "ready") return null;
    if (!host.driver.running()) await runCauseEffect(host.driver.start());
    return hxDriverAddress(host.driver.mcpServerConfig());
  }

  async #afterAccessibility(host: HxMacGrantsHost): Promise<void> {
    await this.#refresh(host);
    if (host.screenRecording()) return;
    await this.prepare("screen-recording");
    await host.openPage("screen-recording");
    await this.press("screen-recording");
  }

  async #refresh(host: HxMacGrantsHost): Promise<void> {
    await runCauseEffect(host.driver.state()).catch(() => undefined);
  }

  /** Waits for a grant while the user gives it, then runs `then` once. One watch per grant. */
  async #watch(id: string, host: HxMacGrantsHost, granted: () => boolean, then: () => Promise<void>): Promise<void> {
    if (this.#watching.has(id)) return;
    this.#watching.add(id);
    const wait = host.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    try {
      for (let waited = 0; waited < WATCH_MS; waited += 1000) {
        if (granted()) {
          await then();
          return;
        }
        await wait(1000);
      }
    } catch (cause) {
      logger.warn("HXBot stopped waiting for a grant.", { grant: id, cause: toLogValue(cause) });
    } finally {
      this.#watching.delete(id);
    }
  }
}

/** The one instance: the Grant buttons and the step tools both reach it. */
export const hxMacGrants = new HxMacGrants();
