"""HXBot v1.7.4 应用技能（一）的对话部分（#54）：空间满时问你三选一，改了文件的卡片和“恢复到修改前”。

需求规格说明书 V2.2：BAK-03（修改已有文件前自动保留版本，空间不足不静默丢弃）、ART-05（差异）、CU-07。

HX 自己的代码：
- src/backend/hx-skills/ask.ts：HXBot 自己在工具调用中途问的问题（答案 HXBot 读，不发给服务商）
- src/backend/hx-skills/space-question.ts：“版本空间满了”的提问卡，15 种语言

这一步改上游文件，只做接线：
1. 提问（attention-registry.ts）：hxAsk 把 HXBot 自己的问题做成一张普通的提问卡（这台电脑、网页、手机都能答）。
   答案交给 HXBot，不发给服务商；会改用户数据的选项只有主人能选（团队成员、聊天软件里的人、本机脚本只能取消）；
   卡片因停止、到时间、服务商断开而关掉时，答案是“没有”，修改取消。access_control.py 插进来的文字原样不动，
   只在它前后加。
2. 工具分发（hxbot-tool-router.ts）：computer_skill 调用带上这一问（改在 hx/computer_control.py 那一步里）。
"""

from __future__ import annotations

import brand_rename

REGISTRY = "src/backend/agent/attention-registry.ts"

REGISTRY_IMPORTS = [
    'import { HX_ASK_OWNER_ONLY, type HxAskAnswers, type HxAskPending } from "../hx-skills/ask";',
]

