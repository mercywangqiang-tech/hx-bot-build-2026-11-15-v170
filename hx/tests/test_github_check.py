#!/usr/bin/env python3
"""电脑操控的真系统检查在 GitHub 上怎么跑：工作流、推送脚本、打包脚本、放到公开仓库里跑的那一套。

这些文件写错了，本地的单元测试看不出来，要等推到 GitHub 才知道；所以在这里把容易错的地方逐条核对。
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
MACHINES = "macos-15,macos-26,windows-2025,windows-2022,windows-11-arm"


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def job(text: str, name: str) -> str:
    """一个任务的全部文字：从“  名字:”到下一个同级的任务。"""
    found = re.search(rf"^  {re.escape(name)}:\n(.*?)(?=^  [\w-]+:\n|\Z)", text, re.S | re.M)
    if not found:
        raise AssertionError(f"工作流里没有任务 {name}")
    return found.group(1)


def run_lines(text: str) -> list:
    """所有脚本行（run: 后面的内容）。"""
    lines = []
    inside = None
    for line in text.splitlines():
        indent = len(line) - len(line.lstrip())
        if inside is not None and line.strip() and indent > inside:
            lines.append(line)
            continue
        inside = None
        found = re.match(r"^(\s*)(?:- )?run: (.*)$", line)
        if found:
            if found.group(2).strip() in ("|", ">"):
                inside = len(found.group(1)) + (2 if "- run:" in line else 0)
            else:
                lines.append(found.group(2))
    return lines


class ProductWorkflow(unittest.TestCase):
    def setUp(self):
        self.text = read(".github/workflows/hx-computer-check.yml")

    def test_runs_by_hand_and_from_the_build_and_never_by_itself(self):
        # 私有仓库里跑一次约扣 200 分钟额度：推送、定时都不触发，只有人点了才跑。
        triggers = self.text[self.text.index("\non:\n") : self.text.index("\npermissions:\n")]
        self.assertIn("  workflow_dispatch:\n", triggers)
        self.assertIn("  workflow_call:\n", triggers)
        self.assertNotIn("push:", triggers)
        self.assertNotIn("schedule:", triggers)
        self.assertNotIn("pull_request", triggers)
        self.assertIn("name: HXBot computer check\n", self.text)

    def test_the_machines_are_the_same_wherever_they_are_named(self):
        # 手动运行的默认值、被打包任务调用时的默认值、推送时用的清单，三处必须是同一份。
        self.assertEqual(self.text.count(f'default: "{MACHINES}"'), 2)
        self.assertIn(f"inputs.machines || '{MACHINES}'", self.text)
        self.assertEqual(len(MACHINES.split(",")), 5)

    def test_reads_the_repository_and_nothing_more(self):
        self.assertIn("\npermissions:\n  contents: read\n", self.text)
        self.assertEqual(self.text.count("permissions:"), 1)
        self.assertNotIn("secrets.", self.text)
        self.assertNotIn("contents: write", self.text)

    def test_prepare_tests_and_bundles_before_any_machine_starts(self):
        prepare = job(self.text, "prepare")
        self.assertIn("runs-on: ubuntu-latest", prepare)
        order = [
            "python3 hx/rebrand.py",
            "bun install --frozen-lockfile",
            "bunx vitest run src/backend/hx-computer",
            "python3 hx/tests/test_github_check.py",
            "bash hx/scripts/computer-check-bundle.sh dist-check",
            "name: hxbot-computer-check-program",
        ]
        places = [prepare.index(step) for step in order]
        self.assertEqual(places, sorted(places))
        self.assertIn("if-no-files-found: error", prepare)
        self.assertIn("needs: prepare", job(self.text, "machine"))

    def test_every_machine_runs_to_the_end_and_always_hands_in_its_results(self):
        machine = job(self.text, "machine")
        self.assertIn("fail-fast: false", machine)
        self.assertIn("include: ${{ fromJSON(needs.prepare.outputs.machines) }}", machine)
        self.assertIn("runs-on: ${{ matrix.machine }}", machine)
        self.assertIn("timeout-minutes: ${{ matrix.timeout }}", machine)
        self.assertIn(
            'node hx-computer-check.mjs --out out --machine "$MACHINE" --budget-minutes "$BUDGET" $flags', machine)
        # The slow ARM machine gets more time; every machine stops starting checks before its timeout.
        prepare = job(self.text, "prepare")
        self.assertIn('85 if name.endswith("-arm") else 35', prepare)
        self.assertIn('100 if name.endswith("-arm") else 45', prepare)
        # 检查不通过时这一步是失败的；成绩单和上传必须照样做。
        upload = machine[machine.index("name: Upload the results") :]
        self.assertIn("if: always()", upload)
        self.assertIn("name: hxbot-check-${{ matrix.machine }}", upload)
        self.assertIn("path: out", upload)
        summary = machine[machine.index("name: Show the summary") : machine.index("name: Upload the results")]
        self.assertIn("if: always()", summary)
        self.assertIn('>> "$GITHUB_STEP_SUMMARY"', summary)
        # Mac 和 Windows 机器上不取源码、不装依赖，只运行打好的那个文件。
        self.assertNotIn("actions/checkout", machine)
        self.assertNotIn("bun install", machine)

    def test_scripts_run_in_bash_on_every_system(self):
        # Windows 机器默认用 PowerShell，这里的脚本是 bash 写的。
        for name in ("machine", "summary"):
            text = job(self.text, name)
            self.assertEqual(text.count("run: |"), text.count("shell: bash"), name)

    def test_the_summary_runs_even_when_a_machine_failed_and_turns_the_run_red(self):
        summary = job(self.text, "summary")
        self.assertIn("needs: [prepare, machine]", summary)
        self.assertIn("if: always() && needs.prepare.result == 'success'", summary)
        self.assertIn('node hx-computer-check.mjs --merge all --expected "$EXPECTED"', summary)
        self.assertIn("EXPECTED: ${{ needs.prepare.outputs.expected }}", summary)
        self.assertIn("name: hxbot-check-all", summary)
        self.assertIn("if: steps.merge.outputs.code != '0'", summary)
        self.assertIn("exit 1", summary)
        # 没有一台机器交回结果时，下载这一步会报错；合并照样要做，由它来说“有机器没有交回结果”。
        download = summary[summary.index("name: Download the results of every machine") :]
        self.assertIn("continue-on-error: true", download.split("- name:")[0])

    def test_the_program_is_not_taken_for_the_results_of_a_machine(self):
        # 汇总时按 hxbot-check-* 下载每台机器的结果；检查程序自己的名字不能落进这个范围。
        self.assertIn("pattern: hxbot-check-*", self.text)
        self.assertFalse("hxbot-computer-check-program".startswith("hxbot-check-"))
        self.assertEqual(self.text.count("name: hxbot-computer-check-program"), 3)

    def test_nothing_from_outside_is_pasted_into_a_script(self):
        # 机器名、输入项都经环境变量进脚本，不直接拼进脚本文字。
        for line in run_lines(self.text):
            self.assertNotIn("${{", line, line)
        self.assertGreater(len(run_lines(self.text)), 20)


class Versions(unittest.TestCase):
    def test_the_official_actions_are_the_ones_built_for_node_24(self):
        wanted = {
            "checkout": "v6",
            "setup-node": "v6",
            "setup-java": "v5",
            "upload-artifact": "v7",
            "download-artifact": "v8",
        }
        for path in (
            ".github/workflows/hx-computer-check.yml",
            ".github/workflows/hx-build.yml",
            "hx/computer-check/public-workflow.yml",
        ):
            text = read(path)
            for name, version in re.findall(r"uses: actions/([\w-]+)@(\S+)", text):
                if name in wanted:
                    self.assertEqual(version, wanted[name], f"{path}: {name}")
            self.assertIn("actions/setup-node@v6", text, path)
            self.assertIn("node-version: 24", text, path)


class Build(unittest.TestCase):
    def setUp(self):
        self.text = read(".github/workflows/hx-build.yml")

    def test_the_build_runs_the_check_beside_it_only_when_asked_and_does_not_wait_for_it(self):
        check = job(self.text, "computer-check")
        self.assertIn("uses: ./.github/workflows/hx-computer-check.yml", check)
        self.assertIn("if: inputs.computer_check == 'yes'", check)
        asked = self.text[self.text.index("      computer_check:") : self.text.index("\npermissions:")]
        self.assertIn('default: "no"', asked)
        for name in ("mac", "windows", "android"):
            self.assertNotIn("needs:", job(self.text, name), name)


class Push(unittest.TestCase):
    def setUp(self):
        self.text = read("hx/scripts/push-github.sh")

    def test_the_push_keeps_the_check_and_nothing_that_runs_by_itself(self):
        self.assertIn("hx-build.yml | hx-computer-check.yml | release.yml) ;;", self.text)
        # 留下的工作流都不能自己运行：打包和检查只手动触发，release.yml 只在推版本标签时运行（脚本不推标签）。
        for name in ("hx-build.yml", "hx-computer-check.yml"):
            text = read(f".github/workflows/{name}")
            triggers = text[text.index("\non:\n") : text.index("\npermissions:\n")]
            self.assertNotIn("push:", triggers, name)
            self.assertNotIn("schedule:", triggers, name)
        self.assertNotIn("--tags", self.text)


class Bundle(unittest.TestCase):
    def test_the_bundle_is_one_file_that_needs_only_node(self):
        text = read("hx/scripts/computer-check-bundle.sh")
        self.assertIn("bun build scripts/hx-computer-check.ts --target=node --format=esm", text)
        self.assertIn("grep -v 'from \"node:'", text)
        self.assertIn("exit 1", text)

    def test_the_entry_brings_in_the_check_and_nothing_of_the_app(self):
        text = read("scripts/hx-computer-check.ts")
        imports = re.findall(r'from "([^"]+)"', text)
        for name in imports:
            self.assertTrue(name.startswith("node:") or name.startswith("../src/backend/hx-computer/"), name)
        # 入口不经过应用的单例（那会把登录、授权记录等整个后台带进来），也不替人在 Linux 上空跑。
        self.assertNotIn("hx-computer/computer", text)
        self.assertIn("只在 macOS 和 Windows 上运行", text)
        self.assertIn("不要在自己的电脑上运行", text)

    def test_the_app_itself_does_not_use_the_check(self):
        # realcheck*.ts 会真的修改设置，只能从入口和测试里引用。
        allowed = re.compile(r"hx-computer/realcheck[\w.-]*\.ts$")
        for folder in ("src", "packages", "apps"):
            for path in (ROOT / folder).rglob("*.ts*"):
                if "node_modules" in path.parts or allowed.search(path.as_posix()):
                    continue
                text = path.read_text(encoding="utf-8", errors="ignore")
                self.assertNotRegex(text, r'from "[^"]*realcheck', path.as_posix())


class Public(unittest.TestCase):
    def setUp(self):
        self.text = read("hx/computer-check/public-workflow.yml")

    def test_the_public_workflow_runs_the_committed_file_on_the_same_machines(self):
        self.assertIn("  push:\n    branches: [__BRANCH__]\n", self.text)
        listed = re.findall(r"- \{ machine: ([\w-]+), budget: (\d+), timeout: (\d+) \}", self.text)
        self.assertEqual([name for name, _, _ in listed], MACHINES.split(","))
        for name, budget, timeout in listed:
            # The check stops starting new items ten minutes or more before the job is stopped.
            self.assertGreaterEqual(int(timeout) - int(budget), 10, name)
        self.assertIn(f'--expected "{MACHINES}"', self.text)
        machine = job(self.text, "machine")
        self.assertIn("fail-fast: false", machine)
        self.assertIn('node hx-computer-check.mjs --out out --machine "$MACHINE" --budget-minutes "$BUDGET"', machine)
        self.assertIn("timeout-minutes: ${{ matrix.timeout }}", machine)
        self.assertIn("if: always()", machine[machine.index("name: Upload the results") :])
        # 公开仓库里没有产品源码：不装依赖、不运行改造脚本。
        for word in (r"\bbun\b", r"rebrand", r"hx/scripts"):
            self.assertNotRegex(self.text.split("\njobs:\n")[1], word)
        for line in run_lines(self.text):
            self.assertNotIn("${{", line, line)

    def test_only_the_summary_may_write_and_only_to_the_results_branch(self):
        self.assertIn("\npermissions:\n  contents: read\n", self.text)
        self.assertNotIn("contents: write", job(self.text, "machine"))
        summary = job(self.text, "summary")
        self.assertIn("permissions:\n      contents: write", summary)
        self.assertIn('branch="__BRANCH__-results"', summary)
        self.assertIn('git push -q origin "$branch"', summary)
        self.assertNotIn("--force", summary)
        self.assertNotIn("secrets.", self.text)

    def test_the_script_fills_in_the_branch_and_refuses_private_content(self):
        text = read("hx/scripts/computer-check-public.sh")
        self.assertIn('sed "s|__BRANCH__|$BRANCH|g"', text)
        self.assertIn("computer-check-bundle.sh", text)
        self.assertIn("PRIVATE=", text)
        self.assertIn("exit 1", text)
        for name in ("hx/computer-check/public-workflow.yml", "hx/computer-check/public-readme.md"):
            self.assertIn("__BRANCH__", read(name), name)
        # 公开出去的说明和工作流里不出现服务器地址和域名。
        for name in ("hx/computer-check/public-workflow.yml", "hx/computer-check/public-readme.md"):
            self.assertNotRegex(read(name), r"47\.119\.|hxallai", name)


if __name__ == "__main__":
    unittest.main(verbosity=1)
