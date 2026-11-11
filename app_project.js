'use strict';
/* tabs, project, pad, file actions, init (split from index.html; loaded in order, shares globals) */
/* ================= tabs, resize, theme ================= */
$$('.tab').forEach(b => b.onclick = () => {
  $$('.tab').forEach(x => x.classList.toggle('on', x === b));
  $$('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + b.dataset.tab));
  if (b.dataset.tab === 'offsets') renderOffsetResults();
  if (b.dataset.tab === 'actual') renderActual();
  if (b.dataset.tab === 'geo') renderGeo();
  WALL.on = b.dataset.tab === 'wall';
  if (WALL.on) { syncWallInputs(); if (typeof ensureSections === 'function') ensureSections(); }
  drawAll();
});
new ResizeObserver(() => later(drawAll)).observe($('main'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { updateThemeBtn(); drawAll(); });
function isDarkTheme() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
function updateThemeBtn() {
  const b = $('#bTheme'); if (b) b.textContent = isDarkTheme() ? '☀' : '☾';
}
$('#bTheme').onclick = () => {
  const t = isDarkTheme() ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch (e) {}
  updateThemeBtn(); drawAll();
};
updateThemeBtn();

/* ================= project: wells and pad ================= */
const slotId = (c, r) => 'C' + c + 'R' + r;
const wellAtSlot = (c, r) => project.wells.find(w => w.slot && w.slot.c === c && w.slot.r === r);
const SLOT_SNAP = 10;                                     // ft: a well whose surface sits this close to a free slot is in that slot
function autoAssignSlots() {
  const P = project.pad, taken = new Set(project.wells.filter(w => w.slot).map(w => w.slot.c + '-' + w.slot.r));
  project.wells.forEach(w => {
    if (w.slot) return;
    let best = null, bd = SLOT_SNAP;
    WP.padSlots(P, P.cols, P.rows, w.crs || state.crs).forEach(s => { const d = Math.hypot(s.n - w.surface.n, s.e - w.surface.e); if (d <= bd && !taken.has(s.c + '-' + s.r)) { bd = d; best = s; } });
    if (best) { w.slot = { c: best.c, r: best.r }; taken.add(best.c + '-' + best.r); if (w === state && typeof renderSlotSel === 'function') renderSlotSel(); }
  });
}
function applyAllSlots() {
  autoAssignSlots();
  project.wells.forEach(w => { if (w.slot) { const p = WP.padSlot(project.pad, w.slot.c, w.slot.r, w.crs || state.crs); w.surface.n = p.n; w.surface.e = p.e; } });
}
document.addEventListener('input', e => {                 // pad settings
  const el = e.target.closest('[data-pk]'); if (!el) return;
  let v = parseFloat(el.value); if (!isFinite(v)) return;
  const k = el.dataset.pk;
  if (k === 'pad.cols' || k === 'pad.rows') v = Math.max(1, Math.min(12, Math.round(v)));
  if (k === 'pad.refCol' || k === 'pad.refRow') v = Math.max(1, Math.round(v));
  if (k === 'pad.dx' || k === 'pad.dy') v = Math.max(0, v);
  if (k === 'pad.rot') v = -v;                                // typed clockwise from north, stored counter-clockwise
  setp(project, k, v); recalc();
});
$('#bPadUse').onclick = () => {
  project.pad.ref = { n: state.surface.n, e: state.surface.e };
  if (state.slot) { project.pad.refCol = state.slot.c; project.pad.refRow = state.slot.r; }
  writeInputs(); cwFill($('#padRef .cw')); recalc();
};

/* the pad template is rolled up unless opened; the choice is remembered */
function setPadOpen(open, save) {
  $('#padBody').hidden = !open; $('#padArrow').textContent = open ? '▾' : '▸'; $('#padHead').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (save) { try { localStorage.setItem('wellplanner.padOpen', open ? '1' : '0'); } catch (e) {} }
  if (open) drawPad();
}
$('#padHead').onclick = () => setPadOpen($('#padBody').hidden, true);
$('#padHead').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPadOpen($('#padBody').hidden, true); } };
{ let o = false; try { o = localStorage.getItem('wellplanner.padOpen') === '1'; } catch (e) {} setPadOpen(o, false); }
function setLsOpen(open, save) {
  $('#lsBody').hidden = !open; $('#lsArrow').textContent = open ? '▾' : '▸'; $('#lsHead').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (save) { try { localStorage.setItem('wellplanner.lsOpen', open ? '1' : '0'); } catch (e) {} }
}
$('#lsHead').onclick = () => setLsOpen($('#lsBody').hidden, true);
$('#lsHead').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLsOpen($('#lsBody').hidden, true); } };
{ let o = false; try { o = localStorage.getItem('wellplanner.lsOpen') === '1'; } catch (e) {} setLsOpen(o, false); }

