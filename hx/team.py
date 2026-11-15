"""HXBot 协作（二）：多智能体无缝协作（v1.6.6）。

HX 自己的文件：
- src/backend/hx-team/：交接单（form.ts）、按专长选人（match.ts）、房间说明和简报（protocol.ts）、团队记录（store.ts）、
  四个工具的定义（tools.ts）、组队、看板、上限、结束和交回结果（service.ts）
- packages/contracts/src/hx-auto-model.ts：智能体设置里多了团队的上限（成员数、时间、交接次数、新建成员是否留下）
- src/renderer/src/features/agents/HxAutoModelSection.tsx：“建议卡”下面的团队上限
- src/backend/hx-auto-model/proposal.ts：建议卡上写明每个角色由谁来做；点“开始”后调用 start_team

这里只做接线：
1. 四个工具，都在工具目录里（start_team、team、team_board、team_done）。
2. 工具的分发：协作房间里的分派和转交先检查交接单和上限；四个工具交给 hx-team。
3. 智能体服务给 hx-team 的接口：读智能体、建成员、隐藏成员、建房间、改成员、往房间里发请求、停止和改派任务、
   把结果作为一条消息送到发起人的对话、在发起人的对话里写一行小字。
4. 每次频道有变化，hx-team 看一遍房间（进度的小字、上限、自动收尾）。
5. 团队记录放在数据文件夹里。
6. 界面文字。其他 13 种语言的译文在 hx/translations_v166.py。
"""

from __future__ import annotations

import brand_rename

STATUS_EN = {
    "status.agent.hxTeam.started": "Team started: {members}; {lead} leads. Progress comes back here.",
    "status.agent.hxTeam.assigned": "Team · {from} gave “{task}” to {to} (handoff {count} of {limit}).",
    "status.agent.hxTeam.transferred": "Team · {from} handed the whole task to {to} (handoff {count} of {limit}).",
    "status.agent.hxTeam.returned": "Team · {name} sent back a result ({done} of {steps} steps done).",
    "status.agent.hxTeam.failedOnce": "Team · {name} could not finish a piece of work; if it fails again, the team stops and asks you.",
    "status.agent.hxTeam.stuck": "Team · The work waits: a task stopped or failed. Continue it in the room, or tell me what to do.",
    "status.agent.hxTeam.done": "Team done in {minutes} min. The result follows.",
    "status.agent.hxTeam.stopped.user": "Team stopped at your request.",
    "status.agent.hxTeam.stopped.minutes": "Team stopped: it reached its limit of {minutes} minutes.",
    "status.agent.hxTeam.stopped.retry": "Team stopped: the same work failed twice.",
    "status.agent.hxTeam.stopped.room": "Team stopped: its room was archived or deleted.",
    "status.agent.hxTeam.stopped.cancelled": "Team stopped: its work was cancelled in the room.",
    "status.agent.hxTeam.rounds": "Team · It reached its limit of {limit} handoffs; the lead finishes with what it has.",
    "status.agent.hxTeam.message": "Team · Your words went to {name}.",
    "status.agent.hxTeam.swapped": "Team · {new} took over from {old}.",
    "status.agent.hxTeam.kept": "Team · The members made for it stay: {names}.",
    "status.agent.hxTeam.collapsed": "Team · The members made for it are hidden: {names}.",
}
STATUS_ZH = {
    "status.agent.hxTeam.started": "已组队：{members}，{lead} 带头。进度会回到这里。",
    "status.agent.hxTeam.assigned": "协作 · {from} 把“{task}”交给 {to}（第 {count}/{limit} 次交接）。",
    "status.agent.hxTeam.transferred": "协作 · {from} 把整件事转交给 {to}（第 {count}/{limit} 次交接）。",
    "status.agent.hxTeam.returned": "协作 · {name} 交回了结果（{done}/{steps} 步完成）。",
    "status.agent.hxTeam.failedOnce": "协作 · {name} 有一件工作没做成；同一件工作再失败一次，团队就停下来问你。",
    "status.agent.hxTeam.stuck": "协作 · 工作停住了：有任务被停止或失败。可以在协作房间里继续，或者告诉我怎么办。",
    "status.agent.hxTeam.done": "协作完成，用时 {minutes} 分钟。结果在下一条消息里。",
    "status.agent.hxTeam.stopped.user": "协作已按你的要求停止。",
    "status.agent.hxTeam.stopped.minutes": "协作停下了：到了 {minutes} 分钟的上限。",
    "status.agent.hxTeam.stopped.retry": "协作停下了：同一件工作失败了两次。",
    "status.agent.hxTeam.stopped.room": "协作停下了：协作房间被归档或删除了。",
    "status.agent.hxTeam.stopped.cancelled": "协作停下了：房间里的工作被取消了。",
    "status.agent.hxTeam.rounds": "协作 · 到了 {limit} 次交接的上限，由带头的用已有的结果收尾。",
    "status.agent.hxTeam.message": "协作 · 你的话已转给 {name}。",
    "status.agent.hxTeam.swapped": "协作 · {old} 换成了 {new}。",
    "status.agent.hxTeam.kept": "协作 · 为它新建的成员已留下：{names}。",
    "status.agent.hxTeam.collapsed": "协作 · 为它新建的成员已收起：{names}（可在隐藏的智能体里恢复）。",
}

