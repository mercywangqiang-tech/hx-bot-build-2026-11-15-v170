// HXBot v1.7.4（CU-07）：Office Open XML 包（.xlsx、.docx、.pptx 共用的那一层）。
// 包里每个部件有自己的内容类型（[Content_Types].xml），部件之间靠关系（_rels/*.rels）连起来。这里只做
// 这一层：读写部件、找关系、加新部件时补上内容类型和关系。表格、文档、演示各自的内容在 xlsx.ts 等文件里。
import { type HxXmlDocument, type HxXmlElement, parseXml, parseXmlBytes, xmlElement } from "./xml";
import { HxZip, type HxZipLimits } from "./zip";

export const NS = {
  contentTypes: "http://schemas.openxmlformats.org/package/2006/content-types",
  packageRels: "http://schemas.openxmlformats.org/package/2006/relationships",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  sheet: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  word: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  slide: "http://schemas.openxmlformats.org/presentationml/2006/main",
  drawing: "http://schemas.openxmlformats.org/drawingml/2006/main",
  chart: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  sheetDrawing: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
  picture: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
} as const;

const REL_BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
export const REL = {
  officeDocument: `${REL_BASE}officeDocument`,
  worksheet: `${REL_BASE}worksheet`,
  sharedStrings: `${REL_BASE}sharedStrings`,
  styles: `${REL_BASE}styles`,
  calcChain: `${REL_BASE}calcChain`,
  table: `${REL_BASE}table`,
  drawing: `${REL_BASE}drawing`,
  chart: `${REL_BASE}chart`,
  image: `${REL_BASE}image`,
  slide: `${REL_BASE}slide`,
  slideLayout: `${REL_BASE}slideLayout`,
  slideMaster: `${REL_BASE}slideMaster`,
  notesSlide: `${REL_BASE}notesSlide`,
  notesMaster: `${REL_BASE}notesMaster`,
  hyperlink: `${REL_BASE}hyperlink`,
} as const;

export const CONTENT_TYPE = {
  worksheet: "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
  sharedStrings: "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml",
  drawing: "application/vnd.openxmlformats-officedocument.drawing+xml",
  chart: "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
  slide: "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
  notesSlide: "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
  wordStyles: "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
} as const;

export class HxOfficeError extends Error {
  readonly code: "not-office" | "damaged" | "unsupported" | "invalid";
  constructor(code: HxOfficeError["code"], message: string) {
    super(message);
    this.name = "HxOfficeError";
    this.code = code;
  }
}

export interface HxRelationship {
  id: string;
  type: string;
  /** The part it points to, as a zip name; for an external target, the address as written. */
  target: string;
  external: boolean;
}

/** The folder of a part, with a trailing slash, or "" for the root. */
function folderOf(part: string): string {
  const slash = part.lastIndexOf("/");
  return slash < 0 ? "" : part.slice(0, slash + 1);
}

