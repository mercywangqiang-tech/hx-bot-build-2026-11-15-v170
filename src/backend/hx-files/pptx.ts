// HXBot v1.7.4（CU-07 演示技能）：直接读写 .pptx，不打开 PowerPoint 或 WPS。
// 读：每一页的版式、标题、各个文本框的文字、图片数、备注。写：按版式加页、删页（连同备注页和只有它用的图片、图表）、
// 移动和复制页（节里的页号一起改）、改标题、正文和备注、换版式（占位符按类型对上）、插入和替换图片（按图片自身的长宽比）。
// Keynote 的 .key 不是这种格式，走应用路线。
import { CONTENT_TYPE, HxOfficeError, HxOoxml, NS, newXmlPart, REL } from "./ooxml";
import { escapeAttr, escapeText, type HxXmlElement, HxXmlText, xmlElement } from "./xml";

const P = NS.slide;
const A = NS.drawing;
const P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main";

/** Placeholder types that take the body text: a placeholder without a type is an object (body) place. */
const BODY_TYPES = ["body", "obj", "", "subTitle"];
/** Relationship targets that a copied slide shares with the original; everything else is copied. */
const SHARED_REL = /\/(image|slideLayout|slide|video|audio|media|hdphoto|notesMaster)$/;
/** Comments are not copied with a slide. */
const COMMENT_REL = /comments$|commentAuthors$/i;

export interface HxSlideShape {
  name: string;
  /** The placeholder type (title, body, ctrTitle, subTitle...), "" for a placeholder without one, null for a plain shape. */
  placeholder: string | null;
  text: string;
}

export interface HxSlide {
  index: number;
  id: number;
  part: string;
  layout: string;
  title: string;
  shapes: HxSlideShape[];
  pictures: number;
  /** The speaker notes. */
  notes: string;
}

export interface HxImage {
  bytes: Uint8Array;
  /** png, jpeg or gif, from the bytes themselves. */
  type: "png" | "jpeg" | "gif";
  width: number;
  height: number;
}

/** Reads the type and pixel size of a PNG, JPEG or GIF; throws for anything else. */
export function readImage(bytes: Uint8Array): HxImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { bytes, type: "png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { bytes, type: "gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) break;
      const marker = bytes[at + 1] ?? 0;
      // Fill bytes and markers without a length.
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      const length = view.getUint16(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { bytes, type: "jpeg", width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      }
      if (length < 2) break;
      at += 2 + length;
    }
  }
  throw new HxOfficeError("invalid", "The picture must be a PNG, JPEG or GIF file.");
}

const IMAGE_CONTENT_TYPES = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif" } as const;
const IMAGE_EXTENSIONS = { png: "png", jpeg: "jpeg", gif: "gif" } as const;

interface SlideEntry {
  id: number;
  rid: string;
  part: string;
  element: HxXmlElement;
}

interface LayoutInfo {
  part: string;
  name: string;
  type: string;
}

interface LayoutPlaceholder {
  type: string;
  idx: string | null;
  name: string;
  spPr: HxXmlElement | null;
}

/** A presentation read from its bytes. */
export class HxPresentation {
  readonly pkg: HxOoxml;
  readonly #part: string;

