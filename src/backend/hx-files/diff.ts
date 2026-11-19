// HXBot v1.7.4（ART-05）：改文件前后的差异。只读两份字节，从不碰原文件。
// 文本给行级差异；表格给单元格级（工作表、单元格、旧值、新值）；Word 给段落级；演示给页级（按页的 id 认页，
// 看得出加页、删页、移动、改了什么）；PDF 给页级文字差异；别的格式、或者读不了的文件给“仅文件级”（大小、哈希变化），
// 从不返回空差异。
import { type HxLineHunk, hxDiffSequences, hxLineHunks } from "./diff-sequence";
import { HxDocument } from "./docx";
import { HxPdf, hxPdfFields } from "./pdf";
import { hxPdfText } from "./pdf-text";
import { HxPresentation, type HxSlide } from "./pptx";
import { sha256 } from "./safe-write";
import { HxWorkbook } from "./xlsx";

export type HxDiffKind = "text" | "sheet" | "document" | "slides" | "pdf" | "file";

export interface HxFileStamp {
  size: number;
  sha256: string;
}

export interface HxCellChange {
  sheet: string;
  cell: string;
  /** The value as a person reads it; a formula shows as "=FORMULA → value". "" for an empty cell. */
  old: string;
  new: string;
}

export interface HxBlockChange {
  kind: "added" | "removed" | "changed" | "moved";
  /** Paragraph, slide or page numbers, from 1; null on the side where the block does not exist. */
  oldNumber: number | null;
  newNumber: number | null;
  old: string;
  new: string;
  /** What changed inside a slide or a page, in short lines. */
  details: string[];
}

export interface HxFileDiff {
  kind: HxDiffKind;
  /** null: the file did not exist before (it was made) or does not exist after (it was deleted). */
  before: HxFileStamp | null;
  after: HxFileStamp | null;
  /** The two files have the same bytes. A structured diff that finds nothing still has identical false. */
  identical: boolean;
  /** One plain English line for the model and the logs. The card builds its own text from the counts. */
  summary: string;
  counts: { added: number; removed: number; changed: number };
  hunks?: HxLineHunk[];
  cells?: HxCellChange[];
  sheets?: { added: string[]; removed: string[] };
  blocks?: HxBlockChange[];
  /** Form fields of a PDF whose value changed. */
  fields?: { name: string; old: string; new: string }[];
  /** Lists were cut at the limits; the counts are still complete. */
  truncated: boolean;
  /** Why the diff stayed at file level. */
  fileOnly?: "unsupported" | "unreadable" | "too-large";
}

export const HX_DIFF_LIMITS = {
  /** Text larger than this on either side is compared at file level only. */
  maxTextBytes: 32 * 1024 * 1024,
  maxHunkLines: 2_000,
  maxCells: 500,
  maxBlocks: 300,
  maxText: 400,
  pdfChars: 4_000_000,
} as const;

const TEXT_EXTENSIONS = new Set(
  "txt md markdown csv tsv json jsonl yaml yml toml ini cfg conf log xml html htm css scss js mjs cjs ts tsx jsx py rb go rs java kt swift c h cc cpp hpp cs php sh bash zsh ps1 bat sql r m tex rst srt vtt env properties gradle".split(
    " ",
  ),
);

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function stamp(bytes: Uint8Array | null): HxFileStamp | null {
  return bytes ? { size: bytes.length, sha256: sha256(bytes) } : null;
}

function clip(text: string): string {
  return text.length > HX_DIFF_LIMITS.maxText ? `${text.slice(0, HX_DIFF_LIMITS.maxText)}…` : text;
}

/** Text if the bytes are UTF-8 (or UTF-16 with a BOM) without NUL characters; null for binary. */
export function hxDecodeText(bytes: Uint8Array): string | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes.includes(0)) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    // GB18030 and other legacy encodings: compare them as text when most bytes are printable.
    let printable = 0;
    for (const byte of bytes) if (byte >= 0x20 || byte === 9 || byte === 10 || byte === 13) printable += 1;
    return bytes.length > 0 && printable / bytes.length > 0.97 ? new TextDecoder("gb18030").decode(bytes) : null;
  }
}

