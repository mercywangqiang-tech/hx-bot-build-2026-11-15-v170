"""HXBot v1.7.3 紧急修正（桌面端 0.67.13）。

用户 2026-11-19：
1. “无法检查更新，请重试”：“这个问题，要做到，边干活边更新，更新完，保存，然后重启！”
   查到的原因：服务器上没有 updates/desktop/latest-mac.yml（404，更新文件没上传），Mac 版把 404、401、500、断网
   都显示成同一句“无法检查更新，请重试”。
2. “还是在 mac 程序坞中出现第二个应用！”：本机服务器子进程用 HXBot 自己的程序启动，macOS 在启动的一刻就给它
   一个程序坞图标，v1.7.2 是之后再藏。
“紧急修正 V1.7.3，紧急上线！”

改法（HX 自己的代码在 src/main/hx-dock.ts、hx-updates.ts、hx-update-resume.ts，规则在 hx-update-policy.ts）：
1. Info.plist 写 LSUIElement：HXBot 的任何进程启动时都没有程序坞图标；桌面端在启动完成之前切回普通应用。
2. 更新请求的错误带状态码和代码，界面说清原因；网络失败经 Electron 的网络再试一次；401/403 先重新核对登录再试。
3. 任何时候找到的新版本都在后台装好；自动重启等助手空闲最多 10 分钟，等的时候新的定时任务先不开始；
   到时间还在忙也保存并重启，被打断的助手重启后收到“接着做”。
这里只做接线；界面文字的其他 13 种语言在 hx/translations_v173_hotfix.py。
"""

from __future__ import annotations

import brand_rename

INDEX = "src/main/index.ts"
SERVICES = "src/main/application-services.ts"
REQUESTED = "src/main/requested-update.ts"
UPDATE_SERVICE = "src/main/update-service.ts"
AGENT_SERVICE = "src/backend/agent-service.ts"

STATUS_EN = {
    "status.agent.hxUpdate.resume":
        "(Sent by HXBot) HXBot restarted to install an update and is now version {version}. The restart cut off your "
        "last turn: first check how far the work got, do not repeat a step that already changed something, then "
        "finish the rest.",
}
STATUS_ZH = {
    "status.agent.hxUpdate.resume":
        "（HXBot 自动发送）HXBot 为安装更新重启了，现在是 {version} 版。重启打断了你上一轮的工作：先看清做到了哪一步，"
        "已经改动过东西的步骤不要重复，再把剩下的做完。",
}
ERROR_EN = {
    "error.update.checkSignedOut":
        "The update server did not accept your sign-in. Sign in to HXBot again, then check for updates.",
}
ERROR_ZH = {
    "error.update.checkSignedOut": "更新服务没有认可你的登录。请重新登录 HXBot，再检查更新。",
}


def dock(r) -> None:
    """程序坞里只有一个 HXBot：本机服务器子进程从出生起就没有图标（src/main/hx-dock.ts 的 hxDesktopInDock）。"""
    r.replace("electron-builder.yml",
              "  extendInfo:\n"
              "    NSMicrophoneUsageDescription: HXBot uses the microphone to transcribe voice prompts locally on this Mac.\n",
              "  extendInfo:\n"
              "    # HXBot (v1.7.3 hotfix): no process of the bundle gets a Dock tile at launch, so a local server child never shows\n"
              "    # one. The desktop app makes itself a regular app before it finishes launching (src/main/hx-dock.ts).\n"
              "    LSUIElement: true\n"
              "    NSMicrophoneUsageDescription: HXBot uses the microphone to transcribe voice prompts locally on this Mac.\n")
    brand_rename.add_import(r, INDEX, 'import { hxDesktopInDock } from "./hx-desktop-dock";')
    r.replace(INDEX,
              'if (localServerChild && process.platform === "darwin") hxKeepOutOfDock(app);\n',
              'if (localServerChild && process.platform === "darwin") hxKeepOutOfDock(app);\n'
              "// HXBot (v1.7.3 hotfix): the bundle declares LSUIElement (electron-builder.yml), so a local server child never gets a\n"
              "// Dock tile, not even for a moment. This desktop app makes itself a regular app before it finishes launching.\n"
              'if (process.platform === "darwin" && !localServerChild && !serverMode && !hostedServer) hxDesktopInDock(app);\n')


