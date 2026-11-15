// HXBot：最大权限的拦截入口（服务商审批、Claude 的工具钩子、内置浏览器和 HXBot 自己的工具）、
// request_access 和 release_access 两个工具，以及判定结果进操作记录。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { accessQuestion } from "./card";
import { hxAccessGrants } from "./grants";
import {
  type HxAccessAgent,
  hxAccessApproval,
  hxAccessDecide,
  hxAccessToolRefusal,
  hxAcpPermissionHints,
  hxApprovalOperations,
  hxBrowserOperations,
  hxClaudeAccessHooks,
  hxClaudeToolOperations,
  hxHxBotToolOperations,
  hxOnDemandInstruction,
  hxRecordItem,
  setHxAccessDataFolder,
  setHxAccessHost,
} from "./hub";
import { ACCESS_ACTIONS, ACCESS_TARGET_TYPES, type AccessOperation } from "./policy";
import { hxAccessStore } from "./rules";
import {
  HX_ACCESS_TOOL_DEFINITIONS,
  hxAccessAnswer,
  hxAccessMayAnswer,
  hxAccessToolCall,
  RELEASE_ACCESS_TOOL,
  REQUEST_ACCESS_TOOL,
} from "./tools";

let base: string;
let workspace: string;
let outside: string;
let data: string;
const agents = new Map<string, HxAccessAgent>();

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "hx-access-gates-"));
  workspace = join(base, "workspace");
  outside = join(base, "documents");
  data = join(base, "data");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "a.txt"), "a");
  writeFileSync(join(outside, "q.xlsx"), "q");
  agents.set("on", { id: "on", name: "小犀", onDemand: true, roots: [workspace], workspacePath: workspace });
  agents.set("full", { id: "full", name: "Full", onDemand: false, roots: [workspace], workspacePath: workspace });
  setHxAccessHost({ agent: (id) => agents.get(id) ?? null, agentForThread: (thread) => thread.split(":")[0] });
  setHxAccessDataFolder(data);
});

