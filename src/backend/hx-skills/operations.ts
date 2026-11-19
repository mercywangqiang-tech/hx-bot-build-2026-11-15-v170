// HXBot v1.7.4（CU-07）：computer_skill 的参数和它读写的路径。授权与记录（hx-access）和执行器用同一份，
// 两边看到的路径一定一样：~ 是主目录，相对路径从智能体的工作区算起。
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { z } from "zod";
import { HX_SKILL_NAMES, HX_SKILLS } from "./declarations";

export const HX_SKILL_ARGS = z.strictObject({
  skill: z.enum(HX_SKILL_NAMES),
  action: z.string().min(1).max(40),
  files: z.array(z.string().min(1).max(4096)).max(100).optional(),
  output: z.string().min(1).max(4096).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  /** The same id again gets the first answer and changes nothing (spec §3.3: write operations carry an idempotency key). */
  requestId: z.string().min(1).max(100).optional(),
});
export type HxSkillArgs = z.infer<typeof HX_SKILL_ARGS>;

/** What a skill answers the model: plain JSON. */
export type HxJson =
  | string
  | number
  | boolean
  | null
  | readonly HxJson[]
  | { readonly [key: string]: HxJson | undefined };

/** A path as the gate and the runner both see it: ~ is the home folder, relative paths start in the workspace. */
export function hxSkillPath(path: string, cwd: string, home: string = homedir()): string {
  const expanded =
    path === "~" ? home : path.startsWith("~/") || path.startsWith("~\\") ? join(home, path.slice(2)) : path;
  return normalize(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
}

/**
 * What a computer_skill call reads and writes, for the access gate (hx-access) and for the runner's
 * own check of protected places: its files, its output, the folder of a move, the new name of a
 * rename, a picture. Empty when the arguments do not fit (the call is refused anyway).
 */
export function hxSkillOperations(
  args: unknown,
  cwd: string,
  home: string = homedir(),
): { kind: "path"; action: "read" | "write"; path: string }[] {
  const parsed = HX_SKILL_ARGS.safeParse(args);
  if (!parsed.success) return [];
  const { skill, action, files = [], output, params = {} } = parsed.data;
  const spec = HX_SKILLS[skill].actions[action];
  if (!spec) return [];
  const read = (path: string) => ({
    kind: "path" as const,
    action: "read" as const,
    path: hxSkillPath(path, cwd, home),
  });
  const write = (path: string) => ({
    kind: "path" as const,
    action: "write" as const,
    path: hxSkillPath(path, cwd, home),
  });
  // In place: the file itself changes. Everything else only reads its files and makes new ones.
  const inPlace =
    spec.changes &&
    !output &&
    (skill === "sheet" || skill === "document" || skill === "slides" || (skill === "pdf" && action === "fill"));
  const moves = skill === "files" && (action === "move" || action === "rename");
  const operations = files.map((file) => (inPlace || moves ? write(file) : read(file)));
  if (output) operations.push(write(output));
  if (typeof params.picture === "string") operations.push(read(params.picture));
  if (skill === "files" && action === "move" && typeof params.to === "string") operations.push(write(params.to));
  if (skill === "files" && action === "rename" && typeof params.name === "string" && files[0]) {
    operations.push(write(join(dirname(hxSkillPath(files[0], cwd, home)), params.name)));
  }
  return operations;
}
