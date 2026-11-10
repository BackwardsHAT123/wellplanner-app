'use strict';
/* survey uncertainty and offsets (split from index.html; loaded in order, shares globals) */
/* ---- survey uncertainty settings and covariance cache ---- */
const ERR = { tool: 'mwd', sf: 1.5, ell: false };
try { const t = localStorage.getItem('wellplanner.errTool'), s = parseFloat(localStorage.getItem('wellplanner.errSf')); if (t === 'mwd' || t === 'gyro' || t === 'off') ERR.tool = t; if (s > 0) ERR.sf = s; ERR.ell = localStorage.getItem('wellplanner.errEll') === '1'; } catch (e) {}
$('#errTool').value = ERR.tool; $('#errSf').value = ERR.sf; $('#errEll').checked = ERR.ell;
const errSave = () => { if (typeof errSummary === 'function') errSummary(); try { localStorage.setItem('wellplanner.errTool', ERR.tool); localStorage.setItem('wellplanner.errSf', String(ERR.sf)); localStorage.setItem('wellplanner.errEll', ERR.ell ? '1' : '0'); } catch (x) {} };
$('#errTool').onchange = e => { ERR.tool = e.target.value; errSave(); renderOffsetResults(); drawAll(); };
$('#errSf').oninput = e => { const v = parseFloat(e.target.value); if (!(v > 0)) return; ERR.sf = v; errSave(); renderOffsetResults(); };
$('#errEll').onchange = e => { ERR.ell = e.target.checked; errSave(); drawAll(); };
const covCache = new WeakMap();
function covOf(rows) {
  if (ERR.tool === 'off' || !rows || rows.length < 2 || !rows.every(r => isFinite(r.inc) && isFinite(r.azi))) return null;
  let c = covCache.get(rows); if (c && c.tool === ERR.tool) return c.cov;
  const cov = WP.errorModel(rows, WP.ERR_PRESETS[ERR.tool]); covCache.set(rows, { tool: ERR.tool, cov }); return cov;
}
function renderOffsetResults() {
  if (!M.survey) return;
  M.sep = null;
  if (!$('#pane-offsets').classList.contains('on')) return;     // heavy: only when the tab is showing
  const pc = covOf(M.survey);
  M.sep = M.offs.map(o => {
    const os = o.rows.length > 600 ? 3 : 1, oc = pc && covOf(o.rows);       // never skip stations of a sparse survey: chords across 300 ft misjudge distance
    return oc ? WP.separationSF(M.survey, o.rows, pc, oc, 2, os) : WP.separation(M.survey, o.rows, 2, os);
  });
  const useSf = !!pc;
  let h = '<thead><tr><th class="l">Other well</th><th class="l">Kind</th><th>Min distance, all depths (ft)</th><th>Min distance below kickoff (ft)</th>' + (useSf ? '<th>Min separation factor</th>' : '') + '<th>At plan MD</th><th>At other well MD</th><th class="l">Status</th></tr></thead><tbody>';
  M.offs.forEach((o, i) => {
    const sp = M.sep[i];
    let all = sp[0]; sp.forEach(x => { if (x.d < all.d) all = x; });
    const pad = o.kind === 'pad' || o.kind === 'ref', start = pad ? Math.min(M.kopMd, o.kopMd) : -Infinity;
    const reg = pad ? minInRegion(sp, start) : all;
    let sfMin = null; if (useSf && sp[0].sf !== undefined) sp.forEach(x => { if (x.md >= start && (!sfMin || x.sf < sfMin.sf)) sfMin = x; });
    const judged = reg, okD = !judged || judged.d >= state.minSep, okS = !sfMin || sfMin.sf >= ERR.sf, ok = okD && okS, at = judged || all;
    const why = !okD ? 'closer than ' + fmt(state.minSep, 0) + ' ft' : 'separation factor below ' + fmt(ERR.sf, 1);
    h += `<tr><td class="l"><b style="color:${o.color}">●</b> ${esc(o.name)}</td><td class="l">${o.kind === 'pad' ? 'pad well' : o.kind === 'ref' ? 'reference well' : o.kind === 'state' ? 'state record' : 'outside offset'}</td><td>${fmt(all.d, 1)}</td><td>${pad ? (reg ? fmt(reg.d, 1) : '–') : '–'}</td>` +
      (useSf ? `<td>${sfMin ? (isFinite(sfMin.sf) ? fmt(sfMin.sf, 2) : '∞') + ` <span style="color:var(--muted)">at MD ${fmt(sfMin.md, 0)}</span>` : '–'}</td>` : '') +
      `<td>${fmt(at.md, 0)}</td><td>${fmt(at.offMd, 0)}</td>` +
      `<td class="l"><span class="pill ${ok ? 'ok' : 'warn'}">${!judged ? 'no kickoff to compare' : ok ? 'clear' : why}</span></td></tr>`;
  });
  if (!M.offs.length) h += '<tr><td class="l" colspan="8" style="color:var(--muted)">No other wells or offsets.</td></tr>';
  $('#sepTbl').innerHTML = h + '</tbody>';
  renderActualClearance(useSf);
}
/* The drilled path (plus its projection to the bit) against every other well: closest approach, separation factor, status. */
function renderActualClearance(useSf) {
  const box = $('#actSepBox'), pj = aheadOf();
  box.hidden = !pj || !M.offs.length; if (box.hidden) return;
  const rows = ACT.rows.concat(pj.proj.rows), lastMd = ACT.rows[ACT.rows.length - 1].md, pc = useSf && covOf(rows);
  let h = '<thead><tr><th class="l">Other well</th><th>Closest, drilled part (ft)</th><th>Closest, projected part (ft)</th>' + (pc ? '<th>Min separation factor</th>' : '') + '<th>At actual MD</th><th class="l">Status</th></tr></thead><tbody>';
  M.offs.forEach(o => {
    const os = o.rows.length > 600 ? 3 : 1, oc = pc && covOf(o.rows), sp = oc ? WP.separationSF(rows, o.rows, pc, oc, 1, os) : WP.separation(rows, o.rows, 1, os);
    const pad = o.kind === 'pad' || o.kind === 'ref', start = pad ? Math.min(M.kopMd, o.kopMd) : -Infinity, ok0 = x => x.md >= start;
    const pick = (f, key) => { let b = null; sp.forEach(x => { if (f(x) && (!b || x[key] < b[key])) b = x; }); return b; };
    const dr = pick(x => ok0(x) && x.md <= lastMd, 'd'), pr = pick(x => ok0(x) && x.md > lastMd, 'd'), sf = pc && sp[0].sf !== undefined ? pick(ok0, 'sf') : null, worst = pick(ok0, 'd');
    const okD = !worst || worst.d >= state.minSep, okS = !sf || sf.sf >= ERR.sf, ok = okD && okS;
    const why = !okD ? 'closer than ' + fmt(state.minSep, 0) + ' ft' + (worst.md > lastMd ? ' (projected)' : '') : 'separation factor below ' + fmt(ERR.sf, 1) + (sf.md > lastMd ? ' (projected)' : '');
    const cell = x => x ? fmt(x.d, 1) + ` <span style="color:var(--muted)">at MD ${fmt(x.md, 0)}</span>` : '–';
    h += `<tr><td class="l"><b style="color:${o.color}">●</b> ${esc(o.name)}</td><td>${cell(dr)}</td><td>${cell(pr)}</td>` +
      (pc ? `<td>${sf ? (isFinite(sf.sf) ? fmt(sf.sf, 2) : '∞') + ` <span style="color:var(--muted)">at MD ${fmt(sf.md, 0)}</span>` : '–'}</td>` : '') +
      `<td>${worst ? fmt(worst.md, 0) : '–'}</td><td class="l"><span class="pill ${ok ? 'ok' : 'warn'}">${!worst ? 'no kickoff to compare' : ok ? 'clear' : why}</span></td></tr>`;
  });
  $('#actSepTbl').innerHTML = h + '</tbody>';
}

