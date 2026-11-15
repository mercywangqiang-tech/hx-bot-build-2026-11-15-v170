"""users.sh 的实现：查看和管理注册用户。由 users.sh 调用，命令和说明见 users.sh 开头。

数据在账号服务自带的 SQLite 数据库里（Docker 卷 hxbot_account-state）。读写时先暂停账号服务几秒，
在一次性容器里用同一个数据卷执行 SQL，再把账号服务启动起来（与 backup.sh、delete-account.sh 相同）。
需要输入的内容（密码、资料）都在暂停之前问完。

测试时设置 HXBOT_SQLITE=数据库文件：直接读写这个文件，不碰 Docker。
"""
import csv
import getpass
import hashlib
import json
import os
import re
import secrets
import sqlite3
import subprocess
import sys
import time

IMAGE = "hxbot/account:local"
CONFIG = "/app/dist/server/wrangler.json"
SQLITE = os.environ.get("HXBOT_SQLITE", "")
EMAIL = re.compile(r"^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$")
# 与账号服务一致（apps/auth-api/src/server/hx-accounts/secrets.ts、service.ts）
PASSWORD_ITERATIONS = 100000
PASSWORD_MIN, PASSWORD_MAX = 8, 32
USERNAME = re.compile(r"^[^\W_][\w.-]{1,31}$")  # 以字母或数字（含中文）开头，后面可以有 _ . -
PROVIDER_NAMES = {"wechat": "微信", "alipay": "支付宝", "douyin": "抖音", "apple": "Apple", "google": "Google", "facebook": "Facebook"}


def fail(message):
    print("✘ " + message, file=sys.stderr)
    sys.exit(1)


def quote(value):
    """SQL 里的文字：单引号写两遍。"""
    return "'" + str(value).replace("'", "''") + "'"


class Database:
    """暂停账号服务后执行 SQL；用完（或出错）时把账号服务启动起来。"""

    def __init__(self):
        self.stopped = False
        self.connection = None

    def __enter__(self):
        if SQLITE:
            self.connection = sqlite3.connect(SQLITE)
            self.connection.row_factory = sqlite3.Row
        else:
            subprocess.run(["docker", "compose", "stop", "account-cron", "account"], check=True, stdout=subprocess.DEVNULL)
            self.stopped = True
        return self

    def __exit__(self, *_):
        if self.connection is not None:
            self.connection.commit()
            self.connection.close()
        if self.stopped:
            subprocess.run(["docker", "compose", "start", "account", "account-cron"], check=False, stdout=subprocess.DEVNULL)
            self.stopped = False

    def run(self, statement):
        """执行一条或多条语句，返回最后一条的结果行（每行是一个字典）。"""
        if self.connection is not None:
            rows = []
            for part in [item.strip() for item in statement.split(";\n") if item.strip()]:
                rows = [dict(row) for row in self.connection.execute(part).fetchall()]
            return rows
        result = subprocess.run(
            ["docker", "run", "--rm", "--entrypoint", "sh", "-e", "WRANGLER_SEND_METRICS=false", "-v", "hxbot_account-state:/state", IMAGE,
             "-c", 'wrangler d1 execute hxbot-account --local --config {} --persist-to /state --json --command "$0" 2>/dev/null'.format(CONFIG),
             statement],
            stdout=subprocess.PIPE, universal_newlines=True,
        )
        try:
            parsed = json.loads(result.stdout)
            return parsed[-1]["results"] if parsed else []
        except (ValueError, KeyError, IndexError, TypeError):
            fail("读写账号数据库失败。确认已经用当前部署包启动过账号服务（docker compose up -d --build），再重试。")


def email_argument(arguments):
    email = (arguments[0] if arguments else "").strip().lower()
    if not EMAIL.match(email):
        fail("请给出用户的邮箱，例如：bash scripts/users.sh show zhangsan@example.com")
    return email


