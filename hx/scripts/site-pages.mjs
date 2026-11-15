#!/usr/bin/env node
// 生成 bot.hxallai.com 上的《使用指南》《新功能与亮点》《服务条款》《隐私政策》静态页（中文与英文各一份）。
// 来源：hx/docs/site/<页面>.<zh|en>.md（唯一来源：改内容请改 Markdown，再执行本脚本）。
// 输出：hx/server/portal/pages/<页面>.html（中文）与 <页面>.en.html（英文），由 nginx 以
//       /guide/、/whats-new/、/terms/、/privacy/ 及 /en/ 下的同名地址提供（见 nginx/hxbot.conf）。
// 版式与门户首页一致：白色背景、HX BOT 长颈鹿标志（从 portal/index.html 读取）、中英文切换。
// 中文页会按上次的语言选择或浏览器语言自动转到英文页，并保留 # 后的章节位置。
// 零依赖，Node.js ≥ 18。
//   node hx/scripts/site-pages.mjs          生成
//   node hx/scripts/site-pages.mjs --check  只检查：生成结果与仓库里的页面一致，且内容通过检查
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(HX, "docs", "site");
const OUT = path.join(HX, "server", "portal", "pages");
const PORTAL = path.join(HX, "server", "portal", "index.html");
// 页面里的图片放在 server/portal/assets/ 下，nginx 以 /hx-portal/ 提供（与门户首页的资源一样）
const ASSETS = path.join(HX, "server", "portal", "assets");
const ASSET_URL = "/hx-portal/";
const ORIGIN = "https://bot.hxallai.com";
const ICP = "粤ICP备2026163032号";
const LICENSE = "https://polyformproject.org/licenses/noncommercial/1.0.0/";
// whats-new：每个版本的新功能与亮点，一版一节、新的在前，版本依次叠加（v1.6.4 起）
const PAGES = ["guide", "whats-new", "terms", "privacy"];
const CHECK = process.argv.includes("--check");

const UI = {
  zh: {
    htmlLang: "zh-CN",
    brand: "HXBot",
    toc: "目录",
    otherLang: "English",
    copy: "© 2026 弘犀智能",
    nav: { guide: "使用指南", "whats-new": "新功能", terms: "服务条款", privacy: "隐私政策" },
    license: "许可协议",
    home: "门户首页",
    effective: "生效日期",
    updated: "更新日期",
    version: "版本",
    top: "返回顶部",
    skip: "跳到正文",
    siteName: "HXBot",
  },
  en: {
    htmlLang: "en",
    brand: "HXBot",
    toc: "Contents",
    otherLang: "中文",
    copy: "© 2026 HX AI",
    nav: { guide: "Guide", "whats-new": "What's new", terms: "Terms", privacy: "Privacy" },
    license: "License",
    home: "Portal",
    effective: "Effective",
    updated: "Last updated",
    version: "Version",
    top: "Back to top",
    skip: "Skip to content",
    siteName: "HXBot",
  },
};
const pagePath = (name, lang) => (lang === "en" ? `/en/${name}/` : `/${name}/`);

// ---------- inline markdown ----------
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const href = (url) => (url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) || "/" : url);
const external = (url) => /^https?:\/\//.test(href(url));
function anchor(url, text) {
  const target = href(url);
  const attrs = external(url) ? ' target="_blank" rel="noopener"' : "";
  return `<a href="${esc(target)}"${attrs}>${text}</a>`;
}
function inline(source) {
  const tokens = [];
  const hold = (html) => `\uE000${tokens.push(html) - 1}\uE000`;
  let s = source.replace(/`([^`]+)`/g, (_m, code) =>
    hold(
      /^https?:\/\/\S+$/.test(code) && !code.includes("…")
        ? anchor(code, `<code>${esc(code)}</code>`)
        : `<code>${esc(code)}</code>`,
    ),
  );
  // {HOT} {NEW}：亮点的标记（新功能页全页各只有一个）；{on:桌面端}：这条亮点能在哪些端用
  s = s.replace(/\{(HOT|NEW)\}\s*/g, (_m, tag) => hold(`<span class="tag tag--${tag.toLowerCase()}">${tag}</span> `));
  s = s.replace(/\s*\{on:([^{}]+)\}/g, (_m, where) => hold(` <span class="on">${esc(where.trim())}</span>`));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, text, url) => hold(anchor(url, esc(text))));
  s = s.replace(/https?:\/\/[^\s<>（）()，。；、：“”"'】]+/g, (url) => {
    const trail = (url.match(/[.,;:!?]+$/) || [""])[0];
    const clean = url.slice(0, url.length - trail.length);
    return hold(anchor(clean, esc(clean))) + trail;
  });
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (mail) =>
    hold(`<a href="mailto:${mail}">${mail}</a>`),
  );
  s = esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return s.replace(/\uE000(\d+)\uE000/g, (_m, i) => tokens[Number(i)]);
}

// ---------- block markdown ----------
const LIST = /^(\s*)(- |(\d+)\. )(.*)$/;
const indentOf = (line) => line.match(/^\s*/)[0].length;
const IMAGE = /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)\s*$/;
const startsBlock = (line) => /^(```|#{2,3} |> ?|\|)/.test(line) || LIST.test(line) || IMAGE.test(line);