REGISTRY_PAIRS = [
    # 1. 提问卡记下“这是 HXBot 自己的问题”（放在 saving 之后：access_control.py 加的 access 连着 autoAnswer 和 “}”）
    ("  saving?: boolean;\n",
     "  saving?: boolean;\n"
     "  /** HXBot (v1.7.4, BAK-03): a question of HXBot itself (hxAsk). HXBot reads its answer; the provider gets nothing. */\n"
     "  hxAsk?: HxAskPending;\n"),
    # 2. 回答：HXBot 自己的问题由 HXBot 读，不发给服务商
    ('        throw new Error(sourceText("error.backend.promptAnswerMismatch"));\n'
     "      }\n"
     "      // A refused UI block answer leaves the block open for an answer that fits.\n",
     '        throw new Error(sourceText("error.backend.promptAnswerMismatch"));\n'
     "      }\n"
     "      // HXBot (v1.7.4, BAK-03): HXBot's own question. Only the owner may give an answer that changes the\n"
     "      // user's data; anyone may cancel. The answer goes to HXBot, and the provider's request goes on.\n"
     "      const hxAsk = pending.hxAsk;\n"
     "      if (hxAsk) {\n"
     "        if (responder !== undefined && responder.owner !== true && hxAsk.ownerOnly(input.answers))\n"
     "          throw new ForbiddenAttentionAnswer(HX_ASK_OWNER_ONLY);\n"
     "        this.#routines.markRunningForTurn(pending.turnId);\n"
     "        this.#prompts.delete(input.requestId);\n"
     '        this.#emitInputResolved("prompt", input.requestId, pending.agentId);\n'
     "        try {\n"
     "          this.#resolvePersistedPrompt(pending, promptResolution(pending.questions, input.answers));\n"
     "        } catch (error) {\n"
     '          this.#emitError("prompt_persistence_failed", error, pending.agentId);\n'
     "        }\n"
     "        this.#emitRuntimeSnapshot();\n"
     "        hxAsk.reply(input.answers);\n"
     "        return;\n"
     "      }\n"
     "      // A refused UI block answer leaves the block open for an answer that fits.\n"),
    # 3. 本机脚本：可以取消 HXBot 自己的问题，不能替主人选
    ("      return yield* this.respondToPrompt({ requestId: pending.id, answers: input.answers });\n"
     "    }\n"
     "    const pending = [...this.#approvals.values()].find(\n",
     "      // HXBot (v1.7.4): a local script may cancel HXBot's own question, not choose for the owner.\n"
     "      if (pending.hxAsk)\n"
     "        return yield* this.respondToPrompt(\n"
     "          { requestId: pending.id, answers: input.answers },\n"
     "          { privileged: false, owner: false },\n"
     "        );\n"
     "      return yield* this.respondToPrompt({ requestId: pending.id, answers: input.answers });\n"
     "    }\n"
     "    const pending = [...this.#approvals.values()].find(\n"),
    # 4. 卡片关掉（停止、到时间、服务商断开）：HXBot 的问题得到“没有回答”，不给服务商发东西
    ('    this.#emitInputResolved("prompt", requestId, pending.agentId);\n'
     "    if (pending.client.running) {\n",
     '    this.#emitInputResolved("prompt", requestId, pending.agentId);\n'
     "    // HXBot (v1.7.4, BAK-03): HXBot's own question closes with no answer; the provider never asked it.\n"
     "    if (pending.hxAsk) pending.hxAsk.reply(null);\n"
     "    else if (pending.client.running) {\n"),
    # 5. hxAsk 本身（放在 clearPrompts 之前）
    ("  /** Expires the prompts of one lost provider client, or of all clients when none is given. */\n",
     "  /**\n"
     "   * HXBot (v1.7.4, BAK-03): a question of HXBot itself in the middle of a tool call of the turn, such\n"
     "   * as \"the space for versions is full\". It is a question card like any other, so the person answers\n"
     "   * it on this computer, on the web or on a phone. HXBot reads the answer; the provider never sees\n"
     "   * this question. Null when nobody can answer here (a chat app thread), or when the card closes with\n"
     "   * no answer: a stop or the deadline (`signal`), a lost provider, a message that ended the turn.\n"
     "   */\n"
     "  hxAsk(\n"
     "    client: AgentClient,\n"
     "    request: AppServerRequest,\n"
     "    questions: AgentPromptQuestion[],\n"
     "    ownerOnly: (answers: HxAskAnswers) => boolean,\n"
     "    signal: AbortSignal,\n"
     "  ): Promise<HxAskAnswers | null> {\n"
     '    const threadId = getString(request.params, "threadId");\n'
     '    const turnId = getString(request.params, "turnId");\n'
     "    const agentId = threadId ? this.#conversation.agentForThread(threadId) : undefined;\n"
     "    const publicThreadId = threadId && agentId ? this.#conversation.publicThreadId(agentId, threadId) : null;\n"
     "    if (!threadId || !turnId || !agentId || !publicThreadId || signal.aborted) return Promise.resolve(null);\n"
     "    if (!validPromptQuestions(questions)) return Promise.resolve(null);\n"
     "    if (this.#messagingThread(publicThreadId) || this.#messagingRequestTurn(agentId, turnId)) {\n"
     "      return Promise.resolve(null);\n"
     "    }\n"
     "    const id = `hx-ask-${randomUUID()}`;\n"
     "    return new Promise((resolve) => {\n"
     "      let messageId: string;\n"
     "      try {\n"
     "        messageId = this.#persistQuestionPrompt(agentId, publicThreadId, turnId, id, questions);\n"
     "      } catch (error) {\n"
     '        this.#emitError("prompt_persistence_failed", error, agentId);\n'
     "        resolve(null);\n"
     "        return;\n"
     "      }\n"
     "      this.#prompts.set(id, {\n"
     "        client,\n"
     "        id,\n"
     '        responseKind: "dynamic-tool",\n'
     "        params: request.params,\n"
     "        agentId,\n"
     "        publicThreadId,\n"
     "        turnId,\n"
     "        messageId,\n"
     "        questions,\n"
     "        hxAsk: { reply: resolve, ownerOnly },\n"
     "      });\n"
     "      this.#routines.markNeedsAttention(turnId);\n"
     '      this.#emit({ type: "prompt", requestId: id, agentId, threadId: publicThreadId, turnId, questions });\n'
     "      signal.addEventListener(\n"
     '        "abort",\n'
     "        () => {\n"
     "          const pending = this.#prompts.get(id);\n"
     "          if (!pending?.hxAsk) return;\n"
     "          this.#routines.markRunningForTurn(turnId);\n"
     "          this.#expirePrompt(id, pending);\n"
     "          this.#emitRuntimeSnapshot();\n"
     "        },\n"
     "        { once: true },\n"
     "      );\n"
     "    });\n"
     "  }\n"
     "\n"
     "  /** Expires the prompts of one lost provider client, or of all clients when none is given. */\n"),
]

