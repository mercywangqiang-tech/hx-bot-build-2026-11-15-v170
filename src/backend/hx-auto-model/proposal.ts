// HXBot 协作（一）：开工前的建议卡（propose_plan）。
//
// The agent describes the work: the roles (who plans, who does what, who checks), the steps and the
// apps it needs. HXBot adds the model of each role from the agent's auto model settings, the cost of
// each model and the buttons, and shows it as a confirm block. Nothing starts before the user
// presses start; the agent reads the button from the tool result.
import { HX_DIFFICULTIES, HX_NEEDS, HX_WORK_TYPES } from "@hxbot/contracts/hx-auto-model";
import { normalizeUiBlockSpec, UI_BLOCK_LIMITS, type UiBlockSpec } from "@hxbot/contracts/ui-blocks";
import { z } from "zod";
import { hxFlow } from "../hx-flow/ledger";
import { hxCapacityLine } from "../hx-team/protocol";
import { hxTeams } from "../hx-team/service";
import type { HxAutoRouter } from "./router";

export const HX_PROPOSAL_TOOL = "propose_plan";

/** The action ids of the card. */
export const HX_PROPOSAL_ACTIONS = { start: "start", adjust: "adjust", one: "one", cancel: "cancel" } as const;

const text = (max: number) => z.string().trim().min(1).max(max);

const ROLE = z.strictObject({
  name: text(40).describe("Such as Writer or Checker, or a teammate's name."),
  kind: z.enum(["plan", "do", "check"]),
  does: text(160),
  work: z.enum(HX_WORK_TYPES),
  difficulty: z.enum(HX_DIFFICULTIES).optional(),
  needs: z.array(z.enum(HX_NEEDS)).max(2).optional(),
});

const STEP = z.strictObject({
  title: text(160),
  role: text(40),
  together: z.boolean().optional().describe("Runs at the same time as the step before."),
});

const SHAPE = {
  summary: text(UI_BLOCK_LIMITS.title).describe("How many agents and how long, in the user's language."),
  // v1.6.7: up to 20 roles (the user, 2026-11-14), and up to 30 steps.
  roles: z.array(ROLE).min(1).max(20),
  steps: z.array(STEP).min(1).max(30),
  minutes: z.number().int().min(1).max(600).optional(),
  apps: z.array(text(60)).max(6).optional(),
  confirm: z.array(text(160)).max(4).optional().describe("Steps that wait for the user: sending, deleting, paying."),
};
const SCHEMA = z.object(SHAPE);

export const HX_PROPOSAL_TOOL_DEFINITION = {
  name: HX_PROPOSAL_TOOL,
  description: [
    "Show a proposal card before work with parts that can run at the same time, different skills, or a checker apart from the doer, and wait for the answer. HXBot adds each role's model.",
    'Result {"status":"answered","actionId":…}: start: with two or more roles, call hxbot.start_team with the same roles and steps; with one role, do it yourself; adjust: ask what to change, then propose again; one: do it all yourself; cancel: do not start; "_text": follow the words.',
  ].join(" "),
  shape: SHAPE,
};

const WORDS = {
  zh: {
    start: "开始",
    adjust: "改一改",
    one: "就用一个智能体",
    cancel: "取消",
    steps: "步骤",
    roles: "分工",
    together: "与上一步同时",
    apps: "要用到",
    confirm: "要你确认",
    cost: "花费",
    free: "免费",
    subscription: "订阅",
    paid: "按量付费",
    time: "时间",
    minutes: (count: number) => `约 ${count} 分钟`,
    costLine: (free: number, other: number) => `免费模型 ${free} 个角色，订阅或付费模型 ${other} 个角色`,
    noModel: "没有可用的模型",
    by: (name: string) => `由 ${name} 来做`,
    newMember: "新建一个成员",
    paren: (value: string) => `（${value}）`,
    colon: "：",
  },
  en: {
    start: "Start",
    adjust: "Change it",
    one: "Use one agent",
    cancel: "Cancel",
    steps: "Steps",
    roles: "Roles",
    together: "at the same time as the step before",
    apps: "Uses",
    confirm: "Waits for you",
    cost: "Cost",
    free: "free",
    subscription: "subscription",
    paid: "paid",
    time: "Time",
    minutes: (count: number) => `about ${count} min`,
    costLine: (free: number, other: number) => `${free} of ${free + other} roles on free models`,
    noModel: "no model is ready",
    by: (name: string) => `${name} takes it`,
    newMember: "a new member",
    paren: (value: string) => ` (${value})`,
    colon: ": ",
  },
};

/** Chinese when the agent wrote the summary in Chinese; otherwise English. */
function wordsFor(summary: string) {
  return /[㐀-鿿]/u.test(summary) ? WORDS.zh : WORDS.en;
}

/** One line of markdown text, with the characters that would start markdown taken out. */
function plain(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").replace(/[*_`#>[\]|\\]/gu, "");
}

export type HxProposalResult = { spec: UiBlockSpec } | { error: string };

