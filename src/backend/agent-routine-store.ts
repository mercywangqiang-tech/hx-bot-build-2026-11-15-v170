import type {
  CreateRoutineInput,
  Routine,
  RoutineRun,
  RoutineRunStatus,
  UpdateRoutineInput,
} from "@hxbot/contracts/ipc";
import { type HxRunDetail, hxCopyRoutineDetail } from "./hx-routines/detail";
import type { HxBotDatabase } from "./hxbot-database";
import {
  type DueRoutine,
  type OwnedRoutine,
  type OwnedRoutineRun,
  type ReceivedWebhookEvent,
  type RoutineRunStart,
  RoutineStore,
  type WebhookReceiveResult,
} from "./routine-store";
import { ROUTINE_TABLES } from "./routine-tables";

export interface DueRoutineTrigger {
  routine: Routine;
  triggerId: string;
  nextRunAt: string;
  schedule: DueRoutine["schedule"];
}

/**
 * The agent-shaped names over the shared store: `ownerId` reads as `agentId` and the run handle
 * reads as `deliveryId`. The SQL, the constraints and the command ids all live in `RoutineStore`,
 * so this file only translates - which is why the callers did not change with the extraction.
 */
export class AgentRoutineStore extends RoutineStore {
  constructor(database: HxBotDatabase) {
    super(database, ROUTINE_TABLES.agent);
  }

  list(agentId: string): Routine[] {
    return this.listRoutines(agentId).map(toRoutine);
  }

  get(agentId: string, routineId: string): Routine | null {
    const routine = this.getRoutine(agentId, routineId);
    return routine ? toRoutine(routine) : null;
  }

  duplicate(sourceAgentId: string, targetAgentId: string, now = new Date()): Map<string, Routine> {
    const duplicated = new Map<string, Routine>();
    for (const routine of this.list(sourceAgentId)) {
      const created = this.create(
        {
          agentId: targetAgentId,
          name: routine.name,
          instruction: routine.instruction,
          active: routine.active,
          timezone: routine.timezone,
          schedule: routine.trigger.schedule,
          ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
          ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),
          ...(routine.runIn ? { runIn: routine.runIn } : {}),
        },
        now,
      );
      // HXBot (v1.7.5, MIG-03): the copy keeps its zone mark and whether it asks before each run.
      hxCopyRoutineDetail(this.database.connection, "agent", routine.id, created.id);
      duplicated.set(routine.id, this.list(targetAgentId).find((entry) => entry.id === created.id) ?? created);
    }
    return duplicated;
  }

  create(input: CreateRoutineInput, now = new Date()): Routine {
    const { agentId, ...fields } = input;
    return toRoutine(this.createRoutine(agentId, fields, now));
  }

  update(input: UpdateRoutineInput, now = new Date()): Routine {
    const { agentId, ...fields } = input;
    return toRoutine(this.updateRoutine(agentId, fields, now));
  }

  listRuns(agentId: string, routineId: string, limit = 50, withSkipped = false): RoutineRun[] {
    return this.listRunRows(agentId, routineId, limit, withSkipped).map(toRun);
  }

  pendingRuns(): RoutineRun[] {
    return this.pendingRunRows().map(toRun);
  }

  activeRuns(agentId: string, routineId: string): RoutineRun[] {
    return this.activeRunRows(agentId, routineId).map(toRun);
  }

  due(now = new Date(), excludedAgentIds: ReadonlySet<string> = new Set()): DueRoutineTrigger[] {
    return this.dueRoutines(now, excludedAgentIds).map((entry) => ({
      routine: toRoutine(entry.routine),
      triggerId: entry.triggerId,
      nextRunAt: entry.nextRunAt,
      schedule: entry.schedule,
    }));
  }

  createRun(
    routine: Pick<Routine, "id" | "agentId" | "name" | "instruction">,
    triggerId: string | null,
    start: RoutineRunStart,
    scheduledFor: string,
  ): RoutineRun {
    return toRun(this.createRunRow(runSource(routine), triggerId, start, scheduledFor));
  }

  receiveWebhook(agentId: string, routineId: string, event: ReceivedWebhookEvent): WebhookReceiveResult<RoutineRun> {
    const result = this.receiveWebhookRow(agentId, routineId, event);
    return result.kind === "started" ? { kind: "started", run: toRun(result.run) } : result;
  }

  /** HXBot (v1.7.5, RTN-02 / RTN-03): a record of occurrences that did not run. */
  hxRecordNotRun(
    routine: Pick<Routine, "id" | "agentId" | "name" | "instruction">,
    triggerId: string | null,
    record: { scheduledFor: string; until: string | null; count: number },
    detail: HxRunDetail,
  ): void {
    this.hxRecordNotRunRow(runSource(routine), triggerId, record, detail);
  }

  /** HXBot (v1.7.5): what HXBot records about a run. */
  hxNoteRun(runId: string, routineId: string, change: (detail: HxRunDetail) => HxRunDetail): void {
    this.hxNoteRunRow(runId, routineId, change);
  }

  attachDelivery(runId: string, deliveryId: string): RoutineRun {
    return toRun(this.attachHandleRow(runId, deliveryId));
  }

  updateRunStatus(runId: string, status: RoutineRunStatus, error: string | null = null): RoutineRun {
    return toRun(this.updateRunRow(runId, status, error));
  }

  runForDelivery(deliveryId: string): RoutineRun | null {
    const run = this.runForHandleRow(deliveryId);
    return run ? toRun(run) : null;
  }
}

function toRoutine({ ownerId, ...fields }: OwnedRoutine): Routine {
  return { ...fields, agentId: ownerId };
}

function runSource({ id, agentId, name, instruction }: Pick<Routine, "id" | "agentId" | "name" | "instruction">) {
  return { id, ownerId: agentId, name, instruction };
}

function toRun({ ownerId, handleId, ...fields }: OwnedRoutineRun): RoutineRun {
  return { ...fields, agentId: ownerId, deliveryId: handleId };
}
