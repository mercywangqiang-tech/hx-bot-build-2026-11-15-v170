"""set-env.sh 的实现：检查并写入 .env 中的一项、列出各项的填写情况、测试发信邮箱、发一条测试短信。由 set-env.sh 调用。"""
import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import smtplib
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ENV = ".env"
MODE = os.environ.get("HXBOT_MODE", "set")

# 必须填写的项（按部署文档第 5 节的顺序）
REQUIRED = ["TURN_PUBLIC_IP"]
# 注册名单（可选）、以前的共用登录口令（过渡用）
OPTIONAL = ["HX_ALLOWED_EMAIL_DOMAINS", "HX_ALLOWED_EMAILS", "HX_LOGIN_PASSWORD"]
# 注册时的两项验证：默认开启，填 off 关闭
SWITCH = ["HX_EMAIL_VERIFICATION", "HX_PHONE_VERIFICATION"]
# 发信邮箱（邮箱验证码、找回密码、主机邀请邮件；五项全部填好才启用）
MAIL = ["EMAIL_SMTP_HOST", "EMAIL_SMTP_PORT", "EMAIL_SMTP_USERNAME", "EMAIL_FROM", "EMAIL_SMTP_PASSWORD"]
# 阿里云短信（手机验证码；四项全部填好才启用）
SMS = ["HX_SMS_ACCESS_KEY_ID", "HX_SMS_ACCESS_KEY_SECRET", "HX_SMS_SIGN_NAME", "HX_SMS_TEMPLATE_CODE"]
# 第三方登录：一家的各项都填好，这一家的按钮才出现
PROVIDERS = {
    "微信": ["HX_WECHAT_APP_ID", "HX_WECHAT_APP_SECRET"],
    "支付宝": ["HX_ALIPAY_APP_ID", "HX_ALIPAY_PRIVATE_KEY"],
    "抖音": ["HX_DOUYIN_CLIENT_KEY", "HX_DOUYIN_CLIENT_SECRET"],
    "Apple": ["HX_APPLE_SERVICE_ID", "HX_APPLE_TEAM_ID", "HX_APPLE_KEY_ID", "HX_APPLE_PRIVATE_KEY"],
    "Google": ["HX_GOOGLE_CLIENT_ID", "HX_GOOGLE_CLIENT_SECRET"],
    "Facebook": ["HX_FACEBOOK_APP_ID", "HX_FACEBOOK_APP_SECRET"],
}
PROVIDER_KEYS = [key for keys in PROVIDERS.values() for key in keys]
# 密钥文件（Apple 的 .p8、支付宝的应用私钥）：用 set-env.sh --file 从文件读入，存成一行
KEY_FILES = {"HX_APPLE_PRIVATE_KEY", "HX_ALIPAY_PRIVATE_KEY"}
# 由 init-secrets.sh 生成的密钥
GENERATED = ["REMOTE_TICKET_KEY_ID", "REMOTE_TICKET_PRIVATE_JWK", "REMOTE_TICKET_PUBLIC_JWKS", "REMOTE_AUTH_WEBHOOK_SECRET",
             "REMOTE_SESSION_SECRET", "REMOTE_METRICS_TOKEN", "TURN_SHARED_SECRET", "SKILLS_ADMIN_TOKEN", "SITE_REPORT_HASH_SECRET"]
SECRET = {"HX_LOGIN_PASSWORD", "EMAIL_SMTP_PASSWORD", "HX_SMS_ACCESS_KEY_SECRET", "HX_WECHAT_APP_SECRET", "HX_DOUYIN_CLIENT_SECRET",
          "HX_GOOGLE_CLIENT_SECRET", "HX_FACEBOOK_APP_SECRET", *KEY_FILES, *GENERATED} - {"REMOTE_TICKET_KEY_ID"}
