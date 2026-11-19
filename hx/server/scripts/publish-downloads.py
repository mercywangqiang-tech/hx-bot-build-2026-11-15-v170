#!/usr/bin/env python3
"""扫描下载目录，生成门户页读取的 manifest.json。

用法（服务器上）：
    python3 /opt/hxbot/server/scripts/publish-downloads.py            # 默认目录 /opt/hxbot/downloads
    python3 publish-downloads.py /path/to/downloads --ios-url https://testflight.apple.com/join/XXXX
    python3 publish-downloads.py /path/to/downloads --no-ios-url      # 撤下 TestFlight 链接
    python3 publish-downloads.py --inspect HXBot-1.5.0-ios.ipa        # 只看一个 ipa：版本、构建号、签名方式、能装到哪些设备

识别的文件名（hx/scripts 下的构建脚本产出的就是这些名字）：
    HXBot-<版本>-arm64.dmg      → Mac（Apple 芯片）
    HXBot-<版本>-x64.exe        → Windows
    HXBot-<版本>-android.apk    → Android
    HXBot-<版本>-ios.ipa        → iPhone / iPad（只发布 Ad Hoc 签名的包，见下）
每个平台只列出版本最新的一个；旧文件保留在目录里，可以手动删除。

iOS 有两种发布方式，可以同时用：
    1. TestFlight 邀请链接（--ios-url）。任何 iPhone 都能装，不用登记设备。
    2. Ad Hoc 安装包（HX_IOS_EXPORT=release-testing 构建的 ipa）。只能装到签名时登记过的设备；
       脚本为它生成无线安装清单，下载页在 iPhone 上显示“安装”按钮。
    默认方式（app-store-connect）导出的 ipa 是给 TestFlight 用的，苹果不允许直接安装到手机，
    放进下载目录也不会出现在下载页，脚本会提示改用上面两种方式之一。

无线安装（方式 2）由手机系统的安装程序来取文件，它不带网页的登录状态，所以清单和安装包通过
    https://<站点>/ota/<32 位随机串>/manifest.plist 和 …/HXBot.ipa
提供，不校验登录；随机串只写在登录后才能读到的 manifest.json 里，换了安装包就换一个新的。
文件放在下载目录的 .ota/ 里（安装包是指向原文件的链接，不占空间）。站点地址用 --site 指定，
默认 https://bot.hxallai.com 。

客户端在应用里更新（v1.6.2 起）用下载目录里的 updates/，网址是 https://<站点>/updates/，带登录令牌才能取：
    updates/mobile.json      手机端点“更新”时读它：安卓新安装包的地址（/ota/<随机串>/HXBot.apk，系统浏览器下载，
                             所以和 iOS 一样用随机串地址）、iPhone 的无线安装链接或 TestFlight 链接
    updates/desktop/         桌面端的更新文件：electron-builder 生成的 latest-mac.yml（Mac）、latest.yml（Windows）、
                             Mac 的 ZIP、各版本的 .blockmap（Windows 增量下载要用旧版本的 blockmap）。
                             hx/scripts/upload-downloads.sh 上传安装包时一并传来（latest*.yml 先传成 .new，
                             这里核对后再换上）；Windows 的 latest.yml 指向的 exe 就是下载目录里的那个，这里放一个链接。
"""

import hashlib
import json
import os
import plistlib
import re
import secrets
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from urllib.parse import quote
from pathlib import Path
from xml.parsers.expat import ExpatError

