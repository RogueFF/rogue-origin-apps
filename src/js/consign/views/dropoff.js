/**
 * New dropoff, in four numbered steps: farm, cultivars and pounds, names and notes, check and save.
 * Staff record pounds only: no price and no money appear here. Owner mode shows each line's
 * locked price. A cultivar and type with no price point shows "No price" in both modes.
 *
 * Prefill (stage 2): views/photo.js mounts this with { prefill: read } after a sheet photo is
 * read. Every box the reader was unsure of, and every cultivar it could not match, is marked
 * "Check" until the person edits it or taps OK; Save stays off while any mark is left.
 *
 * Final lb (optional, per part): the weight after checking at dropoff. Equal to the weight
 * (within the screening tolerance) or with no weight: the lot is finished as it came in. Lower:
 * loss boxes open with the screening screen's add-up bar (format.runCheck), and Save waits until
 * they add up. Higher: an error. The server applies the same rule (checkRun) and closes the lot.
 */
import { t } from '../../shared/i18n.js';
import { call, newKey } from '../api.js';
import { esc, lbs, money, num, tf, termLabel, typeLabel, runCheck, checkBarHtml } from '../format.js';
import { errorCard, loading, toast } from '../ui.js';
import { submit, actor, setActor } from '../save.js';
import { isOwner } from '../owner.js';
import { go } from '../nav.js';

const TYPES = ['tops', 'smalls'];
/** Where a lower final went, per type, in screening order. Smalls cannot turn into smalls. */
const LOSSES = { tops: ['toSmalls', 'biomass', 'mold'], smalls: ['biomass', 'mold'] };
const LOSS_API = { toSmalls: 'to_smalls_lbs', biomass: 'biomass_lbs', mold: 'mold_lbs' };
const blank = (v) => String(v ?? '').trim() === '';
const newPart = (term, lbsText = '', final = '') => ({ term, lbs: lbsText, final, loss: { toSmalls: '', biomass: '', mold: '' } });

/**
 * What a part's Final box asks for:
 *   none (empty) | asis (no weight: taken as weighed) | equal | losses (lower: where did it go?)
 *   | over (higher than the weight) | bad (not a number) | zero (0 with no weight) | wait (bad weight)
 * Equal / over / lower use the screening tolerance through format.runCheck, not a copy of it.
 */
function finalMode(p) {
  if (blank(p.final)) return 'none';
  const fin = num(p.final);
  if (fin == null || fin < 0) return 'bad';
  if (blank(p.lbs)) return fin > 0 ? 'asis' : 'zero';
  const intake = num(p.lbs);
  if (!(intake > 0)) return 'wait';
  const c = runCheck(intake, [fin]);
  if (c.ok) return 'equal';
  return c.diff < 0 ? 'over' : 'losses';
}
const lossCheck = (ty, p) => runCheck(num(p.lbs), [num(p.final), ...LOSSES[ty].map((k) => num(p.loss[k]) || 0)]);
const lossJunk = (ty, p) => LOSSES[ty].some((k) => !blank(p.loss[k]) && !(num(p.loss[k]) >= 0));
/** Why this part cannot be saved yet (a label key), or ''. */
function finalProblem(ty, p) {
  const mode = finalMode(p);
  if (mode === 'over') return 'finalOver';
  if (mode === 'bad') return 'finalBad';
  if (mode === 'zero') return 'finalZeroNoWeight';
  if (mode === 'losses' && (lossJunk(ty, p) || !lossCheck(ty, p).ok)) return 'lossesOff';
  return '';
}
/** The line's final for the server; losses are sent only while their boxes are showing. */
function finalPayload(ty, p) {
  const mode = finalMode(p);
  if (mode === 'asis' || mode === 'equal') return { final_lbs: num(p.final) };
  if (mode !== 'losses') return undefined;
  const out = { final_lbs: num(p.final) };
  for (const k of LOSSES[ty]) out[LOSS_API[k]] = num(p.loss[k]) || 0;
  return out;
}
let uidSeq = 0;