/* ================= drawing ================= */
function setupCanvas(c) {
  const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.max(50, r.width), hgt = Math.max(50, r.height);
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hgt);
  g.font = '11px -apple-system,Segoe UI,system-ui,sans-serif';
  return { g, w, h: hgt };
}
function niceStep(range, target) {
  const raw = Math.max(range, 1e-9) / target, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
/* ================= PLSS sections (BLM) =================
 * Live: BLM National PLSS service, queried for the lateral's bounding box. Offline: tiles in ./sections made by
 * tools/fetch_sections.py (script files, so they also load from file://). */
const SEC = { on: false, cache: new Map(), covered: [], tiles: {}, tileState: {}, grid: new Map(), gridCrs: '', src: '', msg: '', loading: false, nearKey: null, near: [] };
try { SEC.on = localStorage.getItem('wellplanner.sections') === '1'; } catch (e) {}
window.WPSEC = (tx, ty, rows) => { SEC.tiles[tx + '_' + ty] = rows; };
$('#secOn').checked = SEC.on;
$('#secOn').onchange = e => { SEC.on = e.target.checked; try { localStorage.setItem('wellplanner.sections', SEC.on ? '1' : '0'); } catch (x) {} SEC.nearKey = null; if (SEC.on) ensureSections(); updateSecInfo(); drawAll(); };
try { SEC.only = localStorage.getItem('wellplanner.secOnly') === '1'; } catch (e) { SEC.only = false; }
$('#secOnly').checked = SEC.only;
$('#secOnly').onchange = e => { SEC.only = e.target.checked; try { localStorage.setItem('wellplanner.secOnly', SEC.only ? '1' : '0'); } catch (x) {} updateSecInfo(); drawAll(); };
SEC.sb = 330;                                 // typical setback from section lines, ft (recent direction: 100)
try { const v = parseFloat(localStorage.getItem('wellplanner.setback')); if (v >= 0) SEC.sb = v; } catch (e) {}
$('#secSb').value = SEC.sb;
$('#secSb').oninput = e => { const v = parseFloat(e.target.value); if (!(v >= 0)) return; SEC.sb = v; try { localStorage.setItem('wellplanner.setback', String(v)); } catch (x) {} updateSecInfo(); drawAll(); };
const MILE = 5280;
function secLateralPts() {
  if (!M.survey) return [];
  const L = M.markers && M.markers.find(m => m.label === 'Landing'), md0 = L && state.d.type === 'hbh' ? L.row.md : 0;
  const rows = M.survey.filter(r => r.md >= md0), out = [];
  rows.forEach((r, i) => { if (i % 5 === 0 || i === rows.length - 1) out.push({ n: r.northing, e: r.easting }); });
  return out;
}
function secPathPts() {                        // whole wellbore, every 5th station
  if (!M.survey) return [];
  const out = []; M.survey.forEach((r, i) => { if (i % 5 === 0 || i === M.survey.length - 1) out.push({ n: r.northing, e: r.easting }); });
  return out;
}
function secBox(pad) {                       // lon/lat box around the whole wellbore, pad in ft
  const pts = secPathPts(); if (!pts.length || !isLL()) return null;
  let n0 = Infinity, n1 = -Infinity, e0 = Infinity, e1 = -Infinity;
  pts.forEach(p => { n0 = Math.min(n0, p.n); n1 = Math.max(n1, p.n); e0 = Math.min(e0, p.e); e1 = Math.max(e1, p.e); });
  n0 -= pad; n1 += pad; e0 -= pad; e1 += pad;
  const c = [[n0, e0], [n0, e1], [n1, e0], [n1, e1]].map(q => WP.toLatLon(q[0], q[1], state.crs));
  return { w: Math.min(...c.map(q => q.lon)), e: Math.max(...c.map(q => q.lon)), s: Math.min(...c.map(q => q.lat)), n: Math.max(...c.map(q => q.lat)) };
}
const secKey = r => r.id + '|' + r.sec + '|' + (r.dup || '0');
async function liveSections(b) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const q = new URLSearchParams({ geometry: [b.w, b.s, b.e, b.n].join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects',
      outFields: 'PLSSID,FRSTDIVNO,FRSTDIVDUP', where: "FRSTDIVTYP='SN'", resultRecordCount: '2000', f: 'geojson' });
    const res = await fetch('https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/2/query?' + q, { signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json(); if (!Array.isArray(d.features)) throw new Error('bad reply');
    return d.features.filter(f => f.geometry).map(f => {
      const g = f.geometry, ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates.map(p => p[0]).sort((a, b) => b.length - a.length)[0];
      return { id: f.properties.PLSSID, sec: String(f.properties.FRSTDIVNO), dup: String(f.properties.FRSTDIVDUP || '0'), ll: ring.flatMap(p => [p[0], p[1]]) };
    });
  } finally { clearTimeout(timer); }
}
function loadTile(tx, ty) {
  const key = tx + '_' + ty;
  if (SEC.tileState[key]) return SEC.tileState[key];
  return SEC.tileState[key] = new Promise(res => {
    const s = document.createElement('script'); s.src = 'sections/s_' + key + '.js';
    s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s);
  });
}
async function tileSections(b) {
  const jobs = [];
  for (let x = Math.floor(b.w); x <= Math.floor(b.e); x++) for (let y = Math.floor(b.s); y <= Math.floor(b.n); y++) jobs.push(loadTile(x, y).then(ok => ok ? SEC.tiles[x + '_' + y] : null));
  const got = (await Promise.all(jobs)).filter(Boolean);
  if (!got.length) throw new Error('no tiles');
  return got.flat().map(r => ({ id: r[0], sec: String(r[1]), dup: '0', ll: r[2] }));
}
async function ensureSections() {
  if (!(SEC.on || STO.on || WALL.on || ACT.rows) || !M.survey || SEC.loading) return;
  if (!isLL()) { SEC.msg = 'needs a State Plane zone (a local grid has no lat/long)'; updateSecInfo(); return; }
  const need = secBox(MILE * 1.2); if (!need) return;
  if (SEC.covered.some(c => need.w >= c.w && need.e <= c.e && need.s >= c.s && need.n <= c.n)) { updateSecInfo(); return; }
  const want = { w: need.w - .06, e: need.e + .06, s: need.s - .05, n: need.n + .05 };
  SEC.loading = true; SEC.msg = 'loading…'; updateSecInfo();
  let rows = null, src = '';
  try { rows = await liveSections(want); src = 'live from BLM'; } catch (e) { rows = null; }
  if (!rows) { try { rows = await tileSections(want); src = 'offline files'; } catch (e) { rows = null; } }
  SEC.loading = false;
  if (rows) { rows.forEach(r => { r.bb = [Math.min(...r.ll.filter((_, i) => i % 2 === 0)), Math.max(...r.ll.filter((_, i) => i % 2 === 0)), Math.min(...r.ll.filter((_, i) => i % 2)), Math.max(...r.ll.filter((_, i) => i % 2))]; SEC.cache.set(secKey(r), r); }); SEC.covered.push(want); SEC.src = src; SEC.msg = ''; SEC.nearKey = null; }
  else SEC.msg = 'no section data: the BLM service is unreachable and there are no offline files for this area';
  drawAll(); updateSecInfo();
  if (STO.on) { STO.key = ''; recalc(); }
}
function secNear() {                          // sections within 1 mile of the lateral, in grid coordinates
  const key = M.survey && (M.survey.length + '|' + M.survey[M.survey.length - 1].northing + '|' + state.crs + '|' + SEC.cache.size + '|' + state.d.type);
  if (SEC.nearKey === key) return SEC.near;
  SEC.nearKey = key; SEC.near = [];
  const box = secBox(MILE * 1.2), pts = secLateralPts(); if (!box || !pts.length) return SEC.near;
  if (SEC.gridCrs !== state.crs) { SEC.gridCrs = state.crs; SEC.grid = new Map(); }
  const cand = [];
  SEC.cache.forEach((s, k) => {
    if (s.bb[1] < box.w || s.bb[0] > box.e || s.bb[3] < box.s || s.bb[2] > box.n) return;
    let ring = SEC.grid.get(k);
    if (!ring) { ring = []; for (let i = 0; i + 1 < s.ll.length; i += 2) { const q = WP.toGrid(s.ll[i + 1], s.ll[i], state.crs); ring.push({ n: q.n, e: q.e }); } SEC.grid.set(k, ring); }
    cand.push({ s, ring });
  });
  const rings = cand.map(c => c.ring), near = {}, fp = WP.pathFootage(rings, M.survey);
  WP.sectionsNear(rings, pts, MILE).forEach(h => { near[h.i] = h; });
  // every section within 1 mile of the lateral, plus any the wellbore passes through (e.g. the SHL section, a back-build section)
  SEC.near = cand.map((c, i) => ({ ...c, d: near[i] ? near[i].d : null, foot: fp.foot[i], spans: fp.spans[i], crossed: fp.foot[i] > 0 })).filter(x => x.d !== null || x.foot > 0);
  return SEC.near;
}
const secShown = () => SEC.only ? secNear().filter(x => x.foot > 0) : secNear();
function updateSecInfo() {
  const stat = $('#secStat'), info = $('#secInfo'); if (!stat) return;
  if (!SEC.on) { stat.textContent = ''; info.innerHTML = ''; return; }
  stat.textContent = SEC.msg ? '· ' + SEC.msg : SEC.src ? '· ' + SEC.src : '';
  if (SEC.sb > 0) stat.textContent += ' · setback = ' + SEC.sb + ' ft from each section line';
  const nr = secNear(), nm = x => WP.plssName(x.s.id, x.s.sec), f0 = n => fmt(n, 0);
  if (!nr.length || !M.survey) { info.innerHTML = ''; return; }
  const cr = nr.filter(x => x.foot > 0).sort((a, b) => a.spans[0][0] - b.spans[0][0]);
  const rows = M.survey, p0 = { n: rows[0].northing, e: rows[0].easting }, shl = nr.find(x => WP.ptInRing(p0, x.ring));
  const L = M.markers && M.markers.find(m => m.label === 'Landing'), landMd = L && state.d.type === 'hbh' ? L.row.md : null;
  let h = `<b>Wellbore passes through (MD ft):</b> ${cr.length ? cr.map(x => `${nm(x)} <b>${f0(x.foot)}</b>${x === shl ? ' (SHL section)' : ''}`).join(' · ') : 'none of the loaded sections'}`;
  if (shl) {
    // MD before landing (or whole well if no landing) that lies outside the SHL section
    const end = landMd === null ? rows[rows.length - 1].md : landMd, outside = [];
    let cur = 0; shl.spans.slice().sort((a, b) => a[0] - b[0]).forEach(([a, b]) => { if (a > cur && cur < end) outside.push([cur, Math.min(a, end)]); cur = Math.max(cur, b); });
    if (cur < end) outside.push([cur, end]);
    const tot = outside.reduce((a, [s, e]) => a + (e - s), 0), at = md => rows.reduce((b, r) => Math.abs(r.md - md) < Math.abs(b.md - md) ? r : b, rows[0]);
    let far = 0; rows.forEach(r => { if (r.md <= end && !WP.ptInRing({ n: r.northing, e: r.easting }, shl.ring)) far = Math.max(far, WP.ptRingDist({ n: r.northing, e: r.easting }, shl.ring).d); });
    const label = landMd === null ? 'Whole wellbore' : 'Before landing';
    h += tot > 5 ? `<br><b>${label}: ${f0(tot)} ft of wellbore is outside the SHL section</b>` + outside.filter(([s, e]) => e - s > 5).map(([s, e]) => ` · MD ${f0(s)}–${f0(e)} (TVD ${f0(at(s).tvd)}–${f0(at(e).tvd)})`).join('') + `, reaching ${f0(far)} ft beyond its boundary.`
      : `<br>${label}: the wellbore stays inside the SHL section.`;
    h += `<br><span style="color:var(--muted)">Footage is measured along the wellbore and is good to about 10 ft at each section line.</span>`;
  } else h += `<br><span style="color:var(--muted)">The SHL is not inside a loaded section, so it can’t be compared with the section lines.</span>`;
  if (!SEC.only) { const ot = nr.filter(x => !(x.foot > 0)); h += `<br><span style="color:var(--muted)">Also within 1 mile of the lateral: ${ot.length ? ot.map(nm).join(', ') : 'none'}</span>`; }
  info.innerHTML = h;
}
/* The section the bit is in now (the last actual station) for the Plan vs actual map. If that spot has no section loaded, the
 * most recent station that is inside a loaded section decides, so the section it left is still shown. */
