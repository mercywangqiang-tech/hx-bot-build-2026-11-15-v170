// HXBot 真实模型检查（v1.6.7）：“谁来想”。检查程序的每个角色（发起的助手、带头的、操作电脑的助手）
// 各有一段对话；一轮里模型调用 HXBot 的工具，检查程序用产品自己的代码回答。
//   - hxChatBrain：直接连 OpenAI 兼容的 chat/completions（自己管对话历史）。
//   - acp-brain.ts：经 OpenCode 自己的客户端（opencode acp），用 OpenCode 的免费模型——这些模型只接受
//     OpenCode 客户端的请求。
import type { HxChatMessage, HxChatModel, HxChatTool } from "./chat-model";
import { type HxLoopCall, hxToolLoop } from "./loop";

export interface HxBrainTurn {
  calls: HxLoopCall[];
  /** The text of the last answer of the turn. */
  text: string;
  end: "stopped" | "limit" | "error";
  error?: string;
}

export interface HxBrain {
  /** Who thinks, for the report. */
  readonly name: string;
  /**
   * One turn in the conversation `session`: the user's words, the tools of that conversation and
   * what answers them. `system` is the standing instruction of the conversation, read on each turn
   * (a brain that cannot change it after the first turn sends the new one with the words).
   */
  turn(input: {
    session: string;
    system: string;
    user: string;
    tools: readonly HxChatTool[];
    handle: (name: string, args: unknown) => Promise<string>;
    maxTurns: number;
  }): Promise<HxBrainTurn>;
  close(): Promise<void>;
}

/** A brain on a chat/completions model: the history of each conversation stays here. */
export function hxChatBrain(model: HxChatModel): HxBrain {
  const histories = new Map<string, HxChatMessage[]>();
  return {
    name: model.name,
    async turn(input) {
      const history = histories.get(input.session) ?? [];
      histories.set(input.session, history);
      if (history[0]?.role === "system") history[0] = { role: "system", content: input.system };
      else history.unshift({ role: "system", content: input.system });
      history.push({ role: "user", content: input.user });
      return hxToolLoop({
        model,
        history,
        tools: input.tools,
        handle: input.handle,
        maxTurns: input.maxTurns,
      });
    },
    async close() {},
  };
}