let wellSig = '';
function renderWellBar() {
  const sig = project.active + '|' + project.wells.map(w => (w.name || '') + '~' + (w.slot ? slotId(w.slot.c, w.slot.r) : '')).join('|');
  if (sig === wellSig) return; wellSig = sig;
  $('#wellSel').innerHTML = project.wells.map((w, i) => `<option value="${i}"${i === project.active ? ' selected' : ''}>${esc(w.name || 'Unnamed')}${w.slot ? ' (' + slotId(w.slot.c, w.slot.r) + ')' : ''}</option>`).join('');
}
function selectWell(i) { project.active = i; state = project.wells[i]; adoptPadTops(); histOf(state); wellSig = ''; P2.plan.view = P2.sec.view = P2.apPlan.view = null; init(); }
/* ---- undo / redo: snapshots of the active well, taken after each autosave, restored in place ---- */
const HIST = new WeakMap(), HIST_MAX = 40;
let histBusy = false;
function histOf(w) { let h = HIST.get(w); if (!h) { h = { s: [JSON.stringify(w)], i: 0 }; HIST.set(w, h); } return h; }
function histPush() {
  if (histBusy) return; const h = histOf(state), j = JSON.stringify(state);
  if (j === h.s[h.i]) return;
  h.s.length = h.i + 1; h.s.push(j); if (h.s.length > HIST_MAX) h.s.shift(); h.i = h.s.length - 1; histUi();
}
function histGo(d) {
  clearTimeout(saveTimer); histPush();                            // fold any edit still waiting for its autosave into history first
  const h = histOf(state), k = h.i + d; if (k < 0 || k >= h.s.length) return;
  h.i = k; const snap = JSON.parse(h.s[k]); histBusy = true;
  Object.keys(state).forEach(key => delete state[key]); Object.assign(state, snap);
  try { wellSig = ''; init(); } finally { histBusy = false; }
  histUi(); autosave();
}
function histUi() { const h = histOf(state); $('#bUndo').disabled = h.i <= 0; $('#bRedo').disabled = h.i >= h.s.length - 1; }
$('#bUndo').onclick = () => histGo(-1); $('#bRedo').onclick = () => histGo(1);
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'z') return;
  const t = e.target, tag = t && t.tagName; if (tag === 'TEXTAREA' || (tag === 'INPUT' && t.type !== 'checkbox' && t.type !== 'range') || (t && t.isContentEditable)) return;   // let text fields use their own undo
  e.preventDefault(); histGo(e.shiftKey ? 1 : -1);
});
/* ---- unsaved-work tracking and dialog ---- */
/* each well remembers what it looked like when last saved or opened; a well never saved counts as changed */
const savedW = new WeakMap(), wSig = w => JSON.stringify(w);
const markSaved = w => savedW.set(w, wSig(w)), markAllSaved = () => project.wells.forEach(markSaved);
const dirtyWells = () => project.wells.filter(w => savedW.get(w) !== wSig(w));
let snoozeSig = null;
function dlg(msg, buttons) {                 // buttons: [{label, value, primary}] -> Promise of the clicked value
  return new Promise(res => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = `<div style="background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:18px 20px;max-width:460px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.4)"><div style="white-space:pre-line;margin-bottom:14px">${esc(msg)}</div><div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">${buttons.map((b, k) => `<button data-k="${k}"${b.primary ? ' class="primary"' : ''}>${esc(b.label)}</button>`).join('')}</div></div>`;
    ov.onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; ov.remove(); res(buttons[+b.dataset.k].value); };
    document.body.appendChild(ov); const f = ov.querySelector('.primary') || ov.querySelector('button'); if (f) f.focus();
  });
}
/* saves one well as its own file (with the pad and reference wells it needs), never the whole pad project */
function saveWell(w) {
  const one = { v: 2, pad: project.pad, wells: [w], active: 0, refs: project.refs };
  download((w.name || 'well').replace(/[^\w.-]+/g, '_') + '.wellplan.json', WP.compactJson(one), 'application/json');
  markSaved(w);
}
const doSave = () => saveWell(state);
/* true when it is fine to carry on (saved, or user chose not to); forNew: New always asks, switching asks once per set of edits */
async function confirmLeave(what, forNew) {
  const sig = wSig(state), dirty = forNew ? dirtyWells() : (savedW.get(state) !== sig && sig !== snoozeSig ? [state] : []);
  if (!dirty.length) return true;
  const names = dirty.map(w => '"' + (w.name || 'Unnamed') + '"').join(', ');
  const r = await dlg('You have unsaved changes to ' + names + '.\nDo you want to save ' + (dirty.length > 1 ? 'each as its own file' : 'it') + ' before ' + what + '?', [{ label: 'Cancel', value: 'cancel' }, { label: "Don't save", value: 'discard' }, { label: 'Save', value: 'save', primary: true }]);
  if (r === 'cancel') return false;
  if (r === 'save') dirty.forEach(saveWell); else if (!forNew) snoozeSig = sig;
  return true;
}
async function trySelectWell(i) {
  if (i === project.active) return;
  if (!(await confirmLeave('switching wells', false))) { wellSig = ''; renderWellBar(); return; }
  selectWell(i);
}
$('#wellSel').onchange = e => trySelectWell(+e.target.value);
$('#bDelWell').onclick = async () => {
  if (project.wells.length < 2) { await dlg('A project needs at least one well, so the only well cannot be deleted. Use New to start a different plan.', [{ label: 'OK', value: 'ok', primary: true }]); return; }
  const name = state.name || 'Unnamed';
  const r = await dlg('Delete "' + name + '" from this project?\nThis cannot be undone. Save it to a file first if you might want it back.', [{ label: 'Cancel', value: 'cancel' }, { label: 'Delete well', value: 'del', primary: true }]);
  if (r !== 'del') return;
  const i = project.active; project.wells.splice(i, 1); lsRef = -1;
  selectWell(Math.min(i, project.wells.length - 1)); autosave();
};