function lines(text: string): string[] {
  if (text === "") return [];
  const split = text.split(/\r\n|\n|\r/);
  if (split.at(-1) === "") split.pop();
  return split;
}

function fileOnly(
  before: Uint8Array | null,
  after: Uint8Array | null,
  why: NonNullable<HxFileDiff["fileOnly"]>,
): HxFileDiff {
  const a = stamp(before);
  const b = stamp(after);
  const identical = a !== null && b !== null && a.sha256 === b.sha256;
  const summary = identical
    ? "No change."
    : !a
      ? `File level only: the file was made (${b?.size ?? 0} bytes).`
      : !b
        ? `File level only: the file was deleted (it had ${a.size} bytes).`
        : `File level only: size ${a.size} → ${b.size} bytes, SHA-256 ${a.sha256.slice(0, 12)} → ${b.sha256.slice(0, 12)}.`;
  return {
    kind: "file",
    before: a,
    after: b,
    identical,
    summary,
    counts: { added: 0, removed: 0, changed: identical ? 0 : 1 },
    truncated: false,
    fileOnly: why,
  };
}

/**
 * The difference between two versions of a file, chosen by its extension. `before` null means the file
 * is new; `after` null means it was deleted. Never throws for a bad file: that diff is file level.
 */
export async function hxDiffFiles(
  path: string,
  before: Uint8Array | null,
  after: Uint8Array | null,
  options: { signal?: AbortSignal } = {},
): Promise<HxFileDiff> {
  const extension = extensionOf(path);
  const a = stamp(before);
  const b = stamp(after);
  if (a && b && a.sha256 === b.sha256) {
    return {
      kind: "file",
      before: a,
      after: b,
      identical: true,
      summary: "No change.",
      counts: { added: 0, removed: 0, changed: 0 },
      truncated: false,
    };
  }
  try {
    if (["xlsx", "xlsm", "xltx", "xltm"].includes(extension)) return withStamps(diffSheets(before, after), a, b);
    if (["docx", "docm", "dotx", "dotm"].includes(extension)) return withStamps(diffDocuments(before, after), a, b);
    if (["pptx", "pptm", "potx", "potm", "ppsx", "ppsm"].includes(extension))
      return withStamps(diffSlides(before, after), a, b);
    if (extension === "pdf") return withStamps(await diffPdf(before, after, options.signal), a, b);
  } catch {
    return fileOnly(before, after, "unreadable");
  }
  const sniffText = TEXT_EXTENSIONS.has(extension) || extension === "";
  if ((before?.length ?? 0) > HX_DIFF_LIMITS.maxTextBytes || (after?.length ?? 0) > HX_DIFF_LIMITS.maxTextBytes)
    return fileOnly(before, after, sniffText ? "too-large" : "unsupported");
  const oldText = before ? hxDecodeText(before) : "";
  const newText = after ? hxDecodeText(after) : "";
  if (oldText === null || newText === null || (!sniffText && !looksLikeText(before, after)))
    return fileOnly(before, after, "unsupported");
  return withStamps(diffText(oldText, newText), a, b);
}

/**
 * A file with an unknown extension is compared as text only when both sides are small, clean UTF-8 and
 * free of control characters other than tab, line feed, form feed and carriage return (binary formats such
 * as a Keynote file start with some).
 */
function looksLikeText(before: Uint8Array | null, after: Uint8Array | null): boolean {
  for (const bytes of [before, after]) {
    if (!bytes) continue;
    if (bytes.length > 4 * 1024 * 1024) return false;
    for (const byte of bytes) if (byte < 0x20 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return false;
    }
  }
  return true;
}