QUOTED = {"HX_LOGIN_PASSWORD", "EMAIL_SMTP_PASSWORD"}
LABEL = {
    "TURN_PUBLIC_IP": "服务器公网 IP",
    "HX_LOGIN_PASSWORD": "以前的共用登录口令（过渡用）",
    "HX_EMAIL_VERIFICATION": "注册时验证邮箱",
    "HX_PHONE_VERIFICATION": "注册时验证手机号",
    "HX_SMS_ACCESS_KEY_ID": "阿里云 AccessKey ID（短信）",
    "HX_SMS_ACCESS_KEY_SECRET": "阿里云 AccessKey Secret（短信）",
    "HX_SMS_SIGN_NAME": "短信签名",
    "HX_SMS_TEMPLATE_CODE": "短信模板 CODE",
    "HX_WECHAT_APP_ID": "微信开放平台 AppID",
    "HX_WECHAT_APP_SECRET": "微信开放平台 AppSecret",
    "HX_ALIPAY_APP_ID": "支付宝开放平台 APPID",
    "HX_ALIPAY_PRIVATE_KEY": "支付宝应用私钥",
    "HX_DOUYIN_CLIENT_KEY": "抖音开放平台 Client Key",
    "HX_DOUYIN_CLIENT_SECRET": "抖音开放平台 Client Secret",
    "HX_APPLE_SERVICE_ID": "Apple Services ID",
    "HX_APPLE_KEY_ID": "Apple 密钥的 Key ID",
    "HX_APPLE_PRIVATE_KEY": "Apple 密钥（.p8 文件）",
    "HX_GOOGLE_CLIENT_ID": "Google 客户端 ID",
    "HX_GOOGLE_CLIENT_SECRET": "Google 客户端密钥",
    "HX_FACEBOOK_APP_ID": "Facebook 应用编号",
    "HX_FACEBOOK_APP_SECRET": "Facebook 应用密钥",
    "EMAIL_SMTP_HOST": "发信邮箱 SMTP 服务器",
    "EMAIL_SMTP_PORT": "SMTP 端口",
    "EMAIL_SMTP_USERNAME": "发信邮箱账号",
    "EMAIL_FROM": "发件人地址",
    "EMAIL_SMTP_PASSWORD": "发信邮箱密码",
    "HX_ALLOWED_EMAIL_DOMAINS": "允许登录的邮箱域名",
    "HX_ALLOWED_EMAILS": "额外允许的邮箱",
    "HX_APPLE_TEAM_ID": "Apple 开发者团队号（iOS 版通用链接、Apple 登录）",
}
EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
DOMAIN = re.compile(r"^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")


def fail(msg):
    print("✘ " + msg, file=sys.stderr)
    sys.exit(1)


def read_lines():
    return open(ENV, encoding="utf-8").read().splitlines()


def values(lines):
    out = {}
    for line in lines:
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
                v = v[1:-1]
            out[k.strip()] = v
    return out


