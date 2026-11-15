#!/usr/bin/env python3
"""Mac 版的固定签名（v1.6.8，「HXBot-Mac隐私与权限-最优方案」第三节 ① ⑦）。

macOS 按签名身份记授权；这几个文件写错了，要等用户的 Mac 升级后丢了授权才知道，所以在这里逐条核对：
证书脚本不把证书和密码打到屏幕上、写进 GitHub 的名字对得上；打包时有证书就签名、权限声明对；
打好后核对签名身份，身份不对的 Mac 版不上传。
"""
from __future__ import annotations

import json
import os
import plistlib
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS = ["hx/scripts/mac-signing-cert.sh", "hx/scripts/mac-signing-keychain.sh", "hx/scripts/mac-signing-check.sh"]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def plist(path: str) -> dict:
    with open(ROOT / path, "rb") as handle:
        return plistlib.load(handle)


def mac_job(text: str) -> str:
    found = re.search(r"^  mac:\n(.*?)(?=^  [\w-]+:\n|\Z)", text, re.S | re.M)
    if not found:
        raise AssertionError("工作流里没有 mac 任务")
    return found.group(1)


class Scripts(unittest.TestCase):
    def test_bash_syntax(self):
        for script in SCRIPTS:
            run = subprocess.run(["bash", "-n", str(ROOT / script)], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, f"{script}: {run.stderr}")

    def test_no_variable_runs_into_chinese_text(self):
        """macOS 的 /bin/bash 3.2 把紧跟在 $NAME 后面的中文标点的第一个字节也读成变量名（2026-11-14 用户在 Mac 上
        运行 mac-signing-cert.sh 时报 “P12_FILE?: unbound variable”）。在 Mac 上运行的脚本一律写成 ${NAME}。"""
        found = []
        for path in sorted((ROOT / "hx" / "scripts").glob("*.sh")):
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if line.lstrip().startswith("#"):
                    continue
                for match in re.finditer(r"\$[A-Za-z_][A-Za-z0-9_]*(?=[^\x00-\x7f])", line):
                    found.append(f"{path.name}:{number}: {match.group(0)}")
        self.assertEqual(found, [])

    def test_secrets_are_never_printed(self):
        for script in SCRIPTS:
            for number, line in enumerate(read(script).splitlines(), 1):
                if re.search(r"\b(echo|printf)\b", line) and not line.lstrip().startswith("#"):
                    printed = line.split("|", 1)[0]
                    for secret in ("$PASS", "${PASS", "$P12_PASSWORD", "${P12_PASSWORD", "$P12\"", "${P12:", "$KEYCHAIN_PASSWORD"):
                        if secret in printed and "gh secret set" not in line and "base64 --decode" not in line:
                            self.fail(f"{script}:{number} 会把秘密打到屏幕上：{line.strip()}")

    def test_cert_script_writes_the_names_that_the_build_reads(self):
        cert = read("hx/scripts/mac-signing-cert.sh")
        build = read(".github/workflows/hx-build.yml")
        for name in ("HXBOT_MAC_CERT_P12_BASE64", "HXBOT_MAC_CERT_PASSWORD"):
            self.assertIn(f"gh secret set {name}", cert)
            self.assertIn(f"secrets.{name}", build)
        self.assertIn("gh variable set HXBOT_MAC_CERT_SHA1", cert)
        self.assertIn("vars.HXBOT_MAC_CERT_SHA1", build)
        # the Mac's own LibreSSL: its .p12 imports into a keychain on any Mac
        self.assertIn("OPENSSL=/usr/bin/openssl", cert)
        self.assertIn("OPENSSL=/usr/bin/openssl", read("hx/scripts/mac-signing-keychain.sh"))
        # on a runner, add-trusted-cert waits for a password window unless this right is allowed first
        keychain = read("hx/scripts/mac-signing-keychain.sh")
        self.assertLess(keychain.index("authorizationdb write com.apple.trust-settings.admin allow"),
                        keychain.index("security add-trusted-cert"))
        # one certificate for ever: a second run must not make a new one
        self.assertIn("不要再生成新的", cert)
        self.assertIn("extendedKeyUsage = critical, codeSigning", cert)

    def test_check_script_pins_the_identity(self):
        check = read("hx/scripts/mac-signing-check.sh")
        for text in ('BUNDLE_ID="com.hxallai.bot"', "codesign --verify --deep --strict", 'H\\"$SHA1\\"',
                     "flags=.*runtime", "com.apple.security.automation.apple-events",
                     "com.apple.developer.associated-domains", "NSAppleEventsUsageDescription",
                     "NSScreenCaptureUsageDescription", "NSMicrophoneUsageDescription"):
            self.assertIn(text, check)


