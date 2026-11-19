// HXBot v1.7.4（CU-07）：表格、文档、演示三个技能的原生处理。读和改都在内存里做，改完交给 run.ts 留版本、
// 写回、读回核对、出差异。每个改动都带一个核对函数：从保存后的文件重新读出来，逐项比对“要的”和“读到的”。
import type { z } from "zod";
import { HxDocument } from "../hx-files/docx";
import { cellName, MAX_ROW } from "../hx-files/formula";
import { HxPresentation, type HxSlide, readImage } from "../hx-files/pptx";
import type { HxCellInput, HxCellRead } from "../hx-files/xlsx";
import { HxWorkbook, normalizeFormula, parseDate } from "../hx-files/xlsx";
import { DOCUMENT_PARAMS, SHEET_PARAMS, SLIDES_PARAMS } from "./declarations";

export interface HxReadbackCheck {
  what: string;
  ok: boolean;
  expected?: string;
  actual?: string;
}

/** A change made in memory: the new bytes, what was done, and how to check the saved file. */
export interface HxNativeChange {
  bytes: Uint8Array;
  done: string;
  /** Details for the model beyond the diff (cells computed again, the new sheet's name...). */
  details?: Readonly<Record<string, string | number | boolean | readonly string[]>>;
  check: (saved: Uint8Array) => Promise<HxReadbackCheck[]> | HxReadbackCheck[];
}

/** Files that the action reads besides its input (a picture), already read by the caller. */
export type HxSideFiles = ReadonlyMap<string, Uint8Array>;

function check(
  what: string,
  expected: string | number | boolean,
  actual: string | number | boolean | undefined,
): HxReadbackCheck {
  return {
    what,
    ok: actual === expected,
    expected: String(expected),
    actual: actual === undefined ? "(missing)" : String(actual),
  };
}

// ---------------------------------------------------------------------------------------------- sheet

/** A text starting with = is a formula, as when it is typed into Excel. */
function toInput(value: z.infer<typeof SHEET_PARAMS.write>["cells"][string] | undefined): HxCellInput {
  if (value === undefined) return null;
  if (typeof value === "string" && value.startsWith("=") && value.length > 1) return { formula: value };
  return value;
}

export function hxSheetRead(bytes: Uint8Array, action: string, params: unknown) {
  const book = HxWorkbook.read(bytes);
  if (action === "sheets") return { sheets: book.sheets().map((sheet) => ({ name: sheet.name, state: sheet.state })) };
  const input = SHEET_PARAMS.read.parse(params ?? {});
  const result = book.read(input.sheet ?? null, input.range, input.limit ?? 2000);
  return {
    sheet: result.sheet,
    range: result.range,
    truncated: result.truncated,
    // Rows of [cell, text, formula?]: short for the model, and blank cells left out.
    rows: result.rows
      .map((row) =>
        row
          .filter((cell) => cell.type !== "blank" || cell.formula)
          .map((cell) => (cell.formula ? [cell.ref, cell.text, `=${cell.formula}`] : [cell.ref, cell.text])),
      )
      .filter((row) => row.length > 0),
  };
}

/** The most cells that one combine writes. */
const COMBINE_MAX_CELLS = 500_000;

/** A cell of a source sheet as an input for the combined sheet: its value, never its formula. */
function combinedInput(cell: HxCellRead): HxCellInput | undefined {
  if (cell.type === "blank") return undefined;
  if (cell.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(cell.text)) return { date: cell.text };
  if (cell.type === "error") return cell.text;
  const value = cell.value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  return cell.text === "" ? undefined : cell.text;
}

/**
 * “合并成一张表”: the rows of several sheets (of this workbook and of others) on one new sheet. Columns
 * line up by header; a first column names the file and the sheet. Formulas go in as their values,
 * because their references would point elsewhere on the new sheet.
 */
