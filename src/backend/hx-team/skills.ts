// HXBot 协作（v1.6.7）：团队技能表。成员的技能合起来用。
//
// Each agent's CLI loads the skills of its own workspace (`.agents/skills`, `.claude/skills`) and
// the user's own skills in `~/.agents/skills`, which every agent on this computer shares already,
// as it shares the connectors (one list for every agent). What a member lacks is the skills in the
// workspaces of the other members. So the team gets a table of them: the name, what the skill does
// and the path of its SKILL.md. The brief and the board show it, and any member reads that file
// and follows it when the work calls for the skill. A member made for the team starts in the
// starter's workspace, so it has the starter's skills.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { readSkillFrontmatter } from "../skill-frontmatter";

export interface HxTeamSkill {
  name: string;
  description: string;
  /** The absolute path of its SKILL.md. */
  file: string;
  /** The member whose workspace holds it. */
  owner: string;
}

/** The skill folders of a workspace that the CLIs read. */
const HX_WORKSPACE_SKILL_FOLDERS = [".agents/skills", ".claude/skills"] as const;
const MAX_SKILLS = 60;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_DESCRIPTION = 160;

async function folderSkills(folder: string, owner: string): Promise<HxTeamSkill[]> {
  let names: string[];
  try {
    names = (await readdir(folder)).filter((name) => !name.startsWith(".")).sort();
  } catch {
    return [];
  }
  const skills: HxTeamSkill[] = [];
  for (const name of names) {
    const file = join(folder, name, "SKILL.md");
    try {
      const facts = await stat(file);
      if (!facts.isFile() || facts.size > MAX_FILE_BYTES) continue;
      const checked = readSkillFrontmatter(await readFile(file, "utf8"), name);
      if (checked.problem !== undefined) continue;
      skills.push({
        name,
        description: checked.description.replace(/\s+/gu, " ").trim().slice(0, MAX_DESCRIPTION),
        file,
        owner,
      });
    } catch {
      // A folder of the user that cannot be read is left out, as the CLIs leave it out.
    }
  }
  return skills;
}

/**
 * The skills in the workspaces of the members, each once. Two members in one workspace share its
 * skills, so a workspace is read once; a name that two workspaces have keeps the first.
 */
export async function hxTeamSkills(
  members: ReadonlyArray<{ name: string; workspacePath: string }>,
): Promise<HxTeamSkill[]> {
  const seen = new Set<string>();
  const names = new Set<string>();
  const skills: HxTeamSkill[] = [];
  for (const member of members) {
    if (!member.workspacePath || seen.has(member.workspacePath)) continue;
    seen.add(member.workspacePath);
    for (const folder of HX_WORKSPACE_SKILL_FOLDERS) {
      for (const skill of await folderSkills(join(member.workspacePath, folder), member.name)) {
        if (names.has(skill.name) || skills.length >= MAX_SKILLS) continue;
        names.add(skill.name);
        skills.push(skill);
      }
    }
  }
  return skills;
}

/** The table as the brief and the board write it: one line per skill. */
export function hxTeamSkillLines(skills: readonly HxTeamSkill[], language: "zh" | "en"): string {
  if (skills.length === 0) return "";
  const head =
    language === "zh"
      ? "团队技能表（任何成员都能用：需要时读这个 SKILL.md 并照做）："
      : "Team skills (any member can use them: when the work calls for one, read its SKILL.md and follow it):";
  return [
    head,
    ...skills.map((skill) => `- ${skill.name} (${skill.owner}): ${skill.description} — ${skill.file}`),
  ].join("\n");
}
