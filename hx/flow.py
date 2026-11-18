"""HXBot 并发（一）：多智能体不卡死、团队不设上限、不拒绝只排队（v1.7.1，HX-Flow P0、P1）。

用户 2026-11-17：多智能体并发防拥堵在电脑这一侧解决，不由服务器指挥；团队取消“最多 20 人 · 240 分钟 ·
80 次交接”，不设上限、没有副作用；按《需求规格说明书 V2.1》第 5.1 节开发 v1.7.1。

HX 自己的文件：
- src/backend/hx-flow/：容量预算 B（budget.ts）、排队顺序（order.ts）、全机一本账（ledger.ts）、团队守护（guards.ts）
- src/main/hx-flow-memory.ts：桌面端读内存、电源、温度、主进程延迟和智能体进程的内存，算出 B
- src/backend/hx-team/：分派一律接收、开团不查人数、守护 G1～G9、容量告知

这一步改上游文件，只做接线：
1. 轮次位置（turn-slots.ts）：等着的线路按 HX-Flow 的顺序开始，真人留一个位置。
2. 排队（drain-scheduler.ts）：把 B 和在跑的线路告诉账本；每条线路开始时记一笔。
3. 智能体服务（agent-service.ts）：桌面端也有内存闸（只给 B，不整体停）；每次内存采样账本也看一遍。
4. 主进程（application-services.ts）：桌面端建 HxDesktopMemory 并启动、退出时停下。
5. 频道（channel-service.ts）：团队房间不受每频道 2 个的限制，由账本给位置；没拿到位置的留在看板上，
   不占资源；团队房间豁免“同一根任务自动分派满 8 次就暂停”；普通频道不变。
6. 工具分发（hxbot-tool-router.ts）：团队房间里的分派回复带一行排队状态。
7. 频道记录（channel-store.ts）：“哪些智能体有进行中的分派”在一轮事件循环里只查一次，分派一变就重查
   （v1.7.1 压力测试：每条等着的线路每次检查都扫一遍所有历史分派，30 分钟里卡顿从 0.3 秒涨到 0.8 秒）。
8. 频道调度（channel-service.ts）：只读还有没做完的工作的频道（做完的团队房间越积越多，每次调度都全读）。
9. 频道列表的未读数（channel-store.ts list）：记住上次数到哪一条，只数新来的消息。原来每次列表都把读者没读过的
   频道（没打开过的团队房间）的全部消息逐条解析 JSON 再数，时间随历史线性增长：3 MB 消息 10 ms、89 MB 消息
   209 ms；侧栏和回复提醒在每个 channels-changed（流式回复每一帧都发）上各读一遍，用久了主进程被它占满。
   改后 89 MB 时 5～12 ms，条数一致（差分检查 4×1500 步：一个记着数的和一个每次全数的逐步对照）。
   一条消息的“算不算未读”（删除、作者、类型）变了、整段历史删除、频道重建时，这个频道重新全数。
10. 用量（agent-service.ts）：频道的摘要和路由、旁问用的 token 记进助手的用量（BUG-CONC-01-A3 核对费用记录时
   查出原来不记；自动选模型的小模型判断在 hx/auto_model.py 里同样补上）。
11. 频道的 capture（channel-service.ts）：整份快照也按 id 读消息，不再每次读整个频道的历史（老库启动卡 49 秒）。
12. 信箱（mailbox-store.ts）：消息索引在列表没变时复用，不再每次检查都给全部消息建一个 Map。
13. 轮次位置（turn-slots.ts）：一次检查里每条线路只问一次在不在跑（原来问两三遍，线路多时一次 1.3 秒）。
"""

from __future__ import annotations

import brand_rename

SLOTS = "src/backend/agent/turn-slots.ts"
DRAIN = "src/backend/agent/drain-scheduler.ts"
SERVICE = "src/backend/agent-service.ts"
SERVICES = "src/main/application-services.ts"
CHANNELS = "src/backend/channel-service.ts"
CHANNEL_STORE = "src/backend/channel-store.ts"
ROUTER = "src/backend/agent/hxbot-tool-router.ts"
MAILBOX = "src/backend/mailbox-store.ts"


def turn_slots(r) -> None:
    brand_rename.add_import(r, SLOTS, 'import { type HxFlowCandidate, hxFlow } from "../hx-flow/ledger";')
    r.replace(SLOTS,
              "  /** The delivery at the head of the lane's queue. */\n"
              "  head(lane: string): QueueDelivery | null;\n",
              "  /** The delivery at the head of the lane's queue. */\n"
              "  head(lane: string): QueueDelivery | null;\n"
              "  /** HXBot (v1.7.1): the place of a lane's head in the HX-Flow order (src/backend/hx-flow). */\n"
              "  rank?(lane: string, head: QueueDelivery): HxFlowCandidate;\n")
    r.replace(SLOTS,
              "    const free = limit - lanes.filter((id) => this.#options.isRunning(id)).length;\n"
              "    if (free <= 0) return false;\n"
              "    const head = this.#options.head(lane);\n"
              "    if (!head) return true;\n"
              "    let ahead = 0;\n"
              "    for (const other of lanes) {\n"
              "      if (other === lane || this.#options.isRunning(other) || !this.#options.isWaiting(other)) continue;\n",
              "    // HXBot (v1.7.1, BUG-CONC-01): each lane is asked once whether it runs. A check of a waiting lane\n"
              "    // asked every lane two or three times; with 65 agents one pass held the main process 1.3 s.\n"
              "    const running = lanes.filter((id) => this.#options.isRunning(id));\n"
              "    const runs = new Set(running);\n"
              "    const free = limit - running.length;\n"
              "    if (free <= 0) return false;\n"
              "    const head = this.#options.head(lane);\n"
              "    if (!head) return true;\n"
              "    // HXBot (v1.7.1, CONC-03): the HX-Flow order, and one place kept for a person.\n"
              "    const rank = this.#options.rank;\n"
              "    if (rank) {\n"
              "      const waiting: HxFlowCandidate[] = [];\n"
              "      for (const other of lanes) {\n"
              "        if (other === lane || runs.has(other) || !this.#options.isWaiting(other)) continue;\n"
              "        const otherHead = this.#options.head(other);\n"
              "        if (otherHead) waiting.push(rank(other, otherHead));\n"
              "      }\n"
              "      return hxFlow.mayStart(rank(lane, head), waiting, running, limit);\n"
              "    }\n"
              "    let ahead = 0;\n"
              "    for (const other of lanes) {\n"
              "      if (other === lane || runs.has(other) || !this.#options.isWaiting(other)) continue;\n")


