#!/usr/bin/env python3
"""协作（一）的接线和文字（hx/auto_model.py、hx/translations_v165.py）。"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

HX = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HX))

import auto_model  # noqa: E402
import brand_rename  # noqa: E402
import translations  # noqa: E402
import translations_v165  # noqa: E402


def names(text: str) -> set:
    return set(re.findall(r"\{(\w+)\}", text))


ENGLISH = {**auto_model.STATUS_EN, **auto_model.SETTINGS_EN}
CHINESE = {**auto_model.STATUS_ZH, **auto_model.SETTINGS_ZH}


class AutoModel(unittest.TestCase):
    def test_text_has_the_same_keys_and_placeholders_in_every_language(self):
        self.assertEqual(set(CHINESE), set(ENGLISH))
        self.assertEqual(set(translations_v165.NEW_KEYS), set(ENGLISH))
        self.assertEqual(sorted(translations_v165.NEW), sorted(set(translations.LOCALES)))
        for key, value in ENGLISH.items():
            self.assertEqual(names(CHINESE[key]), names(value), key)
            self.assertEqual(translations_v165.PLACEHOLDERS.get(key, set()), names(value), key)
        for locale, phrases in translations_v165.NEW.items():
            self.assertEqual(set(phrases), set(ENGLISH), locale)
            for key, value in phrases.items():
                self.assertEqual(names(value), names(ENGLISH[key]), f"{locale}: {key}")
                self.assertTrue(value.strip(), f"{locale}: {key}")
                self.assertNotIn('"', value, f"{locale}: {key}")
            # 回复的那个词在每种语言里都是 redo（判断“重做”的规则认它）
            self.assertIn("redo", phrases["status.agent.hxAuto.suggest"], locale)
        self.assertEqual(translations.check_placeholders(), [])

    def test_the_lines_of_one_kind_cannot_be_read_as_another(self):
        """各端按英文模板把这一行译回自己的语言：两句模板不能对得上同一段文字。"""
        lines = [value for key, value in ENGLISH.items() if key.startswith("status.agent.hxAuto.")]
        self.assertEqual(len(lines), 20)
        patterns = [re.compile("^" + re.escape(line).replace(re.escape("{model}"), ".+") + "$") for line in lines]
        for index, line in enumerate(lines):
            sample = line.replace("{model}", "Some Model 1.0")
            hits = [other for other, pattern in enumerate(patterns) if pattern.match(sample)]
            self.assertEqual(hits, [index], line)

    def test_every_language_is_merged_into_the_translations(self):
        for key in ENGLISH:
            for locale in translations.LOCALES:
                self.assertIsNotNone(translations.text(key, locale), f"{locale}: {key}")

    def test_the_step_runs_after_the_computer_catalog_and_before_the_rename(self):
        source = (HX / "rebrand.py").read_text(encoding="utf-8")
        order = source[source.index("def main() -> int:"):]
        self.assertLess(order.index("computer_catalog"), order.index("auto_model"))
        self.assertLess(order.index("auto_model"), order.index("rename_all"))
        self.assertIn("hx_auto_model.apply", source)

    def test_the_step_finds_the_files_by_their_upstream_names(self):
        self.assertIn("hx/auto_model.py", brand_rename.EXCLUDE_CONTENT)
        source = (HX / "auto_model.py").read_text(encoding="utf-8")
        upstream = "open" + "bot"  # 这个测试文件自己会被改名，所以不把上游名称连着写
        self.assertIn(f'"src/backend/{upstream}-tools.ts"', source)
        self.assertIn(f'"src/backend/agent/{upstream}-tool-router.ts"', source)
        self.assertIn(f'"@{upstream}/contracts/hx-auto-model"', source)
        self.assertNotIn('"src/backend/hxbot-tools.ts"', source)

    def test_the_model_moves_before_the_queue_and_never_during_a_turn(self):
        """选模型接在额度切换之后，用“下一轮之前生效”的那条路；队列里接着做的工作和频道的工作不换。"""
        source = (HX / "auto_model.py").read_text(encoding="utf-8")
        self.assertIn("if (!this.#usageLimitMove(agentId)) {", source)
        self.assertIn("if (!hxAutoRouter.due(agentId)) return false;", source)
        self.assertIn('"next-turn"', source)
        self.assertIn("next.resumeAfterUsageLimit || next.planContinuation || next.channelId", source)
        self.assertIn("this.#runtimeHandoverBusy(agentId) ||", source)
        # 一轮被额度挡下来的，不算做得不顺利
        self.assertIn("if (!this.#limitedTurns.has(turnId)) hxAutoRouter.turnEnded(", source)
        # 手动选了模型就退出“自动”
        self.assertIn("hxAutoRouter.manualChange(input.agentId)", source)

    def test_the_proposal_card_waits_for_a_person_and_not_in_an_external_chat(self):
        source = (HX / "auto_model.py").read_text(encoding="utf-8")
        self.assertIn("this.#messaging.store.linkForThread(", source)
        self.assertIn("this.#attention.surfaceUiBlock(client, toolRequest,", source)
        self.assertIn('"computer_set",\\n  "propose_plan",\\n', source)

    def test_the_source_of_the_interface_names_no_other_product(self):
        banned = re.compile("WorkBuddy|腾讯|tencent|codebuddy", re.IGNORECASE)
        root = HX.parent
        files = [root / "packages/contracts/src/hx-auto-model.ts",
                 root / "src/renderer/src/features/agents/HxAutoModelSection.tsx",
                 *sorted((root / "src/backend/hx-auto-model").glob("*.ts"))]
        self.assertGreater(len(files), 8)
        for path in files:
            self.assertIsNone(banned.search(path.read_text(encoding="utf-8")), str(path))


if __name__ == "__main__":
    unittest.main()
