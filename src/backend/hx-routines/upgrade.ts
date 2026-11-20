/**
 * HXBot (v1.7.5, MIG-03): the one-time pass over the routines of a database that came from an earlier
 * version, right after the migrations. It lists each routine it changed in the log, before and after,
 * and the routine list shows the same list to the person (`hx_routine_detail.upgrade`).
 */

import type { DatabaseSync } from "node:sqlite";
import { createHxBotLogger } from "@hxbot/logging";
import { type HxUpgradedRoutine, hxUpgradeRoutinesV175 } from "../database/hx-routine-detail-schema";

const logger = createHxBotLogger("hx-routines-upgrade");

export function hxUpgradeAfterMigrations(db: DatabaseSync, now = new Date()): HxUpgradedRoutine[] {
  const changed = hxUpgradeRoutinesV175(db, now.toISOString());
  if (changed.length > 0) {
    logger.info("The upgrade to v1.7.5 changed routines; every routine keeps all of its fields.", {
      changed: changed.length,
    });
    for (const routine of changed) {
      logger.info("Routine changed by the upgrade to v1.7.5", {
        ownerKind: routine.ownerKind,
        ownerId: routine.ownerId,
        routineId: routine.routineId,
        name: routine.name,
        before: { timezone: routine.timezone, confirmed: "not recorded", confirmEachRun: false },
        after: {
          timezone: routine.timezone,
          confirmed: !routine.changes.includes("zone-unconfirmed"),
          confirmEachRun: routine.changes.includes("confirm-each"),
          actions: routine.actions,
        },
      });
    }
  }
  return changed;
}
