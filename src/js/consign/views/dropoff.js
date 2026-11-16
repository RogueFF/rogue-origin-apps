/**
 * New dropoff, in four numbered steps: farm, cultivars and pounds, names and notes, check and save.
 * Staff record pounds only: prices show locked, and no money totals appear here.
 */
import { t } from '../../shared/i18n.js';
import { call, newKey } from '../api.js';
import { esc, lbs, money, num, termLabel, typeLabel } from '../format.js';
import { errorCard, loading, toast } from '../ui.js';
import { submit, actor, setActor } from '../save.js';
import { go } from '../nav.js';

const TYPES = ['tops', 'smalls'];
let uidSeq = 0;

export function mount(root) {
  const s = {
    farms: null, farm: null, detail: null, error: null, loadingFarm: false,
    rows: [], droppedBy: actor(), note: '', key: newKey(), saving: false, saveError: '', saved: false,
  };

  const priceOf = (cultivar, type) => {
    const pp = (s.detail?.price_points || []).find((p) => p.cultivar.toLowerCase() === cultivar.toLowerCase() && p.type === type);
    return pp ? pp.price_per_lb : null;
  };
  const pricedCultivars = () => [...new Set((s.detail?.price_points || []).map((p) => p.cultivar))].sort((a, b) => a.localeCompare(b));
  const findRow = (uid) => s.rows.find((r) => r.uid === uid);
  const defaultTerm = () => s.farm?.default_term || 'dropoff';

  function addRow(name) {
    const raw = String(name || '').trim();
    if (!raw) return;
    // Use the price list's spelling so the server finds the price point.
    const cultivar = pricedCultivars().find((c) => c.toLowerCase() === raw.toLowerCase()) || raw;
    if (s.rows.some((r) => r.cultivar.toLowerCase() === cultivar.toLowerCase())) return;
    s.rows.push({
      uid: `r${++uidSeq}`, cultivar, note: '',
      types: Object.fromEntries(TYPES.map((ty) => [ty, { on: false, parts: [{ term: defaultTerm(), lbs: '' }] }])),
    });
  }

  function buildLines() {
    const lines = [];
    for (const r of s.rows) {
      for (const ty of TYPES) {
        const slot = r.types[ty];
        if (!slot.on) continue;
        for (const p of slot.parts) {
          lines.push({ cultivar: r.cultivar, type: ty, term: p.term, intake_lbs: num(p.lbs), note: r.note.trim() || undefined });
        }
      }
    }
    return lines;
  }
  const badWeight = () => s.rows.some((r) => TYPES.some((ty) => r.types[ty].on && r.types[ty].parts.some((p) => String(p.lbs).trim() !== '' && !(num(p.lbs) > 0))));

  // ---------- rendering ----------
  const stepHead = (n, key, st = '') => `<div class="cs-stephead ${st}"><span class="cs-stepnum">${n}</span><h2 class="cs-h3">${esc(t(key))}</h2></div>`;

  function farmStep() {
    if (s.farm) {
      return `<section class="cs-card cs-step">${stepHead(1, 'stepFarm')}
        <div class="cs-crowhead"><span class="cs-crowname" id="farmName">${esc(s.farm.name)}</span>
        <button type="button" class="cs-btn small" id="changeFarm">${esc(t('change'))}</button></div></section>`;
    }
    const live = s.farms.filter((f) => f.active);
    return `<section class="cs-card cs-step">${stepHead(1, 'stepFarm')}
      <p class="cs-muted">${esc(t('chooseFarm'))}</p>
      ${live.length ? `<div class="cs-farmpick">${live.map((f) => `<button type="button" class="cs-btn big" data-farm="${f.id}">${esc(f.name)}</button>`).join('')}</div>` : `<p>${esc(t('noFarms'))}</p>`}
    </section>`;
  }

  function partHtml(r, ty, p, i, split) {
    const price = priceOf(r.cultivar, ty);
    const id = `${r.uid}-${ty}-${i}`;
    return `<div class="cs-part">
      <label class="cs-label" for="${id}">${esc(typeLabel(ty))} ${esc(t('lbs'))}${split ? ` · ${esc(termLabel(p.term))}` : ''}</label>
      <input id="${id}" class="cs-input cs-num" inputmode="decimal" autocomplete="off" data-lbs="${r.uid}|${ty}|${i}" value="${esc(p.lbs)}" placeholder="${esc(r.types[ty].on ? t('notWeighedYet') : t('notBrought'))}">
      <div class="cs-price">${price == null ? `<span class="cs-chip noprice">${esc(t('noPrice'))}</span>` : `${esc(t('price'))}: ${money(price)} ${esc(t('perLb'))}`}</div>
      ${split ? '' : `<button type="button" class="cs-termbtn ${p.term}" data-term="${r.uid}|${ty}|${i}">${esc(termLabel(p.term))}</button>`}
    </div>`;
  }

  function rowHtml(r) {
    return `<div class="cs-crow" data-row="${esc(r.cultivar)}">
      <div class="cs-crowhead"><span class="cs-crowname">${esc(r.cultivar)}</span>
        <button type="button" class="cs-btn small danger" data-remove="${r.uid}" aria-label="${esc(t('remove'))} ${esc(r.cultivar)}">✕ ${esc(t('remove'))}</button></div>
      <div class="cs-types">
        ${TYPES.map((ty) => {
          const slot = r.types[ty];
          const split = slot.parts.length > 1;
          return `<div class="cs-type${slot.on ? '' : ' off'}" data-type="${ty}">
            <label class="cs-check"><input type="checkbox" data-on="${r.uid}|${ty}"${slot.on ? ' checked' : ''}> <span>${esc(typeLabel(ty))}</span></label>
            ${slot.parts.map((p, i) => partHtml(r, ty, p, i, split)).join('')}
            <button type="button" class="cs-btn small ghost" data-split="${r.uid}|${ty}">${esc(t(split ? 'unsplit' : 'splitLine'))}</button>
          </div>`;
        }).join('')}
      </div>
      <label class="cs-field"><span class="cs-label">${esc(t('note'))}</span><input class="cs-input" data-rownote="${r.uid}" value="${esc(r.note)}" autocomplete="off"></label>
    </div>`;
  }

  function cultivarStep() {
    const chips = pricedCultivars().filter((c) => !s.rows.some((r) => r.cultivar.toLowerCase() === c.toLowerCase()));
    return `<section class="cs-card cs-step">${stepHead(2, 'stepCultivars')}
      <div class="cs-stack" id="rows">${s.rows.map(rowHtml).join('')}</div>
      <h3 class="cs-label" style="margin-top:16px">${esc(t('addCultivar'))}</h3>
      <div class="cs-chips">${chips.map((c) => `<button type="button" class="cs-chipbtn" data-add="${esc(c)}">＋ ${esc(c)}</button>`).join('')}</div>
      <div class="cs-other"><input class="cs-input" id="otherName" placeholder="${esc(t('otherPlaceholder'))}" aria-label="${esc(t('other'))}" autocomplete="off">
        <button type="button" class="cs-btn" id="addOther">＋ ${esc(t('other'))}</button></div>
    </section>`;
  }

  function notesStep() {
    return `<section class="cs-card cs-step">${stepHead(3, 'stepNotes')}
      <label class="cs-field"><span class="cs-label">${esc(t('droppedBy'))}</span><input class="cs-input" id="droppedBy" value="${esc(s.droppedBy)}" autocomplete="name"></label>
      <label class="cs-field"><span class="cs-label">${esc(t('dropoffNote'))}</span><textarea class="cs-input" id="dropNote" rows="2">${esc(s.note)}</textarea></label>
    </section>`;
  }

  function confirmBody() {
    const lines = buildLines();
    if (!lines.length) return `<p class="cs-muted">${esc(t('needOneLine'))}</p>`;
    return `<p class="cs-muted">${esc(t('confirmDropoff'))}</p>
      <table class="cs-summary"><tbody>${lines.map((l) => {
        const price = priceOf(l.cultivar, l.type);
        return `<tr><td><b>${esc(l.cultivar)}</b> ${esc(typeLabel(l.type))}<br><span class="cs-muted">${esc(termLabel(l.term))} · ${price == null ? esc(t('noPrice')) : `${money(price)} ${esc(t('perLb'))}`}</span></td>
          <td class="n">${l.intake_lbs == null ? `<span class="cs-muted">${esc(t('notWeighedYet'))}</span>` : `${lbs(l.intake_lbs)} ${esc(t('lbs'))}`}</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  function confirmStep() {
    const can = buildLines().length > 0 && !badWeight() && !s.saving;
    return `<section class="cs-card cs-step st-closed">${stepHead(4, 'stepConfirm')}
      <div id="summary">${confirmBody()}</div>
      <p class="cs-error" id="saveError"${s.saveError || badWeight() ? '' : ' hidden'}>${esc(s.saveError || (badWeight() ? t('badWeight') : ''))}</p>
      <div class="cs-row-btns"><button type="button" class="cs-btn primary big" id="saveBtn"${can ? '' : ' disabled'}>${esc(s.saving ? t('saving') : t('saveDropoff'))}</button></div>
    </section>`;
  }

  function render() {
    if (s.error) return errorCard(root, s.error, load);
    if (!s.farms || s.loadingFarm) return loading(root);
    root.innerHTML = `<h2 class="cs-h2">${esc(t('newDropoff'))}</h2><div class="cs-stack">
      ${farmStep()}${s.farm ? cultivarStep() + notesStep() + confirmStep() : ''}</div>`;
  }

  /** Refresh only the summary and save button, so typing keeps focus. */
  function refreshConfirm() {
    const sum = root.querySelector('#summary');
    if (!sum) return;
    sum.innerHTML = confirmBody();
    const err = root.querySelector('#saveError');
    const msg = s.saveError || (badWeight() ? t('badWeight') : '');
    err.textContent = msg;
    err.hidden = !msg;
    root.querySelector('#saveBtn').disabled = !(buildLines().length > 0 && !badWeight() && !s.saving);
  }

  // ---------- events (delegated, so re-renders need no rewiring) ----------
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.dataset.farm) return pickFarm(Number(b.dataset.farm));
    if (b.id === 'changeFarm') { s.farm = null; s.detail = null; return render(); }
    if (b.dataset.add) { addRow(b.dataset.add); render(); return focusLast(); }
    if (b.id === 'addOther') {
      const v = root.querySelector('#otherName').value;
      addRow(v); render(); return focusLast();
    }
    if (b.dataset.remove) { s.rows = s.rows.filter((r) => r.uid !== b.dataset.remove); return render(); }
    if (b.dataset.term) {
      const [uid, ty, i] = b.dataset.term.split('|');
      const p = findRow(uid).types[ty].parts[Number(i)];
      p.term = p.term === 'sold' ? 'dropoff' : 'sold';
      return render();
    }
    if (b.dataset.split) {
      const [uid, ty] = b.dataset.split.split('|');
      const slot = findRow(uid).types[ty];
      if (slot.parts.length > 1) {
        const total = slot.parts.reduce((a, p) => a + (num(p.lbs) || 0), 0);
        slot.parts = [{ term: defaultTerm(), lbs: total > 0 ? String(total) : '' }];
      } else {
        // One part per term: the server refuses the same cultivar, type and term twice.
        slot.parts = [{ term: 'dropoff', lbs: slot.parts[0].lbs }, { term: 'sold', lbs: '' }];
        slot.on = true;
      }
      return render();
    }
    if (b.id === 'saveBtn') return save();
  });

  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.lbs) {
      const [uid, ty, i] = el.dataset.lbs.split('|');
      const slot = findRow(uid).types[ty];
      slot.parts[Number(i)].lbs = el.value;
      if (el.value.trim() && !slot.on) {
        // Typing a weight ticks the box.
        slot.on = true;
        const box = root.querySelector(`[data-on="${uid}|${ty}"]`);
        if (box) { box.checked = true; box.closest('.cs-type').classList.remove('off'); }
        root.querySelectorAll(`[data-lbs^="${uid}|${ty}|"]`).forEach((inp) => { inp.placeholder = t('notWeighedYet'); });
      }
    } else if (el.dataset.rownote) findRow(el.dataset.rownote).note = el.value;
    else if (el.id === 'droppedBy') s.droppedBy = el.value;
    else if (el.id === 'dropNote') s.note = el.value;
    else return;
    s.saveError = '';
    refreshConfirm();
  });

  root.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset.on) return;
    const [uid, ty] = el.dataset.on.split('|');
    findRow(uid).types[ty].on = el.checked;
    render();
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'otherName') { e.preventDefault(); root.querySelector('#addOther').click(); }
  });

  function focusLast() {
    const last = root.querySelector('#rows .cs-crow:last-child input[data-lbs]');
    if (last) last.focus();
  }

  async function pickFarm(id) {
    s.farm = s.farms.find((f) => f.id === id);
    s.loadingFarm = true; render();
    try {
      s.detail = await call('farm', { farm_id: id });
      s.farm = s.detail.farm;
    } catch (err) { s.error = err; }
    s.loadingFarm = false;
    // Rows added before a farm change take the new farm's default term.
    for (const r of s.rows) for (const ty of TYPES) if (r.types[ty].parts.length === 1) r.types[ty].parts[0].term = defaultTerm();
    render();
  }

  async function save() {
    const lines = buildLines();
    if (!lines.length || badWeight() || s.saving) return;
    setActor(s.droppedBy.trim());
    s.saving = true; s.saveError = ''; refreshConfirm();
    root.querySelector('#saveBtn').textContent = t('saving');
    const body = { farm_id: s.farm.id, dropped_by: s.droppedBy.trim(), note: s.note.trim(), client_key: s.key, lines };
    try {
      const res = await submit('saveDropoff', body);
      s.saved = true;
      if (res.held) toast(t('savedHeld'), 'warn'); else toast(t('saved'));
      go('#/');
    } catch (err) {
      s.saving = false;
      s.saveError = err.blocking ? t('holdFailed') : (err.message || t('errGeneric'));
      render();
      const msg = root.querySelector('#saveError');
      if (msg) msg.scrollIntoView({ block: 'center' });
    }
  }

  async function load() {
    s.error = null; s.farms = null; render();
    try { s.farms = await call('farms'); } catch (err) { s.error = err; }
    render();
  }

  load();
  return {
    rerender: render,
    dirty: () => !s.saved && (s.rows.length > 0 || !!s.note.trim()),
  };
}