def drain(r) -> None:
    brand_rename.add_import(r, DRAIN, 'import { hxFlow, hxTickMemo } from "../hx-flow/ledger";')
    # BUG-CONC-01: the lanes of every agent once per pass, not once per check (each read is SQLite).
    r.replace(DRAIN,
              "    this.#slots = new TurnSlots({\n"
              "      limit: () => this.#memory.turnLimit(),\n"
              "      lanes: () =>\n"
              "        this.#store\n"
              "          .list()\n"
              "          .flatMap((agent) => this.#lanesOf(agent.id))\n"
              "          .map(laneKey),\n",
              "    // HXBot (v1.7.1, BUG-CONC-01): the lanes of every agent read once per pass. Each read asks SQLite\n"
              "    // for the open tasks of each agent, and with a turn budget on the desktop every check asks.\n"
              "    const lanes = hxTickMemo(() =>\n"
              "      this.#store\n"
              "        .list()\n"
              "        .flatMap((agent) => this.#lanesOf(agent.id))\n"
              "        .map(laneKey),\n"
              "    );\n"
              "    this.#slots = new TurnSlots({\n"
              "      limit: () => this.#memory.turnLimit(),\n"
              "      lanes,\n")
    r.replace(DRAIN,
              "      head: (key) => {\n"
              "        const lane = laneOf(key);\n"
              "        return this.#mailbox.nextQueued(lane.agentId, lane.taskId)?.delivery ?? null;\n"
              "      },\n"
              "    });\n",
              "      head: (key) => {\n"
              "        const lane = laneOf(key);\n"
              "        return this.#mailbox.nextQueued(lane.agentId, lane.taskId)?.delivery ?? null;\n"
              "      },\n"
              "      // HXBot (v1.7.1, CONC-03): the tier of the head, and its team (src/backend/hx-flow).\n"
              "      rank: (key, head) => hxFlow.rank(key, head, this.#channels?.store.assignmentForDelivery(head.id) ?? null),\n"
              "    });\n"
              "    // HXBot (v1.7.1): the ledger reads B and the lanes that run a turn.\n"
              "    hxFlow.attachScheduler({\n"
              "      limit: () => this.#memory.turnLimit(),\n"
              "      running: hxTickMemo(() =>\n"
              "        lanes().filter((key) => {\n"
              "          const lane = laneOf(key);\n"
              "          return this.#laneRunning(lane) || this.#compactionHolds(lane);\n"
              "        }),\n"
              "      ),\n"
              "    });\n")
    r.replace(DRAIN,
              "      this.#usageLimits.tryStarted(agentId);\n"
              "      yield* this.startDelivery(context, planNote ?? undefined);\n",
              "      this.#usageLimits.tryStarted(agentId);\n"
              "      // HXBot (v1.7.1): the ledger counts the turn of this lane for its team (src/backend/hx-flow).\n"
              "      const hxAssignment = this.#channels?.store.assignmentForDelivery(context.delivery.id) ?? null;\n"
              "      hxFlow.started(key, hxFlow.rank(key, context.delivery, hxAssignment), hxAssignment?.taskId ?? null);\n"
              "      yield* this.startDelivery(context, planNote ?? undefined);\n")


