import { describe, expect, it } from "vitest";
import { alignRuns, HX_DIFF_LIMITS, hxDecodeText, hxDiffFiles, similarity } from "./diff";
import { HxDocument } from "./docx";
import { docxFixture, PNG_2X1, pdfFixture, pptxFixture, xlsxFixture } from "./office-fixtures";
import { HxPdf, hxPdfCopyPages, hxPdfFill } from "./pdf";
import { HxPresentation } from "./pptx";
import { HxWorkbook } from "./xlsx";

const text = (value: string) => Uint8Array.from(Buffer.from(value, "utf8"));

describe("ART-05 acceptance: the diff names exactly what changed", () => {
  it("lists the three cells changed in a workbook, with sheet, cell, old and new value", async () => {
    const before = xlsxFixture([
      {
        name: "Data",
        rows: [
          ["Item", "Qty"],
          ["A", 2],
          ["B", { f: "B2*2", v: 4 }],
        ],
      },
      { name: "Notes", rows: [["keep"]] },
    ]);
    const wb = HxWorkbook.read(before);
    wb.set("Data", [
      { ref: "A2", input: "Apple" },
      { ref: "C1", input: "New" },
    ]);
    wb.set("Notes", [{ ref: "A1", input: null }]);
    const diff = await hxDiffFiles("book.xlsx", before, wb.toBytes());
    expect(diff.kind).toBe("sheet");
    expect(diff.cells).toEqual([
      { sheet: "Data", cell: "C1", old: "", new: "New" },
      { sheet: "Data", cell: "A2", old: "A", new: "Apple" },
      { sheet: "Notes", cell: "A1", old: "keep", new: "" },
    ]);
    expect(diff.counts).toEqual({ added: 1, removed: 1, changed: 1 });
  });

  it("shows a formula's new result as part of the change", async () => {
    const before = xlsxFixture([{ name: "S", rows: [[2, { f: "A1*2", v: 4 }]] }]);
    const wb = HxWorkbook.read(before);
    wb.set("S", [{ ref: "A1", input: 5 }]);
    const diff = await hxDiffFiles("x.xlsx", before, wb.toBytes());
    expect(diff.cells).toEqual([
      { sheet: "S", cell: "A1", old: "2", new: "5" },
      { sheet: "S", cell: "B1", old: "=A1*2 → 4", new: "=A1*2 → 10" },
    ]);
  });

  it("lists the one paragraph changed in a document", async () => {
    const before = docxFixture([
      { runs: ["Title"], style: "Heading1" },
      { runs: ["Revenue grew by 12 percent."] },
      { runs: ["Last."] },
    ]);
    const document = HxDocument.read(before);
    document.replace("12", "15");
    const diff = await hxDiffFiles("report.docx", before, document.toBytes());
    expect(diff.kind).toBe("document");
    expect(diff.blocks).toEqual([
      {
        kind: "changed",
        oldNumber: 2,
        newNumber: 2,
        old: "Revenue grew by 12 percent.",
        new: "Revenue grew by 15 percent.",
        details: [],
      },
    ]);
  });

  it("pairs a rewritten paragraph with its old text, not with a paragraph inserted before it", async () => {
    const before = docxFixture([
      { runs: ["Intro"] },
      { runs: ["The second paragraph says this."] },
      { runs: ["To delete."] },
      { runs: ["End"] },
    ]);
    const document = HxDocument.read(before);
    document.insertParagraph(0, "A brand new paragraph.");
    document.setParagraph(2, "The second paragraph now says that.");
    document.deleteParagraph(3);
    const diff = await hxDiffFiles("x.docx", before, document.toBytes());
    expect(diff.blocks?.map((block) => [block.kind, block.oldNumber, block.newNumber])).toEqual([
      ["added", null, 2],
      ["changed", 2, 3],
      ["removed", 3, null],
    ]);
  });

  it("lists the one slide changed in a presentation, and sees moves, additions and deletions", async () => {
    const before = pptxFixture([{ title: "One" }, { title: "Two", body: "x" }, { title: "Three", body: "y" }]);
    const changed = HxPresentation.read(before);
    changed.setText(1, "body", "x and more");
    const one = await hxDiffFiles("deck.pptx", before, changed.toBytes());
    expect(one.kind).toBe("slides");
    expect(one.blocks?.map((block) => [block.kind, block.oldNumber, block.newNumber, block.details])).toEqual([
      ["changed", 2, 2, ["Content Placeholder 2: x → x and more"]],
    ]);
    const reordered = HxPresentation.read(before);
    reordered.moveSlide(2, 0);
    reordered.addSlide({ title: "Four" });
    reordered.deleteSlide(1);
    const many = await hxDiffFiles("deck.pptx", before, reordered.toBytes());
    expect(many.blocks?.map((block) => [block.kind, block.old || block.new])).toEqual([
      ["moved", "Three"],
      ["removed", "One"],
      ["added", "Four"],
    ]);
  });

  it("says file level only for a format without a structured diff, never an empty diff", async () => {
    for (const [name, before, after] of [
      ["picture.png", PNG_2X1, Uint8Array.from([...PNG_2X1, 0])],
      ["slides.key", Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 4])],
      ["archive.zip", Uint8Array.from([0x50, 0x4b, 3, 4]), Uint8Array.from([0x50, 0x4b, 3, 4, 0])],
    ] as const) {
      const diff = await hxDiffFiles(name, before, after);
      expect(diff.kind).toBe("file");
      expect(diff.fileOnly).toBe("unsupported");
      expect(diff.summary).toMatch(/^File level only: size \d+ → \d+ bytes, SHA-256 [0-9a-f]{12} → [0-9a-f]{12}\.$/);
      expect(diff.counts.changed).toBe(1);
    }
  });
});

