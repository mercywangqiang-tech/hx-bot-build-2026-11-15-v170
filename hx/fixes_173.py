"""HXBot v1.7.3：全面排查修 bug（用户 2026-11-18：“修正截止目前所有bug，包括新版可能再次产生的bug！”）。

这一步改上游文件，只做接线；HX 自己的代码在各自的 hx-*.ts 里。电脑操控（五）的接线在 hx/computer_v173.py。
"""

from __future__ import annotations

import brand_rename

AUTH = "apps/auth-api/src/server/auth-service.ts"
SLOTS = "src/backend/agent/turn-slots.ts"
DRAIN = "src/backend/agent/drain-scheduler.ts"
CONVERSATION = "src/backend/agent/conversation-runtime.ts"
SERVICE = "src/backend/agent-service.ts"
BOOT = "src/backend/agent/boot-recovery.ts"
CHANNEL_SERVICE = "src/backend/channel-service.ts"


def office_sign_in(r) -> None:
    """一个公司的人从同一个出口地址登录：15 分钟里第 21 个人就被“登录太频繁”挡住。

    账号服务按来源地址限流（15 分钟里开始登录 20 次、核对 30 次）。HXBot 是一个公司自己的服务器，办公室里的人
    经同一个出口地址上网，早上大家一起登录时，从第 21 个人起都要等到这 15 分钟过去（v1.7.3 的压力测试发现）。
    按来源地址的上限提到 100 次、150 次；按邮箱的上限（每个账号 15 分钟 5 次）不变，猜某一个账号的密码照样被挡住。
    """
    r.replace(AUTH,
              "      yield* this.#enforceRateLimit(`start:ip:${normalizeSourceIp(sourceIp)}`, 20, now);\n",
              "      // HXBot (v1.7.3): the people of an office sign in from one address; each account keeps its own limit.\n"
              "      yield* this.#enforceRateLimit(`start:ip:${normalizeSourceIp(sourceIp)}`, 100, now);\n")
    r.replace(AUTH,
              "    yield* this.#enforceRateLimit(`verify:ip:${normalizeSourceIp(input.sourceIp)}`, 30, now);\n",
              "    // HXBot (v1.7.3): as for the start, an office signs in from one address.\n"
              "    yield* this.#enforceRateLimit(`verify:ip:${normalizeSourceIp(input.sourceIp)}`, 150, now);\n")


