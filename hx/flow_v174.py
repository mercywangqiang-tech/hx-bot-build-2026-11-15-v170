"""HXBot v1.7.4 并发（二）：提供商在途上限、等待看得见、过载换模型、裁判建议（需求规格说明书 V2.2 v1.7.4：
CONC-02、CONC-09、CONC-08、CONC-11）。

用户 2026-11-19 06:50：“两个合并一起做”“合并做！追赶进度，保证质量！”。

HX 自己的代码在 src/backend/hx-flow/：
- provider-gate.ts：每个“提供商＋账号＋模型”一个在途上限 L（按首个输出的快慢自适应，429 减半并暂停，真人优先）
- provider-model.ts：智能体的回合等的是哪个模型（本机模型 L 从 1 开始）
- provider-side.ts：HXBot 自己用模型做的事按种类占位置
- hold-detail.ts：每个等待的原因、排第几、大约多久（CONC-09），每 5 秒算一遍，有变化才发

这一步改上游文件，只做接线：
1. 回合（turn-lifecycle.ts）：回合开始、首个输出、工具步骤开合、回合结束告诉提供商上限；短时限速（429，不是套餐
   用完）让它减半并暂停。HXBot 不替 CLI 重试。
2. 轮次位置（turn-slots.ts）：先看线路的提供商上限（有没有机器上限都看），真人多一个位置。
3. 排队（drain-scheduler.ts）：被提供商挡住的线路不算“在等位置”，不占别的线路的空位；把每个智能体的模型告诉
   提供商上限（一个微任务里只读一次智能体列表）、上限放开时重试等位置的线路；开始一条消息时先记为在途，没开成
   回合就放掉。v1.7.1 那一步（hx/flow.py）插进来的文字原样不动，这里只在它前后加。
4. 旁路调用（usage-collection.ts、profile-generation.ts）：HXBot 自己用模型做的事都经 generateTextWithoutTools，
   按用量记录的种类在提供商上限下占位置（旁问、网页搜索是真人的，不等；频道 15 秒；后台 30 秒，等不到就照常
   做并记日志）。
5. 合同（ipc-queue.ts、ipc-agent-tasks.ts）：等待原因的值不加新的，详情放可选字段 holdDetail = {kind, position,
   etaSeconds}；已发布 0.67.9 的解码器不认识也照常解码（夹具测试），冻结的团队接口路由不带它。
6. 任务列表（agent-tasks.ts）、对话队列（mailbox-sync.ts）带上 holdDetail，它变了时各自发出更新。
"""

from __future__ import annotations

import brand_rename

LIFECYCLE = 'src/backend/agent/turn-lifecycle.ts'
LIFECYCLE_IMPORTS = ['import { hxProviderGate, hxRetryAfterMs } from "../hx-flow/provider-gate";']
LIFECYCLE_PAIRS = [
    ('          acted: false,\n          openTools: new Set(),\n        });\n',
     '          acted: false,\n          openTools: new Set(),\n        });\n        // HXBot (v1.7.4, CONC-02): the turn waits for its model until its first output (src/backend/hx-flow).\n        hxProviderGate.turnStarted(turnId, agentId, taskId, starting?.text.length ?? 0);\n'),
    ('    if (streamed) running.firstOutputAt ??= Date.now();\n',
     "    if (streamed && running.firstOutputAt === null) {\n      running.firstOutputAt = Date.now();\n      // HXBot (v1.7.4, CONC-02): one sample of the model's speed.\n      hxProviderGate.firstOutput(turnId);\n    }\n"),
    ('      if (completed) lastToolClosed = openTools.delete(item.id) && openTools.size === 0;\n      else openTools.add(item.id);\n',
     '      if (completed) lastToolClosed = openTools.delete(item.id) && openTools.size === 0;\n      else openTools.add(item.id);\n      // HXBot (v1.7.4, CONC-02): in a tool step the turn works here, it does not wait for the model.\n      hxProviderGate.toolSteps(turnId, openTools.size);\n'),
    ('    for (const [turnId, turn] of this.#runningTurns) {\n      if (turn.client !== client) continue;\n      this.#runningTurns.delete(turnId);\n',
     '    for (const [turnId, turn] of this.#runningTurns) {\n      if (turn.client !== client) continue;\n      this.#runningTurns.delete(turnId);\n      hxProviderGate.turnEnded(turnId);\n'),
    ('      const running = this.#runningTurns.get(turnId);\n      this.#runningTurns.delete(turnId);\n',
     '      const running = this.#runningTurns.get(turnId);\n      this.#runningTurns.delete(turnId);\n      hxProviderGate.turnEnded(turnId);\n'),
    ('    if (running) this.#keepTurnTiming(turnId, running);\n    this.#runningTurns.delete(turnId);\n',
     '    if (running) this.#keepTurnTiming(turnId, running);\n    this.#runningTurns.delete(turnId);\n    hxProviderGate.turnEnded(turnId);\n'),
    ('        const causeCode = reportedCause ?? classifyFailure(error ?? message);\n',
     '        const causeCode = reportedCause ?? classifyFailure(error ?? message);\n        // HXBot (v1.7.4, CONC-02): a short throttle (a 429, not a spent plan) halves the limit of the\n        // provider, account and model, and pauses it. The CLI retries by itself; HXBot does not.\n        if (causeCode === "rate_limit" && !isUsageLimitDiagnostic(message) && !isPlanLimitDiagnostic(message))\n          hxProviderGate.throttled(getString(params, "turnId"), agentId ?? null, hxRetryAfterMs(message));\n'),
]

