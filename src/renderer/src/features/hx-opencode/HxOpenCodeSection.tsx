/**
 * HXBot: the line under the provider list that opens the OpenCode services (hx-opencode). Only the
 * provider settings of this computer show it: the services connect to the OpenCode of this computer.
 */

import { Button, Plug, Text } from "@hxbot/ui";
import { useI18n } from "../../i18n-context";

export function HxOpenCodeSection(props: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <section class="hx-opencode-section" aria-label={t("settings.hxOpenCode.title")}>
      <span class="custom-provider-preset-icon" aria-hidden="true">
        <Plug />
      </span>
      <span class="custom-provider-preset-copy">
        <span class="custom-provider-preset-title">{t("settings.hxOpenCode.title")}</span>
        <Text tone="muted" variant="caption">
          {t("settings.hxOpenCode.sectionDescription")}
        </Text>
      </span>
      <Button type="button" variant="secondary" size="sm" onClick={() => props.onOpen()}>
        {t("settings.hxOpenCode.sectionOpen")}
      </Button>
    </section>
  );
}
