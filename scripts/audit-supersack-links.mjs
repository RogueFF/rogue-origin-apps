#!/usr/bin/env node
/**
 * Read-only audit: can every 2026 cultivar print a supersack tag that moves a
 * Shopify Super Sack Inventory count?
 *
 *   node scripts/audit-supersack-links.mjs [--json]
 *
 * Universe = cultivars on any real 2026 harvest lot + every cultivar planted in
 * a tracked zone (zone-cultivars.js) + the 2026 lot board (harvest_lots, every
 * farm). For each:
 *   - code:  a `cultivars` row with a sku_prefix (PRINT TAG refuses without one)
 *   - 1st:   the 1st Cut variant resolves (exact title or recorded alias)
 *   - 2nd:   the 2nd Cut variant resolves (informational: most have one cut)
 *
 * Variants come from the live /api/pool proxy, the same list the worker uses.
 * That list is capped at 100 by the Apps Script; when it is full, a miss that
 * sorts after the last title is reported as BEYOND CAP, not as missing.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZONE_CULTIVARS, isHarvestTracked } from '../workers/src/lib/zone-cultivars.js';
import { matchSupersackVariant } from '../workers/src/lib/supersack-inventory.js';

const SEASON = 2026;
const WORKERS = join(dirname(fileURLToPath(import.meta.url)), '..', 'workers');
const POOL = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/pool?action=get_supersack_variants';

function d1(sql) {
  // shell: true for npx on Windows, so the SQL goes through as one quoted argument.
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'rogue-origin-db', '--remote', '--json', '--command',
    JSON.stringify(sql.replace(/\s+/g, ' '))],
    { cwd: WORKERS, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out)[0].results;
}

const cultivars = d1('SELECT id, name, sku_prefix FROM cultivars');
const aliases = d1('SELECT a.alias, c.name FROM cultivar_aliases a JOIN cultivars c ON c.id = a.cultivar_id');
const lots = d1(`SELECT cultivar, zone, MAX(cut_number) AS max_cut, COUNT(*) AS sessions FROM harvest_scan_log
                 WHERE event_type = 'enter' AND is_test = 0 AND season = ${SEASON} AND cultivar IS NOT NULL
                 GROUP BY cultivar, zone`);
const board = d1('SELECT DISTINCT cultivar, farm FROM harvest_lots');
const tagMiss = d1(`SELECT cultivar, COUNT(*) AS n FROM harvest_sacks
                    WHERE is_test = 0 AND season = ${SEASON} AND voided_at IS NULL AND shopify_added_at IS NULL
                    GROUP BY cultivar`);

const res = await fetch(POOL).then(r => r.json());
const variants = (res.data || res).variants || [];
const capped = variants.length === 100;
const lastTitle = variants.length ? String(variants[variants.length - 1].title) : '';

// Alias lookup that matches what the worker's D1 query returns.
const db = {
  prepare() {
    return { bind(name) { return { all: async () => ({
      results: aliases.filter(a => a.name.toLowerCase() === String(name).toLowerCase()).map(a => ({ alias: a.alias })),
    }) }; } };
  },
};

const universe = new Map(); // name -> { sources:Set, zones:Set, cut:bool }
const add = (name, source, zone = null) => {
  const n = String(name || '').trim();
  if (!n) return;
  if (!universe.has(n)) universe.set(n, { sources: new Set(), zones: new Set(), maxCut: 0 });
  const u = universe.get(n);
  u.sources.add(source);
  if (zone) u.zones.add(zone);
};
for (const l of lots) { add(l.cultivar, 'cut', l.zone); universe.get(l.cultivar.trim()).maxCut = Math.max(universe.get(l.cultivar.trim()).maxCut, l.max_cut || 0); }
for (const [zone, list] of Object.entries(ZONE_CULTIVARS)) {
  if (!isHarvestTracked(zone)) continue;
  for (const c of list) add(c, 'planted', zone);
}
for (const r of board) add(r.cultivar, 'board', r.farm);

const rows = [];
for (const [name, u] of [...universe].sort((a, b) => a[0].localeCompare(b[0]))) {
  const code = cultivars.find(c => c.name.toLowerCase() === name.toLowerCase())?.sku_prefix || null;
  const zone = [...u.zones].find(z => /^(Z|R|GH)\d/i.test(z)) || 'Z1';
  const status = async (cut) => {
    const m = await matchSupersackVariant(variants, db, { season: SEASON, cultivar: name, zone, cut });
    if (m.variant) return m.matchedBy === 'alias' ? `ok (alias: ${m.variant.title})` : 'ok';
    if (capped && m.title.toLowerCase() > lastTitle.toLowerCase()) return 'BEYOND CAP';
    return 'MISSING';
  };
  rows.push({
    cultivar: name, sources: [...u.sources].join('+'), zones: [...u.zones].join(' '),
    code: code || 'NO CODE', first: await status(1), second: await status(2),
    unlinkedTags: tagMiss.find(t => t.cultivar === name)?.n || 0,
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ variants: variants.length, capped, lastTitle, rows }, null, 2));
} else {
  console.log(`variants returned: ${variants.length}${capped ? ` (CAPPED — last: "${lastTitle}")` : ''}`);
  for (const r of rows) {
    const bad = r.code === 'NO CODE' || r.first !== 'ok' && !r.first.startsWith('ok') || r.unlinkedTags;
    console.log(`${bad ? '✗' : '✓'} ${r.cultivar.padEnd(26)} code=${String(r.code).padEnd(9)} 1st=${r.first.padEnd(12)} 2nd=${r.second.padEnd(12)} tagsNotInShopify=${r.unlinkedTags}  [${r.sources}: ${r.zones}]`);
  }
}
