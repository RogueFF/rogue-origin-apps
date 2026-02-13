/**
 * Production handler router — dispatches actions to focused modules.
 * Drop-in replacement for the monolithic production-d1.js.
 */

import { successResponse, errorResponse, parseBody, getAction, getQueryParams } from '../../lib/response.js';
import { formatError } from '../../lib/errors.js';
import { requireAuth } from '../../lib/auth.js';
import { getDataVersion } from '../../lib/production-utils.js';

import { scoreboard, dashboard, morningReport } from './scoreboard.js';
import { logBag, logPause, logResume, debugBags } from './bag-tracking.js';
import { addProduction, getProduction, getCultivars } from './hourly-entry.js';
import { chat, tts } from './chat.js';
import { handleGetConfig, handleSetConfig, handleTestConfig } from './config.js';
import { analyzeStrain } from './strain.js';
import { inventoryWebhook } from './inventory.js';
import { setShiftStart, getShiftStart } from './shift.js';
import { getScaleWeight, setScaleWeight } from './scale.js';
import { migrateFromSheets, checkSheet } from './migrate.js';

async function test(env) {
  return successResponse({
    ok: true,
    message: 'Production API is working (Cloudflare D1)',
    timestamp: new Date().toISOString(),
  });
}

async function version(env) {
  const versionData = await getDataVersion(env);
  return successResponse({
    version: versionData.version,
    updatedAt: versionData.updatedAt,
  });
}

export async function handleProductionD1(request, env, ctx) {
  try {
    const body = request.method === 'POST' ? await parseBody(request) : {};
    const action = getAction(request, body);
    const params = getQueryParams(request);

    if (!action) {
      return errorResponse('Missing action parameter', 'VALIDATION_ERROR', 400);
    }

    switch (action) {
      case 'test':
        return await test(env);
      case 'debugBags':
        return await debugBags(env);
      case 'version':
        return await version(env);
      case 'scoreboard':
        return await scoreboard(params, env);
      case 'dashboard':
        return await dashboard(params, env);
      case 'setShiftStart':
        return await setShiftStart({ ...params, ...body }, env);
      case 'getShiftStart':
        return await getShiftStart(params, env);
      case 'morningReport':
        return await morningReport(env);
      case 'logBag':
        return await logBag(body, env);
      case 'logPause':
        return await logPause(body, env);
      case 'logResume':
        return await logResume(body, env);
      case 'scaleWeight':
        if (request.method === 'POST') {
          return await setScaleWeight(body, env);
        }
        return await getScaleWeight(params, env);
      case 'inventoryWebhook':
      case 'webhook':
        return await inventoryWebhook(body, env, request);
      case 'chat':
        requireAuth(request, body, env, 'production-chat');
        return await chat(body, env);
      case 'tts':
        requireAuth(request, body, env, 'production-tts');
        return await tts(body, env);
      case 'addProduction':
        return await addProduction(body, env);
      case 'getProduction':
        return await getProduction(params, env);
      case 'getCultivars':
        return await getCultivars(env);
      case 'analyzeStrain':
        return await analyzeStrain(params, env);
      case 'testConfig':
        return await handleTestConfig(env);
      case 'getConfig':
        return await handleGetConfig(params, env);
      case 'setConfig':
        return await handleSetConfig(body, env, request);
      case 'migrate':
        return await migrateFromSheets(env);
      case 'checkSheet':
        return await checkSheet(params, env);
      default:
        return errorResponse(`Unknown action: ${action}`, 'NOT_FOUND', 404);
    }
  } catch (error) {
    console.error('Production handler error:', error);
    const { message, code, status } = formatError(error);
    return errorResponse(message, code, status);
  }
}
