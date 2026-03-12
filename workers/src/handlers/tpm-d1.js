import { query, queryOne, insert, update, deleteRows } from '../lib/db.js';
import { successResponse, parseBody, getAction } from '../lib/response.js';
import { createError } from '../lib/errors.js';

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeCard(row) {
  if (!row) return row;
  return {
    ...row,
    desc_image: row.desc_image || '',
    instr_image: row.instr_image || '',
    ppe_other: row.ppe_other || '',
    hazard_other: row.hazard_other || '',
    ppe: parseJsonArray(row.ppe),
    hazards: parseJsonArray(row.hazards),
  };
}


// ── GET all cards ──
async function getCards(env) {
  const rows = await query(env.DB, 'SELECT * FROM tpm_cards ORDER BY created_at DESC');
  const cards = rows.map(normalizeCard);
  return successResponse({ success: true, cards });
}

// ── GET single card ──
async function getCard(body, env) {
  const id = body.id;
  if (!id) throw createError('VALIDATION_ERROR', 'Card ID is required');
  const row = await queryOne(env.DB, 'SELECT * FROM tpm_cards WHERE id = ?', [id]);
  if (!row) throw createError('NOT_FOUND', 'Card not found');
  return successResponse({ success: true, card: normalizeCard(row) });
}

// ── CREATE card ──
async function createCard(body, env) {
  const c = body.card;
  if (!c || !c.equipment) throw createError('VALIDATION_ERROR', 'Equipment is required');
  if (!c.title_en && !c.title_es) throw createError('VALIDATION_ERROR', 'Title is required in at least one language');

  const id = 'TPM-' + Date.now();
  const now = new Date().toISOString();

  await insert(env.DB, 'tpm_cards', {
    id,
    frequency: c.frequency || 'daily',
    title_en: c.title_en || '',
    title_es: c.title_es || '',
    equipment: c.equipment,
    shift: c.shift || '',
    desc_en: c.desc_en || '',
    desc_es: c.desc_es || '',
    instr_en: c.instr_en || '',
    instr_es: c.instr_es || '',
    desc_image: c.desc_image || '',
    instr_image: c.instr_image || '',
    ppe: JSON.stringify(c.ppe || []),
    ppe_other: c.ppe_other || '',
    hazards: JSON.stringify(c.hazards || []),
    hazard_other: c.hazard_other || '',
    materials_en: c.materials_en || '',
    materials_es: c.materials_es || '',
    warning_en: c.warning_en || '',
    warning_es: c.warning_es || '',
    status: 'needs_review',
    created_by: c.created_by || '',
    created_at: now,
    updated_at: now,
  });

  return successResponse({ success: true, message: 'Card created', id });
}

// ── UPDATE card ──
async function updateCard(body, env) {
  const c = body.card;
  if (!c || !c.id) throw createError('VALIDATION_ERROR', 'Card ID is required');

  const existing = await queryOne(env.DB, 'SELECT id FROM tpm_cards WHERE id = ?', [c.id]);
  if (!existing) throw createError('NOT_FOUND', 'Card not found');

  const now = new Date().toISOString();

  await update(env.DB, 'tpm_cards', {
    frequency: c.frequency || 'daily',
    title_en: c.title_en || '',
    title_es: c.title_es || '',
    equipment: c.equipment || '',
    shift: c.shift || '',
    desc_en: c.desc_en || '',
    desc_es: c.desc_es || '',
    instr_en: c.instr_en || '',
    instr_es: c.instr_es || '',
    desc_image: c.desc_image || '',
    instr_image: c.instr_image || '',
    ppe: JSON.stringify(c.ppe || []),
    ppe_other: c.ppe_other || '',
    hazards: JSON.stringify(c.hazards || []),
    hazard_other: c.hazard_other || '',
    materials_en: c.materials_en || '',
    materials_es: c.materials_es || '',
    warning_en: c.warning_en || '',
    warning_es: c.warning_es || '',
    status: c.status || 'needs_review',
    reviewed_by: c.reviewed_by || '',
    updated_at: now,
  }, 'id = ?', [c.id]);

  return successResponse({ success: true, message: 'Card updated' });
}

// ── DELETE card ──
async function deleteCard(body, env) {
  const id = body.id;
  if (!id) throw createError('VALIDATION_ERROR', 'Card ID is required');
  const changes = await deleteRows(env.DB, 'tpm_cards', 'id = ?', [id]);
  if (changes === 0) throw createError('NOT_FOUND', 'Card not found');
  return successResponse({ success: true, message: 'Card deleted' });
}

