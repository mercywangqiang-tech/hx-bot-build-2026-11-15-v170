// HXBot v1.7.4 测试用：在内存里造最小的 .xlsx、.docx、.pptx 和 PDF，测试不依赖仓库外的任何文件。
// 只被 *.test.ts 引用，不进安装包。
import { deflateSync } from "node:zlib";
import { escapeAttr, escapeText } from "./xml";
import { HxZip } from "./zip";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";

function zipOf(parts: Record<string, string | Uint8Array>): Uint8Array {
  const zip = HxZip.create();
  for (const [name, content] of Object.entries(parts)) {
    if (typeof content === "string") zip.setText(name, content);
    else zip.set(name, content);
  }
  return zip.toBytes();
}

function rels(items: { id: string; type: string; target: string; external?: boolean }[]): string {
  return `${XML}<Relationships xmlns="${PR}">${items
    .map(
      (item) =>
        `<Relationship Id="${item.id}" Type="${R}/${item.type}" Target="${escapeAttr(item.target)}"${item.external ? ' TargetMode="External"' : ""}/>`,
    )
    .join("")}</Relationships>`;
}

// ---------------------------------------------------------------------------------------------- xlsx

type FixtureCell = string | number | boolean | null | { f: string; v?: number | string } | { date: number };

export interface FixtureSheet {
  name: string;
  rows: FixtureCell[][];
  /** Extra XML after sheetData (mergeCells, autoFilter...). */
  after?: string;
  /** Rows written as they are, appended after the generated ones (shared or array formulas). */
  rawRows?: string;
  /** A table over this range, with these column names (the header row must hold the same texts). */
  table?: { ref: string; columns: string[] };
}

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** A workbook with shared strings and a date style (style 1 = yyyy-mm-dd). */
export function xlsxFixture(sheets: FixtureSheet[], options: { date1904?: boolean } = {}): Uint8Array {
  const strings: string[] = [];
  const stringIndex = (text: string) => {
    let index = strings.indexOf(text);
    if (index < 0) {
      strings.push(text);
      index = strings.length - 1;
    }
    return index;
  };
  const parts: Record<string, string> = {};
  const tables: number[] = [];
  for (const [sheetIndex, sheet] of sheets.entries()) {
    const rows = sheet.rows
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            const ref = `${columnName(c)}${r + 1}`;
            if (cell === null) return "";
            if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
            if (typeof cell === "boolean") return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
            if (typeof cell === "string") return `<c r="${ref}" t="s"><v>${stringIndex(cell)}</v></c>`;
            if ("date" in cell) return `<c r="${ref}" s="1"><v>${cell.date}</v></c>`;
            const cached =
              cell.v === undefined
                ? ""
                : typeof cell.v === "number"
                  ? `<v>${cell.v}</v>`
                  : `<v>${escapeText(cell.v)}</v>`;
            return `<c r="${ref}"${typeof cell.v === "string" ? ' t="str"' : ""}><f>${escapeText(cell.f)}</f>${cached}</c>`;
          })
          .join("");
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join("");
    const tablePart = sheet.table ? '<tableParts count="1"><tablePart r:id="rId1"/></tableParts>' : "";
    parts[`xl/worksheets/sheet${sheetIndex + 1}.xml`] =
      `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheetData>${rows}${sheet.rawRows ?? ""}</sheetData>${sheet.after ?? ""}${tablePart}</worksheet>`;
    if (sheet.table) {
      const n = sheetIndex + 1;
      parts[`xl/tables/table${n}.xml`] =
        `${XML}<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${n}" name="Table${n}" displayName="Table${n}" ref="${sheet.table.ref}" totalsRowShown="0"><autoFilter ref="${sheet.table.ref}"/><tableColumns count="${sheet.table.columns.length}">${sheet.table.columns
          .map((name, index) => `<tableColumn id="${index + 1}" name="${escapeAttr(name)}"/>`)
          .join(
            "",
          )}</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
      parts[`xl/worksheets/_rels/sheet${n}.xml.rels`] = rels([
        { id: "rId1", type: "table", target: `../tables/table${n}.xml` },
      ]);
      tables.push(n);
    }
  }
  parts["xl/sharedStrings.xml"] =
    `${XML}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((text) => `<si><t xml:space="preserve">${escapeText(text)}</t></si>`)
      .join("")}</sst>`;
  parts["xl/styles.xml"] =
    `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;
  parts["xl/workbook.xml"] =
    `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}">${options.date1904 ? '<workbookPr date1904="1"/>' : "<workbookPr/>"}<sheets>${sheets
      .map((sheet, index) => `<sheet name="${escapeAttr(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
      .join("")}</sheets><calcPr calcId="191029"/></workbook>`;
  parts["xl/_rels/workbook.xml.rels"] = rels([
    ...sheets.map((_, index) => ({
      id: `rId${index + 1}`,
      type: "worksheet",
      target: `worksheets/sheet${index + 1}.xml`,
    })),
    { id: `rId${sheets.length + 1}`, type: "sharedStrings", target: "sharedStrings.xml" },
    { id: `rId${sheets.length + 2}`, type: "styles", target: "styles.xml" },
  ]);
  parts["_rels/.rels"] = rels([{ id: "rId1", type: "officeDocument", target: "xl/workbook.xml" }]);
  parts["[Content_Types].xml"] =
    `${XML}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map(
        (_, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join(
        "",
      )}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tables
      .map(
        (n) =>
          `<Override PartName="/xl/tables/table${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`,
      )
      .join("")}</Types>`;
  return zipOf(parts);
}

// ---------------------------------------------------------------------------------------------- docx

export interface FixtureParagraph {
  /** Runs of text; several runs split a paragraph the way Word does. */
  runs: string[];
  style?: string;
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function paragraphXml(p: FixtureParagraph): string {
  const style = p.style ? `<w:pPr><w:pStyle w:val="${escapeAttr(p.style)}"/></w:pPr>` : "";
  return `<w:p>${style}${p.runs
    .map(
      (run, index) =>
        `<w:r>${index % 2 === 1 ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${escapeText(run)}</w:t></w:r>`,
    )
    .join("")}</w:p>`;
}

/** A document of paragraphs, then optionally a table, then a last paragraph; with Heading 1 and Normal styles. */
export function docxFixture(paragraphs: FixtureParagraph[], table?: string[][]): Uint8Array {
  const tableXml = table
    ? `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${(table[0] ?? []).map(() => '<w:gridCol w:w="2000"/>').join("")}</w:tblGrid>${table
        .map(
          (row) =>
            `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraphXml({ runs: [cell] })}</w:tc>`).join("")}</w:tr>`,
        )
        .join("")}</w:tbl>${paragraphXml({ runs: ["After the table."] })}`
    : "";
  return zipOf({
    "[Content_Types].xml": `${XML}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    "_rels/.rels": rels([{ id: "rId1", type: "officeDocument", target: "word/document.xml" }]),
    "word/_rels/document.xml.rels": rels([{ id: "rId1", type: "styles", target: "styles.xml" }]),
    "word/styles.xml": `${XML}<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`,
    "word/document.xml": `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${paragraphs.map(paragraphXml).join("")}${tableXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
  });
}

