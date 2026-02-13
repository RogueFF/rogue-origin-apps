/**
 * Config action handlers — getConfig, setConfig, testConfig.
 */

import { successResponse, errorResponse } from '../../lib/response.js';
import { getAllConfig, setConfig } from '../../lib/production-utils.js';

async function handleGetConfig(params, env) {
  const category = params.category || null;
  const configData = await getAllConfig(env, category);
  return successResponse(configData);
}

async function handleSetConfig(body, env, request) {
  if (request.method !== 'POST') {
    return errorResponse('POST required', 'METHOD_ERROR', 405);
  }
  if (!body.key || body.value === undefined) {
    return errorResponse('key and value required', 'VALIDATION_ERROR', 400);
  }
  await setConfig(env, body.key, body.value, body.updatedBy || 'api');
  return successResponse({ success: true, key: body.key });
}

async function handleTestConfig(env) {
  try {
    const count = await env.DB.prepare('SELECT COUNT(*) as count FROM system_config').first();
    const sample = await env.DB.prepare('SELECT key, value, category FROM system_config LIMIT 3').all();
    return successResponse({
      test: 'config endpoints work',
      timestamp: new Date().toISOString(),
      tableExists: true,
      rowCount: count?.count || 0,
      sampleRows: sample?.results || []
    });
  } catch (e) {
    return successResponse({
      test: 'config endpoints work',
      timestamp: new Date().toISOString(),
      tableExists: false,
      error: e.message
    });
  }
}

export { handleGetConfig, handleSetConfig, handleTestConfig };
