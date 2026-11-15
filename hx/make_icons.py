#!/usr/bin/env python3
"""生成 HXBot 的图标（桌面、网页、安卓、iOS）、手机启动画面和 macOS 安装盘背景。

2026-11-12 起图标是没有底框的长颈鹿（VI 原稿 hx/assets/vi/hxbot-giraffe-vi.json，见 hx/assets/vi/README.md）：
桌面端（macOS、Windows、Linux）和网页标签图标都是透明背景上的一只长颈鹿，不加白底方块、不加阴影。
只有系统要求不透明的地方用白底：iOS 和安卓的应用图标（系统会切成圆角，透明处在 iOS 上会变黑）、
安卓自适应图标的背景层、iPhone 添加到主屏幕的图标（apple-touch-icon）。16～32 像素的小图标让长颈鹿占满高度。
菜单栏、通知栏、安卓单色图标用纯色剪影（不挖斑纹，小尺寸下更清楚）。

用法：
    python3 hx/make_icons.py

需要 Pillow（pip install pillow）和 rsvg-convert（librsvg，macOS 上 brew install librsvg）；
安装盘背景上的文字需要一个中文字体（默认找 Noto Sans CJK；macOS 自带 PingFang 也可）。
"""

from __future__ import annotations

import io
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
VI = json.loads((ROOT / "hx/assets/vi/hxbot-giraffe-vi.json").read_text(encoding="utf-8"))
# VI 原稿的画框（与 hx/assets/vi/make_vi.py 相同）
VIEW_X, VIEW_Y, VIEW_W, VIEW_H = -2.0, -2.0, 299.75, 582.75
WHITE = (255, 255, 255)
BLUE = (1, 86, 211)  # #0156D3 犀蓝（安装盘背景的细条）
FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "C:/Windows/Fonts/msyhbd.ttc",
]


def giraffe_paths(color: tuple[int, int, int] | None = None) -> str:
    """长颈鹿的 SVG 图形。color 为空时是彩色（身体、斑纹、瞳孔、眼睛高光），否则是一种颜色的实心剪影。"""
    if color is not None:
        return f'<path d="{VI["body"]}" fill="#{color[0]:02X}{color[1]:02X}{color[2]:02X}"/>'
    c, e = VI["colors"], VI["eye"]
    return (
        f'<path d="{VI["body"]}" fill="{c["body"]}"/><path d="{"".join(VI["spots"])}" fill="{c["spots"]}"/>'
        f'<path d="{VI["pupil"]}" fill="{c["spots"]}"/>'
        f'<ellipse cx="{e["cx"]}" cy="{e["cy"]}" rx="{e["rx"]}" ry="{e["ry"]}" fill="{c["eye"]}"/>'
    )


def square_svg(size: int, height_ratio: float, color=None, background: str | None = None) -> str:
    """边长 size 的正方形，长颈鹿高 size×height_ratio、居中；background 为空时透明。"""
    k = size * height_ratio / VIEW_H
    x = (size - VIEW_W * k) / 2 - VIEW_X * k
    y = (size - VIEW_H * k) / 2 - VIEW_Y * k
    back = f'<rect width="{size}" height="{size}" fill="{background}"/>' if background else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">'
        f"<title>HXBot</title>{back}"
        f'<g transform="translate({x:.3f} {y:.3f}) scale({k:.6f})">{giraffe_paths(color)}</g></svg>\n'
    )


def render(svg: str, size: int) -> Image.Image:
    """用 rsvg-convert 把 SVG 画成 size×size 的 RGBA 图。"""
    png = subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size)], input=svg.encode("utf-8"),
                         capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(png)).convert("RGBA")


def mark(size: int, height_ratio: float = 0.92, color=None, background: str | None = None) -> Image.Image:
    """透明（或 background）正方形上居中的长颈鹿。"""
    return render(square_svg(size, height_ratio, color, background), size)


def small(size: int) -> Image.Image:
    """16～32 像素的小图标：长颈鹿占满高度，先画大再缩小。"""
    return mark(size * 8, 0.98).resize((size, size), Image.LANCZOS)


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit("找不到中文字体。请安装 Noto Sans CJK，或修改 FONT_CANDIDATES。")


def icon_svg(size: int = 1024) -> str:
    """图标原稿：透明背景上的长颈鹿（与桌面端图标相同构图）。"""
    return square_svg(size, 0.92)


def save(image: Image.Image, path: str, **options) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, **options)
    print("  写入", path)


def save_ico(path: str, big: Image.Image) -> None:
    """Windows / 网页的 .ico：16～32 像素用占满高度的小图标，48 像素起用完整图标。"""
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    target_sizes = [s for s in sizes if s[0] <= big.width]
    frames = [small(s[0]) if s[0] <= 32 else big.resize(s, Image.LANCZOS) for s in target_sizes]
    save(frames[-1], path, sizes=target_sizes, append_images=frames[:-1])