function curSections() {
  if (!ACT.rows) return [];
  const near = secNear();
  for (let i = ACT.rows.length - 1; i >= 0; i--) {
    const p = { n: ACT.rows[i].northing, e: ACT.rows[i].easting }, hit = near.find(x => WP.ptInRing(p, x.ring));
    if (hit) return [hit];
  }
  return [];
}
function drawSections(g, X, Y, v, ink, acc, muted, only) {
  if (!SEC.on && !only) return;
  const sx = state.surface.e, sn = state.surface.n;
  const list = only || secShown();
  list.forEach(x => {
    g.beginPath(); x.ring.forEach((q, k) => k ? g.lineTo(X(q.e - sx), Y(q.n - sn)) : g.moveTo(X(q.e - sx), Y(q.n - sn))); g.closePath();
    g.globalAlpha = x.crossed ? .14 : .05; g.fillStyle = acc; g.fill();
    g.globalAlpha = x.crossed ? .9 : .5; g.strokeStyle = x.crossed ? acc : muted; g.lineWidth = x.crossed ? 1.6 : 1.1; g.stroke(); g.globalAlpha = 1;
  });
  if (SEC.sb > 0) {                            // setback lines: dashed, inside each section boundary
    g.save(); g.setLineDash([6, 4]); g.strokeStyle = css('--warn'); g.lineWidth = 1.3; g.globalAlpha = .9;
    list.forEach(x => {
      const r = x.inset && x.insetD === SEC.sb ? x.inset : (x.insetD = SEC.sb, x.inset = WP.insetRing(x.ring, SEC.sb));
      g.beginPath(); r.forEach((q, k) => k ? g.lineTo(X(q.e - sx), Y(q.n - sn)) : g.moveTo(X(q.e - sx), Y(q.n - sn))); g.closePath(); g.stroke();
    });
    g.restore();
  }
  g.textAlign = 'center'; const f0 = g.font;
  list.forEach(x => {
    const cn = x.ring.reduce((a, q) => a + q.n, 0) / x.ring.length, ce = x.ring.reduce((a, q) => a + q.e, 0) / x.ring.length;
    const size = v.s * MILE; if (size < 40) return;
    const nm = WP.plssName(x.s.id, x.s.sec), parts = nm.split(' '), cx = X(ce - sx), cy = Y(cn - sn);
    g.fillStyle = x.crossed ? ink : muted; g.globalAlpha = .85;
    g.font = 'bold 13px system-ui, sans-serif'; g.fillText(parts[0], cx, size < 90 ? cy + 4 : cy - 1);
    if (size >= 90) { g.font = '11px system-ui, sans-serif'; g.fillText(parts.slice(1).join(' '), cx, cy + 13); }
    g.globalAlpha = 1;
  });
  g.font = f0;
}
/* ================= Reference wells (copies of wells made in this tool) =================
 * project.refs holds frozen copies of wells from other saved plans. Each one is rebuilt with its own design, then moved
 * into this project's coordinate system (through lat/long, with the grid-convergence difference applied to azimuths). */
