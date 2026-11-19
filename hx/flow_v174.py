"""HXBot v1.7.4 并发（二）：提供商在途上限、等待看得见、过载换模型、裁判建议（需求规格说明书 V2.2 v1.7.4：
CONC-02、CONC-09、CONC-08、CONC-11）。

用户 2026-11-19 06:50：“两个合并一起做”“合并做！追赶进度，保证质量！”。

HX 自己的代码在 src/backend/hx-flow/：
- provider-gate.ts：每个“提供商＋账号＋模型”一个在途上限 L（按首个输出的快慢自适应，429 减半并暂停，真人优先）
- provider-model.ts：智能体的回合等的是哪个模型（本机模型 L 从 1 开始）

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
"""

from __future__ import annotations

import brand_rename

LIFECYCLE = 'src/backend/agent/turn-lifecycle.ts'
LIFECYCLE_IMPORT = 'import { hxProviderGate, hxRetryAfterMs } from "../hx-flow/provider-gate";'
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
SLOTS_IMPORT = 'import { hxProviderGate } from "../hx-flow/provider-gate";'
SLOTS_PAIRS = [
    ('  mayStart(lane: string): boolean {\n    const limit = this.#options.limit();\n    if (limit === null) return true;\n',
     "  mayStart(lane: string): boolean {\n    // HXBot (v1.7.4, CONC-02): the limit of the lane's provider, account and model comes first, with or\n    // without a machine limit; a person's message has one place more. A lane that its provider holds\n    // is not waiting for a slot (drain-scheduler.ts, isWaiting), so it takes no free place from this one.\n    const hxHead = this.#options.head(lane);\n    if (hxHead && !hxProviderGate.mayStart(lane, this.#hxPerson(lane, hxHead))) return false;\n    const limit = this.#options.limit();\n    if (limit === null) return true;\n"),
    ('    return ahead < free;\n  }\n}\n',
     '    return ahead < free;\n  }\n\n  /** HXBot (v1.7.4): a turn for a person\'s message, by its HX-Flow tier when the lanes have one. */\n  #hxPerson(lane: string, head: QueueDelivery): boolean {\n    const rank = this.#options.rank;\n    return rank ? rank(lane, head).tier === 0 : head.sender.kind === "user";\n  }\n}\n'),
]

DRAIN = 'src/backend/agent/drain-scheduler.ts'
DRAIN_IMPORTS = ['import { hxProviderGate } from "../hx-flow/provider-gate";', 'import { hxProviderModelOf } from "../hx-flow/provider-model";']
DRAIN_PAIRS = [
    ('      isWaiting: (key) => {\n        const lane = laneOf(key);\n        return (\n          this.#mayStartNow(lane) &&\n          this.#memory.mayDrain(lane.agentId) &&\n          this.#mailbox.nextQueued(lane.agentId, lane.taskId) !== null\n        );\n      },\n',
     '      isWaiting: (key) => {\n        const lane = laneOf(key);\n        const next =\n          this.#mayStartNow(lane) && this.#memory.mayDrain(lane.agentId)\n            ? this.#mailbox.nextQueued(lane.agentId, lane.taskId)\n            : null;\n        // HXBot (v1.7.4, CONC-02): a lane that its provider holds waits for the provider, not for a slot.\n        return next !== null && hxProviderGate.check(key, this.#hxPerson(key, next.delivery));\n      },\n'),
    ('          return this.#laneRunning(lane) || this.#compactionHolds(lane);\n        }),\n      ),\n    });\n  }\n',
     '          return this.#laneRunning(lane) || this.#compactionHolds(lane);\n        }),\n      ),\n    });\n    // HXBot (v1.7.4, CONC-02): the provider limits read each agent\'s model, once per microtask: a check\n    // asks for every waiting lane, and the list copies every agent.\n    const hxModels = hxTickMemo(\n      () => new Map(this.#store.list().map((agent) => [agent.id, hxProviderModelOf(agent)])),\n    );\n    hxProviderGate.attach({\n      modelOf: (agentId) => hxModels().get(agentId) ?? null,\n      wake: () => this.retrySlotWaiters(),\n    });\n  }\n\n  /** HXBot (v1.7.4): a turn for a person\'s message, by its HX-Flow tier. */\n  #hxPerson(key: string, head: DeliveryContext["delivery"]): boolean {\n    return hxFlow.rank(key, head, this.#channels?.store.assignmentForDelivery(head.id) ?? null).tier === 0;\n  }\n'),
    ('      // One message from the user lets one turn try a limit, so the other lanes stay held.\n      this.#usageLimits.tryStarted(agentId);\n',
     '      // HXBot (v1.7.4, CONC-02): the start waits for its model until its turn starts.\n      hxProviderGate.starting(key, this.#hxPerson(key, context.delivery));\n      // One message from the user lets one turn try a limit, so the other lanes stay held.\n      this.#usageLimits.tryStarted(agentId);\n'),
    ('        Effect.sync(() => {\n          this.#drainingLanes.delete(key);\n',
     '        Effect.sync(() => {\n          this.#drainingLanes.delete(key);\n          // HXBot (v1.7.4, CONC-02): a start that ended with no turn frees its place under the provider limit.\n          if (!this.#laneRunning(lane)) hxProviderGate.startEnded(key);\n'),
]


