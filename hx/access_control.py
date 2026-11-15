"""按需授权（客户端访问本地电脑和网页的全面限制）：rebrand.py 的一步。

所有智能体默认「按需授权」（存储值 access=workspace）：工作区、共享文件夹、客户添加的文件夹和临时文件夹里
读写不用问；其余（工作区外的读写删、工作区内的删除、命令、网站、截图、网络搜索）都要智能体先调用
request_access 说明原因和用途、列出对象，客户勾选允许的行为（读取、写入、删除）。授权只在本次任务内有效，
任务结束、智能体 release_access 或客户按“停止”即收回。「完全访问」保留，要手动选择并二次确认。

HX 自有代码在 src/backend/hx-access/（判定规则、授权记录、卡片、拦截入口、两个工具、一次性迁移）。
这里只做上游文件里的接线。由 rebrand.py 调用 access_control(r)，r 是 rebrand 模块本身。
"""

from __future__ import annotations

import translations  # 同目录：研究版文字在其他 13 种语言里的译文


def defaults(r) -> None:
    """默认按需授权；现有智能体升级时改一次；没有沙箱的电脑也能用；按需授权不提供 Computer Use。"""
    ipc = "packages/contracts/src/ipc-agents.ts"
    r.replace(ipc,
              "/**\n"
              " * How far an agent may reach on this computer. `workspace` limits writes to the agent's workspace, the\n"
              " * shared folder and the temporary folders; `full` is the unrestricted access every agent had before the setting existed.\n"
              " */\n"
              "export const AGENT_ACCESS_MODES = [\"full\", \"workspace\"] as const;\n"
              "export type AgentAccess = (typeof AGENT_ACCESS_MODES)[number];\n"
              "export const DEFAULT_AGENT_ACCESS: AgentAccess = \"full\";\n",
              "/**\n"
              " * How far an agent may reach on this computer. `workspace` is HXBot's maximum access (最大权限):\n"
              " * everything without asking, except a few risky actions that the user confirms once or always\n"
              " * (src/backend/hx-access). `full` asks for nothing; it must be chosen by hand and confirmed twice.\n"
              " */\n"
              "export const AGENT_ACCESS_MODES = [\"full\", \"workspace\"] as const;\n"
              "export type AgentAccess = (typeof AGENT_ACCESS_MODES)[number];\n"
              "export const DEFAULT_AGENT_ACCESS: AgentAccess = \"workspace\";\n")
    r.replace(ipc,
              "export function workspaceAccessEnforced(agent: { access?: AgentAccess | undefined }): boolean {\n"
              "  return agent.access === \"workspace\";\n"
              "}\n",
              "export function workspaceAccessEnforced(agent: { access?: AgentAccess | undefined }): boolean {\n"
              "  return (agent.access ?? DEFAULT_AGENT_ACCESS) === \"workspace\";\n"
              "}\n")

    # 升级后所有智能体一次性改为最大权限；规则和操作记录存在数据文件夹里
    services = "src/main/application-services.ts"
    r.replace(services, 'import { runCauseEffect } from "../backend/effect-boundary";\n',
              'import { runCauseEffect } from "../backend/effect-boundary";\n'
              'import { setHxAccessDataFolder } from "../backend/hx-access/hub";\n'
              'import { hxMoveAgentsToOnDemand } from "../backend/hx-access/migration";\n')
    r.replace(services,
              "  await runCauseEffect(store.initialize());\n"
              "  performance.mark(\"openbot:services.store\");\n",
              "  await runCauseEffect(store.initialize());\n"
              "  // HXBot: the access rules and the activity record; every agent moves to 最大权限 once (hx-access).\n"
              "  setHxAccessDataFolder(app.getPath(\"userData\"));\n"
              "  await hxMoveAgentsToOnDemand(store, app.getPath(\"userData\"));\n"
              "  performance.mark(\"openbot:services.store\");\n")

    # 最大权限不用 Codex 和 Claude 自己的工作区沙盒：它们的每条命令、每次修改都先问 HXBot，由 HXBot 按规则回答。
    # Grok、OpenCode 等在 macOS 上的进程沙盒（confined-process）保留：它们不是每次写入都问。
    sandbox = "src/backend/agent/workspace-sandbox.ts"
    r.replace(sandbox,
              "export function codexSandboxMode(agent: SandboxedAgent): \"workspace-write\" | \"danger-full-access\" {\n"
              "  return workspaceAccessEnforced(agent) ? \"workspace-write\" : \"danger-full-access\";\n"
              "}\n",
              "export function codexSandboxMode(agent: SandboxedAgent): \"workspace-write\" | \"danger-full-access\" {\n"
              "  return workspaceAccessEnforced(agent) && !hxCodexUnsandboxed(agent) ? \"workspace-write\" : \"danger-full-access\";\n"
              "}\n")
    r.replace(sandbox,
              "export function codexSandboxPolicy(agent: SandboxedAgent, sharedRoot: string): CodexSandboxPolicy {\n"
              "  if (!workspaceAccessEnforced(agent)) return { type: \"dangerFullAccess\" };\n",
              "export function codexSandboxPolicy(agent: SandboxedAgent, sharedRoot: string): CodexSandboxPolicy {\n"
              "  if (!workspaceAccessEnforced(agent) || hxCodexUnsandboxed(agent)) return { type: \"dangerFullAccess\" };\n")
    r.replace(sandbox,
              "): { sandbox_workspace_write?: { writable_roots: string[]; network_access: boolean } } {\n"
              "  if (!workspaceAccessEnforced(agent)) return {};\n",
              "): { sandbox_workspace_write?: { writable_roots: string[]; network_access: boolean } } {\n"
              "  if (!workspaceAccessEnforced(agent) || hxCodexUnsandboxed(agent)) return {};\n")
    r.replace(sandbox,
              "type SandboxedAgent = Pick<AgentSummary, \"access\" | \"additionalFolders\" | \"provider\" | \"workspacePath\">;\n",
              "type SandboxedAgent = Pick<AgentSummary, \"access\" | \"additionalFolders\" | \"provider\" | \"workspacePath\">;\n"
              "\n"
              "/**\n"
              " * HXBot: 最大权限 runs Codex without its workspace sandbox: Codex asks HXBot before each command and\n"
              " * patch, and HXBot answers by its rules (hx-access). The sandbox would stop the new files allowed outside.\n"
              " */\n"
              "function hxCodexUnsandboxed(_agent: SandboxedAgent): boolean {\n"
              "  return true;\n"
              "}\n")
    threads = "src/backend/agent/thread-lifecycle.ts"
    r.replace(threads,
              "    if (\n"
              "      agentProviderDescriptor(client.provider).workspaceEnforcement !== \"tool-sandbox\" ||\n"
              "      !workspaceAccessEnforced(agent)\n"
              "    )\n"
              "      return {};\n",
              "    // HXBot: Claude runs without its Workspace only sandbox; HXBot's hook checks every tool call at\n"
              "    // 最大权限 (claude-client.ts, hx-access/hub.ts).\n"
              "    if (\n"
              "      agentProviderDescriptor(client.provider).workspaceEnforcement !== \"tool-sandbox\" ||\n"
              "      !workspaceAccessEnforced(agent) ||\n"
              "      client.provider === \"claude\"\n"
              "    )\n"
              "      return {};\n")
    service = "src/backend/agent-service.ts"
    r.replace(service, "      allowOutside: !workspaceAccessEnforced(agent),\n",
              "      // HXBot: at 最大权限 files anywhere may be read.\n"
              "      allowOutside: true,\n")
    r.replace(service, "    return yield* listWorkspaceDirectory(agent, inputPath, { allowOutside: !workspaceAccessEnforced(agent) }).pipe(\n",
              "    return yield* listWorkspaceDirectory(agent, inputPath, { allowOutside: true }).pipe(\n")

    # 没有沙箱的平台也能用按需授权：靠服务商的逐项询问加 HX 的判定
    r.replace("src/backend/process-confinement.ts",
              "  // bubblewrap on Linux cannot deny a protected file that does not exist yet, such as a new\n"
              "  // `opencode.json`, so Linux fails closed until it can.\n"
              "  throw new ProcessConfinementUnavailableError(sourceText(\"error.agent.workspaceOnlyMacOnly\"));\n",
              "  // HXBot: on-demand access is the default on every computer. Where macOS's sandbox is not\n"
              "  // there, the process runs as it is, and the provider's approvals and HXBot's grants hold it\n"
              "  // (src/backend/hx-access). Without the sandbox a provider tool that asks for nothing is not held.\n"
              "  return target;\n")
    service = "src/backend/agent-service.ts"
    r.replace(service, 'import { canConfineProcesses } from "./process-confinement";\n', "")
    r.replace(service,
              "/** Whether Workspace only cannot run on `provider` here: its own process needs a sandbox that this computer lacks. */\n"
              "function workspaceOnlyUnavailable(provider: AgentProvider): boolean {\n"
              "  return agentProviderDescriptor(provider).workspaceEnforcement === \"confined-process\" && !canConfineProcesses();\n"
              "}\n",
              "/**\n"
              " * Whether Workspace only cannot run on `provider` here. HXBot: on-demand access runs on\n"
              " * every computer; where the sandbox is not there, the grants hold the agent (process-confinement.ts).\n"
              " */\n"
              "function workspaceOnlyUnavailable(_provider: AgentProvider): boolean {\n"
              "  return false;\n"
              "}\n")
    # Claude 的沙箱只有 macOS 一定有；其他电脑上由 HX 的钩子逐条判定命令
    r.replace("src/backend/claude-workspace-sandbox.ts",
              "    enabled: true,\n"
              "    failIfUnavailable: true,\n",
              "    enabled: true,\n"
              "    // HXBot: on-demand access is the default, and only macOS always has this sandbox. Elsewhere\n"
              "    // Claude runs commands without it, and HXBot's hook checks each one (hx-access/hub.ts).\n"
              "    failIfUnavailable: process.platform === \"darwin\",\n")


