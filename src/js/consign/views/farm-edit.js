/**
 * Owner edits on the farm page: one dialog per saved thing (price point, dropoff, lot,
 * screening run, sold entry, payment). Owner mode only: farm.js draws the Edit buttons only
 * in owner mode, and the server refuses every edit without the owner password.
 *
 * Each dialog sends only the fields that changed. The server re-checks everything
 * (workers/src/handlers/consign-d1.js) and its refusal is shown as a toast, word for word.
 * After a save the farm is read again (consign:reload) and redrawn.
 */
import { t } from '../../shared/i18n.js';
import { num, tf, todayLocal } from '../format.js';
import { dialog, toast } from '../ui.js';
import { ownerCall } from '../owner.js';
import { actor } from '../save.js';

const reload = () => document.dispatchEvent(new CustomEvent('consign:reload'));
const showErr = (err) => { if (!err.owner) toast(err.network ? t('errOffline') : err.message, 'err'); };
const typeOptions = () => [{ value: 'tops', label: t('tops') }, { value: 'smalls', label: t('smalls') }];
const METHODS = ['check', 'cash', 'transfer'];
/** The three methods, plus "none" or an older free-text method when the payment has one. */
const methodOptions = (cur) => [
  ...(!cur ? [{ value: '', label: '—' }] : []),
  ...(cur && !METHODS.includes(cur) ? [{ value: cur, label: cur }] : []),
  ...METHODS.map((m) => ({ value: m, label: t(m) })),
];

