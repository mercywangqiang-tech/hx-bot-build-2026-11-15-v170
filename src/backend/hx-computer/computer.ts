// HXBot 电脑操控（一）：这台电脑的目录和三个工具的入口。主进程的设置页和智能体的工具路由都从这里进。
// 目录第一次被用到时才建立；数据文件夹由应用启动时设好（hx-access/hub.ts 的 hxAppDataFolder）。
// 启动十秒后在后台先读一遍（hxComputerWarmUp），这样助手第一次用的时候不用等：这一遍在 Windows 上
// 实测要 3 秒，在我们测过的一台 ARM 电脑上要 29 秒（那里启动一次 PowerShell 就要 22 秒）。
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import type { HxComputerPlatform, HxComputerStatus, HxSelfTestReport } from "@hxbot/contracts/hx-computer";
import { agentComputerUseEnabled, CHANNEL_CHANGE_ITEM_TYPE, type ConversationMessage } from "@hxbot/contracts/ipc";
import { sourceText } from "@hxbot/i18n";
import { hxAppDataFolder } from "../hx-access/hub";
import { hxAccessStore } from "../hx-access/rules";
import type { HxProgressWriter } from "../hx-progress/progress";
import type { DynamicToolCallParams, DynamicToolResult } from "../protocol";
import { HxComputerActions } from "./actions";
import { hxAppControl } from "./app-control";
import { HxCatalog } from "./catalog";
import { HxDriverSocket } from "./driver";
import { HxDriverDoctor, type HxDriverHelp } from "./driver-help";
import { type HxClipboardKeep, hxFrontWatch } from "./front";
import { HX_INSTALL_FILES, hxInstallApp } from "./install";
import { hxRunScript } from "./run-script";
import { hxRun, hxRunBackground } from "./runner";
import { hxSelfTest } from "./selftest";
import {
  HX_COMPUTER_STEP_TOOL_NAMES,
  type HxComputerPlan,
  hxComputerPlanCard,
  hxComputerStepToolCall,
  hxStepToolNeedsDriver,
} from "./step-tools";
import { HxComputerStops } from "./steps";
import { type HxComputerAllowed, hxComputerToolCall } from "./tools";
import { HX_COMPUTER_VERIFIED } from "./verified";

export function hxComputerPlatform(platform: NodeJS.Platform): HxComputerPlatform | null {
  if (platform === "darwin") return "mac";
  return platform === "win32" ? "windows" : null;
}

/** True when the system shows its own text in Chinese. */
export function hxChineseSystem(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}

/** Whether a conversation of this agent may use the tools; see `HxComputerAllowed`. */
export function hxComputerAllowed(agent: { computerUse: boolean; inTask: boolean } | null): HxComputerAllowed {
  if (agent?.computerUse !== true) return "off";
  return agent.inTask ? "task" : "yes";
}

/** How long after the start the catalog is read, so that the start itself is not made slower. */
export const HX_COMPUTER_WARM_UP_MS = 10_000;

let catalog: HxCatalog | null = null;
let actions: HxComputerActions | null = null;
let warmedUp = false;

function parts(): { catalog: HxCatalog; actions: HxComputerActions } {
  const platform = hxComputerPlatform(process.platform);
  catalog ??= new HxCatalog({
    platform,
    verified: platform === null ? [] : HX_COMPUTER_VERIFIED[platform],
    // HXBot (v1.7.0, F7): the catalog read waits for nobody, so it runs at the lowest priority.
    run: hxRunBackground,
    home: homedir(),
    dataFolder: hxAppDataFolder,
    chineseFirst: hxChineseSystem(Intl.DateTimeFormat().resolvedOptions().locale),
    now: () => Date.now(),
  });
  actions ??= new HxComputerActions(catalog, hxRun);
  return { catalog, actions };
}

/**
 * Reads the catalog once in the background, a while after the start. A saved list that is not a day
 * old is used as it is, so this costs nothing then. It never rejects and it waits for nothing.
 */
