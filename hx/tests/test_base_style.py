#!/usr/bin/env python3
"""界面基础样式（v1.6.3，hx/base_style.py 和 src/renderer/src/styles/hx-look.css）的检查：

- hx-look.css 用到的每个 token 都在 tokens.css 声明过（新 token 深色、浅色各有值）；
- hx-look.css 在 styles.css 的最后引入，和原来写法一样的规则以它为准；
- 下拉框类的控件只剩一个向下的箭头（选择框、聊天颜色和背景、定时触发）；
- 新 token 的浅色值与深色值不同的，都在 tokens-light.css 里给了；
- 打包进界面的文件里没有参照产品的名称（只能出现在 hx/ 的说明和样式文件的注释里）。
运行：python3 hx/tests/test_base_style.py
"""

import re
import sys
import unittest
from pathlib import Path

HX = Path(__file__).resolve().parents[1]
ROOT = HX.parent
sys.path.insert(0, str(HX))

import base_style  # noqa: E402

TOKENS = ROOT / "packages/brand/src/tokens.css"
LIGHT = ROOT / "packages/brand/src/tokens-light.css"
LOOK = ROOT / "src/renderer/src/styles/hx-look.css"
STYLES = ROOT / "src/renderer/src/styles.css"


def declared(text: str) -> dict:
    return {m.group(1): m.group(2).strip() for m in re.finditer(r"(--hxbot-[\w-]+)\s*:\s*([^;]+);", text)}


def without_comments(text: str) -> str:
    return re.sub(r"/\*.*?\*/", "", text, flags=re.S)


class BaseStyle(unittest.TestCase):
    def test_tokens_exist(self):
        tokens = declared(TOKENS.read_text(encoding="utf-8"))
        used = set(re.findall(r"var\((--hxbot-[\w-]+)", without_comments(LOOK.read_text(encoding="utf-8"))))
        self.assertTrue(used)
        self.assertEqual(sorted(used - set(tokens)), [])

    def test_new_tokens_have_both_themes(self):
        dark = declared(TOKENS.read_text(encoding="utf-8"))
        light = declared(LIGHT.read_text(encoding="utf-8"))
        new = [name.replace("--openbot-", "--hxbot-") for name in re.findall(r"(--openbot-[\w-]+):", base_style.NEW_TOKENS)]
        self.assertEqual(len(new), 10)
        for name in new:
            self.assertIn(name, dark)
        # 白色旋钮、圆角在两种主题下一样，其余的浅色要另给
        same = {"--hxbot-control-on", "--hxbot-control-knob", "--hxbot-control-knob-width",
                "--hxbot-control-knob-height", "--hxbot-radius-dialog"}
        for name in new:
            if name not in same:
                self.assertIn(name, light, name)
        self.assertEqual(light["--hxbot-bg-canvas"], "#f7f7f7")
        self.assertEqual(light["--hxbot-control-off"], "#e5e5e5")
        self.assertEqual(dark["--hxbot-control-on"], "#57bf9c")

    def test_look_comes_last(self):
        imports = re.findall(r'^@import "([^"]+)";', STYLES.read_text(encoding="utf-8"), flags=re.M)
        self.assertEqual(imports[-1], "./styles/hx-look.css")

    def test_single_chevron(self):
        for path in ("packages/ui/src/select.tsx", "packages/ui/src/color-picker.tsx",
                     "packages/ui/src/features/conversation/RoutineTriggerMenu.tsx"):
            text = (ROOT / path).read_text(encoding="utf-8")
            self.assertNotIn("ChevronsUpDown", text, path)
            self.assertIn("ChevronDown", text, path)

    def test_no_reference_names_in_the_interface(self):
        pattern = re.compile(r"workbuddy|code ?buddy|腾讯|tencent", re.I)
        for path in (LOOK, TOKENS, LIGHT):
            self.assertIsNone(pattern.search(without_comments(path.read_text(encoding="utf-8"))), path)
        for folder in ("src/renderer/src", "packages/ui/src", "packages/i18n/src", "apps/mobile/src"):
            for path in (ROOT / folder).rglob("*"):
                if path.suffix in {".ts", ".tsx", ".json"} and path.is_file():
                    self.assertIsNone(pattern.search(path.read_text(encoding="utf-8", errors="ignore")), path)


if __name__ == "__main__":
    unittest.main(verbosity=1)
