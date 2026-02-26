/**
 * SOP Manager API Handler - D1 Version
 * Migrated from Google Sheets to Cloudflare D1
 */

import { query, queryOne, insert, update, deleteRows, execute } from '../lib/db.js';
import { readSheet } from '../lib/sheets.js';
import { successResponse, parseBody, getAction } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';

// Sheet tab names for migration
const SHEETS = {
  sops: 'SOPs',
  requests: 'SOP_Requests',
  settings: 'SOP_Settings',
};

/**
 * Get all SOPs
 */
async function getSOPs(env) {
  const sops = await query(env.DB, `
    SELECT id, title, title_es, dept, doc_num, revision, status,
           description, desc_es, tags, steps, linked_sops, created_at, updated_at
    FROM sops
    ORDER BY created_at DESC
  `);

  return successResponse({
    success: true,
    sops: sops.map(s => ({
      id: s.id,
      title: s.title || '',
      title_es: s.title_es || '',
      dept: s.dept || '',
      docNum: s.doc_num || '',
      revision: s.revision || '1',
      status: s.status || 'draft',
      description: s.description || '',
      desc_es: s.desc_es || '',
      tags: s.tags ? JSON.parse(s.tags) : [],
      steps: s.steps ? JSON.parse(s.steps) : [],
      linkedSops: s.linked_sops ? JSON.parse(s.linked_sops) : [],
      createdAt: s.created_at || '',
      updatedAt: s.updated_at || '',
    }))
  });
}

/**
 * Get all requests
 */
async function getRequests(env) {
  const requests = await query(env.DB, `
    SELECT id, title, dept, priority, assignee, due_date, notes, completed, created_at
    FROM sop_requests
    ORDER BY created_at DESC
  `);

  return successResponse({
    success: true,
    requests: requests.map(r => ({
      id: r.id,
      title: r.title || '',
      dept: r.dept || '',
      priority: r.priority || 'medium',
      assignee: r.assignee || '',
      dueDate: r.due_date || '',
      notes: r.notes || '',
      completed: r.completed === 1,
      createdAt: r.created_at || '',
    }))
  });
}

/**
 * Get settings
 */
async function getSettings(env) {
  const settings = await query(env.DB, 'SELECT key, value FROM sop_settings');

  const result = {
    departments: ['Operations', 'Production', 'Quality', 'Safety'],
    tags: ['safety', 'quality', 'training', 'equipment'],
  };

  for (const row of settings) {
    if (row.key === 'departments') {
      try { result.departments = JSON.parse(row.value); } catch {}
    } else if (row.key === 'tags') {
      try { result.tags = JSON.parse(row.value); } catch {}
    }
  }

  return successResponse({ success: true, settings: result });
}

/**
 * Test endpoint
 */
