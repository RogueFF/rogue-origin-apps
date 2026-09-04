/**
 * Tag & Desk — boot.
 *  - `?flag=<id>` (and `&red=1`): the Tag. One card, one outcome, full screen, no desk.
 *  - otherwise: the Desk.
 * Every write goes through api.js and is followed by a full reload of the four reads.
 */
import { getLang, setLang, toggleLang } from '../shared/i18n.js';
import { toggleTheme } from '../shared/theme.js';
import * as api from './api.js';
import { buildModel, scanPlan, localDay } from './model.js';
import { load as loadStore, save as saveStore } from './store.js';
import { bindLang, t, ES } from './labels.js';
import { S, init, setModel, render, toast, openEditor, saveCard, setTagHandlers } from './render.js';

bindLang(getLang);
const $ = s => document.querySelector(s);
const PAGE_URL = location.origin + location.pathname;
const todayISO = () => localDay(new Date().toISOString());
const L = loadStore();
const saveL = () => saveStore(L);
let RAW = {};

async function fetchModel() {
  const d = await api.loadAll();
  RAW = Object.fromEntries(d.cards.map(c => [c.id, c]));
  return buildModel({ ...d, today: todayISO(), levelsChanged: L.levelsChanged, archived: L.archived });
}
async function reload() { const M = await fetchModel(); setModel(M, RAW); }

// ---------- the Tag route ----------
async function runTag(id, red) {
  document.body.classList.add('tagonly');
  S.tag.live = true; S.tag.card = id; S.tag.state = 'queued'; S.tag.undoLeft = 30; S.tag.added = false; S.tag.last = 'scan';
  const params = new URLSearchParams(location.search); params.delete('flag'); params.delete('red'); const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  let M;
  try { M = await fetchModel(); } catch (e) { console.error(e); $('#view-tag').innerHTML = `<div class="boot err">${t('loadFail')}</div>`; document.querySelector('#view-tag').hidden = false; return; }
  init({ M, L, saveL, reload, RAW, pageUrl: PAGE_URL });
  const c = M.byId[id];
  const exec = async () => {
    const plan = scanPlan(c, { red });
    if (plan.outcome === 'unknown') { S.tag.state = 'unknown'; return; }
    try {
      if (plan.call === 'addToCart') { const r = await api.addToCart({ cardId: id, qty: plan.qty || 1, note: plan.note || null, addedBy: 'tag' }); S.tag.added = true; if (r.mode === 'reorder_request') { S.tag.state = 'requested'; return; } }
      else if (plan.call === 'note') await api.setCartNote(id, plan.note, c.inCart.qty);
      S.tag.state = plan.outcome === 'requested' ? 'requested' : plan.outcome;
      if (plan.outcome === 'out') { L.outLog[id] = (L.outLog[id] || 0) + 1; saveL(); }
      await reload();
    } catch (e) { console.error(e); S.tag.state = 'bad'; }
  };
  setTagHandlers({
    plus: async () => { try { await api.addToCart({ cardId: id, qty: 1, addedBy: 'tag+1' }); await reload(); S.tag.last = 'plus'; S.tag.qty = null; S.tag.undoLeft = 30; render(); toast(tagES() ? '+1 desde el piso' : '+1 from the floor'); } catch { S.tag.state = 'bad'; render(); } },
    undo: async () => { try { if (S.tag.last === 'plus') { const q = M.byId[id]?.inCart?.qty || 1; await api.setCartQty(id, Math.max(1, q - 1)); S.tag.last = 'scan'; await reload(); render(); return; } if (S.tag.added) await api.removeFromCart(id); await reload(); S.tag.state = 'removed'; S.tag.added = false; render(); } catch { S.tag.state = 'bad'; render(); } },
    requeue: async () => { try { const r = await api.addToCart({ cardId: id, qty: c.suggested, addedBy: 'tag' }); S.tag.added = true; await reload(); S.tag.state = r.mode === 'reorder_request' ? 'requested' : 'queued'; S.tag.undoLeft = 30; render(); } catch { S.tag.state = 'bad'; render(); } },
    retry: async () => { await reload(); await exec(); render(); },
    urgent: async () => { try { const cur = M.byId[id]?.inCart; if (cur) await api.setCartNote(id, 'URGENT', cur.qty); else await api.addToCart({ cardId: id, qty: c.suggested, note: 'URGENT', addedBy: 'tag' }); S.tag.told[id] = true; await reload(); render(); toast(tagES() ? 'El escritorio ve una bandera roja en esta tarjeta' : 'The desk now sees a red flag on this card'); } catch { S.tag.state = 'bad'; render(); } },
    rescan: () => { toast(tagES() ? 'Apunta la cámara a la tarjeta' : 'Point the camera at the card'); },
    close: () => { history.back(); },
  });
  await exec();
  render();
}
const tagES = () => (S.tag.lang ? S.tag.lang === 'es' : ES());

// ---------- the Desk ----------
async function runDesk() {
  $('#view-order').innerHTML = `<div class="boot">${t('loading')}</div>`;
  let M;
  try { M = await fetchModel(); } catch (e) { console.error(e); $('#view-order').innerHTML = `<div class="boot err">${t('loadFail')} <button class="tb-btn btn-sm" onclick="location.reload()">Reload</button></div>`; return; }
  init({ M, L, saveL, reload, RAW, pageUrl: PAGE_URL });
  render();
  // periodic refresh so scans from the floor show up without a reload
  setInterval(async () => { if (document.hidden || document.querySelector('dialog[open]')) return; try { await reload(); render(); } catch { /* keep the last good render */ } }, 60_000);
}

// ---------- chrome ----------
$('#q').oninput = e => { S.q = e.target.value.trim().toLowerCase(); if (S.q && S.view !== 'cards') S.view = 'cards'; render(); };
$('#searchBtn').onclick = () => { document.body.classList.toggle('search-open'); if (document.body.classList.contains('search-open')) $('#q').focus(); };
$('#langBtn').onclick = () => { toggleLang(); }; $('#railLang').onclick = () => { toggleLang(); document.body.classList.remove('nav-open'); };
$('#themeBtn').onclick = toggleTheme; $('#railTheme').onclick = toggleTheme;
$('#addBtn').onclick = () => openEditor(null); $('#railAdd').onclick = () => { document.body.classList.remove('nav-open'); openEditor(null); };
$('#menuBtn').onclick = () => document.body.classList.toggle('nav-open');
document.querySelectorAll('[data-closenav]').forEach(el => el.onclick = () => document.body.classList.remove('nav-open'));
document.querySelectorAll('[data-closedlg]').forEach(b => b.onclick = () => b.closest('dialog').close());
$('#editorForm').onsubmit = e => { e.preventDefault(); saveCard(); };
document.addEventListener('ro:langchange', () => { $('#langBtn').textContent = ES() ? 'EN' : 'ES'; render(); });
if (!getLang()) setLang('en');

const params = new URLSearchParams(location.search);
const flag = parseInt(params.get('flag') || '', 10);
if (flag) runTag(flag, params.get('red') === '1'); else runDesk();
