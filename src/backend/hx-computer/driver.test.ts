import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HxDriverSocket, hxDriverAddress, hxReadDriverReply } from "./driver";

// HXBot 电脑操控（二）：和驱动说话的连接（driver.ts），对着一个真的本机套接字。

interface Daemon {
  address: string;
  lines: string[];
  sockets: Socket[];
  server: Server;
}

const opened: Daemon[] = [];
const folders: string[] = [];

/** A daemon double: one JSON line in, the answer the test chooses out (or none). */
async function daemon(answer: (request: { name: string }) => string | null): Promise<Daemon> {
  const folder = mkdtempSync(join(tmpdir(), "hx-driver-"));
  folders.push(folder);
  const address = join(folder, "d.sock");
  const lines: string[] = [];
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        lines.push(line);
        const reply = answer(JSON.parse(line));
        if (reply !== null) socket.write(`${reply}\n`);
        newline = buffer.indexOf("\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(address, resolve));
  const made = { address, lines, sockets, server };
  opened.push(made);
  return made;
}

afterEach(async () => {
  for (const made of opened.splice(0)) {
    for (const socket of made.sockets) socket.destroy();
    await new Promise<void>((resolve) => made.server.close(() => resolve()));
  }
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("the address of the driver", () => {
  it("is the socket in the entry the agents are handed, and none without an entry", () => {
    expect(hxDriverAddress({ args: ["mcp", "--socket", "/run/hx.sock"] })).toBe("/run/hx.sock");
    expect(hxDriverAddress({ args: ["mcp"] })).toBeNull();
    expect(hxDriverAddress({ args: ["mcp", "--socket"] })).toBeNull();
    expect(hxDriverAddress(null)).toBeNull();
  });
});

describe("a reply line", () => {
  it("gives the structured content and the text of a tool result", () => {
    const reply = hxReadDriverReply(
      JSON.stringify({
        ok: true,
        result: {
          content: [{ type: "text", text: "Clicked" }, { type: "image" }],
          structuredContent: { effect: "confirmed" },
        },
      }),
    );
    expect(reply).toEqual({ ok: true, content: { effect: "confirmed" }, text: "Clicked", error: null });
  });

  it("gives the daemon's own refusal and no JSON as failures", () => {
    expect(hxReadDriverReply(JSON.stringify({ ok: false, error: "unknown tool" }))).toMatchObject({
      ok: false,
      error: "unknown tool",
    });
    expect(hxReadDriverReply("not json").ok).toBe(false);
    expect(hxReadDriverReply("[1]").ok).toBe(false);
  });
});

describe("the connection", () => {
  it("sends one call per line with the session, and reads the answers in order", async () => {
    const made = await daemon((request) =>
      JSON.stringify({ ok: true, result: { structuredContent: { tool: request.name } } }),
    );
    const driver = new HxDriverSocket(() => made.address, "hxbot-agent-1");
    const [first, second] = await Promise.all([
      driver.call("list_windows", { on_screen_only: true }),
      driver.call("click", { element_token: "t1" }),
    ]);
    expect(first?.content).toEqual({ tool: "list_windows" });
    expect(second?.content).toEqual({ tool: "click" });
    expect(made.lines.map((line) => JSON.parse(line))).toEqual([
      {
        method: "call",
        name: "list_windows",
        args: { on_screen_only: true },
        session_id: "hxbot-agent-1",
        client_kind: "cli",
      },
      { method: "call", name: "click", args: { element_token: "t1" }, session_id: "hxbot-agent-1", client_kind: "cli" },
    ]);
    driver.close();
  });

  it("answers that Computer Use is not running when there is no address", async () => {
    const driver = new HxDriverSocket(() => null, "s");
    const answer = await driver.call("list_windows", {});
    expect(answer.ok).toBe(false);
    expect(answer.error).toContain("Computer Use is not running");
  });

  it("gives up a call the daemon does not answer in time, and the next call gets its own answer", async () => {
    let quiet = true;
    const made = await daemon((request) => {
      if (quiet && request.name === "get_window_state") return null;
      return JSON.stringify({ ok: true, result: { structuredContent: { tool: request.name } } });
    });
    const driver = new HxDriverSocket(() => made.address, "s");
    const late = await driver.call("get_window_state", {}, 50);
    expect(late.ok).toBe(false);
    expect(late.error).toContain("did not answer get_window_state");
    quiet = false;
    const next = await driver.call("click", {});
    expect(next.content).toEqual({ tool: "click" });
    driver.close();
  });

  it("fails a call when the daemon closes the connection, and connects again for the next", async () => {
    const made = await daemon((request) => {
      if (request.name === "drop") {
        for (const socket of made.sockets) socket.destroy();
        return null;
      }
      return JSON.stringify({ ok: true, result: {} });
    });
    const driver = new HxDriverSocket(() => made.address, "s");
    const dropped = await driver.call("drop", {});
    expect(dropped.ok).toBe(false);
    const again = await driver.call("list_windows", {});
    expect(again.ok).toBe(true);
    driver.close();
  });
});