PATTERNS = [
    ("macos", "arm64", re.compile(r"^HXBot-(?P<version>[0-9][0-9A-Za-z.+-]*)-arm64\.dmg$")),
    ("windows", "x64", re.compile(r"^HXBot-(?P<version>[0-9][0-9A-Za-z.+-]*)-x64\.exe$")),
    ("android", "universal", re.compile(r"^HXBot-(?P<version>[0-9][0-9A-Za-z.+-]*)-android\.apk$")),
    ("ios", "universal", re.compile(r"^HXBot-(?P<version>[0-9][0-9A-Za-z.+-]*)-ios\.ipa$")),
]
DEFAULT_SITE = "https://bot.hxallai.com"
SITE_PATTERN = re.compile(r"^https://[A-Za-z0-9.-]+(:[0-9]+)?$")
# 下载页只把苹果自己的地址做成按钮
IOS_URL_PATTERN = re.compile(r"^https://(testflight\.apple\.com|apps\.apple\.com)/[A-Za-z0-9/._~%?=&-]+$")
OTA_DIRECTORY = ".ota"
OTA_TOKEN_PATTERN = re.compile(r"^[0-9a-f]{32}$")
OTA_PATH_PATTERN = re.compile(r"^/ota/([0-9a-f]{32})/manifest\.plist$")
# 构建号：同一个版本号下区分先后两次构建，下载页显示出来，换了安装包一眼能看出
BUILD_PATTERN = re.compile(r"^[0-9]{1,18}(\.[0-9]{1,9}){0,2}$")
# 能直接装到设备上的签名方式
INSTALLABLE = ("adhoc", "development", "enterprise")
SIGNING_NAMES = {
    "adhoc": "Ad Hoc（已登记的设备）",
    "development": "开发签名（已登记的设备）",
    "enterprise": "企业内部分发",
    "appstore": "App Store / TestFlight",
    "unsigned": "没有签名",
}


def version_key(version):
    # 1.2.3 > 1.2.3-rc1：主版本号按数值比较；主版本相同时，不带后缀的正式版排在前面
    core, _, suffix = version.partition("-")
    numbers = tuple(int(part) if part.isdigit() else 0 for part in re.split(r"[.+]", core))
    tail = tuple((0, int(part), "") if part.isdigit() else (1, 0, part) for part in re.split(r"[.+-]", suffix) if part)
    return (numbers, 0 if suffix else 1, tail)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def text(value):
    return value if isinstance(value, str) else ""


def inspect_ipa(path):
    """读 ipa 里的应用信息和签名方式；不是有效的 ipa 时返回 None。

    签名方式看应用里的描述文件 embedded.mobileprovision：列出了设备的是 Ad Hoc 或开发签名，
    写明适用所有设备的是企业内部分发，两样都没有的是 App Store / TestFlight 签名。
    """
    try:
        with zipfile.ZipFile(str(path)) as archive:
            names = archive.namelist()
            info_name = next((name for name in names if re.match(r"^Payload/[^/]+\.app/Info\.plist$", name)), None)
            if info_name is None:
                return None
            info = plistlib.loads(archive.read(info_name))
            profile = None
            profile_name = info_name[: -len("Info.plist")] + "embedded.mobileprovision"
            if profile_name in names:
                raw = archive.read(profile_name)
                start, end = raw.find(b"<?xml"), raw.rfind(b"</plist>")
                if 0 <= start < end:
                    profile = plistlib.loads(raw[start:end + len(b"</plist>")])
    except (OSError, ValueError, KeyError, ExpatError, zipfile.BadZipFile):
        return None
    if not isinstance(info, dict) or not text(info.get("CFBundleIdentifier")):
        return None

    devices = None
    udids = []
    expires = None
    if not isinstance(profile, dict):
        signing = "unsigned"
    else:
        entitlements = profile.get("Entitlements")
        provisioned = profile.get("ProvisionedDevices")
        if profile.get("ProvisionsAllDevices") is True:
            signing = "enterprise"
        elif isinstance(provisioned, list):
            devices = len(provisioned)
            udids = [text(device) for device in provisioned if text(device)]
            signing = "development" if isinstance(entitlements, dict) and entitlements.get("get-task-allow") is True else "adhoc"
        else:
            signing = "appstore"
        if isinstance(profile.get("ExpirationDate"), datetime):
            expires = profile["ExpirationDate"].strftime("%Y-%m-%d")
    return {
        "bundle": info["CFBundleIdentifier"],
        "version": text(info.get("CFBundleShortVersionString")),
        "build": text(info.get("CFBundleVersion")),
        "title": text(info.get("CFBundleDisplayName")) or text(info.get("CFBundleName")) or "HXBot",
        "minOS": text(info.get("MinimumOSVersion")),
        "signing": signing,
        "devices": devices,
        "udids": udids,
        "expires": expires,
    }


