#!/usr/bin/env python3
"""nginx 站点配置 hx/server/nginx/hxbot.conf 的测试：用本机的 nginx 真的跑起来（没装 nginx 时跳过）。

只测和下载、更新有关的地址：
  /updates/        应用内更新：带登录令牌（Authorization: Bearer）或登录 Cookie 才能取，增量下载要的范围请求可用
  /ota/<随机串>/   iOS 无线安装、安卓新版安装包：手机系统不带登录状态来取，只认服务器生成的随机串
  /downloads/      下载中心：登录 Cookie

账号服务换成一个很小的替身：令牌 good、Cookie __Host-hxbot-web=good 算登录。
运行：python3 hx/tests/test_nginx.py
"""

import http.client
import http.server
import os
import re
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONF = ROOT / "hx" / "server" / "nginx" / "hxbot.conf"
NGINX = shutil.which("nginx") or ("/usr/sbin/nginx" if os.path.exists("/usr/sbin/nginx") else None)
SITE = "bot.hxallai.com"
TOKEN = "0123456789abcdef0123456789abcdef"


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class Account(http.server.BaseHTTPRequestHandler):
    """账号服务的替身：只回答 nginx 来问的两个地址。"""

    seen = []

    def log_message(self, *args):
        pass

    def signed_in(self):
        return self.headers.get("Authorization") == "Bearer good" or "__Host-hxbot-web=good" in (self.headers.get("Cookie") or "")

    def do_GET(self):
        Account.seen.append((self.path, self.headers.get("Authorization"), self.headers.get("Cookie")))
        if self.path in ("/api/browser/hx/signed-in", "/api/browser/session"):
            self.send_response(204 if self.signed_in() else 401)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        body = b"account service"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@unittest.skipIf(NGINX is None, "没有安装 nginx")
class NginxTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        work = Path(cls.temporary.name)
        cls.work = work
        work.chmod(0o755)  # nginx 的工作进程不是 root（服务器上 /opt/hxbot/downloads 也是 755）
        for name in ("logs", "temp", "acme", "opt/portal/assets", "opt/portal/pages", "opt/downloads/updates/desktop"):
            (work / name).mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=" + SITE,
             "-keyout", str(work / "key.pem"), "-out", str(work / "cert.pem")],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        downloads = work / "opt" / "downloads"
        (work / "opt" / "portal" / "index.html").write_text("portal", encoding="utf-8")
        for page in ("guide", "whats-new", "terms", "privacy"):
            (work / "opt" / "portal" / "pages" / (page + ".html")).write_text(page + " zh", encoding="utf-8")
            (work / "opt" / "portal" / "pages" / (page + ".en.html")).write_text(page + " en", encoding="utf-8")
        (downloads / "manifest.json").write_text('{"items": []}', encoding="utf-8")
        (downloads / "HXBot-1.5.0-android.apk").write_bytes(b"android package")
        (downloads / "HXBot-0.67.1-x64.exe").write_bytes(bytes(range(256)) * 16)
        (downloads / "updates" / "mobile.json").write_text('{"android": {}}', encoding="utf-8")
        desktop = downloads / "updates" / "desktop"
        (desktop / "latest.yml").write_text("version: 0.67.1\n", encoding="utf-8")
        os.symlink(os.path.join("..", "..", "HXBot-0.67.1-x64.exe"), str(desktop / "HXBot-0.67.1-x64.exe"))
        ota = downloads / ".ota" / TOKEN
        ota.mkdir(parents=True)
        os.symlink(os.path.join("..", "..", "HXBot-1.5.0-android.apk"), str(ota / "HXBot.apk"))
        (ota / "manifest.plist").write_text("<plist/>", encoding="utf-8")

        cls.account = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Account)
        threading.Thread(target=cls.account.serve_forever, daemon=True).start()
        account_port = cls.account.server_address[1]
        cls.https_port, http_port = free_port(), free_port()

        site = CONF.read_text(encoding="utf-8")
        site = site.replace("listen 443 ssl;", "listen 127.0.0.1:{} ssl;".format(cls.https_port))
        site = site.replace("listen 80;", "listen 127.0.0.1:{};".format(http_port))
        site = site.replace("/etc/letsencrypt/live/hxbot/fullchain.pem", str(work / "cert.pem"))
        site = site.replace("/etc/letsencrypt/live/hxbot/privkey.pem", str(work / "key.pem"))
        site = site.replace("/var/log/hxbot/", str(work / "logs") + "/")
        site = site.replace("/var/www/hxbot-acme", str(work / "acme"))
        site = site.replace("/opt/hxbot/", str(work / "opt") + "/")
        site = site.replace("127.0.0.1:8787", "127.0.0.1:{}".format(account_port))
        site = site.replace("127.0.0.1:8081", "127.0.0.1:{}".format(account_port))
        site = re.sub(r"127\.0\.0\.1:(9\d{3})", "127.0.0.1:{}".format(account_port), site)
        mime = "include /etc/nginx/mime.types;" if os.path.exists("/etc/nginx/mime.types") else ""
        temp = work / "temp"
        (work / "nginx.conf").write_text(
            "pid {work}/nginx.pid;\nerror_log {work}/logs/error.log;\nevents {{}}\nhttp {{\n  {mime}\n"
            "  client_body_temp_path {temp}/body;\n  proxy_temp_path {temp}/proxy;\n  fastcgi_temp_path {temp}/fastcgi;\n"
            "  uwsgi_temp_path {temp}/uwsgi;\n  scgi_temp_path {temp}/scgi;\n  include {work}/hxbot.conf;\n}}\n".format(
                work=work, mime=mime, temp=temp),
            encoding="utf-8",
        )
        (work / "hxbot.conf").write_text(site, encoding="utf-8")
        result = subprocess.run([NGINX, "-p", str(work), "-c", str(work / "nginx.conf"), "-t"],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
        if result.returncode != 0:
            cls.account.shutdown()
            raise AssertionError("nginx -t：" + result.stdout)
        subprocess.run([NGINX, "-p", str(work), "-c", str(work / "nginx.conf")], check=True)
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", cls.https_port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        subprocess.run([NGINX, "-p", str(cls.work), "-c", str(cls.work / "nginx.conf"), "-s", "stop"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.account.shutdown()
        time.sleep(0.2)
        cls.temporary.cleanup()

    def get(self, path, headers=None, method="GET"):
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        connection = http.client.HTTPSConnection("127.0.0.1", self.https_port, context=context, timeout=10)
        connection.request(method, path, headers=dict({"Host": SITE}, **(headers or {})))
        response = connection.getresponse()
        body = response.read()
        connection.close()
        return response.status, dict((key.lower(), value) for key, value in response.getheaders()), body

    def test_update_files_need_a_signed_in_client(self):
        status, headers, body = self.get("/updates/mobile.json")
        self.assertEqual(status, 401)
        self.assertIn(b'"unauthorized"', body)
        self.assertEqual(self.get("/updates/mobile.json", {"Authorization": "Bearer wrong"})[0], 401)
        status, headers, body = self.get("/updates/mobile.json", {"Authorization": "Bearer good"})
        self.assertEqual((status, body), (200, b'{"android": {}}'))
        self.assertEqual(headers.get("cache-control"), "private, no-cache")
        self.assertEqual(self.get("/updates/desktop/latest.yml", {"Cookie": "__Host-hxbot-web=good"})[0], 200)
        # nginx 把令牌原样交给账号服务
        self.assertIn(("/api/browser/hx/signed-in", "Bearer good", None), Account.seen)

    def test_windows_update_follows_the_link_and_answers_ranges(self):
        exe = (self.work / "opt" / "downloads" / "HXBot-0.67.1-x64.exe").read_bytes()
        status, headers, body = self.get("/updates/desktop/HXBot-0.67.1-x64.exe", {"Authorization": "Bearer good"})
        self.assertEqual((status, body), (200, exe))
        status, headers, body = self.get("/updates/desktop/HXBot-0.67.1-x64.exe",
                                         {"Authorization": "Bearer good", "Range": "bytes=100-199"})
        self.assertEqual((status, body), (206, exe[100:200]))
        self.assertEqual(self.get("/updates/desktop/HXBot-0.67.1-x64.exe")[0], 401)

    def test_update_directory_is_not_listed_and_does_not_reach_outside(self):
        self.assertIn(self.get("/updates/desktop/", {"Authorization": "Bearer good"})[0], (403, 404))
        for path in ("/updates/../manifest.json", "/updates/%2e%2e/manifest.json", "/updates/desktop/../../manifest.json"):
            status, headers, body = self.get(path, {"Authorization": "Bearer good"})
            self.assertNotEqual(body, b'{"items": []}', path)

    def test_android_package_by_its_random_address(self):
        status, headers, body = self.get("/ota/{}/HXBot.apk".format(TOKEN))
        self.assertEqual((status, body), (200, b"android package"))
        self.assertEqual(headers.get("content-type"), "application/vnd.android.package-archive")
        self.assertEqual(self.get("/ota/{}/HXBot.apk".format("f" * 32))[0], 404)
        self.assertEqual(self.get("/ota/{}/HXBot.apk".format(TOKEN[:31]))[0], 404)
        self.assertEqual(self.get("/ota/{}/manifest.plist".format(TOKEN))[0], 200)
        self.assertEqual(self.get("/ota/{}/other.txt".format(TOKEN))[0], 404)

    def test_download_center_needs_the_login_cookie(self):
        status, headers, body = self.get("/downloads/manifest.json")
        self.assertEqual((status, headers.get("location", "").endswith("/?login=1")), (302, True))
        self.assertEqual(self.get("/downloads/manifest.json", {"Cookie": "__Host-hxbot-web=good"})[0], 200)
        self.assertIn(self.get("/downloads/.ota/{}/HXBot.apk".format(TOKEN), {"Cookie": "__Host-hxbot-web=good"})[0], (403, 404))

    def test_portal_pages_new_features_included(self):
        # 使用指南、新功能与亮点（v1.6.4 起）、服务条款、隐私政策：中文和英文，没有结尾的 / 时补上
        for page in ("guide", "whats-new", "terms", "privacy"):
            self.assertEqual(self.get("/{}/".format(page))[::2], (200, (page + " zh").encode()), page)
            self.assertEqual(self.get("/en/{}/".format(page))[::2], (200, (page + " en").encode()), page)
            status, headers, body = self.get("/" + page)
            self.assertEqual((status, headers.get("location", "").endswith("/{}/".format(page))), (301, True), page)
        self.assertEqual(self.get("/whats-new/x")[0], 302)


if __name__ == "__main__":
    unittest.main(verbosity=2)
