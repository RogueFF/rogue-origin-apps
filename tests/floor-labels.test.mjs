/**
 * Tests for src/js/floor/labels.js — the EN/ES label dictionary and its
 * registration on the shared i18n layer.
 *
 * labels.js only imports shared/i18n.js in a browser (`typeof window !==
 * 'undefined'`) and falls back to an equivalent local implementation of
 * t()/setLang()/getLang()/toggleLang() under Node — see the comment at the
 * bottom of that file for why: src/js/shared/ carries no `{"type":"module"}`
 * package.json, so Node resolves i18n.js's format from the repo root's
 * `"type": "commonjs"` and cannot load it at all (not via a named import, a
 * default import, or a dynamic one). That means this file needs no loader
 * tricks of its own; a plain static import is enough.
 *
 * Run with `node --test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LABELS, t, setLang, getLang } from '../src/js/floor/labels.js';

// Keys the legacy hourly-entry page carried that v3 has no use for — the
// printer/scanner/tutorial/step-guide surface, plus the handful of section
// headers ("Crew", "Production") the new field-level layout replaced. A
// leftover here would mean a stale label nothing renders, or worse, a
// label silently shadowing one of the new same-purpose keys.
const DROPPED_KEYS = [
  'title', 'print5kg', 'print10lbTops', 'print10lbSmalls', 'printer', 'scanner',
  'barcodePrinter', 'poolSmalls', 'addToPool', 'scanToInventory', 'lastScanned',
  'stepCrewTitle', 'stepCrewHint', 'stepProductionTitle', 'stepProductionHint',
  'stepCompleteTitle', 'stepCompleteHint', 'stepCelebrateTitle', 'stepCelebrateHint',
  'stepMissedTitle', 'stepMissedHint', 'dayView', 'copyPrev', 'copied', 'noPrevData',
  'hourlyEntry', 'elapsed', 'status', 'onTrack', 'behind', 'waiting', 'liveScale',
  'scaleOf', 'bagComplete', 'bag10lbComplete', 'tipTimeline', 'tipCrew', 'tipProduction',
  'skip', 'back', 'strain', 'selectStrain', 'startTimeSet', 'avgToday', 'vsTarget',
  'bagsToday', 'remaining', 'crew', 'production', 'hourlyTarget', 'qcNotes', 'prev',
  'next', 'tapToRetry',
];

// New keys the spec adds for the rebuild — must exist in both languages.
const ADDED_KEYS = [
  'now', 'prevHour', 'nextHour', 'lbTops', 'targetWord', 'trimmersShort', 'why',
  'notes', 'retry', 'notSaved', 'enterSaves', 'unsavedHours', 'pace', 'behindPace',
  'aheadPace', 'onPace', 'projected', 'left', 'overtime', 'elapsedWord', 'shiftEnded',
  'notStarted', 'logBag', 'logging', 'logged', 'logFailed', 'bagsTodayWord', 'averaging',
  'scale', 'scaleOffline', 'scaleWindow', 'scaleOfflineNote', 'drawerTitle', 'open',
  'close', 'selectCultivar', 'addLine2', 'removeLine2', 'changeDate', 'theme',
  'language', 'noData', 'noCultivar', 'hours', 'refresh', 'grams', 'lbs',
  'errorLoading', 'fewer', 'more', 'of',
];

test('every key in en exists in es and vice versa', () => {
  const enKeys = Object.keys(LABELS.en).sort();
  const esKeys = Object.keys(LABELS.es).sort();
  assert.deepEqual(enKeys, esKeys);
});

test('no value is empty except line1', () => {
  for (const lang of ['en', 'es']) {
    for (const [key, value] of Object.entries(LABELS[lang])) {
      if (key === 'line1') continue;
      assert.notEqual(value, '', `${lang}.${key} is empty`);
    }
  }
});

test('dropped legacy keys are gone', () => {
  for (const key of DROPPED_KEYS) {
    assert.equal(LABELS.en[key], undefined, `en.${key} should have been dropped`);
    assert.equal(LABELS.es[key], undefined, `es.${key} should have been dropped`);
  }
});

test('added keys are present in both languages', () => {
  for (const key of ADDED_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(LABELS.en, key), `en.${key} is missing`);
    assert.ok(Object.prototype.hasOwnProperty.call(LABELS.es, key), `es.${key} is missing`);
  }
});

test('the five values v3 wording replaces are pinned exactly', () => {
  assert.equal(LABELS.en.tops, 'Tops');
  assert.equal(LABELS.es.tops, 'Tops');
  assert.equal(LABELS.en.smalls, 'Smalls');
  assert.equal(LABELS.es.smalls, 'Smalls');
  assert.equal(LABELS.en.started, 'started');
  assert.equal(LABELS.es.started, 'inició');
  assert.equal(LABELS.en.saving, 'Saving…');
  assert.equal(LABELS.es.saving, 'Guardando…');
  assert.equal(LABELS.en.line2, 'Line 2');
  assert.equal(LABELS.es.line2, 'Línea 2'); // accent fixed vs legacy's unaccented "Linea 2"
});

test('t() falls back to en for a language with no dictionary of its own', () => {
  setLang('fr'); // both the shared layer and the Node fallback coerce anything but 'es' to 'en'
  assert.equal(getLang(), 'en');
  assert.equal(t('now'), 'now');
});

test('t() falls back to the key itself when the key exists in neither language', () => {
  assert.equal(t('no_such_key_anywhere'), 'no_such_key_anywhere');
});

test("setLang('es') flips t('now')", () => {
  setLang('es');
  assert.equal(t('now'), 'ahora');
  setLang('en');
  assert.equal(t('now'), 'now');
});
