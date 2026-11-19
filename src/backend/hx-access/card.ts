// HXBot：确认卡片。智能体说明为什么要做、用来做什么、对哪些对象做什么，客户选“允许一次”“始终允许”或“拒绝”。
// “始终允许”存成规则，对所有智能体有效，直到在“设置 → 授权与记录”里删除；付款没有“始终允许”。
import type { AgentPromptQuestion } from "@hxbot/contracts/ipc";
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import {
  ACCESS_ACTIONS,
  ACCESS_TARGET_TYPES,
  type AccessAction,
  type AccessTarget,
  type AccessTargetType,
  siteHost,
} from "./policy";

export const ACCESS_QUESTION_ID = "hx-access";
const MAX_TARGETS = 10;
const MAX_TEXT = 400;
const MAX_VALUE = 300;

export interface AccessRequest {
  reason: string;
  purpose: string;
  targets: AccessTarget[];
  actions: AccessAction[];
}

export type AccessChoice = "once" | "always" | "refuse";

export type AccessLocale = "zh" | "en";

/** The host language of the card: Chinese unless the app shows another language. */
let currentLocale: AccessLocale = "zh";
/** HXBot (v1.7.4): the app's whole language tag, for the cards that are written in all 15 languages. */
let appLocale = "zh";
export function setHxAccessLocale(locale: string): void {
  currentLocale = locale.toLowerCase().startsWith("zh") ? "zh" : "en";
  appLocale = locale;
}

/** The language the app shows now, as the language service gives it (such as "zh" or "de"). */
export function hxAppLocale(): string {
  return appLocale;
}
export function hxAccessLocale(): AccessLocale {
  return currentLocale;
}

const TEXT = {
  zh: {
    header: "需要你确认",
    intro: (agent: string) => `**${agent}** 要做下面的事，需要你确认：`,
    reason: "为什么",
    purpose: "做什么",
    targets: "对象",
    footer:
      "允许一次：只这一次，每个对象用一次。始终允许：以后所有助手对这些对象做同样的事都不再问，可以在“设置 → 授权与记录”里删除。拒绝或跳过：不做。",
    folderFooter:
      "允许一次：只这一次，每个对象用一次。始终允许这个文件夹：以后所有助手在这些文件所在的文件夹里做同样的事都不再问，可以在“设置 → 授权与记录”里删除。拒绝或跳过：不做。",
    paymentFooter: "付款每次都要确认。允许一次：只这一次。拒绝或跳过：不付。",
    commandNote: "命令会以你的身份在这台电脑上运行。",
    type: {
      folder: "文件夹",
      file: "文件",
      website: "网站",
      command: "命令",
      screen: "屏幕截图",
      search: "网络搜索",
      password: "用保存的密码登录",
      payment: "在网页上填银行卡付款",
      vault: "删除保密箱里的条目",
    } satisfies Record<AccessTargetType, string>,
    anyCommand: "所有命令",
    action: { read: "读取", write: "修改", delete: "删除" } satisfies Record<AccessAction, string>,
    doing: "要做的",
    choice: {
      once: { label: "允许一次", description: "只这一次" },
      always: { label: "始终允许", description: "以后不再问，可以在设置里删除" },
      refuse: { label: "拒绝", description: "不做" },
    } satisfies Record<AccessChoice, { label: string; description: string }>,
    alwaysFolder: "这个文件夹以后不再问，可以在设置里删除",
  },
  en: {
    header: "Needs your OK",
    intro: (agent: string) => `**${agent}** wants to do the following and needs your OK:`,
    reason: "Why",
    purpose: "What for",
    targets: "On",
    footer:
      "Allow once: this time only, each item once. Always allow: no agent asks again for the same on these items; remove it under Settings → Access & activity. Refuse or Skip: it is not done.",
    folderFooter:
      "Allow once: this time only, each item once. Always allow: no agent asks again for the same in the folders of these files; remove it under Settings → Access & activity. Refuse or Skip: it is not done.",
    paymentFooter: "Every payment needs your OK. Allow once: this time only. Refuse or Skip: no payment.",
    commandNote: "Commands run on this computer as you.",
    type: {
      folder: "Folder",
      file: "File",
      website: "Website",
      command: "Command",
      screen: "Screenshot",
      search: "Web search",
      password: "Sign in with a saved password",
      payment: "Pay with a card on a web page",
      vault: "Delete a Vault item",
    } satisfies Record<AccessTargetType, string>,
    anyCommand: "Any command",
    action: { read: "read", write: "change", delete: "delete" } satisfies Record<AccessAction, string>,
    doing: "To do",
    choice: {
      once: { label: "Allow once", description: "This time only" },
      always: { label: "Always allow", description: "Never asks again; remove it in Settings" },
      refuse: { label: "Refuse", description: "It is not done" },
    } satisfies Record<AccessChoice, { label: string; description: string }>,
    alwaysFolder: "Never asks again for this folder; remove it in Settings",
  },
} as const;