export function hxComputerWarmUp(
  wait: (body: () => void, ms: number) => unknown = setTimeout,
  afterMs: number = HX_COMPUTER_WARM_UP_MS,
): void {
  if (warmedUp || hxComputerPlatform(process.platform) === null) return;
  warmedUp = true;
  const timer = wait(() => {
    void parts().catalog.entries();
  }, afterMs);
  // The timer must not hold the app open at the end.
  if (timer && typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") timer.unref();
}

export const hxComputer = {
  status(): Promise<HxComputerStatus> {
    return parts().catalog.status();
  },
  async rebuild(): Promise<HxComputerStatus> {
    const current = parts().catalog;
    if (current.platform !== null) await current.rebuild();
    return current.status();
  },
  selfTest(): Promise<HxSelfTestReport> {
    const current = parts();
    return hxSelfTest({
      catalog: current.catalog,
      actions: current.actions,
      run: hxRun,
      home: homedir(),
      dataFolder: hxAppDataFolder,
      now: () => Date.now(),
    });
  },
  /**
   * One call of computer_find, computer_open or computer_set, for the agent of the calling thread.
   * `computerUse` is that agent's Computer Use setting, and `inTask` says that the thread is a task of
   * the agent, which runs without Computer Use; no agent means the call is refused. What was opened
   * or changed goes to the activity record of Settings → Access & activity.
   */
  toolCall(
    agent: { id?: string; name: string; computerUse: boolean; inTask: boolean } | null,
    params: Pick<DynamicToolCallParams, "tool" | "arguments">,
  ): Promise<DynamicToolResult> {
    const record = (detail: string) => {
      hxAccessStore.record({ agent: agent?.name ?? "", kind: "command", detail, outcome: "auto" });
    };
    if (HX_COMPUTER_STEP_TOOL_NAMES.has(params.tool)) {
      const agentId = agent?.id ?? "";
      return hxComputerInTurn(async () => {
        // A driver that is not up yet: start it if the grants are there, or say which grant is missing.
        const host = stepHost;
        if (agentId && host && hxComputerAllowed(agent) === "yes" && hxStepToolNeedsDriver(params.tool)) {
          const blocked = await driverDoctor.ensure({ agentId, address: () => host.driverAddress(), note: host.note });
          if (blocked) return blocked;
        }
        return hxComputerStepToolCall(
          {
            allowed: agentId ? hxComputerAllowed(agent) : "off",
            driver: agentId ? stepDriver(agentId) : null,
            stopped: () => stopHolds(Date.now()) && hxComputerStops.stopped(agentId),
            front: hxFrontWatch(hxRun),
            clipboard: clipboardKeep,
            plan: {
              get: () => plans.get(agentId) ?? null,
              set: (plan, stopped) => {
                plans.set(agentId, plan);
                stepHost?.progress(agentId, plan.id, hxComputerPlanCard(plan), stopped);
              },
            },
            newId: () => `hx-computer-${randomUUID()}`,
            stopKeys: process.platform === "darwin" ? "⌃⌥Esc" : "Ctrl+Alt+Esc",
            record,
          },
          params,
        );
      });
    }
    return hxComputerInTurn(() =>
      hxComputerToolCall(parts().actions, hxComputerAllowed(agent), params, record, {
        install: (input) =>
          hxInstallApp(
            {
              run: hxRun,
              files: HX_INSTALL_FILES,
              platform: process.platform,
              trashItem: (path) => installHelp?.trashItem(path) ?? rm(path, { recursive: true, force: true }),
              askAppManagement: () => installHelp?.askAppManagement() ?? Promise.resolve(),
            },
            input,
          ),
        app: (input) =>
          hxAppControl(
            {
              run: hxRun,
              platform: process.platform,
              sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
              openAutomationPage: () => installHelp?.openAutomation?.() ?? Promise.resolve(),
            },
            input,
          ),
        run: (input) =>
          hxRunScript(
            {
              run: hxRun,
              platform: process.platform,
              openAutomationPage: () => installHelp?.openAutomation?.() ?? Promise.resolve(),
            },
            input,
          ),
      }),
    );
  },
  /**
   * Set by the agent service (v1.6.7): where the Computer Use driver listens, and a line in an
   * agent's chat. Without it the step tools answer that Computer Use is not running.
   */
  /**
   * Set by the main process (v1.6.7): it asks the driver what it may do, starts it, and opens the
   * System Settings page of a missing grant.
   */
  setDriverHelp(help: HxDriverHelp | null): void {
    driverDoctor.set(help);
  },
  /** Set by the main process (v1.6.8): the Trash, and the App Management page for computer_install. */
  setInstallHelp(help: HxInstallHelp | null): void {
    installHelp = help;
  },
  /** Set by the main process (v1.7.0): keeps the user's clipboard around typed text. */
  setClipboardKeep(keep: HxClipboardKeep | null): void {
    clipboardKeep = keep;
  },
  /** HXBot (v1.7.0): true while a computer tool runs, or when one ended less than `ms` ago. */
  workedWithin(ms: number): boolean {
    return computerRunning > 0 || Date.now() - computerLastAt < ms;
  },
  setStepHost(host: HxComputerStepHost | null): void {
    stepHost = host;
    for (const driver of drivers.values()) driver.close();
    drivers.clear();
  },
  /**
   * The user's stop keys (v1.6.7): HXBot's own steps stop before the next one, for every agent, for
   * a short while; the agents' next driver calls are refused in the main process for as long.
   */
  stopAll(now = Date.now()): void {
    hxComputerStops.stop(null);
    stopUntil = now + HX_COMPUTER_STOP_MS;
    // A plan that still runs shows as stopped.
    for (const [agentId, plan] of plans) {
      if (!plan.steps.some((step) => step.state === "active")) continue;
      stepHost?.progress(agentId, plan.id, hxComputerPlanCard(plan), true);
      plans.delete(agentId);
    }
  },
  /** Whether the user's stop still holds. */
  stopping(now = Date.now()): boolean {
    return stopHolds(now);
  },
};

/** Whether the stop keys still hold; after the time, the stop is released. */
function stopHolds(now: number): boolean {
  if (stopUntil > 0 && now >= stopUntil) {
    stopUntil = 0;
    hxComputerStops.releaseAll();
  }
  return stopUntil > 0;
}

/** What the step tools need from the agent service. */
export interface HxComputerStepHost {
  driverAddress(): string | null;
  /** A progress card in the agent's chat, written again in place under the same id. */
  progress: HxProgressWriter;
  /** A small line in the agent's chat. */
  note?: (agentId: string, text: string) => void;
}

/** How long the stop keys hold: long enough for the agent's turn to see the refusals and end. */
export const HX_COMPUTER_STOP_MS = 15_000;

let stepHost: HxComputerStepHost | null = null;
const driverDoctor = new HxDriverDoctor();
let stopUntil = 0;

/** What computer_install (v1.6.8), computer_app and computer_run (v1.6.9) need from the main process. */
export interface HxInstallHelp {
  trashItem(path: string): Promise<void>;
  askAppManagement(): Promise<void>;
  /** Opens Privacy & Security › Automation, where macOS lists the apps that HXBot may control. */
  openAutomation?(): Promise<void>;
}
let installHelp: HxInstallHelp | null = null;
let clipboardKeep: HxClipboardKeep | null = null;
/** The computer tools running now, and when the last one ended (0 for never). */
let computerRunning = 0;
let computerLastAt = 0;

const hxComputerStops = new HxComputerStops();
const drivers = new Map<string, HxDriverSocket>();
/** The last plan card of each agent, which its computer_do calls update. */
const plans = new Map<string, HxComputerPlan>();

/** One driver connection per agent, so the driver tells the agents apart (its rim and cursor follow them). */
function stepDriver(agentId: string): HxDriverSocket | null {
  const host = stepHost;
  if (!host) return null;
  let driver = drivers.get(agentId);
  if (!driver) {
    driver = new HxDriverSocket(() => host.driverAddress(), `hxbot-${agentId.slice(0, 12)}`);
    drivers.set(agentId, driver);
  }
  return driver;
}

let computerTurn: Promise<unknown> = Promise.resolve();

/**
 * Runs one computer action after the ones before it (v1.6.6). The members of a team can call the
 * computer tools at the same time; they open apps and change settings one after the other, so two
 * agents never act on this computer at once. `hxComputerToolCall` never rejects, and a call that
 * rejects anyway does not stop the ones after it.
 */
export function hxComputerInTurn<T>(action: () => Promise<T>): Promise<T> {
  const result = computerTurn.then(async () => {
    computerRunning += 1;
    try {
      return await action();
    } finally {
      computerRunning -= 1;
      computerLastAt = Date.now();
    }
  });
  computerTurn = result.catch(() => undefined);
  return result;
}

/** A small line in the agent's chat about its work on this computer (v1.6.7), like the team lines. */
export function hxComputerLine(text: string, at = new Date()): ConversationMessage {
  return {
    id: `hx-computer-${randomUUID()}`,
    author: "system",
    source: "system",
    text,
    createdAt: at.toISOString(),
    status: "completed",
    itemType: CHANNEL_CHANGE_ITEM_TYPE,
  };
}

/** The agents whose turns the stop keys end: those that may use this computer. */
export function hxComputerAgentsToStop(
  agents: ReadonlyArray<{ id: string; computerUse?: boolean | undefined }>,
): string[] {
  return agents.filter((agent) => agentComputerUseEnabled(agent)).map((agent) => agent.id);
}

/** The line the stop keys leave in each chat they stopped. */
export function hxComputerStoppedText(): string {
  return sourceText("status.agent.hxComputer.stopped");
}
