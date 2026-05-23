/* ─────────────────────────────────────────────────────────────────────────
   housinganalytics.org — client-side export module
   Adds: PNG download per chart (every page)
         Excel + PDF buttons for the county profile (toolbar with [data-export-toolbar])
   Loaded as: <script src="/js/export.js" defer></script>
   Depends on: Chart.js v4 (already loaded by each page).
   Lazy-loads SheetJS, jsPDF, html2canvas only on first use of Excel / PDF.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── CDN URLs (pinned; update here if you bump versions) ───────────── */
  const CDN = {
    exceljs:     'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
    jspdf:       'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  };

  /* ── Tiny utilities ────────────────────────────────────────────────── */
  function slug(s) {
    return String(s || '')
      .normalize('NFKD').replace(/\p{M}/gu, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  }
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (loadScript._cache && loadScript._cache[url]) return resolve();
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = () => { (loadScript._cache = loadScript._cache || {})[url] = true; resolve(); };
      s.onerror = () => reject(new Error('Failed to load ' + url));
      document.head.appendChild(s);
    });
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ── PNG button per chart ──────────────────────────────────────────── */
  /* Looks for every <figure class="card"> that contains a <canvas>, and
     overlays a small download button in the top-right corner. Onclick we
     ask Chart.js for the rendered canvas, composite it onto white, and
     trigger a PNG download. Filename = page context + chart title.        */
  function getCountyContext() {
    const tag = document.getElementById('county-data');
    if (!tag) return null;
    try {
      const data = JSON.parse(tag.textContent);
      const c = data && data.county;
      if (!c) return null;
      return { prefix: slug(c.county_name + '-' + (c.state_name || '')) };
    } catch (e) { return null; }
  }
  function getPagePrefix() {
    const c = getCountyContext();
    if (c) return c.prefix;
    if (location.pathname.indexOf('/compare') === 0) return 'compare';
    if (location.pathname.indexOf('/rankings') === 0) return 'rankings';
    return 'chart';
  }
  function chartTitleFor(figure) {
    const h = figure.querySelector('h3, h4, [data-chart-title]');
    return h ? h.textContent.trim() : 'chart';
  }
  async function exportFigureAsPng(figure, filename) {
    /* Use html2canvas so the PNG includes the h3 title, the chart, the
       figcaption and the source line — everything inside the <figure>.
       Hide the PNG button itself during capture so it doesn't appear
       in the exported image.

       Sharpness: html2canvas downsamples child <canvas> elements to their
       CSS dimensions, which throws away the 2x retina bitmap Chart.js
       drew. To compensate we (a) force Chart.js to redraw at high DPR
       just before capture by temporarily resizing the canvas's parent,
       and (b) ask html2canvas for 3x output. Combined we get a ~6x
       effective resolution vs. the on-screen rendering — sharp enough
       to drop straight into a printed report.                            */
    await loadScript(CDN.html2canvas);
    const html2canvas = window.html2canvas;
    const btn = figure.querySelector('.chart-png-btn');
    const innerCanvas = figure.querySelector('canvas');
    const chart = innerCanvas && window.Chart ? window.Chart.getChart(innerCanvas) : null;
    const prevDisplay = btn ? btn.style.display : null;
    if (btn) btn.style.display = 'none';

    /* Force the chart to re-render at devicePixelRatio = 3 so its
       internal bitmap is dense enough to survive html2canvas's
       downsample. Restore after capture so the on-page chart stays
       crisp at the device's native DPR.                              */
    let prevDpr = null;
    if (chart && chart.options) {
      prevDpr = chart.options.devicePixelRatio;
      chart.options.devicePixelRatio = 3;
      chart.resize();
      chart.update('none');
    }

    try {
      const canvas = await html2canvas(figure, {
        scale: 3,                  /* 3x output — sharp for print/decks */
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
      await new Promise(resolve => canvas.toBlob(b => { downloadBlob(b, filename); resolve(); }, 'image/png'));
    } finally {
      if (chart) {
        chart.options.devicePixelRatio = prevDpr;
        chart.resize();
        chart.update('none');
      }
      if (btn) btn.style.display = prevDisplay;
    }
  }
  function attachPngButton(figure) {
    if (figure.dataset.exportReady === '1') return;
    const canvas = figure.querySelector('canvas');
    if (!canvas) return;
    figure.dataset.exportReady = '1';
    /* The host figure already has `position: relative` via .card styles
       in most pages; force it as a safety net so absolute children land
       in the right place.                                                */
    const cs = getComputedStyle(figure);
    if (cs.position === 'static') figure.style.position = 'relative';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chart-png-btn';
    btn.title = 'Download chart as PNG (includes title + source)';
    btn.setAttribute('aria-label', 'Download chart as PNG');
    btn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="currentColor" d="M5 20h14v-2H5v2zm7-18L5.5 8.5l1.42 1.42L11 5.83V16h2V5.83l4.08 4.09L18.5 8.5 12 2z"/>' +
      '</svg><span>PNG</span>';
    btn.addEventListener('click', async function () {
      const title = chartTitleFor(figure);
      const filename = getPagePrefix() + '-' + slug(title) + '.png';
      const label = btn.innerHTML;
      btn.disabled = true; btn.style.opacity = '1'; btn.textContent = '…';
      try { await exportFigureAsPng(figure, filename); }
      catch (e) { console.error('PNG export failed', e); alert('Could not generate PNG.'); }
      finally { btn.disabled = false; btn.innerHTML = label; }
    });
    figure.appendChild(btn);
  }
  function attachPngButtons() {
    document.querySelectorAll('figure.card').forEach(attachPngButton);
  }

  /* ── Compare/rankings build charts AFTER DOMContentLoaded, so watch
        the DOM for new figures and wire them on insert too.              */
  function observeForNewCharts() {
    if (!window.MutationObserver) return;
    const mo = new MutationObserver(muts => {
      let touched = false;
      muts.forEach(m => m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.matches && n.matches('figure.card')) { attachPngButton(n); touched = true; }
        if (n.querySelectorAll) n.querySelectorAll('figure.card').forEach(f => { attachPngButton(f); touched = true; });
      }));
      if (touched) {/* no-op; per-figure attach is idempotent via data-export-ready */}
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ── Excel export (county profile) ─────────────────────────────────── */
  /* Workbook layout:
        Sheet 1 "All Metrics"  — single row with every numeric field on
                                 the county JSON, plus its plain-language label.
        Sheet 2 "Profile"      — Section 1 tables (demographics, education, income).
        Sheet 3 "Market"       — Section 2 tables (tenure, structure, year built…).
        Sheet 4 "Workforce"    — Section 3 tables (HUD AMI, cost burden, affordability).
        Sheet 5 "Industries"   — Section 4 QCEW sectors + subsectors (if present).
        Sheet 6 "Occupations"  — Section 5 OEWS rows (if present).
     Styling: navy header bar, gold section-title bar, brand-colored sheet
     tabs, frozen header row, $/%/int number formats applied per column.   */
  function pct(part, whole) { return (whole && part != null) ? (part / whole) * 100 : null; }

  /* Brand palette in Excel's ARGB form (alpha-first). */
  const XL = {
    navy:    'FF003057',
    gold:    'FFB3A369',
    cream:   'FFF9F6E5',
    white:   'FFFFFFFF',
    charcoal:'FF545B5A',
  };
  /* Number-format codes. For 'pct' we store the value as a 0–1 fraction
     and Excel's % format multiplies by 100 on display — that way analysts
     can do math on it naturally.                                         */
  const NUMFMT = {
    money:    '"$"#,##0',
    moneyDec: '"$"#,##0.00',
    pct:      '0.0%',
    int:      '#,##0',
    ratio:    '0.00',
    year:     '0',
    text:     '@',
  };

  /* Per-sheet builder uses these helpers to write styled rows. They
     keep the build-* functions readable while still producing a sheet
     with proper headers, sections, formats, and frozen panes.        */
  function sheetBuilder(ws, totalCols) {
    let nextRow = 1;
    function pushRow(cells, opts) {
      const row = ws.getRow(nextRow);
      cells.forEach((v, i) => { row.getCell(i + 1).value = v; });
      if (opts && opts.fmts) {
        opts.fmts.forEach((f, i) => {
          if (!f) return;
          const cell = row.getCell(i + 1);
          /* For percent, divide by 100 once so display matches source. */
          if (f === 'pct' && typeof cell.value === 'number') cell.value = cell.value / 100;
          cell.numFmt = NUMFMT[f] || f;
        });
      }
      if (opts && opts.style) Object.assign(row, opts.style);
      const r = nextRow++;
      return row;
    }
    return {
      title(text) {
        const row = pushRow([text]);
        row.getCell(1).font = { name: 'Calibri', size: 14, bold: true, color: { argb: XL.navy } };
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.gold } };
        row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
        row.height = 22;
        ws.mergeCells(row.number, 1, row.number, totalCols);
      },
      subtitle(text) {
        const row = pushRow([text]);
        row.getCell(1).font = { italic: true, color: { argb: XL.charcoal } };
        ws.mergeCells(row.number, 1, row.number, totalCols);
      },
      section(text) {
        const row = pushRow([text]);
        row.getCell(1).font = { bold: true, size: 12, color: { argb: XL.navy } };
        row.height = 18;
      },
      header(cells) {
        const row = pushRow(cells);
        cells.forEach((_, i) => {
          const cell = row.getCell(i + 1);
          cell.font = { bold: true, color: { argb: XL.white } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.navy } };
          cell.alignment = { vertical: 'middle' };
          cell.border = { bottom: { style: 'thin', color: { argb: XL.navy } } };
        });
        row.height = 18;
      },
      row(cells, fmts) {
        const row = pushRow(cells, { fmts });
        /* Right-align numeric cells for tidy columns. */
        cells.forEach((v, i) => {
          if (typeof v === 'number') {
            row.getCell(i + 1).alignment = { horizontal: 'right' };
          }
        });
      },
      blank() { nextRow++; },
      freezeAfter(rowCount) { ws.views = [{ state: 'frozen', ySplit: rowCount }]; },
    };
  }

  /* Heuristic: derive a number format from the JSON field name. Used by
     the "All Metrics" flat sheet so each cell gets the right format
     without us hand-coding 200+ entries.                                 */
  function fmtForKey(key) {
    const k = key.toLowerCase();
    if (/(_rate|_share|_pct|percent|burden|ownership|renter_rate|vacancy_rate)$/.test(k) ||
        k.endsWith('_rate') || k.endsWith('_share') || k.endsWith('_pct')) return 'pct';
    if (/(income|value|rent|price|wage|cost|limit|^ami_|_ami|earnings|pay)/.test(k)) return 'money';
    if (k.endsWith('_year') || k === 'year_built_median') return 'year';
    if (k.includes('ratio') || k === 'hh_avg_size' || k === 'population_density') return 'ratio';
    if (typeof key === 'string' && k === 'geoid') return 'text';
    return 'int';
  }

  function buildFlatSheet(ws, county) {
    ws.columns = [{ width: 42 }, { width: 22 }];
    const b = sheetBuilder(ws, 2);
    b.title('All Metrics — ' + county.county_name + ', ' + county.state_name);
    b.subtitle('Single-row dump of every numeric field on the county record. Source: ACS 5-year 2024 + HUD FY2026 + BLS QCEW + BLS OEWS.');
    b.blank();
    b.header(['Metric (JSON key)', 'Value']);
    b.row(['county_name', county.county_name]);
    b.row(['state_name',  county.state_name]);
    b.row(['geoid',       county.geoid], [null, 'text']);
    b.blank();
    Object.keys(county).sort().forEach(k => {
      if (k.startsWith('_'))                     return;
      if (k === 'county_name' || k === 'state_name' || k === 'geoid') return;
      const v = county[k];
      if (v == null || typeof v === 'object')    return;
      const fmt = (typeof v === 'number') ? fmtForKey(k) : null;
      b.row([k, v], [null, fmt]);
    });
    b.freezeAfter(4);
  }

  function buildProfileSheet(ws, county) {
    ws.columns = [{ width: 42 }, { width: 18 }, { width: 14 }];
    const b = sheetBuilder(ws, 3);
    b.title('Section 1 — Community Profile');
    b.subtitle(county.county_name + ', ' + county.state_name + ' · Source: ACS 5-year 2024');
    b.blank();
    b.section('Demographics');
    b.header(['Metric', 'Value']);
    b.row(['Population',                county.population_total],     [null, 'int']);
    b.row(['Population density (per sq. mi.)', county.population_density], [null, 'ratio']);
    b.row(['Households',                county.hh_total_s1101],       [null, 'int']);
    b.row(['Average household size',    county.hh_avg_size],          [null, 'ratio']);
    b.row(['Median household income',   county.hh_income_median],     [null, 'money']);
    b.row(['Per capita income',         county.per_capita_income],    [null, 'money']);
    b.row(["Bachelor's degree or higher", county.bachelors_plus_rate], [null, 'pct']);
    b.blank();
    b.section('Racial composition');
    b.header(['Group', 'Count', 'Share']);
    [
      ['White',             county.race_white],
      ['Black',             county.race_black],
      ['Asian',             county.race_asian],
      ['Two or more races', county.race_two_plus],
      ['AIAN',              county.race_aian],
      ['NHPI',              county.race_nhpi],
      ['Other',             county.race_other],
    ].forEach(([g, n]) => b.row([g, n, pct(n, county.population_total)], [null, 'int', 'pct']));
    b.freezeAfter(3);
  }

  function buildMarketSheet(ws, county) {
    ws.columns = [{ width: 42 }, { width: 18 }, { width: 14 }];
    const b = sheetBuilder(ws, 3);
    b.title('Section 2 — Residential Market Analysis');
    b.subtitle(county.county_name + ', ' + county.state_name + ' · Source: ACS 5-year 2024');
    b.blank();
    b.section('Tenure');
    b.header(['Status', 'Households', 'Share']);
    b.row(['Owner-occupied',  county.tenure_owner_occupied,  pct(county.tenure_owner_occupied,  county.tenure_total_occupied)], [null, 'int', 'pct']);
    b.row(['Renter-occupied', county.tenure_renter_occupied, pct(county.tenure_renter_occupied, county.tenure_total_occupied)], [null, 'int', 'pct']);
    b.blank();
    b.section('Structure type');
    b.header(['Type', 'Units', 'Share']);
    [
      ['Single-family detached', county.structure_1_detached],
      ['Single-family attached', county.structure_1_attached],
      ['2 units',                county.structure_2],
      ['3–4 units',              county.structure_3_4],
      ['5–9 units',              county.structure_5_9],
      ['10–19 units',            county.structure_10_19],
      ['20–49 units',            county.structure_20_49],
      ['50+ units',              county.structure_50_plus],
      ['Mobile home',            county.structure_mobile],
      ['Other',                  county.structure_other],
    ].forEach(([t, n]) => b.row([t, n, pct(n, county.units_total)], [null, 'int', 'pct']));
    b.blank();
    b.section('Home value & cost');
    b.header(['Metric', 'Value']);
    b.row(['Median home value',          county.value_median],               [null, 'money']);
    b.row(['Median gross rent',          county.rent_median],                [null, 'money']);
    b.row(['Median monthly housing cost',county.monthly_housing_cost_median],[null, 'money']);
    b.row(['Homeowner vacancy rate',     county.homeowner_vacancy_rate],     [null, 'pct']);
    b.row(['Rental vacancy rate',        county.rental_vacancy_rate],        [null, 'pct']);
    b.row(['Overall vacancy rate',       county.vacancy_rate],               [null, 'pct']);
    b.freezeAfter(3);
  }

  /* Translate a HUD AMI key like "ami_80_4p" into a plain-language label
     like "4-Person Household · 80% AMI". Falls back to the raw key if the
     pattern doesn't match (so new HUD fields don't silently disappear). */
  function amiLabel(key) {
    /* Match patterns we know about — extend here when HUD publishes new fields. */
    let m = key.match(/^ami_(\d+)_(\d+)p$/);
    if (m) return `${m[2]}-Person Household · ${m[1]}% AMI`;
    m = key.match(/^ami_(\d+)$/);
    if (m) return `${m[1]}% AMI`;
    if (key === 'fmr_area')        return 'HUD FMR Area';
    if (key === 'hud_area_name')   return 'HUD Area Name';
    if (key === 'hud_area_code')   return 'HUD Area Code';
    if (key === 'median_income')   return 'HUD Area Median Family Income (4-person, 100%)';
    return key;
  }

  function buildWorkforceSheet(ws, county) {
    ws.columns = [{ width: 48 }, { width: 22 }];
    const b = sheetBuilder(ws, 2);
    b.title('Section 3 — Workforce Housing Needs Assessment');
    b.subtitle(county.county_name + ', ' + county.state_name + ' · Source: ACS 5-year 2024 + HUD FY2026');
    b.blank();
    b.section('Headline affordability');
    b.header(['Metric', 'Value']);
    b.row(['Median household income',   county.hh_income_median],       [null, 'money']);
    b.row(['Median home value',         county.value_median],           [null, 'money']);
    b.row(['Price-to-income ratio',     county.price_to_income_ratio],  [null, 'ratio']);
    b.row(['Renter cost-burden rate',   county.renter_cost_burden_rate],[null, 'pct']);
    b.row(['Owner cost-burden rate',    county.owner_cost_burden_rate], [null, 'pct']);
    b.blank();

    /* HUD AMI lives on the nested county.hud_ami object (NOT as top-level
       ami_* keys). It can be null if the HUD-to-FIPS join failed for this
       county — we render the section header so it's visible the field
       exists, and add a note pointing at the cause.                     */
    const hud = county.hud_ami;
    b.section('HUD FY2026 Area Median Income — annual income limit by household size & AMI band');
    if (!hud) {
      b.subtitle('No HUD AMI data joined for this county. (Pipeline issue — re-run npm run build after fixing the HUD join.)');
    } else {
      b.header(['Household & AMI band', 'Income limit']);
      /* Sort keys so 80% / 100% / 120% bands group together with 1p, 2p,
         4p in person-count order within each band. Other HUD metadata
         fields (fmr_area, hud_area_name) come last so the AMI grid is
         the visual focus.                                              */
      const amiKeys = Object.keys(hud)
        .filter(k => /^ami_\d+_\d+p$/.test(k))
        .sort((a, b) => {
          const [, ab, as] = a.match(/^ami_(\d+)_(\d+)p$/).map(Number);
          const [, bb, bs] = b.match(/^ami_(\d+)_(\d+)p$/).map(Number);
          return ab - bb || as - bs;
        });
      amiKeys.forEach(k => b.row([amiLabel(k), hud[k]], [null, 'money']));
      /* Then any other HUD metadata fields, with plain labels where known. */
      const otherKeys = Object.keys(hud).filter(k => !/^ami_\d+_\d+p$/.test(k)).sort();
      if (otherKeys.length) {
        b.blank();
        b.section('HUD area metadata');
        b.header(['Field', 'Value']);
        otherKeys.forEach(k => {
          const v = hud[k];
          const fmt = (typeof v === 'number' && k.indexOf('income') !== -1) ? 'money'
                    : (typeof v === 'number')                                ? 'int'
                    : null;
          b.row([amiLabel(k), v], [null, fmt]);
        });
      }
    }
    b.freezeAfter(3);
  }

  function buildIndustriesSheet(ws, county) {
    if (!county.industries) return false;
    ws.columns = [
      { width: 10 }, { width: 42 }, { width: 14 }, { width: 16 },
      { width: 22 }, { width: 18 }, { width: 18 },
    ];
    const b = sheetBuilder(ws, 7);
    b.title('Section 4 — BLS QCEW Industry & Workforce Wages');
    b.subtitle(county.county_name + ', ' + county.state_name + ' · ' + (county.industries.vintage_label || ''));
    b.blank();
    const writeBlock = (heading, list) => {
      b.section(heading);
      b.header(['NAICS', 'Industry', 'Employment', 'Establishments', 'Total annual wages', 'Avg annual pay', 'Avg weekly wage']);
      (list || []).forEach(r => b.row(
        [r.naics, r.title, r.emp, r.estabs, r.total_annual_wages, r.avg_annual_pay, r.avg_weekly_wage],
        [null, null, 'int', 'int', 'money', 'money', 'money']
      ));
      b.blank();
    };
    writeBlock('Sectors (NAICS 2-digit)',    county.industries.sectors);
    writeBlock('Subsectors (NAICS 3-digit)', county.industries.subsectors);
    b.freezeAfter(3);
    return true;
  }

  function buildOccupationsSheet(ws, county) {
    if (!county.occupations) return false;
    ws.columns = [
      { width: 10 }, { width: 40 }, { width: 12 }, { width: 12 },
      { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 12 },
    ];
    const b = sheetBuilder(ws, 9);
    b.title('Section 5 — BLS OEWS Wages by Occupation');
    b.subtitle(county.county_name + ', ' + county.state_name + ' · ' + (county.occupations.vintage_label || ''));
    b.blank();
    b.header(['SOC', 'Occupation', 'Jobs', 'Jobs (prior)', '10-yr change', '10-yr % change', 'Hourly wage', 'Annual wage', 'SOC changed?']);
    (county.occupations.rows || []).forEach(r => b.row(
      [r.soc, r.title, r.jobs, r.jobs_prior, r.jobs_change, r.jobs_pct_change, r.hourly, r.annual, r.soc_changed ? 'yes' : ''],
      [null, null, 'int', 'int', 'int', 'pct', 'moneyDec', 'money', null]
    ));
    b.freezeAfter(4);
    return true;
  }

  async function exportCountyExcel() {
    const ctx = (function () {
      const tag = document.getElementById('county-data');
      if (!tag) return null;
      try { return JSON.parse(tag.textContent); } catch (e) { return null; }
    })();
    if (!ctx || !ctx.county) { alert('No county data on this page.'); return; }
    const county = ctx.county;

    await loadScript(CDN.exceljs);
    const ExcelJS = window.ExcelJS;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'housinganalytics.org';
    wb.created = new Date();

    /* Each sheet gets a brand-colored tab so users can navigate quickly. */
    const tabColors = [XL.navy, XL.gold, XL.navy, XL.gold, XL.navy, XL.gold];
    const sheets = [
      ['All Metrics', buildFlatSheet],
      ['Profile',     buildProfileSheet],
      ['Market',      buildMarketSheet],
      ['Workforce',   buildWorkforceSheet],
      ['Industries',  buildIndustriesSheet],
      ['Occupations', buildOccupationsSheet],
    ];
    sheets.forEach(([name, build], i) => {
      const ws = wb.addWorksheet(name, {
        properties: { tabColor: { argb: tabColors[i] } },
        pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: 'landscape' },
      });
      const wrote = build(ws, county);
      /* If a section had no data (e.g. county lacks OEWS), drop the sheet. */
      if (wrote === false) wb.removeWorksheet(ws.id);
    });

    const buf = await wb.xlsx.writeBuffer();
    const filename = slug(county.county_name + '-' + county.state_name) + '-data.xlsx';
    downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  }

  /* ── PDF export ────────────────────────────────────────────────────── */
  /* Strategy: hide nav/footer/buttons, render the main report area to a
     single tall canvas via html2canvas, then slice that canvas into
     letter-size pages and stitch them into a jsPDF document.            */
  async function exportCountyPdf() {
    const target = document.querySelector('main, [data-export-root]') || document.body;
    const ctx = (function () {
      const tag = document.getElementById('county-data');
      if (!tag) return { county: null };
      try { return JSON.parse(tag.textContent); } catch (e) { return { county: null }; }
    })();
    const county = ctx.county;

    await Promise.all([loadScript(CDN.html2canvas), loadScript(CDN.jspdf)]);
    const html2canvas = window.html2canvas;
    const { jsPDF }   = window.jspdf;

    /* Hide chrome we don't want in the PDF. We restore the original
       inline display values from a parallel array so we don't pollute
       data-* attributes.                                            */
    const hides = Array.from(document.querySelectorAll(
      '.site-nav, .site-footer, nav, footer, [data-export-toolbar], .chart-png-btn'
    ));
    const prevDisplay = hides.map(el => el.style.display);
    hides.forEach(el => { el.style.display = 'none'; });

    let canvas;
    try {
      canvas = await html2canvas(target, {
        scale: 1.5,                /* sharper than 1, lighter than 2 — keeps file under ~10MB */
        backgroundColor: '#ffffff',
        useCORS: true,
        windowWidth: Math.max(document.documentElement.clientWidth, 1200),
      });
    } finally {
      hides.forEach((el, i) => { el.style.display = prevDisplay[i]; });
    }

    /* US Letter @ 72dpi = 612 × 792 pt. We render in pt for crisp text. */
    const pageW = 612, pageH = 792, margin = 36;
    const printW = pageW - margin * 2;
    /* Convert canvas pixels to PDF points so the image keeps proportions. */
    const ratio  = printW / canvas.width;
    const fullH  = canvas.height * ratio;
    const printH = pageH - margin * 2;

    const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true });

    /* Slice the source canvas into page-sized chunks and place each on
       its own PDF page. This produces a multi-page PDF where breaks fall
       wherever they fall — acceptable for v1.                          */
    const slicePxH = printH / ratio;   /* source-pixel height per page */
    let y = 0;
    let page = 0;
    while (y < canvas.height) {
      const h = Math.min(slicePxH, canvas.height - y);
      const tmp = document.createElement('canvas');
      tmp.width  = canvas.width;
      tmp.height = h;
      tmp.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      const img = tmp.toDataURL('image/jpeg', 0.9);
      if (page > 0) pdf.addPage();
      pdf.addImage(img, 'JPEG', margin, margin, printW, h * ratio);
      y += h;
      page++;
    }

    const base = county ? slug(county.county_name + '-' + county.state_name) : 'profile';
    pdf.save(base + '-profile.pdf');
  }

  /* ── Toolbar wiring ────────────────────────────────────────────────── */
  function wireToolbar() {
    document.querySelectorAll('[data-export-toolbar] [data-export]').forEach(btn => {
      const kind = btn.getAttribute('data-export');
      btn.addEventListener('click', async () => {
        const label = btn.textContent;
        btn.disabled = true; btn.textContent = 'Working…';
        try {
          if (kind === 'xlsx') await exportCountyExcel();
          else if (kind === 'pdf') await exportCountyPdf();
        } catch (e) {
          console.error(e); alert('Export failed: ' + e.message);
        } finally {
          btn.disabled = false; btn.textContent = label;
        }
      });
    });
  }

  /* ── Boot ──────────────────────────────────────────────────────────── */
  function boot() {
    attachPngButtons();
    observeForNewCharts();
    wireToolbar();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
