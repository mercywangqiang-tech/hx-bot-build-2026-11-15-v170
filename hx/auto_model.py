"""HXBot 协作（一）：按工作内容自动选模型，开工前的建议卡（v1.6.5）。

HX 自己的文件：
- packages/contracts/src/hx-auto-model.ts：工作类型、模型档位、选模型的规则、设置和选择记录的类型
- src/backend/hx-auto-model/：判断工作类型（规则和小模型）、选模型、设置和记录、建议卡工具
- src/renderer/src/features/agents/HxAutoModelSection.tsx：智能体设置里的“自动选择模型”

这里只做接线：
1. 每条队列开始之前（drain 调 followUsageLimit 的地方），开了“自动”的智能体先选模型、换过去，再开始这一轮；
   换模型沿用“下一轮之前生效的改动”（next-turn），换提供方时照常交接对话。
2. 对话里的一行小字（model-switch:auto）：这件工作是什么、用哪个模型。
3. 用户或别的智能体手动改模型，这个智能体就退出“自动”。
4. 额度用完时，没有设置备用模型的“自动”智能体换到下一个合适的模型。
5. 一轮失败时，建议换更强的模型（回复“重做”）。
6. 建议卡工具 propose_plan。
7. 设置页的两个请求、模型选择里的“自动”、智能体设置里的一节，界面文字。
其他 13 种语言的译文在 hx/translations_v165.py。
"""

from __future__ import annotations

import brand_rename

# 对话里的一行小字：按工作类型各一句；“换用”和“由……来做”两种。{model} 是模型名。
WORK_EN = {
    "chat": "chat",
    "writing": "writing",
    "codeSmall": "a small code change",
    "codeLarge": "coding across files",
    "data": "data",
    "vision": "an image",
    "longContext": "long material",
    "reasoning": "planning and reasoning",
    "computer": "operating this computer",
}
WORK_ZH = {
    "chat": "闲聊问答",
    "writing": "写作",
    "codeSmall": "小改代码",
    "codeLarge": "多文件编程",
    "data": "数据",
    "vision": "看图",
    "longContext": "长资料",
    "reasoning": "方案与推理",
    "computer": "电脑操作",
}

STATUS_EN = {
    **{f"status.agent.hxAuto.switched.{key}": f"Auto model · {label}: switched to {{model}}." for key, label in WORK_EN.items()},
    **{f"status.agent.hxAuto.kept.{key}": f"Auto model · {label}: {{model}} takes it." for key, label in WORK_EN.items()},
    "status.agent.hxAuto.switched": "Auto model: switched to {model}.",
    "status.agent.hxAuto.suggest": "This work did not go well. Reply “redo” to do it again with {model}.",
}
STATUS_ZH = {
    **{f"status.agent.hxAuto.switched.{key}": f"自动选模型 · {label}：换用 {{model}}。" for key, label in WORK_ZH.items()},
    **{f"status.agent.hxAuto.kept.{key}": f"自动选模型 · {label}：由 {{model}} 来做。" for key, label in WORK_ZH.items()},
    "status.agent.hxAuto.switched": "自动选模型：换用 {model}。",
    "status.agent.hxAuto.suggest": "这件工作做得不顺利。回复“重做”，就换用 {model} 再做一遍。",
}