def agent_service(r) -> None:
    brand_rename.add_import(r, SERVICE, 'import { hxFlow } from "./hx-flow/ledger";')
    brand_rename.add_import(r, SERVICE, 'import { HX_IDLE_MIN_MS, hxWithIdlePolicy } from "./hx-flow/idle";')
    brand_rename.add_import(r, SERVICE, 'import { hxReadSpend } from "./hx-team/spend";')
    r.replace(SERVICE,
              "  hostMemory?: HostMemory | null;\n",
              "  hostMemory?: HostMemory | null;\n"
              "  /**\n"
              "   * HXBot (v1.7.1, CONC-01): the turn budget of a desktop computer (src/main/hx-flow-memory.ts). It\n"
              "   * limits the turns that run at the same time and never holds every turn, as a server's low memory does.\n"
              "   */\n"
              "  hxDesktopMemory?: HostMemory | null;\n")
    r.replace(SERVICE,
              "      hostMemory = null,\n"
              "      busyMessageMode",
              "      hostMemory = null,\n"
              "      hxDesktopMemory = null,\n"
              "      busyMessageMode")
    r.replace(SERVICE,
              "    this.#memoryHold = new MemoryHold({\n"
              "      memory: hostMemory,\n",
              "    this.#memoryHold = new MemoryHold({\n"
              "      memory: hostMemory ?? hxDesktopMemory,\n")
    r.replace(SERVICE,
              "        retryWaiting: () => this.#drain.retrySlotWaiters(),\n",
              "        retryWaiting: () => {\n"
              "          // HXBot (v1.7.1): at each memory sample the ledger counts the team shares and pumps the team rooms.\n"
              "          hxFlow.tick(undefined, true);\n"
              "          this.#drain.retrySlotWaiters();\n"
              "        },\n")
    r.replace(SERVICE,
              "        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),\n"
              "      },\n"
              "    });\n"
              "    this.#usageLimits = new UsageLimitGate({\n",
              "        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),\n"
              "      },\n"
              "    });\n"
              "    // HXBot (v1.7.1): what the HX-Flow ledger reads of the channels and the usage limits.\n"
              "    hxFlow.attachChannels({\n"
              "      isRequest: (channelId, taskId) =>\n"
              "        this.channels.store.tasks(channelId).find((task) => task.id === taskId)?.parentTaskId === null,\n"
              "      wakeRooms: () => {\n"
              "        for (const channelId of this.channels.store.ids())\n"
              "          if (hxFlow.isTeamRoom(channelId))\n"
              "            Effect.runFork(this.channels.wake(channelId).pipe(Effect.catch(() => Effect.void)));\n"
              "      },\n"
              "    });\n"
              "    hxFlow.attachMachine({\n"
              "      // G6: the longest idle member thread of 4 minutes or more (src/backend/hx-flow/idle.ts).\n"
              "      releaseIdle: () =>\n"
              "        hxWithIdlePolicy(HX_IDLE_MIN_MS, 1, () => {\n"
              "          this.#codexIdleSessions.releaseIdle();\n"
              "          Effect.runFork(this.#providers.releaseIdleThreads().pipe(Effect.catch(() => Effect.void)));\n"
              "        }),\n"
              "      limitedModels: () => [\n"
              "        ...new Set(\n"
              "          this.#store\n"
              "            .list()\n"
              "            .filter((agent) => !this.#usageLimits.mayDrain(agent.id))\n"
              "            .map((agent) => agent.model),\n"
              "        ),\n"
              "      ],\n"
              "    });\n"
              "    this.#usageLimits = new UsageLimitGate({\n")


def application_services(r) -> None:
    brand_rename.add_import(r, SERVICES, 'import { HxDesktopMemory } from "./hx-flow-memory";')
    brand_rename.add_import(r, SERVICES, 'import { hxFlow } from "../backend/hx-flow/ledger";')
    r.replace(SERVICES,
              "  if (hostMemory) {\n"
              "    hostMemory.start();\n",
              "  // HXBot (v1.7.1, CONC-01): a desktop computer gets a turn budget too, from its memory, power and\n"
              "  // temperature (src/main/hx-flow-memory.ts). It only limits the turns that run at the same time.\n"
              "  const hxDesktopMemory = hostMemory\n"
              "    ? null\n"
              "    : new HxDesktopMemory({\n"
              "        power: {\n"
              "          onBattery: () => powerMonitor.isOnBatteryPower(),\n"
              "          on: (event, listener) => {\n"
              "            if (event === \"suspend\") {\n"
              "              powerMonitor.on(\"suspend\", listener);\n"
              "              return () => powerMonitor.off(\"suspend\", listener);\n"
              "            }\n"
              "            powerMonitor.on(\"resume\", listener);\n"
              "            return () => powerMonitor.off(\"resume\", listener);\n"
              "          },\n"
              "          onThermal: (listener) => {\n"
              "            const changed = (state: string) =>\n"
              "              listener(state === \"fair\" || state === \"serious\" || state === \"critical\" ? state : \"nominal\");\n"
              "            powerMonitor.on(\"thermal-state-change\", (details) => changed(details.state));\n"
              "            return () => powerMonitor.removeAllListeners(\"thermal-state-change\");\n"
              "          },\n"
              "          onSpeedLimit: (listener) => {\n"
              "            powerMonitor.on(\"speed-limit-change\", (details) => listener(details.limit));\n"
              "            return () => powerMonitor.removeAllListeners(\"speed-limit-change\");\n"
              "          },\n"
              "        },\n"
              "        active: () => {\n"
              "          const capacity = hxFlow.capacity();\n"
              "          return capacity.running > 0 || capacity.waiting > 0;\n"
              "        },\n"
              "        electronPath: process.execPath,\n"
              "        sampleFile: app.isPackaged ? null : (process.env.HXBOT_HX_FLOW_SAMPLE_FILE ?? null),\n"
              "        onError: (message, error) => logger.warn(message, toLogValue(error)),\n"
              "        onBudget: (budget, detail) => logger.info(\"HX-Flow changed the turn budget.\", { budget, ...detail }),\n"
              "      });\n"
              "  if (hxDesktopMemory) {\n"
              "    hxDesktopMemory.setRunning(() => hxFlow.capacity().running);\n"
              "    hxFlow.attachMachine({\n"
              "      bound: () => hxDesktopMemory.bound(),\n"
              "      screenBusy: () => powerMonitor.getSystemIdleTime() < 5,\n"
              "    });\n"
              "    hxDesktopMemory.start();\n"
              "    teardown.push(TEARDOWN_ORDER.serverMemory, \"the HX-Flow memory reading\", () => hxDesktopMemory.stop());\n"
              "  }\n"
              "  if (hostMemory) {\n"
              "    hostMemory.start();\n")
    r.replace(SERVICES,
              "    hostMemory,\n"
              "    requestTimeoutMs: 30_000,\n",
              "    hostMemory,\n"
              "    hxDesktopMemory,\n"
              "    requestTimeoutMs: 30_000,\n")


