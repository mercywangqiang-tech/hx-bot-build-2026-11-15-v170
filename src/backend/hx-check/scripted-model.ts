// HXBot 真实模型检查（v1.6.7）：一个按固定剧本回答的“模型”，只给 `--self-test` 用：在没有网络的
// 开发机上先把检查程序自己跑通，再拿到 GitHub 上连真实模型。它不是对产品的检查。
import { isDynamicRecord } from "@hxbot/contracts/runtime-values";
import type { HxChatMessage, HxChatModel, HxChatTurn } from "./chat-model";

const FORM = (goal: string) =>
  [
    `目标：${goal}`,
    "已完成：无",
    "文件：/check/shared/report.md",
    "未解决：无",
    "下一步：完成后交回结果",
    "不要碰：别的文件",
  ].join("\n");

let calls = 0;

function call(name: string, args: unknown): HxChatTurn {
  calls += 1;
  return { text: "", calls: [{ id: `s-${calls}`, name, arguments: JSON.stringify(args) }] };
}

const text = (words: string): HxChatTurn => ({ text: words, calls: [] });

function lastUser(history: readonly HxChatMessage[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role === "user") return message.content;
  }
  return "";
}

/** The tool messages after the last user message. */
function since(history: readonly HxChatMessage[]): string[] {
  const out: string[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message || message.role === "user") break;
    if (message.role === "tool") out.unshift(message.content);
  }
  return out;
}

function statusOf(raw: string): string {
  try {
    const value = JSON.parse(raw);
    return isDynamicRecord(value) && typeof value.status === "string" ? value.status : "";
  } catch {
    return "";
  }
}

function memberId(system: string, word: RegExp): string {
  const line = system.split("\n").find((item) => word.test(item)) ?? "";
  return /agentId ([\w-]+)/u.exec(line)?.[1] ?? "";
}

export function hxScriptedModel(): HxChatModel {
  return {
    name: "scripted (self-test)",
    async turn(history) {
      const system = history[0]?.role === "system" ? history[0].content : "";
      const user = lastUser(history);
      const tools = since(history);
      if (system.includes("Computer Use")) return text("done");
      if (!system.includes("lead of this channel")) {
        // The starter.
        if (user.includes("咖啡店")) {
          if (tools.length === 0)
            return call("propose_plan", {
              summary: "3 个智能体，约 40 分钟",
              roles: [
                { name: "研究员", kind: "do", does: "查资料", work: "data" },
                { name: "写手", kind: "do", does: "写报告", work: "writing" },
                { name: "审稿", kind: "check", does: "检查报告", work: "writing" },
              ],
              steps: [
                { title: "查资料", role: "研究员" },
                { title: "写报告", role: "写手" },
                { title: "检查", role: "审稿" },
              ],
            });
          if (tools.length === 1)
            return call("start_team", {
              goal: user,
              roles: [
                { name: "研究员", kind: "do", does: "查资料、做调研", work: "data" },
                { name: "写手", kind: "do", does: "写报告", work: "writing" },
                { name: "审稿", kind: "check", does: "检查报告", work: "writing" },
              ],
              steps: [
                { title: "查资料", role: "研究员" },
                { title: "写报告", role: "写手" },
                { title: "检查", role: "审稿" },
              ],
              limits: { members: 3, minutes: 40, rounds: 10 },
            });
          return text("团队开始了。");
        }
        if (tools.length) return text("好的。");
        if (user.includes("再给 30 分钟")) return call("team", { action: "limits", minutes: 70, rounds: 20 });
        if (user.includes("跟团队说"))
          return call("team", { action: "message", text: "报告里加一段竞争对手的价格对比。" });
        if (user.includes("换一个人")) return call("team", { action: "swap", member: "写手" });
        if (user.includes("停一下")) return call("team", { action: "stop" });
        return text("好的。");
      }
      // The lead.
      const request = /id (msg-\d+)/u.exec(system)?.[1] ?? "msg-1";
      const assign = (word: RegExp, goal: string) =>
        call("channel_assign", {
          recipientAgentId: memberId(system, word),
          task: FORM(goal),
          expectedResult: goal,
          sourceMessageIds: [request],
        });
      const answered = tools.map(statusOf);
      if (user.includes("【协作任务】")) {
        if (answered.length === 0) return call("team_board", { action: "read" });
        const lastStatus = answered.at(-1);
        if (lastStatus === "assigned") return text("已分派，等结果。");
        // The lead is the first role (research) and does that part; the writing goes out.
        return assign(/写手|Writer/u, "写 300 字报告：周边人群、竞争对手和价格");
      }
      if (user.includes("【检查结果】")) {
        if (answered.length === 0) return call("team_done", { result: "《社区咖啡店开业调研》已完成并检查。" });
        return text("交回了。");
      }
      if (user.includes("成员交回了结果")) {
        if (answered.length === 0) return assign(/审稿|Reviewer/u, "检查报告");
        return text("已分派，等结果。");
      }
      return text("等待。");
    },
  };
}
