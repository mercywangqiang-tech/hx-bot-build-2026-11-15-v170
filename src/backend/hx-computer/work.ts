// HXBot 电脑操控（五）（v1.7.3，需求 CONC-05、CONC-06）：一次电脑工具调用拿道、过门、停放，以及“现在做”“放弃”。
//
// computer.ts 把这里接到全进程唯一的分道（lanes.ts）、你在不在用（presence.ts）和停放记录（parked.ts）上。
// 测试给自己的分道、时钟和驱动，不碰全进程的那一份。
//
//  - computer_do：先拿这个应用的道（等待合计不超过 30 秒），前台步骤再过 gate.ts 的门；调用结束全部放掉。
//    停放（等待用户）时记下窗口和剩下几步，在对话里写一行提示。
//  - computer_open、computer_set、computer_install、computer_app、computer_run：拿 system 道（和前台步骤互斥）。
//    定时任务这类后台工作还要等你停手 60 秒；等不到就答复“等待用户”，不往你手下打开、关掉应用或改设置。
//  - 你给这个助手回复“现在做”：两分钟内它的前台步骤先把那个窗口切到最前面再做；回复“放弃”：停放的那一步不做了。
import type { DynamicToolResult } from "../protocol";
import type { HxDriverPort } from "./driver";
import { HxComputerGate, type HxGateWindow } from "./gate";
import { type HxComputerLanes, type HxLaneHolder, HxLeaseSet, HxWaitBudget, hxAppLane } from "./lanes";
import type { HxParkedSteps, HxParkedWork } from "./parked";
import { type HxPresence, hxIdleNeeded } from "./presence";
import type { HxStepWork } from "./step-tools";
import { type HxLookSnapshot, hxSnapshotOf } from "./steps";