const refCache = new WeakMap();
function refModel(r) {
  const sig = JSON.stringify(r) + '|' + state.crs, c = refCache.get(r);
  if (c && c.sig === sig) return c.m;
  let m = null;
  const mm = modelFor(r);
  if (!mm.err) {
    if (r.crs === state.crs) m = { rows: mm.survey, kopMd: mm.kopMd };
    else if (r.crs !== 'local' && state.crs !== 'local') {
      const ll = WP.toLatLon(r.surface.n, r.surface.e, r.crs), g1 = WP.convergence(ll.lat, ll.lon, r.crs), g2 = WP.convergence(ll.lat, ll.lon, state.crs), p = WP.toGrid(ll.lat, ll.lon, state.crs);
      const st = mm.survey.map(x => ({ md: x.md, inc: x.inc, azi: WP.norm360(x.azi + g1 - g2) }));
      m = { rows: WP.computeSurvey(st, { n0: p.n, e0: p.e, kb: r.kb, vsAzi: 0 }), kopMd: mm.kopMd };
    }
  }
  refCache.set(r, { sig, m }); return m;
}
const REF = { pending: null };
function setRefOpen(open, save) {
  $('#refBody').hidden = !open; $('#refArrow').textContent = open ? '▾' : '▸'; $('#refHead').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (save) { try { localStorage.setItem('wellplanner.refOpen', open ? '1' : '0'); } catch (e) {} }
}
$('#refHead').onclick = () => setRefOpen($('#refBody').hidden, true);
$('#refHead').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRefOpen($('#refBody').hidden, true); } };
{ let o = true; try { o = localStorage.getItem('wellplanner.refOpen') !== '0'; } catch (e) {} setRefOpen(o, false); }
function renderRef() {
  const el = $('#refList'); if (!el) return;
  const others = project.wells.map((w, i) => ({ w, i })).filter(x => x.w !== state);
  { const on = others.filter(x => x.w.asOffset !== false).length + (project.refs || []).filter(r => r.asOffset !== false).length, n = others.length + (project.refs || []).length;
    $('#refCount').textContent = n ? `${on} of ${n} in use` : 'none'; }
  let h = '';
  if (others.length) h += '<div class="hint" style="margin:0 0 4px">This project</div>' + others.map(x =>
    `<label class="chk refrow"><input type="checkbox" data-asoff="w${x.i}" ${x.w.asOffset === false ? '' : 'checked'}><span><b>${esc(x.w.name || 'Unnamed')}</b>${x.w.slot ? ' · slot ' + slotId(x.w.slot.c, x.w.slot.r) : ''}</span></label>`).join('');
  const refs = project.refs || [];
  h += '<div class="hint" style="margin:6px 0 4px">Reference copies' + (refs.length ? '' : ': none yet') + '</div>' + refs.map((r, i) => {
    const ok = !!refModel(r), why = r.crs === state.crs ? 'could not build this well' : 'coordinate system differs and one of them is a local grid';
    return `<div class="refrow"><label class="chk"><input type="checkbox" data-asoff="r${i}" ${r.asOffset === false ? '' : 'checked'}><span><b>${esc(r.name || 'Unnamed')}</b> <span style="color:var(--muted)">from ${esc(r.refSrc || 'a saved plan')}${r.refAdded ? ', added ' + esc(r.refAdded) : ''}</span>${ok ? '' : ` <span style="color:var(--warn)">not shown: ${why}</span>`}</span></label><button class="small" data-refdel="${i}" title="Remove this reference copy">Remove</button></div>`;
  }).join('');
  el.innerHTML = h;
  const pk = $('#refPick');
  if (!REF.pending) { pk.innerHTML = ''; return; }
  pk.innerHTML = `<div class="hint" style="margin:8px 0 4px">Wells in ${esc(REF.pending.src)}: choose the ones to add</div>` + REF.pending.wells.map((w, i) =>
    `<label class="chk refrow"><input type="checkbox" data-pick="${i}" checked><span><b>${esc(w.name || 'Unnamed')}</b> <span style="color:var(--muted)">${esc(w.crs)} · ${w.targets.length} targets</span></span></label>`).join('') +
    '<div class="toolbar" style="margin-top:6px"><button class="small primary" id="bRefGo">Add selected</button><button class="small" id="bRefCancel">Cancel</button></div>';
}
$('#bRefAdd').onclick = () => $('#refFile').click();
$('#refFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const p = migrateProject(JSON.parse(rd.result)); if (!p || !p.wells.length) throw new Error('no wells found');
      REF.pending = { src: f.name, wells: p.wells }; renderRef();
    } catch (err) { REF.pending = null; renderRef(); $('#refPick').innerHTML = `<span style="color:var(--warn)">That file is not a saved well plan: ${esc(err.message)}</span>`; }
  };
  rd.readAsText(f); e.target.value = '';
};
$('#refCard').addEventListener('click', e => {
  const d = e.target.closest('[data-refdel]');
  if (d) { const r = project.refs[+d.dataset.refdel]; if (r && confirm('Remove the reference copy of "' + r.name + '"?')) { project.refs.splice(+d.dataset.refdel, 1); recalc(); } return; }
  if (e.target.closest('#bRefCancel')) { REF.pending = null; renderRef(); return; }
  if (e.target.closest('#bRefGo')) {
    const picks = $$('#refPick [data-pick]').filter(c => c.checked).map(c => REF.pending.wells[+c.dataset.pick]);
    const today = new Date().toISOString().slice(0, 10), norm = s => String(s || '').trim().toLowerCase();
    picks.forEach(w => {
      const copy = Object.assign(JSON.parse(JSON.stringify(w)), { slot: null, asOffset: true, refSrc: REF.pending.src, refAdded: today });
      const k = project.refs.findIndex(r => norm(r.name) === norm(copy.name));
      if (k >= 0) project.refs[k] = copy; else project.refs.push(copy);
    });
    REF.pending = null; recalc();
  }
});
$('#refCard').addEventListener('change', e => {
  const c = e.target.closest('[data-asoff]'); if (!c) return;
  const kind = c.dataset.asoff[0], i = +c.dataset.asoff.slice(1), w = kind === 'w' ? project.wells[i] : project.refs[i];
  if (w) { w.asOffset = c.checked; recalc(); }
});

