// HXBot：智能体设置里的“自动选择模型”和“建议卡”（HxAutoModelSection.tsx）。
import { HX_AUTO_DEFAULTS, type HxAutoModelSettings, type HxAutoModelView } from "@hxbot/contracts/hx-auto-model";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { type HxAutoModelCalls, HxAutoModelSection } from "./HxAutoModelSection";

const VIEW: HxAutoModelView = {
  agentId: "a1",
  settings: HX_AUTO_DEFAULTS,
  models: [
    {
      ref: { provider: "opencode", model: "opencode/glm-5.3-flash-free" },
      name: "GLM-5.3-Flash Free",
      tier: "B",
      cost: "free",
      vision: false,
      ready: true,
      excluded: false,
    },
    {
      ref: { provider: "claude", model: "claude-opus-5-5" },
      name: "Claude Opus 5.5",
      tier: "S",
      cost: "subscription",
      vision: true,
      ready: false,
      excluded: false,
    },
  ],
  preview: { writing: { provider: "opencode", model: "opencode/glm-5.3-flash-free", name: "GLM-5.3-Flash Free" } },
  freeQuota: { blockedUntil: null, usedToday: 3 },
  decisions: [
    {
      agentId: "a1",
      deliveryId: "d1",
      taskId: null,
      at: 1_700_000_000_000,
      work: "writing",
      difficulty: "mid",
      needs: [],
      by: "rules",
      confidence: 0.9,
      chosen: { provider: "claude", model: "claude-opus-5-5", name: "Claude Opus 5.5" },
      previous: { provider: "opencode", model: "opencode/glm-5.3-flash-free", name: "GLM-5.3-Flash Free" },
      kept: false,
      signals: [],
      skipped: [],
      effort: null,
      ms: 2,
    },
  ],
};

function calls(view: HxAutoModelView = VIEW) {
  let current = view;
  const update = vi.fn((agentId: string, settings: HxAutoModelSettings) => {
    current = { ...current, agentId, settings };
    return Promise.resolve(current);
  });
  const result: HxAutoModelCalls & { update: typeof update } = {
    view: vi.fn(() => Promise.resolve(current)),
    update,
  };
  return result;
}

async function settle() {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  flush();
}

describe("HxAutoModelSection", () => {
  it("reads the agent's settings and turns auto model on", async () => {
    // Auto model is on by default (v1.6.7); this agent's user turned it off.
    const used = calls({ ...VIEW, settings: { ...HX_AUTO_DEFAULTS, enabled: false } });
    render(() => <HxAutoModelSection agentId="a1" calls={used} />);
    await settle();
    expect(used.view).toHaveBeenCalledWith("a1");
    expect(screen.getByText("Auto model")).toBeTruthy();
    // Off: only the switch and the proposal card are there.
    expect(screen.queryByText("Preference")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Choose the model by the work" }));
    await settle();
    expect(used.update).toHaveBeenCalledWith("a1", { ...HX_AUTO_DEFAULTS, enabled: true });
    expect(screen.getByText("Preference")).toBeTruthy();
    expect(screen.getByText(/Writing → GLM-5.3-Flash Free/u)).toBeTruthy();
    expect(screen.getByText("OpenCode free models: about 3 requests today on this computer.")).toBeTruthy();
  });

  it("lists the models and the recent choices, and takes a model out of the pool", async () => {
    const used = calls({ ...VIEW, settings: { ...HX_AUTO_DEFAULTS, enabled: true } });
    render(() => <HxAutoModelSection agentId="a1" calls={used} />);
    await settle();
    fireEvent.click(screen.getByRole("switch", { name: "Models and recent choices" }));
    await settle();
    expect(screen.getByText("Subscription · S · reads images · not ready")).toBeTruthy();
    expect(screen.getByText(/switched to Claude Opus 5.5/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "GLM-5.3-Flash Free" }));
    await settle();
    expect(used.update).toHaveBeenLastCalledWith("a1", {
      ...HX_AUTO_DEFAULTS,
      enabled: true,
      excluded: [{ provider: "opencode", model: "opencode/glm-5.3-flash-free" }],
    });
  });

  it("says when OpenCode's free limit is used up, and when a save fails", async () => {
    const used = calls({
      ...VIEW,
      settings: { ...HX_AUTO_DEFAULTS, enabled: true },
      freeQuota: { blockedUntil: Date.now() + 3_600_000, usedToday: 40 },
    });
    used.update.mockImplementationOnce(() => Promise.reject(new Error("no")));
    render(() => <HxAutoModelSection agentId="a1" calls={used} />);
    await settle();
    expect(screen.getByText(/OpenCode's free limit is used up for today/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "May move to another provider" }));
    await settle();
    expect(screen.getByText("This did not work. Try again.")).toBeTruthy();
  });
});
