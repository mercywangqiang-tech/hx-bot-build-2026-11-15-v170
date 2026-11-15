#!/usr/bin/env python3
"""服务器升级脚本的测试：hx/server/scripts/update.sh（手工升级，全量包和更新包）与 auto-update.sh（自动更新）。

服务器装在临时目录里；docker、curl、nginx、systemctl 换成记录参数的替身，部署包里的 check.sh、set-env.sh、
backup.sh、setup-https.sh 也是替身，它们的表现由测试控制（control 目录里的文件，按各自所在版本的 VERSION 区分）。
运行：python3 hx/tests/test_server_update.py
"""

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UPDATE = ROOT / "hx" / "server" / "scripts" / "update.sh"
AUTO = ROOT / "hx" / "server" / "scripts" / "auto-update.sh"

CHECK = r"""#!/bin/sh
here="$(cd "$(dirname "$0")/.." && pwd)"
version="$(cat "$here/VERSION" 2>/dev/null || echo old)"
echo "== 本机服务 =="
# check-版本-starting：服务刚启动时的结果，只出现一次（之后按 check-版本 或全部通过）
if [ -f "$HX_TEST_CONTROL/check-$version-starting" ]; then cat "$HX_TEST_CONTROL/check-$version-starting"; rm -f "$HX_TEST_CONTROL/check-$version-starting"
elif [ -f "$HX_TEST_CONTROL/check-$version" ]; then cat "$HX_TEST_CONTROL/check-$version"; else echo "  通过  账号服务"; fi
echo "check $version $*" >> "$HX_TEST_CONTROL/calls"
"""
SET_ENV = r"""#!/bin/sh
here="$(cd "$(dirname "$0")/.." && pwd)"
version="$(cat "$here/VERSION" 2>/dev/null || echo old)"
[ -f "$HX_TEST_CONTROL/setenv-$version" ] && cat "$HX_TEST_CONTROL/setenv-$version"
echo "必须填写的项已全部填好。"
[ ! -f "$HX_TEST_CONTROL/setenv-missing-$version" ]
"""
BACKUP = r"""#!/bin/sh
mkdir -p "$HX_ROOT/backups"
tar czf "$HX_ROOT/backups/account-$(date +%Y%m%d-%H%M%S)-$$.tgz" -C "$HX_TEST_CONTROL" .
echo "backup" >> "$HX_TEST_CONTROL/calls"
"""
SETUP_HTTPS = r"""#!/bin/sh
here="$(cd "$(dirname "$0")/.." && pwd)"
version="$(cat "$here/VERSION" 2>/dev/null || echo old)"
echo "setup-https $version $*" >> "$HX_TEST_CONTROL/calls"
[ ! -f "$HX_TEST_CONTROL/https-fail-$version" ] || { echo "nginx -t 不通过" >&2; exit 1; }
cp "$here/nginx/hxbot.conf" "$HX_NGINX_CONF"
"""
DOCKER = r"""#!/bin/sh
echo "docker $*" >> "$HX_TEST_CONTROL/calls"
case "$*" in
  "compose config --images") printf 'hxbot/account:local\nhxbot/signal:local\ncoturn/coturn:4.6\n' ;;
  "compose up -d --build") [ ! -f "$HX_TEST_CONTROL/build-fail" ] || { echo "build failed" >&2; exit 1; } ;;
  "image inspect "*) case "$3" in *:rollback) [ -f "$HX_TEST_CONTROL/tag-$(echo "$3" | tr '/:' '__')" ] ;; *) true ;; esac ;;
  "image tag "*) touch "$HX_TEST_CONTROL/tag-$(echo "$4" | tr '/:' '__')" ;;
esac
"""
CURL = r"""#!/usr/bin/env python3
import os, shutil, sys
args = sys.argv[1:]
control = os.environ["HX_TEST_CONTROL"]
with open(os.path.join(control, "calls"), "a") as log:
    log.write("curl " + " ".join(args) + "\n")
url = args[-1]
if url.startswith("http://127.0.0.1"):
    print("500" if os.path.exists(os.path.join(control, "unhealthy")) else "200", end="")
    sys.exit(0)
if not url.startswith("https://updates.example.com/hx/"):
    sys.exit(6)
path = os.path.join(os.environ["HX_TEST_WEB"], url[len("https://updates.example.com/hx/"):])
if not os.path.isfile(path):
    sys.exit(22)
if "-o" in args:
    shutil.copyfile(path, args[args.index("-o") + 1])
else:
    sys.stdout.write(open(path).read())
"""
NGINX = "#!/bin/sh\necho \"nginx $*\" >> \"$HX_TEST_CONTROL/calls\"\n"
SYSTEMCTL = "#!/bin/sh\nexit 3\n"


