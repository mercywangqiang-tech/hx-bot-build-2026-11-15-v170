import { describe, expect, it } from "vitest";
import { xlsxFixture } from "./office-fixtures";
import { HxOfficeError } from "./ooxml";
import { HxWorkbook } from "./xlsx";
import { HxXmlError } from "./xml";
import { HxZipError } from "./zip";

const SHARED_AND_ARRAY =
  '<row r="6"><c r="A6"><v>1</v></c><c r="B6"><f t="shared" ref="B6:B8" si="0">A6*2</f><v>2</v></c></row>' +
  '<row r="7"><c r="A7"><v>2</v></c><c r="B7"><f t="shared" si="0"/><v>4</v></c></row>' +
  '<row r="8"><c r="A8"><v>3</v></c><c r="B8"><f t="shared" si="0"/><v>6</v></c></row>' +
  '<row r="9"><c r="D9"><f t="array" ref="D9:D10">A6:A7*2</f><v>2</v></c></row>' +
  '<row r="10"><c r="D10"><v>4</v></c></row>';

function book(): Uint8Array {
  return xlsxFixture([
    {
      name: "Data",
      rows: [
        ["Item", "Qty", "Price"],
        ["A", 2, 3.5],
        ["B", 4, { f: "B2*2", v: 4 }],
        [{ date: 45000 }, true, { f: "SUM(B2:B3)", v: 6 }],
      ],
      table: { ref: "A1:C3", columns: ["Item", "Qty", "Price"] },
      rawRows: SHARED_AND_ARRAY,
      after: '<mergeCells count="1"><mergeCell ref="E1:F2"/></mergeCells>',
    },
    {
      name: "Sheet 2",
      rows: [
        [
          { f: "Data!B2+1", v: 3 },
          { f: "NOW()", v: 1 },
        ],
      ],
    },
  ]);
}