// ── APPROVE card ──
async function approveCard(body, env) {
  const id = body.id;
  const reviewer = body.reviewed_by || '';
  if (!id) throw createError('VALIDATION_ERROR', 'Card ID is required');

  const now = new Date().toISOString();
  const changes = await update(env.DB, 'tpm_cards', {
    status: 'approved',
    reviewed_by: reviewer,
    updated_at: now,
  }, 'id = ?', [id]);
  if (changes === 0) throw createError('NOT_FOUND', 'Card not found');

  return successResponse({ success: true, message: 'Card approved' });
}

// ── TRANSLATE via Anthropic ──
async function translateCard(body, env) {
  const { text, from, to } = body;
  if (!text || !from || !to) throw createError('VALIDATION_ERROR', 'text, from, and to are required');

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw createError('CONFIG_ERROR', 'ANTHROPIC_API_KEY not set');

  const langNames = { en: 'English', es: 'Spanish' };
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Translate the following ${langNames[from]} text to ${langNames[to]}. This is for a TPM (Total Productive Maintenance) card used in a hemp processing facility. Keep it concise, clear, and appropriate for floor workers. Return ONLY the translated text, nothing else.\n\n${text}`
      }]
    })
  });

  const result = await response.json();
  const translated = result.content?.[0]?.text || '';
  return successResponse({ success: true, translated });
}

// ── BATCH TRANSLATE all card fields ──
async function translateCardBatch(body, env) {
  const { card, from, to } = body;
  if (!card || !from || !to) throw createError('VALIDATION_ERROR', 'card, from, and to are required');

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw createError('CONFIG_ERROR', 'ANTHROPIC_API_KEY not set');

  // Collect all non-empty source fields
  const fields = ['title', 'desc', 'instr', 'materials', 'warning'];
  const toTranslate = {};
  for (const f of fields) {
    const val = card[f + '_' + from];
    if (val && val.trim()) toTranslate[f] = val;
  }

  if (Object.keys(toTranslate).length === 0) {
    return successResponse({ success: true, translations: {} });
  }

  const langNames = { en: 'English', es: 'Spanish' };
  const fieldList = Object.entries(toTranslate)
    .map(([key, val]) => `[${key}]\n${val}`)
    .join('\n\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Translate the following ${langNames[from]} fields to ${langNames[to]}. This is for TPM (Total Productive Maintenance) cards used in a hemp processing facility. Keep it concise, clear, and appropriate for floor workers.\n\nReturn ONLY the translations in the exact same format with [field_name] headers. Do not add any extra text.\n\n${fieldList}`
      }]
    })
  });

  const result = await response.json();
  const rawText = result.content?.[0]?.text || '';

  // Parse response back into field map
  const translations = {};
  const regex = /\[(\w+)\]\s*\n([\s\S]*?)(?=\n\[\w+\]|$)/g;
  let match;
  while ((match = regex.exec(rawText)) !== null) {
    const key = match[1].trim();
    const val = match[2].trim();
    if (fields.includes(key) && val) {
      translations[key + '_' + to] = val;
    }
  }

  return successResponse({ success: true, translations });
}

// ── GET unique equipment list ──
async function getEquipment(env) {
  const rows = await query(env.DB, 'SELECT DISTINCT equipment FROM tpm_cards ORDER BY equipment');
  const equipment = rows.map(r => r.equipment);
  return successResponse({ success: true, equipment });
}