describe("text", () => {
  it("gives unified hunks and counts", async () => {
    const before = text("a\nb\nc\nd\ne\nf\ng\nh\n");
    const after = text("a\nb\nC\nd\ne\nf\ng\nh\ni\n");
    const diff = await hxDiffFiles("notes.md", before, after);
    expect(diff.kind).toBe("text");
    expect(diff.counts).toEqual({ added: 2, removed: 1, changed: 0 });
    // Changes six lines apart or closer share one hunk, as in a unified diff with three lines of context.
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks?.[0]?.lines.filter((line) => line.kind !== " ")).toEqual([
      { kind: "-", text: "c" },
      { kind: "+", text: "C" },
      { kind: "+", text: "i" },
    ]);
  });

  it("sees a change of line endings only as no change of text, but still a change of file", async () => {
    const diff = await hxDiffFiles("a.txt", text("x\ny\n"), text("x\r\ny\r\n"));
    expect(diff.identical).toBe(false);
    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 0 });
    expect(diff.summary).toContain("line endings");
    expect(diff.summary).toContain("File: 4 → 6 bytes.");
  });

  it("reads UTF-16 and GB18030 text, and compares unknown extensions as text only when they are text", async () => {
    expect(hxDecodeText(Uint8Array.from([0xff, 0xfe, 0x41, 0, 0x42, 0]))).toBe("AB");
    expect(hxDecodeText(Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]))).toBe("中文");
    expect(hxDecodeText(Uint8Array.from([0, 1, 2]))).toBeNull();
    expect((await hxDiffFiles("Makefile", text("a\n"), text("b\n"))).kind).toBe("text");
    expect((await hxDiffFiles("data.bin", Uint8Array.from([0, 1]), Uint8Array.from([0, 2]))).kind).toBe("file");
  });

  it("cuts long hunks and says so, keeping the counts whole", async () => {
    const before = Array.from({ length: 5000 }, (_, index) => `line ${index}`).join("\n");
    const after = Array.from({ length: 5000 }, (_, index) => `LINE ${index}`).join("\n");
    const diff = await hxDiffFiles("big.txt", text(before), text(after));
    expect(diff.truncated).toBe(true);
    expect(diff.counts).toEqual({ added: 5000, removed: 5000, changed: 0 });
    expect(diff.hunks?.reduce((total, hunk) => total + hunk.lines.length, 0)).toBe(HX_DIFF_LIMITS.maxHunkLines);
  });
});

