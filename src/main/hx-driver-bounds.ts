import { isDynamicRecord } from "@hxbot/contracts/runtime-values";

// HXBot 不打扰其他应用（v1.7.0，F10）：助手读一个窗口时有上限。
//
// 用户 2026-11-14 选了“别的应用变卡”“别的应用卡死”。读窗口（get_window_state）要逐个问那个应用的每个界面元素：
// 一个大应用（浏览器、Xcode、Word 的长文档）有上万个元素，应用在回答的这段时间里卡住。助手的工具没写上限时，
// HXBot 补上和逐步操作一样的上限：最多 1500 个元素、最多 3 秒。助手自己写了的上限不改。

/** The most elements one read asks of an app: the same as the step tools (steps.ts). */
export const HX_READ_MAX_ELEMENTS = 1500;
/** The longest one read may keep an app busy. */
export const HX_READ_TIMEOUT_MS = 3000;

/**
 * The request line with the bounds added, or null when it needs none: a line that is no
 * `get_window_state` call, or a call that names both bounds itself.
 */
export function hxBoundedRequest(line: string): string | null {
  if (!line.includes("get_window_state")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isDynamicRecord(parsed) || parsed.method !== "call" || parsed.name !== "get_window_state") return null;
  const args = isDynamicRecord(parsed.args) ? parsed.args : {};
  if (args.max_elements !== undefined && args.timeout_ms !== undefined) return null;
  return JSON.stringify({
    ...parsed,
    args: {
      ...args,
      max_elements: args.max_elements ?? HX_READ_MAX_ELEMENTS,
      timeout_ms: args.timeout_ms ?? HX_READ_TIMEOUT_MS,
    },
  });
}
