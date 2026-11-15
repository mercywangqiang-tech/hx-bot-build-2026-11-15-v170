/**
 * HXBot：注册和找回密码的验证码邮件。
 *
 * 用服务器 .env 里的发信邮箱（EMAIL_SMTP_HOST 等五项）发出，走账号服务原有的 SMTP 发信，所以端口只能是 465
 * （SSL）。五项没有填全、或端口不是 465 时视为没有配置发信邮箱。
 *
 * 语言跟着页面走：在中文页面上操作，邮件是中文在前、英文在后的双语；在英文页面（/en/）上操作，邮件只有英文。
 * 页头的长颈鹿标志随邮件一起发出（Content-ID），收件人不用点“显示图片”也看得到。版式只用表格和行内样式，
 * 各家邮箱（网页版、手机、Outlook）显示一致；验证码用等宽数字、分格显示。
 */

import { Effect } from "effect";
import type { RenderedEmail } from "../email-templates";
import { type SmtpEmailConfig, type SmtpInlineImage, sendPrivateEmail } from "../smtp-email-delivery";
import type { HxCodePurpose, HxMailLanguage } from "./config";
import { HX_MAIL_LOGO_PNG_BASE64 } from "./mail-logo";

type Env = Readonly<Record<string, string | undefined>>;

/** The mailbox that sends the codes, or null when the server has none that can send. */
export function hxMailbox(env: Env): SmtpEmailConfig | null {
  const host = env.EMAIL_SMTP_HOST?.trim() ?? "";
  const port = Number(env.EMAIL_SMTP_PORT?.trim() ?? "");
  const username = env.EMAIL_SMTP_USERNAME?.trim() ?? "";
  const password = env.EMAIL_SMTP_PASSWORD ?? "";
  const from = env.EMAIL_FROM?.trim() ?? "";
  if (!host || !username || !password || !from) return null;
  // The sender of `smtp-email-delivery.ts` speaks TLS from the first byte, which is port 465.
  if (port !== 465) return null;
  return { host, port, username, password, from };
}

const SITE = "https://bot.hxallai.com";
const SUPPORT = "bot@hxallai.com";
const LOGO_CID = "hxbot-giraffe@bot.hxallai.com";

/** The giraffe at the top of the email, sent inside the message. */
export const HX_MAIL_LOGO: SmtpInlineImage = {
  cid: LOGO_CID,
  contentType: "image/png",
  filename: "hxbot.png",
  base64: HX_MAIL_LOGO_PNG_BASE64,
};

// Brand colours (the same as the portal): ink, muted text, lines, paper, blue, orange.
const C = {
  ink: "#1F1F1F",
  ink2: "#444746",
  muted: "#5F6368",
  line: "#E1E3E1",
  paper: "#F5F7FA",
  blue: "#0156D3",
  orange: "#EB6100",
  orangeDark: "#B84A00",
  orangePaper: "#FFF6F0",
};
const SANS =
  "-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono','Courier New',monospace";

interface Words {
  lang: string;
  subject: string;
  preheader: string;
  brand: string;
  badge: string;
  title: string;
  lead: string;
  codeCaption: string;
  validity: string;
  safetyTitle: string;
  safety: string[];
  detailsTitle: string;
  details: [label: string, value: string][];
  autoNote: string;
  links: [label: string, href: string][];
  copyright: string;
  research: string;
}