def channels(r) -> None:
    brand_rename.add_import(r, CHANNELS, 'import { hxFlow } from "./hx-flow/ledger";')
    r.replace(CHANNELS,
              "      assignments.filter((assignment) => assignment.channelId === task.channelId).length >= CHANNEL_PARALLEL_LIMIT ||\n",
              "      // HXBot (v1.7.1, CONC-04): a team room has no limit of its own. The HX-Flow ledger gives it a\n"
              "      // place, so team work with no place stays on the board and takes no resource.\n"
              "      (hxFlow.isTeamRoom(task.channelId)\n"
              "        ? !hxFlow.hasPlace(task.channelId, task.id)\n"
              "        : assignments.filter((assignment) => assignment.channelId === task.channelId).length >=\n"
              "          CHANNEL_PARALLEL_LIMIT) ||\n")
    r.replace(CHANNELS,
              "      yield* channelSync(() => this.store.update(channel, { assignments: [assignment] }));\n"
              "      // The request message belongs to the task that the request created,",
              "      yield* channelSync(() => this.store.update(channel, { assignments: [assignment] }));\n"
              "      // HXBot (v1.7.1): the place that the ledger gave stays taken until the turn starts.\n"
              "      if (hxFlow.isTeamRoom(channelId)) hxFlow.dispatched(task.id);\n"
              "      // The request message belongs to the task that the request created,")
    r.replace(CHANNELS,
              "    if (root.assignmentCount >= CHANNEL_ASSIGNMENT_LIMIT) {\n",
              "    // HXBot (v1.7.1, CONC-04): a team room is not paused at 8 assignments of one root task; the team\n"
              "    // guards (loops, spread, no progress) watch it instead (src/backend/hx-team).\n"
              "    if (root.assignmentCount >= CHANNEL_ASSIGNMENT_LIMIT && !hxFlow.isTeamRoom(channelId)) {\n")


def channel_store(r) -> None:
    r.replace(CHANNEL_STORE,
              "  /** `hasAssignmentInState` for the assignments of one agent. `mayDrain` asks this on every queue check. */\n"
              "  hasAgentAssignmentInState(agentId: string, states: readonly ChannelAssignment[\"state\"][]): boolean {\n"
              "    if (!states.length) return false;\n"
              "    const placeholders = states.map(() => \"?\").join(\", \");\n"
              "    return (\n"
              "      this.database.connection\n"
              "        .prepare(\n"
              "          `SELECT 1 FROM projection_channel_assignments\n"
              "            WHERE json_extract(assignment_json, '$.agentId') = ?\n"
              "              AND json_extract(assignment_json, '$.state') IN (${placeholders}) LIMIT 1`,\n"
              "        )\n"
              "        .get(agentId, ...states) !== undefined\n"
              "    );\n"
              "  }\n",
              "  /**\n"
              "   * HXBot (v1.7.1, BUG-CONC-01): the agents that have an assignment in these states. The query reads\n"
              "   * every assignment row that was ever written (no index), and `mayDrain` asked it for each waiting\n"
              "   * lane at each queue check: in the stress run the time grew with the history, to 4.8 s of every\n"
              "   * 180 s and stalls of the main process of 0.5 to 0.8 s after 15 minutes. One read now serves\n"
              "   * until an assignment is written (`project`, a deleted channel) or the event loop turns.\n"
              "   */\n"
              "  #agentsInState: { states: string; agents: ReadonlySet<string> } | null = null;\n"
              "\n"
              "  /**\n"
              "   * HXBot (v1.7.1, BUG-CONC-01): the channels with a task that is not done (queued, running, waiting\n"
              "   * or paused) or an assignment that starts, runs or waits. Only they have work to schedule; a\n"
              "   * task's root and its dependencies are in its own channel.\n"
              "   */\n"
              "  channelsWithOpenWork(): ReadonlySet<string> {\n"
              "    return new Set(\n"
              "      databaseRows(\n"
              "        this.database.connection\n"
              "          .prepare(\n"
              "            `SELECT channel_id FROM projection_channel_tasks\n"
              "              WHERE json_extract(task_json, '$.state') IN ('queued', 'running', 'waiting', 'paused')\n"
              "            UNION\n"
              "            SELECT channel_id FROM projection_channel_assignments\n"
              "              WHERE json_extract(assignment_json, '$.state') IN ('starting', 'running', 'queued')`,\n"
              "          )\n"
              "          .all(),\n"
              "      ).map((row) => requiredStringColumn(row, \"channel_id\")),\n"
              "    );\n"
              "  }\n"
              "\n"
              "  /** `hasAssignmentInState` for the assignments of one agent. `mayDrain` asks this on every queue check. */\n"
              "  hasAgentAssignmentInState(agentId: string, states: readonly ChannelAssignment[\"state\"][]): boolean {\n"
              "    if (!states.length) return false;\n"
              "    const key = states.join(\"\\n\");\n"
              "    let held = this.#agentsInState;\n"
              "    if (held?.states !== key) {\n"
              "      const placeholders = states.map(() => \"?\").join(\", \");\n"
              "      const agents = new Set(\n"
              "        databaseRows(\n"
              "          this.database.connection\n"
              "            .prepare(\n"
              "              `SELECT DISTINCT json_extract(assignment_json, '$.agentId') AS agent_id\n"
              "                FROM projection_channel_assignments\n"
              "                WHERE json_extract(assignment_json, '$.state') IN (${placeholders})`,\n"
              "            )\n"
              "            .all(...states),\n"
              "        ).map((row) => String(row.agent_id)),\n"
              "      );\n"
              "      const fresh = { states: key, agents };\n"
              "      held = fresh;\n"
              "      this.#agentsInState = fresh;\n"
              "      setImmediate(() => {\n"
              "        if (this.#agentsInState === fresh) this.#agentsInState = null;\n"
              "      });\n"
              "    }\n"
              "    return held.agents.has(agentId);\n"
              "  }\n")
    r.replace(CHANNEL_STORE,
              "    for (const assignment of change.assignments)\n"
              "      db.prepare(\n",
              "    // HXBot (v1.7.1): an assignment changes, so the agents with assignments are read again.\n"
              "    if (change.assignments.length) this.#agentsInState = null;\n"
              "    for (const assignment of change.assignments)\n"
              "      db.prepare(\n")
    r.replace(CHANNEL_STORE,
              "        db.prepare(\"DELETE FROM projection_channels WHERE channel_id = ?\").run(channelId);\n",
              "        db.prepare(\"DELETE FROM projection_channels WHERE channel_id = ?\").run(channelId);\n"
              "        // HXBot (v1.7.1): the assignments of the channel are gone.\n"
              "        this.#agentsInState = null;\n")