afterEach(() => {
  hxAccessGrants.releaseAgent("on");
  hxAccessGrants.releaseAgent("full");
  for (const rule of hxAccessStore.rules()) hxAccessStore.removeRule(rule.id);
  hxAccessStore.clearLog();
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

function onAgent(): HxAccessAgent {
  const agent = agents.get("on");
  if (!agent) throw new Error("no agent");
  return agent;
}

function text(result: { contentItems: readonly { type: string; text?: string }[] }): string {
  const item = result.contentItems[0];
  return item && "text" in item && typeof item.text === "string" ? item.text : "";
}

const deleteOutside = (): AccessOperation => ({ kind: "path", action: "delete", path: join(outside, "q.xlsx") });

describe("the decision of an agent's thread", () => {
  it("decides nothing for an agent at full access", () => {
    expect(hxAccessDecide("full", "full:t", [deleteOutside()])).toBeNull();
    expect(hxAccessApproval({ command: "sudo rm -rf /" }, "command", "full", "full:t")).toBeNull();
  });

  it("guards HXBot's own data folder and the key folders of the home folder", () => {
    expect(
      hxAccessDecide("on", "on:t", [{ kind: "path", action: "read", path: join(data, "vault.json") }])?.allowed,
    ).toBe(false);
    expect(
      hxAccessDecide("on", "on:t", [{ kind: "path", action: "read", path: join(homedir(), ".ssh", "id_ed25519") }])
        ?.allowed,
    ).toBe(false);
    expect(
      hxAccessDecide("on", "on:t", [{ kind: "path", action: "read", path: join(outside, "a.txt") }])?.allowed,
    ).toBe(true);
  });

  it("writes what matters to the activity record, and not plain work in the workspace", () => {
    hxAccessDecide("on", "on:t", [{ kind: "path", action: "write", path: join(workspace, "src/a.ts") }]);
    hxAccessDecide("on", "on:t", [{ kind: "path", action: "read", path: join(outside, "a.txt") }]);
    hxAccessDecide("on", "on:t", [deleteOutside()]);
    hxAccessDecide("on", "on:t", [
      { kind: "command", command: "npm test", deletes: false, elevates: false, parts: [] },
    ]);
    hxAccessDecide("on", "on:t", [{ kind: "screen" }]);
    hxAccessDecide("on", "on:t", [{ kind: "site", action: "read", url: "https://example.com" }]);
    expect(hxAccessStore.log().map((entry) => [entry.kind, entry.outcome, entry.agent])).toEqual([
      ["screen", "auto", "小犀"],
      ["command", "auto", "小犀"],
      ["delete", "held", "小犀"],
      ["read", "auto", "小犀"],
    ]);
  });
});

describe("the gate of an approval", () => {
  it("accepts commands, and declines a delete outside with the way to ask", () => {
    const agent = onAgent();
    expect(hxApprovalOperations({ command: ["bash", "-lc", "ls src"], cwd: workspace }, "command", agent)).toEqual([
      { kind: "path", action: "read", path: join(workspace, "src") },
    ]);
    expect(hxAccessApproval({ command: "npm install", cwd: workspace }, "command", "on", "on:t")).toEqual({
      decision: "accept",
    });
    expect(hxAccessApproval({ command: `cat ${outside}/a.txt`, cwd: workspace }, "command", "on", "on:t")).toEqual({
      decision: "accept",
    });
    const refused = hxAccessApproval({ command: `rm ${outside}/a.txt`, cwd: workspace }, "command", "on", "on:t");
    expect(refused?.decision).toBe("decline");
    expect(refused && "message" in refused ? refused.message : "").toContain("hxbot.request_access");
    const sudo = hxAccessApproval({ command: "sudo apt install jq", cwd: workspace }, "command", "on", "on:t");
    expect(sudo && "message" in sudo ? sudo.message : "").toContain("as administrator");
  });

  it("reads the paths of a Codex file change from its item, and a confirmation given once is used up", () => {
    const agent = onAgent();
    hxRecordItem({
      type: "fileChange",
      id: "item-1",
      changes: [
        { path: join(workspace, "src/a.ts"), kind: { type: "update" } },
        { path: join(outside, "a.txt"), kind: { type: "update" } },
        { path: join(outside, "q.xlsx"), kind: { type: "delete" } },
      ],
    });
    expect(hxApprovalOperations({ itemId: "item-1" }, "file-change", agent)).toEqual([
      { kind: "path", action: "write", path: join(workspace, "src/a.ts") },
      { kind: "path", action: "write", path: join(outside, "a.txt") },
      { kind: "path", action: "delete", path: join(outside, "q.xlsx") },
    ]);
    expect(hxApprovalOperations({ itemId: "unknown" }, "file-change", agent)).toBeNull();
    expect(hxAccessApproval({ itemId: "item-1" }, "file-change", "on", "on:t")?.decision).toBe("decline");
    hxAccessGrants.add({
      agentId: "on",
      threadId: "on:t",
      turnId: "u",
      targets: [
        { type: "file", value: join(outside, "a.txt") },
        { type: "file", value: join(outside, "q.xlsx") },
      ],
      actions: ["write", "delete"],
      reason: "r",
      purpose: "p",
      once: true,
    });
    // The confirmation belongs to its thread.
    expect(hxAccessApproval({ itemId: "item-1" }, "file-change", "on", "on:other")?.decision).toBe("decline");
    expect(hxAccessApproval({ itemId: "item-1" }, "file-change", "on", "on:t")).toEqual({ decision: "accept" });
    expect(hxAccessApproval({ itemId: "item-1" }, "file-change", "on", "on:t")?.decision).toBe("decline");
    expect(hxAccessStore.log()[0]).toMatchObject({ kind: "delete", outcome: "held" });
    expect(hxAccessStore.log().some((entry) => entry.outcome === "once")).toBe(true);
  });

  it("reads what an ACP tool call touches", () => {
    expect(hxAcpPermissionHints({ kind: "read", locations: [{ path: "/etc/hosts" }] })).toEqual({
      hxPaths: ["/etc/hosts"],
      hxAction: "read",
    });
    expect(hxAcpPermissionHints({ kind: "move", locations: [{ path: "a" }] })).toEqual({
      hxPaths: ["a"],
      hxAction: "delete",
    });
    expect(hxAcpPermissionHints({ kind: "fetch", rawInput: { url: "https://example.com" } })).toEqual({
      hxAction: "fetch",
      hxUrl: "https://example.com",
    });
    expect(hxAcpPermissionHints({ kind: "execute", rawInput: { command: "npm test", cwd: "/w" } })).toEqual({
      hxCommand: "npm test",
      hxCwd: "/w",
    });
    expect(hxAcpPermissionHints({ kind: "execute", rawInput: { script: "x" } })).toEqual({ hxUnknown: true });
    expect(hxAcpPermissionHints({ kind: "search" })).toEqual({});
    const agent = onAgent();
    // A command HXBot cannot read runs, as commands do at maximum access.
    expect(hxApprovalOperations({ command: '{"script":"x"}', hxUnknown: true }, "command", agent)).toEqual([]);
    expect(hxApprovalOperations({ hxAction: "read", hxPaths: ["src/a.ts"] }, "permissions", agent)).toEqual([
      { kind: "path", action: "read", path: join(workspace, "src/a.ts") },
    ]);
    expect(hxApprovalOperations({ hxAction: "delete", hxPaths: ["old.ts"] }, "file-change", agent)).toEqual([
      { kind: "path", action: "delete", path: join(workspace, "old.ts") },
    ]);
    expect(hxApprovalOperations({ permissions: { network: true } }, "permissions", agent)).toEqual([]);
    expect(hxAccessApproval({ permissions: { network: true } }, "permissions", "on", "on:t")).toEqual({
      decision: "accept",
    });
  });
});

describe("Claude's tools", () => {
  it("maps each tool to what it touches", () => {
    expect(hxClaudeToolOperations("Read", { file_path: "/etc/passwd" }, workspace)).toEqual([
      { kind: "path", action: "read", path: "/etc/passwd" },
    ]);
    expect(hxClaudeToolOperations("Grep", { pattern: "x" }, workspace)).toEqual([
      { kind: "path", action: "read", path: workspace },
    ]);
    expect(hxClaudeToolOperations("Edit", { file_path: "src/a.ts" }, workspace)).toEqual([
      { kind: "path", action: "write", path: join(workspace, "src/a.ts") },
    ]);
    expect(hxClaudeToolOperations("WebFetch", { url: "https://example.com" }, workspace)).toEqual([
      { kind: "site", action: "read", url: "https://example.com" },
    ]);
    expect(hxClaudeToolOperations("WebSearch", { query: "x" }, workspace)).toEqual([{ kind: "search" }]);
    expect(hxClaudeToolOperations("TodoWrite", {}, workspace)).toEqual([]);
  });

  it("adds a hook that denies what needs a confirmation and keeps the hooks it was given", async () => {
    const hooks = hxClaudeAccessHooks({ PreToolUse: [{ matcher: "Write", hooks: [] }] }, "on", "on:t", workspace);
    expect(hooks.PreToolUse).toHaveLength(2);
    const hook = hooks.PreToolUse?.[1]?.hooks[0];
    if (!hook) throw new Error("no hook");
    const call = (tool_name: string, tool_input: unknown) =>
      hook(
        {
          hook_event_name: "PreToolUse",
          tool_name,
          tool_input,
          tool_use_id: "x",
          session_id: "s",
          transcript_path: "",
          cwd: workspace,
        },
        "x",
        { signal: new AbortController().signal },
      );
    await expect(call("Read", { file_path: join(outside, "a.txt") })).resolves.toEqual({});
    await expect(call("Write", { file_path: join(outside, "new.txt") })).resolves.toEqual({});
    await expect(call("Bash", { command: "npm install" })).resolves.toEqual({});
    expect(await call("Edit", { file_path: join(outside, "a.txt") })).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    expect(await call("Read", { file_path: join(data, "vault.json") })).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    expect(await call("Bash", { command: `rm -rf ${outside}` })).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    // A full access agent is not held.
    const full = hxClaudeAccessHooks({}, "full", "full:t", workspace).PreToolUse?.[0]?.hooks[0];
    if (!full) throw new Error("no hook");
    await expect(
      full(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: `rm -rf ${outside}` },
          tool_use_id: "x",
          session_id: "s",
          transcript_path: "",
          cwd: workspace,
        },
        "x",
        { signal: new AbortController().signal },
      ),
    ).resolves.toEqual({});
  });
});

