/**
 * HXBot：手机端发出的每个请求都带 `X-HXBot-Client: ios/版本` 或 `android/版本`。账号服务据此拒绝过旧的
 * 版本（apps/auth-api/src/server/hx-client-version.ts），手机端因此必须更新。
 */
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";

const HX_CLIENT_HEADER = "X-HXBot-Client";

/** The headers of a request as a plain record, with the client header added. */
export function hxClientHeaders(headers: unknown, client: string): Record<string, string> {
  const merged: Record<string, string> = {};
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => {
      merged[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const pair of headers) {
      if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string") merged[pair[0]] = pair[1];
    }
  } else if (isDynamicRecord(headers)) {
    for (const [key, value] of Object.entries(headers)) if (typeof value === "string") merged[key] = value;
  }
  for (const key of Object.keys(merged)) if (key.toLowerCase() === HX_CLIENT_HEADER.toLowerCase()) delete merged[key];
  merged[HX_CLIENT_HEADER] = client;
  return merged;
}

/** `ios/1.5.0`: the platform and the version of this app; null when the version is not known. */
export function hxClientValue(platform: string, version: string | null): string | null {
  if (!version || !/^\d+(\.\d+){1,3}$/u.test(version)) return null;
  return `${platform === "ios" ? "ios" : "android"}/${version}`;
}

/** True when version `a` is older than `b` (numeric parts, missing parts are 0). */
export function hxVersionOlder(a: string, b: string): boolean {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}
