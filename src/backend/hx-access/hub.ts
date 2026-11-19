// HXBot：最大权限在各处的判定入口。智能体服务告诉这里谁是最大权限（存为 access "workspace"）、它的工作区在哪；
// 审批、Claude 的工具钩子、内置浏览器和截图等工具在动手前来这里问一次，判定的结果记进操作记录。
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { HookCallbackMatcher, Options } from "@anthropic-ai/claude-agent-sdk";
import { type AgentSummary, workspaceAccessEnforced } from "@hxbot/contracts/ipc";
import { workspaceTemporaryPaths, workspaceWritableRoots } from "../agent/workspace-sandbox";
import type { DynamicToolCallParams } from "../protocol";
import { type DynamicToolResult, getArray, getRecord, getString, isRecord } from "../protocol";
import { hxAccessGrants } from "./grants";
import {
  type AccessContext,
  type AccessCover,
  type AccessDecision,
  type AccessOperation,
  commandOperations,
  decideAccess,
  hxProtectedRoots,
  insideWorkspaceRoots,
} from "./policy";
import { type HxAccessLogEntry, hxAccessStore } from "./rules";

export interface HxAccessAgent {
  id: string;
  name: string;
  /** True at 最大权限 (stored access "workspace"): the few risky actions need a confirmation. */
  onDemand: boolean;
  /** The workspace, the shared folder and the folders the user added. */
  roots: string[];
  workspacePath: string;
}

interface HxAccessHost {
  agent: (agentId: string) => HxAccessAgent | null;
  agentForThread: (threadId: string) => string | undefined;
}

let host: HxAccessHost | null = null;
/** HXBot's own data folder: its Vault and settings are kept there, so it is guarded like a key folder. */
let dataFolder: string | null = null;

/** The agent service sets this once. Before it does, nothing is gated. */
export function setHxAccessHost(next: HxAccessHost): void {
  host = next;
}

/** The app's data folder: the rules and the activity record are kept there, and it is guarded. */
export function setHxAccessDataFolder(folder: string): void {
  dataFolder = folder;
  hxAccessStore.open(folder);
}

/** HXBot's data folder once the app has set it; 电脑操控 keeps its catalog in a folder of its own inside (hx-computer). */
export function hxAppDataFolder(): string | null {
  return dataFolder;
}

function protectedRoots(): string[] {
  return hxProtectedRoots(homedir(), dataFolder ? [dataFolder] : []);
}

export function hxAccessAgent(agentId: string): HxAccessAgent | null {
  return host?.agent(agentId) ?? null;
}

/**
 * The host for the agent service: an agent is at 最大权限 when its stored access is "workspace". Its
 * roots are the workspace, the shared folder, the folders the user added and the temporary folders.
 */
export function hxAccessHostFor(
  store: { list(): readonly AgentSummary[]; readonly sharedRoot: string },
  agentForThread: (threadId: string) => string | undefined,
): HxAccessHost {
  return {
    agent: (agentId) => {
      const agent = store.list().find((candidate) => candidate.id === agentId);
      if (!agent) return null;
      return {
        id: agent.id,
        name: agent.name,
        onDemand: workspaceAccessEnforced(agent),
        roots: [...workspaceWritableRoots(agent, store.sharedRoot), ...workspaceTemporaryPaths()],
        workspacePath: agent.workspacePath,
      };
    },
    agentForThread,
  };
}

/** Codex asks for every command and patch of an agent at 最大权限, and HXBot answers (`hxAccessApproval`). */
export function hxApprovalPolicy(agent: Pick<AgentSummary, "access">): "untrusted" | "on-request" {
  return workspaceAccessEnforced(agent) ? "untrusted" : "on-request";
}

/**
 * The decision for an agent's thread, or null when the agent is not at 最大权限 and nothing is gated.
 * The grants are those of the thread's running task and the rules for every agent. A confirmation
 * given once is used up by the operation it allows. Every decision that matters goes to the record.
 */
