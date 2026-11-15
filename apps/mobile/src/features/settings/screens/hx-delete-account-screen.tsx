import {
  HX_DELETE_ACCOUNT_PATH,
  type HxDeleteAccountOutcome,
  hxDeleteAccountOutcome,
} from "@hxbot/contracts/hx-delete-account";
import { router } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import UserX from "lucide-react-native/icons/user-x";
import { useState } from "react";
import { Alert, View } from "react-native";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** An email can be longer than a password. */
const CONFIRM_MAX_LENGTH = 254;

/** Sends the deletion with the phone's session. */
async function hxDeleteMobileAccount(
  session: { apiUrl: string; sessionToken: string },
  confirm: string,
  fetcher: typeof fetch = fetch,
): Promise<HxDeleteAccountOutcome> {
  try {
    const response = await fetcher(new URL(HX_DELETE_ACCOUNT_PATH, session.apiUrl).toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${session.sessionToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ confirm }),
    });
    return hxDeleteAccountOutcome(response.ok, response.ok ? null : await response.json().catch(() => null));
  } catch {
    return "failed";
  }
}

/**
 * HXBot：设置 → 个人资料 → 注销账号。写明会删除什么、不会删除什么；输入密码确认，没有设置过密码的账号输入邮箱；
 * 再问一次，确定后注销并退出登录。
 */
export function HxDeleteAccountScreen() {
  const { session, signOut } = useMobileSession();
  const { t } = useText();
  const [confirm, setConfirm] = useState("");
  const [askEmail, setAskEmail] = useState(false);
  const [state, setState] = useState<{ deleting: boolean; error: string | null }>({ deleting: false, error: null });
  usePreventRemove(state.deleting, () => undefined);
  if (!session) return null;
  const typed = confirm.trim();

  const remove = async () => {
    setState({ deleting: true, error: null });
    const outcome = await hxDeleteMobileAccount(session, typed);
    if (outcome === "deleted") {
      void haptics.notification("success");
      await signOut().catch(() => undefined);
      if (router.canDismiss()) router.dismissAll();
      return;
    }
    void haptics.notification("error");
    if (outcome === "confirm_with_email") setAskEmail(true);
    setState({
      deleting: false,
      error: t(
        outcome === "incorrect_password"
          ? "mobile.settings.hxDelete.incorrectPassword"
          : outcome === "confirm_with_email"
            ? "mobile.settings.hxDelete.emailRequired"
            : "mobile.settings.hxDelete.failed",
      ),
    });
  };

  const ask = () => {
    if (!typed) {
      setState({
        deleting: false,
        error: t(askEmail ? "mobile.settings.hxDelete.emailRequired" : "mobile.settings.hxDelete.passwordRequired"),
      });
      return;
    }
    Alert.alert(
      t("mobile.settings.hxDelete.confirmTitle"),
      t("mobile.settings.hxDelete.confirmBody", { email: session.user.email }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("mobile.settings.hxDelete.confirm"), style: "destructive", onPress: () => void remove() },
      ],
    );
  };

  return (
    <SettingsContent>
      <Typography.Paragraph className="px-1">{t("mobile.settings.hxDelete.description")}</Typography.Paragraph>
      <View className="gap-2">
        <SheetFormField
          label={t(askEmail ? "mobile.settings.hxDelete.emailLabel" : "mobile.settings.hxDelete.passwordLabel")}
          value={confirm}
          editable={!state.deleting}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={!askEmail}
          inputMode={askEmail ? "email" : "text"}
          maxLength={CONFIRM_MAX_LENGTH}
          onChangeText={setConfirm}
          onSubmitEditing={() => {
            if (!state.deleting) ask();
          }}
          returnKeyType="done"
        />
        {state.error ? (
          <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
            {state.error}
          </Typography.Paragraph>
        ) : null}
      </View>
      {askEmail ? null : (
        <SettingsSection>
          <SettingsRow
            disabled={state.deleting}
            onPress={() => {
              setAskEmail(true);
              setConfirm("");
              setState({ deleting: false, error: null });
            }}
          >
            <Typography.Paragraph>{t("mobile.settings.hxDelete.noPassword")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      )}
      <SettingsSection>
        <SettingsRow
          leading={<RowIcon icon={UserX} tone="danger" />}
          disclosure={false}
          disabled={state.deleting}
          onPress={ask}
        >
          <Typography.Paragraph className="text-danger-text">
            {state.deleting ? t("mobile.settings.hxDelete.pending") : t("mobile.settings.hxDelete.action")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
