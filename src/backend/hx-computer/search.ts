// HXBot 电脑操控：在目录里找。只做文字匹配，不调用模型：名称完全相同最高，其次开头相同、包含、
// 一句话里提到了名称。拿不准（前两名分数接近）时不替模型做决定，把候选都交回去。
// “打开蓝牙设置”这样的说法里，“打开”和“设置”不指向具体的东西：去掉它们再比一次（“蓝牙”），
// 并且一句话里顺带出现的“设置”不算提到了“设置”这个应用。
import type { HxCatalogEntry, HxCatalogKind } from "@hxbot/contracts/hx-computer";

export interface HxSearchHit {
  entry: HxCatalogEntry;
  score: number;
}

const EXACT = 100;
const STARTS = 80;
const CONTAINS = 60;
const MENTIONED = 45;
const WORDS = 40;
/** A hit that names the entry, and is this far ahead of the next one, is acted on without asking. */
const SURE_LEAD = 10;
/**
 * A short name of Latin letters inside a sentence is a coincidence more often than a mention: the
 * apps of macOS 26 hold one that is inside "no such app". Such a name is still found on its own.
 */
const MIN_MENTION_LATIN = 4;
const MIN_MENTION_OTHER = 2;

/** Lower case, full-width forms folded, and everything that is not a letter or a digit dropped. */
export function hxNormalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function words(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/**
 * Names that say "the settings", not which thing: 蓝牙设置 is about Bluetooth, not about the app
 * called 设置. Inside a longer phrase such a name is not a mention. Normalized.
 */
const GENERIC_NAMES: ReadonlySet<string> = new Set([
  "设置",
  "系统设置",
  "偏好设置",
  "系统偏好设置",
  "settings",
  "setting",
  "systemsettings",
  "systempreferences",
  "preferences",
]);
/** What to cut out of a phrase in Chinese to get at the name in it; the longer ones first. */
const GENERIC_PARTS = ["系统偏好设置", "系统设置", "偏好设置", "设置"];
const FILLER_PARTS = [
  "请帮我",
  "帮我",
  "帮忙",
  "麻烦",
  "给我",
  "打开",
  "开启",
  "关闭",
  "关掉",
  "启动",
  "运行",
  "进入",
  "一下",
  "请",
  "把",
  "的",
];
/** The same for a phrase in English, by whole words. */
const GENERIC_WORDS: ReadonlySet<string> = new Set(["settings", "setting", "preferences", "preference"]);
const FILLER_WORDS: ReadonlySet<string> = new Set([
  "please",
  "open",
  "launch",
  "run",
  "show",
  "go",
  "to",
  "the",
  "my",
  "turn",
  "on",
  "off",
  "set",
  "change",
  "enable",
  "disable",
]);
/** A phrase with its filler words cut out scores this much lower than the phrase as it was given. */
const FILLER_PENALTY = 2;
const GENERIC_PENALTY = 5;
/** What is left of a phrase must be at least this long to be searched for. */
const MIN_CORE = 2;

function mentionable(name: string): boolean {
  return name.length >= (/^[\da-z]+$/u.test(name) ? MIN_MENTION_LATIN : MIN_MENTION_OTHER);
}

function scoreName(query: string, queryWords: readonly string[], name: string): number {
  const candidate = hxNormalize(name);
  if (!candidate) return 0;
  if (candidate === query) return EXACT;
  if (candidate.startsWith(query)) return STARTS + Math.min(10, (10 * query.length) / candidate.length);
  if (candidate.includes(query)) return CONTAINS + Math.min(10, (10 * query.length) / candidate.length);
  // "把深色模式打开" names the setting 深色模式; the longer the name inside the sentence, the surer.
  if (mentionable(candidate) && !GENERIC_NAMES.has(candidate) && query.includes(candidate)) {
    return MENTIONED + Math.min(14, candidate.length * 2);
  }
  if (queryWords.length > 1 && queryWords.every((word) => candidate.includes(word))) return WORDS;
  return 0;
}

interface Variant {
  query: string;
  words: string[];
  penalty: number;
}

/** The phrase without its filler words and, with `generic`, without the words for "settings". */
function core(text: string, generic: boolean): string[] {
  const kept: string[] = [];
  for (const word of words(text)) {
    if (/^[\da-z]+$/u.test(word)) {
      if (FILLER_WORDS.has(word) || (generic && GENERIC_WORDS.has(word))) continue;
      kept.push(word);
      continue;
    }
    let rest = word;
    for (const part of generic ? [...GENERIC_PARTS, ...FILLER_PARTS] : FILLER_PARTS) rest = rest.split(part).join("");
    if (rest) kept.push(rest);
  }
  return kept;
}

/** The phrase as it was given, and what is left of it without filler words and without "settings". */
function variants(text: string): Variant[] {
  const list: Variant[] = [{ query: hxNormalize(text), words: words(text), penalty: 0 }];
  for (const [generic, penalty] of [
    [false, FILLER_PENALTY],
    [true, GENERIC_PENALTY],
  ] as const) {
    const kept = core(text, generic);
    const query = kept.join("");
    if (query.length >= MIN_CORE && !list.some((variant) => variant.query === query)) {
      list.push({ query, words: kept, penalty });
    }
  }
  return list;
}

export interface HxSearchOptions {
  kinds?: readonly HxCatalogKind[];
  limit?: number;
}

/** The entries that answer to the query, best first. An empty query finds nothing. */
export function hxSearch(
  entries: readonly HxCatalogEntry[],
  queryText: string,
  options: HxSearchOptions = {},
): HxSearchHit[] {
  if (!hxNormalize(queryText)) return [];
  const forms = variants(queryText);
  const hits: HxSearchHit[] = [];
  for (const entry of entries) {
    if (options.kinds && !options.kinds.includes(entry.kind)) continue;
    let score = 0;
    for (const name of [entry.title, ...entry.names]) {
      for (const form of forms) {
        const found = scoreName(form.query, form.words, name);
        if (found > 0) score = Math.max(score, found - form.penalty);
      }
    }
    if (score > 0) hits.push({ entry, score });
  }
  hits.sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title));
  return hits.slice(0, options.limit ?? 8);
}

/** The one entry the query means, or null when the best hit is weak or another is nearly as good. */
export function hxSureHit(hits: readonly HxSearchHit[]): HxCatalogEntry | null {
  const [first, second] = hits;
  if (!first || first.score < MENTIONED) return null;
  if (second && first.score - second.score < SURE_LEAD) return null;
  return first.entry;
}

/** Spaced pinyin as one word and as initials: "lan ya" gives "lanya" and "ly". */
export function hxPinyinNames(spaced: string): string[] {
  const syllables = spaced.split(/\s+/u).filter((part) => part.length > 0);
  if (syllables.length === 0) return [];
  const full = syllables.join("");
  const initials = syllables.map((part) => part[0]).join("");
  return initials.length >= 2 && initials !== full ? [full, initials] : [full];
}
