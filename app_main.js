'use strict';
/* state, inputs, plan, 2D views (split from index.html; loaded in order, shares globals) */
/* ================= state ================= */
const LS_KEY = 'wellplanner.v1';
const WALL_DEF = () => ({ plan: 'Design #1', foot: 'fnlfel', footText: '', secs: 'crossed', setback: true, scale: '', tvdMin: '', tvdMax: '', wellId: true, company: '', project: '', site: '', wellbore: '', dpStep: '' });
const DEFAULT = () => {
  const s = WP.toGrid(43.70, -105.45, 'WY-E');            // sample surface location, Campbell Co. area
  return {
    name: 'Sample 1H', api: '', actual: null, logs: null, wall: WALL_DEF(), crs: 'WY-E', slot: null,
    surface: { n: +s.n.toFixed(2), e: +s.e.toFixed(2) }, gl: 5080, kbOff: 27, kb: 5107, vsAzi: '',
    targets: [
      { name: 'Landing', n: +(s.n + 700).toFixed(2), e: +(s.e + 700).toFixed(2), tvd: 9800, tol: 10 },
      { name: 'Toe', n: +(s.n + 700 + 10000 * Math.SQRT1_2).toFixed(2), e: +(s.e + 700 + 10000 * Math.SQRT1_2).toFixed(2), tvd: 9800, tol: 25 }
    ],
    lat: { az: 45, len: 1000, dip: 0 },
    d: { type: 'hbh', solveFor: 'tangent', kop: 2250, tanInc: 30, bur1: 1, bur2: 8, latDls: 2, dropInc: 0, ext: 500 },
    maxDls: 15, minSep: 100,
    mode: 'auto', manual: [], tops: [], offsets: []
  };
};
/* older saves: single heel/toe, no coordinate system (treated as a local grid) */
function migrate(s) {
  if (!s || typeof s !== 'object') return s;
  if (!s.crs) s.crs = 'local';
  if (!Array.isArray(s.targets) && s.heel) {
    s.targets = [{ name: 'Landing', ...s.heel, tol: 10 }];
    if (s.toe) s.targets.push({ name: 'Toe', ...s.toe, tol: 25 });
  }
  delete s.heel; delete s.toe;
  if (!isFinite(s.kbOff) || s.kbOff < 0) s.kbOff = 27;                                // rig height; older saves only had KB elevation
  if (!isFinite(s.gl)) s.gl = (isFinite(s.kb) ? s.kb : 5107) - s.kbOff;
  s.kb = +(s.gl + s.kbOff).toFixed(2);
  if (s.d && !(s.d.latDls > 0)) s.d.latDls = 2;
  return s;
}
/* a project = one pad template + one or more wells */
const newPad = ref => ({ ref: { n: ref.n, e: ref.e }, refCol: 1, refRow: 1, cols: 3, rows: 2, dx: 30, dy: 30, rot: 0 });
function newProject() { const w = DEFAULT(); return { v: 2, pad: newPad(w.surface), wells: [w], active: 0, refs: [] }; }
function migrateProject(p) {
  if (!p || typeof p !== 'object') return null;
  let proj;
  if (Array.isArray(p.wells) && p.wells.length) {
    proj = { v: 2, pad: merge(newPad({ n: 0, e: 0 }), p.pad || {}), wells: p.wells.map(w => merge(DEFAULT(), migrate(w))), active: Math.min(Math.max(0, p.active | 0), p.wells.length - 1),
      refs: Array.isArray(p.refs) ? p.refs.map(w => Object.assign(merge(DEFAULT(), migrate(w)), { refSrc: w.refSrc || '', refAdded: w.refAdded || '' })) : [] };
  } else {                                            // single-well file from before pads existed
    const w = merge(DEFAULT(), migrate(p));
    proj = { v: 2, pad: newPad(w.surface), wells: [w], active: 0, refs: [] };
  }
  return proj;
}
function merge(base, over) {
  for (const k in over) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') merge(base[k], over[k]);
    else base[k] = over[k];
  }
  return base;
}
function load() {
  try { const t = localStorage.getItem(LS_KEY); if (t) return migrateProject(JSON.parse(t)); } catch (e) {}
  return null;
}
let project = load() || newProject();
let state = project.wells[project.active];   // the well being edited
let M = { survey: null };                    // latest model of the active well
let lastSolved = { theta: null, kop: null };
let saveTimer = 0;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(project)); } catch (e) {} if (typeof histPush === 'function') histPush(); }, 300);
}

/* ================= helpers ================= */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const fmt = (x, d = 1) => isFinite(x) ? (Math.abs(x) < 0.5 * Math.pow(10, -d) ? 0 : x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const getp = (o, p) => p.split('.').reduce((a, k) => a && a[k], o);
const setp = (o, p, v) => { const ks = p.split('.'), l = ks.pop(); ks.reduce((a, k) => a[k], o)[l] = v; };
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const D2R = Math.PI / 180;
const OFF_COLORS = ['#8a877d', '#6a9ada', '#79bc76', '#a78bdc', '#eaa945', '#4f7fc0'];   // TAH grey, blue, green, purple, amber (orange is the planned well)
let raf = 0;
const later = fn => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fn); };