  private constructor(pkg: HxOoxml) {
    this.pkg = pkg;
    this.#part = pkg.mainPart();
    if (pkg.xml(this.#part).root.local !== "presentation")
      throw new HxOfficeError("not-office", "The file is not a PowerPoint presentation.");
  }

  static read(bytes: Uint8Array): HxPresentation {
    return new HxPresentation(HxOoxml.read(bytes));
  }

  get #presentation(): HxXmlElement {
    return this.pkg.xml(this.#part).root;
  }

  #idList(): HxXmlElement {
    const root = this.#presentation;
    let list = root.child(P, "sldIdLst");
    if (!list) {
      list = xmlElement(root.qname(P, "sldIdLst", "p"));
      const anchor = root.child(P, "sldSz") ?? root.child(P, "notesSz");
      root.insertBefore(list, anchor);
    }
    return list;
  }

  /** The slide parts in show order, with their ids. */
  #order(): SlideEntry[] {
    const found: SlideEntry[] = [];
    for (const element of this.#idList().childrenNamed(P, "sldId")) {
      const rid = element.attrNs(NS.r, "id") ?? "";
      const rel = this.pkg.relById(this.#part, rid);
      if (!rel || !this.pkg.has(rel.target)) continue;
      found.push({ id: Number(element.attr("id")), rid, part: rel.target, element });
    }
    return found;
  }

  size(): { cx: number; cy: number } {
    const sz = this.#presentation.child(P, "sldSz");
    return { cx: Number(sz?.attr("cx") ?? 12_192_000), cy: Number(sz?.attr("cy") ?? 6_858_000) };
  }

  #layoutOf(slidePart: string): LayoutInfo | null {
    const rel = this.pkg.rels(slidePart).find((item) => item.type === REL.slideLayout);
    if (!rel || !this.pkg.has(rel.target)) return null;
    const root = this.pkg.xml(rel.target).root;
    return { part: rel.target, name: root.child(P, "cSld")?.attr("name") ?? "", type: root.attr("type") ?? "" };
  }

