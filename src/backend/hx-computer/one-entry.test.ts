import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hxNativeDriverGiven } from "./one-entry";

// HXBot 电脑操控（五）（v1.7.3，CONC-05）：只留一个入口。

describe("one entry to this computer", () => {
  it("gives the native driver to no agent on the systems where HXBot's own tools work", () => {
    expect(hxNativeDriverGiven("darwin")).toBe(false);
    expect(hxNativeDriverGiven("win32")).toBe(false);
    expect(hxNativeDriverGiven("linux")).toBe(true);
  });

  it("is what every provider's list of MCP servers goes through", () => {
    const shapes = readFileSync(join(__dirname, "..", "mcp-provider-shapes.ts"), "utf8");
    expect(shapes).toContain('import { hxNativeDriverGiven } from "./hx-computer/one-entry";');
    expect(shapes).toContain("return computerUse && hxNativeDriverGiven()");
    // Each client reads its servers through agentMcpServers, the Claude and ACP clients too.
    for (const client of ["claude-client.ts", "acp-client.ts", "pi-client.ts", "muse-client.ts"]) {
      expect(readFileSync(join(__dirname, "..", client), "utf8"), client).toContain("agentMcpServers(");
    }
  });
});