/* ================= form binding ================= */
function writeInputs() {
  $$('[data-k]').forEach(el => {
    const v = getp(state, el.dataset.k);
    el.value = (v === undefined || v === null) ? '' : v;
  });
  $$('[data-pk]').forEach(el => { el.value = getp(project, el.dataset.pk); });
  applyVisibility();
}
function applyVisibility() {
  const t = state.d.type;
  $$('[data-show]').forEach(el => { el.style.display = el.dataset.show.split(',').includes(t) ? '' : 'none'; });
  $('#lblBur2').textContent = t === 'scurve' ? 'Drop rate (°/100 ft)' : 'Landing rate (°/100 ft)';
  $('#inKop').disabled = state.d.solveFor === 'kop';
  $('#inTan').disabled = state.d.solveFor !== 'kop';
  $('#designHint').textContent = ({
    hbh: 'Surface → vertical section (conductor, surface casing) to KOP → build → tangent → landing curve onto target 1 → lateral through the remaining targets.',
    slant: 'Surface → vertical section to KOP → build → tangent through the target, then held past it.',
    scurve: 'Surface → vertical section to KOP → build → tangent → drop to the entered inclination at the target.',
    vertical: 'Straight hole to heel TVD plus the extension.'
  })[t];
}
document.addEventListener('input', e => {
  const el = e.target.closest('[data-k]');
  if (!el) return;
  const k = el.dataset.k, t = el.dataset.t;
  let v;
  if (t === 'text') v = el.value;
  else if (el.tagName === 'SELECT') v = el.value;
  else if (t === 'opt') v = el.value.trim() === '' ? '' : parseFloat(el.value);
  else { v = parseFloat(el.value); if (!isFinite(v)) return; }
  if (k === 'd.solveFor') {
    if (v === 'kop' && lastSolved.theta != null) state.d.tanInc = +lastSolved.theta.toFixed(2);
    if (v === 'tangent' && lastSolved.kop != null) state.d.kop = +lastSolved.kop.toFixed(1);
    setp(state, k, v); writeInputs(); recalc(); return;
  }
  setp(state, k, v);
  if (k === 'd.type') { applyVisibility(); renderTargets(); }
  if (k === 'crs') { project.wells.forEach(w => { w.crs = v; }); cwFillAll(); }
  recalc();
});

/* ================= coordinate entry: lat/long or X,Y ================= */
const isLL = () => state.crs !== 'local';
function cwObj(id) {
  const [k, i] = id.split(':');
  return k === 'surface' ? state.surface : k === 'pad' ? project.pad.ref : k === 'tgt' ? state.targets[+i] : state.offsets[+i];
}
function cwHtml(id) {
  return `<div class="cw" data-cw="${id}">
    <label class="f">X / Easting (ft)<input type="number" step="any" data-cf="e"></label>
    <label class="f">Y / Northing (ft)<input type="number" step="any" data-cf="n"></label>
    <label class="f ll">Latitude (° N)<input type="number" step="any" data-cf="lat"></label>
    <label class="f ll">Longitude (° E, − west)<input type="number" step="any" data-cf="lon"></label>
  </div>`;
}
function cwFill(root) {
  const o = cwObj(root.dataset.cw); if (!o) return;
  const q = f => root.querySelector(`[data-cf="${f}"]`);
  q('e').value = (+o.e).toFixed(2); q('n').value = (+o.n).toFixed(2);
  const lock = root.dataset.cw === 'surface' && !!state.slot;      // surface is set by the pad slot
  root.querySelectorAll('input').forEach(i => { i.disabled = lock; });
  root.querySelectorAll('.ll').forEach(l => l.classList.toggle('off', !isLL()));
  if (isLL()) { const ll = WP.toLatLon(o.n, o.e, state.crs); q('lat').value = ll.lat.toFixed(7); q('lon').value = ll.lon.toFixed(7); }
}
const cwFillAll = () => $$('[data-cw]').forEach(cwFill);
document.addEventListener('input', e => {
  const el = e.target.closest('[data-cf]'); if (!el) return;
  const root = el.closest('[data-cw]'), o = cwObj(root.dataset.cw), f = el.dataset.cf;
  const q = k => root.querySelector(`[data-cf="${k}"]`);
  if (f === 'e' || f === 'n') {
    const v = parseFloat(el.value); if (!isFinite(v)) return;
    o[f] = v;
    if (isLL()) { const ll = WP.toLatLon(o.n, o.e, state.crs); q('lat').value = ll.lat.toFixed(7); q('lon').value = ll.lon.toFixed(7); }
  } else {
    const la = parseFloat(q('lat').value), lo = parseFloat(q('lon').value);
    if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return;
    const g = WP.toGrid(la, lo, state.crs); o.n = g.n; o.e = g.e;
    q('e').value = g.e.toFixed(2); q('n').value = g.n.toFixed(2);
  }
  recalc();
});

