"""v1.7.5 对上游文件的改动（由 /home/claude/v175/tools/genstep.py 从工作区生成，hx/routines_v175.py 调用）。"""

FILES = [
    ('packages/contracts/src/ipc-events.ts', [
        'import type { HxRoutineFlags } from "./ipc-routines";',
    ], [
        (
         '  updatedAt: string;\n',
         '  updatedAt: string;\n'
         "  /** HXBot (v1.7.5): only from this computer's host. */\n"
         '  hx?: HxRoutineFlags;\n',
        ),
    ]),
    ('packages/contracts/src/ipc-routines.ts', [
    ], [
        (
         ' */\n'
         'export interface RoutineFields {\n',
         ' */\n'
         '/**\n'
         " * HXBot (v1.7.5): what HXBot adds to a routine of this computer's host. The released Team API routes\n"
         ' * project a fixed key list, so a remote client never gets it.\n'
         ' */\n'
         "/** HXBot (v1.7.5, RTN-02, MIG-03): a run that waits for the person's yes, with what the answer needs. */\n"
         'export interface HxRoutineWaiting {\n'
         '  cardId: string;\n'
         '  scheduledFor: string;\n'
         '  reason: "each" | "catch-up";\n'
         '  actions: Array<"send" | "publish" | "pay" | "delete">;\n'
         '  missed?: { total: number; truncated: boolean; from: string; until: string };\n'
         '  expiresAt: string;\n'
         '}\n'
         '\n'
         'export interface HxRoutineFlags {\n'
         '  /** MIG-03: the routine came from an earlier version, and nobody has confirmed its zone yet. */\n'
         '  zoneUnconfirmed?: boolean;\n'
         '  /** MIG-03: each run asks first, because the instruction sends, posts, pays or deletes. */\n'
         '  confirmEach?: boolean;\n'
         '  /** MIG-03: what the upgrade to v1.7.5 changed on this routine. */\n'
         '  upgraded?: { at: string; changes: Array<"zone-unconfirmed" | "confirm-each"> };\n'
         '  /**\n'
         '   * RTN-06: what the routine has waiting, read back from the scheduler: runs that did not start and\n'
         '   * questions that wait for the yes. The run that works now, if any, apart.\n'
         '   */\n'
         '  queue?: { queued: number; running: { runId: string; status: string; deliveryId: string | null } | null };\n'
         '  /** RTN-04: the result of the newest run, so the list marks a result that is not verified. */\n'
         '  lastResult?: "succeeded" | "no-update" | "unverified" | "failed";\n'
         '  /** RTN-02, MIG-03: the runs that wait for the yes; the list answers them. */\n'
         '  waiting?: HxRoutineWaiting[];\n'
         '}\n'
         '\n'
         'export interface RoutineFields {\n',
        ),
        (
         '  runIn?: RoutineRunPlace;\n'
         '  createdAt: string;\n'
         '  updatedAt: string;\n'
         '}\n'
         '\n',
         '  runIn?: RoutineRunPlace;\n'
         '  createdAt: string;\n'
         '  updatedAt: string;\n'
         '  /** HXBot (v1.7.5). */\n'
         '  hx?: HxRoutineFlags;\n'
         '}\n'
         '\n',
        ),
        (
         '  missed?: RoutineMissedRuns;\n'
         '  createdAt: string;\n'
         '  updatedAt: string;\n'
         '}\n'
         '\n',
         '  missed?: RoutineMissedRuns;\n'
         '  createdAt: string;\n'
         '  updatedAt: string;\n'
         "  /** HXBot (v1.7.5): what HXBot records about the run. Only this computer's host sends it. */\n"
         '  hx?: HxRunFlags;\n'
         '}\n'
         '\n'
         '/** HXBot (v1.7.5, RTN-02, RTN-03, RTN-04): what HXBot records about a run. */\n'
         'export interface HxRunFlags {\n'
         '  /** Why this occurrence did not run. */\n'
         '  /** `unasked`: the run needs the yes and nothing could ask, so it did not run (it never runs unasked). */\n'
         '  skip?: "previous-running" | "plan-limit" | "declined" | "expired" | "cancelled" | "unasked";\n'
         '  /** Occurrences that came due while HXBot was closed or the computer slept, and what the policy did. */\n'
         '  missed?: { total: number; from: string; until: string; handled: "skip" | "run-once"; while: "closed" | "asleep" };\n'
         '  /** This run makes up for missed occurrences. */\n'
         '  catchUp?: { total: number };\n'
         '  /** The result; absent until HXBot judged the run. */\n'
         '  result?: "succeeded" | "no-update" | "unverified" | "failed";\n'
         '}\n'
         '\n',
        ),
        (
         '  missedPolicy?: RoutineMissedPolicy;\n'
         '  runIn?: RoutineRunPlace;\n'
         '}\n',
         '  missedPolicy?: RoutineMissedPolicy;\n'
         '  runIn?: RoutineRunPlace;\n'
         '  /** HXBot (v1.7.5, RTN-01): an IANA zone. Left out, the routine keeps its zone. */\n'
         '  timezone?: string;\n'
         '}\n',
        ),
    ]),
    ('packages/team-client/src/routine-schedule.ts', [
    ], [
        (
         '  exactTimes?: Set<string>;\n',
         '  exactTimes?: Set<string>;\n'
         '  /**\n'
         '   * HXBot (v1.7.5, RTN-01): the schedule names its hours, as a daily, weekly or monthly time does. A\n'
         '   * time of day in a spring gap then runs at the first minute after the gap, and a time that the fall\n'
         '   * repeats runs once, at its first instant. A schedule that runs every hour or every few minutes\n'
         '   * follows elapsed time instead: it runs in both copies of a repeated hour and skips the gap.\n'
         '   */\n'
         '  hxWallClock?: boolean;\n',
        ),
        (
         '      return cronSpec(field([minute]), field([hour]), wildcardField(1, 31), wildcardField(1, 12), wildcardField(0, 6));\n',
         '      return hxWall(\n'
         '        cronSpec(field([minute]), field([hour]), wildcardField(1, 31), wildcardField(1, 12), wildcardField(0, 6)),\n'
         '      );\n',
        ),
        (
         '      return cronSpec(\n'
         '        field([minute]),\n'
         '        field([hour]),\n'
         '        wildcardField(1, 31),\n'
         '        wildcardField(1, 12),\n'
         '        field([1, 2, 3, 4, 5]),\n',
         '      return hxWall(\n'
         '        cronSpec(field([minute]), field([hour]), wildcardField(1, 31), wildcardField(1, 12), field([1, 2, 3, 4, 5])),\n',
        ),
        (
         '      return cronSpec(\n'
         '        field([minute]),\n'
         '        field([hour]),\n'
         '        wildcardField(1, 31),\n'
         '        wildcardField(1, 12),\n'
         '        field([schedule.weekday]),\n',
         '      return hxWall(\n'
         '        cronSpec(field([minute]), field([hour]), wildcardField(1, 31), wildcardField(1, 12), field([schedule.weekday])),\n',
        ),
        (
         '      return cronSpec(field([minute]), field([hour]), field([schedule.day]), wildcardField(1, 12), wildcardField(0, 6));\n',
         '      return hxWall(\n'
         '        cronSpec(field([minute]), field([hour]), field([schedule.day]), wildcardField(1, 12), wildcardField(0, 6)),\n'
         '      );\n',
        ),
        (
         '      return cronSpec(\n'
         '        field([...new Set(parsed.map(([, minute]) => minute))]),\n'
         '        field([...new Set(parsed.map(([hour]) => hour))]),\n'
         '        day,\n'
         '        field(schedule.months),\n'
         '        weekday,\n'
         '        new Set(parsed.map(([hour, minute]) => `${hour}:${minute}`)),\n',
         '      return hxWall(\n'
         '        cronSpec(\n'
         '          field([...new Set(parsed.map(([, minute]) => minute))]),\n'
         '          field([...new Set(parsed.map(([hour]) => hour))]),\n'
         '          day,\n'
         '          field(schedule.months),\n'
         '          weekday,\n'
         '          new Set(parsed.map(([hour, minute]) => `${hour}:${minute}`)),\n'
         '        ),\n',
        ),
        (
         '      return parseCron(schedule.expression);\n'
         '  }\n'
         '}\n',
         '      return hxCustomWallClock(parseCron(schedule.expression), schedule.expression);\n'
         '  }\n'
         '}\n'
         '\n'
         '/** HXBot (v1.7.5, RTN-01): a cron line names its hours unless its hour field starts with `*`. */\n'
         'function hxCustomWallClock(spec: CronSpec, expression: string): CronSpec {\n'
         '  const hour = expression.trim().split(/\\s+/)[1] ?? "*";\n'
         '  return hour.startsWith("*") ? spec : { ...spec, hxWallClock: true };\n'
         '}\n',
        ),
        (
         '\n'
         'function nextCronOccurrence(spec: CronSpec, timezone: string, after: Date): Date {\n',
         '\n'
         '/** HXBot (v1.7.5, RTN-01): see `CronSpec.hxWallClock`. */\n'
         'function hxWall(spec: CronSpec): CronSpec {\n'
         '  return { ...spec, hxWallClock: true };\n'
         '}\n'
         '\n'
         '/**\n'
         ' * HXBot (v1.7.5, RTN-01): the instant a named time of day runs at. A time in a spring gap runs at the\n'
         ' * first minute after the gap (02:30 on a day that jumps from 02:00 to 03:00 runs at 03:00); a time the\n'
         ' * fall repeats runs at its first instant only. `undefined` only past the longest gap there is.\n'
         ' */\n'
         'function hxWallClockInstant(parts: CalendarParts, timezone: string): Date | undefined {\n'
         '  const [first] = zonedDateTimeCandidates(parts, timezone);\n'
         '  if (first) return first;\n'
         '  const start = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);\n'
         '  for (let step = 1; step <= MAX_GAP_MINUTES; step += 1) {\n'
         '    const local = new Date(start + step * 60_000);\n'
         '    const [candidate] = zonedDateTimeCandidates(\n'
         '      {\n'
         '        year: local.getUTCFullYear(),\n'
         '        month: local.getUTCMonth() + 1,\n'
         '        day: local.getUTCDate(),\n'
         '        weekday: local.getUTCDay(),\n'
         '        hour: local.getUTCHours(),\n'
         '        minute: local.getUTCMinutes(),\n'
         '      },\n'
         '      timezone,\n'
         '    );\n'
         '    if (candidate) return candidate;\n'
         '  }\n'
         '  return undefined;\n'
         '}\n'
         '\n'
         'function nextCronOccurrence(spec: CronSpec, timezone: string, after: Date): Date {\n',
        ),
        (
         '  const repeatedStart = zonedDateTimeCandidates(start, timezone).length > 1;\n',
         '  const repeatedStart = !spec.hxWallClock && zonedDateTimeCandidates(start, timezone).length > 1;\n',
        ),
        (
         '        if (offset === 0 && (hour < start.hour || (hour === start.hour && minute < start.minute)) && !repeatedStart) {\n',
         '        if (offset === 0 && (hour < start.hour || (hour === start.hour && minute < start.minute)) && !repeatedStart) {\n'
         '          continue;\n'
         '        }\n'
         '        if (spec.hxWallClock) {\n'
         '          // HXBot (v1.7.5, RTN-01): one instant for each named time, in wall-clock order.\n'
         '          const instant = hxWallClockInstant({ year, month, day, weekday, hour, minute }, timezone);\n'
         '          if (instant && instant.getTime() > after.getTime()) return instant;\n',
        ),
        (
         '  return { scheduledFor, nextRunAt };\n'
         '}\n',
         '  return { scheduledFor, nextRunAt };\n'
         '}\n'
         '\n'
         '/** HXBot (v1.7.5, RTN-01): one coming run of a routine, as a preview shows it. */\n'
         'export interface HxRoutineOccurrence {\n'
         '  /** The instant, in UTC. */\n'
         '  at: string;\n'
         '  /** The local date and time in the routine zone, `YYYY-MM-DD HH:mm`. */\n'
         '  local: string;\n'
         "  /** The zone's offset from UTC at that instant, in minutes (Shanghai: 480). */\n"
         '  offsetMinutes: number;\n'
         '  /** The named time of day (`HH:mm`) that a spring gap moved to this instant, or null. */\n'
         '  shiftedFrom: string | null;\n'
         '  /** The local time occurs twice that day (the clock goes back); the routine runs at the first one only. */\n'
         '  repeated: boolean;\n'
         '}\n'
         '\n'
         '/**\n'
         ' * HXBot (v1.7.5, RTN-01): the next `count` runs after `after`, with the local time, the UTC time and\n'
         ' * what a clock change did to each. Fewer when a one-time schedule has passed or has no more.\n'
         ' */\n'
         'export function hxRoutineUpcoming(\n'
         '  schedule: RoutineSchedule,\n'
         '  timezone: string,\n'
         '  after: Date,\n'
         '  count = 3,\n'
         '): HxRoutineOccurrence[] {\n'
         '  validateStoredRoutineSchedule(schedule, timezone);\n'
         '  const result: HxRoutineOccurrence[] = [];\n'
         '  let cursor = after;\n'
         '  for (let index = 0; index < Math.min(Math.max(count, 0), 10); index += 1) {\n'
         '    let next: Date;\n'
         '    try {\n'
         '      next = nextValidRoutineOccurrence(schedule, timezone, cursor);\n'
         '    } catch (error) {\n'
         '      if (error instanceof RoutineInputError) break;\n'
         '      throw error;\n'
         '    }\n'
         '    const parts = zonedParts(next, timezone);\n'
         '    const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);\n'
         '    result.push({\n'
         '      at: next.toISOString(),\n'
         '      local: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`,\n'
         '      offsetMinutes: Math.round((wall - Math.floor(next.getTime() / 60_000) * 60_000) / 60_000),\n'
         '      shiftedFrom: hxShiftedFrom(schedule, timezone, parts),\n'
         '      repeated: zonedDateTimeCandidates(parts, timezone).length > 1,\n'
         '    });\n'
         '    if (schedule.kind === "once") break;\n'
         '    cursor = next;\n'
         '  }\n'
         '  return result;\n'
         '}\n'
         '\n'
         '/** The named time of day before `parts` on the same day that has no instant: the one a gap moved. */\n'
         'function hxShiftedFrom(schedule: RoutineSchedule, timezone: string, parts: CalendarParts): string | null {\n'
         '  if (schedule.kind === "interval") return null;\n'
         '  const named: Array<[number, number]> = [];\n'
         '  if (schedule.kind === "once") {\n'
         '    named.push(parseTime(schedule.time));\n'
         '  } else {\n'
         '    const spec = scheduleCronSpec(schedule);\n'
         '    if (!spec.hxWallClock) return null;\n'
         '    for (const hour of spec.hour.values) {\n'
         '      for (const minute of spec.minute.values) {\n'
         '        if (!spec.exactTimes || spec.exactTimes.has(`${hour}:${minute}`)) named.push([hour, minute]);\n'
         '      }\n'
         '    }\n'
         '  }\n'
         '  if (named.some(([hour, minute]) => hour === parts.hour && minute === parts.minute)) return null;\n'
         '  const now = parts.hour * 60 + parts.minute;\n'
         '  let moved: [number, number] | null = null;\n'
         '  for (const [hour, minute] of named) {\n'
         '    const at = hour * 60 + minute;\n'
         '    if (at >= now || now - at > MAX_GAP_MINUTES) continue;\n'
         '    if (zonedDateTimeCandidates({ ...parts, hour, minute }, timezone).length > 0) continue;\n'
         '    if (!moved || at > moved[0] * 60 + moved[1]) moved = [hour, minute];\n'
         '  }\n'
         '  return moved ? `${pad2(moved[0])}:${pad2(moved[1])}` : null;\n'
         '}\n'
         '\n'
         'function pad2(value: number): string {\n'
         '  return String(value).padStart(2, "0");\n'
         '}\n',
        ),
    ]),
    ('packages/ui/package.json', [
    ], [
        (
         '    "./features/account/AppLoadingShell": "./src/features/account/AppLoadingShell.tsx",\n',
         '    "./features/account/AppLoadingShell": "./src/features/account/AppLoadingShell.tsx",\n'
         '    "./features/account/HxBootScreen": "./src/features/account/HxBootScreen.tsx",\n'
         '    "./features/account/hx-boot-screen.css": "./src/features/account/hx-boot-screen.css",\n',
        ),
        (
         '    "./features/conversation/AgentChatEmptyState": "./src/features/conversation/AgentChatEmptyState.tsx",\n',
         '    "./features/conversation/AgentChatEmptyState": "./src/features/conversation/AgentChatEmptyState.tsx",\n'
         '    "./features/conversation/HxRoutineUpcoming": "./src/features/conversation/HxRoutineUpcoming.tsx",\n'
         '    "./features/conversation/HxRoutineConfirmCard": "./src/features/conversation/HxRoutineConfirmCard.tsx",\n'
         '    "./features/conversation/HxTeamJudgeBar": "./src/features/conversation/HxTeamJudgeBar.tsx",\n',
        ),
        (
         '    "./features/workflows/workflow-model": "./src/features/workflows/workflow-model.ts",\n',
         '    "./features/workflows/workflow-model": "./src/features/workflows/workflow-model.ts",\n'
         '    "./features/workflows/WorkflowHxLimits": "./src/features/workflows/WorkflowHxLimits.tsx",\n',
        ),
    ]),
    ('packages/ui/src/features/conversation/RoutineScheduleCard.tsx', [
        'import type { JSX } from "@solidjs/web";',
    ], [
        (
         '  kinds?: RoutineDraftKindOption[];\n',
         '  kinds?: RoutineDraftKindOption[];\n'
         '  /** HXBot (v1.7.5, RTN-01): the next three runs, under the schedule row. */\n'
         '  upcoming?: JSX.Element;\n',
        ),
        (
         '      />\n',
         '      />\n'
         '      {deleted() ? undefined : props.upcoming}\n',
        ),
    ]),
    ('packages/ui/src/features/conversation/conversation.css', [
    ], [
        (
         '@import "./styles/hx-file-change.css";\n',
         '@import "./styles/hx-file-change.css";\n'
         '@import "./styles/hx-routine.css";\n',
        ),
    ]),
    ('scripts/routine-dst-order-e2e.ts', [
    ], [
        (
         '    expected: "2026-11-01T06:20:00.000Z",\n',
         '    // HXBot (v1.7.5, RTN-01): a repeated time of day runs once, at its first instant, so the next run is tomorrow.\n'
         '    expected: "2026-11-02T06:20:00.000Z",\n',
        ),
        (
         '    expected: "2026-03-09T06:20:00.000Z",\n',
         '    // HXBot (v1.7.5, RTN-01): a time in the spring gap runs at the first minute after it, 03:00 EDT.\n'
         '    expected: "2026-03-08T07:00:00.000Z",\n',
        ),
        (
         '    expected: "2023-03-08T16:20:00.000Z",\n',
         '    // HXBot (v1.7.5, RTN-01): 00:20 repeats on this day and ran at its first instant (13:20Z); the next run is the next day.\n'
         '    expected: "2023-03-09T16:20:00.000Z",\n',
        ),
    ]),
    ('src/backend/agent-memory-selection-migration.test.ts', [
    ], [
        (
         '      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
    ]),
    ('src/backend/agent-skill-loads-migration.test.ts', [
    ], [
        (
         'const SKILL_TABLES = { agent_usage_skill_loads: [] };\n',
         'const SKILL_TABLES = {\n'
         '  agent_usage_skill_loads: [],\n'
         '  hx_external_actions: [],\n'
         '  hx_meta: [],\n'
         '  hx_routine_confirmations: [],\n'
         '  hx_routine_detail: [],\n'
         '  hx_run_detail: [],\n'
         '};\n',
        ),
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
    ]),
    ('src/backend/agent-task-migration.test.ts', [
    ], [
        (
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
    ]),
    ('src/backend/agent-thread-branch-migration.test.ts', [
    ], [
        (
         '    agent_usage_skill_loads: [],\n',
         '    agent_usage_skill_loads: [],\n'
         '    hx_external_actions: [],\n'
         '    hx_meta: [],\n'
         '    hx_routine_confirmations: [],\n'
         '    hx_routine_detail: [],\n'
         '    hx_run_detail: [],\n',
        ),
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '    const columnsBefore = threadColumns(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    const columnsBefore = threadColumns(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=46");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=46");\n',
        ),
        (
         '    // An application one release older knows versions up to 47: version 48 is newer than it supports.\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    // An application one release older knows versions up to 47: version 48 is newer than it supports.\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
    ]),
    ('src/backend/agent-thread-migration.test.ts', [
    ], [
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
    ]),
    ('src/backend/agent-thread-routine-migration.test.ts', [
    ], [
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '    const columnsBefore = threadColumns(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    const columnsBefore = threadColumns(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=47");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=47");\n',
        ),
        (
         '    // An application one release older knows versions up to 58 at most: version 59 is newer than it supports.\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    // An application one release older knows versions up to 58 at most: version 59 is newer than it supports.\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
    ]),
    ('src/backend/agent-wait-migration.test.ts', [
    ], [
        (
         '        agent_usage_skill_loads: [],\n',
         '        agent_usage_skill_loads: [],\n'
         '        hx_external_actions: [],\n'
         '        hx_meta: [],\n'
         '        hx_routine_confirmations: [],\n'
         '        hx_routine_detail: [],\n'
         '        hx_run_detail: [],\n',
        ),
        (
         '      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '      agent_usage_skill_loads: [],\n'
         '    });\n',
         '      agent_usage_skill_loads: [],\n'
         '      hx_external_actions: [],\n'
         '      hx_meta: [],\n'
         '      hx_routine_confirmations: [],\n'
         '      hx_routine_detail: [],\n'
         '      hx_run_detail: [],\n'
         '    });\n',
        ),
        (
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
    ]),
    ('src/backend/agent-workspace-root-migration.test.ts', [
    ], [
        (
         '    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
    ]),
    ('src/backend/agent/routine-scheduler.ts', [
    ], [
        (
         'import { collapseMissedOccurrences, RoutineInputError } from "@openbot/team-client/routine-schedule";\n',
         'import { RoutineInputError } from "@openbot/team-client/routine-schedule";\n',
        ),
        (
         'import { causeHelpers } from "../effect-boundary";\n',
         'import { causeHelpers } from "../effect-boundary";\n'
         'import { hxRoutineConfirm } from "../hx-routines/confirm";\n'
         'import { hxAgentDueOwner, hxApplyDue, hxDueFor, hxOnceNeedsYes } from "../hx-routines/due-apply";\n'
         'import { hxStaggerDelays } from "../hx-routines/stagger";\n'
         'import { hxRoutineToolResult } from "../hx-routines/tool-result";\n'
         'import { hxRoutineZones } from "../hx-routines/zone";\n',
        ),
        (
         '  readonly #previewsBeforeRun = new Map<string, RoutinePreviewBeforeRun & { agentId: string }>();\n',
         '  readonly #previewsBeforeRun = new Map<string, RoutinePreviewBeforeRun & { agentId: string }>();\n'
         '  /** HXBot (v1.7.5, CONC-14): the timers of runs that start later in their minute. */\n'
         '  readonly #hxLater = new Set<ReturnType<typeof setTimeout>>();\n',
        ),
        (
         '    this.#conversation.requireKnownAgent(agentId);\n'
         '    return this.#routines.list(agentId);\n',
         '    this.#conversation.requireKnownAgent(agentId);\n'
         '    return this.#routines.list(agentId).map((routine) => this.#hxWithQueue(routine));\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5, RTN-06): a routine read back with what it has waiting. */\n'
         '  #hxWithQueue<T extends { id: string; hx?: Routine["hx"] }>(routine: T & { agentId?: string; ownerId?: string }): T {\n'
         '    const agentId = routine.agentId ?? routine.ownerId;\n'
         '    if (!agentId) return routine;\n'
         '    try {\n'
         '      const { queued, running } = this.hxQueueReadback(agentId, routine.id);\n'
         '      const lastResult = this.#routines.listRuns(agentId, routine.id, 1)[0]?.hx?.result;\n'
         '      const waiting = hxRoutineConfirm.waitingCards(agentId, routine.id);\n'
         '      return {\n'
         '        ...routine,\n'
         '        hx: {\n'
         '          ...routine.hx,\n'
         '          ...(lastResult ? { lastResult } : {}),\n'
         '          ...(waiting.length > 0 ? { waiting } : {}),\n'
         '          queue: {\n'
         '            queued,\n'
         '            running: running ? { runId: running.id, status: running.status, deliveryId: running.deliveryId } : null,\n'
         '          },\n'
         '        },\n'
         '      };\n'
         '    } catch {\n'
         '      return routine;\n'
         '    }\n',
        ),
        (
         '  create(input: CreateRoutineInput, options: RoutineMutationOptions = {}): Routine {\n'
         '    this.#conversation.requireKnownAgent(input.agentId);\n'
         '    const routine =\n',
         '  create(input: CreateRoutineInput, options: RoutineMutationOptions = {}): Routine {\n'
         '    this.#conversation.requireKnownAgent(input.agentId);\n'
         '    input = { ...input, timezone: hxRoutineZones.checkSaved(input.timezone) };\n'
         '    const routine =\n',
        ),
        (
         '  update(input: UpdateRoutineInput, options: RoutineMutationOptions = {}): Routine {\n'
         '    this.#conversation.requireKnownAgent(input.agentId);\n'
         '    const routine =\n',
         '  update(input: UpdateRoutineInput, options: RoutineMutationOptions = {}): Routine {\n'
         '    this.#conversation.requireKnownAgent(input.agentId);\n'
         '    // HXBot (v1.7.5, RTN-06): a pause leaves nothing queued: the runs that did not start and the open\n'
         '    // questions are cancelled after the save. A run that already works goes on; the person stops it apart.\n'
         '    const hxPausing = input.active === false && this.#routines.get(input.agentId, input.routineId)?.active === true;\n'
         '    if (input.timezone !== undefined) input = { ...input, timezone: hxRoutineZones.checkSaved(input.timezone) };\n'
         '    const routine =\n',
        ),
        (
         '            (updated) => updated,\n'
         '            options.turnId,\n'
         '            undefined,\n'
         '            options.sideThreadId,\n'
         '          );\n'
         '    this.stateChanged(input.agentId);\n'
         '    this.arm();\n'
         '    return routine;\n'
         '  }\n',
         '            (updated) => updated,\n'
         '            options.turnId,\n'
         '            undefined,\n'
         '            options.sideThreadId,\n'
         '          );\n'
         '    if (hxPausing && !routine.active) this.#hxCancelQueued(routine.agentId, routine.id);\n'
         '    this.stateChanged(input.agentId);\n'
         '    this.arm();\n'
         '    return routine;\n'
         '  }\n',
        ),
        (
         '    this.#conversation.requireKnownAgent(agentId);\n'
         '    return this.#routines.listRecords(agentId);\n',
         '    this.#conversation.requireKnownAgent(agentId);\n'
         '    return this.#routines.listRecords(agentId).map((routine) => this.#hxWithQueue(routine));\n',
        ),
        (
         '    this.#conversation.requireKnownAgent(agentId);\n'
         '    const routine =\n',
         '    this.#conversation.requireKnownAgent(agentId);\n'
         '    // HXBot (v1.7.5, RTN-06): see `update`.\n'
         '    const hxPausing =\n'
         '      routineId !== undefined && !input.active && this.#routines.getRecord(agentId, routineId)?.active === true;\n'
         '    if (input.trigger.kind === "schedule") input = { ...input, timezone: hxRoutineZones.checkSaved(input.timezone) };\n'
         '    const routine =\n',
        ),
        (
         '        : this.#routines.saveRecord(agentId, routineId, input);\n',
         '        : this.#routines.saveRecord(agentId, routineId, input);\n'
         '    if (hxPausing && !routine.active) this.#hxCancelQueued(agentId, routine.id);\n',
        ),
        (
         '      const timezone =\n',
         '      // HXBot (v1.7.5, RTN-01): the registered zone, or the zone of the call. With neither, the agent asks the\n'
         "      // user once; the host zone is never used silently. The sender's zone only helps the agent ask.\n"
         '      const zone = hxRoutineZones.forNewRoutine(\n',
        ),
        (
         '          ? (this.#turnSenderTimezone(senderAgentId, params.turnId) ?? this.#timezone())\n'
         '          : routineToolString(args.timezone, "timezone", 128, "A routine timezone is required.");\n',
         '          ? undefined\n'
         '          : routineToolString(args.timezone, "timezone", 128, "A routine timezone is required."),\n'
         '        this.#turnSenderTimezone(senderAgentId, params.turnId),\n'
         '      );\n'
         '      const timezone = zone.zone;\n',
        ),
        (
         '      return openBotToolResult(routine);\n',
         '      return openBotToolResult(hxRoutineToolResult(routine, zone.source));\n',
        ),
        (
         '        "missedPolicy",\n'
         '        "runIn",\n'
         '      ]);\n'
         '      const policies = { ...routineToolPolicies(args), ...routineToolRunPlace(args) };\n',
         '        "missedPolicy",\n'
         '        "runIn",\n'
         '        "timezone",\n'
         '      ]);\n'
         '      const policies = { ...routineToolPolicies(args), ...routineToolRunPlace(args) };\n',
        ),
        (
         '      }\n'
         '      if (!hasUpdate) throw new RoutineInputError("At least one routine update is required.");\n',
         '      }\n'
         '      // HXBot (v1.7.5, RTN-01): an update can move the routine to another zone.\n'
         '      if (args.timezone !== undefined) {\n'
         '        input.timezone = hxRoutineZones.forUpdate(\n'
         '          routineToolString(args.timezone, "timezone", 128, "A routine timezone is required."),\n'
         '        );\n'
         '        hasUpdate = true;\n'
         '      }\n'
         '      if (!hasUpdate) throw new RoutineInputError("At least one routine update is required.");\n',
        ),
        (
         '      return openBotToolResult(this.update(input, this.#toolMutationOptions(input.agentId, senderAgentId, params)));\n',
         '      return openBotToolResult(\n'
         '        hxRoutineToolResult(this.update(input, this.#toolMutationOptions(input.agentId, senderAgentId, params))),\n'
         '      );\n',
        ),
        (
         '    return this.#routines.nextDueAt(this.#hooks.excludedAgents());\n',
         '    // HXBot (v1.7.5, RTN-02): the timer also wakes when a question that waits for the yes expires.\n'
         '    const due = this.#routines.nextDueAt(this.#hooks.excludedAgents());\n'
         '    const expiry = hxRoutineConfirm.nextExpiry();\n'
         '    if (expiry === null) return due;\n'
         '    return due === null || Date.parse(expiry) < Date.parse(due) ? expiry : due;\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5, RTN-02, MIG-03): the run of a yes, as the occurrence it was asked for. */\n'
         '  readonly hxStartConfirmedRun = Effect.fn("RoutineScheduler.hxStartConfirmedRun")(function* (\n'
         '    this: RoutineScheduler,\n'
         '    input: {\n'
         '      routine: Routine;\n'
         '      triggerId: string | null;\n'
         '      scheduledFor: string;\n'
         '      confirmationId: string;\n'
         '      catchUp: { total: number; from: Date; until: Date } | null;\n'
         '    },\n'
         '  ) {\n'
         '    const run = yield* routineStep(() => {\n'
         '      if (!this.#routines.getRecord(input.routine.agentId, input.routine.id)) {\n'
         '        throw new RoutineInputError(sourceText("error.backend.routineGone"));\n'
         '      }\n'
         '      const created = this.#routines.createRun(input.routine, input.triggerId, "scheduled", input.scheduledFor);\n'
         '      const at = new Date().toISOString();\n'
         '      const catchUp = input.catchUp;\n'
         '      this.#routines.hxNoteRun(created.id, input.routine.id, (detail) => ({\n'
         '        ...detail,\n'
         '        confirmed: { confirmationId: input.confirmationId, at },\n'
         '        ...(catchUp\n'
         '          ? { catchUp: { total: catchUp.total, from: catchUp.from.toISOString(), until: catchUp.until.toISOString() } }\n'
         '          : {}),\n'
         '      }));\n'
         '      return created;\n'
         '    });\n'
         '    if (!run.deliveryId) yield* this.#enqueueRunEffect(run);\n'
         '    yield* routineStep(() => this.stateChanged(input.routine.agentId));\n'
         '  });\n'
         '\n'
         '  /**\n'
         '   * HXBot (v1.7.5, CONC-14): starts a run after its share of the minute. The run row exists already, so a\n'
         '   * quit before the time leaves it queued without a delivery, and the next start runs it\n'
         '   * (`resumePendingRuns`).\n'
         '   */\n'
         '  #hxEnqueueLater(run: RoutineRun, delayMs: number): void {\n'
         '    const timer = setTimeout(() => {\n'
         '      this.#hxLater.delete(timer);\n'
         '      if (!this.#hooks.isRunning()) return;\n'
         '      // A pause, a deletion or a restart path may have settled the run while it waited.\n'
         '      const current = this.#routines.activeRuns(run.agentId, run.routineId).find((entry) => entry.id === run.id);\n'
         '      if (current?.status !== "queued" || current.deliveryId) return;\n'
         '      void Effect.runPromise(\n'
         '        this.#enqueueRunEffect(run).pipe(\n'
         '          Effect.catch((failure) =>\n'
         '            Effect.sync(() => this.#hooks.emitError("routine_delivery_failed", failure.cause, run.agentId)),\n'
         '          ),\n'
         '        ),\n'
         '      ).catch(() => undefined);\n'
         '    }, delayMs);\n'
         '    timer.unref?.();\n'
         '    this.#hxLater.add(timer);\n'
         '  }\n'
         '\n'
         '  /**\n'
         '   * HXBot (v1.7.5, RTN-06): cancels what a paused routine still has waiting: runs that did not start and\n'
         '   * open questions. A run that already works keeps working.\n'
         '   */\n'
         '  #hxCancelQueued(agentId: string, routineId: string): void {\n'
         '    for (const run of this.#routines.activeRuns(agentId, routineId)) {\n'
         '      if (run.status !== "queued") continue;\n'
         '      const delivery = run.deliveryId ? this.#mailbox.getDelivery(run.deliveryId)?.delivery : undefined;\n'
         '      if (delivery && delivery.status !== "queued") continue;\n'
         '      try {\n'
         '        if (delivery) this.#mailbox.cancelNow(agentId, delivery.id);\n'
         '        this.#routines.updateRunStatus(run.id, "cancelled");\n'
         '      } catch (error) {\n'
         '        this.#hooks.emitError("routine_pause_cancel_failed", error, agentId);\n'
         '      }\n'
         '    }\n'
         '    hxRoutineConfirm.cancelFor(agentId, routineId);\n'
         '    this.#hooks.emitQueue(agentId);\n'
         '  }\n'
         '\n'
         '  /**\n'
         '   * HXBot (v1.7.5, RTN-06): what a routine has waiting, read back from the stores: runs that did not\n'
         '   * start, questions that wait for the yes, and runs that wait for their share of the minute. The run\n'
         '   * that works now, if any, apart.\n'
         '   */\n'
         '  hxQueueReadback(agentId: string, routineId: string): { queued: number; running: RoutineRun | null } {\n'
         '    let queued = hxRoutineConfirm.waitingFor(agentId, routineId).length;\n'
         '    let running: RoutineRun | null = null;\n'
         '    for (const run of this.#routines.activeRuns(agentId, routineId)) {\n'
         '      const status = run.deliveryId ? this.#mailbox.getDelivery(run.deliveryId)?.delivery.status : undefined;\n'
         '      if (run.status === "queued" && (status === undefined || status === "queued")) queued += 1;\n'
         '      else running ??= run;\n'
         '    }\n'
         '    return { queued, running };\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5, CONC-14): the runs that wait for their share of the minute. */\n'
         '  hxPendingStarts(): number {\n'
         '    return this.#hxLater.size;\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5, RTN-02): an occurrence the person declined or did not answer, in the run history. */\n'
         '  hxRecordSkipped(input: {\n'
         '    routine: Routine;\n'
         '    triggerId: string | null;\n'
         '    scheduledFor: string;\n'
         '    reason: "declined" | "expired" | "cancelled";\n'
         '  }): void {\n'
         '    this.#routines.hxRecordNotRun(\n'
         '      input.routine,\n'
         '      input.triggerId,\n'
         '      { scheduledFor: input.scheduledFor, until: null, count: 1 },\n'
         '      { skip: { reason: input.reason, at: new Date().toISOString() } },\n'
         '    );\n'
         '    this.stateChanged(input.routine.agentId);\n',
        ),
        (
         '    yield* Effect.gen({ self: this }, function* () {\n',
         '    yield* Effect.gen({ self: this }, function* () {\n'
         '      // HXBot (v1.7.5, RTN-02): a question nobody answered before its time is skipped first, so the next\n'
         '      // occurrence of the same routine can ask again.\n'
         '      yield* routineStep(() => hxRoutineConfirm.expire(now));\n',
        ),
        (
         '      const dueRoutines = yield* routineStep(() => this.#routines.due(now, this.#hooks.excludedAgents()));\n',
         '      const dueRoutines = yield* routineStep(() => this.#routines.due(now, this.#hooks.excludedAgents()));\n'
         '      // HXBot (v1.7.5, CONC-14): routines due in the same minute start spread over it, in order.\n'
         '      const hxDelays = hxStaggerDelays(\n'
         '        dueRoutines.map((due) => ({\n'
         '          routineId: due.routine.id,\n'
         '          nextRunAt: due.nextRunAt,\n'
         '          schedule: due.schedule,\n'
         '          timezone: due.routine.timezone,\n'
         '        })),\n'
         '      );\n',
        ),
        (
         '            const queued = this.#routines.createRun(\n',
         '            // HXBot (v1.7.5, MIG-03): a one-time routine that asks before each run waits for the yes.\n'
         '            const queued = hxOnceNeedsYes(\n'
         '              hxAgentDueOwner(this.#routines),\n'
         '              this.#store.database.connection,\n',
        ),
        (
         '              current.trigger.id,\n'
         '              "scheduled",\n'
         '              current.trigger.nextRunAt,\n'
         '            );\n',
         '              now,\n'
         '            )\n'
         '              ? null\n'
         '              : this.#routines.createRun(current, current.trigger.id, "scheduled", current.trigger.nextRunAt);\n',
        ),
        (
         '          const { scheduledFor, nextRunAt } = collapseMissedOccurrences(\n'
         '            current.trigger.schedule,\n'
         '            current.timezone,\n'
         '            new Date(current.trigger.nextRunAt),\n'
         '            now,\n'
         '          );\n',
         "",
        ),
        (
         '          const queued =\n'
         '            this.#hasLiveRun(current.agentId, current.id) ||\n'
         '            (current.limitPolicy === "skip" && this.#hooks.usageLimited(current.agentId))\n'
         '              ? null\n'
         '              : this.#routines.createRun(current, current.trigger.id, "scheduled", scheduledFor.toISOString());\n'
         '          this.#routines.advanceTrigger(current.id, current.trigger.id, nextRunAt.toISOString());\n',
         '          // HXBot (v1.7.5, RTN-02, RTN-03, MIG-03): the dropped occurrence leaves a skipped record; the ones a\n'
         '          // sleep made late are counted and handled by the policy; a run that must ask waits for the yes.\n'
         '          const plan = hxDueFor(this.#store.database.connection, "agent", current, now, {\n'
         '            live: this.#hasLiveRun(current.agentId, current.id),\n'
         '            limited: current.limitPolicy === "skip" && this.#hooks.usageLimited(current.agentId),\n'
         '          });\n'
         '          const queued = hxApplyDue(\n'
         '            hxAgentDueOwner(this.#routines),\n'
         '            this.#store.database.connection,\n'
         '            current,\n'
         '            plan,\n'
         '            now,\n'
         '          );\n'
         '          this.#routines.advanceTrigger(current.id, current.trigger.id, plan.nextRunAt.toISOString());\n',
        ),
        (
         '        if (run && !run.deliveryId)\n',
         '        const hxStartAt = Date.parse(due.nextRunAt) + (hxDelays.get(due.routine.id) ?? 0);\n'
         '        if (run && !run.deliveryId && hxStartAt > now.getTime()) this.#hxEnqueueLater(run, hxStartAt - now.getTime());\n'
         '        else if (run && !run.deliveryId)\n',
        ),
    ]),
    ('src/backend/attachment-owner-index-migration.test.ts', [
    ], [
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
    ]),
    ('src/backend/browser-profile-migration.test.ts', [
    ], [
        (
         '  agent_usage_skill_loads: [],\n',
         '  agent_usage_skill_loads: [],\n'
         '  hx_external_actions: [],\n'
         '  hx_meta: [],\n'
         '  hx_routine_confirmations: [],\n'
         '  hx_routine_detail: [],\n'
         '  hx_run_detail: [],\n',
        ),
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
    ]),
    ('src/backend/browser-proxy-migration.test.ts', [
    ], [
        (
         'const LATER_TABLES = { agent_usage_skill_loads: [] };\n',
         'const LATER_TABLES = {\n'
         '  agent_usage_skill_loads: [],\n'
         '  hx_external_actions: [],\n'
         '  hx_meta: [],\n'
         '  hx_routine_confirmations: [],\n'
         '  hx_routine_detail: [],\n'
         '  hx_run_detail: [],\n'
         '};\n',
        ),
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
    ]),
    ('src/backend/channel-management.ts', [
    ], [
        (
         '} from "./agent/routine-tools";\n',
         '} from "./agent/routine-tools";\n'
         'import { hxRoutineToolResult } from "./hx-routines/tool-result";\n'
         'import { hxRoutineZones } from "./hx-routines/zone";\n',
        ),
        (
         '      timezone:\n',
         '      // HXBot (v1.7.5, RTN-01): the registered zone or the zone of the call; with neither, the agent asks once.\n'
         '      timezone: hxRoutineZones.forNewRoutine(\n',
        ),
        (
         '          ? routines.timezone()\n',
         '          ? undefined\n',
        ),
        (
         '          : routineToolString(args.timezone, "timezone", 128, "A routine timezone is required."),\n',
         '          : routineToolString(args.timezone, "timezone", 128, "A routine timezone is required."),\n'
         '        undefined,\n'
         '      ).zone,\n',
        ),
        (
         '      result: routine,\n',
         '      result: hxRoutineToolResult(routine),\n',
        ),
    ]),
    ('src/backend/channel-routine-scheduler.ts', [
    ], [
        (
         'import { collapseMissedOccurrences } from "@openbot/team-client/routine-schedule";\n',
         "",
        ),
        (
         'import { causeHelpers } from "./effect-boundary";\n',
         'import { causeHelpers } from "./effect-boundary";\n'
         'import { hxChannelDueOwner, hxChannelStartConfirmed, hxChannelWithQueue } from "./hx-routines/channel";\n'
         'import { hxChannelRoutineConfirm } from "./hx-routines/confirm";\n'
         'import { hxApplyDue, hxDueFor, hxOnceNeedsYes } from "./hx-routines/due-apply";\n'
         'import { hxStaggerDelays } from "./hx-routines/stagger";\n'
         'import { hxRoutineZones } from "./hx-routines/zone";\n',
        ),
        (
         '    return this.#routines.list(this.#requireChannel(channelId));\n',
         '    return this.#routines.list(this.#requireChannel(channelId)).map((routine) => this.#hxWithQueue(routine));\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5, RTN-06, RTN-02): a routine read back with what it has waiting and its open questions. */\n'
         '  #hxWithQueue<T extends { id: string; hx?: ChannelRoutine["hx"] }>(\n'
         '    routine: T & { channelId?: string; ownerId?: string },\n'
         '  ): T {\n'
         '    const channelId = routine.channelId ?? routine.ownerId;\n'
         '    if (!channelId) return routine;\n'
         '    return hxChannelWithQueue(routine, this.#routines.activeRuns(channelId, routine.id), () =>\n'
         '      hxChannelRoutineConfirm.waitingCards(channelId, routine.id),\n'
         '    );\n',
        ),
        (
         '    const routine = this.#routines.create({ ...input, channelId: this.#requireChannel(input.channelId) });\n',
         '    // HXBot (v1.7.5, RTN-01): an IANA zone. The editor registers the first one a person chooses.\n'
         '    const timezone = hxRoutineZones.checkSaved(input.timezone);\n'
         '    const routine = this.#routines.create({ ...input, timezone, channelId: this.#requireChannel(input.channelId) });\n',
        ),
        (
         '    const routine = this.#routines.update({ ...input, channelId: this.#requireChannel(input.channelId) });\n',
         '    const routine = this.#routines.update({ ...input, channelId: this.#requireChannel(input.channelId) });\n'
         '    // HXBot (v1.7.5, RTN-06): a paused routine asks nothing more.\n'
         '    if (!routine.active) hxChannelRoutineConfirm.cancelFor(routine.channelId, routine.id);\n',
        ),
        (
         '    return this.#routines.listRecords(this.#requireChannel(channelId));\n',
         '    return this.#routines.listRecords(this.#requireChannel(channelId)).map((routine) => this.#hxWithQueue(routine));\n',
        ),
        (
         '    const routine = this.#routines.saveRecord(this.#requireChannel(channelId), routineId, input);\n',
         '    // HXBot (v1.7.5, RTN-01): see `create`.\n'
         '    const checked =\n'
         '      input.trigger.kind === "schedule" ? { ...input, timezone: hxRoutineZones.checkSaved(input.timezone) } : input;\n'
         '    const routine = this.#routines.saveRecord(this.#requireChannel(channelId), routineId, checked);\n'
         '    // HXBot (v1.7.5, RTN-06): see `update`.\n'
         '    if (!routine.active) hxChannelRoutineConfirm.cancelFor(channelId, routine.id);\n',
        ),
        (
         '    return this.#routines.nextDueAt(this.#excluded());\n',
         '    const due = this.#routines.nextDueAt(this.#excluded());\n'
         '    // HXBot (v1.7.5, RTN-02): an unanswered question expires on time too.\n'
         '    const expiry = hxChannelRoutineConfirm.nextExpiry();\n'
         '    if (!expiry) return due;\n'
         '    return !due || Date.parse(expiry) < Date.parse(due) ? expiry : due;\n',
        ),
        (
         '    yield* Effect.gen({ self: this }, function* () {\n',
         '    yield* Effect.gen({ self: this }, function* () {\n'
         '      // HXBot (v1.7.5, RTN-02): a question nobody answered before its time is skipped first.\n'
         '      yield* channelRoutineStep(() => hxChannelRoutineConfirm.expire(now));\n',
        ),
        (
         '      const pending = yield* channelRoutineStep(() => this.#routines.due(now, this.#excluded()));\n',
         '      const pending = yield* channelRoutineStep(() => this.#routines.due(now, this.#excluded()));\n'
         '      // HXBot (v1.7.5, CONC-14): routines due in the same minute start spread over it, in order.\n'
         '      const hxDelays = hxStaggerDelays(\n'
         '        pending.map((due) => ({\n'
         '          routineId: due.routine.id,\n'
         '          nextRunAt: due.nextRunAt,\n'
         '          schedule: due.schedule,\n'
         '          timezone: due.routine.timezone,\n'
         '        })),\n'
         '      );\n',
        ),
        (
         '        const scheduledFor = yield* channelRoutineStep(() => {\n',
         '        // HXBot (v1.7.5): the plan reads the trigger that came due.\n'
         '        const routine: ChannelRoutine = {\n'
         '          ...due.routine,\n'
         '          trigger: { ...due.routine.trigger, id: due.triggerId, nextRunAt: due.nextRunAt, schedule: due.schedule },\n'
         '        };\n'
         '        const owner = hxChannelDueOwner(this.#routines);\n'
         '        const connection = this.#channels.store.database.connection;\n'
         '        const run = yield* channelRoutineStep(() => {\n',
        ),
        (
         '          if (due.schedule.kind === "once") {\n',
         '          if (due.schedule.kind === "once") {\n'
         '            // HXBot (v1.7.5, MIG-03): a one-time routine that asks before each run waits for the yes.\n'
         '            const asks = hxOnceNeedsYes(owner, connection, routine, now);\n',
        ),
        (
         '            return due.nextRunAt;\n',
         '            // A routine set to skip drops the occurrence while a spent plan would only make it wait.\n'
         '            if (asks || (due.routine.limitPolicy === "skip" && this.#hooks.usageLimited(due.routine.channelId)))\n'
         '              return null;\n'
         '            return this.#routines.createRun(routine, due.triggerId, "scheduled", due.nextRunAt);\n',
        ),
        (
         '          const occurrence = collapseMissedOccurrences(\n'
         '            due.schedule,\n'
         '            due.routine.timezone,\n'
         '            new Date(due.nextRunAt),\n'
         '            now,\n'
         '          );\n',
         '          // HXBot (v1.7.5, RTN-02, RTN-03, MIG-03): one run at a time, and an occurrence dropped for a live\n'
         '          // run or a spent plan leaves a skipped record; the ones a sleep made late are counted and handled\n'
         '          // by the policy; a run that must ask waits for the yes.\n'
         '          const plan = hxDueFor(connection, "channel", routine, now, {\n'
         '            live: this.#routines\n'
         '              .activeRuns(due.routine.channelId, due.routine.id)\n'
         '              .some((entry) => entry.status === "queued" || entry.status === "running"),\n'
         '            limited: due.routine.limitPolicy === "skip" && this.#hooks.usageLimited(due.routine.channelId),\n'
         '          });\n'
         '          const created = hxApplyDue(owner, connection, routine, plan, now);\n',
        ),
        (
         '          this.#routines.advanceTrigger(due.routine.id, due.triggerId, occurrence.nextRunAt.toISOString());\n',
         '          this.#routines.advanceTrigger(due.routine.id, due.triggerId, plan.nextRunAt.toISOString());\n',
        ),
        (
         '          return occurrence.scheduledFor.toISOString();\n',
         '          return created;\n',
        ),
        (
         '        // A routine set to skip drops the occurrence while a spent plan would only make it wait.\n'
         '        if (due.routine.limitPolicy === "skip" && this.#hooks.usageLimited(due.routine.channelId)) continue;\n'
         '        yield* this.#fireEffect(due.routine, due.triggerId, scheduledFor);\n',
         '        if (!run) continue;\n'
         '        const startAt = Date.parse(due.nextRunAt) + (hxDelays.get(due.routine.id) ?? 0);\n'
         '        if (startAt > now.getTime()) this.#hxIssueLater(run, startAt - now.getTime());\n'
         '        else yield* this.#hxIssue(run);\n',
        ),
        (
         '    );\n'
         '  });\n'
         '\n',
         '    );\n'
         '  });\n'
         '\n'
         '  /** HXBot (v1.7.5): issues a run row that the plan created. */\n'
         '  readonly #hxIssue = Effect.fn("ChannelRoutineScheduler.hxIssue")(function* (\n'
         '    this: ChannelRoutineScheduler,\n'
         '    run: ChannelRoutineRun,\n'
         '  ) {\n'
         '    const request = yield* channelRoutineStep(() =>\n'
         '      run.requestMessageId ? run : this.#routines.attachRequest(run.id, randomUUID()),\n'
         '    );\n'
         '    return yield* this.#issueEffect(request);\n'
         '  }, Effect.uninterruptible);\n'
         '\n'
         '  readonly #hxLater = new Set<ReturnType<typeof setTimeout>>();\n'
         '\n'
         '  /**\n'
         '   * HXBot (v1.7.5, CONC-14): issues a run after its share of the minute. The row exists without a\n'
         '   * request, so a quit before the time leaves it pending, and the next start issues it\n'
         '   * (`resumePendingRuns`).\n'
         '   */\n'
         '  #hxIssueLater(run: ChannelRoutineRun, delayMs: number): void {\n'
         '    const timer = setTimeout(() => {\n'
         '      this.#hxLater.delete(timer);\n'
         '      const current = this.#routines.activeRuns(run.channelId, run.routineId).find((entry) => entry.id === run.id);\n'
         '      if (current?.status !== "queued" || current.requestMessageId) return;\n'
         '      if (this.#excluded().has(run.channelId) || !this.#channels.store.exists(run.channelId)) return;\n'
         '      void Effect.runPromise(\n'
         '        this.#hxIssue(current).pipe(\n'
         '          Effect.catch((failure) =>\n'
         '            Effect.sync(() => this.#hooks.emitError("channel_routine_fire_failed", failure.cause)),\n'
         '          ),\n'
         '        ),\n'
         '      ).catch(() => undefined);\n'
         '    }, delayMs);\n'
         '    timer.unref?.();\n'
         '    this.#hxLater.add(timer);\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5, CONC-14): the runs that wait for their share of the minute. */\n'
         '  hxPendingStarts(): number {\n'
         '    return this.#hxLater.size;\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5, RTN-02, MIG-03): a channel routine of this computer, for its open questions. */\n'
         '  hxRoutine(channelId: string, routineId: string): ChannelRoutine | null {\n'
         '    if (!this.#channels.store.exists(channelId)) return null;\n'
         '    return this.#routines.get(channelId, routineId);\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5, RTN-02, MIG-03): the run of a yes. It runs as the occurrence it was asked for. */\n'
         '  readonly hxStartConfirmedRun = Effect.fn("ChannelRoutineScheduler.hxStartConfirmedRun")(function* (\n'
         '    this: ChannelRoutineScheduler,\n'
         '    input: Parameters<typeof hxChannelStartConfirmed>[1],\n'
         '  ) {\n'
         '    const run = yield* channelRoutineStep(() => {\n'
         '      if (this.#excluded().has(input.routine.channelId)) throw new Error(sourceText("error.backend.routineGone"));\n'
         '      return hxChannelStartConfirmed(this.#routines, input);\n'
         '    });\n'
         '    yield* this.#hxIssue(run);\n'
         '    this.#changed(input.routine.channelId);\n'
         '  });\n'
         '\n'
         '  /** HXBot (v1.7.5, RTN-02): an occurrence the person declined or did not answer, in the run history. */\n'
         '  hxRecordSkipped(input: {\n'
         '    routine: ChannelRoutine;\n'
         '    triggerId: string | null;\n'
         '    scheduledFor: string;\n'
         '    reason: "declined" | "expired" | "cancelled";\n'
         '  }): void {\n'
         '    this.#routines.hxRecordNotRun(\n'
         '      input.routine,\n'
         '      input.triggerId,\n'
         '      { scheduledFor: input.scheduledFor, until: null, count: 1 },\n'
         '      { skip: { reason: input.reason, at: new Date().toISOString() } },\n'
         '    );\n'
         '    this.#changed(input.routine.channelId);\n'
         '  }\n'
         '\n',
        ),
    ]),
    ('src/backend/channel-tools.ts', [
    ], [
        (
         '    description: `Create a scheduled routine that sends its instruction to this channel. It is active by default. Without a timezone, it uses the server timezone. Interval, advanced-every, and custom schedules must not run more often than every 3 minutes. ${PERSON_ONLY}`,\n',
         "    description: `Create a scheduled routine that sends its instruction to this channel. It is active by default. Default timezone: the user's registered one; if none, the call fails: ask the user once. Interval, advanced-every, and custom schedules must not run more often than every 3 minutes. ${PERSON_ONLY}`,\n",
        ),
        (
         '      timezone: z.string().min(1).max(128).describe("IANA timezone such as Europe/Warsaw.").optional(),\n',
         '      timezone: z.string().min(1).max(128).describe("IANA timezone.").optional(),\n',
        ),
    ]),
    ('src/backend/computer-use-name-migration.test.ts', [
    ], [
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
    ]),
    ('src/backend/deleted-thread-messages-migration.test.ts', [
    ], [
        (
         '  agent_usage_skill_loads: [],\n',
         '  agent_usage_skill_loads: [],\n'
         '  hx_external_actions: [],\n'
         '  hx_meta: [],\n'
         '  hx_routine_confirmations: [],\n'
         '  hx_routine_detail: [],\n'
         '  hx_run_detail: [],\n',
        ),
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
    ]),
    ('src/backend/event-type-index-migration.test.ts', [
    ], [
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
    ]),
    ('src/backend/hxbot-database-events-migration.test.ts', [
    ], [
        (
         '    expect(migrated.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '      version: 58,\n',
         '    expect(migrated.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '      version: 59,\n',
        ),
        (
         '    expect(retried.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '      version: 58,\n',
         '    expect(retried.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '      version: 59,\n',
        ),
        (
         '    DELETE FROM schema_migrations WHERE version IN (30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58);\n',
         '    DELETE FROM schema_migrations WHERE version IN (30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59);\n',
        ),
    ]),
    ('src/backend/hxbot-database-schema-history.json', [
    ], [
        (
         '    "table agent_usage_skill_loads": "CREATE TABLE AGENT_USAGE_SKILL_LOADS ( AGENT_ID TEXT NOT NULL , LOAD_ID TEXT NOT NULL , SESSION_ID TEXT NOT NULL , TURN_ID TEXT NOT NULL , PROVIDER TEXT NOT NULL , MODEL TEXT NOT NULL , SKILL TEXT NOT NULL CHECK ( LENGTH ( SKILL ) BETWEEN 1 AND 128 ) , TOKENS INTEGER CHECK ( TOKENS IS NULL OR TOKENS >= 0 ) , ESTIMATED_COST_USD REAL CHECK ( ESTIMATED_COST_USD IS NULL OR ESTIMATED_COST_USD >= 0 ) , OCCURRED_AT TEXT NOT NULL , PRIMARY KEY ( AGENT_ID , LOAD_ID ) )"\n',
         '    "table agent_usage_skill_loads": "CREATE TABLE AGENT_USAGE_SKILL_LOADS ( AGENT_ID TEXT NOT NULL , LOAD_ID TEXT NOT NULL , SESSION_ID TEXT NOT NULL , TURN_ID TEXT NOT NULL , PROVIDER TEXT NOT NULL , MODEL TEXT NOT NULL , SKILL TEXT NOT NULL CHECK ( LENGTH ( SKILL ) BETWEEN 1 AND 128 ) , TOKENS INTEGER CHECK ( TOKENS IS NULL OR TOKENS >= 0 ) , ESTIMATED_COST_USD REAL CHECK ( ESTIMATED_COST_USD IS NULL OR ESTIMATED_COST_USD >= 0 ) , OCCURRED_AT TEXT NOT NULL , PRIMARY KEY ( AGENT_ID , LOAD_ID ) )"\n'
         '  },\n'
         '  "59": {\n'
         '    "index hx_external_actions_scope": "CREATE INDEX HX_EXTERNAL_ACTIONS_SCOPE ON HX_EXTERNAL_ACTIONS ( SCOPE , CREATED_AT )",\n'
         '    "index hx_routine_confirmations_state": "CREATE INDEX HX_ROUTINE_CONFIRMATIONS_STATE ON HX_ROUTINE_CONFIRMATIONS ( STATE , EXPIRES_AT )",\n'
         '    "index hx_run_detail_routine": "CREATE INDEX HX_RUN_DETAIL_ROUTINE ON HX_RUN_DETAIL ( OWNER_KIND , ROUTINE_ID )",\n'
         '    "table hx_external_actions": "CREATE TABLE HX_EXTERNAL_ACTIONS ( ACTION_KEY TEXT PRIMARY KEY , SCOPE TEXT NOT NULL , STEP_ID TEXT , KIND TEXT NOT NULL CHECK ( KIND IN ( \'send\' , \'publish\' , \'pay\' , \'delete\' , \'other\' ) ) , TARGET TEXT , STATUS TEXT NOT NULL CHECK ( STATUS IN ( \'started\' , \'done\' , \'failed\' , \'unknown\' ) ) , RESULT_JSON TEXT CHECK ( RESULT_JSON IS NULL OR JSON_VALID ( RESULT_JSON ) ) , CREATED_AT TEXT NOT NULL , UPDATED_AT TEXT NOT NULL )",\n'
         '    "table hx_meta": "CREATE TABLE HX_META ( KEY TEXT PRIMARY KEY CHECK ( LENGTH ( KEY ) BETWEEN 1 AND 128 ) , VALUE TEXT NOT NULL , UPDATED_AT TEXT NOT NULL )",\n'
         '    "table hx_routine_confirmations": "CREATE TABLE HX_ROUTINE_CONFIRMATIONS ( CONFIRMATION_ID TEXT PRIMARY KEY , OWNER_KIND TEXT NOT NULL CHECK ( OWNER_KIND IN ( \'agent\' , \'channel\' ) ) , OWNER_ID TEXT NOT NULL , ROUTINE_ID TEXT NOT NULL , TRIGGER_ID TEXT , SCHEDULED_FOR TEXT NOT NULL , REASON TEXT NOT NULL CHECK ( REASON IN ( \'catch-up\' , \'each\' ) ) , MISSED_JSON TEXT CHECK ( MISSED_JSON IS NULL OR JSON_VALID ( MISSED_JSON ) ) , PREVIEW TEXT NOT NULL , ACTIONS_JSON TEXT NOT NULL CHECK ( JSON_VALID ( ACTIONS_JSON ) ) , STATE TEXT NOT NULL CHECK ( STATE IN ( \'waiting\' , \'confirmed\' , \'declined\' , \'expired\' ) ) , REQUEST_ID TEXT , CREATED_AT TEXT NOT NULL , EXPIRES_AT TEXT NOT NULL , SETTLED_AT TEXT , UNIQUE ( OWNER_KIND , ROUTINE_ID , SCHEDULED_FOR ) )",\n'
         '    "table hx_routine_detail": "CREATE TABLE HX_ROUTINE_DETAIL ( OWNER_KIND TEXT NOT NULL CHECK ( OWNER_KIND IN ( \'agent\' , \'channel\' ) ) , ROUTINE_ID TEXT NOT NULL , DETAIL_JSON TEXT NOT NULL CHECK ( JSON_VALID ( DETAIL_JSON ) ) , UPDATED_AT TEXT NOT NULL , PRIMARY KEY ( OWNER_KIND , ROUTINE_ID ) )",\n'
         '    "table hx_run_detail": "CREATE TABLE HX_RUN_DETAIL ( OWNER_KIND TEXT NOT NULL CHECK ( OWNER_KIND IN ( \'agent\' , \'channel\' ) ) , RUN_ID TEXT NOT NULL , ROUTINE_ID TEXT NOT NULL , DETAIL_JSON TEXT NOT NULL CHECK ( JSON_VALID ( DETAIL_JSON ) ) , UPDATED_AT TEXT NOT NULL , PRIMARY KEY ( OWNER_KIND , RUN_ID ) )",\n'
         '    "trigger hx_routine_detail_agent_gone": "CREATE TRIGGER HX_ROUTINE_DETAIL_AGENT_GONE AFTER DELETE ON PROJECTION_AGENT_ROUTINES BEGIN DELETE FROM HX_ROUTINE_DETAIL WHERE OWNER_KIND = \'agent\' AND ROUTINE_ID = OLD . ROUTINE_ID ; DELETE FROM HX_ROUTINE_CONFIRMATIONS WHERE OWNER_KIND = \'agent\' AND ROUTINE_ID = OLD . ROUTINE_ID ; END",\n'
         '    "trigger hx_routine_detail_channel_gone": "CREATE TRIGGER HX_ROUTINE_DETAIL_CHANNEL_GONE AFTER DELETE ON PROJECTION_CHANNEL_ROUTINES BEGIN DELETE FROM HX_ROUTINE_DETAIL WHERE OWNER_KIND = \'channel\' AND ROUTINE_ID = OLD . ROUTINE_ID ; DELETE FROM HX_ROUTINE_CONFIRMATIONS WHERE OWNER_KIND = \'channel\' AND ROUTINE_ID = OLD . ROUTINE_ID ; END",\n'
         '    "trigger hx_run_detail_agent_gone": "CREATE TRIGGER HX_RUN_DETAIL_AGENT_GONE AFTER DELETE ON PROJECTION_ROUTINE_RUNS BEGIN DELETE FROM HX_RUN_DETAIL WHERE OWNER_KIND = \'agent\' AND RUN_ID = OLD . RUN_ID ; END",\n'
         '    "trigger hx_run_detail_channel_gone": "CREATE TRIGGER HX_RUN_DETAIL_CHANNEL_GONE AFTER DELETE ON PROJECTION_CHANNEL_ROUTINE_RUNS BEGIN DELETE FROM HX_RUN_DETAIL WHERE OWNER_KIND = \'channel\' AND RUN_ID = OLD . RUN_ID ; END"\n',
        ),
    ]),
    ('src/backend/hxbot-database-schema.ts', [
    ], [
        (
         'import { DELETED_THREAD_MESSAGES_SCHEMA_SQL } from "./database/deleted-thread-messages-schema";\n',
         'import { DELETED_THREAD_MESSAGES_SCHEMA_SQL } from "./database/deleted-thread-messages-schema";\n'
         'import { HX_ROUTINE_DETAIL_SCHEMA_SQL, migrateHxRoutineDetail } from "./database/hx-routine-detail-schema";\n',
        ),
        (
         '  AGENT_SKILL_LOADS_SCHEMA_SQL;\n',
         '  AGENT_SKILL_LOADS_SCHEMA_SQL +\n'
         '  HX_ROUTINE_DETAIL_SCHEMA_SQL;\n',
        ),
        (
         '    up: (db) => db.exec(AGENT_SKILL_LOADS_SCHEMA_SQL),\n',
         '    up: (db) => db.exec(AGENT_SKILL_LOADS_SCHEMA_SQL),\n'
         '  },\n'
         '  {\n'
         '    version: 59,\n'
         '    // HXBot (v1.7.5): only creates tables, indexes and triggers, so no foreign-key pause and no vacuum. No\n'
         '    // row of another table changes; the tables start empty (database/hx-routine-detail-schema.ts).\n'
         '    up: migrateHxRoutineDetail,\n',
        ),
    ]),
    ('src/backend/hxbot-database.test.ts', [
    ], [
        (
         '      { version: 57 },\n'
         '      { version: 58 },\n'
         '    ]);\n'
         '    database.close();\n',
         '      { version: 57 },\n'
         '      { version: 58 },\n'
         '      { version: 59 },\n'
         '    ]);\n'
         '    database.close();\n',
        ),
        (
         '      { version: 57 },\n'
         '      { version: 58 },\n'
         '    ]);\n'
         '    expect(migrated.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);\n',
         '      { version: 57 },\n'
         '      { version: 58 },\n'
         '      { version: 59 },\n'
         '    ]);\n'
         '    expect(migrated.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);\n',
        ),
        (
         '        "DELETE FROM schema_migrations WHERE version IN (29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58)",\n',
         '        "DELETE FROM schema_migrations WHERE version IN (29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59)",\n',
        ),
        (
         '      DELETE FROM schema_migrations WHERE version IN (19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58);\n',
         '      DELETE FROM schema_migrations WHERE version IN (19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59);\n',
        ),
        (
         '    expect(migrated.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '      version: 58,\n',
         '    expect(migrated.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '      version: 59,\n',
        ),
        (
         '      DELETE FROM schema_migrations WHERE version IN (20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58);\n',
         '      DELETE FROM schema_migrations WHERE version IN (20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59);\n',
        ),
        (
         '    expect(reopened.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '      version: 58,\n',
         '    expect(reopened.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '      version: 59,\n',
        ),
        (
         '        DELETE FROM schema_migrations WHERE version IN (25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58);\n',
         '        DELETE FROM schema_migrations WHERE version IN (25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59);\n',
        ),
        (
         '      expect(migrated.readConversation(agent.id, agent.threadId).messages).toEqual(conversation.messages);\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 58,\n'
         '      });\n',
         '      expect(migrated.readConversation(agent.id, agent.threadId).messages).toEqual(conversation.messages);\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 59,\n'
         '      });\n',
        ),
        (
         '      DELETE FROM schema_migrations WHERE version IN (21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58);\n',
         '      DELETE FROM schema_migrations WHERE version IN (21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59);\n',
        ),
        (
         '      { version: 57 },\n'
         '      { version: 58 },\n'
         '    ]);\n'
         '    migrated.close();\n',
         '      { version: 57 },\n'
         '      { version: 58 },\n'
         '      { version: 59 },\n'
         '    ]);\n'
         '    migrated.close();\n',
        ),
        (
         '      { version: 57 },\n'
         '      { version: 58 },\n'
         '    ]);\n'
         '    retried.close();\n',
         '      { version: 57 },\n'
         '      { version: 58 },\n'
         '      { version: 59 },\n'
         '    ]);\n'
         '    retried.close();\n',
        ),
        (
         '      expect(migrated.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 58,\n',
         '      expect(migrated.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 59,\n',
        ),
        (
         '      expect(connection.prepare("PRAGMA index_info(provider_sessions_thread)").all()).toEqual(originalIndexColumns);\n'
         '      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });\n'
         '      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);\n'
         '      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 58,\n'
         '      });\n'
         '      expect(\n'
         '        connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),\n'
         '      ).toEqual({ provider_session_id: linkedSessionId });\n'
         '      const custom = migrated.bindProviderSession({\n',
         '      expect(connection.prepare("PRAGMA index_info(provider_sessions_thread)").all()).toEqual(originalIndexColumns);\n'
         '      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });\n'
         '      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);\n'
         '      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 59,\n'
         '      });\n'
         '      expect(\n'
         '        connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),\n'
         '      ).toEqual({ provider_session_id: linkedSessionId });\n'
         '      const custom = migrated.bindProviderSession({\n',
        ),
        (
         '      expect(connection.prepare("PRAGMA index_info(provider_sessions_thread)").all()).toEqual(originalIndexColumns);\n'
         '      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });\n'
         '      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);\n'
         '      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 58,\n'
         '      });\n'
         '      expect(\n'
         '        connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),\n'
         '      ).toEqual({ provider_session_id: linkedSessionId });\n'
         '      const cursor = migrated.bindProviderSession({\n',
         '      expect(connection.prepare("PRAGMA index_info(provider_sessions_thread)").all()).toEqual(originalIndexColumns);\n'
         '      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });\n'
         '      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);\n'
         '      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 59,\n'
         '      });\n'
         '      expect(\n'
         '        connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),\n'
         '      ).toEqual({ provider_session_id: linkedSessionId });\n'
         '      const cursor = migrated.bindProviderSession({\n',
        ),
        (
         '      expect(connection.prepare("PRAGMA index_info(provider_sessions_thread)").all()).toEqual(originalIndexColumns);\n'
         '      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });\n'
         '      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);\n'
         '      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 58,\n'
         '      });\n'
         '      expect(\n'
         '        connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),\n'
         '      ).toEqual({ provider_session_id: linkedSessionId });\n'
         '      const cline = migrated.bindProviderSession({\n',
         '      expect(connection.prepare("PRAGMA index_info(provider_sessions_thread)").all()).toEqual(originalIndexColumns);\n'
         '      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });\n'
         '      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);\n'
         '      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 59,\n'
         '      });\n'
         '      expect(\n'
         '        connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),\n'
         '      ).toEqual({ provider_session_id: linkedSessionId });\n'
         '      const cline = migrated.bindProviderSession({\n',
        ),
        (
         '      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 58,\n'
         '      });\n'
         '      const agentRoutines = new AgentRoutineStore(migrated);\n',
         '      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 59,\n'
         '      });\n'
         '      const agentRoutines = new AgentRoutineStore(migrated);\n',
        ),
        (
         '      expect(connection.prepare("PRAGMA index_info(provider_sessions_thread)").all()).toEqual(originalIndexColumns);\n'
         '      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });\n'
         '      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);\n'
         '      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 58,\n'
         '      });\n'
         '      expect(\n'
         '        connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),\n'
         '      ).toEqual({ provider_session_id: linkedSessionId });\n'
         '      expect(\n',
         '      expect(connection.prepare("PRAGMA index_info(provider_sessions_thread)").all()).toEqual(originalIndexColumns);\n'
         '      expect(connection.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });\n'
         '      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);\n'
         '      expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 59,\n'
         '      });\n'
         '      expect(\n'
         '        connection.prepare("SELECT provider_session_id FROM projection_turns WHERE turn_id = ?").get("turn-1"),\n'
         '      ).toEqual({ provider_session_id: linkedSessionId });\n'
         '      expect(\n',
        ),
        (
         '      expect(routineRows(connection)).toEqual(original);\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 58,\n'
         '      });\n',
         '      expect(routineRows(connection)).toEqual(original);\n'
         '      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({\n'
         '        version: 59,\n'
         '      });\n',
        ),
        (
         '      "DROP TABLE projection_agent_threads; DELETE FROM schema_migrations WHERE version IN (38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58)",\n',
         '      "DROP TABLE projection_agent_threads; DELETE FROM schema_migrations WHERE version IN (38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59)",\n',
        ),
    ]),
    ('src/backend/hxbot-tools.ts', [
    ], [
        (
         '      "Create a scheduled routine, one agent\'s instruction, for this agent or for another local agent when agentId is provided. For several steps in one graph, use edit_workflow. It is active by default. Without a timezone, it uses the timezone of the person whose message this turn answers, or the server timezone when that is unknown. Interval, advanced-every, and custom schedules must not run more often than every 3 minutes. For a one-time reminder or task, use a once schedule: it runs one time and then pauses the routine.",\n',
         '      "Create a scheduled routine, one agent\'s instruction, for this agent or for another local agent when agentId is provided. For several steps in one graph, use edit_workflow. It is active by default. Default timezone: the user\'s registered one; if none, the call fails: ask the user once. Interval, advanced-every, and custom schedules must not run more often than every 3 minutes. For a one-time reminder or task, use a once schedule: it runs once, then pauses the routine.",\n',
        ),
        (
         '      timezone: z.string().min(1).max(128).describe("IANA timezone such as Europe/Warsaw.").optional(),\n',
         '      timezone: z.string().min(1).max(128).describe("IANA timezone.").optional(),\n',
        ),
        (
         '      schedule: routineScheduleZodSchema\n'
         '        .describe("Routine schedule. Must not run more often than every 3 minutes.")\n'
         '        .optional(),\n',
         "      // HXBot (v1.7.5, RTN-01): the 3-minute rule is in the tool's description; its repeat here made room for timezone.\n"
         '      schedule: routineScheduleZodSchema.describe("Routine schedule.").optional(),\n',
        ),
        (
         '      active: z.boolean().optional(),\n'
         '      limitPolicy: routineLimitPolicyZodSchema.optional(),\n'
         '      missedPolicy: routineMissedPolicyZodSchema.optional(),\n'
         '      runIn: routineRunPlaceZodSchema.optional(),\n'
         '    },\n'
         '  },\n'
         '  {\n',
         '      active: z.boolean().optional(),\n'
         '      limitPolicy: routineLimitPolicyZodSchema.optional(),\n'
         '      missedPolicy: routineMissedPolicyZodSchema.optional(),\n'
         '      runIn: routineRunPlaceZodSchema.optional(),\n'
         '      timezone: z.string().optional(),\n'
         '    },\n'
         '  },\n'
         '  {\n',
        ),
    ]),
    ('src/backend/mailbox-reconcile-migration.test.ts', [
    ], [
        (
         '    agent_usage_skill_loads: [],\n',
         '    agent_usage_skill_loads: [],\n'
         '    hx_external_actions: [],\n'
         '    hx_meta: [],\n'
         '    hx_routine_confirmations: [],\n'
         '    hx_routine_detail: [],\n'
         '    hx_run_detail: [],\n',
        ),
        (
         '      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
        (
         '      "DELETE FROM schema_migrations WHERE version IN (38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58)",\n',
         '      "DELETE FROM schema_migrations WHERE version IN (38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59)",\n',
        ),
        (
         '      version: 58,\n',
         '      version: 59,\n',
        ),
    ]),
    ('src/backend/messaging-allowed-roles-migration.test.ts', [
    ], [
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '        agent_usage_skill_loads: [],\n',
         '        agent_usage_skill_loads: [],\n'
         '        hx_external_actions: [],\n'
         '        hx_meta: [],\n'
         '        hx_routine_confirmations: [],\n'
         '        hx_routine_detail: [],\n'
         '        hx_run_detail: [],\n',
        ),
        (
         '      agent_usage_skill_loads: [],\n'
         '    });\n',
         '      agent_usage_skill_loads: [],\n'
         '      hx_external_actions: [],\n'
         '      hx_meta: [],\n'
         '      hx_routine_confirmations: [],\n'
         '      hx_routine_detail: [],\n'
         '      hx_run_detail: [],\n'
         '    });\n',
        ),
        (
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
    ]),
    ('src/backend/messaging-allowed-senders-migration.test.ts', [
    ], [
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '        agent_usage_skill_loads: [],\n',
         '        agent_usage_skill_loads: [],\n'
         '        hx_external_actions: [],\n'
         '        hx_meta: [],\n'
         '        hx_routine_confirmations: [],\n'
         '        hx_routine_detail: [],\n'
         '        hx_run_detail: [],\n',
        ),
        (
         '      agent_usage_skill_loads: [],\n'
         '    });\n',
         '      agent_usage_skill_loads: [],\n'
         '      hx_external_actions: [],\n'
         '      hx_meta: [],\n'
         '      hx_routine_confirmations: [],\n'
         '      hx_routine_detail: [],\n'
         '      hx_run_detail: [],\n'
         '    });\n',
        ),
        (
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
    ]),
    ('src/backend/messaging-memory-migration.test.ts', [
    ], [
        (
         '        agent_usage_skill_loads: [],\n',
         '        agent_usage_skill_loads: [],\n'
         '        hx_external_actions: [],\n'
         '        hx_meta: [],\n'
         '        hx_routine_confirmations: [],\n'
         '        hx_routine_detail: [],\n'
         '        hx_run_detail: [],\n',
        ),
        (
         '      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '      agent_usage_skill_loads: [],\n'
         '    });\n',
         '      agent_usage_skill_loads: [],\n'
         '      hx_external_actions: [],\n'
         '      hx_meta: [],\n'
         '      hx_routine_confirmations: [],\n'
         '      hx_routine_detail: [],\n'
         '      hx_run_detail: [],\n'
         '    });\n',
        ),
        (
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
    ]),
    ('src/backend/migration-guard-migration.test.ts', [
    ], [
        (
         '      expect(versions(db)).toEqual(range(8, 58));\n',
         '      expect(versions(db)).toEqual(range(8, 59));\n',
        ),
        (
         '    migrateOpenBotDatabase(db);\n'
         '    expect(versions(db)).toEqual(range(8, 58));\n',
         '    migrateOpenBotDatabase(db);\n'
         '    expect(versions(db)).toEqual(range(8, 59));\n',
        ),
        (
         '    expect(versions(db)).toEqual(range(8, 58).filter((version) => version !== missing));\n',
         '    expect(versions(db)).toEqual(range(8, 59).filter((version) => version !== missing));\n',
        ),
    ]),
    ('src/backend/pre-registry-schema-migration.test.ts', [
    ], [
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
    ]),
    ('src/backend/routine-flow-sweep-index-migration.test.ts', [
    ], [
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
    ]),
    ('src/backend/routine-result-migration.test.ts', [
    ], [
        (
         '  agent_usage_skill_loads: [],\n',
         '  agent_usage_skill_loads: [],\n'
         '  hx_external_actions: [],\n'
         '  hx_meta: [],\n'
         '  hx_routine_confirmations: [],\n'
         '  hx_routine_detail: [],\n'
         '  hx_run_detail: [],\n',
        ),
        (
         '      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
    ]),
    ('src/backend/routine-run-columns-migration.test.ts', [
    ], [
        (
         '      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '      expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
    ]),
    ('src/backend/routine-run-place-migration.test.ts', [
    ], [
        (
         'const LATER_TABLES = { agent_usage_skill_loads: [] };\n',
         'const LATER_TABLES = {\n'
         '  agent_usage_skill_loads: [],\n'
         '  hx_external_actions: [],\n'
         '  hx_meta: [],\n'
         '  hx_routine_confirmations: [],\n'
         '  hx_routine_detail: [],\n'
         '  hx_run_detail: [],\n'
         '};\n',
        ),
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '    const columnsBefore = columns(db, "projection_agent_routines");\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    const columnsBefore = columns(db, "projection_agent_routines");\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=54");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=54");\n',
        ),
        (
         '    // An application one release older knows versions up to 58 at most: version 59 is newer than it supports.\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    // An application one release older knows versions up to 58 at most: version 59 is newer than it supports.\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
    ]),
    ('src/backend/routine-store.ts', [
    ], [
        (
         '} from "./database/database-rows";\n',
         '} from "./database/database-rows";\n'
         'import {\n'
         '  type HxRunDetail,\n'
         '  hxConfirmZone,\n'
         '  hxRoutineFlagsOf,\n'
         '  hxRunsWithFlags,\n'
         '  hxWriteRoutineDetail,\n'
         '  hxWriteRunDetail,\n'
         '} from "./hx-routines/detail";\n',
        ),
        (
         '  limitPolicy?: RoutineLimitPolicy;\n'
         '  missedPolicy?: RoutineMissedPolicy;\n'
         '  runIn?: RoutineRunPlace;\n'
         '}\n'
         '\n'
         'interface RoutineWebhookFields {\n',
         '  limitPolicy?: RoutineLimitPolicy;\n'
         '  missedPolicy?: RoutineMissedPolicy;\n'
         '  runIn?: RoutineRunPlace;\n'
         '  /** HXBot (v1.7.5, RTN-01): an IANA zone. Left out, the routine keeps its zone. */\n'
         '  timezone?: string;\n'
         '}\n'
         '\n'
         'interface RoutineWebhookFields {\n',
        ),
        (
         '        this.#insertTrigger(db, routineId, input.timezone, schedule, createdAt, sequence, now);\n',
         '        this.#insertTrigger(db, routineId, input.timezone, schedule, createdAt, sequence, now);\n'
         '        // HXBot (v1.7.5, RTN-01): a routine made now has a zone that someone chose.\n'
         '        hxConfirmZone(db, this.tables.ownerKind, routineId, createdAt);\n',
        ),
        (
         '    this.#validateInput(name, instruction, current.timezone, schedule, current.trigger.schedule);\n',
         '    // HXBot (v1.7.5, RTN-01): an update can name a new zone. The next run moves to it.\n'
         '    const timezone = input.timezone ?? current.timezone;\n'
         '    const zoneChanged = timezone !== current.timezone;\n'
         '    this.#validateInput(name, instruction, timezone, schedule, current.trigger.schedule);\n',
        ),
        (
         '    if (active && (input.schedule || reactivating)) assertOnceAhead(schedule, current.timezone, now);\n',
         '    if (active && (input.schedule || reactivating || zoneChanged)) assertOnceAhead(schedule, timezone, now);\n',
        ),
        (
         '        );\n'
         '        if (input.runIn) this.#writeRunIn(db, input.routineId, input.runIn);\n',
         '        );\n'
         '        if (zoneChanged) {\n'
         '          db.prepare(`UPDATE ${routineTable} SET timezone = ? WHERE routine_id = ? AND ${ownerColumn} = ?`).run(\n'
         '            timezone,\n'
         '            input.routineId,\n'
         '            ownerId,\n'
         '          );\n'
         '        }\n'
         '        // HXBot (v1.7.5, MIG-03): an update that names a zone confirms it, also when it is the same one.\n'
         '        if (input.timezone !== undefined) hxConfirmZone(db, this.tables.ownerKind, input.routineId, updatedAt);\n'
         '        if (input.runIn) this.#writeRunIn(db, input.routineId, input.runIn);\n',
        ),
        (
         '          this.#insertTrigger(db, input.routineId, current.timezone, schedule, updatedAt, sequence, now);\n'
         '        } else if (reactivating) {\n',
         '          this.#insertTrigger(db, input.routineId, timezone, schedule, updatedAt, sequence, now);\n'
         '        } else if (reactivating || (zoneChanged && active)) {\n',
        ),
        (
         '            nextRoutineOccurrence(schedule, current.timezone, now).toISOString(),\n',
         '            nextRoutineOccurrence(schedule, timezone, now).toISOString(),\n',
        ),
        (
         '        if (runIn) this.#writeRunIn(db, id, runIn);\n',
         '        if (runIn) this.#writeRunIn(db, id, runIn);\n'
         '        // HXBot (v1.7.5, MIG-03): a save that carries the zone of a schedule confirms it.\n'
         '        if (schedule) hxConfirmZone(db, this.tables.ownerKind, id, timestamp);\n',
        ),
        (
         '        .all(routineId, ownerId, safeLimit),\n'
         '    ).map((row) => this.#run(row));\n',
         '        .all(routineId, ownerId, safeLimit),\n'
         '    )\n'
         '      .map((row) => this.#run(row))\n'
         '      .map(hxRunsWithFlags(this.database.connection, this.tables.ownerKind, routineId));\n',
        ),
        (
         '        this.#recordMissed(routine, { first, until: missed.previous, count }, missed.last);\n',
         '        // HXBot (v1.7.5, RTN-02): the record names every missed occurrence and that the newest one runs once.\n'
         '        this.#recordMissed(routine, { first, until: missed.previous, count }, missed.last, {\n'
         '          missed: {\n'
         '            total: missed.count,\n'
         '            from: first.toISOString(),\n'
         '            until: missed.last.toISOString(),\n'
         '            handled: "run-once",\n'
         '            while: "closed",\n'
         '          },\n'
         '        });\n'
         '        hxWriteRoutineDetail(this.database.connection, this.tables.ownerKind, routine.id, (detail) => ({\n'
         '          ...detail,\n'
         '          pendingCatchUp: {\n'
         '            scheduledFor: missed.last.toISOString(),\n'
         '            total: missed.count,\n'
         '            from: first.toISOString(),\n'
         '            until: missed.last.toISOString(),\n'
         '          },\n'
         '        }));\n',
        ),
        (
         '        this.#recordMissed(routine, { first, until: missed.last, count: missed.count }, missed.next);\n',
         '        this.#recordMissed(routine, { first, until: missed.last, count: missed.count }, missed.next, {\n'
         '          missed: {\n'
         '            total: missed.count,\n'
         '            from: first.toISOString(),\n'
         '            until: missed.last.toISOString(),\n'
         '            handled: "skip",\n'
         '            while: "closed",\n'
         '          },\n'
         '        });\n',
        ),
        (
         '    this.#recordMissed(routine, { first: at, until: at, count: 1 }, null);\n',
         '    this.#recordMissed(routine, { first: at, until: at, count: 1 }, null, {\n'
         '      missed: { total: 1, from: at.toISOString(), until: at.toISOString(), handled: "skip", while: "closed" },\n'
         '    });\n',
        ),
        (
         '    nextRunAt: Date | null,\n',
         '    nextRunAt: Date | null,\n'
         '    hx?: HxRunDetail,\n',
        ),
        (
         '        );\n'
         '        if (next) {\n',
         '        );\n'
         '        // HXBot (v1.7.5, RTN-02): how many came due while HXBot was closed, and what the policy did.\n'
         '        if (hx) hxWriteRunDetail(db, this.tables.ownerKind, runId, routine.id, () => hx, timestamp);\n'
         '        if (next) {\n',
        ),
        (
         '        return null;\n'
         '      },\n'
         '    );\n'
         '  }\n'
         '\n'
         '  protected createRunRow(\n',
         '        return null;\n'
         '      },\n'
         '    );\n'
         '  }\n'
         '\n'
         '  /**\n'
         '   * HXBot (v1.7.5, RTN-03 / RTN-02): one record in the run history of occurrences that did not run: a\n'
         '   * skipped trigger (the last run still runs, a spent plan, a declined or expired confirmation) or the\n'
         '   * occurrences a sleep made late. It is a cancelled run with a missed count, as the records of a closed\n'
         '   * HXBot are, so a released client reads "skipped n"; HXBot\'s own reason goes in `hx_run_detail`. A second\n'
         '   * call for the same trigger and time does nothing.\n'
         '   */\n'
         '  protected hxRecordNotRunRow(\n'
         '    routine: RunSource,\n'
         '    triggerId: string | null,\n'
         '    record: { scheduledFor: string; until: string | null; count: number },\n'
         '    detail: HxRunDetail,\n'
         '  ): void {\n'
         '    const { commandPrefix, eventPrefix, runAggregate, runTable, ownerColumn } = this.tables;\n'
         '    const runId = randomUUID();\n'
         '    const count = Math.max(1, Math.min(record.count, ROUTINE_MISSED_COUNT_LIMIT + 1));\n'
         '    const until = count > 1 ? record.until : null;\n'
         '    this.database.dispatch(\n'
         '      `${commandPrefix}-trigger:hx-not-run:${triggerId ?? routine.id}:${record.scheduledFor}`,\n'
         '      [\n'
         '        {\n'
         '          aggregateType: runAggregate,\n'
         '          aggregateId: routine.id,\n'
         '          eventType: `${eventPrefix}.run-missed`,\n'
         '          payload: { runId, triggerId, scheduledFor: record.scheduledFor, until, count },\n'
         '        },\n'
         '      ],\n'
         '      (db, sequences) => {\n'
         '        const exists = db\n'
         '          .prepare(`SELECT 1 FROM ${runTable} WHERE trigger_id IS ? AND scheduled_for = ?`)\n'
         '          .get(triggerId, record.scheduledFor);\n'
         '        if (exists) return null;\n'
         '        const timestamp = new Date().toISOString();\n'
         '        db.prepare(\n'
         '          `INSERT INTO ${runTable} (\n'
         '             run_id, routine_id, ${ownerColumn}, trigger_id, run_kind, scheduled_for, routine_name, instruction,\n'
         '             status, error, missed_count, missed_until, created_at, updated_at, last_event_sequence\n'
         "           ) VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, 'cancelled', NULL, ?, ?, ?, ?, ?)`,\n"
         '        ).run(\n'
         '          runId,\n'
         '          routine.id,\n'
         '          routine.ownerId,\n'
         '          triggerId,\n'
         '          record.scheduledFor,\n'
         '          routine.name,\n'
         '          routine.instruction,\n'
         '          count,\n'
         '          until,\n'
         '          timestamp,\n'
         '          timestamp,\n'
         '          sequences[0] ?? 0,\n'
         '        );\n'
         '        hxWriteRunDetail(db, this.tables.ownerKind, runId, routine.id, () => detail, timestamp);\n'
         '        return null;\n'
         '      },\n'
         '    );\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5): writes what HXBot records about a run, in its own table. */\n'
         '  protected hxNoteRunRow(runId: string, routineId: string, change: (detail: HxRunDetail) => HxRunDetail): void {\n'
         '    hxWriteRunDetail(this.database.connection, this.tables.ownerKind, runId, routineId, change);\n'
         '  }\n'
         '\n'
         '  protected createRunRow(\n',
        ),
        (
         '      ...this.#runIn(row),\n',
         '      ...this.#runIn(row),\n'
         '      // HXBot (v1.7.5): what HXBot records about the routine. The frozen Team API routes leave it out.\n'
         '      ...hxRoutineFlagsOf(this.database.connection, this.tables.ownerKind, requiredStringColumn(row, "routine_id")),\n',
        ),
    ]),
    ('src/backend/thread-message-order-migration.test.ts', [
    ], [
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
    ]),
    ('src/backend/workflow-migration.test.ts', [
    ], [
        (
         '  browser_profile_proxies: [],\n'
         '  agent_usage_skill_loads: [],\n'
         '};\n'
         '\n',
         '  browser_profile_proxies: [],\n'
         '  agent_usage_skill_loads: [],\n'
         '  hx_external_actions: [],\n'
         '  hx_meta: [],\n'
         '  hx_routine_confirmations: [],\n'
         '  hx_routine_detail: [],\n'
         '  hx_run_detail: [],\n'
         '};\n'
         '\n',
        ),
        (
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });\n',
         '  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });\n',
        ),
        (
         '    const before = contents(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n',
         '    const before = contents(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n',
        ),
        (
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=20");\n',
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");\n',
        ),
        (
         '  browser_profile_proxies: [],\n'
         '  agent_usage_skill_loads: [],\n'
         '};\n'
         'const EMPTY_LATER_TABLES = { projection_messaging_allowed_senders: [], ...EMPTY_V54_TABLES };\n',
         '  browser_profile_proxies: [],\n'
         '  agent_usage_skill_loads: [],\n'
         '  hx_external_actions: [],\n'
         '  hx_meta: [],\n'
         '  hx_routine_confirmations: [],\n'
         '  hx_routine_detail: [],\n'
         '  hx_run_detail: [],\n'
         '};\n'
         'const EMPTY_LATER_TABLES = { projection_messaging_allowed_senders: [], ...EMPTY_V54_TABLES };\n',
        ),
        (
         '    const before = contents(db);\n'
         '    const check = runSourceCheck(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n'
         '    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");\n'
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=46");\n',
         '    const before = contents(db);\n'
         '    const check = runSourceCheck(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n'
         '    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");\n'
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=46");\n',
        ),
        (
         '    const before = contents(db);\n'
         '    const check = runSourceCheck(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n'
         '    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");\n'
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=47");\n',
         '    const before = contents(db);\n'
         '    const check = runSourceCheck(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n'
         '    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");\n'
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=47");\n',
        ),
        (
         '    seed(db, 51);\n'
         '    seedWorkflow(db);\n'
         '    const before = contents(db);\n'
         '    const check = runSourceCheck(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n'
         '    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");\n'
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=48");\n'
         '    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 48");\n'
         '    expect(contents(db)).toEqual(before);\n'
         '    expect(runSourceCheck(db)).toBe(check);\n'
         '  });\n'
         '});\n',
         '    seed(db, 51);\n'
         '    seedWorkflow(db);\n'
         '    const before = contents(db);\n'
         '    const check = runSourceCheck(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n'
         '    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");\n'
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=48");\n'
         '    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 48");\n'
         '    expect(contents(db)).toEqual(before);\n'
         '    expect(runSourceCheck(db)).toBe(check);\n'
         '  });\n'
         '});\n',
        ),
        (
         '    seed(db, 52);\n'
         '    seedWorkflow(db);\n'
         '    const before = contents(db);\n'
         '    const check = runSourceCheck(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(59,\'now\')");\n'
         '    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");\n'
         '    db.exec("DELETE FROM schema_migrations WHERE version=59; DELETE FROM schema_migrations WHERE version=48");\n'
         '    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 48");\n'
         '    expect(contents(db)).toEqual(before);\n'
         '    expect(runSourceCheck(db)).toBe(check);\n'
         '  });\n'
         '});\n',
         '    seed(db, 52);\n'
         '    seedWorkflow(db);\n'
         '    const before = contents(db);\n'
         '    const check = runSourceCheck(db);\n'
         '    db.exec("INSERT INTO schema_migrations VALUES(60,\'now\')");\n'
         '    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");\n'
         '    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=48");\n'
         '    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 48");\n'
         '    expect(contents(db)).toEqual(before);\n'
         '    expect(runSourceCheck(db)).toBe(check);\n'
         '  });\n'
         '});\n',
        ),
    ]),
    ('src/main/application-services.ts', [
        'import { hxAttachNotifier } from "../backend/hx-routines/notify";',
        'import { hxRoutineZones } from "../backend/hx-routines/zone";',
        'import { hxTurnTools } from "../backend/hx-workflows/turn-tools";',
    ], [
        (
         '} from "./hosted-update-adapter";\n',
         '} from "./hosted-update-adapter";\n'
         'import { hxAgentDeletes } from "./hx-agent-deletes";\n',
        ),
        (
         'import { sourceText } from "@openbot/i18n/source";\n',
         'import { localizeSourceText, sourceText } from "@openbot/i18n/source";\n',
        ),
        (
         'import { desktopShowsAgentEvent } from "./desktop-notifications";\n',
         'import { desktopShowsAgentEvent, showRetainedNotification } from "./desktop-notifications";\n',
        ),
        (
         '  await runCauseEffect(serverTimezone.load());\n',
         '  await runCauseEffect(serverTimezone.load());\n'
         '  // HXBot (v1.7.5, RTN-04): a routine run whose result is not verified shows a desktop notification, when the\n'
         '  // person allows them.\n'
         '  hxAttachNotifier((title, body) => {\n'
         '    if (!Notification.isSupported() || !notificationPreference.get().desktopNotifications) return;\n'
         '    // The backend writes English source text, one template per line; the person reads their language.\n'
         '    const local = (text: string) =>\n'
         '      text\n'
         '        .split("\\n")\n'
         '        .map((line) => localizeSourceText(line, language.locale))\n'
         '        .join("\\n");\n'
         '    showRetainedNotification(new Notification({ title: local(title), body: local(body) }));\n'
         '  });\n'
         '  // HXBot (v1.7.5, RTN-01): the registered zone of new routines is the server timezone the user chose.\n'
         '  hxRoutineZones.attach({\n'
         '    registered: () => serverTimezone.get().timezone,\n'
         '    register: (zone) => runCauseEffect(serverTimezone.set(zone)).then(() => undefined),\n'
         '  });\n',
        ),
        (
         '    return Effect.runPromise(workflowRuntime.close());\n',
         '    return Effect.runPromise(workflowRuntime.close());\n'
         '  });\n'
         '  // HXBot (v1.7.5, RTN-11): "save as a workflow" in a chat makes a workflow of this computer.\n'
         '  hxTurnTools.attach({\n'
         '    connection: () => store.database.connection,\n'
         '    agentName: (agentId) => service.listAgents().find((agent) => agent.id === agentId)?.name ?? null,\n'
         '    create: async ({ title, graph }) => {\n'
         '      const detail = await runCauseEffect(workflowRuntime.create({ title, graph }));\n'
         '      return { workflowId: detail.summary.id, title: detail.summary.title };\n'
         '    },\n'
         '    texts: () => ({\n'
         '      confirm: (what) => language.translate("workflow.hx.confirmStep", { what }),\n'
         '      title: (agent, date) => language.translate("workflow.hx.savedTitle", { agent, date }),\n'
         '    }),\n',
        ),
        (
         '      });\n'
         '    }),\n',
         '      });\n'
         '      // HXBot (v1.7.5 fix): the agent deletes that a quit or a killed process left end now.\n'
         '      hxAgentDeletes.start();\n'
         '    }),\n',
        ),
        (
         '  );\n'
         '  const describeRestartReadiness = (): RestartReadiness =>\n',
         '  );\n'
         '  // HXBot (v1.7.5 fix): from the quit on, a held delete stays on disk and ends on the next start.\n'
         '  teardown.push(TEARDOWN_ORDER.resourceMonitor, "the held agent deletes", () => hxAgentDeletes.stop());\n'
         '  const describeRestartReadiness = (): RestartReadiness =>\n',
        ),
    ]),
    ('src/main/ipc/agent-inputs.ts', [
    ], [
        (
         '  if (value.schedule !== undefined) parsed.schedule = parseRoutineSchedule(value.schedule);\n'
         '  Object.assign(\n',
         '  if (value.schedule !== undefined) parsed.schedule = parseRoutineSchedule(value.schedule);\n'
         '  // HXBot (v1.7.5, RTN-01): the editor can change the zone of a saved routine. The store checks the name.\n'
         '  if (value.timezone !== undefined) parsed.timezone = requireString(value.timezone, "timezone", 128);\n'
         '  Object.assign(\n',
        ),
    ]),
    ('src/renderer/src/features/channels/ChannelConversationParts.tsx', [
    ], [
        (
         '    const legacy = channelRoutinesPort(props.channelId, runtime().agent, props.routines.localHost());\n',
         '    const port = channelRoutinesPort(props.channelId, runtime().agent, props.routines.localHost());\n',
        ),
        (
         '    const serverId = props.routines.eventsServerId();\n',
         '    const serverId = props.routines.eventsServerId();\n'
         "    // HXBot (v1.7.5, RTN-01): this computer's host tells the editor the registered zone.\n"
         '    const legacy =\n'
         '      props.routines.localHost() && serverId\n'
         '        ? {\n'
         '            ...port,\n'
         '            registeredZone: () => window.openbot.hostAdmin.getTimezone(serverId).then((settings) => settings.timezone),\n'
         '            registerZone: (zone: string) => window.openbot.hostAdmin.setTimezone(zone, serverId).then(() => undefined),\n'
         "            // HXBot (v1.7.5, RTN-02, MIG-03): the channel routine's run that waits for the yes.\n"
         '            answerConfirm: (cardId: string, run: boolean) =>\n'
         '              window.openbot.auth.hxAnswerRoutineConfirm({ channelId: props.channelId, cardId, run }),\n'
         '          }\n'
         '        : port;\n',
        ),
    ]),
    ('src/renderer/src/features/conversation/AgentRoutinesSettings.tsx', [
    ], [
        (
         'import { SettingsBackIcon, SettingsForwardIcon } from "@openbot/ui/components/SettingsPanel";\n',
         'import { SettingsBackIcon, SettingsForwardIcon } from "@openbot/ui/components/SettingsPanel";\n'
         'import { HxRoutineUpcoming } from "@openbot/ui/features/conversation/HxRoutineUpcoming";\n',
        ),
        (
         'import { HostedUpsellRoutinesNotice, hostedUpsellRoutineCreated } from "../servers/hosted-server-upsell-controller";\n',
         'import { HostedUpsellRoutinesNotice, hostedUpsellRoutineCreated } from "../servers/hosted-server-upsell-controller";\n'
         'import {\n'
         '  HxRoutineListBadges,\n'
         '  HxRoutineQueueNote,\n'
         '  HxRoutineUpgradeNotice,\n'
         '  HxRoutineWaitingRows,\n'
         '} from "./HxRoutineNotes";\n'
         'import { HxRoutineZoneField, hxDeviceZone } from "./HxRoutineZoneField";\n',
        ),
        (
         '  destination: RoutineResultChoice | null | undefined;\n',
         '  destination: RoutineResultChoice | null | undefined;\n'
         '  /** HXBot (v1.7.5, RTN-01): an IANA zone; empty until the person chooses one. */\n'
         '  timezone: string;\n',
        ),
        (
         '  const scrollFades = createScrollFades();\n',
         '  const scrollFades = createScrollFades();\n'
         '  // HXBot (v1.7.5, RTN-01): the registered zone; null when none is registered, undefined when unknown.\n'
         '  const [registeredZone, setRegisteredZone] = createSignal<string | null | undefined>(undefined);\n'
         '  createEffect(\n'
         '    () => props.port.registeredZone,\n'
         '    (load) => {\n'
         '      setRegisteredZone(undefined);\n'
         '      if (!load) return;\n'
         '      load().then(\n'
         '        (zone) => setRegisteredZone(zone),\n'
         '        () => setRegisteredZone(undefined),\n'
         '      );\n'
         '    },\n'
         '  );\n',
        ),
        (
         '        runIn: current.runIn === (base.runIn ?? "chat") ? (routine.runIn ?? "chat") : current.runIn,\n',
         '        runIn: current.runIn === (base.runIn ?? "chat") ? (routine.runIn ?? "chat") : current.runIn,\n'
         '        timezone:\n'
         '          current.timezone === (hxZoneUnconfirmed(base) ? "" : base.timezone)\n'
         '            ? hxZoneUnconfirmed(routine)\n'
         '              ? ""\n'
         '              : routine.timezone\n'
         '            : current.timezone,\n',
        ),
        (
         '      ...triggerDraftOf(routine),\n'
         '      destination: undefined,\n'
         '    });\n',
         '      ...triggerDraftOf(routine),\n'
         '      destination: undefined,\n'
         '      // HXBot (v1.7.5, MIG-03): a zone nobody confirmed starts empty, so a save asks for it.\n'
         '      timezone: hxZoneUnconfirmed(routine) ? "" : routine.timezone,\n'
         '    });\n',
        ),
        (
         '      eventFilters: [],\n'
         '      destination: undefined,\n'
         '    });\n',
         '      eventFilters: [],\n'
         '      destination: undefined,\n'
         '      // HXBot (v1.7.5, RTN-01): the registered zone. With none registered the person chooses one; a client\n'
         "      // that cannot read it starts with this device's zone, which the field shows.\n"
         '      timezone: newRoutineZone(registeredZone()),\n'
         '    });\n',
        ),
        (
         '        // An update keeps the saved zone, so an edit on a computer in another zone does not move the schedule.\n',
         '        // HXBot (v1.7.5, RTN-01): the zone in the field. A webhook routine keeps a zone for a later schedule.\n',
        ),
        (
         '          (current.id ? draftBase?.timezone : undefined) ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),\n',
         '          current.timezone ||\n'
         '          (current.id ? draftBase?.timezone : undefined) ||\n'
         '          registeredZone() ||\n'
         '          hxDeviceZone() ||\n'
         '          "UTC",\n'
         '        zoneChanged:\n'
         '          current.triggerKind === "schedule" &&\n'
         '          current.id !== null &&\n'
         '          (current.timezone !== draftBase?.timezone || hxZoneUnconfirmed(draftBase)),\n',
        ),
        (
         '      if (draft()?.id === current.id) draftBase = saved;\n',
         '      if (draft()?.id === current.id) draftBase = saved;\n'
         '      // HXBot (v1.7.5, RTN-01): the first zone the person saves becomes the registered zone. The routine\n'
         '      // keeps its zone when this fails, and the next new routine asks again.\n'
         '      const register = props.port.registerZone;\n'
         '      if (register && registeredZone() === null && current.triggerKind === "schedule" && saved.timezone) {\n'
         '        const zone = saved.timezone;\n'
         '        void register(zone).then(\n'
         '          () => setRegisteredZone(zone),\n'
         '          () => undefined,\n'
         '        );\n'
         '      }\n',
        ),
        (
         '   */\n'
         '  async function setRoutineActive(routine: RoutineEditorRecord, active: boolean): Promise<void> {\n',
         '   */\n'
         '  /** HXBot (v1.7.5, MIG-03): saves a routine from an earlier version with its own zone, which confirms it. */\n'
         '  async function hxConfirmRoutineZone(routine: RoutineEditorRecord): Promise<void> {\n'
         '    const schedule = routineScheduleOf(routine);\n'
         '    await props.port.save({\n'
         '      routineId: routine.id,\n'
         '      name: routine.name,\n'
         '      instruction: routine.instruction,\n'
         '      active: routine.active,\n'
         '      timezone: routine.timezone,\n'
         '      schedule,\n'
         '      trigger: { kind: "schedule", schedule },\n'
         '      zoneChanged: true,\n'
         '    });\n'
         '    await loadRoutines();\n'
         '  }\n'
         '\n'
         '  async function setRoutineActive(routine: RoutineEditorRecord, active: boolean): Promise<void> {\n',
        ),
        (
         '                >\n'
         '                  <div class="agent-routines-list">\n',
         '                >\n'
         '                  {/* HXBot (v1.7.5, MIG-03): what the upgrade changed, routine by routine. */}\n'
         '                  <HxRoutineUpgradeNotice\n'
         '                    ownerId={props.port.ownerId}\n'
         '                    routines={listedRoutines()}\n'
         '                    confirmZone={hxConfirmRoutineZone}\n'
         '                  />\n'
         '                  <div class="agent-routines-list">\n',
        ),
        (
         '                                </small>\n',
         '                                </small>\n'
         '                                {/* HXBot (v1.7.5, RTN-04, MIG-03): a result not verified, asks each time, zone not confirmed. */}\n'
         '                                <HxRoutineListBadges routine={routine()} />\n',
        ),
        (
         '                          </div>\n',
         '                          </div>\n'
         '                          {/* HXBot (v1.7.5, RTN-02, MIG-03): a run that waits for the yes, answered here. */}\n'
         '                          <HxRoutineWaitingRows\n'
         '                            routine={routine()}\n'
         '                            answer={props.port.answerConfirm}\n'
         '                            answered={() => void loadRoutines()}\n'
         '                          />\n',
        ),
        (
         '              </div>\n'
         '\n',
         '              </div>\n'
         '              {/* HXBot (v1.7.5, RTN-06): a paused routine reads back what it still has waiting. */}\n'
         '              <HxRoutineQueueNote\n'
         '                routine={current().id ? (routines().find((routine) => routine.id === current().id) ?? null) : null}\n'
         '                onOpenRun={(messageId) => requestOpenRun(messageId)}\n'
         '              />\n'
         '\n',
        ),
        (
         '                    onChange={(scheduleDraft) => changeDraft((value) => reopened(withSchedule(value, scheduleDraft)))}\n',
         '                    onChange={(scheduleDraft) => changeDraft((value) => reopened(withSchedule(value, scheduleDraft)))}\n'
         '                  />\n'
         '                  {/* HXBot (v1.7.5, RTN-01): the required zone, and the next three runs in it and in UTC. */}\n'
         '                  <HxRoutineZoneField\n'
         '                    value={current().timezone}\n'
         '                    registered={registeredZone()}\n'
         '                    editable={current().id === null || props.port.zoneOnUpdate === true}\n'
         '                    unconfirmedZone={\n'
         '                      current().id !== null && hxZoneUnconfirmed(draftBase) ? draftBase?.timezone : undefined\n'
         '                    }\n'
         '                    showError={showErrors()}\n'
         '                    onChange={(timezone) => changeDraft((value) => ({ ...value, timezone }))}\n'
         '                  />\n'
         '                  <HxRoutineUpcoming\n'
         '                    schedule={current().schedule}\n'
         '                    timezone={current().timezone}\n'
         '                    active={current().active}\n',
        ),
        (
         '\n'
         'function validDraft(draft: RoutineDraft): boolean {\n',
         '\n'
         '/** HXBot (v1.7.5, RTN-01): the zone a new routine starts with. */\n'
         'function newRoutineZone(registered: string | null | undefined): string {\n'
         '  if (registered === null) return "";\n'
         '  return registered ?? hxDeviceZone();\n'
         '}\n'
         '\n'
         'function validDraft(draft: RoutineDraft): boolean {\n',
        ),
        (
         '  if (draft.triggerKind === "webhook") return eventFilterDraftsValid(draft.eventFilters);\n',
         '  if (draft.triggerKind === "webhook") return eventFilterDraftsValid(draft.eventFilters);\n'
         '  // HXBot (v1.7.5, RTN-01): a schedule needs its zone.\n'
         '  if (!draft.timezone) return false;\n',
        ),
        (
         '  return routineDraftProblem(draft.scheduleDraft) === null;\n',
         '  return routineDraftProblem(draft.scheduleDraft) === null;\n'
         '}\n'
         '\n'
         '/** HXBot (v1.7.5, MIG-03): a routine from an earlier version whose zone nobody confirmed. */\n'
         'function hxZoneUnconfirmed(routine: RoutineEditorRecord | null): boolean {\n'
         '  return routine?.hx?.zoneUnconfirmed === true;\n',
        ),
    ]),
    ('src/renderer/src/features/conversation/AgentSettingsPanel.tsx', [
    ], [
        (
         '  const legacyRoutinesPort = createMemo(() =>\n'
         '    agentRoutinesPort(\n',
         '  const legacyRoutinesPort = createMemo(() => {\n'
         '    const port = agentRoutinesPort(\n',
        ),
        (
         '    ),\n'
         '  );\n',
         '    );\n'
         "    // HXBot (v1.7.5, RTN-01): this computer's host tells the editor the registered zone.\n"
         '    const serverId = props.skillsServerId;\n'
         '    return props.localHost === true && serverId\n'
         '      ? {\n'
         '          ...port,\n'
         '          registeredZone: () => window.openbot.hostAdmin.getTimezone(serverId).then((settings) => settings.timezone),\n'
         '          registerZone: (zone: string) => window.openbot.hostAdmin.setTimezone(zone, serverId).then(() => undefined),\n'
         "          // HXBot (v1.7.5, RTN-02, MIG-03): the agent routine's run that waits for the yes.\n"
         '          answerConfirm: (cardId: string, run: boolean) =>\n'
         '            window.openbot.auth.hxAnswerRoutineConfirm({ agentId: props.agent.id, cardId, run }),\n'
         '        }\n'
         '      : port;\n'
         '  });\n',
        ),
    ]),
    ('src/renderer/src/features/conversation/RoutineChatCard.tsx', [
        'import { HxRoutineUpcoming } from "@openbot/ui/features/conversation/HxRoutineUpcoming";',
    ], [
        (
         '      onOpenRoutine={() => props.onOpenRoutine({ routineId: routine().id, name: routine().name })}\n',
         '      onOpenRoutine={() => props.onOpenRoutine({ routineId: routine().id, name: routine().name })}\n'
         '      // HXBot (v1.7.5, RTN-01): a routine made in one sentence shows its next three runs too.\n'
         '      upcoming={\n'
         '        <HxRoutineUpcoming\n'
         '          density="card"\n'
         '          schedule={routine().trigger.schedule}\n'
         '          timezone={knownTimeZone(routine().timezone) ?? ""}\n'
         '          active={routine().active}\n'
         '        />\n'
         '      }\n',
        ),
    ]),
    ('src/renderer/src/features/conversation/routines-port.ts', [
        'import type { HxAnswerRoutineConfirmResult } from "@openbot/contracts/hx-routine-confirm";',
    ], [
        (
         '  trigger?: EventRoutineTriggerInput;\n',
         '  trigger?: EventRoutineTriggerInput;\n'
         '  /**\n'
         '   * HXBot (v1.7.5, RTN-01): the person chose a zone for a saved routine. An adapter whose update\n'
         '   * carries no zone sends it only then.\n'
         '   */\n'
         '  zoneChanged?: boolean;\n',
        ),
        (
         '  runIn: boolean;\n',
         '  runIn: boolean;\n'
         '  /**\n'
         "   * HXBot (v1.7.5, RTN-01): whether the host changes the zone of a saved routine: this computer's\n"
         '   * host, and any host through the event API. The released schedule routes keep it.\n'
         '   */\n'
         '  zoneOnUpdate?: boolean;\n'
         '  /** HXBot (v1.7.5, RTN-01): the registered zone, null when none is registered. Absent when unknown. */\n'
         '  registeredZone?: () => Promise<string | null>;\n'
         '  /** HXBot (v1.7.5, RTN-01): remembers the first zone a person saves, while none is registered. */\n'
         '  registerZone?: (zone: string) => Promise<void>;\n'
         "  /** HXBot (v1.7.5, RTN-02, MIG-03): answers a run that waits for the yes. Only this computer's host. */\n"
         '  answerConfirm?: (cardId: string, run: boolean) => Promise<HxAnswerRoutineConfirmResult>;\n',
        ),
        (
         '    save: ({ routineId, name, instruction, active, timezone, schedule, limitPolicy, missedPolicy, runIn }) => {\n',
         '    zoneOnUpdate: localHost,\n'
         '    save: ({\n'
         '      routineId,\n'
         '      name,\n'
         '      instruction,\n'
         '      active,\n'
         '      timezone,\n'
         '      schedule,\n'
         '      limitPolicy,\n'
         '      missedPolicy,\n'
         '      runIn,\n'
         '      zoneChanged,\n'
         '    }) => {\n',
        ),
        (
         '        ...(runPlace && runIn ? { runIn } : {}),\n',
         '        ...(runPlace && runIn ? { runIn } : {}),\n'
         '        ...(localHost && zoneChanged ? { timezone } : {}),\n',
        ),
        (
         '    "listRuns" | "subscribe" | "runCommand" | "missedPolicy" | "onceSchedule" | "runIn" | "results"\n',
         '    | "listRuns"\n'
         '    | "subscribe"\n'
         '    | "runCommand"\n'
         '    | "missedPolicy"\n'
         '    | "onceSchedule"\n'
         '    | "runIn"\n'
         '    | "results"\n'
         '    | "registeredZone"\n'
         '    | "registerZone"\n'
         '    | "answerConfirm"\n',
        ),
        (
         '    runIn: legacy.runIn,\n',
         '    runIn: legacy.runIn,\n'
         '    zoneOnUpdate: true,\n'
         '    ...(legacy.registeredZone ? { registeredZone: legacy.registeredZone } : {}),\n'
         '    ...(legacy.registerZone ? { registerZone: legacy.registerZone } : {}),\n'
         '    ...(legacy.answerConfirm ? { answerConfirm: legacy.answerConfirm } : {}),\n',
        ),
    ]),
    ('src/backend/database/database-core.ts', [
        'import { hxUpgradeAfterMigrations } from "../hx-routines/upgrade";',
    ], [
        (
         '    migrateOpenBotDatabase(this.connection, { closedCleanly });\n',
         '    migrateOpenBotDatabase(this.connection, { closedCleanly });\n'
         '    // HXBot (v1.7.5, MIG-03): once, the routines from before v1.7.5 get their zone and confirmation marks.\n'
         '    hxUpgradeAfterMigrations(this.connection);\n',
        ),
    ]),
    ('src/main/team-api/route-agent-routines.ts', [
    ], [
        (
         '      const input = parseUpdateRoutine({ ...body, agentId, routineId });\n',
         '      // HXBot (v1.7.5): the released route takes a timezone and has always kept the saved one. It still does:\n'
         "      // only this computer's editor moves a routine to another zone.\n"
         '      const input = parseUpdateRoutine({ ...body, timezone: undefined, agentId, routineId });\n',
        ),
    ]),
    ('packages/contracts/package.json', [
    ], [
        (
         '    "./team-protocol/v8-webrtc-adapter": "./src/team-protocol/v8-webrtc-adapter.ts",\n',
         '    "./team-protocol/v8-webrtc-adapter": "./src/team-protocol/v8-webrtc-adapter.ts",\n'
         '    "./hx-routine-confirm": "./src/hx-routine-confirm.ts",\n'
         '    "./hx-boot": "./src/hx-boot.ts",\n'
         '    "./hx-learned": "./src/hx-learned.ts",\n'
         '    "./hx-team-card": "./src/hx-team-card.ts",\n'
         '    "./hx-workflows": "./src/hx-workflows.ts",\n',
        ),
    ]),
    ('src/backend/agent-service.ts', [
    ], [
        (
         'import { hxAccessHostFor, setHxAccessHost } from "./hx-access/hub";\n',
         'import { hxAccessHostFor, setHxAccessHost } from "./hx-access/hub";\n'
         'import { type HxAgentDeleteHolds, hxAgentDeleteHolds } from "./hx-agent-delete/holds";\n',
        ),
        (
         'import { hxProgressMessage } from "./hx-progress/progress";\n',
         'import { hxProgressMessage } from "./hx-progress/progress";\n'
         'import { hxAttachChannelConfirm } from "./hx-routines/channel";\n'
         'import { hxRoutineConfirm } from "./hx-routines/confirm";\n'
         'import { hxWriteRoutineConfirmCard } from "./hx-routines/confirm-card";\n'
         'import { hxNotify } from "./hx-routines/notify";\n'
         'import { hxRoutineResults } from "./hx-routines/results-service";\n',
        ),
        (
         'import { hxReadSpend } from "./hx-team/spend";\n',
         'import { hxReadSpend } from "./hx-team/spend";\n'
         'import { hxAttachWorkflowSteps } from "./hx-workflows/host";\n'
         'import { hxWriteSaveTurnLine } from "./hx-workflows/save-line";\n',
        ),
        (
         '  readonly #planContinuation = new PlanContinuation({ limit: 8 });\n',
         '  readonly #planContinuation = new PlanContinuation({ limit: 8 });\n'
         '  /**\n'
         '   * HXBot (v1.7.5 fix): a delete that waits for its undo time is kept on disk beside `openbot.db`, and its\n'
         '   * agent is out of every list (this computer, the web client, the phones) until the delete or an undo.\n'
         '   */\n'
         '  readonly #hxDeletes: HxAgentDeleteHolds = hxAgentDeleteHolds(() => this.#store.database.path, {\n'
         '    exists: (agentId) => this.#store.list().some((agent) => agent.id === agentId),\n'
         '    blockDeliveries: (agentId) => this.#mailbox.blockAgentDeliveries(agentId),\n'
         '    resume: (agentId) => {\n'
         '      this.#drain.scheduleDrain(agentId);\n'
         '      this.#routineTimer.arm();\n'
         '    },\n'
         '    emitRoster: () => this.#emit({ type: "agents-changed", agents: this.listAgents() }),\n'
         '    warn: (message, detail) => logger.warn(message, detail),\n'
         '  });\n',
        ),
        (
         '          new Set([...this.#duplication.pendingAgents(), ...this.#removal.deleting(), ...this.#hiddenAgentIds()]),\n',
         '          new Set([\n'
         '            ...this.#duplication.pendingAgents(),\n'
         '            ...this.#removal.deleting(),\n'
         '            ...this.#hiddenAgentIds(),\n'
         '            ...this.#hxDeletes.held(),\n'
         '          ]),\n',
        ),
        (
         '        },\n'
         '      },\n'
         '    });\n'
         '    this.#hostedSites = new HostedSiteCoordinator({\n',
         '        },\n'
         '      },\n'
         '    });\n'
         "    // HXBot (v1.7.5, RTN-02, MIG-03): the questions that wait for the person's yes before a routine runs.\n"
         '    hxRoutineConfirm.attach({\n'
         '      connection: () => store.database.connection,\n'
         '      routine: (agentId, routineId) =>\n'
         '        this.#routines.listFor(agentId).find((routine) => routine.id === routineId) ?? null,\n'
         '      writeCard: (agentId, cardId, card, settled) =>\n'
         '        hxWriteRoutineConfirmCard(this.#conversation, store.database, agentId, cardId, card, settled, (error) =>\n'
         '          this.#emitError("hx_routine_confirm_failed", error, agentId),\n'
         '        ),\n'
         '      startRun: (input) => Effect.runPromise(this.#routines.hxStartConfirmedRun(input)),\n'
         '      recordSkipped: (input) => this.#routines.hxRecordSkipped(input),\n'
         '    });\n'
         '    // HXBot (v1.7.5, RTN-04): the result of each routine run, judged when its turn ends.\n'
         '    hxRoutineResults.attach({\n'
         '      connection: () => store.database.connection,\n'
         '      runForDelivery: (deliveryId) => this.#routines.runForDelivery(deliveryId),\n'
         '      workspaceOf: (agentId) => this.listAgents().find((agent) => agent.id === agentId)?.workspacePath ?? null,\n'
         '      appendLine: (agentId, text) => {\n'
         '        try {\n'
         '          this.#appendSystemMessage(agentId, hxComputerLine(text), "thread.hx-routine-result");\n'
         '        } catch (error) {\n'
         '          this.#emitError("hx_routine_result_failed", error, agentId);\n'
         '        }\n'
         '      },\n'
         '      notify: (_agentId, title, body) => hxNotify(title, body),\n'
         '    });\n'
         '    // HXBot (v1.7.5, RTN-11): the app action, app skill and team steps of workflows (hx-workflows). A turn\n'
         '    // keeps its Computer Use calls and team starts; after it, a chat line offers to save them as a workflow.\n'
         '    hxAttachWorkflowSteps({\n'
         '      connection: () => store.database.connection,\n'
         '      agents: () => this.listAgents(),\n'
         '      writeLine: (agentId, line) =>\n'
         '        hxWriteSaveTurnLine(this.#conversation, store.database, agentId, line, (error) =>\n'
         '          this.#emitError("hx_save_turn_failed", error, agentId),\n'
         '        ),\n'
         '      delivery: (deliveryId) => this.#mailbox.getDelivery(deliveryId)?.delivery ?? null,\n'
         '    });\n'
         '    this.#hostedSites = new HostedSiteCoordinator({\n',
        ),
        (
         '    });\n'
         '    this.routineRecords = new RoutineRecords({\n',
         '    });\n'
         '    // HXBot (v1.7.5, RTN-02, MIG-03): a channel routine that waits for the yes asks in its routine list\n'
         '    // and with a desktop notification, not in the channel.\n'
         '    hxAttachChannelConfirm(this.#channelRoutines, {\n'
         '      connection: () => store.database.connection,\n'
         '      changed: (channelId) => {\n'
         '        this.#emit({ type: "channel-routines-changed", channelId });\n'
         '        this.#routineTimer.arm();\n'
         '      },\n'
         '      notify: (title, body) => hxNotify(title, body),\n'
         '    });\n'
         '    this.routineRecords = new RoutineRecords({\n',
        ),
        (
         '    return this.#duplication.visibleAgents(this.#store.list());\n',
         '    return this.#hxDeletes.visible(this.#duplication.visibleAgents(this.#store.list()));\n',
        ),
        (
         '      Effect.andThen(this.#removal.delete(agentId)),\n',
         '      Effect.andThen(this.#removal.delete(agentId)),\n'
         '      // HXBot (v1.7.5 fix): the waiting delete ends with the delete; a failed one shows the agent again.\n'
         '      Effect.tap(() => Effect.sync(() => this.#hxDeletes.deleted(agentId))),\n'
         '      Effect.tapError(() => Effect.sync(() => this.#hxDeletes.failed(agentId))),\n',
        ),
        (
         '      Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "deleteAgent", cause: failure.cause })),\n'
         '    );\n'
         '  }\n',
         '      Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "deleteAgent", cause: failure.cause })),\n'
         '    );\n'
         '  }\n'
         '\n'
         '  /**\n'
         '   * HXBot (v1.7.5 fix): the person deleted the agent and may still undo it. Fails at once as the delete\n'
         '   * would; otherwise the waiting delete is on disk and the agent is out of every list.\n'
         '   */\n'
         '  holdAgentDelete(agentId: string): Effect.Effect<void, AgentLifecycleFailed> {\n'
         '    return this.ensureAgentDeletable(agentId).pipe(\n'
         '      Effect.andThen(lifecycleStep("hold agent delete", () => this.#hxDeletes.hold(agentId))),\n'
         '      Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "deleteAgent", cause: failure.cause })),\n'
         '    );\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5 fix): Undo. Fails with `error.agent.gone` when the agent was deleted already. */\n'
         '  releaseAgentDelete(agentId: string): Effect.Effect<void, AgentLifecycleFailed> {\n'
         '    return lifecycleStep("release agent delete", () => {\n'
         '      if (this.#removal.deleting().has(agentId)) throw new Error(sourceText("error.agent.deletionBusy"));\n'
         '      this.#hxDeletes.release(agentId);\n'
         '    }).pipe(Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "deleteAgent", cause: failure.cause })));\n'
         '  }\n'
         '\n'
         '  /**\n'
         '   * HXBot (v1.7.5 fix): the delete of a held agent that nobody can undo any more (its window is gone, the\n'
         '   * hold reached its limit, or a start found it). A failure keeps the hold: the person deleted the agent,\n'
         '   * so it stays out of the lists and the delete is tried again; it never comes back on its own.\n'
         '   */\n'
         '  hxDeleteHeld(agentId: string): Effect.Effect<void, AgentLifecycleFailed> {\n'
         '    return Effect.sync(() => this.#planContinuation.cancel(agentId)).pipe(\n'
         '      Effect.andThen(this.#removal.delete(agentId)),\n'
         '      Effect.tap(() => Effect.sync(() => this.#hxDeletes.deleted(agentId))),\n'
         '      Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "deleteAgent", cause: failure.cause })),\n'
         '    );\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5 fix): the waiting deletes, also those of joined servers that the main process sends. */\n'
         '  get hxPendingDeletes() {\n'
         '    return this.#hxDeletes.pending;\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5 fix): the agents of this computer whose delete waits. */\n'
         '  hxHeldDeletes(): ReadonlySet<string> {\n'
         '    return this.#hxDeletes.held();\n'
         '  }\n',
        ),
        (
         '      );\n'
         '    yield* this.#mailbox\n',
         '      );\n'
         '    // HXBot (v1.7.5 fix): the agents of the deletes that waited when HXBot stopped stay out of every list.\n'
         '    yield* lifecycleStep("hold the waiting agent deletes", () => this.#hxDeletes.restore());\n'
         '    yield* this.#mailbox\n',
        ),
    ]),
    ('packages/contracts/src/ipc-endpoints.ts', [
        'import type { HxLearnedView } from "./hx-learned";',
    ], [
        (
         'import type { HxSetTeamPriorityInput, HxSetTeamPriorityResult } from "./hx-progress";\n',
         'import type { HxSetTeamPriorityInput, HxSetTeamPriorityResult } from "./hx-progress";\n'
         'import type { HxAnswerRoutineConfirmInput, HxAnswerRoutineConfirmResult } from "./hx-routine-confirm";\n'
         'import type { HxTeamCardActionInput, HxTeamCardActionResult } from "./hx-team-card";\n'
         'import type { HxSaveTurnInput, HxSaveTurnResult, HxWorkflowLimits, HxWorkflowLimitsInput } from "./hx-workflows";\n',
        ),
        (
         '    logout: request<undefined, CentralAuthState>()("auth:logout"),\n',
         '    logout: request<undefined, CentralAuthState>()("auth:logout"),\n'
         "    // HXBot (v1.7.5, RTN-02): the answer to a routine run that waits for the person's yes (hx-routines).\n"
         '    hxAnswerRoutineConfirm: request<HxAnswerRoutineConfirmInput, HxAnswerRoutineConfirmResult>()(\n'
         '      "auth:hx-answer-routine-confirm",\n'
         '    ),\n'
         "    // HXBot (v1.7.5, RTN-11): saves a chat turn of this computer as a workflow; RTN-07: a workflow's limits.\n"
         '    hxSaveTurnAsWorkflow: request<HxSaveTurnInput, HxSaveTurnResult>()("auth:hx-save-turn-as-workflow"),\n'
         '    hxWorkflowLimits: request<string, HxWorkflowLimits>()("auth:hx-workflow-limits"),\n'
         '    hxSetWorkflowLimits: request<HxWorkflowLimitsInput, HxWorkflowLimits>()("auth:hx-set-workflow-limits"),\n'
         "    // HXBot (v1.7.5, CONC-13): the times learned from the person's choices, and the defaults back.\n"
         '    hxLearnedView: request<undefined, HxLearnedView>()("auth:hx-learned-view"),\n'
         '    hxLearnedReset: request<undefined, HxLearnedView>()("auth:hx-learned-reset"),\n'
         "    // HXBot (v1.7.5, CONC-16): a button on a team's card: the judge's automatic mode, wrap up, stop.\n"
         '    hxTeamCardAction: request<HxTeamCardActionInput, HxTeamCardActionResult>()("auth:hx-team-card-action"),\n',
        ),
        (
         '    deleteAgent: scopedRequest<string, void>()("agent:delete"),\n',
         '    deleteAgent: scopedRequest<string, void>()("agent:delete"),\n'
         '    // HXBot (v1.7.5 fix): a delete that waits for its undo time is held on the host, and Undo releases it.\n'
         '    holdAgentDelete: scopedRequest<string, void>()("agent:hold-delete"),\n'
         '    releaseAgentDelete: scopedRequest<string, void>()("agent:release-delete"),\n',
        ),
    ]),
    ('src/main/ipc/account-handlers.ts', [
        'import { decodeHxAnswerRoutineConfirmInput } from "@openbot/contracts/hx-routine-confirm";',
        'import { decodeHxTeamCardActionInput } from "@openbot/contracts/hx-team-card";',
        'import { decodeHxSaveTurnInput, decodeHxWorkflowLimitsInput } from "@openbot/contracts/hx-workflows";',
        'import { hxLearned } from "../../backend/hx-flow/learned";',
        'import { hxChannelRoutineConfirm, hxRoutineConfirm } from "../../backend/hx-routines/confirm";',
        'import { hxSetWorkflowLimitsFor, hxWorkflowLimitsFor } from "../../backend/hx-workflows/limits";',
        'import { hxTurnTools } from "../../backend/hx-workflows/turn-tools";',
    ], [
        (
         '      logout: handler(() => runCauseEffect(centralAuth.logout())),\n',
         '      logout: handler(() => runCauseEffect(centralAuth.logout())),\n'
         "      // HXBot (v1.7.5, RTN-02): this computer's answer to a routine run that waits for the yes.\n"
         '      hxAnswerRoutineConfirm: payloadHandler(decodeHxAnswerRoutineConfirmInput, (input) =>\n'
         '        input.channelId === undefined\n'
         '          ? hxRoutineConfirm.answer({ ownerId: input.agentId, cardId: input.cardId, run: input.run })\n'
         '          : hxChannelRoutineConfirm.answer({ ownerId: input.channelId, cardId: input.cardId, run: input.run }),\n'
         '      ),\n'
         "      // HXBot (v1.7.5, RTN-11, RTN-07): a chat turn saved as a workflow, and a workflow's limits.\n"
         '      hxSaveTurnAsWorkflow: payloadHandler(decodeHxSaveTurnInput, (input) =>\n'
         '        hxTurnTools.save(input.agentId, input.turnId),\n'
         '      ),\n'
         '      hxWorkflowLimits: payloadHandler(stringPayload("workflowId", INPUT_LIMITS.identifier), (workflowId) =>\n'
         '        hxWorkflowLimitsFor(workflowId),\n'
         '      ),\n'
         '      hxSetWorkflowLimits: payloadHandler(decodeHxWorkflowLimitsInput, (input) =>\n'
         '        hxSetWorkflowLimitsFor(input.workflowId, input.limits),\n'
         '      ),\n'
         '      // HXBot (v1.7.5, CONC-13): the learned reminder and pause times of this computer.\n'
         '      hxLearnedView: handler(() => hxLearned.view()),\n'
         '      hxLearnedReset: handler(() => hxLearned.reset()),\n'
         '      hxTeamCardAction: payloadHandler(decodeHxTeamCardActionInput, (input) => hxTeams.cardAction(input)),\n',
        ),
    ]),
    ('src/preload/index.ts', [
        'import { decodeHxLearnedView } from "@openbot/contracts/hx-learned";',
        'import { decodeHxAnswerRoutineConfirmResult } from "@openbot/contracts/hx-routine-confirm";',
        'import { decodeHxTeamCardActionResult } from "@openbot/contracts/hx-team-card";',
        'import { decodeHxSaveTurnResult, decodeHxWorkflowLimits } from "@openbot/contracts/hx-workflows";',
    ], [
        (
         '  deleteAgent: decodeVoid,\n',
         '  deleteAgent: decodeVoid,\n'
         '  holdAgentDelete: decodeVoid,\n'
         '  releaseAgentDelete: decodeVoid,\n',
        ),
        (
         '    logout: decodeCentralAuthState,\n',
         '    logout: decodeCentralAuthState,\n'
         '    hxAnswerRoutineConfirm: decodeHxAnswerRoutineConfirmResult,\n'
         '    hxSaveTurnAsWorkflow: decodeHxSaveTurnResult,\n'
         '    hxWorkflowLimits: decodeHxWorkflowLimits,\n'
         '    hxSetWorkflowLimits: decodeHxWorkflowLimits,\n'
         '    hxLearnedView: decodeHxLearnedView,\n'
         '    hxLearnedReset: decodeHxLearnedView,\n'
         '    hxTeamCardAction: decodeHxTeamCardActionResult,\n',
        ),
    ]),
    ('src/renderer/src/preview/mock-auth.ts', [
        'import type { HxLearnedView } from "@openbot/contracts/hx-learned";',
        'import { HX_WORKFLOW_DEFAULT_LIMITS } from "@openbot/contracts/hx-workflows";',
    ], [
        (
         'import { clone, type Listener, type MockRuntime } from "./mock-support";\n',
         'import { clone, type Listener, type MockRuntime } from "./mock-support";\n'
         '\n'
         '/** HXBot (v1.7.5, CONC-13): the learned times in the preview: writing reminded after 22 minutes. */\n'
         'const MOCK_LEARNED: HxLearnedView = {\n'
         '  progressDefaultMs: 30 * 60_000,\n'
         '  progressByWork: { writing: 22 * 60_000 },\n'
         '  yieldMs: 7_000,\n'
         '  limits: { progress: [15 * 60_000, 120 * 60_000], yield: [3_000, 15_000] },\n'
         '};\n',
        ),
        (
         '    },\n'
         '    openCompanySignIn: async () => clone(authState),\n',
         '    },\n'
         '    hxAnswerRoutineConfirm: async () => ({ ran: 1, skipped: 0, settled: 0 }),\n'
         '    hxSaveTurnAsWorkflow: async () => ({ workflowId: "preview-workflow", title: "Preview workflow", steps: 2 }),\n'
         '    hxWorkflowLimits: async () => ({ ...HX_WORKFLOW_DEFAULT_LIMITS }),\n'
         '    hxSetWorkflowLimits: async (input) => input.limits ?? { ...HX_WORKFLOW_DEFAULT_LIMITS },\n'
         '    hxLearnedView: async () => ({ ...MOCK_LEARNED }),\n'
         '    hxLearnedReset: async () => ({ ...MOCK_LEARNED, progressByWork: {}, yieldMs: 5_000 }),\n'
         '    hxTeamCardAction: async () => ({ status: "done" }),\n'
         '    openCompanySignIn: async () => clone(authState),\n',
        ),
    ]),
    ('src/renderer/src/features/account/account-port.ts', [
    ], [
        (
         '    | "logout"\n',
         '    | "logout"\n'
         '    | "hxAnswerRoutineConfirm"\n'
         '    | "hxSaveTurnAsWorkflow"\n'
         '    | "hxWorkflowLimits"\n'
         '    | "hxSetWorkflowLimits"\n'
         '    | "hxLearnedView"\n'
         '    | "hxLearnedReset"\n'
         '    | "hxTeamCardAction"\n',
        ),
    ]),
    ('src/renderer/src/features/conversation/ConversationTimeline.tsx', [
    ], [
        (
         'import { HxFileChangeRow, isHxFileChangeRow } from "./HxFileChangeRow";\n',
         'import { HxFileChangeRow, isHxFileChangeRow } from "./HxFileChangeRow";\n'
         'import { HxRoutineConfirmRow, isHxRoutineConfirmRow } from "./HxRoutineConfirmRow";\n'
         'import { HxSaveTurnRow, isHxSaveTurnRow } from "./HxSaveTurnRow";\n'
         'import { HxTeamJudgeRow } from "./HxTeamJudge";\n',
        ),
        (
         '                }\n'
         '                // HXBot (v1.7.4, #54): the card of a file that an app skill changed, with its changes and\n',
         '                }\n'
         "                // HXBot (v1.7.5, RTN-02): the card of a routine run that waits for the person's yes, with\n"
         '                // “运行这一次” and “这次跳过”. Only this computer answers for its own agents.\n'
         '                if (untrack(() => isHxRoutineConfirmRow(initialMessage) || isHxSaveTurnRow(initialMessage))) {\n'
         '                  return (\n'
         '                    <div\n'
         '                      data-index={virtualRow.index}\n'
         '                      ref={messageVirtualizer.measureElement}\n'
         '                      class="virtual-chat-row"\n'
         '                      style={{\n'
         '                        transform: messageVirtualizer.isVirtualized()\n'
         '                          ? `translateY(${virtualRow.start - messageVirtualizer.scrollMargin()}px)`\n'
         '                          : "none",\n'
         '                      }}\n'
         '                    >\n'
         '                      <Show when={message()?.id === compactionBefore()}>\n'
         '                        <CompactionMarker />\n'
         '                      </Show>\n'
         '                      <Show when={dayMarker()}>\n'
         '                        {(label) => (\n'
         '                          <div class="time-marker">\n'
         '                            <span>{label()}</span>\n'
         '                          </div>\n'
         '                        )}\n'
         '                      </Show>\n'
         '                      <Show when={message()?.id === unreadBoundaryMessageId()}>\n'
         '                        <UnreadMessagesDivider\n'
         '                          animateIn={unreadDividerArrives}\n'
         '                          elementRef={(element) => {\n'
         '                            setUnreadMessagesDividerElement(element);\n'
         '                            scheduleUnreadDividerVisibilityUpdate();\n'
         '                          }}\n'
         '                        />\n'
         '                      </Show>\n'
         '                      <ChatRowBoundary>\n'
         '                        <article\n'
         '                          data-chat-search-message={message()?.id}\n'
         '                          class={{ "message-entry-animated": animateEntrance }}\n'
         '                        >\n'
         '                          {/* HXBot (v1.7.5, RTN-11): the line after a turn that can be saved as a workflow. */}\n'
         '                          <Show\n'
         '                            when={isHxSaveTurnRow(initialMessage)}\n'
         '                            fallback={\n'
         '                              <HxRoutineConfirmRow\n'
         '                                message={message() ?? initialMessage}\n'
         '                                agentId={props.agent?.id}\n'
         '                                local={!props.runtime}\n'
         '                              />\n'
         '                            }\n'
         '                          >\n'
         '                            <HxSaveTurnRow\n'
         '                              message={message() ?? initialMessage}\n'
         '                              agentId={props.agent?.id}\n'
         '                              local={!props.runtime}\n'
         '                            />\n'
         '                          </Show>\n'
         '                        </article>\n'
         '                      </ChatRowBoundary>\n'
         '                    </div>\n'
         '                  );\n'
         '                }\n'
         '                // HXBot (v1.7.4, #54): the card of a file that an app skill changed, with its changes and\n',
        ),
        (
         '                          <HxTeamPriorityRow\n',
         '                          <HxTeamPriorityRow\n'
         '                            message={message() ?? initialMessage}\n'
         '                            agentId={props.agent?.id}\n'
         '                            local={!props.runtime}\n'
         '                          />\n'
         "                          {/* HXBot (v1.7.5, CONC-16): the judge's automatic mode, wrap up and stop. */}\n"
         '                          <HxTeamJudgeRow\n',
        ),
    ]),
    ('scripts/routine-due-revalidation-e2e.ts', [
    ], [
        (
         '    skipped ? 0 : 1,\n',
         '    // HXBot (v1.7.5, RTN-03): an occurrence that a spent plan drops leaves one skipped record; it does not run.\n'
         '    mutation === "skip" ? 1 : skipped ? 0 : 1,\n',
        ),
        (
         '  );\n'
         '  if (mutation === "edit") {\n',
         '  );\n'
         '  if (mutation === "skip") {\n'
         '    const [record] = fixture.runs.listRuns(fixture.agentId, saved.changed.id, 50, true);\n'
         '    assert.equal(record?.status, "cancelled", "The dropped occurrence is a skipped record.");\n'
         '    assert.equal(record?.missed?.count, 1, "The skipped record names one occurrence.");\n'
         '    assert.equal(record?.deliveryId ?? null, null, "The skipped record started no work.");\n'
         '  }\n'
         '  if (mutation === "edit") {\n',
        ),
    ]),
    ('src/backend/agent/turn-lifecycle.ts', [
    ], [
        (
         'import { hxProviderGate, hxRetryAfterMs } from "../hx-flow/provider-gate";\n',
         'import { hxProviderGate, hxRetryAfterMs } from "../hx-flow/provider-gate";\n'
         'import { hxRoutineResults } from "../hx-routines/results-service";\n'
         'import { hxTurnTools } from "../hx-workflows/turn-tools";\n',
        ),
        (
         '      if (!continuation) this.#planContinuation.cancel(agentId, laneTaskId);\n',
         '      if (!continuation) this.#planContinuation.cancel(agentId, laneTaskId);\n'
         "      // HXBot (v1.7.5, RTN-04): the end of the turn is not the run's success; HXBot judges each routine run.\n"
         '      if (!continuation) {\n'
         '        hxRoutineResults.judgeTurn({\n'
         '          agentId,\n'
         '          turnId,\n'
         '          outcome,\n'
         '          reportedFailure,\n'
         '          noUpdate: quiet || markerAnswer || noUpdateCalled,\n'
         '          answer: latestAssistant?.text,\n'
         '          messages: snapshot.messages,\n'
         '          deliveries: deliveries.map(({ delivery }) => delivery),\n'
         '        });\n'
         '        // HXBot (v1.7.5, RTN-11): a turn that worked with Computer Use, app skills or a team can be saved.\n'
         '        hxTurnTools.turnEnded(agentId, turnId);\n'
         '      }\n',
        ),
    ]),
    ('packages/ui/src/features/conversation/RoutineRunHistory.tsx', [
    ], [
        (
         'import { type TextValue, useText } from "../../text";\n',
         'import { type TextValue, useText } from "../../text";\n'
         'import { HxRunFilterSelect } from "./HxRunFilterSelect";\n'
         'import { type HxRunFilter, hxRunMatches, hxRunNote, hxSkippedNote } from "./hx-run-notes";\n',
        ),
        (
         '  | { kind: "skipped"; at: string; missed: RoutineMissedRuns }\n',
         '  | { kind: "skipped"; at: string; missed: RoutineMissedRuns; run?: RoutineRunFields }\n',
        ),
        (
         'const VISIBLE_ENTRIES = 10;\n',
         'const VISIBLE_ENTRIES = 10;\n'
         '/** HXBot (v1.7.5): the fields a filter reads of a record that came without its run. */\n'
         'const EMPTY_RECORD: RoutineRunFields = {\n'
         '  id: "",\n'
         '  routineId: "",\n'
         '  triggerId: null,\n'
         '  kind: "scheduled",\n'
         '  scheduledFor: "",\n'
         '  routineName: "",\n'
         '  instruction: "",\n'
         '  status: "cancelled",\n'
         '  error: null,\n'
         '  createdAt: "",\n'
         '  updatedAt: "",\n'
         '};\n',
        ),
        (
         '\n'
         '  const entries = (): HistoryEntry[] =>\n',
         '\n'
         '  // HXBot (v1.7.5, RTN-03, RTN-04): the list shows one kind of result, or all of them.\n'
         '  const [hxFilter, setHxFilter] = createSignal<HxRunFilter>("all");\n'
         '  const entries = (): HistoryEntry[] =>\n',
        ),
        (
         '            ? { kind: "skipped", at: run.scheduledFor, missed: run.missed }\n',
         '            ? { kind: "skipped", at: run.scheduledFor, missed: run.missed, run }\n',
        ),
        (
         '    ]\n',
         '    ]\n'
         '      .filter((entry) =>\n'
         '        entry.kind === "ignored"\n'
         '          ? hxFilter() === "all"\n'
         '          : hxRunMatches(\n'
         '              entry.kind === "run" ? entry.run : (entry.run ?? { ...EMPTY_RECORD, missed: entry.missed }),\n'
         '              hxFilter(),\n'
         '            ),\n'
         '      )\n',
        ),
        (
         '      <h3 id="routine-history-heading">{t("routine.history.title")}</h3>\n',
         '      <h3 id="routine-history-heading">{t("routine.history.title")}</h3>\n'
         '      <Show when={props.runs.length > 0}>\n'
         '        <HxRunFilterSelect value={hxFilter()} onChange={setHxFilter} />\n'
         '      </Show>\n',
        ),
        (
         '                        <span class="agent-routine-run-note">{skippedNote(skipped().missed, text)}</span>\n',
         '                        <span class="agent-routine-run-note">\n'
         '                          {hxSkippedNote(skipped().run, text) ?? skippedNote(skipped().missed, text)}\n'
         '                        </span>\n',
        ),
        (
         '  const failure = () => (props.run.status === "failed" && props.run.error ? text.sourceText(props.run.error) : null);\n',
         '  const failure = () => (props.run.status === "failed" && props.run.error ? text.sourceText(props.run.error) : null);\n'
         '  // HXBot (v1.7.5, RTN-04): a result that is not verified, no update, a catch-up.\n'
         '  const hxNote = () => hxRunNote(props.run, text);\n',
        ),
        (
         '      <Show when={late() || failure()} fallback={<span>{label()}</span>}>\n',
         '      <Show when={late() || failure() || hxNote()} fallback={<span>{label()}</span>}>\n',
        ),
        (
         '                {reason()}\n',
         '                {reason()}\n'
         '              </span>\n'
         '            )}\n'
         '          </Show>\n'
         '          <Show when={hxNote()}>\n'
         '            {(note) => (\n'
         '              <span class="agent-routine-run-note hx-routine-run-note" data-hx-result={props.run.hx?.result}>\n'
         '                {note()}\n',
        ),
    ]),
    ('src/backend/channel-routine-store.ts', [
    ], [
        (
         '} from "@openbot/contracts/ipc";\n',
         '} from "@openbot/contracts/ipc";\n'
         'import type { HxRunDetail } from "./hx-routines/detail";\n',
        ),
        (
         '\n'
         '  receiveWebhook(\n',
         '\n'
         '  /** HXBot (v1.7.5, RTN-02 / RTN-03): a record of occurrences that did not run. */\n'
         '  hxRecordNotRun(\n'
         '    routine: Pick<ChannelRoutine, "id" | "channelId" | "name" | "instruction">,\n'
         '    triggerId: string | null,\n'
         '    record: { scheduledFor: string; until: string | null; count: number },\n'
         '    detail: HxRunDetail,\n'
         '  ): void {\n'
         '    this.hxRecordNotRunRow(runSource(routine), triggerId, record, detail);\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5): what HXBot records about a run. */\n'
         '  hxNoteRun(runId: string, routineId: string, change: (detail: HxRunDetail) => HxRunDetail): void {\n'
         '    this.hxNoteRunRow(runId, routineId, change);\n'
         '  }\n'
         '\n'
         '  receiveWebhook(\n',
        ),
    ]),
    ('src/backend/agent-routine-store.ts', [
    ], [
        (
         '} from "@openbot/contracts/ipc";\n',
         '} from "@openbot/contracts/ipc";\n'
         'import { type HxRunDetail, hxCopyRoutineDetail } from "./hx-routines/detail";\n',
        ),
        (
         '      duplicated.set(\n'
         '        routine.id,\n'
         '        this.create(\n'
         '          {\n'
         '            agentId: targetAgentId,\n'
         '            name: routine.name,\n'
         '            instruction: routine.instruction,\n'
         '            active: routine.active,\n'
         '            timezone: routine.timezone,\n'
         '            schedule: routine.trigger.schedule,\n'
         '            ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),\n'
         '            ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),\n'
         '            ...(routine.runIn ? { runIn: routine.runIn } : {}),\n'
         '          },\n'
         '          now,\n'
         '        ),\n',
         '      const created = this.create(\n'
         '        {\n'
         '          agentId: targetAgentId,\n'
         '          name: routine.name,\n'
         '          instruction: routine.instruction,\n'
         '          active: routine.active,\n'
         '          timezone: routine.timezone,\n'
         '          schedule: routine.trigger.schedule,\n'
         '          ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),\n'
         '          ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),\n'
         '          ...(routine.runIn ? { runIn: routine.runIn } : {}),\n'
         '        },\n'
         '        now,\n',
        ),
        (
         '      );\n',
         '      );\n'
         '      // HXBot (v1.7.5, MIG-03): the copy keeps its zone mark and whether it asks before each run.\n'
         '      hxCopyRoutineDetail(this.database.connection, "agent", routine.id, created.id);\n'
         '      duplicated.set(routine.id, this.list(targetAgentId).find((entry) => entry.id === created.id) ?? created);\n',
        ),
        (
         '\n'
         '  attachDelivery(runId: string, deliveryId: string): RoutineRun {\n',
         '\n'
         '  /** HXBot (v1.7.5, RTN-02 / RTN-03): a record of occurrences that did not run. */\n'
         '  hxRecordNotRun(\n'
         '    routine: Pick<Routine, "id" | "agentId" | "name" | "instruction">,\n'
         '    triggerId: string | null,\n'
         '    record: { scheduledFor: string; until: string | null; count: number },\n'
         '    detail: HxRunDetail,\n'
         '  ): void {\n'
         '    this.hxRecordNotRunRow(runSource(routine), triggerId, record, detail);\n'
         '  }\n'
         '\n'
         '  /** HXBot (v1.7.5): what HXBot records about a run. */\n'
         '  hxNoteRun(runId: string, routineId: string, change: (detail: HxRunDetail) => HxRunDetail): void {\n'
         '    this.hxNoteRunRow(runId, routineId, change);\n'
         '  }\n'
         '\n'
         '  attachDelivery(runId: string, deliveryId: string): RoutineRun {\n',
        ),
    ]),
    ('scripts/routine-pause-resume-e2e.ts', [
    ], [
        (
         'const STEP_DEADLINE_MS = 15_000;\n',
         'const STEP_DEADLINE_MS = 80_000;\n',
        ),
        (
         '        isRunning: () => false,\n',
         '        // HXBot (v1.7.5, CONC-14): a staggered start fires only while the service runs.\n'
         '        isRunning: () => true,\n',
        ),
        (
         '  await runCauseEffect(current().scheduler.processDue(now));\n',
         '  await runCauseEffect(current().scheduler.processDue(now));\n'
         '  // HXBot (v1.7.5, CONC-14): routines due in the same minute start spread over it. Wait for those starts.\n'
         '  const until = performance.now() + 65_000;\n'
         '  while (current().scheduler.hxPendingStarts() > 0 && performance.now() < until) {\n'
         '    await new Promise((resolve) => setTimeout(resolve, 50));\n'
         '  }\n',
        ),
    ]),
    ('src/backend/workflows/workflows.ts', [
    ], [
        (
         'import { isAgentProvider } from "@openbot/contracts/agent-providers";\n',
         'import { isAgentProvider } from "@openbot/contracts/agent-providers";\n'
         'import { HX_WORKFLOW_AUTO_MODEL, hxWorkflowStepOf } from "@openbot/contracts/hx-workflows";\n',
        ),
        (
         'import { coalescedPasses } from "../coalesced-passes";\n',
         'import { coalescedPasses } from "../coalesced-passes";\n'
         'import { hxWorkflowAutoSteps } from "../hx-workflows/auto-model";\n'
         'import { hxGraphProblem, hxLimitText, hxRecheckNode } from "../hx-workflows/checks";\n'
         'import { hxLimitReached, hxWorkflowLimitsOf } from "../hx-workflows/limits";\n'
         'import { hxMarkUnknown, hxPassOf, hxStepScope, hxWorkflowSteps } from "../hx-workflows/steps";\n',
        ),
        (
         '\n'
         '        // --- Steps ---------------------------------------------------------------------------------\n',
         '\n'
         "        // HXBot (v1.7.5, RTN-11): the node of a step, from its run's graph or the workflow's.\n"
         '        const hxNodeOf = (step: StoredWorkflowStep): WorkflowNode | null => {\n'
         '          const run = step.runId ? runs.run(step.runId) : null;\n'
         '          const graph = run?.graph ?? store.detail(step.workflowId)?.graph;\n'
         '          return graph?.nodes.find((candidate) => candidate.id === step.nodeId) ?? null;\n'
         '        };\n'
         '        const hxRunOf = (step: StoredWorkflowStep) => ({\n'
         '          scope: hxStepScope(step),\n'
         '          stepId: step.id,\n'
         '          nodeId: step.nodeId,\n'
         '          attempt: step.attempt,\n'
         '          pass: hxPassOf(runs.hxConnection, step),\n'
         '        });\n'
         '\n'
         '        /** HXBot (v1.7.5, RTN-11): an app action, an app skill or a team, in a fiber of its own. */\n'
         '        const startHxStep = (step: StoredWorkflowStep, node: WorkflowNode): Effect.Effect<void> => {\n'
         '          const stop = new AbortController();\n'
         '          const work = Effect.gen(function* () {\n'
         '            const outcome = yield* Effect.promise(() =>\n'
         '              hxWorkflowSteps.run(node, { ...hxRunOf(step), input: step.input, signal: stop.signal }),\n'
         '            );\n'
         '            // A team works on: a later pass reads its result.\n'
         '            if (outcome.status === "done") settle(step, { status: "done", output: outcome.output });\n'
         '            else if (outcome.status === "failed") settle(step, { status: "failed", error: outcome.error });\n'
         '            yield* requestSweep();\n'
         '          }).pipe(\n'
         '            Effect.onInterrupt(() => Effect.sync(() => stop.abort())),\n'
         '            Effect.ensuring(Effect.sync(() => working.delete(step.id))),\n'
         '          );\n'
         '          return Effect.forkIn(work, scope).pipe(\n'
         '            Effect.tap((fiber) => Effect.sync(() => working.set(step.id, fiber))),\n'
         '            Effect.asVoid,\n'
         '          );\n'
         '        };\n'
         '\n'
         '        // --- Steps ---------------------------------------------------------------------------------\n',
        ),
        (
         '          const run = step.runId ? runs.run(step.runId) : null;\n'
         '          const sent = yield* dependencies\n',
         '          const run = step.runId ? runs.run(step.runId) : null;\n'
         '          // HXBot (v1.7.5, RTN-11): a step whose model is "auto" has its model chosen by its work.\n'
         '          if (hxNodeOf(step)?.fields.model === HX_WORKFLOW_AUTO_MODEL)\n'
         '            hxWorkflowAutoSteps.want({ runId: step.runId ?? step.id, workflowId: step.workflowId, text: step.input });\n'
         '          const sent = yield* dependencies\n',
        ),
        (
         '          }\n'
         '          switch (node.kind) {\n',
         '          }\n'
         '          // HXBot (v1.7.5, RTN-11): an app action, an app skill or a team does not message its agent. A step of\n'
         '          // a later version that this one does not know is refused like any node without a runner.\n'
         '          const hxUnknown = hxRecheckNode(node, null);\n'
         '          if (hxUnknown && !hxWorkflowStepOf(node)) {\n'
         '            settle(step, { status: "failed", error: hxUnknown });\n'
         '            return;\n'
         '          }\n'
         '          if (hxWorkflowStepOf(node)) {\n'
         '            yield* startHxStep(step, node);\n'
         '            return;\n'
         '          }\n'
         '          switch (node.kind) {\n',
        ),
        (
         '          if (fiber) yield* Fiber.interrupt(fiber);\n',
         '          if (fiber) yield* Fiber.interrupt(fiber);\n'
         '          // HXBot (v1.7.5, RTN-11): a team step stops its team.\n'
         '          const hxNode = step.kind === "agent" ? hxNodeOf(step) : null;\n'
         '          if (hxNode && hxWorkflowStepOf(hxNode) === "team")\n'
         '            yield* Effect.promise(() => hxWorkflowSteps.stop(hxNode, hxRunOf(step)));\n',
        ),
        (
         '\n'
         "        /** Starts every node of the run that can start now, then sets the run's status. */\n",
         '\n'
         '        /**\n'
         '         * HXBot (v1.7.5, RTN-07): a run at its limit writes "over the limit", stops its open steps and starts\n'
         '         * no new one. A call outside HXBot that started and has no answer is not known (steps.ts).\n'
         '         */\n'
         '        const hxStopAtLimit = Effect.fn("Workflows.hxStopAtLimit")(function* (run: StoredWorkflowRun, error: string) {\n'
         '          if (!runs.setRunStatus(run.id, "stopping", error, now())) return;\n'
         '          changed(run.workflowId);\n'
         '          for (const step of runs.steps(run.id)) if (isOpenStep(step)) yield* stopNow(step);\n'
         '          hxMarkUnknown(runs.hxConnection, `workflow-run:${run.id}`);\n'
         '          const endedAt = now();\n'
         '          if (!runs.setRunStatus(run.id, "failed", error, endedAt)) return;\n'
         '          changed(run.workflowId);\n'
         '          rearm();\n'
         '          dependencies.runEnded?.({\n'
         '            runId: run.id,\n'
         '            status: "failed",\n'
         '            source: run.source,\n'
         '            startedAt: run.startedAt,\n'
         '            endedAt: endedAt.toISOString(),\n'
         '            stepKinds: [...latestSteps(run.id).values()]\n'
         '              .filter((step) => step.status !== "skipped")\n'
         '              .map((step) => step.kind),\n'
         '          });\n'
         '        });\n'
         '\n'
         "        /** Starts every node of the run that can start now, then sets the run's status. */\n",
        ),
        (
         '              if (actions.length === 0) break;\n',
         '              if (actions.length === 0) break;\n'
         '              // HXBot (v1.7.5, RTN-07): a run stops before the step that would go over its limits.\n'
         '              const hxHit = hxLimitReached(\n'
         '                runs.hxConnection,\n'
         '                run,\n'
         '                hxWorkflowLimitsOf(runs.hxConnection, run.workflowId),\n'
         '                now().getTime(),\n'
         '                actions.map((action) => ({\n'
         '                  nodeId: action.nodeId,\n'
         '                  attempt: (latest.get(action.nodeId)?.attempt ?? 0) + 1,\n'
         '                  skip: action.action === "skip",\n'
         '                })),\n'
         '              );\n'
         '              if (hxHit) {\n'
         '                yield* hxStopAtLimit(run, hxLimitText(hxHit));\n'
         '                return;\n'
         '              }\n',
        ),
        (
         '            if (step.kind === "agent") {\n',
         '            const hxNode = step.kind === "agent" ? hxNodeOf(step) : null;\n'
         '            if (hxNode && hxWorkflowStepOf(hxNode)) {\n'
         '              // HXBot (v1.7.5, RTN-11): a team step reads its team; an app step without its fiber lost it.\n'
         '              if (working.has(step.id)) continue;\n'
         '              const outcome = hxWorkflowSteps.resume(hxNode, hxRunOf(step));\n'
         '              if (outcome.status === "done") ended = settle(step, { status: "done", output: outcome.output });\n'
         '              else if (outcome.status === "failed") ended = settle(step, { status: "failed", error: outcome.error });\n'
         '            } else if (step.kind === "agent") {\n',
        ),
        (
         '        const create = Effect.fn("Workflows.create")(function* (input: CreateWorkflowInput, agentId?: string) {\n',
         '        const create = Effect.fn("Workflows.create")(function* (input: CreateWorkflowInput, agentId?: string) {\n'
         '          // HXBot (v1.7.5, RTN-08): a node with no runner is refused when it is saved, not only when it runs.\n'
         '          const hxProblem = input.graph ? hxGraphProblem(input.graph) : null;\n'
         '          if (hxProblem) return yield* refuse("refused", hxProblem);\n',
        ),
        (
         '        const saveGraph = Effect.fn("Workflows.saveGraph")(function* (input: SaveWorkflowGraphInput, agentId?: string) {\n',
         '        const saveGraph = Effect.fn("Workflows.saveGraph")(function* (input: SaveWorkflowGraphInput, agentId?: string) {\n'
         '          // HXBot (v1.7.5, RTN-08): see `create`.\n'
         '          const hxProblem = hxGraphProblem(input.graph);\n'
         '          if (hxProblem) return yield* refuse("refused", hxProblem);\n',
        ),
        (
         '            return yield* refuse("refused", sourceText("error.workflow.nodeUnsupported"));\n',
         '            return yield* refuse("refused", sourceText("error.workflow.nodeUnsupported"));\n'
         '          // HXBot (v1.7.5, RTN-11): a step whose agent, Computer Use or settings do not fit now is refused first.\n'
         '          const hxBlocked = detail.graph.nodes\n'
         '            .filter((node) => scope.nodes.has(node.id) && !scope.reused.has(node.id))\n'
         '            .map((node) => hxRecheckNode(node, null))\n'
         '            .find((reason) => reason !== null);\n'
         '          if (hxBlocked) return yield* refuse("refused", hxBlocked);\n',
        ),
        (
         '              if (unsupportedNode(node)) return yield* refuse("refused", sourceText("error.workflow.nodeUnsupported"));\n',
         '              if (unsupportedNode(node)) return yield* refuse("refused", sourceText("error.workflow.nodeUnsupported"));\n'
         '              // HXBot (v1.7.5, RTN-11): see `begin`.\n'
         '              const hxBlocked = hxRecheckNode(node, null);\n'
         '              if (hxBlocked) return yield* refuse("refused", hxBlocked);\n',
        ),
        (
         '              if (!node) return yield* refuse("missing", sourceText("error.workflow.nodeMissing"));\n'
         '              if (run && runs.reopenRun(run.id, now())) changed(run.workflowId);\n',
         '              if (!node) return yield* refuse("missing", sourceText("error.workflow.nodeMissing"));\n'
         '              // HXBot (v1.7.5, RTN-11): continuing reads the permissions and settings of now; RTN-07: and the\n'
         "              // run's limits, so a continue does not go past them.\n"
         '              if (unsupportedNode(node)) return yield* refuse("refused", sourceText("error.workflow.nodeUnsupported"));\n'
         '              const hxBlocked = hxRecheckNode(node, dependencies.connectionOn);\n'
         '              if (hxBlocked) return yield* refuse("refused", hxBlocked);\n'
         '              const hxHit = run\n'
         '                ? hxLimitReached(\n'
         '                    runs.hxConnection,\n'
         '                    run,\n'
         '                    hxWorkflowLimitsOf(runs.hxConnection, run.workflowId),\n'
         '                    now().getTime(),\n'
         '                    [{ nodeId: node.id, attempt: failed.attempt + 1, skip: false }],\n'
         '                  )\n'
         '                : null;\n'
         '              if (hxHit) return yield* refuse("refused", hxLimitText(hxHit));\n'
         '              if (run && runs.reopenRun(run.id, now())) changed(run.workflowId);\n',
        ),
    ]),
    ('src/backend/workflows/workflow-run-store.ts', [
    ], [
        (
         ' */\n'
         '\n'
         'import {\n',
         ' */\n'
         '\n'
         'import type { DatabaseSync } from "node:sqlite";\n'
         'import {\n',
        ),
        (
         "  /** Changes an open run's status. Answers whether it changed. */\n",
         "  /** Changes an open run's status. Answers whether it changed. */\n"
         '  /** HXBot (v1.7.5, RTN-07, RTN-11): the connection, for the run limits and the record of external actions. */\n'
         '  get hxConnection(): DatabaseSync {\n'
         '    return this.#database.connection;\n'
         '  }\n'
         '\n',
        ),
    ]),
    ('scripts/workflow-webhook-e2e.ts', [
    ], [
        (
         'import { Effect } from "effect";\n',
         'import { Effect, Result } from "effect";\n',
        ),
        (
         '  const filedSaved = await runCauseEffect(\n'
         '    workflows.saveGraph({\n'
         '      workflowId: filed.summary.id,\n'
         '      baseRevision: filed.revision,\n'
         '      graph: {\n'
         '        nodes: [trigger("webhook"), { id: "step", kind: "output", at: { x: 300, y: 0 }, fields: { target: "file" } }],\n'
         '        edges: [{ id: "edge", from: "trigger", to: "step", type: "text" }],\n'
         '        strokes: [],\n'
         '      },\n'
         '    }),\n',
         '  const filedGraph = {\n'
         '    nodes: [\n'
         '      trigger("webhook"),\n'
         '      { id: "step", kind: "output" as const, at: { x: 300, y: 0 }, fields: { target: "file" } },\n'
         '    ],\n'
         '    edges: [{ id: "edge", from: "trigger", to: "step", type: "text" as const }],\n'
         '    strokes: [],\n'
         '  };\n'
         '  // HXBot (v1.7.5, RTN-08): a save refuses a node without a runner. Such a graph is one an earlier\n'
         '  // version saved, so the store writes it here as that version did.\n'
         '  const refusedSave = await Effect.runPromise(\n'
         '    workflows\n'
         '      .saveGraph({ workflowId: filed.summary.id, baseRevision: filed.revision, graph: filedGraph })\n'
         '      .pipe(Effect.result),\n',
        ),
        (
         '  );\n'
         '  assert.ok(filedSaved.ok);\n',
         '  );\n'
         '  assert.ok(Result.isFailure(refusedSave), "A save of a graph that cannot run is refused.");\n'
         '  const filedSaved = workflowStore.saveGraph(filed.summary.id, filed.revision, filedGraph);\n'
         '  assert.ok(filedSaved.ok);\n',
        ),
    ]),
    ('src/backend/agent/hxbot-tool-router.ts', [
    ], [
        (
         'import { HX_TEAM_TOOL_NAMES } from "../hx-team/tools";\n',
         'import { HX_TEAM_TOOL_NAMES } from "../hx-team/tools";\n'
         'import { hxTurnTools } from "../hx-workflows/turn-tools";\n',
        ),
        (
         '          const toolRequest = { ...request, params };\n',
         '          const toolRequest = { ...request, params };\n'
         '          // HXBot (v1.7.5, RTN-11): a turn keeps its Computer Use calls, for "save as a workflow".\n'
         '          if (HX_COMPUTER_TOOL_NAMES.has(toolRequest.params.tool)) {\n'
         '            const hxOwner = this.#conversation.agentForThread(toolRequest.params.threadId);\n'
         '            if (hxOwner) hxTurnTools.expect(toolRequest.params, hxOwner, toolRequest.params.turnId);\n'
         '          }\n',
        ),
    ]),
    ('packages/ui/src/features/workflows/WorkflowAgentNode.tsx', [
    ], [
        (
         'import { ProviderLogo } from "@openbot/brand";\n',
         'import { ProviderLogo } from "@openbot/brand";\n'
         'import { HX_WORKFLOW_AUTO_MODEL } from "@openbot/contracts/hx-workflows";\n',
        ),
        (
         'import { useBoard } from "./workflow-board";\n',
         'import { useBoard } from "./workflow-board";\n'
         'import { HxAutoModelPill, HxStepKindPill } from "./workflow-hx-pills";\n',
        ),
        (
         'function AgentPill(props: {\n',
         'export function AgentPill(props: {\n',
        ),
        (
         '          <Show when={agent()}>\n',
         '          <Show when={agent() && model() !== HX_WORKFLOW_AUTO_MODEL}>\n',
        ),
        (
         '          </Show>\n'
         '        </div>\n',
         '          </Show>\n'
         '          {/* HXBot (v1.7.5, RTN-11): the model "auto", and the step type (an app action, an app skill or a team). */}\n'
         '          <Show when={agent()}>\n'
         '            <HxAutoModelPill id={props.id} disabled={locked()} />\n'
         '          </Show>\n'
         '          <HxStepKindPill id={props.id} disabled={locked()} />\n'
         '        </div>\n',
        ),
    ]),
    ('packages/ui/src/features/workflows/WorkflowCanvas.tsx', [
    ], [
        (
         'import { AgentNode } from "./WorkflowAgentNode";\n',
         "",
        ),
        (
         'import { showWorkflowDeleteToast } from "./WorkflowDeleteUndoToast";\n',
         'import { showWorkflowDeleteToast } from "./WorkflowDeleteUndoToast";\n'
         'import { type HxWorkflowLimitsPort, WorkflowHxLimitsDialog } from "./WorkflowHxLimits";\n'
         'import { HxAgentOrStepNode } from "./WorkflowHxNodes";\n',
        ),
        (
         '  onDelete: (workflowId: string) => Promise<unknown>;\n',
         '  onDelete: (workflowId: string) => Promise<unknown>;\n'
         '  /** HXBot (v1.7.5, RTN-07): the run limits of a workflow, on the host. Without it, the menu has no limits. */\n'
         '  hxLimits?: HxWorkflowLimitsPort | undefined;\n',
        ),
        (
         '      return <AgentNode id={node.id} />;\n',
         "      // HXBot (v1.7.5, RTN-11): an agent node is an agent's task or one of HXBot's three steps.\n"
         '      return <HxAgentOrStepNode id={node.id} />;\n',
        ),
        (
         '  };\n'
         '  const onSwitcher = (action: SwitcherAction) => {\n',
         '  };\n'
         '  // HXBot (v1.7.5, RTN-07): the dialog of the run limits.\n'
         '  const [hxLimitsOpen, setHxLimitsOpen] = createSignal(false);\n'
         '  const onSwitcher = (action: SwitcherAction) => {\n'
         '    if (action === "hx-limits") return setHxLimitsOpen(true);\n',
        ),
        (
         '              readOnly={props.readOnly === true}\n',
         '              readOnly={props.readOnly === true}\n'
         '              hxLimits={props.hxLimits !== undefined}\n',
        ),
        (
         '        </Show>\n'
         '      </main>\n',
         '        </Show>\n'
         '        <Show when={props.hxLimits}>\n'
         '          {(port) => (\n'
         '            <WorkflowHxLimitsDialog\n'
         '              open={hxLimitsOpen()}\n'
         '              workflowId={openId()}\n'
         '              port={port()}\n'
         '              onClose={() => setHxLimitsOpen(false)}\n'
         '            />\n'
         '          )}\n'
         '        </Show>\n'
         '      </main>\n',
        ),
    ]),
    ('packages/ui/src/features/workflows/workflow-node-parts.tsx', [
    ], [
        (
         '} from "./workflow-board";\n',
         '} from "./workflow-board";\n'
         'import { HxUnsupportedBadge } from "./workflow-hx-badge";\n',
        ),
        (
         '          </Show>\n'
         '          <RunTime id={props.id} />\n',
         '          </Show>\n'
         '          {/* HXBot (v1.7.5, RTN-08): a node that this version cannot run says so. */}\n'
         '          <HxUnsupportedBadge id={props.id} kind={props.kind} />\n'
         '          <RunTime id={props.id} />\n',
        ),
    ]),
    ('packages/ui/src/features/workflows/workflow-nodes.css', [
    ], [
        (
         '  .wfn-edge-label[data-build] {\n'
         '    animation: none;\n'
         '  }\n'
         '}\n',
         '  .wfn-edge-label[data-build] {\n'
         '    animation: none;\n'
         '  }\n'
         '}\n'
         '\n'
         '/* HXBot v1.7.5 (RTN-11, RTN-08): HXBot\'s steps, the "Not supported yet" badge and what a node declares. */\n'
         '.wfn-hx-unsupported {\n'
         '  margin-inline-start: var(--openbot-space-1);\n'
         '  border: 1px solid var(--openbot-warning);\n'
         '  border-radius: var(--openbot-radius-pill);\n'
         '  background: var(--openbot-warning-soft);\n'
         '  padding: 0 var(--openbot-space-2);\n'
         '  font-size: var(--openbot-text-xs);\n'
         '}\n'
         '\n'
         '.wfn-hx-step {\n'
         '  display: flex;\n'
         '  flex-direction: column;\n'
         '  gap: var(--openbot-space-2);\n'
         '}\n'
         '\n'
         '.wfn-hx-hint,\n'
         '.wfn-hx-declares {\n'
         '  margin: 0;\n'
         '  color: var(--openbot-text-muted);\n'
         '  font-size: var(--openbot-text-xs);\n'
         '}\n'
         '\n'
         '.wfn-hx-json {\n'
         '  min-height: 6rem;\n'
         '  font-family: var(--openbot-font-mono);\n'
         '  font-size: var(--openbot-text-xs);\n'
         '}\n'
         '\n'
         '.wfn-hx-row {\n'
         '  display: flex;\n'
         '  gap: var(--openbot-space-2);\n'
         '}\n'
         '\n'
         '.wfn-hx-label {\n'
         '  display: flex;\n'
         '  flex: 1;\n'
         '  flex-direction: column;\n'
         '  gap: var(--openbot-space-1);\n'
         '  font-size: var(--openbot-text-xs);\n'
         '}\n'
         '\n'
         '.wfn-hx-select {\n'
         '  border: 1px solid var(--openbot-border);\n'
         '  border-radius: var(--openbot-radius-md);\n'
         '  background: var(--openbot-surface);\n'
         '  padding: var(--openbot-space-1) var(--openbot-space-2);\n'
         '  color: inherit;\n'
         '  font: inherit;\n'
         '}\n'
         '\n'
         '/* HXBot (v1.7.5, RTN-07): the run limits of a workflow, in its dialog. */\n'
         '.wfn-hx-limits {\n'
         '  display: grid;\n'
         '  gap: var(--openbot-space-3);\n'
         '}\n'
         '\n'
         '.wfn-hx-limits-reset {\n'
         '  justify-self: start;\n'
         '}\n',
        ),
    ]),
    ('packages/ui/src/features/workflows/WorkflowSwitcher.tsx', [
    ], [
        (
         'import { Check, ChevronRight, CopyPlus, DropdownMenu, History, Pencil, Plus, Trash2 } from "@openbot/ui";\n',
         'import { Check, ChevronRight, CopyPlus, DropdownMenu, Gauge, History, Pencil, Plus, Trash2 } from "@openbot/ui";\n',
        ),
        (
         '  | "live"\n',
         '  | "live"\n'
         '  | "hx-limits"\n',
        ),
        (
         '  readOnly: boolean;\n',
         '  readOnly: boolean;\n'
         '  /** HXBot (v1.7.5, RTN-07): the host keeps run limits: the menu offers them. */\n'
         '  hxLimits?: boolean;\n',
        ),
        (
         '        </Show>\n'
         '        {/* Rename moves the focus to the name field, so it runs after the menu closes. */}\n',
         '        </Show>\n'
         '        {/* HXBot (v1.7.5, RTN-07): the run limits open a dialog, so they open after the menu closes. */}\n'
         '        <Show when={props.hxLimits}>\n'
         '          <DropdownMenu.Item onSelectAfterClose={() => props.onAction("hx-limits")}>\n'
         '            <Gauge class="agent-context-icon" aria-hidden="true" />\n'
         '            <span>{t("workflow.hx.limits.menu")}</span>\n'
         '          </DropdownMenu.Item>\n'
         '        </Show>\n'
         '        {/* Rename moves the focus to the name field, so it runs after the menu closes. */}\n',
        ),
    ]),
    ('src/renderer/src/features/workflows/WorkflowsPage.tsx', [
        'import type { HxWorkflowLimitsPort } from "@openbot/ui/features/workflows/WorkflowHxLimits";',
    ], [
        (
         '        <WorkflowsCanvas host={desktopWorkflowHost(serverId, server)} admin={serverRoleCanAdminister(server())} />\n',
         '        <WorkflowsCanvas\n'
         '          host={desktopWorkflowHost(serverId, server)}\n'
         '          admin={serverRoleCanAdminister(server())}\n'
         '          local={server()?.kind !== "remote"}\n'
         '        />\n',
        ),
        (
         'function WorkflowsCanvas(props: { host: WorkflowHost; admin: boolean }) {\n',
         '/** HXBot (v1.7.5, RTN-07): the run limits that this computer keeps for its own workflows. */\n'
         'const HX_LOCAL_LIMITS: HxWorkflowLimitsPort = {\n'
         '  load: (workflowId) => window.openbot.auth.hxWorkflowLimits(workflowId),\n'
         '  save: (workflowId, limits) => window.openbot.auth.hxSetWorkflowLimits({ workflowId, limits }),\n'
         '};\n'
         '\n'
         'function WorkflowsCanvas(props: { host: WorkflowHost; admin: boolean; local: boolean }) {\n',
        ),
        (
         '          onRotateWebhookSecret={props.admin ? workflows.props.onRotateWebhookSecret : undefined}\n',
         '          onRotateWebhookSecret={props.admin ? workflows.props.onRotateWebhookSecret : undefined}\n'
         '          hxLimits={props.local && !workflows.readOnly() ? HX_LOCAL_LIMITS : undefined}\n',
        ),
    ]),
    ('src/renderer/src/AppView.tsx', [
        'import { HX_BOOT_SOURCES, hxBootFull, hxBootPlayed, hxBootSound } from "./hx-boot";',
    ], [
        (
         'import { AppLoadingScreen } from "@openbot/ui/features/account/AppLoadingScreen";\n',
         'import { HxBootScreen } from "@openbot/ui/features/account/HxBootScreen";\n',
        ),
        (
         '  const splashPlaysThrough = !startupSplashPlayed && platform.chatWindow === null;\n',
         '  const splashPlaysThrough = !startupSplashPlayed && platform.chatWindow === null;\n'
         '  // HXBot (v1.7.5, UI-27): the film plays only in the main window, on a real start, once per version.\n'
         '  const hxBootDecision = createMemo(() => {\n'
         '    const info = platform.appInfo();\n'
         '    if (!info) return null;\n'
         '    return {\n'
         '      version: info.version,\n'
         '      full: splashPlaysThrough && hxBootFull(info.version),\n'
         '    };\n'
         '  });\n',
        ),
        (
         '          The same pile as the loading screen of a server, so a server that is still loading continues it.\n'
         '          A start or a reload always shows the crew, also when the app is ready at once.\n',
         '          HXBot (v1.7.5, UI-27): the start screen is the film "长颈鹿与气球" on the first start and the first\n'
         '          after each upgrade, and the logo for 0.6 s on the other starts (hx-boot.ts). It waits, white, for\n'
         '          the version of the app; the views mount behind it at once.\n',
        ),
        (
         '        <AppLoadingScreen\n'
         '          label={t("app.loading")}\n'
         '          ready={splashReady()}\n'
         '          quickExit={!splashPlaysThrough}\n'
         '          onMountViews={() => setSplashOpen(true)}\n'
         '          onExited={() => {\n'
         '            startupSplashPlayed = true;\n'
         '            setSplashShown(false);\n'
         '          }}\n'
         '        />\n',
         '        <Show when={hxBootDecision()} fallback={<div class="hx-boot" aria-hidden="true" />}>\n'
         '          {(decision) => (\n'
         '            <HxBootScreen\n'
         '              label={t("app.loading")}\n'
         '              sources={HX_BOOT_SOURCES}\n'
         '              full={decision().full}\n'
         '              sound={hxBootSound()}\n'
         '              ready={splashReady()}\n'
         '              onPlayed={() => hxBootPlayed(decision().version)}\n'
         '              onMountViews={() => setSplashOpen(true)}\n'
         '              onExited={() => {\n'
         '                startupSplashPlayed = true;\n'
         '                setSplashShown(false);\n'
         '              }}\n'
         '            />\n'
         '          )}\n'
         '        </Show>\n',
        ),
    ]),
    ('src/renderer/src/styles.css', [
    ], [
        (
         '@import "@openbot/ui/features/account/app-loading-screen.css";\n',
         '@import "@openbot/ui/features/account/app-loading-screen.css";\n'
         '@import "@openbot/ui/features/account/hx-boot-screen.css";\n',
        ),
    ]),
    ('src/renderer/src/features/settings/SettingsGeneralTab.tsx', [
    ], [
        (
         'import { ExternalLinkSelect } from "./ExternalLinkSelect";\n',
         'import { ExternalLinkSelect } from "./ExternalLinkSelect";\n'
         'import { HxBootSoundSwitch } from "./HxBootSoundSwitch";\n',
        ),
        (
         '                }\n'
         '              />\n'
         '            </ItemActions>\n'
         '          </Item>\n'
         '        </ItemGroup>\n'
         '      </SettingsSection>\n'
         '\n',
         '                }\n'
         '              />\n'
         '            </ItemActions>\n'
         '          </Item>\n'
         '          {/* HXBot (v1.7.5, UI-27): the sound of the start film, off by default. */}\n'
         '          <HxBootSoundSwitch />\n'
         '        </ItemGroup>\n'
         '      </SettingsSection>\n'
         '\n',
        ),
    ]),
    ('apps/mobile/src/app/_layout.tsx', [
        'import { HxBootFilm } from "@/features/boot/components/hx-boot-film";',
        'import { loadHxBoot } from "@/features/boot/model/hx-boot";',
    ], [
        (
         '        <BloubStage nativeSplashHidden={nativeHidden} onLayout={() => reportArtwork("stage")} />\n',
         '        <BloubStage nativeSplashHidden={nativeHidden} onLayout={() => reportArtwork("stage")} />\n'
         '        {/* HXBot (v1.7.5, UI-27): the start film, on the first start and the first after each update. */}\n'
         '        <HxBootFilm />\n',
        ),
        (
         '      void loadOnboardingProgress().catch(() => undefined);\n',
         '      void loadOnboardingProgress().catch(() => undefined);\n'
         '      void loadHxBoot().catch(() => undefined);\n',
        ),
    ]),
    ('apps/mobile/src/features/settings/screens/appearance-settings-screen.tsx', [
        'import { saveHxBootSound, useHxBoot } from "@/features/boot/model/hx-boot";',
    ], [
        (
         '  const [agentColorError, setAgentColorError] = useState<string | null>(null);\n',
         '  const [agentColorError, setAgentColorError] = useState<string | null>(null);\n'
         '  const boot = useHxBoot();\n'
         '  const [bootError, setBootError] = useState<string | null>(null);\n',
        ),
        (
         '      </SettingsSection>\n'
         '    </SettingsContent>\n',
         '      </SettingsSection>\n'
         '      {/* HXBot (v1.7.5, UI-27): the sound of the start film, off by default. */}\n'
         '      <SettingsSection footer={bootError ?? t("mobile.settings.appearance.hxBootSoundFooter")}>\n'
         '        <SettingsRow>\n'
         '          <SettingsSwitch\n'
         '            value={boot.sound}\n'
         '            disabled={!boot.ready || boot.saving}\n'
         '            label={t("mobile.settings.appearance.hxBootSound")}\n'
         '            dark={theme === "dark"}\n'
         '            onValueChange={(on) => {\n'
         '              setBootError(null);\n'
         '              void saveHxBootSound(on).catch(() => {\n'
         '                setBootError(t("mobile.settings.saveFailed"));\n'
         '                void haptics.notification("error");\n'
         '              });\n'
         '            }}\n'
         '          />\n'
         '        </SettingsRow>\n'
         '      </SettingsSection>\n'
         '    </SettingsContent>\n',
        ),
    ]),
    ('src/main/ipc/agent-handlers.ts', [
    ], [
        (
         'import type { HostService } from "../host-service";\n',
         'import type { HostService } from "../host-service";\n'
         'import { hxAgentDeletes } from "../hx-agent-deletes";\n',
        ),
        (
         'import {\n'
         '  parseAcknowledgeFailedTurn,\n',
         'import {\n'
         '  agentRequest,\n'
         '  parseAcknowledgeFailedTurn,\n',
        ),
        (
         'import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";\n',
         'import { eventPayloadHandler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";\n',
        ),
        (
         '}: AgentIpcDependencies): Pick<IpcGroupHandlers, "agent"> {\n',
         '}: AgentIpcDependencies): Pick<IpcGroupHandlers, "agent"> {\n'
         '  hxAgentDeletes.attach({\n'
         '    service,\n'
         '    sidebarLayout,\n'
         '    remote: {\n'
         '      list: () => remoteServers.list(),\n'
         '      deleteAgent: (serverId, agentId) =>\n'
         '        remoteServers.request(serverId, TEAM_API_ROUTES.agent.one(agentId), decodeVoid, { method: "DELETE" }),\n'
         '      agentIds: (serverId) =>\n'
         '        remoteServers\n'
         '          .request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries)\n'
         '          .pipe(Effect.map((agents) => agents.map((agent) => agent.id))),\n'
         '    },\n'
         '  });\n',
        ),
        (
         '      deleteAgent: scopedHandler(parseAgentId, {\n'
         '        local: async (agentId) => {\n'
         '          await runCauseEffect(service.deleteAgent(agentId));\n'
         '          await runCauseEffect(sidebarLayout.removeAgent(agentId));\n'
         '        },\n'
         '        remote: async (agentId, serverId) => {\n'
         '          await runCauseEffect(\n'
         '            remoteServers.request(serverId, TEAM_API_ROUTES.agent.one(agentId), decodeVoid, { method: "DELETE" }),\n'
         '          );\n'
         '        },\n'
         '      }),\n',
         '      // HXBot (v1.7.5 fix): the delete, its hold while the undo time runs, and Undo (hx-agent-deletes.ts).\n'
         '      deleteAgent: payloadHandler(agentRequest(parseAgentId), ({ serverId, payload }) =>\n'
         '        hxAgentDeletes.commit(serverId, payload),\n'
         '      ),\n'
         '      holdAgentDelete: eventPayloadHandler(agentRequest(parseAgentId), (event, { serverId, payload }) =>\n'
         '        hxAgentDeletes.hold(serverId, payload, event.sender),\n'
         '      ),\n'
         '      releaseAgentDelete: payloadHandler(agentRequest(parseAgentId), ({ serverId, payload }) =>\n'
         '        hxAgentDeletes.release(serverId, payload),\n'
         '      ),\n',
        ),
    ]),
    ('src/renderer/src/preview/mock-hxbot.ts', [
    ], [
        (
         '      },\n'
         '      deleteAgent: async (agentId) => {\n',
         '      },\n'
         '      // HXBot (v1.7.5 fix): the preview has one window and no other device, so a held delete changes nothing here.\n'
         '      holdAgentDelete: async () => undefined,\n'
         '      releaseAgentDelete: async () => undefined,\n'
         '      deleteAgent: async (agentId) => {\n',
        ),
    ]),
    ('src/renderer/src/features/agents/agents-port.ts', [
    ], [
        (
         '    | "deleteAgent"\n',
         '    | "deleteAgent"\n'
         '    | "holdAgentDelete"\n'
         '    | "releaseAgentDelete"\n',
        ),
    ]),
    ('src/renderer/src/features/agents/agent-actions.tsx', [
    ], [
        (
         '     * time is over, so an undo has nothing to restore. If the app quits before then, the agent stays.\n',
         '     * time is over, so an undo has nothing to restore.\n'
         '     * HXBot (v1.7.5 fix): the host holds the delete at once (on disk, and the agent leaves the lists of\n'
         '     * every device), so a quit, a closed window or a hidden one no longer brings the agent back.\n',
        ),
        (
         '      let settled = false;\n',
         '      let settled = false;\n'
         '      // HXBot (v1.7.5 fix): the host holds the delete; undo and the delete wait for the hold first.\n'
         '      const held = agentsPort()\n'
         '        .agent.holdAgentDelete(agentId, serverId)\n'
         '        .then(\n'
         '          () => true,\n'
         '          (error) => {\n'
         '            if (!settle()) return false;\n'
         '            if (scopeIsCurrent()) {\n'
         '              showAgent();\n'
         '              if (wasActive) setActiveAgentId(agentId);\n'
         '            }\n'
         '            const { t, errorMessage } = currentText();\n'
         '            actionToast.error(t("agent.error.deleteFailed"), {\n'
         '              description: errorMessage(error, t("sidebar.delete.failed")),\n'
         '              report: { operation: "agent", source: "action", cause_code: classifyFailure(error) },\n'
         '            });\n'
         '            return false;\n'
         '          },\n'
         '        );\n',
        ),
        (
         '        if (!settle() || !scopeIsCurrent()) return;\n'
         '        showAgent();\n'
         '        if (wasActive) setActiveAgentId(agentId);\n',
         '        if (!settle()) return;\n'
         '        if (scopeIsCurrent()) {\n'
         '          showAgent();\n'
         '          if (wasActive) setActiveAgentId(agentId);\n'
         '        }\n'
         '        // HXBot (v1.7.5 fix): the host lets the agent go back to every device.\n'
         '        void held.then(async (holds) => {\n'
         '          if (!holds) return;\n'
         '          try {\n'
         '            await agentsPort().agent.releaseAgentDelete(agentId, serverId);\n'
         '          } catch (error) {\n'
         '            // The delete ended already (the window was gone, or the hold reached its limit).\n'
         '            forgetDeletedAgent();\n'
         '            const { t, errorMessage } = currentText();\n'
         '            actionToast.error(t("agent.error.deleteFailed"), {\n'
         '              description: errorMessage(error, t("sidebar.delete.failed")),\n'
         '              report: { operation: "agent", source: "action", cause_code: classifyFailure(error) },\n'
         '            });\n'
         '          }\n'
         '        });\n',
        ),
        (
         '        try {\n'
         '          await agentsPort().agent.deleteAgent(agentId, serverId);\n',
         '        try {\n'
         '          // HXBot (v1.7.5 fix): after the hold, so the two never meet on the host.\n'
         '          await held;\n'
         '          await agentsPort().agent.deleteAgent(agentId, serverId);\n',
        ),
    ]),
    ('apps/auth-api/src/routes/app.lazy.tsx', [
    ], [
        (
         'import { Dynamic } from "@solidjs/web";\n',
         "",
        ),
        (
         'import { type Component, createSignal, flush, lazy, onSettled, Show } from "solid-js";\n',
         'import { createSignal, flush, lazy, onSettled, Show } from "solid-js";\n',
        ),
        (
         '  // The Bloub library, which draws the loading crew, runs only in the browser, so the Worker must never\n'
         "  // import it. The Worker sends the screen's background, and the browser adds the crew after hydration.\n"
         '  // The web client shows its own crew on the same clock, so the crew does not start again.\n'
         '  const [crew, setCrew] = createSignal<Component>();\n',
         "  // HXBot (v1.7.5, UI-27): the start film replaces the loading crew. While the web client's code loads,\n"
         "  // the page shows the film's first frame (or the logo, within 30 days of the last film), so the film\n"
         '  // starts from the picture that is already there. The Worker sends the plain background; the picture\n'
         "  // needs the window's size, so it comes after hydration.\n"
         '  const [still, setStill] = createSignal<{ src: string; position: string } | null>(null);\n',
        ),
        (
         '    void loadWebApp();\n'
         '    void import("@openbot/ui/features/account/AppLoadingScreen")\n',
         '    void loadWebApp()\n'
         '      .catch(() => undefined)\n'
         '      .finally(() => setMounted(true));\n'
         '    void import("../../../../src/renderer/src/features/web-client/hx-web-boot")\n',
        ),
        (
         '        setCrew(() => module.AppLoadingScreen);\n'
         '        // Show the crew before the web client starts: the page keeps this fallback while the web\n'
         "        // client's code loads.\n",
         '        setStill(module.hxWebBootStill());\n',
        ),
        (
         '      // Without the crew, the web client still starts.\n'
         '      .catch(() => undefined)\n'
         '      .finally(() => setMounted(true));\n',
         '      // Without the picture, the web client still starts.\n'
         '      .catch(() => undefined);\n',
        ),
        (
         '            <Show when={crew()} fallback={<AppLoadingShell />}>\n'
         '              {(screen) => <Dynamic component={screen()} />}\n',
         '            <AppLoadingShell />\n'
         '            <Show when={still()}>\n'
         '              {(picture) => (\n'
         '                <main class="hx-boot" aria-hidden="true" style={{ "--hx-boot-position": picture().position }}>\n'
         '                  <img class="hx-boot-poster" src={picture().src} alt="" draggable={false} />\n'
         '                </main>\n'
         '              )}\n',
        ),
    ]),
    ('src/renderer/src/features/web-client/WebApp.tsx', [
    ], [
        (
         'import { AppLoadingScreen } from "@openbot/ui/features/account/AppLoadingScreen";\n',
         'import { HxBootScreen } from "@openbot/ui/features/account/HxBootScreen";\n',
        ),
        (
         'import { deleteRemoteWorkspaceFrames } from "../servers/remote-workspace-frame";\n',
         'import { deleteRemoteWorkspaceFrames } from "../servers/remote-workspace-frame";\n'
         'import { HX_WEB_BOOT_SOURCES, HX_WEB_BOOT_START_MS, hxWebBootFull, hxWebBootPlayed } from "./hx-web-boot";\n',
        ),
        (
         '          </Show>\n'
         '          <Show when={loadingShown()}>\n',
         '          </Show>\n'
         '          {/* HXBot (v1.7.5, UI-27): the start film, at most once in 30 days in this browser (hx-web-boot.ts). */}\n'
         '          <Show when={loadingShown()}>\n',
        ),
        (
         '            <AppLoadingScreen\n',
         '            <HxBootScreen\n'
         '              sources={HX_WEB_BOOT_SOURCES}\n'
         '              full={hxWebBootFull()}\n'
         '              startWithinMs={HX_WEB_BOOT_START_MS}\n'
         '              sound={false}\n',
        ),
        (
         '              ready={state.loaded}\n',
         '              ready={state.loaded}\n'
         '              onPlayed={() => hxWebBootPlayed()}\n',
        ),
    ]),
    ('src/main/index.ts', [
    ], [
        (
         '    scheme: "openbot-app",\n'
         '    privileges: { standard: true, secure: true, supportFetchAPI: true },\n',
         '    scheme: "openbot-app",\n'
         "    // HXBot (v1.7.5, UI-27): `stream` too, so the start film plays from the app's own files.\n"
         '    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },\n',
        ),
    ]),
    ('src/main/session-configuration.ts', [
    ], [
        (
         '      }\n'
         '      return new Response(await readFile(filePath), {\n',
         '      }\n'
         '      // HXBot (v1.7.5, UI-27): the start film streams, with its length, as attachments do.\n'
         '      if (extname(filePath).toLowerCase() === ".mp4") {\n'
         '        return await runCauseEffect(\n'
         '          fileResponse(filePath, {\n'
         '            "Content-Type": "video/mp4",\n'
         '            "Cache-Control": "no-store",\n'
         '            "X-Content-Type-Options": "nosniff",\n'
         '          }),\n'
         '        );\n'
         '      }\n'
         '      return new Response(await readFile(filePath), {\n',
        ),
        (
         '  | "image/webp"\n',
         '  | "image/webp"\n'
         '  | "image/jpeg"\n',
        ),
        (
         '      return "image/webp";\n',
         '      return "image/webp";\n'
         '    // HXBot (v1.7.5, UI-27): the first frame of the start film.\n'
         '    case ".jpg":\n'
         '    case ".jpeg":\n'
         '      return "image/jpeg";\n',
        ),
    ]),
]