SETTINGS_EN = {
    "settings.hxAutoModel.team.members": "Team members at most",
    "settings.hxAutoModel.team.minutes": "Longest team time",
    "settings.hxAutoModel.team.minuteValue": "{count} min",
    "settings.hxAutoModel.team.rounds": "Handoffs at most",
    "settings.hxAutoModel.team.temporary": "Members made for a team",
    "settings.hxAutoModel.team.temporary.collapse": "Hide when the team ends",
    "settings.hxAutoModel.team.temporary.keep": "Keep",
    "settings.hxAutoModel.team.description":
        "Start on a card with several roles makes a team: HXBot picks agents by skill, makes members for missing "
        "roles and opens a team room. Progress and the result come back to this chat. At a limit, the team stops "
        "and asks you.",
}
SETTINGS_ZH = {
    "settings.hxAutoModel.team.members": "团队成员最多",
    "settings.hxAutoModel.team.minutes": "团队最长时间",
    "settings.hxAutoModel.team.minuteValue": "{count} 分钟",
    "settings.hxAutoModel.team.rounds": "交接最多",
    "settings.hxAutoModel.team.temporary": "为团队新建的成员",
    "settings.hxAutoModel.team.temporary.collapse": "团队结束后收起",
    "settings.hxAutoModel.team.temporary.keep": "留下",
    "settings.hxAutoModel.team.description":
        "在有几个角色的建议卡上点“开始”就组队：HXBot 按专长选智能体，缺的角色新建成员，开一个协作房间。"
        "进度和结果回到这个对话。到了上限，团队停下来问你。",
}


def tools(r) -> None:
    """四个工具的定义。都放在工具目录里（不是每次对话都发），智能体照说明用 tool_call 调用，每次对话的字节数不增加。"""
    definitions = "src/backend/openbot-tools.ts"
    brand_rename.add_import(r, definitions, 'import { HX_TEAM_TOOL_DEFINITIONS } from "./hx-team/tools";')
    r.replace(definitions,
              "  ...HX_COMPUTER_TOOL_DEFINITIONS,\n  HX_PROPOSAL_TOOL_DEFINITION,\n",
              "  ...HX_COMPUTER_TOOL_DEFINITIONS,\n  HX_PROPOSAL_TOOL_DEFINITION,\n  ...HX_TEAM_TOOL_DEFINITIONS,\n")


ROUTER = (
    "    const channelId = this.#channels.store.channelForThread(executionThreadId);\n"
    "    // HXBot: teams (hx-team). In a team room, a handoff is a handoff form within the team's limits.\n"
    "    if (channelId) {\n"
    "      const hxRefusal = hxTeams.checkHandoff(channelId, params.tool, params.arguments);\n"
    "      if (hxRefusal) return openBotToolFailure(hxRefusal);\n"
    "    }\n"
    "    if (HX_TEAM_TOOL_NAMES.has(params.tool)) {\n"
    "      const hxCall = {\n"
    "        tool: params.tool,\n"
    "        arguments: params.arguments,\n"
    "        agentId: senderAgentId,\n"
    "        key: toolCallIdempotencyKey(params),\n"
    "        roomId: channelId,\n"
    "        byPerson: !channelId && this.#requestedByPerson(senderAgentId, params.turnId, executionThreadId),\n"
    "      };\n"
    "      return yield* Effect.promise(() => hxTeams.call(hxCall));\n"
    "    }\n"
)


def router(r) -> None:
    path = "src/backend/agent/openbot-tool-router.ts"
    brand_rename.add_import(r, path, 'import { hxTeams } from "../hx-team/service";')
    brand_rename.add_import(r, path, 'import { HX_TEAM_TOOL_NAMES } from "../hx-team/tools";')
    r.replace(path, "    const channelId = this.#channels.store.channelForThread(executionThreadId);\n", ROUTER)


