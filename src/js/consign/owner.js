/**
 * Owner mode. The owner password is asked for once, kept in sessionStorage only
 * (api.js), never rendered, and cleared the moment the server refuses it.
 * Owner actions: add/edit farm, add price point, change a lot's term or price, record or
 * void a payment. Only owner mode sees money: the server sends none without the password
 * (workers/src/lib/consign-staff-view.js) and the views draw none outside owner mode.
 *
 * A change of mode fires consign:mode; main.js redraws the view at once (money on screen
 * goes) and reloads it (owner mode fetches the money).
 */
import { t } from '../shared/i18n.js';
import { call, ownerPw, setOwnerPw } from './api.js';
import { dialog, toast } from './ui.js';
import { todayLocal, num } from './format.js';

export const isOwner = () => document.body.dataset.owner === '1';

function setMode(on) {
  const was = isOwner();
  if (on) document.body.dataset.owner = '1';
  else delete document.body.dataset.owner;
  const btn = document.getElementById('ownerBtn');
  btn.dataset.i18n = on ? 'ownerOn' : 'owner';
  btn.textContent = t(btn.dataset.i18n);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (was !== on) document.dispatchEvent(new CustomEvent('consign:mode'));
}

/** The server did not take the owner password (api.js): owner mode goes off, once. */
function refused() {
  setOwnerPw('');
  if (!isOwner()) return;
  setMode(false);
  toast(t('ownerWrong'), 'err');
}

/**
 * An owner action. On a refused owner password, api.js fires consign:ownerrefused
 * (owner mode off, the person told) before this rejects.
 */
export const ownerCall = (action, body) => call(action, body);

const reload = () => document.dispatchEvent(new CustomEvent('consign:reload'));
const termOptions = () => [{ value: 'dropoff', label: t('termDropoff') }, { value: 'sold', label: t('termSold') }];
const showErr = (err) => { if (!err.owner) toast(err.network ? t('errOffline') : err.message, 'err'); };

export async function farmDialog(farm = null) {
  const v = await dialog({
    title: farm ? t('editFarm') : t('addFarm'),
    fields: [
      { name: 'name', label: t('farmName'), value: farm?.name || '', required: true },
      { name: 'contact', label: t('contact'), value: farm?.contact || '' },
      { name: 'default_term', label: t('defaultTerm'), type: 'select', value: farm?.default_term || 'dropoff', options: termOptions() },
      { name: 'lang', label: t('language'), type: 'select', value: farm?.lang || 'en', options: [{ value: 'en', label: 'English' }, { value: 'es', label: 'Español' }] },
      ...(farm ? [{ name: 'active', label: t('active'), type: 'checkbox', value: !!farm.active }] : []),
    ],
    okLabel: t('save'),
  });
  if (!v) return null;
  try {
    const { farm: saved } = await ownerCall('saveFarm', { ...v, id: farm?.id, active: farm ? v.active : true });
    toast(t('saved'));
    reload();
    return saved;
  } catch (err) { showErr(err); return null; }
}

export async function priceDialog(farm, cultivar = '') {
  const v = await dialog({
    title: `${t('addPricePoint')}: ${farm.name}`,
    fields: [
      { name: 'cultivar', label: t('cultivar'), value: cultivar, required: true },
      { name: 'type', label: t('type'), type: 'select', value: 'tops', options: [{ value: 'tops', label: t('tops') }, { value: 'smalls', label: t('smalls') }] },
      { name: 'price_per_lb', label: `${t('pricePerLb')} ($)`, type: 'number', required: true },
      { name: 'effective_from', label: t('effectiveFrom'), type: 'date', value: todayLocal(), required: true },
      { name: 'apply_to_unpriced', label: t('applyToUnpriced'), type: 'checkbox', value: true },
    ],
    okLabel: t('save'),
  });
  if (!v) return;
  try {
    await ownerCall('savePricePoint', { farm_id: farm.id, ...v, price_per_lb: num(v.price_per_lb) });
    toast(t('saved'));
    reload();
  } catch (err) { showErr(err); }
}

export async function lotTermsDialog(lot) {
  const v = await dialog({
    title: `${t('editPrice')}: ${lot.cultivar} ${t(lot.type)}`,
    fields: [
      { name: 'term', label: t('term'), type: 'select', value: lot.term, options: termOptions() },
      { name: 'price_per_lb', label: `${t('pricePerLb')} ($)`, type: 'number', value: lot.price_per_lb ?? '' },
      ...(lot.type === 'tops' ? [{ name: 'smalls_price_per_lb', label: `${t('smallsPrice')} ($)`, type: 'number', value: lot.smalls_price_per_lb ?? '' }] : []),
      // Only a lot with a note has something to show the farm.
      ...(lot.note ? [{ name: 'note_visible', label: `${t('showNoteToFarm')}: “${lot.note}”`, type: 'checkbox', value: Number(lot.note_visible) === 1 }] : []),
    ],
    okLabel: t('save'),
  });
  if (!v) return;
  const body = { lot_id: lot.id, term: v.term };
  if (v.price_per_lb !== '') body.price_per_lb = num(v.price_per_lb);
  if (v.smalls_price_per_lb) body.smalls_price_per_lb = num(v.smalls_price_per_lb);
  if (lot.note) body.note_visible = !!v.note_visible;
  try {
    await ownerCall('setLotTerms', body);
    toast(t('saved'));
    reload();
  } catch (err) { showErr(err); }
}

export function initOwner() {
  setMode(!!ownerPw());
  document.getElementById('ownerBtn').addEventListener('click', async () => {
    if (isOwner()) { setOwnerPw(''); setMode(false); toast(t('ownerOffDone')); return; }
    const v = await dialog({ title: t('owner'), fields: [{ name: 'pw', label: t('ownerPassword'), type: 'password', required: true }], okLabel: t('ok') });
    if (!v) return;
    setOwnerPw(v.pw);
    setMode(true);
  });
  document.addEventListener('consign:ownerrefused', refused);
  document.addEventListener('consign:addfarm', () => { farmDialog(); });
  document.addEventListener('ro:langchange', () => setMode(isOwner()));
}
