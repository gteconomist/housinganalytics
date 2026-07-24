/* master-generator.js — client-side Community Data Sheet generator.
 * Loads prebuilt per-geography JSON + schema, assembles the model, and writes
 * the .xlsx in the browser with SheetJS (global XLSX from CDN). Mirrors
 * scripts/build-master-xlsx.mjs so the on-site output matches the CLI output.
 */
(function () {
  const BASE = '/data/master';
  const zFor = (u) => u === 'dollars' ? '$#,##0' : u === 'years' ? '0.0'
    : (u === 'share' || u === 'rate') ? '0.0%' : '#,##0';
  const Z_CHG = '0.0%;(0.0%)';
  const changeFor = (u, a, b) => {
    if (a == null || b == null) return null;
    if (u === 'share' || u === 'rate') return b - a;
    if (a === 0) return null;
    return (b - a) / Math.abs(a);
  };
  const clean = (name) => (name || '').replace(/ (city|town|village|CDP|borough|municipality|urban county|consolidated government|metropolitan government)$/i, '').trim();
  const stripState = (n) => (n || '').replace(/,\s*[A-Za-z .]+$/, '').trim();

  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Not found: ${url}`);
    return r.json();
  }
  const geoFile = (prefix, gid) => getJSON(`${BASE}/geo/${prefix}-${gid}.json`);

  // Build the model the workbook writer consumes.
  async function buildModel(targetGeoid, peerGeoids, index) {
    const byGeoid = Object.fromEntries(index.places.map((p) => [p.geoid, p]));
    const t = byGeoid[targetGeoid];
    if (!t) throw new Error('Unknown target');
    const vintages = index.vintages;
    const records = {};

    const target = await geoFile('place', t.geoid);
    records.target = { role: 'target', label: clean(t.name), byVintage: target.byVintage };

    if (t.county_fips) {
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
      try { const g = await geoFile('place', gid);
        records['peer_' + gid] = { role: 'peer', label: clean(p.name), byVintage: g.byVintage }; } catch (e) {}
    }
    return { vintages, records };
  }

  // ---- workbook construction (mirrors build-master-xlsx.mjs) ----
  function buildSheet(tab, model) {
    const { records, vintages } = model;
    const target = Object.values(records).find((r) => r.role === 'target');
    const contextKeys = ['target', 'county', 'msa', 'state'].filter((k) => records[k]);
    const peerKeys = Object.keys(records)
      .filter((k) => records[k].role === 'target' || records[k].role === 'peer')
      .sort((a, b) => records[a].label.localeCompare(records[b].label));

    const rows = [], merges = [];
    const S = (v) => (v == null ? '' : { v, t: 's' });
    const N = (v, z) => (v == null ? '' : { v, t: 'n', z });
    const peerNames = peerKeys.filter((k) => records[k].role === 'peer').map((k) => records[k].label).join(', ');

    rows.push([S(`${tab.name} — ${target ? target.label : ''}`)]);
    rows.push([S(`Target: ${target ? target.label : ''}   ·   Comparison: ${peerNames}   ·   ACS 5-Year: ${vintages.join(' / ')}`)]);
    rows.push([]);

    for (const section of tab.sections) {
      rows.push([S(section.title)]);
      const h1 = ['', ''];
      section.fields.forEach((f, i) => {
        const start = 2 + i * (vintages.length + 1);
        h1[start] = S(f.label);
        merges.push({ s: { r: rows.length, c: start }, e: { r: rows.length, c: start + vintages.length } });
      });
      rows.push(h1);
      const h2 = ['', S('Geography')];
      section.fields.forEach((f, i) => {
        const start = 2 + i * (vintages.length + 1);
        vintages.forEach((y, j) => (h2[start + j] = S(String(y))));
        h2[start + vintages.length] = S('% Change');
      });
      rows.push(h2);

      const emit = (key) => {
        const r = records[key];
        const arr = ['', S(r.label)];
        section.fields.forEach((f, i) => {
          const start = 2 + i * (vintages.length + 1);
          vintages.forEach((y, j) => (arr[start + j] = N(r.byVintage[y] ? r.byVintage[y][f.id] : null, zFor(f.unit))));
          const a = r.byVintage[vintages[0]] ? r.byVintage[vintages[0]][f.id] : null;
          const b = r.byVintage[vintages[vintages.length - 1]] ? r.byVintage[vintages[vintages.length - 1]][f.id] : null;
          arr[start + vintages.length] = N(changeFor(f.unit, a, b), Z_CHG);
        });
        rows.push(arr);
      };
      rows.push([S('  Geographic context')]);
      contextKeys.forEach(emit);
      rows.push([]);
      rows.push([S('  Comparison communities')]);
      peerKeys.forEach(emit);
      rows.push([]);
      rows.push(['', S(`Source: ${section.source}`)]);
      rows.push([]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (c === '' || c == null ? null : (typeof c === 'object' ? c.v : c)))));
    rows.forEach((r, ri) => r.forEach((c, ci) => {
      if (c && typeof c === 'object') {
        const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
        ws[addr] = { t: c.t, v: c.v };
        if (c.z) ws[addr].z = c.z;
      }
    }));
    ws['!merges'] = merges;
    ws['!cols'] = [{ wch: 2 }, { wch: 22 }].concat(Array.from({ length: 40 }, () => ({ wch: 11 })));
    return ws;
  }

  function notesSheet(model, schema) {
    const t = Object.values(model.records).find((r) => r.role === 'target');
    const rows = [
      ['Master Working Data Sheet — census (core-ACS) generator'],
      [`Target: ${t ? t.label : ''}`],
      [`ACS 5-Year vintages: ${schema.vintages.join(', ')}`],
      [],
      ['Conventions'],
      ['  "Per Capita Income" (Community Profile) = ACS B19301.'],
      ['  Educational attainment shown cumulatively ("HS or higher", etc.); "Graduate/Professional" is the graduate-degree count.'],
      ['  Vacant "Other" = total vacant − for-rent − for-sale-only.'],
      ['  Change: percentage-point difference for shares/rates; proportional for counts, dollars, ages.'],
      ['  Blank cells = ACS suppressed the estimate (small place / older vintage).'],
      [],
      ['Not included (deferred): income by age (B19037), HUD FMR/CHAS, LEHD commuting, Woods & Poole/ARC forecasts, SchoolDigger, Zillow, crime.'],
      [],
      ['Source: U.S. Census Bureau, American Community Survey 5-Year Estimates. Generated by housinganalytics.org.'],
    ];
    return XLSX.utils.aoa_to_sheet(rows);
  }

  async function generate(targetGeoid, peerGeoids, index, schema) {
    const model = await buildModel(targetGeoid, peerGeoids, index);
    const wb = XLSX.utils.book_new();
    for (const tab of schema.tabs) XLSX.utils.book_append_sheet(wb, buildSheet(tab, model), tab.name);
    XLSX.utils.book_append_sheet(wb, notesSheet(model, schema), 'Notes');
    const target = model.records.target.label.replace(/[^\w -]/g, '');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Master Sheet - ${target}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  window.MasterGen = { generate, buildModel };
})();
