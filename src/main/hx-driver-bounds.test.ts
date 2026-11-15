import { mkdtempSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CuaDriverActionTap } from "./cua-driver-action-tap";
import { HX_READ_MAX_ELEMENTS, HX_READ_TIMEOUT_MS, hxBoundedRequest } from "./hx-driver-bounds";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("a window read keeps the app it reads responsive (v1.7.0)", () => {
  it("adds the bounds that a read does not name, and keeps the ones it names", () => {
    const read = JSON.parse(
      hxBoundedRequest(JSON.stringify({ method: "call", name: "get_window_state", args: { pid: 7 } })) ?? "{}",
    );
    expect(read.args).toEqual({ pid: 7, max_elements: HX_READ_MAX_ELEMENTS, timeout_ms: HX_READ_TIMEOUT_MS });
    const named = { method: "call", name: "get_window_state", args: { pid: 7, max_elements: 50, timeout_ms: 900 } };
    expect(hxBoundedRequest(JSON.stringify(named))).toBeNull();
    expect(hxBoundedRequest(JSON.stringify({ method: "call", name: "click", args: { pid: 7 } }))).toBeNull();
    expect(hxBoundedRequest("not json get_window_state")).toBeNull();
  });

  it("passes every other line byte for byte through the tap, also split in the middle of a character", async () => {
    const folder = mkdtempSync(join(tmpdir(), "hx-tap-"));
    folders.push(folder);
    const upstream = join(folder, "daemon.sock");
    const tap = join(folder, "tap.sock");
    const received: Buffer[] = [];
    const daemon = createServer((socket) => socket.on("data", (chunk: Buffer) => received.push(chunk)));
    await new Promise<void>((done) => daemon.listen(upstream, done));
    const proxy = new CuaDriverActionTap();
    await Effect.runPromise(proxy.listen({ upstream, tap }));
    const click = `${JSON.stringify({ method: "call", name: "type_text", args: { text: "季度报告" } })}\n`;
    const read = `${JSON.stringify({ method: "call", name: "get_window_state", args: { pid: 7 } })}\n`;
    const bytes = Buffer.from(click + read, "utf8");
    const client = connect(tap);
    await new Promise<void>((done) => client.once("connect", done));
    // Cut inside the first Chinese character.
    const cut = bytes.indexOf(Buffer.from("季", "utf8")) + 1;
    await new Promise<void>((done) => client.write(bytes.subarray(0, cut), () => done()));
    await new Promise<void>((done) => client.write(bytes.subarray(cut), () => done()));
    const expected = `${click}${hxBoundedRequest(read.trim())}\n`;
    await vi.waitFor(() => expect(Buffer.concat(received).toString("utf8")).toBe(expected));
    client.destroy();
    await Effect.runPromise(proxy.close());
    await new Promise<void>((done) => daemon.close(() => done()));
  });
});