/** The zip name of a relationship target, relative to the part that holds the relationship. */
export function resolveTarget(source: string, target: string): string {
  const raw = target.startsWith("/") ? target.slice(1) : `${folderOf(source)}${target}`;
  const out: string[] = [];
  for (const segment of decodeURIComponent(raw).split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

/** The target to write in the relationships of `source` for the part `part`. */
export function relativeTarget(source: string, part: string): string {
  const from = folderOf(source).split("/").filter(Boolean);
  const to = part.split("/");
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common += 1;
  return [...Array(from.length - common).fill(".."), ...to.slice(common)].join("/");
}

export function relsPartOf(part: string): string {
  return `${folderOf(part)}_rels/${part.slice(folderOf(part).length)}.rels`;
}

/** An Office package read from its bytes. Changed parts are written back on `toBytes`; the rest stays as it was. */
export class HxOoxml {
  readonly zip: HxZip;
  readonly #xml = new Map<string, HxXmlDocument>();
  /** Parts given whole by `setPart`: written even when their document did not change after. */
  readonly #fresh = new Set<string>();

  private constructor(zip: HxZip) {
    this.zip = zip;
  }

  static read(bytes: Uint8Array, limits?: HxZipLimits): HxOoxml {
    const zip = HxZip.read(bytes, limits);
    if (!zip.has("[Content_Types].xml")) throw new HxOfficeError("not-office", "The file is not an Office document.");
    return new HxOoxml(zip);
  }

  has(part: string): boolean {
    return this.zip.has(part);
  }

  /** The parsed XML of a part, kept so that changes to it are written back. */
  xml(part: string): HxXmlDocument {
    const cached = this.#xml.get(part);
    if (cached) return cached;
    if (!this.zip.has(part)) throw new HxOfficeError("damaged", `The document has no part ${part}.`);
    const doc = parseXmlBytes(this.zip.read(part));
    this.#xml.set(part, doc);
    return doc;
  }

  bytes(part: string): Uint8Array {
    return this.zip.read(part);
  }

  /** The main part (workbook.xml, document.xml, presentation.xml), from the package relationships. */
  mainPart(): string {
    const main = this.rels("").find((rel) => rel.type === REL.officeDocument || rel.type.endsWith("/officeDocument"));
    if (!main || !this.zip.has(main.target)) throw new HxOfficeError("damaged", "The document has no main part.");
    return main.target;
  }

  /** The relationships of a part ("" for the package). */
  rels(part: string): HxRelationship[] {
    const file = part === "" ? "_rels/.rels" : relsPartOf(part);
    if (!this.zip.has(file)) return [];
    const root = this.xml(file).root;
    const found: HxRelationship[] = [];
    for (const element of root.elements()) {
      if (element.local !== "Relationship") continue;
      const id = element.attr("Id");
      const type = element.attr("Type");
      const target = element.attr("Target");
      if (!id || !type || target === null) continue;
      const external = element.attr("TargetMode") === "External";
      found.push({ id, type, target: external ? target : resolveTarget(part, target), external });
    }
    return found;
  }

  relById(part: string, id: string): HxRelationship | null {
    return this.rels(part).find((rel) => rel.id === id) ?? null;
  }

  /**
   * Adds a relationship from `part` to `target` (a zip name, or a URL when external) and returns its id:
   * `options.id` when that id is free, else the first free rId<n>.
   */
  addRel(part: string, type: string, target: string, options: { id?: string; external?: boolean } = {}): string {
    const file = part === "" ? "_rels/.rels" : relsPartOf(part);
    if (!this.zip.has(file)) this.setPart(file, newXmlPart(`<Relationships xmlns="${NS.packageRels}"/>`));
    const root = this.xml(file).root;
    const used = new Set(root.elements().map((element) => element.attr("Id")));
    let id = options.id && !used.has(options.id) ? options.id : "";
    if (!id) {
      let number = used.size + 1;
      while (used.has(`rId${number}`)) number += 1;
      id = `rId${number}`;
    }
    const attrs: Record<string, string> = {
      Id: id,
      Type: type,
      Target: options.external ? target : relativeTarget(part, target),
    };
    if (options.external) attrs.TargetMode = "External";
    root.append(xmlElement(root.qname(NS.packageRels, "Relationship", "pr"), attrs));
    return id;
  }

  removeRel(part: string, id: string): void {
    const file = part === "" ? "_rels/.rels" : relsPartOf(part);
    if (!this.zip.has(file)) return;
    const root = this.xml(file).root;
    for (const element of root.elements()) if (element.attr("Id") === id) root.remove(element);
  }

  #types(): HxXmlElement {
    return this.xml("[Content_Types].xml").root;
  }

  contentType(part: string): string | null {
    const types = this.#types();
    for (const element of types.elements()) {
      if (element.local === "Override" && element.attr("PartName") === `/${part}`) return element.attr("ContentType");
    }
    const dot = part.lastIndexOf(".");
    const extension = dot < 0 ? "" : part.slice(dot + 1).toLowerCase();
    for (const element of types.elements()) {
      if (element.local === "Default" && element.attr("Extension")?.toLowerCase() === extension)
        return element.attr("ContentType");
    }
    return null;
  }

  /** Adds a part with an Override content type, or replaces its content. */
  setPart(part: string, content: HxXmlDocument | Uint8Array, contentType?: string): void {
    if (content instanceof Uint8Array) {
      this.#xml.delete(part);
      this.#fresh.delete(part);
      this.zip.set(part, content);
    } else {
      this.#xml.set(part, content);
      this.#fresh.add(part);
      this.zip.setText(part, "");
    }
    if (contentType) {
      const types = this.#types();
      const existing = types
        .elements()
        .find((element) => element.local === "Override" && element.attr("PartName") === `/${part}`);
      if (existing) existing.setAttr("ContentType", contentType);
      else
        types.append(
          xmlElement(types.qname(NS.contentTypes, "Override", "ct"), {
            PartName: `/${part}`,
            ContentType: contentType,
          }),
        );
    }
  }

  /** Makes sure files with this extension have a content type (images). */
  ensureDefault(extension: string, contentType: string): void {
    const types = this.#types();
    const known = types
      .elements()
      .some(
        (element) =>
          element.local === "Default" && element.attr("Extension")?.toLowerCase() === extension.toLowerCase(),
      );
    if (known) return;
    const firstOverride = types.elements().find((element) => element.local === "Override") ?? null;
    types.insertBefore(
      xmlElement(types.qname(NS.contentTypes, "Default", "ct"), { Extension: extension, ContentType: contentType }),
      firstOverride,
    );
  }

  /** Removes a part, its content type and its own relationships. */
  removePart(part: string): void {
    this.zip.delete(part);
    this.#xml.delete(part);
    this.#fresh.delete(part);
    const rels = relsPartOf(part);
    this.zip.delete(rels);
    this.#xml.delete(rels);
    this.#fresh.delete(rels);
    const types = this.#types();
    for (const element of types.elements()) {
      if (element.local === "Override" && element.attr("PartName") === `/${part}`) types.remove(element);
    }
  }

  /** Copies a part's current content (and its Override content type) to a new name; not its relationships. */
  copyPart(from: string, to: string): void {
    const cached = this.#xml.get(from);
    const content = cached ? cached.toBytes() : this.zip.read(from);
    const types = this.#types();
    const override = types
      .elements()
      .find((element) => element.local === "Override" && element.attr("PartName") === `/${from}`)
      ?.attr("ContentType");
    this.setPart(to, content, override ?? undefined);
  }

  /** Every part that the package reaches through relationships, from the package relationships on. */
  reachable(): Set<string> {
    const seen = new Set<string>();
    const queue = [""];
    for (let part = queue.pop(); part !== undefined; part = queue.pop()) {
      for (const rel of this.rels(part)) {
        if (rel.external || seen.has(rel.target) || !this.zip.has(rel.target)) continue;
        seen.add(rel.target);
        queue.push(rel.target);
      }
    }
    return seen;
  }

  /**
   * Removes each of `parts` that nothing reaches any more, and then what only those parts reached (a deleted
   * slide's notes, pictures and charts). Parts that something else still uses stay. Returns what was removed.
   */
  removeUnreachable(parts: Iterable<string>): string[] {
    const reachable = this.reachable();
    const removed: string[] = [];
    const done = new Set<string>();
    const queue = [...parts];
    for (let part = queue.pop(); part !== undefined; part = queue.pop()) {
      if (done.has(part)) continue;
      done.add(part);
      if (!this.zip.has(part) || reachable.has(part) || part.endsWith(".rels") || part === "[Content_Types].xml")
        continue;
      for (const rel of this.rels(part)) if (!rel.external) queue.push(rel.target);
      this.removePart(part);
      removed.push(part);
    }
    return removed;
  }

  /** The first free name `prefix<n>suffix`, such as xl/worksheets/sheet4.xml. */
  freeName(prefix: string, suffix: string): string {
    for (let number = 1; ; number += 1) {
      const name = `${prefix}${number}${suffix}`;
      if (!this.zip.has(name)) return name;
    }
  }

  /** The package with every changed part written back. */
  toBytes(): Uint8Array {
    for (const [part, doc] of this.#xml) {
      if (doc.changed || this.#fresh.has(part)) this.zip.set(part, doc.toBytes());
    }
    this.#fresh.clear();
    return this.zip.toBytes();
  }
}

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

/** A new XML part from its text, with the standard declaration. */
export function newXmlPart(rootText: string): HxXmlDocument {
  return parseXml(`${DECLARATION}${rootText}`);
}