// 图片的宽高（写进 <img>，加载时版面不跳动）：PNG 读 IHDR，JPEG 读 SOF
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) throw new Error(`${file}：JPEG 格式有误`);
      const marker = b[i + 1];
      const length = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + length;
    }
  }
  throw new Error(`${file}：只支持 PNG 和 JPEG 图片`);
}

// 一行只有一张图片：![说明](/hx-portal/路径 "图注")。图片必须在 server/portal/assets/ 里
function figure(line, ctx) {
  const [, alt, src, caption] = line.match(IMAGE);
  if (!src.startsWith(ASSET_URL)) throw new Error(`图片地址要以 ${ASSET_URL} 开头：${line}`);
  const file = path.join(ASSETS, src.slice(ASSET_URL.length));
  if (!fs.existsSync(file)) throw new Error(`找不到图片：server/portal/assets/${src.slice(ASSET_URL.length)}`);
  if (!alt.trim()) throw new Error(`图片缺少说明文字：${line}`);
  ctx.images.push(src);
  const { width, height } = imageSize(file);
  // 截图按 2 倍左右的像素做，页面上按正文宽度显示
  return (
    // 点图片在新标签页打开原图（手机上看清截图里的字）
    `<figure class="shot"><a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="${esc(alt)}" width="${width}" height="${height}" loading="lazy" decoding="async"></a>` +
    `${caption ? `<figcaption>${inline(caption)}</figcaption>` : ""}</figure>`
  );
}

function parseList(lines, i, indent, out) {
  const first = lines[i].match(LIST);
  const ordered = Boolean(first[3]);
  const items = [];
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(LIST);
    if (!m) {
      if (line.trim() && indentOf(line) > indent && items.length) {
        items.at(-1).text += ` ${line.trim()}`;
        i++;
        continue;
      }
      break;
    }
    const level = m[1].length;
    if (level < indent) break;
    if (level > indent) {
      if (!items.length) throw new Error(`列表缩进有误：${line}`);
      const sub = [];
      i = parseList(lines, i, level, sub);
      items.at(-1).sub += sub.join("");
      continue;
    }
    if (Boolean(m[3]) !== ordered) break;
    items.push({ text: m[4], sub: "" });
    i++;
  }
  const tag = ordered ? "ol" : "ul";
  const start = ordered && first[3] !== "1" ? ` start="${first[3]}"` : "";
  out.push(`<${tag}${start}>${items.map((it) => `<li>${inline(it.text)}${it.sub}</li>`).join("")}</${tag}>`);
  return i;
}