SLOTS = 'src/backend/agent/turn-slots.ts'
SLOTS_IMPORTS = ['import { hxProviderGate } from "../hx-flow/provider-gate";']
SLOTS_PAIRS = [
    ('  mayStart(lane: string): boolean {\n    const limit = this.#options.limit();\n    if (limit === null) return true;\n',
     "  mayStart(lane: string): boolean {\n    // HXBot (v1.7.4, CONC-02): the limit of the lane's provider, account and model comes first, with or\n    // without a machine limit; a person's message has one place more. A lane that its provider holds\n    // is not waiting for a slot (drain-scheduler.ts, isWaiting), so it takes no free place from this one.\n    const hxHead = this.#options.head(lane);\n    if (hxHead && !hxProviderGate.mayStart(lane, this.#hxPerson(lane, hxHead))) return false;\n    const limit = this.#options.limit();\n    if (limit === null) return true;\n"),
    ('    return ahead < free;\n  }\n}\n',
     '    return ahead < free;\n  }\n\n  /** HXBot (v1.7.4): a turn for a person\'s message, by its HX-Flow tier when the lanes have one. */\n  #hxPerson(lane: string, head: QueueDelivery): boolean {\n    const rank = this.#options.rank;\n    return rank ? rank(lane, head).tier === 0 : head.sender.kind === "user";\n  }\n}\n'),
]