class Entitlements(unittest.TestCase):
    def test_signed_build_entitlements(self):
        main = plist("build/hx-entitlements.mac.plist")
        inherit = plist("build/hx-entitlements.mac.inherit.plist")
        self.assertNotIn("com.apple.developer.associated-domains", main)
        self.assertNotIn("com.apple.developer.team-identifier", main)
        for key in ("com.apple.security.automation.apple-events", "com.apple.security.cs.disable-library-validation",
                    "com.apple.security.cs.allow-jit", "com.apple.security.device.audio-input"):
            self.assertIs(main.get(key), True, key)
        for key in ("com.apple.security.inherit", "com.apple.security.cs.disable-library-validation"):
            self.assertIs(inherit.get(key), True, key)

    def test_the_bundle_keeps_its_identifier(self):
        self.assertRegex(read("electron-builder.yml"), r"(?m)^appId: com\.hxallai\.bot$")


class Build(unittest.TestCase):
    def test_dist_mac_runs_the_signing_step(self):
        scripts = json.loads(read("package.json"))["scripts"]
        self.assertTrue(scripts["dist:mac"].endswith("&& bun hx/scripts/mac-dist.ts"), scripts["dist:mac"])
        self.assertNotIn("identity=null", scripts["dist:mac"])

    @unittest.skipUnless(shutil.which("bun"), "bun is not installed")
    def test_builder_arguments(self):
        def args(**env):
            run = subprocess.run(["bun", str(ROOT / "hx/scripts/mac-dist.ts")], capture_output=True, text=True,
                                 cwd=ROOT, env={**os.environ, "HX_MAC_DIST_DRY": "1", **env}, timeout=120)
            self.assertEqual(run.returncode, 0, run.stderr)
            return json.loads(run.stdout.strip().splitlines()[-1]), run.stderr

        unsigned, warning = args(HXBOT_MAC_IDENTITY="")
        self.assertIn("--config.mac.identity=null", unsigned)
        self.assertIn("no fixed signature", warning)
        signed, _ = args(HXBOT_MAC_IDENTITY="HXBot Code Signing")
        self.assertIn("--config.mac.identity=HXBot Code Signing", signed)
        self.assertIn("--config.mac.entitlements=build/hx-entitlements.mac.plist", signed)
        self.assertIn("--config.mac.entitlementsInherit=build/hx-entitlements.mac.inherit.plist", signed)
        self.assertIn("--config.mac.timestamp=none", signed)
        developer_id, _ = args(HXBOT_MAC_IDENTITY="Developer ID Application: HX AI (TEAM123456)", HXBOT_MAC_DEVELOPER_ID="1")
        self.assertNotIn("--config.mac.timestamp=none", developer_id)

    def test_workflow_signs_checks_then_uploads(self):
        job = mac_job(read(".github/workflows/hx-build.yml"))
        order = [job.index(text) for text in (
            "bash hx/scripts/mac-signing-keychain.sh",
            "run: bun run dist:mac",
            "bash hx/scripts/mac-signing-check.sh dist/mac-arm64/HXBot.app",
            "actions/upload-artifact",
        )]
        self.assertEqual(order, sorted(order), "签名、打包、核对、上传的顺序不对")
        self.assertIn("HXBOT_MAC_IDENTITY: ${{ steps.signing.outputs.identity }}", job)
        self.assertIn("ALLOW_UNSIGNED: ${{ inputs.allow_unsigned_mac }}", job)


if __name__ == "__main__":
    unittest.main()