/* ================= Drilled wells from state records =================
 * Data: offsets/prb.js (tools/build_offsets.py: WOGCC headers, KB elevations, filed directional surveys for the PRB
 * project's horizontal wells). A well is included when its surface, bottom hole or surveyed path lies inside a section
 * the wellbore passes through. Only wells with a filed survey get a path; the rest are listed. */
const STO = { on: false, tn: true, data: null, state: 'idle', list: [], key: '', rows: new Map(), skip: new Set(), msg: '' };
window.WPOFF = d => { STO.data = d; };
try { STO.on = localStorage.getItem('wellplanner.sto') === '1'; STO.tn = localStorage.getItem('wellplanner.stoTrue') !== '0'; } catch (e) {}
$('#stoOn').checked = STO.on; $('#stoTrue').checked = STO.tn;
$('#stoOn').onchange = e => {
  STO.on = e.target.checked; try { localStorage.setItem('wellplanner.sto', STO.on ? '1' : '0'); } catch (x) {} STO.key = '';
  if (STO.on && !STO.data && STO.state === 'missing') $('#stoFile').click();            // the data file is not beside the page and not saved in this browser: ask for it (once)
  recalc();
};
const stoPickLink = '<button class="small" data-stopick>Choose the state wells file…</button>';
document.addEventListener('click', e => { if (e.target.closest('[data-stopick]')) $('#stoFile').click(); });
$('#stoTrue').onchange = e => { STO.tn = e.target.checked; try { localStorage.setItem('wellplanner.stoTrue', STO.tn ? '1' : '0'); } catch (x) {} STO.key = ''; recalc(); };
/* The state-wells file (offsets/prb.js) is not on the public page. It is read from the private copy once with "Load state wells file…"
 * and kept in this browser (IndexedDB), so the public page never serves it. */
