'use strict';
/* wall plot and drill plan reports (split from index.html; loaded in order, shares globals) */
/* ================= wall plot ================= */
/* A one-page landscape Letter plot like a standard wall plot: header, formation tops, design targets, section details,
 * plan view and a close-up section view. Built as SVG in points (1/72 in) so printing to PDF stays vector. */
const WALL = { on: false };
const ZONE_NAME = { 'WY-E': 'Wyoming Eastern Zone', 'WY-EC': 'Wyoming East Central Zone', 'WY-WC': 'Wyoming West Central Zone', 'WY-W': 'Wyoming Western Zone' };
let wallLogo = window.WALL_LOGO || null;
try { const t = JSON.parse(localStorage.getItem('wellplanner.wallLogo') || 'null'); if (t && t.src) wallLogo = t; } catch (e) {}
const r2 = v => Math.round(v * 100) / 100;
const wallNice = (v, list) => list.find(x => x >= v) || list[list.length - 1];
function wallShortId(name) { const m = String(name).replace(/^[^\d]*?(?=\d)/, ''); return /\d/.test(name) ? m : name; }
function wallFootage() {
  const w = state.wall; if (w.footText && w.footText.trim()) return w.footText.trim();
  if (!isLL() || !M.survey) return '';
  const p = { n: state.surface.n, e: state.surface.e }, sec = secNear().find(x => WP.ptInRing(p, x.ring)); if (!sec) return '';
  const f = WP.ringFootage(sec.ring, p), pick = {
    fnl: ['FNL', f.n], fsl: ['FSL', f.s], fel: ['FEL', f.e], fwl: ['FWL', f.w]
  };
  let a, b;
  if (w.foot === 'auto') { a = f.n !== null && (f.s === null || f.n <= f.s) ? pick.fnl : pick.fsl; b = f.e !== null && (f.w === null || f.e <= f.w) ? pick.fel : pick.fwl; }
  else { const m = { fnlfel: ['fnl', 'fel'], fnlfwl: ['fnl', 'fwl'], fslfel: ['fsl', 'fel'], fslfwl: ['fsl', 'fwl'] }[w.foot] || ['fnl', 'fel']; a = pick[m[0]]; b = pick[m[1]]; }
  return [a, b].filter(x => x[1] !== null).map(x => `${x[1].toFixed(1)} ${x[0]}`).join('   ');
}
function wallSvg() {
  if (!M.survey) return '';
  const s = state, w = s.wall, sv = M.survey, surf = s.surface, F = 'Helvetica, Arial, sans-serif';
  const ll = isLL() ? WP.toLatLon(surf.n, surf.e, s.crs) : null, conv = ll ? WP.convergence(ll.lat, ll.lon, s.crs) : 0;
  const trueN = -conv;
  const esc2 = x => esc(String(x));
  let o = '';
  const T = (x, y, str, sz, a = {}) => { o += `<text x="${r2(x)}" y="${r2(y)}" font-size="${sz}"${a.anchor ? ` text-anchor="${a.anchor}"` : ''}${a.bold ? ' font-weight="bold"' : ''}${a.fill ? ` fill="${a.fill}"` : ''}${a.rot ? ` transform="rotate(${a.rot} ${r2(x)} ${r2(y)})"` : ''}>${esc2(str)}</text>`; };
  const L = (x1, y1, x2, y2, col = '#000', wd = .6, dash) => { o += `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="${col}" stroke-width="${wd}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`; };
  const PL = (pts, col, wd, dash, close) => { o += `<${close ? 'polygon' : 'polyline'} points="${pts.map(p => r2(p[0]) + ',' + r2(p[1])).join(' ')}" fill="none" stroke="${col}" stroke-width="${wd}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`; };

  /* ---- logo ---- */
  if (wallLogo) { const lw = 150, lh = lw * wallLogo.h / wallLogo.w; o += `<image href="${wallLogo.src}" x="14" y="10" width="${lw}" height="${r2(lh)}"/>`; }

  /* ---- formation tops (left) ---- */
  const tops = WP.formationMds(s.tops, sv, surf).filter(t => t.md !== null);
  let yL = 152; T(88, yL, 'FORMATION TOP DETAILS', 8.3, { anchor: 'middle' }); yL += 19;
  T(49, yL, 'TVDPath', 8.3, { anchor: 'end' }); T(86, yL, 'MDPath', 8.3, { anchor: 'end' }); T(138, yL, 'Formation', 8.3, { anchor: 'middle' }); yL += 9;
  tops.forEach(t => { T(49, yL, t.tvd.toFixed(1), 8.3, { anchor: 'end' }); T(86, yL, t.md.toFixed(1), 8.3, { anchor: 'end' }); T(138, yL, t.name, 8.3, { anchor: 'middle' }); yL += 9.2; });

  /* ---- header block ---- */
  const cx = 335;
  T(cx, 22, s.name, 10.2, { anchor: 'middle', bold: true });
  const foot = wallFootage(); if (foot) T(cx, 34, foot, 9.8, { anchor: 'middle' });
  if (ll) { T(cx, 55, 'North American Datum 1983', 9.8, { anchor: 'middle' }); T(cx, 66, 'US State Plane 1983', 9.8, { anchor: 'middle' }); T(cx, 77, ZONE_NAME[s.crs] || WP.CRS[s.crs].name, 9.8, { anchor: 'middle' }); }
  else T(cx, 62, 'Local grid coordinates', 9.8, { anchor: 'middle' });
  T(cx - 46, 99, 'GL: ' + (+s.gl).toFixed(1), 9.8, { anchor: 'end' }); T(cx - 32, 99, `WELL @ ${(+s.kb).toFixed(1)}usft (Original Well Elev)`, 9.8);
  if (ll) { T(cx - 46, 110, 'Latitude ' + ll.lat.toFixed(6), 9.8, { anchor: 'end' }); T(cx + 9, 110, 'Longitude ' + ll.lon.toFixed(6), 9.8); }
  T(cx - 46, 121, 'Easting ' + surf.e.toFixed(2), 9.8, { anchor: 'end' }); T(cx + 9, 121, 'Northing ' + surf.n.toFixed(2), 9.8);

  /* ---- design targets ---- */
  const tg = usedTargets(), id = wallShortId(s.name), tname = t => w.wellId && id ? `${t.name} - ${id}` : t.name;
  let yC = 140; T(cx, yC, 'DESIGN TARGET DETAILS', 6.8, { anchor: 'middle' }); yC += 8; T(cx - 6, yC, 'Plan: ' + (w.plan || ''), 6.8, { anchor: 'start' }); yC += 15;
  const col = { name: 215, tvd: 273, ns: 305, ew: 335, n: 405, e: 450 };
  T(col.name, yC, 'Name', 6.8, { anchor: 'middle' }); T(col.tvd, yC, 'TVD', 6.8, { anchor: 'middle' }); T(col.ns, yC, '+N/-S', 6.8, { anchor: 'middle' }); T(col.ew, yC, '+E/-W', 6.8, { anchor: 'middle' });
  T(col.n, yC, 'Northing', 6.8, { anchor: 'middle' }); T(col.e, yC, 'Easting', 6.8, { anchor: 'middle' }); yC += 8;
  tg.forEach((t, i) => {
    T(173, yC, tname(t), 6.8); T(col.tvd, yC, (+t.tvd).toFixed(1), 6.8, { anchor: 'middle' }); T(col.ns, yC, (t.n - surf.n).toFixed(1), 6.8, { anchor: 'middle' }); T(col.ew, yC, (t.e - surf.e).toFixed(1), 6.8, { anchor: 'middle' });
    T(col.n, yC, (+t.n).toFixed(2), 6.8, { anchor: 'middle' }); T(col.e, yC, (+t.e).toFixed(2), 6.8, { anchor: 'middle' });
    const ms = M.misses && M.misses[i]; yC += 7.5;
    T(253, yC, ms ? (ms.d < 0.5 ? '- plan hits target center' : `- plan passes ${ms.d.toFixed(1)}usft from target center`) : '', 6.8); yC += 7.5;
  });

  /* ---- section details ---- */
  const rows = WP.wallSectionRows(M.sections, M.secEnds, sv[0]);
  const oMain = o, secTop = yC - 4; o = '';
  yC += 4; T(cx + 25, yC, 'SECTION DETAILS', 6.8, { anchor: 'middle' }); yC += 13;
  const sc = [178, 203, 232, 257, 286, 318, 345, 371, 394, 424];
  ['Sec', 'MD', 'Inc', 'Azi', 'TVD', '+N/-S', '+E/-W', 'Dleg', 'TFace', 'VSect'].forEach((h, i) => T(sc[i], yC, h, 6.8, { anchor: 'middle' })); T(446, yC, 'Annotation', 6.8); yC += 8;
  rows.forEach((r, i) => {
    const v = [String(i + 1), r.md.toFixed(1), r.inc.toFixed(2), r.azi.toFixed(2), r.tvd.toFixed(1), r.n.toFixed(1), r.e.toFixed(1), r.dls.toFixed(2), r.tf.toFixed(2), r.vs.toFixed(1)];
    v.forEach((x, k) => T(sc[k], yC, x, 6.8, { anchor: 'middle' })); T(446, yC, r.note, 6.8); yC += 7.7;
  });
  const secOut = o, secBot = yC - 2; o = oMain;
  const secLeft = 160, secRight = Math.max(500, 446 + 3.4 * Math.max(0, ...rows.map(r => String(r.note).length)) + 6);
  const plotTop = Math.max(yC, yL, 300) + 10;

  /* ---- plan view (right) ---- */
  const PX0 = 506, PX1 = 738, PY0 = 40, PY1 = plotTop - 12, pw = PX1 - PX0, ph = PY1 - PY0;
  const pathPts = sv.map(r => [r.easting - surf.e, r.northing - surf.n]).concat(tg.map(t => [t.e - surf.e, t.n - surf.n]));
  const bx0 = Math.min(...pathPts.map(p => p[0])), bx1 = Math.max(...pathPts.map(p => p[0])), by0 = Math.min(...pathPts.map(p => p[1])), by1 = Math.max(...pathPts.map(p => p[1]));
  const scaleList = [100, 200, 250, 300, 400, 500, 600, 750, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000];
  const fit = Math.max((bx1 - bx0) / (pw / 72 * .86), (by1 - by0) / (ph / 72 * .86), 1);
  const ftIn = parseFloat(w.scale) > 0 ? parseFloat(w.scale) : wallNice(fit, scaleList), k = 72 / ftIn;     // points per ft
  const ccx = (bx0 + bx1) / 2, ccy = (by0 + by1) / 2, PXf = e => PX0 + pw / 2 + (e - ccx) * k, PYf = n => PY0 + ph / 2 - (n - ccy) * k;
  o += `<defs><clipPath id="cpPlan"><rect x="${PX0}" y="${PY0}" width="${pw}" height="${ph}"/></clipPath></defs>`;
  o += `<rect x="${PX0}" y="${PY0}" width="${pw}" height="${ph}" fill="none" stroke="#000" stroke-width=".7"/>`;
  const major = ftIn / 2, minor = major / 5;
  const eLo = ccx - pw / 2 / k, eHi = ccx + pw / 2 / k, nLo = ccy - ph / 2 / k, nHi = ccy + ph / 2 / k;
  for (let e = Math.ceil(eLo / minor) * minor; e <= eHi; e += minor) { const big = Math.abs(e / major - Math.round(e / major)) < 1e-6; L(PXf(e), PY0, PXf(e), PY0 - (big ? 7 : 3.5), '#000', big ? .8 : .5); if (big) T(PXf(e), PY0 - 10, String(Math.round(e)), 7.1, { anchor: 'middle' }); }
  for (let n = Math.ceil(nLo / minor) * minor; n <= nHi; n += minor) { const big = Math.abs(n / major - Math.round(n / major)) < 1e-6; L(PX1, PYf(n), PX1 + (big ? 7 : 3.5), PYf(n), '#000', big ? .8 : .5); if (big) T(PX1 + 9, PYf(n) + 2.5, String(Math.round(n)), 7.1); }
  T((PX0 + PX1) / 2, PY0 - 24, `West(-)/East(+) (${ftIn} usft/in)`, 8.4, { anchor: 'middle' });
  T(PX1 + 36, (PY0 + PY1) / 2, `South(-)/North(+) (${ftIn} usft/in)`, 8.4, { anchor: 'middle', rot: 90 });
  o += `<g clip-path="url(#cpPlan)">`;
  const secs = w.secs === 'none' ? [] : w.secs === 'near' ? secNear() : secNear().filter(x => x.foot > 0);
  secs.forEach(x => {
    PL(x.ring.map(q => [PXf(q.e - surf.e), PYf(q.n - surf.n)]), '#e03030', .8, null, true);
    if (w.setback && SEC.sb > 0) PL(WP.insetRing(x.ring, SEC.sb).map(q => [PXf(q.e - surf.e), PYf(q.n - surf.n)]), '#2e7d32', 1.2, '5 3', true);
  });
  secs.forEach(x => {
    const cn = x.ring.reduce((a, q) => a + q.n, 0) / x.ring.length, ce = x.ring.reduce((a, q) => a + q.e, 0) / x.ring.length;
    T(PXf(ce - surf.e), PYf(cn - surf.n), WP.plssName(x.s.id, x.s.sec), 7.3, { anchor: 'middle', bold: true });
  });
  PL(sv.filter((_, i) => i % 3 === 0 || i === sv.length - 1).map(r => [PXf(r.easting - surf.e), PYf(r.northing - surf.n)]), '#0000ff', 1.6);
  // rig at the surface location
  const rx = PXf(0), ry = PYf(0); PL([[rx - 5, ry], [rx + 5, ry], [rx + 2, ry - 14], [rx - 2, ry - 14]], '#000', .8, null, true); L(rx - 5, ry, rx + 2, ry - 14, '#000', .6); L(rx + 5, ry, rx - 2, ry - 14, '#000', .6); L(rx - 9, ry, rx + 9, ry, '#000', 1);
  tg.forEach((t, i) => {
    const x = PXf(t.e - surf.e), y = PYf(t.n - surf.n), side = i % 2 ? 1 : -1, lx = x + side * 26, ly = y - 14;
    L(x - 8, y, x + 8, y, '#e03030', 1); L(x, y, lx, ly, '#000', .5, '3 2'); T(lx, ly - 2, tname(t), 7.1, { anchor: side > 0 ? 'start' : 'middle' });
  });
  o += `</g>`;

  /* ---- section view (bottom) ---- */
  const X0 = 58, X1 = 770, Y0 = plotTop + 6, Y1 = 574, vsAzi = M.vsAzi;
  const tvds = tg.map(t => +t.tvd), maxT = Math.max(...tvds, sv[sv.length - 1].tvd);
  let yMax = parseFloat(w.tvdMax), yMin = parseFloat(w.tvdMin);
  if (!isFinite(yMax)) yMax = Math.ceil((maxT + 150) / 250) * 250;
  if (!isFinite(yMin)) yMin = Math.max(0, yMax - 2000);
  const ySpan = yMax - yMin, yStep = wallNice(ySpan / 5, [50, 100, 200, 250, 400, 500, 1000, 2000]);
  const vsAll = sv.map(r => r.vs), vLo0 = Math.min(...vsAll), vHi0 = Math.max(...vsAll), vSpan0 = Math.max(vHi0 - vLo0, 100);
  const xStep = wallNice(vSpan0 / 15, [50, 100, 200, 250, 500, 600, 1000, 2000]);
  const xMin = Math.floor((vLo0 - vSpan0 * .04) / xStep) * xStep, xMax = Math.ceil((vHi0 + vSpan0 * .04) / xStep) * xStep;
  const SX = v => X0 + (v - xMin) / (xMax - xMin) * (X1 - X0), SY = d => Y0 + (d - yMin) / ySpan * (Y1 - Y0);
  o += `<defs><clipPath id="cpSec"><rect x="${X0}" y="${Y0}" width="${X1 - X0}" height="${Y1 - Y0}"/></clipPath></defs>`;
  for (let d = Math.ceil(yMin / yStep) * yStep; d <= yMax + 1e-6; d += yStep) { L(X0, SY(d), X1, SY(d), '#cfcfcf', .6); L(X0 - 7, SY(d), X0, SY(d), '#000', .8); T(X0 - 10, SY(d) + 2, String(Math.round(d)), 5.5, { anchor: 'end' }); }
  for (let d = Math.ceil(yMin / (yStep / 5)) * (yStep / 5); d <= yMax + 1e-6; d += yStep / 5) if (Math.abs(d / yStep - Math.round(d / yStep)) > 1e-6) L(X0 - 4, SY(d), X0, SY(d), '#000', .5);
  for (let v = xMin; v <= xMax + 1e-6; v += xStep) { L(SX(v), Y0, SX(v), Y1, '#cfcfcf', .6); T(SX(v), Y1 + 9, String(Math.round(v)), 5.5, { anchor: 'middle' }); }
  L(X0, Y0, X0, Y1, '#000', .8); L(X0, Y1, X1, Y1, '#000', .8);
  T((X0 + X1) / 2, Y1 + 19, `Vertical Section at ${vsAzi.toFixed(2)}°`, 7.3, { anchor: 'middle' });
  T(24, (Y0 + Y1) / 2, 'True Vertical Depth', 7.3, { anchor: 'middle', rot: -90 });
  o += `<g clip-path="url(#cpSec)">`;
  tops.forEach(t => { if (t.dip) PL(sv.map(r => [SX(r.vs), SY(WP.topTvdAt(t.top, r.northing, r.easting, surf))]), '#ef8a4a', 1.2); else L(X0, SY(t.tvd), X1, SY(t.tvd), '#ef8a4a', 1.2); });
  PL(sv.filter((_, i) => i % 2 === 0 || i === sv.length - 1).map(r => [SX(r.vs), SY(r.tvd)]), '#0000ff', 1.6);
  tg.forEach(t => {
    const row = sv.reduce((b, r) => Math.hypot(r.northing - t.n, r.easting - t.e, r.tvd - t.tvd) < Math.hypot(b.northing - t.n, b.easting - t.e, b.tvd - t.tvd) ? r : b, sv[0]);
    const x = SX(row.vs), y = SY(t.tvd); L(x, y - 9, x, y + 9, '#e03030', 1.1); T(x, y + 19, tname(t), 5.5, { anchor: 'middle' });
  });
  o += `</g>`;
  let flip = -1;
  tops.forEach(t => { const lt = t.dip ? WP.topTvdAt(t.top, sv[0].northing, sv[0].easting, surf) : t.tvd; if (lt >= yMin && lt <= yMax) { const y = SY(lt); flip = -flip; L(X0, y, X0 + 14, y + flip * 9, '#000', .5, '3 2'); T(X0 + 16, y + flip * 9 + (flip < 0 ? -1 : 6), t.name, 5.5); } });
  o += `<rect x="${secLeft}" y="${r2(secTop)}" width="${r2(secRight - secLeft)}" height="${r2(secBot - secTop)}" fill="#fff"/>` + secOut;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 792 612" width="792" height="612" font-family="${F}" style="background:#fff">` + `<rect width="792" height="612" fill="#fff"/>` + o + `</svg>`;
}
/* ================= drill plan: Landmark-style "Standard Planning Report", portrait Letter pages as SVG ================= */
function drillPlanPages() {
  if (!M.survey) return [];
  const s = state, w = s.wall || {}, sv = M.survey, surf = s.surface, ll = isLL() ? WP.toLatLon(surf.n, surf.e, s.crs) : null, conv = ll ? WP.convergence(ll.lat, ll.lon, s.crs) : 0;
  const DD = window.WALL_DEFAULTS || {}, company = w.company || DD.company || '', project = w.project || DD.project || '', site = w.site || s.name, wellbore = w.wellbore || 'Wellbore #1', design = w.plan || 'Design #1';
  const step = parseFloat(w.dpStep) > 0 ? parseFloat(w.dpStep) : 100, tdMd = sv[sv.length - 1].md;
  const nf = (v, d = 1) => { const z = Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v; return z.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const now = new Date(), MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const p2 = n => String(n).padStart(2, '0'), h12 = now.getHours() % 12 || 12;
  const dateLong = `${now.getDate()} ${MON[now.getMonth()]}, ${now.getFullYear()}`, dateShort = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
  const stamp = `${dateShort}  ${h12}:${p2(now.getMinutes())}:${p2(now.getSeconds())}${now.getHours() < 12 ? 'AM' : 'PM'}`;
  const LIL = '#d3e5d2', PALE = '#eef5ee', NAVY = '#38763a', F = 'Arial, Helvetica, sans-serif';
  const zone = ZONE_NAME[s.crs] || (WP.CRS[s.crs] ? WP.CRS[s.crs].name : '');
  const tg = usedTargets(), id = wallShortId(s.name), tname = t => w.wellId && id ? `${t.name} - ${id}` : t.name;
  const pages = []; let o = '', y = 0, pageNo = 0;
  const T = (x, yy, str, sz = 7.15, a = {}) => { o += `<text x="${r2(x)}" y="${r2(yy)}" font-size="${sz}"${a.anchor ? ` text-anchor="${a.anchor}"` : ''}${a.bold ? ' font-weight="bold"' : ''}${a.italic ? ' font-style="italic"' : ''}${a.fill ? ` fill="${a.fill}"` : ''}>${esc(String(str))}</text>`; };
  const R = (x, yy, wd, ht, fill) => { o += `<rect x="${r2(x)}" y="${r2(yy)}" width="${r2(wd)}" height="${r2(ht)}" fill="${fill}"/>`; };
  const LN = (x1, y1, x2, y2, col = '#000', wd = 1) => { o += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${wd}"/>`; };
  const finish = () => {
    LN(28.8, 739.25, 581.55, 739.25); T(29, 753, stamp, 6.95); T(306, 754, 'Page ' + pageNo, 6.95, { anchor: 'middle' }); T(581, 754, 'Well Path Planner', 6.95, { anchor: 'end' });
    pages.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 792" width="612" height="792" font-family="${F}"><rect width="612" height="792" fill="#fff"/>${o}</svg>`);
  };
  const newPage = (hdr = true) => {
    if (o) finish(); o = ''; pageNo++; y = 150;
    if (!hdr) return;
    R(30.2, 63.75, 546.65, 76.8, LIL); R(110, 67.5, 170.8, 71.5, PALE); R(403.6, 66.8, 170.4, 72.3, PALE); LN(30.25, 60.8, 576.9, 60.8, LIL, 1.5);
    T(306, 44.3, 'Planning Report', 8.95, { anchor: 'middle', bold: true, fill: NAVY });
    const L = [['Database:', 'EDM'], ['Company:', company], ['Project:', project], ['Site:', site], ['Well:', s.name], ['Wellbore:', wellbore], ['Design:', design]];
    L.forEach((r, i) => { T(32, 75 + i * 10.5, r[0], 6.95); T(113, 75 + i * 10.5, r[1], 7.15); });
    [['Local Co-ordinate Reference:', 'Well ' + s.name], ['TVD Reference:', `WELL @ ${nf(s.kb)}usft (Original Well Elev)`], ['MD Reference:', `WELL @ ${nf(s.kb)}usft (Original Well Elev)`], ['North Reference:', 'Grid'], ['Survey Calculation Method:', 'Minimum Curvature']]
      .forEach((r, i) => { T(285, 75 + i * 10.5, r[0], 6.95); T(408, 75 + i * 10.5, r[1], 7.15); });
  };
  const bar = title => { R(30.9, y, 546.65, 13.5, LIL); T(34, y + 9.6, title, 7.8, { bold: true }); y += 18; };
  const kv = (x, yy, lab, val, vx) => { T(x, yy, lab, 6.95); T(vx, yy, val, 7.15); };

  /* ---------- cover ---------- */
  newPage(false);
  T(118.8, 178, company, 21.5, { bold: true }); T(118.8, 197, project, 12.25); T(118.8, 213.5, site, 12.25); T(118.8, 230, s.name, 12.25);
  T(118.8, 263, wellbore, 12.25); T(118.8, 319, 'Plan: ' + design, 12.25);
  T(118.8, 393, 'Standard Planning Report', 21.5, { bold: true }); T(118.8, 424, dateLong, 10.5);

  /* ---------- well information ---------- */
  newPage(); const cy = () => y;
  bar('Project'); kv(34, y, 'Project', project, 109); y += 11;
  if (ll) { kv(34, y, 'Map System:', 'US State Plane 1983', 105); kv(280, y, 'System Datum:', 'Mean Sea Level', 401); y += 11; kv(34, y, 'Geo Datum:', 'North American Datum 1983', 105); y += 11; kv(34, y, 'Map Zone:', zone, 105); y += 14; }
  else { kv(34, y, 'Map System:', 'Local grid coordinates', 105); y += 14; }
  bar('Site'); kv(34, y, 'Site', site, 109); y += 11;
  kv(34, y, 'Site Position:', '', 109); kv(205, y, 'Northing:', nf(surf.n, 2) + ' usft', 298); if (ll) kv(365, y, 'Latitude:', ll.lat.toFixed(6), 541); y += 11;
  kv(34, y, 'From:', 'Map', 109); kv(205, y, 'Easting:', nf(surf.e, 2) + ' usft', 304); if (ll) kv(365, y, 'Longitude:', ll.lon.toFixed(6), 534); y += 11;
  kv(34, y, 'Position Uncertainty:', '0.0 usft', 172); kv(205, y, 'Slot Radius:', '', 325); if (ll) kv(365, y, 'Grid Convergence:', nf(conv, 2) + ' °', 540); y += 16;
  bar('Well'); kv(34, y, 'Well', s.name, 109); y += 11;
  kv(34, y, 'Well Position', '+N/-S', 109); T(175, y, '0.0 usft', 7.15); kv(217, y, 'Northing:', nf(surf.n, 2) + ' usft', 320); if (ll) kv(397, y, 'Latitude:', ll.lat.toFixed(6), 541); y += 11;
  kv(109, y, '+E/-W', '0.0 usft', 175); kv(217, y, 'Easting:', nf(surf.e, 2) + ' usft', 326); if (ll) kv(397, y, 'Longitude:', ll.lon.toFixed(6), 535); y += 11;
  kv(34, y, 'Position Uncertainty', '0.0 usft', 175); kv(217, y, 'Wellhead Elevation:', nf(s.kb) + ' usft', 338); kv(397, y, 'Ground Level:', nf(s.gl) + ' usft', 537); y += 16;
  bar('Wellbore'); kv(34, y, 'Wellbore', wellbore, 111); y += 16;
  bar('Design'); kv(34, y, 'Design', design, 109); y += 11; kv(34, y, 'Audit Notes:', '', 109); y += 11;
  kv(34, y, 'Version:', '', 60); kv(207, y, 'Phase:', 'PROTOTYPE', 267); kv(353, y, 'Tie On Depth:', '0.0', 460); y += 16;
  kv(34, y, 'Vertical Section:', '', 86); T(175, y, 'Depth From (TVD)', 6.95); T(289, y, '+N/-S', 6.95); T(354, y, '+E/-W', 6.95); T(448, y, 'Direction', 6.95); y += 9;
  T(196, y, '(usft)', 6.95); T(290, y, '(usft)', 6.95); T(355, y, '(usft)', 6.95); T(459, y, '(°)', 6.95); y += 12;
  T(200, y, '0.0', 7.15); T(293, y, '0.0', 7.15); T(359, y, '0.0', 7.15); T(452, y, nf(M.vsAzi, 2), 7.15); y += 22;
  bar('Plan Survey Tool Program'); kv(160, y - 4, 'Date', dateShort, 184); y += 8;
  T(55, y, 'Depth From', 6.95); T(115, y, 'Depth To', 6.95); T(155, y, 'Survey (Wellbore)', 6.95); T(274, y, 'Tool Name', 6.95); T(372, y, 'Remarks', 6.95); y += 9;
  T(65, y, '(usft)', 6.95); T(122, y, '(usft)', 6.95); y += 13;
  T(47, y, '1', 7.15); T(87, y, '0.0', 7.15); T(120, y, nf(tdMd), 7.15); T(155, y, `${design} (${wellbore})`, 7.15); T(272, y, 'MWD', 7.15); y += 12; T(272, y, 'OWSG MWD - Standard', 7.15);

  /* ---------- generic table: lilac title bar, 3-line header, rows with optional note line under ---------- */
  const table = (title, cols, rows, nx = 100) => {
    const head = () => {
      bar(title); R(30.9, y - 4, 546.65, 30, LIL);
      cols.forEach(c => (c.h || []).slice(-3).forEach((ln, k, a) => { if (ln) T(c.hx !== undefined ? c.hx : c.x - 18, y + 4 + (3 - a.length + k) * 9, ln, 6.95, { anchor: c.left ? 'start' : 'middle' }); }));
      y += 36;
    };
    newPage(); head();
    rows.forEach(r => {
      if (y > (r.note ? 712 : 722)) { newPage(); head(); }
      r.cells.forEach((v, i) => { const c = cols[i]; if (c.left) T(c.x, y, v, 7.15); else T(c.x, y, v, 7.15, { anchor: 'end' }); });
      y += 9.2; if (r.note) { R(30.9, y - 7.1, 546.65, 9.2, LIL); T(nx, y, r.note, 7.15, { italic: true }); y += 9.2; }
    });
    y += 6;
  };
  const rates = (a, b) => {
    const dm = b.md - a.md; if (!(dm > 0)) return [0, 0, 0];
    const I1 = a.inc * D2R, I2 = b.inc * D2R, dA = (b.azi - a.azi) * D2R;
    const dls = Math.acos(Math.max(-1, Math.min(1, Math.cos(I1) * Math.cos(I2) + Math.sin(I1) * Math.sin(I2) * Math.cos(dA)))) / D2R / dm * 100;
    let da = b.azi - a.azi; if (da > 180) da -= 360; if (da < -180) da += 360;
    return [dls, (b.inc - a.inc) / dm * 100, a.inc < 0.01 ? 0 : da / dm * 100];
  };
  const hit = r => { const t = tg.find(t => Math.hypot(r.n - (t.n - surf.n), r.e - (t.e - surf.e), r.tvd - t.tvd) < 2); return t ? tname(t) : ''; };

  /* ---------- plan sections ---------- */
  const secRows = WP.wallSectionRows(M.sections, M.secEnds, sv[0]);
  const pc = ['Measured|Depth|(usft)', '|Inclination|(°)', '|Azimuth|(°)', 'Vertical|Depth|(usft)', '|+N/-S|(usft)', '|+E/-W|(usft)', 'Dogleg|Rate|(°/100usft)', 'Build|Rate|(°/100usft)', 'Turn|Rate|(°/100usft)', '|TFO|(°)'];
  const pxs = [58, 100, 142, 188, 236, 284, 330, 374, 418, 462];
  const pcols = pxs.map((x, i) => ({ x, h: pc[i].split('|') })).concat([{ x: 472, left: true, hx: 472, h: ['', '', 'Target'] }]);
  table('Plan Sections', pcols, secRows.map((r, k) => {
    const [dls, bld, trn] = k ? rates(secRows[k - 1], r) : [0, 0, 0];
    return { cells: [nf(r.md), nf(r.inc, 2), nf(r.azi, 2), nf(r.tvd), nf(r.n), nf(r.e), nf(dls, 2), nf(bld, 2), nf(trn, 2), nf(r.tf, 2), hit(r)] };
  }));

  /* ---------- planned survey ---------- */
  const key = md => Math.round(md * 100), mdMap = new Map(), notes = new Map();
  const addMd = md => { if (md >= 0 && md <= tdMd + 1e-6) mdMap.set(key(md), md); };
  for (let m = 0; m <= tdMd + 1e-6; m += step) addMd(m); addMd(tdMd);
  const note = (md, txt) => { addMd(md); const k = key(md); notes.set(k, (notes.get(k) ? notes.get(k) + ' - ' : '') + txt); };
  secRows.forEach((r, k) => { if (k) { addMd(r.md); const h = hit(r); notes.set(key(r.md), r.note + (h ? ' - ' + h : '')); } });
  const tops = WP.formationMds(s.tops, sv, surf).filter(t => t.md !== null);
  tops.forEach(t => note(t.md, t.name));
  tg.forEach(t => { if (secRows.some(r => hit(r) === tname(t))) return; const b = sv.reduce((q, r) => Math.hypot(r.n - (t.n - surf.n), r.e - (t.e - surf.e), r.tvd - t.tvd) < Math.hypot(q.n - (t.n - surf.n), q.e - (t.e - surf.e), q.tvd - t.tvd) ? r : q, sv[0]); note(b.md, tname(t)); });
  const mds = [...mdMap.values()].sort((a, b) => a - b), pts = mds.map(m => WP.planAtMd(sv, m));
  const svc = ['Measured|Depth|(usft)', 'Inclination|(°)', 'Azimuth|(°)', 'Vertical|Depth|(usft)', '+N/-S|(usft)', '+E/-W|(usft)', 'Vertical|Section|(usft)', 'Dogleg|Rate|(°/100usft)', 'Build|Rate|(°/100usft)', 'Turn|Rate|(°/100usft)'];
  const sxs = [78, 130, 182, 236, 290, 342, 396, 450, 508, 566];
  table('Planned Survey', sxs.map((x, i) => ({ x, h: svc[i].split('|'), hx: x - 20 })), pts.map((p, k) => {
    const [dls, bld, trn] = k ? rates(pts[k - 1], p) : [0, 0, 0];
    return { cells: [nf(p.md), nf(p.inc, 2), nf(p.azi, 2), nf(p.tvd), nf(p.n), nf(p.e), nf(p.vs), nf(dls, 2), nf(bld, 2), nf(trn, 2)], note: notes.get(key(p.md)) };
  }), 130);

  /* ---------- design targets ---------- */
  if (tg.length) {
    if (y > 560) newPage();
    bar('Design Targets');
    const tx = [{ x: 34, left: true, t: ['Target Name', '- hit/miss target', '- Shape'] }];
    const hd = ['Dip Angle|(°)', 'Dip Dir.|(°)', 'TVD|(usft)', '+N/-S|(usft)', '+E/-W|(usft)', 'Northing|(usft)', 'Easting|(usft)', 'Latitude', 'Longitude'];
    const hx = [168, 208, 252, 300, 350, 410, 466, 520, 572];
    R(30.9, y - 4, 546.65, 30, LIL); T(34, y + 4, 'Target Name', 6.95); T(34, y + 13, '- hit/miss target', 6.95); T(34, y + 22, '- Shape', 6.95);
    hd.forEach((h, i) => h.split('|').forEach((ln, k, a) => T(hx[i] - 20, y + 4 + (a.length === 1 ? 9 : k * 9) + (a.length === 1 ? 0 : 0), ln, 6.95, { anchor: 'middle' })));
    y += 36;
    tg.forEach((t, i) => {
      const lt = ll ? WP.toLatLon(t.n, t.e, s.crs) : null, ms = M.misses && M.misses[i];
      [nf(0, 2), nf(0, 2), nf(+t.tvd), nf(t.n - surf.n), nf(t.e - surf.e), nf(t.n, 2), nf(t.e, 2), lt ? lt.lat.toFixed(6) : '', lt ? lt.lon.toFixed(6) : ''].forEach((v, k) => T(hx[k], y, v, 7.15, { anchor: 'end' }));
      T(34, y, tname(t), 7.15); y += 9.2;
      T(40, y, ms ? (ms.d < 0.5 ? '- plan hits target center' : `- plan passes ${ms.d.toFixed(1)}usft from target center`) : '', 7.15); y += 9.2; T(40, y, '- Point', 7.15); y += 14;
    });
    y += 8;
  }

  /* ---------- formations ---------- */
  if (tops.length) {
    if (y > 600) newPage();
    bar('Formations'); R(30.9, y - 4, 546.65, 30, LIL);
    [['Measured|Depth|(usft)', 58], ['Vertical|Depth|(usft)', 104], ['Name', 0], ['Lithology', 0], ['Dip|(°)', 0], ['Dip|Direction|(°)', 0]].forEach(() => {});
    T(40, y + 4, 'Measured', 6.95, { anchor: 'middle' }); T(40, y + 13, 'Depth', 6.95, { anchor: 'middle' }); T(40, y + 22, '(usft)', 6.95, { anchor: 'middle' });
    T(90, y + 4, 'Vertical', 6.95, { anchor: 'middle' }); T(90, y + 13, 'Depth', 6.95, { anchor: 'middle' }); T(90, y + 22, '(usft)', 6.95, { anchor: 'middle' });
    T(120, y + 22, 'Name', 6.95); T(300, y + 22, 'Lithology', 6.95); T(430, y + 13, 'Dip', 6.95, { anchor: 'middle' }); T(430, y + 22, '(°)', 6.95, { anchor: 'middle' });
    T(500, y + 4, 'Dip', 6.95, { anchor: 'middle' }); T(500, y + 13, 'Direction', 6.95, { anchor: 'middle' }); T(500, y + 22, '(°)', 6.95, { anchor: 'middle' });
    y += 36;
    tops.forEach(t => { if (y > 722) { newPage(); } T(58, y, nf(t.md), 7.15, { anchor: 'end' }); T(108, y, nf(t.tvd), 7.15, { anchor: 'end' }); T(120, y, t.name, 7.15); T(430, y, nf(t.dip, 2), 7.15, { anchor: 'middle' }); T(500, y, nf(t.azi, 2), 7.15, { anchor: 'middle' }); y += 11; });
    y += 8;
  }

  /* ---------- plan annotations ---------- */
  if (y > 640) newPage();
  bar('Plan Annotations'); R(30.9, y - 4, 546.65, 39, LIL);
  [['Measured', 'Depth', '(usft)', 58], ['Vertical', 'Depth', '(usft)', 112]].forEach(h => { T(h[3] - 18, y + 4, h[0], 6.95, { anchor: 'middle' }); T(h[3] - 18, y + 13, h[1], 6.95, { anchor: 'middle' }); T(h[3] - 18, y + 22, h[2], 6.95, { anchor: 'middle' }); });
  T(190, y + 4, 'Local Coordinates', 6.95, { anchor: 'middle' }); T(160, y + 22, '+N/-S', 6.95, { anchor: 'middle' }); T(220, y + 22, '+E/-W', 6.95, { anchor: 'middle' }); T(160, y + 31, '(usft)', 6.95, { anchor: 'middle' }); T(220, y + 31, '(usft)', 6.95, { anchor: 'middle' });
  T(262, y + 31, 'Comment', 6.95); y += 45;
  secRows.slice(1).forEach(r => { if (y > 722) newPage(); T(58, y, nf(r.md), 7.15, { anchor: 'end' }); T(112, y, nf(r.tvd), 7.15, { anchor: 'end' }); T(170, y, nf(r.n), 7.15, { anchor: 'end' }); T(230, y, nf(r.e), 7.15, { anchor: 'end' }); T(262, y, r.note, 7.15); y += 9.2; });
  finish(); return pages;
}
function drillPreview() {
  const det = $('#dpDet'); if (!det || !det.open || !$('#pane-wall').classList.contains('on')) return;
  $('#drillPrev').innerHTML = M.survey ? drillPlanPages().map(p => p.replace('width="612" height="792"', 'style="width:100%;max-width:560px;height:auto;border:1px solid var(--line);margin:0 6px 10px 0;background:#fff"')).join('') : '';
}
function drawWall() {
  if (!$('#pane-wall').classList.contains('on')) return;
  const box = $('#wallPrev'); if (!M.survey) { box.innerHTML = '<div class="hint">The plan does not build right now.</div>'; return; }
  box.innerHTML = wallSvg().replace('width="792" height="612"', 'style="width:100%;height:auto;border:1px solid var(--line)"');
  const note = [];
  if (isLL() && !wallFootage()) note.push('No footage call yet: the section data is not loaded (turn on Show sections on the Plots tab once, or type the footage below).');
  $('#wallNote').textContent = note.join(' ');
  drillPreview();
}
function syncWallInputs() {
  const w = state.wall;
  $$('[data-w]').forEach(el => { const k = el.dataset.w; if (el.type === 'checkbox') el.checked = !!w[k]; else el.value = w[k] === undefined ? '' : w[k]; });
}
document.addEventListener('input', e => { const el = e.target.closest('[data-w]'); if (!el || el.type === 'checkbox' || el.tagName === 'SELECT') return; state.wall[el.dataset.w] = el.value; autosave(); drawWall(); });
document.addEventListener('change', e => { const el = e.target.closest('[data-w]'); if (!el) return; state.wall[el.dataset.w] = el.type === 'checkbox' ? el.checked : el.value; autosave(); drawWall(); });
function printPages(svgs, pageCss) {
  const el = $('#wallPrint'); el.innerHTML = svgs.join('');
  const st = document.createElement('style'); st.id = 'wallPageStyle'; st.textContent = '@page{size:' + pageCss + ';margin:0}'; document.head.appendChild(st);
  document.body.classList.add('wallmode'); setTimeout(() => window.print(), 80);
}
const wallPrint = () => printPages([wallSvg().replace('width="792" height="612"', 'width="11in" height="8.5in"')], '11in 8.5in');
const drillPrint = () => printPages(drillPlanPages().map(p => p.replace('width="612" height="792"', 'width="8.5in" height="11in"')), '8.5in 11in');
window.addEventListener('afterprint', () => { document.body.classList.remove('wallmode'); const st = $('#wallPageStyle'); if (st) st.remove(); $('#wallPrint').innerHTML = ''; });
$('#bDrillPrint').onclick = () => { if (M.survey) drillPrint(); };
$('#dpDet').addEventListener('toggle', drillPreview);
$('#bWallPrint').onclick = () => { if (M.survey) wallPrint(); };
$('#bWallSvg').onclick = () => { if (M.survey) download(safeName() + (apiTag() ? '_' + apiTag() : '') + '_wall_plot.svg', '<?xml version="1.0" encoding="UTF-8"?>\n' + wallSvg().replace('width="792" height="612"', 'width="11in" height="8.5in"'), 'image/svg+xml'); };
/* Logo popup: choose a file, go back to the default, or leave the logo off */
const logoChoose = () => $('#wallLogoFile').click();
const logoDefault = () => { try { localStorage.removeItem('wellplanner.wallLogo'); } catch (e) {} wallLogo = window.WALL_LOGO || null; drawWall(); };
const logoNone = () => { wallLogo = null; try { localStorage.setItem('wellplanner.wallLogo', JSON.stringify({ src: '' })); } catch (e) {} drawWall(); };
let logoPopRefresh = null;
$('#bWallLogo').onclick = () => {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `<div role="dialog" aria-label="Logo" style="background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:16px 18px;max-width:380px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.35)">
    <h3 style="margin:0 0 8px">Logo</h3>
    <div id="lgPrev" style="height:90px;border:1px solid var(--line);border-radius:8px;background:#fff;color:#555;display:flex;align-items:center;justify-content:center;margin-bottom:8px;overflow:hidden"></div>
    <div class="hint" style="margin:0 0 10px">Printed at the top left of the wall plot. PNG, JPEG or SVG.</div>
    <div class="toolbar" style="margin:0"><button class="primary" id="lgFile">Choose file…</button><button id="lgDef">Default logo</button><button id="lgNone">No logo</button></div>
    <div class="toolbar" style="margin:12px 0 0"><span class="grow"></span><button id="lgClose">Close</button></div></div>`;
  document.body.appendChild(ov);
  const q = s => ov.querySelector(s), close = () => { logoPopRefresh = null; ov.remove(); document.removeEventListener('keydown', esc1); };
  const esc1 = e => { if (e.key === 'Escape') close(); };
  const refresh = logoPopRefresh = () => { q('#lgPrev').innerHTML = wallLogo && wallLogo.src ? `<img src="${wallLogo.src}" alt="" style="max-width:100%;max-height:100%">` : 'No logo'; };
  refresh(); document.addEventListener('keydown', esc1);
  q('#lgFile').onclick = logoChoose; q('#lgDef').onclick = () => { logoDefault(); refresh(); }; q('#lgNone').onclick = () => { logoNone(); refresh(); }; q('#lgClose').onclick = close;
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); }); q('#lgClose').focus();
};
$('#wallLogoFile').onchange = e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const rd = new FileReader(); rd.onload = () => { const im = new Image(); im.onload = () => { wallLogo = { src: rd.result, w: im.naturalWidth, h: im.naturalHeight }; try { localStorage.setItem('wellplanner.wallLogo', JSON.stringify(wallLogo)); } catch (x) { $('#wallNote').textContent = 'The logo is too big to remember between sessions, but it is used for now.'; } drawWall(); if (logoPopRefresh) logoPopRefresh(); }; im.src = rd.result; };
  rd.readAsDataURL(f);
};

function drawAll() { if (!M.survey) return; draw2D('plan'); draw2D('sec'); draw3D(); drawDls(); drawSep(); drawPad(); drawActual(); drawWall(); }


/* The Wall plot and Drill plan cards fold up; each remembers whether it was left open. */
['wallC', 'drillC'].forEach(id => {
  const set = (open, save) => {
    $('#' + id + 'Body').hidden = !open; $('#' + id + 'Arrow').textContent = open ? '▾' : '▸'; $('#' + id + 'Head').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (save) { try { localStorage.setItem('wellplanner.' + id + 'Open', open ? '1' : '0'); } catch (e) {} }
  };
  $('#' + id + 'Head').onclick = () => set($('#' + id + 'Body').hidden, true);
  $('#' + id + 'Head').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set($('#' + id + 'Body').hidden, true); } };
  let o = true; try { o = localStorage.getItem('wellplanner.' + id + 'Open') !== '0'; } catch (e) {} set(o, false);
});
