import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/solid-router";
import { requireWorkerBindings } from "../../server/types";

/**
 * HXBot: the iOS app of HXBot opens the invitation links of this site (`/join`). Its app ID is
 * the Apple team ID of 弘犀智能 and the bundle ID `com.hxallai.bot`; the team ID is `HX_APPLE_TEAM_ID` in the
 * server's .env. Without it no app opens these links and they open in the browser. No app of HXBot is named.
 */
const BUNDLE_ID = "com.hxallai.bot";
const TEAM_ID = /^[A-Z0-9]{10}$/u;

function createAppleAppSiteAssociationResponse(): Response {
  const team = (requireWorkerBindings(env).HX_APPLE_TEAM_ID ?? "").trim();
  const details = TEAM_ID.test(team) ? [{ appID: `${team}.${BUNDLE_ID}`, paths: ["/join"] }] : [];
  return new Response(JSON.stringify({ applinks: { apps: [], details } }), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export const Route = createFileRoute("/.well-known/apple-app-site-association")({
  server: {
    handlers: {
      GET: createAppleAppSiteAssociationResponse,
    },
  },
});
