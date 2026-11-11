// The practice database's schema file must match its sources (root test: CI runs it).
// Re-run `node workers/scripts/build-demo-schema.mjs` after adding a cell/order migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDemoSchema } from '../workers/scripts/build-demo-schema.mjs';

test('workers/migrations-demo/demo-schema.sql is current with its sources', () => {
  const file = readFileSync(new URL('../workers/migrations-demo/demo-schema.sql', import.meta.url), 'utf8');
  assert.equal(file, buildDemoSchema(), 'stale: run node workers/scripts/build-demo-schema.mjs');
});

test('the practice schema carries the marker the Worker checks, and never the live seed', () => {
  const s = buildDemoSchema();
  assert.match(s, /INSERT OR IGNORE INTO demo_state \(key, value\) VALUES \('database', 'rogue-origin-demo'\);/);
  assert.match(s, /NEVER run this on the live database/);
});