function clip(text: string, limit: number): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

/** Markdown code that cannot be closed by the value inside it. */
function code(value: string): string {
  return `\`${value.replaceAll("`", "'")}\``;
}

/** Targets whose value is a website: the confirmation is for that site. */
const SITE_TYPES: ReadonlySet<AccessTargetType> = new Set(["website", "password", "payment"]);

/**
 * The request in the tool arguments, with paths made absolute against `cwd`. A string explains what
 * is wrong, for the agent to correct.
 */
export function parseAccessRequest(args: unknown, resolvePath: (path: string) => string): AccessRequest | string {
  if (!isDynamicRecord(args)) return "Give reason, purpose, targets and actions.";
  const record = args;
  const reason = typeof record.reason === "string" ? clip(record.reason, MAX_TEXT) : "";
  const purpose = typeof record.purpose === "string" ? clip(record.purpose, MAX_TEXT) : "";
  if (!reason) return "Say why you need it in reason.";
  if (!purpose) return "Say what you will do in purpose.";
  const rawActions = Array.isArray(record.actions) ? record.actions : [];
  const actions = ACCESS_ACTIONS.filter((action) => rawActions.includes(action));
  const rawTargets = Array.isArray(record.targets) ? record.targets : [];
  if (rawTargets.length === 0) return "List the targets.";
  if (rawTargets.length > MAX_TARGETS) return `Ask for at most ${MAX_TARGETS} targets at once.`;
  const targets: AccessTarget[] = [];
  for (const raw of rawTargets) {
    if (!isDynamicRecord(raw)) return "Each target is {type, value}.";
    const target = raw;
    const type = ACCESS_TARGET_TYPES.find((item) => item === target.type);
    if (!type) return `A target type is one of ${ACCESS_TARGET_TYPES.join(", ")}.`;
    const value = typeof target.value === "string" ? target.value.trim() : "";
    if (type === "screen" || type === "search") {
      targets.push({ type, value: "" });
      continue;
    }
    if (!value || value.length > MAX_VALUE) return `Give the ${type} as value, at most ${MAX_VALUE} characters.`;
    if (SITE_TYPES.has(type)) {
      const host = siteHost(value);
      if (!host) return `"${clip(value, 80)}" is not a website address.`;
      targets.push({ type, value: host });
      continue;
    }
    if (type === "command" || type === "vault") {
      targets.push({ type, value: value.replace(/\s+/gu, " ") });
      continue;
    }
    targets.push({ type, value: resolvePath(value) });
  }
  const files = targets.some((target) => target.type === "folder" || target.type === "file");
  if (files && actions.length === 0) return 'For files and folders, ask for the actions: "read", "write" or "delete".';
  return { reason, purpose, targets, actions: files ? actions : ACCESS_ACTIONS.filter((action) => action !== "read") };
}

/**
 * The targets of an Always allow rule: a file stands for its folder (始终允许这个文件夹), so the
 * next file there is not asked again. The rest stay as they were asked for.
 */
