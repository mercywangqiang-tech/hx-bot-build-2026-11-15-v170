"""电脑操控（二）和进度卡（v1.6.7，hx/computer_steps.py）：界面文字齐全、占位符一致、模板不会互相认错。"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import computer_steps  # noqa: E402
import translations  # noqa: E402
import translations_v167  # noqa: E402

ENGLISH = {**computer_steps.STATUS_EN, **computer_steps.SETTINGS_EN}
CHINESE = {**computer_steps.STATUS_ZH, **computer_steps.SETTINGS_ZH}


def names(text: str) -> set[str]:
    return set(re.findall(r"\{(\w+)\}", text))


class ComputerSteps(unittest.TestCase):
    def test_text_has_the_same_keys_and_placeholders_in_every_language(self):
        self.assertEqual(set(CHINESE), set(ENGLISH))
        self.assertEqual(translations_v167.ORDER, list(computer_steps.STATUS_EN) + list(computer_steps.SETTINGS_EN))
        self.assertEqual(sorted(translations_v167.NEW), sorted(set(translations.LOCALES)))
        for key, value in ENGLISH.items():
            self.assertEqual(names(CHINESE[key]), names(value), key)
            self.assertEqual(translations_v167.PLACEHOLDERS.get(key, set()), names(value), key)
        for locale, phrases in translations_v167.NEW.items():
            self.assertEqual(set(phrases), set(ENGLISH), locale)
            for key, value in phrases.items():
                self.assertEqual(names(value), names(ENGLISH[key]), f"{locale}: {key}")
                self.assertTrue(value.strip(), f"{locale}: {key}")
                self.assertNotIn('"', value, f"{locale}: {key}")
        self.assertEqual(translations.check_placeholders(), [])

    def test_every_language_is_merged_into_the_translations(self):
        for key in ENGLISH:
            for locale in translations.LOCALES:
                self.assertIsNotNone(translations.text(key, locale), f"{locale}: {key}")

    def test_the_card_title_fits_the_task_list_header(self):
        # The plan block shows a title of at most 80 characters; a longer one reads "Tasks".
        sample = computer_steps.STATUS_EN["status.agent.hxComputer.plan"].format(app="Microsoft Excel", keys="Ctrl+Alt+Esc")
        self.assertLessEqual(len(sample), 80)
        team = computer_steps.STATUS_EN["status.agent.hxTeam.progress"].format(count=80, limit=80, minutes=240, max=240)
        self.assertLessEqual(len(team), 80)

    def test_the_step_runs_after_the_teams_and_before_the_rename(self):
        rebrand = (Path(__file__).resolve().parent.parent / "rebrand.py").read_text(encoding="utf-8")
        order = rebrand[rebrand.index("def main()"):]
        self.assertLess(order.index("team_rooms"), order.index("computer_work"))
        self.assertLess(order.index("computer_work"), order.index("rename_all"))


if __name__ == "__main__":
    unittest.main()
