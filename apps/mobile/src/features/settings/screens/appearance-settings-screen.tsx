import { Typography } from "heroui-native";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { saveHxBootSound, useHxBoot } from "@/features/boot/model/hx-boot";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { saveAppearance, useAppearance } from "@/features/settings/model/appearance";
import { saveAgentColorMessages, useAgentColorMessages } from "@/features/settings/model/message-color";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function AppearanceSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const { value, ready, saving } = useAppearance();
  const [error, setError] = useState<string | null>(null);
  const agentColorMessages = useAgentColorMessages();
  const [agentColorError, setAgentColorError] = useState<string | null>(null);
  const boot = useHxBoot();
  const [bootError, setBootError] = useState<string | null>(null);
  return (
    <SettingsContent>
      <SettingsSection footer={error || t("mobile.settings.appearance.footer")}>
        <SettingsRow
          trailing={
            <SettingsPicker
              value={value}
              options={[
                { value: "system", label: t("mobile.settings.appearance.system") },
                { value: "light", label: t("mobile.settings.appearance.light") },
                { value: "dark", label: t("mobile.settings.appearance.dark") },
              ]}
              enabled={ready && !saving}
              dark={theme === "dark"}
              label={t("mobile.settings.appearance.theme")}
              onChange={(next) => {
                setError(null);
                void haptics.selection();
                void saveAppearance(next).catch(() => {
                  setError(t("mobile.settings.appearance.saveFailed"));
                  void haptics.notification("error");
                });
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.settings.appearance.theme")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection footer={agentColorError ?? t("mobile.settings.appearance.agentColorMessagesFooter")}>
        <SettingsRow>
          <SettingsSwitch
            value={agentColorMessages.enabled}
            disabled={!agentColorMessages.ready || agentColorMessages.saving}
            label={t("mobile.settings.appearance.agentColorMessages")}
            dark={theme === "dark"}
            onValueChange={(enabled) => {
              setAgentColorError(null);
              void saveAgentColorMessages(enabled).catch(() => {
                setAgentColorError(t("mobile.settings.saveFailed"));
                void haptics.notification("error");
              });
            }}
          />
        </SettingsRow>
      </SettingsSection>
      {/* HXBot (v1.7.5, UI-27): the sound of the start film, off by default. */}
      <SettingsSection footer={bootError ?? t("mobile.settings.appearance.hxBootSoundFooter")}>
        <SettingsRow>
          <SettingsSwitch
            value={boot.sound}
            disabled={!boot.ready || boot.saving}
            label={t("mobile.settings.appearance.hxBootSound")}
            dark={theme === "dark"}
            onValueChange={(on) => {
              setBootError(null);
              void saveHxBootSound(on).catch(() => {
                setBootError(t("mobile.settings.saveFailed"));
                void haptics.notification("error");
              });
            }}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