function combine(book: HxWorkbook, own: string, params: unknown, side: HxSideFiles): HxNativeChange {
  const input = SHEET_PARAMS.combine.parse(params ?? {});
  const header = input.header ?? true;
  const withSource = input.source ?? true;
  const wanted = input.name ?? "合并";
  const books: { label: string; book: HxWorkbook }[] = [{ label: own, book }];
  for (const [path, bytes] of side)
    books.push({ label: path.split(/[\\/]/).pop() ?? path, book: HxWorkbook.read(bytes) });
  const columns: string[] = [];
  const rows: { source: string; cells: Map<string, HxCellInput> }[] = [];
  let formulas = 0;
  let cells = 0;
  let used = 0;
  const isOutput = (name: string) => name === wanted || name.startsWith(`${wanted} (`);
  for (const { label, book: source } of books) {
    const names = source
      .sheets()
      .filter((info) => info.state === "visible" && !(source === book && isOutput(info.name)))
      .map((info) => info.name)
      .filter((name) => !input.sheets || input.sheets.includes(name));
    for (const name of names) {
      const read = source.read(name, undefined, COMBINE_MAX_CELLS + 1);
      if (read.truncated)
        throw new SkillInputError(`${label} / ${name} is too large to combine (more than ${COMBINE_MAX_CELLS} cells).`);
      if (read.rows.length === 0) continue;
      used += 1;
      // Two columns with the same header stay two columns: the second is "金额 (2)".
      const seen = new Map<string, number>();
      const keys = (read.rows[0] ?? []).map((cell) => {
        const title = cell.text.normalize("NFC").trim();
        const base = header && title !== "" ? title : `(${cell.ref.replace(/[0-9]+$/, "")})`;
        const count = (seen.get(base) ?? 0) + 1;
        seen.set(base, count);
        return count === 1 ? base : `${base} (${count})`;
      });
      for (const key of keys) if (!columns.includes(key)) columns.push(key);
      for (const line of read.rows.slice(header ? 1 : 0)) {
        const values = new Map<string, HxCellInput>();
        line.forEach((cell, index) => {
          const value = combinedInput(cell);
          const key = keys[index];
          if (value === undefined || key === undefined) return;
          if (cell.formula) formulas += 1;
          values.set(key, value);
        });
        if (values.size === 0) continue;
        cells += values.size + (withSource ? 1 : 0);
        if (cells > COMBINE_MAX_CELLS)
          throw new SkillInputError(`The combined sheet would have more than ${COMBINE_MAX_CELLS} cells.`);
        rows.push({ source: `${label} / ${name}`, cells: values });
      }
    }
  }
  if (used === 0) throw new SkillInputError("No sheet to combine: check the names in sheets.");
  if (rows.length + 1 > MAX_ROW) throw new SkillInputError("The combined rows do not fit on one sheet.");
  const name = book.addSheet(wanted);
  const titles = [...(withSource ? ["来源"] : []), ...columns];
  const updates: { ref: string; input: HxCellInput }[] = titles.map((title, index) => ({
    ref: cellName({ row: 1, col: index + 1 }),
    input: title,
  }));
  rows.forEach((row, index) => {
    const r = index + 2;
    if (withSource) updates.push({ ref: cellName({ row: r, col: 1 }), input: row.source });
    columns.forEach((column, c) => {
      const value = row.cells.get(column);
      if (value !== undefined)
        updates.push({ ref: cellName({ row: r, col: c + 1 + (withSource ? 1 : 0) }), input: value });
    });
  });
  book.set(name, updates);
  const bytes = book.toBytes();
  // What the new sheet holds in memory; the saved file must read back the same.
  const expected = HxWorkbook.read(bytes)
    .read(name, undefined, COMBINE_MAX_CELLS + titles.length)
    .rows.map((line) => line.map((cell) => cell.text));
  return {
    bytes,
    done: `${rows.length} rows from ${used} sheets combined on the new sheet ${name}`,
    details: {
      sheet: name,
      rows: rows.length,
      sheets: used,
      columns: titles.length,
      ...(formulas ? { formulasAsValues: formulas } : {}),
    },
    check: (saved) => {
      const got = HxWorkbook.read(saved)
        .read(name, undefined, COMBINE_MAX_CELLS + titles.length)
        .rows.map((line) => line.map((cell) => cell.text));
      const at = (lines: string[][], index: number) => (lines[index] ?? []).join("\t");
      const last = expected.length - 1;
      return [
        check("rows (header included)", rows.length + 1, got.length),
        check("header", titles.join("\t"), at(got, 0)),
        check("first row", at(expected, Math.min(1, last)), at(got, Math.min(1, last))),
        check("last row", at(expected, last), at(got, last)),
        check("every cell", true, JSON.stringify(expected) === JSON.stringify(got)),
      ];
    },
  };
}