SERVICE = "src/backend/agent-service.ts"
SERVICE_IMPORTS = [
    'import { hxFileChangeMessage, hxSetFileCardPort } from "./hx-skills/change-card";',
    'import { hxSetSkillUiHost } from "./hx-skills/host";',
]
SERVICE_PAIRS = [
    # 3. 改了文件的卡片：写进改文件的那个对话（放在 computer_v173.py 那一段的前面，不插进它中间）
    ("    // HXBot (v1.7.3): a parked step of computer control goes on with a message to its agent (hx-computer).\n",
     "    // HXBot (v1.7.4, #54): the card of a file change goes to the chat where the agent changed it, and\n"
     "    // “恢复到修改前” reads it back there (hx-skills/change-card.ts).\n"
     "    hxSetSkillUiHost({\n"
     "      changed: (agentId, event) =>\n"
     "        this.#hxFileCard(\n"
     "          agentId,\n"
     "          event.task === `agent-${agentId}` ? null : event.task,\n"
     "          hxFileChangeMessage(event, randomUUID),\n"
     "        ),\n"
     "    });\n"
     "    hxSetFileCardPort({\n"
     "      write: (agentId, threadId, message) => this.#hxFileCard(agentId, threadId, message),\n"
     "      read: (agentId, threadId, messageId) => this.#hxReadFileCard(agentId, threadId, messageId),\n"
     "    });\n"
     "    // HXBot (v1.7.3): a parked step of computer control goes on with a message to its agent (hx-computer).\n"),
    # 放在 computer_v173.py 加的方法（续做停放的步骤）的前面：它接在 computer_steps.py 那几个方法前，不能插进中间
    ("  /**\n"
     "   * HXBot (v1.7.3): the message that continues a parked step of computer control (hx-computer/parked.ts).\n",
     "  /**\n"
     "   * HXBot (v1.7.4, #54): the card of a file change, in the chat where it happened (null: the main chat),\n"
     "   * or that card written again in place. A card that is no longer in the cached part of the chat is\n"
     "   * written to the database only, where it already is. It never throws.\n"
     "   */\n"
     "  #hxFileCard(agentId: string, threadId: string | null, message: ConversationMessage): void {\n"
     "    const database = this.#store.database;\n"
     "    try {\n"
     "      const main = threadId === null || this.#conversation.requireKnownAgent(agentId).threadId === threadId;\n"
     "      const apply = (transactionThreadId: string, snapshot: ConversationSnapshot): ConversationSnapshot => {\n"
     "        const at = snapshot.messages.findIndex((item) => item.id === message.id);\n"
     "        if (at >= 0) snapshot.messages[at] = message;\n"
     "        else if (database.readConversationMessages(agentId, transactionThreadId, [message.id]).length === 0) {\n"
     "          snapshot.messages.push(message);\n"
     "          sortConversationMessages(snapshot.messages);\n"
     "        }\n"
     "        snapshot.revision = database.persistConversationChanges({\n"
     "          agentId,\n"
     "          threadId: transactionThreadId,\n"
     "          activeTurnId: snapshot.activeTurnId,\n"
     "          changedMessages: [message],\n"
     '          eventType: "thread.hx-file-change",\n'
     "        });\n"
     "        return snapshot;\n"
     "      };\n"
     "      if (main || threadId === null)\n"
     "        this.#conversation.withConversationTransaction(agentId, (transaction) => ({\n"
     "          result: undefined,\n"
     "          snapshot: apply(transaction.threadId, transaction.snapshot),\n"
     "        }));\n"
     "      else\n"
     "        this.#conversation.withThreadTransaction(agentId, threadId, (transaction) => ({\n"
     "          result: undefined,\n"
     "          snapshot: apply(transaction.threadId, transaction.snapshot),\n"
     "        }));\n"
     "    } catch (error) {\n"
     '      this.#emitError("hx_file_card_failed", error, agentId);\n'
     "    }\n"
     "  }\n"
     "\n"
     "  /** HXBot (v1.7.4, #54): a card of a file change in a chat, from the database; null when it is not there. */\n"
     "  #hxReadFileCard(agentId: string, threadId: string | null, messageId: string): ConversationMessage | null {\n"
     "    try {\n"
     "      const own = this.#conversation.requireKnownAgent(agentId).threadId;\n"
     "      return this.#store.database.readConversationMessages(agentId, threadId ?? own, [messageId])[0] ?? null;\n"
     "    } catch {\n"
     "      return null;\n"
     "    }\n"
     "  }\n"
     "\n"
     "  /**\n"
     "   * HXBot (v1.7.3): the message that continues a parked step of computer control (hx-computer/parked.ts).\n"),
]

