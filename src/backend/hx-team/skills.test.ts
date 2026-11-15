import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hxTeamSkillLines, hxTeamSkills } from "./skills";

// HXBot 协作（v1.6.7）：团队技能表（skills.ts），对着真的文件夹。

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hx-team-skills-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function skill(workspace: string, folder: string, name: string, description: string | null): void {
  const directory = join(root, workspace, folder, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "SKILL.md"),
    description === null ? "no front matter\n" : `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
}

describe("the team skill table", () => {
  it("takes the skills of every workspace in the team, each name once, with the path of its SKILL.md", async () => {
    skill("starter", ".agents/skills", "report-style", "Write reports in the house style.");
    skill("writer", ".claude/skills", "poster", "Lay out a poster.");
    skill("writer", ".agents/skills", "report-style", "Another copy, left out.");
    skill("writer", ".agents/skills", "broken", null);
    const skills = await hxTeamSkills([
      { name: "我", workspacePath: join(root, "starter") },
      { name: "小王", workspacePath: join(root, "writer") },
      { name: "同一个工作区", workspacePath: join(root, "writer") },
      { name: "没有工作区", workspacePath: "" },
      { name: "不存在", workspacePath: join(root, "missing") },
    ]);
    expect(skills).toEqual([
      {
        name: "report-style",
        description: "Write reports in the house style.",
        file: join(root, "starter", ".agents/skills", "report-style", "SKILL.md"),
        owner: "我",
      },
      {
        name: "poster",
        description: "Lay out a poster.",
        file: join(root, "writer", ".claude/skills", "poster", "SKILL.md"),
        owner: "小王",
      },
    ]);
  });

  it("is written for the brief and the board in the team's language, and is empty with no skills", async () => {
    skill("w", ".agents/skills", "poster", "Lay out a poster.");
    const skills = await hxTeamSkills([{ name: "小王", workspacePath: join(root, "w") }]);
    const zh = hxTeamSkillLines(skills, "zh");
    expect(zh.split("\n")[0]).toBe("团队技能表（任何成员都能用：需要时读这个 SKILL.md 并照做）：");
    expect(zh).toContain(
      `- poster (小王): Lay out a poster. — ${join(root, "w", ".agents/skills", "poster", "SKILL.md")}`,
    );
    expect(hxTeamSkillLines(skills, "en").split("\n")[0]).toContain("Team skills");
    expect(hxTeamSkillLines([], "zh")).toBe("");
  });
});
