// HXBot v1.7.4（CU-07）：computer_skill 接进电脑操控。版本仓库（数据目录 file-versions/）全程序一个，
// 第一次用之前先收拾上次没写完的（recover）；改了文件的卡片由智能体服务接上（hxSetSkillUiHost），“空间满了”
// 的提问是这次调用所在对话的提问卡（ask，v1.7.4 #54）。问不了时空间满一律“取消修改”，不替用户选。
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  HxFileVersionsView,
  HxRestoreFileChangeInput,
  HxRestoreFileChangeResult,
} from "@hxbot/contracts/hx-file-change";
import { sourceText } from "@hxbot/i18n";
import { hxAccessAgent, hxAppDataFolder } from "../hx-access/hub";
import { hxProtectedRoots } from "../hx-access/policy";
import { hxAccessStore } from "../hx-access/rules";
import type { HxRunner } from "../hx-computer/runner";
import { HxFileVersions } from "../hx-files/versions";
import type { DynamicToolResult } from "../protocol";
import type { HxAsk } from "./ask";
import { hxRestoreFileChange } from "./change-card";
import { HX_SKILLS, hxExtension } from "./declarations";
import { HX_SKILL_ARGS, type HxJson } from "./operations";
import { HX_SKILL_DEADLINE_MS, type HxFileChangeEvent, HxSkillRequests, HxSkillRunner } from "./run";
import type { HxSettingsHost } from "./settings";
import { hxAskSpaceFull } from "./space-question";

let versions: HxFileVersions | null = null;
/** Request ids answered in this run of HXBot (idempotency; spec §3.3). */
const requests = new HxSkillRequests();
/** The skill calls that run now: the user's stop keys abort them (what is not written yet is taken back). */
const running = new Set<AbortController>();

/** The stop keys: every skill call that has not written yet stops and takes its work back. */
export function hxSkillStopAll(): void {
  for (const controller of running) controller.abort();
}
let recovered: Promise<unknown> | null = null;

/** The one store of file versions, once the data folder is known. */
function hxFileVersionsStore(): HxFileVersions | null {
  const folder = hxAppDataFolder();
  if (!folder) return null;
  versions ??= new HxFileVersions({ root: () => join(hxAppDataFolder() ?? folder, "file-versions") });
  return versions;
}

/** The store after the leftovers of a crash were put right (once per run of HXBot). */
async function hxReadyFileVersions(): Promise<HxFileVersions | null> {
  const store = hxFileVersionsStore();
  if (!store) return null;
  recovered ??= store.recover().catch(() => undefined);
  await recovered;
  return store;
}

/**
 * What the conversation shows: the card of a change. The question when the space is full comes with
 * each call (`ask`): it is a question card of the turn that made the call.
 */
export interface HxSkillUiHost {
  changed(agentId: string, event: HxFileChangeEvent): void;
}

let uiHost: HxSkillUiHost | null = null;

export function hxSetSkillUiHost(host: HxSkillUiHost | null): void {
  uiHost = host;
}

/** Settings → Computer Use: the space the versions may take, and what they take now. */
export async function hxFileVersionsView(): Promise<HxFileVersionsView> {
  const store = await hxReadyFileVersions();
  if (!store) throw new Error(sourceText("status.agent.hxSkill.restore.starting"));
  const { capBytes, defaultCapBytes, custom, usedBytes, versions } = await store.settings();
  return { capBytes, defaultCapBytes, custom, usedBytes, versions };
}

/** Sets the space (null: the default). A smaller space deletes nothing; the next change asks when it is full. */
export async function hxFileVersionsSetCap(bytes: number | null): Promise<HxFileVersionsView> {
  const store = await hxReadyFileVersions();
  if (!store) throw new Error(sourceText("status.agent.hxSkill.restore.starting"));
  await store.setCap(bytes);
  return hxFileVersionsView();
}

/** “恢复到修改前” on the card of a change (change-card.ts); the record names the user as the one who restored. */
export async function hxRestoreFileChangeCall(input: HxRestoreFileChangeInput): Promise<HxRestoreFileChangeResult> {
  return hxRestoreFileChange(input, await hxReadyFileVersions(), "user");
}

/** Whether a call needs an app or the system (and so the system lane): settings, legacy files, a live PivotTable. */
function hxSkillNeedsApp(args: unknown): boolean {
  const parsed = HX_SKILL_ARGS.safeParse(args);
  if (!parsed.success) return false;
  const { skill, action, files = [] } = parsed.data;
  if (skill === "settings") return true;
  const declaration = HX_SKILLS[skill];
  if (declaration.actions[action]?.app) return true;
  return files.some((file) => declaration.appTypes.includes(hxExtension(file)));
}

export interface HxSkillCallInput {
  agent: { id: string; name: string; threadId: string | null } | null;
  allowed: "yes" | "task" | "off";
  arguments: unknown;
  run: HxRunner;
  settings: HxSettingsHost | null;
  /** Runs app work in the system lane; it answers by itself when the lane is busy. */
  systemTurn: (work: () => Promise<DynamicToolResult>) => Promise<DynamicToolResult>;
  /** v1.7.4 (BAK-03): asks the user in the conversation of the call; null where nobody can answer. */
  ask?: HxAsk | null;
}

function result(ok: boolean, answer: { readonly [key: string]: HxJson | undefined }): DynamicToolResult {
  return { success: ok, contentItems: [{ type: "inputText", text: JSON.stringify(answer) }] };
}

/** One computer_skill call. It never rejects: every problem is an answer the model can read. */
export async function hxSkillToolCall(input: HxSkillCallInput): Promise<DynamicToolResult> {
  const agent = input.agent;
  if (!agent) return result(false, { ok: false, code: "off", error: "No agent owns this chat." });
  const store = await hxReadyFileVersions();
  if (!store)
    return result(false, { ok: false, code: "failed", error: "HXBot is still starting. Try again in a moment." });
  const dataFolder = hxAppDataFolder();
  const task = agent.threadId ?? `agent-${agent.id}`;
  const ui = uiHost;
  const ask = input.ask ?? null;
  const stop = new AbortController();
  running.add(stop);
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(HX_SKILL_DEADLINE_MS)]);
  const runner = new HxSkillRunner({
    signal,
    requests,
    files: { signal },
    versions: store,
    record: (entry) => hxAccessStore.record({ agent: agent.name, ...entry }),
    // BAK-03-A2: a full space stops the change and asks; with nobody to ask, the change is cancelled.
    askSpaceFull: ask ? (question) => hxAskSpaceFull(ask, question, signal) : null,
    app: { run: input.run, platform: process.platform },
    settings: input.settings,
    protectedRoots: hxProtectedRoots(homedir(), dataFolder ? [dataFolder] : []),
    ...(ui ? { onChange: (event: HxFileChangeEvent) => ui.changed(agent.id, event) } : {}),
  });
  const work = async () => {
    const answer = await runner.run(
      { agentName: agent.name, task, cwd: hxAccessAgent(agent.id)?.workspacePath ?? homedir(), allowed: input.allowed },
      input.arguments,
    );
    return result(answer.ok, answer.answer);
  };
  try {
    return hxSkillNeedsApp(input.arguments) && input.allowed === "yes" ? await input.systemTurn(work) : await work();
  } catch (error) {
    return result(false, {
      ok: false,
      code: "failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "It did not work.",
    });
  } finally {
    running.delete(stop);
  }
}
