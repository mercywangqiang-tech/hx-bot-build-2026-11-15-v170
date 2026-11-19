"""HXBot v1.7.3 电脑操控（五）：分道、礼让用户、停放后自动续做、读回核对（需求 CONC-05、CONC-06、CU-06、CU-01、CU-02）。

用户 2026-11-18：“继续开发新版本，还是需要无死角、全面、穷尽式全面测试、修正截止目前所有bug，包括新版可能再次产生的bug！”
范围：电脑操控（五）+ 全面排查修 bug。

HX 自己的文件（src/backend/hx-computer/）：
- lanes.ts      分道：只读不排队，app:<应用>（同一应用一次一个，全机最多 3 个），focus（前台全机一个），system（和 focus 互斥）
- presence.ts   你在不在用：系统空闲时间扣掉 HXBot 自己发的输入，锁屏
- gate.ts       每一步前台操作之前的门
- parked.ts     停放与自动续做，“现在做”“放弃”
- work.ts       一次调用拿道、过门、停放；system 道的工具
- park-setting.ts  设置“停放后自动续做”
- steps.ts、step-tools.ts  直接赋值输入、等待条件、三种核对、截图

这里只做接线：
1. 只留一个入口：开着 HXBot 电脑工具的电脑上（macOS、Windows）不再把原生驱动的 MCP 交给提供商（agentMcpServers）。
   工具列表一变，各提供商已有的会话会换成新会话（对话内容保留），只在这次升级时换一次，写进发版说明。
2. 停放的步骤续做：agent-service 经信箱给这个助手发一条“继续”（像你发的消息一样排队）。
3. 你给助手回复“现在做”“放弃”：在消息进信箱之前告诉 hx-computer。
4. 设置 → 电脑操控里的开关“停放后自动续做”：主进程多一个请求。
5. 界面文字（英文、中文在这里；其他 13 种语言在 hx/translations_v173.py）。
"""

from __future__ import annotations

import brand_rename

SERVICE = "src/backend/agent-service.ts"
SHAPES = "src/backend/mcp-provider-shapes.ts"

STATUS_EN = {
    "status.agent.hxComputer.parked":
        "Waiting for you: the step in {app} goes on when you have not used the keyboard or the mouse for {seconds} "
        "seconds and its window is in front. Reply “now” to have it done now, or “drop” to drop it.",
    "status.agent.hxComputer.parkedLocked":
        "Waiting for you: the screen is locked. The step in {app} goes on after you unlock it and its window is in "
        "front. Reply “now” to have it done now, or “drop” to drop it.",
    "status.agent.hxComputer.parkedLong":
        "The step in {app} has waited for 30 minutes. Reply “now” to have it done now, or “drop” to drop it.",
    "status.agent.hxComputer.resume":
        "(Sent by HXBot) The user has stopped, and {app} is in front: continue the parked step. Look at the window "
        "first, then do the {count} remaining steps. Ask the user before a send, a payment or a deletion, as always.",
}

STATUS_ZH = {
    "status.agent.hxComputer.parked":
        "等你停手：你停手 {seconds} 秒、{app} 的窗口在最前面时，接着做这一步。要马上做，回复“现在做”；不做了，回复“放弃”。",
    "status.agent.hxComputer.parkedLocked":
        "等你回来：屏幕锁着。解锁、{app} 的窗口在最前面时，接着做这一步。要马上做，回复“现在做”；不做了，回复“放弃”。",
    "status.agent.hxComputer.parkedLong": "{app} 的那一步已经等了 30 分钟。要马上做，回复“现在做”；不做了，回复“放弃”。",
    "status.agent.hxComputer.resume":
        "（HXBot 自动发送）用户已停手，{app} 在最前面：请接着做停放的那一步。先看一下窗口，再做剩下的 {count} 步；"
        "发送、付款、删除这类步骤照样先问用户。",
}

SETTINGS_EN = {
    "settings.hxComputer.autoResume.title": "Continue parked steps by themselves",
    "settings.hxComputer.autoResume.description":
        "While you use the computer, an agent parks a step that needs the keyboard or the mouse. With this on, the "
        "step goes on by itself after you stop for 5 seconds (60 for routines). With it off, only when you reply “now”.",
}

