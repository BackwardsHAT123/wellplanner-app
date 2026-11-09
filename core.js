/* Well path planner core math. Units: feet, degrees, DLS in deg/100 ft.
 * Frames: N (north), E (east), TVD (down). Azimuth clockwise from grid north.
 * Works in browser (window.WP) and Node (module.exports). */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const norm360 = a => ((a % 360) + 360) % 360;
  const radius = bur => 18000 / (Math.PI * bur); // ft, bur in deg/100 ft

  function dirVec(inc, azi) {
    const i = inc * D2R, a = azi * D2R;
    return [Math.sin(i) * Math.cos(a), Math.sin(i) * Math.sin(a), Math.cos(i)];
  }
  function vecIncAzi(v, fallbackAzi) {
    const inc = Math.acos(clamp(v[2], -1, 1)) * R2D;
    const h = Math.hypot(v[0], v[1]);
    return { inc, azi: h < 1e-9 ? fallbackAzi : norm360(Math.atan2(v[1], v[0]) * R2D) };
  }

  /* ---- Stations from sections ----
   * section = {type:'hold', len}                     hold current inc/azi for len ft MD
   *         | {type:'curve', dls, inc, azi}          constant-dogleg arc to target inc/azi
   */
  function buildStations(sections, interval, start) {
    interval = interval > 1 ? interval : 30;
    let md = 0, inc = (start && start.inc) || 0, azi = (start && start.azi) || 0;
    const st = [{ md, inc, azi, sec: -1 }];
    // MDs for a section: multiples of interval strictly inside, then the exact end
    const grid = (md0, len) => {
      const out = [];
      for (let k = Math.floor(md0 / interval + 1e-9) + 1; k * interval < md0 + len - 1e-6; k++) out.push(k * interval);
      out.push(md0 + len);
      return out;
    };
    sections.forEach((s, idx) => {
      if (s.type === 'hold') {
        const len = Math.max(0, +s.len || 0);
        if (len <= 0) return;
        grid(md, len).forEach(m => st.push({ md: m, inc, azi, sec: idx }));
        md += len;
      } else if (s.type === 'curve') {
        const tInc = clamp(+s.inc || 0, 0, 180), tAzi = norm360(+s.azi || 0), dls = +s.dls;
        const d1 = dirVec(inc, azi), d2 = dirVec(tInc, tAzi);
        const beta = Math.acos(clamp(d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2], -1, 1));
        if (beta < 1e-9 || !(dls > 0)) return;
        const len = beta * R2D / dls * 100;
        const sb = Math.sin(beta), g = grid(md, len);
        g.forEach((m, k) => {
          if (k === g.length - 1) { st.push({ md: md + len, inc: tInc, azi: (tInc === 0 ? azi : tAzi), sec: idx }); return; }
          const t = (m - md) / len;
          const w1 = Math.sin((1 - t) * beta) / sb, w2 = Math.sin(t * beta) / sb;
          const v = [w1 * d1[0] + w2 * d2[0], w1 * d1[1] + w2 * d2[1], w1 * d1[2] + w2 * d2[2]];
          const ia = vecIncAzi(v, tAzi);
          st.push({ md: m, inc: ia.inc, azi: ia.azi, sec: idx });
        });
        md += len; inc = tInc; azi = tInc === 0 ? azi : tAzi;
      }
    });
    return st;
  }

  /* ---- Minimum curvature survey ----
   * o = {n0,e0 (surface grid), kb (KB elev ASL), vsAzi, tie:{md,tvd,n,e}} */
  function computeSurvey(stations, o) {
    o = o || {};
    const vsA = (o.vsAzi || 0) * D2R, kb = o.kb || 0, n0 = o.n0 || 0, e0 = o.e0 || 0;
    let n = 0, e = 0, t = 0;
    const out = [];
    for (let i = 0; i < stations.length; i++) {
      const s = stations[i];
      let dls = 0, br = 0, tr = 0;
      if (i > 0) {
        const p = stations[i - 1], dmd = s.md - p.md;
        const i1 = p.inc * D2R, i2 = s.inc * D2R, a1 = p.azi * D2R, a2 = s.azi * D2R;
        const cb = clamp(Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1)), -1, 1);
        const b = Math.acos(cb);
        const rf = b < 1e-9 ? 1 : (2 / b) * Math.tan(b / 2);
        n += dmd / 2 * (Math.sin(i1) * Math.cos(a1) + Math.sin(i2) * Math.cos(a2)) * rf;
        e += dmd / 2 * (Math.sin(i1) * Math.sin(a1) + Math.sin(i2) * Math.sin(a2)) * rf;
        t += dmd / 2 * (Math.cos(i1) + Math.cos(i2)) * rf;
        if (dmd > 1e-9) {
          dls = b * R2D / dmd * 100;
          br = (s.inc - p.inc) / dmd * 100;
          let da = s.azi - p.azi; if (da > 180) da -= 360; if (da < -180) da += 360;
          tr = (p.inc < 0.5 && s.inc < 0.5) ? 0 : da / dmd * 100;
        }
      }
      out.push({
        md: s.md, inc: s.inc, azi: s.azi, sec: s.sec,
        tvd: t, tvdss: t - kb, n, e,
        vs: n * Math.cos(vsA) + e * Math.sin(vsA),
        dls, br, tr,
        northing: n0 + n, easting: e0 + e,
        cd: Math.hypot(n, e), ca: norm360(Math.atan2(e, n) * R2D)
      });
    }
    return out;
  }

  /* ---- 2D design geometry (vertical plane toward target) ----
   * build1: 0 -> theta at bur1;  tangent: lt at theta;  build2: theta -> phi at bur2 (optional) */
  function geom(bur1, bur2, phi, theta) {
    const t = theta * D2R, R1 = radius(bur1);
    const g = { dT1: R1 * Math.sin(t), dD1: R1 * (1 - Math.cos(t)), md1: R1 * t, dT2: 0, dD2: 0, md2: 0 };
    if (bur2 > 0) {
      const f = phi * D2R, R2 = radius(bur2), s = f >= t ? 1 : -1;
      g.dT2 = s * R2 * (Math.sin(f) - Math.sin(t));
      g.dD2 = s * R2 * (Math.cos(t) - Math.cos(f));
      g.md2 = R2 * Math.abs(f - t);
    }
    return g;
  }

  /* p = {solveFor:'tangent'|'kop', kop, theta, bur1, bur2, phi, tvd, disp} */
  function solve2D(p) {
    const { bur1, bur2, phi, tvd, disp } = p;
    if (!(bur1 > 0)) return { ok: false, msg: 'Build rate 1 must be > 0.' };
    if (p.solveFor === 'kop') {
      const th = p.theta;
      if (!(th > 0 && th < 90)) return { ok: false, msg: 'Tangent inclination must be between 0 and 90.' };
      const g = geom(bur1, bur2, phi, th), tn = Math.tan(th * D2R);
      const kop = tvd - g.dT1 - g.dT2 - (disp - g.dD1 - g.dD2) / tn;
      const lt = (tvd - kop - g.dT1 - g.dT2) / Math.cos(th * D2R);
      if (kop < 0) return { ok: false, msg: 'Solved KOP is above surface (' + kop.toFixed(0) + ' ft). Use a lower tangent inclination or higher build rate.' };
      if (lt < -1e-6) return { ok: false, msg: 'Tangent length is negative. Use a lower tangent inclination or a deeper target.' };
      return { ok: true, theta: th, kop, lt: Math.max(0, lt), md: kop + g.md1 + lt + g.md2, nsol: 1 };
    }
    const kop = p.kop;
    if (!(kop >= 0)) return { ok: false, msg: 'KOP must be >= 0.' };
    const f = th => {
      const g = geom(bur1, bur2, phi, th);
      const lt = (tvd - kop - g.dT1 - g.dT2) / Math.cos(th * D2R);
      return { th, lt, err: g.dD1 + lt * Math.sin(th * D2R) + g.dD2 - disp, g };
    };
    const roots = [];
    let prev = f(0.02);
    for (let th = 0.04; th <= 89.98; th += 0.02) {
      const cur = f(th);
      if (prev.lt >= 0 && cur.lt >= 0 && prev.err * cur.err <= 0 && !(prev.err === 0 && cur.err === 0)) {
        let lo = prev, hi = cur;
        for (let i = 0; i < 60; i++) {
          const mid = f((lo.th + hi.th) / 2);
          if (lo.err * mid.err <= 0) hi = mid; else lo = mid;
        }
        const r = f((lo.th + hi.th) / 2);
        if (r.lt >= -1e-6) roots.push({ theta: r.th, lt: Math.max(0, r.lt), md: kop + r.g.md1 + r.lt + r.g.md2 });
      }
      prev = cur;
    }
    if (!roots.length) {
      const room = tvd - kop;
      return { ok: false, msg: 'No build/hold solution reaches the target (' + room.toFixed(0) +
        ' ft of TVD below KOP for ' + disp.toFixed(0) + ' ft of displacement). Try a shallower KOP, higher build rates, or solve for KOP.' };
    }
    roots.sort((a, b) => a.md - b.md);
    const r = roots[0];
    return { ok: true, theta: r.theta, kop, lt: r.lt, md: r.md, nsol: roots.length };
  }

  function lastAtSection(survey, idx) {
    let r = survey[0];
    for (const s of survey) if (s.sec <= idx) r = s; else break;
    return r;
  }

  /* d = {surface:{n,e}, heel:{n,e,tvd}, toe:{n,e,tvd}, type:'hbh'|'slant'|'scurve'|'vertical',
   *      solveFor, kop, bur1, bur2, tanInc, ext, dropInc}
   * returns {ok, sections, heelIdx, theta, kop, notes, miss, plane, disp, lateral} */
  /* Lateral through an ordered list of targets (first = landing point, last = toe).
   * The landing curve ends at target 1 pointing at target 2. The path then passes EXACTLY through each
   * target: after target k it steers at latDls (an arc in the plane of the current direction and the
   * vector to target k+1) until it points at target k+1, then holds straight to it. */
  function lateralSections(pts, latDls, notes) {
    const v = (a, b) => [b.n - a.n, b.e - a.e, b.tvd - a.tvd];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const norm = a => Math.hypot(a[0], a[1], a[2]);
    const d0 = v(pts[0], pts[1]), l0 = norm(d0);
    if (l0 < 1) return { ok: false, msg: 'Targets 1 and 2 are the same point.' };
    const inc0 = Math.acos(clamp(d0[2] / l0, -1, 1)) * R2D;
    const azi0 = Math.hypot(d0[0], d0[1]) < 0.01 ? 0 : norm360(Math.atan2(d0[1], d0[0]) * R2D);
    const segs = [{ len: l0, inc: inc0, azi: azi0 }];
    const out = [{ type: 'hold', len: l0, name: 'Lateral' }];
    const R = radius(latDls);
    let dir = dirVec(inc0, azi0), total = l0;
    for (let k = 1; k + 1 < pts.length; k++) {
      const w = v(pts[k], pts[k + 1]), L = norm(w);
      if (L < 1) return { ok: false, msg: 'Targets ' + (k + 1) + ' and ' + (k + 2) + ' are the same point.' };
      const qx = dot(w, dir);
      const perp = [w[0] - qx * dir[0], w[1] - qx * dir[1], w[2] - qx * dir[2]];
      const qy = norm(perp);
      if (qy < 1e-6 * L && qx > 0) { out.push({ type: 'hold', len: L, name: 'Lateral' }); total += L; continue; }
      if (qy < 1e-6 * L)
        return { ok: false, msg: 'Target ' + (k + 2) + ' is directly behind the path at target ' + (k + 1) + '; the lateral would have to reverse.' };
      const e2 = [perp[0] / qy, perp[1] / qy, perp[2] / qy];
      const Lc = Math.hypot(qx, qy - R);
      if (Lc < R) {
        const need = 18000 * 2 * qy / (Math.PI * (qx * qx + qy * qy));
        return { ok: false, msg: 'Target ' + (k + 2) + ' cannot be reached from target ' + (k + 1) + ' at ' + latDls + '\u00b0/100 ft; it needs at least ' + (Math.ceil(need * 10) / 10).toFixed(1) + '\u00b0/100 ft. Raise the lateral steering DLS or move the target.' };
      }
      const phi0 = Math.atan2(R - qy, qx);
      let th = Math.asin(R / Lc) - phi0;
      if (th < 0) th += 2 * Math.PI;
      const s = Math.sqrt(Lc * Lc - R * R);
      const nd = [Math.cos(th) * dir[0] + Math.sin(th) * e2[0], Math.cos(th) * dir[1] + Math.sin(th) * e2[1], Math.cos(th) * dir[2] + Math.sin(th) * e2[2]];
      const ia = vecIncAzi(nd, azi0);
      out.push({ type: 'curve', dls: latDls, inc: ia.inc, azi: ia.azi, name: 'Steer' });
      out.push({ type: 'hold', len: s, name: 'Lateral' });
      notes.push('After target ' + (k + 1) + ' the path steers ' + (th * R2D).toFixed(2) + '\u00b0 at ' + latDls + '\u00b0/100 ft to reach target ' + (k + 2) + '.');
      dir = nd; total += L;
    }
    return { ok: true, sections: out, segs, total };
  }

  function planFromTargets(d) {
    const notes = [];
    const pts = d.targets && d.targets.length ? d.targets : [d.heel, d.toe];
    const heel = pts[0];
    const dn = heel.n - d.surface.n, de = heel.e - d.surface.e;
    const disp = Math.hypot(dn, de);
    const az0 = disp > 0.01 ? norm360(Math.atan2(de, dn) * R2D) : 0;
    const ext = Math.max(0, +d.ext || 0);
    const type = d.type;

    if (type === 'vertical') {
      const sections = [{ type: 'hold', len: heel.tvd + ext, name: 'Vertical' }];
      return { ok: true, sections, heelIdx: 0, theta: 0, kop: 0, notes: disp > 5 ? ['Heel is ' + disp.toFixed(0) + ' ft off the surface location; a vertical well will miss it laterally.'] : [], plane: az0, disp };
    }

    let phi = 0, latAz = az0, latLen = 0, lateral = null, latSecs = [];
    if (type === 'hbh') {
      if (pts.length < 2) return { ok: false, msg: 'A horizontal well needs at least two targets: the landing point and a toe.', sections: [] };
      const lat = lateralSections(pts, d.latDls > 0 ? d.latDls : 2, notes);
      if (!lat.ok) return { ok: false, msg: lat.msg, sections: [] };
      latSecs = lat.sections; phi = lat.segs[0].inc; latAz = lat.segs[0].azi; latLen = lat.total;
      lateral = { inc: phi, azi: latAz, len: latLen, segs: lat.segs };
    } else if (type === 'scurve') {
      phi = clamp(+d.dropInc || 0, 0, 89);
    }
    const hasBuild2 = type === 'hbh' || type === 'scurve';
    const bur2 = hasBuild2 ? d.bur2 : 0;
    if (hasBuild2 && !(bur2 > 0)) return { ok: false, msg: 'Build/drop rate 2 must be > 0.', sections: [] };

    const mk = (ap, sol) => {
      const s = [];
      if (sol.kop > 0) s.push({ type: 'hold', len: sol.kop, name: 'Vertical' });
      s.push({ type: 'curve', dls: d.bur1, inc: sol.theta, azi: ap, name: 'Build' });
      if (sol.lt > 1e-6) s.push({ type: 'hold', len: sol.lt, name: 'Tangent' });
      if (type === 'hbh') {
        s.push({ type: 'curve', dls: bur2, inc: phi, azi: latAz, name: 'Landing' });
        latSecs.forEach(x => s.push({ ...x }));
      } else if (type === 'scurve') {
        s.push({ type: 'curve', dls: bur2, inc: phi, azi: ap, name: 'Drop' });
        if (ext > 0) s.push({ type: 'hold', len: ext, name: 'Extension' });
      } else if (ext > 0) s.push({ type: 'hold', len: ext, name: 'Extension' });
      return s;
    };
    const heelIdxOf = s => type === 'hbh' ? s.findIndex(x => x.name === 'Landing')
      : type === 'scurve' ? s.findIndex(x => x.name === 'Drop')
      : (s.some(x => x.name === 'Tangent') ? s.findIndex(x => x.name === 'Tangent') : s.findIndex(x => x.name === 'Build'));

    let ap = az0, tvdE = heel.tvd, dispE = disp, sol = null, sections = null, miss = null;
    const needIter = hasBuild2 && type === 'hbh' && Math.abs(((latAz - az0 + 540) % 360) - 180) > 0.01 && disp > 1;
    const iters = needIter ? 60 : 1;
    for (let it = 0; it < iters; it++) {
      sol = solve2D({ solveFor: d.solveFor, kop: d.kop, theta: d.tanInc, bur1: d.bur1, bur2, phi, tvd: tvdE, disp: dispE });
      if (!sol.ok) return { ok: false, msg: sol.msg, sections: [] };
      sections = mk(ap, sol);
      const hi = heelIdxOf(sections);
      const sv = computeSurvey(buildStations(sections, 60), { n0: d.surface.n, e0: d.surface.e });
      const h = lastAtSection(sv, hi);
      const eN = dn - h.n, eE = de - h.e, eT = heel.tvd - h.tvd;
      miss = { n: eN, e: eE, tvd: eT, dist: Math.hypot(eN, eE, eT) };
      if (!needIter || miss.dist < 0.0005) break;
      const along = eN * Math.cos(ap * D2R) + eE * Math.sin(ap * D2R);
      const cross = -eN * Math.sin(ap * D2R) + eE * Math.cos(ap * D2R);
      dispE += along; tvdE += eT;
      ap = norm360(ap + cross / Math.max(h.cd, 50) * R2D);
    }
    const heelIdx = heelIdxOf(sections);
    if (miss && miss.dist > 1) notes.push('Heel miss after turn correction: ' + miss.dist.toFixed(1) + ' ft. Try aligning lateral azimuth with the surface-to-heel azimuth.');
    if (needIter) notes.push('Lateral azimuth (' + latAz.toFixed(1) + '°) differs from surface-to-heel azimuth (' + az0.toFixed(1) + '°); the landing curve also turns, so its DLS is higher than the build rate.');
    if (sol.nsol > 1) notes.push(sol.nsol + ' tangent solutions found; the shortest-MD one is used.');
    return { ok: true, sections, heelIdx, theta: sol.theta, kop: sol.kop, lt: sol.lt, notes, miss, plane: ap, disp, lateral, az0 };
  }

  /* ---- Offsets and separation ---- */
  function parseSurveyText(text) {
    const rows = [];
    String(text || '').split(/\r?\n/).forEach(line => {
      const p = line.trim().split(/[\s,;\t]+/).map(Number);
      if (p.length >= 3 && p.slice(0, 3).every(isFinite)) rows.push({ md: p[0], inc: p[1], azi: p[2] });
    });
    rows.sort((a, b) => a.md - b.md);
    return rows;
  }

  function ptSegDist(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const l2 = abx * abx + aby * aby + abz * abz;
    let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
    t = clamp(t, 0, 1);
    return { d: Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby), p.z - (a.z + t * abz)), t };
  }

  /* plan, off: surveys with easting/northing/tvdss. ps / os = sampling strides over the plan stations
   * and offset segments (1 = every station). Returns [{i, md, tvd, d, offMd}] for each sampled plan
   * station: d = centre-to-centre distance to the offset path, offMd = offset MD at the closest point. */
  function separation(plan, off, ps, os) {
    ps = ps > 1 ? ps : 1; os = os > 1 ? os : 1;
    const P = s => ({ x: s.easting, y: s.northing, z: s.tvdss });
    const pick = (arr, k) => { const out = []; for (let i = 0; i < arr.length; i += k) out.push(i); if (out[out.length - 1] !== arr.length - 1) out.push(arr.length - 1); return out; };
    const oi = pick(off, os), o = oi.map(i => P(off[i]));
    const res = [];
    for (const i of pick(plan, ps)) {
      const p = P(plan[i]);
      let best = Infinity, om = off[0].md;
      if (o.length === 1) { best = Math.hypot(p.x - o[0].x, p.y - o[0].y, p.z - o[0].z); }
      for (let k = 0; k + 1 < o.length; k++) {
        const r = ptSegDist(p, o[k], o[k + 1]);
        if (r.d < best) { best = r.d; om = off[oi[k]].md + r.t * (off[oi[k + 1]].md - off[oi[k]].md); }
      }
      res.push({ i, md: plan[i].md, tvd: plan[i].tvd, d: best, offMd: om });
    }
    return res;
  }

  /* ---- Pad template ----
   * pad = {ref:{n,e}, refCol, refRow, dx, dy, rot}. Slot (c, r) sits (c-refCol)*dx along the pad X axis and
   * (r-refRow)*dy along the pad Y axis from the reference point. The axes are the grid E / N axes rotated
   * counter-clockwise by rot degrees: X points at azimuth 90-rot, Y at azimuth -rot. */
  function padSlot(pad, c, r) {
    const di = (c - pad.refCol) * pad.dx, dj = (r - pad.refRow) * pad.dy, t = (pad.rot || 0) * D2R;
    return { e: pad.ref.e + di * Math.cos(t) - dj * Math.sin(t), n: pad.ref.n + di * Math.sin(t) + dj * Math.cos(t) };
  }
  function padSlots(pad, cols, rows) {
    const out = [];
    for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) out.push({ c, r, id: 'C' + c + 'R' + r, ...padSlot(pad, c, r) });
    return out;
  }

  /* ---- Coordinate systems: NAD83 / Wyoming State Plane, US survey feet ----
   * Transverse Mercator on GRS80 (Krueger n-series). Zone constants from the EPSG registry
   * (32155-32158; ftUS equivalents 3736-3739). All zones: lat0 40.5, k0 0.9999375. */
  const FT_PER_M = 3937 / 1200; // US survey foot
  const CRS = {
    'WY-E':  { name: 'NAD83 / Wyoming East (FIPS 4901)',         lon0: -(105 + 10 / 60), fe: 200000, fn: 0 },
    'WY-EC': { name: 'NAD83 / Wyoming East Central (FIPS 4902)', lon0: -(107 + 20 / 60), fe: 400000, fn: 100000 },
    'WY-WC': { name: 'NAD83 / Wyoming West Central (FIPS 4903)', lon0: -108.75,          fe: 600000, fn: 0 },
    'WY-W':  { name: 'NAD83 / Wyoming West (FIPS 4904)',         lon0: -(110 + 5 / 60),  fe: 800000, fn: 100000 }
  };
  const TM = (() => {
    const f = 1 / 298.257222101, a = 6378137, k0 = 0.9999375, lat0 = 40.5;
    const n = f / (2 - f), n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
    const e = Math.sqrt(f * (2 - f));
    const A = a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
    const alpha = [n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
      13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
      61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
      49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
      34729 * n5 / 80640 - 3418889 * n6 / 1995840,
      212378941 * n6 / 319334400];
    const beta = [n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360 - 81 * n5 / 512 + 96199 * n6 / 604800,
      n2 / 48 + n3 / 15 - 437 * n4 / 1440 + 46 * n5 / 105 - 1118711 * n6 / 3870720,
      17 * n3 / 480 - 37 * n4 / 840 - 209 * n5 / 4480 + 5569 * n6 / 90720,
      4397 * n4 / 161280 - 11 * n5 / 504 - 830251 * n6 / 7257600,
      4583 * n5 / 161280 - 108847 * n6 / 3991680,
      20648693 * n6 / 638668800];
    const delta = [2 * n - 2 * n2 / 3 - 2 * n3 + 116 * n4 / 45 + 26 * n5 / 45 - 2854 * n6 / 675,
      7 * n2 / 3 - 8 * n3 / 5 - 227 * n4 / 45 + 2704 * n5 / 315 + 2323 * n6 / 945,
      56 * n3 / 15 - 136 * n4 / 35 - 1262 * n5 / 105 + 73814 * n6 / 2835,
      4279 * n4 / 630 - 332 * n5 / 35 - 399572 * n6 / 14175,
      4174 * n5 / 315 - 144838 * n6 / 6237,
      601676 * n6 / 22275];
    // xi, eta (dimensionless) for latitude phi and longitude offset lam (radians)
    const xiEta = (phi, lam) => {
      const s = Math.sin(phi);
      const t = Math.sinh(Math.atanh(s) - e * Math.atanh(e * s));
      const xp = Math.atan2(t, Math.cos(lam)), ep = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
      let xi = xp, eta = ep;
      for (let j = 1; j <= 6; j++) {
        xi += alpha[j - 1] * Math.sin(2 * j * xp) * Math.cosh(2 * j * ep);
        eta += alpha[j - 1] * Math.cos(2 * j * xp) * Math.sinh(2 * j * ep);
      }
      return { xi, eta };
    };
    const xi0 = xiEta(lat0 * D2R, 0).xi;
    return { A, k0, alpha, beta, delta, xiEta, xi0 };
  })();

  /* lat/lon (decimal degrees, NAD83) -> {n, e} in US survey feet for the zone */
  function toGrid(lat, lon, key) {
    const c = CRS[key]; if (!c) throw new Error('Unknown coordinate system: ' + key);
    const r = TM.xiEta(lat * D2R, (lon - c.lon0) * D2R);
    return { e: (c.fe + TM.k0 * TM.A * r.eta) * FT_PER_M, n: (c.fn + TM.k0 * TM.A * (r.xi - TM.xi0)) * FT_PER_M };
  }
  /* {n, e} in US survey feet -> {lat, lon} decimal degrees */
  function toLatLon(n, e, key) {
    const c = CRS[key]; if (!c) throw new Error('Unknown coordinate system: ' + key);
    const xi = (n / FT_PER_M - c.fn) / (TM.k0 * TM.A) + TM.xi0, eta = (e / FT_PER_M - c.fe) / (TM.k0 * TM.A);
    let xp = xi, ep = eta;
    for (let j = 1; j <= 6; j++) {
      xp -= TM.beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      ep -= TM.beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
    let phi = chi;
    for (let j = 1; j <= 6; j++) phi += TM.delta[j - 1] * Math.sin(2 * j * chi);
    const lam = Math.atan2(Math.sinh(ep), Math.cos(xp));
    return { lat: phi * R2D, lon: c.lon0 + lam * R2D };
  }
  /* approximate grid convergence in degrees (true azimuth = grid azimuth + convergence) */
  function convergence(lat, lon, key) {
    const c = CRS[key]; return Math.atan(Math.tan((lon - c.lon0) * D2R) * Math.sin(lat * D2R)) * R2D;
  }
  /* Parse "a, b" typed or pasted by a user. Returns {kind:'ll', lat, lon} | {kind:'xy', x, y} | null.
   * Decimal lat/long in either order is recognised when both numbers are in range and the first or
   * second is plausibly a latitude; anything else is X (easting), Y (northing). */
  function parsePair(text, allowLL) {
    const p = String(text || '').trim().split(/[\s,;\t]+/).filter(Boolean).map(Number);
    if (p.length !== 2 || !p.every(isFinite)) return null;
    const [a, b] = p;
    if (allowLL) {
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180 && Math.abs(b) > 90) return { kind: 'll', lat: a, lon: b };
      if (Math.abs(a) <= 180 && Math.abs(a) > 90 && Math.abs(b) <= 90) return { kind: 'll', lat: b, lon: a };
      if (Math.abs(a) <= 90 && Math.abs(b) <= 90 && (a > 0 && b < 0)) return { kind: 'll', lat: a, lon: b };
      if (Math.abs(a) <= 90 && Math.abs(b) <= 90 && (a < 0 && b > 0)) return { kind: 'll', lat: b, lon: a };
    }
    return { kind: 'xy', x: a, y: b };
  }

  /* ---- Lateral spacing for a pad ----
   * Wells need {surface:{n,e}, targets:[{n,e,tvd}...], d:{type}}. The reference well keeps its targets.
   * Every other horizontal well gets a copy of the reference targets moved sideways (perpendicular to the
   * reference lateral's horizontal direction) by rank * spacing, where rank is the well's place in the
   * order of surface positions across that direction (so laterals fan out in the same order as the
   * surface locations and cannot cross). dir = -1 reverses the fan. stagger moves every other well
   * (odd rank) deeper by that many feet of TVD (negative = shallower). Positive offset = to the right
   * when looking from the landing point toward the toe.
   * Returns {ok, az, assignments:[{index, rank, offset, tvd}], skipped:[index]} */
  function spaceLaterals(wells, refIdx, o) {
    const ref = wells[refIdx];
    if (!ref || ref.d.type !== 'hbh' || ref.targets.length < 2) return { ok: false, msg: 'The reference well needs a horizontal design with at least two targets.' };
    const a = ref.targets[0], b = ref.targets[ref.targets.length - 1];
    const dn = b.n - a.n, de = b.e - a.e;
    if (Math.hypot(dn, de) < 1) return { ok: false, msg: 'The reference lateral has no horizontal direction to space from.' };
    const az = Math.atan2(de, dn), spacing = +o.spacing, dir = o.dir < 0 ? -1 : 1, stagger = +o.stagger || 0;
    if (!(spacing >= 0)) return { ok: false, msg: 'Spacing must be zero or more.' };
    const un = Math.cos(az + Math.PI / 2), ue = Math.sin(az + Math.PI / 2);
    const cross = w => (w.surface.n - ref.surface.n) * un + (w.surface.e - ref.surface.e) * ue;
    const along = w => (w.surface.n - ref.surface.n) * Math.cos(az) + (w.surface.e - ref.surface.e) * Math.sin(az);
    const skipped = [], cand = [];
    wells.forEach((w, i) => { if (i === refIdx || w.d.type === 'hbh') cand.push({ i, c: cross(w), l: along(w) }); else skipped.push(i); });
    cand.sort((x, y) => (Math.abs(x.c - y.c) > 1e-6 ? x.c - y.c : Math.abs(x.l - y.l) > 1e-6 ? x.l - y.l : x.i - y.i));
    const pRef = cand.findIndex(x => x.i === refIdx);
    const assignments = [];
    cand.forEach((x, p) => {
      if (x.i === refIdx) return;
      const rank = p - pRef;
      assignments.push({ index: x.i, rank, offset: rank * spacing * dir, tvd: Math.abs(rank) % 2 ? stagger : 0, n: un * rank * spacing * dir, e: ue * rank * spacing * dir });
    });
    return { ok: true, az: norm360(az / D2R), un, ue, assignments, skipped };
  }

  /* ---- PLSS sections ----
   * plssName('WY060420N0720W0', '18') -> '18 42N/72W' (PLSSID = state, principal meridian, township no.,
   * fraction code, N/S, range no., fraction code, E/W, duplicate). */
  function plssName(id, sec) {
    const m = /^[A-Z]{2}\d{2}(\d{3})(\d)([NS])(\d{3})(\d)([EW])\d$/.exec(String(id || ''));
    if (!m) return String(sec);
    const frac = c => ({ '0': '', '1': '¼', '2': '½', '3': '¾' }[c] || '');
    return parseInt(sec, 10) + ' ' + parseInt(m[1], 10) + frac(m[2]) + m[3] + '/' + parseInt(m[4], 10) + frac(m[5]) + m[6];
  }
  /* ring = [{n,e}...] (closed or not). Returns {d, inside}: d = 0 when the point is inside. */
  function ptRingDist(p, ring) {
    let inside = false, best = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if ((a.e > p.e) !== (b.e > p.e) && p.n < (b.n - a.n) * (p.e - a.e) / (b.e - a.e) + a.n) inside = !inside;
      const abn = b.n - a.n, abe = b.e - a.e, l2 = abn * abn + abe * abe;
      let t = l2 > 0 ? ((p.n - a.n) * abn + (p.e - a.e) * abe) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(p.n - (a.n + t * abn), p.e - (a.e + t * abe)); if (d < best) best = d;
    }
    return { d: inside ? 0 : best, inside };
  }
  function ptInRing(p, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if ((a.e > p.e) !== (b.e > p.e) && p.n < (b.n - a.n) * (p.e - a.e) / (b.e - a.e) + a.n) inside = !inside;
    }
    return inside;
  }
  /* Measured depth spent in each ring. rows = survey rows (md, northing, easting). Each interval between two
   * stations is assigned to the ring that holds its midpoint, so a boundary crossing is good to about one
   * station interval. Returns {foot:[ft per ring], spans:[[ [md0, md1] ...] per ring], none: ft in no ring}. */
  function pathFootage(rings, rows) {
    const foot = rings.map(() => 0), spans = rings.map(() => []); let none = 0, last = -1;
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i], b = rows[i + 1], len = b.md - a.md; if (!(len > 0)) continue;
      const p = { n: (a.northing + b.northing) / 2, e: (a.easting + b.easting) / 2 };
      let hit = -1;
      if (last >= 0 && ptInRing(p, rings[last])) hit = last;
      else for (let k = 0; k < rings.length; k++) if (ptInRing(p, rings[k])) { hit = k; break; }
      if (hit >= 0) {
        foot[hit] += len; const s = spans[hit], t = s[s.length - 1];
        if (t && Math.abs(t[1] - a.md) < 1e-6) t[1] = b.md; else s.push([a.md, b.md]);
      } else none += len;
      last = hit;
    }
    return { foot, spans, none };
  }
  /* Ring moved inward by d (mitred corners; extra points along an edge are fine). ring = [{n,e}...]. */
  function insetRing(ring, d) {
    const k = ring.length; if (k < 3) return ring.slice();
    let area = 0; for (let i = 0; i < k; i++) { const a = ring[i], b = ring[(i + 1) % k]; area += a.e * b.n - b.e * a.n; }
    const sgn = area >= 0 ? 1 : -1;                       // +1 = counter-clockwise with e as x and n as y
    const nrm = (a, b) => { const de = b.e - a.e, dn = b.n - a.n, l = Math.hypot(de, dn) || 1; return { e: -dn / l * sgn, n: de / l * sgn }; };
    const out = [];
    for (let i = 0; i < k; i++) {
      let p = ring[(i + k - 1) % k], q = ring[i], r = ring[(i + 1) % k], guard = 0;
      while (Math.hypot(q.e - p.e, q.n - p.n) < 1e-9 && guard++ < k) p = ring[((i + k - 1 - guard) % k + k) % k];
      const n1 = nrm(p, q), n2 = nrm(q, r), dot = n1.e * n2.e + n1.n * n2.n, f = d / Math.max(1 + dot, 0.2);
      out.push({ n: q.n + (n1.n + n2.n) * f, e: q.e + (n1.e + n2.e) * f });
    }
    return out;
  }
  /* For each ring: shortest horizontal distance from any of the path points {n,e} to it. Returns
   * [{i, d, crossed}] for rings within dist; crossed = a path point lies inside the ring. */
  function sectionsNear(rings, pts, dist) {
    if (!pts.length) return [];
    let n0 = Infinity, n1 = -Infinity, e0 = Infinity, e1 = -Infinity;
    pts.forEach(p => { n0 = Math.min(n0, p.n); n1 = Math.max(n1, p.n); e0 = Math.min(e0, p.e); e1 = Math.max(e1, p.e); });
    const out = [];
    rings.forEach((ring, i) => {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      ring.forEach(q => { a0 = Math.min(a0, q.n); a1 = Math.max(a1, q.n); b0 = Math.min(b0, q.e); b1 = Math.max(b1, q.e); });
      if (a1 < n0 - dist || a0 > n1 + dist || b1 < e0 - dist || b0 > e1 + dist) return;
      let best = Infinity, crossed = false;
      for (const p of pts) {
        if (p.n < a0 - dist || p.n > a1 + dist || p.e < b0 - dist || p.e > b1 + dist) continue;
        const r = ptRingDist(p, ring); if (r.d < best) best = r.d;
        if (r.inside) { crossed = true; break; }
      }
      if (best <= dist) out.push({ i, d: best, crossed });
    });
    return out;
  }

  /* ---- Survey uncertainty (simplified screening model, NOT the ISCWSA tables) ----
   * Position covariance (N,E,V; ft^2) at every station of a survey from five error sources:
   *   random inclination / azimuth error at each station (independent between stations),
   *   systematic inclination / azimuth bias (the same at every station, so errors add coherently),
   *   depth scale error (fraction of measured depth, along the hole).
   * Position response uses d(tangent)/d(inc) and d(tangent)/d(azi) through minimum curvature with
   * the ratio factor taken as 1. Azimuth sigma is held up at low inclination: sigma_A * sin(I) / max(sin(I), 0.3).
   * Presets are rounded values recalled for typical MWD / gyro tools; they have not been checked against
   * a published tool code, so treat the output as a screening estimate. */
  const ERR_PRESETS = {
    mwd:  { label: 'MWD (typical)',  incRand: 0.10, aziRand: 0.30, incBias: 0.10, aziBias: 0.40, depthScale: 0.0005 },
    gyro: { label: 'Gyro (typical)', incRand: 0.05, aziRand: 0.15, incBias: 0.05, aziBias: 0.10, depthScale: 0.0005 }
  };
  function tanDer(inc, azi) {
    const i = inc * D2R, a = azi * D2R;
    return {
      t: [Math.sin(i) * Math.cos(a), Math.sin(i) * Math.sin(a), Math.cos(i)],       // N, E, V
      dI: [Math.cos(i) * Math.cos(a), Math.cos(i) * Math.sin(a), -Math.sin(i)],     // per radian
      dA: [-Math.sin(i) * Math.sin(a), Math.sin(i) * Math.cos(a), 0]                // per radian
    };
  }
  function errorModel(rows, prm) {
    prm = Object.assign({}, ERR_PRESETS.mwd, prm || {});
    const n = rows.length, td = rows.map(r => tanDer(r.inc, r.azi));
    const aziGain = rows.map(r => { const s = Math.sin(r.inc * D2R); return s / Math.max(s, 0.3); });
    const rI = prm.incRand * D2R, rA = prm.aziRand * D2R, bI = prm.incBias * D2R, bA = prm.aziBias * D2R;
    const add = (C, v, s) => { C[0] += s * v[0] * v[0]; C[1] += s * v[0] * v[1]; C[2] += s * v[0] * v[2]; C[3] += s * v[1] * v[1]; C[4] += s * v[1] * v[2]; C[5] += s * v[2] * v[2]; };
    const sysI = [0, 0, 0], sysA = [0, 0, 0], sysD = [0, 0, 0];
    const full = [0, 0, 0, 0, 0, 0];          // random contributions of stations already passed (complete)
    const out = [];
    for (let k = 0; k < n; k++) {
      const dB = k > 0 ? rows[k].md - rows[k - 1].md : 0, dA = k + 1 < n ? rows[k + 1].md - rows[k].md : 0;
      if (k > 0) {
        for (let c = 0; c < 3; c++) {
          sysI[c] += dB / 2 * (td[k - 1].dI[c] + td[k].dI[c]);
          sysA[c] += dB / 2 * (td[k - 1].dA[c] * aziGain[k - 1] + td[k].dA[c] * aziGain[k]);
          sysD[c] += dB / 2 * (td[k - 1].t[c] + td[k].t[c]);
        }
      }
      const C = full.slice();
      // station k itself: only the segment before it has been integrated so far
      add(C, td[k].dI.map(x => x * dB / 2), rI * rI);
      add(C, td[k].dA.map(x => x * aziGain[k] * dB / 2), rA * rA);
      add(C, sysI, bI * bI); add(C, sysA, bA * bA); add(C, sysD, prm.depthScale * prm.depthScale);
      out.push(C);
      // station k is now complete for every later station
      add(full, td[k].dI.map(x => x * (dB + dA) / 2), rI * rI);
      add(full, td[k].dA.map(x => x * aziGain[k] * (dB + dA) / 2), rA * rA);
    }
    return out;     // [cNN, cNE, cNV, cEE, cEV, cVV] per station
  }
  const covQuad = (C, u) => Math.max(0, C[0] * u[0] * u[0] + C[3] * u[1] * u[1] + C[5] * u[2] * u[2] + 2 * (C[1] * u[0] * u[1] + C[2] * u[0] * u[2] + C[4] * u[1] * u[2]));
  /* 1-sigma radius of the position error in direction u (unit N,E,V). */
  function sigmaAlong(C, u) { return Math.sqrt(covQuad(C, u)); }

  /* Separation factor along the line of closest approach, sampled like separation().
   * planCov / offCov = errorModel() output for plan / off. SF = d / (k * sqrt(u'(Cp + Co)u)), k = 2.79
   * (the usual "2.79 sigma" ellipse-edge convention). Adds sf, sigma (1-sigma combined ft), u to each row. */
  function separationSF(plan, off, planCov, offCov, ps, os, k) {
    k = k > 0 ? k : 2.79;
    const res = separation(plan, off, ps, os);
    const mds = off.map(r => r.md);
    res.forEach(r => {
      // offset position and covariance at the closest point
      let j = 0; { let lo = 0, hi = mds.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (mds[m] < r.offMd) lo = m + 1; else hi = m; } j = lo; }
      const j0 = Math.max(0, j - 1), a = off[j0], b = off[Math.min(off.length - 1, j)];
      const t = b.md > a.md ? clamp((r.offMd - a.md) / (b.md - a.md), 0, 1) : 0;
      const op = [a.northing + t * (b.northing - a.northing), a.easting + t * (b.easting - a.easting), a.tvdss + t * (b.tvdss - a.tvdss)];
      const pp = [plan[r.i].northing, plan[r.i].easting, plan[r.i].tvdss];
      let u = [op[0] - pp[0], op[1] - pp[1], op[2] - pp[2]]; const L = Math.hypot(u[0], u[1], u[2]);
      u = L > 1e-9 ? u.map(x => x / L) : [0, 0, 1];
      const Cp = planCov[r.i], Co = offCov[t < 0.5 ? j0 : Math.min(off.length - 1, j)];
      const C = Cp.map((x, q) => x + Co[q]);
      r.sigma = sigmaAlong(C, u); r.u = u;
      r.sf = r.sigma > 1e-9 ? r.d / (k * r.sigma) : Infinity;
    });
    return res;
  }

  /* ---- Actual (as-drilled) surveys: import, tie-in, comparison with the plan ---- */
  /* Reads MD / Inc / Azi from pasted or file text. If a header line names the columns (md|measured, inc|incl|inclination,
   * azi|azim|azimuth) those columns are used, otherwise the first three numbers on each line. Comma, tab, semicolon or
   * spaces. Rows are sorted by MD; repeated MDs are dropped. Returns {rows, skipped, byHeader}. */
  function parseActualText(text) {
    const lines = String(text || '').split(/\r?\n/);
    const split = l => (/[\t,;]/.test(l) ? l.trim().split(/[\t,;]/) : l.trim().split(/\s+/)).map(x => x.trim()).filter(x => x !== '');
    let col = null, byHeader = false;
    for (const l of lines) {
      const t = split(l); if (t.length < 3 || t.some(x => isFinite(+x))) continue;
      const f = (re) => t.findIndex(x => re.test(x.replace(/[^a-z]/gi, '').toLowerCase()));
      const m = f(/^(md|measureddepth|measured|mdft|depth)$/), i = f(/^(inc|incl|inclination|incdeg|inclinationdeg)$/), a = f(/^(azi|azim|azimuth|azideg|azimuthdeg)$/);
      if (m >= 0 && i >= 0 && a >= 0) { col = [m, i, a]; byHeader = true; break; }
    }
    col = col || [0, 1, 2];
    const rows = []; let skipped = 0;
    lines.forEach(l => {
      if (!l.trim()) return;
      const t = split(l), v = col.map(c => parseFloat(t[c]));
      if (t.length > Math.max(...col) && v.every(isFinite) && v[1] >= 0 && v[1] <= 180) rows.push({ md: v[0], inc: v[1], azi: norm360(v[2]) }); else skipped++;
    });
    rows.sort((x, y) => x.md - y.md);
    const out = rows.filter((r, k) => k === 0 || r.md - rows[k - 1].md > 1e-6);
    return { rows: out, skipped: byHeader ? Math.max(0, skipped - 1) : skipped, dropped: rows.length - out.length, byHeader };
  }
  /* Survey for an actual well. tie = {n, e, tvd} offsets (ft from the surface location) of its FIRST station, which
   * lets a partial survey start part-way down the hole; azimuths must already be grid. */
  function actualSurvey(rows, o) {
    o = o || {}; const tie = o.tie || { n: 0, e: 0, tvd: 0 };
    const sv = computeSurvey(rows.map(r => ({ md: r.md, inc: r.inc, azi: r.azi })), { n0: (o.n0 || 0) + tie.n, e0: (o.e0 || 0) + tie.e, kb: (o.kb || 0) - tie.tvd, vsAzi: 0 });
    const vA = (o.vsAzi || 0) * D2R;
    sv.forEach(r => { r.n += tie.n; r.e += tie.e; r.tvd += tie.tvd; r.vs = r.n * Math.cos(vA) + r.e * Math.sin(vA); r.cd = Math.hypot(r.n, r.e); r.ca = norm360(Math.atan2(r.e, r.n) * R2D); });
    return sv;
  }
  /* Plan station at a measured depth, interpolated between neighbours (angles the short way round). */
  function planAtMd(plan, md) {
    let lo = 0, hi = plan.length - 1;
    if (md <= plan[0].md) return Object.assign({}, plan[0]); if (md >= plan[hi].md) return Object.assign({}, plan[hi]);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (plan[m].md <= md) lo = m; else hi = m; }
    const a = plan[lo], b = plan[hi], t = (md - a.md) / (b.md - a.md), L = k => a[k] + t * (b[k] - a[k]);
    let da = b.azi - a.azi; if (da > 180) da -= 360; if (da < -180) da += 360;
    return { md, inc: L('inc'), azi: norm360(a.azi + t * da), tvd: L('tvd'), tvdss: L('tvdss'), n: L('n'), e: L('e'), vs: L('vs'), northing: L('northing'), easting: L('easting') };
  }
  /* How far each actual station is from the plan, measured at the closest point on the plan path:
   * dist (3-D), right (+) / left (-) of the plan heading, high (+) / low (-) of the plan inclination, and the plan
   * MD at that closest point. Both surveys need northing / easting / tvdss. */
  function planVsActual(actual, plan) {
    const sp = separation(actual, plan, 1, 1);
    return sp.map(s => {
      const a = actual[s.i], p = planAtMd(plan, s.offMd), i = p.inc * D2R, az = p.azi * D2R;
      const d = [a.northing - p.northing, a.easting - p.easting, a.tvdss - p.tvdss];                  // N, E, down
      const e1 = [Math.cos(i) * Math.cos(az), Math.cos(i) * Math.sin(az), -Math.sin(i)], e2 = [-Math.sin(az), Math.cos(az), 0];
      const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      return { i: s.i, md: a.md, dist: s.d, planMd: s.offMd, high: dot(d, e1), right: dot(d, e2), along: a.md - s.offMd };
    });
  }

  /* ---- Wall plot helpers ---- */
  /* Distances from point p {n,e} to the ring boundary straight north, south, east and west (null when the ray misses). */
  function ringFootage(ring, p) {
    const out = { n: null, s: null, e: null, w: null };
    const upd = (k, d) => { if (d >= -1e-9 && (out[k] === null || d < out[k])) out[k] = Math.max(0, d); };
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      // vertical line e = p.e crosses the segment? (north / south)
      if ((a.e - p.e) * (b.e - p.e) <= 0 && a.e !== b.e) { const t = (p.e - a.e) / (b.e - a.e), n = a.n + t * (b.n - a.n); if (n >= p.n) upd('n', n - p.n); if (n <= p.n) upd('s', p.n - n); }
      if ((a.n - p.n) * (b.n - p.n) <= 0 && a.n !== b.n) { const t = (p.n - a.n) / (b.n - a.n), e = a.e + t * (b.e - a.e); if (e >= p.e) upd('e', e - p.e); if (e <= p.e) upd('w', p.e - e); }
    }
    return out;
  }
  /* MD at which the path first reaches each formation top: tops [{name, tvd}], survey rows with md/tvd. Tops the
   * path never reaches get md null. Sorted by TVD. */
  /* TVD of a (possibly dipping) top at grid point (n, e). tvd is the depth at the reference point (the surface location);
   * dip (deg) goes down toward the dip direction azi (grid azimuth). No dip: a flat surface. */
  function topTvdAt(t, n, e, ref) {
    const dip = parseFloat(t.dip);
    if (!ref || !isFinite(dip) || dip === 0) return t.tvd;
    const az = (isFinite(parseFloat(t.azi)) ? parseFloat(t.azi) : 0) * D2R;
    return t.tvd + Math.tan(dip * D2R) * ((n - ref.n) * Math.cos(az) + (e - ref.e) * Math.sin(az));
  }
  /* Where each top meets the wellbore: first point of the path at or below the surface. Returns name, tvd (path TVD there),
   * tvd0 (surface depth at the reference point), md (null if never reached), dip, azi; sorted by tvd. */
  function formationMds(tops, survey, ref) {
    return tops.filter(t => isFinite(t.tvd)).map(t => {
      const f = r => r.tvd - topTvdAt(t, r.northing, r.easting, ref);
      let md = null, tvd = t.tvd;
      if (f(survey[0]) >= 0) { md = survey[0].md; tvd = survey[0].tvd; }
      else for (let i = 1; i < survey.length; i++) {
        const fa = f(survey[i - 1]), fb = f(survey[i]);
        if (fb >= 0) { const k = fb > fa ? -fa / (fb - fa) : 1, a = survey[i - 1], b = survey[i]; md = a.md + k * (b.md - a.md); tvd = a.tvd + k * (b.tvd - a.tvd); break; }
      }
      return { name: t.name, tvd, tvd0: t.tvd, md, dip: parseFloat(t.dip) || 0, azi: parseFloat(t.azi) || 0, top: t };
    }).sort((a, b) => a.tvd - b.tvd);
  }
  /* Share of a survey inside one formation zone: between the top named `zone` and the next deeper top (open below when it
   * is the deepest). Dipping tops are evaluated at every point. Only the MD range [lo, hi] counts (default: all).
   * Returns { above, inside, below, total } in feet of measured depth, or null when the zone or survey is unusable. */
  function inZone(survey, tops, ref, zone, lo, hi) {
    const ts = tops.filter(t => isFinite(t.tvd)).sort((a, b) => a.tvd - b.tvd), i = ts.findIndex(t => t.name === zone);
    if (i < 0 || !survey || survey.length < 2) return null;
    const up = ts[i], dn = ts[i + 1] || null, out = { above: 0, inside: 0, below: 0, total: 0 };
    const L = (x, y, k) => x + k * (y - x);
    const g = (t, a, b, k) => L(a.tvd, b.tvd, k) - topTvdAt(t, L(a.northing, b.northing, k), L(a.easting, b.easting, k), ref);   // linear in k: >= 0 once at or below the top
    const lo0 = lo == null ? -Infinity : lo, hi0 = hi == null ? Infinity : hi;
    for (let j = 1; j < survey.length; j++) {
      const a = survey[j - 1], b = survey[j], len = b.md - a.md; if (!(len > 0)) continue;
      const ks = [0, 1];                                            // split where the path crosses either top
      [up, dn].forEach(t => { if (!t) return; const g0 = g(t, a, b, 0), g1 = g(t, a, b, 1); if (g0 * g1 < 0) ks.push(g0 / (g0 - g1)); });
      ks.sort((x, y) => x - y);
      for (let q = 1; q < ks.length; q++) {
        const m0 = a.md + ks[q - 1] * len, m1 = a.md + ks[q] * len, ov = Math.min(m1, hi0) - Math.max(m0, lo0); if (ov <= 0) continue;
        const km = (ks[q - 1] + ks[q]) / 2;
        out[g(up, a, b, km) < 0 ? 'above' : dn && g(dn, a, b, km) >= 0 ? 'below' : 'inside'] += ov; out.total += ov;
      }
    }
    return out;
  }

  /* Carry the last two actual stations forward at their own build and turn rates (per foot of MD), `len` ft in `step` ft
   * stations. rows: actual survey rows (md, inc, azi, n, e, tvd, tvdss, northing, easting). Returns { br, tr, rows } with
   * br / tr in deg per 100 ft; rows are the projected stations after the last one, in the same shape as the survey. */
  function projectAhead(rows, len, step, vsAzi) {
    if (!rows || rows.length < 2 || !(len > 0)) return null;
    const a = rows[rows.length - 2], b = rows[rows.length - 1], dmd = b.md - a.md; if (!(dmd > 1e-9)) return null;
    let da = b.azi - a.azi; if (da > 180) da -= 360; if (da < -180) da += 360;
    const bpf = (b.inc - a.inc) / dmd, tpf = (b.inc < 0.5 && a.inc < 0.5) ? 0 : da / dmd;
    const st = [{ md: b.md, inc: b.inc, azi: b.azi }], h = step > 0 ? step : 30, nst = Math.max(1, Math.ceil(len / h - 1e-9));
    for (let k = 1; k <= nst; k++) { const d = Math.min(k * h, len); st.push({ md: b.md + d, inc: clamp(b.inc + bpf * d, 0, 180), azi: norm360(b.azi + tpf * d) }); }
    const vA = (vsAzi || 0) * D2R;
    const out = computeSurvey(st, { n0: b.northing - b.n, e0: b.easting - b.e }).slice(1);
    out.forEach(r => { r.n += b.n; r.e += b.e; r.tvd += b.tvd; r.tvdss += b.tvdss; r.northing += b.n; r.easting += b.e;
      r.vs = r.n * Math.cos(vA) + r.e * Math.sin(vA); r.cd = Math.hypot(r.n, r.e); r.ca = norm360(Math.atan2(r.e, r.n) * R2D); });
    return { br: bpf * 100, tr: tpf * 100, rows: out };
  }
  /* Constant-curvature arc from station `from` (inc, azi, tvd, northing, easting) that meets the plan `dist` ft of plan MD
   * further along than the plan point closest to it. Returns { dls, tf (deg from the high side, -180..180), arc (ft of hole),
   * inc, azi (direction on arrival), target (plan station), plan (plan direction there) }, or { error }. */
  function rejoinPlan(from, plan, planMd, dist) {
    const tg = planAtMd(plan, planMd + dist), i0 = from.inc * D2R, a0 = from.azi * D2R;
    const t0 = [Math.sin(i0) * Math.cos(a0), Math.sin(i0) * Math.sin(a0), Math.cos(i0)];
    const c = [tg.northing - from.northing, tg.easting - from.easting, tg.tvd - from.tvd], C = Math.hypot(c[0], c[1], c[2]);
    if (C < 1e-6) return { error: 'The bit is already at that plan point.' };
    const u = c.map(x => x / C), dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2], cp = clamp(dot(t0, u), -1, 1), phi = Math.acos(cp);
    if (phi > 85 * D2R) return { error: 'That plan point is behind or beside the bit; use a longer distance.' };
    const arc = phi < 1e-9 ? C : C * phi / Math.sin(phi), dls = phi < 1e-9 ? 0 : 2 * phi * R2D / arc * 100;
    const t1 = u.map((x, i) => 2 * cp * x - t0[i]);
    const n = u.map((x, i) => x - cp * t0[i]), nl = Math.hypot(n[0], n[1], n[2]);
    const e1 = [Math.cos(i0) * Math.cos(a0), Math.cos(i0) * Math.sin(a0), -Math.sin(i0)], e2 = [-Math.sin(a0), Math.cos(a0), 0];
    const tf = nl < 1e-12 ? 0 : Math.atan2(dot(n, e2), dot(n, e1)) * R2D;
    return { dls, tf, arc, inc: Math.acos(clamp(t1[2], -1, 1)) * R2D, azi: norm360(Math.atan2(t1[1], t1[0]) * R2D), target: tg, plan: { inc: tg.inc, azi: tg.azi } };
  }

  /* JSON.stringify with indent, but arrays of plain numbers (log curves, survey columns) stay on one line so a saved well
   * is a few hundred lines and diffs stay readable. Parses back to exactly the same value. */
  function compactJson(v) {
    const s = JSON.stringify(v, null, 2), num = '(?:-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|null)';
    return s.replace(new RegExp('\\[\\s*(' + num + '(?:,\\s*' + num + ')*)\\s*\\]', 'g'), (m, body) => '[' + body.replace(/,\s*/g, ', ') + ']');
  }

  /* CSV of an actual survey against the plan: one line per station (rows from actualSurvey, dev from planVsActual). */
  function actualCsv(rows, dev) {
    const f = (v, d) => isFinite(v) ? (+v).toFixed(d) : '', L = ['MD_ft,Inc_deg,Azi_deg,TVD_ft,TVDSS_ft,VS_ft,DLS_deg_per_100ft,Northing_ft,Easting_ft,Dist_to_plan_ft,Right_ft,High_ft,Plan_MD_ft'];
    rows.forEach((r, i) => { const d = dev && dev[i] || {};
      L.push([f(r.md, 2), f(r.inc, 2), f(r.azi, 2), f(r.tvd, 2), f(r.tvdss, 2), f(r.vs, 2), f(r.dls, 2), f(r.northing, 2), f(r.easting, 2), f(d.dist, 2), f(d.right, 2), f(d.high, 2), f(d.planMd, 2)].join(',')); });
    return L.join('\n') + '\n';
  }

  /* Toolface (deg) of the curve from (inc1, azi1) to (inc2, azi2). From (near) vertical it is the target azimuth, 0..360;
   * otherwise -180..180 from the high side. */
  function toolFace(i1, a1, i2, a2) {
    if (i1 < 0.01) return norm360(a2);
    const I1 = i1 * D2R, I2 = i2 * D2R, dA = (a2 - a1) * D2R;
    const num = Math.sin(I2) * Math.sin(dA), den = Math.sin(I2) * Math.cos(I1) * Math.cos(dA) - Math.cos(I2) * Math.sin(I1);
    return Math.atan2(num, den) * R2D;
  }
  /* Rows of the wall plot "section details" table: the surface row, then the end of each design section, with dogleg,
   * toolface, vertical section and a note on the section that starts there. ends[i] = end row of sections[i] (or null). */
  function wallSectionRows(sections, ends, first) {
    const rows = [Object.assign({ dls: 0, tf: 0, note: '' }, first)];
    let prev = first;
    sections.forEach((sc, i) => {
      const e = ends[i]; if (!e) return;
      const curve = sc.type === 'curve';
      rows.push(Object.assign({}, e, { dls: curve ? sc.dls : 0, tf: curve ? toolFace(prev.inc, prev.azi, e.inc, e.azi) : 0, note: '', _sec: i }));
      prev = e;
    });
    for (let k = 1; k < rows.length; k++) {
      const r = rows[k], nx = rows[k + 1], sc = sections[nx ? nx._sec : -1];
      if (!nx) { r.note = 'TD at ' + r.md.toFixed(1); continue; }
      if (sc.type === 'hold') r.note = 'Start ' + (nx.md - r.md).toFixed(1) + ' hold at ' + r.md.toFixed(1) + ' MD';
      else if (r.inc < 0.5) r.note = 'Start Build ' + sc.dls.toFixed(2);
      else if (Math.abs(((nx.azi - r.azi + 540) % 360) - 180) < 0.01) r.note = 'Start ' + (nx.inc > r.inc ? 'Build ' : 'Drop ') + sc.dls.toFixed(2);
      else r.note = 'Start DLS ' + sc.dls.toFixed(2) + ' TFO ' + nx.tf.toFixed(2);
    }
    return rows;
  }


  /* ---- well logs (LAS 2.0 / 3.0) ---- */
  function parseLAS(text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    const out = { ok: false, error: '', version: '', wrap: false, nullVal: -999.25, well: '', depthUnit: '', toFeet: 1, curves: [], depth: [], cols: [] };
    let sec = '', dataLines = [], curves = [];
    const hdr = ln => { const m = /^\s*([^.:]+?)\s*\.(\S*)\s*(.*?)\s*:(.*)$/.exec(ln); return m ? { mnem: m[1].trim(), unit: m[2].trim(), val: m[3].trim(), desc: m[4].trim() } : null; };
    for (const raw of lines) {
      const ln = raw.trim(); if (!ln || ln[0] === '#') continue;
      if (ln[0] === '~') {
        const nm = ln.slice(1).trim().toLowerCase();
        sec = /^log_def|^c/.test(nm) ? 'C' : /^log_data|^a/.test(nm) ? 'A' : /^v/.test(nm) ? 'V' : /^w|^well/.test(nm) ? 'W' : 'X';
        continue;
      }
      if (sec === 'A') { dataLines.push(ln); continue; }
      const h = hdr(ln); if (!h) continue;
      const k = h.mnem.toUpperCase();
      if (sec === 'V') { if (k === 'VERS') out.version = h.val; if (k === 'WRAP') out.wrap = /^y/i.test(h.val); }
      else if (sec === 'W') { if (k === 'NULL') { const v = parseFloat(h.val); if (isFinite(v)) out.nullVal = v; } if (k === 'WELL') out.well = h.val; if (k === 'STRT' && !out.depthUnit) out.depthUnit = h.unit; }
      else if (sec === 'C') curves.push({ mnem: h.mnem, unit: h.unit, desc: h.desc });
    }
    if (!curves.length) { out.error = 'No curve information (~C section) found. Is this a LAS file?'; return out; }
    if (!dataLines.length) { out.error = 'No data (~A section) found.'; return out; }
    const nc = curves.length, tok = dataLines.join(' ').split(/[\s,]+/).filter(Boolean);
    const n = Math.floor(tok.length / nc);
    if (n < 2) { out.error = 'Fewer than two data rows found.'; return out; }
    const cols = curves.map(() => new Array(n));
    for (let i = 0; i < n; i++) for (let j = 0; j < nc; j++) {
      const v = parseFloat(tok[i * nc + j]);
      cols[j][i] = isFinite(v) && Math.abs(v - out.nullVal) > 1e-6 ? v : null;
    }
    const du = (curves[0].unit || out.depthUnit || '').toLowerCase();
    if (/^(m|meter|meters|metre|metres)$/.test(du)) out.toFeet = 3.280839895;
    out.depthUnit = out.toFeet === 1 ? 'ft' : 'm';
    const idx = []; for (let i = 0; i < n; i++) if (cols[0][i] !== null) idx.push(i);
    if (idx.length < 2) { out.error = 'The depth column is empty.'; return out; }
    if (cols[0][idx[0]] > cols[0][idx[idx.length - 1]]) idx.reverse();
    out.depth = idx.map(i => cols[0][i] * out.toFeet);
    out.curves = curves.slice(1);
    out.cols = cols.slice(1).map(c => idx.map(i => c[i]));
    out.ok = true; return out;
  }
  /* compact stored form: uniform depth -> {d0, dstep}, else {md:[...]}; values rounded, null kept */
  function packLogCurve(meta, depth, vals) {
    const n = depth.length, step = (depth[n - 1] - depth[0]) / (n - 1);
    let uni = step > 0; for (let i = 0; i < n && uni; i++) if (Math.abs(depth[i] - (depth[0] + i * step)) > 0.005) uni = false;
    const v = vals.map(x => x === null ? null : Math.round(x * 1000) / 1000);
    const c = Object.assign({}, meta);
    if (uni) { c.d0 = Math.round(depth[0] * 1000) / 1000; c.dstep = Math.round(step * 10000) / 10000; } else c.md = depth.map(x => Math.round(x * 100) / 100);
    c.v = v; return c;
  }
  const logDepth = (c, i) => c.md ? c.md[i] : c.d0 + i * c.dstep;
  const logRange = c => c && c.v && c.v.length ? [logDepth(c, 0), logDepth(c, c.v.length - 1)] : null;
  /* points inside [lo, hi], thinned to about maxPts keeping each bucket's min and max so peaks survive */
  function logSeries(c, lo, hi, maxPts) {
    const n = c.v.length, idx = [];
    for (let i = 0; i < n; i++) { if (c.v[i] === null) continue; const d = logDepth(c, i); if (d >= lo && d <= hi) idx.push(i); }
    const cap = maxPts || 1500;
    if (idx.length <= cap) return idx.map(i => [logDepth(c, i), c.v[i]]);
    const B = Math.ceil(idx.length / (cap / 2)), res = [];
    for (let b = 0; b < idx.length; b += B) {
      let mn = idx[b], mx = idx[b];
      for (let k = b; k < Math.min(b + B, idx.length); k++) { if (c.v[idx[k]] < c.v[mn]) mn = idx[k]; if (c.v[idx[k]] > c.v[mx]) mx = idx[k]; }
      (mn < mx ? [mn, mx] : mn > mx ? [mx, mn] : [mn]).forEach(i => res.push([logDepth(c, i), c.v[i]]));
    }
    return res;
  }

  /* colour ramp: stops [{v, c:'#rrggbb'}] sorted by v; values outside the first/last stop take that stop's colour */
  function colorAt(stops, v) {
    const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    if (!stops.length) return '#888888';
    if (v <= stops[0].v) return stops[0].c; if (v >= stops[stops.length - 1].v) return stops[stops.length - 1].c;
    let k = 1; while (stops[k].v < v) k++;
    const a = stops[k - 1], b = stops[k], t = b.v === a.v ? 0 : (v - a.v) / (b.v - a.v), A = hex(a.c), B = hex(b.c);
    return 'rgb(' + A.map((x, i) => Math.round(x + t * (B[i] - x))).join(',') + ')';
  }

  const api = { actualCsv, compactJson, colorAt, inZone, projectAhead, rejoinPlan, parseLAS, packLogCurve, logDepth, logRange, logSeries, ringFootage, formationMds, topTvdAt, toolFace, wallSectionRows, parseActualText, actualSurvey, planAtMd, planVsActual, ERR_PRESETS, errorModel, sigmaAlong, separationSF, D2R, R2D, norm360, radius, dirVec, buildStations, computeSurvey, geom, solve2D,
    plssName, ptRingDist, sectionsNear, insetRing, ptInRing, pathFootage,
    planFromTargets, lateralSections, lastAtSection, parseSurveyText, separation, ptSegDist, padSlot, padSlots, spaceLaterals,
    CRS, FT_PER_M, toGrid, toLatLon, convergence, parsePair };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WP = api;
})(typeof window !== 'undefined' ? window : globalThis);
