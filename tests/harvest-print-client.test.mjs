/**
 * One copy of the print flow (sack_alloc → label sheet or agent poll, reprint,
 * void), shared by the session screen and the tags-by-bay screen, so a fix to
 * one is a fix to both.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HARVEST_PRINT_CLIENT } from '../workers/src/handlers/harvest-ui.js';

test('shared print client exposes the four calls both screens use', () => {
  for (const fn of ['allocTags', 'printIds', 'reprintTag', 'voidTag']) {
    assert.match(HARVEST_PRINT_CLIENT, new RegExp(`${fn}\\s*[:=]\\s*function|function ${fn}\\(`), fn);
  }
  assert.match(HARVEST_PRINT_CLIENT, /action=sack_alloc/);
  assert.match(HARVEST_PRINT_CLIENT, /action=print_check/);
  assert.match(HARVEST_PRINT_CLIENT, /action=sack_label/);
  assert.match(HARVEST_PRINT_CLIENT, /action=print_reprint/);
  assert.match(HARVEST_PRINT_CLIENT, /action=sack_void/);
});

test('the session screen no longer carries its own sack_alloc fetch', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../workers/src/handlers/harvest-d1.js', import.meta.url), 'utf8');
  const start = src.indexOf('function sackSessionBody');
  const body = src.slice(start, src.indexOf('\nfunction ', start + 10));
  assert.ok(start > 0);
  assert.doesNotMatch(body, /fetch\([^)]*sack_alloc/);
});
