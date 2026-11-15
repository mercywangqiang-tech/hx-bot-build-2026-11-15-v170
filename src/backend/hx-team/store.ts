// HXBot 协作（二）：团队记录（v1.6.6）。
//
// One JSON file for each team in `hx-team/` inside HXBot's data folder, on this computer only: who is
// in the team, the steps of the card and their state, the facts and files the members share, the
// requests of the team in its room, and how the team ended. A file that cannot be read is skipped; a
// write that fails is logged and the team goes on from memory.
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import { createHxBotLogger } from "@hxbot/logging";
import type { HxTeamSkill } from "./skills";

const logger = createHxBotLogger("hx-team");

export type HxTeamLanguage = "zh" | "en";
type HxTeamState = "running" | "done" | "stopped" | "failed";
export type HxStepState = "todo" | "doing" | "blocked" | "done";

export interface HxTeamMember {
  agentId: string;
  name: string;
  /** The role of the card, such as Writer. */
  role: string;
  kind: "plan" | "do" | "check";
  /** Made for this team. */
  temporary: boolean;
  /** The model name it was given or had when the team started; null when it was unknown. */
  model: string | null;
  /** Taken out of the team (swapped). */
  left?: boolean;
}

interface HxTeamStep {
  n: number;
  title: string;
  role: string;
  together: boolean;
  state: HxStepState;
  note: string;
}

export interface HxTeamRecord {
  id: string;
  channelId: string;
  roomName: string;
  starterAgentId: string;
  language: HxTeamLanguage;
  goal: string;
  folder: string | null;
  leadAgentId: string;
  members: HxTeamMember[];
  steps: HxTeamStep[];
  facts: string[];
  files: string[];
  /** The request messages of the team in its room: the brief, then each message from the user. */
  requests: string[];
  createdAt: string;
  deadline: string;
  limits: { members: number; minutes: number; rounds: number; temporary: "collapse" | "keep" };
  state: HxTeamState;
  endedAt: string | null;
  result: string | null;
  /** Why it stopped or failed, in the language of the team. */
  reason: string | null;
  /** The last state of each task of the team that the watcher saw. */
  seen: Record<string, string>;
  /** How often the same piece of work failed. */
  failures: Record<string, number>;
  /** Whether the result reached the starter's chat. */
  delivered: boolean;
  /** v1.6.7: the skills in the workspaces of the starter and the members, for every member. */
  skills: HxTeamSkill[];
}

export const HX_TEAM_FACT_LIMIT = 40;
export const HX_TEAM_FILE_LIMIT = 80;

function isRecord(value: unknown): value is HxTeamRecord {
  return (
    isDynamicRecord(value) &&
    typeof value.id === "string" &&
    typeof value.channelId === "string" &&
    typeof value.starterAgentId === "string" &&
    typeof value.leadAgentId === "string" &&
    Array.isArray(value.members) &&
    Array.isArray(value.steps) &&
    Array.isArray(value.requests) &&
    typeof value.state === "string" &&
    typeof value.deadline === "string"
  );
}

/** The team in a file, with the fields an older record does not have; null when it is not a team. */
function readTeam(file: string): HxTeamRecord | null {
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(value)) return null;
  return {
    ...value,
    seen: value.seen ?? {},
    failures: value.failures ?? {},
    delivered: value.delivered ?? false,
    // A team of v1.6.6 has no skill table.
    skills: Array.isArray(value.skills) ? value.skills : [],
  };
}

export class HxTeamStore {
  #folder: string | null = null;
  #teams = new Map<string, HxTeamRecord>();

  /** Opens the folder and reads every team in it. Before this, teams live in memory only. */
  open(folder: string): void {
    this.#folder = folder;
    this.#teams = new Map();
    try {
      mkdirSync(folder, { recursive: true });
      for (const name of readdirSync(folder)) {
        if (!name.endsWith(".json")) continue;
        try {
          const team = readTeam(join(folder, name));
          if (team) this.#teams.set(team.id, team);
        } catch {
          // A damaged file is skipped and stays on disk for the user.
        }
      }
    } catch (error) {
      logger.warn("HXBot could not read the team records; teams start empty.", { error: String(error) });
    }
  }

  get(id: string): HxTeamRecord | null {
    return this.#teams.get(id) ?? null;
  }

  byChannel(channelId: string): HxTeamRecord | null {
    for (const team of this.#teams.values()) if (team.channelId === channelId) return team;
    return null;
  }

  list(): HxTeamRecord[] {
    return [...this.#teams.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  running(): HxTeamRecord[] {
    return this.list().filter((team) => team.state === "running");
  }

  /** The teams an agent started, the newest first. */
  startedBy(agentId: string): HxTeamRecord[] {
    return this.list()
      .filter((team) => team.starterAgentId === agentId)
      .reverse();
  }

  save(team: HxTeamRecord): void {
    this.#teams.set(team.id, team);
    if (!this.#folder) return;
    const file = join(this.#folder, `${team.id}.json`);
    try {
      writeFileSync(`${file}.tmp`, `${JSON.stringify(team, null, 2)}\n`);
      renameSync(`${file}.tmp`, file);
    } catch (error) {
      logger.warn("HXBot could not save a team record.", { error: String(error) });
    }
  }
}
