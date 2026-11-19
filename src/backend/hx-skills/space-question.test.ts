// HXBot v1.7.4（BAK-03-A2）：版本空间满了的提问卡：三个选项、15 种语言、大小的写法、答案怎么读、问不了就是取消。
import { TRANSLATED_LOCALES } from "@hxbot/i18n";
import { describe, expect, it } from "vitest";
import { setHxAccessLocale } from "../hx-access/card";
import type { HxAsk } from "./ask";
import type { HxSpaceQuestion } from "./run";
import {
  HX_SPACE_QUESTION_ID,
  hxAskSpaceFull,
  hxSize,
  hxSpaceCard,
  hxSpaceChoice,
  hxSpaceLocale,
} from "./space-question";

const GIB = 1024 ** 3;
const full: HxSpaceQuestion = {
  path: "/Users/me/工作/季度报告.xlsx",
  why: "cap",
  usedBytes: 2 * GIB,
  capBytes: 2 * GIB,
  neededBytes: 12 * 1024 ** 2,
};

describe("the question when the space for versions is full", () => {
  it("names the file, the space and what is needed, with three choices, in Chinese and English", () => {
    const zh = hxSpaceCard(full, "zh");
    expect(zh.question).toMatchObject({
      id: HX_SPACE_QUESTION_ID,
      header: "版本空间",
      isSecret: false,
      question:
        "保留文件旧版本的空间满了（已用 2 GB，上限 2 GB）。要保留 季度报告.xlsx 修改前的版本，还需要 12 MB。怎么办？",
    });
    expect(zh.question.options?.map((option) => option.label)).toEqual([
      "删掉最早的旧版本",
      "这次不留版本",
      "取消修改",
    ]);
    expect([...zh.labels.values()]).toEqual(["clean-old", "no-version", "cancel"]);
    const en = hxSpaceCard({ ...full, why: "disk" }, "en");
    expect(en.question.question).toBe(
      "The disk has no room to keep the version of 季度报告.xlsx before this change (it needs 12 MB). What should HXBot do?",
    );
    expect(en.question.options?.every((option) => option.description.length > 0)).toBe(true);
  });

  it("is written in every language of the app, with the numbers in place", () => {
    for (const locale of TRANSLATED_LOCALES) {
      const card = hxSpaceCard(full, locale);
      expect(card.question.question, locale).toContain("季度报告.xlsx");
      expect(card.question.question, locale).toContain("12 MB");
      expect(card.question.question, locale).not.toMatch(/\{\w+\}/u);
      expect(new Set(card.question.options?.map((option) => option.label)).size, locale).toBe(3);
      if (locale !== "en") expect(card.question.header, locale).not.toBe("Version space");
    }
  });

  it("reads the app's language from the language service", () => {
    setHxAccessLocale("de");
    expect(hxSpaceLocale()).toBe("de");
    expect(hxSpaceCard(full).question.header).toBe("Platz für Versionen");
    expect(hxSpaceLocale("pt-BR")).toBe("pt");
    expect(hxSpaceLocale("xx")).toBe("en");
    setHxAccessLocale("zh");
    expect(hxSpaceLocale()).toBe("zh");
  });

  it("writes sizes as a person reads them", () => {
    expect([0, 512, 1024, 1536, 10 * 1024 ** 2, 12.34 * 1024 ** 2, 1.25 * GIB, 20 * GIB].map(hxSize)).toEqual([
      "0 KB",
      "0.5 KB",
      "1 KB",
      "1.5 KB",
      "10 MB",
      "12 MB",
      "1.3 GB",
      "20 GB",
    ]);
    expect(hxSize(-5)).toBe("0 KB");
  });

  it("reads an answer by its label in any language, else cancels: nothing is deleted that was not chosen", () => {
    const zh = hxSpaceCard(full, "zh");
    const answer = (...values: string[]) => ({ [HX_SPACE_QUESTION_ID]: values });
    expect(hxSpaceChoice(answer("删掉最早的旧版本"), zh.labels)).toBe("clean-old");
    expect(hxSpaceChoice(answer(" 这次不留版本 "), zh.labels)).toBe("no-version");
    expect(hxSpaceChoice(answer("取消修改"), zh.labels)).toBe("cancel");
    // The language changed while the card waited: the English label still reads.
    expect(hxSpaceChoice(answer("Remove the oldest versions"), zh.labels)).toBe("clean-old");
    expect(hxSpaceChoice(answer("no-version"), zh.labels)).toBe("no-version");
    // A typed answer, two answers, no answer, another question: cancel.
    expect(hxSpaceChoice(answer("都删了吧"), zh.labels)).toBe("cancel");
    expect(hxSpaceChoice(answer("删掉最早的旧版本", "这次不留版本"), zh.labels)).toBe("cancel");
    expect(hxSpaceChoice(answer(), zh.labels)).toBe("cancel");
    expect(hxSpaceChoice({ other: ["删掉最早的旧版本"] }, zh.labels)).toBe("cancel");
    expect(hxSpaceChoice(null, zh.labels)).toBe("cancel");
  });

  it("asks through the conversation, marks the choices only the owner may make, and cancels when nobody answers", async () => {
    setHxAccessLocale("zh");
    const seen: { owner: boolean[] } = { owner: [] };
    const answering =
      (value: string | null): HxAsk =>
      async (questions, ownerOnly) => {
        expect(questions).toHaveLength(1);
        seen.owner = ["删掉最早的旧版本", "这次不留版本", "取消修改"].map((label) =>
          ownerOnly({ [HX_SPACE_QUESTION_ID]: [label] }),
        );
        return value === null ? null : { [HX_SPACE_QUESTION_ID]: [value] };
      };
    const signal = new AbortController().signal;
    expect(await hxAskSpaceFull(answering("这次不留版本"), full, signal)).toBe("no-version");
    expect(seen.owner).toEqual([true, true, false]);
    expect(await hxAskSpaceFull(answering(null), full, signal)).toBe("cancel");
    const failing: HxAsk = async () => {
      throw new Error("the card could not be shown");
    };
    expect(await hxAskSpaceFull(failing, full, signal)).toBe("cancel");
  });
});