/* ================= targets ================= */
const usedTargets = (w = state) => w.d.type === 'hbh' ? w.targets : w.targets.slice(0, 1);
function roleOf(i) {
  const n = state.targets.length, t = state.d.type;
  if (t === 'hbh') return i === 0 ? 'Landing point: end of the landing curve, start of the lateral' : i === n - 1 ? 'Toe (TD)' : 'Mid-lateral target';
  return i === 0 ? (t === 'vertical' ? 'Target depth' : 'Target') : 'Not used for this well type';
}
function renderTargets() {
  $('#tgtList').innerHTML = state.targets.map((t, i) => {
    const used = state.d.type === 'hbh' || i === 0;
    return `<div class="tgt${used ? '' : ' unused'}">
      <div class="top"><span class="badge">${i + 1}</span><input data-ti="${i}" data-tf="name" value="${esc(t.name)}" placeholder="Name">
        <button class="small ghost" data-tmv="${i}:-1" title="Move up">↑</button><button class="small ghost" data-tmv="${i}:1" title="Move down">↓</button><button class="small ghost" data-tmv="${i}:0" title="Delete">✕</button></div>
      <div class="role">${esc(roleOf(i))}</div>
      ${cwHtml('tgt:' + i)}
      <div class="g2" style="margin-top:6px">
        <label class="f">TVD from KB (ft)<input type="number" step="any" data-ti="${i}" data-tf="tvd" value="${t.tvd}"></label>
        <label class="f">Tolerance radius (ft)<input type="number" step="any" min="0" data-ti="${i}" data-tf="tol" value="${t.tol ?? 10}"></label>
      </div>
      <div class="tmiss" id="tmiss${i}"></div></div>`;
  }).join('') || '<div class="hint" style="margin:0">No targets yet.</div>';
  $$('#tgtList [data-cw]').forEach(cwFill);
  const n = state.targets.length, t = state.d.type;
  $('#tgtHint').textContent = t === 'hbh'
    ? (n < 2 ? 'A horizontal well needs a landing point and a toe. Add the toe.' : 'Order matters: the path goes surface → target 1 (landing) → … → last target. It passes exactly through each target, steering at the lateral steering DLS between them.')
    : 'Only target 1 is used for this well type.';
}
$('#tgtList').addEventListener('input', e => {
  const el = e.target.closest('[data-ti]'); if (!el) return;
  const t = state.targets[+el.dataset.ti], f = el.dataset.tf;
  if (f === 'name') t.name = el.value; else { const v = parseFloat(el.value); if (!isFinite(v)) return; t[f] = v; }
  recalc();
});
$('#tgtList').addEventListener('click', e => {
  const b = e.target.closest('[data-tmv]'); if (!b) return;
  const [i, d] = b.dataset.tmv.split(':').map(Number), a = state.targets;
  if (d === 0) a.splice(i, 1);
  else if (i + d >= 0 && i + d < a.length) [a[i], a[i + d]] = [a[i + d], a[i]];
  renderTargets(); recalc();
});
function addTargetFrom(az, len, dip) {
  const T = state.targets, last = T[T.length - 1] || { n: state.surface.n, e: state.surface.e, tvd: 0 };
  const hl = len * Math.cos(dip * D2R);
  T.push({ name: 'Target ' + (T.length + 1), n: last.n + hl * Math.cos(az * D2R), e: last.e + hl * Math.sin(az * D2R), tvd: last.tvd + len * Math.sin(dip * D2R), tol: 25 });
  renderTargets(); recalc();
}
$('#bAddTgt').onclick = () => {
  const T = state.targets;
  let az = state.lat.az;
  if (T.length >= 2) { const a = T[T.length - 2], b = T[T.length - 1]; az = WP.norm360(Math.atan2(b.e - a.e, b.n - a.n) / D2R); }
  addTargetFrom(az, 1000, 0);
};
$('#bExtend').onclick = () => addTargetFrom(state.lat.az, state.lat.len, state.lat.dip);

/* ================= tops ================= */
function renderTops() {
  $('#topsList').innerHTML = state.tops.map((t, i) =>
    `<div class="row"><input data-top="${i}" data-f="name" value="${esc(t.name)}" placeholder="Name"><input class="num" type="number" step="any" data-top="${i}" data-f="tvd" value="${t.tvd}" title="TVD at the surface location (ft)"><input class="num2" type="number" step="any" data-top="${i}" data-f="dip" value="${t.dip ?? ''}" placeholder="Dip°" title="Dip of the surface, degrees (blank = flat)"><input class="num2" type="number" step="any" data-top="${i}" data-f="azi" value="${t.azi ?? ''}" placeholder="Dir°" title="Dip direction, grid azimuth (degrees)"><button class="small ghost" data-deltop="${i}">✕</button></div>`).join('')
    || '<div class="hint" style="margin:0">None yet.</div>';
}
$('#bAddTop').onclick = () => { state.tops.push({ name: 'Top ' + (state.tops.length + 1), tvd: Math.round((state.targets[0] || { tvd: 0 }).tvd) }); renderTops(); recalc(); };
$('#topsList').addEventListener('input', e => {
  const el = e.target.closest('[data-top]'); if (!el) return;
  const t = state.tops[+el.dataset.top];
  const f = el.dataset.f;
  if (f === 'name') t.name = el.value;
  else if (f === 'dip' || f === 'azi') { const v = parseFloat(el.value); if (isFinite(v)) t[f] = v; else delete t[f]; }
  else { const v = parseFloat(el.value); if (!isFinite(v)) return; t.tvd = v; }
  recalc();
});
$('#topsList').addEventListener('click', e => {
  const b = e.target.closest('[data-deltop]'); if (!b) return;
  state.tops.splice(+b.dataset.deltop, 1); renderTops(); recalc();
});