def when(value):
    """数据库里的时间（毫秒或秒）→ 本地时间的文字。"""
    if not value:
        return ""
    seconds = value / 1000 if value > 100000000000 else value
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(seconds))


def derive(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PASSWORD_ITERATIONS).hex()


def ask_password():
    """隐藏输入两次。规则与注册页相同：8～32 个字符，字母、数字、符号都要有。"""
    first = (os.environ.get("HXBOT_TEST_PASSWORD") or getpass.getpass("新密码（8～32 个字符，字母、数字、符号都要有；输入时不显示）：")).strip()
    symbol = any(not c.isalnum() and not c.isspace() for c in first)  # 与注册页相同：不是字母、数字、空格的字符都算
    if not PASSWORD_MIN <= len(first) <= PASSWORD_MAX or not re.search(r"[A-Za-z]", first) or not re.search(r"[0-9]", first) or not symbol:
        fail("密码要 8～32 个字符，同时包含字母、数字和符号。没有做任何改动。")
    second = (os.environ.get("HXBOT_TEST_PASSWORD") or getpass.getpass("再输入一次：")).strip()
    if first != second:
        fail("两次输入不一致。没有做任何改动。")
    salt = secrets.token_hex(16)
    return salt, derive(first, salt)


def normalize_phone(value):
    """13800138000、138 0013 8000、+86 138-0013-8000 是同一个号码：+8613800138000。格式不对时返回空。"""
    text = re.sub(r"[\s()-]", "", value)
    phone = "+86" + text if re.match(r"^1[3-9][0-9]{9}$", text) else re.sub(r"^00", "+", text)
    if not re.match(r"^\+[1-9][0-9]{6,14}$", phone) or (phone.startswith("+86") and not re.match(r"^\+861[3-9][0-9]{9}$", phone)):
        return ""
    return phone


def ask(prompt, check, problem):
    value = input(prompt).strip()
    if not check(value):
        fail(problem + "没有做任何改动。")
    return value


ACCOUNTS = """SELECT a.email, a.username, a.phone, a.phone_verified_at, a.job_title, a.company, a.email_verified_at,
  a.password_hash IS NOT NULL AS has_password, a.password_updated_at, a.disabled_at, a.created_at,
  (SELECT group_concat(i.provider) FROM hx_identities i WHERE i.email = a.email) AS providers,
  (SELECT max(s.last_used_at) FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE lower(u.email) = a.email) AS last_used,
  (SELECT count(*) FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE lower(u.email) = a.email AND s.revoked_at IS NULL AND s.expires_at > {now}) AS sessions
  FROM hx_accounts a"""
# 以前用共用口令登录过、还没有设置自己密码的邮箱
EARLIER = "SELECT lower(u.email) AS email, u.name, u.created_at FROM users u WHERE lower(u.email) NOT IN (SELECT email FROM hx_accounts) ORDER BY u.created_at"


def now_ms():
    return int(time.time() * 1000)


def sign_in_ways(row):
    ways = ["密码"] if row["has_password"] else []
    ways += [PROVIDER_NAMES.get(item, item) for item in (row["providers"] or "").split(",") if item]
    return "、".join(ways) or "无"


def do_list(_arguments):
    with Database() as database:
        rows = database.run(ACCOUNTS.format(now=now_ms()) + " ORDER BY a.created_at")
        earlier = database.run(EARLIER)
    print("注册用户：{} 个".format(len(rows)))
    for row in rows:
        print("  {}  {}  {}  {}  {}  注册 {}  最近使用 {}{}".format(
            row["email"], row["username"], row["phone"], row["company"], row["job_title"], when(row["created_at"]),
            when(row["last_used"]) or "无", "  【已停用】" if row["disabled_at"] else ""))
    if earlier:
        print("以前用共用口令登录过、还没有设置自己密码的邮箱：{} 个（本人在注册页用这个邮箱注册即可）".format(len(earlier)))
        for row in earlier:
            print("  {}  第一次登录 {}".format(row["email"], when(row["created_at"])))


