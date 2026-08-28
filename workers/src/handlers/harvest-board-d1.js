/**
 * Harvest Lot Board — /api/harvest?action=board*
 *
 * The 2026 stage board for every ODA pre-harvest lot: 82 cards moving through
 * untested -> scheduled -> cleared -> harvesting -> drying -> supersacked, plus
 * a failed/destroyed lane.
 *
 * Why it lives here rather than in a Claude Artifact (where it started): the
 * Artifact's only write primitive was "replace the whole document", so a second
 * writer — Timber — would drop an edit every time the two overlapped. D1 gives
 * the web page and the bot one source of truth. `updated_by` records which side
 * moved a card, which is what you want the first time the board and the scan
 * data disagree.
 *
 * The board is a stage overlay, NOT the yield record. Weights, bins and sack
 * tags stay in harvest_scan_log / harvest_sacks. If the two disagree, the scans
 * win — see rogue-farm-wiki/wiki/operations/harvest-lot-board.md.
 *
 * Auth: the board carries per-lot Total THC results, so every data action needs
 * the farm password (Authorization: Bearer <password>). The page shell itself is
 * public but ships no lot data.
 */

import { query, queryOne } from '../lib/db.js';
import { successResponse } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { BOARD_PAGE } from './harvest-board-page.js';

export const BOARD_ACTIONS = new Set(['board', 'board_set', 'board_page']);

const STAGES = new Set([
  'untested', 'scheduled', 'cleared', 'harvesting', 'drying', 'supersacked', 'failed',
]);

// Column order on the board, so the page never has to sort.
const STAGE_ORDER = [
  'untested', 'scheduled', 'cleared', 'harvesting', 'drying', 'supersacked', 'failed',
];

const SELECT = `
  SELECT lot_id, farm, zone, cultivar, cultivar_slug, map, stage,
         test_date, thc, cbd, sacks, notes, docs, updated_at, updated_by
    FROM harvest_lots
`;

