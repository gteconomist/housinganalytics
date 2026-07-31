/* ─────────────────────────────────────────────────────────────────────────
   housinganalytics.org — client-side export module
   Adds: PNG download per chart, in EIG or Georgia Tech colours (every page)
         Excel download per table (any .card containing a <table>)
         Excel + PDF buttons for the county profile (toolbar with [data-export-toolbar])
   Loaded as a deferred <script> with src="/js/export.js" (content-hashed by
   each page — see the cache-busting note in the repo conventions).
   Depends on: Chart.js v4 (already loaded by each page).
   Lazy-loads ExcelJS, jsPDF, html2canvas only on first use.
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

  /* ── Colour schemes for chart PNGs ─────────────────────────────────── */
  /* On-site charts are always EIG. The PNG button offers a second render in
     the official Georgia Tech palette (brand.gatech.edu/our-look/colors) for
     GT-affiliated deliverables. The chart is recoloured, captured, and put
     back — the page itself never changes.

     Mapping is by exact hex first (so a series keeps its semantic role: the
     primary bar stays primary, the alert red stays an alert), with an
     ordered fallback sequence for any colour we don't recognise.          */
  const GT = {
    navy:      '#003057',   /* Navy Blue    — primary   */
    gold:      '#B3A369',   /* Tech Gold    — primary   */
    grayMatter:'#54585A',   /* Gray Matter  — secondary */
    piMile:    '#D6DBD4',   /* Pi Mile      — secondary */
    diploma:   '#F9F6E5',   /* Diploma      — secondary */
    buzzGold:  '#EAAA00',   /* Buzz Gold    — secondary */
    darkGold:  '#857437',   /* Tech Dark Gold — accessible variant */
    teal:      '#008C95',   /* Olympic Teal — tertiary  */
    horizon:   '#E04F39',   /* New Horizon  — tertiary  */
    boldBlue:  '#3A5DAE',   /* Bold Blue    — tertiary  */
    purple:    '#5F249F',   /* Impact Purple— tertiary  */
    lime:      '#A4D233',   /* Canopy Lime  — tertiary  */
  };
  /* EIG hex → GT hex, preserving each colour's job on the chart. */
  const EIG_TO_GT = {
    '#231f20': GT.navy,        /* charcoal, primary series        */
    '#f7941e': GT.gold,        /* amber accent, secondary series  */
    '#2e292a': GT.grayMatter,  /* deep charcoal                   */
    '#6d6e71': GT.grayMatter,  /* muted text / neutral bars       */
    '#3a4049': GT.boldBlue,    /* slate blue                      */
    '#a8432f': GT.horizon,     /* brick — alert / shortage        */
    '#3f7d52': GT.teal,        /* forest — good / surplus         */
    '#7fa98a': GT.teal,        /* light forest                    */
    '#c9740f': GT.buzzGold,    /* deep amber — warning            */
    '#c9a227': GT.buzzGold,    /* muted gold                      */
    '#9c867a': GT.darkGold,    /* taupe — WAHI anchor             */
    '#d7d4cf': GT.piMile,      /* sage — healthy bucket           */
    '#f7f6f4': GT.diploma,     /* cream                           */
    '#a7a9ac': GT.piMile,      /* faint grey                      */
  };
  const GT_SEQUENCE = [
    GT.navy, GT.gold, GT.grayMatter, GT.teal, GT.horizon,
    GT.buzzGold, GT.boldBlue, GT.purple, GT.lime, GT.piMile,
  ];
  function toGt(color, i) {
    if (typeof color !== 'string') return GT_SEQUENCE[i % GT_SEQUENCE.length];
    const key = color.trim().toLowerCase();
    return EIG_TO_GT[key] || GT_SEQUENCE[i % GT_SEQUENCE.length];
  }
  /* Recolour one Chart.js chart. Returns an undo function. */
  function gtChart(chart) {
    if (!chart || !chart.data) return function () {};
    const saved = [];
    chart.data.datasets.forEach((ds, di) => {
      saved.push({ ds, bg: ds.backgroundColor, border: ds.borderColor });
      ds.backgroundColor = Array.isArray(ds.backgroundColor)
        ? ds.backgroundColor.map((c, i) => toGt(c, i))
        : toGt(ds.backgroundColor, di);
      if (ds.borderColor && typeof ds.borderColor === 'string') {
        ds.borderColor = toGt(ds.borderColor, di);
      }
    });
    const dl = chart.options && chart.options.plugins && chart.options.plugins.datalabels;
    const prevLabel = dl ? dl.color : undefined;
    if (dl) dl.color = GT.navy;
    chart.update('none');
    return function undo() {
      saved.forEach(s => { s.ds.backgroundColor = s.bg; s.ds.borderColor = s.border; });
      if (dl) dl.color = prevLabel;
      chart.update('none');
    };
  }

  /* Recolour a hand-built inline SVG chart (the housing-gap rental-gap
     chart draws its own <rect fill="#…">) plus any inline-styled swatch
     next to it (the legend squares). Only exact EIG hexes are touched, so
     a colour we don't recognise is left alone rather than guessed at. */
  const COLOUR_STYLE_PROPS = ['fill', 'stroke', 'backgroundColor', 'color', 'borderColor'];
  function gtMarkup(root) {
    const undo = [];
    /* Inline styles come back from the DOM as "rgb(35, 31, 32)", not as the
       "#231f20" that was written, so normalise before the lookup. */
    const toHex = v => {
      if (typeof v !== 'string') return null;
      const t = v.trim().toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(t)) return t;
      const m = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!m) return null;
      return '#' + [1, 2, 3].map(i => Number(m[i]).toString(16).padStart(2, '0')).join('');
    };
    const mapped = v => {
      const hex = toHex(v);
      return hex ? (EIG_TO_GT[hex] || null) : null;
    };
    root.querySelectorAll('*').forEach(el => {
      for (const attr of ['fill', 'stroke']) {
        const gt = el.getAttribute && mapped(el.getAttribute(attr));
        if (gt) { const prev = el.getAttribute(attr); undo.push(() => el.setAttribute(attr, prev)); el.setAttribute(attr, gt); }
      }
      if (!el.style || !el.getAttribute || !el.getAttribute('style')) return;
      for (const prop of COLOUR_STYLE_PROPS) {
        const gt = mapped(el.style[prop]);
        if (gt) { const prev = el.style[prop]; undo.push(() => { el.style[prop] = prev; }); el.style[prop] = gt; }
      }
    });
    return function () { undo.forEach(f => f()); };
  }

  /* A page whose figure can't be repainted by hex substitution — a d3
     colour ramp on a choropleth, say — pushes its own handler onto
     window.__haRecolor. Each entry is {match(figure)->bool, apply(figure,
     scheme)->undo}. The array is created by whichever script runs first,
     so load order between export.js and the page doesn't matter. */
  window.__haRecolor = window.__haRecolor || [];

  function chartsIn(figure) {
    if (!window.Chart) return [];
    return [...figure.querySelectorAll('canvas')]
      .map(c => window.Chart.getChart(c))
      .filter(Boolean);
  }

  /* Put a whole figure into GT colours. Returns an undo function. */
  function applyScheme(figure, scheme) {
    if (scheme !== 'gt') return function () {};
    const hook = (window.__haRecolor || []).find(h => {
      try { return h.match(figure); } catch (e) { return false; }
    });
    if (hook) {
      /* A page handler repaints live data (the maps re-run a d3 render), so
         a failure there must not take the download with it — fall through
         to the generic substitution rather than throwing. */
      try {
        const undo = hook.apply(figure, scheme);
        return typeof undo === 'function' ? undo : function () {};
      } catch (e) {
        console.error('page recolour handler failed; falling back', e);
      }
    }
    const undos = chartsIn(figure).map(gtChart);
    undos.push(gtMarkup(figure));
    return function () { undos.forEach(f => f()); };
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
      /* City profiles reuse this tag but carry place_name, not county_name —
         without the fallback every city download was named "undefined-…". */
      const name = c.county_name || c.place_name || 'profile';
      const label = name + (c.state_name ? ', ' + c.state_name : '');
      return { prefix: slug(name + '-' + (c.state_name || '')), name: name, label: label };
    } catch (e) { return null; }
  }
  function getPagePrefix() {
    const c = getCountyContext();
    if (c) return c.prefix;
    if (location.pathname.indexOf('/compare') === 0) return 'compare';
    if (location.pathname.indexOf('/rankings') === 0) return 'rankings';
    /* /housing-gap writes the selected geography into .hg-title; the maps
       and the rest just have their <h1>. Either beats "chart". */
    const h = document.querySelector('.hg-title, h1');
    const t = h && h.textContent.trim();
    if (t) return slug(t).slice(0, 60);
    const seg = location.pathname.split('/').filter(Boolean).pop();
    return seg ? slug(seg) : 'chart';
  }
  function chartTitleFor(figure) {
    const explicit = figure.getAttribute('data-export-figure');
    if (explicit) return explicit;
    const h = figure.querySelector('h2, h3, h4, [data-chart-title]');
    if (h) return h.textContent.trim();
    /* Unmarked and unheaded: fall back to the nearest heading above it. */
    let el = figure.previousElementSibling;
    while (el) {
      if (/^H[1-4]$/.test(el.tagName)) return el.textContent.trim();
      el = el.previousElementSibling;
    }
    return 'chart';
  }
  async function exportFigureAsPng(figure, filename, scheme) {
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
    const controls = figure.querySelector('.chart-dl');
    const prevDisplay = controls ? controls.style.display : null;
    if (controls) controls.style.display = 'none';

    /* Georgia Tech render: recolour, capture, put back. */
    const undoScheme = applyScheme(figure, scheme);
    if (scheme === 'gt') figure.classList.add('gt-export');

    /* Force the chart to re-render at devicePixelRatio = 3 so its
       internal bitmap is dense enough to survive html2canvas's
       downsample. Restore after capture so the on-page chart stays
       crisp at the device's native DPR.                              */
    const dprSaved = chartsIn(figure).map(ch => {
      const prev = ch.options.devicePixelRatio;
      ch.options.devicePixelRatio = 3;
      ch.resize();
      ch.update('none');
      return { ch, prev };
    });

    try {
      const canvas = await html2canvas(figure, {
        scale: 3,                  /* 3x output — sharp for print/decks */
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
      await new Promise(resolve => canvas.toBlob(b => { downloadBlob(b, filename); resolve(); }, 'image/png'));
    } finally {
      dprSaved.forEach(d => {
        d.ch.options.devicePixelRatio = d.prev;
        d.ch.resize();
        d.ch.update('none');
      });
      undoScheme();
      figure.classList.remove('gt-export');
      if (controls) controls.style.display = prevDisplay;
    }
  }
  const DOWNLOAD_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="currentColor" d="M5 20h14v-2H5v2zm7-18L5.5 8.5l1.42 1.42L11 5.83V16h2V5.83l4.08 4.09L18.5 8.5 12 2z"/>' +
    '</svg>';

  /* Split button: click "PNG" for the house (EIG) palette, click the caret
     for the Georgia Tech palette. Two clicks only when you want the
     non-default, which is the rarer case.                                 */
  /* Does this figure actually contain a chart worth a download button?
     A Chart.js canvas always counts. A bare <svg> counts only when it is
     plainly a chart and not a UI icon — the download glyph in our own
     button, a caret, a logo — so it must be reasonably large, outside any
     button/link/nav, and not aria-hidden. */
  const ICON_HOSTS = 'button, a, nav, header, footer, .site-nav, .site-footer';
  function isChartSvg(svg) {
    if (svg.closest(ICON_HOSTS)) return false;
    if (svg.getAttribute('aria-hidden') === 'true') return false;
    const box = svg.getBoundingClientRect();
    if (Math.max(box.width, box.height) < 160) return false;
    /* An icon is one or two paths; a chart has real structure. */
    return svg.querySelectorAll('rect, circle, path, line, text, polygon').length >= 5;
  }
  function hasChart(figure) {
    if (figure.querySelector('canvas')) return true;
    return [...figure.querySelectorAll('svg')].some(isChartSvg);
  }

  function attachPngButton(figure) {
    if (figure.dataset.exportReady === '1') return;
    if (!hasChart(figure)) return;
    figure.dataset.exportReady = '1';
    /* The host figure already has `position: relative` via .card styles
       in most pages; force it as a safety net so absolute children land
       in the right place.                                                */
    const cs = getComputedStyle(figure);
    if (cs.position === 'static') figure.style.position = 'relative';
    /* Marks the host so the hover rule works on ANY container, not just
       figure.card — the housing-gap chart lives in a plain div. */
    figure.classList.add('has-export-btn');

    const wrap = document.createElement('div');
    wrap.className = 'chart-dl';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'chart-png-btn chart-dl__main';
    main.title = 'Download chart as PNG in EIG colours (includes title + source)';
    main.setAttribute('aria-label', 'Download chart as PNG');
    main.innerHTML = DOWNLOAD_ICON + '<span>PNG</span>';

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'chart-png-btn chart-dl__caret';
    caret.title = 'Choose a colour palette';
    caret.setAttribute('aria-label', 'Choose a colour palette');
    caret.setAttribute('aria-haspopup', 'true');
    caret.setAttribute('aria-expanded', 'false');
    caret.innerHTML = '<span aria-hidden="true">▾</span>';

    const menu = document.createElement('div');
    menu.className = 'chart-dl__menu';
    menu.hidden = true;
    menu.innerHTML =
      '<button type="button" data-scheme="eig">PNG — EIG colours</button>' +
      '<button type="button" data-scheme="gt">PNG — Georgia Tech colours</button>';

    function closeMenu() {
      menu.hidden = true;
      caret.setAttribute('aria-expanded', 'false');
    }
    caret.addEventListener('click', function (ev) {
      ev.stopPropagation();
      const open = menu.hidden;
      /* Only one palette menu open at a time. */
      document.querySelectorAll('.chart-dl__menu').forEach(m => { m.hidden = true; });
      document.querySelectorAll('.chart-dl__caret').forEach(c => c.setAttribute('aria-expanded', 'false'));
      menu.hidden = !open;
      caret.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeMenu(); });

    async function run(scheme, btn) {
      closeMenu();
      const title = chartTitleFor(figure);
      const suffix = scheme === 'gt' ? '-gt' : '';
      const filename = getPagePrefix() + '-' + slug(title) + suffix + '.png';
      const label = btn.innerHTML;
      btn.disabled = true; btn.style.opacity = '1'; btn.textContent = '…';
      try { await exportFigureAsPng(figure, filename, scheme); }
      catch (e) { console.error('PNG export failed', e); alert('Could not generate PNG.'); }
      finally { btn.disabled = false; btn.innerHTML = label; }
    }
    main.addEventListener('click', function () { run('eig', main); });
    menu.querySelectorAll('button[data-scheme]').forEach(b => {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        run(b.getAttribute('data-scheme'), main);
      });
    });

    wrap.appendChild(main);
    wrap.appendChild(caret);
    wrap.appendChild(menu);
    figure.appendChild(wrap);
  }
  /* Where charts live across the site. `figure.card` covers the profile,
     compare, rankings and map pages; `[data-export-figure]` is the opt-in
     marker for anything that isn't a card — e.g. the housing-gap rental-gap
     chart, which is a bare <div> inside a results panel. */
  const FIGURE_SELECTOR = 'figure.card, [data-export-figure]';
  function attachPngButtons(root) {
    (root || document).querySelectorAll(FIGURE_SELECTOR).forEach(attachPngButton);
  }

  /* ── Compare/rankings build charts AFTER DOMContentLoaded, so watch
        the DOM for new figures and wire them on insert too.              */
  /* Compare, rankings, the maps and the whole housing-gap results panel
     build their charts and tables AFTER DOMContentLoaded — and housing-gap
     re-renders its panel on every slider move. Rather than track each
     page's lifecycle, watch the DOM and re-scan on a short debounce. Every
     attach is idempotent via the data-*-ready flags, so a re-scan of
     already-wired markup costs nothing.

     The scan is scoped to added subtrees, but a full rescan is cheap and
     avoids missing a table appended to an existing container, so we do
     that on the trailing edge of the debounce. */
  function observeForNewCharts() {
    if (!window.MutationObserver) return;
    let pending = null;
    const rescan = () => {
      pending = null;
      try { attachPngButtons(); attachTableButtons(); }
      catch (e) { console.error('export.js rescan failed', e); }
    };
    const mo = new MutationObserver(muts => {
      /* Ignore our own insertions or we would loop forever. */
      const relevant = muts.some(m => [...m.addedNodes].some(n =>
        n.nodeType === 1 &&
        !n.classList?.contains('chart-dl') &&
        !n.classList?.contains('table-xlsx-btn') &&
        !n.classList?.contains('table-xlsx-bar')));
      if (!relevant || pending) return;
      pending = setTimeout(rescan, 120);
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

  /* EIG palette in Excel's ARGB form (alpha-first). Keys keep their old
     names so every buildXSheet() call site is untouched; the VALUES are the
     post-rebrand EIG tokens. The retired GT hexes (#003057 / #b3a369 /
     #f9f6e5) must not come back here — GT colours belong only to the
     explicit "Georgia Tech" chart PNG export.                             */
  const XL = {
    navy:    'FF231F20',   /* EIG charcoal  — --color-navy   */
    gold:    'FFF7941E',   /* EIG amber     — --color-gold   */
    cream:   'FFF7F6F4',   /* EIG cream     — --color-cream  */
    white:   'FFFFFFFF',
    charcoal:'FF6D6E71',   /* EIG muted text                 */
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
    if (!ctx || !ctx.county) { alert('No data on this page.'); return; }
    const county = ctx.county;
    /* City profiles carry place_name; give the sheet builders a county_name
       so every title/subtitle below reads correctly on both page types. */
    if (!county.county_name && county.place_name) county.county_name = county.place_name;

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

  /* ── Excel export, one table at a time ─────────────────────────────── */
  /* Every .card that contains a <table> gets its own Excel button. The
     workbook holds one sheet per table in that card — so the Section 4
     card, whose sector / subsector tables share a toggle, exports both at
     once rather than only whichever happens to be on screen.

     Values are read back out of the rendered DOM and re-typed, so what
     lands in Excel is exactly what the analyst is looking at, and it lands
     as numbers rather than as "$1,234" strings.                          */

  /* innerText keeps the line breaks that block-level spans create (the
     industry tables stack a NAICS code under the title); collapse those to
     a middot so one DOM cell stays one spreadsheet cell.                  */
  function cellText(el) {
    const raw = (el.innerText != null ? el.innerText : el.textContent) || '';
    return raw.replace(/\s*\n+\s*/g, ' · ').replace(/\s+/g, ' ').trim();
  }
  /* "$1,234" → 1234 money · "12.3%" → 0.123 pct · "1,234" → int.
     Anything with stray units ("2.45 people") stays text — better a right
     string than a wrong number. */
  function typeCell(text) {
    if (!text || text === '—' || text === '–' || text === '-') return { value: null, fmt: null };
    const isPct   = /%$/.test(text);
    const isMoney = /^-?\$/.test(text);
    const bare    = text.replace(/^-?\$/, m => (m.charAt(0) === '-' ? '-' : ''))
                        .replace(/%$/, '')
                        .replace(/,/g, '')
                        .trim();
    if (!/^-?\d*\.?\d+$/.test(bare)) return { value: text, fmt: null };
    const n = Number(bare);
    if (!isFinite(n)) return { value: text, fmt: null };
    /* Hand back the percent as it reads on screen (16.5, not 0.165) —
       sheetBuilder divides by 100 for the 'pct' format, same as every
       hand-written sheet in this file. Converting here too double-scaled it. */
    if (isPct)   return { value: n, fmt: 'pct' };
    if (isMoney) return { value: n, fmt: /\.\d\d$/.test(bare) ? 'moneyDec' : 'money' };
    return { value: n, fmt: Number.isInteger(n) ? 'int' : 'ratio' };
  }

  function tableTitleFor(table, container, idx) {
    const explicit = table.getAttribute('data-table-name');
    if (explicit) return explicit;
    /* A toggle-driven table names itself via the data attribute on its
       wrapper div (that is what the toggle shows and hides). */
    const wrap = table.closest('[data-industry-table]');
    const toggle = wrap ? wrap.getAttribute('data-industry-table') : null;
    let base = null;
    const heading = container && container.querySelector && container.querySelector('h2, h3, h4');
    if (heading && !heading.closest('table')) base = heading.textContent.trim();
    if (!base) {
      /* Loose table: the nearest heading above it on the page names it. */
      let el = table.previousElementSibling;
      while (el && !base) {
        if (/^H[1-4]$/.test(el.tagName)) base = el.textContent.trim();
        el = el.previousElementSibling;
      }
    }
    if (!base) base = 'Table';
    if (toggle) return base + ' — ' + toggle;
    return idx === 0 ? base : base + ' (' + (idx + 1) + ')';
  }
  /* Excel sheet names: 31 chars, no []:*?/\ */
  function sheetName(raw, used) {
    let n = String(raw).replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
    let i = 2;
    while (used.has(n)) { const suf = ' (' + i++ + ')'; n = n.slice(0, 31 - suf.length) + suf; }
    used.add(n);
    return n;
  }

  function writeDomTable(ws, table, title, subtitle) {
    const rows = Array.from(table.rows);
    if (!rows.length) return;
    const cols = rows.reduce((m, r) => Math.max(m, r.cells.length), 1);
    /* Width the first column for labels, the rest for numbers. */
    ws.columns = Array.from({ length: cols }, (_, i) => ({ width: i === 0 ? 46 : 18 }));
    const b = sheetBuilder(ws, cols);
    b.title(title);
    if (subtitle) b.subtitle(subtitle);
    b.blank();

    let headerRows = 0;
    rows.forEach(tr => {
      const cells = Array.from(tr.cells);
      const isHeader = tr.parentElement && tr.parentElement.tagName === 'THEAD';
      const texts = cells.map(cellText);
      if (isHeader) {
        b.header(texts);
        headerRows++;
        return;
      }
      const typed = texts.map(typeCell);
      b.row(typed.map(t => t.value), typed.map(t => t.fmt));
    });
    /* Freeze the title block + header rows. */
    b.freezeAfter(3 + headerRows);
  }

  async function exportTables(tables, context) {
    if (!tables.length) { alert('No table found.'); return; }

    await loadScript(CDN.exceljs);
    const ExcelJS = window.ExcelJS;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'housinganalytics.org';
    wb.created = new Date();

    const ctx = getCountyContext();
    const headingEl = document.querySelector('h1, .hg-title');
    const place = ctx ? ctx.label : ((headingEl && headingEl.textContent) || document.title);
    const used = new Set();
    tables.forEach((t, i) => {
      const title = tableTitleFor(t, context, i);
      const ws = wb.addWorksheet(sheetName(title, used), {
        properties: { tabColor: { argb: i % 2 ? XL.gold : XL.navy } },
        pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: 'landscape' },
      });
      writeDomTable(ws, t, title, String(place).trim() + ' · housinganalytics.org');
    });

    const buf = await wb.xlsx.writeBuffer();
    const base = getPagePrefix() + '-' + slug(tableTitleFor(tables[0], context, 0));
    downloadBlob(
      new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      base + '.xlsx',
    );
  }

  function makeXlsxButton(onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chart-png-btn table-xlsx-btn';
    btn.title = 'Download this table as an Excel workbook';
    btn.setAttribute('aria-label', 'Download this table as Excel');
    btn.innerHTML = DOWNLOAD_ICON + '<span>Excel</span>';
    btn.addEventListener('click', async function () {
      const label = btn.innerHTML;
      btn.disabled = true; btn.style.opacity = '1'; btn.textContent = '…';
      try { await onClick(); }
      catch (e) { console.error('Table Excel export failed', e); alert('Could not generate the workbook.'); }
      finally { btn.disabled = false; btn.innerHTML = label; }
    });
    return btn;
  }

  /* One button per card / figure that holds tables (it exports all of them,
     one sheet each — that is how the Section 4 sectors + subsectors pair
     comes out whole even though the toggle only ever shows one). Tables
     that sit loose on a page — the housing-gap results panel builds five of
     them as plain siblings — get their own inline button instead. */
  const TABLE_CONTAINER_SELECTOR = '[data-export-figure], [data-export-tables], figure, .card';

  function attachTableButton(container) {
    if (container.dataset.tableExportReady === '1') return;
    const tables = Array.from(container.querySelectorAll('table'));
    if (!tables.length) return;
    container.dataset.tableExportReady = '1';
    tables.forEach(t => { t.dataset.tableExportReady = '1'; });

    const cs = getComputedStyle(container);
    if (cs.position === 'static') container.style.position = 'relative';
    container.classList.add('has-export-btn');

    const btn = makeXlsxButton(() => exportTables(tables, container));
    /* If this card also carries a chart PNG control, sit to its left. */
    if (container.querySelector('.chart-dl')) btn.classList.add('table-xlsx-btn--offset');
    container.appendChild(btn);
  }

  function attachLooseTableButton(table) {
    if (table.dataset.tableExportReady === '1') return;
    table.dataset.tableExportReady = '1';
    const bar = document.createElement('div');
    bar.className = 'table-xlsx-bar';
    /* Pass no container: the parent here is the whole results panel, whose
       first heading is the page title, not this table's. tableTitleFor
       falls back to the nearest heading ABOVE the table, which is right. */
    bar.appendChild(makeXlsxButton(() => exportTables([table], null)));
    table.parentNode.insertBefore(bar, table);
  }

  function attachTableButtons(root) {
    const scope = root || document;
    scope.querySelectorAll(TABLE_CONTAINER_SELECTOR).forEach(attachTableButton);
    /* Anything still unclaimed is a loose table. */
    scope.querySelectorAll('table').forEach(t => {
      if (t.dataset.tableExportReady === '1') return;
      if (t.closest(TABLE_CONTAINER_SELECTOR)) return;
      attachLooseTableButton(t);
    });
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
      '.site-nav, .site-footer, nav, footer, [data-export-toolbar], .chart-dl, .chart-png-btn, .table-xlsx-btn'
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
    attachTableButtons();
    observeForNewCharts();
    wireToolbar();
  }
  /* Exposed so a page that rebuilds its own DOM can force a re-scan
     immediately rather than waiting on the observer's debounce. */
  window.HAExport = { rescan: function () { attachPngButtons(); attachTableButtons(); } };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
