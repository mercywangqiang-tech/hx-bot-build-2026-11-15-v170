// HXBot 协作（二）：按专长从现有的智能体里选人（v1.6.6）。
//
// Each role of a team gets the local agent whose name, title and description share the most words
// with the role. An agent that the user named for the role comes first. An agent gets one role at
// most, the agent that starts the team gets none (it stays with the user), and a hidden agent gets
// none. A role that no agent fits well enough gets a member made for the team.

export interface HxMatchAgent {
  id: string;
  name: string;
  title: string;
  description: string;
  hidden: boolean;
  /** Runs a turn or has queued work now. Such an agent still fits, but a free one with the same score comes first. */
  busy: boolean;
}

export interface HxMatchRole {
  name: string;
  does: string;
  /** The words of the kind of work, such as "writing" and "写作". */
  workWords: readonly string[];
  /** The agent the caller named for this role. */
  agentId?: string | undefined;
}

export type HxMatch =
  | { kind: "named"; agentId: string }
  | { kind: "matched"; agentId: string; score: number }
  | { kind: "new" };

/** Words that say nothing about what an agent is good at. */
const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "who",
  "does",
  "agent",
  "helper",
  "assistant",
  "work",
  "task",
  "tasks",
  "that",
  "this",
  "from",
  "into",
  "智能",
  "能体",
  "助手",
  "负责",
  "工作",
  "任务",
  "一个",
  "进行",
  "并且",
  "以及",
]);

/** Latin words of three or more letters, and each pair of neighbouring CJK characters. */
export function hxWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[a-z][a-z0-9+#.-]{2,}/gu)) {
    const trimmed = match[0].replace(/[.-]+$/u, "");
    const word = trimmed.endsWith("s") && trimmed.length > 4 ? trimmed.slice(0, -1) : trimmed;
    if (word.length >= 3 && !STOP.has(word)) words.add(word);
  }
  for (const run of text.matchAll(/[㐀-鿿]+/gu)) {
    const chars = [...run[0]];
    if (chars.length === 1) continue;
    for (let index = 0; index + 1 < chars.length; index += 1) {
      const pair = `${chars[index]}${chars[index + 1]}`;
      if (!STOP.has(pair)) words.add(pair);
    }
  }
  return words;
}

/** How many words of the role the agent has. The role name and the agent's name and title count twice. */
export function hxMatchScore(role: HxMatchRole, agent: HxMatchAgent) {
  const strong = hxWords(`${role.name} ${role.workWords.join(" ")}`);
  const weak = hxWords(role.does);
  const head = hxWords(`${agent.name} ${agent.title}`);
  const body = hxWords(agent.description);
  let score = 0;
  for (const word of strong) score += head.has(word) ? 2 : body.has(word) ? 1 : 0;
  for (const word of weak) if (!strong.has(word)) score += head.has(word) ? 1 : body.has(word) ? 0.5 : 0;
  return score;
}

/** The lowest score that makes an agent fit a role: two shared words, or the role's own name in its name or title. */
const HX_MATCH_MIN_SCORE = 2;

/**
 * One choice for each role, in the order of the roles. Named agents are placed first, then the roles
 * take the best free agent in turn, the role with the best fit first.
 */
export function hxMatchRoles(
  roles: readonly HxMatchRole[],
  agents: readonly HxMatchAgent[],
  starterAgentId: string,
): HxMatch[] {
  const usable = agents.filter((agent) => !agent.hidden && agent.id !== starterAgentId);
  const taken = new Set<string>();
  const result: (HxMatch | null)[] = roles.map((role) => {
    if (!role.agentId) return null;
    const named = usable.find((agent) => agent.id === role.agentId);
    if (!named || taken.has(named.id)) return null;
    taken.add(named.id);
    return { kind: "named", agentId: named.id };
  });
  const pairs = roles
    .flatMap((role, roleIndex) =>
      result[roleIndex] ? [] : usable.map((agent) => ({ roleIndex, agent, score: hxMatchScore(role, agent) })),
    )
    .filter((pair) => pair.score >= HX_MATCH_MIN_SCORE)
    .sort((left, right) => right.score - left.score || Number(left.agent.busy) - Number(right.agent.busy));
  for (const pair of pairs) {
    if (result[pair.roleIndex] || taken.has(pair.agent.id)) continue;
    taken.add(pair.agent.id);
    result[pair.roleIndex] = { kind: "matched", agentId: pair.agent.id, score: pair.score };
  }
  return result.map((match) => match ?? { kind: "new" });
}
