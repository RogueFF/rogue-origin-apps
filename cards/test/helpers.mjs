// Shared test helpers for the layout, render and route tests.
import fs from 'node:fs';
import { weeklyModel, eodModel, middayModel } from '../src/model.js';

/** Parsed JSON fixture from test/fixtures/. */
export const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

// Cost figures the fixtures were captured without (the same numbers the model tests inject).
const W41_COSTS = {
  '2026-10-05': { laborCost: 1730.52, costPerLb: 28.14, topsCostPerLb: 35.33, smallsCostPerLb: 20.59 },
  '2026-10-06': { laborCost: 2307.36, costPerLb: 20.29, topsCostPerLb: 30.99, smallsCostPerLb: 10.72 },
  '2026-10-08': { laborCost: 1179.9, costPerLb: 20.77, topsCostPerLb: 28.43, smallsCostPerLb: 14.08 },
  '2026-10-09': { laborCost: 1546.98, costPerLb: 42.97, topsCostPerLb: 50.2, smallsCostPerLb: 24.18 },
};
const EOD_COSTS = {
  '2026-10-16': { laborCost: 4588.5, costPerLb: 21.84, topsCostPerLb: 27.51, smallsCostPerLb: 14.27 },
  '2026-10-15': { laborCost: 5322.66, costPerLb: 22.51, topsCostPerLb: 30.94, smallsCostPerLb: 12.81 },
};
const withCosts = (dashboard, costs) => ({ ...dashboard, daily: dashboard.daily.map((day) => ({ ...day, ...costs[day.date] })) });

function weeklyArgs() {
  return {
    week: '2026-W42',
    dashboard: fixture('dashboard-2026-W42.unlocked.json'),
    prior: withCosts(fixture('dashboard-2026-W41.locked.json'), W41_COSTS),
    scoreboards: Object.fromEntries(
      ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map((ymd) => [ymd, fixture(`scoreboard-${ymd}.json`)]),
    ),
    sacks: fixture('supersack-2026-W42.json'),
    generatedAt: new Date('2026-10-19T13:05:00Z'),
  };
}

function eodArgs() {
  return {
    date: '2026-10-16',
    dashboard: withCosts(fixture('dashboard-2026-10-16.locked.json'), EOD_COSTS),
    priorDay: withCosts(fixture('dashboard-2026-10-15.locked.json'), EOD_COSTS),
    scoreboard: fixture('scoreboard-2026-10-16.json'),
    sacks: fixture('supersack-2026-10-16.json'),
    sackOut: fixture('sack-out-2026-10-20.json'),
    generatedAt: new Date('2026-10-17T00:05:00Z'),
  };
}

function middayArgs() {
  return {
    date: '2026-10-19',
    scoreboard: fixture('scoreboard-2026-10-19.json'),
    dashboardToday: fixture('dashboard-2026-10-19.locked.json'),
    priorDay: fixture('dashboard-2026-10-16.locked.json'),
    sackOut: fixture('sack-out-2026-10-18.empty.json'),
    generatedAt: new Date('2026-10-19T22:55:00Z'),
  };
}

/** The three card models from the fixtures, built the way the model tests build them (costs unlocked where they can be). */
export function models() {
  return { weekly: weeklyModel(weeklyArgs()), eod: eodModel(eodArgs()), midday: middayModel(middayArgs()) };
}

/** Locked-cost variants: the dashboards as captured, without the password. */
export function lockedModels() {
  return {
    weekly: weeklyModel({ ...weeklyArgs(), dashboard: fixture('dashboard-2026-W42.locked.json'), prior: fixture('dashboard-2026-W41.locked.json') }),
    eod: eodModel({ ...eodArgs(), dashboard: fixture('dashboard-2026-10-16.locked.json'), priorDay: fixture('dashboard-2026-10-15.locked.json') }),
  };
}

const INHERITED = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color', 'letterSpacing', 'lineHeight'];
const childList = (el) => {
  const c = el.props?.children;
  if (c === undefined || c === null) return [];
  return Array.isArray(c) ? c : [c];
};

/**
 * Depth-first walk over the element nodes of a Satori tree. `fn(el, inherited)`
 * gets each element and the text style it inherits (its own style merged over
 * its ancestors' for the inherited properties).
 */
export function walk(tree, fn, inherited = {}) {
  if (!tree || typeof tree !== 'object') return;
  const own = tree.props?.style || {};
  const merged = { ...inherited };
  for (const key of INHERITED) if (own[key] !== undefined) merged[key] = own[key];
  fn(tree, merged);
  for (const child of childList(tree)) walk(child, fn, merged);
}

/** Every element node matching `pred`, in tree order. */
export function findAll(tree, pred) {
  const out = [];
  walk(tree, (el) => { if (pred(el)) out.push(el); });
  return out;
}

/** The string children of an element and its descendants, concatenated. */
export function textOf(el) {
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  return childList(el).map(textOf).join('');
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** `{ width, height }` from a PNG's IHDR; throws when the bytes are not a PNG. */
export function pngSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 24 || PNG_SIGNATURE.some((v, i) => b[i] !== v)) throw new Error('not a PNG (bad signature)');
  if (String.fromCharCode(...b.subarray(12, 16)) !== 'IHDR') throw new Error('not a PNG (no IHDR first)');
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
