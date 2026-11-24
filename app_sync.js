'use strict';
/* ================= Work / home packages =================
 * Owns: syncName, the Export package / Import package buttons on the Plan library panel. Uses: LIB, FILEOF, libScan,
 * libOpen (library); saveWell, dirtyWells, openProjects, dlg (project); migrateProject, withLogs (main).
 * For two computers that cannot share a synced folder: Export package writes the chosen plan files (and the browser-only
 * settings) into one compressed file to email to yourself; Import package on the other computer compares each plan with
 * the copy already there, using the save time stamped inside each file (savedAt), and writes the newer one. */

const SYNC_KEY = { name: 'wellplanner.computer', last: 'wellplanner.lastExport', lastIn: 'wellplanner.lastImport' };
/* browser-only settings that travel in a package (the rest are panel and help preferences) */
const SYNC_SETTINGS = [
  ['wellplanner.errTool', 'Survey tool for the separation factor'], ['wellplanner.errSf', 'Separation-factor limit'],
  ['wellplanner.errEll', 'Error ellipses'], ['wellplanner.padClose', 'Pad wells: allowed close-in'],
  ['wellplanner.setback', 'Section setback'], ['wellplanner.sections', 'Show PLSS sections'], ['wellplanner.secOnly', 'Only crossed sections'],
  ['wellplanner.names', 'Well names on plots'], ['wellplanner.logTops', 'Tops on the log tracks'], ['wellplanner.verOverlay', 'Version overlays'],
  ['wellplanner.stoTrue', 'State wells: true north azimuths'], ['wellplanner.wallLogo', 'Wall plot logo']];

const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
/* this computer's name (typed on the Plan library panel), stamped into saved files and packages */
function syncName() { return String(lsGet(SYNC_KEY.name) || '').trim(); }
const syncWhen = t => t ? new Date(t).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '–';
const syncFileSafe = s => String(s || '').replace(/[^\w.-]+/g, '_');

/* gzip through the browser's own CompressionStream (Chrome, Edge, Safari 16.4+, Firefox 113+) */
const syncGzip = str => new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
const syncGunzip = buf => new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();

/* the save time of a plan file's text: savedAt inside it, else the time given (the file's modified time) */
function syncSavedAt(text, fallback) {
  try { const p = JSON.parse(text); if (p && p.savedAt && isFinite(Date.parse(p.savedAt))) return { at: Date.parse(p.savedAt), on: p.savedOn || '', p }; return { at: fallback || 0, on: '', p }; }
  catch (e) { return { at: fallback || 0, on: '', p: null }; }
}
/* a file without a savedAt (saved before packages existed) gets its modified time, so the other computer can compare it */
function syncStamp(text, at) {
  const s = syncSavedAt(text, at); if (!s.p) return text;
  if (s.p.savedAt) return text;
  return WP.compactJson(Object.assign({ v: s.p.v, savedAt: new Date(at).toISOString() }, s.p));
}

/* a pop-up with any HTML body; resolves with the clicked button's value, the overlay element is passed to onShow */
function syncModal(title, body, buttons, onShow) {
  return new Promise(res => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = `<div role="dialog" aria-label="${esc(title)}" style="background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:16px 18px;max-width:760px;width:100%;max-height:calc(100vh - 32px);display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.35)">
      <h3 style="margin:0 0 6px">${esc(title)}</h3><div style="overflow:auto;flex:1;min-height:0">${body}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">${buttons.map((b, k) => `<button data-k="${k}"${b.primary ? ' class="primary"' : ''}>${esc(b.label)}</button>`).join('')}</div></div>`;
    ov.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; const v = buttons[+b.dataset.k].value; const keep = typeof v === 'function' ? v(ov) : v; ov.remove(); res(keep); });
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') { ov.remove(); res(null); } });
    document.body.appendChild(ov); if (onShow) onShow(ov);
    const f = ov.querySelector('.primary') || ov.querySelector('button'); if (f) f.focus();
  });
}
const syncTh = (t, r) => `<th style="text-align:${r ? 'right' : 'left'};padding:4px 8px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--panel)">${t}</th>`;
const SYNC_TD = 'style="padding:4px 8px;border-bottom:1px solid var(--line);vertical-align:top"';