def slot_pass(r) -> None:
    """排队检查一遍只读每条线路一次（src/backend/hx-flow/slot-pass.ts）。

    一个用了很久的资料夹（250 MB 的数据库）启动时主进程卡住 15 秒：retrySlotWaiters 对每条等着的线路问一次
    TurnSlots.mayStart，每问一次都把全部线路的“在不在跑”“在不在等”重新读一遍（v1.7.3 的压力测试查出）。
    """
    brand_rename.add_import(r, SLOTS, 'import { HxSlotPass } from "../hx-flow/slot-pass";')
    r.replace(SLOTS,
              "  readonly #options: TurnSlotsOptions;\n"
              "\n"
              "  constructor(options: TurnSlotsOptions) {\n"
              "    this.#options = options;\n"
              "  }\n",
              "  readonly #options: TurnSlotsOptions;\n"
              "  /** HXBot (v1.7.3): the reads of one pass over the waiting lanes (src/backend/hx-flow/slot-pass.ts). */\n"
              "  readonly #pass = new HxSlotPass();\n"
              "\n"
              "  constructor(options: TurnSlotsOptions) {\n"
              "    this.#options = this.#pass.wrap(options);\n"
              "  }\n"
              "\n"
              "  /** HXBot (v1.7.3): checks several lanes in one pass, and reads each lane once in it. */\n"
              "  batch<T>(body: () => T): T {\n"
              "    return this.#pass.run(body);\n"
              "  }\n")
    r.replace(SLOTS,
              "  batch<T>(body: () => T): T {\n"
              "    return this.#pass.run(body);\n"
              "  }\n",
              "  batch<T>(body: () => T): T {\n"
              "    return this.#pass.run(body);\n"
              "  }\n"
              "\n"
              "  /** HXBot (v1.7.3): a read of the scheduler kept for the length of a pass (`batch`). */\n"
              "  memo<V>(): (key: string, read: () => V) => V {\n"
              "    return this.#pass.memo<V>();\n"
              "  }\n")
    # In a pass, each agent's lanes (SQLite) and the list of agents are read once, not once per lane.
    r.replace(DRAIN,
              "  readonly #drainingLanes = new Set<string>();\n",
              "  readonly #drainingLanes = new Set<string>();\n"
              "  /** HXBot (v1.7.3): reads kept for one pass over the waiting lanes (src/backend/hx-flow/slot-pass.ts). */\n"
              "  #hxLanes: ((key: string, read: () => Lane[]) => Lane[]) | null = null;\n"
              "  #hxAgents: ((key: string, read: () => AgentSummary[]) => AgentSummary[]) | null = null;\n"
              "  #hxRunning: ((key: string, read: () => boolean) => boolean) | null = null;\n"
              "  #hxHeld: ((key: string, read: () => string | null) => string | null) | null = null;\n"
              "  #hxRetry: ReturnType<typeof setImmediate> | null = null;\n")
    r.replace(DRAIN,
              "  #lanesOf(agentId: string): Lane[] {\n"
              "    return [mainLane(agentId), ...this.#tasks.openTaskIds(agentId).map((taskId) => ({ agentId, taskId }))];\n"
              "  }\n",
              "  #lanesOf(agentId: string): Lane[] {\n"
              "    // HXBot (v1.7.3): each read asks SQLite; in a pass over the waiting lanes it is read once per agent.\n"
              "    this.#hxLanes ??= this.#slots.memo<Lane[]>();\n"
              "    return this.#hxLanes(agentId, () => [\n"
              "      mainLane(agentId),\n"
              "      ...this.#tasks.openTaskIds(agentId).map((taskId) => ({ agentId, taskId })),\n"
              "    ]);\n"
              "  }\n")
    r.replace(DRAIN,
              "  #laneRunning(lane: Lane): boolean {\n"
              "    return (\n"
              "      this.#drainingLanes.has(laneKey(lane)) ||\n"
              "      this.#laneTurnActive(lane) ||\n"
              "      this.#mailbox.laneActive(lane.agentId, lane.taskId)\n"
              "    );\n"
              "  }\n",
              "  #laneRunning(lane: Lane): boolean {\n"
              "    // HXBot (v1.7.3): asked for each lane of an agent by each of its lanes; once per pass.\n"
              "    this.#hxRunning ??= this.#slots.memo<boolean>();\n"
              "    return this.#hxRunning(\n"
              "      laneKey(lane),\n"
              "      () =>\n"
              "        this.#drainingLanes.has(laneKey(lane)) ||\n"
              "        this.#laneTurnActive(lane) ||\n"
              "        this.#mailbox.laneActive(lane.agentId, lane.taskId),\n"
              "    );\n"
              "  }\n")
    r.replace(DRAIN,
              "    // The agent's own process restarts when its access or account changed. A turn of another lane\n"
              "    // runs on it, so this lane waits for that turn to end.\n"
              "    const agent = this.#store.list().find((candidate) => candidate.id === agentId);\n",
              "    // The agent's own process restarts when its access or account changed. A turn of another lane\n"
              "    // runs on it, so this lane waits for that turn to end.\n"
              "    // HXBot (v1.7.3): the list copies every agent; in a pass it is read once.\n"
              "    this.#hxAgents ??= this.#slots.memo<AgentSummary[]>();\n"
              "    const agent = this.#hxAgents(\"agents\", () => this.#store.list()).find((candidate) => candidate.id === agentId);\n")
    r.replace(DRAIN,
              "  /** The first clause of `mayDrain` that holds this lane, or null when none does. */\n"
              "  #heldBy(lane: Lane): string | null {\n",
              "  /**\n"
              "   * The first clause of `mayDrain` that holds this lane, or null when none does.\n"
              "   * HXBot (v1.7.3): a pass over the waiting lanes asks it for each lane two or three times (the\n"
              "   * schedule, the slot check, the drain of the agent's chat); in a pass it is read once.\n"
              "   */\n"
              "  #heldBy(lane: Lane): string | null {\n"
              "    this.#hxHeld ??= this.#slots.memo<string | null>();\n"
              "    return this.#hxHeld(laneKey(lane), () => this.#hxHeldNow(lane));\n"
              "  }\n"
              "\n"
              "  #hxHeldNow(lane: Lane): string | null {\n")
    r.replace(DRAIN,
              "  retrySlotWaiters(): void {\n"
              "    if (this.#wakingSlotWaiters || this.#slotWaiters.size === 0) return;\n"
              "    this.#wakingSlotWaiters = true;\n",
              "  retrySlotWaiters(): void {\n"
              "    if (this.#wakingSlotWaiters || this.#slotWaiters.size === 0) return;\n"
              "    // HXBot (v1.7.3): the ends and schedules of one burst try the waiting lanes once, on the next turn\n"
              "    // of the event loop. Each try reads every lane, and twenty tries in a row held the main process\n"
              "    // for 1.7 s in the stress test with an aged profile.\n"
              "    this.#hxRetry ??= setImmediate(() => {\n"
              "      this.#hxRetry = null;\n"
              "      this.#hxRetrySlotWaiters();\n"
              "    });\n"
              "  }\n"
              "\n"
              "  #hxRetrySlotWaiters(): void {\n"
              "    if (this.#wakingSlotWaiters || this.#slotWaiters.size === 0) return;\n"
              "    this.#wakingSlotWaiters = true;\n")
    r.replace(DRAIN,
              "  dispose(): void {\n"
              "    this.#drainingLanes.clear();\n",
              "  dispose(): void {\n"
              "    if (this.#hxRetry) clearImmediate(this.#hxRetry);\n"
              "    this.#hxRetry = null;\n"
              "    this.#drainingLanes.clear();\n")
    r.replace(DRAIN,
              "      for (const key of waiters) this.#scheduleLane(laneOf(key));\n",
              "      // HXBot (v1.7.3): one pass reads each lane once (src/backend/hx-flow/slot-pass.ts).\n"
              "      this.#slots.batch(() => {\n"
              "        for (const key of waiters) this.#scheduleLane(laneOf(key));\n"
              "      });\n")


