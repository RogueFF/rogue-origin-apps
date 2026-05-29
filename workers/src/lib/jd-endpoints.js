/**
 * Thin functional wrappers around the JD Operations Center REST API.
 * Each function takes a JDApi instance + parameters, returns shape-normalized data.
 *
 * HATEOAS: every resource is reached by following a HAL `links[].uri` from the
 * one above it (catalog -> organizations -> machines -> per-machine telemetry),
 * never by constructing a path. JD's production certification inspects live
 * traffic for exactly this navigation pattern.
 *
 * UNVERIFIED FIELD MAPPINGS: the response field names below are derived from
 * JD's published OpenAPI specs + community SDKs, NOT yet confirmed against live
 * responses — every data endpoint 403s until JD connects this app to an org.
 * Each mapping therefore falls back across candidate keys and always preserves
 * `raw`, so the first real responses can be diffed and the mappings locked down.
 *
 * Pagination (`nextPage` links) is deferred to the certification-hardening pass;
 * at single-org / handful-of-machines scale the first page is the whole result.
 *
 * Phase 1, Tasks 5-7 of the Field Ops Tracking system.
 */

import { findLink } from './jd-api.js';

// JD returns state in UPPER_SNAKE; normalize to lowercase tokens we use throughout.
const STATE_MAP = { WORKING: 'working', IDLE: 'idle', TRANSPORT: 'transport', OFF: 'off' };

/**
 * Catalog rel `organizations` -> orgs this OAuth grant can see.
 * Each org keeps its `links` so callers can follow per-org rels (machines,
 * boundaries, ...). Use jd-list-orgs.mjs to discover the org ID for JD_ORG_ID.
 */
export async function listOrganizations(api) {
  const catalog = await api.getCatalog();
  const url = findLink(catalog, 'organizations');
  if (!url) throw new Error('JD API catalog has no `organizations` link');
  const data = await api.get(url);
  return (data.values || []).map((o) => ({
    id: o.id,
    name: o.name,
    type: o.type,
    links: o.links || [],
    raw: o,
  }));
}

/**
 * Resolve a single org (with its HAL links) by id. HATEOAS-friendly: we find it
 * in the organizations collection rather than hand-building `/organizations/{id}`.
 */
export async function getOrganization(api, orgId) {
  const orgs = await listOrganizations(api);
  const org = orgs.find((o) => String(o.id) === String(orgId));
  if (!org) {
    const seen = orgs.map((o) => o.id).join(', ') || 'none';
    throw new Error(`JD org ${orgId} not visible to this grant (saw: ${seen})`);
  }
  return org;
}

/**
 * Follow an org's `machines` link -> machines in that org.
 * Legacy /platform advertises the rel as `machines`; the modern Equipment API
 * uses `equipment` — follow whichever this org exposes.
 * Each machine keeps `id`, `principalId` (the telemetry key), and its `links`.
 *
 * @param {Object} org  an org object from listOrganizations/getOrganization (carries `links`)
 */
export async function listMachines(api, org) {
  const url = findLink(org, 'machines') || findLink(org, 'equipment');
  if (!url) throw new Error(`JD org ${org?.id} has no \`machines\`/\`equipment\` link`);
  const data = await api.get(url);
  return (data.values || []).map((m) => ({
    id: m.id,
    principalId: m.principalId ?? m.id,
    name: m.name ?? m.equipmentName ?? null,
    vin: m.vin ?? m.serialNumber ?? null,
    category: m.category ?? m.equipmentType ?? null,
    model: m.model ?? m.modelName ?? null,
    links: m.links || [],
    raw: m,
  }));
}

/**
 * Last-known engine hours for a machine. Follows the machine's `engineHours`
 * link (?lastKnown=true). The value comes back under `reading` — the original
 * code looked for `engineHours`, which doesn't exist on this resource.
 * (If machines don't expose this rel, the catalog-level `lastKnownEngineHours`
 * rel is the fallback to wire up once we can see real responses.)
 * Returns { value: number|null, raw }.
 */
async function getEngineHours(api, machine) {
  const url = findLink(machine, 'engineHours');
  if (!url) return { value: null, raw: null };
  const d = await api.get(url, { lastKnown: true });
  const latest = Array.isArray(d.values) ? d.values[d.values.length - 1] : d;
  const value = latest?.reading ?? latest?.value ?? latest?.engineHours ?? null;
  return { value: value != null ? Number(value) : null, raw: d };
}

/**
 * Latest device state report (live operational state + fuel) for a machine.
 * Follows the machine's `deviceStateReports` link. There is no `engineState`
 * endpoint on /platform — that was the bug in the original code.
 * Returns { state, fuel_level_pct, fuel_rate_lph, raw }.
 */
