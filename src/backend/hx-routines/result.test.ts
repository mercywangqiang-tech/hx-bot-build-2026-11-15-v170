// @vitest-environment node
import type { ConversationMessage } from "@hxbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { type HxRunJudgeInput, hxClaimedFiles, hxJudgeRun } from "./result";

// RTN-04: a finished turn is not a success; success needs what the run had to do to be read back.
const tool = (itemType = "commandExecution"): ConversationMessage => ({
  id: `tool-${itemType}`,
  turnId: "turn",
  author: "assistant",
  text: "ran",
  createdAt: "2026-11-20T00:00:00.000Z",
  status: "completed",
  itemType,
});

function input(overrides: Partial<HxRunJudgeInput>): HxRunJudgeInput {
  return {
    outcome: "completed",
    reportedFailure: undefined,
    noUpdate: false,
    answer: "Done.",
    turnMessages: [tool()],
    instruction: "Summarize the news.",
    workspace: "/work",
    unknownActions: 0,
    exists: () => true,
    ...overrides,
  };
}

describe("hxJudgeRun", () => {
  it("is not verified when the answer says done but the file it saved is not there (RTN-04-A1)", () => {
    const judgement = hxJudgeRun(
      input({ answer: "已完成，报告已保存到 /work/report.md", exists: (path) => path !== "/work/report.md" }),
    );
    expect(judgement).toEqual({ kind: "unverified", reasons: ["missing-file"], missing: ["/work/report.md"] });
  });

  it("reads back a relative file that the answer saved, in the agent's workspace", () => {
    const seen: string[] = [];
    const judgement = hxJudgeRun(
      input({
        answer: "I saved it as summary.xlsx.",
        exists: (path) => {
          seen.push(path);
          return true;
        },
      }),
    );
    expect(seen).toEqual(["/work/summary.xlsx"]);
    expect(judgement.kind).toBe("succeeded");
  });

  it("records no update for a daily report with no change, and sends nothing (RTN-04-A2)", () => {
    expect(hxJudgeRun(input({ noUpdate: true, answer: undefined, turnMessages: [] }))).toEqual({
      kind: "no-update",
      reasons: [],
      missing: [],
    });
  });

  it("never lets no update hide an external action whose result is not known", () => {
    expect(hxJudgeRun(input({ noUpdate: true, unknownActions: 1 })).kind).toBe("unverified");
  });

  it("is failed for a failed, interrupted or reported-failed run", () => {
    expect(hxJudgeRun(input({ outcome: "failed" })).kind).toBe("failed");
    expect(hxJudgeRun(input({ outcome: "interrupted" })).kind).toBe("failed");
    expect(hxJudgeRun(input({ reportedFailure: "The site was down." })).reasons).toEqual(["reported-failure"]);
  });

  it("is not verified when a task that sends ends without a single tool step", () => {
    const judgement = hxJudgeRun(input({ instruction: "每天发消息给团队群", turnMessages: [] }));
    expect(judgement.reasons).toEqual(["no-tool-step"]);
    expect(hxJudgeRun(input({ instruction: "每天发消息给团队群", turnMessages: [tool("mcpToolCall")] })).kind).toBe(
      "succeeded",
    );
  });

  it("is not verified when a changed file could not be read back", () => {
    const card: ConversationMessage = {
      ...tool("hx-file-change"),
      text: "Changed a.xlsx\nHXBot could not read the file back to check it.\n/work/a.xlsx\n\n- A1: 1 → 2",
    };
    expect(hxJudgeRun(input({ turnMessages: [tool(), card] })).reasons).toEqual(["file-not-read-back"]);
  });

  it("succeeds with nothing open", () => {
    expect(hxJudgeRun(input({})).kind).toBe("succeeded");
  });
});

describe("hxClaimedFiles", () => {
  it("finds full paths and saved files, and leaves out links and plain words", () => {
    expect(
      hxClaimedFiles(
        "Report: /Users/me/out/report.pdf. See https://example.com/a.html and saved to notes.md, then 已导出到 C:\\data\\x.csv",
        "/work",
      ),
    ).toEqual(["/Users/me/out/report.pdf", "C:\\data\\x.csv", "/work/notes.md"]);
    expect(hxClaimedFiles("Nothing changed today.", "/work")).toEqual([]);
    expect(hxClaimedFiles("saved to notes.md", null)).toEqual([]);
  });
});
