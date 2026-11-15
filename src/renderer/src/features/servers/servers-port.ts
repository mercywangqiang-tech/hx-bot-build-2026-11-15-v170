import type { HxBotDesktopApi, ServerSummary } from "@hxbot/contracts/ipc";

/**
 * What the servers domain reaches in main: the server list and selection, the account changes, the local host, the
 * settings of one server, the name, logo and update of a joined server's host, the servers that
 * run on this computer, and the remote desktop setup of a server.
 */
export interface ServersPort {
  agent: Pick<
    HxBotDesktopApi["agent"],
    | "getStatus"
    | "listAgents"
    | "listConversationReads"
    | "listHiddenAgents"
    | "listMcpServers"
    | "listModels"
    | "removeMcpServer"
    | "saveMcpServer"
    | "setMcpServerEnabled"
    | "testMcpServer"
    | "signInMcpServer"
    | "mcpSignInPage"
    | "mcpSignInRelay"
    | "openMcpSignInRelay"
    | "completeMcpSignInRelay"
    | "cancelMcpSignIn"
    | "signOutMcpServer"
    | "listMcpSignIns"
    | "mcpSignInApp"
    | "saveMcpSignInApp"
    | "removeMcpSignInApp"
  >;
  events: HxBotDesktopApi["events"];
  auth: Pick<HxBotDesktopApi["auth"], "onEvent">;
  browser: Pick<HxBotDesktopApi["browser"], "setVisible">;
  hostAdmin: Pick<HxBotDesktopApi["hostAdmin"], "cancelUpdate" | "getUpdateStatus" | "startUpdate" | "updateIdentity">;
  hostedServers: Pick<HxBotDesktopApi["hostedServers"], "list" | "restart" | "wake">;
  localServers: HxBotDesktopApi["localServers"];
  host: Pick<
    HxBotDesktopApi["host"],
    | "configure"
    | "getRemoteControlPolicy"
    | "getStatus"
    | "onEvent"
    | "recheckScreenRecording"
    | "rotateIdentityKey"
    | "setRemoteControlPolicy"
    | "start"
    | "stop"
    | "stopRemoteControl"
    | "updateIdentity"
  >;
  notifications: Pick<HxBotDesktopApi["notifications"], "onOpened">;
  remoteDesktop: Pick<
    HxBotDesktopApi["remoteDesktop"],
    "checkSetup" | "connect" | "disconnect" | "list" | "openSetup" | "test"
  >;
  servers: Pick<
    HxBotDesktopApi["servers"],
    | "getPresenceFor"
    | "join"
    | "list"
    | "onEvent"
    | "onPresence"
    | "refreshIdentity"
    | "remove"
    | "reorder"
    | "retryConnection"
    | "select"
    | "setMuted"
    | "setNotificationLevel"
  >;
}

/** Read on each call: tests and stories replace `window.hxbot` per case. */
export function serversPort(): ServersPort {
  return window.hxbot;
}

/**
 * The member and invite calls for one server. This computer answers them for the local server
 * through `host`; a remote server answers them through `servers`, addressed by its id.
 */
export type ServerAdminPort = Pick<
  HxBotDesktopApi["host"],
  "getPresence" | "listMembers" | "listInvites" | "createInvite" | "updateMember" | "removeMember" | "revokeInvite"
>;

export function serverAdminPort(server: Pick<ServerSummary, "id" | "kind">): ServerAdminPort {
  if (server.kind === "local") return window.hxbot.host;
  const serverId = server.id;
  return {
    getPresence: () => window.hxbot.servers.getPresenceFor(serverId),
    listMembers: () => window.hxbot.servers.listMembers(serverId),
    listInvites: () => window.hxbot.servers.listInvites(serverId),
    createInvite: (input) => window.hxbot.servers.createInvite(input, serverId),
    updateMember: (input) => window.hxbot.servers.updateMember(input, serverId),
    removeMember: (memberId) => window.hxbot.servers.removeMember(memberId, serverId),
    revokeInvite: (inviteId) => window.hxbot.servers.revokeInvite(inviteId, serverId),
  };
}

/** The server main marks active. A test teardown can remove the bridge while a join is pending. */
export async function activeServerId(): Promise<string> {
  if (!window.hxbot) return "local";
  return (await window.hxbot.servers.list()).find((item) => item.active)?.id ?? "local";
}