DRAIN = 'src/backend/agent/drain-scheduler.ts'
DRAIN_IMPORTS = ['import { hxHoldDetails } from "../hx-flow/hold-detail";', 'import { hxProviderGate } from "../hx-flow/provider-gate";', 'import { hxProviderModelOf } from "../hx-flow/provider-model";']
DRAIN_PAIRS = [
    ('      isWaiting: (key) => {\n        const lane = laneOf(key);\n        return (\n          this.#mayStartNow(lane) &&\n          this.#memory.mayDrain(lane.agentId) &&\n          this.#mailbox.nextQueued(lane.agentId, lane.taskId) !== null\n        );\n      },\n',
     '      isWaiting: (key) => {\n        const lane = laneOf(key);\n        const next =\n          this.#mayStartNow(lane) && this.#memory.mayDrain(lane.agentId)\n            ? this.#mailbox.nextQueued(lane.agentId, lane.taskId)\n            : null;\n        // HXBot (v1.7.4, CONC-02): a lane that its provider holds waits for the provider, not for a slot.\n        return next !== null && hxProviderGate.check(key, this.#hxPerson(key, next.delivery));\n      },\n'),
    ('          return this.#laneRunning(lane) || this.#compactionHolds(lane);\n        }),\n      ),\n    });\n  }\n',
     '          return this.#laneRunning(lane) || this.#compactionHolds(lane);\n        }),\n      ),\n    });\n    // HXBot (v1.7.4, CONC-02): the provider limits read each agent\'s model, once per microtask: a check\n    // asks for every waiting lane, and the list copies every agent.\n    const hxModels = hxTickMemo(\n      () => new Map(this.#store.list().map((agent) => [agent.id, hxProviderModelOf(agent)])),\n    );\n    hxProviderGate.attach({\n      modelOf: (agentId) => hxModels().get(agentId) ?? null,\n      wake: () => this.retrySlotWaiters(),\n    });\n    // HXBot (v1.7.4, CONC-09): the lanes that wait for a slot or their provider, for the place a wait shows.\n    hxHoldDetails.attachDrain({\n      waiting: () =>\n        [...this.#slotWaiters].flatMap((key) => {\n          const lane = laneOf(key);\n          const head = this.#mailbox.nextQueued(lane.agentId, lane.taskId)?.delivery;\n          if (!head) return [];\n          const assignment = this.#channels?.store.assignmentForDelivery(head.id) ?? null;\n          return [{ lane: key, candidate: hxFlow.rank(key, head, assignment) }];\n        }),\n      limit: () => this.#memory.turnLimit(),\n    });\n  }\n\n  /** HXBot (v1.7.4): a turn for a person\'s message, by its HX-Flow tier. */\n  #hxPerson(key: string, head: DeliveryContext["delivery"]): boolean {\n    return hxFlow.rank(key, head, this.#channels?.store.assignmentForDelivery(head.id) ?? null).tier === 0;\n  }\n'),
    ('      // One message from the user lets one turn try a limit, so the other lanes stay held.\n      this.#usageLimits.tryStarted(agentId);\n',
     '      // HXBot (v1.7.4, CONC-02): the start waits for its model until its turn starts.\n      hxProviderGate.starting(key, this.#hxPerson(key, context.delivery));\n      // One message from the user lets one turn try a limit, so the other lanes stay held.\n      this.#usageLimits.tryStarted(agentId);\n'),
    ('        Effect.sync(() => {\n          this.#drainingLanes.delete(key);\n',
     '        Effect.sync(() => {\n          this.#drainingLanes.delete(key);\n          // HXBot (v1.7.4, CONC-02): a start that ended with no turn frees its place under the provider limit.\n          if (!this.#laneRunning(lane)) hxProviderGate.startEnded(key);\n'),
]

USAGE = 'src/backend/agent/usage-collection.ts'
USAGE_IMPORTS = ['import { hxTagSideObserver } from "../hx-flow/provider-side";']
USAGE_PAIRS = [
    ('  const session = { id: `${kind}:${randomUUID()}`, provider, createdAt: new Date().toISOString() };\n  return ({ method, params }) => {\n    try {\n      collectProviderUsage(usage, { id: agentId, model }, session, method, params);\n    } catch (error) {\n      logger.warn("Could not save the usage of a side session.", { kind, provider, error });\n    }\n  };\n',
     '  const session = { id: `${kind}:${randomUUID()}`, provider, createdAt: new Date().toISOString() };\n  // HXBot (v1.7.4, CONC-02): the kind tells generateTextWithoutTools which place the call takes.\n  return hxTagSideObserver(({ method, params }: { method: string; params?: unknown }) => {\n    try {\n      collectProviderUsage(usage, { id: agentId, model }, session, method, params);\n    } catch (error) {\n      logger.warn("Could not save the usage of a side session.", { kind, provider, error });\n    }\n  }, kind);\n'),
]

