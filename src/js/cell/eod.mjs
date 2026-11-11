/**
 * End of day on the cell's own scale (Koa 2026-11-11, Phase 1 scorecard; Worker
 * handlers/production/cell-eod.js, migration 0062). Lead only: opened by holding
 * the small "End of day" button.
 *
 * The lead weighs what is left of the cell's raw and the fall-through tote, and
 * ticks the sacks the cell used. While the panel is open the screen does nothing
 * else with the scale (no job starts, no pickup, no lift), and the Worker skips
 * these readings for tops and NOT RECORDING (its EOD window).
 *
 * Weighing: the scale reads gross, so the panel takes its own zero with the
 * empty tray on and saves (settled reading - zero). The scale tops out at 2 kg,
 * so a big leftover goes on in parts: every Save adds to the day's total.
 */
import { registerLabels, t } from '../shared/i18n.js';

export const HOLD_OPEN_MS = 1200;
export const SETTLE_MS = 2000;      // unchanged this long (within SETTLE_TOL_G) counts as settled
export const SETTLE_TOL_G = 0.05;
export const MIN_G = 0.5;           // less than this on the tray is nothing to save

registerLabels({
  en: {
    eodBtn: 'End of day', eodTitle: 'End of day: weigh leftovers',
    eodStep1: '1. Empty tray on the scale, then tap Zero.', eodZero: 'Zero',
    eodStep2: '2. Put the leftover on the tray. When it settles, save it.',
    eodParts: 'Over 2 kg? Weigh it in parts: each Save adds.',
    eodOnScale: 'On the tray', eodSettling: 'settling…', eodNeedZero: 'Tap Zero first',
    eodSaveRaw: 'Save: leftover raw', eodSaveTote: 'Save: fall-through tote',
    eodRaw: 'Leftover raw', eodTote: 'Fall-through tote', eodParts1: '{n} part', eodPartsN: '{n} parts',
    eodSacks: '3. Tick the sacks this cell used today', eodNoSacks: 'No sacks scanned out today yet',
    eodDone: 'Done', eodUndo: 'Undo', eodBusy: 'Finish or reset the job first.',
    eodNotReady: 'End of day is not set up yet. Tell Koa.', eodFail: 'Could not save. Try again.',
    eodSaved: 'Saved', eodTaken: 'ticked to another cell',
  },
  es: {
    eodBtn: 'Fin del día', eodTitle: 'Fin del día: pesar lo que sobra',
    eodStep1: '1. Charola vacía en la báscula, luego toque Cero.', eodZero: 'Cero',
    eodStep2: '2. Ponga lo que sobra en la charola. Cuando se estabilice, guárdelo.',
    eodParts: '¿Más de 2 kg? Péselo por partes: cada Guardar se suma.',
    eodOnScale: 'En la charola', eodSettling: 'estabilizando…', eodNeedZero: 'Toque Cero primero',
    eodSaveRaw: 'Guardar: materia prima sobrante', eodSaveTote: 'Guardar: bote de lo que cae',
    eodRaw: 'Materia prima sobrante', eodTote: 'Bote de lo que cae', eodParts1: '{n} parte', eodPartsN: '{n} partes',
    eodSacks: '3. Marque los sacos que usó esta celda hoy', eodNoSacks: 'Todavía no hay sacos sacados hoy',
    eodDone: 'Listo', eodUndo: 'Deshacer', eodBusy: 'Termine o reinicie el trabajo primero.',
    eodNotReady: 'Fin del día todavía no está listo. Avísele a Koa.', eodFail: 'No se pudo guardar. Intente otra vez.',
    eodSaved: 'Guardado', eodTaken: 'marcado a otra celda',
  },
});

const fmt = g => `${g.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} g`;

