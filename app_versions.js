'use strict';
/* Plan versions: a well can hold several alternative plans (targets, path design) so they can be moved and compared before one is
 * picked for drilling. The well object itself stays the working copy of the active version; every other version keeps a snapshot
 * of the plan fields. Surface location, slot, logs, tops and actual survey belong to the well, not to a version. */
const VER_FIELDS = ['targets', 'lat', 'd', 'mode', 'manual', 'vsAzi', 'maxDls', 'minSep'];
const vClone = o => JSON.parse(JSON.stringify(o));
const vSnap = w => { const s = {}; VER_FIELDS.forEach(k => { if (w[k] !== undefined) s[k] = vClone(w[k]); }); return s; };
function syncVer(w) { if (!w || !w.versions) return; const v = w.versions.find(x => x.id === w.ver); if (v) v.snap = vSnap(w); }
function loadSnap(w, snap) { VER_FIELDS.forEach(k => { if (k in snap) w[k] = vClone(snap[k]); }); }
const verName = (w, v) => (v.name || 'Version ' + v.id) + (w.verPick === v.id ? ' ★' : '');
function resetViews() { P2.plan.view = P2.sec.view = P2.apPlan.view = null; }

function switchVer(id) {
  const w = state; if (!w.versions || id === w.ver) return;
  const v = w.versions.find(x => x.id === id); if (!v) return;
  syncVer(w); loadSnap(w, v.snap); w.ver = id; resetViews(); init(); autosave();
}
function newVer(name) {
  const w = state;
  if (!w.versions) { w.versions = [{ id: 1, name: 'Version 1', note: '', snap: vSnap(w) }]; w.ver = 1; }
  syncVer(w);
  const id = Math.max(...w.versions.map(v => v.id)) + 1;
  w.versions.push({ id, name: name || 'Version ' + id, note: '', snap: vSnap(w) });
  w.ver = id; autosave(); renderVers();
}
async function delVer() {
  const w = state; if (!w.versions || w.versions.length < 2) return;
  const v = w.versions.find(x => x.id === w.ver);
  const r = await dlg('Delete "' + (v.name || 'Version ' + v.id) + '" from this well?\nThe other versions are kept. Undo (Cmd/Ctrl+Z) brings it back until you reload.', [{ label: 'Cancel', value: 'c' }, { label: 'Delete version', value: 'd', primary: true }]);
  if (r !== 'd') return;
  const i = w.versions.indexOf(v), rest = w.versions.filter(x => x !== v), next = rest[Math.min(i, rest.length - 1)];
  w.versions = rest; if (w.verPick === v.id) delete w.verPick;
  loadSnap(w, next.snap); w.ver = next.id;
  if (w.versions.length === 1) { delete w.versions; delete w.ver; delete w.verPick; }   // back to a plain single plan
  resetViews(); init(); autosave();
}
const VMEM = new WeakMap();
function verModel(w, v) {
  if (v.id === w.ver) return modelFor(w);
  const sig = JSON.stringify([v.snap, w.surface, w.kb, w.crs]); let c = VMEM.get(v);
  if (!c || c.sig !== sig) { const o = Object.assign({}, w, vClone(v.snap)); delete o.versions; c = { sig, m: modelFor(o) }; VMEM.set(v, c); }
  return c.m;
}
function verStats(m) {
  if (!m || m.err || !m.survey) return null;
  const last = m.survey[m.survey.length - 1], L = m.markers.find(x => x.label === 'Landing');
  return { md: last.md, tvd: last.tvd, lat: L ? last.md - L.row.md : null, dls: m.maxDls, kop: isFinite(m.kopMd) ? m.kopMd : null, notes: (m.notes || []).length };
}
function renderVers() {
  const box = $('#verBox'); if (!box) return;
  const w = state, vs = w.versions || [], act = vs.find(x => x.id === w.ver);
  $('#verSel').innerHTML = vs.length ? vs.map(v => `<option value="${v.id}"${v.id === w.ver ? ' selected' : ''}>${esc(verName(w, v))}</option>`).join('') : '<option>Current plan</option>';
  $('#verSel').disabled = vs.length < 2;
  $('#bVerDel').hidden = vs.length < 2; $('#bVerName').hidden = !act; $('#bVerPick').hidden = !act;
  $('#bVerPick').textContent = act && w.verPick === act.id ? '★ Selected' : '☆ Select';
  $('#bVerPick').classList.toggle('primary', !!(act && w.verPick === act.id));
  const note = $('#verNote'); note.hidden = !act; if (act && document.activeElement !== note) note.value = act.note || '';
  const cmp = $('#verCmp'); cmp.hidden = vs.length < 2; if (vs.length < 2) return;
  const f = (x, d = 0) => x == null ? '–' : fmt(x, d);
  cmp.innerHTML = '<table class="vtbl"><tr><th class="l">Version</th><th>TD MD</th><th>Lateral</th><th>Max DLS</th></tr>' + vs.map(v => {
    const s = verStats(verModel(w, v));
    return `<tr data-vid="${v.id}" class="${v.id === w.ver ? 'on' : ''}" title="${esc(v.note || 'Click to switch to this version')}"><td class="l">${esc(verName(w, v))}</td>` + (s ? `<td>${f(s.md)}</td><td>${f(s.lat)}</td><td>${f(s.dls, 1)}</td>` : '<td colspan="3" style="color:var(--warn,#d9a032)">plan error</td>') + '</tr>';
  }).join('') + '</table>';
}
$('#verSel').onchange = e => switchVer(+e.target.value);
$('#bVerNew').onclick = () => { const n = (state.versions ? Math.max(...state.versions.map(v => v.id)) : 1) + 1, name = prompt('Name for the new version (a copy of the current plan):', 'Version ' + n); if (name === null) return; newVer(name.trim()); };
$('#bVerName').onclick = () => { const v = state.versions.find(x => x.id === state.ver), name = prompt('Version name:', v.name || ''); if (name === null) return; v.name = name.trim() || v.name; autosave(); renderVers(); };
$('#bVerPick').onclick = () => { if (state.verPick === state.ver) delete state.verPick; else state.verPick = state.ver; autosave(); renderVers(); };
$('#bVerDel').onclick = delVer;
$('#verNote').onchange = e => { const v = state.versions.find(x => x.id === state.ver); if (v) { v.note = e.target.value; autosave(); renderVers(); } };
$('#verCmp').onclick = e => { const r = e.target.closest('[data-vid]'); if (r) switchVer(+r.dataset.vid); };
