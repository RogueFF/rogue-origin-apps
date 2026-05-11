/**
 * Supersack data-quality check — runs anomaly SQL against supersack_entries
 * and returns a markdown report when problems exist, or null when clean.
 *
 * Used by:
 *   - Monday morning cron in src/index.js (sends to Telegram if non-null)
 *   - Manual endpoint GET /api/supersack-qa (returns the body for inspection,
 *     does not send Telegram)
 *
 * Checks (all scoped to the last 7 days, the rolling window operators can
 * realistically still correct):
 *   1. Rows with biomass=0 OR trim=0 — silent drop by the analytics filter
 *      (bio>0 AND trim>0). Operator entered sacks but missed a weight.
 *   2. Rows with outputs > 1.3× raw — over-attributed multi-strain rows.
 *      Excluded from analytics; operator should re-enter per-strain.
 *
 * Returns:
 *   { hasAnomalies: false }                          — silent path
 *   { hasAnomalies: true, markdown: '...', counts }  — alert path
 */

import { successResponse } from '../lib/response.js';

export async function handleSupersackQA(request, env, ctx) {
  const report = await runSupersackQACheck(env);
  return successResponse(report);
}

export async function runSupersackQACheck(env) {
  const db = env.DB;

  const missingWeights = await db.prepare(`
    SELECT date, strain, sacks_opened, biomass_lbs, trim_lbs
    FROM supersack_entries
    WHERE date >= date('now', '-7 days')
      AND (biomass_lbs = 0 OR trim_lbs = 0)
    ORDER BY date DESC, strain
  `).all().then(r => r.results || []);

  const overAttributed = await db.prepare(`
    SELECT date, strain, sacks_opened,
           ROUND(raw_lbs, 0) as raw,
           ROUND((tops_lbs + smalls_lbs + biomass_lbs + trim_lbs) / raw_lbs, 2) as ratio
    FROM supersack_entries
    WHERE date >= date('now', '-7 days')
      AND biomass_lbs > 0 AND trim_lbs > 0
      AND (tops_lbs + smalls_lbs + biomass_lbs + trim_lbs) > raw_lbs * 1.3
    ORDER BY ratio DESC
  `).all().then(r => r.results || []);

  if (missingWeights.length === 0 && overAttributed.length === 0) {
    return { hasAnomalies: false };
  }

  const lines = ['*Supersack data check — anomalies in last 7 days*', ''];

  if (missingWeights.length > 0) {
    lines.push(`*${missingWeights.length} row${missingWeights.length === 1 ? '' : 's'} missing biomass or trim* (silently excluded from analytics)`);
    for (const r of missingWeights) {
      const strain = shortStrain(r.strain);
      const missing = [];
      if (!r.biomass_lbs) missing.push('biomass');
      if (!r.trim_lbs) missing.push('trim');
      lines.push(`• ${r.date} ${strain} — ${r.sacks_opened} sacks, missing ${missing.join(' + ')}`);
    }
    lines.push('');
  }

  if (overAttributed.length > 0) {
    lines.push(`*${overAttributed.length} row${overAttributed.length === 1 ? '' : 's'} over-attributed* (>1.3× raw — excluded from analytics)`);
    for (const r of overAttributed) {
      const strain = shortStrain(r.strain);
      lines.push(`• ${r.date} ${strain} — ${r.sacks_opened} sacks, outputs ${r.ratio}× raw`);
    }
    lines.push('');
  }

  lines.push('Re-enter on the tracker (per-strain bio/trim now supported): https://rogueff.github.io/rogue-origin-apps/src/pages/supersack-entry.html');

  return {
    hasAnomalies: true,
    markdown: lines.join('\n'),
    counts: {
      missingWeights: missingWeights.length,
      overAttributed: overAttributed.length,
    },
  };
}

function shortStrain(name) {
  return (name || '').replace(/^\d{4} - /, '').replace(/ \/ Sungrown$/, '');
}