def do_show(arguments):
    email = email_argument(arguments)
    with Database() as database:
        rows = database.run(ACCOUNTS.format(now=now_ms()) + " WHERE a.email = " + quote(email))
        earlier = database.run("SELECT 1 AS found FROM users WHERE lower(email) = " + quote(email))
    if not rows:
        fail("没有邮箱为 {} 的注册用户。{}".format(email, "这个邮箱以前用共用口令登录过，还没有设置自己的密码。" if earlier else ""))
    row = rows[0]
    print("邮箱：      {}{}".format(row["email"], "（已验证）" if row["email_verified_at"] else "（未验证）"))
    print("用户名：    {}".format(row["username"]))
    print("手机号码：  {}{}".format(row["phone"], "（已验证）" if row["phone_verified_at"] else "（未验证）"))
    print("公司名称：  {}".format(row["company"]))
    print("职位：      {}".format(row["job_title"]))
    print("登录方式：  {}".format(sign_in_ways(row)))
    print("注册时间：  {}".format(when(row["created_at"])))
    print("密码更新：  {}".format(when(row["password_updated_at"]) or "无"))
    print("最近使用：  {}（现在有 {} 处登录着）".format(when(row["last_used"]) or "无", row["sessions"]))
    print("状态：      {}".format("已停用（{}）".format(when(row["disabled_at"])) if row["disabled_at"] else "正常"))


def do_export(arguments):
    target = arguments[0] if arguments else "users-{}.csv".format(time.strftime("%Y%m%d"))
    with Database() as database:
        rows = database.run(ACCOUNTS.format(now=now_ms()) + " ORDER BY a.created_at")
    # utf-8-sig：Excel 直接打开时中文不乱码
    with open(target, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["邮箱", "用户名", "手机号码", "公司名称", "职位", "登录方式", "注册时间", "最近使用", "状态"])
        for row in rows:
            writer.writerow([row["email"], row["username"], row["phone"], row["company"], row["job_title"], sign_in_ways(row),
                             when(row["created_at"]), when(row["last_used"]), "已停用" if row["disabled_at"] else "正常"])
    os.chmod(target, 0o600)
    print("✔ 已导出 {} 个用户到 {}（含个人信息，用完请删除，不要外传）".format(len(rows), target))


def sign_out_everywhere(email, now):
    return "UPDATE auth_sessions SET revoked_at = {now} WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE lower(email) = {email})".format(
        now=now, email=quote(email))


def must_exist(database, email):
    if not database.run("SELECT 1 AS found FROM hx_accounts WHERE email = " + quote(email)):
        fail("没有邮箱为 {} 的注册用户。没有做任何改动。（新建账号用：bash scripts/users.sh add {}）".format(email, email))


def do_reset_password(arguments):
    email = email_argument(arguments)
    salt, derived = ask_password()
    now = now_ms()
    with Database() as database:
        must_exist(database, email)
        database.run(
            "UPDATE hx_accounts SET password_salt = {}, password_hash = {}, password_iterations = {}, password_updated_at = {now}, updated_at = {now} WHERE email = {email};\n"
            .format(quote(salt), quote(derived), PASSWORD_ITERATIONS, now=now, email=quote(email)) + sign_out_everywhere(email, now))
        left = database.run("SELECT password_hash FROM hx_accounts WHERE email = " + quote(email))
    if not left or left[0]["password_hash"] != derived:
        fail("密码没有写进去。请把这条输出发给开发人员。")
    print("✔ 已为 {} 设置新密码，他在各处的登录状态已全部退出。请用安全的方式把新密码告诉本人，并提醒他登录后在门户页用“忘记密码”改成自己的。".format(email))


