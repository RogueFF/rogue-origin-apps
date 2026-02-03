/**
 * Consignment API Module
 * Handles all API calls to /api/consignment
 */

const API_BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/consignment';

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
  return apiPost('saveConsignmentPartner', data);
}

export function getStrains() {
  return apiGet('getConsignmentStrains');
}

export function saveIntake(data) {
  return apiPost('saveConsignmentIntake', data);
}

export function saveSale(data) {
  return apiPost('saveConsignmentSale', data);
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
  return apiPost('saveConsignmentPayment', data);
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
