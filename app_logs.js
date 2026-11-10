'use strict';
/* well logs, geosteering, actual survey entry (split from index.html; loaded in order, shares globals) */
/* ================= well logs ================= */
/* state.logs = { curves: [{ name, unit, desc, src, trk, d0, dstep | md, v }] }; trk 0 = hidden, 1..6 = track (tracks are stacked, each with its own Y axis). */
const LOG = { pending: null };
const LOGT = { on: true };
try { LOGT.on = localStorage.getItem('wellplanner.logTops') !== '0'; } catch (e) {}
const LOGZ = { mode: 0, start: null, lo: null, hi: null };   // zoom: mode 0 off, 1 waiting for the start click, 2 waiting for the end click
const LOG_DEF = [[/^(gr|gamma|gamma_?ray|gam|gr_?[a-z0-9]*)$/i, 1], [/^(tg|total_?gas|tgas|gas_?total)$/i, 2], [/^rop[a-z0-9_]*$/i, 3]];
const GR_STOPS = () => [{ v: 55, c: '#ffe94d' }, { v: 65, c: '#ffe94d' }, { v: 90, c: '#a8e6a1' }, { v: 105, c: '#8e44ad' }];
function defaultFill(c, g) {                  // gamma ray gets the lithology ramp; other curves a plain two-colour ramp across their own range
  if (g === 0) return { on: true, alpha: 0.85, stops: GR_STOPS() };
  const v = c.v.filter(x => x !== null).sort((a, b) => a - b), lo = v[Math.floor(v.length * 0.05)] || 0, hi = v[Math.floor(v.length * 0.95)] || lo + 1;
  return { on: true, alpha: 0.85, stops: [{ v: +lo.toFixed(2), c: '#ffe94d' }, { v: +(hi > lo ? hi : lo + 1).toFixed(2), c: '#8e44ad' }] };
}
const logGroup = name => LOG_DEF.findIndex(d => d[0].test(String(name).trim()));
const LOG_RED = '#e53935';
function logColor(c, i) {                     // own colour if set; else GR follows the theme ink (black in light mode, white in dark), TG is red, the rest use the palette
  if (c.color) return c.color;
  const g = logGroup(c.name); if (g === 0) return css('--ink'); if (g === 1) return LOG_RED;
  const p = logColors(); return p[i % p.length];
}
const logColors = () => [css('--good'), css('--accent'), css('--blue'), css('--ink'), css('--amber'), css('--warn')];
const logMsg = t => { $('#logMsg').textContent = t || ''; };
function renderLogPick() {
  const box = $('#logPick'), p = LOG.pending; box.hidden = !p; if (!p) { box.innerHTML = ''; return; }
  const seen = new Set();
  box.innerHTML = `<div class="hint" style="margin:6px 0">${esc(p.src)}${p.r.well ? ' · ' + esc(p.r.well) : ''} · ${p.r.depth.length.toLocaleString()} depth rows, MD ${fmt(p.r.depth[0], 1)} to ${fmt(p.r.depth[p.r.depth.length - 1], 1)} ft${p.r.toFeet !== 1 ? ' (converted from metres)' : ''}. Tick the curves to import.</div>` +
    `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px 12px" class="chkcol">` +
    p.r.curves.map((c, i) => { const g = logGroup(c.mnem), on = g >= 0 && !seen.has(g); if (on) seen.add(g);
      return `<label class="chk"><input type="checkbox" data-lp="${i}"${on ? ' checked' : ''}><span><b>${esc(c.mnem)}</b>${c.unit ? ' (' + esc(c.unit) + ')' : ''}${c.desc ? ' <span class="mut">' + esc(c.desc) + '</span>' : ''}</span></label>`; }).join('') +
    `</div><div class="toolbar" style="margin-top:8px"><button class="small primary" id="bLogGo">Import selected</button><button class="small" id="bLogAll">All</button><button class="small" id="bLogNone">None</button><button class="small" id="bLogCancel">Cancel</button></div>`;
}
function setLogOpen(open, save) {
  $('#logBody').hidden = !open; $('#logArrow').textContent = open ? '▾' : '▸'; $('#logHead').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (save) { try { localStorage.setItem('wellplanner.logOpen', open ? '1' : '0'); } catch (e) {} }
}
$('#logHead').onclick = () => setLogOpen($('#logBody').hidden, true);
$('#logHead').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLogOpen($('#logBody').hidden, true); } };
{ let o = true; try { o = localStorage.getItem('wellplanner.logOpen') !== '0'; } catch (e) {} setLogOpen(o, false); }
function renderLogs() {
  { const n = state.logs ? state.logs.curves.length : 0; $('#logCount').textContent = n ? n + ' curve' + (n === 1 ? '' : 's') : 'no logs'; }
  renderLogPick();
  const L = state.logs, cs = L ? L.curves : [];
  $('#bLogClear').hidden = !cs.length;
  const opts = t => ['<option value="0">Hidden</option>'].concat([1, 2, 3, 4, 5, 6].map(k => `<option value="${k}"${k === t ? ' selected' : ''}>Track ${k}</option>`)).join('').replace('<option value="0">', `<option value="0"${t === 0 ? ' selected' : ''}>`);
  const col = logColors();
  $('#logCurves').innerHTML = cs.length ? `<div style="display:grid;grid-template-columns:auto 1fr auto auto auto auto;gap:6px 12px;align-items:center;margin-top:8px;font-size:12px">` +
    cs.map((c, i) => { const r = WP.logRange(c);
      return `<span style="display:inline-block;width:14px;height:3px;background:${logColor(c, i)}"></span><span><b>${esc(c.name)}</b>${c.unit ? ' (' + esc(c.unit) + ')' : ''} <span class="mut">MD ${fmt(r[0], 0)} to ${fmt(r[1], 0)} · ${c.v.length.toLocaleString()} samples · ${esc(c.src || '')}</span></span>` +
        `<select data-lt="${i}" style="width:auto">${opts(c.trk | 0)}</select><button class="small" data-ls="${i}" title="Axis range, direction, log scale and line colour">Scale…</button>` +
        `<button class="small" data-lf="${i}" title="Colour fill under the curve" style="display:flex;gap:6px;align-items:center">Fill…${c.fill && c.fill.on ? `<span style="display:inline-block;width:34px;height:10px;border-radius:2px;background:${fillCss(c.fill, 34)}"></span>` : ''}</button><button class="small ghost" data-ld="${i}" title="Remove this curve">×</button>`; }).join('') + `</div>` : '';
}
/* Right end of the Geosteering x axis when not zoomed: the logs, or the last actual survey station if that is deeper, plus 2% of
 * the way in from the first one as a buffer, so newly pasted survey points are always on the chart. */