/** SQLite UTC ("2026-11-16 18:00:00") as this device's calendar day, YYYY-MM-DD. */
function localDay(ts) {
  const d = new Date(`${String(ts || '').replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return todayLocal();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The fields of a dialog reply that differ from the row. nums: number fields (sent as
 * numbers; a typed value that is not a number goes as typed, so the server's message shows).
 */
function changed(v, row, nums = []) {
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'boolean') continue;
    if (nums.includes(k)) {
      const n = val === '' ? null : num(val);
      const was = row[k] == null ? null : Number(row[k]);
      if (n === null && val !== '') out[k] = val;
      else if (n !== was) out[k] = n === null ? '' : n;
    } else if (val !== String(row[k] ?? '')) out[k] = val;
  }
  return out;
}

/** Send an edit; toast and reload on success. Nothing changed: no call. */
async function save(action, ids, body, okMsg) {
  if (!Object.keys(body).length) { toast(t('nothingChanged')); return null; }
  try {
    const res = await ownerCall(action, { ...ids, ...body, actor: actor() || 'owner' });
    toast(okMsg ? okMsg(res) : t('saved'));
    reload();
    return res;
  } catch (err) { showErr(err); return null; }
}

export async function editPriceDialog(p) {
  const v = await dialog({
    title: `${t('editPricePoint')}: ${p.cultivar} ${t(p.type)}`,
    fields: [
      { name: 'cultivar', label: t('cultivar'), value: p.cultivar, required: true },
      { name: 'type', label: t('type'), type: 'select', value: p.type, options: typeOptions() },
      { name: 'price_per_lb', label: `${t('pricePerLb')} ($)`, type: 'number', value: p.price_per_lb, required: true },
      { name: 'effective_from', label: t('effectiveFrom'), type: 'date', value: p.effective_from, required: true },
      { name: 'update_lots', label: t('updateOldPriceLots'), type: 'checkbox', value: true },
    ],
    okLabel: t('save'),
    extra: { label: t('delete'), value: 'delete' },
  });
  if (!v) return;
  if (v === 'delete') {
    const sure = await dialog({ title: `${t('delete')}: ${p.cultivar} ${t(p.type)}`, message: t('deletePriceConfirm'), okLabel: t('delete'), danger: true });
    if (!sure) return;
    try {
      await ownerCall('deletePricePoint', { id: p.id, actor: actor() || 'owner' });
      toast(t('deleted'));
      reload();
    } catch (err) { showErr(err); }
    return;
  }
  const body = changed(v, p, ['price_per_lb']);
  if ('price_per_lb' in body) body.update_lots = !!v.update_lots;
  await save('editPricePoint', { id: p.id }, body, (res) => (res && res.lots_updated ? tf('lotsMoved', { n: res.lots_updated }) : t('saved')));
}

export async function editDropoffDialog(d) {
  const row = { dropped_on: localDay(d.dropped_at), dropped_by: d.dropped_by, note: d.note };
  const v = await dialog({
    title: t('editDropoff'),
    fields: [
      { name: 'dropped_on', label: t('dropoffDate'), type: 'date', value: row.dropped_on, required: true },
      { name: 'dropped_by', label: t('receivedBy'), value: d.dropped_by || '' },
      { name: 'note', label: t('dropoffNote'), value: d.note || '' },
    ],
    okLabel: t('save'),
  });
  if (!v) return;
  await save('editDropoff', { dropoff_id: d.id }, changed(v, row));
}

export async function editLotDialog(lot) {
  const v = await dialog({
    title: `${t('editLot')}: ${lot.cultivar} ${t(lot.type)}`,
    fields: [
      { name: 'cultivar', label: t('cultivar'), value: lot.cultivar, required: true },
      { name: 'type', label: t('type'), type: 'select', value: lot.type, options: typeOptions() },
      { name: 'intake_lbs', label: `${t('intakeWeight')} (${t('lbs')})`, type: 'number', value: lot.intake_lbs ?? '' },
      { name: 'note', label: t('note'), value: lot.note || '' },
    ],
    okLabel: t('save'),
  });
  if (!v) return;
  const body = changed(v, lot, ['intake_lbs']);
  // An empty weight on a lot never weighed is no change; the server keeps a weight once set.
  if (body.intake_lbs === '' && lot.intake_lbs == null) delete body.intake_lbs;
  await save('editLot', { lot_id: lot.id }, body);
}

export async function editRunDialog(lot, run) {
  const nums = ['pulled_lbs', 'final_lbs', 'to_smalls_lbs', 'biomass_lbs', 'mold_lbs'];
  const v = await dialog({
    title: `${t('editRun')}: ${lot.cultivar} ${t(lot.type)}`,
    fields: [
      { name: 'pulled_lbs', label: `${t('pulled')} (${t('lbs')})`, type: 'number', value: run.pulled_lbs, required: true },
      { name: 'final_lbs', label: `${t(lot.type === 'smalls' ? 'finalSmalls' : 'finalTops')} (${t('lbs')})`, type: 'number', value: run.final_lbs },
      ...(lot.type === 'tops' ? [{ name: 'to_smalls_lbs', label: `${t('toSmalls')} (${t('lbs')})`, type: 'number', value: run.to_smalls_lbs }] : []),
      { name: 'biomass_lbs', label: `${t('biomass')} (${t('lbs')})`, type: 'number', value: run.biomass_lbs },
      { name: 'mold_lbs', label: `${t('mold')} (${t('lbs')})`, type: 'number', value: run.mold_lbs },
      { name: 'note', label: t('note'), value: run.note || '' },
    ],
    okLabel: t('save'),
  });
  if (!v) return;
  await save('editScreenRun', { run_id: run.id }, changed(v, run, nums));
}

export async function editSoldDialog(lot, sold) {
  const v = await dialog({
    title: `${t('editSold')}: ${lot.cultivar} ${t(lot.type)}`,
    fields: [
      { name: 'lbs', label: `${t('sold')} (${t('lbs')})`, type: 'number', value: sold.lbs, required: true },
      { name: 'sold_on', label: t('date'), type: 'date', value: sold.sold_on, required: true },
      { name: 'note', label: t('note'), value: sold.note || '' },
    ],
    okLabel: t('save'),
  });
  if (!v) return;
  await save('editSold', { sold_id: sold.id }, changed(v, sold, ['lbs']));
}

export async function editPaymentDialog(p) {
  const v = await dialog({
    title: t('editPayment'),
    fields: [
      { name: 'amount', label: t('amount'), type: 'number', value: p.amount, required: true },
      { name: 'paid_on', label: t('date'), type: 'date', value: p.paid_on, required: true },
      { name: 'method', label: t('method'), type: 'select', value: p.method || '', options: methodOptions(p.method) },
      { name: 'reference', label: t('reference'), value: p.reference || '' },
      { name: 'note', label: t('note'), value: p.note || '' },
    ],
    okLabel: t('save'),
  });
  if (!v) return;
  await save('editPayment', { payment_id: p.id }, changed(v, p, ['amount']));
}
