// HXBot：完全访问要二次确认。第一次确认之后再问一次，第二次也确认才保存。
import type { MobileTextKey } from "@hxbot/i18n/mobile";
import { Alert } from "react-native";

export function hxConfirmFullAccessAgain(t: (key: MobileTextKey) => string, save: () => void): void {
  Alert.alert(t("mobile.agent.access.hxFullAgainTitle"), t("mobile.agent.access.hxFullAgainBody"), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("mobile.agent.access.hxFullAgainConfirm"), style: "destructive", onPress: save },
  ]);
}