describe("HXBot's own tools", () => {
  const tabs = (tabId: string) => (tabId === "t1" ? "https://shop.example.com/cart" : null);

  it("lets websites, saved-password sign-ins and Vault deletes through, and names payments and uploads", () => {
    expect(hxBrowserOperations("open", { url: "https://example.com" }, tabs)).toEqual([]);
    expect(hxBrowserOperations("click", { tabId: "t1", target: "#buy" }, tabs)).toEqual([]);
    expect(hxBrowserOperations("run_script", { tabId: "t1", script: "await navigate(next)" }, tabs)).toEqual([]);
    // v1.6.8 (the user, 2026-11-14): a saved Vault password signs in without a confirmation.
    expect(hxBrowserOperations("submit_secret", { tabId: "t1", loginId: "l1" }, tabs)).toEqual([]);
    expect(hxBrowserOperations("submit_secret", { tabId: "t1" }, tabs)).toEqual([]);
    expect(hxBrowserOperations("fill_card", { tabId: "t1" }, tabs)).toEqual([
      { kind: "payment", site: "https://shop.example.com/cart" },
    ]);
    expect(hxBrowserOperations("delete_vault_item", { id: "v1" }, tabs)).toEqual([]);
    expect(hxBrowserOperations("upload_files", { tabId: "t1", paths: ["/etc/hosts"] }, tabs)).toEqual([
      { kind: "path", action: "read", path: "/etc/hosts" },
    ]);
  });

  it("refuses a payment without a confirmation, and one confirmation pays once", () => {
    const pay: AccessOperation[] = [{ kind: "payment", site: "https://shop.example.com/cart" }];
    expect(hxAccessToolRefusal("on", "on:t", pay)?.success).toBe(false);
    expect(hxAccessToolRefusal("full", "full:t", pay)).toBeNull();
    hxAccessGrants.add({
      agentId: "on",
      threadId: "on:t",
      turnId: "u",
      targets: [{ type: "payment", value: "shop.example.com" }],
      actions: ["write", "delete"],
      reason: "r",
      purpose: "p",
      once: true,
    });
    expect(hxAccessToolRefusal("on", "on:t", pay)).toBeNull();
    expect(hxAccessToolRefusal("on", "on:t", pay)?.success).toBe(false);
  });

  it("lets the screen, web search and attachments through", () => {
    expect(hxAccessToolRefusal("on", "on:t", hxHxBotToolOperations("capture_screen", {}, null))).toBeNull();
    expect(hxAccessToolRefusal("on", "on:t", hxHxBotToolOperations("web_search", {}, null))).toBeNull();
    const reads = hxHxBotToolOperations(
      "attach_files_to_response",
      { paths: ["src/a.png", join(outside, "b.png")] },
      onAgent(),
    );
    expect(reads).toEqual([
      { kind: "path", action: "read", path: join(workspace, "src/a.png") },
      { kind: "path", action: "read", path: join(outside, "b.png") },
    ]);
    expect(hxAccessToolRefusal("on", "on:t", reads)).toBeNull();
  });

  it("tells the agent what maximum access means", () => {
    const instruction = hxOnDemandInstruction(true);
    expect(instruction).toContain("maximum access");
    expect(instruction).toContain("hxbot.request_access");
    expect(instruction).toContain("the folders the user gave you");
    expect(hxOnDemandInstruction(false)).not.toContain("the folders the user gave you");
  });
});