async function getDeviceState(api, machine) {
  const url = findLink(machine, 'deviceStateReports');
  if (!url) return { state: 'unknown', fuel_level_pct: null, fuel_rate_lph: null, raw: null };
  const d = await api.get(url);
  const reports = d.values || (Array.isArray(d) ? d : [d]);
  const latest = reports[reports.length - 1] || {};
  const rawState = latest.state ?? latest.machineState ?? latest.deviceState;
  return {
    state: STATE_MAP[rawState] || 'unknown',
    fuel_level_pct: latest.fuelLevel ?? latest.remainingFuelPercent ?? latest.fuelLevelPercent ?? null,
    fuel_rate_lph: latest.fuelRate ?? latest.fuelConsumptionRate ?? null,
    raw: d,
  };
}

/**
 * Current engine/operational snapshot for a machine, assembled from two HAL
 * resources (engineHours + deviceStateReports). Returns the same normalized
 * shape the ingest cron + jd_machine_states table already expect.
 *
 * @param {Object} machine  a machine object from listMachines (carries `links`)
 */
export async function getMachineState(api, machine) {
  const [hours, device] = await Promise.all([
    getEngineHours(api, machine),
    getDeviceState(api, machine),
  ]);
  return {
    engine_hours: hours.value,
    fuel_level_pct: device.fuel_level_pct,
    fuel_rate_lph: device.fuel_rate_lph,
    state: device.state,
    raw: { engineHours: hours.raw, deviceState: device.raw },
  };
}

/**
 * Location breadcrumbs for a machine since a timestamp. Follows the machine's
 * `locationHistory` link with a startDate param. Field fixes vs original:
 * timestamp is `eventTimestamp` (not `eventTime`) and lat/lon are nested under
 * a `point` object.
 *
 * @param {Object} machine  a machine object from listMachines
 * @param {Object} opts
 * @param {string} [opts.since]  ISO8601 lower bound
 */
export async function getMachineLocationHistory(api, machine, { since } = {}) {
  const url = findLink(machine, 'locationHistory');
  if (!url) return [];
  const params = {};
  if (since) params.startDate = since;
  const d = await api.get(url, params);
  return (d.values || []).map((p) => ({
    ts: p.eventTimestamp ?? p.eventTime ?? p.timestamp ?? null,
    lat: p.point?.lat ?? p.latitude ?? p.lat ?? null,
    lon: p.point?.lon ?? p.longitude ?? p.lon ?? null,
    speed_kmh: p.speed ?? p.groundSpeed ?? null,
    heading_deg: p.heading ?? p.bearing ?? null,
    raw: p,
  }));
}

/**
 * DTC fault-code alerts for a machine. Follows the machine's `alerts` link.
 * `description` may arrive as `definition` on this resource.
 *
 * @param {Object} machine  a machine object from listMachines
 */
export async function listMachineAlerts(api, machine) {
  const url = findLink(machine, 'alerts');
  if (!url) return [];
  const d = await api.get(url);
  return (d.values || []).map((a) => ({
    jd_alert_id: a.id,
    ts: a.alertTime ?? a.eventTimestamp ?? a.time ?? null,
    spn: a.spn ?? null,
    fmi: a.fmi ?? null,
    severity: (a.severity || '').toLowerCase() || null,
    description: a.description ?? a.definition ?? null,
    raw: a,
  }));
}

/**
 * Field/zone boundary polygons for an org. Follows the org's `boundaries` link.
 * Flattens JD's nested multipolygons.rings.points into a single GeoJSON Polygon
 * (first ring of first multipolygon) — sufficient for point-in-polygon zone
 * detection in v1. Multi-ring / holed fields are a Phase 2 refinement.
 *
 * @param {Object} org  an org object from listOrganizations/getOrganization
 */
export async function listBoundaries(api, org) {
  const url = findLink(org, 'boundaries');
  if (!url) throw new Error(`JD org ${org?.id} has no \`boundaries\` link`);
  const d = await api.get(url);
  return (d.values || []).map((b) => {
    const firstRing = b.multipolygons?.[0]?.rings?.[0]?.points || [];
    // GeoJSON convention is [longitude, latitude] pairs.
    const coords = firstRing.map((p) => [p.lon, p.lat]);
    const geojson = JSON.stringify({ type: 'Polygon', coordinates: [coords] });

    return {
      jd_field_id: b.id,
      name: b.name,
      acres: b.area?.measurement ?? null,
      geojson,
      raw: b,
    };
  });
}
