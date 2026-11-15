import {
  Button,
  ExternalLink,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Mail,
  SettingsSection,
} from "@hxbot/ui";
import { appPort } from "../../app-port";
import { useI18n } from "../../i18n-context";

/**
 * HXBot: Settings → Get help: the user guide on the HXBot server and feedback by email to bot@hxallai.com.
 * Both open the same destinations as the Help menu of the window rail.
 */
export function HxHelpTab() {
  const i18n = useI18n();
  return (
    <SettingsSection title={i18n.t("settings.help.section")}>
      <ItemGroup class="settings-modal-card">
        <Item data-settings-row="settings.help.guide.title" class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{i18n.t("settings.help.guide.title")}</ItemTitle>
            <ItemDescription>{i18n.t("settings.help.guide.description")}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="outline" type="button" size="sm" onClick={() => void appPort().openExternal("guides")}>
              {i18n.t("settings.help.guide.action")}
              <ExternalLink aria-hidden="true" />
            </Button>
          </ItemActions>
        </Item>
        <Item data-settings-row="settings.help.feedback.title" class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{i18n.t("settings.help.feedback.title")}</ItemTitle>
            <ItemDescription>{i18n.t("settings.help.feedback.description")}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="outline" type="button" size="sm" onClick={() => void appPort().openExternal("feedback")}>
              {i18n.t("settings.help.feedback.action")}
              <Mail aria-hidden="true" />
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
    </SettingsSection>
  );
}
