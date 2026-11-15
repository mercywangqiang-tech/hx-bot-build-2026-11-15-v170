// HXBot additions to tool_search (v1.6.8, from the report of the agent 电脑整理, F5):
//
//   - An empty search lists every tool, by group. Before, it was refused, and the agent did not know
//     what to search for.
//   - Words that users and models use for a tool, in Chinese and in English, also find it. Search
//     matches whole words of names and descriptions, so "screenshot", "截图" or "关闭应用" found
//     nothing useful, and the agent said that HXBot cannot do it.
//   - A search with no match names the nearest tools, and says what to do next: an app on this
//     computer is not a tool, and a tool that this agent does not have is not missing from HXBot.
//
// tool-catalog.ts calls these three functions; the matching and the scores stay there.

/** The fields of a catalog entry that search reads. */
type HxSearchEntry = {
  readonly namespace: string;
  readonly tool: string;
  readonly name: string;
  readonly description: string;
};

/**
 * An answer of these additions. It names the fields of the usual answer that it does not use, so that
 * callers read `call` and `guidance` of any tool_search answer.
 */
type HxSearchAnswer = {
  readonly call?: undefined;
  readonly guidance?: undefined;
  readonly tools: { readonly name: string; readonly description: string }[];
  readonly note: string;
};

/**
 * Words for tools that their names and descriptions do not hold. Each phrase is looked for in the
 * text of the query (Chinese has no spaces between words), and each hit adds the words of the tool
 * names after it. The score of tool-catalog.ts then puts those tools first.
 */
const HX_SEARCH_PHRASES: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
  [
    ["截图", "截屏", "屏幕截图", "抓屏", "screenshot", "screen shot", "screencapture", "screen capture"],
    ["capture_screen"],
  ],
  [
    ["点击", "单击", "双击", "右键", "鼠标", "拖动", "滚动", "click", "mouse", "drag", "scroll"],
    ["computer_do", "computer_look"],
  ],
  [
    ["键盘", "打字", "输入文字", "快捷键", "按键", "keyboard", "typing", "hotkey", "shortcut", "keystroke"],
    ["computer_do"],
  ],
  [
    ["一步步", "步骤", "计划", "step by step", "plan the steps"],
    ["computer_plan", "computer_do"],
  ],
  [
    ["窗口", "界面", "控件", "按钮", "window", "outline", "button", "control"],
    ["computer_look", "computer_app"],
  ],
  // v1.6.9: app commands and scripts run in HXBot itself (computer_app, computer_run).
  [
    [
      "正在运行",
      "运行中的应用",
      "切到前台",
      "前台",
      "隐藏应用",
      "分屏",
      "最大化",
      "摆放窗口",
      "running apps",
      "bring to front",
      "hide app",
      "split screen",
      "maximize",
      "tile window",
    ],
    ["computer_app"],
  ],
  [
    ["菜单", "菜单栏", "菜单命令", "menu", "menu bar", "menu command"],
    ["computer_app", "computer_do"],
  ],
  [
    [
      "applescript",
      "jxa",
      "osascript",
      "快捷指令",
      "自动化脚本",
      "powershell",
      "office",
      "excel",
      "shortcuts",
      "automation script",
    ],
    ["computer_run"],
  ],
  [
    ["打开应用", "打开软件", "启动应用", "运行应用", "open app", "launch", "start app"],
    ["computer_open", "computer_find"],
  ],
  [
    ["关闭应用", "退出应用", "关掉", "退出", "强制退出", "quit", "close app", "exit app", "force quit"],
    ["computer_app", "computer_do"],
  ],
  [
    ["默认浏览器", "默认应用", "默认邮件", "打开方式", "default browser", "default app", "default mail", "open with"],
    ["computer_app", "computer_open"],
  ],
  [
    ["系统设置", "设置页", "偏好设置", "system settings", "preferences", "control panel"],
    ["computer_set", "computer_open"],
  ],
  [["深色模式", "暗色", "亮度", "音量", "壁纸", "dark mode", "brightness", "volume", "wallpaper"], ["computer_set"]],
  [["找应用", "装了什么", "已安装", "installed", "find app"], ["computer_find"]],
  // v1.6.8 (F6): installing a downloaded app is HXBot's job, not the model's shell.
  [
    [
      "安装应用",
      "安装软件",
      "装应用",
      "应用程序文件夹",
      "install app",
      "install the app",
      "applications folder",
      "dmg",
    ],
    ["computer_install"],
  ],
];

function hxWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The queries of tool_search arguments, as the model sent them, before any check. */
function hxQueries(args: unknown): string[] | null {
  if (typeof args !== "object" || args === null) return null;
  const record: { readonly queries?: unknown; readonly query?: unknown } = args;
  const queries = Array.isArray(record.queries) ? record.queries : [];
  const all = [...queries, ...(record.query === undefined ? [] : [record.query])];
  return all.every((query) => typeof query === "string") ? all : null;
}

/** A query without quotes, brackets and spaces at its ends, such as `"screenshot"` or 「截图」. */
function hxBare(query: string): string {
  return query
    .trim()
    .replace(/^["'`“”‘’「」『』《》()[\]{}]+|["'`“”‘’「」『』《》()[\]{}]+$/gu, "")
    .trim();
}

/** The words that a search also uses: the name words of the tools that its phrases name. */
export function hxToolSearchWords(queries: readonly string[]): string[] {
  const text = queries.map((query) => hxBare(query).toLowerCase()).join(" ");
  return HX_SEARCH_PHRASES.flatMap(([phrases, tools]) =>
    phrases.some((phrase) => text.includes(phrase)) ? tools.flatMap(hxWords) : [],
  );
}

/** The catalog as `namespace.{a, b}` groups, the same form as in the description of tool_search. */
function hxGroups(catalog: readonly HxSearchEntry[]): string[] {
  const groups = new Map<string, string[]>();
  for (const entry of catalog) groups.set(entry.namespace, [...(groups.get(entry.namespace) ?? []), entry.tool]);
  return [...groups].map(([namespace, tools]) => `${namespace}.{${tools.join(", ")}}`);
}

const EMPTY_NOTE =
  'This is every tool, by group. Search with words, such as "screenshot", "click" or "quit app", to get the descriptions and input schemas of the best matches.';

/**
 * The answer to a search without words: `{}`, an empty query, or only quotes. `null` for a search
 * with words, which goes on to the usual matching.
 */
export function hxEmptyToolSearch(
  args: unknown,
  catalog: readonly HxSearchEntry[],
): (HxSearchAnswer & { readonly groups: string[] }) | null {
  const queries = hxQueries(args ?? {});
  if (queries === null || queries.some((query) => hxBare(query) !== "")) return null;
  return { tools: [], groups: hxGroups(catalog), note: EMPTY_NOTE };
}

/** How near a word is to a tool: shared start, one inside the other, or one or two letters apart. */
function hxNear(word: string, target: string): boolean {
  if (word.length < 3 || target.length < 3) return word === target;
  if (target.startsWith(word.slice(0, 4)) || word.startsWith(target.slice(0, 4))) return true;
  if (target.includes(word) || word.includes(target)) return true;
  return hxDistance(word, target) <= (Math.min(word.length, target.length) > 6 ? 2 : 1);
}

function hxDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1)
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length] ?? 0;
}

/** Up to three tools whose names come nearest to the words of the search. */
function hxNearest(terms: ReadonlySet<string>, catalog: readonly HxSearchEntry[]): HxSearchEntry[] {
  return catalog
    .map((entry, index) => {
      const nameWords = hxWords(entry.tool);
      const score = [...terms].filter((term) => nameWords.some((word) => hxNear(term, word))).length;
      return { entry, index, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .map(({ entry }) => entry);
}

/**
 * The answer to a search that matches no tool of this agent: the nearest tools, and a note that says
 * whether HXBot has the tool for another agent only, or has no such tool and what to use instead.
 */
export function hxNoToolMatch(
  queries: readonly string[],
  terms: ReadonlySet<string>,
  catalog: readonly HxSearchEntry[],
  everyTool: readonly HxSearchEntry[],
): HxSearchAnswer {
  const own = new Set(catalog.map((entry) => entry.name));
  const elsewhere = everyTool.filter(
    (entry) => !own.has(entry.name) && hxWords(`${entry.tool} ${entry.description}`).some((word) => terms.has(word)),
  );
  const nearest = hxNearest(terms, catalog);
  const asked = queries.map((query) => `"${hxBare(query)}"`).join(", ");
  const note =
    elsewhere.length > 0
      ? `No tool of this agent matches ${asked}. ${elsewhere.map((entry) => entry.name).join(", ")} is not for this agent's provider: use the provider's own tool for it.`
      : `No tool matches ${asked}: HXBot has no tool by these words. An app on this computer is not a tool: find it with hxbot.computer_find, open it with hxbot.computer_open, and work in it with hxbot.computer_look and hxbot.computer_do. A website with no tool of its own is reached through hxbot_browser. Search again with other words, or with an empty query for the full list.`;
  return {
    tools: nearest.map((entry) => ({ name: entry.name, description: entry.description.slice(0, 180) })),
    note,
  };
}
