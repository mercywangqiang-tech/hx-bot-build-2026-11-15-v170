// HXBot v1.7.4（CU-07 演示：Keynote）：Mac 上 .key 文件的四个基本动作（加页、改文字、删页、移页）由 Keynote
// 自己在临时文件夹的副本上做，存成新文件交回 run.ts，由 run.ts 留版本、写回、读回。
// Keynote 做之前和之后各读一遍每页的标题和正文；按动作算出“应该是什么样”，对不上就不写回。
// 页码、动作经环境变量传给脚本，文字（可能有引号、换行、中文）写进 UTF-8 文件，都不拼进脚本文字。
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { hxRunFailure, hxRunOk } from "../hx-computer/runner";
import type { HxBlockChange, HxFileDiff } from "../hx-files/diff";
import type { HxAppRouteHost } from "./app-route";
import { SLIDES_PARAMS } from "./declarations";
import { SkillInputError } from "./office";

/** What the Keynote route does in place; other slide actions go through a .pptx copy. */
export const HX_KEYNOTE_ACTIONS: ReadonlySet<string> = new Set(["add", "text", "delete", "move"]);

const TIMEOUT_MS = 180_000;
const UNIT = String.fromCharCode(31);
const RECORD = String.fromCharCode(30);

export interface HxKeynoteSlide {
  title: string;
  body: string;
}

export type HxKeynoteResult =
  | {
      ok: true;
      /** The file Keynote saved, in the work folder. */
      path: string;
      /** The slides did not change (the same text again, a move to the same place). */
      same: boolean;
      done: string;
      before: HxKeynoteSlide[];
      after: HxKeynoteSlide[];
      diff: Omit<HxFileDiff, "before" | "after">;
    }
  | { ok: false; reasons: string[] };

// The script reads its inputs from the environment and from files in HX_DIR; it writes the slides'
// texts before and after into HX_DIR. `save in` a new file: an old document that Keynote converted on
// open has no file of its own, and a plain `save` would ask where.
const SCRIPT = [
  "on fileText(fileName)",
  '  set p to (system attribute "HX_DIR") & "/" & fileName',
  "  try",
  "    return read (POSIX file p) as «class utf8»",
  "  on error",
  '    return ""',
  "  end try",
  "end fileText",
  "on saveText(fileName, theText)",
  '  set p to (system attribute "HX_DIR") & "/" & fileName',
  "  set f to open for access (POSIX file p) with write permission",
  "  try",
  "    set eof of f to 0",
  "    write theText to f as «class utf8»",
  "    close access f",
  "  on error e number n",
  "    close access f",
  "    error e number n",
  "  end try",
  "end saveText",
  "on slideTexts(theDoc)",
  '  set out to ""',
  '  tell application "Keynote"',
  "    repeat with s in slides of theDoc",
  '      set t to ""',
  '      set b to ""',
  "      try",
  "        set t to object text of default title item of s",
  "      end try",
  "      try",
  "        set b to object text of default body item of s",
  "      end try",
  "      set out to out & t & (character id 31) & b & (character id 30)",
  "    end repeat",
  "  end tell",
  "  return out",
  "end slideTexts",
  'set inPath to system attribute "HX_IN"',
  'set outPath to system attribute "HX_OUT"',
  'set act to system attribute "HX_ACTION"',
  'set n1 to (system attribute "HX_N1") as integer',
  'set n2 to (system attribute "HX_N2") as integer',
  'tell application "Keynote"',
  "  set theDoc to open (POSIX file inPath)",
  "  try",
  '    my saveText("before", my slideTexts(theDoc))',
  "    set n to count of slides of theDoc",
  '    if act is "add" then',
  '      set layoutName to my fileText("layout")',
  '      if layoutName is "" then',
  "        set newSlide to make new slide at end of slides of theDoc",
  "      else",
  "        set newSlide to make new slide at end of slides of theDoc with properties {base layout:slide layout layoutName of theDoc}",
  "      end if",
  '      if (system attribute "HX_TITLE") is "1" then set object text of default title item of newSlide to my fileText("title")',
  '      if (system attribute "HX_BODY") is "1" then set object text of default body item of newSlide to my fileText("body")',
  "      if n1 > 0 and n1 ≤ n then move newSlide to before slide n1 of theDoc",
  '    else if act is "delete" then',
  "      delete slide n1 of theDoc",
  '    else if act is "move" then',
  "      if n2 > n1 then",
  "        move slide n1 of theDoc to after slide n2 of theDoc",
  "      else if n2 < n1 then",
  "        move slide n1 of theDoc to before slide n2 of theDoc",
  "      end if",
  '    else if act is "text" then',
  '      if (system attribute "HX_TARGET") is "title" then',
  '        set object text of default title item of slide n1 of theDoc to my fileText("text")',
  "      else",
  '        set object text of default body item of slide n1 of theDoc to my fileText("text")',
  "      end if",
  "    end if",
  "    save theDoc in (POSIX file outPath)",
  '    my saveText("after", my slideTexts(theDoc))',
  "    close theDoc saving no",
  "  on error errMsg number errNum",
  "    try",
  "      close theDoc saving no",
  "    end try",
  "    error errMsg number errNum",
  "  end try",
  "end tell",
].join("\n");

