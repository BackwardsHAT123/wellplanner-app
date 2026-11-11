'use strict';
/* line charts and plan vs actual (split from index.html; loaded in order, shares globals) */
/* ---- line charts ---- */
const colorAt = WP.colorAt;   // colour ramp helper lives in core.js (tested there)
function lineChart(canvasId, o) {
  const c = $('#' + canvasId); if (!c.offsetParent) return;
  const { g, w, h } = setupCanvas(c);
  const ink = css('--ink'), muted = css('--muted'), grid = css('--grid');
  const m = { l: 52, r: o.right || o.padRight ? 46 : 14, t: o.cursorTop ? 24 : 12, b: o.hideX ? 8 : 32 }, iw = w - m.l - m.r, ih = h - m.t - m.b;
  const ext = ax => {
    const ss = o.series.filter(s => (s.axis || 'left') === ax), sg = (ss.find(s => s.scale) || {}).scale || {}, num = v => v !== '' && v != null && isFinite(+v);
    let lo = Infinity, hi = -Infinity;
    ss.forEach(s => s.noScale || s.pts.forEach(p => { if (sg.log && !(p[1] > 0)) return; lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }));
    (o.hlines || []).filter(l => (l.axis || 'left') === ax).forEach(l => { lo = Math.min(lo, l.y); hi = Math.max(hi, l.y); });
    let r;
    if (sg.log) {                              // whole decades unless min / max are given
      r = isFinite(lo) ? [Math.floor(Math.log10(lo)), Math.ceil(Math.log10(hi))] : [0, 1];
      if (num(sg.min) && +sg.min > 0) r[0] = Math.log10(+sg.min); if (num(sg.max) && +sg.max > 0) r[1] = Math.log10(+sg.max); if (r[1] <= r[0]) r[1] = r[0] + 1;
    } else {
      if (!isFinite(lo)) r = [0, 1]; else if (sg.fit) { const pad = (hi - lo) * 0.06 || 1; r = [lo - pad, hi + pad]; } else { lo = Math.min(lo, 0); const pad = (hi - lo) * 0.08 || 1; r = [lo, hi + pad]; }
      if (num(sg.min)) r[0] = +sg.min; if (num(sg.max)) r[1] = +sg.max; if (r[1] <= r[0]) r[1] = r[0] + 1;
    }
    r.log = !!sg.log; r.rev = !!sg.rev; return r;
  };
  const xs = o.xrange ? o.xrange : o.series.flatMap(s => s.pts.map(p => p[0])); const xlo = Math.min(...xs), xhi = Math.max(...xs, xlo + 1);
  const L = ext('left'), R = o.right ? ext('right') : null;
  const X = x => m.l + (x - xlo) / (xhi - xlo) * iw;
  const Yf = (r, y) => { const v = r.log ? Math.log10(Math.max(y, Math.pow(10, r[0]) * 0.5)) : y; let f = (v - r[0]) / (r[1] - r[0]); if (r.rev) f = 1 - f; return m.t + ih - f * ih; };
  const ticksOf = (r, step) => { const t = []; if (r.log) { for (let k = Math.ceil(r[0] - 1e-9); k <= r[1] + 1e-9; k++) t.push(Math.pow(10, k)); } else for (let y = Math.ceil(r[0] / step) * step; y <= r[1]; y += step) t.push(y); return t; };
  const tickTx = (r, y, step) => r.log ? (y >= 1 ? fmt(y, 0) : String(+y.toPrecision(2))) : fmt(y, step < 1 ? 1 : 0);
  const sx = niceStep(xhi - xlo, 6), sl = niceStep(L[1] - L[0], 5);
  g.lineWidth = 1; g.strokeStyle = grid; g.fillStyle = muted; g.textAlign = 'right'; g.beginPath();
  ticksOf(L, sl).forEach(y => { g.moveTo(m.l, Math.round(Yf(L, y)) + .5); g.lineTo(m.l + iw, Math.round(Yf(L, y)) + .5); });
  g.stroke();
  ticksOf(L, sl).forEach(y => g.fillText(tickTx(L, y, sl), m.l - 6, Yf(L, y) + 4));
  if (R) { const sr = niceStep(R[1] - R[0], 5); g.textAlign = 'left'; ticksOf(R, sr).forEach(y => g.fillText(tickTx(R, y, sr), m.l + iw + 6, Yf(R, y) + 4)); }
  g.textAlign = 'center';
  if (!o.hideX) { for (let x = Math.ceil(xlo / sx) * sx; x <= xhi; x += sx) g.fillText(fmt(x, 0), X(x), m.t + ih + 14);
    g.fillText(o.xl, m.l + iw / 2, h - 4); }
  g.save(); g.beginPath(); g.rect(m.l, m.t, iw, ih); g.clip();
  (o.hlines || []).forEach(l => { const r = (l.axis || 'left') === 'right' ? R : L, y = Yf(r, l.y); g.strokeStyle = l.color; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(m.l, y); g.lineTo(m.l + iw, y); g.stroke(); g.setLineDash([]); g.fillStyle = l.color; g.textAlign = 'left'; g.fillText(l.label, m.l + 6, y - 4); });
  o.series.forEach(s => {                      // fill under the curve, coloured by value
    if (!s.fill || s.pts.length < 2) return;
    const r = (s.axis || 'left') === 'right' ? R : L, yb = m.t + ih; g.save(); g.globalAlpha = s.fill.alpha == null ? 0.85 : s.fill.alpha;
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const p0 = s.pts[i], p1 = s.pts[i + 1], x0 = X(p0[0]), x1 = X(p1[0]); if (x1 < m.l || x0 > m.l + iw) continue;
      g.fillStyle = colorAt(s.fill.stops, (p0[1] + p1[1]) / 2); g.beginPath(); g.moveTo(x0, yb); g.lineTo(x0, Yf(r, p0[1])); g.lineTo(x1 + 0.6, Yf(r, p1[1])); g.lineTo(x1 + 0.6, yb); g.fill();
    }
    g.restore();
  });
  o.series.forEach(s => {
    const r = (s.axis || 'left') === 'right' ? R : L; g.strokeStyle = s.color; g.lineWidth = s.dash ? 1 : 2; g.setLineDash(s.dash || []); g.beginPath();
    s.pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Yf(r, p[1])) : g.moveTo(X(p[0]), Yf(r, p[1]))); g.stroke(); g.setLineDash([]);
    if (s.tag && s.pts.length) { const p = s.pts[0], y = Yf(r, p[1]); g.fillStyle = s.color; g.textAlign = 'left'; g.font = '10px -apple-system,Segoe UI,system-ui,sans-serif'; g.fillText(s.tag, Math.max(X(p[0]), m.l) + 4, y - 3); }
  });
  (o.tops || []).forEach(t => {                // formation tops: dashed line on every track, name on the top one
    if (t.x < xlo || t.x > xhi) return; const x = X(t.x);
    g.strokeStyle = muted; g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x, m.t); g.lineTo(x, m.t + ih); g.stroke(); g.setLineDash([]);
    if (o.topLabels) { g.save(); g.translate(x + 3, m.t + 4); g.rotate(Math.PI / 2); g.textAlign = 'left'; g.font = '10px -apple-system,Segoe UI,system-ui,sans-serif'; const tw = g.measureText(t.name).width; g.fillStyle = css('--panel'); g.globalAlpha = 0.75; g.fillRect(-2, -11, tw + 4, 12); g.globalAlpha = 1; g.fillStyle = ink; g.fillText(t.name, 0, -2); g.restore(); }
  });
  (o.vlines || []).forEach(v => { if (v.x < xlo || v.x > xhi) return; g.strokeStyle = v.color; g.lineWidth = 1.5; g.setLineDash([6, 3]); g.beginPath(); g.moveTo(X(v.x), m.t); g.lineTo(X(v.x), m.t + ih); g.stroke(); g.setLineDash([]); });
  c._lc = { m, iw, xlo, xhi };
  if (o.cursor != null && o.cursor >= xlo && o.cursor <= xhi) {
    const cx = X(o.cursor); g.strokeStyle = muted; g.lineWidth = 1; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(cx, m.t); g.lineTo(cx, m.t + ih); g.stroke(); g.setLineDash([]);
    o.series.forEach(s => { if (s.noLegend) return; const r = (s.axis || 'left') === 'right' ? R : L; let best = s.pts[0]; if (!best) return; s.pts.forEach(p => { if (Math.abs(p[0] - o.cursor) < Math.abs(best[0] - o.cursor)) best = p; }); g.fillStyle = s.color; g.beginPath(); g.arc(cx, Yf(r, best[1]), 3.5, 0, 7); g.fill();
      if (o.dropLines) {                       // dashed line out to the Y axis with the value at each end
        const y = Yf(r, best[1]), tx = fmt(best[1], Math.abs(best[1]) < 10 ? 2 : 1);
        g.strokeStyle = s.color; g.lineWidth = 1; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(m.l, y); g.lineTo(m.l + iw, y); g.stroke(); g.setLineDash([]);
        const tw = g.measureText(tx).width + 8, ty = Math.min(Math.max(y, m.t + 9), m.t + ih - 9);
        g.fillStyle = css('--panel'); g.fillRect(m.l + 2, ty - 8, tw, 16); g.fillRect(m.l + iw - 2 - tw, ty - 8, tw, 16);
        g.fillStyle = s.color; g.textAlign = 'left'; g.fillText(tx, m.l + 6, ty + 4); g.textAlign = 'right'; g.fillText(tx, m.l + iw - 6, ty + 4);
      } });
  }
  g.restore(); g.strokeStyle = css('--line'); g.strokeRect(m.l + .5, m.t + .5, iw, ih);
  if (o.cursorTop && o.cursor != null && o.cursor >= xlo && o.cursor <= xhi) {      // MD of the marker, above the plot
    const tx = 'MD ' + fmt(o.cursor, 1) + ' ft', tw = g.measureText(tx).width + 12, cx = Math.min(Math.max(X(o.cursor), m.l + tw / 2), m.l + iw - tw / 2);
    g.fillStyle = css('--ink'); g.fillRect(cx - tw / 2, 3, tw, 17); g.fillStyle = css('--bg'); g.textAlign = 'center'; g.fillText(tx, cx, 15);
  }
  // legend
  if (o.axisLabels) {                          // curve names beside the Y axes, rotated 90 degrees left
    ['left', 'right'].forEach(ax => {
      const ss = o.series.filter(s => (s.axis || 'left') === ax); if (!ss.length || (ax === 'right' && !R)) return;
      const ws = ss.map(s => g.measureText(s.label || s.name).width), tot = ws.reduce((x, y) => x + y, 0) + 16 * (ss.length - 1);
      const L = ax === 'left'; let pos = m.t + ih / 2 + (L ? tot / 2 : -tot / 2);       // right-hand names read top to bottom
      ss.forEach((s, i) => { g.save(); g.translate(L ? 11 : w - 6, pos + (L ? -1 : 1) * ws[i] / 2); g.rotate(L ? -Math.PI / 2 : Math.PI / 2); g.fillStyle = s.color; g.textAlign = 'center'; g.font = '600 11px -apple-system,Segoe UI,system-ui,sans-serif'; g.fillText(s.label || s.name, 0, 0); g.restore(); pos += (L ? -1 : 1) * (ws[i] + 16); });
    });
    return;
  }
  let lx = m.l + 8; g.textAlign = 'left';
  o.series.filter(s => !s.noLegend).forEach(s => { g.fillStyle = s.color; g.fillRect(lx, m.t + ih - 16, 14, 3); g.fillStyle = ink; g.fillText(s.name, lx + 19, m.t + ih - 11); lx += g.measureText(s.name).width + 36; });
}
function drawDls() {
  if (!M.survey) return;
  lineChart('cvDls', {
    xl: 'Measured depth (ft)', right: true,
    series: [{ name: 'Inclination (°)', color: css('--blue'), pts: M.survey.map(r => [r.md, r.inc]) },
             { name: 'DLS (°/100 ft)', color: css('--accent'), axis: 'right', pts: M.survey.slice(1).map(r => [r.md, r.dls]) }],
    hlines: [{ axis: 'right', y: state.maxDls, color: css('--accent'), label: 'DLS alarm ' + fmt(state.maxDls, 1) }]
  });
}
function drawSep() {
  const c = $('#cvSep'); if (!c.offsetParent) return;
  if (!M.survey || !M.sep || !M.offs.length) {
    const { g, w, h } = setupCanvas(c); g.fillStyle = css('--muted'); g.textAlign = 'center';
    g.fillText(M.offs && M.offs.length ? 'Calculating…' : 'No other wells or offsets to compare.', w / 2, h / 2); return;
  }
  lineChart('cvSep', {
    xl: 'Plan measured depth (ft)',
    series: M.offs.map((o, i) => ({ name: o.name, color: o.color, pts: M.sep[i].map(x => [x.md, Math.min(x.d, 5000)]) })),
    hlines: [{ y: state.minSep, color: css('--warn'), label: 'alert ' + fmt(state.minSep, 0) + ' ft' }]
  });
}

