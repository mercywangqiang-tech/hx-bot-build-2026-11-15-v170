#!/usr/bin/env python3
"""研究版界面文字译文的检查：hx/translations.py（含 translations_v162.py、translations_v164.py 并进来的部分）。

- 13 种语言每个登记的键都有译文，占位符和英文一样；
- 1.6.2 新加的键与各步骤里的英文一一对应（access_settings.py、forced_updates.py），说明文字覆盖了“按需授权”的旧译文；
- 产品名照原样（HXBot、Computer Use）。
运行：python3 hx/tests/test_translations.py
"""

import re
import sys
import unittest
from pathlib import Path

HX = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HX))

import access_control  # noqa: E402
import access_settings  # noqa: E402
import forced_updates  # noqa: E402
import settings_nav  # noqa: E402
import translations  # noqa: E402
import translations_v162  # noqa: E402
import translations_v164  # noqa: E402


def flat(entries: dict) -> dict:
    out = {}
    for key, value in entries.items():
        if isinstance(value, dict):
            out.update(flat(value))
        else:
            out[key] = value
    return out


def english_v162() -> dict:
    english = flat(access_settings.TEXT_EN)
    for name in ("TEXT_EN", "SETTINGS_EN", "MOBILE_EN"):
        english.update(flat(getattr(forced_updates, name)))
    return english


def names(text: str) -> set:
    return set(re.findall(r"\{(\w+)\}", text))


class Translations(unittest.TestCase):
    def test_placeholders(self):
        self.assertEqual(translations.check_placeholders(), [])

    def test_every_key_in_every_locale(self):
        for key in translations.KEYS:
            for locale in translations.LOCALES:
                self.assertTrue(translations.has(key, locale), f"{locale}: {key}")

    def test_v162_keys_match_english(self):
        english = english_v162()
        self.assertEqual(set(translations_v162.NEW_KEYS), set(english))
        for locale, phrases in translations_v162.NEW.items():
            self.assertEqual(set(phrases), set(english), locale)
            for key, value in phrases.items():
                self.assertEqual(names(value), names(english[key]), f"{locale}: {key}")
                self.assertTrue(value.strip(), f"{locale}: {key}")

    def test_v164_keys_match_english(self):
        english = settings_nav.TEXT_EN
        self.assertEqual(set(translations_v164.NEW_KEYS), set(english))
        self.assertEqual(set(settings_nav.TEXT_ZH), set(english))
        for locale, phrases in translations_v164.NEW.items():
            self.assertEqual(set(phrases), set(english), locale)
            for key, value in phrases.items():
                self.assertEqual(names(value), names(english[key]), f"{locale}: {key}")
                self.assertTrue(value.strip(), f"{locale}: {key}")
                self.assertNotIn('"', value, f"{locale}: {key}")
            self.assertIn("bot@hxallai.com", phrases["settings.help.feedback.description"], locale)
            self.assertIn("HXBot", phrases["settings.tab.about.description"], locale)

    def test_notes_say_maximum_access(self):
        notes = [key for entries in access_control.NOTES_EN.values() for key in entries]
        for locale in translations.LOCALES:
            label = access_control.LABELS[locale]
            for key in notes:
                self.assertIsNotNone(translations.text(key, locale), f"{locale}: {key}")
            note = translations.text("agentSettings.runtime.workspaceNote", locale)
            self.assertTrue(note.startswith(label), f"{locale}: {note[:40]}")
            self.assertIn("Computer Use", note, locale)
            self.assertEqual(translations_v162.ACCESS[locale]["noteProcess"].count("{provider}"), 1, locale)

    def test_no_ascii_double_quotes(self):
        # Biome 会把含双引号的字符串改成单引号，translate() 就认不出已写好的译文
        for locale, phrases in translations_v162.NEW.items():
            for key, value in [*phrases.items(), *translations_v162.ACCESS[locale].items()]:
                self.assertNotIn('"', value, f"{locale}: {key}")

    def test_product_names_kept(self):
        for locale, phrases in translations_v162.NEW.items():
            for key in ("update.hxForced.title", "mobile.app.hxForced.title", "settings.hxAccess.loadFailed"):
                self.assertIn("HXBot", phrases[key], f"{locale}: {key}")
            self.assertIn("bot.hxallai.com", phrases["mobile.app.hxForced.manual"], locale)


if __name__ == "__main__":
    unittest.main(verbosity=1)
