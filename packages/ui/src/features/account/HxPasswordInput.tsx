import { Button, Input } from "@hxbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";
import type { OtpInputStatus } from "./OtpInput";

/** The longest password the account service accepts. */
const HX_LOGIN_PASSWORD_MAX_LENGTH = 32;

interface HxPasswordInputProps {
  value: string;
  status: OtpInputStatus;
  errorMessage?: string | null;
  disabled?: boolean;
  autofocus?: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

/**
 * The web app runs in a browser tab on the HXBot server, where a link can open the portal page in a new
 * tab. The desktop window opens no new windows, so it shows the address in the hint text only.
 */
function inBrowserTab(): boolean {
  return typeof location !== "undefined" && location.protocol === "https:";
}

/**
 * The portal page for a new password or a new account: Chinese for Chinese, English (/en/) for the other
 * languages. The portal's own address `/` follows the language chosen there before, so Chinese is asked for.
 */
function hxPortalPage(locale: string, page: "register" | "reset"): string {
  return locale === "zh" ? `/?lang=zh&${page}=1` : `/en/?${page}=1`;
}

/**
 * HXBot：登录第二步的“密码”输入框，代替邮件验证码的 8 格输入。
 * 每个人用自己注册时设置的密码登录；注册和找回密码在门户首页（服务器的 /）。
 */
export function HxPasswordInput(props: HxPasswordInputProps) {
  const { t, locale } = useText();
  const inputId = "account-login-password";
  const messageId = `${inputId}-message`;
  const locked = () => Boolean(props.disabled || props.status === "verifying" || props.status === "success");
  const message = () => {
    if (props.status === "success") return t("account.login.verified");
    if (props.status === "error") return props.errorMessage ?? t("account.login.hxPasswordIncorrect");
    if (props.status === "verifying") return t("account.otp.verifying");
    // The web app shows the two links below the button instead of this hint.
    return inBrowserTab() ? "" : t("account.login.hxPasswordHint");
  };

  return (
    <form
      class="account-login-email-field otp-input"
      data-status={props.status}
      novalidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!locked() && props.value.trim()) props.onSubmit(props.value);
      }}
    >
      <label class="sr-only" for={inputId}>
        {t("account.login.hxPasswordLabel")}
      </label>
      <Input
        id={inputId}
        type="password"
        autocomplete="current-password"
        autocapitalize="none"
        spellcheck={false}
        placeholder={t("account.login.hxPasswordLabel")}
        maxlength={HX_LOGIN_PASSWORD_MAX_LENGTH}
        value={props.value}
        readonly={locked()}
        aria-invalid={props.status === "error" ? "true" : undefined}
        aria-describedby={messageId}
        autofocus={props.autofocus}
        onValueChange={props.onChange}
      />
      <p
        id={messageId}
        class="otp-input-message"
        role={props.status === "error" ? "alert" : "status"}
        aria-live={props.status === "error" ? "assertive" : "polite"}
      >
        {message()}
      </p>
      <Button variant="default" type="submit" class="account-login-primary" disabled={locked() || !props.value.trim()}>
        <Show when={props.status === "verifying"} fallback={t("account.login.hxSignIn")}>
          <span class="account-login-button-spinner" aria-hidden="true" />
          {t("account.otp.verifying")}
        </Show>
      </Button>
      <Show when={inBrowserTab()}>
        <p class="otp-input-message">
          <a href={hxPortalPage(locale(), "reset")} target="_blank" rel="noopener noreferrer">
            {t("account.login.hxForgotPassword")}
          </a>
          {" · "}
          <a href={hxPortalPage(locale(), "register")} target="_blank" rel="noopener noreferrer">
            {t("account.login.hxCreateAccount")}
          </a>
        </p>
      </Show>
    </form>
  );
}