# 4. 主进程的三个请求：改了文件的卡片上“恢复到修改前”，设置里看和改版本空间（接在 computer_v173.py 那几行之后）
IPC_ENDPOINTS = "packages/contracts/src/ipc-endpoints.ts"
IPC_IMPORT = (
    'import type { HxFileVersionsView, HxRestoreFileChangeInput, HxRestoreFileChangeResult } from "./hx-file-change";'
)
IPC_PAIRS = [
    ('    hxComputerSetAutoResume: request<boolean, HxComputerStatus>()("auth:hx-computer-set-auto-resume"),\n',
     '    hxComputerSetAutoResume: request<boolean, HxComputerStatus>()("auth:hx-computer-set-auto-resume"),\n'
     "    // HXBot (v1.7.4, #54): “恢复到修改前” on the card of a file change, and the space for versions (hx-skills).\n"
     "    hxRestoreFileChange: request<HxRestoreFileChangeInput, HxRestoreFileChangeResult>()(\n"
     '      "auth:hx-restore-file-change",\n'
     "    ),\n"
     '    hxFileVersionsView: request<undefined, HxFileVersionsView>()("auth:hx-file-versions-view"),\n'
     '    hxFileVersionsSetCap: request<number | null, HxFileVersionsView>()("auth:hx-file-versions-set-cap"),\n'),
]
HANDLERS = "src/main/ipc/account-handlers.ts"
HANDLER_IMPORTS = [
    'import { decodeHxFileVersionCap, decodeHxRestoreFileChangeInput } from "@hxbot/contracts/hx-file-change";',
    'import { hxFileVersionsSetCap, hxFileVersionsView, hxRestoreFileChangeCall } from "../../backend/hx-skills/host";',
]
HANDLER_PAIRS = [
    ("        (on) => hxComputer.setAutoResume(on),\n      ),\n",
     "        (on) => hxComputer.setAutoResume(on),\n      ),\n"
     "      hxRestoreFileChange: payloadHandler(decodeHxRestoreFileChangeInput, (input) => hxRestoreFileChangeCall(input)),\n"
     "      hxFileVersionsView: handler(() => hxFileVersionsView()),\n"
     "      hxFileVersionsSetCap: payloadHandler(decodeHxFileVersionCap, (bytes) => hxFileVersionsSetCap(bytes)),\n"),
]
PRELOAD = "src/preload/index.ts"
PRELOAD_IMPORT = (
    'import { decodeHxFileVersionsView, decodeHxRestoreFileChangeResult } from "@hxbot/contracts/hx-file-change";'
)
PRELOAD_PAIRS = [
    ("    hxComputerSetAutoResume: decodeHxComputerStatus,\n",
     "    hxComputerSetAutoResume: decodeHxComputerStatus,\n"
     "    hxRestoreFileChange: decodeHxRestoreFileChangeResult,\n"
     "    hxFileVersionsView: decodeHxFileVersionsView,\n"
     "    hxFileVersionsSetCap: decodeHxFileVersionsView,\n"),
]
PORT_PAIRS = [
    ('    | "hxComputerSetAutoResume"\n',
     '    | "hxComputerSetAutoResume"\n    | "hxRestoreFileChange"\n    | "hxFileVersionsView"\n    | "hxFileVersionsSetCap"\n'),
]
# 预览：放在 computer_v173.py 那一段的前面
MOCK_PAIRS = [
    ("    hxComputerSetAutoResume: async (on: boolean) => ({\n",
     "    hxRestoreFileChange: async () => ({ status: \"restored\" as const }),\n"
     "    hxFileVersionsView: async () => ({ ...mockFileVersions }),\n"
     "    hxFileVersionsSetCap: async (bytes: number | null) => {\n"
     "      mockFileVersions = { ...mockFileVersions, capBytes: bytes ?? mockFileVersions.defaultCapBytes, custom: bytes !== null };\n"
     "      return { ...mockFileVersions };\n"
     "    },\n"
     "    hxComputerSetAutoResume: async (on: boolean) => ({\n"),
]
MOCK_STATE = (
    "/** HXBot (v1.7.4): the space for versions that the preview shows (Settings → Computer Use). */\n"
    "let mockFileVersions = {\n"
    "  capBytes: 2 * 1024 ** 3,\n"
    "  defaultCapBytes: 2 * 1024 ** 3,\n"
    "  custom: false,\n"
    "  usedBytes: 380 * 1024 ** 2,\n"
    "  versions: 42,\n"
    "};\n"
)

