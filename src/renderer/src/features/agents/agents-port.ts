import type { HxBotDesktopApi } from "@hxbot/contracts/ipc";

/**
 * What the agents domain reaches in main: agent records, their models and read state, and the agent
 * event stream.
 */
export interface AgentsPort {
  agent: Pick<
    HxBotDesktopApi["agent"],
    | "createAgent"
    | "deleteAgent"
    | "holdAgentDelete"
    | "releaseAgentDelete"
    | "duplicateAgent"
    | "getAgentAdminSettings"
    | "getAgentHostSettings"
    | "updateAgentHostSettings"
    | "getAgentBackupModels"
    | "updateAgentBackupModels"
    | "getAgentTaskLimit"
    | "updateAgentTaskLimit"
    | "getAgentNewChat"
    | "updateAgentNewChat"
    | "getAgentPlanCard"
    | "updateAgentPlanCard"
    | "getAgentFastMode"
    | "updateAgentFastMode"
    | "listAgents"
    | "listConversationReads"
    | "listModels"
    | "onEvent"
    | "getRuntimeSnapshot"
    | "setAgentHidden"
    | "setAvatar"
    | "updateAgent"
    | "updateAgentAdminSettings"
  >;
  /** The accounts of a joined server's providers, which its released agent routes do not carry. */
  providerAdmin: Pick<HxBotDesktopApi["providerAdmin"], "accounts" | "accountUsage">;
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function agentsPort(): AgentsPort {
  return window.hxbot;
}
