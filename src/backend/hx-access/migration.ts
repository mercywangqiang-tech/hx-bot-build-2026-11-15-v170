// HXBot：升级到最大权限时，所有智能体（包括原来是完全访问的）都改为最大权限，只做一次。
// 之后客户可以手动改成完全访问（要二次确认）。最大权限存为 access "workspace"，和以前的按需授权同一个值。
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSummary } from "@hxbot/contracts/ipc";
import { createHxBotLogger } from "@hxbot/logging";
import { Effect } from "effect";

const logger = createHxBotLogger("hx-access-migration");

/** The file that says the move was made, in the app's data folder (v1.6.2: 最大权限). */
const HX_ON_DEMAND_MARKER = "hx-max-access.json";

interface MovableStore {
  list(): readonly AgentSummary[];
  updateAgent(input: { agentId: string; access: "workspace" }): Effect.Effect<unknown, unknown>;
}

/**
 * Moves every agent that is not at 最大权限 there, the first time this build starts. A failure is
 * logged and tried again at the next start; the agents that moved stay moved.
 */
export async function hxMoveAgentsToOnDemand(store: MovableStore, userDataPath: string) {
  const marker = join(userDataPath, HX_ON_DEMAND_MARKER);
  if (existsSync(marker)) return 0;
  let moved = 0;
  try {
    for (const agent of store.list()) {
      if (agent.access === "workspace") continue;
      await Effect.runPromise(store.updateAgent({ agentId: agent.id, access: "workspace" }));
      moved += 1;
    }
    await writeFile(marker, `${JSON.stringify({ version: 1, movedAt: new Date().toISOString(), moved })}\n`, {
      mode: 0o600,
    });
  } catch (error) {
    logger.warn("HXBot could not move the agents to maximum access.", { error: String(error) });
  }
  return moved;
}
