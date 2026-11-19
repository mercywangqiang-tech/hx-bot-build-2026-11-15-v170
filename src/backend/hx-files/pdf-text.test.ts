import { describe, expect, it } from "vitest";
import { pdfFixture } from "./office-fixtures";
import { HxPdfError } from "./pdf";
import { hxPdfText } from "./pdf-text";

const PAGES = [["Hello page 1", "(parens) \\ ok"], ["Page two"], ["Page three"]];

async function errorCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof HxPdfError) return error.code;
    throw error;
  }
  return "none";
}

describe("reading the text of a PDF", () => {
  it.each([
    ["a cross-reference table", false],
    ["object streams", true],
  ])("reads each page of a file with %s", async (_, objectStreams) => {
    const result = await hxPdfText(pdfFixture(PAGES, { objectStreams }));
    expect(result).toMatchObject({ pageCount: 3, truncated: false, repaired: false });
    expect(result.pages.map((page) => [page.page, page.text])).toEqual([
      [1, "Hello page 1\n(parens) \\ ok"],
      [2, "Page two"],
      [3, "Page three"],
    ]);
  });

  it("reads only the pages asked for", async () => {
    const result = await hxPdfText(pdfFixture(PAGES), { pages: [2, 0] });
    expect(result.pages.map((page) => page.page)).toEqual([3, 1]);
    expect(await errorCode(() => hxPdfText(pdfFixture(PAGES), { pages: [3] }))).toBe("invalid");
  });

  it("stops at the character limit and when cancelled, and says so", async () => {
    const limited = await hxPdfText(pdfFixture(PAGES), { maxChars: 15 });
    expect(limited.truncated).toBe(true);
    expect(limited.pages.map((page) => page.text).join("")).toHaveLength(15);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await hxPdfText(pdfFixture(PAGES), { signal: controller.signal });
    expect(cancelled.truncated).toBe(true);
    expect(cancelled.pages).toEqual([]);
  });

  it("rebuilds a file that pdf.js cannot open and reads that", async () => {
    const text = Buffer.from(pdfFixture(PAGES)).toString("latin1");
    const damaged = Buffer.from(`${text.slice(0, text.lastIndexOf("xref\n0 "))}%%EOF\n`, "latin1");
    const result = await hxPdfText(damaged);
    expect(result.pages.map((page) => page.text)).toEqual(["Hello page 1\n(parens) \\ ok", "Page two", "Page three"]);
  });

  it("refuses a file that is not a PDF, and keeps the caller's bytes", async () => {
    expect(await errorCode(() => hxPdfText(Buffer.from("not a pdf at all")))).toBe("not-pdf");
    const bytes = pdfFixture(PAGES);
    const copy = Uint8Array.from(bytes);
    await hxPdfText(bytes);
    expect(Buffer.compare(bytes, copy)).toBe(0);
  });
});
