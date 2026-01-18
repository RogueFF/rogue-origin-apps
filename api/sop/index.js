/**
 * SOP Manager API
 * Migrated from Apps Script to Vercel Functions
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

const { createHandler, success } = require('../_lib/response');
const { readSheet, appendSheet, writeSheet, clearSheet } = require('../_lib/sheets');
const { validateOrThrow, sanitizeForSheets } = require('../_lib/validate');
const { createError } = require('../_lib/errors');

const SHEET_ID = process.env.SOP_SHEET_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// Sheet tab names
const SHEETS = {
  sops: 'SOPs',
  requests: 'SOP_Requests',
  settings: 'SOP_Settings',
};

/**
 * Get all SOPs
 */
async function getSOPs(req, res) {
  const data = await readSheet(SHEET_ID, `${SHEETS.sops}!A:Z`);

  if (data.length <= 1) {
    return success(res, { success: true, sops: [] });
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

  success(res, { success: true, sops });
}

/**
 * Get all requests
 */
async function getRequests(req, res) {
  const data = await readSheet(SHEET_ID, `${SHEETS.requests}!A:Z`);

  if (data.length <= 1) {
    return success(res, { success: true, requests: [] });
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

  success(res, { success: true, requests });
}

/**
 * Get settings
 */
async function getSettings(req, res) {
  try {
    const data = await readSheet(SHEET_ID, `${SHEETS.settings}!A:B`);

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

    success(res, { success: true, settings });
  } catch (err) {
    // If settings sheet doesn't exist, return defaults
    success(res, {
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
async function test(req, res) {
  success(res, {
    ok: true,
    message: 'SOP Manager API is working (Vercel)',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Create a new SOP
 */
async function createSOP(req, res, body) {
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

  await appendSheet(SHEET_ID, `${SHEETS.sops}!A:M`, [row]);

  success(res, { success: true, message: 'SOP created', id });
}

/**
 * Update an existing SOP
 */
async function updateSOP(req, res, body) {
  const sop = body.sop;
  if (!sop || !sop.id) {
    throw createError('VALIDATION_ERROR', 'SOP ID is required');
  }

  // Find the row with this ID
  const data = await readSheet(SHEET_ID, `${SHEETS.sops}!A:A`);
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

  await writeSheet(SHEET_ID, `${SHEETS.sops}!A${rowNum}:M${rowNum}`, [row]);

  success(res, { success: true, message: 'SOP updated' });
}

/**
 * Delete an SOP
 */
async function deleteSOP(req, res, body) {
  const id = body.id;
  if (!id) {
    throw createError('VALIDATION_ERROR', 'SOP ID is required');
  }

  // Find the row
  const data = await readSheet(SHEET_ID, `${SHEETS.sops}!A:A`);
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

  await clearSheet(SHEET_ID, `${SHEETS.sops}!A${rowNum}:M${rowNum}`);

  success(res, { success: true, message: 'SOP deleted' });
}

/**
 * Create a new request
 */
async function createRequest(req, res, body) {
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

  await appendSheet(SHEET_ID, `${SHEETS.requests}!A:I`, [row]);

  success(res, { success: true, message: 'Request created', id });
}

/**
 * Update a request
 */
async function updateRequest(req, res, body) {
  const request = body.request;
  if (!request || !request.id) {
    throw createError('VALIDATION_ERROR', 'Request ID is required');
  }

  // Find the row
  const data = await readSheet(SHEET_ID, `${SHEETS.requests}!A:A`);
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

  await writeSheet(SHEET_ID, `${SHEETS.requests}!A${rowNum}:I${rowNum}`, [row]);

  success(res, { success: true, message: 'Request updated' });
}

/**
 * Delete a request
 */
async function deleteRequest(req, res, body) {
  const id = body.id;
  if (!id) {
    throw createError('VALIDATION_ERROR', 'Request ID is required');
  }

  // Find the row
  const data = await readSheet(SHEET_ID, `${SHEETS.requests}!A:A`);
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

  await clearSheet(SHEET_ID, `${SHEETS.requests}!A${rowNum}:I${rowNum}`);

  success(res, { success: true, message: 'Request deleted' });
}

/**
 * Save settings
 */
async function saveSettings(req, res, body) {
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

  await writeSheet(SHEET_ID, `${SHEETS.settings}!A1:B3`, rows);

  success(res, { success: true, message: 'Settings saved' });
}

/**
 * AI improvements via Anthropic
 */
async function anthropic(req, res, body) {
  if (!ANTHROPIC_KEY) {
    throw createError('CONFIG_ERROR', 'Anthropic API key not configured');
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
        'x-api-key': ANTHROPIC_KEY,
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
    success(res, result);
  } catch (err) {
    throw createError('API_ERROR', err.message);
  }
}

// Export handler with all actions
module.exports = createHandler({
  getSOPs: getSOPs,
  getRequests: getRequests,
  getSettings: getSettings,
  test: test,
  createSOP: createSOP,
  updateSOP: updateSOP,
  deleteSOP: deleteSOP,
  createRequest: createRequest,
  updateRequest: updateRequest,
  deleteRequest: deleteRequest,
  saveSettings: saveSettings,
  anthropic: anthropic,
});
