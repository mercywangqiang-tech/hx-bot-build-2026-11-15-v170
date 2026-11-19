// HXBot v1.7.4（CONC-09）：团队进度卡下面的“这件更急 / 普通 / 不急”开关。
import {
  HX_PROGRESS_ITEM_TYPE,
  type HxProgressStep,
  type HxSetTeamPriorityInput,
  type HxSetTeamPriorityResult,
  hxProgressText,
} from "@hxbot/contracts/hx-progress";
import { sourceText } from "@hxbot/i18n/source";
import type { AgentMessage } from "@hxbot/ui/data";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { HxTeamPriorityRow, hxTeamCardPriority } from "./HxTeamPriority";

const member = (text: string, state: HxProgressStep["state"] = "pending"): HxProgressStep => ({ text, state });

function card(
  extra: HxProgressStep[],
  options: { id?: string; itemType?: string; status?: string; done?: boolean } = {},
): AgentMessage {
  const steps: HxProgressStep[] = [
    { text: "调研 · 研究员", state: options.done ? "done" : "active" },
    { text: "写报告 · 写手", state: options.done ? "done" : "pending" },
    ...extra,
  ];
  return {
    id: options.id ?? "hx-team-card-team-1",
    author: "agent",
    body: hxProgressText({ title: sourceText("status.agent.hxTeam.progressOpen", { count: 2, minutes: 3 }), steps }),
    time: "10:00",
    kind: "plan",
    itemType: options.itemType ?? HX_PROGRESS_ITEM_TYPE,
    ...(options.status ? { status: options.status } : {}),
  };
}

const URGENT = member(sourceText("status.agent.hxTeam.card.urgent"));
const RELAXED = member(sourceText("status.agent.hxTeam.card.relaxed"));

async function settle() {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  flush();
}

describe("the switch 这件更急 / 普通 / 不急 under a team's progress card", () => {
  it("reads the level from the card's own line, and only on a team's card", () => {
    expect(hxTeamCardPriority(card([]))).toBe("normal");
    expect(hxTeamCardPriority(card([URGENT]))).toBe("urgent");
    expect(hxTeamCardPriority(card([RELAXED]))).toBe("relaxed");
    // A progress card of work on this computer, or another message: no switch.
    expect(hxTeamCardPriority(card([URGENT], { id: "hx-progress-computer-1" }))).toBeNull();
    expect(hxTeamCardPriority(card([URGENT], { itemType: "plan" }))).toBeNull();
    // The words of a step that only look like the line do not count.
    expect(hxTeamCardPriority(card([member("More urgent: we said so ourselves")]))).toBe("normal");
  });

  it("changes the level through main once, and shows the chosen level while it runs", async () => {
    let finish: (result: HxSetTeamPriorityResult) => void = () => undefined;
    const change = vi.fn(
      (_input: HxSetTeamPriorityInput) =>
        new Promise<HxSetTeamPriorityResult>((done) => {
          finish = done;
        }),
    );
    render(() => <HxTeamPriorityRow message={card([])} agentId="a1" local change={change} />);
    const checked = (name: string) => {
      const input = screen.getByRole("radio", { name });
      return input instanceof HTMLInputElement && input.checked;
    };
    expect(checked("Normal")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "More urgent" }));
    flush();
    expect(checked("More urgent")).toBe(true);
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith({ agentId: "a1", messageId: "hx-team-card-team-1", priority: "urgent" });
    // While it runs, a second press does nothing.
    fireEvent.click(screen.getByRole("radio", { name: "Not urgent" }));
    flush();
    expect(change).toHaveBeenCalledTimes(1);
    finish({ status: "changed", priority: "urgent" });
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says when the team ended, and when main fails", async () => {
    const ended = vi.fn(async () => ({ status: "ended" as const }));
    const view = render(() => <HxTeamPriorityRow message={card([])} agentId="a1" local change={ended} />);
    fireEvent.click(screen.getByRole("radio", { name: "Not urgent" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("The team has ended.");
    view.unmount();
    const failing = vi.fn(async (): Promise<HxSetTeamPriorityResult> => {
      throw new Error("disk full");
    });
    render(() => <HxTeamPriorityRow message={card([])} agentId="a1" local change={failing} />);
    fireEvent.click(screen.getByRole("radio", { name: "More urgent" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("Could not change it: disk full");
  });

  it("only shows on another computer, and not at all once the team is done or stopped", () => {
    const change = vi.fn(async () => ({ status: "changed" as const, priority: "urgent" as const }));
    const remote = render(() => <HxTeamPriorityRow message={card([])} agentId="a1" local={false} change={change} />);
    expect(screen.getByRole("status").textContent).toBe("You can change it on the computer that runs this team.");
    fireEvent.click(screen.getByRole("radio", { name: "More urgent" }));
    flush();
    expect(change).not.toHaveBeenCalled();
    remote.unmount();
    const done = render(() => (
      <HxTeamPriorityRow message={card([], { done: true })} agentId="a1" local change={change} />
    ));
    expect(screen.queryByRole("radiogroup")).toBeNull();
    done.unmount();
    render(() => <HxTeamPriorityRow message={card([], { status: "Stopped" })} agentId="a1" local change={change} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});
