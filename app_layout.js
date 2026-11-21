'use strict';
/* Owns: LAYOUT, openPanel, closePanel, applyModule (left icon rail, docked input panels, KPI row per module, alerts chip, help toggles). Uses: recalc, paneOn (main). File map and load order: CLAUDE.md "Architecture". */
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
  if (e.key !== 'Escape' || !LAYOUT.panel || e.defaultPrevented) return;
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

/* module tabs (the tab click itself is handled in app_project.js) */
$$('.tab').forEach(b => b.addEventListener('click', () => applyModule(b.dataset.tab)));

/* page explanations on the open tab */
$('#bPaneHelp').onclick = () => {
  const on = document.body.classList.toggle('panehelp');
  $('#bPaneHelp').setAttribute('aria-pressed', on ? 'true' : 'false');
  try { localStorage.setItem('wellplanner.paneHelp', on ? '1' : ''); } catch (e) {}
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
