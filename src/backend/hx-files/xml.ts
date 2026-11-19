// HXBot v1.7.4（CU-07、ART-05）：办公文件里的 XML。
// 读进来没改的部分原样写回：每个元素记得自己在原文里的位置，写出时没改过的元素直接抄原文，
// 改过的元素才重新写（它的开始标签只要属性没变也照抄）。这样 Excel、Word 里我们没碰的内容一个字节都不变。
// 不认 DOCTYPE（办公文件里没有它；有它就可能是 XXE 或“十亿笑”炸弹），限制层数、节点数和大小。

/** Why a part could not be read. */
export type HxXmlErrorCode = "malformed" | "too-deep" | "too-large" | "doctype" | "encoding";

export class HxXmlError extends Error {
  readonly code: HxXmlErrorCode;
  constructor(code: HxXmlErrorCode, message: string) {
    super(message);
    this.name = "HxXmlError";
    this.code = code;
  }
}

export interface HxXmlLimits {
  /** Elements inside each other. Word and Excel stay far below 100. */
  maxDepth: number;
  /** Elements, texts and the rest together. Each costs about 100 bytes of memory. */
  maxNodes: number;
  /** Characters of the text of one part. */
  maxChars: number;
}

export const HX_XML_LIMITS: HxXmlLimits = { maxDepth: 512, maxNodes: 6_000_000, maxChars: 256 * 1024 * 1024 };

export type HxXmlNode = HxXmlElement | HxXmlText | HxXmlOther;

interface Source {
  readonly text: string;
}

