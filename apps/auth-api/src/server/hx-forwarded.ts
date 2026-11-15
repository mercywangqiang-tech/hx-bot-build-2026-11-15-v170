/**
 * HXBot: the account Worker runs in workerd (`wrangler dev --local`) on the 弘犀 server,
 * behind nginx. nginx ends TLS and sets `X-HX-Forwarded-Proto: https` on every request it passes on.
 *
 * workerd then sees an `http://` address, and the local proxy of wrangler rewrites every header value
 * that names this host to `http://` as well, the browser's `Origin` included. Without this the site
 * would redirect to https in a loop, and the browser client's same-origin writes would be refused.
 *
 * Only a same-host `Origin` or `Referer` is moved back to https. nginx serves this host on https only
 * (plain http is a redirect), and the Worker port listens on 127.0.0.1, so a same-host value always
 * came from an https page of this host. A cross-site `Origin` is left alone and still refused.
 */
export function hxForwardedRequest(request: Request): Request {
  if (request.headers.get("x-hx-forwarded-proto") !== "https") return request;
  const url = new URL(request.url);
  if (url.protocol === "https:") return request;
  url.protocol = "https:";
  url.port = "";
  const next = new Request(url.toString(), request);
  const insecureOrigin = `http://${url.host}`;
  if (next.headers.get("Origin") === insecureOrigin) next.headers.set("Origin", url.origin);
  const referer = next.headers.get("Referer");
  if (referer?.startsWith(`${insecureOrigin}/`))
    next.headers.set("Referer", url.origin + referer.slice(insecureOrigin.length));
  return next;
}
