import { hxHasEarlierName, hxRenamedName } from "@hxbot/contracts/hx-earlier-names";

// HXBot: earlier builds kept the settings of this window (panel widths, drafts, the theme,
// the selected agent and the like) in local storage under the earlier name. This module is the first
// import of each entry, so each setting gets the name that the code reads before any module reads it.
// A key that already has a value under the new name keeps that value.
try {
  const storage = window.localStorage;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key === null || !hxHasEarlierName(key)) continue;
    const target = hxRenamedName(key);
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(target) === null) storage.setItem(target, value);
    storage.removeItem(key);
  }
} catch {
  // Storage that is off or full: the settings start fresh, as on a new computer.
}
