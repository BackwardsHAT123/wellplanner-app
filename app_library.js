'use strict';
/* ================= Plan library =================
 * The library is a folder of .wellplan.json files on the user's disk (Chrome / Edge folder access). The files stay the
 * record: the panel lists every well in them, searchable by name, API, county, T/R/S and formation, opens them, and Save
 * writes straight back into the folder. The folder handle is kept in IndexedDB so the next visit only has to reconnect.
 * Search fields: county, formation and T/R/S are typed on the Well panel; left blank, county comes from the API county
 * code, formation from the top the last target sits in, and T/R/S from the loaded PLSS sections. Save writes the
 * values in use into the file as `lib`, so the library can show them without loading sections. */

/* Wyoming county FIPS codes, which are the county part of a 49-xxx API number */
const WY_COUNTY = { '001': 'Albany', '003': 'Big Horn', '005': 'Campbell', '007': 'Carbon', '009': 'Converse', '011': 'Crook', '013': 'Fremont', '015': 'Goshen',
  '017': 'Hot Springs', '019': 'Johnson', '021': 'Laramie', '023': 'Lincoln', '025': 'Natrona', '027': 'Niobrara', '029': 'Park', '031': 'Platte', '033': 'Sheridan',
  '035': 'Sublette', '037': 'Sweetwater', '039': 'Teton', '041': 'Uinta', '043': 'Washakie', '045': 'Weston' };
function countyFromApi(api) {
  const m = /^\s*49\D?(\d{3})/.exec(String(api || ''));
  return m && WY_COUNTY[m[1]] ? WY_COUNTY[m[1]] : '';
}
/* the formation the well is aimed at: the deepest top above the last target, at the target's position (dip applied) */
function formationAuto(w) {
  const T = w.targets || [], t = T[T.length - 1]; if (!t || !Array.isArray(w.tops)) return '';
  let best = null, bt = -Infinity;
  w.tops.forEach(tp => {
    if (!tp || !tp.name || !isFinite(tp.tvd)) return;
    const z = WP.topTvdAt(tp, t.n, t.e, w.surface);
    if (z <= t.tvd + 0.5 && z > bt) { bt = z; best = tp; }
  });
  return best ? best.name : '';
}
/* T/R/S of the sections the active wellbore passes through, in drilling order: "T45N R72W S13, S24" (needs sections loaded) */
function trsAuto() {
  if (!M.survey || !isLL() || !SEC.cache.size) return '';
  const cr = secNear().filter(x => x.foot > 0).sort((a, b) => a.spans[0][0] - b.spans[0][0]);
  const groups = [];                                        // consecutive sections in the same township share one T/R
  cr.forEach(x => {
    const m = /^[A-Z]{2}\d{2}(\d{3})\d([NS])(\d{3})\d([EW])\d$/.exec(String(x.s.id || ''));
    const tr = m ? 'T' + parseInt(m[1], 10) + m[2] + ' R' + parseInt(m[3], 10) + m[4] : '', sec = 'S' + parseInt(x.s.sec, 10);
    const g = groups[groups.length - 1];
    if (g && g.tr === tr) { if (!g.secs.includes(sec)) g.secs.push(sec); } else groups.push({ tr, secs: [sec] });
  });
  return groups.map(g => (g.tr ? g.tr + ' ' : '') + g.secs.join(', ')).join('; ');
}
/* the search values in use for a well: typed, else automatic, else what was saved in its file */
function libFields(w) {
  const saved = w.lib || {};
  return {
    county: String(w.county || '').trim() || countyFromApi(w.api) || saved.county || '',
    formation: String(w.formation || '').trim() || formationAuto(w) || saved.formation || '',
    trs: String(w.trs || '').trim() || (w === state ? trsAuto() : '') || saved.trs || ''
  };
}
/* Well panel: show the automatic values as placeholders, so a blank box still says what will be used */
function renderLibHints() {
  const set = (id, v, what) => { const el = $('#' + id); if (el) el.placeholder = v ? v + ' (automatic)' : what; };
  set('inCounty', countyFromApi(state.api) || (state.lib && state.lib.county), 'from the API number');
  set('inFormation', formationAuto(state) || (state.lib && state.lib.formation), 'from the tops');
  set('inTrs', trsAuto() || (state.lib && state.lib.trs), 'e.g. T45N R72W S13');
}
$('#bTrsFill').onclick = async () => {
  if (!isLL()) { await dlg('T/R/S needs a State Plane coordinate system (a local grid has no lat/long).', [{ label: 'OK', value: 1, primary: true }]); return; }
  SEC.want = true; const b = $('#bTrsFill'); b.disabled = true; b.textContent = 'Loading…';
  try { await ensureSections(); } finally { b.disabled = false; b.textContent = 'From sections'; }
  const v = trsAuto();
  if (!v) { await dlg('No PLSS sections found for this wellbore' + (SEC.msg ? ': ' + SEC.msg : '') + '. Type the T/R/S instead.', [{ label: 'OK', value: 1, primary: true }]); return; }
  state.trs = v; writeInputs(); recalc();
};

