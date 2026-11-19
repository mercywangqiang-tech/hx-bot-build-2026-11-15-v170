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


def apply(r) -> None:
    registry(r)
    text(r)