function table(rows) {
  const cells = (row) =>
    row
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const head = cells(rows[0]);
  if (!/^\|?\s*:?-{3,}/.test(rows[1] || "")) throw new Error(`表格缺少分隔行：${rows[0]}`);
  const body = rows.slice(2).map(cells);
  for (const row of body) if (row.length !== head.length) throw new Error(`表格列数不一致：${row.join(" | ")}`);
  // 三列及以上的表格在手机上改为逐行的卡片（每格前显示列名），两列的表格保持原样
  const cls = (head.length >= 4 ? " table--wide" : "") + (head.length >= 3 ? " table--stack" : " table--pair");
  const label = head.map((h) => esc(h.replace(/\*\*/g, "")));
  return (
    `<div class="table${cls}"><table><thead><tr>${head.map((h) => `<th scope="col">${inline(h)}</th>`).join("")}</tr></thead>` +
    `<tbody>${body.map((r) => `<tr>${r.map((c, k) => `<td data-label="${label[k]}">${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
  );
}

function render(lines, lang, ctx) {
  const out = [];
  const joiner = lang === "en" ? " " : "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const label = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      if (i >= lines.length) throw new Error("代码块没有结束的 ```");
      i++;
      const copy = lang === "en" ? "Copy" : "复制";
      out.push(
        `<div class="code"><button class="copy" type="button" data-copy>${copy}</button><pre><code${label ? ` data-lang="${esc(label)}"` : ""}>${esc(code.join("\n"))}</code></pre></div>`,
      );
      continue;
    }
    const h = line.match(/^(#{2,3}) (.+?)(?:\s+\{#([a-z0-9-]+)\})?\s*$/);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const id = h[3];
      if (level === 2 && !id) throw new Error(`二级标题缺少 {#id}：${line}`);
      if (id) {
        if (ctx.ids.has(id)) throw new Error(`章节 id 重复：${id}`);
        ctx.ids.add(id);
        ctx.toc.push({ level, id, text });
      }
      const idAttr = id ? ` id="${id}"` : "";
      const link = id ? `<a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>` : "";
      out.push(`<h${level}${idAttr}>${inline(text)}${link}</h${level}>`);
      i++;
      continue;
    }
    if (/^> ?/.test(line)) {
      const inner = [];
      while (i < lines.length && /^> ?/.test(lines[i])) inner.push(lines[i++].replace(/^> ?/, ""));
      // 第一行只有加粗文字时作为提示框的标题
      const title = /^\*\*[^*]+\*\*$/.test(inner[0] || "") ? `<p class="note__t">${inline(inner.shift())}</p>` : "";
      out.push(
        `<aside class="note">${title}${render(inner, lang, { ids: new Set(), toc: [], images: ctx.images })}</aside>`,
      );
      continue;
    }
    if (IMAGE.test(line)) {
      out.push(figure(line, ctx));
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      out.push(table(rows));
      continue;
    }
    if (LIST.test(line)) {
      i = parseList(lines, i, indentOf(line), out);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines[i])))
      para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(joiner))}</p>`);
  }
  return out.join("\n");
}

function parse(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) throw new Error(`${file}：缺少开头的 --- 元信息`);
  const meta = Object.fromEntries(
    fm[1]
      .split("\n")
      .map((l) => l.match(/^([a-z]+):\s*(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  for (const key of ["title", "kicker", "updated", "version", "description"])
    if (!meta[key]) throw new Error(`${file}：元信息缺少 ${key}`);
  return { meta, lines: text.slice(fm[0].length).split("\n") };
}

// ---------- page ----------
const giraffe = (fs.readFileSync(PORTAL, "utf8").match(/<symbol id="hx-giraffe"[\s\S]*?<\/symbol>/) || [])[0];
if (!giraffe) throw new Error("portal/index.html 中找不到长颈鹿标志（symbol#hx-giraffe）");

const CSS = `
  :root {
    --blue: #0156D3; --blue-2: #3D8BFF; --violet: #8B6CF2; --orange: #EB6100;
    --ink: #1F1F1F; --ink-2: #444746; --muted: #5F6368; --line: #E1E3E1; --paper: #F8FAFD; --chip: #E8F0FE;
    --sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-family: var(--sans); color: var(--ink); background: #FFFFFF;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  html.smooth { scroll-behavior: smooth; }
  body { margin: 0; line-height: 1.75; -webkit-font-smoothing: antialiased; }
  a { color: var(--blue); text-decoration: none; }
  a:hover { text-decoration: underline; }
  svg.defs { position: absolute; width: 0; height: 0; overflow: hidden; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px; }
  .skip { position: absolute; left: 12px; top: -48px; z-index: 30; padding: 8px 14px; border-radius: 999px; background: var(--blue); color: #FFFFFF; }
  .skip:focus { top: 12px; }

  header { position: sticky; top: 0; z-index: 20; background: #FFFFFF; box-shadow: 0 1px 0 var(--line); }
  .bar { display: flex; align-items: center; gap: 12px; height: 64px; }
  .brand { display: flex; align-items: center; gap: 10px; color: var(--ink); font-weight: 600; letter-spacing: .01em; white-space: nowrap; }
  .brand:hover { text-decoration: none; }
  .brand svg { width: 18px; height: 34px; flex: none; }
  .spacer { flex: 1; }
  .nav { display: flex; align-items: center; gap: 2px; }
  .nav a { font-size: 14px; color: var(--ink-2); padding: 8px 12px; border-radius: 999px; white-space: nowrap; }
  .nav a:hover { color: var(--blue); background: #F0F4F9; text-decoration: none; }
  .nav a[aria-current="page"] { color: var(--blue); background: var(--chip); }
  .nav a.lang { margin-left: 6px; box-shadow: inset 0 0 0 1px var(--line); }
  @media (max-width: 560px) { .brand .name { display: none; } .nav a { padding: 8px 10px; } }
  /* 窄屏上五个入口放不下时，顶栏的入口可以左右滑动，页面本身不再被撑宽 */
  @media (max-width: 480px) { .nav { min-width: 0; overflow-x: auto; scrollbar-width: none; } .nav::-webkit-scrollbar { display: none; }
    .nav a { padding: 8px 8px; font-size: 13.5px; } }

  .head { position: relative; overflow: hidden; padding: 56px 0 40px; border-bottom: 1px solid var(--line);
    background: radial-gradient(55% 80% at 8% 10%, rgba(61, 139, 255, .10) 0%, rgba(61, 139, 255, 0) 62%),
                radial-gradient(45% 70% at 92% 0%, rgba(139, 108, 242, .09) 0%, rgba(139, 108, 242, 0) 60%),
                radial-gradient(35% 60% at 70% 110%, rgba(235, 97, 0, .06) 0%, rgba(235, 97, 0, 0) 70%), #FFFFFF; }
  .chip { display: inline-flex; align-items: center; gap: 8px; padding: 5px 14px; border-radius: 999px; font-size: 13px; font-weight: 500;
    color: var(--blue); background: var(--chip); box-shadow: inset 0 0 0 1px #D3E3FD; }
  h1 { margin: 16px 0 0; font-size: clamp(30px, 4.2vw, 46px); line-height: 1.22; font-weight: 600; letter-spacing: -.01em; }
  html[lang="zh-CN"] h1 { letter-spacing: .02em; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 20px; margin: 14px 0 0; padding: 0; list-style: none; font-size: 14px; color: var(--muted); }
  .meta b { font-weight: 500; color: var(--ink-2); }

  .layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; padding-top: 32px; padding-bottom: 72px; }
  .layout > main { min-width: 0; }
  @media (min-width: 1000px) { .layout { grid-template-columns: 250px minmax(0, 1fr); gap: 56px; padding-top: 40px; } }
  .toc { align-self: start; border-radius: 16px; background: var(--paper); box-shadow: inset 0 0 0 1px var(--line); }
  @media (min-width: 1000px) { .toc { position: sticky; top: 88px; max-height: calc(100vh - 112px); overflow: auto; background: none; box-shadow: none; } }
  .toc summary { cursor: pointer; padding: 12px 16px; font-size: 14px; font-weight: 600; color: var(--ink-2); list-style: none; }
  .toc summary::-webkit-details-marker { display: none; }
  .toc summary::after { content: "▾"; float: right; color: var(--muted); }
  .toc[open] summary::after { content: "▴"; }
  @media (min-width: 1000px) { .toc summary { padding: 0 10px 8px; cursor: default; pointer-events: none; } .toc summary::after, .toc[open] summary::after { content: none; } }
  .toc ol { list-style: none; margin: 0; padding: 0 8px 12px; }
  @media (min-width: 1000px) { .toc ol { padding: 0; } }
  .toc a { display: block; padding: 6px 10px; border-radius: 8px; font-size: 14px; line-height: 1.45; color: var(--ink-2); }
  .toc a:hover { color: var(--blue); background: #F0F4F9; text-decoration: none; }
  .toc a.is-active { color: var(--blue); background: var(--chip); }
  .toc .sub a { padding-left: 24px; font-size: 13px; color: var(--muted); }

  article { min-width: 0; max-width: 820px; font-size: 16px; }
  html[lang="zh-CN"] article { line-height: 1.85; }
  article h2 { margin: 52px 0 12px; font-size: 23px; line-height: 1.35; font-weight: 600; scroll-margin-top: 84px; }
  article h3 { margin: 32px 0 8px; font-size: 18px; line-height: 1.4; font-weight: 600; scroll-margin-top: 84px; }
  article > :first-child { margin-top: 0; }
  article p { margin: 12px 0; }
  article ul, article ol { margin: 12px 0; padding-left: 1.5em; }
  article li { margin: 6px 0; }
  article li > ul, article li > ol { margin: 6px 0; }
  article a { overflow-wrap: anywhere; }
  article strong { font-weight: 600; }
  .anchor { margin-left: 10px; font-weight: 400; color: #C4C7C5; opacity: 0; transition: opacity .2s ease; }
  h2:hover .anchor, h3:hover .anchor { opacity: 1; }
  .anchor:hover { color: var(--blue); text-decoration: none; }
  .note { margin: 20px 0; padding: 16px 20px; border-radius: 16px; background: linear-gradient(180deg, #F3F7FE 0%, #F8FAFD 100%);
    box-shadow: inset 0 0 0 1px #D3E3FD; }
  .note > :first-child { margin-top: 0; }
  .note > :last-child { margin-bottom: 0; }
  .note__t { margin-bottom: 6px !important; }
  .note__t strong { color: var(--blue); }
  .table { margin: 16px 0; overflow-x: auto; border-radius: 14px; box-shadow: inset 0 0 0 1px var(--line); -webkit-overflow-scrolling: touch; }
  table { width: 100%; border-collapse: collapse; font-size: 14.5px; line-height: 1.65; }
  th, td { padding: 10px 14px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); }
  th { background: var(--paper); font-weight: 600; white-space: nowrap; }
  tbody tr:last-child td { border-bottom: 0; }
  .table--wide table { min-width: 720px; }
  .table--wide td:first-child, .table--pair td:first-child { font-weight: 500; }
  .table--pair td:first-child { white-space: nowrap; }
  @media (max-width: 640px) {
    .table--pair td:first-child { white-space: normal; min-width: 7em; }
    .table--stack { overflow: visible; border-radius: 0; box-shadow: none; }
    .table--stack table { min-width: 0; }
    .table--stack thead { display: none; }
    .table--stack tbody, .table--stack tr, .table--stack td { display: block; }
    .table--stack tr { margin: 0 0 12px; padding: 6px 0; border-radius: 14px; box-shadow: inset 0 0 0 1px var(--line); }
    .table--stack td { padding: 6px 16px; border: 0; }
    .table--stack td::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 600; color: var(--muted); }
    .table--stack td:first-child { font-size: 15.5px; font-weight: 600; }
    .table--stack td:first-child::before { content: none; }
  }
  code { font-family: var(--mono); font-size: .88em; padding: .12em .4em; border-radius: 6px; background: #F1F3F4; overflow-wrap: anywhere; }
  .code { position: relative; margin: 16px 0; }
  .code pre { margin: 0; padding: 16px 18px; padding-right: 80px; overflow-x: auto; border-radius: 14px; background: #0B1220; color: #E3E3E3; font-size: 14px; line-height: 1.6; }
  .code pre code { padding: 0; background: none; color: inherit; overflow-wrap: normal; }
  .copy { position: absolute; top: 10px; right: 10px; padding: 4px 12px; border: 0; border-radius: 999px; font: inherit; font-size: 12px;
    color: #E3E3E3; background: rgba(255, 255, 255, .12); cursor: pointer; }
  .copy:hover { background: rgba(255, 255, 255, .22); }
  .top { display: inline-block; margin-top: 40px; font-size: 14px; }
  .tag { display: inline-block; margin-right: 2px; padding: 0 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700; line-height: 20px;
    letter-spacing: .06em; vertical-align: 2px; color: #FFFFFF; }
  .tag--hot { background: var(--orange); }
  .tag--new { background: var(--blue); }
  .on { display: inline-block; margin-left: 4px; padding: 0 8px; border-radius: 999px; font-size: 12px; line-height: 20px; vertical-align: 1px;
    color: var(--ink-2); background: #F1F3F4; white-space: nowrap; }
  .shot { margin: 16px 0 20px; }
  .shot img { display: block; width: 100%; height: auto; border-radius: 14px; box-shadow: inset 0 0 0 1px var(--line); background: #F5F5F7; }
  .shot figcaption { margin-top: 8px; font-size: 13.5px; color: var(--muted); }

  footer { border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }
  footer .bar { flex-wrap: wrap; height: auto; padding-top: 20px; padding-bottom: 20px; gap: 8px 18px; }
  footer .brand { font-weight: 400; color: var(--muted); }
  footer .links { display: flex; flex-wrap: wrap; gap: 6px 18px; }
  footer a { color: var(--muted); }
  footer a:hover { color: var(--blue); }
  @media print {
    header, .toc, .anchor, .copy, .top, footer nav { display: none !important; }
    .head { padding: 0 0 16px; background: none; }
    .layout { display: block; padding: 16px 0 0; }
    article { max-width: none; }
    a { color: inherit; }
  }`;

const SCRIPT = `
(function () {
  "use strict";
  var KEY = "hxbot-portal-lang";
  // 打开带 #章节 的地址时直接跳到该章节，之后页内跳转再平滑滚动
  window.addEventListener("load", function () { setTimeout(function () { document.documentElement.classList.add("smooth"); }, 0); });
  // 切换语言：记住选择，并保留当前章节（#…）
  Array.prototype.forEach.call(document.querySelectorAll("[data-lang]"), function (a) {
    a.addEventListener("click", function () {
      try { localStorage.setItem(KEY, a.getAttribute("data-lang")); } catch (e) {}
      a.setAttribute("href", a.getAttribute("href").split("#")[0] + location.hash);
    });
  });
  // 目录：窄屏默认收起，点了章节后收起；滚动时高亮当前章节
  var toc = document.querySelector(".toc");
  var narrow = window.matchMedia && matchMedia("(max-width: 999px)");
  if (toc && narrow && narrow.matches) toc.removeAttribute("open");
  if (toc) toc.addEventListener("click", function (e) {
    if (e.target.closest("a") && narrow && narrow.matches) toc.removeAttribute("open");
  });
  var links = {};
  Array.prototype.forEach.call(document.querySelectorAll(".toc a[href^='#']"), function (a) { links[a.getAttribute("href").slice(1)] = a; });
  var current = null;
  function mark(id) {
    if (current === id || !links[id]) return;
    if (current && links[current]) links[current].classList.remove("is-active");
    links[id].classList.add("is-active");
    current = id;
  }
  var heads = document.querySelectorAll("article h2[id], article h3[id]");
  var pending = false;
  function spy() {
    pending = false;
    var id = heads.length ? heads[0].id : null;
    for (var i = 0; i < heads.length; i++) { if (heads[i].getBoundingClientRect().top <= 110) id = heads[i].id; else break; }
    mark(id);
  }
  window.addEventListener("scroll", function () { if (!pending) { pending = true; requestAnimationFrame(spy); } }, { passive: true });
  window.addEventListener("load", spy);
  spy();
  // 代码块“复制”按钮
  Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (button) {
    button.addEventListener("click", function () {
      var text = button.parentNode.querySelector("code").textContent;
      var label = button.textContent;
      var done = function () { button.textContent = document.documentElement.lang === "en" ? "Copied" : "已复制"; setTimeout(function () { button.textContent = label; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
    });
  });
})();`;

// 中文页：上次选了英文、或浏览器语言不是中文时，转到英文页（地址带 ?lang=zh 时留在中文页）
const REDIRECT = (name) =>
  `<script>(function(){var l,q=/[?&]lang=(en|zh)\\b/.exec(location.search);if(q)l=q[1];else{try{l=localStorage.getItem("hxbot-portal-lang")}catch(e){}if(!l)l=(navigator.language||"zh").toLowerCase().indexOf("zh")===0?"zh":"en"}if(l==="en"){location.replace("/en/${name}/"+location.hash);return}if(q){try{history.replaceState(null,"",location.pathname+location.hash)}catch(e){}}})();</script>`;

function page(name, lang, doc) {
  const ui = UI[lang];
  const other = lang === "zh" ? "en" : "zh";
  const ctx = { ids: new Set(), toc: [], images: [] };
  const body = render(doc.lines, lang, ctx);
  const m = doc.meta;
  const metaItems = [
    m.effective ? `<li><b>${ui.effective}</b>${lang === "en" ? ": " : "："}${esc(m.effective)}</li>` : "",
    `<li><b>${ui.updated}</b>${lang === "en" ? ": " : "："}${esc(m.updated)}</li>`,
    `<li><b>${ui.version}</b> ${esc(m.version)}</li>`,
  ].join("");
  const tocItems = ctx.toc
    .map((t) => `<li${t.level === 3 ? ' class="sub"' : ""}><a href="#${t.id}">${inline(t.text)}</a></li>`)
    .join("");
  const nav = PAGES.map(
    (p) => `<a href="${pagePath(p, lang)}"${p === name ? ' aria-current="page"' : ""}>${ui.nav[p]}</a>`,
  ).join("");
  const otherHref = other === "en" ? pagePath(name, "en") : `${pagePath(name, "zh")}?lang=zh`;
  const home = lang === "en" ? "/en/" : "/";
  const footerLinks = [
    ...PAGES.map((p) => `<a href="${pagePath(p, lang)}">${ui.nav[p]}</a>`),
    `<a href="${LICENSE}" target="_blank" rel="noopener">${ui.license}</a>`,
    `<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">${ICP}</a>`,
  ].join("");
  const html = `<!doctype html>
<html lang="${ui.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#FFFFFF">
<title>${esc(m.title)} · ${esc(ui.siteName)}</title>
<meta name="description" content="${esc(m.description)}">
<link rel="alternate" hreflang="zh-CN" href="${ORIGIN}${pagePath(name, "zh")}">
<link rel="alternate" hreflang="en" href="${ORIGIN}${pagePath(name, "en")}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${lang === "zh" ? `${REDIRECT(name)}\n` : ""}<style>
  /* HXBot · ${esc(m.title)}。由 hx/scripts/site-pages.mjs 从 hx/docs/site/${name}.${lang}.md 生成，请勿直接修改。 */${CSS}
</style>
</head>
<body>
<a class="skip" href="#main">${ui.skip}</a>
<svg class="defs" aria-hidden="true" focusable="false"><defs>${giraffe}</defs></svg>
<header>
  <div class="wrap bar">
    <a class="brand" href="${home}" aria-label="${esc(ui.brand)} · ${ui.home}"><svg aria-hidden="true"><use href="#hx-giraffe" width="100%" height="100%"/></svg><span class="name">${esc(ui.brand)}</span></a>
    <span class="spacer"></span>
    <nav class="nav" aria-label="${esc(ui.siteName)}">${nav}<a class="lang" href="${otherHref}" data-lang="${other}" hreflang="${UI[other].htmlLang}" lang="${UI[other].htmlLang}">${UI[lang].otherLang}</a></nav>
  </div>
</header>
<div class="head">
  <div class="wrap">
    <span class="chip">${esc(m.kicker)}</span>
    <h1>${esc(m.title)}</h1>
    <ul class="meta">${metaItems}</ul>
  </div>
</div>
<div class="wrap layout">
  <details class="toc" open>
    <summary>${ui.toc}</summary>
    <nav aria-label="${ui.toc}"><ol>${tocItems}</ol></nav>
  </details>
  <main id="main">
    <article>
${body}
    <a class="top" href="#">${ui.top} ↑</a>
    </article>
  </main>
</div>
<footer>
  <div class="wrap bar">
    <span class="brand"><svg aria-hidden="true"><use href="#hx-giraffe" width="100%" height="100%"/></svg><span>${ui.copy}</span></span>
    <span class="spacer"></span>
    <nav class="links" aria-label="${ui.license}">${footerLinks}</nav>
  </div>
</footer>
<script>${SCRIPT}
</script>
</body>
</html>
`;
  return { html, ids: [...ctx.ids], images: ctx.images };
}

// ---------- build and check ----------
const LEAK = /openbot|synthetify|nightly[\s-]?labs|bodziony/i;
const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;
const problems = [];
const outputs = new Map();
const idsOf = {};
for (const name of PAGES) {
  for (const lang of ["zh", "en"]) {
    const file = path.join(SRC, `${name}.${lang}.md`);
    const doc = parse(file);
    for (const [i, line] of doc.lines.entries())
      if (LEAK.test(line))
        problems.push(`${path.basename(file)}:${i + 1} 含有不应出现的名称：${line.trim().slice(0, 80)}`);
    const { html, ids, images } = page(name, lang, doc);
    // 新功能页：全页只有一个 HOT、一个 NEW；中文页用中文截图（*.zh.*），英文页用英文截图（*.en.*）
    if (name === "whats-new") {
      const source = doc.lines.join("\n");
      for (const tag of ["HOT", "NEW"]) {
        const count = source.split(`{${tag}}`).length - 1;
        if (count !== 1) problems.push(`${name}.${lang}.md 应有且只有一个 {${tag}}，现在有 ${count} 个`);
      }
      for (const src of images)
        if (!src.includes(`.${lang}.`)) problems.push(`${name}.${lang}.md 用了别的语言的截图：${src}`);
    }
    idsOf[`${name}.${lang}`] = ids;
    outputs.set(path.join(OUT, lang === "zh" ? `${name}.html` : `${name}.en.html`), html);
    if (lang === "en") {
      const visible = html
        .replace(/<symbol[\s\S]*?<\/symbol>/, "")
        .replace(/<script>[\s\S]*?<\/script>/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(ICP)
        .join("")
        .split(">中文<")
        .join("><");
      const at = visible.search(CJK);
      if (at >= 0) problems.push(`${name}.en.html 含有中文：…${visible.slice(Math.max(0, at - 40), at + 20)}…`);
    }
    const leak = html.replace(/<symbol[\s\S]*?<\/symbol>/, "").match(LEAK);
    if (leak) problems.push(`${name}.${lang} 页面含有不应出现的名称：${leak[0]}`);
  }
  if (idsOf[`${name}.zh`].join(",") !== idsOf[`${name}.en`].join(",")) {
    problems.push(
      `${name}：中文和英文的章节 id 不一致（${idsOf[`${name}.zh`].join(",")} ≠ ${idsOf[`${name}.en`].join(",")}）`,
    );
  }
}
// 站内链接：/guide/#server 这类地址的章节必须存在
for (const [file, html] of outputs) {
  for (const m of html.matchAll(/href="(\/(?:en\/)?(guide|whats-new|terms|privacy)\/(?:\?lang=zh)?)#([a-z0-9-]+)"/g)) {
    if (!idsOf[`${m[2]}.zh`].includes(m[3]))
      problems.push(`${path.basename(file)}：链接 ${m[1]}#${m[3]} 指向不存在的章节`);
  }
  const article =
    (html.match(/<article>[\s\S]*<\/article>/) || [""])[0] +
    (html.match(/<details class="toc"[\s\S]*?<\/details>/) || [""])[0];
  for (const m of article.matchAll(/href="#([a-z0-9-]+)"/g)) {
    const name = path.basename(file).split(".")[0];
    if (!idsOf[`${name}.zh`].includes(m[1])) problems.push(`${path.basename(file)}：链接 #${m[1]} 指向不存在的章节`);
  }
}
// 门户首页也不能出现上游名称（只放行账号服务接口要求的请求头 X-HXBot-Browser）
{
  const portal = fs.readFileSync(PORTAL, "utf8").split('"X-HXBot-Browser"').join("");
  const leak = portal.match(LEAK);
  if (leak) problems.push(`portal/index.html 含有不应出现的名称：${leak[0]}`);
}
// 客户端里写死的章节地址也必须存在
for (const id of ["server", "faq"])
  if (!idsOf["guide.zh"].includes(id)) problems.push(`使用指南缺少客户端会打开的章节 #${id}`);

if (problems.length) {
  console.error("页面检查未通过：");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(2);
}
if (CHECK) {
  const stale = [...outputs]
    .filter(([file, html]) => !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== html)
    .map(([file]) => path.relative(HX, file));
  const extra = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((f) => !outputs.has(path.join(OUT, f))) : [];
  if (stale.length || extra.length) {
    console.error("页面与 Markdown 不一致，请运行 node hx/scripts/site-pages.mjs：");
    for (const f of stale) console.error(`  - ${f}`);
    for (const f of extra) console.error(`  - 多余的文件：server/portal/pages/${f}`);
    process.exit(1);
  }
  console.log(`页面与 Markdown 一致（${outputs.size} 个页面）。`);
} else {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [file, html] of outputs) fs.writeFileSync(file, html);
  console.log(`已生成 ${outputs.size} 个页面：${[...outputs.keys()].map((f) => path.relative(HX, f)).join("、")}`);
}