/* ================= calculation ================= */
function showBanner(err, notes, warns) {
  let h = '';
  if (err) h += `<div class="msg err"><b>Can’t build this plan.</b> ${esc(err)} Plots and tables are cleared until the plan builds.</div>`;
  if (warns && warns.length) h += `<div class="msg note"><ul>${warns.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`;
  $('#banner').innerHTML = h;
  $('#planNotes').innerHTML = notes && notes.length ? `<ul>${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
}

function minDistToPoint(rows, t) {
  let best = { d: Infinity, md: 0 };
  const P = r => ({ x: r.northing, y: r.easting, z: r.tvd });
  const p = { x: t.n, y: t.e, z: t.tvd };
  for (let i = 0; i + 1 < rows.length; i++) {
    const r = WP.ptSegDist(p, P(rows[i]), P(rows[i + 1]));
    if (r.d < best.d) best = { d: r.d, md: rows[i].md + r.t * (rows[i + 1].md - rows[i].md) };
  }
  return best;
}

/* Everything about one well that does not touch the page. Cached per well and invalidated when the well changes. */
const modelCache = new WeakMap();
function modelFor(w) {
  const sig = JSON.stringify(w), c = modelCache.get(w);
  if (c && c.sig === sig) return c.m;
  const m = buildModel(w);
  modelCache.set(w, { sig, m });
  return m;
}
function buildModel(w) {
  const surf = { n: w.surface.n, e: w.surface.e }, T = w.targets;
  if (!T.length) return { err: 'Add at least one target.' };
  const heel = T[0], disp = Math.hypot(heel.n - surf.n, heel.e - surf.e);
  const azHeel = disp > 0.01 ? WP.norm360(Math.atan2(heel.e - surf.e, heel.n - surf.n) / D2R) : 0;
  let sections, plan = null;
  if (w.mode === 'auto') {
    plan = WP.planFromTargets({ surface: surf, targets: T, type: w.d.type, solveFor: w.d.solveFor,
      kop: w.d.kop, bur1: w.d.bur1, bur2: w.d.bur2, latDls: w.d.latDls, tanInc: w.d.tanInc, ext: w.d.ext, dropInc: w.d.dropInc });
    if (!plan.ok) return { err: plan.msg };
    sections = plan.sections;
  } else sections = w.manual;
  const vsAzi = (w.vsAzi !== '' && isFinite(w.vsAzi)) ? +w.vsAzi : (plan && plan.plane != null && w.d.type !== 'vertical' ? plan.plane : azHeel);
  const survey = WP.computeSurvey(WP.buildStations(sections, 10), { n0: surf.n, e0: surf.e, kb: w.kb, vsAzi });
  const last = survey[survey.length - 1];
  const markers = [{ label: 'Surface', row: survey[0] }];
  const iK = survey.findIndex(r => r.inc > 0.05);
  if (iK > 0) markers.push({ label: 'KOP', row: survey[iK - 1] });
  if (plan && plan.heelIdx >= 0 && w.d.type !== 'vertical') markers.push({ label: w.d.type === 'hbh' ? 'Landing' : 'Target', row: WP.lastAtSection(survey, plan.heelIdx) });
  markers.push({ label: 'TD', row: last });
  const misses = usedTargets(w).map(t => ({ label: t.name, tol: t.tol ?? 10, ...minDistToPoint(survey, t) }));
  const secEnds = {};
  survey.forEach(r => { if (r.sec >= 0) secEnds[r.sec] = r; });
  let latLenOut = 0, hasLat = false, prevMd = 0;
  sections.forEach((sc, i) => {
    const en = secEnds[i]; if (!en) return;
    if (sc.name === 'Lateral' || sc.name === 'Steer') { latLenOut += en.md - prevMd; hasLat = true; }
    prevMd = en.md;
  });
  const kop = markers.find(m => m.label === 'KOP');
  // how far the path goes behind the landing point (against the lateral direction), e.g. north of a setback line
  let behind = null;
  if (plan && plan.lateral && w.d.type === 'hbh') {
    const L = markers.find(m => m.label === 'Landing'), az = plan.lateral.azi * D2R, hd = Math.hypot(T[1].n - T[0].n, T[1].e - T[0].e);
    if (L && hd > 1) {
      let best = { d: 0, md: 0 };
      survey.forEach(r => { if (r.md > L.row.md) return; const d = -((r.northing - T[0].n) * Math.cos(az) + (r.easting - T[0].e) * Math.sin(az)); if (d > best.d) best = { d, md: r.md }; });
      const d0 = -((survey[0].northing - T[0].n) * Math.cos(az) + (survey[0].easting - T[0].e) * Math.sin(az));
      if (d0 <= 0 && best.d > 1) behind = best;       // only a back-build well (surface already on the lateral side of the landing line)
    }
  }
  return { w, sections, plan, survey, vsAzi, azHeel, markers, misses, secEnds,
    latLenOut: hasLat ? latLenOut : null, maxDls: Math.max(0, ...survey.map(r => r.dls)), maxInc: Math.max(...survey.map(r => r.inc)),
    kopMd: kop ? kop.row.md : Infinity, behind, notes: plan ? plan.notes.concat(behind ? ['The path runs ' + Math.round(behind.d) + ' ft behind the landing point (opposite the lateral direction) at MD ' + Math.round(behind.md) + '. If the landing point is a setback line, the wellbore crosses it before landing.'] : []) : [] };
}

/* other wells on the pad plus any hand-entered outside offsets, all as survey rows */
function buildOffs() {
  const list = [];
  project.wells.forEach((w, i) => {
    if (w === state || w.asOffset === false) return;
    const m = modelFor(w); if (m.err) return;
    list.push({ name: w.name || 'Unnamed', rows: m.survey, kind: 'pad', color: PAD_COLORS[i % PAD_COLORS.length], kopMd: m.kopMd });
  });
  (project.refs || []).forEach((r, i) => {
    if (r.asOffset === false) return;
    const m = refModel(r); if (!m) return;
    list.push({ name: (r.name || 'Reference') + ' (ref)', rows: m.rows, kind: 'ref', color: PAD_COLORS[(i + 3) % PAD_COLORS.length], kopMd: m.kopMd });
  });
  state.offsets.forEach((o, i) => list.push({ name: o.name, rows: offsetRows(o), kind: 'manual', color: OFF_COLORS[i % OFF_COLORS.length], kopMd: 0 }));
  return list;
}

/* a plan that fails must not leave the previous path on screen: it would look like the current design */
function failPlan(err) {
  ACT.rows = ACT.dev = null;
  M = { survey: null };
  ['cvPlan', 'cvSec', 'cv3d', 'cvDls', 'cvSep'].forEach(id => { const c = $('#' + id); if (c && c.width) c.getContext('2d').clearRect(0, 0, c.width, c.height); });
  $('#stats').innerHTML = '';
  ['surveyTbl', 'secTbl', 'sepTbl'].forEach(id => { const t = $('#' + id); if (t) t.innerHTML = ''; });
  state.targets.forEach((t, i) => { const el = $('#tmiss' + i); if (el) el.innerHTML = ''; });
  showBanner(err);
  renderWellBar(); renderPad();
}

function recalc() {
  applyAllSlots();
  const s = state;
  if (isFinite(s.gl) && isFinite(s.kbOff)) s.kb = +(s.gl + s.kbOff).toFixed(2);           // KB elevation = ground + rig height
  $('#kbOut').value = s.kb;
  autosave();
  $('#wellTitle').textContent = s.name;
  document.title = (s.name ? s.name + ' · ' : '') + 'Well Path Planner';
  const surf = { n: s.surface.n, e: s.surface.e };
  if (s.slot) { const sr = $('#surfCoord .cw'); if (sr) cwFill(sr); }
  // coordinate system info
  if (isLL()) {
    const ll = WP.toLatLon(surf.n, surf.e, s.crs), cv = WP.convergence(ll.lat, ll.lon, s.crs), far = Math.abs(ll.lon - WP.CRS[s.crs].lon0) > 3;
    $('#crsInfo').innerHTML = `SHL: <b>${fmt(ll.lat, 6)}°, ${fmt(ll.lon, 6)}°</b><br>Grid convergence ≈ <b>${fmt(cv, 3)}°</b> (true az = grid az + γ). All azimuths here are <b>grid</b> azimuths.` +
      (far ? `<br><span style="color:var(--warn)">This location is more than 3° from the zone’s central meridian. Check the zone.</span>` : '');
  } else $('#crsInfo').innerHTML = 'Local grid: no lat/long. All azimuths are grid azimuths.';
  const T = s.targets;
  if (!T.length) { failPlan('Add at least one target.'); return; }
  const heel = T[0];
  const dn = heel.n - surf.n, de = heel.e - surf.e, disp = Math.hypot(dn, de);
  const azHeel = disp > 0.01 ? WP.norm360(Math.atan2(de, dn) / D2R) : 0;
  let der = `Surface → target 1: <b>${fmt(disp, 0)} ft @ ${fmt(azHeel, 1)}°</b>`;
  if (s.d.type === 'hbh') for (let k = 0; k + 1 < T.length; k++) {
    const a = T[k], b = T[k + 1], l = Math.hypot(b.n - a.n, b.e - a.e, b.tvd - a.tvd);
    der += `<br>${k + 1} → ${k + 2}: <b>${fmt(l, 0)} ft</b>, inc ${fmt(Math.acos(Math.max(-1, Math.min(1, (b.tvd - a.tvd) / (l || 1)))) / D2R, 2)}°, az ${fmt(WP.norm360(Math.atan2(b.e - a.e, b.n - a.n) / D2R), 1)}°`;
  }
  $('#derived').innerHTML = der;

  const mm = modelFor(s);
  if (mm.err) { failPlan(mm.err); return; }
  const plan = mm.plan;
  if (plan) {
    lastSolved = { theta: plan.theta, kop: plan.kop };
    if (s.d.solveFor === 'kop') $('#inKop').value = fmt(plan.kop, 1).replace(/,/g, '');
    else $('#inTan').value = fmt(plan.theta, 2).replace(/,/g, '');
  }
  const offs = buildOffs();
  M = { ...mm, offs, sep: null };
  stoRefresh(); M.offs = offs.concat(stoOffs());
  const { survey, misses, maxDls, maxInc, latLenOut, vsAzi } = mm;
  const last = survey[survey.length - 1];

  s.targets.forEach((t, i) => {
    const el = $('#tmiss' + i); if (!el) return;
    const m = misses[i];
    el.innerHTML = m ? `Path passes <b>${fmt(m.d, 2)} ft</b> from this target at MD ${fmt(m.md, 0)} ` + `<span class="pill ${m.d <= m.tol ? 'ok' : 'warn'}">${m.d <= m.tol ? 'inside tolerance' : 'outside tolerance'}</span>` : 'Not used for this well type.';
  });

  const warn = [];
  if (maxDls > s.maxDls + 1e-6) warn.push(`Max DLS ${fmt(maxDls, 2)}°/100 ft exceeds the ${fmt(s.maxDls, 1)}° alarm.`);
  offsetWarnings(mm, M.offs).forEach(x => warn.push(x));
  showBanner('', mm.notes, warn);

  $('#modeBadge').textContent = s.mode === 'auto' ? 'target-driven' : 'manual sections';
  $('#modeBadge').className = 'pill ' + (s.mode === 'auto' ? 'ok' : 'warn');
  $('#secLbl').textContent = `VS azimuth ${fmt(vsAzi, 1)}°`;

  const st = (k, v, sub, bad) => `<div class="stat${bad ? ' bad' : ''}"><div class="k">${k}</div><div class="v">${v}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;
  let html = st('Total MD', fmt(last.md, 0), 'ft') + st('TVD at TD', fmt(last.tvd, 0), 'ft');
  if (isFinite(mm.kopMd)) html += st('Vert. section', fmt(mm.kopMd, 0), 'ft to KOP');
  html += st('Max inc', fmt(maxInc, 1), '°') + st('Max DLS', fmt(maxDls, 2), '°/100', maxDls > s.maxDls + 1e-6) +
    st('VS at TD', fmt(last.vs, 0), 'ft');
  if (plan && plan.theta) html += st('Tangent inc', fmt(plan.theta, 2), '°');
  if (latLenOut) html += st('Lateral MD', fmt(latLenOut, 0), 'ft');
  if (misses.length) {
    const w = misses.reduce((a, b) => (b.d - b.tol > a.d - a.tol ? b : a));
    html += st('Target miss', fmt(w.d, 1), 'ft · ' + esc(w.label), w.d > w.tol);
  }
  $('#stats').innerHTML = html;

  renderSurvey(); renderSections(); renderOffsetResults(); updateOffStats(); renderWellBar(); renderPad();
  drawAll();
  computeActual(); renderRef(); renderSto(); renderActual(); renderGeo();
  if (SEC.on || STO.on || WALL.on) { updateSecInfo(); clearTimeout(SEC.timer); SEC.timer = setTimeout(ensureSections, 350); }
}

