/**
 * HXBot (v1.7.5, RTN-11): what the workflow steps of steps.ts reach: an agent's Computer Use calls
 * (hx-computer) and teams (hx-team). The agent service attaches it. A workflow step runs unattended, as
 * a routine does: its calls wait for a longer pause of the person at the computer.
 */

import type { DatabaseSync } from "node:sqlite";
import type { HxSaveTurnLine } from "@hxbot/contracts/hx-workflows";
import { type AgentSummary, agentComputerUseEnabled } from "@hxbot/contracts/ipc";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { hxAutoRouter } from "../hx-auto-model/router";
import { hxComputer, hxObserveComputerCalls } from "../hx-computer/computer";
import { type HxTeams, hxTeams } from "../hx-team/service";
import { HX_START_TEAM_TOOL, HX_TEAM_TOOL } from "../hx-team/tools";
import { type HxQueuedSender, hxWorkflowAutoSteps } from "./auto-model";
import { hxAttachWorkflowLimits } from "./limits";
import { type HxWorkflowStepHost, hxToJsonObject, hxWorkflowSteps } from "./steps";
import { hxTurnTools } from "./turn-tools";

/** What a start_team answer says: the new team, or why there is none. */
function answerOf(result: { contentItems: Array<{ type: string; text?: string }> }): {
  teamId: string | null;
  reason: string;
} {
  const text = result.contentItems.find((item) => item.type === "inputText")?.text ?? "";
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: the text is the reason.
  }
  const teamId =
    isDynamicRecord(parsed) && isDynamicRecord(parsed.team) && typeof parsed.team.id === "string"
      ? parsed.team.id
      : null;
  const reason =
    isDynamicRecord(parsed) && typeof parsed.reason === "string"
      ? parsed.reason
      : typeof parsed === "string"
        ? parsed
        : JSON.stringify(parsed);
  return { teamId, reason };
}

export function hxAttachWorkflowSteps(deps: {
  connection: () => DatabaseSync;
  agents: () => AgentSummary[];
  /** Writes the chat line of a turn that can be saved as a workflow. */
  writeLine: (agentId: string, line: HxSaveTurnLine) => void;
  /** A queued delivery: where it came from and its text. Null when it is gone. */
  delivery: (deliveryId: string) => { sender: HxQueuedSender; text: string } | null;
}): void {
  hxObserveComputerCalls((params, result) => hxTurnTools.computerCalled(params, result));
  hxTeams.observeStarts((call, answer) =>
    hxTurnTools.recordTeamStart(call.agentId, call.key, {
      tool: call.tool,
      arguments: hxToJsonObject(call.arguments),
      ok: answer.success,
    }),
  );
  hxTurnTools.attachLine(deps.writeLine);
  // An agent step whose model is "auto": the router chooses the model of its delivery by the work.
  hxAutoRouter.setAutoWork({
    wanted: (_agentId, deliveryId) => {
      const found = deps.delivery(deliveryId);
      return found ? hxWorkflowAutoSteps.wanted(found) : false;
    },
    done: (deliveryId) => {
      const found = deps.delivery(deliveryId);
      if (found) hxWorkflowAutoSteps.done(found);
    },
  });
  hxAttachWorkflowLimits(deps.connection);
  const agent = (agentId: string) => {
    const found = deps.agents().find((candidate) => candidate.id === agentId);
    return found ? { id: found.id, name: found.name, computerUse: agentComputerUseEnabled(found) } : null;
  };
  hxWorkflowSteps.attach({
    connection: deps.connection,
    agent,
    computer: (who, call) =>
      hxComputer.toolCall(
        { id: who.id, name: who.name, computerUse: who.computerUse, inTask: false, routine: true, threadId: null },
        { tool: call.tool, arguments: call.arguments },
      ),
    ...hxTeamStepHost(hxTeams),
  });
}

/**
 * What a team step reaches of a team service: the person made the step, and so asked for its team, so
 * a start goes through `start_team` as the person's (CONC-01 places and CONC-03 shares as any team).
 */
export function hxTeamStepHost(teams: HxTeams): Pick<HxWorkflowStepHost, "startTeam" | "team" | "stopTeam"> {
  return {
    startTeam: async ({ agentId, key, card }) => {
      const result = await teams.call({
        tool: HX_START_TEAM_TOOL,
        arguments: card,
        agentId,
        key,
        roomId: null,
        byPerson: true,
      });
      const answer = answerOf(result);
      if (result.success && answer.teamId) return { teamId: answer.teamId };
      return { error: answer.reason.slice(0, 500) };
    },
    team: (teamId) => {
      const record = teams.store.get(teamId);
      return record ? { state: record.state, result: record.result, reason: record.reason } : null;
    },
    stopTeam: async (teamId, agentId) => {
      await teams.call({
        tool: HX_TEAM_TOOL,
        arguments: { action: "stop", teamId },
        agentId,
        key: `hx-workflow-stop:${teamId}`,
        roomId: null,
        byPerson: true,
      });
    },
  };
}
