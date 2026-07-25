/* master-generator.js — client-side Community Data Sheet generator.
 * Loads prebuilt per-geography JSON + schema, assembles the model, and writes a
 * STYLED .xlsx in the browser with ExcelJS (global ExcelJS from the vendored
 * bundle). Shading/fills/borders in the EIG palette; number formats per field.
 */
(function () {
  const BASE = '/master-data';

  // EIG palette (ARGB) + shared styles
  const NAVY = 'FF003057', GOLD = 'FFB3A369', CREAM = 'FFF9F6E5', CREAM2 = 'FFEFE9D6',
        CHARCOAL = 'FF545B5A', WHITE = 'FFFFFFFF';
  const THIN = { style: 'thin', color: { argb: 'FFD6DBD4' } };
  const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  const navyFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  const creamHdr = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM2 } };
  const targetFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } };

  const numFmt = (u) => u === 'dollars' ? '$#,##0' : u === 'years' ? '0.0'
    : (u === 'share' || u === 'rate') ? '0.0%' : '#,##0';
  const Z_CHG = '0.0%;(0.0%)';
  const changeFor = (u, a, b) => {
    if (a == null || b == null) return null;
    if (u === 'share' || u === 'rate') return b - a;
    if (a === 0) return null;
    return (b - a) / Math.abs(a);
  };
  const clean = (name) => (name || '').replace(/ (city|town|village|CDP|borough|municipality|urban county|consolidated government|metropolitan government)$/i, '').trim();
  const stripState = (n) => (n || '').replace(/,\s*[^,]+$/, '').trim();

  async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(`Not found: ${url}`); return r.json(); }
  // Data is bundled: one file per state (places + counties) plus national
  // cbsas.json and us-states.json. Cache each bundle after first fetch.
  const _cache = {};
  const cached = (key, fn) => (_cache[key] || (_cache[key] = fn()));
  const stateBundle = (fips) => cached('st' + fips, () => getJSON(`${BASE}/states/${fips}.json`));
  const cbsaBundle = () => cached('cbsas', () => getJSON(`${BASE}/cbsas.json`));
  const usStates = () => cached('usstates', () => getJSON(`${BASE}/us-states.json`));

  // ---- data path: assemble the model. mode = 'city' | 'county'. ----
  async function buildModel(targetGeoid, peerGeoids, index, mode) {
    const list = mode === 'county' ? index.counties : index.places;
    const key = mode === 'county' ? 'counties' : 'places';
    const byGeoid = Object.fromEntries(list.map((p) => [p.geoid, p]));
    const t = byGeoid[targetGeoid];
    if (!t) throw new Error('Unknown target');
    const vintages = index.vintages;
    const records = {};

    const tBundle = await stateBundle(t.state_fips);
    const targetRec = tBundle[key][t.geoid];
    if (!targetRec) throw new Error('No data for target');
    records.target = { role: 'target', label: clean(t.name), byVintage: targetRec.byVintage };

    // City targets also show their parent county; a county target IS the county.
    if (mode !== 'county' && t.county_fips) {
      const c = tBundle.counties[t.county_fips];
      if (c) records.county = { role: 'county', label: stripState(c.name), byVintage: c.byVintage };
    }
    if (t.cbsa) {
      try { const cb = (await cbsaBundle())[t.cbsa];
        if (cb) records.msa = { role: 'msa', label: (t.cbsa_title || cb.name) + ' (MSA)', byVintage: cb.byVintage }; } catch (e) {}
    }
    if (t.state_fips) {
      try { const s = (await usStates())[t.state_fips];
        if (s) records.state = { role: 'state', label: s.name, byVintage: s.byVintage }; } catch (e) {}
    }
    for (const gid of peerGeoids) {
      const p = byGeoid[gid]; if (!p) continue;
      try { const b = await stateBundle(p.state_fips); const rec = b[key][gid];
        if (rec) records['peer_' + gid] = { role: 'peer', label: clean(p.name), byVintage: rec.byVintage }; } catch (e) {}
    }
    return { vintages, records };
  }

  // ---- styled worksheet ----
  function styleSheet(ws, tab, model) {
    const { records, vintages } = model;
    const target = Object.values(records).find((r) => r.role === 'target');
    const contextKeys = ['target', 'county', 'msa', 'state'].filter((k) => records[k]);
    const peerKeys = Object.keys(records)
      .filter((k) => records[k].role === 'target' || records[k].role === 'peer')
      .sort((a, b) => records[a].label.localeCompare(records[b].label));
    const V = vintages.length;
    const maxFields = Math.max(...tab.sections.map((s) => (s.fields ? s.fields.length : 0)));
    const lastCol = 2 + maxFields * (V + 1);
    ws.columns = [{ width: 2 }, { width: 26 }].concat(Array.from({ length: lastCol - 2 }, () => ({ width: 12 })));

    let r = 1;
    const C = (row, col) => ws.getCell(row, col);
    const fillRange = (row, c1, c2, fill) => { for (let c = c1; c <= c2; c++) C(row, c).fill = fill; };

    // title + subtitle
    C(r, 2).value = `${tab.name} — ${target ? target.label : ''}`;
    C(r, 2).font = { bold: true, size: 14, color: { argb: NAVY } }; r++;
    const peerNames = peerKeys.filter((k) => records[k].role === 'peer').map((k) => records[k].label).join(', ');
    C(r, 2).value = `Target: ${target ? target.label : ''}   ·   Comparison: ${peerNames}   ·   ACS 5-Year: ${vintages.join(' / ')}`;
    C(r, 2).font = { italic: true, size: 9, color: { argb: CHARCOAL } }; r += 2;

    for (const section of tab.sections) {
      // Cross-tab (matrix) section: age cohort (rows) × income band (cols),
      // single-vintage shares. Rendered in the same EIG house style.
      if (section.kind === 'matrix') {
        const yr = section.vintage || vintages[V - 1];
        const nb = section.buckets.length;
        const secCols = 3 + nb; // col2 geography, col3 cohort, then one col per bucket
        C(r, 2).value = `${section.title}  (${yr})`; C(r, 2).font = { bold: true, size: 12, color: { argb: NAVY } };
        for (let c = 2; c <= secCols; c++) C(r, c).border = { bottom: { style: 'medium', color: { argb: GOLD } } };
        r++;
        // header row (navy): Geography | Age Cohort | bucket labels
        const hr = r;
        C(hr, 2).value = 'Geography'; C(hr, 3).value = 'Age Cohort';
        [2, 3].forEach((c) => { const x = C(hr, c); x.font = { bold: true, color: { argb: WHITE } }; x.fill = navyFill; x.border = BORDER; });
        section.buckets.forEach((b, j) => { const x = C(hr, 4 + j); x.value = b.label; x.font = { bold: true, color: { argb: WHITE } }; x.alignment = { horizontal: 'center' }; x.fill = navyFill; x.border = BORDER; });
        r++;
        const emitMatrix = (key) => {
          const rec = records[key]; const isTarget = rec.role === 'target';
          section.cohorts.forEach((coh, ci) => {
            C(r, 2).value = ci === 0 ? rec.label : ''; C(r, 2).font = { bold: isTarget }; C(r, 2).border = BORDER;
            C(r, 3).value = coh.label; C(r, 3).border = BORDER;
            section.buckets.forEach((_b, j) => {
              const c = C(r, 4 + j);
              const v = rec.byVintage[yr] ? rec.byVintage[yr][`incage_${coh.id}_${j}`] : null;
              if (v != null) { c.value = v; c.numFmt = '0.0%'; }
              c.alignment = { horizontal: 'right' }; c.border = BORDER;
            });
            if (isTarget) fillRange(r, 2, secCols, targetFill);
            r++;
          });
        };
        C(r, 2).value = 'Geographic context'; C(r, 2).font = { bold: true, italic: true, size: 10, color: { argb: CHARCOAL } }; r++;
        contextKeys.forEach(emitMatrix);
        r++;
        C(r, 2).value = 'Comparison communities'; C(r, 2).font = { bold: true, italic: true, size: 10, color: { argb: CHARCOAL } }; r++;
        peerKeys.forEach(emitMatrix);
        r++;
        C(r, 2).value = `Source: ${section.source}`; C(r, 2).font = { italic: true, size: 8, color: { argb: CHARCOAL } }; r += 2;
        continue;
      }
      const secCols = 2 + section.fields.length * (V + 1);
      // section title with gold underline
      C(r, 2).value = section.title; C(r, 2).font = { bold: true, size: 12, color: { argb: NAVY } };
      for (let c = 2; c <= secCols; c++) C(r, c).border = { bottom: { style: 'medium', color: { argb: GOLD } } };
      r++;
      // field-label header (merged, navy)
      const hr = r;
      section.fields.forEach((f, i) => {
        const start = 3 + i * (V + 1);
        ws.mergeCells(hr, start, hr, start + V);
        const c = C(hr, start); c.value = f.label; c.font = { bold: true, color: { argb: WHITE } };
        c.alignment = { horizontal: 'center' };
        for (let k = start; k <= start + V; k++) { C(hr, k).fill = navyFill; C(hr, k).border = BORDER; }
      });
      r++;
      // vintage header (cream)
      const vr = r;
      C(vr, 2).value = 'Geography'; C(vr, 2).font = { bold: true, color: { argb: NAVY } }; C(vr, 2).fill = creamHdr; C(vr, 2).border = BORDER;
      section.fields.forEach((f, i) => {
        const start = 3 + i * (V + 1);
        vintages.forEach((y, j) => { const c = C(vr, start + j); c.value = String(y); c.font = { bold: true }; c.alignment = { horizontal: 'center' }; c.fill = creamHdr; c.border = BORDER; });
        const c = C(vr, start + V); c.value = '% Change'; c.font = { bold: true }; c.alignment = { horizontal: 'center' }; c.fill = creamHdr; c.border = BORDER;
      });
      r++;

      const emit = (key) => {
        const rec = records[key]; const isTarget = rec.role === 'target';
        C(r, 2).value = rec.label; C(r, 2).font = { bold: isTarget }; C(r, 2).border = BORDER;
        section.fields.forEach((f, i) => {
          const start = 3 + i * (V + 1);
          vintages.forEach((y, j) => {
            const c = C(r, start + j);
            const v = rec.byVintage[y] ? rec.byVintage[y][f.id] : null;
            if (v != null) { c.value = v; c.numFmt = numFmt(f.unit); }
            c.alignment = { horizontal: 'right' }; c.border = BORDER;
          });
          const cc = C(r, start + V);
          const a = rec.byVintage[vintages[0]] ? rec.byVintage[vintages[0]][f.id] : null;
          const b = rec.byVintage[vintages[V - 1]] ? rec.byVintage[vintages[V - 1]][f.id] : null;
          const ch = changeFor(f.unit, a, b);
          if (ch != null) { cc.value = ch; cc.numFmt = Z_CHG; }
          cc.alignment = { horizontal: 'right' }; cc.border = BORDER; cc.font = { color: { argb: CHARCOAL } };
        });
        if (isTarget) fillRange(r, 2, secCols, targetFill);
        r++;
      };

      C(r, 2).value = 'Geographic context'; C(r, 2).font = { bold: true, italic: true, size: 10, color: { argb: CHARCOAL } }; r++;
      contextKeys.forEach(emit);
      r++;
      C(r, 2).value = 'Comparison communities'; C(r, 2).font = { bold: true, italic: true, size: 10, color: { argb: CHARCOAL } }; r++;
      peerKeys.forEach(emit);
      r++;
      C(r, 2).value = `Source: ${section.source}`; C(r, 2).font = { italic: true, size: 8, color: { argb: CHARCOAL } }; r += 2;
    }
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 0 }];
  }

  function notesSheet(ws, model, schema) {
    const t = Object.values(model.records).find((r) => r.role === 'target');
    ws.columns = [{ width: 110 }];
    const rows = [
      ['Master Working Data Sheet — census (core-ACS) generator'],
      [`Target: ${t ? t.label : ''}`],
      [`ACS 5-Year vintages: ${schema.vintages.join(', ')}`],
      [''],
      ['Conventions'],
      ['  "Per Capita Income" (Community Profile) = ACS B19301.'],
      ['  Educational attainment shown cumulatively ("HS or higher", etc.); "Graduate/Professional" is the graduate-degree count.'],
      ['  Vacant "Other" = total vacant − for-rent − for-sale-only.'],
      ['  Change: percentage-point difference for shares/rates; proportional for counts, dollars, ages.'],
      ['  Blank cells = ACS suppressed the estimate (small place / older vintage).'],
      ['  Income by Age Cohort (B19037): share of each age cohort\'s households in the income band (rows sum to 100%); latest vintage only.'],
      [''],
      ['Not included (deferred): HUD FMR/CHAS, LEHD commuting, Woods & Poole/ARC forecasts, SchoolDigger, Zillow, crime.'],
      [''],
      ['Source: U.S. Census Bureau, American Community Survey 5-Year Estimates. Generated by housinganalytics.org.'],
    ];
    rows.forEach((row) => ws.addRow(row));
    ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: NAVY } };
    ws.getCell(5, 1).font = { bold: true, color: { argb: NAVY } };
  }

  async function generate(targetGeoid, peerGeoids, index, schema, mode) {
    const model = await buildModel(targetGeoid, peerGeoids, index, mode);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'housinganalytics.org';
    for (const tab of schema.tabs) styleSheet(wb.addWorksheet(tab.name), tab, model);
    notesSheet(wb.addWorksheet('Notes'), model, schema);

    const target = model.records.target.label.replace(/[^\w -]/g, '');
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Master Sheet - ${target}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  window.MasterGen = { generate, buildModel };
})();
