"""HXBot 电脑操控（二）：打开应用后，按用户的要求自己列步骤，用鼠标和键盘一步步操作（v1.6.7）。

用户 2026-11-14：“打开电脑的应用后，一步步操作应用，控制鼠标和键盘，放在1.6.7的需求里！按照客户要求自己规划进行一步一步操作”。

HX 自己的文件：
- src/backend/hx-computer/driver.ts：HXBot 自己和 Computer Use 驱动说话的连接（同智能体一样经过主进程的转接，蓝框和光标照常跟着）
- src/backend/hx-computer/outline.ts：把窗口压成短提纲；按“类型 + 名字”找控件，拿不准时把候选交回模型
- src/backend/hx-computer/steps.ts：一步步执行（点击、输入、按键、组合键、滚动、拖动、菜单、等待），每步核对，
  先后台、再前台、再按位置；发送、付款、购买、删除、发布要用户先同意；用户按停止键后不再往下做
- src/backend/hx-computer/step-tools.ts：三个工具 computer_plan、computer_look、computer_do（都在工具目录里）
- src/main/hx-computer-stop.ts：停止键 Ctrl+Alt+Esc（Mac 上是 ⌃⌥Esc）

HX 自己的文件（进度卡，协作也用）：
- packages/contracts/src/hx-progress.ts：进度卡的文字格式（标题和清单，旧版客户端和手机端照样能读）
- src/backend/hx-progress/progress.ts：进度卡的消息
- src/renderer/src/features/conversation/hx-progress-plan.ts：对话里把进度卡画成任务清单（进度环、“几/共几”）

这里只做接线：
1. 智能体服务把驱动的地址和“在对话里放一张进度卡、原地更新”交给 hx-computer；
2. 智能体服务加一个“停止电脑操作”：停下 HXBot 自己的步骤，结束开着 Computer Use 的智能体正在进行的回合，并在对话里写一行；
3. 主进程登记停止键（index.ts，放在登记 IPC 之后）；
4. 进度卡：合同包导出 hx-progress；对话的消息投影把进度卡当成任务清单；
5. 界面文字。其他 13 种语言的译文在 hx/translations_v167.py。
（给智能体的说明写在 hx/computer_control.py 的 INSTRUCTION 里；工具的定义和分发跟着 computer_open 走，不用另接。）
"""

from __future__ import annotations

import brand_rename

STATUS_EN = {
    "status.agent.hxComputer.plan": "Work on this computer · {app} · {keys} stops it",
    "status.agent.hxComputer.stopped": "Work on this computer stopped: you pressed the stop keys.",
    # 协作的进度卡的标题（hx-team/service.ts 的 hxTeamCard）
    "status.agent.hxTeam.progress": "Team · handoffs {count}/{limit} · {minutes}/{max} min",
    # 驱动缺授权或没有启动时对话里的一行（hx-computer/driver-help.ts；用户 2026-11-14 “提前”）
    "status.agent.hxComputer.needBoth":
        "Computer Use needs two grants: Screen Recording and Accessibility. System Settings is open at the first one: "
        "turn on HXBot there, then the second. Ask again when both are on. Settings → Computer Use shows both.",
    "status.agent.hxComputer.needScreen":
        "Computer Use needs the Screen Recording grant. System Settings is open at that page: turn on HXBot there, "
        "then ask again. Settings → Computer Use shows it too.",
    "status.agent.hxComputer.needAccessibility":
        "Computer Use needs the Accessibility grant. System Settings is open at that page: turn on HXBot there, "
        "then ask again. Settings → Computer Use shows it too.",
    "status.agent.hxComputer.notRunning": "Computer Use is not running: {reason}. Settings → Computer Use shows why.",
}
STATUS_ZH = {
    "status.agent.hxComputer.plan": "电脑操作 · {app} · 按 {keys} 停止",
    "status.agent.hxComputer.stopped": "电脑操作已停止：你按了停止键。",
    "status.agent.hxTeam.progress": "协作 · 交接 {count}/{limit} · 用时 {minutes}/{max} 分钟",
    "status.agent.hxComputer.needBoth":
        "电脑操控还缺两项授权：屏幕录制和辅助功能。已打开系统设置里的第一项，请打开 HXBot 旁边的开关，再打开第二项；"
        "两项都打开后再说一次，就能接着做。也可以在“设置 → 电脑操控”里点“授权”。",
    "status.agent.hxComputer.needScreen":
        "电脑操控还缺“屏幕录制”授权。已打开系统设置里的这一页，请打开 HXBot 旁边的开关，然后再说一次。"
        "也可以在“设置 → 电脑操控”里点“授权”。",
    "status.agent.hxComputer.needAccessibility":
        "电脑操控还缺“辅助功能”授权。已打开系统设置里的这一页，请打开 HXBot 旁边的开关，然后再说一次。"
        "也可以在“设置 → 电脑操控”里点“授权”。",
    "status.agent.hxComputer.notRunning": "电脑操控没有运行：{reason}。在“设置 → 电脑操控”里可以看到原因。",
}
# 团队上限收成一行摘要（HxAutoModelSection.tsx）
SETTINGS_EN = {
    "settings.hxAutoModel.team.summary": "Teams: up to {members} members · {minutes} min · {rounds} handoffs",
    "settings.hxAutoModel.team.summaryDescription":
        "HXBot sizes each team by the work. To change the limits of one team, say so in the chat.",
    "settings.hxAutoModel.team.change": "Change the limits",
}
SETTINGS_ZH = {
    "settings.hxAutoModel.team.summary": "团队：最多 {members} 人 · {minutes} 分钟 · {rounds} 次交接",
    "settings.hxAutoModel.team.summaryDescription": "人数按工作自动定。想改某一次团队的上限，直接在对话里说，比如“这次最多 3 个人、1 小时”。",
    "settings.hxAutoModel.team.change": "调整上限",
}

