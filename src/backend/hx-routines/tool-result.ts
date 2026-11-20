/**
 * HXBot (v1.7.5, RTN-01): what the routine tools tell the agent after a create or an update, so it can
 * say the next three runs to the person in the chat: each in the routine's zone and in UTC, with the
 * daylight-saving change that moved or repeated it.
 */

import type { RoutineFields } from "@hxbot/contracts/ipc";
import { hxRoutineUpcoming } from "@hxbot/team-client/routine-schedule";
import type { HxZoneSource } from "./zone";

export interface HxUpcomingForTool {
  /** `YYYY-MM-DD HH:mm` in the routine's zone. */
  local: string;
  utc: string;
  /** UTC offset such as "UTC+08:00". */
  offset: string;
  /** A daylight-saving note, or absent. */
  note?: string;
}

function hxOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const total = Math.abs(offsetMinutes);
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const minutes = String(total % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

/** The next three runs of an active routine; none for a paused one. */
function hxUpcomingForTool(routine: RoutineFields, now = new Date()): HxUpcomingForTool[] {
  if (!routine.active) return [];
  return hxRoutineUpcoming(routine.trigger.schedule, routine.timezone, now, 3).map((occurrence) => {
    const note = occurrence.shiftedFrom
      ? `${occurrence.shiftedFrom} does not exist on this day in ${routine.timezone} (the clock goes forward), so it runs at the first time after the gap.`
      : occurrence.repeated
        ? `This time occurs twice on this day in ${routine.timezone} (the clock goes back); it runs once, at the first one (${hxOffsetLabel(occurrence.offsetMinutes)}).`
        : undefined;
    return {
      local: occurrence.local,
      utc: occurrence.at,
      offset: hxOffsetLabel(occurrence.offsetMinutes),
      ...(note ? { note } : {}),
    };
  });
}

/** The saved routine, with its next three runs and where its zone came from. */
export function hxRoutineToolResult<T extends RoutineFields>(
  routine: T,
  timezoneSource?: HxZoneSource,
  now = new Date(),
): T & { upcoming: HxUpcomingForTool[]; timezoneSource?: HxZoneSource; pausedNote?: string } {
  return {
    ...routine,
    upcoming: hxUpcomingForTool(routine, now),
    ...(timezoneSource ? { timezoneSource } : {}),
    ...(routine.active ? {} : { pausedNote: "The routine is paused, so it has no upcoming runs." }),
  };
}