def update_requests(r) -> None:
    """检查更新说清原因；网络失败经 Electron 的网络再试；401/403 先重新核对登录（src/main/hx-updates.ts）。"""
    r.replace(SERVICES, "  nativeImage,\n  powerMonitor,\n  screen,\n", "  nativeImage,\n  net,\n  powerMonitor,\n  screen,\n")
    r.replace(SERVICES,
              "  let updateAdapter: UpdateAdapter = createDisabledUpdateAdapter();\n",
              "  let updateAdapter: UpdateAdapter = createDisabledUpdateAdapter();\n"
              "  // HXBot (v1.7.3 hotfix): the update server refused the session: check the sign-in once (a refused one signs out).\n"
              "  const hxRefreshSession = () => Effect.runPromise(centralAuth.refreshProfile()).then(() => undefined);\n")
    # 更新器的两个新选项（netFetch、refreshSession）直接写在 hx/updates.py 接线的那一段里。
    r.replace(UPDATE_SERVICE,
              'const CHECK_NO_RELEASE_MESSAGE = sourceText("error.update.checkNoRelease");\n',
              'const CHECK_NO_RELEASE_MESSAGE = sourceText("error.update.checkNoRelease");\n'
              "// HXBot (v1.7.3 hotfix): the update server refused the sign-in, also after HXBot checked it once (hx-updates.ts).\n"
              'const CHECK_SIGNED_OUT_MESSAGE = sourceText("error.update.checkSignedOut");\n')
    r.replace(UPDATE_SERVICE,
              "    typeof error === \"object\" && error !== null && \"statusCode\" in error ? Number(error.statusCode) : Number.NaN;\n"
              "  if (status === 429 || status >= 500) return CHECK_SERVICE_MESSAGE;\n",
              "    typeof error === \"object\" && error !== null && \"statusCode\" in error ? Number(error.statusCode) : Number.NaN;\n"
              '  if (code === "HX_UPDATE_SIGNED_OUT" || status === 401 || status === 403) return CHECK_SIGNED_OUT_MESSAGE;\n'
              "  if (status === 429 || status >= 500) return CHECK_SERVICE_MESSAGE;\n")