/* ================= plan vs actual ================= */
/* state.actual = { src, added, trueNorth, tie: 'auto'|'plan'|'surface', rows: [{md, inc, azi}] } (azimuths as filed). */
const ACT = { rows: null, dev: null, tieHow: '', conv: 0 };
function apLegend(g, x, y) {
  g.save(); g.font = '12px ' + getComputedStyle(document.body).fontFamily; g.textAlign = 'left'; g.lineWidth = 3;
  g.strokeStyle = css('--accent'); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20, y); g.stroke();
  g.fillStyle = css('--ink'); g.fillText('Plan', x + 26, y + 4);
  g.strokeStyle = css('--blue'); g.beginPath(); g.moveTo(x + 70, y); g.lineTo(x + 90, y); g.stroke();
  g.fillStyle = css('--ink'); g.fillText(state.actual && state.actual.kind === 'plan' ? 'Other plan' : 'Actual', x + 96, y + 4); g.restore();
}
function computeActual() {
  ACT.rows = ACT.dev = null; ACT.tieHow = ''; ACT.conv = 0;
  const a = state.actual; if (!a || !a.rows || a.rows.length < 2 || !M.survey) return;
  if (a.trueNorth && isLL()) { const ll = WP.toLatLon(state.surface.n, state.surface.e, state.crs); ACT.conv = WP.convergence(ll.lat, ll.lon, state.crs); }
  const st = a.rows.map(r => ({ md: r.md, inc: r.inc, azi: WP.norm360(r.azi - ACT.conv) })), first = st[0].md, mode = a.tie || 'auto';
  let tie = { n: 0, e: 0, tvd: 0 };
  if (mode === 'plan' || (mode === 'auto' && first > 1)) { const t = WP.planAtMd(M.survey, first); tie = { n: t.n, e: t.e, tvd: t.tvd }; ACT.tieHow = `tied to the plan at MD ${fmt(first, 0)}`; }
  else if (mode === 'surface' && first > 0) { tie = { n: 0, e: 0, tvd: first }; ACT.tieHow = `tied to the surface, vertical to MD ${fmt(first, 0)}`; }
  else ACT.tieHow = 'starts at the surface';
  ACT.rows = WP.actualSurvey(st, { n0: state.surface.n, e0: state.surface.e, kb: state.kb, vsAzi: M.vsAzi, tie });
  ACT.dev = WP.planVsActual(ACT.rows, M.survey); ACT.hov = null;
}
function drawApDist() {
  if (!ACT.dev) return;
  lineChart('cvApDist', {
    xl: 'Actual measured depth (ft)', cursor: ACT.hov ? ACT.hov.md : null,
    series: [{ name: 'Distance to plan', color: css('--ink'), pts: ACT.dev.map(d => [d.md, d.dist]) },
             { name: 'Right (+) / left (−)', color: css('--accent'), pts: ACT.dev.map(d => [d.md, d.right]) },
             { name: 'High (+) / low (−)', color: css('--blue'), pts: ACT.dev.map(d => [d.md, d.high]) }]
  });
}
/* Hovering the distance chart marks the same station on the plan view and the 3D view: the actual position and the closest plan point. */
function setApHover(md) {                    // md: any measured depth (finer than the survey stations), or null to clear
  if (md === null) { if (ACT.hov) { ACT.hov = null; drawActual(); } return; }
  md = Math.round(md * 2) / 2;                // half-foot steps, the usual log sample spacing
  if (ACT.hov && ACT.hov.md === md) return;
  if (!ACT.rows || !ACT.dev) { ACT.hov = { md, a: null, p: null }; drawActual(); return; }     // logs only, no actual survey to place it on
  const rows = ACT.rows, n = rows.length;
  if (md < rows[0].md || md > rows[n - 1].md) { ACT.hov = { md, a: null, p: null }; drawActual(); return; }   // inside the logs but outside the actual survey
  const a = WP.planAtMd(rows, md); let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rows[m].md <= md) lo = m; else hi = m; }
  const t = hi === lo || rows[hi].md === rows[lo].md ? 0 : (md - rows[lo].md) / (rows[hi].md - rows[lo].md);
  const pm = ACT.dev[lo].planMd + t * (ACT.dev[hi].planMd - ACT.dev[lo].planMd), p = WP.planAtMd(M.survey, pm), sf = state.surface;
  ACT.hov = { md, a: { x: a.easting - sf.e, y: a.northing - sf.n, z: -(a.tvdss + state.kb) }, p: { x: p.easting - sf.e, y: p.northing - sf.n, z: -p.tvd } };
  drawActual();
}
function attachApHover(box, pick) {          // pick(e) -> the canvas under the pointer, or null
  let raf = 0;
  box.addEventListener('mousemove', e => {
    ACT.pin = false;
    const c = pick(e); if (!c || !c._lc || raf) return; const cx = e.clientX, rect = c.getBoundingClientRect();
    raf = requestAnimationFrame(() => {
      raf = 0; const L = c._lc, f = (cx - rect.left - L.m.l) / L.iw;
      if (f < 0 || f > 1) return setApHover(null);
      setApHover(L.xlo + f * (L.xhi - L.xlo));
    });
  });
  box.addEventListener('mouseleave', () => { cancelAnimationFrame(raf); raf = 0; if (!ACT.pin) setApHover(null); });
}
attachApHover($('#cvApDist'), e => e.currentTarget);
attachApHover($('#logTracks'), e => e.target.closest && e.target.closest('canvas'));
attachApHover($('#cvGeoTvd'), e => e.currentTarget);