# 智能体服务给 hx-team 的接口
HOST = (
    "  /** HXBot: what the teams read and do (hx-team). Errors reach the team as readable errors. */\n"
    "  #hxTeamHost(): HxTeamPort {\n"
    "    const run = <A>(effect: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> =>\n"
    "      Effect.runPromise(\n"
    "        effect.pipe(\n"
    "          Effect.mapError((failure) =>\n"
    "            failure.cause instanceof Error ? failure.cause : new Error(String(failure.cause)),\n"
    "          ),\n"
    "        ),\n"
    "      );\n"
    "    const agentOf = (agentId: string) => this.listAgents().find((agent) => agent.id === agentId);\n"
    "    return {\n"
    "      agents: () =>\n"
    "        this.listAgents().map((agent) => ({\n"
    "          id: agent.id,\n"
    "          name: agent.name,\n"
    "          title: agent.title,\n"
    "          description: agent.description,\n"
    "          hidden: agent.hiddenAt !== undefined,\n"
    "          busy: Boolean(\n"
    "            this.#conversation.workingSnapshot(agent.id)?.activeTurnId || this.#mailbox.nextQueued(agent.id),\n"
    "          ),\n"
    "          workspacePath: agent.workspacePath,\n"
    "          model: agent.model,\n"
    "          computerUse: agent.computerUse !== false,\n"
    "        })),\n"
    "      settings: (agentId) => hxAutoModelStore.settings(agentId),\n"
    "      roleModel: (agentId, role) => hxAutoRouter.roleModel(agentId, role),\n"
    "      createAgent: async (input) => {\n"
    "        const starter = agentOf(input.starterAgentId);\n"
    "        const agent = await run(\n"
    "          this.createAgentProfile({\n"
    "            name: input.name,\n"
    "            title: input.title,\n"
    "            description: input.description,\n"
    "            avatarSeed: randomUUID(),\n"
    "            avatarHue: null,\n"
    "            ...(input.model\n"
    "              ? {\n"
    "                  provider: input.model.provider,\n"
    "                  model: input.model.model,\n"
    "                  ...(input.model.providerAccountId ? { providerAccountId: input.model.providerAccountId } : {}),\n"
    "                }\n"
    "              : starter\n"
    "                ? { provider: starter.provider, model: starter.model }\n"
    "                : {}),\n"
    "          }),\n"
    "        );\n"
    "        // A member gets no more than the starter: its Workspace only access and its Computer Use setting.\n"
    "        const limits = {\n"
    "          ...(starter && workspaceAccessEnforced(starter) ? { access: \"workspace\" as const } : {}),\n"
    "          ...(starter?.computerUse === false ? { computerUse: false } : {}),\n"
    "        };\n"
    "        if (Object.keys(limits).length > 0) await run(this.updateAgent({ agentId: agent.id, ...limits }));\n"
    "        return { id: agent.id, name: agent.name };\n"
    "      },\n"
    "      setHidden: (agentId, hidden) => run(this.setAgentHidden({ agentId, hidden })).then(() => undefined),\n"
    "      createRoom: (input) =>\n"
    "        run(\n"
    "          this.channels.agentSave(\n"
    "            { channelId: input.channelId, operationId: input.operationId, agentId: input.starterAgentId, create: true },\n"
    "            () => ({\n"
    "              name: input.name,\n"
    "              title: input.title,\n"
    "              instructions: input.instructions,\n"
    "              members: input.memberIds.map((agentId) => ({ agentId })),\n"
    "              leadAgentId: input.leadAgentId,\n"
    "              icon: { name: \"workflow\", hue: input.hue },\n"
    "            }),\n"
    "          ),\n"
    "        ).then(() => undefined),\n"
    "      changeMembers: (input) =>\n"
    "        run(\n"
    "          this.channels.agentSave(\n"
    "            { channelId: input.channelId, operationId: input.operationId, agentId: input.actorAgentId, create: false },\n"
    "            (stored) => {\n"
    "              if (!stored) throw new Error(\"The team room no longer exists.\");\n"
    "              const removed = new Set(input.remove);\n"
    "              const members = [\n"
    "                ...stored.members.filter((member) => !removed.has(member.agentId)),\n"
    "                ...input.add\n"
    "                  .filter((agentId) => !stored.members.some((member) => member.agentId === agentId))\n"
    "                  .map((agentId) => ({ agentId })),\n"
    "              ];\n"
    "              const lead = input.leadAgentId ?? stored.leadAgentId;\n"
    "              return {\n"
    "                name: stored.name,\n"
    "                title: stored.title,\n"
    "                instructions: stored.instructions,\n"
    "                members,\n"
    "                leadAgentId: lead && members.some((member) => member.agentId === lead) ? lead : null,\n"
    "              };\n"
    "            },\n"
    "          ),\n"
    "        ).then(() => undefined),\n"
    "      post: (input) =>\n"
    "        run(\n"
    "          this.channels.handoff({\n"
    "            operationId: input.operationId,\n"
    "            channelId: input.channelId,\n"
    "            senderAgentId: input.fromAgentId,\n"
    "            text: input.text,\n"
    "            recipientAgentIds: input.toAgentIds,\n"
    "            sourcePaths: input.paths,\n"
    "          }),\n"
    "        ).then(() => undefined),\n"
    "      room: (channelId) => {\n"
    "        const store = this.channels.store;\n"
    "        if (!store.exists(channelId)) return { exists: false, archived: false, tasks: [], messages: [] };\n"
    "        return {\n"
    "          exists: true,\n"
    "          archived: store.get(channelId).archived,\n"
    "          tasks: store.tasks(channelId),\n"
    "          messages: store.messages(channelId, Number.MAX_SAFE_INTEGER, 60),\n"
    "        };\n"
    "      },\n"
    "      command: (input) =>\n"
    "        run(\n"
    "          this.channels.command(\n"
    "            {\n"
    "              type: input.type,\n"
    "              operationId: input.operationId,\n"
    "              channelId: input.channelId,\n"
    "              taskId: input.taskId,\n"
    "              recipientAgentId: input.recipientAgentId,\n"
    "            },\n"
    "            this.channels.agentActor(input.actorAgentId),\n"
    "          ),\n"
    "        ).then(() => undefined),\n"
    "      deliver: async (input) => {\n"
    "        const receipt = await run(\n"
    "          this.#mailbox.enqueue({\n"
    "            sender: { kind: \"agent\", agentId: input.fromAgentId },\n"
    "            recipientAgentIds: [input.toAgentId],\n"
    "            text: input.text,\n"
    "            replyToMessageId: null,\n"
    "            expectsReply: false,\n"
    "            idempotencyKey: input.key,\n"
    "          }),\n"
    "        );\n"
    "        for (const delivery of receipt.deliveries) {\n"
    "          await Effect.runPromise(this.#steerAgentMessage(delivery.recipientAgentId, delivery.id));\n"
    "          this.#mailboxSync.emitQueue(delivery.recipientAgentId);\n"
    "          this.#drain.scheduleDrain(delivery.recipientAgentId);\n"
    "        }\n"
    "      },\n"
    "      progress: (agentId, id, card, stopped) => this.#hxProgress(agentId, id, card, stopped),\n"
    "      note: (agentId, text) => {\n"
    "        try {\n"
    "          this.#appendSystemMessage(agentId, hxTeamLine(text), \"thread.team-progress\");\n"
    "        } catch (error) {\n"
    "          this.#emitError(\"hx_team_line_failed\", error, agentId);\n"
    "        }\n"
    "      },\n"
    "      error: (code, error) => this.#emitError(code, error),\n"
    "    };\n"
    "  }\n"
    "\n"
)