/* ---- folder handle, kept in IndexedDB between visits (idb() is in app_uncertainty.js) ---- */
const idbGet = k => idb('readonly', s => s.get(k)), idbSet = (k, v) => idb('readwrite', s => s.put(v, k));

const LIB = { dir: null, ok: false, rows: [], bad: [], cache: new Map(), q: '', field: 'all', sort: 'name', desc: false, scanning: false };
const LIB_CAN = typeof window.showDirectoryPicker === 'function';
const FILEOF = new WeakMap();                     // well -> {handle, path}: the library file it was opened from or saved to

async function libPerm(ask) {
  if (!LIB.dir) return false;
  const o = { mode: 'readwrite' };
  try { if (await LIB.dir.queryPermission(o) === 'granted') return true; return ask ? await LIB.dir.requestPermission(o) === 'granted' : false; } catch (e) { return false; }
}
async function libChoose() {
  let h; try { h = await window.showDirectoryPicker({ id: 'wellplans', mode: 'readwrite' }); } catch (e) { return; }   // cancelled
  LIB.dir = h; LIB.cache.clear(); try { await idbSet('libDir', h); } catch (e) {}
  LIB.ok = true; await libScan();
}
async function libReconnect() { LIB.ok = await libPerm(true); if (LIB.ok) await libScan(); else renderLib(); }

/* one library row per well in each file; files are re-read only when they change */
async function libScan() {
  if (!LIB.dir || !LIB.ok || LIB.scanning) return;
  LIB.scanning = true; renderLib();
  const rows = [], bad = [], seen = new Set();
  async function walk(dir, prefix, depth) {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (h.kind === 'directory') { if (depth < 3) await walk(h, prefix + name + '/', depth + 1); continue; }
      if (!/\.json$/i.test(name)) continue;
      const path = prefix + name; seen.add(path);
      try {
        const f = await h.getFile(); let c = LIB.cache.get(path);
        if (!c || c.mod !== f.lastModified) { const p = JSON.parse(await f.text()); c = { mod: f.lastModified, saved: Date.parse(p && p.savedAt) || f.lastModified, on: (p && p.savedOn) || '', wells: libReadWells(p) }; LIB.cache.set(path, c); }
        if (!c.wells) continue;                                  // a JSON file that is not a well plan
        c.wells.forEach(w => rows.push(Object.assign({ path, handle: h, saved: c.saved, on: c.on, mod: f.lastModified, inFile: c.wells.length }, w)));
      } catch (e) { bad.push(path); }
    }
  }
  try { await walk(LIB.dir, '', 0); } catch (e) { LIB.ok = false; }
  [...LIB.cache.keys()].forEach(k => { if (!seen.has(k)) LIB.cache.delete(k); });
  LIB.rows = rows; LIB.bad = bad; LIB.scanning = false; renderLib();
}
/* the search values of each well in a parsed file (null when the file is not a well plan) */
function libReadWells(p) {
  const ws = p && Array.isArray(p.wells) ? p.wells : p && Array.isArray(p.targets) ? [p] : null;
  if (!ws) return null;
  return ws.map(w => {
    const f = libFields(Object.assign({}, w, { lib: w.lib || {} }));
    return { name: String(w.name || 'Unnamed'), api: String(w.api || ''), county: f.county, trs: f.trs, formation: f.formation, type: w.d && w.d.type || '' };
  });
}