/* ================= survey table ================= */
const COLS = [
  ['md', 'MD', 1], ['inc', 'Inc °', 2], ['azi', 'Azi °', 2], ['tvd', 'TVD', 1], ['tvdss', 'TVDSS', 1],
  ['n', '+N/−S', 1], ['e', '+E/−W', 1], ['vs', 'VS', 1], ['dls', 'DLS °/100', 2], ['br', 'Build °/100', 2], ['tr', 'Turn °/100', 2],
  ['northing', 'Northing', 1], ['easting', 'Easting', 1]
];
function filteredRows() {
  const k = +$('#repInt').value, sv = M.survey || [];
  return sv.filter((r, i) => {
    if (i === 0 || i === sv.length - 1) return true;
    if (sv[i + 1].sec !== r.sec) return true;
    if (k > 0) { const q = r.md / k; return Math.abs(q - Math.round(q)) * k < 1e-6; }
    return false;
  });
}
function secName(r) {
  if (r.sec < 0) return 'Surface';
  const sc = M.sections[r.sec]; return sc ? (sc.name || (sc.type === 'hold' ? 'Hold' : 'Curve')) : '';
}
function renderSurvey() {
  if (!M.survey) return;
  const rows = filteredRows();
  const sv = M.survey;
  let h = '<thead><tr>' + COLS.map(c => `<th>${c[1]}</th>`).join('') + '<th class="l">Section</th></tr></thead><tbody>';
  const idx = new Map(sv.map((r, i) => [r, i]));
  rows.forEach(r => {
    const i = idx.get(r), bound = i === 0 || i === sv.length - 1 || sv[i + 1].sec !== r.sec;
    h += `<tr class="${bound ? 'bound' : ''}">` + COLS.map(c => {
      const bad = c[0] === 'dls' && r.dls > state.maxDls + 1e-6;
      return `<td class="${bad ? 'bad' : ''}">${fmt(r[c[0]], c[2])}</td>`;
    }).join('') + `<td class="l">${esc(secName(r))}</td></tr>`;
  });
  $('#surveyTbl').innerHTML = h + '</tbody>';
}
$('#repInt').onchange = renderSurvey;

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const safeName = () => (state.name || 'well').replace(/[^\w.-]+/g, '_');
const apiTag = () => String(state.api || '').trim().replace(/[^\w.-]+/g, '_');
function updatePrintId() { const e = $('#printId'); if (e) e.textContent = state.name + (String(state.api || '').trim() ? '   API # ' + String(state.api).trim() : ''); }
$('#bCsv').onclick = () => {
  if (!M.survey) return;
  const hdr = ['MD_ft', 'Inc_deg', 'Azi_deg', 'TVD_ft', 'TVDSS_ft', 'N_ft', 'E_ft', 'VS_ft', 'DLS_deg_per_100ft', 'Build_deg_per_100ft', 'Turn_deg_per_100ft', 'Northing_ft', 'Easting_ft', 'Section'];
  const lines = [hdr.join(',')];
  filteredRows().forEach(r => lines.push(COLS.map(c => (+r[c[0]]).toFixed(c[2] + 1)).concat('"' + secName(r) + '"').join(',')));
  download(safeName() + (apiTag() ? '_' + apiTag() : '') + '_plan_survey.csv', lines.join('\n') + '\n', 'text/csv');
};
$('#bPrint').onclick = () => { updatePrintId(); drawAll(); window.print(); };
window.addEventListener('beforeprint', () => { updatePrintId(); drawAll(); });

