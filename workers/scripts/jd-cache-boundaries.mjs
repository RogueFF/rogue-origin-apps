// One-shot: fetch all field boundaries for JD_ORG_ID and emit a SQL upsert
// file ready to apply to D1.
//
// Usage (from workers/):
//
//   $env:JD_CLIENT_ID = "..."
//   $env:JD_CLIENT_SECRET = "..."
//   $env:JD_REFRESH_TOKEN = "..."
//   $env:JD_ORG_ID = "..."
//   node scripts/jd-cache-boundaries.mjs
//
// Writes to: workers/scripts/_generated/boundaries-<timestamp>.sql
// Then apply with whatever your wrangler-config workflow is, e.g.:
//
//   npx wrangler d1 execute rogue-origin-db --remote --file scripts/_generated/boundaries-<timestamp>.sql
//
// Re-run when zones are redrawn in Ops Center.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JDApi } from '../src/lib/jd-api.js';
import { listBoundaries } from '../src/lib/jd-endpoints.js';

const env = {
  JD_ENV: process.env.JD_ENV || 'sandbox',
  JD_CLIENT_ID: process.env.JD_CLIENT_ID,
  JD_CLIENT_SECRET: process.env.JD_CLIENT_SECRET,
  JD_REFRESH_TOKEN: process.env.JD_REFRESH_TOKEN,
};
const orgId = process.env.JD_ORG_ID;
if (!orgId) {
  console.error('Set JD_ORG_ID env var. (Run jd-list-orgs.mjs first to find it.)');
  process.exit(1);
}

const api = new JDApi(env);
const boundaries = await listBoundaries(api, orgId);

console.log(`Fetched ${boundaries.length} boundaries from JD (${env.JD_ENV}).`);

if (boundaries.length === 0) {
  console.log('Nothing to cache — exiting without writing output.');
  process.exit(0);
}

const sqlEscape = (s) => String(s).replace(/'/g, "''");
const now = new Date().toISOString();

const lines = [
  `-- Generated ${now} by scripts/jd-cache-boundaries.mjs`,
  `-- Source: JD ${env.JD_ENV} org ${orgId}`,
  `-- ${boundaries.length} boundaries`,
  ``,
];

for (const b of boundaries) {
  const zoneId = b.name; // assumes JD boundary name == wiki zone naming. If they diverge, build a name->zone_id mapping table.
  lines.push(
    `INSERT INTO field_boundaries_cache (zone_id, jd_field_id, jd_org_id, geojson_polygon, acres, refreshed_at) VALUES (`,
    `  '${sqlEscape(zoneId)}',`,
    `  '${sqlEscape(b.jd_field_id)}',`,
    `  '${sqlEscape(orgId)}',`,
    `  '${sqlEscape(b.geojson)}',`,
    `  ${b.acres ?? 'NULL'},`,
    `  '${sqlEscape(now)}'`,
    `) ON CONFLICT(zone_id) DO UPDATE SET`,
    `  jd_field_id = excluded.jd_field_id,`,
    `  jd_org_id = excluded.jd_org_id,`,
    `  geojson_polygon = excluded.geojson_polygon,`,
    `  acres = excluded.acres,`,
    `  refreshed_at = excluded.refreshed_at;`,
    ``,
  );
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '_generated');
mkdirSync(outDir, { recursive: true });
const ts = now.replace(/[:.]/g, '-');
const outPath = join(outDir, `boundaries-${ts}.sql`);

writeFileSync(outPath, lines.join('\n'), 'utf8');

console.log(`\nWrote ${boundaries.length} upsert(s) to:\n  ${outPath}\n`);
console.log('To apply to D1, run from workers/ with your usual wrangler-config flow:');
console.log(`  npx wrangler d1 execute rogue-origin-db --remote --file ${outPath.replace(/\\/g, '/')}\n`);
console.log('Then verify:');
console.log('  npx wrangler d1 execute rogue-origin-db --remote --command "SELECT zone_id, acres FROM field_boundaries_cache ORDER BY zone_id;"\n');