export function hxAccessDecide(
  agentId: string,
  threadId: string,
  operations: readonly AccessOperation[],
): AccessDecision | null {
  const agent = hxAccessAgent(agentId);
  if (!agent?.onDemand) return null;
  if (operations.length === 0) return { allowed: true, used: [], covers: [] };
  const context: AccessContext = {
    roots: agent.roots,
    grants: [...hxAccessGrants.forThread(agentId, threadId), ...hxAccessStore.ruleGrants()],
    protectedRoots: protectedRoots(),
  };
  const decision = decideAccess(context, operations);
  const unrecorded = recordDecision(agent, context, operations, decision);
  // v1.7.2 (AUD-07): a step that a confirmation or a rule allows goes ahead only when its line is in the
  // record. Otherwise it is held as if nobody had allowed it, and the confirmation is not used up.
  if (decision.allowed && unrecorded.length > 0)
    return {
      allowed: false,
      missing: unrecorded.map((index) => operations[index]).filter((operation) => operation !== undefined),
      covers: decision.covers.map((cover, index) => (unrecorded.includes(index) ? null : cover)),
    };
  if (decision.allowed) hxAccessGrants.consume(decision.used);
  return decision;
}

/** The line of the activity record for an operation, or null for plain work in the workspace. */
function recordLine(
  context: AccessContext,
  operation: AccessOperation,
): Pick<HxAccessLogEntry, "kind" | "detail"> | null {
  switch (operation.kind) {
    case "path":
      if (operation.action !== "delete" && insideWorkspaceRoots(context, operation.path)) return null;
      return { kind: operation.action, detail: operation.path };
    case "command":
      return { kind: "command", detail: operation.command };
    case "site":
      return null;
    case "screen":
      return { kind: "screen", detail: "" };
    case "search":
      return { kind: "search", detail: "" };
    case "password":
      return { kind: "password", detail: operation.site };
    case "payment":
      return { kind: "payment", detail: operation.site };
    case "vault":
      return { kind: "vault", detail: operation.item };
  }
}

function outcomeOf(cover: AccessCover, allowed: boolean): HxAccessLogEntry["outcome"] | null {
  if (cover === null) return "held";
  if (!allowed) return null;
  if (cover === "free") return "auto";
  return cover.grantId.startsWith("rule-") ? "always" : "once";
}

/** Writes the decision to the record; the indexes of the allowed-by-permission lines that did not go in. */
function recordDecision(
  agent: HxAccessAgent,
  context: AccessContext,
  operations: readonly AccessOperation[],
  decision: AccessDecision,
): number[] {
  const unrecorded: number[] = [];
  operations.forEach((operation, index) => {
    const outcome = outcomeOf(decision.covers[index] ?? null, decision.allowed);
    const line = outcome ? recordLine(context, operation) : null;
    if (!outcome || !line) return;
    const written = hxAccessStore.record({ agent: agent.name, outcome, ...line });
    if (!written && (outcome === "once" || outcome === "always")) unrecorded.push(index);
  });
  return unrecorded;
}

/** An operation in words, for the agent. */
function describe(operation: AccessOperation): string {
  switch (operation.kind) {
    case "path":
      return `${operation.action === "read" ? "read" : operation.action === "write" ? "change" : "delete"} ${operation.path}`;
    case "command":
      return `run the command ${operation.command}${operation.elevates ? " (as administrator)" : ""}${operation.deletes ? " (it deletes or writes where HXBot cannot tell)" : ""}`;
    case "password":
      return `sign in to ${operation.site} with a saved password`;
    case "payment":
      return `fill in a card on ${operation.site}`;
    case "vault":
      return `delete the Vault item ${operation.item}`;
    case "site":
      return `use the website ${operation.url}`;
    case "screen":
      return "see the screen";
    case "search":
      return "search the web";
  }
}

/** What the agent is told when an action needs the user's confirmation that it does not have. */
function hxAccessRefusal(missing: readonly AccessOperation[]): string {
  const items = missing.slice(0, 5).map(describe);
  return [
    "最大权限: this needs the user's confirmation first.",
    `It needs: ${items.join("; ")}.`,
    "Call hxbot.request_access with the reason, the purpose, the exact targets and the actions, and wait for the user's answer; then do it again. A confirmation given once covers each target once.",
  ].join(" ");
}

// ---------------------------------------------------------------- what an approval request does

/** The file changes of Codex fileChange items, by item id, for the approvals that name only the item. */
const fileChanges = new Map<string, { path: string; kind: string }[]>();
const MAX_ITEMS = 500;

/** A turn starts: the grants of the thread's earlier turns end, also those whose end was missed. */
export function hxReleaseEarlierTurns(agentId: string, threadId: string, turnId: string): void {
  hxAccessGrants.releaseOtherTurns(agentId, threadId, turnId);
}