// ---------------------------------------------------------------------------------------------- pptx

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main";

/** A 2×1 red PNG. */
export const PNG_2X1 = Uint8Array.from(
  Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000f4944415478da63f8cfc0f01f00050001ff2ac3cdb60000000049454e44ae426082",
    "hex",
  ),
);

function placeholder(id: number, name: string, type: string, idx: string | null, text: string): string {
  const ph = [type ? `type="${type}"` : "", idx !== null ? `idx="${idx}"` : ""].filter(Boolean).join(" ");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeAttr(name)}"/><p:cNvSpPr/><p:nvPr><p:ph ${ph}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${
    text === ""
      ? "<a:p/>"
      : text
          .split("\n")
          .map((line) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${escapeText(line)}</a:t></a:r></a:p>`)
          .join("")
  }</p:txBody></p:sp>`;
}

function tree(shapes: string): string {
  return `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld>`;
}

export interface FixtureSlide {
  title: string;
  body?: string;
  /** Adds a picture (PNG_2X1) of 2 × 1 inches. */
  picture?: boolean;
  notes?: string;
}

/**
 * A 16:9 presentation with a title layout and a title-and-content layout, a notes master and, when asked,
 * sections (one per slide group given as slide counts).
 */
export function pptxFixture(slides: FixtureSlide[], options: { sections?: number[] } = {}): Uint8Array {
  const parts: Record<string, string | Uint8Array> = {};
  const overrides: string[] = [];
  const override = (part: string, type: string) =>
    overrides.push(
      `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`,
    );
  parts["ppt/slideMasters/slideMaster1.xml"] =
    `${XML}<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">${tree(placeholder(2, "Title Placeholder 1", "title", null, "") + placeholder(3, "Text Placeholder 2", "body", "1", ""))}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst></p:sldMaster>`;
  parts["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = rels([
    { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
    { id: "rId2", type: "slideLayout", target: "../slideLayouts/slideLayout2.xml" },
  ]);
  override("ppt/slideMasters/slideMaster1.xml", "slideMaster");
  const layouts = [
    {
      name: "Title Slide",
      type: "title",
      shapes: placeholder(2, "Title 1", "ctrTitle", null, "") + placeholder(3, "Subtitle 2", "subTitle", "1", ""),
    },
    {
      name: "Title and Content",
      type: "obj",
      shapes: placeholder(2, "Title 1", "title", null, "") + placeholder(3, "Content Placeholder 2", "", "1", ""),
    },
  ];
  for (const [index, layout] of layouts.entries()) {
    parts[`ppt/slideLayouts/slideLayout${index + 1}.xml`] =
      `${XML}<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="${layout.type}">${tree(layout.shapes).replace("<p:cSld>", `<p:cSld name="${layout.name}">`)}</p:sldLayout>`;
    parts[`ppt/slideLayouts/_rels/slideLayout${index + 1}.xml.rels`] = rels([
      { id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" },
    ]);
    override(`ppt/slideLayouts/slideLayout${index + 1}.xml`, "slideLayout");
  }
  parts["ppt/notesMasters/notesMaster1.xml"] =
    `${XML}<p:notesMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">${tree(placeholder(2, "Notes Placeholder 1", "body", "1", ""))}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:notesMaster>`;
  override("ppt/notesMasters/notesMaster1.xml", "notesMaster");
  let media = false;
  for (const [index, slide] of slides.entries()) {
    const n = index + 1;
    const usesTitle = slide.body === undefined;
    const shapes = usesTitle
      ? placeholder(2, "Title 1", "ctrTitle", null, slide.title) + placeholder(3, "Subtitle 2", "subTitle", "1", "")
      : placeholder(2, "Title 1", "title", null, slide.title) +
        placeholder(3, "Content Placeholder 2", "", "1", slide.body ?? "");
    const picture = slide.picture
      ? `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId9"/><a:srcRect l="10000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
      : "";
    parts[`ppt/slides/slide${n}.xml`] =
      `${XML}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">${tree(shapes + picture)}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    const slideRels = [
      { id: "rId1", type: "slideLayout", target: `../slideLayouts/slideLayout${usesTitle ? 1 : 2}.xml` },
    ];
    if (slide.picture) {
      slideRels.push({ id: "rId9", type: "image", target: "../media/image1.png" });
      media = true;
    }
    if (slide.notes !== undefined) {
      slideRels.push({ id: "rId2", type: "notesSlide", target: `../notesSlides/notesSlide${n}.xml` });
      parts[`ppt/notesSlides/notesSlide${n}.xml`] =
        `${XML}<p:notes xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">${tree(placeholder(2, "Slide Image Placeholder 1", "sldImg", null, "") + placeholder(3, "Notes Placeholder 2", "body", "1", slide.notes))}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
      parts[`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`] = rels([
        { id: "rId1", type: "notesMaster", target: "../notesMasters/notesMaster1.xml" },
        { id: "rId2", type: "slide", target: `../slides/slide${n}.xml` },
      ]);
      override(`ppt/notesSlides/notesSlide${n}.xml`, "notesSlide");
    }
    parts[`ppt/slides/_rels/slide${n}.xml.rels`] = rels(slideRels);
    override(`ppt/slides/slide${n}.xml`, "slide");
  }
  if (media) parts["ppt/media/image1.png"] = PNG_2X1;
  let sectionXml = "";
  if (options.sections) {
    let next = 256;
    sectionXml = `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="${P14}">${options.sections
      .map((count, index) => {
        const ids = Array.from({ length: count }, () => `<p14:sldId id="${next++}"/>`).join("");
        return `<p14:section name="Section ${index + 1}" id="{00000000-0000-0000-0000-00000000000${index}}"><p14:sldIdLst>${ids}</p14:sldIdLst></p14:section>`;
      })
      .join("")}</p14:sectionLst></p:ext></p:extLst>`;
  }
  parts["ppt/presentation.xml"] =
    `${XML}<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${slides
      .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${10 + index}"/>`)
      .join(
        "",
      )}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>${sectionXml}</p:presentation>`;
  parts["ppt/_rels/presentation.xml.rels"] = rels([
    { id: "rId1", type: "slideMaster", target: "slideMasters/slideMaster1.xml" },
    { id: "rId2", type: "notesMaster", target: "notesMasters/notesMaster1.xml" },
    ...slides.map((_, index) => ({ id: `rId${10 + index}`, type: "slide", target: `slides/slide${index + 1}.xml` })),
  ]);
  parts["_rels/.rels"] = rels([{ id: "rId1", type: "officeDocument", target: "ppt/presentation.xml" }]);
  parts["[Content_Types].xml"] =
    `${XML}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${media ? '<Default Extension="png" ContentType="image/png"/>' : ""}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${overrides.join("")}</Types>`;
  return zipOf(parts);
}

// ---------------------------------------------------------------------------------------------- pdf

export interface PdfFixtureOptions {
  /** Puts the plain objects into an object stream, with a compressed cross-reference stream (PNG predictor). */
  objectStreams?: boolean;
  /** Adds a form: text "name", checkbox "agree", radio group "plan" (basic, pro), list "city", read-only text "id". */
  form?: boolean;
  /** Adds a link on page 1 that points at the last page. */
  link?: boolean;
  /** Writes an /Encrypt entry in the trailer (the content is not really encrypted). */
  encryptMarker?: boolean;
}

/** A PDF whose pages show the given lines in Helvetica. Returns the bytes and the object number of each page. */
export function pdfFixture(pages: string[][], options: PdfFixtureOptions = {}): Uint8Array {
  const objects: (string | { dict: string; data: Uint8Array })[] = [];
  const add = (value: string | { dict: string; data: Uint8Array }) => {
    objects.push(value);
    return objects.length;
  };
  const catalog = add("");
  const pagesNum = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pageNums: number[] = [];
  const contents: number[] = [];
  for (const lines of pages) {
    const ops = ["BT", "/F1 14 Tf", "72 760 Td", "16 TL"];
    for (const line of lines) ops.push(`(${line.replace(/[()\\]/g, (char) => `\\${char}`)}) Tj T*`);
    ops.push("ET");
    const data = deflateSync(Buffer.from(ops.join("\n"), "latin1"));
    contents.push(add({ dict: "<< /Filter /FlateDecode >>", data }));
    pageNums.push(add(""));
  }
  const annots = new Map<number, number[]>();
  const fields: number[] = [];
  let acroForm = "";
  if (options.form) {
    const helv = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const zadb = add("<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>");
    const ap = (text: string) =>
      add({ dict: "<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] >>", data: Buffer.from(text, "latin1") });
    const on = ap("q 0 g BT /ZaDb 12 Tf 4 4 Td (4) Tj ET Q");
    const off = ap("");
    const first = pageNums[0] ?? 0;
    const last = pageNums.at(-1) ?? 0;
    const name = add(
      `<< /FT /Tx /T (name) /V () /DA (/Helv 12 Tf 0 g) /Type /Annot /Subtype /Widget /Rect [72 600 300 620] /P ${first} 0 R /F 4 >>`,
    );
    const id = add(
      `<< /FT /Tx /T (id) /V (A-1) /Ff 1 /Type /Annot /Subtype /Widget /Rect [72 570 300 590] /P ${first} 0 R >>`,
    );
    const short = add(
      `<< /FT /Tx /T (zip) /MaxLen 5 /Type /Annot /Subtype /Widget /Rect [320 570 400 590] /P ${first} 0 R >>`,
    );
    const agree = add(
      `<< /FT /Btn /T (agree) /V /Off /AS /Off /Type /Annot /Subtype /Widget /Rect [72 540 92 560] /P ${first} 0 R /AP << /N << /Yes ${on} 0 R /Off ${off} 0 R >> >> >>`,
    );
    const plan = add("");
    const basic = add(
      `<< /Parent ${plan} 0 R /AS /basic /Type /Annot /Subtype /Widget /Rect [72 500 92 520] /P ${last} 0 R /AP << /N << /basic ${on} 0 R /Off ${off} 0 R >> >> >>`,
    );
    const pro = add(
      `<< /Parent ${plan} 0 R /AS /Off /Type /Annot /Subtype /Widget /Rect [100 500 120 520] /P ${last} 0 R /AP << /N << /pro ${on} 0 R /Off ${off} 0 R >> >> >>`,
    );
    objects[plan - 1] = `<< /FT /Btn /Ff 49152 /T (plan) /V /basic /Kids [${basic} 0 R ${pro} 0 R] >>`;
    const city = add(
      `<< /FT /Ch /Ff 131072 /T (city) /V (Beijing) /I [0] /Opt [(Beijing) (Shanghai) [(sz) (Shenzhen)]] /DA (/Helv 12 Tf 0 g) /Type /Annot /Subtype /Widget /Rect [72 460 200 480] /P ${last} 0 R >>`,
    );
    annots.set(first, [name, id, short, agree]);
    annots.set(last, [...(annots.get(last) ?? []), basic, pro, city]);
    fields.push(name, id, short, agree, plan, city);
    acroForm = ` /AcroForm << /Fields [${fields.map((num) => `${num} 0 R`).join(" ")}] /DR << /Font << /Helv ${helv} 0 R /ZaDb ${zadb} 0 R >> >> /DA (/Helv 0 Tf 0 g) >>`;
  }
  if (options.link) {
    const first = pageNums[0] ?? 0;
    const last = pageNums.at(-1) ?? 0;
    const link = add(
      `<< /Type /Annot /Subtype /Link /Rect [72 700 200 720] /Border [0 0 0] /Dest [${last} 0 R /Fit] >>`,
    );
    annots.set(first, [...(annots.get(first) ?? []), link]);
  }
  for (const [index, num] of pageNums.entries()) {
    const list = annots.get(num);
    objects[num - 1] =
      `<< /Type /Page /Parent ${pagesNum} 0 R /Contents ${contents[index]} 0 R${list ? ` /Annots [${list.map((item) => `${item} 0 R`).join(" ")}]` : ""} >>`;
  }
  // MediaBox and Resources are inherited from the page tree, as many writers do.
  objects[pagesNum - 1] =
    `<< /Type /Pages /Kids [${pageNums.map((num) => `${num} 0 R`).join(" ")}] /Count ${pageNums.length} /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> >>`;
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesNum} 0 R${acroForm} >>`;
  const info = add("<< /Title (Fixture) /Producer (HXBot test) >>");
  const encrypt = options.encryptMarker ? add("<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>") : 0;
  const header = Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1");
  const chunks: Buffer[] = [header];
  let length = header.length;
  const offsets = new Map<number, number>();
  const push = (text: string | Buffer) => {
    const chunk = typeof text === "string" ? Buffer.from(text, "latin1") : text;
    chunks.push(chunk);
    length += chunk.length;
  };
  const trailerKeys = `/Root ${catalog} 0 R /Info ${info} 0 R${encrypt ? ` /Encrypt ${encrypt} 0 R` : ""} /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]`;
  if (!options.objectStreams) {
    for (const [index, object] of objects.entries()) {
      offsets.set(index + 1, length);
      if (typeof object === "string") push(`${index + 1} 0 obj\n${object}\nendobj\n`);
      else {
        push(`${index + 1} 0 obj\n${object.dict.replace(/>>$/, ` /Length ${object.data.length} >>`)}\nstream\n`);
        push(Buffer.from(object.data));
        push("\nendstream\nendobj\n");
      }
    }
    const xrefAt = length;
    const lines = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f\r\n`];
    for (let num = 1; num <= objects.length; num += 1)
      lines.push(`${String(offsets.get(num) ?? 0).padStart(10, "0")} 00000 n\r\n`);
    push(`${lines.join("")}trailer\n<< /Size ${objects.length + 1} ${trailerKeys} >>\nstartxref\n${xrefAt}\n%%EOF\n`);
    return Uint8Array.from(Buffer.concat(chunks));
  }
  // Object stream for the plain objects, streams written directly, then a cross-reference stream.
  const inStream: number[] = [];
  const bodies: string[] = [];
  for (const [index, object] of objects.entries()) {
    if (typeof object === "string") {
      inStream.push(index + 1);
      bodies.push(object);
    }
  }
  let header2 = "";
  let body = "";
  for (const [k, num] of inStream.entries()) {
    header2 += `${num} ${body.length} `;
    body += `${bodies[k]}\n`;
  }
  const stmData = deflateSync(Buffer.from(header2 + body, "latin1"));
  const stmNum = objects.length + 1;
  for (const [index, object] of objects.entries()) {
    if (typeof object === "string") continue;
    offsets.set(index + 1, length);
    push(`${index + 1} 0 obj\n${object.dict.replace(/>>$/, ` /Length ${object.data.length} >>`)}\nstream\n`);
    push(Buffer.from(object.data));
    push("\nendstream\nendobj\n");
  }
  offsets.set(stmNum, length);
  push(
    `${stmNum} 0 obj\n<< /Type /ObjStm /N ${inStream.length} /First ${header2.length} /Filter /FlateDecode /Length ${stmData.length} >>\nstream\n`,
  );
  push(stmData);
  push("\nendstream\nendobj\n");
  const xrefNum = stmNum + 1;
  const xrefAt = length;
  offsets.set(xrefNum, xrefAt);
  // Rows of [type(1) field2(3) field3(1)], PNG "Up" predictor over 5 columns.
  const rows: number[][] = [[0, 0, 0, 0, 255]];
  for (let num = 1; num <= xrefNum; num += 1) {
    const k = inStream.indexOf(num);
    if (k >= 0) rows.push([2, (stmNum >> 16) & 255, (stmNum >> 8) & 255, stmNum & 255, k]);
    else {
      const offset = offsets.get(num) ?? 0;
      rows.push([1, (offset >> 16) & 255, (offset >> 8) & 255, offset & 255, 0]);
    }
  }
  const predicted: number[] = [];
  let previous = [0, 0, 0, 0, 0];
  for (const row of rows) {
    predicted.push(2, ...row.map((value, i) => (value - (previous[i] ?? 0) + 256) & 255));
    previous = row;
  }
  const xrefData = deflateSync(Buffer.from(predicted));
  push(
    `${xrefNum} 0 obj\n<< /Type /XRef /Size ${xrefNum + 1} /W [1 3 1] ${trailerKeys} /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 5 >> /Length ${xrefData.length} >>\nstream\n`,
  );
  push(xrefData);
  push(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`);
  return Uint8Array.from(Buffer.concat(chunks));
}
