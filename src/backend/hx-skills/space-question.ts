// HXBot v1.7.4（BAK-03-A2）：版本空间满了，修改停下来问你：删掉最早的旧版本、这次不留版本、取消修改。
// 不问就不删任何旧版本；没人能答（外部聊天、停止、到时间）就是取消。卡片用界面的语言写（15 种）。
import { hxByteSize } from "@hxbot/contracts/hx-file-change";
import type { AgentPromptQuestion } from "@hxbot/contracts/ipc";
import { TRANSLATED_LOCALES, type TranslatedLocale } from "@hxbot/i18n";
import { sourceTranslateFor } from "@hxbot/i18n/source";
import { hxAppLocale } from "../hx-access/card";
import type { HxAsk, HxAskAnswers } from "./ask";
import type { HxSpaceChoice, HxSpaceQuestion } from "./run";

export const HX_SPACE_QUESTION_ID = "hx-version-space";

const CHOICES: readonly HxSpaceChoice[] = ["clean-old", "no-version", "cancel"];

/** The app's language as one of the translated locales (a tag such as "zh-CN" reads "zh"). */
export function hxSpaceLocale(tag: string = hxAppLocale()): TranslatedLocale {
  const lower = tag.toLowerCase();
  return (
    TRANSLATED_LOCALES.find((locale) => locale.toLowerCase() === lower) ??
    TRANSLATED_LOCALES.find((locale) => lower.startsWith(`${locale.toLowerCase()}-`)) ??
    "en"
  );
}

/** A size as a person reads it (the same words as Settings → Computer Use). */
export const hxSize = hxByteSize;

/** The file's name for the card: the last part of the path, cut at 80 characters. */
function fileName(path: string): string {
  const name = path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
  return name.length > 80 ? `${name.slice(0, 79)}…` : name;
}

/** The card, and the label of each choice in its language. */
export function hxSpaceCard(
  question: HxSpaceQuestion,
  locale: TranslatedLocale = hxSpaceLocale(),
): { question: AgentPromptQuestion; labels: ReadonlyMap<string, HxSpaceChoice> } {
  const t = sourceTranslateFor(locale);
  const file = fileName(question.path);
  const needed = hxSize(question.neededBytes);
  const text =
    question.why === "cap"
      ? t("status.agent.hxSkill.space.cap", {
          file,
          used: hxSize(question.usedBytes),
          cap: hxSize(question.capBytes),
          needed,
        })
      : t("status.agent.hxSkill.space.disk", { file, needed });
  const options = [
    {
      choice: "clean-old" as const,
      label: t("status.agent.hxSkill.space.cleanOld"),
      description: t("status.agent.hxSkill.space.cleanOldDetail"),
    },
    {
      choice: "no-version" as const,
      label: t("status.agent.hxSkill.space.noVersion"),
      description: t("status.agent.hxSkill.space.noVersionDetail"),
    },
    {
      choice: "cancel" as const,
      label: t("status.agent.hxSkill.space.cancel"),
      description: t("status.agent.hxSkill.space.cancelDetail"),
    },
  ];
  return {
    question: {
      id: HX_SPACE_QUESTION_ID,
      header: t("status.agent.hxSkill.space.header"),
      question: text,
      detail: t("status.agent.hxSkill.space.detail"),
      isSecret: false,
      options: options.map(({ label, description }) => ({ label, description })),
    },
    labels: new Map(options.map(({ choice, label }) => [label, choice])),
  };
}

/**
 * The choice an answer gives. A choice is read by its label, in any of the languages (the language
 * may have changed while the card waited), or by its name; anything else, such as a typed answer,
 * is "cancel": nothing is deleted that the user did not choose to delete.
 */
export function hxSpaceChoice(answers: HxAskAnswers | null, labels: ReadonlyMap<string, HxSpaceChoice>): HxSpaceChoice {
  const answer = answers?.[HX_SPACE_QUESTION_ID];
  if (answer?.length !== 1) return "cancel";
  const picked = (answer[0] ?? "").trim();
  const exact = labels.get(picked);
  if (exact) return exact;
  if (CHOICES.some((choice) => choice === picked)) return CHOICES.find((choice) => choice === picked) ?? "cancel";
  for (const locale of TRANSLATED_LOCALES) {
    for (const [label, choice] of hxSpaceCard(SAMPLE, locale).labels) if (label === picked) return choice;
  }
  return "cancel";
}

const SAMPLE: HxSpaceQuestion = { path: "x", why: "cap", usedBytes: 0, capBytes: 0, neededBytes: 0 };

/** Asks the space question through the conversation; "cancel" when nobody can answer. */
export async function hxAskSpaceFull(
  ask: HxAsk,
  question: HxSpaceQuestion,
  signal: AbortSignal,
): Promise<HxSpaceChoice> {
  const card = hxSpaceCard(question);
  const answers = await ask([card.question], (given) => hxSpaceChoice(given, card.labels) !== "cancel", signal).catch(
    () => null,
  );
  return hxSpaceChoice(answers, card.labels);
}
