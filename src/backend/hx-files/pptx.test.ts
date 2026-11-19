import { describe, expect, it } from "vitest";
import { PNG_2X1, pptxFixture } from "./office-fixtures";
import { HxOfficeError, HxOoxml } from "./ooxml";
import { HxPresentation, readImage } from "./pptx";
import { HxXmlError } from "./xml";
import { HxZipError } from "./zip";

function deck(): Uint8Array {
  return pptxFixture(
    [
      { title: "Cover" },
      { title: "Agenda", body: "One\nTwo", notes: "say hi" },
      { title: "Pic", body: "x", picture: true },
    ],
    { sections: [1, 2] },
  );
}

function brief(presentation: HxPresentation): string[] {
  return presentation.slides().map((slide) => `${slide.id}|${slide.title}|pic${slide.pictures}|${slide.notes}`);
}

/** The slide ids of each section, in order. */
function sections(presentation: HxPresentation): string[] {
  const xml = presentation.pkg.xml("ppt/presentation.xml").root.toString();
  return (xml.match(/<p14:section .*?<\/p14:section>/g) ?? []).map((section) =>
    [...section.matchAll(/sldId id="(\d+)"/g)].map((match) => match[1]).join(","),
  );
}

/** Parts that no relationship reaches any more. */
function orphans(bytes: Uint8Array): string[] {
  const pkg = HxOoxml.read(bytes);
  const reachable = pkg.reachable();
  return pkg.zip
    .names()
    .filter((name) => !name.endsWith(".rels") && name !== "[Content_Types].xml" && !reachable.has(name));
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

describe("reading a presentation", () => {
  it("writes an unchanged presentation back byte for byte", () => {
    const bytes = deck();
    expect(Buffer.from(HxPresentation.read(bytes).toBytes()).equals(Buffer.from(bytes))).toBe(true);
  });

  it("reads each slide's layout, title, texts, pictures and notes", () => {
    const presentation = HxPresentation.read(deck());
    expect(
      presentation
        .slides()
        .map((slide) => [
          slide.layout,
          slide.title,
          slide.shapes.map((shape) => `${shape.placeholder}:${shape.text}`),
          slide.pictures,
          slide.notes,
        ]),
    ).toEqual([
      ["Title Slide", "Cover", ["ctrTitle:Cover", "subTitle:"], 0, ""],
      ["Title and Content", "Agenda", ["title:Agenda", ":One\nTwo"], 0, "say hi"],
      ["Title and Content", "Pic", ["title:Pic", ":x"], 1, ""],
    ]);
    expect(presentation.layouts().map((layout) => layout.name)).toEqual(["Title Slide", "Title and Content"]);
  });
});

describe("changing slides", () => {
  it("adds a slide from a layout, in the section of its neighbour", () => {
    const presentation = HxPresentation.read(deck());
    expect(presentation.addSlide({ title: "New", body: "A\nB", at: 1 })).toBe(1);
    const again = HxPresentation.read(presentation.toBytes());
    expect(brief(again)[1]).toBe("259|New|pic0|");
    expect(again.slides()[1]?.layout).toBe("Title and Content");
    expect(again.slides()[1]?.shapes.map((shape) => shape.text)).toEqual(["New", "A\nB"]);
    expect(sections(again)).toEqual(["256,259", "257,258"]);
  });

  it("puts the body only into the first body place of a layout", () => {
    const presentation = HxPresentation.read(deck());
    presentation.addSlide({ layout: "Title Slide", title: "T", body: "B" });
    expect(
      presentation
        .slides()
        .at(-1)
        ?.shapes.map((shape) => shape.text),
    ).toEqual(["T", "B"]);
  });

  it("copies a slide with its notes and shares its picture", () => {
    const presentation = HxPresentation.read(deck());
    expect(presentation.duplicateSlide(1)).toBe(2);
    expect(presentation.duplicateSlide(3)).toBe(4);
    const bytes = presentation.toBytes();
    const again = HxPresentation.read(bytes);
    expect(brief(again)).toEqual([
      "256|Cover|pic0|",
      "257|Agenda|pic0|say hi",
      "259|Agenda|pic0|say hi",
      "258|Pic|pic1|",
      "260|Pic|pic1|",
    ]);
    expect(sections(again)).toEqual(["256", "257,259,258,260"]);
    // The copied notes page points back at the copy, not at the original.
    const copy = again.slides()[2];
    const notes = again.pkg.rels(copy?.part ?? "").find((rel) => rel.type.endsWith("/notesSlide"));
    expect(again.pkg.rels(notes?.target ?? "").find((rel) => rel.type.endsWith("/slide"))?.target).toBe(copy?.part);
    expect(again.pkg.zip.names().filter((name) => name.startsWith("ppt/media/"))).toEqual(["ppt/media/image1.png"]);
    expect(orphans(bytes)).toEqual([]);
  });

  it("moves a slide into the section where it lands", () => {
    const presentation = HxPresentation.read(deck());
    presentation.moveSlide(2, 0);
    expect(brief(presentation).map((line) => line.split("|")[0])).toEqual(["258", "256", "257"]);
    expect(sections(presentation)).toEqual(["258,256", "257"]);
  });

  it("deletes a slide with its notes and the parts only it used, and keeps the last slide", () => {
    const presentation = HxPresentation.read(deck());
    presentation.deleteSlide(1);
    presentation.deleteSlide(1);
    const bytes = presentation.toBytes();
    const pkg = HxOoxml.read(bytes);
    expect(pkg.zip.names().some((name) => name.startsWith("ppt/notesSlides/"))).toBe(false);
    expect(pkg.zip.names().some((name) => name.startsWith("ppt/media/"))).toBe(false);
    expect(orphans(bytes)).toEqual([]);
    expect(sections(HxPresentation.read(bytes))).toEqual(["256", ""]);
    expect(errorCode(() => presentation.deleteSlide(0))).toBe("invalid");
  });

  it("sets titles, bodies and notes, making a notes page where there is none", () => {
    const presentation = HxPresentation.read(deck());
    presentation.setText(0, "title", "封面 & <标题>");
    presentation.setText(2, "body", "Line 1\nLine 2");
    presentation.setNotes(0, "first notes");
    presentation.setNotes(1, "changed");
    const again = HxPresentation.read(presentation.toBytes());
    expect(again.slides().map((slide) => [slide.title, slide.notes])).toEqual([
      ["封面 & <标题>", "first notes"],
      ["Agenda", "changed"],
      ["Pic", ""],
    ]);
    expect(again.slides()[2]?.shapes[1]?.text).toBe("Line 1\nLine 2");
  });

  it("changes a slide's layout", () => {
    const presentation = HxPresentation.read(deck());
    expect(presentation.setLayout(1, "title")).toBe("Title Slide");
    expect(HxPresentation.read(presentation.toBytes()).slides()[1]?.layout).toBe("Title Slide");
  });

  it("names what it cannot find", () => {
    const presentation = HxPresentation.read(deck());
    expect(errorCode(() => presentation.setText(0, "Nope", "x"))).toBe("invalid");
    expect(errorCode(() => presentation.setText(9, "title", "x"))).toBe("invalid");
    expect(errorCode(() => presentation.setLayout(0, "nope"))).toBe("invalid");
    expect(errorCode(() => presentation.replaceImage(2, 5, readImage(PNG_2X1)))).toBe("invalid");
    expect(errorCode(() => presentation.moveSlide(Number.NaN, 0))).toBe("invalid");
  });
});

describe("pictures", () => {
  it("reads the size of PNG, GIF and JPEG pictures and refuses anything else", () => {
    expect(readImage(PNG_2X1)).toMatchObject({ type: "png", width: 2, height: 1 });
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 3, 0, 5, 0, 0, 0, 0]);
    expect(readImage(gif)).toMatchObject({ type: "gif", width: 3, height: 5 });
    // SOI, an APP0 segment, then a baseline frame of 7 × 9.
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 9, 0, 7, 1, 1, 0x11, 0, 0,
    ]);
    expect(readImage(jpeg)).toMatchObject({ type: "jpeg", width: 7, height: 9 });
    for (const bad of [Uint8Array.from([1, 2, 3]), Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])])
      expect(errorCode(() => readImage(bad))).toBe("invalid");
  });

  it("adds a picture centred at its own proportions", () => {
    const presentation = HxPresentation.read(deck());
    presentation.addImage(0, readImage(PNG_2X1));
    const xml = presentation.pkg.xml(presentation.slides()[0]?.part ?? "").root.toString();
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(xml.slice(xml.indexOf("<p:pic>")));
    expect(Number(ext?.[1]) / Number(ext?.[2])).toBeCloseTo(2, 3);
  });

  it("replaces a picture inside the old box at the new proportions, without the old crop", () => {
    const presentation = HxPresentation.read(deck());
    presentation.replaceImage(2, 0, { ...readImage(PNG_2X1), width: 1, height: 2 });
    const xml = presentation.pkg.xml(presentation.slides()[2]?.part ?? "").root.toString();
    expect(xml).toContain('<a:off x="1600200" y="914400"/><a:ext cx="457200" cy="914400"/>');
    expect(xml).not.toContain("srcRect");
    expect(orphans(presentation.toBytes())).toEqual([]);
  });
});

describe("damaged presentations", () => {
  it("throws only HXBot's own errors for cut or changed bytes", () => {
    const bytes = deck();
    let seed = 13;
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
        const presentation = HxPresentation.read(copy);
        presentation.slides();
        presentation.duplicateSlide(0);
        presentation.toBytes();
      } catch (error) {
        expect(error instanceof HxOfficeError || error instanceof HxZipError || error instanceof HxXmlError).toBe(true);
      }
    }
  });
});
