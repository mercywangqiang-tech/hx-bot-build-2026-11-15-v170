// @vitest-environment node
import { RoutineInputError } from "@hxbot/team-client/routine-schedule";
import { afterEach, describe, expect, it } from "vitest";
import { hxCanonicalZone, hxRoutineZones, hxValidZone } from "./zone";

// RTN-01: the zone of a routine is required; the default is the registered zone; with none registered,
// the first routine asks once and its zone is remembered; the host zone is never used silently.

interface FakeStore {
  zone: string | null;
  writes: string[];
  fail: boolean;
  /** Resolves the pending write, so a test can look between the call and the write. */
  release: (() => void) | null;
  hold: boolean;
}

function attach(zone: string | null, options: { fail?: boolean; hold?: boolean } = {}): FakeStore {
  const store: FakeStore = {
    zone,
    writes: [],
    fail: options.fail ?? false,
    release: null,
    hold: options.hold ?? false,
  };
  hxRoutineZones.attach({
    registered: () => store.zone,
    register: (next) => {
      store.writes.push(next);
      return new Promise<void>((resolve, reject) => {
        const finish = () => {
          if (store.fail) reject(new Error("disk full"));
          else {
            store.zone = next;
            resolve();
          }
        };
        if (store.hold) store.release = finish;
        else finish();
      });
    },
  });
  return store;
}

