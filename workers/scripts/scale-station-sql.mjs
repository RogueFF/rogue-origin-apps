// Print the SQL that registers (or re-keys) a cell table scale station.
// Only the SHA-256 hex of the device token goes into D1; the plain token lives
// only in that node's secrets.h. Nothing is written or sent by this script.
//
// Usage (from workers/), PowerShell:
//
//   $env:SCALE_TOKEN = "<the TOKEN from that node's secrets.h>"
//   node scripts/scale-station-sql.mjs table1 "Cell 1"
//
// or pass the token's SHA-256 hex when only the hash was shared (the token never leaves the node):
//
//   node scripts/scale-station-sql.mjs table1 "Cell 1" --hash <64 hex chars>
//
// or let it make a fresh token for a new node (shown once, put it in secrets.h):
//
//   node scripts/scale-station-sql.mjs table2 "Cell 2" --new
//
// Then apply the printed statement after migration 0049, e.g.:
//
//   npx wrangler d1 execute rogue-origin-db --remote --command "<the INSERT>"
//
// Re-running with a new token re-keys the station (the old token stops working).

import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function stationSqlFromHash(stationId, label, hash) {
  if (!/^[a-z0-9_-]{1,32}$/i.test(stationId)) throw new Error(`bad station id: ${stationId}`);
  if (!/^[0-9a-f]{64}$/.test(String(hash))) throw new Error('hash must be 64 lowercase hex characters (SHA-256)');
  const safeLabel = String(label || stationId).replace(/'/g, "''");
  return `INSERT INTO scale_stations (station_id, label, kind, token_hash, stale_after_s, active) ` +
    `VALUES ('${stationId}', '${safeLabel}', 'table', '${hash}', 45, 1) ` +
    `ON CONFLICT(station_id) DO UPDATE SET label = excluded.label, kind = 'table', ` +
    `token_hash = excluded.token_hash, active = 1;`;
}

export function stationSql(stationId, label, token) {
  if (!token || token.length < 16) throw new Error('token must be at least 16 characters');
  return stationSqlFromHash(stationId, label, createHash('sha256').update(token, 'utf8').digest('hex'));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const [stationId, label, flag, flagValue] = process.argv.slice(2);
  if (!stationId) {
    console.error('usage: node scripts/scale-station-sql.mjs <stationId> "<label>" [--new | --hash <sha256 hex>]');
    process.exit(1);
  }
  if (flag === '--hash') {
    console.log(stationSqlFromHash(stationId, label, flagValue));
    process.exit(0);
  }
  let token = process.env.SCALE_TOKEN || '';
  if (flag === '--new') {
    token = randomBytes(24).toString('hex');
    console.error(`New device token for ${stationId} (shown once, put it in secrets.h):\n${token}\n`);
  }
  if (!token) {
    console.error('Set SCALE_TOKEN to the node\'s token, or pass --new.');
    process.exit(1);
  }
  console.log(stationSql(stationId, label, token));
}
