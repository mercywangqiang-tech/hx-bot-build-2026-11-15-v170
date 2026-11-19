import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pdfFixture } from "./office-fixtures";
import {
  HxPdf,
  HxPdfError,
  hxPdfCopyPages,
  hxPdfFields,
  hxPdfFill,
  type PdfDict,
  PdfName,
  PdfString,
  parsePageRanges,
  pdfText,
} from "./pdf";

const PAGES = [["Hello page 1", "(parens) \\ ok"], ["Page two"], ["Page three"]];

function plain(): Uint8Array {
  return pdfFixture(PAGES, { form: true, link: true });
}

function compact(): Uint8Array {
  return pdfFixture(PAGES, { form: true, link: true, objectStreams: true });
}

function errorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof HxPdfError) return error.code;
    throw error;
  }
  return "none";
}

function fieldValues(pdf: HxPdf): Record<string, string> {
  return Object.fromEntries(hxPdfFields(pdf).map((field) => [field.name, field.value]));
}

function links(pdf: HxPdf, page: number): string[] {
  return pdf
    .array(pdf.pages()[page]?.dict.get("Annots"))
    .map((annot) => pdf.dict(annot))
    .filter((annot): annot is PdfDict => annot !== null && pdfText(annot.get("Subtype") ?? null) === "/Link")
    .map((annot) => pdfText(annot.get("Dest") ?? null));
}

/** The bytes with the cross-reference table and trailer cut away, so that the file must be rebuilt. */
function withoutXref(bytes: Uint8Array): Uint8Array {
  const text = Buffer.from(bytes).toString("latin1");
  return Uint8Array.from(Buffer.from(`${text.slice(0, text.lastIndexOf("xref\n0 "))}%%EOF\n`, "latin1"));
}