METHODS = (
    "  /**\n"
    "   * HXBot: a progress card in an agent's chat (hx-progress), written again in place under its id as\n"
    "   * the work goes on. It never throws.\n"
    "   */\n"
    "  #hxProgress(agentId: string, id: string, card: HxProgressCard, stopped: boolean): void {\n"
    "    const database = this.#store.database;\n"
    "    try {\n"
    "      this.#conversation.withConversationTransaction(agentId, ({ threadId, snapshot }) => {\n"
    "        const at = snapshot.messages.findIndex((message) => message.id === id);\n"
    "        const earlier = at >= 0 ? snapshot.messages[at] : undefined;\n"
    "        const message = hxProgressMessage(id, card, stopped, earlier?.createdAt);\n"
    "        if (earlier) snapshot.messages[at] = message;\n"
    "        else {\n"
    "          snapshot.messages.push(message);\n"
    "          sortConversationMessages(snapshot.messages);\n"
    "        }\n"
    "        snapshot.revision = database.persistConversationChanges({\n"
    "          agentId,\n"
    "          threadId,\n"
    "          activeTurnId: snapshot.activeTurnId,\n"
    "          changedMessages: [message],\n"
    "          eventType: \"thread.hx-progress\",\n"
    "        });\n"
    "        return { result: undefined, snapshot };\n"
    "      });\n"
    "    } catch (error) {\n"
    "      this.#emitError(\"hx_progress_failed\", error, agentId);\n"
    "    }\n"
    "  }\n"
    "\n"
    "  /** HXBot: one small line in an agent's chat about its work on this computer (hx-computer). It never throws. */\n"
    "  #hxComputerNote(agentId: string, text: string): void {\n"
    "    try {\n"
    "      this.#appendSystemMessage(agentId, hxComputerLine(text), \"thread.computer-steps\");\n"
    "    } catch (error) {\n"
    "      this.#emitError(\"hx_computer_line_failed\", error, agentId);\n"
    "    }\n"
    "  }\n"
    "\n"
    "  /**\n"
    "   * HXBot: the user's stop keys (hx-computer). HXBot's own steps stop before the next one, and every\n"
    "   * turn of an agent with Computer Use on ends, as the Stop button of its chat ends it.\n"
    "   */\n"
    "  hxStopComputerWork(): Effect.Effect<void> {\n"
    "    hxComputer.stopAll();\n"
    "    const running = hxComputerAgentsToStop(this.#store.list()).flatMap((agentId) => {\n"
    "      const turnId = this.#conversation.workingSnapshot(agentId)?.activeTurnId;\n"
    "      return turnId ? [{ agentId, turnId }] : [];\n"
    "    });\n"
    "    return Effect.forEach(\n"
    "      running,\n"
    "      ({ agentId, turnId }) =>\n"
    "        this.interrupt(agentId, turnId).pipe(\n"
    "          Effect.catch((failure) => Effect.sync(() => this.#emitError(\"hx_computer_stop_failed\", failure, agentId))),\n"
    "          Effect.andThen(Effect.sync(() => this.#hxComputerNote(agentId, hxComputerStoppedText()))),\n"
    "        ),\n"
    "      { discard: true },\n"
    "    );\n"
    "  }\n"
    "\n"
)