// ── AI GENERATE cards from machine info ──
async function generateCards(body, env) {
  const { machine_name, machine_year, machine_model, specifics, language } = body;
  if (!machine_name) throw createError('VALIDATION_ERROR', 'Machine name is required');

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw createError('CONFIG_ERROR', 'ANTHROPIC_API_KEY not set');

  const lang = language || 'en';
  const langName = lang === 'es' ? 'Spanish' : 'English';
  const titleSuffix = lang === 'es' ? '_es' : '_en';
  const otherSuffix = lang === 'es' ? '_en' : '_es';

  let machineDesc = machine_name;
  if (machine_year) machineDesc += ` (${machine_year})`;
  if (machine_model) machineDesc += ` - Model: ${machine_model}`;

  const prompt = `You are a TPM (Total Productive Maintenance) expert creating maintenance cards for industrial equipment used in a hemp processing facility.

Machine: ${machineDesc}
${specifics ? `Additional details: ${specifics}` : ''}

Generate comprehensive TPM maintenance cards for this machine. Include cards for:
- Daily pre-shift inspections
- Daily during-operation checks
- Daily end-of-shift tasks
- Weekly maintenance tasks
- Weekly lubrication tasks
- Monthly inspection and maintenance
- Monthly lubrication tasks

For each card provide ALL of the following fields in ${langName}:
- frequency: "daily", "weekly", or "monthly"
- title: concise task name
- equipment: the machine name
- shift: when performed (e.g. "Pre-shift", "During operation", "End of shift", or blank for weekly/monthly)
- description: 1-2 sentence description of the task
- instruction: numbered step-by-step instructions (use \\n for line breaks)
- ppe: array of required PPE from these options: ["Goggles", "Gloves", "Face Shield", "Apron", "Add. Hearing"]
- hazards: array of hazards from these options: ["Fire", "Slip / Trip", "Shock", "Pinch Point", "Ergo", "Hand Safety", "Eye Safety", "Laceration", "Head Safety"]
- materials: tools/materials needed
- warning: safety warnings (or empty string if none)

Return ONLY a valid JSON array of card objects. No markdown, no explanation. Example format:
[
  {
    "frequency": "daily",
    "title": "Inspect Guards and Covers",
    "equipment": "Machine Name",
    "shift": "Pre-shift",
    "description": "Visual inspection of all safety guards...",
    "instruction": "1. Check all guard mounting bolts\\n2. Verify interlocks...",
    "ppe": ["Goggles", "Gloves"],
    "hazards": ["Pinch Point", "Laceration"],
    "materials": "Flashlight, wrench set",
    "warning": "Lock out/tag out before removing any guards"
  }
]

Generate 12-25 cards covering all maintenance frequencies. Be specific to the actual machine type and its components.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const result = await response.json();
  const rawText = result.content?.[0]?.text || '';

  // Parse JSON from response (handle potential markdown wrapping)
  let cards;
  try {
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found');
    cards = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw createError('PARSE_ERROR', 'Failed to parse AI response: ' + e.message);
  }

  // Normalize cards into our schema format
  const normalized = cards.map(c => ({
    frequency: c.frequency || 'daily',
    [`title${titleSuffix}`]: c.title || '',
    [`title${otherSuffix}`]: '',
    equipment: c.equipment || machine_name,
    shift: c.shift || '',
    [`desc${titleSuffix}`]: c.description || '',
    [`desc${otherSuffix}`]: '',
    [`instr${titleSuffix}`]: c.instruction || '',
    [`instr${otherSuffix}`]: '',
    ppe: c.ppe || [],
    hazards: c.hazards || [],
    [`materials${titleSuffix}`]: c.materials || '',
    [`materials${otherSuffix}`]: '',
    [`warning${titleSuffix}`]: c.warning || '',
    [`warning${otherSuffix}`]: '',
  }));

  return successResponse({ success: true, cards: normalized });
}

// ── BULK CREATE cards ──
async function bulkCreateCards(body, env) {
  const cards = body.cards;
  if (!cards || !Array.isArray(cards) || cards.length === 0) {
    throw createError('VALIDATION_ERROR', 'cards array is required');
  }

  const now = new Date().toISOString();
  const created = [];

  for (const c of cards) {
    const id = 'TPM-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
    await insert(env.DB, 'tpm_cards', {
      id,
      frequency: c.frequency || 'daily',
      title_en: c.title_en || '',
      title_es: c.title_es || '',
      equipment: c.equipment || '',
      shift: c.shift || '',
      desc_en: c.desc_en || '',
      desc_es: c.desc_es || '',
      instr_en: c.instr_en || '',
      instr_es: c.instr_es || '',
      desc_image: c.desc_image || '',
      instr_image: c.instr_image || '',
      ppe: JSON.stringify(c.ppe || []),
      ppe_other: c.ppe_other || '',
      hazards: JSON.stringify(c.hazards || []),
      hazard_other: c.hazard_other || '',
      materials_en: c.materials_en || '',
      materials_es: c.materials_es || '',
      warning_en: c.warning_en || '',
      warning_es: c.warning_es || '',
      status: 'needs_review',
      created_by: c.created_by || 'ai-generated',
      created_at: now,
      updated_at: now,
    });
    created.push(id);
  }

  return successResponse({ success: true, message: `${created.length} cards created`, ids: created });
}

// ── Router ──
export async function handleTpmD1(request, env) {
  const action = getAction(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  const actions = {
    getCards: () => getCards(env),
    getCard: () => getCard(body, env),
    getEquipment: () => getEquipment(env),
    createCard: () => createCard(body, env),
    updateCard: () => updateCard(body, env),
    deleteCard: () => deleteCard(body, env),
    approveCard: () => approveCard(body, env),
    translate: () => translateCard(body, env),
    translateBatch: () => translateCardBatch(body, env),
    generateCards: () => generateCards(body, env),
    bulkCreate: () => bulkCreateCards(body, env),
    test: () => successResponse({ success: true, message: 'TPM API OK' }),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
