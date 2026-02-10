/**
 * Customer Complaints API Handler - D1
 * CRUD operations with write-through sync to Google Sheets
 * Sheet ID: 1SyeueGF5NY3AXvUJYLTjuK01v3jCPIpbs9JQbrhrlHk
 */

import { query, queryOne, execute } from '../lib/db.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';

const SHEET_ID = '1SyeueGF5NY3AXvUJYLTjuK01v3jCPIpbs9JQbrhrlHk';

// Write actions that require authentication
const WRITE_ACTIONS = new Set([
  'save', 'delete',
]);

export async function handleComplaintsD1(request, env, ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  const params = getQueryParams(request);
  const db = env.DB;

  // Require auth for write actions
  if (WRITE_ACTIONS.has(action)) {
    requireAuth(request, body, env, `complaints-${action}`);
  }

  switch (action) {
    case 'complaints':
      return getComplaints(db, params);
    case 'complaint':
      return getComplaint(db, params);
    case 'save':
      return saveComplaint(db, body, env, ctx);
    case 'delete':
      return deleteComplaint(db, body);
    case 'stats':
      return getStats(db);
    case 'sync':
      return syncFromSheets(db, env);
    case 'test':
      return successResponse({ success: true, message: 'Complaints API operational' });
    default:
      throw createError('NOT_FOUND', `Unknown complaints action: ${action}`);
  }
}

// ─── LIST ──────────────────────────────────────────────

async function getComplaints(db, params) {
  const { status, search, limit: rawLimit, offset: rawOffset } = params;
  const limit = Math.min(parseInt(rawLimit) || 100, 500);
  const offset = parseInt(rawOffset) || 0;

  let sql = 'SELECT * FROM complaints';
  const conditions = [];
  const binds = [];

  if (status) {
    conditions.push('status = ?');
    binds.push(status);
  }

  if (search) {
    conditions.push('(customer LIKE ? OR invoice_number LIKE ? OR complaint LIKE ?)');
    const term = `%${search}%`;
    binds.push(term, term, term);
  }

  if (conditions.length) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY complaint_date DESC, created_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const rows = await query(db, sql, binds);
  return successResponse({ success: true, data: rows });
}

// ─── SINGLE ────────────────────────────────────────────

async function getComplaint(db, params) {
  const { id } = params;
  if (!id) throw createError('VALIDATION_ERROR', 'Complaint ID required');

  const row = await queryOne(db, 'SELECT * FROM complaints WHERE id = ?', [id]);
  if (!row) throw createError('NOT_FOUND', 'Complaint not found');

  return successResponse({ success: true, data: row });
}

// ─── SAVE (CREATE/UPDATE) ──────────────────────────────