/** Remembers the paths of a fileChange item, from the provider's item notification. */
export function hxRecordItem(item: unknown): void {
  if (!isRecord(item) || item.type !== "fileChange") return;
  const id = getString(item, "id");
  if (!id) return;
  const changes = getArray(item, "changes").flatMap((change) => {
    if (!isRecord(change)) return [];
    const path = getString(change, "path");
    if (!path) return [];
    const kind = getString(change, "kind") ?? getString(getRecord(change, "kind"), "type") ?? "update";
    const movePath =
      getString(getRecord(change, "kind"), "move_path") ?? getString(getRecord(change, "kind"), "movePath");
    return movePath
      ? [
          { path, kind: "delete" },
          { path: movePath, kind: "add" },
        ]
      : [{ path, kind }];
  });
  fileChanges.set(id, changes);
  if (fileChanges.size > MAX_ITEMS) {
    const oldest = fileChanges.keys().next().value;
    if (oldest !== undefined) fileChanges.delete(oldest);
  }
}

function absolute(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/**
 * The operations of a provider approval request: a command, a file change or a permission request.
 * Null when HXBot cannot tell which files a change touches; the user then decides on the usual card.
 */
export function hxApprovalOperations(
  params: unknown,
  kind: "command" | "file-change" | "permissions",
  agent: HxAccessAgent,
): AccessOperation[] | null {
  const cwd = getString(params, "cwd") ?? getString(params, "hxCwd") ?? agent.workspacePath;
  // Paths that HXBot's own provider clients add to their requests (ACP locations, Claude writes).
  const hxPaths = getArray(params, "hxPaths").filter((path): path is string => typeof path === "string");
  const hxAction = getString(params, "hxAction");
  if (kind === "command") {
    // A command that HXBot cannot read runs, as commands do at 最大权限.
    if (isRecord(params) && params.hxUnknown === true) return [];
    const command = getString(params, "hxCommand") ?? commandOf(params);
    if (!command) return null;
    return commandOperations(command, cwd);
  }
  if (kind === "file-change") {
    if (hxPaths.length > 0) {
      const action = hxAction === "delete" ? "delete" : "write";
      return hxPaths.map((path) => ({ kind: "path", action, path: absolute(path, cwd) }));
    }
    const itemId = getString(params, "itemId");
    const changes = itemId ? fileChanges.get(itemId) : undefined;
    if (!changes || changes.length === 0) return null;
    return changes.map((change) => ({
      kind: "path",
      action: change.kind === "delete" ? "delete" : "write",
      path: absolute(change.path, cwd),
    }));
  }
  // A permission request: an ACP read, fetch or search, or a Codex request for more access.
  if (hxAction === "read" && hxPaths.length > 0)
    return hxPaths.map((path) => ({ kind: "path", action: "read", path: absolute(path, cwd) }));
  if (hxAction === "fetch") {
    const url = getString(params, "hxUrl");
    return url ? [{ kind: "site", action: "read", url }] : null;
  }
  if (hxAction === "search") return [{ kind: "search" }];
  // Any other permission, such as the network or more folders for a sandbox: free at 最大权限.
  return [];
}

function commandOf(params: unknown): string | null {
  if (!isRecord(params)) return null;
  return commandText(params.command);
}

/** A command as one line: an argument list is quoted part by part, so a shell wrapper keeps its inner command whole. */
function commandText(command: unknown): string | null {
  if (typeof command === "string") return command;
  if (Array.isArray(command) && command.length > 0 && command.every((part) => typeof part === "string")) {
    return command
      .map((part) => (/^[A-Za-z0-9_./=:@%+-]+$/u.test(part) ? part : `'${part.replaceAll("'", "'\\''")}'`))
      .join(" ");
  }
  return null;
}

// ---------------------------------------------------------------- Claude's tools

/** The operations of a Claude tool call, or an empty list for a tool that touches nothing gated. */
export function hxClaudeToolOperations(toolName: string, input: unknown, cwd: string): AccessOperation[] {
  const path = (key: string) => {
    const value = getString(input, key);
    return value ? absolute(value, cwd) : null;
  };
  switch (toolName) {
    case "Read":
    case "NotebookRead": {
      const file = path("file_path") ?? path("notebook_path");
      return file ? [{ kind: "path", action: "read", path: file }] : [];
    }
    case "Glob":
    case "Grep":
    case "LS":
      return [{ kind: "path", action: "read", path: path("path") ?? cwd }];
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": {
      const file = path("file_path") ?? path("notebook_path");
      return file ? [{ kind: "path", action: "write", path: file }] : [];
    }
    case "Bash": {
      const command = getString(input, "command");
      return command ? commandOperations(command, cwd) : [];
    }
    case "WebFetch": {
      const url = getString(input, "url");
      return url ? [{ kind: "site", action: "read", url }] : [];
    }
    case "WebSearch":
      return [{ kind: "search" }];
    default:
      return [];
  }
}