function withStamps(
  diff: Omit<HxFileDiff, "before" | "after">,
  before: HxFileStamp | null,
  after: HxFileStamp | null,
): HxFileDiff {
  // Only equal bytes are identical (those returned early): a diff that finds nothing still names the file change.
  const quiet = diff.counts.added + diff.counts.removed + diff.counts.changed === 0;
  const files = `File: ${before?.size ?? 0} → ${after?.size ?? 0} bytes.`;
  return { ...diff, identical: false, summary: quiet ? `${diff.summary} ${files}` : diff.summary, before, after };
}

function cutHunks(hunks: HxLineHunk[]): { hunks: HxLineHunk[]; truncated: boolean } {
  const kept: HxLineHunk[] = [];
  let total = 0;
  for (const hunk of hunks) {
    if (total + hunk.lines.length > HX_DIFF_LIMITS.maxHunkLines) {
      const room = HX_DIFF_LIMITS.maxHunkLines - total;
      if (room > 0)
        kept.push({ ...hunk, lines: hunk.lines.slice(0, room).map((line) => ({ ...line, text: clip(line.text) })) });
      return { hunks: kept, truncated: true };
    }
    kept.push({ ...hunk, lines: hunk.lines.map((line) => ({ ...line, text: clip(line.text) })) });
    total += hunk.lines.length;
  }
  return { hunks: kept, truncated: false };
}

function diffText(oldText: string, newText: string): Omit<HxFileDiff, "before" | "after"> {
  const a = lines(oldText);
  const b = lines(newText);
  const all = hxLineHunks(a, b);
  let added = 0;
  let removed = 0;
  for (const hunk of all)
    for (const line of hunk.lines) {
      if (line.kind === "+") added += 1;
      else if (line.kind === "-") removed += 1;
    }
  const { hunks, truncated } = cutHunks(all);
  const identical = added === 0 && removed === 0;
  return {
    kind: "text",
    identical,
    summary: identical
      ? "The text is the same (only the line endings or the encoding changed)."
      : `${added} lines added, ${removed} lines removed, in ${all.length} places.`,
    counts: { added, removed, changed: 0 },
    hunks,
    truncated,
  };
}

// ---------------------------------------------------------------------------------------------- sheets

function cellText(read: { text: string; formula: string | null } | undefined): string {
  if (!read) return "";
  return read.formula ? `=${read.formula} → ${read.text}` : read.text;
}

function cellOrder(ref: string): [number, number] {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) return [0, 0];
  let col = 0;
  for (const char of match[1] ?? "") col = col * 26 + char.charCodeAt(0) - 64;
  return [Number(match[2]), col];
}