# 5. 对话里画这张卡片（放在“计划”那一行之前：卡片不是计划，也不是普通的文字）
TIMELINE = "src/renderer/src/features/conversation/ConversationTimeline.tsx"
TIMELINE_IMPORT = 'import { HxFileChangeRow, isHxFileChangeRow } from "./HxFileChangeRow";'
TIMELINE_PAIRS = [
    ('                if (untrack(() => initialMessage.kind === "plan")) {\n',
     "                // HXBot (v1.7.4, #54): the card of a file that an app skill changed, with its changes and\n"
     "                // “恢复到修改前”. Only this computer restores the files of its own agents.\n"
     "                if (untrack(() => isHxFileChangeRow(initialMessage))) {\n"
     "                  return (\n"
     "                    <div\n"
     "                      data-index={virtualRow.index}\n"
     "                      ref={messageVirtualizer.measureElement}\n"
     '                      class="virtual-chat-row"\n'
     "                      style={{\n"
     "                        transform: messageVirtualizer.isVirtualized()\n"
     "                          ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`\n"
     '                          : "none",\n'
     "                      }}\n"
     "                    >\n"
     "                      <Show when={message()?.id === compactionBefore()}>\n"
     "                        <CompactionMarker />\n"
     "                      </Show>\n"
     "                      <Show when={dayMarker()}>\n"
     "                        {(label) => (\n"
     '                          <div class="time-marker">\n'
     "                            <span>{label()}</span>\n"
     "                          </div>\n"
     "                        )}\n"
     "                      </Show>\n"
     "                      <Show when={message()?.id === unreadBoundaryMessageId()}>\n"
     "                        <UnreadMessagesDivider\n"
     "                          animateIn={unreadDividerArrives}\n"
     "                          elementRef={(element) => {\n"
     "                            setUnreadMessagesDividerElement(element);\n"
     "                            scheduleUnreadDividerVisibilityUpdate();\n"
     "                          }}\n"
     "                        />\n"
     "                      </Show>\n"
     "                      <ChatRowBoundary>\n"
     "                        <article\n"
     "                          data-chat-search-message={message()?.id}\n"
     '                          class={{ "message-entry-animated": animateEntrance }}\n'
     "                        >\n"
     "                          <HxFileChangeRow\n"
     "                            message={message() ?? initialMessage}\n"
     "                            agentId={props.agent?.id}\n"
     "                            threadId={props.agent?.threadId}\n"
     "                            local={!props.runtime}\n"
     "                          />\n"
     "                        </article>\n"
     "                      </ChatRowBoundary>\n"
     "                    </div>\n"
     "                  );\n"
     "                }\n"
     '                if (untrack(() => initialMessage.kind === "plan")) {\n'),
]
UI_PACKAGE_PAIRS = [
    ('    "./features/conversation/TaskList": "./src/features/conversation/TaskList.tsx",\n',
     '    "./features/conversation/HxFileChangeCard": "./src/features/conversation/HxFileChangeCard.tsx",\n'
     '    "./features/conversation/TaskList": "./src/features/conversation/TaskList.tsx",\n'),
]
STYLE_PAIRS = [
    ('@import "./styles/task-list.css";\n',
     '@import "./styles/task-list.css";\n@import "./styles/hx-file-change.css";\n'),
]