def wiring(r) -> None:
    """判定接到各个入口：服务商审批、Claude 工具钩子、ACP、OpenCode、Codex、内置浏览器、截图、搜索、附件。"""
    # ---------------------------------------------------------------- 两个工具
    tools = "src/backend/openbot-tools.ts"
    r.replace(tools, 'import { CHANNEL_TOOL_DEFINITIONS } from "./channel-tools";\n',
              'import { CHANNEL_TOOL_DEFINITIONS } from "./channel-tools";\n'
              'import { HX_ACCESS_TOOL_DEFINITIONS } from "./hx-access/tools";\n')
    r.replace(tools, "  ...MCP_SERVER_TOOL_DEFINITIONS,\n",
              "  ...MCP_SERVER_TOOL_DEFINITIONS,\n  ...HX_ACCESS_TOOL_DEFINITIONS,\n")
    r.replace("src/backend/agent/tool-catalog.ts", '  "request_api_key",\n',
              '  "request_api_key",\n  "request_access",\n  "release_access",\n')

    # ---------------------------------------------------------------- 工具路由
    router = "src/backend/agent/openbot-tool-router.ts"
    r.replace(router, 'import type { ProviderSession } from "../database/provider-sessions";\n',
              'import type { ProviderSession } from "../database/provider-sessions";\n'
              'import { hxBrowserToolRefusal, hxOpenBotToolRefusal } from "../hx-access/hub";\n'
              'import { HX_ACCESS_TOOL_NAMES } from "../hx-access/tools";\n')
    r.replace(router,
              "            const agentId = this.#conversation.agentForThread(toolRequest.params.threadId);\n"
              "            if (!agentId) throw new Error(\"The browsing HXBot agent is unknown.\");\n",
              "            const agentId = this.#conversation.agentForThread(toolRequest.params.threadId);\n"
              "            if (!agentId) throw new Error(\"The browsing HXBot agent is unknown.\");\n"
              "            // HXBot: at on-demand access each website needs the user's grant (hx-access/hub.ts).\n"
              "            const hxRefusal = hxBrowserToolRefusal(\n"
              "              agentId,\n"
              "              toolRequest.params,\n"
              "              (tabId) => this.#browser.agentTab(tabId, agentId)?.url ?? null,\n"
              "            );\n"
              "            if (hxRefusal) {\n"
              "              client.respond(toolRequest.id, hxRefusal);\n"
              "              return;\n"
              "            }\n")
    r.replace(router,
              "          if (toolRequest.params.namespace === \"openbot\") {\n"
              "            if (toolRequest.params.tool === \"ask_user\") {\n",
              "          if (toolRequest.params.namespace === \"openbot\") {\n"
              "            // HXBot: the access card of on-demand access, and the gate of the tools that reach\n"
              "            // the screen, the web or files outside the workspace (hx-access).\n"
              "            if (HX_ACCESS_TOOL_NAMES.has(toolRequest.params.tool)) {\n"
              "              this.#attention.surfaceAccessRequest(client, toolRequest);\n"
              "              return;\n"
              "            }\n"
              "            const hxRefusal = hxOpenBotToolRefusal(\n"
              "              this.#conversation.agentForThread(toolRequest.params.threadId),\n"
              "              toolRequest.params,\n"
              "            );\n"
              "            if (hxRefusal) {\n"
              "              client.respond(toolRequest.id, hxRefusal);\n"
              "              return;\n"
              "            }\n"
              "            if (toolRequest.params.tool === \"ask_user\") {\n")

    # ---------------------------------------------------------------- 卡片、所有者、审批、收回
    registry = "src/backend/agent/attention-registry.ts"
    r.replace(registry, 'import { causeHelpers } from "../effect-boundary";\n',
              'import { causeHelpers } from "../effect-boundary";\n'
              'import { hxAccessGrants } from "../hx-access/grants";\n'
              'import { hxAccessApproval } from "../hx-access/hub";\n'
              "import {\n"
              "  HX_ACCESS_OWNER_ONLY,\n"
              "  type HxAccessPending,\n"
              "  hxAccessAnswer,\n"
              "  hxAccessMayAnswer,\n"
              "  hxAccessToolCall,\n"
              '} from "../hx-access/tools";\n')
    r.replace(registry,
              "  autoAnswer?: { state: UiBlockAutoAnswer; timer: ReturnType<typeof setTimeout> };\n"
              "}\n",
              "  autoAnswer?: { state: UiBlockAutoAnswer; timer: ReturnType<typeof setTimeout> };\n"
              "  /** HXBot: an access card (request_access). Its answer makes the grant; only the owner grants. */\n"
              "  access?: HxAccessPending;\n"
              "}\n")
    r.replace(registry,
              "  /** The server owner or an admin. Only they may take a privileged UI block action. */\n"
              "  privileged: boolean;\n",
              "  /** The server owner or an admin. Only they may take a privileged UI block action. */\n"
              "  privileged: boolean;\n"
              "  /** HXBot: the server owner. Only they may grant access in an access card. */\n"
              "  owner?: boolean;\n")
    r.replace(registry,
              "          requiresOpenBot: pending.questions.some(localQuestionNeedsOpenBot),\n",
              "          // HXBot: a local script must not answer an access card.\n"
              "          requiresOpenBot: pending.access !== undefined || pending.questions.some(localQuestionNeedsOpenBot),\n")
    r.replace(registry,
              "      if (!pending || pending.questions.some(localQuestionNeedsOpenBot)) {\n",
              "      if (!pending || pending.access !== undefined || pending.questions.some(localQuestionNeedsOpenBot)) {\n")
    r.replace(registry,
              "      if (!pending) throw new InactiveAttentionRequest(sourceText(\"error.backend.promptInactive\"));\n"
              "      const questionIds = new Set(pending.questions.map((question) => question.id));\n",
              "      if (!pending) throw new InactiveAttentionRequest(sourceText(\"error.backend.promptInactive\"));\n"
              "      // HXBot: anyone may refuse an access card, only the owner may grant it.\n"
              "      if (pending.access && !hxAccessMayAnswer(pending.access, input.answers, responder))\n"
              "        throw new ForbiddenAttentionAnswer(HX_ACCESS_OWNER_ONLY);\n"
              "      const questionIds = new Set(pending.questions.map((question) => question.id));\n")
    r.replace(registry,
              "      pending.client.respond(pending.id, result);\n"
              "      this.#prompts.delete(input.requestId);\n",
              "      pending.client.respond(pending.id, pending.access ? hxAccessAnswer(pending.access, input.answers) : result);\n"
              "      this.#prompts.delete(input.requestId);\n")
    r.replace(registry,
              "  surfaceDynamicPrompt(client: AgentClient, request: AppServerRequest): void {\n",
              "  /**\n"
              "   * HXBot: request_access shows an access card, and release_access gives grants back\n"
              "   * (hx-access/tools.ts). A messaging chat gets no card: people other than the owner write there.\n"
              "   */\n"
              "  surfaceAccessRequest(client: AgentClient, request: AppServerRequest): void {\n"
              "    const threadId = getString(request.params, \"threadId\");\n"
              "    const turnId = getString(request.params, \"turnId\");\n"
              "    const agentId = threadId ? this.#conversation.agentForThread(threadId) : undefined;\n"
              "    const publicThreadId = threadId && agentId ? this.#conversation.publicThreadId(agentId, threadId) : null;\n"
              "    if (!threadId || !turnId || !agentId || !publicThreadId) {\n"
              "      client.respond(request.id, {\n"
              "        success: false,\n"
              "        contentItems: [{ type: \"inputText\", text: \"HXBot could not create an access request.\" }],\n"
              "      });\n"
              "      return;\n"
              "    }\n"
              "    const tool = getString(request.params, \"tool\") ?? \"\";\n"
              "    const call = hxAccessToolCall(tool, getRecord(request.params, \"arguments\"), agentId, threadId, turnId);\n"
              "    if (\"result\" in call) {\n"
              "      client.respond(request.id, call.result);\n"
              "      return;\n"
              "    }\n"
              "    if (this.#messagingThread(publicThreadId) || this.#messagingRequestTurn(agentId, turnId)) {\n"
              "      client.respond(request.id, {\n"
              "        success: false,\n"
              "        contentItems: [{ type: \"inputText\", text: MESSAGING_QUESTION_REFUSED }],\n"
              "      });\n"
              "      return;\n"
              "    }\n"
              "    const questions = [call.question];\n"
              "    const messageId = this.#persistQuestionPrompt(agentId, publicThreadId, turnId, request.id, questions);\n"
              "    this.#prompts.set(request.id, {\n"
              "      client,\n"
              "      id: request.id,\n"
              "      responseKind: \"dynamic-tool\",\n"
              "      params: request.params,\n"
              "      agentId,\n"
              "      publicThreadId,\n"
              "      turnId,\n"
              "      messageId,\n"
              "      questions,\n"
              "      access: call.access,\n"
              "    });\n"
              "    this.#routines.markNeedsAttention(turnId);\n"
              "    this.#emit({ type: \"prompt\", requestId: request.id, agentId, threadId: publicThreadId, turnId, questions });\n"
              "  }\n"
              "\n"
              "  surfaceDynamicPrompt(client: AgentClient, request: AppServerRequest): void {\n")
    r.replace(registry,
              "  surfaceApproval(client: AgentClient, request: AppServerRequest, kind: AgentApprovalKind): void {\n",
              "  /** HXBot: at on-demand access the grants answer a provider approval (hx-access/hub.ts). */\n"
              "  #hxAccessAnswer(\n"
              "    client: AgentClient,\n"
              "    request: AppServerRequest,\n"
              "    agentId: string,\n"
              "    threadId: string,\n"
              "    kind: AgentApprovalKind,\n"
              "  ): boolean {\n"
              "    const answer = hxAccessApproval(request.params, kind, agentId, threadId);\n"
              "    if (!answer) return false;\n"
              "    const rejection = answer.decision === \"decline\" ? answer.message : \"\";\n"
              "    client.respond(request.id, approvalReply(request.method, request.params, answer.decision, rejection));\n"
              "    return true;\n"
              "  }\n"
              "\n"
              "  surfaceApproval(client: AgentClient, request: AppServerRequest, kind: AgentApprovalKind): void {\n")
    r.replace(registry,
              "      permissions: kind === \"permissions\" ? approvalPermissions(request.params) : null,\n"
              "    };\n"
              "    if (this.#answerWithoutAsking(client, request, approval)) return;\n",
              "      permissions: kind === \"permissions\" ? approvalPermissions(request.params) : null,\n"
              "    };\n"
              "    if (this.#answerWithoutAsking(client, request, approval)) return;\n"
              "    if (this.#hxAccessAnswer(client, request, agentId, threadId, kind)) return;\n")
    r.replace(registry,
              "      permissions: null,\n"
              "    };\n"
              "    if (this.#answerWithoutAsking(client, request, approval)) return;\n",
              "      permissions: null,\n"
              "    };\n"
              "    if (this.#answerWithoutAsking(client, request, approval)) return;\n"
              "    if (this.#hxAccessAnswer(client, request, agentId, threadId, kind)) return;\n")
    r.replace(registry,
              "  clearForTurn(threadId: string, turnId: string): void {\n",
              "  clearForTurn(threadId: string, turnId: string): void {\n"
              "    // HXBot: the task is over, so its grants end.\n"
              "    hxAccessGrants.releaseTurn(threadId, turnId);\n")
    # Team API：只有所有者能在授权卡片上授权
    r.replace("src/main/team-api/route-agents.ts",
              '        { ...(sender ? { sender } : {}), privileged: member.role !== "member" },\n',
              '        { ...(sender ? { sender } : {}), privileged: member.role !== "member", owner: member.role === "owner" },\n')

    # ---------------------------------------------------------------- 智能体服务：谁是按需授权
    service = "src/backend/agent-service.ts"
    r.replace(service, 'import type { HostMemory } from "./host-memory";\n',
              'import type { HostMemory } from "./host-memory";\n'
              'import { hxAccessHostFor, setHxAccessHost } from "./hx-access/hub";\n')
    r.replace(service,
              "      apiKeys: options.agentApiKeys ?? null,\n"
              "    });\n"
              "    this.#duplication = new DuplicationGate({\n",
              "      apiKeys: options.agentApiKeys ?? null,\n"
              "    });\n"
              "    // HXBot: the agents at on-demand access (按需授权) and their roots, for the gates.\n"
              "    setHxAccessHost(hxAccessHostFor(store, (threadId) => this.#conversation.agentForThread(threadId)));\n"
              "    this.#duplication = new DuplicationGate({\n")

    # ---------------------------------------------------------------- 回合：开始时收回旧授权，记录 Codex 的文件改动
    turns = "src/backend/agent/turn-lifecycle.ts"
    r.replace(turns, 'import { causeHelpers, reportOriginalFailure } from "../effect-boundary";\n',
              'import { causeHelpers, reportOriginalFailure } from "../effect-boundary";\n'
              'import { hxRecordItem, hxReleaseEarlierTurns } from "../hx-access/hub";\n')
    r.replace(turns,
              "        if (!turnId) return;\n"
              "        if (this.#compaction.claimTurn(agentId, threadId, turnId)) return;\n",
              "        if (!turnId) return;\n"
              "        // HXBot: a new task starts with no grant of an earlier one.\n"
              "        hxReleaseEarlierTurns(agentId, threadId, turnId);\n"
              "        if (this.#compaction.claimTurn(agentId, threadId, turnId)) return;\n")
    r.replace(turns,
              "        if (!turnId || !item) return;\n"
              "        this.fileHistory.record(",
              "        if (!turnId || !item) return;\n"
              "        // HXBot: a Codex file change approval names only the item; its paths come from here.\n"
              "        hxRecordItem(item);\n"
              "        this.fileHistory.record(")

    # ---------------------------------------------------------------- Codex：按需授权时每条命令和补丁都问，由授权回答
    threads = "src/backend/agent/thread-lifecycle.ts"
    r.replace(threads, 'import { type HomeSkill, listHomeSkills, skillFolderNames } from "../home-skills";\n',
              'import { type HomeSkill, listHomeSkills, skillFolderNames } from "../home-skills";\n'
              'import { hxApprovalPolicy } from "../hx-access/hub";\n')
    r.replace(threads, '      approvalPolicy: "on-request",\n', "      approvalPolicy: hxApprovalPolicy(agent),\n", count=2)
    drain = "src/backend/agent/drain-scheduler.ts"
    r.replace(drain, 'import { causeHelpers } from "../effect-boundary";\n',
              'import { causeHelpers } from "../effect-boundary";\n'
              'import { hxApprovalPolicy } from "../hx-access/hub";\n')
    r.replace(drain, '                approvalPolicy: "on-request",\n', "                approvalPolicy: hxApprovalPolicy(agent),\n")

    # ---------------------------------------------------------------- Claude：每个工具都经过钩子判定
    claude = "src/backend/claude-client.ts"
    r.replace(claude, 'import { skillFolderNames } from "./home-skills";\n',
              'import { skillFolderNames } from "./home-skills";\n'
              'import { hxClaudeAccessHooks } from "./hx-access/hub";\n')
    r.replace(claude,
              "                hooks: claudeWorkspaceHooks(config.cwd, config.additionalDirectories, config.excludedFolders),\n",
              "                // HXBot: on-demand access checks every tool call against the grants.\n"
              "                hooks: hxClaudeAccessHooks(\n"
              "                  claudeWorkspaceHooks(config.cwd, config.additionalDirectories, config.excludedFolders),\n"
              "                  config.agentId,\n"
              "                  threadId,\n"
              "                  config.cwd,\n"
              "                ),\n")
    r.replace(claude,
              "          ...(plugins.length ? { plugins } : {}),\n"
              "          mcpServers,\n",
              "          // HXBot: at 最大权限 every tool call goes past HXBot's rules (hx-access/hub.ts).\n"
              "          ...(config.workspaceOnly ? {} : { hooks: hxClaudeAccessHooks({}, config.agentId, threadId, config.cwd) }),\n"
              "          ...(plugins.length ? { plugins } : {}),\n"
              "          mcpServers,\n")
    r.replace(claude,
              "        itemId: toolUseId,\n"
              "        reason: sourceText(\"status.agent.claudeWriteOutside\", { path }),\n",
              "        itemId: toolUseId,\n"
              "        hxPaths: [path],\n"
              "        reason: sourceText(\"status.agent.claudeWriteOutside\", { path }),\n")

    # ---------------------------------------------------------------- ACP：审批里带上路径、网址和命令
    acp = "src/backend/acp-client.ts"
    r.replace(acp, 'import { IdleThreadPool } from "./idle-thread-pool";\n',
              'import { hxAcpPermissionHints } from "./hx-access/hub";\n'
              'import { IdleThreadPool } from "./idle-thread-pool";\n')
    r.replace(acp,
              "          permissions: requestedPermissions,\n"
              "        },\n"
              "        turn?.stop.signal,\n",
              "          permissions: requestedPermissions,\n"
              "          // HXBot: what the tool touches, for the grants of on-demand access.\n"
              "          ...hxAcpPermissionHints(params.toolCall),\n"
              "        },\n"
              "        turn?.stop.signal,\n")
    # OpenCode：按需授权时什么都先问
    drivers = "src/backend/provider-drivers.ts"
    r.replace(drivers, 'import { hermesSettingsEnvironment } from "./hermes-settings";\n',
              'import { hermesSettingsEnvironment } from "./hermes-settings";\n'
              'import { hxOpenCodeOnDemand } from "./hx-access/hub";\n')
    r.replace(drivers,
              "            ...openCodeConfigEnv(OPENCODE_AGENT_CONFIG, openCodeEndpoints(context), context.apiKey(\"opencode\")),\n"
              "            ...(confinement ? OPENCODE_CONFINED_ENV : {}),\n",
              "            // HXBot: at on-demand access OpenCode asks for every tool, and the grants answer.\n"
              "            ...openCodeConfigEnv(\n"
              "              confinement ? hxOpenCodeOnDemand(OPENCODE_AGENT_CONFIG) : OPENCODE_AGENT_CONFIG,\n"
              "              openCodeEndpoints(context),\n"
              "              context.apiKey(\"opencode\"),\n"
              "            ),\n"
              "            ...(confinement ? OPENCODE_CONFINED_ENV : {}),\n")

    # ---------------------------------------------------------------- 发给模型的说明；卡片的语言
    instructions = "src/backend/agent/developer-instructions.ts"
    r.replace(instructions, 'import type { HomeSkill } from "../home-skills";\n',
              'import type { HomeSkill } from "../home-skills";\n'
              'import { hxOnDemandInstruction } from "../hx-access/hub";\n')
    on_demand = "    workspaceAccessEnforced(agent)\n      ? hxOnDemandInstruction(folders.length > 0)\n"
    if not r.regex(instructions,
                   r"    workspaceAccessEnforced\(agent\)\n      \? `The user limited you to Workspace only\.[\s\S]*?\n        \}\.`\n",
                   on_demand) and on_demand not in r.read(instructions):
        r.errors.append(f"{instructions}: the Workspace only instruction was not found")
    language = "src/main/language-service.ts"
    r.replace(language, 'import { Effect, Semaphore } from "effect";\n',
              'import { Effect, Semaphore } from "effect";\n'
              'import { setHxAccessLocale } from "../backend/hx-access/card";\n')
    r.replace(language,
              "    this.#systemLocale = input.systemLocale;\n"
              "    this.#translate = translateFor(this.locale);\n",
              "    this.#systemLocale = input.systemLocale;\n"
              "    this.#translate = translateFor(this.locale);\n"
              "    // HXBot: the access cards are written in the app's language.\n"
              "    setHxAccessLocale(this.locale);\n")
    r.replace(language,
              "    this.#preference = preference;\n"
              "    this.#translate = translateFor(this.locale);\n",
              "    this.#preference = preference;\n"
              "    this.#translate = translateFor(this.locale);\n"
              "    setHxAccessLocale(this.locale);\n")