function renderSlotSel() {
  const P = project.pad, have = new Set(), opts = ['<option value="custom">Custom location (type coordinates)</option>'];
  WP.padSlots(P, P.cols, P.rows, state.crs).forEach(sl => {
    const o = wellAtSlot(sl.c, sl.r), taken = o && o !== state; have.add(sl.id);
    opts.push(`<option value="${sl.c}-${sl.r}"${taken ? ' disabled' : ''}>Pad slot ${sl.id}${o ? ' (' + esc(o.name) + ')' : ''}</option>`);
  });
  if (state.slot && !have.has(slotId(state.slot.c, state.slot.r))) opts.push(`<option value="${state.slot.c}-${state.slot.r}">Pad slot ${slotId(state.slot.c, state.slot.r)} (outside the grid)</option>`);
  const el = $('#slotSel'); el.innerHTML = opts.join('');
  el.value = state.slot ? state.slot.c + '-' + state.slot.r : 'custom';
}
$('#slotSel').onchange = e => {
  const v = e.target.value;
  if (v === 'custom') state.slot = null;
  else {
    const [c, r] = v.split('-').map(Number), o = wellAtSlot(c, r);
    if (o && o !== state) { alert('Slot ' + slotId(c, r) + ' already holds ' + o.name + '.'); renderSlotSel(); return; }
    state.slot = { c, r };
  }
  recalc(); cwFill($('#surfCoord .cw'));
};

function createWellAtSlot(c, r) {
  const src = state, w = JSON.parse(JSON.stringify(src)), p = WP.padSlot(project.pad, c, r, state.crs);
  const dn = p.n - src.surface.n, de = p.e - src.surface.e;
  w.name = 'Well ' + (project.wells.length + 1); w.slot = { c, r }; w.api = ''; w.actual = null; w.logs = null; w.wall = Object.assign(WALL_DEF(), { plan: (w.wall && w.wall.plan) || 'Design #1' });
  w.surface = { n: p.n, e: p.e };
  w.targets.forEach(t => { t.n += dn; t.e += de; });      // same geometry, moved with the surface location
  project.wells.push(w);
  selectWell(project.wells.length - 1);
}

