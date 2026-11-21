'use strict';
/* Torque and drag tab: soft-string hookload and torque for the active well's planned (or actual) path. The maths is WP.torqueDrag
 * in core.js (tested in test.js). Inputs live in state.td (per well, shared by its plan versions); loads are klbf / kft-lbf here. */
const TDV = { key: '', res: null, hov: {}, ser: {} };
const tdIn = () => Object.assign(TD_DEF(), state.td || {});
const tdFfs = td => {
  const l = String(td.ffList || '').split(/[\s,;]+/).map(Number).filter(x => isFinite(x) && x >= 0 && x < 2);
  return [...new Set(l.concat([+td.ffO]).map(x => +x.toFixed(3)))].sort((a, b) => a - b);
};
function tdShoe(td, m) {
  if (td.shoe !== '' && td.shoe != null && isFinite(td.shoe)) return { md: +td.shoe, auto: false };
  const L = m && m.markers ? m.markers.find(x => x.label === 'Landing') : null;
  return { md: L ? L.row.md : 0, auto: true };
}
function tdOpts(td, shoe) {
  return { comps: td.comps, mw: +td.mw, ffC: +td.ffC, ffO: +td.ffO, ffList: tdFfs(td), shoe, csgId: +td.csgId, hole: +td.hole,
    wob: +td.wob * 1000, tob: +td.tob * 1000, block: +td.block * 1000, step: 25, bitStep: 100, tort: { amp: +td.tortAmp || 0, period: +td.tortPer || 1000 } };
}
function tdPath(td) {
  if (td.path === 'actual' && ACT.rows && ACT.rows.length > 1) {
    const a = ACT.rows, above = (M.survey || []).filter(r => r.md < a[0].md - 0.01);
    return { rows: above.concat(a).map(r => ({ md: r.md, inc: r.inc, azi: r.azi })), actual: true };
  }
  return { rows: M.survey ? M.survey.map(r => ({ md: r.md, inc: r.inc, azi: r.azi })) : null, actual: false };
}
const kl = x => x / 1000;
const BUCK = ['none', 'sinusoidal', 'helical'];

/* ---- inputs ---- */
function renderTdInputs() {
  const td = tdIn(), comps = td.comps, n = comps.length;
  let top = M.survey ? M.survey[M.survey.length - 1].md : 0;
  let h = '<thead><tr><th class="l">Component (bit up)</th><th>Length ft</th><th>OD in</th><th>ID in</th><th>Weight lb/ft</th><th>TJ OD in</th><th>MD at TD</th><th></th></tr></thead><tbody>';
  comps.forEach((c, i) => {
    const last = i === n - 1, len = last ? Math.max(0, top) : Math.min(+c.len || 0, Math.max(0, top)), bot = top; top -= len;
    const inp = (f, v, extra) => `<td><input type="number" step="any" min="0" data-ci="${i}" data-cf="${f}" value="${v ?? ''}"${extra || ''}></td>`;
    h += `<tr><td class="l"><input type="text" data-ci="${i}" data-cf="name" value="${esc(c.name || '')}"></td>` +
      (last ? '<td style="color:var(--muted)">to surface</td>' : inp('len', c.len)) + inp('od', c.od) + inp('id', c.id) + inp('wt', c.wt) + inp('tj', c.tj) +
      `<td style="color:var(--muted)">${M.survey ? fmt(Math.max(0, top), 0) + '–' + fmt(bot, 0) : '–'}</td>` +
      `<td>${n > 1 ? `<button class="small ghost" data-cdel="${i}" title="Remove this component" aria-label="Remove">×</button>` : ''}</td></tr>`;
  });
  $('#tdComps').innerHTML = h + '</tbody>';
  $$('[data-td]').forEach(el => {
    const k = el.dataset.td; if (document.activeElement === el) return;
    el.value = td[k] ?? '';
  });
  const opt = $('#tdPath option[value="actual"]'), has = !!(state.actual && state.actual.rows && state.actual.rows.length > 1);
  opt.disabled = !has; if (!has && td.path === 'actual') $('#tdPath').value = 'plan';
  const sh = $('[data-td="shoe"]'), s = tdShoe(td, M);
  sh.placeholder = s.auto ? (s.md ? 'landing ' + fmt(s.md, 0) : 'none') : '';
}
function tdSet(fn) { if (!state.td) state.td = TD_DEF(); fn(state.td); autosave(); TDV.key = ''; renderTD(); }
$('#pane-td').addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.td) {
    const k = el.dataset.td, raw = el.value.trim();
    tdSet(td => { td[k] = (k === 'path' || k === 'ffList') ? raw : (k === 'shoe' && raw === '') ? '' : (raw === '' ? td[k] : +raw); });
  } else if (el.dataset.cf) {
    const i = +el.dataset.ci, f = el.dataset.cf;
    tdSet(td => { const c = td.comps[i]; if (!c) return; c[f] = f === 'name' ? el.value : (el.value === '' ? c[f] : +el.value); });
  }
});
$('#tdComps').addEventListener('click', e => {
  const b = e.target.closest('[data-cdel]'); if (!b) return;
  tdSet(td => { td.comps.splice(+b.dataset.cdel, 1); });
});
$('#bTdAdd').onclick = () => tdSet(td => { const n = td.comps.length, src = td.comps[n - 1] || {}; td.comps.splice(Math.max(0, n - 1), 0, { name: 'Heavy-weight drill pipe', len: 600, od: src.od || 4, id: 2.563, wt: 28, tj: src.tj || 5 }); });
$('#bTdReset').onclick = () => { if (confirm('Put this well\'s drill string, hole and operating values back to the defaults?')) tdSet(td => Object.assign(td, TD_DEF())); };
$('#bTdAll').onclick = () => {
  const others = project.wells.filter(w => w !== state); if (!others.length) { alert('This is the only well in the project.'); return; }
  if (!confirm('Copy this well\'s torque and drag inputs to the other ' + others.length + ' well' + (others.length === 1 ? '' : 's') + ' in the project?')) return;
  const td = JSON.parse(JSON.stringify(tdIn())); others.forEach(w => { w.td = JSON.parse(JSON.stringify(td)); }); autosave();
};