# ---------------------------------------------------------------- 界面文字

LABELS = {
    "en": "Maximum access", "zh": "最大权限", "ar": "أقصى صلاحية", "de": "Maximaler Zugriff",
    "es": "Acceso máximo", "fr": "Accès maximal", "he": "גישה מרבית", "it": "Accesso massimo",
    "ja": "最大権限", "ko": "최대 권한", "nl": "Maximale toegang", "pl": "Maksymalny dostęp",
    "pt": "Acesso máximo", "ru": "Максимальный доступ", "tr": "Azami erişim",
}
LABEL_KEYS = {
    "agentSettings.ts": "agentSettings.access.workspace",
    "agent.ts": "agent.access.workspaceOnly",
    "mobile/agent.ts": "mobile.agent.access.workspace",
}

# 说明文字改了意思：英文原文和中文；其他 13 种语言的译文在 hx/translations.py（由最后的步骤写入）。
NOTES_EN = {
    "agentSettings.ts": {
        "agentSettings.runtime.workspaceNote":
            "Maximum access: the agent reads files anywhere, works freely in its workspace, the shared folder and the "
            "temporary folders, creates new files anywhere, and runs commands, uses websites, screenshots, web search and "
            "Computer Use without asking. It asks you first to change a file that is already there outside those folders, "
            "delete outside them, touch where keys and logins are kept, run a command as administrator or pay with a "
            "card. It signs in with passwords saved in the Vault without asking. You allow once, always, or refuse (a "
            "payment: once, each time); see Settings → Access & activity.",
        "agentSettings.runtime.workspaceEnforcedCommand": "Codex asks HXBot before each command and file change.",
        "agentSettings.runtime.workspaceEnforcedClaude": "HXBot checks each Claude tool call.",
        "agentSettings.runtime.workspaceUnlimited":
            "HXBot cannot see what Computer Use types or clicks, so the agent asks in the chat before it types a password "
            "or pays.",
        "agentSettings.runtime.workspaceEnforcedProcess":
            "On macOS the whole {provider} process runs in a sandbox, so it cannot write outside these folders, not even "
            "new files. What it asks for is checked by HXBot.",
    },
    "mobile/agent.ts": {
        "mobile.agent.access.workspaceNote":
            "The agent does almost everything without asking. It asks you first to change or delete files outside its "
            "folders, run a command as administrator or pay. It signs in with passwords saved in the Vault without "
            "asking.",
    },
}
NOTES_ZH = {
    "agentSettings.ts": {
        "agentSettings.runtime.workspaceNote":
            "最大权限：助手可以读取任何位置的文件，在自己的工作区、共享文件夹和临时文件夹里随意读写删，在任何位置新建文件，"
            "运行命令，使用网站、截图、网络搜索和电脑操控，都不用问。下面几件事要先问你：修改上述文件夹以外已有的文件，"
            "删除上述文件夹以外的内容，读写存放密钥和登录凭证的位置，以管理员身份运行命令，用银行卡付款。用保密箱里保存的"
            "密码登录不用问。你可以允许一次、始终允许或拒绝（付款每次都问，只能允许一次），见“设置 → 授权与记录”。",
        "agentSettings.runtime.workspaceEnforcedCommand": "Codex 的每条命令和每次文件修改都先问 HXBot。",
        "agentSettings.runtime.workspaceEnforcedClaude": "Claude 的每个工具调用都由 HXBot 判定。",
        "agentSettings.runtime.workspaceUnlimited":
            "HXBot 看不到电脑操控（Computer Use）输入和点击了什么，所以助手要输入密码或付款前会先在对话里问你。",
        "agentSettings.runtime.workspaceEnforcedProcess":
            "在 macOS 上，整个 {provider} 进程运行在沙盒中，上述文件夹以外不能写入，新建文件也不行；它提出的请求由 HXBot 判定。",
    },
    "mobile/agent.ts": {
        "mobile.agent.access.workspaceNote":
            "助手几乎什么都不用问。修改或删除它文件夹以外的文件、以管理员身份运行命令、付款前会先问你；用保密箱里保存的"
            "密码登录不用问。",
    },
}
# 新增文字
NEW_EN = {
    "agentSettings.ts": {
        "agentSettings.hxFullAgain.title": "Confirm again: turn on full access?",
        "agentSettings.hxFullAgain.description":
            "With full access the agent no longer asks before anything, not even before it changes or deletes your "
            "files, runs a command as administrator or pays. Turn it on only for an "
            "agent and a task you trust, and switch back to maximum access when the task is done.",
        "agentSettings.hxFullAgain.confirm": "Turn on full access",
    },
    "mobile/agent.ts": {
        "mobile.agent.access.hxFullAgainTitle": "Confirm again: turn on full access?",
        "mobile.agent.access.hxFullAgainBody":
            "With full access the agent no longer asks before anything, not even before it deletes your files or "
            "pays. Switch back to maximum access when the task is done.",
        "mobile.agent.access.hxFullAgainConfirm": "Turn on full access",
    },
    "mobile/chat.ts": {"mobile.chat.question.hxConfirmChoice": "Confirm"},
}
NEW_ZH = {
    "agentSettings.ts": {
        "agentSettings.hxFullAgain.title": "再次确认：开启完全访问？",
        "agentSettings.hxFullAgain.description":
            "开启完全访问后，助手做任何事都不再先问你，包括修改、删除你的文件，以管理员身份运行命令和付款。"
            "请只对你信任的助手和任务开启，任务完成后改回最大权限。",
        "agentSettings.hxFullAgain.confirm": "开启完全访问",
    },
    "mobile/agent.ts": {
        "mobile.agent.access.hxFullAgainTitle": "再次确认：开启完全访问？",
        "mobile.agent.access.hxFullAgainBody":
            "开启完全访问后，助手做任何事都不再先问你，包括删除你的文件和付款。任务完成后请改回最大权限。",
        "mobile.agent.access.hxFullAgainConfirm": "开启完全访问",
    },
    "mobile/chat.ts": {"mobile.chat.question.hxConfirmChoice": "确定"},
}
# 错误提示里的名称
ERROR_NAMES = {
    "en": ("Workspace only", "Maximum access"),
    "zh": ("“仅工作区”", "“最大权限”"),
}