TEXT_EN = {
    "status.agent.hxSkill.space.header": "Version space",
    "status.agent.hxSkill.space.cap":
        "The space for earlier versions of files is full ({used} of {cap}). "
        "To keep the version of {file} before this change, HXBot needs {needed} more. What should HXBot do?",
    "status.agent.hxSkill.space.disk":
        "The disk has no room to keep the version of {file} before this change (it needs {needed}). "
        "What should HXBot do?",
    "status.agent.hxSkill.space.detail":
        "Nothing changes until you choose. You can change the space in Settings → Computer Use.",
    "status.agent.hxSkill.space.cleanOld": "Remove the oldest versions",
    "status.agent.hxSkill.space.cleanOldDetail":
        "Removes the versions kept for the oldest tasks (never this one) until there is room, then makes the change.",
    "status.agent.hxSkill.space.noVersion": "Change it without a version",
    "status.agent.hxSkill.space.noVersionDetail": "Makes the change now. You cannot restore this file to before it.",
    "status.agent.hxSkill.space.cancel": "Cancel the change",
    "status.agent.hxSkill.space.cancelDetail": "The file stays as it is, and every version stays.",
    "status.agent.hxSkill.change.made": "Made {file}",
    "status.agent.hxSkill.change.same": "Saved {file}; its content did not change",
    "status.agent.hxSkill.change.fileOnly": "Changed {file} (this kind of file shows no details)",
    "status.agent.hxSkill.change.counts": "Changed {file}: {changed} changed, {added} added, {removed} removed",
    "status.agent.hxSkill.change.restored": "Restored {file} to before the change",
    "status.agent.hxSkill.change.checked": "HXBot read the file back, and it is as expected.",
    "status.agent.hxSkill.change.unchecked": "HXBot could not read the file back to check it.",
    "status.agent.hxSkill.change.checkedNoVersion":
        "HXBot read the file back, and it is as expected. No version was kept, so this change cannot be restored.",
    "status.agent.hxSkill.change.uncheckedNoVersion":
        "HXBot could not read the file back to check it. No version was kept, so this change cannot be restored.",
    "status.agent.hxSkill.change.restoredNote":
        "The file is as it was before the change. The file as it was before the restore is kept as a version too.",
    "status.agent.hxSkill.change.more": "… {count} more changes",
    "status.agent.hxSkill.change.cut": "… the list stops here; the numbers in the title are complete",
    "status.agent.hxSkill.restore.starting": "HXBot is still starting. Try again in a moment.",
    "status.agent.hxSkill.restore.notInChat": "This card is not in this chat any more.",
    "status.agent.hxSkill.restore.noVersion": "No version was kept before this change, so it cannot be restored.",
    "status.agent.hxSkill.restore.notKept": "The version from before this change is not kept any more.",
    "status.agent.hxSkill.restore.spaceFull":
        "There is no room to keep the file as it is now before the restore. "
        "Free up disk space, or make the space larger in Settings → Computer Use.",
}