def check(key, value):
    """返回规范化后的值；格式不对时退出并说明原因。"""
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
        fail(f"变量名应为大写字母、数字和下划线，例如 TURN_PUBLIC_IP；收到的是：{key}")
    if "\n" in value or "\r" in value:
        fail("值不能包含换行")
    if key in GENERATED:
        fail(f"{key} 由 scripts/init-secrets.sh 自动生成，不要手工填写")
    if key == "TURN_PUBLIC_IP":
        try:
            ip = ipaddress.IPv4Address(value)
        except ValueError:
            fail(f"服务器公网 IP 应为 IPv4 地址，例如 47.119.145.170；收到的是：{value!r}")
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_unspecified:
            fail(f"{value} 是内网地址。请填 ECS 控制台“实例详情”里的公网 IP（不是“私有 IP”）")
    elif key in (*SWITCH, *SMS, *PROVIDER_KEYS, "HX_LOGIN_PASSWORD") and value.strip() == "":
        return ""  # 清空：恢复默认（验证开启），或关闭这一家、这一项
    elif key == "HX_LOGIN_PASSWORD":
        value = value.strip()
        if "'" in value:
            fail("登录口令里不能有英文单引号 '，请换一个")
        if not 6 <= len(value) <= 32:
            fail(f"登录口令应为 6～32 个字符；现在是 {len(value)} 个")
    elif key in SWITCH:
        value = value.strip().lower()
        if value not in ("on", "off"):
            fail(f"{LABEL[key]}只能填 on（开启，默认）或 off（关闭）；收到的是：{value!r}")
    elif key in KEY_FILES:
        value = key_text(key, value)
    elif key == "HX_SMS_TEMPLATE_CODE":
        value = value.strip()
        if not re.fullmatch(r"SMS_[0-9]+", value):
            fail(f"短信模板 CODE 形如 SMS_123456789（短信服务控制台 → 模板管理）；收到的是：{value!r}")
    elif key == "HX_SMS_SIGN_NAME":
        value = value.strip()
        if not 2 <= len(value) <= 20 or "'" in value:
            fail("短信签名填短信服务控制台里审核通过的签名名称（不带【】），2～20 个字符")
    elif key == "HX_APPLE_KEY_ID":
        value = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{10}", value):
            fail(f"Apple 密钥的 Key ID 是 10 位大写字母和数字（developer.apple.com → Keys）；收到的是：{value!r}")
    elif key == "HX_APPLE_SERVICE_ID":
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{2,}", value):
            fail(f"Apple Services ID 形如 com.hxallai.bot.signin（developer.apple.com → Identifiers → Services IDs）；收到的是：{value!r}")
    elif key == "HX_ALIPAY_APP_ID":
        value = value.strip()
        if not re.fullmatch(r"[0-9]{16,32}", value):
            fail(f"支付宝 APPID 是一串数字（开放平台 → 应用详情）；收到的是：{value!r}")
    elif key in SMS or key in PROVIDER_KEYS:
        value = value.strip()
        if re.search(r"[\s'\"]", value) or len(value) < 6:
            fail(f"{LABEL[key]}不应包含空格或引号，长度至少 6 个字符。请从对应平台的后台整段复制")
    elif key in MAIL and value == "":
        return value  # 发信邮箱各项可以清空
    elif key == "EMAIL_SMTP_HOST":
        if not DOMAIN.fullmatch(value):
            fail(f"SMTP 服务器应为域名，例如 smtp.qiye.aliyun.com；收到的是：{value!r}")
    elif key == "EMAIL_SMTP_PORT":
        if value != "465":
            fail("SMTP 端口只能填 465（SSL）。账号服务发信时一开始就加密，587（STARTTLS）和 25 端口用不了；企业邮箱、QQ 邮箱、163 邮箱都支持 465")
    elif key in ("EMAIL_SMTP_USERNAME", "EMAIL_FROM"):
        if not EMAIL.fullmatch(value):
            fail(f"{LABEL[key]}应为完整邮箱地址，例如 bot@hxallai.com；收到的是：{value!r}")
    elif key == "EMAIL_SMTP_PASSWORD":
        if "'" in value:
            fail("密码里不能有英文单引号 '。请在邮箱后台改一个不含单引号的密码，或生成“客户端专用密码”")
        if not value:
            fail("密码不能为空")
    elif key == "HX_ALLOWED_EMAIL_DOMAINS":
        items = [x.strip().lstrip("@") for x in value.split(",") if x.strip()]
        for x in items:
            if not DOMAIN.fullmatch(x):
                fail(f"邮箱域名格式不对：{x!r}。多个域名用英文逗号分隔，例如 hxallai.com,partner.cn")
        value = ",".join(items)
    elif key == "HX_ALLOWED_EMAILS":
        items = [x.strip() for x in value.split(",") if x.strip()]
        for x in items:
            if not EMAIL.fullmatch(x):
                fail(f"邮箱格式不对：{x!r}。多个邮箱用英文逗号分隔，例如 a@qq.com,b@163.com")
        value = ",".join(items)
    elif key == "HX_APPLE_TEAM_ID":
        value = value.strip().upper()
        if value and not re.fullmatch(r"[A-Z0-9]{10}", value):
            fail(f"Apple 团队号应为 10 位大写字母和数字（developer.apple.com → Membership 里的 Team ID）；收到的是：{value!r}")
    elif "'" in value:
        fail("值里不能有英文单引号 '")
    return value


