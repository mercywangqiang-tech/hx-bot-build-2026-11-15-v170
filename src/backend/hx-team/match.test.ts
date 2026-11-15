import { describe, expect, it } from "vitest";
import { type HxMatchAgent, hxMatchRoles, hxMatchScore, hxWords } from "./match";

const agent = (id: string, name: string, title = "", description = "", extra: Partial<HxMatchAgent> = {}) => ({
  id,
  name,
  title,
  description,
  hidden: false,
  busy: false,
  ...extra,
});

const AGENTS: HxMatchAgent[] = [
  agent("me", "前台助手", "我自己", "写作 数据 方案"),
  agent("w", "文案小王", "写作与文案", "负责公众号文章和产品介绍的写作"),
  agent("d", "Data Dan", "Data analyst", "Builds spreadsheets and charts from sales data"),
  agent("c", "检查员", "校对和检查", "检查文字、数字和格式"),
  agent("h", "Hidden writer", "Writing", "writing", { hidden: true }),
];

describe("hxWords", () => {
  it("keeps Latin words of three letters or more and each pair of CJK characters, without filler words", () => {
    const words = hxWords("The Writer writes 公众号文章 for agents");
    expect(words.has("writer")).toBe(true);
    expect(words.has("the")).toBe(false);
    expect(words.has("agent")).toBe(false);
    expect([...words].filter((word) => /[一-鿿]/u.test(word))).toEqual(["公众", "众号", "号文", "文章"]);
  });
});

describe("hxMatchRoles", () => {
  it("gives each role the agent whose name, title and description fit it", () => {
    const matches = hxMatchRoles(
      [
        { name: "写作者", does: "写公众号文章", workWords: ["writing", "写作"] },
        { name: "Analyst", does: "make charts of the sales data", workWords: ["data", "数据"] },
        { name: "检查员", does: "检查数字和格式", workWords: ["reasoning"] },
      ],
      AGENTS,
      "me",
    );
    expect(matches).toEqual([
      { kind: "matched", agentId: "w", score: expect.any(Number) },
      { kind: "matched", agentId: "d", score: expect.any(Number) },
      { kind: "matched", agentId: "c", score: expect.any(Number) },
    ]);
  });

  it("never gives a role to the starter or a hidden agent, and makes a member when nothing fits", () => {
    const matches = hxMatchRoles([{ name: "Designer", does: "draw the poster", workWords: ["image"] }], AGENTS, "me");
    expect(matches).toEqual([{ kind: "new" }]);
    const writers = hxMatchRoles(
      [
        { name: "Writer", does: "writing", workWords: ["writing"] },
        { name: "方案", does: "写方案", workWords: ["方案"] },
      ],
      [agent("me", "Writer", "Writing", "writing"), ...AGENTS.slice(4)],
      "me",
    );
    expect(writers).toEqual([{ kind: "new" }, { kind: "new" }]);
  });

  it("puts a named agent first, and gives each agent one role at most", () => {
    const matches = hxMatchRoles(
      [
        { name: "写作者", does: "写文章", workWords: ["写作"], agentId: "c" },
        { name: "写作者二", does: "写作 文案", workWords: ["写作"] },
        { name: "写作者三", does: "写作 文案", workWords: ["写作"] },
      ],
      AGENTS,
      "me",
    );
    expect(matches[0]).toEqual({ kind: "named", agentId: "c" });
    expect(matches[1]).toEqual({ kind: "matched", agentId: "w", score: expect.any(Number) });
    expect(matches[2]).toEqual({ kind: "new" });
  });

  it("ignores a named agent that is the starter, hidden or unknown", () => {
    const matches = hxMatchRoles(
      [
        { name: "A", does: "x", workWords: [], agentId: "me" },
        { name: "B", does: "x", workWords: [], agentId: "h" },
        { name: "C", does: "x", workWords: [], agentId: "nobody" },
      ],
      AGENTS,
      "me",
    );
    expect(matches).toEqual([{ kind: "new" }, { kind: "new" }, { kind: "new" }]);
  });

  it("prefers a free agent over a busy one with the same fit", () => {
    const agents = [agent("busy", "Writer A", "Writing", "", { busy: true }), agent("free", "Writer B", "Writing", "")];
    expect(hxMatchRoles([{ name: "Writer", does: "writing", workWords: ["writing"] }], agents, "me")).toEqual([
      { kind: "matched", agentId: "free", score: expect.any(Number) },
    ]);
  });

  it("scores the role name and the agent's name and title above the description", () => {
    const role = { name: "Translator", does: "translate the manual", workWords: [] };
    expect(hxMatchScore(role, agent("t", "Translator", "", ""))).toBeGreaterThan(
      hxMatchScore(role, agent("u", "Uma", "", "translator")),
    );
  });
});
