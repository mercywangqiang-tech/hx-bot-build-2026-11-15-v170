/**
 * HXBot：桌面端更新的规则。
 *
 * v1.7.1 起（用户 2026-11-18：“以后大版本都不做强制更新，只需要在打开 hxbot 客户端后直接更新即可”）：
 * - 不再按版本号强制：大版本（第二段变了，如 0.67.x → 0.68.0）和小版本一样，不挡住窗口，账号服务也不拒绝。
 * - 打开 HXBot 时找到的新版本自动下载、装好，在助手都空闲时重启进入新版，不弹窗、不用点
 *   （右下角提示“HXBot 正在安装更新”，可以取消这一次）。用着用着才找到的新版本，下次打开时再装。
 * - 只有账号服务拒绝了这个版本（426；只在 hx/brand.json 的 minimumVersions 明确写了最低版本时）才必须装：
 *   窗口挡住，点“立即更新”；没人点时 10 分钟后在空闲时自动安装。
 *
 * 新功能写在 hx/release-notes.json，打包时写进 latest.yml 的 releaseNotes（中文和英文，JSON）。
 */

/** The fields of the update status that the rule reads. */
export interface HxUpdateFacts {
  currentVersion: string;
  availableVersion: string | null;
  /** The account service refused this version: it is below the minimum. */
  hxRequired?: boolean;
}

/**
 * True when the new version must be installed before HXBot can be used: only when the account service refused
 * this version (426). A new major version alone no longer requires it (v1.7.1).
 */
export function hxUpdateIsRequired(facts: HxUpdateFacts): boolean {
  return facts.hxRequired === true;
}

/** How long after HXBot opens a new version that it finds counts as found at the opening. */
export const HX_OPENING_MS = 10 * 60_000;

/**
 * The test for an automatic install: true for an update that the account service requires, and for one that HXBot
 * found as it opened (within HX_OPENING_MS of `startedAt`). A version first seen later waits for the next opening.
 */
export function hxInstallsByItself(
  startedAt: number,
  status: () => HxUpdateFacts,
  now: () => number = Date.now,
): () => boolean {
  let seen: string | null = null;
  let atOpening = false;
  return () => {
    const facts = status();
    if (hxUpdateIsRequired(facts)) return true;
    if (!facts.availableVersion) return false;
    if (facts.availableVersion !== seen) {
      seen = facts.availableVersion;
      atOpening = now() - startedAt <= HX_OPENING_MS;
    }
    return atOpening;
  };
}

/**
 * The wait before the automatic restart: 10 minutes for a required update, so the user can choose Update now first,
 * and a few seconds for one found at the opening.
 */
export function hxAutomaticGraceMs(facts: HxUpdateFacts): number {
  return hxUpdateIsRequired(facts) ? 10 * 60_000 : 5_000;
}

/**
 * The notes of a release as one string, from electron-updater's `releaseNotes` (a string, or a list of
 * `{ version, note }` for some providers), or null when there are none.
 */
export function hxReleaseNotesText(releaseNotes: unknown): string | null {
  if (typeof releaseNotes === "string") return releaseNotes.trim() || null;
  if (Array.isArray(releaseNotes)) {
    for (const entry of releaseNotes) {
      const note = entry && typeof entry === "object" && "note" in entry ? entry.note : null;
      if (typeof note === "string" && note.trim()) return note.trim();
    }
  }
  return null;
}

/**
 * The lines to show for a language: the notes are JSON `{ "zh": [...], "en": [...] }`; Chinese for a Chinese
 * interface, English for every other language. Plain text is shown line by line.
 */
export function hxReleaseNoteLines(notes: string | null | undefined, language: string): string[] {
  if (!notes) return [];
  const clean = (lines: unknown): string[] =>
    Array.isArray(lines) ? lines.filter((line): line is string => typeof line === "string" && line.trim() !== "") : [];
  try {
    const parsed = JSON.parse(notes);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const english = clean("en" in parsed ? parsed.en : null);
      const chinese = clean("zh" in parsed ? parsed.zh : null);
      return language.toLowerCase().startsWith("zh") && chinese.length > 0 ? chinese : english;
    }
  } catch {
    // Not JSON: plain text.
  }
  return notes
    .split(/\r?\n/u)
    .map((line) => line.replace(/^[-*•]\s*/u, "").trim())
    .filter((line) => line !== "");
}