/* ---- search and list ---- */
const LIB_COLS = [['name', 'Well'], ['county', 'County'], ['trs', 'T/R/S'], ['formation', 'Formation'], ['saved', 'Saved']];
const libNorm = s => String(s || '').toLowerCase().replace(/[‐-―]/g, '-');
function libMatch(r) {
  const words = libNorm(LIB.q).split(/[\s,;]+/).filter(Boolean); if (!words.length) return true;
  const hay = LIB.field === 'all' ? [r.name, r.api, r.county, r.trs, r.formation].join(' | ') : r[LIB.field];
  const h = libNorm(hay), hd = h.replace(/\D/g, '');
  // every word must appear; an all-digit word also matches the API with its dashes removed (4900580160 finds 49-005-80160)
  return words.every(wd => h.includes(wd) || (/^\d{5,}$/.test(wd) && hd.includes(wd)));
}
function renderLib() {
  const st = $('#libState'), list = $('#libList'); if (!st) return;
  $('#libBar').hidden = !(LIB.dir && LIB.ok);
  if (!LIB_CAN) { st.innerHTML = 'The plan library needs Chrome or Edge (this browser cannot open a folder on your disk). Save and Open… still work with single files.'; list.innerHTML = ''; return; }
  if (!LIB.dir) { st.innerHTML = 'Choose the folder that holds your plans (for example your <b>wellplans</b> folder). Every .wellplan.json in it, and in its subfolders, is listed here.<br><button class="primary small" id="bLibChoose" style="margin-top:8px">Choose plans folder…</button>'; list.innerHTML = ''; return; }
  if (!LIB.ok) { st.innerHTML = `Folder <b>${esc(LIB.dir.name)}</b>: the browser needs your OK to use it again.<br><button class="primary small" id="bLibReconnect" style="margin-top:8px">Reconnect</button> <button class="small" id="bLibChoose" style="margin-top:8px">Choose another folder…</button>`; list.innerHTML = ''; return; }
  const rows = LIB.rows.filter(libMatch), k = LIB.sort, dir = LIB.desc ? -1 : 1;
  rows.sort((a, b) => (k === 'saved' ? a.saved - b.saved : String(a[k]).localeCompare(String(b[k]), undefined, { numeric: true, sensitivity: 'base' })) * dir || a.name.localeCompare(b.name, undefined, { numeric: true }));
  st.innerHTML = `Folder <b>${esc(LIB.dir.name)}</b> · ${LIB.scanning ? 'reading…' : `${rows.length === LIB.rows.length ? '' : rows.length + ' of '}${LIB.rows.length} well${LIB.rows.length === 1 ? '' : 's'}`}` +
    (LIB.bad.length ? ` · <span style="color:var(--warn)" title="${esc(LIB.bad.join('\n'))}">${LIB.bad.length} file${LIB.bad.length === 1 ? '' : 's'} could not be read</span>` : '');
  const open = new Set(project.wells.map(w => FILEOF.get(w)).filter(Boolean).map(s => s.path));
  const day = t => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  list.innerHTML = !LIB.rows.length ? '<div class="hint" style="padding:8px 2px">No well plans in this folder yet. Save puts the current well here.</div>' : !rows.length ? '<div class="hint" style="padding:8px 2px">Nothing matches the search.</div>' :
    `<table class="libtbl"><thead><tr>${LIB_COLS.map(([c, t]) => `<th data-libsort="${c}" class="${c === k ? 'on' : ''}" title="Sort by ${t.toLowerCase()}">${t}${c === k ? (LIB.desc ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead><tbody>` +
    rows.map(r => `<tr data-libopen="${esc(r.path)}" title="Open ${esc(r.path)}${r.inFile > 1 ? ' (all ' + r.inFile + ' wells in the file)' : ''}"${open.has(r.path) ? ' class="isopen"' : ''}><td><b>${esc(r.name)}</b>${r.api ? `<div class="mut">${esc(r.api)}</div>` : ''}</td><td>${esc(r.county)}</td><td>${esc(r.trs)}</td><td>${esc(r.formation)}</td><td class="mut" style="white-space:nowrap">${day(r.saved)}</td></tr>`).join('') + '</tbody></table>';
}
$('#panel-library').addEventListener('click', async e => {
  const t = e.target;
  if (t.closest('#bLibChoose')) return libChoose();
  if (t.closest('#bLibReconnect')) return libReconnect();
  if (t.closest('#bLibRefresh')) return libScan();
  const s = t.closest('[data-libsort]');
  if (s) { const c = s.dataset.libsort; if (LIB.sort === c) LIB.desc = !LIB.desc; else { LIB.sort = c; LIB.desc = c === 'saved'; } renderLib(); return; }
  const o = t.closest('[data-libopen]'); if (o) libOpen(o.dataset.libopen);
});
$('#libQ').addEventListener('input', e => { LIB.q = e.target.value; renderLib(); });
$('#libField').onchange = e => { LIB.field = e.target.value; renderLib(); };

/* open a library file the same way Open… does (its wells join the project), and remember which file each well came from */
async function libOpen(path) {
  const r = LIB.rows.find(x => x.path === path); if (!r) return;
  let p, mod; try { const f = await r.handle.getFile(); mod = f.lastModified; p = migrateProject(JSON.parse(await f.text())); if (!p) throw new Error('not a well plan'); }
  catch (err) { await dlg('Could not open ' + path + ': ' + err.message, [{ label: 'OK', value: 1, primary: true }]); return; }
  await openProjects([{ name: path, p, src: { handle: r.handle, path, mod } }]);
  renderLib();
}

/* ---- Save into the folder ---- */
/* returns true when written; false means the caller should fall back to a download (no folder, or no permission) */
async function libSave(w, text) {
  if (!LIB.dir || !(await libPerm(true))) return false;
  LIB.ok = true;
  let src = FILEOF.get(w), asNew = false;
  if (src) { try { await src.handle.getFile(); } catch (e) { src = null; } }   // file moved or deleted since: save as new
  if (src && src.mod) {
    const f = await src.handle.getFile();
    if (f.lastModified !== src.mod) {                        // changed in the folder since it was opened or last saved here
      let info = ''; try { const p = JSON.parse(await f.text()); info = p.savedAt ? ` (saved ${new Date(p.savedAt).toLocaleString()}${p.savedOn ? ' on ' + p.savedOn : ''})` : ''; } catch (e) {}
      const c = await dlg(`${src.path} in the plans folder has changed since you opened it here${info}, for example by importing a package from your other computer.\n\nReplace replaces that version with the one on screen. Save as new file keeps both. Cancel, then open the well again from the library, to work on the folder version.`,
        [{ label: 'Cancel', value: 'cancel' }, { label: 'Save as new file', value: 'new' }, { label: 'Replace', value: 'replace', primary: true }]);
      if (c === 'cancel') return true;
      if (c === 'new') { src = null; asNew = true; }
    }
  }
  if (!src) {
    const base = (w.name || 'well').replace(/[^\w.-]+/g, '_');
    let name = base + '.wellplan.json', n = 1;
    const exists = async nm => { try { await LIB.dir.getFileHandle(nm); return true; } catch (e) { return false; } };
    if (asNew) { while (await exists(name)) { n++; name = `${base}_${n}.wellplan.json`; } }
    else if (await exists(name)) {
      const c = await dlg(`${name} is already in the plans folder and was not opened from it in this session.\nReplace it with "${w.name}", or save this well as a new file?`, [{ label: 'Cancel', value: 'cancel' }, { label: 'Save as new file', value: 'new' }, { label: 'Replace', value: 'replace', primary: true }]);
      if (c === 'cancel') return true;
      if (c === 'new') { do { n++; name = `${base}_${n}.wellplan.json`; } while (await exists(name)); }
    }
    src = { handle: await LIB.dir.getFileHandle(name, { create: true }), path: name };
  }
  const wr = await src.handle.createWritable(); await wr.write(text); await wr.close();
  src = Object.assign({}, src, { mod: (await src.handle.getFile()).lastModified });
  FILEOF.set(w, src);
  libToast('Saved to ' + LIB.dir.name + '/' + src.path);
  libScan();
  return true;
}
function libToast(msg) {
  const el = $('#saveToast'); if (!el) return;
  el.textContent = msg; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, 2600);
}

/* start: reconnect silently when the browser still allows it, otherwise the panel offers Reconnect */
(async () => {
  if (!LIB_CAN) { renderLib(); return; }
  try { LIB.dir = await idbGet('libDir') || null; } catch (e) { LIB.dir = null; }
  LIB.ok = await libPerm(false);
  renderLib(); if (LIB.ok) libScan();
})();