const idb = (mode, fn) => new Promise((res, rej) => { const q = indexedDB.open('wellplanner', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onerror = () => rej(q.error); q.onsuccess = () => { const t = q.result.transaction('kv', mode), r = fn(t.objectStore('kv')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }; });
function useStoText(text) { STO.data = null; (0, eval)(text); if (!STO.data || !STO.data.wells) throw new Error('not a state wells file'); STO.state = 'ready'; STO.msg = ''; STO.key = ''; STO.rows.clear(); { const m = $('#stoFileMsg'); if (m) m.textContent = ''; } }
function loadStoData() {
  if (STO.data || STO.state === 'loading') return;
  STO.state = 'loading';
  const s = document.createElement('script'); s.src = 'offsets/prb.js';
  s.onload = () => { STO.state = STO.data ? 'ready' : 'missing'; STO.key = ''; recalc(); };
  s.onerror = () => {
    idb('readonly', st => st.get('stoText')).then(t => { if (!t) throw 0; useStoText(t); recalc(); })
      .catch(() => { STO.state = 'missing'; STO.msg = 'No state wells file here. Pick offsets/prb.js from the private wellplanner folder once; it is then kept in this browser.'; $('#stoFileMsg').innerHTML = esc(STO.msg) + ' ' + stoPickLink; renderSto(); });
  };
  document.head.appendChild(s);
}
$('#stoFile').onchange = e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try { useStoText(rd.result); } catch (x) { $('#stoFileMsg').textContent = 'That file is not a state wells file.'; return; }
    idb('readwrite', st => st.put(rd.result, 'stoText')).then(() => { $('#stoFileMsg').textContent = 'Loaded ' + STO.data.wells.length.toLocaleString() + ' wells; kept in this browser.'; }).catch(() => { $('#stoFileMsg').textContent = 'Loaded for now; this browser would not keep it.'; });
    if (!STO.on) { STO.on = true; $('#stoOn').checked = true; try { localStorage.setItem('wellplanner.sto', '1'); } catch (x) {} }
    recalc();
  };
  rd.readAsText(f);
};
function stoPath(w) {                          // survey rows in project grid, or null when no filed survey
  if (!w.st) return null;
  const ck = w.api + '|' + state.crs + '|' + STO.tn; if (STO.rows.has(ck)) return STO.rows.get(ck);
  const p = WP.toGrid(w.shl[0], w.shl[1], state.crs), g = STO.tn ? WP.convergence(w.shl[0], w.shl[1], state.crs) : 0;
  const st = w.st.map(r => ({ md: r[0], inc: r[1], azi: WP.norm360(r[2] - g) }));
  if (st[0].md > 0) st.unshift({ md: 0, inc: 0, azi: 0 });
  const kb = w.kb != null ? w.kb : (w.gl != null ? w.gl + 20 : 0);
  const out = { rows: WP.computeSurvey(st, { n0: p.n, e0: p.e, kb, vsAzi: 0 }), kbAssumed: w.kb == null };
  STO.rows.set(ck, out); return out;
}
function stoRefresh() {
  if (!STO.on || !isLL() || !M.survey) { STO.list = []; STO.key = ''; return; }
  if (!STO.data) { loadStoData(); STO.list = []; return; }
  const trav = secNear().filter(x => x.foot > 0), last = M.survey[M.survey.length - 1];
  const key = [M.survey.length, Math.round(last.northing), Math.round(last.easting), state.crs, STO.tn, SEC.cache.size, trav.length, state.name].join('|');
  if (key === STO.key) return; STO.key = key;
  const box = secBox(MILE * 1.5);
  if (!box || !trav.length) { STO.list = []; return; }
  const rings = trav.map(x => x.ring), inAny = p => { for (let i = 0; i < rings.length; i++) if (WP.ptInRing(p, rings[i])) return i; return -1; };
  const hit = (la, lo) => la >= box.s && la <= box.n && lo >= box.w && lo <= box.e;
  const out = [];
  const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), me = norm(state.name);
  STO.data.wells.forEach(w => {
    if (me && norm(w.name) === me) return;                       // the well being planned may already have a state record
    if (!hit(w.shl[0], w.shl[1]) && !(w.bhl && hit(w.bhl[0], w.bhl[1]))) return;
    const secs = new Set(), pt = (la, lo) => { const q = WP.toGrid(la, lo, state.crs), i = inAny({ n: q.n, e: q.e }); if (i >= 0) secs.add(i); };
    const path = stoPath(w);
    if (path) path.rows.forEach((r, i) => { if (i % 4 === 0 || i === path.rows.length - 1) { const k = inAny({ n: r.northing, e: r.easting }); if (k >= 0) secs.add(k); } });
    else { pt(w.shl[0], w.shl[1]); if (w.bhl) pt(w.bhl[0], w.bhl[1]); }
    if (!secs.size) return;
    out.push({ w, path, secs: [...secs].map(i => WP.plssName(trav[i].s.id, trav[i].s.sec)) });
  });
  out.sort((a, b) => (!!b.path - !!a.path) || String(a.w.name).localeCompare(String(b.w.name)));
  STO.list = out;
}
function stoOffs() {
  const out = []; let k = 0;
  STO.list.forEach(x => { if (!x.path || STO.skip.has(x.w.api)) return; out.push({ name: x.w.name, rows: x.path.rows, kind: 'state', color: OFF_COLORS[k++ % OFF_COLORS.length], kopMd: 0, api: x.w.api }); });
  return out;
}
/* The state records card starts folded and has its own row. */
function setStoOpen(open, save) {
  $('#stoBody').hidden = !open; $('#stoArrow').textContent = open ? '▾' : '▸'; $('#stoHead').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (save) { try { localStorage.setItem('wellplanner.stoOpen', open ? '1' : '0'); } catch (e) {} }
}
$('#stoHead').onclick = () => setStoOpen($('#stoBody').hidden, true);
$('#stoHead').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStoOpen($('#stoBody').hidden, true); } };
{ let o = false; try { o = localStorage.getItem('wellplanner.stoOpen') === '1'; } catch (e) {} setStoOpen(o, false); }
/* The survey uncertainty card shares a row with the offsets card, folded or not (both stay half width). */
function setErrOpen(open, save) {
  $('#errBody').hidden = !open; $('#errArrow').textContent = open ? '▾' : '▸'; $('#errHead').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (save) { try { localStorage.setItem('wellplanner.errOpen', open ? '1' : '0'); } catch (e) {} }
}
$('#errHead').onclick = () => setErrOpen($('#errBody').hidden, true);
$('#errHead').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setErrOpen($('#errBody').hidden, true); } };
{ let o = true; try { o = localStorage.getItem('wellplanner.errOpen') !== '0'; } catch (e) {} setErrOpen(o, false); }
const errSummary = () => { $('#errSum').textContent = ERR.tool === 'off' ? 'off' : (ERR.tool === 'gyro' ? 'Gyro' : 'MWD') + ', alert below SF ' + ERR.sf; };
errSummary();
function renderSto() {
  const el = $('#stoInfo'); if (!el) return;
  { const c = $('#stoCount'); const l = STO.on && STO.list ? STO.list : null; c.textContent = !STO.on ? 'off' : l ? `${l.length} well${l.length === 1 ? '' : 's'}, ${l.filter(x => x.path).length} with surveys` : 'loading…'; }
  const oh = $('#stoOffHint'); if (oh) oh.style.display = STO.on ? 'none' : '';
  if (!STO.on) { el.innerHTML = ''; return; }
  if (!isLL()) { el.innerHTML = 'Needs a State Plane zone: a local grid has no lat/long to match against the state records.'; return; }
  if (STO.msg && STO.state === 'missing') { el.innerHTML = `<span style="color:var(--warn)">${esc(STO.msg)}</span> ${stoPickLink}`; return; }
  if (!STO.data) { el.textContent = 'Loading state well records…'; return; }
  if (SEC.loading || !SEC.cache.size) { el.textContent = 'Waiting for section data…'; return; }
  const withSurvey = STO.list.filter(x => x.path), none = STO.list.filter(x => !x.path);
  let h = `<span style="color:var(--muted)">Records built ${esc(STO.data.built || '?')} · ${STO.data.wells.length.toLocaleString()} wells · ${STO.data.wells.filter(w => w.st).length.toLocaleString()} with filed surveys. Horizontal wells of the PRB project only: vertical and older wells are not in this file.</span>`;
  if (!STO.list.length) { el.innerHTML = h + '<br>No wells from the records lie in the sections this wellbore passes through.'; return; }
  h += `<br><b>${withSurvey.length}</b> with a filed survey (used for clearance) · <b>${none.length}</b> without (listed only).<table><thead><tr><th></th><th>Well</th><th>Operator</th><th>Status</th><th>Section</th><th>Survey</th></tr></thead><tbody>`;
  STO.list.forEach(x => {
    const w = x.w, off = STO.skip.has(w.api);
    h += `<tr class="${x.path ? '' : 'none'}"><td>${x.path ? `<input type="checkbox" data-sto="${esc(w.api)}" ${off ? '' : 'checked'}>` : ''}</td><td>${esc(w.name)}</td><td>${esc((w.op || '').replace(/ (LLC|INC|LP|CORP.*|COMPANY)$/i, ''))}</td><td>${esc(w.status || '')}</td><td>${esc(x.secs.join(', '))}</td>` +
      `<td>${x.path ? w.st.length + ' stations' + (x.path.kbAssumed ? ' · KB assumed GL+20' : '') : 'none on file'}</td></tr>`;
  });
  el.innerHTML = h + '</tbody></table>';
}
$('#stoInfo').addEventListener('change', e => {
  const c = e.target.closest('[data-sto]'); if (!c) return;
  if (c.checked) STO.skip.delete(c.dataset.sto); else STO.skip.add(c.dataset.sto);
  recalc();
});
const planPoint = r => ({ x: r.easting - state.surface.e, y: r.northing - state.surface.n });
function offPlanTvd(r) { return r.tvdss + state.kb; }

