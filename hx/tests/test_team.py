#!/usr/bin/env python3
"""协作（二）的接线和文字（hx/team.py、hx/translations_v166.py）。"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

HX = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HX))

import brand_rename  # noqa: E402
import team  # noqa: E402
import translations  # noqa: E402
import translations_v166  # noqa: E402


def names(text: str) -> set:
    return set(re.findall(r"\{(\w+)\}", text))


ENGLISH = {**team.STATUS_EN, **team.SETTINGS_EN}
CHINESE = {**team.STATUS_ZH, **team.SETTINGS_ZH}


class Team(unittest.TestCase):
    def test_text_has_the_same_keys_and_placeholders_in_every_language(self):
        self.assertEqual(set(CHINESE), set(ENGLISH))
        self.assertEqual(set(translations_v166.NEW_KEYS), set(ENGLISH))
        self.assertEqual(translations_v166.ORDER, list(ENGLISH))
        self.assertEqual(sorted(translations_v166.NEW), sorted(set(translations.LOCALES)))
        for key, value in ENGLISH.items():
            self.assertEqual(names(CHINESE[key]), names(value), key)
            self.assertEqual(translations_v166.PLACEHOLDERS.get(key, set()), names(value), key)
        for locale, phrases in translations_v166.NEW.items():
            self.assertEqual(set(phrases), set(ENGLISH), locale)
            for key, value in phrases.items():
                self.assertEqual(names(value), names(ENGLISH[key]), f"{locale}: {key}")
                self.assertTrue(value.strip(), f"{locale}: {key}")
                self.assertNotIn('"', value, f"{locale}: {key}")
        self.assertEqual(translations.check_placeholders(), [])

    def test_no_line_can_be_read_as_another(self):
        """各端按英文模板把进度的小字译回自己的语言：两句模板不能对得上同一段文字。"""
        lines = [value for key, value in ENGLISH.items() if key.startswith("status.agent.hxTeam.")]
        self.assertEqual(len(lines), 17)

        def pattern(line: str) -> re.Pattern:
            return re.compile("^" + re.sub(r"\\\{\w+\\\}", ".+", re.escape(line)) + "$")

        patterns = [pattern(line) for line in lines]
        for index, line in enumerate(lines):
            sample = re.sub(r"\{\w+\}", "Some Name 2", line)
            hits = [other for other, item in enumerate(patterns) if item.match(sample)]
            self.assertEqual(hits, [index], line)

    def test_every_language_is_merged_into_the_translations(self):
        for key in ENGLISH:
            for locale in translations.LOCALES:
                self.assertIsNotNone(translations.text(key, locale), f"{locale}: {key}")

    def test_the_step_runs_after_the_opencode_step_and_before_the_rename(self):
        source = (HX / "rebrand.py").read_text(encoding="utf-8")
        order = source[source.index("def main() -> int:"):]
        self.assertLess(order.index("opencode_connect"), order.index("team_rooms"))
        self.assertLess(order.index("team_rooms"), order.index("rename_all"))
        self.assertIn("hx_team.apply", source)

    def test_the_step_finds_the_files_by_their_upstream_names(self):
        self.assertIn("hx/team.py", brand_rename.EXCLUDE_CONTENT)
        source = (HX / "team.py").read_text(encoding="utf-8")
        upstream = "open" + "bot"  # 这个测试文件自己会被改名，所以不把上游名称连着写
        self.assertIn(f'"src/backend/{upstream}-tools.ts"', source)
        self.assertIn(f'"src/backend/agent/{upstream}-tool-router.ts"', source)
        self.assertIn("return " + upstream[0:4] + "BotToolFailure(hxRefusal);", source)

    def test_the_insertions_do_not_split_the_blocks_of_other_steps(self):
        """插入的位置不能夹在别的步骤的改动中间，否则改造第二遍会把那一步再做一次。"""
        source = (HX / "team.py").read_text(encoding="utf-8")
        self.assertIn("hxTeams.setPort(this.#hxTeamHost());\\n\" + auto", source)
        self.assertIn('hxOpenCodeNames.open(join(app.getPath("userData"), "hx-opencode"));', source)

    def test_the_tools_stay_in_the_catalog(self):
        """四个工具都不进每次对话都发的那一组：按说明用 tool_call 调用。"""
        source = (HX / "team.py").read_text(encoding="utf-8")
        self.assertNotIn("tool-catalog.ts", source)
        self.assertIn("...HX_TEAM_TOOL_DEFINITIONS", source)

    def test_a_member_starts_without_a_first_message_and_with_the_starters_limits(self):
        source = (HX / "team.py").read_text(encoding="utf-8")
        self.assertIn("this.createAgentProfile({", source)
        self.assertNotIn("initialMessage", source)
        self.assertIn("workspaceAccessEnforced(starter)", source)
        self.assertIn("starter?.computerUse === false", source)

    def test_the_result_comes_from_the_lead_and_needs_no_answer(self):
        source = (HX / "team.py").read_text(encoding="utf-8")
        self.assertIn('sender: { kind: \\"agent\\", agentId: input.fromAgentId }', source)
        self.assertIn("expectsReply: false,", source)
        self.assertIn("idempotencyKey: input.key,", source)

    def test_the_source_of_the_interface_names_no_other_product(self):
        banned = re.compile("WorkBuddy|腾讯|tencent|codebuddy", re.IGNORECASE)
        root = HX.parent
        files = [root / "hx/team.py", root / "hx/translations_v166.py",
                 *sorted((root / "src/backend/hx-team").glob("*.ts"))]
        self.assertGreater(len(files), 8)
        for path in files:
            self.assertIsNone(banned.search(path.read_text(encoding="utf-8")), str(path))


if __name__ == "__main__":
    unittest.main()