def snapshot_reads(r) -> None:
    """“这个助手有没有在跑的轮次”不再每问一次就把全部对话复制四遍（同一次压力测试查出：一遍排队检查里
    这几个方法占了主进程三成的时间）。结果和顺序都不变：先看助手自己的对话，再按原来的顺序看别的线程。"""
    r.replace(CONVERSATION,
              "  workingSnapshot(agentId: string): ConversationSnapshot | undefined {\n"
              "    return [...this.activeSnapshots()].find(\n"
              "      ([id, snapshot]) => id === agentId && snapshot.activeTurnId && !this.isTaskThread(snapshot.threadId),\n"
              "    )?.[1];\n"
              "  }\n",
              "  workingSnapshot(agentId: string): ConversationSnapshot | undefined {\n"
              "    // HXBot (v1.7.3): the same answer as a search of `activeSnapshots()`, with no copy of them.\n"
              "    return this.#hxFirstSnapshot(\n"
              "      agentId,\n"
              "      (snapshot) => Boolean(snapshot.activeTurnId) && !this.isTaskThread(snapshot.threadId),\n"
              "    );\n"
              "  }\n"
              "\n"
              "  /**\n"
              "   * HXBot (v1.7.3): the first snapshot of the agent that `fits`, in the order of `activeSnapshots()`:\n"
              "   * the agent's own chat, then the other threads that it serves. The turn slots ask this for each lane\n"
              "   * many times a second, and each copy of every snapshot took a third of the main process.\n"
              "   */\n"
              "  #hxFirstSnapshot(\n"
              "    agentId: string,\n"
              "    fits: (snapshot: ConversationSnapshot) => boolean,\n"
              "  ): ConversationSnapshot | undefined {\n"
              "    const own = this.#snapshots.get(agentId);\n"
              "    if (own && fits(own)) return own;\n"
              "    for (const snapshot of this.#executionSnapshots.values())\n"
              "      if (snapshot.agentId === agentId && fits(snapshot)) return snapshot;\n"
              "    return undefined;\n"
              "  }\n")
    r.replace(CONVERSATION,
              "  anyWorkingSnapshot(agentId: string): ConversationSnapshot | undefined {\n"
              "    return [...this.activeSnapshots()].find(([id, snapshot]) => id === agentId && snapshot.activeTurnId)?.[1];\n"
              "  }\n",
              "  anyWorkingSnapshot(agentId: string): ConversationSnapshot | undefined {\n"
              "    // HXBot (v1.7.3): no copy of every snapshot for each ask.\n"
              "    return this.#hxFirstSnapshot(agentId, (snapshot) => Boolean(snapshot.activeTurnId));\n"
              "  }\n")
    r.replace(CONVERSATION,
              "  snapshotWithTurn(agentId: string, turnId: string): ConversationSnapshot | undefined {\n"
              "    return [...this.activeSnapshots()].find(\n"
              "      ([id, snapshot]) => id === agentId && snapshot.activeTurnId === turnId,\n"
              "    )?.[1];\n"
              "  }\n",
              "  snapshotWithTurn(agentId: string, turnId: string): ConversationSnapshot | undefined {\n"
              "    // HXBot (v1.7.3): no copy of every snapshot for each ask.\n"
              "    return this.#hxFirstSnapshot(agentId, (snapshot) => snapshot.activeTurnId === turnId);\n"
              "  }\n")


