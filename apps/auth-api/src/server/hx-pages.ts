import { HXBOT_SITE_URL } from "../lib/site-metadata";

/**
 * HXBot: the account Worker shows only the pages that the research edition uses: the web app
 * (`/app`), invitations (`/join`), and the return pages of Slack, Discord and billing. Every other
 * page of the bundled HXBot website (home, download, pricing, guides, news, marketplace, changelog,
 * legal pages and the rest) answers a page view with a redirect to the HXBot portal.
 *
 * nginx allows only the same addresses (`hx/server/nginx/hxbot.conf`). This is the same rule inside
 * the Worker, so the old site never shows, even for a request that reaches the Worker another way.
 * The research edition's own terms, privacy policy and guide are static pages that nginx serves from
 * the portal (`/terms/`, `/privacy/`, `/guide/` and their `/en/` versions); the old addresses of those
 * pages lead there.
 * Only page views are redirected, that is a GET or HEAD that accepts HTML. API calls, the cron
 * trigger and requests between the services are not page views and pass unchanged.
 */
const SERVED_PREFIX =
  /^\/(?:api|v1|v2|oauth|health|scim|\.well-known|_serverFn|app|join|slack|discord|billing|assets|cdn-cgi)(?:\/|$)/u;
const SERVED_FILE =
  /^\/(?:favicon\.ico|favicon-32x32\.png|apple-touch-icon\.png|icon-192x192\.png|icon-512x512\.png|site\.webmanifest|robots\.txt)$/u;
const PLUGIN_ICON_PREFIX = "/plugins/icon/";
/** Old addresses of legal pages and guides, and the portal page that replaces each. */
const RESEARCH_PAGES: readonly (readonly [RegExp, string])[] = [
  [/^\/(?:terms|terms-of-service|tos|legal\/terms)\/?$/u, "terms/"],
  [/^\/(?:privacy|privacy-policy|legal\/privacy|dpa)\/?$/u, "privacy/"],
  [/^\/(?:guide|guides|docs|help)(?:\/.*)?$/u, "guide/"],
];

export function hxResearchPageRedirect(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (!(request.headers.get("accept") ?? "").includes("text/html")) return null;
  const path = new URL(request.url).pathname;
  if (SERVED_PREFIX.test(path) || SERVED_FILE.test(path) || path.startsWith(PLUGIN_ICON_PREFIX)) return null;
  const portal = new URL(HXBOT_SITE_URL).origin;
  const english = path === "/en" || path.startsWith("/en/");
  const rest = english ? path.slice(3) || "/" : path;
  const page = RESEARCH_PAGES.find(([pattern]) => pattern.test(rest))?.[1] ?? "";
  return new Response(null, {
    status: 302,
    headers: { location: `${portal}/${english ? "en/" : ""}${page}`, "cache-control": "no-store" },
  });
}
