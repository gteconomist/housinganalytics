/* report-docx.js — builds the Word report in the browser.
 *
 * Input is a plain document model (cover, header/footer text and a list of
 * blocks) produced by report-narrative.js.  Output is a .docx as a Uint8Array.
 * Charts are native Word charts with an embedded workbook, so "Edit Data" works.
 * The static parts of the package (styles, numbering, theme, settings) come
 * from /report-template/skeleton.json.  No dependencies: the zip container and
 * the chart workbooks are written here.  Runs in the browser (window.HADocx)
 * and in Node (module.exports) so the build can be tested without a browser.
 */
(function (root) {
  'use strict';

  // Neutral palette: deep teal primary, copper accent.
  const C = { PRIMARY: '1D4A4D', ACCENT: 'B8683A', ACCENT_D: '8F4E28', DEEP: '143638', SLATE: '7E9A9A', MUTED: '667676', HAIR: 'DDE4E3', TILE: 'F2F5F4', CREAM: 'FAF3EC', PALE: 'C8D5D4' };
  const W = 9360;
  const col = (c) => C[c] || c;

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const qa = (s) => esc(s).replace(/"/g, '&quot;');

  function run(text, o) {
    o = o || {};
    let rp = '';
    if (o.b) rp += '<w:b/><w:bCs/>';
    if (o.caps) rp += '<w:caps/>';
    if (o.color) rp += `<w:color w:val="${o.color}"/>`;
    if (o.spacing) rp += `<w:spacing w:val="${o.spacing}"/>`;
    if (o.sz) rp += `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>`;
    return `<w:r>${rp ? '<w:rPr>' + rp + '</w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  }
  // '**bold** plain' -> runs
  function rich(text, color, sz, boldColor) {
    boldColor = boldColor === undefined ? C.PRIMARY : boldColor;
    return String(text).split(/\*\*(.+?)\*\*/).map((part, k) => !part ? '' : run(part, { b: k % 2 === 1, color: k % 2 === 1 && boldColor ? boldColor : color, sz })).join('');
  }
  const para = (text, o) => { o = o || {}; return `<w:p><w:pPr><w:spacing ${o.before ? `w:before="${o.before}" ` : ''}w:after="${o.after == null ? 150 : o.after}" w:line="290" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>${rich(text)}</w:p>`; };
  const spacer = (h) => `<w:p><w:pPr><w:spacing w:line="${h || 260}" w:lineRule="exact"/></w:pPr></w:p>`;
  const bm = (id, inner) => `<w:bookmarkStart w:id="${id}" w:name="_HA${id}"/>${inner}<w:bookmarkEnd w:id="${id}"/>`;
  const h1 = (title, num, id) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:pageBreakBefore/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="${C.ACCENT}"/></w:pBdr></w:pPr>`
    + (num ? `<w:r><w:rPr><w:color w:val="${C.ACCENT}"/></w:rPr><w:t xml:space="preserve">${esc(num)}   </w:t></w:r>` : '') + bm(id, `<w:r><w:t>${esc(title)}</w:t></w:r>`) + '</w:p>';
  const h2 = (title, id) => `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:spacing w:before="200" w:after="140"/></w:pPr>${bm(id, `<w:r><w:t>${esc(title)}</w:t></w:r>`)}</w:p>`;
  const eyebrow = (text) => `<w:p><w:pPr><w:keepNext/><w:spacing w:after="90" w:line="290" w:lineRule="auto"/></w:pPr>${run(text, { b: true, caps: true, color: C.ACCENT_D, spacing: 40, sz: 14 })}</w:p>`;
  const bullet = (text) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr><w:spacing w:after="110" w:line="290" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>${rich(text)}</w:p>`;
  const numbered = (n, lead, text) => `<w:p><w:pPr><w:spacing w:after="130" w:line="290" w:lineRule="auto"/><w:ind w:left="340" w:hanging="340"/><w:jc w:val="both"/></w:pPr>`
    + run(n + '.', { b: true, color: C.ACCENT }) + '<w:r><w:tab/></w:r>' + run(lead, { b: true, color: C.PRIMARY }) + rich(' ' + text) + '</w:p>';

  const TRX = '<w:tblPrEx><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPrEx>';
  const tbl = (w, grid, rows, fixed) => `<w:tbl><w:tblPr><w:tblW w:w="${w}" w:type="dxa"/>${fixed === false ? '' : '<w:tblLayout w:type="fixed"/>'}<w:tblCellMar><w:left w:w="10" w:type="dxa"/><w:right w:w="10" w:type="dxa"/></w:tblCellMar>`
    + `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
  const tcmar = (t, l, b, r) => `<w:tcMar><w:top w:w="${t}" w:type="dxa"/><w:left w:w="${l}" w:type="dxa"/><w:bottom w:w="${b}" w:type="dxa"/><w:right w:w="${r}" w:type="dxa"/></w:tcMar>`;

  function tiles(items) {
    const n = items.length, gap = 120, cw = Math.floor((W - gap * (n - 1)) / n);
    let grid = '', cells = '';
    items.forEach((it, k) => {
      const val = String(it[0]), dark = k === 0;
      if (k) { grid += `<w:gridCol w:w="${gap}"/>`; cells += `<w:tc><w:tcPr><w:tcW w:w="${gap}" w:type="dxa"/>${tcmar(0, 0, 0, 0)}</w:tcPr><w:p><w:pPr><w:spacing w:line="20" w:lineRule="exact"/></w:pPr></w:p></w:tc>`; }
      grid += `<w:gridCol w:w="${cw}"/>`;
      const vsz = val.length <= 8 ? 36 : val.length <= 11 ? 30 : 26;
      cells += `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="18" w:space="0" w:color="${C.ACCENT}"/></w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="${dark ? C.PRIMARY : C.TILE}"/>${tcmar(150, 170, 150, 140)}</w:tcPr>`
        + `<w:p><w:pPr><w:spacing w:after="50" w:line="400" w:lineRule="auto"/></w:pPr>${run(val, { b: true, color: dark ? 'FFFFFF' : C.PRIMARY, sz: vsz })}</w:p>`
        + `<w:p><w:pPr><w:spacing w:after="50" w:line="200" w:lineRule="auto"/></w:pPr>${run(it[1], { b: true, caps: true, color: dark ? C.ACCENT : C.ACCENT_D, spacing: 30, sz: 13 })}</w:p>`
        + `<w:p><w:pPr><w:spacing w:line="220" w:lineRule="auto"/></w:pPr>${run(it[2] || '', { color: dark ? C.PALE : C.MUTED, sz: 15 })}</w:p></w:tc>`;
    });
    return tbl(W, grid, `<w:tr>${TRX}<w:trPr><w:cantSplit/></w:trPr>${cells}</w:tr>`) + spacer();
  }
  function callout(label, paras) {
    if (typeof paras === 'string') paras = [paras];
    let body = `<w:p><w:pPr><w:spacing w:after="80" w:line="290" w:lineRule="auto"/></w:pPr>${run(label, { b: true, caps: true, color: C.ACCENT_D, spacing: 40, sz: 14 })}</w:p>`;
    paras.forEach((t, k) => { body += `<w:p><w:pPr><w:spacing w:after="${k === paras.length - 1 ? 0 : 90}" w:line="280" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>${rich(t, C.PRIMARY, 18)}</w:p>`; });
    const cell = `<w:tc><w:tcPr><w:tcW w:w="${W}" w:type="dxa"/><w:tcBorders><w:left w:val="single" w:sz="30" w:space="0" w:color="${C.ACCENT}"/></w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="${C.CREAM}"/>${tcmar(170, 240, 170, 220)}</w:tcPr>${body}</w:tc>`;
    return tbl(W, `<w:gridCol w:w="${W}"/>`, `<w:tr>${TRX}<w:trPr><w:cantSplit/></w:trPr>${cell}</w:tr>`, false) + spacer();
  }
  function banner(text) {
    const cell = `<w:tc><w:tcPr><w:tcW w:w="${W}" w:type="dxa"/><w:tcBorders><w:left w:val="single" w:sz="36" w:space="0" w:color="${C.ACCENT}"/></w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="${C.PRIMARY}"/>${tcmar(200, 260, 200, 240)}</w:tcPr>`
      + `<w:p><w:pPr><w:spacing w:line="320" w:lineRule="auto"/></w:pPr>${run(text, { b: true, color: 'FFFFFF', sz: 22 })}</w:p></w:tc>`;
    return tbl(W, `<w:gridCol w:w="${W}"/>`, `<w:tr>${TRX}<w:trPr><w:cantSplit/></w:trPr>${cell}</w:tr>`, false) + spacer();
  }
  const source = (text) => `<w:p><w:pPr><w:spacing w:after="240" w:line="200" w:lineRule="auto"/></w:pPr>${run(text, { color: C.MUTED, sz: 13 })}</w:p>`;
  const caption = (kind, n, title) => `<w:p><w:pPr><w:keepNext/><w:spacing w:before="60" w:after="100"/></w:pPr>${run(`${kind} ${n}   `, { b: true, color: C.ACCENT_D, spacing: 40, sz: 14 })}${run(title, { b: true, color: C.PRIMARY })}</w:p>`;

  // Column widths when the narrative does not set them: a wider first column, the rest equal.
  function autoWidths(n, first) {
    const f = first || (n <= 3 ? 4400 : n === 4 ? 3960 : n === 5 ? 3360 : n === 6 ? 2860 : 1900), rest = Math.floor((W - f) / (n - 1) / 10) * 10;
    const w = [W - rest * (n - 1)]; for (let i = 1; i < n; i++) w.push(rest); return w;
  }
  function table(n, b) {
    const hs = b.headers, widths = b.widths || autoWidths(hs.length, b.first), align = b.align || ['l'].concat(hs.slice(1).map(() => 'r')), sz = b.sz || 18;
    const cell = (text, k, kind, last) => {
      const jc = align[k] === 'r' ? '<w:jc w:val="right"/>' : '';
      if (kind === 'head') return `<w:tc><w:tcPr><w:tcW w:w="${widths[k]}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${C.PRIMARY}"/>${tcmar(90, 140, 90, 140)}<w:vAlign w:val="bottom"/></w:tcPr><w:p><w:pPr><w:keepNext/><w:spacing w:line="250" w:lineRule="auto"/>${jc}</w:pPr>${run(text, { b: true, color: 'FFFFFF', sz: 16 })}</w:p></w:tc>`;
      const bd = kind === 'total' ? `<w:top w:val="single" w:sz="14" w:space="0" w:color="${C.ACCENT}"/>` : `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="${C.HAIR}"/>`;
      const bold = kind === 'total' || (b.boldFirst && k === 0);
      return `<w:tc><w:tcPr><w:tcW w:w="${widths[k]}" w:type="dxa"/><w:tcBorders>${bd}</w:tcBorders>${tcmar(70, 140, 70, 140)}</w:tcPr><w:p><w:pPr>${last ? '' : '<w:keepNext/>'}<w:spacing w:line="250" w:lineRule="auto"/>${jc}</w:pPr>${run(text, { b: bold, color: bold ? C.PRIMARY : null, sz })}</w:p></w:tc>`;
    };
    let out = `<w:tr>${TRX}<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${hs.map((h, k) => cell(h, k, 'head')).join('')}</w:tr>`;
    b.rows.forEach((r, ri) => {
      const kind = b.total && ri === b.rows.length - 1 ? 'total' : 'body';
      out += `<w:tr>${TRX}<w:trPr><w:cantSplit/></w:trPr>${r.map((c, k) => cell(c == null ? '' : c, k, kind, ri === b.rows.length - 1 && !b.src)).join('')}</w:tr>`;
    });
    return caption('TABLE', n, b.title) + tbl(W, widths.map((w) => `<w:gridCol w:w="${w}"/>`).join(''), out) + (b.src ? source(b.src) : spacer(200));
  }

  function chartXml(b) {
    const cats = b.cats, series = b.series, kind = b.kind || 'clustered', fmt = b.fmt || '#,##0', last = cats.length + 1, labels = b.labels !== false;
    const txpr = (color, bold) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"${bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
    const flags = (v) => `<c:showLegendKey val="0"/><c:showVal val="${v}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>`;
    const dl = (show) => show ? `<c:dLbls><c:numFmt formatCode="${qa(fmt)}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txpr(C.PRIMARY, true)}${flags(1)}</c:dLbls>` : `<c:dLbls>${flags(0)}</c:dLbls>`;
    let sers = '';
    series.forEach((s, k) => {
      const L = String.fromCharCode(66 + k), pts = s.points || {};
      const dpts = Object.keys(pts).map(Number).sort((a, z) => a - z).map((i) => `<c:dPt><c:idx val="${i}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${col(pts[i])}"/></a:solidFill></c:spPr></c:dPt>`).join('');
      sers += `<c:ser><c:idx val="${k}"/><c:order val="${k}"/><c:tx><c:strRef><c:f>Sheet1!$${L}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`
        + `<c:spPr><a:solidFill><a:srgbClr val="${col(s.color)}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>${dpts}${dl(labels && kind !== 'stacked')}`
        + `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${last}</c:f><c:strCache><c:ptCount val="${cats.length}"/>${cats.map((c, i) => `<c:pt idx="${i}"><c:v>${esc(c)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>`
        + `<c:val><c:numRef><c:f>Sheet1!$${L}$2:$${L}$${last}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${cats.length}"/>${s.values.map((v, i) => v == null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val></c:ser>`;
    });
    const legend = series.length > 1 ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txpr('3B4B55')}</c:legend>` : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>'
      + `<c:barChart><c:barDir val="col"/><c:grouping val="${kind === 'stacked' ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${sers}${dl(false)}<c:gapWidth val="${b.gap || 45}"/>${kind === 'stacked' ? '<c:overlap val="100"/>' : series.length > 1 ? '<c:overlap val="-8"/>' : ''}<c:axId val="111"/><c:axId val="222"/></c:barChart>`
      + `<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="${C.SLATE}"/></a:solidFill></a:ln></c:spPr>${txpr('3B4B55')}<c:crossAx val="222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:tickLblSkip val="1"/><c:noMultiLvlLbl val="0"/></c:catAx>`
      + `<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E3E9ED"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${qa(b.axisFmt || fmt)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txpr(C.MUTED)}<c:crossAx val="111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`
      + `<c:spPr><a:noFill/></c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>${txpr('3B4B55')}`
      + '<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>';
  }

  // ── minimal .xlsx for a chart's data (categories in column A, one series per column) ──
  function chartWorkbook(b) {
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const ref = (c, r) => String.fromCharCode(65 + c) + r;
    const s = (c, r, t) => `<c r="${ref(c, r)}" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
    let rows = `<row r="1">${s(0, 1, '')}${b.series.map((x, k) => s(k + 1, 1, x.name)).join('')}</row>`;
    b.cats.forEach((cat, i) => { rows += `<row r="${i + 2}">${s(0, i + 2, cat)}${b.series.map((x, k) => x.values[i] == null ? '' : `<c r="${ref(k + 1, i + 2)}"><v>${x.values[i]}</v></c>`).join('')}</row>`; });
    return zip([
      ['[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
      ['_rels/.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
      ['xl/worksheets/sheet1.xml', X + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`],
    ]);
  }

  // ── zip container (stored, no compression) ──
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const utf8 = (s) => new TextEncoder().encode(s);
  function zip(files) {
    const parts = [], central = []; let off = 0;
    const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
    files.forEach(([name, data]) => {
      const d = typeof data === 'string' ? utf8(data) : data, nm = utf8(name), crc = crc32(d);
      const head = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(d.length), u32(d.length), u16(nm.length), u16(0));
      const local = new Uint8Array([0x50, 0x4B, 3, 4].concat(head));
      parts.push(local, nm, d);
      central.push(new Uint8Array([0x50, 0x4B, 1, 2].concat(u16(20), head, u16(0), u16(0), u16(0), u32(0), u32(off))), nm);
      off += local.length + nm.length + d.length;
    });
    const csize = central.reduce((a, x) => a + x.length, 0);
    const end = new Uint8Array([0x50, 0x4B, 5, 6].concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(csize), u32(off), u16(0)));
    const all = parts.concat(central, [end]), out = new Uint8Array(all.reduce((a, x) => a + x.length, 0));
    let p = 0; all.forEach((x) => { out.set(x, p); p += x.length; });
    return out;
  }

  function cover(c) {
    const stripe = (fill) => `<w:tc><w:tcPr><w:tcW w:w="420" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>${tcmar(0, 0, 0, 0)}</w:tcPr><w:p><w:pPr><w:spacing w:line="20" w:lineRule="exact"/></w:pPr></w:p></w:tc>`;
    const main = (fill, top, body, center) => `<w:tc><w:tcPr><w:tcW w:w="11820" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>${tcmar(top, 1020, 0, 1100)}${center ? '<w:vAlign w:val="center"/>' : ''}</w:tcPr>${body}</w:tc>`;
    const row = (h, cells) => `<w:tr>${TRX}<w:trPr><w:cantSplit/><w:trHeight w:hRule="exact" w:val="${h}"/></w:trPr>${cells}</w:tr>`;
    const P = (after, line, runs, rule) => `<w:p><w:pPr><w:spacing w:after="${after}" w:line="${line}" w:lineRule="${rule || 'auto'}"/></w:pPr>${runs}</w:p>`;
    const r1 = P(60, 290, run(c.kicker, { b: true, caps: true, color: C.ACCENT, spacing: 60, sz: 17 })) + P(0, 290, run(c.subKicker, { caps: true, color: C.PALE, spacing: 50, sz: 15 }));
    const tl = c.titleLines.map((t, k) => P(k === c.titleLines.length - 1 ? 420 : 0, 1000, run(t, { color: 'FFFFFF', sz: 92 }), 'exact')).join('');
    const r2 = P(260, 290, run(c.eyebrow, { b: true, caps: true, color: C.ACCENT, spacing: 80 })) + tl
      + `<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="18" w:space="0" w:color="${C.ACCENT}"/></w:pBdr><w:spacing w:line="200" w:lineRule="exact"/><w:ind w:right="6900"/></w:pPr></w:p>`
      + `<w:p><w:pPr><w:spacing w:before="160" w:after="100" w:line="420" w:lineRule="auto"/></w:pPr>${run(c.subtitle, { color: 'FFFFFF', sz: 34 })}</w:p>` + P(0, 290, run(c.date, { color: C.PALE }));
    const r3 = c.details.map(([lab, val]) => P(60, 290, run(lab, { b: true, caps: true, color: C.ACCENT, spacing: 60, sz: 14 })) + P(340, 290, run(val, { color: 'FFFFFF', sz: 21 }))).join('');
    const r4 = P(0, 290, run(c.footer, { color: C.PALE, spacing: 30, sz: 14 }));
    return '<w:tbl><w:tblPr><w:tblW w:w="12240" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="10" w:type="dxa"/><w:right w:w="10" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="420"/><w:gridCol w:w="11820"/></w:tblGrid>'
      + row(1500, stripe(C.ACCENT) + main(C.PRIMARY, 1000, r1)) + row(7700, stripe(C.ACCENT) + main(C.PRIMARY, 0, r2, true)) + row(5360, stripe(C.ACCENT) + main(C.PRIMARY, 500, r3)) + row(1200, stripe(C.DEEP) + main(C.DEEP, 0, r4, true)) + '</w:tbl>'
      + '<w:p><w:pPr><w:spacing w:line="20" w:lineRule="exact"/></w:pPr></w:p>'
      + '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr></w:pPr></w:p>';
  }

  // Page numbers on the contents page are PAGEREF fields; Word fills them in when the file is opened.
  function pageref(id, rpr) {
    const r = (x) => `<w:r><w:rPr>${rpr}</w:rPr>${x}</w:r>`;
    return r('<w:fldChar w:fldCharType="begin" w:dirty="true"/>') + r(`<w:instrText xml:space="preserve"> PAGEREF _HA${id} \\h </w:instrText>`) + r('<w:fldChar w:fldCharType="separate"/>') + r('<w:t xml:space="preserve"> </w:t>') + r('<w:fldChar w:fldCharType="end"/>');
  }
  function contents(toc) {
    let out = `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="${C.ACCENT}"/></w:pBdr></w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>`;
    toc.forEach((e) => {
      if (e.level === 1) out += '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="420"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:before="170" w:after="40"/></w:pPr>'
        + (e.num ? run(e.num, { b: true, color: C.ACCENT }) : '') + '<w:r><w:tab/></w:r>' + run(e.title, { b: true, color: C.PRIMARY }) + `<w:r><w:tab/></w:r>` + pageref(e.id, `<w:b/><w:bCs/><w:color w:val="${C.PRIMARY}"/>`) + '</w:p>';
      else out += '<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs><w:spacing w:after="20"/><w:ind w:left="420"/></w:pPr>'
        + run(e.title, { color: C.MUTED, sz: 17 }) + `<w:r><w:rPr><w:color w:val="${C.MUTED}"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr><w:tab/></w:r>` + pageref(e.id, `<w:color w:val="${C.MUTED}"/><w:sz w:val="17"/><w:szCs w:val="17"/>`) + '</w:p>';
    });
    return out;
  }

  /** model: { cover, header:{left,right}, footer:{left,date}, blocks:[...] }; skeleton: parsed skeleton.json. Returns Uint8Array. */
  function build(model, skeleton) {
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const body = [], toc = [], files = [], chartRels = [];
    let nfig = 0, ntab = 0, id = 100;
    model.blocks.forEach((b) => {
      switch (b.t) {
        case 'h1': {
          // A section starts on a new page, so a trailing spacer from the block before it is dropped: left in, it can
          // spill onto a page of its own and leave that page blank.
          const last = body[body.length - 1];
          if (last) [spacer(), spacer(200)].forEach((sp) => { if (body[body.length - 1].endsWith(sp)) body[body.length - 1] = body[body.length - 1].slice(0, -sp.length); });
          id++; toc.push({ level: 1, num: b.num, title: b.title, id }); body.push(h1(b.title, b.num, id)); break;
        }
        case 'h2': id++; toc.push({ level: 2, title: b.title, id }); body.push(h2(b.title, id)); break;
        case 'p': body.push(para(b.text, b)); break;
        case 'eyebrow': body.push(eyebrow(b.text)); break;
        case 'bullet': body.push(bullet(b.text)); break;
        case 'num': body.push(numbered(b.n, b.lead, b.text)); break;
        case 'tiles': body.push(tiles(b.items)); break;
        case 'callout': body.push(callout(b.label, b.paras)); break;
        case 'banner': body.push(banner(b.text)); break;
        case 'table': ntab++; body.push(table(ntab, b)); break;
        case 'chart': {
          nfig++; const n = nfig, rid = 'rIdChart' + n;
          files.push([`word/charts/chart${n}.xml`, chartXml(b)]);
          files.push([`word/charts/_rels/chart${n}.xml.rels`, X + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/Chart_Data_${n}.xlsx"/></Relationships>`]);
          files.push([`word/embeddings/Chart_Data_${n}.xlsx`, chartWorkbook(b)]);
          chartRels.push([rid, `charts/chart${n}.xml`]);
          body.push(caption('FIGURE', n, b.title),
            `<w:p><w:pPr><w:keepNext/><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="5943600" cy="${b.height || 2560000}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
            + `<wp:docPr id="${900 + n}" name="Chart ${n}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">`
            + `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rid}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`, source(b.src || ''));
          break;
        }
        default: throw new Error('Unknown block type: ' + b.t);
      }
    });
    const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/><w:footerReference w:type="default" r:id="rId11"/><w:pgSz w:w="12240" w:h="15840"/>'
      + '<w:pgMar w:top="1500" w:right="1440" w:bottom="1260" w:left="1440" w:header="620" w:footer="560" w:gutter="0"/><w:pgNumType w:start="2"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>';
    const P = skeleton.parts, out = [];
    const fr = (bold) => `<w:r><w:rPr>${bold}</w:rPr>`;
    const pn = `<w:b/><w:bCs/><w:color w:val="${C.PRIMARY}"/><w:sz w:val="15"/><w:szCs w:val="15"/>`;
    const header = skeleton.hdrOpen + `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="5" w:color="${C.ACCENT}"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>${run(model.header.left.toUpperCase(), { b: true, color: C.PRIMARY, spacing: 40, sz: 13 })}<w:r><w:rPr><w:color w:val="${C.MUTED}"/><w:spacing w:val="40"/><w:sz w:val="13"/><w:szCs w:val="13"/></w:rPr><w:tab/><w:t>${esc(model.header.right.toUpperCase())}</w:t></w:r></w:p></w:hdr>`;
    const footer = skeleton.ftrOpen + `<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="${C.HAIR}"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>${run(model.footer.left, { color: C.MUTED, sz: 14 })}<w:r><w:rPr><w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr><w:tab/></w:r>${run(model.footer.date + '   ', { color: C.MUTED, sz: 14 })}`
      + fr(pn) + '<w:fldChar w:fldCharType="begin"/></w:r>' + fr(pn) + '<w:instrText>PAGE</w:instrText></w:r>' + fr(pn) + '<w:fldChar w:fldCharType="separate"/></w:r>' + fr(pn) + '<w:t>2</w:t></w:r>' + fr(pn) + '<w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';
    Object.keys(P).forEach((name) => {
      let s = P[name];
      if (name === '[Content_Types].xml') s = s.replace('</Types>', chartRels.map((_, k) => `<Override PartName="/word/charts/chart${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join('') + '</Types>');
      if (name === 'word/_rels/document.xml.rels') s = s.replace('</Relationships>', chartRels.map(([rid, t]) => `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="${t}"/>`).join('') + '</Relationships>');
      if (name === 'docProps/core.xml') s = s.replace('{{TITLE}}', esc(model.header.left + ': ' + model.header.right));
      out.push([name, s]);
    });
    out.push(['word/document.xml', skeleton.docHead + cover(model.cover) + contents(toc) + body.join('') + sect + '</w:body></w:document>']);
    out.push(['word/header1.xml', header], ['word/footer1.xml', footer]);
    // [Content_Types].xml must be the first entry in the package
    out.sort((a, z) => (z[0] === '[Content_Types].xml') - (a[0] === '[Content_Types].xml'));
    return { bytes: zip(out.concat(files)), figures: nfig, tables: ntab };
  }

  const api = { build, COLORS: C };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HADocx = api;
})(typeof window !== 'undefined' ? window : globalThis);
