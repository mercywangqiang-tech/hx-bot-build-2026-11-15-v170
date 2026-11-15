/**
 * HXBot：桌面端发给账号服务的每个请求都带 `X-HXBot-Client: desktop/版本`。账号服务据此拒绝过旧的版本
 * （apps/auth-api/src/server/hx-client-version.ts），客户端因此必须更新。被拒绝（426）时马上找新版本，
 * “HXBot 有新版本”的对话框就弹出来，不用等下一次定时检查。
 */
export const HX_CLIENT_HEADER = "X-HXBot-Client";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** The answer of the account service to an outdated app (apps/auth-api/src/server/hx-client-version.ts). */
const OUTDATED = 426;

/**
 * `fetcher` with the client header on each request. `onOutdated` runs when the account service answers
 * that this version is too old; the updater starts later than the account runtime, so it is read on each answer.
 */
export function hxClientFetch(
  fetcher: Fetcher,
  version: string,
  onOutdated: () => (() => void) | null = () => null,
): Fetcher {
  const value = `desktop/${version}`;
  return async (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(HX_CLIENT_HEADER, value);
    const response = await fetcher(input, { ...init, headers });
    if (response.status === OUTDATED) onOutdated()?.();
    return response;
  };
}

/** Runs `run` at most once per `intervalMs`: many requests are refused at once when the app is outdated. */
export function hxAtMostEvery(intervalMs: number, run: () => void, now: () => number = Date.now): () => void {
  let last: number | null = null;
  return () => {
    const time = now();
    if (last !== null && time - last < intervalMs) return;
    last = time;
    run();
  };
}
