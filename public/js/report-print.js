/* report-print.js — the same report as a print page, for the browser's "Save as PDF".
 *
 * Takes the document model from report-narrative.js (the one report-docx.js
 * turns into Word) and returns a self-contained HTML document: letter pages,
 * full-bleed cover, running header and page numbers, charts as inline SVG.
 * Running headers and page numbers use CSS page-margin boxes, which Chrome and
 * Edge support; Safari and Firefox print the report without them.
 * Runs in the browser (window.HAPrint) and in Node (module.exports).
 */
(function (root) {
  'use strict';
  const C = { PRIMARY: '#1D4A4D', ACCENT: '#B8683A', ACCENT_D: '#8F4E28', DEEP: '#143638', SLATE: '#7E9A9A', MUTED: '#667676', HAIR: '#DDE4E3', TILE: '#F2F5F4', CREAM: '#FAF3EC', PALE: '#C8D5D4' };
  const col = (c) => C[c] || (/^[0-9A-F]{6}$/i.test(c) ? '#' + c : c);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const n0 = (x) => Math.round(x).toLocaleString('en-US');
  const fmtOf = (f) => (/\$/.test(f || '') ? (v) => '$' + n0(v) : /0\.0"%"/.test(f || '') ? (v) => (+v).toFixed(1) + '%' : /%/.test(f || '') ? (v) => Math.round(v) + '%' : (v) => n0(v));

  function niceMax(m) { if (!(m > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(m))), r = m / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p; }
  function wrap(text, max) { const out = []; let line = ''; String(text).split(' ').forEach((w) => { if ((line + ' ' + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); }); if (line) out.push(line); return out.slice(0, 3); }

  function chart(b) {
    const W = 624, H = Math.round((b.height || 2560000) / 9525), series = b.series, cats = b.cats, stacked = b.kind === 'stacked', fv = fmtOf(b.fmt), fa = fmtOf(b.axisFmt || b.fmt);
    const legend = series.length > 1, m = { l: 52, r: 8, t: 18, b: 44 + (legend ? 22 : 0) }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const tot = cats.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
    const max = niceMax(Math.max.apply(null, stacked ? tot : series.reduce((a, s) => a.concat(s.values.map((v) => v || 0)), [])) * 1.08), y = (v) => m.t + ph - (v / max) * ph;
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = (max * k) / 4, yy = y(v); g += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" stroke="${k ? '#E3E9ED' : C.SLATE}" stroke-width="${k ? 0.6 : 1}"/><text x="${m.l - 6}" y="${yy + 3}" text-anchor="end" font-size="8.5" fill="${C.MUTED}">${esc(fa(v))}</text>`; }
    const band = pw / cats.length, inner = band * (stacked || series.length === 1 ? 0.62 : 0.8), bw = stacked ? inner : inner / series.length, small = cats.length * (stacked ? 1 : series.length) > 14;
    cats.forEach((c, i) => {
      const x0 = m.l + i * band + (band - inner) / 2; let base = 0;
      series.forEach((s, k) => {
        const v = s.values[i]; if (v == null) return;
        const fill = col((s.points && s.points[i]) || s.color), x = stacked ? x0 : x0 + k * bw, top = y(stacked ? base + v : v), h = (v / max) * ph;
        if (h > 0) g += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(bw - (stacked ? 0 : 1.5)).toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"/>`;
        if (!stacked && b.labels !== false) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(top - 4).toFixed(1)}" text-anchor="middle" font-size="${small ? 7 : 8.5}" font-weight="700" fill="${C.PRIMARY}">${esc(fv(v))}</text>`;
        base += v;
      });
      wrap(c, Math.max(8, Math.floor(band / 5))).forEach((ln, j) => { g += `<text x="${(m.l + i * band + band / 2).toFixed(1)}" y="${m.t + ph + 14 + j * 10}" text-anchor="middle" font-size="8.5" fill="#3B4B55">${esc(ln)}</text>`; });
    });
    if (legend) { let x = m.l; series.forEach((s) => { g += `<rect x="${x}" y="${H - 14}" width="8" height="8" fill="${col(s.color)}"/><text x="${x + 12}" y="${H - 6.5}" font-size="8.5" fill="#3B4B55">${esc(s.name)}</text>`; x += 22 + s.name.length * 4.9; }); }
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">${g}</svg>`;
  }

  const q = (t) => '"' + String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const css = (m) => `
  @page { size: letter; margin: 1.04in 1in 0.88in 1in;
    @top-left { content: ${q(m.header.left.toUpperCase())}; font: 700 6.5pt Arial, sans-serif; letter-spacing: .12em; color: ${C.PRIMARY}; border-bottom: 1pt solid ${C.ACCENT}; padding-bottom: 4pt; vertical-align: bottom; margin-bottom: .22in; }
    @top-right { content: ${q(m.header.right.toUpperCase())}; font: 6.5pt Arial, sans-serif; letter-spacing: .12em; color: ${C.MUTED}; border-bottom: 1pt solid ${C.ACCENT}; padding-bottom: 4pt; vertical-align: bottom; margin-bottom: .22in; }
    @bottom-left { content: ${q(m.footer.left)}; font: 7pt Arial, sans-serif; color: ${C.MUTED}; border-top: .5pt solid ${C.HAIR}; padding-top: 5pt; vertical-align: top; margin-top: .2in; }
    @bottom-right { content: ${q(m.footer.date + '   ')} counter(page); font: 7pt Arial, sans-serif; color: ${C.MUTED}; border-top: .5pt solid ${C.HAIR}; padding-top: 5pt; vertical-align: top; margin-top: .2in; } }
  @page :first { margin: 0; @top-left { content: none; border: 0; } @top-right { content: none; border: 0; } @bottom-left { content: none; border: 0; } @bottom-right { content: none; border: 0; } }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body { font: 9.5pt/1.5 Arial, Helvetica, sans-serif; color: #2B3438; }
  .cover { height: 11in; width: 8.5in; background: ${C.PRIMARY}; color: #fff; border-left: .29in solid ${C.ACCENT}; display: flex; flex-direction: column; page-break-after: always; break-after: page; }
  .cover .top { padding: .7in .75in 0 .71in; height: 1.05in; } .cover .mid { flex: 1; padding: 0 .75in 0 .71in; display: flex; flex-direction: column; justify-content: center; }
  .cover .det { padding: 0 .75in .5in .71in; min-height: 2.4in; } .cover .foot { background: ${C.DEEP}; margin-left: -.29in; border-left: .29in solid ${C.DEEP}; padding: .32in .75in .32in .71in; font-size: 7pt; letter-spacing: .08em; color: ${C.PALE}; }
  .cover .k { font-weight: 700; font-size: 8.5pt; letter-spacing: .16em; text-transform: uppercase; color: ${C.ACCENT}; } .cover .sk { font-size: 7.5pt; letter-spacing: .14em; text-transform: uppercase; color: ${C.PALE}; margin-top: 3pt; }
  .cover .eb { font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: ${C.ACCENT}; margin-bottom: 16pt; } .cover .tt { font-size: 46pt; line-height: 1.08; } .cover .rule { width: 1.4in; border-top: 2.25pt solid ${C.ACCENT}; margin: 22pt 0 14pt; }
  .cover .st { font-size: 17pt; } .cover .dt { color: ${C.PALE}; margin-top: 8pt; } .cover .lab { font-weight: 700; font-size: 7pt; letter-spacing: .16em; text-transform: uppercase; color: ${C.ACCENT}; margin-bottom: 3pt; } .cover .val { font-size: 10.5pt; margin-bottom: 17pt; }
  h1 { font-size: 20pt; line-height: 1.2; color: ${C.PRIMARY}; margin: 0 0 14pt; padding-bottom: 6pt; border-bottom: 1.5pt solid ${C.ACCENT}; page-break-before: always; break-before: page; }
  h1 .n { color: ${C.ACCENT}; margin-right: 12pt; } h1.first { page-break-before: auto; break-before: auto; }
  h2 { font-size: 12pt; color: ${C.PRIMARY}; margin: 12pt 0 7pt; break-after: avoid; }
  p { margin: 0 0 7.5pt; text-align: justify; } strong { color: ${C.PRIMARY}; }
  .eyebrow { font-weight: 700; font-size: 7pt; letter-spacing: .12em; text-transform: uppercase; color: ${C.ACCENT_D}; margin: 0 0 5pt; break-after: avoid; }
  .bul { position: relative; padding-left: 16pt; margin: 0 0 5.5pt; text-align: justify; } .bul::before { content: "•"; color: ${C.ACCENT}; position: absolute; left: 5pt; }
  .num { position: relative; padding-left: 17pt; margin: 0 0 6.5pt; text-align: justify; } .num > b { position: absolute; left: 0; color: ${C.ACCENT}; }
  .tiles { display: flex; gap: 6pt; margin: 0 0 13pt; break-inside: avoid; } .tile { flex: 1; background: ${C.TILE}; border-top: 2.25pt solid ${C.ACCENT}; padding: 8pt 8pt 8pt 9pt; }
  .tile .v { font-weight: 700; font-size: 18pt; line-height: 1.2; color: ${C.PRIMARY}; } .tile .l { font-weight: 700; font-size: 6.5pt; letter-spacing: .09em; text-transform: uppercase; color: ${C.ACCENT_D}; margin: 3pt 0; line-height: 1.25; } .tile .s { font-size: 7.5pt; color: ${C.MUTED}; line-height: 1.3; }
  .tile.dark { background: ${C.PRIMARY}; } .tile.dark .v { color: #fff; } .tile.dark .l { color: ${C.ACCENT}; } .tile.dark .s { color: ${C.PALE}; }
  .callout { background: ${C.CREAM}; border-left: 3.75pt solid ${C.ACCENT}; padding: 9pt 11pt 9pt 12pt; margin: 0 0 13pt; break-inside: avoid; font-size: 9pt; line-height: 1.45; color: ${C.PRIMARY}; } .callout p { margin: 0 0 4.5pt; } .callout p:last-child { margin: 0; }
  .banner { background: ${C.PRIMARY}; border-left: 4.5pt solid ${C.ACCENT}; color: #fff; font-weight: 700; font-size: 11pt; line-height: 1.45; padding: 10pt 12pt 10pt 13pt; margin: 0 0 13pt; break-inside: avoid; }
  figure { margin: 0 0 12pt; break-inside: avoid; } .cap { margin: 3pt 0 5pt; font-weight: 700; color: ${C.PRIMARY}; break-after: avoid; } .cap span { font-size: 7pt; letter-spacing: .12em; color: ${C.ACCENT_D}; margin-right: 10pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; line-height: 1.3; } th { background: ${C.PRIMARY}; color: #fff; font-size: 8pt; text-align: left; vertical-align: bottom; padding: 4.5pt 7pt; } td { padding: 3.5pt 7pt; border-bottom: .5pt solid ${C.HAIR}; vertical-align: top; }
  .r { text-align: right; } tr.total td { border-top: 1.5pt solid ${C.ACCENT}; border-bottom: 0; font-weight: 700; color: ${C.PRIMARY}; } td.bf { font-weight: 700; color: ${C.PRIMARY}; } table.sm { font-size: 8pt; } table.sm th { font-size: 7.5pt; padding: 4pt 4pt; } table.sm td { padding: 3pt 4pt; }
  .src { font-size: 6.5pt; line-height: 1.35; color: ${C.MUTED}; margin: 3pt 0 0; text-align: left; }
  .toc h1 { page-break-before: auto; break-before: auto; } .toc .t1 { font-weight: 700; color: ${C.PRIMARY}; margin: 9pt 0 2pt; } .toc .t1 .n { display: inline-block; width: 21pt; color: ${C.ACCENT}; } .toc .t2 { color: ${C.MUTED}; font-size: 8.5pt; margin: 0 0 1pt 21pt; }
  @media screen { body { background: #e9ecec; } .sheet { background: #fff; width: 8.5in; margin: 16px auto; padding: 1in; box-shadow: 0 1px 6px rgba(0,0,0,.15); } .cover { margin: 16px auto; } .hint { font: 13px Arial, sans-serif; text-align: center; padding: 10px; background: ${C.PRIMARY}; color: #fff; } }
  @media print { .hint { display: none; } }`;

  function html(model) {
    const c = model.cover, out = [], toc = [];
    let nfig = 0, ntab = 0;
    model.blocks.forEach((b) => {
      switch (b.t) {
        case 'h1': toc.push(`<div class="t1"><span class="n">${esc(b.num || '')}</span>${esc(b.title)}</div>`); out.push(`<h1>${b.num ? `<span class="n">${esc(b.num)}</span>` : ''}${esc(b.title)}</h1>`); break;
        case 'h2': toc.push(`<div class="t2">${esc(b.title)}</div>`); out.push(`<h2>${esc(b.title)}</h2>`); break;
        case 'p': out.push(`<p>${rich(b.text)}</p>`); break;
        case 'eyebrow': out.push(`<div class="eyebrow">${esc(b.text)}</div>`); break;
        case 'bullet': out.push(`<div class="bul">${rich(b.text)}</div>`); break;
        case 'num': out.push(`<div class="num"><b>${b.n}.</b><strong>${esc(b.lead)}</strong> ${rich(b.text)}</div>`); break;
        case 'tiles': out.push(`<div class="tiles">${b.items.map((t, k) => `<div class="tile${k ? '' : ' dark'}"><div class="v">${esc(t[0])}</div><div class="l">${esc(t[1])}</div><div class="s">${esc(t[2] || '')}</div></div>`).join('')}</div>`); break;
        case 'callout': out.push(`<div class="callout"><div class="eyebrow">${esc(b.label)}</div>${b.paras.map((t) => `<p>${rich(t)}</p>`).join('')}</div>`); break;
        case 'banner': out.push(`<div class="banner">${esc(b.text)}</div>`); break;
        case 'table': {
          ntab++; const al = b.align || ['l'].concat(b.headers.slice(1).map(() => 'r')), cls = (k) => (al[k] === 'r' ? ' class="r"' : '');
          out.push(`<figure><div class="cap"><span>TABLE ${ntab}</span>${esc(b.title)}</div><table${b.headers.length > 6 ? ' class="sm"' : ''}><thead><tr>${b.headers.map((h, k) => `<th${cls(k)}>${esc(h)}</th>`).join('')}</tr></thead><tbody>`
            + b.rows.map((r, ri) => `<tr${b.total && ri === b.rows.length - 1 ? ' class="total"' : ''}>${r.map((v, k) => `<td class="${al[k] === 'r' ? 'r' : ''}${b.boldFirst && !k ? ' bf' : ''}">${esc(v == null ? '' : v)}</td>`).join('')}</tr>`).join('')
            + `</tbody></table>${b.src ? `<p class="src">${esc(b.src)}</p>` : ''}</figure>`); break;
        }
        case 'chart': nfig++; out.push(`<figure><div class="cap"><span>FIGURE ${nfig}</span>${esc(b.title)}</div>${chart(b)}${b.src ? `<p class="src">${esc(b.src)}</p>` : ''}</figure>`); break;
        default: break;
      }
    });
    const cover = `<div class="cover"><div class="top"><div class="k">${esc(c.kicker)}</div><div class="sk">${esc(c.subKicker)}</div></div><div class="mid"><div class="eb">${esc(c.eyebrow)}</div>${c.titleLines.map((t) => `<div class="tt">${esc(t)}</div>`).join('')}<div class="rule"></div><div class="st">${esc(c.subtitle)}</div><div class="dt">${esc(c.date)}</div></div>`
      + `<div class="det">${c.details.map((d) => `<div class="lab">${esc(d[0])}</div><div class="val">${esc(d[1])}</div>`).join('')}</div><div class="foot">${esc(c.footer)}</div></div>`;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(model.fileName.replace(/\.docx$/, ''))}</title><style>${css(model)}</style></head><body>`
      + `<div class="hint">In the print dialog choose <b>Save as PDF</b>, paper size Letter, margins Default, and turn off "Headers and footers". Chrome or Edge give page numbers.</div>`
      + cover + `<div class="toc"><h1>Contents</h1>${toc.join('')}</div>` + out.join('') + '</body></html>';
  }

  const api = { html };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HAPrint = api;
})(typeof window !== 'undefined' ? window : globalThis);