# 智能体设置里“自动选择模型”和“建议卡”的文字
WORK_UI_EN = {
    "chat": "Chat", "writing": "Writing", "codeSmall": "Small code change", "codeLarge": "Coding across files",
    "data": "Data", "vision": "Images", "longContext": "Long material", "reasoning": "Planning and reasoning",
    "computer": "Operating this computer",
}
WORK_UI_ZH = {
    "chat": "闲聊问答", "writing": "写作", "codeSmall": "小改代码", "codeLarge": "多文件编程", "data": "数据",
    "vision": "看图", "longContext": "长资料", "reasoning": "方案与推理", "computer": "电脑操作",
}
SETTINGS_EN = {
    "settings.hxAutoModel.title": "Auto model",
    "settings.hxAutoModel.enabled": "Choose the model by the work",
    "settings.hxAutoModel.description":
        "For each new piece of work, HXBot finds what it is and how hard, then picks one of the models below. A small "
        "line in the chat names the model.",
    "settings.hxAutoModel.preference": "Preference",
    "settings.hxAutoModel.preference.free": "Free first",
    "settings.hxAutoModel.preference.balanced": "Balanced",
    "settings.hxAutoModel.preference.quality": "Quality first",
    "settings.hxAutoModel.judge": "How it decides",
    "settings.hxAutoModel.judge.rulesModel": "Rules, and a small model when unsure",
    "settings.hxAutoModel.judge.rules": "Rules only (no message goes to a judge model)",
    "settings.hxAutoModel.crossProvider.title": "May move to another provider",
    "settings.hxAutoModel.crossProvider.description":
        "The chat is handed over to the new provider. At most one move in ten minutes, unless the work needs one.",
    "settings.hxAutoModel.suggestStronger.title": "Suggest a stronger model when work fails",
    "settings.hxAutoModel.suggestStronger.description":
        "After a turn that fails or gives up, the chat asks once. The model changes only when you reply “redo”.",
    "settings.hxAutoModel.proposal": "Proposal card",
    "settings.hxAutoModel.proposal.auto": "When the work calls for it",
    "settings.hxAutoModel.proposal.always": "Before each long task",
    "settings.hxAutoModel.proposal.off": "Never",
    "settings.hxAutoModel.proposal.description":
        "Before the work starts, the card shows how many agents, who does what and which models. Nothing starts until "
        "you press Start.",
    "settings.hxAutoModel.preview": "Now:",
    **{f"settings.hxAutoModel.work.{key}": label for key, label in WORK_UI_EN.items()},
    "settings.hxAutoModel.freeUsed": "OpenCode free models: about {count} requests today on this computer.",
    "settings.hxAutoModel.freeBlocked": "OpenCode's free limit is used up for today. It comes back about {time}.",
    "settings.hxAutoModel.more": "Models and recent choices",
    "settings.hxAutoModel.models.description": "A model you clear is never chosen. A model that is not ready is skipped.",
    "settings.hxAutoModel.cost.free": "Free",
    "settings.hxAutoModel.cost.subscription": "Subscription",
    "settings.hxAutoModel.cost.paid": "Paid",
    "settings.hxAutoModel.vision": "reads images",
    "settings.hxAutoModel.notReady": "not ready",
    "settings.hxAutoModel.recent": "Recent choices",
    "settings.hxAutoModel.recent.empty": "No choices yet.",
    "settings.hxAutoModel.recent.kept": "{model}",
    "settings.hxAutoModel.recent.switched": "switched to {model}",
    "settings.hxAutoModel.failed": "This did not work. Try again.",
}
SETTINGS_ZH = {
    "settings.hxAutoModel.title": "自动选择模型",
    "settings.hxAutoModel.enabled": "按工作内容自动选择模型",
    "settings.hxAutoModel.description": "每件新工作先判断是什么、有多难，再从下面的模型里选一个。对话里有一行小字写明用了哪个模型。",
    "settings.hxAutoModel.preference": "倾向",
    "settings.hxAutoModel.preference.free": "免费优先",
    "settings.hxAutoModel.preference.balanced": "均衡",
    "settings.hxAutoModel.preference.quality": "质量优先",
    "settings.hxAutoModel.judge": "判断方式",
    "settings.hxAutoModel.judge.rulesModel": "规则，拿不准时问小模型",
    "settings.hxAutoModel.judge.rules": "只用规则（消息不发给判断模型）",
    "settings.hxAutoModel.crossProvider.title": "可以换到别的提供方",
    "settings.hxAutoModel.crossProvider.description": "换提供方时把对话交接过去。十分钟内最多换一次，除非工作需要。",
    "settings.hxAutoModel.suggestStronger.title": "做不下来时建议换更强的模型",
    "settings.hxAutoModel.suggestStronger.description": "一轮失败或回复说做不了时，对话里问一句。回复“重做”才会换。",
    "settings.hxAutoModel.proposal": "建议卡",
    "settings.hxAutoModel.proposal.auto": "需要时出",
    "settings.hxAutoModel.proposal.always": "每次长任务都出",
    "settings.hxAutoModel.proposal.off": "不出",
    "settings.hxAutoModel.proposal.description": "开工前列出用几个智能体、谁做什么、各用什么模型。点“开始”才动手。",
    "settings.hxAutoModel.preview": "现在：",
    **{f"settings.hxAutoModel.work.{key}": label for key, label in WORK_UI_ZH.items()},
    "settings.hxAutoModel.freeUsed": "OpenCode 免费模型：这台电脑今天约用了 {count} 次。",
    "settings.hxAutoModel.freeBlocked": "OpenCode 免费额度今天已用完，约 {time} 恢复。",
    "settings.hxAutoModel.more": "候选模型和最近的选择",
    "settings.hxAutoModel.models.description": "取消勾选的模型不会被选中。现在用不了的模型会跳过。",
    "settings.hxAutoModel.cost.free": "免费",
    "settings.hxAutoModel.cost.subscription": "订阅",
    "settings.hxAutoModel.cost.paid": "按量付费",
    "settings.hxAutoModel.vision": "能看图",
    "settings.hxAutoModel.notReady": "现在用不了",
    "settings.hxAutoModel.recent": "最近的选择",
    "settings.hxAutoModel.recent.empty": "还没有选择记录。",
    "settings.hxAutoModel.recent.kept": "{model}",
    "settings.hxAutoModel.recent.switched": "换用 {model}",
    "settings.hxAutoModel.failed": "没有成功，请再试一次。",
}