describe("reading PDFs", () => {
  it.each([
    ["a cross-reference table", plain],
    ["object streams and a compressed cross-reference stream with a PNG predictor", compact],
  ])("reads a file with %s", (_, make) => {
    const pdf = HxPdf.read(make());
    expect(pdf.repaired).toBe(false);
    expect(pdf.info()).toMatchObject({ title: "Fixture", pages: 3, form: true, encrypted: false });
    // MediaBox and Resources come from the page tree.
    expect(pdf.pages()[1]?.inherited.has("MediaBox")).toBe(true);
    expect(hxPdfFields(pdf).map((field) => [field.name, field.type, field.value, field.pages])).toEqual([
      ["name", "text", "", [1]],
      ["id", "text", "A-1", [1]],
      ["zip", "text", "", [1]],
      ["agree", "checkbox", "Off", [1]],
      ["plan", "radio", "basic", [3]],
      ["city", "choice", "Beijing", [3]],
    ]);
    const city = hxPdfFields(pdf).find((field) => field.name === "city");
    expect(city?.options).toEqual(["Beijing", "Shanghai", "sz"]);
    expect(city?.labels).toEqual(["Beijing", "Shanghai", "Shenzhen"]);
  });

  it("rebuilds a damaged cross-reference by scanning the file", () => {
    const text = Buffer.from(plain()).toString("latin1");
    const badOffset = Buffer.from(text.replace(/startxref\n\d+/, "startxref\n999999"), "latin1");
    for (const damaged of [badOffset, withoutXref(plain())]) {
      const pdf = HxPdf.read(damaged);
      expect(pdf.repaired).toBe(true);
      expect(pdf.pages()).toHaveLength(3);
      expect(fieldValues(pdf).id).toBe("A-1");
    }
  });

  it("finds the pages that survive in a cut-off file", () => {
    const bytes = plain();
    const text = Buffer.from(bytes).toString("latin1");
    // Cut just after the last page object: the catalog and the page tree come later and are lost.
    const cut = bytes.subarray(0, text.indexOf("endobj", text.lastIndexOf("/Type /Page ")) + 6);
    const pdf = HxPdf.read(cut);
    expect(pdf.repaired).toBe(true);
    expect(pdf.pages().length).toBeGreaterThan(0);
  });

  it("refuses files that are not PDFs or have nothing left to read", () => {
    expect(errorCode(() => HxPdf.read(Buffer.from("hello")))).toBe("not-pdf");
    expect(errorCode(() => HxPdf.read(Buffer.from("%PDF-1.7\n1 0 obj\n<< >>\nendobj\n")))).toBe("damaged");
  });

  it("refuses values nested too deeply instead of running out of stack", () => {
    const deep = `${"[".repeat(5000)}${"]".repeat(5000)}`;
    const bytes = Buffer.from(
      `%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /X ${deep} >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
    );
    expect(["damaged"]).toContain(errorCode(() => HxPdf.read(bytes)));
  });

  it("decodes text strings in PDFDocEncoding, UTF-16 and UTF-8", () => {
    expect(new PdfString(Buffer.from([0x80, 0x41, 0x92])).text()).toBe("•A™");
    expect(PdfString.text("王强").text()).toBe("王强");
    expect(new PdfString(Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("é")])).text()).toBe("é");
    expect(PdfString.text("plain").bytes).toEqual(Buffer.from("plain"));
  });

  it("writes names, strings and numbers as PDF text", () => {
    expect(pdfText(new PdfName("A B#/"))).toBe("/A#20B#23#2f");
    expect(pdfText(new PdfString(Buffer.from("a(b)\\c")))).toBe("(a\\(b\\)\\\\c)");
    expect(pdfText(new PdfString(Buffer.from([0, 255])))).toBe("<00ff>");
    expect(pdfText([1, 0.5, -0, 1 / 3, true, null])).toBe("[1 0.5 0 0.333333 true null]");
  });
});

describe("page ranges", () => {
  it("reads lists, ranges, open ends, reverse ranges and Chinese punctuation", () => {
    expect(parsePageRanges("1-3,5", 9)).toEqual([0, 1, 2, 4]);
    expect(parsePageRanges("8-", 9)).toEqual([7, 8]);
    expect(parsePageRanges("-2", 9)).toEqual([0, 1]);
    expect(parsePageRanges("3-1", 9)).toEqual([2, 1, 0]);
    expect(parsePageRanges("1，3 到 4", 9)).toEqual([0, 2, 3]);
    expect(parsePageRanges("last", 9)).toEqual([8]);
    expect(parsePageRanges("", 3)).toEqual([0, 1, 2]);
    for (const bad of ["0", "10", "a", "1-x", ","]) expect(errorCode(() => parsePageRanges(bad, 9))).toBe("invalid");
  });
});

describe("splitting and merging", () => {
  it("copies only what the chosen pages use, and cuts links to pages left out", () => {
    const source = HxPdf.read(plain());
    const bytes = hxPdfCopyPages([{ pdf: source, pages: [0] }]);
    const pdf = HxPdf.read(bytes);
    expect(pdf.repaired).toBe(false);
    expect(pdf.pages()).toHaveLength(1);
    expect(pdfText(pdf.pages()[0]?.dict.get("MediaBox") ?? null)).toBe("[0 0 612 792]");
    expect(links(pdf, 0)).toEqual(["[null /Fit]"]);
    // The fields of page 1 only.
    expect(hxPdfFields(pdf).map((field) => field.name)).toEqual(["name", "id", "zip", "agree"]);
    expect(pdf.objectNumbers().length).toBeLessThan(source.objectNumbers().length);
  });

  it("keeps a link to a page that is copied too, pointing at the copy", () => {
    const pdf = HxPdf.read(hxPdfCopyPages([{ pdf: HxPdf.read(plain()), pages: [0, 2] }]));
    const last = pdf.pages()[1]?.ref?.num;
    expect(links(pdf, 0)).toEqual([`[${last} 0 R /Fit]`]);
  });

  it("merges files, renaming fields of the same name and adding a bookmark for each file", () => {
    const merged = HxPdf.read(
      hxPdfCopyPages(
        [
          { pdf: HxPdf.read(plain()), pages: [0, 1, 2], title: "First" },
          { pdf: HxPdf.read(compact()), pages: [2, 0], title: "第二份" },
        ],
        { bookmarks: true, title: "Merged" },
      ),
    );
    expect(merged.info()).toMatchObject({ pages: 5, title: "Merged" });
    expect(hxPdfFields(merged).map((field) => field.name)).toEqual([
      "name",
      "id",
      "zip",
      "agree",
      "plan",
      "city",
      "name_2",
      "id_2",
      "zip_2",
      "agree_2",
      "plan_2",
      "city_2",
    ]);
    const outlines = merged.dict(merged.catalog().get("Outlines"));
    const first = merged.dict(outlines?.get("First"));
    const second = merged.dict(first?.get("Next"));
    expect(
      [first?.get("Title"), second?.get("Title")].map((title) => (title instanceof PdfString ? title.text() : "")),
    ).toEqual(["First", "第二份"]);
  });

  it("refuses encrypted files and pages that do not exist", () => {
    const encrypted = HxPdf.read(pdfFixture([["x"]], { encryptMarker: true }));
    expect(encrypted.encrypted).toBe(true);
    expect(errorCode(() => hxPdfCopyPages([{ pdf: encrypted, pages: [0] }]))).toBe("encrypted");
    expect(errorCode(() => hxPdfCopyPages([{ pdf: HxPdf.read(plain()), pages: [3] }]))).toBe("invalid");
    expect(errorCode(() => hxPdfCopyPages([]))).toBe("invalid");
  });
});

describe("filling forms", () => {
  it.each([
    ["a cross-reference table", plain],
    ["a cross-reference stream", compact],
  ])("fills every kind of field in a file with %s, appending the change", (_, make) => {
    const bytes = make();
    const { bytes: filled, filled: names } = hxPdfFill(HxPdf.read(bytes), {
      name: "王强 Wang",
      agree: true,
      plan: "pro",
      city: "Shenzhen",
      zip: "12345",
    });
    expect(names).toEqual(["name", "agree", "plan", "city", "zip"]);
    // The original bytes stay first and unchanged.
    expect(Buffer.compare(filled.subarray(0, bytes.length), Buffer.from(bytes))).toBe(0);
    const pdf = HxPdf.read(filled);
    expect(pdf.repaired).toBe(false);
    expect(fieldValues(pdf)).toEqual({
      name: "王强 Wang",
      id: "A-1",
      zip: "12345",
      agree: "Yes",
      plan: "pro",
      city: "sz",
    });
    const form = pdf.dict(pdf.catalog().get("AcroForm"));
    expect(form?.get("NeedAppearances")).toBe(true);
    // Each radio button shows on or off.
    const plan = hxPdfFields(pdf).find((field) => field.name === "plan");
    expect(plan?.value).toBe("pro");
    // A second fill appends again and keeps the first.
    const again = hxPdfFill(pdf, { agree: false });
    expect(Buffer.compare(again.bytes.subarray(0, filled.length), filled)).toBe(0);
    expect(fieldValues(HxPdf.read(again.bytes))).toMatchObject({ name: "王强 Wang", agree: "Off" });
  });

  it("fills a file whose cross-reference was rebuilt, with an update that stands alone", () => {
    const pdf = HxPdf.read(withoutXref(plain()));
    expect(pdf.repaired).toBe(true);
    const filled = HxPdf.read(hxPdfFill(pdf, { name: "x" }).bytes);
    expect(filled.repaired).toBe(false);
    expect(fieldValues(filled).name).toBe("x");
    expect(filled.pages()).toHaveLength(3);
  });

  it("refuses read-only fields, values that do not fit, unknown fields and encrypted files", () => {
    const pdf = HxPdf.read(plain());
    expect(errorCode(() => hxPdfFill(pdf, { id: "x" }))).toBe("invalid");
    expect(errorCode(() => hxPdfFill(pdf, { zip: "123456" }))).toBe("invalid");
    expect(errorCode(() => hxPdfFill(pdf, { city: "Tokyo" }))).toBe("invalid");
    expect(errorCode(() => hxPdfFill(pdf, { plan: "gold" }))).toBe("invalid");
    expect(errorCode(() => hxPdfFill(pdf, { nope: "x" }))).toBe("invalid");
    expect(errorCode(() => hxPdfFill(HxPdf.read(pdfFixture([["x"]])), { name: "x" }))).toBe("invalid");
    expect(
      errorCode(() => hxPdfFill(HxPdf.read(pdfFixture([["x"]], { form: true, encryptMarker: true })), { name: "x" })),
    ).toBe("encrypted");
  });
});

describe("damaged and hostile files", () => {
  it("throws only HXBot's own errors for cut or changed bytes, and never hangs", () => {
    let seed = 17;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const started = performance.now();
    for (const bytes of [plain(), compact()]) {
      for (let round = 0; round < 250; round += 1) {
        const copy = Uint8Array.from(
          bytes.subarray(0, round % 3 === 0 ? Math.floor(random() * bytes.length) : bytes.length),
        );
        for (let flips = 0; flips < 4; flips += 1)
          copy[Math.floor(random() * copy.length)] = Math.floor(random() * 256);
        try {
          const pdf = HxPdf.read(copy);
          if (pdf.encrypted) continue;
          hxPdfFields(pdf);
          hxPdfCopyPages([{ pdf, pages: [0] }]);
          hxPdfFill(pdf, { name: "x" });
        } catch (error) {
          expect(error).toBeInstanceOf(HxPdfError);
        }
      }
    }
    expect(performance.now() - started).toBeLessThan(30_000);
  });

  it("stops at a page tree that points back at itself", () => {
    const bytes = Buffer.from(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>\nendobj\ntrailer\n<< /Root 1 0 R /Size 4 >>\n%%EOF\n",
    );
    expect(HxPdf.read(bytes).pages()).toHaveLength(1);
  });

  it("reads a stream whose length is wrong", () => {
    const content = deflateSync(Buffer.from("BT /F1 12 Tf 10 10 Td (x) Tj ET"));
    const bytes = Buffer.concat([
      Buffer.from(
        "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Filter /FlateDecode /Length 9999 >>\nstream\n",
      ),
      content,
      Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 5 >>\n%%EOF\n"),
    ]);
    const pdf = HxPdf.read(bytes);
    const stream = pdf.resolve(pdf.pages()[0]?.dict.get("Contents"));
    expect(stream && typeof stream === "object" && "raw" in stream ? pdf.decode(stream).toString() : "").toContain(
      "(x) Tj",
    );
  });
});