function geoHi(logHi, lo) {
  const last = ACT.rows ? ACT.rows[ACT.rows.length - 1].md : -Infinity, top = Math.max(logHi, last), from = lo != null ? lo : ACT.rows ? ACT.rows[0].md : 0;
  return top + Math.max(5, (top - Math.min(from, top)) * 0.02);
}
function drawLogs() {
  const wrap = $('#logPlot'), box = $('#logTracks'), L = state.logs, cs = L ? L.curves.filter(c => c.trk > 0) : [];
  if (!cs.length) return;
  const tr = [...new Set(cs.map(c => c.trk))].sort((a, b) => a - b), key = tr.join(',');
  if (box.dataset.key === key) tr.forEach((t, i) => { box.children[i].style.height = GEO.trackH(i, tr.length) + 'px'; });
  if (box.dataset.key !== key) { box.innerHTML = tr.map((t, i) => `<canvas class="ltk" id="cvLog${i}" style="height:${GEO.trackH(i, tr.length)}px;cursor:crosshair"></canvas>`).join(''); box.dataset.key = key; }
  const rg = cs.map(c => WP.logRange(c)), lo = LOGZ.lo != null ? LOGZ.lo : Math.min(...rg.map(r => r[0])), hi = LOGZ.hi != null ? LOGZ.hi : geoHi(Math.max(...rg.map(r => r[1])), Math.min(...rg.map(r => r[0]))), col = logColors();
  logZoomUi();   // x axis spans the displayed log data
  const topMarks = LOGT.on && state.tops ? WP.formationMds(topsEff(), ACT.rows || M.survey, state.surface).filter(t => t.md !== null && t.md >= lo && t.md <= hi).map(t => ({ x: t.md, name: t.name })) : [];
  const anyRight = tr.some(t => cs.filter(c => c.trk === t).length > 1);
  tr.forEach((t, i) => {
    const own = cs.filter(c => c.trk === t);
    lineChart('cvLog' + i, { padRight: anyRight, tops: topMarks, topLabels: i === 0, xl: 'Measured depth (ft)', hideX: i < tr.length - 1, right: own.length > 1, xrange: [lo, hi], vlines: LOGZ.mode === 2 ? [{ x: LOGZ.start, color: css('--accent') }] : [], dropLines: true, axisLabels: true, cursorTop: i === 0, cursor: ACT.hov ? ACT.hov.md : null,
      series: own.map((c, k) => ({ name: c.name + (c.unit ? ' (' + c.unit + ')' : ''), label: c.name, color: logColor(c, L.curves.indexOf(c)), axis: k === 1 ? 'right' : 'left', scale: c.scale, fill: c.fill && c.fill.on ? c.fill : null, pts: WP.logSeries(c, lo, hi, 1500) })) });
  });
  drawGeoTvd(lo, hi, anyRight);
}
function fillCss(f, w, lo, hi) {            // CSS gradient of a colour ramp, spanning lo..hi (default: the stops, padded)
  const st = f.stops; if (!st.length) return 'none';
  const a = lo == null ? st[0].v : lo, b = hi == null ? st[st.length - 1].v : hi, sp = b - a || 1;
  return 'linear-gradient(to right,' + st.map(s => `${s.c} ${Math.max(0, Math.min(100, (s.v - a) / sp * 100)).toFixed(1)}%`).join(',') + ')';
}
function openScaleEditor(idx) {
  const cv = state.logs.curves[idx], snap = JSON.stringify([cv.scale || null, cv.color || null]), sc = cv.scale || (cv.scale = {});
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `<div style="background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:16px 18px;max-width:420px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.4)">
    <h3 style="margin:0 0 4px">Scale · ${esc(cv.name)}${cv.unit ? ' (' + esc(cv.unit) + ')' : ''}</h3>
    <div class="hint" style="margin:0 0 8px">Leave a limit blank for automatic. If two curves share a track, the first sets the left axis and the second the right axis.</div>
    <div class="g2"><label class="f">Axis minimum<input type="number" step="any" id="scMin"></label><label class="f">Axis maximum<input type="number" step="any" id="scMax"></label></div>
    <div class="chkcol" style="margin-top:8px"><label class="chk"><input type="checkbox" id="scLog"><span>Logarithmic scale (values of zero or less sit at the bottom)</span></label><label class="chk"><input type="checkbox" id="scRev"><span>Reverse the axis (larger values lower down)</span></label></div>
    <div style="display:flex;gap:10px;align-items:center;margin-top:10px;font-size:12px"><span>Line colour</span><input type="color" id="scCol" style="width:44px;height:30px;padding:0"><button class="small" id="scColDef">Use default</button></div>
    <div class="toolbar" style="margin-top:12px"><span class="grow"></span><button id="scCancel">Cancel</button><button class="primary" id="scDone">Done</button></div></div>`;
  document.body.appendChild(ov);
  const $e = q => ov.querySelector(q), live = () => { autosave(); renderLogs(); drawGeo(); };
  $e('#scMin').value = sc.min != null ? sc.min : ''; $e('#scMax').value = sc.max != null ? sc.max : ''; $e('#scLog').checked = !!sc.log; $e('#scRev').checked = !!sc.rev;
  const curCol = () => { const c = logColor(cv, idx); return /^#[0-9a-f]{6}$/i.test(c) ? c : '#' + (c.match(/\d+/g) || [128, 128, 128]).slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join(''); };
  $e('#scCol').value = curCol();
  const read = () => { const n = id => { const v = parseFloat($e(id).value); return isFinite(v) ? v : null; }; sc.min = n('#scMin'); sc.max = n('#scMax'); sc.log = $e('#scLog').checked; sc.rev = $e('#scRev').checked; live(); };
  ['#scMin', '#scMax'].forEach(q => $e(q).oninput = read); ['#scLog', '#scRev'].forEach(q => $e(q).onchange = read);
  $e('#scCol').oninput = e => { cv.color = e.target.value; live(); };
  $e('#scColDef').onclick = () => { delete cv.color; $e('#scCol').value = curCol(); live(); };
  $e('#scCancel').onclick = () => { const o = JSON.parse(snap); if (o[0]) cv.scale = o[0]; else delete cv.scale; if (o[1]) cv.color = o[1]; else delete cv.color; ov.remove(); live(); };
  $e('#scDone').onclick = () => { if (sc.min == null && sc.max == null && !sc.log && !sc.rev) delete cv.scale; ov.remove(); live(); };
}
function openFillEditor(idx) {
  const cv = state.logs.curves[idx], snap = JSON.stringify(cv.fill || null);
  if (!cv.fill) cv.fill = Object.assign(defaultFill(cv, logGroup(cv.name) === 0 ? 0 : -1), { on: false });
  const f = cv.fill, g = logGroup(cv.name) === 0 ? 0 : -1;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `<div style="background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:16px 18px;max-width:520px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.4)">
    <h3 style="margin:0 0 8px">Colour fill · ${esc(cv.name)}${cv.unit ? ' (' + esc(cv.unit) + ')' : ''}</h3>
    <label class="chk"><input type="checkbox" id="feOn"><span>Fill under the curve</span></label>
    <div style="margin:10px 0 2px;font-size:12px;color:var(--muted)">Colour bar · click it to add a marker at that value</div>
    <div id="feBar" style="position:relative;height:30px;border-radius:6px;border:1px solid var(--line);cursor:copy"></div>
    <div id="feMarks" style="position:relative;height:16px"></div>
    <div id="feRows" style="display:grid;grid-template-columns:1fr auto auto;gap:6px 10px;align-items:center;margin-top:6px;font-size:12px"></div>
    <div style="margin-top:8px;display:flex;gap:10px;align-items:center;font-size:12px"><span>Opacity</span><input type="range" id="feAlpha" min="0.2" max="1" step="0.05" style="flex:1"><span id="feAlphaV" style="width:34px;text-align:right"></span></div>
    <div class="toolbar" style="margin-top:12px"><button class="small" id="feAdd">Add marker</button><button class="small" id="feReset">Reset to default</button><span class="grow"></span><button id="feCancel">Cancel</button><button class="primary" id="feDone">Done</button></div></div>`;
  document.body.appendChild(ov);
  const $e = q => ov.querySelector(q), span = () => { const a = f.stops[0].v, b = f.stops[f.stops.length - 1].v, p = (b - a) * 0.12 || 5; return [a - p, b + p]; };
  const live = () => { autosave(); renderLogs(); drawGeo(); };
  function bar() {
    const [lo, hi] = span(); $e('#feBar').style.background = fillCss(f, 0, lo, hi);
    $e('#feMarks').innerHTML = f.stops.map(s => `<div title="${s.v}" style="position:absolute;left:${(s.v - lo) / (hi - lo) * 100}%;top:0;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:10px solid ${s.c};filter:drop-shadow(0 0 1px #000)"></div><div style="position:absolute;left:${(s.v - lo) / (hi - lo) * 100}%;top:0;transform:translateX(-50%);font-size:10px;color:var(--muted);padding-top:9px">${s.v}</div>`).join('');
  }
  function rows() {
    f.stops.sort((a, b) => a.v - b.v);
    $e('#feRows').innerHTML = f.stops.map((s, i) => `<label class="f" style="margin:0;font-size:11px">${i === 0 ? 'Start value (and below)' : i === f.stops.length - 1 ? 'End value (and above)' : 'Marker value'}<input type="number" step="any" data-sv="${i}" value="${s.v}"></label><input type="color" data-sc="${i}" value="${s.c}" style="width:44px;height:30px;padding:0;margin-top:14px"><button class="small ghost" data-sd="${i}" style="margin-top:14px"${f.stops.length < 2 ? ' disabled' : ''}>×</button>`).join('');
    bar();
  }
  const sync = () => { $e('#feOn').checked = !!f.on; $e('#feAlpha').value = f.alpha == null ? 0.85 : f.alpha; $e('#feAlphaV').textContent = Math.round((f.alpha == null ? 0.85 : f.alpha) * 100) + '%'; rows(); live(); };
  $e('#feOn').onchange = e => { f.on = e.target.checked; live(); };
  $e('#feAlpha').oninput = e => { f.alpha = +e.target.value; $e('#feAlphaV').textContent = Math.round(f.alpha * 100) + '%'; live(); };
  $e('#feRows').addEventListener('input', e => { const c = e.target.closest('[data-sc]'); if (c) { f.stops[+c.dataset.sc].c = c.value; f.on = true; $e('#feOn').checked = true; bar(); live(); } });
  $e('#feRows').addEventListener('change', e => { const v = e.target.closest('[data-sv]'); if (v && isFinite(parseFloat(v.value))) { f.stops[+v.dataset.sv].v = parseFloat(v.value); f.on = true; sync(); } });
  $e('#feRows').addEventListener('click', e => { const d = e.target.closest('[data-sd]'); if (d && f.stops.length > 1) { f.stops.splice(+d.dataset.sd, 1); sync(); } });
  $e('#feBar').onclick = e => {
    const r = e.currentTarget.getBoundingClientRect(), [lo, hi] = span(), v = +(lo + (e.clientX - r.left) / r.width * (hi - lo)).toFixed(1);
    const c = colorAt(f.stops, v), hx = c[0] === '#' ? c : '#' + c.match(/\d+/g).slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('');
    f.stops.push({ v, c: hx }); f.on = true; sync();
  };
  $e('#feAdd').onclick = () => { const a = f.stops[f.stops.length - 1]; f.stops.push({ v: +(a.v + 10).toFixed(1), c: a.c }); sync(); };
  $e('#feReset').onclick = () => { const d = defaultFill(cv, g); f.stops = d.stops; f.alpha = d.alpha; f.on = true; sync(); };
  $e('#feCancel').onclick = () => { const o = JSON.parse(snap); if (o) cv.fill = o; else delete cv.fill; ov.remove(); live(); };
  $e('#feDone').onclick = () => ov.remove();
  sync();
}
/* TVD (Y, increasing downward) against MD, on the same MD axis and margins as the log tracks */
function drawGeoTvd(lo, hi, anyRight) {
  const sv = ACT.rows, pl = M.survey;
  if (!sv && !pl) return;
  $('#cvGeoTvd').style.height = GEO.tvdH + 'px';
  const clip = rows => { const k = rows.filter(r => r.md >= lo && r.md <= hi), i0 = rows.findIndex(r => r.md >= lo), i1 = rows.length - 1 - [...rows].reverse().findIndex(r => r.md <= hi);
    return (i0 > 0 ? [rows[i0 - 1]] : []).concat(k, i1 >= 0 && i1 < rows.length - 1 ? [rows[i1 + 1]] : []).map(r => [r.md, r.tvd]); };
  const series = [];
  if (sv) series.push({ name: 'Actual TVD', color: css('--ink'), scale: { rev: true, fit: true }, pts: clip(sv) });
  const pj = sv && aheadOf(); if (pj) series.push({ name: 'Projected TVD', color: css('--ink'), dash: [5, 3], scale: null, pts: [[sv[sv.length - 1].md, sv[sv.length - 1].tvd]].concat(pj.proj.rows.map(r => [r.md, r.tvd])) });
  if (pl) series.push({ name: 'Plan TVD', color: css('--accent'), scale: sv ? null : { rev: true, fit: true }, pts: clip(pl) });
  const tops = topsEff().filter(t => isFinite(t.tvd)).sort((x, y) => x.tvd - y.tvd), path = sv || pl;
  const zs = $('#geoZone'), want = state.geoZone && tops.some(t => t.name === state.geoZone) ? state.geoZone : '';
  if (zs.dataset.sig !== tops.map(t => t.name).join('|')) { zs.dataset.sig = tops.map(t => t.name).join('|'); zs.innerHTML = '<option value="">none</option>' + tops.map(t => `<option>${t.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`).join(''); }
  zs.value = want; zs.disabled = !tops.length;
  const kmd = path.filter(r => r.md >= lo && r.md <= hi).map(r => r.md);
  tops.forEach(t => series.push({ name: t.name, tag: t.name, color: t.name === want ? css('--good') : css('--muted'), dash: [4, 3], noScale: true, noLegend: true,
    pts: (kmd.length ? kmd : [lo, hi]).map(md => { const r = WP.planAtMd(path, md); return [md, WP.topTvdAt(t, r.northing, r.easting, state.surface)]; }) }));
  const z = want ? WP.inZone(path, tops, state.surface, want, lo, hi) : null, ft = v => Math.round(v).toLocaleString();
  $('#geoZoneStat').textContent = z && z.total ? `In zone ${(100 * z.inside / z.total).toFixed(1)}% · ${ft(z.inside)} ft  (above ${ft(z.above)} ft, below ${ft(z.below)} ft, MD ${ft(lo)}–${ft(hi)})` : '';
  lineChart('cvGeoTvd', { xl: 'Measured depth (ft)', xrange: [lo, hi], padRight: anyRight, dropLines: true, cursor: ACT.hov ? ACT.hov.md : null, series });
}
/* The Geosteering tab fills the window: whatever is left under the Well logs card is split evenly between the logs and the TVD chart. */
const GEO = { logH: 300, tvdH: 300, trackH: (i, n) => { const u = Math.max(44, (GEO.logH - 30) / n); return Math.round(i === n - 1 ? u + 30 : u); } };
function layoutGeo(hasLogs, hasTvd) {
  const main = $('main'), pane = $('#pane-geo'); pane.style.height = '';
  const top = pane.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
  const avail = Math.max(420, main.clientHeight - top - 24);       // main keeps 40px of padding at the bottom, less the pane's -20px margin, less a little slack
  pane.style.height = avail + 'px';
  const n = (hasLogs ? 1 : 0) + (hasTvd ? 1 : 0); if (!n) return;
  const sec = Math.max(150, (avail - $('#logCard').getBoundingClientRect().height - 5 * n) / n), inner = sec - 40;    // 40px for each section's title and padding
  GEO.logH = inner; GEO.tvdH = inner;
}
function drawGeo() {
  if (!$('#pane-geo').classList.contains('on')) return;
  const L = state.logs, hasLogs = !!(L && L.curves.some(c => c.trk > 0)), hasTvd = !!(ACT.rows || M.survey);
  $('#logPlot').hidden = !hasLogs; $('#geoTvd').hidden = !hasTvd;
  layoutGeo(hasLogs, hasTvd);
  if (hasLogs) drawLogs();
  else if (hasTvd) { const rows = ACT.rows || M.survey, lo0 = rows[0].md; drawGeoTvd(lo0, geoHi(rows[rows.length - 1].md, lo0), false); }
}
new ResizeObserver(() => drawGeo()).observe($('#logCard'));
function renderGeo() {
  if (!$('#pane-geo').classList.contains('on')) return;
  renderLogs(); drawLogs();
}
function logZoomUi() {
  const b = $('#bLogZoom'); if (!b) return;
  b.textContent = LOGZ.mode === 1 ? 'Click the start point…' : LOGZ.mode === 2 ? 'Click the end point…' : 'Zoom to interval';
  b.classList.toggle('primary', LOGZ.mode > 0); $('#bLogZoomReset').hidden = LOGZ.lo == null;
}
$('#bLogZoom').onclick = () => { LOGZ.mode = LOGZ.mode ? 0 : 1; LOGZ.start = null; drawLogs(); };
$('#bLogZoomReset').onclick = () => { LOGZ.lo = LOGZ.hi = null; LOGZ.mode = 0; drawLogs(); };
$('#logTracks').addEventListener('click', e => {
  const c = e.target.closest('canvas'); if (!LOGZ.mode || !c || !c._lc) return;
  const L = c._lc, f = (e.clientX - c.getBoundingClientRect().left - L.m.l) / L.iw; if (f < 0 || f > 1) return;
  const md = L.xlo + f * (L.xhi - L.xlo);
  if (LOGZ.mode === 1) { LOGZ.start = md; LOGZ.mode = 2; drawLogs(); return; }
  const a = Math.min(LOGZ.start, md), b = Math.max(LOGZ.start, md);
  LOGZ.mode = 0; LOGZ.start = null; if (b - a >= 2) { LOGZ.lo = a; LOGZ.hi = b; } drawLogs();
});
$('#logTopsOn').checked = LOGT.on;
$('#logTopsOn').onchange = e => { LOGT.on = e.target.checked; try { localStorage.setItem('wellplanner.logTops', LOGT.on ? '1' : '0'); } catch (x) {} drawLogs(); };
function logChanged() { autosave(); renderLogs(); drawGeo(); }
$('#bLogFile').onclick = () => $('#logFile').click();
$('#logFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const r = WP.parseLAS(await f.text());
  if (!r.ok) { LOG.pending = null; renderLogPick(); logMsg('Could not read ' + f.name + ': ' + r.error); return; }
  LOG.pending = { src: f.name, r }; logMsg(''); setLogOpen(true, false); renderLogPick();
};
$('#logCard').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'bLogCancel') { LOG.pending = null; renderLogPick(); return; }
  if (b.id === 'bLogAll' || b.id === 'bLogNone') { $$('#logPick [data-lp]').forEach(c => { c.checked = b.id === 'bLogAll'; }); return; }
  if (b.id === 'bLogClear') { if (confirm('Remove all well logs from this well?')) { state.logs = null; logChanged(); logMsg(''); } return; }
  if (b.dataset.ls !== undefined) { openScaleEditor(+b.dataset.ls); return; }
  if (b.dataset.lf !== undefined) { openFillEditor(+b.dataset.lf); return; }
  if (b.dataset.ld !== undefined) { state.logs.curves.splice(+b.dataset.ld, 1); if (!state.logs.curves.length) state.logs = null; logChanged(); return; }
  if (b.id === 'bLogGo') {
    const p = LOG.pending, picks = $$('#logPick [data-lp]').filter(c => c.checked).map(c => +c.dataset.lp);
    if (!picks.length) { logMsg('Tick at least one curve to import.'); return; }
    const L = state.logs || (state.logs = { curves: [] }), nm = x => String(x).trim().toLowerCase(); let added = 0, repl = 0;
    picks.forEach(i => {
      const m = p.r.curves[i], c = WP.packLogCurve({ name: m.mnem, unit: m.unit, desc: m.desc, src: p.src, trk: 0 }, p.r.depth, p.r.cols[i]);
      const k = L.curves.findIndex(x => nm(x.name) === nm(c.name));
      if (k >= 0) { c.trk = L.curves[k].trk; c.fill = L.curves[k].fill; L.curves[k] = c; repl++; }
      else { const g = logGroup(c.name), t = g >= 0 ? LOG_DEF[g][1] : 0; c.trk = t && !L.curves.some(x => x.trk === t) ? t : 0; if (g === 0) c.fill = defaultFill(c, 0); L.curves.push(c); added++; }
    });
    LOG.pending = null; logChanged();
    logMsg(`Imported ${picks.length} curve${picks.length === 1 ? '' : 's'}${repl ? ` (${repl} replaced)` : ''}. Use the Track menus to choose what is shown and where.`);
  }
});
$('#logCard').addEventListener('change', e => {
  const s = e.target.closest('[data-lt]'); if (!s) return;
  state.logs.curves[+s.dataset.lt].trk = +s.value; logChanged();
});
function drawActual() {
  if ($('#pane-geo').classList.contains('on')) drawGeo();
  if (!$('#pane-actual').classList.contains('on') || !ACT.rows) return;
  draw2D('apPlan'); draw3D('cvAp3d'); drawApDist();
}
/* Projection to bit from the last two stations, and the constant-DLS arc that rejoins the plan. Null without an actual survey. */
function aheadOf() {
  if (!ACT.rows || ACT.rows.length < 2 || !M.survey) return null;
  const len = Math.max(10, +$('#actProj').value || 100), rd = Math.max(50, +$('#actRej').value || 300), last = ACT.rows[ACT.rows.length - 1];
  const proj = WP.projectAhead(ACT.rows, len, 30, M.vsAzi); if (!proj) return null;
  const end = proj.rows[proj.rows.length - 1], sep = WP.planVsActual([end], M.survey)[0], pm = WP.planVsActual([last], M.survey)[0].planMd;
  return { proj, dist: sep ? sep.dist : 0, rej: WP.rejoinPlan(last, M.survey, pm, rd), rejMd: pm + rd };
}
$('#actProj').oninput = $('#actRej').oninput = () => { renderActual(); renderOffsetResults(); };
function setActOpen(open, save) {
  $('#actCardBody').hidden = !open; $('#actArrow').textContent = open ? '▾' : '▸'; $('#actHead').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (save) { try { localStorage.setItem('wellplanner.actOpen', open ? '1' : '0'); } catch (e) {} }
}
$('#actHead').onclick = () => setActOpen($('#actCardBody').hidden, true);
$('#actHead').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActOpen($('#actCardBody').hidden, true); } };
{ let o = true; try { o = localStorage.getItem('wellplanner.actOpen') !== '0'; } catch (e) {} setActOpen(o, false); }
function renderActual() {
  { const r = state.actual && state.actual.rows; $('#actCount').textContent = r && r.length ? `${r.length} stations, last MD ${fmt(r[r.length - 1].md, 0)}` : 'no survey'; }
  if (!$('#pane-actual').classList.contains('on')) return;
  const a = state.actual, has = !!ACT.rows;
  $('#actBody').hidden = !has; $('#bActClear').hidden = !a; $('#actOpts').hidden = !a;
  if (a) { $('#actTie').value = a.tie || 'auto'; $('#actTrue').checked = !!a.trueNorth; }
  if (!a) { if (!$('#actMsg').dataset.keep) $('#actMsg').textContent = 'Import the as-drilled survey (MD, inclination, azimuth), full or partial, to compare it with this well’s plan.'; return; }
  if (!M.survey) { $('#actMsg').textContent = 'The plan does not build right now, so there is nothing to compare with.'; return; }
  if (!has) { $('#actMsg').textContent = `${a.rows.length} station${a.rows.length === 1 ? '' : 's'} so far. Add at least two to draw the actual path.`; return; }
  const r = ACT.rows, last = r[r.length - 1], dv = ACT.dev, ld = dv[dv.length - 1];
  let mx = dv[0]; dv.forEach(d => { if (d.dist > mx.dist) mx = d; });
  const planEnd = M.survey[M.survey.length - 1];
  $('#actMsg').innerHTML = `${esc(a.src || 'Pasted survey')} · ${r.length} stations, MD ${fmt(r[0].md, 0)} to ${fmt(last.md, 0)} · ${ACT.tieHow}` +
    (a.trueNorth ? ` · azimuths converted from true north (${fmt(ACT.conv, 3)}° convergence)` : ' · azimuths taken as grid') +
    (last.md > planEnd.md + 1 ? ' · <b>the actual survey runs past the plan TD</b>' : '');
  $('#actMsg').dataset.keep = '';
  const st = (k, v, u, cls) => `<div class="stat ${cls || ''}"><div class="k">${k}</div><div class="v">${v}${u ? ` <small>${u}</small>` : ''}</div></div>`;
  $('#actStats').innerHTML =
    st('Last actual MD', fmt(last.md, 0), 'ft') + st('Last actual TVD', fmt(last.tvd, 0), 'ft') +
    st('Δ to plan at last station', fmt(ld.dist, 1), 'ft', ld.dist > 50 ? 'bad' : '') +
    st('Right (+) / left (−)', fmt(ld.right, 1), 'ft') + st('High (+) / low (−)', fmt(ld.high, 1), 'ft') +
    st('Largest distance', fmt(mx.dist, 1), `ft at MD ${fmt(mx.md, 0)}`);
  const pj = aheadOf(); let ah = '';
  if (pj) {
    const e = pj.proj.rows[pj.proj.rows.length - 1], rj = pj.rej, fm = (v, d) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), d);
    ah = st('Build / turn rate', `${fm(pj.proj.br, 2)} / ${fm(pj.proj.tr, 2)}`, '°/100 ft') +
      st(`Projected at MD ${fmt(e.md, 0)}`, `${fmt(e.inc, 1)}° / ${fmt(e.azi, 1)}°`, `TVD ${fmt(e.tvd, 0)}`) +
      st('Projected Δ to plan', fmt(pj.dist, 1), 'ft', pj.dist > 50 ? 'bad' : '') +
      (rj.error ? st('To rejoin plan', 'n/a', rj.error) :
        st(`DLS to rejoin plan at MD ${fmt(pj.rejMd, 0)}`, fmt(rj.dls, 2), `°/100 ft · TF ${fm(rj.tf, 0)}° (high side) · ${fmt(rj.arc, 0)} ft`, rj.dls > 6 ? 'bad' : '') +
        st('Arrives heading', `${fmt(rj.inc, 1)}° / ${fmt(rj.azi, 1)}°`, `plan ${fmt(rj.plan.inc, 1)}° / ${fmt(rj.plan.azi, 1)}°`));
  }
  $('#actAhead').innerHTML = ah;
  let h = '<thead><tr><th>MD (ft)</th><th>Inc (°)</th><th>Azi (°, grid)</th><th>TVD (ft)</th><th>VS (ft)</th><th>Distance to plan (ft)</th><th>Right + / left − (ft)</th><th>High + / low − (ft)</th><th>Plan MD at closest (ft)</th></tr></thead><tbody>';
  let nextMd = -Infinity;
  r.forEach((q, i) => {
    if (!(q.md >= nextMd || i === r.length - 1 || i === 0)) return; nextMd = Math.floor(q.md / 100) * 100 + 100;
    const d = dv[i];
    h += `<tr><td>${fmt(q.md, 0)}</td><td>${fmt(q.inc, 2)}</td><td>${fmt(q.azi, 2)}</td><td>${fmt(q.tvd, 1)}</td><td>${fmt(q.vs, 1)}</td><td>${fmt(d.dist, 1)}</td><td>${fmt(d.right, 1)}</td><td>${fmt(d.high, 1)}</td><td>${fmt(d.planMd, 0)}</td></tr>`;
  });
  $('#actTbl').innerHTML = h + '</tbody>';
  drawActual();
}
function actualMsg(t) { const m = $('#actMsg'); m.textContent = t; m.dataset.keep = '1'; }
function loadActualText(text, src) {
  const r = WP.parseActualText(text);
  if (r.rows.length < 2) { renderActual(); actualMsg(`Found ${r.rows.length} usable station${r.rows.length === 1 ? '' : 's'} in ${src || 'the pasted text'}. Each line needs MD, inclination and azimuth (a header line that names them is fine).` + (state.actual ? ' The existing actual survey was kept.' : '')); return; }
  const prev = state.actual;
  state.actual = { src: src || 'pasted survey', added: new Date().toISOString().slice(0, 10), trueNorth: prev ? !!prev.trueNorth : false, tie: prev ? prev.tie : 'auto', rows: r.rows };
  P2.apPlan.view = null;
  recalc();
  actAddMsg(prev ? `Replaced the previous survey (${prev.rows.length} stations) with ${r.rows.length}.` : '');
  const extra = [r.skipped ? `${r.skipped} line${r.skipped === 1 ? '' : 's'} skipped` : '', r.dropped ? `${r.dropped} repeated MD dropped` : ''].filter(Boolean).join(', ');
  if (extra) { const m = $('#actMsg'); m.insertAdjacentHTML('beforeend', ` · ${extra}`); }
}
function mergeActual(rows) {
  if (!rows.length) return null;
  const a = state.actual || (state.actual = { src: 'entered by hand', added: new Date().toISOString().slice(0, 10), trueNorth: false, tie: 'auto', rows: [] });
  const key = md => Math.round(md * 100), map = new Map(a.rows.map(r => [key(r.md), r]));
  const lastMd = a.rows.length ? a.rows[a.rows.length - 1].md : -Infinity;
  let added = 0, replaced = 0, inserted = 0;
  rows.forEach(r => { const k = key(r.md); if (map.has(k)) replaced++; else { added++; if (r.md < lastMd) inserted++; } map.set(k, { md: r.md, inc: r.inc, azi: WP.norm360(r.azi) }); });
  a.rows = [...map.values()].sort((x, y) => x.md - y.md);
  recalc();
  const L = a.rows[a.rows.length - 1];
  return `${added} added${replaced ? `, ${replaced} replaced` : ''}${inserted ? `, ${inserted} inserted above the last station` : ''}. Survey now has ${a.rows.length} station${a.rows.length === 1 ? '' : 's'} to MD ${fmt(L.md, 0)}.`;
}
const actAddMsg = t => { $('#actAddMsg').textContent = t; };
function addStationFromFields() {
  const md = parseFloat($('#actMd').value), inc = parseFloat($('#actInc').value), azi = parseFloat($('#actAzi').value);
  if (!isFinite(md) || md < 0 || !isFinite(inc) || inc < 0 || inc > 180 || !isFinite(azi)) { actAddMsg('Enter MD, inclination (0 to 180) and azimuth.'); return; }
  const t = mergeActual([{ md, inc, azi }]); actAddMsg(t);
  ['actMd', 'actInc', 'actAzi'].forEach(id => { $('#' + id).value = ''; }); $('#actMd').focus();
}
$('#bActAdd').onclick = addStationFromFields;
['actMd', 'actInc', 'actAzi'].forEach(id => $('#' + id).addEventListener('keydown', e => { if (e.key === 'Enter') addStationFromFields(); }));
$('#bActAddPaste').onclick = () => {
  const r = WP.parseActualText($('#actAddPaste').value);
  if (!r.rows.length) { actAddMsg('No usable stations found. Each line needs MD, inclination and azimuth.'); return; }
  const t = mergeActual(r.rows); actAddMsg(t + (r.skipped ? ` ${r.skipped} line${r.skipped === 1 ? '' : 's'} skipped.` : '')); $('#actAddPaste').value = '';
};
$('#bActUndo').onclick = () => {
  const a = state.actual; if (!a || !a.rows.length) { actAddMsg('There are no stations to remove.'); return; }
  const g = a.rows.pop(); if (!a.rows.length) state.actual = null; recalc(); actAddMsg(`Removed the station at MD ${fmt(g.md, 0)}.`);
};
$('#bActFile').onclick = () => $('#actFile').click();
$('#actFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { loadActualText(await f.text(), f.name); } catch (x) { actualMsg('Could not read that file: ' + x.message); } };
$('#bActPaste').onclick = () => { $('#actPasteBox').hidden = false; $('#actPaste').focus(); };
$('#bActPasteCancel').onclick = () => { $('#actPasteBox').hidden = true; };
$('#bActUse').onclick = () => { const t = $('#actPaste').value; loadActualText(t, 'pasted survey'); if (state.actual) { $('#actPasteBox').hidden = true; $('#actPaste').value = ''; } };
$('#bActClear').onclick = () => { if (!confirm('Remove the actual survey from this well?')) return; state.actual = null; $('#actMsg').dataset.keep = ''; recalc(); };
$('#actTie').onchange = e => { if (state.actual) { state.actual.tie = e.target.value; recalc(); } };
$('#actTrue').onchange = e => { if (state.actual) { state.actual.trueNorth = e.target.checked; recalc(); } };

$('#geoZone').onchange = e => { state.geoZone = e.target.value || null; autosave(); drawGeo(); };

/* Exports: the station-by-station comparison, and a short text summary for the daily report. */
$('#bActCsv').onclick = () => { if (ACT.rows) download(safeName() + (apiTag() ? '_' + apiTag() : '') + '_actual_vs_plan.csv', WP.actualCsv(ACT.rows, ACT.dev), 'text/csv'); };
$('#bActSum').onclick = () => {
  if (!ACT.rows) return;
  const r = ACT.rows, l = r[r.length - 1], d = ACT.dev[ACT.dev.length - 1], pj = aheadOf(), f = fmt, sg = v => (v >= 0 ? '+' : '-') + f(Math.abs(v), 2);
  const L = [`${state.name}${String(state.api || '').trim() ? '  API ' + String(state.api).trim() : ''}`, `Actual vs plan summary, ${new Date().toISOString().slice(0, 10)}`, '',
    `Last survey: MD ${f(l.md, 0)} ft, inc ${f(l.inc, 2)}, azi ${f(l.azi, 2)}, TVD ${f(l.tvd, 1)} ft, VS ${f(l.vs, 1)} ft`,
    `Distance to plan: ${f(d.dist, 1)} ft (right + / left -: ${f(d.right, 1)} ft; high + / low -: ${f(d.high, 1)} ft)`,
    `Maximum distance to plan: ${f(Math.max(...ACT.dev.map(q => q.dist)), 1)} ft`];
  if (pj) { const e = pj.proj.rows[pj.proj.rows.length - 1];
    L.push('', `Build / turn rate at the last two stations: ${sg(pj.proj.br)} / ${sg(pj.proj.tr)} deg per 100 ft`,
      `Projected to MD ${f(e.md, 0)}: inc ${f(e.inc, 1)}, azi ${f(e.azi, 1)}, TVD ${f(e.tvd, 1)} ft, ${f(pj.dist, 1)} ft from plan`);
    if (!pj.rej.error) L.push(`To rejoin the plan at MD ${f(pj.rejMd, 0)}: ${f(pj.rej.dls, 2)} deg per 100 ft, toolface ${f(pj.rej.tf, 0)} from high side`); }
  const zn = $('#geoZoneStat').textContent; if (state.geoZone && zn) L.push('', `Target zone ${state.geoZone}: ${zn}`);
  download(safeName() + (apiTag() ? '_' + apiTag() : '') + '_actual_summary.txt', L.join('\n') + '\n', 'text/plain');
};