def key_text(key, value):
    """密钥文件的内容：去掉 PEM 的头尾和换行，只留中间的 base64，一行。"""
    body = re.sub(r"-----[A-Z ]+-----", "", value.replace("\\n", ""))
    body = re.sub(r"\s", "", body)
    try:
        raw = base64.b64decode(body, validate=True)
    except ValueError:
        raw = b""
    if len(raw) < 100 or raw[:1] != b"\x30":
        if key == "HX_APPLE_PRIVATE_KEY":
            fail("这不是 Apple 的密钥文件。请用 bash scripts/set-env.sh --file HX_APPLE_PRIVATE_KEY AuthKey_XXXXXXXXXX.p8 读入从开发者网站下载的 .p8 文件")
        fail("这不是支付宝的应用私钥。请把密钥工具生成的“应用私钥”存成文件，用 bash scripts/set-env.sh --file HX_ALIPAY_PRIVATE_KEY 文件名 读入")
    return body


def shown(key, value):
    if not value:
        return "（空）"
    if key in SECRET:
        return f"已填（{len(value)} 个字符，不显示）"
    return value


def do_set():
    key, value = os.environ["HXBOT_KEY"], os.environ.get("HXBOT_VALUE", "")
    value = check(key, value)
    lines = read_lines()
    quoted = f"'{value}'" if (key in QUOTED or re.search(r"[\s#$\"\\`]", value)) else value
    new = f"{key}={quoted}"
    done = False
    for i, line in enumerate(lines):
        if not line.lstrip().startswith("#") and "=" in line and line.split("=", 1)[0].strip() == key:
            if done:
                lines[i] = "# " + line + "   # 重复项，已由 set-env.sh 注释掉"
            else:
                lines[i] = new
                done = True
    if not done:
        lines.append(new)
    tmp = ENV + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, ENV)
    print(f"✔ {key}（{LABEL.get(key, '已写入 .env')}）= {shown(key, value)}")
    if os.path.exists("docker-compose.yml") and key not in REQUIRED:
        print("  服务已在运行时，执行 docker compose up -d account 让新设置生效（已登录的人不受影响）")
    if key == "EMAIL_SMTP_USERNAME":
        v = values(lines)
        if v.get("EMAIL_FROM") and v["EMAIL_FROM"] != value:
            print(f"  提示：EMAIL_FROM 现在是 {v['EMAIL_FROM']}，一般应与发信邮箱账号相同")


