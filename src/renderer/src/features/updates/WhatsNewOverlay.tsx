import { toast } from "@hxbot/ui";
import { WhatsNewDialog } from "@hxbot/ui/features/updates/WhatsNewDialog";
import { useText } from "@hxbot/ui/text";
import { createEffect, untrack } from "solid-js";
import { appPort } from "../../app-port";
import { useWhatsNew } from "./whats-new-context";

/** Mounted only when the workspace is ready, outside the lifetime of a selected server. */
export function WhatsNewOverlay(props: { ready: boolean }) {
  const { t, errorMessage } = useText();
  const whatsNew = useWhatsNew();
  createEffect(
    () => props.ready && whatsNew.state.version !== "",
    (ready) => {
      if (ready) untrack(whatsNew.start);
    },
  );
  return (
    <WhatsNewDialog
      open={props.ready && whatsNew.state.open}
      version={whatsNew.state.version}
      previousVersion={whatsNew.state.previousVersion}
      notes={whatsNew.state.notes}
      onOpenChange={(open) => {
        if (!open) whatsNew.close();
      }}
      onRetry={whatsNew.retry}
      onOpenChangelog={() => {
        void appPort()
          .openUrl("https://bot.hxallai.com/whats-new/")
          .catch((error: unknown) => toast.error(errorMessage(error, t("update.whatsNew.changelogFailed")), { error }));
      }}
    />
  );
}