/* ================= sections tab ================= */
function renderSections() {
  if (!M.survey) return;
  const manual = state.mode === 'manual';
  $('#secBar').innerHTML = manual
    ? `<button id="bAddHold">+ Hold</button><button id="bAddCurve">+ Curve</button><button id="bBack" class="primary">Back to target-driven</button><span class="hint" style="margin:0">Manual mode: the targets no longer drive the path; target misses are shown above.</span>`
    : `<button id="bManual" class="primary">Edit as manual sections</button><span class="hint" style="margin:0">Currently solved from your targets.</span>`;
  let start = 0;
  const num = (i, f, v, w) => `<input class="w" type="number" step="any" data-si="${i}" data-sf="${f}" value="${+(+v).toFixed(2)}">`;
  let h = '<thead><tr><th class="l">#</th><th class="l">Name</th><th class="l">Type</th><th>Hold length</th><th>DLS °/100</th><th>Target inc °</th><th>Target azi °</th>' +
    '<th>Length</th><th>End MD</th><th>Inc °</th><th>Azi °</th><th>TVD</th><th>+N/−S</th><th>+E/−W</th><th>VS</th>' + (manual ? '<th></th>' : '') + '</tr></thead><tbody>';
  M.sections.forEach((sc, i) => {
    const end = M.secEnds[i];
    const len = end ? end.md - start : 0;
    if (end) start = end.md;
    const isH = sc.type === 'hold';
    const cell = (f, txt) => manual ? (txt) : '';
    const hv = isH ? (manual ? num(i, 'len', sc.len) : fmt(sc.len, 1)) : '';
    const dl = !isH ? (manual ? num(i, 'dls', sc.dls) : fmt(sc.dls, 2)) : '';
    const ti = !isH ? (manual ? num(i, 'inc', sc.inc) : fmt(sc.inc, 2)) : '';
    const ta = !isH ? (manual ? num(i, 'azi', sc.azi) : fmt(sc.azi, 2)) : '';
    h += `<tr><td class="l">${i + 1}</td><td class="l">${manual ? `<input data-si="${i}" data-sf="name" value="${esc(sc.name || '')}" style="width:100px">` : esc(sc.name || '')}</td>` +
      `<td class="l">${manual ? `<select data-si="${i}" data-sf="type"><option value="hold"${isH ? ' selected' : ''}>Hold</option><option value="curve"${!isH ? ' selected' : ''}>Curve</option></select>` : (isH ? 'Hold' : 'Curve')}</td>` +
      `<td>${hv}</td><td>${dl}</td><td>${ti}</td><td>${ta}</td>` +
      (end ? `<td>${fmt(len, 1)}</td><td>${fmt(end.md, 1)}</td><td>${fmt(end.inc, 2)}</td><td>${fmt(end.azi, 2)}</td><td>${fmt(end.tvd, 1)}</td><td>${fmt(end.n, 1)}</td><td>${fmt(end.e, 1)}</td><td>${fmt(end.vs, 1)}</td>`
        : '<td colspan="8" style="color:var(--muted)">zero length, skipped</td>') +
      (manual ? `<td><button class="small ghost" data-mv="${i}:-1">↑</button><button class="small ghost" data-mv="${i}:1">↓</button><button class="small ghost" data-mv="${i}:0">✕</button></td>` : '') + '</tr>';
  });
  $('#secTbl').innerHTML = h + '</tbody>';
  const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  on('#bManual', () => { state.mode = 'manual'; state.manual = JSON.parse(JSON.stringify(M.sections)); recalc(); });
  on('#bBack', () => { state.mode = 'auto'; recalc(); });
  on('#bAddHold', () => { state.manual.push({ type: 'hold', len: 500, name: 'Hold' }); recalc(); });
  on('#bAddCurve', () => {
    const l = M.survey[M.survey.length - 1];
    state.manual.push({ type: 'curve', dls: 3, inc: +Math.min(90, l.inc + 10).toFixed(2), azi: +l.azi.toFixed(2), name: 'Curve' }); recalc();
  });
}
$('#secTbl').addEventListener('change', e => {
  const el = e.target.closest('[data-si]'); if (!el || state.mode !== 'manual') return;
  const sc = state.manual[+el.dataset.si], f = el.dataset.sf;
  if (f === 'name') sc.name = el.value;
  else if (f === 'type') {
    if (el.value === 'hold') { sc.type = 'hold'; sc.len = sc.len || 500; } else { sc.type = 'curve'; sc.dls = sc.dls || 3; sc.inc = sc.inc ?? 0; sc.azi = sc.azi ?? 0; }
  } else { const v = parseFloat(el.value); if (!isFinite(v)) return; sc[f] = v; }
  recalc();
});
$('#secTbl').addEventListener('click', e => {
  const b = e.target.closest('[data-mv]'); if (!b) return;
  const [i, d] = b.dataset.mv.split(':').map(Number), a = state.manual;
  if (d === 0) a.splice(i, 1);
  else if (i + d >= 0 && i + d < a.length) [a[i], a[i + d]] = [a[i + d], a[i]];
  recalc();
});