function diffSheets(before: Uint8Array | null, after: Uint8Array | null): Omit<HxFileDiff, "before" | "after"> {
  const oldBook = before ? HxWorkbook.read(before) : null;
  const newBook = after ? HxWorkbook.read(after) : null;
  const oldSheets = oldBook?.sheets().map((sheet) => sheet.name) ?? [];
  const newSheets = newBook?.sheets().map((sheet) => sheet.name) ?? [];
  const cells: HxCellChange[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  const order = [...newSheets, ...oldSheets.filter((name) => !newSheets.includes(name))];
  for (const name of order) {
    const oldCells = oldBook && oldSheets.includes(name) ? oldBook.allCells(name) : new Map();
    const newCells = newBook && newSheets.includes(name) ? newBook.allCells(name) : new Map();
    const refs = [...new Set([...oldCells.keys(), ...newCells.keys()])].sort((x, y) => {
      const [rx, cx] = cellOrder(x);
      const [ry, cy] = cellOrder(y);
      return rx - ry || cx - cy;
    });
    for (const ref of refs) {
      const oldText = cellText(oldCells.get(ref));
      const newText = cellText(newCells.get(ref));
      if (oldText === newText) continue;
      if (oldText === "") added += 1;
      else if (newText === "") removed += 1;
      else changed += 1;
      if (cells.length < HX_DIFF_LIMITS.maxCells)
        cells.push({ sheet: name, cell: ref, old: clip(oldText), new: clip(newText) });
    }
  }
  const sheets = {
    added: newSheets.filter((name) => !oldSheets.includes(name)),
    removed: oldSheets.filter((name) => !newSheets.includes(name)),
  };
  const total = added + removed + changed;
  const parts = [`${total} cells differ (${changed} changed, ${added} filled, ${removed} emptied)`];
  if (sheets.added.length > 0) parts.push(`sheets added: ${sheets.added.join(", ")}`);
  if (sheets.removed.length > 0) parts.push(`sheets removed: ${sheets.removed.join(", ")}`);
  const identical = total === 0 && sheets.added.length === 0 && sheets.removed.length === 0;
  return {
    kind: "sheet",
    identical,
    summary: identical ? "No cell changed (the change is in formatting or other parts)." : `${parts.join("; ")}.`,
    counts: { added, removed, changed },
    cells,
    sheets,
    truncated: total > cells.length,
  };
}

// ---------------------------------------------------------------------------------------------- blocks

/**
 * Pairs the blocks of two lists (paragraphs, pages): equal ones are skipped, a replaced run pairs its
 * blocks one by one as changed, and the rest are added or removed.
 */
function diffBlocks(
  oldKeys: string[],
  newKeys: string[],
  show: (side: "old" | "new", index: number) => string,
  pairScore: (oldIndex: number, newIndex: number) => number = (i, j) => similarity(oldKeys[i] ?? "", newKeys[j] ?? ""),
) {
  const blocks: HxBlockChange[] = [];
  const counts = { added: 0, removed: 0, changed: 0 };
  const edits = hxDiffSequences(oldKeys, newKeys);
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index];
    if (!edit || edit.kind === "equal") continue;
    const next = edits[index + 1];
    if (edit.kind === "delete" && next?.kind === "insert") {
      // A replaced run: pair each old block with the new one it most resembles, in order; the rest were
      // added or removed. (Pairing by position would call an inserted paragraph a rewrite of the next one.)
      const oldRun = Array.from({ length: edit.aEnd - edit.aStart }, (_, k) => edit.aStart + k);
      const newRun = Array.from({ length: next.bEnd - next.bStart }, (_, k) => next.bStart + k);
      for (const step of alignRuns(oldRun, newRun, pairScore)) {
        if (step.old !== null && step.new !== null) {
          counts.changed += 1;
          blocks.push({
            kind: "changed",
            oldNumber: step.old + 1,
            newNumber: step.new + 1,
            old: clip(show("old", step.old)),
            new: clip(show("new", step.new)),
            details: [],
          });
        } else if (step.old !== null) {
          counts.removed += 1;
          blocks.push({
            kind: "removed",
            oldNumber: step.old + 1,
            newNumber: null,
            old: clip(show("old", step.old)),
            new: "",
            details: [],
          });
        } else if (step.new !== null) {
          counts.added += 1;
          blocks.push({
            kind: "added",
            oldNumber: null,
            newNumber: step.new + 1,
            old: "",
            new: clip(show("new", step.new)),
            details: [],
          });
        }
      }
      index += 1;
      continue;
    }
    if (edit.kind === "delete") {
      for (let k = edit.aStart; k < edit.aEnd; k += 1) {
        counts.removed += 1;
        blocks.push({
          kind: "removed",
          oldNumber: k + 1,
          newNumber: null,
          old: clip(show("old", k)),
          new: "",
          details: [],
        });
      }
    } else {
      for (let k = edit.bStart; k < edit.bEnd; k += 1) {
        counts.added += 1;
        blocks.push({
          kind: "added",
          oldNumber: null,
          newNumber: k + 1,
          old: "",
          new: clip(show("new", k)),
          details: [],
        });
      }
    }
  }
  return { blocks, counts };
}

