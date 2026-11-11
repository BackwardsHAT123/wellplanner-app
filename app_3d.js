'use strict';
/* 3D view (split from index.html; loaded in order, shares globals) */
/* ---- 3D ---- */
const V3 = { yaw: -35 * D2R, pitch: 28 * D2R, zoom: 1, drag: null, pan: { cv3d: [0, 0], cvAp3d: [0, 0] }, panMode: false };   // pan: screen-pixel offset per canvas; panMode makes a plain drag pan (touch, no Shift)
function draw3D(id = 'cv3d') {
  const AP = id !== 'cv3d', c = $('#' + id); if (!c.offsetParent || !M.survey) return;
  const { g, w, h } = setupCanvas(c);
  const ink = css('--ink'), muted = css('--muted'), acc = css('--accent'), warn = css('--warn'), line = css('--line');
  const W = r => [r.easting - state.surface.e, r.northing - state.surface.n, -r.tvd], W2 = r => [r.easting - state.surface.e, r.northing - state.surface.n, -offPlanTvd(r)];
  const plan = M.survey.map(W);
  const offs = AP ? [] : M.offs.map(o => o.rows.map(r => [r.easting - state.surface.e, r.northing - state.surface.n, -offPlanTvd(r)]));
  const vov = AP ? [] : verOverlays(), vp = vov.map(o => o.rows.map(W2));
  const actP = AP && ACT.rows ? ACT.rows.map(r => [r.easting - state.surface.e, r.northing - state.surface.n, -offPlanTvd(r)]) : [];
  const tg = t => [t.e - state.surface.e, t.n - state.surface.n, -t.tvd];
  const ut = usedTargets(), tw3 = ut.map(tg);
  const all = [...plan, ...offs.flat(), ...vp.flat(), ...actP, ...tw3, [0, 0, 0]];
  const lo = [0, 1, 2].map(i => Math.min(...all.map(q => q[i]))), hi = [0, 1, 2].map(i => Math.max(...all.map(q => q[i])));
  const ctr = lo.map((l, i) => (l + hi[i]) / 2);
  const rad = Math.max(50, 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
  const s = Math.min(w, h) / 2 * 0.86 / rad * V3.zoom;
  const cy = Math.cos(V3.yaw), sy = Math.sin(V3.yaw), cp = Math.cos(V3.pitch), sp = Math.sin(V3.pitch);
  const P = q => {
    const X = q[0] - ctr[0], Y = q[1] - ctr[1], Z = q[2] - ctr[2];
    const x1 = X * cy - Y * sy, y1 = X * sy + Y * cy;
    return [w / 2 + V3.pan[id][0] + x1 * s, h / 2 + V3.pan[id][1] - (Z * cp + y1 * sp) * s];
  };
  const seg = (a, b, col, lw, dash) => { g.strokeStyle = col; g.lineWidth = lw; g.setLineDash(dash || []); const A = P(a), B = P(b); g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); g.setLineDash([]); };
  // bounding box + floor
  const corner = (i, j, k) => [i ? hi[0] : lo[0], j ? hi[1] : lo[1], k ? hi[2] : lo[2]];
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
    seg(corner(0, a, b), corner(1, a, b), line, 1); seg(corner(a, 0, b), corner(a, 1, b), line, 1); seg(corner(a, b, 0), corner(a, b, 1), line, 1);
  }
  g.fillStyle = muted; g.textAlign = 'center';
  const lab = (q, t) => { const A = P(q); g.fillText(t, A[0], A[1] + 12); };
  lab([ctr[0], hi[1], lo[2]], 'N'); lab([hi[0], ctr[1], lo[2]], 'E'); lab([lo[0], ctr[1], lo[2]], 'W'); lab([ctr[0], lo[1], lo[2]], 'S');
  const poly = (pts, col, lw, dash, flat) => {
    g.strokeStyle = col; g.lineWidth = lw; g.setLineDash(dash || []); g.beginPath();
    pts.forEach((q, i) => { const A = P(flat ? [q[0], q[1], lo[2]] : q); i ? g.lineTo(A[0], A[1]) : g.moveTo(A[0], A[1]); }); g.stroke(); g.setLineDash([]);
  };
  poly(plan, line, 2, [], true);                                 // floor shadow
  offs.forEach((o, i) => { poly(o, M.offs[i].color, 1.6); });
  vp.forEach((o, i) => poly(o, vov[i].color, 1.8, [6, 4]));
  poly(plan, acc, 2.6);
  if (actP.length) { poly(actP, css('--blue'), 3.4); const e = actP[actP.length - 1], A = P(e); g.fillStyle = css('--blue'); g.beginPath(); g.arc(A[0], A[1], 4, 0, 7); g.fill(); apLegend(g, 12, 18); }
  if (AP && ACT.hov && ACT.hov.a) {
    const A = [ACT.hov.a.x, ACT.hov.a.y, ACT.hov.a.z], Pp = [ACT.hov.p.x, ACT.hov.p.y, ACT.hov.p.z];
    seg(Pp, A, ink, 1.2, [3, 2]); [[Pp, acc], [A, css('--blue')]].forEach(([q, col]) => { const B = P(q); g.fillStyle = col; g.strokeStyle = css('--panel'); g.lineWidth = 2; g.beginPath(); g.arc(B[0], B[1], 6, 0, 7); g.fill(); g.stroke(); });
  }
  // survey error ellipses: cross-section of the position uncertainty perpendicular to the hole, every 1,000 ft, 2.79 sigma
  if (ERR.ell && !AP) {
    const ring = (rows, cov, col, lw) => {
      if (!cov) return;
      let nextMd = 1000;
      rows.forEach((r, k) => {
        if (!(r.md >= nextMd || k === rows.length - 1)) return; while (nextMd <= r.md) nextMd += 1000;
        const i = r.inc * D2R, a = r.azi * D2R, t = [Math.sin(i) * Math.cos(a), Math.sin(i) * Math.sin(a), Math.cos(i)];   // N, E, V(down)
        const e1 = [Math.cos(i) * Math.cos(a), Math.cos(i) * Math.sin(a), -Math.sin(i)], e2 = [-Math.sin(a), Math.cos(a), 0];   // high side, right side
        const C = cov[k], m = [[C[0], C[1], C[2]], [C[1], C[3], C[4]], [C[2], C[4], C[5]]];
        const q = (u, v) => { let z = 0; for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) z += u[x] * m[x][y] * v[y]; return z; };
        const c11 = q(e1, e1), c12 = q(e1, e2), c22 = q(e2, e2), L1 = Math.sqrt(Math.max(c11, 0)); if (!(L1 > 0)) return;
        const L21 = c12 / L1, L22 = Math.sqrt(Math.max(0, c22 - L21 * L21)), K = 2.79;
        g.strokeStyle = col; g.lineWidth = lw; g.globalAlpha = .8; g.beginPath();
        for (let n = 0; n <= 36; n++) {
          const th = n / 36 * Math.PI * 2, u = K * L1 * Math.cos(th), v = K * (L21 * Math.cos(th) + L22 * Math.sin(th));
          // direction in N,E,V(down) -> plot axes (E, N, up)
          const dN = u * e1[0] + v * e2[0], dE = u * e1[1] + v * e2[1], dV = u * e1[2] + v * e2[2];
          const A = P([r.easting - state.surface.e + dE, r.northing - state.surface.n + dN, (rows === M.survey ? -r.tvd : -offPlanTvd(r)) - dV]);
          n ? g.lineTo(A[0], A[1]) : g.moveTo(A[0], A[1]);
        }
        g.stroke(); g.globalAlpha = 1;
      });
    };
    M.offs.forEach(o => ring(o.rows, covOf(o.rows), o.color, 1));
    ring(M.survey, covOf(M.survey), acc, 1.4);
  }
  const dot = (q, col, r, label) => { const A = P(q); g.fillStyle = col; g.beginPath(); g.arc(A[0], A[1], r, 0, 7); g.fill(); if (label) { g.fillStyle = ink; g.textAlign = 'left'; g.fillText(label, A[0] + 7, A[1] - 5); } };
  for (let k = 1; k < tw3.length; k++) seg(tw3[k - 1], tw3[k], warn, 1.2, [4, 4]);
  tw3.forEach((q, i) => dot(q, warn, 5, ut[i].name));
  dot([0, 0, 0], ink, 4, 'Surface');
  const td = plan[plan.length - 1], tl = tw3[tw3.length - 1];
  dot(td, ink, 4, tl && Math.hypot(td[0] - tl[0], td[1] - tl[1], td[2] - tl[2]) < 1 ? '' : 'TD');
}
const draw3DAll = () => { draw3D('cv3d'); draw3D('cvAp3d'); };
['cv3d', 'cvAp3d'].forEach(id => {
  const c = $('#' + id);
  c.addEventListener('contextmenu', e => e.preventDefault());
  c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); V3.drag = { x: e.clientX, y: e.clientY, pan: V3.panMode || e.shiftKey || e.button === 1 || e.button === 2 }; });
  c.addEventListener('pointerup', () => V3.drag = null);
  c.addEventListener('pointermove', e => {
    if (!V3.drag) return; const dx = e.clientX - V3.drag.x, dy = e.clientY - V3.drag.y;
    if (V3.drag.pan) { const p = V3.pan[id]; p[0] += dx; p[1] += dy; }                      // slide the picture, e.g. to zoom in on one depth
    else { V3.yaw += dx * 0.008; V3.pitch = Math.max(-1.5, Math.min(1.5, V3.pitch + dy * 0.008)); }
    V3.drag = { x: e.clientX, y: e.clientY, pan: V3.drag.pan }; later(draw3DAll);
  });
  c.addEventListener('wheel', e => {                                                         // zoom toward the pointer, so the spot under it stays put
    e.preventDefault(); const r = c.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
    const z = Math.max(.2, Math.min(300, V3.zoom * Math.exp(-e.deltaY * 0.0015))), k = z / V3.zoom, p = V3.pan[id]; V3.zoom = z;
    p[0] = mx - (mx - p[0]) * k; p[1] = my - (my - p[1]) * k; draw3DAll();
  }, { passive: false });
  c.addEventListener('dblclick', () => { V3.yaw = -35 * D2R; V3.pitch = 28 * D2R; V3.zoom = 1; V3.pan.cv3d = [0, 0]; V3.pan.cvAp3d = [0, 0]; draw3DAll(); });
});
const pan3dBtn = $('#b3dPan');
if (pan3dBtn) pan3dBtn.onclick = () => { V3.panMode = !V3.panMode; pan3dBtn.classList.toggle('primary', V3.panMode); pan3dBtn.textContent = V3.panMode ? 'Pan: on' : 'Pan'; };