/* ================= offsets ================= */
function renderOffsetForms() {
  $('#offList').innerHTML = state.offsets.map((o, i) => `
    <div class="offcard">
      <div class="top"><b style="color:${OFF_COLORS[i % OFF_COLORS.length]}">●</b><input data-oi="${i}" data-of="name" value="${esc(o.name)}" placeholder="Offset well name"><span class="pill" id="offStat${i}"></span><button class="small ghost" data-deloff="${i}">✕</button></div>
      ${cwHtml('off:' + i)}
      <label class="f" style="margin-top:6px;max-width:200px">KB elev (ft ASL)<input type="number" step="any" data-oi="${i}" data-of="kb" value="${o.kb}"></label>
      <label class="f" style="margin-top:6px">Survey: MD, Inc, Azi per line (comma, space or tab; header ignored). Leave blank for a vertical well.
        <textarea data-oi="${i}" data-of="text" placeholder="0, 0, 0&#10;500, 1.2, 135&#10;...">${esc(o.text)}</textarea></label>
      <div class="g2" style="margin-top:6px"><label class="f">Vertical TD if no survey (ft MD)<input type="number" step="any" data-oi="${i}" data-of="td" value="${o.td}"></label>
        <label class="f">Or load a CSV / text file<input type="file" data-offfile="${i}" accept=".csv,.txt,.dat"></label></div>
    </div>`).join('') || '<div class="hint">No outside offset wells added. Other wells on the pad are compared automatically below.</div>';
  $$('#offList [data-cw]').forEach(cwFill);
}
$('#bAddOff').onclick = () => {
  state.offsets.push({ name: 'Offset ' + (state.offsets.length + 1), n: state.surface.n + 400, e: state.surface.e, kb: state.kb, td: 9000, text: '' });
  renderOffsetForms(); recalc();
};
$('#offList').addEventListener('input', e => {
  const el = e.target.closest('[data-oi]'); if (!el) return;
  const o = state.offsets[+el.dataset.oi], f = el.dataset.of;
  if (f === 'name' || f === 'text') o[f] = el.value; else { const v = parseFloat(el.value); if (!isFinite(v)) return; o[f] = v; }
  recalc();
});
$('#offList').addEventListener('click', e => {
  const b = e.target.closest('[data-deloff]'); if (!b) return;
  state.offsets.splice(+b.dataset.deloff, 1); renderOffsetForms(); recalc();
});
$('#offList').addEventListener('change', e => {
  const el = e.target.closest('[data-offfile]'); if (!el || !el.files[0]) return;
  const i = +el.dataset.offfile, rd = new FileReader();
  rd.onload = () => { state.offsets[i].text = String(rd.result); renderOffsetForms(); recalc(); };
  rd.readAsText(el.files[0]);
});
$('#minSep').addEventListener('input', e => { const v = parseFloat(e.target.value); if (isFinite(v)) { state.minSep = v; recalc(); } });