def do_show():
    v = values(read_lines())
    missing = []
    print("必须填写：")
    for k in REQUIRED:
        val = v.get(k, "")
        ok = bool(val)
        if not ok:
            missing.append(k)
        print(f"  {'✔' if ok else '✘'} {k:<22} {LABEL[k]}：{shown(k, val)}")
    print("注册名单（两项都空 = 任何邮箱都可以注册）和过渡设置：")
    for k in OPTIONAL:
        print(f"    {k:<24} {LABEL[k]}：{shown(k, v.get(k, ''))}")
    email_on = v.get("HX_EMAIL_VERIFICATION", "").lower() != "off"
    phone_on = v.get("HX_PHONE_VERIFICATION", "").lower() != "off"
    mail = [k for k in MAIL if v.get(k)]
    sms = [k for k in SMS if v.get(k)]
    notes = []
    mail_ready = len(mail) == len(MAIL) and v.get("EMAIL_SMTP_PORT") == "465"
    if mail_ready:
        mail_state = "已填好"
    elif len(mail) == len(MAIL):
        # 以前的版本允许填 587；账号服务只能用 465 发信
        mail_state = f"五项都填了，但端口是 {v.get('EMAIL_SMTP_PORT')}，不能发信（执行 bash scripts/set-env.sh EMAIL_SMTP_PORT 465）"
    else:
        mail_state = f"只填了 {len(mail)} / {len(MAIL)} 项，不会启用" if mail else "未填写"
    if len(sms) == len(SMS):
        sms_state = "已填好"
    else:
        sms_state = f"只填了 {len(sms)} / {len(SMS)} 项，不会启用" if sms else "未填写"
    print(f"注册时验证邮箱：{'开启' if email_on else '关闭'}；发信邮箱：{mail_state}")
    if email_on and not mail_ready:
        notes.append("邮箱验证开着，但发信邮箱没有填好：现在不能注册、不能找回密码。填好发信邮箱五项，或 bash scripts/set-env.sh HX_EMAIL_VERIFICATION off")
    print(f"注册时验证手机号：{'开启' if phone_on else '关闭'}；阿里云短信：{sms_state}")
    if phone_on and len(sms) != len(SMS):
        notes.append("手机验证开着，但阿里云短信没有填好：现在不能注册。填好短信四项，或 bash scripts/set-env.sh HX_PHONE_VERIFICATION off")
    print("第三方登录（一家的各项都填好才开启）：")
    for name, keys in PROVIDERS.items():
        filled = [k for k in keys if v.get(k)]
        state = "已开启" if len(filled) == len(keys) else (f"只填了 {len(filled)} / {len(keys)} 项，未开启（还缺 {'、'.join(k for k in keys if not v.get(k))}）" if filled else "未开启")
        print(f"    {name:<10} {state}")
    gen = [k for k in GENERATED if v.get(k)]
    print(f"自动生成的密钥：{len(gen)} / {len(GENERATED)} 项已生成" + ("" if len(gen) == len(GENERATED) else "（运行 bash scripts/init-secrets.sh）"))
    for note in notes:
        print("提醒：" + note)
    if missing:
        print("还没有填写：" + "、".join(missing))
        sys.exit(1)
    print("必须填写的项已全部填好。")


def do_file():
    key, path = os.environ["HXBOT_KEY"], os.environ["HXBOT_FILE"]
    if key not in KEY_FILES:
        fail(f"--file 只用于密钥文件：{'、'.join(sorted(KEY_FILES))}")
    if not os.path.isfile(path):
        fail(f"找不到文件：{path}")
    with open(path, encoding="utf-8", errors="replace") as handle:
        os.environ["HXBOT_VALUE"] = handle.read().replace("\r", "").replace("\n", "\\n")
    do_set()


def do_test():
    v = values(read_lines())
    for k in ("EMAIL_SMTP_HOST", "EMAIL_SMTP_PORT", "EMAIL_SMTP_USERNAME", "EMAIL_SMTP_PASSWORD"):
        if not v.get(k):
            fail(f"{k} 还没有填写")
    if v["EMAIL_SMTP_PORT"] != "465":
        fail(f"SMTP 端口现在是 {v['EMAIL_SMTP_PORT']}。账号服务只能用 465（SSL）发信，请执行：bash scripts/set-env.sh EMAIL_SMTP_PORT 465")
    if not v.get("EMAIL_FROM"):
        fail("EMAIL_FROM 还没有填写")
    host, port, user, pw = v["EMAIL_SMTP_HOST"], 465, v["EMAIL_SMTP_USERNAME"], v["EMAIL_SMTP_PASSWORD"]
    print(f"正在连接 {host}:{port}，用 {user} 登录……")
    try:
        server = smtplib.SMTP_SSL(host, port, timeout=15, context=ssl.create_default_context())
        server.login(user, pw)
        server.quit()
    except smtplib.SMTPAuthenticationError:
        fail("登录失败：账号或密码不对。企业邮箱开启了“三方客户端安全密码”时，要填那个专用密码；"
             "改密码用：bash scripts/set-env.sh --secret EMAIL_SMTP_PASSWORD")
    except (socket.timeout, TimeoutError, ConnectionRefusedError, OSError) as e:
        fail(f"连不上 {host}:{port}（{e}）。检查 SMTP 服务器地址是否正确、邮箱后台是否开启了 SMTP 服务")
    except smtplib.SMTPException as e:
        fail(f"SMTP 出错：{e}")
    print("✔ 发信邮箱登录成功：地址和密码都正确。")