function boardPage() {
  return new Response(BOARD_PAGE, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // The page holds test results; keep it out of shared caches and referers.
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function orderLots(rows) {
  const rank = {};
  STAGE_ORDER.forEach((s, i) => { rank[s] = i; });
  return rows.slice().sort((a, b) => {
    const d = (rank[a.stage] ?? 99) - (rank[b.stage] ?? 99);
    if (d !== 0) return d;
    if (a.farm !== b.farm) return a.farm < b.farm ? -1 : 1;
    if (a.zone !== b.zone) return a.zone < b.zone ? -1 : 1;
    return a.cultivar < b.cultivar ? -1 : 1;
  });
}

async function getBoard(db, params) {
  const where = [];
  const args = [];

  if (params.stage) {
    if (!STAGES.has(params.stage)) {
      throw createError('VALIDATION_ERROR', `Unknown stage "${params.stage}"`);
    }
    where.push('stage = ?');
    args.push(params.stage);
  }
  if (params.farm) {
    where.push('farm = ?');
    args.push(params.farm);
  }
  if (params.q) {
    where.push('(LOWER(cultivar) LIKE ? OR LOWER(zone) LIKE ?)');
    const like = `%${String(params.q).toLowerCase()}%`;
    args.push(like, like);
  }

  const sql = SELECT + (where.length ? ` WHERE ${where.join(' AND ')}` : '');
  const rows = await query(db, sql, args);

  const counts = {};
  STAGE_ORDER.forEach((s) => { counts[s] = 0; });
  rows.forEach((r) => { counts[r.stage] = (counts[r.stage] || 0) + 1; });

  return successResponse({ lots: orderLots(rows), counts, total: rows.length });
}

/**
 * Resolve a lot the way a person refers to one. Timber gets "move Z16 sour
 * lifter to drying", not a lot_id, so accept the id OR a zone+cultivar phrase
 * and make an ambiguous match an error rather than a guess.
 */
async function resolveLot(db, ref) {
  const raw = String(ref || '').trim();
  if (!raw) {
    throw createError('VALIDATION_ERROR', 'lot is required');
  }

  const exact = await queryOne(db, `${SELECT} WHERE lot_id = ?`, [raw]);
  if (exact) return exact;

  // Fuzzy: every whitespace-separated token must appear in "<zone> <cultivar>".
  const tokens = raw.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const all = await query(db, SELECT, []);
  const hits = all.filter((r) => {
    const hay = `${r.zone} ${r.cultivar} ${r.farm} ${r.lot_id}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });

  if (hits.length === 1) return hits[0];
  if (hits.length === 0) {
    throw createError('NOT_FOUND', `No lot matches "${raw}"`);
  }
  throw createError(
    'VALIDATION_ERROR',
    `"${raw}" matches ${hits.length} lots — be more specific: ` +
      hits.slice(0, 6).map((h) => h.lot_id).join(', ') +
      (hits.length > 6 ? ', …' : ''),
  );
}

function normaliseDocs(value) {
  let docs = value;
  if (typeof docs === 'string') {
    try {
      docs = JSON.parse(docs);
    } catch (e) {
      throw createError('VALIDATION_ERROR', 'docs must be a JSON array of {label, ref}');
    }
  }
  if (!Array.isArray(docs)) {
    throw createError('VALIDATION_ERROR', 'docs must be an array');
  }
  return docs.map((d) => {
    const ref = String((d && d.ref) || '').trim();
    if (!ref) {
      throw createError('VALIDATION_ERROR', 'every document needs a ref (URL or repo path)');
    }
    return { label: String((d && d.label) || 'Document').trim().slice(0, 120), ref: ref.slice(0, 500) };
  });
}

function numberOrNull(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw createError('VALIDATION_ERROR', `${field} must be a non-negative number`);
  }
  return n;
}

async function setBoard(db, body, actor) {
  const lot = await resolveLot(db, body.lot ?? body.lot_id);

  const sets = [];
  const args = [];
  const changed = {};

  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (has('stage')) {
    const stage = String(body.stage || '').trim();
    if (!STAGES.has(stage)) {
      throw createError(
        'VALIDATION_ERROR',
        `Unknown stage "${stage}". Use one of: ${[...STAGES].join(', ')}`,
      );
    }
    sets.push('stage = ?');
    args.push(stage);
    changed.stage = stage;
  }

  if (has('test_date')) {
    const d = body.test_date === null || body.test_date === '' ? null : String(body.test_date).trim();
    if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      throw createError('VALIDATION_ERROR', 'test_date must be YYYY-MM-DD');
    }
    sets.push('test_date = ?');
    args.push(d);
    changed.test_date = d;
  }

  if (has('thc')) {
    const v = numberOrNull(body.thc, 'thc');
    sets.push('thc = ?');
    args.push(v);
    changed.thc = v;
  }

  if (has('cbd')) {
    const v = numberOrNull(body.cbd, 'cbd');
    sets.push('cbd = ?');
    args.push(v);
    changed.cbd = v;
  }

  if (has('sacks')) {
    const v = numberOrNull(body.sacks, 'sacks');
    sets.push('sacks = ?');
    args.push(v);
    changed.sacks = v;
  }

  if (has('notes')) {
    const v = body.notes === null ? null : String(body.notes);
    sets.push('notes = ?');
    args.push(v);
    changed.notes = v;
  }

  if (has('docs')) {
    const docs = normaliseDocs(body.docs);
    sets.push('docs = ?');
    args.push(JSON.stringify(docs));
    changed.docs = docs;
  }

  if (!sets.length) {
    throw createError(
      'VALIDATION_ERROR',
      'Nothing to change. Send at least one of: stage, test_date, thc, cbd, sacks, notes, docs',
    );
  }

  sets.push('updated_at = ?', 'updated_by = ?');
  args.push(new Date().toISOString(), actor);
  args.push(lot.lot_id);

  await query(db, `UPDATE harvest_lots SET ${sets.join(', ')} WHERE lot_id = ?`, args);
  const fresh = await queryOne(db, `${SELECT} WHERE lot_id = ?`, [lot.lot_id]);

  return successResponse({ lot: fresh, changed, was: { stage: lot.stage } });
}

/**
 * Who is writing. The page sends the farm password and identifies as "board";
 * Timber sends the same password with actor=timber so the audit column can tell
 * a bot move from a hand move. Actor is a label, not a permission — the password
 * is what authorises.
 */
function actorFrom(body, params) {
  const raw = String(body.actor || params.actor || 'board').toLowerCase().trim();
  return /^[a-z0-9_-]{1,24}$/.test(raw) ? raw : 'board';
}

export async function handleHarvestBoard(request, env, ctx, { action, params, body }) {
  if (action === 'board_page') {
    return boardPage();
  }

  // Everything below returns lot data (THC results included) — gate it.
  requireAuth(request, body, env, `harvest-${action}`);

  const db = env.DB;
  if (!db) {
    throw createError('INTERNAL_ERROR', 'Database not configured');
  }

  switch (action) {
    case 'board':
      return await getBoard(db, { ...params, ...body });
    case 'board_set':
      return await setBoard(db, body, actorFrom(body, params));
    default:
      throw createError('NOT_FOUND', `Unknown board action "${action}"`);
  }
}
