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
  const geoFile = (prefix, gid) => getJSON(`${BASE}/geo/${prefix}-${gid}.json`);

  // ---- data path: assemble the model. mode = 'city' | 'county'. ----
  async function buildModel(targetGeoid, peerGeoids, index, mode) {
    const list = mode === 'county' ? index.counties : index.places;
    const pfx = mode === 'county' ? 'county' : 'place';
    const byGeoid = Object.fromEntries(list.map((p) => [p.geoid, p]));
    const t = byGeoid[targetGeoid];
    if (!t) throw new Error('Unknown target');
    const vintages = index.vintages;
    const records = {};

    const target = await geoFile(pfx, t.geoid);
    records.target = { role: 'target', label: clean(t.name), byVintage: target.byVintage };

    if (mode !== 'county' && t.county_fips) {
      try { const c = await geoFile('county', t.county_fips);
        records.county = { role: 'county', label: stripState(c.name), byVintage: c.byVintage }; } catch (e) {}
    }
    if (t.cbsa) {
      try { const c = await geoFile('cbsa', t.cbsa);
        records.msa = { role: 'msa', label: (t.cbsa_title || c.name) + ' (MSA)', byVintage: c.byVintage }; } catch (e) {}
    }
    if (t.state_fips) {
      try { const s = await geoFile('state', t.state_fips);
        records.state = { role: 'state', label: s.name, byVintage: s.byVintage }; } catch (e) {}
    }
    for (const gid of peerGeoids) {
      const p = byGeoid[gid]; if (!p) continue;
      try { const g = await geoFile(pfx, gid);
        records['peer_' + gid] = { role: 'peer', label: clean(p.name), byVintage: g.byVintage }; } catch (e) {}
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
    const maxFields = Math.max(...tab.sections.map((s) => s.fields.length));
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
      [''],
      ['Not included (deferred): income by age (B19037), HUD FMR/CHAS, LEHD commuting, Woods & Poole/ARC forecasts, SchoolDigger, Zillow, crime.'],
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