def contracts(r) -> None:
    # 排在电脑操控那一行之前（computer_control.py 加的）
    r.replace("packages/contracts/package.json",
              '    "./hx-computer": "./src/hx-computer.ts",\n',
              '    "./hx-auto-model": "./src/hx-auto-model.ts",\n'
              '    "./hx-computer": "./src/hx-computer.ts",\n')
    events = "packages/contracts/src/ipc-conversation-events.ts"
    r.replace(events,
              '  "provider-error-ended": `${MODEL_SWITCH_ITEM_TYPE_PREFIX}provider-error-ended`,\n} as const;\n',
              '  "provider-error-ended": `${MODEL_SWITCH_ITEM_TYPE_PREFIX}provider-error-ended`,\n'
              "  // HXBot: the line before each piece of work of an agent on auto model (hx-auto-model).\n"
              "  auto: `${MODEL_SWITCH_ITEM_TYPE_PREFIX}auto`,\n"
              "} as const;\n")
    r.replace(events,
              '  if (message.itemType === MODEL_SWITCH_ITEM_TYPES["provider-error-ended"]) return "provider-error-ended";\n',
              '  if (message.itemType === MODEL_SWITCH_ITEM_TYPES["provider-error-ended"]) return "provider-error-ended";\n'
              '  if (message.itemType === MODEL_SWITCH_ITEM_TYPES.auto) return "auto";\n')


