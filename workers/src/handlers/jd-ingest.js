/**
 * JD Operations Center telemetry ingest — 5-min cron handler.
 *
 * Called from src/index.js scheduled() on the `*/5 * * * *` trigger.
 * Polls each machine in JD_ORG_ID for current state, recent location
 * breadcrumbs, and any new DTC alerts. Writes raw rows to D1.
 *
 * No derivation here — that happens in Phase 2 (zone-op detection, idle
 * subcategorization). Phase 1 just gets the raw stream landing reliably.
 *
 * Phase 1, Task 9 of 11.
 * Companion design: docs/plans/2026-05-13-field-ops-tracking-design.md (wiki repo).
 */

import { JDApi } from '../lib/jd-api.js';
import { listMachines, getMachineState, getMachineLocationHistory, listMachineAlerts } from '../lib/jd-endpoints.js';

export async function handleJDIngestCron(event, env, ctx) {
  const api = new JDApi(env);
  const result = await runJDIngest(env, api);
  console.log('[Cron] JD ingest:', JSON.stringify(result));
  return result;
}

export async function runJDIngest(env, api) {
  const db = env.DB;
  const orgId = env.JD_ORG_ID;
  if (!orgId) throw new Error('JD_ORG_ID not set');

  const machines = await listMachines(api, orgId);
  if (machines.length === 0) {
    return { machines: 0, statesWritten: 0, breadcrumbsWritten: 0, alertsWritten: 0 };
  }

  const now = new Date().toISOString();
  // 6-min window so we never miss anything between 5-min cron firings.
  const sixMinAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();

  let statesWritten = 0;
  let breadcrumbsWritten = 0;
  let alertsWritten = 0;
  const errors = [];

  for (const m of machines) {
    // ----- state -----
    try {
      const state = await getMachineState(api, m.id);
      await db.prepare(`
        INSERT INTO jd_machine_states (ts, machine_id, engine_hours, fuel_level_pct, fuel_rate_lph, state, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        now, m.id, state.engine_hours, state.fuel_level_pct, state.fuel_rate_lph, state.state,
        JSON.stringify(state.raw)
      ).run();
      statesWritten++;
    } catch (e) {
      const msg = `state ${m.id}: ${e.message}`;
      console.error('[Cron] JD ingest', msg);
      errors.push(msg);
    }

    // ----- location breadcrumbs -----
    try {
      const points = await getMachineLocationHistory(api, m.id, { since: sixMinAgo });
      for (const p of points) {
        await db.prepare(`
          INSERT INTO jd_position_breadcrumb (ts, machine_id, lat, lon, speed_kmh, heading_deg, raw_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          p.ts, m.id, p.lat, p.lon, p.speed_kmh, p.heading_deg,
          JSON.stringify(p.raw)
        ).run();
        breadcrumbsWritten++;
      }
    } catch (e) {
      const msg = `location ${m.id}: ${e.message}`;
      console.error('[Cron] JD ingest', msg);
      errors.push(msg);
    }

    // ----- alerts (de-duped via UNIQUE(jd_alert_id) + INSERT OR IGNORE) -----
    try {
      const alerts = await listMachineAlerts(api, m.id);
      for (const a of alerts) {
        await db.prepare(`
          INSERT OR IGNORE INTO jd_machine_alerts
            (jd_alert_id, ts, machine_id, spn, fmi, severity, description, raw_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          a.jd_alert_id, a.ts, m.id, a.spn, a.fmi, a.severity, a.description,
          JSON.stringify(a.raw)
        ).run();
        alertsWritten++;
      }
    } catch (e) {
      const msg = `alerts ${m.id}: ${e.message}`;
      console.error('[Cron] JD ingest', msg);
      errors.push(msg);
    }
  }

  return {
    machines: machines.length,
    statesWritten,
    breadcrumbsWritten,
    alertsWritten,
    errors: errors.length ? errors : undefined,
  };
}
