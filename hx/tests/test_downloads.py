#!/usr/bin/env python3
"""下载中心脚本的测试：publish-downloads.py（生成 manifest.json 和 iOS 无线安装清单）与 upload-downloads.sh。

运行：python3 hx/tests/test_downloads.py
只用标准库；ipa 用很小的替身文件（结构与真实 ipa 相同：Payload/应用.app/Info.plist + embedded.mobileprovision）。
"""

import hashlib
import json
import os
import plistlib
import re
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLISH = ROOT / "hx" / "server" / "scripts" / "publish-downloads.py"
UPLOAD = ROOT / "hx" / "scripts" / "upload-downloads.sh"
TESTFLIGHT = "https://testflight.apple.com/join/AbCd1234"


def profile(kind):
    body = {
        "Name": "HXBot " + kind,
        "ExpirationDate": datetime(2027, 11, 10, 8, 0, 0),
        "Entitlements": {"application-identifier": "ABCDE12345.com.hxallai.bot", "get-task-allow": kind == "development"},
    }
    if kind in ("adhoc", "development"):
        body["ProvisionedDevices"] = ["00008110-000A1B2C3D4E801E", "00008120-001122334455601E", "00008030-000F00D0CAFE802E"]
    if kind == "enterprise":
        body["ProvisionsAllDevices"] = True
    # 真实的描述文件是一段签名数据，中间夹着 XML
    return b"\x30\x82\x1f\x00signature\x00\x01" + plistlib.dumps(body) + b"\x00signature\xff\xfe"


def make_ipa(path, kind, version="1.4.7", payload=b"app", build="2611111530"):
    info = {
        "CFBundleIdentifier": "com.hxallai.bot",
        "CFBundleShortVersionString": version,
        "CFBundleVersion": build,
        "CFBundleDisplayName": "HXBot",
        "MinimumOSVersion": "16.4",
    }
    with zipfile.ZipFile(str(path), "w", zipfile.ZIP_DEFLATED) as archive:
        # 扩展排在前面：脚本要读的是应用本身的 Info.plist，不是扩展的
        archive.writestr("Payload/HXBot.app/PlugIns/Share.appex/Info.plist", plistlib.dumps({"CFBundleIdentifier": "com.hxallai.bot.ShareExtension"}))
        archive.writestr("Payload/HXBot.app/Info.plist", plistlib.dumps(info, fmt=plistlib.FMT_BINARY))
        if kind != "unsigned":
            archive.writestr("Payload/HXBot.app/embedded.mobileprovision", profile(kind))
        archive.writestr("Payload/HXBot.app/HXBot", payload)


class PublishTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name) / "downloads"
        self.directory.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def publish(self, *args, expect=0):
        result = subprocess.run(
            [sys.executable, str(PUBLISH), str(self.directory)] + list(args),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
        )
        self.assertEqual(result.returncode, expect, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def manifest(self):
        return json.loads((self.directory / "manifest.json").read_text(encoding="utf-8"))

    def item(self, platform):
        return next((entry for entry in self.manifest()["items"] if entry["platform"] == platform), None)

    def tokens(self):
        root = self.directory / ".ota"
        return sorted(entry.name for entry in root.iterdir()) if root.is_dir() else []

    def test_empty_directory(self):
        output = self.publish()
        self.assertEqual(self.manifest()["items"], [])
        self.assertIn("还没有安装包", output)
        self.assertIn("-ios.ipa", output)

    def test_desktop_and_android_unchanged(self):
        (self.directory / "HXBot-1.4.0-arm64.dmg").write_bytes(b"old")
        (self.directory / "HXBot-1.5.0-arm64.dmg").write_bytes(b"mac")
        (self.directory / "HXBot-1.5.0-rc1-x64.exe").write_bytes(b"rc")
        (self.directory / "HXBot-1.5.0-x64.exe").write_bytes(b"win")
        (self.directory / "HXBot-1.4.7-android.apk").write_bytes(b"apk")
        (self.directory / "notes.txt").write_bytes(b"ignored")
        self.publish()
        self.assertEqual([entry["platform"] for entry in self.manifest()["items"]], ["macos", "windows", "android"])
        self.assertEqual(self.item("macos")["file"], "HXBot-1.5.0-arm64.dmg")
        self.assertEqual(self.item("windows")["file"], "HXBot-1.5.0-x64.exe")
        self.assertEqual(self.item("android")["sha256"], hashlib.sha256(b"apk").hexdigest())
        self.assertEqual(self.item("android")["size"], 3)
        self.assertIsNone(self.item("ios"))
        # 安卓安装包有一个随机串地址，手机里点“更新”时由系统浏览器下载
        match = re.match(r"^/ota/([0-9a-f]{32})/HXBot\.apk$", self.item("android")["ota"])
        self.assertTrue(match, self.item("android")["ota"])
        self.assertEqual(self.tokens(), [match.group(1)])
        link = self.directory / ".ota" / match.group(1) / "HXBot.apk"
        self.assertTrue(link.is_symlink())
        self.assertEqual(os.readlink(str(link)), os.path.join("..", "..", "HXBot-1.4.7-android.apk"))
        self.assertEqual(link.read_bytes(), b"apk")
        self.assertEqual(self.mobile(), {"android": {"version": "1.4.7", "url": "https://bot.hxallai.com" + self.item("android")["ota"]}})

    def mobile(self):
        value = json.loads((self.directory / "updates" / "mobile.json").read_text(encoding="utf-8"))
        self.assertIn("updatedAt", value)
        value.pop("updatedAt")
        return value

    def test_android_address_kept_for_the_same_file_and_replaced_for_a_new_one(self):
        apk = self.directory / "HXBot-1.4.7-android.apk"
        apk.write_bytes(b"apk")
        self.publish()
        first = self.item("android")["ota"]
        self.publish()
        self.assertEqual(self.item("android")["ota"], first)
        apk.unlink()
        (self.directory / "HXBot-1.4.8-android.apk").write_bytes(b"new apk")
        self.publish()
        second = self.item("android")["ota"]
        self.assertNotEqual(second, first)
        self.assertEqual(self.tokens(), [second.split("/")[2]])
        self.assertEqual(self.mobile()["android"], {"version": "1.4.8", "url": "https://bot.hxallai.com" + second})
        (self.directory / "HXBot-1.4.8-android.apk").unlink()
        self.publish()
        self.assertEqual(self.tokens(), [])
        self.assertEqual(self.mobile(), {})

    def test_iphone_update_opens_the_install_link_or_testflight(self):
        make_ipa(self.directory / "HXBot-1.4.7-ios.ipa", "adhoc")
        self.publish("--site", "https://bot.example.com")
        manifest = "https://bot.example.com" + self.item("ios")["ota"]
        self.assertEqual(self.mobile()["ios"], {
            "version": "1.4.7",
            "url": "itms-services://?action=download-manifest&url=" + manifest.replace(":", "%3A").replace("/", "%2F"),
        })
        (self.directory / "HXBot-1.4.7-ios.ipa").unlink()
        self.publish("--ios-url", TESTFLIGHT)
        self.assertEqual(self.mobile()["ios"], {"version": "", "url": TESTFLIGHT})

    def desktop_feed(self, name, version, files):
        folder = self.directory / "updates" / "desktop"
        folder.mkdir(parents=True, exist_ok=True)
        lines = ["version: {}".format(version), "files:"]
        for file_name in files:
            lines += ["  - url: {}".format(file_name), "    sha512: AAAA", "    size: 3"]
        lines += ["path: {}".format(files[0]), "sha512: AAAA", "releaseDate: '2026-11-13T08:00:00.000Z'"]
        (folder / name).write_text("\n".join(lines) + "\n", encoding="utf-8")
        return folder

    def test_desktop_update_files(self):
        (self.directory / "HXBot-0.67.1-x64.exe").write_bytes(b"win")
        (self.directory / "HXBot-0.67.1-arm64.dmg").write_bytes(b"mac")
        folder = self.desktop_feed("latest.yml", "0.67.1", ["HXBot-0.67.1-x64.exe"])
        self.desktop_feed("latest-mac.yml", "0.67.1", ["HXBot-0.67.1-arm64.zip"])
        (folder / "HXBot-0.67.1-arm64.zip").write_bytes(b"zip")
        for name in ("HXBot-0.67.0-x64.exe.blockmap", "HXBot-0.67.1-x64.exe.blockmap", "HXBot-0.67.1-arm64.zip.blockmap"):
            (folder / name).write_bytes(b"map")
        output = self.publish()
        # Windows 的 exe 就是下载目录里的那个：放一个链接，不另存一份
        link = folder / "HXBot-0.67.1-x64.exe"
        self.assertTrue(link.is_symlink())
        self.assertEqual(os.readlink(str(link)), os.path.join("..", "..", "HXBot-0.67.1-x64.exe"))
        self.assertEqual(link.read_bytes(), b"win")
        self.assertIn("Mac 0.67.1：HXBot-0.67.1-arm64.zip（blockmap 3 个）", output)
        self.assertIn("Windows 0.67.1：HXBot-0.67.1-x64.exe（blockmap 3 个）", output)
        for path in (self.directory / "updates", folder):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE((folder / "latest.yml").stat().st_mode), 0o644)
        # 再运行一次结果不变
        self.assertIn("Windows 0.67.1：HXBot-0.67.1-x64.exe", self.publish())

    def test_desktop_update_files_that_point_at_missing_files(self):
        self.desktop_feed("latest-mac.yml", "0.67.1", ["HXBot-0.67.1-arm64.zip"])
        self.desktop_feed("latest.yml", "0.67.1", ["../manifest.json"])
        output = self.publish()
        self.assertIn("latest-mac.yml 指向的文件不在服务器上：HXBot-0.67.1-arm64.zip", output)
        self.assertIn("latest.yml 指向的文件不在服务器上：../manifest.json", output)
        self.assertNotIn("Mac 0.67.1", output)
        (self.directory / "updates" / "desktop" / "latest.yml").write_text("not a feed\n", encoding="utf-8")
        self.assertIn("latest.yml 读不出版本和文件", self.publish())

    def test_new_desktop_update_files_are_switched_on_only_when_complete(self):
        (self.directory / "HXBot-0.67.1-x64.exe").write_bytes(b"win")
        folder = self.desktop_feed("latest.yml", "0.67.1", ["HXBot-0.67.1-x64.exe"])
        self.desktop_feed("latest-mac.yml", "0.67.1", ["HXBot-0.67.1-arm64.zip"])
        (folder / "HXBot-0.67.1-arm64.zip").write_bytes(b"zip")
        (folder / "HXBot-0.67.1-x64.exe.blockmap").write_bytes(b"map")
        self.publish()
        old_windows = (folder / "latest.yml").read_text(encoding="utf-8")
        # 新的 Windows 安装包还没传上来：新的 latest.yml 不启用，客户端仍看到 0.67.1
        self.desktop_feed("latest.yml.new", "0.67.2", ["HXBot-0.67.2-x64.exe"])
        output = self.publish()
        self.assertIn("新上传的 latest.yml 指向的文件不在服务器上：HXBot-0.67.2-x64.exe。没有启用", output)
        self.assertEqual((folder / "latest.yml").read_text(encoding="utf-8"), old_windows)
        self.assertFalse((folder / "latest.yml.new").exists())
        # 传齐了就换上；Mac 换到 0.67.2 后旧的 ZIP 删掉，旧的 blockmap 留着
        (self.directory / "HXBot-0.67.2-x64.exe").write_bytes(b"win2")
        self.desktop_feed("latest.yml.new", "0.67.2", ["HXBot-0.67.2-x64.exe"])
        self.desktop_feed("latest-mac.yml.new", "0.67.2", ["HXBot-0.67.2-arm64.zip"])
        (folder / "HXBot-0.67.2-arm64.zip").write_bytes(b"zip2")
        (folder / "HXBot-0.67.2-x64.exe.blockmap").write_bytes(b"map2")
        output = self.publish()
        self.assertIn("Windows 0.67.2：HXBot-0.67.2-x64.exe（blockmap 2 个）", output)
        self.assertIn("Mac 0.67.2：HXBot-0.67.2-arm64.zip", output)
        self.assertEqual(sorted(path.name for path in folder.iterdir()), [
            "HXBot-0.67.1-x64.exe.blockmap", "HXBot-0.67.2-arm64.zip", "HXBot-0.67.2-x64.exe",
            "HXBot-0.67.2-x64.exe.blockmap", "latest-mac.yml", "latest.yml",
        ])
        self.assertIn("version: 0.67.2", (folder / "latest.yml").read_text(encoding="utf-8"))
        self.assertTrue((folder / "HXBot-0.67.2-x64.exe").is_symlink())

    def test_adhoc_ipa_gets_install_manifest(self):
        make_ipa(self.directory / "HXBot-1.4.7-ios.ipa", "adhoc")
        output = self.publish()
        ios = self.item("ios")
        self.assertEqual(ios["file"], "HXBot-1.4.7-ios.ipa")
        self.assertEqual(ios["version"], "1.4.7")
        self.assertEqual(ios["build"], "2611111530")
        self.assertEqual(ios["signing"], "adhoc")
        self.assertEqual(ios["minOS"], "16.4")
        self.assertEqual(ios["expires"], "2027-11-10")
        self.assertEqual(len(ios["sha256"]), 64)
        self.assertNotIn("url", ios)
        match = re.match(r"^/ota/([0-9a-f]{32})/manifest\.plist$", ios["ota"])
        self.assertTrue(match, ios["ota"])
        token = match.group(1)
        self.assertEqual(self.tokens(), [token])
        folder = self.directory / ".ota" / token
        document = plistlib.loads((folder / "manifest.plist").read_bytes())
        entry = document["items"][0]
        self.assertEqual(entry["metadata"], {"bundle-identifier": "com.hxallai.bot", "bundle-version": "1.4.7", "kind": "software", "title": "HXBot"})
        assets = {asset["kind"]: asset["url"] for asset in entry["assets"]}
        self.assertEqual(assets["software-package"], "https://bot.hxallai.com/ota/{}/HXBot.ipa".format(token))
        self.assertEqual(assets["display-image"], "https://bot.hxallai.com/icon-192x192.png")
        self.assertEqual(assets["full-size-image"], "https://bot.hxallai.com/icon-512x512.png")
        link = folder / "HXBot.ipa"
        self.assertTrue(link.is_symlink())
        self.assertEqual(os.readlink(str(link)), os.path.join("..", "..", "HXBot-1.4.7-ios.ipa"))
        self.assertEqual(link.read_bytes(), (self.directory / "HXBot-1.4.7-ios.ipa").read_bytes())
        for path in (self.directory / ".ota", folder):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE((folder / "manifest.plist").stat().st_mode), 0o644)
        self.assertIn("登记了 3 台设备", output)
        self.assertIn("构建号 2611111530", output)
        self.assertIn("2027-11-10", output)

    def test_a_new_build_of_the_same_version_shows_its_build_number(self):
        # 更新时版本号常常不变，只有构建号变大：下载页靠它看出换了安装包
        make_ipa(self.directory / "HXBot-1.4.7-ios.ipa", "adhoc", build="2611111530")
        self.publish()
        first = self.item("ios")
        make_ipa(self.directory / "HXBot-1.4.7-ios.ipa", "adhoc", payload=b"newer app", build="2612010900")
        self.publish()
        second = self.item("ios")
        self.assertEqual((first["version"], second["version"]), ("1.4.7", "1.4.7"))
        self.assertEqual((first["build"], second["build"]), ("2611111530", "2612010900"))
        self.assertNotEqual(first["ota"], second["ota"])
        self.assertNotEqual(first["sha256"], second["sha256"])

    def test_a_build_number_that_is_not_a_number_is_left_out(self):
        make_ipa(self.directory / "HXBot-1.4.7-ios.ipa", "adhoc", build='1"><script>')
        self.publish()
        self.assertNotIn("build", self.item("ios"))

    def inspect(self, path, expect=0):
        result = subprocess.run(
            [sys.executable, str(PUBLISH), "--inspect", str(path)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
        )
        self.assertEqual(result.returncode, expect, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def test_inspect_lists_the_devices_of_an_adhoc_package(self):
        path = self.directory / "HXBot-1.4.7-ios.ipa"
        make_ipa(path, "adhoc")
        output = self.inspect(path)
        self.assertIn("应用：HXBot（com.hxallai.bot）", output)
        self.assertIn("版本：1.4.7，构建号 2611111530", output)
        self.assertIn("iOS 16.4 或更新", output)
        self.assertIn("可以直接安装", output)
        self.assertIn("只能装到这 3 台已登记的设备", output)
        self.assertIn("00008110-000A1B2C3D4E801E", output)
        self.assertIn("2027-11-10", output)
        # 只是查看：不生成下载列表，也不生成无线安装清单
        self.assertFalse((self.directory / "manifest.json").exists())
        self.assertEqual(self.tokens(), [])

    def test_inspect_says_a_testflight_package_cannot_be_installed_directly(self):
        path = self.directory / "HXBot-1.4.7-ios.ipa"
        make_ipa(path, "appstore")
        output = self.inspect(path)
        self.assertIn("交给 TestFlight 用，不能直接装到手机", output)
        self.assertNotIn("已登记的设备（UDID）", output)

    def test_inspect_rejects_what_is_not_an_ipa(self):
        path = self.directory / "HXBot-1.4.7-ios.ipa"
        path.write_bytes(b"not a zip")
        self.assertIn("不是有效的 ipa", self.inspect(path, expect=1))
        self.assertIn("不是有效的 ipa", self.inspect(self.directory / "missing.ipa", expect=1))
        self.publish("--inspect", expect=1)
        self.publish("--inspect", str(path), "--ios-url", TESTFLIGHT, expect=1)

    def test_token_kept_for_same_file_and_replaced_for_new_file(self):
        ipa = self.directory / "HXBot-1.4.7-ios.ipa"
        make_ipa(ipa, "adhoc")
        self.publish()
        first = self.item("ios")["ota"]
        self.publish()
        self.assertEqual(self.item("ios")["ota"], first)
        # 同名文件换了内容：地址换新的，旧地址失效
        make_ipa(ipa, "adhoc", payload=b"rebuilt application")
        os.utime(str(ipa), (ipa.stat().st_atime, ipa.stat().st_mtime + 60))
        self.publish()
        second = self.item("ios")["ota"]
        self.assertNotEqual(second, first)
        self.assertEqual(self.tokens(), [second.split("/")[2]])
        # 新版本：只发布最新的，地址再换
        make_ipa(self.directory / "HXBot-1.5.0-ios.ipa", "adhoc", version="1.5.0")
        self.publish()
        third = self.item("ios")
        self.assertEqual(third["file"], "HXBot-1.5.0-ios.ipa")
        self.assertNotIn(third["ota"], (first, second))
        self.assertEqual(self.tokens(), [third["ota"].split("/")[2]])
        document = plistlib.loads((self.directory / ".ota" / self.tokens()[0] / "manifest.plist").read_bytes())
        self.assertEqual(document["items"][0]["metadata"]["bundle-version"], "1.5.0")

    def test_forged_previous_token_is_not_trusted(self):
        make_ipa(self.directory / "HXBot-1.4.7-ios.ipa", "adhoc")
        self.publish()
        manifest = self.manifest()
        for entry in manifest["items"]:
            if entry["platform"] == "ios":
                entry["ota"] = "/ota/../../etc/manifest.plist"
        (self.directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        self.publish()
        self.assertTrue(re.match(r"^/ota/[0-9a-f]{32}/manifest\.plist$", self.item("ios")["ota"]))
        self.assertEqual(len(self.tokens()), 1)

    def test_app_store_ipa_is_not_offered(self):
        make_ipa(self.directory / "HXBot-1.4.7-ios.ipa", "appstore")
        output = self.publish()
        self.assertIsNone(self.item("ios"))
        self.assertEqual(self.tokens(), [])
        self.assertIn("App Store / TestFlight", output)
        self.assertIn("--ios-url", output)
        self.assertIn("release-testing", output)

    def test_unsigned_and_broken_ipa_are_not_offered(self):
        make_ipa(self.directory / "HXBot-1.4.7-ios.ipa", "unsigned")
        self.assertIn("没有签名", self.publish())
        self.assertIsNone(self.item("ios"))
        (self.directory / "HXBot-1.4.7-ios.ipa").write_bytes(b"not a zip")
        self.assertIn("不是有效的 ipa", self.publish())
        self.assertIsNone(self.item("ios"))
        self.assertEqual(self.tokens(), [])

    def test_enterprise_and_development_are_installable(self):
        make_ipa(self.directory / "HXBot-1.4.7-ios.ipa", "enterprise")
        self.publish()
        self.assertEqual(self.item("ios")["signing"], "enterprise")
        make_ipa(self.directory / "HXBot-1.4.8-ios.ipa", "development", version="1.4.8")
        output = self.publish()
        self.assertEqual(self.item("ios")["signing"], "development")
        self.assertIn("开发签名", output)

    def test_testflight_link_alone(self):
        self.publish("--ios-url", TESTFLIGHT)
        self.assertEqual(self.item("ios"), {"platform": "ios", "arch": "universal", "version": "TestFlight", "url": TESTFLIGHT})
        # 再次运行不带参数：链接保留
        self.publish()
        self.assertEqual(self.item("ios")["url"], TESTFLIGHT)
        self.publish("--no-ios-url")
        self.assertIsNone(self.item("ios"))

    def test_testflight_link_with_app_store_ipa(self):
        make_ipa(self.directory / "HXBot-1.4.7-ios.ipa", "appstore")
        self.publish("--ios-url", TESTFLIGHT)
        self.assertEqual(self.item("ios"), {"platform": "ios", "arch": "universal", "version": "TestFlight", "url": TESTFLIGHT})

    def test_testflight_link_together_with_adhoc_ipa(self):
        make_ipa(self.directory / "HXBot-1.4.7-ios.ipa", "adhoc")
        self.publish("--ios-url", TESTFLIGHT)
        ios = self.item("ios")
        self.assertEqual(ios["url"], TESTFLIGHT)
        self.assertEqual(ios["file"], "HXBot-1.4.7-ios.ipa")
        self.assertIn("ota", ios)
        # 撤下安装包后链接还在，无线安装地址作废
        (self.directory / "HXBot-1.4.7-ios.ipa").unlink()
        self.publish()
        self.assertEqual(self.item("ios"), {"platform": "ios", "arch": "universal", "version": "TestFlight", "url": TESTFLIGHT})
        self.assertEqual(self.tokens(), [])
        self.assertFalse((self.directory / ".ota").exists())

    def test_removing_the_ipa_removes_the_install_address(self):
        make_ipa(self.directory / "HXBot-1.4.7-ios.ipa", "adhoc")
        self.publish()
        self.assertEqual(len(self.tokens()), 1)
        (self.directory / "HXBot-1.4.7-ios.ipa").unlink()
        self.publish()
        self.assertIsNone(self.item("ios"))
        self.assertFalse((self.directory / ".ota").exists())

    def test_site_option(self):
        make_ipa(self.directory / "HXBot-1.4.7-ios.ipa", "adhoc")
        self.publish("--site", "https://bot.example.org/")
        token = self.tokens()[0]
        document = plistlib.loads((self.directory / ".ota" / token / "manifest.plist").read_bytes())
        urls = [asset["url"] for asset in document["items"][0]["assets"]]
        self.assertEqual(urls[0], "https://bot.example.org/ota/{}/HXBot.ipa".format(token))
        self.assertTrue(all(url.startswith("https://bot.example.org/") for url in urls))

    def test_rejected_arguments(self):
        for args in (
            ["--ios-url"],
            ["--ios-url", "http://testflight.apple.com/join/AbCd1234"],
            ["--ios-url", "https://example.com/join/AbCd1234"],
            ["--ios-url", "javascript:alert(1)"],
            ["--ios-url", "https://testflight.apple.com/join/AbCd1234\"><script>"],
            ["--ios-url", TESTFLIGHT, "--no-ios-url"],
            ["--site", "http://bot.hxallai.com"],
            ["--site", "https://bot.hxallai.com/path"],
            ["--unknown"],
        ):
            self.publish(*args, expect=1)
        self.assertFalse((self.directory / "manifest.json").exists())

    def test_unsafe_link_in_an_old_manifest_is_dropped(self):
        old = {"items": [{"platform": "ios", "arch": "universal", "url": "javascript:alert(1)", "version": "TestFlight"}]}
        (self.directory / "manifest.json").write_text(json.dumps(old), encoding="utf-8")
        self.publish()
        self.assertIsNone(self.item("ios"))

    def test_broken_old_manifest(self):
        (self.directory / "manifest.json").write_text("[1, 2", encoding="utf-8")
        self.publish()
        (self.directory / "manifest.json").write_text("[1, 2]", encoding="utf-8")
        self.publish()
        self.assertEqual(self.manifest()["items"], [])

    def test_symlinked_package_is_ignored(self):
        make_ipa(Path(self.temporary.name) / "outside.ipa", "adhoc")
        os.symlink(str(Path(self.temporary.name) / "outside.ipa"), str(self.directory / "HXBot-9.9.9-ios.ipa"))
        self.publish()
        self.assertIsNone(self.item("ios"))


class UploadTest(unittest.TestCase):
    """upload-downloads.sh 的参数检查；scp 和 ssh 换成只记录参数的替身。"""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.work = Path(self.temporary.name)
        tools = self.work / "bin"
        tools.mkdir()
        for name in ("scp", "ssh"):
            script = tools / name
            script.write_text('#!/bin/sh\nprintf \'%s\\n\' "' + name + '" "$@" >> "$HX_TEST_LOG"\n', encoding="utf-8")
            script.chmod(0o755)
        self.log = self.work / "calls.log"
        self.environment = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ["PATH"], HX_TEST_LOG=str(self.log))

    def tearDown(self):
        self.temporary.cleanup()

    def package(self, name):
        path = self.work / name
        path.write_bytes(b"package")
        return str(path)

    def upload(self, *args, expect=0):
        result = subprocess.run(
            ["bash", str(UPLOAD)] + list(args), env=self.environment,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
        )
        self.assertEqual(result.returncode, expect, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def calls(self):
        return self.log.read_text(encoding="utf-8").splitlines() if self.log.exists() else []

    def test_uploads_every_platform(self):
        files = [self.package(name) for name in ("HXBot-1.5.0-arm64.dmg", "HXBot-1.5.0-x64.exe", "HXBot-1.4.7-android.apk", "HXBot-1.4.7-ios.ipa")]
        self.upload("root@203.0.113.7", *files)
        calls = self.calls()
        self.assertEqual(calls[0], "scp")
        self.assertEqual(calls[1:5], files)
        self.assertEqual(calls[5], "root@203.0.113.7:/opt/hxbot/downloads/")
        self.assertEqual(calls[6:8], ["ssh", "root@203.0.113.7"])
        self.assertIn("publish-downloads.py /opt/hxbot/downloads", calls[8])
        self.assertNotIn("--ios-url", calls[8])
        self.assertNotIn("--no-ios-url", calls[8])

    def test_uploads_the_desktop_update_files_beside_the_installers(self):
        dist = self.work / "dist"
        dist.mkdir()
        for name in ("HXBot-0.67.1-arm64.dmg", "HXBot-0.67.1-arm64.zip", "HXBot-0.67.1-arm64.zip.blockmap",
                     "HXBot-0.67.1-x64.exe", "HXBot-0.67.1-x64.exe.blockmap"):
            (dist / name).write_bytes(b"package")
        (dist / "latest-mac.yml").write_text("version: 0.67.1\nfiles:\n  - url: HXBot-0.67.1-arm64.zip\n", encoding="utf-8")
        (dist / "latest.yml").write_text("version: '0.67.1'\nfiles:\n  - url: HXBot-0.67.1-x64.exe\n", encoding="utf-8")
        self.upload("root@203.0.113.7", str(dist / "HXBot-0.67.1-arm64.dmg"), str(dist / "HXBot-0.67.1-x64.exe"))
        calls = self.calls()
        folder = "root@203.0.113.7:/opt/hxbot/downloads/updates/desktop/"
        self.assertEqual(calls[:4], ["scp", str(dist / "HXBot-0.67.1-arm64.dmg"), str(dist / "HXBot-0.67.1-x64.exe"), "root@203.0.113.7:/opt/hxbot/downloads/"])
        self.assertEqual(calls[4:7], ["ssh", "root@203.0.113.7", "mkdir -p /opt/hxbot/downloads/updates/desktop"])
        self.assertEqual(calls[7:12], ["scp", str(dist / "HXBot-0.67.1-arm64.zip"), str(dist / "HXBot-0.67.1-arm64.zip.blockmap"),
                                       str(dist / "HXBot-0.67.1-x64.exe.blockmap"), folder])
        # 更新信息最后传，先叫 .new
        self.assertEqual(calls[12:18], ["scp", str(dist / "latest-mac.yml"), folder + "latest-mac.yml.new",
                                        "scp", str(dist / "latest.yml"), folder + "latest.yml.new"])
        self.assertEqual(calls[18:20], ["ssh", "root@203.0.113.7"])
        self.assertIn("publish-downloads.py", calls[20])

    def test_update_files_from_another_build_are_left_out(self):
        dist = self.work / "dist"
        dist.mkdir()
        for name in ("HXBot-0.67.2-arm64.dmg", "HXBot-0.67.1-arm64.zip", "HXBot-0.67.2-x64.exe"):
            (dist / name).write_bytes(b"package")
        (dist / "latest-mac.yml").write_text("version: 0.67.1\n", encoding="utf-8")
        output = self.upload("root@203.0.113.7", str(dist / "HXBot-0.67.2-arm64.dmg"), str(dist / "HXBot-0.67.2-x64.exe"))
        self.assertIn("latest-mac.yml 是 0.67.1 版的，和 HXBot-0.67.2-arm64.dmg 不一致", output)
        self.assertIn("里没有 latest.yml，这次不更新 Windows 的应用内更新", output)
        calls = self.calls()
        self.assertFalse(any("updates/desktop" in call for call in calls), calls)
        # 版本一致但缺 ZIP：也不传
        (dist / "latest-mac.yml").write_text("version: 0.67.2\n", encoding="utf-8")
        self.log.unlink()
        output = self.upload("root@203.0.113.7", str(dist / "HXBot-0.67.2-arm64.dmg"))
        self.assertIn("没找到 {}".format(dist / "HXBot-0.67.2-arm64.zip"), output)
        self.assertFalse(any("updates/desktop" in call for call in self.calls()))

    def test_mac_signature(self):
        """v1.6.8：在 Mac 上上传前核对 zip 里 HXBot.app 的签名身份，临时签名的不上传。codesign、ditto 换成替身。"""
        tools = self.work / "bin"
        (tools / "ditto").write_text('#!/bin/sh\nmkdir -p "$4/HXBot.app"\n', encoding="utf-8")
        (tools / "codesign").write_text('#!/bin/sh\necho "designated => $HX_TEST_DR"\n', encoding="utf-8")
        for name in ("ditto", "codesign"):
            (tools / name).chmod(0o755)
        dist = self.work / "dist"
        dist.mkdir()
        for name in ("HXBot-0.67.7-arm64.dmg", "HXBot-0.67.7-arm64.zip"):
            (dist / name).write_bytes(b"package")
        (dist / "latest-mac.yml").write_text("version: 0.67.7\n", encoding="utf-8")
        dmg = str(dist / "HXBot-0.67.7-arm64.dmg")
        self.environment["HX_TEST_DR"] = 'cdhash H"0123abcd"'
        self.assertIn("签名身份不对，没有上传", self.upload("root@203.0.113.7", dmg, expect=1))
        self.assertEqual(self.calls(), [])
        self.environment["HXBOT_ALLOW_UNSIGNED_MAC"] = "1"
        self.assertIn("没有固定签名", self.upload("root@203.0.113.7", dmg))
        del self.environment["HXBOT_ALLOW_UNSIGNED_MAC"]
        self.log.unlink()
        sha1 = "AB" * 20
        self.environment["HX_TEST_DR"] = 'identifier "com.hxallai.bot" and certificate leaf = H"' + sha1.lower() + '"'
        self.environment["HXBOT_MAC_CERT_SHA1"] = "CD" * 20
        self.assertIn("签名身份不对", self.upload("root@203.0.113.7", dmg, expect=1))
        self.environment["HXBOT_MAC_CERT_SHA1"] = sha1
        self.assertIn("Mac 版的签名身份", self.upload("root@203.0.113.7", dmg))
        self.assertIn("scp", self.calls())

    def test_testflight_link_only(self):
        self.upload("root@203.0.113.7", "--ios-url", TESTFLIGHT)
        calls = self.calls()
        self.assertNotIn("scp", calls)
        self.assertEqual(calls[:2], ["ssh", "root@203.0.113.7"])
        self.assertTrue(calls[2].endswith("publish-downloads.py /opt/hxbot/downloads --ios-url " + TESTFLIGHT), calls[2])

    def test_testflight_link_with_files(self):
        self.upload("root@203.0.113.7", self.package("HXBot-1.4.7-android.apk"), "--ios-url", TESTFLIGHT)
        self.assertIn("scp", self.calls())
        self.assertTrue(self.calls()[-1].endswith("--ios-url " + TESTFLIGHT))

    def test_removing_the_testflight_link(self):
        self.upload("root@203.0.113.7", "--no-ios-url")
        self.assertTrue(self.calls()[-1].endswith("publish-downloads.py /opt/hxbot/downloads --no-ios-url"))

    def test_rejects_bad_input(self):
        good = self.package("HXBot-1.4.7-ios.ipa")
        for args in (
            [],
            ["root@203.0.113.7"],
            ["root@203.0.113.7", self.package("HXBot.ipa")],
            ["root@203.0.113.7", self.package("HXBot-1.4.7-ios.zip")],
            ["root@203.0.113.7", str(self.work / "HXBot-9.9.9-ios.ipa")],
            ["root@203.0.113.7", good, "--ios-url"],
            ["root@203.0.113.7", good, "--ios-url", "https://example.com/x"],
            ["root@203.0.113.7", good, "--ios-url", "https://testflight.apple.com/join/abc; rm -rf /"],
            ["root@203.0.113.7", good, "--ios-url", "https://testflight.apple.com/join/$(id)"],
            ["root@203.0.113.7", good, "--ios-url", TESTFLIGHT, "--no-ios-url"],
            ["root@203.0.113.7", good, "--other"],
            ["--ios-url", TESTFLIGHT],
        ):
            self.upload(*args, expect=1)
        self.assertEqual(self.calls(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
