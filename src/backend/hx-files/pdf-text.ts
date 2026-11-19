// HXBot v1.7.4（CU-07 PDF 技能、ART-05 差异）：用 pdf.js 取每一页的文字。
// pdf.js 是浏览器里读 PDF 的那套代码，经得起坏文件和恶意文件；中文 PDF 没嵌字体时用它自带的 CMap 认字。
// 只取文字，不画页面，所以不需要 canvas。有打开密码的 PDF 返回 encrypted；只有权限密码的照常取文字。
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { HxPdf, HxPdfError, hxPdfCopyPages } from "./pdf";

export interface HxPdfText {
  pages: { page: number; text: string }[];
  /** All pages in the document, also those not read. */
  pageCount: number;
  /** The text was cut at `maxChars`, or the time ran out. */
  truncated: boolean;
  /** pdf.js could not read the file; its pages were rebuilt from what survives and read from that. */
  repaired: boolean;
}

function pdfjsFolder(): string {
  const require = createRequire(import.meta.url);
  return dirname(require.resolve("pdfjs-dist/package.json"));
}

/**
 * Reads the text of the given pages (from 0; all pages by default), page by page. Stops at `maxChars`
 * characters or when `signal` aborts, and says so with `truncated`.
 */
export async function hxPdfText(bytes: Uint8Array, options: HxPdfTextOptions = {}): Promise<HxPdfText> {
  try {
    return await readText(bytes, options, false);
  } catch (error) {
    if (!(error instanceof HxPdfError) || (error.code !== "not-pdf" && error.code !== "damaged")) throw error;
    // A file that pdf.js refuses may still have pages that HXBot's own reader finds by scanning it.
    let rebuilt: Buffer;
    try {
      const pdf = HxPdf.read(bytes);
      if (pdf.encrypted) throw error;
      rebuilt = hxPdfCopyPages([{ pdf, pages: pdf.pages().map((_, index) => index) }]);
    } catch {
      throw error;
    }
    return await readText(rebuilt, options, true);
  }
}

export interface HxPdfTextOptions {
  pages?: number[];
  maxChars?: number;
  signal?: AbortSignal;
  password?: string;
}

async function readText(bytes: Uint8Array, options: HxPdfTextOptions, repaired: boolean): Promise<HxPdfText> {
  const folder = pdfjsFolder();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    // pdf.js takes the buffer over; give it a copy so the caller's bytes stay usable.
    data: new Uint8Array(bytes),
    password: options.password,
    cMapUrl: `${join(folder, "cmaps")}/`,
    cMapPacked: true,
    standardFontDataUrl: `${join(folder, "standard_fonts")}/`,
    disableFontFace: true,
    wasmUrl: `${join(folder, "wasm")}/`,
    iccUrl: `${join(folder, "iccs")}/`,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const abort = () => {
    void task.destroy();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    let doc: Awaited<typeof task.promise>;
    try {
      doc = await task.promise;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "PasswordException")
        throw new HxPdfError(
          "encrypted",
          "The PDF needs a password to open. Ask the user for it, or for a copy without one.",
        );
      if (name === "InvalidPDFException") throw new HxPdfError("not-pdf", "The file is not a PDF that can be read.");
      throw new HxPdfError(
        "damaged",
        `The PDF could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const count = doc.numPages;
    const wanted = options.pages ?? Array.from({ length: count }, (_, index) => index);
    const maxChars = options.maxChars ?? 2_000_000;
    const pages: HxPdfText["pages"] = [];
    let total = 0;
    let truncated = false;
    for (const index of wanted) {
      if (options.signal?.aborted || total >= maxChars) {
        truncated = true;
        break;
      }
      if (!Number.isInteger(index) || index < 0 || index >= count)
        throw new HxPdfError("invalid", `The PDF has ${count} pages; there is no page ${index + 1}.`);
      const page = await doc.getPage(index + 1);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      page.cleanup();
      text = text.replace(/[ \t]+\n/g, "\n").trimEnd();
      if (total + text.length > maxChars) {
        text = text.slice(0, maxChars - total);
        truncated = true;
      }
      total += text.length;
      pages.push({ page: index + 1, text });
    }
    await doc.cleanup();
    return { pages, pageCount: count, truncated, repaired };
  } finally {
    options.signal?.removeEventListener("abort", abort);
    await task.destroy();
  }
}
