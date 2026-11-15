import { fetch as expoFetch } from "expo/fetch";
import * as Application from "expo-application";
import { Platform } from "react-native";
import { hxClientHeaders, hxClientValue } from "./hx-client-header";
import { withRequestLog } from "./support-log";

/** HXBot: this app and its version, on each request (hx-client-header.ts). */
const hxClient = hxClientValue(Platform.OS, Application.nativeApplicationVersion);
const hxFetch: typeof expoFetch = (input, init) => {
  if (!hxClient) return expoFetch(input, init);
  const base = init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined);
  return expoFetch(input, { ...init, headers: hxClientHeaders(base, hxClient) });
};

/** `expo/fetch` with a support log line for each request. Import it instead of `expo/fetch`. */
export const fetch = withRequestLog(hxFetch);
