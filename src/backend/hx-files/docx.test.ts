import { describe, expect, it } from "vitest";
import { HxDocument } from "./docx";
import { docxFixture } from "./office-fixtures";
import { HxOfficeError } from "./ooxml";
import { HxXmlError } from "./xml";
import { HxZipError } from "./zip";

function doc(): Uint8Array {
  return docxFixture(
    [
      { runs: ["Report"], style: "Heading1" },
      { runs: ["Revenue grew ", "by 12", " percent."] },
      { runs: ["Second ", "para", "."] },
    ],
    [
      ["h1", "h2"],
      ["v1", "v2"],
    ],
  );
}

function texts(document: HxDocument): string[] {
  return document
    .paragraphs()
    .map((p) => `${p.style ?? "-"}|${p.text}${p.cell ? `@${p.cell.row},${p.cell.col}` : ""}${p.revisions ? "*" : ""}`);
}

function body(document: HxDocument): string {
  return document.pkg.xml("word/document.xml").root.toString();
}

function errorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof HxOfficeError) return error.code;
    throw error;
  }
  return "none";
}

const ORIGINAL = [
  "Heading1|Report",
  "-|Revenue grew by 12 percent.",
  "-|Second para.",
  "-|h1@0,0",
  "-|h2@0,1",
  "-|v1@1,0",
  "-|v2@1,1",
  "-|After the table.",
];

describe("reading a document", () => {
  it("writes an unchanged document back byte for byte", () => {
    const bytes = doc();
    expect(Buffer.from(HxDocument.read(bytes).toBytes()).equals(Buffer.from(bytes))).toBe(true);
  });

  it("reads paragraphs across runs, with their styles and table cells", () => {
    const document = HxDocument.read(doc());
    expect(texts(document)).toEqual(ORIGINAL);
    expect(document.tables()).toEqual([
      {
        index: 0,
        rows: [
          ["h1", "h2"],
          ["v1", "v2"],
        ],
      },
    ]);
  });

  it("refuses a file that is not a Word document", () => {
    expect(() => HxDocument.read(Uint8Array.from([1, 2, 3]))).toThrow();
  });
});

describe("finding and replacing", () => {
  it("replaces text that runs across several runs", () => {
    const document = HxDocument.read(doc());
    expect(document.replace("grew by 12", "rose by 15")).toEqual({ count: 1, paragraphs: [1] });
    expect(texts(HxDocument.read(document.toBytes()))[1]).toBe("-|Revenue rose by 15 percent.");
  });

  it("ignores case unless asked, and finds nothing when the case differs", () => {
    expect(HxDocument.read(doc()).replace("REVENUE", "Income").count).toBe(1);
    expect(HxDocument.read(doc()).replace("REVENUE", "x", { matchCase: true }).count).toBe(0);
  });

  it("replaces every occurrence once, also when the new text contains the old one", () => {
    const document = HxDocument.read(doc());
    expect(document.replace("e", "ee", { all: true }).count).toBe(11);
    expect(texts(document)[1]).toBe("-|Reeveenuee greew by 12 peerceent.");
  });

  it("keeps tabs, line breaks and special characters", () => {
    const document = HxDocument.read(doc());
    document.setParagraph(2, "Tab\there & <there>\nnext line");
    const again = HxDocument.read(document.toBytes());
    expect(again.paragraphs()[2]?.text).toBe("Tab\there & <there>\nnext line");
    expect(body(again)).toContain("<w:tab/>");
    expect(body(again)).toContain("<w:br/>");
  });

  it("refuses an empty search text", () => {
    expect(errorCode(() => HxDocument.read(doc()).replace("", "x"))).toBe("invalid");
  });
});

describe("tracked changes", () => {
  it("records a replacement as a deletion and an insertion by HXBot", () => {
    const document = HxDocument.read(doc());
    document.replace("by 12", "by 15", { track: true, date: new Date("2026-01-01T00:00:00Z") });
    const xml = body(document);
    expect(xml).toMatch(/<w:del [^>]*w:author="HXBot"[^>]*w:date="2026-01-01T00:00:00Z"/);
    expect(xml).toContain("<w:delText");
    expect(xml).toMatch(/<w:ins [^>]*w:author="HXBot"/);
    expect(document.revisionCount()).toBe(2);
  });

  it("accepts and rejects tracked replacements, insertions and deletions", () => {
    const document = HxDocument.read(doc());
    document.replace("by 12", "by 15", { track: true });
    document.insertParagraph(2, "New para", "Heading1", { track: true });
    document.deleteParagraph(1, { track: true });
    // One w:pPr per paragraph, even when the new paragraph has a style and a revision mark (a second one is
    // invalid, and Word reads only one of them).
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    for (const p of document.pkg.xml("word/document.xml").root.descendants(W, "p"))
      expect(p.childrenNamed(W, "pPr").length).toBeLessThanOrEqual(1);
    const tracked = document.toBytes();
    const accepted = HxDocument.read(tracked);
    expect(accepted.resolveRevisions(true)).toBeGreaterThan(0);
    expect(texts(HxDocument.read(accepted.toBytes()))).toEqual([
      "Heading1|Report",
      "-|Second para.",
      "Heading1|New para",
      ...ORIGINAL.slice(3),
    ]);
    const rejected = HxDocument.read(tracked);
    rejected.resolveRevisions(false);
    expect(texts(HxDocument.read(rejected.toBytes()))).toEqual(ORIGINAL);
    // Resolving leaves no empty properties behind.
    expect(body(accepted)).not.toContain("<w:rPr></w:rPr>");
    expect(body(accepted)).not.toContain("<w:rPr/>");
  });

  it("deletes and inserts without tracking when not asked to track", () => {
    const document = HxDocument.read(doc());
    document.deleteParagraph(2);
    document.insertParagraph(-1, "First");
    expect(document.revisionCount()).toBe(0);
    expect(texts(document).slice(0, 3)).toEqual(["-|First", "Heading1|Report", "-|Revenue grew by 12 percent."]);
  });
});