def channel_scheduling(r) -> None:
    r.replace(CHANNELS,
              "  #scheduling(): { tasks: ReadonlyMap<string, ChannelTask>; assignments: ChannelAssignment[] } {\n"
              "    const ids = this.store.ids();\n",
              "  #scheduling(): { tasks: ReadonlyMap<string, ChannelTask>; assignments: ChannelAssignment[] } {\n"
              "    // HXBot (v1.7.1, BUG-CONC-01): only the channels with work that is not done. The rooms of the\n"
              "    // teams that are done stay, and reading all of them at each pump was a part of each stall.\n"
              "    const open = this.store.channelsWithOpenWork();\n"
              "    const ids = this.store.ids().filter((id) => open.has(id));\n")


def channel_unread(r) -> None:
    r.replace(CHANNEL_STORE,
              "/**\n"
              " * Owns durable channel records. Every change and its retry receipt commit together.\n"
              " */\n"
              "export class ChannelStore {\n"
              "  /** By channel: how many times a message changed in place after it was complete, in this process. */\n"
              "  readonly #completedMessageChanges = new Map<string, number>();\n",
              "/** HXBot (v1.7.1, BUG-CONC-01): what decides whether a stored channel message counts as unread. */\n"
              "function unreadKind(entry: unknown): string {\n"
              "  if (!isChannelMessage(entry)) return \"\";\n"
              "  return `${isDeletedChannelMessage(entry) ? 1 : 0}\\n${entry.author.id}\\n${entry.message.itemType ?? \"\"}`;\n"
              "}\n"
              "\n"
              "/** HXBot (v1.7.1, BUG-CONC-01): the unread count of one channel for one reader, as `list` last read it. */\n"
              "interface HeldUnread {\n"
              "  /** The read position it was counted from. */\n"
              "  through: number;\n"
              "  /** The last sequence it counted. */\n"
              "  counted: number;\n"
              "  count: number;\n"
              "}\n"
              "\n"
              "/**\n"
              " * Owns durable channel records. Every change and its retry receipt commit together.\n"
              " */\n"
              "export class ChannelStore {\n"
              "  /** By channel: how many times a message changed in place after it was complete, in this process. */\n"
              "  readonly #completedMessageChanges = new Map<string, number>();\n"
              "\n"
              "  /**\n"
              "   * HXBot (v1.7.1, BUG-CONC-01): by channel, then by reader: the unread counts of the last `list`.\n"
              "   * Counting read every message of a channel that its reader never read (a team room the person does\n"
              "   * not open), with nine JSON reads for each. The time grew with the history: 10 ms for 3 MB of\n"
              "   * messages, 209 ms for 89 MB, and `list` runs on every `channels-changed`, twice (the sidebar and\n"
              "   * the reply notification), while each streaming reply sends them. A list now counts only the\n"
              "   * messages after the ones it counted before. A changed message that changes how it counts\n"
              "   * (deleted, its author, its kind), a deleted history and a rebuilt channel count it all again.\n"
              "   */\n"
              "  readonly #unread = new Map<string, Map<string, HeldUnread>>();\n")
    r.replace(CHANNEL_STORE,
              "            (SELECT COUNT(*) FROM projection_channel_messages AS m\n"
              "              WHERE m.channel_id = c.channel_id\n"
              "                AND m.sequence > COALESCE(\n"
              "                  (SELECT r.through_sequence FROM projection_channel_reads AS r\n"
              "                    WHERE r.channel_id = c.channel_id AND r.member_id = ?), 0)\n"
              "                AND ${SHOWN_MESSAGE_SQL.replaceAll(\"message_json\", \"m.message_json\")}\n"
              "                AND json_extract(m.message_json, '$.author.id') IS NOT ?\n"
              "                AND json_extract(m.message_json, '$.author.id') IS NOT ?\n"
              "                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'plan'\n"
              "                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'subagents'\n"
              "                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'channel-change'\n"
              "                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'context-reset'\n"
              "                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'commentary'\n"
              "                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') NOT LIKE ?) AS unread,\n",
              "            COALESCE((SELECT r.through_sequence FROM projection_channel_reads AS r\n"
              "              WHERE r.channel_id = c.channel_id AND r.member_id = ?), 0) AS read_through,\n"
              "            (SELECT MAX(m.sequence) FROM projection_channel_messages AS m\n"
              "              WHERE m.channel_id = c.channel_id) AS last_sequence,\n")
    r.replace(CHANNEL_STORE,
              "        .all(memberId, memberId, excludedId, `${CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX}%`),\n"
              "    );\n"
              "    const threads",
              "        .all(memberId),\n"
              "    );\n"
              "    const threads")
    r.replace(CHANNEL_STORE,
              "    return rows.map((row) => {\n"
              "      const channel = decodeChannel(JSON.parse(requiredStringColumn(row, \"channel_json\")));\n",
              "    const listed = new Set<string>();\n"
              "    const summaries = rows.map((row) => {\n"
              "      const channel = decodeChannel(JSON.parse(requiredStringColumn(row, \"channel_json\")));\n"
              "      listed.add(channel.id);\n")
    r.replace(CHANNEL_STORE,
              "        unreadCount: Number(row.unread ?? 0),\n",
              "        unreadCount: this.#unreadCount(\n"
              "          channel.id,\n"
              "          memberId,\n"
              "          excludedId,\n"
              "          Number(row.read_through ?? 0),\n"
              "          Number(row.last_sequence ?? 0),\n"
              "        ),\n")
    r.replace(CHANNEL_STORE,
              "          channel.members.some((item) => item.agentId === thread.agentId),\n"
              "        ),\n"
              "      };\n"
              "    });\n"
              "  }\n"
              "\n"
              "  create(",
              "          channel.members.some((item) => item.agentId === thread.agentId),\n"
              "        ),\n"
              "      };\n"
              "    });\n"
              "    // A deleted channel keeps no count.\n"
              "    for (const channelId of this.#unread.keys()) if (!listed.has(channelId)) this.#unread.delete(channelId);\n"
              "    return summaries;\n"
              "  }\n"
              "\n"
              "  /** HXBot (v1.7.1, BUG-CONC-01): the unread count of a channel; counts only what `list` did not count yet. */\n"
              "  #unreadCount(channelId: string, memberId: string, excludedId: string, through: number, last: number): number {\n"
              "    const reader = `${memberId}\\n${excludedId}`;\n"
              "    const held = this.#unread.get(channelId)?.get(reader);\n"
              "    // A read position that moved, or fewer messages than were counted (a rolled-back write), counts it all.\n"
              "    const kept = held && held.through === through && held.counted <= last ? held : null;\n"
              "    const from = kept ? kept.counted : through;\n"
              "    let count = kept ? kept.count : 0;\n"
              "    if (last > from) {\n"
              "      const row = databaseRow(\n"
              "        this.database.connection\n"
              "          .prepare(\n"
              "            `SELECT COUNT(*) AS count FROM projection_channel_messages AS m\n"
              "              WHERE m.channel_id = ? AND m.sequence > ? AND m.sequence <= ?\n"
              "                AND ${SHOWN_MESSAGE_SQL.replaceAll(\"message_json\", \"m.message_json\")}\n"
              "                AND json_extract(m.message_json, '$.author.id') IS NOT ?\n"
              "                AND json_extract(m.message_json, '$.author.id') IS NOT ?\n"
              "                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'plan'\n"
              "                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'subagents'\n"
              "                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'channel-change'\n"
              "                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'context-reset'\n"
              "                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') != 'commentary'\n"
              "                AND COALESCE(json_extract(m.message_json, '$.message.itemType'), '') NOT LIKE ?`,\n"
              "          )\n"
              "          .get(channelId, from, last, memberId, excludedId, `${CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX}%`),\n"
              "      );\n"
              "      count += row ? requiredNumberColumn(row, \"count\") : 0;\n"
              "    }\n"
              "    // Inside a transaction the rows can still roll back: keep nothing.\n"
              "    if (!this.database.connection.isTransaction) {\n"
              "      const readers = this.#unread.get(channelId) ?? new Map<string, HeldUnread>();\n"
              "      readers.set(reader, { through, counted: Math.max(from, last), count });\n"
              "      this.#unread.set(channelId, readers);\n"
              "    }\n"
              "    return count;\n"
              "  }\n"
              "\n"
              "  create(")
    r.replace(CHANNEL_STORE,
              "      const before = existing ? JSON.parse(requiredStringColumn(existing, \"message_json\")) : null;\n",
              "      const before = existing ? JSON.parse(requiredStringColumn(existing, \"message_json\")) : null;\n"
              "      // HXBot (v1.7.1, BUG-CONC-01): the kept unread counts of the channel include this message as it was.\n"
              "      if (existing && unreadKind(before) !== unreadKind(message)) this.#unread.delete(change.channel.id);\n")
    r.replace(CHANNEL_STORE,
              "        for (const id of ids) {\n"
              "          const row = databaseRow(readMessage.get(channel.id, id));\n"
              "          const entry = row ? JSON.parse(requiredStringColumn(row, \"message_json\")) : null;\n"
              "          if (isChannelMessage(entry)) writeMessage.run(JSON.stringify(deletedChannelMessage(entry)), channel.id, id);\n"
              "        }\n",
              "        for (const id of ids) {\n"
              "          const row = databaseRow(readMessage.get(channel.id, id));\n"
              "          const entry = row ? JSON.parse(requiredStringColumn(row, \"message_json\")) : null;\n"
              "          if (isChannelMessage(entry)) writeMessage.run(JSON.stringify(deletedChannelMessage(entry)), channel.id, id);\n"
              "        }\n"
              "        // HXBot (v1.7.1, BUG-CONC-01): no message of the channel counts as unread now.\n"
              "        this.#unread.delete(channel.id);\n")
    r.replace(CHANNEL_STORE,
              "  rebuild(channelId: string): void {\n"
              "    const db = this.database.connection;\n",
              "  rebuild(channelId: string): void {\n"
              "    const db = this.database.connection;\n"
              "    // HXBot (v1.7.1, BUG-CONC-01): the messages are written again.\n"
              "    this.#unread.delete(channelId);\n")


