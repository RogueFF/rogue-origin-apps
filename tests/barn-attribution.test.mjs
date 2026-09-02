/**
 * Barn intake attribution — the grace window that keeps an in-transit trailer
 * on the lot it was actually cut from.
 *
 * Zone sessions are a chain of enters: scanning into the next zone closes the
 * one before. A trailer loaded in the old zone is still on the road when that
 * happens, so it arrives after its own lot has closed. Without a grace window
 * that load attributes to nothing, and the lot ledger — which counts bins by
 * joining on the attribution — drops those bins off every lot.
 *
 * Window is field-to-barn transit, ~6 min (Koa, 2026-09-02).
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BARN_GRACE_MS, withinBarnGrace, suggestedIntakeZone,
} from '../workers/src/lib/barn-attribution.js';

const MIN = 60 * 1000;
const NOW = Date.UTC(2026, 9, 12, 15, 0, 0);
const agoMs = (minutes) => NOW - minutes * MIN;

// --- the window ------------------------------------------------------------

test('the window is the ~6 min field-to-barn transit', () => {
  assert.equal(BARN_GRACE_MS, 6 * MIN);
});

test('a lot that closed inside the window still owns an arriving load', () => {
  // The case the whole thing exists for: crew scans into the next zone, the
  // last trailer out of the old one pulls in a few minutes later.
  assert.equal(withinBarnGrace(agoMs(0), NOW), true);
  assert.equal(withinBarnGrace(agoMs(3), NOW), true);
  assert.equal(withinBarnGrace(agoMs(5.9), NOW), true);
});

test('the boundary is inclusive, and one tick past it is not', () => {
  assert.equal(withinBarnGrace(NOW - BARN_GRACE_MS, NOW), true);
  assert.equal(withinBarnGrace(NOW - BARN_GRACE_MS - 1, NOW), false);
});

test('a lot that closed long ago does not collect stray loads', () => {
  // Yesterday's lot must never absorb a load logged against its zone today —
  // that would silently inflate a closed lot's bins.
  assert.equal(withinBarnGrace(agoMs(30), NOW), false);
  assert.equal(withinBarnGrace(agoMs(60 * 24), NOW), false);
});

test('a close in the future is rejected rather than read as zero elapsed', () => {
  // Clock skew. Accepting it would attribute loads to a lot that has not closed.
  assert.equal(withinBarnGrace(NOW + 1, NOW), false);
  assert.equal(withinBarnGrace(NOW + 10 * MIN, NOW), false);
});

test('a missing or unparseable close time is not inside the window', () => {
  for (const bad of [null, undefined, NaN, 'ten minutes ago']) {
    assert.equal(withinBarnGrace(bad, NOW), false, `expected false for ${String(bad)}`);
  }
});

// --- what the intake form should pre-select --------------------------------

test('just after a zone change, the form defaults to the zone before', () => {
  assert.equal(suggestedIntakeZone({
    activeZone: 'Z5',
    lastClosedZone: 'Z4',
    lastClosedAtMs: agoMs(2),
    nowMs: NOW,
  }), 'Z4');
});

test('once the window passes, the form goes back to the active zone', () => {
  assert.equal(suggestedIntakeZone({
    activeZone: 'Z5',
    lastClosedZone: 'Z4',
    lastClosedAtMs: agoMs(9),
    nowMs: NOW,
  }), null);
});

test('a crew re-entering the SAME zone suggests nothing', () => {
  // A within-shift cut resume closes and reopens the same zone. Suggesting Z4
  // while Z4 is the active zone is noise dressed up as a correction.
  assert.equal(suggestedIntakeZone({
    activeZone: 'Z4',
    lastClosedZone: 'Z4',
    lastClosedAtMs: agoMs(1),
    nowMs: NOW,
  }), null);
});

test('end of day — no open zone — still suggests the zone just closed', () => {
  // The last trailers of the day arrive after the crew has scanned out entirely.
  assert.equal(suggestedIntakeZone({
    activeZone: null,
    lastClosedZone: 'Z7',
    lastClosedAtMs: agoMs(4),
    nowMs: NOW,
  }), 'Z7');
});

test('nothing closed yet — first zone of the season — suggests nothing', () => {
  assert.equal(suggestedIntakeZone({
    activeZone: 'Z1',
    lastClosedZone: null,
    lastClosedAtMs: null,
    nowMs: NOW,
  }), null);
});

test('called with no arguments at all, it declines rather than throwing', () => {
  assert.equal(suggestedIntakeZone(), null);
});

// --- the asymmetry the window depends on -----------------------------------

test('a wider window can be set without touching the callers', () => {
  // The error is one-sided: a genuine load for the NEW zone cannot arrive this
  // fast (cut and fill 18-22 bins, then drive), so widening costs almost
  // nothing in false positives. Kept overridable so a real per-zone transit
  // table can tune it later without a rewrite.
  assert.equal(withinBarnGrace(agoMs(9), NOW, 12 * MIN), true);
  assert.equal(suggestedIntakeZone({
    activeZone: 'Z5', lastClosedZone: 'Z4', lastClosedAtMs: agoMs(9),
    nowMs: NOW, graceMs: 12 * MIN,
  }), 'Z4');
});
