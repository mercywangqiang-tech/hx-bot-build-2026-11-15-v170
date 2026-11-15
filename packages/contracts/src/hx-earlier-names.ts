/**
 * HXBot: the names that builds before the rename used.
 *
 * HXBot started as OpenBot. Code, interface and output now say HXBot everywhere. This module keeps
 * the earlier names that HXBot must still recognize: the data that earlier builds left on a computer
 * or a phone, and what an earlier client or server that has not been updated yet sends. New data is
 * always written under the new names. `hx/brand_rename.py` leaves this one file as it is.
 */

/** The data folder in the home folder (agent workspaces) that earlier builds made. */
export const HX_EARLIER_DATA_FOLDER = "OpenBot";
/** The data folder that HXBot makes when no earlier folder exists. No space, so a shell path needs no quotes. */
export const HX_DATA_FOLDER = "HXBot";

const EARLIER = /openbot/giu;
const RENAMED = /HXBOT|HXBot|HxBot|hxBot|Hxbot|hxbot/gu;

/** True when a name (a file, a key, a value) has the earlier name in it, in any case. */
export function hxHasEarlierName(name: string): boolean {
  return /openbot/iu.test(name);
}

/**
 * The new name for a name that earlier builds wrote, by the rule of the rename: `openbot` becomes
 * `hxbot`, `OPENBOT` becomes `HXBOT`, `OpenBot` becomes `HxBot`. A storage key, a file name or a
 * browser partition keeps its meaning and gets the name that the current code reads.
 */
export function hxRenamedName(name: string): string {
  return name.replace(EARLIER, (word) => {
    if (word === "OpenBot") return "HxBot";
    const first = word[0] === word[0]?.toUpperCase() ? "H" : "h";
    const second = word[1] === word[1]?.toUpperCase() ? "X" : "x";
    return `${first}${second}${word.slice(4)}`;
  });
}

/** The name that earlier builds used for a name that the current code reads: the reverse of `hxRenamedName`. */
export function hxEarlierName(name: string): string {
  return name.replace(RENAMED, (word) => {
    switch (word) {
      case "HXBOT":
        return "OPENBOT";
      case "HXBot":
      case "HxBot":
        return "OpenBot";
      case "hxBot":
        return "openBot";
      case "Hxbot":
        return "Openbot";
      default:
        return "openbot";
    }
  });
}
