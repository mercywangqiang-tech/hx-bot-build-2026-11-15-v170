// HXBot v1.7.4（CU-07 系统设置技能）：读、改、打开系统设置。改只改“已验证项”（这台电脑上自检通过、
// 有直接命令、改完读回对得上的那些）；安全类页面（隐私与安全性等）只打开、不改，由用户自己动手。
// 具体的读写由电脑操控目录（hx-computer/actions.ts）做；这里把它的结果变成技能的回答和读回证据。
import type { HxBrief, HxOpenResult, HxSetResult } from "../hx-computer/actions";
import { SETTINGS_PARAMS } from "./declarations";
import { SkillInputError } from "./office";
import type { HxJson } from "./operations";

export interface HxSettingsHost {
  readSetting(input: { id?: string; query?: string }): Promise<HxSetResult>;
  set(input: { id?: string; query?: string; value?: string }): Promise<HxSetResult>;
  openSettingsPage(input: { id?: string; query?: string }): Promise<HxOpenResult>;
}

export interface HxSettingsAnswer {
  ok: boolean;
  answer: { readonly [key: string]: HxJson | undefined };
  /** One line for the activity record. */
  detail: string;
}

function brief(item: HxBrief): { [key: string]: HxJson | undefined } {
  return {
    id: item.id,
    title: item.title,
    ...(item.values ? { values: JSON.parse(JSON.stringify(item.values)) } : {}),
    ...(item.direct !== undefined ? { direct: item.direct } : {}),
    ...(item.security ? { security: true } : {}),
  };
}

function which(input: { id?: string | undefined; query?: string | undefined }): { id?: string; query?: string } {
  if ((input.id ? 1 : 0) + (input.query ? 1 : 0) !== 1)
    throw new SkillInputError("Give exactly one of query (the name of a setting, such as 深色模式) and id.");
  return input.id ? { id: input.id } : { query: input.query ?? "" };
}

function fromSet(result: HxSetResult, wanted: string | null): HxSettingsAnswer {
  switch (result.status) {
    case "value":
      return {
        ok: true,
        answer: { setting: brief(result.setting), value: result.value },
        detail: `${result.setting.title} = ${result.value}`,
      };
    case "changed":
      return {
        ok: true,
        answer: {
          done: `${result.setting.title}: ${result.previous} → ${result.value}`,
          setting: brief(result.setting),
          previous: result.previous,
          value: result.value,
          verified: true,
          readback: { checked: 1 },
          undo: `To undo, change it back to ${result.previous}.`,
        },
        detail: `${result.setting.title}: ${result.previous} → ${result.value}`,
      };
    case "unchanged":
      return {
        ok: true,
        answer: {
          done: "Nothing to change: the setting already has this value.",
          setting: brief(result.setting),
          value: result.value,
          verified: true,
        },
        detail: `${result.setting.title} already ${result.value}`,
      };
    case "page":
      // Not a verified setting, or a security page: the page is open, nothing was changed.
      return {
        ok: wanted === null,
        answer: {
          code: wanted === null ? "page-open" : "not-changed",
          page: brief(result.page),
          opened: result.opened,
          note: `${result.reason} The settings skill changes only verified settings, and never on a security page: nothing was changed. Tell the user what to change there.`,
        },
        detail: `${result.page.title} opened, nothing changed`,
      };
    case "candidates":
      return {
        ok: false,
        answer: {
          code: "choose",
          note: "More than one setting fits. Call again with the id of one.",
          candidates: result.candidates.map(brief),
        },
        detail: "several settings fit",
      };
    case "invalid-value":
      return {
        ok: false,
        answer: { code: "invalid", error: `This setting takes ${result.expected}.`, setting: brief(result.setting) },
        detail: `invalid value for ${result.setting.title}`,
      };
    default:
      return { ok: false, answer: { code: result.status, error: result.reason }, detail: result.reason.slice(0, 120) };
  }
}

export async function hxSettingsRun(action: string, params: unknown, host: HxSettingsHost): Promise<HxSettingsAnswer> {
  if (action === "read") {
    const input = SETTINGS_PARAMS.read.parse(params ?? {});
    return fromSet(await host.readSetting(which(input)), null);
  }
  if (action === "change") {
    const input = SETTINGS_PARAMS.change.parse(params ?? {});
    return fromSet(await host.set({ ...which(input), value: input.value }), input.value);
  }
  if (action === "open") {
    const input = SETTINGS_PARAMS.open.parse(params ?? {});
    const result = await host.openSettingsPage(which(input));
    if (result.status === "opened") {
      const what = result.what;
      const title = "title" in what ? what.title : what.target;
      return {
        ok: true,
        answer: { done: `${title} is open.`, ...("id" in what ? { page: brief(what) } : {}) },
        detail: `${title} opened`,
      };
    }
    if (result.status === "candidates") {
      return {
        ok: false,
        answer: {
          code: "choose",
          note: "More than one page fits. Call again with the id of one.",
          candidates: result.candidates.map(brief),
        },
        detail: "several pages fit",
      };
    }
    return { ok: false, answer: { code: result.status, error: result.reason }, detail: result.reason.slice(0, 120) };
  }
  throw new SkillInputError(`${action} is not an action of the settings skill.`);
}