SETTINGS_ZH = {
    "settings.hxComputer.autoResume.title": "停放后自动续做",
    "settings.hxComputer.autoResume.description":
        "你在用电脑时，助手把要用键盘、鼠标的那一步停放下来。开着时，你停手 5 秒（定时任务 60 秒）后自动接着做；"
        "关掉后，只在你回复“现在做”时才做。",
}

# 停放的步骤续做时，agent-service 给这个助手发的那条消息：像你发的消息一样进信箱、排队（team.py 的 deliver 同样写法）
RESUME_METHOD = (
    "  /**\n"
    "   * HXBot (v1.7.3): the message that continues a parked step of computer control (hx-computer/parked.ts).\n"
    "   * It goes through the mailbox like a message of the user, and waits in the queue like one. It never throws.\n"
    "   */\n"
    "  async #hxComputerResume(agentId: string, text: string): Promise<void> {\n"
    "    try {\n"
    "      const receipt = await Effect.runPromise(\n"
    "        this.#mailbox.enqueue({\n"
    '          sender: { kind: "user" },\n'
    "          recipientAgentIds: [agentId],\n"
    "          text,\n"
    "          replyToMessageId: null,\n"
    "          idempotencyKey: `hx-computer-resume:${agentId}:${Date.now()}`,\n"
    "        }),\n"
    "      );\n"
    "      for (const delivery of receipt.deliveries) {\n"
    "        await Effect.runPromise(this.#steerAgentMessage(delivery.recipientAgentId, delivery.id));\n"
    "        this.#mailboxSync.emitQueue(delivery.recipientAgentId);\n"
    "        this.#drain.scheduleDrain(delivery.recipientAgentId);\n"
    "      }\n"
    "    } catch (error) {\n"
    '      this.#emitError("hx_computer_resume_failed", error, agentId);\n'
    "    }\n"
    "  }\n"
    "\n"
)


def one_entry(r) -> None:
    """CONC-05：只留一个入口。macOS、Windows 上（HXBot 电脑工具能用的系统）不再交出原生驱动。"""
    brand_rename.add_import(r, SHAPES, 'import { hxNativeDriverGiven } from "./hx-computer/one-entry";')
    r.replace(SHAPES,
              "/**\n"
              " * The configurations one agent is given: all of them, or all but Computer Use when the user turned\n"
              " * it off for that agent.\n"
              " */\n"
              "export function agentMcpServers(configs: readonly McpServerConfig[], computerUse: boolean): readonly McpServerConfig[] {\n"
              "  return computerUse ? configs : configs.filter((config) => config.id !== COMPUTER_USE_MCP_SERVER_ID);\n"
              "}\n",
              "/**\n"
              " * The configurations one agent is given: all of them, or all but Computer Use when the user turned\n"
              " * it off for that agent.\n"
              " *\n"
              " * HXBot (v1.7.3, CONC-05): where HXBot's own computer tools work (macOS, Windows), no agent gets the\n"
              " * native Computer Use driver: every action on this computer goes through HXBot's lanes, checks and\n"
              " * records (hx-computer). The tool list changes once with this version, so each provider starts a\n"
              " * new session once; the chat stays.\n"
              " */\n"
              "export function agentMcpServers(configs: readonly McpServerConfig[], computerUse: boolean): readonly McpServerConfig[] {\n"
              "  return computerUse && hxNativeDriverGiven()\n"
              "    ? configs\n"
              "    : configs.filter((config) => config.id !== COMPUTER_USE_MCP_SERVER_ID);\n"
              "}\n")


