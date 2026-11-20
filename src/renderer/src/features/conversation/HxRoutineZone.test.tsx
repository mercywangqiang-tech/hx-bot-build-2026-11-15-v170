// HXBot v1.7.5（RTN-01）：定时任务的时区必填、接下来三次（所在时区和 UTC）、夏令时说明。
import type { RoutineSchedule } from "@hxbot/contracts/ipc";
import { HxRoutineUpcoming, hxUpcomingOf } from "@hxbot/ui/features/conversation/HxRoutineUpcoming";
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { HxRoutineZoneField } from "./HxRoutineZoneField";

const daily = (time: string): RoutineSchedule => ({ kind: "daily", time });

describe("HxRoutineUpcoming", () => {
  it("shows the spring gap of America/Los_Angeles: 02:30 runs at 03:00, in local time and UTC", async () => {
    render(() => (
      <HxRoutineUpcoming
        schedule={daily("02:30")}
        timezone="America/Los_Angeles"
        active
        now={new Date("2027-03-13T12:00:00.000Z")}
      />
    ));
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    // 2027-03-14 03:00 PDT = 10:00 UTC; the next days are 02:30 PDT = 09:30 UTC.
    expect(items[0]?.textContent).toContain("10:00");
    expect(items[0]?.textContent).toContain("UTC−07:00");
    expect(items[0]?.textContent).toContain(
      "Daylight saving starts: 02:30 does not exist on this day, so it runs at 03:00.",
    );
    expect(items[1]?.textContent).toContain("09:30");
    expect(items[1]?.textContent).not.toContain("Daylight saving");
  });

  it("shows the fall repeat of America/Los_Angeles: 01:30 runs once, at the first one", async () => {
    render(() => (
      <HxRoutineUpcoming
        schedule={daily("01:30")}
        timezone="America/Los_Angeles"
        active
        now={new Date("2027-11-06T12:00:00.000Z")}
      />
    ));
    const items = await screen.findAllByRole("listitem");
    expect(items[0]?.textContent).toContain("08:30");
    expect(items[0]?.textContent).toContain(
      "Daylight saving ends: 01:30 occurs twice on this day. It runs once, at the first one (UTC−07:00).",
    );
    // The next day runs at 01:30 PST, 09:30 UTC: one run on the repeated day.
    expect(items[1]?.textContent).toContain("09:30");
  });

  it("asks for a zone, says paused, and says no more runs", () => {
    expect(hxUpcomingOf({ schedule: daily("09:00"), timezone: "", active: true }).kind).toBe("zone");
    expect(hxUpcomingOf({ schedule: daily("09:00"), timezone: "Mars/Olympus", active: true }).kind).toBe("zone");
    expect(hxUpcomingOf({ schedule: daily("09:00"), timezone: "UTC", active: false }).kind).toBe("paused");
    expect(
      hxUpcomingOf({
        schedule: { kind: "once", date: "2020-01-01", time: "09:00" },
        timezone: "UTC",
        active: true,
        now: new Date("2026-11-20T00:00:00.000Z"),
      }).kind,
    ).toBe("none");
    render(() => <HxRoutineUpcoming schedule={daily("09:00")} timezone="" active />);
    expect(screen.getByText("Choose a timezone to see the next three runs.")).toBeTruthy();
  });

  it("shows Asia/Shanghai with its offset and the same time in UTC", async () => {
    render(() => (
      <HxRoutineUpcoming
        schedule={daily("09:00")}
        timezone="Asia/Shanghai"
        active
        now={new Date("2026-11-20T00:00:00.000Z")}
      />
    ));
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.textContent).toContain("09:00");
      expect(item.textContent).toContain("UTC+08:00");
      expect(item.textContent).toContain("01:00");
    }
  });
});

describe("HxRoutineZoneField", () => {
  it("says the zone is required when a save has none", () => {
    render(() => <HxRoutineZoneField value="" registered={null} editable showError onChange={() => {}} />);
    expect(screen.getByRole("alert").textContent).toBe("Choose the timezone that this routine runs in.");
    expect(
      screen.getByText(
        "No timezone is registered yet. Choose one once: HXBot remembers it and uses it for new routines.",
      ),
    ).toBeTruthy();
  });

  it("names the registered zone and asks nothing when one is chosen", () => {
    render(() => (
      <HxRoutineZoneField value="Asia/Shanghai" registered="Asia/Shanghai" editable showError onChange={() => {}} />
    ));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByText(
        "No timezone is registered yet. Choose one once: HXBot remembers it and uses it for new routines.",
      ),
    ).toBeNull();
    expect(screen.getByText("Asia/Shanghai (your registered timezone)")).toBeTruthy();
  });

  it("warns about a zone from an earlier version, and keeps the zone of a host that cannot change it", () => {
    render(() => (
      <HxRoutineZoneField
        value=""
        registered={undefined}
        editable
        unconfirmedZone="Europe/Warsaw"
        showError={false}
        onChange={() => {}}
      />
    ));
    expect(
      screen.getByText(
        "Timezone not confirmed: this routine is from an earlier version and runs in Europe/Warsaw. Choose its timezone to confirm it.",
      ),
    ).toBeTruthy();
  });

  it("shows a fixed zone as text on a host whose routes keep it", () => {
    render(() => (
      <HxRoutineZoneField
        value="America/New_York"
        registered={undefined}
        editable={false}
        showError
        onChange={() => {}}
      />
    ));
    expect(screen.getByText("America/New York")).toBeTruthy();
    expect(
      screen.getByText(
        "This host keeps the timezone of a saved routine. To use another timezone, create the routine again.",
      ),
    ).toBeTruthy();
  });
});