PROFILE = 'src/backend/agent/profile-generation.ts'
PROFILE_IMPORTS = ['import { hxSidePlace } from "../hx-flow/provider-side";']
PROFILE_PAIRS = [
    ('  mode: ToollessMode = "text",\n) {\n  let cleanupFailure: ProfileGenerationFailed | null = null;\n  const result = yield* Effect.acquireUseRelease(\n    makeToollessDirectory(),\n',
     '  mode: ToollessMode = "text",\n) {\n  let cleanupFailure: ProfileGenerationFailed | null = null;\n  // HXBot (v1.7.4, CONC-02): HXBot\'s own model call takes a place under the limit of its provider,\n  // account and model (src/backend/hx-flow/provider-side.ts), and gives it back at the end.\n  const hxRelease = yield* Effect.promise(() => hxSidePlace(model, observe, cancelled));\n  const result = yield* Effect.acquireUseRelease(\n    makeToollessDirectory(),\n'),
    ('        if (Result.isFailure(stopped)) cleanupFailure = stopped.failure;\n      }),\n  );\n',
     '        if (Result.isFailure(stopped)) cleanupFailure = stopped.failure;\n      }),\n  ).pipe(Effect.ensuring(Effect.sync(hxRelease)));\n'),
]

QUEUE = 'packages/contracts/src/ipc-queue.ts'
QUEUE_IMPORTS = []
QUEUE_PAIRS = [
    ('export interface QueueSnapshot {\n  agentId: string;\n  deliveries: QueueDelivery[];\n',
     '/**\n * HXBot (v1.7.4, CONC-09): what a wait waits for, its place and about how long. The hold reasons stay\n * as they are; this optional field carries the detail, and a released decoder ignores it.\n * - `machine`: this computer runs as many turns as it can;\n * - `provider`: the model\'s provider is at its limit or paused after a throttle;\n * - `screen`: the screen is used by another agent; `user-active`: the user uses it;\n * - `team-queue`: the team\'s work waits for a place.\n * `position` 1 is next; `etaSeconds` is an estimate (place × the recent turn time ÷ the places).\n */\nexport const HX_HOLD_KINDS = ["machine", "provider", "screen", "user-active", "team-queue"] as const;\nexport type HxHoldKind = (typeof HX_HOLD_KINDS)[number];\n\nexport interface HxHoldDetail {\n  kind: HxHoldKind;\n  position: number | null;\n  etaSeconds: number | null;\n}\n\n/** The most a place or an estimate can be: a larger value is not a wait that a person reads. */\nconst HX_HOLD_MAX = 1_000_000;\n\nexport function isHxHoldDetail(value: unknown): value is HxHoldDetail {\n  const count = (item: unknown, least: number) =>\n    item === null || (typeof item === "number" && Number.isSafeInteger(item) && item >= least && item <= HX_HOLD_MAX);\n  return (\n    isDynamicRecord(value) &&\n    isOneOf(HX_HOLD_KINDS, value.kind) &&\n    count(value.position, 1) &&\n    count(value.etaSeconds, 0)\n  );\n}\n\nexport interface QueueSnapshot {\n  agentId: string;\n  deliveries: QueueDelivery[];\n'),
    ('  hold?: QueueHold | null;\n}\n',
     '  hold?: QueueHold | null;\n  /** HXBot (v1.7.4, CONC-09): why the queued messages wait, when the computer or the provider holds them. */\n  holdDetail?: HxHoldDetail;\n}\n'),
    ('    (value.hold === undefined || value.hold === null || isQueueHold(value.hold))\n  );\n}\n',
     '    (value.hold === undefined || value.hold === null || isQueueHold(value.hold)) &&\n    (value.holdDetail === undefined || isHxHoldDetail(value.holdDetail))\n  );\n}\n'),
]

TASK_CONTRACT = 'packages/contracts/src/ipc-agent-tasks.ts'
TASK_CONTRACT_IMPORTS = []
TASK_CONTRACT_PAIRS = [
    ('  routineId?: string | null;\n}\n\n/** Where a branch was copied from. */\n',
     '  routineId?: string | null;\n  /** HXBot (v1.7.4, CONC-09): the place and the time of a `server-busy` wait. Absent on the Team API. */\n  holdDetail?: HxHoldDetail;\n}\n\n/** Where a branch was copied from. */\n'),
    ('    (value.routineId === undefined || value.routineId === null || isIdentifier(value.routineId))\n  );\n}\n',
     '    (value.routineId === undefined || value.routineId === null || isIdentifier(value.routineId)) &&\n    (value.holdDetail === undefined || isHxHoldDetail(value.holdDetail))\n  );\n}\n'),
    ('import { isQueueDelivery, type QueueDelivery } from "./ipc-queue";\n',
     'import { type HxHoldDetail, isHxHoldDetail, isQueueDelivery, type QueueDelivery } from "./ipc-queue";\n'),
]