def service(r) -> None:
    path = "src/backend/agent-service.ts"
    brand_rename.add_import(
        r, path,
        'import { hxComputer, hxComputerAgentsToStop, hxComputerLine, hxComputerStoppedText } from "./hx-computer/computer";')
    brand_rename.add_import(r, path, 'import { hxDriverAddress } from "./hx-computer/driver";')
    brand_rename.add_import(r, path, 'import { hxProgressMessage } from "./hx-progress/progress";')
    brand_rename.add_import(r, path, 'import type { HxProgressCard } from "@openbot/contracts/hx-progress";')
    # 放在“协作”那两行的前面：team.py 的改动是连着“自动选模型”那两行的，不能插在中间
    team = ("    // HXBot: teams of agents in a room, started from a proposal card (hx-team).\n"
            "    hxTeams.setPort(this.#hxTeamHost());\n")
    r.replace(path, team,
              "    // HXBot: the step tools of computer control reach the driver and the agent's chat (hx-computer).\n"
              "    hxComputer.setStepHost({\n"
              "      driverAddress: () => hxDriverAddress(computerUseMcpServer()),\n"
              "      progress: (agentId, id, card, stopped) => this.#hxProgress(agentId, id, card, stopped),\n"
              "      note: (agentId, text) => this.#hxComputerNote(agentId, text),\n"
              "    });\n" + team)
    # 同样放在 team.py 那一段（HOST）的前面
    team_host = "  /** HXBot: what the teams read and do (hx-team). Errors reach the team as readable errors. */\n"
    r.replace(path, team_host, METHODS + team_host)


def contracts(r) -> None:
    # 排在 hx-opencode 那一行之前：opencode_connect.py、auto_model.py、computer_control.py 都是在下一行之前插入的，
    # 插在它们中间会让它们第二遍再插一次
    opencode = '    "./hx-opencode": "./src/hx-opencode.ts",\n'
    r.replace("packages/contracts/package.json", opencode,
              '    "./hx-progress": "./src/hx-progress.ts",\n' + opencode)


def progress_card(r) -> None:
    """进度卡在对话里画成任务清单（features/conversation/hx-progress-plan.ts）。"""
    path = "src/renderer/src/app-message-projection.ts"
    brand_rename.add_import(r, path, 'import { hxProgressLive, hxProgressPlan } from "./features/conversation/hx-progress-plan";')
    r.replace(path,
              "function messagePlan(message: ConversationMessage): AgentMessagePlan | null {\n",
              "function messagePlan(message: ConversationMessage): AgentMessagePlan | null {\n"
              "  // HXBot: the progress card of a team or of work on this computer (hx-progress).\n"
              "  if (message.author === \"system\") return hxProgressPlan(message);\n")
    r.replace(path,
              "    createdAt: message.createdAt,\n    streaming: message.status === \"streaming\",\n",
              "    createdAt: message.createdAt,\n"
              "    // HXBot: a progress card whose work goes on shows its running step as running (hx-progress).\n"
              "    streaming: message.status === \"streaming\" || hxProgressLive(message),\n")


def stop_keys(r) -> None:
    index = "src/main/index.ts"
    brand_rename.add_import(r, index, 'import { hxRegisterComputerStop } from "./hx-computer-stop";')
    brand_rename.add_import(r, index, 'import { hxConnectComputerDriver } from "./hx-computer-driver";')
    anchor = "      registerIpcHandlers(built);\n"
    r.replace(index, anchor,
              anchor +
              "      // HXBot: the stop keys end the agents' work on this computer (hx-computer, v1.6.7). A local\n"
              "      // server child has no screen of its own to stop.\n"
              "      if (!localServerChild) hxRegisterComputerStop(() => void runCauseEffect(built.service.hxStopComputerWork()));\n"
              "      // HXBot: the step tools start the driver, or open the page of a missing grant (v1.6.7).\n"
              "      hxConnectComputerDriver({\n"
              "        driver: built.cuaDriver,\n"
              "        openExternal: (url) => shell.openExternal(url),\n"
              "        showSteps: (id) => runCauseEffect(built.computerUsePermissionHelp.show(id)),\n"
              # v1.7.0：通知用的文字（hx-ask-first.ts）
              "        translate: built.language.translate,\n"
              "      });\n")


def text(r) -> None:
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/status/agent.ts", "\n});\n", STATUS_EN)
    r.add_messages(f"{messages}/zh/status/agent.ts", "\n} as const satisfies", STATUS_ZH)
    r.add_messages(f"{messages}/en/settings.ts", "\n});\n", SETTINGS_EN)
    r.add_messages(f"{messages}/zh/settings.ts", "\n} as const satisfies", SETTINGS_ZH)


def apply(r) -> None:
    contracts(r)
    service(r)
    progress_card(r)
    stop_keys(r)
    text(r)