async function saveComplaint(db, body, env, ctx) {
  const { id, complaint_date, customer, invoice_number, complaint, resolution, status, reported_by, resolved_date, notes } = body;

  if (!complaint_date) throw createError('VALIDATION_ERROR', 'Date is required');
  if (!customer || !customer.trim()) throw createError('VALIDATION_ERROR', 'Customer is required');
  if (!complaint || !complaint.trim()) throw createError('VALIDATION_ERROR', 'Complaint description is required');

  const validStatuses = ['Open', 'In Progress', 'Resolved'];
  const safeStatus = validStatuses.includes(status) ? status : 'Open';

  // Auto-set resolved_date when status changes to Resolved
  const effectiveResolvedDate = safeStatus === 'Resolved' && !resolved_date
    ? new Date().toISOString().split('T')[0]
    : resolved_date || null;

  let resultId;

  if (id) {
    // Update
    await execute(db, `
      UPDATE complaints SET
        complaint_date = ?, customer = ?, invoice_number = ?, complaint = ?,
        resolution = ?, status = ?, reported_by = ?, resolved_date = ?, notes = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `, [
      complaint_date, customer.trim(), invoice_number || null, complaint.trim(),
      resolution || '', safeStatus, reported_by || '', effectiveResolvedDate, notes || '',
      id
    ]);
    resultId = id;
  } else {
    // Insert
    const result = await execute(db, `
      INSERT INTO complaints (complaint_date, customer, invoice_number, complaint, resolution, status, reported_by, resolved_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      complaint_date, customer.trim(), invoice_number || null, complaint.trim(),
      resolution || '', safeStatus, reported_by || '', effectiveResolvedDate, notes || ''
    ]);
    resultId = result.lastRowId;
  }

  // Write-through to Google Sheets (fire and forget)
  if (env.GOOGLE_SHEETS_API_KEY || env.GOOGLE_SERVICE_ACCOUNT) {
    ctx.waitUntil(syncRowToSheet(env, {
      complaint_date, customer: customer.trim(), invoice_number: invoice_number || '',
      complaint: complaint.trim(), resolution: resolution || ''
    }).catch(err => console.error('[Complaints] Sheet sync error:', err)));
  }

  return successResponse({ success: true, id: resultId });
}

// ─── DELETE ────────────────────────────────────────────

async function deleteComplaint(db, body) {
  const { id } = body;
  if (!id) throw createError('VALIDATION_ERROR', 'Complaint ID is required');

  await execute(db, 'DELETE FROM complaints WHERE id = ?', [id]);
  return successResponse({ success: true });
}

// ─── STATS ─────────────────────────────────────────────

async function getStats(db) {
  const total = await queryOne(db, 'SELECT COUNT(*) as count FROM complaints');
  const open = await queryOne(db, "SELECT COUNT(*) as count FROM complaints WHERE status = 'Open'");
  const inProgress = await queryOne(db, "SELECT COUNT(*) as count FROM complaints WHERE status = 'In Progress'");
  const resolved = await queryOne(db, "SELECT COUNT(*) as count FROM complaints WHERE status = 'Resolved'");

  return successResponse({
    success: true,
    data: {
      total: total?.count || 0,
      open: open?.count || 0,
      in_progress: inProgress?.count || 0,
      resolved: resolved?.count || 0,
    }
  });
}

// ─── SHEETS SYNC ───────────────────────────────────────

async function syncRowToSheet(env, row) {
  // Append row to Google Sheet via Sheets API v4
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!A:E:append?valueInputOption=USER_ENTERED&key=${env.GOOGLE_SHEETS_API_KEY}`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      values: [[row.complaint_date, row.customer, row.invoice_number, row.complaint, row.resolution]]
    })
  });
}

async function syncFromSheets(db, env) {
  // One-time import from Google Sheets into D1
  const apiKey = env.GOOGLE_SHEETS_API_KEY;
  if (!apiKey) {
    return successResponse({ success: false, error: 'GOOGLE_SHEETS_API_KEY not configured' });
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1?key=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text();
    throw createError('INTERNAL_ERROR', `Sheets API error: ${text}`);
  }

  const data = await resp.json();
  const rows = data.values || [];

  if (rows.length < 2) {
    return successResponse({ success: true, imported: 0, message: 'No data rows found' });
  }

  // First row is headers, rest is data
  // Expected columns: Date, Customer, Invoice #, Complaint, Resolution
  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const [date, customer, invoice, complaint, resolution] = rows[i];

    if (!date || !customer || !complaint) {
      skipped++;
      continue;
    }

    // Check for dupe by customer + date + invoice combo
    const existing = await queryOne(db,
      'SELECT id FROM complaints WHERE customer = ? AND complaint_date = ? AND (invoice_number = ? OR (invoice_number IS NULL AND ? IS NULL))',
      [customer.trim(), date.trim(), invoice?.trim() || null, invoice?.trim() || null]
    );

    if (existing) {
      skipped++;
      continue;
    }

    await execute(db, `
      INSERT INTO complaints (complaint_date, customer, invoice_number, complaint, resolution, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      date.trim(),
      customer.trim(),
      invoice?.trim() || null,
      complaint.trim(),
      resolution?.trim() || '',
      resolution?.trim() ? 'Resolved' : 'Open'
    ]);
    imported++;
  }

  return successResponse({ success: true, imported, skipped, total_rows: rows.length - 1 });
}