TEXT_ZH = {
    "status.agent.hxSkill.space.header": "版本空间",
    "status.agent.hxSkill.space.cap":
        "保留文件旧版本的空间满了（已用 {used}，上限 {cap}）。要保留 {file} 修改前的版本，还需要 {needed}。怎么办？",
    "status.agent.hxSkill.space.disk": "磁盘空间不够，保留不了 {file} 修改前的版本（需要 {needed}）。怎么办？",
    "status.agent.hxSkill.space.detail": "你选之前什么都不改。空间大小可以在“设置 → Computer Use”里改。",
    "status.agent.hxSkill.space.cleanOld": "删掉最早的旧版本",
    "status.agent.hxSkill.space.cleanOldDetail": "从最早的任务留的旧版本删起（不删这次的），腾出空间后再修改。",
    "status.agent.hxSkill.space.noVersion": "这次不留版本",
    "status.agent.hxSkill.space.noVersionDetail": "直接修改。这个文件不能再恢复到修改前。",
    "status.agent.hxSkill.space.cancel": "取消修改",
    "status.agent.hxSkill.space.cancelDetail": "文件不动，旧版本都留着。",
    "status.agent.hxSkill.change.made": "新建了 {file}",
    "status.agent.hxSkill.change.same": "保存了 {file}，内容没有变化",
    "status.agent.hxSkill.change.fileOnly": "改了 {file}（这类文件看不到具体改动）",
    "status.agent.hxSkill.change.counts": "改了 {file}：改 {changed} 处，加 {added} 处，删 {removed} 处",
    "status.agent.hxSkill.change.restored": "已把 {file} 恢复到修改前",
    "status.agent.hxSkill.change.checked": "HXBot 已读回核对，和预期一致。",
    "status.agent.hxSkill.change.unchecked": "HXBot 没能读回核对这个文件。",
    "status.agent.hxSkill.change.checkedNoVersion": "HXBot 已读回核对，和预期一致。这次没留版本，不能恢复到修改前。",
    "status.agent.hxSkill.change.uncheckedNoVersion": "HXBot 没能读回核对这个文件。这次没留版本，不能恢复到修改前。",
    "status.agent.hxSkill.change.restoredNote": "文件已回到修改前的样子；恢复前的样子也留了一个版本。",
    "status.agent.hxSkill.change.more": "……还有 {count} 处改动",
    "status.agent.hxSkill.change.cut": "……列表到这里为止；标题里的数目是完整的",
    "status.agent.hxSkill.restore.starting": "HXBot 还在启动，请稍后再试。",
    "status.agent.hxSkill.restore.notInChat": "这张卡片已经不在这个对话里了。",
    "status.agent.hxSkill.restore.noVersion": "这次修改前没留版本，不能恢复。",
    "status.agent.hxSkill.restore.notKept": "修改前的版本已经不在了。",
    "status.agent.hxSkill.restore.spaceFull":
        "空间不够，恢复前保留不了现在的文件。请腾出磁盘空间，或在“设置 → Computer Use”里把空间调大。",
}

CONVERSATION_EN = {
    "conversation.hx.fileChange.restore": "Restore to before the change",
    "conversation.hx.fileChange.restoring": "Restoring…",
    "conversation.hx.fileChange.restoredNow": "Restored.",
    "conversation.hx.fileChange.unchanged": "The file was already as it was before the change.",
    "conversation.hx.fileChange.failed": "Could not restore: {reason}",
    "conversation.hx.fileChange.show": "Show the changes ({count})",
    "conversation.hx.fileChange.hide": "Hide the changes",
    "conversation.hx.fileChange.remote": "You can restore it on the computer that runs this agent.",
}

CONVERSATION_ZH = {
    "conversation.hx.fileChange.restore": "恢复到修改前",
    "conversation.hx.fileChange.restoring": "正在恢复…",
    "conversation.hx.fileChange.restoredNow": "已恢复。",
    "conversation.hx.fileChange.unchanged": "文件本来就是修改前的样子。",
    "conversation.hx.fileChange.failed": "没能恢复：{reason}",
    "conversation.hx.fileChange.show": "展开改动（{count}）",
    "conversation.hx.fileChange.hide": "收起改动",
    "conversation.hx.fileChange.remote": "在运行这个助手的电脑上可以恢复。",
}

SETTINGS_EN = {
    "settings.hxComputer.versions.title": "Versions kept before changes",
    "settings.hxComputer.versions.description":
        "Before an app skill changes a file, HXBot keeps the file as it was, so the card in the chat can restore it. "
        "When this space is full, HXBot asks you before it removes old versions.",
    "settings.hxComputer.versions.usage": "{used} used by {count} versions",
    "settings.hxComputer.versions.cap": "Space",
    "settings.hxComputer.versions.default": "{size} (default)",
    "settings.hxComputer.versions.git":
        "A coding agent that changes files with its own commands keeps no versions here. In a Git folder, Git can restore them.",
}