/** Keynote's text with its line breaks (CR, CRLF, line and paragraph separators) as LF. */
export function hxKeynoteText(text: string): string {
  return text.replace(/\r\n|\r|\u2028|\u2029/g, "\n");
}

export function hxKeynoteSlides(text: string): HxKeynoteSlide[] {
  return text
    .split(RECORD)
    .slice(0, -1)
    .map((record) => {
      const at = record.indexOf(UNIT);
      return at < 0
        ? { title: hxKeynoteText(record), body: "" }
        : { title: hxKeynoteText(record.slice(0, at)), body: hxKeynoteText(record.slice(at + 1)) };
    });
}

type Wanted = { title: string | null; body: string | null };

function slideNumber(value: number, count: number, what = "slide"): number {
  if (value < 1 || value > count)
    throw new SkillInputError(`The presentation has ${count} slides; ${what} is 1 to ${count}.`);
  return value;
}

type Parsed =
  | { action: "add"; input: z.infer<typeof SLIDES_PARAMS.add> }
  | { action: "delete"; input: z.infer<typeof SLIDES_PARAMS.delete> }
  | { action: "move"; input: z.infer<typeof SLIDES_PARAMS.move> }
  | { action: "text"; input: z.infer<typeof SLIDES_PARAMS.text> };

function parse(action: string, params: unknown): Parsed {
  switch (action) {
    case "add":
      return { action, input: SLIDES_PARAMS.add.parse(params ?? {}) };
    case "delete":
      return { action, input: SLIDES_PARAMS.delete.parse(params ?? {}) };
    case "move":
      return { action, input: SLIDES_PARAMS.move.parse(params ?? {}) };
    case "text": {
      const input = SLIDES_PARAMS.text.parse(params ?? {});
      if (input.target !== "title" && input.target !== "body")
        throw new SkillInputError("In a Keynote file, target is title or body.");
      return { action, input };
    }
    default:
      throw new SkillInputError(`slides.${action} works on a Keynote file through a .pptx copy.`);
  }
}

