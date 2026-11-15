/**
 * HXBot：桌面端更新的规则（v1.6.3 起，用户 2026-11-13：“可以更新，可以不更新……到某个大版本，要求必须更新”）。
 *
 * - 平时的新版本可以不装：窗口里列出新功能，“立即更新”或“以后再说”。
 * - 版本号第二段变了（0.67.x → 0.68.0）就必须装：窗口挡住，不能关；没人点时 10 分钟后在空闲时自动安装。
 * - 账号服务拒绝了这个版本（426，最低版本见 apps/auth-api/src/server/hx-client-version.ts）时也必须装：
 *   发版时可以把某个小版本单独设成必须更新（hx/brand.json 的 minimumVersions）。
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

/** `major.minor` of a version such as 0.67.2, or null when it is not one. */
export function hxMajorMinor(version: string): string | null {
  const match = /^(\d+)\.(\d+)\.\d+/u.exec(version.trim());
  return match ? `${Number(match[1])}.${Number(match[2])}` : null;
}

/** True when the new version must be installed before HXBot can be used. */
export function hxUpdateIsRequired(facts: HxUpdateFacts): boolean {
  if (facts.hxRequired) return true;
  if (!facts.availableVersion) return false;
  const current = hxMajorMinor(facts.currentVersion);
  const available = hxMajorMinor(facts.availableVersion);
  return current !== null && available !== null && current !== available;
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