describe("styles, formatting and tables", () => {
  it("resolves style ids, names and Chinese names, adding built-in styles", () => {
    const document = HxDocument.read(doc());
    expect(document.setStyle(1, "标题 1")).toBe("Heading1");
    expect(document.setStyle(2, "Quote")).toBe("Quote");
    expect(document.resolveStyle("heading 2")).toBe("Heading2");
    expect(document.pkg.xml("word/styles.xml").root.toString()).toContain('w:styleId="Quote"');
    expect(errorCode(() => document.setStyle(0, "NoSuchStyle"))).toBe("invalid");
  });

  it("writes run properties in the order the schema requires", () => {
    const document = HxDocument.read(doc());
    document.format(1, { bold: true, size: 14, color: "FF0000", font: "Arial", italic: true, underline: true });
    const rPr = /<w:rPr>(.*?)<\/w:rPr>/.exec(body(document))?.[1] ?? "";
    const order = ["rFonts", "b", "i", "color", "sz", "u"].map((name) => rPr.indexOf(`<w:${name}`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("changes cells, adds rows and inserts tables", () => {
    const document = HxDocument.read(doc());
    document.setCell(0, 1, 1, "V2!");
    expect(document.addRow(0, ["r3a", "r3b"])).toBe(2);
    expect(
      document.insertTable(1, [
        ["x", "y"],
        ["1", "2"],
      ]),
    ).toBe(0);
    const again = HxDocument.read(document.toBytes());
    expect(again.tables().map((table) => table.rows)).toEqual([
      [
        ["x", "y"],
        ["1", "2"],
      ],
      [
        ["h1", "h2"],
        ["v1", "V2!"],
        ["r3a", "r3b"],
      ],
    ]);
  });

  it("names what it cannot find", () => {
    const document = HxDocument.read(doc());
    expect(errorCode(() => document.setParagraph(99, "x"))).toBe("invalid");
    expect(errorCode(() => document.deleteParagraph(-1))).toBe("invalid");
    expect(errorCode(() => document.setCell(5, 0, 0, "x"))).toBe("invalid");
    expect(errorCode(() => document.setCell(0, 9, 0, "x"))).toBe("invalid");
    expect(errorCode(() => document.insertTable(0, []))).toBe("invalid");
  });
});

describe("large and damaged documents", () => {
  it("replaces in a document of 5,000 paragraphs quickly", () => {
    const paragraphs = Array.from({ length: 5000 }, (_, index) => ({
      runs: [`Paragraph ${index} has `, "some", " text."],
    }));
    const document = HxDocument.read(docxFixture(paragraphs));
    const started = performance.now();
    expect(document.replace("some text", "other words", { all: true }).count).toBe(5000);
    expect(HxDocument.read(document.toBytes()).paragraphs()[4999]?.text).toBe("Paragraph 4999 has other words.");
    expect(performance.now() - started).toBeLessThan(20_000);
  });

  it("throws only HXBot's own errors for cut or changed bytes", () => {
    const bytes = doc();
    let seed = 11;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let round = 0; round < 300; round += 1) {
      const copy = Uint8Array.from(
        bytes.subarray(0, round % 3 === 0 ? Math.floor(random() * bytes.length) : bytes.length),
      );
      for (let flips = 0; flips < 3; flips += 1) copy[Math.floor(random() * copy.length)] = Math.floor(random() * 256);
      try {
        const document = HxDocument.read(copy);
        document.paragraphs();
        document.replace("e", "x", { all: true });
        document.toBytes();
      } catch (error) {
        expect(error instanceof HxOfficeError || error instanceof HxZipError || error instanceof HxXmlError).toBe(true);
      }
    }
  });
});
