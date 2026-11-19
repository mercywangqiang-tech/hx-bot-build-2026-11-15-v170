// HXBot（v1.7.3 紧急修正）：边干活边更新。
//
// 用户 2026-11-19：“边干活便更新，更新完，保存，然后重启！”
// 新版本随时在后台下载、装好（hx-update-policy.ts）。自动重启等助手空闲，最多等 HX_UPDATE_IDLE_WAIT_MS；
// 等的时候新的定时任务先不开始（不然一直有活，永远等不到空闲）。到时间还在忙也重启：重启前把定时任务暂停的时段
// 和被打断的助手写进数据文件夹，下次启动时定时任务补跑（routine-hold-file.ts），被打断的助手收到一条“接着做”，
// 像用户发的消息一样排队（agent-service 的 hxContinueAfterUpdate）。
//
// 重启没有发生（取消、装不上）时，写下的两个文件都删掉，下次启动不会误发“接着做”。

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { HX_UPDATE_IDLE_WAIT_MS } from "@hxbot/contracts/hx-update-policy";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { sourceText } from "@hxbot/i18n/source";
import { isMissingFileError } from "../backend/file-errors";
import { writeRoutineHold } from "./routine-hold-file";

/** In the data folder: the agents that an update restart cut off. */
export const HX_UPDATE_RESUME_FILE = "hx-update-resume.json";

/** A list older than this is from a restart that did not come right after it; nobody is told to continue then. */
export const HX_UPDATE_RESUME_MAX_AGE_MS = 30 * 60_000;

/** What the restart cut off. */
export interface HxUpdateResume {
  at: Date;
  agentIds: string[];
}

export function hxWriteUpdateResume(path: string, resume: HxUpdateResume): void {
  // Synchronous: the process quits right after the restart begins.
  writeFileSync(path, JSON.stringify({ version: 1, at: resume.at.toISOString(), agentIds: resume.agentIds }), {
    mode: 0o600,
  });
}

/** Reads the list once and removes the file. Null without a file, for a damaged one, and for one that is too old. */
export function hxTakeUpdateResume(
  path: string,
  log: (message: string) => void,
  now: () => number = Date.now,
): HxUpdateResume | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) log(`The update restart list could not be read: ${String(error)}`);
    return null;
  }
  try {
    rmSync(path, { force: true });
  } catch (error) {
    // Read once more at the next start: the age check below then drops it.
    log(`The update restart list could not be removed: ${String(error)}`);
  }
  try {
    const parsed = JSON.parse(text);
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || typeof parsed.at !== "string") return null;
    const at = new Date(parsed.at);
    const ids = Array.isArray(parsed.agentIds) ? parsed.agentIds : [];
    const agentIds = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
    const age = now() - at.getTime();
    if (Number.isNaN(age) || age < 0 || age > HX_UPDATE_RESUME_MAX_AGE_MS) return null;
    return { at, agentIds };
  } catch {
    return null;
  }
}

/** The message that an agent cut off by the update restart gets, in the source language (the screen translates it). */
export function hxUpdateResumeText(version: string): string {
  return sourceText("status.agent.hxUpdate.resume", { version });
}

export interface HxUpdateRestartOptions {
  holdRoutines: () => void;
  releaseRoutines: () => void;
  /** The routine hold file of an idle restart: the next start runs the routines held in this window. */
  routineHoldPath: string;
  resumePath: string;
  /** The agents whose own chat runs a turn now. */
  agentsInTurn: () => string[];
  log: (message: string) => void;
  now?: () => Date;
}

/**
 * The part of the automatic update restart that keeps the work: holds new routine runs while the restart waits,
 * and saves what the restart cuts off just before it.
 */
export class HxUpdateRestartKeeper {
  /** The longest the automatic restart waits for idle agents (hx-update-policy.ts). */
  readonly idleWaitMs = HX_UPDATE_IDLE_WAIT_MS;
  readonly #options: HxUpdateRestartOptions;
  #heldSince: Date | null = null;
  #wrote = false;

  constructor(options: HxUpdateRestartOptions) {
    this.#options = options;
  }

  /** True: the restart waits. False: there is no restart to wait for (cancelled, failed, replaced). */
  hold(held: boolean): void {
    const now = this.#options.now ?? (() => new Date());
    if (held) {
      if (this.#heldSince) return;
      this.#heldSince = now();
      this.#options.holdRoutines();
      return;
    }
    if (this.#heldSince) {
      this.#heldSince = null;
      this.#options.releaseRoutines();
    }
    // The restart did not happen: the next start must not run the routines twice or tell anybody to continue.
    if (this.#wrote) {
      this.#wrote = false;
      for (const path of [this.#options.routineHoldPath, this.#options.resumePath]) {
        try {
          rmSync(path, { force: true });
        } catch (error) {
          this.#options.log(`A file of the update restart could not be removed: ${String(error)}`);
        }
      }
    }
  }

  /** Just before the restart. `waitingFor` is empty when the agents are idle. Never throws: the restart goes on. */
  beforeRestart(waitingFor: string[]): void {
    const now = (this.#options.now ?? (() => new Date()))();
    try {
      if (this.#heldSince) {
        writeRoutineHold(this.#options.routineHoldPath, { since: this.#heldSince, until: now });
        this.#wrote = true;
      }
      const agentIds = waitingFor.length > 0 ? this.#options.agentsInTurn() : [];
      if (agentIds.length > 0) {
        hxWriteUpdateResume(this.#options.resumePath, { at: now, agentIds });
        this.#wrote = true;
        this.#options.log(`The update restart cuts off ${agentIds.length} agents; they continue after it.`);
      }
    } catch (error) {
      this.#options.log(`What the update restart cuts off could not be saved: ${String(error)}`);
    }
  }
}

/**
 * At the start after an update restart: each agent that the restart cut off, and that still exists, gets the message
 * to continue. Returns how many got it.
 */
export async function hxContinueAfterUpdate(options: {
  resumePath: string;
  version: string;
  agentExists: (agentId: string) => boolean;
  continueAgent: (agentId: string, text: string) => Promise<void>;
  log: (message: string) => void;
  now?: () => number;
}) {
  const resume = hxTakeUpdateResume(options.resumePath, options.log, options.now);
  if (!resume) return 0;
  const text = hxUpdateResumeText(options.version);
  let told = 0;
  for (const agentId of resume.agentIds) {
    if (!options.agentExists(agentId)) continue;
    try {
      await options.continueAgent(agentId, text);
      told += 1;
    } catch (error) {
      options.log(`An agent cut off by the update restart could not be told to continue: ${String(error)}`);
    }
  }
  if (told > 0) options.log(`Told ${told} agents to continue the work that the update restart cut off.`);
  return told;
}