def resume(r) -> None:
    """CONC-06：停放的步骤续做时给助手发“继续”；你回复“现在做”“放弃”时告诉 hx-computer。"""
    # 放在 computer_steps.py 那一段（setStepHost）的前面，不插进它的中间
    step_host = "    // HXBot: the step tools of computer control reach the driver and the agent's chat (hx-computer).\n"
    r.replace(SERVICE, step_host,
              "    // HXBot (v1.7.3): a parked step of computer control goes on with a message to its agent (hx-computer).\n"
              "    hxComputer.setResumeHost((agentId, text) => this.#hxComputerResume(agentId, text));\n" + step_host)
    # 方法放在 computer_steps.py 的那几个方法（METHODS）的前面
    progress = ("  /**\n"
                "   * HXBot: a progress card in an agent's chat (hx-progress), written again in place under its id as\n")
    r.replace(SERVICE, progress, RESUME_METHOD + progress)
    r.replace(SERVICE,
              "    const validateRecipient = yield* lifecycleStep(\"prepare message delivery\", () =>\n"
              "      this.#mailbox.prepareDelivery([input.agentId]),\n"
              "    );\n",
              "    // HXBot (v1.7.3): “现在做” or “放弃” to an agent with a parked step of computer control (hx-computer).\n"
              "    hxComputer.userSaid(input.agentId, input.text);\n"
              "    const validateRecipient = yield* lifecycleStep(\"prepare message delivery\", () =>\n"
              "      this.#mailbox.prepareDelivery([input.agentId]),\n"
              "    );\n")


def auto_resume_setting(r) -> None:
    """设置 → 电脑操控的开关“停放后自动续做”：主进程多一个请求。接在 auto_model.py 那几行的后面。"""
    endpoints = "packages/contracts/src/ipc-endpoints.ts"
    r.replace(endpoints,
              '    hxAutoModelUpdate: request<HxAutoModelUpdate, HxAutoModelView>()("auth:hx-auto-model-update"),\n',
              '    hxAutoModelUpdate: request<HxAutoModelUpdate, HxAutoModelView>()("auth:hx-auto-model-update"),\n'
              "    // HXBot (v1.7.3): Settings → Computer Use, “停放后自动续做” (hx-computer).\n"
              '    hxComputerSetAutoResume: request<boolean, HxComputerStatus>()("auth:hx-computer-set-auto-resume"),\n')
    handlers = "src/main/ipc/account-handlers.ts"
    r.replace(handlers,
              "        hxAutoRouter.store.setSettings(agentId, settings);\n"
              "        return hxAutoRouter.view(agentId);\n"
              "      }),\n",
              "        hxAutoRouter.store.setSettings(agentId, settings);\n"
              "        return hxAutoRouter.view(agentId);\n"
              "      }),\n"
              "      hxComputerSetAutoResume: payloadHandler(\n"
              "        (value) => {\n"
              '          if (typeof value !== "boolean") throw new Error("A boolean is required.");\n'
              "          return value;\n"
              "        },\n"
              "        (on) => hxComputer.setAutoResume(on),\n"
              "      ),\n")
    preload = "src/preload/index.ts"
    r.replace(preload,
              "    hxAutoModelUpdate: decodeHxAutoModelView,\n",
              "    hxAutoModelUpdate: decodeHxAutoModelView,\n"
              "    hxComputerSetAutoResume: decodeHxComputerStatus,\n")
    r.replace("src/renderer/src/features/account/account-port.ts",
              '    | "hxAutoModelUpdate"\n',
              '    | "hxAutoModelUpdate"\n    | "hxComputerSetAutoResume"\n')
    r.replace("src/renderer/src/preview/mock-auth.ts",
              "    logout: async () => {\n"
              '      authState = { status: "signed_out" };\n',
              "    hxComputerSetAutoResume: async (on: boolean) => ({\n"
              "      platform: null,\n"
              "      builtAt: null,\n"
              "      apps: 0,\n"
              "      pages: 0,\n"
              "      settings: 0,\n"
              "      directSettings: 0,\n"
              "      disabled: [],\n"
              "      unchecked: 0,\n"
              "      autoResume: on,\n"
              "    }),\n"
              "    logout: async () => {\n"
              '      authState = { status: "signed_out" };\n')


def text(r) -> None:
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/status/agent.ts", "\n});\n", STATUS_EN)
    r.add_messages(f"{messages}/zh/status/agent.ts", "\n} as const satisfies", STATUS_ZH)
    r.add_messages(f"{messages}/en/settings.ts", "\n});\n", SETTINGS_EN)
    r.add_messages(f"{messages}/zh/settings.ts", "\n} as const satisfies", SETTINGS_ZH)


def apply(r) -> None:
    one_entry(r)
    resume(r)
    auto_resume_setting(r)
    text(r)