def describe_ipa(path):
    """--inspect：把一个 ipa 的版本、构建号、签名方式和能装到哪些设备打印出来。"""
    app = inspect_ipa(path)
    if app is None:
        print("{} 不是有效的 ipa（读不到应用信息）。".format(path), file=sys.stderr)
        return 1
    print("应用：{}（{}）".format(app["title"], app["bundle"]))
    print("版本：{}，构建号 {}".format(app["version"] or "未知", app["build"] or "未知"))
    if app["minOS"]:
        print("系统要求：iOS {} 或更新".format(app["minOS"]))
    signing = SIGNING_NAMES[app["signing"]]
    if app["signing"] == "appstore":
        print("签名：{}。交给 TestFlight 用，不能直接装到手机。".format(signing))
    elif app["signing"] == "unsigned":
        print("签名：{}。装不到任何设备上。".format(signing))
    else:
        print("签名：{}。可以直接安装。".format(signing))
    if app["signing"] == "appstore":
        print("上传到 TestFlight 后，这个构建可以测试 90 天，到期前要再上传一个新构建。")
    elif app["expires"]:
        print("描述文件到 {} 过期，过期后应用打不开，要在这之前重新构建并让用户重装。".format(app["expires"]))
    if app["devices"] is not None:
        print("只能装到这 {} 台已登记的设备（UDID）：".format(app["devices"]))
        for udid in app["udids"]:
            print("  {}".format(udid))
        if app["devices"] == 0:
            print("  （一台都没有。先在开发者账号里登记设备，再重新构建）")
    return 0


def write_ota(directory, site, token, file_name, app):
    """写无线安装清单，并把安装包链接到随机串目录下。"""
    folder = directory / OTA_DIRECTORY / token
    folder.mkdir(parents=True, exist_ok=True)
    (directory / OTA_DIRECTORY).chmod(0o755)
    folder.chmod(0o755)
    base = "{}/ota/{}".format(site, token)
    document = {
        "items": [
            {
                "assets": [
                    {"kind": "software-package", "url": base + "/HXBot.ipa"},
                    {"kind": "display-image", "url": site + "/icon-192x192.png"},
                    {"kind": "full-size-image", "url": site + "/icon-512x512.png"},
                ],
                "metadata": {
                    "bundle-identifier": app["bundle"],
                    "bundle-version": app["version"],
                    "kind": "software",
                    "title": app["title"],
                },
            }
        ]
    }
    plist = folder / "manifest.plist"
    temporary = folder / "manifest.plist.tmp"
    temporary.write_bytes(plistlib.dumps(document))
    temporary.replace(plist)
    plist.chmod(0o644)
    link = folder / "HXBot.ipa"
    if link.is_symlink() or link.exists():
        link.unlink()
    os.symlink(os.path.join("..", "..", file_name), str(link))


def write_apk_link(directory, token, file_name):
    """安卓安装包的随机串地址：.ota/<随机串>/HXBot.apk 指向下载目录里的安装包。"""
    folder = directory / OTA_DIRECTORY / token
    folder.mkdir(parents=True, exist_ok=True)
    (directory / OTA_DIRECTORY).chmod(0o755)
    folder.chmod(0o755)
    link = folder / "HXBot.apk"
    if link.is_symlink() or link.exists():
        link.unlink()
    os.symlink(os.path.join("..", "..", file_name), str(link))