def do_disable(arguments):
    email = email_argument(arguments)
    now = now_ms()
    with Database() as database:
        must_exist(database, email)
        database.run("UPDATE hx_accounts SET disabled_at = {now}, updated_at = {now} WHERE email = {email};\n".format(now=now, email=quote(email)) + sign_out_everywhere(email, now))
    print("✔ 已停用 {}：不能再登录，各处的登录状态已全部退出。资料保留；恢复用 bash scripts/users.sh enable {}".format(email, email))


def do_enable(arguments):
    email = email_argument(arguments)
    with Database() as database:
        must_exist(database, email)
        database.run("UPDATE hx_accounts SET disabled_at = NULL, updated_at = {} WHERE email = {}".format(now_ms(), quote(email)))
    print("✔ 已恢复 {}，可以重新登录。".format(email))


def do_add(arguments):
    """管理员代为建账号：没有配置邮箱或短信验证、又要给某人开通时用。"""
    email = email_argument(arguments)
    username = ask("用户名（2～32 个字符，可以用中文、字母、数字和 _ . -）：", USERNAME.match, "用户名要 2～32 个字符，可以用中文、字母、数字和 _ . -。")
    phone = normalize_phone(ask("手机号码（中国大陆的直接写 11 位，其他地区写 + 和国家代码）：", normalize_phone, "请输入有效的手机号码。"))
    company = ask("公司名称：", lambda value: 1 <= len(value) <= 64, "公司名称要 1～64 个字符。")
    job_title = ask("职位：", lambda value: 1 <= len(value) <= 64, "职位要 1～64 个字符。")
    salt, derived = ask_password()
    now = now_ms()
    with Database() as database:
        if database.run("SELECT 1 AS found FROM hx_accounts WHERE email = " + quote(email)):
            fail("{} 已经注册过。改密码用 reset-password。没有做任何改动。".format(email))
        if database.run("SELECT 1 AS found FROM hx_accounts WHERE username_key = " + quote(username.lower())):
            fail("用户名 {} 已经有人用了，请换一个。没有做任何改动。".format(username))
        # 一个手机号只能注册一个账号（与邮箱、用户名一样）
        if database.run("SELECT 1 AS found FROM hx_phone_owners WHERE phone = {0} UNION ALL SELECT 1 AS found FROM hx_accounts WHERE phone = {0}".format(quote(phone))):
            fail("手机号 {} 已经注册了账号。没有做任何改动。".format(phone))
        database.run(
            "INSERT INTO hx_accounts(email, username, username_key, phone, phone_verified_at, job_title, company, email_verified_at, "
            "password_salt, password_hash, password_iterations, password_updated_at, created_at, updated_at) VALUES "
            "({email}, {username}, {key}, {phone}, NULL, {job}, {company}, NULL, {salt}, {derived}, {iterations}, {now}, {now}, {now})".format(
                email=quote(email), username=quote(username), key=quote(username.lower()), phone=quote(phone), job=quote(job_title),
                company=quote(company), salt=quote(salt), derived=quote(derived), iterations=PASSWORD_ITERATIONS, now=now))
        database.run("INSERT INTO hx_phone_owners(phone, email, created_at) VALUES ({}, {}, {}) ON CONFLICT DO NOTHING".format(
            quote(phone), quote(email), now))
        created = database.run("SELECT 1 AS found FROM hx_accounts WHERE email = " + quote(email))
    if not created:
        fail("账号没有建成。请把这条输出发给开发人员。")
    print("✔ 已为 {} 建好账号。请用安全的方式把密码告诉本人。".format(email))


COMMANDS = {"list": do_list, "show": do_show, "export": do_export, "reset-password": do_reset_password,
            "disable": do_disable, "enable": do_enable, "add": do_add}

if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else ""
    if name not in COMMANDS:
        fail("不认识的命令：{}。可用的命令：{}（说明见 scripts/users.sh 开头）".format(name or "（空）", "、".join(COMMANDS)))
    try:
        COMMANDS[name](sys.argv[2:])
        sys.stdout.flush()
    except BrokenPipeError:  # 例如 users.sh list | head：读的一方先关了，不算出错
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
