// HXBot v1.7.4（BAK-03）：HXBot 自己在工具调用中途问用户的问题（现在只有“版本空间满了”）。
//
// 它是一张普通的提问卡（attention-registry.ts 的 hxAsk）：这台电脑、网页、手机都能答；答案由 HXBot 读，
// 不发给服务商。会改用户数据的选项只有这台 HXBot 的主人能选，谁都可以选“取消”。
// 停止、到时间、服务商连接断开、或者是外部聊天（看不到卡片）时，答案是 null：修改取消，什么都不改。
import type { AgentPromptQuestion } from "@hxbot/contracts/ipc";
import { sourceText } from "@hxbot/i18n";

export type HxAskAnswers = Readonly<Record<string, readonly string[]>>;

/** What the question card keeps: where its answer goes, and which answers only the owner may give. */
export interface HxAskPending {
  reply(answers: HxAskAnswers | null): void;
  ownerOnly(answers: HxAskAnswers): boolean;
}

/**
 * Asks the user in the conversation of the tool call and waits. Null: nobody can answer here, or the
 * question closed without an answer (stop, deadline, a lost provider).
 */
export type HxAsk = (
  questions: AgentPromptQuestion[],
  ownerOnly: (answers: HxAskAnswers) => boolean,
  signal: AbortSignal,
) => Promise<HxAskAnswers | null>;

/** The refusal when a member, a chat app user or a local script picks an answer only the owner may give. */
export const HX_ASK_OWNER_ONLY = sourceText("error.backend.hxAskOwnerOnly");
