/**
 * Consignment lot ledger handler. Route: /api/consign
 * Design: docs/plans/2026-11-16-consignment-lot-ledger-design.md
 * Money rules live in ../lib/consign-ledger.js, not here.
 */
import { successResponse, parseBody, getAction } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { requireAuth, constantTimeEqual } from '../lib/auth.js';
import { pacificDay } from '../lib/pacific.js';
import { checkRun, lotMoney, farmTotals, screenTolerance, round2 } from '../lib/consign-ledger.js';

const OWNER_ACTIONS = new Set(['saveFarm', 'savePricePoint', 'setLotTerms']);

function requireOwner(body, env) {
  const secret = env.CONSIGN_OWNER_PASSWORD;
  const given = typeof body.owner_password === 'string' ? body.owner_password : '';
  // Refuse when the secret is unset. Never fall open.
  if (!secret || !given || !constantTimeEqual(given, secret)) {
    throw createError('UNAUTHORIZED', 'Owner password required');
  }
}

const ok = (data) => successResponse({ success: true, data });
const bad = (msg) => createError('VALIDATION_ERROR', msg);

export async function handleConsignD1(request, env, ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  requireAuth(request, body, env, `consign-${action}`);
  if (OWNER_ACTIONS.has(action)) requireOwner(body, env);

  switch (action) {
    default:
      throw createError('NOT_FOUND', `Unknown consign action: ${action}`);
  }
}