/* ---- start a well from a planned survey (COMPASS export or any MD / inc / azi list) ---- */
$('#bImpSurvey').onclick = () => $('#impSurveyFile').click();
$('#impSurveyFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  let text; try { text = await f.text(); } catch (x) { await dlg('Could not read that file: ' + x.message, [{ label: 'OK', value: 1, primary: true }]); return; }
  const r = WP.parseActualText(text);
  if (r.rows.length < 2) { await dlg(`Found ${r.rows.length} usable station${r.rows.length === 1 ? '' : 's'} in ${f.name}. Each line needs MD, inclination and azimuth (a header line that names them is fine).`, [{ label: 'OK', value: 1, primary: true }]); return; }
  let conv = 0;
  if (isLL()) {
    const a = await dlg('Are the azimuths in ' + f.name + ' referenced to grid north or true north?\n(COMPASS can export either; the report header says which.)', [{ label: 'Grid north', value: 'grid', primary: true }, { label: 'True north', value: 'true' }, { label: 'Cancel', value: null }]);
    if (!a) return;
    if (a === 'true') { const ll = WP.toLatLon(state.surface.n, state.surface.e, state.crs); conv = WP.convergence(ll.lat, ll.lon, state.crs); }
  }
  const rows = r.rows.map(q => ({ md: q.md, inc: q.inc, azi: WP.norm360(q.azi - conv) }));
  const fit = WP.surveyToSections(rows, 0.1);
  if (fit.err) { await dlg(fit.err, [{ label: 'OK', value: 1, primary: true }]); return; }
  const free = WP.padSlots(project.pad, project.pad.cols, project.pad.rows, state.crs).find(sl => !wellAtSlot(sl.c, sl.r));
  const w = JSON.parse(JSON.stringify(state));
  w.name = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Imported well';
  w.api = ''; w.actual = null; w.logs = null; w.wall = Object.assign(WALL_DEF(), { plan: (state.wall && state.wall.plan) || 'Design #1' });
  if (free) { w.slot = { c: free.c, r: free.r }; w.surface = { n: free.n, e: free.e }; }
  else { w.slot = null; w.surface = { n: state.surface.n, e: state.surface.e }; }
  w.mode = 'manual'; w.manual = fit.sections; w.d = Object.assign(w.d || {}, {}); w.vsAzi = '';
  const sv = WP.computeSurvey(WP.buildStations(fit.sections, 10), { n0: w.surface.n, e0: w.surface.e, kb: w.kb, vsAzi: 0 }), last = sv[sv.length - 1];
  const lastHold = fit.sections.length && fit.sections[fit.sections.length - 1].type === 'hold' ? sv.find(q => q.sec === fit.sections.length - 1) : null;
  const heel = lastHold ? sv[sv.indexOf(lastHold) - 1] || lastHold : sv[Math.max(0, sv.length - 2)];
  w.targets = [{ name: 'Landing', n: +(heel.northing).toFixed(2), e: +(heel.easting).toFixed(2), tvd: +heel.tvd.toFixed(2), tol: 10 }, { name: 'TD', n: +(last.northing).toFixed(2), e: +(last.easting).toFixed(2), tvd: +last.tvd.toFixed(2), tol: 25 }];
  project.wells.push(w);
  selectWell(project.wells.length - 1);
  autosave();
  const sc = fit.sections.length, ok = fit.maxErr < 1;
  showBanner('', [`Started from ${f.name}: ${fit.stations} stations fitted as ${sc} section${sc === 1 ? '' : 's'} (see Sections, where each hold and curve can be edited). The fitted path stays within ${fit.maxErr < 0.1 ? '0.1' : fmt(fit.maxErr, 1)} ft of the imported stations.` + (ok ? '' : ' That is a loose fit, so check the sections against the COMPASS plan.') + ` The surface location is ${free ? 'pad slot ' + free.id : 'copied from the previous well'}; set it to the real location.` + (conv ? ` Azimuths were converted from true north (${fmt(conv, 3)}° convergence).` : '')], []);
};

function renderPad() {
  const P = project.pad, n = P.cols * P.rows, filled = project.wells.filter(w => w.slot).length;
  $('#padCount').textContent = `${n} slot${n === 1 ? '' : 's'} · ${filled} filled`;
  let info = `Pad Y axis (rows) points to azimuth <b>${fmt(WP.norm360(-P.rot), 1)}°</b>, X axis (columns) to <b>${fmt(WP.norm360(90 - P.rot), 1)}°</b> (true, clockwise from north; with a coordinate system set, footages are ground feet and the lat/longs follow).`;
  if (P.refCol > P.cols || P.refRow > P.rows) info += `<br><span style="color:var(--warn)">The known point (${slotId(P.refCol, P.refRow)}) is outside the ${P.cols} × ${P.rows} grid.</span>`;
  $('#padInfo').innerHTML = info;
  renderSlotSel();
  renderLatSpace();
}