/** Above this, two blocks of a replaced run count as one block changed rather than one removed and one added. */
const PAIR_THRESHOLD = 0.4;
/** Runs larger than this (old × new) are paired by position, so a huge rewrite cannot stall the diff. */
const MAX_ALIGN_CELLS = 250_000;

/** Dice similarity of the character pairs of two texts: 1 for equal texts, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i + 1 < a.length; i += 1) {
    const pair = a.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i + 1 < b.length; i += 1) {
    const pair = b.slice(i, i + 2);
    const left = counts.get(pair) ?? 0;
    if (left > 0) {
      shared += 1;
      counts.set(pair, left - 1);
    }
  }
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

/**
 * Aligns two runs in order so that the paired blocks are as alike as possible in total (a weighted longest
 * common subsequence). Pairs below PAIR_THRESHOLD are not made. Returns the steps in reading order.
 */
export function alignRuns(
  oldRun: readonly number[],
  newRun: readonly number[],
  score: (oldIndex: number, newIndex: number) => number,
): { old: number | null; new: number | null }[] {
  const n = oldRun.length;
  const m = newRun.length;
  const steps: { old: number | null; new: number | null }[] = [];
  if (n * m > MAX_ALIGN_CELLS) {
    for (let k = 0; k < Math.max(n, m); k += 1) steps.push({ old: oldRun[k] ?? null, new: newRun[k] ?? null });
    return steps;
  }
  const width = m + 1;
  const best = new Float64Array((n + 1) * width);
  const sims = new Float64Array(n * m);
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const sim = score(oldRun[i - 1] ?? 0, newRun[j - 1] ?? 0);
      sims[(i - 1) * m + (j - 1)] = sim;
      const pair = sim >= PAIR_THRESHOLD ? (best[(i - 1) * width + (j - 1)] ?? 0) + sim : -1;
      best[i * width + j] = Math.max(best[(i - 1) * width + j] ?? 0, best[i * width + (j - 1)] ?? 0, pair);
    }
  }
  const reversed: { old: number | null; new: number | null }[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = best[i * width + j] ?? 0;
    if (i > 0 && j > 0) {
      const sim = sims[(i - 1) * m + (j - 1)] ?? 0;
      if (sim >= PAIR_THRESHOLD && Math.abs(here - ((best[(i - 1) * width + (j - 1)] ?? 0) + sim)) < 1e-9) {
        reversed.push({ old: oldRun[i - 1] ?? null, new: newRun[j - 1] ?? null });
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (j > 0 && (i === 0 || Math.abs(here - (best[i * width + (j - 1)] ?? 0)) < 1e-9)) {
      reversed.push({ old: null, new: newRun[j - 1] ?? null });
      j -= 1;
    } else {
      reversed.push({ old: oldRun[i - 1] ?? null, new: null });
      i -= 1;
    }
  }
  // Reading order. Between two pairs, as many old blocks as new ones were each rewritten in place (nothing
  // alike enough to pair by text): pair them by position. Otherwise the removed come before the added.
  let gapOld: number[] = [];
  let gapNew: number[] = [];
  const flush = () => {
    if (gapOld.length === gapNew.length)
      for (let k = 0; k < gapOld.length; k += 1) steps.push({ old: gapOld[k] ?? null, new: gapNew[k] ?? null });
    else {
      for (const old of gapOld) steps.push({ old, new: null });
      for (const added of gapNew) steps.push({ old: null, new: added });
    }
    gapOld = [];
    gapNew = [];
  };
  for (let k = reversed.length - 1; k >= 0; k -= 1) {
    const step = reversed[k];
    if (!step) continue;
    if (step.old !== null && step.new !== null) {
      flush();
      steps.push(step);
    } else if (step.old !== null) gapOld.push(step.old);
    else if (step.new !== null) gapNew.push(step.new);
  }
  flush();
  return steps;
}

function cut(blocks: HxBlockChange[]): { blocks: HxBlockChange[]; truncated: boolean } {
  return { blocks: blocks.slice(0, HX_DIFF_LIMITS.maxBlocks), truncated: blocks.length > HX_DIFF_LIMITS.maxBlocks };
}

function diffDocuments(before: Uint8Array | null, after: Uint8Array | null): Omit<HxFileDiff, "before" | "after"> {
  const oldParagraphs = before ? HxDocument.read(before).paragraphs() : [];
  const newParagraphs = after ? HxDocument.read(after).paragraphs() : [];
  // The style is part of a paragraph: a heading turned into body text is a change.
  const key = (p: { text: string; style: string | null }) => `${p.style ?? ""}\u0000${p.text}`;
  const show = (side: "old" | "new", index: number) => {
    const p = (side === "old" ? oldParagraphs : newParagraphs)[index];
    return p ? (p.style ? `[${p.style}] ${p.text}` : p.text) : "";
  };
  // A paragraph in the same table cell on both sides is the same paragraph, however much its text changed.
  const pairScore = (i: number, j: number) => {
    const a = oldParagraphs[i];
    const b = newParagraphs[j];
    if (!a || !b) return 0;
    if (a.cell && b.cell && a.cell.table === b.cell.table && a.cell.row === b.cell.row && a.cell.col === b.cell.col)
      return 1;
    return similarity(key(a), key(b));
  };
  const { blocks, counts } = diffBlocks(oldParagraphs.map(key), newParagraphs.map(key), show, pairScore);
  const total = counts.added + counts.removed + counts.changed;
  const kept = cut(blocks);
  return {
    kind: "document",
    identical: total === 0,
    summary:
      total === 0
        ? "No paragraph changed (the change is in formatting, tracked changes or other parts)."
        : `${total} paragraphs differ (${counts.changed} changed, ${counts.added} added, ${counts.removed} removed).`,
    counts,
    blocks: kept.blocks,
    truncated: kept.truncated,
  };
}

/** The ids of the slides that did not move: a longest common order, preferring slides that kept their index. */
function stayingInOrder(old: readonly HxSlide[], now: readonly HxSlide[], size: number): Set<string> {
  const n = old.length;
  const m = now.length;
  const staying = new Set<string>();
  if (n * m > MAX_ALIGN_CELLS) {
    const a = old.map((slide) => String(slide.id));
    const b = now.map((slide) => String(slide.id));
    for (const edit of hxDiffSequences(a, b)) {
      if (edit.kind !== "equal") continue;
      for (let k = edit.bStart; k < edit.bEnd; k += 1) staying.add(b[k] ?? "");
    }
    return staying;
  }
  const width = m + 1;
  const best = new Float64Array((n + 1) * width);
  const gain = (i: number, j: number) => {
    const a = old[i];
    const b = now[j];
    if (!a || !b || a.id !== b.id) return -1;
    return 1 + 0.001 * (1 - Math.abs(a.index - b.index) / size);
  };
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const g = gain(i - 1, j - 1);
      const pair = g > 0 ? (best[(i - 1) * width + (j - 1)] ?? 0) + g : -1;
      best[i * width + j] = Math.max(best[(i - 1) * width + j] ?? 0, best[i * width + (j - 1)] ?? 0, pair);
    }
  }
  for (let i = n, j = m; i > 0 && j > 0; ) {
    const here = best[i * width + j] ?? 0;
    const g = gain(i - 1, j - 1);
    if (g > 0 && Math.abs(here - ((best[(i - 1) * width + (j - 1)] ?? 0) + g)) < 1e-12) {
      staying.add(String(now[j - 1]?.id ?? ""));
      i -= 1;
      j -= 1;
    } else if (Math.abs(here - (best[(i - 1) * width + j] ?? 0)) < 1e-12) i -= 1;
    else j -= 1;
  }
  return staying;
}