# 阿里云短信返回的常见错误 → 该怎么办（部署文档 5.4 节）
SMS_PROBLEMS = {
    "InvalidAccessKeyId.NotFound": "AccessKey ID 不对。到 RAM 控制台核对后重新填写 HX_SMS_ACCESS_KEY_ID",
    "InvalidAccessKeyId.Inactive": "这个 AccessKey 已被禁用。到 RAM 控制台启用，或新建一个",
    "SignatureDoesNotMatch": "AccessKey Secret 不对。重新执行 bash scripts/set-env.sh --secret HX_SMS_ACCESS_KEY_SECRET",
    "isp.RAM_PERMISSION_DENY": "这个 RAM 用户没有短信权限。到 RAM 控制台给它加上 AliyunDysmsFullAccess",
    "Forbidden.RAM": "这个 RAM 用户没有短信权限。到 RAM 控制台给它加上 AliyunDysmsFullAccess",
    "NoPermission": "这个 RAM 用户没有短信权限。到 RAM 控制台给它加上 AliyunDysmsFullAccess",
    "isv.PRODUCT_UN_SUBSCRIPT": "这个阿里云账号还没有开通短信服务",
    "isv.PRODUCT_UNSUBSCRIBE": "这个阿里云账号还没有开通短信服务",
    "isv.ACCOUNT_NOT_EXISTS": "阿里云账号不存在，核对 AccessKey 是不是这个账号下的",
    "isv.ACCOUNT_ABNORMAL": "阿里云账号状态异常，登录短信服务控制台查看",
    "isv.SMS_SIGNATURE_ILLEGAL": "签名不存在或还没有审核通过。HX_SMS_SIGN_NAME 要与控制台“签名管理”里审核通过的签名名称一字不差（不带【】）",
    "isv.SMS_SIGN_ILLEGAL": "签名不存在或还没有审核通过。HX_SMS_SIGN_NAME 要与控制台“签名管理”里审核通过的签名名称一字不差（不带【】）",
    "isv.SMS_TEMPLATE_ILLEGAL": "模板不存在或还没有审核通过。HX_SMS_TEMPLATE_CODE 填控制台“模板管理”里审核通过的模板 CODE（SMS_ 开头）",
    "isv.SMS_SIGNATURE_SCENE_ILLEGAL": "签名和模板的类型不匹配：模板类型要选“验证码”，签名的适用场景要包含验证码",
    "isv.TEMPLATE_MISSING_PARAMETERS": "模板里的变量名不对。模板里只能有一个变量，名字必须是 code，写成 ${code}",
    "isv.TEMPLATE_PARAMS_ILLEGAL": "模板变量不接受 6 位数字。模板里的变量要写成 ${code}，变量属性选“仅数字”（4～6 位）",
    "isv.INVALID_PARAMETERS": "参数不对。核对签名名称和模板 CODE",
    "isv.MOBILE_NUMBER_ILLEGAL": "手机号格式不对，请填 11 位的中国大陆手机号",
    "isv.BUSINESS_LIMIT_CONTROL": "这个号码收验证码太频繁（同一号码每分钟 1 条、每小时 5 条、每天 10 条）。设置本身没有问题，过一会儿再试或换一个号码",
    "isv.AMOUNT_NOT_ENOUGH": "阿里云账户余额不足，也没有短信套餐包。充值或购买国内短信套餐包",
    "isv.OUT_OF_SERVICE": "阿里云账户欠费停机。充值后再试",
    "isv.SMS_TEST_SIGN_TEMPLATE_LIMIT": "用的是测试专用的签名或模板，只能发给控制台里绑定的测试手机号。请换成自己申请并审核通过的签名和模板",
    "isv.SMS_TEST_NUMBER_LIMIT": "用的是测试专用的签名或模板，只能发给控制台里绑定的测试手机号。请换成自己申请并审核通过的签名和模板",
    "isv.DAY_LIMIT_CONTROL": "已达到控制台设置的每日发送上限。到短信服务控制台调高“发送总量阈值”",
    "isv.SMS_CONTENT_ILLEGAL": "短信内容被判定为不合规，换一个模板重新申请",
    "isv.BLACK_KEY_CONTROL_LIMIT": "模板变量里有被禁止的内容。模板里的变量要写成 ${code}，变量属性选“仅数字”",
}