/** 2026-11-12 13:20 in Beijing time. */
function beijing(time: number): string {
  const d = new Date(time + 8 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 12 Nov 2026, 05:20 UTC. */
function utc(time: number): string {
  const d = new Date(time);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function chinese(purpose: HxCodePurpose, email: string, minutes: number, sentAt: number): Words {
  const register = purpose === "register";
  return {
    lang: "zh-CN",
    subject: "HXBot 账号验证码 / HXBot verification code",
    preheader: register
      ? `注册 HXBot 账号的验证码，${minutes} 分钟内有效。`
      : `找回密码的验证码，${minutes} 分钟内有效。`,
    brand: "HXBot",
    badge: "账号安全",
    title: "你的验证码",
    lead: register
      ? "你正在注册 HXBot 账号。请在注册页面输入下面的 6 位验证码，完成邮箱验证。"
      : "你正在找回 HXBot 账号的密码。请在找回密码页面输入下面的 6 位验证码，然后设置新密码。",
    codeCaption: "验证码 · VERIFICATION CODE",
    validity: `${minutes} 分钟内有效 · 只能使用一次`,
    safetyTitle: "安全提醒",
    safety: [
      "弘犀智能的工作人员不会以任何方式向你索要验证码。请不要把它告诉任何人，包括自称客服或工作人员的人。",
      "只在 bot.hxallai.com 的页面上输入验证码。如果有人请你在别处输入或转发验证码，请不要照做。",
      register
        ? "如果这不是你本人的操作，说明有人填了你的邮箱。请忽略这封邮件，不会有账号用你的邮箱注册成功。"
        : "如果这不是你本人的操作，请忽略这封邮件，你的密码不会改变。建议你同时检查邮箱密码是否安全。",
    ],
    detailsTitle: "请求信息",
    details: [
      ["操作", register ? "注册账号" : "找回密码"],
      ["账号", email],
      ["时间", `${beijing(sentAt)}（北京时间）`],
      ["有效期至", `${beijing(sentAt + minutes * 60_000)}（北京时间）`],
    ],
    autoNote: `这封邮件由系统自动发送，请不要直接回复。需要帮助请发邮件至 ${SUPPORT}。`,
    links: [
      ["使用指南", `${SITE}/guide/`],
      ["隐私政策", `${SITE}/privacy/`],
      ["服务条款", `${SITE}/terms/`],
    ],
    copyright: "© 2026 弘犀智能 · bot.hxallai.com",
    research: "HXBot 研究版仅限研究使用，不得用于任何商业用途。",
  };
}

function english(purpose: HxCodePurpose, email: string, minutes: number, sentAt: number): Words {
  const register = purpose === "register";
  const expiry = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return {
    lang: "en",
    subject: "Your HXBot verification code",
    preheader: register
      ? `Your code to create an HXBot Account. It expires in ${expiry}.`
      : `Your code to reset your HXBot password. It expires in ${expiry}.`,
    brand: "HXBot",
    badge: "Account security",
    title: "Your verification code",
    lead: register
      ? "You’re creating an HXBot Account. Enter this 6-digit code on the sign-up page to verify your email address."
      : "You asked to reset the password of your HXBot Account. Enter this 6-digit code on the reset page, then choose a new password.",
    codeCaption: "VERIFICATION CODE",
    validity: `Expires in ${expiry} · Works once`,
    safetyTitle: "Keep your account safe",
    safety: [
      "HX AI will never ask you for this code. Don’t share it with anyone, including people who say they are from HX AI.",
      "Only enter the code on a page at bot.hxallai.com. If anyone asks you to enter it somewhere else or to pass it on, please don’t.",
      register
        ? "If this wasn’t you, someone typed your email address. Ignore this email: no account can be created with it without this code."
        : "If this wasn’t you, ignore this email: your password stays the same. It’s a good time to check that your email password is secure.",
    ],
    detailsTitle: "Request details",
    details: [
      ["Action", register ? "Create an account" : "Reset the password"],
      ["Account", email],
      ["Time", utc(sentAt)],
      ["Expires", utc(sentAt + minutes * 60_000)],
    ],
    autoNote: `This email was sent automatically. Please don’t reply. For help, write to ${SUPPORT}.`,
    links: [
      ["Guide", `${SITE}/en/guide/`],
      ["Privacy Policy", `${SITE}/en/privacy/`],
      ["Terms of Service", `${SITE}/en/terms/`],
    ],
    copyright: "© 2026 HX AI · bot.hxallai.com",
    research: "HXBot Research Edition is for research use only. It must not be used for any commercial purpose.",
  };
}

/** The short English part under the Chinese one. */
function englishSummary(purpose: HxCodePurpose, minutes: number): string {
  const expiry = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return purpose === "register"
    ? `You’re creating an HXBot Account. Enter the 6-digit code above on the sign-up page. It expires in ${expiry} and works once. HX AI will never ask you for this code: don’t share it with anyone. If this wasn’t you, ignore this email.`
    : `You asked to reset the password of your HXBot Account. Enter the 6-digit code above on the reset page. It expires in ${expiry} and works once. HX AI will never ask you for this code: don’t share it with anyone. If this wasn’t you, ignore this email; your password stays the same.`;
}

/** "验证码 · VERIFICATION CODE": the Latin words in small spaced capitals, the Chinese as it is. */
function caption(text: string): string {
  return text
    .split(/([A-Z][A-Z ]+[A-Z])/u)
    .map((part) =>
      /^[A-Z][A-Z ]+[A-Z]$/u.test(part)
        ? `<span style="font-family:${MONO};font-size:11px;letter-spacing:2px;">${escapeHtml(part)}</span>`
        : escapeHtml(part),
    )
    .join("");
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * The code in large digits on the white of the card, with no panel and no boxes (2026-11-12). One piece of
 * text, so a copy gives the six digits. The letter spacing also follows the last digit, so the same space
 * on the left keeps the digits in the middle.
 */
function codeDigits(code: string): string {
  return (
    `<div class="hx-digits" style="font-family:${MONO};font-size:46px;line-height:56px;font-weight:700;letter-spacing:14px;` +
    `padding-left:14px;color:${C.ink};text-align:center;white-space:nowrap;">${escapeHtml(code)}</div>`
  );
}

function html(words: Words, code: string, extra: string): string {
  const safety = words.safety
    .map(
      (line) =>
        `<tr><td valign="top" width="16" style="padding:15px 0 0;"><div style="width:6px;height:6px;border-radius:3px;background:${C.orange};font-size:0;line-height:0;">&nbsp;</div></td>` +
        `<td style="padding:6px 0 0;font-size:14px;line-height:22px;color:${C.ink2};">${escapeHtml(line)}</td></tr>`,
    )
    .join("");
  const details = words.details
    .map(
      ([label, value]) =>
        `<tr><td valign="top" width="96" style="padding:5px 12px 5px 0;font-size:13px;line-height:20px;color:${C.muted};white-space:nowrap;">${escapeHtml(label)}</td>` +
        `<td style="padding:5px 0;font-family:${MONO};font-size:13px;line-height:20px;color:${C.ink};word-break:break-all;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const links = words.links
    .map(([label, href]) => `<a href="${href}" style="color:${C.blue};text-decoration:none;">${escapeHtml(label)}</a>`)
    .join(`<span style="color:#C4C7C5;">&nbsp;&nbsp;·&nbsp;&nbsp;</span>`);
  return `<!doctype html>
<html lang="${words.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(words.subject)}</title>
<style>
@media only screen and (max-width: 520px) {
  .hx-outer { padding: 16px 8px 28px !important; }
  .hx-pad { padding-left: 20px !important; padding-right: 20px !important; }
  .hx-digits { font-size: 38px !important; line-height: 48px !important; letter-spacing: 10px !important; padding-left: 10px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.paper};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.paper};">${escapeHtml(words.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};">
<tr><td class="hx-outer" align="center" style="padding:32px 12px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${SANS};color:${C.ink};">
<tr><td style="background:#FFFFFF;border:1px solid ${C.line};border-radius:20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="hx-pad" style="padding:26px 32px 22px;border-bottom:1px solid ${C.line};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" width="30" style="width:30px;"><img src="cid:${LOGO_CID}" width="26" height="50" alt="" style="display:block;width:26px;height:50px;border:0;"></td>
<td valign="middle" style="padding-left:12px;font-size:19px;line-height:24px;font-weight:600;letter-spacing:.2px;color:${C.ink};">${escapeHtml(words.brand)}</td>
<td valign="middle" align="right"><span style="display:inline-block;padding:5px 11px;border-radius:999px;background:#EEF3FB;font-size:12px;line-height:16px;font-weight:600;color:${C.blue};white-space:nowrap;">${escapeHtml(words.badge)}</span></td>
</tr></table>
</td></tr>
<tr><td class="hx-pad" style="padding:32px 32px 0;">
<h1 style="margin:0;font-size:28px;line-height:36px;font-weight:700;letter-spacing:-.2px;color:${C.ink};">${escapeHtml(words.title)}</h1>
<p style="margin:12px 0 0;font-size:16px;line-height:26px;color:${C.ink2};">${escapeHtml(words.lead)}</p>
</td></tr>
<tr><td class="hx-pad" bgcolor="#FFFFFF" style="padding:28px 32px 4px;background:#FFFFFF;">
<div style="font-size:12px;line-height:16px;color:${C.muted};text-align:center;">${caption(words.codeCaption)}</div>
<div style="margin-top:12px;">${codeDigits(code)}</div>
<div style="margin-top:10px;font-size:13px;line-height:20px;color:${C.muted};text-align:center;">${escapeHtml(words.validity)}</div>
</td></tr>
<tr><td class="hx-pad" style="padding:24px 32px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:${C.orangePaper};border-left:3px solid ${C.orange};border-radius:12px;padding:16px 18px 14px;">
<div style="font-size:15px;line-height:22px;font-weight:700;color:${C.orangeDark};">${escapeHtml(words.safetyTitle)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:2px;">${safety}</table>
</td></tr></table>
</td></tr>
<tr><td class="hx-pad" style="padding:22px 32px 0;">
<div style="font-size:12px;line-height:18px;font-weight:600;letter-spacing:.6px;color:${C.muted};">${escapeHtml(words.detailsTitle)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;border-top:1px solid ${C.line};">${details}</table>
</td></tr>
${extra}
<tr><td class="hx-pad" style="padding:28px 32px 28px;"></td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:22px 24px 0;font-size:12px;line-height:19px;color:${C.muted};">
<div>${escapeHtml(words.autoNote)}</div>
<div style="margin-top:8px;">${links}</div>
<div style="margin-top:8px;">${escapeHtml(words.copyright)}</div>
<div style="margin-top:2px;color:#80868B;">${escapeHtml(words.research)}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function text(words: Words, code: string, extra: string[]): string {
  return [
    words.brand,
    "",
    words.title,
    "",
    words.lead,
    "",
    `    ${code}`,
    "",
    words.validity,
    "",
    `${words.safetyTitle}:`,
    ...words.safety.map((line) => `- ${line}`),
    "",
    `${words.detailsTitle}:`,
    ...words.details.map(([label, value]) => `${label}: ${value}`),
    ...extra,
    "",
    "-- ",
    words.autoNote,
    words.copyright,
    words.research,
  ].join("\r\n");
}

/**
 * The email with a six-digit code. `lang` is the language of the page: Chinese gets Chinese with a short
 * English part after it, English gets English only. `sentAt` is when the code was made (epoch ms).
 */
export function hxCodeEmail(
  code: string,
  purpose: HxCodePurpose,
  minutes: number,
  lang: HxMailLanguage = "zh",
  email = "",
  sentAt = Date.now(),
): RenderedEmail {
  if (lang === "en") {
    const words = english(purpose, email, minutes, sentAt);
    return {
      subject: words.subject,
      preheader: words.preheader,
      text: text(words, code, []),
      html: html(words, code, ""),
    };
  }
  const words = chinese(purpose, email, minutes, sentAt);
  const summary = englishSummary(purpose, minutes);
  const extra = `<tr><td class="hx-pad" style="padding:24px 32px 0;">
<div style="border-top:1px solid ${C.line};padding-top:18px;font-size:12px;line-height:18px;font-weight:600;letter-spacing:.6px;color:${C.muted};">ENGLISH</div>
<p style="margin:6px 0 0;font-size:13px;line-height:21px;color:${C.muted};">${escapeHtml(summary)}</p>
</td></tr>`;
  return {
    subject: words.subject,
    preheader: words.preheader,
    text: text(words, code, ["", "English:", summary]),
    html: html(words, code, extra),
  };
}

/** The sender's name in the inbox: the brand, HXBot, in both languages. */
export const HX_MAIL_SENDER = "HXBot";

/** Sends the code. Rejects when the mailbox refuses or cannot be reached. */
export function hxSendCodeEmail(
  mailbox: SmtpEmailConfig,
  email: string,
  code: string,
  purpose: HxCodePurpose,
  minutes: number,
  lang: HxMailLanguage = "zh",
  sentAt = Date.now(),
): Promise<void> {
  return Effect.runPromise(
    sendPrivateEmail(mailbox, {
      email,
      fromName: HX_MAIL_SENDER,
      content: hxCodeEmail(code, purpose, minutes, lang, email, sentAt),
      inline: [HX_MAIL_LOGO],
    }),
  );
}
