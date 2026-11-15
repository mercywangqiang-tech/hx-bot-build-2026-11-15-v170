// HXBot 真实模型检查（v1.6.7）：一个助手的一轮对话。模型调用工具，检查程序用 HXBot 自己的代码回答，
// 直到模型不再调用工具（这一轮结束）或到了上限。
import type { HxChatMessage, HxChatModel, HxChatTool } from "./chat-model";
import { hxAssistantMessage } from "./chat-model";

export interface HxLoopCall {
  name: string;
  /** The arguments as read; null when the model wrote text that is not JSON. */
  args: unknown;
  answer: string;
}

interface HxLoopResult {
  calls: HxLoopCall[];
  /** The text of the last turn, when the model stopped calling tools. */
  text: string;
  /** Why the loop ended: the model stopped, the turn limit, or a model error. */
  end: "stopped" | "limit" | "error";
  error?: string;
}

/**
 * The tool name the model meant. Some models write the namespace in front: `hxbot.team`,
 * `hxbot_team` or `hxbot__team`.
 */
function hxToolName(name: string, known: ReadonlySet<string>): string {
  if (known.has(name)) return name;
  const plain = name.replace(/^hxbot(?:\.|__|_)/, "");
  return known.has(plain) ? plain : name;
}

/** Runs turns until the model answers in text only. `history` grows with every message. */
export async function hxToolLoop(input: {
  model: HxChatModel;
  history: HxChatMessage[];
  tools: readonly HxChatTool[];
  handle: (name: string, args: unknown) => Promise<string>;
  maxTurns: number;
}): Promise<HxLoopResult> {
  const known = new Set(input.tools.map((tool) => tool.name));
  const calls: HxLoopCall[] = [];
  for (let turn = 0; turn < input.maxTurns; turn += 1) {
    let answer: Awaited<ReturnType<HxChatModel["turn"]>>;
    try {
      answer = await input.model.turn(input.history, input.tools);
    } catch (error) {
      return { calls, text: "", end: "error", error: error instanceof Error ? error.message : String(error) };
    }
    input.history.push(hxAssistantMessage(answer));
    if (!answer.calls.length) return { calls, text: answer.text, end: "stopped" };
    for (const call of answer.calls) {
      const name = hxToolName(call.name, known);
      let args: unknown = null;
      let reply: string;
      try {
        args = call.arguments.trim() ? JSON.parse(call.arguments) : {};
      } catch {
        args = null;
      }
      if (args === null) reply = JSON.stringify({ status: "invalid", reason: "The arguments are not JSON." });
      else if (!known.has(name))
        reply = JSON.stringify({ status: "invalid", reason: `There is no tool ${call.name}.` });
      else {
        try {
          reply = await input.handle(name, args);
        } catch (error) {
          reply = JSON.stringify({ status: "failed", reason: error instanceof Error ? error.message : String(error) });
        }
      }
      calls.push({ name, args, answer: reply });
      input.history.push({ role: "tool", tool_call_id: call.id, content: reply });
    }
  }
  return { calls, text: "", end: "limit" };
}
