'use strict';
/* Owns: LAYOUT, PMAX, openPanel, closePanel, applyModule, setMaxPlot (left icon rail, docked input panels, KPI row per module, alerts chip, help toggles, enlarged plot). Uses: recalc, paneOn (main). File map and load order: CLAUDE.md "Architecture". */
/* The rail (#rail) has one button per input panel (#dock > .panel). Buttons without data-mod are always there (well inputs);
 * buttons with data-mod="<tab>" show only while that module tab is open. One panel is open at a time; it docks beside the
 * rail and the charts get narrower. The KPI row (#kpis) shows the sets whose data-mods include the open tab. */
const LAYOUT = { panel: null, tab: 'plots' };

function openPanel(id) {
  const sec = $('#panel-' + id); if (!sec) return;
  $$('#dock > .panel').forEach(p => { p.hidden = p !== sec; });
  $$('#rail .railbtn').forEach(b => { const on = b.dataset.panel === id; b.classList.toggle('on', on); b.setAttribute('aria-expanded', on ? 'true' : 'false'); });
  $('#dock').hidden = false; $('#dock').scrollTop = 0;
  $('.app').style.setProperty('--dockw', (+sec.dataset.pw || 380) + 'px');
  LAYOUT.panel = id;
  try { localStorage.setItem('wellplanner.panel', id); } catch (e) {}
  recalc();             // canvases and lists inside the panel (pad schematic, lateral spacing) draw only while visible
}
function closePanel() {
  if (!LAYOUT.panel) return;
  $('#dock').hidden = true; $('.app').style.setProperty('--dockw', '0px');
  $$('#rail .railbtn').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); });
  LAYOUT.panel = null;
  try { localStorage.setItem('wellplanner.panel', ''); } catch (e) {}
}
/* show the rail buttons and KPI sets that belong to this module tab; close a module panel that does not */
function applyModule(tab) {
  LAYOUT.tab = tab;
  setMaxPlot(null);                                   // an enlarged plot belongs to the tab being left
  let any = false;
  $$('#rail .railbtn[data-mod]').forEach(b => { b.hidden = b.dataset.mod !== tab; if (!b.hidden) any = true; });
  $('#railSep').hidden = !any;
  $$('#kpis [data-mods]').forEach(k => { k.hidden = !k.dataset.mods.split(' ').includes(tab); });
  if (LAYOUT.panel) { const b = $(`#rail .railbtn[data-panel="${LAYOUT.panel}"]`); if (!b || b.hidden) closePanel(); }
}

$('#rail').addEventListener('click', e => {
  const b = e.target.closest('.railbtn'); if (!b) return;
  if (LAYOUT.panel === b.dataset.panel) closePanel(); else openPanel(b.dataset.panel);
});
$('#dock').addEventListener('click', e => {
  if (e.target.closest('.pclose')) { closePanel(); return; }
  const h = e.target.closest('.phelp'); if (!h) return;
  const sec = h.closest('.panel'), on = sec.classList.toggle('showhelp');
  try { localStorage.setItem('wellplanner.help.' + sec.id, on ? '1' : ''); } catch (x) {}
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (PMAX.el) { setMaxPlot(null); e.preventDefault(); return; }       // Esc restores an enlarged plot first
  if (!LAYOUT.panel) return;
  if ($('#warnList') && !$('#warnList').hidden) return;                 // Esc closes the alerts list first
  if (document.querySelector('body > div[style*="position:fixed"]')) return;   // a dialog is open
  closePanel();
});
/* Card headings inside panels used to fold their card up. In a panel the card is always open, so swallow those clicks
 * (buttons in the heading, such as "+ Add target", still work). */