/* ---- lateral spacing helper ---- */
let lsRef = -1;
function lsPlan() {
  const ri = lsRef >= 0 && lsRef < project.wells.length ? lsRef : project.active;
  return { ri, sp: WP.spaceLaterals(project.wells, ri, { spacing: parseFloat($('#lsSp').value), stagger: parseFloat($('#lsSt').value) || 0, dir: +$('#lsDir').value }) };
}
function renderLatSpace() {
  const sel = $('#lsRef'), sig = project.wells.map(w => w.name).join('|') + '#' + (lsRef >= 0 ? lsRef : project.active);
  if (sel._sig !== sig) {
    sel._sig = sig;
    sel.innerHTML = project.wells.map((w, i) => `<option value="${i}">${esc(w.name || 'Unnamed')}</option>`).join('');
    sel.value = lsRef >= 0 && lsRef < project.wells.length ? lsRef : project.active;
  }
  const { ri, sp } = lsPlan();
  if (!sp.ok) { $('#lsInfo').innerHTML = `<span style="color:var(--warn)">${esc(sp.msg)}</span>`; $('#bLsApply').disabled = true; return; }
  const s = parseFloat($('#lsSp').value);
  if (!(s >= 0)) { $('#lsInfo').innerHTML = '<span style="color:var(--warn)">Enter a spacing of zero or more.</span>'; $('#bLsApply').disabled = true; return; }
  const rows = sp.assignments.sort((a, b) => a.rank - b.rank).map(a => `${esc(project.wells[a.index].name)}: ${fmt(Math.abs(a.offset), 0)} ft ${a.offset < 0 ? 'left' : 'right'}${a.tvd ? ', ' + (a.tvd > 0 ? '+' : '') + fmt(a.tvd, 0) + ' ft TVD' : ''}`);
  $('#lsInfo').innerHTML = `Lateral azimuth of ${esc(project.wells[ri].name)} is <b>${fmt(sp.az, 1)}°</b> (grid).` + (rows.length ? '<br>' + rows.join('<br>') : '<br>No other horizontal wells yet.') +
    (sp.skipped.length ? '<br><span style="color:var(--muted)">Skipped (not horizontal): ' + sp.skipped.map(i => esc(project.wells[i].name)).join(', ') + '</span>' : '');
  $('#bLsApply').disabled = !rows.length;
}
['lsSp', 'lsSt', 'lsDir'].forEach(id => $('#' + id).addEventListener('input', renderLatSpace));
$('#lsRef').onchange = e => { lsRef = +e.target.value; renderLatSpace(); };
$('#bLsApply').onclick = () => {
  const { ri, sp } = lsPlan(); if (!sp.ok || !sp.assignments.length) return;
  if (!confirm('Replace the target positions of ' + sp.assignments.length + ' well(s) with copies of "' + project.wells[ri].name + '" targets at ' + $('#lsSp').value + ' ft spacing?')) return;
  const ref = project.wells[ri];
  sp.assignments.forEach(a => {
    const w = project.wells[a.index];
    w.targets = ref.targets.map(t => Object.assign(JSON.parse(JSON.stringify(t)), { n: t.n + a.n, e: t.e + a.e, tvd: t.tvd + a.tvd }));
  });
  selectWell(project.active);
};
function drawPad() {
  const c = $('#cvPad'); if (!c.offsetParent) return;
  const { g, w, h } = setupCanvas(c);
  const P = project.pad, slots = WP.padSlots(P, P.cols, P.rows, state.crs);
  const ink = css('--ink'), muted = css('--muted'), line = css('--line'), acc = css('--accent');
  const xs = slots.map(s => s.e), ys = slots.map(s => s.n), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const m = 40, sx = x1 - x0 > 1e-6 ? (w - 2 * m) / (x1 - x0) : Infinity, sy = y1 - y0 > 1e-6 ? (h - 2 * m) / (y1 - y0) : Infinity;
  const sc = Math.min(sx, sy, 6);
  const X = e => w / 2 + (e - (x0 + x1) / 2) * sc, Y = n => h / 2 - (n - (y0 + y1) / 2) * sc;
  // faint lines along rows and columns so the rotation is easy to see
  g.strokeStyle = line; g.lineWidth = 1; g.beginPath();
  for (let r = 1; r <= P.rows; r++) { const a = WP.padSlot(P, 1, r, state.crs), b = WP.padSlot(P, P.cols, r, state.crs); g.moveTo(X(a.e), Y(a.n)); g.lineTo(X(b.e), Y(b.n)); }
  for (let cc = 1; cc <= P.cols; cc++) { const a = WP.padSlot(P, cc, 1, state.crs), b = WP.padSlot(P, cc, P.rows, state.crs); g.moveTo(X(a.e), Y(a.n)); g.lineTo(X(b.e), Y(b.n)); }
  g.stroke();
  c._slots = [];
  g.textAlign = 'center';
  slots.forEach(sl => {
    const x = X(sl.e), y = Y(sl.n), well = wellAtSlot(sl.c, sl.r), wi = well ? project.wells.indexOf(well) : -1;
    const isActive = well === state, isRef = sl.c === P.refCol && sl.r === P.refRow;
    c._slots.push({ c: sl.c, r: sl.r, x, y });
    if (well) { g.fillStyle = PAD_COLORS[wi % PAD_COLORS.length]; g.fillRect(x - 8, y - 8, 16, 16); }
    else { g.setLineDash([3, 3]); g.strokeStyle = muted; g.lineWidth = 1; g.strokeRect(x - 8, y - 8, 16, 16); g.setLineDash([]); g.fillStyle = muted; g.fillText('+', x, y + 4); }
    if (isActive) { g.strokeStyle = ink; g.lineWidth = 2.5; g.strokeRect(x - 11, y - 11, 22, 22); }
    if (isRef) { g.fillStyle = css('--warn'); g.beginPath(); g.moveTo(x + 8, y - 8); g.lineTo(x + 16, y - 8); g.lineTo(x + 8, y); g.closePath(); g.fill(); }
    g.fillStyle = muted; g.fillText(sl.id, x, y - 14);
    if (well) { g.fillStyle = ink; const nm = (well.name || '').slice(0, 14); g.fillText(nm, x, y + 22); }
  });
  // north arrow and pad X axis
  const t = P.rot * D2R, ax = 26, ay = 28;
  g.strokeStyle = muted; g.fillStyle = muted; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(ax, ay + 12); g.lineTo(ax, ay - 12); g.stroke(); g.fillText('N', ax, ay - 16);
  g.strokeStyle = acc; g.fillStyle = acc;
  g.beginPath(); g.moveTo(ax + 22, ay); g.lineTo(ax + 22 + Math.cos(t) * 20, ay - Math.sin(t) * 20); g.stroke();
  g.fillText('X', ax + 22 + Math.cos(t) * 28, ay - Math.sin(t) * 28 + 4);
}
$('#cvPad').addEventListener('click', e => {
  const c = e.currentTarget, rc = c.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
  let best = null, bd = 20 * 20;
  (c._slots || []).forEach(s => { const d = (s.x - mx) ** 2 + (s.y - my) ** 2; if (d < bd) { bd = d; best = s; } });
  if (!best) return;
  const w = wellAtSlot(best.c, best.r);
  if (w) { if (w !== state) trySelectWell(project.wells.indexOf(w)); } else createWellAtSlot(best.c, best.r);
});