def update_while_working(r) -> None:
    """边干活边更新：等助手空闲最多 10 分钟，到时间保存并重启，被打断的助手接着做（src/main/hx-update-resume.ts）。"""
    # 自动重启（src/main/requested-update.ts）
    r.replace(REQUESTED,
              "  /** HXBot: which updates install by themselves: found as HXBot opened, or required (hx-update-policy.ts). */\n"
              "  hxAutomaticOnlyIf?: () => boolean;\n",
              "  /** HXBot: which updates install by themselves: found as HXBot opened, or required (hx-update-policy.ts). */\n"
              "  hxAutomaticOnlyIf?: () => boolean;\n"
              "  /**\n"
              "   * HXBot (v1.7.3 hotfix): the longest the automatic restart waits for idle agents. Then it saves and restarts all the\n"
              "   * same (hx-update-resume.ts). It never restarts this way while HXBot starts or the updater works. Unset: no limit.\n"
              "   */\n"
              "  hxIdleWaitMs?: number;\n"
              "  /** HXBot (v1.7.3 hotfix): holds new routine runs while the automatic restart waits (true), lets them go (false). */\n"
              "  hxHoldRoutines?: (held: boolean) => void;\n"
              "  /** HXBot (v1.7.3 hotfix): told just before the automatic restart, with what still works (empty when idle). */\n"
              "  hxBeforeRestart?: (waitingFor: string[]) => void;\n"
              "  /** HXBot (v1.7.3 hotfix): the clock of the wait; a test passes its own. */\n"
              "  hxNow?: () => number;\n")
    r.replace(REQUESTED,
              "  readonly #hxAutomaticOnlyIf: () => boolean;\n",
              "  readonly #hxAutomaticOnlyIf: () => boolean;\n"
              "  readonly #hxIdleWaitMs: number | null;\n"
              "  readonly #hxHoldRoutines: (held: boolean) => void;\n"
              "  readonly #hxBeforeRestart: (waitingFor: string[]) => void;\n"
              "  readonly #hxNow: () => number;\n"
              "  /** HXBot (v1.7.3 hotfix): when the automatic restart began to wait, null while there is none. */\n"
              "  #hxAutomaticSince: number | null = null;\n")
    r.replace(REQUESTED,
              "    this.#hxAutomaticOnlyIf = options.hxAutomaticOnlyIf ?? (() => true);\n",
              "    this.#hxAutomaticOnlyIf = options.hxAutomaticOnlyIf ?? (() => true);\n"
              "    this.#hxIdleWaitMs = options.hxIdleWaitMs ?? null;\n"
              "    this.#hxHoldRoutines = options.hxHoldRoutines ?? (() => undefined);\n"
              "    this.#hxBeforeRestart = options.hxBeforeRestart ?? (() => undefined);\n"
              "    this.#hxNow = options.hxNow ?? Date.now;\n")
    r.replace(REQUESTED,
              "    this.#installError = null;\n"
              "    this.#declinedVersion = null;\n"
              "    this.#schedule = { memberId: member.id, requestedBy: member.name, mode, waitingFor: [] };\n",
              "    this.#installError = null;\n"
              "    this.#declinedVersion = null;\n"
              "    // HXBot (v1.7.3 hotfix): a member's restart replaces the automatic one, which held the routines.\n"
              "    this.#hxEndAutomaticWait();\n"
              "    this.#schedule = { memberId: member.id, requestedBy: member.name, mode, waitingFor: [] };\n")
    r.replace(REQUESTED,
              '      this.#schedule = { memberId: null, requestedBy: null, mode: "when-idle", waitingFor: [] };\n'
              "      this.#log(`Scheduled the automatic restart into ${status.availableVersion}.`);\n",
              '      this.#schedule = { memberId: null, requestedBy: null, mode: "when-idle", waitingFor: [] };\n'
              "      // HXBot (v1.7.3 hotfix): no new routine run starts while the restart waits, so that the agents come to idle.\n"
              "      this.#hxAutomaticSince = this.#hxNow();\n"
              "      this.#hxHoldRoutines(true);\n"
              "      this.#log(`Scheduled the automatic restart into ${status.availableVersion}.`);\n")
    r.replace(REQUESTED,
              '    if (!schedule || this.#updater.getStatus().phase !== "ready") return;\n'
              '    if (schedule.mode === "when-idle") {\n'
              "      const { safeToRestart, reasons } = this.#describeReadiness();\n",
              '    if (!schedule || this.#updater.getStatus().phase !== "ready") return;\n'
              "    // HXBot (v1.7.3 hotfix): what still works when the automatic restart goes ahead.\n"
              "    let hxCutOff: string[] = [];\n"
              '    if (schedule.mode === "when-idle") {\n'
              "      const { safeToRestart, reasons } = this.#describeReadiness();\n")
    r.replace(REQUESTED,
              "      if (!safeToRestart || clientUse) {\n"
              '        const waitingFor = [...new Set(clientUse ? [...reasons, "client-use"] : reasons)];\n'
              "        if (waitingFor.join() !== schedule.waitingFor.join()) {\n"
              "          schedule.waitingFor = waitingFor;\n"
              "          this.#publish();\n"
              "        }\n"
              "        this.#scheduleAttempt(this.#pollMs);\n"
              "        return;\n"
              "      }\n"
              "    }\n",
              "      if (!safeToRestart || clientUse) {\n"
              "        if (!this.#hxRestartsAnyway(schedule, clientUse, reasons)) {\n"
              '          const waitingFor = [...new Set(clientUse ? [...reasons, "client-use"] : reasons)];\n'
              "          if (waitingFor.join() !== schedule.waitingFor.join()) {\n"
              "            schedule.waitingFor = waitingFor;\n"
              "            this.#publish();\n"
              "          }\n"
              "          this.#scheduleAttempt(this.#pollMs);\n"
              "          return;\n"
              "        }\n"
              '        this.#log(`The automatic restart waited long enough for ${reasons.join(", ")}; it saves and restarts now.`);\n'
              "        hxCutOff = reasons;\n"
              "      }\n"
              "    }\n"
              "    // HXBot (v1.7.3 hotfix): the routines held and the agents cut off are saved for the next start (hx-update-resume.ts).\n"
              "    if (schedule.memberId === null) this.#hxBeforeRestart(hxCutOff);\n")
    r.replace(REQUESTED,
              "  #installsAutomatically(): boolean {",
              "  /**\n"
              "   * HXBot (v1.7.3 hotfix): the automatic restart has waited `hxIdleWaitMs` for the agents, and nothing that must not be\n"
              "   * cut off still runs: not the start of HXBot (database migrations), not the updater itself, and no client of a\n"
              "   * hosted server.\n"
              "   */\n"
              "  #hxRestartsAnyway(schedule: Schedule, clientUse: boolean, reasons: string[]): boolean {\n"
              "    if (schedule.memberId !== null || clientUse || this.#hxIdleWaitMs === null || this.#hxAutomaticSince === null)\n"
              "      return false;\n"
              '    if (reasons.includes("initialization") || reasons.includes("update-operation")) return false;\n'
              "    return this.#hxNow() - this.#hxAutomaticSince >= this.#hxIdleWaitMs;\n"
              "  }\n"
              "\n"
              "  /** HXBot (v1.7.3 hotfix): the automatic restart no longer waits: the routines go on. */\n"
              "  #hxEndAutomaticWait(): void {\n"
              "    if (this.#hxAutomaticSince === null) return;\n"
              "    this.#hxAutomaticSince = null;\n"
              "    this.#hxHoldRoutines(false);\n"
              "  }\n"
              "\n"
              "  #installsAutomatically(): boolean {")
    r.replace(REQUESTED,
              "  #clear(): void {\n"
              "    this.#clearTimer();\n"
              "    this.#schedule = null;\n",
              "  #clear(): void {\n"
              "    this.#clearTimer();\n"
              "    this.#schedule = null;\n"
              "    this.#hxEndAutomaticWait();\n")

    # 被打断的助手：谁在干活、给它发“接着做”（src/backend/agent-service.ts）
    r.replace(AGENT_SERVICE,
              "  hasActiveWork(): string[] {\n"
              "    const reasons: string[] = [];\n",
              "  /** HXBot (v1.7.3 hotfix): the agents whose own chat runs a turn now; an update restart cuts them off (hx-update-resume.ts). */\n"
              "  hxAgentsInTurn(): string[] {\n"
              "    const agents = new Set<string>();\n"
              "    for (const [agentId, snapshot] of this.#conversation.activeSnapshots()) {\n"
              "      if (snapshot.activeTurnId && !this.#conversation.isExecutionThread(snapshot.threadId)) agents.add(agentId);\n"
              "    }\n"
              "    return [...agents];\n"
              "  }\n"
              "\n"
              "  /**\n"
              "   * HXBot (v1.7.3 hotfix): tells an agent that the update restart cut its turn off. The message goes through the\n"
              "   * mailbox like a message of the user, as the continue of a parked computer step does. It never throws.\n"
              "   */\n"
              "  hxContinueAfterUpdate(agentId: string, text: string): Promise<void> {\n"
              "    return this.#hxComputerResume(agentId, text);\n"
              "  }\n"
              "\n"
              "  hasActiveWork(): string[] {\n"
              "    const reasons: string[] = [];\n")

    # 主进程：等的时候暂停定时任务、重启前记下被打断的助手、启动后让它们接着做
    brand_rename.add_import(r, SERVICES,
                            'import { HX_UPDATE_RESUME_FILE, HxUpdateRestartKeeper, hxContinueAfterUpdate } from "./hx-update-resume";')
    r.replace(SERVICES,
              '  const routineHoldFile = join(app.getPath("userData"), ROUTINE_HOLD_FILE);\n',
              '  const routineHoldFile = join(app.getPath("userData"), ROUTINE_HOLD_FILE);\n'
              "  // HXBot (v1.7.3 hotfix): the agents that an automatic update restart cut off (hx-update-resume.ts).\n"
              '  const hxUpdateResumeFile = join(app.getPath("userData"), HX_UPDATE_RESUME_FILE);\n')
    r.replace(SERVICES,
              "      yield* routineResultRuntime.recover();\n",
              "      yield* routineResultRuntime.recover();\n"
              "      // HXBot (v1.7.3 hotfix): the agents that an update restart cut off continue (hx-update-resume.ts).\n"
              "      void hxContinueAfterUpdate({\n"
              "        resumePath: hxUpdateResumeFile,\n"
              "        version: currentVersion,\n"
              "        agentExists: (agentId) => service.listAgents().some((agent) => agent.id === agentId),\n"
              "        continueAgent: (agentId, text) => service.hxContinueAfterUpdate(agentId, text),\n"
              "        log: (message) => logger.info(message),\n"
              "      });\n")
    r.replace(SERVICES,
              "  requestedUpdate = new RequestedUpdate({\n"
              "    updater,\n"
              "    describeReadiness: describeRestartReadiness,\n",
              "  // HXBot (v1.7.3 hotfix): while the automatic restart waits for the agents, no new routine run starts; it waits at most\n"
              "  // 10 minutes, then saves what it cuts off and restarts (hx-update-resume.ts).\n"
              "  const hxUpdateRestart = new HxUpdateRestartKeeper({\n"
              "    holdRoutines: () => service.holdRoutines(),\n"
              "    releaseRoutines: () => service.releaseRoutines(),\n"
              "    routineHoldPath: routineHoldFile,\n"
              "    resumePath: hxUpdateResumeFile,\n"
              "    agentsInTurn: () => service.hxAgentsInTurn(),\n"
              "    log: (message) => logger.info(message),\n"
              "  });\n"
              "  requestedUpdate = new RequestedUpdate({\n"
              "    updater,\n"
              "    describeReadiness: describeRestartReadiness,\n"
              "    hxIdleWaitMs: hxUpdateRestart.idleWaitMs,\n"
              "    hxHoldRoutines: (held) => hxUpdateRestart.hold(held),\n"
              "    hxBeforeRestart: (waitingFor) => hxUpdateRestart.beforeRestart(waitingFor),\n")


def text(r) -> None:
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/status/agent.ts", "\n});\n", STATUS_EN)
    r.add_messages(f"{messages}/zh/status/agent.ts", "\n} as const satisfies", STATUS_ZH)
    r.add_messages(f"{messages}/en/error/update.ts", "\n});\n", ERROR_EN)
    r.add_messages(f"{messages}/zh/error/update.ts", "\n} as const satisfies", ERROR_ZH)


def apply(r) -> None:
    dock(r)
    update_requests(r)
    update_while_working(r)
    text(r)
