#!/usr/bin/env python3
"""桌面端设置的每一个分类都点得开（v1.6.3 起检查）。

设置左侧的分类是 src/renderer/src/features/settings/settings-tabs.ts 里的 SettingsTab；点一个分类时，
SettingsModal.tsx 只切到一张名单里写着的值（tabsProps.onChange）。v1.6.2 加“授权与记录”时漏了名单，结果左侧点了没反应，
只能从搜索打开。这里核对：除了不在这个面板里显示的“托管服务器”，每个分类都在名单里，也都有自己的页面（Tabs.Content）。
运行：python3 hx/tests/test_settings_tabs.py
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SETTINGS = ROOT / "src/renderer/src/features/settings"
NOT_IN_PANEL = {"hosted-servers"}


def tabs() -> list[str]:
    text = (SETTINGS / "settings-tabs.ts").read_text(encoding="utf-8")
    union = re.search(r"export type SettingsTab =(.*?);", text, re.S).group(1)
    return re.findall(r'"([a-z-]+)"', union)


class SettingsTabs(unittest.TestCase):
    def test_every_tab_can_be_chosen(self):
        modal = (SETTINGS / "SettingsModal.tsx").read_text(encoding="utf-8")
        handler = re.search(r"onChange\(value: string\) \{(.*?)\n    \},", modal, re.S).group(1)
        accepted = set(re.findall(r'value === "([a-z-]+)"', handler))
        listed = [tab for tab in tabs() if tab not in NOT_IN_PANEL]
        self.assertGreater(len(listed), 10)
        self.assertEqual(sorted(set(listed) - accepted), [])

    def test_every_tab_has_a_page(self):
        modal = (SETTINGS / "SettingsModal.tsx").read_text(encoding="utf-8")
        pages = set(re.findall(r'<Tabs\.Content value="([a-z-]+)"', modal))
        self.assertEqual(sorted(set(tabs()) - NOT_IN_PANEL - pages), [])


if __name__ == "__main__":
    unittest.main(verbosity=1)
