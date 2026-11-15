// HXBot 电脑操控（二）：驱动没起来时说清原因、打开授权的那一页（v1.6.7；用户 2026-11-14 把 v1.6.8
// 的这一小块“提前”）。
//
// 在 Mac 上，逐步操作只要“辅助功能”（v1.6.8：屏幕录制只给截屏用，2026-11-14 在 GitHub 的 macOS 15、26
// 上实测）。助手第一次要用逐步操作时，HXBot 先问一次驱动能不能启动（授过权的这时就自动接上）；还缺
// 辅助功能时，打开系统设置里那一页和 HXBot 的步骤窗口，在对话里写一行说清，并告诉模型请用户去打开。
import type { MacPermissionId } from "@hxbot/contracts/ipc";
import { sourceText } from "@hxbot/i18n";
import type { DynamicToolResult } from "../protocol";

/** What the main process says about the driver: its status and the grants it still lacks. */
export interface HxDriverState {
  status: string;
  missing: readonly MacPermissionId[];
  message: string | null;
}

/** What the main process does for the step tools. */
export interface HxDriverHelp {
  /** Asks the driver what it may do and starts it when it can: a grant given since works at once. */
  check(): Promise<HxDriverState>;
  /** Opens the System Settings page of a grant, with HXBot's steps window, as Settings → Computer Use does. */
  openPermission(id: MacPermissionId): Promise<void>;
}

/** The grants the step tools need. They read the controls outline and take no screenshot. */
const STEP_GRANTS: readonly MacPermissionId[] = ["accessibility"];

/** The grants the step tools still lack: only these are named, and only their page opens. */
export function hxStepGrantsMissing(
  permissions: readonly { readonly id: MacPermissionId; readonly granted: boolean }[],
): MacPermissionId[] {
  return STEP_GRANTS.filter((id) => permissions.some((permission) => permission.id === id && !permission.granted));
}

/** The same page opens, and the same line shows, at most once in this time. */
export const HX_DRIVER_HELP_AGAIN_MS = 120_000;
const CHECK_MS = 30_000;

const NAMES: Record<MacPermissionId, string> = {
  "screen-recording": "Screen Recording",
  accessibility: "Accessibility",
};

/** The line in the agent's chat. */
export function hxDriverLine(state: HxDriverState | null): string {
  if (state?.status === "permissions-required") {
    const screen = state.missing.includes("screen-recording");
    const access = state.missing.includes("accessibility");
    if (screen && access) return sourceText("status.agent.hxComputer.needBoth");
    if (screen) return sourceText("status.agent.hxComputer.needScreen");
    if (access) return sourceText("status.agent.hxComputer.needAccessibility");
  }
  const reason = (state?.message || state?.status || "no answer").replace(/\s+/g, " ").slice(0, 200);
  return sourceText("status.agent.hxComputer.notRunning", { reason });
}

/** What the model reads: the reason, and what to tell the user. */
function why(state: HxDriverState | null, opened: boolean): string {
  if (state?.status === "permissions-required" && state.missing.length) {
    const names = state.missing.map((id) => NAMES[id]).join(" and ");
    return `Computer Use needs the user's grant in macOS: ${names}. ${opened ? "HXBot opened System Settings at that page (or, when the user works in another app, a notification that opens it)" : "System Settings shows it under Privacy & Security"} and put a line in the chat. Tell the user in one short sentence to turn on HXBot there, then wait. When the user says it is done, try again: the driver starts by itself.`;
  }
  const reason = state?.message || state?.status || "the driver gave no answer";
  return `Computer Use is not running: ${reason.slice(0, 300)}. Tell the user in one short sentence; Settings → Computer Use shows why.`;
}

export class HxDriverDoctor {
  #help: HxDriverHelp | null = null;
  readonly #opened = new Map<MacPermissionId, number>();
  readonly #told = new Map<string, number>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  set(help: HxDriverHelp | null): void {
    this.#help = help;
  }

  /**
   * Null when the driver is ready, or when nothing here can tell why it is not; otherwise the answer
   * for the model, after the line in the chat and the page in System Settings.
   */
  async ensure(input: {
    agentId: string;
    address: () => string | null;
    note?: ((agentId: string, text: string) => void) | undefined;
  }): Promise<DynamicToolResult | null> {
    const help = this.#help;
    if (!help || input.address()) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const state = await Promise.race([
      help.check().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), CHECK_MS);
      }),
    ]);
    clearTimeout(timer);
    if (input.address()) return null;
    const now = this.#now();
    const first = state?.status === "permissions-required" ? state.missing[0] : undefined;
    let opened = false;
    if (first && now - (this.#opened.get(first) ?? Number.NEGATIVE_INFINITY) >= HX_DRIVER_HELP_AGAIN_MS) {
      this.#opened.set(first, now);
      opened = true;
      void help.openPermission(first).catch(() => undefined);
    }
    const key = `${input.agentId}|${state?.status ?? "none"}|${state?.missing.join(",") ?? ""}`;
    if (now - (this.#told.get(key) ?? Number.NEGATIVE_INFINITY) >= HX_DRIVER_HELP_AGAIN_MS) {
      this.#told.set(key, now);
      input.note?.(input.agentId, hxDriverLine(state));
    }
    const text = JSON.stringify({
      status: first ? "needs_permission" : "no_driver",
      missing: state?.missing ?? [],
      reason: why(state, opened),
    });
    return { success: false, contentItems: [{ type: "inputText", text }] };
  }
}