// ---------------------------------------------------------------- HXBot's own tools

/**
 * The operations of a built-in browser tool that need a confirmation at 最大权限: filling in a card
 * (fill_card, every time) and the files that upload_files sends from the computer. Websites are free,
 * and so are signing in with a saved Vault password and deleting a Vault item (v1.6.8, the user on
 * 2026-11-14: only a payment asks). `tabUrl` gives the address of the agent's own tab.
 */
export function hxBrowserOperations(
  tool: string,
  args: unknown,
  tabUrl: (tabId: string) => string | null,
): AccessOperation[] {
  const tabId = getString(args, "tabId");
  const current = (tabId ? tabUrl(tabId) : null) ?? "";
  switch (tool) {
    case "fill_card":
      return [{ kind: "payment", site: current }];
    case "upload_files": {
      const cwd = process.cwd();
      return getArray(args, "paths")
        .filter((file): file is string => typeof file === "string")
        .map((file) => ({ kind: "path", action: "read", path: absolute(file, cwd) }));
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------- the gates

export type HxApprovalAnswer = { decision: "accept" } | { decision: "decline"; message: string };

/**
 * HXBot's own answer to a provider approval of an agent at 最大权限: accept what the rules and the
 * confirmations allow, decline the rest with the reason. Null when the agent is not at 最大权限 or the
 * request cannot be read; the user then decides on the usual card.
 */
export function hxAccessApproval(
  params: unknown,
  kind: "command" | "file-change" | "permissions",
  agentId: string,
  threadId: string,
): HxApprovalAnswer | null {
  const agent = hxAccessAgent(agentId);
  if (!agent?.onDemand) return null;
  const operations = hxApprovalOperations(params, kind, agent);
  if (!operations) return null;
  const decision = hxAccessDecide(agentId, threadId, operations);
  if (!decision) return null;
  return decision.allowed
    ? { decision: "accept" }
    : { decision: "decline", message: hxAccessRefusal(decision.missing) };
}

function refusalResult(text: string): DynamicToolResult {
  return { success: false, contentItems: [{ type: "inputText", text }] };
}

/** A failed tool result when an agent at 最大权限 lacks a confirmation that a call needs, or null to go on. */
export function hxAccessToolRefusal(
  agentId: string,
  threadId: string,
  operations: readonly AccessOperation[],
): DynamicToolResult | null {
  const agent = hxAccessAgent(agentId);
  if (!agent?.onDemand) return null;
  const decision = hxAccessDecide(agentId, threadId, operations);
  if (!decision || decision.allowed) return null;
  return refusalResult(hxAccessRefusal(decision.missing));
}

/** The operations of an HXBot tool in the hxbot namespace, or an empty list when it needs none. */
export function hxHxBotToolOperations(tool: string, args: unknown, agent: HxAccessAgent | null): AccessOperation[] {
  switch (tool) {
    case "capture_screen":
    case "list_capture_sources":
      return [{ kind: "screen" }];
    case "web_search":
      return [{ kind: "search" }];
    case "attach_files_to_response": {
      const cwd = agent?.workspacePath ?? process.cwd();
      return getArray(args, "paths")
        .filter((path): path is string => typeof path === "string")
        .map((path) => ({ kind: "path", action: "read", path: absolute(path, cwd) }));
    }
    default:
      return [];
  }
}

/**
 * The hook that holds a Claude agent at 最大权限 to HXBot's rules: every tool call is checked, also one
 * that an allow rule of the user's Claude settings matches. It adds to the workspace hooks.
 */
export function hxClaudeAccessHooks(
  hooks: NonNullable<Options["hooks"]>,
  agentId: string | null | undefined,
  threadId: string,
  cwd: string,
): NonNullable<Options["hooks"]> {
  if (!agentId) return hooks;
  const matcher: HookCallbackMatcher = {
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "PreToolUse") return {};
        const decision = hxAccessDecide(
          agentId,
          threadId,
          hxClaudeToolOperations(input.tool_name, input.tool_input, cwd),
        );
        if (!decision || decision.allowed) return {};
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: hxAccessRefusal(decision.missing),
          },
        };
      },
    ],
  };
  return { ...hooks, PreToolUse: [...(hooks.PreToolUse ?? []), matcher] };
}

