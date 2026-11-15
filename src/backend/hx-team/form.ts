// HXBot 协作（二）：交接单（v1.6.6）。
//
// In a team room, the text of each `channel_assign` and `channel_transfer` is a handoff form with six
// labelled lines. The member that takes the work reads all it needs in the form and does not ask the
// sender again. The check runs before the channel tool, so a form with a missing line is refused and
// the sender writes it again; nothing is half sent.

/** The six parts of a form: each has a Chinese and an English label, and the one the room uses comes first. */
const HX_FORM_PARTS = [
  { key: "goal", zh: "目标", en: "Goal" },
  { key: "done", zh: "已完成", en: "Done" },
  { key: "files", zh: "文件", en: "Files" },
  { key: "open", zh: "未解决", en: "Open" },
  { key: "next", zh: "下一步", en: "Next" },
  { key: "avoid", zh: "不要碰", en: "Avoid" },
] as const;

export type HxFormKey = (typeof HX_FORM_PARTS)[number]["key"];
export type HxForm = Record<HxFormKey, string>;

/** "无" or "none" is a full answer: a form says there is nothing, it does not leave the line out. */
const NOTHING = /^(无|没有|暂无|none|nothing|n\/a|-)[.。]?$/iu;

function labelPattern(part: (typeof HX_FORM_PARTS)[number]): RegExp {
  // A label at the start of a line, with markdown bold or a list mark before it, and a colon after it.
  return new RegExp(`^[\\s>*\\-#]*(?:\\*\\*)?(?:${part.zh}|${part.en})(?:\\*\\*)?\\s*[:：](?:\\*\\*)?\\s*(.*)$`, "iu");
}

const PATTERNS = HX_FORM_PARTS.map((part) => ({ key: part.key, pattern: labelPattern(part) }));

/**
 * The parts of a form, each with the text after its label up to the next label. A part that is not in
 * the text is absent from the result.
 */
export function hxReadForm(text: string): Partial<HxForm> {
  const form: Partial<HxForm> = {};
  let current: HxFormKey | null = null;
  for (const line of text.split(/\r?\n/u)) {
    const hit = PATTERNS.map(({ key, pattern }) => ({ key, match: pattern.exec(line) })).find((item) => item.match);
    if (hit?.match) {
      current = hit.key;
      form[current] = (form[current] ? `${form[current]}\n` : "") + (hit.match[1] ?? "").trim();
      continue;
    }
    if (current) form[current] = `${form[current] ?? ""}\n${line}`;
  }
  for (const part of HX_FORM_PARTS) {
    const value = form[part.key];
    if (value !== undefined) form[part.key] = value.trim();
  }
  return form;
}

/** The labels a form misses or leaves empty, in the order of the form. */
export function hxMissingParts(text: string): HxFormKey[] {
  const form = hxReadForm(text);
  return HX_FORM_PARTS.filter((part) => !form[part.key]?.trim()).map((part) => part.key);
}

/** The template the refusal shows, in the language of the room. */
export function hxFormTemplate(language: "zh" | "en"): string {
  return HX_FORM_PARTS.map((part) => `${part[language]}${language === "zh" ? "：" : ": "}…`).join("\n");
}

/** The label of a part, in the language of the room. */
export function hxFormLabel(key: HxFormKey, language: "zh" | "en"): string {
  const part = HX_FORM_PARTS.find((item) => item.key === key);
  return part ? part[language] : key;
}

/**
 * The files a form names: one per line or separated by commas, without list marks, quotes or
 * backticks. "None" names no file. At most 40, each at most 500 characters.
 */
export function hxFormFiles(form: Partial<HxForm>): string[] {
  const text = form.files ?? "";
  const files = text
    .split(/[\n,，、;；]+/u)
    .map((item) =>
      item
        .replace(/^[\s>*\-•\d.)]+/u, "")
        .replace(/[`'"“”‘’]/gu, "")
        .trim(),
    )
    .filter((item) => item && !NOTHING.test(item) && item.length <= 500);
  return [...new Set(files)].slice(0, 40);
}

/** Whether a part says "nothing". */
export function hxSaysNothing(value: string | undefined): boolean {
  return value !== undefined && NOTHING.test(value.trim());
}
