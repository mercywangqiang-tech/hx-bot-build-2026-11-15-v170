// HXBot: the names of the OpenCode services the user connected (hx-opencode).
//
// OpenCode 2 names a model by the service's id, `deepseek/DeepSeek V4 Pro`. The model list shows
// the service's name in its place, `DeepSeek/DeepSeek V4 Pro`, as it does for OpenCode's own
// services. The names come from the connection list and are kept in a small file, so they are
// known again after a restart, before the list is opened. Names only: no credential is here.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "names.json";
const MAX_NAMES = 500;
const MAX_NAME = 80;

function clean(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const names: Record<string, string> = {};
  for (const [id, name] of Object.entries(value).slice(0, MAX_NAMES)) {
    if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(id) && typeof name === "string" && name.trim()) {
      names[id] = name.trim().slice(0, MAX_NAME);
    }
  }
  return names;
}

class HxOpenCodeNames {
  #folder: string | null = null;
  #names: Record<string, string> = {};

  open(folder: string): void {
    this.#folder = folder;
    try {
      this.#names = clean(JSON.parse(readFileSync(join(folder, FILE), "utf8")));
    } catch {
      this.#names = {};
    }
  }

  /** The service's name for an OpenCode service id, or null. */
  name(id: string): string | null {
    return Object.hasOwn(this.#names, id) ? (this.#names[id] ?? null) : null;
  }

  /** Adds the names of the services connected now. A name of a service no longer connected stays harmless. */
  remember(names: Readonly<Record<string, string>>): void {
    const next = clean({ ...this.#names, ...names });
    if (JSON.stringify(next) === JSON.stringify(this.#names)) return;
    this.#names = next;
    const folder = this.#folder;
    if (!folder) return;
    try {
      mkdirSync(folder, { recursive: true });
      const temporary = join(folder, `${FILE}.tmp`);
      writeFileSync(temporary, JSON.stringify(next));
      renameSync(temporary, join(folder, FILE));
    } catch {
      // The names show again after the next look at the list.
    }
  }
}

export const hxOpenCodeNames = new HxOpenCodeNames();
