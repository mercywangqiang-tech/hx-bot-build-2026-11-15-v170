import { SearchSelect, Text } from "@hxbot/ui";
import { useText } from "@hxbot/ui/text";
import { Show } from "solid-js";

/**
 * HXBot (v1.7.5, RTN-01): the required timezone of a routine. A new routine starts with the zone the
 * user registered; with none registered the field starts empty, and the first zone the user saves
 * becomes the registered zone (the host remembers it).
 */
export interface HxRoutineZoneFieldProps {
  /** Empty until a zone is chosen. */
  value: string;
  /** The registered zone; null when none is registered; undefined while it loads or when this client cannot read it. */
  registered: string | null | undefined;
  /** False on a host whose routes keep the zone of a saved routine. */
  editable: boolean;
  /** MIG-03: the zone an earlier version gave the routine, which nobody confirmed. It runs in it until then. */
  unconfirmedZone?: string | undefined;
  showError: boolean;
  disabled?: boolean | undefined;
  onChange: (zone: string) => void;
}

// The formatters for all zones take about 60 ms to make, so the names stay for the session.
const zoneNameCache = new Map<string, string>();

function zoneNames(locale: string, zone: string): string {
  const key = `${locale} ${zone}`;
  let names = zoneNameCache.get(key);
  if (names === undefined) {
    names = [...new Set([locale, "en"])]
      .map((language) => {
        try {
          return new Intl.DateTimeFormat(language, { timeZone: zone, timeZoneName: "longGeneric" })
            .formatToParts()
            .find((part) => part.type === "timeZoneName")?.value;
        } catch {
          return undefined;
        }
      })
      .join(" ");
    zoneNameCache.set(key, names);
  }
  return names;
}

export function hxDeviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export function HxRoutineZoneField(props: HxRoutineZoneFieldProps) {
  const { t, locale } = useText();
  const device = hxDeviceZone();
  const zones = () => {
    // V8 lists canonical zones only, and "UTC" is not one of them.
    const known = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC")];
    const first = [props.registered, props.value, props.unconfirmedZone].filter(
      (zone): zone is string => typeof zone === "string" && zone.length > 0 && !known.includes(zone),
    );
    // The registered zone comes first, so it is one step away.
    const registered = props.registered && known.includes(props.registered) ? [props.registered] : [];
    return [...new Set([...first, ...registered, ...known])];
  };
  const label = (zone: string) => {
    const name = zone.replaceAll("_", " ");
    if (zone === props.registered) return t("routine.hx.zone.registeredOption", { zone: name });
    if (zone === device) return t("routine.hx.zone.deviceOption", { zone: name });
    return name;
  };
  const searchText = (zone: string) => `${zone} ${label(zone)} ${zoneNames(locale(), zone)}`;
  return (
    <div class="hx-routine-zone">
      <span id="agent-routine-timezone-label">{t("routine.hx.zone.label")}</span>
      <Show
        when={props.editable}
        fallback={
          <>
            <span>{props.value.replaceAll("_", " ")}</span>
            <Text variant="caption" class="hx-routine-zone-hint">
              {t("routine.hx.zone.fixed")}
            </Text>
          </>
        }
      >
        <SearchSelect<string>
          options={zones()}
          value={props.value || null}
          label={label}
          optionTextValue={searchText}
          disabled={props.disabled}
          size="sm"
          aria-labelledby="agent-routine-timezone-label"
          onChange={(zone) => props.onChange(zone)}
        >
          {props.value ? undefined : t("routine.hx.zone.placeholder")}
        </SearchSelect>
      </Show>
      <Show when={props.registered === null && !props.value}>
        <Text variant="caption" class="hx-routine-zone-hint">
          {t("routine.hx.zone.firstHint")}
        </Text>
      </Show>
      <Show when={props.unconfirmedZone}>
        {(zone) => (
          <Text variant="caption" class="hx-routine-zone-warning">
            {t("routine.hx.zone.unconfirmed", { zone: zone().replaceAll("_", " ") })}
          </Text>
        )}
      </Show>
      <Show when={props.showError && !props.value}>
        <Text variant="caption" tone="danger" role="alert" class="agent-routine-field-error">
          {t("routine.hx.zone.required")}
        </Text>
      </Show>
    </div>
  );
}
