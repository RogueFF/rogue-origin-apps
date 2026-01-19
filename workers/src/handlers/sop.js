/**
 * SOP Manager API Handler for Cloudflare Workers
 * Migrated from Vercel Functions
 *
 * Endpoints:
 * - GET  ?action=getSOPs      - Get all SOPs
 * - GET  ?action=getRequests  - Get all requests
 * - GET  ?action=getSettings  - Get settings
 * - GET  ?action=test         - Test API
 * - POST ?action=createSOP    - Create SOP
 * - POST ?action=updateSOP    - Update SOP
 * - POST ?action=deleteSOP    - Delete SOP
 * - POST ?action=createRequest - Create request
 * - POST ?action=updateRequest - Update request
 * - POST ?action=deleteRequest - Delete request
 * - POST ?action=saveSettings  - Save settings
 * - POST ?action=anthropic     - AI improvements
 */

import { readSheet, appendSheet, writeSheet, clearSheet } from '../lib/sheets.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { sanitizeForSheets } from '../lib/validate.js';

// Sheet tab names
const SHEETS = {
  sops: 'SOPs',
  requests: 'SOP_Requests',
  settings: 'SOP_Settings',
};

/**
 * Get all SOPs
 */
async function getSOPs(params, env) {
  const sheetId = env.SOP_SHEET_ID;
  const data = await readSheet(sheetId, `${SHEETS.sops}!A:Z`, env);

  if (data.length <= 1) {
    return successResponse({ success: true, sops: [] });
  }

  const headers = data[0].map((h) => String(h).toLowerCase().trim());

  // Map headers to indices
  const colMap = {};
  headers.forEach((h, i) => {
    colMap[h] = i;
  });

  const sops = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // Skip empty rows

    const sop = {
      id: row[colMap['id']] || String(i + 1),
      title: row[colMap['title']] || '',
      title_es: row[colMap['title_es']] || '',
      dept: row[colMap['dept']] || row[colMap['department']] || '',
      docNum: row[colMap['docnum']] || row[colMap['doc_num']] || '',
      revision: row[colMap['revision']] || '',
      status: row[colMap['status']] || 'draft',
      description: row[colMap['description']] || '',
      desc_es: row[colMap['desc_es']] || '',
      tags: [],
      steps: [],
      createdAt: row[colMap['createdat']] || row[colMap['created']] || '',
      updatedAt: row[colMap['updatedat']] || row[colMap['updated']] || '',
    };

    // Parse tags (stored as JSON or comma-separated)
    const tagsRaw = row[colMap['tags']] || '';
    if (tagsRaw) {
      try {
        sop.tags = JSON.parse(tagsRaw);
      } catch {
        sop.tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
      }
    }

    // Parse steps (stored as JSON)
    const stepsRaw = row[colMap['steps']] || '';
    if (stepsRaw) {
      try {
        sop.steps = JSON.parse(stepsRaw);
      } catch {
        sop.steps = [];
      }
    }

    sops.push(sop);
  }

  return successResponse({ success: true, sops });
}

/**
 * Get all requests
 */
async function getRequests(params, env) {
  const sheetId = env.SOP_SHEET_ID;
  const data = await readSheet(sheetId, `${SHEETS.requests}!A:Z`, env);

  if (data.length <= 1) {
    return successResponse({ success: true, requests: [] });
  }

  const headers = data[0].map((h) => String(h).toLowerCase().trim());
  const colMap = {};
  headers.forEach((h, i) => {
    colMap[h] = i;
  });

  const requests = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    requests.push({
      id: row[colMap['id']] || String(i + 1),
      title: row[colMap['title']] || '',
      dept: row[colMap['dept']] || row[colMap['department']] || '',
      priority: row[colMap['priority']] || 'medium',
      assignee: row[colMap['assignee']] || '',
      dueDate: row[colMap['duedate']] || row[colMap['due_date']] || '',
      notes: row[colMap['notes']] || '',
      completed: row[colMap['completed']] === 'true' || row[colMap['completed']] === true,
      createdAt: row[colMap['createdat']] || row[colMap['created']] || '',
    });
  }

  return successResponse({ success: true, requests });
}

/**
 * Get settings
 */
