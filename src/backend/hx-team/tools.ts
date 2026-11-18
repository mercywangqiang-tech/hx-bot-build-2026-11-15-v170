// HXBot 协作（二）：团队的四个工具（v1.6.6）。
//
// `start_team` and `team` work in the starter's own chat; `team_board` and `team_done` work in a task
// of a team room. The definitions are short: the room instructions and the brief say the rest.
import { HX_DIFFICULTIES, HX_NEEDS, HX_WORK_TYPES } from "@hxbot/contracts/hx-auto-model";
import { INPUT_LIMITS } from "@hxbot/contracts/input-limits";
import { z } from "zod";

export const HX_START_TEAM_TOOL = "start_team";
export const HX_TEAM_TOOL = "team";
export const HX_TEAM_BOARD_TOOL = "team_board";
export const HX_TEAM_DONE_TOOL = "team_done";

export const HX_TEAM_TOOL_NAMES: ReadonlySet<string> = new Set([
  HX_START_TEAM_TOOL,
  HX_TEAM_TOOL,
  HX_TEAM_BOARD_TOOL,
  HX_TEAM_DONE_TOOL,
]);

const text = (max: number) => z.string().trim().min(1).max(max);

/** v1.7.1 (TEAM-01): the bounds of one call, not limits of a team. */
const HX_TEAM_MOST_ROLES = 100;
const HX_TEAM_MOST_STEPS = 100;
/** Written in the record when the user named no time: 24 hours, for an older version that reads it. */
export const HX_TEAM_OPEN_MINUTES = 1440;
/** Written in the record when the user named no handoff limit, for an older version that reads it. */
export const HX_TEAM_OPEN_ROUNDS = 1_000_000;
const HX_TEAM_MOST_MINUTES = 7 * 24 * 60;

const HX_TEAM_ROLE = z.strictObject({
  name: text(40).describe("Such as Writer or Checker."),
  kind: z.enum(["plan", "do", "check"]),
  does: text(300),
  work: z.enum(HX_WORK_TYPES),
  difficulty: z.enum(HX_DIFFICULTIES).optional(),
  needs: z.array(z.enum(HX_NEEDS)).max(2).optional(),
  agentId: text(INPUT_LIMITS.identifier)
    .describe("An agent from hxbot.list_agents for this role. Omit it: HXBot picks one, or makes one.")
    .optional(),
});

const HX_TEAM_STEP = z.strictObject({
  title: text(200),
  role: text(40),
  together: z.boolean().optional(),
});

const START_TEAM_SHAPE = {
  goal: text(8_000).describe("The whole brief, in the user's language. Members do not see this chat."),
  // v1.7.1 (TEAM-01): the members are as many as the work needs; the bounds only keep one call sane.
  roles: z.array(HX_TEAM_ROLE).min(1).max(HX_TEAM_MOST_ROLES),
  steps: z.array(HX_TEAM_STEP).min(1).max(HX_TEAM_MOST_STEPS),
  apps: z.array(text(60)).max(6).optional(),
  confirm: z.array(text(160)).max(4).optional(),
  paths: z.array(text(INPUT_LIMITS.path)).max(10).optional().describe("Local files the lead gets with the brief."),
  limits: z
    .strictObject({
      members: z.number().int().min(1).max(HX_TEAM_MOST_ROLES).optional(),
      minutes: z.number().int().min(1).max(HX_TEAM_MOST_MINUTES).optional().describe("Minutes of real work."),
      rounds: z.number().int().min(1).max(HX_TEAM_OPEN_ROUNDS).optional(),
      spend: z.number().min(1).max(1_000_000).optional().describe("Yuan."),
      noAsk: z.boolean().optional().describe("The user said not to ask."),
    })
    .optional()
    .describe("Only limits the user named for this team; a team has none by default."),
};

const TEAM_SHAPE = {
  action: z.enum(["status", "message", "stop", "swap", "keep", "limits", "priority", "continue", "finish"]),
  teamId: text(INPUT_LIMITS.identifier).optional().describe("Omit it for your newest team."),
  text: text(4_000).optional().describe("message: the user's words for the team."),
  member: text(80)
    .optional()
    .describe("message: who gets it (default the lead). swap: the member to replace. A role, a name or an agent id."),
  agentId: text(INPUT_LIMITS.identifier)
    .optional()
    .describe("swap: the agent that takes over. Omit it to make a new member for the role."),
  minutes: z.number().int().min(1).max(HX_TEAM_MOST_MINUTES).optional().describe("limits: minutes of real work."),
  rounds: z.number().int().min(1).max(HX_TEAM_OPEN_ROUNDS).optional().describe("limits: handoffs."),
  spend: z.number().min(1).max(1_000_000).optional().describe("limits: yuan."),
  noAsk: z.boolean().optional().describe("limits: the user said not to ask."),
  clear: z.boolean().optional().describe("limits: take every limit away."),
  level: z.enum(["urgent", "normal", "relaxed"]).optional().describe("priority: what the user said."),
};

const TEAM_BOARD_SHAPE = {
  action: z.enum(["read", "step", "fact", "file"]),
  step: z.number().int().min(1).max(HX_TEAM_MOST_STEPS).optional(),
  state: z.enum(["todo", "doing", "blocked", "done"]).optional(),
  note: z.string().trim().max(500).optional(),
  text: text(500).optional().describe("fact: a short fact every member should know."),
  path: text(INPUT_LIMITS.path).optional().describe("file: a file the team made."),
};

const TEAM_DONE_SHAPE = {
  result: text(20_000).describe("The final result for the user, after your check."),
  files: z.array(text(INPUT_LIMITS.path)).max(40).optional(),
};

export const HX_TEAM_TOOL_DEFINITIONS = [
  {
    name: HX_START_TEAM_TOOL,
    description:
      "After the user pressed Start on a proposal card with two or more roles, or asked for a team: make the team. HXBot picks agents by skill, makes members for missing roles, opens a team room and gives the lead the brief. Progress and the result come back to this chat. Pass the roles and steps of the card. Then tell the user it started, and end your turn.",
    shape: START_TEAM_SHAPE,
  },
  {
    name: HX_TEAM_TOOL,
    description:
      "A team you started: status, message (the user's words to the team), stop, swap (a member), keep (the members made for it), limits (a limit the user named), priority, continue or finish (the user's answer to a pause). Use it when the user asks about the team or wants a change.",
    shape: TEAM_SHAPE,
  },
  {
    name: HX_TEAM_BOARD_TOOL,
    description:
      "In a team room: read the board (steps, members, models, facts, files, limits), or set a step's state, add a fact, or add a file.",
    shape: TEAM_BOARD_SHAPE,
  },
  {
    name: HX_TEAM_DONE_TOOL,
    description:
      "In a team room, for the lead only: when every step is done and checked, send the final result back to the user's chat. Then end your turn without repeating it.",
    shape: TEAM_DONE_SHAPE,
  },
];

export const startTeamSchema = z.strictObject(START_TEAM_SHAPE);
export const teamSchema = z.strictObject(TEAM_SHAPE);
export const teamBoardSchema = z.strictObject(TEAM_BOARD_SHAPE);
export const teamDoneSchema = z.strictObject(TEAM_DONE_SHAPE);
