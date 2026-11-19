#!/usr/bin/env python3
"""HXBot v1.7.4 (CU-07): reads the results of the skill samples again, with libraries that are not HXBot's.

scripts/hx-skill-samples-e2e.ts writes manifest.json and work/. This script opens every file of the
manifest with openpyxl, python-docx, python-pptx, pypdf or zipfile and compares it with what the
manifest expects. It changes nothing.

    pip install openpyxl python-docx python-pptx pypdf
    python3 hx/computer-check/skills_crosscheck.py <folder of the run>

Writes <folder>/crosscheck.json and <folder>/crosscheck.md. Exit code 1 when one check fails.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def norm(value):
    """A cell value as text, the way the samples write the expectations."""
    if isinstance(value, datetime.datetime):
        return value.date().isoformat() if value.time() == datetime.time(0) else value.isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return "" if value is None else str(value)


def same(actual, expected) -> bool:
    return norm(actual) == norm(expected)


class Checks:
    def __init__(self) -> None:
        self.items: list[tuple[bool, str]] = []

    def eq(self, what: str, actual, expected) -> None:
        ok = actual == expected
        self.items.append((ok, f"{what} {actual!r}" + ("" if ok else f"（应为 {expected!r}）")))

    def yes(self, what: str, ok: bool) -> None:
        self.items.append((bool(ok), f"{what}：{'是' if ok else '否'}"))

    @property
    def passed(self) -> bool:
        return all(ok for ok, _ in self.items) and bool(self.items)

    def detail(self) -> str:
        return "；".join(f"{'✓' if ok else '✗'} {text}" for ok, text in self.items)


def check_xlsx(path: Path, expect: dict, c: Checks) -> None:
    import openpyxl

    book = openpyxl.load_workbook(path)
    cached = openpyxl.load_workbook(path, data_only=True)
    if "sheets" in expect:
        c.eq("表", book.sheetnames, expect["sheets"])
    sheet = expect.get("sheet") or (book.sheetnames[0] if expect.get("firstSheet") else None)
    if not sheet:
        if "chartContains" in expect:
            with zipfile.ZipFile(path) as archive:
                charts = [n for n in archive.namelist() if re.fullmatch(r"xl/charts/chart\d+\.xml", n)]
                xml = archive.read(charts[0]).decode("utf-8") if charts else ""
            for text in expect["chartContains"]:
                c.yes(f"图表里有 {text}", text in xml)
        return
    if sheet not in book.sheetnames:
        c.yes(f"有表 {sheet}", False)
        return
    ws = book[sheet]
    for ref, value in expect.get("cells", {}).items():
        c.yes(f"{ref}={value}", same(ws[ref].value, value))
    for ref, formula in expect.get("formulas", {}).items():
        c.eq(f"{ref} 的公式", ws[ref].value, formula)
    for ref, value in expect.get("cached", {}).items():
        c.yes(f"{ref} 存着的值={value}", same(cached[sheet][ref].value, value))
    if "autoFilter" in expect:
        c.eq("筛选范围", ws.auto_filter.ref, expect["autoFilter"])
    if "hiddenRows" in expect:
        hidden = sorted(index for index, dim in ws.row_dimensions.items() if dim.hidden)
        c.eq("藏起来的行", hidden, expect["hiddenRows"])
    values = [norm(cell.value) for row in ws.iter_rows() for cell in row if cell.value is not None]
    for text in expect.get("contains", []):
        c.yes(f"有 {text}", text in values)
    for text in expect.get("once", []):
        c.eq(f"{text} 出现次数", values.count(text), 1)
    # Totals are live formulas: compare the values Excel would show (the cached ones).
    for label, value in expect.get("pairs", {}).items():
        row = next((r for r in cached[sheet].iter_rows() if norm(r[0].value) == label), None)
        c.yes(f"{label}={value}", row is not None and len(row) > 1 and same(row[1].value, value))


def check_docx(path: Path, expect: dict, c: Checks) -> None:
    import docx

    document = docx.Document(str(path))
    paragraphs = [p for p in document.paragraphs]
    texts = [p.text for p in paragraphs]
    body = "\n".join(texts)
    for text in expect.get("absent", []):
        c.yes(f"没有“{text}”", text not in body)
    for text, count in expect.get("count", {}).items():
        c.eq(f"“{text}”出现次数", body.count(text), count)
    for index, text in expect.get("paragraphs", {}).items():
        c.eq(f"第 {int(index) + 1} 段", texts[int(index)] if int(index) < len(texts) else None, text)
    for index, style in expect.get("styles", {}).items():
        p = paragraphs[int(index)] if int(index) < len(paragraphs) else None
        style_id = p._p.pPr.pStyle.val if p is not None and p._p.pPr is not None and p._p.pPr.pStyle is not None else None
        c.eq(f"第 {int(index) + 1} 段样式", style_id, style)
    for index, look in expect.get("runs", {}).items():
        runs = paragraphs[int(index)].runs if int(index) < len(paragraphs) else []
        c.yes("有文字段", bool(runs))
        if "bold" in look:
            c.yes("每段都加粗", all(run.bold for run in runs))
        if "color" in look:
            c.yes(f"每段都是 {look['color']}", all(str(run.font.color.rgb) == look["color"] for run in runs))
    xml = document.element.xml
    for text in expect.get("inserted", []):
        inserted = "".join(t.text or "" for ins in document.element.iter(f"{W}ins") for t in ins.iter(f"{W}t"))
        c.yes(f"修订插入了“{text}”", text in inserted)
    for text in expect.get("deleted", []):
        deleted = "".join(t.text or "" for d in document.element.iter(f"{W}del") for t in d.iter(f"{W}delText"))
        c.yes(f"修订删除了“{text}”", text in deleted)
    if "revisions" in expect:
        count = len(list(document.element.iter(f"{W}ins"))) + len(list(document.element.iter(f"{W}del")))
        c.eq("修订数", count, expect["revisions"])
    if "tables" in expect:
        c.eq("表格数", len(document.tables), expect["tables"])
    if "table" in expect:
        found = [[cell.text for cell in row.cells] for row in document.tables[0].rows] if document.tables else None
        c.eq("第一张表格", found, expect["table"])
    del xml


def check_pptx(path: Path, expect: dict, c: Checks) -> None:
    import pptx
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    deck = pptx.Presentation(str(path))
    slides = list(deck.slides)

    def title(slide) -> str:
        shape = slide.shapes.title
        return shape.text_frame.text if shape is not None and shape.has_text_frame else ""

    if "titles" in expect:
        c.eq("每页标题", [title(s) for s in slides], expect["titles"])
    for number, text in expect.get("titleOf", {}).items():
        c.eq(f"第 {number} 页标题", title(slides[int(number) - 1]) if int(number) <= len(slides) else None, text)
    for number, wanted in expect.get("texts", {}).items():
        slide = slides[int(number) - 1] if int(number) <= len(slides) else None
        lines = []
        if slide is not None:
            for shape in slide.shapes:
                if shape.has_text_frame:
                    lines.extend(p.text for p in shape.text_frame.paragraphs)
        for text in wanted:
            c.yes(f"第 {number} 页有“{text}”", text in lines)
    for number, text in expect.get("notes", {}).items():
        slide = slides[int(number) - 1]
        notes = slide.notes_slide.notes_text_frame.text if slide.has_notes_slide else ""
        c.eq(f"第 {number} 页备注", notes, text)
    for number, layout in expect.get("layouts", {}).items():
        c.eq(f"第 {number} 页版式", slides[int(number) - 1].slide_layout.name, layout)

    def pictures(slide):
        return [shape for shape in slide.shapes if shape.shape_type == MSO_SHAPE_TYPE.PICTURE]

    for number, count in expect.get("pictures", {}).items():
        c.eq(f"第 {number} 页图片数", len(pictures(slides[int(number) - 1])), count)
    for number, digest in expect.get("pictureSha", {}).items():
        blobs = [hashlib.sha256(p.image.blob).hexdigest() for p in pictures(slides[int(number) - 1])]
        c.yes(f"第 {number} 页的图片字节对上", digest in blobs)


def check_pdf(path: Path, expect: dict, c: Checks) -> None:
    import pypdf

    reader = pypdf.PdfReader(str(path), strict=False)
    if "pages" in expect:
        c.eq("页数", len(reader.pages), expect["pages"])
    for number, text in expect.get("pageText", {}).items():
        found = reader.pages[int(number) - 1].extract_text() if int(number) <= len(reader.pages) else ""
        c.yes(f"第 {number} 页有“{text}”", text in " ".join(found.split()))
    fields = reader.get_fields() or {}
    for name, value in expect.get("fields", {}).items():
        c.eq(f"字段 {name}", str((fields.get(name) or {}).get("/V", "")).lstrip("/"), value)
    for name in expect.get("checked", []):
        value = str((fields.get(name) or {}).get("/V", ""))
        c.yes(f"{name} 已勾选", value not in ("", "/Off", "Off"))
    if "outlines" in expect:
        c.eq("书签数", len(reader.outline), expect["outlines"])


def check_zip(path: Path, expect: dict, c: Checks) -> None:
    with zipfile.ZipFile(path) as archive:
        c.eq("包里的文件", sorted(n for n in archive.namelist() if not n.endswith("/")), sorted(expect["names"]))
        c.eq("每个条目的校验", archive.testzip(), None)


def check_tree(path: Path, expect: dict, c: Checks) -> None:
    for name in expect.get("present", []):
        c.yes(f"有 {name}", (path / name).is_file())
    for name in expect.get("absent", []):
        c.yes(f"没有 {name}", not (path / name).exists())
    for name, digest in expect.get("sha256", {}).items():
        target = path / name
        c.yes(f"{name} 的哈希", target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == digest)


CHECKERS = {
    "xlsx": check_xlsx,
    "docx": check_docx,
    "pptx": check_pptx,
    "pdf": check_pdf,
    "zip": check_zip,
    "tree": check_tree,
}


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    folder = Path(argv[1])
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    work = folder / "work"
    results = []
    for item in manifest:
        c = Checks()
        try:
            CHECKERS[item["kind"]](work / item["path"], item["expect"], c)
        except Exception as error:  # noqa: BLE001 - every failure is a result of the check
            c.items.append((False, f"读不了：{type(error).__name__}: {error}"[:300]))
        results.append({"id": item["id"], "kind": item["kind"], "path": item["path"], "pass": c.passed, "detail": c.detail()})
        print(f"{'一致' if c.passed else '不一致'} {item['id']} {item['path']}：{c.detail()}")
    passed = sum(1 for r in results if r["pass"])
    (folder / "crosscheck.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# 用别人的库再读一遍（openpyxl、python-docx、python-pptx、pypdf、zipfile）",
        "",
        f"一致 {passed} / {len(results)}。",
        "",
        "| 编号 | 文件 | 结果 | 核对 |",
        "| --- | --- | --- | --- |",
        *(
            f"| {r['id']} | {r['path']} | {'一致' if r['pass'] else '不一致'} | {r['detail'].replace('|', chr(92) + '|')} |"
            for r in results
        ),
        "",
    ]
    (folder / "crosscheck.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"\n一致 {passed} / {len(results)}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
