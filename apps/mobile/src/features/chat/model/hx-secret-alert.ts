// HXBot：手机端发送前识别像密码、密钥的内容，用系统对话框提醒（识别规则与桌面端相同）。
import { hasHxSecret } from "@hxbot/contracts/hx-secret-detect";
import { router } from "expo-router";
import { Alert } from "react-native";

export interface HxSecretAlertOptions {
  labels: { title: string; body: string; edit: string; openVault: string; sendAnyway: string };
  /** The server whose Vault the dialog opens. Without one, the dialog has no Vault button. */
  vaultServerId?: string | undefined;
  /** The message waits: the composer lets the next send through. */
  onHeld?: () => void;
}

/**
 * Sends `text` at once, or asks first when it seems to hold a password, a key or a token. While the
 * dialog is open the text stays in the composer: only Send anyway sends it.
 */
export function sendUnlessHxSecret(text: string, send: (text: string) => void, options: HxSecretAlertOptions): void {
  if (!hasHxSecret(text)) {
    send(text);
    return;
  }
  options.onHeld?.();
  const { labels, vaultServerId } = options;
  Alert.alert(labels.title, labels.body, [
    { text: labels.edit, style: "cancel" },
    ...(vaultServerId
      ? [
          {
            text: labels.openVault,
            onPress: () => router.push({ pathname: "/server-settings/vault", params: { serverId: vaultServerId } }),
          },
        ]
      : []),
    { text: labels.sendAnyway, style: "destructive" as const, onPress: () => send(text) },
  ]);
}
