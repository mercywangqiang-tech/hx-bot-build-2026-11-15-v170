// HXBot v1.7.4（CU-07 PDF 技能）：取文字、看表单、填表、抽页、拆分、合并。抽页、拆分、合并总是写新文件，
// 不覆盖原文件；填表在原文件上追加更新（原字节不动，旧签名覆盖的内容不变）。
import { basename, extname, join } from "node:path";
import { HxPdf, hxPdfCopyPages, hxPdfFields, hxPdfFill, parsePageRanges } from "../hx-files/pdf";
import { hxPdfText } from "../hx-files/pdf-text";
import { PDF_PARAMS } from "./declarations";
import { type HxNativeChange, type HxReadbackCheck, SkillInputError } from "./office";

/** New files made from the input: written by the caller, never over an existing file. */
export interface HxSkillOutputs {
  files: { path: string; bytes: Uint8Array }[];
  done: string;
  check: (saved: ReadonlyMap<string, Uint8Array>) => Promise<HxReadbackCheck[]>;
}

const MAX_CHECKED_PAGES = 20;

function readable(bytes: Uint8Array): HxPdf {
  const pdf = HxPdf.read(bytes);
  if (pdf.encrypted)
    throw new SkillInputError(
      "The PDF is encrypted; HXBot does not change it. Ask the user for a copy without a password.",
    );
  return pdf;
}

export async function hxPdfRead(bytes: Uint8Array, action: string, params: unknown, signal?: AbortSignal) {
  if (action === "fields") {
    PDF_PARAMS.fields.parse(params ?? {});
    const pdf = readable(bytes);
    return {
      fields: hxPdfFields(pdf).map((field) => ({
        name: field.name,
        type: field.type,
        value: field.value,
        ...(field.options.length
          ? {
              options: field.labels.map((label, index) =>
                label === field.options[index] ? label : `${label} (${field.options[index]})`,
              ),
            }
          : {}),
        ...(field.readOnly ? { readOnly: true } : {}),
        ...(field.required ? { required: true } : {}),
        ...(field.maxLength !== null ? { maxLength: field.maxLength } : {}),
        pages: field.pages,
      })),
    };
  }
  const input = PDF_PARAMS.read.parse(params ?? {});
  let count: number | null = null;
  try {
    const pdf = HxPdf.read(bytes);
    count = pdf.encrypted ? null : pdf.pages().length;
  } catch {
    // pdf.js reads some files that HXBot's own reader cannot; it says so itself when it cannot either.
  }
  const pages = input.pages && count !== null ? parsePageRanges(input.pages, count) : undefined;
  const text = await hxPdfText(bytes, {
    ...(pages ? { pages } : {}),
    maxChars: input.maxChars ?? 200_000,
    ...(signal ? { signal } : {}),
  });
  if (input.pages && count === null) {
    const wanted = parsePageRanges(input.pages, text.pageCount);
    return {
      pageCount: text.pageCount,
      truncated: text.truncated,
      pages: text.pages.filter((page) => wanted.includes(page.page - 1)),
    };
  }
  return {
    pageCount: text.pageCount,
    truncated: text.truncated,
    ...(text.repaired ? { repaired: true } : {}),
    pages: text.pages,
  };
}

/** Fills the form in place (an appended update). */
export function hxPdfFillChange(bytes: Uint8Array, params: unknown): HxNativeChange {
  const input = PDF_PARAMS.fill.parse(params ?? {});
  if (Object.keys(input.values).length === 0) throw new SkillInputError("Give at least one field value.");
  const pdf = readable(bytes);
  // Filling a field with the value it has adds nothing: the same call twice changes the file once.
  // Read what the fields hold before filling: hxPdfFill changes the objects of `pdf` in memory.
  const now = new Map(hxPdfFields(pdf).map((field) => [field.name, field.value]));
  const { bytes: filled, filled: names } = hxPdfFill(pdf, input.values);
  const after = new Map(hxPdfFields(HxPdf.read(filled)).map((field) => [field.name, field.value]));
  if (names.every((name) => now.get(name) === after.get(name))) {
    return { bytes, done: "Nothing to fill: the fields already hold these values.", check: () => [] };
  }
  // What each field holds now, read from the filled bytes: the saved file must say the same.
  const expected = after;
  return {
    bytes: filled,
    done: `${names.length} fields filled (appended to the PDF; the original bytes are unchanged)`,
    check: (saved) => {
      const got = new Map(hxPdfFields(HxPdf.read(saved)).map((field) => [field.name, field.value]));
      const prefix = Buffer.compare(Buffer.from(saved.subarray(0, bytes.length)), Buffer.from(bytes)) === 0;
      return [
        { what: "the original bytes are unchanged", ok: prefix },
        ...names.map((name) => ({
          what: `field ${name}`,
          ok: got.get(name) === expected.get(name),
          expected: expected.get(name) ?? "",
          actual: got.get(name) ?? "(missing)",
        })),
      ];
    },
  };
}

async function pageTexts(bytes: Uint8Array, pages: number[], signal?: AbortSignal): Promise<string[]> {
  if (pages.length === 0) return [];
  const result = await hxPdfText(bytes, { pages, maxChars: 2_000_000, ...(signal ? { signal } : {}) });
  return result.pages.map((page) => page.text);
}