TASKS = 'src/backend/agent-tasks/agent-tasks.ts'
TASKS_IMPORTS = ['import { hxHoldDetails, hxTaskHoldDetail } from "../hx-flow/hold-detail";']
TASKS_PAIRS = [
    ('      branch: this.#publicBranch(task),\n      routineId: task.routineId,\n    };\n  }\n',
     '      branch: this.#publicBranch(task),\n      routineId: task.routineId,\n      // HXBot (v1.7.4, CONC-09): the place and the time of a wait for the computer or the provider.\n      ...hxTaskHoldDetail(hold, task.agentId, task.taskId),\n    };\n  }\n'),
    ('    this.#conversation = options.conversation;\n    this.#hooks = options.hooks;\n  }\n',
     '    this.#conversation = options.conversation;\n    this.#hooks = options.hooks;\n    // HXBot (v1.7.4, CONC-09): a wait whose place or time moved reaches the task list.\n    hxHoldDetails.attach("tasks", (agentId) => this.changed(agentId));\n  }\n'),
]

SYNC = 'src/backend/agent/mailbox-sync.ts'
SYNC_IMPORTS = ['import { hxHoldDetails } from "../hx-flow/hold-detail";']
SYNC_PAIRS = [
    ('    const hold = this.#hooks.queueHold(agentId);\n    return hold ? { ...queue, hold } : queue;\n',
     '    const hold = this.#hooks.queueHold(agentId);\n    // HXBot (v1.7.4, CONC-09): the place and the time of a wait for the computer or the provider.\n    const holdDetail = hxHoldDetails.of(agentId);\n    return { ...queue, ...(hold ? { hold } : {}), ...(holdDetail ? { holdDetail } : {}) };\n'),
    ('    this.#scope = options.scope;\n    this.#hooks = options.hooks;\n',
     '    this.#scope = options.scope;\n    this.#hooks = options.hooks;\n    // HXBot (v1.7.4, CONC-09): a wait whose place or time moved reaches the chat.\n    hxHoldDetails.attach("queue", (agentId) => this.emitQueue(agentId));\n'),
]

QUEUE_PANEL = 'packages/ui/src/features/conversation/QueuePanel.tsx'
QUEUE_PANEL_IMPORTS = ['import { hxHoldDetailText } from "./hx-hold-text";']
QUEUE_PANEL_PAIRS = [
    ('import type { QueueDelivery, QueueHold, QueueSteerFallback } from "@hxbot/contracts/ipc";\n',
     'import type { HxHoldDetail, QueueDelivery, QueueHold, QueueSteerFallback } from "@hxbot/contracts/ipc";\n'),
    ('  hold?: QueueHold | null | undefined;\n  agents?: ComposerAgent[];\n',
     '  hold?: QueueHold | null | undefined;\n  /** HXBot (v1.7.4, CONC-09): what the queued messages wait for, their place and about how long. */\n  holdDetail?: HxHoldDetail | null | undefined;\n  agents?: ComposerAgent[];\n'),
    ('        <Show when={props.hold}>\n          {(hold) => (\n            <p class="agent-queue-hold" role="status">\n              {holdText(hold())}\n            </p>\n          )}\n        </Show>\n',
     '        <Show when={props.hold}>\n          {(hold) => (\n            <p class="agent-queue-hold" role="status">\n              {holdText(hold())}\n            </p>\n          )}\n        </Show>\n        <Show when={props.holdDetail}>\n          {(detail) => (\n            <p class="agent-queue-hold" role="status">\n              {hxHoldDetailText(detail(), t)}\n            </p>\n          )}\n        </Show>\n'),
]