# 智能体服务给选模型那一层的接口：读智能体、模型、队列，换模型，往对话里写一行。
HOST = (
    "  /** HXBot: what the auto model router reads and does (hx-auto-model). */\n"
    "  #hxAutoHost(): HxAutoHost {\n"
    "    const agentOf = (agentId: string) => this.#store.list().find((candidate) => candidate.id === agentId);\n"
    "    return {\n"
    "      agent: (agentId) => {\n"
    "        const agent = agentOf(agentId);\n"
    "        return agent\n"
    "          ? {\n"
    "              id: agent.id,\n"
    "              name: agent.name,\n"
    "              provider: providerForAgent(agent),\n"
    "              model: agent.model,\n"
    "              providerAccountId: agent.providerAccountId ?? null,\n"
    "              reasoningEffort: agent.reasoningEffort,\n"
    "            }\n"
    "          : null;\n"
    "      },\n"
    "      // The agent's own account for its provider; the default account of every other provider.\n"
    "      models: (agentId) => {\n"
    "        const agent = agentOf(agentId);\n"
    "        if (!agent) return [];\n"
    "        const provider = providerForAgent(agent);\n"
    "        return this.#agentModels({ provider, providerAccountId: agent.providerAccountId }).map((model) =>\n"
    "          model.provider === provider && agent.providerAccountId\n"
    "            ? { ...model, providerAccountId: agent.providerAccountId }\n"
    "            : model,\n"
    "        );\n"
    "      },\n"
    "      ready: (choice) => this.#usageLimitReady(choice),\n"
    "      limited: (choice) => this.#usageLimits.isLimited(usageLimitOf(choice)),\n"
    "      busy: (agentId) =>\n"
    "        this.#runtimeHandoverBusy(agentId) ||\n"
    "        !this.#usageLimits.mayDrain(agentId) ||\n"
    "        Boolean(agentOf(agentId)?.pendingRuntime),\n"
    "      nextWork: (agentId) => {\n"
    "        for (const taskId of [null, ...this.#mailbox.queuedTaskIds(agentId)]) {\n"
    "          const next = this.#mailbox.nextQueued(agentId, taskId);\n"
    "          if (!next) continue;\n"
    "          // A continuation after a usage limit, or of a plan, keeps the model of the work it continues;\n"
    "          // channel work keeps the model that its channel knows the agent by.\n"
    "          if (next.resumeAfterUsageLimit || next.planContinuation || next.channelId) return null;\n"
    "          return {\n"
    "            deliveryId: next.delivery.id,\n"
    "            taskId,\n"
    "            text: next.delivery.text,\n"
    "            attachments: next.delivery.attachments.map((item) => ({ name: item.name, size: item.size })),\n"
    "            sender: next.delivery.sender.kind,\n"
    "          };\n"
    "        }\n"
    "        return null;\n"
    "      },\n"
    "      historyTokens: (agentId, taskId) => {\n"
    "        const agent = agentOf(agentId);\n"
    "        const threadId = taskId === null ? agent?.threadId : this.#tasks.threadId(taskId);\n"
    "        const session =\n"
    "          agent && threadId ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;\n"
    "        return session ? Math.ceil(this.#compaction.contextInputCharacters(session.externalSessionId) / 4) : 0;\n"
    "      },\n"
    # v1.7.0：对话接着进行时保持原模型和推理强度（router.ts 的 continuing）
    "      continuing: (agentId, taskId) => {\n"
    "        const agent = agentOf(agentId);\n"
    "        const threadId = taskId === null ? agent?.threadId : this.#tasks.threadId(taskId);\n"
    "        return Boolean(agent && threadId && this.#store.database.activeProviderSession(threadId, agent.provider));\n"
    "      },\n"
    "      move: (agentId, choice) =>\n"
    "        Effect.runPromise(\n"
    "          this.#endpoints.runExclusive(() =>\n"
    "            this.#applyAgentUpdate(\n"
    "              {\n"
    "                agentId,\n"
    "                provider: choice.provider,\n"
    "                model: choice.model,\n"
    "                reasoningEffort: choice.reasoningEffort,\n"
    "                providerAccountId: choice.providerAccountId ?? null,\n"
    "              },\n"
    "              undefined,\n"
    '              "next-turn",\n'
    "            ),\n"
    "          ),\n"
    "        ).then(() => undefined),\n"
    "      note: (agentId, taskId, text) => {\n"
    "        const message: ConversationMessage = {\n"
    "          id: `model-switch-${randomUUID()}`,\n"
    '          author: "system",\n'
    '          source: "system",\n'
    "          text,\n"
    "          createdAt: new Date().toISOString(),\n"
    '          status: "completed",\n'
    "          itemType: MODEL_SWITCH_ITEM_TYPES.auto,\n"
    "        };\n"
    "        const threadId = taskId === null ? null : this.#tasks.threadId(taskId);\n"
    "        try {\n"
    '          if (threadId) this.#appendSideThreadSystemMessage(agentId, threadId, message, "thread.model-switched");\n'
    '          else this.#appendSystemMessage(agentId, message, "thread.model-switched");\n'
    "        } catch (error) {\n"
    '          this.#emitError("model_switch_marker_failed", error, agentId);\n'
    "        }\n"
    "      },\n"
    "      judge: (agentId, model, prompt, signal) => {\n"
    "        // The judge waits for no one: when a background call holds the spare client, the rules decide.\n"
    '        if (this.#profileClients.busy()) return Promise.reject(new Error("The spare client is busy."));\n'
    "        const client = this.#providers.createProfileClient(model.provider, model.providerAccountId);\n"
    "        return Effect.runPromise(\n"
    "          this.#profileClients.run(client, (cancelled) =>\n"
    "            // HXBot (v1.7.1): the judge's tokens are the agent's usage, as a memory review's are.\n"
    "            generateTextWithoutTools(\n"
    "              client,\n"
    "              withBackgroundEffort(model),\n"
    "              prompt,\n"
    "              () => cancelled() || signal.aborted,\n"
    '              sideSessionUsageObserver("auto-model", this.#store.database.usage, agentId, model.provider, model.id),\n'
    "            ),\n"
    "          ),\n"
    "          { signal },\n"
    "        );\n"
    "      },\n"
    "      taskOfThread: (agentId, threadId) =>\n"
    "        this.#tasks.taskForThread(this.#conversation.publicThreadId(agentId, threadId)),\n"
    "      lastReply: (agentId, threadId, turnId) => {\n"
    "        const messages = this.#conversation.ensureSnapshot(agentId, threadId).messages;\n"
    "        for (let index = messages.length - 1; index >= 0; index--) {\n"
    "          const message = messages[index];\n"
    '          if (message?.author === "assistant" && (message.turnId === undefined || message.turnId === turnId))\n'
    "            return message.text;\n"
    "        }\n"
    "        return null;\n"
    "      },\n"
    "      scheduleDrain: (agentId) => this.#drain.scheduleDrain(agentId),\n"
    "    };\n"
    "  }\n"
    "\n"
)


