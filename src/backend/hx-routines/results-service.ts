/**
 * HXBot (v1.7.5, RTN-04): judges each routine run when its turn ends (see result.ts), records the result
 * in `hx_run_detail`, and tells the person about a run whose result could not be verified: a line in the
 * agent's chat and a desktop notification. A run with no update sends nothing.
 */

import type { DatabaseSync } from "node:sqlite";
import type { ConversationMessage, QueueDelivery, RoutineRun } from "@hxbot/contracts/ipc";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { sourceText } from "@hxbot/i18n/source";
import { hxWriteRunDetail } from "./detail";
import { type HxRunJudgement, hxJudgeRun } from "./result";

interface HxResultsHost {
  connection(): DatabaseSync;
  runForDelivery(deliveryId: string): RoutineRun | null;
  workspaceOf(agentId: string): string | null;
  /** A line in the agent's chat. */
  appendLine(agentId: string, text: string): void;
  /** A desktop notification, when the person allows them. */
  notify(agentId: string, title: string, body: string): void;
}

interface HxTurnResultInput {
  agentId: string;
  turnId: string;
  outcome: string;
  reportedFailure: string | undefined;
  noUpdate: boolean;
  answer: string | undefined;
  messages: readonly ConversationMessage[];
  deliveries: readonly Pick<QueueDelivery, "id" | "sender">[];
}

function unknownActions(db: DatabaseSync, runId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM hx_external_actions WHERE scope = ? AND status IN ('started', 'unknown')")
    .get(`routine-run:${runId}`);
  return isDynamicRecord(row) && typeof row.count === "number" ? row.count : 0;
}

/** One line for the person: the first reason, in a template each screen translates. */
function unverifiedText(name: string, judgement: HxRunJudgement): string {
  switch (judgement.reasons[0]) {
    case "missing-file":
      return sourceText("status.agent.hxRoutineResult.missingFile", {
        name,
        files: judgement.missing.slice(0, 3).join(", "),
      });
    case "file-not-read-back":
      return sourceText("status.agent.hxRoutineResult.notReadBack", { name });
    case "action-unknown":
      return sourceText("status.agent.hxRoutineResult.actionUnknown", { name });
    default:
      return sourceText("status.agent.hxRoutineResult.noToolStep", { name });
  }
}

class HxRoutineResults {
  #host: HxResultsHost | null = null;

  attach(host: HxResultsHost): void {
    this.#host = host;
  }

  detach(): void {
    this.#host = null;
  }

  /** Never throws: the result is HXBot's own record and must not fail the turn. */
  judgeTurn(input: HxTurnResultInput): Map<string, HxRunJudgement> {
    const results = new Map<string, HxRunJudgement>();
    const host = this.#host;
    if (!host) return results;
    try {
      const db = host.connection();
      const messages = input.messages.filter((message) => message.turnId === input.turnId);
      for (const delivery of input.deliveries) {
        if (delivery.sender.kind !== "routine") continue;
        const run = host.runForDelivery(delivery.id);
        if (!run) continue;
        const judgement = hxJudgeRun({
          outcome: input.outcome,
          reportedFailure: input.reportedFailure,
          noUpdate: input.noUpdate,
          answer: input.answer,
          turnMessages: messages,
          instruction: run.instruction,
          workspace: host.workspaceOf(input.agentId),
          unknownActions: unknownActions(db, run.id),
        });
        results.set(run.id, judgement);
        const at = new Date().toISOString();
        hxWriteRunDetail(db, "agent", run.id, run.routineId, (detail) => ({
          ...detail,
          result: { kind: judgement.kind, at, reasons: judgement.reasons },
        }));
        if (judgement.kind === "unverified") {
          const body = unverifiedText(run.routineName, judgement);
          host.appendLine(input.agentId, body);
          host.notify(input.agentId, sourceText("status.agent.hxRoutineResult.unverifiedTitle"), body);
        }
      }
    } catch {
      // The run keeps its status; its HXBot result is missing, which the list shows as not judged.
    }
    return results;
  }
}

export const hxRoutineResults = new HxRoutineResults();