/* ---------------- Export ---------------- */
/* the plan files that can go in a package: every file in the library folder, or (no folder) the wells open in the project */
async function syncSources() {
  if (LIB.dir && LIB.ok) {
    await libScan();
    const by = new Map();
    LIB.rows.forEach(r => { const x = by.get(r.path) || { path: r.path, handle: r.handle, saved: r.saved, on: r.on, mod: r.mod, names: [] }; x.names.push(r.name); by.set(r.path, x); });
    return [...by.values()];
  }
  return project.wells.map(w => ({ path: syncFileSafe(w.name || 'well') + '.wellplan.json', well: w, saved: Date.now(), on: syncName(), names: [w.name || 'Unnamed'] }));
}
async function syncExport() {
  const dirty = dirtyWells();
  if (dirty.length) {
    const c = await dlg('These wells have changes that are not saved yet:\n' + dirty.map(w => w.name || 'Unnamed').join('\n') + '\n\nSave them first, so the package has the latest version?', [{ label: 'Cancel', value: 'cancel' }, { label: 'Export without saving', value: 'skip' }, { label: 'Save, then export', value: 'save', primary: true }]);
    if (c === 'cancel') return;
    if (c === 'save') for (const w of dirty) await saveWell(w);
  }
  const src = await syncSources();
  if (!src.length) { await dlg('There are no plans to export yet. Save a well first.', [{ label: 'OK', value: 1, primary: true }]); return; }
  const last = Date.parse(lsGet(SYNC_KEY.last) || '') || 0, lastIn = Date.parse(lsGet(SYNC_KEY.lastIn) || '') || 0;
  // tick what was saved here since the last export: a file last saved on the other computer (savedOn) came in by import;
  // without names, a file written by the last import is left out by its modified time
  const me = syncName();
  const pre = s => (!last || s.saved > last) && (s.on && me ? s.on === me : !(lastIn && s.mod && Math.abs(s.mod - lastIn) < 120000 && s.saved < lastIn));
  src.sort((a, b) => b.saved - a.saved);
  const lib = !!(LIB.dir && LIB.ok);
  const body = `<label class="f" style="max-width:320px;margin:0 0 8px">This computer's name (shown on the other computer, e.g. Work or Home)<input id="sxName" value="${esc(me)}" placeholder="e.g. Work"></label>
    <div class="hint" style="margin:0 0 8px">${lib ? `Plans in the folder <b>${esc(LIB.dir.name)}</b>.` : 'No plans folder is connected, so the package holds the wells open in this project.'} ${last ? `Ticked: saved since the last export (${syncWhen(last)}).` : 'No export from this computer yet: all are ticked.'} Email the file to yourself and use <b>Import package…</b> on the other computer.</div>
    <div style="margin:0 0 6px"><button class="small" data-sx="all">Tick all</button> <button class="small" data-sx="none">Tick none</button> <button class="small" data-sx="new">Only changed since last export</button></div>
    <table style="border-collapse:collapse;font-size:13px;width:100%"><thead><tr>${syncTh('')}${syncTh('Well')}${syncTh('File')}${syncTh('Saved', 1)}</tr></thead><tbody>` +
    src.map((s, i) => `<tr><td ${SYNC_TD}><input type="checkbox" data-sxi="${i}"${pre(s) ? ' checked' : ''}></td><td ${SYNC_TD}><b>${esc(s.names.join(', '))}</b></td><td ${SYNC_TD} class="mut">${esc(s.path)}</td><td ${SYNC_TD} style="text-align:right;white-space:nowrap">${syncWhen(s.saved)}</td></tr>`).join('') +
    `</tbody></table>
    <label class="chk" style="margin-top:10px"><input type="checkbox" id="sxSet" checked><span>Include this computer's settings (clearance limits, setback, wall plot logo and display switches)</span></label>
    <label class="chk"><input type="checkbox" id="sxGz" checked><span>Compress (much smaller attachment; untick if your email refuses .gz files)</span></label>
    <div class="hint" id="sxCount" style="margin-top:6px"></div>`;
  const count = ov => { const n = ov.querySelectorAll('[data-sxi]:checked').length; ov.querySelector('#sxCount').textContent = n + ' of ' + src.length + ' plan file' + (src.length === 1 ? '' : 's') + ' ticked.'; };
  const pick = await syncModal('Export package', body, [{ label: 'Cancel', value: null }, { label: 'Export', primary: true, value: ov => ({ name: ov.querySelector('#sxName').value.trim(), idx: [...ov.querySelectorAll('[data-sxi]:checked')].map(c => +c.dataset.sxi), set: ov.querySelector('#sxSet').checked, gz: ov.querySelector('#sxGz').checked }) }], ov => {
    count(ov);
    ov.addEventListener('change', () => count(ov));
    ov.addEventListener('click', e => { const b = e.target.closest('[data-sx]'); if (!b) return; ov.querySelectorAll('[data-sxi]').forEach(c => { c.checked = b.dataset.sx === 'all' || (b.dataset.sx === 'new' && pre(src[+c.dataset.sxi])); }); count(ov); });
  });
  if (!pick) return;
  lsSet(SYNC_KEY.name, pick.name || null);
  if (!pick.idx.length && !pick.set) { await dlg('Nothing was ticked, so there is nothing to export.', [{ label: 'OK', value: 1, primary: true }]); return; }
  const files = [], bad = [];
  for (const i of pick.idx) {
    const s = src[i];
    try {
      let text;
      if (s.handle) { const f = await s.handle.getFile(); text = syncStamp(await f.text(), f.lastModified); }
      else text = WP.compactJson({ v: 2, savedAt: new Date().toISOString(), savedOn: syncName(), pad: project.pad, wells: [Object.assign({}, withLogs(s.well), { lib: libFields(s.well) })], active: 0, refs: project.refs.map(withLogs) });
      const st = syncSavedAt(text, s.saved);
      files.push({ path: s.path, names: s.names, savedAt: new Date(st.at).toISOString(), savedOn: st.on, text });
    } catch (e) { bad.push(s.path + ': ' + e.message); }
  }
  const settings = {};
  if (pick.set) SYNC_SETTINGS.forEach(([k]) => { const v = lsGet(k); if (v !== null) settings[k] = v; });
  const now = new Date(), from = syncName();
  const pkg = JSON.stringify({ kind: 'wellplanner-package', v: 1, made: now.toISOString(), from, files, settings: pick.set ? settings : null });
  const stamp = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + '_' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
  const name = `wellplans_${syncFileSafe(from || 'export')}_${stamp}.wellpack${pick.gz ? '.gz' : '.json'}`;
  const blob = pick.gz ? await syncGzip(pkg) : new Blob([pkg], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  lsSet(SYNC_KEY.last, now.toISOString()); renderSync();
  const mb = blob.size / 1048576;
  await dlg(`Downloaded ${name} (${mb >= 1 ? mb.toFixed(1) + ' MB' : Math.max(1, Math.round(blob.size / 1024)) + ' KB'}): ${files.length} plan file${files.length === 1 ? '' : 's'}${pick.set ? ' and the settings' : ''}.` +
    (mb > 20 ? '\n\nThat is larger than many email systems accept (often 20-25 MB). Export fewer plans at a time; well logs make files large.' : '') +
    (bad.length ? '\n\nCould not read:\n' + bad.join('\n') : '') + '\n\nEmail it to yourself, then on the other computer use Plan library → Import package….', [{ label: 'OK', value: 1, primary: true }]);
}

/* ---------------- Import ---------------- */
async function syncReadPackage(file) {
  const buf = await file.arrayBuffer(), b = new Uint8Array(buf.slice(0, 2));
  const text = b[0] === 0x1f && b[1] === 0x8b ? await syncGunzip(buf) : new TextDecoder().decode(buf);
  const pkg = JSON.parse(text);
  if (!pkg || pkg.kind !== 'wellplanner-package' || !Array.isArray(pkg.files)) throw new Error('this is not a package made with Export package');
  return pkg;
}
/* where an incoming file lands in the library: the same path, else the file that holds a well of the same name */
function syncFindLocal(f) {
  const same = LIB.rows.find(r => r.path === f.path); if (same) return same;
  const n = (f.names || []).map(x => String(x).trim().toLowerCase());
  return LIB.rows.find(r => n.includes(String(r.name).trim().toLowerCase())) || null;
}
const SYNC_ACT = { add: 'Add', replace: 'Replace this computer\'s copy', keep: 'Keep this computer\'s copy', both: 'Keep both (save as a second file)', open: 'Open in the project', skip: 'Skip' };
async function syncImport(file) {
  let pkg; try { pkg = await syncReadPackage(file); }
  catch (e) { await dlg('Could not read ' + file.name + ': ' + e.message + '.', [{ label: 'OK', value: 1, primary: true }]); return; }
  const lib = !!(LIB.dir && LIB.ok); if (lib) await libScan();
  const from = pkg.from || 'the other computer';
  const rows = [];
  for (const f of pkg.files) {
    const inAt = Date.parse(f.savedAt) || 0, r = { f, inAt, local: null, locAt: 0, status: '', act: 'skip', acts: [] };
    if (!lib) { r.status = 'Not in the project'; r.acts = ['open', 'skip']; r.act = 'open'; rows.push(r); continue; }
    const loc = syncFindLocal(f);
    if (!loc) { r.status = 'New here'; r.acts = ['add', 'skip']; r.act = 'add'; rows.push(r); continue; }
    const lf = await loc.handle.getFile(), lt = await lf.text(), ls = syncSavedAt(lt, lf.lastModified);
    r.local = loc; r.locAt = ls.at; r.locOn = ls.on;
    if (lt === f.text || (Math.abs(ls.at - inAt) < 1000 && syncStamp(lt, lf.lastModified) === f.text)) { r.status = 'Same'; r.acts = ['skip']; r.act = 'skip'; }
    else if (inAt > ls.at) { r.status = 'Newer in the package'; r.acts = ['replace', 'both', 'keep']; r.act = 'replace'; }
    else { r.status = 'Older in the package'; r.acts = ['keep', 'replace', 'both']; r.act = 'keep'; }
    rows.push(r);
  }
  // settings that differ from this computer's
  const setDiff = pkg.settings ? SYNC_SETTINGS.filter(([k]) => k in pkg.settings && pkg.settings[k] !== lsGet(k)) : [];
  const stCol = s => s === 'Newer in the package' ? 'var(--ok, #2a8)' : s === 'Older in the package' ? 'var(--warn)' : 'var(--muted)';
  const body = `<div class="hint" style="margin:0 0 8px">Package from <b>${esc(from)}</b>, made ${syncWhen(Date.parse(pkg.made))}. ${lib ? `Each plan is compared with the copy in <b>${esc(LIB.dir.name)}</b> by the time it was last saved.` : 'No plans folder is connected here, so the plans open in the project (Save then downloads them). Connect a folder in the Plan library to keep them as files.'}</div>
    ${rows.length ? `<table style="border-collapse:collapse;font-size:13px;width:100%"><thead><tr>${syncTh('Well')}${syncTh('In the package')}${syncTh('On this computer')}${syncTh('What to do')}</tr></thead><tbody>` +
    rows.map((r, i) => `<tr><td ${SYNC_TD}><b>${esc((r.f.names || []).join(', ') || r.f.path)}</b><div class="mut">${esc(r.f.path)}</div></td>` +
      `<td ${SYNC_TD} style="white-space:nowrap">${syncWhen(r.inAt)}${r.f.savedOn ? '<div class="mut">' + esc(r.f.savedOn) + '</div>' : ''}</td>` +
      `<td ${SYNC_TD} style="white-space:nowrap">${r.local ? syncWhen(r.locAt) + (r.locOn ? '<div class="mut">' + esc(r.locOn) + '</div>' : '') + (r.local.path !== r.f.path ? '<div class="mut">' + esc(r.local.path) + '</div>' : '') : '–'}<div style="color:${stCol(r.status)}">${esc(r.status)}</div></td>` +
      `<td ${SYNC_TD}><select data-sia="${i}"${r.acts.length < 2 ? ' disabled' : ''}>${r.acts.map(a => `<option value="${a}"${a === r.act ? ' selected' : ''}>${esc(SYNC_ACT[a])}</option>`).join('')}</select></td></tr>`).join('') + '</tbody></table>' : '<div class="hint">The package has no plans.</div>'}
    ${setDiff.length ? `<label class="chk" style="margin-top:10px"><input type="checkbox" id="siSet"><span>Also use the settings from ${esc(from)}: ${esc(setDiff.map(x => x[1]).join(', '))} (the page reloads to apply them)</span></label>` : pkg.settings ? '<div class="hint" style="margin-top:8px">The settings in the package match this computer\'s.</div>' : ''}`;
  const pick = await syncModal('Import package', body, [{ label: 'Cancel', value: null }, { label: 'Import', primary: true, value: ov => ({ acts: [...ov.querySelectorAll('[data-sia]')].map(s => s.value), set: !!(ov.querySelector('#siSet') || {}).checked }) }]);
  if (!pick) return;
  pick.acts.forEach((a, i) => { rows[i].act = a; });
  const done = { add: 0, replace: 0, both: 0 }, bad = [], reopen = [];
  if (!lib) {
    const items = rows.filter(r => r.act === 'open').map(r => { try { return { name: r.f.path, p: migrateProject(JSON.parse(r.f.text)) }; } catch (e) { bad.push(r.f.path); return null; } }).filter(x => x && x.p);
    if (items.length) await openProjects(items, bad);
  } else {
    const openPaths = new Set(project.wells.map(w => FILEOF.get(w)).filter(Boolean).map(s => s.path));
    for (const r of rows) {
      if (!(r.act in done)) continue;
      try {
        let path = r.act === 'replace' ? r.local.path : r.f.path;
        if (r.act === 'both') path = path.replace(/\.wellplan\.json$|\.json$/i, '') + '_from_' + syncFileSafe(from) + '.wellplan.json';
        const h = r.act === 'replace' ? r.local.handle : await syncCreate(path);
        const wr = await h.createWritable(); await wr.write(r.f.text); await wr.close();
        done[r.act]++;
        if (r.act === 'replace' && openPaths.has(r.local.path)) reopen.push(r.local.path);
      } catch (e) { bad.push(r.f.path + ': ' + e.message); }
    }
    lsSet(SYNC_KEY.lastIn, new Date().toISOString());
    await libScan();
  }
  if (pick.set) setDiff.forEach(([k]) => lsSet(k, pkg.settings[k]));
  if (lib) {
    const n = done.add + done.replace + done.both;
    const msg = n ? `Imported ${n} plan file${n === 1 ? '' : 's'} into ${LIB.dir.name}: ${done.add} added, ${done.replace} replaced, ${done.both} kept as a second file.` : 'No plan files were changed.';
    const opts = reopen.length ? [{ label: 'Later', value: 0 }, { label: 'Open them now', value: 1, primary: true }] : [{ label: 'OK', value: 0, primary: true }];
    const c = await dlg(msg + (bad.length ? '\n\nCould not write:\n' + bad.join('\n') : '') +
      (reopen.length ? `\n\nOpen in the project here, still showing the old version:\n${reopen.join('\n')}\nOpen them again from the library to work on the imported version (Save would otherwise ask before replacing it).` : ''), opts);
    if (c === 1) for (const p of reopen) await libOpen(p);
  }
  renderSync();
  if (pick.set && setDiff.length && await dlg('The settings from ' + from + ' are stored. Reload the page now to use them? Your open project is kept.', [{ label: 'Later', value: false }, { label: 'Reload', value: true, primary: true }])) location.reload();
}
/* a new file at a library path, making any subfolders it needs */
async function syncCreate(path) {
  const parts = path.split('/'), name = parts.pop();
  let dir = LIB.dir; for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
  let nm = name, n = 1;
  const exists = async x => { try { await dir.getFileHandle(x); return true; } catch (e) { return false; } };
  while (await exists(nm)) { n++; nm = name.replace(/(\.wellplan)?\.json$/i, '') + '_' + n + '.wellplan.json'; }
  return dir.getFileHandle(nm, { create: true });
}

/* ---------------- panel ---------------- */
function renderSync() {
  const el = $('#syncInfo'); if (!el) return;
  const last = lsGet(SYNC_KEY.last), lastIn = lsGet(SYNC_KEY.lastIn);
  el.textContent = `Last export from here: ${last ? syncWhen(Date.parse(last)) : 'never'} · last import: ${lastIn ? syncWhen(Date.parse(lastIn)) : 'never'}`;
  const nm = $('#syncName'); if (nm && document.activeElement !== nm) nm.value = syncName();
}
$('#syncName').addEventListener('input', e => lsSet(SYNC_KEY.name, e.target.value.trim() || null));
$('#bSyncOut').onclick = () => syncExport();
$('#bSyncIn').onclick = () => $('#syncFile').click();
$('#syncFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) syncImport(f); };
renderSync();
