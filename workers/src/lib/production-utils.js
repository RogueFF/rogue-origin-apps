/**
 * Production shared utilities — used by multiple production handler modules.
 */

import { query, queryOne, execute } from './db.js';
import {
  TIME_SLOT_MULTIPLIERS,
  TIMEZONE,
  getTimeSlotMultiplier,
} from './production-helpers.js';

// ===== CONSTANTS =====

const AI_MODEL = 'claude-sonnet-4-20250514';

const SHEETS = {
  tracking: 'Rogue Origin Production Tracking',
  pauseLog: 'Timer Pause Log',
  shiftAdjustments: 'Shift Adjustments',
  orders: 'Orders',
  data: 'Data',
};

// Labor cost configuration
const BASE_WAGE_RATE = 23.00;
const EMPLOYER_TAX_RATE = 0.14;
const TOTAL_LABOR_COST_PER_HOUR = BASE_WAGE_RATE * (1 + EMPLOYER_TAX_RATE);

// ===== DATE HELPERS =====

function formatDatePT(date, format = 'yyyy-MM-dd') {
  const d = new Date(date);
  const options = { timeZone: TIMEZONE };

  if (format === 'yyyy-MM-dd') {
    return d.toLocaleDateString('sv-SE', options);
  }
  if (format === 'yyyy-MM') {
    const parts = d.toLocaleDateString('sv-SE', options).split('-');
    return `${parts[0]}-${parts[1]}`;
  }
  if (format === 'MMMM dd, yyyy') {
    return d.toLocaleDateString('en-US', {
      ...options,
      month: 'long',
      day: '2-digit',
      year: 'numeric',
    });
  }
  if (format === 'HH:mm:ss') {
    return d.toLocaleTimeString('en-GB', { ...options, hour12: false });
  }
  if (format === 'EEEE, MMM d') {
    return d.toLocaleDateString('en-US', {
      ...options,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  }
  return d.toISOString();
}

// ===== CONFIG HELPERS =====

function parseConfigValue(value, type) {
  switch (type) {
    case 'number': return parseFloat(value);
    case 'boolean': return value === 'true';
    case 'json': try { return JSON.parse(value); } catch { return value; }
    default: return value;
  }
}

async function getConfig(env, key) {
  try {
    const row = await env.DB.prepare(
      'SELECT value, value_type FROM system_config WHERE key = ?'
    ).bind(key).first();
    if (!row) return null;
    return parseConfigValue(row.value, row.value_type);
  } catch {
    return null;
  }
}

async function getAllConfig(env, category = null) {
  let stmt;
  if (category) {
    stmt = env.DB.prepare('SELECT key, value, value_type, category, description, updated_at FROM system_config WHERE category = ?').bind(category);
  } else {
    stmt = env.DB.prepare('SELECT key, value, value_type, category, description, updated_at FROM system_config');
  }
  const { results } = await stmt.all();
  const config = {};
  for (const row of results) {
    config[row.key] = {
      value: parseConfigValue(row.value, row.value_type),
      category: row.category,
      description: row.description,
      updatedAt: row.updated_at,
    };
  }
  return config;
}

async function setConfig(env, key, value, updatedBy = 'system') {
  await env.DB.prepare(
    `UPDATE system_config SET value = ?, updated_at = datetime('now'), updated_by = ? WHERE key = ?`
  ).bind(String(value), updatedBy, key).run();
}

// ===== VERSION TRACKING =====

async function getDataVersion(env) {
  try {
    const result = await queryOne(env.DB, `
      SELECT version, updated_at FROM data_version WHERE key = ?
    `, ['scoreboard']);
    return result ? { version: result.version, updatedAt: result.updated_at } : { version: 0, updatedAt: null };
  } catch (error) {
    console.error('Error getting data version:', error);
    return { version: 0, updatedAt: null };
  }
}

async function incrementDataVersion(env) {
  try {
    await execute(env.DB, `
      UPDATE data_version
      SET version = version + 1, updated_at = datetime('now')
      WHERE key = ?
    `, ['scoreboard']);
  } catch (error) {
    console.error('Error incrementing data version:', error);
  }
}

// ===== EFFECTIVE TARGET RATE =====

async function getEffectiveTargetRate(env, days = 7, timeSlotMultipliers = null, strain = null) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = formatDatePT(cutoff, 'yyyy-MM-dd');

  // Try strain-specific query first if strain is provided
  if (strain && strain.trim() !== '') {
    const strainSlots = await query(env.DB, `
      SELECT production_date, time_slot, tops_lbs1, trimmers_line1
      FROM monthly_production
      WHERE production_date >= ?
        AND tops_lbs1 > 0 AND trimmers_line1 > 0
        AND cultivar1 = ?
      ORDER BY production_date
    `, [cutoffStr, strain]);

    const strainDates = [...new Set(strainSlots.map(s => s.production_date))].sort().slice(-days);
    const strainDateSet = new Set(strainDates);

    let strainTotalTops = 0;
    let strainTotalEffectiveTrimmerHours = 0;

    for (const slot of strainSlots) {
      if (strainDateSet.has(slot.production_date)) {
        strainTotalTops += slot.tops_lbs1;
        strainTotalEffectiveTrimmerHours += slot.trimmers_line1 * getTimeSlotMultiplier(slot.time_slot, timeSlotMultipliers);
      }
    }

    // If we have data for this strain, use it
    if (strainTotalEffectiveTrimmerHours > 0) {
      return strainTotalTops / strainTotalEffectiveTrimmerHours;
    }
  }

  // Fall back to global average (unfiltered)
  const slots = await query(env.DB, `
    SELECT production_date, time_slot, tops_lbs1, trimmers_line1
    FROM monthly_production
    WHERE production_date >= ?
      AND tops_lbs1 > 0 AND trimmers_line1 > 0
    ORDER BY production_date
  `, [cutoffStr]);

  const dates = [...new Set(slots.map(s => s.production_date))].sort().slice(-days);
  const dateSet = new Set(dates);

  let totalTops = 0;
  let totalEffectiveTrimmerHours = 0;

  for (const slot of slots) {
    if (dateSet.has(slot.production_date)) {
      totalTops += slot.tops_lbs1;
      totalEffectiveTrimmerHours += slot.trimmers_line1 * getTimeSlotMultiplier(slot.time_slot, timeSlotMultipliers);
    }
  }

  return totalEffectiveTrimmerHours > 0 ? totalTops / totalEffectiveTrimmerHours : 1.0;
}

export {
  AI_MODEL,
  SHEETS,
  BASE_WAGE_RATE,
  EMPLOYER_TAX_RATE,
  TOTAL_LABOR_COST_PER_HOUR,
  formatDatePT,
  parseConfigValue,
  getConfig,
  getAllConfig,
  setConfig,
  getDataVersion,
  incrementDataVersion,
  getEffectiveTargetRate,
};
