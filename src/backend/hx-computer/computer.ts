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
import { hxFlow } from "../hx-flow/ledger";
import type { HxProgressWriter } from "../hx-progress/progress";
import { HX_SKILL_TOOL } from "../hx-skills/declarations";
import { hxSkillStopAll, hxSkillToolCall } from "../hx-skills/host";
import type { DynamicToolCallParams, DynamicToolResult } from "../protocol";
import { HxComputerActions } from "./actions";
import { hxAppControl } from "./app-control";
import { HxCatalog } from "./catalog";
import { type HxDriverPort, HxDriverSocket } from "./driver";
import { HxDriverDoctor, type HxDriverHelp } from "./driver-help";
import { type HxClipboardKeep, hxFrontWatch } from "./front";
import { hxFrontWindow } from "./front-window";
import { HX_INSTALL_FILES, hxInstallApp } from "./install";
import { type HxLaneHolder, hxComputerLanes } from "./lanes";
import { HxAutoResumeSetting } from "./park-setting";
import { type HxParkedWork, hxParkedSteps } from "./parked";
import { type HxPresenceSource, hxPresence } from "./presence";
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
import { HxComputerStops, type HxLookSnapshot } from "./steps";
import { type HxComputerAllowed, hxComputerToolCall } from "./tools";
import { HX_COMPUTER_VERIFIED } from "./verified";
import { type HxWorkDeps, hxStepWork, hxSystemTurn, hxUserSaid } from "./work";

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
  async status(): Promise<HxComputerStatus> {
    return { ...(await parts().catalog.status()), autoResume: hxComputerAutoResume.get() };
  },
  async rebuild(): Promise<HxComputerStatus> {
    const current = parts().catalog;
    if (current.platform !== null) await current.rebuild();
    return { ...(await current.status()), autoResume: hxComputerAutoResume.get() };
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
   *
   * HXBot (v1.7.3): `routine` says that a routine started the turn: its steps wait for a longer pause
   * of the user. The calls no longer wait in one line for each other (CONC-05): a read waits for
   * nobody, the steps of one app wait for that app, the front of the screen and the system for theirs.
   */
  toolCall(
    agent: {
      id?: string;
      name: string;
      computerUse: boolean;
      inTask: boolean;
      routine?: boolean;
      /** HXBot (v1.7.4): the conversation's public thread id: computer_skill keeps a task's versions together. */
      threadId?: string | null;
    } | null,
    params: Pick<DynamicToolCallParams, "tool" | "arguments">,
  ): Promise<DynamicToolResult> {
    const record = (detail: string) => {
      hxAccessStore.record({ agent: agent?.name ?? "", kind: "command", detail, outcome: "auto" });
    };
    const holder: HxLaneHolder = {
      agentId: agent?.id ?? "",
      name: agent?.name ?? "",
      tier: agent?.routine ? 3 : agent?.id ? (hxFlow.tierOf(agent.id) ?? 2) : 2,
    };
    // HXBot (v1.7.4, CU-07): the skills work on files directly; only settings, old formats and a live
    // PivotTable take the system lane, because they use an app.
    if (params.tool === HX_SKILL_TOOL) {
      const allowed = hxComputerAllowed(agent);
      const current = parts();
      return hxComputerCounted(() =>
        hxSkillToolCall({
          agent: agent?.id ? { id: agent.id, name: agent.name, threadId: agent.threadId ?? null } : null,
          allowed,
          arguments: params.arguments,
          run: hxRun,
          settings: current.catalog.platform === null ? null : current.actions,
          systemTurn: (work) =>
            hxSystemTurn(
              holder,
              { lanes: hxComputerLanes, presence: hxPresence, stopped: () => stopHolds(Date.now()) },
              work,
            ),
        }),
      );
    }
    if (HX_COMPUTER_STEP_TOOL_NAMES.has(params.tool)) {
      const agentId = agent?.id ?? "";
      return hxComputerCounted(async () => {
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
            work: agentId && hxComputerAllowed(agent) === "yes" ? hxStepWork(holder, workDeps(agentId)) : null,
          },
          params,
        );
      });
    }
    const allowed = hxComputerAllowed(agent);
    const call = () =>
      hxComputerToolCall(parts().actions, allowed, params, record, {
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
      });
    // computer_find only reads the catalog; a refusal needs no lane either.
    if (params.tool === "computer_find" || allowed !== "yes") return hxComputerCounted(call);
    return hxComputerCounted(() =>
      hxSystemTurn(
        holder,
        { lanes: hxComputerLanes, presence: hxPresence, stopped: () => stopHolds(Date.now()) },
        call,
      ),
    );
  },
  /**
   * HXBot (v1.7.3, CONC-06): the user wrote to an agent. “现在做” or “放弃” to an agent with a parked
   * step decides that step; the message reaches the agent as always.
   */
  userSaid(agentId: string, text: string): void {
    try {
      hxUserSaid(hxParkedSteps, agentId, text);
    } catch {
      // A reply is not worth stopping the message for.
    }
  },
  /** HXBot (v1.7.3, CONC-06): the main process reads the user's idle time and the lock of the screen. */
  setPresenceSource(source: HxPresenceSource | null): void {
    hxPresence.setSource(source);
  },
  /**
   * HXBot (v1.7.3, CONC-06): the agent service sends an agent its “continue” message for a parked
   * step, through the mailbox like a message of the user.
   */
  setResumeHost(resume: ((agentId: string, text: string) => Promise<void>) | null): void {
    resumeHost = resume;
    hxParkedSteps.setHost(resume ? parkHost : null);
  },
  /** The setting “停放后自动续做” of Settings → Computer Use (default on). */
  autoResume(): boolean {
    return hxComputerAutoResume.get();
  },
  setAutoResume(on: boolean): Promise<HxComputerStatus> {
    hxComputerAutoResume.set(on);
    return hxComputer.status();
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
    watchDriver?.close();
    watchDriver = null;
  },
  /**
   * The user's stop keys (v1.6.7): HXBot's own steps stop before the next one, for every agent, for
   * a short while; the agents' next driver calls are refused in the main process for as long.
   */
  stopAll(now = Date.now()): void {
    hxComputerStops.stop(null);
    stopUntil = now + HX_COMPUTER_STOP_MS;
    // v1.7.4 (CU-07): skill calls that have not written yet stop and take their work back.
    hxSkillStopAll();
    // v1.7.3 (CONC-05, CONC-06): every lane, every wait for one, and every parked step.
    hxComputerLanes.stopAll();
    hxParkedSteps.dropAll();
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

/**
 * Counts one computer action while it runs (the stop keys are held then). Until v1.7.2 every action
 * also waited for the ones before it, in one line for the whole computer (v1.6.6); v1.7.3 gives them
 * lanes instead (lanes.ts, CONC-05): a read waits for nobody, the steps of one app wait for that app.
 */
async function hxComputerCounted<T>(action: () => Promise<T>): Promise<T> {
  computerRunning += 1;
  try {
    return await action();
  } finally {
    computerRunning -= 1;
    computerLastAt = Date.now();
  }
}

/** The setting “停放后自动续做” (CONC-06), in HXBot's data folder. */
const hxComputerAutoResume = new HxAutoResumeSetting(hxAppDataFolder);

/** The last outline each agent read, for the indexes of its next steps (CU-06). */
const looks = new Map<string, HxLookSnapshot>();

/** The connection of the watch of parked steps: it reads which window is in front. */
let watchDriver: HxDriverSocket | null = null;

function watchConnection(): HxDriverPort | null {
  const host = stepHost;
  if (!host) return null;
  watchDriver ??= new HxDriverSocket(() => host.driverAddress(), "hxbot-watch");
  return watchDriver;
}

/** The window in front now (CONC-06), with the product's front watch. */
function frontWindowNow(driver: HxDriverPort | null): Promise<{ pid: number; windowId: number | null } | null> {
  return hxFrontWindow(hxFrontWatch(hxRun), driver);
}

function workDeps(agentId: string): HxWorkDeps {
  return {
    lanes: hxComputerLanes,
    presence: hxPresence,
    parked: hxParkedSteps,
    frontWindow: () => frontWindowNow(stepDriver(agentId)),
    driver: () => stepDriver(agentId),
    stopped: () => stopHolds(Date.now()) && hxComputerStops.stopped(agentId),
    looks,
    note: (text) => stepHost?.note?.(agentId, text),
    parkedLine: (work, seconds) => hxParkedLine(work, seconds),
  };
}

/** The line of a parked step in the agent's chat, with the replies the user can give. */
function hxParkedLine(work: HxParkedWork, seconds: number): string {
  const app = work.window.app || work.window.title || "—";
  if (work.why === "locked") return sourceText("status.agent.hxComputer.parkedLocked", { app });
  return sourceText("status.agent.hxComputer.parked", { app, seconds });
}

/** The “continue” message of a parked step, which the agent gets as a message of the user. */
function hxResumeText(work: HxParkedWork): string {
  return sourceText("status.agent.hxComputer.resume", {
    app: work.window.app || work.window.title || "—",
    count: work.remaining,
  });
}

let resumeHost: ((agentId: string, text: string) => Promise<void>) | null = null;

const parkHost = {
  userIdleMs: () => hxPresence.userIdleMs(),
  locked: () => hxPresence.locked(),
  frontWindow: () => frontWindowNow(watchConnection()),
  resume: async (work: HxParkedWork) => {
    await resumeHost?.(work.agentId, hxResumeText(work));
  },
  autoResume: () => hxComputerAutoResume.get(),
  remind: (work: HxParkedWork) => {
    stepHost?.note?.(
      work.agentId,
      sourceText("status.agent.hxComputer.parkedLong", { app: work.window.app || work.window.title || "—" }),
    );
  },
};

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
