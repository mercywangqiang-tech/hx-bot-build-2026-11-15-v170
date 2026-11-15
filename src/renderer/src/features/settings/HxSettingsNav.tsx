import type { AppTextKey } from "@hxbot/i18n";
import { type Settings, Tabs } from "@hxbot/ui";
import { For, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import type { SettingsTab } from "./settings-tabs";

/**
 * HXBot: the settings list in groups: Settings, Features, then Data & security, each under a small heading,
 * and About and Get help below a line. A group with no tab on this computer (the Dynamic Island and the dock
 * are macOS only) shows nothing, not an empty heading.
 */
type SettingsGroup = "settings" | "features" | "data" | "more";

const GROUPS: ReadonlyArray<{ id: SettingsGroup; titleKey: AppTextKey | null }> = [
  { id: "settings", titleKey: "settings.nav.group.settings" },
  { id: "features", titleKey: "settings.nav.group.features" },
  { id: "data", titleKey: "settings.nav.group.data" },
  { id: "more", titleKey: null },
];

/** The group of each tab. A new tab without a group fails the type check, so it cannot go missing from the list. */
const GROUP_OF: Record<SettingsTab, SettingsGroup> = {
  general: "settings",
  profile: "settings",
  billing: "settings",
  "hosted-servers": "settings",
  agents: "features",
  notifications: "features",
  voice: "features",
  "dynamic-island": "features",
  "agent-dock": "features",
  "computer-use": "features",
  "mobile-connect": "features",
  "hx-access": "data",
  updates: "more",
  help: "more",
};

interface HxSettingsNavProps {
  /** The tabs this window shows, in the order of the settings list. */
  items: ReadonlyArray<{ value: SettingsTab; titleKey: AppTextKey; icon: typeof Settings }>;
  active: SettingsTab;
}

export function HxSettingsNav(props: HxSettingsNavProps) {
  const i18n = useI18n();
  return (
    <For each={GROUPS}>
      {(group) => {
        const items = () => props.items.filter((item) => GROUP_OF[item.value] === group.id);
        return (
          <Show when={items().length > 0}>
            {group.titleKey === null ? (
              <div class="settings-modal-nav-divider" aria-hidden="true" />
            ) : (
              <div class="settings-modal-nav-heading" aria-hidden="true">
                {i18n.t(group.titleKey)}
              </div>
            )}
            <For each={items()}>
              {(item) => {
                const NavIcon = item.icon;
                return (
                  <Tabs.Trigger
                    class="settings-modal-nav-item"
                    value={item.value}
                    aria-current={props.active === item.value ? "page" : undefined}
                  >
                    <NavIcon aria-hidden="true" />
                    <span>{i18n.t(item.titleKey)}</span>
                  </Tabs.Trigger>
                );
              }}
            </For>
          </Show>
        );
      }}
    </For>
  );
}
