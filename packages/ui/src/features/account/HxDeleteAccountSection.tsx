import type { HxDeleteAccountOutcome } from "@hxbot/contracts/hx-delete-account";
import {
  Button,
  ConfirmDialog,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
} from "@hxbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";

interface HxDeleteAccountSectionProps {
  email: string;
  /** Deletes the account with the password, or the email for an account without a password. */
  onDelete: (confirm: string) => Promise<HxDeleteAccountOutcome>;
}

/** The longest password the account service accepts; an email can be longer. */
const HX_CONFIRM_MAX_LENGTH = 254;

/**
 * HXBot：设置 → 个人资料最下面的“注销账号”。确认对话框里写明会删除什么、不会删除什么，输入密码才能注销；
 * 没有设置过密码的账号（只用第三方账号登录）输入邮箱确认。注销成功后由各端退出登录。
 */
export function HxDeleteAccountSection(props: HxDeleteAccountSectionProps) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  const [confirm, setConfirm] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [askEmail, setAskEmail] = createSignal(false);

  function close() {
    setOpen(false);
    setConfirm("");
    setError(null);
  }

  async function remove() {
    const typed = confirm().trim();
    if (!typed) {
      setError(t(askEmail() ? "account.hxDelete.emailRequired" : "account.hxDelete.passwordRequired"));
      return;
    }
    setError(null);
    let outcome: HxDeleteAccountOutcome = "failed";
    try {
      outcome = await props.onDelete(typed);
    } catch {
      outcome = "failed";
    }
    if (outcome === "deleted") {
      close();
      return;
    }
    if (outcome === "confirm_with_email") setAskEmail(true);
    setError(
      t(
        outcome === "incorrect_password"
          ? "account.hxDelete.incorrectPassword"
          : outcome === "confirm_with_email"
            ? "account.hxDelete.emailRequired"
            : "account.hxDelete.failed",
      ),
    );
  }

  return (
    <SettingsSection data-settings-row="account.hxDelete.title" title={t("account.hxDelete.title")}>
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{t("account.hxDelete.title")}</ItemTitle>
            <ItemDescription>{t("account.hxDelete.description")}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="destructive" onClick={() => setOpen(true)}>
              {t("account.hxDelete.action")}
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
      <ConfirmDialog
        open={open()}
        onCancel={close}
        onConfirm={remove}
        title={t("account.hxDelete.confirmTitle")}
        description={t("account.hxDelete.confirmDescription", { email: props.email })}
        confirmLabel={t("account.hxDelete.confirm")}
        pendingLabel={t("account.hxDelete.pending")}
        initialFocus="field"
        error={error() ?? undefined}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void remove();
          }}
        >
          <Input
            type={askEmail() ? "email" : "password"}
            value={confirm()}
            maxlength={HX_CONFIRM_MAX_LENGTH}
            autocapitalize="none"
            spellcheck={false}
            autocomplete={askEmail() ? "email" : "current-password"}
            aria-label={t(askEmail() ? "account.hxDelete.emailLabel" : "account.hxDelete.passwordLabel")}
            placeholder={t(askEmail() ? "account.hxDelete.emailLabel" : "account.hxDelete.passwordLabel")}
            onValueChange={setConfirm}
          />
        </form>
        <Show when={!askEmail()}>
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setAskEmail(true);
              setConfirm("");
              setError(null);
            }}
          >
            {t("account.hxDelete.noPassword")}
          </Button>
        </Show>
      </ConfirmDialog>
    </SettingsSection>
  );
}
