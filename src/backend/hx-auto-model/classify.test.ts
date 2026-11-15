import { describe, expect, it } from "vitest";
import { HX_FOLLOW_UP_MS, HX_JUDGE_BELOW, hxClassifyWork, hxTextTokens } from "./classify";
import { HX_CLASSIFY_CASES, HX_CLASSIFY_FRESH, HX_CLASSIFY_HOLDOUT, type HxClassifyCase } from "./classify-cases";

const base = { attachments: [], historyTokens: 0, window: 128_000, previous: null, now: 1_000_000 } as const;

function score(cases: readonly HxClassifyCase[]) {
  let right = 0;
  const byWork = new Map<string, { right: number; all: number }>();
  for (const item of cases) {
    const result = hxClassifyWork({ ...base, text: item.text, attachments: item.attachments ?? [] });
    const entry = byWork.get(item.work) ?? { right: 0, all: 0 };
    entry.all += 1;
    if (result.work === item.work) {
      right += 1;
      entry.right += 1;
    }
    byWork.set(item.work, entry);
  }
  return { share: right / cases.length, byWork };
}

describe("the classifier on its test sets", () => {
  it("has 270, 90 and 90 messages: 9 kinds, Chinese and English", () => {
    expect(HX_CLASSIFY_CASES).toHaveLength(270);
    expect(HX_CLASSIFY_HOLDOUT).toHaveLength(90);
    expect(HX_CLASSIFY_FRESH).toHaveLength(90);
    for (const cases of [HX_CLASSIFY_CASES, HX_CLASSIFY_HOLDOUT, HX_CLASSIFY_FRESH]) {
      const kinds = new Set(cases.map((item) => item.work));
      expect(kinds.size).toBe(9);
    }
  });

  it("gets 95% of the set it was tuned on, and every image and every long material", () => {
    const { share, byWork } = score(HX_CLASSIFY_CASES);
    expect(share).toBeGreaterThanOrEqual(0.95);
    expect(byWork.get("vision")).toEqual({ right: 30, all: 30 });
    expect(byWork.get("long-context")).toEqual({ right: 30, all: 30 });
  });

  it("gets 95% of the second set, which widened the word lists", () => {
    expect(score(HX_CLASSIFY_HOLDOUT).share).toBeGreaterThanOrEqual(0.95);
  });

  it("gets 80% of the third set by the rules alone; the rest goes to the judge or keeps the model", () => {
    // Measured once before any change: 66.7% (60 of 90), 30 below the judge's threshold. After the
    // general fixes of the words (GitHub is not git, "open the new store" is not an app): 84.4%.
    const { share, byWork } = score(HX_CLASSIFY_FRESH);
    expect(share).toBeGreaterThanOrEqual(0.8);
    expect(byWork.get("vision")).toEqual({ right: 10, all: 10 });
    expect(byWork.get("long-context")).toEqual({ right: 10, all: 10 });
    // A wrong answer of the rules is mostly an unsure one, which the judge reads again.
    const sureAndWrong = HX_CLASSIFY_FRESH.filter((item) => {
      const result = hxClassifyWork({ ...base, text: item.text, attachments: item.attachments ?? [] });
      return result.work !== item.work && result.confidence >= 0.7;
    });
    expect(sureAndWrong.length).toBeLessThanOrEqual(5);
  });
});

describe("the classifier's rules", () => {
  it("needs a model that reads images for any image, whatever the words say", () => {
    const result = hxClassifyWork({ ...base, text: "写一篇文章", attachments: [{ name: "a.PNG", size: 10 }] });
    expect(result.work).toBe("vision");
    expect(result.needs).toEqual(["vision"]);
    expect(result.confidence).toBe(1);
  });

  it("needs a larger window when the material passes 70% of the current one", () => {
    const small = hxClassifyWork({ ...base, text: "总结", attachments: [{ name: "a.txt", size: 300_000 }] });
    expect(small.needs).toEqual([]);
    const large = hxClassifyWork({ ...base, text: "总结", attachments: [{ name: "a.txt", size: 400_000 }] });
    expect(large.work).toBe("long-context");
    expect(large.needs).toEqual(["long-context"]);
    expect(large.difficulty).toBe("high");
    // The chat that goes with the message counts too.
    const history = hxClassifyWork({ ...base, text: "继续写", historyTokens: 95_000 });
    expect(history.needs).toEqual(["long-context"]);
  });

  it("keeps the last work for a short follow-up, only while it is recent", () => {
    const previous = { work: "code-large" as const, difficulty: "high" as const, at: base.now - 60_000 };
    for (const text of ["继续", "好的", "ok", "go on", "再改一下"]) {
      const result = hxClassifyWork({ ...base, text, previous });
      expect(result).toMatchObject({ work: "code-large", followUp: true, difficulty: "high" });
    }
    const old = { ...previous, at: base.now - HX_FOLLOW_UP_MS - 1 };
    expect(hxClassifyWork({ ...base, text: "继续", previous: old }).followUp).toBe(false);
    // A follow-up with a new file is new work.
    const file = hxClassifyWork({ ...base, text: "继续", previous, attachments: [{ name: "b.csv", size: 10 }] });
    expect(file.followUp).toBe(false);
  });

  it("reads 重做 and redo as a redo of the last work, at high difficulty", () => {
    const previous = { work: "writing" as const, difficulty: "low" as const, at: base.now - 60_000 };
    for (const text of ["重做", "redo", "Try again."]) {
      expect(hxClassifyWork({ ...base, text, previous })).toMatchObject({
        work: "writing",
        redo: true,
        difficulty: "high",
      });
    }
    // With no work before it, it is only a word.
    expect(hxClassifyWork({ ...base, text: "重做" }).redo).toBe(false);
  });

  it("is unsure when nothing names the work", () => {
    const result = hxClassifyWork({ ...base, text: "这个怎么弄" });
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.signals).toContain("no-signal");
  });

  it("sets the difficulty from the length and the words", () => {
    expect(hxClassifyWork({ ...base, text: "修一下这个拼写错误" }).difficulty).toBe("low");
    expect(hxClassifyWork({ ...base, text: "重构整个项目的数据库层" }).difficulty).toBe("high");
    expect(hxClassifyWork({ ...base, text: `写一篇文章：${"内容".repeat(300)}` }).difficulty).toBe("high");
  });

  it("counts about one token per Chinese character and one per four other characters", () => {
    expect(hxTextTokens("你好")).toBe(2);
    expect(hxTextTokens("abcdefgh")).toBe(2);
    expect(hxTextTokens("")).toBe(0);
  });
  it("takes a greeting or a thank-you for a chat, sure enough to ask no judge (v1.7.0)", () => {
    for (const text of ["你好", "Hello.", "hi!", "谢谢！", "thank you"]) {
      const result = hxClassifyWork({ ...base, text });
      expect(result.work, text).toBe("chat");
      expect(result.confidence, text).toBeGreaterThanOrEqual(HX_JUDGE_BELOW);
    }
    expect(hxClassifyWork({ ...base, text: "你好，帮我写一份周报" }).signals).not.toContain("greeting");
  });
});
