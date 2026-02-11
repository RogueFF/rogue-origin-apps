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

// Valid complaint types and statuses
const COMPLAINT_TYPES = ['Quality', 'Shipping', 'Service', 'Billing', 'Other'];
const VALID_STATUSES = ['Open', 'In Progress', 'Resolved'];

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
    case 'recent':
      return getRecent(db);
    case 'test':
      return successResponse({ success: true, message: 'Complaints API operational' });
    default:
      throw createError('NOT_FOUND', `Unknown complaints action: ${action}`);
  }
}

// ─── LIST ──────────────────────────────────────────────

async function getComplaints(db, params) {
  const { status, complaint_type, search, limit: rawLimit, offset: rawOffset } = params;
  const limit = Math.min(Math.max(parseInt(rawLimit) || 100, 1), 500);
  const offset = Math.max(parseInt(rawOffset) || 0, 0);

  let sql = 'SELECT * FROM complaints';
  const conditions = [];
  const binds = [];

  if (status && VALID_STATUSES.includes(status)) {
    conditions.push('status = ?');
    binds.push(status);
  }

  if (complaint_type && COMPLAINT_TYPES.includes(complaint_type)) {
    conditions.push('complaint_type = ?');
    binds.push(complaint_type);
  }

  if (search) {
    const sanitized = String(search).substring(0, 200);
    conditions.push('(customer LIKE ? OR invoice_number LIKE ? OR complaint LIKE ?)');
    const term = `%${sanitized}%`;
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
  const id = parseInt(params.id);
  if (!id || id < 1) throw createError('VALIDATION_ERROR', 'Valid complaint ID required');

  const row = await queryOne(db, 'SELECT * FROM complaints WHERE id = ?', [id]);
  if (!row) throw createError('NOT_FOUND', 'Complaint not found');

  return successResponse({ success: true, data: row });
}

// ─── RECENT ────────────────────────────────────────────

async function getRecent(db) {
  const rows = await query(db,
    'SELECT * FROM complaints ORDER BY created_at DESC LIMIT 5',
    []
  );
  return successResponse({ success: true, data: rows });
}

// ─── SAVE (CREATE/UPDATE) ──────────────────────────────

async function saveComplaint(db, body, env, ctx) {
  const {
    id, complaint_date, customer, invoice_number, complaint,
    resolution, status, reported_by, resolved_date, notes, complaint_type
  } = body;

  // Validate date format (YYYY-MM-DD)
  if (!complaint_date || !/^\d{4}-\d{2}-\d{2}$/.test(complaint_date)) {
    throw createError('VALIDATION_ERROR', 'Valid date (YYYY-MM-DD) is required');
  }

  const customerTrimmed = String(customer || '').trim();
  if (!customerTrimmed) throw createError('VALIDATION_ERROR', 'Customer is required');
  if (customerTrimmed.length > 500) throw createError('VALIDATION_ERROR', 'Customer name too long');

  const complaintTrimmed = String(complaint || '').trim();
  if (!complaintTrimmed) throw createError('VALIDATION_ERROR', 'Complaint description is required');
  if (complaintTrimmed.length > 5000) throw createError('VALIDATION_ERROR', 'Complaint description too long');

  const safeStatus = VALID_STATUSES.includes(status) ? status : 'Open';
  const safeType = COMPLAINT_TYPES.includes(complaint_type) ? complaint_type : 'Other';

  // Auto-set resolved_date when status changes to Resolved
  const effectiveResolvedDate = safeStatus === 'Resolved' && !resolved_date
    ? new Date().toISOString().split('T')[0]
    : resolved_date || null;

  const invoiceTrimmed = String(invoice_number || '').trim() || null;
  const resolutionTrimmed = String(resolution || '').trim();
  const reporterTrimmed = String(reported_by || '').trim();
  const notesTrimmed = String(notes || '').trim();

  let resultId;

  if (id) {
    const numericId = parseInt(id);
    if (!numericId || numericId < 1) throw createError('VALIDATION_ERROR', 'Invalid complaint ID');

    // Verify exists
    const existing = await queryOne(db, 'SELECT id FROM complaints WHERE id = ?', [numericId]);
    if (!existing) throw createError('NOT_FOUND', 'Complaint not found');

    await execute(db, `
      UPDATE complaints SET
        complaint_date = ?, customer = ?, invoice_number = ?, complaint = ?,
        resolution = ?, status = ?, reported_by = ?, resolved_date = ?, notes = ?,
        complaint_type = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [
      complaint_date, customerTrimmed, invoiceTrimmed, complaintTrimmed,
      resolutionTrimmed, safeStatus, reporterTrimmed, effectiveResolvedDate, notesTrimmed,
      safeType, numericId
    ]);
    resultId = numericId;
  } else {
    const result = await execute(db, `
      INSERT INTO complaints (complaint_date, customer, invoice_number, complaint, resolution, status, reported_by, resolved_date, notes, complaint_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      complaint_date, customerTrimmed, invoiceTrimmed, complaintTrimmed,
      resolutionTrimmed, safeStatus, reporterTrimmed, effectiveResolvedDate, notesTrimmed,
      safeType
    ]);
    resultId = result.lastRowId;
  }

  // Write-through to Google Sheets (fire and forget)
  if (env.GOOGLE_SHEETS_API_KEY || env.GOOGLE_SERVICE_ACCOUNT) {
    ctx.waitUntil(syncRowToSheet(env, {
      complaint_date, customer: customerTrimmed, invoice_number: invoiceTrimmed || '',
      complaint: complaintTrimmed, resolution: resolutionTrimmed, complaint_type: safeType
    }).catch(err => console.error('[Complaints] Sheet sync error:', err)));
  }

  return successResponse({ success: true, id: resultId });
}

// ─── DELETE ────────────────────────────────────────────

async function deleteComplaint(db, body) {
  const id = parseInt(body.id);
  if (!id || id < 1) throw createError('VALIDATION_ERROR', 'Valid complaint ID is required');

  const existing = await queryOne(db, 'SELECT id FROM complaints WHERE id = ?', [id]);
  if (!existing) throw createError('NOT_FOUND', 'Complaint not found');

  await execute(db, 'DELETE FROM complaints WHERE id = ?', [id]);
  return successResponse({ success: true });
}

// ─── STATS ─────────────────────────────────────────────

async function getStats(db) {
  const total = await queryOne(db, 'SELECT COUNT(*) as count FROM complaints');
  const open = await queryOne(db, "SELECT COUNT(*) as count FROM complaints WHERE status = 'Open'");
  const inProgress = await queryOne(db, "SELECT COUNT(*) as count FROM complaints WHERE status = 'In Progress'");
  const resolved = await queryOne(db, "SELECT COUNT(*) as count FROM complaints WHERE status = 'Resolved'");

  // Monthly trend (last 6 months)
  const monthlyTrend = await query(db, `
    SELECT
      strftime('%Y-%m', complaint_date) as month,
      COUNT(*) as count
    FROM complaints
    WHERE complaint_date >= date('now', '-6 months')
    GROUP BY month
    ORDER BY month DESC
  `, []);

  // Breakdown by type
  const byType = await query(db, `
    SELECT
      COALESCE(complaint_type, 'Other') as complaint_type,
      COUNT(*) as count
    FROM complaints
    GROUP BY complaint_type
    ORDER BY count DESC
  `, []);

  // Average resolution time (in days)
  const avgResolution = await queryOne(db, `
    SELECT
      AVG(JULIANDAY(resolved_date) - JULIANDAY(complaint_date)) as avg_days
    FROM complaints
    WHERE status = 'Resolved' AND resolved_date IS NOT NULL AND complaint_date IS NOT NULL
      AND JULIANDAY(resolved_date) >= JULIANDAY(complaint_date)
  `);

  return successResponse({
    success: true,
    data: {
      total: total?.count || 0,
      open: open?.count || 0,
      in_progress: inProgress?.count || 0,
      resolved: resolved?.count || 0,
      monthly_trend: monthlyTrend,
      by_type: byType,
      avg_resolution_days: avgResolution?.avg_days ? Math.round(avgResolution.avg_days * 10) / 10 : null,
    }
  });
}

// ─── SHEETS SYNC ───────────────────────────────────────

async function syncRowToSheet(env, row) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!A:F:append?valueInputOption=USER_ENTERED&key=${env.GOOGLE_SHEETS_API_KEY}`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      values: [[row.complaint_date, row.customer, row.invoice_number, row.complaint, row.resolution, row.complaint_type]]
    })
  });
}

/**
 * RFC 4180 compliant CSV parser.
 * Handles: quoted fields, commas inside quotes, escaped quotes (""),
 * CRLF/LF line endings, empty rows.
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
        i++;
      } else if (ch === '\r') {
        // Handle CRLF
        row.push(field.trim());
        field = '';
        if (row.some(f => f !== '')) rows.push(row);
        row = [];
        i++;
        if (i < text.length && text[i] === '\n') i++;
      } else if (ch === '\n') {
        row.push(field.trim());
        field = '';
        if (row.some(f => f !== '')) rows.push(row);
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Final field/row
  row.push(field.trim());
  if (row.some(f => f !== '')) rows.push(row);

  return rows;
}

async function syncFromSheets(db, env) {
  // Check if complaint_type column exists, add it if not
  const tableInfo = await query(db, "PRAGMA table_info(complaints)", []);
  const hasComplaintType = tableInfo.some(col => col.name === 'complaint_type');

  if (!hasComplaintType) {
    await execute(db, `
      ALTER TABLE complaints ADD COLUMN complaint_type TEXT DEFAULT 'Other' CHECK(complaint_type IN ('Quality','Shipping','Service','Billing','Other'))
    `, []);
  }

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text();
    throw createError('INTERNAL_ERROR', `Google Sheets CSV export error: ${resp.status}`);
  }

  const csv = await resp.text();
  const rows = parseCSV(csv);

  if (rows.length < 2) {
    return successResponse({ success: true, imported: 0, message: 'No data rows found' });
  }

  // First row is headers — map by name for flexibility
  const headers = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const dateIdx = headers.findIndex(h => h.includes('date'));
  const custIdx = headers.findIndex(h => h.includes('customer'));
  const invIdx = headers.findIndex(h => h.includes('inv'));
  const compIdx = headers.findIndex(h => h.includes('complaint'));
  const resIdx = headers.findIndex(h => h.includes('resolution'));
  const typeIdx = headers.findIndex(h => h.includes('type'));

  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    // Guard against rows shorter than expected
    const getField = (idx, fallback) => {
      if (idx >= 0 && idx < row.length) return row[idx];
      if (fallback < row.length) return row[fallback];
      return '';
    };

    const date = getField(dateIdx, 0);
    const customer = getField(custIdx, 1);
    const invoice = getField(invIdx, 2);
    const complaint = getField(compIdx, 3);
    const resolution = getField(resIdx, 4);
    const type = getField(typeIdx, 5);

    if (!date || !customer || !complaint) {
      skipped++;
      continue;
    }

    try {
      const invoiceValue = invoice?.trim() || null;

      let existing;
      if (invoiceValue === null) {
        existing = await queryOne(db,
          'SELECT id FROM complaints WHERE customer = ? AND complaint_date = ? AND invoice_number IS NULL',
          [customer.trim(), date.trim()]
        );
      } else {
        existing = await queryOne(db,
          'SELECT id FROM complaints WHERE customer = ? AND complaint_date = ? AND invoice_number = ?',
          [customer.trim(), date.trim(), invoiceValue]
        );
      }

      if (existing) {
        skipped++;
        continue;
      }

      const complaintType = COMPLAINT_TYPES.includes(type?.trim()) ? type.trim() : 'Other';

      await execute(db, `
        INSERT INTO complaints (complaint_date, customer, invoice_number, complaint, resolution, status, complaint_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        date.trim(),
        customer.trim(),
        invoiceValue,
        complaint.trim(),
        resolution?.trim() || '',
        resolution?.trim() ? 'Resolved' : 'Open',
        complaintType
      ]);
      imported++;
    } catch (err) {
      errors.push({ row: i + 1, error: err.message });
      skipped++;
    }
  }

  return successResponse({
    success: true,
    imported,
    skipped,
    total_rows: rows.length - 1,
    errors: errors.length > 0 ? errors : undefined
  });
}
