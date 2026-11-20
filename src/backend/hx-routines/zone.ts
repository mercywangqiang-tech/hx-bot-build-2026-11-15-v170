/**
 * HXBot (v1.7.5, RTN-01): which zone a routine an agent creates runs in.
 *
 * The rule of the spec: the zone is required; the default is the zone the user registered (the server
 * timezone, `ServerTimezonePreferenceStore`); with none registered, the first routine asks the user
 * once and the answer is remembered as the registered zone. The host's own system zone is never used
 * silently, nor is the zone a member's device sent with the message: it is only offered to the agent
 * as the likely answer, so that it can ask "Asia/Shanghai?".
 *
 * The store is in the main process; it attaches here when the services start. Before that (and in
 * tests that do not attach) nothing is registered.
 */

import { sourceText } from "@hxbot/i18n/source";
import { RoutineInputError } from "@hxbot/team-client/routine-schedule";

export type HxZoneSource = "given" | "registered";

interface HxZoneStore {
  /** The registered zone, or null when the server timezone is automatic. */
  registered(): string | null;
  /** Remembers `zone` as the registered zone. A failed write is reported and the routine keeps its zone. */
  register(zone: string): Promise<void>;
}

/**
 * The IANA name of `zone` as this runtime spells it ("asia/shanghai" → "Asia/Shanghai"), or null for a
 * value that is not one. An offset such as "+08:00" resolves in newer runtimes but names no zone with
 * daylight saving rules, so it is refused: a routine stores an IANA name.
 */
export function hxCanonicalZone(zone: string): string | null {
  if (zone.length === 0 || zone.length > 128 || zone.trim() !== zone) return null;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
    return /^[A-Za-z]/.test(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/** True for a zone this runtime resolves to an IANA name. */
export function hxValidZone(zone: string): boolean {
  return hxCanonicalZone(zone) !== null;
}

class HxRoutineZones {
  #store: HxZoneStore | null = null;
  /** The zone being written as the registered zone. Until the write ends it counts as registered. */
  #pending: string | null = null;

  attach(store: HxZoneStore): void {
    this.#store = store;
  }

  /** For tests. */
  detach(): void {
    this.#store = null;
    this.#pending = null;
  }

  registered(): string | null {
    const stored = this.#store?.registered() ?? null;
    const zone = stored === null ? this.#pending : hxCanonicalZone(stored);
    return zone ?? this.#pending;
  }

  /**
   * The zone of a routine that an agent creates. `given` is the tool call's own value; `sender` is the
   * zone the member's device reported, used only in the message that asks for a zone.
   */
  forNewRoutine(given: string | undefined, sender: string | undefined): { zone: string; source: HxZoneSource } {
    if (given !== undefined) {
      const zone = hxCanonicalZone(given.trim());
      if (zone === null) {
        throw new RoutineInputError(
          `"${given}" is not an IANA timezone this computer knows. Ask the user for the zone, for example Asia/Shanghai or America/Los_Angeles.`,
        );
      }
      this.#remember(zone);
      return { zone, source: "given" };
    }
    const registered = this.registered();
    if (registered !== null) return { zone: registered, source: "registered" };
    const hint =
      sender !== undefined && hxValidZone(sender) ? ` The user's device reports ${sender}; ask whether to use it.` : "";
    throw new RoutineInputError(
      `No timezone is registered on this server yet, and a routine needs one. Ask the user once which timezone their routines run in (an IANA name such as Asia/Shanghai).${hint} Then call again with timezone; that zone is remembered as the registered timezone for later routines.`,
    );
  }

  /**
   * The zone of an update that names one: an IANA name, remembered as the registered zone while none
   * is registered.
   */
  forUpdate(given: string): string {
    const zone = hxCanonicalZone(given.trim());
    if (zone === null) {
      throw new RoutineInputError(
        `"${given}" is not an IANA timezone this computer knows. Ask the user for the zone, for example Asia/Shanghai or America/Los_Angeles.`,
      );
    }
    this.#remember(zone);
    return zone;
  }

  /**
   * The zone of a routine saved in the editor or through the Team API, in its IANA spelling. A value
   * that names no zone is refused with a message the person reads.
   */
  checkSaved(zone: string): string {
    const canonical = hxCanonicalZone(zone.trim());
    if (canonical === null) throw new RoutineInputError(sourceText("error.backend.hxRoutineZoneUnknown", { zone }));
    return canonical;
  }

  /** A zone that a person or an agent chose while none is registered becomes the registered zone. */
  #remember(zone: string): void {
    const store = this.#store;
    if (!store || this.registered() !== null) return;
    this.#pending = zone;
    store.register(zone).then(
      () => {
        if (this.#pending === zone) this.#pending = null;
      },
      () => {
        // The routine keeps its own zone; the next routine asks again.
        if (this.#pending === zone) this.#pending = null;
      },
    );
  }
}

export const hxRoutineZones = new HxRoutineZones();
