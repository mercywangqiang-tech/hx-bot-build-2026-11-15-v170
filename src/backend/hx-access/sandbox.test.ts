import { describe, expect, it } from "vitest";
import { hxPackageFolders, hxProcessSandboxed, hxSandboxInstruction } from "./sandbox";

describe("the macOS process sandbox at maximum access", () => {
  it("leaves OpenCode out, because it asks HXBot before every tool, and keeps it for the others on a Mac", () => {
    expect(hxProcessSandboxed("opencode", "darwin")).toBe(false);
    expect(hxProcessSandboxed("grok", "darwin")).toBe(true);
    expect(hxProcessSandboxed("cursor", "darwin")).toBe(true);
    // Codex and Claude ask HXBot for each command or tool call; Windows and Linux have no such sandbox.
    expect(hxProcessSandboxed("codex", "darwin")).toBe(false);
    expect(hxProcessSandboxed("claude", "darwin")).toBe(false);
    expect(hxProcessSandboxed("grok", "win32")).toBe(false);
  });

  it("lets package managers install and cache on a Mac", () => {
    const folders = hxPackageFolders("darwin", "/Users/u");
    expect(folders).toEqual(
      expect.arrayContaining([
        "/opt/homebrew",
        "/usr/local/Cellar",
        "/Users/u/.npm",
        "/Users/u/Library/Caches/Homebrew",
      ]),
    );
    expect(folders).not.toContain("/Applications");
    expect(folders.some((folder) => folder.includes("Library/Keychains") || folder.endsWith("/.ssh"))).toBe(false);
    expect(hxPackageFolders("linux", "/home/u")).toEqual([]);
  });

  it("tells only a provider in the sandbox what it refuses and which HXBot tools to use", () => {
    expect(hxSandboxInstruction("grok", "darwin")[0]).toContain("hxbot.computer_install");
    expect(hxSandboxInstruction("opencode", "darwin")).toEqual([]);
    expect(hxSandboxInstruction("grok", "linux")).toEqual([]);
  });
});