export function hxSheetChange(
  bytes: Uint8Array,
  action: string,
  params: unknown,
  side: HxSideFiles = new Map(),
  label = "this workbook",
): HxNativeChange {
  const book = HxWorkbook.read(bytes);
  if (action === "combine") return combine(book, label, params, side);
  switch (action) {
    case "write": {
      const input = SHEET_PARAMS.write.parse(params ?? {});
      const entries = Object.entries(input.cells);
      if (entries.length === 0) throw new SkillInputError("Give at least one cell.");
      if (entries.length > 50_000) throw new SkillInputError("Write at most 50,000 cells at once.");
      const updates = entries.map(([ref, value]) => ({
        ref: ref.replaceAll("$", "").toUpperCase(),
        input: toInput(value),
      }));
      const result = book.set(input.sheet ?? null, updates);
      const sheet = book.sheetName(input.sheet ?? null);
      return {
        bytes: book.toBytes(),
        done: `${updates.length} cells written on ${sheet}${result.recalculated.length ? `; ${result.recalculated.length} formulas computed again` : ""}${result.uncached.length ? `; ${result.uncached.length} formulas left for Excel to compute on opening` : ""}`,
        details: {
          recalculated: result.recalculated.slice(0, 50).map((cell) => `${cell.ref}=${cell.text}`),
          uncached: result.uncached.slice(0, 50),
        },
        check: (saved) => {
          const again = HxWorkbook.read(saved);
          return updates.map(({ ref, input: wanted }) => {
            const got = again.cell(sheet, ref);
            if (wanted === null || wanted === "") return check(`${sheet}!${ref} is empty`, "blank", got.type);
            if (typeof wanted === "object" && "formula" in wanted)
              return check(`${sheet}!${ref} formula`, normalizeFormula(wanted.formula), got.formula ?? "");
            if (typeof wanted === "object" && "date" in wanted)
              return check(`${sheet}!${ref} date`, String(parseDate(wanted.date, again.date1904)), String(got.value));
            return check(
              `${sheet}!${ref}`,
              String(wanted),
              typeof wanted === "boolean"
                ? got.value === true
                  ? "true"
                  : got.value === false
                    ? "false"
                    : got.text
                : got.type === "number"
                  ? String(got.value)
                  : got.text,
            );
          });
        },
      };
    }
    case "filter": {
      const input = SHEET_PARAMS.filter.parse(params ?? {});
      const shown = book.filter(input.sheet ?? null, input.range, input.columns);
      const sheet = book.sheetName(input.sheet ?? null);
      return {
        bytes: book.toBytes(),
        done: `filter on ${sheet}!${input.range}: ${shown.visible} rows shown, ${shown.hidden} hidden`,
        details: shown,
        check: (saved) => {
          const again = HxWorkbook.read(saved);
          const xml = again.pkg.xml(again.sheets().find((item) => item.name === sheet)?.part ?? "").root.toString();
          const hidden = (xml.match(/<(?:\w+:)?row [^>]*hidden="(?:1|true)"/g) ?? []).length;
          return [
            check(
              "autoFilter range",
              input.range.replaceAll("$", "").toUpperCase(),
              /<(?:\w+:)?autoFilter ref="([^"]+)"/.exec(xml)?.[1],
            ),
            check("hidden rows", shown.hidden, hidden),
          ];
        },
      };
    }
    case "clear-filter": {
      const input = SHEET_PARAMS["clear-filter"].parse(params ?? {});
      const shown = book.clearFilter(input.sheet ?? null);
      const sheet = book.sheetName(input.sheet ?? null);
      return {
        bytes: book.toBytes(),
        done: `filter on ${sheet} removed; ${shown} rows shown again`,
        check: (saved) => {
          const again = HxWorkbook.read(saved);
          const xml = again.pkg.xml(again.sheets().find((item) => item.name === sheet)?.part ?? "").root.toString();
          return [check("no autoFilter", false, /<(?:\w+:)?autoFilter/.test(xml))];
        },
      };
    }
    case "summary": {
      const input = SHEET_PARAMS.summary.parse(params ?? {});
      const made = book.summarize(
        input.sheet ?? null,
        input.range,
        input.rows,
        input.values,
        input.totalLabel ? { totalLabel: input.totalLabel } : {},
      );
      return {
        bytes: book.toBytes(),
        done: `summary of ${input.range} by ${input.rows.join(", ")} on the new sheet ${made.sheet} (${made.groups} groups)`,
        details: made,
        check: (saved) => {
          const again = HxWorkbook.read(saved);
          const rows = again.read(made.sheet).rows;
          return [
            check("summary rows (groups + header + total)", made.groups + 2, rows.length),
            check("summary sheet", made.sheet, again.sheets().find((item) => item.name === made.sheet)?.name),
          ];
        },
      };
    }
    case "chart": {
      const input = SHEET_PARAMS.chart.parse(params ?? {});
      const made = book.addChart(input.sheet ?? null, input);
      return {
        bytes: book.toBytes(),
        done: `${input.type} chart added at ${made.anchor}`,
        details: made,
        check: (saved) => {
          const again = HxWorkbook.read(saved);
          const chart = again.pkg.has(made.chart) ? again.pkg.xml(made.chart).root.toString() : "";
          return [
            check("chart part", true, chart.length > 0),
            check("series", input.series.length, (chart.match(/<(?:\w+:)?ser>/g) ?? []).length),
          ];
        },
      };
    }
    case "add-sheet": {
      const input = SHEET_PARAMS["add-sheet"].parse(params ?? {});
      const name = book.addSheet(input.name);
      return {
        bytes: book.toBytes(),
        done: `sheet ${name} added`,
        details: { sheet: name },
        check: (saved) => [
          check(
            "sheet exists",
            name,
            HxWorkbook.read(saved)
              .sheets()
              .find((item) => item.name === name)?.name,
          ),
        ],
      };
    }
    default:
      throw new SkillInputError(`The sheet skill has no action ${action}.`);
  }
}