/** The slides as they must be after the action, a null text meaning any. Throws for a slide that is not there. */
export function hxKeynoteExpected(parsed: Parsed, before: readonly HxKeynoteSlide[]): Wanted[] {
  const now: Wanted[] = before.map((slide) => ({ ...slide }));
  const count = before.length;
  switch (parsed.action) {
    case "add": {
      const at = parsed.input.at ?? count + 1;
      slideNumber(at, count + 1, "at");
      now.splice(at - 1, 0, {
        title: parsed.input.title === undefined ? null : hxKeynoteText(parsed.input.title),
        body: parsed.input.body === undefined ? null : hxKeynoteText(parsed.input.body),
      });
      return now;
    }
    case "delete": {
      const slide = slideNumber(parsed.input.slide, count);
      if (count === 1) throw new SkillInputError("A presentation keeps at least one slide.");
      now.splice(slide - 1, 1);
      return now;
    }
    case "move": {
      const slide = slideNumber(parsed.input.slide, count);
      const to = slideNumber(parsed.input.to, count, "to");
      const [moved] = now.splice(slide - 1, 1);
      if (moved) now.splice(to - 1, 0, moved);
      return now;
    }
    case "text": {
      const slide = slideNumber(parsed.input.slide, count);
      const target = now[slide - 1];
      if (target) target[parsed.input.target === "title" ? "title" : "body"] = hxKeynoteText(parsed.input.text);
      return now;
    }
  }
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

function mismatch(want: readonly Wanted[], got: readonly HxKeynoteSlide[]): string | null {
  if (want.length !== got.length) return `${got.length} slides instead of ${want.length}`;
  for (const [index, slide] of got.entries()) {
    const wanted = want[index];
    if (!wanted) continue;
    if (wanted.title !== null && wanted.title !== slide.title)
      return `slide ${index + 1} title is "${clip(slide.title)}", not "${clip(wanted.title)}"`;
    if (wanted.body !== null && wanted.body !== slide.body)
      return `slide ${index + 1} body is "${clip(slide.body)}", not "${clip(wanted.body)}"`;
  }
  return null;
}

function diffOf(parsed: Parsed, before: readonly HxKeynoteSlide[], after: readonly HxKeynoteSlide[]) {
  const name = (slide: HxKeynoteSlide | undefined) => clip(slide?.title || slide?.body.split("\n")[0] || "(slide)");
  let block: HxBlockChange;
  let done: string;
  let counts = { added: 0, removed: 0, changed: 1 };
  switch (parsed.action) {
    case "add": {
      const at = parsed.input.at ?? before.length + 1;
      block = { kind: "added", oldNumber: null, newNumber: at, old: "", new: name(after[at - 1]), details: [] };
      done = `slide ${at} added`;
      counts = { added: 1, removed: 0, changed: 0 };
      break;
    }
    case "delete": {
      const slide = parsed.input.slide;
      block = {
        kind: "removed",
        oldNumber: slide,
        newNumber: null,
        old: name(before[slide - 1]),
        new: "",
        details: [],
      };
      done = `slide ${slide} deleted`;
      counts = { added: 0, removed: 1, changed: 0 };
      break;
    }
    case "move": {
      const { slide, to } = parsed.input;
      const title = name(before[slide - 1]);
      block = {
        kind: "moved",
        oldNumber: slide,
        newNumber: to,
        old: title,
        new: title,
        details: [`moved from slide ${slide} to ${to}`],
      };
      done = `slide ${slide} moved to ${to}`;
      break;
    }
    case "text": {
      const { slide, target } = parsed.input;
      const key = target === "title" ? "title" : "body";
      block = {
        kind: "changed",
        oldNumber: slide,
        newNumber: slide,
        old: name(before[slide - 1]),
        new: name(after[slide - 1]),
        details: [`${target}: "${clip(before[slide - 1]?.[key] ?? "")}" → "${clip(after[slide - 1]?.[key] ?? "")}"`],
      };
      done = `slide ${slide} ${target} set`;
      break;
    }
  }
  const diff: Omit<HxFileDiff, "before" | "after"> = {
    kind: "slides",
    identical: false,
    summary: `${done[0]?.toUpperCase() ?? ""}${done.slice(1)} (Keynote).`,
    counts,
    blocks: [block],
    truncated: false,
  };
  return { diff, done };
}

/**
 * Does a basic slide action on a Keynote file with Keynote. `bytes` is the file as the caller read it;
 * Keynote works on a copy of these bytes in `folder` and saves its result as a new file there.
 */
export async function hxKeynoteEdit(
  bytes: Uint8Array,
  action: string,
  params: unknown,
  folder: string,
  host: HxAppRouteHost,
): Promise<HxKeynoteResult> {
  const parsed = parse(action, params);
  if (host.platform !== "darwin") return { ok: false, reasons: ["Keynote is on macOS only"] };
  const input = join(folder, "input.key");
  const output = join(folder, "output.key");
  await writeFile(input, bytes);
  const texts: Record<string, string> = {};
  let n1 = 0;
  let n2 = 0;
  let target = "";
  let title = "0";
  let body = "0";
  switch (parsed.action) {
    case "add":
      n1 = parsed.input.at ?? 0;
      texts.layout = parsed.input.layout ?? "";
      if (parsed.input.title !== undefined) [texts.title, title] = [parsed.input.title, "1"];
      if (parsed.input.body !== undefined) [texts.body, body] = [parsed.input.body, "1"];
      break;
    case "delete":
      n1 = parsed.input.slide;
      break;
    case "move":
      [n1, n2] = [parsed.input.slide, parsed.input.to];
      break;
    case "text":
      [n1, target, texts.text] = [parsed.input.slide, parsed.input.target, parsed.input.text];
      break;
  }
  for (const [name, text] of Object.entries(texts)) await writeFile(join(folder, name), text, "utf8");
  const result = await host.run("osascript", ["-e", SCRIPT], {
    timeoutMs: TIMEOUT_MS,
    env: {
      HX_DIR: folder,
      HX_IN: input,
      HX_OUT: output,
      HX_ACTION: parsed.action,
      HX_N1: String(n1),
      HX_N2: String(n2),
      HX_TARGET: target,
      HX_TITLE: title,
      HX_BODY: body,
    },
  });
  if (!hxRunOk(result)) return { ok: false, reasons: [hxRunFailure("Keynote", result)] };
  const read = (name: string) => readFile(join(folder, name), "utf8").catch(() => null);
  const [beforeText, afterText] = await Promise.all([read("before"), read("after")]);
  const saved = await readFile(output).catch(() => null);
  if (beforeText === null || afterText === null || !saved)
    return { ok: false, reasons: ["Keynote did not save the result"] };
  const before = hxKeynoteSlides(beforeText);
  const after = hxKeynoteSlides(afterText);
  // A slide that is not there is the caller's mistake, answered like the .pptx route answers it.
  const wanted = hxKeynoteExpected(parsed, before);
  const wrong = mismatch(wanted, after);
  if (wrong) return { ok: false, reasons: [`Keynote's result is not what was asked: ${wrong}`] };
  const same =
    (parsed.action === "text" || parsed.action === "move") &&
    before.length === after.length &&
    before.every((slide, index) => slide.title === after[index]?.title && slide.body === after[index]?.body) &&
    (parsed.action === "text" || parsed.input.slide === parsed.input.to);
  const { diff, done } = diffOf(parsed, before, after);
  return { ok: true, path: output, same, done, before, after, diff };
}
