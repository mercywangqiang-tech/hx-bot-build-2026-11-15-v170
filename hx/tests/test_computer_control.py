#!/usr/bin/env python3
"""电脑操控（一）的接线和文字（hx/computer_control.py、hx/translations_computer.py）。"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

HX = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HX))

import brand_rename  # noqa: E402
import computer_control  # noqa: E402
import translations  # noqa: E402
import translations_computer  # noqa: E402


def names(text: str) -> set:
    return set(re.findall(r"\{(\w+)\}", text))


class ComputerControl(unittest.TestCase):
    def test_text_has_the_same_keys_and_placeholders_in_every_language(self):
        english = computer_control.TEXT_EN
        self.assertEqual(set(computer_control.TEXT_ZH), set(english))
        self.assertEqual(set(translations_computer.NEW_KEYS), set(english))
        self.assertEqual(sorted(translations_computer.NEW), sorted(set(translations.LOCALES)))
        for key, value in english.items():
            self.assertEqual(names(computer_control.TEXT_ZH[key]), names(value), key)
            self.assertEqual(translations_computer.PLACEHOLDERS.get(key, set()), names(value), key)
        for locale, phrases in translations_computer.NEW.items():
            self.assertEqual(set(phrases), set(english), locale)
            for key, value in phrases.items():
                self.assertEqual(names(value), names(english[key]), f"{locale}: {key}")
                self.assertTrue(value.strip(), f"{locale}: {key}")
                self.assertNotIn('"', value, f"{locale}: {key}")
            for key in ("settings.hxComputer.description", "settings.hxComputer.disabled"):
                self.assertIn("HXBot", phrases[key], f"{locale}: {key}")
            self.assertIn("macOS", phrases["settings.hxComputer.unsupported"], locale)
            self.assertIn("Windows", phrases["settings.hxComputer.unsupported"], locale)
        self.assertEqual(translations.check_placeholders(), [])

    def test_every_language_is_merged_into_the_translations(self):
        for key in computer_control.TEXT_EN:
            for locale in translations.LOCALES:
                self.assertIsNotNone(translations.text(key, locale), f"{locale}: {key}")

    def test_the_instruction_names_the_tools_and_the_page_answer(self):
        text = computer_control.INSTRUCTION
        self.assertTrue(text.startswith(" "))
        for word in ("hxbot.computer_open", "hxbot.computer_set", "status page", "security page"):
            self.assertIn(word, text)
        self.assertIn("${COMPUTER_USE_MCP_SERVER_NAME}", text)
        self.assertNotIn("`", text)
        self.assertNotIn("HXBot", text)
        # 每次对话都发给模型，越短越好；加长之前先看 upstream_checks.py 里登记的字节数。
        # v1.6.7 加了一步步操作应用的一段（computer_plan、computer_do、computer_look）。
        self.assertLess(len(text), 800)
        for word in ("hxbot.computer_plan", "hxbot.computer_do", "hxbot.computer_look", "sends, pays, buys, deletes"):
            self.assertIn(word, text)

    def test_the_step_runs_after_the_settings_groups_and_before_the_rename(self):
        source = (HX / "rebrand.py").read_text(encoding="utf-8")
        order = source[source.index("def main() -> int:"):]
        self.assertLess(order.index("settings_groups"), order.index("computer_catalog"))
        self.assertLess(order.index("computer_catalog"), order.index("rename_all"))
        self.assertIn("hx_computer_control.apply", source)

    def test_the_step_finds_the_files_by_their_upstream_names(self):
        """步骤在改名之前运行，要按上游原来的文件名找文件；改名那一步不能把这个文件里的名称一起改掉。"""
        self.assertIn("hx/computer_control.py", brand_rename.EXCLUDE_CONTENT)
        source = (HX / "computer_control.py").read_text(encoding="utf-8")
        upstream = "open" + "bot"  # 这个测试文件自己会被改名，所以不把上游名称连着写
        self.assertIn(f'"src/backend/{upstream}-tools.ts"', source)
        self.assertIn(f'"src/backend/agent/{upstream}-tool-router.ts"', source)
        self.assertNotIn('"src/backend/hxbot-tools.ts"', source)

    def test_a_task_gets_no_computer_tools_and_a_routine_keeps_them(self):
        """和上游对 Computer Use 的做法一致：任务线程不带，定时任务的线程保留。"""
        source = (HX / "computer_control.py").read_text(encoding="utf-8")
        self.assertIn("this.#conversation.isTaskThread(hxThreadId) &&", source)
        self.assertIn("!this.#tasks.isRoutineThreadId(hxThreadId);", source)
        self.assertIn("inTask: hxInTask", source)

    def test_only_open_and_set_are_always_visible(self):
        """computer_find 留在工具目录里按需取用：每次对话都发给模型的内容要尽量少。"""
        source = (HX / "computer_control.py").read_text(encoding="utf-8")
        self.assertIn("""'  "release_access",\\n  "computer_open",\\n  "computer_set",\\n'""", source)
        self.assertNotIn('"computer_find",\\n', source)

    def test_the_wiring_does_not_split_what_other_steps_wrote(self):
        """每处改动都接在别的步骤写的那几行之后，不插在中间（否则那一步第二次运行时认不出自己改过）。"""
        source = (HX / "computer_control.py").read_text(encoding="utf-8")
        self.assertIn('"  ...HX_ACCESS_TOOL_DEFINITIONS,\\n  ...HX_COMPUTER_TOOL_DEFINITIONS,\\n"', source)
        self.assertIn("'    \"./hx-computer\": \"./src/hx-computer.ts\",\\n'\n"
                      "              '    \"./hx-access-settings\": \"./src/hx-access-settings.ts\",\\n'", source)
        self.assertIn("this.#attention.surfaceDynamicPrompt(client, toolRequest);", source)
        self.assertNotIn('"ask_user"', source)

    def test_the_source_of_the_interface_names_no_other_product(self):
        banned = re.compile("WorkBuddy|腾讯|tencent|codebuddy", re.IGNORECASE)
        root = HX.parent
        files = [root / "packages/contracts/src/hx-computer.ts",
                 root / "src/renderer/src/features/settings/HxComputerPanel.tsx",
                 *sorted((root / "src/backend/hx-computer").glob("*.ts"))]
        self.assertGreater(len(files), 10)
        for path in files:
            self.assertIsNone(banned.search(path.read_text(encoding="utf-8")), str(path))


if __name__ == "__main__":
    unittest.main()
