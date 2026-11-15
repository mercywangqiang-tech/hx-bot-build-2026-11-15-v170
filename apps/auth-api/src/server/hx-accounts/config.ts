/**
 * HXBot：注册账号的设置，全部来自服务器的 .env（容器入口脚本写进运行变量）。
 *
 *   HX_EMAIL_VERIFICATION   注册、找回密码时给邮箱发验证码。默认开启，off 关闭（关闭后不能自助找回密码）
 *   HX_PHONE_VERIFICATION   注册时用短信验证码验证手机号。默认开启，off 关闭
 *   HX_SMS_*                阿里云短信：AccessKey、签名、模板
 *   HX_GOOGLE_* 等          六家第三方登录。一家的各项都填好，这一家的按钮才出现
 *   HX_LOGIN_PASSWORD       以前大家共用的登录口令。只在过渡期使用：老账号第一次设置自己的密码时用它证明身份
 */

export type HxProviderId = "google" | "apple" | "wechat" | "alipay" | "facebook" | "douyin";

/** What an emailed code is for: the email says so. */
export type HxCodePurpose = "register" | "reset";

/** The language of the page a code was asked for on: Chinese gets a bilingual email, English gets English only. */
export type HxMailLanguage = "zh" | "en";

export function hxMailLanguage(value: unknown): HxMailLanguage {
  return value === "en" ? "en" : "zh";
}

export const HX_PROVIDER_IDS: readonly HxProviderId[] = ["wechat", "alipay", "douyin", "apple", "google", "facebook"];

export interface HxSmsConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
}

export interface HxProviderSecrets {
  google?: { clientId: string; clientSecret: string };
  apple?: { serviceId: string; teamId: string; keyId: string; privateKey: string };
  wechat?: { appId: string; appSecret: string };
  alipay?: { appId: string; privateKey: string };
  facebook?: { appId: string; appSecret: string };
  douyin?: { clientKey: string; clientSecret: string };
}

export interface HxAccountsConfig {
  emailVerification: boolean;
  phoneVerification: boolean;
  sms: HxSmsConfig | null;
  providers: HxProviderSecrets;
  /** The password that every person shared before accounts had their own. Null once it is removed. */
  sharedPassword: string | null;
}

type Env = Readonly<Record<string, string | undefined>>;

function value(env: Env, name: string): string {
  return env[name]?.trim() ?? "";
}

function switchedOn(env: Env, name: string): boolean {
  return value(env, name).toLowerCase() !== "off";
}

/** The named values in order, or nothing when one is missing: a provider with half its settings stays off. */
function all(env: Env, ...names: string[]): string[] | null {
  const values = names.map((name) => value(env, name));
  return values.every((item) => item !== "") ? values : null;
}

export function hxAccountsConfig(env: Env): HxAccountsConfig {
  const providers: HxProviderSecrets = {};
  const google = all(env, "HX_GOOGLE_CLIENT_ID", "HX_GOOGLE_CLIENT_SECRET");
  if (google) {
    const [clientId = "", clientSecret = ""] = google;
    providers.google = { clientId, clientSecret };
  }
  const apple = all(env, "HX_APPLE_SERVICE_ID", "HX_APPLE_TEAM_ID", "HX_APPLE_KEY_ID", "HX_APPLE_PRIVATE_KEY");
  if (apple) {
    const [serviceId = "", teamId = "", keyId = "", privateKey = ""] = apple;
    providers.apple = { serviceId, teamId, keyId, privateKey };
  }
  const wechat = all(env, "HX_WECHAT_APP_ID", "HX_WECHAT_APP_SECRET");
  if (wechat) {
    const [appId = "", appSecret = ""] = wechat;
    providers.wechat = { appId, appSecret };
  }
  const alipay = all(env, "HX_ALIPAY_APP_ID", "HX_ALIPAY_PRIVATE_KEY");
  if (alipay) {
    const [appId = "", privateKey = ""] = alipay;
    providers.alipay = { appId, privateKey };
  }
  const facebook = all(env, "HX_FACEBOOK_APP_ID", "HX_FACEBOOK_APP_SECRET");
  if (facebook) {
    const [appId = "", appSecret = ""] = facebook;
    providers.facebook = { appId, appSecret };
  }
  const douyin = all(env, "HX_DOUYIN_CLIENT_KEY", "HX_DOUYIN_CLIENT_SECRET");
  if (douyin) {
    const [clientKey = "", clientSecret = ""] = douyin;
    providers.douyin = { clientKey, clientSecret };
  }
  const sms = all(env, "HX_SMS_ACCESS_KEY_ID", "HX_SMS_ACCESS_KEY_SECRET", "HX_SMS_SIGN_NAME", "HX_SMS_TEMPLATE_CODE");
  const [accessKeyId = "", accessKeySecret = "", signName = "", templateCode = ""] = sms ?? [];
  return {
    emailVerification: switchedOn(env, "HX_EMAIL_VERIFICATION"),
    phoneVerification: switchedOn(env, "HX_PHONE_VERIFICATION"),
    sms: sms ? { accessKeyId, accessKeySecret, signName, templateCode } : null,
    providers,
    sharedPassword: value(env, "HX_LOGIN_PASSWORD") || null,
  };
}

/** The providers whose buttons the sign-in pages show, in the order they show them. */
export function hxEnabledProviders(config: HxAccountsConfig): HxProviderId[] {
  return HX_PROVIDER_IDS.filter((id) => config.providers[id] !== undefined);
}
