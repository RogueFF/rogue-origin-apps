/**
 * Consignment API Module
 * Handles all API calls to /api/consignment
 */

const API_BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/consignment';

// Offline queue
const offlineQueue = [];
let isOnline = navigator.onLine;

window.addEventListener('online', () => {
  isOnline = true;
  processOfflineQueue();
});
window.addEventListener('offline', () => { isOnline = false; });

async function processOfflineQueue() {
  while (offlineQueue.length > 0) {
    const { action, data, resolve, reject } = offlineQueue.shift();
    try {
      const result = await apiPost(action, data);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  }
  if (offlineQueue.length === 0) {
    document.dispatchEvent(new CustomEvent('refreshAll'));
  }
}

function queueablePost(action, data) {
  if (!isOnline) {
    return new Promise((resolve, reject) => {
      offlineQueue.push({ action, data, resolve, reject });
      // Dispatch event so UI can show "queued" toast
      document.dispatchEvent(new CustomEvent('offlineQueued', { detail: { count: offlineQueue.length } }));
    });
  }
  return apiPost(action, data);
}

async function apiGet(action, params = {}) {
  const url = new URL(API_BASE);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API request failed');
  }
  return res.json();
}

async function apiPost(action, data) {
  const res = await fetch(`${API_BASE}?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API request failed');
  }
  return res.json();
}

export function getPartners() {
  return apiGet('getConsignmentPartners');
}

export function getPartnerDetail(id) {
  return apiGet('getConsignmentPartnerDetail', { id });
}

export function savePartner(data) {
  return queueablePost('saveConsignmentPartner', data);
}

export function getStrains() {
  return apiGet('getConsignmentStrains');
}

export function saveIntake(data) {
  return queueablePost('saveConsignmentIntake', data);
}

export function saveBatchIntake(data) {
  return queueablePost('saveConsignmentBatchIntake', data);
}

export function saveSale(data) {
  return queueablePost('saveConsignmentSale', data);
}

export async function saveInventoryCount(data) {
  const res = await fetch(`${API_BASE}?action=saveConsignmentInventoryCount`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to save inventory count');
  return res.json();
}

export function savePayment(data) {
  return queueablePost('saveConsignmentPayment', data);
}

export function getInventory(partnerId) {
  return apiGet('getConsignmentInventory', { partner_id: partnerId });
}

export function getActivity(filters = {}) {
  return apiGet('getConsignmentActivity', filters);
}

export async function getLastPrice(partnerId, strain, type) {
  try {
    const result = await getPartnerDetail(partnerId);
    if (!result?.data?.intakes) return null;
    const match = result.data.intakes.find(
      i => i.strain === strain && i.type === type
    );
    return match?.price_per_lb || null;
  } catch {
    return null;
  }
}

export function deletePartner(id) {
  return queueablePost('deleteConsignmentPartner', { id });
}

export function deleteIntake(id) {
  return queueablePost('deleteConsignmentIntake', { id });
}

export function deleteSale(id) {
  return queueablePost('deleteConsignmentSale', { id });
}

export function deletePayment(id) {
  return queueablePost('deleteConsignmentPayment', { id });
}
