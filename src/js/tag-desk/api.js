/**
 * Tag & Desk — the only place that talks to /api/kanban.
 * Every action already exists on the worker; nothing here is new server-side.
 * Responses come back as the worker sends them ({ success, ... }); shared/api.js
 * only unwraps a `data` envelope, which kanban does not use.
 */
import { apiGet, apiPost } from '../shared/api.js';

const EP = 'kanban';
const ok = r => { if (!r || r.success === false) throw new Error(r?.error || 'Request failed'); return r; };

export const getCards = () => apiGet(EP, 'cards').then(r => ok(r).cards || []);
export const getCart = () => apiGet(EP, 'getCart').then(r => ok(r).cart || {});
export const getOrders = (limit = 500) => apiGet(EP, 'getOrderHistory', { limit }).then(r => ok(r).orders || []);
export const getRequests = (status = 'all') => apiGet(EP, 'getReorderRequests', { status }).then(r => ok(r).requests || []);

/** Re-scan of a queued card SUMS on the worker — callers check the cart first (model.scanPlan). */
export const addToCart = ({ cardId, qty = 1, note, addedBy }) => apiPost(EP, 'addToCart', { cardId, qty, note, addedBy }).then(ok);
export const setCartQty = (cardId, qty) => apiPost(EP, 'updateCartQty', { cardId, qty }).then(ok);
export const removeFromCart = cardId => apiPost(EP, 'removeFromCart', { cardId }).then(ok);
export const markOrdered = (vendor, placedBy = 'desk') => apiPost(EP, 'markOrdered', { vendor, placedBy }).then(ok);
/** `update` is a full-row overwrite on the worker: send every field (model.toRawCard builds it). */
export const updateCard = raw => apiPost(EP, 'update', raw).then(ok);
export const addCard = raw => apiPost(EP, 'add', raw).then(ok);
export const deleteCard = id => apiPost(EP, 'delete', { id }).then(ok);

/** Set a note on a queued card without changing its quantity (the worker has no note-only action). */
export async function setCartNote(cardId, note, currentQty) {
  await addToCart({ cardId, qty: 1, note });
  return setCartQty(cardId, currentQty);
}

// ---------- Grove bin lanes ----------
export const getBinStatus = () => apiGet(EP, 'getBinStatus').then(ok);
export const receiveBins = body => apiPost(EP, 'receiveBins', body).then(ok);
export const recountBins = (cardId, sealedBins, by = 'desk') => apiPost(EP, 'recount', { cardId, sealedBins, by }).then(ok);
export const setBinConfig = body => apiPost(EP, 'setBinConfig', body).then(ok);
export const makeLaneKit = cardId => apiPost(EP, 'makeLaneKit', { cardId }).then(ok);
export const getRecipes = () => apiGet(EP, 'getRecipes').then(ok);
export const setRecipe = body => apiPost(EP, 'setRecipe', body).then(ok);
/** A Grove email the parser could not apply, dealt with by hand (email intake, design §9b). */
export const markMailHandled = (id, by = 'desk') => apiPost(EP, 'markMailHandled', { id, by }).then(ok);

export async function loadAll() {
  // bins: a worker without the bins migration still loads the Desk; the Grove tab says why it is empty.
  const [cards, cart, orders, requests, bins] = await Promise.all([getCards(), getCart(), getOrders(), getRequests(), getBinStatus().catch(e => ({ lanes: [], unmapped: [], unavailable: String(e?.message || e) }))]);
  return { cards, cart, orders, requests, bins };
}
