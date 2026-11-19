import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BUILTIN_TOOL_CATALOG, visibleDynamicTools } from "../agent/tool-catalog";
import { HxComputerLanes, hxAppLane } from "../hx-computer/lanes";
import { HX_TEAM_TOOL_DEFINITIONS, HX_TEAM_TOOL_NAMES } from "./tools";

// HXBot：协作（二）接进上游的那几处（hx/team.py 写的）：工具目录、工具路由、智能体服务、启动。
// 这些地方出错，hx-team 本身再对，团队也组不起来。

const Named = z.looseObject({ name: z.string() });
const Namespace = z.looseObject({ name: z.string(), tools: z.array(Named) });
const namesOf = (namespaces: readonly unknown[]) =>
  namespaces.flatMap((namespace) => Namespace.parse(namespace).tools.map((tool) => tool.name));

const source = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");

describe("the four tools", () => {
  it("are in the catalog under the namespace of HXBot, each once, with a schema", () => {
    expect(HX_TEAM_TOOL_DEFINITIONS.map((tool) => tool.name).sort()).toEqual([...HX_TEAM_TOOL_NAMES].sort());
    for (const name of HX_TEAM_TOOL_NAMES) {
      const found = BUILTIN_TOOL_CATALOG.filter((entry) => entry.namespace === "hxbot" && entry.tool === name);
      expect(found, name).toHaveLength(1);
      expect(found[0]?.description.length, name).toBeGreaterThan(80);
      expect(found[0]?.description.length, name).toBeLessThan(600);
    }
    const names = BUILTIN_TOOL_CATALOG.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("are not sent with every conversation: tool_search finds them", () => {
    for (const provider of ["codex", "claude", "pi", "kimi"] as const) {
      const visible = namesOf(visibleDynamicTools(provider));
      for (const name of HX_TEAM_TOOL_NAMES) expect(visible, `${provider} ${name}`).not.toContain(name);
      expect(visible, provider).toContain("propose_plan");
    }
  });
});

describe("the tool router", () => {
  const router = source("../agent/hxbot-tool-router.ts");
  const once = (text: string) => {
    const index = router.indexOf(text);
    expect(index, text).toBeGreaterThan(-1);
    expect(router.indexOf(text, index + 1), `${text} appears once`).toBe(-1);
    return index;
  };

  it("checks a handoff in a team room before the channel tools take it", () => {
    const room = once("const channelId = this.#channels.store.channelForThread(executionThreadId);");
    const check = once(
      "const hxRefusal = hxTeams.checkHandoff(channelId, params.tool, params.arguments, params.turnId);",
    );
    const channelTools = once(
      'if (channelId && (params.tool.startsWith("channel_") || params.tool === "send_message")) {',
    );
    expect(room).toBeLessThan(check);
    expect(check).toBeLessThan(channelTools);
    expect(router.slice(check, channelTools)).toContain("if (hxRefusal) return hxBotToolFailure(hxRefusal);");
  });

  it("gives the four tools to hx-team, with the room of a channel task and whether a person asked", () => {
    const start = once("if (HX_TEAM_TOOL_NAMES.has(params.tool)) {");
    const block = router.slice(start, start + 600);
    expect(block).toContain("roomId: channelId,");
    expect(block).toContain(
      "byPerson: !channelId && this.#requestedByPerson(senderAgentId, params.turnId, executionThreadId),",
    );
    expect(block).toContain("key: toolCallIdempotencyKey(params),");
    expect(block).toContain("return yield* Effect.promise(() => hxTeams.call(hxCall));");
    expect(start).toBeLessThan(
      once('if (channelId && (params.tool.startsWith("channel_") || params.tool === "send_message")) {'),
    );
  });
});

describe("the agent service and the start of the app", () => {
  const service = source("../agent-service.ts");
  const services = source("../../main/application-services.ts");

  it("gives hx-team its host before the drain starts, and every change of a channel", () => {
    expect(service.split("hxTeams.setPort(this.#hxTeamHost());").length - 1).toBe(1);
    expect(service.indexOf("hxTeams.setPort(this.#hxTeamHost());")).toBeLessThan(
      service.indexOf("this.#drain = new DrainScheduler({"),
    );
    const changed = service.indexOf('this.#emit({ type: "channels-changed", channelId, revision });');
    expect(service.slice(changed, changed + 200)).toContain("hxTeams.changed(channelId);");
    expect(service).toContain("#hxTeamHost(): HxTeamPort {");
    // A member made for a team starts with no first message, so it runs no turn until the room gives it work.
    expect(service).toContain("this.createAgentProfile({");
  });

  it("opens the team records once, after the auto model settings", () => {
    expect(services.split('hxTeams.open(join(app.getPath("userData"), "hx-team"));').length - 1).toBe(1);
    expect(services.indexOf("hxTeams.open(")).toBeGreaterThan(services.indexOf("hxAutoModelStore.open("));
  });
});

describe("the computer, shared by a team", () => {
  // v1.7.3 (CONC-05): no longer one line for the whole computer: two apps at once, one app one at a time.
  it("lets two members work in two apps at once, and one app take one member at a time", async () => {
    const lanes = new HxComputerLanes();
    const deadline = Date.now() + 5_000;
    const a = await lanes.acquire(hxAppLane("TextEdit"), { agentId: "a", tier: 2 }, deadline);
    const b = await lanes.acquire(hxAppLane("Notes"), { agentId: "b", tier: 2 }, deadline);
    expect(a.ok && b.ok).toBe(true);
    let third = false;
    const c = lanes.acquire(hxAppLane("textedit"), { agentId: "c", tier: 2 }, deadline).then((answer) => {
      third = answer.ok;
      return answer;
    });
    await Promise.resolve();
    expect(third).toBe(false);
    if (a.ok) a.lease.release();
    const answer = await c;
    expect(answer.ok).toBe(true);
    if (answer.ok) answer.lease.release();
    if (b.ok) b.lease.release();
    expect(lanes.holders().size).toBe(0);
  });
});