def service(r) -> None:
    # v1.7.1：自动选模型的“小模型判断”、频道摘要和路由、旁问也记进助手的用量（原来不记：费用提醒和用量页少算；
    # 频道和旁问两处的接线在 hx/flow.py 的 side_usage）。
    r.replace("src/backend/agent/usage-collection.ts",
              '  kind: "memory-review" | "web-search",\n',
              '  // HXBot (v1.7.1): "auto-model" is the judge of the automatic model choice; "channel" a channel\n'
              '  // summary or routing turn; "side-question" a side question about the chat.\n'
              '  kind: "memory-review" | "web-search" | "auto-model" | "channel" | "side-question",\n')
    service = "src/backend/agent-service.ts"
    brand_rename.add_import(r, service, 'import { hxAutoModelStore } from "./hx-auto-model/store";')
    brand_rename.add_import(r, service, 'import { type HxAutoHost, hxAutoRouter } from "./hx-auto-model/router";')
    # 选模型的那一层要用的接口，在排队的工作开始之前就要有
    r.replace(service, "    this.#drain = new DrainScheduler({\n",
              "    // HXBot: an agent on auto model chooses its model before each new piece of work (hx-auto-model).\n"
              "    hxAutoRouter.setHost(this.#hxAutoHost());\n"
              "    this.#drain = new DrainScheduler({\n")
    # 每条队列开始之前：先处理排好的改动和额度，再由“自动”选这件工作的模型
    r.replace(service, "          if (!this.#usageLimitMove(agentId)) return false;\n",
              "          if (!this.#usageLimitMove(agentId)) {\n"
              "            // HXBot: an agent on auto model chooses the model of its next work, then the queue starts.\n"
              "            if (!hxAutoRouter.due(agentId)) return false;\n"
              "            void hxAutoRouter.follow(agentId);\n"
              "            return true;\n"
              "          }\n")
    # 额度用完：没有设置备用模型的“自动”智能体换到下一个合适的模型
    r.replace(service, "    if (!agent || (!agent.usageLimitReturn && !agent.backupModels)) return null;\n",
              "    if (!agent || (!agent.usageLimitReturn && !agent.backupModels && !hxAutoModelStore.enabled(agentId)))\n"
              "      return null;\n")
    r.replace(service,
              "    if (!agent?.backupModels || (!agent.backupModels.automatic && !startedWork)) return undefined;\n",
              "    // HXBot: an agent on auto model with no backup models moves to the next model that fits its work.\n"
              "    if (agent && !agent.backupModels && hxAutoModelStore.enabled(agentId)) {\n"
              "      const next = hxAutoRouter.backup(agentId);\n"
              "      return next && this.#usageLimitReady(next) ? next : undefined;\n"
              "    }\n"
              "    if (!agent?.backupModels || (!agent.backupModels.automatic && !startedWork)) return undefined;\n")
    # 用户或别的智能体手动改了模型：这个智能体退出“自动”
    r.replace(service,
              "        this.#applyAgentUpdate(this.#withAccountModel(input), initiatingAgentId, null, queueWhileBusy),\n"
              "      )\n"
              "      .pipe(Effect.mapError((failure) => new AgentLifecycleFailed({ operation: \"updateAgent\", cause: failure.cause })));\n",
              "        this.#applyAgentUpdate(this.#withAccountModel(input), initiatingAgentId, null, queueWhileBusy),\n"
              "      )\n"
              "      .pipe(\n"
              "        // HXBot: a model that the user or another agent chose ends auto model for this agent (hx-auto-model).\n"
              "        Effect.tap(() =>\n"
              "          Effect.sync(() => {\n"
              "            if (input.model !== undefined || input.provider !== undefined) hxAutoRouter.manualChange(input.agentId);\n"
              "          }),\n"
              "        ),\n"
              "        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: \"updateAgent\", cause: failure.cause })),\n"
              "      );\n")
    r.replace(service,
              "  /**\n"
              "   * The model a usage limit or a provider error moves this agent to now, or null.",
              HOST +
              "  /**\n"
              "   * The model a usage limit or a provider error moves this agent to now, or null.")
    r.replace(service,
              '  "provider-error-ended": "status.agent.modelReturnedAfterError",\n} as const;\n',
              '  "provider-error-ended": "status.agent.modelReturnedAfterError",\n'
              '  auto: "status.agent.hxAuto.switched",\n'
              "} as const;\n")

    # 一轮结束：失败或说做不了，建议换更强的模型（额度用完的那一轮不算）
    turns = "src/backend/agent/turn-lifecycle.ts"
    brand_rename.add_import(r, turns, 'import { hxAutoRouter } from "../hx-auto-model/router";')
    r.replace(turns,
              "        this.#attention.clearForTurn(threadId, turnId);\n"
              "        if (this.#observedCompactions.get(threadId) === turnId) {\n",
              "        this.#attention.clearForTurn(threadId, turnId);\n"
              "        // HXBot: a turn of an agent on auto model that failed or gave up offers a stronger model (hx-auto-model).\n"
              "        if (!this.#limitedTurns.has(turnId)) hxAutoRouter.turnEnded(agentId, threadId, turnId, status);\n"
              "        if (this.#observedCompactions.get(threadId) === turnId) {\n")

    # 设置和记录放在数据文件夹里
    services = "src/main/application-services.ts"
    brand_rename.add_import(r, services, 'import { hxAutoModelStore } from "../backend/hx-auto-model/store";')
    r.replace(services, "  hxComputerWarmUp();\n",
              "  hxComputerWarmUp();\n"
              "  // HXBot: the auto model settings of each agent and the record of its choices (hx-auto-model).\n"
              '  hxAutoModelStore.open(join(app.getPath("userData"), "hx-auto-model"));\n')