def clear_ota(directory, keep):
    """删掉不再使用的随机串目录（旧安装包的无线安装地址随之失效）。keep：还在用的随机串。"""
    root = directory / OTA_DIRECTORY
    if not root.is_dir():
        return
    keep = {token for token in keep if token}
    for entry in root.iterdir():
        if entry.name not in keep and OTA_TOKEN_PATTERN.match(entry.name) and entry.is_dir() and not entry.is_symlink():
            shutil.rmtree(str(entry), ignore_errors=True)
    if not keep and not any(root.iterdir()):
        root.rmdir()


def read_feed(path):
    """electron-builder 的 latest*.yml 里的版本和文件名（只读这两样，不用 YAML 库）。读不出来时为 None。"""
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    version = None
    files = []
    for line in text.splitlines():
        match = re.match(r"^version:\s*'?\"?([0-9][0-9A-Za-z.+-]*)", line)
        if match:
            version = match.group(1)
        match = re.match(r"^\s*-\s+url:\s*'?\"?([^'\"\s]+)", line)
        if match:
            files.append(match.group(1))
    return {"version": version, "files": files} if version and files else None


def link_feed_files(directory, folder, feed):
    """更新文件里列的每个文件都要在 updates/desktop/ 里：安装包（exe、dmg）本身在下载目录里，放一个链接。
    返回不在服务器上的文件名。"""
    missing = []
    for file_name in feed["files"]:
        if "/" in file_name or "\\" in file_name or file_name.startswith("."):
            missing.append(file_name)
            continue
        target = folder / file_name
        if not target.exists() and (directory / file_name).is_file() and not (directory / file_name).is_symlink():
            if target.is_symlink():
                target.unlink()
            os.symlink(os.path.join("..", "..", file_name), str(target))
        if not target.exists():
            missing.append(file_name)
    return missing


def desktop_updates(directory):
    """整理 updates/desktop/。upload-downloads.sh 把新的 latest*.yml 先传成 latest*.yml.new，这里核对它列的文件都在了
    才换上去（换之前客户端一直看到原来的版本，传到一半不会让客户端下载失败）。不再用到的 ZIP 和链接删掉，
    旧版本的 .blockmap 留着（Windows 增量下载要用）。返回给人看的说明（每个平台一行）和问题。"""
    folder = directory / "updates" / "desktop"
    lines, problems = [], []
    if not folder.is_dir() or folder.is_symlink():
        return lines, problems
    used = set()
    unreadable = False
    for name, platform in (("latest-mac.yml", "Mac"), ("latest.yml", "Windows")):
        incoming = folder / (name + ".new")
        if incoming.is_file() and not incoming.is_symlink():
            feed = read_feed(incoming)
            missing = link_feed_files(directory, folder, feed) if feed else None
            if feed is None:
                problems.append("新上传的 {} 读不出版本和文件，没有启用，{} 客户端仍更新到原来的版本。请重新上传。".format(name, platform))
                incoming.unlink()
            elif missing:
                problems.append("新上传的 {} 指向的文件不在服务器上：{}。没有启用，{} 客户端仍更新到原来的版本。请重新上传。".format(
                    name, "、".join(missing), platform))
                incoming.unlink()
            else:
                incoming.chmod(0o644)
                incoming.replace(folder / name)
        feed_path = folder / name
        if not feed_path.is_file() or feed_path.is_symlink():
            continue
        feed = read_feed(feed_path)
        if feed is None:
            problems.append("{} 读不出版本和文件，{} 的应用内更新暂时不可用。请重新上传。".format(name, platform))
            unreadable = True
            continue
        used.add(name)
        missing = link_feed_files(directory, folder, feed)
        used.update(feed["files"])
        if missing:
            problems.append("{} 指向的文件不在服务器上：{}。{} 的应用内更新暂时不可用，请重新上传。".format(name, "、".join(missing), platform))
            continue
        maps = sorted(path.name for path in folder.glob("*.blockmap"))
        lines.append("{} {}：{}（blockmap {} 个）".format(platform, feed["version"], "、".join(feed["files"]), len(maps)))
    for entry in list(folder.iterdir()):
        if unreadable or entry.name in used or entry.name.endswith(".blockmap") or entry.name.endswith(".new"):
            if not entry.is_symlink() and entry.is_file():
                entry.chmod(0o644)
            continue
        # 旧版本的 Mac ZIP 和指向旧安装包的链接
        if entry.is_symlink() or (entry.is_file() and entry.name.startswith("HXBot-") and entry.name.endswith(".zip")):
            entry.unlink()
    folder.chmod(0o755)
    (directory / "updates").chmod(0o755)
    return lines, problems