function slideSignature(slide: HxSlide): string {
  return JSON.stringify([
    slide.layout,
    slide.shapes.map((shape) => [shape.name, shape.text]),
    slide.pictures,
    slide.notes,
  ]);
}

function slideDetails(old: HxSlide, now: HxSlide): string[] {
  const details: string[] = [];
  if (old.layout !== now.layout) details.push(`layout: ${old.layout} → ${now.layout}`);
  if (old.title !== now.title) details.push(`title: ${clip(old.title)} → ${clip(now.title)}`);
  const oldShapes = new Map(old.shapes.map((shape) => [shape.name, shape.text]));
  const newShapes = new Map(now.shapes.map((shape) => [shape.name, shape.text]));
  for (const [name, text] of newShapes) {
    const before = oldShapes.get(name);
    if (before === undefined) details.push(`added ${name}: ${clip(text)}`);
    else if (before !== text && !(text === now.title && before === old.title))
      details.push(`${name}: ${clip(before)} → ${clip(text)}`);
  }
  for (const [name, text] of oldShapes) if (!newShapes.has(name)) details.push(`removed ${name}: ${clip(text)}`);
  if (old.pictures !== now.pictures) details.push(`pictures: ${old.pictures} → ${now.pictures}`);
  if (old.notes !== now.notes) details.push(`notes: ${clip(old.notes)} → ${clip(now.notes)}`);
  if (details.length === 0) details.push("pictures or formatting changed");
  return details;
}