/**
 * What an ACP permission request touches, for `hxApprovalOperations`: the paths of its locations and
 * the kind of its tool. A search with no location says nothing that can be checked.
 */
/** The hints HXBot's own provider clients add to an approval request. */
export interface HxApprovalHints {
  hxPaths?: string[];
  hxAction?: "read" | "write" | "delete" | "fetch" | "search";
  hxUrl?: string;
  hxCommand?: string;
  hxCwd?: string;
  hxUnknown?: true;
}

export function hxAcpPermissionHints(toolCall: unknown): HxApprovalHints {
  const kind = getString(toolCall, "kind");
  const paths = getArray(toolCall, "locations")
    .map((location) => getString(location, "path"))
    .filter((path): path is string => typeof path === "string" && path.length > 0);
  const rawInput = getRecord(toolCall, "rawInput");
  switch (kind) {
    case "execute": {
      const command = commandText(rawInput?.command) ?? commandText(rawInput?.cmd);
      const cwd = getString(rawInput, "cwd") ?? getString(rawInput, "workdir");
      return command ? { hxCommand: command, ...(cwd ? { hxCwd: cwd } : {}) } : { hxUnknown: true };
    }
    case "read":
    case "search":
      return paths.length > 0 ? { hxPaths: paths, hxAction: "read" } : {};
    case "edit":
      return paths.length > 0 ? { hxPaths: paths, hxAction: "write" } : {};
    case "delete":
    case "move":
      return paths.length > 0 ? { hxPaths: paths, hxAction: "delete" } : {};
    case "fetch": {
      const url = getString(rawInput, "url") ?? getString(rawInput, "uri");
      return url ? { hxAction: "fetch", hxUrl: url } : {};
    }
    default:
      return {};
  }
}

// ---------------------------------------------------------------- the router and the providers

/** The router's gate for a built-in browser tool of an agent. Null lets the call go on. */
export function hxBrowserToolRefusal(
  agentId: string,
  params: DynamicToolCallParams,
  tabUrl: (tabId: string) => string | null,
): DynamicToolResult | null {
  return hxAccessToolRefusal(agentId, params.threadId, hxBrowserOperations(params.tool, params.arguments, tabUrl));
}

/** The router's gate for an HXBot tool: screen capture, web search and attachments. Null lets it go on. */
export function hxHxBotToolRefusal(
  agentId: string | undefined,
  params: DynamicToolCallParams,
): DynamicToolResult | null {
  if (!agentId) return null;
  const agent = hxAccessAgent(agentId);
  return hxAccessToolRefusal(agentId, params.threadId, hxHxBotToolOperations(params.tool, params.arguments, agent));
}

/**
 * OpenCode asks for every tool of an agent at 最大权限, and HXBot answers. Its own rules that leave
 * tools out stay after the catch-all, because the last rule that matches wins.
 */
export function hxOpenCodeOnDemand<
  T extends { readonly permission?: Readonly<Record<string, "allow" | "ask" | "deny">> },
>(config: T): T {
  return {
    ...config,
    permission: {
      "*": "ask",
      question: "deny",
      opencode_list_mcp_resources: "deny",
      opencode_read_mcp_resource: "deny",
      ...config.permission,
    },
  };
}

/** What an agent at 最大权限 is told about its access, in place of the Workspace only note. */
export function hxOnDemandInstruction(hasFolders: boolean): string {
  return [
    `The user set you to maximum access (最大权限). Without asking you may read files anywhere; create, change and delete in your working directory, the shared directory, ${hasFolders ? "the folders the user gave you, " : ""}and the temporary directories; create new files anywhere; run commands; use websites, screenshots, web search and Computer Use.`,
    "First call hxbot.request_access (reason, purpose, exact targets, actions) and wait before: changing an existing file or deleting outside those folders, reading or writing where keys and logins are kept (~/.ssh, keychains, browser profiles), sudo, a delete HXBot cannot tell, filling in a card (give the merchant and total). The user allows once, always, or refuses; when refused, do not look for another way.",
    "Ask in the chat before you send email or messages, publish, pay or accept terms for the user, or type a password with Computer Use. Never ask for a password or a key in the chat: use the Vault tools.",
  ].join(" ");
}