def desktop_update_gaps(directory, items):
    """v1.7.3 紧急修正：下载页的桌面端安装包比应用内更新新（或者更新文件根本没传）时的提示。

    2026-11-19 服务器上只有安装包、没有 updates/desktop/latest-mac.yml：已经装好的 Mac 版在应用里收不到新版本，
    “检查更新”只显示出错，没有人发现。这里每次整理下载目录都核对一遍，大字说清楚怎么补。"""
    gaps = []
    for platform, name, label in (("macos", "latest-mac.yml", "Mac"), ("windows", "latest.yml", "Windows")):
        item = next((entry for entry in items if entry.get("platform") == platform), None)
        if item is None or not item.get("version"):
            continue
        feed = read_feed(directory / "updates" / "desktop" / name)
        have = feed["version"] if feed else None
        if have is not None and version_key(have) >= version_key(item["version"]):
            continue
        gaps.append(
            "！！注意：下载页的 {label} 版是 {want}，应用内更新{state}。已经装好的 {label} 客户端在应用里收不到 {want}，"
            "“检查更新”会提示找不到已发布的更新。请在 Mac 上双击交付文件夹 client 里的“上传应用内更新-{want}.command”，"
            "或运行 bash hx/scripts/upload-downloads.sh root@服务器 HXBot-{want}-…（安装包旁边要有 {name}）。".format(
                label=label, want=item["version"], name=name,
                state="还停在 {}".format(have) if have else "的文件（updates/desktop/{}）没有上传".format(name)))
    return gaps