function diffSlides(before: Uint8Array | null, after: Uint8Array | null): Omit<HxFileDiff, "before" | "after"> {
  const oldSlides = before ? HxPresentation.read(before).slides() : [];
  const newSlides = after ? HxPresentation.read(after).slides() : [];
  const oldById = new Map(oldSlides.map((slide) => [slide.id, slide]));
  const newIds = new Set(newSlides.map((slide) => slide.id));
  // Slides that kept their id: the most of them that are still in the same order stay; the others moved.
  // Among equally long orders, the one that keeps slides nearest their old place wins, so that moving one
  // slide to the front shows that slide as moved, not every other one.
  const kept = newSlides.filter((slide) => oldById.has(slide.id));
  const oldKept = oldSlides.filter((slide) => newIds.has(slide.id));
  const inOrder = stayingInOrder(oldKept, kept, Math.max(oldSlides.length, newSlides.length, 1));
  const blocks: HxBlockChange[] = [];
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const slide of newSlides) {
    const old = oldById.get(slide.id);
    const title = slide.title || `(${slide.layout || "slide"})`;
    if (!old) {
      counts.added += 1;
      blocks.push({
        kind: "added",
        oldNumber: null,
        newNumber: slide.index + 1,
        old: "",
        new: clip(title),
        details: [],
      });
      continue;
    }
    const moved = !inOrder.has(String(slide.id));
    const changed = slideSignature(old) !== slideSignature(slide);
    if (!moved && !changed) continue;
    counts.changed += 1;
    blocks.push({
      kind: changed ? "changed" : "moved",
      oldNumber: old.index + 1,
      newNumber: slide.index + 1,
      old: clip(old.title || `(${old.layout || "slide"})`),
      new: clip(title),
      details: [
        ...(moved ? [`moved from slide ${old.index + 1} to ${slide.index + 1}`] : []),
        ...(changed ? slideDetails(old, slide) : []),
      ],
    });
  }
  for (const slide of oldSlides) {
    if (newIds.has(slide.id)) continue;
    counts.removed += 1;
    blocks.push({
      kind: "removed",
      oldNumber: slide.index + 1,
      newNumber: null,
      old: clip(slide.title || `(${slide.layout || "slide"})`),
      new: "",
      details: [],
    });
  }
  blocks.sort((x, y) => (x.newNumber ?? x.oldNumber ?? 0) - (y.newNumber ?? y.oldNumber ?? 0));
  const total = counts.added + counts.removed + counts.changed;
  const result = cut(blocks);
  return {
    kind: "slides",
    identical: total === 0,
    summary:
      total === 0
        ? "No slide changed (the change is in formatting, the masters or other parts)."
        : `${oldSlides.length} → ${newSlides.length} slides: ${counts.changed} changed or moved, ${counts.added} added, ${counts.removed} removed.`,
    counts,
    blocks: result.blocks,
    truncated: result.truncated,
  };
}

