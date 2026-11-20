// HXBot (v1.7.5 fix): the agent deletes that wait for their undo time, kept on disk.
//
// A delete on the desktop waits 8 seconds, so that the person can undo it. Before this fix the wait was
// only in the window: an app that quit in those seconds, or a window that was hidden, never sent the
// delete, so the agent came back on the next start, and the web client and the phones still showed it.
// Now the host keeps each waiting delete in `hx-pending-agent-deletes.json`, beside `hxbot.db`, before it
// answers the window. While an entry is there the host leaves the agent out of every agent list (this
// computer, the web client and the phones); "Undo" takes the entry away; the delete itself, or the next
// start after a quit, a crash or a killed process, removes the agent and then the entry.
//
// The file is written whole, to a temporary file that is flushed to the disk and then renamed, so a
// crash leaves the old list or the new one, never half of one. Each entry names its server: `null` is
// this computer; another id is a joined server, whose delete this computer sends again until it is done.
// A file that cannot be read keeps no entry: the agent then stays, which loses nothing. A file that cannot
// be written fails the step that wanted it, so a delete or an undo never seems done when it is not.

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";

export const HX_PENDING_DELETES_FILE = "hx-pending-agent-deletes.json";
const VERSION = 1;
/** More waiting deletes than any person makes; a file with more is cut to the newest. */
const HX_PENDING_DELETES_MAX = 500;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

export interface HxPendingDelete {
  readonly agentId: string;
  /** `null`: an agent of this computer. Otherwise the joined server that has the agent. */
  readonly serverId: string | null;
  /** When the person deleted it (epoch ms). */
  readonly heldAt: number;
}

function entryOf(value: unknown): HxPendingDelete | null {
  if (!isDynamicRecord(value)) return null;
  const { agentId, serverId, heldAt } = value;
  if (typeof agentId !== "string" || !ID.test(agentId)) return null;
  if (serverId !== null && (typeof serverId !== "string" || !ID.test(serverId))) return null;
  if (typeof heldAt !== "number" || !Number.isFinite(heldAt) || heldAt < 0) return null;
  return { agentId, serverId, heldAt };
}

const same = (entry: HxPendingDelete, agentId: string, serverId: string | null) =>
  entry.agentId === agentId && entry.serverId === serverId;

export class HxPendingDeletes {
  readonly #folder: () => string | null;
  #entries: HxPendingDelete[] = [];
  #loaded = false;

  /** `folder`: the folder of `hxbot.db`; null keeps the list in memory only (a test, an in-memory database). */
  constructor(folder: () => string | null) {
    this.#folder = folder;
  }

  /** The folder of a database file, or null for a database that is not a file. */
  static folderOf(databasePath: string): string | null {
    return isAbsolute(databasePath) ? dirname(databasePath) : null;
  }

  #file(): string | null {
    const folder = this.#folder();
    return folder ? join(folder, HX_PENDING_DELETES_FILE) : null;
  }

  /** Reads the file once. Entries that do not parse are left out. */
  load(): readonly HxPendingDelete[] {
    this.#loaded = true;
    const file = this.#file();
    if (!file) return this.#entries;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      this.#entries = [];
      return this.#entries;
    }
    try {
      const parsed = JSON.parse(text);
      const list = isDynamicRecord(parsed) && Array.isArray(parsed.entries) ? parsed.entries : [];
      const seen = new Set<string>();
      const entries: HxPendingDelete[] = [];
      for (const value of list) {
        const entry = entryOf(value);
        if (!entry) continue;
        const key = `${entry.serverId ?? ""}\u0000${entry.agentId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(entry);
      }
      this.#entries = entries.slice(-HX_PENDING_DELETES_MAX);
    } catch {
      this.#entries = [];
    }
    return this.#entries;
  }

  #ensureLoaded(): void {
    if (!this.#loaded) this.load();
  }

  entries(): readonly HxPendingDelete[] {
    this.#ensureLoaded();
    return this.#entries;
  }

  has(agentId: string, serverId: string | null = null): boolean {
    this.#ensureLoaded();
    return this.#entries.some((entry) => same(entry, agentId, serverId));
  }

  /** The agents of this computer whose delete waits. */
  localIds(): ReadonlySet<string> {
    this.#ensureLoaded();
    return new Set(this.#entries.filter((entry) => entry.serverId === null).map((entry) => entry.agentId));
  }

  /** Keeps a waiting delete. Throws when the id is not valid or the file cannot be written. */
  add(agentId: string, serverId: string | null, heldAt: number): void {
    this.#ensureLoaded();
    const entry = entryOf({ agentId, serverId, heldAt });
    if (!entry) throw new Error(`Not a valid agent or server id: ${JSON.stringify(agentId).slice(0, 80)}`);
    if (this.has(agentId, serverId)) return;
    this.#write([...this.#entries, entry].slice(-HX_PENDING_DELETES_MAX));
  }

  /** Takes a waiting delete away. Returns whether there was one. Throws when the file cannot be written. */
  remove(agentId: string, serverId: string | null = null): boolean {
    this.#ensureLoaded();
    if (!this.has(agentId, serverId)) return false;
    this.#write(this.#entries.filter((entry) => !same(entry, agentId, serverId)));
    return true;
  }

  /** Writes the whole list (an empty list removes the file), then keeps it in memory. */
  #write(entries: HxPendingDelete[]): void {
    const file = this.#file();
    if (file) {
      if (entries.length === 0) rmSync(file, { force: true });
      else {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        const next = `${file}.${process.pid}.next`;
        const fd = openSync(next, "w", 0o600);
        try {
          writeSync(fd, `${JSON.stringify({ version: VERSION, entries }, null, 1)}\n`);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        renameSync(next, file);
        // The rename itself reaches the disk with the folder.
        try {
          const dir = openSync(dirname(file), "r");
          try {
            fsyncSync(dir);
          } finally {
            closeSync(dir);
          }
        } catch {
          // Windows cannot open a folder for a flush; NTFS keeps the rename in its log.
        }
      }
    }
    this.#entries = entries;
  }
}
