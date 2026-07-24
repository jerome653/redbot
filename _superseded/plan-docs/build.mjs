#!/usr/bin/env node
/**
 * Build report.md + proposal.htm for the Appilot technical analysis.
 *
 * Pattern matches the other SGEN long-form reports (canon.md · _clusters/*.md ·
 * report.md · report.html). Markdown is rendered to static HTML at build time —
 * NOT client-side — so that ```mermaid fences land in the document as
 * <pre class="mermaid"> before the artifact runtime's diagram pass runs.
 *
 * Usage:  node build.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SOURCE = 'ACTION-PLAN.md';

/* ------------------------------------------------------------------ *
 * Markdown → HTML  (ported from the SGEN house renderer, + fences)
 * ------------------------------------------------------------------ */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function boldItalic(s) {
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[\s(])_(?=\S)([^_]+?)_(?=[\s).,;:!?—]|$)/g, '$1<em>$2</em>');
  return s;
}
const fmt = (t) => boldItalic(esc(t));

const OPEN = '';
const CLOSE = '';

function inline(str) {
  if (str == null) return '';
  const stash = [];
  const keep = (html) => { stash.push(html); return OPEN + (stash.length - 1) + CLOSE; };

  str = str.replace(/`([^`]+)`/g, (m, c) => keep('<code>' + esc(c) + '</code>'));
  str = str.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
    const internal = /^#/.test(u);
    const attrs = internal ? '' : ' target="_blank" rel="noopener"';
    return keep('<a href="' + escAttr(u) + '"' + attrs + '>' + fmt(t) + '</a>');
  });
  str = str.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, u) => {
    let url = u, tail = '';
    const tm = url.match(/[.,;:!?]+$/);
    if (tm) { tail = tm[0]; url = url.slice(0, -tail.length); }
    return pre + keep('<a href="' + escAttr(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a>') + tail;
  });
  str = esc(str);
  str = boldItalic(str);
  str = str.replace(new RegExp(OPEN + '(\\d+)' + CLOSE, 'g'), (m, n) => stash[+n]);
  return str;
}

const slug = (text) => text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-');

function splitRow(row) {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; }
    else if (ch === '|') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}
function alignOf(cell) {
  const c = cell.trim();
  const l = c.startsWith(':'), r = c.endsWith(':');
  if (l && r) return 'center';
  if (r) return 'right';
  if (l) return 'left';
  return '';
}
function isDelimRow(s) {
  if (!s.includes('|')) return false;
  const cells = splitRow(s);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()));
}
function cellClasses(align, cell) {
  const arr = [];
  if (align) arr.push('ta-' + align);
  if (/^\*{0,2}[+\-]?\d+(?:[.,]\d+)?%?\*{0,2}$/.test(cell.trim())) arr.push('num');
  return arr.length ? ' class="' + arr.join(' ') + '"' : '';
}
function renderTable(header, aligns, body) {
  const wide = header.length >= 8 ? ' wide' : '';
  let s = '<div class="table-wrap"><table class="md-table' + wide + '"><thead><tr>';
  header.forEach((c, i) => {
    s += '<th' + (aligns[i] ? ' class="ta-' + aligns[i] + '"' : '') + '>' + inline(c) + '</th>';
  });
  s += '</tr></thead><tbody>';
  body.forEach((row) => {
    s += '<tr>';
    for (let i = 0; i < header.length; i++) {
      const cell = row[i] !== undefined ? row[i] : '';
      s += '<td' + cellClasses(aligns[i], cell) + '>' + inline(cell) + '</td>';
    }
    s += '</tr>';
  });
  return s + '</tbody></table></div>';
}

function buildList(items) {
  let idx = 0;
  function build() {
    const indent = items[idx].indent;
    const ordered = items[idx].ordered;
    let out = ordered ? '<ol>' : '<ul>';
    while (idx < items.length && items[idx].indent === indent) {
      const it = items[idx];
      idx++;
      let li = '<li>' + inline(it.content);
      if (idx < items.length && items[idx].indent > indent) li += build();
      out += li + '</li>';
    }
    return out + (ordered ? '</ol>' : '</ul>');
  }
  let res = '';
  while (idx < items.length) res += build();
  return res;
}

function renderHeading(level, text) {
  const id = slug(text);
  if (level === 2) {
    const m = /^(§\S+)\s+—\s+([\s\S]+)$/.exec(text);
    if (m) {
      return '<h2 id="' + id + '"><span class="eyebrow">' + esc(m[1]) +
        '</span><span class="htitle">' + inline(m[2]) + '</span></h2>';
    }
    return '<h2 id="' + id + '"><span class="htitle">' + inline(text) + '</span></h2>';
  }
  return '<h' + level + ' id="' + id + '">' + inline(text) + '</h' + level + '>';
}

const headingRe = /^(#{1,6})\s+(.*)$/;
const hrRe = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const listRe = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const bqRe = /^\s{0,3}>\s?(.*)$/;
const fenceRe = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const isBlank = (s) => /^\s*$/.test(s);
const tableStartsAt = (lines, i) =>
  lines[i].includes('|') && i + 1 < lines.length && isDelimRow(lines[i + 1]);

function mdToHtml(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const out = [];
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    const fm = fenceRe.exec(line);
    if (fm) {
      const marker = fm[1][0];
      const lang = (fm[2] || '').toLowerCase();
      i++;
      const buf = [];
      while (i < lines.length) {
        const cm = fenceRe.exec(lines[i]);
        if (cm && cm[1][0] === marker && !cm[2]) { i++; break; }
        buf.push(lines[i]); i++;
      }
      const body = buf.join('\n');
      if (lang === 'mermaid') {
        out.push('<div class="diagram"><pre class="mermaid">' + esc(body) + '</pre></div>');
      } else {
        out.push('<div class="codeblock"' + (lang ? ' data-lang="' + escAttr(lang) + '"' : '') +
          '><pre><code>' + esc(body) + '</code></pre></div>');
      }
      continue;
    }

    const hm = headingRe.exec(line);
    if (hm) { out.push(renderHeading(hm[1].length, hm[2].trim())); i++; continue; }

    if (hrRe.test(line)) { out.push('<hr>'); i++; continue; }

    if (tableStartsAt(lines, i)) {
      const header = splitRow(lines[i]);
      const aligns = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      const body = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|') &&
             !headingRe.test(lines[i]) && !hrRe.test(lines[i])) {
        body.push(splitRow(lines[i])); i++;
      }
      out.push(renderTable(header, aligns, body));
      continue;
    }

    if (bqRe.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++;
      }
      out.push('<blockquote>' + mdToHtml(buf.join('\n')) + '</blockquote>');
      continue;
    }

    if (listRe.test(line)) {
      const items = [];
      while (i < lines.length && !isBlank(lines[i]) && listRe.test(lines[i])) {
        const mm = listRe.exec(lines[i]);
        items.push({
          indent: mm[1].replace(/\t/g, '    ').length,
          ordered: /\d+\./.test(mm[2]),
          content: mm[3],
        });
        i++;
      }
      out.push(buildList(items));
      continue;
    }

    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !headingRe.test(lines[i]) &&
           !hrRe.test(lines[i]) && !listRe.test(lines[i]) && !bqRe.test(lines[i]) &&
           !fenceRe.test(lines[i]) && !tableStartsAt(lines, i)) {
      para.push(lines[i]); i++;
    }
    out.push('<p>' + para.map((l) => inline(l.trim())).join('<br>') + '</p>');
  }
  return out.join('\n');
}

/* ------------------------------------------------------------------ *
 * Assemble
 * ------------------------------------------------------------------ */
const md = readFileSync(join(ROOT, SOURCE), 'utf8');

const article = mdToHtml(md);

/* nav entries from h2s */
const navItems = [...article.matchAll(/<h2 id="([^"]+)">(?:<span class="eyebrow">([^<]*)<\/span>)?<span class="htitle">([\s\S]*?)<\/span><\/h2>/g)]
  .map((m) => ({ id: m[1], mark: m[2] || '', text: m[3].replace(/<[^>]+>/g, '') }));

const nav = navItems.map((n) =>
  `<li><a href="#${escAttr(n.id)}" data-target="${escAttr(n.id)}">` +
  (n.mark ? `<span class="n-mark">${esc(n.mark)}</span>` : '') +
  `<span class="n-text">${esc(n.text)}</span></a></li>`).join('\n        ');

const css = readFileSync(join(ROOT, '_assets', 'house.css'), 'utf8')
  .replace(/SGEN — redbot MVP Proposal/g, 'SGEN — Appilot Technical Analysis');

const extraCss = `
<style>
/* ---- additions for this report: code blocks + diagrams ---- */
.codeblock{
  margin:1.6rem 0;
  border:1px solid var(--line);
  border-radius:8px;
  background:var(--surface);
  overflow:hidden;
  position:relative;
}
.codeblock[data-lang]::before{
  content:attr(data-lang);
  position:absolute; top:0; right:0;
  font-family:var(--font-mono);
  font-size:.66rem; letter-spacing:.09em; text-transform:uppercase;
  color:var(--ink-3);
  background:var(--surface-2);
  border-left:1px solid var(--line); border-bottom:1px solid var(--line);
  border-radius:0 8px 0 8px;
  padding:.25rem .6rem;
}
.codeblock pre{
  margin:0; padding:1.1rem 1.15rem;
  overflow-x:auto;
  font-family:var(--font-mono);
  font-size:.86rem; line-height:1.6;
  color:var(--ink-2);
  tab-size:2;
}
.codeblock code{
  background:none; border:0; padding:0; font-size:inherit; color:inherit;
  white-space:pre;
}
.diagram{
  margin:1.9rem 0;
  padding:1.1rem;
  border:1px solid var(--line);
  border-radius:8px;
  background:var(--surface);
  overflow-x:auto;
}
.diagram pre.mermaid{
  margin:0;
  font-family:var(--font-mono);
  font-size:.8rem; line-height:1.5;
  color:var(--ink-3);
  white-space:pre;
}
.diagram svg{ max-width:100%; height:auto; display:block; margin-inline:auto; }
.callout{
  border-left:3px solid var(--accent);
  background:var(--accent-soft);
  padding:.9rem 1.1rem;
  border-radius:0 6px 6px 0;
  margin:1.5rem 0;
}
@media print{ .codeblock, .diagram{ break-inside:avoid; } }
</style>`;

const html = `${css}
${extraCss}