/* Keyboard: left / right arrows move the marker along MD (10 ft; Shift 100 ft; Alt 0.5 ft) on the Plan vs actual and Geosteering tabs,
 * Esc clears it, and 1-7 jump to the tabs in order. Ignored while typing in a field. */
document.addEventListener('keydown', e => {
  const t = e.target, tag = t && t.tagName; if (e.metaKey || e.ctrlKey || (t && (t.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && t.type !== 'checkbox' && t.type !== 'range')))) return;
  if (/^[1-7]$/.test(e.key)) { const b = $$('.tab')[+e.key - 1]; if (b) { b.click(); e.preventDefault(); } return; }
  if (!$('#pane-actual').classList.contains('on') && !$('#pane-geo').classList.contains('on')) return;
  if (e.key === 'Escape') { ACT.pin = false; setApHover(null); return; }
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const rows = ACT.rows || M.survey; if (!rows) return;
  const lo = rows[0].md, hi = rows[rows.length - 1].md, step = e.altKey ? 0.5 : e.shiftKey ? 100 : 10;
  const from = ACT.hov ? ACT.hov.md : (e.key === 'ArrowRight' ? lo - step : hi + step);
  e.preventDefault(); ACT.pin = true; setApHover(Math.min(hi, Math.max(lo, from + (e.key === 'ArrowRight' ? step : -step))));
});