describe("request_access and release_access", () => {
  const request = () => ({
    reason: "整理报告需要删掉旧表格",
    purpose: "只留下今年的表格",
    targets: [{ type: "file", value: join(outside, "q.xlsx") }],
    actions: ["delete"],
  });
  const answer = (choice: string[]) => ({ "hx-access": choice });

  it("offer the same target types and actions as the policy", () => {
    const shape = HX_ACCESS_TOOL_DEFINITIONS[0].shape;
    expect(shape.targets.element.shape.type.options).toEqual([...ACCESS_TARGET_TYPES]);
    expect(shape.actions.unwrap().element.options).toEqual([...ACCESS_ACTIONS]);
  });

  it("make the card; only the owner may allow, anyone may refuse", () => {
    const call = hxAccessToolCall(REQUEST_ACCESS_TOOL, request(), "on", "on:t", "turn-1");
    if (!("question" in call)) throw new Error("no card");
    expect(call.question).toEqual(accessQuestion(call.access.request, "小犀", "zh"));
    expect(call.question.options?.map((option) => option.label)).toEqual(["允许一次", "始终允许", "拒绝"]);
    expect(hxAccessMayAnswer(call.access, answer([]), { owner: false })).toBe(true);
    expect(hxAccessMayAnswer(call.access, answer(["拒绝"]), { owner: false })).toBe(true);
    expect(hxAccessMayAnswer(call.access, answer(["允许一次"]), { owner: false })).toBe(false);
    expect(hxAccessMayAnswer(call.access, answer(["始终允许"]), { owner: false })).toBe(false);
    expect(hxAccessMayAnswer(call.access, answer(["允许一次"]), { owner: true })).toBe(true);
    expect(hxAccessMayAnswer(call.access, answer(["允许一次"]), undefined)).toBe(true);
  });

  it("Refuse grants nothing", () => {
    const call = hxAccessToolCall(REQUEST_ACCESS_TOOL, request(), "on", "on:t", "turn-1");
    if (!("question" in call)) throw new Error("no card");
    const denied = hxAccessAnswer(call.access, answer(["拒绝"]));
    expect(JSON.parse(text(denied))).toMatchObject({ status: "denied" });
    expect(hxAccessGrants.forThread("on", "on:t")).toEqual([]);
    expect(hxAccessStore.log()[0]).toMatchObject({ kind: "request", outcome: "refused" });
  });

  it("Allow once covers the step once, in this task, with the user's note", () => {
    const call = hxAccessToolCall(REQUEST_ACCESS_TOOL, request(), "on", "on:t", "turn-1");
    if (!("question" in call)) throw new Error("no card");
    const granted = JSON.parse(text(hxAccessAnswer(call.access, answer(["允许一次", "只删这一个"]))));
    expect(granted).toMatchObject({ status: "granted", scope: "once", actions: ["delete"], userNote: "只删这一个" });
    expect(hxAccessDecide("on", "on:other", [deleteOutside()])?.allowed).toBe(false);
    expect(hxAccessDecide("on", "on:t", [deleteOutside()])?.allowed).toBe(true);
    expect(hxAccessDecide("on", "on:t", [deleteOutside()])?.allowed).toBe(false);
    // The end of the turn takes back what was not used.
    hxAccessAnswer(call.access, answer(["允许一次"]));
    hxAccessGrants.releaseTurn("on:t", "turn-1");
    expect(hxAccessDecide("on", "on:t", [deleteOutside()])?.allowed).toBe(false);
  });

  it("Always allow makes a rule for the file's folder, for every agent, until it is removed", () => {
    const call = hxAccessToolCall(REQUEST_ACCESS_TOOL, request(), "on", "on:t", "turn-1");
    if (!("question" in call)) throw new Error("no card");
    const granted = JSON.parse(text(hxAccessAnswer(call.access, answer(["始终允许"]))));
    expect(granted).toMatchObject({
      status: "granted",
      scope: "always",
      targets: [{ type: "folder", value: outside }],
    });
    expect(hxAccessStore.rules()).toEqual([
      expect.objectContaining({
        targets: [{ type: "folder", value: outside }],
        actions: ["delete"],
        agentName: "小犀",
      }),
    ]);
    agents.set("other", { id: "other", name: "Other", onDemand: true, roots: [workspace], workspacePath: workspace });
    const otherFile: AccessOperation = { kind: "path", action: "delete", path: join(outside, "a.txt") };
    expect(hxAccessDecide("other", "other:t", [otherFile])?.allowed).toBe(true);
    expect(hxAccessDecide("other", "other:t", [otherFile])?.allowed).toBe(true);
    expect(hxAccessStore.log()[0]).toMatchObject({ kind: "delete", outcome: "always", agent: "Other" });
    // Only what was asked for: a change of a file there is still asked.
    expect(
      hxAccessDecide("other", "other:t", [{ kind: "path", action: "write", path: join(outside, "a.txt") }])?.allowed,
    ).toBe(false);
    const [rule] = hxAccessStore.rules();
    if (rule) hxAccessStore.removeRule(rule.id);
    expect(hxAccessDecide("other", "other:t", [otherFile])?.allowed).toBe(false);
    agents.delete("other");
  });

  it("never makes a rule for a payment", () => {
    const call = hxAccessToolCall(
      REQUEST_ACCESS_TOOL,
      { reason: "下单", purpose: "付 ¥99", targets: [{ type: "payment", value: "shop.example.com" }] },
      "on",
      "on:t",
      "turn-1",
    );
    if (!("question" in call)) throw new Error("no card");
    const granted = JSON.parse(text(hxAccessAnswer(call.access, answer(["始终允许"]))));
    expect(granted).toMatchObject({ status: "granted", scope: "once" });
    expect(hxAccessStore.rules()).toEqual([]);
  });

  it("refuse a request that is not complete, and say that a full access agent needs none", () => {
    const missing = hxAccessToolCall(REQUEST_ACCESS_TOOL, { ...request(), reason: "" }, "on", "on:t", "u");
    expect("result" in missing && missing.result.success).toBe(false);
    const full = hxAccessToolCall(REQUEST_ACCESS_TOOL, request(), "full", "full:t", "u");
    expect("result" in full && full.result.contentItems[0]).toMatchObject({
      text: expect.stringContaining("not_needed"),
    });
  });

  it("give back one grant or all of the thread, and no grant of another thread", () => {
    const input = {
      agentId: "on",
      turnId: "u",
      targets: [{ type: "vault" as const, value: "v1" }],
      actions: ["delete" as const],
      reason: "r",
      purpose: "p",
      once: true,
    };
    const one = hxAccessGrants.add({ ...input, threadId: "on:t" });
    const other = hxAccessGrants.add({ ...input, threadId: "on:other" });
    const wrong = hxAccessToolCall(RELEASE_ACCESS_TOOL, { grantId: other.id }, "on", "on:t", "u");
    expect("result" in wrong && wrong.result.success).toBe(false);
    const released = hxAccessToolCall(RELEASE_ACCESS_TOOL, { grantId: one.id }, "on", "on:t", "u");
    expect("result" in released && released.result.success).toBe(true);
    expect(hxAccessGrants.forThread("on", "on:t")).toEqual([]);
    expect(hxAccessGrants.forThread("on", "on:other")).toHaveLength(1);
    hxAccessToolCall(RELEASE_ACCESS_TOOL, {}, "on", "on:other", "u");
    expect(hxAccessGrants.forThread("on", "on:other")).toEqual([]);
  });
});
