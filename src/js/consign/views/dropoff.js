/**
 * New dropoff, in four numbered steps: farm, cultivars and pounds, names and notes, check and save.
 * Staff record pounds only: prices show locked, and no money totals appear here.
 *
 * Prefill (stage 2): views/photo.js mounts this with { prefill: read } after a sheet photo is
 * read. Every box the reader was unsure of, and every cultivar it could not match, is marked
 * "Check" until the person edits it or taps OK; Save stays off while any mark is left.
 */
import { t } from '../../shared/i18n.js';
import { call, newKey } from '../api.js';
import { esc, lbs, money, num, termLabel, typeLabel } from '../format.js';
import { errorCard, loading, toast } from '../ui.js';
import { submit, actor, setActor } from '../save.js';
import { go } from '../nav.js';

const TYPES = ['tops', 'smalls'];
let uidSeq = 0;

export function mount(root, { prefill = null, farmId = null, farmCheck = false } = {}) {
  const s = {
    farms: null, farm: null, detail: null, error: null, loadingFarm: false,
    rows: [], droppedBy: actor(), note: '', key: newKey(), saving: false, saveError: '', saved: false,
    fromPhoto: !!prefill, pending: prefill, farmMark: !!farmCheck,
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
        // A split side left empty is not a lot; an empty split is one unweighed lot on the default term.
        let parts = slot.parts;
        if (parts.length > 1) {
          parts = parts.filter((p) => String(p.lbs).trim() !== '');
          if (!parts.length) parts = [{ term: defaultTerm(), lbs: '' }];
        }
        for (const p of parts) {
          lines.push({ cultivar: r.cultivar, type: ty, term: p.term, intake_lbs: num(p.lbs), note: r.note.trim() || undefined });
        }
      }
    }
    return lines;
  }
  /** Boxes still marked "Check", plus photo rows with no cultivar name yet. */
  const liveMark = (r, k) => !!(r.marks && r.marks[k] && (k === 'name' || r.types[k].on));
  const marksLeft = () => (s.farmMark ? 1 : 0) + s.rows.reduce((n, r) => n + ['name', ...TYPES].filter((k) => liveMark(r, k)).length, 0)
    + s.rows.filter((r) => !r.cultivar.trim() && !(r.marks && r.marks.name)).length;

  /** Put a sheet read into the form. Weights are text, exactly as read; nothing is saved here. */
  function applyPrefill(read) {
    s.rows = [];
    for (const pr of read.rows) {
      const raw = String(pr.cultivar || '').trim();
      const known = raw ? pricedCultivars().find((c) => c.toLowerCase() === raw.toLowerCase()) : undefined;
      const dup = raw && s.rows.some((r) => r.cultivar.toLowerCase() === raw.toLowerCase());
      s.rows.push({
        uid: `r${++uidSeq}`, cultivar: known || raw, note: pr.note || '',
        types: Object.fromEntries(TYPES.map((ty) => [ty, { on: !!pr[ty].on, parts: [{ term: defaultTerm(), lbs: pr[ty].value == null ? '' : String(pr[ty].value) }] }])),
        marks: { name: !pr.cultivar_known || !known || !!dup, tops: !!pr.tops.unsure, smalls: !!pr.smalls.unsure },
      });
    }
    if (read.dropped_by) s.droppedBy = read.dropped_by;
    if (read.note) s.note = read.note;
  }

  const badWeight = () => s.rows.some((r) => TYPES.some((ty) => r.types[ty].on && r.types[ty].parts.some((p) => String(p.lbs).trim() !== '' && !(num(p.lbs) > 0))));

  // ---------- rendering ----------
  const stepHead = (n, key, st = '') => `<div class="cs-stephead ${st}"><span class="cs-stepnum">${n}</span><h2 class="cs-h3">${esc(t(key))}</h2></div>`;

  function farmStep() {
    if (s.farm) {
      return `<section class="cs-card cs-step">${stepHead(1, 'stepFarm')}
        <div class="cs-crowhead${s.farmMark ? ' cs-marked' : ''}"><span class="cs-crowname" id="farmName">${esc(s.farm.name)}</span>
        ${s.farmMark ? `<span class="cs-markline">${markTail('farm')}</span>` : ''}
        <button type="button" class="cs-btn small" id="changeFarm">${esc(t('change'))}</button></div>
        <div class="cs-row-btns"><a class="cs-btn small ghost" id="printFarmSheet" href="#/print/dropoff/${s.farm.id}">🖨 ${esc(t('printFarmSheet'))}</a>
          ${s.fromPhoto ? '' : `<a class="cs-btn small ghost" id="fillFromPhoto" href="#/photo/dropoff/${s.farm.id}">📷 ${esc(t('fillFromPhoto'))}</a>`}</div></section>`;
    }
    const live = s.farms.filter((f) => f.active);
    return `<section class="cs-card cs-step">${stepHead(1, 'stepFarm')}
      <p class="cs-muted">${esc(t('chooseFarm'))}</p>
      ${live.length ? `<div class="cs-farmpick">${live.map((f) => `<button type="button" class="cs-btn big" data-farm="${f.id}">${esc(f.name)}</button>`).join('')}</div>` : `<p>${esc(t('noFarms'))}</p>`}
      ${s.fromPhoto ? '' : `<div class="cs-row-btns"><a class="cs-btn small ghost" id="fillFromPhoto" href="#/photo/dropoff">📷 ${esc(t('fillFromPhoto'))}</a></div>`}
    </section>`;
  }

  /** The attention mark: colour AND the word, never colour alone. */
  const markTail = (key) => `<span class="cs-markword" data-markword="${key}">${esc(t('checkMark'))}</span><button type="button" class="cs-btn small cs-okbtn" data-okmark="${key}">${esc(t('okBox'))}</button>`;

  function partHtml(r, ty, p, i, split) {
    const price = priceOf(r.cultivar, ty);
    const id = `${r.uid}-${ty}-${i}`;
    const marked = i === 0 && liveMark(r, ty);
    return `<div class="cs-part${marked ? ' cs-marked' : ''}">
      <label class="cs-label" for="${id}">${esc(typeLabel(ty))} ${esc(t('lbs'))}${split ? ` · ${esc(termLabel(p.term))}` : ''}</label>
      <input id="${id}" class="cs-input cs-num${marked ? ' cs-mark' : ''}" inputmode="decimal" autocomplete="off" data-lbs="${r.uid}|${ty}|${i}" value="${esc(p.lbs)}" placeholder="${esc(r.types[ty].on ? t('notWeighedYet') : t('notBrought'))}">
      ${marked ? `<div class="cs-markline">${markTail(`${r.uid}|${ty}`)}</div>` : ''}
      <div class="cs-price">${price == null ? `<span class="cs-chip noprice">${esc(t('noPrice'))}</span>` : `${esc(t('price'))}: ${money(price)} ${esc(t('perLb'))}`}</div>
      ${split ? '' : `<button type="button" class="cs-termbtn ${p.term}" data-term="${r.uid}|${ty}|${i}">${esc(termLabel(p.term))}</button>`}
    </div>`;
  }

  function nameHtml(r) {
    if (!(r.marks && (r.marks.name || !r.cultivar.trim()))) return `<span class="cs-crowname">${esc(r.cultivar)}</span>`;
    const listed = pricedCultivars().some((c) => c.toLowerCase() === r.cultivar.trim().toLowerCase());
    return `<div class="cs-namefix cs-marked"><input class="cs-input cs-mark" data-name="${r.uid}" value="${esc(r.cultivar)}" aria-label="${esc(t('cultivar'))}" placeholder="${esc(t('otherPlaceholder'))}" autocomplete="off">
      <div class="cs-markline">${markTail(`${r.uid}|name`)}${listed || !r.cultivar.trim() ? '' : `<span class="cs-muted">${esc(t('notOnPriceList'))}</span>`}</div></div>`;
  }

  function rowHtml(r) {
    return `<div class="cs-crow" data-row="${esc(r.cultivar)}" data-uid="${r.uid}">
      <div class="cs-crowhead">${nameHtml(r)}
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

  const canSave = () => buildLines().length > 0 && !badWeight() && !marksLeft() && !s.saving;
  const blockMsg = () => s.saveError || (marksLeft() ? `${t('checksLeft')}: ${marksLeft()}` : '') || (badWeight() ? t('badWeight') : '');

  function confirmStep() {
    const can = canSave();
    return `<section class="cs-card cs-step st-closed">${stepHead(4, 'stepConfirm')}
      <div id="summary">${confirmBody()}</div>
      <p class="cs-error" id="saveError"${blockMsg() ? '' : ' hidden'}>${esc(blockMsg())}</p>
      <div class="cs-row-btns"><button type="button" class="cs-btn primary big" id="saveBtn"${can ? '' : ' disabled'}>${esc(s.saving ? t('saving') : t('saveDropoff'))}</button></div>
    </section>`;
  }

  function render() {
    if (s.error) return errorCard(root, s.error, load);
    if (!s.farms || s.loadingFarm) return loading(root);
    const banner = s.fromPhoto ? `<div class="cs-photobanner" id="photoBanner" role="status">${esc(t('fromPhoto'))}</div>` : '';
    root.innerHTML = `<h2 class="cs-h2">${esc(t('newDropoff'))}</h2>${banner}<div class="cs-stack">
      ${farmStep()}${s.farm ? cultivarStep() + notesStep() + confirmStep() : ''}</div>`;
  }

  /** Refresh only the summary and save button, so typing keeps focus. */
  function refreshConfirm() {
    const sum = root.querySelector('#summary');
    if (!sum) return;
    sum.innerHTML = confirmBody();
    const err = root.querySelector('#saveError');
    const msg = blockMsg();
    err.textContent = msg;
    err.hidden = !msg;
    root.querySelector('#saveBtn').disabled = !canSave();
  }

  // ---------- events (delegated, so re-renders need no rewiring) ----------
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.dataset.farm) return pickFarm(Number(b.dataset.farm));
    if (b.id === 'changeFarm') { s.farm = null; s.detail = null; s.farmMark = false; return render(); }
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
    if (b.dataset.okmark === 'farm') { s.farmMark = false; return render(); }
    if (b.dataset.okmark) {
      const [uid, key] = b.dataset.okmark.split('|');
      const r = findRow(uid);
      if (key === 'name' && !r.cultivar.trim()) { const inp = root.querySelector(`[data-name="${uid}"]`); if (inp) inp.focus(); return; }
      r.marks[key] = false;
      if (key === 'name') r.cultivar = canonical(r.cultivar);
      return render();
    }
    if (b.id === 'saveBtn') return save();
  });

  /** The price list's spelling of a typed cultivar name, so the server finds the price point. */
  const canonical = (name) => {
    const raw = String(name || '').trim();
    return pricedCultivars().find((c) => c.toLowerCase() === raw.toLowerCase()) || raw;
  };
  /** An edit counts as checking that box: drop its mark in place, so typing keeps focus. */
  function clearMarkInPlace(el, r, key) {
    if (!r.marks || !r.marks[key]) return;
    if (key === 'name' && !el.value.trim()) return;
    r.marks[key] = false;
    el.classList.remove('cs-mark');
    const wrap = el.closest('.cs-marked');
    if (wrap) {
      wrap.classList.remove('cs-marked');
      wrap.querySelectorAll('.cs-markword, .cs-okbtn').forEach((x) => x.remove());
    }
  }

  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.lbs) {
      const [uid, ty, i] = el.dataset.lbs.split('|');
      const slot = findRow(uid).types[ty];
      slot.parts[Number(i)].lbs = el.value;
      if (i === '0') clearMarkInPlace(el, findRow(uid), ty);
      if (el.value.trim() && !slot.on) {
        // Typing a weight ticks the box.
        slot.on = true;
        const box = root.querySelector(`[data-on="${uid}|${ty}"]`);
        if (box) { box.checked = true; box.closest('.cs-type').classList.remove('off'); }
        root.querySelectorAll(`[data-lbs^="${uid}|${ty}|"]`).forEach((inp) => { inp.placeholder = t('notWeighedYet'); });
      }
    } else if (el.dataset.name) {
      const r = findRow(el.dataset.name);
      r.cultivar = el.value;
      clearMarkInPlace(el, r, 'name');
    } else if (el.dataset.rownote) findRow(el.dataset.rownote).note = el.value;
    else if (el.id === 'droppedBy') s.droppedBy = el.value;
    else if (el.id === 'dropNote') s.note = el.value;
    else return;
    s.saveError = '';
    refreshConfirm();
  });

  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.name) { findRow(el.dataset.name).cultivar = canonical(el.value); return; }
    if (!el.dataset.on) return;
    const [uid, ty] = el.dataset.on.split('|');
    const r = findRow(uid);
    r.types[ty].on = el.checked;
    // Ticking never confirms a number. An unsure weight's mark only counts while its type is
    // ticked (unticked, it is not saved); tick it again and the mark is back until edited or OK'd.
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
    } catch (err) { s.error = err; s.farm = null; s.detail = null; }
    s.loadingFarm = false;
    if (s.pending && s.detail) { applyPrefill(s.pending); s.pending = null; }
    // A changed farm has its own price list: photo rows whose name is not on it are checked again.
    else if (s.detail) {
      for (const r of s.rows) {
        if (r.marks && r.cultivar.trim() && !pricedCultivars().some((c) => c.toLowerCase() === r.cultivar.trim().toLowerCase())) r.marks.name = true;
      }
    }
    // Rows added before a farm change take the new farm's default term.
    for (const r of s.rows) for (const ty of TYPES) if (r.types[ty].parts.length === 1) r.types[ty].parts[0].term = defaultTerm();
    render();
  }

  async function save() {
    const lines = buildLines();
    if (!canSave()) return;
    setActor(s.droppedBy.trim());
    s.saving = true; s.saveError = ''; refreshConfirm();
    root.querySelector('#saveBtn').textContent = t('saving');
    // farm_name is ignored by the server; it lets a held entry say whose it was.
    const body = { farm_id: s.farm.id, farm_name: s.farm.name, dropped_by: s.droppedBy.trim(), note: s.note.trim(), client_key: s.key, lines };
    if (s.fromPhoto) body.source = 'paper';
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
    // A read that named a farm (or a sheet printed for one) opens on that farm.
    const want = s.farms && farmId ? s.farms.find((f) => f.id === farmId && f.active) : null;
    if (want) return pickFarm(want.id);
    render();
  }

  load();
  return {
    rerender: render,
    dirty: () => !s.saved && (s.fromPhoto || s.rows.length > 0 || !!s.note.trim()),
  };
}