async function getSettings(params, env) {
  const sheetId = env.SOP_SHEET_ID;

  try {
    const data = await readSheet(sheetId, `${SHEETS.settings}!A:B`, env);

    const settings = {
      departments: [],
      tags: [],
    };

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const key = String(row[0] || '').toLowerCase();
      const value = row[1] || '';

      if (key === 'departments') {
        try {
          settings.departments = JSON.parse(value);
        } catch {
          settings.departments = value.split(',').map((d) => d.trim()).filter(Boolean);
        }
      } else if (key === 'tags') {
        try {
          settings.tags = JSON.parse(value);
        } catch {
          settings.tags = value.split(',').map((t) => t.trim()).filter(Boolean);
        }
      }
    }

    return successResponse({ success: true, settings });
  } catch {
    // If settings sheet doesn't exist, return defaults
    return successResponse({
      success: true,
      settings: {
        departments: ['Operations', 'Production', 'Quality', 'Safety'],
        tags: ['safety', 'quality', 'training', 'equipment'],
      },
    });
  }
}

/**
 * Test endpoint
 */
async function test() {
  return successResponse({
    ok: true,
    message: 'SOP Manager API is working (Cloudflare Workers)',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Create a new SOP
 */
async function createSOP(params, body, env) {
  const sheetId = env.SOP_SHEET_ID;
  const sop = body.sop;

  if (!sop || !sop.title) {
    throw createError('VALIDATION_ERROR', 'SOP title is required');
  }

  // Generate ID
  const id = 'SOP-' + Date.now();
  const now = new Date().toISOString();

  const row = [
    id,
    sanitizeForSheets(sop.title || ''),
    sanitizeForSheets(sop.title_es || ''),
    sanitizeForSheets(sop.dept || ''),
    sanitizeForSheets(sop.docNum || ''),
    sanitizeForSheets(sop.revision || '1'),
    sanitizeForSheets(sop.status || 'draft'),
    sanitizeForSheets(sop.description || ''),
    sanitizeForSheets(sop.desc_es || ''),
    JSON.stringify(sop.tags || []),
    JSON.stringify(sop.steps || []),
    now,
    now,
  ];

  await appendSheet(sheetId, `${SHEETS.sops}!A:M`, [row], env);

  return successResponse({ success: true, message: 'SOP created', id });
}

/**
 * Update an existing SOP
 */
async function updateSOP(params, body, env) {
  const sheetId = env.SOP_SHEET_ID;
  const sop = body.sop;

  if (!sop || !sop.id) {
    throw createError('VALIDATION_ERROR', 'SOP ID is required');
  }

  // Find the row with this ID
  const data = await readSheet(sheetId, `${SHEETS.sops}!A:A`, env);
  let rowNum = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === sop.id) {
      rowNum = i + 1;
      break;
    }
  }

  if (rowNum === -1) {
    throw createError('NOT_FOUND', 'SOP not found');
  }

  const now = new Date().toISOString();
  const row = [
    sop.id,
    sanitizeForSheets(sop.title || ''),
    sanitizeForSheets(sop.title_es || ''),
    sanitizeForSheets(sop.dept || ''),
    sanitizeForSheets(sop.docNum || ''),
    sanitizeForSheets(sop.revision || '1'),
    sanitizeForSheets(sop.status || 'draft'),
    sanitizeForSheets(sop.description || ''),
    sanitizeForSheets(sop.desc_es || ''),
    JSON.stringify(sop.tags || []),
    JSON.stringify(sop.steps || []),
    sop.createdAt || now,
    now,
  ];

  await writeSheet(sheetId, `${SHEETS.sops}!A${rowNum}:M${rowNum}`, [row], env);

  return successResponse({ success: true, message: 'SOP updated' });
}

/**
 * Delete an SOP
 */
async function deleteSOP(params, body, env) {
  const sheetId = env.SOP_SHEET_ID;
  const id = body.id;

  if (!id) {
    throw createError('VALIDATION_ERROR', 'SOP ID is required');
  }

  // Find the row
  const data = await readSheet(sheetId, `${SHEETS.sops}!A:A`, env);
  let rowNum = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      rowNum = i + 1;
      break;
    }
  }

  if (rowNum === -1) {
    throw createError('NOT_FOUND', 'SOP not found');
  }

  await clearSheet(sheetId, `${SHEETS.sops}!A${rowNum}:M${rowNum}`, env);

  return successResponse({ success: true, message: 'SOP deleted' });
}

