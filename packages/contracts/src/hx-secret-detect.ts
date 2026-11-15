// HXBot：在聊天框发送前识别像密码、口令、密钥的内容，提醒客户改存保密箱（桌面端、网页版、手机端共用）。
//
// The check is deliberately narrow: a false alarm on every message would teach people to press
// "Send anyway" without reading. It looks for three things:
//  - a key in a known format (OpenAI, Anthropic, GitHub, GitLab, Slack, AWS, Google, Stripe, Hugging
//    Face, xAI, a JSON Web Token, a private key block);
//  - a password, passcode or token named as such, followed by its value ("密码是 Abc12345",
//    "password: hunter2!", "token=…");
//  - a long random-looking string of letters and digits, as an API key often is.
// It never sends the text anywhere. It only reports what kind of secret it saw.

export type HxSecretKind = "key" | "password" | "private-key" | "token";

export interface HxSecretMatch {
  kind: HxSecretKind;
  /** Where the secret value is in the text, so the screen could point at it. */
  start: number;
  end: number;
}

/** Keys whose format says what they are. The prefixes are public; the rest is the secret. */
const KEY_PATTERNS: readonly RegExp[] = [
  /\bsk-(?:ant-|proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g,
  /\bxai-[A-Za-z0-9]{20,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}/g,
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
];

/** A JSON Web Token: three base64url parts, the first two starting with an encoded "{". */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/g;

const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g;

/**
 * A word that names a secret, then a separator, then the value. Chinese wording often joins them with
 * 是 or 为, as in 密码是 Abc123. The value must be one word of at least six characters that is not a
 * placeholder, so "the password is in the vault" or "密码：（见保密箱）" do not count.
 */
const NAMED_SECRET_PATTERN =
  /(?:密码|口令|密钥|秘钥|私钥|令牌|验证码|password|passwd|passcode|pwd|api[ _-]?key|secret|token|access[ _-]?key)\s*(?:是|为|:|：|=|＝|is)\s*["'“‘「]?([^\s"'”’」，。,;；]{6,})/giu;

/** A long run of letters and digits with both, and some mix of cases or symbols, as a key often is. */
const RANDOM_TOKEN_PATTERN = /(?<![A-Za-z0-9/+=_-])[A-Za-z0-9_\-+/=]{32,}(?![A-Za-z0-9/+=_-])/g;

/** Values that name a secret instead of being one. */
const PLACEHOLDERS = new Set(["password", "passwd", "secret", "token", "xxxxxx", "******", "<password>", "[password]"]);

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  if (PLACEHOLDERS.has(lower)) return true;
  // A run of one character, such as ****** or xxxxxx, hides a value rather than giving one.
  if (/^(.)\1+$/u.test(value)) return true;
  // A path or an address is not a password, even after "token=".
  return /^(?:https?:\/\/|\/|~\/|\.\/|[A-Za-z]:\\)/u.test(value);
}

/** True for a string that looks random: digits and letters, and not a word, a path or a hex hash. */
function looksRandom(value: string): boolean {
  if (!/[0-9]/.test(value) || !/[A-Za-z]/.test(value)) return false;
  // A git commit or a checksum is a hex string the user often pastes: not a key.
  if (/^[0-9a-f]+$/iu.test(value)) return false;
  // A UUID is an identifier, not a secret.
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) return false;
  // A path, a file name or a URL part has separators in the middle.
  if (value.includes("/") && !value.endsWith("=")) return false;
  const upper = (value.match(/[A-Z]/g) ?? []).length;
  const lower = (value.match(/[a-z]/g) ?? []).length;
  const digits = (value.match(/[0-9]/g) ?? []).length;
  // Random keys mix cases and digits throughout; an identifier like camelCaseName2 does not.
  return upper >= 4 && lower >= 4 && digits >= 4;
}

/** Inside a fenced code block a long string is usually code or a hash the user wants discussed. */
function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const fence = /```[\s\S]*?(?:```|$)/g;
  for (let match = fence.exec(text); match; match = fence.exec(text)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/**
 * The secrets that a message seems to contain, in the order of the text. Empty when none.
 * Known key formats and private keys count also inside code blocks; a random-looking string does not.
 */
export function findHxSecrets(text: string): HxSecretMatch[] {
  if (!text || text.length < 6) return [];
  const found: HxSecretMatch[] = [];
  const add = (kind: HxSecretKind, start: number, end: number) => {
    if (found.some((match) => start < match.end && end > match.start)) return;
    found.push({ kind, start, end });
  };
  for (const pattern of KEY_PATTERNS) {
    for (const match of text.matchAll(pattern)) add("key", match.index, match.index + match[0].length);
  }
  for (const match of text.matchAll(JWT_PATTERN)) add("token", match.index, match.index + match[0].length);
  for (const match of text.matchAll(PRIVATE_KEY_PATTERN))
    add("private-key", match.index, match.index + match[0].length);
  for (const match of text.matchAll(NAMED_SECRET_PATTERN)) {
    const value = match[1];
    if (!value || isPlaceholder(value)) continue;
    const start = match.index + match[0].length - value.length;
    add("password", start, start + value.length);
  }
  const code = codeRanges(text);
  for (const match of text.matchAll(RANDOM_TOKEN_PATTERN)) {
    const start = match.index;
    if (code.some(([from, to]) => start >= from && start < to)) continue;
    if (looksRandom(match[0])) add("key", start, start + match[0].length);
  }
  return found.sort((a, b) => a.start - b.start);
}

/** True when the message seems to contain a password, a key or a token. */
export function hasHxSecret(text: string): boolean {
  return findHxSecrets(text).length > 0;
}