def proposal(r) -> None:
    """建议卡：工具定义、默认可见、分发、给智能体的说明。"""
    definitions = "src/backend/openbot-tools.ts"
    brand_rename.add_import(r, definitions, 'import { HX_PROPOSAL_TOOL_DEFINITION } from "./hx-auto-model/proposal";')
    r.replace(definitions, "  ...HX_COMPUTER_TOOL_DEFINITIONS,\n",
              "  ...HX_COMPUTER_TOOL_DEFINITIONS,\n  HX_PROPOSAL_TOOL_DEFINITION,\n")
    r.replace("src/backend/agent/tool-catalog.ts", '  "computer_set",\n', '  "computer_set",\n  "propose_plan",\n')
    router = "src/backend/agent/openbot-tool-router.ts"
    brand_rename.add_import(r, router, 'import { HX_PROPOSAL_TOOL, hxProposalCard } from "../hx-auto-model/proposal";')
    brand_rename.add_import(r, router, 'import { hxAutoRouter } from "../hx-auto-model/router";')
    r.replace(router,
              '            if (toolRequest.params.tool === "acknowledge_request") {\n',
              "            // HXBot: the proposal card, with the model of each role (hx-auto-model). Like the plan card,\n"
              "            // it waits for a button, and an external chat cannot show it.\n"
              "            if (toolRequest.params.tool === HX_PROPOSAL_TOOL) {\n"
              "              const hxAgentId = this.#conversation.agentForThread(toolRequest.params.threadId);\n"
              "              const hxLinked =\n"
              "                hxAgentId !== undefined &&\n"
              "                this.#messaging.store.linkForThread(\n"
              "                  this.#conversation.publicThreadId(hxAgentId, toolRequest.params.threadId),\n"
              "                );\n"
              "              const hxCard = hxAgentId\n"
              "                ? hxLinked\n"
              '                  ? { error: "This chat cannot show the proposal card. Do not call it here; start the work." }\n'
              "                  : hxProposalCard(hxAutoRouter, hxAgentId, toolRequest.params.arguments)\n"
              '                : { error: "No agent owns this chat." };\n'
              '              if ("error" in hxCard) client.respond(toolRequest.id, hxBotToolFailure(hxCard.error));\n'
              "              else this.#attention.surfaceUiBlock(client, toolRequest, { blockId: randomUUID(), spec: hxCard.spec });\n"
              "              return;\n"
              "            }\n"
              '            if (toolRequest.params.tool === "acknowledge_request") {\n')
    instructions = "src/backend/agent/developer-instructions.ts"
    brand_rename.add_import(r, instructions, 'import { hxProposalInstruction } from "../hx-auto-model/proposal";')
    brand_rename.add_import(r, instructions, 'import { hxAutoRouter } from "../hx-auto-model/router";')
    r.replace(instructions,
              "    ...(options.memoriesInTurns\n",
              "    // HXBot: the proposal card, as the agent's setting says (hx-auto-model).\n"
              "    ...hxProposalInstruction(hxAutoRouter, agent.id),\n"
              "    ...(options.memoriesInTurns\n")


