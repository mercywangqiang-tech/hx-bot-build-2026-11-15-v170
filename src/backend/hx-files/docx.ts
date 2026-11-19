// HXBot v1.7.4（CU-07 文档技能）：直接读写 .docx，不打开 Word 或 WPS。
// 读：段落（含表格里的段落）、样式、表格、修订。写：改一段的文字、查找替换（跨多个文字块也能找到）、插入和删除段落、
// 改样式（没有的内置标题样式自动补上）、加粗等格式、表格（改格、加行、插入新表）、修订（改动以修订的方式记下，
// 作者 HXBot；全部接受或全部拒绝）。没改的段落和部件一个字节都不变。
import { HxOfficeError, HxOoxml, NS } from "./ooxml";
import { type HxXmlElement, type HxXmlNode, HxXmlText, xmlElement } from "./xml";

const W = NS.word;

export interface HxParagraph {
  index: number;
  text: string;
  style: string | null;
  /** The table, row and column (from 0) of a paragraph in a table cell. */
  cell: { table: number; row: number; col: number } | null;
  revisions: boolean;
}

export interface HxTable {
  index: number;
  rows: string[][];
}

export interface HxRevisionOptions {
  /** Record the change as a tracked revision. */
  track?: boolean;
  author?: string;
  date?: Date;
}

/** The order of the children of w:pPr (ECMA-376, CT_PPr). */
const PPR_ORDER = [
  "pStyle",
  "keepNext",
  "keepLines",
  "pageBreakBefore",
  "framePr",
  "widowControl",
  "numPr",
  "suppressLineNumbers",
  "pBdr",
  "shd",
  "tabs",
  "suppressAutoHyphens",
  "kinsoku",
  "wordWrap",
  "overflowPunct",
  "topLinePunct",
  "autoSpaceDE",
  "autoSpaceDN",
  "bidi",
  "adjustRightInd",
  "snapToGrid",
  "spacing",
  "ind",
  "contextualSpacing",
  "mirrorIndents",
  "suppressOverlap",
  "jc",
  "textDirection",
  "textAlignment",
  "textboxTightWrap",
  "outlineLvl",
  "divId",
  "cnfStyle",
  "rPr",
  "sectPr",
  "pPrChange",
];

/** The order of the children of w:rPr (ECMA-376, CT_RPr). */
const RPR_ORDER = [
  "rStyle",
  "rFonts",
  "b",
  "bCs",
  "i",
  "iCs",
  "caps",
  "smallCaps",
  "strike",
  "dstrike",
  "outline",
  "shadow",
  "emboss",
  "imprint",
  "noProof",
  "snapToGrid",
  "vanish",
  "webHidden",
  "color",
  "spacing",
  "w",
  "kern",
  "position",
  "sz",
  "szCs",
  "highlight",
  "u",
  "effect",
  "bdr",
  "shd",
  "fitText",
  "vertAlign",
  "rtl",
  "cs",
  "em",
  "lang",
  "eastAsianLayout",
  "specVanish",
  "oMath",
  "ins",
  "del",
  "rPrChange",
];

/** Built-in styles that HXBot adds when a document lacks them, with the names Word and WPS use. */
const BUILTIN_STYLES: Readonly<
  Record<string, { name: string; aliases: string[]; outline?: number; size?: number; bold?: boolean; italic?: boolean }>
> = {
  Heading1: { name: "heading 1", aliases: ["标题 1", "标题1", "Heading 1", "h1"], outline: 0, size: 32, bold: true },
  Heading2: { name: "heading 2", aliases: ["标题 2", "标题2", "Heading 2", "h2"], outline: 1, size: 28, bold: true },
  Heading3: { name: "heading 3", aliases: ["标题 3", "标题3", "Heading 3", "h3"], outline: 2, size: 26, bold: true },
  Heading4: { name: "heading 4", aliases: ["标题 4", "标题4", "Heading 4", "h4"], outline: 3, size: 24, bold: true },
  Title: { name: "Title", aliases: ["标题", "Title"], size: 44, bold: true },
  Subtitle: { name: "Subtitle", aliases: ["副标题", "Subtitle"], size: 28, italic: true },
  Quote: { name: "Quote", aliases: ["引用", "Quote"], italic: true },
  ListParagraph: { name: "List Paragraph", aliases: ["列表段落", "List Paragraph"] },
  Normal: { name: "Normal", aliases: ["正文", "Normal"] },
};

const TEXT_ELEMENTS = new Set(["t", "delText"]);

interface ParagraphRef {
  p: HxXmlElement;
  cell: { table: number; row: number; col: number } | null;
}

/** A Word document read from its bytes. */
export class HxDocument {
  readonly pkg: HxOoxml;
  readonly #part: string;
  #revisionId = 0;