async function test() {
  return successResponse({
    ok: true,
    message: 'SOP Manager API is working (Cloudflare D1)',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Create a new SOP
 */
async function createSOP(body, env) {
  const sop = body.sop;

  if (!sop || !sop.title) {
    throw createError('VALIDATION_ERROR', 'SOP title is required');
  }

  const id = 'SOP-' + Date.now();
  const now = new Date().toISOString();

  await insert(env.DB, 'sops', {
    id,
    title: (sop.title_en || sop.title || ''),
    title_es: (sop.title_es || ''),
    dept: (sop.dept || ''),
    doc_num: (sop.docNum || ''),
    revision: (sop.revision || '1'),
    status: (sop.status || 'draft'),
    description: (sop.desc_en || sop.description || ''),
    desc_es: (sop.desc_es || ''),
    tags: JSON.stringify(sop.tags || []),
    steps: JSON.stringify(sop.steps || []),
    linked_sops: JSON.stringify(sop.linkedSops || []),
    created_at: now,
    updated_at: now,
  });

  return successResponse({ success: true, message: 'SOP created', id });
}

/**
 * Update an existing SOP
 */
async function updateSOP(body, env) {
  const sop = body.sop;

  if (!sop || !sop.id) {
    throw createError('VALIDATION_ERROR', 'SOP ID is required');
  }

  const existing = await queryOne(env.DB, 'SELECT id FROM sops WHERE id = ?', [sop.id]);
  if (!existing) {
    throw createError('NOT_FOUND', 'SOP not found');
  }

  const now = new Date().toISOString();

  await update(env.DB, 'sops', {
    title: (sop.title_en || sop.title || ''),
    title_es: (sop.title_es || ''),
    dept: (sop.dept || ''),
    doc_num: (sop.docNum || ''),
    revision: (sop.revision || '1'),
    status: (sop.status || 'draft'),
    description: (sop.desc_en || sop.description || ''),
    desc_es: (sop.desc_es || ''),
    tags: JSON.stringify(sop.tags || []),
    steps: JSON.stringify(sop.steps || []),
    linked_sops: JSON.stringify(sop.linkedSops || []),
    updated_at: now,
  }, 'id = ?', [sop.id]);

  return successResponse({ success: true, message: 'SOP updated' });
}

/**
 * Delete an SOP
 */
async function deleteSOP(body, env) {
  const id = body.id;

  if (!id) {
    throw createError('VALIDATION_ERROR', 'SOP ID is required');
  }

  const changes = await deleteRows(env.DB, 'sops', 'id = ?', [id]);

  if (changes === 0) {
    throw createError('NOT_FOUND', 'SOP not found');
  }

  return successResponse({ success: true, message: 'SOP deleted' });
}

/**
 * Create a new request
 */
async function createRequest(body, env) {
  const request = body.request;

  if (!request || !request.title) {
    throw createError('VALIDATION_ERROR', 'Request title is required');
  }

  const id = 'REQ-' + Date.now();
  const now = new Date().toISOString();

  await insert(env.DB, 'sop_requests', {
    id,
    title: (request.title || ''),
    dept: (request.dept || ''),
    priority: (request.priority || 'medium'),
    assignee: (request.assignee || ''),
    due_date: (request.dueDate || ''),
    notes: (request.notes || ''),
    completed: 0,
    created_at: now,
  });

  return successResponse({ success: true, message: 'Request created', id });
}

/**
 * Update a request
 */
async function updateRequest(body, env) {
  const request = body.request;

  if (!request || !request.id) {
    throw createError('VALIDATION_ERROR', 'Request ID is required');
  }

  const existing = await queryOne(env.DB, 'SELECT id FROM sop_requests WHERE id = ?', [request.id]);
  if (!existing) {
    throw createError('NOT_FOUND', 'Request not found');
  }

  await update(env.DB, 'sop_requests', {
    title: (request.title || ''),
    dept: (request.dept || ''),
    priority: (request.priority || 'medium'),
    assignee: (request.assignee || ''),
    due_date: (request.dueDate || ''),
    notes: (request.notes || ''),
    completed: request.completed ? 1 : 0,
  }, 'id = ?', [request.id]);

  return successResponse({ success: true, message: 'Request updated' });
}

/**
 * Delete a request
 */
async function deleteRequest(body, env) {
  const id = body.id;

  if (!id) {
    throw createError('VALIDATION_ERROR', 'Request ID is required');
  }

  const changes = await deleteRows(env.DB, 'sop_requests', 'id = ?', [id]);

  if (changes === 0) {
    throw createError('NOT_FOUND', 'Request not found');
  }

  return successResponse({ success: true, message: 'Request deleted' });
}

/**
 * Save settings
 */
async function saveSettings(body, env) {
  const settings = body.settings;

  if (!settings) {
    throw createError('VALIDATION_ERROR', 'Settings are required');
  }

  // Upsert departments
  await execute(env.DB,
    `INSERT INTO sop_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['departments', JSON.stringify(settings.departments || [])]
  );

  // Upsert tags
  await execute(env.DB,
    `INSERT INTO sop_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ['tags', JSON.stringify(settings.tags || [])]
  );

  return successResponse({ success: true, message: 'Settings saved' });
}

/**
 * AI improvements via Anthropic (unchanged - doesn't use database)
 */
async function anthropic(body, env) {
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw createError('INTERNAL_ERROR', 'Anthropic API key not configured');
  }

  const { model, max_tokens, messages } = body.body || body;

  if (!messages || !Array.isArray(messages)) {
    throw createError('VALIDATION_ERROR', 'Messages array is required');
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 500,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${err}`);
    }

    const result = await response.json();
    return successResponse(result);
  } catch (err) {
    throw createError('INTERNAL_ERROR', err.message);
  }
}

/**
 * Migrate data from Google Sheets to D1 (one-time migration)
 */
async function migrateFromSheets(env) {
  const sheetId = env.SOP_SHEET_ID;
  if (!sheetId) {
    throw createError('INTERNAL_ERROR', 'SOP_SHEET_ID not configured');
  }

  let sopsMigrated = 0;
  let requestsMigrated = 0;
  let settingsMigrated = 0;

  // Migrate SOPs
  try {
    const sopsData = await readSheet(sheetId, `${SHEETS.sops}!A:Z`, env);
    if (sopsData.length > 1) {
      const headers = sopsData[0].map(h => String(h).toLowerCase().trim());
      const colMap = {};
      headers.forEach((h, i) => { colMap[h] = i; });

      for (let i = 1; i < sopsData.length; i++) {
        const row = sopsData[i];
        if (!row[0]) continue;

        const id = row[colMap['id']] || `SOP-${Date.now()}-${i}`;

        // Check if already exists
        const existing = await queryOne(env.DB, 'SELECT id FROM sops WHERE id = ?', [id]);
        if (existing) continue;

        let tags = [];
        const tagsRaw = row[colMap['tags']] || '';
        if (tagsRaw) {
          try { tags = JSON.parse(tagsRaw); } catch { tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean); }
        }

        let steps = [];
        const stepsRaw = row[colMap['steps']] || '';
        if (stepsRaw) {
          try { steps = JSON.parse(stepsRaw); } catch { steps = []; }
        }

        await insert(env.DB, 'sops', {
          id,
          title: (row[colMap['title']] || ''),
          title_es: (row[colMap['title_es']] || ''),
          dept: (row[colMap['dept']] || row[colMap['department']] || ''),
          doc_num: (row[colMap['docnum']] || row[colMap['doc_num']] || ''),
          revision: (row[colMap['revision']] || '1'),
          status: (row[colMap['status']] || 'draft'),
          description: (row[colMap['description']] || ''),
          desc_es: (row[colMap['desc_es']] || ''),
          tags: JSON.stringify(tags),
          steps: JSON.stringify(steps),
          created_at: row[colMap['createdat']] || row[colMap['created']] || new Date().toISOString(),
          updated_at: row[colMap['updatedat']] || row[colMap['updated']] || new Date().toISOString(),
        });
        sopsMigrated++;
      }
    }
  } catch (e) {
    console.error('Error migrating SOPs:', e);
  }

  // Migrate Requests
  try {
    const reqData = await readSheet(sheetId, `${SHEETS.requests}!A:Z`, env);
    if (reqData.length > 1) {
      const headers = reqData[0].map(h => String(h).toLowerCase().trim());
      const colMap = {};
      headers.forEach((h, i) => { colMap[h] = i; });

      for (let i = 1; i < reqData.length; i++) {
        const row = reqData[i];
        if (!row[0]) continue;

        const id = row[colMap['id']] || `REQ-${Date.now()}-${i}`;

        const existing = await queryOne(env.DB, 'SELECT id FROM sop_requests WHERE id = ?', [id]);
        if (existing) continue;

        await insert(env.DB, 'sop_requests', {
          id,
          title: (row[colMap['title']] || ''),
          dept: (row[colMap['dept']] || row[colMap['department']] || ''),
          priority: (row[colMap['priority']] || 'medium'),
          assignee: (row[colMap['assignee']] || ''),
          due_date: (row[colMap['duedate']] || row[colMap['due_date']] || ''),
          notes: (row[colMap['notes']] || ''),
          completed: row[colMap['completed']] === 'true' || row[colMap['completed']] === true ? 1 : 0,
          created_at: row[colMap['createdat']] || row[colMap['created']] || new Date().toISOString(),
        });
        requestsMigrated++;
      }
    }
  } catch (e) {
    console.error('Error migrating requests:', e);
  }

  // Migrate Settings
  try {
    const settingsData = await readSheet(sheetId, `${SHEETS.settings}!A:B`, env);
    for (let i = 1; i < settingsData.length; i++) {
      const row = settingsData[i];
      const key = String(row[0] || '').toLowerCase();
      const value = row[1] || '';

      if (key === 'departments' || key === 'tags') {
        await execute(env.DB,
          `INSERT INTO sop_settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [key, value]
        );
        settingsMigrated++;
      }
    }
  } catch (e) {
    console.error('Error migrating settings:', e);
  }

  return successResponse({
    success: true,
    message: `Migration complete. SOPs: ${sopsMigrated}, Requests: ${requestsMigrated}, Settings: ${settingsMigrated}`,
    sopsMigrated,
    requestsMigrated,
    settingsMigrated,
  });
}

export async function handleSopD1(request, env) {
  const action = getAction(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  const actions = {
    getSOPs: () => getSOPs(env),
    getRequests: () => getRequests(env),
    getSettings: () => getSettings(env),
    test: () => test(),
    createSOP: () => createSOP(body, env),
    updateSOP: () => updateSOP(body, env),
    deleteSOP: () => deleteSOP(body, env),
    createRequest: () => createRequest(body, env),
    updateRequest: () => updateRequest(body, env),
    deleteRequest: () => deleteRequest(body, env),
    saveSettings: () => saveSettings(body, env),
    anthropic: () => anthropic(body, env),
    migrate: () => migrateFromSheets(env),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