/* ---- calculation ---- */
function tdCompute() {
  const td = tdIn(), p = tdPath(td); if (!p.rows || p.rows.length < 2) return null;
  const shoe = tdShoe(td, M), o = tdOpts(td, shoe.md);
  const key = JSON.stringify([o, p.rows.length, p.rows[p.rows.length - 1], p.rows[Math.floor(p.rows.length / 2)], p.rows.reduce((a, r) => a + r.inc * 7 + r.azi, 0)]);
  if (key === TDV.key && TDV.res) return TDV.res;
  const r = WP.torqueDrag(p.rows, o); if (!r) return null;
  const main = r.sweep.find(s => Math.abs(s.ff - o.ffO) < 1e-6) || r.sweep[0];
  r.main = main; r.o = o; r.td = td; r.shoe = shoe; r.actual = p.actual;
  r.maxWob = WP.maxSlideWob(r.P, o);
  TDV.key = key; TDV.res = r; TDV.hov = {};
  return r;
}

/* ---- page ---- */
function renderTDSoon() { clearTimeout(TDV.t); if (paneOn('td')) TDV.t = setTimeout(renderTD, 120); }
function renderTD() {
  if (!paneOn('td')) return;
  renderTdInputs();
  const r = M.survey ? tdCompute() : null;
  if (!r) { $('#tdStats').innerHTML = ''; $('#tdMsg').innerHTML = '<div class="msg note">Build a plan first.</div>'; $('#tdTbl').innerHTML = ''; $('#tdVer').innerHTML = ''; drawTD(); return; }
  const td = r.td, a = r.atTd, last = r.main.rows[r.main.rows.length - 1];
  const st = (k, v, sub, bad, tip) => `<div class="stat${bad ? ' bad' : ''}"${tip ? ` title="${esc(tip)}"` : ''}><div class="k">${k}</div><div class="v">${v}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;
  const margin = +td.tenLim - kl(a.pooh.hook), sb = a.slide;
  $('#tdStats').innerHTML =
    st('Pick-up at TD', fmt(kl(a.pooh.hook), 1), 'klbf', kl(a.pooh.hook) > +td.tenLim, 'Hookload pulling out of hole with the bit at TD (block weight included)') +
    st('Slack-off at TD', a.rih.lock ? 'lock-up' : fmt(kl(a.rih.hook), 1), a.rih.lock ? '' : 'klbf', a.rih.hook <= 0 || a.rih.lock, 'Hookload running in with the bit at TD') +
    st('Rotating off bottom', fmt(kl(a.rob.hook), 1), 'klbf') +
    st('Overpull margin', fmt(margin, 0), 'klbf', margin < 0, 'Tensile limit minus pick-up at TD') +
    st('Off-bottom torque', fmt(kl(a.rob.T), 1), 'kft-lbf', kl(a.rob.T) > +td.tqLim) +
    st('Drilling torque', fmt(kl(a.drill.T), 1), 'kft-lbf', kl(a.drill.T) > +td.tqLim, `Rotating on bottom with ${fmt(+td.wob, 0)} klbf weight on bit and ${fmt(+td.tob, 1)} kft-lbf at the bit`) +
    st('Max slide WOB at TD', fmt(kl(r.maxWob), 1), 'klbf', kl(r.maxWob) < +td.wob, 'Most weight on bit that can be slid at TD before the hookload reaches zero or the string locks up') +
    st('Sliding at TD', sb.lock ? 'lock-up' : BUCK[sb.buck], sb.lock || sb.buck ? 'buckling' : '', sb.lock || sb.buck === 2, `Pipe buckling while sliding with ${fmt(+td.wob, 0)} klbf on bit`);
  // warnings
  const W = [], ffTx = 'open-hole friction ' + fmt(r.o.ffO, 2);
  const soZero = r.main.rows.find(x => x.rih <= 0 || x.rihLock);
  if (soZero) W.push(`Running in (${ffTx}): the hookload reaches zero at bit MD ${fmt(soZero.md, 0)}. Below that the string would have to be rotated or pushed down.`);
  const tqOver = r.main.rows.find(x => kl(x.drillT) > +td.tqLim);
  if (tqOver) W.push(`Drilling torque passes the ${fmt(+td.tqLim, 1)} kft-lbf limit at bit MD ${fmt(tqOver.md, 0)}.`);
  if (kl(a.pooh.hook) > +td.tenLim) W.push(`Pick-up at TD (${fmt(kl(a.pooh.hook), 0)} klbf) is above the ${fmt(+td.tenLim, 0)} klbf tensile limit.`);
  if (kl(r.maxWob) < +td.wob) W.push(`Sliding: only about ${fmt(kl(r.maxWob), 1)} klbf can be put on the bit at TD without rotating, less than the ${fmt(+td.wob, 0)} klbf set (${ffTx}).`);
  const incAt = md => M.survey ? WP.planAtMd(M.survey, md).inc : 90;      // only worth flagging once the bit is in the build or lateral
  const hb = r.main.rows.find(x => x.slideBuck === 2 && !x.slideLock && incAt(x.md) > 45);
  if (hb) W.push(`Sliding with ${fmt(+td.wob, 0)} klbf on bit buckles the pipe helically from bit MD ${fmt(hb.md, 0)}.`);
  const info = [];
  info.push(`${r.actual ? 'Actual survey (plan above its first station)' : 'Planned survey'} to MD ${fmt(last.md, 0)} ft. Casing shoe at MD ${fmt(r.shoe.md, 0)}${r.shoe.auto ? (r.shoe.md ? ' (the Landing point)' : ' (none: all open hole)') : ''}; buoyancy factor ${fmt(1 - r.o.mw / 65.5, 3)}.`);
  if (!(r.o.tort.amp > 0)) info.push('No tortuosity added: a smooth planned path usually under-predicts torque and drag. Try 1° to see the effect.');
  $('#tdMsg').innerHTML = (W.length ? `<div class="msg err"><ul>${W.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '') + `<div class="msg note"><ul>${info.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  // table
  $('#tdTblFf').textContent = fmt(r.o.ffO, 2) + ', cased ' + fmt(r.o.ffC, 2);
  const rows = r.main.rows.filter((x, i, A) => i === A.length - 1 || Math.abs(x.md / 500 - Math.round(x.md / 500)) < 1e-6);
  $('#tdTbl').innerHTML = '<thead><tr><th>Bit MD</th><th>Pick-up klbf</th><th>Slack-off klbf</th><th>Rotating klbf</th><th>Sliding hook klbf</th><th>Off-bottom torque kft-lbf</th><th>Drilling torque kft-lbf</th><th class="l">Sliding buckling</th></tr></thead><tbody>' +
    rows.map(x => `<tr><td>${fmt(x.md, 0)}</td><td class="${kl(x.pooh) > +td.tenLim ? 'bad' : ''}">${fmt(kl(x.pooh), 1)}</td><td class="${x.rih <= 0 || x.rihLock ? 'bad' : ''}">${x.rihLock ? 'lock-up' : fmt(kl(x.rih), 1)}</td><td>${fmt(kl(x.rob), 1)}</td>` +
      `<td class="${x.slide <= 0 || x.slideLock ? 'bad' : ''}">${x.slideLock ? 'lock-up' : fmt(kl(x.slide), 1)}</td><td>${fmt(kl(x.robT), 1)}</td><td class="${kl(x.drillT) > +td.tqLim ? 'bad' : ''}">${fmt(kl(x.drillT), 1)}</td><td class="l">${x.slideLock ? 'lock-up' : BUCK[x.slideBuck]}</td></tr>`).join('') + '</tbody>';
  renderTdVersions(r);
  drawTD();
}
/* the same inputs at TD for each plan version of this well */
function renderTdVersions(r) {
  const box = $('#tdVer'), w = state; if (!w.versions || w.versions.length < 2 || r.actual) { box.innerHTML = ''; return; }
  const td = r.td, f = (x, d = 1) => fmt(x, d);
  box.innerHTML = '<div class="hint" style="margin:0 0 4px">Plan versions with the bit at TD (same string, mud and friction)</div><div class="tblwrap" style="max-height:none"><table><thead><tr><th class="l">Version</th><th>TD MD</th><th>Pick-up klbf</th><th>Slack-off klbf</th><th>Rotating klbf</th><th>Drilling torque kft-lbf</th><th>Max slide WOB klbf</th></tr></thead><tbody>' +
    w.versions.map(v => {
      const m = verModel(w, v); if (!m || m.err || !m.survey) return `<tr><td class="l">${esc(verName(w, v))}</td><td colspan="6" class="l" style="color:var(--warn)">plan error</td></tr>`;
      const o = tdOpts(td, tdShoe(td, m).md), P = WP.tdPrep(m.survey, o), K = P.mds.length - 1, run = op => WP.tdRun(P, o, K, op);
      const pu = run('pooh'), so = run('rih'), rob = run('rob'), dr = run('drill'), mw = WP.maxSlideWob(P, o);
      return `<tr${v.id === w.ver ? ' class="bound"' : ''}><td class="l">${esc(verName(w, v))}</td><td>${f(P.mds[K], 0)}</td><td>${f(kl(pu.hook))}</td><td class="${so.hook <= 0 || so.lock ? 'bad' : ''}">${so.lock ? 'lock-up' : f(kl(so.hook))}</td><td>${f(kl(rob.hook))}</td><td class="${kl(dr.T) > +td.tqLim ? 'bad' : ''}">${f(kl(dr.T))}</td><td class="${kl(mw) < +td.wob ? 'bad' : ''}">${f(kl(mw))}</td></tr>`;
    }).join('') + '</tbody></table></div>';
}

/* ---- charts ---- */
function tdChart(id, o) {
  TDV.ser[id] = o; o.cursor = TDV.hov[id] ?? null;
  lineChart(id, o);
  const el = $('#td' + id.slice(4) + 'Rd'); if (!el) return;
  if (o.cursor == null) { el.textContent = 'Hover for values'; return; }
  const parts = o.series.filter(s => !s.noLegend && !s.noRead && s.pts.length).map(s => {
    let b = s.pts[0]; s.pts.forEach(p => { if (Math.abs(p[0] - o.cursor) < Math.abs(b[0] - o.cursor)) b = p; });
    return s.name + ' ' + fmt(b[1], 1);
  });
  el.textContent = 'MD ' + fmt(o.cursor, 0) + ' · ' + parts.join(' · ');
}
function drawTD() {
  if (!paneOn('td')) return;
  const r = TDV.res && M.survey ? TDV.res : null;
  ['cvTdHook', 'cvTdTq', 'cvTdF', 'cvTdT'].forEach(id => { if (!r) { const c = $('#' + id); if (c.width) c.getContext('2d').clearRect(0, 0, c.width, c.height); } });
  if (!r) return;
  const td = r.td, ffO = r.o.ffO, others = r.sweep.filter(s => s !== r.main), C = { pu: css('--accent'), so: css('--blue'), sl: css('--purple'), rob: css('--ink'), dr: css('--accent'), ob: css('--blue') };
  const ser = (sw, k, name, col, dash) => ({ name: dash ? name + ' µ' + fmt(sw.ff, 2) : name, color: col, dash: dash ? [5, 4] : null, noLegend: !!dash, pts: sw.rows.filter(x => !x[k + 'Lock']).map(x => [x.md, Math.max(kl(x[k]), -0.5 * +td.tenLim)]) });
  const dashTx = others.length ? ' · solid µ ' + fmt(ffO, 2) + ', dashed µ ' + others.map(s => fmt(s.ff, 2)).join(' / ') : ' · µ ' + fmt(ffO, 2);
  $('#tdHookSub').textContent = 'klbf' + dashTx; $('#tdTqSub').textContent = 'kft-lbf' + dashTx;
  tdChart('cvTdHook', { xl: 'Bit measured depth (ft)',
    series: [ser(r.main, 'pooh', 'Pick-up', C.pu), ser(r.main, 'rih', 'Slack-off', C.so), ser(r.main, 'rob', 'Rotating', C.rob), ser(r.main, 'slide', 'Sliding', C.sl)]
      .concat(others.flatMap(s => [ser(s, 'pooh', 'Pick-up', C.pu, 1), ser(s, 'rih', 'Slack-off', C.so, 1), ser(s, 'slide', 'Sliding', C.sl, 1)])),
    hlines: [{ y: +td.tenLim, color: css('--warn'), label: 'tensile limit ' + fmt(+td.tenLim, 0) }] });
  const tq = (sw, k, name, col, dash) => ({ name: dash ? name + ' µ' + fmt(sw.ff, 2) : name, color: col, dash: dash ? [5, 4] : null, noLegend: !!dash, pts: sw.rows.map(x => [x.md, kl(x[k + 'T'])]) });
  tdChart('cvTdTq', { xl: 'Bit measured depth (ft)',
    series: [tq(r.main, 'drill', 'Drilling', C.dr), tq(r.main, 'rob', 'Off bottom', C.ob)].concat(others.flatMap(s => [tq(s, 'drill', 'Drilling', C.dr, 1), tq(s, 'rob', 'Off bottom', C.ob, 1)])),
    hlines: [{ y: +td.tqLim, color: css('--warn'), label: 'torque limit ' + fmt(+td.tqLim, 1) }] });
  const a = r.atTd, pf = (p, f) => p.prof.map(x => [x.md, f(x)]);
  const bk = a.slide.prof.filter(x => x.fs != null);
  tdChart('cvTdF', { xl: 'Measured depth along the string (ft)',
    series: [{ name: 'Pick-up', color: C.pu, pts: pf(a.pooh, x => kl(x.F)) }, { name: 'Slack-off', color: C.so, noScale: a.rih.lock, pts: pf(a.rih, x => Math.max(kl(x.F), -1e4)) },
      { name: 'Rotate', color: C.rob, pts: pf(a.rob, x => kl(x.F)) }, { name: 'Slide', color: C.sl, noScale: a.slide.lock, pts: pf(a.slide, x => Math.max(kl(x.F), -1e4)) },
      { name: 'Sin. buckling', color: css('--amber'), dash: [5, 4], pts: bk.map(x => [x.md, -kl(x.fs)]) },      // locked-up loads run off the bottom; the buckling limits set the scale
      { name: 'Helical', color: css('--warn'), dash: [5, 4], pts: bk.map(x => [x.md, -kl(x.fh)]) }] });
  tdChart('cvTdT', { xl: 'Measured depth along the string (ft)',
    series: [{ name: 'Drilling', color: C.dr, pts: pf(a.drill, x => kl(x.T)) }, { name: 'Off bottom', color: C.ob, pts: pf(a.rob, x => kl(x.T)) }],
    hlines: [{ y: +td.tqLim, color: css('--warn'), label: 'torque limit ' + fmt(+td.tqLim, 1) }] });
}
['cvTdHook', 'cvTdTq', 'cvTdF', 'cvTdT'].forEach(id => {
  const c = $('#' + id);
  c.addEventListener('mousemove', e => {
    const L = c._lc, o = TDV.ser[id]; if (!L || !o) return;
    const x = e.clientX - c.getBoundingClientRect().left, md = L.xlo + (x - L.m.l) / L.iw * (L.xhi - L.xlo);
    TDV.hov[id] = md >= L.xlo && md <= L.xhi ? md : null; tdChart(id, o);
  });
  c.addEventListener('mouseleave', () => { TDV.hov[id] = null; const o = TDV.ser[id]; if (o) tdChart(id, o); });
});

/* ---- CSV ---- */
$('#bTdCsv').onclick = () => {
  const r = TDV.res; if (!r) return;
  const head = 'Open-hole friction,Cased friction,Bit MD (ft),Pick-up (klbf),Slack-off (klbf),Rotating off bottom (klbf),Sliding hookload (klbf),Off-bottom torque (kft-lbf),Drilling torque (kft-lbf),Sliding buckling';
  const lines = r.sweep.flatMap(s => s.rows.map(x => [s.ff, r.o.ffC, x.md.toFixed(1), kl(x.pooh).toFixed(2), x.rihLock ? 'lock-up' : kl(x.rih).toFixed(2), kl(x.rob).toFixed(2), x.slideLock ? 'lock-up' : kl(x.slide).toFixed(2), kl(x.robT).toFixed(2), kl(x.drillT).toFixed(2), x.slideLock ? 'lock-up' : BUCK[x.slideBuck]].join(',')));
  download((state.name || 'well').replace(/[^\w.-]+/g, '_') + '_torque_drag.csv', head + '\n' + lines.join('\n') + '\n', 'text/csv');
};