THREAD_VIEW = 'packages/ui/src/features/conversation/threads/AgentThreadView.tsx'
THREAD_VIEW_IMPORTS = ['import { hxHoldDetailText } from "../hx-hold-text";']
THREAD_VIEW_PAIRS = [
    ('  if (task.hold === "task-limit" || task.hold === null)\n    return t("conversation.threads.hold.threadLimit", { count: limit });\n  return t(HOLD_TEXT[task.hold]);\n',
     '  if (task.hold === "task-limit" || task.hold === null)\n    return t("conversation.threads.hold.threadLimit", { count: limit });\n  // HXBot (v1.7.4, CONC-09): a wait for the computer or the provider says its place and about how long.\n  if (task.hold === "server-busy" && task.holdDetail) return hxHoldDetailText(task.holdDetail, t);\n  return t(HOLD_TEXT[task.hold]);\n'),
]

COMPOSER = 'src/renderer/src/features/conversation/ConversationComposer.tsx'
COMPOSER_IMPORTS = []
COMPOSER_PAIRS = [
    ('                      hold={props.queue?.hold?.agentId === props.agent?.id ? null : props.queue?.hold}\n',
     '                      hold={props.queue?.hold?.agentId === props.agent?.id ? null : props.queue?.hold}\n                      holdDetail={props.queue?.holdDetail}\n'),
]


def _apply(r, path: str, imports: list[str], items: list[tuple[str, str]]) -> None:
    for line in reversed(imports):
        brand_rename.add_import(r, path, line)
    for old, new in items:
        r.replace(path, old, new)


def provider_limit(r) -> None:
    """CONC-02：回合、轮次位置、排队三处接上提供商在途上限。"""
    _apply(r, LIFECYCLE, LIFECYCLE_IMPORTS, LIFECYCLE_PAIRS)
    _apply(r, SLOTS, SLOTS_IMPORTS, SLOTS_PAIRS)
    _apply(r, DRAIN, DRAIN_IMPORTS, DRAIN_PAIRS)


def side_calls(r) -> None:
    """CONC-02：HXBot 自己用模型做的事（频道摘要和路由、记忆整理、旁问、网页搜索、资料和标题）按种类占位置。"""
    _apply(r, USAGE, USAGE_IMPORTS, USAGE_PAIRS)
    _apply(r, PROFILE, PROFILE_IMPORTS, PROFILE_PAIRS)


def hold_details(r) -> None:
    """CONC-09：等待的原因、排第几、大约多久：合同的可选字段 holdDetail，任务和对话队列带上，有变化就发出去。"""
    _apply(r, QUEUE, QUEUE_IMPORTS, QUEUE_PAIRS)
    _apply(r, TASK_CONTRACT, TASK_CONTRACT_IMPORTS, TASK_CONTRACT_PAIRS)
    _apply(r, TASKS, TASKS_IMPORTS, TASKS_PAIRS)
    _apply(r, SYNC, SYNC_IMPORTS, SYNC_PAIRS)
    _apply(r, QUEUE_PANEL, QUEUE_PANEL_IMPORTS, QUEUE_PANEL_PAIRS)
    _apply(r, THREAD_VIEW, THREAD_VIEW_IMPORTS, THREAD_VIEW_PAIRS)
    _apply(r, COMPOSER, COMPOSER_IMPORTS, COMPOSER_PAIRS)


CONVERSATION_EN = {
    'conversation.hx.hold.place':
        'Queued (place {position}, about {time}). {reason}',
    'conversation.hx.hold.placeOnly':
        'Queued (place {position}). {reason}',
    'conversation.hx.hold.minutes':
        '{count} min',
    'conversation.hx.hold.underMinute':
        'under a minute',
    'conversation.hx.hold.machine':
        'This computer runs as many turns as it can now.',
    'conversation.hx.hold.provider':
        "The model's provider takes no more requests now, or pauses after a rate limit.",
    'conversation.hx.hold.screen':
        'Another agent uses the screen.',
    'conversation.hx.hold.userActive':
        'You are using the computer.',
    'conversation.hx.hold.teamQueue':
        "The team's work waits for a place.",
}

CONVERSATION_ZH = {
    'conversation.hx.hold.place':
        '排队（第 {position} 位，约 {time}）。{reason}',
    'conversation.hx.hold.placeOnly':
        '排队（第 {position} 位）。{reason}',
    'conversation.hx.hold.minutes':
        '{count} 分钟',
    'conversation.hx.hold.underMinute':
        '不到 1 分钟',
    'conversation.hx.hold.machine':
        '这台电脑能同时运行的轮次已满。',
    'conversation.hx.hold.provider':
        '模型服务商现在不再接更多请求，或限速后在暂停。',
    'conversation.hx.hold.screen':
        '另一个助手正在用屏幕。',
    'conversation.hx.hold.userActive':
        '你正在用电脑。',
    'conversation.hx.hold.teamQueue':
        '团队的工作在排队。',
}