def schedule_all(r) -> None:
    """“给所有智能体排一次”（启动、服务商恢复、内存够了）在一遍里做：每排一个都要问一遍全部线路，
    100 个智能体就是一万次（同一次压力测试查出）。"""
    r.replace(DRAIN,
              "  scheduleDrain(agentId: string, followUsageLimit = true): void {\n"
              "    this.#scheduleDrain(agentId, followUsageLimit);\n"
              "    this.retrySlotWaiters();\n"
              "  }\n",
              "  scheduleDrain(agentId: string, followUsageLimit = true): void {\n"
              "    this.#scheduleDrain(agentId, followUsageLimit);\n"
              "    this.retrySlotWaiters();\n"
              "  }\n"
              "\n"
              "  /**\n"
              "   * HXBot (v1.7.3): `scheduleDrain` for many agents in one pass over the lanes: each schedule reads\n"
              "   * every lane, so a loop over 100 agents read them ten thousand times.\n"
              "   */\n"
              "  scheduleDrains(agentIds: readonly string[]): void {\n"
              "    this.#slots.batch(() => {\n"
              "      for (const agentId of agentIds) this.#scheduleDrain(agentId);\n"
              "    });\n"
              "    this.retrySlotWaiters();\n"
              "  }\n")
    r.replace(SERVICE,
              "              Effect.sync(() => {\n"
              "                for (const agent of this.#store.list()) this.#drain.scheduleDrain(agent.id);\n"
              "              }),\n",
              "              Effect.sync(() => {\n"
              "                // HXBot (v1.7.3): in one pass over the lanes.\n"
              "                this.#drain.scheduleDrains(this.#store.list().map((agent) => agent.id));\n"
              "              }),\n")
    r.replace(SERVICE,
              "        onProviderResumed: (provider) => {\n"
              "          for (const agent of this.#store.list()) {\n"
              "            if (providerForAgent(agent) === provider) this.#drain.scheduleDrain(agent.id);\n"
              "          }\n"
              "        },\n",
              "        onProviderResumed: (provider) => {\n"
              "          // HXBot (v1.7.3): in one pass over the lanes.\n"
              "          this.#drain.scheduleDrains(\n"
              "            this.#store\n"
              "              .list()\n"
              "              .filter((agent) => providerForAgent(agent) === provider)\n"
              "              .map((agent) => agent.id),\n"
              "          );\n"
              "        },\n")
    r.replace(SERVICE,
              "        scheduleAll: () => {\n"
              "          for (const agent of this.#store.list()) this.#drain.scheduleDrain(agent.id);\n"
              "        },\n",
              "        scheduleAll: () => {\n"
              "          // HXBot (v1.7.3): in one pass over the lanes.\n"
              "          this.#drain.scheduleDrains(this.#store.list().map((agent) => agent.id));\n"
              "        },\n")


