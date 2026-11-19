/*!
 * report-page.js — the /report page: pick a community, answer the analyst
 * questions, preview every exhibit, download the data pack.
 *
 * All arithmetic lives in report-engine.js (window.HAReport). This file only
 * loads bundles, keeps the form in step with the inputs object, and draws.
 * Exhibits are rendered as figure.card so export.js picks up the PNG and
 * Excel downloads on its own.
 */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, attrs, html) => { const e = document.createElement(tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const E = window.HAReport;
  const cache = {};
  const J = (url) => (cache[url] ||= fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }));

  // ── number formatting ────────────────────────────────────────────────────
  const N = (v, d) => v.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const FMT = {
    int: (v) => N(Math.round(v)), usd: (v) => (v < 0 ? '−$' : '$') + N(Math.abs(Math.round(v))),
    pct0: (v) => N(v, 0) + '%', pct1: (v) => N(v, 1) + '%', pctchg: (v) => (v >= 0 ? '+' : '−') + N(Math.abs(v), 1) + '%',
    num1: (v) => N(v, 1), num2: (v) => N(v, 2), signed1: (v) => (v >= 0 ? '+' : '−') + N(Math.abs(v), 1), signed2: (v) => (v >= 0 ? '+' : '−') + N(Math.abs(v), 2),
    auto: (v) => (Number.isInteger(v) ? N(v) : N(v, 1)), text: (v) => String(v),
  };
  function cell(c, colFmt) {
    if (c && typeof c === 'object') { if (c.text) return c.tone ? `<span class="rp-${c.tone}">${esc(c.text)}</span>` : esc(c.text); return cell(c.v, c.fmt || colFmt); }
    if (c == null || c === false || c === '') return '<span class="rp-na">—</span>';
    if (typeof c === 'number') return (FMT[colFmt] || FMT.auto)(c);
    return esc(c);
  }

  // ── charts: small dependency-free SVG, site palette ──────────────────────
  const INK = ['#231f20', '#f7941e', '#9c867a'], MUTED = '#d7d4cf', TXT = '#231f20', SUB = '#6d6e71', AXIS = '#a7a9ac';
  function svgChart(ex) {
    const c = ex.chart, W = 760, H = 330, L = 44, base = 262, top = 70, cats = c.categories, nCat = cats.length, band = (W - L - 40) / nCat;
    const f = FMT[c.fmt] || FMT.auto, ser = c.series, stacked = c.type === 'stacked', grouped = c.type === 'grouped';
    const totals = cats.map((_, i) => ser.reduce((s, sr) => s + (sr.values[i] || 0), 0));
    const peak = Math.max(1e-9, ...(stacked ? totals : ser.flatMap((sr) => sr.values.map((v) => v || 0))));
    const h = (v) => (v || 0) / peak * (base - top - 16);
    let o = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ex.title)}" font-family="inherit" font-size="12">`;
    if (ser.length > 1) ser.forEach((sr, i) => { const lx = L + i * 230; o += `<rect x="${lx}" y="16" width="10" height="10" fill="${INK[i % 3]}"/><text x="${lx + 16}" y="25" fill="${SUB}">${esc(sr.name)}</text>`; });
    o += `<line x1="${L}" y1="${base}" x2="${W - 40}" y2="${base}" stroke="${AXIS}"/>`;
    const tot = c.share ? totals.reduce((a, b) => a + b, 0) : 0;
    cats.forEach((cat, i) => {
      const x0 = L + i * band;
      if (stacked) {
        let y = base; const bw = band * 0.56, x = x0 + (band - bw) / 2;
        ser.forEach((sr, si) => { const v = sr.values[i] || 0; if (v > 0) { y -= h(v); o += `<rect x="${x}" y="${y}" width="${bw}" height="${h(v)}" fill="${si === 0 ? MUTED : INK[si === 1 ? 2 : 0]}"><title>${esc(cat)} · ${esc(sr.name)}: ${f(v)}</title></rect>`; } });
        o += `<text x="${x + bw / 2}" y="${base - h(totals[i]) - 6}" text-anchor="middle" fill="${TXT}">${ser.every((sr) => sr.values[i] == null) ? 'n/a' : f(totals[i])}</text>`;
      } else {
        const bw = grouped ? band * 0.8 / ser.length : band * 0.64, gx = x0 + (band - (grouped ? bw * ser.length : bw)) / 2;
        ser.forEach((sr, si) => {
          const v = sr.values[i], x = gx + (grouped ? si * bw : 0), w = grouped ? bw - 3 : bw;
          const fill = grouped ? INK[si % 3] : (c.muted || []).includes(i) ? MUTED : !c.highlight || c.highlight.includes(i) ? INK[0] : '#9a948a';
          if (v != null) o += `<rect x="${x}" y="${base - h(v)}" width="${w}" height="${h(v)}" fill="${fill}"><title>${esc(cat)}${grouped ? ' · ' + esc(sr.name) : ''}: ${f(v)}</title></rect>`;
          o += `<text x="${x + w / 2}" y="${base - h(v) - 6}" text-anchor="middle" fill="${TXT}" font-size="${grouped && ser.length > 2 ? 10.5 : 12}">${v == null ? '—' : f(v) + (c.share && tot ? ` (${N(v / tot * 100, 1)}%)` : '')}</text>`;
        });
      }
      const words = String(cat).split(' '), mid = Math.ceil(words.length / 2), wrap = String(cat).length > band / 6.2 && words.length > 1;
      const lines = wrap ? [words.slice(0, mid).join(' '), words.slice(mid).join(' ')] : [cat];
      lines.forEach((ln, li) => { o += `<text x="${x0 + band / 2}" y="${base + 18 + li * 14}" text-anchor="middle" fill="${SUB}" font-size="11">${esc(ln)}</text>`; });
    });
    (c.refs || []).forEach((rf, i) => { const x = L + rf.slot * band + band / 2, y = 44 + i * 22;
      o += `<line x1="${x}" y1="${y - 8}" x2="${x}" y2="${base - 22}" stroke="${AXIS}" stroke-dasharray="4 3"/><text x="${x - 8}" y="${y}" text-anchor="end" fill="${TXT}">${esc(rf.label)}: ${FMT.usd(rf.value)}</text>`; });
    if (c.range) {
      const ed = c.range.edges, pos = (v) => { let i = 0; while (i < ed.length - 1 && ed[i + 1] <= v) i++; const hiE = ed[i + 1] || ed[i] * 2; return L + i * band + band * 0.18 + (v - ed[i]) / (hiE - ed[i]) * band * 0.64; };
      const x1 = pos(c.range.lo), x2 = pos(c.range.hi);
      o += `<line x1="${x1}" y1="52" x2="${x2}" y2="52" stroke="#f7941e" stroke-width="3"/><text x="${Math.max(x2, 360)}" y="42" text-anchor="end" fill="${TXT}">${esc(c.range.label)}: ${FMT.usd(c.range.lo)} to ${FMT.usd(c.range.hi)}</text>`;
    }
    return o + '</svg>';
  }

  function renderExhibit(ex) {
    const fig = el('figure', { class: 'card rp-ex', 'data-export-figure': ex.title, id: 'ex-' + ex.id });
    let h = `<p class="rp-ex__num">Exhibit ${ex.number}</p><h3 class="rp-ex__title">${esc(ex.title)}</h3>`;
    if (ex.kind === 'chart') h += `<div class="rp-chart">${svgChart(ex)}</div>`;
    else {
      h += '<div class="rp-tblwrap"><table class="rp-tbl"><thead><tr>' + ex.columns.map((c, i) => `<th${i && c.fmt !== 'text' ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('') + '</tr></thead><tbody>'
        + ex.rows.map((r) => `<tr${/^Total/.test(String(r[0])) ? ' class="rp-total"' : ''}>` + r.map((c, i) => `<td${i && ex.columns[i] && ex.columns[i].fmt !== 'text' ? ' class="num"' : ''}>${cell(c, ex.columns[i] ? ex.columns[i].fmt : 'text')}</td>`).join('') + '</tr>').join('')
        + '</tbody></table></div>';
    }
    h += `<figcaption class="rp-src">${ex.source ? 'Source: ' + esc(ex.source) + '.' : ''}${ex.note ? ' ' + esc(ex.note) : ''}</figcaption>`;
    fig.innerHTML = h; return fig;
  }

  // ── inputs form ──────────────────────────────────────────────────────────
  const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const set = (o, path, v) => { const ks = path.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null) a[ks[i]] = {}; a = a[ks[i]]; } a[ks[ks.length - 1]] = v; };
  const deep = (base, over) => { for (const k of Object.keys(over || {})) { const v = over[k]; if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) deep(base[k], v); else base[k] = v; } return base; };
  const field = (label, path, opt) => `<label class="rp-f"><span>${label}</span><input data-path="${path}" data-kind="${(opt && opt.kind) || 'num'}" type="${opt && opt.kind === 'text' ? 'text' : 'number'}" step="${(opt && opt.step) || 'any'}"${opt && opt.ph ? ` placeholder="${opt.ph}"` : ''}></label>`;
  function formHTML() {
    const mixRow = (k, l) => `<tr><th>${l}</th>${[0, 1, 2].map((i) => `<td><input data-path="rental.mix.${k}.${i}" data-kind="num" type="number" min="0" step="1"></td>`).join('')}</tr>`;
    return `
    <details class="rp-sec" open><summary>Rental assumptions</summary><div class="rp-grid">
      ${field('Construction cost, 1 bedroom ($)', 'rental.cost.br1')}${field('Construction cost, 2 bedroom ($)', 'rental.cost.br2')}${field('Construction cost, 3 bedroom ($)', 'rental.cost.br3')}
      ${field('Capitalization rate (%)', 'rental.capRate', { kind: 'pct' })}${field('Operating expense ratio (%)', 'rental.opex', { kind: 'pct' })}${field('Utility allowance ($ a month)', 'rental.utilityAllowance')}
    </div><p class="rp-hint">Vertical construction only. Program mix, units at each income level:</p>
    <table class="rp-mix" data-table-export-ready="1"><thead><tr><th></th><th>80% AMI</th><th>100% AMI</th><th>120% AMI</th></tr></thead><tbody>${mixRow('br1', '1 bedroom')}${mixRow('br2', '2 bedroom')}${mixRow('br3', '3 bedroom')}</tbody></table></details>
    <details class="rp-sec"><summary>For-sale assumptions</summary><div class="rp-grid">
      ${field('Mortgage rate (%)', 'sale.rate', { kind: 'pct' })}${field('Down payment (%)', 'sale.down', { kind: 'pct' })}${field('Property tax rate (%)', 'sale.tax', { kind: 'pct' })}${field('Insurance ($ a year)', 'sale.insurance')}
    </div></details>
    <details class="rp-sec"><summary>HUD Fair Market Rents</summary><p class="rp-hint">Enter the county's current FMRs from huduser.gov. They are not in the pipeline yet.</p><div class="rp-grid">
      ${field('Fiscal year label', 'fmr.year', { kind: 'text', ph: 'FY2027' })}${field('Studio ($)', 'fmr.br0')}${field('1 bedroom ($)', 'fmr.br1')}${field('2 bedroom ($)', 'fmr.br2')}${field('3 bedroom ($)', 'fmr.br3')}${field('4 bedroom ($)', 'fmr.br4')}
    </div></details>
    <details class="rp-sec"><summary>Apartment inventory</summary><p class="rp-hint">One row per apartment property, from HUD, USDA and state records. Untick "restricted" for a market-rate property.</p>
      <table class="rp-inv" data-table-export-ready="1"><thead><tr><th>Property</th><th>Built</th><th>Units</th><th>Program</th><th>Restricted</th><th></th></tr></thead><tbody data-inv></tbody></table>
      <button type="button" class="link-btn" data-add-inv>+ Add a property</button></details>
    <details class="rp-sec"><summary>Proposed development (optional)</summary><div class="rp-grid">
      ${field('Project name', 'project.name', { kind: 'text' })}${field('Builder', 'project.builder', { kind: 'text' })}${field('Number of homes', 'project.homes')}${field('Average sale price ($)', 'project.price')}${field('Infrastructure request ($)', 'project.infraRequest')}
    </div></details>
    <details class="rp-sec"><summary>Program limits</summary><div class="rp-grid">
      ${field('Program name', 'program.name', { kind: 'text' })}${field('Infrastructure grant cap ($)', 'program.infraCap')}${field('Construction finance cap ($)', 'program.financeCap')}
    </div></details>
    <details class="rp-sec"><summary>Analyst notes</summary><textarea data-path="notes" data-kind="text" rows="4" placeholder="Anything the writer should know: which facilities are the group quarters, local employers, what the phone survey found…"></textarea></details>`;
  }

  // ── state ────────────────────────────────────────────────────────────────
  let index = null, meta = null, usStates = null, mode = 'city', ctx = null, inputs = null, pack = null;
  const result = $('[data-result]'), LS = (g) => 'ha-report:' + g;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const load = (g) => { try { const s = localStorage.getItem(LS(g)); if (s) return JSON.parse(s); } catch (e) { /* storage unavailable */ } return null; };
  const save = (g) => { try { localStorage.setItem(LS(g), JSON.stringify(inputs)); } catch (e) { /* storage unavailable */ } };

  function fillForm(root) {
    root.querySelectorAll('[data-path]').forEach((inp) => {
      const v = get(inputs, inp.dataset.path), k = inp.dataset.kind;
      inp.value = v == null ? '' : k === 'pct' ? +(v * 100).toFixed(4) : v;
    });
    const tb = $('[data-inv]', root); tb.innerHTML = '';
    (inputs.inventory || []).forEach((p, i) => {
      const tr = el('tr', {}, ['name', 'built', 'units', 'program'].map((k) => `<td><input data-inv-field="${k}" data-i="${i}" type="${k === 'units' ? 'number' : 'text'}" value="${esc(p[k] == null ? '' : p[k])}"></td>`).join('')
        + `<td class="rp-c"><input type="checkbox" data-inv-field="restricted" data-i="${i}"${p.restricted === false ? '' : ' checked'}></td><td><button type="button" class="link-btn" data-del-inv="${i}" aria-label="Remove">×</button></td>`);
      tb.appendChild(tr);
    });
  }
  function readInput(inp) {
    if (inp.dataset.invField) {
      const p = inputs.inventory[+inp.dataset.i], k = inp.dataset.invField;
      p[k] = k === 'restricted' ? inp.checked : k === 'units' ? (inp.value === '' ? null : Number(inp.value)) : inp.value;
      return;
    }
    const k = inp.dataset.kind, raw = inp.value.trim();
    set(inputs, inp.dataset.path, k === 'text' ? raw : raw === '' ? null : k === 'pct' ? Number(raw) / 100 : Number(raw));
  }

  let timer = null;
  function recompute() {
    pack = E.buildPack(ctx, inputs); save(ctx.target.geoid);
    if (ctx.hpi) pack.facts.hpi = ctx.hpi;
    const out = $('[data-pack]'); out.innerHTML = '';
    const sev = { high: 'Must address', medium: 'Check', low: 'Note', info: 'Evidence' };
    const fl = el('section', { class: 'rp-flags' }, `<h2>What to watch in this community</h2><p class="rp-hint">Conditions the engine found that change how the numbers should be read. They travel with the data pack.</p>`
      + (pack.flags.length ? '<ul>' + pack.flags.map((f) => `<li class="rp-flag rp-flag--${f.severity}"><span class="rp-flag__sev">${sev[f.severity]}</span><div><strong>${esc(f.title)}</strong>${f.detail ? `<p>${esc(f.detail)}</p>` : ''}${f.effect ? `<p class="rp-flag__fx">${esc(f.effect)}</p>` : ''}</div></li>`).join('') + '</ul>' : '<p>No flags.</p>'));
    out.appendChild(fl);
    const exs = el('section', { class: 'rp-exhibits' }, `<h2>Exhibits</h2><p class="rp-hint">${pack.exhibits.length} exhibits. Hover a chart or table for its download buttons.</p>`);
    pack.exhibits.forEach((ex) => exs.appendChild(renderExhibit(ex)));
    out.appendChild(exs);
    if (window.HAExport && window.HAExport.rescan) window.HAExport.rescan();
  }

  // The Word report: rule-written narrative (report-narrative.js) laid out by report-docx.js.
  let skeleton = null;
  async function word(btn) {
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'Building report…';
    try {
      if (!skeleton) skeleton = await J(result.dataset.skeleton || '/report-template/skeleton.json');
      const model = window.HANarrative.build(pack), out = window.HADocx.build(model, skeleton);
      const blob = new Blob([out.bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const a = el('a', { href: URL.createObjectURL(blob), download: model.fileName });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { console.error(e); btn.textContent = 'Could not build the report'; setTimeout(() => { btn.textContent = label; }, 4000); btn.disabled = false; return; }
    btn.textContent = label; btn.disabled = false;
  }

  // The PDF: the same report as a print page in a new tab, saved through the browser's print dialog.
  function pdf(btn) {
    const label = btn.textContent;
    try {
      const w = window.open('', '_blank');
      if (!w) throw new Error('pop-up blocked');
      w.document.open(); w.document.write(window.HAPrint.html(window.HANarrative.build(pack))); w.document.close(); w.focus();
      setTimeout(() => { try { w.print(); } catch (e) { /* the tab stays open; the user can print it */ } }, 700);
    } catch (e) { console.error(e); btn.textContent = e.message === 'pop-up blocked' ? 'Allow pop-ups for this site, then try again' : 'Could not build the report'; setTimeout(() => { btn.textContent = label; }, 5000); }
  }

  function download() {
    const blob = new Blob([JSON.stringify(pack, null, 1)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `housing-report-pack-${pack.target.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${pack.target.state_fips}.json` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function pick(geoid, st, kind) {
    result.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const [rep, mas, ana] = await Promise.all([J(`/report-data/states/${st}.json`), J(`/master-data/states/${st}.json`).catch(() => ({ places: {}, counties: {} })), J(`/analysis-data/states/${st}.json`).catch(() => ({ places: {}, counties: {} }))]);
      const place = kind === 'place', rec = (place ? rep.places : rep.counties)[geoid];
      if (!rec) { result.innerHTML = '<p class="muted">No report data for that community.</p>'; return; }
      const cf = place ? rec.county : null;
      ctx = {
        target: { kind, geoid, rec, master: (place ? mas.places : mas.counties)[geoid] || null },
        county: cf && rep.counties[cf] ? { kind: 'county', geoid: cf, rec: rep.counties[cf], master: mas.counties[cf] || null } : null,
        state: Object.assign({}, rep.state, { master: usStates[st] || null }),
        model: ((place ? ana.places : ana.counties)[geoid] || {}).model || null,
        countyModel: cf ? (ana.counties[cf] || {}).model || null : null, meta,
      };
      inputs = deep(clone(E.DEFAULTS), load(geoid) || {});
      // Public sources carried in the report data fill any input the analyst has not set.
      const crec = place ? (cf && rep.counties[cf]) || {} : rec, cname = (crec.f && crec.f.county_name) || '';
      if (!inputs.fmr.br2 && crec.fmr) inputs.fmr = Object.assign({ year: (meta.sources && meta.sources.fmr_year) || '' }, crec.fmr);
      if (!inputs.inventory.length && rec.inv) inputs.inventory = rec.inv.map((p) => ({ name: p[0], built: p[1] || '', units: p[2], program: p[3], restricted: true }));
      const mort = meta.sources && meta.sources.mortgage;
      if (mort && mort.rate && inputs.sale.rate === E.DEFAULTS.sale.rate) { inputs.sale.rate = mort.rate; inputs.sale.rateAsOf = mort.date; }
      ctx.hpi = crec.hpi ? { area: cname, from: crec.hpi[0], to: crec.hpi[1], change_pct: crec.hpi[2], proxy: false } : null;
      const nm = rec.f.place_name || rec.f.county_name || rec.f.name;
      result.innerHTML = `<div class="hg-head"><div class="hg-kick">Report builder</div><h2 class="hg-title">${esc(nm)}, ${esc(rec.f.state_name)}</h2>
        <p class="hg-sub">${place && ctx.county ? 'Compared with ' + esc(ctx.county.rec.f.county_name) + ' and ' : 'Compared with '}${esc(rec.f.state_name)} · ${esc(meta.acs_label)}</p></div>
        <div class="rp-bar"><button type="button" class="btn" data-word>Download Word report</button><button type="button" class="btn" data-pdf>Download PDF report</button><button type="button" class="link-btn" data-download>Download data pack</button><button type="button" class="link-btn" data-reset>Reset inputs to defaults</button></div>
        <section class="rp-inputs"><h2>Analyst inputs</h2><p class="rp-hint">Saved in this browser for this community. Every change recomputes the exhibits below.</p>${formHTML()}</section><div data-pack></div>`;
      fillForm(result); recompute();
      history.replaceState(null, '', `?geo=${geoid}&mode=${place ? 'city' : 'county'}`);
    } catch (e) { result.innerHTML = `<p class="muted">Could not load the report data (${esc(e.message)}).</p>`; }
  }

  result.addEventListener('input', (e) => { const t = e.target; if (!t.dataset.path && !t.dataset.invField) return; readInput(t); clearTimeout(timer); timer = setTimeout(recompute, 350); });
  result.addEventListener('click', (e) => {
    const t = e.target;
    if (t.matches('[data-word]')) word(t);
    else if (t.matches('[data-pdf]')) pdf(t);
    else if (t.matches('[data-download]')) download();
    else if (t.matches('[data-reset]')) { inputs = clone(E.DEFAULTS); fillForm(result); recompute(); }
    else if (t.matches('[data-add-inv]')) { inputs.inventory.push({ name: '', built: '', units: null, program: '', restricted: true }); fillForm(result); }
    else if (t.dataset.delInv != null) { inputs.inventory.splice(+t.dataset.delInv, 1); fillForm(result); recompute(); }
  });

  // ── picker ───────────────────────────────────────────────────────────────
  (async function init() {
    try { [index, meta, usStates] = await Promise.all([J('/analysis-data/index.json'), J('/report-data/meta.json'), J('/master-data/us-states.json').catch(() => ({}))]); }
    catch (e) { $('.gen').innerHTML = '<p class="muted">The report data isn’t built yet. It is produced by <code>npm run report-data</code> during the site build.</p>'; return; }
    const lists = { city: index.places || [], county: index.counties || [] };
    const box = $('[data-target-search]'), input = $('input', box), out = $('.search__results', box);
    const score = (p, q) => { const a = p.name.toLowerCase(), s = (p.state_name || '').toLowerCase(); return a.startsWith(q) ? 0 : a.includes(q) ? 1 : s.startsWith(q) ? 2 : 9; };
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { out.hidden = true; out.innerHTML = ''; return; }
      const m = lists[mode].map((p) => ({ p, s: score(p, q) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s || a.p.name.localeCompare(b.p.name)).slice(0, 10).map((x) => x.p);
      out.hidden = !m.length;
      out.innerHTML = m.map((p) => `<li><a href="#" data-geoid="${p.geoid}" data-st="${p.state_fips}"><span>${esc(p.name)}</span><span class="muted">${esc(p.state_name || '')}</span></a></li>`).join('');
    });
    out.addEventListener('click', (e) => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); out.hidden = true; input.value = a.querySelector('span').textContent; pick(a.dataset.geoid, a.dataset.st, mode === 'city' ? 'place' : 'county'); });
    input.addEventListener('blur', () => setTimeout(() => { out.hidden = true; }, 200));
    document.querySelectorAll('.toggle__btn').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.mode; document.querySelectorAll('.toggle__btn').forEach((x) => x.classList.toggle('is-active', x === b));
      input.value = ''; input.placeholder = mode === 'city' ? 'Search a city — e.g. McRae-Helena, Sandersville…' : 'Search a county — e.g. Telfair, Washington…';
    }));
    const qs = new URLSearchParams(location.search), geo = qs.get('geo');
    if (geo) { mode = qs.get('mode') === 'county' ? 'county' : 'city'; document.querySelectorAll('.toggle__btn').forEach((x) => x.classList.toggle('is-active', x.dataset.mode === mode)); pick(geo, geo.slice(0, 2), mode === 'city' ? 'place' : 'county'); }
  })();
})();
