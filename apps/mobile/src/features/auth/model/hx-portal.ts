/** The portal of the HXBot server: people create an account and reset a password there. */
const HX_PORTAL = "https://bot.hxallai.com";

/**
 * HXBot: the portal page for a new account or a new password. Chinese for Chinese, English for the other
 * languages. The portal's own address `/` follows the language chosen there before, so Chinese is asked for.
 */
export function hxPortalUrl(locale: string, page: "register" | "reset"): string {
  return locale === "zh" ? `${HX_PORTAL}/?lang=zh&${page}=1` : `${HX_PORTAL}/en/?${page}=1`;
}