def service(r) -> None:
    path = "src/backend/agent-service.ts"
    brand_rename.add_import(r, path, 'import { type HxTeamPort, hxTeamLine, hxTeams } from "./hx-team/service";')
    # 放在“自动选模型”那两行的前面：auto_model.py 的改动是连着 this.#drain 那一行的，不能插在中间
    auto = ("    // HXBot: an agent on auto model chooses its model before each new piece of work (hx-auto-model).\n"
            "    hxAutoRouter.setHost(this.#hxAutoHost());\n")
    r.replace(path, auto,
              "    // HXBot: teams of agents in a room, started from a proposal card (hx-team).\n"
              "    hxTeams.setPort(this.#hxTeamHost());\n" + auto)
    r.replace(path, '        this.#emit({ type: "channels-changed", channelId, revision });\n',
              '        this.#emit({ type: "channels-changed", channelId, revision });\n'
              "        // HXBot: a change of a team room moves the team on (hx-team). It never throws.\n"
              "        hxTeams.changed(channelId);\n")
    r.replace(path, "  /** HXBot: what the auto model router reads and does (hx-auto-model). */\n",
              HOST + "  /** HXBot: what the auto model router reads and does (hx-auto-model). */\n")
    services = "src/main/application-services.ts"
    brand_rename.add_import(r, services, 'import { hxTeams } from "../backend/hx-team/service";')
    # 接在 OpenCode 那一行后面（opencode_connect.py 也接在“自动选模型”那一行后面，两步不能用同一个位置）
    r.replace(services, '  hxOpenCodeNames.open(join(app.getPath("userData"), "hx-opencode"));\n',
              '  hxOpenCodeNames.open(join(app.getPath("userData"), "hx-opencode"));\n'
              "  // HXBot: the record of each team, and the deadlines of the teams that still work (hx-team).\n"
              '  hxTeams.open(join(app.getPath("userData"), "hx-team"));\n')


def text(r) -> None:
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/status/agent.ts", "\n});\n", STATUS_EN)
    r.add_messages(f"{messages}/zh/status/agent.ts", "\n} as const satisfies", STATUS_ZH)
    r.add_messages(f"{messages}/en/settings.ts", "\n});\n", SETTINGS_EN)
    r.add_messages(f"{messages}/zh/settings.ts", "\n} as const satisfies", SETTINGS_ZH)


def apply(r) -> None:
    tools(r)
    router(r)
    service(r)
    text(r)