def side_usage(r) -> None:
    # BUG-CONC-01-A3：频道的摘要和路由、旁问是助手用模型做的事，token 记进它的用量（原来不记）。
    r.replace(SERVICE,
              "          return yield* this.#profileClients\n"
              "            .run(client, (cancelled) => generateTextWithoutTools(client, turnModel, prompt, cancelled))\n",
              "          return yield* this.#profileClients\n"
              "            .run(client, (cancelled) =>\n"
              "              generateTextWithoutTools(\n"
              "                client,\n"
              "                turnModel,\n"
              "                prompt,\n"
              "                cancelled,\n"
              "                // HXBot (v1.7.1, BUG-CONC-01-A3): a channel summary or routing turn is the agent's usage.\n"
              "                sideSessionUsageObserver(\n"
              "                  \"channel\",\n"
              "                  this.#store.database.usage,\n"
              "                  selected.id,\n"
              "                  selected.provider,\n"
              "                  model.id,\n"
              "                ),\n"
              "              ),\n"
              "            )\n")
    r.replace(SERVICE,
              "            sideQuestionPrompt(agent, messages, input),\n"
              "            cancelled,\n"
              "          ),\n",
              "            sideQuestionPrompt(agent, messages, input),\n"
              "            cancelled,\n"
              "            // HXBot (v1.7.1, BUG-CONC-01-A3): a side question is the agent's usage.\n"
              "            sideSessionUsageObserver(\"side-question\", this.#store.database.usage, agent.id, agent.provider, model.id),\n"
              "          ),\n")


