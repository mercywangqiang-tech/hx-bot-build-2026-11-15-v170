// HXBot v1.7.5（CONC-16）：团队进度卡下面裁判自动模式的按钮。
import { HX_PROGRESS_ITEM_TYPE, type HxProgressStep, hxProgressText } from "@hxbot/contracts/hx-progress";
import type { HxTeamCardActionInput, HxTeamCardActionResult } from "@hxbot/contracts/hx-team-card";
import { sourceText } from "@hxbot/i18n/source";
import type { AgentMessage } from "@hxbot/ui/data";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { HxTeamJudgeRow, hxTeamCardJudge } from "./HxTeamJudge";

function card(extra: HxProgressStep[], options: { id?: string; status?: string; done?: boolean } = {}): AgentMessage {
  const steps: HxProgressStep[] = [
    { text: "调研 · 研究员", state: options.done ? "done" : "active" },
    ...extra.map((step) => (options.done ? { ...step, state: "done" as const } : step)),
  ];
  return {
    id: options.id ?? "hx-team-card-team-1",
    author: "agent",
    body: hxProgressText({ title: sourceText("status.agent.hxTeam.progressOpen", { count: 1, minutes: 3 }), steps }),
    time: "10:00",
    kind: "plan",
    itemType: HX_PROGRESS_ITEM_TYPE,
    ...(options.status ? { status: options.status } : {}),
  };
}

const OFFER: HxProgressStep = {
  text: sourceText("status.agent.hxTeam.card.judgeOffer", { count: 5 }),
  state: "pending",
};
const WENT: HxProgressStep = {
  text: sourceText("status.agent.hxTeam.card.judgeWent", { reason: "The file just changed." }),
  state: "pending",
};

async function settle() {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  flush();
}

describe("the judge's buttons under a team's progress card", () => {
  it("reads what the card offers from its own line, and only on a running team's card", () => {
    expect(hxTeamCardJudge(card([]))).toBeNull();
    expect(hxTeamCardJudge(card([OFFER]))).toBe("offer");
    expect(hxTeamCardJudge(card([WENT]))).toBe("went");
    expect(hxTeamCardJudge(card([OFFER], { id: "hx-progress-computer-1" }))).toBeNull();
    expect(hxTeamCardJudge(card([OFFER], { status: "Stopped" }))).toBeNull();
    expect(hxTeamCardJudge(card([OFFER], { done: true }))).toBeNull();
    // Words that are not the line do not count.
    expect(hxTeamCardJudge(card([{ text: "The judge looked at it", state: "pending" }]))).toBeNull();
  });

  it("the offer turns the automatic mode on through main", async () => {
    const act = vi.fn(
      (_input: HxTeamCardActionInput): Promise<HxTeamCardActionResult> => Promise.resolve({ status: "done" }),
    );
    render(() => <HxTeamJudgeRow message={card([OFFER])} agentId="a1" local act={act} />);
    fireEvent.click(screen.getByRole("button", { name: "From now on, do as the judge says in cases like this" }));
    await settle();
    expect(act).toHaveBeenCalledWith({ agentId: "a1", messageId: "hx-team-card-team-1", action: "judge-auto" });
  });

  it("a pass has wrap up, stop and ask me again", async () => {
    const act = vi.fn(
      (_input: HxTeamCardActionInput): Promise<HxTeamCardActionResult> => Promise.resolve({ status: "done" }),
    );
    render(() => <HxTeamJudgeRow message={card([WENT])} agentId="a1" local act={act} />);
    for (const [name, action] of [
      ["Wrap up", "finish"],
      ["Stop", "stop"],
      ["Ask me each time again", "judge-ask"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      await settle();
      expect(act).toHaveBeenLastCalledWith({ agentId: "a1", messageId: "hx-team-card-team-1", action });
    }
  });

  it("says when main refuses, and another computer only looks", async () => {
    const refused = vi.fn((): Promise<HxTeamCardActionResult> => Promise.resolve({ status: "refused" }));
    const view = render(() => <HxTeamJudgeRow message={card([OFFER])} agentId="a1" local act={refused} />);
    fireEvent.click(screen.getByRole("button", { name: "From now on, do as the judge says in cases like this" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("This choice is not open now.");
    view.unmount();
    render(() => <HxTeamJudgeRow message={card([OFFER])} agentId="a1" local={false} act={refused} />);
    expect(
      screen
        .getByRole("button", { name: "From now on, do as the judge says in cases like this" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Change this on the computer that runs this team.");
  });
});