async function diffPdf(
  before: Uint8Array | null,
  after: Uint8Array | null,
  signal: AbortSignal | undefined,
): Promise<Omit<HxFileDiff, "before" | "after">> {
  const read = async (bytes: Uint8Array | null) =>
    bytes
      ? await hxPdfText(bytes, { maxChars: HX_DIFF_LIMITS.pdfChars, signal })
      : { pages: [], pageCount: 0, truncated: false, repaired: false };
  const oldText = await read(before);
  const newText = await read(after);
  const oldPages = oldText.pages.map((page) => page.text);
  const newPages = newText.pages.map((page) => page.text);
  const show = (side: "old" | "new", index: number) => {
    const text = (side === "old" ? oldPages : newPages)[index] ?? "";
    return text.split("\n").find((line) => line.trim() !== "") ?? "(no text)";
  };
  const { blocks, counts } = diffBlocks(oldPages, newPages, show);
  for (const block of blocks) {
    if (block.kind !== "changed" || block.oldNumber === null || block.newNumber === null) continue;
    const hunks = hxLineHunks(
      lines(oldPages[block.oldNumber - 1] ?? ""),
      lines(newPages[block.newNumber - 1] ?? ""),
      1,
    );
    for (const hunk of hunks.slice(0, 5))
      for (const line of hunk.lines)
        if (line.kind !== " " && block.details.length < 20) block.details.push(`${line.kind} ${clip(line.text)}`);
  }
  const fields = pdfFieldChanges(before, after);
  counts.changed += fields.length;
  const total = counts.added + counts.removed + counts.changed;
  const result = cut(blocks);
  const textTruncated = oldText.truncated || newText.truncated;
  return {
    kind: "pdf",
    identical: total === 0 && !textTruncated,
    summary:
      total === 0
        ? `The text of the ${newText.pageCount} pages is the same (the change is in pictures, form fields or other parts).`
        : `${oldText.pageCount} → ${newText.pageCount} pages: ${counts.changed - fields.length} pages' text changed, ${counts.added} added, ${counts.removed} removed${fields.length > 0 ? `; ${fields.length} form fields filled or changed` : ""}.`,
    counts,
    blocks: result.blocks,
    ...(fields.length > 0 ? { fields: fields.slice(0, HX_DIFF_LIMITS.maxCells) } : {}),
    truncated: result.truncated || textTruncated,
  };
}

/** Form field values that differ; an unreadable form gives none (the page text still compares). */
function pdfFieldChanges(
  before: Uint8Array | null,
  after: Uint8Array | null,
): { name: string; old: string; new: string }[] {
  const values = (bytes: Uint8Array | null) => {
    if (!bytes) return new Map<string, string>();
    try {
      const pdf = HxPdf.read(bytes);
      return pdf.encrypted
        ? new Map<string, string>()
        : new Map(hxPdfFields(pdf).map((field) => [field.name, field.value]));
    } catch {
      return new Map<string, string>();
    }
  };
  const old = values(before);
  const now = values(after);
  const changes: { name: string; old: string; new: string }[] = [];
  for (const name of new Set([...old.keys(), ...now.keys()])) {
    const a = old.get(name) ?? "";
    const b = now.get(name) ?? "";
    if (a !== b) changes.push({ name, old: clip(a), new: clip(b) });
  }
  return changes;
}