export function mount(root, { prefill = null, farmId = null, farmCheck = false } = {}) {
  const s = {
    farms: null, farm: null, detail: null, error: null, loadingFarm: false,
    rows: [], droppedBy: actor(), note: '', key: newKey(), saving: false, saveError: '', saved: false,
    fromPhoto: !!prefill, pending: prefill, farmMark: !!farmCheck,
  };

  const pointOf = (cultivar, type) => (s.detail?.price_points || []).find((p) => p.cultivar.toLowerCase() === cultivar.toLowerCase() && p.type === type);
  /** The locked price, owner mode only (a staff price point has cultivar and type, no price). */
  const priceOf = (cultivar, type) => {
    const pp = pointOf(cultivar, type);
    return isOwner() && pp && typeof pp.price_per_lb === 'number' ? pp.price_per_lb : null;
  };
  /** Price text for a line: the price (owner), "No price" (no price point), or nothing (staff, priced). */
  const priceText = (cultivar, type) => {
    if (!pointOf(cultivar, type)) return { none: true };
    const p = priceOf(cultivar, type);
    return p == null ? null : { price: p };
  };
  const pricedCultivars = () => [...new Set((s.detail?.price_points || []).map((p) => p.cultivar))].sort((a, b) => a.localeCompare(b));
  /** The dropdown's list: the farm's priced cultivars, then any it has dropped off before. One spelling each. */
  const knownCultivars = () => {
    const seen = new Map();
    const add = (c) => { const k = String(c || '').trim(); if (k && !seen.has(k.toLowerCase())) seen.set(k.toLowerCase(), k); };
    pricedCultivars().forEach(add);
    for (const d of s.detail?.dropoffs || []) for (const l of d.lots || []) add(l.cultivar);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  };
  const findRow = (uid) => s.rows.find((r) => r.uid === uid);
  const defaultTerm = () => s.farm?.default_term || 'dropoff';

  function addRow(name) {
    const raw = String(name || '').trim();
    if (!raw) return;
    // Use the price list's spelling so the server finds the price point.
    const cultivar = knownCultivars().find((c) => c.toLowerCase() === raw.toLowerCase()) || raw;
    if (s.rows.some((r) => r.cultivar.toLowerCase() === cultivar.toLowerCase())) return;
    s.rows.push({
      uid: `r${++uidSeq}`, cultivar, note: '',
      types: Object.fromEntries(TYPES.map((ty) => [ty, { on: false, parts: [newPart(defaultTerm())] }])),
    });
  }

  /** Every part that becomes a lot: { r, ty, p }. */
  function sentParts() {
    const out = [];
    for (const r of s.rows) {
      for (const ty of TYPES) {
        const slot = r.types[ty];
        if (!slot.on) continue;
        // A split side left empty is not a lot; an empty split is one unweighed lot on the default term.
        let parts = slot.parts;
        if (parts.length > 1) {
          parts = parts.filter((p) => !blank(p.lbs) || !blank(p.final));
          if (!parts.length) parts = [newPart(defaultTerm())];
        }
        for (const p of parts) out.push({ r, ty, p });
      }
    }
    return out;
  }
  function buildLines() {
    return sentParts().map(({ r, ty, p }) => {
      const line = { cultivar: r.cultivar, type: ty, term: p.term, intake_lbs: num(p.lbs), note: r.note.trim() || undefined };
      const final = finalPayload(ty, p);
      if (final) line.final = final;
      return line;
    });
  }
  /** The first Final problem among the parts that will be saved, as a label key, or ''. */
  const finalBlock = () => sentParts().map(({ ty, p }) => finalProblem(ty, p)).find(Boolean) || '';

  /**
   * Boxes still marked "Check", plus photo rows with no cultivar name yet. Keys: name, tops,
   * smalls, tops_final, smalls_final, tops_loss, smalls_loss (marks sit on a type's first part).
   * A type's marks count only while it is ticked; a loss mark only while its loss boxes show.
   */
  const MARK_KEYS = ['name', ...TYPES.flatMap((ty) => [ty, `${ty}_final`, `${ty}_loss`])];
  const liveMark = (r, k) => {
    if (!(r.marks && r.marks[k])) return false;
    if (k === 'name') return true;
    const [ty, sub] = k.split('_');
    const slot = r.types[ty];
    if (!slot.on) return false;
    return sub === 'loss' ? finalMode(slot.parts[0]) === 'losses' : true;
  };
  const marksLeft = () => (s.farmMark ? 1 : 0) + s.rows.reduce((n, r) => n + MARK_KEYS.filter((k) => liveMark(r, k)).length, 0)
    + s.rows.filter((r) => !r.cultivar.trim() && !(r.marks && r.marks.name)).length;

  /** Put a sheet read into the form. Weights are text, exactly as read; nothing is saved here. */
  function applyPrefill(read) {
    s.rows = [];
    for (const pr of read.rows) {
      const raw = String(pr.cultivar || '').trim();
      const known = raw ? pricedCultivars().find((c) => c.toLowerCase() === raw.toLowerCase()) : undefined;
      const dup = raw && s.rows.some((r) => r.cultivar.toLowerCase() === raw.toLowerCase());
      const fin = (ty) => pr[`${ty}_final`] || { value: null, unsure: false };
      const row = {
        uid: `r${++uidSeq}`, cultivar: known || raw, note: pr.note || '',
        types: Object.fromEntries(TYPES.map((ty) => [ty, {
          on: !!pr[ty].on,
          parts: [newPart(defaultTerm(), pr[ty].value == null ? '' : String(pr[ty].value), fin(ty).value == null ? '' : String(fin(ty).value))],
        }])),
        marks: { name: !pr.cultivar_known || !known || !!dup, tops: !!pr.tops.unsure, smalls: !!pr.smalls.unsure },
      };
      for (const ty of TYPES) {
        row.marks[`${ty}_final`] = !!fin(ty).unsure;
        // A final read lower than its weight: the loss boxes open empty and a person says where it went.
        row.marks[`${ty}_loss`] = finalMode(row.types[ty].parts[0]) === 'losses';
      }
      s.rows.push(row);
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

  /** What shows under the Final box: nothing, "finished", an error, or the loss boxes. */
  function finalxInner(r, ty, p, i) {
    const mode = finalMode(p);
    const fin = num(p.final);
    if (mode === 'asis' || mode === 'equal') {
      const before = mode === 'asis' ? fin : num(p.lbs);
      return `<div class="cs-finalnote">✓ ${esc(t('finishedAtDropoff'))}: ${lbs(before)} → ${lbs(fin)} ${esc(t('lbs'))}</div>`;
    }
    const err = { over: 'finalOver', bad: 'finalBad', zero: 'finalZeroNoWeight' }[mode];
    if (err) return `<p class="cs-error">${esc(t(err))}</p>`;
    if (mode !== 'losses') return '';
    const key = `${r.uid}|${ty}|${i}`;
    const marked = i === 0 && liveMark(r, `${ty}_loss`);
    const gap = Math.round((num(p.lbs) - fin) * 100) / 100;
    return `<div class="cs-losses${marked ? ' cs-marked' : ''}">
      <div class="cs-label cs-losshead">${esc(tf('whereDiffWent', { n: lbs(gap) }))}</div>
      <div class="cs-lossgrid">${LOSSES[ty].map((k) => `<label class="cs-field"><span class="cs-label">${esc(t(k))} (${esc(t('lbs'))})</span>
        <input class="cs-input cs-num" inputmode="decimal" autocomplete="off" data-loss="${key}|${k}" value="${esc(p.loss[k])}"></label>`).join('')}</div>
      ${marked ? `<div class="cs-markline">${markTail(`${r.uid}|${ty}_loss`)}</div>` : ''}
      <div data-lossbar="${key}">${checkBarHtml(lossCheck(ty, p))}</div>
    </div>`;
  }
  const finalxHtml = (r, ty, p, i) => `<div class="cs-finalx" data-finalx="${r.uid}|${ty}|${i}" data-mode="${finalMode(p)}">${finalxInner(r, ty, p, i)}</div>`;

  function partHtml(r, ty, p, i, split) {
    const price = priceText(r.cultivar, ty);
    const id = `${r.uid}-${ty}-${i}`;
    const marked = i === 0 && liveMark(r, ty);
    const finMarked = i === 0 && liveMark(r, `${ty}_final`);
    return `<div class="cs-part${marked ? ' cs-marked' : ''}">
      <label class="cs-label" for="${id}">${esc(typeLabel(ty))} ${esc(t('lbs'))}${split ? ` · ${esc(termLabel(p.term))}` : ''}</label>
      <input id="${id}" class="cs-input cs-num${marked ? ' cs-mark' : ''}" inputmode="decimal" autocomplete="off" data-lbs="${r.uid}|${ty}|${i}" value="${esc(p.lbs)}" placeholder="${esc(r.types[ty].on ? t('notWeighedYet') : t('notBrought'))}">
      ${marked ? `<div class="cs-markline">${markTail(`${r.uid}|${ty}`)}</div>` : ''}
      <div class="cs-finalbox${finMarked ? ' cs-marked' : ''}">
        <label class="cs-label" for="${id}-final">${esc(t('finalLb'))}</label>
        <input id="${id}-final" class="cs-input cs-num${finMarked ? ' cs-mark' : ''}" inputmode="decimal" autocomplete="off" data-final="${r.uid}|${ty}|${i}" value="${esc(p.final)}" placeholder="${esc(t('finalOptional'))}">
        ${finMarked ? `<div class="cs-markline">${markTail(`${r.uid}|${ty}_final`)}</div>` : ''}
      </div>
      ${finalxHtml(r, ty, p, i)}
      ${price == null ? '' : `<div class="cs-price">${price.none ? `<span class="cs-chip noprice">${esc(t('noPrice'))}</span>` : `${esc(t('price'))}: ${money(price.price)} ${esc(t('perLb'))}`}</div>`}
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
    const left = knownCultivars().filter((c) => !s.rows.some((r) => r.cultivar.toLowerCase() === c.toLowerCase()));
    // No known cultivar left to pick: go straight to typing a new one.
    const typing = s.newCult || !left.length;
    return `<section class="cs-card cs-step">${stepHead(2, 'stepCultivars')}
      <div class="cs-stack" id="rows">${s.rows.map(rowHtml).join('')}</div>
      <label class="cs-field" style="margin-top:16px"><span class="cs-label">${esc(t('addCultivar'))}</span>
        <select class="cs-input cs-select" id="cultPick">
          <option value="">${esc(t('pickCultivar'))}</option>
          ${left.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          <option value="__new"${typing ? ' selected' : ''}>＋ ${esc(t('newCultivar'))}</option>
        </select></label>
      ${typing ? `<div class="cs-other"><input class="cs-input" id="otherName" placeholder="${esc(t('otherPlaceholder'))}" aria-label="${esc(t('newCultivar'))}" autocomplete="off">
        <button type="button" class="cs-btn primary" id="addOther">＋ ${esc(t('addIt'))}</button></div>` : ''}
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
        const price = priceText(l.cultivar, l.type);
        const f = l.final;
        let weight;
        let done = '';
        if (f) {
          const out = [['toSmalls', f.to_smalls_lbs], ['biomass', f.biomass_lbs], ['mold', f.mold_lbs]].filter(([, v]) => v > 0);
          weight = `${lbs(l.intake_lbs ?? f.final_lbs)} → ${lbs(f.final_lbs)} ${esc(t('lbs'))}`;
          done = `<div class="cs-sumdone"><span class="cs-chip st-closed">✓ ${esc(t('finishedAtDropoff'))}</span>${out.length ? ` <span class="cs-muted">${out.map(([k, v]) => `${esc(t(k))} ${lbs(v)}`).join(' · ')}</span>` : ''}</div>`;
        } else {
          weight = l.intake_lbs == null ? `<span class="cs-muted">${esc(t('notWeighedYet'))}</span>` : `${lbs(l.intake_lbs)} ${esc(t('lbs'))}`;
        }
        return `<tr${f ? ' data-finished="1"' : ''}><td><b>${esc(l.cultivar)}</b> ${esc(typeLabel(l.type))}<br><span class="cs-muted">${esc(termLabel(l.term))}${price == null ? '' : ` · ${price.none ? esc(t('noPrice')) : `${money(price.price)} ${esc(t('perLb'))}`}`}</span>${done}</td>
          <td class="n">${weight}</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  const canSave = () => buildLines().length > 0 && !badWeight() && !finalBlock() && !marksLeft() && !s.saving;
  const blockMsg = () => s.saveError || (marksLeft() ? `${t('checksLeft')}: ${marksLeft()}` : '') || (badWeight() ? t('badWeight') : '')
    || (finalBlock() ? t(finalBlock()) : '');

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
    if (b.id === 'addOther') {
      const v = root.querySelector('#otherName').value;
      if (!v.trim()) return root.querySelector('#otherName').focus();
      s.newCult = false;
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
        const total = Math.round(slot.parts.reduce((a, p) => a + (num(p.lbs) || 0), 0) * 100) / 100;
        // Finals are not merged: summed finals can disagree with the summed weight (a part with
        // no weight, two small in-tolerance gaps). The final is asked again for the whole line.
        slot.parts = [newPart(defaultTerm(), total > 0 ? String(total) : '')];
      } else {
        // One part per term: the server refuses the same cultivar, type and term twice.
        const first = slot.parts[0];
        slot.parts = [{ ...first, loss: { ...first.loss }, term: 'dropoff' }, newPart('sold')];
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
      // Only this box's own mark line: a weight's part also holds the Final box and loss marks.
      wrap.querySelectorAll(':scope > .cs-markline > .cs-markword, :scope > .cs-markline > .cs-okbtn').forEach((x) => x.remove());
    }
  }

  /** Redraw one part's Final area. The boxes typed in sit outside it, so focus stays. */
  function refreshFinalx(uid, ty, i) {
    const wrap = root.querySelector(`[data-finalx="${uid}|${ty}|${i}"]`);
    if (!wrap) return;
    const r = findRow(uid);
    const p = r.types[ty].parts[Number(i)];
    wrap.dataset.mode = finalMode(p);
    wrap.innerHTML = finalxInner(r, ty, p, Number(i));
  }
  function tickType(uid, ty) {
    const slot = findRow(uid).types[ty];
    if (slot.on) return;
    slot.on = true;
    const box = root.querySelector(`[data-on="${uid}|${ty}"]`);
    if (box) { box.checked = true; box.closest('.cs-type').classList.remove('off'); }
    root.querySelectorAll(`[data-lbs^="${uid}|${ty}|"]`).forEach((inp) => { inp.placeholder = t('notWeighedYet'); });
  }

  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.lbs || el.dataset.final) {
      const field = el.dataset.lbs ? 'lbs' : 'final';
      const [uid, ty, i] = el.dataset[field].split('|');
      findRow(uid).types[ty].parts[Number(i)][field] = el.value;
      if (i === '0') clearMarkInPlace(el, findRow(uid), field === 'lbs' ? ty : `${ty}_final`);
      // Typing a weight or a final ticks the box.
      if (el.value.trim()) tickType(uid, ty);
      refreshFinalx(uid, ty, i);
    } else if (el.dataset.loss) {
      const [uid, ty, i, k] = el.dataset.loss.split('|');
      const r = findRow(uid);
      const p = r.types[ty].parts[Number(i)];
      p.loss[k] = el.value;
      // Typing where the difference went checks the loss boxes: drop their mark in place.
      if (i === '0' && r.marks && r.marks[`${ty}_loss`]) {
        r.marks[`${ty}_loss`] = false;
        const group = el.closest('.cs-losses');
        group.classList.remove('cs-marked');
        group.querySelectorAll('.cs-markline').forEach((x) => x.remove());
      }
      const bar = root.querySelector(`[data-lossbar="${uid}|${ty}|${i}"]`);
      if (bar) bar.innerHTML = checkBarHtml(lossCheck(ty, p));
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
    if (e.target.id === 'cultPick') {
      const v = e.target.value;
      if (v === '__new') { s.newCult = true; render(); return root.querySelector('#otherName')?.focus(); }
      s.newCult = false;
      if (v) { addRow(v); render(); return focusLast(); }
      return render();
    }
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

  // Owner mode on: fetch the farm again for its prices. Off: main.js has redrawn without them.
  async function onMode() {
    if (!s.farm || s.loadingFarm) return;
    const id = s.farm.id;
    try {
      const d = await call('farm', { farm_id: id });
      if (s.farm && s.farm.id === id) { s.detail = d; render(); }
    } catch { /* keep the form as it is; prices show on the next farm pick */ }
  }
  document.addEventListener('consign:mode', onMode);

  load();
  return {
    rerender: render,
    dirty: () => !s.saved && (s.fromPhoto || s.rows.length > 0 || !!s.note.trim()),
    unmount: () => document.removeEventListener('consign:mode', onMode),
  };
}