// ---------------------------------------------------------------------------------------------- document

export function hxDocumentRead(bytes: Uint8Array, params: unknown) {
  const input = DOCUMENT_PARAMS.read.parse(params ?? {});
  const doc = HxDocument.read(bytes);
  const all = doc.paragraphs();
  const from = input.from ?? 0;
  const limit = input.limit ?? 400;
  return {
    paragraphs: all.slice(from, from + limit).map((p) => ({
      index: p.index,
      text: p.text,
      ...(p.style ? { style: p.style } : {}),
      ...(p.cell ? { cell: `table ${p.cell.table} row ${p.cell.row} col ${p.cell.col}` } : {}),
      ...(p.revisions ? { tracked: true } : {}),
    })),
    total: all.length,
    truncated: from + limit < all.length,
    tables: doc
      .tables()
      .map((table) => ({ index: table.index, rows: table.rows.length, cols: table.rows[0]?.length ?? 0 })),
    trackedChanges: doc.revisionCount(),
  };
}

export function hxDocumentChange(bytes: Uint8Array, action: string, params: unknown): HxNativeChange {
  const doc = HxDocument.read(bytes);
  const opts = (track: boolean | undefined) => (track ? { track: true } : {});
  switch (action) {
    case "replace": {
      const input = DOCUMENT_PARAMS.replace.parse(params ?? {});
      const result = doc.replace(input.find, input.replace, {
        all: input.all ?? true,
        ...(input.matchCase ? { matchCase: true } : {}),
        ...opts(input.track),
      });
      if (result.count === 0) throw new SkillInputError(`The document does not contain "${input.find.slice(0, 100)}".`);
      return {
        bytes: doc.toBytes(),
        done: `${result.count} replaced in ${result.paragraphs.length} paragraphs${input.track ? " as tracked changes" : ""}`,
        details: { count: result.count, paragraphs: result.paragraphs.slice(0, 100).map(String) },
        check: (saved) => {
          const again = HxDocument.read(saved).paragraphs();
          return result.paragraphs.slice(0, 50).map((index) => {
            const text = again[index]?.text ?? "";
            const has = input.matchCase
              ? text.includes(input.replace)
              : text.toLowerCase().includes(input.replace.toLowerCase());
            return {
              what: `paragraph ${index} holds the new text`,
              ok: input.replace === "" ? true : has,
              expected: input.replace.slice(0, 200),
              actual: text.slice(0, 200),
            };
          });
        },
      };
    }
    case "set-paragraph": {
      const input = DOCUMENT_PARAMS["set-paragraph"].parse(params ?? {});
      doc.setParagraph(input.index, input.text, opts(input.track));
      return {
        bytes: doc.toBytes(),
        done: `paragraph ${input.index} set`,
        check: (saved) => [
          check(`paragraph ${input.index}`, input.text, HxDocument.read(saved).paragraphs()[input.index]?.text),
        ],
      };
    }
    case "insert": {
      const input = DOCUMENT_PARAMS.insert.parse(params ?? {});
      const style = input.style ? doc.resolveStyle(input.style) : undefined;
      const at = doc.insertParagraph(input.after, input.text, style, opts(input.track));
      return {
        bytes: doc.toBytes(),
        done: `paragraph inserted as ${at}${style ? ` (${style})` : ""}`,
        details: { index: at },
        check: (saved) => {
          const p = HxDocument.read(saved).paragraphs()[at];
          return [
            check(`paragraph ${at}`, input.text, p?.text),
            ...(style ? [check(`paragraph ${at} style`, style, p?.style ?? "")] : []),
          ];
        },
      };
    }
    case "delete": {
      const input = DOCUMENT_PARAMS.delete.parse(params ?? {});
      const before = doc.paragraphs();
      const removed = before[input.index]?.text ?? "";
      doc.deleteParagraph(input.index, opts(input.track));
      return {
        bytes: doc.toBytes(),
        done: `paragraph ${input.index} deleted${input.track ? " as a tracked change" : ""}`,
        check: (saved) => {
          const after = HxDocument.read(saved).paragraphs();
          if (input.track) return [check(`paragraph ${input.index} shows no text`, "", after[input.index]?.text)];
          const inCell = before[input.index]?.cell !== null;
          return inCell
            ? [check(`paragraph ${input.index} is empty`, "", after[input.index]?.text)]
            : [
                check("paragraph count", before.length - 1, after.length),
                {
                  what: "the deleted text is gone from that place",
                  ok: after[input.index]?.text !== removed || removed === "",
                },
              ];
        },
      };
    }
    case "style": {
      const input = DOCUMENT_PARAMS.style.parse(params ?? {});
      const id = doc.setStyle(input.index, input.style);
      return {
        bytes: doc.toBytes(),
        done: `paragraph ${input.index} now has the style ${id}`,
        check: (saved) => [
          check(`paragraph ${input.index} style`, id, HxDocument.read(saved).paragraphs()[input.index]?.style ?? ""),
        ],
      };
    }
    case "format": {
      const input = DOCUMENT_PARAMS.format.parse(params ?? {});
      const { index, ...lookInput } = input;
      if (Object.keys(lookInput).length === 0)
        throw new SkillInputError("Give at least one of bold, italic, underline, size, color and font.");
      doc.format(index, lookInput);
      return {
        bytes: doc.toBytes(),
        done: `paragraph ${index} formatted`,
        check: (saved) => {
          const again = HxDocument.read(saved);
          const text = again.paragraphs()[index]?.text;
          return [check(`paragraph ${index} text unchanged`, doc.paragraphs()[index]?.text ?? "", text)];
        },
      };
    }
    case "cell": {
      const input = DOCUMENT_PARAMS.cell.parse(params ?? {});
      doc.setCell(input.table, input.row, input.col, input.text, opts(input.track));
      return {
        bytes: doc.toBytes(),
        done: `table ${input.table} row ${input.row} col ${input.col} set`,
        check: (saved) => [
          check("cell text", input.text, HxDocument.read(saved).tables()[input.table]?.rows[input.row]?.[input.col]),
        ],
      };
    }
    case "add-row": {
      const input = DOCUMENT_PARAMS["add-row"].parse(params ?? {});
      const row = doc.addRow(input.table, input.values, opts(input.track));
      return {
        bytes: doc.toBytes(),
        done: `row ${row} added to table ${input.table}`,
        check: (saved) => {
          const got = HxDocument.read(saved).tables()[input.table]?.rows[row] ?? [];
          return input.values.map((value, col) => check(`row ${row} col ${col}`, value, got[col]));
        },
      };
    }
    case "insert-table": {
      const input = DOCUMENT_PARAMS["insert-table"].parse(params ?? {});
      const index = doc.insertTable(input.after, input.rows);
      return {
        bytes: doc.toBytes(),
        done: `table ${index} inserted (${input.rows.length} rows)`,
        details: { table: index },
        check: (saved) => {
          const got = HxDocument.read(saved).tables()[index]?.rows ?? [];
          return [
            check("rows", input.rows.length, got.length),
            check("first cell", input.rows[0]?.[0] ?? "", got[0]?.[0]),
          ];
        },
      };
    }
    case "accept-changes":
    case "reject-changes": {
      DOCUMENT_PARAMS["accept-changes"].parse(params ?? {});
      const count = doc.resolveRevisions(action === "accept-changes");
      if (count === 0) throw new SkillInputError("The document has no tracked changes.");
      return {
        bytes: doc.toBytes(),
        done: `${count} tracked changes ${action === "accept-changes" ? "accepted" : "rejected"}`,
        check: (saved) => [check("tracked changes left", 0, HxDocument.read(saved).revisionCount())],
      };
    }
    default:
      throw new SkillInputError(`The document skill has no action ${action}.`);
  }
}

