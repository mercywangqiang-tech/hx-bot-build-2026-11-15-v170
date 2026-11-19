import { describe, expect, it } from "vitest";
import {
  checkFormula,
  colName,
  colNumber,
  dateSerial,
  type HxCellPos,
  HxEvaluator,
  type HxScalar,
  HxUnknown,
  numberText,
  parseRange,
  serialParts,
  shiftFormula,
  tokenize,
} from "./formula";
import { normalizeFormula, parseDate } from "./xlsx";

// Columns A–D of sheet S, rows 1–5; A2 holds the text "5", A4 is empty.
const cells: Record<string, HxScalar> = {
  "S!A1": 1,
  "S!A2": "5",
  "S!A3": 3,
  "S!A5": "apple",
  "S!B1": 10,
  "S!B2": 20,
  "S!B3": 30,
  "S!B4": 40,
  "S!B5": 50,
  "S!C1": "a",
  "S!C2": "b",
  "S!C3": "c",
  "S!C4": "a*b",
  "S!C5": "ab",
  "S!D1": 1,
  "S!D2": 2,
  "S!D3": 3,
  "S!D4": 4,
  "S!D5": 5,
  "Sheet 2!A1": 7,
};

function evaluate(formula: string, date1904 = false): HxScalar | "UNKNOWN" {
  const evaluator = new HxEvaluator({
    sheet: "S",
    date1904,
    hasSheet: (sheet) => sheet === "S" || sheet === "Sheet 2",
    extent: () => ({ row: 5, col: 4 }),
    cell: (sheet: string, pos: HxCellPos) => cells[`${sheet}!${colName(pos.col)}${pos.row}`] ?? null,
  });
  try {
    const value = evaluator.evaluate(formula);
    return typeof value === "object" && value !== null && "error" in value ? value.error : value;
  } catch (error) {
    if (error instanceof HxUnknown) return "UNKNOWN";
    throw error;
  }
}