/** A text between tags. `raw` is the text as it stood in the part; null once it was set. */
export class HxXmlText {
  readonly kind = "text" as const;
  parent: HxXmlElement | null = null;
  #value: string;
  #raw: string | null;
  constructor(value: string, raw: string | null = null) {
    this.#value = value;
    this.#raw = raw;
  }
  get value(): string {
    return this.#value;
  }
  set value(next: string) {
    if (next === this.#value) return;
    this.#value = next;
    this.#raw = null;
    this.parent?.touch();
  }
  write(out: string[]): void {
    out.push(this.#raw ?? escapeText(this.#value));
  }
}

/** A comment, a CDATA section, a processing instruction or the XML declaration, written back as it was. */
export class HxXmlOther {
  readonly kind: "comment" | "cdata" | "pi";
  readonly raw: string;
  parent: HxXmlElement | null = null;
  constructor(kind: "comment" | "cdata" | "pi", raw: string) {
    this.kind = kind;
    this.raw = raw;
  }
  /** The text of a CDATA section; empty for the others. */
  get value(): string {
    return this.kind === "cdata" ? this.raw.slice(9, -3) : "";
  }
  write(out: string[]): void {
    out.push(this.raw);
  }
}

export interface HxXmlAttr {
  readonly name: string;
  readonly value: string;
}

interface Origin {
  readonly source: Source;
  /** Where the element starts (`<`) and ends (after its end tag or `/>`). */
  readonly start: number;
  readonly end: number;
  /** The start tag, `<` to `>`, as it stood. */
  readonly startTag: string;
}

export class HxXmlElement {
  readonly kind = "element" as const;
  readonly name: string;
  parent: HxXmlElement | null = null;
  /**
   * Where a new element not yet placed in a document looks up its prefixes. Without it, w:pPr made for a
   * Word part has no namespace until it is attached, and child(W, "pPr") would not find it.
   */
  scope: HxXmlElement | null = null;
  #attrs: HxXmlAttr[];
  #children: HxXmlNode[];
  #origin: Origin | null;
  #dirty: boolean;
  #attrsChanged: boolean;

  constructor(name: string, attrs: readonly HxXmlAttr[] = [], children: readonly HxXmlNode[] = [], origin?: Origin) {
    if (!isName(name)) throw new HxXmlError("malformed", `Not an element name: ${name.slice(0, 40)}`);
    this.name = name;
    this.#attrs = [...attrs];
    this.#children = [];
    this.#origin = origin ?? null;
    this.#dirty = origin === undefined;
    this.#attrsChanged = origin === undefined;
    for (const child of children) this.#adopt(child);
    this.#children = [...children];
  }

  /** The name without its prefix. */
  get local(): string {
    const colon = this.name.indexOf(":");
    return colon < 0 ? this.name : this.name.slice(colon + 1);
  }

  get prefix(): string {
    const colon = this.name.indexOf(":");
    return colon < 0 ? "" : this.name.slice(0, colon);
  }

  /** The namespace of the element, from the declarations in scope; "" when none. */
  get ns(): string {
    return this.lookupNamespace(this.prefix) ?? "";
  }

  get attrs(): readonly HxXmlAttr[] {
    return this.#attrs;
  }

  get children(): readonly HxXmlNode[] {
    return this.#children;
  }

  /** The element children, in order. */
  elements(): HxXmlElement[] {
    const found: HxXmlElement[] = [];
    for (const child of this.#children) if (child.kind === "element") found.push(child);
    return found;
  }

  /** The first child element with this namespace and local name. */
  child(ns: string, local: string): HxXmlElement | null {
    for (const child of this.#children) {
      if (child.kind === "element" && child.local === local && child.ns === ns) return child;
    }
    return null;
  }

  childrenNamed(ns: string, local: string): HxXmlElement[] {
    const found: HxXmlElement[] = [];
    for (const child of this.#children) {
      if (child.kind === "element" && child.local === local && child.ns === ns) found.push(child);
    }
    return found;
  }

  /** Every element below this one (not this one), in document order, with this namespace and local name. */
  descendants(ns: string, local: string): HxXmlElement[] {
    const found: HxXmlElement[] = [];
    const stack: HxXmlNode[] = [...this.#children].reverse();
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.kind !== "element") continue;
      if (node.local === local && node.ns === ns) found.push(node);
      for (let index = node.#children.length - 1; index >= 0; index -= 1) {
        const child = node.#children[index];
        if (child) stack.push(child);
      }
    }
    return found;
  }

  attr(name: string): string | null {
    for (const attr of this.#attrs) if (attr.name === name) return attr.value;
    return null;
  }

  /** An attribute in a namespace, whatever prefix the part uses for it. */
  attrNs(ns: string, local: string): string | null {
    for (const attr of this.#attrs) {
      const colon = attr.name.indexOf(":");
      if (colon < 0) continue;
      const prefix = attr.name.slice(0, colon);
      if (prefix === "xmlns" || attr.name.slice(colon + 1) !== local) continue;
      if (this.lookupNamespace(prefix) === ns) return attr.value;
    }
    return null;
  }

  setAttr(name: string, value: string): void {
    if (!isName(name)) throw new HxXmlError("malformed", `Not an attribute name: ${name.slice(0, 40)}`);
    const index = this.#attrs.findIndex((attr) => attr.name === name);
    if (index >= 0 && this.#attrs[index]?.value === value) return;
    if (index >= 0) this.#attrs[index] = { name, value };
    else this.#attrs.push({ name, value });
    this.#attrsChanged = true;
    this.touch();
  }

  removeAttr(name: string): void {
    const index = this.#attrs.findIndex((attr) => attr.name === name);
    if (index < 0) return;
    this.#attrs.splice(index, 1);
    this.#attrsChanged = true;
    this.touch();
  }

  /**
   * Drops the namespace declarations of this element that its parent already makes the same way, as a
   * fragment parsed on its own carries them. Call it once the element is placed.
   */
  tidyNamespaces(): void {
    const parent = this.parent;
    if (!parent) return;
    for (const attr of [...this.#attrs]) {
      if (attr.name !== "xmlns" && !attr.name.startsWith("xmlns:")) continue;
      const prefix = attr.name === "xmlns" ? "" : attr.name.slice(6);
      if (parent.lookupNamespace(prefix) === attr.value) this.removeAttr(attr.name);
    }
  }

  /** The namespace that `prefix` stands for here, from this element up; null when it is not declared. */
  lookupNamespace(prefix: string): string | null {
    if (prefix === "xml") return "http://www.w3.org/XML/1998/namespace";
    const name = prefix === "" ? "xmlns" : `xmlns:${prefix}`;
    let top: HxXmlElement = this;
    for (let element: HxXmlElement | null = this; element; element = element.parent) {
      const value = element.attr(name);
      if (value !== null) return value;
      top = element;
    }
    // A detached element: the declarations where it is going to be placed.
    if (top.scope && top.scope !== this) return top.scope.lookupNamespace(prefix);
    return prefix === "" ? "" : null;
  }

  /** A prefix declared for `ns` in scope ("" for the default namespace), or null. */
  lookupPrefix(ns: string): string | null {
    const seen = new Set<string>();
    let top: HxXmlElement = this;
    for (let element: HxXmlElement | null = this; element; element = element.parent) {
      for (const attr of element.#attrs) {
        if (attr.name !== "xmlns" && !attr.name.startsWith("xmlns:")) continue;
        const prefix = attr.name === "xmlns" ? "" : attr.name.slice(6);
        if (seen.has(prefix)) continue;
        seen.add(prefix);
        if (attr.value === ns) return prefix;
      }
      top = element;
    }
    if (top.scope && top.scope !== this) {
      const prefix = top.scope.lookupPrefix(ns);
      // A prefix that this element's own tree declares for something else does not count.
      if (prefix !== null && !seen.has(prefix)) return prefix;
    }
    return null;
  }

  /**
   * The name to give a new element in `ns` below this one: with the prefix the part already uses for
   * the namespace. Without one in scope, `fallbackPrefix` is declared on this element.
   */
  qname(ns: string, local: string, fallbackPrefix: string): string {
    const prefix = this.lookupPrefix(ns);
    if (prefix !== null) return prefix === "" ? local : `${prefix}:${local}`;
    this.setAttr(`xmlns:${fallbackPrefix}`, ns);
    return `${fallbackPrefix}:${local}`;
  }

  /** All the text inside, CDATA included, in document order. */
  text(): string {
    const parts: string[] = [];
    const stack: HxXmlNode[] = [...this.#children].reverse();
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      if (node.kind === "text") parts.push(node.value);
      else if (node.kind === "cdata") parts.push(node.value);
      else if (node.kind === "element") {
        for (let index = node.#children.length - 1; index >= 0; index -= 1) {
          const child = node.#children[index];
          if (child) stack.push(child);
        }
      }
    }
    return parts.join("");
  }

  /** Replaces all the children with one text, or with nothing for "". */
  setText(value: string): void {
    for (const child of this.#children) child.parent = null;
    this.#children = value === "" ? [] : [this.#adopt(new HxXmlText(value))];
    this.touch();
  }

  append(node: HxXmlNode): void {
    this.#children.push(this.#adopt(node));
    this.touch();
  }

  /** Inserts `node` before `reference`, or at the end when `reference` is null. */
  insertBefore(node: HxXmlNode, reference: HxXmlNode | null): void {
    if (reference === null) {
      this.append(node);
      return;
    }
    const index = this.#children.indexOf(reference);
    if (index < 0) throw new HxXmlError("malformed", "The reference node is not a child.");
    this.#children.splice(index, 0, this.#adopt(node));
    this.touch();
  }

  insertAfter(node: HxXmlNode, reference: HxXmlNode): void {
    const index = this.#children.indexOf(reference);
    if (index < 0) throw new HxXmlError("malformed", "The reference node is not a child.");
    this.#children.splice(index + 1, 0, this.#adopt(node));
    this.touch();
  }

  remove(node: HxXmlNode): void {
    const index = this.#children.indexOf(node);
    if (index < 0) return;
    this.#children.splice(index, 1);
    node.parent = null;
    this.touch();
  }

  replaceChild(old: HxXmlNode, next: HxXmlNode): void {
    const index = this.#children.indexOf(old);
    if (index < 0) throw new HxXmlError("malformed", "The node to replace is not a child.");
    old.parent = null;
    this.#children[index] = this.#adopt(next);
    this.touch();
  }

  /** Replaces all the children. */
  setChildren(nodes: readonly HxXmlNode[]): void {
    for (const child of this.#children) child.parent = null;
    this.#children = nodes.map((node) => this.#adopt(node));
    this.touch();
  }

  /** Marks this element and the ones around it as changed, so that they are written again. */
  touch(): void {
    for (let element: HxXmlElement | null = this; element && !element.#dirty; element = element.parent) {
      element.#dirty = true;
    }
  }

  /** True when this element or something inside it changed since it was read. */
  get changed(): boolean {
    return this.#dirty;
  }

  write(out: string[]): void {
    const origin = this.#origin;
    if (origin && !this.#dirty) {
      out.push(origin.source.text.slice(origin.start, origin.end));
      return;
    }
    const empty = this.#children.length === 0;
    if (origin && !this.#attrsChanged) {
      const tag = origin.startTag;
      const selfClosing = tag.endsWith("/>");
      if (empty) {
        out.push(selfClosing ? tag : `${tag}</${this.name}>`);
        return;
      }
      out.push(selfClosing ? `${tag.slice(0, -2).trimEnd()}>` : tag);
    } else {
      out.push(`<${this.name}`);
      for (const attr of this.#attrs) out.push(` ${attr.name}="${escapeAttr(attr.value)}"`);
      if (empty) {
        out.push("/>");
        return;
      }
      out.push(">");
    }
    for (const child of this.#children) child.write(out);
    out.push(`</${this.name}>`);
  }

  toString(): string {
    const out: string[] = [];
    this.write(out);
    return out.join("");
  }

  #adopt<Node extends HxXmlNode>(node: Node): Node {
    if (node.parent && node.parent !== this) node.parent.remove(node);
    if (node.kind === "element") {
      for (let element: HxXmlElement | null = this; element; element = element.parent) {
        if (element === node) throw new HxXmlError("malformed", "An element cannot go inside itself.");
      }
    }
    node.parent = this;
    return node;
  }
}

export type HxXmlEncoding = "utf-8" | "utf-16le" | "utf-16be";

/** One XML part: what stands before the root element, the root, and what stands after it. */
export class HxXmlDocument {
  readonly root: HxXmlElement;
  readonly encoding: HxXmlEncoding;
  readonly bom: boolean;
  readonly #before: readonly HxXmlNode[];
  readonly #after: readonly HxXmlNode[];
  readonly #source: string | null;

  constructor(options: {
    root: HxXmlElement;
    before?: readonly HxXmlNode[];
    after?: readonly HxXmlNode[];
    encoding?: HxXmlEncoding;
    bom?: boolean;
    source?: string;
  }) {
    this.root = options.root;
    this.#before = options.before ?? [];
    this.#after = options.after ?? [];
    this.encoding = options.encoding ?? "utf-8";
    this.bom = options.bom ?? false;
    this.#source = options.source ?? null;
  }

  /** True when nothing was changed since the part was read. */
  get changed(): boolean {
    return this.#source === null || this.root.changed;
  }

  toString(): string {
    if (this.#source !== null && !this.root.changed) return this.#source;
    const out: string[] = [];
    for (const node of this.#before) node.write(out);
    this.root.write(out);
    for (const node of this.#after) node.write(out);
    return out.join("");
  }

  toBytes(): Uint8Array {
    return encodeText(this.toString(), this.encoding, this.bom);
  }
}

/** Reads a part from its bytes: UTF-8, or UTF-16 with a byte order mark. */
export function parseXmlBytes(bytes: Uint8Array, limits: HxXmlLimits = HX_XML_LIMITS): HxXmlDocument {
  const { text, encoding, bom } = decodeText(bytes);
  return parseXml(text, limits, encoding, bom);
}

export function parseXml(
  text: string,
  limits: HxXmlLimits = HX_XML_LIMITS,
  encoding: HxXmlEncoding = "utf-8",
  bom = false,
): HxXmlDocument {
  if (text.length > limits.maxChars) throw new HxXmlError("too-large", "The part is too large.");
  const source: Source = { text };
  const before: HxXmlNode[] = [];
  const after: HxXmlNode[] = [];
  let root: HxXmlElement | null = null;
  // The open elements: their name, attributes, children so far, and where their start tag stood.
  interface Open {
    name: string;
    attrs: HxXmlAttr[];
    children: HxXmlNode[];
    start: number;
    startTag: string;
  }
  const stack: Open[] = [];
  let nodes = 0;
  let at = 0;
  const count = () => {
    nodes += 1;
    if (nodes > limits.maxNodes) throw new HxXmlError("too-large", "The part has too many nodes.");
  };
  const place = (node: HxXmlNode) => {
    const open = stack[stack.length - 1];
    if (open) open.children.push(node);
    else if (root) after.push(node);
    else before.push(node);
  };
  const length = text.length;
  while (at < length) {
    const lt = text.indexOf("<", at);
    if (lt !== at) {
      const end = lt < 0 ? length : lt;
      const raw = text.slice(at, end);
      if (stack.length === 0) {
        if (raw.trim() !== "") throw new HxXmlError("malformed", "Text stands outside the root element.");
        // Whitespace around the root is kept, as written.
        count();
        place(new HxXmlText(raw, raw));
      } else {
        count();
        place(new HxXmlText(decodeEntities(raw), raw));
      }
      at = end;
      continue;
    }
    if (text.startsWith("<!--", at)) {
      const end = text.indexOf("-->", at + 4);
      if (end < 0) throw new HxXmlError("malformed", "A comment does not end.");
      count();
      place(new HxXmlOther("comment", text.slice(at, end + 3)));
      at = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", at)) {
      if (stack.length === 0) throw new HxXmlError("malformed", "CDATA stands outside the root element.");
      const end = text.indexOf("]]>", at + 9);
      if (end < 0) throw new HxXmlError("malformed", "A CDATA section does not end.");
      count();
      place(new HxXmlOther("cdata", text.slice(at, end + 3)));
      at = end + 3;
      continue;
    }
    if (text.startsWith("<!", at)) {
      // DOCTYPE and the like: office parts never have them, and their entities are an attack.
      throw new HxXmlError("doctype", "The part has a DOCTYPE or another declaration, which HXBot does not read.");
    }
    if (text.startsWith("<?", at)) {
      const end = text.indexOf("?>", at + 2);
      if (end < 0) throw new HxXmlError("malformed", "A processing instruction does not end.");
      count();
      place(new HxXmlOther("pi", text.slice(at, end + 2)));
      at = end + 2;
      continue;
    }
    if (text.startsWith("</", at)) {
      const end = text.indexOf(">", at + 2);
      if (end < 0) throw new HxXmlError("malformed", "An end tag does not end.");
      const name = text.slice(at + 2, end).trimEnd();
      const open = stack.pop();
      if (!open || open.name !== name)
        throw new HxXmlError("malformed", `An end tag does not match: ${name.slice(0, 40)}`);
      const element = new HxXmlElement(open.name, open.attrs, open.children, {
        source,
        start: open.start,
        end: end + 1,
        startTag: open.startTag,
      });
      if (stack.length === 0) {
        if (root) throw new HxXmlError("malformed", "The part has more than one root element.");
        root = element;
      } else {
        place(element);
      }
      at = end + 1;
      continue;
    }
    // A start tag.
    if (root && stack.length === 0) throw new HxXmlError("malformed", "The part has more than one root element.");
    const tag = readStartTag(text, at);
    count();
    if (tag.selfClosing) {
      const element = new HxXmlElement(tag.name, tag.attrs, [], {
        source,
        start: at,
        end: tag.end,
        startTag: text.slice(at, tag.end),
      });
      if (stack.length === 0) root = element;
      else place(element);
    } else {
      if (stack.length >= limits.maxDepth) throw new HxXmlError("too-deep", "The part nests elements too deeply.");
      stack.push({ name: tag.name, attrs: tag.attrs, children: [], start: at, startTag: text.slice(at, tag.end) });
    }
    at = tag.end;
  }
  if (stack.length > 0) throw new HxXmlError("malformed", "An element does not end.");
  if (!root) throw new HxXmlError("malformed", "The part has no root element.");
  return new HxXmlDocument({ root, before, after, encoding, bom, source: text });
}

function readStartTag(
  text: string,
  start: number,
): { name: string; attrs: HxXmlAttr[]; selfClosing: boolean; end: number } {
  let at = start + 1;
  const nameEnd = scanName(text, at);
  if (nameEnd === at) throw new HxXmlError("malformed", "A tag has no name.");
  const name = text.slice(at, nameEnd);
  at = nameEnd;
  const attrs: HxXmlAttr[] = [];
  const seen = new Set<string>();
  for (;;) {
    const space = at;
    at = skipSpace(text, at);
    const char = text[at];
    if (char === undefined) throw new HxXmlError("malformed", "A start tag does not end.");
    if (char === ">") return { name, attrs, selfClosing: false, end: at + 1 };
    if (char === "/") {
      if (text[at + 1] !== ">") throw new HxXmlError("malformed", "A start tag has a stray /.");
      return { name, attrs, selfClosing: true, end: at + 2 };
    }
    if (at === space) throw new HxXmlError("malformed", "Attributes need a space between them.");
    const attrEnd = scanName(text, at);
    if (attrEnd === at) throw new HxXmlError("malformed", "An attribute has no name.");
    const attrName = text.slice(at, attrEnd);
    at = skipSpace(text, attrEnd);
    if (text[at] !== "=") throw new HxXmlError("malformed", "An attribute has no value.");
    at = skipSpace(text, at + 1);
    const quote = text[at];
    if (quote !== '"' && quote !== "'") throw new HxXmlError("malformed", "An attribute value has no quotes.");
    const close = text.indexOf(quote, at + 1);
    if (close < 0) throw new HxXmlError("malformed", "An attribute value does not end.");
    const raw = text.slice(at + 1, close);
    if (raw.includes("<")) throw new HxXmlError("malformed", "An attribute value has a <.");
    if (seen.has(attrName)) throw new HxXmlError("malformed", `An attribute repeats: ${attrName.slice(0, 40)}`);
    seen.add(attrName);
    // Line ends and tabs in a value read as spaces (XML 1.0, 3.3.3); &#10; and the like stay.
    attrs.push({ name: attrName, value: decodeEntities(raw.replace(/\r\n|[\r\n\t]/g, " ")) });
    at = close + 1;
  }
}

function skipSpace(text: string, start: number): number {
  let at = start;
  while (at < text.length) {
    const code = text.charCodeAt(at);
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break;
    at += 1;
  }
  return at;
}

function scanName(text: string, start: number): number {
  let at = start;
  while (at < text.length) {
    const code = text.charCodeAt(at);
    // Space, /, >, =, <, quotes and ? end a name.
    if (
      code === 0x20 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      code === 0x2f ||
      code === 0x3e ||
      code === 0x3d ||
      code === 0x3c ||
      code === 0x22 ||
      code === 0x27 ||
      code === 0x3f
    ) {
      break;
    }
    at += 1;
  }
  return at;
}

function isName(name: string): boolean {
  return name.length > 0 && name.length <= 1000 && scanName(name, 0) === name.length && !/^[-.0-9]/.test(name);
}

const NAMED: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Decodes the five named entities and the numeric ones; anything else is not well-formed. */
export function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&([^;&]{0,12});?/g, (match, body: string) => {
    if (!match.endsWith(";")) throw new HxXmlError("malformed", "A & stands without an entity.");
    const named = NAMED[body];
    if (named !== undefined) return named;
    let code = Number.NaN;
    if (/^#[0-9]{1,7}$/.test(body)) code = Number.parseInt(body.slice(1), 10);
    else if (/^#x[0-9a-fA-F]{1,6}$/.test(body)) code = Number.parseInt(body.slice(2), 16);
    if (!Number.isInteger(code) || !isXmlChar(code)) {
      throw new HxXmlError("malformed", `An unknown entity: &${body.slice(0, 12)};`);
    }
    return String.fromCodePoint(code);
  });
}

function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/**
 * Escapes a text for between tags. Characters that XML 1.0 does not allow at all are dropped: Word and
 * Excel refuse a part that has one, so text from elsewhere must not bring one in.
 */
export function escapeText(value: string): string {
  return stripInvalid(value).replace(/[&<>]/g, (char) => (char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;"));
}

export function escapeAttr(value: string): string {
  return stripInvalid(value).replace(/[&<"\t\n\r]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case '"':
        return "&quot;";
      case "\t":
        return "&#9;";
      case "\n":
        return "&#10;";
      default:
        return "&#13;";
    }
  });
}

/** Removes characters that XML 1.0 does not allow: controls, lone surrogates, U+FFFE and U+FFFF. */
export function stripInvalid(value: string): string {
  let clean = true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x20 && code < 0xd800) continue;
    clean = false;
    break;
  }
  if (clean) return value;
  const out: string[] = [];
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (isXmlChar(code)) out.push(char);
  }
  return out.join("");
}

export function decodeText(bytes: Uint8Array): { text: string; encoding: HxXmlEncoding; bom: boolean } {
  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return {
        text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(3)),
        encoding: "utf-8",
        bom: true,
      };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return {
        text: new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(2)),
        encoding: "utf-16le",
        bom: true,
      };
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return {
        text: new TextDecoder("utf-16be", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(2)),
        encoding: "utf-16be",
        bom: true,
      };
    }
    if (bytes[0] === 0x3c && bytes[1] === 0x00) {
      return {
        text: new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(bytes),
        encoding: "utf-16le",
        bom: false,
      };
    }
    if (bytes[0] === 0x00 && bytes[1] === 0x3c) {
      return {
        text: new TextDecoder("utf-16be", { fatal: true, ignoreBOM: true }).decode(bytes),
        encoding: "utf-16be",
        bom: false,
      };
    }
    return {
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
      encoding: "utf-8",
      bom: false,
    };
  } catch {
    throw new HxXmlError("encoding", "The part is not valid UTF-8 or UTF-16.");
  }
}

export function encodeText(text: string, encoding: HxXmlEncoding, bom: boolean): Uint8Array {
  if (encoding === "utf-8") {
    const body = new TextEncoder().encode(text);
    if (!bom) return body;
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return out;
  }
  const units = text.length;
  const offset = bom ? 2 : 0;
  const out = new Uint8Array(units * 2 + offset);
  const little = encoding === "utf-16le";
  if (bom) out.set(little ? [0xff, 0xfe] : [0xfe, 0xff]);
  for (let index = 0; index < units; index += 1) {
    const unit = text.charCodeAt(index);
    const at = offset + index * 2;
    out[at] = little ? unit & 0xff : unit >> 8;
    out[at + 1] = little ? unit >> 8 : unit & 0xff;
  }
  return out;
}

/** A new element; `attrs` in the order given. */
export function xmlElement(
  name: string,
  attrs: Readonly<Record<string, string>> = {},
  children: readonly (HxXmlNode | string)[] = [],
): HxXmlElement {
  return new HxXmlElement(
    name,
    Object.entries(attrs).map(([attrName, value]) => ({ name: attrName, value })),
    children.map((child) => (typeof child === "string" ? new HxXmlText(child) : child)),
  );
}