// ---------------------------------------------------------------------------------------------- slides

function slideIndex(deck: HxPresentation, number: number): number {
  const count = deck.slides().length;
  if (number < 1 || number > count)
    throw new SkillInputError(`The presentation has ${count} slides; there is no slide ${number}.`);
  return number - 1;
}

export function hxSlidesRead(bytes: Uint8Array) {
  const deck = HxPresentation.read(bytes);
  return {
    slides: deck.slides().map((item) => ({
      slide: item.index + 1,
      layout: item.layout,
      title: item.title,
      texts: item.shapes
        .filter((shape) => shape.text !== "" && shape.text !== item.title)
        .map((shape) => `${shape.name}: ${shape.text}`.slice(0, 2000)),
      ...(item.pictures ? { pictures: item.pictures } : {}),
      ...(item.notes ? { notes: item.notes.slice(0, 2000) } : {}),
    })),
    layouts: deck.layouts().map((layout) => layout.name),
  };
}

function texts(slide: HxSlide | undefined): string {
  return JSON.stringify(slide?.shapes.map((shape) => shape.text) ?? []);
}

export function hxSlidesChange(bytes: Uint8Array, action: string, params: unknown, files: HxSideFiles): HxNativeChange {
  const deck = HxPresentation.read(bytes);
  const before = deck.slides();
  switch (action) {
    case "add": {
      const input = SLIDES_PARAMS.add.parse(params ?? {});
      if (input.at !== undefined && input.at > before.length + 1)
        throw new SkillInputError(`The presentation has ${before.length} slides; add at 1 to ${before.length + 1}.`);
      const at = deck.addSlide({
        ...(input.layout ? { layout: input.layout } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.at !== undefined ? { at: input.at - 1 } : {}),
      });
      const made = deck.slides()[at];
      return {
        bytes: deck.toBytes(),
        done: `slide ${at + 1} added (${made?.layout ?? ""})`,
        details: { slide: at + 1 },
        check: (saved) => {
          const after = HxPresentation.read(saved).slides();
          return [
            check("slide count", before.length + 1, after.length),
            ...(input.title !== undefined ? [check(`slide ${at + 1} title`, input.title, after[at]?.title)] : []),
          ];
        },
      };
    }
    case "delete": {
      const input = SLIDES_PARAMS.delete.parse(params ?? {});
      const index = slideIndex(deck, input.slide);
      const id = before[index]?.id;
      deck.deleteSlide(index);
      return {
        bytes: deck.toBytes(),
        done: `slide ${input.slide} deleted`,
        check: (saved) => {
          const after = HxPresentation.read(saved).slides();
          return [
            check("slide count", before.length - 1, after.length),
            check(
              "the slide is gone",
              false,
              after.some((item) => item.id === id),
            ),
          ];
        },
      };
    }
    case "move": {
      const input = SLIDES_PARAMS.move.parse(params ?? {});
      const index = slideIndex(deck, input.slide);
      const to = slideIndex(deck, input.to);
      const id = before[index]?.id;
      deck.moveSlide(index, to);
      return {
        bytes: deck.toBytes(),
        done: `slide ${input.slide} moved to ${input.to}`,
        check: (saved) => [
          check(
            `slide ${input.to} is the moved slide`,
            String(id),
            String(HxPresentation.read(saved).slides()[to]?.id),
          ),
        ],
      };
    }
    case "duplicate": {
      const input = SLIDES_PARAMS.duplicate.parse(params ?? {});
      const index = slideIndex(deck, input.slide);
      const at = deck.duplicateSlide(index);
      return {
        bytes: deck.toBytes(),
        done: `slide ${input.slide} copied to ${at + 1}`,
        details: { slide: at + 1 },
        check: (saved) => {
          const after = HxPresentation.read(saved).slides();
          return [
            check("slide count", before.length + 1, after.length),
            check("the copy's texts", texts(before[index]), texts(after[at])),
          ];
        },
      };
    }
    case "text": {
      const input = SLIDES_PARAMS.text.parse(params ?? {});
      const index = slideIndex(deck, input.slide);
      deck.setText(index, input.target, input.text);
      return {
        bytes: deck.toBytes(),
        done: `slide ${input.slide} ${input.target} set`,
        check: (saved) => {
          const after = HxPresentation.read(saved).slides()[index];
          const found = after?.shapes.some((shape) => shape.text === input.text) ?? false;
          return [{ what: `slide ${input.slide} shows the text`, ok: found, expected: input.text.slice(0, 200) }];
        },
      };
    }
    case "notes": {
      const input = SLIDES_PARAMS.notes.parse(params ?? {});
      const index = slideIndex(deck, input.slide);
      deck.setNotes(index, input.text);
      return {
        bytes: deck.toBytes(),
        done: `notes of slide ${input.slide} set`,
        check: (saved) => [
          check(`slide ${input.slide} notes`, input.text, HxPresentation.read(saved).slides()[index]?.notes),
        ],
      };
    }
    case "layout": {
      const input = SLIDES_PARAMS.layout.parse(params ?? {});
      const index = slideIndex(deck, input.slide);
      const name = deck.setLayout(index, input.layout);
      return {
        bytes: deck.toBytes(),
        done: `slide ${input.slide} now uses the layout ${name}`,
        check: (saved) => [
          check(`slide ${input.slide} layout`, name, HxPresentation.read(saved).slides()[index]?.layout),
        ],
      };
    }
    case "add-picture": {
      const input = SLIDES_PARAMS["add-picture"].parse(params ?? {});
      const index = slideIndex(deck, input.slide);
      const image = readImage(sideFile(files, input.picture));
      const { slide: _slide, picture: _picture, ...place } = input;
      const count = before[index]?.pictures ?? 0;
      deck.addImage(index, image, Object.keys(place).length ? place : undefined);
      return {
        bytes: deck.toBytes(),
        done: `picture added to slide ${input.slide} (${image.width}×${image.height} ${image.type})`,
        check: (saved) => [
          check(`slide ${input.slide} pictures`, count + 1, HxPresentation.read(saved).slides()[index]?.pictures),
        ],
      };
    }
    case "replace-picture": {
      const input = SLIDES_PARAMS["replace-picture"].parse(params ?? {});
      const index = slideIndex(deck, input.slide);
      const image = readImage(sideFile(files, input.picture));
      deck.replaceImage(index, input.index - 1, image);
      const count = before[index]?.pictures ?? 0;
      return {
        bytes: deck.toBytes(),
        done: `picture ${input.index} of slide ${input.slide} replaced`,
        check: (saved) => [
          check(`slide ${input.slide} pictures`, count, HxPresentation.read(saved).slides()[index]?.pictures),
        ],
      };
    }
    default:
      throw new SkillInputError(`The slides skill has no action ${action}.`);
  }
}

function sideFile(files: HxSideFiles, path: string): Uint8Array {
  const bytes = files.get(path);
  if (!bytes) throw new SkillInputError(`The picture ${path} could not be read.`);
  return bytes;
}

/** A problem with what the model asked for: the answer says invalid, with this text. */
export class SkillInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillInputError";
  }
}