  /** Every slide layout of the presentation, from its masters. */
  layouts(): LayoutInfo[] {
    const found: LayoutInfo[] = [];
    const masters = this.pkg.rels(this.#part).filter((rel) => rel.type === REL.slideMaster);
    for (const master of masters) {
      for (const rel of this.pkg.rels(master.target)) {
        if (rel.type !== REL.slideLayout || !this.pkg.has(rel.target) || found.some((item) => item.part === rel.target))
          continue;
        const root = this.pkg.xml(rel.target).root;
        found.push({
          part: rel.target,
          name: root.child(P, "cSld")?.attr("name") ?? "",
          type: root.attr("type") ?? "",
        });
      }
    }
    return found;
  }

  slides(): HxSlide[] {
    return this.#order().map((item, index) => {
      const root = this.pkg.xml(item.part).root;
      const shapes = shapesOf(root);
      const title =
        shapes.find((shape) => shape.placeholder === "title" || shape.placeholder === "ctrTitle")?.text ?? "";
      const notes = this.#notesBody(item.part)?.child(P, "txBody");
      return {
        index,
        id: item.id,
        part: item.part,
        layout: this.#layoutOf(item.part)?.name ?? "",
        title,
        shapes,
        pictures: root.descendants(P, "pic").length,
        notes: notes ? textOf(notes) : "",
      };
    });
  }

  #slide(index: number): SlideEntry {
    const order = this.#order();
    const found = Number.isInteger(index) ? order[index] : undefined;
    if (!found)
      throw new HxOfficeError(
        "invalid",
        `The presentation has ${order.length} slides; there is no slide ${index + 1}.`,
      );
    return found;
  }

  #findLayout(name: string | undefined, wantBody: boolean): LayoutInfo {
    const layouts = this.layouts();
    const first = layouts[0];
    if (!first) throw new HxOfficeError("damaged", "The presentation has no slide layouts.");
    if (name) {
      const wanted = name.trim().toLowerCase();
      const found = layouts.find(
        (layout) => layout.name.toLowerCase() === wanted || layout.type.toLowerCase() === wanted,
      );
      if (!found)
        throw new HxOfficeError(
          "invalid",
          `The presentation has no layout ${name}. Layouts: ${layouts.map((layout) => layout.name).join(", ")}`,
        );
      return found;
    }
    const preferred = wantBody ? ["obj", "tx", "twoObj"] : ["title", "titleOnly", "obj"];
    for (const type of preferred) {
      const found = layouts.find((layout) => layout.type === type);
      if (found) return found;
    }
    return first;
  }

  #newSlideId(): number {
    const ids = this.#idList()
      .childrenNamed(P, "sldId")
      .map((element) => Number(element.attr("id") ?? 0));
    const id = Math.max(255, ...ids) + 1;
    if (id > 2_147_483_647) throw new HxOfficeError("invalid", "The presentation has used up its slide ids.");
    return id;
  }

  #listEntry(id: number, rid: string): HxXmlElement {
    const list = this.#idList();
    const rPrefix = list.lookupPrefix(NS.r) ?? "r";
    return xmlElement(list.qname(P, "sldId", "p"), { id: String(id), [`${rPrefix}:id`]: rid });
  }

  /** Adds a slide made from a layout, with its title and body, at `at` (from 0; the end by default). */
  addSlide(spec: { layout?: string; title?: string; body?: string; at?: number }): number {
    const layout = this.#findLayout(spec.layout, spec.body !== undefined && spec.body !== "");
    const part = this.pkg.freeName("ppt/slides/slide", ".xml");
    const doc = newXmlPart(
      `<p:sld xmlns:a="${A}" xmlns:r="${NS.r}" xmlns:p="${P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    );
    const tree = doc.root.child(P, "cSld")?.child(P, "spTree");
    if (!tree) throw new HxOfficeError("damaged", "A new slide could not be made.");
    let id = 2;
    let titleDone = false;
    let bodyDone = false;
    for (const holder of this.#layoutPlaceholders(layout.part)) {
      if (["dt", "ftr", "sldNum"].includes(holder.type)) continue;
      let text = "";
      if (!titleDone && (holder.type === "title" || holder.type === "ctrTitle")) {
        text = spec.title ?? "";
        titleDone = true;
      } else if (!bodyDone && BODY_TYPES.includes(holder.type)) {
        // The body goes into the first body place only; a two-column layout keeps its second column empty.
        text = spec.body ?? "";
        bodyDone = true;
      }
      const shape = placeholderShape(id, holder, text);
      tree.append(shape);
      shape.tidyNamespaces();
      id += 1;
    }
    this.pkg.setPart(part, doc, CONTENT_TYPE.slide);
    this.pkg.addRel(part, REL.slideLayout, layout.part);
    const rid = this.pkg.addRel(this.#part, REL.slide, part);
    const newId = this.#newSlideId();
    const element = this.#listEntry(newId, rid);
    const order = this.#order();
    const at = spec.at === undefined ? order.length : Math.max(0, Math.min(order.length, Math.trunc(spec.at)));
    this.#idList().insertBefore(element, order[at]?.element ?? null);
    this.#placeInSection(newId, at);
    return at;
  }

  #layoutPlaceholders(layoutPart: string): LayoutPlaceholder[] {
    const root = this.pkg.xml(layoutPart).root;
    const found: LayoutPlaceholder[] = [];
    for (const sp of root.descendants(P, "sp")) {
      const nvSpPr = sp.child(P, "nvSpPr");
      const ph = nvSpPr?.child(P, "nvPr")?.child(P, "ph");
      if (!nvSpPr || !ph) continue;
      found.push({
        type: ph.attr("type") ?? "",
        idx: ph.attr("idx"),
        name: nvSpPr.child(P, "cNvPr")?.attr("name") ?? "",
        spPr: sp.child(P, "spPr"),
      });
    }
    return found;
  }

  /** Deletes a slide with its notes, its entries in custom shows and sections, and parts only it used. */
  deleteSlide(index: number): void {
    const slide = this.#slide(index);
    if (this.#order().length === 1)
      throw new HxOfficeError("invalid", "The last slide of a presentation is not deleted here.");
    slide.element.parent?.remove(slide.element);
    for (const show of this.#presentation.descendants(P, "sld")) {
      if (show.attrNs(NS.r, "id") === slide.rid) show.parent?.remove(show);
    }
    for (const entry of this.#presentation.descendants(P14, "sldId")) {
      if (entry.attr("id") === String(slide.id)) entry.parent?.remove(entry);
    }
    this.pkg.removeRel(this.#part, slide.rid);
    this.pkg.removeUnreachable([slide.part]);
  }

  /** Moves a slide to position `to` (from 0). In a presentation with sections it joins the section it lands in. */
  moveSlide(from: number, to: number): void {
    const order = this.#order();
    const slide = this.#slide(from);
    const target = Math.max(0, Math.min(order.length - 1, Math.trunc(to)));
    if (target === from) return;
    const list = this.#idList();
    list.remove(slide.element);
    const rest = this.#order();
    list.insertBefore(slide.element, rest[target]?.element ?? null);
    if (this.#sections().length > 0) {
      for (const entry of this.#presentation.descendants(P14, "sldId")) {
        if (entry.attr("id") === String(slide.id)) entry.parent?.remove(entry);
      }
      this.#placeInSection(slide.id, target);
    }
  }

  /**
   * Copies a slide right after it. Pictures, media and the layout are shared; charts, diagrams, embedded
   * objects and the notes are copied, because Office expects each of those to belong to one slide.
   */
  duplicateSlide(index: number): number {
    const slide = this.#slide(index);
    const part = this.pkg.freeName("ppt/slides/slide", ".xml");
    this.pkg.copyPart(slide.part, part);
    this.#copyRels(slide.part, part, new Map([[slide.part, part]]));
    const rid = this.pkg.addRel(this.#part, REL.slide, part);
    const newId = this.#newSlideId();
    this.#idList().insertAfter(this.#listEntry(newId, rid), slide.element);
    this.#placeInSection(newId, index + 1);
    return index + 1;
  }

  /**
   * Gives `to` the relationships of `from`, with the same ids so that the copied XML stays right. Shared
   * targets keep pointing at the same part; owned ones (charts, notes, embeddings) are copied first.
   * `copies` maps each part already copied to its copy, so a notes slide's link back to its slide follows.
   */
  #copyRels(from: string, to: string, copies: Map<string, string>): void {
    for (const rel of this.pkg.rels(from)) {
      if (rel.external) {
        this.pkg.addRel(to, rel.type, rel.target, { id: rel.id, external: true });
        continue;
      }
      if (COMMENT_REL.test(rel.type)) continue;
      let target = copies.get(rel.target) ?? rel.target;
      if (!copies.has(rel.target) && this.pkg.has(rel.target) && !SHARED_REL.test(rel.type)) {
        target = freeLike(this.pkg, rel.target);
        copies.set(rel.target, target);
        this.pkg.copyPart(rel.target, target);
        this.#copyRels(rel.target, target, copies);
      }
      this.pkg.addRel(to, rel.type, target, { id: rel.id });
    }
  }

  #sections(): HxXmlElement[] {
    return this.#presentation.descendants(P14, "section");
  }

  /** Puts a slide id into the section of its neighbour, keeping the sections in show order. */
  #placeInSection(id: number, at: number): void {
    const sections = this.#sections();
    if (sections.length === 0) return;
    const order = this.#order().map((item) => item.id);
    const neighbour = order[at - 1] ?? order[at + 1];
    const home =
      sections.find((section) =>
        section.descendants(P14, "sldId").some((entry) => entry.attr("id") === String(neighbour)),
      ) ?? sections[0];
    if (!home) return;
    let list = home.child(P14, "sldIdLst");
    if (!list) {
      list = xmlElement(home.qname(P14, "sldIdLst", "p14"));
      home.append(list);
    }
    const entry = xmlElement(list.qname(P14, "sldId", "p14"), { id: String(id) });
    const after =
      list.childrenNamed(P14, "sldId").find((member) => order.indexOf(Number(member.attr("id"))) > order.indexOf(id)) ??
      null;
    list.insertBefore(entry, after);
  }

  /**
   * Sets the text of the title, the subtitle, the body (subtitle on a title slide) or a shape by name.
   * Each line is a paragraph; the first paragraph's look stays.
   */
  setText(index: number, target: string, text: string): void {
    const slide = this.#slide(index);
    const root = this.pkg.xml(slide.part).root;
    let shape = findShape(root, target);
    if (!shape) {
      // The layout has the placeholder and the slide does not use it yet: add it.
      const layout = this.#layoutOf(slide.part);
      const wanted =
        target === "body"
          ? BODY_TYPES
          : target === "title"
            ? ["title", "ctrTitle"]
            : target === "subtitle"
              ? ["subTitle"]
              : [];
      const holder = layout
        ? this.#layoutPlaceholders(layout.part).find((item) => wanted.includes(item.type))
        : undefined;
      const tree = root.child(P, "cSld")?.child(P, "spTree");
      if (!holder || !tree) throw new HxOfficeError("invalid", `Slide ${index + 1} has no ${target}.`);
      shape = placeholderShape(nextShapeId(root), holder, "");
      tree.append(shape);
      shape.tidyNamespaces();
    }
    setShapeText(shape, text);
  }

  #notesPart(slidePart: string): string | null {
    const rel = this.pkg.rels(slidePart).find((item) => item.type === REL.notesSlide);
    return rel && this.pkg.has(rel.target) ? rel.target : null;
  }

  #notesBody(slidePart: string): HxXmlElement | null {
    const part = this.#notesPart(slidePart);
    if (!part) return null;
    for (const sp of this.pkg.xml(part).root.descendants(P, "sp")) {
      if (sp.child(P, "nvSpPr")?.child(P, "nvPr")?.child(P, "ph")?.attr("type") === "body") return sp;
    }
    return null;
  }

  /** Sets the speaker notes of a slide, making its notes page when it has none. */
  setNotes(index: number, text: string): void {
    const slide = this.#slide(index);
    let body = this.#notesBody(slide.part);
    if (!body) {
      let part = this.#notesPart(slide.part);
      if (!part) {
        const master = this.pkg.rels(this.#part).find((rel) => rel.type === REL.notesMaster);
        if (!master || !this.pkg.has(master.target))
          throw new HxOfficeError(
            "unsupported",
            "The presentation has no notes master, so notes cannot be added here.",
          );
        part = this.pkg.freeName("ppt/notesSlides/notesSlide", ".xml");
        this.pkg.setPart(
          part,
          newXmlPart(
            `<p:notes xmlns:a="${A}" xmlns:r="${NS.r}" xmlns:p="${P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`,
          ),
          CONTENT_TYPE.notesSlide,
        );
        this.pkg.addRel(part, REL.notesMaster, master.target);
        this.pkg.addRel(part, REL.slide, slide.part);
        this.pkg.addRel(slide.part, REL.notesSlide, part);
      }
      const root = this.pkg.xml(part).root;
      const tree = root.child(P, "cSld")?.child(P, "spTree");
      if (!tree) throw new HxOfficeError("damaged", `The notes of slide ${index + 1} are damaged.`);
      body = placeholderShape(nextShapeId(root), { type: "body", idx: "1", name: "Notes Placeholder" }, "");
      tree.append(body);
      body.tidyNamespaces();
    }
    setShapeText(body, text);
  }

  /** Gives a slide another layout; its placeholders follow the new layout's of the same type. */
  setLayout(index: number, name: string): string {
    const slide = this.#slide(index);
    const layout = this.#findLayout(name, false);
    const rel = this.pkg.rels(slide.part).find((item) => item.type === REL.slideLayout);
    const old = this.#layoutOf(slide.part);
    if (rel) this.pkg.removeRel(slide.part, rel.id);
    this.pkg.addRel(slide.part, REL.slideLayout, layout.part, rel ? { id: rel.id } : {});
    const holders = this.#layoutPlaceholders(layout.part);
    const oldHolders = old ? this.#layoutPlaceholders(old.part) : [];
    const used = new Set<LayoutPlaceholder>();
    const root = this.pkg.xml(slide.part).root;
    for (const sp of root.descendants(P, "sp")) {
      const ph = sp.child(P, "nvSpPr")?.child(P, "nvPr")?.child(P, "ph");
      if (!ph) continue;
      const type = ph.attr("type") ?? "";
      const idx = ph.attr("idx");
      const bodyLike = BODY_TYPES.includes(type) && type !== "subTitle";
      const match = holders.find(
        (holder) =>
          !used.has(holder) &&
          (holder.type === type || (bodyLike && BODY_TYPES.includes(holder.type) && holder.type !== "subTitle")),
      );
      if (match) {
        used.add(match);
        if (match.type !== type) {
          if (match.type === "") ph.removeAttr("type");
          else ph.setAttr("type", match.type);
        }
        if (match.idx === null) ph.removeAttr("idx");
        else ph.setAttr("idx", match.idx);
        continue;
      }
      // No place in the new layout: the shape keeps the position it had from the old one.
      const spPr = sp.child(P, "spPr");
      const from = oldHolders.find((holder) => holder.type === type && holder.idx === idx)?.spPr?.child(A, "xfrm");
      if (spPr && !spPr.child(A, "xfrm") && from) spPr.insertBefore(cloneElement(from), spPr.children[0] ?? null);
    }
    return layout.name;
  }

  /** Puts a picture on a slide; without a place, it is centred at most 60% of the slide wide and high. */
  addImage(index: number, image: HxImage, place?: { x?: number; y?: number; cx?: number; cy?: number }): number {
    const slide = this.#slide(index);
    const root = this.pkg.xml(slide.part).root;
    const tree = root.child(P, "cSld")?.child(P, "spTree");
    if (!tree) throw new HxOfficeError("damaged", `Slide ${index + 1} has no shape tree.`);
    const rid = this.#addMedia(slide.part, image);
    const { cx: slideCx, cy: slideCy } = this.size();
    const ratio = image.height > 0 && image.width > 0 ? image.height / image.width : 0.75;
    let cx = place?.cx ?? Math.round(slideCx * 0.6);
    let cy = place?.cy ?? Math.round(cx * ratio);
    if (place?.cx === undefined && place?.cy === undefined && cy > slideCy * 0.6) {
      cy = Math.round(slideCy * 0.6);
      cx = Math.round(cy / ratio);
    }
    if (place?.cx !== undefined && place.cy === undefined) cy = Math.round(cx * ratio);
    if (place?.cy !== undefined && place.cx === undefined) cx = Math.round(cy / ratio);
    if (cx <= 0 || cy <= 0) throw new HxOfficeError("invalid", "The picture size must be more than 0.");
    const x = place?.x ?? Math.round((slideCx - cx) / 2);
    const y = place?.y ?? Math.round((slideCy - cy) / 2);
    const id = nextShapeId(root);
    const pic = newXmlPart(
      `<p:pic xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${NS.r}"><p:nvPicPr><p:cNvPr id="${id}" name="${escapeAttr(`Picture ${id}`)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
    ).root;
    tree.append(pic);
    pic.tidyNamespaces();
    return root.descendants(P, "pic").length - 1;
  }

  #addMedia(slidePart: string, image: HxImage): string {
    const media = this.pkg.freeName("ppt/media/image", `.${IMAGE_EXTENSIONS[image.type]}`);
    this.pkg.ensureDefault(IMAGE_EXTENSIONS[image.type], IMAGE_CONTENT_TYPES[image.type]);
    this.pkg.setPart(media, image.bytes);
    return this.pkg.addRel(slidePart, REL.image, media);
  }

  /**
   * Replaces the picture of the n-th picture shape (from 0) of a slide. The new picture keeps its own
   * proportions and is fitted, centred, into the old one's box. The old picture file goes when nothing
   * else uses it.
   */
  replaceImage(index: number, picture: number, image: HxImage): void {
    const slide = this.#slide(index);
    const root = this.pkg.xml(slide.part).root;
    const pic = root.descendants(P, "pic")[picture];
    const blip = pic?.child(P, "blipFill")?.child(A, "blip");
    if (!pic || !blip) throw new HxOfficeError("invalid", `Slide ${index + 1} has no picture ${picture + 1}.`);
    const embed = blip.attrs.find((attr) => attr.name.endsWith(":embed"))?.name ?? "r:embed";
    const oldRid = blip.attr(embed) ?? "";
    const oldTarget = this.pkg.relById(slide.part, oldRid);
    const rid = this.#addMedia(slide.part, image);
    blip.setAttr(embed, rid);
    const xfrm = pic.child(P, "spPr")?.child(A, "xfrm");
    const off = xfrm?.child(A, "off");
    const ext = xfrm?.child(A, "ext");
    const box = {
      x: Number(off?.attr("x")),
      y: Number(off?.attr("y")),
      cx: Number(ext?.attr("cx")),
      cy: Number(ext?.attr("cy")),
    };
    if (off && ext && box.cx > 0 && box.cy > 0 && image.width > 0 && image.height > 0) {
      const ratio = image.height / image.width;
      const cx = ratio > box.cy / box.cx ? Math.round(box.cy / ratio) : box.cx;
      const cy = ratio > box.cy / box.cx ? box.cy : Math.round(box.cx * ratio);
      off.setAttr("x", String(Math.round(box.x + (box.cx - cx) / 2)));
      off.setAttr("y", String(Math.round(box.y + (box.cy - cy) / 2)));
      ext.setAttr("cx", String(cx));
      ext.setAttr("cy", String(cy));
    }
    // A cropped old picture's crop does not fit the new one.
    const crop = pic.child(P, "blipFill")?.child(A, "srcRect");
    if (crop) crop.parent?.remove(crop);
    if (oldTarget && !usesRel(root, oldRid)) {
      this.pkg.removeRel(slide.part, oldRid);
      if (!oldTarget.external) this.pkg.removeUnreachable([oldTarget.target]);
    }
  }

  toBytes(): Uint8Array {
    return this.pkg.toBytes();
  }
}

/** A free part name like `part`: ppt/charts/chart3.xml → ppt/charts/chart<n>.xml. */
function freeLike(pkg: HxOoxml, part: string): string {
  const match = /^(.*?)(\d*)(\.[^./]+)?$/.exec(part);
  return pkg.freeName(match?.[1] ?? part, match?.[3] ?? "");
}

function* allElements(root: HxXmlElement): Generator<HxXmlElement> {
  const stack = [root];
  for (let element = stack.pop(); element !== undefined; element = stack.pop()) {
    yield element;
    for (const child of element.elements()) stack.push(child);
  }
}

/** Whether any attribute in the relationships namespace of the part still refers to `rid`. */
function usesRel(root: HxXmlElement, rid: string): boolean {
  for (const element of allElements(root)) {
    for (const attr of element.attrs) {
      const colon = attr.name.indexOf(":");
      if (colon < 0 || attr.value !== rid) continue;
      if (element.lookupNamespace(attr.name.slice(0, colon)) === NS.r) return true;
    }
  }
  return false;
}

function nextShapeId(root: HxXmlElement): number {
  let max = 1;
  for (const element of allElements(root)) {
    if (element.local !== "cNvPr") continue;
    const id = Number(element.attr("id"));
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max + 1;
}

function shapesOf(root: HxXmlElement): HxSlideShape[] {
  const shapes: HxSlideShape[] = [];
  for (const sp of root.descendants(P, "sp")) {
    const nvSpPr = sp.child(P, "nvSpPr");
    const ph = nvSpPr?.child(P, "nvPr")?.child(P, "ph");
    const body = sp.child(P, "txBody");
    shapes.push({
      name: nvSpPr?.child(P, "cNvPr")?.attr("name") ?? "",
      placeholder: ph ? (ph.attr("type") ?? "") : null,
      text: body ? textOf(body) : "",
    });
  }
  // Text in tables of graphic frames counts too.
  for (const frame of root.descendants(P, "graphicFrame")) {
    const rows = frame.descendants(A, "tr").map((tr) =>
      tr
        .childrenNamed(A, "tc")
        .map((tc) => {
          const body = tc.child(A, "txBody");
          return body ? textOf(body).replace(/\n/g, " ") : "";
        })
        .join("\t"),
    );
    if (rows.length > 0)
      shapes.push({
        name: frame.child(P, "nvGraphicFramePr")?.child(P, "cNvPr")?.attr("name") ?? "Table",
        placeholder: null,
        text: rows.join("\n"),
      });
  }
  return shapes;
}

/** The text of a text body: its paragraphs on lines, line breaks inside them as line breaks too. */
export function textOf(body: HxXmlElement): string {
  return body
    .childrenNamed(A, "p")
    .map((p) =>
      p
        .elements()
        .map((child) =>
          child.local === "r" || child.local === "fld"
            ? (child.child(A, "t")?.text() ?? "")
            : child.local === "br"
              ? "\n"
              : "",
        )
        .join(""),
    )
    .join("\n");
}

function placeholderTypeOf(sp: HxXmlElement): string | null {
  const ph = sp.child(P, "nvSpPr")?.child(P, "nvPr")?.child(P, "ph");
  return ph ? (ph.attr("type") ?? "") : null;
}

function findShape(root: HxXmlElement, target: string): HxXmlElement | null {
  const shapes = root.descendants(P, "sp");
  if (target === "title")
    return shapes.find((sp) => ["title", "ctrTitle"].includes(placeholderTypeOf(sp) ?? "-")) ?? null;
  if (target === "subtitle") return shapes.find((sp) => placeholderTypeOf(sp) === "subTitle") ?? null;
  if (target === "body") {
    // A real body place first; the subtitle of a title slide only when there is none.
    return (
      shapes.find((sp) => ["body", "obj", ""].includes(placeholderTypeOf(sp) ?? "-")) ??
      shapes.find((sp) => placeholderTypeOf(sp) === "subTitle") ??
      null
    );
  }
  return shapes.find((sp) => sp.child(P, "nvSpPr")?.child(P, "cNvPr")?.attr("name") === target) ?? null;
}

function setShapeText(sp: HxXmlElement, text: string): void {
  let body = sp.child(P, "txBody");
  if (!body) {
    body = newXmlPart(`<p:txBody xmlns:p="${P}" xmlns:a="${A}"><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>`).root;
    sp.append(body);
    body.tidyNamespaces();
  }
  const paragraphs = body.childrenNamed(A, "p");
  const first = paragraphs[0];
  const pPr = first?.child(A, "pPr") ?? null;
  const rPr = first?.descendants(A, "rPr")[0] ?? first?.child(A, "endParaRPr") ?? null;
  for (const p of paragraphs) body.remove(p);
  const scope = body;
  const q = (local: string) => scope.qname(A, local, "a");
  for (const line of text.split(/\r?\n/)) {
    const p = xmlElement(q("p"));
    if (pPr) p.append(cloneElement(pPr));
    if (line !== "") {
      const run = xmlElement(q("r"));
      if (rPr) run.append(renamed(cloneElement(rPr), "rPr"));
      run.append(xmlElement(q("t"), {}, [line]));
      p.append(run);
    }
    body.append(p);
  }
}

function renamed(element: HxXmlElement, local: string): HxXmlElement {
  if (element.local === local) return element;
  const prefix = element.prefix;
  const copy = xmlElement(
    prefix ? `${prefix}:${local}` : local,
    Object.fromEntries(element.attrs.map((attr) => [attr.name, attr.value])),
  );
  for (const child of element.children) if (child.kind === "element") copy.append(child);
  return copy;
}

function placeholderShape(id: number, holder: { type: string; idx: string | null; name: string }, text: string) {
  const ph = [
    holder.type ? `type="${escapeAttr(holder.type)}"` : "",
    holder.idx !== null ? `idx="${escapeAttr(holder.idx)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const paragraphs =
    text === ""
      ? "<a:p/>"
      : text
          .split(/\r?\n/)
          .map((line) =>
            line === ""
              ? "<a:p/>"
              : `<a:p><a:r><a:rPr lang="zh-CN" altLang="en-US"/><a:t>${escapeText(line)}</a:t></a:r></a:p>`,
          )
          .join("");
  return newXmlPart(
    `<p:sp xmlns:p="${P}" xmlns:a="${A}"><p:nvSpPr><p:cNvPr id="${id}" name="${escapeAttr(holder.name || `Placeholder ${id}`)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph ${ph}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`,
  ).root;
}

function cloneElement(element: HxXmlElement): HxXmlElement {
  const copy = xmlElement(element.name, Object.fromEntries(element.attrs.map((attr) => [attr.name, attr.value])));
  for (const child of element.children) {
    if (child.kind === "element") copy.append(cloneElement(child));
    else if (child.kind === "text") copy.append(new HxXmlText(child.value));
  }
  return copy;
}
