// HXBot 电脑操控（五）（v1.7.3，需求 CONC-06）：设置 → 电脑操控里的“停放后自动续做”（默认开）。
// 存在这台电脑的 HXBot 数据文件夹里的 computer-settings.json（{ version: 1, autoResume }）。读不到、写不进，
// 都按默认“开”处理，不影响别的功能；以后的版本加字段时，读这个文件的旧版本只看 autoResume。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";

const FILE = "computer-settings.json";
const VERSION = 1;

export class HxAutoResumeSetting {
  readonly #folder: () => string | null;
  /** The value read from the folder; null until the folder is known and read. */
  #value: boolean | null = null;

  constructor(folder: () => string | null) {
    this.#folder = folder;
  }

  get(): boolean {
    if (this.#value !== null) return this.#value;
    const folder = this.#folder();
    if (!folder) return true;
    let value = true;
    try {
      const data = JSON.parse(readFileSync(join(folder, FILE), "utf8"));
      if (isDynamicRecord(data) && typeof data.autoResume === "boolean") value = data.autoResume;
    } catch {
      // No file yet, or a damaged one: the default holds.
    }
    this.#value = value;
    return value;
  }

  set(on: boolean): void {
    this.#value = on;
    const folder = this.#folder();
    if (!folder) return;
    try {
      mkdirSync(folder, { recursive: true });
      const file = join(folder, FILE);
      const next = `${file}.${process.pid}.tmp`;
      writeFileSync(next, `${JSON.stringify({ version: VERSION, autoResume: on })}\n`);
      renameSync(next, file);
    } catch {
      // The setting holds for this run of HXBot.
    }
  }
}