/** Settled = the scale's own flag, or the reading held still for SETTLE_MS. Pure, for tests. */
export function createSettle() {
  let last = null, since = 0;
  return {
    reading(now, g, stableFlag) {
      if (last === null || Math.abs(g - last) > SETTLE_TOL_G) { last = g; since = now; }
      return stableFlag === true || now - since >= SETTLE_MS;
    },
    reset() { last = null; since = 0; },
  };
}

/**
 * @param {{ api: string, station: string, isBusy: () => boolean, onOpen: () => void, onClose: () => void }} o
 */
export function createEod({ api, station, isBusy, onOpen, onClose }) {
  const post = (action, body) => fetch(`${api}?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  const settle = createSettle();
  let open = false, zeroG = null, gross = null, settled = false, day = null, msg = '', busySave = false;

  const root = document.createElement('div');
  root.className = 'dialog eod';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `<div class="dialog-card eod-card">
    <h2 data-k="eodTitle"></h2>
    <p class="eod-step" data-k="eodStep1"></p>
    <button type="button" class="btn eod-zero" data-k="eodZero"></button>
    <p class="eod-step" data-k="eodStep2"></p>
    <div class="eod-live"><span data-k="eodOnScale"></span> <b class="eod-g">—</b> <small class="eod-state"></small></div>
    <div class="row eod-saves">
      <button type="button" class="btn primary eod-save" data-kind="raw" data-k="eodSaveRaw"></button>
      <button type="button" class="btn primary eod-save" data-kind="tote" data-k="eodSaveTote"></button>
    </div>
    <small class="eod-hint" data-k="eodParts"></small>
    <ul class="eod-list"></ul>
    <p class="eod-step" data-k="eodSacks"></p>
    <ul class="eod-sacks"></ul>
    <div class="eod-msg error" hidden></div>
    <div class="row"><button type="button" class="btn eod-done" data-k="eodDone"></button></div>
  </div>`;
  document.body.appendChild(root);
  const q = s => root.querySelector(s);

  const netG = () => (gross === null || zeroG === null ? null : Math.round((gross - zeroG) * 100) / 100);

  function render() {
    root.querySelectorAll('[data-k]').forEach(n => { n.textContent = t(n.dataset.k); });
    const g = netG();
    q('.eod-g').textContent = zeroG === null ? '—' : fmt(g);
    q('.eod-state').textContent = zeroG === null ? t('eodNeedZero') : settled ? '' : t('eodSettling');
    root.querySelectorAll('.eod-save').forEach(b => { b.disabled = busySave || zeroG === null || !settled || g === null || g < MIN_G; });
    q('.eod-zero').disabled = gross === null || !settled;
    const m = q('.eod-msg');
    m.hidden = !msg; m.textContent = msg;
  }

  // The saved parts and the sack ticks: redrawn only when they change (load, language),
  // never on a scale poll, so a tap on a checkbox or Undo is never lost mid-redraw.
  function renderLists() {
    // Totals and parts.
    const list = q('.eod-list');
    list.textContent = '';
    if (day) {
      for (const kind of ['raw', 'tote']) {
        const parts = day.weighs.filter(w => w.kind === kind && !w.undone);
        if (!parts.length) continue;
        const li = document.createElement('li');
        li.className = 'eod-total';
        const total = kind === 'raw' ? day.rawG : day.toteG;
        li.textContent = `${t(kind === 'raw' ? 'eodRaw' : 'eodTote')}: ${fmt(total)} · ${t(parts.length === 1 ? 'eodParts1' : 'eodPartsN').replace('{n}', parts.length)}`;
        list.appendChild(li);
        for (const w of parts) {
          const p = document.createElement('li');
          p.className = 'eod-part';
          p.innerHTML = '<span></span>';
          p.firstChild.textContent = fmt(w.g);
          if (w.canUndo) {
            const u = document.createElement('button');
            u.type = 'button'; u.className = 'btn ghost'; u.textContent = t('eodUndo');
            u.addEventListener('click', () => undo(w.id));
            p.appendChild(u);
          }
          list.appendChild(p);
        }
      }
    }
    const sacks = q('.eod-sacks');
    sacks.textContent = '';
    const rows = (day && day.sacks) || [];
    if (!rows.length) { const li = document.createElement('li'); li.textContent = t('eodNoSacks'); sacks.appendChild(li); }
    for (const s of rows) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox'; box.checked = s.stationId === station;
      box.addEventListener('change', () => tick(s.sackId, box.checked));
      const time = new Date(s.openedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      label.append(box, ` ${s.sackId} · ${s.cultivar || ''} · ${s.lbs} lb · ${time}`);
      li.appendChild(label);
      sacks.appendChild(li);
    }
  }

  async function load() {
    try {
      const r = await fetch(`${api}?action=cellEod&stationId=${encodeURIComponent(station)}`, { cache: 'no-store' });
      if (r.status === 503) { msg = t('eodNotReady'); day = null; return null; }
      if (!r.ok) throw new Error(String(r.status));
      day = await r.json();
      return day;
    } catch { return null; } finally { if (open) { render(); renderLists(); } }
  }

  async function save(kind) {
    const g = netG();
    if (g === null || g < MIN_G || !settled) return;
    busySave = true; render();
    try {
      const r = await post('eodWeigh', { stationId: station, kind, grams: g });
      if (r.status === 503) msg = t('eodNotReady');
      else if (!r.ok) throw new Error(String(r.status));
      else msg = '';
    } catch { msg = t('eodFail'); }
    busySave = false;
    await load();
  }
  async function undo(id) {
    try { await post('eodUndo', { id }); } catch { msg = t('eodFail'); }
    await load();
  }
  async function tick(sackId, on) {
    try {
      const r = await post('cellSack', { stationId: station, sackId, on });
      msg = r.status === 409 ? `${sackId}: ${t('eodTaken')}` : r.ok ? '' : t('eodFail');
    } catch { msg = t('eodFail'); }
    await load();
  }

  async function show(resumed = false) {
    if (open) return;
    if (!resumed && isBusy()) { window.alert(t('eodBusy')); return; }
    open = true; zeroG = null; msg = ''; settle.reset();
    root.hidden = false;
    onOpen();
    render(); renderLists();
    if (!resumed) post('eodWindow', { stationId: station, open: true }).then(r => { if (r.status === 503) { msg = t('eodNotReady'); render(); } }).catch(() => {});
    await load();
  }
  function hide() {
    if (!open) return;
    open = false;
    root.hidden = true;
    post('eodWindow', { stationId: station, open: false }).catch(() => {});
    onClose();
  }

  q('.eod-zero').addEventListener('click', () => { if (gross !== null && settled) { zeroG = gross; render(); } });
  root.querySelectorAll('.eod-save').forEach(b => b.addEventListener('click', () => save(b.dataset.kind)));
  q('.eod-done').addEventListener('click', hide);
  document.addEventListener('ro:langchange', () => { if (open) { render(); renderLists(); } });

  // The small hold button that opens it (lead only: a tap does nothing).
  function bindHold(btn) {
    let timer = null;
    btn.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch { /* fine */ }
      btn.classList.add('holding');
      timer = setTimeout(() => { timer = null; btn.classList.remove('holding'); show(); }, HOLD_OPEN_MS);
    });
    const end = () => { clearTimeout(timer); timer = null; btn.classList.remove('holding'); };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => btn.addEventListener(ev, end));
    btn.addEventListener('contextmenu', e => e.preventDefault());
  }

  return {
    get isOpen() { return open; },
    bindHold,
    /** Each poll's reading while open. */
    reading(g, stableFlag) {
      gross = g;
      settled = g !== null && settle.reading(Date.now(), g, stableFlag);
      if (open) render();
    },
    /** A page reloaded mid-weigh: reopen the panel the Worker still has open. */
    async resume() {
      const d = await load();
      if (d && d.windowOpen && !open) show(true);
    },
  };
}