/* ================= file actions ================= */
$('#bSave').onclick = doSave;
$('#bOpen').onclick = () => $('#fileOpen').click();
const normName = x => String(x || '').trim().toLowerCase();
$('#fileOpen').onchange = async e => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  const items = [], bad = [];
  for (const f of files) {
    try { const p = migrateProject(JSON.parse(await f.text())); if (!p) throw new Error('not a project'); items.push({ name: f.name, p }); }
    catch (err) { bad.push(f.name + ' (' + err.message + ')'); }
  }
  if (!items.length) { await dlg('None of the selected files is a valid well plan:\n' + bad.join('\n'), [{ label: 'OK', value: 1, primary: true }]); return; }
  const pristine = project.wells.length === 1 && !project.refs.length && JSON.stringify(project.wells[0]) === JSON.stringify(DEFAULT());
  let base, queue = items.slice();
  if (pristine) { const f = queue.shift(); base = JSON.parse(JSON.stringify(f.p)); } else base = project;
  const incoming = [];
  queue.forEach(it => it.p.wells.forEach(w => incoming.push({ w: JSON.parse(JSON.stringify(w)), samePad: JSON.stringify(it.p.pad) === JSON.stringify(base.pad) })));
  const replaced = incoming.filter(x => base.wells.some(b => normName(b.name) === normName(x.w.name))).map(x => x.w.name);
  if (replaced.length && !(await dlg('These wells are already in the project and will be replaced by the file versions:\n' + replaced.join('\n'), [{ label: 'Cancel', value: false }, { label: 'Replace', value: true, primary: true }]))) return;
  let added = 0, repl = 0, firstIdx = pristine ? base.active : -1;
  incoming.forEach(x => {
    const k = base.wells.findIndex(b => normName(b.name) === normName(x.w.name));
    const taken = x.w.slot && base.wells.some((b, bi) => bi !== k && b.slot && b.slot.c === x.w.slot.c && b.slot.r === x.w.slot.r);
    if (!x.samePad || taken) x.w.slot = null;
    if (k >= 0) { base.wells[k] = x.w; repl++; } else { base.wells.push(x.w); added++; if (firstIdx < 0) firstIdx = base.wells.length - 1; }
  });
  queue.flatMap(it => it.p.refs).forEach(r => { const k = base.refs.findIndex(b => normName(b.name) === normName(r.name)); if (k >= 0) base.refs[k] = r; else base.refs.push(r); });
  if (firstIdx >= 0) base.active = firstIdx;
  project = base; state = project.wells[project.active]; wellSig = ''; P2.plan.view = P2.sec.view = P2.apPlan.view = null; init();
  markAllSaved(); snoozeSig = null;
  if (items.length > 1 || bad.length || repl) await dlg('Opened ' + items.length + ' file' + (items.length === 1 ? '' : 's') + '. The project now has ' + project.wells.length + ' wells' + (repl ? ' (' + repl + ' replaced)' : '') + '.' + (bad.length ? '\n\nSkipped:\n' + bad.join('\n') : ''), [{ label: 'OK', value: 1, primary: true }]);
};
$('#bNew').onclick = async () => {
  if (!(await confirmLeave('starting a new project', true))) return;
  project = newProject(); state = project.wells[0]; wellSig = ''; P2.plan.view = P2.sec.view = P2.apPlan.view = null; init();
  markAllSaved(); snoozeSig = null;
};