/** Lets the promise callbacks of a finished write run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

afterEach(() => hxRoutineZones.detach());

describe("hxCanonicalZone", () => {
  it("returns the IANA spelling, and null for what names no zone", () => {
    expect(hxCanonicalZone("asia/shanghai")).toBe("Asia/Shanghai");
    expect(hxCanonicalZone("UTC")).toBe("UTC");
    expect(hxCanonicalZone("utc")).toBe("UTC");
    expect(hxCanonicalZone("Etc/GMT+5")).toBe("Etc/GMT+5");
    expect(hxCanonicalZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    for (const bad of [
      "",
      " ",
      " Asia/Tokyo",
      "Asia/Tokyo ",
      "Mars/Olympus",
      "+08:00",
      "-05:00",
      "Z",
      "x".repeat(129),
    ]) {
      expect(hxCanonicalZone(bad), bad).toBeNull();
      expect(hxValidZone(bad), bad).toBe(false);
    }
  });

  it("knows every zone of this runtime", () => {
    for (const zone of Intl.supportedValuesOf("timeZone")) expect(hxCanonicalZone(zone), zone).not.toBeNull();
  });
});

describe("hxRoutineZones.forNewRoutine", () => {
  it("uses the registered zone when the call names none, and does not write it again", () => {
    const store = attach("Asia/Shanghai");
    expect(hxRoutineZones.forNewRoutine(undefined, "Europe/Warsaw")).toEqual({
      zone: "Asia/Shanghai",
      source: "registered",
    });
    expect(store.writes).toEqual([]);
  });

  it("uses the zone of the call over the registered one, and keeps the registered zone", () => {
    const store = attach("Asia/Shanghai");
    expect(hxRoutineZones.forNewRoutine("america/los_angeles", undefined)).toEqual({
      zone: "America/Los_Angeles",
      source: "given",
    });
    expect(store.writes).toEqual([]);
    expect(hxRoutineZones.registered()).toBe("Asia/Shanghai");
  });

  it("asks once when none is registered, offers the device zone, and never uses the host zone", () => {
    attach(null);
    const host = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let error: unknown;
    try {
      hxRoutineZones.forNewRoutine(undefined, "Europe/Warsaw");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RoutineInputError);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("No timezone is registered");
    expect(message).toContain("Europe/Warsaw");
    expect(message).toContain("Ask the user once");
    if (host !== "Europe/Warsaw") expect(message).not.toContain(host);
  });

  it("leaves a device zone that names no zone out of the question", () => {
    attach(null);
    expect(() => hxRoutineZones.forNewRoutine(undefined, "+08:00")).toThrow(/^No timezone is registered[^+]*$/);
    expect(() => hxRoutineZones.forNewRoutine(undefined, undefined)).toThrow("No timezone is registered");
  });

  it("asks when nothing is attached, as in a host that has no server timezone store", () => {
    expect(() => hxRoutineZones.forNewRoutine(undefined, undefined)).toThrow(RoutineInputError);
    expect(hxRoutineZones.forNewRoutine("UTC", undefined)).toEqual({ zone: "UTC", source: "given" });
  });

  it("remembers the first zone a user gives as the registered zone", async () => {
    const store = attach(null);
    expect(hxRoutineZones.forNewRoutine(" Asia/Tokyo ", undefined).zone).toBe("Asia/Tokyo");
    await settle();
    expect(store.writes).toEqual(["Asia/Tokyo"]);
    expect(hxRoutineZones.forNewRoutine(undefined, undefined)).toEqual({ zone: "Asia/Tokyo", source: "registered" });
  });

  it("counts a zone that is still being written as registered, so a second routine neither asks nor writes", async () => {
    const store = attach(null, { hold: true });
    hxRoutineZones.forNewRoutine("Asia/Tokyo", undefined);
    expect(hxRoutineZones.forNewRoutine(undefined, undefined)).toEqual({ zone: "Asia/Tokyo", source: "registered" });
    hxRoutineZones.forNewRoutine("Europe/Paris", undefined);
    expect(store.writes).toEqual(["Asia/Tokyo"]);
    store.release?.();
    await settle();
    expect(hxRoutineZones.registered()).toBe("Asia/Tokyo");
  });

  it("keeps the routine when the write fails, and asks again for the next one", async () => {
    const store = attach(null, { fail: true });
    expect(hxRoutineZones.forNewRoutine("Asia/Tokyo", undefined).zone).toBe("Asia/Tokyo");
    await settle();
    expect(store.writes).toEqual(["Asia/Tokyo"]);
    expect(hxRoutineZones.registered()).toBeNull();
    expect(() => hxRoutineZones.forNewRoutine(undefined, undefined)).toThrow("No timezone is registered");
  });

  it("refuses a zone this computer does not know, and writes nothing", async () => {
    const store = attach(null);
    for (const bad of ["Mars/Olympus", "+08:00", "", "   "]) {
      expect(() => hxRoutineZones.forNewRoutine(bad, undefined), bad).toThrow("is not an IANA timezone");
    }
    await settle();
    expect(store.writes).toEqual([]);
  });

  it("reads a stored zone that this runtime no longer knows as none, and replaces it", async () => {
    const store = attach("Mars/Olympus");
    expect(hxRoutineZones.registered()).toBeNull();
    expect(() => hxRoutineZones.forNewRoutine(undefined, undefined)).toThrow("No timezone is registered");
    hxRoutineZones.forNewRoutine("UTC", undefined);
    await settle();
    expect(store.writes).toEqual(["UTC"]);
  });

  it("reads the registered zone in its IANA spelling", () => {
    attach("asia/shanghai");
    expect(hxRoutineZones.forNewRoutine(undefined, undefined).zone).toBe("Asia/Shanghai");
  });
});

describe("hxRoutineZones.forUpdate and checkSaved", () => {
  it("checks the zone of an update and remembers it while none is registered", async () => {
    const store = attach(null);
    expect(hxRoutineZones.forUpdate("europe/berlin")).toBe("Europe/Berlin");
    expect(() => hxRoutineZones.forUpdate("Nowhere/City")).toThrow("is not an IANA timezone");
    await settle();
    expect(store.writes).toEqual(["Europe/Berlin"]);
  });

  it("checks the zone of a routine saved in the editor or through the Team API, and registers nothing", async () => {
    const store = attach(null);
    expect(hxRoutineZones.checkSaved("asia/seoul")).toBe("Asia/Seoul");
    expect(() => hxRoutineZones.checkSaved("+08:00")).toThrow(RoutineInputError);
    expect(() => hxRoutineZones.checkSaved("Nowhere/City")).toThrow(RoutineInputError);
    await settle();
    expect(store.writes).toEqual([]);
  });
});