const P2 = {
  plan: { id: 'cvPlan', ydown: false, view: null, mouse: null, xl: 'East of surface (ft)', yl: 'North of surface (ft)' },
  sec: { id: 'cvSec', ydown: true, view: null, mouse: null, xl: 'Vertical section (ft)', yl: 'TVD (ft)' },
  apPlan: { id: 'cvApPlan', base: 'plan', ydown: false, view: null, mouse: null, xl: 'East of surface (ft)', yl: 'North of surface (ft)' }
};
function pts2D(kind) {
  const sv = M.survey, a = Math.cos(M.vsAzi * D2R), b = Math.sin(M.vsAzi * D2R);
  const map = kind === 'plan'
    ? { row: r => ({ x: r.easting - state.surface.e, y: r.northing - state.surface.n }), off: r => ({ x: r.easting - state.surface.e, y: r.northing - state.surface.n }) }
    : { row: r => ({ x: r.vs, y: r.tvd }), off: r => ({ x: (r.northing - state.surface.n) * a + (r.easting - state.surface.e) * b, y: offPlanTvd(r) }) };
  const tg = t => kind === 'plan' ? { x: t.e - state.surface.e, y: t.n - state.surface.n }
    : { x: (t.n - state.surface.n) * a + (t.e - state.surface.e) * b, y: t.tvd };
  return { map, tg };
}
const NAMES = { on: true };
try { NAMES.on = localStorage.getItem('wellplanner.names') !== '0'; } catch (e) {}
$('#namesOn').checked = NAMES.on;
$('#namesOn').onchange = e => { NAMES.on = e.target.checked; try { localStorage.setItem('wellplanner.names', NAMES.on ? '1' : '0'); } catch (x) {} drawAll(); };
function draw2D(key) {
  const p = P2[key], kind = p.base || key, AP = !!p.base, c = $('#' + p.id);
  if (!c.offsetParent || !M.survey) return;
  const { g, w, h } = setupCanvas(c);
  const ink = css('--ink'), muted = css('--muted'), grid = css('--grid'), acc = css('--accent'), warn = css('--warn');
  const m = { l: 58, r: 14, t: 12, b: 34 }, iw = w - m.l - m.r, ih = h - m.t - m.b;
  const { map, tg } = pts2D(kind);
  const sy = p.ydown ? 1 : -1;

  const pl = M.survey.map(map.row);
  const offs = AP ? [] : M.offs.map(o => o.rows.map(map.off));
  const act = AP && ACT.rows ? ACT.rows.map(map.off) : null;
  const ut = usedTargets(), tgs = ut.map(tg);
  const all = [...pl, ...offs.flat(), ...(act || []), ...tgs];
  if (kind === 'sec') all.push({ x: 0, y: 0 });
  if (kind === 'plan' && (SEC.on || AP)) (AP ? curSections() : secShown()).forEach(s => s.ring.forEach(q => all.push({ x: q.e - state.surface.e, y: q.n - state.surface.n })));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  all.forEach(q => { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); });
  const fit = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s: Math.min(iw / Math.max(x1 - x0, 50) , ih / Math.max(y1 - y0, 50)) * 0.88 };
  p.lastView = fit;
  const v = p.view || fit;
  const X = x => m.l + iw / 2 + (x - v.cx) * v.s, Y = y => m.t + ih / 2 + sy * (y - v.cy) * v.s;
  p.geo = { m, iw, ih, sy, v };

  g.save(); g.beginPath(); g.rect(m.l, m.t, iw, ih); g.clip();
  // grid
  const step = niceStep(Math.min(iw, ih) / v.s, 5);
  const gx0 = Math.ceil((v.cx - iw / 2 / v.s) / step) * step, gx1 = v.cx + iw / 2 / v.s;
  const ya = v.cy - ih / 2 / v.s, yb = v.cy + ih / 2 / v.s, gy0 = Math.ceil(ya / step) * step;
  g.strokeStyle = grid; g.lineWidth = 1; g.beginPath();
  for (let x = gx0; x <= gx1; x += step) { g.moveTo(Math.round(X(x)) + .5, m.t); g.lineTo(Math.round(X(x)) + .5, m.t + ih); }
  for (let y = gy0; y <= yb; y += step) { g.moveTo(m.l, Math.round(Y(y)) + .5); g.lineTo(m.l + iw, Math.round(Y(y)) + .5); }
  g.stroke();

  if (kind === 'plan') drawSections(g, X, Y, v, ink, acc, muted, AP ? curSections() : null);
  // tops (section only)
  if (kind === 'sec') {
    g.setLineDash([5, 4]); g.lineWidth = 1; g.fillStyle = muted; g.textAlign = 'left';
    topsEff().forEach(t => {
      g.strokeStyle = muted; g.beginPath();
      if (parseFloat(t.dip)) {      // a dipping surface: its depth under each point of the wellbore, so it crosses the path where the top really is
        M.survey.forEach((r, i) => { const px = X(r.vs), py = Y(WP.topTvdAt(t, r.northing, r.easting, state.surface)); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
        g.stroke(); const r0 = M.survey[0]; g.fillText(`${t.name} ${fmt(t.tvd, 0)} · dip ${fmt(t.dip, 1)}° → ${fmt(t.azi || 0, 0)}°`, m.l + 6, Y(WP.topTvdAt(t, r0.northing, r0.easting, state.surface)) - 3);
      } else { const y = Y(t.tvd); g.moveTo(m.l, y); g.lineTo(m.l + iw, y); g.stroke(); g.fillText(`${t.name} ${fmt(t.tvd, 0)}`, m.l + 6, y - 3); }
    });
    g.setLineDash([]);
    g.strokeStyle = ink; g.globalAlpha = .5; g.beginPath(); g.moveTo(m.l, Y(0)); g.lineTo(m.l + iw, Y(0)); g.stroke(); g.globalAlpha = 1;
  }
  // offsets
  if (kind === 'plan' && !AP && (project.pad.cols * project.pad.rows > 1 || project.wells.some(w => w.slot))) {   // pad slots
    WP.padSlots(project.pad, project.pad.cols, project.pad.rows, state.crs).forEach(sl => {
      const x = X(sl.e - state.surface.e), y = Y(sl.n - state.surface.n);
      g.strokeStyle = muted; g.lineWidth = 1; g.strokeRect(x - 3.5, y - 3.5, 7, 7);
      if (v.s * Math.min(project.pad.dx, project.pad.dy || project.pad.dx) > 38) { g.fillStyle = muted; g.textAlign = 'center'; g.fillText(sl.id, x, y - 8); }
    });
  }
  offs.forEach((o, i) => {
    g.strokeStyle = M.offs[i].color; g.lineWidth = 1.6; g.beginPath();
    o.forEach((q, k) => k ? g.lineTo(X(q.x), Y(q.y)) : g.moveTo(X(q.x), Y(q.y))); g.stroke();
  });
  // plan path
  g.strokeStyle = acc; g.lineWidth = 2.4; g.lineJoin = 'round'; g.beginPath();
  pl.forEach((q, k) => k ? g.lineTo(X(q.x), Y(q.y)) : g.moveTo(X(q.x), Y(q.y))); g.stroke();
  // survey error ellipses (horizontal slice of the position covariance), plan view only
  if (kind === 'plan' && ERR.ell && !AP) {
    const cov = covOf(M.survey);
    if (cov) {
      g.strokeStyle = acc; g.lineWidth = 1; g.globalAlpha = .75;
      let nextMd = 1000; const idx = [];
      M.survey.forEach((r, k) => { if (r.md >= nextMd || k === M.survey.length - 1) { idx.push(k); while (nextMd <= r.md) nextMd += 1000; } });
      idx.forEach(k => {
        const C = cov[k], cx = C[3], cy = C[0], cxy = C[1], a = Math.sqrt(cx); if (!(a > 0)) return;
        const b = cxy / a, c = Math.sqrt(Math.max(0, cy - b * b)), K = 2.79, q = pl[k];
        g.beginPath();
        for (let s = 0; s <= 48; s++) { const t = s / 48 * Math.PI * 2, ex = K * a * Math.cos(t), ey = K * (b * Math.cos(t) + c * Math.sin(t)); const px = X(q.x + ex), py = Y(q.y + ey); s ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.stroke();
      });
      g.globalAlpha = 1;
    }
  }
  if (act) {
    g.strokeStyle = css('--blue'); g.lineWidth = 3.4; g.lineJoin = 'round'; g.beginPath();
    act.forEach((q, k) => k ? g.lineTo(X(q.x), Y(q.y)) : g.moveTo(X(q.x), Y(q.y))); g.stroke();
    const e = act[act.length - 1]; g.fillStyle = css('--blue'); g.beginPath(); g.arc(X(e.x), Y(e.y), 4, 0, 7); g.fill();
    if (ACT.hov && ACT.hov.a) {
      const A = ACT.hov.a, Pp = ACT.hov.p; g.strokeStyle = css('--ink'); g.lineWidth = 1.2; g.setLineDash([3, 2]); g.beginPath(); g.moveTo(X(Pp.x), Y(Pp.y)); g.lineTo(X(A.x), Y(A.y)); g.stroke(); g.setLineDash([]);
      [[Pp, css('--accent')], [A, css('--blue')]].forEach(([q, col]) => { g.fillStyle = col; g.strokeStyle = css('--panel'); g.lineWidth = 2; g.beginPath(); g.arc(X(q.x), Y(q.y), 6, 0, 7); g.fill(); g.stroke(); });
    }
  }
  // targets
  const diamond = (q, label) => {
    const x = X(q.x), y = Y(q.y); g.strokeStyle = warn; g.fillStyle = css('--panel'); g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = warn; g.textAlign = 'left'; g.fillText(label, x + 9, y - 6);
  };
  if (tgs.length > 1) {
    g.strokeStyle = warn; g.globalAlpha = .45; g.lineWidth = 1.2; g.setLineDash([4, 4]); g.beginPath();
    tgs.forEach((q, k) => k ? g.lineTo(X(q.x), Y(q.y)) : g.moveTo(X(q.x), Y(q.y))); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
  }
  tgs.forEach((q, i) => diamond(q, ut[i].name));
  // markers
  M.markers.forEach(mk => {
    const q = map.row(mk.row), x = X(q.x), y = Y(q.y);
    g.fillStyle = mk.label === 'TD' ? ink : acc; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill();
    g.fillStyle = ink; g.textAlign = 'left'; g.fillText(mk.label, x + 7, y + 12);
  });
  // offset well names: each goes to the nearest free spot around the end of its path, with a thin leader line if it had to move away
  if (NAMES.on && offs.length) {
    const obst = [], box = (x, y, w) => ({ x0: x, y0: y - 10, x1: x + w, y1: y + 3 }), hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    tgs.forEach((q, i) => obst.push(box(X(q.x) + 9, Y(q.y) - 6, g.measureText(ut[i].name).width)));
    M.markers.forEach(mk => { const q = map.row(mk.row); obst.push(box(X(q.x) + 7, Y(q.y) + 12, g.measureText(mk.label).width)); });
    const area = { x0: m.l + 2, y0: m.t + 2, x1: m.l + iw - 2, y1: m.t + ih - 2 }, inside = b => b.x0 >= area.x0 && b.x1 <= area.x1 && b.y0 >= area.y0 && b.y1 <= area.y1;
    const dirs = [[1, 0], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0], [-1, -1], [-1, 1]];
    offs.forEach((o, i) => {
      const q = o[o.length - 1], ax = X(q.x), ay = Y(q.y), nm = M.offs[i].name, w = g.measureText(nm).width; let best = null;
      search: for (const r of [5, 20, 36, 54]) for (const d of dirs) {
        const lx = d[0] > 0 ? ax + r : d[0] < 0 ? ax - r - w : ax - w / 2, ly = d[1] > 0 ? ay + r + 10 : d[1] < 0 ? ay - r : ay + 4, b = box(lx, ly, w);
        if (!inside(b)) continue;
        if (!obst.some(ob => hit(ob, b))) { best = { lx, ly, b, r }; break search; }
      }
      if (!best) { const lx = ax + 5, ly = ay + 4; best = { lx, ly, b: box(lx, ly, w), r: 5 }; }          // nowhere is free: keep it beside its well
      obst.push(best.b);
      g.strokeStyle = g.fillStyle = M.offs[i].color; g.textAlign = 'left';
      if (best.r > 5) { g.lineWidth = 0.8; g.globalAlpha = .6; g.beginPath(); g.moveTo(ax, ay); g.lineTo(Math.min(Math.max(ax, best.b.x0), best.b.x1), (best.b.y0 + best.b.y1) / 2); g.stroke(); g.globalAlpha = 1; }
      g.fillText(nm, best.lx, best.ly);
    });
  }
  // hover
  let hv = null;
  if (p.mouse && !AP) {
    let best = 26 * 26;
    pl.forEach((q, i) => { const dx = X(q.x) - p.mouse.x, dy = Y(q.y) - p.mouse.y, d = dx * dx + dy * dy; if (d < best) { best = d; hv = i; } });
    if (hv !== null) { g.fillStyle = ink; g.beginPath(); g.arc(X(pl[hv].x), Y(pl[hv].y), 5, 0, 7); g.fill(); }
  }
  g.restore();

  // axes labels
  g.fillStyle = muted; g.textAlign = 'center';
  for (let x = gx0; x <= gx1; x += step) { const px = X(x); if (px > m.l + 14 && px < m.l + iw - 14) g.fillText(fmt(x, 0), px, m.t + ih + 14); }
  g.textAlign = 'right';
  for (let y = gy0; y <= yb; y += step) { const py = Y(y); if (py > m.t + 6 && py < m.t + ih - 4) g.fillText(fmt(y, 0), m.l - 6, py + 4); }
  g.textAlign = 'center'; g.fillText(p.xl, m.l + iw / 2, h - 5);
  g.save(); g.translate(12, m.t + ih / 2); g.rotate(-Math.PI / 2); g.fillText(p.yl, 0, 0); g.restore();
  g.strokeStyle = css('--line'); g.strokeRect(m.l + .5, m.t + .5, iw, ih);
  if (AP) apLegend(g, m.l + 10, m.t + 14);
  if (hv !== null) {
    const r = M.survey[hv], t = `MD ${fmt(r.md, 0)}  Inc ${fmt(r.inc, 1)}°  Azi ${fmt(r.azi, 1)}°  TVD ${fmt(r.tvd, 0)}  VS ${fmt(r.vs, 0)}  DLS ${fmt(r.dls, 1)}`;
    const tw = g.measureText(t).width + 12;
    g.fillStyle = css('--panel'); g.globalAlpha = .92; g.fillRect(m.l + 4, m.t + 4, tw, 20); g.globalAlpha = 1;
    g.strokeStyle = css('--line'); g.strokeRect(m.l + 4.5, m.t + 4.5, tw, 20);
    g.fillStyle = ink; g.textAlign = 'left'; g.fillText(t, m.l + 10, m.t + 18);
  }
}
Object.entries(P2).forEach(([kind, p]) => {
  const c = $('#' + p.id);
  const cur = () => p.view || p.lastView;
  let drag = null;
  c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY }; });
  c.addEventListener('pointerup', () => drag = null);
  c.addEventListener('pointermove', e => {
    const r = c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (drag && cur()) {
      const v = { ...cur() }, g = p.geo;
      v.cx -= (e.clientX - drag.x) / v.s; v.cy -= (e.clientY - drag.y) / (g.sy * v.s);
      p.view = v; drag = { x: e.clientX, y: e.clientY };
    }
    p.mouse = { x: mx, y: my }; later(() => draw2D(kind));
  });
  c.addEventListener('pointerleave', () => { p.mouse = null; later(() => draw2D(kind)); });
  c.addEventListener('dblclick', () => { p.view = null; draw2D(kind); });
  c.addEventListener('wheel', e => {
    e.preventDefault(); const v = { ...cur() }, g = p.geo, r = c.getBoundingClientRect();
    const mx = e.clientX - r.left - g.m.l - g.iw / 2, my = e.clientY - r.top - g.m.t - g.ih / 2;
    const f = Math.exp(-e.deltaY * 0.0015), s2 = v.s * f;
    const dx = v.cx + mx / v.s, dy = v.cy + my / (g.sy * v.s);
    v.cx = dx - mx / s2; v.cy = dy - my / (g.sy * s2); v.s = s2; p.view = v; draw2D(kind);
  }, { passive: false });
});