def tree(path):
    """目录里每个文件的内容摘要（比较升级前后、回滚后是否完全一样）。"""
    result = {}
    for folder, _, files in os.walk(str(path)):
        for name in files:
            full = os.path.join(folder, name)
            with open(full, "rb") as handle:
                result[os.path.relpath(full, str(path))] = (hashlib.sha256(handle.read()).hexdigest(), os.stat(full).st_mode & 0o777)
    return result


class UpdateTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        work = Path(self.temporary.name)
        self.work = work
        self.root = work / "opt" / "hxbot"
        self.control = work / "control"
        self.web = work / "web"
        tools = work / "bin"
        for folder in (self.root, self.control, self.web, tools):
            folder.mkdir(parents=True)
        for name, body in (("docker", DOCKER), ("curl", CURL), ("nginx", NGINX), ("systemctl", SYSTEMCTL)):
            (tools / name).write_text(body, encoding="utf-8")
            (tools / name).chmod(0o755)
        self.nginx_conf = work / "nginx" / "hxbot.conf"
        self.nginx_conf.parent.mkdir()
        self.environment = dict(
            os.environ,
            PATH=str(tools) + os.pathsep + os.environ["PATH"],
            HX_ROOT=str(self.root), HX_LOG_DIR=str(work / "log"), HX_STATE_DIR=str(work / "state"),
            HX_NGINX_CONF=str(self.nginx_conf), HX_TEST_CONTROL=str(self.control), HX_TEST_WEB=str(self.web),
            HX_HEALTH_WAIT="6", HX_SETTLE_WAIT="2", HX_SETTLE_STEP="1", HX_TEST_ALLOW_USER="1", HX_CONF_DIR=str(work / "etc"), HX_CRON_FILE=str(work / "cron" / "hxbot-auto-update"),
        )
        self.environment.pop("HX_UPDATE_STAGE", None)
        # 已经部署的 v1.6.2
        self.files("1.6.2", "aaa1111", {"account/dist/old.js": "old", "account/dist/same.js": "same", "account/migrations/0001.sql": "create",
                                        "docker-compose.yml": "services: {}", "portal/index.html": "portal 1.6.2", "nginx/hxbot.conf": "nginx 1.6.2",
                                        "scripts/users.py": "users 1.6.2"}, self.root / "server")
        (self.root / "server" / ".env").write_text("SECRET=keep\n", encoding="utf-8")
        (self.root / "server" / ".env").chmod(0o600)
        (self.root / "portal").mkdir()
        (self.root / "portal" / "index.html").write_text("portal 1.6.2", encoding="utf-8")
        self.nginx_conf.write_text("nginx 1.6.2", encoding="utf-8")

    def tearDown(self):
        self.temporary.cleanup()

    def files(self, version, commit, extra, folder, update_script=None):
        folder.mkdir(parents=True, exist_ok=True)
        contents = {"VERSION": version + "\n", "BUILD_COMMIT": commit + "\n", "BUILD_TIME": "2026-11-13T00:00:00Z\n",
                    "scripts/check.sh": CHECK, "scripts/set-env.sh": SET_ENV, "scripts/backup.sh": BACKUP,
                    "scripts/setup-https.sh": SETUP_HTTPS, "scripts/update.sh": update_script or UPDATE.read_text(encoding="utf-8")}
        contents.update(extra)
        for name, body in contents.items():
            path = folder / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")
            if name.endswith(".sh"):
                path.chmod(0o755)

    def package(self, name, version, commit, extra, update_from=None, deleted=(), update_script=None, members=None):
        stage = self.work / ("stage-" + name)
        shutil.rmtree(str(stage), ignore_errors=True)
        self.files(version, commit, extra, stage / "server", update_script)
        if update_from:
            (stage / "server" / ".hx-update").mkdir()
            (stage / "server" / ".hx-update" / "package").write_text(
                "kind=update\nfrom_version={}\nfrom_commit={}\nto_version={}\nto_commit={}\n".format(update_from[0], update_from[1], version, commit),
                encoding="utf-8")
            (stage / "server" / ".hx-update" / "deleted.txt").write_text("".join(path + "\n" for path in deleted), encoding="utf-8")
        path = self.work / name
        with zipfile.ZipFile(str(path), "w") as archive:
            for folder, _, names in os.walk(str(stage)):
                for file_name in names:
                    full = os.path.join(folder, file_name)
                    info = zipfile.ZipInfo(os.path.relpath(full, str(stage)))
                    info.external_attr = (os.stat(full).st_mode & 0o777) << 16
                    with open(full, "rb") as handle:
                        archive.writestr(info, handle.read())
            for member, body in (members or {}).items():
                archive.writestr(member, body)
        return path

    def full_163(self, **extra):
        files = {"account/dist/new.js": "new", "account/dist/same.js": "same", "account/migrations/0001.sql": "create",
                 "account/migrations/0002.sql": "add", "docker-compose.yml": "services: {}", "portal/index.html": "portal 1.6.3",
                 "nginx/hxbot.conf": "nginx 1.6.3", "scripts/users.py": "users 1.6.3"}
        files.update(extra)
        return self.package("hxbot-server-v1.6.3.zip", "1.6.3", "bbb2222", files)

    def update(self, package, *args, expect=0):
        script = self.root / "server" / "scripts" / "update.sh"
        result = subprocess.run(["bash", str(script), str(package)] + list(args), env=self.environment,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, timeout=120)
        self.assertEqual(result.returncode, expect, result.stdout)
        return result.stdout

    def calls(self):
        path = self.control / "calls"
        return path.read_text(encoding="utf-8").splitlines() if path.exists() else []

    def status(self):
        return (self.work / "state" / "update-status").read_text(encoding="utf-8").split("\t")[1:]

    def server(self, name):
        return (self.root / "server" / name).read_text(encoding="utf-8")

    def test_full_package(self):
        output = self.update(self.full_163())
        self.assertIn("✔ 已升级到 1.6.3", output)
        self.assertEqual(self.server("VERSION"), "1.6.3\n")
        self.assertEqual(self.server("account/dist/new.js"), "new")
        # 旧的程序文件整个换掉；.env、门户页、nginx 配置
        self.assertFalse((self.root / "server" / "account" / "dist" / "old.js").exists())
        self.assertEqual(self.server(".env"), "SECRET=keep\n")
        self.assertEqual(os.stat(str(self.root / "server" / ".env")).st_mode & 0o777, 0o600)
        self.assertEqual((self.root / "portal" / "index.html").read_text(encoding="utf-8"), "portal 1.6.3")
        self.assertEqual(self.nginx_conf.read_text(encoding="utf-8"), "nginx 1.6.3")
        calls = self.calls()
        self.assertEqual(calls[0], "check 1.6.2 --local")
        self.assertIn("backup", calls)
        self.assertIn("setup-https 1.6.3 ", calls)
        self.assertIn("docker compose up -d --build", calls)
        self.assertEqual(calls[-1] if calls[-1].startswith("check") else [c for c in calls if c.startswith("check")][-1], "check 1.6.3 --local")
        self.assertIn("docker image tag hxbot/account:local hxbot/account:rollback", calls)
        self.assertIn("docker image rm hxbot/account:rollback", calls)
        self.assertNotIn("docker image tag coturn/coturn:4.6 coturn/coturn:rollback", calls)
        self.assertEqual(self.status(), ["updated", "1.6.3\n"])
        self.assertEqual(len(list((self.root / "backups").glob("server-*.tgz"))), 1)
        self.assertFalse(list(self.root.glob(".update-*")))
        self.assertIn("升级 HXBot 服务器", (self.work / "log" / "update.log").read_text(encoding="utf-8"))

    def test_update_package(self):
        package = self.package("hxbot-server-update-v1.6.3.zip", "1.6.3", "bbb2222",
                               {"account/dist/new.js": "new", "account/migrations/0002.sql": "add", "scripts/users.py": "users 1.6.3"},
                               update_from=("1.6.2", "aaa1111"), deleted=["account/dist/old.js"])
        output = self.update(package)
        self.assertIn("更新包，起点 v1.6.2", output)
        self.assertEqual(self.server("account/dist/new.js"), "new")
        self.assertEqual(self.server("account/dist/same.js"), "same")
        self.assertEqual(self.server("scripts/users.py"), "users 1.6.3")
        self.assertFalse((self.root / "server" / "account" / "dist" / "old.js").exists())
        self.assertFalse((self.root / "server" / ".hx-update").exists())
        self.assertEqual(self.status(), ["updated", "1.6.3\n"])

    def test_update_package_from_another_version_is_refused(self):
        before = tree(self.root / "server")
        package = self.package("hxbot-server-update-v1.6.3.zip", "1.6.3", "bbb2222", {}, update_from=("1.6.1", "c0001ff8"))
        output = self.update(package, expect=1)
        self.assertIn("这个更新包只能从 v1.6.1（提交 c0001ff8）升级", output)
        self.assertIn("请改用全量包 hxbot-server-v1.6.3.zip", output)
        self.assertEqual(tree(self.root / "server"), before)
        self.assertNotIn("backup", self.calls())

    def test_unsafe_deleted_paths_are_refused(self):
        for path in ("../etc/passwd", ".env", "/etc/hosts", "account/../../x"):
            package = self.package("hxbot-server-update-v1.6.3.zip", "1.6.3", "bbb2222", {}, update_from=("1.6.2", "aaa1111"), deleted=[path])
            self.assertIn("要删除的文件不合规", self.update(package, expect=1))
        self.assertTrue((self.root / "server" / ".env").exists())

    def test_same_version_and_older_version(self):
        same = self.package("hxbot-server-v1.6.2.zip", "1.6.2", "aaa1111", {"account/dist/x.js": "x", "docker-compose.yml": "x"})
        self.assertIn("已经是这个版本", self.update(same))
        self.assertEqual(self.status(), ["unchanged", "1.6.2\n"])
        older = self.package("hxbot-server-v1.6.1.zip", "1.6.1", "c0001ff8", {"account/dist/x.js": "x", "docker-compose.yml": "x"})
        self.assertIn("比这台服务器的 1.6.2 旧", self.update(older, expect=1))
        self.assertNotIn("backup", self.calls())
        self.assertIn("✔ 已升级到 1.6.1", self.update(older, "--force"))

    def test_not_a_package(self):
        bad = self.work / "bad.zip"
        bad.write_bytes(b"not a zip")
        self.assertIn("不是有效的 zip 文件", self.update(bad, expect=1))
        outside = self.package("hxbot-server-v1.6.3.zip", "1.6.3", "bbb2222", {"account/dist/x.js": "x"}, members={"etc/cron.d/x": "x"})
        self.assertIn("server/ 以外的文件", self.update(outside, expect=1))
        traversal = self.package("hxbot-server-v1.6.4.zip", "1.6.4", "ccc3333", {"account/dist/x.js": "x"}, members={"server/../../x": "x"})
        self.assertIn("server/ 以外的文件", self.update(traversal, expect=1))
        incomplete = self.package("hxbot-server-v1.6.5.zip", "1.6.5", "ddd4444", {})
        self.assertIn("不是完整的部署包", self.update(incomplete, expect=1))
        self.assertNotIn("backup", self.calls())
        self.assertFalse(list(self.root.glob(".update-*")))

    def assert_rolled_back(self, before, output):
        self.assertIn("已回滚到 1.6.2", output)
        self.assertEqual(tree(self.root / "server"), before)
        self.assertEqual(self.nginx_conf.read_text(encoding="utf-8"), "nginx 1.6.2")
        self.assertEqual(self.status()[0], "rolled-back")
        self.assertIn("docker image tag hxbot/account:rollback hxbot/account:local", self.calls())
        self.assertFalse(list(self.root.glob(".update-*")))

    def test_new_check_failure_rolls_back_files_images_and_database(self):
        before = tree(self.root / "server")
        (self.control / "check-1.6.3").write_text("  通过  账号服务\n  失败  应用内更新（期望 401，实际 404）\n", encoding="utf-8")
        output = self.update(self.full_163(), expect=1)
        self.assertIn("升级后新出现的失败项：应用内更新", output)
        self.assert_rolled_back(before, output)
        calls = self.calls()
        restore = [call for call in calls if call.startswith("docker run")]
        self.assertEqual(len(restore), 1)
        self.assertIn("hxbot_account-state:/state", restore[0])
        self.assertIn(Path(sorted((self.root / "backups").glob("account-*.tgz"))[-1]).name, restore[0])
        self.assertLess(calls.index("docker compose down"), calls.index(restore[0]))
        self.assertEqual(calls[-1] if "up -d" in calls[-1] else [c for c in calls if c == "docker compose up -d"][-1], "docker compose up -d")

    def test_services_still_starting_are_checked_again(self):
        # 账号服务就绪时，信令服务还没开始监听、coturn 还在第一次健康检查之前：等一会儿再查，不回滚
        (self.control / "check-1.6.3-starting").write_text(
            "  通过  账号服务\n  失败  信令服务 127.0.0.1:8081（未升级的请求应返回 404）（期望 404，实际 000）\n"
            "  失败  中继服务 coturn 健康（期望 healthy，实际 starting）\n", encoding="utf-8")
        output = self.update(self.full_163())
        self.assertIn("还没通过（服务可能还在启动", output)
        self.assertIn("✔ 已升级到 1.6.3", output)
        self.assertEqual(sum(1 for call in self.calls() if call.startswith("check 1.6.3")), 2)

    def test_several_new_failures_are_named_in_one_line(self):
        before = tree(self.root / "server")
        (self.control / "check-1.6.3").write_text(
            "  通过  账号服务\n  失败  中继服务 coturn 健康（期望 healthy，实际 unhealthy）\n"
            "  失败  信令服务 127.0.0.1:8081（未升级的请求应返回 404）（期望 404，实际 000）\n", encoding="utf-8")
        output = self.update(self.full_163(), expect=1)
        # 两项之间是完整的全角分号（原来用 tr 按字节替换，把“；”和后面的“信”切成了乱码）
        self.assertIn("升级后新出现的失败项：中继服务 coturn 健康；信令服务 127.0.0.1:8081（未升级的请求应返回 404）", output)
        self.assertNotIn("\ufffd", output)
        self.assert_rolled_back(before, output)

    def test_failures_from_before_the_update_do_not_count(self):
        failing = "  通过  账号服务\n  失败  DNS turn.bot.hxallai.com 已解析（期望 yes，实际 no）\n"
        (self.control / "check-1.6.2").write_text(failing, encoding="utf-8")
        (self.control / "check-1.6.3").write_text(failing, encoding="utf-8")
        self.assertIn("✔ 已升级到 1.6.3", self.update(self.full_163()))

    def test_new_configuration_reminder_stops_before_building(self):
        before = tree(self.root / "server")
        (self.control / "setenv-1.6.2").write_text("提醒：旧的提醒\n", encoding="utf-8")
        (self.control / "setenv-1.6.3").write_text("提醒：旧的提醒\n提醒：新功能要填的设置\n", encoding="utf-8")
        output = self.update(self.full_163(), expect=1)
        self.assertIn("新版本的配置还没有填好", output)
        self.assert_rolled_back(before, output)
        self.assertNotIn("docker compose up -d --build", self.calls())
        self.assertFalse(any(call.startswith("docker run") for call in self.calls()))
        # 同样的提醒升级前就有：照常升级
        (self.control / "setenv-1.6.3").write_text("提醒：旧的提醒\n", encoding="utf-8")
        self.assertIn("✔ 已升级到 1.6.3", self.update(self.full_163()))

    def test_build_failure_and_unhealthy_service_roll_back(self):
        before = tree(self.root / "server")
        (self.control / "build-fail").write_text("", encoding="utf-8")
        output = self.update(self.full_163(), expect=1)
        self.assertIn("docker compose up -d --build 失败", output)
        self.assert_rolled_back(before, output)
        (self.control / "build-fail").unlink()
        (self.control / "unhealthy").write_text("", encoding="utf-8")
        output = self.update(self.full_163(), expect=1)
        self.assertIn("秒内没有就绪", output)
        self.assertEqual(tree(self.root / "server"), before)

    def test_nginx_failure_rolls_back(self):
        before = tree(self.root / "server")
        (self.control / "https-fail-1.6.3").write_text("", encoding="utf-8")
        output = self.update(self.full_163(), expect=1)
        self.assertIn("更新 nginx 配置失败", output)
        self.assert_rolled_back(before, output)

    def test_the_package_brings_its_own_update_script(self):
        installed = self.root / "server" / "scripts" / "update.sh"
        installed.write_text(installed.read_text(encoding="utf-8").replace("# 一条命令", "# 旧版本：一条命令", 1), encoding="utf-8")
        output = self.update(self.full_163())
        self.assertIn("使用新版本自带的升级脚本", output)
        self.assertIn("✔ 已升级到 1.6.3", output)
        self.assertEqual(installed.read_text(encoding="utf-8"), UPDATE.read_text(encoding="utf-8"))

    def test_from_a_server_without_version_file(self):
        # v1.6.1 的服务器：没有 VERSION，也还没有 update.sh（从包里取出来运行）
        (self.root / "server" / "VERSION").unlink()
        (self.root / "server" / "scripts" / "update.sh").unlink()
        package = self.full_163()
        with zipfile.ZipFile(str(package)) as archive:
            script = self.work / "hxbot-update" / "update.sh"
            script.parent.mkdir()
            script.write_bytes(archive.read("server/scripts/update.sh"))
        result = subprocess.run(["bash", str(script), str(package)], env=self.environment,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("当前：v1.6.1 或更早", result.stdout)
        self.assertEqual(self.server("VERSION"), "1.6.3\n")

    # ---------- 自动更新 ----------
    def auto(self, *args, expect=0):
        result = subprocess.run(["bash", str(AUTO)] + list(args), env=self.environment,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, timeout=120)
        self.assertEqual(result.returncode, expect, result.stdout)
        return result.stdout

    def publish(self, full, update=None, version="1.6.3", from_commit="aaa1111"):
        def entry(path):
            data = path.read_bytes()
            (self.web / path.name).write_bytes(data)
            return {"file": path.name, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
        latest = {"version": version, "commit": "bbb2222", "full": entry(full), "updates": []}
        if update:
            latest["updates"].append(dict(entry(update), fromVersion="1.6.2", fromCommit=from_commit))
        (self.web / "latest.json").write_text(json.dumps(latest), encoding="utf-8")
        return latest

    def test_auto_update(self):
        self.publish(self.full_163(), self.package("hxbot-server-update-v1.6.3.zip", "1.6.3", "bbb2222", {"account/dist/new.js": "new"},
                                                    update_from=("1.6.2", "aaa1111")))
        self.assertIn("还没有打开自动更新", self.auto("--now", expect=1))
        self.assertIn("要是 https:// 开头", self.auto("--enable", "http://updates.example.com/hx/", expect=1))
        output = self.auto("--enable", "https://updates.example.com/hx")
        self.assertIn("已打开自动更新：每天 05:07 检查 https://updates.example.com/hx/latest.json（最新版本 1.6.3）", output)
        cron = (self.work / "cron" / "hxbot-auto-update").read_text(encoding="utf-8")
        self.assertIn("root bash {}/server/scripts/auto-update.sh --now --scheduled".format(self.root), cron)
        self.assertIn("自动更新：已打开", self.auto("--status"))
        # 这台服务器正好是更新包的起点：下载更新包
        output = self.auto("--now")
        self.assertIn("有新版本 1.6.3，下载 hxbot-server-update-v1.6.3.zip", output)
        self.assertIn("✔ 已升级到 1.6.3", output)
        self.assertEqual(self.server("account/dist/new.js"), "new")
        self.assertIn("已经是最新版本（1.6.3）", self.auto("--now"))
        self.assertIn("最近一次：", self.auto("--status"))
        self.assertIn("已经是最新（1.6.3）", self.auto("--status"))
        self.assertIn("已关闭自动更新", self.auto("--disable"))
        self.assertIn("自动更新：已关闭", self.auto("--status"))
        # 关掉以后，到点的定时任务什么也不做
        self.auto("--now", "--scheduled")

    def test_auto_update_uses_the_full_package_from_another_version(self):
        self.publish(self.full_163(), self.package("hxbot-server-update-v1.6.3.zip", "1.6.3", "bbb2222", {}, update_from=("1.6.1", "c0001ff8")),
                     from_commit="c0001ff8")
        self.auto("--enable", "https://updates.example.com/hx/")
        output = self.auto("--now")
        self.assertIn("下载 hxbot-server-v1.6.3.zip", output)
        self.assertIn("✔ 已升级到 1.6.3", output)

    def test_auto_update_refuses_a_package_that_does_not_match(self):
        latest = self.publish(self.full_163())
        self.auto("--enable", "https://updates.example.com/hx/")
        (self.web / latest["full"]["file"]).write_bytes(b"something else")
        output = self.auto("--now", expect=1)
        self.assertIn("SHA-256 和 latest.json 不一致，没有升级", output)
        self.assertEqual(self.server("VERSION"), "1.6.2\n")
        self.assertIn("没有升级：", self.auto("--status"))
        for broken in ({"version": "1.6.3", "full": {"file": "../../etc/passwd", "sha256": "0" * 64}},
                       {"version": "1.6.3; rm", "full": {"file": "hxbot-server-v1.6.3.zip", "sha256": "0" * 64}}):
            (self.web / "latest.json").write_text(json.dumps(broken), encoding="utf-8")
            self.assertIn("latest.json 的内容不对", self.auto("--now", expect=1))


if __name__ == "__main__":
    unittest.main(verbosity=2)