def boot_yields(r) -> None:
    """启动恢复的几步（打开时收尾上次没完的对话；服务商就绪后收尾投递、恢复频道、核对频道定时任务）各是
    一次同步的长扫描，用了很久的资料库上连起来超过 1 秒、主程序这段时间不响应（最后一轮压力测试查出）。
    每两步之间让一次完整的事件循环（`hx-flow/loop-turn.ts`，连让两次：只让一次时，在 I/O 回调里开始的
    这一段会和下一段排在同一轮，计时器插不进来）；恢复频道时逐个成员线程读，每 50 毫秒让一次；
    收尾对话时只读当前轮次，不再顺带扫一遍整个对话找最后一条回答。"""
    r.replace(SERVICE,
              "            yield* this.channels.recover();\n"
              "            this.#channelRoutines.reconcileAll();\n",
              "            // HXBot (v1.7.3): each step below is one synchronous pass over the stored history, over a second\n"
              "            // together on a large profile, so the event loop gets a turn between them. Each step reads its\n"
              "            // state fresh, and events could already arrive before and after this hook.\n"
              "            yield* hxEventLoopTurn;\n"
              "            yield* this.channels.recover();\n"
              "            yield* hxEventLoopTurn;\n"
              "            this.#channelRoutines.reconcileAll();\n")
    r.replace(SERVICE,
              "    yield* lifecycleStep(\"recover agent state\", () => {\n"
              "      this.#boot.recoverPersistedTurns();\n"
              "      this.#hostedSites.restore();\n",
              "    yield* lifecycleStep(\"recover agent state\", () => this.#boot.recoverPersistedTurns());\n"
              "    // HXBot (v1.7.3): the event loop gets a turn after the pass over every stored thread. No turn runs\n"
              "    // before the providers start below, and no routine before `#initialized`.\n"
              "    yield* hxEventLoopTurn;\n"
              "    yield* lifecycleStep(\"recover agent state\", () => {\n"
              "      this.#hostedSites.restore();\n")
    r.replace(SERVICE,
              "import { hxFlow } from \"./hx-flow/ledger\";\n",
              "import { hxFlow } from \"./hx-flow/ledger\";\n"
              "import { hxEventLoopTurn } from \"./hx-flow/loop-turn\";\n")
    r.replace(CHANNEL_SERVICE,
              "import { hxFlow } from \"./hx-flow/ledger\";\n",
              "import { hxFlow } from \"./hx-flow/ledger\";\n"
              "import { hxLoopSlices } from \"./hx-flow/loop-turn\";\n")
    r.replace(CHANNEL_SERVICE,
              "    for (const context of yield* channelSync(() => this.store.executionThreads()))\n"
              "      this.capture(yield* channelSync(() => this.store.database.readConversation(context.id, context.threadId)));\n",
              "    // HXBot (v1.7.3): a turn of the event loop every 50 ms of this pass over every member thread. Each\n"
              "    // capture reads the thread fresh, as the capture at the end of a turn does.\n"
              "    const hxSlice = hxLoopSlices();\n"
              "    for (const context of yield* channelSync(() => this.store.executionThreads())) {\n"
              "      this.capture(yield* channelSync(() => this.store.database.readConversation(context.id, context.threadId)));\n"
              "      yield* hxSlice;\n"
              "    }\n")
    r.replace(BOOT,
              "      const turnId = this.#store.database.readConversationRuntime(agent.id, agent.threadId).activeTurnId;\n",
              "      // HXBot (v1.7.3): the active turn alone. The runtime read also looks for the latest answer, a scan\n"
              "      // of every message of the thread that recovery never reads.\n"
              "      const turnId = this.#store.database.readActiveTurnId(agent.id, agent.threadId);\n")


def apply(r) -> None:
    office_sign_in(r)
    slot_pass(r)
    snapshot_reads(r)
    schedule_all(r)
    boot_yields(r)