def write_mobile_updates(directory, site, items):
    """updates/mobile.json：手机端点“更新”时打开的地址。"""
    folder = directory / "updates"
    folder.mkdir(exist_ok=True)
    folder.chmod(0o755)
    mobile = {"updatedAt": datetime.now(timezone.utc).isoformat()}
    for item in items:
        if item.get("platform") == "android" and item.get("ota"):
            mobile["android"] = {"version": item["version"], "url": site + item["ota"]}
        if item.get("platform") == "ios":
            if item.get("ota"):
                manifest = site + item["ota"]
                mobile["ios"] = {"version": item["version"],
                                 "url": "itms-services://?action=download-manifest&url=" + quote(manifest, safe="")}
            elif item.get("url"):
                mobile["ios"] = {"version": item["version"] if item.get("file") else "", "url": item["url"]}
    path = folder / "mobile.json"
    tmp = folder / "mobile.json.tmp"
    tmp.write_text(json.dumps(mobile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    path.chmod(0o644)
    return mobile


def option(argv, name):
    """取出 “名称 值” 形式的参数；没有给时返回 None。"""
    if name not in argv:
        return None
    position = argv.index(name)
    if position + 1 >= len(argv) or argv[position + 1].startswith("--"):
        raise SystemExit("{} 后面要跟一个值".format(name))
    value = argv[position + 1]
    del argv[position:position + 2]
    return value


def main():
    argv = sys.argv[1:]
    if "-h" in argv or "--help" in argv:
        print(__doc__)
        return 0
    inspect = option(argv, "--inspect")
    if inspect is not None:
        if argv:
            print("--inspect 后面只跟一个 ipa 文件（--help 查看用法）", file=sys.stderr)
            return 1
        return describe_ipa(Path(inspect))
    ios_url = option(argv, "--ios-url")
    site = option(argv, "--site") or DEFAULT_SITE
    clear_ios_url = "--no-ios-url" in argv
    argv = [arg for arg in argv if arg != "--no-ios-url"]
    unknown = [arg for arg in argv if arg.startswith("-")]
    if unknown:
        print("不认识的参数：{}（--help 查看用法）".format(" ".join(unknown)), file=sys.stderr)
        return 1
    if len(argv) > 1:
        print("只能给一个下载目录（--help 查看用法）", file=sys.stderr)
        return 1
    if ios_url is not None and clear_ios_url:
        print("--ios-url 和 --no-ios-url 不能同时用", file=sys.stderr)
        return 1
    if ios_url is not None and not IOS_URL_PATTERN.match(ios_url):
        print("--ios-url 要填苹果给的完整链接，例如 https://testflight.apple.com/join/XXXXXXXX", file=sys.stderr)
        return 1
    site = site.rstrip("/")
    if not SITE_PATTERN.match(site):
        print("--site 要填 https:// 开头的站点地址，例如 {}".format(DEFAULT_SITE), file=sys.stderr)
        return 1
    directory = Path(argv[0] if argv else "/opt/hxbot/downloads")
    if not directory.is_dir():
        print("目录不存在：{}".format(directory), file=sys.stderr)
        return 1

    manifest_path = directory / "manifest.json"
    previous = {}
    if manifest_path.exists():
        try:
            previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        except ValueError:
            previous = {}
    if not isinstance(previous, dict) or not isinstance(previous.get("items"), list):
        previous = {"items": []}
    previous_items = [item for item in previous["items"] if isinstance(item, dict)]
    cache = {item.get("file"): item for item in previous_items if item.get("file")}

    best = {}
    for file in sorted(directory.iterdir()):
        if not file.is_file() or file.is_symlink():
            continue
        for platform, arch, pattern in PATTERNS:
            match = pattern.match(file.name)
            if not match:
                continue
            stat = file.stat()
            old = cache.get(file.name)
            unchanged = bool(old) and old.get("size") == stat.st_size and old.get("mtime") == int(stat.st_mtime) and bool(old.get("sha256"))
            item = {
                "platform": platform,
                "arch": arch,
                "file": file.name,
                "version": match.group("version"),
                "size": stat.st_size,
                "mtime": int(stat.st_mtime),
                "sha256": old["sha256"] if unchanged else sha256(file),
                "date": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            }
            current = best.get(platform)
            if current is None or version_key(item["version"]) >= version_key(current["version"]):
                best[platform] = item

    notes = []
    previous_ios = next((item for item in previous_items if item.get("platform") == "ios"), {})
    if clear_ios_url:
        ios_url = None
    elif ios_url is None:
        kept = text(previous_ios.get("url"))
        ios_url = kept if IOS_URL_PATTERN.match(kept) else None

    # iOS：只有能直接装到设备上的签名才作为安装包发布
    ios = best.pop("ios", None)
    ios_token = None
    if ios is not None:
        app = inspect_ipa(directory / ios["file"])
        if app is None:
            notes.append("{} 不是有效的 ipa（读不到应用信息），没有发布。请重新构建后上传。".format(ios["file"]))
            ios = None
        elif app["signing"] not in INSTALLABLE:
            notes.append(
                "{} 的签名是“{}”，苹果不允许把它直接装到手机上，下载页不会提供这个文件。\n"
                "    · 走 TestFlight：用 Transporter 把它上传到 App Store Connect，开启公开链接后运行\n"
                "        python3 {} {} --ios-url https://testflight.apple.com/join/你的邀请码\n"
                "    · 或者直接安装：先在开发者账号里登记设备，再用 HX_IOS_EXPORT=release-testing 重新构建（Ad Hoc 包）后上传。".format(
                    ios["file"], SIGNING_NAMES[app["signing"]], sys.argv[0], directory
                )
            )
            ios = None
        else:
            match = OTA_PATH_PATTERN.match(text(previous_ios.get("ota")))
            same = previous_ios.get("file") == ios["file"] and previous_ios.get("size") == ios["size"] and previous_ios.get("mtime") == ios["mtime"]
            ios_token = match.group(1) if match and same else secrets.token_hex(16)
            write_ota(directory, site, ios_token, ios["file"], app)
            ios["signing"] = app["signing"]
            ios["ota"] = "/ota/{}/manifest.plist".format(ios_token)
            if BUILD_PATTERN.match(app["build"]):
                ios["build"] = app["build"]
            if app["minOS"]:
                ios["minOS"] = app["minOS"]
            if app["expires"]:
                ios["expires"] = app["expires"]
            detail = SIGNING_NAMES[app["signing"]]
            if ios.get("build"):
                detail += "，构建号 {}".format(ios["build"])
            if app["devices"] is not None:
                detail += "，登记了 {} 台设备".format(app["devices"])
            if app["expires"]:
                detail += "，描述文件到 {} 过期（过期后应用打不开，需要重新构建）".format(app["expires"])
            notes.append("{}：{}。\n    无线安装清单 {}{}".format(ios["file"], detail, site, ios["ota"]))
            if app["version"] and app["version"] != ios["version"]:
                notes.append("注意：文件名里的版本是 {}，应用自身的版本是 {}，安装后显示后者。".format(ios["version"], app["version"]))
            if app["signing"] == "development":
                notes.append("注意：这是开发签名的包，建议改用 HX_IOS_EXPORT=release-testing 导出 Ad Hoc 包再发布。")
    # 安卓：手机里点“更新”后由系统浏览器下载，同样用随机串地址（换了安装包就换一个新的）
    android = best.get("android")
    android_token = None
    if android is not None:
        previous_android = next((item for item in previous_items if item.get("platform") == "android"), {})
        match = re.match(r"^/ota/([0-9a-f]{32})/HXBot\.apk$", text(previous_android.get("ota")))
        same = previous_android.get("file") == android["file"] and previous_android.get("size") == android["size"] and previous_android.get("mtime") == android["mtime"]
        android_token = match.group(1) if match and same else secrets.token_hex(16)
        write_apk_link(directory, android_token, android["file"])
        android["ota"] = "/ota/{}/HXBot.apk".format(android_token)
    clear_ota(directory, {ios_token, android_token})
    if ios is None and ios_url:
        ios = {"platform": "ios", "arch": "universal", "version": "TestFlight"}
    if ios is not None and ios_url:
        ios["url"] = ios_url

    items = [best[p] for p in ("macos", "windows", "android") if p in best]
    if ios is not None:
        items.append(ios)

    mobile = write_mobile_updates(directory, site, items)
    desktop_lines, desktop_problems = desktop_updates(directory)
    manifest = {"updatedAt": datetime.now(timezone.utc).isoformat(), "items": items}
    tmp = manifest_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(manifest_path)
    manifest_path.chmod(0o644)
    print("已更新 {}：".format(manifest_path))
    for item in items:
        parts = [part for part in (item.get("file"), item.get("url")) if part]
        print("  {:8} {}  {}".format(item["platform"], " + ".join(parts), item.get("version", "")))
    if not items:
        print("  （还没有安装包。把 HXBot-版本-arm64.dmg / -x64.exe / -android.apk / -ios.ipa 放进目录后重新运行）")
    print("应用内更新：")
    print("  手机端 {}".format("、".join("{} {}".format(name, mobile[key]["version"]) for key, name in (("android", "安卓"), ("ios", "iPhone")) if key in mobile) or "（还没有可以直接安装的手机端安装包）"))
    for line in desktop_lines:
        print("  桌面端 " + line)
    if not desktop_lines and not desktop_problems:
        print("  桌面端（还没有更新文件：上传安装包时用 hx/scripts/upload-downloads.sh，会一并传上来）")
    for note in notes + desktop_problems + desktop_update_gaps(directory, items):
        print()
        print("  " + note)
    return 0


if __name__ == "__main__":
    sys.exit(main())