def dmg_background(scale: int) -> Image.Image:
    w, h = 680 * scale, 478 * scale
    image = Image.new("RGB", (w, h), (244, 247, 252))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, w, 6 * scale), fill=BLUE)
    title = font(26 * scale)
    note = font(14 * scale)
    draw.text((40 * scale, 40 * scale), "HXBot 研究版", font=title, fill=(11, 47, 120))
    draw.text((40 * scale, 82 * scale), "把左边的图标拖到右边的“应用程序”文件夹即可安装", font=note, fill=(60, 72, 96))
    # Arrow between the two icon spots (x 190 and 490, y 220 in the window).
    y = 220 * scale
    draw.line((262 * scale, y, 410 * scale, y), fill=(30, 111, 217), width=4 * scale)
    draw.polygon([(418 * scale, y), (402 * scale, y - 10 * scale), (402 * scale, y + 10 * scale)], fill=(30, 111, 217))
    foot = font(11 * scale)
    draw.text(
        (40 * scale, 420 * scale),
        "仅限研究使用，不得用于商业用途 · 安装与部署支持：bot@hxallai.com · 弘犀智能",
        font=foot,
        fill=(110, 120, 140),
    )
    return image


def main() -> None:
    print("生成 HXBot 图标（无底框的长颈鹿，hx/assets/vi）")

    # 桌面端：正式版、开发版、预览版统一用同一个图标。macOS 的图标按系统的图标网格在四周留边。
    full = mark(1600, 0.92)
    mac = mark(1600, 0.80)
    for channel in ("production", "dev", "preview"):
        save(full, f"build/icon-{channel}.png")
        save(mac, f"build/icon-{channel}-macos-safe-area.png")
        save_ico(f"build/icon-{channel}.ico", full.resize((256, 256), Image.LANCZOS))
    save(mark(1024, 0.80), "build/icon-production.icns")
    for path in ("hx/assets/hxbot-icon.svg", "build/icon.svg"):
        (ROOT / path).write_text(icon_svg(), encoding="utf-8")
        print("  写入", path)
    save_ico("build/icon.ico", full.resize((256, 256), Image.LANCZOS))
    # “Logo 颜色”设置里的各色图标，研究版统一用同一个图标。
    for path in sorted((ROOT / "build/logo-colors").glob("*.png")):
        image = mac if path.name.endswith("macos-safe-area.png") else full
        save(image.resize(Image.open(path).size, Image.LANCZOS), str(path.relative_to(ROOT)))
    # macOS 26 的分层图标原稿（研究版不打包 Assets.car，这里只替换图层图片，以免仓库里留着上游标志）
    for path in ("build/icon-production.icon/Assets/eyes.png", "apps/mobile/assets/icons/app-icon.icon/Assets/eyes.png"):
        if (ROOT / path).exists():
            size = Image.open(ROOT / path).size[0]
            save(mark(size, 0.80, color=(0, 0, 0)), path)
    # macOS 菜单栏模板图标：黑色长颈鹿剪影 + 透明背景，系统按菜单栏颜色着色。
    for size, name in ((18, "trayTemplate.png"), (36, "trayTemplate@2x.png")):
        save(mark(size * 8, 0.98, color=(0, 0, 0)).resize((size, size), Image.LANCZOS), f"build/macos/tray/{name}")
    save(dmg_background(1), "build/dmg-background.png")
    save(dmg_background(2), "build/dmg-background@2x.png")

    # 网页（账号服务的公开资源：门户、网页版、指南条款隐私页、邀请页的标签图标）
    for size, name in ((512, "icon-512x512.png"), (192, "icon-192x192.png")):
        save(mark(size, 0.92), f"apps/auth-api/public/{name}")
    # iPhone“添加到主屏幕”：系统不认透明，用白底（系统切圆角）
    save(mark(180, 0.74, background="#FFFFFF").convert("RGB"), "apps/auth-api/public/apple-touch-icon.png")
    save(small(32), "apps/auth-api/public/favicon-32x32.png")
    save_ico("apps/auth-api/public/favicon.ico", mark(48 * 8, 0.98).resize((48, 48), Image.LANCZOS))
    # 文档网页（部署文档.html 等）的标签图标
    (ROOT / "hx/docs/assets/favicon.svg").write_text(square_svg(1000, 0.96), encoding="utf-8")
    print("  写入 hx/docs/assets/favicon.svg")

    # 手机端（iOS 与安卓共用 app-icon.png）：系统要求不透明，白底上的长颈鹿，不画圆角和边框（系统自己切圆角）
    save(mark(1024, 0.72, background="#FFFFFF").convert("RGB"), "apps/mobile/assets/icons/app-icon.png")
    save(Image.new("RGB", (1024, 1024), WHITE), "apps/mobile/assets/icons/android-adaptive-background.png")
    # 安卓自适应图标的前景只占中间约 66% 的圆形安全区。
    save(mark(1024, 0.56), "apps/mobile/assets/icons/android-adaptive-eyes.png")
    # 单色图标（安卓 13 主题图标）：只要长颈鹿剪影（系统只取不透明部分再着色）
    save(mark(1024, 0.56, color=WHITE), "apps/mobile/assets/icons/android-adaptive-mono.png")
    # 通知栏图标：白色单色剪影
    save(mark(96 * 4, 0.96, color=WHITE).resize((96, 96), Image.LANCZOS), "apps/mobile/assets/icons/notification-icon.png")
    # 启动画面：白底上的长颈鹿（app.json 由 hx/rebrand.py 指向这个文件；底色由 app.json 设为白色）
    save(mark(960, 0.86), "apps/mobile/assets/splash/hxbot.png")


if __name__ == "__main__":
    main()
