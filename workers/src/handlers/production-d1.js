/**
 * Production Tracking API Handler - D1 Version
 *
 * This file is now a thin re-export from the modular handlers
 * in ./production/. The actual logic lives in:
 *   - production/scoreboard.js  — scoreboard, dashboard, morning report
 *   - production/hourly-entry.js — addProduction, getProduction, getCultivars
 *   - production/bag-tracking.js — bag timer, pause/resume, debug
 *   - production/chat.js         — AI chat, TTS
 *   - production/config.js       — config CRUD
 *   - production/strain.js       — strain analysis
 *   - production/inventory.js    — inventory webhooks
 *   - production/shift.js        — shift start/end
 *   - production/scale.js        — scale weight
 *   - production/migrate.js      — sheets migration
 *   - production/index.js        — router/dispatcher
 */

export { handleProductionD1 } from './production/index.js';
