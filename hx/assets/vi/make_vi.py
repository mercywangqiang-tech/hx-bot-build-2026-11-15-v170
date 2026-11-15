"""HXBot 长颈鹿标志（VI 基础）的标准文件：由 hxbot-giraffe-vi.json 生成 SVG 原稿和 PNG。

    python3 hx/assets/vi/make_vi.py

hxbot-giraffe-vi.json 是标志的唯一来源：身体、瞳孔、14 块斑纹的轮廓（2026-11-12 由原标志的多边形放大
10 倍、按转角平滑后重新描出），以及标准色。门户页（hx/server/portal/index.html）里的 <symbol id="hx-giraffe">
和登录页的动画标志、验证码邮件的页头图（apps/auth-api/src/server/hx-accounts/mail-logo.ts）都来自它。
PNG 需要 rsvg-convert（librsvg）。
"""

import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
V = json.loads((HERE / "hxbot-giraffe-vi.json").read_text(encoding="utf-8"))
C = V["colors"]
E = V["eye"]

HEAD = ('<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 299.75 582.75" width="299.75" height="582.75">')
TITLE = "<title>HXBot 长颈鹿标志</title>"
SPOTS = "".join(V["spots"])
EYE = f'<ellipse cx="{E["cx"]}" cy="{E["cy"]}" rx="{E["rx"]}" ry="{E["ry"]}" fill="{C["eye"]}"/>'
FULL = (f'<path d="{V["body"]}" fill="{C["body"]}"/><path d="{SPOTS}" fill="{C["spots"]}"/>'
        f'<path d="{V["pupil"]}" fill="{C["spots"]}"/>{EYE}')
# 单色版：身体上挖空斑纹、瞳孔和眼睛
HOLES = (SPOTS + V["pupil"] + f'M{E["cx"] - E["rx"]},{E["cy"]}a{E["rx"]},{E["ry"]} 0 1,0 {2 * E["rx"]},0'
         f'a{E["rx"]},{E["ry"]} 0 1,0 {-2 * E["rx"]},0Z')
ONE_COLOUR = {"ink": "#1F1F1F", "white": "#FFFFFF", "blue": "#0156D3"}


def main() -> None:
    (HERE / "hxbot-giraffe.svg").write_text(HEAD + TITLE + FULL + "</svg>\n", encoding="utf-8")
    for name, colour in ONE_COLOUR.items():
        (HERE / f"hxbot-giraffe-{name}.svg").write_text(
            HEAD + TITLE + f'<path fill-rule="evenodd" d="{V["body"]}{HOLES}" fill="{colour}"/></svg>\n', encoding="utf-8")
    png = HERE / "png"
    png.mkdir(exist_ok=True)
    for height in (256, 1024, 4096):
        subprocess.run(["rsvg-convert", "-h", str(height), "-o", str(png / f"hxbot-giraffe-{height}.png"),
                        str(HERE / "hxbot-giraffe.svg")], check=True)
    for name in ("ink", "white"):
        subprocess.run(["rsvg-convert", "-h", "1024", "-o", str(png / f"hxbot-giraffe-{name}-1024.png"),
                        str(HERE / f"hxbot-giraffe-{name}.svg")], check=True)
    print("HXBot 标志：", ", ".join(sorted(p.name for p in HERE.glob("*.svg"))), "；PNG：",
          ", ".join(sorted(p.name for p in png.glob("*.png"))))


if __name__ == "__main__":
    main()
