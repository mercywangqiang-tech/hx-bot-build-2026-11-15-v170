import { isDynamicRecord } from "./runtime-values";

/**
 * HXBot: deleting one's own HXBot Account (注销账号). The desktop app, the web app and the phone app send
 * POST /api/browser/hx/account/delete with `{ confirm }`: the password, or the email for an account that
 * has no password (it signs in with another service). The account service deletes the account at once.
 */
export const HX_DELETE_ACCOUNT_PATH = "/api/browser/hx/account/delete";

/** What the deletion came to, for the apps to show. */
export type HxDeleteAccountOutcome = "deleted" | "incorrect_password" | "confirm_with_email" | "failed";

/** Reads the account service's answer: success, the reason of a refusal that the apps show, or "failed". */
export function hxDeleteAccountOutcome(ok: boolean, body: unknown): HxDeleteAccountOutcome {
  if (ok) return "deleted";
  const error = isDynamicRecord(body) ? body.error : null;
  const code = isDynamicRecord(error) ? error.code : null;
  return code === "incorrect_password" || code === "confirm_with_email" ? code : "failed";
}