def channel_capture(r) -> None:
    # BUG-CONC-01（老库）：启动时 recover 对每个频道线程做一次整份快照的 capture，每次都把整个频道的历史读出来解析；
    # 团队房间有十几个成员线程，89 MB 消息时主进程卡 49 秒。改为和增量一样按 id 读，结果相同（都不含已删除的消息）。
    r.replace(CHANNELS,
              "    // A delta reads the few messages of its turn by id. A whole snapshot reads the history once.\n"
              "    const history =\n"
              "      turnId === undefined\n"
              "        ? new Map(this.store.messages(channelId).map((message) => [message.id, message] as const))\n"
              "        : new Map<string, ChannelMessage | null>();\n"
              "    const existing = (id: string): ChannelMessage | undefined => {\n"
              "      if (turnId !== undefined && !history.has(id)) history.set(id, this.store.message(channelId, id));\n"
              "      return history.get(id) ?? undefined;\n"
              "    };\n",
              "    // HXBot (v1.7.1, BUG-CONC-01): each message is read by id, also for a whole snapshot. At start-up\n"
              "    // `recover` captures every member thread of every channel; reading the whole channel history for\n"
              "    // each of them held the main process for 49 s with 89 MB of channel messages. A member's thread\n"
              "    // holds only its own messages, and `message` leaves out a deleted one as `messages` does.\n"
              "    const history = new Map<string, ChannelMessage | null>();\n"
              "    const existing = (id: string): ChannelMessage | undefined => {\n"
              "      if (!history.has(id)) history.set(id, this.store.message(channelId, id));\n"
              "      return history.get(id) ?? undefined;\n"
              "    };\n")


def mailbox_index(r) -> None:
    # BUG-CONC-01：nextQueued 等每次都把信箱里全部消息建一个 Map（每条等着的线路每次检查都建），随历史增长。
    # 改为消息列表没变（同一个数组、同样长）时复用上次的 Map。列表只会 push、换成过滤后的新数组或整个换掉。
    r.replace(MAILBOX,
              "  /** Indexed once for a whole read, so a read over many deliveries does not scan the messages for each one. */\n"
              "  #messagesById(): Map<string, StoredMessage> {\n"
              "    return new Map(this.#state.messages.map((message) => [message.id, message]));\n"
              "  }\n",
              "  /**\n"
              "   * HXBot (v1.7.1, BUG-CONC-01): the index of the last read. Each check of a waiting lane read it again\n"
              "   * (`nextQueued`), over every message the mailbox keeps. The list changes only by a push, by a new\n"
              "   * filtered array or by a new state, so the same array with the same length has the same messages.\n"
              "   */\n"
              "  #messageIndex: { source: StoredMessage[]; length: number; byId: Map<string, StoredMessage> } | null = null;\n"
              "\n"
              "  /** Indexed once for a whole read, so a read over many deliveries does not scan the messages for each one. */\n"
              "  #messagesById(): Map<string, StoredMessage> {\n"
              "    const source = this.#state.messages;\n"
              "    const held = this.#messageIndex;\n"
              "    if (held?.source === source && held.length === source.length) return held.byId;\n"
              "    const byId = new Map(source.map((message) => [message.id, message]));\n"
              "    this.#messageIndex = { source, length: source.length, byId };\n"
              "    return byId;\n"
              "  }\n")


def router(r) -> None:
    # Anchored on text that the brand rename does not change, so the step also finds it in a tree
    # that was renamed already.
    r.replace(ROUTER,
              "        yield* this.#channels.tool(\n"
              "          channelId,\n"
              "          senderAgentId,\n"
              "          params.turnId,\n"
              "          params.callId,\n"
              "          params.tool,\n"
              "          params.arguments,\n"
              "        ),\n"
              "      );\n",
              "        // HXBot (v1.7.1, CONC-04, CONC-12): in a team room, the reply to an assignment says its place.\n"
              "        hxTeams.withQueueLine(\n"
              "          channelId,\n"
              "          params.tool,\n"
              "          yield* this.#channels.tool(\n"
              "            channelId,\n"
              "            senderAgentId,\n"
              "            params.turnId,\n"
              "            params.callId,\n"
              "            params.tool,\n"
              "            params.arguments,\n"
              "          ),\n"
              "        ),\n"
              "      );\n")



IDLE_POOL = "src/backend/idle-thread-pool.ts"
CODEX_IDLE = "src/backend/agent/codex-idle-sessions.ts"