def plumbing(r) -> None:
    """智能体设置里的一节问主进程的两件事：读和改。接在电脑操控的三个请求后面。"""
    endpoints = "packages/contracts/src/ipc-endpoints.ts"
    brand_rename.add_import(
        r, endpoints, 'import type { HxAutoModelUpdate, HxAutoModelView } from "./hx-auto-model";')
    r.replace(endpoints,
              '    hxComputerSelfTest: request<undefined, HxSelfTestReport>()("auth:hx-computer-self-test"),\n',
              '    hxComputerSelfTest: request<undefined, HxSelfTestReport>()("auth:hx-computer-self-test"),\n'
              "    // HXBot: Agent settings → Auto model (hx-auto-model).\n"
              '    hxAutoModelView: request<string, HxAutoModelView>()("auth:hx-auto-model-view"),\n'
              '    hxAutoModelUpdate: request<HxAutoModelUpdate, HxAutoModelView>()("auth:hx-auto-model-update"),\n')
    handlers = "src/main/ipc/account-handlers.ts"
    brand_rename.add_import(r, handlers, 'import { hxAutoRouter } from "../../backend/hx-auto-model/router";')
    brand_rename.add_import(r, handlers, 'import { decodeHxAutoModelUpdate } from "@openbot/contracts/hx-auto-model";')
    r.replace(handlers,
              "      hxComputerSelfTest: handler(() => hxComputer.selfTest()),\n",
              "      hxComputerSelfTest: handler(() => hxComputer.selfTest()),\n"
              '      hxAutoModelView: payloadHandler(stringPayload("agentId", INPUT_LIMITS.identifier), (agentId) =>\n'
              "        hxAutoRouter.view(agentId),\n"
              "      ),\n"
              "      hxAutoModelUpdate: payloadHandler(decodeHxAutoModelUpdate, ({ agentId, settings }) => {\n"
              "        hxAutoRouter.store.setSettings(agentId, settings);\n"
              "        return hxAutoRouter.view(agentId);\n"
              "      }),\n")
    preload = "src/preload/index.ts"
    brand_rename.add_import(r, preload, 'import { decodeHxAutoModelView } from "@openbot/contracts/hx-auto-model";')
    r.replace(preload,
              "    hxComputerSelfTest: decodeHxSelfTestReport,\n",
              "    hxComputerSelfTest: decodeHxSelfTestReport,\n"
              "    hxAutoModelView: decodeHxAutoModelView,\n"
              "    hxAutoModelUpdate: decodeHxAutoModelView,\n")
    r.replace("src/renderer/src/features/account/account-port.ts",
              '    | "hxComputerSelfTest"\n',
              '    | "hxComputerSelfTest"\n    | "hxAutoModelView"\n    | "hxAutoModelUpdate"\n')
    r.replace("src/renderer/src/preview/mock-auth.ts",
              '      skipped: 0,\n      file: "",\n    }),\n',
              '      skipped: 0,\n      file: "",\n    }),\n'
              "    hxAutoModelView: async (agentId: string) => ({\n"
              "      agentId,\n"
              "      settings: HX_AUTO_DEFAULTS,\n"
              "      models: [],\n"
              "      preview: {},\n"
              "      freeQuota: { blockedUntil: null, usedToday: 0 },\n"
              "      decisions: [],\n"
              "    }),\n"
              "    hxAutoModelUpdate: async (input: HxAutoModelUpdate) => ({\n"
              "      agentId: input.agentId,\n"
              "      settings: input.settings,\n"
              "      models: [],\n"
              "      preview: {},\n"
              "      freeQuota: { blockedUntil: null, usedToday: 0 },\n"
              "      decisions: [],\n"
              "    }),\n")
    brand_rename.add_import(
        r, "src/renderer/src/preview/mock-auth.ts",
        'import { HX_AUTO_DEFAULTS, type HxAutoModelUpdate } from "@openbot/contracts/hx-auto-model";')
    # 智能体设置：放在“它知道什么”那一组的前面（只有这台电脑上的智能体）
    panel = "src/renderer/src/features/conversation/AgentSettingsPanel.tsx"
    brand_rename.add_import(r, panel, 'import { HxAutoModelSection } from "../agents/HxAutoModelSection";')
    r.replace(panel,
              "      links={\n"
              "        <>\n"
              "          <Show when={sessionSettings()}>\n",
              "      links={\n"
              "        <>\n"
              "          {/* HXBot: auto model and the proposal card, for an agent on this computer (hx-auto-model). */}\n"
              "          <Show when={props.localHost}>\n"
              "            <HxAutoModelSection agentId={props.agent.id} />\n"
              "          </Show>\n"
              "          <Show when={sessionSettings()}>\n")


def text(r) -> None:
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/status/agent.ts", "\n});\n", STATUS_EN)
    r.add_messages(f"{messages}/zh/status/agent.ts", "\n} as const satisfies", STATUS_ZH)
    r.add_messages(f"{messages}/en/settings.ts", "\n});\n", SETTINGS_EN)
    r.add_messages(f"{messages}/zh/settings.ts", "\n} as const satisfies", SETTINGS_ZH)


def apply(r) -> None:
    contracts(r)
    service(r)
    proposal(r)
    plumbing(r)
    text(r)
