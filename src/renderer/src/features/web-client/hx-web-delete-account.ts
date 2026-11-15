import {
  HX_DELETE_ACCOUNT_PATH,
  type HxDeleteAccountOutcome,
  hxDeleteAccountOutcome,
} from "@hxbot/contracts/hx-delete-account";

/**
 * HXBot: deletes the account of the web app's session (注销账号). The session cookie goes with the request,
 * which comes from the server's own page. After the deletion the browser goes to the portal, signed out.
 */
export async function hxDeleteWebAccount(
  confirm: string,
  fetcher: typeof fetch = fetch,
  leave: () => void = () => location.assign("/"),
): Promise<HxDeleteAccountOutcome> {
  const response = await fetcher(HX_DELETE_ACCOUNT_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-HXBot-Browser": "1" },
    body: JSON.stringify({ confirm }),
  });
  const outcome = hxDeleteAccountOutcome(response.ok, response.ok ? null : await response.json().catch(() => null));
  if (outcome === "deleted") leave();
  return outcome;
}
