import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { concat, crc32, decodeName, HxZip, HxZipError, hxZipSafePath } from "./zip";
import { encoder, rawZip, u16, u32 } from "./zip-fixtures";

const text = (value: string) => encoder.encode(value);

function code(body: () => unknown): string {
  try {
    body();
  } catch (error) {
    return error instanceof HxZipError ? error.code : `other: ${String(error)}`;
  }
  return "none";
}

describe("HxZip", () => {
  it("writes an unchanged archive back byte for byte, and changes only the changed entry", () => {
    const original = rawZip(
      [
        { name: "[Content_Types].xml", content: text("<Types/>") },
        { name: "word/document.xml", content: text("<w:document>hello</w:document>".repeat(50)) },
        { name: "media/image1.png", content: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), method: 0 },
      ],
      { comment: "made by test" },
    );
    const zip = HxZip.read(original);
    expect(Buffer.from(zip.toBytes()).equals(Buffer.from(original))).toBe(true);
    zip.setText("word/document.xml", "<w:document>changed</w:document>");
    const changed = HxZip.read(zip.toBytes());
    expect(changed.names()).toEqual(["[Content_Types].xml", "word/document.xml", "media/image1.png"]);
    expect(changed.readText("word/document.xml")).toBe("<w:document>changed</w:document>");
    expect(changed.readText("[Content_Types].xml")).toBe("<Types/>");
    expect([...changed.read("media/image1.png")]).toEqual([137, 80, 78, 71, 1, 2, 3]);
    expect(new TextDecoder().decode(changed.comment)).toBe("made by test");
  });

  it("reads entries with data descriptors, signed and bare, and writes them without", () => {
    const original = rawZip([
      { name: "a.xml", content: text("<a/>".repeat(100)), descriptor: true },
      { name: "b.xml", content: text("<b/>"), descriptor: true, bareDescriptor: true },
      { name: "c.xml", content: text("<c/>") },
    ]);
    const zip = HxZip.read(original);
    expect(zip.readText("b.xml")).toBe("<b/>");
    const again = HxZip.read(zip.toBytes());
    expect(again.readText("a.xml")).toBe("<a/>".repeat(100));
    expect(again.readText("c.xml")).toBe("<c/>");
  });

  it("reads ZIP64 records and an archive behind a self-extracting stub", () => {
    const zip = HxZip.read(
      rawZip([{ name: "x.txt", content: text("zip64 entry"), zip64: true }], {
        prefix: new Uint8Array(333).fill(0x4d),
      }),
    );
    expect(zip.readText("x.txt")).toBe("zip64 entry");
    expect(HxZip.read(zip.toBytes()).readText("x.txt")).toBe("zip64 entry");
  });

  it("refuses entries that overlap, the non-recursive zip bomb", () => {
    const bomb = rawZip(
      [
        { name: "a", content: new Uint8Array(1000) },
        { name: "b", content: new Uint8Array(1000) },
      ],
      { overlap: true },
    );
    expect(code(() => HxZip.read(bomb))).toBe("corrupt");
  });

  it("refuses an entry whose local header stands inside the data of another (quoted overlap)", () => {
    // Entry b's header and data are the stored content of entry a, as in Fifield's zip bomb.
    const inner = deflateRawSync(new Uint8Array(100_000));
    const bLocal = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(8),
      ...u16(0),
      ...u16(0),
      ...u32(crc32(new Uint8Array(100_000))),
      ...u32(inner.length),
      ...u32(100_000),
      ...u16(1),
      ...u16(0),
      0x62,
    ]);
    const aContent = concat([bLocal, inner]);
    const aLocal = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc32(aContent)),
      ...u32(aContent.length),
      ...u32(aContent.length),
      ...u16(1),
      ...u16(0),
      0x61,
    ]);
    const central = (name: number, method: number, crc: number, size: number, csize: number, offset: number) =>
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0),
        ...u16(method),
        ...u16(0),
        ...u16(0),
        ...u32(crc),
        ...u32(csize),
        ...u32(size),
        ...u16(1),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        name,
      ]);
    const cd = concat([
      central(0x61, 0, crc32(aContent), aContent.length, aContent.length, 0),
      central(0x62, 8, crc32(new Uint8Array(100_000)), 100_000, inner.length, aLocal.length),
    ]);
    const body = concat([aLocal, aContent]);
    const end = new Uint8Array([
      ...u32(0x06054b50),
      ...u16(0),
      ...u16(0),
      ...u16(2),
      ...u16(2),
      ...u32(cd.length),
      ...u32(body.length),
      ...u16(0),
    ]);
    expect(code(() => HxZip.read(concat([body, cd, end])))).toBe("corrupt");
  });

  it("refuses an entry that inflates to more than it states", () => {
    const zip = HxZip.read(rawZip([{ name: "big", content: new Uint8Array(5_000_000), statedSize: 10 }]));
    expect(code(() => zip.read("big"))).toBe("corrupt");
  });

  it("refuses archives over its limits before inflating anything", () => {
    const many = rawZip(Array.from({ length: 30 }, (_, index) => ({ name: `f${index}`, content: text("x") })));
    expect(code(() => HxZip.read(many, { maxEntries: 20, maxEntrySize: 1e9, maxTotalSize: 1e9 }))).toBe("too-large");
    const stated = rawZip([{ name: "huge", content: text("x"), statedSize: 2_000_000_000 }]);
    expect(code(() => HxZip.read(stated))).toBe("too-large");
  });

  it("refuses two entries with one name, and a local header that names another entry", () => {
    expect(
      code(() =>
        HxZip.read(
          rawZip([
            { name: "a", content: text("1") },
            { name: "a", content: text("2") },
          ]),
        ),
      ),
    ).toBe("duplicate-name");
    const bytes = rawZip([{ name: "abc", content: text("1") }]);
    bytes[30] = 0x7a; // the local header's name now says "zbc"
    expect(code(() => HxZip.read(bytes))).toBe("corrupt");
  });

  it("does not read encrypted entries or unknown methods, and names OLE files", () => {
    const encrypted = HxZip.read(rawZip([{ name: "s", content: text("x"), flags: 1, method: 0 }]));
    expect(encrypted.entries()[0]?.encrypted).toBe(true);
    expect(code(() => encrypted.read("s"))).toBe("encrypted");
    const bzip = HxZip.read(rawZip([{ name: "s", content: text("x"), method: 12 }]));
    expect(code(() => bzip.read("s"))).toBe("unsupported");
    const ole = new Uint8Array(512);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(code(() => HxZip.read(ole))).toBe("encrypted");
    expect(code(() => HxZip.read(text("not a zip at all, just text")))).toBe("not-zip");
  });

  it("fails a damaged entry on its CRC", () => {
    const bytes = rawZip([{ name: "a.txt", content: text("hello world"), method: 0 }]);
    const at = Buffer.from(bytes).indexOf("hello");
    bytes[at] = 0x48;
    expect(code(() => HxZip.read(bytes).read("a.txt"))).toBe("corrupt");
  });

  it("answers every cut and every flipped byte of an archive with HxZipError or the right content", () => {
    const original = rawZip([
      { name: "one.xml", content: text("<one>".repeat(40)) },
      { name: "two.bin", content: new Uint8Array(300).map((_, index) => index * 7), method: 0 },
      { name: "three.xml", content: text("三".repeat(30)), descriptor: true },
    ]);
    const check = (bytes: Uint8Array) => {
      try {
        const zip = HxZip.read(bytes);
        for (const name of zip.names()) {
          try {
            zip.read(name);
          } catch (error) {
            expect(error).toBeInstanceOf(HxZipError);
          }
        }
        HxZip.read(zip.toBytes());
      } catch (error) {
        expect(error).toBeInstanceOf(HxZipError);
      }
    };
    for (let cut = 0; cut < original.length; cut += 1) check(original.subarray(0, cut));
    for (let at = 0; at < original.length; at += 1) {
      for (const value of [0x00, 0xff, (original[at] ?? 0) ^ 0x01]) {
        const bytes = original.slice();
        bytes[at] = value ?? 0;
        check(bytes);
      }
    }
  });

  it("decodes names: the UTF-8 flag, an Info-ZIP Unicode path, GB18030 from Windows, UTF-8 from macOS, code page 437", () => {
    expect(decodeName(text("报表.xlsx"), 0x800, new Uint8Array(0))).toBe("报表.xlsx");
    expect(decodeName(text("报表.xlsx"), 0, new Uint8Array(0))).toBe("报表.xlsx");
    const gbk = new Uint8Array([0xb1, 0xa8, 0xb1, 0xed, 0x2e, 0x74, 0x78, 0x74]);
    expect(decodeName(gbk, 0, new Uint8Array(0))).toBe("报表.txt");
    const unicodeName = text("数据.csv");
    const extra = new Uint8Array([
      ...u16(0x7075),
      ...u16(5 + unicodeName.length),
      1,
      ...u32(crc32(gbk)),
      ...unicodeName,
    ]);
    expect(decodeName(gbk, 0, extra)).toBe("数据.csv");
    expect(decodeName(new Uint8Array([0x80, 0xff]), 0, new Uint8Array(0)).length).toBe(2);
  });

  it("marks symbolic links and folders", () => {
    const zip = HxZip.read(
      rawZip([
        {
          name: "link",
          content: text("/etc/passwd"),
          versionMadeBy: 0x031e,
          externalAttrs: (0o120777 << 16) >>> 0,
          method: 0,
        },
        { name: "dir/", content: new Uint8Array(0), method: 0 },
      ]),
    );
    expect(zip.entry("link")?.symlink).toBe(true);
    expect(zip.entry("dir/")?.directory).toBe(true);
  });

  it("adds, replaces and deletes entries, and keeps the order", () => {
    const zip = HxZip.create();
    zip.setText("a.xml", "<a/>");
    zip.setText("中文/b.xml", "<b/>");
    zip.set("c.bin", new Uint8Array([1, 2, 3]), { compress: false });
    zip.delete("a.xml");
    zip.setText("a.xml", "<a2/>");
    const back = HxZip.read(zip.toBytes());
    expect(back.names()).toEqual(["中文/b.xml", "c.bin", "a.xml"]);
    expect(back.readText("中文/b.xml")).toBe("<b/>");
    expect(back.entry("c.bin")?.method).toBe(0);
    expect(code(() => zip.setText("/abs", "x"))).toBe("corrupt");
    expect(code(() => zip.setText("a\\b", "x"))).toBe("corrupt");
  });
});

describe("hxZipSafePath", () => {
  it.each([
    ["a/b/c.txt", "a/b/c.txt"],
    ["./a//b/", "a/b"],
    ["dir\\file.txt", "dir/file.txt"],
    ["报表/数据.xlsx", "报表/数据.xlsx"],
  ])("keeps %s as %s", (name, path) => {
    expect(hxZipSafePath(name)).toBe(path);
  });

  it.each([
    "../x",
    "a/../../x",
    "/etc/passwd",
    "\\\\server\\share",
    "C:/Windows/x",
    "c:x",
    "a/CON",
    "a/com1.txt",
    "nul",
    "a/b.",
    "a/b ",
    "a\u0001b",
    "a:b",
    "a|b",
    "",
    ".",
    "./",
    `${"a/".repeat(70)}x`,
  ])("refuses %j", (name) => {
    expect(hxZipSafePath(name)).toBeNull();
  });
});