const PAD_COLORS = ['#6a9ada', '#79bc76', '#a78bdc', '#eaa945', '#8a877d', '#4f7fc0', '#5a9a57', '#8466c4'];   // TAH blue, green, purple, amber, grey and darker variants
function offsetRows(o) {
  let st = WP.parseSurveyText(o.text);
  if (!st.length) st = [{ md: 0, inc: 0, azi: 0 }, { md: Math.max(1, o.td), inc: 0, azi: 0 }];
  else if (st[0].md > 0) st.unshift({ md: 0, inc: 0, azi: 0 });
  return WP.computeSurvey(st, { n0: o.n, e0: o.e, kb: o.kb, vsAzi: 0 });
}
function updateOffStats() {
  state.offsets.forEach((o, i) => {
    const el = $('#offStat' + i); if (!el) return;
    const n = WP.parseSurveyText(o.text).length; el.textContent = n ? n + ' stations' : 'vertical to ' + fmt(o.td, 0);
  });
}
const minInRegion = (sp, start) => { let b = null; sp.forEach(x => { if (x.md >= start && (!b || x.d < b.d)) b = x; }); return b; };
/* Pad wells start one slot apart and stay parallel while both are vertical, so only distances from the
 * shallower of the two kickoffs down count toward the alert. */
function offsetWarnings(mm, offs) {
  const out = [], pc = covOf(mm.survey);
  offs.forEach(o => {
    const pad = o.kind === 'pad' || o.kind === 'ref', start = pad ? Math.min(mm.kopMd, o.kopMd) : -Infinity;
    if (pad && !isFinite(start)) return;
    const os = o.rows.length > 600 ? 3 : 1, oc = pc && covOf(o.rows);
    const sp = oc ? WP.separationSF(mm.survey, o.rows, pc, oc, 5, os) : WP.separation(mm.survey, o.rows, 5, os);
    const dm = minInRegion(sp, start); if (!dm) return;
    let sm = null; if (oc) sp.forEach(x => { if (x.md >= start && (!sm || x.sf < sm.sf)) sm = x; });
    const label = o.kind === 'state' ? o.name + ' (state survey)' : o.name, parts = [];
    if (dm.d < state.minSep) parts.push(`center distance ${fmt(dm.d, 0)} ft at MD ${fmt(dm.md, 0)} (alert ${fmt(state.minSep, 0)} ft)`);
    if (sm && sm.sf < ERR.sf) parts.push(`separation factor ${fmt(sm.sf, 2)} at MD ${fmt(sm.md, 0)} with ${fmt(sm.d, 0)} ft between centers (alert below ${fmt(ERR.sf, 1)})` + (sm.sf < 1 ? ', error ellipses overlap' : ''));
    if (parts.length) out.push(`${state.name} vs ${label}: ${parts.join('; ')}. See Offsets & clearance.`);
  });
  return out;
}
