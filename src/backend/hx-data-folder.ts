import { existsSync } from "node:fs";
import { join } from "node:path";
import { HX_DATA_FOLDER, HX_EARLIER_DATA_FOLDER } from "@hxbot/contracts/hx-earlier-names";

/**
 * HXBot: the data folder below `parent` (the home folder for the agent workspaces, the
 * application data folder for the provider runtimes). A computer that ran an earlier build keeps the
 * folder that build made, because agents, their saved paths and the transcripts of their providers
 * point into it. A new computer gets the folder with the new name.
 */
export function hxDataFolder(parent: string): string {
  return join(parent, existsSync(join(parent, HX_EARLIER_DATA_FOLDER)) ? HX_EARLIER_DATA_FOLDER : HX_DATA_FOLDER);
}
