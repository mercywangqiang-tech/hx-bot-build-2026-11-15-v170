# HXBot 长颈鹿标志（VI 基础）

品牌名统一写 **HXBot**（中英文相同，不带空格）。标志是一只没有底框的长颈鹿。

| 文件 | 用途 |
| --- | --- |
| `hxbot-giraffe.svg` | 彩色原稿（身体、斑纹、眼睛） |
| `hxbot-giraffe-ink.svg`、`-white.svg`、`-blue.svg` | 单色版：深色、反白（深色底上用）、品牌蓝 |
| `png/hxbot-giraffe-256.png`、`-1024.png`、`-4096.png` | 透明底位图，按高度命名 |
| `png/hxbot-giraffe-ink-1024.png`、`-white-1024.png` | 单色位图 |
| `hxbot-giraffe-vi.json` | 唯一来源：轮廓和标准色；改它后运行 `python3 hx/assets/vi/make_vi.py` |

标准色：身体 `#E4983A`，斑纹与瞳孔 `#79512B`，眼睛高光 `#FFF1D2`。与标志搭配的文字用 `#1D1D1F`，链接和主按钮用品牌蓝 `#0156D3`。

使用要求：

- 不加底框、圆角方块或阴影；四周留白不少于标志宽度的一半。
- 不改比例，不旋转，不单独改斑纹颜色。
- 屏幕上最小高度 24 px（更小时用单色版）；印刷最小高度 10 mm。
- 文字写在标志下方或右侧，例如“HXBot 账号”“HXBot Account”。

用到它的地方：门户登录页的标志和动画（`hx/server/portal/index.html` 的 `<symbol id="hx-giraffe">`）、
指南条款隐私页（`hx/scripts/site-pages.mjs` 从门户页读取）、验证码邮件页头（`mail-logo.ts`，由
`rsvg-convert -h 150 hx/assets/vi/hxbot-giraffe.svg` 导出）、网页标签图标和桌面端、手机端的应用图标（`hx/make_icons.py`，v1.6.2 起）。
应用内的标志（登录页、关于页等）仍是白底方块上的长颈鹿。
