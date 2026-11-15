import type { DeleteSharedTableInput, HxBotDesktopApi, SharedTable } from "@hxbot/contracts/ipc";

/**
 * What the conversation domain reaches in main: agent and direct message pages, sends, reads,
 * shared tables, and the browser seams a view takes when no runtime is injected.
 */
export interface ConversationPort {
  agent: Pick<
    HxBotDesktopApi["agent"],
    | "readAgentSessionSettings"
    | "listAgentNotificationLevels"
    | "askSideQuestion"
    | "setAgentSessionSetting"
    | "resetAgentSessionSetting"
    | "onScopedEvent"
    | "deleteConversationMessage"
    | "deleteTable"
    | "listMemories"
    | "listRoutines"
    | "listTables"
    | "markConversationRead"
    | "markConversationUnread"
    | "readConversationPage"
    | "releaseFilePreview"
    | "searchConversationMessages"
    | "sendMessage"
  >;
  browser: Pick<
    HxBotDesktopApi["browser"],
    | "capturePreview"
    | "finishLocalSignIn"
    | "onLiveViewEvent"
    | "openLocalSignIn"
    | "sendLiveViewInput"
    | "startLiveView"
    | "stopLiveView"
  >;
  servers: Pick<
    HxBotDesktopApi["servers"],
    | "listDirectThreads"
    | "markDirectRead"
    | "onDirectMessage"
    | "onDirectTyping"
    | "readDirectConversationPage"
    | "sendDirectMessage"
    | "setDirectTyping"
  >;
  storage: Pick<HxBotDesktopApi["storage"], "openLocation">;
  /** The reader's level for each agent of a joined server, which decides what Delete offers. */
  hostAdmin: Pick<HxBotDesktopApi["hostAdmin"], "getAgentAccess">;
  browserDock: Pick<HxBotDesktopApi["browserDock"], "publishPresentation" | "onAction" | "onShown">;
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function conversationPort(): ConversationPort {
  return window.hxbot;
}

/** Cleanup can run after IPC shuts down; process shutdown also frees these in-memory pages. */
export function releaseFilePreviewPage(pageUrl: string | undefined): void {
  if (!pageUrl) return;
  void conversationPort()
    .agent.releaseFilePreview(pageUrl)
    .catch(() => undefined);
}

/** The tables every agent shares. The web client reaches them on the host through the Team API. */
export interface SharedTableCalls {
  listTables(): Promise<SharedTable[]>;
  deleteTable(input: DeleteSharedTableInput): Promise<void>;
}