/** What the work of one call needs from the process. */
export interface HxWorkDeps {
  lanes: HxComputerLanes;
  presence: HxPresence;
  parked: HxParkedSteps;
  /** The window in front now; null when it cannot be told. */
  frontWindow(): Promise<{ pid: number; windowId: number | null } | null>;
  /** The agent's own driver connection, for “现在做”. */
  driver(): HxDriverPort | null;
  stopped(): boolean;
  /** The last outlines the agents read, per agent. */
  looks: Map<string, HxLookSnapshot>;
  /** A line in the agent's chat. */
  note(text: string): void;
  /** The line of a parked step, in the user's language. */
  parkedLine(work: HxParkedWork, idleSeconds: number): string;
  wait?(ms: number): Promise<void>;
  now?(): number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The work of one step-tool call of one agent. */
export function hxStepWork(holder: HxLaneHolder, deps: HxWorkDeps): HxStepWork {
  const now = deps.now ?? Date.now;
  const budget = new HxWaitBudget(undefined, now);
  const leases = new HxLeaseSet(deps.lanes, holder, budget);
  const parkedAlready = deps.parked.get(holder.agentId) !== null;
  let window: HxGateWindow | null = null;
  let held = false;
  return {
    async begin(target, known) {
      window = target;
      deps.parked.hold(holder.agentId);
      held = true;
      const app = hxAppLane(target.app || `pid${target.pid}`);
      const taken = await leases.take(app);
      if (!taken.ok)
        return { stop: taken.why === "stopped" ? "stopped" : "busy", reason: taken.reason, etaMs: taken.etaMs };
      return {
        gate: new HxComputerGate({
          leases,
          app,
          presence: deps.presence,
          frontWindow: deps.frontWindow,
          known,
          consented: () => deps.parked.consented(holder.agentId),
          bringToFront: async (front) => {
            const driver = deps.driver();
            if (!driver) return false;
            // What the system may count as input while the window comes to the front is HXBot's.
            const done = deps.presence.beginOwnInput();
            try {
              const answer = await driver.call("bring_to_front", { pid: front.pid, window_id: front.windowId }, 10_000);
              return answer.ok && answer.refused !== true;
            } finally {
              done();
            }
          },
          parkedAlready,
          stopped: deps.stopped,
          wait: deps.wait ?? sleep,
          now,
        }),
      };
    },
    end(result, total) {
      leases.releaseAll();
      if (held) deps.parked.release(holder.agentId);
      held = false;
      if (!result) return;
      if (result.status === "waiting_user" && result.parked && window) {
        const work: HxParkedWork = {
          agentId: holder.agentId,
          tier: holder.tier,
          window,
          remaining: Math.max(1, total - result.steps.length),
          since: now(),
          why: result.parked,
        };
        const again = deps.parked.get(holder.agentId);
        deps.parked.park(work);
        // One line per parked step: a step parked again for the same window does not add another.
        if (!again || again.window.windowId !== window.windowId)
          deps.note(deps.parkedLine(work, Math.round(hxIdleNeeded(holder.tier) / 1000)));
      } else if (result.status !== "busy") {
        // The steps went on, or the work changed: the parked step is done with.
        deps.parked.drop(holder.agentId);
      }
      deps.parked.useConsent(holder.agentId);
    },
    snapshot: () => deps.looks.get(holder.agentId) ?? null,
    keepSnapshot(read) {
      if (read) deps.looks.set(holder.agentId, hxSnapshotOf(read.read, read.at));
    },
    newPlan() {
      deps.parked.drop(holder.agentId);
    },
  };
}

/** The answer of a system-lane tool that did not get its turn. */
function waitingAnswer(
  status: "busy" | "stopped" | "waiting_user",
  reason: string,
  etaMs: number | null,
): DynamicToolResult {
  return {
    success: false,
    contentItems: [
      { type: "inputText", text: JSON.stringify({ status, reason, ...(etaMs === null ? {} : { etaMs }) }) },
    ],
  };
}

/**
 * One call of a tool that opens, starts or stops apps, changes settings, installs or runs a script:
 * the system lane, which waits for the front-of-screen steps of the other agents and they for it.
 * A routine (tier 3) also waits until the user has stopped for 60 seconds.
 */
export async function hxSystemTurn(
  holder: HxLaneHolder,
  deps: Pick<HxWorkDeps, "lanes" | "presence" | "stopped" | "wait" | "now">,
  action: () => Promise<DynamicToolResult>,
): Promise<DynamicToolResult> {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? sleep;
  const budget = new HxWaitBudget(undefined, now);
  const leases = new HxLeaseSet(deps.lanes, holder, budget);
  try {
    if (deps.stopped()) return waitingAnswer("stopped", "The user stopped the work on the computer.", null);
    if (holder.tier >= 3 && deps.presence.known()) {
      const needed = hxIdleNeeded(holder.tier);
      while (deps.presence.locked() || deps.presence.userIdleMs() < needed) {
        const left = budget.left();
        if (left <= 0)
          return waitingAnswer(
            "waiting_user",
            `The user is using this computer (or its screen is locked). Background work opens, closes or changes things only after the user has stopped for ${Math.round(needed / 1000)} seconds. Do other work, and try again later.`,
            null,
          );
        const started = now();
        await wait(Math.min(1_000, left));
        budget.spend(Math.max(1, now() - started));
      }
    }
    const taken = await leases.take("system");
    if (!taken.ok)
      return waitingAnswer(
        taken.why === "stopped" ? "stopped" : "busy",
        taken.why === "stopped"
          ? taken.reason
          : `${taken.reason} Do the parts of the work that do not need the computer first, then call this again.`,
        taken.etaMs,
      );
    if (deps.stopped()) return waitingAnswer("stopped", "The user stopped the work on the computer.", null);
    return await action();
  } finally {
    leases.releaseAll();
  }
}

/** Words that mean “do it now” and “drop it”, in the user's reply to a parked step. */
// The words of the chat line in each language (hx/translations_v173.py REPLY_WORDS), and the Chinese
// and English ones in every language.
const NOW_WORDS = new Set([
  "现在做",
  "現在做",
  "马上做",
  "馬上做",
  "立即做",
  "立刻做",
  "现在",
  "現在",
  "now",
  "donow",
  "doitnow",
  "الآن",
  "jetzt",
  "ahora",
  "maintenant",
  "עכשיו",
  "ora",
  "今すぐ",
  "지금",
  "nu",
  "teraz",
  "agora",
  "сейчас",
  "şimdi",
]);
const DROP_WORDS = new Set([
  "放弃",
  "放棄",
  "不做了",
  "算了",
  "drop",
  "dropit",
  "cancel",
  "giveup",
  "skip",
  "إلغاء",
  "verwerfen",
  "descartar",
  "abandonner",
  "ביטול",
  "scarta",
  "やめる",
  "취소",
  "overslaan",
  "porzuć",
  "отмена",
  "bırak",
]);

/** What a reply to a parked step says: do it now, drop it, or neither. */
export function hxParkReply(text: string): "now" | "drop" | null {
  const plain = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
  if (plain.length === 0 || plain.length > 12) return null;
  if (NOW_WORDS.has(plain)) return "now";
  if (DROP_WORDS.has(plain)) return "drop";
  return null;
}

/**
 * The user wrote to an agent. A “现在做” or “放弃” to an agent with a parked step decides it. The
 * message still reaches the agent, which runs the steps again or leaves them.
 */
export function hxUserSaid(parked: HxParkedSteps, agentId: string, text: string): "now" | "drop" | null {
  if (parked.get(agentId) === null) return null;
  const reply = hxParkReply(text);
  if (reply === "now") parked.consent(agentId);
  if (reply === "drop") parked.drop(agentId);
  return reply;
}
