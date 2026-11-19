import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  encodeText,
  escapeAttr,
  escapeText,
  HxXmlElement,
  HxXmlError,
  HxXmlText,
  parseXml,
  parseXmlBytes,
  stripInvalid,
  xmlElement,
} from "./xml";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** A small random number source, so that a failing case can be run again. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

const NAMES = ["a", "b:c", "x:row", "w:t", "p", "sheetData", "c", "v", "r:id"];
const TEXTS = ["", " ", "1", "中文", "a&b", "<", ">", '"q"', "'s'", "\n\t ", "😀", "x]]>y", "&#13;"];

/** A random well-formed part, written in many of the ways that XML allows. */
function randomXml(next: () => number, depth = 0): string {
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(next() * items.length)];
    if (item === undefined) throw new Error("empty list");
    return item;
  };
  const name = pick(NAMES.filter((item) => !item.includes(":") || item.startsWith("x:") || item.startsWith("w:")));
  const attrs: string[] = [];
  const used = new Set<string>();
  const count = Math.floor(next() * 4);
  for (let index = 0; index < count; index += 1) {
    const attr = pick(["r", "s", "t", "xml:space", "xmlns:x", "xmlns:w", "val"]);
    if (used.has(attr)) continue;
    used.add(attr);
    const quote = next() < 0.5 ? '"' : "'";
    const value = escapeAttr(pick(TEXTS)).replaceAll(quote === '"' ? "\u0000" : "'", quote === '"' ? "" : "&apos;");
    const space = next() < 0.2 ? "\n  " : " ";
    attrs.push(`${space}${attr}${next() < 0.1 ? " = " : "="}${quote}${value}${quote}`);
  }
  const head = `<${name}${attrs.join("")}`;
  if (depth > 5 || next() < 0.25) return `${head}${next() < 0.3 ? " " : ""}/>`;
  const children: string[] = [];
  const kids = Math.floor(next() * 5);
  for (let index = 0; index < kids; index += 1) {
    const roll = next();
    if (roll < 0.35) children.push(escapeText(pick(TEXTS)));
    else if (roll < 0.45) children.push("<!-- note -- ok? no -->".replace("-- ok? no ", " ok "));
    else if (roll < 0.5) children.push(`<![CDATA[${pick(["x<y", "&amp;", "]]"])}]]>`);
    else if (roll < 0.55) children.push('<?pi data="1"?>');
    else children.push(randomXml(next, depth + 1));
  }
  return `${head}>${children.join("")}</${name}${next() < 0.1 ? " " : ""}>`;
}