MESSAGES = "packages/i18n/src/messages"
CLOSING = {"en": "\n});\n", "zh": "\n} as const satisfies"}


def message_line(key: str, value: str, width) -> str:
    """一条文字在文件里的写法，与 Biome 的格式一致：显示宽度超过 120 时值另起一行。"""
    import json
    name, quoted = json.dumps(key, ensure_ascii=False), json.dumps(value, ensure_ascii=False)
    one = f"  {name}: {quoted},"
    return f"{one}\n" if width(one) <= 120 else f"  {name}:\n    {quoted},\n"


def message_pattern(key: str) -> str:
    import re
    return r"  " + re.escape(f'"{key}"') + r':(?: |\n    )"(?:[^"\\\n]|\\.)*",\n'


def set_message(r, path: str, key: str, value: str) -> None:
    """把已有的一条文字改成 value（只限单行字符串）；已经是 value 就跳过。"""
    import re
    text = r.read(path)
    line = message_line(key, value, r.display_width)
    if line in text:
        return
    found = re.search(message_pattern(key), text)
    if not found:
        r.errors.append(f"{path}: message not found: {key}")
        return
    r.write(path, text[:found.start()] + line + text[found.end():])


def drop_message(r, path: str, key: str) -> None:
    """删去一条已过时的译文，让它暂用英文；已删去就跳过。"""
    import re
    text = r.read(path)
    found = re.search(message_pattern(key), text)
    if found:
        r.write(path, text[:found.start()] + text[found.end():])


