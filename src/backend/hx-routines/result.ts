/**
 * HXBot (v1.7.5, RTN-04): the result of a routine run. A finished turn is only "the turn ended"; the run
 * succeeds only when what it had to do can be read back:
 *
 * - failed: the turn failed or was interrupted, or the agent reported that the task could not be done;
 * - no update: the run had nothing to report (the no-update tool or marker), and nothing below is open;
 * - result not verified: a file the answer says it saved is not there, a file it changed could not be
 *   read back, an external action (send, post, pay, delete) has no known result, or a task that sends,
 *   posts, pays or deletes ended without one tool step;
 * - succeeded: none of the above.
 *
 * "No update" never hides a failure or an unverified external action. A run whose result is not verified
 * is marked in the list and the person is told.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ConversationMessage } from "@hxbot/contracts/ipc";
import { v59ExternalActionKinds } from "../database/hx-routine-detail-schema";
import type { HxResultKind } from "./detail";

type HxResultReason =
  | "turn-failed"
  | "reported-failure"
  | "missing-file"
  | "file-not-read-back"
  | "action-unknown"
  | "no-tool-step";

export interface HxRunJudgeInput {
  outcome: "completed" | "failed" | "interrupted" | string;
  reportedFailure: string | undefined;
  /** The run had nothing to report: the no-update tool or marker, or a quiet turn. */
  noUpdate: boolean;
  /** The last answer of the turn, or undefined. */
  answer: string | undefined;
  /** The messages of the turn: answers, tool steps, cards. */
  turnMessages: readonly ConversationMessage[];
  instruction: string;
  /** Where a relative path in the answer points. Null: only absolute paths are read back. */
  workspace: string | null;
  /** External actions of this run whose result is not known. */
  unknownActions: number;
  /** For tests: whether a path exists. */
  exists?: (path: string) => boolean;
}

export interface HxRunJudgement {
  kind: HxResultKind;
  reasons: HxResultReason[];
  /** The files the answer named that are not there, for the person to read. */
  missing: string[];
}

const TOOL_ITEM = /(tool.*call|commandexecution|filechange|websearch|computeraction)/u;
/** The English of "HXBot could not read the file back to check it." on a file-change card. */
const NOT_READ_BACK = "HXBot could not read the file back to check it.";
const PATH_ANYWHERE = /(?:^|[\s"'“‘「（(`])((?:~\/|\/|[A-Za-z]:\\)[^\s"'”’」）)`,，。;；！!？?]+)/gu;
const SAVED_AS =
  /(?:已保存到|已保存为|保存到|保存为|已生成|生成了|已写入|写入到|已导出到|导出到|saved (?:it )?(?:to|as|in)|wrote(?: it)? to|written to|created|exported (?:it )?to)\s*[:：]?\s*[`"“「]?([^\s`"”」，。,;；]+\.[A-Za-z0-9]{1,8})/giu;

function trimPath(path: string): string {
  return path.replace(/[.:：]+$/u, "");
}

/** The files that the answer says it saved or names by a full path. */
export function hxClaimedFiles(answer: string, workspace: string | null): string[] {
  const found = new Set<string>();
  for (const match of answer.matchAll(PATH_ANYWHERE)) {
    const path = trimPath(match[1] ?? "");
    if (path.length > 1 && /\.[A-Za-z0-9]{1,8}$/u.test(path)) found.add(path);
  }
  for (const match of answer.matchAll(SAVED_AS)) {
    const path = trimPath(match[1] ?? "");
    if (path.startsWith("http")) continue;
    if (isAbsolute(path) || path.startsWith("~/") || /^[A-Za-z]:\\/u.test(path)) found.add(path);
    else if (workspace) found.add(join(workspace, path));
  }
  return [...found].map((path) => (path.startsWith("~/") ? join(homedir(), path.slice(2)) : path));
}

export function hxJudgeRun(input: HxRunJudgeInput): HxRunJudgement {
  if (input.outcome !== "completed") return { kind: "failed", reasons: ["turn-failed"], missing: [] };
  if (input.reportedFailure !== undefined) return { kind: "failed", reasons: ["reported-failure"], missing: [] };
  const reasons: HxResultReason[] = [];
  const exists = input.exists ?? existsSync;
  const missing = input.answer ? hxClaimedFiles(input.answer, input.workspace).filter((path) => !exists(path)) : [];
  if (missing.length > 0) reasons.push("missing-file");
  if (
    input.turnMessages.some((message) => message.itemType === "hx-file-change" && message.text.includes(NOT_READ_BACK))
  ) {
    reasons.push("file-not-read-back");
  }
  if (input.unknownActions > 0) reasons.push("action-unknown");
  const tools = input.turnMessages.filter((message) => TOOL_ITEM.test((message.itemType ?? "").toLowerCase()));
  if (!input.noUpdate && tools.length === 0 && v59ExternalActionKinds(input.instruction).length > 0) {
    reasons.push("no-tool-step");
  }
  if (reasons.length > 0) return { kind: "unverified", reasons, missing };
  return { kind: input.noUpdate ? "no-update" : "succeeded", reasons: [], missing: [] };
}