/**
 * Create a new request
 */
async function createRequest(params, body, env) {
  const sheetId = env.SOP_SHEET_ID;
  const request = body.request;

  if (!request || !request.title) {
    throw createError('VALIDATION_ERROR', 'Request title is required');
  }

  const id = 'REQ-' + Date.now();
  const now = new Date().toISOString();

  const row = [
    id,
    sanitizeForSheets(request.title || ''),
    sanitizeForSheets(request.dept || ''),
    sanitizeForSheets(request.priority || 'medium'),
    sanitizeForSheets(request.assignee || ''),
    sanitizeForSheets(request.dueDate || ''),
    sanitizeForSheets(request.notes || ''),
    'false',
    now,
  ];

  await appendSheet(sheetId, `${SHEETS.requests}!A:I`, [row], env);

  return successResponse({ success: true, message: 'Request created', id });
}

/**
 * Update a request
 */
async function updateRequest(params, body, env) {
  const sheetId = env.SOP_SHEET_ID;
  const request = body.request;

  if (!request || !request.id) {
    throw createError('VALIDATION_ERROR', 'Request ID is required');
  }

  // Find the row
  const data = await readSheet(sheetId, `${SHEETS.requests}!A:A`, env);
  let rowNum = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === request.id) {
      rowNum = i + 1;
      break;
    }
  }

  if (rowNum === -1) {
    throw createError('NOT_FOUND', 'Request not found');
  }

  const row = [
    request.id,
    sanitizeForSheets(request.title || ''),
    sanitizeForSheets(request.dept || ''),
    sanitizeForSheets(request.priority || 'medium'),
    sanitizeForSheets(request.assignee || ''),
    sanitizeForSheets(request.dueDate || ''),
    sanitizeForSheets(request.notes || ''),
    String(request.completed || false),
    request.createdAt || new Date().toISOString(),
  ];

  await writeSheet(sheetId, `${SHEETS.requests}!A${rowNum}:I${rowNum}`, [row], env);

  return successResponse({ success: true, message: 'Request updated' });
}

/**
 * Delete a request
 */
async function deleteRequest(params, body, env) {
  const sheetId = env.SOP_SHEET_ID;
  const id = body.id;

  if (!id) {
    throw createError('VALIDATION_ERROR', 'Request ID is required');
  }

  // Find the row
  const data = await readSheet(sheetId, `${SHEETS.requests}!A:A`, env);
  let rowNum = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      rowNum = i + 1;
      break;
    }
  }

  if (rowNum === -1) {
    throw createError('NOT_FOUND', 'Request not found');
  }

  await clearSheet(sheetId, `${SHEETS.requests}!A${rowNum}:I${rowNum}`, env);

  return successResponse({ success: true, message: 'Request deleted' });
}

/**
 * Save settings
 */
async function saveSettings(params, body, env) {
  const sheetId = env.SOP_SHEET_ID;
  const settings = body.settings;

  if (!settings) {
    throw createError('VALIDATION_ERROR', 'Settings are required');
  }

  // Write settings as key-value pairs
  const rows = [
    ['Key', 'Value'],
    ['departments', JSON.stringify(settings.departments || [])],
    ['tags', JSON.stringify(settings.tags || [])],
  ];

  await writeSheet(sheetId, `${SHEETS.settings}!A1:B3`, rows, env);

  return successResponse({ success: true, message: 'Settings saved' });
}

/**
 * AI improvements via Anthropic
 */
async function anthropic(params, body, env) {
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
        model: model || 'claude-3-5-haiku-20241022',
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

// ===== MAIN HANDLER =====

export async function handleSop(request, env) {
  const action = getAction(request);
  const params = getQueryParams(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  const actions = {
    getSOPs: () => getSOPs(params, env),
    getRequests: () => getRequests(params, env),
    getSettings: () => getSettings(params, env),
    test: () => test(),
    createSOP: () => createSOP(params, body, env),
    updateSOP: () => updateSOP(params, body, env),
    deleteSOP: () => deleteSOP(params, body, env),
    createRequest: () => createRequest(params, body, env),
    updateRequest: () => updateRequest(params, body, env),
    deleteRequest: () => deleteRequest(params, body, env),
    saveSettings: () => saveSettings(params, body, env),
    anthropic: () => anthropic(params, body, env),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