['click', 'keydown'].forEach(type => document.addEventListener(type, e => {
  const h = e.target.closest && e.target.closest('.panel .card > h3[role=button]');
  if (!h || e.target.closest('button,input,select,a,label')) return;
  if (type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  e.stopPropagation(); e.preventDefault();
}, true));

/* ---- enlarge a plot ----
 * Every chart card in the main area (.plot with a title row) gets a button at the right end of its title. It makes that card
 * fill the chart area below the KPI row; the same button (now an X) or Esc puts it back. The card keeps its place in the page,
 * it is only drawn on top (position:fixed), so all its controls and hover readouts keep working. */
const PMAX = { el: null, style: '' };
const ICON_MAX = '<svg class="ic-open" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>' +
  '<svg class="ic-close" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
$$('main .plot > h4').forEach(h => {
  const b = document.createElement('button');
  b.className = 'small ghost pmax'; b.type = 'button'; b.innerHTML = ICON_MAX;
  b.title = 'Enlarge to fill the chart area'; b.setAttribute('aria-label', b.title);
  h.appendChild(b);
});
function placeMaxPlot() {
  const p = PMAX.el; if (!p) return;
  const m = $('main').getBoundingClientRect(), bar = $('main .stickytop').getBoundingClientRect();
  const top = Math.max(m.top, bar.bottom) + 6, sb = $('main').offsetWidth - $('main').clientWidth;   // keep clear of main's scrollbar
  Object.assign(p.style, { top: top + 'px', left: (m.left + 12) + 'px', width: Math.max(200, m.width - sb - 24) + 'px', height: Math.max(200, innerHeight - top - 12) + 'px' });
}
function setMaxPlot(plot) {
  if (PMAX.el === plot) return;
  if (PMAX.el) {
    const old = PMAX.el; old.classList.toggle('max', false); old.style.cssText = PMAX.style;
    const b = old.querySelector('.pmax'); b.title = 'Enlarge to fill the chart area'; b.setAttribute('aria-label', b.title);
    PMAX.el = null;
  }
  $('main').classList.toggle('hasmax', !!plot);
  if (plot) {
    PMAX.el = plot; PMAX.style = plot.style.cssText; plot.classList.add('max'); placeMaxPlot();
    const b = plot.querySelector('.pmax'); b.title = 'Back to the normal view (Esc)'; b.setAttribute('aria-label', b.title);
  }
  if (typeof drawAll === 'function') drawAll();      // canvases size themselves from their box on each draw
}
$('main').addEventListener('click', e => {
  const b = e.target.closest('.plot .pmax'); if (!b) return;
  const p = b.closest('.plot'); setMaxPlot(PMAX.el === p ? null : p);
});
new ResizeObserver(() => { if (PMAX.el) { placeMaxPlot(); later(drawAll); } }).observe($('main'));
window.addEventListener('resize', () => { if (PMAX.el) placeMaxPlot(); });

/* module tabs (the tab click itself is handled in app_project.js) */
$$('.tab').forEach(b => b.addEventListener('click', () => applyModule(b.dataset.tab)));

/* page explanations on the open tab */
$('#bPaneHelp').onclick = () => {
  const on = document.body.classList.toggle('panehelp');
  $('#bPaneHelp').setAttribute('aria-pressed', on ? 'true' : 'false');
  try { localStorage.setItem('wellplanner.paneHelp', on ? '1' : ''); } catch (e) {}
  later(drawAll);                                     // pages that size charts to the window (Geosteering) make room for the notes
};

/* alerts chip: showBanner() fills it; click opens the list */
$('#warnChip').onclick = () => { const l = $('#warnList'), open = l.hidden; l.hidden = !open; $('#warnChip').setAttribute('aria-expanded', open ? 'true' : 'false'); };
document.addEventListener('click', e => { if (!e.target.closest('.warnwrap') && !$('#warnList').hidden) { $('#warnList').hidden = true; $('#warnChip').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#warnList').hidden) { $('#warnList').hidden = true; $('#warnChip').setAttribute('aria-expanded', 'false'); e.preventDefault(); } });

/* restore the last open panel and help choices */
try {
  $$('#dock > .panel').forEach(p => { if (localStorage.getItem('wellplanner.help.' + p.id) === '1') p.classList.add('showhelp'); });
  if (localStorage.getItem('wellplanner.paneHelp') === '1') { document.body.classList.add('panehelp'); $('#bPaneHelp').setAttribute('aria-pressed', 'true'); }
} catch (e) {}
applyModule((document.querySelector('.tab.on') || { dataset: { tab: 'plots' } }).dataset.tab);
{ let p = ''; try { p = localStorage.getItem('wellplanner.panel') || ''; } catch (e) {}
  const b = p && $(`#rail .railbtn[data-panel="${p}"]`); if (b && !b.hidden) openPanel(p); }