function sales(): HxWorkbook {
  return HxWorkbook.read(
    xlsxFixture([
      {
        name: "Data",
        rows: [
          ["Region", "Product", "Sales"],
          ["East", "A", 10],
          ["West", "A", 20],
          ["East", "B", 30],
          ["West", "B", 40],
          ["East", "A", 5],
        ],
      },
    ]),
  );
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

describe("reading a workbook", () => {
  it("writes an unchanged workbook back byte for byte", () => {
    const bytes = book();
    expect(Buffer.from(HxWorkbook.read(bytes).toBytes()).equals(Buffer.from(bytes))).toBe(true);
  });

  it("reads numbers, shared strings, logical values, dates and formulas with their cached values", () => {
    const wb = HxWorkbook.read(book());
    expect(wb.sheets().map((sheet) => sheet.name)).toEqual(["Data", "Sheet 2"]);
    const rows = wb.read("Data", "A1:C4").rows.map((row) => row.map((cell) => [cell.type, cell.text, cell.formula]));
    expect(rows[0]).toEqual([
      ["string", "Item", null],
      ["string", "Qty", null],
      ["string", "Price", null],
    ]);
    expect(rows[2]?.[2]).toEqual(["number", "4", "B2*2"]);
    expect(rows[3]).toEqual([
      ["date", "2023-03-15", null],
      ["bool", "TRUE", null],
      ["number", "6", "SUM(B2:B3)"],
    ]);
    // Cells of a shared formula show their own formula.
    expect(wb.cell("Data", "B7").formula).toBe("A7*2");
  });

  it("stops at the cell limit and says so", () => {
    const result = HxWorkbook.read(book()).read("Data", "A1:C4", 4);
    expect(result.truncated).toBe(true);
  });

  it("names the sheets it does not have", () => {
    expect(errorCode(() => HxWorkbook.read(book()).read("Nope"))).toBe("invalid");
  });
});

describe("writing cells", () => {
  it("writes values and recomputes the formulas that read them, on other sheets too", () => {
    const wb = HxWorkbook.read(book());
    const result = wb.set("Data", [{ ref: "B2", input: 10 }]);
    expect(result.written.map((cell) => cell.text)).toEqual(["10"]);
    expect(result.recalculated.map((cell) => `${cell.ref}=${cell.text}`).sort()).toEqual(["A1=11", "C3=20", "C4=14"]);
    const again = HxWorkbook.read(wb.toBytes());
    expect(again.cell("Data", "C4").text).toBe("14");
    expect(again.cell("Sheet 2", "A1").text).toBe("11");
  });

  it("writes text, logical values, dates, empty cells and formulas", () => {
    const wb = HxWorkbook.read(book());
    wb.set("Data", [
      { ref: "A5", input: { date: "2026-11-19" } },
      { ref: "B5", input: "新的文字 & <xml>" },
      { ref: "C5", input: true },
      { ref: "D5", input: { formula: "=sum(b2:b3)" } },
      { ref: "B4", input: null },
    ]);
    const again = HxWorkbook.read(wb.toBytes());
    expect(again.cell("Data", "A5")).toMatchObject({ type: "date", text: "2026-11-19", value: 46345 });
    expect(again.cell("Data", "B5").text).toBe("新的文字 & <xml>");
    expect(again.cell("Data", "C5").type).toBe("bool");
    expect(again.cell("Data", "D5")).toMatchObject({ formula: "SUM(B2:B3)", text: "6" });
    expect(again.cell("Data", "B4").type).toBe("blank");
  });

  it("keeps the other cells of a shared formula when one of them is overwritten", () => {
    const wb = HxWorkbook.read(book());
    wb.set("Data", [{ ref: "B7", input: 100 }]);
    wb.set("Data", [{ ref: "A8", input: 10 }]);
    const again = HxWorkbook.read(wb.toBytes());
    expect(again.cell("Data", "B6")).toMatchObject({ formula: "A6*2", text: "2" });
    expect(again.cell("Data", "B7")).toMatchObject({ formula: null, text: "100" });
    expect(again.cell("Data", "B8")).toMatchObject({ formula: "A8*2", text: "20" });
  });

  it("leaves array formulas to Excel and asks for a full calculation on opening", () => {
    const wb = HxWorkbook.read(book());
    const result = wb.set("Data", [{ ref: "A7", input: 5 }]);
    expect(result.uncached).toEqual(["Data!D9"]);
    expect(wb.pkg.xml("xl/workbook.xml").root.toString()).toContain('fullCalcOnLoad="1"');
    expect(errorCode(() => wb.set("Data", [{ ref: "D10", input: 1 }]))).toBe("invalid");
  });

  it("writes only the first cell of merged cells", () => {
    const wb = HxWorkbook.read(book());
    expect(errorCode(() => wb.set("Data", [{ ref: "F2", input: 1 }]))).toBe("invalid");
    expect(errorCode(() => wb.set("Data", [{ ref: "E1", input: "anchor" }]))).toBe("none");
  });

  it("renames a table column with its header, and refuses an empty or repeated header", () => {
    const wb = HxWorkbook.read(book());
    wb.set("Data", [{ ref: "B1", input: "Quantity" }]);
    expect(wb.pkg.xml("xl/tables/table1.xml").root.toString()).toContain('name="Quantity"');
    expect(errorCode(() => wb.set("Data", [{ ref: "C1", input: null }]))).toBe("invalid");
    expect(errorCode(() => wb.set("Data", [{ ref: "C1", input: "item" }]))).toBe("invalid");
  });

  it("changes nothing when one input of several is bad", () => {
    const bytes = book();
    for (const bad of [
      { ref: "A3", input: { formula: "SUM(" } },
      { ref: "A3", input: { date: "2024-02-30" } },
      { ref: "A3", input: Number.POSITIVE_INFINITY },
      { ref: "A3", input: "x".repeat(32_768) },
      { ref: "A0", input: 1 },
      { ref: "C1", input: "" },
    ]) {
      const wb = HxWorkbook.read(bytes);
      expect(() => wb.set("Data", [{ ref: "A2", input: "changed" }, bad])).toThrow(HxOfficeError);
      expect(Buffer.from(wb.toBytes()).equals(Buffer.from(bytes))).toBe(true);
    }
  });

  it("counts dates in the 1904 system when the workbook uses it", () => {
    const wb = HxWorkbook.read(xlsxFixture([{ name: "S", rows: [[1]] }], { date1904: true }));
    wb.set("S", [{ ref: "A2", input: { date: "2026-11-19" } }]);
    expect(wb.cell("S", "A2")).toMatchObject({ value: 46345 - 1462, text: "2026-11-19" });
  });

  it("writes many cells quickly", () => {
    const wb = HxWorkbook.read(xlsxFixture([{ name: "S", rows: [[1]] }]));
    const started = performance.now();
    const updates = [];
    for (let row = 1; row <= 200; row += 1)
      for (let col = 0; col < 50; col += 1)
        updates.push({
          ref: `${String.fromCharCode(65 + (col % 26))}${col >= 26 ? row + 1000 : row}`,
          input: row * col,
        });
    wb.set("S", updates);
    expect(HxWorkbook.read(wb.toBytes()).cell("S", "Z200").value).toBe(200 * 25);
    expect(performance.now() - started).toBeLessThan(20_000);
  });
});

describe("filters, summaries, charts and sheets", () => {
  it("filters rows the way Excel does and shows them again", () => {
    const wb = sales();
    expect(
      wb.filter("Data", "A1:C6", [
        { column: "Region", equals: ["East"] },
        { column: "C", op: "ge", value: 10 },
      ]),
    ).toEqual({
      visible: 2,
      hidden: 3,
    });
    const sheet = wb.pkg.xml("xl/worksheets/sheet1.xml").root.toString();
    expect(sheet).toContain('<autoFilter ref="A1:C6">');
    expect(sheet.match(/<row r="(\d+)"[^>]*hidden="1"/g)?.length).toBe(3);
    expect(wb.pkg.xml("xl/workbook.xml").root.toString()).toContain("_xlnm._FilterDatabase");
    expect(wb.clearFilter("Data")).toBe(3);
    expect(wb.pkg.xml("xl/worksheets/sheet1.xml").root.toString()).not.toContain("hidden=");
  });

  it("refuses filters without data rows or with an unknown column", () => {
    expect(errorCode(() => sales().filter("Data", "A1:C1", []))).toBe("invalid");
    expect(errorCode(() => sales().filter("Data", "A1:C6", [{ column: "Nope", equals: ["x"] }]))).toBe("invalid");
  });

  it("summarizes by groups on a new sheet, with a total row", () => {
    const wb = sales();
    const result = wb.summarize(
      "Data",
      "A1:C6",
      ["Region", "Product"],
      [
        { column: "Sales", fn: "sum" },
        { column: "Sales", fn: "count", label: "N" },
      ],
    );
    expect(result.groups).toBe(4);
    const rows = HxWorkbook.read(wb.toBytes())
      .read(result.sheet)
      .rows.map((row) => row.map((cell) => cell.text));
    expect(rows).toEqual([
      ["Region", "Product", "SUM(Sales)", "N"],
      ["East", "A", "15", "2"],
      ["East", "B", "30", "1"],
      ["West", "A", "20", "1"],
      ["West", "B", "40", "1"],
      ["Total", "", "105", "5"],
    ]);
  });

  it("refuses to sum a column of text and adds no sheet", () => {
    const wb = sales();
    const before = Buffer.from(wb.toBytes());
    expect(errorCode(() => wb.summarize("Data", "A1:C6", ["Region"], [{ column: "Region", fn: "sum" }]))).toBe(
      "invalid",
    );
    expect(Buffer.from(wb.toBytes()).equals(before)).toBe(true);
  });

  it("adds a chart with its drawing", () => {
    const wb = sales();
    wb.addChart("Data", {
      type: "column",
      title: "Sales",
      categories: "A2:A6",
      series: [{ name: "Sales", values: "C2:C6" }],
    });
    const again = HxWorkbook.read(wb.toBytes());
    const chart = again.pkg.xml("xl/charts/chart1.xml").root.toString();
    expect(chart).toContain("barChart");
    expect(chart).toContain("Data!$C$2:$C$6");
    expect(again.pkg.has("xl/drawings/drawing1.xml")).toBe(true);
    expect(errorCode(() => wb.addChart("Data", { type: "line", categories: "A2:A6", series: [] }))).toBe("invalid");
  });

  it("names new sheets so that they are valid and unique", () => {
    const wb = sales();
    expect([wb.addSheet("Data"), wb.addSheet("a/b:c*?"), wb.addSheet(""), wb.addSheet("x".repeat(40))]).toEqual([
      "Data (2)",
      "a b c",
      "Sheet",
      "x".repeat(31),
    ]);
  });
});

describe("damaged files", () => {
  it("throws only HXBot's own errors for cut or changed bytes", () => {
    const bytes = book();
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let round = 0; round < 300; round += 1) {
      const copy = Uint8Array.from(
        bytes.subarray(0, round % 3 === 0 ? Math.floor(random() * bytes.length) : bytes.length),
      );
      for (let flips = 0; flips < 3; flips += 1) {
        const at = Math.floor(random() * copy.length);
        copy[at] = Math.floor(random() * 256);
      }
      try {
        const wb = HxWorkbook.read(copy);
        for (const sheet of wb.sheets()) wb.read(sheet.name);
      } catch (error) {
        expect(error instanceof HxOfficeError || error instanceof HxZipError || error instanceof HxXmlError).toBe(true);
      }
    }
  });
});