describe("new, deleted, equal and damaged files", () => {
  it("diffs a new file and a deleted one of each kind", async () => {
    const book = xlsxFixture([{ name: "S", rows: [[1, 2]] }]);
    const deck = pptxFixture([{ title: "A" }, { title: "B" }]);
    expect((await hxDiffFiles("x.xlsx", null, book)).counts).toEqual({ added: 2, removed: 0, changed: 0 });
    expect((await hxDiffFiles("x.pptx", deck, null)).counts).toEqual({ added: 0, removed: 2, changed: 0 });
    const made = await hxDiffFiles("x.txt", null, text("a\nb\n"));
    expect([made.before, made.after?.size, made.counts.added]).toEqual([null, 4, 2]);
  });

  it("says identical for the same bytes", async () => {
    const book = xlsxFixture([{ name: "S", rows: [[1]] }]);
    const diff = await hxDiffFiles("x.xlsx", book, Uint8Array.from(book));
    expect(diff).toMatchObject({ identical: true, kind: "file", counts: { added: 0, removed: 0, changed: 0 } });
  });

  it("falls back to file level for a damaged Office file or PDF", async () => {
    const book = xlsxFixture([{ name: "S", rows: [[1]] }]);
    for (const name of ["x.xlsx", "x.docx", "x.pptx", "x.pdf"]) {
      const diff = await hxDiffFiles(name, book.subarray(0, 40), book);
      expect([diff.kind, diff.fileOnly]).toEqual(["file", "unreadable"]);
    }
  });

  it("cuts a long list of cells and keeps the counts whole", async () => {
    const before = xlsxFixture([{ name: "S", rows: [[1]] }]);
    const wb = HxWorkbook.read(before);
    wb.set(
      "S",
      Array.from({ length: 700 }, (_, index) => ({ ref: `B${index + 1}`, input: index })),
    );
    const diff = await hxDiffFiles("x.xlsx", before, wb.toBytes());
    expect(diff.truncated).toBe(true);
    expect(diff.cells).toHaveLength(HX_DIFF_LIMITS.maxCells);
    expect(diff.counts.added).toBe(700);
  });
});

describe("PDF", () => {
  const pages = [["Hello page 1"], ["Page two"], ["Page three"]];

  it("lists filled form fields", async () => {
    const before = pdfFixture(pages, { form: true });
    const after = hxPdfFill(HxPdf.read(before), { name: "王强", agree: true }).bytes;
    const diff = await hxDiffFiles("form.pdf", before, after);
    expect(diff.kind).toBe("pdf");
    expect(diff.fields).toEqual([
      { name: "name", old: "", new: "王强" },
      { name: "agree", old: "Off", new: "Yes" },
    ]);
    expect(diff.blocks).toEqual([]);
  });

  it("lists pages removed by an extract", async () => {
    const before = pdfFixture(pages);
    const after = hxPdfCopyPages([{ pdf: HxPdf.read(before), pages: [2] }]);
    const diff = await hxDiffFiles("x.pdf", before, after);
    expect(diff.blocks?.map((block) => [block.kind, block.old])).toEqual([
      ["removed", "Hello page 1"],
      ["removed", "Page two"],
    ]);
  });
});

describe("pairing blocks", () => {
  it("measures how alike two texts are", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("night", "nacht")).toBeCloseTo(0.25, 5);
    expect(similarity("", "a")).toBe(0);
    expect(similarity("第二段：普通文字", "第二段改写了")).toBeGreaterThan(0.2);
  });

  it("pairs in order, best total first, and pairs the rest by position when the counts match", () => {
    const old = ["The quarterly report", "Unrelated words"];
    const now = ["A new heading", "The quarterly report v2"];
    const steps = alignRuns([0, 1], [0, 1], (i, j) => similarity(old[i] ?? "", now[j] ?? ""));
    expect(steps).toEqual([
      { old: null, new: 0 },
      { old: 0, new: 1 },
      { old: 1, new: null },
    ]);
    expect(alignRuns([0], [0], () => 0)).toEqual([{ old: 0, new: 0 }]);
  });

  it("pairs by position when the run is too large to align", () => {
    const big = Array.from({ length: 600 }, (_, index) => index);
    const steps = alignRuns(big, big.slice(0, 500), () => 1);
    expect(steps).toHaveLength(600);
    expect(steps[599]).toEqual({ old: 599, new: null });
  });
});