  private constructor(pkg: HxOoxml) {
    this.pkg = pkg;
    this.#part = pkg.mainPart();
    if (pkg.xml(this.#part).root.local !== "document")
      throw new HxOfficeError("not-office", "The file is not a Word document.");
  }

  static read(bytes: Uint8Array): HxDocument {
    return new HxDocument(HxOoxml.read(bytes));
  }

  get #body(): HxXmlElement {
    const body = this.pkg.xml(this.#part).root.child(W, "body");
    if (!body) throw new HxOfficeError("damaged", "The document has no body.");
    return body;
  }

  // ------------------------------------------------------------ reading

  /** Every paragraph and table in document order, those in tables included. */
  #walk(): { paragraphs: ParagraphRef[]; tables: HxXmlElement[] } {
    const paragraphs: ParagraphRef[] = [];
    const tables: HxXmlElement[] = [];
    const visit = (container: HxXmlElement, cell: ParagraphRef["cell"]) => {
      for (const child of container.elements()) {
        if (child.ns !== W) continue;
        if (child.local === "p") paragraphs.push({ p: child, cell });
        else if (child.local === "tbl") {
          const table = tables.length;
          tables.push(child);
          for (const [row, tr] of child.childrenNamed(W, "tr").entries()) {
            for (const [col, tc] of tr.childrenNamed(W, "tc").entries()) visit(tc, { table, row, col });
          }
        } else if (child.local === "sdt") {
          const content = child.child(W, "sdtContent");
          if (content) visit(content, cell);
        } else if (child.local === "customXml" || child.local === "ins" || child.local === "moveTo") {
          visit(child, cell);
        }
      }
    };
    visit(this.#body, null);
    return { paragraphs, tables };
  }

  paragraphs(): HxParagraph[] {
    return this.#walk().paragraphs.map((item, index) => ({
      index,
      text: paragraphText(item.p),
      style: this.#styleOf(item.p),
      cell: item.cell,
      revisions: hasRevisions(item.p),
    }));
  }

  tables(): HxTable[] {
    return this.#walk().tables.map((table, index) => ({
      index,
      rows: table
        .childrenNamed(W, "tr")
        .map((tr) => tr.childrenNamed(W, "tc").map((tc) => tc.childrenNamed(W, "p").map(paragraphText).join("\n"))),
    }));
  }

  /** How many tracked revisions the body holds. */
  revisionCount(): number {
    let count = 0;
    for (const name of ["ins", "del", "moveFrom", "moveTo", "rPrChange", "pPrChange"])
      count += this.#body.descendants(W, name).length;
    return count;
  }

  #styleOf(p: HxXmlElement): string | null {
    return p.child(W, "pPr")?.child(W, "pStyle")?.attrNs(W, "val") ?? null;
  }

  #paragraph(index: number): ParagraphRef {
    const list = this.#walk().paragraphs;
    const found = list[index];
    if (!found)
      throw new HxOfficeError("invalid", `The document has ${list.length} paragraphs; there is no paragraph ${index}.`);
    return found;
  }

  #table(index: number): HxXmlElement {
    const list = this.#walk().tables;
    const found = list[index];
    if (!found)
      throw new HxOfficeError("invalid", `The document has ${list.length} tables; there is no table ${index}.`);
    return found;
  }

  // ------------------------------------------------------------ revisions

  #mark(kind: "ins" | "del", options: HxRevisionOptions, children: HxXmlNode[] = []): HxXmlElement {
    this.#revisionId = Math.max(this.#revisionId, this.#maxRevisionId()) + 1;
    const date = (options.date ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
    return wEl(
      this.#body,
      kind,
      { "w:id": String(this.#revisionId), "w:author": options.author ?? "HXBot", "w:date": date },
      children,
    );
  }

  #maxRevisionId(): number {
    let max = 0;
    for (const name of ["ins", "del", "moveFrom", "moveTo", "rPrChange", "pPrChange", "bookmarkStart", "comment"]) {
      for (const element of this.#body.descendants(W, name)) {
        const id = Number(element.attrNs(W, "id"));
        if (Number.isFinite(id) && id > max) max = id;
      }
    }
    return max;
  }

  // ------------------------------------------------------------ writing

  /** Replaces the text of one paragraph; its paragraph properties and the first run's look stay. */
  setParagraph(index: number, text: string, options: HxRevisionOptions = {}): void {
    const { p } = this.#paragraph(index);
    const runs = visibleRuns(p);
    const look = runs.find((run) => run.child(W, "rPr"))?.child(W, "rPr") ?? null;
    const created = this.#run(text, look);
    if (options.track) {
      for (const run of runs) this.#deleteRun(run, options);
      const anchor = runs.at(-1) ?? null;
      const ins = this.#mark("ins", options, [created]);
      insertAfterInParent(ins, anchor, p);
      return;
    }
    for (const child of [...p.children]) {
      if (
        child.kind === "element" &&
        child.ns === W &&
        (child.local === "pPr" || child.local === "bookmarkStart" || child.local === "bookmarkEnd")
      )
        continue;
      p.remove(child);
    }
    p.append(created);
  }

  /**
   * Replaces `find` with `replace` in every paragraph (or the first match only), across runs. Returns
   * how many places changed and in which paragraphs.
   */
  replace(
    find: string,
    replace: string,
    options: HxRevisionOptions & { all?: boolean; matchCase?: boolean } = {},
  ): { count: number; paragraphs: number[] } {
    if (find === "") throw new HxOfficeError("invalid", "The text to find is empty.");
    const needle = options.matchCase ? find : find.toLowerCase();
    let count = 0;
    const touched: number[] = [];
    for (const [index, { p }] of this.#walk().paragraphs.entries()) {
      // After each replacement the search goes on behind it, so a replacement that holds the text is not found again.
      let from = 0;
      for (;;) {
        const text = charMap(p)
          .map((item) => item.char)
          .join("");
        const at = (options.matchCase ? text : text.toLowerCase()).indexOf(needle, from);
        if (at < 0) break;
        this.#replaceRange(p, at, at + find.length, replace, options);
        count += 1;
        from = at + replace.length;
        if (!touched.includes(index)) touched.push(index);
        if (!options.all) return { count, paragraphs: touched };
        if (count >= 100_000)
          throw new HxOfficeError("invalid", "More than 100,000 places match; narrow the text to find.");
      }
    }
    return { count, paragraphs: touched };
  }

  #replaceRange(p: HxXmlElement, start: number, end: number, replace: string, options: HxRevisionOptions): void {
    // Split runs so that the range covers whole runs.
    splitAt(p, end);
    splitAt(p, start);
    const chars = charMap(p);
    const runs: HxXmlElement[] = [];
    for (let at = start; at < end; at += 1) {
      const run = chars[at]?.run;
      if (run && !runs.includes(run)) runs.push(run);
    }
    const first = runs[0];
    if (!first) return;
    const look = first.child(W, "rPr");
    const created = replace === "" ? null : this.#run(replace, look);
    if (options.track) {
      for (const run of runs) this.#deleteRun(run, options);
      if (created) insertAfterInParent(this.#mark("ins", options, [created]), runs.at(-1) ?? null, p);
      return;
    }
    const parent = first.parent;
    if (created && parent) parent.insertBefore(created, first);
    for (const run of runs) run.parent?.remove(run);
  }

  /** Wraps a run in w:del, its text becoming deleted text. */
  #deleteRun(run: HxXmlElement, options: HxRevisionOptions): void {
    const parent = run.parent;
    if (!parent) return;
    if (parent.local === "ins" && parent.ns === W) {
      // Deleting one's own insertion just removes it.
      parent.remove(run);
      if (parent.elements().length === 0) parent.parent?.remove(parent);
      return;
    }
    for (const t of run.childrenNamed(W, "t")) {
      const del = xmlElement(
        t.name.replace(/t$/, "delText"),
        Object.fromEntries(t.attrs.map((attr) => [attr.name, attr.value])),
        [t.text()],
      );
      run.replaceChild(t, del);
    }
    for (const code of run.childrenNamed(W, "instrText")) {
      run.replaceChild(
        code,
        xmlElement(
          code.name.replace(/instrText$/, "delInstrText"),
          Object.fromEntries(code.attrs.map((attr) => [attr.name, attr.value])),
          [code.text()],
        ),
      );
    }
    const marker = this.#mark("del", options);
    parent.replaceChild(run, marker);
    marker.append(run);
  }

  /** A run with `text`: tabs become w:tab and line breaks w:br, as Word writes them. */
  #run(text: string, look: HxXmlElement | null): HxXmlElement {
    const run = wEl(this.#body, "r");
    if (look) run.append(clone(look));
    const parts = text.split(/(\t|\r\n|\n)/);
    for (const part of parts) {
      if (part === "") continue;
      if (part === "\t") run.append(wEl(this.#body, "tab"));
      else if (part === "\n" || part === "\r\n") run.append(wEl(this.#body, "br"));
      else
        run.append(
          wEl(this.#body, "t", /^\s|\s$/.test(part) || part.includes("  ") ? { "xml:space": "preserve" } : {}, [part]),
        );
    }
    return run;
  }

  /** Inserts a new paragraph after paragraph `index` (or before the first one for -1). */
  insertParagraph(index: number, text: string, style?: string, options: HxRevisionOptions = {}): number {
    const all = this.#walk().paragraphs;
    const p = wEl(this.#body, "p");
    if (style) {
      const id = this.resolveStyle(style);
      p.append(wEl(this.#body, "pPr", {}, [wEl(this.#body, "pStyle", { "w:val": id })]));
    }
    const run = this.#run(text, null);
    if (options.track) {
      let ppr = p.child(W, "pPr");
      if (!ppr) {
        ppr = wEl(this.#body, "pPr");
        p.insertBefore(ppr, p.children[0] ?? null);
      }
      placeIn(ppr, wEl(this.#body, "rPr", {}, [this.#mark("ins", options)]), PPR_ORDER);
      p.append(this.#mark("ins", options, [run]));
    } else {
      p.append(run);
    }
    if (index < 0) {
      const first = all[0]?.p ?? null;
      (first?.parent ?? this.#body).insertBefore(p, first ?? this.#beforeSectPr());
      return 0;
    }
    const after = all[index];
    if (!after) throw new HxOfficeError("invalid", `There is no paragraph ${index}.`);
    after.p.parent?.insertAfter(p, after.p);
    return index + 1;
  }

  #beforeSectPr(): HxXmlNode | null {
    return this.#body.child(W, "sectPr");
  }

  /** Deletes a paragraph. A table cell keeps one empty paragraph, as Word needs. */
  deleteParagraph(index: number, options: HxRevisionOptions = {}): void {
    const { p } = this.#paragraph(index);
    if (options.track) {
      for (const run of visibleRuns(p)) this.#deleteRun(run, options);
      let ppr = p.child(W, "pPr");
      if (!ppr) {
        ppr = wEl(this.#body, "pPr");
        p.insertBefore(ppr, p.children[0] ?? null);
      }
      let rpr = ppr.child(W, "rPr");
      if (!rpr) {
        rpr = wEl(this.#body, "rPr");
        placeIn(ppr, rpr, PPR_ORDER);
      }
      placeIn(rpr, this.#mark("del", options), RPR_ORDER);
      return;
    }
    const parent = p.parent;
    if (!parent) return;
    if (parent.local === "tc" && parent.childrenNamed(W, "p").length === 1) {
      for (const child of [...p.children]) if (!(child.kind === "element" && child.local === "pPr")) p.remove(child);
      return;
    }
    if (
      parent === this.#body &&
      this.#body.childrenNamed(W, "p").length === 1 &&
      this.#body.childrenNamed(W, "tbl").length === 0
    ) {
      // The last paragraph of the body stays, empty.
      for (const child of [...p.children]) if (!(child.kind === "element" && child.local === "pPr")) p.remove(child);
      return;
    }
    parent.remove(p);
  }

  /** The style id for a style id, a style name ("heading 1"), or a Chinese built-in name ("标题 1"). Built-ins are added. */
  resolveStyle(style: string): string {
    const styles = this.#styles();
    const wanted = style.trim().toLowerCase();
    if (styles) {
      for (const element of styles.childrenNamed(W, "style")) {
        const id = element.attrNs(W, "styleId") ?? "";
        const name = element.child(W, "name")?.attrNs(W, "val") ?? "";
        if (id.toLowerCase() === wanted || name.toLowerCase() === wanted) return id;
      }
    }
    for (const [id, info] of Object.entries(BUILTIN_STYLES)) {
      if (
        id.toLowerCase() === wanted ||
        info.name.toLowerCase() === wanted ||
        info.aliases.some((alias) => alias.toLowerCase() === wanted)
      ) {
        if (styles) {
          // The built-in may be there under its name with another id (WPS uses 2, 3...).
          for (const element of styles.childrenNamed(W, "style")) {
            const name = element.child(W, "name")?.attrNs(W, "val") ?? "";
            if (
              name.toLowerCase() === info.name.toLowerCase() ||
              info.aliases.some((alias) => alias.toLowerCase() === name.toLowerCase())
            ) {
              return element.attrNs(W, "styleId") ?? id;
            }
          }
          styles.append(this.#builtinStyle(id, info));
        }
        return id;
      }
    }
    throw new HxOfficeError("invalid", `The document has no style ${style}.`);
  }

  #styles(): HxXmlElement | null {
    const rel = this.pkg.rels(this.#part).find((item) => item.type.endsWith("/styles"));
    return rel && this.pkg.has(rel.target) ? this.pkg.xml(rel.target).root : null;
  }

  #builtinStyle(id: string, info: (typeof BUILTIN_STYLES)[string]): HxXmlElement {
    const styles = this.#styles();
    const scope = styles ?? this.#body;
    const style = wEl(scope, "style", { "w:type": "paragraph", "w:styleId": id });
    style.append(wEl(scope, "name", { "w:val": info.name }));
    if (id !== "Normal") {
      style.append(wEl(scope, "basedOn", { "w:val": "Normal" }));
      style.append(wEl(scope, "next", { "w:val": "Normal" }));
    }
    style.append(wEl(scope, "uiPriority", { "w:val": id.startsWith("Heading") ? "9" : "10" }));
    style.append(wEl(scope, "qFormat"));
    const ppr = wEl(scope, "pPr");
    if (info.outline !== undefined) {
      ppr.append(wEl(scope, "keepNext"));
      ppr.append(wEl(scope, "keepLines"));
      ppr.append(wEl(scope, "spacing", { "w:before": "240", "w:after": "120" }));
      ppr.append(wEl(scope, "outlineLvl", { "w:val": String(info.outline) }));
    }
    if (ppr.children.length > 0) style.append(ppr);
    const rpr = wEl(scope, "rPr");
    if (info.bold) rpr.append(wEl(scope, "b"));
    if (info.italic) rpr.append(wEl(scope, "i"));
    if (info.size) {
      rpr.append(wEl(scope, "sz", { "w:val": String(info.size) }));
      rpr.append(wEl(scope, "szCs", { "w:val": String(info.size) }));
    }
    if (rpr.children.length > 0) style.append(rpr);
    return style;
  }

  setStyle(index: number, style: string): string {
    const { p } = this.#paragraph(index);
    const id = this.resolveStyle(style);
    let ppr = p.child(W, "pPr");
    if (!ppr) {
      ppr = wEl(this.#body, "pPr");
      p.insertBefore(ppr, p.children[0] ?? null);
    }
    const existing = ppr.child(W, "pStyle");
    if (existing) existing.setAttr(attrName(existing, "val"), id);
    else placeIn(ppr, wEl(this.#body, "pStyle", { "w:val": id }), PPR_ORDER);
    return id;
  }

  /** Sets the look of every run of a paragraph. */
  format(
    index: number,
    look: { bold?: boolean; italic?: boolean; underline?: boolean; size?: number; color?: string; font?: string },
  ): void {
    const { p } = this.#paragraph(index);
    for (const run of visibleRuns(p)) {
      let rpr = run.child(W, "rPr");
      if (!rpr) {
        rpr = wEl(this.#body, "rPr");
        run.insertBefore(rpr, run.children[0] ?? null);
      }
      const set = (local: string, attrs: Record<string, string> | null) => {
        const existing = rpr?.child(W, local);
        if (attrs === null) {
          if (existing) rpr?.remove(existing);
          return;
        }
        const element = wEl(this.#body, local, attrs);
        if (rpr) placeIn(rpr, element, RPR_ORDER);
      };
      if (look.bold !== undefined) set("b", look.bold ? {} : { "w:val": "0" });
      if (look.italic !== undefined) set("i", look.italic ? {} : { "w:val": "0" });
      if (look.underline !== undefined) set("u", { "w:val": look.underline ? "single" : "none" });
      if (look.size !== undefined) {
        if (!(look.size >= 1 && look.size <= 1638))
          throw new HxOfficeError("invalid", "The font size is from 1 to 1638 points.");
        set("sz", { "w:val": String(Math.round(look.size * 2)) });
        set("szCs", { "w:val": String(Math.round(look.size * 2)) });
      }
      if (look.color !== undefined) {
        const color = look.color.replace(/^#/, "").toUpperCase();
        if (!/^[0-9A-F]{6}$/.test(color))
          throw new HxOfficeError("invalid", "The color is six hex digits, such as FF0000.");
        set("color", { "w:val": color });
      }
      if (look.font !== undefined)
        set("rFonts", { "w:ascii": look.font, "w:hAnsi": look.font, "w:eastAsia": look.font, "w:cs": look.font });
    }
  }

  /** Sets the text of a table cell (row and column from 0). */
  setCell(table: number, row: number, col: number, text: string, options: HxRevisionOptions = {}): void {
    const tc = this.#table(table).childrenNamed(W, "tr")[row]?.childrenNamed(W, "tc")[col];
    if (!tc) throw new HxOfficeError("invalid", `Table ${table} has no cell at row ${row}, column ${col}.`);
    const paragraphs = tc.childrenNamed(W, "p");
    const first = paragraphs[0];
    if (!first) {
      tc.append(wEl(this.#body, "p"));
      this.setCell(table, row, col, text, options);
      return;
    }
    const index = this.#walk().paragraphs.findIndex((item) => item.p === first);
    this.setParagraph(index, text, options);
    if (!options.track) for (const extra of paragraphs.slice(1)) tc.remove(extra);
  }

  /** Adds a row at the end of a table, shaped like its last row. */
  addRow(table: number, values: readonly string[], options: HxRevisionOptions = {}): number {
    const tbl = this.#table(table);
    const rows = tbl.childrenNamed(W, "tr");
    const last = rows.at(-1);
    if (!last) throw new HxOfficeError("invalid", `Table ${table} has no rows to copy.`);
    const tr = clone(last);
    // Revision marks and merged cells of the copied row do not belong to the new one.
    for (const element of [...tr.descendants(W, "ins"), ...tr.descendants(W, "del")]) element.parent?.remove(element);
    tbl.insertAfter(tr, last);
    const cells = tr.childrenNamed(W, "tc");
    for (const [col, tc] of cells.entries()) {
      const paragraphs = tc.childrenNamed(W, "p");
      for (const extra of paragraphs.slice(1)) tc.remove(extra);
      const p = paragraphs[0] ?? wEl(this.#body, "p");
      if (!paragraphs[0]) tc.append(p);
      const look =
        visibleRuns(p)
          .find((run) => run.child(W, "rPr"))
          ?.child(W, "rPr") ?? null;
      for (const child of [...p.children]) if (!(child.kind === "element" && child.local === "pPr")) p.remove(child);
      const run = this.#run(values[col] ?? "", look);
      if (options.track) p.append(this.#mark("ins", options, [run]));
      else p.append(run);
    }
    if (options.track) {
      let trPr = tr.child(W, "trPr");
      if (!trPr) {
        trPr = wEl(this.#body, "trPr");
        const firstCell = tr.child(W, "tc");
        tr.insertBefore(trPr, firstCell);
      }
      trPr.append(this.#mark("ins", options));
    }
    return tbl.childrenNamed(W, "tr").length - 1;
  }

  /** Inserts a new table after paragraph `index`, with grid lines, the first row as a header. */
  insertTable(index: number, rows: readonly (readonly string[])[]): number {
    if (rows.length === 0 || rows.length > 2000)
      throw new HxOfficeError("invalid", "A table has 1 to 2,000 rows here.");
    const cols = Math.max(...rows.map((row) => row.length));
    if (cols < 1 || cols > 63) throw new HxOfficeError("invalid", "A table has 1 to 63 columns.");
    const scope = this.#body;
    const width = this.#textWidth();
    const colWidth = Math.floor(width / cols);
    const borders = wEl(scope, "tblBorders");
    for (const side of ["top", "left", "bottom", "right", "insideH", "insideV"]) {
      borders.append(wEl(scope, side, { "w:val": "single", "w:sz": "4", "w:space": "0", "w:color": "auto" }));
    }
    const tbl = wEl(scope, "tbl", {}, [
      wEl(scope, "tblPr", {}, [
        wEl(scope, "tblW", { "w:w": "0", "w:type": "auto" }),
        borders,
        wEl(scope, "tblLook", {
          "w:val": "04A0",
          "w:firstRow": "1",
          "w:lastRow": "0",
          "w:firstColumn": "1",
          "w:lastColumn": "0",
          "w:noHBand": "0",
          "w:noVBand": "1",
        }),
      ]),
      wEl(
        scope,
        "tblGrid",
        {},
        Array.from({ length: cols }, () => wEl(scope, "gridCol", { "w:w": String(colWidth) })),
      ),
    ]);
    for (const [rowIndex, values] of rows.entries()) {
      const tr = wEl(scope, "tr");
      if (rowIndex === 0) tr.append(wEl(scope, "trPr", {}, [wEl(scope, "tblHeader")]));
      for (let col = 0; col < cols; col += 1) {
        const run = this.#run(values[col] ?? "", rowIndex === 0 ? wEl(scope, "rPr", {}, [wEl(scope, "b")]) : null);
        tr.append(
          wEl(scope, "tc", {}, [
            wEl(scope, "tcPr", {}, [wEl(scope, "tcW", { "w:w": String(colWidth), "w:type": "dxa" })]),
            wEl(scope, "p", {}, [run]),
          ]),
        );
      }
      tbl.append(tr);
    }
    const all = this.#walk();
    const after = index < 0 ? null : all.paragraphs[index];
    if (index >= 0 && !after) throw new HxOfficeError("invalid", `There is no paragraph ${index}.`);
    if (after) after.p.parent?.insertAfter(tbl, after.p);
    else this.#body.insertBefore(tbl, all.paragraphs[0]?.p ?? this.#beforeSectPr());
    // A table followed directly by another table or the section end needs a paragraph after it in Word.
    const next = nextElement(tbl);
    if (next?.local !== "p") tbl.parent?.insertAfter(wEl(scope, "p"), tbl);
    return this.#walk().tables.indexOf(tbl);
  }

  #textWidth(): number {
    const sect = this.#body.child(W, "sectPr");
    const size = sect?.child(W, "pgSz");
    const margins = sect?.child(W, "pgMar");
    const page = Number(size?.attrNs(W, "w") ?? 11906);
    const left = Number(margins?.attrNs(W, "left") ?? 1440);
    const right = Number(margins?.attrNs(W, "right") ?? 1440);
    const width = page - left - right;
    return Number.isFinite(width) && width > 1000 ? width : 9026;
  }

  /** Accepts (or rejects) every tracked revision of the body. Returns how many were resolved. */
  resolveRevisions(accept: boolean): number {
    let count = 0;
    const body = this.#body;
    const unwrap = (element: HxXmlElement) => {
      const parent = element.parent;
      if (!parent) return;
      for (const child of [...element.children]) parent.insertBefore(child, element);
      parent.remove(element);
    };
    const restoreText = (element: HxXmlElement) => {
      for (const del of element.descendants(W, "delText")) {
        del.parent?.replaceChild(
          del,
          xmlElement(
            del.name.replace(/delText$/, "t"),
            Object.fromEntries(del.attrs.map((attr) => [attr.name, attr.value])),
            [del.text()],
          ),
        );
      }
      for (const del of element.descendants(W, "delInstrText")) {
        del.parent?.replaceChild(
          del,
          xmlElement(
            del.name.replace(/delInstrText$/, "instrText"),
            Object.fromEntries(del.attrs.map((attr) => [attr.name, attr.value])),
            [del.text()],
          ),
        );
      }
    };
    // Paragraphs whose mark goes away merge into the next one, after their runs are resolved.
    const pendingMerges: HxXmlElement[] = [];
    // Rows, then paragraph marks, then runs.
    for (const tr of body.descendants(W, "tr")) {
      const trPr = tr.child(W, "trPr");
      const ins = trPr?.child(W, "ins");
      const del = trPr?.child(W, "del");
      if (ins) {
        count += 1;
        if (accept) trPr?.remove(ins);
        else tr.parent?.remove(tr);
      }
      if (del) {
        count += 1;
        if (accept) tr.parent?.remove(tr);
        else trPr?.remove(del);
      }
    }
    for (const p of body.descendants(W, "p")) {
      const rpr = p.child(W, "pPr")?.child(W, "rPr");
      const ins = rpr?.child(W, "ins");
      const del = rpr?.child(W, "del");
      if (ins) {
        count += 1;
        rpr?.remove(ins);
        if (!accept) pendingMerges.push(p);
      }
      if (del) {
        count += 1;
        rpr?.remove(del);
        if (accept) pendingMerges.push(p);
      }
      // The mark's properties held only the revision: leave no empty w:rPr (or w:pPr) behind.
      if ((ins || del) && rpr && rpr.elements().length === 0) {
        const ppr = rpr.parent;
        ppr?.remove(rpr);
        if (ppr && ppr.elements().length === 0) ppr.parent?.remove(ppr);
      }
    }
    for (const name of ["ins", "moveTo"]) {
      for (const element of body.descendants(W, name)) {
        if (!element.parent) continue;
        count += 1;
        if (accept) unwrap(element);
        else element.parent.remove(element);
      }
    }
    for (const name of ["del", "moveFrom"]) {
      for (const element of body.descendants(W, name)) {
        if (!element.parent) continue;
        count += 1;
        if (accept) element.parent.remove(element);
        else {
          restoreText(element);
          unwrap(element);
        }
      }
    }
    for (const p of pendingMerges) mergeIntoNext(p);
    for (const name of ["moveFromRangeStart", "moveFromRangeEnd", "moveToRangeStart", "moveToRangeEnd"]) {
      for (const element of body.descendants(W, name)) element.parent?.remove(element);
    }
    for (const name of [
      "rPrChange",
      "pPrChange",
      "tblPrChange",
      "trPrChange",
      "tcPrChange",
      "tblGridChange",
      "sectPrChange",
      "numberingChange",
    ]) {
      for (const change of body.descendants(W, name)) {
        const owner = change.parent;
        if (!owner) continue;
        count += 1;
        if (accept) {
          owner.remove(change);
          continue;
        }
        // Rejecting puts the properties from before the change back.
        const old = change.elements()[0];
        const keep = owner
          .elements()
          .filter(
            (child) =>
              child === change || (owner.local === "pPr" && (child.local === "rPr" || child.local === "sectPr")),
          );
        owner.setChildren([]);
        for (const child of old?.elements() ?? []) owner.append(child);
        for (const child of keep) if (child !== change) owner.append(child);
      }
    }
    return count;
  }

  toBytes(): Uint8Array {
    return this.pkg.toBytes();
  }
}

/** A new element in the Word namespace, with the prefix the part uses for it; "w:" attributes follow that prefix. */
function wEl(
  scope: HxXmlElement,
  local: string,
  attrs: Readonly<Record<string, string>> = {},
  children: readonly (HxXmlNode | string)[] = [],
): HxXmlElement {
  const name = scope.qname(W, local, "w");
  let prefix = scope.lookupPrefix(W);
  if (prefix === "" || prefix === null) {
    // Attributes need a prefix of their own: an unprefixed attribute has no namespace.
    let root = scope;
    while (root.parent) root = root.parent;
    const declared = root.attr("xmlns:w");
    if (declared === null) root.setAttr("xmlns:w", W);
    prefix = declared === null || declared === W ? "w" : "hxw";
    if (prefix === "hxw") root.setAttr("xmlns:hxw", W);
  }
  const mapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs))
    mapped[key.startsWith("w:") ? `${prefix}:${key.slice(2)}` : key] = value;
  const element = xmlElement(name, mapped, children);
  // Until it is placed, the element resolves its prefix where it is going: child(W, ...) finds it at once.
  element.scope = scope;
  return element;
}

function attrName(element: HxXmlElement, local: string): string {
  const existing = element.attrs.find((attr) => attr.name.endsWith(`:${local}`));
  return existing?.name ?? `w:${local}`;
}

function clone(element: HxXmlElement): HxXmlElement {
  const copy = xmlElement(element.name, Object.fromEntries(element.attrs.map((attr) => [attr.name, attr.value])));
  for (const child of element.children) {
    if (child.kind === "element") copy.append(clone(child));
    else if (child.kind === "text") copy.append(new HxXmlText(child.value));
  }
  return copy;
}

function placeIn(parent: HxXmlElement, element: HxXmlElement, order: readonly string[]): void {
  const existing = parent.elements().find((child) => child.local === element.local && child.ns === element.ns);
  if (existing) {
    parent.replaceChild(existing, element);
    return;
  }
  const rank = order.indexOf(element.local);
  const after = parent.elements().find((child) => order.indexOf(child.local) > rank);
  parent.insertBefore(element, after ?? null);
}

function insertAfterInParent(node: HxXmlElement, anchor: HxXmlElement | null, p: HxXmlElement): void {
  if (anchor?.parent) {
    // After the anchor, or after the w:del that now wraps it.
    let target: HxXmlElement = anchor;
    while (target.parent && target.parent !== p && target.parent.local === "del") target = target.parent;
    target.parent?.insertAfter(node, target);
    return;
  }
  p.append(node);
}

function nextElement(element: HxXmlElement): HxXmlElement | null {
  const siblings = element.parent?.elements() ?? [];
  return siblings[siblings.indexOf(element) + 1] ?? null;
}

/**
 * A paragraph mark that goes away: the paragraph's content moves to the start of the next paragraph, which
 * keeps its own properties, as in Word. With no next paragraph (a table follows, or the end of a cell), an
 * empty paragraph is removed, and one with content stays.
 */
function mergeIntoNext(p: HxXmlElement): void {
  if (!p.parent) return;
  const next = nextElement(p);
  const content = p.children.filter((child) => !(child.kind === "element" && child.local === "pPr"));
  if (next && next.local === "p" && next.ns === W) {
    const nextProps = next.child(W, "pPr");
    let anchor: HxXmlNode | null = nextProps
      ? (next.children[next.children.indexOf(nextProps) + 1] ?? null)
      : (next.children[0] ?? null);
    for (const child of content) {
      next.insertBefore(child, anchor);
      anchor = next.children[next.children.indexOf(child) + 1] ?? null;
    }
    p.parent.remove(p);
    return;
  }
  const empty = paragraphText(p) === "" && p.descendants(W, "drawing").length === 0;
  const siblings = p.parent.childrenNamed(W, "p");
  if (empty && !(siblings.length === 1 && (p.parent.local === "tc" || p.parent.local === "body"))) p.parent.remove(p);
}

/** The runs that show text now: in the paragraph, in links, insertions, smart tags and content controls; not deletions. */
function visibleRuns(p: HxXmlElement): HxXmlElement[] {
  const runs: HxXmlElement[] = [];
  const visit = (element: HxXmlElement) => {
    for (const child of element.elements()) {
      if (child.ns !== W) continue;
      if (child.local === "r") runs.push(child);
      else if (["hyperlink", "ins", "smartTag", "customXml", "fldSimple", "moveTo", "dir", "bdo"].includes(child.local))
        visit(child);
      else if (child.local === "sdt") {
        const content = child.child(W, "sdtContent");
        if (content) visit(content);
      }
    }
  };
  visit(p);
  return runs;
}

interface CharRef {
  char: string;
  run: HxXmlElement;
  /** The w:t node and the offset in it, or null for a tab or a break. */
  node: HxXmlElement | null;
  offset: number;
}

/** Every visible character of a paragraph with the run and text node it stands in; field codes left out. */
function charMap(p: HxXmlElement): CharRef[] {
  const chars: CharRef[] = [];
  let inCode = false;
  for (const run of visibleRuns(p)) {
    for (const child of run.elements()) {
      if (child.ns !== W) continue;
      if (child.local === "fldChar") {
        const type = child.attrNs(W, "fldCharType");
        if (type === "begin") inCode = true;
        else if (type === "separate" || type === "end") inCode = false;
        continue;
      }
      if (inCode) continue;
      if (child.local === "t") {
        const text = child.text();
        for (let index = 0; index < text.length; index += 1)
          chars.push({ char: text[index] ?? "", run, node: child, offset: index });
      } else if (child.local === "tab") chars.push({ char: "\t", run, node: null, offset: 0 });
      else if (child.local === "br" || child.local === "cr") chars.push({ char: "\n", run, node: null, offset: 0 });
      else if (child.local === "noBreakHyphen") chars.push({ char: "‑", run, node: null, offset: 0 });
    }
  }
  return chars;
}

/** Splits the run at character `at` of the paragraph, so that a run starts there. */
function splitAt(p: HxXmlElement, at: number): void {
  const chars = charMap(p);
  const here = chars[at];
  const before = chars[at - 1];
  if (!here || !before || here.run !== before.run) return;
  const run = here.run;
  const second = xmlElement(run.name, Object.fromEntries(run.attrs.map((attr) => [attr.name, attr.value])));
  const rpr = run.child(W, "rPr");
  if (rpr) second.append(clone(rpr));
  let moving = false;
  for (const child of [...run.children]) {
    if (child.kind === "element" && child.local === "rPr") continue;
    if (child === here.node && here.offset > 0) {
      const text = here.node.text();
      here.node.setText(text.slice(0, here.offset));
      here.node.setAttr("xml:space", "preserve");
      second.append(xmlElement(here.node.name, { "xml:space": "preserve" }, [text.slice(here.offset)]));
      moving = true;
      continue;
    }
    if (
      !moving &&
      (child === here.node || (here.node === null && child.kind === "element" && child === tabOrBreakAt(run, here)))
    )
      moving = true;
    if (moving) {
      run.remove(child);
      second.append(child);
    }
  }
  run.parent?.insertAfter(second, run);
}

function tabOrBreakAt(run: HxXmlElement, ref: CharRef): HxXmlElement | null {
  // The non-text child that `ref` stands for: count the characters of the run up to it.
  const chars = charMap(run.parent ?? run).filter((item) => item.run === run);
  let seen = 0;
  for (const child of run.elements()) {
    if (child.local === "t") {
      seen += child.text().length;
      continue;
    }
    if (["tab", "br", "cr", "noBreakHyphen"].includes(child.local)) {
      if (chars[seen] === ref) return child;
      seen += 1;
    }
  }
  return null;
}

/** The text of a paragraph as it reads now: insertions in, deletions and field codes out. */
export function paragraphText(p: HxXmlElement): string {
  return charMap(p)
    .map((item) => item.char)
    .join("");
}

function hasRevisions(p: HxXmlElement): boolean {
  for (const name of ["ins", "del", "moveFrom", "moveTo", "rPrChange", "pPrChange"])
    if (p.descendants(W, name).length > 0) return true;
  return false;
}

export { TEXT_ELEMENTS };