USAGE = 'src/backend/agent/usage-collection.ts'
USAGE_IMPORT = 'import { hxTagSideObserver } from "../hx-flow/provider-side";'
USAGE_PAIRS = [
    ('  const session = { id: `${kind}:${randomUUID()}`, provider, createdAt: new Date().toISOString() };\n  return ({ method, params }) => {\n    try {\n      collectProviderUsage(usage, { id: agentId, model }, session, method, params);\n    } catch (error) {\n      logger.warn("Could not save the usage of a side session.", { kind, provider, error });\n    }\n  };\n',
     '  const session = { id: `${kind}:${randomUUID()}`, provider, createdAt: new Date().toISOString() };\n  // HXBot (v1.7.4, CONC-02): the kind tells generateTextWithoutTools which place the call takes.\n  return hxTagSideObserver(({ method, params }: { method: string; params?: unknown }) => {\n    try {\n      collectProviderUsage(usage, { id: agentId, model }, session, method, params);\n    } catch (error) {\n      logger.warn("Could not save the usage of a side session.", { kind, provider, error });\n    }\n  }, kind);\n'),
]

PROFILE = 'src/backend/agent/profile-generation.ts'
PROFILE_IMPORT = 'import { hxSidePlace } from "../hx-flow/provider-side";'
PROFILE_PAIRS = [
    ('  mode: ToollessMode = "text",\n) {\n  let cleanupFailure: ProfileGenerationFailed | null = null;\n  const result = yield* Effect.acquireUseRelease(\n    makeToollessDirectory(),\n',
     '  mode: ToollessMode = "text",\n) {\n  let cleanupFailure: ProfileGenerationFailed | null = null;\n  // HXBot (v1.7.4, CONC-02): HXBot\'s own model call takes a place under the limit of its provider,\n  // account and model (src/backend/hx-flow/provider-side.ts), and gives it back at the end.\n  const hxRelease = yield* Effect.promise(() => hxSidePlace(model, observe, cancelled));\n  const result = yield* Effect.acquireUseRelease(\n    makeToollessDirectory(),\n'),
    ('        if (Result.isFailure(stopped)) cleanupFailure = stopped.failure;\n      }),\n  );\n',
     '        if (Result.isFailure(stopped)) cleanupFailure = stopped.failure;\n      }),\n  ).pipe(Effect.ensuring(Effect.sync(hxRelease)));\n'),
]


def provider_limit(r) -> None:
    """CONC-02：回合、轮次位置、排队三处接上提供商在途上限。"""
    brand_rename.add_import(r, LIFECYCLE, LIFECYCLE_IMPORT)
    for old, new in LIFECYCLE_PAIRS:
        r.replace(LIFECYCLE, old, new)
    brand_rename.add_import(r, SLOTS, SLOTS_IMPORT)
    for old, new in SLOTS_PAIRS:
        r.replace(SLOTS, old, new)
    for line in reversed(DRAIN_IMPORTS):
        brand_rename.add_import(r, DRAIN, line)
    for old, new in DRAIN_PAIRS:
        r.replace(DRAIN, old, new)


def side_calls(r) -> None:
    """CONC-02：HXBot 自己用模型做的事（频道摘要和路由、记忆整理、旁问、网页搜索、资料和标题）按种类占位置。"""
    brand_rename.add_import(r, USAGE, USAGE_IMPORT)
    for old, new in USAGE_PAIRS:
        r.replace(USAGE, old, new)
    brand_rename.add_import(r, PROFILE, PROFILE_IMPORT)
    for old, new in PROFILE_PAIRS:
        r.replace(PROFILE, old, new)


def apply(r) -> None:
    provider_limit(r)
    side_calls(r)
