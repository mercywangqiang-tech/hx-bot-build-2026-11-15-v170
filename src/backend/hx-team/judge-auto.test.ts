import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HX_JUDGE_STREAK, HxJudgeAuto, hxJudgeSooner } from "./judge-auto";

let folder = "";
let auto: HxJudgeAuto;
const MODEL = { provider: "claude", model: "claude-haiku-5-5" };

function agree(times: number, agrees = true): void {
  for (let index = 0; index < times; index += 1)
    appendFileSync(join(folder, "hx-judge-agreement.jsonl"), `${JSON.stringify({ agrees, view: "continue" })}\n`);
}

function pass(score: number): void {
  writeFileSync(join(folder, "hx-judge-pass.json"), JSON.stringify([{ ...MODEL, score }]));
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "hx-judge-auto-"));
  auto = new HxJudgeAuto(() => folder);
});

afterEach(() => rmSync(folder, { recursive: true, force: true }));

describe("the judge's automatic mode (CONC-16)", () => {
  it("is advice by default, and with no data folder", () => {
    expect(auto.auto("G1")).toBe(false);
    expect(new HxJudgeAuto(() => null).auto("G1")).toBe(false);
    expect(new HxJudgeAuto(() => null).offer("G1", MODEL)).toBe(false);
  });

  it("is offered only for a passed model after 5 agreements in a row", () => {
    expect(auto.offer("G1", MODEL)).toBe(false);
    agree(HX_JUDGE_STREAK);
    // No pass list: not offered.
    expect(auto.offer("G1", MODEL)).toBe(false);
    pass(0.89);
    expect(auto.offer("G1", MODEL)).toBe(false);
    pass(0.9);
    expect(auto.offer("G1", MODEL)).toBe(true);
    expect(auto.offer("G1", { provider: "claude", model: "other" })).toBe(false);
    expect(auto.offer("G1", null)).toBe(false);
    // A disagreement breaks the streak; 5 more bring it back.
    agree(1, false);
    expect(auto.streak()).toBe(0);
    agree(4);
    expect(auto.offer("G1", MODEL)).toBe(false);
    agree(1);
    expect(auto.offer("G1", MODEL)).toBe(true);
  });

  it("a damaged line in the record breaks the streak, and a damaged pass list passes nothing", () => {
    pass(1);
    agree(5);
    appendFileSync(join(folder, "hx-judge-agreement.jsonl"), "not json\n");
    expect(auto.streak()).toBe(0);
    writeFileSync(join(folder, "hx-judge-pass.json"), "{");
    expect(auto.passed(MODEL)).toBe(false);
  });

  it("turns on only by set, and is not offered again while on", () => {
    pass(1);
    agree(5);
    auto.set("G2", true);
    expect(auto.auto("G2")).toBe(true);
    expect(auto.auto("G1")).toBe(false);
    expect(auto.offer("G2", MODEL)).toBe(false);
    auto.set("G2", false);
    expect(auto.auto("G2")).toBe(false);
  });

  it("goes back to advice after 2 stops that came after the judge let the team go on", () => {
    auto.set("G1", true);
    expect(auto.strike("G1")).toBe(false);
    expect(auto.auto("G1")).toBe(true);
    expect(auto.strike("G1")).toBe(true);
    expect(auto.auto("G1")).toBe(false);
    // A cause on advice takes no strike.
    expect(auto.strike("G3")).toBe(false);
  });

  it("keeps the fields of a later version, and reads a strange file as advice", () => {
    writeFileSync(
      join(folder, "hx-judge-auto.json"),
      JSON.stringify({ version: 2, later: [1], causes: { G1: { auto: "yes" } } }),
    );
    expect(auto.auto("G1")).toBe(false);
    auto.set("G3", true);
    const saved = JSON.parse(readFileSync(join(folder, "hx-judge-auto.json"), "utf8"));
    expect(saved.later).toEqual([1]);
    expect(saved.causes.G3.auto).toBe(true);
  });

  it("each pass makes the next check come after half, with a floor", () => {
    expect(hxJudgeSooner(30 * 60_000, 0, 60_000)).toBe(30 * 60_000);
    expect(hxJudgeSooner(30 * 60_000, 1, 60_000)).toBe(15 * 60_000);
    expect(hxJudgeSooner(30 * 60_000, 2, 60_000)).toBe(7.5 * 60_000);
    expect(hxJudgeSooner(3, 1, 2)).toBe(2);
    expect(hxJudgeSooner(20, 2, 5)).toBe(5);
  });
});
