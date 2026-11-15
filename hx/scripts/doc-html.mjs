#!/usr/bin/env node
// 把 hx/docs 里的 Markdown 文档生成可离线打开、可打印的单文件 HTML（样式、字体、标志全部内嵌）。
// 版式与官网《部署手册》一致。Markdown 是唯一来源：改内容请改 .md，再执行本脚本。零依赖，Node.js ≥ 18。
// 用法：node hx/scripts/doc-html.mjs                       → hx/docs/部署文档.html
//       node hx/scripts/doc-html.mjs <输入.md> [输出.html]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IN = path.resolve(process.argv[2] || path.join(HX, "docs", "部署文档.md"));
const OUT = path.resolve(process.argv[3] || IN.replace(/\.md$/i, ".html"));
const md = fs.readFileSync(IN, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
const b64 = (p) => fs.readFileSync(path.join(HX, "docs", "assets", p)).toString("base64");
const FONT = `data:font/woff2;base64,${b64("google-sans-flex-latin.woff2")}`;
const LOGO = `data:image/svg+xml;base64,${b64("logo-zh.svg")}`;
const FAVICON = `data:image/svg+xml;base64,${b64("favicon.svg")}`;
const SUPPORT = "bot@hxallai.com";
const DOC = path.basename(IN, ".md");

// 每份文档首屏的“操作流程”卡片：标题、命令、说明、跳到哪一节。没有登记的文档不显示卡片。
const FLOWS = {
  部署文档: [
    {
      t: "域名与端口",
      c: "bot / api.bot / signal.bot / turn.bot",
      d: "加 4 条子域名解析，安全组放行中继端口",
      s: "s1",
    },
    { t: "安装 Docker", c: "docker compose version", d: "安装 Docker 并配置国内镜像加速", s: "s3" },
    {
      t: "配置与密钥",
      c: "bash scripts/set-env.sh 变量名 值",
      d: "逐条命令填写公网 IP、发信邮箱和短信，再自动生成密钥",
      s: "s5",
    },
    { t: "配置 HTTPS", c: "bash scripts/setup-https.sh 邮箱", d: "申请免费证书、放上 nginx 配置、自动续期", s: "s6" },
    { t: "启动服务", c: "docker compose up -d --build", d: "构建并启动账号、信令、中继三个服务", s: "s8" },
    { t: "全面检查", c: "bash scripts/check.sh", d: "逐项检查域名、证书、服务与下载目录", s: "s9" },
  ],
};
const CHIPS = {
  部署文档: [
    "服务器：阿里云 ECS（与官网同一台）",
    "域名：**bot.hxallai.com** 等 4 个子域名（无需另行备案）",
    "运行方式：Docker",
    "证书：Let's Encrypt（自动续期）",
  ],
};

// ---------- inline markdown ----------
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const wbr = (u) => ((x) => (x ? x[1] + x[2].replace(/([/?#])/g, "$1<wbr>") : u))(u.match(/^(https?:\/\/[^/]+)(.*)$/));
function inline(s) {
  // 先把行内代码取出来换成占位符，其余文字再处理加粗和链接，最后放回代码：这样加粗的一段里可以含有行内代码
  const codes = [];
  const text = s.replace(/`[^`]+`/g, (m) => {
    codes.push(m.slice(1, -1));
    return `\uE000${codes.length - 1}\uE000`;
  });
  return (
    esc(text)
      // 《新功能说明》的标记：{HOT} {NEW} 是亮点的角标，{on:桌面端} 是这条亮点能在哪些端用
      .replace(/\{(HOT|NEW)\}\s*/g, (_m, t) => `<span class="tag tag--${t.toLowerCase()}">${t}</span> `)
      .replace(/\s*\{on:([^{}]+)\}/g, (_m, w) => ` <span class="on">${w.trim()}</span>`)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        (_m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`,
      )
      .replace(
        /(^|[\s（(：])(https?:\/\/[^\s<\uE000）)，。；、]+)/g,
        (_m, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noopener">${wbr(u)}</a>`,
      )
      .replace(new RegExp(SUPPORT.replace(/\./g, "\\."), "g"), `<a href="mailto:${SUPPORT}">${SUPPORT}</a>`)
      .replace(/\uE000(\d+)\uE000/g, (_m, n) => {
        const code = codes[Number(n)];
        return /^https?:\/\/\S+$/.test(code)
          ? `<a href="${esc(code)}" target="_blank" rel="noopener"><code>${esc(code)}</code></a>`
          : `<code>${esc(code)}</code>`;
      })
  );
}

// ---------- block markdown ----------
const lines = md.split("\n");
let title = "";
const intro = [],
  sections = [];
let cur = null,
  para = [];
const push = (html) => (cur ? cur.body : intro).push(html);
const flushPara = () => {
  if (para.length) {
    push(`<p>${inline(para.join(""))}</p>`);
    para = [];
  }
};

function codeBlock(lang, text) {
  const label = lang === "bash" || lang === "sh" ? "终端命令" : lang === "text" ? "屏幕输出示例" : "文本";
  const body = esc(text)
    .split("\n")
    .map((l) => {
      if (label !== "终端命令") return l;
      const i = l.search(/(^|\s)#\s/);
      return i < 0 ? l : `${l.slice(0, i)}<span class="c">${l.slice(i)}</span>`;
    })
    .join("\n");
  return `<div class="code${label === "终端命令" ? "" : " code--tree"}"><div class="code__bar"><span>${label}</span><button class="copy" type="button" data-copy aria-label="复制${label}">复制</button></div><pre><code>${body}</code></pre></div>`;
}
function table(rows) {
  const cells = (r) =>
    r
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const head = cells(rows[0]),
    body = rows.slice(2).map(cells);
  const narrow = head.length <= 2;
  return `<div class="tbl tbl--stack${narrow ? " tbl--2" : ""}"><table><thead><tr>${head.map((h) => `<th scope="col">${inline(h)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${inline(c)}</th>` : `<td data-label="${esc(head[i] || "")}">${inline(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
}
// 一行只有一张图片：![说明](相对这份 .md 的路径)。图片内嵌进网页，单文件离线也能看
function figure(line) {
  const [, alt, src] = line.match(/^!\[([^\]]*)\]\((\S+?)\)\s*$/);
  const file = path.resolve(path.dirname(IN), src);
  if (!fs.existsSync(file)) throw new Error(`找不到图片：${src}`);
  const type = /\.png$/i.test(file) ? "image/png" : /\.jpe?g$/i.test(file) ? "image/jpeg" : null;
  if (!type) throw new Error(`只支持 PNG 和 JPEG 图片：${src}`);
  const data = fs.readFileSync(file).toString("base64");
  return `<figure class="fig"><img src="data:${type};base64,${data}" alt="${esc(alt)}"></figure>`;
}
function quote(qs) {
  const text = qs.map((l) => l.replace(/^>\s?/, ""));
  const paras = text
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, ""))
    .filter(Boolean);
  const warn = /^⚠/.test(paras[0] || "") || /不得|不要|必须/.test(paras.join(""));
  return `<aside class="note${warn ? " note--warn" : ""}">${paras.map((p) => `<p>${inline(p.replace(/^⚠\s*/, ""))}</p>`).join("")}</aside>`;
}

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^```/.test(l)) {
    flushPara();
    const lang = l.slice(3).trim(),
      buf = [];
    while (++i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i]);
    push(codeBlock(lang, buf.join("\n")));
  } else if (/^# /.test(l)) {
    flushPara();
    title = l.slice(2).trim();
  } else if (/^## /.test(l)) {
    flushPara();
    const t = l.slice(3).trim(),
      m = t.match(/^(\d+)\.\s*(.+)$/);
    // 附录 A、附录 B 各有自己的编号（appendix-a、appendix-b）；只有一个不带字母的附录时是 appendix
    const ap = t.match(/^附录\s*([A-Z])?/);
    const id = m ? `s${m[1]}` : ap ? (ap[1] ? `appendix-${ap[1].toLowerCase()}` : "appendix") : `s-${sections.length}`;
    cur = { id, num: m ? m[1] : "", title: m ? m[2] : t, body: [], subs: [] };
    sections.push(cur);
  } else if (/^### /.test(l) && cur) {
    flushPara();
    const t = l.slice(4).trim(),
      id = `${cur.id}-${cur.subs.length + 1}`;
    cur.subs.push({ id, title: t });
    push(`<h3 id="${id}">${inline(t)}</h3>`);
  } else if (/^---\s*$/.test(l)) {
    flushPara();
  } else if (/^>/.test(l)) {
    flushPara();
    const buf = [l];
    while (i + 1 < lines.length && /^>/.test(lines[i + 1])) buf.push(lines[++i]);
    push(quote(buf));
  } else if (/^!\[[^\]]*\]\(\S+\)\s*$/.test(l)) {
    flushPara();
    push(figure(l));
  } else if (/^\|/.test(l)) {
    flushPara();
    const buf = [l];
    while (i + 1 < lines.length && /^\|/.test(lines[i + 1])) buf.push(lines[++i]);
    push(table(buf));
  } else if (/^(\d+\.|-)\s/.test(l)) {
    flushPara();
    const ordered = /^\d+\./.test(l),
      buf = [l];
    while (i + 1 < lines.length && (ordered ? /^\d+\.\s/ : /^-\s/).test(lines[i + 1])) buf.push(lines[++i]);
    const tag = ordered ? "ol" : "ul";
    push(`<${tag}>${buf.map((x) => `<li>${inline(x.replace(/^(\d+\.|-)\s+/, ""))}</li>`).join("")}</${tag}>`);
  } else if (!l.trim()) {
    flushPara();
  } else para.push(l.trim());
}
flushPara();

// 首段作为导语，其余开篇内容放在导语下方的概览区。
const leadIdx = intro.findIndex((x) => x.startsWith("<p>"));
const lead = leadIdx >= 0 ? intro.splice(leadIdx, 1)[0].replace(/^<p>|<\/p>$/g, "") : "";
const flow = FLOWS[DOC] || [];
const chips = CHIPS[DOC] || [];
const now = new Date(),
  y = now.getFullYear(),
  mo = now.getMonth() + 1,
  d = now.getDate();
const dateStr = `${y} 年 ${mo} 月 ${d} 日`;
// 顶栏写文档名：“HXBot v1.6.6 · 服务器构建文档”取“·”后面；“新功能与亮点（桌面端 0.67.5 · 手机端 1.5.0）”去掉括号里的版本。
const barTitle =
  (/^HXBot\b[^·（(]*·\s*(.+)$/u.exec(title)?.[1] ?? title.replace(/\s*[（(][^）)]*[）)]\s*$/u, ""))
    .replace(/^HXBot\s+v[\d.]+\s*/u, "")
    .trim() || title;

const css = `
@font-face { font-family: "Google Sans Flex"; font-weight: 400 600; font-display: swap; src: url("${FONT}") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-2013, U+2015-2017, U+201A-201B, U+201E-2025, U+2027-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
:root { --ink: #1F1F1F; --ink2: #444746; --ink3: #5F6368; --line: #E1E3E1; --line2: #C4C7C5; --bg: #FFFFFF; --s1: #F8FAFD; --s2: #F0F4F9; --s3: #E9EEF6;
  --blue: #0156D3; --blue-d: #014AB6; --blue-c: #D3E3FD; --blue-cl: #E8F0FE; --navy: #041E49; --or: #EB6100; --or-c: #FFF1E8;
  --sans: "Google Sans Flex", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", system-ui, sans-serif;
  --mono: "Roboto Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 80px; -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 16px/1.75 var(--sans); -webkit-font-smoothing: antialiased; font-optical-sizing: auto; }
a { color: var(--blue); text-decoration: none; } a:hover { text-decoration: underline; }
code { font-family: var(--mono); font-size: .88em; background: var(--s2); color: var(--navy); padding: .12em .45em; border-radius: 6px; word-break: break-word; }
strong { font-weight: 600; }
.bar { position: sticky; top: 0; z-index: 20; height: 64px; background: rgba(255,255,255,.96); backdrop-filter: saturate(160%) blur(12px); -webkit-backdrop-filter: saturate(160%) blur(12px); transition: box-shadow .2s; }
.bar.is-scrolled { box-shadow: 0 1px 2px rgba(60,64,67,.3), 0 2px 6px 2px rgba(60,64,67,.15); }
.bar__in { max-width: 1280px; height: 100%; margin: 0 auto; padding: 0 24px; display: flex; align-items: center; gap: 16px; }
.bar img { height: 28px; width: auto; display: block; }
.bar__t { font-size: 15px; font-weight: 500; color: var(--ink2); padding-left: 16px; border-left: 1px solid var(--line); white-space: nowrap; }
.bar__act { margin-left: auto; display: flex; gap: 8px; }
.btn { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 20px; border-radius: 999px; border: 1px solid var(--line2); background: #fff; color: var(--blue); font: 500 14px/1 var(--sans); cursor: pointer; text-decoration: none !important; }
.btn:hover { background: var(--blue-cl); }
.btn--p { background: var(--blue); border-color: var(--blue); color: #fff; } .btn--p:hover { background: var(--blue-d); }
.btn svg { width: 18px; height: 18px; }
.hero { max-width: 1280px; margin: 0 auto; padding: 56px 24px 32px; text-align: center; }
.eyebrow { font-size: 14px; font-weight: 500; color: var(--blue); letter-spacing: .1px; }
h1 { margin: 12px auto 16px; max-width: 900px; font-weight: 400; font-size: clamp(30px, 4.2vw, 46px); line-height: 1.25; word-break: keep-all; overflow-wrap: anywhere; }
.lead { max-width: 820px; margin: 0 auto; font-size: 18px; color: var(--ink2); }
.chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 24px; }
.chip { font-size: 14px; line-height: 20px; padding: 6px 16px; border-radius: 999px; background: var(--s2); color: var(--ink2); }
.chip strong { color: var(--ink); font-weight: 500; }
.flow { max-width: 1232px; margin: 40px auto 0; display: grid; gap: 12px; text-align: left; }
@media (min-width: 720px) { .flow { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1100px) { .flow { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; } }
.step { display: block; padding: 24px; border-radius: 24px; background: var(--s2); color: var(--ink); text-decoration: none !important; transition: background-color .2s; }
.step:hover { background: var(--s3); }
.step__n { display: inline-flex; width: 32px; height: 32px; border-radius: 50%; align-items: center; justify-content: center; background: var(--blue); color: #fff; font-weight: 500; font-size: 15px; }
.step:last-child .step__n { background: var(--or); }
.step b { display: block; margin: 12px 0 8px; font-size: 20px; font-weight: 400; }
.step code { display: block; background: #fff; padding: 8px 12px; border-radius: 12px; font-size: 13px; color: var(--navy); }
.step small { display: block; margin-top: 10px; font-size: 14px; line-height: 1.6; color: var(--ink2); }
.overview { max-width: 880px; margin: 40px auto 0; text-align: left; }
.overview p { margin: 0 0 12px; color: var(--ink2); }
.overview p strong { color: var(--ink); }
.layout { max-width: 1280px; margin: 0 auto; padding: 40px 24px 80px; display: grid; gap: 48px; }
@media (min-width: 1100px) { .layout { grid-template-columns: 248px minmax(0, 1fr); gap: 64px; } }
.toc { display: none; }
@media (min-width: 1100px) { .toc { display: block; position: sticky; top: 88px; align-self: start; max-height: calc(100vh - 110px); overflow: auto; } }
.toc b { display: block; font-size: 12px; font-weight: 500; letter-spacing: .5px; color: var(--ink3); margin: 0 0 8px 16px; }
.toc a { display: flex; gap: 10px; padding: 8px 16px; border-radius: 999px; font-size: 14px; line-height: 20px; color: var(--ink2); text-decoration: none; }
.toc a:hover { background: var(--s2); color: var(--ink); }
.toc a.on { background: var(--blue-c); color: var(--navy); font-weight: 500; }
.toc a i { font-style: normal; min-width: 16px; color: var(--ink3); font-variant-numeric: tabular-nums; }
.toc a.on i { color: var(--navy); }
.toc a.sub { padding: 4px 16px 4px 42px; font-size: 13px; color: var(--ink3); }
main { min-width: 0; max-width: 880px; }
section { padding-top: 8px; margin-bottom: 56px; }
h2 { display: flex; align-items: center; gap: 14px; margin: 0 0 20px; font-weight: 400; font-size: clamp(24px, 2.6vw, 30px); line-height: 1.3; }
h2 .n { flex: none; display: inline-flex; width: 40px; height: 40px; border-radius: 50%; align-items: center; justify-content: center; background: var(--blue-c); color: var(--navy); font-size: 17px; font-weight: 500; font-variant-numeric: tabular-nums; }
h3 { margin: 28px 0 12px; font-size: 19px; font-weight: 500; line-height: 1.4; color: var(--ink); }
main p { margin: 0 0 16px; color: var(--ink2); }
main p strong { color: var(--ink); }
main ol, main ul { margin: 0 0 20px; padding-left: 1.4em; color: var(--ink2); }
main li { margin: 6px 0; padding-left: 4px; }
main li::marker { color: var(--blue); font-weight: 500; }
.tbl { overflow-x: auto; margin: 0 0 20px; border: 1px solid var(--line); border-radius: 16px; -webkit-overflow-scrolling: touch; }
table { width: 100%; border-collapse: collapse; font-size: 15px; line-height: 1.6; min-width: 560px; }
th, td { padding: 12px 16px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); }
thead th { background: var(--s1); font-size: 13px; font-weight: 500; color: var(--ink3); white-space: nowrap; }
tbody th { font-weight: 500; color: var(--ink); white-space: nowrap; }
tbody td { color: var(--ink2); }
td a { overflow-wrap: anywhere; }
tbody tr:last-child > * { border-bottom: 0; }
tbody tr:hover { background: var(--s1); }
.tbl--2 table { min-width: 0; }
.tbl--2 tbody th { white-space: normal; width: 38%; }
@media (max-width: 720px) {
  .tbl--stack { border: 0; border-radius: 0; overflow: visible; }
  .tbl--stack table { min-width: 0; }
  .tbl--stack thead { display: none; }
  .tbl--stack tbody, .tbl--stack tr, .tbl--stack th, .tbl--stack td { display: block; width: auto; }
  .tbl--stack tr { margin: 0 0 10px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 16px; background: #fff; }
  .tbl--stack tbody tr:hover { background: #fff; }
  .tbl--stack tbody th { padding: 0 0 6px; border: 0; white-space: normal; font-size: 15px; }
  .tbl--stack td { padding: 6px 0 0; border: 0; font-size: 14px; }
  .tbl--stack td::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 500; color: var(--ink3); }
}
.note { margin: 0 0 20px; padding: 16px 20px; border-radius: 16px; background: var(--blue-cl); color: var(--navy); }
.fig { margin: 0 0 20px; } .fig img { display: block; width: 100%; height: auto; border-radius: 14px; border: 1px solid var(--line); }
.tag { display: inline-block; padding: 0 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700; line-height: 20px; letter-spacing: .06em; color: #fff; vertical-align: 1px; }
.tag--hot { background: var(--or); } .tag--new { background: var(--blue); }
.on { display: inline-block; margin-left: 4px; padding: 0 8px; border-radius: 999px; font-size: 12px; line-height: 20px; color: var(--ink2); background: var(--s3); white-space: nowrap; }
.note p { margin: 0; color: inherit; } .note p + p { margin-top: 8px; }
.note strong { color: inherit; }
.note--warn { background: var(--or-c); color: #5A2400; }
.note--warn::before { content: "注意"; display: inline-block; margin-bottom: 6px; font-size: 12px; font-weight: 500; line-height: 16px; padding: 2px 10px; border-radius: 999px; background: var(--or); color: #fff; }
.note--warn code { background: rgba(255,255,255,.7); color: #5A2400; }
.code { margin: 0 0 20px; border-radius: 16px; background: var(--s2); overflow: hidden; }
.code__bar { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 0 20px; font-size: 12px; font-weight: 500; letter-spacing: .5px; color: var(--ink3); }
.copy { height: 32px; padding: 0 14px; border: 0; border-radius: 999px; background: #fff; color: var(--blue); font: 500 13px/1 var(--sans); cursor: pointer; }
.copy:hover { background: var(--blue-cl); }
.copy.ok { background: var(--blue); color: #fff; }
pre { margin: 0; padding: 12px 20px 18px; overflow-x: auto; }
pre code { display: block; padding: 0; background: none; color: var(--ink); font-size: 14px; line-height: 1.75; white-space: pre; word-break: normal; }
.code--tree pre code { font-size: 13px; line-height: 1.7; }
.c { color: var(--ink3); }
.foot { border-top: 1px solid var(--line); background: var(--s1); color: var(--ink3); font-size: 13px; }
.foot div { max-width: 1280px; margin: 0 auto; padding: 24px; display: flex; flex-wrap: wrap; gap: 8px 24px; justify-content: space-between; }
:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; border-radius: 6px; }
@media (max-width: 599px) { .bar__t { display: none; } .btn span { display: none; } .btn { padding: 0 12px; } .hero { padding-top: 40px; } }
@media print {
  @page { size: A4; margin: 14mm 14mm 16mm; }
  body { font-size: 11pt; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  p:has(+ .tbl), p:has(+ .code) { break-after: avoid; }
  .bar, .toc, .copy, .bar__act { display: none !important; }
  table { min-width: 0; }
  .hero { padding: 0 0 12pt; } .layout { display: block; padding: 0; } main { max-width: none; }
  .flow { grid-template-columns: repeat(3, 1fr); gap: 6pt; } .step { padding: 10pt; border-radius: 10pt; }
  section { margin-bottom: 18pt; } h2, h3 { break-after: avoid; }
  .tbl, .code, .note, tr { break-inside: avoid; }
  pre code { white-space: pre-wrap; word-break: break-all; }
  a { color: inherit; }
}`;

const js = `
(function () {
  var bar = document.querySelector('.bar');
  function onScroll() { bar.classList.toggle('is-scrolled', window.scrollY > 4); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  document.getElementById('print').addEventListener('click', function () { window.print(); });
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    return new Promise(function (ok, no) {
      var a = document.createElement('textarea'); a.value = t; a.setAttribute('readonly', ''); a.style.position = 'fixed'; a.style.opacity = '0';
      document.body.appendChild(a); a.select();
      try { document.execCommand('copy') ? ok() : no(); } catch (e) { no(e); } document.body.removeChild(a);
    });
  }
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var code = b.closest('.code').querySelector('pre').innerText.replace(/\\n+$/, '');
      copyText(code).then(function () { b.textContent = '已复制'; b.classList.add('ok'); setTimeout(function () { b.textContent = '复制'; b.classList.remove('ok'); }, 1600); },
        function () { b.textContent = '请手动复制'; });
    });
  });
  var links = [].slice.call(document.querySelectorAll('.toc a:not(.sub)'));
  if ('IntersectionObserver' in window && links.length) {
    var map = {}; links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { links.forEach(function (a) { a.classList.remove('on'); }); var a = map[e.target.id]; if (a) a.classList.add('on'); } });
    }, { rootMargin: '-80px 0px -70% 0px' });
    document.querySelectorAll('main section').forEach(function (s) { io.observe(s); });
  }
})();`;

const ICON_MAIL =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4zM4 7l8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const ICON_PRINT =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const MAILTO = `mailto:${SUPPORT}?subject=${encodeURIComponent("HXBot 安装与部署支持")}`;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(lead.replace(/<[^>]+>/g, "").slice(0, 120))}">
<link rel="icon" href="${FAVICON}">
<style>${css}</style>
</head>
<body>
<header class="bar"><div class="bar__in">
  <img src="${LOGO}" alt="弘犀智能" width="116" height="28">
  <span class="bar__t">HXBot · ${esc(barTitle)}</span>
  <div class="bar__act">
    <a class="btn" href="${MAILTO}" aria-label="发邮件咨询安装与部署支持">${ICON_MAIL}<span>部署支持</span></a>
    <button class="btn btn--p" id="print" type="button" aria-label="打印或另存为 PDF">${ICON_PRINT}<span>打印 / 存为 PDF</span></button>
  </div>
</div></header>
<div class="hero">
  <div class="eyebrow">HXBot · ${esc(barTitle)} · ${dateStr}</div>
  <h1>${esc(title)}</h1>
  ${lead ? `<p class="lead">${lead}</p>` : ""}
  ${chips.length ? `<div class="chips">${chips.map((c) => `<span class="chip">${inline(c)}</span>`).join("")}</div>` : ""}
  ${flow.length ? `<div class="flow">${flow.map((s, i) => `<a class="step" href="#${s.s}"><span class="step__n">${i + 1}</span><b>${esc(s.t)}</b><code>${esc(s.c)}</code><small>${esc(s.d)}</small></a>`).join("")}</div>` : ""}
  ${intro.length ? `<div class="overview">${intro.join("\n")}</div>` : ""}
</div>
<div class="layout">
  <nav class="toc" aria-label="目录"><b>目录</b>${sections.map((s) => `<a href="#${s.id}"><i>${esc(s.num)}</i>${esc(s.title)}</a>${s.subs.map((u) => `<a class="sub" href="#${u.id}">${esc(u.title)}</a>`).join("")}`).join("")}</nav>
  <main>
${sections
  .map(
    (s) => `    <section id="${s.id}">
      <h2>${s.num !== "" ? `<span class="n">${esc(s.num)}</span>` : ""}${esc(s.title)}</h2>
      ${s.body.join("\n      ")}
    </section>`,
  )
  .join("\n")}
  </main>
</div>
<footer class="foot"><div><span>© ${y} 弘犀智能 · 安装与部署支持：<a href="${MAILTO}">${SUPPORT}</a></span><span>由 ${esc(path.basename(IN))} 生成 · ${dateStr}</span></div></footer>
<script>${js}</script>
</body>
</html>
`;
for (const s of flow) if (!sections.some((x) => x.id === s.s)) throw new Error(`流程卡片指向的章节不存在：#${s.s}`);
fs.writeFileSync(OUT, html);
console.log(
  `✔ 已生成：${path.relative(process.cwd(), OUT) || OUT}（${(Buffer.byteLength(html) / 1024).toFixed(0)} KB，${sections.length} 节）`,
);
