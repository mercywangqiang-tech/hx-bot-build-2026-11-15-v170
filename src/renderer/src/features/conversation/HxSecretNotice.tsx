// HXBot：消息里像有密码或密钥时，聊天框上方的提醒（见 hx-secret-guard.ts）。
import { Button } from "@hxbot/ui";
import { ComposerNotice } from "@hxbot/ui/features/conversation/ComposerNotice";
import { useText } from "@hxbot/ui/text";
import { Show } from "solid-js";
import {
  canOpenHxVault,
  dismissHeldSecret,
  heldSecretMessage,
  openHxVault,
  sendHeldSecretAnyway,
} from "./hx-secret-guard";

export function HxSecretNotice(props: { draftText: string; serverId: string }) {
  const { t } = useText();
  // The notice belongs to the text that waits: once the user changes it, the next send checks again.
  const shown = () => heldSecretMessage()?.text === props.draftText;
  return (
    <Show when={shown()}>
      <ComposerNotice
        tone="warning"
        title={t("composer.hxSecret.title")}
        body={t("composer.hxSecret.body")}
        onDismiss={dismissHeldSecret}
        action={
          <>
            <Show when={canOpenHxVault()}>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={(event) => {
                  dismissHeldSecret();
                  openHxVault(props.serverId, event.currentTarget);
                }}
              >
                {t("composer.hxSecret.openVault")}
              </Button>
            </Show>
            <Button variant="ghost" size="sm" type="button" onClick={sendHeldSecretAnyway}>
              {t("composer.hxSecret.sendAnyway")}
            </Button>
          </>
        }
      />
    </Show>
  );
}
