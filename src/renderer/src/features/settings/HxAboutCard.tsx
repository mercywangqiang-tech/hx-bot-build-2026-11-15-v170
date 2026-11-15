import {
  Button,
  ExternalLink,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
} from "@hxbot/ui";
import { appPort } from "../../app-port";
import { useI18n } from "../../i18n-context";

/** HXBot's page on the company website, and the terms and privacy policy on the HXBot server. */
const HX_PRODUCT_PAGE = "https://www.hxallai.com/hxbot/";
const HX_TERMS = "https://bot.hxallai.com/terms/";
const HX_PRIVACY = "https://bot.hxallai.com/privacy/";

/**
 * HXBot: the lower half of Settings → About, under the version and updates: the website, then the terms
 * and the privacy policy. The pages open in the browser; the terms and the privacy policy turn to English
 * there when the browser reads English.
 */
export function HxAboutCard() {
  const i18n = useI18n();
  const open = (url: string) => void appPort().openUrl(url);
  return (
    <SettingsSection title={i18n.t("settings.about.section")}>
      <ItemGroup class="settings-modal-card">
        <Item data-settings-row="settings.about.website.title" class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{i18n.t("settings.about.website.title")}</ItemTitle>
            <ItemDescription>{i18n.t("settings.about.website.description")}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="outline" type="button" size="sm" onClick={() => open(HX_PRODUCT_PAGE)}>
              {i18n.t("settings.about.website.action")}
              <ExternalLink aria-hidden="true" />
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
      <p class="hx-about-legal">
        <Button variant="link" type="button" size="sm" onClick={() => open(HX_PRIVACY)}>
          {i18n.t("settings.about.privacy")}
        </Button>
        <span aria-hidden="true">|</span>
        <Button variant="link" type="button" size="sm" onClick={() => open(HX_TERMS)}>
          {i18n.t("settings.about.terms")}
        </Button>
      </p>
    </SettingsSection>
  );
}
