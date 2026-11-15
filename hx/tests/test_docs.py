#!/usr/bin/env python3
"""每个版本交付的四份文档（hx/docs 里的部署文档、上线操作手册、客户端构建、服务器构建）的检查：

- 四份都在，标题写着同一个版本号，且就是 hx/docs/部署文档.md “适用版本”写的版本；
- 文档里的 bash 命令段都能通过 bash -n 语法检查（照着复制执行不会因为少引号、少括号出错）；
- 不再有“服务器公网IP”这样要人替换的占位（命令按服务器 47.119.145.170 写好）；
- 写到的客户端安装包名和 package.json、apps/mobile/app.json 的版本一致；
- 《新功能与亮点》（hx/docs/site/whats-new.*.md）写到了这一版，版本号用客户端的版本号（hx/brand.json，用户要求）：
  version 是各端现在的版本号，最前面一节就是这一版的客户端版本，桌面端各版从新到旧排、从 0.67.3 起一版不少（版本依次叠加），
  每节下面一行写着各端这次的版本号，不出现内部版本号 v1.6.x；全页一个 HOT、一个 NEW；
- hx/scripts/push-github.sh 只把 hx-build.yml、hx-computer-check.yml 和 release.yml 三个工作流推到 GitHub，且改造脚本用到的 release.yml 还在源码里。
运行：python3 hx/tests/test_docs.py
"""

import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = ["部署文档", "上线操作手册", "客户端构建", "服务器构建"]
SERVER_IP = "47.119.145.170"


def read(name: str) -> str:
    return (ROOT / "hx" / "docs" / f"{name}.md").read_text(encoding="utf-8")


def release() -> str:
    return re.search(r"\*\*适用版本：v([0-9.]+)（", read("部署文档")).group(1)


class Docs(unittest.TestCase):
    def test_all_four_for_this_release(self):
        tag = release()
        for name in DOCS[1:]:
            title = read(name).splitlines()[0]
            self.assertIn(f"v{tag}", title, name)

    def test_whats_new_has_this_release_first_and_keeps_the_earlier_ones(self):
        versions = json.loads((ROOT / "hx" / "brand.json").read_text(encoding="utf-8"))["versions"]
        desktop, mobile = versions["desktop"], versions["mobile"]
        key = lambda v: tuple(int(p) for p in v.split("."))
        words = {
            "zh": {"desktop": "桌面端", "mobile": "手机端", "meta_desktop": "桌面端和网页版", "colon": "："},
            "en": {"desktop": "Desktop", "mobile": "Mobile", "meta_desktop": "Desktop and web", "colon": ":"},
        }
        for lang, w in words.items():
            text = (ROOT / "hx" / "docs" / "site" / f"whats-new.{lang}.md").read_text(encoding="utf-8")
            self.assertIn(f"\nversion: {w['desktop']} {desktop} · {w['mobile']} {mobile}\n", text, lang)
            self.assertNotRegex(text, r"\bv1\.[0-9]+\.[0-9]+", f"{lang}：用户看到的版本号只用客户端的版本号")
            heads = re.findall(r"^## (.+?) \{#((?:desktop|mobile)-[0-9-]+)\}\n\n(.+)$", text, re.M)
            all_heads = re.findall(r"^## .+$", text, re.M)
            self.assertEqual(len(heads), len(all_heads), f"{lang}：每节标题都要写客户端和版本号，带 {{#desktop-x-y-z}}")
            seen = []
            for title, anchor, meta in heads:
                name = title.split(w["colon"])[0]
                found = dict(re.findall(rf"({w['desktop']}|{w['mobile']}) ([0-9.]+[0-9])", name))
                self.assertTrue(found, f"{lang}：{title}")
                first = next(iter(found.items()))
                self.assertEqual(anchor, ("desktop-" if first[0] == w["desktop"] else "mobile-") + first[1].replace(".", "-"))
                if w["desktop"] in found:
                    self.assertIn(f"{w['meta_desktop']} {found[w['desktop']]}", meta, f"{lang}：{title}")
                    seen.append(found[w["desktop"]])
                if w["mobile"] in found:
                    self.assertIn(f"{w['mobile']} {found[w['mobile']]}", meta, f"{lang}：{title}")
            # 最前面一节是这一版：标题里的版本号就是各端现在的版本号
            first_title = heads[0][0].split(w["colon"])[0]
            for client, now in ((w["desktop"], desktop), (w["mobile"], mobile)):
                for v in re.findall(rf"{client} ([0-9.]+[0-9])", first_title):
                    self.assertEqual(v, now, f"{lang}：最前面一节应是这一版")
            self.assertIn(f"{w['meta_desktop']} {desktop}", heads[0][2], lang)
            self.assertIn(f"{w['mobile']} {mobile}", heads[0][2], lang)
            # 桌面端各版从新到旧、0.67.3 起一版不少（同一个次版本里末位逐一减一）
            self.assertEqual(seen, sorted(seen, key=key, reverse=True), lang)
            self.assertEqual(seen[-1], "0.67.3", lang)
            for newer, older in zip(seen, seen[1:]):
                a, b = key(newer), key(older)
                if a[:2] == b[:2]:
                    self.assertEqual(a[2] - b[2], 1, f"{lang}：{older} 和 {newer} 之间少了一版")
            for tag in ("HOT", "NEW"):
                self.assertEqual(text.count("{" + tag + "}"), 1, f"{lang}：{tag} 应有且只有一个")

    def test_bash_blocks_parse(self):
        for name in DOCS:
            blocks = re.findall(r"```bash\n(.*?)```", read(name), re.S)
            self.assertTrue(blocks, name)
            for block in blocks:
                result = subprocess.run(["bash", "-n"], input=block, text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, f"{name}: {result.stderr}\n{block[:300]}")

    def test_no_placeholders_for_the_server(self):
        for name in DOCS:
            text = read(name)
            self.assertNotIn("服务器公网IP", text, name)
            self.assertNotIn("root@服务器IP ", text.replace("upload-downloads.sh root@服务器IP dist/", ""), name)
        self.assertIn(SERVER_IP, read("上线操作手册"))

    def test_installer_names_match_the_versions(self):
        desktop = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
        mobile = json.loads((ROOT / "apps/mobile/app.json").read_text(encoding="utf-8"))["expo"]["version"]
        for name in ("上线操作手册", "客户端构建"):
            text = read(name)
            for found in re.findall(r"HXBot-([0-9.]+[0-9])-(?:arm64|x64)", text):
                self.assertEqual(found, desktop, name)
            for found in re.findall(r"HXBot-([0-9.]+[0-9])-(?:android|ios)", text):
                if found != mobile:
                    # 只能以“上一版的安装包”出现（例如核对签名时拿来比较的旧 APK）
                    self.assertRegex(text, rf"上一版[^\n]*HXBot-{re.escape(found)}-", name)

    def test_push_keeps_only_the_build_workflows(self):
        script = (ROOT / "hx/scripts/push-github.sh").read_text(encoding="utf-8")
        self.assertIn("hx-build.yml | hx-computer-check.yml | release.yml) ;;", script)
        self.assertTrue((ROOT / ".github/workflows/hx-build.yml").is_file())
        self.assertTrue((ROOT / ".github/workflows/hx-computer-check.yml").is_file())
        self.assertTrue((ROOT / ".github/workflows/release.yml").is_file())


if __name__ == "__main__":
    unittest.main(verbosity=1)
