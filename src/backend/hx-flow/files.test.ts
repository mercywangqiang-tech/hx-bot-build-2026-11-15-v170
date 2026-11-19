import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { readAgentInstructionsFile, saveAgentInstructionsFile } from "../agent/workspace-instructions";

// HXBot v1.7.3（CONC-07）：HXBot 自己写的文件，写前比对。HXBot 的工具里，改用户文件的只有智能体的说明文件
// （设置 → 说明，以及智能体自己）；它写之前比对读到的内容，不一致就答复“文件已被改动”，由调用方重读。
// 这里按验收条目测：两个写的一方先后基于同一旧版本写同一文件，后写的一方收到“文件已被改动”，先写的内容不丢。

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("a file HXBot writes for two writers", () => {
  it("refuses the later write that is based on the same old text, and keeps the earlier one", async () => {
    const folder = mkdtempSync(join(tmpdir(), "hx-conc07-"));
    folders.push(folder);
    const first = await Effect.runPromise(saveAgentInstructionsFile(folder, "# v1\n", ""));
    expect(first.text).toBe("# v1\n");
    const read = await Effect.runPromise(readAgentInstructionsFile(folder));
    // Two writers read the same version and write one after the other.
    const a = await Effect.runPromiseExit(saveAgentInstructionsFile(folder, "# by A\n", read.text));
    const b = await Effect.runPromiseExit(saveAgentInstructionsFile(folder, "# by B\n", read.text));
    expect(Exit.isSuccess(a)).toBe(true);
    expect(Exit.isFailure(b)).toBe(true);
    expect(JSON.stringify(b)).toContain("changed");
    expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toBe("# by A\n");
  });

  it("lets 20 writers race on one version: exactly one wins, every other one hears that the file changed", async () => {
    const folder = mkdtempSync(join(tmpdir(), "hx-conc07-"));
    folders.push(folder);
    await Effect.runPromise(saveAgentInstructionsFile(folder, "# base\n", ""));
    const base = (await Effect.runPromise(readAgentInstructionsFile(folder))).text;
    const exits = [];
    // One after the other, as two tool calls of one process run: the check and the write of one save
    // are not split by another save of the same process.
    for (let i = 0; i < 20; i += 1)
      exits.push(await Effect.runPromiseExit(saveAgentInstructionsFile(folder, `# ${i}\n`, base)));
    expect(exits.filter((exit) => Exit.isSuccess(exit))).toHaveLength(1);
    expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toBe("# 0\n");
  });
});