describe("formula evaluation follows Excel", () => {
  const cases: [string, HxScalar | "UNKNOWN"][] = [
    // Operators and their order: unary minus binds before ^, and ^ goes left to right.
    ["1+2*3", 7],
    ["(1+2)*3", 9],
    ["-2^2", 4],
    ["2^3^2", 64],
    ["50%", 0.5],
    ["10%*10", 1],
    ["1++2", 3],
    // Errors spread, and division by zero is #DIV/0!.
    ["10/0", "#DIV/0!"],
    ["1/0+1", "#DIV/0!"],
    ["#N/A", "#N/A"],
    ["1E+308*10", "#NUM!"],
    ["SQRT(-1)", "#NUM!"],
    // Text: & joins, comparisons ignore case, numbers sort before text, text that is a number counts.
    ['"a"&"b"', "ab"],
    ["1&2", "12"],
    ['TRUE&""', "TRUE"],
    ['"A"="a"', true],
    ['"a"<"b"', true],
    ['"abc">"ABD"', false],
    ['1<"a"', true],
    ['"1"+1', 2],
    ['"x"+1', "#VALUE!"],
    // Numbers compare to 15 significant digits.
    ["0.1+0.2=0.3", true],
    ["1=1.0000000000000001", true],
    // SUM skips text in ranges but counts text numbers and logical values given directly.
    ["SUM(A1:A3)", 4],
    ["SUM(A1:A5)", 4],
    ['SUM("5",1)', 6],
    ["SUM(1,TRUE)", 2],
    ["SUM(B:B)", 150],
    ["AVERAGE(A4)", "#DIV/0!"],
    ["MEDIAN(1,3,2,4)", 2.5],
    ["COUNT(A1:A5)", 2],
    ["COUNTA(A1:A5)", 4],
    ["COUNTBLANK(A1:A5)", 1],
    ["MAX(A1:A5)", 3],
    ["MIN(B1:B5)", 10],
    ["PRODUCT(D1:D4)", 24],
    ["SUMPRODUCT(B1:B3,D1:D3)", 140],
    // Rounding is half away from zero, on the decimal value (1.005 is 1.01, not 1.00).
    ["ROUND(2.5,0)", 3],
    ["ROUND(-2.5,0)", -3],
    ["ROUND(1.005,2)", 1.01],
    ["ROUND(1234.5678,-2)", 1200],
    ["ROUNDDOWN(-1.9,0)", -1],
    ["ROUNDUP(-1.1,0)", -2],
    ["INT(-1.5)", -2],
    ["MOD(-3,2)", 1],
    ["MOD(3,-2)", -1],
    ["MOD(1,0)", "#DIV/0!"],
    ["POWER(2,10)", 1024],
    ["ABS(-3)", 3],
    // Logic.
    ['IF(1>2,"y")', false],
    ['IF("TRUE",1,2)', 1],
    ["IF(A5,1,2)", "#VALUE!"],
    ['IFERROR(1/0,"x")', "x"],
    ['AND("x")', "#VALUE!"],
    ["AND(A1:A5)", true],
    ["OR(0,0)", false],
    ["NOT(0)", true],
    ["ISNUMBER(A2)", false],
    ["ISTEXT(A2)", true],
    ["ISBLANK(A4)", true],
    ["ISNA(NA())", true],
    ["ISERR(NA())", false],
    ["ISERROR(1/0)", true],
    // Criteria: comparisons, wildcards (with ~ escaping), blank, and numbers kept as text.
    ['COUNTIF(B1:B5,">25")', 3],
    ['COUNTIF(C1:C5,"a*")', 3],
    ['COUNTIF(C1:C5,"?b")', 1],
    ['COUNTIF(C1:C5,"a~*b")', 1],
    ['COUNTIF(C1:C5,"<>a")', 4],
    ['COUNTIF(A1:A5,"")', 1],
    ["COUNTIF(A1:A5,5)", 1],
    ['COUNTIF(A1:A5,"5")', 1],
    ['SUMIF(C1:C5,"a",B1:B5)', 10],
    ['AVERAGEIF(B1:B5,">20")', 40],
    // Lookups.
    ['VLOOKUP("b",C1:D5,2,FALSE)', 2],
    ['VLOOKUP("z",C1:D5,2,FALSE)', "#N/A"],
    ['VLOOKUP("b",C1:D5,3,FALSE)', "#REF!"],
    ["VLOOKUP(25,B1:D5,3,TRUE)", 2],
    ["MATCH(30,B1:B5,0)", 3],
    ["MATCH(35,B1:B5,1)", 3],
    ["MATCH(5,B1:B5,1)", "#N/A"],
    ["INDEX(B1:D5,2,3)", 2],
    ["INDEX(B1:D5,9,1)", "#REF!"],
    // Dates, with Excel's 29 February 1900 (serial 60) and month and day overflow.
    ["DATE(2024,2,29)", 45351],
    ["YEAR(45351)", 2024],
    ["MONTH(45351)", 2],
    ["DAY(45351)", 29],
    ["DATE(1900,2,29)", 60],
    ["DATE(1900,3,1)", 61],
    ["DATE(1900,1,1)", 1],
    ["DATE(1900,3,0)", 60],
    ["MONTH(60)", 2],
    ["DAY(60)", 29],
    ["DAY(0)", 0],
    ["DATE(2024,13,1)", 45658],
    ["DATE(2024,1,0)", 45291],
    ["DATE(124,1,1)", 45292],
    ["DATE(-1,1,1)", "#NUM!"],
    ["DATE(10000,1,1)", "#NUM!"],
    ["YEAR(-1)", "#NUM!"],
    // Text functions count characters, not bytes.
    ['LEN("中文")', 2],
    ['LEFT("abc",2)', "ab"],
    ['MID("abc",2,5)', "bc"],
    ['RIGHT("abc")', "c"],
    ['TRIM("  a   b ")', "a b"],
    ['UPPER("ab")', "AB"],
    ['CONCATENATE(1,"a",TRUE)', "1aTRUE"],
    // Other sheets, and what HXBot leaves for Excel to compute.
    ["'Sheet 2'!A1+1", 8],
    ["Nope!A1", "UNKNOWN"],
    ["NOW()", "UNKNOWN"],
    ["RAND()", "UNKNOWN"],
    ['INDIRECT("A1")', "UNKNOWN"],
    ["(1,2)", "UNKNOWN"],
    ["SUM(A1:B2 B1:C3)", "UNKNOWN"],
    ["SUM( A1 , 2 )", 3],
    ["SUM(1,2", "UNKNOWN"],
  ];
  it.each(cases)("%s", (formula, expected) => {
    const value = evaluate(formula);
    if (typeof expected === "number" && typeof value === "number") expect(value).toBeCloseTo(expected, 9);
    else expect(value).toBe(expected);
  });

  it("counts days in the 1904 system without the 1900 leap day", () => {
    expect(evaluate("DATE(1904,1,1)", true)).toBe(0);
    expect(evaluate("DATE(2024,2,29)", true)).toBe(45351 - 1462);
    expect(evaluate("YEAR(0)", true)).toBe(1904);
  });
});