def idle_guard(r) -> None:
    """G6：内存卡住且有人在等时，只关闲了 4 分钟以上、闲得最久的一个成员线程（hx-flow/idle.ts）。"""
    brand_rename.add_import(r, IDLE_POOL, 'import { hxIdleTake } from "./hx-flow/idle";')
    r.replace(IDLE_POOL,
              "    for (const thread of idle.slice(0, Math.max(0, idle.length - limit))) {\n"
              "      yield* this.#release(thread);\n",
              "    // HXBot (v1.7.1, G6): during a release of the ledger, only the longest idle thread of 4 minutes or more.\n"
              "    for (const thread of hxIdleTake(idle.slice(0, Math.max(0, idle.length - limit)), (item) => item.idleSince)) {\n"
              "      yield* this.#release(thread);\n")
    brand_rename.add_import(r, CODEX_IDLE, 'import { hxIdleTake } from "../hx-flow/idle";')
    r.replace(CODEX_IDLE,
              "    for (const [externalThreadId, session] of idle.slice(0, Math.max(0, idle.length - limit))) {\n",
              "    // HXBot (v1.7.1, G6): during a release of the ledger, only the longest idle session of 4 minutes or more.\n"
              "    for (const [externalThreadId, session] of hxIdleTake(\n"
              "      idle.slice(0, Math.max(0, idle.length - limit)),\n"
              "      ([, item]) => item.idleSince,\n"
              "    )) {\n")


STATUS_EN = {
    "status.agent.hxTeam.handedOver": "Team · {from} handed the whole task to {to} (handoff {count}).",
    "status.agent.hxTeam.progressOpen": "Team · {count} handoffs · {minutes} min",
    "status.agent.hxTeam.progressPaused": "Team · paused, waits for you · {count} handoffs · {minutes} min",
    "status.agent.hxTeam.paused": "Team paused: {reason} It starts no new work; the work that runs finishes. Continue, wrap up or stop?",
    "status.agent.hxTeam.continued": "Team · It goes on.",
    "status.agent.hxTeam.wrapUp": "Team · The lead wraps up with what the team has.",
    "status.agent.hxTeam.priority.urgent": "Team · More urgent: it goes before other teams until it ends.",
    "status.agent.hxTeam.priority.normal": "Team · Normal order again.",
    "status.agent.hxTeam.priority.relaxed": "Team · Not urgent: other teams go first until it ends.",
    "status.agent.hxTeam.spend.api": "Team · About ¥{yuan} spent so far. It goes on; name a limit to stop it there.",
    "status.agent.hxTeam.spend.plan": "Team · {percent}% of the plan's period is used. It goes on; name a limit to stop it there.",
    "status.agent.hxTeam.spend.tokens": "Team · About {millions} million tokens used so far (the price is not known). It goes on.",
}
STATUS_ZH = {
    "status.agent.hxTeam.handedOver": "协作 · {from} 把整件事转交给 {to}（第 {count} 次交接）。",
    "status.agent.hxTeam.progressOpen": "协作 · {count} 次交接 · {minutes} 分钟",
    "status.agent.hxTeam.progressPaused": "协作 · 已暂停，等你决定 · {count} 次交接 · {minutes} 分钟",
    "status.agent.hxTeam.paused": "协作暂停了：{reason}不开新的工作，在做的会做完。继续、收尾还是停？",
    "status.agent.hxTeam.continued": "协作 · 继续。",
    "status.agent.hxTeam.wrapUp": "协作 · 由带头的用已有的结果收尾。",
    "status.agent.hxTeam.priority.urgent": "协作 · 这件更急：做完之前排在别的团队前面。",
    "status.agent.hxTeam.priority.normal": "协作 · 恢复普通顺序。",
    "status.agent.hxTeam.priority.relaxed": "协作 · 这件不急：做完之前让别的团队先做。",
    "status.agent.hxTeam.spend.api": "协作 · 到现在约花了 {yuan} 元。团队照常工作；要设上限请直接说。",
    "status.agent.hxTeam.spend.plan": "协作 · 套餐本期额度已用 {percent}%。团队照常工作；要设上限请直接说。",
    "status.agent.hxTeam.spend.tokens": "协作 · 到现在约用了 {millions} 百万 token（价格未知）。团队照常工作。",
}
SETTINGS_EN = {
    "settings.hxAutoModel.team.capacity": "Team: members as the work needs; this computer decides how many work at once (now {count})",
    "settings.hxAutoModel.team.descriptionOpen":
        "Start on a card with several roles makes a team: HXBot picks agents by skill, makes members for missing "
        "roles and opens a team room. Progress and the result come back to this chat. A team has no limits; when it "
        "makes no progress, it pauses and asks you. To set a limit for one team, say so in the chat.",
}
SETTINGS_ZH = {
    "settings.hxAutoModel.team.capacity": "团队：人数按工作定；同时干活由电脑安排（现在 {count} 个）",
    "settings.hxAutoModel.team.descriptionOpen":
        "在有几个角色的建议卡上点“开始”就组队：HXBot 按专长选智能体，缺的角色新建成员，开一个协作房间。"
        "进度和结果回到这个对话。团队不设上限；没有进展时会停下来问你。想给某一次团队设上限，直接在对话里说。",
}


def text(r) -> None:
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/status/agent.ts", "\n});\n", STATUS_EN)
    r.add_messages(f"{messages}/zh/status/agent.ts", "\n} as const satisfies", STATUS_ZH)
    r.add_messages(f"{messages}/en/settings.ts", "\n});\n", SETTINGS_EN)
    r.add_messages(f"{messages}/zh/settings.ts", "\n} as const satisfies", SETTINGS_ZH)


def apply(r) -> None:
    text(r)
    idle_guard(r)
    turn_slots(r)
    drain(r)
    agent_service(r)
    application_services(r)
    channels(r)
    channel_store(r)
    channel_scheduling(r)
    channel_unread(r)
    side_usage(r)
    channel_capture(r)
    mailbox_index(r)
    router(r)