/** The card for `propose_plan`, or the reason the agent must correct its call. */
export function hxProposalCard(router: HxAutoRouter, agentId: string, args: unknown): HxProposalResult {
  if (router.store.settings(agentId).proposal === "off")
    return { error: "The user turned the proposal card off for you. Start the work without it." };
  const parsed = SCHEMA.safeParse(args);
  if (!parsed.success) return { error: `${z.prettifyError(parsed.error)}\nCorrect the arguments and retry.` };
  const input = parsed.data;
  const names = new Set(input.roles.map((role) => role.name));
  if (names.size !== input.roles.length) return { error: "Each role needs a different name." };
  const unknown = input.steps.find((step) => !names.has(step.role));
  if (unknown) return { error: `The step "${unknown.title}" names the role "${unknown.role}", which is not in roles.` };
  const words = wordsFor(input.summary);
  let free = 0;
  let other = 0;
  // Who takes each role when the team starts (v1.6.6): an agent that fits it, or a new member.
  const takers = input.roles.length > 1 ? hxTeams.preview(agentId, input.roles) : [];
  const fields = input.roles.map((role, index) => {
    const model = router.roleModel(agentId, {
      kind: role.kind,
      work: role.work,
      difficulty: role.difficulty ?? "mid",
      needs: role.needs ?? [],
    });
    if (model?.cost === "free") free += 1;
    else if (model) other += 1;
    const label = model ? `${model.name}${words.paren(words[model.cost])}` : words.noModel;
    const taker = takers[index];
    const who = taker === undefined ? "" : ` · ${taker === null ? words.newMember : words.by(plain(taker))}`;
    return { label: role.name, value: `${plain(role.does)} · ${label}${who}`.slice(0, UI_BLOCK_LIMITS.text) };
  });
  // A card holds a few fields: with more roles than that, the roles go to the text under it.
  const manyRoles = fields.length + 1 > UI_BLOCK_LIMITS.confirmFields;
  const roleLines = manyRoles
    ? ["", `**${words.roles}**`, ...fields.map((field) => `- ${plain(field.label)}${words.colon}${field.value}`)]
    : [];
  if (manyRoles) fields.length = 0;
  if (input.minutes !== undefined) fields.push({ label: words.time, value: words.minutes(input.minutes) });
  const lines = [
    `**${words.steps}**`,
    ...input.steps.map(
      (step, index) =>
        `${index + 1}. ${plain(step.title)} · ${plain(step.role)}${step.together && index > 0 ? words.paren(words.together) : ""}`,
    ),
  ];
  if (input.apps?.length)
    lines.push("", `**${words.apps}**${words.colon}${input.apps.map(plain).join(words === WORDS.zh ? "、" : ", ")}`);
  if (input.confirm?.length)
    lines.push(
      "",
      `**${words.confirm}**${words.colon}${input.confirm.map(plain).join(words === WORDS.zh ? "；" : "; ")}`,
    );
  lines.push(...roleLines);
  lines.push("", `**${words.cost}**${words.colon}${words.costLine(free, other)}`);
  // v1.7.1 (CONC-12): the state of this computer, so the split is made knowing it. Numbers only.
  lines.push("", hxCapacityLine(words === WORDS.zh ? "zh" : "en", hxFlow.capacity()));
  const spec = normalizeUiBlockSpec({
    type: "confirm",
    title: input.summary,
    fields: fields.slice(0, UI_BLOCK_LIMITS.confirmFields),
    preview: lines.join("\n").slice(0, UI_BLOCK_LIMITS.preview),
    actions: [
      { id: HX_PROPOSAL_ACTIONS.start, label: words.start, style: "primary" },
      { id: HX_PROPOSAL_ACTIONS.adjust, label: words.adjust },
      ...(input.roles.length > 1 ? [{ id: HX_PROPOSAL_ACTIONS.one, label: words.one }] : []),
      { id: HX_PROPOSAL_ACTIONS.cancel, label: words.cancel, style: "ghost" },
    ],
  });
  return spec ? { spec } : { error: "The card is too long. Use shorter lines and retry." };
}

/**
 * The line of the instructions about the card, by the agent's setting: none when it is off, "when the
 * work calls for one" by default, "before each long task" when the user wants it every time.
 */
export function hxProposalInstruction(router: HxAutoRouter, agentId: string): string[] {
  const mode = router.store.settings(agentId).proposal;
  if (mode === "off") return [];
  return [
    mode === "always"
      ? "Before each long task, call hxbot.propose_plan first and wait for the user's answer, also when one agent is enough (then give one role)."
      : "When work has parts that can run at the same time, needs different skills, or needs a checker apart from the doer, or the user asks for several agents, call hxbot.propose_plan first and wait for the answer. The card is your first line; do not repeat it as prose.",
    // v1.6.6: the team that a card with two or more roles starts (hx-team).
    "After Start on a card with two or more roles, run hxbot.start_team with tool_call. For a team you started, hxbot.team gives its status, passes the user's words, stops it or swaps a member.",
    // v1.6.7: limits by the user's words, from any device. v1.7.1: a team has no limits by default.
    "A team has no limits by default. Only when the user names one for this team (members, minutes, handoffs, yuan, or no asking), pass it as limits to start_team, or to hxbot.team limits.",
  ];
}