SETTINGS_ZH = {
    "settings.hxComputer.versions.title": "修改前保留的版本",
    "settings.hxComputer.versions.description":
        "应用技能改文件前，HXBot 会留一份修改前的文件，对话里的卡片可以一键恢复。空间满了时，先问你再删旧版本。",
    "settings.hxComputer.versions.usage": "已用 {used}，共 {count} 个版本",
    "settings.hxComputer.versions.cap": "空间上限",
    "settings.hxComputer.versions.default": "{size}（默认）",
    "settings.hxComputer.versions.git": "编程智能体用自己的命令改的文件不在这里留版本；在 Git 仓库里可以用 Git 恢复。",
}

ERROR_EN = {
    "error.backend.hxAskOwnerOnly": "Only the owner of this HXBot can choose this. Anyone can cancel the change.",
}

ERROR_ZH = {
    "error.backend.hxAskOwnerOnly": "只有这台 HXBot 的主人能选这一项；谁都可以取消修改。",
}


def registry(r) -> None:
    for line in REGISTRY_IMPORTS:
        brand_rename.add_import(r, REGISTRY, line)
    for old, new in REGISTRY_PAIRS:
        r.replace(REGISTRY, old, new)


def text(r) -> None:
    """界面文字（英文、中文在这里；其他 13 种语言在 hx/translations_v174.py）。"""
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/status/agent.ts", "\n});\n", TEXT_EN)
    r.add_messages(f"{messages}/zh/status/agent.ts", "\n} as const satisfies", TEXT_ZH)
    r.add_messages(f"{messages}/en/error/backend.ts", "\n});\n", ERROR_EN)
    r.add_messages(f"{messages}/zh/error/backend.ts", "\n} as const satisfies", ERROR_ZH)
    r.add_messages(f"{messages}/en/conversation.ts", "\n});\n", CONVERSATION_EN)
    r.add_messages(f"{messages}/zh/conversation.ts", "\n} as const satisfies", CONVERSATION_ZH)
    r.add_messages(f"{messages}/en/settings.ts", "\n});\n", SETTINGS_EN)
    r.add_messages(f"{messages}/zh/settings.ts", "\n} as const satisfies", SETTINGS_ZH)


def service(r) -> None:
    for line in SERVICE_IMPORTS:
        brand_rename.add_import(r, SERVICE, line)
    for old, new in SERVICE_PAIRS:
        r.replace(SERVICE, old, new)


def plumbing(r) -> None:
    """主进程的请求、preload 的解码、设置页能用的名字、预览。"""
    brand_rename.add_import(r, IPC_ENDPOINTS, IPC_IMPORT)
    for old, new in IPC_PAIRS:
        r.replace(IPC_ENDPOINTS, old, new)
    for line in HANDLER_IMPORTS:
        brand_rename.add_import(r, HANDLERS, line)
    for old, new in HANDLER_PAIRS:
        r.replace(HANDLERS, old, new)
    brand_rename.add_import(r, PRELOAD, PRELOAD_IMPORT)
    for old, new in PRELOAD_PAIRS:
        r.replace(PRELOAD, old, new)
    for old, new in PORT_PAIRS:
        r.replace("src/renderer/src/features/account/account-port.ts", old, new)
    mock = "src/renderer/src/preview/mock-auth.ts"
    for old, new in MOCK_PAIRS:
        r.replace(mock, old, new)
    text_now = r.read(mock)
    if "let mockFileVersions" not in text_now:
        # 放在第一个 export 之前（文件开头的 import 之后）
        at = text_now.index("\nexport ")
        r.write(mock, text_now[: at + 1] + MOCK_STATE + "\n" + text_now[at + 1 :])
    brand_rename.add_import(r, TIMELINE, TIMELINE_IMPORT)
    for old, new in TIMELINE_PAIRS:
        r.replace(TIMELINE, old, new)
    for old, new in UI_PACKAGE_PAIRS:
        r.replace("packages/ui/package.json", old, new)
    for old, new in STYLE_PAIRS:
        r.replace("packages/ui/src/features/conversation/conversation.css", old, new)
    # 合同包的出口：放在 computer_steps.py 那一行的前面
    r.replace("packages/contracts/package.json",
              '    "./hx-progress": "./src/hx-progress.ts",\n',
              '    "./hx-file-change": "./src/hx-file-change.ts",\n    "./hx-progress": "./src/hx-progress.ts",\n')


def apply(r) -> None:
    registry(r)
    service(r)
    plumbing(r)
    text(r)