export function accessRuleTargets(
  targets: readonly AccessTarget[],
  folderOf: (path: string) => string,
): AccessTarget[] {
  const seen = new Set<string>();
  const rule: AccessTarget[] = [];
  for (const target of targets) {
    const item: AccessTarget = target.type === "file" ? { type: "folder", value: folderOf(target.value) } : target;
    const key = `${item.type}\u0000${item.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rule.push(item);
  }
  return rule;
}

/** True when the request pays: such a confirmation is given once, never always. */
export function accessIsPayment(request: AccessRequest): boolean {
  return request.targets.some((target) => target.type === "payment");
}

/** The card: the reason, the purpose, what is done and on what, with Allow once, Always allow and Refuse. */
export function accessQuestion(
  request: AccessRequest,
  agentName: string,
  locale: AccessLocale = currentLocale,
): AgentPromptQuestion {
  const text = TEXT[locale];
  const colon = locale === "en" ? ":" : "：";
  const targets = request.targets.map((target) => {
    const name = text.type[target.type];
    if (target.type === "screen" || target.type === "search") return `- ${name}`;
    if (target.type === "command") return `- ${name} ${target.value === "*" ? text.anyCommand : code(target.value)}`;
    if (SITE_TYPES.has(target.type)) return `- ${name} ${target.value}`;
    if (target.type === "vault") return `- ${name} ${code(target.value)}`;
    return `- ${name} ${code(target.value)}`;
  });
  const files = request.targets.some((target) => target.type === "folder" || target.type === "file");
  const commands = request.targets.some((target) => target.type === "command");
  const payment = accessIsPayment(request);
  const footer = payment ? text.paymentFooter : files ? text.folderFooter : text.footer;
  const question = [
    text.intro(clip(agentName, 80) || "HXBot"),
    "",
    `**${text.reason}${colon}** ${request.reason}`,
    "",
    `**${text.purpose}${colon}** ${request.purpose}`,
    "",
    ...(files
      ? [
          `**${text.doing}${colon}** ${request.actions.map((action) => text.action[action]).join(locale === "en" ? ", " : "、")}`,
          "",
        ]
      : []),
    `**${text.targets}${colon}**`,
    ...targets,
    "",
    commands ? `${footer}${locale === "zh" ? "" : " "}${text.commandNote}` : footer,
  ].join("\n");
  const choices: AccessChoice[] = payment ? ["once", "refuse"] : ["once", "always", "refuse"];
  return {
    id: ACCESS_QUESTION_ID,
    header: text.header,
    question: question.length > 2000 ? `${question.slice(0, 1999)}…` : question,
    isSecret: false,
    options: choices.map((choice) =>
      choice === "always" && files
        ? { label: text.choice.always.label, description: text.alwaysFolder }
        : { ...text.choice[choice] },
    ),
    multiSelect: false,
  };
}

function labelsOf(choice: AccessChoice): string[] {
  return [TEXT.zh.choice[choice].label, TEXT.en.choice[choice].label];
}

/** What the user chose on the card. Nothing chosen, or anything else, refuses. */
export function accessChoice(answers: Readonly<Record<string, readonly string[]>>): AccessChoice {
  const picked = new Set(answers[ACCESS_QUESTION_ID] ?? []);
  if (labelsOf("always").some((label) => picked.has(label))) return "always";
  if (labelsOf("once").some((label) => picked.has(label))) return "once";
  return "refuse";
}

/** What the user wrote in the card's own answer field, besides the choice: a condition for the agent. */
export function accessNote(answers: Readonly<Record<string, readonly string[]>>): string {
  const labels = new Set((["once", "always", "refuse"] as const).flatMap(labelsOf));
  return clip(
    (answers[ACCESS_QUESTION_ID] ?? [])
      .filter((answer) => !labels.has(answer))
      .join(" ")
      .trim(),
    400,
  );
}
