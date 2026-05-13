/**
 * Thin functional wrappers around the JD Operations Center REST API.
 * Each function takes a JDApi instance + parameters, returns shape-normalized data.
 *
 * Phase 1, Tasks 5-7 of the Field Ops Tracking system.
 */

/**
 * GET /organizations — list orgs this OAuth grant has access to.
 * Use jd-list-orgs.mjs to discover the org ID, then stash as JD_ORG_ID secret.
 */
export async function listOrganizations(api) {
  const data = await api.get('/organizations');
  return (data.values || []).map(o => ({
    id: o.id,
    name: o.name,
    type: o.type,
    raw: o,
  }));
}

/**
 * GET /organizations/{orgId}/machines — list machines in an org.
 */
export async function listMachines(api, orgId) {
  const data = await api.get(`/organizations/${orgId}/machines`);
  return (data.values || []).map(m => ({
    id: m.id,
    name: m.name,
    vin: m.vin,
    category: m.category,
    model: m.model,
    raw: m,
  }));
}

// JD returns state in UPPER_SNAKE; normalize to lowercase tokens we use throughout.
const STATE_MAP = { WORKING: 'working', IDLE: 'idle', TRANSPORT: 'transport', OFF: 'off' };

/**
 * GET /machines/{machineId}/engineState — current engine state snapshot.
 * Returns normalized {engine_hours, fuel_level_pct, fuel_rate_lph, state, raw}.
 *
 * Note: JD field names may differ slightly in sandbox vs production. If the
 * raw response doesn't carry expected keys, inspect `raw` and update mapping.
 */
export async function getMachineState(api, machineId) {
  const d = await api.get(`/machines/${machineId}/engineState`);
  return {
    engine_hours: d.engineHours ?? null,
    fuel_level_pct: d.fuelLevel ?? null,
    fuel_rate_lph: d.fuelRate ?? null,
    state: STATE_MAP[d.state] || 'unknown',
    raw: d,
  };
}

/**
 * GET /machines/{machineId}/locationHistory?startDate=...
 * Returns array of breadcrumbs in normalized shape.
 *
 * @param {string} machineId
 * @param {Object} opts
 * @param {string} [opts.since]  ISO8601 timestamp lower bound; defaults to last 6 min
 */
export async function getMachineLocationHistory(api, machineId, { since } = {}) {
  const params = {};
  if (since) params.startDate = since;
  const d = await api.get(`/machines/${machineId}/locationHistory`, params);
  return (d.values || []).map(p => ({
    ts: p.eventTime,
    lat: p.latitude,
    lon: p.longitude,
    speed_kmh: p.speed ?? null,
    heading_deg: p.heading ?? null,
    raw: p,
  }));
}

/**
 * GET /machines/{machineId}/alerts — DTC fault codes for a machine.
 */
export async function listMachineAlerts(api, machineId) {
  const d = await api.get(`/machines/${machineId}/alerts`);
  return (d.values || []).map(a => ({
    jd_alert_id: a.id,
    ts: a.alertTime,
    spn: a.spn ?? null,
    fmi: a.fmi ?? null,
    severity: (a.severity || '').toLowerCase() || null,
    description: a.description || null,
    raw: a,
  }));
}