/** Pages copied from `source` (indexes) must show the same text in the new file (pages from 0 there). */
async function sameText(
  what: string,
  source: Uint8Array,
  sourcePages: number[],
  made: Uint8Array,
  signal?: AbortSignal,
): Promise<HxReadbackCheck[]> {
  const checked = sourcePages.slice(0, MAX_CHECKED_PAGES);
  const before = await pageTexts(source, checked, signal);
  const after = await pageTexts(
    made,
    checked.map((_, index) => index),
    signal,
  );
  return checked.map((page, index) => ({
    what: `${what} page ${index + 1} = page ${page + 1}`,
    ok: before[index] === after[index],
    ...(before[index] === after[index]
      ? {}
      : { expected: (before[index] ?? "").slice(0, 120), actual: (after[index] ?? "").slice(0, 120) }),
  }));
}

function partName(input: string, folder: string, label: string): string {
  const stem = basename(input, extname(input));
  return join(folder, `${stem}-${label}.pdf`);
}

export async function hxPdfOutputs(
  action: string,
  inputs: readonly { path: string; bytes: Uint8Array }[],
  output: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<HxSkillOutputs> {
  const first = inputs[0];
  if (!first) throw new SkillInputError("Give the PDF in files.");
  if (action === "extract") {
    const input = PDF_PARAMS.extract.parse(params ?? {});
    const pdf = readable(first.bytes);
    const pages = parsePageRanges(input.pages, pdf.pages().length);
    const bytes = hxPdfCopyPages([{ pdf, pages }]);
    return {
      files: [{ path: output, bytes }],
      done: `${pages.length} pages extracted to ${basename(output)}`,
      check: async (saved) => {
        const made = saved.get(output) ?? new Uint8Array();
        return [
          { what: "page count", ok: HxPdf.read(made).pages().length === pages.length, expected: String(pages.length) },
          ...(await sameText("extract", first.bytes, pages, made, signal)),
        ];
      },
    };
  }
  if (action === "split") {
    const input = PDF_PARAMS.split.parse(params ?? {});
    const pdf = readable(first.bytes);
    const count = pdf.pages().length;
    let groups: { label: string; pages: number[] }[];
    if (input.ranges)
      groups = input.ranges.map((range) => ({
        label: range.replace(/[^0-9a-z-]+/gi, "_"),
        pages: parsePageRanges(range, count),
      }));
    else {
      const every = input.every ?? 1;
      groups = [];
      for (let start = 0; start < count; start += every) {
        const pages = Array.from({ length: Math.min(every, count - start) }, (_, k) => start + k);
        groups.push({ label: every === 1 ? `p${start + 1}` : `p${start + 1}-${start + pages.length}`, pages });
      }
    }
    if (groups.length > 500) throw new SkillInputError("Split into at most 500 files.");
    const files = groups.map((group) => ({
      path: partName(first.path, output, group.label),
      bytes: hxPdfCopyPages([{ pdf, pages: group.pages }]),
      pages: group.pages,
    }));
    if (new Set(files.map((file) => file.path)).size !== files.length)
      throw new SkillInputError("Two parts would get the same name; give different ranges.");
    return {
      files: files.map(({ path, bytes }) => ({ path, bytes })),
      done: `split into ${files.length} files in ${output}`,
      check: async (saved) => {
        const checks: HxReadbackCheck[] = [];
        for (const file of files.slice(0, 50)) {
          const made = saved.get(file.path) ?? new Uint8Array();
          checks.push({
            what: `${basename(file.path)} pages`,
            ok: HxPdf.read(made).pages().length === file.pages.length,
            expected: String(file.pages.length),
          });
        }
        const one = files[0];
        if (one)
          checks.push(
            ...(await sameText(
              basename(one.path),
              first.bytes,
              one.pages,
              saved.get(one.path) ?? new Uint8Array(),
              signal,
            )),
          );
        return checks;
      },
    };
  }
  if (action === "merge") {
    const input = PDF_PARAMS.merge.parse(params ?? {});
    if (inputs.length < 2) throw new SkillInputError("Give at least two PDFs to merge, in order.");
    const sources = inputs.map((file) => {
      const pdf = readable(file.bytes);
      return {
        pdf,
        pages: pdf.pages().map((_, index) => index),
        title: basename(file.path, extname(file.path)),
        bytes: file.bytes,
      };
    });
    const bytes = hxPdfCopyPages(sources, {
      bookmarks: input.bookmarks ?? true,
      ...(input.title ? { title: input.title } : {}),
    });
    const total = sources.reduce((sum, source) => sum + source.pages.length, 0);
    return {
      files: [{ path: output, bytes }],
      done: `${inputs.length} PDFs merged into ${basename(output)} (${total} pages)`,
      check: async (saved) => {
        const made = saved.get(output) ?? new Uint8Array();
        const checks: HxReadbackCheck[] = [
          { what: "page count", ok: HxPdf.read(made).pages().length === total, expected: String(total) },
        ];
        let at = 0;
        const madeTexts = await pageTexts(
          made,
          sources.map((source) => {
            const page = at;
            at += source.pages.length;
            return page;
          }),
          signal,
        );
        for (const [index, source] of sources.entries()) {
          const [text] = await pageTexts(source.bytes, [0], signal);
          checks.push({ what: `first page of ${source.title}`, ok: text === madeTexts[index] });
        }
        return checks;
      },
    };
  }
  throw new SkillInputError(`The pdf skill has no action ${action}.`);
}