def aliyun_encode(text):
    return urllib.parse.quote(text, safe="~")


def do_sms():
    """用 .env 里的阿里云短信设置，给一个手机号发一条真实的验证码短信。与账号服务用同一个接口、同样的签名办法。"""
    v = values(read_lines())
    for k in SMS:
        if not v.get(k):
            fail(f"{k}（{LABEL[k]}）还没有填写。四项都填好才能发短信（部署文档 5.4 节）")
    phone = re.sub(r"[\s()-]", "", os.environ.get("HXBOT_VALUE", ""))
    phone = re.sub(r"^(\+|00)86", "", phone)
    if not re.fullmatch(r"1[3-9][0-9]{9}", phone):
        fail("请给出一个能收短信的中国大陆手机号（11 位），例如：bash scripts/set-env.sh --test-sms 13800138000")
    code = "".join(secrets.choice("0123456789") for _ in range(6))
    request = {
        "AccessKeyId": v["HX_SMS_ACCESS_KEY_ID"],
        "Action": "SendSms",
        "Format": "JSON",
        "PhoneNumbers": phone,
        "RegionId": "cn-hangzhou",
        "SignName": v["HX_SMS_SIGN_NAME"],
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": str(uuid.uuid4()),
        "SignatureVersion": "1.0",
        "TemplateCode": v["HX_SMS_TEMPLATE_CODE"],
        "TemplateParam": json.dumps({"code": code}, separators=(",", ":")),
        "Timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "Version": "2017-05-25",
    }
    canonical = "&".join(aliyun_encode(k) + "=" + aliyun_encode(request[k]) for k in sorted(request))
    digest = hmac.new((v["HX_SMS_ACCESS_KEY_SECRET"] + "&").encode("utf-8"), ("POST&%2F&" + aliyun_encode(canonical)).encode("utf-8"), hashlib.sha1).digest()
    request["Signature"] = base64.b64encode(digest).decode("ascii")
    print(f"正在用签名“{v['HX_SMS_SIGN_NAME']}”和模板 {v['HX_SMS_TEMPLATE_CODE']} 给 {phone} 发一条验证码短信……")
    try:
        call = urllib.request.Request("https://dysmsapi.aliyuncs.com/", data=urllib.parse.urlencode(request).encode("utf-8"), method="POST")
        try:
            with urllib.request.urlopen(call, timeout=15) as response:
                body = response.read()
        except urllib.error.HTTPError as error:  # 阿里云在 4xx 的正文里说明原因
            body = error.read()
        answer = json.loads(body.decode("utf-8", "replace"))
    except (urllib.error.URLError, socket.timeout, TimeoutError, OSError, ValueError) as error:
        fail(f"连不上阿里云短信接口 dysmsapi.aliyuncs.com（{error}）。检查服务器能不能访问外网：curl -sI https://dysmsapi.aliyuncs.com | head -1")
    result = str(answer.get("Code", ""))
    if result == "OK":
        print(f"✔ 阿里云已接收。请看这部手机：应在 1 分钟内收到短信，里面的验证码是 {code}。")
        print("  收到了，短信验证码就配好了。迟迟收不到：到短信服务控制台“发送记录”里看这一条的状态（签名刚通过审核时，运营商报备还要几个工作日）。")
        return
    hint = SMS_PROBLEMS.get(result, "按这个错误码到阿里云短信服务的“错误码”文档里查原因")
    fail(f"短信没有发出去。阿里云返回：{result or '（无）'} {answer.get('Message', '')}\n  怎么办：{hint}")


{"set": do_set, "show": do_show, "test": do_test, "file": do_file, "sms": do_sms}[MODE]()
