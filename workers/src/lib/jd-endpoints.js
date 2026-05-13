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
