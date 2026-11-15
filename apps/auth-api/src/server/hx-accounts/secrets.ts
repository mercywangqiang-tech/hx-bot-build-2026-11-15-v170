/**
 * HXBot：密码的保存方式、验证码和票据。
 *
 * 密码只保存 PBKDF2-HMAC-SHA256 的结果和每个账号各自的随机盐，不保存密码本身。迭代 100000 次：
 * 账号服务的运行时（workerd）对 PBKDF2 的上限就是这个数。
 */

const ENCODER = new TextEncoder();

const HX_PASSWORD_ITERATIONS = 100_000;
const HX_PASSWORD_MIN = 8;
/** The sign-in step takes at most 32 characters (`auth-service.ts`), so a longer password could never sign in. */
const HX_PASSWORD_MAX = 32;

function toHex(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += byte.toString(16).padStart(2, "0");
  return text;
}

function fromHex(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** The same form as `sha256` of `crypto.ts`: the sign-in challenges are found by it. */
export async function hxSha256(value: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", ENCODER.encode(value))));
}

export function hxRandomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** A value for a link or a ticket: letters, digits, `-` and `_`. 24 bytes give 32 characters. */
export function hxRandomToken(bytes = 24): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Six digits, each equally likely. */
export function hxRandomCode(): string {
  const limit = 4_294_000_000; // the largest multiple of a million below 2^32, so no value is favoured
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] ?? limit;
    if (value < limit) return String(value % 1_000_000).padStart(6, "0");
  }
}

/** A symbol: any character that is not a letter, a digit or a space, such as ! @ # $ % or a full-width ！. */
const HX_PASSWORD_SYMBOL = /[^\p{L}\p{N}\s]/u;

/** Why a new password is refused: 8 to 32 characters, with a letter, a digit and a symbol. Null: it is fine. */
export function hxPasswordProblem(password: string): "too_short" | "too_long" | "too_simple" | null {
  if (password.length < HX_PASSWORD_MIN) return "too_short";
  if (password.length > HX_PASSWORD_MAX) return "too_long";
  if (!/[A-Za-z]/u.test(password) || !/[0-9]/u.test(password) || !HX_PASSWORD_SYMBOL.test(password))
    return "too_simple";
  return null;
}

export async function hxDerivePassword(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", ENCODER.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(salt), iterations },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

export async function hxNewPassword(password: string): Promise<{ salt: string; hash: string; iterations: number }> {
  const salt = hxRandomHex(16);
  return {
    salt,
    hash: await hxDerivePassword(password, salt, HX_PASSWORD_ITERATIONS),
    iterations: HX_PASSWORD_ITERATIONS,
  };
}

export function hxSameText(left: string, right: string): boolean {
  const a = ENCODER.encode(left);
  const b = ENCODER.encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < a.length; index += 1) difference |= (a[index] ?? 0) ^ (b[index % (b.length || 1)] ?? 0);
  return difference === 0;
}