STATUS_EN = {
    'status.agent.hxTeam.card.paused':
        'Paused: {reason}',
    'status.agent.hxTeam.card.urgent':
        'More urgent: it goes before other teams. Say “not urgent” to change it.',
    'status.agent.hxTeam.card.relaxed':
        'Not urgent: other teams go first. Say “urgent” to change it.',
    'status.agent.hxTeam.member.doing':
        '{name}: doing “{what}”',
    'status.agent.hxTeam.member.queued':
        '{name}: queued (place {position}, about {minutes} min)',
    'status.agent.hxTeam.member.after':
        '{name}: starts when the work it needs is done',
    'status.agent.hxTeam.member.reply':
        '{name}: waits for a reply',
    'status.agent.hxTeam.member.screen':
        '{name}: waits for the screen',
    'status.agent.hxTeam.member.yourTurn':
        '{name}: waits until you stop using the computer',
    'status.agent.hxTeam.member.free':
        '{name}: free',
    'status.agent.hxAutoModel.overloadPaused':
        'The provider of {from} is paused after a rate limit: this new work uses {to}.',
    'status.agent.hxAutoModel.overloadQueue':
        'Work waits long for {from}: this new work uses {to}.',
    'status.agent.hxTeam.overloadMove':
        'Team · {name}: the provider of {from} has been paused for minutes, so its new work uses {to}.',
    'status.agent.hxTeam.card.judge':
        "The judge's view (advice only): {verdict}. {reason}",
}

STATUS_ZH = {
    'status.agent.hxTeam.card.paused':
        '已暂停：{reason}',
    'status.agent.hxTeam.card.urgent':
        '这件更急：排在别的团队前面。说“不急”可以改回。',
    'status.agent.hxTeam.card.relaxed':
        '这件不急：别的团队先做。说“更急”可以改回。',
    'status.agent.hxTeam.member.doing':
        '{name}：在做“{what}”',
    'status.agent.hxTeam.member.queued':
        '{name}：排队（第 {position} 位，约 {minutes} 分钟）',
    'status.agent.hxTeam.member.after':
        '{name}：等它需要的工作做完再开始',
    'status.agent.hxTeam.member.reply':
        '{name}：等回复',
    'status.agent.hxTeam.member.screen':
        '{name}：等屏幕',
    'status.agent.hxTeam.member.yourTurn':
        '{name}：等你停手再用电脑',
    'status.agent.hxTeam.member.free':
        '{name}：空闲',
    'status.agent.hxAutoModel.overloadPaused':
        '{from} 的服务商限速后在暂停：这件新工作改用 {to}。',
    'status.agent.hxAutoModel.overloadQueue':
        '{from} 前面排队太久：这件新工作改用 {to}。',
    'status.agent.hxTeam.overloadMove':
        '团队 · {name}：{from} 的服务商已暂停好几分钟，它的新工作改用 {to}。',
    'status.agent.hxTeam.card.judge':
        '裁判的看法（只供参考）：{verdict}。{reason}',
}


def text(r) -> None:
    """界面文字（英文、中文在这里；其他 13 种语言在 hx/translations_v174.py）。"""
    messages = "packages/i18n/src/messages"
    r.add_messages(f"{messages}/en/status/agent.ts", "\n});\n", STATUS_EN)
    r.add_messages(f"{messages}/zh/status/agent.ts", "\n} as const satisfies", STATUS_ZH)
    r.add_messages(f"{messages}/en/conversation.ts", "\n});\n", CONVERSATION_EN)
    r.add_messages(f"{messages}/zh/conversation.ts", "\n} as const satisfies", CONVERSATION_ZH)


def apply(r) -> None:
    provider_limit(r)
    side_calls(r)
    hold_details(r)
    text(r)