def interface(r) -> None:
    """「仅工作区」改名「最大权限」；完全访问二次确认；手机上的提问卡片可以多选。"""
    for locale, label in LABELS.items():
        for file, key in LABEL_KEYS.items():
            set_message(r, f"{MESSAGES}/{locale}/{file}", key, label)
    for file, entries in NOTES_EN.items():
        for key, value in entries.items():
            set_message(r, f"{MESSAGES}/en/{file}", key, value)
    for file, entries in NOTES_ZH.items():
        for key, value in entries.items():
            set_message(r, f"{MESSAGES}/zh/{file}", key, value)
    for locale in r.OTHER_LOCALES:
        for file, entries in NOTES_EN.items():
            for key in entries:
                if not translations.has(key, locale):  # 有译文时由最后的步骤写入（hx/translations.py）
                    drop_message(r, f"{MESSAGES}/{locale}/{file}", key)
    for file, entries in NEW_EN.items():
        r.add_messages(f"{MESSAGES}/en/{file}", CLOSING["en"], entries)
    for file, entries in NEW_ZH.items():
        r.add_messages(f"{MESSAGES}/zh/{file}", CLOSING["zh"], entries)
    gaps = [key for entries in [*NOTES_EN.values(), *NEW_EN.values()] for key in entries]
    r.untranslated(add={key: r.OTHER_LOCALES for key in gaps}, translated_zh=[])
    for locale, (old, new) in ERROR_NAMES.items():
        for file in ("error/agent.ts", "error/provider.ts"):
            path = f"{MESSAGES}/{locale}/{file}"
            text = r.read(path)
            if old in text:
                r.write(path, text.replace(old, new))

    # ---- 桌面和网页：完全访问二次确认
    panel = "packages/ui/src/features/conversation/AgentSettingsPanel.tsx"
    r.replace(panel,
              "  /** Leaving the workspace warns about reach; reaching Full access warns that the agent stops asking. */\n",
              "  /**\n"
              "   * HXBot: Full access is confirmed twice. After the first confirmation this holds the id of\n"
              "   * the agent that the second one is for, so it cannot fall to another agent.\n"
              "   */\n"
              "  const [hxFullAgain, setHxFullAgain] = createSignal<string | null>(null);\n"
              "\n"
              "  /** Leaving the workspace warns about reach; reaching Full access warns that the agent stops asking. */\n")
    r.replace(panel,
              "          onConfirm={() => {\n"
              "            const next = draft.confirmingPermission;\n"
              "            setDraft((state) => {\n"
              "              state.confirmingPermission = null;\n"
              "            });\n"
              "            if (next) void savePermission(next);\n"
              "          }}\n"
              "        />\n",
              "          onConfirm={() => {\n"
              "            const next = draft.confirmingPermission;\n"
              "            setDraft((state) => {\n"
              "              state.confirmingPermission = null;\n"
              "            });\n"
              "            if (next === \"full\") setHxFullAgain(props.agent.id);\n"
              "            else if (next) void savePermission(next);\n"
              "          }}\n"
              "        />\n"
              "        <ConfirmDialog\n"
              "          open={hxFullAgain() === props.agent.id}\n"
              "          tone=\"default\"\n"
              "          initialFocus=\"cancel\"\n"
              "          title={t(\"agentSettings.hxFullAgain.title\")}\n"
              "          description={t(\"agentSettings.hxFullAgain.description\")}\n"
              "          cancelLabel={t(\"common.cancel\")}\n"
              "          confirmLabel={t(\"agentSettings.hxFullAgain.confirm\")}\n"
              "          onCancel={() => setHxFullAgain(null)}\n"
              "          onConfirm={() => {\n"
              "            const confirmed = hxFullAgain() === props.agent.id;\n"
              "            setHxFullAgain(null);\n"
              "            if (confirmed) void savePermission(\"full\");\n"
              "          }}\n"
              "        />\n")


    # ---- 手机：完全访问二次确认；提问卡片多选
    fields = "apps/mobile/src/features/agents/components/agent-access-fields.tsx"
    r.replace(fields, 'import { useQueryScope } from "@/features/auth/context/mobile-session-context";\n',
              'import { hxConfirmFullAccessAgain } from "@/features/agents/components/hx-full-access-confirm";\n'
              'import { useQueryScope } from "@/features/auth/context/mobile-session-context";\n')
    r.replace(fields,
              "          style: \"destructive\",\n"
              "          onPress: () => void save(level),\n",
              "          style: \"destructive\",\n"
              "          // HXBot: Full access is confirmed twice.\n"
              "          onPress: () => (ask ? void save(level) : hxConfirmFullAccessAgain(t, () => void save(level))),\n")
    prompt = "apps/mobile/src/features/chat/components/chat-question-prompt.tsx"
    r.replace(prompt, 'import { ChatVaultRequest } from "@/features/chat/components/chat-vault-request";\n',
              'import { ChatVaultRequest } from "@/features/chat/components/chat-vault-request";\n'
              'import { HxMultiSelectOptions } from "@/features/chat/components/hx-multi-select-options";\n')
    r.replace(prompt,
              "      <View>\n"
              "        {question.options?.map((option, optionIndex) => (\n",
              "      <View>\n"
              "        {/* HXBot: a question with more than one answer, such as an access card, ticks and confirms. */}\n"
              "        {question.multiSelect ? <HxMultiSelectOptions question={question} disabled={disabled} answer={answer} /> : null}\n"
              "        {(question.multiSelect ? undefined : question.options)?.map((option, optionIndex) => (\n")


def access_control(r) -> None:
    defaults(r)
    wiring(r)
    interface(r)
