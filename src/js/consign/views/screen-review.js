/**
 * Screening numbers for a whole dropoff, read from one photo of the screening sheet.
 * One card per lot in printed order. Every number is editable; unsure ones are marked
 * "Check" until edited or OK'd. Save all stays off while any card is marked or does not
 * add up (format.runCheck, the server's own rule). Mounted by views/photo.js; never saves
 * anything on its own.
 */
import { t } from '../../shared/i18n.js';
import { newKey } from '../api.js';
import { esc, lbs, num, typeLabel, runCheck, checkBarHtml } from '../format.js';
import { toast } from '../ui.js';
import { submit, actor } from '../save.js';
import { hold } from '../held.js';
import { go } from '../nav.js';
import { screenableLots } from '../sheets.mjs';

const FIELDS = ['pulled', 'final', 'to_smalls', 'biomass', 'mold'];
const LABEL = { pulled: 'pulled', final: 'final', to_smalls: 'toSmalls', biomass: 'biomass', mold: 'mold' };
const BODY_KEY = { pulled: 'pulled_lbs', final: 'final_lbs', to_smalls: 'to_smalls_lbs', biomass: 'biomass_lbs', mold: 'mold_lbs' };

export function mount(root, { read, detail }) {
  const dropoff = detail.dropoff;
  const rows = new Map(read.rows.map((r) => [r.lot_id, r]));
  const cards = screenableLots(detail.lots.filter((l) => !l.voided_at)).map((lot, i) => {
    const r = rows.get(lot.id);
    const fields = lot.type === 'smalls' ? FIELDS.filter((f) => f !== 'to_smalls') : FIELDS;
    const card = {
      lot, index: i + 1, fields, open: !!r, key: newKey(), status: 'idle', error: '',
      values: {}, marks: {}, finishes: false,
    };
    for (const f of fields) {
      const v = r ? r[f] : null;
      card.values[f] = v && v.value != null ? String(v.value) : '';
      card.marks[f] = !!(v && v.unsure);
    }
    card.finishes = !!(r && r.finishes.value);
    card.marks.finishes = !!(r && r.finishes.unsure);
    return card;
  });
  const skipped = read.warnings.some((w) => w === 'unknown_row' || w === 'duplicate_row' || w === 'lot_changed');
  let saving = false;
  let done = false;

  const byId = (id) => cards.find((c) => String(c.lot.id) === String(id));
  const marked = (c) => Object.values(c.marks).some(Boolean);
  const check = (c) => runCheck(c.values.pulled, c.fields.filter((f) => f !== 'pulled').map((f) => c.values[f]));
  const pending = () => cards.filter((c) => c.open && c.status !== 'saved' && c.status !== 'held');
  const ready = (c) => !marked(c) && check(c).ok;
  const canSaveAll = () => !saving && pending().length > 0 && pending().every(ready);

  const markTail = (key) => `<span class="cs-markword">${esc(t('checkMark'))}</span><button type="button" class="cs-btn small cs-okbtn" data-okmark="${key}">${esc(t('okBox'))}</button>`;

  const checkBar = (c) => checkBarHtml(check(c));

  function statusLine(c) {
    if (c.status === 'saving') return `<p class="cs-muted" data-status="saving">${esc(t('saving'))}</p>`;
    if (c.status === 'saved') return `<p class="cs-chip st-closed" data-status="saved">✓ ${esc(t('savedOne'))}</p>`;
    if (c.status === 'held') return `<p class="cs-chip" data-status="held">${esc(t('savedHeld'))}</p>`;
    if (c.status === 'refused') return `<p class="cs-error" data-status="refused">${esc(t('refused'))}: ${esc(c.error)}</p>`;
    return '';
  }

  function cardHtml(c) {
    const head = `<div class="cs-cardhead"><h3 class="cs-h3"><span class="cs-idx">${c.index}</span> ${esc(c.lot.cultivar)} ${esc(typeLabel(c.lot.type))}</h3>
      <span class="cs-muted">${esc(t('before'))} <b>${lbs(c.lot.money.remainder_lbs)}</b> ${esc(t('lbs'))}</span></div>`;
    if (!c.open) {
      return `<section class="cs-card cs-rcard closed" data-review="${c.lot.id}">${head}
        <p class="cs-muted">${esc(t('notScreened'))}</p></section>`;
    }
    const locked = c.status === 'saved' || c.status === 'held' || c.status === 'saving';
    const st = c.status === 'saved' ? 'st-closed' : c.status === 'refused' || marked(c) ? 'st-price' : '';
    const label = (f) => (f === 'final' ? (c.lot.type === 'smalls' ? 'finalSmalls' : 'finalTops') : LABEL[f]);
    return `<section class="cs-card cs-rcard st ${st}" data-review="${c.lot.id}">${head}
      <div class="cs-outs">${c.fields.map((f) => `<label class="cs-field${c.marks[f] ? ' cs-marked' : ''}"><span class="cs-label">${esc(t(label(f)))} (${esc(t('lbs'))})</span>
        <input class="cs-input cs-num${c.marks[f] ? ' cs-mark' : ''}" inputmode="decimal" autocomplete="off" data-f="${c.lot.id}|${f}" value="${esc(c.values[f])}"${locked ? ' disabled' : ''}>
        ${c.marks[f] ? `<span class="cs-markline">${markTail(`${c.lot.id}|${f}`)}</span>` : ''}</label>`).join('')}</div>
      <div data-checkbar="${c.lot.id}">${checkBar(c)}</div>
      <div class="cs-crowhead${c.marks.finishes ? ' cs-marked' : ''}" style="margin-top:12px">
        <label class="cs-check"><input type="checkbox" data-fin="${c.lot.id}"${c.finishes ? ' checked' : ''}${locked ? ' disabled' : ''}> <span>${esc(t('finishesLot'))}</span></label>
        ${c.marks.finishes ? `<span class="cs-markline">${markTail(`${c.lot.id}|finishes`)}</span>` : ''}</div>
      ${statusLine(c)}
      ${c.status === 'refused' ? `<div class="cs-row-btns"><button type="button" class="cs-btn primary" data-saveone="${c.lot.id}"${ready(c) ? '' : ' disabled'}>${esc(t('saveThisOne'))}</button></div>` : ''}
    </section>`;
  }

  function render() {
    const left = cards.reduce((n, c) => n + (c.open && c.status !== 'saved' && c.status !== 'held' ? Object.values(c.marks).filter(Boolean).length : 0), 0);
    root.innerHTML = `<h2 class="cs-h2">${esc(t('reviewTitle'))}</h2>
      <p><b>${esc(dropoff.farm_name)}</b></p>
      <div class="cs-photobanner" id="photoBanner" role="status">${esc(t('fromPhoto'))}</div>
      ${skipped ? `<p class="cs-error" id="skippedRows">${esc(t('someRowsSkipped'))}</p>` : ''}
      <div class="cs-stack">${cards.map(cardHtml).join('')}</div>
      <p class="cs-error" id="checksLeft"${left ? '' : ' hidden'}>${esc(t('checksLeft'))}: ${left}</p>
      <div class="cs-row-btns"><a class="cs-btn ghost" href="#/farm/${dropoff.farm_id}">${esc(t('cancel'))}</a>
        <button type="button" class="cs-btn primary big" id="saveAllBtn"${canSaveAll() ? '' : ' disabled'}>${esc(saving ? t('saving') : t('saveAll'))}</button></div>`;
  }

  /** Typing keeps focus: refresh only that card's bar and mark, and the Save all button. */
  function refresh(c, el, f) {
    if (el && c.marks[f]) {
      c.marks[f] = false;
      el.classList.remove('cs-mark');
      const wrap = el.closest('.cs-marked');
      if (wrap) { wrap.classList.remove('cs-marked'); wrap.querySelectorAll('.cs-markline').forEach((x) => x.remove()); }
    }
    const bar = root.querySelector(`[data-checkbar="${c.lot.id}"]`);
    if (bar) bar.innerHTML = checkBar(c);
    const one = root.querySelector(`[data-saveone="${c.lot.id}"]`);
    if (one) one.disabled = !ready(c);
    root.querySelector('#saveAllBtn').disabled = !canSaveAll();
    const left = cards.reduce((n, x) => n + (x.open && x.status !== 'saved' && x.status !== 'held' ? Object.values(x.marks).filter(Boolean).length : 0), 0);
    const cl = root.querySelector('#checksLeft');
    cl.hidden = !left;
    cl.textContent = `${t('checksLeft')}: ${left}`;
  }

  root.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset.f) return;
    const [id, f] = el.dataset.f.split('|');
    const c = byId(id);
    c.values[f] = el.value;
    refresh(c, el, f);
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset.fin) return;
    const c = byId(el.dataset.fin);
    c.finishes = el.checked;
    c.marks.finishes = false;
    render();
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.okmark) {
      const [id, f] = b.dataset.okmark.split('|');
      byId(id).marks[f] = false;
      return render();
    }
    if (b.id === 'saveAllBtn') return saveAll();
    if (b.dataset.saveone) return saveCards([byId(b.dataset.saveone)]);
  });

  function bodyFor(c) {
    const body = {
      lot_id: c.lot.id, finishes_lot: !!c.finishes, note: '', client_key: c.key, actor: actor(),
      lot_label: `${dropoff.farm_name} · ${c.lot.cultivar} ${c.lot.type}`,
    };
    for (const f of FIELDS) body[BODY_KEY[f]] = c.fields.includes(f) ? (f === 'pulled' ? num(c.values[f]) : num(c.values[f]) || 0) : 0;
    return body;
  }

  /** One saveScreenRun per card, in order. A refusal does not stop the rest; no signal holds the rest. */
  async function saveCards(list) {
    if (saving) return;
    saving = true;
    let offline = false;
    for (const c of list) {
      if (!ready(c)) continue;
      const body = bodyFor(c);
      if (offline) {
        c.status = hold('saveScreenRun', body) ? 'held' : 'refused';
        if (c.status === 'refused') c.error = t('holdFailed');
        continue;
      }
      c.status = 'saving'; render();
      try {
        const res = await submit('saveScreenRun', body);
        if (res.held) { c.status = 'held'; offline = true; } else c.status = 'saved';
      } catch (err) {
        c.status = 'refused';
        c.error = err.blocking ? t('holdFailed') : (err.message || t('errGeneric'));
      }
    }
    saving = false;
    if (!pending().length) {
      done = true;
      toast(offline ? t('heldRest') : t('allSaved'), offline ? 'warn' : 'ok');
      return go(`#/farm/${dropoff.farm_id}`);
    }
    render();
  }

  const saveAll = () => saveCards(pending());

  render();
  return {
    rerender: render,
    dirty: () => !done && cards.some((c) => c.open && c.status !== 'saved' && c.status !== 'held'),
  };
}
