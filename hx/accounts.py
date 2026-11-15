"""注册账号：每个人用邮箱和自己的密码登录，替换原来大家共用的登录口令；可以用第三方账号登录。

功能在 HX 自有文件里（apps/auth-api/src/server/hx-accounts/、迁移 9001_hx_accounts.sql），这里只在上游
文件上开三个口子：
1. auth-service.ts：登录第二步核对的内容交给注册账号模块（这个邮箱自己的密码，或本模块发的一次性票据）；
2. request-auth.ts：每个请求里把模块接上；
   （这两处写在 rebrand.py 的 login_password 步骤里，原因见 server() 里的说明）
3. routes/api/browser/$.ts：/api/browser/hx/ 下的地址交给模块处理。
"""

import base64


def server(r) -> None:
    replace = r.replace
    # auth-service.ts 和 request-auth.ts 里的接入写在 rebrand.py 的 login_password 步骤里：那一步本来就改这几行，
    # 两步各改一次的话，前一步“是否已经改过”的判断会找不到自己写的内容。
    request = "apps/auth-api/src/server/request-auth.ts"
    replace(request, "export function requestAuthService(): AuthService {\n",
            "/** HXBot: registration, passwords and sign-in with other accounts, under /api/browser/hx/. Null for another path. */\n"
            "export function requestHxAccountsResponse(request: Request): Promise<Response | null> {\n"
            "  // The person signed in with the request, for deleting their own account (注销账号, hx/delete_account.py).\n"
            "  return requestHxAccounts(request, accountAnalytics(requireWorkerBindings(env)), (token) =>\n"
            "    Effect.runPromise(\n"
            "      requestAuthService()\n"
            "        .authenticate(token)\n"
            "        .pipe(Effect.catch(() => Effect.succeed(null))),\n"
            "    ),\n"
            "  );\n"
            "}\n\n"
            "export function requestAuthService(): AuthService {\n")

    route = "apps/auth-api/src/routes/api/browser/$.ts"
    replace(route, "  requestHostedSiteService,\n  requestRemoteControlPlane,\n",
            "  requestHostedSiteService,\n  requestHxAccountsResponse,\n  requestRemoteControlPlane,\n")
    replace(route, "function handle({ request }: { request: Request }) {\n  return handleBrowserApi(request, {\n",
            "async function handle({ request }: { request: Request }) {\n"
            "  // HXBot: registration, passwords and sign-in with other accounts (server/hx-accounts).\n"
            "  const hx = await requestHxAccountsResponse(request);\n"
            "  if (hx) return hx;\n"
            "  return handleBrowserApi(request, {\n")


def mail(r) -> None:
    """验证码邮件（hx-accounts/mail.ts）：发件人名称跟邮件的语言走；页头的长颈鹿标志随邮件发出（Content-ID），
    收件人不用点“显示图片”也看得到。上游的发信代码只有纯文本和 HTML 两部分，这里加上 multipart/related。"""
    replace = r.replace
    smtp = "apps/auth-api/src/server/smtp-email-delivery.ts"
    replace(smtp,
            "export interface PreparedEmailMessage {\n"
            "  email: string;\n"
            "  /** The address a reply goes to, when it is not the sender. */\n"
            "  replyTo?: string;\n"
            "  content: RenderedEmail;\n"
            "}\n",
            "export interface PreparedEmailMessage {\n"
            "  email: string;\n"
            "  /** The address a reply goes to, when it is not the sender. */\n"
            "  replyTo?: string;\n"
            "  content: RenderedEmail;\n"
            "  /** HXBot: the sender's name for this message, in its language. Absent: the product name. */\n"
            "  fromName?: string;\n"
            "  /** HXBot: images the HTML shows by `cid:`, sent inside the message so no client has to fetch them. */\n"
            "  inline?: readonly SmtpInlineImage[];\n"
            "}\n\n"
            "/** HXBot: an image inside the message, shown by the HTML as `cid:<cid>`. */\n"
            "export interface SmtpInlineImage {\n"
            "  cid: string;\n"
            "  contentType: \"image/png\" | \"image/jpeg\";\n"
            "  filename: string;\n"
            "  base64: string;\n"
            "}\n")
    # 发件人一行：前面的步骤可能已把上游的 OpenBot 换成了产品名，两种写法都认
    sender_line = "      `From: OpenBot <${from}>`,\n"
    if sender_line not in r.read(smtp):
        sender_line = f"      `From: {r.NAME} <${{from}}>`,\n"
    replace(smtp,
            "function createMimeMessage(from: string, message: PreparedEmailMessage): string {\n"
            "  const boundary = `hxbot-${crypto.randomUUID()}`;\n"
            "  return dotStuff(\n"
            "    [\n"
            + sender_line,
            "function createMimeMessage(from: string, message: PreparedEmailMessage): string {\n"
            "  const boundary = `hxbot-${crypto.randomUUID()}`;\n"
            "  // HXBot: with inline images, the two parts go inside multipart/related and the images follow them.\n"
            "  const images = (message.inline ?? []).filter(\n"
            "    (image) => /^[A-Za-z0-9.@_-]{1,100}$/u.test(image.cid) && /^[A-Za-z0-9._-]{1,60}$/u.test(image.filename),\n"
            "  );\n"
            "  const related = images.length > 0 ? `hxbot-related-${crypto.randomUUID()}` : null;\n"
            f"  const sender = message.fromName ? encodeHeaderValue(message.fromName) : \"=?UTF-8?B?{base64.b64encode(r.NAME.encode()).decode()}?=\";\n"
            "  return dotStuff(\n"
            "    [\n"
            "      `From: ${sender} <${from}>`,\n")
    replace(smtp,
            "      \"MIME-Version: 1.0\",\n"
            "      \"Content-Type: multipart/alternative;\",\n",
            "      \"MIME-Version: 1.0\",\n"
            "      ...(related ? [\"Content-Type: multipart/related;\", ' type=\"multipart/alternative\";', ` boundary=\"${related}\"`, \"\", `--${related}`] : []),\n"
            "      \"Content-Type: multipart/alternative;\",\n")
    replace(smtp,
            "      encodeQuotedPrintable(message.content.html),\n"
            "      `--${boundary}--`,\n"
            "    ].join(\"\\r\\n\"),\n",
            "      encodeQuotedPrintable(message.content.html),\n"
            "      `--${boundary}--`,\n"
            "      ...images.flatMap((image) => [\n"
            "        `--${related}`,\n"
            "        `Content-Type: ${image.contentType}; name=\"${image.filename}\"`,\n"
            "        \"Content-Transfer-Encoding: base64\",\n"
            "        `Content-ID: <${image.cid}>`,\n"
            "        `Content-Disposition: inline; filename=\"${image.filename}\"`,\n"
            "        \"\",\n"
            "        ...(image.base64.replace(/[^A-Za-z0-9+/=]/gu, \"\").match(/.{1,76}/gu) ?? []),\n"
            "      ]),\n"
            "      ...(related ? [`--${related}--`] : []),\n"
            "    ].join(\"\\r\\n\"),\n")


def accounts(r) -> None:
    server(r)
    mail(r)