function init() {
  histOf(state); LOGZ.mode = 0; LOGZ.start = null; LOGZ.lo = LOGZ.hi = null;
  writeInputs();
  $('#surfCoord').innerHTML = cwHtml('surface'); $('#padRef').innerHTML = cwHtml('pad');
  applyAllSlots();
  cwFill($('#surfCoord .cw')); cwFill($('#padRef .cw'));
  renderTargets(); renderTops(); renderOffsetForms();
  $('#minSep').value = state.minSep;
  M = { survey: null };
  recalc();
}
init();
markAllSaved();

/* Targets, Design and Formation tops fold up; each remembers whether it was left open. Buttons in a heading do not toggle it. */
['tgtF', 'dsgF', 'topF'].forEach(id => {
  const set = (open, save) => {
    $('#' + id + 'Body').hidden = !open; $('#' + id + 'Arrow').textContent = open ? '▾' : '▸'; $('#' + id + 'Head').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (save) { try { localStorage.setItem('wellplanner.' + id + 'Open', open ? '1' : '0'); } catch (e) {} }
  };
  const head = $('#' + id + 'Head');
  head.onclick = e => { if (e.target.closest('button')) return; set($('#' + id + 'Body').hidden, true); };
  head.onkeydown = e => { if (e.target === head && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); set($('#' + id + 'Body').hidden, true); } };
  let o = true; try { o = localStorage.getItem('wellplanner.' + id + 'Open') !== '0'; } catch (e) {} set(o, false);
});
/* short summaries in the folded headings */
function foldCounts() {
  const nt = state.targets ? state.targets.length : 0, np = state.tops ? state.tops.length : 0;
  $('#tgtCount').textContent = nt ? nt + ' target' + (nt === 1 ? '' : 's') : '';
  $('#topCount').textContent = np ? np + ' top' + (np === 1 ? '' : 's') : '';
}
