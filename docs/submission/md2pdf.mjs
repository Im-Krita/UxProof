// Собирает PDF заявки из markdown через Chromium из runner/node_modules.
// Запуск: node docs/submission/md2pdf.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const require = createRequire(path.join(repo, 'runner', 'package.json'));
const { chromium } = require('playwright');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(src) {
  let s = esc(src);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
  return s;
}

function render(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let list = null;

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\s*$/.test(line)) {
      closeList();
      i++;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s-]*$/.test(line)) {
      closeList();
      out.push('<hr>');
      i++;
      continue;
    }

    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      closeList();
      const cells = (row) =>
        row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(cells(lines[i++]));
      out.push('<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
      for (const r of body) {
        out.push('<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
      }
      out.push('</tbody></table>');
      continue;
    }

    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ol || ul) {
      const kind = ol ? 'ol' : 'ul';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ol || ul)[1])}</li>`);
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`);
      continue;
    }

    closeList();
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*[-*]\s/.test(lines[i]) &&
      !/^\s*\d+[.)]\s/.test(lines[i]) &&
      !/^\s*\|/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  closeList();
  return out.join('\n');
}

const CSS = `
  @page { size: A4; margin: 20mm 18mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", "Calibri", system-ui, sans-serif; font-size: 10.5pt; line-height: 1.55; color: #1a242c; margin: 0; }
  h1 { font-size: 21pt; line-height: 1.2; margin: 0 0 14px; letter-spacing: -0.01em; }
  h2 { font-size: 13.5pt; margin: 22px 0 8px; color: #213e33; border-bottom: 1px solid #dde3e8; padding-bottom: 4px; }
  h3 { font-size: 11.5pt; margin: 16px 0 6px; color: #213e33; }
  p { margin: 0 0 9px; }
  ul, ol { margin: 0 0 10px; padding-left: 20px; }
  li { margin-bottom: 3px; }
  code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 9pt; background: #eef1f4; padding: 1px 4px; border-radius: 3px; }
  pre { background: #f4f6f8; border: 1px solid #dde3e8; border-radius: 5px; padding: 9px 11px; overflow-wrap: break-word; white-space: pre-wrap; margin: 0 0 12px; }
  pre code { background: none; padding: 0; font-size: 8.8pt; line-height: 1.45; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 14px; font-size: 9.5pt; }
  th, td { border: 1px solid #dde3e8; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #eef1f4; font-weight: 600; }
  blockquote { margin: 0 0 12px; padding: 2px 0 2px 12px; border-left: 3px solid #213e33; color: #4a5866; }
  a { color: #1d5b45; text-decoration: none; }
  hr { border: none; border-top: 1px solid #dde3e8; margin: 18px 0; }
  h1 + p { font-size: 11pt; color: #46545f; }
`;

const jobs = [
  ['docs/submission/01-opisanie.md', 'docs/submission/pdf/01-Описание.pdf'],
  ['docs/FINAL-AUDIT-REPORT.md', 'docs/submission/pdf/04-Результаты-проверок.pdf'],
  ['docs/submission/03-demo.md', 'docs/submission/pdf/03-Демонстрация-инструкция.pdf'],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out] of jobs) {
  const md = fs.readFileSync(path.join(repo, src), 'utf8');
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${render(md)}</body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  const dest = path.join(repo, out);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await page.pdf({
    path: dest,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-family:Segoe UI,sans-serif;font-size:8pt;color:#8b98a3;padding:0 18mm;display:flex;justify-content:space-between;"><span>UXProof</span><span class="pageNumber"></span></div>',
    margin: { top: '18mm', bottom: '16mm', left: '18mm', right: '18mm' },
  });
  console.log(`${path.basename(dest)} — ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
}
await browser.close();