describe("dates", () => {
  it("round-trips every day from 1900 to 2100 through serial numbers", () => {
    for (let serial = 1; serial < 73_051; serial += 1) {
      const { year, month, day } = serialParts(serial);
      expect(dateSerial(year, month, day)).toBe(serial);
    }
  });

  it("reads date texts, including Excel's 29 February 1900, and refuses impossible ones", () => {
    expect(parseDate("1900-02-29")).toBe(60);
    expect(parseDate("1900-03-01")).toBe(61);
    expect(parseDate("2024-02-30")).toBeNull();
    expect(parseDate("2026/1/2")).toBe(46024);
    expect(parseDate("2026-11-19 08:30")).toBeCloseTo(46345 + 8.5 / 24, 9);
    expect(parseDate("2026-11-19 24:00")).toBeNull();
    expect(parseDate("19/11/2026")).toBeNull();
    expect(parseDate("2026-11-19", true)).toBe(46345 - 1462);
  });
});

describe("formula text", () => {
  it("tokenizes so that the tokens give the formula back", () => {
    for (const formula of [
      'IF(A1>=1,"x""y",#N/A)',
      "'My ''Sheet'''!A1:B2+[1]Ext!C3",
      "SUM( A1 , 2 )",
      "{1,2;3,4}",
      "Table1[[#This Row],[Amount]]*2",
      "-$A$1%^2",
    ]) {
      expect(
        tokenize(formula)
          .map((token) => token.text)
          .join(""),
      ).toBe(formula);
    }
  });

  it("shifts relative references and keeps absolute ones, strings and functions", () => {
    expect(shiftFormula("A1+$B$2+B$3+$C4", 1, 1)).toBe("B2+$B$2+C$3+$C5");
    expect(shiftFormula("SUM(A1:B2)", 1, 1)).toBe("SUM(B2:C3)");
    expect(shiftFormula("'My Sheet'!A1*2", 1, 1)).toBe("'My Sheet'!B2*2");
    expect(shiftFormula('"A1"&A1', 1, 1)).toBe('"A1"&B2');
    expect(shiftFormula("LOG10(A1)", 0, 1)).toBe("LOG10(B1)");
    expect(shiftFormula("SUM(A:A)", 5, 0)).toBe("SUM(A:A)");
    expect(shiftFormula("SUM(A:A)", 0, 1)).toBe("SUM(B:B)");
    expect(shiftFormula("SUM(1:1)", 1, 0)).toBe("SUM(2:2)");
  });

  it("turns references shifted off the sheet into #REF!", () => {
    expect(shiftFormula("A1", -1, 0)).toBe("#REF!");
    expect(shiftFormula("A1048576", 1, 0)).toBe("#REF!");
    expect(shiftFormula("XFD1+1", 0, 1)).toBe("#REF!+1");
  });

  it("checks the syntax", () => {
    for (const bad of ["SUM(1,2", "1+", "A1:", "IF(", '"abc', "=SUM(1)"]) expect(() => checkFormula(bad)).toThrow();
    for (const good of ["1++2", "SUM(A1:B2)", "-(-1)", "A1:B2 B1:C3"]) expect(() => checkFormula(good)).not.toThrow();
  });

  it("writes formulas the way Excel stores them", () => {
    expect(normalizeFormula("=sum(a1:b2)")).toBe("SUM(A1:B2)");
    expect(normalizeFormula("concat(A1)")).toBe("_xlfn.CONCAT(A1)");
    expect(normalizeFormula("_xlfn.concat(a1)")).toBe("_xlfn.CONCAT(A1)");
    expect(normalizeFormula("xlookup(1,a:a,b:b)")).toBe("_xlfn.XLOOKUP(1,A:A,B:B)");
    expect(normalizeFormula("'my sheet'!a1+if(true,#n/a,\"abc a1\")")).toBe("'my sheet'!A1+IF(TRUE,#N/A,\"abc a1\")");
    expect(normalizeFormula("myName*2")).toBe("myName*2");
    expect(() => normalizeFormula("   ")).toThrow();
    expect(() => normalizeFormula("SUM(")).toThrow();
    expect(() => normalizeFormula(`1+${"1+".repeat(5000)}1`)).toThrow();
  });

  it("names columns and ranges", () => {
    expect([colName(1), colName(26), colName(27), colName(16_384)]).toEqual(["A", "Z", "AA", "XFD"]);
    expect([colNumber("AA"), colNumber("XFD")]).toEqual([27, 16_384]);
    expect(parseRange("B2:A1")).toEqual({ start: { row: 1, col: 1 }, end: { row: 2, col: 2 } });
    expect(parseRange("A0")).toBeNull();
    expect(parseRange("XFE1")).toBeNull();
  });

  it("shows numbers with 15 significant digits", () => {
    expect(numberText(0.1 + 0.2)).toBe("0.3");
    expect(numberText(-0)).toBe("0");
    expect(numberText(1 / 3)).toBe("0.333333333333333");
    expect(numberText(1e21)).toBe("1E+21");
  });
});