<div class="topbar" role="banner">
  <div class="topbar-inner">
    <div class="brand">
      <span class="wordmark">SGEN</span>
      <span class="vrule" aria-hidden="true"></span>
      <span class="brand-sub">redbot — Action Plan</span>
    </div>
    <div class="stamp">v1 &middot; 2026-07-22</div>
  </div>
</div>

<div class="progress" aria-hidden="true"><span class="progress-fill" id="progressFill"></span></div>

<div class="shell">
  <aside class="sidebar">
    <details class="toc" id="toc">
      <summary><span>Contents</span><span class="toc-caret" aria-hidden="true"></span></summary>
      <nav aria-label="Report sections">
        <div class="nav-head">Sections</div>
        <ul class="nav-list" id="navList">
        ${nav}
        </ul>
      </nav>
    </details>
  </aside>
  <main class="article" id="article">
${article}
  </main>
</div>

<script>
(function(){
  "use strict";
  var links = Array.prototype.slice.call(document.querySelectorAll("#navList a"));
  var toc = document.getElementById("toc");
  var sb  = document.querySelector(".sidebar");
  var byId = {};
  links.forEach(function(a){
    byId[a.dataset.target] = a;
    a.addEventListener("click", function(){
      if(!window.matchMedia("(min-width:1000px)").matches){ toc.open = false; }
    });
  });
  var current = null;
  function setActive(id){
    if(current === id) return;
    current = id;
    links.forEach(function(a){ a.classList.toggle("active", a.dataset.target === id); });
    var link = byId[id];
    if(link && sb && window.matchMedia("(min-width:1000px)").matches){
      var lr = link.getBoundingClientRect(), sr = sb.getBoundingClientRect();
      if(lr.top < sr.top || lr.bottom > sr.bottom){ sb.scrollTop += (lr.top - sr.top) - 48; }
    }
  }
  var h2s = Array.prototype.slice.call(document.querySelectorAll("#article h2"));
  if("IntersectionObserver" in window){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: "-80px 0px -70% 0px", threshold: 0 });
    h2s.forEach(function(h){ io.observe(h); });
  }
  if(h2s.length) setActive(h2s[0].id);

  var fill = document.getElementById("progressFill");
  function onScroll(){
    var de = document.documentElement;
    var max = de.scrollHeight - de.clientHeight;
    var p = max > 0 ? (de.scrollTop / max) : 0;
    if(p < 0) p = 0; if(p > 1) p = 1;
    fill.style.width = (p * 100).toFixed(2) + "%";
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  function applyToc(){ toc.open = window.matchMedia("(min-width:1000px)").matches; }
  applyToc();
  window.addEventListener("resize", applyToc);
})();
</script>
`;

writeFileSync(join(ROOT, 'ACTION-PLAN.html'), html, 'utf8');

/* ------------------------------------------------------------------ *
 * Standalone share build — a complete .html document that can be
 * emailed, dropped in Drive, or opened from disk. Same content; adds
 * doctype/head, renders mermaid via CDN when online (diagrams stay
 * readable as text when not), and a clean print stylesheet for
 * Ctrl+P -> PDF.
 * ------------------------------------------------------------------ */
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>redbot — Action Plan</title>
<meta name="description" content="Approval-stage proposal for redbot: a Reddit user agent for SGEN, with a side-by-side against the Appilot bot it replaces.">
<meta name="robots" content="noindex, nofollow">
${css}
${extraCss}
<style>
  /* standalone-only: page chrome + print */
  body{ margin:0; }
  @media print{
    .topbar, .progress, .sidebar{ display:none !important; }
    .shell{ display:block; max-width:none; padding:0; }
    .article{ max-width:none; padding:0; }
    a[href^="http"]::after{ content:" (" attr(href) ")"; font-size:.72em; color:#666; word-break:break-all; }
    h1,h2,h3{ break-after:avoid; }
    table, .diagram, .codeblock{ break-inside:avoid; }
  }
</style>
</head>
<body>
${html.slice(html.indexOf('<div class="topbar"'))}
<script type="module">
  try{
    const m = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    m.default.initialize({ startOnLoad:true, theme: dark ? "dark" : "neutral", securityLevel:"strict" });
    await m.default.run({ querySelector:"pre.mermaid" });
  }catch(e){
    /* offline or blocked: diagrams remain readable as monospace source */
    document.querySelectorAll(".diagram").forEach(d => d.setAttribute("data-fallback","text"));
  }
</script>
</body>
</html>
`;
writeFileSync(join(ROOT, 'redbot-ACTION-PLAN.html'), standalone, 'utf8');

const words = md.split(/\s+/).filter(Boolean).length;
console.log('proposal.md ' + md.length.toLocaleString() + ' bytes · ~' + words.toLocaleString() + ' words');
console.log('proposal.htm ' + html.length.toLocaleString() + ' bytes');
console.log('sections    ' + navItems.length);
console.log('diagrams    ' + (article.match(/class="mermaid"/g) || []).length);
console.log('tables      ' + (article.match(/<table/g) || []).length);