describe("parseXml", () => {
  it("writes back every random part unchanged, byte for byte", () => {
    for (let seed = 1; seed <= 1500; seed += 1) {
      const next = random(seed);
      const body = randomXml(next);
      const text = `${next() < 0.5 ? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' : ""}${body}${next() < 0.3 ? "\n" : ""}`;
      const doc = parseXml(text);
      expect(doc.toString(), `seed ${seed}`).toBe(text);
      // A change that is undone in effect still rewrites, and the result must parse to the same tree.
      doc.root.touch();
      const rewritten = doc.toString();
      expect(parseXml(rewritten).root.text(), `seed ${seed}`).toBe(doc.root.text());
    }
  });

  it("keeps the parts that did not change and rewrites only the changed element", () => {
    const text = `<?xml version="1.0"?>\n<worksheet xmlns="${MAIN}"  xmlns:r='rel'><sheetData><row r="1" spans = '1:2'><c r="A1" t="s"><v>0</v></c><c r='B1'><v>2.50</v></c></row><row r="2"><c r="A2"><v>7</v></c></row></sheetData><!-- kept --></worksheet>`;
    const doc = parseXml(text);
    const cell = doc.root.descendants(MAIN, "c").find((element) => element.attr("r") === "B1");
    expect(cell).toBeDefined();
    const value = cell?.child(MAIN, "v");
    value?.setText("3");
    const out = doc.toString();
    // Untouched siblings keep their odd spacing and quotes.
    expect(out).toContain(`<row r="1" spans = '1:2'><c r="A1" t="s"><v>0</v></c><c r='B1'><v>3</v></c></row>`);
    expect(out).toContain(`<row r="2"><c r="A2"><v>7</v></c></row>`);
    expect(out).toContain("<!-- kept -->");
    expect(out.startsWith('<?xml version="1.0"?>\n<worksheet')).toBe(true);
  });

  it("opens a self-closing element when it gets children, and keeps its attributes as written", () => {
    const doc = parseXml(`<root><sheetData a='1' /></root>`);
    const data = doc.root.elements()[0];
    data?.append(xmlElement("row", { r: "1" }));
    expect(doc.toString()).toBe(`<root><sheetData a='1'><row r="1"/></sheetData></root>`);
  });

  it("resolves namespaces by URI, whatever prefix the part uses", () => {
    const doc = parseXml(`<x:worksheet xmlns:x="${MAIN}"><x:sheetData><x:row r="1"/></x:sheetData></x:worksheet>`);
    expect(doc.root.ns).toBe(MAIN);
    expect(doc.root.child(MAIN, "sheetData")?.childrenNamed(MAIN, "row")).toHaveLength(1);
    const data = doc.root.child(MAIN, "sheetData");
    expect(data?.qname(MAIN, "row", "s")).toBe("x:row");
    expect(data?.qname("urn:new", "thing", "n")).toBe("n:thing");
    expect(data?.attr("xmlns:n")).toBe("urn:new");
  });

  it("reads namespaced attributes by URI", () => {
    const doc = parseXml(`<a xmlns:r="urn:rel"><b r:id="rId3" id="plain"/></a>`);
    const b = doc.root.elements()[0];
    expect(b?.attrNs("urn:rel", "id")).toBe("rId3");
    expect(b?.attr("id")).toBe("plain");
  });

  it("decodes entities in text and attributes, and normalizes white space in attributes", () => {
    const doc = parseXml(`<a v="1&#10;2\n3&amp;&lt;&#x4E2D;">x &amp; y &#128512; &quot;&apos;</a>`);
    expect(doc.root.attr("v")).toBe("1\n2 3&<中");
    expect(doc.root.text()).toBe(`x & y 😀 "'`);
  });

  it("escapes what it writes, so that the text reads back the same", () => {
    const element = xmlElement("t", { v: 'a"b\tc\nd\re<f&' }, ["1 < 2 & 3 > 0 ]]> \u0001\ud800"]);
    const back = parseXml(element.toString()).root;
    expect(back.attr("v")).toBe('a"b\tc\nd\re<f&');
    expect(back.text()).toBe("1 < 2 & 3 > 0 ]]> ");
  });

  it.each([
    ["no root", ""],
    ["text outside", "x<a/>"],
    ["two roots", "<a/><b/>"],
    ["unclosed", "<a><b></a>"],
    ["mismatch", "<a></b>"],
    ["bare ampersand", "<a>x & y</a>"],
    ["unknown entity", "<a>&nbsp;</a>"],
    ["entity zero", "<a>&#0;</a>"],
    ["entity surrogate", "<a>&#xD800;</a>"],
    ["entity too big", "<a>&#x110000;</a>"],
    ["attribute without quotes", "<a v=1/>"],
    ["repeated attribute", '<a v="1" v="2"/>'],
    ["lt in attribute", '<a v="<"/>'],
    ["no space between attributes", '<a v="1"w="2"/>'],
    ["unended comment", "<a><!-- x</a>"],
    ["unended cdata", "<a><![CDATA[x</a>"],
    ["cdata outside", "<![CDATA[x]]><a/>"],
    ["unended tag", "<a"],
    ["stray slash", "<a / >"],
    ["digit name", "<1a/>"],
  ])("refuses a part that is not well-formed: %s", (_case, text) => {
    expect(() => parseXml(text)).toThrow(HxXmlError);
  });

  it("refuses a DOCTYPE, which could carry XXE or a billion-laughs bomb", () => {
    const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><lolz>&lol2;</lolz>`;
    const xxe = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>`;
    for (const text of [laughs, xxe]) {
      try {
        parseXml(text);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(HxXmlError);
        expect(error instanceof HxXmlError ? error.code : "").toBe("doctype");
      }
    }
  });

  it("stops at its limits of depth, nodes and size", () => {
    const deep = `${"<a>".repeat(600)}${"</a>".repeat(600)}`;
    expect(() => parseXml(deep)).toThrow(/deeply/);
    const wide = `<a>${"<b/>".repeat(2000)}</a>`;
    expect(() => parseXml(wide, { maxDepth: 512, maxNodes: 1000, maxChars: 1e9 })).toThrow(/too many nodes/);
    expect(() => parseXml("<a/>", { maxDepth: 512, maxNodes: 1000, maxChars: 2 })).toThrow(/too large/);
  });

  it("never fails with anything but HxXmlError on random input, and never hangs", () => {
    const pieces = [
      "<",
      ">",
      "/",
      "a",
      "=",
      '"',
      "'",
      "&",
      ";",
      "#",
      "x",
      "!",
      "-",
      "[",
      "]",
      "?",
      " ",
      "\n",
      "中",
      "CDATA",
      "&amp;",
      "<a>",
      "</a>",
      "<!--",
      "-->",
    ];
    for (let seed = 1; seed <= 4000; seed += 1) {
      const next = random(seed);
      const parts: string[] = [];
      const length = Math.floor(next() * 40);
      for (let index = 0; index < length; index += 1) parts.push(pieces[Math.floor(next() * pieces.length)] ?? "");
      const text = parts.join("");
      try {
        const doc = parseXml(text);
        // Whatever parses writes back as it was read.
        expect(doc.toString(), `seed ${seed}`).toBe(text);
      } catch (error) {
        expect(error, `seed ${seed}: ${JSON.stringify(text)}`).toBeInstanceOf(HxXmlError);
      }
    }
  });

  it("reads UTF-8 with and without a byte order mark, and UTF-16 in both orders, and writes each back the same", () => {
    const text = `<?xml version="1.0"?><a>中文 😀</a>`;
    for (const [encoding, bom] of [
      ["utf-8", false],
      ["utf-8", true],
      ["utf-16le", true],
      ["utf-16be", true],
      ["utf-16le", false],
    ] as const) {
      const bytes = encodeText(text, encoding, bom);
      const doc = parseXmlBytes(bytes);
      expect(doc.root.text()).toBe("中文 😀");
      expect(doc.encoding).toBe(encoding);
      expect(Buffer.from(doc.toBytes()).equals(Buffer.from(bytes))).toBe(true);
    }
    expect(() => parseXmlBytes(new Uint8Array([0x3c, 0x61, 0xff, 0x3e]))).toThrow(/UTF-8/);
  });

  it("moves a node to its new parent, and refuses to put an element inside itself", () => {
    const doc = parseXml("<a><b><c/></b><d/></a>");
    const [b, d] = doc.root.elements();
    const c = b?.elements()[0];
    if (!b || !d || !c) throw new Error("setup");
    d.append(c);
    expect(doc.toString()).toBe("<a><b></b><d><c/></d></a>");
    expect(() => c.append(doc.root)).toThrow(HxXmlError);
    expect(() => b.insertBefore(new HxXmlText("x"), c)).toThrow(HxXmlError);
  });

  it("keeps a text that was not set as it was written, entities included", () => {
    const doc = parseXml("<a>x &#x41; y<b/></a>");
    doc.root.append(new HxXmlElement("c"));
    expect(doc.toString()).toBe("<a>x &#x41; y<b/><c/></a>");
  });

  it("decodes only well-formed entities", () => {
    expect(decodeEntities("a&lt;b&gt;c")).toBe("a<b>c");
    expect(() => decodeEntities("a&b")).toThrow(HxXmlError);
    expect(stripInvalid("a\u0000b\u000bc￾😀\udc00")).toBe("abc😀");
  });
});
