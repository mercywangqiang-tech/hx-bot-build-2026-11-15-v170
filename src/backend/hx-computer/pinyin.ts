// HXBot 电脑操控：给任何中文名称配上拼音，让“wangyiyun”“wyyyy”也能找到“网易云音乐”。
// 字的读音来自内置的拼音表（pinyin-table.ts，6763 个常用字）；表里的词（音乐、银行、重庆……）按整词的读音，
// 一个名称里能对上词表的部分优先按词读。表里没有的字（生僻字）让整个名称不配拼音，免得配出错的。
// 名称里的英文和数字原样保留，作为单独的一段（“QQ音乐”是 qq yin yue）。
import { HX_PINYIN_TABLE, HX_PINYIN_WORDS } from "./pinyin-table";

const HAN = /\p{Script=Han}/u;

let characters: Map<string, string> | null = null;
let longestWord = 0;

function table(): Map<string, string> {
  if (characters) return characters;
  const read = new Map<string, string>();
  for (const group of HX_PINYIN_TABLE.split(" ")) {
    const syllable = /^[a-z]+/u.exec(group)?.[0] ?? "";
    for (const character of group.slice(syllable.length)) read.set(character, syllable);
  }
  for (const word of Object.keys(HX_PINYIN_WORDS)) longestWord = Math.max(longestWord, [...word].length);
  characters = read;
  return read;
}

/** One part of a name as it is typed: a syllable of pinyin, or a run of Latin letters and digits. */
interface HxPinyinPart {
  text: string;
  latin: boolean;
}

/**
 * The parts of a name with Chinese characters in it, or null when the name has none, or has a
 * character the table does not know.
 */
function parts(name: string): HxPinyinPart[] | null {
  if (!HAN.test(name)) return null;
  const read = table();
  const letters = [...name.normalize("NFKC")];
  const found: HxPinyinPart[] = [];
  let latin = "";
  const endLatin = () => {
    if (latin) found.push({ text: latin.toLowerCase(), latin: true });
    latin = "";
  };
  for (let at = 0; at < letters.length; ) {
    const letter = letters[at] ?? "";
    if (!HAN.test(letter)) {
      if (/[\p{L}\p{N}]/u.test(letter)) latin += letter;
      else endLatin();
      at += 1;
      continue;
    }
    endLatin();
    // The longest word of the list that starts here is read as a whole: 音乐 is yin yue, not yin le.
    let taken = 0;
    for (let length = Math.min(longestWord, letters.length - at); length >= 2; length -= 1) {
      const said = HX_PINYIN_WORDS[letters.slice(at, at + length).join("")];
      if (said) {
        for (const syllable of said.split(" ")) found.push({ text: syllable, latin: false });
        taken = length;
        break;
      }
    }
    if (taken > 0) {
      at += taken;
      continue;
    }
    const syllable = read.get(letter);
    if (!syllable) return null;
    found.push({ text: syllable, latin: false });
    at += 1;
  }
  endLatin();
  return found.length > 0 ? found : null;
}

/** The spaced pinyin of a name, such as "wang yi yun yin yue"; null as for `parts`. */
export function hxPinyinOf(name: string): string | null {
  return (
    parts(name)
      ?.map((part) => part.text)
      .join(" ") ?? null
  );
}

/**
 * The names a Chinese name is typed as: the whole pinyin ("wangyiyunyinyue") and the first letters
 * ("wyyyy"), in which a run of Latin letters stays whole ("QQ音乐" gives "qqyinyue" and "qqyy").
 */
export function hxPinyinTyped(name: string): string[] {
  const found = parts(name);
  if (!found) return [];
  const full = found.map((part) => part.text).join("");
  const initials = found.map((part) => (part.latin ? part.text : part.text.slice(0, 1))).join("");
  return initials.length >= 2 && initials !== full ? [full, initials] : [full];
}
